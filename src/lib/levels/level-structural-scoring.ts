// 2026-04-17 09:54 PM America/Toronto
// Compute structural level strength from timeframe quality, reactions, cleanliness, and defense history.

import type { LevelScoreConfig } from "./level-score-config.js";
import { LEVEL_SCORE_CONFIG } from "./level-score-config.js";
import type { LevelScoreBreakdown, RankedLevel, SourceTimeframe, LevelCandidate } from "./level-types.js";
import { clamp, getZoneWidthPct, safeDivide } from "./level-zone-utils.js";

type StructurallyScorableLevel = Pick<
  RankedLevel,
  | "sourceTimeframes"
  | "meaningfulTouchCount"
  | "touchCount"
  | "touches"
  | "averageReactionMovePct"
  | "strongestReactionMovePct"
  | "averageVolumeRatio"
  | "bestVolumeRatio"
  | "cleanlinessStdDevPct"
  | "roleFlipCount"
  | "failedBreakCount"
  | "reclaimCount"
  | "rejectionCount"
  | "barsSinceLastReaction"
  | "price"
> &
  Partial<Pick<LevelCandidate, "clusterPenalty">>;

function timeframeBaseScore(timeframe: SourceTimeframe): number {
  switch (timeframe) {
    case "daily":
      return 20;
    case "4h":
      return 16;
    case "1h":
      return 12;
    case "15m":
      return 8;
    case "5m":
    default:
      return 5;
  }
}

function computeTimeframeScore(level: StructurallyScorableLevel): number {
  const strongest = level.sourceTimeframes.reduce(
    (best, timeframe) => Math.max(best, timeframeBaseScore(timeframe)),
    0,
  );
  const confluenceBonus = clamp((new Set(level.sourceTimeframes).size - 1) * 1.5, 0, 4);
  return clamp(strongest + confluenceBonus, 0, 20);
}

function computeTouchScore(meaningfulTouchCount: number): number {
  if (meaningfulTouchCount >= 5) {
    return 15;
  }

  if (meaningfulTouchCount === 4) {
    return 13;
  }

  if (meaningfulTouchCount === 3) {
    return 11;
  }

  if (meaningfulTouchCount === 2) {
    return 8;
  }

  if (meaningfulTouchCount === 1) {
    return 4;
  }

  return 0;
}

function computeReactionQualityScore(level: StructurallyScorableLevel): number {
  if (level.touches.length === 0) {
    return 0;
  }

  const meaningfulTouches = level.touches.filter(
    (touch) =>
      touch.reactionType !== "tap" || touch.closedAwayFromLevel || touch.wickRejectStrength >= 0.4 || touch.bodyRejectStrength >= 0.4,
  );

  if (meaningfulTouches.length === 0) {
    return 0;
  }

  const closeAwayRate =
    meaningfulTouches.filter((touch) => touch.closedAwayFromLevel).length / meaningfulTouches.length;
  const averageWickStrength =
    meaningfulTouches.reduce((sum, touch) => sum + touch.wickRejectStrength, 0) / meaningfulTouches.length;
  const averageBodyStrength =
    meaningfulTouches.reduce((sum, touch) => sum + touch.bodyRejectStrength, 0) / meaningfulTouches.length;
  const defenseSignal = clamp(
    safeDivide(level.failedBreakCount * 1.1 + level.reclaimCount * 1.35, Math.max(level.touchCount, 1), 0),
    0,
    1,
  );

  return clamp(
    (closeAwayRate * 0.35 + averageWickStrength * 0.25 + averageBodyStrength * 0.2 + defenseSignal * 0.2) * 15,
    0,
    15,
  );
}

function computeReactionMagnitudeScore(level: StructurallyScorableLevel, config: LevelScoreConfig): number {
  const averageComponent = clamp(
    safeDivide(level.averageReactionMovePct, config.touchThresholds.minReactionMovePct * 3, 0),
    0,
    1,
  );
  const strongestComponent = clamp(
    safeDivide(level.strongestReactionMovePct, config.touchThresholds.minReactionMovePct * 5, 0),
    0,
    1,
  );

  return clamp((averageComponent * 0.6 + strongestComponent * 0.4) * 10, 0, 10);
}

function computeVolumeScore(level: StructurallyScorableLevel): number {
  const averageComponent = clamp((level.averageVolumeRatio - 1) / 1.1, 0, 1);
  const strongestComponent = clamp((level.bestVolumeRatio - 1) / 1.8, 0, 1);

  return clamp((averageComponent * 0.55 + strongestComponent * 0.45) * 10, 0, 10);
}

function computeCleanlinessScore(level: StructurallyScorableLevel): number {
  const targetStdDev = getZoneWidthPct(level.price) * 0.8;
  const penaltyRatio = clamp(safeDivide(level.cleanlinessStdDevPct, Math.max(targetStdDev, 0.0002), 1), 0, 1.2);
  return clamp((1 - Math.min(penaltyRatio, 1)) * 10, 0, 10);
}

function computeRoleFlipScore(roleFlipCount: number): number {
  if (roleFlipCount >= 3) {
    return 8;
  }

  if (roleFlipCount === 2) {
    return 6;
  }

  if (roleFlipCount === 1) {
    return 4;
  }

  return 0;
}

function computeDefenseScore(level: StructurallyScorableLevel): number {
  const defenseEvidence = level.failedBreakCount * 1.15 + level.reclaimCount * 1.5 + level.rejectionCount * 0.45;
  return clamp(Math.min(defenseEvidence, 4) / 4 * 8, 0, 8);
}

function computeRecencyScore(barsSinceLastReaction: number, config: LevelScoreConfig): number {
  if (barsSinceLastReaction <= config.recencyBars.fresh) {
    return 8;
  }

  if (barsSinceLastReaction <= config.recencyBars.recent) {
    return 6.5;
  }

  if (barsSinceLastReaction <= config.recencyBars.warm) {
    return 5;
  }

  if (barsSinceLastReaction <= config.recencyBars.aging) {
    return 3;
  }

  return 1;
}

function computeOvertestPenalty(level: StructurallyScorableLevel): number {
  if (level.touchCount <= 4) {
    return 0;
  }

  const excessTouches = level.touchCount - 4;
  const qualityFactor = clamp(
    safeDivide(level.averageReactionMovePct + level.strongestReactionMovePct, 0.12, 0) * 0.6 +
      safeDivide(level.rejectionCount + level.failedBreakCount + level.reclaimCount, Math.max(level.touchCount, 1), 0) *
        0.4,
    0,
    1,
  );
  const weaknessFactor = 1 - qualityFactor;
  return -clamp(excessTouches * (1.45 + weaknessFactor * 1.75), 0, 10);
}

export function computeStructuralStrengthScore(
  level: StructurallyScorableLevel,
  config: LevelScoreConfig = LEVEL_SCORE_CONFIG,
): { structuralStrengthScore: number; scoreBreakdown: LevelScoreBreakdown } {
  const timeframeScore = computeTimeframeScore(level);
  const touchScore = computeTouchScore(level.meaningfulTouchCount);
  const reactionQualityScore = computeReactionQualityScore(level);
  const reactionMagnitudeScore = computeReactionMagnitudeScore(level, config);
  const volumeScore = computeVolumeScore(level);
  const cleanlinessScore = computeCleanlinessScore(level);
  const roleFlipScore = computeRoleFlipScore(level.roleFlipCount);
  const defenseScore = computeDefenseScore(level);
  const recencyScore = computeRecencyScore(level.barsSinceLastReaction, config);
  const overtestPenalty = computeOvertestPenalty(level);
  const clusterPenalty = clamp(level.clusterPenalty ?? 0, -config.penalties.clusterMax, 0);

  const structuralStrengthScore = clamp(
    timeframeScore +
      touchScore +
      reactionQualityScore +
      reactionMagnitudeScore +
      volumeScore +
      cleanlinessScore +
      roleFlipScore +
      defenseScore +
      recencyScore +
      overtestPenalty +
      clusterPenalty,
    0,
    100,
  );

  return {
    structuralStrengthScore,
    scoreBreakdown: {
      timeframeScore,
      touchScore,
      reactionQualityScore,
      reactionMagnitudeScore,
      volumeScore,
      cleanlinessScore,
      roleFlipScore,
      defenseScore,
      recencyScore,
      overtestPenalty,
      clusterPenalty,
      structuralStrengthScore,
      distanceToPriceScore: 0,
      freshReactionScore: 0,
      intradayPressureScore: 0,
      recentVolumeActivityScore: 0,
      currentInteractionScore: 0,
      activeRelevanceScore: 0,
      finalLevelScore: 0,
    },
  };
}
