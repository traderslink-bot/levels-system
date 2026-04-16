// 2026-04-14 08:05 PM America/Toronto
// Candle fetch service with provider planning, validation, and diagnostics-ready output.

import type { BaseCandleProviderResponse, Candle, CandleProviderResponse, CandleProviderName } from "./candle-types.js";
import { finalizeCandleProviderResponse } from "./candle-quality.js";
import { buildHistoricalFetchPlan } from "./fetch-planning.js";
import { createHistoricalCandleProvider, type HistoricalProviderFactoryOptions } from "./provider-factory.js";
import type { HistoricalCandleProvider, HistoricalFetchRequest } from "./provider-types.js";

export type { HistoricalCandleProvider, HistoricalFetchRequest } from "./provider-types.js";

export type CandleFetchServiceOptions = Omit<HistoricalProviderFactoryOptions, "provider"> & {
  provider?: HistoricalCandleProvider;
  providerName?: CandleProviderName;
};

function seededNumber(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function timeframeBasePrice(timeframe: HistoricalFetchRequest["timeframe"]): number {
  switch (timeframe) {
    case "daily":
      return 4.2;
    case "4h":
      return 4.6;
    case "5m":
      return 4.8;
  }
}

function generateStubCandles(request: HistoricalFetchRequest): Candle[] {
  const now = request.endTimeMs ?? Date.now();
  const spacingMs =
    request.timeframe === "daily"
      ? 24 * 60 * 60 * 1000
      : request.timeframe === "4h"
        ? 4 * 60 * 60 * 1000
        : 5 * 60 * 1000;

  let price = timeframeBasePrice(request.timeframe);
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

  return candles;
}

function buildStubProviderResponse(request: HistoricalFetchRequest): BaseCandleProviderResponse {
  const requestEndTimestamp = request.endTimeMs ?? Date.now();
  const intervalMs =
    request.timeframe === "daily"
      ? 24 * 60 * 60 * 1000
      : request.timeframe === "4h"
        ? 4 * 60 * 60 * 1000
        : 5 * 60 * 1000;

  return {
    provider: "stub",
    symbol: request.symbol.toUpperCase(),
    timeframe: request.timeframe,
    requestedLookbackBars: request.lookbackBars,
    candles: generateStubCandles(request),
    fetchStartTimestamp: Date.now(),
    fetchEndTimestamp: Date.now(),
    requestedStartTimestamp: requestEndTimestamp - request.lookbackBars * intervalMs,
    requestedEndTimestamp: requestEndTimestamp,
    sessionMetadataAvailable: request.timeframe === "5m",
    providerMetadata: {
      source: "deterministic_stub",
    },
  };
}

export class StubHistoricalCandleProvider implements HistoricalCandleProvider {
  readonly providerName = "stub" as const;

  async fetchCandles(request: HistoricalFetchRequest): Promise<BaseCandleProviderResponse> {
    return buildStubProviderResponse(request);
  }
}

export class CandleFetchService {
  private readonly provider: HistoricalCandleProvider;

  constructor(providerOrOptions: HistoricalCandleProvider | CandleFetchServiceOptions) {
    if ("fetchCandles" in providerOrOptions) {
      this.provider = providerOrOptions;
      return;
    }

    this.provider =
      providerOrOptions.provider ??
      createHistoricalCandleProvider({
        provider: providerOrOptions.providerName,
        ib: providerOrOptions.ib,
        twelveDataApiKey: providerOrOptions.twelveDataApiKey,
      });
  }

  getProviderName(): CandleProviderName {
    return this.provider.providerName;
  }

  async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    if (!request.symbol.trim()) {
      throw new Error("symbol is required.");
    }

    if (!Number.isInteger(request.lookbackBars) || request.lookbackBars <= 0) {
      throw new Error("lookbackBars must be greater than zero.");
    }

    const plan = buildHistoricalFetchPlan(request, request.preferredProvider ?? this.provider.providerName);
    const baseResponse = await this.provider.fetchCandles(request, plan);
    return finalizeCandleProviderResponse(baseResponse);
  }
}
