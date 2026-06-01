import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LEVEL_ENGINE_ELIGIBLE_TIMEFRAMES,
  PROVIDER_CANDLE_TIMEFRAMES,
  isLevelEngineEligibleTimeframe,
} from "../lib/market-data/candle-types.js";
import {
  buildHistoricalFetchPlan,
  buildProviderHistoricalFetchPlan,
} from "../lib/market-data/fetch-planning.js";
import {
  collectFifteenMinuteValidationCache,
  createDefaultFifteenMinuteValidationCacheFetcher,
  deriveFifteenMinuteValidationCachePath,
  type FifteenMinuteValidationCacheFetchRequest,
  type FifteenMinuteValidationCacheProviderResponse,
} from "../scripts/collect-15m-validation-cache.js";
import { inspectFifteenMinuteCacheCoverage } from "../scripts/inspect-15m-cache-coverage.js";
import type { Candle } from "../lib/market-data/candle-types.js";

const END_TIME_MS = Date.parse("2026-06-01T16:00:00Z");

function tempCacheRoot(): string {
  return mkdtempSync(join(tmpdir(), "15m-live-provider-hookup-"));
}

function sampleCandles(count = 4): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: END_TIME_MS - (count - 1 - index) * 15 * 60 * 1000,
    open: 7 + index * 0.1,
    high: 7.2 + index * 0.1,
    low: 6.9 + index * 0.1,
    close: 7.1 + index * 0.1,
    volume: 10_000 + index * 500,
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
    sessionMetadataAvailable: false,
    providerMetadata: {
      source: "test_fake_15m_provider",
    },
    actualBarsReturned: candles.length,
    completenessStatus: candles.length >= request.lookbackBars ? "complete" : "partial",
    stale: false,
    validationIssues: [],
    sessionSummary: null,
  };
}

test("provider capability supports 15m while LevelEngine eligibility excludes it", () => {
  assert.equal(PROVIDER_CANDLE_TIMEFRAMES.includes("15m"), true);
  assert.equal(LEVEL_ENGINE_ELIGIBLE_TIMEFRAMES.includes("15m" as any), false);
  assert.equal(isLevelEngineEligibleTimeframe("15m"), false);
  assert.equal(isLevelEngineEligibleTimeframe("5m"), true);
  assert.deepEqual([...LEVEL_ENGINE_ELIGIBLE_TIMEFRAMES], ["daily", "4h", "5m"]);
});

test("provider fetch planning maps 15m without changing existing timeframe plans", () => {
  const fifteenMinutePlan = buildProviderHistoricalFetchPlan(
    {
      symbol: "DEVS",
      timeframe: "15m",
      lookbackBars: 100,
      endTimeMs: END_TIME_MS,
    },
    "ibkr",
  );

  assert.equal(fifteenMinutePlan.timeframe, "15m");
  assert.equal(fifteenMinutePlan.intervalMs, 15 * 60 * 1000);
  assert.equal(fifteenMinutePlan.providerRequest.barSizeSetting, "15 mins");
  assert.equal(fifteenMinutePlan.providerRequest.interval, "15min");
  assert.equal(fifteenMinutePlan.providerRequest.outputSize, 160);
  assert.equal(fifteenMinutePlan.sessionMetadataAvailable, false);

  const fiveMinutePlan = buildHistoricalFetchPlan(
    {
      symbol: "DEVS",
      timeframe: "5m",
      lookbackBars: 100,
      endTimeMs: END_TIME_MS,
    },
    "ibkr",
  );
  const fourHourPlan = buildHistoricalFetchPlan(
    {
      symbol: "DEVS",
      timeframe: "4h",
      lookbackBars: 100,
      endTimeMs: END_TIME_MS,
    },
    "ibkr",
  );
  const dailyPlan = buildHistoricalFetchPlan(
    {
      symbol: "DEVS",
      timeframe: "daily",
      lookbackBars: 100,
      endTimeMs: END_TIME_MS,
    },
    "ibkr",
  );

  assert.equal(fiveMinutePlan.providerRequest.barSizeSetting, "5 mins");
  assert.equal(fiveMinutePlan.providerRequest.interval, "5min");
  assert.equal(fiveMinutePlan.providerRequest.outputSize, 160);
  assert.equal(fourHourPlan.providerRequest.barSizeSetting, "4 hours");
  assert.equal(fourHourPlan.providerRequest.interval, "4h");
  assert.equal(dailyPlan.providerRequest.barSizeSetting, "1 day");
  assert.equal(dailyPlan.providerRequest.interval, "1day");
});

test("15m collection dry-run constructs no live provider and writes no files", async () => {
  const cacheRoot = tempCacheRoot();
  const result = await collectFifteenMinuteValidationCache({
    cacheRoot,
    symbols: ["TEST"],
    provider: "ibkr",
    lookbackBars: 100,
    endTimeMs: END_TIME_MS,
    mode: "dry_run",
    runtimeEnv: {
      LEVEL_15M_CACHE_IBKR_PORT: "not-a-number",
    },
  });
  const plannedPath = deriveFifteenMinuteValidationCachePath({
    cacheRoot,
    provider: "ibkr",
    symbol: "TEST",
    lookbackBars: 100,
    endTimeMs: END_TIME_MS,
  });

  assert.equal(result.summary.dryRun, true);
  assert.equal(result.summary.plannedCount, 1);
  assert.equal(result.summary.writtenCount, 0);
  assert.equal(result.summary.failedCount, 0);
  assert.equal(existsSync(plannedPath), false);
});

test("15m collection write mode remains fake-provider testable and inspection compatible", async () => {
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
  const wrapper = JSON.parse(readFileSync(item.outputPath, "utf8"));
  const coverage = inspectFifteenMinuteCacheCoverage({
    cacheRoot,
    generatedAt: "2026-06-01T00:00:00.000Z",
  });

  assert.equal(result.summary.writtenCount, 1);
  assert.equal(item.status, "written");
  assert.equal(wrapper.request.timeframe, "15m");
  assert.equal(wrapper.response.timeframe, "15m");
  assert.deepEqual(wrapper.response.candles, sampleCandles());
  assert.equal(coverage.timeframeJsonFileCounts["15m"], 1);
  assert.deepEqual(coverage.symbolsWith15m, ["stub/QUBT"]);
});

test("live provider config failures are explicit and write no files", async () => {
  const ibkrCacheRoot = tempCacheRoot();
  const ibkrResult = await collectFifteenMinuteValidationCache({
    cacheRoot: ibkrCacheRoot,
    symbols: ["DEVS"],
    provider: "ibkr",
    lookbackBars: 100,
    endTimeMs: END_TIME_MS,
    mode: "write",
    runtimeEnv: {},
  });
  const ibkrPath = deriveFifteenMinuteValidationCachePath({
    cacheRoot: ibkrCacheRoot,
    provider: "ibkr",
    symbol: "DEVS",
    lookbackBars: 100,
    endTimeMs: END_TIME_MS,
  });

  assert.equal(ibkrResult.summary.failedCount, 1);
  assert.match(ibkrResult.items[0]?.error ?? "", /LEVEL_15M_CACHE_ENABLE_IBKR=true/);
  assert.equal(existsSync(ibkrPath), false);

  const twelveDataCacheRoot = tempCacheRoot();
  const twelveDataResult = await collectFifteenMinuteValidationCache({
    cacheRoot: twelveDataCacheRoot,
    symbols: ["DXYZ"],
    provider: "twelve_data",
    lookbackBars: 100,
    endTimeMs: END_TIME_MS,
    mode: "write",
    runtimeEnv: {},
  });
  const twelveDataPath = deriveFifteenMinuteValidationCachePath({
    cacheRoot: twelveDataCacheRoot,
    provider: "twelve_data",
    symbol: "DXYZ",
    lookbackBars: 100,
    endTimeMs: END_TIME_MS,
  });

  assert.equal(twelveDataResult.summary.failedCount, 1);
  assert.match(twelveDataResult.items[0]?.error ?? "", /TWELVE_DATA_API_KEY/);
  assert.equal(existsSync(twelveDataPath), false);
});

test("default provider fetcher exposes clear preflight config errors", async () => {
  await assert.rejects(
    () => createDefaultFifteenMinuteValidationCacheFetcher("ibkr", {}),
    /LEVEL_15M_CACHE_ENABLE_IBKR=true/,
  );
  await assert.rejects(
    () => createDefaultFifteenMinuteValidationCacheFetcher("twelve_data", {}),
    /TWELVE_DATA_API_KEY/,
  );
});

test("15m live provider hookup source stays out of LevelEngine alert monitoring and journal paths", () => {
  const files = [
    "src/scripts/collect-15m-validation-cache.ts",
    "src/lib/market-data/fetch-planning.ts",
    "src/lib/market-data/candle-types.ts",
  ];
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

  for (const file of files) {
    const source = readFileSync(join(process.cwd(), file), "utf8").toLowerCase();
    for (const term of forbidden) {
      assert.equal(source.includes(term), false, `${file} should not contain ${term}`);
    }
  }
});
