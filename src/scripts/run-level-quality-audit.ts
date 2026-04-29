import "dotenv/config";

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CandleFetchService, type HistoricalFetchRequest } from "../lib/market-data/candle-fetch-service.js";
import type { CandleProviderName, CandleTimeframe } from "../lib/market-data/candle-types.js";
import { createHistoricalCandleProvider } from "../lib/market-data/provider-factory.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import {
  buildLevelQualityAuditReport,
  formatLevelQualityAuditReport,
} from "../lib/levels/level-quality-audit.js";
import { resolveValidationLookbacks } from "../lib/validation/validation-lookback-config.js";
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

function resolvePositiveInteger(rawValue: string | undefined): number | undefined {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function buildHistoricalRequests(
  symbol: string,
  lookbacks: ReturnType<typeof resolveValidationLookbacks>,
): Record<CandleTimeframe, HistoricalFetchRequest> {
  return {
    daily: { symbol, timeframe: "daily", lookbackBars: lookbacks.daily },
    "4h": { symbol, timeframe: "4h", lookbackBars: lookbacks["4h"] },
    "5m": { symbol, timeframe: "5m", lookbackBars: lookbacks["5m"] },
  };
}

async function main(): Promise<void> {
  const symbol = process.argv[2]?.toUpperCase();
  if (!symbol) {
    throw new Error("Usage: npm run validation:levels:quality -- <SYMBOL> [output-json-path]");
  }

  const outputPath = process.argv[3] ? resolve(process.argv[3]) : null;
  const providerName = resolveProviderName();
  const ibkrTimeoutMs = resolvePositiveInteger(process.env.LEVEL_VALIDATION_IBKR_TIMEOUT_MS);
  const ib = providerName === "ibkr" ? createIbkrClient() : undefined;

  try {
    if (ib) {
      await waitForIbkrConnection(ib);
    }

    const provider = createHistoricalCandleProvider({
      provider: providerName,
      ib,
      twelveDataApiKey: process.env.TWELVE_DATA_API_KEY,
      ibkrTimeoutMs,
    });
    const baseFetchService = new CandleFetchService(provider);
    const { candleFetchService, cacheMode, cacheDirectoryPath } =
      createValidationCandleFetchService(baseFetchService);
    const lookbacks = resolveValidationLookbacks();
    const engine = new LevelEngine(candleFetchService);
    const levels = await engine.generateLevels({
      symbol,
      historicalRequests: buildHistoricalRequests(symbol, lookbacks),
    });
    const report = buildLevelQualityAuditReport(levels);

    console.log(`[LevelQualityAudit] provider=${provider.providerName}`);
    console.log(`[LevelQualityAudit] cache mode=${cacheMode} dir=${cacheDirectoryPath}`);
    console.log(
      `[LevelQualityAudit] lookbacks daily=${lookbacks.daily} 4h=${lookbacks["4h"]} 5m=${lookbacks["5m"]}`,
    );
    console.log(formatLevelQualityAuditReport(report));

    if (outputPath) {
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      console.log(`[LevelQualityAudit] wrote ${outputPath}`);
    }

    if (report.findings.some((finding) => finding.severity === "action")) {
      process.exitCode = 2;
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
