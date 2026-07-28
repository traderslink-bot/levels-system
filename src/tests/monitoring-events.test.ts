import test from "node:test";
import assert from "node:assert/strict";

import type { FinalLevelZone } from "../lib/levels/level-types.js";
import { detectMonitoringEvents } from "../lib/monitoring/event-detector.js";
import { updateInteractionState, createInitialInteractionState } from "../lib/monitoring/interaction-state-machine.js";
import { DEFAULT_MONITORING_CONFIG } from "../lib/monitoring/monitoring-config.js";
import { recordMonitoringEvent } from "../lib/monitoring/symbol-state.js";
import type { LivePriceUpdate, SymbolMonitoringState } from "../lib/monitoring/monitoring-types.js";

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
  reactionQualityScore: 0.72,
  rejectionScore: 0.48,
  displacementScore: 0.61,
  sessionSignificanceScore: 0.25,
  followThroughScore: 0.71,
  gapContinuationScore: 0,
  sourceEvidenceCount: 2,
  firstTimestamp: 1,
  lastTimestamp: 2,
  isExtension: false,
  freshness: "fresh",
  notes: ["Test resistance zone."],
};

const supportZone: FinalLevelZone = {
  ...resistanceZone,
  id: "AAPL-support-zone-1",
  kind: "support",
  zoneLow: 99,
  zoneHigh: 100,
  representativePrice: 99.5,
  sourceTypes: ["swing_low"],
  notes: ["Test support zone."],
};

function makeUpdate(timestamp: number, lastPrice: number): LivePriceUpdate {
  return {
    symbol: "AAPL",
    timestamp,
    lastPrice,
  };
}

function createSymbolState(): SymbolMonitoringState {
  return {
    symbol: "AAPL",
    supportZones: [],
    resistanceZones: [resistanceZone],
    zoneContexts: {
      [resistanceZone.id]: {
        monitoredZoneId: resistanceZone.id,
        canonicalZoneId: resistanceZone.id,
        origin: "canonical",
        remapStatus: "new",
        remappedFromZoneIds: [],
        zoneFreshness: resistanceZone.freshness,
        zoneStrengthLabel: resistanceZone.strengthLabel,
        dataQualityDegraded: false,
        recentlyRefreshed: false,
        recentlyPromotedExtension: false,
        ladderPosition: "inner",
        activeSince: 1,
      },
    },
    interactions: {},
    recentEvents: [],
    bias: "neutral",
    pressureScore: 0,
  };
}

function createSupportSymbolState(): SymbolMonitoringState {
  return {
    symbol: "AAPL",
    supportZones: [supportZone],
    resistanceZones: [],
    zoneContexts: {
      [supportZone.id]: {
        monitoredZoneId: supportZone.id,
        canonicalZoneId: supportZone.id,
        origin: "canonical",
        remapStatus: "new",
        remappedFromZoneIds: [],
        zoneFreshness: supportZone.freshness,
        zoneStrengthLabel: supportZone.strengthLabel,
        dataQualityDegraded: false,
        recentlyRefreshed: false,
        recentlyPromotedExtension: false,
        ladderPosition: "inner",
        activeSince: 1,
      },
    },
    interactions: {},
    recentEvents: [],
    bias: "neutral",
    pressureScore: 0,
  };
}

test("compression is emitted once when a zone first enters a compression episode", () => {
  let previousState = createInitialInteractionState("AAPL", resistanceZone);
  let previousPrice: number | undefined;
  const symbolState = createSymbolState();
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
      symbolState,
      config: DEFAULT_MONITORING_CONFIG,
    });

    emittedEventTypes.push(...events.map((event) => event.eventType));
    events.forEach((event) => recordMonitoringEvent(symbolState, event));
    previousState = currentState;
    previousPrice = update.lastPrice;
  }

  assert.equal(
    emittedEventTypes.filter((eventType) => eventType === "compression").length,
    1,
  );
});

test("volume activity trader line is suppressed when same setup already carried same story", () => {
  const symbolState = createSymbolState();
  symbolState.volumeActivity = {
    label: "expanding",
    reliability: "reliable",
    currentBucketVolume: 1500,
    baselineAverageVolume: 1000,
    relativeVolumeRatio: 1.5,
    direction: "increasing",
    reason: "current 5m bucket is 1.50x recent average",
    traderLine: "activity: activity is expanding into resistance, which makes the test more meaningful",
  };
  symbolState.recentEvents.push({
    id: "prior",
    episodeId: "prior-episode",
    symbol: "AAPL",
    type: "level_touch",
    eventType: "level_touch",
    zoneId: resistanceZone.id,
    zoneKind: "resistance",
    level: resistanceZone.representativePrice,
    triggerPrice: 100.5,
    strength: 0.5,
    confidence: 0.5,
    priority: 50,
    bias: "neutral",
    pressureScore: 0.5,
    eventContext: {
      monitoredZoneId: resistanceZone.id,
      canonicalZoneId: resistanceZone.id,
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "new",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: false,
      ladderPosition: "inner",
      zoneStrengthLabel: "strong",
      volumeActivity: symbolState.volumeActivity,
    },
    timestamp: 1,
    notes: [],
  });

  const previousState = createInitialInteractionState("AAPL", resistanceZone);
  const update = makeUpdate(2, 100.6);
  const currentState = updateInteractionState({
    previousState,
    zone: resistanceZone,
    update,
    previousPrice: 99.9,
    config: DEFAULT_MONITORING_CONFIG,
  });

  const [event] = detectMonitoringEvents({
    previousState,
    currentState,
    zone: resistanceZone,
    update,
    previousPrice: 99.9,
    symbolState,
    config: DEFAULT_MONITORING_CONFIG,
  });

  assert.equal(event?.eventContext.volumeActivity?.label, "expanding");
  assert.equal(event?.eventContext.volumeActivity?.traderLine, undefined);
  assert.match(event?.eventContext.volumeActivity?.reason ?? "", /same volume\/activity story/);
});

test("compression can re-emit after price leaves the zone and returns later", () => {
  let previousState = createInitialInteractionState("AAPL", resistanceZone);
  let previousPrice: number | undefined;
  const symbolState = createSymbolState();
  let compressionCount = 0;

  for (const update of [
    makeUpdate(1, 100.7),
    makeUpdate(2, 100.8),
    makeUpdate(3, 100.85),
    makeUpdate(4, 100.9),
    makeUpdate(5, 103),
    makeUpdate(6, 100.7),
    makeUpdate(7, 100.8),
    makeUpdate(8, 100.9),
    makeUpdate(9, 100.95),
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
      symbolState,
      config: DEFAULT_MONITORING_CONFIG,
    });

    compressionCount += events.filter((event) => event.eventType === "compression").length;
    events.forEach((event) => recordMonitoringEvent(symbolState, event));
    previousState = currentState;
    previousPrice = update.lastPrice;
  }

  assert.equal(compressionCount, 2);
});

test("rejection is emitted once per resistance test sequence", () => {
  let previousState = createInitialInteractionState("AAPL", resistanceZone);
  let previousPrice: number | undefined;
  const symbolState = createSymbolState();
  let rejectionCount = 0;

  for (const update of [
    makeUpdate(1, 100.8),
    makeUpdate(2, 100.95),
    makeUpdate(3, 100.9),
    makeUpdate(4, 100.85),
    makeUpdate(5, 100.8),
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
      symbolState,
      config: DEFAULT_MONITORING_CONFIG,
    });

    rejectionCount += events.filter((event) => event.eventType === "rejection").length;
    events.forEach((event) => recordMonitoringEvent(symbolState, event));
    previousState = currentState;
    previousPrice = update.lastPrice;
  }

  assert.equal(rejectionCount, 1);
});

test("breakout is suppressed for weak fly-by confirmation without prior interaction", () => {
  const symbolState = createSymbolState();
  const previousState = createInitialInteractionState("AAPL", resistanceZone);
  const update = makeUpdate(1, 101.3);

  const currentState = updateInteractionState({
    previousState,
    zone: resistanceZone,
    update,
    previousPrice: 100.95,
    config: DEFAULT_MONITORING_CONFIG,
  });

  const events = detectMonitoringEvents({
    previousState,
    currentState,
    zone: resistanceZone,
    update,
    previousPrice: 100.95,
    symbolState,
    config: DEFAULT_MONITORING_CONFIG,
  });

  assert.equal(events.some((event) => event.eventType === "breakout"), false);
});

test("breakout still emits for a forceful confirmation move without prior interaction", () => {
  const symbolState = createSymbolState();
  const previousState = createInitialInteractionState("AAPL", resistanceZone);
  const update = makeUpdate(1, 101.7);

  const currentState = updateInteractionState({
    previousState,
    zone: resistanceZone,
    update,
    previousPrice: 100.95,
    config: DEFAULT_MONITORING_CONFIG,
  });

  const events = detectMonitoringEvents({
    previousState,
    currentState,
    zone: resistanceZone,
    update,
    previousPrice: 100.95,
    symbolState,
    config: DEFAULT_MONITORING_CONFIG,
  });

  assert.equal(events.some((event) => event.eventType === "breakout"), true);
});

test("accepted breakout failure emits fake breakout when former resistance is lost", () => {
  const symbolState = createSymbolState();
  const previousState = {
    ...createInitialInteractionState("AAPL", resistanceZone),
    phase: "confirmed" as const,
    firstTouchedAt: 1,
    lastTouchedAt: 2,
    breakAttemptAt: 2,
    lastBreakPrice: 101.5,
    updatesNearZone: 3,
  };
  const update = makeUpdate(DEFAULT_MONITORING_CONFIG.fakeoutWindowMs + 10_000, 99.7);

  const currentState = updateInteractionState({
    previousState,
    zone: resistanceZone,
    update,
    previousPrice: 100.2,
    config: DEFAULT_MONITORING_CONFIG,
  });

  const events = detectMonitoringEvents({
    previousState,
    currentState,
    zone: resistanceZone,
    update,
    previousPrice: 100.2,
    symbolState,
    config: DEFAULT_MONITORING_CONFIG,
  });

  assert.equal(events.some((event) => event.eventType === "fake_breakout"), true);
});

test("full support reclaim emits reclaim instead of fake breakdown when a recent break attempt exists", () => {
  const symbolState = createSupportSymbolState();
  let previousState = createInitialInteractionState("AAPL", supportZone);
  let previousPrice: number | undefined;

  for (const update of [
    makeUpdate(1, 99.8),
    makeUpdate(2, 99.4),
    makeUpdate(3, 98.7),
  ]) {
    const currentState = updateInteractionState({
      previousState,
      zone: supportZone,
      update,
      previousPrice,
      config: DEFAULT_MONITORING_CONFIG,
    });

    const events = detectMonitoringEvents({
      previousState,
      currentState,
      zone: supportZone,
      update,
      previousPrice,
      symbolState,
      config: DEFAULT_MONITORING_CONFIG,
    });

    events.forEach((event) => recordMonitoringEvent(symbolState, event));
    previousState = currentState;
    previousPrice = update.lastPrice;
  }

  const reclaimUpdate = makeUpdate(4, 100.4);
  const reclaimState = updateInteractionState({
    previousState,
    zone: supportZone,
    update: reclaimUpdate,
    previousPrice,
    config: DEFAULT_MONITORING_CONFIG,
  });

  const reclaimEvents = detectMonitoringEvents({
    previousState,
    currentState: reclaimState,
    zone: supportZone,
    update: reclaimUpdate,
    previousPrice,
    symbolState,
    config: DEFAULT_MONITORING_CONFIG,
  });

  assert.equal(reclaimEvents.some((event) => event.eventType === "reclaim"), true);
  assert.equal(reclaimEvents.some((event) => event.eventType === "fake_breakdown"), false);
});

test("reclaim is suppressed when price jumps above support without a recent observed breakdown", () => {
  const symbolState = createSupportSymbolState();
  const previousState = createInitialInteractionState("AAPL", supportZone);
  const update = makeUpdate(1, 100.4);

  const currentState = updateInteractionState({
    previousState,
    zone: supportZone,
    update,
    previousPrice: 98.8,
    config: DEFAULT_MONITORING_CONFIG,
  });

  const events = detectMonitoringEvents({
    previousState,
    currentState,
    zone: supportZone,
    update,
    previousPrice: 98.8,
    symbolState,
    config: DEFAULT_MONITORING_CONFIG,
  });

  assert.equal(events.some((event) => event.eventType === "reclaim"), false);
});
