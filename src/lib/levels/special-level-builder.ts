// 2026-04-14 08:05 PM America/Toronto
// Session-aware special intraday levels derived from classified 5 minute candles.

import type { Candle } from "../market-data/candle-types.js";
import { filterCandlesBySession } from "../market-data/candle-session-classifier.js";
import type { RawLevelCandidate } from "./level-types.js";

export type SpecialLevelOutput = {
  candidates: RawLevelCandidate[];
  summary: {
    premarketHigh?: number;
    premarketLow?: number;
    openingRangeHigh?: number;
    openingRangeLow?: number;
  };
};

function round(value: number): number {
  return Number(value.toFixed(4));
}

function latestSessionCandles(candles: Candle[]): Candle[] {
  const latestDay = new Date(candles.at(-1)?.timestamp ?? Date.now()).getDate();
  return candles.filter((candle) => new Date(candle.timestamp).getDate() === latestDay);
}

export function buildSpecialLevelCandidates(symbol: string, candles: Candle[]): SpecialLevelOutput {
  if (candles.length === 0) {
    return { candidates: [], summary: {} };
  }

  const latestCandles = latestSessionCandles(candles);
  const premarketCandles = filterCandlesBySession(latestCandles, "5m", "premarket");
  const openingRangeCandles = filterCandlesBySession(latestCandles, "5m", "opening_range");
  const candidates: RawLevelCandidate[] = [];
  const lastTimestamp = latestCandles.at(-1)?.timestamp ?? Date.now();

  const premarketHigh =
    premarketCandles.length > 0 ? round(Math.max(...premarketCandles.map((candle) => candle.high))) : undefined;
  const premarketLow =
    premarketCandles.length > 0 ? round(Math.min(...premarketCandles.map((candle) => candle.low))) : undefined;
  const openingRangeHigh =
    openingRangeCandles.length > 0
      ? round(Math.max(...openingRangeCandles.map((candle) => candle.high)))
      : undefined;
  const openingRangeLow =
    openingRangeCandles.length > 0
      ? round(Math.min(...openingRangeCandles.map((candle) => candle.low)))
      : undefined;

  if (premarketHigh !== undefined) {
    candidates.push({
      id: `${symbol}-5m-premarket-high-${lastTimestamp}`,
      symbol,
      price: premarketHigh,
      kind: "resistance",
      timeframe: "5m",
      sourceType: "premarket_high",
      touchCount: 1,
      reactionScore: 1,
      reactionQuality: 0.8,
      rejectionScore: 0.65,
      displacementScore: 0.6,
      sessionSignificance: 1,
      followThroughScore: 0.72,
      gapContinuationScore: 0,
      repeatedReactionCount: 1,
      gapStructure: false,
      firstTimestamp: premarketCandles[0]!.timestamp,
      lastTimestamp,
      notes: ["Session-accurate premarket high candidate."],
    });
  }

  if (premarketLow !== undefined) {
    candidates.push({
      id: `${symbol}-5m-premarket-low-${lastTimestamp}`,
      symbol,
      price: premarketLow,
      kind: "support",
      timeframe: "5m",
      sourceType: "premarket_low",
      touchCount: 1,
      reactionScore: 1,
      reactionQuality: 0.8,
      rejectionScore: 0.65,
      displacementScore: 0.6,
      sessionSignificance: 1,
      followThroughScore: 0.72,
      gapContinuationScore: 0,
      repeatedReactionCount: 1,
      gapStructure: false,
      firstTimestamp: premarketCandles[0]!.timestamp,
      lastTimestamp,
      notes: ["Session-accurate premarket low candidate."],
    });
  }

  if (openingRangeHigh !== undefined) {
    candidates.push({
      id: `${symbol}-5m-opening-range-high-${lastTimestamp}`,
      symbol,
      price: openingRangeHigh,
      kind: "resistance",
      timeframe: "5m",
      sourceType: "opening_range_high",
      touchCount: 1,
      reactionScore: 1,
      reactionQuality: 0.9,
      rejectionScore: 0.72,
      displacementScore: 0.7,
      sessionSignificance: 1,
      followThroughScore: 0.82,
      gapContinuationScore: 0,
      repeatedReactionCount: 1,
      gapStructure: false,
      firstTimestamp: openingRangeCandles[0]!.timestamp,
      lastTimestamp,
      notes: ["Session-accurate opening range high candidate."],
    });
  }

  if (openingRangeLow !== undefined) {
    candidates.push({
      id: `${symbol}-5m-opening-range-low-${lastTimestamp}`,
      symbol,
      price: openingRangeLow,
      kind: "support",
      timeframe: "5m",
      sourceType: "opening_range_low",
      touchCount: 1,
      reactionScore: 1,
      reactionQuality: 0.9,
      rejectionScore: 0.72,
      displacementScore: 0.7,
      sessionSignificance: 1,
      followThroughScore: 0.82,
      gapContinuationScore: 0,
      repeatedReactionCount: 1,
      gapStructure: false,
      firstTimestamp: openingRangeCandles[0]!.timestamp,
      lastTimestamp,
      notes: ["Session-accurate opening range low candidate."],
    });
  }

  return {
    candidates,
    summary: {
      premarketHigh,
      premarketLow,
      openingRangeHigh,
      openingRangeLow,
    },
  };
}
