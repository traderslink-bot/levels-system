import "dotenv/config";

import { CandleFetchService, type HistoricalFetchRequest } from "../lib/market-data/candle-fetch-service.js";
import { createHistoricalCandleProvider } from "../lib/market-data/provider-factory.js";
import type { CandleProviderName, CandleTimeframe } from "../lib/market-data/candle-types.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import {
  checkCandleSourceHealth,
  formatCandleSourceHealthReport,
} from "../lib/validation/candle-source-health.js";
import {
  formatForwardReactionReport,
  validateForwardReactions,
} from "../lib/validation/forward-reaction-validator.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import { createIbkrClient } from "./shared/ibkr-runtime.js";

const DEFAULT_GENERATION_LOOKBACKS: Record<CandleTimeframe, number> = {
  daily: 120,
  "4h": 120,
  "5m": 160,
};
const DEFAULT_FORWARD_HORIZON_BARS = 48;
const DEFAULT_FUTURE_BUFFER_BARS = 24;

function resolveProviderName(): CandleProviderName {
  const requested = process.env.LEVEL_VALIDATION_PROVIDER?.trim().toLowerCase();

  if (requested === "ibkr" || requested === "stub" || requested === "twelve_data") {
    return requested;
  }

  return "ibkr";
}

function resolvePositiveInteger(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function buildGenerationRequests(
  symbol: string,
  providerName: CandleProviderName,
  endTimeMs: number,
): Record<CandleTimeframe, HistoricalFetchRequest> {
  return {
    daily: {
      symbol,
      timeframe: "daily",
      lookbackBars: DEFAULT_GENERATION_LOOKBACKS.daily,
      endTimeMs,
      preferredProvider: providerName,
    },
    "4h": {
      symbol,
      timeframe: "4h",
      lookbackBars: DEFAULT_GENERATION_LOOKBACKS["4h"],
      endTimeMs,
      preferredProvider: providerName,
    },
    "5m": {
      symbol,
      timeframe: "5m",
      lookbackBars: DEFAULT_GENERATION_LOOKBACKS["5m"],
      endTimeMs,
      preferredProvider: providerName,
    },
  };
}

async function verifyProviderHealth(
  candleFetchService: CandleFetchService,
  symbol: string,
  providerName: CandleProviderName,
): Promise<void> {
  const requests = (["daily", "4h", "5m"] as const).map((timeframe) => ({
    symbol,
    timeframe,
    lookbackBars: DEFAULT_GENERATION_LOOKBACKS[timeframe],
    preferredProvider: providerName,
  }));
  const reports = await Promise.all(
    requests.map((request) => checkCandleSourceHealth(candleFetchService, request)),
  );

  console.log(`[LevelValidation] Candle source health for ${symbol}`);
  for (const report of reports) {
    console.log(formatCandleSourceHealthReport(report));
  }

  const unavailableReports = reports.filter((report) => report.status === "unavailable");
  if (unavailableReports.length > 0) {
    throw new Error(
      `Candle provider is unavailable for ${unavailableReports
        .map((report) => report.timeframe)
        .join(", ")}.`,
    );
  }
}

async function main(): Promise<void> {
  const symbol = process.argv[2]?.toUpperCase() ?? "AAPL";
  const providerName = resolveProviderName();
  const forwardHorizonBars = resolvePositiveInteger(
    process.env.LEVEL_VALIDATION_FORWARD_HORIZON_BARS,
    DEFAULT_FORWARD_HORIZON_BARS,
  );
  const futureBufferBars = resolvePositiveInteger(
    process.env.LEVEL_VALIDATION_FUTURE_BUFFER_BARS,
    DEFAULT_FUTURE_BUFFER_BARS,
  );
  const forwardHorizonMs = forwardHorizonBars * 5 * 60 * 1000;
  const generationEndTimeMs = Date.now() - forwardHorizonMs;
  const needsIbkr = providerName === "ibkr";
  const ib = needsIbkr ? createIbkrClient() : undefined;

  try {
    if (needsIbkr && ib) {
      await waitForIbkrConnection(ib);
    }

    const provider = createHistoricalCandleProvider({
      provider: providerName,
      ib,
      twelveDataApiKey: process.env.TWELVE_DATA_API_KEY,
    });
    const candleFetchService = new CandleFetchService(provider);
    const levelEngine = new LevelEngine(candleFetchService);

    console.log(`[LevelValidation] Active provider path: ${provider.providerName}`);
    console.log(
      `[LevelValidation] Forward reaction config | symbol=${symbol} | horizonBars=${forwardHorizonBars} | generationEnd=${new Date(generationEndTimeMs).toISOString()}`,
    );

    await verifyProviderHealth(candleFetchService, symbol, providerName);

    const output = await levelEngine.generateLevels({
      symbol,
      historicalRequests: buildGenerationRequests(symbol, providerName, generationEndTimeMs),
    });
    const normalizedOutput = {
      ...output,
      generatedAt: generationEndTimeMs,
    };

    const futureResponse = await candleFetchService.fetchCandles({
      symbol,
      timeframe: "5m",
      lookbackBars: forwardHorizonBars + futureBufferBars,
      endTimeMs: Date.now(),
      preferredProvider: providerName,
    });
    const futureCandles = futureResponse.candles.filter(
      (candle) => candle.timestamp > generationEndTimeMs,
    );

    if (futureCandles.length === 0) {
      throw new Error("No future 5m candles were available after the generation window.");
    }

    console.log(
      `[LevelValidation] Future candle sample | returned=${futureCandles.length} | first=${new Date(futureCandles[0]!.timestamp).toISOString()} | last=${new Date(futureCandles.at(-1)!.timestamp).toISOString()}`,
    );

    const report = validateForwardReactions({
      output: normalizedOutput,
      futureCandles,
    });

    for (const line of formatForwardReactionReport(report)) {
      console.log(line);
    }
  } finally {
    ib?.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
