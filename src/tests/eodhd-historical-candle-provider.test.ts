import assert from "node:assert/strict";
import test from "node:test";

import { EodhdHistoricalCandleProvider } from "../lib/market-data/eodhd-historical-candle-provider.js";
import { buildHistoricalFetchPlan } from "../lib/market-data/fetch-planning.js";

test("EodhdHistoricalCandleProvider maps adjusted daily candles", async () => {
  const requests: string[] = [];
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    fetchFn: (async (input: string | URL | Request) => {
      requests.push(String(input));
      return new Response(JSON.stringify([
        {
          date: "2026-07-14",
          open: 10,
          high: 12,
          low: 9,
          close: 11,
          adjusted_close: 5.5,
          volume: 1000,
        },
      ]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  const request = {
    symbol: "test",
    timeframe: "daily" as const,
    lookbackBars: 1,
    endTimeMs: Date.parse("2026-07-15T00:00:00.000Z"),
  };

  const result = await provider.fetchCandles(
    request,
    buildHistoricalFetchPlan(request, "eodhd"),
  );

  assert.equal(result.provider, "eodhd");
  assert.equal(result.symbol, "TEST");
  assert.equal(result.candles.length, 1);
  assert.equal(result.providerMetadata?.useRTH, true);
  assert.equal(result.providerMetadata?.sessionCoverage, "regular_only");
  assert.deepEqual(result.candles[0], {
    timestamp: Date.parse("2026-07-14T16:00:00.000Z"),
    open: 5,
    high: 6,
    low: 4.5,
    close: 5.5,
    volume: 1000,
  });
  assert.match(requests[0]!, /\/eod\/TEST\.US/);
});

test("EodhdHistoricalCandleProvider replaces a declared mixed split basis with Yahoo current-basis candles", async () => {
  const requests: string[] = [];
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    yahooBaseUrl: "https://query1.finance.yahoo.test",
    fetchFn: (async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);

      if (url.includes("/eod/NVVE.US")) {
        return new Response(JSON.stringify([
          {
            date: "2026-07-02",
            open: 0.0197,
            high: 0.0207,
            low: 0.0177,
            close: 0.0178,
            adjusted_close: 0.32,
            volume: 351700,
          },
          {
            date: "2026-07-06",
            open: 5.97,
            high: 6.39,
            low: 4.75,
            close: 4.89,
            adjusted_close: 4.89,
            volume: 589400,
          },
        ]), { status: 200 });
      }

      if (url.includes("/splits/NVVE.US")) {
        return new Response(JSON.stringify([
          { date: "2026-07-06", split: "1/18" },
        ]), { status: 200 });
      }

      if (url.startsWith("https://query1.finance.yahoo.test/")) {
        return new Response(JSON.stringify({
          chart: {
            result: [{
              timestamp: [
                Date.parse("2026-07-02T13:30:00.000Z") / 1000,
                Date.parse("2026-07-06T13:30:00.000Z") / 1000,
              ],
              indicators: {
                quote: [{
                  open: [6.39, 5.97],
                  high: [6.70, 6.39],
                  low: [5.75, 4.75],
                  close: [5.76, 4.89],
                  volume: [19539, 589400],
                }],
              },
            }],
            error: null,
          },
        }), { status: 200 });
      }

      return new Response("not found", { status: 404 });
    }) as typeof fetch,
  });
  const request = {
    symbol: "NVVE",
    timeframe: "daily" as const,
    lookbackBars: 2,
    endTimeMs: Date.parse("2026-07-08T00:00:00.000Z"),
  };

  const result = await provider.fetchCandles(
    request,
    buildHistoricalFetchPlan(request, "eodhd"),
  );

  assert.deepEqual(result.candles.map((candle) => candle.close), [5.76, 4.89]);
  assert.equal(result.providerMetadata?.priceBasisSource, "yahoo_current_basis_fallback");
  assert.equal(result.providerMetadata?.providerAdjustmentMode, "split_only_current_basis");
  assert.equal(result.providerMetadata?.splitBasisMismatchDetected, true);
  assert.equal(result.providerMetadata?.splitBasisMismatchDate, "2026-07-06");
  assert.equal(result.providerMetadata?.splitBasisExpectedMultiplier, 18);
  assert.ok(requests.some((url) => url.includes("/splits/NVVE.US")));
  assert.ok(requests.some((url) => url.startsWith("https://query1.finance.yahoo.test/")));
});

test("EodhdHistoricalCandleProvider fails closed when a mixed split basis cannot be replaced", async () => {
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    yahooBaseUrl: "https://query1.finance.yahoo.test",
    fetchFn: (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/eod/NVVE.US")) {
        return new Response(JSON.stringify([
          { date: "2026-07-02", open: 0.02, high: 0.021, low: 0.017, close: 0.018, adjusted_close: 0.32, volume: 100 },
          { date: "2026-07-06", open: 5.97, high: 6.39, low: 4.75, close: 4.89, adjusted_close: 4.89, volume: 100 },
        ]), { status: 200 });
      }
      if (url.includes("/splits/NVVE.US")) {
        return new Response(JSON.stringify([{ date: "2026-07-06", split: "1/18" }]), { status: 200 });
      }
      return new Response("upstream unavailable", { status: 503 });
    }) as typeof fetch,
  });
  const request = {
    symbol: "NVVE",
    timeframe: "daily" as const,
    lookbackBars: 2,
    endTimeMs: Date.parse("2026-07-08T00:00:00.000Z"),
  };

  await assert.rejects(
    provider.fetchCandles(request, buildHistoricalFetchPlan(request, "eodhd")),
    /mixed split basis.*current-basis fallback failed/i,
  );
});

test("EodhdHistoricalCandleProvider drops real-shape null intraday placeholders", async () => {
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    fetchFn: (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/intraday/NVVE.US")) {
        return new Response(JSON.stringify([
          { timestamp: 1783349100, open: 4.119999, high: 4.119999, low: 4.119999, close: 4.119999, volume: 1541 },
          { timestamp: 1783349400, open: null, high: null, low: null, close: null, volume: null },
          { timestamp: 1783349700, open: 4.28, high: 4.349999, low: 4.224199, close: 4.224199, volume: 2449 },
          { timestamp: 1783352700, open: 4.3926, high: 4.499899, low: 4.21, close: 4.21, volume: 2236 },
          { timestamp: 1783353000, open: null, high: null, low: null, close: null, volume: null },
          { timestamp: 1783353300, open: 4.499899, high: 4.499899, low: 4.499899, close: 4.499899, volume: 723 },
        ]), { status: 200 });
      }
      if (url.includes("/eod/NVVE.US")) {
        return new Response(JSON.stringify([
          { date: "2026-07-06", open: 5.97, high: 6.41, low: 3.791, close: 4.89, adjusted_close: 4.89, volume: 282200 },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch,
  });
  const request = {
    symbol: "NVVE",
    timeframe: "5m" as const,
    lookbackBars: 6,
    endTimeMs: Date.parse("2026-07-07T00:00:00.000Z"),
  };

  const result = await provider.fetchCandles(
    request,
    buildHistoricalFetchPlan(request, "eodhd"),
  );

  assert.equal(result.candles.length, 4);
  assert.equal(result.providerMetadata?.eodhdDroppedInvalidOhlcBars, 2);
  assert.equal(result.providerMetadata?.priceBasisDroppedInvalidOhlcBars, 2);
  assert.ok(result.candles.every((candle) => candle.open > 0 && candle.low > 0));
});

test("EodhdHistoricalCandleProvider drops incomplete and off-session four-hour source rows", async () => {
  const hourlyRows = [
    { datetime: "2026-07-10 13:30:00", open: 20, high: 20.2, low: 19.9, close: 20.1, volume: 1000 },
    { datetime: "2026-07-10 14:30:00", open: 20.1, high: 20.3, low: 20, close: 20.2, volume: 1100 },
    { datetime: "2026-07-10 15:30:00", open: 20.2, high: 20.4, low: 20.1, close: 20.3, volume: 1200 },
    { datetime: "2026-07-10 16:30:00", open: 20.3, high: 20.5, low: 20.2, close: 20.4, volume: 1300 },
    { datetime: "2026-07-10 17:30:00", open: 20.4, high: 20.6, low: 20.3, close: 20.5, volume: 1400 },
    { datetime: "2026-07-10 18:30:00", open: 20.5, high: 20.7, low: 20.4, close: 20.6, volume: 1500 },
    { datetime: "2026-07-10 19:30:00", open: 20.6, high: 20.8, low: 20.5, close: 20.7, volume: 1600 },
    { datetime: "2026-07-10 20:30:00", open: 20.7, high: 20.9, low: 20.6, close: 20.8, volume: 1700 },
    { datetime: "2026-07-10 21:30:00", open: 20.8, high: 21, low: 20.7, close: 20.9, volume: 1800 },
    { datetime: "2026-07-13 13:30:00", open: 21.5, high: 22, low: 21.3, close: 21.8, volume: 2000 },
    { datetime: "2026-07-13 14:30:00", open: 0, high: 22.5, low: 0, close: 22.468, volume: 9546 },
    { datetime: "2026-07-13 15:30:00", open: 21.8, high: 22.2, low: 21.6, close: 22.1, volume: 2200 },
    { datetime: "2026-07-13 16:30:00", open: 22.1, high: 22.4, low: 21.9, close: 22.3, volume: 2300 },
    { datetime: "2026-07-13 17:30:00", open: 22.3, high: 22.6, low: 22.1, close: 22.5, volume: 2400 },
    { datetime: "2026-07-13 18:30:00", open: 22.5, high: 22.7, low: 22.2, close: 22.4, volume: 2500 },
    { datetime: "2026-07-13 19:30:00", open: 22.4, high: 22.8, low: 22.3, close: 22.7, volume: 2600 },
    { datetime: "2026-07-13 20:30:00", open: 22.7, high: 22.9, low: 22.5, close: 22.8, volume: 2700 },
    { datetime: "2026-07-13 21:30:00", open: 22.8, high: 23, low: 22.6, close: 22.9, volume: 2800 },
  ];
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    fetchFn: (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/intraday/JLHL.US")) {
        return new Response(JSON.stringify(hourlyRows), { status: 200 });
      }
      if (url.includes("/eod/JLHL.US")) {
        return new Response(JSON.stringify([
          { date: "2026-07-13", open: 21.5, high: 23, low: 21.3, close: 22.9, adjusted_close: 22.9, volume: 12000 },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch,
  });
  const request = {
    symbol: "JLHL",
    timeframe: "4h" as const,
    lookbackBars: 3,
    endTimeMs: Date.parse("2026-07-14T00:00:00.000Z"),
  };

  const result = await provider.fetchCandles(
    request,
    buildHistoricalFetchPlan(request, "eodhd"),
  );

  assert.equal(result.candles.length, 3);
  assert.equal(result.providerMetadata?.eodhdDroppedInvalidOhlcBars, 1);
  assert.equal(result.providerMetadata?.eodhdIncompleteFourHourBuckets, 1);
  assert.equal(result.providerMetadata?.eodhdDroppedOffSessionFourHourBars, 4);
  assert.deepEqual(result.candles.map((candle) => candle.volume), [4600, 4500, 7500]);
  assert.deepEqual(result.candles.map((candle) => candle.timestamp), [
    Date.parse("2026-07-10T13:30:00.000Z"),
    Date.parse("2026-07-10T17:30:00.000Z"),
    Date.parse("2026-07-13T17:30:00.000Z"),
  ]);
  assert.ok(result.candles.every((candle) => candle.open > 0 && candle.low > 0));
});
