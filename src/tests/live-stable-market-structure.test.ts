import assert from "node:assert/strict";
import test from "node:test";

import { LiveStableMarketStructureTracker } from "../lib/monitoring/live-stable-market-structure.js";

const FIVE_MINUTES = 5 * 60 * 1000;

function tick(
  index: number,
  price: number,
  volume = 1000 + index * 100,
): { symbol: string; timestamp: number; lastPrice: number; volume: number } {
  return {
    symbol: "RANGE",
    timestamp: index * FIVE_MINUTES,
    lastPrice: price,
    volume,
  };
}

test("live stable market structure waits for enough 5m candles before producing context", () => {
  const tracker = new LiveStableMarketStructureTracker({ minCandles: 12 });

  for (let index = 0; index < 11; index += 1) {
    assert.equal(tracker.update(tick(index, 1 + (index % 2) * 0.02)), undefined);
  }

  const context = tracker.update(tick(11, 1.02));
  assert.ok(context);
  assert.equal(context.candleCount, 12);
  assert.notEqual(context.state, "insufficient_data");
  assert.equal(context.materialChange, false);
});

test("live stable market structure marks persistent breakout-style transitions as material", () => {
  const tracker = new LiveStableMarketStructureTracker({
    minCandles: 12,
    persistenceBars: 1,
    materialityThreshold: 0.2,
    highMaterialityThreshold: 0.35,
  });
  const prices = [
    1.00,
    1.05,
    0.99,
    1.06,
    1.00,
    1.05,
    1.01,
    1.06,
    1.00,
    1.05,
    1.01,
    1.06,
    1.12,
    1.18,
    1.22,
    1.24,
  ];
  const contexts: Array<NonNullable<ReturnType<LiveStableMarketStructureTracker["update"]>>> = [];

  prices.forEach((price, index) => {
    const context = tracker.update(tick(index, price));
    if (context) {
      contexts.push(context);
    }
  });

  const latest = contexts.at(-1);
  const material = contexts.find((context) => context.materialChange);
  assert.ok(latest);
  assert.ok(material);
  assert.notEqual(material.previousState, material.state);
  assert.match(latest.structureKey, /^.+\|/);
});
