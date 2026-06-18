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

export function buildRawLevelCandidates(params: {
  symbol: string;
  timeframe: CandleTimeframe;
  candles: Candle[];
  swings: SwingPoint[];
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

  return [
    ...swingCandidates,
    ...buildLowPriceExpansionShelfCandidates({ symbol, timeframe, candles, swings }),
    ...buildRepeatedOhlcPivotCandidates({ symbol, timeframe, candles, swings, kind: "support" }),
    ...buildRepeatedOhlcPivotCandidates({ symbol, timeframe, candles, swings, kind: "resistance" }),
  ];
}
