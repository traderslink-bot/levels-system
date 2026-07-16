import type {
  CandleProviderName,
  CandleTimeframe,
  ProviderCandleTimeframe,
} from "./candle-types.js";
import type {
  HistoricalFetchPlan,
  HistoricalFetchRequest,
  ProviderHistoricalFetchPlan,
  ProviderHistoricalFetchRequest,
} from "./provider-types.js";

const TIMEFRAME_TO_INTERVAL_MS: Record<ProviderCandleTimeframe, number> = {
  daily: 24 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "5m": 5 * 60 * 1000,
};

const TIMEFRAME_TO_BAR_SIZE: Record<ProviderCandleTimeframe, string> = {
  daily: "1 day",
  "4h": "4 hours",
  "15m": "15 mins",
  "5m": "5 mins",
};

const TIMEFRAME_TO_REMOTE_INTERVAL: Record<ProviderCandleTimeframe, string> = {
  daily: "1day",
  "4h": "4h",
  "15m": "15min",
  "5m": "5min",
};

const DAY_MS = 24 * 60 * 60 * 1000;

const EODHD_BARS_PER_REGULAR_SESSION: Record<ProviderCandleTimeframe, number> = {
  daily: 1,
  "4h": 2,
  "15m": 26,
  "5m": 78,
};

const EODHD_MINIMUM_CALENDAR_DAYS: Record<ProviderCandleTimeframe, number> = {
  daily: 14,
  "4h": 14,
  "15m": 7,
  "5m": 7,
};

function resolvePlannedBarCount(
  timeframe: ProviderCandleTimeframe,
  lookbackBars: number,
): number {
  switch (timeframe) {
    case "daily":
      return Math.max(lookbackBars + 40, Math.ceil(lookbackBars * 1.25));
    case "4h":
      return Math.max(lookbackBars + 30, Math.ceil(lookbackBars * 1.4));
    case "15m":
      return Math.max(lookbackBars + 60, Math.ceil(lookbackBars * 1.6));
    case "5m":
      return Math.max(lookbackBars + 60, Math.ceil(lookbackBars * 1.6));
  }
}

function formatIbkrDurationFromMs(spanMs: number): string {
  const dayMs = DAY_MS;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;
  const yearMs = 365 * dayMs;

  if (spanMs <= weekMs) {
    return `${Math.max(1, Math.ceil(spanMs / dayMs))} D`;
  }

  if (spanMs <= 12 * weekMs) {
    return `${Math.max(1, Math.ceil(spanMs / weekMs))} W`;
  }

  if (spanMs <= 18 * monthMs) {
    return `${Math.max(1, Math.ceil(spanMs / monthMs))} M`;
  }

  return `${Math.max(1, Math.ceil(spanMs / yearMs))} Y`;
}

function resolveRequestSpanMs(
  provider: CandleProviderName,
  timeframe: ProviderCandleTimeframe,
  plannedBarCount: number,
  intervalMs: number,
): number {
  if (provider !== "eodhd") {
    return plannedBarCount * intervalMs;
  }

  // EODHD date ranges are wall-clock ranges, while lookbackBars counts market
  // bars. Converting bars directly to nominal bar durations under-fetches every
  // timeframe across nights, weekends, and holidays (especially aggregated 4h
  // candles). Request enough trading sessions plus a calendar buffer, then let
  // the provider keep the newest plannedBarCount bars.
  const estimatedTradingSessions = Math.ceil(
    plannedBarCount / EODHD_BARS_PER_REGULAR_SESSION[timeframe],
  );
  const calendarDaysForSessions = Math.ceil(estimatedTradingSessions * (7 / 5));
  const bufferedCalendarDays =
    calendarDaysForSessions + EODHD_MINIMUM_CALENDAR_DAYS[timeframe];

  return bufferedCalendarDays * DAY_MS;
}

export function buildProviderHistoricalFetchPlan(
  request: ProviderHistoricalFetchRequest,
  provider: CandleProviderName,
): ProviderHistoricalFetchPlan {
  const requestEndTimestamp = request.endTimeMs ?? Date.now();
  const intervalMs = TIMEFRAME_TO_INTERVAL_MS[request.timeframe];
  const plannedBarCount = resolvePlannedBarCount(request.timeframe, request.lookbackBars);
  const requestSpanMs = resolveRequestSpanMs(
    provider,
    request.timeframe,
    plannedBarCount,
    intervalMs,
  );
  const requestStartTimestamp = requestEndTimestamp - requestSpanMs;
  const providerRequest = {
    barSizeSetting: TIMEFRAME_TO_BAR_SIZE[request.timeframe],
    durationStr: formatIbkrDurationFromMs(requestEndTimestamp - requestStartTimestamp),
    interval: TIMEFRAME_TO_REMOTE_INTERVAL[request.timeframe],
    outputSize: plannedBarCount,
  };

  return {
    provider,
    timeframe: request.timeframe,
    requestedLookbackBars: request.lookbackBars,
    plannedBarCount,
    requestStartTimestamp,
    requestEndTimestamp,
    intervalMs,
    sessionMetadataAvailable: request.timeframe === "5m",
    providerRequest,
  };
}

export function buildHistoricalFetchPlan(
  request: HistoricalFetchRequest,
  provider: CandleProviderName,
): HistoricalFetchPlan {
  return buildProviderHistoricalFetchPlan(request, provider) as HistoricalFetchPlan;
}
