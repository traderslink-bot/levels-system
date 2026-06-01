import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  collectFifteenMinuteValidationCache,
  deriveFifteenMinuteValidationCachePath,
  formatCollectFifteenMinuteValidationCacheSummary,
  parseCollectFifteenMinuteValidationCacheArgs,
  parseFifteenMinuteCacheSymbols,
  type FifteenMinuteValidationCacheFetchRequest,
  type FifteenMinuteValidationCacheProviderResponse,
} from "../scripts/collect-15m-validation-cache.js";
import { inspectFifteenMinuteCacheCoverage } from "../scripts/inspect-15m-cache-coverage.js";
import type { Candle } from "../lib/market-data/candle-types.js";

const END_TIME_MS = Date.parse("2026-06-01T16:00:00Z");

function tempCacheRoot(): string {
  return mkdtempSync(join(tmpdir(), "collect-15m-cache-"));
}

function sampleCandles(count = 4): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: END_TIME_MS - (count - 1 - index) * 15 * 60 * 1000,
    open: 10 + index * 0.1,
    high: 10.2 + index * 0.1,
    low: 9.9 + index * 0.1,
    close: 10.1 + index * 0.1,
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
      source: "test_fake_provider",
    },
    actualBarsReturned: candles.length,
    completenessStatus: candles.length === 0 ? "empty" : "complete",
    stale: false,
    validationIssues: [],
    sessionSummary: null,
  };
}

test("15m collection dry-run plans explicit output paths without writing files", async () => {
  const cacheRoot = tempCacheRoot();
  const result = await collectFifteenMinuteValidationCache({
    cacheRoot,
    symbols: ["devs", "ENVX"],
    provider: "ibkr",
    lookbackBars: 100,
    endTimeMs: END_TIME_MS,
    mode: "dry_run",
    generatedAt: "2026-06-01T00:00:00.000Z",
    fetcher: async () => {
      throw new Error("dry-run should not fetch");
    },
  });

  assert.equal(result.summary.dryRun, true);
  assert.equal(result.summary.write, false);
  assert.equal(result.summary.plannedCount, 2);
  assert.equal(result.summary.writtenCount, 0);
  assert.deepEqual(
    result.items.map((item) => item.status),
    ["planned", "planned"],
  );
  for (const item of result.items) {
    assert.equal(item.outputPath.includes(`${join("ibkr", item.symbol, "15m")}`), true);
    assert.equal(existsSync(item.outputPath), false);
  }
});

test("15m collection write mode writes validation-cache wrapper files with a fake provider", async () => {
  const cacheRoot = tempCacheRoot();
  const result = await collectFifteenMinuteValidationCache({
    cacheRoot,
    symbols: ["QUBT"],
    provider: "stub",
    lookbackBars: 4,
    endTimeMs: END_TIME_MS,
    mode: "write",
    generatedAt: "2026-06-01T00:00:00.000Z",
    fetcher: async (request) => responseFor(request),
  });
  const item = result.items[0]!;

  assert.equal(result.summary.writtenCount, 1);
  assert.equal(item.status, "written");
  assert.equal(existsSync(item.outputPath), true);
  const wrapper = JSON.parse(readFileSync(item.outputPath, "utf8"));
  assert.equal(wrapper.schemaVersion, 1);
  assert.equal(wrapper.cachedAt, Date.parse("2026-06-01T00:00:00.000Z"));
  assert.deepEqual(wrapper.request, {
    symbol: "QUBT",
    timeframe: "15m",
    lookbackBars: 4,
    endTimeMs: END_TIME_MS,
    provider: "stub",
  });
  assert.equal(wrapper.response.timeframe, "15m");
  assert.equal(wrapper.response.provider, "stub");
  assert.deepEqual(wrapper.response.candles, sampleCandles());
});

test("15m collection skips existing files by default and preserves deterministic paths", async () => {
  const cacheRoot = tempCacheRoot();
  const outputPath = deriveFifteenMinuteValidationCachePath({
    cacheRoot,
    provider: "stub",
    symbol: "GME",
    lookbackBars: 4,
    endTimeMs: END_TIME_MS,
  });
  const sentinel = "{\"sentinel\":true}\n";
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, sentinel, "utf8");
  let fetchCount = 0;

  const result = await collectFifteenMinuteValidationCache({
    cacheRoot,
    symbols: ["GME"],
    provider: "stub",
    lookbackBars: 4,
    endTimeMs: END_TIME_MS,
    mode: "write",
    generatedAt: "2026-06-01T00:00:00.000Z",
    fetcher: async (request) => {
      fetchCount += 1;
      return responseFor(request);
    },
  });

  assert.equal(fetchCount, 0);
  assert.equal(result.summary.skippedExistingCount, 1);
  assert.equal(result.items[0]?.status, "skipped_existing");
  assert.equal(readFileSync(outputPath, "utf8"), sentinel);
});

test("15m collection records empty responses and provider failures without stopping other symbols", async () => {
  const cacheRoot = tempCacheRoot();
  const result = await collectFifteenMinuteValidationCache({
    cacheRoot,
    symbols: ["OKAY", "EMPTY", "FAIL"],
    provider: "stub",
    lookbackBars: 4,
    endTimeMs: END_TIME_MS,
    mode: "write",
    generatedAt: "2026-06-01T00:00:00.000Z",
    fetcher: async (request) => {
      if (request.symbol === "EMPTY") {
        return responseFor(request, []);
      }
      if (request.symbol === "FAIL") {
        throw new Error("provider unavailable");
      }
      return responseFor(request);
    },
  });

  assert.equal(result.summary.writtenCount, 1);
  assert.equal(result.summary.failedCount, 2);
  assert.equal(result.items.find((item) => item.symbol === "OKAY")?.status, "written");
  assert.equal(result.items.find((item) => item.symbol === "EMPTY")?.error, "Provider returned zero 15m candles.");
  assert.equal(result.items.find((item) => item.symbol === "FAIL")?.error, "provider unavailable");
});

test("15m collection rejects malformed symbol lists and conflicting modes", () => {
  assert.throws(() => parseFifteenMinuteCacheSymbols("DEVS, bad symbol"), /Invalid symbol/);
  assert.throws(
    () =>
      parseCollectFifteenMinuteValidationCacheArgs([
        "--cache-root",
        "cache",
        "--symbols",
        "DEVS",
        "--provider",
        "ibkr",
        "--lookback-bars",
        "100",
        "--end-time",
        "2026-06-01T16:00:00Z",
        "--dry-run",
        "--write",
      ]),
    /either --dry-run or --write/,
  );
});

test("15m collection output is compatible with cache coverage inspection", async () => {
  const cacheRoot = tempCacheRoot();
  await collectFifteenMinuteValidationCache({
    cacheRoot,
    symbols: ["DXYZ"],
    provider: "stub",
    lookbackBars: 4,
    endTimeMs: END_TIME_MS,
    mode: "write",
    generatedAt: "2026-06-01T00:00:00.000Z",
    fetcher: async (request) => responseFor(request),
  });

  const coverage = inspectFifteenMinuteCacheCoverage({
    cacheRoot,
    generatedAt: "2026-06-01T00:00:00.000Z",
  });

  assert.equal(coverage.groupsWithAny15m, 1);
  assert.deepEqual(coverage.symbolsWith15m, ["stub/DXYZ"]);
  assert.equal(coverage.timeframeJsonFileCounts["15m"], 1);
});

test("15m collection formatter exposes compact operational summary", async () => {
  const cacheRoot = tempCacheRoot();
  const result = await collectFifteenMinuteValidationCache({
    cacheRoot,
    symbols: ["DEVS"],
    provider: "ibkr",
    lookbackBars: 100,
    endTimeMs: END_TIME_MS,
    mode: "dry_run",
    generatedAt: "2026-06-01T00:00:00.000Z",
  });

  const text = formatCollectFifteenMinuteValidationCacheSummary(result);
  assert.match(text, /15m validation cache collection/);
  assert.match(text, /Mode: dry-run/);
  assert.match(text, /DEVS: planned/);
});
