// 2026-04-14 10:18 PM America/Toronto
// Scores enriched monitoring events into trader-facing alert quality.

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

function tagsForAlert(event: MonitoringEvent, zone?: FinalLevelZone): string[] {
  const tags: string[] = [event.eventType, event.zoneKind];

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
    return `${event.eventType.replaceAll("_", " ")} detected at ${event.triggerPrice}.`;
  }

  const zoneText = `${zone.zoneLow.toFixed(4)} to ${zone.zoneHigh.toFixed(4)}`;
  return `${event.eventType.replaceAll("_", " ")} on ${zone.strengthLabel} ${event.zoneKind} zone (${zoneText}) at ${event.triggerPrice}.`;
}

export function scoreMonitoringEventToAlert(params: {
  event: MonitoringEvent;
  zone?: FinalLevelZone;
  config: AlertIntelligenceConfig;
}): IntelligentAlert {
  const { event, zone, config } = params;
  const base = config.eventBaseScores[event.eventType];
  const totalScore = base + zoneStrengthContribution(zone, config);
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
    event,
    zone,
  };
}
