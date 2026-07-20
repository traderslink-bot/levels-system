import assert from "node:assert/strict";
import test from "node:test";

import type { LiveWatchlistLevelMap } from "../lib/live-watchlist/live-watchlist-types.js";
import { deriveLiveWatchlistLifecycleRead } from "../lib/live-watchlist/watchlist-lifecycle-status.js";

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
    referenceLevels: [{ key: "hod", label: "HOD", price: 1.2, kind: "session" }],
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

test("watchlist lifecycle labels distinguish momentum, pullback, recovery watch, recovery attempt, and confirmed fade", () => {
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
  assert.equal(deriveLiveWatchlistLifecycleRead({
    ...base,
    phase: "pullback_forming",
    volumeLabel: "fading",
    stableFiveMinuteState: "pullback_to_structure",
  }).status, "pullback_watch");
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

test("Pullback Watch requires a confirmed and meaningful test of a qualified structural zone", () => {
  const base = {
    evaluatedAt: NOW,
    structureUpdatedAt: NOW,
    phase: "pullback_forming" as const,
    technicalConfidence: "high" as const,
    volumeLabel: "normal" as const,
  };

  const ema9DipOnly = deriveLiveWatchlistLifecycleRead({
    ...base,
    levelMap: levelMap(),
  });
  assert.equal(ema9DipOnly.status, "monitoring");
  assert.match(ema9DipOnly.reason, /confirmed five-minute structure/i);

  const gmmShallowDip = deriveLiveWatchlistLifecycleRead({
    ...base,
    stableFiveMinuteState: "pullback_to_structure",
    levelMap: {
      ...levelMap(),
      currentPrice: 4.2189,
      nearestSupport: {
        side: "support",
        price: 4.11,
        distancePct: -0.0258,
        distanceAtr: 1.1,
        strengthLabel: "strong",
        sourceLabel: "daily confluence",
        label: "support",
      },
      supportLevels: [{
        side: "support",
        price: 4.11,
        distancePct: -0.0258,
        distanceAtr: 1.1,
        strengthLabel: "strong",
        sourceLabel: "daily confluence",
        label: "support",
      }],
      referenceLevels: [{ key: "hod", label: "HOD", price: 4.42, kind: "session" }],
      volatilityContext: {
        atr: 0.098993,
        atrPct: 0.0235,
        period: 14,
        timeframe: "5m",
        completedCandleCount: 14,
        reliability: "reliable",
      },
    },
  });
  assert.equal(gmmShallowDip.status, "monitoring");
  assert.match(gmmShallowDip.reason, /not yet testing a qualified structural pullback area/i);

  const zybtNotAtZone = deriveLiveWatchlistLifecycleRead({
    ...base,
    stableFiveMinuteState: "pullback_to_structure",
    levelMap: {
      ...levelMap(),
      currentPrice: 3.2987,
      nearestSupport: {
        side: "support",
        price: 3.22,
        distancePct: -0.0239,
        distanceAtr: 0.6893,
        strengthLabel: "moderate",
        sourceLabel: "daily structure",
        label: "support",
      },
      supportLevels: [{
        side: "support",
        price: 3.22,
        distancePct: -0.0239,
        distanceAtr: 0.6893,
        strengthLabel: "moderate",
        sourceLabel: "daily structure",
        label: "support",
      }],
      referenceLevels: [{ key: "hod", label: "HOD", price: 3.79, kind: "session" }],
      volatilityContext: {
        atr: 0.114171,
        atrPct: 0.0346,
        period: 14,
        timeframe: "5m",
        completedCandleCount: 14,
        reliability: "reliable",
      },
    },
  });
  assert.equal(zybtNotAtZone.status, "monitoring");
  assert.match(zybtNotAtZone.reason, /not yet testing a qualified structural pullback area/i);

  const qualifiedTest = deriveLiveWatchlistLifecycleRead({
    ...base,
    stableFiveMinuteState: "pullback_to_structure",
    levelMap: levelMap(),
  });
  assert.equal(qualifiedTest.status, "pullback_watch");
  assert.equal(qualifiedTest.label, "Pullback Watch");
});

test("Pullback Watch rejects a five-percent dip even when ATR and strong support tests pass", () => {
  const map = levelMap();
  const strongSupport = {
    ...map.supportLevels[0]!,
    price: 0.995,
    distancePct: -0.005,
    distanceAtr: 0.25,
    strengthLabel: "strong" as const,
    sourceLabel: "daily confluence",
  };
  const result = deriveLiveWatchlistLifecycleRead({
    evaluatedAt: NOW,
    structureUpdatedAt: NOW,
    phase: "pullback_forming",
    technicalConfidence: "high",
    volumeLabel: "normal",
    stableFiveMinuteState: "pullback_to_structure",
    levelMap: {
      ...map,
      nearestSupport: strongSupport,
      supportLevels: [strongSupport],
      referenceLevels: [{ key: "hod", label: "HOD", price: 1.06, kind: "session" }],
      volatilityContext: {
        ...map.volatilityContext!,
        atr: 0.02,
      },
    },
  });
  assert.equal(result.status, "monitoring");
  assert.match(result.reason, /requires at least a 10% HOD reset/i);
});

test("Pullback Watch requires a deeper HOD reset for ordinary moderate structure", () => {
  const map = levelMap();
  const result = deriveLiveWatchlistLifecycleRead({
    evaluatedAt: NOW,
    structureUpdatedAt: NOW,
    phase: "pullback_forming",
    technicalConfidence: "high",
    volumeLabel: "normal",
    stableFiveMinuteState: "pullback_to_structure",
    levelMap: {
      ...map,
      referenceLevels: [{ key: "hod", label: "HOD", price: 1.14, kind: "session" }],
    },
  });
  assert.equal(result.status, "monitoring");
  assert.match(result.reason, /requires at least a 15% HOD reset/i);
});

test("Pullback Watch rejects weak or unconfirmed nearby support", () => {
  const map = levelMap();
  const weakSupport = map.supportLevels.map((level) => ({
    ...level,
    strengthLabel: "weak" as const,
    sourceLabel: "fresh intraday",
  }));
  const result = deriveLiveWatchlistLifecycleRead({
    evaluatedAt: NOW,
    structureUpdatedAt: NOW,
    phase: "pullback_forming",
    technicalConfidence: "high",
    volumeLabel: "normal",
    stableFiveMinuteState: "pullback_to_structure",
    levelMap: {
      ...map,
      nearestSupport: weakSupport[0] ?? null,
      supportLevels: weakSupport,
    },
  });
  assert.equal(result.status, "monitoring");
  assert.match(result.reason, /nearby support alone is not enough/i);
});
