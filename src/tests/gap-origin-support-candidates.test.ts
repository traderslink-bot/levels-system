import test from "node:test";
import assert from "node:assert/strict";

import { buildGapOriginSupportCandidates } from "../lib/levels/raw-level-candidate-builder.js";
import type { Candle } from "../lib/market-data/candle-types.js";

test("buildGapOriginSupportCandidates adds daily gap-up origin and pullback-low supports", () => {
  const candles: Candle[] = [
    {
      timestamp: new Date(2026, 5, 17).getTime(),
      open: 3.59,
      high: 5.18,
      low: 3.23,
      close: 4.6101,
      volume: 11_221_747,
    },
    {
      timestamp: new Date(2026, 5, 18).getTime(),
      open: 5.25,
      high: 16.2,
      low: 4.75,
      close: 7.2499,
      volume: 88_827_592,
    },
  ];

  const candidates = buildGapOriginSupportCandidates({
    symbol: "CAST",
    timeframe: "daily",
    candles,
  });

  assert.deepEqual(candidates.map((candidate) => candidate.price), [5.18, 4.75]);
  assert.deepEqual(candidates.map((candidate) => candidate.kind), ["support", "support"]);
  assert.deepEqual(candidates.map((candidate) => candidate.sourceType), [
    "gap_up_origin",
    "gap_up_pullback_low",
  ]);
  assert.equal(candidates[0]?.gapStructure, true);
  assert.equal(candidates[1]?.gapStructure, true);
  assert.equal(candidates[0]?.lastTimestamp, new Date(2026, 5, 18).getTime());
  assert.equal(candidates[1]?.lastTimestamp, new Date(2026, 5, 18).getTime());
});

test("buildGapOriginSupportCandidates ignores non-daily candles", () => {
  const candidates = buildGapOriginSupportCandidates({
    symbol: "CAST",
    timeframe: "5m",
    candles: [
      { timestamp: 1, open: 1, high: 1.2, low: 0.9, close: 1.1, volume: 100 },
      { timestamp: 2, open: 1.3, high: 1.6, low: 1.2, close: 1.5, volume: 200 },
    ],
  });

  assert.equal(candidates.length, 0);
});

test("buildGapOriginSupportCandidates removes a gap support after a confirmed breakdown", () => {
  const candles: Candle[] = [
    { timestamp: 1, open: 8.8, high: 10, low: 8.5, close: 9, volume: 100 },
    { timestamp: 2, open: 10.5, high: 12, low: 9.9, close: 11, volume: 200 },
    { timestamp: 3, open: 9, high: 9.2, low: 7.2, close: 7.5, volume: 180 },
    { timestamp: 4, open: 7.4, high: 7.6, low: 6.2, close: 6.5, volume: 170 },
  ];

  const candidates = buildGapOriginSupportCandidates({
    symbol: "BROKEN",
    timeframe: "daily",
    candles,
  });

  assert.deepEqual(candidates, []);
});
