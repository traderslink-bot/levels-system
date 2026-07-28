import assert from "node:assert/strict";
import test from "node:test";

import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import { EodhdHistoricalCandleProvider } from "../lib/market-data/eodhd-historical-candle-provider.js";
import { createHistoricalCandleProvider } from "../lib/market-data/provider-factory.js";
import { YahooHistoricalCandleProvider } from "../lib/market-data/yahoo-historical-candle-provider.js";

test("createHistoricalCandleProvider falls back to stub when no runtime provider is available", () => {
  const provider = createHistoricalCandleProvider();
  assert.equal(provider.providerName, "stub");
});

test("createHistoricalCandleProvider passes an explicit IBKR timeout through to the provider", () => {
  const stubIb = {} as any;
  const provider = createHistoricalCandleProvider({
    provider: "ibkr",
    ib: stubIb,
    ibkrTimeoutMs: 45_000,
  });

  assert.equal(provider.providerName, "ibkr");
  assert.equal(provider instanceof IbkrHistoricalCandleProvider, true);
  assert.equal((provider as any).timeoutMs, 45_000);
});

test("createHistoricalCandleProvider creates EODHD provider when explicitly requested", () => {
  const provider = createHistoricalCandleProvider({
    provider: "eodhd",
    eodhdApiToken: "test-token",
  });

  assert.equal(provider.providerName, "eodhd");
  assert.equal(provider instanceof EodhdHistoricalCandleProvider, true);
});

test("createHistoricalCandleProvider creates Yahoo provider when explicitly requested", () => {
  const provider = createHistoricalCandleProvider({
    provider: "yahoo",
  });

  assert.equal(provider.providerName, "yahoo");
  assert.equal(provider instanceof YahooHistoricalCandleProvider, true);
});
