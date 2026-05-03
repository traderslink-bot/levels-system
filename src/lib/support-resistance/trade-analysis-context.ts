import {
  CandleFetchService,
  type CandleFetchServiceOptions,
  type HistoricalFetchRequest,
} from "../market-data/candle-fetch-service.js";
import type { Candle, CandleFetchTimeframe, CandleProviderResponse } from "../market-data/candle-types.js";
import type {
  BuildSupportResistanceContextForSymbolRequest,
  SupportResistanceSymbolContext,
} from "./symbol-context.js";
import {
  buildSupportResistanceContextForSymbol,
} from "./symbol-context.js";
import {
  parseSharedCandleTimestamp,
  type SharedCandleTimestamp,
} from "./build-support-resistance-context.js";
import {
  buildExecutionLevelRelations,
  type ExecutionLevelRelations,
} from "./execution-level-relations.js";
import type {
  DynamicLevelPriceContext,
  DynamicLevelsFromCandles,
} from "./indicators/index.js";

export type TradeAnalysisExecutionInput = {
  timestamp: SharedCandleTimestamp;
  price?: number;
  quantity?: number;
  side?: "buy" | "sell" | "unknown";
};

export type TradeAnalysisCandleWindowOptions = {
  timeframe?: Extract<CandleFetchTimeframe, "1m" | "5m">;
  preTradeMinutes?: number;
  postTradeMinutes?: number;
  paddingMinutes?: number;
  lookbackBars?: number;
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
  supportResistance?: Omit<
    BuildSupportResistanceContextForSymbolRequest,
    "symbol" | "sessionDate" | "asOfTimestamp" | "fetchService" | "fetchServiceOptions" | "preferredProvider"
  >;
  tradeWindow?: TradeAnalysisCandleWindowOptions;
};

export type TradeAnalysisCandleWindow = {
  timeframe: Extract<CandleFetchTimeframe, "1m" | "5m">;
  requestedStartTimestamp: number;
  requestedEndTimestamp: number;
  tradeStartTimestamp: number;
  tradeEndTimestamp: number;
  preTradeCandles: Candle[];
  tradeCandles: Candle[];
  postTradeCandles: Candle[];
  allCandles: Candle[];
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
  | "trade_window_missing_pre_trade_candles"
  | "trade_window_missing_trade_candles"
  | "trade_window_missing_post_trade_candles"
  | "trade_window_truncated_by_as_of"
  | "trade_window_provider_warning";

export type TradeAnalysisCandleContextDiagnostic = {
  code: TradeAnalysisCandleContextDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
};

export type TradeAnalysisExecutionRelationDiagnosticCode =
  | "execution_after_as_of"
  | "execution_missing_price"
  | "execution_invalid_price";

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

export type TradeAnalysisCandleContext = {
  symbol: string;
  mode: "trade_analysis";
  candleFetchingOwnedBy: "levels-system";
  asOfTimestamp: number | null;
  supportResistanceContext: SupportResistanceSymbolContext;
  tradeWindow: TradeAnalysisCandleWindow;
  executionRelations: TradeAnalysisExecutionRelationFact[];
  diagnostics: TradeAnalysisCandleContextDiagnostic[];
};

const DEFAULT_PRE_TRADE_MINUTES = 60;
const DEFAULT_POST_TRADE_MINUTES = 60;
const DEFAULT_PADDING_MINUTES = 5;
const ONE_MINUTE_MS = 60_000;
const FIVE_MINUTE_MS = 5 * ONE_MINUTE_MS;

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    throw new Error("symbol is required.");
  }
  return normalized;
}

function buildFetchService(request: BuildTradeAnalysisCandleContextRequest): CandleFetchService {
  return (
    request.fetchService ??
    new CandleFetchService({
      ...request.fetchServiceOptions,
      providerName: request.preferredProvider ?? request.fetchServiceOptions?.providerName,
    })
  );
}

function parseOptionalTimestamp(timestamp: SharedCandleTimestamp | undefined): number | null {
  return timestamp === undefined ? null : parseSharedCandleTimestamp(timestamp);
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

function diagnosticsForTradeWindow(params: {
  window: TradeAnalysisCandleWindow;
  response: CandleProviderResponse;
  truncatedByAsOf: boolean;
}): TradeAnalysisCandleContextDiagnostic[] {
  const diagnostics: TradeAnalysisCandleContextDiagnostic[] = [
    {
      code: "trade_window_fetched",
      severity: "info",
      message: `Fetched ${params.response.actualBarsReturned} ${params.response.timeframe} candles for trade-window analysis.`,
    },
  ];

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

  return diagnostics;
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

function buildExecutionRelationFacts(params: {
  executions: TradeAnalysisExecutionInput[] | undefined;
  supportResistanceContext: SupportResistanceSymbolContext;
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
    return {
      timestamp,
      timestampIso: new Date(timestamp).toISOString(),
      price,
      quantity: execution.quantity,
      side: execution.side,
      levelRelations: usablePrice === null
        ? null
        : buildExecutionLevelRelations({
            price: usablePrice,
            levels: params.supportResistanceContext.levels,
            referenceLevels: params.supportResistanceContext.referenceLevels,
          }),
      dynamicLevelRelations: usablePrice === null
        ? null
        : buildDynamicRelationsForPrice(usablePrice, params.supportResistanceContext.dynamicLevels),
      marketStructureState: params.supportResistanceContext.marketStructure.state,
      marketStructureConfidence: params.supportResistanceContext.marketStructure.confidence.label,
      diagnostics,
    };
  });
}

export async function buildTradeAnalysisCandleContext(
  request: BuildTradeAnalysisCandleContextRequest,
): Promise<TradeAnalysisCandleContext> {
  const symbol = normalizeSymbol(request.symbol);
  const fetchService = buildFetchService(request);
  const bounds = resolveTradeWindowBounds(request);
  const timeframe = request.tradeWindow?.timeframe ?? "1m";
  const preTradeMinutes = safePositiveInteger(request.tradeWindow?.preTradeMinutes, DEFAULT_PRE_TRADE_MINUTES);
  const postTradeMinutes = safePositiveInteger(request.tradeWindow?.postTradeMinutes, DEFAULT_POST_TRADE_MINUTES);
  const paddingMinutes = Math.max(0, request.tradeWindow?.paddingMinutes ?? DEFAULT_PADDING_MINUTES);
  const requestedStartTimestamp =
    bounds.tradeStartTimestamp - (preTradeMinutes + paddingMinutes) * ONE_MINUTE_MS;
  const unclampedEndTimestamp =
    bounds.tradeEndTimestamp + (postTradeMinutes + paddingMinutes) * ONE_MINUTE_MS;
  const requestedEndTimestamp =
    bounds.asOfTimestamp === null ? unclampedEndTimestamp : Math.min(unclampedEndTimestamp, bounds.asOfTimestamp);
  const intervalMs = timeframeMs(timeframe);
  const computedLookbackBars = Math.max(1, Math.ceil((requestedEndTimestamp - requestedStartTimestamp) / intervalMs) + 2);
  const lookbackBars = request.tradeWindow?.lookbackBars ?? computedLookbackBars;

  const [supportResistanceContext, tradeWindowResponse] = await Promise.all([
    buildSupportResistanceContextForSymbol({
      ...request.supportResistance,
      symbol,
      sessionDate: request.sessionDate,
      asOfTimestamp: bounds.asOfTimestamp ?? bounds.tradeStartTimestamp,
      fetchService,
      preferredProvider: request.preferredProvider,
    }),
    fetchService.fetchCandles({
      symbol,
      timeframe,
      lookbackBars,
      endTimeMs: requestedEndTimestamp,
      preferredProvider: request.preferredProvider,
    }),
  ]);

  const allCandles = tradeWindowResponse.candles
    .filter((candle) => candle.timestamp >= requestedStartTimestamp && candle.timestamp <= requestedEndTimestamp)
    .sort((left, right) => left.timestamp - right.timestamp);
  const tradeWindow: TradeAnalysisCandleWindow = {
    timeframe,
    requestedStartTimestamp,
    requestedEndTimestamp,
    tradeStartTimestamp: bounds.tradeStartTimestamp,
    tradeEndTimestamp: bounds.tradeEndTimestamp,
    preTradeCandles: allCandles.filter((candle) => candle.timestamp < bounds.tradeStartTimestamp),
    tradeCandles: allCandles.filter(
      (candle) => candle.timestamp >= bounds.tradeStartTimestamp && candle.timestamp <= bounds.tradeEndTimestamp,
    ),
    postTradeCandles: allCandles.filter((candle) => candle.timestamp > bounds.tradeEndTimestamp),
    allCandles,
    fetch: buildFetchSummary(tradeWindowResponse),
  };
  const diagnostics = diagnosticsForTradeWindow({
    window: tradeWindow,
    response: tradeWindowResponse,
    truncatedByAsOf: requestedEndTimestamp < unclampedEndTimestamp,
  });
  const executionRelations = buildExecutionRelationFacts({
    executions: request.executions,
    supportResistanceContext,
    asOfTimestamp: bounds.asOfTimestamp,
  });

  return {
    symbol,
    mode: "trade_analysis",
    candleFetchingOwnedBy: "levels-system",
    asOfTimestamp: bounds.asOfTimestamp,
    supportResistanceContext,
    tradeWindow,
    executionRelations,
    diagnostics,
  };
}
