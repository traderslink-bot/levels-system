import type { Candle } from "../market-data/candle-types.js";
import {
  buildCandleMarketStructureContext,
  type CandleMarketStructureContext,
  type CandleMarketStructureState,
} from "./candle-market-structure.js";

export type StableMarketStructureDecisionReason =
  | "initial_state"
  | "same_state"
  | "persistent_material_change"
  | "high_materiality_change"
  | "low_confidence"
  | "not_persistent"
  | "immaterial_change"
  | "range_chop_continuation";

export type StableMarketStructureDecision = {
  timestamp: number;
  rawState: CandleMarketStructureState;
  stableState: CandleMarketStructureState;
  previousStableState: CandleMarketStructureState | null;
  accepted: boolean;
  materialityScore: number;
  rawRunLength: number;
  reason: StableMarketStructureDecisionReason;
  context: CandleMarketStructureContext;
};

export type StableMarketStructureContext = {
  symbol: string;
  current: StableMarketStructureDecision | null;
  rawTransitionCount: number;
  stableTransitionCount: number;
  suppressedTransitionCount: number;
  decisions: StableMarketStructureDecision[];
  stateCounts: Partial<Record<CandleMarketStructureState, number>>;
  stableStateCounts: Partial<Record<CandleMarketStructureState, number>>;
};

export type BuildStableMarketStructureRequest = {
  symbol: string;
  candles: Candle[];
  minCandles?: number;
  stepBars?: number;
  persistenceBars?: number;
  materialityThreshold?: number;
  highMaterialityThreshold?: number;
};

const DEFAULT_MIN_CANDLES = 12;
const DEFAULT_STEP_BARS = 1;
const DEFAULT_PERSISTENCE_BARS = 3;
const DEFAULT_MATERIALITY_THRESHOLD = 0.58;
const DEFAULT_HIGH_MATERIALITY_THRESHOLD = 0.78;

function increment(counts: Partial<Record<CandleMarketStructureState, number>>, state: CandleMarketStructureState): void {
  counts[state] = (counts[state] ?? 0) + 1;
}

function sortedCandles(candles: Candle[]): Candle[] {
  return [...candles]
    .filter((candle) =>
      Number.isFinite(candle.timestamp) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close),
    )
    .sort((left, right) => left.timestamp - right.timestamp);
}

function practicalTolerance(price: number): number {
  if (price < 1) {
    return Math.max(0.015, price * 0.025);
  }
  if (price < 2) {
    return Math.max(0.025, price * 0.02);
  }
  if (price < 10) {
    return Math.max(0.04, price * 0.012);
  }
  if (price < 50) {
    return Math.max(0.15, price * 0.008);
  }
  return Math.max(0.4, price * 0.006);
}

function stateImportance(state: CandleMarketStructureState): number {
  switch (state) {
    case "pivot_lost":
    case "reclaim_confirmed":
    case "breakout_holding":
    case "failed_breakout":
      return 0.32;
    case "trend_damaged":
    case "trend_intact":
    case "higher_lows_intact":
    case "breakout_attempt":
    case "pressing_range_high":
      return 0.24;
    case "base_building":
    case "range_bound":
      return 0.16;
    case "pullback_to_structure":
    case "reclaim_attempt":
      return 0.12;
    case "insufficient_data":
      return 0;
  }
}

function displacementScore(context: CandleMarketStructureContext): number {
  const pivotEvent = context.pivotEvent;
  const pivotPrice = pivotEvent?.triggerPrice;
  if (pivotPrice && pivotEvent.type !== "none") {
    return pivotEvent.confirmation === "confirmed" ? 0.14 : 0.08;
  }
  if (context.range?.active) {
    if (context.range.widthPct >= 0.08) {
      return 0.12;
    }
    if (context.range.widthPct >= 0.035) {
      return 0.08;
    }
  }
  return 0.03;
}

function normalizedDisplacementFromRange(context: CandleMarketStructureContext): number {
  if (!context.range) {
    return 0;
  }
  if (context.state === "pressing_range_high") {
    return 0.08;
  }
  if (context.state === "breakout_attempt" || context.state === "breakout_holding") {
    return 0.12;
  }
  if (context.state === "pullback_to_structure" || context.state === "pivot_lost") {
    return 0.1;
  }
  return 0;
}

export function scoreMarketStructureMateriality(params: {
  context: CandleMarketStructureContext;
  previousStableState: CandleMarketStructureState | null;
  rawRunLength: number;
}): number {
  const { context, previousStableState, rawRunLength } = params;
  let score = context.confidence.score * 0.34 + stateImportance(context.state);

  if (previousStableState !== context.state) {
    score += 0.08;
  }
  if (rawRunLength >= 2) {
    score += 0.08;
  }
  if (rawRunLength >= 3) {
    score += 0.08;
  }
  if (context.pivotEvent && context.pivotEvent.type !== "none") {
    score += 0.1;
  }
  score += displacementScore(context);
  score += normalizedDisplacementFromRange(context);

  if (context.confidence.label === "low") {
    score -= 0.22;
  }
  if (context.range?.quality === "choppy") {
    score -= 0.12;
  }
  if (context.state === "pullback_to_structure" && context.range?.active) {
    score -= 0.08;
  }
  if (rawRunLength === 1) {
    score -= 0.12;
  }

  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

function rawRunLength(contexts: CandleMarketStructureContext[], index: number): number {
  const state = contexts[index]!.state;
  let length = 1;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (contexts[cursor]!.state !== state) {
      break;
    }
    length += 1;
  }
  return length;
}

function isRangeChopContinuation(params: {
  context: CandleMarketStructureContext;
  stableState: CandleMarketStructureState;
}): boolean {
  const { context, stableState } = params;
  if (!context.range?.active) {
    return false;
  }
  if (context.range.quality !== "choppy" && context.range.widthPct > 0.035) {
    return false;
  }
  return (
    stableState === "range_bound" ||
    stableState === "base_building" ||
    stableState === "pullback_to_structure" ||
    context.state === "range_bound" ||
    context.state === "pullback_to_structure"
  );
}

function decideStableState(params: {
  context: CandleMarketStructureContext;
  previousStableState: CandleMarketStructureState | null;
  rawRunLength: number;
  materialityScore: number;
  persistenceBars: number;
  materialityThreshold: number;
  highMaterialityThreshold: number;
}): {
  stableState: CandleMarketStructureState;
  accepted: boolean;
  reason: StableMarketStructureDecisionReason;
} {
  const previousStableState = params.previousStableState;
  if (previousStableState === null) {
    return {
      stableState: params.context.state,
      accepted: true,
      reason: "initial_state",
    };
  }
  if (params.context.state === previousStableState) {
    return {
      stableState: previousStableState,
      accepted: false,
      reason: "same_state",
    };
  }
  if (params.context.confidence.label === "low") {
    return {
      stableState: previousStableState,
      accepted: false,
      reason: "low_confidence",
    };
  }
  if (isRangeChopContinuation({ context: params.context, stableState: previousStableState })) {
    return {
      stableState: previousStableState,
      accepted: false,
      reason: "range_chop_continuation",
    };
  }
  if (params.materialityScore >= params.highMaterialityThreshold) {
    return {
      stableState: params.context.state,
      accepted: true,
      reason: "high_materiality_change",
    };
  }
  if (params.rawRunLength < params.persistenceBars) {
    return {
      stableState: previousStableState,
      accepted: false,
      reason: "not_persistent",
    };
  }
  if (params.materialityScore < params.materialityThreshold) {
    return {
      stableState: previousStableState,
      accepted: false,
      reason: "immaterial_change",
    };
  }
  return {
    stableState: params.context.state,
    accepted: true,
    reason: "persistent_material_change",
  };
}

export function buildStableMarketStructureContext(
  request: BuildStableMarketStructureRequest,
): StableMarketStructureContext {
  const symbol = request.symbol.trim().toUpperCase();
  if (!symbol) {
    throw new Error("symbol is required.");
  }
  const candles = sortedCandles(request.candles);
  const minCandles = Math.max(6, request.minCandles ?? DEFAULT_MIN_CANDLES);
  const stepBars = Math.max(1, request.stepBars ?? DEFAULT_STEP_BARS);
  const persistenceBars = Math.max(1, request.persistenceBars ?? DEFAULT_PERSISTENCE_BARS);
  const materialityThreshold = request.materialityThreshold ?? DEFAULT_MATERIALITY_THRESHOLD;
  const highMaterialityThreshold = request.highMaterialityThreshold ?? DEFAULT_HIGH_MATERIALITY_THRESHOLD;
  const contexts: CandleMarketStructureContext[] = [];

  for (let end = minCandles; end <= candles.length; end += stepBars) {
    contexts.push(buildCandleMarketStructureContext({ symbol, candles: candles.slice(0, end) }));
  }

  const decisions: StableMarketStructureDecision[] = [];
  const stateCounts: Partial<Record<CandleMarketStructureState, number>> = {};
  const stableStateCounts: Partial<Record<CandleMarketStructureState, number>> = {};
  let previousRawState: CandleMarketStructureState | null = null;
  let previousStableState: CandleMarketStructureState | null = null;
  let rawTransitionCount = 0;
  let stableTransitionCount = 0;
  let suppressedTransitionCount = 0;

  for (const [index, context] of contexts.entries()) {
    increment(stateCounts, context.state);
    if (previousRawState !== null && previousRawState !== context.state) {
      rawTransitionCount += 1;
    }
    const runLength = rawRunLength(contexts, index);
    const materialityScore = scoreMarketStructureMateriality({
      context,
      previousStableState,
      rawRunLength: runLength,
    });
    const decision = decideStableState({
      context,
      previousStableState,
      rawRunLength: runLength,
      materialityScore,
      persistenceBars,
      materialityThreshold,
      highMaterialityThreshold,
    });

    if (
      previousStableState !== null &&
      context.state !== previousStableState &&
      decision.stableState === previousStableState
    ) {
      suppressedTransitionCount += 1;
    }
    if (previousStableState !== null && decision.stableState !== previousStableState) {
      stableTransitionCount += 1;
    }
    previousStableState = decision.stableState;
    previousRawState = context.state;
    increment(stableStateCounts, decision.stableState);
    decisions.push({
      timestamp: context.asOfTimestamp ?? 0,
      rawState: context.state,
      stableState: decision.stableState,
      previousStableState: decisions.at(-1)?.stableState ?? null,
      accepted: decision.accepted,
      materialityScore,
      rawRunLength: runLength,
      reason: decision.reason,
      context,
    });
  }

  return {
    symbol,
    current: decisions.at(-1) ?? null,
    rawTransitionCount,
    stableTransitionCount,
    suppressedTransitionCount,
    decisions,
    stateCounts,
    stableStateCounts,
  };
}
