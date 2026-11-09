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

test("Alpaca reports actual feed health independently of IBKR", () => {
  const base = { liveProviderName: "alpaca" as const, startupState: "ready" as const, ibkrConnected: false, ibkrReconnecting: false };
  for (const status of ["live", "stale", "closed"] as const) assert.equal(resolveMarketDataStatus({ ...base, priceFeedStatus: status }), status);
  assert.equal(resolveMarketDataStatus({ ...base, priceFeedStatus: "waiting" }), "starting");
  assert.equal(resolveMarketDataStatus(base), "starting");
  assert.equal(resolveMarketDataStatus({ ...base, startupState: "error", priceFeedStatus: "live" }), "offline");
  assert.equal(resolveMarketDataStatus({ ...base, startupState: "booting", priceFeedStatus: "live" }), "starting");
});

test("legacy Moomoo and IBKR selections keep their original health semantics", () => {
  assert.equal(resolveMarketDataStatus({ liveProviderName: "moomoo", startupState: "ready", ibkrConnected: false, ibkrReconnecting: false, priceFeedStatus: "live" }), "live");
  assert.equal(resolveMarketDataStatus({ liveProviderName: "ibkr", startupState: "ready", ibkrConnected: true, ibkrReconnecting: false }), "live");
  assert.equal(resolveMarketDataStatus({ liveProviderName: "ibkr", startupState: "ready", ibkrConnected: false, ibkrReconnecting: true }), "offline");
});
