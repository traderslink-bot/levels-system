import assert from "node:assert/strict";
import test from "node:test";

import { buildConfirmedRoleFlipCandidate } from "../lib/levels/level-role-flip-detector.js";
import { buildNewRuntimeCompatibleLevelOutput } from "../lib/levels/level-runtime-output-adapter.js";
import type { LevelCandidate, RawLevelCandidate } from "../lib/levels/level-types.js";
import type { Candle } from "../lib/market-data/candle-types.js";

const START = Date.parse("2026-06-01T13:30:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function candle(
  index: number,
  values: Pick<Candle, "open" | "high" | "low" | "close">,
  volume = 1000,
): Candle {
  return {
    timestamp: START + index * DAY,
    volume,
    ...values,
  };
}

function candidate(type: LevelCandidate["type"]): LevelCandidate {
  return {
    id: `TEST-daily-${type}`,
    symbol: "TEST",
    type,
    price: 10,
    zoneLow: 9.975,
    zoneHigh: 10.025,
    sourceTimeframes: ["daily"],
    originKinds: [type === "resistance" ? "swing_high" : "swing_low"],
  };
}

function resistanceToSupportCandles(): Candle[] {
  return [
    candle(0, { open: 9.7, high: 10.05, low: 9.6, close: 9.8 }),
    candle(1, { open: 9.95, high: 10.3, low: 9.9, close: 10.22 }),
    candle(2, { open: 10.2, high: 10.42, low: 10.12, close: 10.3 }),
    candle(3, { open: 10.28, high: 10.4, low: 10.15, close: 10.25 }),
    candle(4, { open: 10.2, high: 10.25, low: 9.99, close: 10.12 }),
    candle(5, { open: 10.14, high: 10.55, low: 10.1, close: 10.45 }),
  ];
}

function supportToResistanceCandles(): Candle[] {
  return [
    candle(0, { open: 10.2, high: 10.3, low: 9.95, close: 10.15 }),
    candle(1, { open: 10.02, high: 10.08, low: 9.68, close: 9.78 }),
    candle(2, { open: 9.8, high: 9.88, low: 9.55, close: 9.7 }),
    candle(3, { open: 9.72, high: 9.85, low: 9.6, close: 9.72 }),
    candle(4, { open: 9.8, high: 10.01, low: 9.75, close: 9.88 }),
    candle(5, { open: 9.86, high: 9.9, low: 9.45, close: 9.5 }),
  ];
}

test("daily resistance becomes support only after two closes, retest, hold, and reaction", () => {
  const result = buildConfirmedRoleFlipCandidate({
    candidate: candidate("resistance"),
    timeframe: "daily",
    candles: resistanceToSupportCandles(),
    formationTimestamp: START,
    referencePrice: 10.4,
  });

  assert.ok(result);
  assert.equal(result.type, "support");
  assert.equal(result.roleFlipCount, 1);
  assert.deepEqual(result.originKinds, ["swing_high", "role_flip"]);
  assert.equal(result.analysisCandles?.[0]?.timestamp, START + 3 * DAY);
  assert.deepEqual(result.roleFlipEvidence, {
    originalType: "resistance",
    flippedType: "support",
    timeframe: "daily",
    formationTimestamp: START,
    firstBreakTimestamp: START + DAY,
    confirmationTimestamp: START + 2 * DAY,
    retestTimestamp: START + 4 * DAY,
    reactionTimestamp: START + 5 * DAY,
  });
});

test("daily support becomes resistance after the mirrored confirmation sequence", () => {
  const result = buildConfirmedRoleFlipCandidate({
    candidate: candidate("support"),
    timeframe: "daily",
    candles: supportToResistanceCandles(),
    formationTimestamp: START,
    referencePrice: 9.6,
  });

  assert.ok(result);
  assert.equal(result.type, "resistance");
  assert.deepEqual(result.originKinds, ["swing_low", "role_flip"]);
});

test("four-hour support becomes resistance under the same closed-bar contract", () => {
  const fourHourCandidate: LevelCandidate = {
    ...candidate("support"),
    sourceTimeframes: ["4h"],
  };
  const result = buildConfirmedRoleFlipCandidate({
    candidate: fourHourCandidate,
    timeframe: "4h",
    candles: supportToResistanceCandles(),
    formationTimestamp: START,
    referencePrice: 9.6,
    asOfTimestamp: START + 6 * DAY,
  });

  assert.ok(result);
  assert.equal(result.type, "resistance");
  assert.equal(result.roleFlipEvidence?.timeframe, "4h");
});

test("one close through a level does not confirm a role flip", () => {
  const candles = resistanceToSupportCandles();
  candles[2] = candle(2, { open: 10.1, high: 10.2, low: 9.95, close: 10 });

  const result = buildConfirmedRoleFlipCandidate({
    candidate: candidate("resistance"),
    timeframe: "daily",
    candles,
    formationTimestamp: START,
    referencePrice: 10.4,
  });

  assert.equal(result, null);
});

test("two closes without a later retest do not confirm a role flip", () => {
  const candles = resistanceToSupportCandles().map((item, index) =>
    index >= 3
      ? candle(index, { open: 10.3, high: 10.6, low: 10.2, close: 10.45 })
      : item,
  );

  const result = buildConfirmedRoleFlipCandidate({
    candidate: candidate("resistance"),
    timeframe: "daily",
    candles,
    formationTimestamp: START,
    referencePrice: 10.4,
  });

  assert.equal(result, null);
});

test("a retest without post-retest movement does not confirm a role flip", () => {
  const candles = resistanceToSupportCandles();
  candles[5] = candle(5, { open: 10.1, high: 10.12, low: 10.04, close: 10.08 });

  const result = buildConfirmedRoleFlipCandidate({
    candidate: candidate("resistance"),
    timeframe: "daily",
    candles,
    formationTimestamp: START,
    referencePrice: 10.08,
  });

  assert.equal(result, null);
});

test("a confirmed flip is rejected after a later two-close invalidation", () => {
  const candles = [
    ...resistanceToSupportCandles(),
    candle(6, { open: 10.1, high: 10.12, low: 9.55, close: 9.7 }),
    candle(7, { open: 9.72, high: 9.8, low: 9.4, close: 9.55 }),
  ];

  const result = buildConfirmedRoleFlipCandidate({
    candidate: candidate("resistance"),
    timeframe: "daily",
    candles,
    formationTimestamp: START,
    referencePrice: 10.4,
  });

  assert.equal(result, null);
});

test("a confirmed flip is rejected after one decisive three-percent invalidation", () => {
  const candles = [
    ...resistanceToSupportCandles(),
    candle(6, { open: 10.1, high: 10.12, low: 9.4, close: 9.6 }),
  ];

  const result = buildConfirmedRoleFlipCandidate({
    candidate: candidate("resistance"),
    timeframe: "daily",
    candles,
    formationTimestamp: START,
    referencePrice: 10.4,
  });

  assert.equal(result, null);
});

test("an invalidation after confirmation cannot be rescued by a later retest", () => {
  const candles = resistanceToSupportCandles();
  candles[3] = candle(3, { open: 10.2, high: 10.22, low: 9.55, close: 9.6 });

  const result = buildConfirmedRoleFlipCandidate({
    candidate: candidate("resistance"),
    timeframe: "daily",
    candles,
    formationTimestamp: START,
    referencePrice: 10.4,
  });

  assert.equal(result, null);
});

test("reference price must still be on the confirmed new side", () => {
  const result = buildConfirmedRoleFlipCandidate({
    candidate: candidate("resistance"),
    timeframe: "daily",
    candles: resistanceToSupportCandles(),
    formationTimestamp: START,
    referencePrice: 9.9,
  });

  assert.equal(result, null);
});

test("reference price inside or exactly on the zone cannot certify the new role", () => {
  for (const referencePrice of [10, 10.025]) {
    const result = buildConfirmedRoleFlipCandidate({
      candidate: candidate("resistance"),
      timeframe: "daily",
      candles: resistanceToSupportCandles(),
      formationTimestamp: START,
      referencePrice,
    });
    assert.equal(result, null);
  }
});

test("zero-volume higher-timeframe placeholders cannot complete confirmation", () => {
  const candles = resistanceToSupportCandles();
  candles[2] = { ...candles[2]!, volume: 0 };
  candles[3] = candle(3, { open: 10.1, high: 10.2, low: 9.95, close: 10 });

  const result = buildConfirmedRoleFlipCandidate({
    candidate: candidate("resistance"),
    timeframe: "daily",
    candles,
    formationTimestamp: START,
    referencePrice: 10.4,
  });

  assert.equal(result, null);
});

test("an unclosed final four-hour candle cannot become the second break close", () => {
  const fourHourCandidate: LevelCandidate = {
    ...candidate("resistance"),
    sourceTimeframes: ["4h"],
  };
  const result = buildConfirmedRoleFlipCandidate({
    candidate: fourHourCandidate,
    timeframe: "4h",
    candles: resistanceToSupportCandles(),
    formationTimestamp: START,
    referencePrice: 10.4,
    asOfTimestamp: START + 2 * DAY + 2 * 60 * 60 * 1000,
  });

  assert.equal(result, null);
});

test("duplicate timestamps cannot supply two distinct confirmation closes", () => {
  const candles = resistanceToSupportCandles();
  candles[2] = { ...candles[2]!, timestamp: candles[1]!.timestamp };
  candles[3] = candle(3, { open: 10.1, high: 10.2, low: 9.95, close: 10 });

  const result = buildConfirmedRoleFlipCandidate({
    candidate: candidate("resistance"),
    timeframe: "daily",
    candles,
    formationTimestamp: START,
    referencePrice: 10.4,
  });

  assert.equal(result, null);
});

test("runtime adapter replaces the crossed source candidate with the confirmed role", () => {
  const rawCandidate: RawLevelCandidate = {
    id: "TEST-daily-resistance-source",
    symbol: "TEST",
    price: 10,
    kind: "resistance",
    timeframe: "daily",
    sourceType: "swing_high",
    touchCount: 2,
    reactionScore: 0.6,
    reactionQuality: 0.6,
    rejectionScore: 0.6,
    displacementScore: 0.5,
    sessionSignificance: 0.8,
    followThroughScore: 0.7,
    repeatedReactionCount: 2,
    gapStructure: false,
    firstTimestamp: START,
    lastTimestamp: START,
    notes: [],
  };

  const projection = buildNewRuntimeCompatibleLevelOutput({
    symbol: "TEST",
    rawCandidates: [rawCandidate],
    candlesByTimeframe: { daily: resistanceToSupportCandles() },
    metadata: {
      providerByTimeframe: { daily: "eodhd" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10.4,
    },
    specialLevels: {},
    generatedAt: START + 6 * DAY,
  });

  assert.equal(projection.rankedOutput.resistances.length, 0);
  assert.equal(projection.rankedOutput.supports.length, 1);
  assert.equal(projection.rankedOutput.supports[0]?.state, "flipped");
  assert.ok(projection.rankedOutput.supports[0]?.originKinds.includes("role_flip"));
  assert.equal(projection.output.majorSupport[0]?.firstTimestamp, START);
  assert.equal(projection.output.majorSupport[0]?.lastTimestamp, START + 5 * DAY);
});

test("runtime adapter uses the source-series as-of cutoff instead of generation wall time", () => {
  const rawCandidate: RawLevelCandidate = {
    id: "TEST-daily-as-of-cutoff",
    symbol: "TEST",
    price: 10,
    kind: "resistance",
    timeframe: "daily",
    sourceType: "swing_high",
    touchCount: 2,
    reactionScore: 0.6,
    reactionQuality: 0.6,
    rejectionScore: 0.6,
    displacementScore: 0.5,
    sessionSignificance: 0.8,
    followThroughScore: 0.7,
    repeatedReactionCount: 2,
    gapStructure: false,
    firstTimestamp: START,
    lastTimestamp: START,
    notes: [],
  };

  const projection = buildNewRuntimeCompatibleLevelOutput({
    symbol: "TEST",
    rawCandidates: [rawCandidate],
    candlesByTimeframe: { daily: resistanceToSupportCandles() },
    metadata: {
      providerByTimeframe: { daily: "eodhd" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10.4,
    },
    specialLevels: {},
    generatedAt: START + 30 * DAY,
    asOfTimestampByTimeframe: {
      daily: START + 2 * DAY + 12 * 60 * 60 * 1000,
    },
  });

  assert.equal(projection.rankedOutput.supports.length, 0);
  assert.equal(projection.rankedOutput.resistances.length, 0);
});

test("runtime adapter suppresses a crossed level when flip evidence is incomplete", () => {
  const rawCandidate: RawLevelCandidate = {
    id: "TEST-daily-unconfirmed-cross",
    symbol: "TEST",
    price: 10,
    kind: "resistance",
    timeframe: "daily",
    sourceType: "swing_high",
    touchCount: 2,
    reactionScore: 0.6,
    reactionQuality: 0.6,
    rejectionScore: 0.6,
    displacementScore: 0.5,
    sessionSignificance: 0.8,
    followThroughScore: 0.7,
    repeatedReactionCount: 2,
    gapStructure: false,
    firstTimestamp: START,
    lastTimestamp: START,
    notes: [],
  };
  const incompleteCandles = resistanceToSupportCandles().slice(0, 3);
  const projection = buildNewRuntimeCompatibleLevelOutput({
    symbol: "TEST",
    rawCandidates: [rawCandidate],
    candlesByTimeframe: { daily: incompleteCandles },
    metadata: {
      providerByTimeframe: { daily: "eodhd" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10.4,
    },
    specialLevels: {},
  });

  assert.equal(projection.rankedOutput.supports.length, 0);
  assert.equal(projection.rankedOutput.resistances.length, 0);
});

test("runtime adapter keeps an original level while price is testing inside its zone", () => {
  const rawCandidate: RawLevelCandidate = {
    id: "TEST-daily-support-under-test",
    symbol: "TEST",
    price: 10,
    kind: "support",
    timeframe: "daily",
    sourceType: "swing_low",
    touchCount: 2,
    reactionScore: 0.6,
    reactionQuality: 0.6,
    rejectionScore: 0.6,
    displacementScore: 0.5,
    sessionSignificance: 0.8,
    followThroughScore: 0.7,
    repeatedReactionCount: 2,
    gapStructure: false,
    firstTimestamp: START,
    lastTimestamp: START,
    notes: [],
  };
  for (const referencePrice of [9.99, 10.01]) {
    const projection = buildNewRuntimeCompatibleLevelOutput({
      symbol: "TEST",
      rawCandidates: [rawCandidate],
      candlesByTimeframe: {
        daily: [
          candle(0, { open: 10.1, high: 10.2, low: 9.99, close: 10.15 }),
          candle(1, { open: 10.08, high: 10.18, low: 9.98, close: 10.1 }),
        ],
      },
      metadata: {
        providerByTimeframe: { daily: "eodhd" },
        dataQualityFlags: [],
        freshness: "fresh",
        referencePrice,
      },
      specialLevels: {},
    });

    assert.equal(projection.rankedOutput.supports.length, 1);
    assert.equal(projection.surfacedSelection.surfacedSupports[0]?.price, 10);
    assert.equal(projection.comparableOutput.nearestSupport?.price, 10);
    assert.equal(projection.rankedOutput.resistances.length, 0);
  }
});

test("a perfect five-minute crossing is suppressed rather than minted as a role flip", () => {
  const rawCandidate: RawLevelCandidate = {
    id: "TEST-5m-cross",
    symbol: "TEST",
    price: 10,
    kind: "resistance",
    timeframe: "5m",
    sourceType: "swing_high",
    touchCount: 2,
    reactionScore: 0.6,
    reactionQuality: 0.6,
    rejectionScore: 0.6,
    displacementScore: 0.5,
    sessionSignificance: 0.8,
    followThroughScore: 0.7,
    repeatedReactionCount: 2,
    gapStructure: false,
    firstTimestamp: START,
    lastTimestamp: START,
    notes: [],
  };
  const projection = buildNewRuntimeCompatibleLevelOutput({
    symbol: "TEST",
    rawCandidates: [rawCandidate],
    candlesByTimeframe: { "5m": resistanceToSupportCandles() },
    metadata: {
      providerByTimeframe: { "5m": "eodhd" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10.4,
    },
    specialLevels: {},
  });

  assert.equal(projection.rankedOutput.supports.length, 0);
  assert.equal(projection.rankedOutput.resistances.length, 0);
});
