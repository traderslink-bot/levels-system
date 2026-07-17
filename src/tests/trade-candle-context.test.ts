import assert from "node:assert/strict";
import test from "node:test";

import type {
  BaseCandleProviderResponse,
  Candle,
  CandleFetchTimeframe,
  CandleProviderName,
} from "../lib/market-data/candle-types.js";
import { buildTradeCandleContext } from "../lib/market-data/trade-candle-context.js";
import type {
  HistoricalCandleProvider,
  HistoricalFetchPlan,
  HistoricalFetchRequest,
} from "../lib/market-data/provider-types.js";

class FixedProvider implements HistoricalCandleProvider {
  readonly providerName: CandleProviderName;
  readonly requests: HistoricalFetchRequest[] = [];

  constructor(
    providerName: CandleProviderName,
    private readonly candles:
      | Candle[]
      | Partial<Record<CandleFetchTimeframe, Candle[]>>,
  ) {
    this.providerName = providerName;
  }

  async fetchCandles(
    request: HistoricalFetchRequest,
    plan: HistoricalFetchPlan,
  ): Promise<BaseCandleProviderResponse> {
    this.requests.push(request);
    const candles = Array.isArray(this.candles)
      ? this.candles
      : this.candles[request.timeframe] ?? [];

    return {
      provider: this.providerName,
      symbol: request.symbol.toUpperCase(),
      timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars,
      candles,
      fetchStartTimestamp: 1,
      fetchEndTimestamp: 2,
      requestedStartTimestamp: plan.requestStartTimestamp,
      requestedEndTimestamp: plan.requestEndTimestamp,
      sessionMetadataAvailable: plan.sessionMetadataAvailable,
      providerMetadata: {
        testProvider: this.providerName,
      },
    };
  }
}

function candle(timestamp: number, price: number): Candle {
  return {
    timestamp,
    open: price,
    high: price + 0.1,
    low: price - 0.1,
    close: price + 0.05,
    volume: 1000,
  };
}

test("buildTradeCandleContext selects Yahoo for fresh intraday windows before EODHD cutoff", async () => {
  const nowMs = Date.parse("2026-07-10T16:00:00.000Z");
  const fromTimeMs = Date.parse("2026-07-10T15:00:00.000Z");
  const toTimeMs = Date.parse("2026-07-10T15:30:00.000Z");
  const recentProvider = new FixedProvider("yahoo", [
    candle(Date.parse("2026-07-10T14:55:00.000Z"), 1),
    candle(Date.parse("2026-07-10T15:00:00.000Z"), 1.1),
    candle(Date.parse("2026-07-10T15:05:00.000Z"), 1.2),
    candle(Date.parse("2026-07-10T15:35:00.000Z"), 1.3),
  ]);
  const historicalProvider = new FixedProvider("eodhd", []);

  const context = await buildTradeCandleContext({
    symbol: "jzxn",
    fromTimeMs,
    toTimeMs,
    timeframes: ["5m"],
    nowMs,
    recentProvider,
    historicalProvider,
  });

  assert.equal(context.symbol, "JZXN");
  assert.equal(context.series[0]?.provider, "yahoo");
  assert.equal(context.series[0]?.selectionReason, "fresh_intraday_window");
  assert.deepEqual(
    context.series[0]?.candles.map((item) => item.timestamp),
    [
      Date.parse("2026-07-10T15:00:00.000Z"),
      Date.parse("2026-07-10T15:05:00.000Z"),
    ],
  );
  assert.equal(recentProvider.requests.length, 1);
  assert.equal(historicalProvider.requests.length, 0);
});

test("buildTradeCandleContext selects EODHD for same-day intraday windows after EODHD cutoff", async () => {
  const nowMs = Date.parse("2026-07-11T01:00:00.000Z");
  const fromTimeMs = Date.parse("2026-07-10T15:00:00.000Z");
  const toTimeMs = Date.parse("2026-07-10T15:30:00.000Z");
  const recentProvider = new FixedProvider("yahoo", []);
  const historicalProvider = new FixedProvider("eodhd", [
    candle(Date.parse("2026-07-10T15:00:00.000Z"), 1.1),
    candle(Date.parse("2026-07-10T15:05:00.000Z"), 1.2),
  ]);

  const context = await buildTradeCandleContext({
    symbol: "JZXN",
    fromTimeMs,
    toTimeMs,
    timeframes: ["5m"],
    nowMs,
    recentProvider,
    historicalProvider,
  });

  assert.equal(context.series[0]?.provider, "eodhd");
  assert.equal(context.series[0]?.selectionReason, "historical_or_daily_window");
  assert.equal(recentProvider.requests.length, 0);
  assert.deepEqual(
    historicalProvider.requests.map((request) => request.timeframe),
    ["5m", "1m"],
  );
});

test("buildTradeCandleContext falls back to Yahoo when finalized EODHD has no usable candles", async () => {
  const nowMs = Date.parse("2026-07-11T01:00:00.000Z");
  const fromTimeMs = Date.parse("2026-07-10T15:00:00.000Z");
  const toTimeMs = Date.parse("2026-07-10T15:30:00.000Z");
  const recentProvider = new FixedProvider("yahoo", [
    candle(Date.parse("2026-07-10T15:00:00.000Z"), 1.1),
    candle(Date.parse("2026-07-10T15:05:00.000Z"), 1.2),
  ]);
  const historicalProvider = new FixedProvider("eodhd", []);

  const context = await buildTradeCandleContext({
    symbol: "JZXN",
    fromTimeMs,
    toTimeMs,
    timeframes: ["5m"],
    nowMs,
    recentProvider,
    historicalProvider,
  });

  assert.equal(context.series[0]?.provider, "yahoo");
  assert.equal(context.series[0]?.selectionReason, "eodhd_unavailable_yahoo_fallback");
  assert.deepEqual(
    historicalProvider.requests.map((request) => request.timeframe),
    ["5m", "1m"],
  );
  assert.equal(recentProvider.requests.length, 1);
});

test("buildTradeCandleContext aggregates EODHD 1m candles when historical 5m is unavailable", async () => {
  const nowMs = Date.parse("2026-07-11T01:00:00.000Z");
  const fromTimeMs = Date.parse("2026-04-20T11:00:00.000Z");
  const toTimeMs = Date.parse("2026-04-20T11:10:00.000Z");
  const recentProvider = new FixedProvider("yahoo", []);
  const historicalProvider = new FixedProvider("eodhd", {
    "5m": [],
    "1m": [
      candle(Date.parse("2026-04-20T11:00:00.000Z"), 1.0),
      candle(Date.parse("2026-04-20T11:01:00.000Z"), 1.1),
      candle(Date.parse("2026-04-20T11:02:00.000Z"), 1.2),
      candle(Date.parse("2026-04-20T11:03:00.000Z"), 1.3),
      candle(Date.parse("2026-04-20T11:04:00.000Z"), 1.4),
      candle(Date.parse("2026-04-20T11:05:00.000Z"), 1.5),
      candle(Date.parse("2026-04-20T11:06:00.000Z"), 1.6),
    ],
  });

  const context = await buildTradeCandleContext({
    symbol: "CMND",
    fromTimeMs,
    toTimeMs,
    timeframes: ["5m"],
    nowMs,
    recentProvider,
    historicalProvider,
  });

  assert.equal(context.series[0]?.provider, "eodhd");
  assert.equal(context.series[0]?.timeframe, "5m");
  assert.equal(context.series[0]?.selectionReason, "historical_or_daily_window");
  assert.deepEqual(
    context.series[0]?.candles.map((item) => item.timestamp),
    [
      Date.parse("2026-04-20T11:00:00.000Z"),
      Date.parse("2026-04-20T11:05:00.000Z"),
    ],
  );
  assert.equal(context.series[0]?.candles[0]?.open, 1.0);
  assert.equal(context.series[0]?.candles[0]?.close, 1.45);
  assert.equal(context.series[0]?.candles[1]?.open, 1.5);
  assert.equal(context.series[0]?.response.providerMetadata?.sourceTimeframe, "1m");
  assert.equal(context.series[0]?.response.providerMetadata?.derivedTimeframe, "5m");
  assert.deepEqual(
    historicalProvider.requests.map((request) => request.timeframe),
    ["5m", "1m"],
  );
  assert.equal(recentProvider.requests.length, 0);
});

test("buildTradeCandleContext selects EODHD for older intraday trade windows", async () => {
  const nowMs = Date.parse("2026-07-10T16:00:00.000Z");
  const fromTimeMs = Date.parse("2026-02-10T15:00:00.000Z");
  const toTimeMs = Date.parse("2026-02-10T15:30:00.000Z");
  const recentProvider = new FixedProvider("yahoo", []);
  const historicalProvider = new FixedProvider("eodhd", [
    candle(Date.parse("2026-02-10T15:00:00.000Z"), 2.7),
    candle(Date.parse("2026-02-10T15:05:00.000Z"), 2.8),
  ]);

  const context = await buildTradeCandleContext({
    symbol: "JZXN",
    fromTimeMs,
    toTimeMs,
    timeframes: ["5m"],
    nowMs,
    recentProvider,
    historicalProvider,
  });

  assert.equal(context.series[0]?.provider, "eodhd");
  assert.equal(context.series[0]?.selectionReason, "historical_or_daily_window");
  assert.equal(recentProvider.requests.length, 0);
  assert.deepEqual(
    historicalProvider.requests.map((request) => request.timeframe),
    ["5m", "1m"],
  );
  assert.equal(context.series[0]?.response.providerMetadata?.tradeCandleSelectionReason, "historical_or_daily_window");
});

test("buildTradeCandleContext always routes daily candles to EODHD", async () => {
  const nowMs = Date.parse("2026-07-10T16:00:00.000Z");
  const fromTimeMs = Date.parse("2026-07-09T00:00:00.000Z");
  const toTimeMs = Date.parse("2026-07-10T00:00:00.000Z");
  const recentProvider = new FixedProvider("yahoo", []);
  const historicalProvider = new FixedProvider("eodhd", [
    candle(Date.parse("2026-07-09T00:00:00.000Z"), 1.5),
    candle(Date.parse("2026-07-10T00:00:00.000Z"), 1.6),
  ]);

  const context = await buildTradeCandleContext({
    symbol: "JZXN",
    fromTimeMs,
    toTimeMs,
    timeframes: ["daily"],
    nowMs,
    recentProvider,
    historicalProvider,
  });

  assert.equal(context.series[0]?.provider, "eodhd");
  assert.equal(recentProvider.requests.length, 0);
  assert.equal(historicalProvider.requests.length, 1);
});
