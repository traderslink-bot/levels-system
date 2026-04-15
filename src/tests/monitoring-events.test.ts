import test from "node:test";
import assert from "node:assert/strict";

import type { FinalLevelZone } from "../lib/levels/level-types.js";
import { detectMonitoringEvents } from "../lib/monitoring/event-detector.js";
import { updateInteractionState, createInitialInteractionState } from "../lib/monitoring/interaction-state-machine.js";
import { DEFAULT_MONITORING_CONFIG } from "../lib/monitoring/monitoring-config.js";
import type { LivePriceUpdate } from "../lib/monitoring/monitoring-types.js";

const resistanceZone: FinalLevelZone = {
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

function makeUpdate(timestamp: number, lastPrice: number): LivePriceUpdate {
  return {
    symbol: "AAPL",
    timestamp,
    lastPrice,
  };
}

test("compression is emitted once when a zone first enters a compression episode", () => {
  let previousState = createInitialInteractionState("AAPL", resistanceZone);
  let previousPrice: number | undefined;
  const emittedEventTypes: string[] = [];

  for (const update of [
    makeUpdate(1, 100.7),
    makeUpdate(2, 100.8),
    makeUpdate(3, 100.85),
    makeUpdate(4, 100.9),
    makeUpdate(5, 100.92),
    makeUpdate(6, 100.94),
  ]) {
    const currentState = updateInteractionState({
      previousState,
      zone: resistanceZone,
      update,
      previousPrice,
      config: DEFAULT_MONITORING_CONFIG,
    });

    const events = detectMonitoringEvents({
      previousState,
      currentState,
      zone: resistanceZone,
      update,
      previousPrice,
      config: DEFAULT_MONITORING_CONFIG,
    });

    emittedEventTypes.push(...events.map((event) => event.eventType));
    previousState = currentState;
    previousPrice = update.lastPrice;
  }

  assert.equal(
    emittedEventTypes.filter((eventType) => eventType === "compression").length,
    1,
  );
});

test("compression can re-emit after price leaves the zone and returns later", () => {
  let previousState = createInitialInteractionState("AAPL", resistanceZone);
  let previousPrice: number | undefined;
  let compressionCount = 0;

  for (const update of [
    makeUpdate(1, 100.7),
    makeUpdate(2, 100.8),
    makeUpdate(3, 100.85),
    makeUpdate(4, 100.9),
    makeUpdate(5, 103),
    makeUpdate(6, 100.78),
    makeUpdate(7, 100.8),
    makeUpdate(8, 100.82),
    makeUpdate(9, 100.84),
  ]) {
    const currentState = updateInteractionState({
      previousState,
      zone: resistanceZone,
      update,
      previousPrice,
      config: DEFAULT_MONITORING_CONFIG,
    });

    const events = detectMonitoringEvents({
      previousState,
      currentState,
      zone: resistanceZone,
      update,
      previousPrice,
      config: DEFAULT_MONITORING_CONFIG,
    });

    compressionCount += events.filter((event) => event.eventType === "compression").length;
    previousState = currentState;
    previousPrice = update.lastPrice;
  }

  assert.equal(compressionCount, 2);
});
