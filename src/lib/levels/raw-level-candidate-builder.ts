// 2026-04-14 08:05 PM America/Toronto
// Convert filtered swing points into richer raw level candidates.

import type { Candle, CandleTimeframe } from "../market-data/candle-types.js";
import { buildSwingCandidateEvidence } from "./level-candidate-quality.js";
import type { RawLevelCandidate, SwingPoint } from "./level-types.js";

function clamp(value: number, min: number = 0, max: number = 1): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function isNearExistingSwing(price: number, swings: SwingPoint[]): boolean {
  return swings.some(
    (swing) =>
      swing.kind === "resistance" &&
      Math.abs(swing.price - price) / Math.max(Math.max(swing.price, price), 0.0001) <= 0.012,
  );
}

type OhlcPivotPoint = {
  price: number;
  timestamp: number;
  candleIndex: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }

  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function addUniquePivotPoint(
  points: OhlcPivotPoint[],
  seen: Set<string>,
  candleIndex: number,
  timestamp: number,
  price: number,
): void {
  if (!Number.isFinite(price) || price <= 0) {
    return;
  }

  const key = `${candleIndex}:${round(price)}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  points.push({ price: round(price), timestamp, candleIndex });
}

function collectOhlcPivotPoints(
  candles: Candle[],
  kind: "support" | "resistance",
): OhlcPivotPoint[] {
  const recentCandles = candles.slice(-520);
  const points: OhlcPivotPoint[] = [];
  const seen = new Set<string>();

  recentCandles.forEach((candle, localIndex) => {
    const candleIndex = candles.length - recentCandles.length + localIndex;
    if (kind === "resistance") {
      addUniquePivotPoint(points, seen, candleIndex, candle.timestamp, candle.high);
      addUniquePivotPoint(points, seen, candleIndex, candle.timestamp, Math.max(candle.open, candle.close));
      return;
    }

    addUniquePivotPoint(points, seen, candleIndex, candle.timestamp, candle.low);
    addUniquePivotPoint(points, seen, candleIndex, candle.timestamp, Math.min(candle.open, candle.close));
  });

  return points.sort((left, right) => left.price - right.price);
}

function buildRepeatedOhlcPivotCandidates(params: {
  symbol: string;
  timeframe: CandleTimeframe;
  candles: Candle[];
  swings: SwingPoint[];
  kind: "support" | "resistance";
}): RawLevelCandidate[] {
  if (params.timeframe === "5m" || params.candles.length < 40) {
    return [];
  }

  const points = collectOhlcPivotPoints(params.candles, params.kind);
  const tolerancePct = params.timeframe === "daily" ? 0.04 : 0.028;
  const groups: OhlcPivotPoint[][] = [];

  for (const point of points) {
    const last = groups.at(-1);
    const lastCenter = last ? median(last.map((item) => item.price)) : null;
    if (
      !last ||
      lastCenter === null ||
      Math.abs(point.price - lastCenter) / Math.max(Math.max(point.price, lastCenter), 0.0001) >
        tolerancePct
    ) {
      groups.push([point]);
      continue;
    }

    last.push(point);
  }

  const candidates: RawLevelCandidate[] = [];

  groups.forEach((group, index) => {
    const candleCount = new Set(group.map((point) => point.candleIndex)).size;
    if (group.length < 5 || candleCount < 4) {
      return;
    }

    const prices = group.map((point) => point.price);
    const price = round(median(prices));
    const spanPct =
      (Math.max(...prices) - Math.min(...prices)) /
      Math.max(price, 0.0001);
    if (spanPct > 0.09) {
      return;
    }

    const evidenceScore = clamp(candleCount / 10, 0.35, 0.9);
    const primaryCandidate: RawLevelCandidate = {
      id: `${params.symbol}-${params.timeframe}-ohlc-pivot-${params.kind}-${index}`,
      symbol: params.symbol,
      price,
      kind: params.kind,
      timeframe: params.timeframe,
      sourceType: params.kind === "support" ? "swing_low" : "swing_high",
      touchCount: candleCount,
      reactionScore: round(evidenceScore),
      reactionQuality: round(evidenceScore),
      rejectionScore: round(clamp(0.35 + candleCount / 20, 0.35, 0.85)),
      displacementScore: round(clamp(0.25 + candleCount / 30, 0.25, 0.75)),
      sessionSignificance: params.timeframe === "daily" ? 0.84 : 0.64,
      followThroughScore: round(clamp(0.35 + candleCount / 22, 0.35, 0.82)),
      gapContinuationScore: 0,
      repeatedReactionCount: candleCount,
      gapStructure: false,
      firstTimestamp: Math.min(...group.map((point) => point.timestamp)),
      lastTimestamp: Math.max(...group.map((point) => point.timestamp)),
      notes: [
        `Derived from repeated ${params.timeframe} OHLC ${params.kind} pivot.`,
        `ohlcPivotTouches=${group.length}`,
        `ohlcPivotCandles=${candleCount}`,
        `ohlcPivotSpanPct=${spanPct.toFixed(4)}`,
      ],
    };
    candidates.push(primaryCandidate);

    const shouldEmitRoleFlexibleBarrier =
      candleCount >= 5 &&
      group.length >= 6 &&
      spanPct <= 0.075 &&
      (params.timeframe === "daily" || params.timeframe === "4h");
    if (shouldEmitRoleFlexibleBarrier) {
      const oppositeKind = params.kind === "support" ? "resistance" : "support";
      const roleFlexScore = round(clamp(evidenceScore * 0.82, 0.32, 0.74));
      candidates.push({
        ...primaryCandidate,
        id: `${params.symbol}-${params.timeframe}-ohlc-pivot-role-flex-${oppositeKind}-${index}`,
        kind: oppositeKind,
        sourceType: oppositeKind === "support" ? "swing_low" : "swing_high",
        reactionScore: roleFlexScore,
        reactionQuality: roleFlexScore,
        rejectionScore: round(clamp(primaryCandidate.rejectionScore * 0.86, 0.3, 0.72)),
        displacementScore: round(clamp(primaryCandidate.displacementScore * 0.86, 0.22, 0.62)),
        sessionSignificance: params.timeframe === "daily" ? 0.74 : 0.56,
        followThroughScore: round(clamp(primaryCandidate.followThroughScore * 0.86, 0.3, 0.7)),
        notes: [
          `Derived from repeated ${params.timeframe} OHLC ${params.kind} pivot as role-flexible ${oppositeKind} barrier.`,
          `ohlcPivotTouches=${group.length}`,
          `ohlcPivotCandles=${candleCount}`,
          `ohlcPivotSpanPct=${spanPct.toFixed(4)}`,
        ],
      });
    }
  });

  return candidates;
}

function buildLowPriceExpansionShelfCandidates(params: {
  symbol: string;
  timeframe: CandleTimeframe;
  candles: Candle[];
  swings: SwingPoint[];
}): RawLevelCandidate[] {
  if (params.timeframe === "5m") {
    return [];
  }

  const candidates: RawLevelCandidate[] = [];

  for (let index = 1; index < params.candles.length - 1; index += 1) {
    const candle = params.candles[index]!;
    if (candle.high <= 0 || candle.high >= 5 || isNearExistingSwing(candle.high, params.swings)) {
      continue;
    }

    const futureWindow = params.candles.slice(index + 1, Math.min(params.candles.length, index + 4));
    const futureHigh = Math.max(...futureWindow.map((future) => future.high));
    const expansionRatio = futureHigh / Math.max(candle.high, 0.0001);
    if (!Number.isFinite(expansionRatio) || expansionRatio < 2.4) {
      continue;
    }

    const range = Math.max(candle.high - candle.low, 0.0001);
    const closeOffHighRatio = (candle.high - candle.close) / range;
    if (closeOffHighRatio < 0.05) {
      continue;
    }

    const previous = params.candles[index - 1]!;
    const next = params.candles[index + 1]!;
    const shelfNeighbor =
      Math.abs(previous.high - candle.high) / Math.max(previous.high, candle.high, 0.0001) <= 0.07 ||
      Math.abs(next.high - candle.high) / Math.max(next.high, candle.high, 0.0001) <= 0.07;
    if (!shelfNeighbor && closeOffHighRatio < 0.25) {
      continue;
    }

    const price = round(candle.high);
    candidates.push({
      id: `${params.symbol}-${params.timeframe}-shelf-resistance-${index}-${candle.timestamp}`,
      symbol: params.symbol,
      price,
      kind: "resistance",
      timeframe: params.timeframe,
      sourceType: "swing_high",
      touchCount: 1,
      reactionScore: round((candle.high - candle.low) * (1 + closeOffHighRatio)),
      reactionQuality: round(clamp(0.22 + closeOffHighRatio * 0.35)),
      rejectionScore: round(clamp(closeOffHighRatio)),
      displacementScore: round(clamp((expansionRatio - 1) / 2.5)),
      sessionSignificance: params.timeframe === "daily" ? 0.86 : 0.62,
      followThroughScore: round(clamp(0.34 + Math.min(expansionRatio - 1, 3) * 0.12)),
      gapContinuationScore: 0,
      repeatedReactionCount: 1,
      gapStructure: false,
      firstTimestamp: candle.timestamp,
      lastTimestamp: candle.timestamp,
      notes: [
        `Derived from ${params.timeframe} low-price expansion shelf high.`,
        `futureExpansionRatio=${expansionRatio.toFixed(4)}`,
        `closeOffHigh=${closeOffHighRatio.toFixed(4)}`,
      ],
    });
  }

  return candidates;
}

type BreakoutBaseDetectionConfig = {
  baseLookbackBars: number;
  followThroughBars: number;
  maxBaseWidthPct: number;
  minBreakPct: number;
  minExpansionPct: number;
  minVolumeRatio: number;
  duplicateTolerancePct: number;
};

function breakoutBaseDetectionConfig(
  timeframe: CandleTimeframe,
): BreakoutBaseDetectionConfig | null {
  if (timeframe === "5m") {
    return {
      baseLookbackBars: 8,
      followThroughBars: 8,
      maxBaseWidthPct: 0.14,
      minBreakPct: 0.018,
      minExpansionPct: 0.16,
      minVolumeRatio: 1.15,
      duplicateTolerancePct: 0.018,
    };
  }

  if (timeframe === "4h") {
    return {
      baseLookbackBars: 6,
      followThroughBars: 4,
      maxBaseWidthPct: 0.18,
      minBreakPct: 0.02,
      minExpansionPct: 0.22,
      minVolumeRatio: 1.08,
      duplicateTolerancePct: 0.024,
    };
  }

  return null;
}

function countNearPrice(prices: number[], target: number, tolerancePct: number): number {
  return prices.filter(
    (price) =>
      Math.abs(price - target) / Math.max(Math.max(price, target), 0.0001) <= tolerancePct,
  ).length;
}

function hasEnoughVolumeExpansion(
  baseCandles: Candle[],
  breakoutCandle: Candle,
  minVolumeRatio: number,
): boolean {
  const baseVolumes = baseCandles.map((candle) => candle.volume).filter((volume) => volume > 0);
  if (baseVolumes.length < Math.max(3, Math.floor(baseCandles.length / 2))) {
    return true;
  }

  const baseMedianVolume = median(baseVolumes);
  if (baseMedianVolume <= 0 || breakoutCandle.volume <= 0) {
    return true;
  }

  return breakoutCandle.volume / baseMedianVolume >= minVolumeRatio;
}

function duplicateBreakoutBaseCandidate(
  candidates: RawLevelCandidate[],
  price: number,
  tolerancePct: number,
): RawLevelCandidate | undefined {
  return candidates.find(
    (candidate) =>
      Math.abs(candidate.price - price) /
        Math.max(Math.max(candidate.price, price), 0.0001) <=
      tolerancePct,
  );
}

function buildBreakoutBaseSupportCandidates(params: {
  symbol: string;
  timeframe: CandleTimeframe;
  candles: Candle[];
}): RawLevelCandidate[] {
  const config = breakoutBaseDetectionConfig(params.timeframe);
  if (!config || params.candles.length < config.baseLookbackBars + 2) {
    return [];
  }

  const candidates: RawLevelCandidate[] = [];

  for (
    let index = config.baseLookbackBars;
    index < params.candles.length;
    index += 1
  ) {
    const baseCandles = params.candles.slice(index - config.baseLookbackBars, index);
    const breakoutCandle = params.candles[index]!;
    const evidenceBaseCandles = params.timeframe === "5m"
      ? baseCandles.filter((candle) => candle.volume > 0)
      : baseCandles;
    if (
      (params.timeframe === "5m" && breakoutCandle.volume <= 0) ||
      evidenceBaseCandles.length < Math.min(3, config.baseLookbackBars)
    ) {
      continue;
    }
    const baseHigh = Math.max(...evidenceBaseCandles.map((candle) => candle.high));
    const baseLow = Math.min(...evidenceBaseCandles.map((candle) => candle.low));
    if (!Number.isFinite(baseHigh) || !Number.isFinite(baseLow) || baseHigh <= 0 || baseLow <= 0) {
      continue;
    }

    const baseWidthPct = (baseHigh - baseLow) / Math.max(baseHigh, 0.0001);
    if (baseWidthPct > config.maxBaseWidthPct) {
      continue;
    }

    const breakTolerance = Math.max(baseHigh * config.minBreakPct, 0.0001);
    if (
      breakoutCandle.close <= baseHigh + breakTolerance ||
      breakoutCandle.high <= baseHigh + breakTolerance
    ) {
      continue;
    }

    if (!hasEnoughVolumeExpansion(evidenceBaseCandles, breakoutCandle, config.minVolumeRatio)) {
      continue;
    }

    const followThroughWindow = params.candles
      .slice(index, Math.min(params.candles.length, index + config.followThroughBars + 1))
      .filter((candle) => params.timeframe !== "5m" || candle.volume > 0);
    const futureHigh = Math.max(...followThroughWindow.map((candle) => candle.high));
    const expansionPct = (futureHigh - baseHigh) / Math.max(baseHigh, 0.0001);
    if (!Number.isFinite(expansionPct) || expansionPct < config.minExpansionPct) {
      continue;
    }

    const price = round(baseHigh);
    const duplicate = duplicateBreakoutBaseCandidate(
      candidates,
      price,
      config.duplicateTolerancePct,
    );
    if (duplicate && (duplicate.gapContinuationScore ?? 0) >= clamp(expansionPct / 0.6)) {
      continue;
    }
    if (duplicate) {
      candidates.splice(candidates.indexOf(duplicate), 1);
    }

    const baseHighTouches = countNearPrice(
      evidenceBaseCandles.map((candle) => candle.high),
      baseHigh,
      config.duplicateTolerancePct,
    );
    const compressionScore = clamp(1 - baseWidthPct / config.maxBaseWidthPct, 0.2, 1);
    const expansionScore = clamp(expansionPct / 0.6, 0.28, 1);
    const followThroughScore = clamp(0.34 + expansionPct * 1.25, 0.34, 0.92);
    const volumeScore = hasEnoughVolumeExpansion(
      evidenceBaseCandles,
      breakoutCandle,
      config.minVolumeRatio * 1.45,
    )
      ? 0.12
      : 0;

    candidates.push({
      id: `${params.symbol}-${params.timeframe}-breakout-base-support-${index}-${breakoutCandle.timestamp}`,
      symbol: params.symbol,
      price,
      kind: "support",
      timeframe: params.timeframe,
      sourceType: "breakout_base",
      touchCount: Math.max(1, baseHighTouches),
      reactionScore: round(clamp(0.42 + expansionScore * 0.42 + compressionScore * 0.12)),
      reactionQuality: round(clamp(0.38 + compressionScore * 0.28 + expansionScore * 0.2)),
      rejectionScore: round(clamp(0.28 + baseHighTouches * 0.08 + compressionScore * 0.18, 0.28, 0.72)),
      displacementScore: round(expansionScore),
      sessionSignificance: params.timeframe === "5m" ? 0.72 + volumeScore : 0.78 + volumeScore,
      followThroughScore: round(followThroughScore),
      gapContinuationScore: round(expansionScore),
      repeatedReactionCount: Math.max(1, baseHighTouches),
      gapStructure: false,
      firstTimestamp: evidenceBaseCandles[0]!.timestamp,
      lastTimestamp: breakoutCandle.timestamp,
      notes: [
        `Derived from ${params.timeframe} breakout-base support.`,
        `baseHigh=${price.toFixed(4)}`,
        `baseWidthPct=${baseWidthPct.toFixed(4)}`,
        `futureExpansionPct=${expansionPct.toFixed(4)}`,
        `baseHighTouches=${baseHighTouches}`,
      ],
    });
  }

  return candidates;
}

export function buildRawLevelCandidates(params: {
  symbol: string;
  timeframe: CandleTimeframe;
  candles: Candle[];
  swings: SwingPoint[];
  /**
   * Experimental broad OHLC-density detector. Disabled by default because it
   * treats ordinary range candles as independent pivot touches and can
   * overwhelm confirmed swing evidence.
   */
  includeRepeatedOhlcPivots?: boolean;
  /** Future bars required before a swing pivot is confirmed and actionable. */
  swingConfirmationBars?: number;
}): RawLevelCandidate[] {
  const { symbol, timeframe, candles, swings } = params;

  const swingCandidates: RawLevelCandidate[] = swings.map((swing, index) => {
    const evidence = buildSwingCandidateEvidence(swing, timeframe, candles);

    return {
      id: `${symbol}-${timeframe}-${swing.kind}-${index}-${swing.timestamp}`,
      symbol,
      price: Number(swing.price.toFixed(4)),
      kind: swing.kind,
      timeframe,
      sourceType: swing.kind === "resistance" ? "swing_high" : "swing_low",
      ...evidence,
      firstTimestamp: swing.timestamp,
      lastTimestamp: swing.timestamp,
      confirmationTimestamp:
        candles[Math.min(
          swing.index + Math.max(0, params.swingConfirmationBars ?? 0),
          candles.length - 1,
        )]?.timestamp ?? swing.timestamp,
      notes: [
        `Derived from ${timeframe} ${swing.kind} swing.`,
        `displacement=${swing.displacement.toFixed(4)}`,
        `reactions=${swing.reactionCount}`,
        `rejection=${evidence.rejectionScore.toFixed(4)}`,
        `followThrough=${evidence.followThroughScore.toFixed(4)}`,
        `gapContinuation=${(evidence.gapContinuationScore ?? 0).toFixed(4)}`,
        `gap=${evidence.gapStructure ? "yes" : "no"}`,
      ],
    };
  });

  const repeatedOhlcCandidates = params.includeRepeatedOhlcPivots
    ? [
        ...buildRepeatedOhlcPivotCandidates({ symbol, timeframe, candles, swings, kind: "support" }),
        ...buildRepeatedOhlcPivotCandidates({ symbol, timeframe, candles, swings, kind: "resistance" }),
      ]
    : [];

  return [
    ...swingCandidates,
    ...buildLowPriceExpansionShelfCandidates({ symbol, timeframe, candles, swings }),
    ...buildBreakoutBaseSupportCandidates({ symbol, timeframe, candles }),
    ...repeatedOhlcCandidates,
  ];
}

function gapUpPct(previous: Candle, current: Candle): number {
  return (current.open - previous.high) / Math.max(previous.high, 0.0001);
}

function supportWasConfirmedBroken(
  candles: Candle[],
  formationIndex: number,
  supportPrice: number,
): boolean {
  const confirmationFloor = supportPrice * 0.99;
  const decisiveBreakFloor = supportPrice * 0.95;

  for (let index = formationIndex + 1; index < candles.length; index += 1) {
    const candle = candles[index]!;
    if (candle.close < decisiveBreakFloor) {
      return true;
    }

    const nextCandle = candles[index + 1];
    if (
      candle.close < confirmationFloor &&
      nextCandle &&
      nextCandle.close < confirmationFloor
    ) {
      return true;
    }
  }

  return false;
}

export function buildGapOriginSupportCandidates(params: {
  symbol: string;
  timeframe: CandleTimeframe;
  candles: Candle[];
}): RawLevelCandidate[] {
  if (params.timeframe !== "daily" || params.candles.length < 2) {
    return [];
  }

  const candidates: RawLevelCandidate[] = [];

  for (let index = 1; index < params.candles.length; index += 1) {
    const previous = params.candles[index - 1]!;
    const current = params.candles[index]!;
    const pct = gapUpPct(previous, current);
    const keptGapZoneInPlay = current.low >= previous.high * 0.8;
    const strongContinuation =
      current.high > current.open &&
      current.close >= previous.high &&
      current.volume >= previous.volume * 1.5;

    if (pct < 0.01 || !keptGapZoneInPlay || !strongContinuation) {
      continue;
    }

    const originPrice = round(previous.high);
    const originWasBroken = supportWasConfirmedBroken(
      params.candles,
      index,
      originPrice,
    );

    if (!originWasBroken) {
      candidates.push({
        id: `${params.symbol}-${params.timeframe}-gap-up-origin-${current.timestamp}`,
        symbol: params.symbol,
        price: originPrice,
        kind: "support",
        timeframe: params.timeframe,
        sourceType: "gap_up_origin",
        touchCount: 1,
        reactionScore: 1,
        reactionQuality: 0.86,
        rejectionScore: 0.7,
        displacementScore: round(Math.min(pct * 8, 1)),
        sessionSignificance: 1,
        followThroughScore: 0.78,
        gapContinuationScore: 1,
        repeatedReactionCount: 1,
        gapStructure: true,
        firstTimestamp: previous.timestamp,
        lastTimestamp: current.timestamp,
        notes: [
          "Derived from daily gap-up origin.",
          `priorHigh=${originPrice.toFixed(4)}`,
          `gapPct=${round(pct).toFixed(4)}`,
        ],
      });
    }

    const pullbackLowHeldGap =
      current.low < current.open &&
      current.low >= previous.close * 0.98 &&
      current.low <= previous.high * 1.05;

    if (
      pullbackLowHeldGap &&
      !supportWasConfirmedBroken(params.candles, index, round(current.low))
    ) {
      candidates.push({
        id: `${params.symbol}-${params.timeframe}-gap-up-pullback-low-${current.timestamp}`,
        symbol: params.symbol,
        price: round(current.low),
        kind: "support",
        timeframe: params.timeframe,
        sourceType: "gap_up_pullback_low",
        touchCount: 1,
        reactionScore: 0.92,
        reactionQuality: 0.82,
        rejectionScore: 0.64,
        displacementScore: round(Math.min(pct * 7, 1)),
        sessionSignificance: 0.96,
        followThroughScore: 0.74,
        gapContinuationScore: 0.9,
        repeatedReactionCount: 1,
        gapStructure: true,
        firstTimestamp: current.timestamp,
        lastTimestamp: current.timestamp,
        notes: [
          "Derived from daily gap-up pullback low.",
          `pullbackLow=${round(current.low).toFixed(4)}`,
          `gapPct=${round(pct).toFixed(4)}`,
        ],
      });
    }
  }

  return candidates;
}
