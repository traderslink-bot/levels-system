import { strict as assert } from "node:assert";
import test from "node:test";

import { derivePracticalTradeStructureContext } from "../lib/monitoring/practical-trade-structure.js";
import type { FinalLevelZone } from "../lib/levels/level-types.js";
import type { MonitoringEvent, SymbolMonitoringState } from "../lib/monitoring/monitoring-types.js";

function zone(overrides: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "kind" | "representativePrice">): FinalLevelZone {
  return {
    id: overrides.id,
    symbol: "CYCU",
    kind: overrides.kind,
    timeframeBias: overrides.timeframeBias ?? "5m",
    zoneLow: overrides.zoneLow ?? overrides.representativePrice,
    zoneHigh: overrides.zoneHigh ?? overrides.representativePrice,
    representativePrice: overrides.representativePrice,
    strengthScore: overrides.strengthScore ?? 0.7,
    strengthLabel: overrides.strengthLabel ?? "moderate",
    touchCount: overrides.touchCount ?? 3,
    confluenceCount: overrides.confluenceCount ?? 1,
    sourceTypes: overrides.sourceTypes ?? ["swing_low"],
    timeframeSources: overrides.timeframeSources ?? ["5m"],
    reactionQualityScore: overrides.reactionQualityScore ?? 0.7,
    rejectionScore: overrides.rejectionScore ?? 0.6,
    displacementScore: overrides.displacementScore ?? 0.5,
    sessionSignificanceScore: overrides.sessionSignificanceScore ?? 0.5,
    followThroughScore: overrides.followThroughScore ?? 0.5,
    sourceEvidenceCount: overrides.sourceEvidenceCount ?? 2,
    firstTimestamp: overrides.firstTimestamp ?? 1,
    lastTimestamp: overrides.lastTimestamp ?? 1,
    isExtension: overrides.isExtension ?? false,
    freshness: overrides.freshness ?? "fresh",
    notes: overrides.notes ?? [],
  };
}

function state(overrides: Partial<SymbolMonitoringState> = {}): SymbolMonitoringState {
  const supportZones = [
    zone({ id: "s-102", kind: "support", representativePrice: 1.02, strengthLabel: "major", timeframeBias: "daily", timeframeSources: ["daily"] }),
    zone({ id: "s-100", kind: "support", representativePrice: 1, strengthLabel: "moderate", timeframeBias: "5m", timeframeSources: ["5m"], freshness: "fresh" }),
    zone({ id: "s-9898", kind: "support", representativePrice: 0.9898, strengthLabel: "moderate", timeframeBias: "5m", timeframeSources: ["5m"], freshness: "fresh" }),
    zone({ id: "s-9522", kind: "support", representativePrice: 0.9522, strengthLabel: "major", timeframeBias: "daily", timeframeSources: ["daily"] }),
  ];
  const resistanceZones = [
    zone({ id: "r-106", kind: "resistance", representativePrice: 1.06, strengthLabel: "moderate", timeframeBias: "5m", timeframeSources: ["5m"], freshness: "fresh" }),
    zone({ id: "r-112", kind: "resistance", representativePrice: 1.12, strengthLabel: "strong", timeframeBias: "daily", timeframeSources: ["daily"] }),
  ];
  return {
    symbol: "CYCU",
    supportZones,
    resistanceZones,
    zoneContexts: {},
    interactions: {},
    recentEvents: [],
    ...overrides,
  };
}

test("practical trade structure treats tight small-cap support levels as one area", () => {
  const symbolState = state();
  const context = derivePracticalTradeStructureContext({
    symbolState,
    zone: symbolState.supportZones[0]!,
    eventType: "level_touch",
    price: 1.03,
    timestamp: 10,
  });

  assert.equal(context.state, "pullback_to_support");
  assert.equal(context.supportArea?.low, 0.9898);
  assert.equal(context.supportArea?.high, 1.02);
  assert.match(context.traderLine, /reaction matters more than tiny moves inside the area/i);
  assert.match(context.practicalZoneKey, /support:0\.9898-1\.02/);
});

test("practical trade structure marks clean losses differently from one-cent support noise", () => {
  const symbolState = state();
  const noisyLoss = derivePracticalTradeStructureContext({
    symbolState,
    zone: symbolState.supportZones[0]!,
    eventType: "breakdown",
    price: 1,
    timestamp: 10,
  });
  const cleanLoss = derivePracticalTradeStructureContext({
    symbolState,
    zone: symbolState.supportZones[0]!,
    eventType: "breakdown",
    price: 0.96,
    timestamp: 20,
  });

  assert.equal(noisyLoss.state, "support_failing");
  assert.equal(cleanLoss.state, "structure_broken");
  assert.match(noisyLoss.traderLine, /support.*is failing for now/i);
  assert.match(cleanLoss.traderLine, /support area broke cleanly/i);
});

test("practical trade structure detects repeated resistance pressure from recent 5m story", () => {
  const symbolState = state();
  const priorTouch: MonitoringEvent = {
    id: "evt-1",
    episodeId: "ep-1",
    symbol: "CYCU",
    type: "level_touch",
    eventType: "level_touch",
    zoneId: "r-106",
    zoneKind: "resistance",
    level: 1.06,
    triggerPrice: 1.055,
    strength: 0.7,
    confidence: 0.7,
    priority: 0.5,
    bias: "neutral",
    pressureScore: 0.5,
    eventContext: {
      monitoredZoneId: "r-106",
      canonicalZoneId: "r-106",
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
    timestamp: 5,
    notes: [],
  };
  symbolState.recentEvents = [priorTouch];

  const context = derivePracticalTradeStructureContext({
    symbolState,
    zone: symbolState.resistanceZones[0]!,
    eventType: "level_touch",
    price: 1.058,
    timestamp: 10,
  });

  assert.equal(context.state, "pressing_resistance");
  assert.match(context.traderLine, /price is pressing moderate resistance 1\.06/);
});

test("practical trade structure uses live 5-minute higher lows to describe base building", () => {
  const symbolState = state({
    intradayStructure: {
      bucketMs: 5 * 60 * 1000,
      bucketCount: 4,
      baseLow: 0.99,
      baseHigh: 1.06,
      lastClose: 1.04,
      rangePct: 0.0707,
      higherLowCount: 2,
      lowerHighCount: 0,
      direction: "building",
    },
  });

  const context = derivePracticalTradeStructureContext({
    symbolState,
    zone: symbolState.supportZones[0]!,
    eventType: "level_touch",
    price: 1.03,
    timestamp: 10,
  });

  assert.equal(context.state, "building_base");
  assert.match(context.traderLine, /Recent 5-minute structure is building higher lows/);
});
