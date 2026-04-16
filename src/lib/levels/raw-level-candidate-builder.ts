// 2026-04-14 08:05 PM America/Toronto
// Convert filtered swing points into richer raw level candidates.

import type { Candle, CandleTimeframe } from "../market-data/candle-types.js";
import { buildSwingCandidateEvidence } from "./level-candidate-quality.js";
import type { RawLevelCandidate, SwingPoint } from "./level-types.js";

export function buildRawLevelCandidates(params: {
  symbol: string;
  timeframe: CandleTimeframe;
  candles: Candle[];
  swings: SwingPoint[];
}): RawLevelCandidate[] {
  const { symbol, timeframe, candles, swings } = params;

  return swings.map((swing, index) => {
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
}
