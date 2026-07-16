import type { Candle } from "../market-data/candle-types.js";
import type { LivePriceUpdate } from "./monitoring-types.js";

const FIVE_MINUTE_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CANDLES = 160;

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundVolume(value: number | undefined): number {
  return isPositiveNumber(value) ? Math.round(value) : 0;
}

function bucketTimestamp(timestamp: number, bucketMs: number): number {
  return Math.floor(timestamp / bucketMs) * bucketMs;
}

function uniqueSortedCandles(candles: Candle[]): Candle[] {
  const byTimestamp = new Map<number, Candle>();
  for (const candle of candles) {
    if (!isPositiveNumber(candle.open) || !isPositiveNumber(candle.high) || !isPositiveNumber(candle.low) || !isPositiveNumber(candle.close)) {
      continue;
    }
    byTimestamp.set(candle.timestamp, { ...candle, volume: Math.max(0, Math.round(candle.volume)) });
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

export class LiveDerivedFiveMinuteCandleStore {
  private readonly candlesBySymbol = new Map<string, Candle[]>();
  private readonly lastCumulativeVolumeBySymbol = new Map<string, number>();
  private readonly bucketMs: number;
  private readonly maxCandles: number;

  constructor(options: { bucketMs?: number; maxCandles?: number } = {}) {
    this.bucketMs = Math.max(1, Math.floor(options.bucketMs ?? FIVE_MINUTE_MS));
    this.maxCandles = Math.max(1, Math.floor(options.maxCandles ?? DEFAULT_MAX_CANDLES));
  }

  setHistoricalCandles(symbolInput: string, candles: Candle[]): Candle[] {
    const symbol = normalizeSymbol(symbolInput);
    const existing = this.candlesBySymbol.get(symbol) ?? [];
    const merged = this.trim(uniqueSortedCandles([...existing, ...candles]));
    this.candlesBySymbol.set(symbol, merged);
    return merged.map((candle) => ({ ...candle }));
  }

  updateFromLivePrice(update: LivePriceUpdate): Candle[] {
    const symbol = normalizeSymbol(update.symbol);
    if (!symbol || !isPositiveNumber(update.lastPrice) || !Number.isFinite(update.timestamp)) {
      return this.getCandles(symbol);
    }

    const timestamp = bucketTimestamp(update.timestamp, this.bucketMs);
    const volume = this.liveVolumeDelta(symbol, update.volume);
    const candles = this.candlesBySymbol.get(symbol) ?? [];
    const existingIndex = candles.findIndex((candle) => candle.timestamp === timestamp);

    if (existingIndex === -1) {
      candles.push({
        timestamp,
        open: update.lastPrice,
        high: update.lastPrice,
        low: update.lastPrice,
        close: update.lastPrice,
        volume,
      });
    } else {
      const existing = candles[existingIndex]!;
      candles[existingIndex] = {
        timestamp,
        open: existing.open,
        high: Math.max(existing.high, update.lastPrice),
        low: Math.min(existing.low, update.lastPrice),
        close: update.lastPrice,
        volume: existing.volume + volume,
      };
    }

    const merged = this.trim(uniqueSortedCandles(candles));
    this.candlesBySymbol.set(symbol, merged);
    return merged.map((candle) => ({ ...candle }));
  }

  getCandles(symbolInput: string): Candle[] {
    const symbol = normalizeSymbol(symbolInput);
    return (this.candlesBySymbol.get(symbol) ?? []).map((candle) => ({ ...candle }));
  }

  clear(symbolInput: string): void {
    const symbol = normalizeSymbol(symbolInput);
    this.candlesBySymbol.delete(symbol);
    this.lastCumulativeVolumeBySymbol.delete(symbol);
  }

  clearAll(): void {
    this.candlesBySymbol.clear();
    this.lastCumulativeVolumeBySymbol.clear();
  }

  private liveVolumeDelta(symbol: string, cumulativeVolume: number | undefined): number {
    const volume = roundVolume(cumulativeVolume);
    if (volume <= 0) {
      return 0;
    }

    const previous = this.lastCumulativeVolumeBySymbol.get(symbol);
    this.lastCumulativeVolumeBySymbol.set(symbol, volume);
    if (previous === undefined || volume < previous) {
      return 0;
    }

    return Math.max(0, volume - previous);
  }

  private trim(candles: Candle[]): Candle[] {
    return candles.slice(-this.maxCandles);
  }
}
