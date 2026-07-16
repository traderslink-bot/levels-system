import type { Candle, CandleTimeframe } from "../market-data/candle-types.js";
import type { RawLevelCandidate, SwingPoint } from "./level-types.js";

function clamp(value: number, min: number = 0, max: number = 1): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function toleranceForPrice(price: number): number {
  return Math.max(price * 0.004, 0.0001);
}

function wickRejectionScore(swing: SwingPoint, candle: Candle): number {
  const range = Math.max(candle.high - candle.low, 0.0001);

  if (swing.kind === "resistance") {
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const closeOffHigh = (candle.high - candle.close) / range;
    return clamp(upperWick / range * 0.65 + closeOffHigh * 0.35);
  }

  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const closeOffLow = (candle.close - candle.low) / range;
  return clamp(lowerWick / range * 0.65 + closeOffLow * 0.35);
}

function countRespectRetests(
  candles: Candle[],
  swing: SwingPoint,
  tolerance: number,
  requirePositiveVolumeEvidence: boolean,
): number {
  const start = Math.max(0, swing.index - 6);
  const end = Math.min(candles.length - 1, swing.index + 6);
  let retests = 0;

  for (let index = start; index <= end; index += 1) {
    if (index === swing.index) {
      continue;
    }

    const candle = candles[index]!;
    if (requirePositiveVolumeEvidence && candle.volume <= 0) {
      continue;
    }
    const tested =
      swing.kind === "resistance"
        ? Math.abs(candle.high - swing.price) <= tolerance
        : Math.abs(candle.low - swing.price) <= tolerance;

    if (!tested) {
      continue;
    }

    const respected =
      swing.kind === "resistance"
        ? candle.close <= swing.price
        : candle.close >= swing.price;

    if (respected) {
      retests += 1;
    }
  }

  return retests;
}

function previousEvidenceCandle(
  candles: Candle[],
  index: number,
  requirePositiveVolumeEvidence: boolean,
): Candle | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candle = candles[cursor]!;
    if (!requirePositiveVolumeEvidence || candle.volume > 0) {
      return candle;
    }
  }
  return undefined;
}

function gapStructureScore(
  candles: Candle[],
  swing: SwingPoint,
  tolerance: number,
  requirePositiveVolumeEvidence: boolean,
): boolean {
  if (swing.index <= 0 || swing.index >= candles.length) {
    return false;
  }

  const current = candles[swing.index]!;
  const previous = previousEvidenceCandle(
    candles,
    swing.index,
    requirePositiveVolumeEvidence,
  );
  if (!previous) {
    return false;
  }
  return Math.abs(current.open - previous.close) >= tolerance * 2;
}

function gapContinuationScore(
  candles: Candle[],
  swing: SwingPoint,
  tolerance: number,
  hasGapStructure: boolean,
  requirePositiveVolumeEvidence: boolean,
): number {
  if (!hasGapStructure || swing.index <= 0 || swing.index >= candles.length) {
    return 0;
  }

  const current = candles[swing.index]!;
  const previous = previousEvidenceCandle(
    candles,
    swing.index,
    requirePositiveVolumeEvidence,
  );
  if (!previous) {
    return 0;
  }
  const gapDistance = Math.abs(current.open - previous.close);
  const normalizedGapSize = clamp(gapDistance / Math.max(tolerance * 4, 0.0001));
  const futureCandles = candles
    .slice(swing.index + 1, Math.min(candles.length, swing.index + 4))
    .filter((candle) => !requirePositiveVolumeEvidence || candle.volume > 0);

  if (futureCandles.length === 0) {
    return clamp(normalizedGapSize * 0.35);
  }

  const holdCount = futureCandles.filter((candle) => {
    if (swing.kind === "resistance") {
      return candle.low >= previous.close - tolerance && candle.close >= previous.close;
    }

    return candle.high <= previous.close + tolerance && candle.close <= previous.close;
  }).length;

  const holdRatio = holdCount / futureCandles.length;
  return clamp(normalizedGapSize * 0.35 + holdRatio * 0.65);
}

function recencyFactor(candles: Candle[], swing: SwingPoint): number {
  const latestTimestamp = candles.at(-1)?.timestamp ?? swing.timestamp;
  const ageBars = Math.max(0, candles.length - 1 - swing.index);
  const ageMs = Math.max(0, latestTimestamp - swing.timestamp);
  const agePenalty = Math.max(ageBars / Math.max(candles.length, 1), ageMs / (1000 * 60 * 60 * 24 * 14));
  return clamp(1 - agePenalty);
}

function normalizedDisplacementScore(timeframe: CandleTimeframe, displacement: number): number {
  const baseline =
    timeframe === "daily" ? 0.12 : timeframe === "4h" ? 0.08 : 0.035;
  return clamp(displacement / baseline);
}

export function buildSwingCandidateEvidence(
  swing: SwingPoint,
  timeframe: CandleTimeframe,
  candles: Candle[],
): Pick<
  RawLevelCandidate,
  | "touchCount"
  | "reactionScore"
  | "reactionQuality"
  | "rejectionScore"
  | "displacementScore"
  | "sessionSignificance"
  | "followThroughScore"
  | "gapContinuationScore"
  | "repeatedReactionCount"
  | "gapStructure"
> {
  const timeframeSessionSignificance =
    timeframe === "daily" ? 1 : timeframe === "4h" ? 0.72 : 0.45;
  const requirePositiveVolumeEvidence = timeframe === "5m";
  const sourceCandle = candles[swing.index];
  const tolerance = toleranceForPrice(swing.price);
  const respectRetests = countRespectRetests(
    candles,
    swing,
    tolerance,
    requirePositiveVolumeEvidence,
  );
  const observedInteractions = Math.max(
    1,
    swing.reactionCount,
    respectRetests + 1,
  );
  const rejectionScore = sourceCandle ? wickRejectionScore(swing, sourceCandle) : 0;
  const recencyScore = recencyFactor(candles, swing);
  const normalizedDisplacement = normalizedDisplacementScore(timeframe, swing.displacement);
  const distinctInteractionQuality = clamp((observedInteractions - 1) / 3);
  const reactionQuality = clamp(
    distinctInteractionQuality * 0.65 +
      rejectionScore * 0.2 +
      recencyScore * 0.15,
  );
  const gapStructure = gapStructureScore(
    candles,
    swing,
    tolerance,
    requirePositiveVolumeEvidence,
  );
  const gapContinuation = gapContinuationScore(
    candles,
    swing,
    tolerance,
    gapStructure,
    requirePositiveVolumeEvidence,
  );
  const interactionOverusePenalty = Math.max(
    0,
    (observedInteractions - 4) * 0.06,
  );
  const followThroughScore = clamp(
    normalizedDisplacement * 0.45 +
      recencyScore * 0.22 +
      timeframeSessionSignificance * 0.13 +
      rejectionScore * 0.08 +
      gapContinuation * 0.18 -
      interactionOverusePenalty,
  );

  return {
    touchCount: observedInteractions,
    reactionScore: round(
      swing.strength *
        Math.max(1, observedInteractions) *
        (1 + rejectionScore * 0.25),
    ),
    reactionQuality: round(reactionQuality),
    rejectionScore: round(rejectionScore),
    displacementScore: round(swing.displacement * (gapStructure ? 1.08 : 1)),
    sessionSignificance: round(timeframeSessionSignificance * (0.7 + recencyScore * 0.3)),
    followThroughScore: round(followThroughScore),
    gapContinuationScore: round(gapContinuation),
    repeatedReactionCount: observedInteractions,
    gapStructure,
  };
}
