import assert from "node:assert/strict";
import test from "node:test";

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
