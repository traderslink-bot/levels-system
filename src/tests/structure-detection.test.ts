import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FinalLevelZone } from "../lib/levels/level-types.js";
import { DEFAULT_MONITORING_CONFIG } from "../lib/monitoring/monitoring-config.js";
import { scoreMonitoringEvent } from "../lib/monitoring/monitoring-event-scoring.js";
import type {
  LivePriceUpdate,
  MonitoringEvent,
  SymbolMonitoringState,
  ZoneInteractionState,
} from "../lib/monitoring/monitoring-types.js";
import { buildSymbolContext, deriveSymbolBias, recordMonitoringEvent } from "../lib/monitoring/symbol-state.js";

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

function buildState(events: MonitoringEvent[]): SymbolMonitoringState {
  const symbolState = createSymbolState();

  events.forEach((event) => {
    recordMonitoringEvent(symbolState, event);
  });

  return symbolState;
}

function buildCurrentState(params?: Partial<ZoneInteractionState>): ZoneInteractionState {
  return {
    zoneId: resistanceZone.id,
    symbol: "AAPL",
    levelKind: "resistance",
    phase: "touching",
    nearestDistancePct: 0.0008,
    updatesNearZone: 5,
    firstTouchedAt: 1,
    lastTouchedAt: 1,
    ...params,
  };
}

function makeUpdate(timestamp: number, lastPrice: number): LivePriceUpdate {
  return {
    symbol: "AAPL",
    timestamp,
    lastPrice,
    volume: 150_000,
  };
}

function toAlertType(eventType: MonitoringEvent["eventType"]): MonitoringEvent["type"] {
  return eventType === "compression" ? "consolidation" : eventType;
}

function makeEvent(params: {
  id: string;
  eventType: MonitoringEvent["eventType"];
  timestamp: number;
  triggerPrice: number;
  zoneId?: string;
  zoneKind?: MonitoringEvent["zoneKind"];
  pressureScore?: number;
  strength?: number;
  confidence?: number;
  priority?: number;
}): MonitoringEvent {
  return {
    id: params.id,
    episodeId: `${params.id}-episode`,
    symbol: "AAPL",
    type: toAlertType(params.eventType),
    eventType: params.eventType,
    zoneId: params.zoneId ?? resistanceZone.id,
    zoneKind: params.zoneKind ?? "resistance",
    level: resistanceZone.representativePrice,
    triggerPrice: params.triggerPrice,
    strength: params.strength ?? 0.72,
    confidence: params.confidence ?? 0.68,
    priority: params.priority ?? 72,
    bias: "neutral",
    pressureScore: params.pressureScore ?? 0.6,
    eventContext: {
      monitoredZoneId: params.zoneId ?? resistanceZone.id,
      canonicalZoneId: params.zoneId ?? resistanceZone.id,
      zoneFreshness: resistanceZone.freshness,
      zoneOrigin: "canonical",
      remapStatus: "new",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: false,
      ladderPosition: "inner",
      zoneStrengthLabel: resistanceZone.strengthLabel,
    },
    timestamp: params.timestamp,
    notes: ["Scenario test event."],
  };
}

function buildContext(
  events: MonitoringEvent[],
  referenceTimestamp: number,
  currentState?: Partial<ZoneInteractionState>,
) {
  const symbolState = buildState(events);

  return buildSymbolContext({
    symbolState,
    zone: resistanceZone,
    currentState: buildCurrentState(currentState),
    referenceTimestamp,
  });
}

describe("structure detection", () => {
  it("detects compression and increases range compression and structure strength as range tightens", () => {
    const baseTime = 10_000_000;
    const earlyCompressionEvents = [
      makeEvent({
        id: "touch-1",
        eventType: "level_touch",
        timestamp: baseTime - 240_000,
        triggerPrice: 100.98,
      }),
      makeEvent({
        id: "touch-2",
        eventType: "level_touch",
        timestamp: baseTime - 150_000,
        triggerPrice: 100.82,
      }),
      makeEvent({
        id: "touch-3",
        eventType: "compression",
        timestamp: baseTime - 90_000,
        triggerPrice: 100.72,
      }),
    ];
    const finalCompressionEvents = [
      ...earlyCompressionEvents,
      makeEvent({
        id: "touch-4",
        eventType: "compression",
        timestamp: baseTime - 45_000,
        triggerPrice: 100.68,
      }),
      makeEvent({
        id: "touch-5",
        eventType: "compression",
        timestamp: baseTime - 15_000,
        triggerPrice: 100.66,
      }),
    ];

    const earlyContext = buildContext(earlyCompressionEvents, baseTime, { updatesNearZone: 3 });
    const finalContext = buildContext(finalCompressionEvents, baseTime, { updatesNearZone: 5 });

    assert.equal(finalContext.structureType, "compression");
    assert.ok(finalContext.rangeCompressionScore > earlyContext.rangeCompressionScore);
    assert.ok(finalContext.structureStrength > earlyContext.structureStrength);
  });

  it("detects breakout setup when compression aligns with bullish bias", () => {
    const baseTime = 20_000_000;
    const compressionEvents = [
      makeEvent({
        id: "c1",
        eventType: "level_touch",
        timestamp: baseTime - 240_000,
        triggerPrice: 100.96,
      }),
      makeEvent({
        id: "c2",
        eventType: "level_touch",
        timestamp: baseTime - 150_000,
        triggerPrice: 100.8,
      }),
      makeEvent({
        id: "c3",
        eventType: "compression",
        timestamp: baseTime - 90_000,
        triggerPrice: 100.7,
      }),
      makeEvent({
        id: "c4",
        eventType: "compression",
        timestamp: baseTime - 20_000,
        triggerPrice: 100.67,
      }),
    ];
    const breakoutBiasEvent = makeEvent({
      id: "bullish-breakout",
      eventType: "breakout",
      timestamp: baseTime - 30_000,
      triggerPrice: 102.2,
      zoneId: "AAPL-alt-zone",
      pressureScore: 0.85,
    });

    const compressionBaseline = buildContext(compressionEvents, baseTime);
    const breakoutSetup = buildContext([...compressionEvents, breakoutBiasEvent], baseTime);

    assert.equal(compressionBaseline.structureType, "compression");
    assert.equal(breakoutSetup.structureType, "breakout_setup");
    assert.equal(breakoutSetup.bias, "bullish");
    assert.ok(breakoutSetup.structureStrength > compressionBaseline.structureStrength);
  });

  it("detects rejection setup from failed breakout memory under pressure", () => {
    const baseTime = 30_000_000;
    const baselineEvents = [
      makeEvent({
        id: "r1",
        eventType: "level_touch",
        timestamp: baseTime - 600_000,
        triggerPrice: 100.92,
      }),
      makeEvent({
        id: "r2",
        eventType: "compression",
        timestamp: baseTime - 240_000,
        triggerPrice: 100.78,
      }),
      makeEvent({
        id: "r3",
        eventType: "compression",
        timestamp: baseTime - 60_000,
        triggerPrice: 100.7,
      }),
    ];
    const rejectionEvents = [
      ...baselineEvents,
      makeEvent({
        id: "fb1",
        eventType: "fake_breakout",
        timestamp: baseTime - 45_000,
        triggerPrice: 101.08,
        pressureScore: 0.82,
      }),
      makeEvent({
        id: "fb2",
        eventType: "fake_breakout",
        timestamp: baseTime - 10_000,
        triggerPrice: 101.04,
        pressureScore: 0.86,
      }),
    ];

    const baselineContext = buildContext(baselineEvents, baseTime);
    const rejectionContext = buildContext(rejectionEvents, baseTime, { updatesNearZone: 6 });

    assert.equal(rejectionContext.structureType, "rejection_setup");
    assert.ok(rejectionContext.failedBreakoutCount > baselineContext.failedBreakoutCount);
    assert.ok(rejectionContext.structureStrength > baselineContext.structureStrength);
  });

  it("resolves structure by clearing compression memory and dropping pressure after breakout", () => {
    const baseTime = 40_000_000;
    const symbolState = buildState([
      makeEvent({
        id: "s1",
        eventType: "level_touch",
        timestamp: baseTime - 600_000,
        triggerPrice: 100.95,
      }),
      makeEvent({
        id: "s2",
        eventType: "compression",
        timestamp: baseTime - 240_000,
        triggerPrice: 100.78,
      }),
      makeEvent({
        id: "s3",
        eventType: "compression",
        timestamp: baseTime - 60_000,
        triggerPrice: 100.69,
      }),
    ]);

    const beforeContext = buildSymbolContext({
      symbolState,
      zone: resistanceZone,
      currentState: buildCurrentState({ updatesNearZone: 5 }),
      referenceTimestamp: baseTime,
    });

    recordMonitoringEvent(
      symbolState,
      makeEvent({
        id: "resolved-breakout",
        eventType: "breakout",
        timestamp: baseTime,
        triggerPrice: 101.25,
        pressureScore: 0.9,
      }),
    );

    const afterContext = buildSymbolContext({
      symbolState,
      zone: resistanceZone,
      currentState: buildCurrentState({
        phase: "confirmed",
        updatesNearZone: 0,
        nearestDistancePct: 0.012,
      }),
      referenceTimestamp: baseTime,
    });

    const remainingCompressionEvents = symbolState.recentEvents.filter(
      (event) =>
        event.zoneId === resistanceZone.id &&
        (event.eventType === "level_touch" || event.eventType === "compression"),
    );

    assert.equal(remainingCompressionEvents.length, 0);
    assert.ok(afterContext.pressureScore < beforeContext.pressureScore);
    assert.notEqual(afterContext.structureType, "compression");
  });

  it("amplifies rejection scoring after failed breakout under high pressure", () => {
    const baseTime = 50_000_000;
    const baselineState = buildState([
      makeEvent({
        id: "baseline-touch",
        eventType: "level_touch",
        timestamp: baseTime - 60_000,
        triggerPrice: 100.88,
        pressureScore: 0.35,
      }),
    ]);
    const amplifiedState = buildState([
      makeEvent({
        id: "hp1",
        eventType: "level_touch",
        timestamp: baseTime - 540_000,
        triggerPrice: 100.96,
        pressureScore: 0.62,
      }),
      makeEvent({
        id: "hp2",
        eventType: "compression",
        timestamp: baseTime - 240_000,
        triggerPrice: 100.8,
        pressureScore: 0.72,
      }),
      makeEvent({
        id: "hp3",
        eventType: "compression",
        timestamp: baseTime - 90_000,
        triggerPrice: 100.71,
        pressureScore: 0.82,
      }),
      makeEvent({
        id: "hp4",
        eventType: "fake_breakout",
        timestamp: baseTime - 30_000,
        triggerPrice: 101.05,
        pressureScore: 0.88,
      }),
    ]);
    const update = makeUpdate(baseTime, 100.62);
    const currentState = buildCurrentState({
      phase: "rejected",
      updatesNearZone: 6,
      nearestDistancePct: 0.0005,
    });

    const baselineScore = scoreMonitoringEvent({
      eventType: "rejection",
      zone: resistanceZone,
      update,
      previousPrice: 100.9,
      currentState,
      symbolState: baselineState,
      config: DEFAULT_MONITORING_CONFIG,
    });
    const amplifiedScore = scoreMonitoringEvent({
      eventType: "rejection",
      zone: resistanceZone,
      update,
      previousPrice: 100.9,
      currentState,
      symbolState: amplifiedState,
      config: DEFAULT_MONITORING_CONFIG,
    });

    assert.ok(amplifiedScore.strength > baselineScore.strength + 0.05);
    assert.ok(amplifiedScore.confidence > baselineScore.confidence + 0.03);
  });

  it("increases range compression score as a wide range tightens into a narrow range", () => {
    const baseTime = 60_000_000;
    const wideRangeContext = buildContext(
      [
        makeEvent({
          id: "w1",
          eventType: "level_touch",
          timestamp: baseTime - 600_000,
          triggerPrice: 101.0,
        }),
        makeEvent({
          id: "w2",
          eventType: "level_touch",
          timestamp: baseTime - 300_000,
          triggerPrice: 100.6,
        }),
        makeEvent({
          id: "w3",
          eventType: "compression",
          timestamp: baseTime - 120_000,
          triggerPrice: 100.9,
        }),
        makeEvent({
          id: "w4",
          eventType: "compression",
          timestamp: baseTime - 30_000,
          triggerPrice: 100.62,
        }),
      ],
      baseTime,
    );
    const tightRangeContext = buildContext(
      [
        makeEvent({
          id: "t1",
          eventType: "level_touch",
          timestamp: baseTime - 600_000,
          triggerPrice: 101.0,
        }),
        makeEvent({
          id: "t2",
          eventType: "level_touch",
          timestamp: baseTime - 300_000,
          triggerPrice: 100.7,
        }),
        makeEvent({
          id: "t3",
          eventType: "compression",
          timestamp: baseTime - 120_000,
          triggerPrice: 100.68,
        }),
        makeEvent({
          id: "t4",
          eventType: "compression",
          timestamp: baseTime - 30_000,
          triggerPrice: 100.67,
        }),
      ],
      baseTime,
    );

    assert.ok(tightRangeContext.rangeCompressionScore > wideRangeContext.rangeCompressionScore);
  });

  it("weights recent events more heavily than old events", () => {
    const baseTime = 70_000_000;
    const oldBearishState = buildState([
      makeEvent({
        id: "old-bearish",
        eventType: "breakdown",
        timestamp: baseTime - 35 * 60 * 1000,
        triggerPrice: 99.1,
        zoneId: "AAPL-bearish-zone",
        zoneKind: "support",
      }),
    ]);
    const mixedState = buildState([
      makeEvent({
        id: "old-bearish",
        eventType: "breakdown",
        timestamp: baseTime - 35 * 60 * 1000,
        triggerPrice: 99.1,
        zoneId: "AAPL-bearish-zone",
        zoneKind: "support",
      }),
      makeEvent({
        id: "recent-bullish",
        eventType: "breakout",
        timestamp: baseTime - 60_000,
        triggerPrice: 102.1,
        zoneId: "AAPL-bullish-zone",
      }),
    ]);

    const oldContext = buildSymbolContext({
      symbolState: oldBearishState,
      zone: resistanceZone,
      currentState: buildCurrentState({ updatesNearZone: 1 }),
      referenceTimestamp: baseTime,
    });
    const mixedContext = buildSymbolContext({
      symbolState: mixedState,
      zone: resistanceZone,
      currentState: buildCurrentState({ updatesNearZone: 1 }),
      referenceTimestamp: baseTime,
    });

    assert.equal(oldContext.bias, "bearish");
    assert.equal(mixedContext.bias, "bullish");
  });

  it("returns identical outputs for identical inputs", () => {
    const baseTime = 80_000_000;
    const events = [
      makeEvent({
        id: "d1",
        eventType: "level_touch",
        timestamp: baseTime - 600_000,
        triggerPrice: 100.94,
      }),
      makeEvent({
        id: "d2",
        eventType: "compression",
        timestamp: baseTime - 180_000,
        triggerPrice: 100.76,
      }),
      makeEvent({
        id: "d3",
        eventType: "fake_breakout",
        timestamp: baseTime - 30_000,
        triggerPrice: 101.03,
        pressureScore: 0.84,
      }),
    ];

    const firstState = buildState(events);
    const secondState = buildState(events);
    const currentState = buildCurrentState({ updatesNearZone: 6, phase: "rejected" });
    const update = makeUpdate(baseTime, 100.63);

    const firstContext = buildSymbolContext({
      symbolState: firstState,
      zone: resistanceZone,
      currentState,
      referenceTimestamp: baseTime,
    });
    const secondContext = buildSymbolContext({
      symbolState: secondState,
      zone: resistanceZone,
      currentState,
      referenceTimestamp: baseTime,
    });
    const firstScore = scoreMonitoringEvent({
      eventType: "rejection",
      zone: resistanceZone,
      update,
      previousPrice: 100.91,
      currentState,
      symbolState: firstState,
      config: DEFAULT_MONITORING_CONFIG,
    });
    const secondScore = scoreMonitoringEvent({
      eventType: "rejection",
      zone: resistanceZone,
      update,
      previousPrice: 100.91,
      currentState,
      symbolState: secondState,
      config: DEFAULT_MONITORING_CONFIG,
    });

    assert.deepEqual(firstContext, secondContext);
    assert.deepEqual(firstScore, secondScore);
  });
});

describe("structure edge cases", () => {
  it("does not detect compression when tests are sparse and the range stays wide", () => {
    const baseTime = 90_000_000;
    const context = buildContext(
      [
        makeEvent({
          id: "nc1",
          eventType: "level_touch",
          timestamp: baseTime - 18 * 60 * 1000,
          triggerPrice: 100.98,
        }),
        makeEvent({
          id: "nc2",
          eventType: "level_touch",
          timestamp: baseTime - 11 * 60 * 1000,
          triggerPrice: 100.55,
        }),
        makeEvent({
          id: "nc3",
          eventType: "level_touch",
          timestamp: baseTime - 4 * 60 * 1000,
          triggerPrice: 100.93,
        }),
      ],
      baseTime,
      { updatesNearZone: 3 },
    );

    assert.notEqual(context.structureType, "compression");
    assert.ok(context.rangeCompressionScore < 0.2);
  });

  it("does not trigger breakout setup under mixed neutral bias", () => {
    const baseTime = 100_000_000;
    const context = buildContext(
      [
        makeEvent({
          id: "mc1",
          eventType: "level_touch",
          timestamp: baseTime - 240_000,
          triggerPrice: 100.95,
        }),
        makeEvent({
          id: "mc2",
          eventType: "compression",
          timestamp: baseTime - 120_000,
          triggerPrice: 100.78,
        }),
        makeEvent({
          id: "mc3",
          eventType: "compression",
          timestamp: baseTime - 45_000,
          triggerPrice: 100.71,
        }),
        makeEvent({
          id: "mc4",
          eventType: "breakout",
          timestamp: baseTime - 20_000,
          triggerPrice: 101.12,
          zoneId: "bias-up-zone",
        }),
        makeEvent({
          id: "mc5",
          eventType: "breakdown",
          timestamp: baseTime - 10_000,
          triggerPrice: 99.25,
          zoneId: "bias-down-zone",
          zoneKind: "support",
        }),
      ],
      baseTime,
      { updatesNearZone: 5 },
    );

    assert.notEqual(context.structureType, "breakout_setup");
    assert.ok(context.structureType === "compression" || context.structureType === null);
    assert.ok(context.structureStrength < 0.8);
  });

  it("prioritizes rejection setup over compression when failed breakouts accumulate", () => {
    const baseTime = 110_000_000;
    const context = buildContext(
      [
        makeEvent({
          id: "rp1",
          eventType: "level_touch",
          timestamp: baseTime - 240_000,
          triggerPrice: 100.94,
        }),
        makeEvent({
          id: "rp2",
          eventType: "compression",
          timestamp: baseTime - 120_000,
          triggerPrice: 100.8,
        }),
        makeEvent({
          id: "rp3",
          eventType: "compression",
          timestamp: baseTime - 50_000,
          triggerPrice: 100.72,
        }),
        makeEvent({
          id: "rp4",
          eventType: "fake_breakout",
          timestamp: baseTime - 20_000,
          triggerPrice: 101.08,
          pressureScore: 0.87,
        }),
        makeEvent({
          id: "rp5",
          eventType: "fake_breakout",
          timestamp: baseTime - 8_000,
          triggerPrice: 101.04,
          pressureScore: 0.9,
        }),
      ],
      baseTime,
      { updatesNearZone: 6 },
    );

    assert.equal(context.structureType, "rejection_setup");
    assert.ok(context.failedBreakoutCount > 0.8);
  });

  it("respects the bias threshold boundary", () => {
    const referenceTimestamp = 120_000_000;
    const belowThreshold = deriveSymbolBias(
      [
        makeEvent({
          id: "bt1",
          eventType: "breakout",
          timestamp: referenceTimestamp - 60_000,
          triggerPrice: 101.2,
          zoneId: "bt-zone-1",
        }),
        makeEvent({
          id: "bt2",
          eventType: "breakdown",
          timestamp: referenceTimestamp - 59_000,
          triggerPrice: 99.1,
          zoneId: "bt-zone-2",
          zoneKind: "support",
        }),
        makeEvent({
          id: "bt3",
          eventType: "compression",
          timestamp: referenceTimestamp - 58_000,
          triggerPrice: 100.8,
        }),
      ],
      referenceTimestamp,
    );
    const aboveThreshold = deriveSymbolBias(
      [
        makeEvent({
          id: "at1",
          eventType: "breakout",
          timestamp: referenceTimestamp - 60_000,
          triggerPrice: 101.2,
          zoneId: "at-zone-1",
        }),
        makeEvent({
          id: "at2",
          eventType: "breakout",
          timestamp: referenceTimestamp - 50_000,
          triggerPrice: 101.25,
          zoneId: "at-zone-2",
        }),
        makeEvent({
          id: "at3",
          eventType: "breakout",
          timestamp: referenceTimestamp - 40_000,
          triggerPrice: 101.28,
          zoneId: "at-zone-3",
        }),
        makeEvent({
          id: "at4",
          eventType: "breakdown",
          timestamp: referenceTimestamp - 35_000,
          triggerPrice: 99.2,
          zoneId: "at-zone-4",
          zoneKind: "support",
        }),
      ],
      referenceTimestamp,
    );

    assert.equal(belowThreshold, "neutral");
    assert.equal(aboveThreshold, "bullish");
  });

  it("prunes memory beyond the recent-event cap and stays stable afterward", () => {
    const baseTime = 130_000_000;
    const symbolState = createSymbolState();

    for (let index = 0; index < 30; index += 1) {
      recordMonitoringEvent(
        symbolState,
        makeEvent({
          id: `prune-${index}`,
          eventType: index % 2 === 0 ? "level_touch" : "compression",
          timestamp: baseTime - (29 - index) * 15_000,
          triggerPrice: 100.95 - index * 0.01,
        }),
      );
    }

    const context = buildSymbolContext({
      symbolState,
      zone: resistanceZone,
      currentState: buildCurrentState({ updatesNearZone: 6 }),
      referenceTimestamp: baseTime,
    });

    assert.ok(symbolState.recentEvents.length <= 25);
    assert.equal(symbolState.recentEvents.some((event) => event.id === "prune-0"), false);
    assert.ok(context.repeatedTests >= 0);
  });

  it("does not falsely spike range compression when the range stays similarly noisy", () => {
    const baseTime = 140_000_000;
    const context = buildContext(
      [
        makeEvent({
          id: "fp1",
          eventType: "level_touch",
          timestamp: baseTime - 240_000,
          triggerPrice: 100.99,
        }),
        makeEvent({
          id: "fp2",
          eventType: "compression",
          timestamp: baseTime - 180_000,
          triggerPrice: 100.5,
        }),
        makeEvent({
          id: "fp3",
          eventType: "compression",
          timestamp: baseTime - 120_000,
          triggerPrice: 100.99,
        }),
        makeEvent({
          id: "fp4",
          eventType: "compression",
          timestamp: baseTime - 60_000,
          triggerPrice: 100.5,
        }),
      ],
      baseTime,
    );

    assert.ok(context.rangeCompressionScore < 0.35);
  });

  it("does not trigger rejection setup or amplification from failure without pressure", () => {
    const baseTime = 150_000_000;
    const lowPressureState = buildState([
      makeEvent({
        id: "lp1",
        eventType: "level_touch",
        timestamp: baseTime - 90_000,
        triggerPrice: 100.9,
        pressureScore: 0.15,
      }),
      makeEvent({
        id: "lp2",
        eventType: "fake_breakout",
        timestamp: baseTime - 30_000,
        triggerPrice: 101.03,
        pressureScore: 0.18,
      }),
    ]);
    const baselineState = buildState([
      makeEvent({
        id: "lb1",
        eventType: "level_touch",
        timestamp: baseTime - 90_000,
        triggerPrice: 100.9,
        pressureScore: 0.15,
      }),
    ]);
    const highPressureState = buildState([
      makeEvent({
        id: "hp-lp1",
        eventType: "level_touch",
        timestamp: baseTime - 240_000,
        triggerPrice: 100.95,
        pressureScore: 0.62,
      }),
      makeEvent({
        id: "hp-lp2",
        eventType: "compression",
        timestamp: baseTime - 120_000,
        triggerPrice: 100.78,
        pressureScore: 0.72,
      }),
      makeEvent({
        id: "hp-lp3",
        eventType: "fake_breakout",
        timestamp: baseTime - 30_000,
        triggerPrice: 101.04,
        pressureScore: 0.86,
      }),
    ]);
    const context = buildSymbolContext({
      symbolState: lowPressureState,
      zone: resistanceZone,
      currentState: buildCurrentState({ updatesNearZone: 2 }),
      referenceTimestamp: baseTime,
    });
    const lowPressureScore = scoreMonitoringEvent({
      eventType: "rejection",
      zone: resistanceZone,
      update: makeUpdate(baseTime, 100.7),
      previousPrice: 100.92,
      currentState: buildCurrentState({ phase: "rejected", updatesNearZone: 2 }),
      symbolState: lowPressureState,
      config: DEFAULT_MONITORING_CONFIG,
    });
    const highPressureScore = scoreMonitoringEvent({
      eventType: "rejection",
      zone: resistanceZone,
      update: makeUpdate(baseTime, 100.7),
      previousPrice: 100.92,
      currentState: buildCurrentState({ phase: "rejected", updatesNearZone: 6 }),
      symbolState: highPressureState,
      config: DEFAULT_MONITORING_CONFIG,
    });

    assert.notEqual(context.structureType, "rejection_setup");
    assert.ok(lowPressureScore.pressureScore < highPressureScore.pressureScore);
  });

  it("stays neutral under noisy mixed events with no clear pattern", () => {
    const baseTime = 160_000_000;
    const context = buildContext(
      [
        makeEvent({
          id: "ns1",
          eventType: "level_touch",
          timestamp: baseTime - 20 * 60 * 1000,
          triggerPrice: 100.95,
        }),
        makeEvent({
          id: "ns2",
          eventType: "breakout",
          timestamp: baseTime - 14 * 60 * 1000,
          triggerPrice: 101.18,
          zoneId: "noise-b1",
        }),
        makeEvent({
          id: "ns3",
          eventType: "breakdown",
          timestamp: baseTime - 9 * 60 * 1000,
          triggerPrice: 99.15,
          zoneId: "noise-b2",
          zoneKind: "support",
        }),
        makeEvent({
          id: "ns4",
          eventType: "level_touch",
          timestamp: baseTime - 4 * 60 * 1000,
          triggerPrice: 100.88,
        }),
      ],
      baseTime,
      { updatesNearZone: 2 },
    );

    assert.equal(context.structureType, null);
    assert.ok(context.structureStrength <= 0.2);
  });

  it("keeps structure output consistent under slight event-order variation", () => {
    const baseTime = 170_000_000;
    const orderedEvents = [
      makeEvent({
        id: "ov1",
        eventType: "level_touch",
        timestamp: baseTime - 240_000,
        triggerPrice: 100.96,
      }),
      makeEvent({
        id: "ov2",
        eventType: "compression",
        timestamp: baseTime - 120_000,
        triggerPrice: 100.79,
      }),
      makeEvent({
        id: "ov3",
        eventType: "compression",
        timestamp: baseTime - 40_000,
        triggerPrice: 100.71,
      }),
      makeEvent({
        id: "ov4",
        eventType: "fake_breakout",
        timestamp: baseTime - 10_000,
        triggerPrice: 101.03,
        pressureScore: 0.83,
      }),
    ];
    const variantEvents = [
      orderedEvents[0],
      orderedEvents[2],
      orderedEvents[1],
      orderedEvents[3],
    ];

    const orderedContext = buildContext(orderedEvents, baseTime, { updatesNearZone: 6 });
    const variantContext = buildContext(variantEvents, baseTime, { updatesNearZone: 6 });

    assert.equal(orderedContext.structureType, variantContext.structureType);
    assert.ok(Math.abs(orderedContext.structureStrength - variantContext.structureStrength) < 0.12);
  });
});
