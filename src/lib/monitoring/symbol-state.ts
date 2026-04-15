import type { FinalLevelZone } from "../levels/level-types.js";
import type {
  MonitoringEvent,
  MonitoringEventType,
  SymbolBias,
  SymbolMonitoringState,
  ZoneInteractionState,
} from "./monitoring-types.js";

const MAX_RECENT_EVENTS = 25;
const MAX_EVENT_AGE_MS = 45 * 60 * 1000;
const BIAS_THRESHOLD = 0.18;
const COMPRESSION_REPEATED_TEST_THRESHOLD = 1.15;
const COMPRESSION_INTERVAL_ACCELERATION_THRESHOLD = 0.9;
const REJECTION_SETUP_THRESHOLD = 0.85;
const RANGE_COMPRESSION_THRESHOLD = 0.18;

type StructureType = "compression" | "breakout_setup" | "rejection_setup" | null;

const EVENT_TYPE_DECAY_MS: Record<MonitoringEventType, number> = {
  breakout: 15 * 60 * 1000,
  breakdown: 15 * 60 * 1000,
  reclaim: 12 * 60 * 1000,
  rejection: 8 * 60 * 1000,
  fake_breakout: 8 * 60 * 1000,
  fake_breakdown: 8 * 60 * 1000,
  compression: 6 * 60 * 1000,
  level_touch: 5 * 60 * 1000,
};

const EVENT_TYPE_IMPORTANCE: Record<MonitoringEventType, number> = {
  breakout: 1,
  breakdown: 1,
  reclaim: 0.92,
  rejection: 0.82,
  fake_breakout: 0.8,
  fake_breakdown: 0.8,
  compression: 0.58,
  level_touch: 0.45,
};

function clamp(value: number, min: number = 0, max: number = 1): number {
  return Math.max(min, Math.min(max, value));
}

function directionalWeight(event: MonitoringEvent): number {
  switch (event.eventType) {
    case "breakout":
    case "reclaim":
    case "fake_breakdown":
      return 1;
    case "breakdown":
    case "rejection":
    case "fake_breakout":
      return -1;
    case "level_touch":
    case "compression":
    default:
      return 0;
  }
}

function eventDecayConstantMs(eventType: MonitoringEventType): number {
  return EVENT_TYPE_DECAY_MS[eventType];
}

function eventImportanceWeight(eventType: MonitoringEventType): number {
  return EVENT_TYPE_IMPORTANCE[eventType];
}

function decayWeight(event: MonitoringEvent, referenceTimestamp: number): number {
  const timeDeltaMs = Math.max(0, referenceTimestamp - event.timestamp);
  const timeDecay = Math.exp(-timeDeltaMs / eventDecayConstantMs(event.eventType));

  return timeDecay * eventImportanceWeight(event.eventType);
}

function toWeightedEvent(
  event: MonitoringEvent,
  referenceTimestamp: number,
): MonitoringEvent {
  return {
    ...event,
    memoryWeight: Number(decayWeight(event, referenceTimestamp).toFixed(6)),
  };
}

function pruneEvents(
  events: MonitoringEvent[],
  referenceTimestamp: number,
  maxAgeMs: number = MAX_EVENT_AGE_MS,
): MonitoringEvent[] {
  return events
    .filter((event) => referenceTimestamp - event.timestamp <= maxAgeMs)
    .slice(-MAX_RECENT_EVENTS);
}

function weightedEventSum(
  events: MonitoringEvent[],
  selector: (event: MonitoringEvent) => number,
): number {
  return events.reduce(
    (sum, event) => sum + selector(event) * (event.memoryWeight ?? 0),
    0,
  );
}

function weightedAverageGapMs(events: MonitoringEvent[]): number | null {
  if (events.length < 2) {
    return null;
  }

  let totalWeight = 0;
  let weightedGap = 0;

  for (let index = 1; index < events.length; index += 1) {
    const current = events[index];
    const previous = events[index - 1];
    const gapMs = Math.max(0, current.timestamp - previous.timestamp);
    const pairWeight = ((current.memoryWeight ?? 0) + (previous.memoryWeight ?? 0)) / 2;

    if (pairWeight <= 0) {
      continue;
    }

    totalWeight += pairWeight;
    weightedGap += gapMs * pairWeight;
  }

  if (totalWeight <= 0) {
    return null;
  }

  return weightedGap / totalWeight;
}

function priceSpan(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  return Math.max(...values) - Math.min(...values);
}

function computeRangeCompressionScore(
  sameZoneEvents: MonitoringEvent[],
  zone: FinalLevelZone,
): number {
  const buildEvents = sameZoneEvents.filter(
    (event) => event.eventType === "level_touch" || event.eventType === "compression",
  );

  if (buildEvents.length < 3) {
    return 0;
  }

  const prices = buildEvents.map((event) => event.triggerPrice);
  const recentPrices = buildEvents.slice(-3).map((event) => event.triggerPrice);
  const baselineSpan = priceSpan(prices);
  const recentSpan = priceSpan(recentPrices);
  const zoneWidth = Math.max(zone.zoneHigh - zone.zoneLow, 0.0001);

  if (baselineSpan <= 0) {
    return recentSpan <= zoneWidth * RANGE_COMPRESSION_THRESHOLD ? 1 : 0;
  }

  return Number(
    clamp(
      1 - recentSpan / Math.max(baselineSpan, zoneWidth * 0.5),
    ).toFixed(4),
  );
}

function scaleStructureStrength(pressureScore: number, bonus: number = 0): number {
  return Number(clamp(1 - Math.exp(-(pressureScore + bonus))).toFixed(4));
}

function detectStructure(params: {
  sameZoneEvents: MonitoringEvent[];
  repeatedTests: number;
  failedBreakoutCount: number;
  bias: SymbolBias;
  pressureScore: number;
  rangeCompressionScore: number;
}): {
  structureType: StructureType;
  structureStrength: number;
} {
  const {
    sameZoneEvents,
    repeatedTests,
    failedBreakoutCount,
    bias,
    pressureScore,
    rangeCompressionScore,
  } = params;
  const buildEvents = sameZoneEvents.filter(
    (event) => event.eventType === "level_touch" || event.eventType === "compression",
  );
  const earlierBuildEvents = buildEvents.slice(0, -1);
  const laterBuildEvents = buildEvents.slice(-3);
  const earlierGapMs = weightedAverageGapMs(earlierBuildEvents);
  const laterGapMs = weightedAverageGapMs(laterBuildEvents);
  const acceleratingTests =
    earlierGapMs !== null &&
    laterGapMs !== null &&
    laterGapMs > 0 &&
    laterGapMs <= earlierGapMs * COMPRESSION_INTERVAL_ACCELERATION_THRESHOLD;
  const compressionSignal =
    repeatedTests / 2.5 +
    (acceleratingTests ? 0.28 : 0) +
    rangeCompressionScore * 0.45 +
    Math.min(buildEvents.length, 4) * 0.04;
  const compressionStrength = scaleStructureStrength(pressureScore, compressionSignal * 0.4);

  if (failedBreakoutCount >= REJECTION_SETUP_THRESHOLD) {
    return {
      structureType: "rejection_setup",
      structureStrength: scaleStructureStrength(
        pressureScore,
        failedBreakoutCount / 1.6 + Math.max(0, repeatedTests - 0.8) * 0.1,
      ),
    };
  }

  if (
    repeatedTests >= COMPRESSION_REPEATED_TEST_THRESHOLD &&
    (acceleratingTests || buildEvents.length >= 3) &&
    rangeCompressionScore >= RANGE_COMPRESSION_THRESHOLD
  ) {
    if (bias === "bullish") {
      return {
        structureType: "breakout_setup",
        structureStrength: scaleStructureStrength(pressureScore, compressionSignal * 0.55),
      };
    }

    return {
      structureType: "compression",
      structureStrength: Number(compressionStrength.toFixed(4)),
    };
  }

  return {
    structureType: null,
    structureStrength: 0,
  };
}

function getWeightedRecentEvents(
  symbolState: SymbolMonitoringState,
  referenceTimestamp: number,
): MonitoringEvent[] {
  const prunedEvents = pruneEvents(symbolState.recentEvents, referenceTimestamp);

  if (prunedEvents.length !== symbolState.recentEvents.length) {
    symbolState.recentEvents = prunedEvents;
  }

  return symbolState.recentEvents.map((event) => toWeightedEvent(event, referenceTimestamp));
}

export function deriveSymbolBias(
  events: MonitoringEvent[],
  referenceTimestamp: number,
): SymbolBias {
  if (events.length === 0) {
    return "neutral";
  }

  const weightedEvents = events.map((event) => toWeightedEvent(event, referenceTimestamp));
  const totalWeight = weightedEvents.reduce((sum, event) => sum + (event.memoryWeight ?? 0), 0);

  if (totalWeight <= 0) {
    return "neutral";
  }

  const directionalScore = weightedEventSum(weightedEvents, directionalWeight) / totalWeight;

  if (directionalScore >= BIAS_THRESHOLD) {
    return "bullish";
  }

  if (directionalScore <= -BIAS_THRESHOLD) {
    return "bearish";
  }

  return "neutral";
}

export function computePressureScore(params: {
  symbolState: SymbolMonitoringState;
  zone: FinalLevelZone;
  currentState: ZoneInteractionState;
  referenceTimestamp: number;
}): number {
  const { symbolState, zone, currentState, referenceTimestamp } = params;
  const sameZoneEvents = getWeightedRecentEvents(symbolState, referenceTimestamp).filter(
    (event) => event.zoneId === zone.id,
  );
  const buildPressure = weightedEventSum(
    sameZoneEvents,
    (event) => (event.eventType === "level_touch" || event.eventType === "compression" ? 1 : 0),
  );
  const failedBreakPressure = weightedEventSum(
    sameZoneEvents,
    (event) =>
      event.eventType === "fake_breakout" || event.eventType === "fake_breakdown" ? 0.7 : 0,
  );

  return Number(
    clamp(
      currentState.updatesNearZone / 5 +
        buildPressure / 3.5 +
        failedBreakPressure / 4.5 +
        zone.touchCount / 20,
    ).toFixed(4),
  );
}

export function buildSymbolContext(params: {
  symbolState: SymbolMonitoringState;
  zone: FinalLevelZone;
  currentState: ZoneInteractionState;
  referenceTimestamp: number;
}): {
  bias: SymbolBias;
  pressureScore: number;
  repeatedTests: number;
  failedBreakoutCount: number;
  failedBreakdownCount: number;
  rangeCompressionScore: number;
  structureType: StructureType;
  structureStrength: number;
} {
  const { symbolState, zone, currentState, referenceTimestamp } = params;
  const weightedEvents = getWeightedRecentEvents(symbolState, referenceTimestamp);
  const sameZoneEvents = weightedEvents.filter((event) => event.zoneId === zone.id);
  const bias = deriveSymbolBias(weightedEvents, referenceTimestamp);
  const pressureScore = computePressureScore({
    symbolState,
    zone,
    currentState,
    referenceTimestamp,
  });
  const repeatedTests = Number(
    weightedEventSum(
      sameZoneEvents,
      (event) => (event.eventType === "level_touch" || event.eventType === "compression" ? 1 : 0),
    ).toFixed(4),
  );
  const failedBreakoutCount = Number(
    weightedEventSum(sameZoneEvents, (event) => (event.eventType === "fake_breakout" ? 1 : 0)).toFixed(4),
  );
  const failedBreakdownCount = Number(
    weightedEventSum(sameZoneEvents, (event) => (event.eventType === "fake_breakdown" ? 1 : 0)).toFixed(4),
  );
  const rangeCompressionScore = computeRangeCompressionScore(sameZoneEvents, zone);
  const structure = detectStructure({
    sameZoneEvents,
    repeatedTests,
    failedBreakoutCount,
    bias,
    pressureScore,
    rangeCompressionScore,
  });

  return {
    bias,
    pressureScore,
    repeatedTests,
    failedBreakoutCount,
    failedBreakdownCount,
    rangeCompressionScore,
    structureType: structure.structureType,
    structureStrength: structure.structureStrength,
  };
}

function isCompressionMemoryEvent(event: MonitoringEvent): boolean {
  return event.eventType === "level_touch" || event.eventType === "compression";
}

function resolvesZoneStructure(eventType: MonitoringEventType): boolean {
  return (
    eventType === "breakout" ||
    eventType === "breakdown" ||
    eventType === "rejection" ||
    eventType === "reclaim"
  );
}

export function recordMonitoringEvent(
  symbolState: SymbolMonitoringState,
  event: MonitoringEvent,
): void {
  const baseEvents = resolvesZoneStructure(event.eventType)
    ? symbolState.recentEvents.filter(
        (recentEvent) => !(recentEvent.zoneId === event.zoneId && isCompressionMemoryEvent(recentEvent)),
      )
    : symbolState.recentEvents;
  const nextEvents = pruneEvents(
    [
      ...baseEvents,
      {
        ...event,
        pressureScore: resolvesZoneStructure(event.eventType) ? 0 : event.pressureScore,
        memoryWeight: 1,
      },
    ],
    event.timestamp,
  );

  symbolState.recentEvents = nextEvents;
  symbolState.bias = deriveSymbolBias(symbolState.recentEvents, event.timestamp);
  symbolState.pressureScore = Number(
    clamp(
      getWeightedRecentEvents(symbolState, event.timestamp).reduce(
        (max, recentEvent) => Math.max(max, recentEvent.pressureScore * (recentEvent.memoryWeight ?? 0)),
        0,
      ),
    ).toFixed(4),
  );
}
