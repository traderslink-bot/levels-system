import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import { buildVolumeMarketFacts } from "../lib/volume/index.js";

function candle(
  timestamp: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
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

function volumeFixture(currentVolume: number): Candle[] {
  return [
    candle("2026-05-01T09:30:00-04:00", 10, 10.1, 9.9, 10, 1_000),
    candle("2026-05-01T09:35:00-04:00", 10, 10.1, 9.9, 10, 1_000),
    candle("2026-05-01T09:40:00-04:00", 10, 10.1, 9.9, 10, 1_000),
    candle("2026-05-01T09:45:00-04:00", 10, 10.1, 9.9, 10, 1_000),
    candle("2026-05-01T09:50:00-04:00", 10, 10.1, 9.9, 10, 1_000),
    candle("2026-05-01T09:55:00-04:00", 10, 10.1, 9.9, 10, currentVolume),
  ];
}

function factsForVolumes(volumes: number[], referencePrice = 10) {
  const candles = volumes.map((volume, index) =>
    candle(
      `2026-05-01T09:${(30 + index * 5).toString().padStart(2, "0")}:00-04:00`,
      10 + index * 0.02,
      10.1 + index * 0.02,
      9.9 + index * 0.02,
      10 + index * 0.02,
      volume,
    ),
  );

  return buildVolumeMarketFacts({
    symbol: "vol",
    asOfTimestamp: Date.parse("2026-05-01T10:05:00-04:00"),
    candles5m: candles,
    referencePrice,
  });
}

test("buildVolumeMarketFacts calculates current rolling relative and dollar volume facts", () => {
  const facts = buildVolumeMarketFacts({
    symbol: "calc",
    asOfTimestamp: Date.parse("2026-05-01T10:05:00-04:00"),
    candles5m: volumeFixture(2_500),
    referencePrice: 10,
  });

  assert.equal(facts.symbol, "CALC");
  assert.equal(facts.currentVolume, 2_500);
  assert.equal(facts.rollingAverageVolume, 1_000);
  assert.equal(facts.relativeVolume, 2.5);
  assert.equal(facts.dollarVolume, 75_000);
  assert.equal(facts.volumeState, "high");
  assert.equal(facts.liquidityQuality, "thin");
});

test("buildVolumeMarketFacts classifies low normal elevated high and extreme volume states", () => {
  const cases = [
    [500, "low"],
    [1_000, "normal"],
    [2_000, "elevated"],
    [3_000, "high"],
    [5_000, "extreme"],
  ] as const;

  for (const [currentVolume, expected] of cases) {
    const facts = buildVolumeMarketFacts({
      symbol: `state-${expected}`,
      asOfTimestamp: Date.parse("2026-05-01T10:05:00-04:00"),
      candles5m: volumeFixture(currentVolume),
      referencePrice: 10,
    });

    assert.equal(facts.volumeState, expected);
  }
});

test("buildVolumeMarketFacts classifies liquidity quality from fact-only dollar volume", () => {
  const cases = [
    [[1_000, 1_000, 1_000, 1_000, 1_000, 5_000], "thin"],
    [[8_000, 8_000, 8_000, 8_000, 8_000, 10_000], "acceptable"],
    [[30_000, 30_000, 30_000, 30_000, 30_000, 50_000], "good"],
    [[100_000, 100_000, 100_000, 100_000, 100_000, 120_000], "strong"],
  ] as const;

  for (const [volumes, expected] of cases) {
    const facts = factsForVolumes([...volumes], 10);
    assert.equal(facts.liquidityQuality, expected);
  }
});

test("buildVolumeMarketFacts classifies volume acceleration states", () => {
  assert.equal(factsForVolumes([1_000, 1_000, 1_000, 500, 600, 550]).accelerationState, "decelerating");
  assert.equal(factsForVolumes([1_000, 1_000, 1_000, 950, 1_050, 1_000]).accelerationState, "steady");
  assert.equal(factsForVolumes([1_000, 1_000, 1_000, 1_300, 1_400, 1_500]).accelerationState, "building");
  assert.equal(factsForVolumes([1_000, 1_000, 1_000, 3_000, 3_500, 4_000]).accelerationState, "surging");
  assert.equal(factsForVolumes([1_000, 1_000, 1_000, 6_000, 8_000, 3_000]).accelerationState, "exhaustion_risk");
});

test("buildVolumeMarketFacts detects pullback dry-up and selling pressure increasing", () => {
  const dryUp = buildVolumeMarketFacts({
    symbol: "dry",
    asOfTimestamp: Date.parse("2026-05-01T10:05:00-04:00"),
    referencePrice: 10,
    candles5m: [
      candle("2026-05-01T09:30:00-04:00", 10, 10.2, 9.9, 10.1, 1_000),
      candle("2026-05-01T09:35:00-04:00", 10.1, 10.3, 10, 10.2, 1_000),
      candle("2026-05-01T09:40:00-04:00", 10.2, 10.4, 10.1, 10.3, 1_000),
      candle("2026-05-01T09:45:00-04:00", 10.3, 10.35, 10.05, 10.15, 500),
      candle("2026-05-01T09:50:00-04:00", 10.15, 10.2, 9.95, 10.05, 450),
      candle("2026-05-01T09:55:00-04:00", 10.05, 10.1, 9.9, 9.95, 400),
    ],
  });
  const sellingPressure = buildVolumeMarketFacts({
    symbol: "sell",
    asOfTimestamp: Date.parse("2026-05-01T10:05:00-04:00"),
    referencePrice: 10,
    candles5m: [
      candle("2026-05-01T09:30:00-04:00", 10, 10.2, 9.9, 10.1, 1_000),
      candle("2026-05-01T09:35:00-04:00", 10.1, 10.3, 10, 10.2, 1_000),
      candle("2026-05-01T09:40:00-04:00", 10.2, 10.4, 10.1, 10.3, 1_000),
      candle("2026-05-01T09:45:00-04:00", 10.3, 10.35, 10.05, 10.15, 1_600),
      candle("2026-05-01T09:50:00-04:00", 10.15, 10.2, 9.95, 10.05, 1_800),
      candle("2026-05-01T09:55:00-04:00", 10.05, 10.1, 9.9, 9.95, 2_000),
    ],
  });

  assert.equal(dryUp.pullbackVolumeState, "drying_up");
  assert.equal(sellingPressure.pullbackVolumeState, "selling_pressure_increasing");
});

test("buildVolumeMarketFacts classifies breakout volume weak confirmed strong and exhaustion risk", () => {
  const breakoutFacts = (currentVolume: number) =>
    buildVolumeMarketFacts({
      symbol: "brk",
      asOfTimestamp: Date.parse("2026-05-01T10:05:00-04:00"),
      referencePrice: 11,
      candles5m: [
        candle("2026-05-01T09:30:00-04:00", 10, 10.2, 9.9, 10.1, 1_000),
        candle("2026-05-01T09:35:00-04:00", 10.1, 10.3, 10, 10.2, 1_000),
        candle("2026-05-01T09:40:00-04:00", 10.2, 10.4, 10.1, 10.3, 1_000),
        candle("2026-05-01T09:45:00-04:00", 10.3, 10.45, 10.2, 10.35, 1_000),
        candle("2026-05-01T09:50:00-04:00", 10.35, 10.5, 10.3, 10.4, 1_000),
        candle("2026-05-01T09:55:00-04:00", 10.4, 11.1, 10.35, 11, currentVolume),
      ],
    });

  assert.equal(breakoutFacts(800).breakoutVolumeState, "weak");
  assert.equal(breakoutFacts(1_500).breakoutVolumeState, "confirmed");
  assert.equal(breakoutFacts(2_500).breakoutVolumeState, "strong");
  assert.equal(breakoutFacts(5_000).breakoutVolumeState, "exhaustion_risk");
});

test("buildVolumeMarketFacts excludes future and partial candles using candle-close semantics", () => {
  const facts = buildVolumeMarketFacts({
    symbol: "asof",
    asOfTimestamp: Date.parse("2026-05-01T09:33:00-04:00"),
    referencePrice: 10,
    candles5m: [
      candle("2026-05-01T09:25:00-04:00", 10, 10.1, 9.9, 10, 100),
      candle("2026-05-01T09:30:00-04:00", 10, 10.5, 9.9, 10.4, 500),
      candle("2026-05-01T09:35:00-04:00", 10.4, 10.8, 10.3, 10.7, 900),
    ],
  });

  assert.equal(facts.currentVolume, 100);
  assert.equal(facts.rollingAverageVolume, undefined);
  assert.equal(facts.dollarVolume, 1_000);
  assert.ok(facts.diagnostics.some((diagnostic) => diagnostic.code === "partial_candles_filtered"));
  assert.ok(facts.diagnostics.some((diagnostic) => diagnostic.code === "future_candles_filtered"));
  assert.ok(facts.diagnostics.some((diagnostic) => diagnostic.code === "insufficient_rolling_volume_history"));
});

test("buildVolumeMarketFacts reports missing reference price for dollar volume", () => {
  const facts = buildVolumeMarketFacts({
    symbol: "nodollar",
    asOfTimestamp: Date.parse("2026-05-01T10:05:00-04:00"),
    candles5m: volumeFixture(1_000),
  });

  assert.equal(facts.dollarVolume, undefined);
  assert.equal(facts.liquidityQuality, "unknown");
  assert.ok(facts.diagnostics.some((diagnostic) => diagnostic.code === "no_reference_price_for_dollar_volume"));
});

test("buildVolumeMarketFacts does not mutate input candles and is deterministic", () => {
  const candles = volumeFixture(2_500).reverse();
  const before = structuredClone(candles);
  const request = {
    symbol: "det",
    asOfTimestamp: Date.parse("2026-05-01T10:05:00-04:00"),
    candles5m: candles,
    referencePrice: 10,
  };

  const first = buildVolumeMarketFacts(request);
  const second = buildVolumeMarketFacts(request);

  assert.deepEqual(first, second);
  assert.deepEqual(candles, before);
});
