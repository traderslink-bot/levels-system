import assert from "node:assert/strict";
import test from "node:test";

import { LiveFormalMarketStructureTracker } from "../lib/monitoring/live-formal-market-structure.js";

const FIVE_MINUTES = 5 * 60 * 1000;
const FOUR_HOURS = 4 * 60 * 60 * 1000;

function tick(index: number, price: number, timestampOffset = 0) {
  return {
    symbol: "LIVE",
    timestamp: index * FIVE_MINUTES + timestampOffset,
    lastPrice: price,
    volume: 1000 + index * 100,
  };
}

function buildTracker(): LiveFormalMarketStructureTracker {
  return new LiveFormalMarketStructureTracker({
    minCandles: 8,
    internalLeftBars: 1,
    internalRightBars: 1,
    externalLeftBars: 1,
    externalRightBars: 1,
    equalLevelTolerancePct: 0.001,
    displacementRangeMultiplier: 0.2,
    followThroughBars: 2,
  });
}

test("live formal structure waits for completed 5m candles before confirming events", () => {
  const tracker = buildTracker();
  const prices = [1.04, 1.18, 1.0, 1.3, 1.1, 1.34, 1.22, 1.43];

  prices.forEach((price, index) => {
    assert.equal(tracker.update(tick(index, price)), undefined);
  });

  const context = tracker.update(tick(8, 1.44));
  assert.ok(context);
  assert.equal(context.timeframe, "5m");
  assert.equal(context.debug.candleCount, 8);
  assert.equal(context.eventType, "bos_bullish");
  assert.equal(context.eventFreshness, "fresh");
  assert.equal(context.materialChange, true);
  assert.equal(context.brokenSwingPrice, 1.34);

  const stored = tracker.getContext("LIVE");
  assert.ok(stored);
  assert.equal(stored.eventType, "bos_bullish");
  assert.equal(stored.eventFreshness, "prior");
  assert.equal(stored.materialChange, false);
});

test("live formal structure dedupes material events after the accepted candle boundary", () => {
  const tracker = buildTracker();
  [1.04, 1.18, 1.0, 1.3, 1.1, 1.34, 1.22, 1.43, 1.44].forEach(
    (price, index) => {
      tracker.update(tick(index, price));
    },
  );

  const repeatedSameCandle = tracker.update(tick(8, 1.45, 1000));
  assert.ok(repeatedSameCandle);
  assert.equal(repeatedSameCandle.eventType, "bos_bullish");
  assert.equal(repeatedSameCandle.materialChange, false);

  const nextBucket = tracker.update(tick(9, 1.46));
  assert.ok(nextBucket);
  assert.equal(nextBucket.materialChange, false);
});

test("live formal structure can advance on configured 4h candle boundaries", () => {
  const tracker = new LiveFormalMarketStructureTracker({
    bucketMs: FOUR_HOURS,
    timeframe: "4h",
    minCandles: 8,
    internalLeftBars: 1,
    internalRightBars: 1,
    externalLeftBars: 1,
    externalRightBars: 1,
    equalLevelTolerancePct: 0.001,
    displacementRangeMultiplier: 0.2,
    followThroughBars: 1,
  });
  const prices = [1.04, 1.18, 1.0, 1.3, 1.1, 1.34, 1.22, 1.43];

  prices.forEach((price, index) => {
    tracker.update({
      symbol: "HTF",
      timestamp: index * FOUR_HOURS,
      lastPrice: price,
      volume: 1000 + index * 100,
    });
  });

  const context = tracker.update({
    symbol: "HTF",
    timestamp: prices.length * FOUR_HOURS,
    lastPrice: 1.44,
    volume: 2000,
  });

  assert.ok(context);
  assert.equal(context.timeframe, "4h");
  assert.equal(context.debug.candleCount, 8);
});
