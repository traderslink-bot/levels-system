import { join } from "node:path";

import { CandleFetchService } from "../../lib/market-data/candle-fetch-service.js";
import type { CandleProviderName } from "../../lib/market-data/candle-types.js";
import type {
  HistoricalCandleProvider,
  HistoricalFetchPlan,
  HistoricalFetchRequest,
} from "../../lib/market-data/provider-types.js";
import {
  ValidationCachedCandleFetchService,
  resolveValidationCandleCacheMode,
  type ValidationCandleCacheMode,
} from "../../lib/validation/validation-candle-cache.js";

export type ValidationCandleCacheRuntime = {
  candleFetchService: CandleFetchService;
  cacheMode: ValidationCandleCacheMode;
  cacheDirectoryPath: string;
};

export function createReplayOnlyHistoricalProvider(
  providerName: CandleProviderName,
): HistoricalCandleProvider {
  return {
    providerName,
    async fetchCandles(
      request: HistoricalFetchRequest,
      _plan: HistoricalFetchPlan,
    ) {
      throw new Error(
        `Validation replay cache miss for ${request.symbol.toUpperCase()} ${request.timeframe}; ${providerName} provider fetch is disabled in replay mode.`,
      );
    },
  };
}

export function createValidationCandleFetchService(
  candleFetchService: CandleFetchService,
): ValidationCandleCacheRuntime {
  const cacheMode = resolveValidationCandleCacheMode(process.env.LEVEL_VALIDATION_CACHE_MODE);
  const cacheDirectoryPath =
    process.env.LEVEL_VALIDATION_CACHE_DIR?.trim() ||
    join(process.cwd(), ".validation-cache", "candles");

  if (cacheMode === "off") {
    return {
      candleFetchService,
      cacheMode,
      cacheDirectoryPath,
    };
  }

  return {
    candleFetchService: new ValidationCachedCandleFetchService(candleFetchService, {
      cacheDirectoryPath,
      mode: cacheMode,
    }),
    cacheMode,
    cacheDirectoryPath,
  };
}
