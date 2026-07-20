import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { LevelEngine } from "../lib/levels/level-engine.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import type {
  BaseCandleProviderResponse,
  Candle,
  CandleProviderResponse,
  CandleTimeframe,
} from "../lib/market-data/candle-types.js";
import type {
  HistoricalCandleProvider,
  HistoricalFetchPlan,
  HistoricalFetchRequest,
} from "../lib/market-data/provider-types.js";

type CorpusCase = {
  symbol: string;
  referencePrice: number;
  lookbacks: Record<CandleTimeframe, number>;
  responses: Record<CandleTimeframe, CandleProviderResponse>;
};

type Corpus = {
  schemaVersion: "eodhd-validation-corpus/v1";
  endTimeMs: number;
  provenance: {
    tokenIncluded: boolean;
    reviewRequiredBeforeFixturePromotion: boolean;
  };
  cases: CorpusCase[];
};

const corpusPath = fileURLToPath(new URL(
  "./fixtures/eodhd-validation-corpus/v1/corpus.json",
  import.meta.url,
));
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as Corpus;

class EodhdCorpusProvider implements HistoricalCandleProvider {
  readonly providerName = "eodhd" as const;
  readonly requests: HistoricalFetchRequest[] = [];

  async fetchCandles(
    request: HistoricalFetchRequest,
    _plan: HistoricalFetchPlan,
  ): Promise<BaseCandleProviderResponse> {
    this.requests.push({ ...request });
    const fixtureCase = corpus.cases.find(
      (candidate) => candidate.symbol === request.symbol.toUpperCase(),
    );
    if (!fixtureCase) {
      throw new Error(`EODHD corpus cache miss for symbol ${request.symbol}.`);
    }
    if (fixtureCase.lookbacks[request.timeframe] !== request.lookbackBars) {
      throw new Error(
        `EODHD corpus cache miss for ${request.symbol} ${request.timeframe} lookback ${request.lookbackBars}.`,
      );
    }
    if (request.endTimeMs !== corpus.endTimeMs) {
      throw new Error(
        `EODHD corpus cache miss for ${request.symbol} ${request.timeframe} end ${String(request.endTimeMs)}.`,
      );
    }

    const response = fixtureCase.responses[request.timeframe];
    return {
      provider: response.provider,
      symbol: response.symbol,
      timeframe: response.timeframe,
      requestedLookbackBars: response.requestedLookbackBars,
      candles: response.candles.map((candle) => ({ ...candle })),
      fetchStartTimestamp: 0,
      fetchEndTimestamp: 0,
      requestedStartTimestamp: response.requestedStartTimestamp,
      requestedEndTimestamp: response.requestedEndTimestamp,
      sessionMetadataAvailable: response.sessionMetadataAvailable,
      providerMetadata: response.providerMetadata
        ? { ...response.providerMetadata }
        : undefined,
    };
  }
}

function assertValidSeries(candles: Candle[]): void {
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const candle of candles) {
    assert.ok(candle.timestamp > previousTimestamp, "timestamps must be sorted and unique");
    assert.ok(candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0);
    assert.ok(candle.high >= Math.max(candle.open, candle.close, candle.low));
    assert.ok(candle.low <= Math.min(candle.open, candle.close, candle.high));
    assert.ok(candle.volume >= 0);
    previousTimestamp = candle.timestamp;
  }
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function flattenSide(
  output: LevelEngineOutput,
  side: "support" | "resistance",
): FinalLevelZone[] {
  return side === "support"
    ? [
        ...output.majorSupport,
        ...output.intermediateSupport,
        ...output.intradaySupport,
        ...output.extensionLevels.support,
      ]
    : [
        ...output.majorResistance,
        ...output.intermediateResistance,
        ...output.intradayResistance,
        ...output.extensionLevels.resistance,
      ];
}

function compactChartRead(output: LevelEngineOutput) {
  const referencePrice = output.metadata.referencePrice ?? 0;
  const supports = flattenSide(output, "support")
    .filter((zone) => zone.representativePrice <= referencePrice)
    .sort((left, right) => right.representativePrice - left.representativePrice);
  const resistances = flattenSide(output, "resistance")
    .filter((zone) => zone.representativePrice >= referencePrice)
    .sort((left, right) => left.representativePrice - right.representativePrice);

  return {
    referencePrice: round(referencePrice),
    bucketCounts: {
      majorSupport: output.majorSupport.length,
      majorResistance: output.majorResistance.length,
      intermediateSupport: output.intermediateSupport.length,
      intermediateResistance: output.intermediateResistance.length,
      intradaySupport: output.intradaySupport.length,
      intradayResistance: output.intradayResistance.length,
      extensionSupport: output.extensionLevels.support.length,
      extensionResistance: output.extensionLevels.resistance.length,
    },
    nearestSupport: supports.slice(0, 3).map((zone) => round(zone.representativePrice)),
    nearestResistance: resistances.slice(0, 3).map((zone) => round(zone.representativePrice)),
    outerSupport: supports.length > 0 ? round(supports.at(-1)!.representativePrice) : null,
    outerResistance: resistances.length > 0 ? round(resistances.at(-1)!.representativePrice) : null,
    dataQualityFlags: [...output.metadata.dataQualityFlags].sort(),
  };
}

const EXPECTED_CHART_READS: Record<string, ReturnType<typeof compactChartRead>> = {
  NVVE: {
    referencePrice: 16.095,
    bucketCounts: {
      majorSupport: 4,
      majorResistance: 0,
      intermediateSupport: 4,
      intermediateResistance: 2,
      intradaySupport: 4,
      intradayResistance: 3,
      extensionSupport: 3,
      extensionResistance: 1,
    },
    nearestSupport: [15.5001, 15.3301, 15.07],
    nearestResistance: [16.2999, 16.5899, 17.375],
    outerSupport: 3.791,
    outerResistance: 20.73,
    dataQualityFlags: [
      "4h:missing_recent_candles",
      "4h:stale_final_candle",
      "4h:suspicious_gap",
      "5m:incomplete_current_session_data",
      "5m:missing_recent_candles",
      "5m:stale_final_candle",
      "5m:suspicious_gap",
    ],
  },
  GME: {
    referencePrice: 22.435,
    bucketCounts: {
      majorSupport: 1,
      majorResistance: 3,
      intermediateSupport: 1,
      intermediateResistance: 0,
      intradaySupport: 1,
      intradayResistance: 0,
      extensionSupport: 3,
      extensionResistance: 3,
    },
    nearestSupport: [22.36, 21.895, 21.53],
    nearestResistance: [22.65, 23.11, 23.68],
    outerSupport: 15.7,
    outerResistance: 29.5,
    dataQualityFlags: [
      "4h:missing_recent_candles",
      "4h:stale_final_candle",
      "4h:suspicious_gap",
      "5m:incomplete_current_session_data",
      "5m:missing_recent_candles",
      "5m:stale_final_candle",
      "daily:suspicious_gap",
    ],
  },
};

test("EODHD corpus is sanitized, offline-only, and preserves provider quality metadata", async () => {
  assert.equal(corpus.schemaVersion, "eodhd-validation-corpus/v1");
  assert.equal(corpus.provenance.tokenIncluded, false);
  assert.equal(corpus.provenance.reviewRequiredBeforeFixturePromotion, false);

  for (const fixtureCase of corpus.cases) {
    for (const timeframe of ["daily", "4h", "5m"] as const) {
      const response = fixtureCase.responses[timeframe];
      assertValidSeries(response.candles);
      assert.equal(response.provider, "eodhd");
      assert.equal(response.providerMetadata?.sessionCoverage, "regular_only");
    }
  }

  const nvve = corpus.cases.find((fixtureCase) => fixtureCase.symbol === "NVVE")!;
  assert.equal(nvve.responses.daily.providerMetadata?.priceBasisSource, "yahoo_current_basis_fallback");
  assert.equal(nvve.responses.daily.providerMetadata?.splitBasisMismatchDetected, true);
  assert.equal(nvve.responses.daily.providerMetadata?.splitBasisMismatchDate, "2026-07-06");
  assert.equal(nvve.responses["5m"].providerMetadata?.priceBasisDroppedInvalidOhlcBars, 72);

  const gme = corpus.cases.find((fixtureCase) => fixtureCase.symbol === "GME")!;
  assert.equal(gme.responses.daily.providerMetadata?.splitBasisMismatchDetected, false);
  assert.equal(gme.responses["4h"].providerMetadata?.priceBasisDroppedInvalidOhlcBars, 0);
});

for (const fixtureCase of corpus.cases) {
  test(`EODHD corpus locks the compact ${fixtureCase.symbol} chart read`, async (context) => {
    context.mock.method(Date, "now", () => corpus.endTimeMs);
    const provider = new EodhdCorpusProvider();
    const engine = new LevelEngine(new CandleFetchService(provider), undefined, {
      runtimeMode: "compare",
      compareActivePath: "old",
    });
    const generation = await engine.generateLevelsWithSeries({
      symbol: fixtureCase.symbol,
      referencePriceOverride: fixtureCase.referencePrice,
      historicalRequests: {
        daily: {
          symbol: fixtureCase.symbol,
          timeframe: "daily",
          lookbackBars: fixtureCase.lookbacks.daily,
          endTimeMs: corpus.endTimeMs,
        },
        "4h": {
          symbol: fixtureCase.symbol,
          timeframe: "4h",
          lookbackBars: fixtureCase.lookbacks["4h"],
          endTimeMs: corpus.endTimeMs,
        },
        "5m": {
          symbol: fixtureCase.symbol,
          timeframe: "5m",
          lookbackBars: fixtureCase.lookbacks["5m"],
          endTimeMs: corpus.endTimeMs,
        },
      },
    });

    assert.deepEqual(
      provider.requests.map((request) => request.timeframe).sort(),
      ["4h", "5m", "daily"],
    );
    for (const response of Object.values(generation.seriesByTimeframe)) {
      assertValidSeries(response.candles);
    }
    const compact = compactChartRead(generation.output);
    assert.deepEqual(compact, EXPECTED_CHART_READS[fixtureCase.symbol]);
    if (fixtureCase.symbol === "NVVE") {
      const everyLevel = [
        ...flattenSide(generation.output, "support"),
        ...flattenSide(generation.output, "resistance"),
      ];
      assert.equal(
        everyLevel.some((zone) => Math.abs(zone.representativePrice - 25.82) <= 0.02),
        false,
      );
    }
  });
}
