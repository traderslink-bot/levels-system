import type { MonitoringEvent } from "./monitoring-types.js";
import { resolveZoneTacticalBias } from "../levels/zone-tactical-read.js";

export type OpportunityClassification = "high_conviction" | "medium" | "low";

export type RankedOpportunity = {
  symbol: string;
  type: string;
  eventType?: string;
  level: number;
  strength: number;
  confidence: number;
  priority: number;
  bias: string;
  pressureScore: number;
  structureType: string | null;
  structureStrength: number;
  timestamp: number;
  score: number;
  normalizedScore: number;
  classification: OpportunityClassification;
  nextBarrierDistancePct?: number;
  clearanceLabel?: "tight" | "limited" | "open";
  barrierClutterLabel?: "clear" | "stacked" | "dense";
  nearbyBarrierCount?: number;
  pathQualityLabel?: "clean" | "layered" | "choppy";
  pathBarrierCount?: number;
  tacticalRead?: "firm" | "balanced" | "tired";
  exhaustionLabel?: "fresh" | "tested" | "worn" | "spent";
};

type MonitoringEventWithStructure = MonitoringEvent & {
  structureType?: string | null;
  structureStrength?: number;
};

const TIME_DECAY_CONSTANT_MS = 15 * 60 * 1000;
const STACKING_WINDOW_MS = 10 * 60 * 1000;
const MAX_STACKING_BOOST = 0.1;
const STACKING_SCALE = 0.06;
const MIN_SCORE = 0.35;
const MAX_OPPORTUNITIES_PER_SYMBOL = 2;

function clamp(value: number, min: number = 0, max: number = 1): number {
  return Math.max(min, Math.min(max, value));
}

function isBullishEvent(eventType: string): boolean {
  return eventType === "breakout" || eventType === "reclaim" || eventType === "fake_breakdown";
}

function isBearishEvent(eventType: string): boolean {
  return eventType === "breakdown" || eventType === "rejection" || eventType === "fake_breakout";
}

function structureBaseBoost(structureType: string | null): number {
  switch (structureType) {
    case "breakout_setup":
    case "rejection_setup":
      return 0.15;
    case "compression":
      return 0.05;
    default:
      return 0;
  }
}

function biasBoost(eventType: string, bias: string): number {
  if (
    (isBullishEvent(eventType) && bias === "bullish") ||
    (isBearishEvent(eventType) && bias === "bearish")
  ) {
    return 0.08;
  }

  if (
    (isBullishEvent(eventType) && bias === "bearish") ||
    (isBearishEvent(eventType) && bias === "bullish")
  ) {
    return -0.06;
  }

  return -0.02;
}

function structureConflictPenalty(
  eventType: string,
  bias: string,
  structureType: string | null,
): number {
  if (
    structureType === "breakout_setup" &&
    (bias === "bearish" || isBearishEvent(eventType))
  ) {
    return 0.06;
  }

  if (
    structureType === "rejection_setup" &&
    (bias === "bullish" || isBullishEvent(eventType))
  ) {
    return 0.06;
  }

  return 0;
}

function typeWeight(eventType: string): number {
  switch (eventType) {
    case "breakout":
    case "breakdown":
    case "reclaim":
      return 1.08;
    case "rejection":
    case "fake_breakout":
    case "fake_breakdown":
      return 1.03;
    case "compression":
    case "level_touch":
    default:
      return 0.97;
  }
}

function timeWeight(referenceTimestamp: number, eventTimestamp: number): number {
  const elapsedMs = Math.max(0, referenceTimestamp - eventTimestamp);
  return Math.exp(-elapsedMs / TIME_DECAY_CONSTANT_MS);
}

function recentSignalMass(
  events: MonitoringEvent[],
  symbol: string,
  referenceTimestamp: number,
): number {
  return events
    .filter(
      (event) =>
        event.symbol === symbol &&
        referenceTimestamp - event.timestamp >= 0 &&
        referenceTimestamp - event.timestamp <= STACKING_WINDOW_MS,
    )
    .reduce((sum, event) => sum + clamp(event.strength) * clamp(event.confidence), 0);
}

function stackingBoost(signalMass: number): number {
  const extraMass = Math.max(0, signalMass - 1);
  return Math.min(MAX_STACKING_BOOST, extraMass * STACKING_SCALE);
}

function classifyOpportunity(score: number, confidence: number): OpportunityClassification {
  if (score >= 0.75 && confidence >= 0.7) {
    return "high_conviction";
  }

  if (score >= 0.5 && confidence >= 0.45) {
    return "medium";
  }

  return "low";
}

function clearanceAdjustment(event: MonitoringEvent): number {
  const clearanceLabel = event.eventContext.clearanceLabel;
  const barrierDistancePct = event.eventContext.nextBarrierDistancePct;

  if (clearanceLabel === "tight") {
    return -0.16;
  }

  if (clearanceLabel === "limited") {
    return -0.08;
  }

  if (clearanceLabel === "open") {
    return 0.04;
  }

  if (typeof barrierDistancePct === "number" && barrierDistancePct >= 0.06) {
    return 0.03;
  }

  return 0;
}

function tacticalAdjustment(event: MonitoringEvent): number {
  const tacticalBias = resolveZoneTacticalBias({
    zoneKind: event.zoneKind,
    eventType: event.eventType,
    tacticalRead: event.eventContext.tacticalRead,
  });

  if (tacticalBias === "tailwind") {
    return 0.05;
  }

  if (tacticalBias === "headwind") {
    return -0.07;
  }

  return 0;
}

function clutterAdjustment(event: MonitoringEvent): number {
  const clutterLabel = event.eventContext.barrierClutterLabel;

  if (clutterLabel === "dense") {
    return -0.08;
  }

  if (clutterLabel === "stacked") {
    return -0.04;
  }

  return 0;
}

function pathQualityAdjustment(event: MonitoringEvent): number {
  const label = event.eventContext.pathQualityLabel;
  const barrierCount = event.eventContext.pathBarrierCount ?? 0;
  const pathWindowDistancePct = event.eventContext.pathWindowDistancePct ?? 0;

  if (label === "choppy") {
    return -0.08 - Math.max(0, barrierCount - 3) * 0.01;
  }

  if (label === "layered") {
    return -0.04 - Math.max(0, barrierCount - 2) * 0.01;
  }

  if (label === "clean") {
    return 0.02 + Math.min(0.02, Math.max(0, pathWindowDistancePct - 0.05) * 0.2);
  }

  return 0;
}

function exhaustionAdjustment(event: MonitoringEvent): number {
  const label = event.eventContext.exhaustionLabel;

  if (
    (label === "worn" || label === "spent") &&
    ((event.zoneKind === "support" &&
      (event.eventType === "level_touch" || event.eventType === "reclaim")) ||
      (event.zoneKind === "resistance" &&
        (event.eventType === "level_touch" || event.eventType === "rejection")))
  ) {
    return label === "spent" ? -0.1 : -0.055;
  }

  if (
    (label === "worn" || label === "spent") &&
    ((event.zoneKind === "resistance" && event.eventType === "breakout") ||
      (event.zoneKind === "support" && event.eventType === "breakdown"))
  ) {
    return label === "spent" ? 0.045 : 0.025;
  }

  return 0;
}

export class OpportunityEngine {
  constructor(private readonly debug: boolean = false) {}

  rank(events: MonitoringEvent[]): RankedOpportunity[] {
    if (events.length === 0) {
      return [];
    }

    const referenceTimestamp = Math.max(...events.map((event) => event.timestamp));

    const ranked = events.map((event) => {
      const enrichedEvent = event as MonitoringEventWithStructure;
      const resolvedStructureType = enrichedEvent.structureType ?? null;
      const resolvedStructureStrength = clamp(enrichedEvent.structureStrength ?? 0);
      const baseScore =
        event.strength * 0.42 +
        event.confidence * 0.28 +
        clamp(event.priority / 100) * 0.15 +
        resolvedStructureStrength * 0.08 +
        clamp(event.pressureScore) * 0.07;
      const nonlinearScore = Math.pow(baseScore, 1.12);
      const resolvedStructureBoost =
        structureBaseBoost(resolvedStructureType) * resolvedStructureStrength;
      const resolvedBiasBoost = biasBoost(event.eventType, event.bias);
      const resolvedStackingBoost = stackingBoost(
        recentSignalMass(events, event.symbol, referenceTimestamp),
      );
      const conflictPenalty = structureConflictPenalty(
        event.eventType,
        event.bias,
        resolvedStructureType,
      );
      const qualityWeight = 0.65 + clamp(event.strength) * 0.2 + clamp(event.confidence) * 0.15;
      const resolvedClearanceAdjustment = clearanceAdjustment(event);
      const resolvedClutterAdjustment = clutterAdjustment(event);
      const resolvedPathQualityAdjustment = pathQualityAdjustment(event);
      const resolvedTacticalAdjustment = tacticalAdjustment(event);
      const resolvedExhaustionAdjustment = exhaustionAdjustment(event);

      const score =
        nonlinearScore *
        timeWeight(referenceTimestamp, event.timestamp) *
        Math.max(
          0.7,
          1 +
            resolvedStructureBoost +
            resolvedBiasBoost +
            resolvedStackingBoost -
            conflictPenalty +
            resolvedClearanceAdjustment +
            resolvedClutterAdjustment +
            resolvedPathQualityAdjustment +
            resolvedTacticalAdjustment +
            resolvedExhaustionAdjustment,
        ) *
        typeWeight(event.eventType) *
        qualityWeight;

      return {
        symbol: event.symbol,
        type: event.type,
        eventType: event.eventType,
        level: event.level,
        strength: event.strength,
        confidence: event.confidence,
        priority: event.priority,
        bias: event.bias,
        pressureScore: event.pressureScore,
        structureType: resolvedStructureType,
        structureStrength: resolvedStructureStrength,
        timestamp: event.timestamp,
        score: Number(score.toFixed(4)),
        normalizedScore: 0,
        classification: "low" as OpportunityClassification,
        nextBarrierDistancePct: event.eventContext.nextBarrierDistancePct,
        clearanceLabel: event.eventContext.clearanceLabel,
        barrierClutterLabel: event.eventContext.barrierClutterLabel,
        nearbyBarrierCount: event.eventContext.nearbyBarrierCount,
        pathQualityLabel: event.eventContext.pathQualityLabel,
        pathBarrierCount: event.eventContext.pathBarrierCount,
        tacticalRead: event.eventContext.tacticalRead,
        exhaustionLabel: event.eventContext.exhaustionLabel,
      };
    });

    const maxScore = Math.max(...ranked.map((opportunity) => opportunity.score), MIN_SCORE);

    return ranked
      .map((opportunity) => {
        const normalizedScore = Number(
          clamp(opportunity.score / Math.max(maxScore, 0.0001)).toFixed(4),
        );

        return {
          ...opportunity,
          normalizedScore,
          classification: classifyOpportunity(opportunity.score, opportunity.confidence),
        };
      })
      .filter((opportunity) => opportunity.score >= MIN_SCORE)
      .sort((left, right) => {
        if (right.normalizedScore !== left.normalizedScore) {
          return right.normalizedScore - left.normalizedScore;
        }

        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence;
        }

        return right.timestamp - left.timestamp;
      });
  }

  selectTop<T extends RankedOpportunity>(opportunities: T[], limit: number): T[] {
    const selected: T[] = [];
    const perSymbolCounts = new Map<string, number>();

    for (const opportunity of opportunities) {
      if (selected.length >= limit) {
        break;
      }

      const symbolCount = perSymbolCounts.get(opportunity.symbol) ?? 0;
      if (symbolCount >= MAX_OPPORTUNITIES_PER_SYMBOL) {
        continue;
      }

      selected.push(opportunity);
      perSymbolCounts.set(opportunity.symbol, symbolCount + 1);
    }

    if (this.debug) {
      console.log("[OpportunityEngine] Top opportunities:");
      selected.slice(0, 5).forEach((opportunity, index) => {
        console.log(
          `${index + 1}. ${opportunity.symbol} ${opportunity.type} ` +
            `score=${opportunity.score.toFixed(4)} normalized=${opportunity.normalizedScore.toFixed(4)} ` +
            `classification=${opportunity.classification}`,
        );
      });
    }

    return selected;
  }
}
