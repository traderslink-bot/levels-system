import type { BaseCandleProviderResponse, Candle, CandleFetchTimeframe, CandleTimeframe } from "./candle-types.js";
import type { HistoricalCandleProvider, HistoricalFetchPlan, HistoricalFetchRequest } from "./provider-types.js";

export type EodhdHistoricalCandleProviderOptions = {
  apiToken?: string;
  exchangeSuffix?: string;
  baseUrl?: string;
  yahooBaseUrl?: string;
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

type EodhdSplitEvent = {
  date?: unknown;
  split?: unknown;
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[] | null;
      indicators?: {
        quote?: Array<{
          open?: Array<number | null> | null;
          high?: Array<number | null> | null;
          low?: Array<number | null> | null;
          close?: Array<number | null> | null;
          volume?: Array<number | null> | null;
        }> | null;
      };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
};

const DEFAULT_BASE_URL = "https://eodhd.com/api";
const DEFAULT_YAHOO_BASE_URL = "https://query1.finance.yahoo.com";
const DEFAULT_EXCHANGE_SUFFIX = "US";
const ADJUSTMENT_MODE = "adjusted_close_ratio";
const NEW_YORK_TIMEZONE = "America/New_York";
const EXTREME_PRICE_DISCONTINUITY_RATIO = 4;
const SPLIT_RATIO_MATCH_TOLERANCE = 1.75;
const sessionDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: NEW_YORK_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type EodhdCandleFetchResult = {
  candles: Candle[];
  droppedInvalidOhlcBars: number;
  incompleteFourHourBuckets?: number;
  droppedOffSessionFourHourBars?: number;
  priceBasisSource?: "eodhd_adjusted_close_ratio" | "yahoo_current_basis_fallback";
  splitBasisMismatch?: EodhdSplitBasisMismatch;
};

type EodhdSplitBasisMismatch = {
  splitDate: string;
  expectedPriceMultiplier: number;
  observedPriceRatio: number;
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

function intradaySessionDate(timestamp: number): string {
  const parts = sessionDateFormatter.formatToParts(new Date(timestamp));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function intradayMinuteOfDay(timestamp: number): number {
  const parts = sessionDateFormatter.formatToParts(new Date(timestamp));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(byType.hour) * 60 + Number(byType.minute);
}

function eodDateTimestamp(date: unknown, symbol: string): number {
  // Use a same-calendar-day session anchor. UTC midnight renders as the prior
  // date in America/New_York and was shifting Formed/Confirmed labels back one
  // day on the website.
  const timestamp = Date.parse(`${String(date)}T16:00:00.000Z`);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`EODHD returned invalid daily date for ${symbol}: ${String(date)}`);
  }
  return timestamp;
}

function splitPriceMultiplier(value: unknown): number | null {
  const normalizedValue = typeof value === "number" ? String(value) : value;
  if (typeof normalizedValue !== "string") {
    return null;
  }
  const [newSharesText, oldSharesText = "1"] = normalizedValue.split("/");
  const newShares = Number(newSharesText);
  const oldShares = Number(oldSharesText);
  if (
    !Number.isFinite(newShares) ||
    !Number.isFinite(oldShares) ||
    newShares <= 0 ||
    oldShares <= 0
  ) {
    return null;
  }
  return oldShares / newShares;
}

function sessionDateForTimestamp(timestamp: number): string {
  return intradaySessionDate(timestamp);
}

function normalizeYahooSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.US$/, "").replaceAll(".", "-");
}

function yahooInterval(timeframe: CandleFetchTimeframe): "1d" | "60m" | "5m" {
  if (timeframe === "daily") {
    return "1d";
  }
  if (timeframe === "4h") {
    return "60m";
  }
  return "5m";
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

function aggregateHourlyToFourHour(candles: Candle[]): {
  candles: Candle[];
  incompleteBucketCount: number;
  droppedOffSessionBarCount: number;
} {
  const regularSessionAnchorMinute = 9 * 60 + 30;
  const regularSessionEndMinute = 16 * 60;
  const bucketMinutes = 4 * 60;
  const buckets = new Map<string, { startTimestamp: number; candles: Candle[] }>();
  let droppedOffSessionBarCount = 0;

  for (const candle of candles) {
    const sessionDate = intradaySessionDate(candle.timestamp);
    const minuteOfDay = intradayMinuteOfDay(candle.timestamp);
    if (
      minuteOfDay < regularSessionAnchorMinute ||
      minuteOfDay >= regularSessionEndMinute
    ) {
      droppedOffSessionBarCount += 1;
      continue;
    }
    const bucketStartMinute = regularSessionAnchorMinute +
      Math.floor((minuteOfDay - regularSessionAnchorMinute) / bucketMinutes) * bucketMinutes;
    const startTimestamp = candle.timestamp -
      (minuteOfDay - bucketStartMinute) * 60_000;
    const key = `${sessionDate}:${bucketStartMinute}`;
    const bucket = buckets.get(key) ?? { startTimestamp, candles: [] };
    bucket.candles.push(candle);
    buckets.set(key, bucket);
  }

  let incompleteBucketCount = 0;
  const aggregated = [...buckets.values()].flatMap((bucket) => {
    const sorted = [...bucket.candles].sort((left, right) => left.timestamp - right.timestamp);
    const expectedOffsets = new Set(sorted.map((candle) =>
      Math.round((candle.timestamp - bucket.startTimestamp) / (60 * 60_000)),
    ));
    const bucketStartMinute = intradayMinuteOfDay(bucket.startTimestamp);
    const expectedHourOffsets = bucketStartMinute === regularSessionAnchorMinute
      ? [0, 1, 2, 3]
      : [0, 1, 2];
    if (
      sorted.length !== expectedHourOffsets.length ||
      !expectedHourOffsets.every((offset) => expectedOffsets.has(offset))
    ) {
      incompleteBucketCount += 1;
      return [];
    }

    return [{
      timestamp: bucket.startTimestamp,
      open: sorted[0]!.open,
      high: Math.max(...sorted.map((candle) => candle.high)),
      low: Math.min(...sorted.map((candle) => candle.low)),
      close: sorted.at(-1)!.close,
      volume: sorted.reduce((sum, candle) => sum + candle.volume, 0),
    }];
  });

  return {
    candles: aggregated.sort((left, right) => left.timestamp - right.timestamp),
    incompleteBucketCount,
    droppedOffSessionBarCount,
  };
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
  private readonly yahooBaseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: EodhdHistoricalCandleProviderOptions = {}) {
    const apiToken = options.apiToken ?? envText("EODHD_API_TOKEN", "LEVEL_EODHD_API_TOKEN");
    if (!apiToken) {
      throw new Error("EODHD_API_TOKEN is required to use the EODHD historical candle provider.");
    }

    this.apiToken = apiToken;
    this.exchangeSuffix = options.exchangeSuffix ?? envText("EODHD_EXCHANGE_SUFFIX", "LEVEL_EODHD_EXCHANGE_SUFFIX") ?? DEFAULT_EXCHANGE_SUFFIX;
    this.baseUrl = options.baseUrl ?? envText("EODHD_BASE_URL", "LEVEL_EODHD_BASE_URL") ?? DEFAULT_BASE_URL;
    this.yahooBaseUrl = options.yahooBaseUrl ?? DEFAULT_YAHOO_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async fetchCandles(
    request: HistoricalFetchRequest,
    plan: HistoricalFetchPlan,
  ): Promise<BaseCandleProviderResponse> {
    const symbol = request.symbol.trim().toUpperCase();
    const eodhdSymbol = normalizeEodhdSymbol(symbol, this.exchangeSuffix);
    const fetchStartTimestamp = Date.now();
    const eodhdResult = request.timeframe === "daily"
      ? await this.fetchDailyCandles(eodhdSymbol, symbol, plan)
      : await this.fetchIntradayCandles(eodhdSymbol, symbol, request.timeframe, plan);
    const splitBasisMismatch = await this.detectSplitBasisMismatch(
      eodhdSymbol,
      eodhdResult.candles,
      plan,
    );
    let result = eodhdResult;

    if (splitBasisMismatch) {
      try {
        result = await this.fetchYahooCurrentBasisCandles(symbol, request.timeframe, plan);
        result.splitBasisMismatch = splitBasisMismatch;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `EODHD ${symbol} ${request.timeframe} candles have a mixed split basis around ${splitBasisMismatch.splitDate}; ` +
          `the current-basis fallback failed: ${message}`,
        );
      }
    }
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
        providerAdjustmentMode: result.priceBasisSource === "yahoo_current_basis_fallback"
          ? "split_only_current_basis"
          : ADJUSTMENT_MODE,
        priceBasisSource: result.priceBasisSource ?? "eodhd_adjusted_close_ratio",
        splitBasisMismatchDetected: Boolean(result.splitBasisMismatch),
        splitBasisMismatchDate: result.splitBasisMismatch?.splitDate ?? null,
        splitBasisExpectedMultiplier: result.splitBasisMismatch?.expectedPriceMultiplier ?? null,
        splitBasisObservedRatio: result.splitBasisMismatch?.observedPriceRatio ?? null,
        eodhdDroppedInvalidOhlcBars: eodhdResult.droppedInvalidOhlcBars,
        priceBasisDroppedInvalidOhlcBars: result.droppedInvalidOhlcBars,
        eodhdIncompleteFourHourBuckets: eodhdResult.incompleteFourHourBuckets ?? 0,
        priceBasisIncompleteFourHourBuckets: result.incompleteFourHourBuckets ?? 0,
        eodhdDroppedOffSessionFourHourBars: eodhdResult.droppedOffSessionFourHourBars ?? 0,
        priceBasisDroppedOffSessionFourHourBars: result.droppedOffSessionFourHourBars ?? 0,
        // EODHD's historical US feed used here returns the regular session.
        // Advertising extended-hours coverage made downstream diagnostics look
        // more complete than the actual candle set.
        useRTH: true,
        sessionCoverage: "regular_only",
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
    const sessionDate = intradaySessionDate(timestamp);
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
    const aggregation = timeframe === "4h"
      ? aggregateHourlyToFourHour(filtered.candles)
      : null;

    return {
      candles: aggregation?.candles ?? filtered.candles,
      droppedInvalidOhlcBars: filtered.droppedInvalidOhlcBars,
      ...(aggregation
        ? {
            incompleteFourHourBuckets: aggregation.incompleteBucketCount,
            droppedOffSessionFourHourBars: aggregation.droppedOffSessionBarCount,
          }
        : {}),
    };
  }

  private async detectSplitBasisMismatch(
    eodhdSymbol: string,
    candles: Candle[],
    plan: HistoricalFetchPlan,
  ): Promise<EodhdSplitBasisMismatch | null> {
    const sorted = [...candles].sort((left, right) => left.timestamp - right.timestamp);
    const discontinuities: Array<{
      previousDate: string;
      currentDate: string;
      observedPriceRatio: number;
    }> = [];

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]!;
      const current = sorted[index]!;
      const observedPriceRatio = current.open / previous.close;
      const discontinuityMagnitude = Math.max(observedPriceRatio, 1 / observedPriceRatio);
      if (
        Number.isFinite(discontinuityMagnitude) &&
        discontinuityMagnitude >= EXTREME_PRICE_DISCONTINUITY_RATIO
      ) {
        discontinuities.push({
          previousDate: sessionDateForTimestamp(previous.timestamp),
          currentDate: sessionDateForTimestamp(current.timestamp),
          observedPriceRatio,
        });
      }
    }

    if (discontinuities.length === 0) {
      return null;
    }

    const splitEvents = await this.fetchSplitEvents(
      eodhdSymbol,
      plan.requestStartTimestamp,
      plan.requestEndTimestamp,
    );

    for (const discontinuity of discontinuities) {
      for (const event of splitEvents) {
        const splitDate = typeof event.date === "string" ? event.date.trim() : "";
        const expectedPriceMultiplier = splitPriceMultiplier(event.split);
        if (
          !splitDate ||
          expectedPriceMultiplier === null ||
          splitDate <= discontinuity.previousDate ||
          splitDate > discontinuity.currentDate
        ) {
          continue;
        }

        const directionMatches = expectedPriceMultiplier >= 1
          ? discontinuity.observedPriceRatio >= 1
          : discontinuity.observedPriceRatio <= 1;
        const observedMagnitude = Math.max(
          discontinuity.observedPriceRatio,
          1 / discontinuity.observedPriceRatio,
        );
        const expectedMagnitude = Math.max(
          expectedPriceMultiplier,
          1 / expectedPriceMultiplier,
        );
        const ratioDifference = Math.max(
          observedMagnitude / expectedMagnitude,
          expectedMagnitude / observedMagnitude,
        );

        if (directionMatches && ratioDifference <= SPLIT_RATIO_MATCH_TOLERANCE) {
          return {
            splitDate,
            expectedPriceMultiplier,
            observedPriceRatio: discontinuity.observedPriceRatio,
          };
        }
      }
    }

    return null;
  }

  private async fetchSplitEvents(
    eodhdSymbol: string,
    fromTimestamp: number,
    toTimestamp: number,
  ): Promise<EodhdSplitEvent[]> {
    const url = this.buildUrl(`/splits/${encodeURIComponent(eodhdSymbol)}`, {
      fmt: "json",
      from: isoDate(fromTimestamp),
      to: isoDate(toTimestamp),
    });
    return this.fetchJson<EodhdSplitEvent[]>(url);
  }

  private async fetchYahooCurrentBasisCandles(
    requestedSymbol: string,
    timeframe: CandleTimeframe,
    plan: HistoricalFetchPlan,
  ): Promise<EodhdCandleFetchResult> {
    const yahooSymbol = normalizeYahooSymbol(requestedSymbol);
    const url = new URL(
      `${this.yahooBaseUrl.replace(/\/$/, "")}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`,
    );
    url.searchParams.set("period1", String(Math.floor(plan.requestStartTimestamp / 1000)));
    url.searchParams.set("period2", String(Math.ceil(plan.requestEndTimestamp / 1000)));
    url.searchParams.set("interval", yahooInterval(timeframe));
    url.searchParams.set("includePrePost", "false");
    url.searchParams.set("events", "div,splits");

    const payload = await this.fetchYahooJson(url.toString());
    const chartError = payload.chart?.error;
    if (chartError) {
      throw new Error(
        `Yahoo chart error ${chartError.code ?? "unknown"}: ${chartError.description ?? "no description"}`,
      );
    }

    const chartResult = payload.chart?.result?.[0];
    const timestamps = chartResult?.timestamp ?? [];
    const quote = chartResult?.indicators?.quote?.[0];
    if (!chartResult || !quote || timestamps.length === 0) {
      throw new Error(`Yahoo returned no current-basis candles for ${requestedSymbol}.`);
    }

    const mappedCandles = timestamps.map((timestampSeconds, index): Candle => ({
      timestamp: Number(timestampSeconds) * 1000,
      open: Number(quote.open?.[index]),
      high: Number(quote.high?.[index]),
      low: Number(quote.low?.[index]),
      close: Number(quote.close?.[index]),
      volume: toVolume(quote.volume?.[index]),
    }));
    const filtered = filterInvalidOhlcCandles(mappedCandles);
    const aggregation = timeframe === "4h"
      ? aggregateHourlyToFourHour(filtered.candles)
      : null;
    const candles = aggregation?.candles ?? filtered.candles;

    if (candles.length === 0) {
      throw new Error(`Yahoo returned no valid current-basis candles for ${requestedSymbol}.`);
    }

    return {
      candles,
      droppedInvalidOhlcBars: filtered.droppedInvalidOhlcBars,
      ...(aggregation
        ? {
            incompleteFourHourBuckets: aggregation.incompleteBucketCount,
            droppedOffSessionFourHourBars: aggregation.droppedOffSessionBarCount,
          }
        : {}),
      priceBasisSource: "yahoo_current_basis_fallback",
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

  private async fetchYahooJson(url: string): Promise<YahooChartResponse> {
    const response = await this.fetchFn(url);
    if (!response.ok) {
      throw new Error(`Yahoo current-basis request failed with HTTP ${response.status}.`);
    }
    return await response.json() as YahooChartResponse;
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
