import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { LevelEngineOutput } from "../lib/levels/level-types.js";
import { createStockLevelsGenerator } from "../runtime/stock-levels-generator.js";

const observedAt = Date.parse("2026-11-20T15:30:19.273Z");
const tradedAt = Date.parse("2026-11-20T15:28:49.183Z");
function setup(t: TestContext, symbol = "ELOG", asOf = tradedAt) {
  const previous = { ...process.env };
  t.after(() => { process.env = previous; });
  process.env.TRADERLINK_MARKET_DATA_PROVIDER = "alpaca";
  process.env.TRADERLINK_ALPACA_GATEWAY_URL = "https://gateway.invalid/";
  process.env.TRADERLINK_ALPACA_GATEWAY_TOKEN = "synthetic-only";
  let now = observedAt;
  let requests = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json({ feed: "sip", snapshots: { [symbol]: { latestTrade: { p: 1.7, t: new Date(asOf).toISOString() } } } });
  });
  return { advance: (at: number) => { now = at; }, requests: () => requests };
}
function output(symbol = "ELOG"): LevelEngineOutput {
  return {
    symbol, generatedAt: Date.now(), metadata: { providerByTimeframe: { daily: "alpaca", "4h": "alpaca" }, dataQualityFlags: [], freshness: "fresh" },
    majorSupport: [], majorResistance: [], intermediateSupport: [], intermediateResistance: [],
    intradaySupport: [], intradayResistance: [], extensionLevels: { support: [], resistance: [] }, specialLevels: {},
  };
}

test("Generator passes an older same-session trade to the unchanged historical profile and preserves both times", async (t) => {
  const fixture = setup(t);
  const requests: unknown[] = [];
  const generator = createStockLevelsGenerator({ generateExistingWatchlistLevels: async (request) => {
    requests.push(request);
    fixture.advance(observedAt + 70_000); // No one-minute expiry during calculation.
    return { output: output() };
  } });
  const result = await generator.generate(" elog ");
  assert.ok(result.map);
  assert.deepEqual(requests, [{ symbol: "ELOG", referencePriceOverride: 1.7, calculationProfile: "dashboard_eodhd_daily_4h", acceptedEvidence: true }]);
  assert.equal(result.map.referencePriceAsOf, tradedAt);
  assert.equal(result.map.referencePriceBasis, "last_trade");
  assert.equal(result.map.calculatedAt, observedAt + 70_000);
  assert.equal(result.map.cacheStatus, "fresh");
  assert.equal(fixture.requests(), 1);
});

test("Generator still fails before historical work when the reference belongs to an earlier session", async (t) => {
  setup(t, "ELOG", Date.parse("2026-11-20T14:29:59Z"));
  let calculations = 0;
  const generator = createStockLevelsGenerator({ generateExistingWatchlistLevels: async () => {
    calculations++; return { output: output() };
  } });
  assert.equal((await generator.generate("ELOG")).code, "reference_price_unavailable");
  assert.equal(calculations, 0);
});

test("Generator revalidates the session after calculation", async (t) => {
  const fixture = setup(t);
  const generator = createStockLevelsGenerator({ generateExistingWatchlistLevels: async () => {
    fixture.advance(Date.parse("2026-11-20T21:00:00Z"));
    return { output: output() };
  } });
  const result = await generator.generate("ELOG");
  assert.equal(result.code, "reference_price_unavailable");
  assert.equal(result.map, undefined);
});

test("Generator keeps a Yahoo observation labelled as a reference rather than a last trade", async (t) => {
  const previous = { ...process.env };
  t.after(() => { process.env = previous; });
  delete process.env.TRADERLINK_MARKET_DATA_PROVIDER;
  delete process.env.LEVEL_HISTORICAL_CANDLE_PROVIDER;
  t.mock.method(Date, "now", () => observedAt);
  t.mock.method(globalThis, "fetch", async () => Response.json({ chart: { result: [{
    meta: { symbol: "ELOG", regularMarketPrice: 1.7, regularMarketTime: Math.floor(observedAt / 1000) },
  }] } }));
  const generator = createStockLevelsGenerator({ generateExistingWatchlistLevels: async () => ({ output: output() }) });
  const result = await generator.generate("ELOG");
  assert.ok(result.map);
  assert.equal(result.map.referencePriceBasis, "reference");
  assert.equal(result.map.referencePriceAsOf, Math.floor(observedAt / 1000) * 1000);
});

test("Generator coalesces concurrent requests and resolves price afresh on subsequent requests", async (t) => {
  const fixture = setup(t);
  let calculations = 0;
  const generator = createStockLevelsGenerator({ generateExistingWatchlistLevels: async () => {
    calculations++; return { output: output() };
  } });
  const [first, second] = await Promise.all([generator.generate("ELOG"), generator.generate("elog")]);
  assert.ok(first.map);
  assert.deepEqual(second, first);
  assert.equal(calculations, 1);
  await generator.generate("ELOG");
  assert.equal(calculations, 2);
  assert.equal(fixture.requests(), 2);
});

test("native and explicit evidence requests never share in-flight results; unknown profiles do no work", async (t) => {
  const fixture = setup(t);
  const profiles: string[] = [];
  const generator = createStockLevelsGenerator({ generateExistingWatchlistLevels: async (request) => {
    profiles.push(request.calculationProfile);
    return { output: output() };
  } });
  const [native, strict, coalesced] = await Promise.all([
    generator.generate("ELOG"), generator.generate("ELOG", "scanner-regular-4h-v1"),
    generator.generate("elog", "scanner-regular-4h-v1"),
  ]);
  assert.ok(native.map);
  assert.equal(strict.map, undefined);
  assert.equal(strict.code, "market_data_unavailable");
  assert.deepEqual(coalesced, strict);
  assert.deepEqual(profiles, ["dashboard_eodhd_daily_4h", "scanner-regular-4h-v1"]);
  assert.equal(fixture.requests(), 2);
  for (const unknown of [null, "native", {}, 1, false]) {
    assert.equal((await generator.generate("ELOG", unknown)).map, undefined);
  }
  assert.equal(fixture.requests(), 2);
  await generator.generate("ELOG", "scanner-regular-4h-v1");
  assert.equal(profiles.length, 3);
});
