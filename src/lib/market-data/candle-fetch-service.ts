// 2026-04-14 08:05 PM America/Toronto
// Phase 1 fetch service. This includes a deterministic stub so the project runs before a real provider is wired in.

import type { Candle, CandleProviderResponse, CandleTimeframe } from "./candle-types.js";

export type HistoricalFetchRequest = {
  symbol: string;
  timeframe: CandleTimeframe;
  lookbackBars: number;
};

export interface HistoricalCandleProvider {
  fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse>;
}

function seededNumber(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function generateStubCandles(request: HistoricalFetchRequest): CandleProviderResponse {
  const now = Date.now();
  const spacingMs =
    request.timeframe === "daily"
      ? 24 * 60 * 60 * 1000
      : request.timeframe === "4h"
        ? 4 * 60 * 60 * 1000
        : 5 * 60 * 1000;

  let price = request.timeframe === "daily" ? 4.2 : request.timeframe === "4h" ? 4.6 : 4.8;
  const candles: Candle[] = [];

  for (let i = request.lookbackBars - 1; i >= 0; i -= 1) {
    const seed = (i + 1) * request.symbol.length * 17;
    const drift = (seededNumber(seed) - 0.48) * (request.timeframe === "daily" ? 0.18 : 0.08);
    const range = 0.04 + seededNumber(seed + 3) * 0.22;
    const open = Math.max(0.05, price);
    const close = Math.max(0.05, open + drift);
    const high = Math.max(open, close) + range * 0.6;
    const low = Math.max(0.01, Math.min(open, close) - range * 0.4);
    const volume = Math.round(150000 + seededNumber(seed + 7) * 700000);
    const timestamp = now - i * spacingMs;

    candles.push({
      timestamp,
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
      volume,
    });

    price = close + (seededNumber(seed + 11) - 0.5) * 0.05;
  }

  return {
    symbol: request.symbol.toUpperCase(),
    timeframe: request.timeframe,
    candles,
  };
}

export class StubHistoricalCandleProvider implements HistoricalCandleProvider {
  async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    return generateStubCandles(request);
  }
}

export class CandleFetchService {
  constructor(private readonly provider: HistoricalCandleProvider) {}

  async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    if (request.lookbackBars <= 0) {
      throw new Error("lookbackBars must be greater than zero.");
    }

    return this.provider.fetchCandles(request);
  }
}
