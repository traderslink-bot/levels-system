import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import {
  candleCloseTimestamp,
  filterCandlesByCloseAsOf,
} from "../lib/market-data/candle-as-of-filter.js";

function candle(timestamp: number, close = 1): Candle {
  return {
    timestamp,
    open: close,
    high: close + 0.05,
    low: close - 0.05,
    close,
    volume: 10_000,
  };
}

test("as-of filtering excludes a 5m 09:30 candle at 09:33 and includes it at 09:35", () => {
  const start = Date.parse("2026-05-01T09:30:00-04:00");
  const partial = filterCandlesByCloseAsOf({
    candles: [candle(start)],
    timeframe: "5m",
    asOfTimestamp: Date.parse("2026-05-01T09:33:00-04:00"),
  });
  const closed = filterCandlesByCloseAsOf({
    candles: [candle(start)],
    timeframe: "5m",
    asOfTimestamp: Date.parse("2026-05-01T09:35:00-04:00"),
  });

  assert.equal(candleCloseTimestamp(candle(start), "5m"), Date.parse("2026-05-01T09:35:00-04:00"));
  assert.equal(partial.candles.length, 0);
  assert.equal(partial.excludedPartialCount, 1);
  assert.ok(partial.diagnostics.some((diagnostic) => diagnostic.code === "partial_candles_filtered"));
  assert.equal(closed.candles.length, 1);
});

test("as-of filtering excludes still-forming 4h and daily candles", () => {
  const fourHourStart = Date.parse("2026-05-01T09:30:00-04:00");
  const dailyStart = Date.parse("2026-05-01T00:00:00-04:00");

  const formingFourHour = filterCandlesByCloseAsOf({
    candles: [candle(fourHourStart)],
    timeframe: "4h",
    asOfTimestamp: Date.parse("2026-05-01T12:00:00-04:00"),
  });
  const closedFourHour = filterCandlesByCloseAsOf({
    candles: [candle(fourHourStart)],
    timeframe: "4h",
    asOfTimestamp: Date.parse("2026-05-01T13:30:00-04:00"),
  });
  const formingDaily = filterCandlesByCloseAsOf({
    candles: [candle(dailyStart)],
    timeframe: "daily",
    asOfTimestamp: Date.parse("2026-05-01T15:59:00-04:00"),
  });
  const closedDaily = filterCandlesByCloseAsOf({
    candles: [candle(dailyStart)],
    timeframe: "daily",
    asOfTimestamp: Date.parse("2026-05-01T16:00:00-04:00"),
  });

  assert.equal(candleCloseTimestamp(candle(fourHourStart), "4h"), Date.parse("2026-05-01T13:30:00-04:00"));
  assert.equal(candleCloseTimestamp(candle(dailyStart), "daily"), Date.parse("2026-05-01T16:00:00-04:00"));
  assert.equal(formingFourHour.candles.length, 0);
  assert.equal(closedFourHour.candles.length, 1);
  assert.equal(formingDaily.candles.length, 0);
  assert.equal(closedDaily.candles.length, 1);
  assert.ok(formingFourHour.diagnostics.some((diagnostic) => diagnostic.code === "partial_candles_filtered"));
  assert.ok(formingDaily.diagnostics.some((diagnostic) => diagnostic.code === "partial_candles_filtered"));
});

test("as-of filtering diagnoses candles that start after the snapshot", () => {
  const asOfTimestamp = Date.parse("2026-05-01T09:35:00-04:00");
  const result = filterCandlesByCloseAsOf({
    candles: [
      candle(Date.parse("2026-05-01T09:30:00-04:00"), 1),
      candle(Date.parse("2026-05-01T09:40:00-04:00"), 2),
    ],
    timeframe: "5m",
    asOfTimestamp,
  });

  assert.equal(result.candles.length, 1);
  assert.equal(result.excludedFutureCount, 1);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "future_candles_filtered"));
});
