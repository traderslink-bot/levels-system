// 2026-04-16 01:14 PM America/Toronto
// Scores enriched monitoring events into trader-facing alert quality while preserving zone context.

import type { FinalLevelZone } from "../levels/level-types.js";
import type { MonitoringEvent } from "../monitoring/monitoring-types.js";
import type {
  AlertConfidence,
  AlertSeverity,
  IntelligentAlert,
  TraderNextBarrierContext,
} from "./alert-types.js";
import type { AlertIntelligenceConfig } from "./alert-config.js";
import { resolveZoneTacticalBias } from "../levels/zone-tactical-read.js";
import {
  buildTraderAlertBody,
  deriveTraderDipBuyQualityContext,
  deriveTraderExhaustionContext,
  deriveTraderFailureRiskContext,
  deriveTraderMovementContext,
  deriveTraderPathQualityContext,
  deriveTraderPressureContext,
  deriveTraderSetupStateContext,
  deriveTraderTriggerQualityContext,
  deriveTraderTargetContext,
  deriveTraderTradeMapContext,
  deriveTraderZoneTacticalRead,
} from "./trader-message-language.js";

function severityForScore(score: number, config: AlertIntelligenceConfig): AlertSeverity {
  if (score >= config.severityThresholds.critical) {
    return "critical";
  }
  if (score >= config.severityThresholds.high) {
    return "high";
  }
  if (score >= config.severityThresholds.medium) {
    return "medium";
  }
  return "low";
}

function confidenceForScore(score: number, config: AlertIntelligenceConfig): AlertConfidence {
  if (score >= config.confidenceThresholds.high) {
    return "high";
  }
  if (score >= config.confidenceThresholds.medium) {
    return "medium";
  }
  return "low";
}

function applyConfidenceCaps(params: {
  confidence: AlertConfidence;
  pressure: ReturnType<typeof deriveTraderPressureContext>;
  triggerQuality: ReturnType<typeof deriveTraderTriggerQualityContext>;
}): AlertConfidence {
  const { confidence, pressure, triggerQuality } = params;
  if (
    confidence === "high" &&
    (pressure.label === "tentative" ||
      triggerQuality?.label === "crowded" ||
      triggerQuality?.label === "late")
  ) {
    return "medium";
  }

  return confidence;
}

function clampScore(value: number): number {
  return Number(Math.max(0, value).toFixed(2));
}

function zoneStrengthContribution(
  zone: FinalLevelZone | undefined,
  config: AlertIntelligenceConfig,
): number {
  if (!zone) {
    return 0;
  }

  let score = config.strengthLabelScores[zone.strengthLabel];
  score += zone.confluenceCount * config.timeframeConfluenceBonus;

  if (zone.strengthLabel === "weak") {
    score -= config.weakZonePenalty;
  }

  if (zone.timeframeSources.length === 1 && zone.timeframeSources[0] === "5m") {
    score -= config.weak5mOnlyPenalty;
  }

  return score;
}

function structuralQualityContribution(zone: FinalLevelZone | undefined): number {
  if (!zone) {
    return 0;
  }

  return Number(
    (
      zone.reactionQualityScore * 4 +
      zone.rejectionScore * 4 +
      zone.displacementScore * 3 +
      zone.sessionSignificanceScore * 2
    ).toFixed(2),
  );
}

function eventStrengthContribution(event: MonitoringEvent, config: AlertIntelligenceConfig): number {
  return Number(
    (
      event.strength * 14 +
      event.confidence * 10 +
      Math.min(event.priority, 100) / 5 +
      event.pressureScore * config.structureStrengthScale
    ).toFixed(2),
  );
}

function contextContributions(
  event: MonitoringEvent,
  zone: FinalLevelZone | undefined,
  config: AlertIntelligenceConfig,
  nextBarrier?: TraderNextBarrierContext | null,
): Record<string, number> {
  const context = event.eventContext;
  const lowValueInnerZone = context.ladderPosition === "inner" && context.zoneStrengthLabel === "weak";
  const tacticalRead = deriveTraderZoneTacticalRead(zone, context.zoneFreshness);
  const movement = deriveTraderMovementContext(event, zone);
  const pressure = deriveTraderPressureContext(event);
  const triggerQuality = deriveTraderTriggerQualityContext({
    event,
    movement,
    pressure,
    nextBarrier,
  });
  const dipBuyQuality = deriveTraderDipBuyQualityContext({
    event,
    zone,
    pressure,
    nextBarrier,
  });
  const exhaustion = deriveTraderExhaustionContext(event, zone);
  const pathQuality = deriveTraderPathQualityContext(nextBarrier);
  const tacticalBias = zone
    ? resolveZoneTacticalBias({
      zoneKind: zone.kind,
      eventType: event.eventType,
      tacticalRead,
    })
    : "neutral";
  const directionalResolution =
    event.eventType === "breakout" ||
    event.eventType === "breakdown" ||
    event.eventType === "reclaim" ||
    event.eventType === "fake_breakout" ||
    event.eventType === "fake_breakdown";
  const clearanceScore =
    context.clearanceLabel
      ? config.clearanceScores[context.clearanceLabel]
      : nextBarrier && nextBarrier.distancePct >= 0.06
        ? config.clearanceScores.open
        : 0;

  return {
    baseEvent: config.eventBaseScores[event.eventType],
    zoneStrength: zoneStrengthContribution(zone, config),
    structuralQuality: structuralQualityContribution(zone),
    eventStrength: eventStrengthContribution(event, config),
    freshness: config.freshnessScores[context.zoneFreshness],
    origin: config.originScores[context.zoneOrigin] ?? 0,
    ladderPosition: config.ladderPositionScores[context.ladderPosition],
    remap: config.remapScores[context.remapStatus],
    recentRefresh: context.recentlyRefreshed ? config.recentRefreshBonus : 0,
    promotedExtension:
      context.recentlyPromotedExtension || context.zoneOrigin === "promoted_extension"
        ? config.promotedExtensionBonus
        : 0,
    dataQuality: context.dataQualityDegraded ? -config.dataQualityPenalty : 0,
    degradedDirectionalRisk:
      directionalResolution && context.dataQualityDegraded
        ? -config.degradedDirectionalPenalty
        : 0,
    clearance: clearanceScore,
    clutter:
      context.barrierClutterLabel === "dense"
        ? -4
        : context.barrierClutterLabel === "stacked"
          ? -2
          : 0,
    pressureQuality: config.pressureLabelScores[pressure.label],
    triggerQuality: triggerQuality ? config.triggerQualityScores[triggerQuality.label] : 0,
    pathQuality:
      pathQuality?.label === "clean"
        ? 1.5 + Math.min(0.75, Math.max(0, (pathQuality.pathWindowDistancePct ?? 0) - 0.05) * 8)
        : pathQuality?.label === "layered"
          ? -1.5 - Math.max(0, pathQuality.barrierCount - 2) * 0.75
          : pathQuality?.label === "choppy"
            ? -4 - Math.max(0, pathQuality.barrierCount - 3) * 0.5
            : 0,
    dipBuyQuality:
      dipBuyQuality?.label === "actionable"
        ? 2
        : dipBuyQuality?.label === "watch_only"
          ? -1.5
          : dipBuyQuality?.label === "poor"
            ? -4
            : 0,
    exhaustion:
      exhaustion?.label === "fresh"
        ? 1
        : exhaustion?.label === "tested"
          ? -0.5
          : exhaustion?.label === "worn"
            ? -3
            : exhaustion?.label === "spent"
              ? -5
              : 0,
    tacticalRead: config.tacticalBiasScores[tacticalBias],
    tiredStructureRisk:
      tacticalRead === "tired" &&
      ((event.zoneKind === "support" &&
        (event.eventType === "level_touch" || event.eventType === "reclaim")) ||
        (event.zoneKind === "resistance" &&
          (event.eventType === "level_touch" || event.eventType === "rejection")))
        ? -3
        : 0,
    tiredBreakTailwind:
      tacticalRead === "tired" &&
      ((event.zoneKind === "resistance" && event.eventType === "breakout") ||
        (event.zoneKind === "support" && event.eventType === "breakdown"))
        ? 1.5
        : 0,
    innerDirectionalRisk:
      directionalResolution &&
      context.ladderPosition === "inner" &&
      pressure.label !== "strong"
        ? -config.innerDirectionalPenalty
        : 0,
    lowValueInnerTouch:
      event.eventType === "level_touch" && lowValueInnerZone ? -config.lowValueInnerTouchPenalty : 0,
    lowValueInnerCompression:
      event.eventType === "compression" && lowValueInnerZone
        ? -config.lowValueInnerCompressionPenalty
        : 0,
  };
}

function tagsForAlert(event: MonitoringEvent, zone?: FinalLevelZone): string[] {
  const tags: string[] = [
    event.eventType,
    event.zoneKind,
    event.eventContext.zoneOrigin,
    event.eventContext.ladderPosition,
    event.eventContext.zoneFreshness,
    event.eventContext.remapStatus,
  ];

  if (event.eventContext.dataQualityDegraded) {
    tags.push("data_quality_degraded");
  }

  if (event.eventContext.recentlyRefreshed) {
    tags.push("recently_refreshed");
  }

  if (event.eventContext.recentlyPromotedExtension) {
    tags.push("recently_promoted_extension");
  }

  if (zone) {
    tags.push(zone.strengthLabel);
    tags.push(...zone.timeframeSources);
  }

  if (event.eventContext.barrierClutterLabel) {
    tags.push(`clutter_${event.eventContext.barrierClutterLabel}`);
  }

  if (event.eventContext.pathQualityLabel) {
    tags.push(`path_${event.eventContext.pathQualityLabel}`);
  }

  if (event.eventContext.exhaustionLabel) {
    tags.push(`exhaustion_${event.eventContext.exhaustionLabel}`);
  }

  return [...new Set(tags)];
}

function buildHumanTitle(event: MonitoringEvent): string {
  return `${event.symbol} ${event.eventType.replaceAll("_", " ")}`;
}

function buildHumanBody(
  event: MonitoringEvent,
  zone?: FinalLevelZone,
  nextBarrier?: TraderNextBarrierContext | null,
): string {
  return buildTraderAlertBody(event, zone, nextBarrier);
}

export function scoreMonitoringEventToAlert(params: {
  event: MonitoringEvent;
  zone?: FinalLevelZone;
  nextBarrier?: TraderNextBarrierContext | null;
  config: AlertIntelligenceConfig;
}): IntelligentAlert {
  const { event, zone, nextBarrier, config } = params;
  const scoreComponents = contextContributions(event, zone, config, nextBarrier);
  const totalScore = clampScore(
    Object.values(scoreComponents).reduce((sum, value) => sum + value, 0),
  );
  const severity = severityForScore(totalScore, config);
  const movement = deriveTraderMovementContext(event, zone);
  const pressure = deriveTraderPressureContext(event);
  const triggerQuality = deriveTraderTriggerQualityContext({
    event,
    movement,
    pressure,
    nextBarrier,
  });
  const dipBuyQuality = deriveTraderDipBuyQualityContext({
    event,
    zone,
    pressure,
    nextBarrier,
  });
  const pathQuality = deriveTraderPathQualityContext(nextBarrier);
  const exhaustion = deriveTraderExhaustionContext(event, zone);
  const setupState = deriveTraderSetupStateContext({
    event,
    movement,
  });
  const failureRisk = deriveTraderFailureRiskContext({
    event,
    zone,
    pressure,
    triggerQuality,
    nextBarrier,
  });
  const confidence = applyConfidenceCaps({
    confidence: confidenceForScore(totalScore, config),
    pressure,
    triggerQuality,
  });

  return {
    id: `${event.id}-intelligent`,
    symbol: event.symbol,
    title: buildHumanTitle(event),
    body: buildHumanBody(event, zone, nextBarrier),
    severity,
    confidence,
    score: totalScore,
    shouldNotify: totalScore >= config.notifyThreshold,
    tags: tagsForAlert(event, zone),
    scoreComponents,
    event,
    zone,
    nextBarrier,
    tacticalRead: deriveTraderZoneTacticalRead(zone, event.eventContext.zoneFreshness),
    movement,
    pressure,
    triggerQuality,
    pathQuality,
    dipBuyQuality,
    exhaustion,
    setupState,
    failureRisk,
    target: deriveTraderTargetContext(event, zone, nextBarrier),
    tradeMap: deriveTraderTradeMapContext(event, zone, nextBarrier),
  };
}
