import type {
  BaseCandleProviderResponse,
  CandleProviderName,
  CandleTimeframe,
  ProviderCandleTimeframe,
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

export type ProviderHistoricalFetchRequest = Omit<HistoricalFetchRequest, "timeframe"> & {
  timeframe: ProviderCandleTimeframe;
};

export type ProviderHistoricalFetchPlan = Omit<HistoricalFetchPlan, "timeframe"> & {
  timeframe: ProviderCandleTimeframe;
};

export type BaseProviderCandleResponse = Omit<BaseCandleProviderResponse, "timeframe"> & {
  timeframe: ProviderCandleTimeframe;
};

export interface HistoricalCandleProvider {
  readonly providerName: CandleProviderName;
  fetchCandles(
    request: HistoricalFetchRequest,
    plan: HistoricalFetchPlan,
  ): Promise<BaseCandleProviderResponse>;
}
