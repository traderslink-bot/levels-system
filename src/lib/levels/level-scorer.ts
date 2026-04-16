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

function recencyFactor(lastTimestamp: number): number {
  const hoursAgo = (Date.now() - lastTimestamp) / (1000 * 60 * 60);
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

export function scoreLevelZones(
  zones: FinalLevelZone[],
  config: LevelEngineConfig,
): FinalLevelZone[] {
  return zones.map((zone) => {
    const clearanceScore = pathClearanceScore(zone, zones);
    const freshnessMultiplier =
      zone.freshness === "fresh" ? 1 : zone.freshness === "aging" ? 0.84 : 0.62;
    const overcrowdingPenalty = zone.sourceEvidenceCount >= 6 && zone.confluenceCount <= 1 ? 0.88 : 1;
    const crowdingPenalty = crowdingPenaltyMultiplier(zone, zones, config);
    const baseScore =
      zone.touchCount * config.touchWeight +
      timeframeWeight(zone, config) +
      confluenceContribution(zone) * config.confluenceWeight +
      recencyFactor(zone.lastTimestamp) * config.recencyWeight +
      reactionContribution(zone, config) +
      evidenceContribution(zone, config) +
      followThroughContribution(zone, config) +
      clearanceScore * config.pathClearanceWeight;

    const adjustedScore =
      baseScore *
      singleTimeframePenaltyMultiplier(zone, config) *
      freshnessMultiplier *
      overcrowdingPenalty *
      crowdingPenalty;

    return {
      ...zone,
      strengthScore: Number(adjustedScore.toFixed(2)),
      strengthLabel: labelForScore(adjustedScore, config),
      notes: [
        ...zone.notes,
        `freshness=${zone.freshness}`,
        `evidence=${zone.sourceEvidenceCount}`,
        `rejection=${zone.rejectionScore.toFixed(4)}`,
        `followThrough=${zone.followThroughScore.toFixed(4)}`,
        `gapContinuation=${(zone.gapContinuationScore ?? 0).toFixed(4)}`,
        `pathClearance=${clearanceScore.toFixed(4)}`,
        `crowdingPenalty=${crowdingPenalty.toFixed(4)}`,
      ],
    };
  });
}
