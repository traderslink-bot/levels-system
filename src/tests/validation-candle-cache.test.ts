import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { HistoricalFetchRequest } from "../lib/market-data/candle-fetch-service.js";
import type { CandleProviderResponse } from "../lib/market-data/candle-types.js";
import {
  ValidationCachedCandleFetchService,
  resolveValidationCandleCacheMode,
} from "../lib/validation/validation-candle-cache.js";

function buildResponse(): CandleProviderResponse {
  return {
    provider: "stub",
    symbol: "GXAI",
    timeframe: "5m",
    requestedLookbackBars: 20,
    candles: [
      {
        timestamp: Date.parse("2026-04-16T14:00:00Z"),
        open: 1.4,
        high: 1.45,
        low: 1.39,
        close: 1.44,
        volume: 1000,
      },
    ],
    fetchStartTimestamp: 1,
    fetchEndTimestamp: 2,
    requestedStartTimestamp: 3,
    requestedEndTimestamp: 4,
    sessionMetadataAvailable: true,
    actualBarsReturned: 1,
    completenessStatus: "complete",
    stale: false,
    validationIssues: [],
    sessionSummary: null,
  };
}

test("ValidationCachedCandleFetchService writes through on first fetch and reuses cache on second fetch", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "validation-candle-cache-"));
  const response = buildResponse();
  const request: HistoricalFetchRequest = {
    symbol: "gxai",
    timeframe: "5m",
    lookbackBars: 20,
    endTimeMs: Date.parse("2026-04-16T14:05:00Z"),
  };
  let callCount = 0;
  const delegate = {
    getProviderName: () => "stub" as const,
    fetchCandles: async () => {
      callCount += 1;
      return response;
    },
  };

  const service = new ValidationCachedCandleFetchService(delegate, {
    cacheDirectoryPath: tempDir,
    mode: "read_write",
  });

  const first = await service.fetchCandles(request);
  const second = await service.fetchCandles(request);

  assert.equal(callCount, 1);
  const normalizedEndTime = Math.floor(request.endTimeMs! / (5 * 60 * 1000)) * 5 * 60 * 1000;
  assert.equal(first.provider, response.provider);
  assert.deepEqual(first.candles, response.candles);
  assert.equal(first.requestedEndTimestamp, normalizedEndTime);
  assert.equal(first.requestedStartTimestamp, normalizedEndTime - request.lookbackBars * 5 * 60 * 1000);
  assert.deepEqual(second, first);

  const cachePath = join(tempDir, "stub", "GXAI", "5m", `20-${normalizedEndTime}.json`);
  assert.equal(existsSync(cachePath), true);
  const cachedFiles = readFileSync(cachePath, "utf8");
  assert.ok(cachedFiles.includes('"provider": "stub"'));
});

test("ValidationCachedCandleFetchService replay mode errors on cache miss", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "validation-candle-cache-"));
  const request: HistoricalFetchRequest = {
    symbol: "GXAI",
    timeframe: "daily",
    lookbackBars: 40,
    endTimeMs: Date.parse("2026-04-16T00:00:00Z"),
  };
  const delegate = {
    getProviderName: () => "stub" as const,
    fetchCandles: async () => buildResponse(),
  };
  const service = new ValidationCachedCandleFetchService(delegate, {
    cacheDirectoryPath: tempDir,
    mode: "replay",
  });

  await assert.rejects(
    service.fetchCandles(request),
    /Validation candle cache miss/,
  );
});

test("ValidationCachedCandleFetchService reuses the nearest prior cached file within one bar", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "validation-candle-cache-"));
  const response = buildResponse();
  const baseRequest: HistoricalFetchRequest = {
    symbol: "GXAI",
    timeframe: "5m",
    lookbackBars: 20,
    endTimeMs: Date.parse("2026-04-16T14:05:00Z"),
  };
  const laterRequest: HistoricalFetchRequest = {
    ...baseRequest,
    endTimeMs: Date.parse("2026-04-16T14:10:00Z"),
  };
  let callCount = 0;
  const delegate = {
    getProviderName: () => "stub" as const,
    fetchCandles: async () => {
      callCount += 1;
      return response;
    },
  };

  const service = new ValidationCachedCandleFetchService(delegate, {
    cacheDirectoryPath: tempDir,
    mode: "read_write",
  });

  await service.fetchCandles(baseRequest);
  const reused = await service.fetchCandles(laterRequest);

  assert.equal(callCount, 1);
  assert.equal(
    reused.requestedEndTimestamp,
    Math.floor(laterRequest.endTimeMs! / (5 * 60 * 1000)) * 5 * 60 * 1000,
  );
  assert.equal(
    reused.requestedStartTimestamp,
    reused.requestedEndTimestamp - laterRequest.lookbackBars * 5 * 60 * 1000,
  );
});

test("ValidationCachedCandleFetchService replay mode can reuse the nearest prior cached file within one bar", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "validation-candle-cache-"));
  const response = buildResponse();
  const baseRequest: HistoricalFetchRequest = {
    symbol: "GXAI",
    timeframe: "5m",
    lookbackBars: 20,
    endTimeMs: Date.parse("2026-04-16T14:05:00Z"),
  };
  const laterRequest: HistoricalFetchRequest = {
    ...baseRequest,
    endTimeMs: Date.parse("2026-04-16T14:10:00Z"),
  };
  const writer = new ValidationCachedCandleFetchService(
    {
      getProviderName: () => "stub" as const,
      fetchCandles: async () => response,
    },
    {
      cacheDirectoryPath: tempDir,
      mode: "read_write",
    },
  );
  await writer.fetchCandles(baseRequest);

  const replayService = new ValidationCachedCandleFetchService(
    {
      getProviderName: () => "stub" as const,
      fetchCandles: async () => {
        throw new Error("delegate should not be called in replay mode");
      },
    },
    {
      cacheDirectoryPath: tempDir,
      mode: "replay",
    },
  );

  const reused = await replayService.fetchCandles(laterRequest);
  assert.equal(
    reused.requestedEndTimestamp,
    Math.floor(laterRequest.endTimeMs! / (5 * 60 * 1000)) * 5 * 60 * 1000,
  );
});

test("ValidationCachedCandleFetchService can reuse a larger-lookback cached file when the exact lookback is missing", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "validation-candle-cache-"));
  const response = buildResponse();
  const largerRequest: HistoricalFetchRequest = {
    symbol: "GXAI",
    timeframe: "5m",
    lookbackBars: 30,
    endTimeMs: Date.parse("2026-04-16T14:05:00Z"),
  };
  const smallerRequest: HistoricalFetchRequest = {
    ...largerRequest,
    lookbackBars: 20,
  };

  const writer = new ValidationCachedCandleFetchService(
    {
      getProviderName: () => "stub" as const,
      fetchCandles: async () => response,
    },
    {
      cacheDirectoryPath: tempDir,
      mode: "read_write",
    },
  );
  await writer.fetchCandles(largerRequest);

  const replayService = new ValidationCachedCandleFetchService(
    {
      getProviderName: () => "stub" as const,
      fetchCandles: async () => {
        throw new Error("delegate should not be called when larger cache is reusable");
      },
    },
    {
      cacheDirectoryPath: tempDir,
      mode: "replay",
    },
  );

  const reused = await replayService.fetchCandles(smallerRequest);
  const normalizedEndTime = Math.floor(smallerRequest.endTimeMs! / (5 * 60 * 1000)) * 5 * 60 * 1000;
  assert.equal(reused.requestedLookbackBars, smallerRequest.lookbackBars);
  assert.equal(reused.requestedEndTimestamp, normalizedEndTime);
  assert.equal(
    reused.requestedStartTimestamp,
    normalizedEndTime - smallerRequest.lookbackBars * 5 * 60 * 1000,
  );
});

test("ValidationCachedCandleFetchService replay mode can reuse the latest prior cached file even when older than one bar", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "validation-candle-cache-"));
  const response = buildResponse();
  const cachedRequest: HistoricalFetchRequest = {
    symbol: "GXAI",
    timeframe: "5m",
    lookbackBars: 20,
    endTimeMs: Date.parse("2026-04-16T14:05:00Z"),
  };
  const muchLaterRequest: HistoricalFetchRequest = {
    ...cachedRequest,
    endTimeMs: Date.parse("2026-04-16T14:40:00Z"),
  };

  const writer = new ValidationCachedCandleFetchService(
    {
      getProviderName: () => "stub" as const,
      fetchCandles: async () => response,
    },
    {
      cacheDirectoryPath: tempDir,
      mode: "read_write",
    },
  );
  await writer.fetchCandles(cachedRequest);

  const replayService = new ValidationCachedCandleFetchService(
    {
      getProviderName: () => "stub" as const,
      fetchCandles: async () => {
        throw new Error("delegate should not be called when replay can reuse older cache");
      },
    },
    {
      cacheDirectoryPath: tempDir,
      mode: "replay",
    },
  );

  const reused = await replayService.fetchCandles(muchLaterRequest);
  const normalizedEndTime = Math.floor(muchLaterRequest.endTimeMs! / (5 * 60 * 1000)) * 5 * 60 * 1000;
  assert.equal(reused.requestedEndTimestamp, normalizedEndTime);
});

test("resolveValidationCandleCacheMode defaults to read_write for unknown values", () => {
  assert.equal(resolveValidationCandleCacheMode(undefined), "read_write");
  assert.equal(resolveValidationCandleCacheMode("replay"), "replay");
  assert.equal(resolveValidationCandleCacheMode("something-else"), "read_write");
});
