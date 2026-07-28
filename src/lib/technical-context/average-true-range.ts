import type { Candle } from "../market-data/candle-types.js";

const DEFAULT_ATR_PERIOD = 14;
const DEFAULT_BUCKET_MS = 5 * 60 * 1000;
const MAX_SINGLE_RANGE_SHARE = 0.45;

export type CompletedAtrReliability = "reliable" | "unstable" | "unavailable";

export type CompletedAtrContext = {
  value: number | null;
  pct: number | null;
  period: number;
  timeframe: "5m";
  completedCandleCount: number;
  trueRangeCount: number;
  reliability: CompletedAtrReliability;
  reason: string | null;
};

function isValidCandle(candle: Candle): boolean {
  return (
    Number.isFinite(candle.timestamp) &&
    Number.isFinite(candle.open) && candle.open > 0 &&
    Number.isFinite(candle.high) && candle.high > 0 &&
    Number.isFinite(candle.low) && candle.low > 0 &&
    Number.isFinite(candle.close) && candle.close > 0 &&
    candle.high >= Math.max(candle.open, candle.close, candle.low) &&
    candle.low <= Math.min(candle.open, candle.close, candle.high)
  );
}

function unavailable(
  period: number,
  completedCandleCount: number,
  reason: string,
): CompletedAtrContext {
  return {
    value: null,
    pct: null,
    period,
    timeframe: "5m",
    completedCandleCount,
    trueRangeCount: 0,
    reliability: "unavailable",
    reason,
  };
}

export function calculateCompletedFiveMinuteAtr(
  candles: Candle[],
  currentPrice: number,
  asOfTimestamp: number,
  options: { period?: number; bucketMs?: number } = {},
): CompletedAtrContext {
  const period = Math.max(1, Math.floor(options.period ?? DEFAULT_ATR_PERIOD));
  const bucketMs = Math.max(1, Math.floor(options.bucketMs ?? DEFAULT_BUCKET_MS));
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(asOfTimestamp)) {
    return unavailable(period, 0, "ATR requires a valid current price and evaluation timestamp.");
  }

  const currentBucketStart = Math.floor(asOfTimestamp / bucketMs) * bucketMs;
  const byTimestamp = new Map<number, Candle>();
  for (const candle of candles) {
    if (isValidCandle(candle) && candle.timestamp < currentBucketStart) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  const completed = [...byTimestamp.values()]
    .sort((left, right) => left.timestamp - right.timestamp);
  const requiredCandles = period + 1;
  if (completed.length < requiredCandles) {
    return unavailable(
      period,
      completed.length,
      `ATR${period} requires ${requiredCandles} completed 5-minute candles.`,
    );
  }

  const recent = completed.slice(-requiredCandles);
  const trueRanges = recent.slice(1).map((candle, index) => {
    const previousClose = recent[index]!.close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  const totalRange = trueRanges.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(totalRange) || totalRange <= 0) {
    return unavailable(period, completed.length, "ATR could not be calculated from flat or invalid ranges.");
  }

  const value = totalRange / trueRanges.length;
  const largestRangeShare = Math.max(...trueRanges) / totalRange;
  const reliability: CompletedAtrReliability = largestRangeShare > MAX_SINGLE_RANGE_SHARE
    ? "unstable"
    : "reliable";
  return {
    value: Number(value.toFixed(6)),
    pct: Number((value / currentPrice).toFixed(6)),
    period,
    timeframe: "5m",
    completedCandleCount: completed.length,
    trueRangeCount: trueRanges.length,
    reliability,
    reason: reliability === "unstable"
      ? "One completed candle dominates the ATR window, so volatility-adjusted level wording is suppressed."
      : null,
  };
}
