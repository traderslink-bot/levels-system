import assert from "node:assert/strict";
import test from "node:test";

import { buildHistoricalFetchPlan } from "../lib/market-data/fetch-planning.js";
import type { HistoricalFetchRequest } from "../lib/market-data/provider-types.js";
import { YahooHistoricalCandleProvider } from "../lib/market-data/yahoo-historical-candle-provider.js";

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

function chartPayload(params: {
  timestamps: number[];
  open: Array<number | null>;
  high: Array<number | null>;
  low: Array<number | null>;
  close: Array<number | null>;
  volume: Array<number | null>;
}): unknown {
  return {
    chart: {
      result: [
        {
          timestamp: params.timestamps,
          indicators: {
            quote: [
              {
                open: params.open,
                high: params.high,
                low: params.low,
                close: params.close,
                volume: params.volume,
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

test("YahooHistoricalCandleProvider maps chart arrays into normalized OHLCV candles", async () => {
  const urls: string[] = [];
  const provider = new YahooHistoricalCandleProvider({
    fetchFn: createFetch(
      chartPayload({
        timestamps: [1_720_000_000, 1_720_000_060],
        open: [1, 1.1],
        high: [1.2, 1.3],
        low: [0.9, 1.05],
        close: [1.15, 1.25],
        volume: [1000, 2500],
      }),
      urls,
    ),
  });
  const request: HistoricalFetchRequest = {
    symbol: "jzxn",
    timeframe: "1m",
    lookbackBars: 2,
    endTimeMs: 1_720_000_120_000,
  };

  const response = await provider.fetchCandles(request, buildHistoricalFetchPlan(request, "yahoo"));

  assert.equal(response.provider, "yahoo");
  assert.equal(response.symbol, "JZXN");
  assert.deepEqual(response.candles, [
    {
      timestamp: 1_720_000_000_000,
      open: 1,
      high: 1.2,
      low: 0.9,
      close: 1.15,
      volume: 1000,
    },
    {
      timestamp: 1_720_000_060_000,
      open: 1.1,
      high: 1.3,
      low: 1.05,
      close: 1.25,
      volume: 2500,
    },
  ]);
  assert.match(urls[0]!, /\/v8\/finance\/chart\/JZXN\?/);
  assert.equal(new URL(urls[0]!).searchParams.get("interval"), "1m");
  assert.equal(new URL(urls[0]!).searchParams.get("includePrePost"), "true");
});

test("YahooHistoricalCandleProvider drops invalid chart rows before validation", async () => {
  const urls: string[] = [];
  const provider = new YahooHistoricalCandleProvider({
    fetchFn: createFetch(
      chartPayload({
        timestamps: [1_720_000_000, 1_720_000_060],
        open: [null, 1.1],
        high: [1.2, 1.3],
        low: [0.9, 1.05],
        close: [1.15, 1.25],
        volume: [1000, 2500],
      }),
      urls,
    ),
  });
  const request: HistoricalFetchRequest = {
    symbol: "JZXN",
    timeframe: "1m",
    lookbackBars: 2,
    endTimeMs: 1_720_000_120_000,
  };

  const response = await provider.fetchCandles(request, buildHistoricalFetchPlan(request, "yahoo"));

  assert.equal(response.candles.length, 1);
  assert.equal(response.providerMetadata?.yahooDroppedInvalidOhlcBars, 1);
});

test("YahooHistoricalCandleProvider aggregates hourly chart bars into 4h candles", async () => {
  const urls: string[] = [];
  const provider = new YahooHistoricalCandleProvider({
    fetchFn: createFetch(
      chartPayload({
        timestamps: [
          Date.parse("2026-07-10T13:30:00.000Z") / 1000,
          Date.parse("2026-07-10T14:30:00.000Z") / 1000,
          Date.parse("2026-07-10T15:30:00.000Z") / 1000,
          Date.parse("2026-07-10T16:30:00.000Z") / 1000,
          Date.parse("2026-07-10T17:30:00.000Z") / 1000,
        ],
        open: [1, 1.1, 1.2, 1.3, 1.4],
        high: [1.2, 1.4, 1.8, 1.5, 1.6],
        low: [0.9, 1.0, 1.1, 1.2, 1.3],
        close: [1.1, 1.2, 1.3, 1.4, 1.5],
        volume: [100, 200, 300, 400, 500],
      }),
      urls,
    ),
  });
  const request: HistoricalFetchRequest = {
    symbol: "JZXN",
    timeframe: "4h",
    lookbackBars: 2,
    endTimeMs: Date.parse("2026-07-10T18:00:00.000Z"),
  };

  const response = await provider.fetchCandles(request, buildHistoricalFetchPlan(request, "yahoo"));

  assert.equal(new URL(urls[0]!).searchParams.get("interval"), "60m");
  assert.deepEqual(response.candles, [
    {
      timestamp: Date.parse("2026-07-10T13:30:00.000Z"),
      open: 1,
      high: 1.8,
      low: 0.9,
      close: 1.4,
      volume: 1000,
    },
    {
      timestamp: Date.parse("2026-07-10T17:30:00.000Z"),
      open: 1.4,
      high: 1.6,
      low: 1.3,
      close: 1.5,
      volume: 500,
    },
  ]);
});
