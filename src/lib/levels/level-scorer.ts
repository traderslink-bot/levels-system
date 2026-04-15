// 2026-04-14 08:42 PM America/Toronto
// Score clustered zones with stricter thresholds and penalties for weak single-timeframe zones.

import type { LevelEngineConfig } from "./level-config.js";
import type { FinalLevelZone } from "./level-types.js";

function timeframeWeight(zone: FinalLevelZone, config: LevelEngineConfig): number {
  return zone.timeframeSources.reduce(
    (sum, timeframe) => sum + config.timeframeConfig[timeframe].timeframeWeight,
    0,
  );
}

function recencyFactor(lastTimestamp: number): number {
  const hoursAgo = (Date.now() - lastTimestamp) / (1000 * 60 * 60);
  if (hoursAgo <= 24) {
    return 1;
  }

  if (hoursAgo <= 24 * 7) {
    return 0.7;
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
  const sourceTypeBonus =
    zone.sourceTypes.includes("premarket_high") ||
    zone.sourceTypes.includes("premarket_low") ||
    zone.sourceTypes.includes("opening_range_high") ||
    zone.sourceTypes.includes("opening_range_low")
      ? 1
      : 0;

  return (Math.min(zone.touchCount, 8) * 0.35 + sourceTypeBonus) * config.reactionWeight;
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

export function scoreLevelZones(
  zones: FinalLevelZone[],
  config: LevelEngineConfig,
): FinalLevelZone[] {
  return zones.map((zone) => {
    const baseScore =
      zone.touchCount * config.touchWeight +
      timeframeWeight(zone, config) +
      zone.confluenceCount * config.confluenceWeight +
      recencyFactor(zone.lastTimestamp) * config.recencyWeight +
      reactionContribution(zone, config);

    const adjustedScore = baseScore * singleTimeframePenaltyMultiplier(zone, config);

    return {
      ...zone,
      strengthScore: Number(adjustedScore.toFixed(2)),
      strengthLabel: labelForScore(adjustedScore, config),
    };
  });
}
