// 2026-05-27 09:20 PM America/Toronto
// Execution-facing support/resistance context with no-lookahead filtering and VWAP kept as market facts.

import type { Candle, CandleTimeframe } from "../market-data/candle-types.js";
import {
  buildSupportResistanceContext,
  type SupportResistanceContext,
} from "./build-support-resistance-context.js";
import type { SharedSupportResistanceLevel } from "./single-timeframe-context.js";

export type TradeAnalysisSupportResistanceContext = {
  symbol: string;
  executionTimestamp: number;
  supportResistance: SupportResistanceContext;
  nearestSupport?: SharedSupportResistanceLevel;
  nearestResistance?: SharedSupportResistanceLevel;
  marketFacts: {
    vwapByTimeframe: Partial<Record<CandleTimeframe, number>>;
  };
  traderInterpretation: {
    factsAllowedToInfluenceInterpretation: string[];
  };
};

export type BuildTradeAnalysisSupportResistanceContextRequest = {
  symbol: string;
  executionTimestamp: number;
  referencePrice: number;
  candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>>;
  allowVwapInTraderInterpretation?: boolean;
};

function nearestLevel(
  levels: SharedSupportResistanceLevel[],
  kind: SharedSupportResistanceLevel["kind"],
  referencePrice: number,
): SharedSupportResistanceLevel | undefined {
  return levels
    .filter((level) => level.kind === kind)
    .filter((level) => (kind === "support" ? level.price <= referencePrice : level.price >= referencePrice))
    .sort((left, right) => Math.abs(left.price - referencePrice) - Math.abs(right.price - referencePrice))[0];
}

function computeVwap(candles: Candle[]): number | undefined {
  const volume = candles.reduce((sum, candle) => sum + candle.volume, 0);
  if (volume <= 0) {
    return undefined;
  }

  const notional = candles.reduce((sum, candle) => {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    return sum + typicalPrice * candle.volume;
  }, 0);

  return Number((notional / volume).toFixed(4));
}

export function buildTradeAnalysisSupportResistanceContext(
  request: BuildTradeAnalysisSupportResistanceContextRequest,
): TradeAnalysisSupportResistanceContext {
  const supportResistance = buildSupportResistanceContext({
    symbol: request.symbol,
    candlesByTimeframe: request.candlesByTimeframe,
    asOfTimestamp: request.executionTimestamp,
  });
  const vwapByTimeframe: Partial<Record<CandleTimeframe, number>> = {};

  for (const [timeframe, context] of Object.entries(supportResistance.timeframes) as Array<
    [CandleTimeframe, NonNullable<SupportResistanceContext["timeframes"][CandleTimeframe]>]
  >) {
    const vwap = computeVwap(context.candles);
    if (vwap !== undefined) {
      vwapByTimeframe[timeframe] = vwap;
    }
  }

  return {
    symbol: request.symbol.toUpperCase(),
    executionTimestamp: request.executionTimestamp,
    supportResistance,
    nearestSupport: nearestLevel(supportResistance.levels, "support", request.referencePrice),
    nearestResistance: nearestLevel(supportResistance.levels, "resistance", request.referencePrice),
    marketFacts: {
      vwapByTimeframe,
    },
    traderInterpretation: {
      factsAllowedToInfluenceInterpretation: request.allowVwapInTraderInterpretation ? ["vwap"] : [],
    },
  };
}
