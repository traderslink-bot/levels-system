import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createWatchlistAiHistoricalLoader } from "../lib/market-data/watchlist-ai-historical-loader.js";
import { AlpacaRuntimeHistoricalProvider } from "../lib/market-data/alpaca-runtime-providers.js";
import type { Candle } from "../lib/market-data/candle-types.js";
import { hasUsableTradersLinkAiPriceAction, mergeTradersLinkAiIntradayCandles } from "../lib/ai/traderslink-ai-read-price-action.js";

const now = Date.parse("2026-11-09T14:42:11Z");
function adapter(bars: Candle[], calls: URL[], fail = false) {
  return new AlpacaRuntimeHistoricalProvider({ url: "https://gateway.example/", token: "offline", now: () => now,
    fetcher: async input => {
      const url = new URL(String(input)); calls.push(url);
      if (fail) return new Response("{}", { status: 503 });
      return Response.json({ symbol: url.searchParams.get("symbol"), feed: "sip", adjustment: "split", complete: true,
        bars: bars.map(c => ({ time: c.timestamp / 1000, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })) });
    } });
}
function bars(count: number, start: number, step = 300000): Candle[] {
  return Array.from({ length: count }, (_, i) => ({ timestamp: start + i * step, open: 5, high: 6, low: 4, close: 5.5, volume: 1000 }));
}

test("Watchlist server installs selected-provider loader rather than bare legacy context builder", () => {
  const source = readFileSync(new URL("../runtime/manual-watchlist-server.ts", import.meta.url), "utf8");
  assert.match(source, /tradersLinkAiReadHistoricalCandleLoader:\s*createWatchlistAiHistoricalLoader\(\(\) => historicalProviderName\)/);
});

test("selected Alpaca handles previous session, daily, 4h and recent history without legacy requests", async () => {
  const calls: URL[] = [];
  const load = createWatchlistAiHistoricalLoader(() => "alpaca", () => adapter([], calls));
  for (const [start, end, timeframes] of [
    [Date.parse("2026-11-06T09:00:00Z"), Date.parse("2026-11-07T01:00:00Z"), ["5m"]],
    [now - 183 * 86400000, now, ["daily", "4h"]],
    [now - 3600000, now, ["1m", "5m"]],
  ] as const) {
    const context = await load({ symbol: "TEST", fromTimeMs: start, toTimeMs: end, timeframes: [...timeframes], nowMs: now });
    assert(context.series.every(s => s.provider === "alpaca" && s.selectionReason === "configured_provider"));
  }
  assert.deepEqual(calls.map(u => u.searchParams.get("timeframe")), ["5Min", "1Day", "4Hour", "1Min", "5Min"]);
  assert(calls.every(u => u.hostname === "gateway.example"));
});

test("empty or failed Alpaca history never silently falls back to legacy price basis", async () => {
  for (const fail of [false, true]) {
    const calls: URL[] = [];
    const load = createWatchlistAiHistoricalLoader(() => "alpaca", () => adapter([], calls, fail));
    const request = { symbol: "TEST", fromTimeMs: now - 86400000, toTimeMs: now, nowMs: now, timeframes: ["5m"] as ["5m"] };
    if (fail) await assert.rejects(load(request), /Alpaca/);
    else assert.equal((await load(request)).series[0].candles.length, 0);
    assert.equal(calls.length, 1);
  }
});

test("selection is read per call; non-Alpaca consumer retains existing injected legacy behavior", async () => {
  let selected = "alpaca";
  let creates = 0;
  const calls: URL[] = [];
  const load = createWatchlistAiHistoricalLoader(() => selected, () => { creates++; return adapter([], calls); });
  const historicalProvider = adapter([], []);
  const request = { symbol: "TEST", fromTimeMs: now - 86400000, toTimeMs: now, nowMs: now, timeframes: ["daily"] as ["daily"], historicalProvider };
  await load(request); selected = "eodhd";
  assert.equal((await load(request)).series[0].selectionReason, "historical_or_daily_window");
  assert.equal(creates, 1);
});

test("halt-resumption shortened tape uses adjusted prior session without inventing halt candles", async () => {
  const current = bars(8, Date.parse("2026-11-09T14:00:00Z"));
  const previous = bars(166, Date.parse("2026-11-06T09:00:00Z"));
  const calls: URL[] = [];
  const load = createWatchlistAiHistoricalLoader(() => "alpaca", () => adapter(previous, calls));
  const history = await load({ symbol: "TEST", fromTimeMs: Date.parse("2026-11-06T09:00:00Z"), toTimeMs: Date.parse("2026-11-07T01:00:00Z"), nowMs: now, timeframes: ["5m"] });
  const context = { source: "Alpaca", fetchedAt: now, priorRegularClose: 5, intradayCandles: current, dailyCandles: [] };
  assert.equal(hasUsableTradersLinkAiPriceAction(context, now), false);
  const merged = mergeTradersLinkAiIntradayCandles(current, history.series[0].candles, now);
  assert.equal(merged.length, 174);
  assert.equal(hasUsableTradersLinkAiPriceAction({ ...context, intradayCandles: merged }, now), true);
  assert(merged.every(c => previous.includes(c) || current.includes(c) || history.series[0].candles.includes(c)));
});
