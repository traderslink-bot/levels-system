import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import type { HistoricalFetchRequest } from "../lib/market-data/candle-fetch-service.js";
import type { Candle, CandleProviderResponse } from "../lib/market-data/candle-types.js";
import {
  collectJournalTradeContextFiveMinuteDayCache,
  createDefaultJournalTradeContextFiveMinuteDayCacheFetcherBundle,
  deriveJournalTradeContextFiveMinuteDayCachePath,
  formatCollectJournalTradeContextFiveMinuteDayCacheSummary,
  parseCollectJournalTradeContextFiveMinuteDayCacheArgs,
  parseJournalTradeContextFiveMinuteDayRequests,
} from "../scripts/collect-journal-trade-context-5m-day-cache.js";

const MORNING_TRADE = Date.parse("2026-06-01T09:42:00-04:00");
const AFTERNOON_TRADE = Date.parse("2026-06-01T14:30:00-04:00");
const NEXT_DAY_TRADE = Date.parse("2026-06-02T09:42:00-04:00");
const DAY_END = Date.parse("2026-06-02T00:00:00.000Z");

function tempCacheRoot(): string {
  return mkdtempSync(join(tmpdir(), "journal-5m-day-cache-"));
}

function sampleCandles(request: HistoricalFetchRequest, count = request.lookbackBars): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: request.endTimeMs! - (count - index) * 5 * 60 * 1000,
    open: 10 + index * 0.01,
    high: 10.1 + index * 0.01,
    low: 9.9 + index * 0.01,
    close: 10.05 + index * 0.01,
    volume: 100_000 + index * 100,
  }));
}

function responseFor(
  request: HistoricalFetchRequest,
  candles = sampleCandles(request),
): CandleProviderResponse {
  return {
    provider: request.preferredProvider ?? "stub",
    symbol: request.symbol,
    timeframe: "5m",
    requestedLookbackBars: request.lookbackBars,
    candles,
    fetchStartTimestamp: 1,
    fetchEndTimestamp: 2,
    requestedStartTimestamp: request.endTimeMs! - request.lookbackBars * 5 * 60 * 1000,
    requestedEndTimestamp: request.endTimeMs!,
    sessionMetadataAvailable: true,
    providerMetadata: {
      source: "test_fake_journal_5m_day_provider",
    },
    actualBarsReturned: candles.length,
    completenessStatus: candles.length === 0 ? "empty" : "complete",
    stale: false,
    validationIssues: [],
    sessionSummary: null,
  };
}

test("journal 5m day collection dry-run dedupes same symbol day without fetching", async () => {
  const cacheRoot = tempCacheRoot();
  const result = await collectJournalTradeContextFiveMinuteDayCache({
    cacheRoot,
    provider: "ibkr",
    requests: [
      { symbol: "devs", tradeContextTimestamp: MORNING_TRADE },
      { symbol: "DEVS", tradeContextTimestamp: AFTERNOON_TRADE },
      { symbol: "DEVS", tradeContextTimestamp: NEXT_DAY_TRADE },
    ],
    mode: "dry_run",
    generatedAt: "2026-06-07T00:00:00.000Z",
    runtimeEnv: {
      LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_PORT: "not-a-number",
    },
    fetcher: async () => {
      throw new Error("dry-run should not fetch");
    },
  });

  assert.equal(result.summary.dryRun, true);
  assert.equal(result.summary.requestedTradeContexts, 3);
  assert.equal(result.summary.uniqueDayRequests, 2);
  assert.equal(result.summary.plannedCount, 2);
  assert.deepEqual(
    result.items.map((item) => item.sourceTradeContextTimestamps.length),
    [2, 1],
  );
  assert.equal(result.items[0]?.lookbackBars, 192);
  assert.equal(result.items[0]?.endTimeMs, DAY_END);
  assert.equal(result.items[0]?.outputPath.includes(join("ibkr", "DEVS", "5m")), true);
  for (const item of result.items) {
    assert.equal(existsSync(item.outputPath), false);
  }
});

test("journal 5m day collection writes one cache wrapper per unique symbol day", async () => {
  const cacheRoot = tempCacheRoot();
  const fetched: HistoricalFetchRequest[] = [];
  const result = await collectJournalTradeContextFiveMinuteDayCache({
    cacheRoot,
    provider: "stub",
    requests: [
      { symbol: "DEVS", tradeContextTimestamp: MORNING_TRADE },
      { symbol: "DEVS", tradeContextTimestamp: AFTERNOON_TRADE },
    ],
    mode: "write",
    generatedAt: "2026-06-07T00:00:00.000Z",
    fetcher: async (request) => {
      fetched.push(request);
      return responseFor(request);
    },
  });
  const item = result.items[0]!;
  const wrapper = JSON.parse(readFileSync(item.outputPath, "utf8"));

  assert.equal(fetched.length, 1);
  assert.equal(fetched[0]?.symbol, "DEVS");
  assert.equal(fetched[0]?.timeframe, "5m");
  assert.equal(fetched[0]?.lookbackBars, 192);
  assert.equal(fetched[0]?.endTimeMs, DAY_END);
  assert.equal(fetched[0]?.preferredProvider, "stub");
  assert.equal(result.summary.writtenCount, 1);
  assert.equal(item.status, "written");
  assert.equal(item.candleCount, 192);
  assert.equal(wrapper.schemaVersion, 1);
  assert.equal(wrapper.cachedAt, Date.parse("2026-06-07T00:00:00.000Z"));
  assert.deepEqual(wrapper.request, {
    symbol: "DEVS",
    timeframe: "5m",
    lookbackBars: 192,
    endTimeMs: DAY_END,
    provider: "stub",
  });
  assert.equal(wrapper.response.timeframe, "5m");
  assert.equal(wrapper.journalTradeContextPolicy.localDate, "2026-06-01");
  assert.deepEqual(wrapper.journalTradeContextPolicy.sourceTradeContextTimestamps, [
    MORNING_TRADE,
    AFTERNOON_TRADE,
  ]);
  assert.equal(wrapper.journalTradeContextPolicy.safety.snapshotStillFiltersAsOf, true);
});

test("journal 5m day collection skips existing cache files unless overwrite is set", async () => {
  const cacheRoot = tempCacheRoot();
  const outputPath = deriveJournalTradeContextFiveMinuteDayCachePath({
    cacheRoot,
    provider: "stub",
    symbol: "DEVS",
    lookbackBars: 192,
    endTimeMs: DAY_END,
  });
  const sentinel = "{\"sentinel\":true}\n";
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, sentinel, "utf8");
  let fetchCount = 0;

  const skipped = await collectJournalTradeContextFiveMinuteDayCache({
    cacheRoot,
    provider: "stub",
    requests: [{ symbol: "DEVS", tradeContextTimestamp: MORNING_TRADE }],
    mode: "write",
    fetcher: async (request) => {
      fetchCount += 1;
      return responseFor(request);
    },
  });

  assert.equal(fetchCount, 0);
  assert.equal(skipped.summary.skippedExistingCount, 1);
  assert.equal(readFileSync(outputPath, "utf8"), sentinel);

  const overwritten = await collectJournalTradeContextFiveMinuteDayCache({
    cacheRoot,
    provider: "stub",
    requests: [{ symbol: "DEVS", tradeContextTimestamp: MORNING_TRADE }],
    mode: "write",
    overwrite: true,
    generatedAt: "2026-06-07T00:00:00.000Z",
    fetcher: async (request) => {
      fetchCount += 1;
      return responseFor(request, sampleCandles(request, 191));
    },
  });

  assert.equal(fetchCount, 1);
  assert.equal(overwritten.summary.writtenCount, 1);
  assert.equal(JSON.parse(readFileSync(outputPath, "utf8")).response.candles.length, 191);
});

test("journal 5m day collection records empty responses and failures without stopping other days", async () => {
  const cacheRoot = tempCacheRoot();
  const result = await collectJournalTradeContextFiveMinuteDayCache({
    cacheRoot,
    provider: "stub",
    requests: [
      { symbol: "OKAY", tradeContextTimestamp: MORNING_TRADE },
      { symbol: "EMPTY", tradeContextTimestamp: MORNING_TRADE },
      { symbol: "FAIL", tradeContextTimestamp: MORNING_TRADE },
    ],
    mode: "write",
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
  assert.equal(result.items.find((item) => item.symbol === "EMPTY")?.error, "Provider returned zero 5m candles.");
  assert.equal(result.items.find((item) => item.symbol === "FAIL")?.error, "provider unavailable");
});

test("journal 5m day collection parser rejects malformed requests and modes", () => {
  assert.deepEqual(parseJournalTradeContextFiveMinuteDayRequests("DEVS@2026-06-01T09:42:00-04:00"), [
    {
      symbol: "DEVS",
      tradeContextTimestamp: MORNING_TRADE,
    },
  ]);
  assert.throws(() => parseJournalTradeContextFiveMinuteDayRequests("DEVS"), /SYMBOL@timestamp/);
  assert.throws(
    () =>
      parseCollectJournalTradeContextFiveMinuteDayCacheArgs([
        "--cache-root",
        "cache",
        "--provider",
        "stub",
        "--requests",
        "DEVS@2026-06-01T09:42:00-04:00",
        "--dry-run",
        "--write",
      ]),
    /either --dry-run or --write/,
  );
});

test("journal 5m day collection live provider config failures are explicit and write no files", async () => {
  const ibkrCacheRoot = tempCacheRoot();
  const ibkrResult = await collectJournalTradeContextFiveMinuteDayCache({
    cacheRoot: ibkrCacheRoot,
    provider: "ibkr",
    requests: [{ symbol: "DEVS", tradeContextTimestamp: MORNING_TRADE }],
    mode: "write",
    runtimeEnv: {},
  });
  const ibkrPath = deriveJournalTradeContextFiveMinuteDayCachePath({
    cacheRoot: ibkrCacheRoot,
    provider: "ibkr",
    symbol: "DEVS",
    lookbackBars: 192,
    endTimeMs: DAY_END,
  });

  assert.equal(ibkrResult.summary.failedCount, 1);
  assert.match(ibkrResult.items[0]?.error ?? "", /LEVEL_JOURNAL_5M_DAY_CACHE_ENABLE_IBKR=true/);
  assert.equal(existsSync(ibkrPath), false);

  const twelveDataCacheRoot = tempCacheRoot();
  const twelveDataResult = await collectJournalTradeContextFiveMinuteDayCache({
    cacheRoot: twelveDataCacheRoot,
    provider: "twelve_data",
    requests: [{ symbol: "DXYZ", tradeContextTimestamp: MORNING_TRADE }],
    mode: "write",
    runtimeEnv: {},
  });

  assert.equal(twelveDataResult.summary.failedCount, 1);
  assert.match(twelveDataResult.items[0]?.error ?? "", /TWELVE_DATA_API_KEY/);
});

test("journal 5m day collection default fetcher exposes preflight config errors", async () => {
  await assert.rejects(
    () => createDefaultJournalTradeContextFiveMinuteDayCacheFetcherBundle("ibkr", {}),
    /LEVEL_JOURNAL_5M_DAY_CACHE_ENABLE_IBKR=true/,
  );
  await assert.rejects(
    () => createDefaultJournalTradeContextFiveMinuteDayCacheFetcherBundle("twelve_data", {}),
    /TWELVE_DATA_API_KEY/,
  );
});

test("journal 5m day collection formatter exposes compact operational summary", async () => {
  const cacheRoot = tempCacheRoot();
  const result = await collectJournalTradeContextFiveMinuteDayCache({
    cacheRoot,
    provider: "ibkr",
    requests: [{ symbol: "DEVS", tradeContextTimestamp: MORNING_TRADE }],
    mode: "dry_run",
    generatedAt: "2026-06-07T00:00:00.000Z",
  });
  const text = formatCollectJournalTradeContextFiveMinuteDayCacheSummary(result);

  assert.match(text, /Journal trade-context 5m day cache collection/);
  assert.match(text, /Mode: dry-run/);
  assert.match(text, /Unique day requests: 1/);
  assert.match(text, /DEVS 2026-06-01: planned/);
});
