import type {
  BaseCandleProviderResponse,
  CandleProviderName,
  CandleFetchTimeframe,
} from "./candle-types.js";

export type HistoricalFetchRequest = {
  symbol: string;
  timeframe: CandleFetchTimeframe;
  lookbackBars: number;
  endTimeMs?: number;
  preferredProvider?: CandleProviderName;
};

export type HistoricalFetchPlan = {
  provider: CandleProviderName;
  timeframe: CandleFetchTimeframe;
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
