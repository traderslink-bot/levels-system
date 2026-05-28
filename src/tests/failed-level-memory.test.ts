import assert from "node:assert/strict";
import test from "node:test";

import type { FinalLevelZone } from "../lib/levels/level-types.js";
import type { MonitoringEvent } from "../lib/monitoring/monitoring-types.js";
import { buildFailedLevelMemoryContext } from "../lib/monitoring/failed-level-memory.js";

function zone(): FinalLevelZone {
  return {
    id: "R1",
    symbol: "TEST",
    kind: "resistance",
    timeframeBias: "daily",
    zoneLow: 3.75,
    zoneHigh: 3.75,
    representativePrice: 3.75,
    strengthScore: 80,
    strengthLabel: "major",
    touchCount: 3,
    confluenceCount: 2,
    sourceTypes: ["swing_high"],
    timeframeSources: ["daily"],
    reactionQualityScore: 0.7,
    rejectionScore: 0.6,
    displacementScore: 0.6,
    sessionSignificanceScore: 0.6,
    followThroughScore: 0.6,
    sourceEvidenceCount: 3,
    firstTimestamp: 1,
    lastTimestamp: 1,
    isExtension: false,
    freshness: "fresh",
    notes: [],
  };
}

function event(eventType: MonitoringEvent["eventType"], timestamp: number, triggerPrice: number): MonitoringEvent {
  return {
    id: `${eventType}-${timestamp}`,
    episodeId: `${eventType}-${timestamp}`,
    symbol: "TEST",
    type: eventType === "compression" ? "consolidation" : eventType,
    eventType,
    zoneId: "R1",
    zoneKind: "resistance",
    level: 3.75,
    triggerPrice,
    strength: 0.8,
    confidence: 0.8,
    priority: 80,
    bias: "bullish",
    pressureScore: 0.5,
    eventContext: {
      monitoredZoneId: "R1",
      canonicalZoneId: "R1",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "new",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: false,
      ladderPosition: "inner",
      zoneStrengthLabel: "major",
    },
    timestamp,
    notes: [],
  };
}

test("failed level memory treats a tiny resistance push as a probe until accepted", () => {
  const context = buildFailedLevelMemoryContext({
    zone: zone(),
    eventType: "breakout",
    price: 3.77,
    timestamp: 10,
    recentEvents: [],
  });

  assert.equal(context.outcome, "probe_only");
  assert.match(context.traderLine ?? "", /still being tested/);
});

test("failed level memory carries prior failed pushes into the next test", () => {
  const context = buildFailedLevelMemoryContext({
    zone: zone(),
    eventType: "breakout",
    price: 3.78,
    timestamp: 20,
    recentEvents: [event("fake_breakout", 10, 3.70)],
  });

  assert.equal(context.outcome, "testing");
  assert.equal(context.failureCount, 1);
});

