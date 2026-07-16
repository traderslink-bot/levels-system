import type { Candle } from "../market-data/candle-types.js";
import { buildDynamicLevelsFromCandles } from "../support-resistance/indicators/dynamic-levels.js";
import type { TechnicalContext, TechnicalContextConfidence } from "./technical-context-types.js";

type BuildTechnicalContextRequest = {
  candles: Candle[];
  currentPrice?: number | null;
  provider?: string | null;
  sessionDate?: string | null;
  dataQualityFlags?: string[];
};

const MIN_READY_SESSION_CANDLES = 20;
const MAX_RECENT_CONTEXT_CANDLES = 80;

function utcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function validPrice(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function pctFromPrice(price: number, level: number | null): number | null {
  return level === null
    ? null
    : Number((((price - level) / Math.max(Math.abs(price), 0.0001)) * 100).toFixed(4));
}

function selectContextCandles(params: {
  sorted: Candle[];
  sessionDate: string | null;
  explicitSessionDate: boolean;
}): { candles: Candle[]; sessionDate: string | null; fallbackUsed: boolean } {
  if (params.sessionDate === null) {
    return { candles: [], sessionDate: null, fallbackUsed: false };
  }

  const sessionCandles = params.sorted.filter((candle) => utcDate(candle.timestamp) === params.sessionDate);
  if (
    params.explicitSessionDate ||
    sessionCandles.length >= MIN_READY_SESSION_CANDLES ||
    params.sorted.length < MIN_READY_SESSION_CANDLES
  ) {
    return { candles: sessionCandles, sessionDate: params.sessionDate, fallbackUsed: false };
  }

  return {
    candles: params.sorted.slice(-MAX_RECENT_CONTEXT_CANDLES),
    sessionDate: null,
    fallbackUsed: true,
  };
}

function confidenceForTechnicalContext(params: {
  candleCount: number;
  vwap: number | null;
  ema9: number | null;
  ema20: number | null;
  diagnostics: string[];
}): TechnicalContextConfidence {
  if (
    params.candleCount === 0 ||
    (params.vwap === null && params.ema9 === null && params.ema20 === null) ||
    params.diagnostics.includes("5m:unavailable")
  ) {
    return "unavailable";
  }

  if (
    params.candleCount >= 30 &&
    params.vwap !== null &&
    params.ema9 !== null &&
    params.ema20 !== null &&
    params.diagnostics.length === 0
  ) {
    return "high";
  }

  if (
    params.candleCount >= 20 &&
    params.vwap !== null &&
    params.ema9 !== null &&
    params.ema20 !== null
  ) {
    return "medium";
  }

  return "low";
}

export function refreshTechnicalContextForPrice(
  context: TechnicalContext,
  currentPriceInput: number | null | undefined,
): TechnicalContext {
  const currentPrice = validPrice(currentPriceInput);
  if (currentPrice === null) {
    return {
      ...context,
      currentPrice: null,
      priceVsVwapPct: null,
      priceVsEma9Pct: null,
      priceVsEma20Pct: null,
      aboveVwap: null,
      aboveEma9: null,
      aboveEma20: null,
    };
  }

  return {
    ...context,
    currentPrice,
    priceVsVwapPct: pctFromPrice(currentPrice, context.vwap),
    priceVsEma9Pct: pctFromPrice(currentPrice, context.ema9),
    priceVsEma20Pct: pctFromPrice(currentPrice, context.ema20),
    aboveVwap: context.vwap === null ? null : currentPrice >= context.vwap,
    aboveEma9: context.ema9 === null ? null : currentPrice >= context.ema9,
    aboveEma20: context.ema20 === null ? null : currentPrice >= context.ema20,
  };
}

export function buildTechnicalContextFromCandles(
  request: BuildTechnicalContextRequest,
): TechnicalContext {
  const sorted = [...request.candles].sort((left, right) => left.timestamp - right.timestamp);
  const latestTimestamp = sorted.at(-1)?.timestamp ?? null;
  const explicitSessionDate = request.sessionDate !== undefined && request.sessionDate !== null;
  const requestedSessionDate = request.sessionDate ?? (latestTimestamp === null ? null : utcDate(latestTimestamp));
  const selected = selectContextCandles({
    sorted,
    sessionDate: requestedSessionDate,
    explicitSessionDate,
  });
  const currentPrice =
    validPrice(request.currentPrice) ?? validPrice(selected.candles.at(-1)?.close) ?? null;
  const dynamicLevels = buildDynamicLevelsFromCandles(selected.candles, {
    sessionDate: selected.sessionDate ?? undefined,
    emaPeriods: [9, 20],
    currentPrice: currentPrice ?? undefined,
  });
  const diagnostics = [
    ...(request.dataQualityFlags ?? []),
    ...(selected.fallbackUsed ? ["5m:utc_session_rollover_recent_window"] : []),
    ...dynamicLevels.diagnostics.map((diagnostic) => diagnostic.code),
  ];
  const baseContext: TechnicalContext = {
    source: "levels_system_intraday",
    sourceTimeframe: "5m",
    provider: request.provider ?? null,
    sessionDate: requestedSessionDate,
    updatedAt: latestTimestamp,
    candleCount: selected.candles.length,
    currentPrice: null,
    vwap: dynamicLevels.vwap,
    ema9: dynamicLevels.ema9,
    ema20: dynamicLevels.ema20,
    priceVsVwapPct: null,
    priceVsEma9Pct: null,
    priceVsEma20Pct: null,
    aboveVwap: null,
    aboveEma9: null,
    aboveEma20: null,
    confidence: confidenceForTechnicalContext({
      candleCount: selected.candles.length,
      vwap: dynamicLevels.vwap,
      ema9: dynamicLevels.ema9,
      ema20: dynamicLevels.ema20,
      diagnostics,
    }),
    diagnostics,
  };

  return refreshTechnicalContextForPrice(baseContext, currentPrice);
}
