import type { Candle } from "./candle-types.js";

export type SharedIndicatorCandles = Readonly<{ handled: boolean; provider: "moomoo" | "yahoo" | null; candles: readonly Candle[] }>;
export type WatchlistIndicatorCandleLoader = (input: Readonly<{ symbol: string; activatedAt: number; asOfTimeMs: number }>) => Promise<SharedIndicatorCandles>;

/** Existing publisher authorization only. Provider OAuth never leaves Platform. */
export function createPlatformWatchlistIndicatorLoader(environment: NodeJS.ProcessEnv = process.env): WatchlistIndicatorCandleLoader | null {
  const token = environment.TRADERSLINK_WATCHLIST_PUBLISHER_TOKEN?.trim();
  let endpoint: URL;
  try {
    endpoint = new URL(environment.TRADERSLINK_WATCHLIST_INGEST_URL?.trim() ?? "");
    if (!endpoint.pathname.endsWith("/ingest") || !["https:", "http:"].includes(endpoint.protocol)) return null;
    endpoint.pathname = `${endpoint.pathname.slice(0, -"/ingest".length)}/indicators/refresh`;
    endpoint.search = ""; endpoint.hash = "";
  } catch { return null; }
  if (!token) return null;
  return async ({ symbol, activatedAt, asOfTimeMs }) => {
    const unavailable = { handled: false, provider: null, candles: [] } as const;
    try {
      const response = await fetch(endpoint, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ symbol, activatedAt }) });
      if (!response.ok) return unavailable;
      const reader = response.body?.getReader();
      if (!reader) return unavailable;
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 128_000) { await reader.cancel(); return unavailable; }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!payload || payload.handled !== true) return unavailable;
      // Warming/inactive/provider failure is already handled: do not duplicate its Yahoo fallback.
      const empty = { handled: true, provider: null, candles: [] } as const;
      if (!payload.candles) return empty;
      const window = payload.candles;
      if (!["moomoo", "yahoo"].includes(window.provider) || !Array.isArray(window.candles) || window.candles.length > 250) return empty;
      const candles: Candle[] = [];
      for (const bar of window.candles) {
        if (!bar || ![bar.start, bar.end, bar.open, bar.high, bar.low, bar.close, bar.volume].every(value => typeof value === "number" && Number.isFinite(value))
          || !Number.isSafeInteger(bar.start) || bar.start <= 0 || bar.end !== bar.start + 300_000 || bar.end > asOfTimeMs
          || Math.min(bar.open, bar.high, bar.low, bar.close) <= 0 || bar.volume < 0
          || bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close)
          || (candles.length > 0 && bar.start <= candles.at(-1)!.timestamp)) return empty;
        candles.push({ timestamp: bar.start, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
      }
      if (candles.length && window.dataThrough !== candles.at(-1)!.timestamp + 300_000) return empty;
      return { handled: true, provider: window.provider as "moomoo" | "yahoo", candles };
    } catch { return unavailable; }
  };
}
