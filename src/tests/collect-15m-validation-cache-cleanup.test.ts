import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import {
  collectFifteenMinuteValidationCache,
  deriveFifteenMinuteValidationCachePath,
  type FifteenMinuteValidationCacheFetchRequest,
  type FifteenMinuteValidationCacheProviderResponse,
} from "../scripts/collect-15m-validation-cache.js";

const END_TIME_MS = Date.parse("2026-06-01T16:00:00Z");

function tempCacheRoot(): string {
  return mkdtempSync(join(tmpdir(), "collect-15m-cache-cleanup-"));
}

function sampleCandles(count = 4): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: END_TIME_MS - (count - 1 - index) * 15 * 60 * 1000,
    open: 11 + index * 0.1,
    high: 11.2 + index * 0.1,
    low: 10.9 + index * 0.1,
    close: 11.1 + index * 0.1,
    volume: 1000 + index * 100,
  }));
}

function responseFor(
  request: FifteenMinuteValidationCacheFetchRequest,
  candles = sampleCandles(),
): FifteenMinuteValidationCacheProviderResponse {
  return {
    provider: request.provider,
    symbol: request.symbol,
    timeframe: "15m",
    requestedLookbackBars: request.lookbackBars,
    candles,
    fetchStartTimestamp: 1,
    fetchEndTimestamp: 2,
    requestedStartTimestamp: request.endTimeMs - request.lookbackBars * 15 * 60 * 1000,
    requestedEndTimestamp: request.endTimeMs,
    sessionMetadataAvailable: true,
    providerMetadata: {
      source: "test_cleanup_provider",
    },
    actualBarsReturned: candles.length,
    completenessStatus: candles.length === 0 ? "empty" : "complete",
    stale: false,
    validationIssues: [],
    sessionSummary: null,
  };
}

test("15m collection calls cleanup once after successful write", async () => {
  const cacheRoot = tempCacheRoot();
  let fetchCount = 0;
  let cleanupCount = 0;

  const result = await collectFifteenMinuteValidationCache({
    cacheRoot,
    symbols: ["DEVS", "ENVX"],
    provider: "stub",
    lookbackBars: 4,
    endTimeMs: END_TIME_MS,
    mode: "write",
    generatedAt: "2026-06-01T00:00:00.000Z",
    fetcher: async (request) => {
      fetchCount += 1;
      return responseFor(request);
    },
    fetcherCleanup: () => {
      cleanupCount += 1;
    },
  });

  assert.equal(fetchCount, 2);
  assert.equal(cleanupCount, 1);
  assert.equal(result.summary.writtenCount, 2);
  assert.equal(result.summary.failedCount, 0);
});

test("15m collection calls cleanup once after partial provider failure", async () => {
  const cacheRoot = tempCacheRoot();
  let cleanupCount = 0;

  const result = await collectFifteenMinuteValidationCache({
    cacheRoot,
    symbols: ["OKAY", "FAIL"],
    provider: "stub",
    lookbackBars: 4,
    endTimeMs: END_TIME_MS,
    mode: "write",
    generatedAt: "2026-06-01T00:00:00.000Z",
    fetcher: async (request) => {
      if (request.symbol === "FAIL") {
        throw new Error("provider unavailable");
      }
      return responseFor(request);
    },
    fetcherCleanup: () => {
      cleanupCount += 1;
    },
  });

  assert.equal(cleanupCount, 1);
  assert.equal(result.summary.writtenCount, 1);
  assert.equal(result.summary.failedCount, 1);
  assert.equal(result.items.find((item) => item.symbol === "FAIL")?.error, "provider unavailable");
});

test("15m collection calls cleanup after zero-candle provider failure", async () => {
  const cacheRoot = tempCacheRoot();
  let cleanupCount = 0;

  const result = await collectFifteenMinuteValidationCache({
    cacheRoot,
    symbols: ["EMPTY"],
    provider: "stub",
    lookbackBars: 4,
    endTimeMs: END_TIME_MS,
    mode: "write",
    generatedAt: "2026-06-01T00:00:00.000Z",
    fetcher: async (request) => responseFor(request, []),
    fetcherCleanup: () => {
      cleanupCount += 1;
    },
  });

  assert.equal(cleanupCount, 1);
  assert.equal(result.summary.writtenCount, 0);
  assert.equal(result.summary.failedCount, 1);
  assert.equal(result.items[0]?.error, "Provider returned zero 15m candles.");
});

test("15m collection dry-run does not construct provider or call cleanup", async () => {
  const cacheRoot = tempCacheRoot();
  let fetchCount = 0;
  let cleanupCount = 0;

  const result = await collectFifteenMinuteValidationCache({
    cacheRoot,
    symbols: ["DEVS"],
    provider: "ibkr",
    lookbackBars: 100,
    endTimeMs: END_TIME_MS,
    mode: "dry_run",
    generatedAt: "2026-06-01T00:00:00.000Z",
    fetcher: async (request) => {
      fetchCount += 1;
      return responseFor(request);
    },
    fetcherCleanup: () => {
      cleanupCount += 1;
    },
  });

  assert.equal(fetchCount, 0);
  assert.equal(cleanupCount, 0);
  assert.equal(result.summary.plannedCount, 1);
});

test("15m collection all-existing write skips before fetcher construction and cleanup", async () => {
  const cacheRoot = tempCacheRoot();
  const outputPath = deriveFifteenMinuteValidationCachePath({
    cacheRoot,
    provider: "ibkr",
    symbol: "GME",
    lookbackBars: 100,
    endTimeMs: END_TIME_MS,
  });
  const sentinel = "{\"sentinel\":true}\n";
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, sentinel, "utf8");
  let fetchCount = 0;
  let cleanupCount = 0;

  const result = await collectFifteenMinuteValidationCache({
    cacheRoot,
    symbols: ["GME"],
    provider: "ibkr",
    lookbackBars: 100,
    endTimeMs: END_TIME_MS,
    mode: "write",
    generatedAt: "2026-06-01T00:00:00.000Z",
    fetcher: async (request) => {
      fetchCount += 1;
      return responseFor(request);
    },
    fetcherCleanup: () => {
      cleanupCount += 1;
    },
    runtimeEnv: {
      LEVEL_15M_CACHE_ENABLE_IBKR: "true",
      LEVEL_15M_CACHE_IBKR_PORT: "not-a-number",
    },
  });

  assert.equal(fetchCount, 0);
  assert.equal(cleanupCount, 0);
  assert.equal(result.summary.skippedExistingCount, 1);
  assert.equal(result.items[0]?.status, "skipped_existing");
  assert.equal(readFileSync(outputPath, "utf8"), sentinel);
});

test("15m collection cleanup source stays out of LevelEngine alert monitoring and journal paths", () => {
  const source = readFileSync(
    join(process.cwd(), "src/scripts/collect-15m-validation-cache.ts"),
    "utf8",
  ).toLowerCase();
  const forbidden = [
    "../lib/levels",
    "../lib/alerts",
    "../lib/monitoring",
    "discord",
    "trader-context",
    "recommendation",
    "coaching",
    "trade advice",
    "giveback",
    "behavior score",
  ];

  for (const term of forbidden) {
    assert.equal(source.includes(term), false, `collector should not contain ${term}`);
  }
});

test("15m collection skip-only behavior leaves no target mutation when file exists", async () => {
  const cacheRoot = tempCacheRoot();
  const outputPath = deriveFifteenMinuteValidationCachePath({
    cacheRoot,
    provider: "ibkr",
    symbol: "DEVS",
    lookbackBars: 100,
    endTimeMs: END_TIME_MS,
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, "{\"existing\":true}\n", "utf8");
  const before = readFileSync(outputPath, "utf8");

  const result = await collectFifteenMinuteValidationCache({
    cacheRoot,
    symbols: ["DEVS"],
    provider: "ibkr",
    lookbackBars: 100,
    endTimeMs: END_TIME_MS,
    mode: "write",
    generatedAt: "2026-06-01T00:00:00.000Z",
    runtimeEnv: {
      LEVEL_15M_CACHE_ENABLE_IBKR: "true",
      LEVEL_15M_CACHE_IBKR_PORT: "not-a-number",
    },
  });

  assert.equal(result.summary.skippedExistingCount, 1);
  assert.equal(existsSync(outputPath), true);
  assert.equal(readFileSync(outputPath, "utf8"), before);
});
