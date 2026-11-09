import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WatchlistStore } from "../lib/monitoring/watchlist-store.js";
import { WatchlistStatePersistence } from "../lib/monitoring/watchlist-state-persistence.js";
import { normalizeAiReadBoundaryState } from "../lib/monitoring/watchlist-ai-boundary-state.js";
import { availablePriorHigh, suppressPriceDiscoveryRefresh } from "../lib/monitoring/watchlist-price-discovery.js";
import { TradersLinkAiReadRunLedger } from "../lib/ai/traderslink-ai-read-run-ledger.js";
import { getAutomaticAiReadRefreshCountForDate, ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { TradersLinkAiReadReviewStore } from "../lib/ai/traderslink-ai-read-review-store.js";

const now = Date.parse("2026-11-09T18:00:00Z");
const state = {
  generatedAt: now - 1000, currentPrice: 20, upperBoundary: 21, lowerBoundary: 17,
  automaticRefreshDateKey: "2026-11-09", automaticRefreshCount: 5,
  lastAutomaticRefreshRegime: "upper:19",
  pendingAutomaticBoundaryCross: { regime: "upper:21", direction: "upper" as const, boundary: 21,
    firstObservedAt: now - 50, lastObservedAt: now, observationCount: 2, furthestPrice: 21.1, confirmationBufferPct: 0.02 },
};

test("boundary state survives real Store reads, patches, pending publication and disk restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "boundary-state-"));
  try {
    const store = new WatchlistStore();
    store.upsertManualEntry({ symbol: "TEST", active: true });
    store.patchEntry("TEST", { tradersLinkAiReadBoundaryState: state, pendingTradersLinkAiReadGeneration: {
      generationId: "draft-1", createdAt: now, trigger: "boundary_cross", boundaryState: state,
    } });
    store.patchEntry("TEST", { lastPrice: 21.2 });
    const entry = store.getEntry("TEST")!;
    assert.deepEqual(entry.tradersLinkAiReadBoundaryState, state);
    assert.deepEqual(entry.pendingTradersLinkAiReadGeneration?.boundaryState, state);
    const persistence = new WatchlistStatePersistence({ filePath: join(dir, "state.json"), now: () => now });
    persistence.save([entry]);
    const restored = new WatchlistStore();
    restored.setEntries(persistence.load()!);
    const saved = restored.getEntry("TEST")!;
    assert.deepEqual(saved.tradersLinkAiReadBoundaryState, state);
    assert.equal(getAutomaticAiReadRefreshCountForDate(saved.tradersLinkAiReadBoundaryState!, now), 5);
    assert.equal(getAutomaticAiReadRefreshCountForDate(saved.tradersLinkAiReadBoundaryState!, Date.parse("2026-11-10T05:01:00Z")), 0);
    assert.equal(normalizeAiReadBoundaryState({ ...state, automaticRefreshCount: 1000 })?.automaticRefreshCount, 1000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ledger recovers already-consumed boundary requests once per generation, not initial/manual/fallback", () => {
  const dir = mkdtempSync(join(tmpdir(), "boundary-ledger-"));
  try {
    const filePath = join(dir, "ledger.jsonl");
    const ledger = new TradersLinkAiReadRunLedger({ filePath });
    for (let n = 0; n < 9; n++) {
      for (const stage of ["request", "attempt", "publishing"] as const) ledger.record({
        symbol: "TEST", generationId: `generation-${n}`, occurredAt: now,
        trigger: stage === "request" ? "automatic" : "boundary_cross", stage, outcome: "success",
      });
    }
    for (const trigger of ["manual", "activation"]) ledger.record({ symbol: "TEST", generationId: trigger,
      occurredAt: now, trigger, stage: "publishing", outcome: "published" });
    assert.equal(ledger.getAutomaticBoundaryRefreshCount("TEST", "2026-11-09"), 9);
    assert.equal(new TradersLinkAiReadRunLedger({ filePath }).getAutomaticBoundaryRefreshCount("TEST", "2026-11-09"), 9);
    assert.equal(ledger.getAutomaticBoundaryRefreshCount("OTHER", "2026-11-09"), 0);
    assert.equal(ledger.getAutomaticBoundaryRefreshCount("TEST", "2026-11-10"), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("new-high-only suppression preserves manual, initial, downside and unknown-history requests", () => {
  const candles = Array.from({ length: 25 }, (_, i) => ({ timestamp: now - (i + 1) * 86400000,
    open: 9, high: 10 + i / 10, low: 8, close: 9, volume: 100 }));
  candles.push({ timestamp: now, open: 17, high: 25, low: 15, close: 24, volume: 1000 });
  const high = availablePriorHigh(candles, now);
  assert.equal(high, 12.4, "today's constantly rising high must not become a historical ceiling");
  const input = { automatic: true, force: false, direction: "upper" as const, currentPrice: 24, availableHistoricalHigh: high };
  assert.equal(suppressPriceDiscoveryRefresh(input), true);
  assert.equal(suppressPriceDiscoveryRefresh({ ...input, currentPrice: 30 }), true);
  assert.equal(suppressPriceDiscoveryRefresh({ ...input, direction: "lower" }), false);
  assert.equal(suppressPriceDiscoveryRefresh({ ...input, direction: undefined }), false);
  assert.equal(suppressPriceDiscoveryRefresh({ ...input, force: true }), false);
  assert.equal(suppressPriceDiscoveryRefresh({ ...input, automatic: false }), false);
  assert.equal(suppressPriceDiscoveryRefresh({ ...input, availableHistoricalHigh: 40 }), false);
  assert.equal(suppressPriceDiscoveryRefresh({ ...input, availableHistoricalHigh: null }), false);
  assert.equal(availablePriorHigh(candles.slice(-3), now), null);
  assert.equal(availablePriorHigh(Array(25).fill(candles[0]), now), null, "duplicate dates cannot establish history coverage");
  assert.equal(availablePriorHigh(candles.map(bar => ({ ...bar, low: bar.high + 1 })), now), null);
});

test("actual manager skips price-discovery reads, enforces recovered usage and preserves review switches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "boundary-manager-"));
  try {
    const store = new WatchlistStore();
    store.upsertManualEntry({ symbol: "TEST", active: true });
    store.patchEntry("TEST", { lastPrice: 25, lastPriceUpdateAt: now, tradersLinkAiReadBoundaryState: { ...state, automaticRefreshCount: 0 } });
    const ledger = new TradersLinkAiReadRunLedger({ filePath: join(dir, "ledger.jsonl") });
    let requests = 0;
    const manager = new ManualWatchlistRuntimeManager({
      candleFetchService: {} as any, levelStore: {} as any, monitor: {} as any,
      discordAlertRouter: {} as any, opportunityRuntimeController: {} as any,
      watchlistStore: store, watchlistStatePersistence: { save: () => undefined } as any,
      liveWatchlistPublisher: { publish: async () => { throw new Error("must not publish"); } } as any,
      tradersLinkAiReadReviewStore: new TradersLinkAiReadReviewStore(join(dir, "review")),
      tradersLinkAiReadRunLedger: ledger,
      tradersLinkAiReadService: { getConfiguredModel: () => "test", getReasoningEffort: () => "high",
        generate: async () => { requests++; throw new Error("isolated request reached"); } } as any,
      officialWatchlistArticleSourceLookup: async () => ({ status: "lookup_unavailable", error: "isolated", research: { ticker: "TEST", count: 0, businessDays: 5, articles: [] } }),
      now: () => now, initialReviewBeforePublishingEnabled: true,
      initialTradersLinkAiReadGenerationSettings: { enabled: true, automaticUpdatesEnabled: true },
      initialAutoPublishBoundaryRefreshes: true, initialNotifyAutomaticAnalysisUpdates: true,
      initialOwnerReviewNotificationsEnabled: true, initialOwnerReviewDiscordEnabled: true,
      initialTradersLinkAiReadBoundaryRefreshSettings: { enabled: true, maxPerTickerPerNewYorkDate: 5 },
    });
    const internal = manager as any;
    internal.getTradersLinkAiReadGenerationAvailability = () => ({ allowed: true, session: "regular" });
    internal.getTradersLinkAiReadDailyCostBudgetStatus = () => ({ canStartRequest: true });
    internal.buildLevelSnapshotPayload = () => ({ symbol: "TEST", currentPrice: 25, resistanceZones: [], supportZones: [] });
    internal.aiReadState.set("TEST", { ...state, automaticRefreshCount: 0 });
    internal.aiReadHistoricalHigh.set("TEST", { date: "2026-11-09", high: 14 });
    assert.equal(await internal.generateTradersLinkAiRead("TEST", false, "automatic"), null);
    assert.equal(requests, 0);
    assert.equal(store.getEntry("TEST")?.tradersLinkAiReadBoundaryState?.automaticRefreshCount, 0);
    internal.aiReadHistoricalHigh.set("TEST", { date: "2026-11-09", high: 40 });
    for (let n = 0; n < 9; n++) ledger.record({ symbol: "TEST", trigger: "boundary_cross", generationId: `old-${n}`,
      occurredAt: now, stage: "publishing", outcome: "published" });
    const before = manager.getTradersLinkAiReadReviewControls();
    manager.setTradersLinkAiReadBoundaryRefreshSettings({ enabled: true, maxPerTickerPerNewYorkDate: 5 });
    assert.deepEqual(manager.getTradersLinkAiReadReviewControls(), before);
    assert.equal(await internal.generateTradersLinkAiRead("TEST", false, "automatic"), null);
    assert.equal(requests, 0, "old consumed requests still enforce a lowered limit");
    assert.ok(ledger.recent({ symbol: "TEST" }).some(event => event.reason?.includes("cap of 5 reached")));
    await assert.rejects(internal.generateTradersLinkAiRead("TEST", true, "manual", {
      source: "isolated", fetchedAt: now, priorRegularClose: 12, intradayCandles: [], dailyCandles: [],
    }), /isolated request reached/);
    assert.equal(requests, 1, "owner manual refresh is not blocked by automatic limit or discovery");
    const prepared = { source: "isolated", fetchedAt: now, priorRegularClose: 12, intradayCandles: [], dailyCandles: [] };
    manager.setTradersLinkAiReadBoundaryRefreshSettings({ enabled: true, maxPerTickerPerNewYorkDate: 10 });
    await assert.rejects(internal.generateTradersLinkAiRead("TEST", false, "automatic", prepared), /isolated request reached/);
    assert.equal(requests, 2);
    assert.equal(store.getEntry("TEST")?.tradersLinkAiReadBoundaryState?.automaticRefreshCount, 10);
    assert.equal(await internal.generateTradersLinkAiRead("TEST", false, "automatic", prepared), null);
    assert.equal(requests, 2, "a failed paid generation still consumes its one automatic refresh");
    manager.setTradersLinkAiReadBoundaryRefreshSettings({ enabled: true, maxPerTickerPerNewYorkDate: 11 });
    internal.options.officialWatchlistArticleSourceLookup = async () => {
      manager.setTradersLinkAiReadBoundaryRefreshSettings({ enabled: true, maxPerTickerPerNewYorkDate: 10 });
      return { status: "lookup_unavailable", error: "isolated", research: { ticker: "TEST", count: 0, businessDays: 5, articles: [] } };
    };
    assert.equal(await internal.generateTradersLinkAiRead("TEST", false, "automatic", prepared), null);
    assert.equal(requests, 2, "lowering the limit during preparation is respected before dispatch");
    assert.equal(store.getEntry("TEST")?.tradersLinkAiReadBoundaryState?.automaticRefreshCount, 10);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
