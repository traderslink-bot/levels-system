import test from "node:test";
import assert from "node:assert/strict";
import { WATCHLIST_MARKET_DATA_PROFILES, watchlistProviderRolesMatch, identifyWatchlistMarketDataProfile, WatchlistMarketDataProfileGate } from "../runtime/watchlist-market-data-profile.js";
import { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ValidationCachedCandleFetchService } from "../lib/validation/validation-candle-cache.js";
import { CandleFetchService, StubHistoricalCandleProvider } from "../lib/market-data/candle-fetch-service.js";
import { SelectableSameDayCandleService } from "../lib/market-data/selectable-same-day-candle-service.js";

test("profiles reproduce the recorded pre-cutover combination without implying Moomoo live", () => {
  assert.deepEqual(WATCHLIST_MARKET_DATA_PROFILES.previous, { historicalProvider: "eodhd", liveProvider: "eodhd", sameDayCandleProvider: "moomoo" });
  assert.equal(identifyWatchlistMarketDataProfile(WATCHLIST_MARKET_DATA_PROFILES.alpaca), "alpaca");
  assert.equal(identifyWatchlistMarketDataProfile(WATCHLIST_MARKET_DATA_PROFILES.previous), "previous");
  assert.equal(identifyWatchlistMarketDataProfile({ ...WATCHLIST_MARKET_DATA_PROFILES.previous, liveProvider: "moomoo" }), null);
});
test("the shared gate rejects concurrent profile and legacy controls, and recovers after failure", async () => {
  const gate = new WatchlistMarketDataProfileGate();
  let release!: () => void;
  const pending = gate.change(() => new Promise<void>(resolve => { release = resolve; }));
  assert.equal(gate.busy, true);
  await assert.rejects(gate.change(async () => {}), /already in progress/);
  release(); await pending;
  await assert.rejects(gate.change(async () => { throw Error("storage"); }), /storage/);
  assert.equal(gate.busy, false);
});
function managerFixture(failStart = false) {
  const events: string[] = [];
  let live = "old";
  const manager = Object.create(ManualWatchlistRuntimeManager.prototype) as any;
  Object.assign(manager, { monitoringRestartQueue: Promise.resolve(), isStarted: true,
    aiReadInFlight: new Set(), pendingActivations: new Map(),
    watchlistStore: { getActiveEntries: () => [{}] }, ensureLevelsForActiveEntries: async () => [{}],
    emitLifecycle: () => {}, options: { monitor: {
      stop: async () => { events.push("stop"); },
      setLivePriceProvider: (provider: any) => { const before = live; live = provider.id; return { id: before }; },
      start: async () => { events.push(`start:${live}`); if (live === "next" && failStart) throw Error("stream failed"); },
    } },
  });
  return { manager, events, getLive: () => live };
}
test("all-role commit occurs with old monitor stopped and before next monitor starts", async () => {
  const {manager, events, getLive} = managerFixture();
  await manager.switchLivePriceProvider({ id: "next", stop: async () => {} }, {
    commit: () => events.push("commit"), rollback: () => events.push("rollback"),
  });
  assert.deepEqual(events, ["stop", "commit", "start:next"]); assert.equal(getLive(), "next");
});
test("failed new stream rolls back roles before restarting old monitor", async () => {
  const {manager, events, getLive} = managerFixture(true);
  await assert.rejects(manager.switchLivePriceProvider({ id: "next", stop: async () => {events.push("stop:next");} }, {
    commit: () => events.push("commit"), rollback: () => events.push("rollback"),
  }), /stream failed/);
  assert.deepEqual(events, ["stop", "commit", "start:next", "stop:next", "rollback", "start:old"]);
  assert.equal(getLive(), "old"); assert.equal(manager.providerProfileTransition, null);
});
test("persistence failure restores the old monitor without starting the new one", async () => {
  const {manager, events} = managerFixture();
  await assert.rejects(manager.switchLivePriceProvider({ id: "next", stop: async () => {} }, {
    commit: () => { events.push("commit"); throw Error("disk failed"); }, rollback: () => events.push("rollback"),
  }), /disk failed/);
  assert.deepEqual(events, ["stop", "commit", "rollback", "start:old"]);
});
test("historical request completing after a provider change cannot return old candles", async () => {
  let release!: (response: any) => void;
  const service = new CandleFetchService({ providerName: "alpaca", fetchCandles: () => new Promise(resolve => { release = resolve; }) });
  const pending = service.fetchCandles({ symbol: "TEST", timeframe: "daily", lookbackBars: 1 });
  service.setProvider({ providerName: "eodhd", fetchCandles: async () => { throw Error("not requested"); } });
  release({}); await assert.rejects(pending, /provider changed/);
});
test("old Moomoo completion is rejected and cannot seed a new-profile cache or Yahoo fallback", async () => {
  let calls = 0, release!: (response: any) => void;
  const service = new SelectableSameDayCandleService("moomoo", { getProviderName: () => "yahoo", fetchCandles: async () => { throw Error("must not fallback"); } },
    async () => { calls++; return new Promise(resolve => { release = resolve; }); }, () => 1000000);
  const request = { symbol: "TEST", timeframe: "1m" as const, lookbackBars: 1 };
  const first = service.fetchCandles(request);
  service.setProvider("alpaca"); service.setProvider("moomoo");
  release({}); await assert.rejects(first, /provider changed/);
  const next = service.fetchCandles(request); assert.equal(calls, 2);
  service.setProvider("alpaca"); release({}); await assert.rejects(next, /provider changed/);
});

test("legacy live-only changes retain their existing monitor behavior", async () => {
  const {manager, events, getLive} = managerFixture();
  await manager.switchLivePriceProvider({ id: "next", stop: async () => {} });
  assert.deepEqual(events, ["stop", "start:next"]); assert.equal(getLive(), "next");
});
test("provider lookbacks can change and roll back without changing other options", () => {
  const {manager} = managerFixture();
  manager.historicalLookbackBars = { daily: 1000, "4h": 1000, "5m": 1000 };
  const options = manager.options;
  const before = manager.getHistoricalLookbackBars();
  manager.setHistoricalLookbackBars({ ...before, "4h": 2000 });
  assert.equal(manager.getHistoricalLookbackBars()["4h"], 2000);
  manager.setHistoricalLookbackBars(before);
  assert.deepEqual(manager.getHistoricalLookbackBars(), before); assert.equal(manager.options, options);
  assert.throws(() => manager.setHistoricalLookbackBars({ ...before, "4h": NaN }), /Invalid/);
  assert.deepEqual(manager.getHistoricalLookbackBars(), before);
});

test("the disk cache rejects a response started under an earlier provider revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchlist-profile-candle-test-"));
  try {
    const request = { symbol: "TEST", timeframe: "daily" as const, lookbackBars: 1 };
    const seed = await new CandleFetchService(new StubHistoricalCandleProvider()).fetchCandles(request);
    let revision = 0, release!: (value: typeof seed) => void;
    const service = new ValidationCachedCandleFetchService({ getProviderName: () => "stub", getProviderRevision: () => revision,
      fetchCandles: async () => new Promise(resolve => { release = resolve; }) }, { cacheDirectoryPath: root, mode: "refresh" });
    const pending = service.fetchCandles(request);
    revision++; release(seed);
    await assert.rejects(pending, /provider changed/);
    assert.equal(service.getCacheRuntimeInfo().writes, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("configuration readback distinguishes an incomplete disk rollback from actual persisted roles", () => {
  assert.equal(watchlistProviderRolesMatch(WATCHLIST_MARKET_DATA_PROFILES.previous, WATCHLIST_MARKET_DATA_PROFILES.previous), true);
  for (const key of ["historicalProvider", "liveProvider", "sameDayCandleProvider"] as const) {
    assert.equal(watchlistProviderRolesMatch(WATCHLIST_MARKET_DATA_PROFILES.previous,
      { ...WATCHLIST_MARKET_DATA_PROFILES.previous, [key]: "alpaca" }), false);
  }
});
