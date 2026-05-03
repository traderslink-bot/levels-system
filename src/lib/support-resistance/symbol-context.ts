import {
  CandleFetchService,
  type CandleFetchServiceOptions,
  type HistoricalFetchRequest,
} from "../market-data/candle-fetch-service.js";
import type { CandleProviderName, CandleProviderResponse, CandleTimeframe } from "../market-data/candle-types.js";
import type { StockContextPreview } from "../stock-context/stock-context-types.js";
import type { LevelEngineRuntimeOptions } from "../levels/level-engine.js";
import type { LevelEngineConfig } from "../levels/level-config.js";
import {
  buildSupportResistanceContextFromNormalizedCandles,
  parseSharedCandleTimestamp,
  sortSharedCandles,
  type SharedCandleTimestamp,
  type SupportResistanceContext,
} from "./build-support-resistance-context.js";

export type SupportResistanceSymbolContextDiagnosticCode =
  | "fetched_candle_group"
  | "missing_optional_5m_candles"
  | "missing_required_higher_timeframe"
  | "provider_warning";

export type SupportResistanceSymbolContextDiagnostic = {
  code: SupportResistanceSymbolContextDiagnosticCode;
  severity: "info" | "warning" | "error";
  timeframe?: CandleTimeframe;
  message: string;
};

export type SupportResistanceSymbolFetchSummary = {
  timeframe: CandleTimeframe;
  provider: CandleProviderName;
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

export type BuildSupportResistanceContextForSymbolRequest = {
  symbol: string;
  sessionDate?: string;
  asOfTimestamp?: SharedCandleTimestamp;
  lookbackBars?: Partial<Record<CandleTimeframe, number>>;
  fetchService?: CandleFetchService;
  fetchServiceOptions?: CandleFetchServiceOptions;
  preferredProvider?: HistoricalFetchRequest["preferredProvider"];
  currentPrice?: number;
  bid?: number;
  ask?: number;
  stockContext?: StockContextPreview | null;
  knownCatalyst?: boolean;
  config?: LevelEngineConfig;
  runtimeOptions?: LevelEngineRuntimeOptions;
};

export type SupportResistanceSymbolContext = SupportResistanceContext & {
  mode: "symbol";
  candleFetchingOwnedBy: "levels-system";
  requestedTimeframes: CandleTimeframe[];
  fetches: SupportResistanceSymbolFetchSummary[];
  diagnostics: SupportResistanceSymbolContextDiagnostic[];
};

const DEFAULT_LOOKBACK_BARS: Record<CandleTimeframe, number> = {
  daily: 520,
  "4h": 180,
  "5m": 120,
};

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    throw new Error("symbol is required.");
  }
  return normalized;
}

function buildFetchService(request: BuildSupportResistanceContextForSymbolRequest): CandleFetchService {
  return (
    request.fetchService ??
    new CandleFetchService({
      ...request.fetchServiceOptions,
      providerName: request.preferredProvider ?? request.fetchServiceOptions?.providerName,
    })
  );
}

function fetchSummary(response: CandleProviderResponse): SupportResistanceSymbolFetchSummary {
  const freshnessStatus: SupportResistanceSymbolFetchSummary["freshnessStatus"] =
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
    timeframe: response.timeframe as CandleTimeframe,
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

function diagnosticsFromResponses(
  responses: Partial<Record<CandleTimeframe, CandleProviderResponse>>,
): SupportResistanceSymbolContextDiagnostic[] {
  const diagnostics: SupportResistanceSymbolContextDiagnostic[] = [];
  for (const timeframe of ["daily", "4h"] as const) {
    const response = responses[timeframe];
    if (!response || response.completenessStatus === "empty") {
      diagnostics.push({
        code: "missing_required_higher_timeframe",
        severity: "error",
        timeframe,
        message: `${timeframe} candles are required for full support/resistance context.`,
      });
    }
  }

  if (!responses["5m"] || responses["5m"]?.completenessStatus === "empty") {
    diagnostics.push({
      code: "missing_optional_5m_candles",
      severity: "warning",
      timeframe: "5m",
      message: "5m candles are optional, but missing 5m data limits dynamic and intraday context.",
    });
  }

  for (const response of Object.values(responses)) {
    if (!response) {
      continue;
    }
    diagnostics.push({
      code: "fetched_candle_group",
      severity: "info",
      timeframe: response.timeframe as CandleTimeframe,
      message: `Fetched ${response.actualBarsReturned} ${response.timeframe} candles from ${response.provider}.`,
    });
    for (const issue of response.validationIssues) {
      diagnostics.push({
        code: "provider_warning",
        severity: issue.severity,
        timeframe: response.timeframe as CandleTimeframe,
        message: issue.message,
      });
    }
  }

  return diagnostics;
}

export async function buildSupportResistanceContextForSymbol(
  request: BuildSupportResistanceContextForSymbolRequest,
): Promise<SupportResistanceSymbolContext> {
  const symbol = normalizeSymbol(request.symbol);
  const fetchService = buildFetchService(request);
  const endTimeMs =
    request.asOfTimestamp === undefined
      ? undefined
      : parseSharedCandleTimestamp(request.asOfTimestamp);
  const requestedTimeframes: CandleTimeframe[] = ["daily", "4h", "5m"];

  const settled = await Promise.allSettled(
    requestedTimeframes.map((timeframe) =>
      fetchService.fetchCandles({
        symbol,
        timeframe,
        lookbackBars: request.lookbackBars?.[timeframe] ?? DEFAULT_LOOKBACK_BARS[timeframe],
        endTimeMs,
        preferredProvider: request.preferredProvider,
      }),
    ),
  );

  const responses: Partial<Record<CandleTimeframe, CandleProviderResponse>> = {};
  const failedDiagnostics: SupportResistanceSymbolContextDiagnostic[] = [];
  for (const [index, result] of settled.entries()) {
    const timeframe = requestedTimeframes[index]!;
    if (result.status === "fulfilled") {
      responses[timeframe] = result.value;
      continue;
    }
    failedDiagnostics.push({
      code: timeframe === "5m" ? "missing_optional_5m_candles" : "missing_required_higher_timeframe",
      severity: timeframe === "5m" ? "warning" : "error",
      timeframe,
      message:
        result.reason instanceof Error
          ? result.reason.message
          : `Failed to fetch ${timeframe} candles for ${symbol}.`,
    });
  }

  const diagnostics = [...failedDiagnostics, ...diagnosticsFromResponses(responses)];
  const daily = responses.daily;
  const fourHour = responses["4h"];
  if (!daily || !fourHour) {
    throw new Error(
      `Cannot build full support/resistance context for ${symbol}: daily and 4h candles are required.`,
    );
  }

  const baseContext = await buildSupportResistanceContextFromNormalizedCandles({
    symbol,
    candlesByTimeframe: {
      daily: sortSharedCandles(daily.candles),
      "4h": sortSharedCandles(fourHour.candles),
      "5m": sortSharedCandles(responses["5m"]?.candles),
    },
    providerByTimeframe: {
      daily: daily.provider,
      "4h": fourHour.provider,
      ...(responses["5m"] ? { "5m": responses["5m"]!.provider } : {}),
    },
    sessionDate: request.sessionDate,
    asOfTimestamp: endTimeMs,
    currentPrice: request.currentPrice,
    bid: request.bid,
    ask: request.ask,
    stockContext: request.stockContext,
    knownCatalyst: request.knownCatalyst,
    config: request.config,
    runtimeOptions: request.runtimeOptions,
  });

  return {
    ...baseContext,
    mode: "symbol",
    candleFetchingOwnedBy: "levels-system",
    requestedTimeframes,
    fetches: Object.values(responses).map(fetchSummary),
    diagnostics,
  };
}
