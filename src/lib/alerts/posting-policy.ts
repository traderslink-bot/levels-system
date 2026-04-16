// 2026-04-16 02:03 PM America/Toronto
// Explicit posting policy and deduplication rules for trader-facing alerts.

import type { AlertIntelligenceConfig } from "./alert-config.js";
import {
  alertPostingFamilyForEvent,
  alertPostingFamilyPriority,
  buildAlertScopeKey,
  buildAlertStateKey,
  isMateriallyNewAlertState,
} from "./alert-deduplication.js";
import type { AlertPostingDecision, IntelligentAlert } from "./alert-types.js";

type PostedAlertRecord = {
  alert: IntelligentAlert;
  family: ReturnType<typeof alertPostingFamilyForEvent>;
  scopeKey: string;
  stateKey: string;
  timestamp: number;
};

function severityRank(severity: IntelligentAlert["severity"]): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
    default:
      return 1;
  }
}

function confidenceRank(confidence: IntelligentAlert["confidence"]): number {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
    default:
      return 1;
  }
}

function familyWindowMs(
  family: ReturnType<typeof alertPostingFamilyForEvent>,
  config: AlertIntelligenceConfig,
): number {
  return config.postingWindowsMs[family];
}

export function prunePostedAlertHistory(
  history: PostedAlertRecord[],
  referenceTimestamp: number,
  config: AlertIntelligenceConfig,
): PostedAlertRecord[] {
  const maxWindow = Math.max(...Object.values(config.postingWindowsMs));
  return history.filter((record) => referenceTimestamp - record.timestamp <= maxWindow);
}

export function evaluateAlertPostingPolicy(params: {
  alert: IntelligentAlert;
  history: PostedAlertRecord[];
  config: AlertIntelligenceConfig;
}): AlertPostingDecision {
  const { alert, history, config } = params;
  const family = alertPostingFamilyForEvent(alert.event);
  const scopeKey = buildAlertScopeKey(alert);
  const stateKey = buildAlertStateKey(alert, family);
  const recentScopeRecords = history.filter((record) => {
    if (record.scopeKey !== scopeKey) {
      return false;
    }

    return alert.event.timestamp - record.timestamp <= familyWindowMs(record.family, config);
  });
  const recentStateRecord = recentScopeRecords.find((record) => record.stateKey === stateKey);

  if (recentStateRecord) {
    const scoreDelta = alert.score - recentStateRecord.alert.score;
    const severityImproved =
      severityRank(alert.severity) > severityRank(recentStateRecord.alert.severity);
    const confidenceImproved =
      confidenceRank(alert.confidence) > confidenceRank(recentStateRecord.alert.confidence);

    if (
      scoreDelta < config.materialScoreDeltaForRepost &&
      !severityImproved &&
      !confidenceImproved
    ) {
      return {
        shouldPost: false,
        reason: "duplicate_context",
        family,
        scopeKey,
        stateKey,
        comparedAlertId: recentStateRecord.alert.id,
      };
    }
  }

  const strongerRecentScopeRecord = [...recentScopeRecords]
    .sort((left, right) => right.timestamp - left.timestamp)
    .find((record) => {
      const sameOrHigherFamilyPriority =
        alertPostingFamilyPriority(record.family) >= alertPostingFamilyPriority(family);
      const currentLowValueContext =
        family === "zone_context" &&
        alert.event.eventContext.ladderPosition === "inner" &&
        alert.event.eventContext.zoneOrigin === "canonical";
      const priorNotMateriallyDifferent = !isMateriallyNewAlertState(alert, record.alert);

      return sameOrHigherFamilyPriority && currentLowValueContext && priorNotMateriallyDifferent;
    });

  if (strongerRecentScopeRecord) {
    return {
      shouldPost: false,
      reason: "lower_value_than_recent",
      family,
      scopeKey,
      stateKey,
      comparedAlertId: strongerRecentScopeRecord.alert.id,
    };
  }

  const sameScopeRecentRecord = recentScopeRecords.find((record) => {
    if (record.family !== family) {
      return false;
    }

    const scoreDelta = Math.abs(alert.score - record.alert.score);
    return scoreDelta < config.materialScoreDeltaForRepost && !isMateriallyNewAlertState(alert, record.alert);
  });

  if (sameScopeRecentRecord) {
    return {
      shouldPost: false,
      reason: "not_materially_new",
      family,
      scopeKey,
      stateKey,
      comparedAlertId: sameScopeRecentRecord.alert.id,
    };
  }

  return {
    shouldPost: true,
    reason: "posted",
    family,
    scopeKey,
    stateKey,
  };
}

export function appendPostedAlertHistory(params: {
  alert: IntelligentAlert;
  history: PostedAlertRecord[];
  config: AlertIntelligenceConfig;
}): PostedAlertRecord[] {
  const family = alertPostingFamilyForEvent(params.alert.event);
  const nextHistory = prunePostedAlertHistory(
    [...params.history, {
      alert: params.alert,
      family,
      scopeKey: buildAlertScopeKey(params.alert),
      stateKey: buildAlertStateKey(params.alert, family),
      timestamp: params.alert.event.timestamp,
    }],
    params.alert.event.timestamp,
    params.config,
  );

  return nextHistory;
}
