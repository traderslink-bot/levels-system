import assert from "node:assert/strict";
import test from "node:test";

import type { DiscordThreadRoutingResult } from "../lib/alerts/alert-types.js";
import type { CandleProviderResponse } from "../lib/market-data/candle-types.js";
import type { HistoricalFetchRequest } from "../lib/market-data/candle-fetch-service.js";
import { OpportunityRuntimeController } from "../lib/monitoring/opportunity-runtime-controller.js";
import { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import type { ManualWatchlistLifecycleEvent } from "../lib/monitoring/manual-watchlist-runtime-events.js";
import { WatchlistStore } from "../lib/monitoring/watchlist-store.js";
import type { WatchlistEntry } from "../lib/monitoring/monitoring-types.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";

function waitForAsyncWork(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function buildZone(params: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "symbol" | "kind">): FinalLevelZone {
  return {
    timeframeBias: "5m",
    zoneLow: params.kind === "support" ? 1.9 : 2.4,
    zoneHigh: params.kind === "support" ? 2.0 : 2.5,
    representativePrice: params.kind === "support" ? 1.95 : 2.45,
    strengthScore: 1,
    strengthLabel: "moderate",
    touchCount: 1,
    confluenceCount: 1,
    sourceTypes: [params.kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.5,
    rejectionScore: 0.35,
    displacementScore: 0.4,
    sessionSignificanceScore: 0.2,
    followThroughScore: params.followThroughScore ?? 0.62,
    gapContinuationScore: params.gapContinuationScore ?? 0,
    sourceEvidenceCount: 1,
    firstTimestamp: 1,
    lastTimestamp: 1,
    isExtension: false,
    freshness: "fresh",
    notes: [],
    ...params,
  };
}

function withoutSnapshotSourceLabels<T extends { sourceLabel?: string }>(zones: T[]): Array<Omit<T, "sourceLabel">> {
  return zones.map(({ sourceLabel: _sourceLabel, ...zone }) => zone);
}

function buildLevelOutput(
  symbol: string,
  overrides: Partial<LevelEngineOutput> = {},
): LevelEngineOutput {
  return {
    symbol,
    generatedAt: 1,
    metadata: {
      providerByTimeframe: {},
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 2.2,
    },
    majorSupport: [],
    majorResistance: [],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [],
    intradayResistance: [],
    extensionLevels: {
      support: [],
      resistance: [],
    },
    specialLevels: {},
    ...overrides,
  };
}

class FakeWatchlistStatePersistence {
  public storedEntries: WatchlistEntry[] = [
    {
      symbol: "BIRD",
      active: true,
      priority: 1,
      tags: ["manual"],
      note: "existing",
      discordThreadId: "thread-bird",
      lifecycle: "active",
      refreshPending: false,
    },
  ];

  load() {
    return this.storedEntries.map((entry) => ({ ...entry }));
  }

  save(entries: any[]) {
    this.storedEntries = entries.map((entry) => ({ ...entry }));
  }
}

class FakeMonitor {
  public startCalls: any[][] = [];
  public stopCalls = 0;

  async start(entries: any[], listener: (event: any) => void, onPriceUpdate?: (update: any) => void): Promise<void> {
    this.startCalls.push(entries.map((entry) => ({ ...entry })));
    this.listener = listener;
    this.onPriceUpdate = onPriceUpdate;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
  }

  public listener?: (event: any) => void;
  public onPriceUpdate?: (update: any) => void;
}

class FakeDiscordAlertRouter {
  public ensured: Array<{ symbol: string; storedThreadId?: string | null }> = [];
  public routed: Array<{ threadId: string; payload: any }> = [];
  public levelSnapshots: Array<{ threadId: string; payload: any }> = [];
  public levelExtensions: Array<{ threadId: string; payload: any }> = [];

  async ensureThread(symbol: string, storedThreadId?: string | null): Promise<DiscordThreadRoutingResult> {
    this.ensured.push({ symbol, storedThreadId });
    return {
      threadId: storedThreadId ?? `thread-${symbol.toUpperCase()}`,
      reused: Boolean(storedThreadId),
      recovered: false,
      created: !storedThreadId,
    };
  }

  async routeAlert(threadId: string, payload: any): Promise<void> {
    this.routed.push({ threadId, payload });
  }

  async routeLevelSnapshot(threadId: string, payload: any): Promise<void> {
    this.levelSnapshots.push({ threadId, payload });
  }

  async routeLevelExtension(threadId: string, payload: any): Promise<void> {
    this.levelExtensions.push({ threadId, payload });
  }
}

class DelayedExtensionDiscordAlertRouter extends FakeDiscordAlertRouter {
  constructor(private readonly delayMs: number) {
    super();
  }

  override async routeLevelExtension(threadId: string, payload: any): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return super.routeLevelExtension(threadId, payload);
  }
}

class DelayedSnapshotDiscordAlertRouter extends FakeDiscordAlertRouter {
  constructor(private readonly delayMs: number) {
    super();
  }

  override async routeLevelSnapshot(threadId: string, payload: any): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return super.routeLevelSnapshot(threadId, payload);
  }
}

class DelayedAlertDiscordAlertRouter extends FakeDiscordAlertRouter {
  constructor(private readonly delayMs: number) {
    super();
  }

  override async routeAlert(threadId: string, payload: any): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return super.routeAlert(threadId, payload);
  }
}

class FakeOpportunityRuntimeController {
  processMonitoringEvent() {
    return { newOpportunity: undefined };
  }

  processPriceUpdate() {
    return null;
  }
}

function buildCandleResponse(request: HistoricalFetchRequest): CandleProviderResponse {
  const intervalMs =
    request.timeframe === "daily"
      ? 24 * 60 * 60 * 1000
      : request.timeframe === "4h"
        ? 4 * 60 * 60 * 1000
        : 5 * 60 * 1000;
  const end = Date.parse("2026-04-28T14:00:00Z");
  const candles = Array.from({ length: 12 }, (_, index) => {
    const close = 2 + index * 0.03;
    return {
      timestamp: end - (11 - index) * intervalMs,
      open: close - 0.01,
      high: close + (index % 4 === 2 ? 0.08 : 0.02),
      low: close - 0.03,
      close,
      volume: 1000 + index,
    };
  });

  return {
    provider: "stub",
    symbol: request.symbol.toUpperCase(),
    timeframe: request.timeframe,
    requestedLookbackBars: request.lookbackBars,
    candles,
    fetchStartTimestamp: end - candles.length * intervalMs,
    fetchEndTimestamp: end,
    requestedStartTimestamp: end - request.lookbackBars * intervalMs,
    requestedEndTimestamp: end,
    sessionMetadataAvailable: request.timeframe === "5m",
    actualBarsReturned: candles.length,
    completenessStatus: "complete",
    stale: false,
    validationIssues: [],
    sessionSummary: null,
  };
}

class RecordingCandleFetchService {
  public requests: HistoricalFetchRequest[] = [];

  getProviderName() {
    return "stub";
  }

  async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    this.requests.push({ ...request });
    return buildCandleResponse(request);
  }
}

test("ManualWatchlistRuntimeManager uses deep configurable daily lookbacks for level seeding", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  persistence.storedEntries = [];
  const candleFetchService = new RecordingCandleFetchService();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: candleFetchService as any,
    levelStore: new LevelStore(),
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    historicalLookbackBars: {
      daily: 620,
      "4h": 240,
      "5m": 120,
    },
  });

  await (manager as any).seedLevelsForSymbol("ALBT", { force: true });

  assert.deepEqual(manager.getHistoricalLookbackBars(), {
    daily: 620,
    "4h": 240,
    "5m": 120,
  });
  assert.deepEqual(
    candleFetchService.requests.map((request) => [request.timeframe, request.lookbackBars]),
    [
      ["daily", 620],
      ["4h", 240],
      ["5m", 120],
    ],
  );
});

test("ManualWatchlistRuntimeManager loads persisted active entries and starts monitoring them", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    levelTouchSupersedeDelayMs: 0,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support" }),
        ],
        intradayResistance: [
          buildZone({ id: "R1", symbol, kind: "resistance" }),
        ],
      }));
    },
  });

  await manager.start();

  assert.equal(monitor.startCalls.length >= 1, true);
  assert.deepEqual(monitor.startCalls.at(-1), [
    {
      symbol: "BIRD",
      active: true,
      priority: 1,
      tags: ["manual"],
      note: "existing",
      discordThreadId: "thread-bird",
      lifecycle: "active",
      refreshPending: false,
      activatedAt: monitor.startCalls.at(-1)?.[0]?.activatedAt,
      lastLevelPostAt: monitor.startCalls.at(-1)?.[0]?.lastLevelPostAt,
      lastThreadPostAt: monitor.startCalls.at(-1)?.[0]?.lastThreadPostAt,
      lastThreadPostKind: "snapshot",
      operationStatus: "monitoring live price",
    },
  ]);
  assert.equal(discordAlertRouter.levelSnapshots.length, 1);
  assert.equal(discordAlertRouter.levelSnapshots[0]?.threadId, "thread-bird");
  assert.equal(discordAlertRouter.levelSnapshots[0]?.payload.symbol, "BIRD");
  assert.equal(discordAlertRouter.levelSnapshots[0]?.payload.currentPrice, 2.2);
  assert.deepEqual(withoutSnapshotSourceLabels(discordAlertRouter.levelSnapshots[0]?.payload.supportZones ?? []), [
    { representativePrice: 1.95, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  assert.deepEqual(withoutSnapshotSourceLabels(discordAlertRouter.levelSnapshots[0]?.payload.resistanceZones ?? []), [
    { representativePrice: 2.45, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  assert.equal(typeof discordAlertRouter.levelSnapshots[0]?.payload.timestamp, "number");
});

test("ManualWatchlistRuntimeManager skips a persisted symbol that cannot restore levels on startup", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  persistence.storedEntries = [
    {
      symbol: "BBGI",
      active: true,
      priority: 1,
      tags: ["manual"],
      note: "slow restore",
      discordThreadId: "thread-BBGI",
      lifecycle: "active",
      refreshPending: false,
    },
    {
      symbol: "CANG",
      active: true,
      priority: 2,
      tags: ["manual"],
      note: "healthy restore",
      discordThreadId: "thread-CANG",
      lifecycle: "active",
      refreshPending: false,
    },
  ];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      if (symbol === "BBGI") {
        throw new Error("Historical candles unavailable for BBGI");
      }

      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [buildZone({ id: `${symbol}-S1`, symbol, kind: "support" })],
        intradayResistance: [buildZone({ id: `${symbol}-R1`, symbol, kind: "resistance" })],
      }));
    },
  });

  await manager.start();

  assert.equal(discordAlertRouter.levelSnapshots.length, 1);
  assert.equal(discordAlertRouter.levelSnapshots[0]?.payload.symbol, "CANG");
  assert.deepEqual(monitor.startCalls.at(-1)?.map((entry) => entry.symbol), ["CANG"]);

  const bbgiEntry = manager.getActiveEntries().find((entry) => entry.symbol === "BBGI");
  assert.equal(bbgiEntry?.lifecycle, "refresh_pending");
  assert.equal(bbgiEntry?.refreshPending, true);
});

test("ManualWatchlistRuntimeManager starts monitoring restored symbols while later startup restores are still slow", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const slowSeed = { release: null as (() => void) | null };
  persistence.storedEntries = [
    {
      symbol: "FAST",
      active: true,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-FAST",
      lifecycle: "active",
      refreshPending: false,
    },
    {
      symbol: "SLOW",
      active: true,
      priority: 2,
      tags: ["manual"],
      discordThreadId: "thread-SLOW",
      lifecycle: "active",
      refreshPending: false,
    },
  ];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      if (symbol === "SLOW") {
        await new Promise<void>((resolve) => {
          slowSeed.release = resolve;
        });
      }
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [buildZone({ id: `${symbol}-S1`, symbol, kind: "support" })],
        intradayResistance: [buildZone({ id: `${symbol}-R1`, symbol, kind: "resistance" })],
      }));
    },
  });

  const startPromise = manager.start();
  while (monitor.startCalls.length === 0) {
    await waitForAsyncWork();
  }

  assert.deepEqual(monitor.startCalls.at(-1)?.map((entry) => entry.symbol), ["FAST"]);

  slowSeed.release?.();
  await startPromise;

  assert.deepEqual(monitor.startCalls.at(-1)?.map((entry) => entry.symbol), ["FAST", "SLOW"]);
});

test("ManualWatchlistRuntimeManager preserves activation failures across startup restore", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const lifecycleEvents: any[] = [];
  persistence.storedEntries = [
    {
      symbol: "UCAR",
      active: true,
      priority: 1,
      tags: ["manual"],
      note: "failed before restart",
      discordThreadId: "thread-UCAR",
      lifecycle: "activation_failed",
      refreshPending: false,
      lastError: "Level seeding timed out for UCAR after 225000ms.",
    },
    {
      symbol: "CANG",
      active: true,
      priority: 2,
      tags: ["manual"],
      note: "healthy restore",
      discordThreadId: "thread-CANG",
      lifecycle: "active",
      refreshPending: false,
    },
  ];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    lifecycleListener: (event) => lifecycleEvents.push(event),
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [buildZone({ id: `${symbol}-S1`, symbol, kind: "support" })],
        intradayResistance: [buildZone({ id: `${symbol}-R1`, symbol, kind: "resistance" })],
      }));
    },
  });

  await manager.start();

  assert.deepEqual(discordAlertRouter.ensured.map((entry) => entry.symbol), ["CANG"]);
  assert.deepEqual(discordAlertRouter.levelSnapshots.map((entry) => entry.payload.symbol), ["CANG"]);
  assert.deepEqual(monitor.startCalls.at(-1)?.map((entry) => entry.symbol), ["CANG"]);

  const failedEntry = manager.getActiveEntries().find((entry) => entry.symbol === "UCAR");
  assert.equal(failedEntry?.lifecycle, "activation_failed");
  assert.equal(failedEntry?.refreshPending, false);
  assert.equal(failedEntry?.lastError, "Level seeding timed out for UCAR after 225000ms.");
  assert.ok(lifecycleEvents.some((event) => event.event === "restore_skipped" && event.symbol === "UCAR"));
});

test("ManualWatchlistRuntimeManager revalidates persisted thread ids on startup before posting snapshots", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  persistence.storedEntries = [
    {
      symbol: "GXAI",
      active: true,
      priority: 1,
      tags: ["manual"],
      note: "persisted",
      discordThreadId: "GXAI",
      lifecycle: "active",
      refreshPending: false,
    },
  ];
  discordAlertRouter.ensureThread = async (symbol: string, storedThreadId?: string | null) => {
    discordAlertRouter.ensured.push({ symbol, storedThreadId });
    return {
      threadId: "thread-GXAI",
      reused: false,
      recovered: true,
      created: false,
    };
  };

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support" }),
        ],
        intradayResistance: [
          buildZone({ id: "R1", symbol, kind: "resistance" }),
        ],
      }));
    },
  });

  await manager.start();

  assert.deepEqual(discordAlertRouter.ensured, [
    {
      symbol: "GXAI",
      storedThreadId: "GXAI",
    },
  ]);
  assert.equal(discordAlertRouter.levelSnapshots.length, 1);
  assert.equal(discordAlertRouter.levelSnapshots[0]?.threadId, "thread-GXAI");
  assert.equal(manager.getActiveEntries()[0]?.discordThreadId, "thread-GXAI");
  assert.equal(persistence.storedEntries[0]?.discordThreadId, "thread-GXAI");
});

test("ManualWatchlistRuntimeManager reuses entries on reactivation and does not create duplicate active records", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "albt", note: "first pass" });
  await manager.deactivateSymbol("ALBT");
  await manager.activateSymbol({ symbol: "ALBT" });

  assert.equal(manager.getActiveEntries().length, 1);
  assert.deepEqual(manager.getActiveEntries()[0], {
    symbol: "ALBT",
    active: true,
    priority: 1,
    tags: ["manual"],
    note: "first pass",
    discordThreadId: "thread-ALBT",
    lifecycle: "active",
    refreshPending: false,
    activatedAt: manager.getActiveEntries()[0]?.activatedAt,
    lastLevelPostAt: manager.getActiveEntries()[0]?.lastLevelPostAt,
    lastThreadPostAt: manager.getActiveEntries()[0]?.lastThreadPostAt,
    lastThreadPostKind: "snapshot",
    operationStatus: "monitoring live price",
  });
  assert.equal(discordAlertRouter.ensured.length, 2);
  assert.equal(discordAlertRouter.ensured[1]?.storedThreadId, "thread-ALBT");
  assert.equal(discordAlertRouter.levelSnapshots.length, 2);
});

test("ManualWatchlistRuntimeManager deactivates symbols and keeps stored thread ids for later reuse", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "hubc", note: "halt watch" });
  const deactivated = await manager.deactivateSymbol("HUBC");

  assert.deepEqual(deactivated, {
    symbol: "HUBC",
    active: false,
    priority: 1,
    tags: ["manual"],
    note: "halt watch",
    discordThreadId: "thread-HUBC",
    lifecycle: "inactive",
    refreshPending: false,
    activatedAt: deactivated?.activatedAt,
    lastLevelPostAt: deactivated?.lastLevelPostAt,
    lastThreadPostAt: deactivated?.lastThreadPostAt,
    lastThreadPostKind: "snapshot",
  });
  assert.equal(manager.getActiveEntries().length, 0);
  assert.equal(persistence.storedEntries[0]?.discordThreadId, "thread-HUBC");
});

test("ManualWatchlistRuntimeManager health counts only live display entries", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const watchlistStore = new WatchlistStore();
  watchlistStore.setEntries([
    {
      symbol: "GONE",
      active: false,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-GONE",
      lifecycle: "active",
      refreshPending: false,
    },
  ]);
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  const health = manager.getRuntimeHealth();

  assert.equal(manager.getActiveEntries().length, 0);
  assert.equal(health.lifecycleCounts.active, 0);
  assert.equal(health.lifecycleCounts.inactive, 1);
});

test("ManualWatchlistRuntimeManager keeps a deactivated queued symbol inactive after delayed snapshot work returns", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new DelayedSnapshotDiscordAlertRouter(30);
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    activationAutoRetryDelayMs: 0,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.queueActivation({ symbol: "CUTR" });
  await waitForAsyncWork();

  const deactivated = await manager.deactivateSymbol("CUTR");
  assert.equal(deactivated?.active, false);
  assert.equal(manager.getRuntimeHealth().pendingActivationCount, 0);

  await new Promise((resolve) => setTimeout(resolve, 80));

  const storedEntry = persistence.storedEntries.find((entry) => entry.symbol === "CUTR");
  assert.equal(manager.getActiveEntries().length, 0);
  assert.equal(storedEntry?.active, false);
  assert.equal(storedEntry?.lifecycle, "inactive");
  assert.equal(manager.getRuntimeHealth().lifecycleCounts.active, 0);
  assert.equal(manager.getRuntimeHealth().pendingActivationCount, 0);
});

test("ManualWatchlistRuntimeManager does not create a thread when activation fails before levels are generated", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async () => {
      throw new Error("Historical candles unavailable for TEST");
    },
  });

  await manager.start();

  await assert.rejects(
    manager.activateSymbol({ symbol: "TEST" }),
    /Historical candles unavailable for TEST/,
  );

  assert.equal(discordAlertRouter.ensured.length, 0);
  assert.equal(manager.getActiveEntries().length, 0);
  assert.deepEqual(persistence.storedEntries, []);
});

test("ManualWatchlistRuntimeManager rolls back activation state when snapshot posting fails", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  discordAlertRouter.routeLevelSnapshot = async () => {
    throw new Error("Discord snapshot post failed");
  };

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();

  await assert.rejects(
    manager.activateSymbol({ symbol: "FAIL" }),
    /Discord snapshot post failed/,
  );

  assert.equal(manager.getActiveEntries().length, 0);
  assert.deepEqual(persistence.storedEntries, []);
});

test("ManualWatchlistRuntimeManager retries the first snapshot once after creating a new thread", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  let snapshotAttempts = 0;
  discordAlertRouter.routeLevelSnapshot = async (threadId: string, payload: any) => {
    snapshotAttempts += 1;
    if (snapshotAttempts === 1) {
      throw new Error("Thread not ready yet");
    }
    discordAlertRouter.levelSnapshots.push({ threadId, payload });
  };

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  const activated = await manager.activateSymbol({ symbol: "CANG" });

  assert.equal(snapshotAttempts, 2);
  assert.equal(activated.symbol, "CANG");
  assert.equal(discordAlertRouter.levelSnapshots.length, 1);
  assert.equal(discordAlertRouter.levelSnapshots[0]?.threadId, "thread-CANG");
  assert.equal(manager.getActiveEntries()[0]?.symbol, "CANG");
});

test("ManualWatchlistRuntimeManager queues activation immediately, creates the thread, and completes in the background", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  let releaseSeed: () => void = () => {};
  const seedGate = new Promise<void>((resolve) => {
    releaseSeed = resolve;
  });

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      await seedGate;
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();

  const queued = await manager.queueActivation({ symbol: "BMGL", note: "slow seed" });
  assert.equal(queued.symbol, "BMGL");
  assert.equal(queued.lifecycle, "activating");
  assert.equal(queued.refreshPending, true);
  assert.equal(queued.discordThreadId, "thread-BMGL");
  assert.equal(manager.getActiveEntries()[0]?.symbol, "BMGL");
  assert.equal(manager.getActiveEntries()[0]?.lifecycle, "activating");
  assert.equal(manager.getActiveEntries()[0]?.discordThreadId, "thread-BMGL");
  assert.equal(discordAlertRouter.ensured.length, 1);
  assert.equal(discordAlertRouter.ensured[0]?.symbol, "BMGL");

  releaseSeed();
  await waitForAsyncWork();
  await waitForAsyncWork();
  await waitForAsyncWork();

  const activated = manager.getActiveEntries()[0];
  assert.equal(activated?.symbol, "BMGL");
  assert.equal(activated?.lifecycle, "active");
  assert.equal(activated?.refreshPending, false);
  assert.equal(discordAlertRouter.levelSnapshots[0]?.threadId, "thread-BMGL");
});

test("ManualWatchlistRuntimeManager posts stock context into a newly created thread before the level snapshot", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    stockContextProvider: {
      async getThreadPreview(symbolInput: string) {
        return {
          symbol: symbolInput.toUpperCase(),
          quote: {
            c: 12.34,
            d: 1.23,
            dp: 11.1,
            h: 13,
            l: 11.5,
            o: 11.75,
            pc: 11.11,
            t: 1_700_000_000,
          },
          profile: {
            country: "US",
            exchange: "NASDAQ",
            finnhubIndustry: "Technology",
            marketCapitalization: 850,
            name: "Example Corp",
            weburl: "https://example.com",
          },
        };
      },
    },
    seedSymbolLevels: async (symbol: string) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.queueActivation({ symbol: "EXMP" });
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(discordAlertRouter.routed.length >= 1, true);
  assert.equal(discordAlertRouter.routed[0]?.payload.metadata?.messageKind, "stock_context");
  assert.equal(discordAlertRouter.routed[0]?.payload.title, "");
  assert.equal(discordAlertRouter.levelSnapshots.length >= 1, true);
});

test("ManualWatchlistRuntimeManager marks a hung queued activation failed instead of hiding it", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const lifecycleEvents: ManualWatchlistLifecycleEvent[] = [];
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    lifecycleListener: (event) => {
      lifecycleEvents.push(event);
    },
    levelSeedTimeoutMs: 5,
    queuedActivationSeedGraceTimeoutMs: 10,
    activationMaxAutoRetries: 0,
    seedSymbolLevels: async () => {
      await new Promise<void>(() => {});
    },
  });

  await manager.start();

  const queued = await manager.queueActivation({ symbol: "INTC", note: "hung seed" });
  assert.equal(queued.symbol, "INTC");
  assert.equal(queued.lifecycle, "activating");
  assert.equal(queued.refreshPending, true);

  await waitForAsyncWork();
  await new Promise((resolve) => setTimeout(resolve, 120));

  const failedEntry = manager.getActiveEntries().find((entry) => entry.symbol === "INTC");
  assert.equal(failedEntry?.lifecycle, "activation_failed");
  assert.equal(failedEntry?.refreshPending, false);
  assert.match(failedEntry?.lastError ?? "", /timed out/);
  assert.equal(failedEntry?.discordThreadId, "thread-INTC");
  assert.equal(
    lifecycleEvents.some(
      (event) =>
        event.event === "activation_failed" &&
        event.symbol === "INTC" &&
        String(event.details?.error ?? "").includes("timed out"),
    ),
    true,
  );
  assert.equal(
    lifecycleEvents.some(
      (event) =>
        event.event === "activation_marked_failed" &&
        event.symbol === "INTC" &&
        event.threadId === "thread-INTC",
    ),
    true,
  );
});

test("ManualWatchlistRuntimeManager retries a queued activation once after a seed timeout", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const lifecycleEvents: ManualWatchlistLifecycleEvent[] = [];
  let seedAttempts = 0;
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    lifecycleListener: (event) => {
      lifecycleEvents.push(event);
    },
    levelSeedTimeoutMs: 5,
    queuedActivationSeedGraceTimeoutMs: 0,
    activationAutoRetryDelayMs: 5,
    activationMaxAutoRetries: 1,
    seedSymbolLevels: async (symbol: string) => {
      seedAttempts += 1;
      if (seedAttempts === 1) {
        await new Promise<void>(() => {});
        return;
      }
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  const queued = await manager.queueActivation({ symbol: "UCAR" });
  assert.equal(queued.lifecycle, "activating");

  await new Promise((resolve) => setTimeout(resolve, 80));

  const activeEntry = manager.getActiveEntries().find((entry) => entry.symbol === "UCAR");
  assert.equal(seedAttempts, 2);
  assert.equal(activeEntry?.lifecycle, "active");
  assert.equal(activeEntry?.refreshPending, false);
  assert.equal(activeEntry?.discordThreadId, "thread-UCAR");
  assert.equal(discordAlertRouter.ensured.length, 1);
  assert.equal(discordAlertRouter.levelSnapshots.length, 1);
  assert.equal(
    lifecycleEvents.some(
      (event) =>
        event.event === "activation_retry_scheduled" &&
        event.symbol === "UCAR" &&
        event.threadId === "thread-UCAR",
    ),
    true,
  );
  assert.equal(
    lifecycleEvents.filter((event) => event.event === "activation_started" && event.symbol === "UCAR")
      .length,
    2,
  );
});

test("ManualWatchlistRuntimeManager uses levels from a late timed-out seed on activation retry", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  let seedAttempts = 0;
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    levelSeedTimeoutMs: 5,
    queuedActivationSeedGraceTimeoutMs: 0,
    activationAutoRetryDelayMs: 25,
    activationMaxAutoRetries: 1,
    seedSymbolLevels: async (symbol: string) => {
      seedAttempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.queueActivation({ symbol: "LATE" });
  await new Promise((resolve) => setTimeout(resolve, 90));

  const activeEntry = manager.getActiveEntries().find((entry) => entry.symbol === "LATE");
  assert.equal(seedAttempts, 1);
  assert.equal(activeEntry?.lifecycle, "active");
  assert.equal(activeEntry?.refreshPending, false);
  assert.equal(discordAlertRouter.levelSnapshots.length, 1);
});

test("ManualWatchlistRuntimeManager keeps a queued activation alive when seeding finishes during the grace window", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    levelSeedTimeoutMs: 5,
    queuedActivationSeedGraceTimeoutMs: 80,
    seedSymbolLevels: async (symbol: string) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();

  const queued = await manager.queueActivation({ symbol: "POET", note: "slow but valid" });
  assert.equal(queued.symbol, "POET");
  assert.equal(queued.lifecycle, "activating");

  await waitForAsyncWork();
  await new Promise((resolve) => setTimeout(resolve, 120));

  const activeEntry = manager.getActiveEntries().find((entry) => entry.symbol === "POET");
  assert.equal(activeEntry?.lifecycle, "active");
  assert.equal(activeEntry?.refreshPending, false);
  assert.equal(discordAlertRouter.levelSnapshots.length >= 1, true);
});

test("ManualWatchlistRuntimeManager emits structured lifecycle events for activation and deactivation", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const lifecycleEvents: ManualWatchlistLifecycleEvent[] = [];
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    lifecycleListener: (event) => {
      lifecycleEvents.push(event);
    },
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.queueActivation({ symbol: "AGPU" });
  await waitForAsyncWork();
  await waitForAsyncWork();
  await waitForAsyncWork();
  await manager.deactivateSymbol("AGPU");

  assert.equal(
    lifecycleEvents.some(
      (event) => event.event === "activation_queued" && event.symbol === "AGPU",
    ),
    true,
  );
  assert.equal(
    lifecycleEvents.some(
      (event) => event.event === "snapshot_posted" && event.symbol === "AGPU",
    ),
    true,
  );
  assert.equal(
    lifecycleEvents.some(
      (event) => event.event === "activation_completed" && event.symbol === "AGPU",
    ),
    true,
  );
  assert.equal(
    lifecycleEvents.some(
      (event) => event.event === "deactivated" && event.symbol === "AGPU",
    ),
    true,
  );
});

test("ManualWatchlistRuntimeManager uses cached extension levels when price approaches the highest posted resistance", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  let generationCount = 0;
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      generationCount += 1;
      levelStore.setLevels(buildLevelOutput(symbol, {
        generatedAt: generationCount,
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support" }),
        ],
        intradayResistance: generationCount === 1
          ? [
              buildZone({
                id: "R1",
                symbol,
                kind: "resistance",
                zoneLow: 2.45,
                zoneHigh: 2.5,
                representativePrice: 2.48,
              }),
            ]
          : [
              buildZone({
                id: "R2",
                symbol,
                kind: "resistance",
                zoneLow: 2.7,
                zoneHigh: 2.75,
                representativePrice: 2.72,
              }),
            ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({
              id: "XR1",
              symbol,
              kind: "resistance",
              zoneLow: 3.39,
              zoneHigh: 3.41,
              representativePrice: 3.4,
              isExtension: true,
            }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 2.46,
  });
  await waitForAsyncWork();

  assert.equal(generationCount, 1);
  assert.equal(discordAlertRouter.levelSnapshots.length, 1);
  assert.deepEqual(discordAlertRouter.levelExtensions.at(-1), {
    threadId: "thread-ALBT",
    payload: {
      symbol: "ALBT",
      side: "resistance",
      levels: [3.4],
      timestamp: 1000,
    },
  });
});

test("ManualWatchlistRuntimeManager waits for the far displayed resistance before posting extension levels", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 1.67,
        },
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support", representativePrice: 1.26 }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 1.74,
            zoneHigh: 1.75,
            representativePrice: 1.75,
          }),
          buildZone({
            id: "R2",
            symbol,
            kind: "resistance",
            zoneLow: 1.86,
            zoneHigh: 1.87,
            representativePrice: 1.87,
          }),
          buildZone({
            id: "R3",
            symbol,
            kind: "resistance",
            zoneLow: 2.29,
            zoneHigh: 2.3,
            representativePrice: 2.3,
          }),
          buildZone({
            id: "R4",
            symbol,
            kind: "resistance",
            zoneLow: 2.39,
            zoneHigh: 2.4,
            representativePrice: 2.4,
          }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({
              id: "XR1",
              symbol,
              kind: "resistance",
              zoneLow: 2.49,
              zoneHigh: 2.5,
              representativePrice: 2.5,
              isExtension: true,
            }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 1.7501,
  });
  await waitForAsyncWork();

  assert.equal(discordAlertRouter.levelExtensions.length, 0);

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 2000,
    lastPrice: 2.49,
  });
  await waitForAsyncWork();

  assert.deepEqual(discordAlertRouter.levelExtensions.at(-1), {
    threadId: "thread-ALBT",
    payload: {
      symbol: "ALBT",
      side: "resistance",
      levels: [2.5],
      timestamp: 2000,
    },
  });
});

test("ManualWatchlistRuntimeManager does not full-reseed active symbols when no cached extension is available", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  let generationCount = 0;
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      generationCount += 1;
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support" }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.45,
            zoneHigh: 2.5,
            representativePrice: 2.48,
          }),
        ],
        extensionLevels: {
          support: [],
          resistance: [],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 2.46,
  });
  await waitForAsyncWork();

  assert.equal(generationCount, 1);
  assert.equal(discordAlertRouter.levelSnapshots.length, 1);
  assert.equal(discordAlertRouter.levelExtensions.length, 0);
  assert.equal(manager.getActiveEntries()[0]?.lifecycle, "active");
  assert.equal(manager.getActiveEntries()[0]?.operationStatus, "monitoring live price");
});

test("ManualWatchlistRuntimeManager posts a compact update when nearest snapshot resistance clears fast", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support" }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.88,
            zoneHigh: 2.9,
            representativePrice: 2.9,
          }),
          buildZone({
            id: "R2",
            symbol,
            kind: "resistance",
            zoneLow: 3.08,
            zoneHigh: 3.1,
            representativePrice: 3.1,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 2.92,
  });
  await waitForAsyncWork();

  const clearPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
  );
  assert.equal(clearPosts.length, 1);
  assert.equal(clearPosts[0]?.payload.title, "ALBT resistance crossed");
  assert.match(clearPosts[0]?.payload.body ?? "", /price pushed above 2\.90; next resistance is moderate resistance 3\.10/);
  assert.match(clearPosts[0]?.payload.body ?? "", /next resistance is moderate resistance 3\.10/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /price target/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /mapped/);

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1100,
    lastPrice: 2.93,
  });
  await waitForAsyncWork();

  assert.equal(
    discordAlertRouter.routed.filter(
      (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
    ).length,
    1,
  );
});

test("ManualWatchlistRuntimeManager waits for full resistance zone clearance before fast crossed post", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 6.55,
            zoneHigh: 6.56,
            representativePrice: 6.56,
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 7,
            zoneHigh: 7.04,
            representativePrice: 7,
            strengthLabel: "major",
          }),
          buildZone({
            id: "R2",
            symbol,
            kind: "resistance",
            zoneLow: 7.72,
            zoneHigh: 7.74,
            representativePrice: 7.73,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "SKYQ" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "SKYQ",
    timestamp: 1000,
    lastPrice: 7.02,
  });
  await waitForAsyncWork();

  assert.equal(
    discordAlertRouter.routed.filter(
      (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
    ).length,
    0,
  );

  monitor.onPriceUpdate?.({
    symbol: "SKYQ",
    timestamp: 2000,
    lastPrice: 7.06,
  });
  await waitForAsyncWork();

  const clearPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
  );
  assert.equal(clearPosts.length, 1);
  assert.match(clearPosts[0]?.payload.body ?? "", /price pushed above 7\.04; next resistance is moderate resistance 7\.73/);
  assert.match(clearPosts[0]?.payload.body ?? "", /falling back below 7\.04 means the level is still acting like resistance/);
});

test("ManualWatchlistRuntimeManager advances fast resistance clears through runner ladders", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support" }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 1.31,
            zoneHigh: 1.32,
            representativePrice: 1.32,
          }),
          buildZone({
            id: "R2",
            symbol,
            kind: "resistance",
            zoneLow: 1.33,
            zoneHigh: 1.33,
            representativePrice: 1.33,
          }),
          buildZone({
            id: "R3",
            symbol,
            kind: "resistance",
            zoneLow: 1.39,
            zoneHigh: 1.39,
            representativePrice: 1.39,
          }),
          buildZone({
            id: "R4",
            symbol,
            kind: "resistance",
            zoneLow: 1.41,
            zoneHigh: 1.41,
            representativePrice: 1.41,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 1.33,
  });
  await waitForAsyncWork();
  (manager as any).recordLiveThreadPost({
    symbol: "ALBT",
    timestamp: 1100,
    kind: "intelligent_alert",
    critical: true,
    eventType: "breakout",
  });

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1300,
    lastPrice: 1.41,
  });
  await waitForAsyncWork();

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 2300,
    lastPrice: 1.41,
  });
  await waitForAsyncWork();

  const clearPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
  );
  assert.equal(clearPosts.length, 3);
  assert.equal(clearPosts[0]?.payload.metadata?.targetPrice, 1.32);
  assert.equal(clearPosts[1]?.payload.metadata?.targetPrice, 1.33);
  assert.equal(clearPosts[2]?.payload.metadata?.targetPrice, 1.39);
  assert.match(clearPosts[2]?.payload.body ?? "", /price pushed above 1\.39; next resistance is moderate resistance 1\.41/);
  assert.doesNotMatch(clearPosts[2]?.payload.body ?? "", /mapped/);
});

test("ManualWatchlistRuntimeManager does not skip intermediate resistance when price jumps through multiple levels", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 1.21,
            zoneHigh: 1.22,
            representativePrice: 1.22,
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 1.31,
            zoneHigh: 1.32,
            representativePrice: 1.32,
          }),
          buildZone({
            id: "R2",
            symbol,
            kind: "resistance",
            zoneLow: 1.38,
            zoneHigh: 1.39,
            representativePrice: 1.39,
          }),
          buildZone({
            id: "R3",
            symbol,
            kind: "resistance",
            zoneLow: 1.40,
            zoneHigh: 1.41,
            representativePrice: 1.41,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 1.44,
  });
  await waitForAsyncWork();

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 2000,
    lastPrice: 1.44,
  });
  await waitForAsyncWork();

  const clearPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
  );
  assert.equal(clearPosts.length, 2);
  assert.equal(clearPosts[0]?.payload.metadata?.targetPrice, 1.32);
  assert.equal(clearPosts[1]?.payload.metadata?.targetPrice, 1.39);
  assert.match(clearPosts[0]?.payload.body ?? "", /falling back below 1\.32 means the level is still acting like resistance/);
  assert.match(clearPosts[0]?.payload.body ?? "", /risk opens back toward 1\.22/);
});

test("ManualWatchlistRuntimeManager does not skip intermediate support when price drops through multiple levels", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 1.21,
            zoneHigh: 1.22,
            representativePrice: 1.22,
          }),
          buildZone({
            id: "S2",
            symbol,
            kind: "support",
            zoneLow: 1.07,
            zoneHigh: 1.08,
            representativePrice: 1.08,
          }),
          buildZone({
            id: "S3",
            symbol,
            kind: "support",
            zoneLow: 1.05,
            zoneHigh: 1.06,
            representativePrice: 1.06,
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 1.32,
            zoneHigh: 1.33,
            representativePrice: 1.33,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 1.04,
  });
  await waitForAsyncWork();

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 2000,
    lastPrice: 1.04,
  });
  await waitForAsyncWork();

  const clearPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
  );
  assert.equal(clearPosts.length, 2);
  assert.equal(clearPosts[0]?.payload.metadata?.targetPrice, 1.22);
  assert.equal(clearPosts[1]?.payload.metadata?.targetPrice, 1.08);
  assert.match(clearPosts[0]?.payload.body ?? "", /price slipped below 1\.22; next support is moderate support 1\.08/);
  assert.match(clearPosts[0]?.payload.body ?? "", /next support is moderate support 1\.08/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /price target/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /mapped/);
  assert.match(clearPosts[0]?.payload.body ?? "", /next support reaction area: moderate support 1\.08; buyers need stabilization there or a reclaim of 1\.22/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /dip-buy/i);
  assert.match(clearPosts[0]?.payload.body ?? "", /below 1\.22, risk stays open toward 1\.08/);
});

test("ManualWatchlistRuntimeManager suppresses overlapping fast level-clear posts before routing resolves", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const routePause = { resolve: null as (() => void) | null };
  const originalRouteAlert = discordAlertRouter.routeAlert.bind(discordAlertRouter);
  discordAlertRouter.routeAlert = async (threadId: string, payload: any) => {
    if (payload.metadata?.messageKind === "level_clear_update") {
      await new Promise<void>((resolve) => {
        routePause.resolve = resolve;
      });
    }
    return originalRouteAlert(threadId, payload);
  };
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support" }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.88,
            zoneHigh: 2.9,
            representativePrice: 2.9,
          }),
          buildZone({
            id: "R2",
            symbol,
            kind: "resistance",
            zoneLow: 3.08,
            zoneHigh: 3.1,
            representativePrice: 3.1,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 2.92,
  });
  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1001,
    lastPrice: 2.93,
  });
  await waitForAsyncWork();
  routePause.resolve?.();
  await waitForAsyncWork();

  assert.equal(
    discordAlertRouter.routed.filter(
      (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
    ).length,
    1,
  );
});

test("ManualWatchlistRuntimeManager keeps fast level-clear memory after extension maintenance", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 2.8,
        },
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support" }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.88,
            zoneHigh: 2.9,
            representativePrice: 2.9,
          }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({
              id: "XR1",
              symbol,
              kind: "resistance",
              zoneLow: 3.08,
              zoneHigh: 3.1,
              representativePrice: 3.1,
              isExtension: true,
            }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 2.92,
  });
  await waitForAsyncWork();
  await (manager as any).postLevelExtension("ALBT", "thread-ALBT", "resistance", 3000);
  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 5000,
    lastPrice: 2.93,
  });
  await waitForAsyncWork();

  assert.equal(
    discordAlertRouter.routed.filter(
      (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
    ).length,
    1,
  );
});

test("ManualWatchlistRuntimeManager keeps earlier symbols live after a newer symbol is activated", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      if (symbol === "ALBT") {
        levelStore.setLevels(buildLevelOutput(symbol, {
          intradaySupport: [
            buildZone({ id: "S1", symbol, kind: "support" }),
          ],
          intradayResistance: [
            buildZone({
              id: "R1",
              symbol,
              kind: "resistance",
              zoneLow: 2.45,
              zoneHigh: 2.5,
              representativePrice: 2.48,
            }),
          ],
          extensionLevels: {
            support: [],
            resistance: [
              buildZone({
                id: "XR1",
                symbol,
                kind: "resistance",
                zoneLow: 3.39,
                zoneHigh: 3.41,
                representativePrice: 3.4,
                isExtension: true,
              }),
            ],
          },
        }));
        return;
      }

      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support" }),
        ],
        intradayResistance: [
          buildZone({ id: "R1", symbol, kind: "resistance" }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  await manager.activateSymbol({ symbol: "BIRD" });

  const latestStart = monitor.startCalls.at(-1);
  assert.equal(latestStart?.length, 2);
  assert.deepEqual(
    latestStart?.map((entry) => entry.symbol),
    ["ALBT", "BIRD"],
  );

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 2.46,
  });
  await waitForAsyncWork();

  assert.deepEqual(discordAlertRouter.levelExtensions.at(-1), {
    threadId: "thread-ALBT",
    payload: {
      symbol: "ALBT",
      side: "resistance",
      levels: [3.4],
      timestamp: 1000,
    },
  });
});

test("ManualWatchlistRuntimeManager does not block a new activation when another active symbol fails reseeding during restart", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  let failBbgiRefresh = false;

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      if (symbol === "BBGI" && failBbgiRefresh) {
        throw new Error("Historical candles unavailable for BBGI");
      }

      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [buildZone({ id: `${symbol}-S1`, symbol, kind: "support" })],
        intradayResistance: [buildZone({ id: `${symbol}-R1`, symbol, kind: "resistance" })],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "BBGI" });

  (levelStore as any).levels.delete("BBGI");
  (levelStore as any).activeSupportZones.delete("BBGI");
  (levelStore as any).activeResistanceZones.delete("BBGI");
  failBbgiRefresh = true;

  const activated = await manager.activateSymbol({ symbol: "CANG" });

  assert.equal(activated.symbol, "CANG");
  assert.equal(activated.lifecycle, "active");
  assert.equal(discordAlertRouter.levelSnapshots.at(-1)?.payload.symbol, "CANG");

  const bbgiEntry = manager.getActiveEntries().find((entry) => entry.symbol === "BBGI");
  assert.equal(bbgiEntry?.lifecycle, "refresh_pending");
  assert.equal(bbgiEntry?.refreshPending, true);

  const latestStart = monitor.startCalls.at(-1);
  assert.deepEqual(latestStart?.map((entry) => entry.symbol), ["CANG"]);
});

test("ManualWatchlistRuntimeManager snapshots partition displayed levels relative to snapshot price", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 1.55,
        },
        intradaySupport: [
          buildZone({ id: "S-low", symbol, kind: "support", representativePrice: 1.33, zoneLow: 1.31, zoneHigh: 1.35 }),
          buildZone({ id: "S-near", symbol, kind: "support", representativePrice: 1.60, zoneLow: 1.58, zoneHigh: 1.62 }),
        ],
        intradayResistance: [
          buildZone({ id: "R-below", symbol, kind: "resistance", representativePrice: 1.22, zoneLow: 1.21, zoneHigh: 1.23 }),
          buildZone({ id: "R-near", symbol, kind: "resistance", representativePrice: 1.62, zoneLow: 1.61, zoneHigh: 1.63 }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "GXAI" });

  const snapshot = discordAlertRouter.levelSnapshots.at(-1)?.payload;
  assert.equal(snapshot.symbol, "GXAI");
  assert.equal(snapshot.currentPrice, 1.55);
  assert.deepEqual(withoutSnapshotSourceLabels(snapshot.supportZones), [
    { representativePrice: 1.33, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  assert.deepEqual(withoutSnapshotSourceLabels(snapshot.resistanceZones), [
    { representativePrice: 1.62, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  assert.equal(snapshot.supportZones[0]?.sourceLabel, "fresh intraday");
  assert.equal(typeof snapshot.timestamp, "number");
  assert.equal(snapshot.audit?.omittedSupportCount, 1);
  assert.equal(snapshot.audit?.omittedResistanceCount, 1);
  assert.equal(
    snapshot.audit?.supportCandidates.find((candidate: any) => candidate.id === "GXAI-support-monitored-1")?.omittedReason,
    "wrong_side",
  );
  assert.equal(
    snapshot.audit?.resistanceCandidates.find((candidate: any) => candidate.id === "GXAI-resistance-monitored-1")?.omittedReason,
    "wrong_side",
  );
});

test("ManualWatchlistRuntimeManager snapshot tolerance excludes near-price levels from both support and resistance display", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 1.55,
        },
        intradaySupport: [
          buildZone({ id: "S-close", symbol, kind: "support", representativePrice: 1.5495, zoneLow: 1.548, zoneHigh: 1.551 }),
          buildZone({ id: "S-below", symbol, kind: "support", representativePrice: 1.53, zoneLow: 1.52, zoneHigh: 1.54 }),
        ],
        intradayResistance: [
          buildZone({ id: "R-close", symbol, kind: "resistance", representativePrice: 1.5504, zoneLow: 1.549, zoneHigh: 1.552 }),
          buildZone({ id: "R-above", symbol, kind: "resistance", representativePrice: 1.58, zoneLow: 1.57, zoneHigh: 1.59 }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "BIRD" });

  assert.deepEqual(withoutSnapshotSourceLabels(discordAlertRouter.levelSnapshots.at(-1)?.payload.supportZones ?? []), [
    { representativePrice: 1.53, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  assert.deepEqual(withoutSnapshotSourceLabels(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones ?? []), [
    { representativePrice: 1.58, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
});

test("ManualWatchlistRuntimeManager removes exact duplicate displayed prices and compacts dense nearby levels", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 1.47,
        },
        intradaySupport: [
          buildZone({ id: "S-143-a", symbol, kind: "support", representativePrice: 1.431, strengthScore: 2.2, confluenceCount: 2 }),
          buildZone({ id: "S-143-b", symbol, kind: "support", representativePrice: 1.434, strengthScore: 1.2, confluenceCount: 1 }),
          buildZone({ id: "S-136", symbol, kind: "support", representativePrice: 1.36, strengthScore: 1.5 }),
          buildZone({ id: "S-133", symbol, kind: "support", representativePrice: 1.33, strengthScore: 1.4 }),
          buildZone({ id: "S-130", symbol, kind: "support", representativePrice: 1.30, strengthScore: 1.3 }),
          buildZone({ id: "S-129", symbol, kind: "support", representativePrice: 1.29, strengthScore: 0.6 }),
          buildZone({ id: "S-128", symbol, kind: "support", representativePrice: 1.28, strengthScore: 0.5 }),
          buildZone({ id: "S-125-a", symbol, kind: "support", representativePrice: 1.251, strengthScore: 1.8 }),
          buildZone({ id: "S-125-b", symbol, kind: "support", representativePrice: 1.249, strengthScore: 1.1 }),
          buildZone({ id: "S-124", symbol, kind: "support", representativePrice: 1.24, strengthScore: 0.9 }),
          buildZone({ id: "S-122-a", symbol, kind: "support", representativePrice: 1.221, strengthScore: 1.6 }),
          buildZone({ id: "S-122-b", symbol, kind: "support", representativePrice: 1.219, strengthScore: 0.8 }),
          buildZone({ id: "S-117", symbol, kind: "support", representativePrice: 1.17, strengthScore: 1.2 }),
          buildZone({ id: "S-111", symbol, kind: "support", representativePrice: 1.11, strengthScore: 1.0 }),
        ],
        intradayResistance: [
          buildZone({ id: "R-152", symbol, kind: "resistance", representativePrice: 1.52, strengthScore: 1.3 }),
          buildZone({ id: "R-153", symbol, kind: "resistance", representativePrice: 1.53, strengthScore: 1.1 }),
          buildZone({ id: "R-158", symbol, kind: "resistance", representativePrice: 1.58, strengthScore: 1.5 }),
          buildZone({ id: "R-160", symbol, kind: "resistance", representativePrice: 1.60, strengthScore: 1.4 }),
          buildZone({ id: "R-162", symbol, kind: "resistance", representativePrice: 1.62, strengthScore: 1.0 }),
          buildZone({ id: "R-164", symbol, kind: "resistance", representativePrice: 1.64, strengthScore: 0.9 }),
          buildZone({ id: "R-167", symbol, kind: "resistance", representativePrice: 1.67, strengthScore: 0.8 }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({ id: "RX-175", symbol, kind: "resistance", representativePrice: 1.75, isExtension: true, strengthScore: 1.2 }),
            buildZone({ id: "RX-189", symbol, kind: "resistance", representativePrice: 1.89, isExtension: true, strengthScore: 1.4 }),
            buildZone({ id: "RX-208", symbol, kind: "resistance", representativePrice: 2.08, isExtension: true, strengthScore: 1.1 }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "GXAI" });

  assert.deepEqual(withoutSnapshotSourceLabels(discordAlertRouter.levelSnapshots.at(-1)?.payload.supportZones ?? []), [
    { representativePrice: 1.431, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.36, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.33, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.3, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.28, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.251, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.221, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.17, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.11, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  assert.deepEqual(withoutSnapshotSourceLabels(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones ?? []), [
    { representativePrice: 1.52, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.58, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.6, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.62, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.64, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.67, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.75, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
    { representativePrice: 1.89, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
    { representativePrice: 2.08, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
  ]);
  assert.equal(discordAlertRouter.levelSnapshots.at(-1)?.payload.supportZones.length, 9);
  assert.equal(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones.length, 9);
});

test("ManualWatchlistRuntimeManager keeps the strongest representative when close snapshot levels compete", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 2.5,
        },
        intradayResistance: [
          buildZone({
            id: "R-weak-near",
            symbol,
            kind: "resistance",
            representativePrice: 2.61,
            strengthScore: 1.0,
            confluenceCount: 1,
            sourceEvidenceCount: 1,
            timeframeBias: "5m",
            freshness: "aging",
          }),
          buildZone({
            id: "R-strong-close",
            symbol,
            kind: "resistance",
            representativePrice: 2.62,
            strengthScore: 2.8,
            confluenceCount: 3,
            sourceEvidenceCount: 3,
            timeframeBias: "4h",
            timeframeSources: ["4h"],
            freshness: "fresh",
          }),
          buildZone({
            id: "R-next",
            symbol,
            kind: "resistance",
            representativePrice: 2.74,
            strengthScore: 1.5,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });

  assert.deepEqual(withoutSnapshotSourceLabels(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones ?? []), [
    { representativePrice: 2.62, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 2.74, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  const auditCandidates =
    discordAlertRouter.levelSnapshots.at(-1)?.payload.audit?.resistanceCandidates ?? [];
  assert.equal(
    auditCandidates.find((candidate: any) => candidate.id === "ALBT-resistance-monitored-1")
      ?.omittedReason,
    "compacted",
  );
  assert.equal(
    auditCandidates.find((candidate: any) => candidate.id === "ALBT-resistance-monitored-2")
      ?.displayed,
    true,
  );
  assert.deepEqual(
    auditCandidates.find((candidate: any) => candidate.id === "ALBT-resistance-monitored-2")
      ?.timeframeSources,
    ["4h"],
  );
});

test("ManualWatchlistRuntimeManager extends resistance snapshot coverage through the 50 percent forward planning range", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 1.41,
        },
        intradayResistance: [
          buildZone({ id: "R-147", symbol, kind: "resistance", representativePrice: 1.47 }),
          buildZone({ id: "R-153", symbol, kind: "resistance", representativePrice: 1.53 }),
          buildZone({ id: "R-158", symbol, kind: "resistance", representativePrice: 1.58 }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({ id: "RX-172", symbol, kind: "resistance", representativePrice: 1.72, isExtension: true, strengthScore: 1.6 }),
            buildZone({ id: "RX-184", symbol, kind: "resistance", representativePrice: 1.84, isExtension: true, strengthScore: 1.4 }),
            buildZone({ id: "RX-205", symbol, kind: "resistance", representativePrice: 2.05, isExtension: true, strengthScore: 1.2 }),
            buildZone({ id: "RX-220", symbol, kind: "resistance", representativePrice: 2.2, isExtension: true, strengthScore: 1.8 }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "GXAI" });

  assert.deepEqual(withoutSnapshotSourceLabels(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones ?? []), [
    { representativePrice: 1.47, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.53, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.58, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.72, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
    { representativePrice: 1.84, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
    { representativePrice: 2.05, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
  ]);
});

test("ManualWatchlistRuntimeManager preserves near, intermediate, and far resistance continuity in the compact snapshot ladder", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 1.45,
        },
        intradayResistance: [
          buildZone({ id: "R-149", symbol, kind: "resistance", representativePrice: 1.49, strengthScore: 1.9 }),
          buildZone({ id: "R-158", symbol, kind: "resistance", representativePrice: 1.58, strengthScore: 1.4 }),
          buildZone({ id: "R-164", symbol, kind: "resistance", representativePrice: 1.64, strengthScore: 1.1 }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({
              id: "RX-175",
              symbol,
              kind: "resistance",
              representativePrice: 1.75,
              isExtension: true,
              strengthScore: 2.5,
              timeframeBias: "daily",
              timeframeSources: ["daily"],
              rejectionScore: 0.61,
            }),
            buildZone({
              id: "RX-185",
              symbol,
              kind: "resistance",
              representativePrice: 1.85,
              isExtension: true,
              strengthScore: 1.8,
              timeframeBias: "4h",
              timeframeSources: ["4h"],
              rejectionScore: 0.39,
            }),
            buildZone({ id: "RX-206", symbol, kind: "resistance", representativePrice: 2.06, isExtension: true, strengthScore: 1.2 }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "GXAI" });

  assert.deepEqual(withoutSnapshotSourceLabels(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones ?? []), [
    { representativePrice: 1.49, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.58, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.64, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.75, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
    { representativePrice: 1.85, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
    { representativePrice: 2.06, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
  ]);
  assert.equal(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones.length, 6);
});

test("ManualWatchlistRuntimeManager preserves a meaningful isolated intermediate wick-high when capping resistance display zones", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 1.44,
        },
        intradayResistance: [
          buildZone({ id: "R-149", symbol, kind: "resistance", representativePrice: 1.49, strengthScore: 1.6 }),
          buildZone({ id: "R-158", symbol, kind: "resistance", representativePrice: 1.58, strengthScore: 1.5 }),
          buildZone({ id: "R-164", symbol, kind: "resistance", representativePrice: 1.64, strengthScore: 1.1 }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({ id: "RX-172", symbol, kind: "resistance", representativePrice: 1.72, isExtension: true, strengthScore: 0.9 }),
            buildZone({
              id: "RX-175",
              symbol,
              kind: "resistance",
              representativePrice: 1.75,
              isExtension: true,
              strengthScore: 2.4,
              confluenceCount: 2,
              timeframeBias: "daily",
              timeframeSources: ["daily"],
              rejectionScore: 0.62,
            }),
            buildZone({ id: "RX-185", symbol, kind: "resistance", representativePrice: 1.85, isExtension: true, strengthScore: 1.0 }),
            buildZone({ id: "RX-195", symbol, kind: "resistance", representativePrice: 1.95, isExtension: true, strengthScore: 0.8 }),
            buildZone({ id: "RX-205", symbol, kind: "resistance", representativePrice: 2.05, isExtension: true, strengthScore: 1.2 }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "GXAI" });

  assert.deepEqual(withoutSnapshotSourceLabels(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones ?? []), [
    { representativePrice: 1.49, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.58, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.64, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.72, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
    { representativePrice: 1.75, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
    { representativePrice: 1.85, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
    { representativePrice: 1.95, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
    { representativePrice: 2.05, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
  ]);
  assert.equal(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones.length, 8);
});

test("ManualWatchlistRuntimeManager does not repost repeatedly at the same refresh boundary", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.45,
            zoneHigh: 2.5,
            representativePrice: 2.48,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "IMMP" });
  monitor.onPriceUpdate?.({
    symbol: "IMMP",
    timestamp: 1000,
    lastPrice: 2.46,
  });
  await waitForAsyncWork();
  monitor.onPriceUpdate?.({
    symbol: "IMMP",
    timestamp: 2000,
    lastPrice: 2.47,
  });
  await waitForAsyncWork();

  assert.equal(discordAlertRouter.levelSnapshots.length, 1);
});

test("ManualWatchlistRuntimeManager routes intelligence-based alert payloads instead of generic zone text", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  monitor.listener?.({
    id: "evt-1",
    episodeId: "evt-1-episode",
    symbol: "ALBT",
    type: "breakout",
    eventType: "breakout",
    zoneId: "ALBT-resistance-monitored-1",
    zoneKind: "resistance",
    level: 2.45,
    triggerPrice: 2.52,
    strength: 0.82,
    confidence: 0.79,
    priority: 86,
    bias: "bullish",
    pressureScore: 0.71,
    eventContext: {
      monitoredZoneId: "ALBT-resistance-monitored-1",
      canonicalZoneId: "R1",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "preserved",
      remappedFromZoneIds: ["ALBT-resistance-monitored-legacy"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost",
      zoneStrengthLabel: "strong",
      sourceGeneratedAt: 1,
      nextBarrierKind: "resistance",
      nextBarrierLevel: 2.58,
      nextBarrierDistancePct: 0.0238,
      clearanceLabel: "limited",
    },
    timestamp: 10,
    notes: ["Breakout through outermost resistance."],
  });
  await waitForAsyncWork();

  const intelligentAlerts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "intelligent_alert" || !entry.payload.metadata?.messageKind,
  );
  assert.equal(intelligentAlerts.length, 1);
  assert.equal(intelligentAlerts[0]?.payload.title, "ALBT breakout");
  assert.match(
    intelligentAlerts[0]?.payload.body ?? "",
    /bullish breakout through heavy resistance 2\.40-2\.50\n\nPrice is above resistance for now\./,
  );
  assert.match(
    intelligentAlerts[0]?.payload.body ?? "",
    /- price is pushing farther above the zone high and follow-through is building/,
  );
  assert.match(
    intelligentAlerts[0]?.payload.body ?? "",
    /Key levels:\n- First resistance: 2\.58/,
  );
  assert.doesNotMatch(intelligentAlerts[0]?.payload.body ?? "", /Importance:|Confidence:|Signal:/);
  assert.match(intelligentAlerts[0]?.payload.body ?? "", /Triggered near: 2\.52/);
  assert.doesNotMatch(
    intelligentAlerts[0]?.payload.body ?? "",
    /Status:|Signal:|Decision area|setup update|state recap|setup move|alert direction|after the alert/,
  );
});

test("ManualWatchlistRuntimeManager posts AI signal commentary after deterministic alerts when enabled", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const aiCommentaryService = {
    async explainSignal(input: any) {
      assert.equal(input.symbol, "ALBT");
      assert.match(input.deterministicBody, /Price is above resistance for now/);
      assert.doesNotMatch(input.deterministicBody, /Next levels:/);
      assert.doesNotMatch(input.deterministicBody, /Key levels:/);
      assert.equal(input.metadata?.targetSide, undefined);
      assert.equal(input.metadata?.nextBarrierSide, undefined);
      assert.equal(input.metadata?.targetPrice, undefined);
      assert.equal(input.metadata?.targetDistancePct, undefined);
      return {
        text: "AI says buyers need acceptance above resistance before trusting continuation.",
        model: "test-model",
      };
    },
  };
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    aiCommentaryService: aiCommentaryService as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  monitor.listener?.({
    id: "evt-ai-1",
    episodeId: "evt-ai-1-episode",
    symbol: "ALBT",
    type: "breakout",
    eventType: "breakout",
    zoneId: "ALBT-resistance-monitored-1",
    zoneKind: "resistance",
    level: 2.45,
    triggerPrice: 2.52,
    strength: 0.82,
    confidence: 0.79,
    priority: 86,
    bias: "bullish",
    pressureScore: 0.71,
    eventContext: {
      monitoredZoneId: "ALBT-resistance-monitored-1",
      canonicalZoneId: "R1",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "preserved",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost",
      zoneStrengthLabel: "strong",
      sourceGeneratedAt: 1,
      nextBarrierKind: "resistance",
      nextBarrierLevel: 2.58,
      nextBarrierDistancePct: 0.0238,
      clearanceLabel: "limited",
    },
    timestamp: 10,
    notes: ["Breakout through outermost resistance."],
  });
  await waitForAsyncWork();
  await waitForAsyncWork();

  const aiPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "ai_signal_commentary",
  );
  assert.equal(aiPosts.length, 1);
  assert.equal(aiPosts[0]?.threadId, "thread-ALBT");
  assert.equal(aiPosts[0]?.payload.title, "ALBT AI read");
  assert.match(aiPosts[0]?.payload.body ?? "", /AI says buyers need acceptance above resistance/);
  assert.equal(aiPosts[0]?.payload.metadata?.aiGenerated, true);
});

test("ManualWatchlistRuntimeManager rate-limits AI signal commentary per symbol", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  let aiCalls = 0;
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    aiCommentaryService: {
      async explainSignal() {
        aiCalls += 1;
        return {
          text: "AI says buyers need acceptance above resistance before trusting continuation.",
          model: "test-model",
        };
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  const alert = {
    symbol: "ALBT",
    event: {
      symbol: "ALBT",
      eventType: "breakout",
      timestamp: 1000,
    },
    severity: "high",
    confidence: "high",
    score: 75,
  };
  const deterministicPayload = {
    title: "ALBT breakout",
    body: "Price is above resistance for now.",
    symbol: "ALBT",
    timestamp: 1000,
    metadata: {
      messageKind: "intelligent_alert",
    },
  };

  await (manager as any).maybePostSignalCommentaryWithAI({
    threadId: "thread-ALBT",
    alert,
    deterministicPayload,
  });
  await (manager as any).maybePostSignalCommentaryWithAI({
    threadId: "thread-ALBT",
    alert: {
      ...alert,
      event: {
        ...alert.event,
        timestamp: 2000,
      },
    },
    deterministicPayload: {
      ...deterministicPayload,
      timestamp: 2000,
    },
  });

  assert.equal(aiCalls, 1);
  assert.equal(
    discordAlertRouter.routed.filter(
      (entry) => entry.payload.metadata?.messageKind === "ai_signal_commentary",
    ).length,
    1,
  );
});

test("ManualWatchlistRuntimeManager keeps reactive AI reads out of live threads", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  let aiCalls = 0;
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    aiCommentaryService: {
      async explainSignal() {
        aiCalls += 1;
        return {
          text: "AI says watch the reaction.",
          model: "test-model",
        };
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  await (manager as any).maybePostSignalCommentaryWithAI({
    threadId: "thread-ALBT",
    alert: {
      symbol: "ALBT",
      event: {
        symbol: "ALBT",
        eventType: "level_touch",
        level: 2.45,
        timestamp: 1000,
      },
      severity: "high",
      confidence: "high",
      score: 75,
    },
    deterministicPayload: {
      title: "ALBT level touch",
      body: "Price is testing resistance.",
      symbol: "ALBT",
      timestamp: 1000,
      metadata: {
        messageKind: "intelligent_alert",
      },
    },
  });

  assert.equal(aiCalls, 0);
  assert.equal(
    discordAlertRouter.routed.filter(
      (entry) => entry.payload.metadata?.messageKind === "ai_signal_commentary",
    ).length,
    0,
  );
});

test("ManualWatchlistRuntimeManager posts follow-through updates when evaluations complete", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 1,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [],
          summary: {
            totalEvaluated: 1,
            expectancy: 2.38,
            rollingExpectancy: { expectancy: 2.38 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 1,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          progressUpdates: [],
          completedEvaluations: [
            {
              symbol: "ALBT",
              timestamp: 10,
              evaluatedAt: 20,
              entryPrice: 2.52,
              outcomePrice: 2.58,
              returnPct: 2.38,
              directionalReturnPct: 2.38,
              followThroughLabel: "strong",
              success: true,
              eventType: "breakout",
            },
          ],
        };
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    levelTouchSupersedeDelayMs: 0,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    lastPrice: 2.58,
    timestamp: 20,
  });
  await waitForAsyncWork();

  const followThroughPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "follow_through_update",
  );
  assert.equal(followThroughPosts.length, 1);
  assert.equal(followThroughPosts[0]?.payload.title, "ALBT breakout follow-through");
  assert.equal(
    followThroughPosts[0]?.payload.body,
    [
      "The move is holding up well.",
      "",
      "What changed:",
      "- breakout stayed strong",
      "- price change from trigger: +2.38%",
      "",
      "Level to watch closely:",
      "- breakout has expanded from 2.52; that level should keep holding for the move to stay clean.",
      "",
      "Path:",
      "- 2.52 -> 2.58 (+2.38% price move)",
    ].join("\n"),
  );
  assert.doesNotMatch(
    followThroughPosts[0]?.payload.body ?? "",
    /Status:|Signal:|Decision area|setup update|state recap|setup move|alert direction|after the alert/,
  );
  assert.equal(followThroughPosts[0]?.payload.metadata?.messageKind, "follow_through_update");
  assert.equal(followThroughPosts[0]?.payload.metadata?.followThroughLabel, "strong");
});

test("ManualWatchlistRuntimeManager suppresses repeated follow-through on the same runner level", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  const firstEvaluation = {
    symbol: "ALBT",
    timestamp: 1000,
    evaluatedAt: 2000,
    entryPrice: 2.45,
    outcomePrice: 2.42,
    returnPct: -1.22,
    directionalReturnPct: -1.22,
    followThroughLabel: "failed",
    success: false,
    eventType: "breakout",
  };
  const secondEvaluation = {
    ...firstEvaluation,
    timestamp: 3000,
    evaluatedAt: 4000,
    outcomePrice: 2.41,
    returnPct: -1.63,
    directionalReturnPct: -1.63,
  };
  const afterCooldownEvaluation = {
    ...firstEvaluation,
    timestamp: 310000,
    evaluatedAt: 310000,
    outcomePrice: 2.37,
    returnPct: -3.27,
    directionalReturnPct: -3.27,
  };

  assert.equal((manager as any).postFollowThroughUpdate(firstEvaluation), true);
  assert.equal((manager as any).postFollowThroughUpdate(secondEvaluation), false);
  assert.equal((manager as any).postFollowThroughUpdate(afterCooldownEvaluation), true);
  await waitForAsyncWork();

  const followThroughPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "follow_through_update",
  );
  assert.equal(followThroughPosts.length, 2);
  assert.match(followThroughPosts[0]?.payload.body ?? "", /2\.45 -> 2\.42/);
  assert.match(followThroughPosts[1]?.payload.body ?? "", /2\.45 -> 2\.37/);
});

test("ManualWatchlistRuntimeManager suppresses near-duplicate alert posts for the same structural state", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const lifecycleEvents: ManualWatchlistLifecycleEvent[] = [];
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    lifecycleListener: (event) => {
      lifecycleEvents.push(event);
    },
    levelTouchSupersedeDelayMs: 0,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });

  const duplicateBaseEvent = {
    episodeId: "evt-dup-episode",
    symbol: "ALBT",
    type: "level_touch" as const,
    eventType: "level_touch" as const,
    zoneId: "ALBT-resistance-monitored-1",
    zoneKind: "resistance" as const,
    level: 2.45,
    triggerPrice: 2.48,
    strength: 0.74,
    confidence: 0.7,
    priority: 74,
    bias: "bullish" as const,
    pressureScore: 0.6,
    eventContext: {
      monitoredZoneId: "ALBT-resistance-monitored-1",
      canonicalZoneId: "R1",
      zoneFreshness: "fresh" as const,
      zoneOrigin: "canonical" as const,
      remapStatus: "preserved" as const,
      remappedFromZoneIds: ["ALBT-resistance-monitored-legacy"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost" as const,
      zoneStrengthLabel: "strong" as const,
      sourceGeneratedAt: 1,
    },
    notes: ["Repeated outermost touch."],
  };

  monitor.listener?.({
    id: "evt-dup-1",
    timestamp: 100,
    ...duplicateBaseEvent,
  });
  await waitForAsyncWork();
  monitor.listener?.({
    id: "evt-dup-2",
    timestamp: 140,
    ...duplicateBaseEvent,
  });
  await waitForAsyncWork();

  const intelligentAlerts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "intelligent_alert" || !entry.payload.metadata?.messageKind,
  );
  assert.equal(intelligentAlerts.length, 1);
  assert.equal(
    lifecycleEvents.some(
      (event) =>
        event.event === "alert_posted" &&
        event.symbol === "ALBT" &&
        event.details?.eventType === "level_touch" &&
        event.details?.family === "zone_context",
    ),
    true,
  );
  assert.equal(
    lifecycleEvents.some(
      (event) =>
        event.event === "alert_suppressed" &&
        event.symbol === "ALBT" &&
        event.details?.reason === "duplicate_context" &&
        event.details?.family === "zone_context",
    ),
    true,
  );
});

test("ManualWatchlistRuntimeManager emits deterministic trader-facing interpretation once and suppresses repeat spam", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new OpportunityRuntimeController(),
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    levelTouchSupersedeDelayMs: 0,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });

  const baseEvent = {
    episodeId: "evt-interpret-episode",
    symbol: "ALBT",
    type: "breakout" as const,
    eventType: "breakout" as const,
    zoneId: "ALBT-resistance-monitored-1",
    zoneKind: "resistance" as const,
    level: 2.45,
    triggerPrice: 2.52,
    strength: 0.82,
    confidence: 0.79,
    priority: 86,
    bias: "bullish" as const,
    pressureScore: 0.71,
    eventContext: {
      monitoredZoneId: "ALBT-resistance-monitored-1",
      canonicalZoneId: "R1",
      zoneFreshness: "fresh" as const,
      zoneOrigin: "canonical" as const,
      remapStatus: "preserved" as const,
      remappedFromZoneIds: ["ALBT-resistance-monitored-legacy"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost" as const,
      zoneStrengthLabel: "strong" as const,
      sourceGeneratedAt: 1,
    },
    notes: ["Breakout through outermost resistance."],
  };

  monitor.listener?.({
    id: "evt-interpret-1",
    timestamp: 10,
    ...baseEvent,
  });
  await waitForAsyncWork();

  monitor.listener?.({
    id: "evt-interpret-2",
    timestamp: 40,
    ...baseEvent,
  });
  await waitForAsyncWork();

  const continuityPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "continuity_update",
  );
  assert.equal(continuityPosts.length, 0);
});

test("ManualWatchlistRuntimeManager keeps reactive level-touch continuity to one live optional update", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  let callCount = 0;
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        callCount += 1;
        return {
          ranked: [],
          adapted: [],
          top: [
            {
              symbol: "ALBT",
              type: "level_touch",
              eventType: "level_touch",
              level: 2.45,
              classification: "high_conviction",
              clearanceLabel: "limited",
              pathQualityLabel: "layered",
              exhaustionLabel: "worn",
            },
          ],
          interpretations: [
            {
              symbol: "ALBT",
              type: callCount === 1 ? "in_zone" : "confirmation",
              eventType: "level_touch",
              message:
                callCount === 1
                  ? "price testing support near 2.45 - watching reaction"
                  : "buyers reacting at support near 2.45",
              confidence: 0.86,
              tags: [],
              timestamp: callCount * 10,
            },
          ],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return null;
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  const baseEvent = {
    symbol: "ALBT",
    type: "level_touch" as const,
    eventType: "level_touch" as const,
    zoneId: "ALBT-support-monitored-1",
    zoneKind: "support" as const,
    level: 2.45,
    triggerPrice: 2.44,
    strength: 0.82,
    confidence: 0.79,
    priority: 86,
    bias: "bullish" as const,
    pressureScore: 0.71,
    eventContext: {
      monitoredZoneId: "ALBT-support-monitored-1",
      canonicalZoneId: "S1",
      zoneFreshness: "fresh" as const,
      zoneOrigin: "canonical" as const,
      remapStatus: "preserved" as const,
      remappedFromZoneIds: ["ALBT-support-monitored-legacy"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost" as const,
      zoneStrengthLabel: "strong" as const,
      sourceGeneratedAt: 1,
    },
    notes: ["Support touch near outermost support."],
  };

  monitor.listener?.({
    id: "evt-touch-1",
    episodeId: "evt-touch-episode",
    timestamp: 10,
    ...baseEvent,
  });
  await waitForAsyncWork();

  monitor.listener?.({
    id: "evt-touch-2",
    episodeId: "evt-touch-episode",
    timestamp: 20,
    ...baseEvent,
  });
  await waitForAsyncWork();

  const continuityPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "continuity_update",
  );
  assert.equal(continuityPosts.length, 1);
  assert.equal(continuityPosts[0]?.payload.metadata?.continuityType, "confirmation");
});

test("ManualWatchlistRuntimeManager holds optional directional continuity immediately after a fresh alert", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  let callCount = 0;
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        callCount += 1;
        return {
          ranked: [],
          adapted: [],
          top: [
            {
              symbol: "ALBT",
              type: "breakout",
              eventType: "breakout",
              level: 2.45,
              classification: "high_conviction",
              clearanceLabel: "open",
              pathQualityLabel: "clean",
              exhaustionLabel: "fresh",
            },
          ],
          interpretations: [
            {
              symbol: "ALBT",
              type: callCount === 1 ? "pre_zone" : "confirmation",
              eventType: "breakout",
              message:
                callCount === 1
                  ? "watching pullback into support near 2.45"
                  : "buyers reacting at support near 2.45",
              confidence: 0.86,
              tags: [],
              timestamp: callCount * 10,
            },
          ],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return null;
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  const baseEvent = {
    symbol: "ALBT",
    type: "breakout" as const,
    eventType: "breakout" as const,
    zoneId: "ALBT-resistance-monitored-1",
    zoneKind: "resistance" as const,
    level: 2.45,
    triggerPrice: 2.52,
    strength: 0.82,
    confidence: 0.79,
    priority: 86,
    bias: "bullish" as const,
    pressureScore: 0.71,
    eventContext: {
      monitoredZoneId: "ALBT-resistance-monitored-1",
      canonicalZoneId: "R1",
      zoneFreshness: "fresh" as const,
      zoneOrigin: "canonical" as const,
      remapStatus: "preserved" as const,
      remappedFromZoneIds: ["ALBT-resistance-monitored-legacy"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost" as const,
      zoneStrengthLabel: "strong" as const,
      sourceGeneratedAt: 1,
    },
    notes: ["Breakout through outermost resistance."],
  };

  monitor.listener?.({
    id: "evt-breakout-1",
    episodeId: "evt-breakout-episode",
    timestamp: 10,
    ...baseEvent,
  });
  await waitForAsyncWork();

  monitor.listener?.({
    id: "evt-breakout-2",
    episodeId: "evt-breakout-episode",
    timestamp: 20,
    ...baseEvent,
  });
  await waitForAsyncWork();

  const continuityPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "continuity_update",
  );
  assert.equal(continuityPosts.length, 0);
});

test("ManualWatchlistRuntimeManager holds fragile rejection continuity immediately after a fresh alert", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  let callCount = 0;
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        callCount += 1;
        return {
          ranked: [],
          adapted: [],
          top: [
            {
              symbol: "ALBT",
              type: "rejection",
              eventType: "rejection",
              level: 2.45,
              classification: "medium",
              clearanceLabel: "limited",
              pathQualityLabel: "layered",
              exhaustionLabel: "tested",
            },
          ],
          interpretations: [
            {
              symbol: "ALBT",
              type: callCount === 1 ? "pre_zone" : "confirmation",
              eventType: "rejection",
              message:
                callCount === 1
                  ? "sellers are leaning on resistance near 2.45"
                  : "rejection is trying to hold under 2.45",
              confidence: 0.74,
              tags: [],
              timestamp: callCount * 10,
            },
          ],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return null;
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  const baseEvent = {
    symbol: "ALBT",
    type: "rejection" as const,
    eventType: "rejection" as const,
    zoneId: "ALBT-resistance-monitored-1",
    zoneKind: "resistance" as const,
    level: 2.45,
    triggerPrice: 2.43,
    strength: 0.73,
    confidence: 0.69,
    priority: 74,
    bias: "bearish" as const,
    pressureScore: 0.62,
    eventContext: {
      monitoredZoneId: "ALBT-resistance-monitored-1",
      canonicalZoneId: "R1",
      zoneFreshness: "fresh" as const,
      zoneOrigin: "canonical" as const,
      remapStatus: "preserved" as const,
      remappedFromZoneIds: ["ALBT-resistance-monitored-legacy"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost" as const,
      zoneStrengthLabel: "strong" as const,
      sourceGeneratedAt: 1,
    },
    notes: ["Rejection under resistance."],
  };

  monitor.listener?.({
    id: "evt-rejection-1",
    episodeId: "evt-rejection-episode",
    timestamp: 10,
    ...baseEvent,
  });
  await waitForAsyncWork();

  monitor.listener?.({
    id: "evt-rejection-2",
    episodeId: "evt-rejection-episode",
    timestamp: 20,
    ...baseEvent,
  });
  await waitForAsyncWork();

  const continuityPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "continuity_update",
  );
  assert.equal(continuityPosts.length, 0);
});

test("ManualWatchlistRuntimeManager keeps setup-forming narration out of live recap posts", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        return {
          ranked: [],
          adapted: [],
          top: [
            {
              symbol: "ALBT",
              type: "breakout",
              eventType: "breakout",
              level: 2.45,
              classification: "high_conviction",
              clearanceLabel: "limited",
              pathQualityLabel: "clean",
              exhaustionLabel: "fresh",
            },
          ],
          interpretations: [
            {
              symbol: "ALBT",
              type: "pre_zone",
              eventType: "breakout",
              message: "watching pullback into support near 2.45",
              confidence: 0.82,
              tags: [],
              timestamp: 10,
            },
          ],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return null;
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.listener?.({
    id: "evt-recap-pre-zone",
    episodeId: "evt-recap-pre-zone-episode",
    symbol: "ALBT",
    type: "breakout",
    eventType: "breakout",
    zoneId: "ALBT-resistance-monitored-1",
    zoneKind: "resistance",
    level: 2.45,
    triggerPrice: 2.52,
    strength: 0.82,
    confidence: 0.79,
    priority: 86,
    bias: "bullish",
    pressureScore: 0.71,
    eventContext: {
      monitoredZoneId: "ALBT-resistance-monitored-1",
      canonicalZoneId: "R1",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "preserved",
      remappedFromZoneIds: ["ALBT-resistance-monitored-legacy"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost",
      zoneStrengthLabel: "strong",
      sourceGeneratedAt: 1,
    },
    timestamp: 10,
    notes: ["Breakout through outermost resistance."],
  });
  await waitForAsyncWork();

  const recapPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "symbol_recap",
  );
  assert.equal(recapPosts.length, 0);
});

test("ManualWatchlistRuntimeManager suppresses symbol recaps right after story-critical posts", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;
  (manager as any).recordStoryCriticalAttempt({
    symbol: "ALBT",
    timestamp: 1000,
    kind: "intelligent_alert",
  });
  (manager as any).maybePostSymbolRecap({
    symbol: "ALBT",
    timestamp: 2000,
    snapshot: {
      top: [
        {
          symbol: "ALBT",
          type: "breakout",
          eventType: "breakout",
          level: 2.45,
          classification: "high_conviction",
          clearanceLabel: "open",
          pathQualityLabel: "clean",
          exhaustionLabel: "fresh",
        },
      ],
    },
    evaluation: {
      symbol: "ALBT",
      timestamp: 1000,
      evaluatedAt: 2000,
      entryPrice: 2.45,
      outcomePrice: 2.43,
      returnPct: -0.82,
      directionalReturnPct: -0.82,
      followThroughLabel: "failed",
      success: false,
      eventType: "breakout",
    },
  });
  await waitForAsyncWork();

  assert.equal(
    discordAlertRouter.routed.filter(
      (entry) => entry.payload.metadata?.messageKind === "symbol_recap",
    ).length,
    0,
  );
});

test("ManualWatchlistRuntimeManager collapses same-window narration bursts into a smaller set of live posts", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        return {
          ranked: [],
          adapted: [],
          top: [
            {
              symbol: "ALBT",
              type: "breakout",
              eventType: "breakout",
              level: 2.45,
              classification: "medium",
              clearanceLabel: "limited",
              pathQualityLabel: "layered",
              exhaustionLabel: "tested",
            },
          ],
          interpretations: [],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return {
          ranked: [],
          adapted: [],
          top: [
            {
              symbol: "ALBT",
              type: "breakout",
              eventType: "breakout",
              level: 2.45,
              classification: "medium",
              clearanceLabel: "limited",
              pathQualityLabel: "layered",
              exhaustionLabel: "tested",
            },
          ],
          interpretations: [
            {
              symbol: "ALBT",
              type: "confirmation",
              eventType: "breakout",
              message: "buyers are trying to hold above 2.45",
              confidence: 0.75,
              tags: [],
              timestamp: 1000,
            },
          ],
          summary: {
            totalEvaluated: 1,
            expectancy: 0.4,
            rollingExpectancy: { expectancy: 0.4 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [
            {
              symbol: "ALBT",
              timestamp: 900,
              evaluatedAt: 1000,
              entryPrice: 2.45,
              outcomePrice: 2.49,
              returnPct: 1.63,
              directionalReturnPct: 1.63,
              followThroughLabel: "working",
              success: true,
              eventType: "breakout",
            },
          ],
          progressUpdates: [
            {
              symbol: "ALBT",
              timestamp: 1000,
              eventType: "breakout",
              progressLabel: "stalling",
              directionalReturnPct: 0,
              entryPrice: 2.45,
              currentPrice: 2.45,
            },
          ],
        };
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 2.45,
  });
  await waitForAsyncWork();

  const messageKinds = discordAlertRouter.routed.map((entry) => entry.payload.metadata?.messageKind);
  assert.equal(messageKinds.length, 1);
  assert.ok(messageKinds.includes("follow_through_update"));
  assert.ok(!messageKinds.includes("follow_through_state_update"));
  assert.ok(!messageKinds.includes("continuity_update"));
  assert.ok(!messageKinds.includes("symbol_recap"));
  const visibleThreadText = discordAlertRouter.routed
    .map((entry) => `${entry.payload.title}\n${entry.payload.body}`)
    .join("\n\n");
  assert.match(visibleThreadText, /The move is still holding up/);
  assert.doesNotMatch(visibleThreadText, /is stalling and needs a better reaction|current read:|what changed\n.*stalling/is);
});

test("ManualWatchlistRuntimeManager lets completed follow-through own the story when progress and evaluation arrive together", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [],
          summary: {
            totalEvaluated: 1,
            expectancy: -0.3,
            rollingExpectancy: { expectancy: -0.3 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [
            {
              symbol: "ALBT",
              timestamp: 990,
              evaluatedAt: 1000,
              entryPrice: 2.45,
              outcomePrice: 2.41,
              returnPct: -1.63,
              directionalReturnPct: -1.63,
              followThroughLabel: "failed",
              success: false,
              eventType: "breakout",
            },
          ],
          progressUpdates: [
            {
              symbol: "ALBT",
              timestamp: 1000,
              eventType: "breakout",
              progressLabel: "stalling",
              directionalReturnPct: 0,
              entryPrice: 2.45,
              currentPrice: 2.45,
            },
          ],
        };
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 2.43,
  });
  await waitForAsyncWork();

  const messageKinds = discordAlertRouter.routed.map((entry) => entry.payload.metadata?.messageKind);
  assert.equal(messageKinds.includes("follow_through_update"), true);
  assert.equal(messageKinds.includes("follow_through_state_update"), false);
  assert.equal(messageKinds.includes("continuity_update"), false);
});

test("ManualWatchlistRuntimeManager lets failed breakouts suppress stale same-level touch follow-through", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [],
          summary: {
            totalEvaluated: 2,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [
            {
              symbol: "ALBT",
              timestamp: 900,
              evaluatedAt: 1000,
              entryPrice: 2.91,
              outcomePrice: 2.88,
              returnPct: -1.03,
              directionalReturnPct: -1.03,
              followThroughLabel: "failed",
              success: false,
              eventType: "breakout",
            },
            {
              symbol: "ALBT",
              timestamp: 880,
              evaluatedAt: 1000,
              entryPrice: 2.90,
              outcomePrice: 2.91,
              returnPct: 0.34,
              directionalReturnPct: 0.34,
              followThroughLabel: "working",
              success: true,
              eventType: "level_touch",
            },
          ],
          progressUpdates: [],
        };
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.9,
            zoneHigh: 2.91,
            representativePrice: 2.9,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 2.88,
  });
  await waitForAsyncWork();

  const followThroughPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "follow_through_update",
  );
  assert.equal(followThroughPosts.length, 1);
  assert.equal(followThroughPosts[0]?.payload.metadata?.eventType, "breakout");
  assert.match(followThroughPosts[0]?.payload.body ?? "", /breakout failed/);
});

test("ManualWatchlistRuntimeManager keeps price-update interpretations in operator logs when progress updates already own the live story", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return {
          ranked: [],
          adapted: [],
          top: [
            {
              symbol: "ALBT",
              type: "breakout",
              eventType: "breakout",
              zoneKind: "resistance",
              level: 2.45,
              classification: "medium",
              clearanceLabel: "limited",
              pathQualityLabel: "layered",
              exhaustionLabel: "tested",
            },
          ],
          interpretations: [
            {
              symbol: "ALBT",
              type: "pre_zone",
              eventType: "breakout",
              message: "watching pullback into resistance near 2.45",
              confidence: 0.54,
              tags: [],
              timestamp: 1000,
            },
          ],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [
            {
              symbol: "ALBT",
              timestamp: 1000,
              eventType: "breakout",
              progressLabel: "stalling",
              directionalReturnPct: 0,
              entryPrice: 2.45,
              currentPrice: 2.45,
            },
          ],
        };
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1000,
    lastPrice: 2.45,
  });
  await waitForAsyncWork();

  const messageKinds = discordAlertRouter.routed.map((entry) => entry.payload.metadata?.messageKind);
  assert.equal(messageKinds.includes("follow_through_state_update"), false);
  assert.equal(messageKinds.includes("continuity_update"), false);
});

test("ManualWatchlistRuntimeManager suppresses setup-forming continuity immediately after a fresh trader-critical alert", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [
            {
              symbol: "ALBT",
              type: "pre_zone",
              eventType: "level_touch",
              message: "watching pullback into support near 2.45",
              confidence: 0.82,
              tags: [],
              timestamp: 20,
            },
          ],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    levelTouchSupersedeDelayMs: 0,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.listener?.({
    id: "evt-alert-first",
    episodeId: "evt-alert-first-episode",
    symbol: "ALBT",
    type: "level_touch",
    eventType: "level_touch",
    zoneId: "ALBT-support-monitored-1",
    zoneKind: "support",
    level: 2.45,
    triggerPrice: 2.44,
    strength: 0.82,
    confidence: 0.79,
    priority: 86,
    bias: "bullish",
    pressureScore: 0.71,
    eventContext: {
      monitoredZoneId: "ALBT-support-monitored-1",
      canonicalZoneId: "S1",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "preserved",
      remappedFromZoneIds: ["ALBT-support-monitored-legacy"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost",
      zoneStrengthLabel: "strong",
      sourceGeneratedAt: 1,
    },
    notes: ["Support touch near outermost support."],
    timestamp: 10,
  });

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 20,
    lastPrice: 2.44,
  });
  await waitForAsyncWork();

  const continuityPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "continuity_update",
  );
  const alertPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "intelligent_alert",
  );

  assert.equal(alertPosts.length, 1);
  assert.equal(continuityPosts.length, 0);
});

test("ManualWatchlistRuntimeManager does not post level-touch state before delayed alert posts", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
          newOpportunity: true,
        };
      },
      processPriceUpdate() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [
            {
              symbol: "ALBT",
              eventType: "level_touch",
              timestamp: 20,
              entryPrice: 2.45,
              currentPrice: 2.45,
              directionalReturnPct: 0,
              progressLabel: "stalling",
            },
          ],
        };
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    levelTouchSupersedeDelayMs: 25,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.listener?.({
    id: "evt-delayed-touch",
    episodeId: "evt-delayed-touch-episode",
    symbol: "ALBT",
    type: "level_touch",
    eventType: "level_touch",
    zoneId: "ALBT-support-monitored-1",
    zoneKind: "support",
    level: 2.45,
    triggerPrice: 2.44,
    strength: 0.82,
    confidence: 0.79,
    priority: 86,
    bias: "bullish",
    pressureScore: 0.71,
    eventContext: {
      monitoredZoneId: "ALBT-support-monitored-1",
      canonicalZoneId: "S1",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "preserved",
      remappedFromZoneIds: ["ALBT-support-monitored-legacy"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost",
      zoneStrengthLabel: "strong",
      sourceGeneratedAt: 1,
    },
    notes: ["Support touch near outermost support."],
    timestamp: 10,
  });

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 20,
    lastPrice: 2.45,
  });
  await waitForAsyncWork();

  assert.equal(
    discordAlertRouter.routed.some(
      (entry) => entry.payload.metadata?.messageKind === "follow_through_state_update",
    ),
    false,
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(
    discordAlertRouter.routed.filter(
      (entry) => entry.payload.metadata?.messageKind === "intelligent_alert",
    ).length,
    1,
  );
  assert.equal(
    discordAlertRouter.routed.some(
      (entry) => entry.payload.metadata?.messageKind === "follow_through_state_update",
    ),
    false,
  );
});

test("ManualWatchlistRuntimeManager keeps reactive same-event narration out of Discord when it is only stalling", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [
            {
              symbol: "ALBT",
              type: "in_zone",
              eventType: "level_touch",
              level: 2.45,
              zoneKind: "support",
              message: "price testing support near 2.45 - watching reaction",
              confidence: 0.78,
              tags: [],
              timestamp: 10,
            },
          ],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [
            {
              symbol: "ALBT",
              timestamp: 20,
              eventType: "level_touch",
              progressLabel: "stalling",
              directionalReturnPct: 0,
              entryPrice: 2.45,
              currentPrice: 2.45,
            },
          ],
        };
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.listener?.({
    id: "evt-reactive-single-optional",
    episodeId: "evt-reactive-single-optional-episode",
    symbol: "ALBT",
    type: "level_touch",
    eventType: "level_touch",
    zoneId: "ALBT-support-monitored-1",
    zoneKind: "support",
    level: 2.45,
    triggerPrice: 2.44,
    strength: 0.42,
    confidence: 0.38,
    priority: 28,
    bias: "bullish",
    pressureScore: 0.22,
    eventContext: {
      monitoredZoneId: "ALBT-support-monitored-1",
      canonicalZoneId: "S1",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "preserved",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "inner",
      zoneStrengthLabel: "strong",
      sourceGeneratedAt: 1,
    },
    notes: ["Reactive support touch used to stack optional narration."],
    timestamp: 10,
  });
  await waitForAsyncWork();

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 20,
    lastPrice: 2.45,
  });
  await waitForAsyncWork();

  const optionalKinds = discordAlertRouter.routed
    .map((entry) => entry.payload.metadata?.messageKind)
    .filter((kind) => kind === "continuity_update" || kind === "follow_through_state_update");

  assert.deepEqual(optionalKinds, []);
});

test("ManualWatchlistRuntimeManager blocks reactive same-event optional overlap even while routing is settling", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new DelayedAlertDiscordAlertRouter(30);
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [
            {
              symbol: "ALBT",
              type: "in_zone",
              eventType: "level_touch",
              level: 2.45,
              zoneKind: "support",
              message: "price testing support near 2.45 - watching reaction",
              confidence: 0.78,
              tags: [],
              timestamp: 10,
            },
          ],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [
            {
              symbol: "ALBT",
              timestamp: 20,
              eventType: "level_touch",
              progressLabel: "stalling",
              directionalReturnPct: 0,
              entryPrice: 2.45,
              currentPrice: 2.45,
            },
          ],
        };
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.listener?.({
    id: "evt-reactive-overlap-inflight",
    episodeId: "evt-reactive-overlap-inflight-episode",
    symbol: "ALBT",
    type: "level_touch",
    eventType: "level_touch",
    zoneId: "ALBT-support-monitored-1",
    zoneKind: "support",
    level: 2.45,
    triggerPrice: 2.44,
    strength: 0.42,
    confidence: 0.38,
    priority: 28,
    bias: "bullish",
    pressureScore: 0.22,
    eventContext: {
      monitoredZoneId: "ALBT-support-monitored-1",
      canonicalZoneId: "S1",
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "preserved",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "inner",
      zoneStrengthLabel: "strong",
      sourceGeneratedAt: 1,
    },
    notes: ["Reactive support touch used for in-flight overlap coverage."],
    timestamp: 10,
  });

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 20,
    lastPrice: 2.45,
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  await waitForAsyncWork();

  const optionalKinds = discordAlertRouter.routed
    .map((entry) => entry.payload.metadata?.messageKind)
    .filter((kind) => kind === "continuity_update" || kind === "follow_through_state_update");

  assert.deepEqual(optionalKinds, []);
});

test("ManualWatchlistRuntimeManager only posts continuity that matches the triggering event side", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [
            {
              symbol: "ALBT",
              type: "in_zone",
              eventType: "level_touch",
              level: 5.25,
              zoneKind: "support",
              message: "price testing support near 5.25 - watching reaction",
              confidence: 0.78,
              tags: [],
              timestamp: 10,
            },
            {
              symbol: "ALBT",
              type: "in_zone",
              eventType: "level_touch",
              level: 5.25,
              zoneKind: "resistance",
              message: "price testing resistance near 5.25 - watching reaction",
              confidence: 0.78,
              tags: [],
              timestamp: 10,
            },
          ],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return null;
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 5.2,
            zoneHigh: 5.25,
            representativePrice: 5.25,
            strengthLabel: "moderate",
            strengthScore: 18,
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 5.2,
            zoneHigh: 5.25,
            representativePrice: 5.25,
            strengthLabel: "moderate",
            strengthScore: 18,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.listener?.({
    id: "evt-side-match",
    episodeId: "evt-side-match-episode",
    symbol: "ALBT",
    type: "level_touch",
    eventType: "level_touch",
    zoneId: "ALBT-resistance-monitored-1",
    zoneKind: "resistance",
    level: 5.25,
    triggerPrice: 5.25,
    strength: 0.18,
    confidence: 0.22,
    priority: 14,
    bias: "bearish",
    pressureScore: 0.08,
    eventContext: {
      monitoredZoneId: "ALBT-resistance-monitored-1",
      canonicalZoneId: "R1",
      zoneFreshness: "stale",
      zoneOrigin: "canonical",
      remapStatus: "preserved",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: false,
      ladderPosition: "inner",
      zoneStrengthLabel: "moderate",
      sourceGeneratedAt: 1,
    },
    notes: ["Weak resistance touch for continuity-side regression coverage."],
    timestamp: 10,
  });
  await waitForAsyncWork();

  const continuityPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "continuity_update",
  );

  assert.equal(continuityPosts.length, 0);
});

test("ManualWatchlistRuntimeManager collapses same-label continuity updates that arrive before the first route resolves", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        return {
          ranked: [],
          adapted: [],
          top: [
            {
              symbol: "ALBT",
              type: "breakout",
              eventType: "breakout",
              level: 2.45,
              classification: "high_conviction",
              clearanceLabel: "open",
              pathQualityLabel: "clean",
              exhaustionLabel: "fresh",
            },
          ],
          interpretations: [
            {
              symbol: "ALBT",
              type: "breakout_context",
              eventType: "breakout",
              message: "breakout holding above 2.45",
              confidence: 0.84,
              tags: [],
              timestamp: 10,
            },
          ],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return null;
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  const baseEvent = {
    symbol: "ALBT",
    type: "breakout" as const,
    eventType: "breakout" as const,
    zoneId: "ALBT-resistance-monitored-1",
    zoneKind: "resistance" as const,
    level: 2.45,
    triggerPrice: 2.52,
    strength: 0.82,
    confidence: 0.79,
    priority: 86,
    bias: "bullish" as const,
    pressureScore: 0.71,
    eventContext: {
      monitoredZoneId: "ALBT-resistance-monitored-1",
      canonicalZoneId: "R1",
      zoneFreshness: "fresh" as const,
      zoneOrigin: "canonical" as const,
      remapStatus: "preserved" as const,
      remappedFromZoneIds: ["ALBT-resistance-monitored-legacy"],
      dataQualityDegraded: false,
      recentlyRefreshed: true,
      recentlyPromotedExtension: false,
      ladderPosition: "outermost" as const,
      zoneStrengthLabel: "strong" as const,
      sourceGeneratedAt: 1,
    },
    notes: ["Breakout through outermost resistance."],
  };

  monitor.listener?.({
    id: "evt-continuity-dupe-1",
    episodeId: "evt-continuity-dupe-episode",
    timestamp: 10,
    ...baseEvent,
  });
  monitor.listener?.({
    id: "evt-continuity-dupe-2",
    episodeId: "evt-continuity-dupe-episode",
    timestamp: 11,
    ...baseEvent,
  });
  await waitForAsyncWork();

  const continuityPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "continuity_update",
  );

  assert.equal(continuityPosts.length, 0);
});

test("ManualWatchlistRuntimeManager suppresses repeated continuity wording after the label cycles", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({ id: "R1", symbol, kind: "resistance" }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  const postContinuity = (manager as any).postContinuityUpdate.bind(manager);
  postContinuity({
    symbol: "ALBT",
    timestamp: 1000,
    continuityType: "confirmation",
    message: "buyers are trying to hold above 2.45; the setup is now moving into confirmation and needs acceptance to hold.",
    eventType: "breakout",
  });
  postContinuity({
    symbol: "ALBT",
    timestamp: 2000,
    continuityType: "failed",
    message: "breakout failed, so the setup should be treated as failed until a new setup forms.",
    eventType: "breakout",
  });
  postContinuity({
    symbol: "ALBT",
    timestamp: 3000,
    continuityType: "confirmation",
    message: "buyers are trying to hold above 2.45; the setup is now moving into confirmation and needs acceptance to hold.",
    eventType: "breakout",
  });
  await waitForAsyncWork();

  const continuityPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "continuity_update",
  );

  assert.equal(continuityPosts.length, 2);
  assert.deepEqual(
    continuityPosts.map((entry) => entry.payload.metadata?.continuityType),
    ["confirmation", "failed"],
  );
});

test("ManualWatchlistRuntimeManager frames breakdown continuity as long-side caution", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const formattingManager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
  });
  const evaluationUpdate = (formattingManager as any).buildContinuityUpdateFromEvaluation({
    symbol: "ALBT",
    timestamp: 10,
    evaluatedAt: 20,
    entryPrice: 2.45,
    outcomePrice: 2.43,
    returnPct: -0.82,
    directionalReturnPct: 0.82,
    followThroughLabel: "working",
    success: true,
    eventType: "breakdown",
  });
  const progressUpdate = (formattingManager as any).buildContinuityUpdateFromProgress({
    symbol: "ALBT",
    eventType: "breakdown",
    timestamp: 20,
    entryPrice: 2.45,
    currentPrice: 2.43,
    directionalReturnPct: 0.82,
    progressLabel: "improving",
  });

  assert.match(evaluationUpdate.message, /breakdown caution stayed active/);
  assert.doesNotMatch(evaluationUpdate.message, /kept working|short/i);
  assert.match(progressUpdate?.message ?? "", /breakdown caution is still active/);
  assert.doesNotMatch(progressUpdate?.message ?? "", /is still improving|short/i);
  return;

  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: {
      processMonitoringEvent() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [],
          summary: {
            totalEvaluated: 0,
            expectancy: 0,
            rollingExpectancy: { expectancy: 0 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [],
          progressUpdates: [],
        };
      },
      processPriceUpdate() {
        return {
          ranked: [],
          adapted: [],
          top: [],
          interpretations: [],
          summary: {
            totalEvaluated: 1,
            expectancy: 0.31,
            rollingExpectancy: { expectancy: 0.31 },
            performanceDrift: { declining: false },
          },
          adaptiveDiagnostics: {
            targetGlobalMultiplier: 1,
            appliedGlobalMultiplier: 1,
            globalConfidence: 0,
            globalDeltaApplied: 0,
            driftDampeningActive: false,
            eventTypes: {},
          },
          completedEvaluations: [
            {
              symbol: "ALBT",
              timestamp: 10,
              evaluatedAt: 20,
              entryPrice: 2.45,
              outcomePrice: 2.43,
              returnPct: -0.82,
              directionalReturnPct: 0.82,
              followThroughLabel: "working",
              success: true,
              eventType: "breakdown",
            },
          ],
          progressUpdates: [],
        };
      },
    } as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support" }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 20,
    lastPrice: 2.43,
  });
  await waitForAsyncWork();

  const continuityPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "continuity_update",
  );
  assert.equal(continuityPosts.length, 1);
  assert.match(continuityPosts[0]?.payload.body ?? "", /breakdown caution stayed active/);
  assert.doesNotMatch(continuityPosts[0]?.payload.body ?? "", /kept working|short/i);
});

test("ManualWatchlistRuntimeManager posts next support levels when price approaches the lowest surfaced support", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 1.95,
            zoneHigh: 2.0,
            representativePrice: 1.98,
          }),
        ],
        extensionLevels: {
          support: [
            buildZone({
              id: "SX1",
              symbol,
              kind: "support",
              zoneLow: 1.7,
              zoneHigh: 1.75,
              representativePrice: 1.72,
              isExtension: true,
            }),
          ],
          resistance: [],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "BIRD" });
  monitor.onPriceUpdate?.({
    symbol: "BIRD",
    timestamp: 1000,
    lastPrice: 1.99,
  });
  await waitForAsyncWork();

  assert.deepEqual(discordAlertRouter.levelExtensions, [
    {
      threadId: "thread-BIRD",
      payload: {
        symbol: "BIRD",
        side: "support",
        levels: [1.72],
        timestamp: 1000,
      },
    },
  ]);
});

test("ManualWatchlistRuntimeManager suppresses duplicate extension bursts when overlapping price updates hit the same boundary", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new DelayedExtensionDiscordAlertRouter(30);
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 1.95,
            zoneHigh: 2.0,
            representativePrice: 1.98,
          }),
        ],
        extensionLevels: {
          support: [
            buildZone({
              id: "SX1",
              symbol,
              kind: "support",
              zoneLow: 1.7,
              zoneHigh: 1.75,
              representativePrice: 1.72,
              isExtension: true,
            }),
          ],
          resistance: [],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "BIRD" });

  monitor.onPriceUpdate?.({
    symbol: "BIRD",
    timestamp: 1000,
    lastPrice: 1.99,
  });
  monitor.onPriceUpdate?.({
    symbol: "BIRD",
    timestamp: 1001,
    lastPrice: 1.991,
  });
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(discordAlertRouter.levelExtensions.length, 1);
  assert.deepEqual(discordAlertRouter.levelExtensions[0], {
    threadId: "thread-BIRD",
    payload: {
      symbol: "BIRD",
      side: "support",
      levels: [1.72],
      timestamp: 1000,
    },
  });
});

test("ManualWatchlistRuntimeManager does not repost an identical extension payload after the cooldown window", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 1.88,
            zoneHigh: 1.9,
            representativePrice: 1.89,
          }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({
              id: "RX1",
              symbol,
              kind: "resistance",
              zoneLow: 1.9,
              zoneHigh: 1.92,
              representativePrice: 1.9044,
              isExtension: true,
            }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "AMST" });

  const firstResult = await (manager as any).postLevelExtension(
    "AMST",
    "thread-AMST",
    "resistance",
    1000,
  );
  const repeatedResult = await (manager as any).postLevelExtension(
    "AMST",
    "thread-AMST",
    "resistance",
    1000 + 6 * 60 * 1000,
  );

  assert.equal(firstResult, "posted");
  assert.equal(repeatedResult, "duplicate");
  assert.equal(discordAlertRouter.levelExtensions.length, 1);
  assert.deepEqual(discordAlertRouter.levelExtensions[0], {
    threadId: "thread-AMST",
    payload: {
      symbol: "AMST",
      side: "resistance",
      levels: [1.9044],
      timestamp: 1000,
    },
  });
});
