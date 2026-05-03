import { strict as assert } from "node:assert";
import test from "node:test";

import { IntradayPriceStructureTracker } from "../lib/monitoring/intraday-price-structure.js";

test("intraday price structure buckets live prices into 5-minute structure context", () => {
  const tracker = new IntradayPriceStructureTracker(5 * 60 * 1000);
  const updates = [
    { timestamp: 0, lastPrice: 1, volume: 100 },
    { timestamp: 60_000, lastPrice: 1.03, volume: 200 },
    { timestamp: 5 * 60_000, lastPrice: 1.02, volume: 300 },
    { timestamp: 6 * 60_000, lastPrice: 1.07, volume: 400 },
    { timestamp: 10 * 60_000, lastPrice: 1.04, volume: 500 },
    { timestamp: 11 * 60_000, lastPrice: 1.1, volume: 600 },
  ];

  let context;
  for (const update of updates) {
    context = tracker.update({ symbol: "CYCU", ...update });
  }

  assert.ok(context);
  assert.equal(context.bucketCount, 3);
  assert.equal(context.baseLow, 1);
  assert.equal(context.baseHigh, 1.1);
  assert.equal(context.higherLowCount, 2);
  assert.equal(context.direction, "building");
});

test("intraday price structure can identify fading lower-high sequences", () => {
  const tracker = new IntradayPriceStructureTracker(5 * 60 * 1000);
  const updates = [
    { timestamp: 0, lastPrice: 1.2 },
    { timestamp: 60_000, lastPrice: 1.25 },
    { timestamp: 5 * 60_000, lastPrice: 1.18 },
    { timestamp: 6 * 60_000, lastPrice: 1.22 },
    { timestamp: 10 * 60_000, lastPrice: 1.14 },
    { timestamp: 11 * 60_000, lastPrice: 1.19 },
  ];

  let context;
  for (const update of updates) {
    context = tracker.update({ symbol: "CYCU", ...update });
  }

  assert.ok(context);
  assert.equal(context.lowerHighCount, 2);
  assert.equal(context.direction, "fading");
});
