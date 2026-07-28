// 2026-04-16 02:41 PM America/Toronto
// Score clustered zones with richer evidence quality, confluence, and nearby-crowding discrimination.

import type { LevelEngineConfig } from "./level-config.js";
import type { FinalLevelZone } from "./level-types.js";

function timeframeWeight(zone: FinalLevelZone, config: LevelEngineConfig): number {
  return zone.timeframeSources.reduce(
    (sum, timeframe) => sum + config.timeframeConfig[timeframe].timeframeWeight,
    0,
  );
}

function primaryTimeframe(zone: FinalLevelZone): "daily" | "4h" | "5m" {
  if (zone.timeframeSources.includes("daily")) {
    return "daily";
  }

  if (zone.timeframeSources.includes("4h")) {
    return "4h";
  }

  return "5m";
}

function recencyFactor(lastTimestamp: number, referenceTimestamp = Date.now()): number {
  const hoursAgo = Math.max(0, referenceTimestamp - lastTimestamp) / (1000 * 60 * 60);
  if (hoursAgo <= 24) {
    return 1;
  }

  if (hoursAgo <= 24 * 7) {
    return 0.72;
  }

  if (hoursAgo <= 24 * 30) {
    return 0.45;
  }

  return 0.2;
}

function labelForScore(
  score: number,
  config: LevelEngineConfig,
): "weak" | "moderate" | "strong" | "major" {
  if (score >= config.scoreThresholds.major) {
    return "major";
  }
  if (score >= config.scoreThresholds.strong) {
    return "strong";
  }
  if (score >= config.scoreThresholds.moderate) {
    return "moderate";
  }
  return "weak";
}

function reactionContribution(zone: FinalLevelZone, config: LevelEngineConfig): number {
  return (
    Math.min(zone.touchCount, 10) * 0.3 +
    zone.reactionQualityScore +
    Math.min(zone.sourceEvidenceCount, 6) * 0.15
  ) * config.reactionWeight;
}

function evidenceContribution(zone: FinalLevelZone, config: LevelEngineConfig): number {
  return (
    zone.displacementScore * config.displacementWeight +
    zone.sessionSignificanceScore * config.sessionWeight +
    zone.reactionQualityScore * config.qualityWeight +
    zone.rejectionScore * (config.qualityWeight * 0.7) +
    (zone.gapContinuationScore ?? 0) * (config.pathClearanceWeight * 0.8)
  );
}

function followThroughContribution(zone: FinalLevelZone, config: LevelEngineConfig): number {
  const timeframeAssist = zone.timeframeSources.includes("daily")
    ? 0.25
    : zone.timeframeSources.includes("4h")
      ? 0.15
      : 0;
  return (zone.followThroughScore + timeframeAssist) * config.followThroughWeight;
}

function confluenceContribution(zone: FinalLevelZone): number {
  const timeframeDiversity = zone.timeframeSources.length;
  const sourceDiversity = zone.sourceTypes.length;
  const timeframeTierScore = zone.timeframeSources.reduce((sum, timeframe) => {
    if (timeframe === "daily") {
      return sum + 1.8;
    }

    if (timeframe === "4h") {
      return sum + 1.15;
    }

    return sum + 0.55;
  }, 0);

  const mixedTimeframeBonus = timeframeDiversity > 1 ? 0.9 : 0;
  const specialSourceBonus = zone.sourceTypes.some((sourceType) =>
    sourceType.startsWith("premarket") || sourceType.startsWith("opening_range"),
  )
    ? 0.45
    : 0;

  return Number(
    (
      timeframeTierScore +
      timeframeDiversity * 0.75 +
      sourceDiversity * 0.55 +
      mixedTimeframeBonus +
      specialSourceBonus
    ).toFixed(4),
  );
}

function singleTimeframePenaltyMultiplier(
  zone: FinalLevelZone,
  config: LevelEngineConfig,
): number {
  if (zone.timeframeSources.length > 1) {
    return config.mixedTimeframeBonus;
  }

  const onlyTimeframe = zone.timeframeSources[0];
  return config.singleTimeframeOnlyPenalty[onlyTimeframe];
}

function proximityPct(left: FinalLevelZone, right: FinalLevelZone): number {
  return (
    Math.abs(left.representativePrice - right.representativePrice) /
    Math.max(Math.max(left.representativePrice, right.representativePrice), 0.0001)
  );
}

function pathClearanceScore(zone: FinalLevelZone, zones: FinalLevelZone[]): number {
  const sameSide = zones
    .filter((other) => other.id !== zone.id)
    .sort((a, b) => a.representativePrice - b.representativePrice);
  const targetPct =
    primaryTimeframe(zone) === "daily"
      ? 0.06
      : primaryTimeframe(zone) === "4h"
        ? 0.035
        : 0.018;

  const nextZone =
    zone.kind === "resistance"
      ? sameSide.find((other) => other.representativePrice > zone.representativePrice)
      : [...sameSide].reverse().find((other) => other.representativePrice < zone.representativePrice);

  if (!nextZone) {
    return 1;
  }

  const gapPct = proximityPct(zone, nextZone);
  return Number(Math.max(0, Math.min(gapPct / targetPct, 1)).toFixed(4));
}

function crowdingPenaltyMultiplier(
  zone: FinalLevelZone,
  zones: FinalLevelZone[],
  config: LevelEngineConfig,
): number {
  const strongerNearby = zones.filter((other) => {
    if (other.id === zone.id) {
      return false;
    }

    return (
      proximityPct(zone, other) <= config.crowdingDistancePct &&
      (other.timeframeSources.length > zone.timeframeSources.length ||
        other.sourceEvidenceCount > zone.sourceEvidenceCount ||
        other.reactionQualityScore > zone.reactionQualityScore)
    );
  }).length;

  if (strongerNearby === 0) {
    return 1;
  }

  return Number(
    Math.max(config.weakerNearbyCrowdingPenalty ** strongerNearby, 0.55).toFixed(4),
  );
}

function recycledIntradayPenaltyMultiplier(zone: FinalLevelZone): number {
  const intradayOnly = zone.timeframeSources.length === 1 && zone.timeframeSources[0] === "5m";
  if (!intradayOnly) {
    return 1;
  }

  const heavyReuse = zone.touchCount >= 4 || zone.sourceEvidenceCount >= 4;
  const moderateReuse = zone.touchCount >= 3 || zone.sourceEvidenceCount >= 3;
  const weakDecisionQuality =
    zone.rejectionScore < 0.34 &&
    zone.followThroughScore < 0.35 &&
    zone.displacementScore < 0.45 &&
    zone.reactionQualityScore < 0.55;
  const softDecisionQuality =
    zone.rejectionScore < 0.4 &&
    zone.followThroughScore < 0.45 &&
    zone.displacementScore < 0.55;

  if (heavyReuse && weakDecisionQuality) {
    return 0.72;
  }

  if (moderateReuse && softDecisionQuality) {
    return 0.84;
  }

  return 1;
}

function decisiveSingleTimeframeFloorScore(
  zone: FinalLevelZone,
  adjustedScore: number,
  config: LevelEngineConfig,
): number {
  if (adjustedScore >= config.scoreThresholds.moderate) {
    return adjustedScore;
  }

  const primary = primaryTimeframe(zone);
  if (primary === "5m" || zone.timeframeSources.length !== 1) {
    return adjustedScore;
  }

  const hasDecisiveHistoricalReaction =
    zone.touchCount >= 1 &&
    zone.sourceEvidenceCount >= 1 &&
    zone.followThroughScore >= 0.6 &&
    (zone.rejectionScore >= 0.35 || zone.reactionQualityScore >= 0.3);

  if (!hasDecisiveHistoricalReaction) {
    return adjustedScore;
  }

  return Math.max(adjustedScore, config.scoreThresholds.moderate + 0.1);
}

function constructiveSingleTimeframeFloorScore(
  zone: FinalLevelZone,
  adjustedScore: number,
  config: LevelEngineConfig,
): number {
  if (adjustedScore >= config.scoreThresholds.moderate) {
    return adjustedScore;
  }

  const primary = primaryTimeframe(zone);
  if (primary === "5m" || zone.timeframeSources.length !== 1) {
    return adjustedScore;
  }

  const candidateFloor = config.scoreThresholds.moderate * 0.72;
  if (adjustedScore < candidateFloor) {
    return adjustedScore;
  }

  const isSwingLevel = zone.sourceTypes.some((sourceType) =>
    sourceType === "swing_high" || sourceType === "swing_low",
  );
  const hasConstructiveHistoricalReaction =
    isSwingLevel &&
    zone.touchCount >= 1 &&
    zone.sourceEvidenceCount >= 1 &&
    zone.followThroughScore >= 0.55 &&
    (
      zone.rejectionScore >= 0.25 ||
      zone.displacementScore >= 0.3 ||
      zone.reactionQualityScore >= 0.22
    );

  if (!hasConstructiveHistoricalReaction) {
    return adjustedScore;
  }

  return Math.max(adjustedScore, config.scoreThresholds.moderate + 0.05);
}

function repeatedHigherTimeframeSwingFloorScore(
  zone: FinalLevelZone,
  adjustedScore: number,
  config: LevelEngineConfig,
): number {
  if (adjustedScore >= config.scoreThresholds.moderate) {
    return adjustedScore;
  }

  const primary = primaryTimeframe(zone);
  if (primary === "5m" || zone.timeframeSources.length !== 1) {
    return adjustedScore;
  }

  const nearModerate = adjustedScore >= config.scoreThresholds.moderate * 0.88;
  const isSwingLevel = zone.sourceTypes.some((sourceType) =>
    sourceType === "swing_high" || sourceType === "swing_low",
  );
  const repeatedConstructiveReaction =
    isSwingLevel &&
    nearModerate &&
    zone.touchCount >= 2 &&
    zone.sourceEvidenceCount >= 1 &&
    zone.followThroughScore >= 0.55 &&
    zone.reactionQualityScore >= 0.18;

  if (!repeatedConstructiveReaction) {
    return adjustedScore;
  }

  return Math.max(adjustedScore, config.scoreThresholds.moderate + 0.03);
}

function overTestedDecisionCapScore(
  zone: FinalLevelZone,
  adjustedScore: number,
  config: LevelEngineConfig,
): number {
  const heavilyReused = zone.touchCount >= 20 || zone.sourceEvidenceCount >= 6;
  if (!heavilyReused) {
    return adjustedScore;
  }

  const softRejection = zone.rejectionScore < 0.3;
  const softFollowThrough = zone.followThroughScore < 0.5;
  if (!softRejection && !softFollowThrough) {
    return adjustedScore;
  }

  const exhaustedByTouches =
    (zone.touchCount >= 30 || zone.sourceEvidenceCount >= 8) &&
    zone.confluenceCount <= 2 &&
    zone.rejectionScore < 0.25 &&
    zone.followThroughScore < 0.45;

  if (exhaustedByTouches) {
    return Math.min(adjustedScore, config.scoreThresholds.strong - 0.1);
  }

  if (zone.confluenceCount <= 2) {
    return Math.min(adjustedScore, config.scoreThresholds.major - 0.1);
  }

  return adjustedScore;
}

function lowerTimeframeSoftConfluenceCapScore(
  zone: FinalLevelZone,
  adjustedScore: number,
  config: LevelEngineConfig,
): number {
  const lowerTimeframeConfluence =
    !zone.timeframeSources.includes("daily") &&
    zone.timeframeSources.includes("4h") &&
    zone.timeframeSources.includes("5m");
  const sessionAnchor = zone.sourceTypes.some((sourceType) =>
    sourceType.startsWith("premarket") || sourceType.startsWith("opening_range"),
  );
  const softDecisionQuality =
    zone.followThroughScore < 0.5 &&
    zone.rejectionScore < 0.45 &&
    zone.confluenceCount <= 2 &&
    zone.sourceEvidenceCount <= 3;
  const touchInflated = zone.touchCount >= 12;

  if (!lowerTimeframeConfluence || !sessionAnchor || !softDecisionQuality || !touchInflated) {
    return adjustedScore;
  }

  return Math.min(adjustedScore, config.scoreThresholds.strong - 0.1);
}

export function scoreLevelZones(
  zones: FinalLevelZone[],
  config: LevelEngineConfig,
  referenceTimestamp = Date.now(),
): FinalLevelZone[] {
  return zones.map((zone) => {
    const clearanceScore = pathClearanceScore(zone, zones);
    const freshnessMultiplier =
      zone.freshness === "fresh" ? 1 : zone.freshness === "aging" ? 0.84 : 0.62;
    const overcrowdingPenalty = zone.sourceEvidenceCount >= 6 && zone.confluenceCount <= 1 ? 0.88 : 1;
    const crowdingPenalty = crowdingPenaltyMultiplier(zone, zones, config);
    const recycledPenalty = recycledIntradayPenaltyMultiplier(zone);
    const baseScore =
      zone.touchCount * config.touchWeight +
      timeframeWeight(zone, config) +
      confluenceContribution(zone) * config.confluenceWeight +
      recencyFactor(zone.lastTimestamp, referenceTimestamp) * config.recencyWeight +
      reactionContribution(zone, config) +
      evidenceContribution(zone, config) +
      followThroughContribution(zone, config) +
      clearanceScore * config.pathClearanceWeight;

    const adjustedScore =
      baseScore *
      singleTimeframePenaltyMultiplier(zone, config) *
      freshnessMultiplier *
      overcrowdingPenalty *
      crowdingPenalty *
      recycledPenalty;
    const cappedScore = overTestedDecisionCapScore(zone, adjustedScore, config);
    const lowerTimeframeCapScore = lowerTimeframeSoftConfluenceCapScore(zone, cappedScore, config);
    const decisiveFloorScore = decisiveSingleTimeframeFloorScore(zone, lowerTimeframeCapScore, config);
    const constructiveFloorScore = constructiveSingleTimeframeFloorScore(zone, decisiveFloorScore, config);
    const finalScore = repeatedHigherTimeframeSwingFloorScore(zone, constructiveFloorScore, config);

    return {
      ...zone,
      strengthScore: Number(finalScore.toFixed(2)),
      strengthLabel: labelForScore(finalScore, config),
      notes: [
        ...zone.notes,
        `freshness=${zone.freshness}`,
        `evidence=${zone.sourceEvidenceCount}`,
        `rejection=${zone.rejectionScore.toFixed(4)}`,
        `followThrough=${zone.followThroughScore.toFixed(4)}`,
        `gapContinuation=${(zone.gapContinuationScore ?? 0).toFixed(4)}`,
        `pathClearance=${clearanceScore.toFixed(4)}`,
        `crowdingPenalty=${crowdingPenalty.toFixed(4)}`,
        `recycledPenalty=${recycledPenalty.toFixed(4)}`,
        `overTestedDecisionCap=${(cappedScore - adjustedScore).toFixed(4)}`,
        `lowerTimeframeSoftConfluenceCap=${(lowerTimeframeCapScore - cappedScore).toFixed(4)}`,
        `decisiveSingleTimeframeFloor=${(decisiveFloorScore - lowerTimeframeCapScore).toFixed(4)}`,
        `constructiveSingleTimeframeFloor=${(constructiveFloorScore - decisiveFloorScore).toFixed(4)}`,
        `repeatedHigherTimeframeSwingFloor=${(finalScore - constructiveFloorScore).toFixed(4)}`,
      ],
    };
  });
}
