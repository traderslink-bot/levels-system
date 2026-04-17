import "dotenv/config";

import { CandleFetchService, type HistoricalFetchRequest } from "../lib/market-data/candle-fetch-service.js";
import { createHistoricalCandleProvider } from "../lib/market-data/provider-factory.js";
import type { CandleProviderName, CandleTimeframe } from "../lib/market-data/candle-types.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import type { LevelEngineOutput } from "../lib/levels/level-types.js";
import {
  checkCandleSourceHealth,
  formatCandleSourceHealthReport,
} from "../lib/validation/candle-source-health.js";
import {
  formatLevelPersistenceReport,
  validateLevelPersistence,
} from "../lib/validation/level-persistence-validator.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import { createIbkrClient } from "./shared/ibkr-runtime.js";

const DEFAULT_WINDOW_COUNT = 6;
const DEFAULT_STEP_MINUTES = 15;
const DEFAULT_LOOKBACKS: Record<CandleTimeframe, number> = {
  daily: 120,
  "4h": 120,
  "5m": 160,
};

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

function buildHistoricalRequests(
  symbol: string,
  providerName: CandleProviderName,
  endTimeMs: number,
): Record<CandleTimeframe, HistoricalFetchRequest> {
  return {
    daily: {
      symbol,
      timeframe: "daily",
      lookbackBars: DEFAULT_LOOKBACKS.daily,
      endTimeMs,
      preferredProvider: providerName,
    },
    "4h": {
      symbol,
      timeframe: "4h",
      lookbackBars: DEFAULT_LOOKBACKS["4h"],
      endTimeMs,
      preferredProvider: providerName,
    },
    "5m": {
      symbol,
      timeframe: "5m",
      lookbackBars: DEFAULT_LOOKBACKS["5m"],
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
    lookbackBars: DEFAULT_LOOKBACKS[timeframe],
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
  const windowCount = resolvePositiveInteger(process.env.LEVEL_VALIDATION_WINDOWS, DEFAULT_WINDOW_COUNT);
  const stepMinutes = resolvePositiveInteger(
    process.env.LEVEL_VALIDATION_STEP_MINUTES,
    DEFAULT_STEP_MINUTES,
  );
  const stepMs = stepMinutes * 60 * 1000;
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
      `[LevelValidation] Persistence run config | symbol=${symbol} | windows=${windowCount} | stepMinutes=${stepMinutes}`,
    );

    await verifyProviderHealth(candleFetchService, symbol, providerName);

    const outputs: LevelEngineOutput[] = [];
    const anchorTimeMs = Date.now();

    for (let index = 0; index < windowCount; index += 1) {
      const endTimeMs = anchorTimeMs - (windowCount - 1 - index) * stepMs;
      const output = await levelEngine.generateLevels({
        symbol,
        historicalRequests: buildHistoricalRequests(symbol, providerName, endTimeMs),
      });
      const normalizedOutput = {
        ...output,
        generatedAt: endTimeMs,
      };
      outputs.push(normalizedOutput);

      const surfacedSupportCount =
        normalizedOutput.majorSupport.length +
        normalizedOutput.intermediateSupport.length +
        normalizedOutput.intradaySupport.length;
      const surfacedResistanceCount =
        normalizedOutput.majorResistance.length +
        normalizedOutput.intermediateResistance.length +
        normalizedOutput.intradayResistance.length;

      console.log(
        `[LevelValidation] Generated window ${index + 1}/${windowCount} | endTime=${new Date(endTimeMs).toISOString()} | surfacedSupport=${surfacedSupportCount} | surfacedResistance=${surfacedResistanceCount} | extensionSupport=${normalizedOutput.extensionLevels.support.length} | extensionResistance=${normalizedOutput.extensionLevels.resistance.length}`,
      );
    }

    const report = validateLevelPersistence(outputs);
    for (const line of formatLevelPersistenceReport(report)) {
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
