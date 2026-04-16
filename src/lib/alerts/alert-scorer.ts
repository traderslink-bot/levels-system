// 2026-04-16 01:14 PM America/Toronto
// Scores enriched monitoring events into trader-facing alert quality while preserving zone context.

import type { FinalLevelZone } from "../levels/level-types.js";
import type { MonitoringEvent } from "../monitoring/monitoring-types.js";
import type { AlertConfidence, AlertSeverity, IntelligentAlert } from "./alert-types.js";
import type { AlertIntelligenceConfig } from "./alert-config.js";

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
): Record<string, number> {
  const context = event.eventContext;
  const lowValueInnerZone = context.ladderPosition === "inner" && context.zoneStrengthLabel === "weak";

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

  return [...new Set(tags)];
}

function buildHumanTitle(event: MonitoringEvent): string {
  return `${event.symbol} ${event.eventType.replaceAll("_", " ")}`;
}

function buildHumanBody(event: MonitoringEvent, zone?: FinalLevelZone): string {
  if (!zone) {
    return `${event.eventType.replaceAll("_", " ")} at ${event.triggerPrice.toFixed(2)}`;
  }

  const context = event.eventContext;
  const zoneText =
    zone.zoneLow >= 1 && zone.zoneHigh >= 1
      ? `${zone.zoneLow.toFixed(2)}-${zone.zoneHigh.toFixed(2)}`
      : `${zone.zoneLow.toFixed(4)}-${zone.zoneHigh.toFixed(4)}`;
  const ladderText =
    context.zoneOrigin === "promoted_extension"
      ? "promoted extension"
      : context.ladderPosition === "outermost"
        ? "outermost"
        : "inner";
  const freshnessText = context.zoneFreshness;
  const remapText =
    context.remapStatus === "new" || context.remapStatus === "preserved"
      ? null
      : context.remapStatus.replaceAll("_", " ");
  const refreshText = context.recentlyRefreshed ? "refreshed" : null;
  const qualityText = context.dataQualityDegraded ? "data quality degraded" : null;

  return [
    `${event.eventType.replaceAll("_", " ")} ${event.zoneKind} ${zoneText}`,
    `${zone.strengthLabel} ${ladderText}`,
    freshnessText,
    remapText,
    refreshText,
    qualityText,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" | ");
}

export function scoreMonitoringEventToAlert(params: {
  event: MonitoringEvent;
  zone?: FinalLevelZone;
  config: AlertIntelligenceConfig;
}): IntelligentAlert {
  const { event, zone, config } = params;
  const scoreComponents = contextContributions(event, zone, config);
  const totalScore = clampScore(
    Object.values(scoreComponents).reduce((sum, value) => sum + value, 0),
  );
  const severity = severityForScore(totalScore, config);
  const confidence = confidenceForScore(totalScore, config);

  return {
    id: `${event.id}-intelligent`,
    symbol: event.symbol,
    title: buildHumanTitle(event),
    body: buildHumanBody(event, zone),
    severity,
    confidence,
    score: totalScore,
    shouldNotify: totalScore >= config.notifyThreshold,
    tags: tagsForAlert(event, zone),
    scoreComponents,
    event,
    zone,
  };
}
