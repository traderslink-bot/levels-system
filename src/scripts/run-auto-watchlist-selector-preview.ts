import "dotenv/config";

import { AutoWatchlistSelector } from "../lib/auto-watchlist/auto-watchlist-selector.js";
import { createFinnhubClientFromEnv } from "../lib/stock-context/finnhub-client.js";
import { createYahooClientFromEnv } from "../lib/stock-context/yahoo-client.js";

const selector = new AutoWatchlistSelector({
  yahooClient: createYahooClientFromEnv(),
  finnhubClient: createFinnhubClientFromEnv(),
  getActiveSymbols: () => [],
  isRuntimeReady: () => true,
  activateSymbol: async () => {
    throw new Error("Preview mode must never activate a ticker.");
  },
});

const status = await selector.previewScan();
process.stdout.write(`${JSON.stringify({
  candidateCount: status.lastScanCandidateCount,
  qualifiedCount: status.lastQualifiedCount,
  error: status.lastError,
  thresholds: status.thresholds,
  decisions: status.recentDecisions.slice(0, 12).map((decision) => ({
    symbol: decision.symbol,
    score: decision.score,
    qualified: decision.qualified,
    marketCap: decision.marketCap,
    floatShares: decision.floatShares,
    sharesOutstanding: decision.sharesOutstanding,
    reasons: decision.reasons,
    rejectionReasons: decision.rejectionReasons,
  })),
}, null, 2)}\n`);
