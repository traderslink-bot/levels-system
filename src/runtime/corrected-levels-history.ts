import type { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { readAcceptedChartInput } from "../lib/market-data/accepted-chart-input.js";
import { buildHistoricalFetchPlan } from "../lib/market-data/fetch-planning.js";
import { readAlpacaRuntimeTradeRevisions } from "../lib/market-data/alpaca-runtime-providers.js";
import { MAX_RUNTIME_TRADE_REVISION_WINDOW_MS } from "../lib/market-data/runtime-trade-revisions.js";

type History = Pick<CandleFetchService, "fetchCandles" | "getProviderName">;

/** Fence one calculation across all contributing frames, without caching results. */
export async function generateWithCurrentAlpacaHistory<T>(input: {
  symbol: string;
  history: History;
  generate: (history: History) => Promise<T>;
  readRevisions?: typeof readAlpacaRuntimeTradeRevisions;
  now?: () => number;
}): Promise<T> {
  if (input.history.getProviderName() !== "alpaca") return input.generate(input.history);
  // History includes its end timestamp; the manifest uses a half-open window.
  const cutoff = (input.now ?? Date.now)();
  const scope = { symbols: [input.symbol], start: cutoff + 1 - MAX_RUNTIME_TRADE_REVISION_WINDOW_MS, end: cutoff + 1 };
  const read = input.readRevisions ?? readAlpacaRuntimeTradeRevisions;
  const before = (await read(scope)).symbols[input.symbol];
  if (before?.pending) throw Error("Trade corrections are pending.");
  let refused = false;
  const history: History = {
    getProviderName: () => input.history.getProviderName(),
    async fetchCandles(request) {
      let affected = false;
      try {
        if (request.symbol !== input.symbol || input.history.getProviderName() !== "alpaca" ||
            request.preferredProvider !== undefined && request.preferredProvider !== "alpaca") {
          refused = true;
          throw Error("Historical source changed during calculation.");
        }
        const acceptedFrame = request.timeframe === "daily" || request.timeframe === "4h";
        const frozen = { ...request, endTimeMs: Math.min(request.endTimeMs ?? cutoff, cutoff),
          ...(acceptedFrame ? { acceptedEvidence: true } : {}) };
        const plan = buildHistoricalFetchPlan(frozen, "alpaca");
        if (plan.requestStartTimestamp < scope.start || plan.requestEndTimestamp >= scope.end) {
          refused = true;
          throw Error("Historical request exceeds the correction scope.");
        }
        affected = before?.minutes.some(minute => minute * 1000 >= plan.requestStartTimestamp &&
          minute * 1000 <= plan.requestEndTimestamp) ?? false;
        const series = await input.history.fetchCandles(frozen);
        if (acceptedFrame && affected && !readAcceptedChartInput(series)) {
          refused = true;
          throw Error("Corrected historical coverage is not qualified.");
        }
        return series;
      } catch (error) {
        if (affected) refused = true;
        throw error;
      }
    },
  };
  const result = await input.generate(history);
  const after = (await read(scope)).symbols[input.symbol];
  // LevelEngine may contain a refused frame and continue with another one.
  if (refused || input.history.getProviderName() !== "alpaca" || after?.pending ||
      (before?.revision ?? null) !== (after?.revision ?? null)) {
    throw Error("Historical corrections changed during calculation.");
  }
  return result;
}
