// 2026-05-02 America/Toronto
// Runtime bridge from live price ticks into stable 5-minute candle market-structure facts.

import type { Candle } from "../market-data/candle-types.js";
import {
  buildStableMarketStructureContext,
  type StableMarketStructureDecision,
} from "../structure/index.js";
import type { LivePriceUpdate, StableMarketStructureRuntimeContext } from "./monitoring-types.js";

export type LiveStableMarketStructureTrackerOptions = {
  bucketMs?: number;
  minCandles?: number;
  maxCandles?: number;
  persistenceBars?: number;
  materialityThreshold?: number;
  highMaterialityThreshold?: number;
};

type SymbolStructureState = {
  completedCandles: Candle[];
  currentCandle?: Candle;
  lastCumulativeVolume?: number;
  context?: StableMarketStructureRuntimeContext;
};

const DEFAULT_BUCKET_MS = 5 * 60 * 1000;
const DEFAULT_MIN_CANDLES = 12;
const DEFAULT_MAX_CANDLES = 96;

function bucketStart(timestamp: number, bucketMs: number): number {
  return Math.floor(timestamp / bucketMs) * bucketMs;
}

function roundPrice(value: number): string {
  if (value >= 10) {
    return value.toFixed(2);
  }
  if (value >= 1) {
    return value.toFixed(3);
  }
  return value.toFixed(4);
}

function volumeDelta(update: LivePriceUpdate, state: SymbolStructureState): number {
  const volume = update.volume;
  if (!Number.isFinite(volume) || volume === undefined || volume < 0) {
    return 0;
  }
  if (state.lastCumulativeVolume === undefined) {
    state.lastCumulativeVolume = volume;
    return 0;
  }
  if (volume < state.lastCumulativeVolume) {
    state.lastCumulativeVolume = volume;
    return 0;
  }
  const delta = volume - state.lastCumulativeVolume;
  state.lastCumulativeVolume = volume;
  return Number.isFinite(delta) && delta > 0 ? delta : 0;
}

function buildStructureKey(decision: StableMarketStructureDecision): string {
  const context = decision.context;
  const range = context.range;
  if (range?.active) {
    return `${decision.stableState}|range:${roundPrice(range.low)}-${roundPrice(range.high)}`;
  }

  const latestLow = context.pivots.latestSwingLow?.price;
  const latestHigh = context.pivots.latestSwingHigh?.price;
  if (latestLow !== undefined || latestHigh !== undefined) {
    return `${decision.stableState}|low:${latestLow !== undefined ? roundPrice(latestLow) : "none"}|high:${latestHigh !== undefined ? roundPrice(latestHigh) : "none"}`;
  }

  return `${decision.stableState}|candles:${decision.context.asOfTimestamp ?? decision.timestamp}`;
}

function buildRuntimeContext(
  decision: StableMarketStructureDecision,
  candleCount: number,
): StableMarketStructureRuntimeContext {
  const previousState = decision.previousStableState;
  return {
    state: decision.stableState,
    previousState,
    structureKey: buildStructureKey(decision),
    materialChange:
      decision.accepted &&
      previousState !== null &&
      previousState !== decision.stableState,
    confidence: decision.context.confidence.label,
    materialityScore: decision.materialityScore,
    rawState: decision.rawState,
    reason: decision.reason,
    candleCount,
  };
}

export class LiveStableMarketStructureTracker {
  private readonly bucketMs: number;
  private readonly minCandles: number;
  private readonly maxCandles: number;
  private readonly states = new Map<string, SymbolStructureState>();

  constructor(private readonly options: LiveStableMarketStructureTrackerOptions = {}) {
    this.bucketMs = options.bucketMs ?? DEFAULT_BUCKET_MS;
    this.minCandles = Math.max(6, options.minCandles ?? DEFAULT_MIN_CANDLES);
    this.maxCandles = Math.max(this.minCandles, options.maxCandles ?? DEFAULT_MAX_CANDLES);
  }

  reset(symbol: string): void {
    this.states.delete(symbol.toUpperCase());
  }

  getContext(symbol: string): StableMarketStructureRuntimeContext | undefined {
    return this.states.get(symbol.toUpperCase())?.context;
  }

  update(update: LivePriceUpdate): StableMarketStructureRuntimeContext | undefined {
    if (
      !Number.isFinite(update.timestamp) ||
      !Number.isFinite(update.lastPrice) ||
      update.lastPrice <= 0
    ) {
      return this.getContext(update.symbol);
    }

    const symbol = update.symbol.toUpperCase();
    const state = this.ensureState(symbol);
    const start = bucketStart(update.timestamp, this.bucketMs);
    const deltaVolume = volumeDelta(update, state);

    if (!state.currentCandle) {
      state.currentCandle = this.buildNewCandle(start, update.lastPrice, deltaVolume);
      return this.recompute(symbol, state);
    }

    if (start > state.currentCandle.timestamp) {
      state.completedCandles.push(state.currentCandle);
      state.completedCandles = state.completedCandles.slice(-this.maxCandles);
      state.currentCandle = this.buildNewCandle(start, update.lastPrice, deltaVolume);
      return this.recompute(symbol, state);
    }

    if (start < state.currentCandle.timestamp) {
      return state.context;
    }

    state.currentCandle.high = Math.max(state.currentCandle.high, update.lastPrice);
    state.currentCandle.low = Math.min(state.currentCandle.low, update.lastPrice);
    state.currentCandle.close = update.lastPrice;
    state.currentCandle.volume += deltaVolume;
    return this.recompute(symbol, state);
  }

  private recompute(
    symbol: string,
    state: SymbolStructureState,
  ): StableMarketStructureRuntimeContext | undefined {
    const candles = [
      ...state.completedCandles,
      ...(state.currentCandle ? [state.currentCandle] : []),
    ].slice(-this.maxCandles);
    if (candles.length < this.minCandles) {
      return state.context;
    }

    const stable = buildStableMarketStructureContext({
      symbol,
      candles,
      minCandles: this.minCandles,
      persistenceBars: this.options.persistenceBars,
      materialityThreshold: this.options.materialityThreshold,
      highMaterialityThreshold: this.options.highMaterialityThreshold,
    });
    if (!stable.current) {
      return state.context;
    }

    state.context = buildRuntimeContext(stable.current, candles.length);
    return state.context;
  }

  private buildNewCandle(timestamp: number, price: number, volume: number): Candle {
    return {
      timestamp,
      open: price,
      high: price,
      low: price,
      close: price,
      volume,
    };
  }

  private ensureState(symbol: string): SymbolStructureState {
    const normalized = symbol.toUpperCase();
    const existing = this.states.get(normalized);
    if (existing) {
      return existing;
    }

    const created: SymbolStructureState = {
      completedCandles: [],
    };
    this.states.set(normalized, created);
    return created;
  }
}
