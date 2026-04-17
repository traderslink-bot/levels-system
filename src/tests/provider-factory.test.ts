import assert from "node:assert/strict";
import test from "node:test";

import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import { createHistoricalCandleProvider } from "../lib/market-data/provider-factory.js";

test("createHistoricalCandleProvider selects Twelve Data when explicitly requested and configured", () => {
  const provider = createHistoricalCandleProvider({
    provider: "twelve_data",
    twelveDataApiKey: "demo-key",
  });

  assert.equal(provider.providerName, "twelve_data");
});

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
