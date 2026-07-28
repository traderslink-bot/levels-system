import assert from "node:assert/strict";
import test from "node:test";

import { resolveMarketDataStatus } from "../runtime/manual-watchlist-market-data-status.js";

test("EODHD reports the overnight market closure instead of live data", () => {
  assert.equal(resolveMarketDataStatus({
    liveProviderName: "eodhd",
    startupState: "ready",
    ibkrConnected: false,
    ibkrReconnecting: false,
    priceFeedStatus: "closed",
  }), "closed");
});

test("EODHD automatically returns to live when fresh data resumes", () => {
  assert.equal(resolveMarketDataStatus({
    liveProviderName: "eodhd",
    startupState: "ready",
    ibkrConnected: false,
    ibkrReconnecting: false,
    priceFeedStatus: "live",
  }), "live");
});
