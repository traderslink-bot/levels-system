import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FinalLevelZone } from "../lib/levels/level-types.js";
import {
  applySnapshotLevelProvenancePolicy,
  resolveLiveWatchlistLevelProvenanceMode,
} from "../lib/monitoring/manual-watchlist-runtime-manager.js";

function zone(
  id: string,
  overrides: Partial<FinalLevelZone> = {},
): FinalLevelZone {
  return {
    id,
    symbol: "TEST",
    kind: "resistance",
    timeframeBias: "5m",
    zoneLow: 4.78,
    zoneHigh: 4.86,
    representativePrice: 4.82,
    strengthScore: 40,
    strengthLabel: "moderate",
    touchCount: 1,
    confluenceCount: 1,
    sourceTypes: ["swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.5,
    rejectionScore: 0.5,
    displacementScore: 0.5,
    sessionSignificanceScore: 0.5,
    followThroughScore: 0.5,
    sourceEvidenceCount: 1,
    firstTimestamp: Date.parse("2026-07-13T15:00:00Z"),
    lastTimestamp: Date.parse("2026-07-13T15:00:00Z"),
    marketDataProvenance: {
      formedAt: Date.parse("2026-07-13T15:00:00Z"),
      sourceLastSeenAt: Date.parse("2026-07-13T15:00:00Z"),
    },
    isExtension: false,
    freshness: "aging",
    notes: [],
    ...overrides,
  };
}

describe("live watchlist level provenance policy", () => {
  const timestamp = Date.parse("2026-07-14T16:00:00Z");

  it("defaults invalid modes to off", () => {
    assert.equal(resolveLiveWatchlistLevelProvenanceMode(undefined), "off");
    assert.equal(resolveLiveWatchlistLevelProvenanceMode("unexpected"), "off");
    assert.equal(resolveLiveWatchlistLevelProvenanceMode("OBSERVE"), "observe");
  });

  it("reports prior-session unconfirmed 5m clutter in observe mode", () => {
    const result = applySnapshotLevelProvenancePolicy({
      zones: [zone("old-5m")],
      currentPrice: 4.5,
      timestamp,
      side: "resistance",
      mode: "observe",
    });

    assert.deepEqual(result.zones.map((item) => item.id), ["old-5m"]);
    assert.deepEqual([...result.wouldSuppressIds], ["old-5m"]);
    assert.equal(result.suppressedIds.size, 0);
  });

  it("preserves confirmed, currently tested, strong, and higher-timeframe levels", () => {
    const testedToday = Date.parse("2026-07-14T15:30:00Z");
    const levels = [
      zone("confirmed", {
        marketDataProvenance: {
          formedAt: Date.parse("2026-07-12T15:00:00Z"),
          sourceLastSeenAt: Date.parse("2026-07-12T15:00:00Z"),
          lastConfirmedAt: Date.parse("2026-07-13T15:00:00Z"),
        },
      }),
      zone("tested-today", {
        marketDataProvenance: {
          formedAt: Date.parse("2026-07-12T15:00:00Z"),
          sourceLastSeenAt: Date.parse("2026-07-12T15:00:00Z"),
          lastTestedAt: testedToday,
        },
      }),
      zone("strong", { strengthLabel: "strong" }),
      zone("daily", { timeframeBias: "daily", timeframeSources: ["daily"] }),
    ];
    const result = applySnapshotLevelProvenancePolicy({
      zones: levels,
      currentPrice: 4.5,
      timestamp,
      side: "resistance",
      mode: "active",
    });

    assert.deepEqual(result.zones.map((item) => item.id), levels.map((item) => item.id));
  });

  it("restores the best candidate when active filtering would empty a side", () => {
    const result = applySnapshotLevelProvenancePolicy({
      zones: [
        zone("weaker", { strengthScore: 35 }),
        zone("better", { representativePrice: 4.9, zoneLow: 4.88, zoneHigh: 4.92, strengthScore: 50 }),
      ],
      currentPrice: 4.5,
      timestamp,
      side: "resistance",
      mode: "active",
    });

    assert.deepEqual(result.zones.map((item) => item.id), ["better"]);
    assert.deepEqual([...result.fallbackRestoredIds], ["better"]);
    assert.deepEqual([...result.suppressedIds], ["weaker"]);
  });
});
