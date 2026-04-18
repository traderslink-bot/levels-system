// 2026-04-17 09:40 PM America/Toronto
// Analyze how candles interact with a candidate level so strength scoring can use directional touch quality.

import type { Candle } from "../market-data/candle-types.js";
import type { LevelScoreConfig } from "./level-score-config.js";
import { LEVEL_SCORE_CONFIG } from "./level-score-config.js";
import type { LevelCandidate, LevelTouch, LevelTouchAnalysisResult, LevelType, SourceTimeframe } from "./level-types.js";
import { buildZoneBounds, clamp, isPriceInsideZone, safeDivide, standardDeviation, zoneMid } from "./level-zone-utils.js";

function rollingVolumeRatio(candles: Candle[], index: number, config: LevelScoreConfig): number {
  const lookback = config.touchThresholds.rollingVolumeLookbackBars;
  const window = candles.slice(Math.max(0, index - lookback), index);

  if (window.length === 0) {
    return 1;
  }

  const averageVolume = window.reduce((sum, candle) => sum + candle.volume, 0) / window.length;
  return clamp(safeDivide(candles[index]!.volume, averageVolume, 1), 0, 5);
}

function wickRejectStrength(candle: Candle, type: LevelType): number {
  const range = Math.max(candle.high - candle.low, 0.000001);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const closePosition = safeDivide(candle.close - candle.low, range, 0.5);

  if (type === "support") {
    return clamp(lowerWick / range * 0.7 + closePosition * 0.3, 0, 1);
  }

  return clamp(upperWick / range * 0.7 + (1 - closePosition) * 0.3, 0, 1);
}

function bodyRejectStrength(candle: Candle, type: LevelType, mid: number): number {
  const range = Math.max(candle.high - candle.low, 0.000001);
  const body = Math.abs(candle.close - candle.open);

  if (type === "support") {
    const bullishBody = Math.max(candle.close - candle.open, 0);
    const closeLift = candle.close >= mid ? 1 : 0.35;
    return clamp((bullishBody / range) * 0.7 + closeLift * 0.3 + body / range * 0.1, 0, 1);
  }

  const bearishBody = Math.max(candle.open - candle.close, 0);
  const closeDrop = candle.close <= mid ? 1 : 0.35;
  return clamp((bearishBody / range) * 0.7 + closeDrop * 0.3 + body / range * 0.1, 0, 1);
}

function touchDistancePct(candle: Candle, levelPrice: number): number {
  const nearestPrice =
    candle.low <= levelPrice && candle.high >= levelPrice
      ? levelPrice
      : Math.abs(candle.low - levelPrice) <= Math.abs(candle.high - levelPrice)
        ? candle.low
        : candle.high;

  return safeDivide(Math.abs(nearestPrice - levelPrice), Math.max(levelPrice, 0.000001), 0);
}

function computeReactionMove(
  candles: Candle[],
  index: number,
  levelPrice: number,
  type: LevelType,
  config: LevelScoreConfig,
): { reactionMovePct: number; reactionMoveCandles: number } {
  let bestMovePct = 0;
  let bestMoveCandles = 0;

  for (
    let cursor = index + 1;
    cursor < Math.min(candles.length, index + 1 + config.touchThresholds.reactionLookaheadBars);
    cursor += 1
  ) {
    const candle = candles[cursor]!;
    const favorableMovePct =
      type === "support"
        ? safeDivide(candle.high - levelPrice, levelPrice, 0)
        : safeDivide(levelPrice - candle.low, levelPrice, 0);

    if (favorableMovePct > bestMovePct) {
      bestMovePct = favorableMovePct;
      bestMoveCandles = cursor - index;
    }
  }

  return {
    reactionMovePct: clamp(bestMovePct, 0, 10),
    reactionMoveCandles: bestMoveCandles,
  };
}

function closeAwayFromLevel(candle: Candle, type: LevelType, zoneLow: number, zoneHigh: number, config: LevelScoreConfig): boolean {
  if (type === "support") {
    return candle.close >= zoneHigh;
  }

  return candle.close <= zoneLow;
}

function classifyReactionType(params: {
  candle: Candle;
  nextCandle?: Candle;
  type: LevelType;
  zoneLow: number;
  zoneHigh: number;
  mid: number;
  priorBroken: boolean;
  wickStrength: number;
  bodyStrength: number;
}): LevelTouch["reactionType"] {
  const { candle, nextCandle, type, zoneLow, zoneHigh, mid, priorBroken, wickStrength, bodyStrength } = params;

  if (type === "support") {
    const cleanBreak = candle.close < zoneLow && (!!nextCandle ? nextCandle.close <= zoneLow : true);
    const reclaim = priorBroken && candle.close > zoneHigh;
    const failedBreak = candle.low < zoneLow && candle.close >= mid;
    const rejection = candle.close >= mid && (wickStrength >= 0.45 || bodyStrength >= 0.4);

    if (reclaim) {
      return "reclaim";
    }
    if (cleanBreak) {
      return "clean_break";
    }
    if (failedBreak) {
      return "failed_break";
    }
    if (rejection) {
      return "rejection";
    }

    return "tap";
  }

  const cleanBreak = candle.close > zoneHigh && (!!nextCandle ? nextCandle.close >= zoneHigh : true);
  const reclaim = priorBroken && candle.close < zoneLow;
  const failedBreak = candle.high > zoneHigh && candle.close <= mid;
  const rejection = candle.close <= mid && (wickStrength >= 0.45 || bodyStrength >= 0.4);

  if (reclaim) {
    return "reclaim";
  }
  if (cleanBreak) {
    return "clean_break";
  }
  if (failedBreak) {
    return "failed_break";
  }
  if (rejection) {
    return "rejection";
  }

  return "tap";
}

function isMeaningfulTouch(touch: LevelTouch, config: LevelScoreConfig): boolean {
  return (
    touch.reactionMovePct >= config.touchThresholds.minReactionMovePct ||
    touch.volumeRatio >= config.touchThresholds.minVolumeRatioForMeaningfulReaction ||
    (touch.closedAwayFromLevel && (touch.wickRejectStrength >= 0.4 || touch.bodyRejectStrength >= 0.4)) ||
    touch.reactionType === "failed_break" ||
    touch.reactionType === "reclaim"
  );
}

export function analyzeLevelTouches(
  level: Pick<LevelCandidate, "price" | "type" | "zoneLow" | "zoneHigh">,
  candles: Candle[],
  timeframe: SourceTimeframe,
  config: LevelScoreConfig = LEVEL_SCORE_CONFIG,
): LevelTouchAnalysisResult {
  const { zoneLow, zoneHigh } =
    level.zoneLow !== undefined && level.zoneHigh !== undefined
      ? { zoneLow: level.zoneLow, zoneHigh: level.zoneHigh }
      : buildZoneBounds(level.price);
  const mid = zoneMid(zoneLow, zoneHigh);
  const touches: LevelTouch[] = [];
  const touchAnchors: number[] = [];
  let priorBroken = false;
  let firstTouchIndex: number | null = null;
  let lastMeaningfulTouchIndex: number | null = null;

  candles.forEach((candle, index) => {
    const enteredZone = candle.high >= zoneLow && candle.low <= zoneHigh;
    const cleanBreakWithoutTouch =
      level.type === "support" ? candle.close < zoneLow : candle.close > zoneHigh;

    if (!enteredZone && !cleanBreakWithoutTouch && !priorBroken) {
      return;
    }

    const wickStrength = wickRejectStrength(candle, level.type);
    const bodyStrength = bodyRejectStrength(candle, level.type, mid);
    const reaction = computeReactionMove(candles, index, level.price, level.type, config);
    const touch: LevelTouch = {
      candleTimestamp: candle.timestamp,
      timeframe,
      reactionType: classifyReactionType({
        candle,
        nextCandle: candles[index + 1],
        type: level.type,
        zoneLow,
        zoneHigh,
        mid,
        priorBroken,
        wickStrength,
        bodyStrength,
      }),
      touchDistancePct: touchDistancePct(candle, level.price),
      reactionMovePct: reaction.reactionMovePct,
      reactionMoveCandles: reaction.reactionMoveCandles,
      volumeRatio: rollingVolumeRatio(candles, index, config),
      closedAwayFromLevel: closeAwayFromLevel(candle, level.type, zoneLow, zoneHigh, config),
      wickRejectStrength: wickStrength,
      bodyRejectStrength: bodyStrength,
    };

    const interacted =
      enteredZone ||
      isPriceInsideZone(candle.close, zoneLow, zoneHigh) ||
      touch.reactionType === "clean_break" ||
      touch.reactionType === "reclaim";

    if (!interacted) {
      if (touch.reactionType === "clean_break") {
        priorBroken = true;
      }
      return;
    }

    if (firstTouchIndex === null) {
      firstTouchIndex = index;
    }

    touches.push(touch);
    touchAnchors.push(touch.touchDistancePct);

    if (touch.reactionType === "clean_break") {
      priorBroken = true;
    } else if (touch.reactionType === "reclaim") {
      priorBroken = false;
    }

    if (isMeaningfulTouch(touch, config)) {
      lastMeaningfulTouchIndex = index;
    }
  });

  const meaningfulTouches = touches.filter((touch) => isMeaningfulTouch(touch, config));
  const reactionMoves = meaningfulTouches.map((touch) => touch.reactionMovePct);
  const volumeRatios = meaningfulTouches.map((touch) => touch.volumeRatio);

  return {
    touches,
    touchCount: touches.length,
    meaningfulTouchCount: meaningfulTouches.length,
    rejectionCount: touches.filter((touch) => touch.reactionType === "rejection").length,
    failedBreakCount: touches.filter((touch) => touch.reactionType === "failed_break").length,
    cleanBreakCount: touches.filter((touch) => touch.reactionType === "clean_break").length,
    reclaimCount: touches.filter((touch) => touch.reactionType === "reclaim").length,
    strongestReactionMovePct: reactionMoves.length > 0 ? Math.max(...reactionMoves) : 0,
    averageReactionMovePct:
      reactionMoves.length > 0 ? reactionMoves.reduce((sum, value) => sum + value, 0) / reactionMoves.length : 0,
    bestVolumeRatio: volumeRatios.length > 0 ? Math.max(...volumeRatios) : 1,
    averageVolumeRatio:
      volumeRatios.length > 0 ? volumeRatios.reduce((sum, value) => sum + value, 0) / volumeRatios.length : 1,
    cleanlinessStdDevPct: standardDeviation(touchAnchors),
    barsSinceLastReaction:
      lastMeaningfulTouchIndex === null ? candles.length : Math.max(candles.length - 1 - lastMeaningfulTouchIndex, 0),
    ageInBars: firstTouchIndex === null ? candles.length : Math.max(candles.length - 1 - firstTouchIndex, 0),
  };
}
