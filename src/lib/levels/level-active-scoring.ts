// 2026-04-17 10:00 PM America/Toronto
// Compute active relevance so nearby, recently interacting levels surface without overpowering weak structure.

import type { Candle } from "../market-data/candle-types.js";
import type { LevelScoreConfig } from "./level-score-config.js";
import { LEVEL_SCORE_CONFIG } from "./level-score-config.js";
import type { LevelScoringContext, LevelScoreBreakdown, RankedLevel, LevelCandidate } from "./level-types.js";
import { clamp, isPriceInsideZone, priceDistancePct, safeDivide, zoneMid } from "./level-zone-utils.js";

type ActivelyScorableLevel = Pick<
  RankedLevel,
  | "type"
  | "zoneLow"
  | "zoneHigh"
  | "barsSinceLastReaction"
  | "touches"
  | "price"
> &
  Partial<Pick<LevelCandidate, "averageVolumeRatio">>;

function computeDistanceToPriceScore(level: ActivelyScorableLevel, context: LevelScoringContext, config: LevelScoreConfig): number {
  const distancePct = priceDistancePct(zoneMid(level.zoneLow, level.zoneHigh), context.currentPrice);

  if (distancePct <= config.activeThresholds.strongDistancePct) {
    return 35;
  }
  if (distancePct <= config.activeThresholds.moderateDistancePct) {
    return 28;
  }
  if (distancePct <= config.activeThresholds.nearDistancePct) {
    return 20;
  }
  if (distancePct <= config.activeThresholds.localDistancePct) {
    return 12;
  }
  if (distancePct <= config.activeThresholds.farDistancePct) {
    return 6;
  }

  return 2;
}

function computeFreshReactionScore(level: ActivelyScorableLevel, config: LevelScoreConfig): number {
  if (level.barsSinceLastReaction <= 3) {
    return 20;
  }
  if (level.barsSinceLastReaction <= 8) {
    return 14;
  }
  if (level.barsSinceLastReaction <= 15) {
    return 9;
  }
  if (level.barsSinceLastReaction <= 30) {
    return 5;
  }

  return 2;
}

function consecutiveDirectionalSteps(values: number[], direction: "up" | "down"): number {
  let count = 0;

  for (let index = 1; index < values.length; index += 1) {
    if (direction === "up" && values[index]! > values[index - 1]!) {
      count += 1;
    }
    if (direction === "down" && values[index]! < values[index - 1]!) {
      count += 1;
    }
  }

  return count;
}

function computeIntradayPressureScore(
  level: ActivelyScorableLevel,
  context: LevelScoringContext,
  config: LevelScoreConfig,
): number {
  const recentCandles = context.recentCandles?.slice(-config.activeThresholds.pressureLookbackBars) ?? [];
  if (recentCandles.length < 4) {
    return 0;
  }

  const distanceSeries = recentCandles.map((candle) =>
    level.type === "resistance"
      ? priceDistancePct(candle.high, level.zoneLow)
      : priceDistancePct(candle.low, level.zoneHigh),
  );
  const proximateCandles = recentCandles.filter((candle) =>
    level.type === "resistance"
      ? priceDistancePct(candle.high, level.zoneLow) <= config.activeThresholds.localDistancePct
      : priceDistancePct(candle.low, level.zoneHigh) <= config.activeThresholds.localDistancePct,
  );

  if (proximateCandles.length < 3) {
    return 0;
  }

  const slopeSeries =
    level.type === "resistance"
      ? proximateCandles.map((candle) => candle.low)
      : proximateCandles.map((candle) => candle.high);
  const directionalSteps = consecutiveDirectionalSteps(slopeSeries, level.type === "resistance" ? "up" : "down");
  const compressionSteps = distanceSeries
    .slice(1)
    .reduce((sum, distance, index) => sum + (distance <= distanceSeries[index]! ? 1 : 0), 0);
  const closeBiasSeries = proximateCandles.map((candle) => candle.close);
  const closeBiasSteps = consecutiveDirectionalSteps(
    closeBiasSeries,
    level.type === "resistance" ? "up" : "down",
  );

  const normalizedDirectional = safeDivide(directionalSteps, Math.max(slopeSeries.length - 1, 1), 0);
  const normalizedCompression = safeDivide(compressionSteps, Math.max(distanceSeries.length - 1, 1), 0);
  const normalizedCloseBias = safeDivide(closeBiasSteps, Math.max(closeBiasSeries.length - 1, 1), 0);

  return clamp(
    (normalizedDirectional * 0.45 + normalizedCompression * 0.35 + normalizedCloseBias * 0.2) * 20,
    0,
    20,
  );
}

function rollingVolumeRatio(candles: Candle[]): number {
  if (candles.length < 2) {
    return 1;
  }

  const average = candles.reduce((sum, candle) => sum + candle.volume, 0) / candles.length;
  return clamp(candles[candles.length - 1]!.volume / Math.max(average, 1), 0, 5);
}

function computeRecentVolumeActivityScore(
  level: ActivelyScorableLevel,
  context: LevelScoringContext,
  config: LevelScoreConfig,
): number {
  const recentCandles = context.recentCandles ?? [];
  const nearbyCandles = recentCandles.filter((candle) =>
    level.type === "resistance"
      ? priceDistancePct(candle.high, level.zoneLow) <= config.activeThresholds.localDistancePct
      : priceDistancePct(candle.low, level.zoneHigh) <= config.activeThresholds.localDistancePct,
  );
  const localRatio = nearbyCandles.length > 0 ? rollingVolumeRatio(nearbyCandles) : level.averageVolumeRatio ?? 1;
  const combinedRatio = Math.max(localRatio, context.currentSessionVolumeRatio ?? 1);

  if (combinedRatio >= 2) {
    return 15;
  }
  if (combinedRatio >= config.activeThresholds.recentVolumeHighRatio) {
    return 11;
  }
  if (combinedRatio >= 1.2) {
    return 7;
  }

  return 3;
}

function computeCurrentInteractionScore(
  level: ActivelyScorableLevel,
  context: LevelScoringContext,
  config: LevelScoreConfig,
): number {
  if (isPriceInsideZone(context.currentPrice, level.zoneLow, level.zoneHigh)) {
    return 10;
  }

  const distancePct = priceDistancePct(context.currentPrice, zoneMid(level.zoneLow, level.zoneHigh));
  const latestTouch = level.touches[level.touches.length - 1];

  if (
    latestTouch &&
    latestTouch.reactionMoveCandles <= 1 &&
    latestTouch.candleTimestamp >= context.latestTimestamp - 3 * 60 * 60 * 1000
  ) {
    return 8;
  }

  if (distancePct <= config.activeThresholds.currentInteractionDistancePct) {
    return 6;
  }

  return 1;
}

export function computeActiveRelevanceScore(
  level: ActivelyScorableLevel,
  context: LevelScoringContext,
  config: LevelScoreConfig = LEVEL_SCORE_CONFIG,
): { activeRelevanceScore: number; scoreBreakdown: Pick<LevelScoreBreakdown, "distanceToPriceScore" | "freshReactionScore" | "intradayPressureScore" | "recentVolumeActivityScore" | "currentInteractionScore" | "activeRelevanceScore"> } {
  const distanceToPriceScore = computeDistanceToPriceScore(level, context, config);
  const freshReactionScore = computeFreshReactionScore(level, config);
  const intradayPressureScore = computeIntradayPressureScore(level, context, config);
  const recentVolumeActivityScore = computeRecentVolumeActivityScore(level, context, config);
  const currentInteractionScore = computeCurrentInteractionScore(level, context, config);
  const activeRelevanceScore = clamp(
    distanceToPriceScore +
      freshReactionScore +
      intradayPressureScore +
      recentVolumeActivityScore +
      currentInteractionScore,
    0,
    100,
  );

  return {
    activeRelevanceScore,
    scoreBreakdown: {
      distanceToPriceScore,
      freshReactionScore,
      intradayPressureScore,
      recentVolumeActivityScore,
      currentInteractionScore,
      activeRelevanceScore,
    },
  };
}
