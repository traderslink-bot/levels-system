import assert from "node:assert/strict";
import test from "node:test";

import { EodhdHistoricalCandleProvider } from "../lib/market-data/eodhd-historical-candle-provider.js";
import { buildHistoricalFetchPlan } from "../lib/market-data/fetch-planning.js";
import type { HistoricalFetchRequest } from "../lib/market-data/provider-types.js";

function createFetch(payload: unknown, urls: string[]): typeof fetch {
  return (async (url: string | URL | Request) => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
    };
  }) as typeof fetch;
}

function createFetchByEndpoint(
  payloads: {
    intraday?: unknown;
    eod?: unknown;
  },
  urls: string[],
): typeof fetch {
  return (async (url: string | URL | Request) => {
    const value = String(url);
    urls.push(value);
    const pathname = new URL(value).pathname;
    const payload = pathname.includes("/intraday/")
      ? payloads.intraday
      : pathname.includes("/eod/")
        ? payloads.eod
        : undefined;

    return {
      ok: true,
      status: 200,
      async json() {
        return payload ?? [];
      },
    };
  }) as typeof fetch;
}

function urlSearchParam(url: string, name: string): string | null {
  return new URL(url).searchParams.get(name);
}

test("EODHD 4h deep lookback planning reaches February JZXN structure from July", () => {
  const request: HistoricalFetchRequest = {
    symbol: "JZXN",
    timeframe: "4h",
    lookbackBars: 900,
    endTimeMs: Date.parse("2026-07-09T20:00:00.000Z"),
  };

  const plan = buildHistoricalFetchPlan(request, "eodhd");

  assert.ok(plan.requestStartTimestamp <= Date.parse("2026-02-10T00:00:00.000Z"));
  assert.equal(plan.provider, "eodhd");
  assert.equal(plan.requestedLookbackBars, 900);
});

test("EodhdHistoricalCandleProvider maps 5m intraday bars into normalized candles", async () => {
  const urls: string[] = [];
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    fetchFn: createFetch([
      {
        timestamp: 1_720_000_000,
        open: 1,
        high: 1.2,
        low: 0.9,
        close: 1.1,
        volume: 1234,
      },
    ], urls),
  });
  const request: HistoricalFetchRequest = {
    symbol: "aapl",
    timeframe: "5m",
    lookbackBars: 1,
    endTimeMs: 1_720_001_000_000,
  };

  const response = await provider.fetchCandles(request, buildHistoricalFetchPlan(request, "eodhd"));

  assert.equal(response.provider, "eodhd");
  assert.equal(response.symbol, "AAPL");
  assert.equal(response.candles.length, 1);
  assert.deepEqual(response.candles[0], {
    timestamp: 1_720_000_000_000,
    open: 1,
    high: 1.2,
    low: 0.9,
    close: 1.1,
    volume: 1234,
  });
  assert.match(urls[0]!, /\/intraday\/AAPL\.US\?/);
  assert.match(urls[0]!, /interval=5m/);
});

test("EodhdHistoricalCandleProvider treats EODHD datetime fallback as UTC", async () => {
  const urls: string[] = [];
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    fetchFn: createFetch([
      {
        datetime: "2026-05-01 13:30:00",
        open: 1,
        high: 1.2,
        low: 0.9,
        close: 1.1,
        volume: null,
      },
    ], urls),
  });
  const request: HistoricalFetchRequest = {
    symbol: "AAPL",
    timeframe: "5m",
    lookbackBars: 1,
    endTimeMs: Date.parse("2026-05-01T13:35:00.000Z"),
  };

  const response = await provider.fetchCandles(request, buildHistoricalFetchPlan(request, "eodhd"));

  assert.equal(response.candles[0]?.timestamp, Date.parse("2026-05-01T13:30:00.000Z"));
  assert.equal(response.candles[0]?.volume, 0);
});

test("EodhdHistoricalCandleProvider fetches daily candles through the EOD endpoint on an adjusted price basis", async () => {
  const urls: string[] = [];
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    fetchFn: createFetch([
      {
        date: "2026-05-01",
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        adjusted_close: 10.75,
        volume: 12345,
      },
    ], urls),
  });
  const request: HistoricalFetchRequest = {
    symbol: "AAPL.US",
    timeframe: "daily",
    lookbackBars: 1,
    endTimeMs: Date.parse("2026-05-02T00:00:00.000Z"),
  };

  const response = await provider.fetchCandles(request, buildHistoricalFetchPlan(request, "eodhd"));

  assert.equal(response.candles[0]?.timestamp, Date.parse("2026-05-01T00:00:00.000Z"));
  assert.equal(response.candles[0]?.open, 9.772727);
  assert.equal(response.candles[0]?.high, 11.727273);
  assert.equal(response.candles[0]?.low, 8.795455);
  assert.equal(response.candles[0]?.close, 10.75);
  assert.equal(response.providerMetadata?.eodhdInterval, "d");
  assert.equal(response.providerMetadata?.providerAdjustmentMode, "adjusted_close_ratio");
  assert.match(urls[0]!, /\/eod\/AAPL\.US\?/);
  assert.equal(urlSearchParam(urls[0]!, "period"), "d");
  assert.equal(urlSearchParam(urls[0]!, "fmt"), "json");
});

test("EodhdHistoricalCandleProvider adjusts pre-split daily resistance into the current price basis", async () => {
  const urls: string[] = [];
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    fetchFn: createFetch([
      {
        date: "2026-05-18",
        open: 0.303,
        high: 0.534,
        low: 0.225,
        close: 0.235,
        adjusted_close: 5.875,
        volume: 30606768,
      },
    ], urls),
  });
  const request: HistoricalFetchRequest = {
    symbol: "VRAX",
    timeframe: "daily",
    lookbackBars: 1,
    endTimeMs: Date.parse("2026-05-19T00:00:00.000Z"),
  };

  const response = await provider.fetchCandles(request, buildHistoricalFetchPlan(request, "eodhd"));

  assert.deepEqual(response.candles[0], {
    timestamp: Date.parse("2026-05-18T00:00:00.000Z"),
    open: 7.575,
    high: 13.35,
    low: 5.625,
    close: 5.875,
    volume: 30606768,
  });
});

test("EodhdHistoricalCandleProvider records material reverse-split transitions in provider metadata", async () => {
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    fetchFn: createFetch([
      {
        date: "2026-07-16",
        open: 0.2,
        high: 0.23,
        low: 0.19,
        close: 0.21,
        adjusted_close: 4.2,
        volume: 1000,
      },
      {
        date: "2026-07-17",
        open: 4.1,
        high: 4.2,
        low: 2.1,
        close: 2.2,
        adjusted_close: 2.2,
        volume: 2000,
      },
    ], []),
  });
  const request: HistoricalFetchRequest = {
    symbol: "VIVK",
    timeframe: "daily",
    lookbackBars: 2,
    endTimeMs: Date.parse("2026-07-18T00:00:00.000Z"),
  };

  const response = await provider.fetchCandles(request, buildHistoricalFetchPlan(request, "eodhd"));

  assert.equal(response.providerMetadata?.splitAdjustmentApplied, true);
  assert.equal(response.providerMetadata?.detectedReverseSplitCount, 1);
  assert.deepEqual(JSON.parse(String(response.providerMetadata?.detectedSplitEvents)), [{
    date: "2026-07-17",
    eventType: "reverse_split",
    priorAdjustmentFactor: 20,
    adjustmentFactor: 1,
    priceAdjustmentFactor: 0.05,
    source: "adjusted_close_ratio",
  }]);
});

test("EodhdHistoricalCandleProvider aggregates 1h EODHD bars into session-anchored 4h candles", async () => {
  const urls: string[] = [];
  const firstTimestamp = Date.parse("2026-05-01T09:30:00-04:00");
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    fetchFn: createFetch([
      { timestamp: Math.floor(firstTimestamp / 1000), open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      { timestamp: Math.floor((firstTimestamp + 60 * 60_000) / 1000), open: 10.5, high: 12, low: 10, close: 11.5, volume: 200 },
      { timestamp: Math.floor((firstTimestamp + 2 * 60 * 60_000) / 1000), open: 11.5, high: 12.5, low: 11, close: 12, volume: 300 },
      { timestamp: Math.floor((firstTimestamp + 3 * 60 * 60_000) / 1000), open: 12, high: 13, low: 11.8, close: 12.8, volume: 400 },
    ], urls),
  });
  const request: HistoricalFetchRequest = {
    symbol: "AAPL",
    timeframe: "4h",
    lookbackBars: 1,
    endTimeMs: Date.parse("2026-05-01T14:00:00-04:00"),
  };
  const plan = buildHistoricalFetchPlan(request, "eodhd");

  const response = await provider.fetchCandles(request, plan);

  assert.equal(response.candles.length, 1);
  assert.equal(response.candles[0]?.timestamp, firstTimestamp);
  assert.equal(response.candles[0]?.open, 10);
  assert.equal(response.candles[0]?.high, 13);
  assert.equal(response.candles[0]?.low, 9);
  assert.equal(response.candles[0]?.close, 12.8);
  assert.equal(response.candles[0]?.volume, 1000);
  assert.match(urls[0]!, /interval=1h/);
  assert.equal(
    urlSearchParam(urls[0]!, "from"),
    String(Math.floor((plan.requestStartTimestamp - 3 * 60 * 60_000) / 1000)),
  );
});

test("EodhdHistoricalCandleProvider drops invalid intraday OHLC bars before 4h aggregation", async () => {
  const urls: string[] = [];
  const firstTimestamp = Date.parse("2026-05-01T09:30:00-04:00");
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    fetchFn: createFetchByEndpoint({
      intraday: [
        { timestamp: Math.floor(firstTimestamp / 1000), open: 0, high: 22.5, low: 0, close: 22.468, volume: 9546 },
        { timestamp: Math.floor((firstTimestamp + 60 * 60_000) / 1000), open: 10.5, high: 12, low: 10, close: 11.5, volume: 200 },
        { timestamp: Math.floor((firstTimestamp + 2 * 60 * 60_000) / 1000), open: 11.5, high: 12.5, low: 11, close: 12, volume: 300 },
        { timestamp: Math.floor((firstTimestamp + 3 * 60 * 60_000) / 1000), open: 12, high: 13, low: 11.8, close: 12.8, volume: 400 },
      ],
      eod: [],
    }, urls),
  });
  const request: HistoricalFetchRequest = {
    symbol: "JLHL",
    timeframe: "4h",
    lookbackBars: 1,
    endTimeMs: Date.parse("2026-05-01T14:00:00-04:00"),
  };

  const response = await provider.fetchCandles(request, buildHistoricalFetchPlan(request, "eodhd"));

  assert.equal(response.candles.length, 1);
  assert.deepEqual(response.candles[0], {
    timestamp: firstTimestamp + 60 * 60_000,
    open: 10.5,
    high: 13,
    low: 10,
    close: 12.8,
    volume: 900,
  });
  assert.equal(response.providerMetadata?.eodhdDroppedInvalidOhlcBars, 1);
});

test("EodhdHistoricalCandleProvider adjusts intraday bars before 4h aggregation", async () => {
  const urls: string[] = [];
  const firstTimestamp = Date.parse("2026-05-18T09:30:00-04:00");
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    fetchFn: createFetchByEndpoint({
      intraday: [
        { timestamp: Math.floor(firstTimestamp / 1000), open: 0.303, high: 0.4, low: 0.225, close: 0.32, volume: 100 },
        { timestamp: Math.floor((firstTimestamp + 60 * 60_000) / 1000), open: 0.32, high: 0.534, low: 0.3, close: 0.45, volume: 200 },
        { timestamp: Math.floor((firstTimestamp + 2 * 60 * 60_000) / 1000), open: 0.45, high: 0.5, low: 0.4, close: 0.42, volume: 300 },
        { timestamp: Math.floor((firstTimestamp + 3 * 60 * 60_000) / 1000), open: 0.42, high: 0.48, low: 0.35, close: 0.4, volume: 400 },
      ],
      eod: [
        {
          date: "2026-05-18",
          open: 0.303,
          high: 0.534,
          low: 0.225,
          close: 0.235,
          adjusted_close: 5.875,
          volume: 30606768,
        },
      ],
    }, urls),
  });
  const request: HistoricalFetchRequest = {
    symbol: "VRAX",
    timeframe: "4h",
    lookbackBars: 1,
    endTimeMs: Date.parse("2026-05-18T14:00:00-04:00"),
  };

  const response = await provider.fetchCandles(request, buildHistoricalFetchPlan(request, "eodhd"));

  assert.equal(response.candles.length, 1);
  assert.deepEqual(response.candles[0], {
    timestamp: firstTimestamp,
    open: 7.575,
    high: 13.35,
    low: 5.625,
    close: 10,
    volume: 1000,
  });
  assert.equal(response.providerMetadata?.providerAdjustmentMode, "adjusted_close_ratio");
  assert.match(urls[0]!, /\/intraday\/VRAX\.US\?/);
  assert.match(urls[1]!, /\/eod\/VRAX\.US\?/);
});

test("EodhdHistoricalCandleProvider does not aggregate 4h buckets across session dates", async () => {
  const urls: string[] = [];
  const dayOne = Date.parse("2026-05-01T14:00:00-04:00");
  const dayTwo = Date.parse("2026-05-04T09:30:00-04:00");
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    fetchFn: createFetch([
      { timestamp: Math.floor(dayOne / 1000), open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      { timestamp: Math.floor((dayOne + 60 * 60_000) / 1000), open: 10.5, high: 12, low: 10, close: 11.5, volume: 200 },
      { timestamp: Math.floor((dayOne + 2 * 60 * 60_000) / 1000), open: 11.5, high: 12.5, low: 11, close: 12, volume: 300 },
      { timestamp: Math.floor(dayTwo / 1000), open: 13, high: 14, low: 12.5, close: 13.5, volume: 400 },
    ], urls),
  });
  const request: HistoricalFetchRequest = {
    symbol: "AAPL",
    timeframe: "4h",
    lookbackBars: 2,
    endTimeMs: Date.parse("2026-05-04T10:30:00-04:00"),
  };

  const response = await provider.fetchCandles(request, buildHistoricalFetchPlan(request, "eodhd"));

  assert.deepEqual(response.candles.map((candle) => candle.timestamp), [dayOne, dayTwo]);
  assert.equal(response.candles[0]?.volume, 600);
  assert.equal(response.candles[1]?.open, 13);
});

test("EodhdHistoricalCandleProvider surfaces EODHD error payload messages", async () => {
  const urls: string[] = [];
  const provider = new EodhdHistoricalCandleProvider({
    apiToken: "test-token",
    fetchFn: createFetch({ error: "Invalid API token." }, urls),
  });
  const request: HistoricalFetchRequest = {
    symbol: "AAPL",
    timeframe: "5m",
    lookbackBars: 1,
    endTimeMs: Date.parse("2026-05-01T13:35:00.000Z"),
  };

  await assert.rejects(
    provider.fetchCandles(request, buildHistoricalFetchPlan(request, "eodhd")),
    /EODHD returned an error payload: Invalid API token\./,
  );
});
