// 2026-04-14 08:05 PM America/Toronto
// Window-based swing detection.

import type { Candle } from "../market-data/candle-types.js";
import type { SwingPoint } from "./level-types.js";

export function detectSwingPoints(candles: Candle[], swingWindow: number): SwingPoint[] {
  if (candles.length < swingWindow * 2 + 1) {
    return [];
  }

  const swings: SwingPoint[] = [];

  for (let i = swingWindow; i < candles.length - swingWindow; i += 1) {
    const current = candles[i];
    const window = candles.slice(i - swingWindow, i + swingWindow + 1);
    const highest = Math.max(...window.map((c) => c.high));
    const lowest = Math.min(...window.map((c) => c.low));

    if (current.high >= highest) {
      swings.push({
        index: i,
        timestamp: current.timestamp,
        price: current.high,
        kind: "resistance",
        strength: highest - lowest,
      });
    }

    if (current.low <= lowest) {
      swings.push({
        index: i,
        timestamp: current.timestamp,
        price: current.low,
        kind: "support",
        strength: highest - lowest,
      });
    }
  }

  return swings;
}
