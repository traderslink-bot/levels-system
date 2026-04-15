// 2026-04-14 08:05 PM America/Toronto
// Add special intraday levels for the most recent 5 minute session.

import type { Candle } from "../market-data/candle-types.js";
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

export function buildSpecialLevelCandidates(symbol: string, candles: Candle[]): SpecialLevelOutput {
  if (candles.length === 0) {
    return { candidates: [], summary: {} };
  }

  const latestSessionCandles = candles.slice(Math.max(0, candles.length - 24));
  const firstSix = latestSessionCandles.slice(0, Math.min(6, latestSessionCandles.length));

  const premarketHigh = Number(Math.max(...latestSessionCandles.map((c) => c.high)).toFixed(4));
  const premarketLow = Number(Math.min(...latestSessionCandles.map((c) => c.low)).toFixed(4));
  const openingRangeHigh = firstSix.length > 0 ? Number(Math.max(...firstSix.map((c) => c.high)).toFixed(4)) : undefined;
  const openingRangeLow = firstSix.length > 0 ? Number(Math.min(...firstSix.map((c) => c.low)).toFixed(4)) : undefined;
  const lastTimestamp = latestSessionCandles.at(-1)?.timestamp ?? Date.now();

  const candidates: RawLevelCandidate[] = [];

  candidates.push({
    id: `${symbol}-5m-premarket-high-${lastTimestamp}`,
    symbol,
    price: premarketHigh,
    kind: "resistance",
    timeframe: "5m",
    sourceType: "premarket_high",
    touchCount: 1,
    reactionScore: 1,
    firstTimestamp: latestSessionCandles[0].timestamp,
    lastTimestamp,
    notes: ["Recent intraday session high."],
  });

  candidates.push({
    id: `${symbol}-5m-premarket-low-${lastTimestamp}`,
    symbol,
    price: premarketLow,
    kind: "support",
    timeframe: "5m",
    sourceType: "premarket_low",
    touchCount: 1,
    reactionScore: 1,
    firstTimestamp: latestSessionCandles[0].timestamp,
    lastTimestamp,
    notes: ["Recent intraday session low."],
  });

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
      firstTimestamp: firstSix[0].timestamp,
      lastTimestamp,
      notes: ["Opening range high candidate."],
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
      firstTimestamp: firstSix[0].timestamp,
      lastTimestamp,
      notes: ["Opening range low candidate."],
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
