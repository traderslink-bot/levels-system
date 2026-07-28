import type {
  BaseCandleProviderResponse,
  Candle,
  CandleFetchTimeframe,
  CandleProviderName,
  CandleProviderResponse,
} from "./candle-types.js";
import { CandleFetchService } from "./candle-fetch-service.js";
import { finalizeCandleProviderResponse } from "./candle-quality.js";
import { EodhdHistoricalCandleProvider, type EodhdHistoricalCandleProviderOptions } from "./eodhd-historical-candle-provider.js";
import type { HistoricalCandleProvider } from "./provider-types.js";
import { YahooHistoricalCandleProvider, type YahooHistoricalCandleProviderOptions } from "./yahoo-historical-candle-provider.js";

export type TradeCandleContextTimeframe = CandleFetchTimeframe;

export type TradeCandleContextProviderSelection = {
  provider: CandleProviderName;
  reason:
    | "fresh_intraday_window"
    | "historical_or_daily_window"
    | "eodhd_unavailable_yahoo_fallback";
};

export type TradeCandleContextSeries = {
  timeframe: TradeCandleContextTimeframe;
  provider: CandleProviderName;
  selectionReason: TradeCandleContextProviderSelection["reason"];
  requestedStartTimestamp: number;
  requestedEndTimestamp: number;
  candles: Candle[];
  response: CandleProviderResponse;
};

export type TradeCandleContext = {
  symbol: string;
  fromTimeMs: number;
  toTimeMs: number;
  generatedAt: number;
  series: TradeCandleContextSeries[];
};

export type BuildTradeCandleContextRequest = {
  symbol: string;
  fromTimeMs: number;
  toTimeMs: number;
  timeframes?: TradeCandleContextTimeframe[];
  nowMs?: number;
  yahooRecentLimitsMs?: Partial<Record<TradeCandleContextTimeframe, number>>;
  eodhdIntradayReadyHourEastern?: number;
  recentProvider?: HistoricalCandleProvider;
  historicalProvider?: HistoricalCandleProvider;
  yahooOptions?: YahooHistoricalCandleProviderOptions;
  eodhdOptions?: EodhdHistoricalCandleProviderOptions;
};

const DEFAULT_TIMEFRAMES: TradeCandleContextTimeframe[] = ["1m", "5m", "4h"];
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_YAHOO_RECENT_LIMITS_MS: Record<TradeCandleContextTimeframe, number> = {
  "1m": 7 * DAY_MS,
  "5m": 60 * DAY_MS,
  "4h": 60 * DAY_MS,
  daily: 0,
};
const DEFAULT_EODHD_INTRADAY_READY_HOUR_EASTERN = 20;
const NEW_YORK_TIMEZONE = "America/New_York";
const newYorkFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: NEW_YORK_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function newYorkParts(timestamp: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const byType = Object.fromEntries(
    newYorkFormatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
  };
}

function compareNewYorkDateTime(
  left: ReturnType<typeof newYorkParts>,
  right: ReturnType<typeof newYorkParts>,
): number {
  return Date.UTC(left.year, left.month - 1, left.day, left.hour, left.minute, left.second) -
    Date.UTC(right.year, right.month - 1, right.day, right.hour, right.minute, right.second);
}

function newYorkDateTimeToUtcMs(params: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute?: number;
  second?: number;
}): number {
  const desired = {
    year: params.year,
    month: params.month,
    day: params.day,
    hour: params.hour,
    minute: params.minute ?? 0,
    second: params.second ?? 0,
  };
  let guess = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour + 5,
    desired.minute,
    desired.second,
  );

  for (let index = 0; index < 3; index += 1) {
    const actual = newYorkParts(guess);
    guess += compareNewYorkDateTime(desired, actual);
  }

  return guess;
}

function previousNewYorkDate(parts: ReturnType<typeof newYorkParts>): {
  year: number;
  month: number;
  day: number;
} {
  const previous = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - DAY_MS);
  return {
    year: previous.getUTCFullYear(),
    month: previous.getUTCMonth() + 1,
    day: previous.getUTCDate(),
  };
}

function timeframeIntervalMs(timeframe: TradeCandleContextTimeframe): number {
  switch (timeframe) {
    case "1m":
      return 60_000;
    case "5m":
      return 5 * 60_000;
    case "4h":
      return 4 * 60 * 60_000;
    case "daily":
      return 24 * 60 * 60_000;
  }
}

function assertValidRequest(request: BuildTradeCandleContextRequest): void {
  if (!request.symbol.trim()) {
    throw new Error("symbol is required.");
  }
  if (!Number.isFinite(request.fromTimeMs) || !Number.isFinite(request.toTimeMs)) {
    throw new Error("fromTimeMs and toTimeMs must be finite timestamps.");
  }
  if (request.toTimeMs <= request.fromTimeMs) {
    throw new Error("toTimeMs must be greater than fromTimeMs.");
  }
}

function requestedLookbackBars(params: {
  fromTimeMs: number;
  toTimeMs: number;
  timeframe: TradeCandleContextTimeframe;
}): number {
  return Math.max(
    1,
    Math.ceil((params.toTimeMs - params.fromTimeMs) / timeframeIntervalMs(params.timeframe)) + 1,
  );
}

function selectProvider(params: {
  timeframe: TradeCandleContextTimeframe;
  fromTimeMs: number;
  toTimeMs: number;
  nowMs: number;
  eodhdIntradayReadyHourEastern: number;
}): TradeCandleContextProviderSelection {
  if (params.timeframe === "daily") {
    return {
      provider: "eodhd",
      reason: "historical_or_daily_window",
    };
  }

  const nowParts = newYorkParts(params.nowMs);
  const todayCutoff = newYorkDateTimeToUtcMs({
    year: nowParts.year,
    month: nowParts.month,
    day: nowParts.day,
    hour: params.eodhdIntradayReadyHourEastern,
  });
  const latestCutoff = params.nowMs >= todayCutoff
    ? todayCutoff
    : newYorkDateTimeToUtcMs({
        ...previousNewYorkDate(nowParts),
        hour: params.eodhdIntradayReadyHourEastern,
      });

  if (params.toTimeMs > latestCutoff) {
    return {
      provider: "yahoo",
      reason: "fresh_intraday_window",
    };
  }

  return {
    provider: "eodhd",
    reason: "historical_or_daily_window",
  };
}

function sliceCandles(candles: Candle[], fromTimeMs: number, toTimeMs: number): Candle[] {
  return candles.filter((candle) => candle.timestamp >= fromTimeMs && candle.timestamp <= toTimeMs);
}

function aggregateCandlesToFiveMinutes(candles: Candle[]): Candle[] {
  const sorted = [...candles].sort((left, right) => left.timestamp - right.timestamp);
  const buckets = new Map<number, Candle[]>();

  for (const candle of sorted) {
    const bucketStart = Math.floor(candle.timestamp / timeframeIntervalMs("5m")) * timeframeIntervalMs("5m");
    const bucket = buckets.get(bucketStart) ?? [];
    bucket.push(candle);
    buckets.set(bucketStart, bucket);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([timestamp, bucket]) => ({
      timestamp,
      open: bucket[0]!.open,
      high: Math.max(...bucket.map((candle) => candle.high)),
      low: Math.min(...bucket.map((candle) => candle.low)),
      close: bucket.at(-1)!.close,
      volume: bucket.reduce((sum, candle) => sum + candle.volume, 0),
    }));
}

function finalizeSlicedResponse(params: {
  response: CandleProviderResponse;
  candles: Candle[];
  requestedLookbackBars: number;
  fromTimeMs: number;
  toTimeMs: number;
  selectionReason: TradeCandleContextProviderSelection["reason"];
}): CandleProviderResponse {
  const baseResponse: BaseCandleProviderResponse = {
    provider: params.response.provider,
    symbol: params.response.symbol,
    timeframe: params.response.timeframe,
    requestedLookbackBars: params.requestedLookbackBars,
    candles: params.candles,
    fetchStartTimestamp: params.response.fetchStartTimestamp,
    fetchEndTimestamp: params.response.fetchEndTimestamp,
    requestedStartTimestamp: params.fromTimeMs,
    requestedEndTimestamp: params.toTimeMs,
    sessionMetadataAvailable: params.response.sessionMetadataAvailable,
    providerMetadata: {
      ...(params.response.providerMetadata ?? {}),
      tradeCandleSelectionReason: params.selectionReason,
      sourceRequestedStartTimestamp: params.response.requestedStartTimestamp,
      sourceRequestedEndTimestamp: params.response.requestedEndTimestamp,
    },
  };

  return finalizeCandleProviderResponse(baseResponse);
}

function canFallbackToYahoo(params: {
  timeframe: TradeCandleContextTimeframe;
  fromTimeMs: number;
  nowMs: number;
  yahooRecentLimitsMs: Record<TradeCandleContextTimeframe, number>;
}): boolean {
  const recentLimitMs = params.yahooRecentLimitsMs[params.timeframe];
  return params.timeframe !== "daily" &&
    recentLimitMs > 0 &&
    params.fromTimeMs >= params.nowMs - recentLimitMs;
}

async function fetchSlicedSeries(params: {
  provider: HistoricalCandleProvider;
  symbol: string;
  timeframe: TradeCandleContextTimeframe;
  fromTimeMs: number;
  toTimeMs: number;
  lookbackBars: number;
  selectionReason: TradeCandleContextProviderSelection["reason"];
}): Promise<TradeCandleContextSeries> {
  const fetchService = new CandleFetchService(params.provider);
  const response = await fetchService.fetchCandles({
    symbol: params.symbol,
    timeframe: params.timeframe,
    lookbackBars: params.lookbackBars,
    endTimeMs: params.toTimeMs,
    preferredProvider: params.provider.providerName,
  });
  const candles = sliceCandles(response.candles, params.fromTimeMs, params.toTimeMs);
  const slicedResponse = finalizeSlicedResponse({
    response,
    candles,
    requestedLookbackBars: params.lookbackBars,
    fromTimeMs: params.fromTimeMs,
    toTimeMs: params.toTimeMs,
    selectionReason: params.selectionReason,
  });

  return {
    timeframe: params.timeframe,
    provider: slicedResponse.provider,
    selectionReason: params.selectionReason,
    requestedStartTimestamp: params.fromTimeMs,
    requestedEndTimestamp: params.toTimeMs,
    candles,
    response: slicedResponse,
  };
}

function shouldTryEodhdOneMinuteAggregation(params: {
  selectionProvider: CandleProviderName;
  timeframe: TradeCandleContextTimeframe;
  result: TradeCandleContextSeries;
}): boolean {
  if (params.selectionProvider !== "eodhd" || params.timeframe !== "5m") {
    return false;
  }

  return (
    params.result.candles.length === 0 ||
    params.result.response.stale ||
    params.result.response.validationIssues.some((issue) =>
      issue.code === "zero_results" ||
      issue.code === "stale_final_candle" ||
      issue.code === "missing_recent_candles" ||
      issue.code === "incomplete_current_session_data"
    )
  );
}

async function fetchEodhdOneMinuteAggregatedToFiveMinuteSeries(params: {
  provider: HistoricalCandleProvider;
  symbol: string;
  fromTimeMs: number;
  toTimeMs: number;
  fiveMinuteLookbackBars: number;
  selectionReason: TradeCandleContextProviderSelection["reason"];
}): Promise<TradeCandleContextSeries> {
  const fetchService = new CandleFetchService(params.provider);
  const oneMinuteLookbackBars = requestedLookbackBars({
    fromTimeMs: params.fromTimeMs,
    toTimeMs: params.toTimeMs,
    timeframe: "1m",
  });
  const oneMinuteResponse = await fetchService.fetchCandles({
    symbol: params.symbol,
    timeframe: "1m",
    lookbackBars: oneMinuteLookbackBars,
    endTimeMs: params.toTimeMs,
    preferredProvider: params.provider.providerName,
  });
  const oneMinuteCandles = sliceCandles(
    oneMinuteResponse.candles,
    params.fromTimeMs,
    params.toTimeMs,
  );
  const candles = aggregateCandlesToFiveMinutes(oneMinuteCandles);
  const baseResponse: BaseCandleProviderResponse = {
    provider: oneMinuteResponse.provider,
    symbol: oneMinuteResponse.symbol,
    timeframe: "5m",
    requestedLookbackBars: params.fiveMinuteLookbackBars,
    candles,
    fetchStartTimestamp: oneMinuteResponse.fetchStartTimestamp,
    fetchEndTimestamp: oneMinuteResponse.fetchEndTimestamp,
    requestedStartTimestamp: params.fromTimeMs,
    requestedEndTimestamp: params.toTimeMs,
    sessionMetadataAvailable: oneMinuteResponse.sessionMetadataAvailable,
    providerMetadata: {
      ...(oneMinuteResponse.providerMetadata ?? {}),
      tradeCandleSelectionReason: params.selectionReason,
      sourceTimeframe: "1m",
      derivedTimeframe: "5m",
      aggregationMethod: "ohlcv_1m_to_5m",
      sourceRequestedStartTimestamp: oneMinuteResponse.requestedStartTimestamp,
      sourceRequestedEndTimestamp: oneMinuteResponse.requestedEndTimestamp,
      sourceActualBarsReturned: oneMinuteResponse.actualBarsReturned,
      sourceSlicedBarsReturned: oneMinuteCandles.length,
    },
  };
  const slicedResponse = finalizeCandleProviderResponse(baseResponse);

  return {
    timeframe: "5m",
    provider: slicedResponse.provider,
    selectionReason: params.selectionReason,
    requestedStartTimestamp: params.fromTimeMs,
    requestedEndTimestamp: params.toTimeMs,
    candles,
    response: slicedResponse,
  };
}

export async function buildTradeCandleContext(
  request: BuildTradeCandleContextRequest,
): Promise<TradeCandleContext> {
  assertValidRequest(request);

  const symbol = request.symbol.trim().toUpperCase();
  const nowMs = request.nowMs ?? Date.now();
  const timeframes = request.timeframes?.length ? request.timeframes : DEFAULT_TIMEFRAMES;
  const yahooRecentLimitsMs = {
    ...DEFAULT_YAHOO_RECENT_LIMITS_MS,
    ...(request.yahooRecentLimitsMs ?? {}),
  };
  const eodhdIntradayReadyHourEastern =
    request.eodhdIntradayReadyHourEastern ?? DEFAULT_EODHD_INTRADAY_READY_HOUR_EASTERN;
  let recentProvider = request.recentProvider;
  let historicalProvider = request.historicalProvider;
  const series: TradeCandleContextSeries[] = [];

  for (const timeframe of timeframes) {
    const selection = selectProvider({
      timeframe,
      fromTimeMs: request.fromTimeMs,
      toTimeMs: request.toTimeMs,
      nowMs,
      eodhdIntradayReadyHourEastern,
    });
    const lookbackBars = requestedLookbackBars({
      fromTimeMs: request.fromTimeMs,
      toTimeMs: request.toTimeMs,
      timeframe,
    });

    const provider =
      selection.provider === "yahoo"
        ? (recentProvider ??= new YahooHistoricalCandleProvider(request.yahooOptions))
        : (historicalProvider ??= new EodhdHistoricalCandleProvider(request.eodhdOptions));
    let result = await fetchSlicedSeries({
      provider,
      symbol,
      timeframe,
      lookbackBars,
      fromTimeMs: request.fromTimeMs,
      toTimeMs: request.toTimeMs,
      selectionReason: selection.reason,
    });

    if (
      shouldTryEodhdOneMinuteAggregation({
        selectionProvider: selection.provider,
        timeframe,
        result,
      })
    ) {
      const aggregatedResult = await fetchEodhdOneMinuteAggregatedToFiveMinuteSeries({
        provider,
        symbol,
        fromTimeMs: request.fromTimeMs,
        toTimeMs: request.toTimeMs,
        fiveMinuteLookbackBars: lookbackBars,
        selectionReason: selection.reason,
      });

      if (aggregatedResult.candles.length > 0 && !aggregatedResult.response.stale) {
        result = aggregatedResult;
      }
    }

    if (
      selection.provider === "eodhd" &&
      result.candles.length === 0 &&
      canFallbackToYahoo({
        timeframe,
        fromTimeMs: request.fromTimeMs,
        nowMs,
        yahooRecentLimitsMs,
      })
    ) {
      result = await fetchSlicedSeries({
        provider: (recentProvider ??= new YahooHistoricalCandleProvider(request.yahooOptions)),
        symbol,
        timeframe,
        lookbackBars,
        fromTimeMs: request.fromTimeMs,
        toTimeMs: request.toTimeMs,
        selectionReason: "eodhd_unavailable_yahoo_fallback",
      });
    }

    series.push(result);
  }

  return {
    symbol,
    fromTimeMs: request.fromTimeMs,
    toTimeMs: request.toTimeMs,
    generatedAt: Date.now(),
    series,
  };
}
