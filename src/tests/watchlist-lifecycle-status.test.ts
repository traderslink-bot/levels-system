import assert from "node:assert/strict";
import test from "node:test";

import type { LiveWatchlistLevelMap } from "../lib/live-watchlist/live-watchlist-types.js";
import {
  deriveLiveWatchlistLifecycleRead,
  type LiveWatchlistLifecycleEvidence,
} from "../lib/live-watchlist/watchlist-lifecycle-status.js";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");

function levelMap(): LiveWatchlistLevelMap {
  return {
    currentPrice: 1,
    rangeState: "normal",
    nearestSupport: {
      side: "support",
      price: 0.99,
      distancePct: -0.01,
      distanceAtr: 0.33,
      atrDistanceState: "inside_normal_noise",
      strengthLabel: "moderate",
      sourceLabel: "4h structure",
      label: "support",
    },
    nearestResistance: null,
    nextStrongSupport: null,
    nextStrongResistance: null,
    supportLevels: [{
      side: "support",
      price: 0.99,
      distancePct: -0.01,
      distanceAtr: 0.33,
      atrDistanceState: "inside_normal_noise",
      strengthLabel: "moderate",
      sourceLabel: "4h structure",
      label: "support",
    }],
    resistanceLevels: [],
    referenceLevels: [
      { key: "hod", label: "HOD", price: 1.2, kind: "session" },
      { key: "vwap", label: "VWAP", price: 0.985, kind: "dynamic" },
    ],
    volatilityContext: {
      atr: 0.03,
      atrPct: 0.03,
      period: 14,
      timeframe: "5m",
      completedCandleCount: 14,
      reliability: "reliable",
    },
  };
}

type FiveMinuteStructure = NonNullable<LiveWatchlistLifecycleEvidence["fiveMinuteStructure"]>;

function pullbackStructure(overrides: Partial<FiveMinuteStructure> = {}): FiveMinuteStructure {
  return {
    state: "pullback_to_structure",
    previousState: "higher_lows_intact",
    structureKey: "pullback_to_structure|range:0.990-1.080",
    materialChange: true,
    confidence: "high",
    materialityScore: 0.72,
    rawState: "pullback_to_structure",
    reason: "persistent_material_change",
    candleCount: 48,
    rawRunLength: 3,
    trendDirection: "uptrend",
    higherLowCount: 2,
    lowerHighCount: 0,
    higherHighCount: 1,
    lowerLowCount: 0,
    latestSwingLow: 0.99,
    latestSwingHigh: 1.08,
    priorSwingLow: 0.94,
    priorSwingHigh: 1.02,
    activeRangeLow: 0.99,
    activeRangeHigh: 1.08,
    activeRangeWidthPct: 0.0909,
    activeRangeQuality: "clean",
    pivotEventType: "none",
    pivotEventTriggerPrice: null,
    ...overrides,
  };
}

function v3LifecyclePlan(): NonNullable<LiveWatchlistLifecycleEvidence["aiRead"]> {
  const level = (label: string, price: number) => ({ label, price, rationale: label });
  const scenario = (zoneLow: number, zoneHigh: number, invalidationPrice: number) => ({
    zoneLow,
    zoneHigh,
    confirmationPrice: zoneHigh,
    confirmation: "Require a higher low and reclaim.",
    invalidationPrice,
    firstObjectivePrice: 2.52,
    rationale: "Observed candle structure.",
    evidenceIds: ["fixture"],
  });
  return {
    version: 3,
    needsToHold: level("Needs to hold", 2.52),
    momentumFailure: level("Momentum failure", 1.83),
    pullbackPlans: {
      shallow: scenario(2.06, 2.11, 2),
      deep: scenario(1.9, 1.98, 1.83),
    },
    failureRecovery: {
      recoveryZoneLow: 1.52,
      recoveryZoneHigh: 1.6,
      firstReclaimPrice: 1.61,
      setupRestorePrice: 1.7,
      firstObjectivePrice: 1.83,
      rationale: "Observed broader move origin.",
      evidenceIds: ["fixture"],
    },
  };
}

test("v3 lifecycle uses published pullback and recovery prices instead of generic failed-move labels", () => {
  const base = {
    evaluatedAt: NOW,
    structureUpdatedAt: NOW,
    phase: "failed_move_risk" as const,
    technicalConfidence: "high" as const,
    volumeLabel: "normal" as const,
    levelMap: levelMap(),
    aiRead: v3LifecyclePlan(),
  };

  const shallow = deriveLiveWatchlistLifecycleRead({ ...base, currentPrice: 2.08 });
  assert.equal(shallow.status, "pullback_watch");
  assert.match(shallow.reason, /shallow momentum/i);

  const deep = deriveLiveWatchlistLifecycleRead({ ...base, currentPrice: 1.95 });
  assert.equal(deep.status, "pullback_watch");
  assert.match(deep.reason, /deep reset/i);

  const aboveFailure = deriveLiveWatchlistLifecycleRead({ ...base, currentPrice: 2.15 });
  assert.equal(aboveFailure.status, "monitoring");
  assert.notEqual(aboveFailure.label, "Recovery Watch");

  const recoveryWatch = deriveLiveWatchlistLifecycleRead({ ...base, currentPrice: 1.56 });
  assert.equal(recoveryWatch.status, "recovery_watch");
  assert.match(recoveryWatch.reason, /1.52-1.6 recovery-watch area/i);

  const reclaimWithoutBase = deriveLiveWatchlistLifecycleRead({
    ...base,
    currentPrice: 1.62,
    stableFiveMinuteState: "reclaim_attempt",
    fiveMinuteStructure: pullbackStructure({ latestSwingLow: 1.7 }),
  });
  assert.equal(reclaimWithoutBase.status, "monitoring");

  const recoveryAttempt = deriveLiveWatchlistLifecycleRead({
    ...base,
    currentPrice: 1.62,
    stableFiveMinuteState: "reclaim_attempt",
    fiveMinuteStructure: pullbackStructure({ latestSwingLow: 1.56 }),
  });
  assert.equal(recoveryAttempt.status, "recovery_attempt");
  assert.match(recoveryAttempt.reason, /new base/i);
});

test("watchlist lifecycle labels remain conservative when evidence is stale or incomplete", () => {
  const stale = deriveLiveWatchlistLifecycleRead({
    evaluatedAt: NOW,
    structureUpdatedAt: NOW - 21 * 60_000,
    phase: "continuation_watch",
    technicalConfidence: "high",
    volumeLabel: "strong",
    levelMap: levelMap(),
  });
  assert.equal(stale.status, "monitoring");
  assert.equal(stale.label, "Analysis Pending");

  const damagedWithoutMappedSupport = deriveLiveWatchlistLifecycleRead({
    evaluatedAt: NOW,
    structureUpdatedAt: NOW,
    phase: "failed_move_risk",
    technicalConfidence: "medium",
    volumeLabel: "normal",
    levelMap: null,
  });
  assert.equal(damagedWithoutMappedSupport.status, "monitoring");
  assert.equal(damagedWithoutMappedSupport.label, "Analysis Pending");
});

test("watchlist lifecycle labels distinguish momentum, candle pullback, recovery watch, recovery attempt, and confirmed fade", () => {
  const base = {
    evaluatedAt: NOW,
    structureUpdatedAt: NOW,
    technicalConfidence: "high" as const,
    levelMap: levelMap(),
  };
  const momentumHolding = deriveLiveWatchlistLifecycleRead({
    ...base,
    phase: "continuation_watch",
    volumeLabel: "expanding",
  });
  assert.equal(momentumHolding.status, "active");
  assert.equal(momentumHolding.label, "Momentum Holding");

  const pullbackWatch = deriveLiveWatchlistLifecycleRead({
    ...base,
    phase: "pullback_forming",
    volumeLabel: "fading",
    stableFiveMinuteState: "pullback_to_structure",
    fiveMinuteStructure: pullbackStructure(),
  });
  assert.equal(pullbackWatch.status, "pullback_watch");
  assert.match(pullbackWatch.reason, /five-minute candles/i);
  assert.doesNotMatch(pullbackWatch.reason, /HOD|percent|ATR/i);

  const recoveryWatch = deriveLiveWatchlistLifecycleRead({
    ...base,
    phase: "failed_move_risk",
    volumeLabel: "normal",
  });
  assert.equal(recoveryWatch.status, "recovery_watch");
  assert.equal(recoveryWatch.label, "Recovery Watch");
  assert.match(recoveryWatch.reason, /waiting for a five-minute reclaim attempt/i);

  const recoveryAttempt = deriveLiveWatchlistLifecycleRead({
    ...base,
    phase: "failed_move_risk",
    volumeLabel: "normal",
    stableFiveMinuteState: "reclaim_attempt",
  });
  assert.equal(recoveryAttempt.status, "recovery_attempt");
  assert.equal(recoveryAttempt.label, "Recovery Attempt");
  assert.match(recoveryAttempt.reason, /attempting a reclaim/i);

  const confirmedReclaimStillRestoringMomentum = deriveLiveWatchlistLifecycleRead({
    ...base,
    phase: "failed_move_risk",
    volumeLabel: "normal",
    stableFiveMinuteState: "reclaim_confirmed",
  });
  assert.equal(confirmedReclaimStillRestoringMomentum.status, "recovery_attempt");
  assert.equal(confirmedReclaimStillRestoringMomentum.label, "Recovery Attempt");
  assert.match(confirmedReclaimStillRestoringMomentum.reason, /momentum still need to be restored/i);

  const setupFading = deriveLiveWatchlistLifecycleRead({
    ...base,
    phase: "failed_move_risk",
    volumeLabel: "thin",
    stableFiveMinuteState: "trend_damaged",
  });
  assert.equal(setupFading.status, "setup_fading");
  assert.equal(setupFading.label, "Setup Fading");
});

test("Pullback Watch requires the current candle state to confirm a constructive retracement", () => {
  const base = {
    evaluatedAt: NOW,
    structureUpdatedAt: NOW,
    phase: "pullback_forming" as const,
    technicalConfidence: "high" as const,
    volumeLabel: "normal" as const,
    levelMap: levelMap(),
  };

  const ema9DipOnly = deriveLiveWatchlistLifecycleRead(base);
  assert.equal(ema9DipOnly.status, "monitoring");
  assert.match(ema9DipOnly.reason, /current five-minute candles/i);

  const staleStableState = deriveLiveWatchlistLifecycleRead({
    ...base,
    stableFiveMinuteState: "pullback_to_structure",
    fiveMinuteStructure: pullbackStructure({ rawState: "range_bound" }),
  });
  assert.equal(staleStableState.status, "monitoring");
  assert.match(staleStableState.reason, /current five-minute candles/i);

  const nonConstructiveRange = deriveLiveWatchlistLifecycleRead({
    ...base,
    stableFiveMinuteState: "pullback_to_structure",
    fiveMinuteStructure: pullbackStructure({
      trendDirection: "range",
      higherLowCount: 0,
      higherHighCount: 0,
    }),
  });
  assert.equal(nonConstructiveRange.status, "monitoring");
  assert.match(nonConstructiveRange.reason, /higher-high and higher-low impulse/i);
});

test("Pullback Watch rejects noisy, unconfirmed, or broken candle structure", () => {
  const base = {
    evaluatedAt: NOW,
    structureUpdatedAt: NOW,
    phase: "pullback_forming" as const,
    technicalConfidence: "high" as const,
    volumeLabel: "normal" as const,
    levelMap: levelMap(),
    stableFiveMinuteState: "pullback_to_structure",
  };

  const oneBarProbe = deriveLiveWatchlistLifecycleRead({
    ...base,
    fiveMinuteStructure: pullbackStructure({ rawRunLength: 1 }),
  });
  assert.equal(oneBarProbe.status, "monitoring");
  assert.match(oneBarProbe.reason, /not persisted/i);

  const choppyRange = deriveLiveWatchlistLifecycleRead({
    ...base,
    fiveMinuteStructure: pullbackStructure({ activeRangeQuality: "choppy" }),
  });
  assert.equal(choppyRange.status, "monitoring");
  assert.match(choppyRange.reason, /clean active range low/i);

  const brokenRange = deriveLiveWatchlistLifecycleRead({
    ...base,
    levelMap: { ...levelMap(), currentPrice: 0.98 },
    fiveMinuteStructure: pullbackStructure(),
  });
  assert.equal(brokenRange.status, "monitoring");
  assert.match(brokenRange.reason, /not holding inside the candle-defined pullback range/i);
});

test("Pullback Watch requires VWAP to hold but does not use HOD percentage or mapped-level proximity", () => {
  const map = levelMap();
  const weakDistantSupport = {
    ...map.supportLevels[0]!,
    price: 0.8,
    distancePct: -0.2,
    distanceAtr: 6.67,
    strengthLabel: "weak" as const,
    sourceLabel: "fresh intraday",
  };
  const candleDefinedPullback = deriveLiveWatchlistLifecycleRead({
    evaluatedAt: NOW,
    structureUpdatedAt: NOW,
    phase: "pullback_forming",
    technicalConfidence: "high",
    volumeLabel: "normal",
    stableFiveMinuteState: "pullback_to_structure",
    fiveMinuteStructure: pullbackStructure(),
    levelMap: {
      ...map,
      nearestSupport: weakDistantSupport,
      supportLevels: [weakDistantSupport],
      referenceLevels: [{ key: "vwap", label: "VWAP", price: 0.985, kind: "dynamic" }],
    },
  });
  assert.equal(candleDefinedPullback.status, "pullback_watch");

  const belowVwap = deriveLiveWatchlistLifecycleRead({
    evaluatedAt: NOW,
    structureUpdatedAt: NOW,
    phase: "pullback_forming",
    technicalConfidence: "high",
    volumeLabel: "normal",
    stableFiveMinuteState: "pullback_to_structure",
    fiveMinuteStructure: pullbackStructure(),
    levelMap: {
      ...map,
      currentPrice: 1,
      referenceLevels: [{ key: "vwap", label: "VWAP", price: 1.01, kind: "dynamic" }],
    },
  });
  assert.equal(belowVwap.status, "monitoring");
  assert.match(belowVwap.reason, /not holding VWAP/i);
});
