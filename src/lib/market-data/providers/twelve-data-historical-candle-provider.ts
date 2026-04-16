import type { BaseCandleProviderResponse, Candle, CandleTimeframe } from "../candle-types.js";
import type { HistoricalCandleProvider, HistoricalFetchPlan, HistoricalFetchRequest } from "../provider-types.js";

type TwelveDataValuesRow = {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
};

type TwelveDataResponse = {
  values?: TwelveDataValuesRow[];
  status?: string;
  message?: string;
};

function parseTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Unable to parse Twelve Data timestamp: ${value}`);
  }

  return timestamp;
}

function mapValuesToCandles(rows: TwelveDataValuesRow[]): Candle[] {
  return rows
    .map((row) => ({
      timestamp: parseTimestamp(row.datetime),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: row.volume == null ? 0 : Number(row.volume),
    }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

export class TwelveDataHistoricalCandleProvider implements HistoricalCandleProvider {
  readonly providerName = "twelve_data" as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = "https://api.twelvedata.com/time_series",
  ) {}

  async fetchCandles(
    request: HistoricalFetchRequest,
    plan: HistoricalFetchPlan,
  ): Promise<BaseCandleProviderResponse> {
    if (!this.apiKey.trim()) {
      throw new Error("Twelve Data API key is required.");
    }

    const symbol = request.symbol.trim().toUpperCase();
    const url = new URL(this.baseUrl);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", plan.providerRequest.interval ?? this.mapInterval(request.timeframe));
    url.searchParams.set("outputsize", String(plan.providerRequest.outputSize ?? plan.plannedBarCount));
    url.searchParams.set("apikey", this.apiKey);
    url.searchParams.set("format", "JSON");

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Twelve Data request failed with HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as TwelveDataResponse;
    if (payload.status === "error" || !Array.isArray(payload.values)) {
      throw new Error(payload.message ?? `Twelve Data returned an invalid response for ${symbol}.`);
    }

    return {
      provider: this.providerName,
      symbol,
      timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars,
      candles: mapValuesToCandles(payload.values).slice(-plan.plannedBarCount),
      fetchStartTimestamp: Date.now(),
      fetchEndTimestamp: Date.now(),
      requestedStartTimestamp: plan.requestStartTimestamp,
      requestedEndTimestamp: plan.requestEndTimestamp,
      sessionMetadataAvailable: request.timeframe === "5m",
      providerMetadata: {
        endpoint: "twelve_data_time_series",
        interval: plan.providerRequest.interval ?? this.mapInterval(request.timeframe),
      },
    };
  }

  private mapInterval(timeframe: CandleTimeframe): string {
    switch (timeframe) {
      case "daily":
        return "1day";
      case "4h":
        return "4h";
      case "5m":
        return "5min";
    }
  }
}
