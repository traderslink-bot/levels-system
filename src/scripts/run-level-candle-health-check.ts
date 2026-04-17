// Live candle-source health check for the active level-validation workflow.

import "dotenv/config";

import { CandleFetchService, type HistoricalFetchRequest } from "../lib/market-data/candle-fetch-service.js";
import { createHistoricalCandleProvider } from "../lib/market-data/provider-factory.js";
import type { CandleProviderName } from "../lib/market-data/candle-types.js";
import {
  checkCandleSourceHealth,
  formatCandleSourceHealthReport,
} from "../lib/validation/candle-source-health.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import { createIbkrClient } from "./shared/ibkr-runtime.js";
import { createValidationCandleFetchService } from "./shared/validation-candle-cache.js";

function resolveProviderName(): CandleProviderName {
  const requested = process.env.LEVEL_VALIDATION_PROVIDER?.trim().toLowerCase();

  if (requested === "ibkr" || requested === "stub" || requested === "twelve_data") {
    return requested;
  }

  return "ibkr";
}

function defaultRequests(symbol: string): HistoricalFetchRequest[] {
  return [
    { symbol, timeframe: "daily", lookbackBars: 120 },
    { symbol, timeframe: "4h", lookbackBars: 120 },
    { symbol, timeframe: "5m", lookbackBars: 160 },
  ];
}

async function main(): Promise<void> {
  const symbol = process.argv[2]?.toUpperCase() ?? "AAPL";
  const providerName = resolveProviderName();
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
    const baseFetchService = new CandleFetchService(provider);
    const { candleFetchService, cacheMode, cacheDirectoryPath } =
      createValidationCandleFetchService(baseFetchService);
    const reports = await Promise.all(
      defaultRequests(symbol).map((request) => checkCandleSourceHealth(candleFetchService, request)),
    );

    console.log(`[LevelValidation] Candle source health for ${symbol}`);
    console.log(`[LevelValidation] Active provider path: ${provider.providerName}`);
    console.log(
      `[LevelValidation] Candle cache | mode=${cacheMode} | dir=${cacheDirectoryPath}`,
    );

    for (const report of reports) {
      console.log(formatCandleSourceHealthReport(report));
    }

    const unavailableReports = reports.filter((report) => report.status === "unavailable");
    if (unavailableReports.length > 0) {
      console.error(
        `[LevelValidation] Candle provider is unavailable for ${unavailableReports
          .map((report) => report.timeframe)
          .join(", ")}.`,
      );
      process.exitCode = 1;
      return;
    }

    const degradedReports = reports.filter((report) => report.status === "degraded");
    if (degradedReports.length > 0) {
      console.warn(
        `[LevelValidation] Candle provider returned degraded data for ${degradedReports
          .map((report) => report.timeframe)
          .join(", ")}.`,
      );
    } else {
      console.log("[LevelValidation] Candle provider health is good across all requested timeframes.");
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
