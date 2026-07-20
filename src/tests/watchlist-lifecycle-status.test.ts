import assert from "node:assert/strict";
import test from "node:test";

import type { LiveWatchlistLevelMap } from "../lib/live-watchlist/live-watchlist-types.js";
import { deriveLiveWatchlistLifecycleRead } from "../lib/live-watchlist/watchlist-lifecycle-status.js";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");

function levelMap(): LiveWatchlistLevelMap {
  return {
    currentPrice: 1,
    rangeState: "normal",
    nearestSupport: { side: "support", price: 0.9, distancePct: 10, label: "support" },
    nearestResistance: null,
    nextStrongSupport: null,
    nextStrongResistance: null,
    supportLevels: [{ side: "support", price: 0.9, distancePct: 10, label: "support" }],
    resistanceLevels: [],
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
