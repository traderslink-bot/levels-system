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

  const damagedButAmbiguous = deriveLiveWatchlistLifecycleRead({
    evaluatedAt: NOW,
    structureUpdatedAt: NOW,
    phase: "failed_move_risk",
    technicalConfidence: "medium",
    volumeLabel: "normal",
    levelMap: levelMap(),
  });
  assert.equal(damagedButAmbiguous.status, "monitoring");
});

test("watchlist lifecycle labels distinguish active, pullback, recovery, and confirmed fade", () => {
  const base = {
    evaluatedAt: NOW,
    structureUpdatedAt: NOW,
    technicalConfidence: "high" as const,
    levelMap: levelMap(),
  };
  assert.equal(deriveLiveWatchlistLifecycleRead({
    ...base,
    phase: "continuation_watch",
    volumeLabel: "expanding",
  }).status, "active");
  assert.equal(deriveLiveWatchlistLifecycleRead({
    ...base,
    phase: "pullback_forming",
    volumeLabel: "fading",
  }).status, "pullback_watch");
  assert.equal(deriveLiveWatchlistLifecycleRead({
    ...base,
    phase: "failed_move_risk",
    volumeLabel: "normal",
    stableFiveMinuteState: "reclaim_confirmed",
  }).status, "recovery_watch");
  assert.equal(deriveLiveWatchlistLifecycleRead({
    ...base,
    phase: "failed_move_risk",
    volumeLabel: "thin",
    stableFiveMinuteState: "trend_damaged",
  }).status, "setup_fading");
});
