import type { Candle } from "../market-data/candle-types.js";
import {
  buildSupportResistanceContext,
  type SupportResistanceContext,
} from "./build-support-resistance-context.js";

export type CandleFetchTimeframe = "daily" | "4h" | "5m" | "1m";

export type HistoricalFetchRequest = {
  symbol: string;
  timeframe: CandleFetchTimeframe;
  lookbackBars: number;
  preferredProvider?: "ibkr" | "stub";
};

export type HistoricalFetchPlan = {
  requestStartTimestamp: number;
  requestEndTimestamp: number;
  sessionMetadataAvailable: boolean;
};

export type HistoricalCandleProviderResponse = {
  provider: "ibkr" | "stub" | "twelve_data";
  symbol: string;
  timeframe: CandleFetchTimeframe;
  requestedLookbackBars: number;
  candles: Candle[];
  fetchStartTimestamp: number;
  fetchEndTimestamp: number;
  requestedStartTimestamp: number;
  requestedEndTimestamp: number;
  sessionMetadataAvailable: boolean;
  providerMetadata?: Record<string, string | number | boolean | null>;
};

export interface HistoricalCandleProvider {
  readonly providerName: "ibkr" | "stub" | "twelve_data";
  fetchCandles(
    request: HistoricalFetchRequest,
    plan: HistoricalFetchPlan,
  ): Promise<HistoricalCandleProviderResponse>;
}

export class CandleFetchService {
  constructor(readonly provider: HistoricalCandleProvider) {}
}

export type TradeAnalysisCandleWindowOptions = {
  timeframe?: "1m" | "5m";
  fallbackTimeframe?: "5m";
  allowFiveMinuteFallback?: boolean;
  preTradeMinutes?: number;
  postTradeMinutes?: number;
  paddingMinutes?: number;
  lookbackBars?: number;
};

export type DynamicLevelsFromCandles = {
  vwap: number | null;
  ema9: number | null;
  ema20: number | null;
};

export type TradeAnalysisExecutionInput = {
  timestamp: string | number | Date;
  price?: number;
  quantity?: number;
  side?: "buy" | "sell" | "unknown";
};

export type TradeAnalysisMoveWindowFact = {
  startTimestamp: number;
  startTimestampIso: string;
  endTimestamp: number;
  endTimestampIso: string;
  price: number;
  movePctFromReference: number;
};

export type TradeAnalysisTradeWindowFacts = {
  referenceExecutionTimestamp: number | null;
  referenceExecutionTimestampIso: string | null;
  referencePrice: number | null;
  referenceSide: "buy" | "sell" | "unknown" | null;
  highestHighDuringTrade: TradeAnalysisMoveWindowFact | null;
  lowestLowDuringTrade: TradeAnalysisMoveWindowFact | null;
  highestHighAfterExit: TradeAnalysisMoveWindowFact | null;
  lowestLowAfterExit: TradeAnalysisMoveWindowFact | null;
  maxFavorableMovePct: number | null;
  maxAdverseMovePct: number | null;
  postExitContinuationPct: number | null;
  postExitReliefPct: number | null;
};

export type TradeAnalysisExecutionRelationFact = {
  timestamp: number;
  timestampIso: string;
  price: number | null;
  quantity?: number;
  side?: "buy" | "sell" | "unknown";
  levelRelations: null | {
    nearestSupportBelow?: { id: string } | null;
    nearestResistanceAbove?: { id: string } | null;
    isNearSupport?: boolean;
    isNearResistance?: boolean;
  };
  dynamicLevelRelations: null;
  marketStructureState: null;
  marketStructureConfidence: null;
  diagnostics: [];
};

export type TradeAnalysisMarketFacts = {
  contractVersion: "market_facts.trade_review.v2";
  symbol: string;
  asOfTimestamp: string | null;
  candleFetchingOwnedBy: "levels-system";
  executionSnapshots: Array<{ relations: Array<{ benchmarkId: string }> }>;
  diagnostics: [];
};

export type TradeAnalysisCandleContextDiagnostic = {
  code:
    | "v2_supplied_candles_required"
    | "v2_supplied_candles_used"
    | "v2_trade_window_candles_fetched";
  severity: "info" | "warning";
  message: string;
};

export type TradeAnalysisCandleContext = {
  symbol: string;
  mode: "trade_analysis";
  candleFetchingOwnedBy: "levels-system";
  asOfTimestamp: number | null;
  supportResistanceContext: SupportResistanceContext;
  tradeWindow: {
    timeframe: "5m";
    requestedTimeframe: "5m";
    fallbackUsed: false;
    requestedStartTimestamp: number;
    requestedEndTimestamp: number;
    tradeStartTimestamp: number;
    tradeEndTimestamp: number;
    preTradeCandles: Candle[];
    tradeCandles: Candle[];
    postTradeCandles: Candle[];
    allCandles: Candle[];
    dynamicLevels: DynamicLevelsFromCandles;
    fetch: {
      provider: "ibkr" | "stub" | "supplied" | "twelve_data";
      freshnessStatus: "fresh" | "missing" | "supplied";
      requestedLookbackBars: number;
      actualBarsReturned: number;
      requestedStartTimestamp: number;
      requestedEndTimestamp: number;
      newestCandleTimestamp: number | null;
      completenessStatus: "empty" | "complete" | "partial";
      stale: boolean;
      validationIssues: [];
    };
  };
  tradeWindowFacts: TradeAnalysisTradeWindowFacts;
  executionRelations: TradeAnalysisExecutionRelationFact[];
  marketFacts: TradeAnalysisMarketFacts;
  diagnostics: TradeAnalysisCandleContextDiagnostic[];
};

export type CandleMarketStructureContext = {
  symbol: string;
  timeframe: string;
  asOfTimestamp: number | null;
  state: string;
  trend: {
    direction: string;
    higherLowCount: number;
    lowerHighCount: number;
    higherHighCount: number;
    lowerLowCount: number;
  };
  confidence: { label: string; score: number; reasons: string[] };
  range: {
    low: number;
    high: number;
    quality: string;
  } | null;
  pivotEvent: null | {
    type: string;
    confirmation: string;
    triggerPrice: number | null;
    pivot: null | {
      kind: string;
      price: number;
      timestamp: number;
      strength: number;
    };
  };
  pivots: {
    confirmedHighs: unknown[];
    confirmedLows: unknown[];
    latestSwingHigh: null | {
      kind: string;
      price: number;
      timestamp: number;
      strength: number;
    };
    latestSwingLow: null | {
      kind: string;
      price: number;
      timestamp: number;
      strength: number;
    };
  };
  traderLine?: string | null;
  diagnostics: Array<{ code: string; severity?: string; message?: string }>;
};

export type RawLevelCandidateSourceType =
  | "swing_high"
  | "swing_low"
  | "gap_up_origin"
  | "gap_up_pullback_low"
  | "premarket_high"
  | "premarket_low"
  | "opening_range_high"
  | "opening_range_low";

export type FinalLevelZone = {
  id: string;
  symbol: string;
  kind: "support" | "resistance";
  timeframeBias: "daily" | "4h" | "5m" | "mixed";
  zoneLow: number;
  zoneHigh: number;
  representativePrice: number;
  strengthScore: number;
  strengthLabel: "weak" | "moderate" | "strong" | "major";
  touchCount: number;
  confluenceCount: number;
  sourceTypes: RawLevelCandidateSourceType[];
  timeframeSources: Array<"daily" | "4h" | "5m">;
  reactionQualityScore: number;
  rejectionScore: number;
  displacementScore: number;
  sessionSignificanceScore: number;
  followThroughScore: number;
  sourceEvidenceCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  sessionDate?: string;
  isExtension: boolean;
  freshness: "fresh" | "aging" | "stale";
  notes: string[];
};

export type LevelEngineOutput = {
  majorSupport: FinalLevelZone[];
  majorResistance: FinalLevelZone[];
  intermediateSupport: FinalLevelZone[];
  intermediateResistance: FinalLevelZone[];
  intradaySupport: FinalLevelZone[];
  intradayResistance: FinalLevelZone[];
  extensionLevels: {
    support: FinalLevelZone[];
    resistance: FinalLevelZone[];
  };
  specialLevels: {
    premarketHigh?: number;
    premarketLow?: number;
  };
};

export type BuildSupportResistanceContextForSymbolRequest = {
  symbol: string;
};

export type SupportResistanceSymbolContext = SupportResistanceContext & {
  mode: "symbol";
  candleFetchingOwnedBy: "levels-system";
  requestedTimeframes: Array<"daily" | "4h" | "5m">;
  fetches: [];
  diagnostics: [];
};

export async function buildSupportResistanceContextForSymbol(
  request: BuildSupportResistanceContextForSymbolRequest,
): Promise<SupportResistanceSymbolContext> {
  return {
    ...buildSupportResistanceContext({
      symbol: request.symbol,
      candlesByTimeframe: {},
    }),
    mode: "symbol",
    candleFetchingOwnedBy: "levels-system",
    requestedTimeframes: ["daily", "4h", "5m"],
    fetches: [],
    diagnostics: [],
  };
}
