/** Supported Watchlist choices. Standard short-context USD per million tokens.
 * Official model pages verified 2026-09-24; defaults remain in settings/service.
 */
export const WATCHLIST_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-6-luna", "gpt-6-sol"] as const;
export type WatchlistModel = typeof WATCHLIST_MODELS[number];
export const WATCHLIST_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type WatchlistReasoningEffort = typeof WATCHLIST_REASONING_EFFORTS[number];
export function isWatchlistModel(value: unknown): value is WatchlistModel {
  return typeof value === "string" && (WATCHLIST_MODELS as readonly string[]).includes(value);
}
export function isWatchlistReasoningEffort(value: unknown): value is WatchlistReasoningEffort {
  return typeof value === "string" && (WATCHLIST_REASONING_EFFORTS as readonly string[]).includes(value);
}
export const WATCHLIST_MODEL_PRICING = {
  "gpt-5.6-luna": { inputPer1M: 0.2, cachedInputPer1M: 0.02, outputPer1M: 1.2 },
  "gpt-5.6-terra": { inputPer1M: 2, cachedInputPer1M: 0.2, outputPer1M: 12 },
  "gpt-6-luna": { inputPer1M: 0.1, cachedInputPer1M: 0.01, outputPer1M: 0.5 },
  "gpt-6-sol": { inputPer1M: 2, cachedInputPer1M: 0.2, outputPer1M: 10 },
} as const;
