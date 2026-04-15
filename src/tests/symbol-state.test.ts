import test from "node:test";
import assert from "node:assert/strict";

import type { FinalLevelZone } from "../lib/levels/level-types.js";
import type { MonitoringEvent, SymbolMonitoringState } from "../lib/monitoring/monitoring-types.js";
import {
  buildSymbolContext,
  recordMonitoringEvent,
} from "../lib/monitoring/symbol-state.js";

const zone: FinalLevelZone = {
  id: "AAPL-resistance-zone-1",
  symbol: "AAPL",
  kind: "resistance",
  timeframeBias: "5m",
  zoneLow: 100,
  zoneHigh: 101,
  representativePrice: 100.5,
  strengthScore: 42,
  strengthLabel: "strong",
  touchCount: 5,
  confluenceCount: 1,
  sourceTypes: ["swing_high"],
  timeframeSources: ["5m"],
  firstTimestamp: 1,
  lastTimestamp: 2,
  notes: ["Test resistance zone."],
};

function createSymbolState(): SymbolMonitoringState {
  return {
    symbol: "AAPL",
    supportZones: [],
    resistanceZones: [zone],
    interactions: {},
    recentEvents: [],
    bias: "neutral",
    pressureScore: 0,
  };
}

function makeEvent(params: {
  id: string;
  eventType: MonitoringEvent["eventType"];
  type: MonitoringEvent["type"];
  timestamp: number;
  pressureScore?: number;
}): MonitoringEvent {
  return {
    id: params.id,
    episodeId: `${params.id}-episode`,
    symbol: "AAPL",
    type: params.type,
    eventType: params.eventType,
    zoneId: zone.id,
    zoneKind: zone.kind,
    level: zone.representativePrice,
    triggerPrice: zone.zoneHigh,
    strength: 0.8,
    confidence: 0.75,
    priority: 80,
    bias: "neutral",
    pressureScore: params.pressureScore ?? 0.6,
    timestamp: params.timestamp,
    notes: ["Test event."],
  };
}

test("symbol state favors recent events through time decay and prunes stale memory", () => {
  const symbolState = createSymbolState();
  const now = 5_000_000;

  recordMonitoringEvent(
    symbolState,
    makeEvent({
      id: "old-breakdown",
      eventType: "breakdown",
      type: "breakdown",
      timestamp: now - 46 * 60 * 1000,
      pressureScore: 0.35,
    }),
  );

  recordMonitoringEvent(
    symbolState,
    makeEvent({
      id: "recent-touch",
      eventType: "level_touch",
      type: "level_touch",
      timestamp: now - 60 * 1000,
      pressureScore: 0.55,
    }),
  );

  recordMonitoringEvent(
    symbolState,
    makeEvent({
      id: "recent-breakout",
      eventType: "breakout",
      type: "breakout",
      timestamp: now,
      pressureScore: 0.8,
    }),
  );

  const context = buildSymbolContext({
    symbolState,
    zone,
    currentState: {
      zoneId: zone.id,
      symbol: "AAPL",
      levelKind: "resistance",
      phase: "touching",
      nearestDistancePct: 0.0008,
      updatesNearZone: 4,
      firstTouchedAt: now - 60_000,
      lastTouchedAt: now,
    },
    referenceTimestamp: now,
  });

  assert.equal(symbolState.recentEvents.some((event) => event.id === "old-breakdown"), false);
  assert.equal(context.bias, "bullish");
  assert.ok(context.pressureScore >= 0);
  assert.equal(context.repeatedTests, 0);
});
