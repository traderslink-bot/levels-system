import { createHistoricalCandleProvider } from "./provider-factory.js";
import type { HistoricalCandleProvider } from "./provider-types.js";
import { buildTradeCandleContext, type BuildTradeCandleContextRequest } from "./trade-candle-context.js";

/** Evaluate the effective selection on every call, including admin changes.
 * All Alpaca AI history frames share its split-adjusted price basis. Never
 * silently combine a failed Alpaca request with legacy unadjusted history.
 */
export function createWatchlistAiHistoricalLoader(
  selectedProvider: () => string,
  createProvider: () => HistoricalCandleProvider = () => createHistoricalCandleProvider({ provider: "alpaca" }),
) {
  return (request: BuildTradeCandleContextRequest) => buildTradeCandleContext(
    selectedProvider() === "alpaca"
      ? { ...request, providerOverride: createProvider() }
      : request,
  );
}
