import assert from "node:assert/strict";
import test from "node:test";
import {
  isUsableStockLevelsPrice,
  resolveStockLevelsReferencePrice,
  type StockLevelsReferencePrice,
} from "../runtime/stock-levels-reference-price.js";

const time = (value: string) => Date.parse(value);
const now = time("2026-11-20T15:30:19.273Z");
function quote(asOf = now - 90_000, source: StockLevelsReferencePrice["source"] = "alpaca"): StockLevelsReferencePrice {
  return { price: 1.7, asOf, source };
}

test("Generator accepts the observed quiet ELOG and CYAB trades; default Watchlist policy stays strict", () => {
  for (const [observedAt, tradedAt, price] of [
    ["2026-11-20T15:30:19.273Z", "2026-11-20T15:28:49.183Z", 1.7],
    ["2026-11-20T15:30:32.733Z", "2026-11-20T15:29:10.588Z", 0.0572],
  ] as const) {
    const observation = { price, asOf: time(tradedAt), source: "alpaca" as const };
    assert.equal(isUsableStockLevelsPrice(observation, time(observedAt)), false);
    assert.equal(isUsableStockLevelsPrice(observation, time(observedAt), "same_session_trade"), true);
    assert.equal(observation.asOf, time(tradedAt));
  }
});

test("last-trade policy allows genuine trades throughout the same session but keeps Yahoo's one-minute gate", () => {
  for (const source of ["alpaca", "eodhd"] as const) {
    assert.equal(isUsableStockLevelsPrice(quote(time("2026-11-20T14:31:00Z"), source), time("2026-11-20T20:59:00Z"), "same_session_trade"), true);
  }
  assert.equal(isUsableStockLevelsPrice(quote(now - 60_000, "yahoo"), now, "same_session_trade"), true);
  assert.equal(isUsableStockLevelsPrice(quote(now - 60_001, "yahoo"), now, "same_session_trade"), false);
  assert.equal(isUsableStockLevelsPrice(quote(now - 60_000), now), true);
  assert.equal(isUsableStockLevelsPrice(quote(now - 60_001), now), false);
});

test("both policies reject invalid, future, previous-date and previous-session observations", () => {
  const invalid = [
    { ...quote(), price: 0 }, { ...quote(), price: -1 }, { ...quote(), price: NaN },
    { ...quote(), price: Infinity }, { ...quote(), asOf: 0 }, { ...quote(), asOf: NaN },
    { ...quote(), asOf: Infinity }, quote(now + 1), quote(time("2026-11-19T15:30:00Z")),
  ];
  for (const policy of ["recent", "same_session_trade"] as const) {
    for (const observation of invalid) assert.equal(isUsableStockLevelsPrice(observation, now, policy), false);
    for (const [current, previous] of [
      ["2026-11-20T09:00:00Z", "2026-11-20T08:59:59Z"], // overnight -> premarket
      ["2026-11-20T14:30:00Z", "2026-11-20T14:29:59Z"], // premarket -> regular
      ["2026-11-20T21:00:00Z", "2026-11-20T20:59:59Z"], // regular -> postmarket
      ["2026-07-09T13:30:00Z", "2026-07-09T13:29:59Z"], // daylight saving time
    ]) assert.equal(isUsableStockLevelsPrice(quote(time(previous)), time(current), policy), false);
  }
});

test("closed-market 96-hour allowance remains bounded and the next session rejects an older date", () => {
  const closed = time("2026-11-21T15:30:00Z");
  for (const policy of ["recent", "same_session_trade"] as const) {
    assert.equal(isUsableStockLevelsPrice(quote(closed - 96 * 3_600_000), closed, policy), true);
    assert.equal(isUsableStockLevelsPrice(quote(closed - 96 * 3_600_000 - 1), closed, policy), false);
    assert.equal(isUsableStockLevelsPrice(quote(time("2026-11-20T23:59:00Z")), time("2026-11-23T09:00:00Z"), policy), false);
  }
});

test("Alpaca resolution applies the explicit Generator policy without changing source or observation time", async (t) => {
  const previous = { ...process.env };
  t.after(() => { process.env = previous; });
  t.mock.method(Date, "now", () => now);
  process.env.TRADERLINK_MARKET_DATA_PROVIDER = "alpaca";
  process.env.TRADERLINK_ALPACA_GATEWAY_URL = "https://gateway.invalid/";
  process.env.TRADERLINK_ALPACA_GATEWAY_TOKEN = "synthetic-only";
  let calls = 0;
  let payload: unknown = { feed: "sip", snapshots: { ELOG: { latestTrade: { p: 1.7, t: "2026-11-20T15:28:49.183Z" } } } };
  const fetcher: typeof fetch = async (url) => {
    calls++;
    assert.equal(new URL(String(url)).hostname, "gateway.invalid");
    return Response.json(payload);
  };
  assert.equal(await resolveStockLevelsReferencePrice("ELOG", fetcher), null);
  assert.deepEqual(await resolveStockLevelsReferencePrice("ELOG", fetcher, "same_session_trade"), {
    price: 1.7, asOf: time("2026-11-20T15:28:49.183Z"), source: "alpaca",
  });
  for (const invalid of [
    { feed: "iex", snapshots: { ELOG: { latestTrade: { p: 1.7, t: "2026-11-20T15:28:49.183Z" } } } },
    { feed: "sip", snapshots: { OTHER: { latestTrade: { p: 1.7, t: "2026-11-20T15:28:49.183Z" } } } },
    { feed: "sip", snapshots: { ELOG: { latestTrade: { p: 1.7, t: new Date(now + 1).toISOString() } } } },
    { feed: "sip", snapshots: { ELOG: { latestQuote: { bp: 1.7, t: new Date(now).toISOString() } } } },
    { feed: "sip", snapshots: { ELOG: { latestTrade: { p: 1.7, t: "2026-11-20T14:29:59Z" } } } },
  ]) {
    payload = invalid;
    assert.equal(await resolveStockLevelsReferencePrice("ELOG", fetcher, "same_session_trade"), null);
  }
  assert.equal(calls, 7); // One configured-provider request per resolution, no fallback.
});
