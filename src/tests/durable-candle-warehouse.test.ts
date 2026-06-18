import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CandleFetchService,
  DurableCandleWarehouse,
  DurableCandleWarehouseFetchService,
  assessCandleWarehouseStoragePolicy,
  buildDefaultSupportResistanceContextForSymbol,
  executeCandleWarehouseBackfill,
  planWarehouseMissingCandleBackfill,
  StubHistoricalCandleProvider,
  type Candle,
  type CandleProviderResponse,
} from "../lib/support-resistance/index.js";

function candle(timestamp: number, close = 1): Candle {
  return {
    timestamp,
    open: close,
    high: close + 0.05,
    low: close - 0.05,
    close,
    volume: 1000,
  };
}

test("DurableCandleWarehouse upserts, dedupes, and queries sorted candles", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "durable-candles-")));
  const start = Date.UTC(2026, 4, 1, 13, 30, 0);

  await warehouse.upsertCandles({
    provider: "stub",
    symbol: "abcd",
    timeframe: "1m",
    candles: [
      candle(start + 60_000, 1.02),
      candle(start, 1.01),
      candle(start + 60_000, 1.03),
    ],
    sourceFetchedAt: start + 120_000,
  });

  const rows = await warehouse.getCandles({
    provider: "stub",
    symbol: "ABCD",
    timeframe: "1m",
    startTimestamp: start,
    endTimestamp: start + 60_000,
  });

  assert.deepEqual(rows.map((row) => row.timestamp), [start, start + 60_000]);
  assert.equal(rows[1]?.close, 1.03);

  const coverage = await warehouse.getCoverage({
    provider: "stub",
    symbol: "ABCD",
    timeframe: "1m",
    startTimestamp: start,
    endTimestamp: start + 60_000,
  });
  assert.equal(coverage.candleCount, 2);
  assert.equal(coverage.startTimestamp, start);
  assert.equal(coverage.endTimestamp, start + 60_000);
});

test("DurableCandleWarehouse reports missing ranges by timeframe interval", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "durable-candles-")));
  const start = Date.UTC(2026, 4, 1, 13, 30, 0);

  await warehouse.upsertCandles({
    provider: "stub",
    symbol: "MISS",
    timeframe: "1m",
    candles: [candle(start), candle(start + 2 * 60_000)],
  });

  const missing = await warehouse.findMissingRanges({
    provider: "stub",
    symbol: "MISS",
    timeframe: "1m",
    startTimestamp: start,
    endTimestamp: start + 3 * 60_000,
  });

  assert.deepEqual(missing, [
    { startTimestamp: start + 60_000, endTimestamp: start + 60_000 },
    { startTimestamp: start + 3 * 60_000, endTimestamp: start + 3 * 60_000 },
  ]);
});

test("DurableCandleWarehouseFetchService writes through and replays stored candles", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "durable-candles-")));
  const delegate = new CandleFetchService(new StubHistoricalCandleProvider());
  const endTimeMs = Date.UTC(2026, 4, 1, 16, 0, 0);

  const writer = new DurableCandleWarehouseFetchService({
    warehouse,
    delegate,
    mode: "refresh",
  });

  const fresh = await writer.fetchCandles({
    symbol: "WHSE",
    timeframe: "5m",
    lookbackBars: 12,
    endTimeMs,
  });
  assert.equal(fresh.actualBarsReturned, 12);
  assert.equal(fresh.providerMetadata?.durableWarehouse, "write_through");

  const replay = new DurableCandleWarehouseFetchService({
    warehouse,
    delegate,
    mode: "replay",
  });
  const cached = await replay.fetchCandles({
    symbol: "WHSE",
    timeframe: "5m",
    lookbackBars: 12,
    endTimeMs,
  });

  assert.equal(cached.actualBarsReturned, 12);
  assert.equal(cached.providerMetadata?.durableWarehouse, "read");
  assert.equal(cached.providerMetadata?.cacheStatus, "hit");
  assert.equal(cached.providerMetadata?.warehouseAdjustmentMode, "raw");
  assert.equal(cached.providerMetadata?.warehouseBasisValidationStatus, "basis_unchecked");
});

test("DurableCandleWarehouseFetchService reuses short but usable provider history in read_write mode", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "durable-candles-partial-history-")));
  const endTimeMs = Date.UTC(2026, 4, 1, 16, 0, 0);
  const start = endTimeMs - 3 * 24 * 60 * 60_000;
  let fetchCount = 0;
  const partialResponse: CandleProviderResponse = {
    provider: "ibkr",
    symbol: "YOUNG",
    timeframe: "daily",
    requestedLookbackBars: 10,
    candles: [
      candle(start, 1.2),
      candle(start + 24 * 60 * 60_000, 1.25),
      candle(start + 2 * 24 * 60 * 60_000, 1.3),
    ],
    fetchStartTimestamp: endTimeMs + 1000,
    fetchEndTimestamp: endTimeMs + 2000,
    requestedStartTimestamp: endTimeMs - 10 * 24 * 60 * 60_000,
    requestedEndTimestamp: endTimeMs,
    actualBarsReturned: 3,
    completenessStatus: "partial",
    stale: false,
    validationIssues: [
      {
        code: "insufficient_bars",
        severity: "warning",
        message: "Requested 10 bars but received 3.",
      },
    ],
    sessionSummary: null,
    sessionMetadataAvailable: false,
    providerMetadata: {
      whatToShow: "TRADES",
      useRTH: false,
      providerAdjustmentMode: "raw",
    },
  };
  const service = new DurableCandleWarehouseFetchService({
    warehouse,
    delegate: {
      getProviderName: () => "ibkr",
      fetchCandles: async () => {
        fetchCount += 1;
        if (fetchCount > 1) {
          throw new Error("read_write should reuse short but usable provider history");
        }
        return partialResponse;
      },
    },
    mode: "read_write",
  });

  const first = await service.fetchCandles({
    symbol: "YOUNG",
    timeframe: "daily",
    lookbackBars: 10,
    endTimeMs,
    preferredProvider: "ibkr",
  });
  const cached = await service.fetchCandles({
    symbol: "YOUNG",
    timeframe: "daily",
    lookbackBars: 10,
    endTimeMs,
    preferredProvider: "ibkr",
  });

  assert.equal(first.providerMetadata?.durableWarehouse, "write_through");
  assert.equal(cached.actualBarsReturned, 3);
  assert.equal(cached.providerMetadata?.durableWarehouse, "read");
  assert.equal(cached.providerMetadata?.cacheStatus, "provider_partial_hit");
  assert.equal(cached.providerMetadata?.warehouseCompletenessStatus, "partial");
  assert.equal(cached.providerMetadata?.warehouseValidationIssueCodes, "insufficient_bars");
  assert.equal(fetchCount, 1);
});

test("DurableCandleWarehouseFetchService preserves provider candle basis metadata on replay", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "durable-candles-basis-metadata-")));
  const endTimeMs = Date.UTC(2026, 4, 1, 16, 0, 0);
  const start = endTimeMs - 2 * 5 * 60_000;
  const delegate = {
    getProviderName: () => "ibkr" as const,
    fetchCandles: async () => ({
      provider: "ibkr" as const,
      symbol: "BASIS",
      timeframe: "5m" as const,
      requestedLookbackBars: 3,
      candles: [
        candle(start, 1.2),
        candle(start + 5 * 60_000, 1.25),
        candle(endTimeMs, 1.3),
      ],
      fetchStartTimestamp: endTimeMs + 1000,
      fetchEndTimestamp: endTimeMs + 2000,
      requestedStartTimestamp: start,
      requestedEndTimestamp: endTimeMs,
      actualBarsReturned: 3,
      completenessStatus: "complete" as const,
      stale: false,
      validationIssues: [],
      sessionSummary: null,
      sessionMetadataAvailable: true,
      providerMetadata: {
        ibkrRequestedSymbol: "BASIS",
        ibkrResolvedSymbol: "BASIS",
        ibkrResolvedConId: 123456,
        ibkrResolvedExchange: "SMART",
        ibkrResolvedPrimaryExchange: "NASDAQ",
        ibkrContractAliasUsed: false,
        ibkrHistoricalAliasReason: null,
        whatToShow: "TRADES",
        useRTH: false,
        providerAdjustmentMode: "raw",
      },
    }),
  };

  const writer = new DurableCandleWarehouseFetchService({
    warehouse,
    delegate,
    mode: "refresh",
  });
  await writer.fetchCandles({
    symbol: "BASIS",
    timeframe: "5m",
    lookbackBars: 3,
    endTimeMs,
    preferredProvider: "ibkr",
  });

  const replay = new DurableCandleWarehouseFetchService({
    warehouse,
    delegate: {
      getProviderName: () => "ibkr",
      fetchCandles: async () => {
        throw new Error("replay should not fetch");
      },
    },
    mode: "replay",
  });
  const cached = await replay.fetchCandles({
    symbol: "BASIS",
    timeframe: "5m",
    lookbackBars: 3,
    endTimeMs,
    preferredProvider: "ibkr",
  });

  assert.equal(cached.providerMetadata?.warehouseRequestedSymbol, "BASIS");
  assert.equal(cached.providerMetadata?.warehouseResolvedConId, 123456);
  assert.equal(cached.providerMetadata?.warehouseResolvedPrimaryExchange, "NASDAQ");
  assert.equal(cached.providerMetadata?.warehouseWhatToShow, "TRADES");
  assert.equal(cached.providerMetadata?.warehouseUseRTH, false);
  assert.equal(cached.providerMetadata?.warehouseProviderAdjustmentMode, "raw");
  assert.equal(cached.providerMetadata?.warehouseAdjustmentMode, "raw");
  assert.equal(cached.providerMetadata?.warehouseBasisValidationStatus, "basis_unchecked");
});

test("DurableCandleWarehouseFetchService preserves known IBKR alias metadata on replay", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "durable-candles-ibkr-alias-")));
  const endTimeMs = Date.UTC(2026, 4, 1, 16, 0, 0);
  const start = endTimeMs - 2 * 5 * 60_000;

  await warehouse.upsertCandles({
    provider: "ibkr",
    symbol: "MAXN",
    timeframe: "5m",
    candles: [
      candle(start, 1.2),
      candle(start + 5 * 60_000, 1.25),
      candle(endTimeMs, 1.3),
    ],
  });

  const replay = new DurableCandleWarehouseFetchService({
    warehouse,
    delegate: {
      getProviderName: () => "ibkr",
      fetchCandles: async () => {
        throw new Error("replay should not fetch");
      },
    },
    mode: "replay",
  });

  const cached = await replay.fetchCandles({
    symbol: "MAXN",
    timeframe: "5m",
    lookbackBars: 3,
    endTimeMs,
    preferredProvider: "ibkr",
  });

  assert.equal(cached.providerMetadata?.durableWarehouse, "read");
  assert.equal(cached.providerMetadata?.ibkrRequestedSymbol, "MAXN");
  assert.equal(cached.providerMetadata?.ibkrResolvedSymbol, "MAXNQ");
  assert.equal(cached.providerMetadata?.ibkrResolvedPrimaryExchange, "PINK");
  assert.equal(cached.providerMetadata?.ibkrContractAliasUsed, true);
});

test("DurableCandleWarehouse exports symbols by provider", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "durable-candles-")));

  await warehouse.upsertCandles({
    provider: "stub",
    symbol: "one",
    timeframe: "daily",
    candles: [candle(Date.UTC(2026, 4, 1), 1)],
  });
  await warehouse.upsertCandles({
    provider: "stub",
    symbol: "two",
    timeframe: "daily",
    candles: [candle(Date.UTC(2026, 4, 1), 2)],
  });

  assert.deepEqual(await warehouse.listSymbols("stub"), ["ONE", "TWO"]);
});

test("warehouse missing backfill planner only returns ranges absent from durable storage", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "durable-candles-")));
  const asOfTimestamp = Date.UTC(2026, 4, 1, 14, 0, 0);
  const lookbackBars = 4;
  const startTimestamp = asOfTimestamp - lookbackBars * 60_000;

  await warehouse.upsertCandles({
    provider: "stub",
    symbol: "PLAN",
    timeframe: "1m",
    candles: [
      candle(startTimestamp, 1),
      candle(startTimestamp + 60_000, 1.01),
    ],
  });

  const plan = await planWarehouseMissingCandleBackfill({
    warehouse,
    provider: "stub",
    trades: [
      {
        symbol: "PLAN",
        sessionDate: "2026-05-01",
        asOfTimestamp,
      },
      {
        symbol: "PLAN",
        sessionDate: "2026-05-01",
        asOfTimestamp,
      },
    ],
    timeframes: ["1m"],
    lookbackBars: {
      "1m": lookbackBars,
    },
  });

  assert.equal(plan.plannedTaskCount, 1);
  assert.equal(plan.missingTaskCount, 1);
  assert.equal(plan.fullyCoveredTaskCount, 0);
  assert.equal(plan.missingCandleCountEstimate, 3);
  assert.deepEqual(plan.tasks[0]?.missingRanges, [
    { startTimestamp: startTimestamp + 2 * 60_000, endTimestamp: asOfTimestamp },
  ]);
});

test("warehouse missing backfill planner treats internal sparse intraday gaps as no-trade gaps once coverage exists", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "durable-candles-sparse-")));
  const asOfTimestamp = Date.UTC(2026, 4, 1, 14, 0, 0);
  const lookbackBars = 4;
  const startTimestamp = asOfTimestamp - lookbackBars * 60_000;

  await warehouse.upsertCandles({
    provider: "stub",
    symbol: "SPARSE",
    timeframe: "1m",
    candles: [
      candle(startTimestamp, 1),
      candle(startTimestamp + 2 * 60_000, 1.02),
      candle(asOfTimestamp, 1.04),
    ],
  });

  const plan = await planWarehouseMissingCandleBackfill({
    warehouse,
    provider: "stub",
    trades: [
      {
        symbol: "SPARSE",
        sessionDate: "2026-05-01",
        asOfTimestamp,
      },
    ],
    timeframes: ["1m"],
    lookbackBars: {
      "1m": lookbackBars,
    },
  });

  assert.equal(plan.missingTaskCount, 0);
  assert.equal(plan.missingCandleCountEstimate, 0);
  assert.equal(plan.likelyNoBarMissingTaskCount, 1);
  assert.equal(plan.likelyNoBarMissingCandleCountEstimate, 2);
});

test("warehouse missing backfill planner ignores intraday gaps outside extended trading hours", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "durable-candles-offhours-")));
  const asOfTimestamp = Date.parse("2026-05-01T06:30:00.000Z"); // 02:30 ET, before premarket.

  const plan = await planWarehouseMissingCandleBackfill({
    warehouse,
    provider: "stub",
    trades: [
      {
        symbol: "NOBAR",
        sessionDate: "2026-05-01",
        asOfTimestamp,
      },
    ],
    timeframes: ["1m"],
    lookbackBars: {
      "1m": 3,
    },
  });

  assert.equal(plan.missingTaskCount, 0);
  assert.equal(plan.fullyCoveredTaskCount, 1);
  assert.equal(plan.missingCandleCountEstimate, 0);
  assert.equal(plan.likelyNoBarMissingTaskCount, 1);
  assert.equal(plan.likelyNoBarMissingCandleCountEstimate, 4);
});

test("warehouse missing backfill planner keeps only actionable intraday gaps inside extended hours", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "durable-candles-mixed-hours-")));
  const asOfTimestamp = Date.parse("2026-05-01T08:02:00.000Z"); // 04:02 ET, after premarket begins.

  const plan = await planWarehouseMissingCandleBackfill({
    warehouse,
    provider: "stub",
    trades: [
      {
        symbol: "MIXED",
        sessionDate: "2026-05-01",
        asOfTimestamp,
      },
    ],
    timeframes: ["1m"],
    lookbackBars: {
      "1m": 4,
    },
  });

  assert.equal(plan.missingTaskCount, 1);
  assert.equal(plan.missingCandleCountEstimate, 3);
  assert.equal(plan.likelyNoBarMissingTaskCount, 1);
  assert.equal(plan.likelyNoBarMissingCandleCountEstimate, 2);
  assert.deepEqual(plan.tasks[0]?.missingRanges, [
    { startTimestamp: Date.parse("2026-05-01T08:00:00.000Z"), endTimestamp: Date.parse("2026-05-01T08:02:00.000Z") },
  ]);
});

test("warehouse missing backfill planner treats older daily gaps before available history as no-bar coverage", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "durable-candles-daily-history-")));
  const asOfTimestamp = Date.parse("2026-05-04T00:00:00.000Z");

  await warehouse.upsertCandles({
    provider: "stub",
    symbol: "NEWIPO",
    timeframe: "daily",
    candles: [
      candle(Date.parse("2026-05-01T00:00:00.000Z"), 1),
      candle(Date.parse("2026-05-04T00:00:00.000Z"), 1.1),
    ],
  });

  const plan = await planWarehouseMissingCandleBackfill({
    warehouse,
    provider: "stub",
    trades: [
      {
        symbol: "NEWIPO",
        sessionDate: "2026-05-04",
        asOfTimestamp,
      },
    ],
    timeframes: ["daily"],
    lookbackBars: {
      daily: 7,
    },
  });

  assert.equal(plan.missingTaskCount, 0);
  assert.equal(plan.missingCandleCountEstimate, 0);
  assert.ok(plan.likelyNoBarMissingCandleCountEstimate >= 3);
});

test("candle warehouse backfill dry-run plans work without fetching provider data", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "durable-candles-")));
  const delegate = new CandleFetchService(new StubHistoricalCandleProvider());
  let fetchCount = 0;
  const fetchClient = {
    getProviderName: () => delegate.getProviderName(),
    fetchCandles: async (...args: Parameters<CandleFetchService["fetchCandles"]>) => {
      fetchCount += 1;
      return delegate.fetchCandles(...args);
    },
  };

  const result = await executeCandleWarehouseBackfill({
    warehouse,
    fetchClient,
    mode: "dry_run",
    provider: "stub",
    trades: [{ symbol: "DRY", sessionDate: "2026-05-01", asOfTimestamp: Date.UTC(2026, 4, 1, 16) }],
    timeframes: ["5m"],
    lookbackBars: { "5m": 3 },
  });

  assert.equal(fetchCount, 0);
  assert.equal(result.mode, "dry_run");
  assert.equal(result.totals.plannedTasks, 1);
  assert.equal(result.totals.skippedTasks, 1);
  assert.equal(result.taskResults[0]?.readiness, "safe_to_fetch");
});

test("candle warehouse backfill execute fetches missing ranges and later reuses storage", async () => {
  const warehouse = new DurableCandleWarehouse(mkdtempSync(join(tmpdir(), "durable-candles-")));
  const delegate = new CandleFetchService(new StubHistoricalCandleProvider());
  let fetchCount = 0;
  const fetchClient = {
    getProviderName: () => delegate.getProviderName(),
    fetchCandles: async (...args: Parameters<CandleFetchService["fetchCandles"]>) => {
      fetchCount += 1;
      return delegate.fetchCandles(...args);
    },
  };
  const request = {
    warehouse,
    fetchClient,
    provider: "stub" as const,
    trades: [{ symbol: "EXEC", sessionDate: "2026-05-01", asOfTimestamp: Date.UTC(2026, 4, 1, 16) }],
    timeframes: ["5m" as const],
    lookbackBars: { "5m": 3 },
  };

  const first = await executeCandleWarehouseBackfill({
    ...request,
    mode: "execute",
    concurrency: 1,
    throttleMs: 1,
  });
  const second = await executeCandleWarehouseBackfill({
    ...request,
    mode: "execute",
    concurrency: 1,
  });

  assert.equal(first.totals.fetchedTasks, 1);
  assert.equal(first.totals.failedTasks, 0);
  assert.equal(first.taskResults[0]?.readiness, "refreshed");
  assert.equal(second.totals.plannedTasks, 0);
  assert.equal(second.totals.fetchedTasks, 0);
  assert.equal(fetchCount, 1);
});

test("default shared symbol builder uses the durable warehouse path", async () => {
  const warehouseDirectoryPath = mkdtempSync(join(tmpdir(), "durable-candles-default-"));
  const asOfTimestamp = Date.UTC(2026, 4, 1, 16, 0, 0);

  const context = await buildDefaultSupportResistanceContextForSymbol({
    symbol: "DFLT",
    warehouseDirectoryPath,
    preferredProvider: "stub",
    fetchServiceOptions: {
      provider: new StubHistoricalCandleProvider(),
    },
    asOfTimestamp,
  });

  assert.equal(context.symbol, "DFLT");
  assert.equal(context.candleFetchingOwnedBy, "levels-system");
  assert.ok(context.fetches.every((fetch) => fetch.provider === "stub"));

  const warehouse = new DurableCandleWarehouse(warehouseDirectoryPath);
  const coverage = await warehouse.getCoverage({
    provider: "stub",
    symbol: "DFLT",
    timeframe: "5m",
    startTimestamp: asOfTimestamp - 120 * 5 * 60_000,
    endTimestamp: asOfTimestamp,
  });
  assert.ok(coverage.candleCount >= 100);
});

test("default shared symbol builder stores reusable warehouse rows for future runs", async () => {
  const warehouseDirectoryPath = mkdtempSync(join(tmpdir(), "durable-candles-default-replay-"));
  const asOfTimestamp = Date.UTC(2026, 4, 1, 16, 0, 0);

  const context = await buildDefaultSupportResistanceContextForSymbol({
    symbol: "RPLY",
    warehouseDirectoryPath,
    preferredProvider: "stub",
    fetchServiceOptions: {
      provider: new StubHistoricalCandleProvider(),
    },
    asOfTimestamp,
    lookbackBars: { daily: 12, "4h": 12, "5m": 12 },
  });

  const warehouse = new DurableCandleWarehouse(warehouseDirectoryPath);
  const dailyCoverage = await warehouse.getCoverage({
    provider: "stub",
    symbol: "RPLY",
    timeframe: "daily",
    startTimestamp: context.fetches.find((fetch) => fetch.timeframe === "daily")!.requestedStartTimestamp,
    endTimestamp: context.fetches.find((fetch) => fetch.timeframe === "daily")!.requestedEndTimestamp,
  });
  const fiveMinuteCoverage = await warehouse.getCoverage({
    provider: "stub",
    symbol: "RPLY",
    timeframe: "5m",
    startTimestamp: context.fetches.find((fetch) => fetch.timeframe === "5m")!.requestedStartTimestamp,
    endTimestamp: context.fetches.find((fetch) => fetch.timeframe === "5m")!.requestedEndTimestamp,
  });

  assert.equal(context.symbol, "RPLY");
  assert.equal(context.candleFetchingOwnedBy, "levels-system");
  assert.ok(dailyCoverage.candleCount > 0);
  assert.ok(fiveMinuteCoverage.candleCount > 0);
});

test("warehouse storage policy defines JSONL to database threshold", () => {
  assert.equal(
    assessCandleWarehouseStoragePolicy({
      symbolCount: 20,
      sessionCount: 10,
      estimatedRows: 100_000,
    }).mode,
    "jsonl",
  );
  assert.equal(
    assessCandleWarehouseStoragePolicy({
      symbolCount: 700,
      sessionCount: 260,
      estimatedRows: 6_000_000,
      monthlyImportTrades: 12_000,
    }).mode,
    "sqlite_recommended",
  );
  assert.equal(
    assessCandleWarehouseStoragePolicy({
      symbolCount: 2000,
      sessionCount: 1000,
      estimatedRows: 30_000_000,
    }).mode,
    "service_recommended",
  );
});
