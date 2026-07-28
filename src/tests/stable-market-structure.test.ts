import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStableMarketStructureContext,
  scoreMarketStructureMateriality,
  buildCandleMarketStructureContext,
  type Candle,
} from "../lib/support-resistance/index.js";

const START = Date.UTC(2026, 4, 1, 13, 30, 0);
const FIVE_MINUTES = 5 * 60 * 1000;

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1]!;
    return {
      timestamp: START + index * FIVE_MINUTES,
      open,
      high: Math.max(open, close) + 0.01,
      low: Math.max(0.01, Math.min(open, close) - 0.01),
      close,
      volume: 100_000 + index * 1_000,
    };
  });
}

test("stable market structure suppresses noisy raw state flips", () => {
  const context = buildStableMarketStructureContext({
    symbol: "CHOP",
    candles: candlesFromCloses([
      1.00, 1.05, 1.01, 1.06, 1.00,
      1.05, 0.99, 1.06, 1.00, 1.05,
      0.99, 1.06, 1.00, 1.05, 1.01,
      1.06, 1.00, 1.04, 1.01, 1.03,
      1.05, 1.00, 1.06, 1.01, 1.04,
    ]),
  });

  assert.ok(context.decisions.length > 0);
  assert.ok(context.stableTransitionCount <= context.rawTransitionCount);
  assert.ok(context.suppressedTransitionCount > 0);
  assert.ok(context.decisions.some((decision) => decision.reason === "range_chop_continuation" || decision.reason === "not_persistent"));
});

test("stable market structure accepts persistent material changes", () => {
  const context = buildStableMarketStructureContext({
    symbol: "MOVE",
    candles: [
      { timestamp: START, open: 1.00, high: 1.02, low: 0.98, close: 1.00, volume: 1 },
      { timestamp: START + FIVE_MINUTES, open: 1.00, high: 1.08, low: 1.00, close: 1.06, volume: 1 },
      { timestamp: START + 2 * FIVE_MINUTES, open: 1.06, high: 1.14, low: 1.05, close: 1.12, volume: 1 },
      { timestamp: START + 3 * FIVE_MINUTES, open: 1.12, high: 1.08, low: 1.01, close: 1.03, volume: 1 },
      { timestamp: START + 4 * FIVE_MINUTES, open: 1.03, high: 1.05, low: 0.96, close: 0.99, volume: 1 },
      { timestamp: START + 5 * FIVE_MINUTES, open: 0.99, high: 1.12, low: 1.01, close: 1.10, volume: 1 },
      { timestamp: START + 6 * FIVE_MINUTES, open: 1.10, high: 1.22, low: 1.09, close: 1.20, volume: 1 },
      { timestamp: START + 7 * FIVE_MINUTES, open: 1.20, high: 1.16, low: 1.08, close: 1.11, volume: 1 },
      { timestamp: START + 8 * FIVE_MINUTES, open: 1.11, high: 1.10, low: 1.02, close: 1.05, volume: 1 },
      { timestamp: START + 9 * FIVE_MINUTES, open: 1.05, high: 1.18, low: 1.07, close: 1.16, volume: 1 },
      { timestamp: START + 10 * FIVE_MINUTES, open: 1.16, high: 1.32, low: 1.15, close: 1.30, volume: 1 },
      { timestamp: START + 11 * FIVE_MINUTES, open: 1.30, high: 1.25, low: 1.16, close: 1.20, volume: 1 },
      { timestamp: START + 12 * FIVE_MINUTES, open: 1.20, high: 1.19, low: 1.10, close: 1.13, volume: 1 },
      { timestamp: START + 13 * FIVE_MINUTES, open: 1.13, high: 1.30, low: 1.14, close: 1.28, volume: 1 },
      { timestamp: START + 14 * FIVE_MINUTES, open: 1.28, high: 1.42, low: 1.26, close: 1.39, volume: 1 },
      { timestamp: START + 15 * FIVE_MINUTES, open: 1.39, high: 1.35, low: 1.24, close: 1.31, volume: 1 },
      { timestamp: START + 16 * FIVE_MINUTES, open: 1.31, high: 1.28, low: 1.20, close: 1.24, volume: 1 },
      { timestamp: START + 17 * FIVE_MINUTES, open: 1.24, high: 1.40, low: 1.23, close: 1.37, volume: 1 },
      { timestamp: START + 18 * FIVE_MINUTES, open: 1.37, high: 1.52, low: 1.36, close: 1.48, volume: 1 },
      { timestamp: START + 19 * FIVE_MINUTES, open: 1.48, high: 1.46, low: 1.38, close: 1.42, volume: 1 },
    ],
    persistenceBars: 2,
    materialityThreshold: 0.5,
  });

  assert.ok(context.stableTransitionCount > 0);
  assert.ok(context.decisions.some((decision) => decision.accepted && decision.reason !== "initial_state"));
});

test("materiality score rewards confirmed pivot events more than ordinary range churn", () => {
  const churn = buildCandleMarketStructureContext({
    symbol: "CHURN",
    candles: candlesFromCloses([
      1.00, 1.05, 1.01, 1.06, 1.00,
      1.05, 0.99, 1.06, 1.00, 1.05,
      0.99, 1.06, 1.00, 1.05, 1.01,
      1.06, 1.00, 1.04, 1.01, 1.03,
    ]),
  });
  const reclaim = buildCandleMarketStructureContext({
    symbol: "RECLAIM",
    candles: candlesFromCloses([
      1.00, 1.08, 1.16, 1.04, 1.01,
      1.12, 1.22, 1.10, 1.05, 1.00,
      0.97, 1.00, 1.04, 1.15, 1.18,
    ]),
  });

  const churnScore = scoreMarketStructureMateriality({
    context: churn,
    previousStableState: "range_bound",
    rawRunLength: 1,
  });
  const reclaimScore = scoreMarketStructureMateriality({
    context: reclaim,
    previousStableState: "pivot_lost",
    rawRunLength: 3,
  });

  assert.ok(reclaimScore > churnScore);
});
