import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import { buildSessionMarketFacts } from "../lib/session/index.js";

function candle(
  timestamp: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1_000,
): Candle {
  return {
    timestamp: Date.parse(timestamp),
    open,
    high,
    low,
    close,
    volume,
  };
}

function sessionFixture(): Candle[] {
  return [
    candle("2026-05-01T08:00:00-04:00", 10, 10.5, 9.8, 10.2, 1_000),
    candle("2026-05-01T08:05:00-04:00", 10.2, 10.8, 10, 10.7, 2_000),
    candle("2026-05-01T08:10:00-04:00", 10.7, 10.75, 9.7, 10, 1_500),
    candle("2026-05-01T09:30:00-04:00", 10.4, 10.9, 10.3, 10.8, 1_000),
    candle("2026-05-01T09:35:00-04:00", 10.8, 11.2, 10.7, 11.1, 1_000),
    candle("2026-05-01T09:40:00-04:00", 11.1, 11.15, 10.6, 10.7, 1_000),
    candle("2026-05-01T09:45:00-04:00", 10.7, 11, 10.5, 10.9, 1_000),
    candle("2026-05-01T09:50:00-04:00", 10.9, 10.95, 10.55, 10.8, 1_000),
    candle("2026-05-01T09:55:00-04:00", 10.8, 11, 10.65, 10.9, 1_000),
    candle("2026-05-01T10:00:00-04:00", 10.9, 11.4, 10.8, 11.3, 1_200),
    candle("2026-05-01T10:05:00-04:00", 11.3, 11.35, 11, 11.05, 900),
    candle("2026-05-01T10:10:00-04:00", 11.05, 11.2, 10.95, 11.1, 850),
    candle("2026-05-01T10:15:00-04:00", 11.1, 11.25, 10.9, 11.2, 800),
    candle("2026-05-01T10:20:00-04:00", 11.2, 11.45, 11.15, 11.4, 1_500),
  ];
}

test("buildSessionMarketFacts detects premarket high and low", () => {
  const facts = buildSessionMarketFacts({
    symbol: "sess",
    asOfTimestamp: Date.parse("2026-05-01T10:30:00-04:00"),
    candles5m: sessionFixture(),
    previousClose: 9.5,
  });

  assert.equal(facts.symbol, "SESS");
  assert.equal(facts.sessionDate, "2026-05-01");
  assert.equal(facts.premarketHigh, 10.8);
  assert.equal(facts.premarketHighTimestamp, Date.parse("2026-05-01T08:05:00-04:00"));
  assert.equal(facts.premarketLow, 9.7);
  assert.equal(facts.premarketLowTimestamp, Date.parse("2026-05-01T08:10:00-04:00"));
});

test("buildSessionMarketFacts detects opening range and regular-session open", () => {
  const facts = buildSessionMarketFacts({
    symbol: "open",
    asOfTimestamp: Date.parse("2026-05-01T10:30:00-04:00"),
    candles5m: sessionFixture(),
    previousClose: 9.5,
  });

  assert.equal(facts.previousClose, 9.5);
  assert.equal(facts.regularSessionOpen, 10.4);
  assert.equal(facts.openingRangeHigh, 11.2);
  assert.equal(facts.openingRangeLow, 10.3);
  assert.equal(facts.openingRangeStartTimestamp, Date.parse("2026-05-01T09:30:00-04:00"));
  assert.equal(facts.openingRangeEndTimestamp, Date.parse("2026-05-01T10:00:00-04:00"));
});

test("buildSessionMarketFacts detects high of day, low of day, and first simple session landmarks", () => {
  const facts = buildSessionMarketFacts({
    symbol: "hod",
    asOfTimestamp: Date.parse("2026-05-01T10:30:00-04:00"),
    candles5m: sessionFixture(),
  });

  assert.equal(facts.highOfDay, 11.45);
  assert.equal(facts.highOfDayTimestamp, Date.parse("2026-05-01T10:20:00-04:00"));
  assert.equal(facts.lowOfDay, 9.7);
  assert.equal(facts.lowOfDayTimestamp, Date.parse("2026-05-01T08:10:00-04:00"));
  assert.equal(facts.currentPrice, 11.4);
  assert.equal(facts.firstBreakoutHigh, 11.4);
  assert.equal(facts.firstBreakoutHighTimestamp, Date.parse("2026-05-01T10:00:00-04:00"));
  assert.equal(facts.firstPullbackLow, 10.9);
  assert.equal(facts.firstPullbackLowTimestamp, Date.parse("2026-05-01T10:15:00-04:00"));
  assert.deepEqual(facts.firstConsolidationRange, {
    low: 10.9,
    high: 11.35,
    startTimestamp: Date.parse("2026-05-01T10:05:00-04:00"),
    endTimestamp: Date.parse("2026-05-01T10:20:00-04:00"),
  });
});

test("buildSessionMarketFacts computes VWAP and VWAP distance as market facts only", () => {
  const facts = buildSessionMarketFacts({
    symbol: "vwap",
    asOfTimestamp: Date.parse("2026-05-01T09:45:00-04:00"),
    currentPrice: 11.55,
    candles5m: [
      candle("2026-05-01T09:30:00-04:00", 9, 10, 8, 9, 100),
      candle("2026-05-01T09:35:00-04:00", 11, 12, 10, 11, 300),
    ],
  });

  assert.equal(facts.vwap, 10.5);
  assert.equal(facts.aboveVWAP, true);
  assert.equal(facts.percentFromVWAP, 10);
  assert.equal(facts.diagnostics.some((diagnostic) => diagnostic.code === "zero_volume_for_vwap"), false);
});

test("buildSessionMarketFacts handles zero-volume VWAP diagnostics without interpretation", () => {
  const facts = buildSessionMarketFacts({
    symbol: "zero",
    asOfTimestamp: Date.parse("2026-05-01T09:45:00-04:00"),
    currentPrice: 11,
    candles5m: [
      candle("2026-05-01T09:30:00-04:00", 9, 10, 8, 9, 0),
      candle("2026-05-01T09:35:00-04:00", 11, 12, 10, 11, 0),
    ],
  });

  assert.equal(facts.vwap, undefined);
  assert.equal(facts.aboveVWAP, undefined);
  assert.equal(facts.percentFromVWAP, undefined);
  assert.ok(facts.diagnostics.some((diagnostic) => diagnostic.code === "zero_volume_for_vwap"));
});

test("buildSessionMarketFacts excludes future and partial candles using candle-close semantics", () => {
  const facts = buildSessionMarketFacts({
    symbol: "asof",
    asOfTimestamp: Date.parse("2026-05-01T09:33:00-04:00"),
    candles5m: [
      candle("2026-05-01T09:25:00-04:00", 1, 1.03, 0.99, 1.02),
      candle("2026-05-01T09:30:00-04:00", 1.02, 1.4, 1.01, 1.35),
      candle("2026-05-01T09:35:00-04:00", 1.35, 1.6, 1.32, 1.55),
    ],
  });

  assert.equal(facts.currentPrice, 1.02);
  assert.equal(facts.openingRangeHigh, undefined);
  assert.equal(facts.highOfDay, 1.03);
  assert.ok(facts.diagnostics.some((diagnostic) => diagnostic.code === "partial_candles_filtered"));
  assert.ok(facts.diagnostics.some((diagnostic) => diagnostic.code === "future_candles_filtered"));
});

test("buildSessionMarketFacts does not mutate input candles and is deterministic", () => {
  const candles = sessionFixture().reverse();
  const before = structuredClone(candles);
  const request = {
    symbol: "det",
    asOfTimestamp: Date.parse("2026-05-01T10:30:00-04:00"),
    candles5m: candles,
    previousClose: 9.5,
  };

  const first = buildSessionMarketFacts(request);
  const second = buildSessionMarketFacts(request);

  assert.deepEqual(first, second);
  assert.deepEqual(candles, before);
});
