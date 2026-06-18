import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { EventName } from "@stoqey/ib";

import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import { buildHistoricalFetchPlan } from "../lib/market-data/fetch-planning.js";
import { sharedIbkrPacingQueue } from "../lib/market-data/ibkr-pacing-queue.js";

class FakeHistoricalIbApi extends EventEmitter {
  public historicalRequests: Array<{
    reqId: number;
    contract: Record<string, unknown>;
    durationStr: string;
    barSizeSetting: string;
  }> = [];

  public cancelledRequestIds: number[] = [];

  reqHistoricalData(
    reqId: number,
    contract: Record<string, unknown>,
    _endDateTime: string,
    durationStr: string,
    barSizeSetting: string,
  ): void {
    this.historicalRequests.push({
      reqId,
      contract,
      durationStr,
      barSizeSetting,
    });
  }

  cancelHistoricalData(reqId: number): void {
    this.cancelledRequestIds.push(reqId);
  }
}

async function waitForHistoricalRequest(ib: FakeHistoricalIbApi): Promise<number> {
  const start = Date.now();

  while (ib.historicalRequests.length === 0) {
    if (Date.now() - start > 500) {
      throw new Error("Timed out waiting for fake historical request.");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  return ib.historicalRequests[0]!.reqId;
}

test("IbkrHistoricalCandleProvider maps historical bars into candles and honors timeframe settings", async () => {
  sharedIbkrPacingQueue.resetForTests();
  const ib = new FakeHistoricalIbApi();
  const provider = new IbkrHistoricalCandleProvider(ib as any, 100);
  const plan = buildHistoricalFetchPlan(
    {
      symbol: "aapl",
      timeframe: "5m",
      lookbackBars: 2,
    },
    "ibkr",
  );

  const fetchPromise = provider.fetchCandles(
    {
      symbol: "aapl",
      timeframe: "5m",
      lookbackBars: 2,
    },
    plan,
  );

  const reqId = await waitForHistoricalRequest(ib);

  assert.equal(ib.historicalRequests.length, 1);
  assert.equal(ib.historicalRequests[0]?.durationStr, plan.providerRequest.durationStr);
  assert.equal(ib.historicalRequests[0]?.barSizeSetting, "5 mins");
  assert.equal(ib.historicalRequests[0]?.contract.symbol, "AAPL");
  ib.emit(EventName.historicalData, reqId, 1_776_265_200, 100, 101, 99.5, 100.5, 1_000);
  ib.emit(EventName.historicalData, reqId, "20260415 09:35:00", 100.5, 101.5, 100.2, 101.2, 1_500);
  ib.emit("historicalDataEnd", reqId, "start", "end");

  const response = await fetchPromise;

  assert.equal(response.symbol, "AAPL");
  assert.equal(response.provider, "ibkr");
  assert.equal(response.candles.length, 2);
  assert.equal(response.requestedLookbackBars, 2);
  assert.equal(response.providerMetadata?.barSizeSetting, "5 mins");
  assert.deepEqual(
    response.candles.map((candle) => candle.timestamp),
    [
      new Date(2026, 3, 15, 9, 35, 0).getTime(),
      1_776_265_200_000,
    ].sort((left, right) => left - right),
  );
  assert.equal(response.candles.at(-1)?.close, 100.5);
});

test("IbkrHistoricalCandleProvider can request 1m historical bars", async () => {
  sharedIbkrPacingQueue.resetForTests();
  const ib = new FakeHistoricalIbApi();
  const provider = new IbkrHistoricalCandleProvider(ib as any, 100);
  const plan = buildHistoricalFetchPlan(
    {
      symbol: "aapl",
      timeframe: "1m",
      lookbackBars: 2,
    },
    "ibkr",
  );

  const fetchPromise = provider.fetchCandles(
    {
      symbol: "aapl",
      timeframe: "1m",
      lookbackBars: 2,
    },
    plan,
  );

  const reqId = await waitForHistoricalRequest(ib);

  assert.equal(ib.historicalRequests[0]?.barSizeSetting, "1 min");
  ib.emit(EventName.historicalData, reqId, "20260415 09:31:00", 10, 10.2, 9.9, 10.1, 1_000);
  ib.emit(EventName.historicalData, reqId, "20260415 09:32:00", 10.1, 10.3, 10, 10.2, 1_500);
  ib.emit("historicalDataEnd", reqId, "start", "end");

  const response = await fetchPromise;

  assert.equal(response.timeframe, "1m");
  assert.equal(response.candles.length, 2);
  assert.equal(response.providerMetadata?.barSizeSetting, "1 min");
});

test("IbkrHistoricalCandleProvider resolves known post-delisting symbol aliases", async () => {
  sharedIbkrPacingQueue.resetForTests();
  const ib = new FakeHistoricalIbApi();
  const provider = new IbkrHistoricalCandleProvider(ib as any, 100);
  const plan = buildHistoricalFetchPlan(
    {
      symbol: "MAXN",
      timeframe: "5m",
      lookbackBars: 1,
    },
    "ibkr",
  );

  const fetchPromise = provider.fetchCandles(
    {
      symbol: "MAXN",
      timeframe: "5m",
      lookbackBars: 1,
    },
    plan,
  );

  const reqId = await waitForHistoricalRequest(ib);

  assert.deepEqual(ib.historicalRequests[0]?.contract, {
    conId: 733975592,
    symbol: "MAXNQ",
    secType: "STK",
    exchange: "SMART",
    currency: "USD",
  });
  ib.emit(EventName.historicalData, reqId, "20260410 11:30:00", 1.3, 1.37, 1.3, 1.36, 32_000);
  ib.emit("historicalDataEnd", reqId, "start", "end");

  const response = await fetchPromise;

  assert.equal(response.symbol, "MAXN");
  assert.equal(response.providerMetadata?.ibkrRequestedSymbol, "MAXN");
  assert.equal(response.providerMetadata?.ibkrResolvedSymbol, "MAXNQ");
  assert.equal(response.providerMetadata?.ibkrResolvedConId, 733975592);
  assert.equal(response.providerMetadata?.ibkrResolvedPrimaryExchange, "PINK");
  assert.equal(response.providerMetadata?.ibkrContractAliasUsed, true);
  assert.equal(response.providerMetadata?.ibkrHistoricalAliasReason, "post_delisting_symbol_change");
});

test("IbkrHistoricalCandleProvider resolves NYSE class-share aliases", async () => {
  sharedIbkrPacingQueue.resetForTests();
  const ib = new FakeHistoricalIbApi();
  const provider = new IbkrHistoricalCandleProvider(ib as any, 100);
  const plan = buildHistoricalFetchPlan(
    {
      symbol: "BRK/B",
      timeframe: "daily",
      lookbackBars: 1,
    },
    "ibkr",
  );

  const fetchPromise = provider.fetchCandles(
    {
      symbol: "BRK/B",
      timeframe: "daily",
      lookbackBars: 1,
    },
    plan,
  );

  const reqId = await waitForHistoricalRequest(ib);

  assert.deepEqual(ib.historicalRequests[0]?.contract, {
    conId: 72063691,
    symbol: "BRK B",
    secType: "STK",
    exchange: "SMART",
    currency: "USD",
  });
  ib.emit(EventName.historicalData, reqId, "20260410", 500, 505, 499, 503, 100_000);
  ib.emit("historicalDataEnd", reqId, "start", "end");

  const response = await fetchPromise;

  assert.equal(response.symbol, "BRK/B");
  assert.equal(response.providerMetadata?.ibkrRequestedSymbol, "BRK/B");
  assert.equal(response.providerMetadata?.ibkrResolvedSymbol, "BRK B");
  assert.equal(response.providerMetadata?.ibkrResolvedConId, 72063691);
  assert.equal(response.providerMetadata?.ibkrResolvedPrimaryExchange, "NYSE");
  assert.equal(response.providerMetadata?.ibkrContractAliasUsed, true);
  assert.equal(response.providerMetadata?.ibkrHistoricalAliasReason, "ibkr_class_share_symbol_format");
});

test("IbkrHistoricalCandleProvider returns an empty candle set when IBKR sends no bars", async () => {
  sharedIbkrPacingQueue.resetForTests();
  const ib = new FakeHistoricalIbApi();
  const provider = new IbkrHistoricalCandleProvider(ib as any, 100);
  const plan = buildHistoricalFetchPlan(
    {
      symbol: "AAPL",
      timeframe: "daily",
      lookbackBars: 1,
    },
    "ibkr",
  );

  const fetchPromise = provider.fetchCandles(
    {
      symbol: "AAPL",
      timeframe: "daily",
      lookbackBars: 1,
    },
    plan,
  );

  const reqId = await waitForHistoricalRequest(ib);
  ib.emit("historicalDataEnd", reqId, "start", "end");

  const response = await fetchPromise;
  assert.equal(response.candles.length, 0);
  assert.equal(response.provider, "ibkr");
});

test("IbkrHistoricalCandleProvider parses IBKR daily dates before numeric epoch fallback", async () => {
  sharedIbkrPacingQueue.resetForTests();
  const ib = new FakeHistoricalIbApi();
  const provider = new IbkrHistoricalCandleProvider(ib as any, 100);
  const plan = buildHistoricalFetchPlan(
    {
      symbol: "AKAN",
      timeframe: "daily",
      lookbackBars: 2,
    },
    "ibkr",
  );

  const fetchPromise = provider.fetchCandles(
    {
      symbol: "AKAN",
      timeframe: "daily",
      lookbackBars: 2,
    },
    plan,
  );

  const reqId = await waitForHistoricalRequest(ib);
  ib.emit(EventName.historicalData, reqId, "20260429", 40, 45, 38, 42, 10_000);
  ib.emit(EventName.historicalData, reqId, 20260430, 42, 64, 40, 58, 50_000);
  ib.emit("historicalDataEnd", reqId, "start", "end");

  const response = await fetchPromise;

  assert.deepEqual(
    response.candles.map((candle) => candle.timestamp),
    [
      new Date(2026, 3, 29).getTime(),
      new Date(2026, 3, 30).getTime(),
    ],
  );
});

test("IbkrHistoricalCandleProvider normalizes daily date-like timestamps with trailing zeroes", async () => {
  sharedIbkrPacingQueue.resetForTests();
  const ib = new FakeHistoricalIbApi();
  const provider = new IbkrHistoricalCandleProvider(ib as any, 100);
  const plan = buildHistoricalFetchPlan(
    {
      symbol: "SEGG",
      timeframe: "daily",
      lookbackBars: 1,
    },
    "ibkr",
  );

  const fetchPromise = provider.fetchCandles(
    {
      symbol: "SEGG",
      timeframe: "daily",
      lookbackBars: 1,
    },
    plan,
  );

  const reqId = await waitForHistoricalRequest(ib);
  ib.emit(EventName.historicalData, reqId, 20240430000, 16.85, 18.3, 16.85, 17.5, 151);
  ib.emit("historicalDataEnd", reqId, "start", "end");

  const response = await fetchPromise;

  assert.equal(response.candles[0]?.timestamp, new Date(2024, 3, 30).getTime());
});

test("IbkrHistoricalCandleProvider rejects daily-style timestamps for intraday candles", async () => {
  sharedIbkrPacingQueue.resetForTests();
  const ib = new FakeHistoricalIbApi();
  const provider = new IbkrHistoricalCandleProvider(ib as any, 100);
  const plan = buildHistoricalFetchPlan(
    {
      symbol: "SEGG",
      timeframe: "5m",
      lookbackBars: 1,
    },
    "ibkr",
  );

  const fetchPromise = provider.fetchCandles(
    {
      symbol: "SEGG",
      timeframe: "5m",
      lookbackBars: 1,
    },
    plan,
  );

  const reqId = await waitForHistoricalRequest(ib);
  ib.emit(EventName.historicalData, reqId, 20240430000, 16.85, 18.3, 16.85, 17.5, 151);
  ib.emit("historicalDataEnd", reqId, "start", "end");

  await assert.rejects(
    fetchPromise,
    /daily-style timestamp for 5m candle/,
  );
});

test("IbkrHistoricalCandleProvider cancels requests when IBKR returns a request-scoped error", async () => {
  sharedIbkrPacingQueue.resetForTests();
  const ib = new FakeHistoricalIbApi();
  const provider = new IbkrHistoricalCandleProvider(ib as any, 100);
  const plan = buildHistoricalFetchPlan(
    {
      symbol: "AAPL",
      timeframe: "4h",
      lookbackBars: 1,
    },
    "ibkr",
  );

  const fetchPromise = provider.fetchCandles(
    {
      symbol: "AAPL",
      timeframe: "4h",
      lookbackBars: 1,
    },
    plan,
  );

  const reqId = await waitForHistoricalRequest(ib);
  ib.emit(EventName.error, new Error("No market data permissions"), 162, reqId);

  await assert.rejects(
    () => fetchPromise,
    /Failed to fetch IBKR historical data for AAPL \(code 162\): No market data permissions/,
  );
  assert.deepEqual(ib.cancelledRequestIds, [reqId]);
});

test("IbkrHistoricalCandleProvider gives alias guidance for code 200 unmapped symbols", async () => {
  sharedIbkrPacingQueue.resetForTests();
  const ib = new FakeHistoricalIbApi();
  const provider = new IbkrHistoricalCandleProvider(ib as any, 100);
  const plan = buildHistoricalFetchPlan(
    {
      symbol: "OLDX",
      timeframe: "5m",
      lookbackBars: 1,
    },
    "ibkr",
  );

  const fetchPromise = provider.fetchCandles(
    {
      symbol: "OLDX",
      timeframe: "5m",
      lookbackBars: 1,
    },
    plan,
  );

  const reqId = await waitForHistoricalRequest(ib);
  ib.emit(EventName.error, new Error("No security definition has been found for the request"), 200, reqId);

  await assert.rejects(
    () => fetchPromise,
    /No validated historical contract alias is configured/,
  );
  assert.deepEqual(ib.cancelledRequestIds, [reqId]);
});
