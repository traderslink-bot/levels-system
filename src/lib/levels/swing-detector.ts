// 2026-04-14 08:05 PM America/Toronto
// Stronger swing detection with displacement and separation filtering.

import type { Candle } from "../market-data/candle-types.js";
import type { SwingPoint } from "./level-types.js";

export type SwingDetectionOptions = {
  swingWindow: number;
  minimumDisplacementPct: number;
  minimumSeparationBars: number;
  includeBarrierCandles?: boolean;
};

function round(value: number): number {
  return Number(value.toFixed(4));
}

function countLocalReactions(
  candles: Candle[],
  index: number,
  price: number,
  swingWindow: number,
): number {
  const tolerance = Math.max(price * 0.003, 0.0001);
  const left = Math.max(0, index - swingWindow * 3);
  const right = Math.min(candles.length - 1, index + swingWindow * 3);
  let reactions = 0;

  for (let cursor = left; cursor <= right; cursor += 1) {
    const candle = candles[cursor]!;
    if (Math.abs(candle.high - price) <= tolerance || Math.abs(candle.low - price) <= tolerance) {
      reactions += 1;
    }
  }

  return reactions;
}

function candleRange(candle: { high: number; low: number }): number {
  return Math.max(candle.high - candle.low, 0.0001);
}

function hasMeaningfulBarrierReaction(
  candles: Candle[],
  index: number,
  kind: SwingPoint["kind"],
  swingWindow: number,
): boolean {
  const candle = candles[index]!;
  const range = candleRange(candle);
  const bodyHigh = Math.max(candle.open, candle.close);
  const bodyLow = Math.min(candle.open, candle.close);
  const reactionCount = countLocalReactions(
    candles,
    index,
    kind === "resistance" ? candle.high : candle.low,
    swingWindow,
  );

  if (kind === "resistance") {
    const upperWickRatio = (candle.high - bodyHigh) / range;
    const closeOffHighRatio = (candle.high - candle.close) / range;
    return reactionCount >= 2 || upperWickRatio >= 0.24 || closeOffHighRatio >= 0.36;
  }

  const lowerWickRatio = (bodyLow - candle.low) / range;
  const closeOffLowRatio = (candle.close - candle.low) / range;
  return reactionCount >= 2 || lowerWickRatio >= 0.24 || closeOffLowRatio >= 0.36;
}

function buildBarrierSwing(params: {
  candles: Candle[];
  index: number;
  kind: SwingPoint["kind"];
  swingWindow: number;
  displacementPct: number;
  displacement: number;
}): SwingPoint {
  const candle = params.candles[params.index]!;
  const price = params.kind === "resistance" ? candle.high : candle.low;

  return {
    index: params.index,
    timestamp: candle.timestamp,
    price: round(price),
    kind: params.kind,
    strength: round(params.displacement * 0.8),
    displacement: round(params.displacementPct * 0.85),
    separation: params.swingWindow,
    reactionCount: countLocalReactions(params.candles, params.index, price, params.swingWindow),
  };
}

function selectDominantSwings(
  swings: SwingPoint[],
  minimumSeparationBars: number,
): SwingPoint[] {
  const selected: SwingPoint[] = [];

  for (const swing of swings) {
    const previousIndex = [...selected].reverse().findIndex((candidate) => candidate.kind === swing.kind);
    const matchedIndex =
      previousIndex === -1 ? -1 : selected.length - 1 - previousIndex;
    const previous = matchedIndex === -1 ? undefined : selected[matchedIndex];
    if (
      previous &&
      swing.index - previous.index < minimumSeparationBars
    ) {
      if (swing.strength > previous.strength) {
        selected[matchedIndex] = swing;
      }
      continue;
    }

    selected.push(swing);
  }

  return selected;
}

export function detectSwingPoints(
  candles: Candle[],
  swingWindowOrOptions: number | SwingDetectionOptions,
): SwingPoint[] {
  const options: SwingDetectionOptions =
    typeof swingWindowOrOptions === "number"
      ? {
          swingWindow: swingWindowOrOptions,
          minimumDisplacementPct: 0,
          minimumSeparationBars: 1,
        }
      : swingWindowOrOptions;

  if (candles.length < options.swingWindow * 2 + 1) {
    return [];
  }

  const candidateSwings: SwingPoint[] = [];

  for (let index = options.swingWindow; index < candles.length - options.swingWindow; index += 1) {
    const current = candles[index]!;
    const window = candles.slice(index - options.swingWindow, index + options.swingWindow + 1);
    const highest = Math.max(...window.map((candle) => candle.high));
    const lowest = Math.min(...window.map((candle) => candle.low));
    const baseline = Math.max((highest + lowest) / 2, 0.0001);
    const displacement = highest - lowest;
    const displacementPct = displacement / baseline;

    if (displacementPct < options.minimumDisplacementPct) {
      continue;
    }

    const isResistanceSwing = current.high >= highest;
    const isSupportSwing = current.low <= lowest;

    if (isResistanceSwing) {
      candidateSwings.push({
        index,
        timestamp: current.timestamp,
        price: round(current.high),
        kind: "resistance",
        strength: round(displacement),
        displacement: round(displacementPct),
        separation: options.swingWindow,
        reactionCount: countLocalReactions(candles, index, current.high, options.swingWindow),
      });
    }

    if (isSupportSwing) {
      candidateSwings.push({
        index,
        timestamp: current.timestamp,
        price: round(current.low),
        kind: "support",
        strength: round(displacement),
        displacement: round(displacementPct),
        separation: options.swingWindow,
        reactionCount: countLocalReactions(candles, index, current.low, options.swingWindow),
      });
    }

    if (options.includeBarrierCandles) {
      const upperBarrierArea = lowest + displacement * 0.5;
      const lowerBarrierArea = highest - displacement * 0.5;

      if (
        !isResistanceSwing &&
        current.high >= upperBarrierArea &&
        hasMeaningfulBarrierReaction(candles, index, "resistance", options.swingWindow)
      ) {
        candidateSwings.push(
          buildBarrierSwing({
            candles,
            index,
            kind: "resistance",
            swingWindow: options.swingWindow,
            displacementPct,
            displacement,
          }),
        );
      }

      if (
        !isSupportSwing &&
        current.low <= lowerBarrierArea &&
        hasMeaningfulBarrierReaction(candles, index, "support", options.swingWindow)
      ) {
        candidateSwings.push(
          buildBarrierSwing({
            candles,
            index,
            kind: "support",
            swingWindow: options.swingWindow,
            displacementPct,
            displacement,
          }),
        );
      }
    }
  }

  return selectDominantSwings(candidateSwings, options.minimumSeparationBars);
}
