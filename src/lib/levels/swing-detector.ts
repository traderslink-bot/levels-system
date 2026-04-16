// 2026-04-14 08:05 PM America/Toronto
// Stronger swing detection with displacement and separation filtering.

import type { Candle } from "../market-data/candle-types.js";
import type { SwingPoint } from "./level-types.js";

export type SwingDetectionOptions = {
  swingWindow: number;
  minimumDisplacementPct: number;
  minimumSeparationBars: number;
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

    if (current.high >= highest) {
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

    if (current.low <= lowest) {
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
  }

  return selectDominantSwings(candidateSwings, options.minimumSeparationBars);
}
