import {
  CandleFetchService,
  StubHistoricalCandleProvider,
  type CandleFetchServiceOptions,
  type HistoricalFetchRequest,
} from "../market-data/candle-fetch-service.js";
import type { Candle, CandleFetchTimeframe, CandleProviderResponse } from "../market-data/candle-types.js";
import {
  DurableCandleWarehouse,
  DurableCandleWarehouseFetchService,
  type CandleBasisValidationStatus,
  type DurableCandleWarehouseFetchServiceOptions,
} from "../candle-warehouse/index.js";
import { classifyIntradayCandleTimestamp } from "../market-data/candle-session-classifier.js";
import {
  filterCandlesByCloseAsOf,
  type CandleAsOfFilterDiagnostic,
} from "../market-data/candle-as-of-filter.js";
import type {
  BuildSupportResistanceContextForSymbolRequest,
  SupportResistanceSymbolContext,
} from "./symbol-context.js";
import {
  buildSupportResistanceContextForSymbol,
} from "./symbol-context.js";
import { aggregateCandlesToFiveMinutes } from "./single-timeframe-context.js";
import {
  parseSharedCandleTimestamp,
  type SharedCandleTimestamp,
} from "./build-support-resistance-context.js";
import {
  buildExecutionLevelRelations,
  type ExecutionLevelSourceTimeframe,
  type ExecutionLevelRelations,
} from "./execution-level-relations.js";
import type {
  DynamicLevelPriceContext,
  DynamicLevelsFromCandles,
} from "./indicators/index.js";
import { buildDynamicLevelsFromCandles, calculateLatestVwap } from "./indicators/index.js";

export type TradeAnalysisExecutionInput = {
  timestamp: SharedCandleTimestamp;
  price?: number;
  quantity?: number;
  side?: "buy" | "sell" | "unknown";
};

export type TradeAnalysisCandleWindowOptions = {
  timeframe?: Extract<CandleFetchTimeframe, "1m" | "5m">;
  fallbackTimeframe?: Extract<CandleFetchTimeframe, "5m">;
  allowFiveMinuteFallback?: boolean;
  preTradeMinutes?: number;
  postTradeMinutes?: number;
  paddingMinutes?: number;
  lookbackBars?: number;
};

export type TradeAnalysisMarketFactsOptions = {
  benchmarkProfile?: MarketFactsBenchmarkProfile;
  includeDisagreementSummary?: boolean;
  includePostTradeSummary?: boolean;
};

export type BuildTradeAnalysisCandleContextRequest = {
  symbol: string;
  sessionDate?: string;
  asOfTimestamp?: SharedCandleTimestamp;
  executions?: TradeAnalysisExecutionInput[];
  tradeStartTimestamp?: SharedCandleTimestamp;
  tradeEndTimestamp?: SharedCandleTimestamp;
  preferredProvider?: HistoricalFetchRequest["preferredProvider"];
  fetchService?: CandleFetchService;
  fetchServiceOptions?: CandleFetchServiceOptions;
  warehouseDirectoryPath?: string;
  warehouse?: DurableCandleWarehouse;
  warehouseMode?: DurableCandleWarehouseFetchServiceOptions["mode"];
  supportResistance?: Omit<
    BuildSupportResistanceContextForSymbolRequest,
    "symbol" | "sessionDate" | "asOfTimestamp" | "fetchService" | "fetchServiceOptions" | "preferredProvider"
  >;
  tradeWindow?: TradeAnalysisCandleWindowOptions;
  marketFacts?: TradeAnalysisMarketFactsOptions;
};

export type MarketFactsContractVersion = "market_facts.trade_review.v2";
export type MarketFactsBenchmarkProfile = "small_cap_day_trade_v1" | "small_cap_day_trade_enriched_v1";
export type MarketFactsBenchmarkKind = "vwap" | "ema" | "support" | "resistance";
export type MarketFactsBenchmarkRole = "primary" | "comparison" | "advanced";
export type MarketFactsVwapMode = "regular_session" | "extended_session";
export type MarketFactsSessionScope = "regular_session" | "extended_session" | "rolling";
export type MarketFactsRelation = "above" | "below" | "at" | "missing";
export type MarketFactsQualityFlag =
  | "thin_basis"
  | "fallback_timeframe"
  | "missing_volume"
  | "missing_candles"
  | "partial_candle_window"
  | "stale_candles"
  | "insufficient_ema_warmup"
  | "session_reset"
  | "level_context_unavailable"
  | "calculation_unavailable";

export type MarketFactQuality = {
  status: "available" | "missing";
  confidence: "high" | "medium" | "low" | "unknown";
  flags: MarketFactsQualityFlag[];
  reasons: string[];
};

export type MarketFactBenchmarkDefinition = {
  benchmarkId: string;
  kind: MarketFactsBenchmarkKind;
  role: MarketFactsBenchmarkRole;
  label: string;
  timeframe: Extract<CandleFetchTimeframe, "1m" | "5m">;
  vwapMode?: MarketFactsVwapMode;
  emaLength?: number;
  sessionScope: MarketFactsSessionScope;
};

export type MarketFactCalculationBasis = {
  timeframe: Extract<CandleFetchTimeframe, "1m" | "5m">;
  requestedTimeframe: Extract<CandleFetchTimeframe, "1m" | "5m">;
  fallbackUsed: boolean;
  vwapMode?: MarketFactsVwapMode;
  emaLength?: number;
  sessionScope: MarketFactsSessionScope;
  startTimestamp: string;
  endTimestamp: string;
  barsUsed: number;
  volumeBarsUsed?: number;
  missingBars: number;
  partialBars: number;
};

export type MarketFactBenchmarkRelation = {
  benchmarkId: string;
  kind: MarketFactsBenchmarkKind;
  label: string;
  value: number | null;
  level: MarketFactLevelMetadata | null;
  price: number;
  relation: MarketFactsRelation;
  priceMinusBenchmarkAbs: number | null;
  priceMinusBenchmarkPct: number | null;
  basis: MarketFactCalculationBasis;
  quality: MarketFactQuality;
};

export type MarketFactLevelMetadata = {
  id: string;
  kind: "support" | "resistance";
  representativePrice: number;
  zoneLow: number;
  zoneHigh: number;
  strengthScore: number;
  strengthLabel: "weak" | "moderate" | "strong" | "major";
  confidence: number | null;
  timeframeSources: string[];
  freshness: string;
  sourceEvidenceCount: number;
  touchCount: number;
  confluenceCount: number;
};

export type MarketFactDiagnostic = {
  code:
    | "THIN_REGULAR_SESSION_VWAP"
    | "EXTENDED_SESSION_VWAP_AVAILABLE"
    | "MISSING_VOLUME_FOR_VWAP"
    | "TIMEFRAME_FALLBACK_USED"
    | "PARTIAL_CANDLE_WINDOW"
    | "STALE_CANDLE_DATA"
    | "INSUFFICIENT_EMA_WARMUP"
    | "MULTI_DAY_VWAP_SESSION_RESET"
    | "INDICATOR_DISAGREEMENT"
    | "BENCHMARK_UNAVAILABLE";
  severity: "info" | "warning" | "error";
  message: string;
  affectedBenchmarkIds: string[];
};

export type MarketFactExecutionSnapshot = {
  snapshotId: string;
  timestamp: string;
  price: number | null;
  quantity?: number;
  side?: "buy" | "sell" | "unknown";
  relations: MarketFactBenchmarkRelation[];
  diagnostics: MarketFactDiagnostic[];
};

export type MarketFactDisagreementSummary = {
  disagreementId: string;
  kind: MarketFactsBenchmarkKind;
  benchmarkIds: string[];
  summary: string;
  severity: "info" | "warning";
};

export type MarketFactCrossedBenchmark = {
  benchmarkId: string;
  label: string;
  crossedAtTimestamp: string;
  direction: "above" | "below";
};

export type MarketFactTradeWindowSummary = {
  tradeStartTimestamp: string;
  tradeEndTimestamp: string;
  holdDurationMinutes: number;
  highDuringTrade: number | null;
  lowDuringTrade: number | null;
  maxFavorableMovePct: number | null;
  maxAdverseMovePct: number | null;
  crossedBenchmarksDuringTrade: MarketFactCrossedBenchmark[];
  movedIntoNearestResistance: boolean | null;
  movedIntoNearestSupport: boolean | null;
  reachedNearestDaily4hResistanceDuringTrade: boolean | null;
  reachedNearestDaily4hSupportDuringTrade: boolean | null;
};

export type MarketFactPostTradeSummary = {
  postTradeStartTimestamp: string | null;
  postTradeEndTimestamp: string | null;
  maxMoveAfterExitPct: number | null;
  reclaimedEntryPriceAfterExit: boolean | null;
  reachedNearestResistanceAfterExit: boolean | null;
  brokeNearestSupportAfterExit: boolean | null;
  reachedNearestDaily4hResistanceAfterExit: boolean | null;
  brokeNearestDaily4hSupportAfterExit: boolean | null;
};

export type TradeAnalysisMarketFacts = {
  contractVersion: MarketFactsContractVersion;
  benchmarkProfile: MarketFactsBenchmarkProfile;
  symbol: string;
  asOfTimestamp: string | null;
  candleFetchingOwnedBy: "levels-system";
  noLookaheadPolicy: {
    policy: "closed_candles_only";
    candleInclusionRule: "candle_end_lte_snapshot_timestamp";
    partialCandlesRequireLowerGranularitySource: true;
  };
  benchmarkDefinitions: MarketFactBenchmarkDefinition[];
  executionSnapshots: MarketFactExecutionSnapshot[];
  tradeWindowSummary: MarketFactTradeWindowSummary;
  postTradeSummary: MarketFactPostTradeSummary | null;
  disagreementSummary: MarketFactDisagreementSummary[];
  diagnostics: MarketFactDiagnostic[];
};

export type TradeAnalysisCandleWindow = {
  timeframe: Extract<CandleFetchTimeframe, "1m" | "5m">;
  requestedTimeframe: Extract<CandleFetchTimeframe, "1m" | "5m">;
  fallbackUsed: boolean;
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
    provider: CandleProviderResponse["provider"];
    freshnessStatus: "fresh" | "usable" | "stale" | "partial" | "missing";
    requestedLookbackBars: number;
    actualBarsReturned: number;
    requestedStartTimestamp: number;
    requestedEndTimestamp: number;
    newestCandleTimestamp: number | null;
    completenessStatus: CandleProviderResponse["completenessStatus"];
    stale: boolean;
    validationIssues: CandleProviderResponse["validationIssues"];
  };
};

export type TradeAnalysisCandleContextDiagnosticCode =
  | "trade_window_fetched"
  | "trade_window_one_minute_unavailable"
  | "trade_window_fell_back_to_5m"
  | "trade_window_missing_pre_trade_candles"
  | "trade_window_missing_trade_candles"
  | "trade_window_missing_post_trade_candles"
  | "trade_window_truncated_by_as_of"
  | "future_candles_filtered"
  | "partial_candles_filtered"
  | "historical_as_of_snapshot_built"
  | "historical_higher_timeframe_closed_candle_cutoff"
  | "historical_price_anchor_used"
  | "historical_symbol_alias_used"
  | "historical_symbol_resolved_to_pink"
  | "possible_price_adjustment_mismatch"
  | "likely_price_basis_adjustment_multiple"
  | "trade_window_price_basis_unverified"
  | "trade_window_basis_validation_status"
  | "trade_window_provider_warning";

export type TradeAnalysisCandleContextDiagnostic = {
  code: TradeAnalysisCandleContextDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
};

export type TradeAnalysisExecutionRelationDiagnosticCode =
  | "execution_after_as_of"
  | "execution_missing_price"
  | "execution_invalid_price"
  | "execution_missing_trade_window_candles"
  | "execution_context_unavailable";

export type TradeAnalysisExecutionRelationDiagnostic = {
  code: TradeAnalysisExecutionRelationDiagnosticCode;
  severity: "info" | "warning";
  message: string;
};

export type TradeAnalysisExecutionDynamicRelations = DynamicLevelPriceContext;

export type TradeAnalysisExecutionRelationFact = {
  timestamp: number;
  timestampIso: string;
  price: number | null;
  quantity?: number;
  side?: "buy" | "sell" | "unknown";
  levelRelations: ExecutionLevelRelations | null;
  dynamicLevelRelations: TradeAnalysisExecutionDynamicRelations | null;
  marketStructureState: SupportResistanceSymbolContext["marketStructure"]["state"];
  marketStructureConfidence: SupportResistanceSymbolContext["marketStructure"]["confidence"]["label"];
  diagnostics: TradeAnalysisExecutionRelationDiagnostic[];
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

export type TradeAnalysisCandleContext = {
  symbol: string;
  mode: "trade_analysis";
  candleFetchingOwnedBy: "levels-system";
  asOfTimestamp: number | null;
  supportResistanceContext: SupportResistanceSymbolContext;
  tradeWindow: TradeAnalysisCandleWindow;
  tradeWindowFacts: TradeAnalysisTradeWindowFacts;
  executionRelations: TradeAnalysisExecutionRelationFact[];
  marketFacts: TradeAnalysisMarketFacts;
  diagnostics: TradeAnalysisCandleContextDiagnostic[];
};

const DEFAULT_PRE_TRADE_MINUTES = 60;
const DEFAULT_POST_TRADE_MINUTES = 60;
const DEFAULT_PADDING_MINUTES = 5;
const ONE_MINUTE_MS = 60_000;
const FIVE_MINUTE_MS = 5 * ONE_MINUTE_MS;
const EXECUTION_TO_CANDLE_DISCONNECT_WARNING_PCT = 60;
const TRADE_REVIEW_LEVEL_SOURCE_TIMEFRAMES: ExecutionLevelSourceTimeframe[] = ["daily", "4h"];

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    throw new Error("symbol is required.");
  }
  return normalized;
}

function buildDelegateFetchService(request: BuildTradeAnalysisCandleContextRequest): CandleFetchService {
  return new CandleFetchService({
    ...request.fetchServiceOptions,
    providerName: request.preferredProvider ?? request.fetchServiceOptions?.providerName,
  });
}

function shouldUseWarehouseByDefault(request: BuildTradeAnalysisCandleContextRequest): boolean {
  return !request.fetchService && !request.fetchServiceOptions?.provider;
}

function hasExplicitProvider(request: BuildTradeAnalysisCandleContextRequest): boolean {
  return Boolean(
    request.fetchServiceOptions?.provider ||
      request.fetchServiceOptions?.ib,
  );
}

function effectivePreferredProvider(
  request: BuildTradeAnalysisCandleContextRequest,
): HistoricalFetchRequest["preferredProvider"] | undefined {
  return hasExplicitProvider(request)
    ? request.preferredProvider
    : request.preferredProvider ?? "ibkr";
}

function buildFetchService(request: BuildTradeAnalysisCandleContextRequest): CandleFetchService {
  if (request.fetchService) {
    return request.fetchService;
  }
  const provider = effectivePreferredProvider(request);
  const delegate = hasExplicitProvider(request)
    ? buildDelegateFetchService({
        ...request,
        preferredProvider: provider,
      })
    : new CandleFetchService(new StubHistoricalCandleProvider());
  if (!request.warehouse && !request.warehouseDirectoryPath && !shouldUseWarehouseByDefault(request)) {
    return delegate;
  }
  return new DurableCandleWarehouseFetchService({
    warehouse: request.warehouse ?? new DurableCandleWarehouse(request.warehouseDirectoryPath ?? "data/candles"),
    delegate,
    mode: request.warehouseMode ?? (hasExplicitProvider(request) ? "read_write" : "replay"),
  });
}

function parseOptionalTimestamp(timestamp: SharedCandleTimestamp | undefined): number | null {
  return timestamp === undefined ? null : parseSharedCandleTimestamp(timestamp);
}

function sessionDateForTimestamp(timestamp: number): string {
  return classifyIntradayCandleTimestamp(timestamp).sessionDate;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function timeframeIntervalMs(timeframe: Extract<CandleFetchTimeframe, "1m" | "5m">): number {
  return timeframe === "1m" ? ONE_MINUTE_MS : FIVE_MINUTE_MS;
}

function nySessionTimestamp(sessionDate: string, hour: number, minute: number): number {
  return Date.parse(
    `${sessionDate}T${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:00-04:00`,
  );
}

function sessionStartTimestamp(
  timestamp: number,
  scope: Extract<MarketFactsSessionScope, "regular_session" | "extended_session">,
): number {
  const sessionDate = sessionDateForTimestamp(timestamp);
  return scope === "regular_session"
    ? nySessionTimestamp(sessionDate, 9, 30)
    : nySessionTimestamp(sessionDate, 4, 0);
}

function closedCandlesThrough(
  candles: Candle[],
  timestamp: number,
  timeframe: Extract<CandleFetchTimeframe, "1m" | "5m">,
): Candle[] {
  return filterCandlesByCloseAsOf({
    candles,
    timeframe,
    asOfTimestamp: timestamp,
  }).candles;
}

function candlesInBasisRange(
  candles: Candle[],
  startTimestamp: number,
  endTimestamp: number,
  timeframe: Extract<CandleFetchTimeframe, "1m" | "5m">,
): Candle[] {
  return closedCandlesThrough(candles, endTimestamp, timeframe)
    .filter((candle) => candle.timestamp >= startTimestamp);
}

function executionTimestamps(executions: TradeAnalysisExecutionInput[] | undefined): number[] {
  return (executions ?? [])
    .map((execution) => parseSharedCandleTimestamp(execution.timestamp))
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((left, right) => left - right);
}

function resolveTradeWindowBounds(request: BuildTradeAnalysisCandleContextRequest): {
  tradeStartTimestamp: number;
  tradeEndTimestamp: number;
  asOfTimestamp: number | null;
} {
  const executionTimes = executionTimestamps(request.executions);
  const explicitStart = parseOptionalTimestamp(request.tradeStartTimestamp);
  const explicitEnd = parseOptionalTimestamp(request.tradeEndTimestamp);
  const asOfTimestamp = parseOptionalTimestamp(request.asOfTimestamp);

  const tradeStartTimestamp = explicitStart ?? executionTimes[0] ?? asOfTimestamp;
  const tradeEndTimestamp = explicitEnd ?? executionTimes.at(-1) ?? tradeStartTimestamp;

  if (tradeStartTimestamp === null || tradeEndTimestamp === null) {
    throw new Error("tradeStartTimestamp, tradeEndTimestamp, executions, or asOfTimestamp is required.");
  }
  if (tradeEndTimestamp < tradeStartTimestamp) {
    throw new Error("tradeEndTimestamp must be greater than or equal to tradeStartTimestamp.");
  }

  return {
    tradeStartTimestamp,
    tradeEndTimestamp,
    asOfTimestamp,
  };
}

function timeframeMs(timeframe: "1m" | "5m"): number {
  return timeframe === "1m" ? ONE_MINUTE_MS : FIVE_MINUTE_MS;
}

function higherTimeframeAsOfCutoffs(timestamp: number): {
  daily: number;
  "4h": number;
  "5m": number;
} {
  return {
    daily: timestamp,
    "4h": timestamp,
    "5m": timestamp,
  };
}

function validExecutionPrice(execution: TradeAnalysisExecutionInput | undefined): number | undefined {
  return typeof execution?.price === "number" && Number.isFinite(execution.price) && execution.price > 0
    ? execution.price
    : undefined;
}

function firstExecutionPriceAtOrBefore(
  executions: TradeAnalysisExecutionInput[] | undefined,
  asOfTimestamp: number,
): number | undefined {
  return validExecutionPrice(
    [...(executions ?? [])]
      .filter((execution) => parseSharedCandleTimestamp(execution.timestamp) <= asOfTimestamp)
      .sort((left, right) => parseSharedCandleTimestamp(left.timestamp) - parseSharedCandleTimestamp(right.timestamp))[0],
  );
}

function nearestCandleClose(candles: Candle[], timestamp: number): number | null {
  const candidates = candles
    .filter((candle) => candle.timestamp <= timestamp)
    .sort((left, right) => right.timestamp - left.timestamp);
  return candidates[0]?.close ?? null;
}

function priceRatioAwayFromOne(left: number, right: number): number {
  return Math.max(left / Math.max(right, 0.0001), right / Math.max(left, 0.0001));
}

function candleDistancePctFromPrice(candle: Candle, price: number): number {
  if (price <= 0 || !Number.isFinite(price)) {
    return 0;
  }
  if (price >= candle.low && price <= candle.high) {
    return 0;
  }
  const nearestBoundary = price < candle.low ? candle.low : candle.high;
  return (Math.abs(nearestBoundary - price) / price) * 100;
}

function nearestCandleByTimestamp(candles: Candle[], timestamp: number): Candle | null {
  return [...candles].sort(
    (left, right) => Math.abs(left.timestamp - timestamp) - Math.abs(right.timestamp - timestamp),
  )[0] ?? null;
}

function strongestExecutionCandleDisconnection(params: {
  executions: TradeAnalysisExecutionInput[] | undefined;
  candles: Candle[];
}): {
  timestamp: number;
  executionPrice: number;
  candle: Candle;
  distancePct: number;
  closeRatio: number;
} | null {
  if (params.candles.length === 0) {
    return null;
  }
  const candidates = (params.executions ?? [])
    .map((execution) => {
      const price = validExecutionPrice(execution);
      if (price === undefined) {
        return null;
      }
      const timestamp = parseSharedCandleTimestamp(execution.timestamp);
      const candle = nearestCandleByTimestamp(params.candles, timestamp);
      if (candle === null) {
        return null;
      }
      return {
        timestamp,
        executionPrice: price,
        candle,
        distancePct: candleDistancePctFromPrice(candle, price),
        closeRatio: priceRatioAwayFromOne(price, candle.close),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return candidates.sort(
    (left, right) => right.distancePct - left.distancePct || right.closeRatio - left.closeRatio,
  )[0] ?? null;
}

function likelyPriceBasisMultiple(ratio: number | null): number | null {
  if (ratio === null || !Number.isFinite(ratio) || ratio < 3) {
    return null;
  }
  const rounded = Math.round(ratio);
  if (rounded < 3) {
    return null;
  }
  const relativeDistance = Math.abs(ratio - rounded) / rounded;
  return relativeDistance <= 0.1 ? rounded : null;
}

function basisValidationSeverity(status: CandleBasisValidationStatus): TradeAnalysisCandleContextDiagnostic["severity"] {
  return status === "basis_aligned" || status === "basis_unchecked" ? "info" : "warning";
}

function basisValidationMessage(params: {
  status: CandleBasisValidationStatus;
  likelyMultiple: number | null;
}): string {
  if (params.status === "basis_aligned") {
    return "Trade-window candle basis status: basis_aligned. Nearby candle OHLC is compatible with broker execution prices for this review.";
  }
  if (params.status === "basis_adjustment_multiple_likely") {
    return (
      `Trade-window candle basis status: basis_adjustment_multiple_likely` +
      (params.likelyMultiple === null ? "" : ` near ${params.likelyMultiple}:1`) +
      ". Keep these candles unavailable for Trader Intelligence movement review unless raw IBKR candle basis is proven aligned to broker execution prices."
    );
  }
  if (params.status === "basis_mismatch") {
    return "Trade-window candle basis status: basis_mismatch. Candle prices are too far from broker executions for safe trader-facing movement review.";
  }
  if (params.status === "basis_insufficient_evidence") {
    return "Trade-window candle basis status: basis_insufficient_evidence. There were not enough nearby candles and priced executions to prove candle/execution alignment.";
  }
  return "Trade-window candle basis status: basis_unchecked. No execution-price basis comparison was completed for this review.";
}

function safePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function buildFetchSummary(response: CandleProviderResponse): TradeAnalysisCandleWindow["fetch"] {
  const freshnessStatus: TradeAnalysisCandleWindow["fetch"]["freshnessStatus"] =
    response.completenessStatus === "empty"
      ? "missing"
      : response.stale
        ? "stale"
        : response.completenessStatus === "partial"
          ? "partial"
          : response.validationIssues.some((issue) => issue.severity === "warning")
            ? "usable"
            : "fresh";
  return {
    provider: response.provider,
    freshnessStatus,
    requestedLookbackBars: response.requestedLookbackBars,
    actualBarsReturned: response.actualBarsReturned,
    requestedStartTimestamp: response.requestedStartTimestamp,
    requestedEndTimestamp: response.requestedEndTimestamp,
    newestCandleTimestamp: response.candles.at(-1)?.timestamp ?? null,
    completenessStatus: response.completenessStatus,
    stale: response.stale,
    validationIssues: response.validationIssues,
  };
}

function shouldFallbackToFiveMinute(params: {
  response: CandleProviderResponse;
  requestedEndTimestamp: number;
}): boolean {
  const { response } = params;

  if (response.timeframe !== "1m") {
    return false;
  }

  if (response.completenessStatus === "empty" || response.actualBarsReturned === 0) {
    return true;
  }

  const newestCandleTimestamp = response.candles.at(-1)?.timestamp ?? null;

  return response.completenessStatus === "partial" &&
    newestCandleTimestamp !== null &&
    newestCandleTimestamp < params.requestedEndTimestamp - 15 * 60_000;
}

function oneMinuteFallbackMessage(params: {
  response: CandleProviderResponse;
  requestedEndTimestamp: number;
}): string {
  const newestCandleTimestamp = params.response.candles.at(-1)?.timestamp ?? null;

  if (
    params.response.completenessStatus === "partial" &&
    newestCandleTimestamp !== null &&
    newestCandleTimestamp < params.requestedEndTimestamp - 15 * 60_000
  ) {
    return (
      `1m trade-window replay was partial and stale: newest 1m candle ` +
      `${iso(newestCandleTimestamp)} was more than 15 minutes before requested window end ` +
      `${iso(params.requestedEndTimestamp)}, so levels-system requested 5m fallback candles.`
    );
  }

  return "1m trade-window candles were unavailable, so levels-system requested 5m fallback candles.";
}

async function fetchTradeWindowCandles(params: {
  fetchService: CandleFetchService;
  symbol: string;
  requestedTimeframe: "1m" | "5m";
  fallbackTimeframe: "5m";
  allowFiveMinuteFallback: boolean;
  lookbackBars: number;
  requestedEndTimestamp: number;
  preferredProvider: HistoricalFetchRequest["preferredProvider"] | undefined;
}): Promise<{
  response: CandleProviderResponse;
  requestedTimeframe: "1m" | "5m";
  fallbackUsed: boolean;
  diagnostics: TradeAnalysisCandleContextDiagnostic[];
}> {
  const diagnostics: TradeAnalysisCandleContextDiagnostic[] = [];
  try {
    const response = await params.fetchService.fetchCandles({
      symbol: params.symbol,
      timeframe: params.requestedTimeframe,
      lookbackBars: params.lookbackBars,
      endTimeMs: params.requestedEndTimestamp,
      preferredProvider: params.preferredProvider,
    });
    if (
      params.requestedTimeframe === "1m" &&
      params.allowFiveMinuteFallback &&
      shouldFallbackToFiveMinute({
        response,
        requestedEndTimestamp: params.requestedEndTimestamp,
      })
    ) {
      diagnostics.push({
        code: "trade_window_one_minute_unavailable",
        severity: "warning",
        message: oneMinuteFallbackMessage({
          response,
          requestedEndTimestamp: params.requestedEndTimestamp,
        }),
      });
      const fallbackResponse = await params.fetchService.fetchCandles({
        symbol: params.symbol,
        timeframe: params.fallbackTimeframe,
        lookbackBars: Math.max(1, Math.ceil(params.lookbackBars / 5) + 2),
        endTimeMs: params.requestedEndTimestamp,
        preferredProvider: params.preferredProvider,
      });
      diagnostics.push({
        code: "trade_window_fell_back_to_5m",
        severity: "info",
        message: "5m fallback candles were used for trade-window analysis.",
      });
      return {
        response: fallbackResponse,
        requestedTimeframe: params.requestedTimeframe,
        fallbackUsed: true,
        diagnostics,
      };
    }
    return {
      response,
      requestedTimeframe: params.requestedTimeframe,
      fallbackUsed: false,
      diagnostics,
    };
  } catch (error) {
    if (params.requestedTimeframe !== "1m" || !params.allowFiveMinuteFallback) {
      throw error;
    }
    diagnostics.push({
      code: "trade_window_one_minute_unavailable",
      severity: "warning",
      message:
        error instanceof Error
          ? `1m trade-window candles were unavailable (${error.message}), so levels-system requested 5m fallback candles.`
          : "1m trade-window candles were unavailable, so levels-system requested 5m fallback candles.",
    });
    const fallbackResponse = await params.fetchService.fetchCandles({
      symbol: params.symbol,
      timeframe: params.fallbackTimeframe,
      lookbackBars: Math.max(1, Math.ceil(params.lookbackBars / 5) + 2),
      endTimeMs: params.requestedEndTimestamp,
      preferredProvider: params.preferredProvider,
    });
    diagnostics.push({
      code: "trade_window_fell_back_to_5m",
      severity: "info",
      message: "5m fallback candles were used for trade-window analysis.",
    });
    return {
      response: fallbackResponse,
      requestedTimeframe: params.requestedTimeframe,
      fallbackUsed: true,
      diagnostics,
    };
  }
}

function diagnosticsForTradeWindow(params: {
  window: TradeAnalysisCandleWindow;
  response: CandleProviderResponse;
  executions: TradeAnalysisExecutionInput[] | undefined;
  truncatedByAsOf: boolean;
  supportResistanceAsOfTimestamp: number;
  supportResistanceCutoffs: ReturnType<typeof higherTimeframeAsOfCutoffs>;
  priceAnchor: number | undefined;
  precomputedDiagnostics?: TradeAnalysisCandleContextDiagnostic[];
}): TradeAnalysisCandleContextDiagnostic[] {
  const diagnostics: TradeAnalysisCandleContextDiagnostic[] = [
    ...(params.precomputedDiagnostics ?? []),
    {
      code: "trade_window_fetched",
      severity: "info",
      message: `Fetched ${params.response.actualBarsReturned} ${params.response.timeframe} candles for trade-window analysis.`,
    },
    {
      code: "historical_as_of_snapshot_built",
      severity: "info",
      message: `Built historical support/resistance snapshot as of ${iso(params.supportResistanceAsOfTimestamp)}.`,
    },
    {
      code: "historical_higher_timeframe_closed_candle_cutoff",
      severity: "info",
      message:
        `Daily and 4h context used candle-close filtering through snapshot ` +
        `${iso(params.supportResistanceCutoffs["4h"])} to avoid still-forming higher-timeframe candles.`,
    },
  ];

  if (params.priceAnchor !== undefined) {
    diagnostics.push({
      code: "historical_price_anchor_used",
      severity: "info",
      message: `Support/resistance relevance was anchored to historical execution/as-of price ${params.priceAnchor}.`,
    });
  }

  const providerMetadata = params.response.providerMetadata ?? {};
  if (providerMetadata.ibkrContractAliasUsed === true) {
    const requestedSymbol = String(providerMetadata.ibkrRequestedSymbol ?? params.response.symbol);
    const resolvedSymbol = String(providerMetadata.ibkrResolvedSymbol ?? params.response.symbol);
    const resolvedConId = providerMetadata.ibkrResolvedConId ?? "unknown";
    const aliasReason = String(providerMetadata.ibkrHistoricalAliasReason ?? "historical_symbol_alias");
    diagnostics.push({
      code: "historical_symbol_alias_used",
      severity: "info",
      message:
        `Historical candles for ${requestedSymbol} used validated IBKR alias ${resolvedSymbol} ` +
        `(conId ${resolvedConId}; reason ${aliasReason}).`,
    });
  }

  if (String(providerMetadata.ibkrResolvedPrimaryExchange ?? "").toUpperCase() === "PINK") {
    const requestedSymbol = String(providerMetadata.ibkrRequestedSymbol ?? params.response.symbol);
    const resolvedSymbol = String(providerMetadata.ibkrResolvedSymbol ?? params.response.symbol);
    diagnostics.push({
      code: "historical_symbol_resolved_to_pink",
      severity: "warning",
      message:
        `Historical contract for ${requestedSymbol} resolved through ${resolvedSymbol} on PINK. ` +
        "Trade review may use the available historical candles, but the app should label this as a delisted/renamed or OTC/PINK data path.",
    });
  }

  if (params.truncatedByAsOf) {
    diagnostics.push({
      code: "trade_window_truncated_by_as_of",
      severity: "info",
      message: "Post-trade candle window was truncated at asOfTimestamp to avoid future-candle leakage.",
    });
  }
  if (params.window.preTradeCandles.length === 0) {
    diagnostics.push({
      code: "trade_window_missing_pre_trade_candles",
      severity: "warning",
      message: "No pre-trade candles were available in the fetched trade window.",
    });
  }
  if (params.window.tradeCandles.length === 0) {
    diagnostics.push({
      code: "trade_window_missing_trade_candles",
      severity: "warning",
      message: "No candles overlapped the trade execution window.",
    });
  }
  if (params.window.postTradeCandles.length === 0) {
    diagnostics.push({
      code: "trade_window_missing_post_trade_candles",
      severity: "warning",
      message: "No post-trade candles were available in the fetched trade window.",
    });
  }

  for (const issue of params.response.validationIssues) {
    diagnostics.push({
      code: "trade_window_provider_warning",
      severity: issue.severity,
      message: issue.message,
    });
  }

  if (params.priceAnchor !== undefined) {
    const candleClose = nearestCandleClose(params.window.allCandles, params.supportResistanceAsOfTimestamp);
    const anchorRatio = candleClose === null ? null : priceRatioAwayFromOne(params.priceAnchor, candleClose);
    const executionDisconnect = strongestExecutionCandleDisconnection({
      executions: params.executions,
      candles: params.window.tradeCandles.length > 0 ? params.window.tradeCandles : params.window.allCandles,
    });
    const executionDistancePct = executionDisconnect?.distancePct ?? 0;
    const likelyAnchorMultiple = likelyPriceBasisMultiple(anchorRatio);
    const likelyExecutionMultiple = likelyPriceBasisMultiple(executionDisconnect?.closeRatio ?? null);
    const likelyMultiple = likelyExecutionMultiple ?? likelyAnchorMultiple;
    const basisValidationStatus: CandleBasisValidationStatus =
      executionDisconnect === null || params.window.allCandles.length === 0
        ? "basis_insufficient_evidence"
        : likelyMultiple !== null
          ? "basis_adjustment_multiple_likely"
          : (anchorRatio !== null && anchorRatio >= 3) ||
              executionDistancePct > EXECUTION_TO_CANDLE_DISCONNECT_WARNING_PCT
            ? "basis_mismatch"
            : "basis_aligned";

    diagnostics.push({
      code: "trade_window_basis_validation_status",
      severity: basisValidationSeverity(basisValidationStatus),
      message: basisValidationMessage({
        status: basisValidationStatus,
        likelyMultiple,
      }),
    });

    if (
      (anchorRatio !== null && anchorRatio >= 3) ||
      executionDistancePct > EXECUTION_TO_CANDLE_DISCONNECT_WARNING_PCT
    ) {
      diagnostics.push({
        code: "possible_price_adjustment_mismatch",
        severity: "warning",
        message:
          `Historical execution price ${params.priceAnchor} is disconnected from nearby trade-window candles` +
          (candleClose === null ? "" : ` (as-of candle close ${candleClose}, ratio ${anchorRatio?.toFixed(2)}x)`) +
          (executionDisconnect === null
            ? ""
            : `; largest execution/candle distance ${executionDisconnect.distancePct.toFixed(1)}% at ` +
              `${iso(executionDisconnect.timestamp)} versus candle ` +
              `${iso(executionDisconnect.candle.timestamp)} ` +
              `OHLC ${executionDisconnect.candle.open}/${executionDisconnect.candle.high}/` +
              `${executionDisconnect.candle.low}/${executionDisconnect.candle.close}`) +
          "; possible split/adjustment, stale cache, extended-hours, or symbol mapping mismatch.",
      });

      if (likelyMultiple !== null) {
        diagnostics.push({
          code: "likely_price_basis_adjustment_multiple",
          severity: "warning",
          message:
            `Execution prices and warehouse candles look like different price bases near a ${likelyMultiple}:1 adjustment multiple. ` +
            "Treat trade-window candles as unavailable for Trader Intelligence review until the warehouse candles and broker executions are aligned on the same raw/adjusted basis.",
        });
        diagnostics.push({
          code: "trade_window_price_basis_unverified",
          severity: "warning",
          message:
            "Price-basis policy: treat these trade-window candles as unavailable for Trader Intelligence unless raw IBKR candle basis is proven aligned to broker execution prices.",
        });
      }
    }
  }

  return diagnostics;
}

function diagnosticsFromCandleFilters(
  diagnostics: CandleAsOfFilterDiagnostic[],
): TradeAnalysisCandleContextDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
  }));
}

function roundPct(value: number): number {
  return Number(value.toFixed(4));
}

function moveWindowFact(params: {
  candle: Candle | null;
  price: number | null;
  referencePrice: number | null;
}): TradeAnalysisMoveWindowFact | null {
  if (!params.candle || params.price === null || params.referencePrice === null || params.referencePrice <= 0) {
    return null;
  }
  return {
    startTimestamp: params.candle.timestamp,
    startTimestampIso: new Date(params.candle.timestamp).toISOString(),
    endTimestamp: params.candle.timestamp,
    endTimestampIso: new Date(params.candle.timestamp).toISOString(),
    price: params.price,
    movePctFromReference: roundPct(((params.price - params.referencePrice) / params.referencePrice) * 100),
  };
}

function maxBy(candles: Candle[], value: (candle: Candle) => number): Candle | null {
  return candles.reduce<Candle | null>((best, candle) => {
    return best === null || value(candle) > value(best) ? candle : best;
  }, null);
}

function minBy(candles: Candle[], value: (candle: Candle) => number): Candle | null {
  return candles.reduce<Candle | null>((best, candle) => {
    return best === null || value(candle) < value(best) ? candle : best;
  }, null);
}

function firstPricedExecution(
  executions: TradeAnalysisExecutionInput[] | undefined,
  asOfTimestamp: number | null,
): { timestamp: number; price: number; side: "buy" | "sell" | "unknown" } | null {
  const priced = (executions ?? [])
    .map((execution) => ({
      timestamp: parseSharedCandleTimestamp(execution.timestamp),
      price: execution.price,
      side: execution.side ?? "unknown",
    }))
    .filter((execution): execution is { timestamp: number; price: number; side: "buy" | "sell" | "unknown" } =>
      Number.isFinite(execution.timestamp) &&
      typeof execution.price === "number" &&
      Number.isFinite(execution.price) &&
      execution.price > 0 &&
      (asOfTimestamp === null || execution.timestamp <= asOfTimestamp)
    )
    .sort((left, right) => left.timestamp - right.timestamp);
  return priced[0] ?? null;
}

function buildTradeWindowFacts(params: {
  executions: TradeAnalysisExecutionInput[] | undefined;
  window: TradeAnalysisCandleWindow;
  asOfTimestamp: number | null;
}): TradeAnalysisTradeWindowFacts {
  const reference = firstPricedExecution(params.executions, params.asOfTimestamp);
  const referencePrice = reference?.price ?? null;
  const tradeCandles = params.window.tradeCandles;
  const postTradeCandles = params.window.postTradeCandles;
  const highestTrade = maxBy(tradeCandles, (candle) => candle.high);
  const lowestTrade = minBy(tradeCandles, (candle) => candle.low);
  const highestPost = maxBy(postTradeCandles, (candle) => candle.high);
  const lowestPost = minBy(postTradeCandles, (candle) => candle.low);
  const highestHighDuringTrade = moveWindowFact({
    candle: highestTrade,
    price: highestTrade?.high ?? null,
    referencePrice,
  });
  const lowestLowDuringTrade = moveWindowFact({
    candle: lowestTrade,
    price: lowestTrade?.low ?? null,
    referencePrice,
  });
  const highestHighAfterExit = moveWindowFact({
    candle: highestPost,
    price: highestPost?.high ?? null,
    referencePrice,
  });
  const lowestLowAfterExit = moveWindowFact({
    candle: lowestPost,
    price: lowestPost?.low ?? null,
    referencePrice,
  });

  const highTradeMove = highestHighDuringTrade?.movePctFromReference ?? null;
  const lowTradeMove = lowestLowDuringTrade?.movePctFromReference ?? null;
  const highPostMove = highestHighAfterExit?.movePctFromReference ?? null;
  const lowPostMove = lowestLowAfterExit?.movePctFromReference ?? null;
  const side = reference?.side ?? null;

  return {
    referenceExecutionTimestamp: reference?.timestamp ?? null,
    referenceExecutionTimestampIso: reference ? new Date(reference.timestamp).toISOString() : null,
    referencePrice,
    referenceSide: side,
    highestHighDuringTrade,
    lowestLowDuringTrade,
    highestHighAfterExit,
    lowestLowAfterExit,
    maxFavorableMovePct:
      side === "sell"
        ? lowTradeMove === null ? null : roundPct(-lowTradeMove)
        : highTradeMove,
    maxAdverseMovePct:
      side === "sell"
        ? highTradeMove === null ? null : roundPct(-highTradeMove)
        : lowTradeMove,
    postExitContinuationPct:
      side === "sell"
        ? lowPostMove === null ? null : roundPct(-lowPostMove)
        : highPostMove,
    postExitReliefPct:
      side === "sell"
        ? highPostMove === null ? null : roundPct(-highPostMove)
        : lowPostMove,
  };
}

function pctFromPrice(price: number, level: number | null): number | null {
  return level === null ? null : Number((((price - level) / Math.max(Math.abs(price), 0.0001)) * 100).toFixed(4));
}

function nearestDynamicLevel(
  price: number,
  levels: Array<["vwap" | "ema9" | "ema20", number | null]>,
  side: "below" | "above",
): "vwap" | "ema9" | "ema20" | null {
  const candidates = levels
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    .filter(([, value]) => side === "below" ? value! <= price : value! >= price)
    .sort((left, right) =>
      side === "below"
        ? right[1]! - left[1]!
        : left[1]! - right[1]!,
    );
  return candidates[0]?.[0] ?? null;
}

function buildDynamicRelationsForPrice(
  price: number,
  dynamicLevels: DynamicLevelsFromCandles,
): TradeAnalysisExecutionDynamicRelations {
  const levels: Array<["vwap" | "ema9" | "ema20", number | null]> = [
    ["vwap", dynamicLevels.vwap],
    ["ema9", dynamicLevels.ema9],
    ["ema20", dynamicLevels.ema20],
  ];
  return {
    currentPrice: price,
    priceVsVwapPct: pctFromPrice(price, dynamicLevels.vwap),
    priceVsEma9Pct: pctFromPrice(price, dynamicLevels.ema9),
    priceVsEma20Pct: pctFromPrice(price, dynamicLevels.ema20),
    aboveVwap: dynamicLevels.vwap === null ? null : price >= dynamicLevels.vwap,
    aboveEma9: dynamicLevels.ema9 === null ? null : price >= dynamicLevels.ema9,
    aboveEma20: dynamicLevels.ema20 === null ? null : price >= dynamicLevels.ema20,
    dynamicSupportCandidate: nearestDynamicLevel(price, levels, "below"),
    dynamicResistanceCandidate: nearestDynamicLevel(price, levels, "above"),
  };
}

const DEFAULT_MARKET_FACT_BENCHMARKS: MarketFactBenchmarkDefinition[] = [
  {
    benchmarkId: "nearest_daily_4h_support",
    kind: "support",
    role: "primary",
    label: "Nearest daily/4h support",
    timeframe: "1m",
    sessionScope: "rolling",
  },
  {
    benchmarkId: "nearest_daily_4h_resistance",
    kind: "resistance",
    role: "primary",
    label: "Nearest daily/4h resistance",
    timeframe: "1m",
    sessionScope: "rolling",
  },
];

const ENRICHED_MARKET_FACT_BENCHMARKS: MarketFactBenchmarkDefinition[] = [
  ...DEFAULT_MARKET_FACT_BENCHMARKS,
];

function benchmarkDefinitionsForProfile(profile: MarketFactsBenchmarkProfile): MarketFactBenchmarkDefinition[] {
  return profile === "small_cap_day_trade_enriched_v1"
    ? ENRICHED_MARKET_FACT_BENCHMARKS
    : DEFAULT_MARKET_FACT_BENCHMARKS;
}

function marketFactRelation(price: number, value: number | null): MarketFactsRelation {
  if (value === null) {
    return "missing";
  }
  const distancePct = Math.abs(pctFromPrice(price, value) ?? 0);
  if (distancePct <= 0.01) {
    return "at";
  }
  return price > value ? "above" : "below";
}

function priceMinusBenchmarkPct(price: number, value: number | null): number | null {
  return value === null ? null : Number((((price - value) / Math.max(Math.abs(value), 0.0001)) * 100).toFixed(4));
}

function expectedBars(params: {
  startTimestamp: number;
  endTimestamp: number;
  timeframe: Extract<CandleFetchTimeframe, "1m" | "5m">;
}): number {
  if (params.endTimestamp <= params.startTimestamp) {
    return 0;
  }
  return Math.max(0, Math.floor((params.endTimestamp - params.startTimestamp) / timeframeIntervalMs(params.timeframe)));
}

function candleIntervalEndTimestamp(
  candle: Candle,
  timeframe: Extract<CandleFetchTimeframe, "1m" | "5m">,
): number {
  return candle.timestamp + timeframeIntervalMs(timeframe);
}

function candleOverlapsTimestampRange(params: {
  candle: Candle;
  timeframe: Extract<CandleFetchTimeframe, "1m" | "5m">;
  startTimestamp: number;
  endTimestamp: number;
}): boolean {
  const candleStart = params.candle.timestamp;
  const candleEnd = candleIntervalEndTimestamp(params.candle, params.timeframe);

  return candleStart <= params.endTimestamp && candleEnd > params.startTimestamp;
}

function candleEndsBeforeTimestamp(params: {
  candle: Candle;
  timeframe: Extract<CandleFetchTimeframe, "1m" | "5m">;
  timestamp: number;
}): boolean {
  return candleIntervalEndTimestamp(params.candle, params.timeframe) <= params.timestamp;
}

function candleStartsAfterTimestamp(candle: Candle, timestamp: number): boolean {
  return candle.timestamp > timestamp;
}

function buildBasis(params: {
  definition: MarketFactBenchmarkDefinition;
  tradeWindow: TradeAnalysisCandleWindow;
  startTimestamp: number;
  endTimestamp: number;
  candles: Candle[];
  timeframe?: Extract<CandleFetchTimeframe, "1m" | "5m">;
}): MarketFactCalculationBasis {
  const timeframe = params.timeframe ?? params.tradeWindow.timeframe;
  return {
    timeframe,
    requestedTimeframe: params.tradeWindow.requestedTimeframe,
    fallbackUsed: params.tradeWindow.fallbackUsed,
    vwapMode: params.definition.vwapMode,
    emaLength: params.definition.emaLength,
    sessionScope: params.definition.sessionScope,
    startTimestamp: iso(params.startTimestamp),
    endTimestamp: iso(params.endTimestamp),
    barsUsed: params.candles.length,
    volumeBarsUsed: params.definition.kind === "vwap"
      ? params.candles.filter((candle) => Number.isFinite(candle.volume) && candle.volume > 0).length
      : undefined,
    missingBars: Math.max(0, expectedBars({
      startTimestamp: params.startTimestamp,
      endTimestamp: params.endTimestamp,
      timeframe,
    }) - params.candles.length),
    partialBars: 0,
  };
}

function qualityForVwap(params: {
  value: number | null;
  basis: MarketFactCalculationBasis;
  definition: MarketFactBenchmarkDefinition;
  tradeWindow: TradeAnalysisCandleWindow;
}): MarketFactQuality {
  const flags: MarketFactsQualityFlag[] = [];
  const reasons: string[] = [];
  if (params.value === null) {
    flags.push("missing_volume", "calculation_unavailable");
    reasons.push(`${params.definition.label} could not be calculated from available volume-bearing candles.`);
    return { status: "missing", confidence: "unknown", flags, reasons };
  }
  if (params.basis.barsUsed < 20) {
    flags.push("thin_basis");
    reasons.push(`${params.definition.label} used only ${params.basis.barsUsed} ${params.basis.timeframe} bars.`);
  }
  if (params.basis.fallbackUsed) {
    flags.push("fallback_timeframe");
    reasons.push(`Requested ${params.basis.requestedTimeframe} candles were unavailable; ${params.basis.timeframe} fallback was used.`);
  }
  if (params.basis.missingBars > 0) {
    flags.push("missing_candles");
    reasons.push(`${params.basis.missingBars} expected candles were missing from the benchmark basis.`);
  }
  if (params.tradeWindow.fetch.stale) {
    flags.push("stale_candles");
    reasons.push("The provider marked the candle data as stale.");
  }
  const confidence =
    flags.includes("fallback_timeframe") || flags.includes("missing_candles")
      ? "medium"
      : params.basis.barsUsed < 10
        ? "low"
        : params.basis.barsUsed < 20
          ? "medium"
          : "high";
  return { status: "available", confidence, flags, reasons };
}

function qualityForEma(params: {
  value: number | null;
  basis: MarketFactCalculationBasis;
  definition: MarketFactBenchmarkDefinition;
  tradeWindow: TradeAnalysisCandleWindow;
}): MarketFactQuality {
  const flags: MarketFactsQualityFlag[] = [];
  const reasons: string[] = [];
  const period = params.definition.emaLength ?? 1;
  if (params.value === null) {
    flags.push("insufficient_ema_warmup", "calculation_unavailable");
    reasons.push(`${params.definition.label} requires at least ${period} bars and was unavailable.`);
    return { status: "missing", confidence: "unknown", flags, reasons };
  }
  if (params.basis.barsUsed < period * 3) {
    flags.push("insufficient_ema_warmup");
    reasons.push(`${params.definition.label} used ${params.basis.barsUsed} bars; ${period * 3} bars gives a stronger warmup.`);
  }
  if (params.basis.fallbackUsed) {
    flags.push("fallback_timeframe");
    reasons.push(`Requested ${params.basis.requestedTimeframe} candles were unavailable; ${params.basis.timeframe} fallback was used.`);
  }
  if (params.basis.missingBars > 0) {
    flags.push("missing_candles");
    reasons.push(`${params.basis.missingBars} expected candles were missing from the benchmark basis.`);
  }
  if (params.tradeWindow.fetch.stale) {
    flags.push("stale_candles");
    reasons.push("The provider marked the candle data as stale.");
  }
  const confidence =
    flags.includes("fallback_timeframe") || flags.includes("missing_candles")
      ? "medium"
      : params.basis.barsUsed < period * 2
        ? "low"
        : params.basis.barsUsed < period * 3
          ? "medium"
          : "high";
  return { status: "available", confidence, flags, reasons };
}

function qualityForLevel(params: {
  value: number | null;
  basis: MarketFactCalculationBasis;
  definition: MarketFactBenchmarkDefinition;
  contextAvailable: boolean;
}): MarketFactQuality {
  if (!params.contextAvailable || params.value === null) {
    return {
      status: "missing",
      confidence: "unknown",
      flags: ["level_context_unavailable", "calculation_unavailable"],
      reasons: [`${params.definition.label} was unavailable from execution-time support/resistance context.`],
    };
  }
  const flags: MarketFactsQualityFlag[] = [];
  const reasons: string[] = [];
  if (params.basis.fallbackUsed) {
    flags.push("fallback_timeframe");
    reasons.push(`Requested ${params.basis.requestedTimeframe} candles were unavailable; ${params.basis.timeframe} fallback was used.`);
  }
  if (params.basis.missingBars > 0) {
    flags.push("missing_candles");
    reasons.push(`${params.basis.missingBars} expected candles were missing from the level context basis.`);
  }
  return {
    status: "available",
    confidence: flags.length > 0 ? "medium" : "high",
    flags,
    reasons,
  };
}

function relationFromBenchmark(params: {
  definition: MarketFactBenchmarkDefinition;
  price: number;
  value: number | null;
  level: MarketFactLevelMetadata | null;
  basis: MarketFactCalculationBasis;
  quality: MarketFactQuality;
}): MarketFactBenchmarkRelation {
  return {
    benchmarkId: params.definition.benchmarkId,
    kind: params.definition.kind,
    label: params.definition.label,
    value: params.value,
    level: params.level,
    price: params.price,
    relation: marketFactRelation(params.price, params.value),
    priceMinusBenchmarkAbs: params.value === null ? null : Number((params.price - params.value).toFixed(4)),
    priceMinusBenchmarkPct: priceMinusBenchmarkPct(params.price, params.value),
    basis: params.basis,
    quality: params.quality,
  };
}

function extractConfidence(level: { notes: string[] }): number | null {
  const confidenceNote = level.notes.find((note) => note.startsWith("confidence="));
  if (!confidenceNote) {
    return null;
  }
  const value = Number(confidenceNote.slice("confidence=".length));
  return Number.isFinite(value) ? value : null;
}

function marketFactLevelMetadata(level: ExecutionLevelRelations["nearestSupportBelow"]): MarketFactLevelMetadata | null {
  if (!level) {
    return null;
  }
  return {
    id: level.id,
    kind: level.kind,
    representativePrice: level.representativePrice,
    zoneLow: level.zoneLow,
    zoneHigh: level.zoneHigh,
    strengthScore: level.strengthScore,
    strengthLabel: level.strengthLabel,
    confidence: extractConfidence(level),
    timeframeSources: [...level.timeframeSources],
    freshness: level.freshness,
    sourceEvidenceCount: level.sourceEvidenceCount,
    touchCount: level.touchCount,
    confluenceCount: level.confluenceCount,
  };
}

function diagnosticsForMarketFactRelation(relation: MarketFactBenchmarkRelation): MarketFactDiagnostic[] {
  const diagnostics: MarketFactDiagnostic[] = [];
  if (relation.quality.flags.includes("thin_basis") && relation.benchmarkId === "regular_session_vwap_1m") {
    diagnostics.push({
      code: "THIN_REGULAR_SESSION_VWAP",
      severity: "warning",
      message: relation.quality.reasons.find((reason) => reason.includes("used only")) ?? "Regular-session VWAP has a thin basis.",
      affectedBenchmarkIds: [relation.benchmarkId],
    });
  }
  if (relation.benchmarkId === "extended_session_vwap_1m" && relation.quality.status === "available") {
    diagnostics.push({
      code: "EXTENDED_SESSION_VWAP_AVAILABLE",
      severity: "info",
      message: "Extended-session VWAP was available as a comparison benchmark.",
      affectedBenchmarkIds: [relation.benchmarkId],
    });
  }
  if (relation.quality.flags.includes("fallback_timeframe")) {
    diagnostics.push({
      code: "TIMEFRAME_FALLBACK_USED",
      severity: "warning",
      message: `${relation.label} used fallback timeframe data.`,
      affectedBenchmarkIds: [relation.benchmarkId],
    });
  }
  if (relation.quality.flags.includes("missing_volume")) {
    diagnostics.push({
      code: "MISSING_VOLUME_FOR_VWAP",
      severity: "warning",
      message: `${relation.label} could not be calculated because usable volume was missing.`,
      affectedBenchmarkIds: [relation.benchmarkId],
    });
  }
  if (relation.quality.flags.includes("missing_candles")) {
    diagnostics.push({
      code: "PARTIAL_CANDLE_WINDOW",
      severity: "warning",
      message: `${relation.label} used a partial candle window.`,
      affectedBenchmarkIds: [relation.benchmarkId],
    });
  }
  if (relation.quality.flags.includes("stale_candles")) {
    diagnostics.push({
      code: "STALE_CANDLE_DATA",
      severity: "warning",
      message: `${relation.label} used stale candle data.`,
      affectedBenchmarkIds: [relation.benchmarkId],
    });
  }
  if (relation.quality.flags.includes("insufficient_ema_warmup")) {
    diagnostics.push({
      code: "INSUFFICIENT_EMA_WARMUP",
      severity: relation.quality.status === "missing" ? "warning" : "info",
      message: relation.quality.reasons[0] ?? `${relation.label} had limited EMA warmup.`,
      affectedBenchmarkIds: [relation.benchmarkId],
    });
  }
  if (relation.quality.flags.includes("level_context_unavailable")) {
    diagnostics.push({
      code: "BENCHMARK_UNAVAILABLE",
      severity: "warning",
      message: `${relation.label} was unavailable from execution-time level context.`,
      affectedBenchmarkIds: [relation.benchmarkId],
    });
  }
  if (relation.quality.status === "missing") {
    diagnostics.push({
      code: "BENCHMARK_UNAVAILABLE",
      severity: "warning",
      message: `${relation.label} was unavailable.`,
      affectedBenchmarkIds: [relation.benchmarkId],
    });
  }
  return diagnostics;
}

function buildMarketFactRelation(params: {
  definition: MarketFactBenchmarkDefinition;
  price: number;
  timestamp: number;
  tradeWindow: TradeAnalysisCandleWindow;
  indicatorBasisCandles: Candle[];
  levelRelations: ExecutionLevelRelations | null;
}): MarketFactBenchmarkRelation {
  const definition = params.definition;
  const endTimestamp = params.timestamp;
  const startTimestamp = definition.kind === "vwap" && definition.sessionScope !== "rolling"
    ? sessionStartTimestamp(endTimestamp, definition.sessionScope)
    : params.tradeWindow.requestedStartTimestamp;
  const relationTimeframe = definition.timeframe === "5m" && params.tradeWindow.timeframe === "1m"
    ? "5m"
    : params.tradeWindow.timeframe;
  const sourceCandles = relationTimeframe === "5m" && params.tradeWindow.timeframe === "1m"
    ? aggregateCandlesToFiveMinutes(params.indicatorBasisCandles)
    : params.indicatorBasisCandles;
  const candles = definition.kind === "vwap" && definition.sessionScope !== "rolling"
    ? candlesInBasisRange(sourceCandles, startTimestamp, endTimestamp, relationTimeframe)
    : closedCandlesThrough(sourceCandles, endTimestamp, relationTimeframe);
  const value =
    definition.kind === "vwap"
      ? calculateLatestVwap(candles)
      : definition.kind === "ema"
        ? buildDynamicLevelsFromCandles(candles, { currentPrice: params.price }).emaByPeriod[definition.emaLength ?? 0] ?? null
        : definition.kind === "support"
          ? params.levelRelations?.nearestSupportBelow?.representativePrice ?? null
          : params.levelRelations?.nearestResistanceAbove?.representativePrice ?? null;
  const level =
    definition.kind === "support"
      ? marketFactLevelMetadata(params.levelRelations?.nearestSupportBelow ?? null)
      : definition.kind === "resistance"
        ? marketFactLevelMetadata(params.levelRelations?.nearestResistanceAbove ?? null)
        : null;
  const basis = buildBasis({
    definition,
    tradeWindow: params.tradeWindow,
    startTimestamp,
    endTimestamp,
    candles,
    timeframe: relationTimeframe,
  });
  const quality =
    definition.kind === "vwap"
      ? qualityForVwap({ value, basis, definition, tradeWindow: params.tradeWindow })
      : definition.kind === "ema"
        ? qualityForEma({ value, basis, definition, tradeWindow: params.tradeWindow })
        : qualityForLevel({
            value,
            basis,
            definition,
            contextAvailable: params.levelRelations !== null,
          });
  return relationFromBenchmark({
    definition,
    price: params.price,
    value,
    level,
    basis,
    quality,
  });
}

function buildDisagreementSummary(
  snapshot: MarketFactExecutionSnapshot,
): MarketFactDisagreementSummary[] {
  const regular = snapshot.relations.find((relation) => relation.benchmarkId === "regular_session_vwap_1m");
  const extended = snapshot.relations.find((relation) => relation.benchmarkId === "extended_session_vwap_1m");
  if (
    !regular ||
    !extended ||
    regular.relation === "missing" ||
    extended.relation === "missing" ||
    regular.relation === extended.relation
  ) {
    return [];
  }
  return [{
    disagreementId: `${snapshot.snapshotId}_regular_vs_extended_vwap`,
    kind: "vwap",
    benchmarkIds: [regular.benchmarkId, extended.benchmarkId],
    summary: `Execution price was ${regular.relation} regular-session VWAP and ${extended.relation} extended-session VWAP.`,
    severity: "info",
  }];
}

function buildCrossedBenchmarksDuringTrade(params: {
  firstSnapshot: MarketFactExecutionSnapshot | undefined;
  tradeCandles: Candle[];
}): MarketFactCrossedBenchmark[] {
  const relations = params.firstSnapshot?.relations.filter((relation) =>
    relation.kind === "vwap" || relation.kind === "ema"
  ) ?? [];
  return relations.flatMap((relation): MarketFactCrossedBenchmark[] => {
    if (relation.value === null || relation.relation === "missing" || relation.relation === "at") {
      return [];
    }
    const crossed = params.tradeCandles.find((candle) =>
      relation.relation === "below" ? candle.high >= relation.value! : candle.low <= relation.value!,
    );
    if (!crossed) {
      return [];
    }
    return [{
      benchmarkId: relation.benchmarkId,
      label: relation.label,
      crossedAtTimestamp: iso(crossed.timestamp),
      direction: relation.relation === "below" ? "above" : "below",
    }];
  });
}

function buildMarketFactTradeWindowSummary(params: {
  tradeWindow: TradeAnalysisCandleWindow;
  tradeWindowFacts: TradeAnalysisTradeWindowFacts;
  executionRelations: TradeAnalysisExecutionRelationFact[];
  firstSnapshot: MarketFactExecutionSnapshot | undefined;
}): MarketFactTradeWindowSummary {
  const firstLevelRelations = params.executionRelations.find((relation) => relation.levelRelations !== null)?.levelRelations ?? null;
  const nearestResistance = firstLevelRelations?.nearestResistanceAbove?.representativePrice ?? null;
  const nearestSupport = firstLevelRelations?.nearestSupportBelow?.representativePrice ?? null;
  const highDuringTrade = params.tradeWindowFacts.highestHighDuringTrade?.price ?? null;
  const lowDuringTrade = params.tradeWindowFacts.lowestLowDuringTrade?.price ?? null;
  return {
    tradeStartTimestamp: iso(params.tradeWindow.tradeStartTimestamp),
    tradeEndTimestamp: iso(params.tradeWindow.tradeEndTimestamp),
    holdDurationMinutes: roundPct((params.tradeWindow.tradeEndTimestamp - params.tradeWindow.tradeStartTimestamp) / ONE_MINUTE_MS),
    highDuringTrade,
    lowDuringTrade,
    maxFavorableMovePct: params.tradeWindowFacts.maxFavorableMovePct,
    maxAdverseMovePct: params.tradeWindowFacts.maxAdverseMovePct,
    crossedBenchmarksDuringTrade: buildCrossedBenchmarksDuringTrade({
      firstSnapshot: params.firstSnapshot,
      tradeCandles: params.tradeWindow.tradeCandles,
    }),
    movedIntoNearestResistance:
      nearestResistance === null || highDuringTrade === null ? null : highDuringTrade >= nearestResistance,
    movedIntoNearestSupport:
      nearestSupport === null || lowDuringTrade === null ? null : lowDuringTrade <= nearestSupport,
    reachedNearestDaily4hResistanceDuringTrade:
      nearestResistance === null || highDuringTrade === null ? null : highDuringTrade >= nearestResistance,
    reachedNearestDaily4hSupportDuringTrade:
      nearestSupport === null || lowDuringTrade === null ? null : lowDuringTrade <= nearestSupport,
  };
}

function buildMarketFactPostTradeSummary(params: {
  tradeWindow: TradeAnalysisCandleWindow;
  tradeWindowFacts: TradeAnalysisTradeWindowFacts;
  executionRelations: TradeAnalysisExecutionRelationFact[];
}): MarketFactPostTradeSummary | null {
  if (params.tradeWindow.postTradeCandles.length === 0) {
    return null;
  }
  const firstLevelRelations = params.executionRelations.find((relation) => relation.levelRelations !== null)?.levelRelations ?? null;
  const nearestResistance = firstLevelRelations?.nearestResistanceAbove?.representativePrice ?? null;
  const nearestSupport = firstLevelRelations?.nearestSupportBelow?.representativePrice ?? null;
  const referencePrice = params.tradeWindowFacts.referencePrice;
  const highestPost = params.tradeWindowFacts.highestHighAfterExit?.price ?? null;
  const lowestPost = params.tradeWindowFacts.lowestLowAfterExit?.price ?? null;
  const postStart = params.tradeWindow.postTradeCandles[0]?.timestamp ?? null;
  const postEnd = params.tradeWindow.postTradeCandles.at(-1)?.timestamp ?? null;
  const maxMoveAfterExitPct = [
    params.tradeWindowFacts.postExitContinuationPct,
    params.tradeWindowFacts.postExitReliefPct,
  ].filter((value): value is number => typeof value === "number")
    .sort((left, right) => Math.abs(right) - Math.abs(left))[0] ?? null;
  return {
    postTradeStartTimestamp: postStart === null ? null : iso(postStart),
    postTradeEndTimestamp: postEnd === null ? null : iso(postEnd),
    maxMoveAfterExitPct,
    reclaimedEntryPriceAfterExit:
      referencePrice === null || highestPost === null || lowestPost === null
        ? null
        : lowestPost <= referencePrice && highestPost >= referencePrice,
    reachedNearestResistanceAfterExit:
      nearestResistance === null || highestPost === null ? null : highestPost >= nearestResistance,
    brokeNearestSupportAfterExit:
      nearestSupport === null || lowestPost === null ? null : lowestPost <= nearestSupport,
    reachedNearestDaily4hResistanceAfterExit:
      nearestResistance === null || highestPost === null ? null : highestPost >= nearestResistance,
    brokeNearestDaily4hSupportAfterExit:
      nearestSupport === null || lowestPost === null ? null : lowestPost <= nearestSupport,
  };
}

function buildTradeAnalysisMarketFacts(params: {
  symbol: string;
  asOfTimestamp: number | null;
  executions: TradeAnalysisExecutionInput[] | undefined;
  tradeWindow: TradeAnalysisCandleWindow;
  indicatorBasisCandles: Candle[];
  tradeWindowFacts: TradeAnalysisTradeWindowFacts;
  executionRelations: TradeAnalysisExecutionRelationFact[];
  executionSupportResistanceContexts: Map<number, ExecutionSupportResistanceContextResult>;
  options: TradeAnalysisMarketFactsOptions | undefined;
}): TradeAnalysisMarketFacts {
  const benchmarkProfile = params.options?.benchmarkProfile ?? "small_cap_day_trade_v1";
  const benchmarkDefinitions = benchmarkDefinitionsForProfile(benchmarkProfile).map((definition) => ({
    ...definition,
    timeframe:
      definition.benchmarkId.endsWith("_5m")
        ? "5m" as const
        : params.tradeWindow.timeframe,
  }));
  const executionSnapshots = (params.executions ?? []).map((execution, index): MarketFactExecutionSnapshot => {
    const timestamp = parseSharedCandleTimestamp(execution.timestamp);
    const price = typeof execution.price === "number" && Number.isFinite(execution.price) && execution.price > 0
      ? execution.price
      : null;
    if (price === null || (params.asOfTimestamp !== null && timestamp > params.asOfTimestamp)) {
      return {
        snapshotId: `execution_${index + 1}`,
        timestamp: iso(timestamp),
        price,
        quantity: execution.quantity,
        side: execution.side,
        relations: [],
        diagnostics: [{
          code: "BENCHMARK_UNAVAILABLE",
          severity: "warning",
          message: price === null
            ? "Execution price was missing or invalid, so benchmark facts were unavailable."
            : "Execution occurred after asOfTimestamp, so benchmark facts were unavailable.",
          affectedBenchmarkIds: benchmarkDefinitions.map((definition) => definition.benchmarkId),
        }],
      };
    }
    const executionContext = params.executionSupportResistanceContexts.get(timestamp)?.context ?? null;
    const executionLevelRelations = executionContext === null
      ? null
      : buildExecutionLevelRelations({
          price,
          levels: executionContext.levels,
          referenceLevels: executionContext.referenceLevels,
          sourceTimeframes: TRADE_REVIEW_LEVEL_SOURCE_TIMEFRAMES,
        });
    const relations = benchmarkDefinitions.map((definition) =>
      buildMarketFactRelation({
        definition,
        price,
        timestamp,
        tradeWindow: params.tradeWindow,
        indicatorBasisCandles: params.indicatorBasisCandles,
        levelRelations: executionLevelRelations,
      }),
    );
    return {
      snapshotId: `execution_${index + 1}`,
      timestamp: iso(timestamp),
      price,
      quantity: execution.quantity,
      side: execution.side,
      relations,
      diagnostics: relations.flatMap(diagnosticsForMarketFactRelation),
    };
  });
  const disagreementSummary = params.options?.includeDisagreementSummary === false
    ? []
    : executionSnapshots.flatMap(buildDisagreementSummary);
  const tradeWindowSummary = buildMarketFactTradeWindowSummary({
    tradeWindow: params.tradeWindow,
    tradeWindowFacts: params.tradeWindowFacts,
    executionRelations: params.executionRelations,
    firstSnapshot: executionSnapshots[0],
  });
  const postTradeSummary = params.options?.includePostTradeSummary === false
    ? null
    : buildMarketFactPostTradeSummary({
        tradeWindow: params.tradeWindow,
        tradeWindowFacts: params.tradeWindowFacts,
        executionRelations: params.executionRelations,
      });
  const diagnostics = [
    ...executionSnapshots.flatMap((snapshot) => snapshot.diagnostics),
    ...disagreementSummary.map((disagreement): MarketFactDiagnostic => ({
      code: "INDICATOR_DISAGREEMENT",
      severity: disagreement.severity,
      message: disagreement.summary,
      affectedBenchmarkIds: disagreement.benchmarkIds,
    })),
  ];
  return {
    contractVersion: "market_facts.trade_review.v2",
    benchmarkProfile,
    symbol: params.symbol,
    asOfTimestamp: params.asOfTimestamp === null ? null : iso(params.asOfTimestamp),
    candleFetchingOwnedBy: "levels-system",
    noLookaheadPolicy: {
      policy: "closed_candles_only",
      candleInclusionRule: "candle_end_lte_snapshot_timestamp",
      partialCandlesRequireLowerGranularitySource: true,
    },
    benchmarkDefinitions,
    executionSnapshots,
    tradeWindowSummary,
    postTradeSummary,
    disagreementSummary,
    diagnostics,
  };
}

type ExecutionSupportResistanceContextResult =
  | {
      context: SupportResistanceSymbolContext;
      diagnostic?: undefined;
    }
  | {
      context?: undefined;
      diagnostic: TradeAnalysisExecutionRelationDiagnostic;
    };

async function buildExecutionSupportResistanceContexts(params: {
  executions: TradeAnalysisExecutionInput[] | undefined;
  request: BuildTradeAnalysisCandleContextRequest;
  symbol: string;
  fetchService: CandleFetchService;
  asOfTimestamp: number | null;
  preferredProvider: HistoricalFetchRequest["preferredProvider"] | undefined;
}): Promise<Map<number, ExecutionSupportResistanceContextResult>> {
  const timestamps = [...new Set((params.executions ?? [])
    .map((execution) => parseSharedCandleTimestamp(execution.timestamp))
    .filter((timestamp) => params.asOfTimestamp === null || timestamp <= params.asOfTimestamp))];
  const entries = await Promise.all(timestamps.map(async (timestamp): Promise<[number, ExecutionSupportResistanceContextResult]> => {
    try {
      const context = await buildSupportResistanceContextForSymbol({
        ...params.request.supportResistance,
        symbol: params.symbol,
        sessionDate: params.request.sessionDate,
        asOfTimestamp: timestamp,
        asOfTimestampByTimeframe: higherTimeframeAsOfCutoffs(timestamp),
        fetchService: params.fetchService,
        preferredProvider: params.preferredProvider,
        currentPrice: validExecutionPrice(
          (params.executions ?? []).find((execution) =>
            parseSharedCandleTimestamp(execution.timestamp) === timestamp
          ),
        ),
      });
      return [timestamp, { context }];
    } catch (error) {
      return [
        timestamp,
        {
          diagnostic: {
            code: "execution_context_unavailable",
            severity: "warning",
            message:
              error instanceof Error
                ? `Execution-time support/resistance context was unavailable (${error.message}).`
                : "Execution-time support/resistance context was unavailable.",
          },
        },
      ];
    }
  }));
  return new Map(entries);
}

function buildExecutionRelationFacts(params: {
  executions: TradeAnalysisExecutionInput[] | undefined;
  supportResistanceContext: SupportResistanceSymbolContext;
  executionSupportResistanceContexts: Map<number, ExecutionSupportResistanceContextResult>;
  tradeWindow: TradeAnalysisCandleWindow;
  asOfTimestamp: number | null;
}): TradeAnalysisExecutionRelationFact[] {
  return (params.executions ?? []).map((execution) => {
    const timestamp = parseSharedCandleTimestamp(execution.timestamp);
    const price = typeof execution.price === "number" && Number.isFinite(execution.price)
      ? execution.price
      : null;
    const diagnostics: TradeAnalysisExecutionRelationDiagnostic[] = [];

    if (params.asOfTimestamp !== null && timestamp > params.asOfTimestamp) {
      diagnostics.push({
        code: "execution_after_as_of",
        severity: "info",
        message: "Execution is after asOfTimestamp, so level relations were intentionally not calculated.",
      });
      return {
        timestamp,
        timestampIso: new Date(timestamp).toISOString(),
        price,
        quantity: execution.quantity,
        side: execution.side,
        levelRelations: null,
        dynamicLevelRelations: null,
        marketStructureState: params.supportResistanceContext.marketStructure.state,
        marketStructureConfidence: params.supportResistanceContext.marketStructure.confidence.label,
        diagnostics,
      };
    }

    if (price === null) {
      diagnostics.push({
        code: "execution_missing_price",
        severity: "warning",
        message: "Execution price is missing, so level relations were not calculated.",
      });
    } else if (price <= 0) {
      diagnostics.push({
        code: "execution_invalid_price",
        severity: "warning",
        message: "Execution price must be positive, so level relations were not calculated.",
      });
    }

    const usablePrice = price !== null && price > 0 ? price : null;
    const executionCandles = closedCandlesThrough(
      params.tradeWindow.allCandles,
      timestamp,
      params.tradeWindow.timeframe,
    );
    if (executionCandles.length === 0) {
      diagnostics.push({
        code: "execution_missing_trade_window_candles",
        severity: "warning",
        message: "No trade-window candles were available at or before this execution timestamp.",
      });
    }
    const executionDynamicLevels = executionCandles.length === 0 || usablePrice === null
      ? null
      : buildDynamicLevelsFromCandles(executionCandles, {
          sessionDate: sessionDateForTimestamp(timestamp),
          currentPrice: usablePrice,
        });
    const executionContextResult = params.executionSupportResistanceContexts.get(timestamp);
    if (executionContextResult?.diagnostic) {
      diagnostics.push(executionContextResult.diagnostic);
    }
    const executionSupportResistanceContext = executionContextResult?.context ?? null;
    const marketStructureContext = executionSupportResistanceContext ?? params.supportResistanceContext;
    return {
      timestamp,
      timestampIso: new Date(timestamp).toISOString(),
      price,
      quantity: execution.quantity,
      side: execution.side,
      levelRelations: usablePrice === null || executionSupportResistanceContext === null
        ? null
        : buildExecutionLevelRelations({
            price: usablePrice,
            levels: executionSupportResistanceContext.levels,
            referenceLevels: executionSupportResistanceContext.referenceLevels,
            sourceTimeframes: TRADE_REVIEW_LEVEL_SOURCE_TIMEFRAMES,
          }),
      dynamicLevelRelations: executionDynamicLevels === null || usablePrice === null
        ? null
        : buildDynamicRelationsForPrice(usablePrice, executionDynamicLevels),
      marketStructureState: marketStructureContext.marketStructure.state,
      marketStructureConfidence: marketStructureContext.marketStructure.confidence.label,
      diagnostics,
    };
  });
}

export async function buildTradeAnalysisCandleContext(
  request: BuildTradeAnalysisCandleContextRequest,
): Promise<TradeAnalysisCandleContext> {
  const symbol = normalizeSymbol(request.symbol);
  const preferredProvider = effectivePreferredProvider(request);
  const fetchService = buildFetchService(request);
  const bounds = resolveTradeWindowBounds(request);
  const timeframe = request.tradeWindow?.timeframe ?? "1m";
  const fallbackTimeframe = request.tradeWindow?.fallbackTimeframe ?? "5m";
  const allowFiveMinuteFallback = request.tradeWindow?.allowFiveMinuteFallback ?? true;
  const preTradeMinutes = safePositiveInteger(request.tradeWindow?.preTradeMinutes, DEFAULT_PRE_TRADE_MINUTES);
  const postTradeMinutes = safePositiveInteger(request.tradeWindow?.postTradeMinutes, DEFAULT_POST_TRADE_MINUTES);
  const paddingMinutes = Math.max(0, request.tradeWindow?.paddingMinutes ?? DEFAULT_PADDING_MINUTES);
  const requestedStartTimestamp =
    bounds.tradeStartTimestamp - (preTradeMinutes + paddingMinutes) * ONE_MINUTE_MS;
  const indicatorBasisStartTimestamp = Math.min(
    requestedStartTimestamp,
    sessionStartTimestamp(bounds.tradeStartTimestamp, "extended_session"),
  );
  const unclampedEndTimestamp =
    bounds.tradeEndTimestamp + (postTradeMinutes + paddingMinutes) * ONE_MINUTE_MS;
  const requestedEndTimestamp =
    bounds.asOfTimestamp === null ? unclampedEndTimestamp : Math.min(unclampedEndTimestamp, bounds.asOfTimestamp);
  const supportResistanceAsOfTimestamp = bounds.asOfTimestamp ?? bounds.tradeStartTimestamp;
  const supportResistanceCutoffs = higherTimeframeAsOfCutoffs(supportResistanceAsOfTimestamp);
  const priceAnchor = firstExecutionPriceAtOrBefore(request.executions, supportResistanceAsOfTimestamp);
  const intervalMs = timeframeMs(timeframe);
  const computedLookbackBars = Math.max(1, Math.ceil((requestedEndTimestamp - indicatorBasisStartTimestamp) / intervalMs) + 2);
  const lookbackBars = request.tradeWindow?.lookbackBars ?? computedLookbackBars;

  const [supportResistanceContext, tradeWindowFetch] = await Promise.all([
    buildSupportResistanceContextForSymbol({
      ...request.supportResistance,
      symbol,
      sessionDate: request.sessionDate,
      asOfTimestamp: supportResistanceAsOfTimestamp,
      asOfTimestampByTimeframe: supportResistanceCutoffs,
      fetchService,
      preferredProvider,
      currentPrice: priceAnchor,
    }),
    fetchTradeWindowCandles({
      fetchService,
      symbol,
      requestedTimeframe: timeframe,
      fallbackTimeframe,
      allowFiveMinuteFallback,
      lookbackBars,
      requestedEndTimestamp,
      preferredProvider,
    }),
  ]);
  const tradeWindowResponse = tradeWindowFetch.response;

  const tradeWindowTimeframe = tradeWindowResponse.timeframe as "1m" | "5m";
  const indicatorBasisFilter = filterCandlesByCloseAsOf({
    candles: tradeWindowResponse.candles
      .filter((candle) => candle.timestamp >= indicatorBasisStartTimestamp),
    timeframe: tradeWindowTimeframe,
    asOfTimestamp: requestedEndTimestamp,
  });
  const indicatorBasisCandles = indicatorBasisFilter.candles;
  const allCandles = indicatorBasisCandles
    .filter((candle) => candle.timestamp >= requestedStartTimestamp)
    .sort((left, right) => left.timestamp - right.timestamp);
  const currentWindowCandle = allCandles.at(-1);
  const tradeWindow: TradeAnalysisCandleWindow = {
    timeframe: tradeWindowTimeframe,
    requestedTimeframe: tradeWindowFetch.requestedTimeframe,
    fallbackUsed: tradeWindowFetch.fallbackUsed,
    requestedStartTimestamp,
    requestedEndTimestamp,
    tradeStartTimestamp: bounds.tradeStartTimestamp,
    tradeEndTimestamp: bounds.tradeEndTimestamp,
    preTradeCandles: allCandles.filter((candle) =>
      candleEndsBeforeTimestamp({
        candle,
        timeframe: tradeWindowTimeframe,
        timestamp: bounds.tradeStartTimestamp,
      }),
    ),
    tradeCandles: allCandles.filter((candle) =>
      candleOverlapsTimestampRange({
        candle,
        timeframe: tradeWindowTimeframe,
        startTimestamp: bounds.tradeStartTimestamp,
        endTimestamp: bounds.tradeEndTimestamp,
      }),
    ),
    postTradeCandles: allCandles.filter((candle) =>
      candleStartsAfterTimestamp(candle, bounds.tradeEndTimestamp),
    ),
    allCandles,
    dynamicLevels: buildDynamicLevelsFromCandles(allCandles, {
      sessionDate: currentWindowCandle ? sessionDateForTimestamp(currentWindowCandle.timestamp) : request.sessionDate,
      currentPrice: typeof currentWindowCandle?.close === "number" ? currentWindowCandle.close : undefined,
    }),
    fetch: buildFetchSummary(tradeWindowResponse),
  };
  const diagnostics = diagnosticsForTradeWindow({
    window: tradeWindow,
    response: tradeWindowResponse,
    executions: request.executions,
    truncatedByAsOf: requestedEndTimestamp < unclampedEndTimestamp,
    supportResistanceAsOfTimestamp,
    supportResistanceCutoffs,
    priceAnchor,
    precomputedDiagnostics: [
      ...tradeWindowFetch.diagnostics,
      ...diagnosticsFromCandleFilters(indicatorBasisFilter.diagnostics),
    ],
  });
  const executionSupportResistanceContexts = await buildExecutionSupportResistanceContexts({
    executions: request.executions,
    request,
    symbol,
    fetchService,
    asOfTimestamp: bounds.asOfTimestamp,
    preferredProvider,
  });
  const executionRelations = buildExecutionRelationFacts({
    executions: request.executions,
    supportResistanceContext,
    executionSupportResistanceContexts,
    tradeWindow,
    asOfTimestamp: bounds.asOfTimestamp,
  });
  const tradeWindowFacts = buildTradeWindowFacts({
    executions: request.executions,
    window: tradeWindow,
    asOfTimestamp: bounds.asOfTimestamp,
  });
  const marketFacts = buildTradeAnalysisMarketFacts({
    symbol,
    asOfTimestamp: bounds.asOfTimestamp,
    executions: request.executions,
    tradeWindow,
    indicatorBasisCandles,
    tradeWindowFacts,
    executionRelations,
    executionSupportResistanceContexts,
    options: request.marketFacts,
  });

  return {
    symbol,
    mode: "trade_analysis",
    candleFetchingOwnedBy: "levels-system",
    asOfTimestamp: bounds.asOfTimestamp,
    supportResistanceContext,
    tradeWindow,
    tradeWindowFacts,
    executionRelations,
    marketFacts,
    diagnostics,
  };
}
