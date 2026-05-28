import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCandleMarketStructureContext,
  type Candle,
} from "../lib/support-resistance/index.js";

const START = Date.UTC(2026, 4, 1, 13, 30, 0);
const FIVE_MINUTES = 5 * 60 * 1000;

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1]!;
    const high = Math.max(open, close) + 0.01;
    const low = Math.max(0.01, Math.min(open, close) - 0.01);
    return {
      timestamp: START + index * FIVE_MINUTES,
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
      volume: 100_000 + index * 1_000,
    };
  });
}

function candlesFromRanges(ranges: Array<{ high: number; low: number; close: number }>): Candle[] {
  return ranges.map((range, index) => ({
    timestamp: START + index * FIVE_MINUTES,
    open: index === 0 ? range.close : ranges[index - 1]!.close,
    high: range.high,
    low: range.low,
    close: range.close,
    volume: 100_000 + index * 1_000,
  }));
}

test("candle market structure detects confirmed swing pivots and higher lows", () => {
  const context = buildCandleMarketStructureContext({
    symbol: "hlow",
    candles: candlesFromRanges([
      { high: 1.02, low: 0.98, close: 1.00 },
      { high: 1.08, low: 1.00, close: 1.06 },
      { high: 1.14, low: 1.05, close: 1.12 },
      { high: 1.08, low: 1.01, close: 1.03 },
      { high: 1.05, low: 0.96, close: 0.99 },
      { high: 1.12, low: 1.01, close: 1.10 },
      { high: 1.22, low: 1.09, close: 1.20 },
      { high: 1.16, low: 1.08, close: 1.11 },
      { high: 1.10, low: 1.02, close: 1.05 },
      { high: 1.18, low: 1.07, close: 1.16 },
      { high: 1.32, low: 1.15, close: 1.30 },
      { high: 1.25, low: 1.16, close: 1.20 },
      { high: 1.19, low: 1.10, close: 1.13 },
      { high: 1.30, low: 1.14, close: 1.28 },
      { high: 1.42, low: 1.26, close: 1.39 },
      { high: 1.35, low: 1.24, close: 1.31 },
      { high: 1.28, low: 1.20, close: 1.24 },
      { high: 1.40, low: 1.23, close: 1.37 },
      { high: 1.52, low: 1.36, close: 1.48 },
      { high: 1.46, low: 1.38, close: 1.42 },
    ]),
  });

  assert.equal(context.symbol, "HLOW");
  assert.ok(context.pivots.confirmedHighs.length >= 3);
  assert.ok(context.pivots.confirmedLows.length >= 3);
  assert.ok(context.trend.higherLowCount >= 2);
  assert.ok(
    ["higher_lows_intact", "trend_intact", "base_building", "pressing_range_high", "reclaim_confirmed"].includes(
      context.state,
    ),
  );
  assert.ok(context.confidence.score > 0.45);
});

test("candle market structure detects range-bound chop without turning tiny moves into a trend", () => {
  const context = buildCandleMarketStructureContext({
    symbol: "chop",
    candles: candlesFromCloses([
      1.00, 1.05, 1.01, 1.06, 1.00,
      1.05, 0.99, 1.06, 1.00, 1.05,
      0.99, 1.06, 1.00, 1.05, 1.01,
      1.06, 1.00, 1.04, 1.01, 1.03,
    ]),
  });

  assert.ok(context.range?.active);
  assert.equal(context.state, "range_bound");
  assert.match(context.traderLine ?? "", /range-bound/);
  assert.match(context.traderLine ?? "", /lower-quality noise/);
});

test("candle market structure detects a breakout attempt over the active range high", () => {
  const context = buildCandleMarketStructureContext({
    symbol: "brk",
    candles: candlesFromCloses([
      1.00, 1.05, 1.01, 1.06, 1.00,
      1.05, 0.99, 1.06, 1.00, 1.05,
      0.99, 1.06, 1.00, 1.05, 1.01,
      1.06, 1.00, 1.04, 1.08, 1.12,
    ]),
  });

  assert.ok(context.range);
  assert.ok(["breakout_attempt", "breakout_holding", "reclaim_confirmed"].includes(context.state));
});

test("candle market structure detects support pivot loss from candle closes", () => {
  const context = buildCandleMarketStructureContext({
    symbol: "loss",
    candles: candlesFromRanges([
      { high: 1.05, low: 0.99, close: 1.02 },
      { high: 1.10, low: 1.02, close: 1.08 },
      { high: 1.16, low: 1.07, close: 1.15 },
      { high: 1.12, low: 1.03, close: 1.05 },
      { high: 1.08, low: 0.98, close: 1.00 },
      { high: 1.14, low: 1.01, close: 1.12 },
      { high: 1.22, low: 1.10, close: 1.20 },
      { high: 1.18, low: 1.08, close: 1.10 },
      { high: 1.14, low: 1.03, close: 1.05 },
      { high: 1.18, low: 1.05, close: 1.16 },
      { high: 1.28, low: 1.14, close: 1.25 },
      { high: 1.21, low: 1.10, close: 1.12 },
      { high: 1.16, low: 1.06, close: 1.08 },
      { high: 1.12, low: 1.01, close: 1.03 },
      { high: 1.08, low: 0.96, close: 0.98 },
    ]),
  });

  assert.equal(context.pivotEvent?.type, "loss");
  assert.equal(context.state, "pivot_lost");
  assert.match(context.traderLine ?? "", /reclaim would help repair/);
});

test("candle market structure detects reclaim from candle closes", () => {
  const context = buildCandleMarketStructureContext({
    symbol: "reclaim",
    candles: candlesFromRanges([
      { high: 1.04, low: 0.98, close: 1.00 },
      { high: 1.10, low: 1.00, close: 1.08 },
      { high: 1.18, low: 1.06, close: 1.16 },
      { high: 1.12, low: 1.02, close: 1.04 },
      { high: 1.08, low: 0.99, close: 1.01 },
      { high: 1.14, low: 1.02, close: 1.12 },
      { high: 1.24, low: 1.10, close: 1.22 },
      { high: 1.18, low: 1.08, close: 1.10 },
      { high: 1.14, low: 1.03, close: 1.05 },
      { high: 1.10, low: 0.98, close: 1.00 },
      { high: 1.08, low: 0.94, close: 0.97 },
      { high: 1.04, low: 0.96, close: 1.00 },
      { high: 1.10, low: 0.98, close: 1.04 },
      { high: 1.18, low: 1.02, close: 1.15 },
    ]),
  });

  assert.equal(context.pivotEvent?.type, "reclaim");
  assert.equal(context.state, "reclaim_confirmed");
  assert.match(context.traderLine ?? "", /reclaimed/);
});

test("candle market structure filters future candles before building pivots", () => {
  const base = candlesFromCloses([
    1.00, 1.05, 1.10, 1.02, 0.98,
    1.08, 1.18, 1.10, 1.04, 1.16,
    1.28, 1.20, 1.12, 1.26, 1.38,
  ]);
  const future: Candle = {
    timestamp: base.at(-1)!.timestamp + FIVE_MINUTES,
    open: 2,
    high: 3,
    low: 1.9,
    close: 2.8,
    volume: 1_000_000,
  };

  const context = buildCandleMarketStructureContext({
    symbol: "asof",
    candles: [...base, future],
    asOfTimestamp: base.at(-1)!.timestamp,
  });

  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "future_candles_filtered"));
  assert.ok(context.pivots.confirmedHighs.every((pivot) => pivot.price < 3));
});

test("candle market structure reports insufficient data safely", () => {
  const context = buildCandleMarketStructureContext({
    symbol: "thin",
    candles: candlesFromCloses([1, 1.01, 1.02]),
  });

  assert.equal(context.state, "insufficient_data");
  assert.equal(context.confidence.label, "low");
  assert.equal(context.traderLine, undefined);
});

test("candle market structure trader line avoids direct advice and short-side framing", () => {
  const context = buildCandleMarketStructureContext({
    symbol: "safe",
    candles: candlesFromCloses([
      1.00, 1.05, 1.01, 1.06, 1.00,
      1.05, 0.99, 1.06, 1.00, 1.05,
      0.99, 1.06, 1.00, 1.05, 1.01,
      1.06, 1.00, 1.04, 1.01, 1.03,
    ]),
  });

  const line = context.traderLine ?? "";
  assert.doesNotMatch(line, /\b(buy|sell|short|entry|exit|trim|target|should enter|should exit)\b/i);
});
