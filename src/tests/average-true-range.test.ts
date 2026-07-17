import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import { calculateCompletedFiveMinuteAtr } from "../lib/technical-context/average-true-range.js";

const FIVE_MINUTE_MS = 5 * 60 * 1000;

function candle(index: number, high = 10.1, low = 9.9): Candle {
  return {
    timestamp: index * FIVE_MINUTE_MS,
    open: 10,
    high,
    low,
    close: 10,
    volume: 100_000,
  };
}

test("completed 5m ATR excludes the forming candle", () => {
  const candles = Array.from({ length: 15 }, (_, index) => candle(index));
  candles.push(candle(15, 15, 5));

  const context = calculateCompletedFiveMinuteAtr(
    candles,
    10,
    15 * FIVE_MINUTE_MS + 60_000,
  );

  assert.equal(context.reliability, "reliable");
  assert.equal(context.trueRangeCount, 14);
  assert.equal(context.value, 0.2);
  assert.equal(context.pct, 0.02);
});

test("completed 5m ATR stays unavailable until the full window exists", () => {
  const context = calculateCompletedFiveMinuteAtr(
    Array.from({ length: 14 }, (_, index) => candle(index)),
    10,
    14 * FIVE_MINUTE_MS,
  );

  assert.equal(context.reliability, "unavailable");
  assert.equal(context.value, null);
  assert.match(context.reason ?? "", /15 completed 5-minute candles/);
});

test("completed 5m ATR marks a one-candle-dominated window unstable", () => {
  const candles = Array.from({ length: 15 }, (_, index) => candle(index));
  candles[14] = candle(14, 20, 1);

  const context = calculateCompletedFiveMinuteAtr(
    candles,
    10,
    15 * FIVE_MINUTE_MS,
  );

  assert.equal(context.reliability, "unstable");
  assert.ok((context.value ?? 0) > 1);
  assert.match(context.reason ?? "", /dominates the ATR window/);
});
