import assert from "node:assert/strict";
import test from "node:test";

import {
  getFreshFormalBosChochMarketStructureStoryKeys,
  getMaterialMarketStructureStoryKeys,
  isActionableFormalBosChoch,
  MarketStructureStoryMemory,
} from "../lib/monitoring/market-structure-story-memory.js";
import type {
  FormalMarketStructureRuntimeContext,
  RuntimeMarketStructureSnapshot,
  StableMarketStructureRuntimeContext,
} from "../lib/monitoring/monitoring-types.js";

function formalStructure(
  overrides: Partial<FormalMarketStructureRuntimeContext> = {},
): FormalMarketStructureRuntimeContext {
  return {
    timeframe: "4h",
    bias: "bullish",
    previousBias: "range",
    eventType: "bos_bullish",
    eventFreshness: "fresh",
    triggerTimestamp: "2026-05-14T14:00:00.000Z",
    confirmation: "close_confirmed",
    confidence: "high",
    confidenceScore: 86,
    materialChange: true,
    brokenSwingPrice: 2.45,
    sweptSwingPrice: null,
    protectedHigh: 2.74,
    protectedLow: 2.16,
    latestHigh: 2.74,
    latestLow: 2.16,
    swingSequence: ["HL", "HH"],
    structureKey: "4h|bos_bullish|2.45",
    traderLine: "4h bullish BOS above 2.45",
    debug: {
      candleCount: 80,
      reasons: [],
    },
    ...overrides,
  };
}

function stableStructure(
  overrides: Partial<StableMarketStructureRuntimeContext> = {},
): StableMarketStructureRuntimeContext {
  return {
    state: "reclaim_confirmed",
    previousState: "range_bound",
    structureKey: "reclaim_confirmed|low:1.190|high:1.390",
    materialChange: true,
    confidence: "high",
    materialityScore: 0.8,
    rawState: "reclaim_confirmed",
    reason: "high_materiality_change",
    candleCount: 80,
    latestSwingLow: 1.19,
    latestSwingHigh: 1.39,
    ...overrides,
  };
}

function snapshotWithFormal(
  formal: FormalMarketStructureRuntimeContext,
): RuntimeMarketStructureSnapshot {
  return {
    timeframes: {
      [formal.timeframe]: {
        formal,
      },
    },
    ...(formal.timeframe === "5m" ? { formal } : {}),
  };
}

function snapshotWithFormals(
  formals: FormalMarketStructureRuntimeContext[],
): RuntimeMarketStructureSnapshot {
  const timeframes: NonNullable<RuntimeMarketStructureSnapshot["timeframes"]> = {};
  for (const formal of formals) {
    timeframes[formal.timeframe] = {
      ...(timeframes[formal.timeframe] ?? {}),
      formal,
    };
  }

  const tactical = timeframes["5m"]?.formal;
  return {
    timeframes,
    ...(tactical ? { formal: tactical } : {}),
  };
}

test("market structure story memory carries fresh formal structure forward once", () => {
  const memory = new MarketStructureStoryMemory({
    pendingTtlMs: 60_000,
    postedWindowMs: 60 * 60_000,
  });
  const freshSnapshot = snapshotWithFormal(formalStructure());
  const quietSnapshot = snapshotWithFormal(
    formalStructure({
      eventFreshness: "prior",
      materialChange: false,
    }),
  );

  assert.deepEqual(memory.capture("abcd", 1_000, freshSnapshot), [
    "4h|formal|4h|bos_bullish|2.45",
  ]);

  const firstDecision = memory.decide("ABCD", 2_000, quietSnapshot);
  assert.equal(firstDecision.includeStory, true);
  assert.equal(firstDecision.reason, "pending_fresh_structure");
  assert.equal(firstDecision.snapshot, freshSnapshot);

  memory.markPosted("ABCD", 2_000, firstDecision.snapshot, firstDecision.keys);

  const secondDecision = memory.decide("ABCD", 3_000, quietSnapshot);
  assert.equal(secondDecision.includeStory, false);
  assert.equal(secondDecision.reason, "quiet_structure");
  assert.equal(secondDecision.snapshot, quietSnapshot);
});

test("market structure story memory expires pending structure that never posts", () => {
  const memory = new MarketStructureStoryMemory({
    pendingTtlMs: 500,
    postedWindowMs: 60 * 60_000,
  });
  const freshSnapshot = snapshotWithFormal(formalStructure());
  const quietSnapshot = snapshotWithFormal(
    formalStructure({
      eventFreshness: "prior",
      materialChange: false,
    }),
  );

  memory.capture("ABCD", 1_000, freshSnapshot);
  const decision = memory.decide("ABCD", 1_501, quietSnapshot);

  assert.equal(decision.includeStory, false);
  assert.equal(decision.reason, "quiet_structure");
  assert.equal(decision.snapshot, quietSnapshot);
});

test("market structure story memory reports expired pending structure", () => {
  const memory = new MarketStructureStoryMemory({
    pendingTtlMs: 500,
    postedWindowMs: 60 * 60_000,
  });
  const freshSnapshot = snapshotWithFormal(formalStructure());

  memory.capture("ABCD", 1_000, freshSnapshot);
  const expired = memory.consumeExpired("ABCD", 1_501);

  assert.equal(expired.length, 1);
  assert.equal(expired[0]?.key, "4h|formal|4h|bos_bullish|2.45");
  assert.equal(expired[0]?.capturedAt, 1_000);
  assert.equal(expired[0]?.expiresAt, 1_500);
  assert.equal(expired[0]?.expiredAt, 1_501);
  assert.equal(memory.decide("ABCD", 1_502, null).includeStory, false);
});

test("market structure story memory does not report posted pending structure as expired", () => {
  const memory = new MarketStructureStoryMemory({
    pendingTtlMs: 500,
    postedWindowMs: 60 * 60_000,
  });
  const freshSnapshot = snapshotWithFormal(formalStructure());

  const keys = memory.capture("ABCD", 1_000, freshSnapshot);
  memory.markPosted("ABCD", 1_100, freshSnapshot, keys);

  assert.deepEqual(memory.consumeExpired("ABCD", 1_501), []);
});

test("market structure story memory does not promote prior formal context by itself", () => {
  const memory = new MarketStructureStoryMemory();
  const quietSnapshot = snapshotWithFormal(
    formalStructure({
      eventFreshness: "prior",
      materialChange: false,
    }),
  );

  assert.deepEqual(getMaterialMarketStructureStoryKeys(quietSnapshot), []);

  const decision = memory.decide("ABCD", 1_000, quietSnapshot);
  assert.equal(decision.includeStory, false);
  assert.equal(decision.reason, "quiet_structure");
  assert.equal(decision.snapshot, quietSnapshot);
});

test("market structure story memory can tell a current fresh event without pre-capture", () => {
  const memory = new MarketStructureStoryMemory();
  const freshSnapshot = snapshotWithFormal(
    formalStructure({
      structureKey: "4h|choch_bearish|1.92",
      eventType: "choch_bearish",
      bias: "bearish_transition",
      brokenSwingPrice: 1.92,
    }),
  );

  const decision = memory.decide("ABCD", 1_000, freshSnapshot);
  assert.equal(decision.includeStory, true);
  assert.equal(decision.reason, "current_material_structure");
  assert.deepEqual(decision.keys, ["4h|formal|4h|choch_bearish|1.92"]);

  memory.markPosted("ABCD", 1_000, decision.snapshot, decision.keys);
  assert.equal(memory.decide("ABCD", 2_000, freshSnapshot).includeStory, false);
});

test("market structure story memory keeps medium-confidence 5m formal BOS/CHOCH metadata-only", () => {
  const memory = new MarketStructureStoryMemory();
  const weakTactical = formalStructure({
    timeframe: "5m",
    structureKey: "5m|bos_bearish|1.59",
    eventType: "bos_bearish",
    bias: "bearish_transition",
    confidence: "medium",
    confidenceScore: 0.64,
    brokenSwingPrice: 1.59,
  });
  const snapshot = snapshotWithFormal(weakTactical);

  assert.equal(isActionableFormalBosChoch("5m", weakTactical, snapshot.timeframes?.["5m"]), false);
  assert.deepEqual(getMaterialMarketStructureStoryKeys(snapshot), []);
  assert.deepEqual(getFreshFormalBosChochMarketStructureStoryKeys(snapshot), []);
  assert.deepEqual(memory.capture("CLWT", 1_000, snapshot), []);
  assert.equal(memory.decide("CLWT", 1_000, snapshot).includeStory, false);
});

test("market structure story memory allows medium 5m BOS/CHOCH when stable structure confirms direction", () => {
  const memory = new MarketStructureStoryMemory();
  const tactical = formalStructure({
    timeframe: "5m",
    structureKey: "5m|bos_bullish|2.10",
    brokenSwingPrice: 2.1,
    confidence: "medium",
    confidenceScore: 0.68,
  });
  const snapshot: RuntimeMarketStructureSnapshot = {
    timeframes: {
      "5m": {
        formal: tactical,
        stable: stableStructure({
          state: "breakout_holding",
          materialChange: true,
          confidence: "high",
        }),
      },
    },
    formal: tactical,
  };

  assert.equal(isActionableFormalBosChoch("5m", tactical, snapshot.timeframes?.["5m"]), true);
  assert.deepEqual(memory.capture("SOFI", 1_000, snapshot), [
    "5m|formal|5m|bos_bullish|2.10",
    "5m|stable|reclaim_confirmed|low:1.190|high:1.390",
  ]);
});

test("market structure story memory only marks the pending keys represented by the selected snapshot", () => {
  const memory = new MarketStructureStoryMemory({
    pendingTtlMs: 60_000,
    postedWindowMs: 60 * 60_000,
  });
  const fourHourSnapshot = snapshotWithFormal(formalStructure());
  const fiveMinuteSnapshot = snapshotWithFormal(
    formalStructure({
      timeframe: "5m",
      structureKey: "5m|choch_bearish|1.92",
      eventType: "choch_bearish",
      bias: "bearish_transition",
      brokenSwingPrice: 1.92,
    }),
  );
  fiveMinuteSnapshot.timeframes!["5m"]!.stable = stableStructure({
    state: "pivot_lost",
    materialChange: true,
    confidence: "high",
  });

  memory.capture("ABCD", 1_000, fiveMinuteSnapshot);
  memory.capture("ABCD", 2_000, fourHourSnapshot);

  const firstDecision = memory.decide("ABCD", 3_000, null);
  assert.equal(firstDecision.snapshot, fourHourSnapshot);
  assert.deepEqual(firstDecision.keys, ["4h|formal|4h|bos_bullish|2.45"]);

  memory.markPosted("ABCD", 3_000, firstDecision.snapshot, firstDecision.keys);

  const secondDecision = memory.decide("ABCD", 4_000, null);
  assert.equal(secondDecision.snapshot, fiveMinuteSnapshot);
  assert.deepEqual(secondDecision.keys, ["5m|formal|5m|choch_bearish|1.92"]);
});

test("market structure story memory prioritizes fresh formal BOS/CHOCH over stable context", () => {
  const memory = new MarketStructureStoryMemory({
    pendingTtlMs: 60_000,
    postedWindowMs: 60 * 60_000,
  });
  const fiveMinuteFormal = formalStructure({
    timeframe: "5m",
    structureKey: "5m|bos_bullish|2.10",
    brokenSwingPrice: 2.1,
  });
  const mixedSnapshot: RuntimeMarketStructureSnapshot = {
    timeframes: {
      "4h": {
        stable: stableStructure(),
      },
      "5m": {
        formal: fiveMinuteFormal,
        stable: stableStructure({
          state: "breakout_holding",
          materialChange: true,
          confidence: "high",
        }),
      },
    },
    formal: fiveMinuteFormal,
  };

  assert.deepEqual(memory.capture("AUUD", 1_000, mixedSnapshot), [
    "4h|stable|reclaim_confirmed|low:1.190|high:1.390",
    "5m|formal|5m|bos_bullish|2.10",
    "5m|stable|reclaim_confirmed|low:1.190|high:1.390",
  ]);

  const decision = memory.decide("AUUD", 2_000, null);

  assert.equal(decision.includeStory, true);
  assert.equal(decision.snapshot, mixedSnapshot);
  assert.deepEqual(decision.keys, ["5m|formal|5m|bos_bullish|2.10"]);
});

test("market structure story memory persists pending and posted state across restarts", () => {
  const firstMemory = new MarketStructureStoryMemory({
    pendingTtlMs: 60_000,
    postedWindowMs: 60 * 60_000,
  });
  const pendingSnapshot = snapshotWithFormal(formalStructure());
  const postedSnapshot = snapshotWithFormal(
    formalStructure({
      timeframe: "5m",
      structureKey: "5m|choch_bearish|1.92",
      eventType: "choch_bearish",
      bias: "bearish_transition",
      brokenSwingPrice: 1.92,
    }),
  );

  firstMemory.capture("ABCD", 1_000, pendingSnapshot);
  firstMemory.markPosted("ABCD", 2_000, postedSnapshot);

  const secondMemory = new MarketStructureStoryMemory({
    pendingTtlMs: 60_000,
    postedWindowMs: 60 * 60_000,
  });
  secondMemory.hydrate(firstMemory.toSnapshot(2_500), 2_500);

  const decision = secondMemory.decide("ABCD", 3_000, postedSnapshot);
  assert.equal(decision.includeStory, true);
  assert.deepEqual(decision.keys, ["4h|formal|4h|bos_bullish|2.45"]);

  secondMemory.markPosted("ABCD", 3_000, decision.snapshot, decision.keys);
  assert.equal(secondMemory.decide("ABCD", 4_000, postedSnapshot).includeStory, false);
});

test("fresh formal BOS/CHOCH key helper excludes sweeps and prior context", () => {
  const snapshot = snapshotWithFormals([
    formalStructure(),
    formalStructure({
      timeframe: "5m",
      structureKey: "5m|liquidity_sweep_high|2.91",
      eventType: "liquidity_sweep_high",
      sweptSwingPrice: 2.91,
    }),
  ]);
  const priorSnapshot = snapshotWithFormal(
    formalStructure({
      eventFreshness: "prior",
      materialChange: false,
    }),
  );

  assert.deepEqual(getFreshFormalBosChochMarketStructureStoryKeys(snapshot), [
    "4h|formal|4h|bos_bullish|2.45",
  ]);
  assert.deepEqual(getFreshFormalBosChochMarketStructureStoryKeys(priorSnapshot), []);
});
