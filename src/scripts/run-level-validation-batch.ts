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
  formatForwardReactionReport,
  validateForwardReactions,
} from "../lib/validation/forward-reaction-validator.js";
import {
  formatLevelPersistenceReport,
  validateLevelPersistence,
} from "../lib/validation/level-persistence-validator.js";
import {
  formatLevelValidationBatchSummary,
  summarizeLevelValidationBatch,
  type SymbolLevelValidationBatchResult,
} from "../lib/validation/level-validation-batch.js";
import { resolveValidationLookbacks } from "../lib/validation/validation-lookback-config.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import { createIbkrClient } from "./shared/ibkr-runtime.js";
import { createValidationCandleFetchService } from "./shared/validation-candle-cache.js";

const DEFAULT_WINDOW_COUNT = 4;
const DEFAULT_STEP_MINUTES = 15;
const DEFAULT_FORWARD_HORIZON_BARS = 48;
const DEFAULT_FUTURE_BUFFER_BARS = 24;
const RECOMMENDED_LIVE_BATCH_SIZE = 5;

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

function resolveOptionalPositiveInteger(rawValue: string | undefined): number | undefined {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveSymbols(): string[] {
  const args = process.argv.slice(2).map((value) => value.trim().toUpperCase()).filter(Boolean);
  if (args.length > 0) {
    return args;
  }

  return (process.env.LEVEL_VALIDATION_SYMBOLS ?? "AAPL")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

function buildHistoricalRequests(
  symbol: string,
  providerName: CandleProviderName,
  endTimeMs: number,
  lookbacks: Record<CandleTimeframe, number>,
): Record<CandleTimeframe, HistoricalFetchRequest> {
  return {
    daily: {
      symbol,
      timeframe: "daily",
      lookbackBars: lookbacks.daily,
      endTimeMs,
      preferredProvider: providerName,
    },
    "4h": {
      symbol,
      timeframe: "4h",
      lookbackBars: lookbacks["4h"],
      endTimeMs,
      preferredProvider: providerName,
    },
    "5m": {
      symbol,
      timeframe: "5m",
      lookbackBars: lookbacks["5m"],
      endTimeMs,
      preferredProvider: providerName,
    },
  };
}

async function collectHealthReports(
  candleFetchService: CandleFetchService,
  symbol: string,
  providerName: CandleProviderName,
  lookbacks: Record<CandleTimeframe, number>,
) {
  return Promise.all(
    (["daily", "4h", "5m"] as const).map((timeframe) =>
      checkCandleSourceHealth(candleFetchService, {
        symbol,
        timeframe,
        lookbackBars: lookbacks[timeframe],
        preferredProvider: providerName,
      }),
    ),
  );
}

async function buildPersistenceOutputs(params: {
  symbol: string;
  providerName: CandleProviderName;
  lookbacks: Record<CandleTimeframe, number>;
  windowCount: number;
  stepMs: number;
  levelEngine: LevelEngine;
}): Promise<LevelEngineOutput[]> {
  const outputs: LevelEngineOutput[] = [];
  const anchorTimeMs = Date.now();

  for (let index = 0; index < params.windowCount; index += 1) {
    const endTimeMs = anchorTimeMs - (params.windowCount - 1 - index) * params.stepMs;
    const output = await params.levelEngine.generateLevels({
      symbol: params.symbol,
      historicalRequests: buildHistoricalRequests(
        params.symbol,
        params.providerName,
        endTimeMs,
        params.lookbacks,
      ),
    });
    outputs.push({
      ...output,
      generatedAt: endTimeMs,
    });
  }

  return outputs;
}

async function runSymbolValidation(params: {
  candleFetchService: CandleFetchService;
  levelEngine: LevelEngine;
  providerName: CandleProviderName;
  symbol: string;
  lookbacks: Record<CandleTimeframe, number>;
  windowCount: number;
  stepMs: number;
  forwardHorizonBars: number;
  futureBufferBars: number;
}): Promise<SymbolLevelValidationBatchResult> {
  const healthReports = await collectHealthReports(
    params.candleFetchService,
    params.symbol,
    params.providerName,
    params.lookbacks,
  );

  console.log(`[LevelValidation] Candle source health for ${params.symbol}`);
  for (const report of healthReports) {
    console.log(formatCandleSourceHealthReport(report));
  }

  if (
    healthReports.some(
      (report) =>
        (report.timeframe === "daily" || report.timeframe === "4h") &&
        report.status === "unavailable",
    )
  ) {
    return {
      symbol: params.symbol,
      healthReports,
      errorMessage: "provider unavailable",
    };
  }

  const outputs = await buildPersistenceOutputs({
    symbol: params.symbol,
    providerName: params.providerName,
    lookbacks: params.lookbacks,
    windowCount: params.windowCount,
    stepMs: params.stepMs,
    levelEngine: params.levelEngine,
  });
  const persistenceReport = validateLevelPersistence(outputs);
  for (const line of formatLevelPersistenceReport(persistenceReport)) {
    console.log(`${line} | symbol=${params.symbol}`);
  }

  const forwardHorizonMs = params.forwardHorizonBars * 5 * 60 * 1000;
  const generationEndTimeMs = Date.now() - forwardHorizonMs;
  const forwardOutput = await params.levelEngine.generateLevels({
    symbol: params.symbol,
    historicalRequests: buildHistoricalRequests(
      params.symbol,
      params.providerName,
      generationEndTimeMs,
      params.lookbacks,
    ),
  });
  const normalizedForwardOutput: LevelEngineOutput = {
    ...forwardOutput,
    generatedAt: generationEndTimeMs,
  };
  let futureCandles;
  try {
    const futureResponse = await params.candleFetchService.fetchCandles({
      symbol: params.symbol,
      timeframe: "5m",
      lookbackBars: params.forwardHorizonBars + params.futureBufferBars,
      endTimeMs: Date.now(),
      preferredProvider: params.providerName,
    });
    futureCandles = futureResponse.candles.filter(
      (candle) => candle.timestamp > generationEndTimeMs,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      symbol: params.symbol,
      healthReports,
      persistenceReport,
      errorMessage: `forward validation unavailable: ${message}`,
    };
  }

  if (futureCandles.length === 0) {
    return {
      symbol: params.symbol,
      healthReports,
      persistenceReport,
      errorMessage: "no future 5m candles after generation window",
    };
  }

  const forwardReactionReport = validateForwardReactions({
    output: normalizedForwardOutput,
    futureCandles,
  });
  for (const line of formatForwardReactionReport(forwardReactionReport)) {
    console.log(`${line} | symbol=${params.symbol}`);
  }

  return {
    symbol: params.symbol,
    healthReports,
    persistenceReport,
    forwardReactionReport,
  };
}

async function main(): Promise<void> {
  const symbols = resolveSymbols();
  const providerName = resolveProviderName();
  const windowCount = resolvePositiveInteger(process.env.LEVEL_VALIDATION_WINDOWS, DEFAULT_WINDOW_COUNT);
  const stepMinutes = resolvePositiveInteger(
    process.env.LEVEL_VALIDATION_STEP_MINUTES,
    DEFAULT_STEP_MINUTES,
  );
  const forwardHorizonBars = resolvePositiveInteger(
    process.env.LEVEL_VALIDATION_FORWARD_HORIZON_BARS,
    DEFAULT_FORWARD_HORIZON_BARS,
  );
  const futureBufferBars = resolvePositiveInteger(
    process.env.LEVEL_VALIDATION_FUTURE_BUFFER_BARS,
    DEFAULT_FUTURE_BUFFER_BARS,
  );
  const lookbacks = resolveValidationLookbacks();
  const ibkrTimeoutMs = resolveOptionalPositiveInteger(process.env.LEVEL_VALIDATION_IBKR_TIMEOUT_MS);
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
      ibkrTimeoutMs,
    });
    const baseFetchService = new CandleFetchService(provider);
    const { candleFetchService, cacheMode, cacheDirectoryPath } =
      createValidationCandleFetchService(baseFetchService);
    const levelEngine = new LevelEngine(candleFetchService);

    console.log(`[LevelValidation] Active provider path: ${provider.providerName}`);
    console.log(
      `[LevelValidation] Candle cache | mode=${cacheMode} | dir=${cacheDirectoryPath}`,
    );
    console.log(
      `[LevelValidation] Lookbacks | daily=${lookbacks.daily} | 4h=${lookbacks["4h"]} | 5m=${lookbacks["5m"]}`,
    );
    console.log(
      `[LevelValidation] Batch config | symbols=${symbols.join(",")} | windows=${windowCount} | stepMinutes=${stepMinutes} | forwardHorizonBars=${forwardHorizonBars}`,
    );
    if (providerName === "ibkr" && ibkrTimeoutMs) {
      console.log(`[LevelValidation] IBKR historical timeout | ms=${ibkrTimeoutMs}`);
    }
    if (providerName === "ibkr" && cacheMode !== "replay" && symbols.length > RECOMMENDED_LIVE_BATCH_SIZE) {
      console.warn(
        `[LevelValidation] Live IBKR batches are fastest in groups of ${RECOMMENDED_LIVE_BATCH_SIZE} or fewer symbols. Current batch size is ${symbols.length}.`,
      );
    }

    const results: SymbolLevelValidationBatchResult[] = [];

    for (const symbol of symbols) {
      console.log(`[LevelValidation] Running batch validation for ${symbol}`);
      try {
        results.push(
          await runSymbolValidation({
            candleFetchService,
            levelEngine,
            providerName,
            symbol,
            lookbacks,
            windowCount,
            stepMs,
            forwardHorizonBars,
            futureBufferBars,
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          symbol,
          healthReports: [],
          errorMessage: message,
        });
        console.error(`[LevelValidation] Symbol ${symbol} failed: ${message}`);
      }
    }

    const summary = summarizeLevelValidationBatch(results);
    for (const line of formatLevelValidationBatchSummary(summary)) {
      console.log(line);
    }

    if (summary.failedSymbols > 0 || summary.unavailableSymbols > 0) {
      process.exitCode = 1;
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
