// 2026-05-27 09:20 PM America/Toronto
// Rescue-only shared support/resistance API surface.

export {
  buildSupportResistanceContext,
  type BuildSupportResistanceContextRequest,
  type SupportResistanceContext,
} from "./build-support-resistance-context.js";
export {
  buildSingleTimeframeSupportResistanceContext,
  type BuildSingleTimeframeSupportResistanceContextRequest,
  type SharedSupportResistanceLevel,
  type SingleTimeframeSupportResistanceContext,
} from "./single-timeframe-context.js";
export {
  buildSymbolSupportResistanceContext,
  type BuildSymbolSupportResistanceContextRequest,
  type SymbolSupportResistanceContext,
} from "./symbol-context.js";
export {
  buildTradeAnalysisSupportResistanceContext,
  type BuildTradeAnalysisSupportResistanceContextRequest,
  type TradeAnalysisSupportResistanceContext,
} from "./trade-analysis-context.js";
export type {
  Candle,
  CandleProviderResponse,
  CandleFetchTimeframe,
  CandleTimeframe,
} from "../market-data/candle-types.js";
export {
  CandleFetchService,
  StubHistoricalCandleProvider,
  type CandleFetchServiceOptions,
  type HistoricalCandleProvider,
  type HistoricalFetchRequest,
} from "../market-data/candle-fetch-service.js";
export type {
  CandleMarketStructureContext,
  DynamicLevelsFromCandles,
  SupportResistanceSymbolContext,
  TradeAnalysisCandleContext,
  TradeAnalysisCandleWindowOptions,
  TradeAnalysisExecutionInput,
  TradeAnalysisExecutionRelationFact,
  TradeAnalysisMarketFacts,
  TradeAnalysisTradeWindowFacts,
} from "./trader-intelligence-contract.js";
export type {
  FinalLevelZone,
  LevelEngineOutput,
  RawLevelCandidateSourceType,
} from "../levels/level-types.js";
export {
  buildSupportResistanceContextForSymbol,
} from "./trader-intelligence-contract.js";
