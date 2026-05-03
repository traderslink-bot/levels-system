import {
  CandleFetchService,
  type CandleFetchServiceOptions,
  type HistoricalFetchRequest,
} from "../market-data/candle-fetch-service.js";
import type { Candle, CandleFetchTimeframe } from "../market-data/candle-types.js";
import {
  buildCandleMarketStructureContext,
  type CandleMarketStructureContext,
} from "../structure/index.js";
import {
  buildDynamicLevelsFromCandles,
  type DynamicLevelsFromCandles,
} from "./indicators/index.js";
import {
  normalizeSharedSupportResistanceCandles,
  parseSharedCandleTimestamp,
  type SharedCandleTimestamp,
  type SharedSupportResistanceCandle,
} from "./build-support-resistance-context.js";

export type SingleTimeframeSupportResistanceDiagnosticCode =
  | "single_timeframe_partial_context"
  | "missing_higher_timeframe_candles"
  | "aggregated_1m_to_5m"
  | "no_support_resistance_levels_generated";

export type SingleTimeframeSupportResistanceDiagnostic = {
  code: SingleTimeframeSupportResistanceDiagnosticCode;
  severity: "info" | "warning";
  message: string;
};

export type SharedSingleTimeframe = "1m" | "5m";

export type SingleTimeframeSupportResistanceContext = {
  symbol: string;
  mode: "single_timeframe";
  completeness: "partial";
  sourceTimeframe: SharedSingleTimeframe;
  candles: Candle[];
  aggregatedCandles: {
    "5m": Candle[];
  };
  dynamicLevels: DynamicLevelsFromCandles;
  marketStructure: CandleMarketStructureContext;
  levels: null;
  diagnostics: SingleTimeframeSupportResistanceDiagnostic[];
};

export type BuildSingleTimeframeSupportResistanceContextRequest = {
  symbol: string;
  timeframe: SharedSingleTimeframe;
  candles: SharedSupportResistanceCandle[];
  asOfTimestamp?: SharedCandleTimestamp;
  sessionDate?: string;
};

export type FetchSingleTimeframeSupportResistanceContextRequest = {
  symbol: string;
  timeframe?: SharedSingleTimeframe;
  lookbackBars: number;
  endTimeMs?: number;
  asOfTimestamp?: SharedCandleTimestamp;
  sessionDate?: string;
  fetchService?: CandleFetchService;
  fetchServiceOptions?: CandleFetchServiceOptions;
  preferredProvider?: HistoricalFetchRequest["preferredProvider"];
};

function assertSharedSingleTimeframe(timeframe: CandleFetchTimeframe): asserts timeframe is SharedSingleTimeframe {
  if (timeframe !== "1m" && timeframe !== "5m") {
    throw new Error(`single-timeframe context only supports 1m or 5m candles, received ${timeframe}.`);
  }
}

function bucketStart(timestamp: number, intervalMs: number): number {
  return Math.floor(timestamp / intervalMs) * intervalMs;
}

export function aggregateCandlesToFiveMinutes(candles: Candle[]): Candle[] {
  const sorted = [...candles].sort((left, right) => left.timestamp - right.timestamp);
  const buckets = new Map<number, Candle[]>();
  for (const candle of sorted) {
    const start = bucketStart(candle.timestamp, 5 * 60 * 1000);
    const bucket = buckets.get(start) ?? [];
    bucket.push(candle);
    buckets.set(start, bucket);
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

function buildDiagnostics(
  sourceTimeframe: SharedSingleTimeframe,
): SingleTimeframeSupportResistanceDiagnostic[] {
  return [
    {
      code: "single_timeframe_partial_context",
      severity: "info",
      message:
        "Single-timeframe context is dynamic/intraday-only and does not replace full daily plus 4h support/resistance.",
    },
    {
      code: "missing_higher_timeframe_candles",
      severity: "warning",
      message:
        "Daily and 4h candles are required for full support/resistance levels; no higher-timeframe levels were generated.",
    },
    ...(sourceTimeframe === "1m"
      ? [
          {
            code: "aggregated_1m_to_5m" as const,
            severity: "info" as const,
            message:
              "1-minute candles were aggregated into 5-minute candles for shared VWAP/EMA dynamic context.",
          },
        ]
      : []),
    {
      code: "no_support_resistance_levels_generated",
      severity: "info",
      message:
        "The levels field is null by design for single-timeframe context so consumers do not mistake intraday-only data for the full level engine output.",
    },
  ];
}

export function buildSupportResistanceContextFromSingleTimeframeCandles(
  request: BuildSingleTimeframeSupportResistanceContextRequest,
): SingleTimeframeSupportResistanceContext {
  const symbol = request.symbol.trim().toUpperCase();
  if (!symbol) {
    throw new Error("symbol is required.");
  }
  assertSharedSingleTimeframe(request.timeframe);
  const asOfTimestamp =
    request.asOfTimestamp === undefined ? undefined : parseSharedCandleTimestamp(request.asOfTimestamp);
  const candles = normalizeSharedSupportResistanceCandles(request.candles, asOfTimestamp);
  const fiveMinuteCandles =
    request.timeframe === "1m" ? aggregateCandlesToFiveMinutes(candles) : candles;
  const marketStructure = buildCandleMarketStructureContext({
    symbol,
    candles: fiveMinuteCandles,
    asOfTimestamp,
    currentPrice: fiveMinuteCandles.at(-1)?.close,
    options: {
      sourceTimeframe: request.timeframe,
    },
  });

  return {
    symbol,
    mode: "single_timeframe",
    completeness: "partial",
    sourceTimeframe: request.timeframe,
    candles,
    aggregatedCandles: {
      "5m": fiveMinuteCandles,
    },
    dynamicLevels: buildDynamicLevelsFromCandles(fiveMinuteCandles, {
      sessionDate: request.sessionDate,
      emaPeriods: [9, 20],
      currentPrice: fiveMinuteCandles.at(-1)?.close,
    }),
    marketStructure,
    levels: null,
    diagnostics: buildDiagnostics(request.timeframe),
  };
}

export async function fetchSupportResistanceContextFromSingleTimeframeCandles(
  request: FetchSingleTimeframeSupportResistanceContextRequest,
): Promise<SingleTimeframeSupportResistanceContext> {
  const symbol = request.symbol.trim().toUpperCase();
  if (!symbol) {
    throw new Error("symbol is required.");
  }
  const timeframe = request.timeframe ?? "1m";
  assertSharedSingleTimeframe(timeframe);
  const fetchService =
    request.fetchService ??
    new CandleFetchService({
      ...request.fetchServiceOptions,
      providerName: request.preferredProvider ?? request.fetchServiceOptions?.providerName,
    });
  const endTimeMs =
    request.endTimeMs ??
    (request.asOfTimestamp === undefined
      ? undefined
      : parseSharedCandleTimestamp(request.asOfTimestamp));
  const response = await fetchService.fetchCandles({
    symbol,
    timeframe,
    lookbackBars: request.lookbackBars,
    endTimeMs,
    preferredProvider: request.preferredProvider,
  });

  return buildSupportResistanceContextFromSingleTimeframeCandles({
    symbol,
    timeframe,
    candles: response.candles,
    asOfTimestamp: request.asOfTimestamp ?? endTimeMs,
    sessionDate: request.sessionDate,
  });
}
