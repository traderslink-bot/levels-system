// 2026-04-14 08:05 PM America/Toronto
// Provider response normalization helpers for candle data.

import type { Candle, CandleProviderResponse, CandleTimeframe } from "./candle-types.js";

type GenericProviderCandle = {
  datetime?: string | number;
  timestamp?: string | number;
  time?: string | number;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume?: number | string | null;
};

function toTimestamp(value: string | number | undefined): number {
  if (value === undefined) {
    throw new Error("Missing candle timestamp value.");
  }

  if (typeof value === "number") {
    return value > 10_000_000_000 ? value : value * 1000;
  }

  const asNumber = Number(value);
  if (!Number.isNaN(asNumber)) {
    return asNumber > 10_000_000_000 ? asNumber : asNumber * 1000;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Unable to parse candle timestamp: ${value}`);
  }

  return parsed;
}

export function normalizeGenericProviderCandles(
  symbol: string,
  timeframe: CandleTimeframe,
  rows: GenericProviderCandle[],
): CandleProviderResponse {
  const candles: Candle[] = rows.map((row) => ({
    timestamp: toTimestamp(row.datetime ?? row.timestamp ?? row.time),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: row.volume == null ? 0 : Number(row.volume),
  }));

  candles.sort((a, b) => a.timestamp - b.timestamp);

  return {
    symbol,
    timeframe,
    candles,
  };
}
