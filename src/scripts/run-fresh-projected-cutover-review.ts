import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { LevelEngine } from "../lib/levels/level-engine.js";
import type { LevelRuntimeComparisonLogEntry } from "../lib/levels/level-runtime-comparison-logger.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import type {
  BaseCandleProviderResponse,
  CandleProviderName,
  CandleProviderResponse,
  CandleTimeframe,
} from "../lib/market-data/candle-types.js";
import type {
  HistoricalCandleProvider,
  HistoricalFetchPlan,
  HistoricalFetchRequest,
} from "../lib/market-data/provider-types.js";

type Corpus = {
  schemaVersion: string;
  capturedAt: string;
  endTimeMs: number;
  cases: Array<{
    symbol: string;
    referencePrice: number;
    lookbacks: Record<CandleTimeframe, number>;
    responses: Record<CandleTimeframe, CandleProviderResponse>;
  }>;
};

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function cloneBaseResponse(response: CandleProviderResponse): BaseCandleProviderResponse {
  return {
    provider: response.provider,
    symbol: response.symbol,
    timeframe: response.timeframe,
    requestedLookbackBars: response.requestedLookbackBars,
    candles: response.candles.map((candle) => ({ ...candle })),
    fetchStartTimestamp: response.fetchStartTimestamp,
    fetchEndTimestamp: response.fetchEndTimestamp,
    requestedStartTimestamp: response.requestedStartTimestamp,
    requestedEndTimestamp: response.requestedEndTimestamp,
    sessionMetadataAvailable: response.sessionMetadataAvailable,
    ...(response.providerMetadata
      ? { providerMetadata: { ...response.providerMetadata } }
      : {}),
  };
}

class SavedResponseProvider implements HistoricalCandleProvider {
  constructor(
    readonly providerName: CandleProviderName,
    private readonly responses: Record<CandleTimeframe, CandleProviderResponse>,
  ) {}

  async fetchCandles(
    request: HistoricalFetchRequest,
    _plan: HistoricalFetchPlan,
  ): Promise<BaseCandleProviderResponse> {
    if (request.timeframe === "1m") {
      throw new Error("The saved cutover corpus does not contain 1m candles.");
    }
    const response = this.responses[request.timeframe];
    if (
      response.symbol.toUpperCase() !== request.symbol.toUpperCase() ||
      response.requestedLookbackBars !== request.lookbackBars
    ) {
      throw new Error(`Saved response does not match ${request.symbol} ${request.timeframe}.`);
    }
    return cloneBaseResponse(response);
  }
}

function visibleRows(output: LevelEngineOutput): Array<{
  id: string;
  side: string;
  bucket: string;
  price: number;
  zoneLow: number;
  zoneHigh: number;
  percentFromReference: number;
  state: string | null;
  sourceTimeframes: string[];
}> {
  const referencePrice = output.metadata.referencePrice ?? 0;
  const rows: Array<{ zone: FinalLevelZone; bucket: string }> = [
    ...output.majorSupport.map((zone) => ({ zone, bucket: "major" })),
    ...output.majorResistance.map((zone) => ({ zone, bucket: "major" })),
    ...output.intermediateSupport.map((zone) => ({ zone, bucket: "intermediate" })),
    ...output.intermediateResistance.map((zone) => ({ zone, bucket: "intermediate" })),
    ...output.intradaySupport.map((zone) => ({ zone, bucket: "intraday" })),
    ...output.intradayResistance.map((zone) => ({ zone, bucket: "intraday" })),
  ];
  return rows
    .map(({ zone, bucket }) => ({
      id: zone.id,
      side: zone.kind,
      bucket,
      price: zone.representativePrice,
      zoneLow: zone.zoneLow,
      zoneHigh: zone.zoneHigh,
      percentFromReference: Number(
        (((zone.representativePrice - referencePrice) / referencePrice) * 100).toFixed(1),
      ),
      state: zone.enrichedAnalysis?.state ?? null,
      sourceTimeframes: [...zone.timeframeSources],
    }))
    .sort((left, right) =>
      left.side.localeCompare(right.side) ||
      (left.side === "support" ? right.price - left.price : left.price - right.price),
    );
}

async function main(): Promise<void> {
  const inputValue = argumentValue("--input");
  if (!inputValue) {
    throw new Error("Usage: --input <fresh corpus.json> [--out <review.json>]");
  }
  const inputPath = isAbsolute(inputValue) ? inputValue : resolve(inputValue);
  const corpus = JSON.parse(readFileSync(inputPath, "utf8")) as Corpus;
  const fixture = corpus.cases.find((item) => item.symbol.toUpperCase() === "NVVE");
  if (!fixture) {
    throw new Error("Fresh corpus does not contain NVVE.");
  }
  const requests = Object.fromEntries(
    (["daily", "4h", "5m"] as const).map((timeframe) => [
      timeframe,
      {
        symbol: "NVVE",
        timeframe,
        lookbackBars: fixture.lookbacks[timeframe],
        endTimeMs: corpus.endTimeMs,
        preferredProvider: "eodhd" as const,
      },
    ]),
  ) as Record<CandleTimeframe, HistoricalFetchRequest>;
  const comparisonLogs: LevelRuntimeComparisonLogEntry[] = [];
  const run = (runtimeMode: "old" | "new" | "compare", compareActivePath: "old" | "new" = "old") =>
    new LevelEngine(
      new CandleFetchService(new SavedResponseProvider("eodhd", fixture.responses)),
      undefined,
      {
        runtimeMode,
        compareActivePath,
        onComparisonLog: (entry) => comparisonLogs.push(entry),
      },
    ).generateLevels({
      symbol: "NVVE",
      referencePriceOverride: fixture.referencePrice,
      historicalRequests: requests,
    });

  const originalNow = Date.now;
  Date.now = () => corpus.endTimeMs;
  try {
    const [oldOutput, newOutput, compareOldOutput, compareNewOutput] = await Promise.all([
      run("old"),
      run("new"),
      run("compare", "old"),
      run("compare", "new"),
    ]);
    const oldPathRollbackVerified = isDeepStrictEqual(oldOutput, compareOldOutput);
    const projectedActivePathVerified = isDeepStrictEqual(newOutput, compareNewOutput);
    if (!oldPathRollbackVerified || !projectedActivePathVerified) {
      throw new Error("Old rollback or projected compare-path equivalence failed.");
    }
    const review = {
      schemaVersion: "fresh-projected-cutover-review/v1",
      generatedAt: new Date(corpus.endTimeMs).toISOString(),
      inputPath,
      capturedAt: corpus.capturedAt,
      symbol: "NVVE",
      referencePrice: fixture.referencePrice,
      oldPathRollbackVerified,
      projectedActivePathVerified,
      comparisonLogs,
      oldVisibleRows: visibleRows(oldOutput),
      projectedVisibleRows: visibleRows(newOutput),
      oldExtensions: [...oldOutput.extensionLevels.support, ...oldOutput.extensionLevels.resistance]
        .map((zone) => ({ id: zone.id, side: zone.kind, price: zone.representativePrice })),
      projectedExtensions: [...newOutput.extensionLevels.support, ...newOutput.extensionLevels.resistance]
        .map((zone) => ({ id: zone.id, side: zone.kind, price: zone.representativePrice })),
      dataQualityFlags: [...newOutput.metadata.dataQualityFlags],
    };
    const outputValue = argumentValue("--out");
    if (outputValue) {
      const outputPath = isAbsolute(outputValue) ? outputValue : resolve(outputValue);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
      console.log(`Review artifact: ${outputPath}`);
    }
    console.log(JSON.stringify(review, null, 2));
  } finally {
    Date.now = originalNow;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
