// 2026-05-27 09:20 PM America/Toronto
// Rescue-only single-timeframe support/resistance context with candle-close as-of safety.

import type { Candle, CandleTimeframe } from "../market-data/candle-types.js";
import {
  filterCandlesByCloseAsOf,
  type CandleAsOfFilterDiagnostic,
} from "../market-data/candle-as-of-filter.js";

export type SharedSupportResistanceLevel = {
  symbol: string;
  timeframe: CandleTimeframe;
  kind: "support" | "resistance";
  price: number;
  sourceTimestamp: number;
};

export type SingleTimeframeSupportResistanceContext = {
  symbol: string;
  timeframe: CandleTimeframe;
  asOfTimestamp?: number;
  candles: Candle[];
  levels: SharedSupportResistanceLevel[];
  diagnostics: CandleAsOfFilterDiagnostic[];
};

export type BuildSingleTimeframeSupportResistanceContextRequest = {
  symbol: string;
  timeframe: CandleTimeframe;
  candles: Candle[];
  asOfTimestamp?: number | null;
};

function roundPrice(value: number): number {
  return Number(value.toFixed(4));
}

function buildLevels(
  symbol: string,
  timeframe: CandleTimeframe,
  candles: Candle[],
): SharedSupportResistanceLevel[] {
  return candles.flatMap((candle) => [
    {
      symbol: symbol.toUpperCase(),
      timeframe,
      kind: "support" as const,
      price: roundPrice(candle.low),
      sourceTimestamp: candle.timestamp,
    },
    {
      symbol: symbol.toUpperCase(),
      timeframe,
      kind: "resistance" as const,
      price: roundPrice(candle.high),
      sourceTimestamp: candle.timestamp,
    },
  ]);
}

export function buildSingleTimeframeSupportResistanceContext(
  request: BuildSingleTimeframeSupportResistanceContextRequest,
): SingleTimeframeSupportResistanceContext {
  const filtered = filterCandlesByCloseAsOf({
    candles: request.candles,
    timeframe: request.timeframe,
    asOfTimestamp: request.asOfTimestamp,
  });

  return {
    symbol: request.symbol.toUpperCase(),
    timeframe: request.timeframe,
    asOfTimestamp: request.asOfTimestamp ?? undefined,
    candles: filtered.candles,
    levels: buildLevels(request.symbol, request.timeframe, filtered.candles),
    diagnostics: filtered.diagnostics,
  };
}
