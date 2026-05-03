import type { BaseCandleProviderResponse, Candle, CandleProviderName, CandleTimeframe } from "../market-data/candle-types.js";
import { CandleFetchService, type HistoricalFetchRequest } from "../market-data/candle-fetch-service.js";
import type { HistoricalCandleProvider, HistoricalFetchPlan } from "../market-data/provider-types.js";
import { LevelEngine, type LevelEngineRuntimeOptions } from "../levels/level-engine.js";
import type { LevelEngineConfig } from "../levels/level-config.js";
import type { LevelEngineOutput } from "../levels/level-types.js";
import {
  buildCandleMarketStructureContext,
  type CandleMarketStructureContext,
} from "../structure/index.js";
import {
  buildDynamicLevelsFromCandles,
  type DynamicLevelsFromCandles,
} from "./indicators/index.js";
import {
  buildGapStructure,
  type SharedGapStructure,
} from "./gap-structure.js";
import {
  buildReferenceLevels,
  type SharedReferenceLevels,
} from "./reference-levels.js";
import {
  buildTraderIntelligenceContext,
  type TraderIntelligenceContext,
} from "../trader-context/index.js";
import type { StockContextPreview } from "../stock-context/stock-context-types.js";

export type SharedCandleTimestamp = number | string | Date;

export type SharedSupportResistanceCandle = {
  symbol?: string;
  timestamp: SharedCandleTimestamp;
  timeframe?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number | null;
  tradeCount?: number | null;
  source?: string | null;
  sessionBucket?: string | null;
};

export type SupportResistanceCandleMap = {
  daily: SharedSupportResistanceCandle[];
  "4h": SharedSupportResistanceCandle[];
  "5m"?: SharedSupportResistanceCandle[];
};

export type NormalizedSupportResistanceCandleMap = {
  daily: Candle[];
  "4h": Candle[];
  "5m"?: Candle[];
};

export type SupportResistanceProviderByTimeframe = Partial<Record<CandleTimeframe, CandleProviderName>>;

export type BuildSupportResistanceContextRequest = {
  symbol: string;
  candlesByTimeframe: SupportResistanceCandleMap;
  asOfTimestamp?: SharedCandleTimestamp;
  sessionDate?: string;
  currentPrice?: number;
  bid?: number;
  ask?: number;
  stockContext?: StockContextPreview | null;
  knownCatalyst?: boolean;
  config?: LevelEngineConfig;
  runtimeOptions?: LevelEngineRuntimeOptions;
};

export type SupportResistanceContext = {
  symbol: string;
  levels: LevelEngineOutput;
  referenceLevels: SharedReferenceLevels;
  gapStructure: SharedGapStructure;
  dynamicLevels: DynamicLevelsFromCandles;
  marketStructure: CandleMarketStructureContext;
  traderContext: TraderIntelligenceContext;
};

export async function buildSupportResistanceContextFromNormalizedCandles(params: {
  symbol: string;
  candlesByTimeframe: NormalizedSupportResistanceCandleMap;
  sessionDate?: string;
  asOfTimestamp?: number;
  providerByTimeframe?: SupportResistanceProviderByTimeframe;
  currentPrice?: number;
  bid?: number;
  ask?: number;
  stockContext?: StockContextPreview | null;
  knownCatalyst?: boolean;
  config?: LevelEngineConfig;
  runtimeOptions?: LevelEngineRuntimeOptions;
}): Promise<SupportResistanceContext> {
  const provider = new InMemoryHistoricalCandleProvider(
    params.symbol,
    params.candlesByTimeframe,
    params.providerByTimeframe,
  );
  const fetchService = new CandleFetchService(provider);
  const engine = new LevelEngine(fetchService, params.config, params.runtimeOptions);

  const levels = await engine.generateLevels({
    symbol: params.symbol,
    historicalRequests: {
      daily: requestForSeries(params.symbol, "daily", params.candlesByTimeframe.daily),
      "4h": requestForSeries(params.symbol, "4h", params.candlesByTimeframe["4h"]),
      "5m": requestForSeries(params.symbol, "5m", params.candlesByTimeframe["5m"] ?? []),
    },
  });

  const currentPrice = params.currentPrice ?? params.candlesByTimeframe["5m"]?.at(-1)?.close;
  const referenceLevels = buildReferenceLevels({
    dailyCandles: params.candlesByTimeframe.daily,
    intradayCandles: params.candlesByTimeframe["5m"] ?? [],
    sessionDate: params.sessionDate,
  });
  const gapStructure = buildGapStructure({
    candles: params.candlesByTimeframe.daily,
    currentPrice,
  });
  const dynamicLevels = buildDynamicLevelsFromCandles(params.candlesByTimeframe["5m"], {
      sessionDate: params.sessionDate,
      emaPeriods: [9, 20],
      currentPrice,
    });

  return {
    symbol: params.symbol,
    levels,
    referenceLevels,
    gapStructure,
    dynamicLevels,
    marketStructure: buildCandleMarketStructureContext({
      symbol: params.symbol,
      candles: params.candlesByTimeframe["5m"] ?? [],
      asOfTimestamp: params.asOfTimestamp,
      currentPrice,
    }),
    traderContext: buildTraderIntelligenceContext({
      symbol: params.symbol,
      dailyCandles: params.candlesByTimeframe.daily,
      intradayCandles: params.candlesByTimeframe["5m"] ?? [],
      currentPrice,
      bid: params.bid,
      ask: params.ask,
      dynamicLevels,
      stockContext: params.stockContext,
      knownCatalyst: params.knownCatalyst,
      levels,
      timestamp: params.asOfTimestamp,
    }),
  };
}

function timeframeIntervalMs(timeframe: CandleTimeframe): number {
  switch (timeframe) {
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "4h":
      return 4 * 60 * 60 * 1000;
    case "5m":
      return 5 * 60 * 1000;
  }
}

export function parseSharedCandleTimestamp(timestamp: SharedCandleTimestamp): number {
  if (typeof timestamp === "number") {
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
    throw new Error("candle timestamp number must be finite.");
  }

  if (timestamp instanceof Date) {
    const value = timestamp.getTime();
    if (Number.isFinite(value)) {
      return value;
    }
    throw new Error("candle timestamp Date must be valid.");
  }

  const value = Date.parse(timestamp);
  if (Number.isFinite(value)) {
    return value;
  }
  throw new Error(`candle timestamp string is not parseable: ${timestamp}`);
}

function assertFinitePrice(value: number, field: keyof Candle): number {
  if (!Number.isFinite(value)) {
    throw new Error(`candle ${field} must be finite.`);
  }
  return value;
}

function normalizeCandle(candle: SharedSupportResistanceCandle): Candle {
  return {
    timestamp: parseSharedCandleTimestamp(candle.timestamp),
    open: assertFinitePrice(candle.open, "open"),
    high: assertFinitePrice(candle.high, "high"),
    low: assertFinitePrice(candle.low, "low"),
    close: assertFinitePrice(candle.close, "close"),
    volume: assertFinitePrice(candle.volume, "volume"),
  };
}

export function sortSharedCandles(candles: Candle[] | undefined): Candle[] {
  return [...(candles ?? [])].sort((left, right) => left.timestamp - right.timestamp);
}

export function normalizeSharedSupportResistanceCandles(
  candles: SharedSupportResistanceCandle[] | undefined,
  asOfTimestamp?: number,
): Candle[] {
  return sortSharedCandles(
    (candles ?? [])
      .map(normalizeCandle)
      .filter((candle) => asOfTimestamp === undefined || candle.timestamp <= asOfTimestamp),
  );
}

function requestForSeries(symbol: string, timeframe: CandleTimeframe, candles: Candle[]): HistoricalFetchRequest {
  return {
    symbol,
    timeframe,
    lookbackBars: Math.max(candles.length, 1),
    endTimeMs: candles.at(-1)?.timestamp ?? Date.now(),
    preferredProvider: "stub",
  };
}

class InMemoryHistoricalCandleProvider implements HistoricalCandleProvider {
  readonly providerName = "stub" as const;

  private readonly candlesByTimeframe: Record<CandleTimeframe, Candle[]>;

  constructor(
    symbol: string,
    candlesByTimeframe: NormalizedSupportResistanceCandleMap,
    private readonly providerByTimeframe: SupportResistanceProviderByTimeframe = {},
  ) {
    this.candlesByTimeframe = {
      daily: sortSharedCandles(candlesByTimeframe.daily),
      "4h": sortSharedCandles(candlesByTimeframe["4h"]),
      "5m": sortSharedCandles(candlesByTimeframe["5m"]),
    };
    for (const [timeframe, candles] of Object.entries(this.candlesByTimeframe) as Array<[CandleTimeframe, Candle[]]>) {
      if (timeframe !== "5m" && candles.length === 0) {
        throw new Error(`${symbol.toUpperCase()} requires ${timeframe} candles to build support/resistance context.`);
      }
    }
  }

  async fetchCandles(
    request: HistoricalFetchRequest,
    plan: HistoricalFetchPlan,
  ): Promise<BaseCandleProviderResponse> {
    if (request.timeframe === "1m") {
      throw new Error("In-memory support/resistance context provider does not serve 1m candles.");
    }
    const candles = this.candlesByTimeframe[request.timeframe] ?? [];
    const requestedEndTimestamp = request.endTimeMs ?? candles.at(-1)?.timestamp ?? Date.now();
    const intervalMs = timeframeIntervalMs(request.timeframe);
    const requestedStartTimestamp =
      candles[0]?.timestamp ??
      requestedEndTimestamp - Math.max(request.lookbackBars, plan.plannedBarCount, 1) * intervalMs;

    return {
      provider: this.providerByTimeframe[request.timeframe] ?? this.providerName,
      symbol: request.symbol.toUpperCase(),
      timeframe: request.timeframe,
      requestedLookbackBars: Math.max(request.lookbackBars, candles.length, 1),
      candles,
      fetchStartTimestamp: Date.now(),
      fetchEndTimestamp: Date.now(),
      requestedStartTimestamp,
      requestedEndTimestamp,
      sessionMetadataAvailable: request.timeframe === "5m",
      providerMetadata: {
        source: "provided_candles",
      },
    };
  }
}

export async function buildSupportResistanceContextFromCandles(
  request: BuildSupportResistanceContextRequest,
): Promise<SupportResistanceContext> {
  const symbol = request.symbol.trim().toUpperCase();
  if (!symbol) {
    throw new Error("symbol is required.");
  }

  const asOfTimestamp =
    request.asOfTimestamp === undefined ? undefined : parseSharedCandleTimestamp(request.asOfTimestamp);
  const normalizedCandles: NormalizedSupportResistanceCandleMap = {
    daily: normalizeSharedSupportResistanceCandles(request.candlesByTimeframe.daily, asOfTimestamp),
    "4h": normalizeSharedSupportResistanceCandles(request.candlesByTimeframe["4h"], asOfTimestamp),
    "5m": normalizeSharedSupportResistanceCandles(request.candlesByTimeframe["5m"], asOfTimestamp),
  };
  return buildSupportResistanceContextFromNormalizedCandles({
    symbol,
    candlesByTimeframe: normalizedCandles,
    sessionDate: request.sessionDate,
    asOfTimestamp,
    currentPrice: request.currentPrice,
    bid: request.bid,
    ask: request.ask,
    stockContext: request.stockContext,
    knownCatalyst: request.knownCatalyst,
    config: request.config,
    runtimeOptions: request.runtimeOptions,
  });
}
