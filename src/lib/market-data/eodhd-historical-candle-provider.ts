import type { BaseCandleProviderResponse, Candle, CandleFetchTimeframe } from "./candle-types.js";
import { classifyIntradayCandleTimestamp } from "./candle-session-classifier.js";
import type { HistoricalCandleProvider, HistoricalFetchPlan, HistoricalFetchRequest } from "./provider-types.js";

export type EodhdHistoricalCandleProviderOptions = {
  apiToken?: string;
  exchangeSuffix?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
};

type EodhdIntradayBar = {
  timestamp?: unknown;
  datetime?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
};

type EodhdDailyBar = {
  date?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  adjusted_close?: unknown;
  volume?: unknown;
};

const DEFAULT_BASE_URL = "https://eodhd.com/api";
const DEFAULT_EXCHANGE_SUFFIX = "US";
const ADJUSTMENT_MODE = "adjusted_close_ratio";

type EodhdCandleFetchResult = {
  candles: Candle[];
  droppedInvalidOhlcBars: number;
};

function envText(...names: string[]): string | undefined {
  return names.map((name) => process.env[name]?.trim()).find(Boolean);
}

function toFiniteNumber(value: unknown, field: string, symbol: string): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`EODHD returned invalid ${field} for ${symbol}: ${String(value)}`);
  }
  return numberValue;
}

function toVolume(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.round(numberValue) : 0;
}

function roundAdjustedPrice(value: number): number {
  return Number(value.toFixed(6));
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function eodDateTimestamp(date: unknown, symbol: string): number {
  const timestamp = Date.parse(`${String(date)}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`EODHD returned invalid daily date for ${symbol}: ${String(date)}`);
  }
  return timestamp;
}

function dailyAdjustmentFactor(bar: EodhdDailyBar, symbol: string): number {
  const close = toFiniteNumber(bar.close, "close", symbol);
  if (bar.adjusted_close === undefined || bar.adjusted_close === null) {
    return 1;
  }

  const adjustedClose = toFiniteNumber(bar.adjusted_close, "adjusted_close", symbol);
  return adjustedClose > 0 && close > 0 ? adjustedClose / close : 1;
}

function normalizeEodhdSymbol(symbol: string, exchangeSuffix: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    throw new Error("symbol is required.");
  }
  return normalized.includes(".") ? normalized : `${normalized}.${exchangeSuffix}`;
}

function eodhdInterval(timeframe: CandleFetchTimeframe): "1m" | "5m" | "1h" {
  if (timeframe === "1m") {
    return "1m";
  }
  if (timeframe === "5m") {
    return "5m";
  }
  return "1h";
}

function eodhdSourceIntervalMs(timeframe: CandleFetchTimeframe): number {
  if (timeframe === "1m") {
    return 60_000;
  }
  if (timeframe === "5m") {
    return 5 * 60_000;
  }
  return 60 * 60_000;
}

function aggregateHourlyToFourHour(candles: Candle[]): Candle[] {
  const bySessionDate = new Map<string, Candle[]>();

  for (const candle of candles) {
    const sessionDate = classifyIntradayCandleTimestamp(candle.timestamp).sessionDate;
    bySessionDate.set(sessionDate, [...(bySessionDate.get(sessionDate) ?? []), candle]);
  }

  const aggregated: Candle[] = [];

  for (const sessionCandles of bySessionDate.values()) {
    const sorted = [...sessionCandles].sort((left, right) => left.timestamp - right.timestamp);

    for (let index = 0; index < sorted.length; index += 4) {
      const bucketCandles = sorted.slice(index, index + 4);
      aggregated.push({
        timestamp: bucketCandles[0]!.timestamp,
        open: bucketCandles[0]!.open,
        high: Math.max(...bucketCandles.map((candle) => candle.high)),
        low: Math.min(...bucketCandles.map((candle) => candle.low)),
        close: bucketCandles.at(-1)!.close,
        volume: bucketCandles.reduce((sum, candle) => sum + candle.volume, 0),
      });
    }
  }

  return aggregated.sort((left, right) => left.timestamp - right.timestamp);
}

function hasTradableOhlc(candle: Candle): boolean {
  return (
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume) &&
    candle.high >= candle.low &&
    candle.high >= candle.open &&
    candle.high >= candle.close &&
    candle.low <= candle.open &&
    candle.low <= candle.close &&
    candle.open > 0 &&
    candle.high > 0 &&
    candle.low > 0 &&
    candle.close > 0 &&
    candle.volume >= 0
  );
}

function filterInvalidOhlcCandles(candles: Candle[]): EodhdCandleFetchResult {
  const filtered = candles.filter(hasTradableOhlc);

  return {
    candles: filtered,
    droppedInvalidOhlcBars: candles.length - filtered.length,
  };
}

export class EodhdHistoricalCandleProvider implements HistoricalCandleProvider {
  readonly providerName = "eodhd" as const;

  private readonly apiToken: string;
  private readonly exchangeSuffix: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: EodhdHistoricalCandleProviderOptions = {}) {
    const apiToken = options.apiToken ?? envText("EODHD_API_TOKEN", "LEVEL_EODHD_API_TOKEN");
    if (!apiToken) {
      throw new Error("EODHD_API_TOKEN is required to use the EODHD historical candle provider.");
    }

    this.apiToken = apiToken;
    this.exchangeSuffix = options.exchangeSuffix ?? envText("EODHD_EXCHANGE_SUFFIX", "LEVEL_EODHD_EXCHANGE_SUFFIX") ?? DEFAULT_EXCHANGE_SUFFIX;
    this.baseUrl = options.baseUrl ?? envText("EODHD_BASE_URL", "LEVEL_EODHD_BASE_URL") ?? DEFAULT_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async fetchCandles(
    request: HistoricalFetchRequest,
    plan: HistoricalFetchPlan,
  ): Promise<BaseCandleProviderResponse> {
    const symbol = request.symbol.trim().toUpperCase();
    const eodhdSymbol = normalizeEodhdSymbol(symbol, this.exchangeSuffix);
    const fetchStartTimestamp = Date.now();
    const result = request.timeframe === "daily"
      ? await this.fetchDailyCandles(eodhdSymbol, symbol, plan)
      : await this.fetchIntradayCandles(eodhdSymbol, symbol, request.timeframe, plan);
    const fetchEndTimestamp = Date.now();
    const sorted = result.candles.sort((left, right) => left.timestamp - right.timestamp).slice(-plan.plannedBarCount);

    return {
      provider: this.providerName,
      symbol,
      timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars,
      candles: sorted,
      fetchStartTimestamp,
      fetchEndTimestamp,
      requestedStartTimestamp: plan.requestStartTimestamp,
      requestedEndTimestamp: plan.requestEndTimestamp,
      sessionMetadataAvailable: plan.sessionMetadataAvailable,
      providerMetadata: {
        eodhdSymbol,
        eodhdInterval: request.timeframe === "daily" ? "d" : eodhdInterval(request.timeframe),
        eodhdExchangeSuffix: this.exchangeSuffix,
        providerAdjustmentMode: ADJUSTMENT_MODE,
        eodhdDroppedInvalidOhlcBars: result.droppedInvalidOhlcBars,
        useRTH: false,
      },
    };
  }

  private async fetchDailyBars(
    eodhdSymbol: string,
    fromTimestamp: number,
    toTimestamp: number,
  ): Promise<EodhdDailyBar[]> {
    const url = this.buildUrl(`/eod/${encodeURIComponent(eodhdSymbol)}`, {
      fmt: "json",
      period: "d",
      from: isoDate(fromTimestamp),
      to: isoDate(toTimestamp),
    });
    return this.fetchJson<EodhdDailyBar[]>(url);
  }

  private async fetchDailyCandles(
    eodhdSymbol: string,
    requestedSymbol: string,
    plan: HistoricalFetchPlan,
  ): Promise<EodhdCandleFetchResult> {
    const payload = await this.fetchDailyBars(
      eodhdSymbol,
      plan.requestStartTimestamp,
      plan.requestEndTimestamp,
    );

    const candles = payload.map((bar) => {
      const timestamp = eodDateTimestamp(bar.date, requestedSymbol);

      return this.mapCandle({
        symbol: requestedSymbol,
        timestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        adjustedClose: bar.adjusted_close,
        volume: bar.volume,
      });
    });

    return filterInvalidOhlcCandles(candles);
  }

  private async fetchDailyAdjustmentFactors(
    eodhdSymbol: string,
    requestedSymbol: string,
    fromTimestamp: number,
    toTimestamp: number,
  ): Promise<Map<string, number>> {
    const payload = await this.fetchDailyBars(
      eodhdSymbol,
      fromTimestamp,
      toTimestamp,
    );
    const factors = new Map<string, number>();

    for (const bar of payload) {
      if (bar.date === undefined || bar.date === null) {
        continue;
      }

      eodDateTimestamp(bar.date, requestedSymbol);
      factors.set(String(bar.date), dailyAdjustmentFactor(bar, requestedSymbol));
    }

    return factors;
  }

  private intradayAdjustmentFactor(
    timestamp: number,
    adjustmentFactorsBySessionDate: Map<string, number>,
  ): number {
    const sessionDate = classifyIntradayCandleTimestamp(timestamp).sessionDate;
    return adjustmentFactorsBySessionDate.get(sessionDate) ?? 1;
  }

  private async fetchIntradayCandles(
    eodhdSymbol: string,
    requestedSymbol: string,
    timeframe: CandleFetchTimeframe,
    plan: HistoricalFetchPlan,
  ): Promise<EodhdCandleFetchResult> {
    const interval = eodhdInterval(timeframe);
    const intervalMultiplier = timeframe === "4h" ? 4 : 1;
    const expandedStartTimestamp = timeframe === "4h"
      ? plan.requestStartTimestamp - (intervalMultiplier - 1) * eodhdSourceIntervalMs(timeframe)
      : plan.requestStartTimestamp;
    const url = this.buildUrl(`/intraday/${encodeURIComponent(eodhdSymbol)}`, {
      fmt: "json",
      interval,
      from: String(Math.floor(expandedStartTimestamp / 1000)),
      to: String(Math.floor(plan.requestEndTimestamp / 1000)),
    });
    const payload = await this.fetchJson<EodhdIntradayBar[]>(url);
    const adjustmentFactorsBySessionDate = await this.fetchDailyAdjustmentFactors(
      eodhdSymbol,
      requestedSymbol,
      expandedStartTimestamp - 24 * 60 * 60 * 1000,
      plan.requestEndTimestamp + 24 * 60 * 60 * 1000,
    );
    const mappedCandles = payload.map((bar) =>
      this.mapIntradayBar(bar, requestedSymbol, adjustmentFactorsBySessionDate),
    );
    const filtered = filterInvalidOhlcCandles(mappedCandles);

    return {
      candles: timeframe === "4h" ? aggregateHourlyToFourHour(filtered.candles) : filtered.candles,
      droppedInvalidOhlcBars: filtered.droppedInvalidOhlcBars,
    };
  }

  private mapIntradayBar(
    bar: EodhdIntradayBar,
    symbol: string,
    adjustmentFactorsBySessionDate: Map<string, number>,
  ): Candle {
    const timestampSeconds = typeof bar.timestamp === "number" ? bar.timestamp : Number(bar.timestamp);
    const timestamp = Number.isFinite(timestampSeconds)
      ? timestampSeconds * 1000
      : this.parseEodhdUtcDatetime(bar.datetime);
    if (!Number.isFinite(timestamp)) {
      throw new Error(`EODHD returned invalid intraday timestamp for ${symbol}: ${String(bar.timestamp ?? bar.datetime)}`);
    }

    return this.mapCandle({
      symbol,
      timestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      adjustmentFactor: this.intradayAdjustmentFactor(timestamp, adjustmentFactorsBySessionDate),
      volume: bar.volume,
    });
  }

  private parseEodhdUtcDatetime(datetime: unknown): number {
    if (typeof datetime !== "string" || !datetime.trim()) {
      return Number.NaN;
    }
    return Date.parse(`${datetime.trim().replace(" ", "T")}Z`);
  }

  private mapCandle(params: {
    symbol: string;
    timestamp: number;
    open: unknown;
    high: unknown;
    low: unknown;
    close: unknown;
    adjustedClose?: unknown;
    adjustmentFactor?: number;
    volume: unknown;
  }): Candle {
    const close = toFiniteNumber(params.close, "close", params.symbol);
    const adjustedClose =
      params.adjustedClose === undefined || params.adjustedClose === null
        ? Number.NaN
        : toFiniteNumber(params.adjustedClose, "adjusted_close", params.symbol);
    const adjustmentFactor =
      Number.isFinite(adjustedClose) && adjustedClose > 0 && close > 0
        ? adjustedClose / close
        : Number.isFinite(params.adjustmentFactor) && params.adjustmentFactor! > 0
        ? params.adjustmentFactor!
        : 1;

    return {
      timestamp: params.timestamp,
      open: roundAdjustedPrice(toFiniteNumber(params.open, "open", params.symbol) * adjustmentFactor),
      high: roundAdjustedPrice(toFiniteNumber(params.high, "high", params.symbol) * adjustmentFactor),
      low: roundAdjustedPrice(toFiniteNumber(params.low, "low", params.symbol) * adjustmentFactor),
      close: roundAdjustedPrice(close * adjustmentFactor),
      volume: toVolume(params.volume),
    };
  }

  private buildUrl(path: string, params: Record<string, string>): string {
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}${path}`);
    url.searchParams.set("api_token", this.apiToken);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await this.fetchFn(url);
    if (!response.ok) {
      throw new Error(`EODHD request failed with HTTP ${response.status}.`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      const message = this.extractErrorPayloadMessage(payload);
      if (message) {
        throw new Error(`EODHD returned an error payload: ${message}`);
      }
      throw new Error("EODHD returned a non-array candle payload.");
    }
    return payload as T;
  }

  private extractErrorPayloadMessage(payload: unknown): string | null {
    if (payload === null || typeof payload !== "object") {
      return null;
    }

    const record = payload as Record<string, unknown>;
    const message = record.error ?? record.message;
    return typeof message === "string" && message.trim() ? message.trim() : null;
  }
}
