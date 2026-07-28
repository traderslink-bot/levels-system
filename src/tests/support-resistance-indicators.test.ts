import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDynamicLevelsFromCandles,
  calculateEmaSeries,
  calculateLatestEma,
  calculateLatestVwap,
  calculateVwapSeries,
  type Candle,
} from "../lib/support-resistance/index.js";

function candle(timestamp: number, close: number, volume = 100): Candle {
  return {
    timestamp,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume,
  };
}

test("shared EMA utility calculates seeded EMA series from close prices", () => {
  const candles = [1, 2, 3, 4, 5].map((close, index) => candle(index + 1, close));

  const series = calculateEmaSeries(candles, 3);

  assert.equal(series.length, 3);
  assert.equal(series[0]?.timestamp, 3);
  assert.equal(series[0]?.value, 2);
  assert.equal(series[1]?.value, 3);
  assert.equal(series[2]?.value, 4);
  assert.equal(calculateLatestEma(candles, 3), 4);
});

test("shared VWAP utility calculates session VWAP with positive per-bar volume", () => {
  const firstSession = Date.UTC(2026, 4, 1, 13, 30);
  const secondSession = Date.UTC(2026, 4, 2, 13, 30);
  const candles: Candle[] = [
    candle(firstSession, 10, 100),
    candle(firstSession + 5 * 60 * 1000, 20, 300),
    candle(secondSession, 50, 1_000),
  ];

  const series = calculateVwapSeries(candles, { sessionDate: "2026-05-01" });

  assert.equal(series.length, 2);
  assert.equal(series[0]?.value, 10);
  assert.equal(series[1]?.value, 17.5);
  assert.equal(calculateLatestVwap(candles, { sessionDate: "2026-05-01" }), 17.5);
});

test("dynamic level helper returns VWAP and common intraday EMAs", () => {
  const start = Date.UTC(2026, 4, 1, 13, 30);
  const candles = Array.from({ length: 25 }, (_, index) =>
    candle(start + index * 5 * 60 * 1000, 10 + index, 1_000 + index * 10),
  );

  const dynamicLevels = buildDynamicLevelsFromCandles(candles, {
    sessionDate: "2026-05-01",
  });

  assert.ok(dynamicLevels.vwap !== null);
  assert.ok(dynamicLevels.ema9 !== null);
  assert.ok(dynamicLevels.ema20 !== null);
  assert.equal(dynamicLevels.emaByPeriod[9], dynamicLevels.ema9);
  assert.equal(dynamicLevels.emaByPeriod[20], dynamicLevels.ema20);
  assert.deepEqual(dynamicLevels.diagnostics, []);
});
