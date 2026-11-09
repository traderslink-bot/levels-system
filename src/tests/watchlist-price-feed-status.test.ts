import assert from "node:assert/strict";
import test from "node:test";
import { hasNewerLiveOvernightPrice, isWatchlistOvernightSession, watchlistPriceFeedStatus } from "../lib/monitoring/watchlist-price-feed-status.js";
import { normalizeOvernightLevelReference } from "../lib/live-watchlist/overnight-level-reference.js";

test("overnight boundaries respect Eastern time, weekdays, midnight and DST", () => {
  for (const [iso, expected] of [
    ["2026-11-09T00:59:59Z", false], ["2026-11-09T01:00:00Z", true],
    ["2026-11-09T05:00:00Z", true], ["2026-11-09T08:59:59Z", true], ["2026-11-09T09:00:00Z", false],
    ["2026-11-07T02:00:00Z", false], ["2026-11-07T07:00:00Z", false],
    ["2026-07-13T00:00:00Z", true], ["2026-07-13T08:00:00Z", false],
  ] as const) assert.equal(isWatchlistOvernightSession(Date.parse(iso)), expected, iso);
  assert.equal(isWatchlistOvernightSession(NaN), false);
});

test("overnight permission never substitutes for fresh actual prices", () => {
  const base = { now: Date.parse("2026-11-09T03:00:00Z"), regularSessionsClosed: true, overnightEnabled: true };
  assert.equal(watchlistPriceFeedStatus({ ...base, lastPriceAgeMs: 573 }), "live");
  assert.equal(watchlistPriceFeedStatus({ ...base, lastPriceAgeMs: 120000 }), "live");
  assert.equal(watchlistPriceFeedStatus({ ...base, lastPriceAgeMs: 120001 }), "stale");
  for (const age of [null, NaN, -1]) assert.equal(watchlistPriceFeedStatus({ ...base, lastPriceAgeMs: age }), "waiting");
  assert.equal(watchlistPriceFeedStatus({ ...base, overnightEnabled: false, lastPriceAgeMs: 573 }), "closed");
  assert.equal(watchlistPriceFeedStatus({ ...base, now: Date.parse("2026-11-07T03:00:00Z"), lastPriceAgeMs: 573 }), "closed");
});

test("existing regular-session freshness and waiting behavior are unchanged", () => {
  const base = { now: Date.parse("2026-11-06T15:00:00Z"), regularSessionsClosed: false, overnightEnabled: false };
  assert.equal(watchlistPriceFeedStatus({ ...base, lastPriceAgeMs: null }), "waiting");
  assert.equal(watchlistPriceFeedStatus({ ...base, lastPriceAgeMs: 5000 }), "live");
  assert.equal(watchlistPriceFeedStatus({ ...base, lastPriceAgeMs: 120001 }), "stale");
});

test("a newer live overnight trade releases a one-time reference without changing legacy feeds", () => {
  const now=Date.parse("2026-11-09T03:00:00Z");
  const base={now,overnightEnabled:true,referenceCheckedAt:now-60000,observedAt:now-573};
  assert.equal(hasNewerLiveOvernightPrice(base),true);
  assert.equal(hasNewerLiveOvernightPrice({...base,referenceCheckedAt:now,referenceObservedAt:now-573}),true);
  assert.equal(hasNewerLiveOvernightPrice({...base,referenceObservedAt:now}),false);
  for(const change of [{overnightEnabled:false},{observedAt:base.referenceCheckedAt},{observedAt:now-180000},
    {observedAt:now+60000},{observedAt:NaN},{now:Date.parse("2026-11-07T03:00:00Z")}])
    assert.equal(hasNewerLiveOvernightPrice({...base,...change}),false);
});

test("runtime preserves actual initial trade time and old saved references",()=>{
  const checkedAt=Date.parse("2026-11-09T03:00:00Z"),resumeAfter=Date.parse("2026-11-09T09:00:00Z");
  const legacy={price:2,checkedAt,resumeAfter},dated={...legacy,observedAt:checkedAt-600000};
  assert.deepEqual(normalizeOvernightLevelReference(legacy),legacy);
  assert.deepEqual(normalizeOvernightLevelReference(dated),dated);
  assert.equal(normalizeOvernightLevelReference({...dated,observedAt:checkedAt+60000}),null);
  assert.equal(normalizeOvernightLevelReference({...dated,observedAt:checkedAt-86400000}),null);
});
