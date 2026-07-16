// 2026-05-27 09:20 PM America/Toronto
// Rescue-only multi-timeframe support/resistance context composed from closed candles only.

import type { Candle, CandleTimeframe } from "../market-data/candle-types.js";
import type { CandleAsOfFilterDiagnostic } from "../market-data/candle-as-of-filter.js";
import { buildLevelAnalysisSnapshotFromCandles } from "../analysis/level-analysis-snapshot-from-candles.js";
import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";
import {
  buildSingleTimeframeSupportResistanceContext,
  type SharedSupportResistanceLevel,
  type SingleTimeframeSupportResistanceContext,
} from "./single-timeframe-context.js";

export type SymbolSupportResistanceContext = {
  symbol: string;
  asOfTimestamp?: number;
  timeframes: Partial<Record<CandleTimeframe, SingleTimeframeSupportResistanceContext>>;
  levels: SharedSupportResistanceLevel[];
  finalLevelZones: FinalLevelZone[];
  levelEngineOutput?: LevelEngineOutput;
  diagnostics: CandleAsOfFilterDiagnostic[];
};

export type BuildSymbolSupportResistanceContextRequest = {
  symbol: string;
  candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>>;
  asOfTimestamp?: number | null;
};

const TIMEFRAMES: readonly CandleTimeframe[] = ["daily", "4h", "5m"];

function newestCandleTimestamp(
  candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>>,
): number | undefined {
  const timestamps = Object.values(candlesByTimeframe)
    .flatMap((candles) => candles ?? [])
    .map((candle) => candle.timestamp)
    .filter((timestamp) => Number.isFinite(timestamp));

  return timestamps.length === 0 ? undefined : Math.max(...timestamps);
}

function flattenLevelEngineOutput(output: LevelEngineOutput): FinalLevelZone[] {
  return [
    ...output.majorSupport,
    ...output.majorResistance,
    ...output.intermediateSupport,
    ...output.intermediateResistance,
    ...output.intradaySupport,
    ...output.intradayResistance,
    ...output.extensionLevels.support,
    ...output.extensionLevels.resistance,
  ];
}

function buildRichLevelEngineOutput(
  request: BuildSymbolSupportResistanceContextRequest,
): LevelEngineOutput | undefined {
  const asOfTimestamp =
    request.asOfTimestamp ?? newestCandleTimestamp(request.candlesByTimeframe);

  if (asOfTimestamp === undefined || !Number.isFinite(asOfTimestamp)) {
    return undefined;
  }

  return buildLevelAnalysisSnapshotFromCandles({
    symbol: request.symbol,
    asOfTimestamp,
    candles5m: request.candlesByTimeframe["5m"] ?? [],
    dailyCandles: request.candlesByTimeframe.daily,
    fourHourCandles: request.candlesByTimeframe["4h"],
  }).levelEngineOutput;
}

export function buildSymbolSupportResistanceContext(
  request: BuildSymbolSupportResistanceContextRequest,
): SymbolSupportResistanceContext {
  const timeframes: Partial<Record<CandleTimeframe, SingleTimeframeSupportResistanceContext>> = {};

  for (const timeframe of TIMEFRAMES) {
    const candles = request.candlesByTimeframe[timeframe];
    if (!candles) {
      continue;
    }

    timeframes[timeframe] = buildSingleTimeframeSupportResistanceContext({
      symbol: request.symbol,
      timeframe,
      candles,
      asOfTimestamp: request.asOfTimestamp,
    });
  }

  const contexts = Object.values(timeframes);
  const levelEngineOutput = buildRichLevelEngineOutput(request);

  return {
    symbol: request.symbol.toUpperCase(),
    asOfTimestamp: request.asOfTimestamp ?? undefined,
    timeframes,
    levels: contexts.flatMap((context) => context.levels),
    finalLevelZones: levelEngineOutput ? flattenLevelEngineOutput(levelEngineOutput) : [],
    levelEngineOutput,
    diagnostics: contexts.flatMap((context) => context.diagnostics),
  };
}
