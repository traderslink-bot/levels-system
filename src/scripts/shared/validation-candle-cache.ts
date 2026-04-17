import { join } from "node:path";

import { CandleFetchService } from "../../lib/market-data/candle-fetch-service.js";
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
