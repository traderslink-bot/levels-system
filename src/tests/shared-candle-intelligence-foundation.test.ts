import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildExecutionLevelRelations,
  buildGapStructure,
  buildReferenceLevels,
  buildSharedEngineCapabilityReport,
  buildSupportResistanceContextFromCandles,
  buildWarehouseBackedSupportResistanceContextForSymbol,
  DurableCandleWarehouse,
  planBulkCandleBackfill,
  StubHistoricalCandleProvider,
  type Candle,
} from "../lib/support-resistance/index.js";
import {
  buildCandleWarehouseAuditReport,
} from "../lib/review/candle-warehouse-audit.js";

const FIVE_MINUTES = 5 * 60_000;

function candle(timestamp: number, close: number, volume = 100_000): Candle {
  return {
    timestamp,
    open: close,
    high: Number((close * 1.02).toFixed(4)),
    low: Number((close * 0.98).toFixed(4)),
    close,
    volume,
  };
}

function waveCandles(params: {
  count: number;
  start: number;
  intervalMs: number;
  base: number;
  wave: number;
}): Candle[] {
  return Array.from({ length: params.count }, (_, index) => {
    const close = params.base + Math.sin(index / 3) * params.wave + index * params.wave * 0.02;
    return candle(params.start + index * params.intervalMs, Number(close.toFixed(4)), 100_000 + index * 1_000);
  });
}

test("shared context exposes reference levels, gap structure, dynamic price context, and execution relations", async () => {
  const day = 24 * 60 * 60_000;
  const start = Date.UTC(2026, 4, 1, 8, 0);
  const sessionDate = "2026-05-01";
  const daily = [
    { timestamp: Date.UTC(2026, 3, 29), open: 1, high: 1.1, low: 0.9, close: 1.0, volume: 100_000 },
    { timestamp: Date.UTC(2026, 3, 30), open: 1, high: 1.25, low: 0.95, close: 1.18, volume: 120_000 },
    { timestamp: Date.UTC(2026, 4, 1), open: 1.5, high: 1.7, low: 1.45, close: 1.62, volume: 200_000 },
    ...waveCandles({ count: 180, start: Date.UTC(2026, 4, 2), intervalMs: day, base: 1.5, wave: 0.08 }),
  ];
  const fourHour = waveCandles({ count: 140, start, intervalMs: 4 * 60 * 60_000, base: 1.45, wave: 0.04 });
  const fiveMinute = waveCandles({ count: 110, start: Date.UTC(2026, 4, 1, 8, 0), intervalMs: FIVE_MINUTES, base: 1.5, wave: 0.02 });

  const context = await buildSupportResistanceContextFromCandles({
    symbol: "FACT",
    sessionDate,
    currentPrice: 1.58,
    candlesByTimeframe: {
      daily,
      "4h": fourHour,
      "5m": fiveMinute,
    },
  });

  assert.equal(context.referenceLevels.previousDayHigh, 1.25);
  assert.equal(context.referenceLevels.previousDayClose, 1.18);
  assert.ok(context.referenceLevels.premarketHigh !== null);
  assert.ok(context.referenceLevels.openingRangeHigh !== null);
  assert.ok(context.dynamicLevels.priceContext);
  assert.equal(context.dynamicLevels.priceContext?.currentPrice, 1.58);
  assert.ok(context.gapStructure.recentGaps.some((gap) => gap.direction === "up"));

  const relations = buildExecutionLevelRelations({
    price: 1.58,
    levels: context.levels,
    referenceLevels: context.referenceLevels,
  });
  assert.equal(relations.price, 1.58);
  assert.ok("stackedResistanceAboveCount" in relations);
  assert.ok(relations.nearestReference === null || relations.nearestReference.distancePct >= 0);
});

test("gap structure reports nearest open gaps without inventing filled gaps", () => {
  const candles: Candle[] = [
    { timestamp: 1, open: 10, high: 10.2, low: 9.8, close: 10, volume: 1 },
    { timestamp: 2, open: 12, high: 12.3, low: 11.8, close: 12, volume: 1 },
    { timestamp: 3, open: 12.2, high: 12.4, low: 11.9, close: 12.1, volume: 1 },
  ];

  const structure = buildGapStructure({ candles, currentPrice: 11, minimumGapPct: 5 });

  assert.equal(structure.nearestGapAbove?.start, 10);
  assert.equal(structure.nearestGapAbove?.end, 12);
  assert.equal(structure.nearestGapAbove?.filled, false);
});

test("bulk candle backfill planner dedupes repeated trade requests", () => {
  const plan = planBulkCandleBackfill({
    provider: "ibkr",
    trades: [
      { symbol: "abc", sessionDate: "2026-05-01", asOfTimestamp: "2026-05-01T16:00:00.000Z" },
      { symbol: "ABC", sessionDate: "2026-05-01", asOfTimestamp: "2026-05-01T16:00:00.000Z" },
    ],
    timeframes: ["daily", "5m", "1m"],
  });

  assert.equal(plan.symbolCount, 1);
  assert.equal(plan.sessionCount, 1);
  assert.equal(plan.dedupedTaskCount, 3);
});

test("bulk candle backfill planner coalesces same symbol sessions across execution timestamps", () => {
  const plan = planBulkCandleBackfill({
    provider: "ibkr",
    trades: [
      { symbol: "abc", sessionDate: "2026-05-01", asOfTimestamp: "2026-05-01T14:00:00.000Z" },
      { symbol: "ABC", sessionDate: "2026-05-01", asOfTimestamp: "2026-05-01T15:30:00.000Z" },
      { symbol: "ABC", sessionDate: "2026-05-01", asOfTimestamp: "2026-05-01T19:45:00.000Z" },
    ],
    timeframes: ["1m"],
    lookbackBars: { "1m": 120 },
  });

  assert.equal(plan.dedupedTaskCount, 1);
  assert.equal(plan.tasks[0]?.symbol, "ABC");
  assert.equal(plan.tasks[0]?.endTimestamp, Date.parse("2026-05-01T19:45:00.000Z"));
  assert.ok((plan.tasks[0]?.lookbackBars ?? 0) > 120);
});

test("warehouse-backed symbol context reads through the durable warehouse service", async () => {
  const root = await mkdtemp(join(tmpdir(), "levels-warehouse-"));
  const context = await buildWarehouseBackedSupportResistanceContextForSymbol({
    symbol: "WHSE",
    warehouseDirectoryPath: root,
    mode: "read_write",
    fetchServiceOptions: {
      provider: new StubHistoricalCandleProvider(),
    },
    lookbackBars: {
      daily: 80,
      "4h": 80,
      "5m": 80,
    },
  });

  assert.equal(context.symbol, "WHSE");
  assert.ok(context.fetches.every((fetch) => fetch.provider === "stub"));

  const audit = await buildCandleWarehouseAuditReport(root);
  assert.ok(audit.totalRows > 0);
  assert.ok(audit.symbols.some((symbol) => symbol.symbol === "WHSE"));
});

test("shared engine capability report lists public package boundary and implemented capabilities", async () => {
  const report = await buildSharedEngineCapabilityReport();

  assert.equal(report.packageName, "levels-system-phase1");
  assert.equal(report.publicSubpath, "./support-resistance-engine");
  assert.ok(report.publicExports.includes("buildSupportResistanceContextForSymbol"));
  assert.ok(report.implementedCapabilities.some((capability) => capability.includes("support/resistance")));
});
