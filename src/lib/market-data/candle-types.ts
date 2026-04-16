// 2026-04-14 08:05 PM America/Toronto
// Shared candle type definitions for the levels system market-data layer.

export type CandleTimeframe = "daily" | "4h" | "5m";

export type CandleProviderName = "ibkr" | "stub" | "twelve_data";

export type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type CandleSessionLabel =
  | "premarket"
  | "opening_range"
  | "regular"
  | "after_hours"
  | "extended"
  | "unknown";

export type CandleValidationSeverity = "warning" | "error";

export type CandleValidationCode =
  | "zero_results"
  | "insufficient_bars"
  | "out_of_order_timestamps"
  | "duplicate_timestamps"
  | "invalid_ohlc"
  | "suspicious_gap"
  | "stale_final_candle"
  | "missing_recent_candles"
  | "incomplete_current_session_data";

export type CandleValidationIssue = {
  code: CandleValidationCode;
  severity: CandleValidationSeverity;
  message: string;
};

export type CandleFetchCompletenessStatus = "complete" | "partial" | "empty";

export type CandleSessionSummary = {
  premarketBars: number;
  openingRangeBars: number;
  regularBars: number;
  afterHoursBars: number;
  extendedBars: number;
  unknownBars: number;
  latestRegularSessionDate: string | null;
};

export type BaseCandleProviderResponse = {
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleTimeframe;
  requestedLookbackBars: number;
  candles: Candle[];
  fetchStartTimestamp: number;
  fetchEndTimestamp: number;
  requestedStartTimestamp: number;
  requestedEndTimestamp: number;
  sessionMetadataAvailable: boolean;
  providerMetadata?: Record<string, string | number | boolean | null>;
};

export type CandleProviderResponse = BaseCandleProviderResponse & {
  actualBarsReturned: number;
  completenessStatus: CandleFetchCompletenessStatus;
  stale: boolean;
  validationIssues: CandleValidationIssue[];
  sessionSummary: CandleSessionSummary | null;
};

export type CandleSeries = {
  symbol: string;
  timeframe: CandleTimeframe;
  candles: Candle[];
};
