import assert from "node:assert/strict";
import test from "node:test";
import { ManualWatchlistRuntimeManager, type ManualWatchlistRuntimeManagerOptions } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { WatchlistStore } from "../lib/monitoring/watchlist-store.js";
import { LevelStore } from "../lib/monitoring/level-store.js";

test("actual manager health and restart rows agree on overnight freshness and provider changes", () => {
  let now = Date.parse("2026-11-09T03:00:00Z"), overnightEnabled = true;
  const store = new WatchlistStore();
  store.upsertManualEntry({ symbol: "TEST", active: true, lifecycle: "active", lastPrice: 2, lastPriceUpdateAt: now-573 });
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {}, monitor: {}, discordAlertRouter: {}, opportunityRuntimeController: {},
    levelStore: new LevelStore(), watchlistStore: store, watchlistStatePersistence: {},
    liveWatchlistPublisher: null, now: () => now, overnightLivePricesEnabled: () => overnightEnabled,
  } as unknown as ManualWatchlistRuntimeManagerOptions);
  // Exercise actual methods without starting a monitor, scheduler or provider.
  const health = manager as unknown as {
    lastPriceUpdateAt: number; buildProviderHealth(count: number): {
      priceFeedStatus: string; restartReadiness: { priceStatus: string }[];
    };
  };
  health.lastPriceUpdateAt = now-573;
  assert.equal(health.buildProviderHealth(0).priceFeedStatus,"live");
  assert.equal(health.buildProviderHealth(0).restartReadiness[0]?.priceStatus,"fresh");
  overnightEnabled=false;
  assert.equal(health.buildProviderHealth(0).priceFeedStatus,"closed");
  assert.equal(health.buildProviderHealth(0).restartReadiness[0]?.priceStatus,"closed");
  overnightEnabled=true; now+=180000;
  assert.equal(health.buildProviderHealth(0).priceFeedStatus,"stale");
  assert.equal(health.buildProviderHealth(0).restartReadiness[0]?.priceStatus,"stale");
});
