import assert from "node:assert/strict";
import test from "node:test";

import type { FinalLevelZone } from "../lib/levels/level-types.js";
import type { MonitoringEvent, SymbolMonitoringState } from "../lib/monitoring/monitoring-types.js";
import {
  buildAcceptanceContext,
  buildRangeBoxContext,
  buildTradeStoryIntelligenceContext,
} from "../lib/monitoring/trade-story-intelligence.js";

function zone(params: {
  id: string;
  kind: "support" | "resistance";
  price: number;
  strengthLabel?: FinalLevelZone["strengthLabel"];
  timeframeBias?: Exclude<FinalLevelZone["timeframeBias"], "mixed">;
}): FinalLevelZone {
  return {
    id: params.id,
    symbol: "TEST",
    kind: params.kind,
    timeframeBias: params.timeframeBias ?? "5m",
    zoneLow: params.price,
    zoneHigh: params.price,
    representativePrice: params.price,
    strengthScore: 70,
    strengthLabel: params.strengthLabel ?? "moderate",
    touchCount: 2,
    confluenceCount: 1,
    sourceTypes: ["swing_high"],
    timeframeSources: [params.timeframeBias ?? "5m"],
    reactionQualityScore: 0.6,
    rejectionScore: 0.5,
    displacementScore: 0.5,
    sessionSignificanceScore: 0.5,
    followThroughScore: 0.5,
    sourceEvidenceCount: 2,
    firstTimestamp: 1,
    lastTimestamp: 1,
    isExtension: false,
    freshness: "fresh",
    notes: [],
  };
}

function event(price: number, timestamp: number, eventType: MonitoringEvent["eventType"]): MonitoringEvent {
  return {
    id: `event-${timestamp}`,
    episodeId: `episode-${timestamp}`,
    symbol: "TEST",
    type: eventType === "compression" ? "consolidation" : eventType,
    eventType,
    zoneId: "R1",
    zoneKind: "resistance",
    level: price,
    triggerPrice: price,
    strength: 0.8,
    confidence: 0.8,
    priority: 70,
    bias: "bullish",
    pressureScore: 0.6,
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
      zoneStrengthLabel: "moderate",
    },
    timestamp,
    notes: [],
  };
}

function symbolState(recentEvents: MonitoringEvent[] = []): SymbolMonitoringState {
  return {
    symbol: "TEST",
    supportZones: [
      zone({ id: "S1", kind: "support", price: 1.01, strengthLabel: "major", timeframeBias: "daily" }),
      zone({ id: "S2", kind: "support", price: 0.92, strengthLabel: "moderate", timeframeBias: "4h" }),
    ],
    resistanceZones: [
      zone({ id: "R1", kind: "resistance", price: 1.08, strengthLabel: "strong", timeframeBias: "daily" }),
      zone({ id: "R2", kind: "resistance", price: 1.22, strengthLabel: "moderate", timeframeBias: "4h" }),
    ],
    zoneContexts: {},
    interactions: {},
    recentEvents,
  };
}

test("range box context identifies tight small-cap boxes and counts inside posts", () => {
  const context = buildRangeBoxContext({
    symbol: "TEST",
    price: 1.04,
    tradeStructure: {
      state: "range_bound",
      supportArea: { side: "support", low: 1.01, high: 1.01, representative: 1.01, strengthLabel: "major", zoneCount: 1 },
      resistanceArea: { side: "resistance", low: 1.08, high: 1.08, representative: 1.08, strengthLabel: "strong", zoneCount: 1 },
      structureKey: "range",
      practicalZoneKey: "S|R",
      traderLine: "range",
      reason: "test",
      isMaterialStateChange: false,
    },
    recentEvents: [event(1.03, 1, "level_touch"), event(1.06, 2, "compression")],
    timestamp: 3,
  });

  assert.equal(context.label, "active");
  assert.equal(context.recentInsidePostCount, 2);
  assert.match(context.traderLine ?? "", /small moves inside the box/);
});

test("acceptance context separates weak probes from clean accepted breaks", () => {
  const resistance = zone({ id: "R1", kind: "resistance", price: 1.08 });
  const weak = buildAcceptanceContext({
    eventType: "breakout",
    zone: resistance,
    price: 1.09,
  });
  const accepted = buildAcceptanceContext({
    eventType: "breakout",
    zone: resistance,
    price: 1.12,
  });

  assert.equal(weak.label, "weak_probe");
  assert.equal(accepted.label, "accepted");
  assert.match(weak.traderLine ?? "", /only slightly above resistance/);
});

test("trade story intelligence combines story state, support importance, and behavior budget", () => {
  const context = buildTradeStoryIntelligenceContext({
    symbolState: symbolState([event(1.03, 1, "level_touch"), event(1.05, 2, "compression")]),
    zone: zone({ id: "R1", kind: "resistance", price: 1.08 }),
    eventType: "breakout",
    price: 1.09,
    timestamp: 3,
    tradeStructure: {
      state: "pressing_resistance",
      supportArea: { side: "support", low: 1.01, high: 1.01, representative: 1.01, strengthLabel: "major", zoneCount: 1 },
      resistanceArea: { side: "resistance", low: 1.08, high: 1.08, representative: 1.08, strengthLabel: "strong", zoneCount: 1 },
      structureKey: "pressing",
      practicalZoneKey: "S|R",
      traderLine: "pressing",
      reason: "test",
      isMaterialStateChange: false,
    },
  });

  assert.equal(context.storyState, "breakout_attempt");
  assert.equal(context.acceptance.label, "weak_probe");
  assert.equal(context.rangeBox.label, "active");
  assert.equal(context.supportImportance.label, "must_hold_structure");
  assert.equal(context.behaviorBudget.label, "boring_range");
});
