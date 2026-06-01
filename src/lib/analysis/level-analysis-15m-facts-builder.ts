import type { Candle } from "../market-data/candle-types.js";
import {
  createUnavailableFifteenMinuteFacts,
  FIFTEEN_MINUTE_FACTS_SCHEMA_VERSION,
  type FifteenMinuteCloseLocation,
  type FifteenMinuteFactDiagnostic,
  type FifteenMinuteFactLimitation,
  type FifteenMinuteFacts,
  type FifteenMinuteRangeFacts,
  type FifteenMinuteRangeState,
  type FifteenMinuteReferencePosition,
  type FifteenMinuteStructureFacts,
  type FifteenMinuteStructureState,
  type FifteenMinuteTrendFacts,
  type FifteenMinuteTrendState,
  type FifteenMinuteVolumeFacts,
  type FifteenMinuteVolumeState,
} from "./level-analysis-timeframe-facts.js";

export const FIFTEEN_MINUTE_TREND_FACT_MIN_CANDLES = 4;
export const FIFTEEN_MINUTE_VOLUME_FACT_MIN_CANDLES = 4;

export type BuildFifteenMinuteFactsInput = {
  symbol: string;
  asOfTimestamp: number;
  referencePrice?: number;
  rawCandleCount: number;
  closedCandles: Candle[];
  excludedFutureCandleCount?: number;
  excludedPartialCandleCount?: number;
};

export type FifteenMinuteCandleWindowSummary = {
  firstClosedTimestamp?: number;
  lastClosedTimestamp?: number;
  recentHigh?: number;
  recentLow?: number;
  recentMidpoint?: number;
  recentHighTimestamp?: number;
  recentLowTimestamp?: number;
  latestRangePct?: number;
  averageRangePct?: number;
  rangeState: FifteenMinuteRangeState;
  referencePosition: FifteenMinuteReferencePosition;
  trendState: FifteenMinuteTrendState;
  higherCloseCount: number;
  lowerCloseCount: number;
  greenCandleCount: number;
  redCandleCount: number;
  latestCloseLocation: FifteenMinuteCloseLocation;
  volume?: FifteenMinuteVolumeFacts;
  structure: FifteenMinuteStructureFacts;
};

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isUsableNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function average(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rangePct(candle: Candle): number | undefined {
  if (candle.close === 0) {
    return undefined;
  }

  return Math.abs(candle.high - candle.low) / Math.abs(candle.close);
}

function candleCloseLocation(candle: Candle | undefined): FifteenMinuteCloseLocation {
  if (!candle || candle.high === candle.low) {
    return "unknown";
  }

  const lowerThird = candle.low + (candle.high - candle.low) / 3;
  const upperThird = candle.high - (candle.high - candle.low) / 3;
  if (candle.close <= lowerThird) {
    return "lower_third";
  }
  if (candle.close >= upperThird) {
    return "upper_third";
  }

  return "middle_third";
}

function referencePosition(params: {
  referencePrice?: number;
  recentHigh?: number;
  recentLow?: number;
}): FifteenMinuteReferencePosition {
  if (
    !isUsableNumber(params.referencePrice) ||
    !isUsableNumber(params.recentHigh) ||
    !isUsableNumber(params.recentLow) ||
    params.recentHigh <= params.recentLow
  ) {
    return "unknown";
  }

  if (params.referencePrice < params.recentLow) {
    return "below_recent_range";
  }
  if (params.referencePrice > params.recentHigh) {
    return "above_recent_range";
  }

  const lowerThird = params.recentLow + (params.recentHigh - params.recentLow) / 3;
  const upperThird = params.recentHigh - (params.recentHigh - params.recentLow) / 3;
  if (params.referencePrice <= lowerThird) {
    return "near_recent_low";
  }
  if (params.referencePrice >= upperThird) {
    return "near_recent_high";
  }

  return "inside_recent_range";
}

function rangeState(params: {
  latestRangePct?: number;
  averageRangePct?: number;
  enoughCandles: boolean;
}): FifteenMinuteRangeState {
  if (!params.enoughCandles || !isUsableNumber(params.latestRangePct) || !isUsableNumber(params.averageRangePct)) {
    return "unknown";
  }
  if (params.averageRangePct === 0) {
    return "unknown";
  }
  if (params.latestRangePct <= params.averageRangePct * 0.75) {
    return "compressed";
  }
  if (params.latestRangePct >= params.averageRangePct * 1.5) {
    return "expanded";
  }

  return "normal";
}

function trendState(params: {
  enoughCandles: boolean;
  higherCloseCount: number;
  lowerCloseCount: number;
  greenCandleCount: number;
  redCandleCount: number;
}): FifteenMinuteTrendState {
  if (!params.enoughCandles) {
    return "unknown";
  }

  if (
    Math.abs(params.higherCloseCount - params.lowerCloseCount) <= 1 &&
    Math.abs(params.greenCandleCount - params.redCandleCount) <= 1
  ) {
    return "sideways";
  }

  if (params.higherCloseCount >= params.lowerCloseCount + 2 && params.greenCandleCount >= params.redCandleCount) {
    return "up";
  }

  if (params.lowerCloseCount >= params.higherCloseCount + 2 && params.redCandleCount >= params.greenCandleCount) {
    return "down";
  }

  return "mixed";
}

function volumeState(relativeVolume: number | undefined, enoughCandles: boolean): FifteenMinuteVolumeState {
  if (!enoughCandles || !isUsableNumber(relativeVolume)) {
    return "unknown";
  }
  if (relativeVolume <= 0.75) {
    return "low";
  }
  if (relativeVolume < 1.25) {
    return "normal";
  }
  if (relativeVolume < 1.75) {
    return "elevated";
  }
  if (relativeVolume < 2.5) {
    return "high";
  }

  return "extreme";
}

function participationState(
  relativeVolume: number | undefined,
  enoughCandles: boolean,
): FifteenMinuteVolumeFacts["participationState"] {
  if (!enoughCandles || !isUsableNumber(relativeVolume)) {
    return "unknown";
  }
  if (relativeVolume <= 0.75) {
    return "fading";
  }
  if (relativeVolume >= 2.5) {
    return "surging";
  }
  if (relativeVolume >= 1.15) {
    return "building";
  }

  return "steady";
}

function structureState(params: {
  rangeState: FifteenMinuteRangeState;
  trendState: FifteenMinuteTrendState;
  latestClose?: number;
  previousClose?: number;
}): Pick<FifteenMinuteStructureFacts, "consolidationState" | "pullbackState" | "continuationState"> {
  const consolidationState: FifteenMinuteStructureState = params.rangeState === "compressed" ? "present" : "not_present";
  const continuationState: FifteenMinuteStructureState =
    params.rangeState === "expanded" && (params.trendState === "up" || params.trendState === "down")
      ? "present"
      : "not_present";
  const pullbackState: FifteenMinuteStructureState =
    isUsableNumber(params.latestClose) &&
    isUsableNumber(params.previousClose) &&
    params.rangeState !== "compressed" &&
    params.latestClose < params.previousClose
      ? "present"
      : "not_present";

  return {
    consolidationState,
    pullbackState,
    continuationState,
  };
}

export function summarizeFifteenMinuteCandleWindow(
  candles: Candle[],
  referencePrice?: number,
): FifteenMinuteCandleWindowSummary {
  const enoughForTrend = candles.length >= FIFTEEN_MINUTE_TREND_FACT_MIN_CANDLES;
  const enoughForVolume = candles.length >= FIFTEEN_MINUTE_VOLUME_FACT_MIN_CANDLES;
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const rangePcts = candles.map(rangePct).filter(isUsableNumber);
  const latestRangePct = latest ? rangePct(latest) : undefined;
  const averageRangePct = average(rangePcts);
  const recentHigh = highs.length > 0 ? Math.max(...highs) : undefined;
  const recentLow = lows.length > 0 ? Math.min(...lows) : undefined;
  const recentHighIndex = recentHigh === undefined ? -1 : candles.findIndex((candle) => candle.high === recentHigh);
  const recentLowIndex = recentLow === undefined ? -1 : candles.findIndex((candle) => candle.low === recentLow);
  const higherCloseCount = candles.reduce((count, candle, index) => {
    if (index === 0) {
      return count;
    }
    return candle.close > candles[index - 1].close ? count + 1 : count;
  }, 0);
  const lowerCloseCount = candles.reduce((count, candle, index) => {
    if (index === 0) {
      return count;
    }
    return candle.close < candles[index - 1].close ? count + 1 : count;
  }, 0);
  const greenCandleCount = candles.filter((candle) => candle.close >= candle.open).length;
  const redCandleCount = candles.filter((candle) => candle.close < candle.open).length;
  const resolvedRangeState = rangeState({
    latestRangePct,
    averageRangePct,
    enoughCandles: enoughForTrend,
  });
  const resolvedTrendState = trendState({
    enoughCandles: enoughForTrend,
    higherCloseCount,
    lowerCloseCount,
    greenCandleCount,
    redCandleCount,
  });
  const volumes = candles.map((candle) => candle.volume).filter(isUsableNumber);
  const latestVolume = latest?.volume;
  const rollingAverageVolume = average(volumes);
  const relativeVolume =
    isUsableNumber(latestVolume) && isUsableNumber(rollingAverageVolume) && rollingAverageVolume !== 0
      ? latestVolume / rollingAverageVolume
      : undefined;
  const structure = structureState({
    rangeState: resolvedRangeState,
    trendState: resolvedTrendState,
    latestClose: latest?.close,
    previousClose: previous?.close,
  });

  return {
    firstClosedTimestamp: candles.at(0)?.timestamp,
    lastClosedTimestamp: latest?.timestamp,
    recentHigh,
    recentLow,
    recentMidpoint:
      isUsableNumber(recentHigh) && isUsableNumber(recentLow) ? round((recentHigh + recentLow) / 2) : undefined,
    recentHighTimestamp: recentHighIndex >= 0 ? candles[recentHighIndex].timestamp : undefined,
    recentLowTimestamp: recentLowIndex >= 0 ? candles[recentLowIndex].timestamp : undefined,
    latestRangePct: isUsableNumber(latestRangePct) ? round(latestRangePct, 6) : undefined,
    averageRangePct: isUsableNumber(averageRangePct) ? round(averageRangePct, 6) : undefined,
    rangeState: resolvedRangeState,
    referencePosition: referencePosition({ referencePrice, recentHigh, recentLow }),
    trendState: resolvedTrendState,
    higherCloseCount,
    lowerCloseCount,
    greenCandleCount,
    redCandleCount,
    latestCloseLocation: candleCloseLocation(latest),
    volume:
      volumes.length > 0
        ? {
            volumeState: volumeState(relativeVolume, enoughForVolume),
            ...(isUsableNumber(latestVolume) ? { latestVolume } : {}),
            ...(isUsableNumber(rollingAverageVolume) ? { rollingAverageVolume: round(rollingAverageVolume) } : {}),
            ...(isUsableNumber(relativeVolume) ? { relativeVolume: round(relativeVolume, 4) } : {}),
            ...(isUsableNumber(latestVolume) && isUsableNumber(latest?.close)
              ? { dollarVolume: round(latestVolume * latest.close) }
              : {}),
            participationState: participationState(relativeVolume, enoughForVolume),
          }
        : undefined,
    structure: {
      ...structure,
      ...(recentHighIndex >= 0 ? { recentHighTimestamp: candles[recentHighIndex].timestamp } : {}),
      ...(recentLowIndex >= 0 ? { recentLowTimestamp: candles[recentLowIndex].timestamp } : {}),
    },
  };
}

export function buildUnavailableFifteenMinuteFactsFromInput(
  input: Omit<BuildFifteenMinuteFactsInput, "closedCandles"> & {
    closedCandles?: Candle[];
  },
): FifteenMinuteFacts {
  return createUnavailableFifteenMinuteFacts({
    symbol: input.symbol,
    asOfTimestamp: input.asOfTimestamp,
    rawCandleCount: input.rawCandleCount,
    excludedFutureCandleCount: input.excludedFutureCandleCount,
    excludedPartialCandleCount: input.excludedPartialCandleCount,
    limitations: [
      input.rawCandleCount > 0 ? "15m_closed_candles_missing" : "15m_input_not_provided",
      ...(input.excludedFutureCandleCount ? ["15m_future_candles_filtered" as const] : []),
      ...(input.excludedPartialCandleCount ? ["15m_partial_candles_filtered" as const] : []),
      "15m_facts_contract_only",
    ],
  });
}

function buildDiagnostics(params: {
  availabilityStatus: "limited" | "available";
  excludedFutureCandleCount: number;
  excludedPartialCandleCount: number;
}): FifteenMinuteFactDiagnostic[] {
  const diagnostics: FifteenMinuteFactDiagnostic[] = [
    {
      code: params.availabilityStatus === "available" ? "15m_facts_generated" : "15m_facts_limited",
      severity: "info",
      message:
        params.availabilityStatus === "available"
          ? "15m facts were built from closed candles at the as-of boundary."
          : "15m facts were built with limited closed-candle coverage.",
    },
  ];

  if (params.excludedFutureCandleCount > 0) {
    diagnostics.push({
      code: "15m_future_candles_filtered",
      severity: "info",
      message: "Future 15m candles were excluded at the as-of boundary.",
    });
  }

  if (params.excludedPartialCandleCount > 0) {
    diagnostics.push({
      code: "15m_partial_candles_filtered",
      severity: "info",
      message: "Still-forming 15m candles were excluded at the as-of boundary.",
    });
  }

  return diagnostics;
}

function buildLimitations(params: {
  enoughForTrend: boolean;
  enoughForVolume: boolean;
  excludedFutureCandleCount: number;
  excludedPartialCandleCount: number;
  referencePrice?: number;
}): FifteenMinuteFactLimitation[] {
  return [
    ...(!params.enoughForTrend ? ["15m_insufficient_trend_history" as const] : []),
    ...(!params.enoughForVolume ? ["15m_insufficient_volume_history" as const] : []),
    ...(params.excludedFutureCandleCount > 0 ? ["15m_future_candles_filtered" as const] : []),
    ...(params.excludedPartialCandleCount > 0 ? ["15m_partial_candles_filtered" as const] : []),
    ...(!isUsableNumber(params.referencePrice) ? ["15m_reference_price_missing"] : []),
  ];
}

function toRangeFacts(summary: FifteenMinuteCandleWindowSummary, candleCount: number): FifteenMinuteRangeFacts {
  return {
    lookbackCandleCount: candleCount,
    ...(isUsableNumber(summary.recentHigh) ? { recentHigh: summary.recentHigh } : {}),
    ...(isUsableNumber(summary.recentLow) ? { recentLow: summary.recentLow } : {}),
    ...(isUsableNumber(summary.recentMidpoint) ? { recentMidpoint: summary.recentMidpoint } : {}),
    ...(isUsableNumber(summary.latestRangePct) ? { latestRangePct: summary.latestRangePct } : {}),
    ...(isUsableNumber(summary.averageRangePct) ? { averageRangePct: summary.averageRangePct } : {}),
    rangeState: summary.rangeState,
    referencePosition: summary.referencePosition,
  };
}

function toTrendFacts(summary: FifteenMinuteCandleWindowSummary): FifteenMinuteTrendFacts {
  return {
    trendState: summary.trendState,
    higherCloseCount: summary.higherCloseCount,
    lowerCloseCount: summary.lowerCloseCount,
    greenCandleCount: summary.greenCandleCount,
    redCandleCount: summary.redCandleCount,
    latestCloseLocation: summary.latestCloseLocation,
  };
}

export function buildFifteenMinuteFacts(input: BuildFifteenMinuteFactsInput): FifteenMinuteFacts {
  const closedCandles = input.closedCandles.map((candle) => ({ ...candle }));
  const excludedFutureCandleCount = input.excludedFutureCandleCount ?? 0;
  const excludedPartialCandleCount = input.excludedPartialCandleCount ?? 0;

  if (closedCandles.length === 0) {
    return buildUnavailableFifteenMinuteFactsFromInput({
      ...input,
      excludedFutureCandleCount,
      excludedPartialCandleCount,
    });
  }

  const enoughForTrend = closedCandles.length >= FIFTEEN_MINUTE_TREND_FACT_MIN_CANDLES;
  const enoughForVolume =
    closedCandles.length >= FIFTEEN_MINUTE_VOLUME_FACT_MIN_CANDLES &&
    closedCandles.every((candle) => isUsableNumber(candle.volume));
  const availabilityStatus = enoughForTrend ? "available" : "limited";
  const summary = summarizeFifteenMinuteCandleWindow(closedCandles, input.referencePrice);

  return {
    schemaVersion: FIFTEEN_MINUTE_FACTS_SCHEMA_VERSION,
    symbol: normalizeSymbol(input.symbol),
    asOfTimestamp: input.asOfTimestamp,
    dataCompleteness: {
      availabilityStatus,
      provided: true,
      rawCandleCount: input.rawCandleCount,
      closedCandleCount: closedCandles.length,
      excludedFutureCandleCount,
      excludedPartialCandleCount,
      ...(isUsableNumber(summary.firstClosedTimestamp)
        ? { firstClosedTimestamp: summary.firstClosedTimestamp }
        : {}),
      ...(isUsableNumber(summary.lastClosedTimestamp) ? { lastClosedTimestamp: summary.lastClosedTimestamp } : {}),
      sufficientForTrendFacts: enoughForTrend,
      sufficientForVolumeFacts: enoughForVolume,
    },
    range: toRangeFacts(summary, closedCandles.length),
    trend: toTrendFacts(summary),
    ...(summary.volume ? { volume: summary.volume } : {}),
    structure: summary.structure,
    diagnostics: buildDiagnostics({
      availabilityStatus,
      excludedFutureCandleCount,
      excludedPartialCandleCount,
    }),
    limitations: buildLimitations({
      enoughForTrend,
      enoughForVolume,
      excludedFutureCandleCount,
      excludedPartialCandleCount,
      referencePrice: input.referencePrice,
    }),
    safety: {
      noLookaheadApplied: true,
      levelOutputUnchanged: true,
      factsOnly: true,
      noRuntimeBehaviorChange: true,
    },
  };
}
