// 2026-05-27 09:20 PM America/Toronto
// Rescue-only multi-timeframe support/resistance context composed from closed candles only.

import type { Candle, CandleTimeframe } from "../market-data/candle-types.js";
import type { CandleAsOfFilterDiagnostic } from "../market-data/candle-as-of-filter.js";
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
  diagnostics: CandleAsOfFilterDiagnostic[];
};

export type BuildSymbolSupportResistanceContextRequest = {
  symbol: string;
  candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>>;
  asOfTimestamp?: number | null;
};

const TIMEFRAMES: readonly CandleTimeframe[] = ["daily", "4h", "5m"];

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

  return {
    symbol: request.symbol.toUpperCase(),
    asOfTimestamp: request.asOfTimestamp ?? undefined,
    timeframes,
    levels: contexts.flatMap((context) => context.levels),
    diagnostics: contexts.flatMap((context) => context.diagnostics),
  };
}
