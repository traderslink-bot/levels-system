import type {
  BaseCandleProviderResponse,
  CandleProviderName,
  CandleTimeframe,
} from "./candle-types.js";

export type HistoricalFetchRequest = {
  symbol: string;
  timeframe: CandleTimeframe;
  lookbackBars: number;
  endTimeMs?: number;
  preferredProvider?: CandleProviderName;
};

export type HistoricalFetchPlan = {
  provider: CandleProviderName;
  timeframe: CandleTimeframe;
  requestedLookbackBars: number;
  plannedBarCount: number;
  requestStartTimestamp: number;
  requestEndTimestamp: number;
  intervalMs: number;
  sessionMetadataAvailable: boolean;
  providerRequest: {
    barSizeSetting: string;
    durationStr?: string;
    interval?: string;
    outputSize?: number;
  };
};

export interface HistoricalCandleProvider {
  readonly providerName: CandleProviderName;
  fetchCandles(
    request: HistoricalFetchRequest,
    plan: HistoricalFetchPlan,
  ): Promise<BaseCandleProviderResponse>;
}
