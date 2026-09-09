import { requestEodhdCurrentTrade } from "./stock-levels-live-price.js";

export type StockLevelsReferencePrice = { price: number; asOf: number; source: "eodhd" | "yahoo" };
const MAX_OPEN_AGE_MS = 60_000;
const MAX_CLOSED_AGE_MS = 96 * 60 * 60_000;
const eastern = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function session(at: number) {
  const parts = Object.fromEntries(eastern.formatToParts(at).map((part) => [part.type, part.value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = parts.weekday !== "Sat" && parts.weekday !== "Sun";
  const phase = !weekday || minute < 240 || minute >= 1200 ? "closed"
    : minute < 570 ? "pre" : minute < 960 ? "regular" : "post";
  return { date: parts.year + "-" + parts.month + "-" + parts.day, phase };
}
export function isUsableStockLevelsPrice(quote: StockLevelsReferencePrice, now = Date.now()): boolean {
  if (!Number.isFinite(quote.price) || quote.price <= 0 || !Number.isFinite(quote.asOf) || quote.asOf <= 0) return false;
  const age = now - quote.asOf;
  // Reject future event times; retrieval/snapshot times are never price evidence.
  if (age < 0) return false;
  const current = session(now);
  const event = session(quote.asOf);
  if (current.phase === "closed") return age <= MAX_CLOSED_AGE_MS;
  return age <= MAX_OPEN_AGE_MS && current.date === event.date && current.phase === event.phase;
}
function candidate(price: unknown, asOf: unknown, source: StockLevelsReferencePrice["source"]): StockLevelsReferencePrice | null {
  return typeof price === "number" && typeof asOf === "number" ? { price, asOf, source } : null;
}
function newest(quotes: Array<StockLevelsReferencePrice | null>, now: number) {
  return quotes.filter((quote): quote is StockLevelsReferencePrice => quote !== null && isUsableStockLevelsPrice(quote, now))
    .sort((a, b) => b.asOf - a.asOf)[0] ?? null;
}

export async function resolveStockLevelsReferencePrice(
  symbol: string,
  fetchFn: typeof fetch = fetch,
): Promise<StockLevelsReferencePrice | null> {
  const yahoo = await requestYahooReferencePrice(symbol, fetchFn);
  if (yahoo) return yahoo;
  // Delayed HTTP quotes are deliberately excluded from current-price lookup.
  return requestEodhdCurrentTrade(symbol, isUsableStockLevelsPrice);
}

async function requestYahooReferencePrice(
  symbol: string,
  fetchFn: typeof fetch,
): Promise<StockLevelsReferencePrice | null> {
  try {
    // Yahoo intraday observations are used ONLY to obtain the latest price/time.
    // They are never supplied to the daily/4h historical level calculation.
    const url = new URL("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol));
    url.searchParams.set("interval", "1m");
    url.searchParams.set("range", "1d");
    url.searchParams.set("includePrePost", "true");
    const response = await fetchFn(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const body = await response.json() as { chart?: { error?: unknown; result?: Array<{
      meta?: { symbol?: string; regularMarketPrice?: number; regularMarketTime?: number;
        preMarketPrice?: number; preMarketTime?: number; postMarketPrice?: number; postMarketTime?: number };
      timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> } };
    if (body.chart?.error) return null;
    const result = body.chart?.result?.[0];
    if (result?.meta?.symbol?.toUpperCase() !== symbol) return null;
    const meta = result.meta;
    const quotes: Array<StockLevelsReferencePrice | null> = [
      candidate(meta.regularMarketPrice, typeof meta.regularMarketTime === "number" ? meta.regularMarketTime * 1000 : null, "yahoo"),
      candidate(meta.preMarketPrice, typeof meta.preMarketTime === "number" ? meta.preMarketTime * 1000 : null, "yahoo"),
      candidate(meta.postMarketPrice, typeof meta.postMarketTime === "number" ? meta.postMarketTime * 1000 : null, "yahoo"),
    ];
    const times = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    for (let i = times.length - 1; i >= 0; i -= 1) {
      if (typeof closes[i] === "number" && Number.isFinite(closes[i]) && closes[i]! > 0) {
        quotes.push(candidate(closes[i], times[i] * 1000, "yahoo"));
        break;
      }
    }
    return newest(quotes, Date.now());
  } catch { return null; }
}
