import { DEFAULT_LEVEL_ENGINE_CONFIG, type LevelEngineConfig } from "../levels/level-config.js";
import { clusterRawLevelCandidates } from "../levels/level-clusterer.js";
import { rankLevelZones } from "../levels/level-ranker.js";
import { scoreLevelZones } from "../levels/level-scorer.js";
import { buildSpecialLevelCandidates } from "../levels/special-level-builder.js";
import { detectSwingPoints } from "../levels/swing-detector.js";
import { buildRawLevelCandidates } from "../levels/raw-level-candidate-builder.js";
import type { LevelDataFreshness, LevelEngineOutput, RawLevelCandidate } from "../levels/level-types.js";
import {
  buildMarketContextAnalysis,
  type MarketContextProfile,
} from "../market-context/index.js";
import {
  candleCloseTimestamp,
  filterCandlesByCloseAsOf,
  type CandleAsOfFilterDiagnostic,
} from "../market-data/candle-as-of-filter.js";
import type { Candle, CandleTimeframe } from "../market-data/candle-types.js";
import { buildSessionMarketFacts } from "../session/index.js";
import { buildVolumeMarketFacts, detectVolumeShelves } from "../volume/index.js";
import {
  buildLevelAnalysisSnapshot,
  type LevelAnalysisSnapshot,
} from "./level-analysis-snapshot.js";

export type LevelAnalysisSnapshotFromCandlesInput = {
  symbol: string;
  asOfTimestamp: number;
  referencePrice?: number;
  candles5m: Candle[];
  dailyCandles?: Candle[];
  fourHourCandles?: Candle[];
  previousClose?: number;
  config?: LevelEngineConfig;
};

type FilteredSeries = {
  timeframe: CandleTimeframe;
  candles: Candle[];
  diagnostics: CandleAsOfFilterDiagnostic[];
  excludedFutureCount: number;
  excludedPartialCount: number;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function filterSeries(
  timeframe: CandleTimeframe,
  candles: Candle[] | undefined,
  asOfTimestamp: number,
): FilteredSeries {
  const filtered = filterCandlesByCloseAsOf({
    candles: clone(candles ?? []),
    timeframe,
    asOfTimestamp,
  });

  return {
    timeframe,
    candles: filtered.candles,
    diagnostics: filtered.diagnostics,
    excludedFutureCount: filtered.excludedFutureCount,
    excludedPartialCount: filtered.excludedPartialCount,
  };
}

function deriveReferencePrice(request: LevelAnalysisSnapshotFromCandlesInput, fiveMinute: Candle[]): number | undefined {
  return request.referencePrice ?? fiveMinute.at(-1)?.close;
}

function deriveFreshness(series: FilteredSeries[], asOfTimestamp: number): LevelDataFreshness {
  const latestClose = Math.max(
    0,
    ...series.flatMap((item) =>
      item.candles.map((candle) => candleCloseTimestamp(candle, item.timeframe)),
    ),
  );
  if (latestClose === 0) {
    return "stale";
  }

  const ageHours = (asOfTimestamp - latestClose) / (1000 * 60 * 60);
  return ageHours <= 24 ? "fresh" : ageHours <= 24 * 7 ? "aging" : "stale";
}

function providerByTimeframe(series: FilteredSeries[]): LevelEngineOutput["metadata"]["providerByTimeframe"] {
  const provider: LevelEngineOutput["metadata"]["providerByTimeframe"] = {};
  for (const item of series) {
    if (item.candles.length > 0) {
      provider[item.timeframe] = "stub";
    }
  }
  return provider;
}

function dataQualityFlags(series: FilteredSeries[]): string[] {
  return series
    .filter((item) => item.candles.length === 0)
    .map((item) => `${item.timeframe}:unavailable`);
}

function buildCandidateInventory(params: {
  symbol: string;
  config: LevelEngineConfig;
  series: FilteredSeries[];
}): {
  rawCandidates: RawLevelCandidate[];
  specialLevels: LevelEngineOutput["specialLevels"];
} {
  const rawCandidates: RawLevelCandidate[] = [];

  for (const item of params.series) {
    if (item.candles.length === 0) {
      continue;
    }

    const timeframeConfig = params.config.timeframeConfig[item.timeframe];
    const swings = detectSwingPoints(item.candles, {
      swingWindow: timeframeConfig.swingWindow,
      minimumDisplacementPct: timeframeConfig.minimumDisplacementPct,
      minimumSeparationBars: timeframeConfig.minimumSwingSeparationBars,
    });

    rawCandidates.push(
      ...buildRawLevelCandidates({
        symbol: params.symbol,
        timeframe: item.timeframe,
        candles: item.candles,
        swings,
      }),
    );
  }

  const fiveMinute = params.series.find((item) => item.timeframe === "5m")?.candles ?? [];
  const special = buildSpecialLevelCandidates(params.symbol, fiveMinute);
  rawCandidates.push(...special.candidates);

  return {
    rawCandidates,
    specialLevels: special.summary,
  };
}

function buildLevelOutputFromFilteredCandles(params: {
  symbol: string;
  asOfTimestamp: number;
  referencePrice?: number;
  config: LevelEngineConfig;
  series: FilteredSeries[];
}): LevelEngineOutput {
  const inventory = buildCandidateInventory({
    symbol: params.symbol,
    config: params.config,
    series: params.series,
  });
  const supportTolerance = Math.max(
    params.config.timeframeConfig.daily.clusterTolerancePct,
    params.config.timeframeConfig["4h"].clusterTolerancePct,
  );
  const resistanceTolerance = supportTolerance;
  const supportZones = scoreLevelZones(
    clusterRawLevelCandidates(
      params.symbol,
      "support",
      inventory.rawCandidates,
      supportTolerance,
      params.config,
    ),
    params.config,
  );
  const resistanceZones = scoreLevelZones(
    clusterRawLevelCandidates(
      params.symbol,
      "resistance",
      inventory.rawCandidates,
      resistanceTolerance,
      params.config,
    ),
    params.config,
  );
  const ranked = rankLevelZones({
    symbol: params.symbol,
    supportZones,
    resistanceZones,
    specialLevels: inventory.specialLevels,
    metadata: {
      providerByTimeframe: providerByTimeframe(params.series),
      dataQualityFlags: dataQualityFlags(params.series),
      freshness: deriveFreshness(params.series, params.asOfTimestamp),
      referencePrice: params.referencePrice,
    },
    config: params.config,
  });

  return {
    ...ranked,
    generatedAt: params.asOfTimestamp,
  };
}

function diagnosticSummary(params: {
  series: FilteredSeries[];
  marketContext?: MarketContextProfile;
  builtMarketContext: boolean;
  hasDaily: boolean;
  hasFourHour: boolean;
  referencePrice?: number;
}): string[] {
  const diagnostics = new Set<string>();

  for (const item of params.series) {
    if (item.candles.length === 0) {
      diagnostics.add(`${item.timeframe}_closed_candles_missing`);
    }
  }

  diagnostics.add("candle_close_as_of_filter_applied");

  if (!params.hasDaily) {
    diagnostics.add("daily_candles_missing");
  }
  if (!params.hasFourHour) {
    diagnostics.add("4h_candles_missing");
  }
  if (params.referencePrice === undefined) {
    diagnostics.add("reference_price_missing");
  }
  if (!params.builtMarketContext) {
    diagnostics.add("market_context_not_built");
  }
  if (!params.marketContext) {
    diagnostics.add("market_context_missing");
  }

  return [...diagnostics].sort();
}

export function buildLevelAnalysisSnapshotFromCandles(
  request: LevelAnalysisSnapshotFromCandlesInput,
): LevelAnalysisSnapshot {
  const symbol = normalizeSymbol(request.symbol);
  const config = request.config ?? DEFAULT_LEVEL_ENGINE_CONFIG;
  const fiveMinute = filterSeries("5m", request.candles5m, request.asOfTimestamp);
  const daily = filterSeries("daily", request.dailyCandles, request.asOfTimestamp);
  const fourHour = filterSeries("4h", request.fourHourCandles, request.asOfTimestamp);
  const series = [daily, fourHour, fiveMinute];
  const referencePrice = deriveReferencePrice(request, fiveMinute.candles);
  const levelEngineOutput = buildLevelOutputFromFilteredCandles({
    symbol,
    asOfTimestamp: request.asOfTimestamp,
    referencePrice,
    config,
    series,
  });
  const sessionFacts = buildSessionMarketFacts({
    symbol,
    asOfTimestamp: request.asOfTimestamp,
    candles5m: fiveMinute.candles,
    previousClose: request.previousClose,
    currentPrice: referencePrice,
  });
  const volumeFacts = buildVolumeMarketFacts({
    symbol,
    asOfTimestamp: request.asOfTimestamp,
    candles5m: fiveMinute.candles,
    referencePrice,
  });
  const shelfResult = detectVolumeShelves({
    symbol,
    asOfTimestamp: request.asOfTimestamp,
    candles5m: fiveMinute.candles,
    currentPrice: referencePrice,
  });
  const marketContextResult =
    referencePrice !== undefined && fiveMinute.candles.length > 0
      ? buildMarketContextAnalysis({
          symbol,
          asOfTimestamp: request.asOfTimestamp,
          referencePrice,
          candles5m: fiveMinute.candles,
          previousClose: request.previousClose,
          vwap: sessionFacts.vwap,
          relativeVolume: volumeFacts.relativeVolume,
          dollarVolume: volumeFacts.dollarVolume,
        })
      : undefined;
  const snapshot = buildLevelAnalysisSnapshot({
    symbol,
    asOfTimestamp: request.asOfTimestamp,
    referencePrice,
    levelEngineOutput,
    closedCandles: {
      fiveMinute: fiveMinute.candles,
      fourHour: fourHour.candles,
      daily: daily.candles,
    },
    sessionFacts,
    volumeFacts,
    volumeShelves: shelfResult.shelves,
    marketContext: marketContextResult?.marketContext.profile,
  });
  const diagnostics = diagnosticSummary({
    series,
    marketContext: marketContextResult?.marketContext.profile,
    builtMarketContext: marketContextResult !== undefined,
    hasDaily: daily.candles.length > 0,
    hasFourHour: fourHour.candles.length > 0,
    referencePrice,
  });

  return {
    ...snapshot,
    diagnostics: [...new Set([...snapshot.diagnostics, ...diagnostics])].sort(),
    levelEngineOutput: {
      ...snapshot.levelEngineOutput,
      metadata: {
        ...snapshot.levelEngineOutput.metadata,
        referencePrice: referencePrice === undefined ? undefined : round(referencePrice),
      },
    },
  };
}
