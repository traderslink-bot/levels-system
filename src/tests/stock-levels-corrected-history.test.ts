import assert from "node:assert/strict";
import test from "node:test";
import { LevelEngine, type LevelEngineOutputWithCandleSeries } from "../lib/levels/level-engine.js";
import { AlpacaRuntimeHistoricalProvider } from "../lib/market-data/alpaca-runtime-providers.js";
import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { encodeGatewayWire } from "../lib/market-data/traderslink-gateway-wire.js";
import type { CandleTimeframe } from "../lib/market-data/candle-types.js";
import { createStockLevelsGenerator } from "../runtime/stock-levels-generator.js";
import { generateWithCurrentAlpacaHistory } from "../runtime/corrected-levels-history.js";

const now = Date.parse("2026-11-20T20:30:00Z");
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };

// Synthetic shared-Gateway responses test consumer behavior only. Persistence,
// raw-trade cancellation and qualified aggregation are Gateway/Charts contracts.
function bars(frame: "daily" | "4h", corrected: boolean): Bar[] {
  const spacing = frame === "daily" ? 86_400 : 14_400;
  return Array.from({ length: 80 }, (_, index) => {
    const center = 2.15 + Math.sin(index * Math.PI / 5) * 0.12;
    return {
      time: now / 1000 - (80 - index) * spacing,
      open: +center.toFixed(4), close: +(center + .015).toFixed(4),
      low: +(center - .06).toFixed(4),
      high: index === 78 ? corrected ? 2.38 : 4.2 : +(center + .06).toFixed(4),
      volume: index === 78 && !corrected ? 9_000_000 : 120_000,
    };
  });
}

for (const neutral of [false, true]) {
  for (const symbol of ["QAONE", "QATWO"]) {
    test(`${neutral ? "neutral" : "legacy"} ${symbol}: Levels consumes corrected Daily/4H on subsequent requests and Runtime recreation`, async t => {
      const previous = { ...process.env };
      t.after(() => { process.env = previous; });
      t.mock.method(Date, "now", () => now);
      process.env.TRADERLINK_MARKET_DATA_PROVIDER = "alpaca";
      process.env.TRADERLINK_ALPACA_GATEWAY_URL = "https://gateway.invalid/";
      process.env.TRADERLINK_ALPACA_GATEWAY_TOKEN = "synthetic-only";
      if (neutral) process.env.TRADERLINK_GATEWAY_CONTRACT = "traderslink.market.1";
      else delete process.env.TRADERLINK_GATEWAY_CONTRACT;
      let corrected = false;
      let unavailable = false;
      const historyCalls: Array<{ frame: string; accepted: string | null }> = [];
      const fetcher: typeof fetch = async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(neutral ? "market-state" : "quotes")) {
          const value = { feed: "sip", snapshots: { [symbol]: { latestTrade: { p: 2.2, t: new Date(now - 1_000).toISOString() } } } };
          return Response.json(neutral ? encodeGatewayWire("quotes", value) : value);
        }
        if (url.pathname.endsWith("trade-revisions")) {
          const value = { feed: "sip", generation: corrected ? 2 : 1, symbols: corrected ? {
            [symbol]: { minutes: [now / 1000 - 2 * 86_400], pending: false, revision: "a".repeat(64) },
          } : {} };
          return Response.json(neutral ? encodeGatewayWire("trade-revisions", value) : value);
        }
        assert.ok(url.pathname.endsWith(neutral ? "candle-window" : "history"));
        const frame = url.searchParams.get(neutral ? "resolution" : "timeframe")!;
        assert.ok(frame === "1Day" || frame === "4Hour", "corrections must not introduce extra calculation timeframes");
        historyCalls.push({ frame, accepted: url.searchParams.get(neutral ? "includeAcceptance" : "acceptedEvidence") });
        const value = { symbol, feed: "sip", adjustment: "split", complete: true, nextPageToken: null,
          bars: unavailable ? [] : bars(frame === "1Day" ? "daily" : "4h", corrected),
          ...(corrected && !unavailable ? { acceptedInput: {
            id: "11111111-1111-4111-8111-111111111111", digest: "b".repeat(64), instrumentId: symbol,
            symbol, venue: "XNAS", frame: frame === "1Day" ? "daily" : "4h", datasetId: "synthetic-qualified",
            priceBasisId: "synthetic-split", calendarRevision: "synthetic-calendar", sessionMode: "extended",
            completedThroughMs: now - 86_400_000, acceptedCutoffMs: now - 1, availableAtMs: now - 1, acceptedAtMs: now,
          } } : {}) };
        return Response.json(neutral ? encodeGatewayWire("history", value) : value);
      };
      t.mock.method(globalThis, "fetch", fetcher);
      const results: LevelEngineOutputWithCandleSeries[] = [];
      const create = () => {
        const service = new CandleFetchService(new AlpacaRuntimeHistoricalProvider({ fetcher, now: () => now }));
        const engine = new LevelEngine(service, undefined, { runtimeMode: "old", compareActivePath: "old" });
        return createStockLevelsGenerator({
          generateExistingWatchlistLevels: request => generateWithCurrentAlpacaHistory({ symbol, history: service,
            generate: async history => {
            const historicalRequests = Object.fromEntries((["1m", "daily", "4h", "5m"] as const).map(timeframe => [timeframe, {
              symbol, timeframe, lookbackBars: 80, endTimeMs: now, acceptedEvidence: request.acceptedEvidence,
            }])) as Record<CandleTimeframe, { symbol: string; timeframe: CandleTimeframe; lookbackBars: number; endTimeMs: number; acceptedEvidence?: boolean }>;
            const result = await engine.generateLevelsWithCandleSeries({ symbol, historicalRequests,
              referencePriceOverride: request.referencePriceOverride, includeFiveMinute: false,
              historicalFetchService: history });
            results.push(result);
            return result;
            },
          }),
        });
      };
      const generator = create();
      const first = await generator.generate(symbol);
      assert.ok(first.map);
      assert.equal(results[0]!.output.specialLevels.previousDayHigh, 4.2);
      const immutableFirst = JSON.stringify(first.map);

      corrected = true;
      const next = await generator.generate(symbol);
      assert.ok(next.map);
      for (const frame of ["daily", "4h"] as const) {
        assert.equal(results[1]!.seriesMap[frame].candles.at(-2)?.high, 2.38);
        assert.equal(results[1]!.seriesMap[frame].candles.at(-2)?.volume, 120_000);
      }
      assert.equal(results[1]!.output.specialLevels.previousDayHigh, 2.38, "derived Levels reference must abandon the superseded high");
      assert.equal(JSON.stringify(first.map), immutableFirst, "preserve the original snapshot rather than rewriting its historical facts");
      assert.equal(next.map.cacheStatus, "fresh");
      assert.equal(next.map.referencePrice, 2.2);
      assert.equal(historyCalls.length, 4, "a new calculation must read both corrected frames again");

      const recreated = await create().generate(symbol);
      assert.ok(recreated.map);
      assert.equal(results[2]!.output.specialLevels.previousDayHigh, 2.38);
      assert.equal(historyCalls.length, 6);

      unavailable = true;
      const missing = await generator.generate(symbol);
      assert.equal(missing.map, undefined, "empty corrected history must not resurrect a previously completed map");
      assert.equal(missing.code, "market_data_unavailable");
      assert.equal(historyCalls.length, 8);
      assert.ok(historyCalls.every(call => call.accepted === "1"));
    });
  }
}
