import type { CandleFetchService, HistoricalFetchRequest } from "../market-data/candle-fetch-service.js";
import { formatCandleDiagnostics } from "../market-data/candle-quality.js";
import type {
  CandleProviderName,
  CandleProviderResponse,
  CandleValidationIssue,
} from "../market-data/candle-types.js";

export type CandleSourceHealthStatus = "healthy" | "degraded" | "unavailable";

export type CandleSourceHealthReport = {
  provider: CandleProviderName | "unknown";
  symbol: string;
  timeframe: HistoricalFetchRequest["timeframe"];
  requestedLookbackBars: number;
  status: CandleSourceHealthStatus;
  reason: string;
  diagnostics: string;
  response: CandleProviderResponse | null;
  errorMessage?: string;
};

function hasErrorSeverity(issues: CandleValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

function buildStatusFromResponse(response: CandleProviderResponse): {
  status: CandleSourceHealthStatus;
  reason: string;
} {
  if (response.actualBarsReturned === 0 || response.completenessStatus === "empty") {
    return {
      status: "unavailable",
      reason: "provider returned no candles",
    };
  }

  if (response.stale || hasErrorSeverity(response.validationIssues)) {
    return {
      status: "degraded",
      reason: "provider returned candles but data quality is degraded",
    };
  }

  if (
    response.completenessStatus !== "complete" ||
    response.validationIssues.length > 0
  ) {
    return {
      status: "degraded",
      reason: "provider returned partial candles or warnings",
    };
  }

  return {
    status: "healthy",
    reason: "provider returned usable candles",
  };
}

export async function checkCandleSourceHealth(
  candleFetchService: CandleFetchService,
  request: HistoricalFetchRequest,
): Promise<CandleSourceHealthReport> {
  try {
    const response = await candleFetchService.fetchCandles(request);
    const summary = buildStatusFromResponse(response);

    return {
      provider: response.provider,
      symbol: response.symbol,
      timeframe: response.timeframe,
      requestedLookbackBars: response.requestedLookbackBars,
      status: summary.status,
      reason: summary.reason,
      diagnostics: formatCandleDiagnostics(response),
      response,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      provider: "unknown",
      symbol: request.symbol.trim().toUpperCase(),
      timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars,
      status: "unavailable",
      reason: "provider request failed",
      diagnostics: `provider=unknown | timeframe=${request.timeframe} | requested=${request.lookbackBars} | status=unavailable | error=${errorMessage}`,
      response: null,
      errorMessage,
    };
  }
}

export function formatCandleSourceHealthReport(report: CandleSourceHealthReport): string {
  return [
    `symbol=${report.symbol}`,
    `timeframe=${report.timeframe}`,
    `provider=${report.provider}`,
    `status=${report.status}`,
    `reason=${report.reason}`,
    report.diagnostics,
  ].join(" | ");
}
