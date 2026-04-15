// 2026-04-14 08:05 PM America/Toronto
// Shared candle type definitions for the phase 1 levels engine.

export type CandleTimeframe = "daily" | "4h" | "5m";

export type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type CandleSeries = {
  symbol: string;
  timeframe: CandleTimeframe;
  candles: Candle[];
};

export type CandleProviderResponse = {
  symbol: string;
  timeframe: CandleTimeframe;
  candles: Candle[];
};
