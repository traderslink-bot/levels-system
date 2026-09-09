import type { StockLevelsReferencePrice } from "./stock-levels-reference-price.js";

// A bounded, separate request: never restart or change Watchlist subscriptions.
// Only one fallback socket may be open at a time; concurrent requests fail closed.
let busy = false;
export async function requestEodhdCurrentTrade(
  symbol: string,
  usable: (quote: StockLevelsReferencePrice) => boolean,
): Promise<StockLevelsReferencePrice | null> {
  const token = process.env.EODHD_API_TOKEN?.trim() || process.env.LEVEL_EODHD_API_TOKEN?.trim();
  if (!token || busy || typeof WebSocket === "undefined") return null;
  busy = true;
  try {
    const url = new URL(process.env.EODHD_WEBSOCKET_URL?.trim() || process.env.LEVEL_EODHD_WEBSOCKET_URL?.trim() || "wss://ws.eodhistoricaldata.com/ws/us");
    if (url.protocol !== "wss:") return null;
    url.searchParams.set("api_token", token);
    return await new Promise<StockLevelsReferencePrice | null>((resolve) => {
      const socket = new WebSocket(url);
      let done = false;
      const finish = (quote: StockLevelsReferencePrice | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { socket.close(); } catch { /* Connection may not have opened. */ }
        resolve(quote);
      };
      const timer = setTimeout(() => finish(null), 8_000);
      socket.addEventListener("open", () => {
        if (done) { socket.close(); return; }
        socket.send(JSON.stringify({ action: "subscribe", symbols: symbol.replace(/\.US$/u, "") }));
      });
      socket.addEventListener("error", () => finish(null));
      socket.addEventListener("close", () => finish(null));
      socket.addEventListener("message", (event) => {
        if (done || typeof event.data !== "string") return;
        try {
          const body = JSON.parse(event.data);
          for (const trade of Array.isArray(body) ? body : [body]) {
            if (!trade || typeof trade !== "object") continue;
            if (Number(trade.status_code) >= 400) { finish(null); return; }
            if (trade.s !== symbol.replace(/\.US$/u, "") || trade.dp === true) continue;
            // Use the event timestamp, never receipt time or an untimestamped price.
            const quote: StockLevelsReferencePrice = { price: Number(trade.p), asOf: Number(trade.t), source: "eodhd" };
            if (usable(quote)) { finish(quote); return; }
          }
        } catch { /* Ignore non-trade/malformed messages until the bounded timeout. */ }
      });
    });
  } catch { return null; }
  finally { busy = false; }
}
