// 2026-04-14 08:05 PM America/Toronto
// Convert swing points into raw level candidates.

import type { CandleTimeframe } from "../market-data/candle-types.js";
import type { RawLevelCandidate, SwingPoint } from "./level-types.js";

export function buildRawLevelCandidates(params: {
  symbol: string;
  timeframe: CandleTimeframe;
  swings: SwingPoint[];
}): RawLevelCandidate[] {
  const { symbol, timeframe, swings } = params;

  return swings.map((swing, index) => ({
    id: `${symbol}-${timeframe}-${swing.kind}-${index}-${swing.timestamp}`,
    symbol,
    price: Number(swing.price.toFixed(4)),
    kind: swing.kind,
    timeframe,
    sourceType: swing.kind === "resistance" ? "swing_high" : "swing_low",
    touchCount: 1,
    reactionScore: Number(swing.strength.toFixed(4)),
    firstTimestamp: swing.timestamp,
    lastTimestamp: swing.timestamp,
    notes: [`Derived from ${timeframe} ${swing.kind} swing.`],
  }));
}
