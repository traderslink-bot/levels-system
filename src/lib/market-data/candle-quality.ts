import type { BaseCandleProviderResponse, CandleProviderResponse } from "./candle-types.js";
import { buildCandleSessionSummary } from "./candle-session-classifier.js";
import { validateCandleResponse } from "./candle-validation.js";

export function finalizeCandleProviderResponse(
  response: BaseCandleProviderResponse,
): CandleProviderResponse {
  const validation = validateCandleResponse(response);

  return {
    ...response,
    actualBarsReturned: response.candles.length,
    completenessStatus: validation.completenessStatus,
    stale: validation.stale,
    validationIssues: validation.validationIssues,
    sessionSummary: response.sessionMetadataAvailable
      ? buildCandleSessionSummary(response.candles, response.timeframe)
      : null,
  };
}

export function formatCandleDiagnostics(response: CandleProviderResponse): string {
  const oldestTimestamp = response.candles[0]?.timestamp ?? null;
  const newestTimestamp = response.candles.at(-1)?.timestamp ?? null;
  const warnings =
    response.validationIssues.length > 0
      ? response.validationIssues.map((issue) => `${issue.severity}:${issue.code}`).join(", ")
      : "none";
  const sessionSummary = response.sessionSummary
    ? [
        `premarket=${response.sessionSummary.premarketBars}`,
        `opening_range=${response.sessionSummary.openingRangeBars}`,
        `regular=${response.sessionSummary.regularBars}`,
        `after_hours=${response.sessionSummary.afterHoursBars}`,
        `extended=${response.sessionSummary.extendedBars}`,
      ].join(", ")
    : "unavailable";

  return [
    `provider=${response.provider}`,
    `timeframe=${response.timeframe}`,
    `requested=${response.requestedLookbackBars}`,
    `returned=${response.actualBarsReturned}`,
    `oldest=${oldestTimestamp ?? "none"}`,
    `newest=${newestTimestamp ?? "none"}`,
    `completeness=${response.completenessStatus}`,
    `stale=${response.stale}`,
    `warnings=${warnings}`,
    `session_summary=${sessionSummary}`,
  ].join(" | ");
}
