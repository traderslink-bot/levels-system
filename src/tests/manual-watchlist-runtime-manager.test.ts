import assert from "node:assert/strict";
import test from "node:test";

import type { DiscordThreadRoutingResult } from "../lib/alerts/alert-types.js";
import { OpportunityRuntimeController } from "../lib/monitoring/opportunity-runtime-controller.js";
import { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import type { ManualWatchlistLifecycleEvent } from "../lib/monitoring/manual-watchlist-runtime-events.js";
import { WatchlistStore } from "../lib/monitoring/watchlist-store.js";
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
  public storedEntries = [
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

class FakeOpportunityRuntimeController {
  processMonitoringEvent() {
    return { newOpportunity: undefined };
  }

  processPriceUpdate() {
    return null;
  }
}

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

  assert.equal(monitor.startCalls.length, 1);
  assert.deepEqual(monitor.startCalls[0], [
    {
      symbol: "BIRD",
      active: true,
      priority: 1,
      tags: ["manual"],
      note: "existing",
      discordThreadId: "thread-bird",
      lifecycle: "active",
      refreshPending: false,
      activatedAt: monitor.startCalls[0]?.[0]?.activatedAt,
      lastLevelPostAt: monitor.startCalls[0]?.[0]?.lastLevelPostAt,
    },
  ]);
  assert.equal(discordAlertRouter.levelSnapshots.length, 1);
  assert.equal(discordAlertRouter.levelSnapshots[0]?.threadId, "thread-bird");
  assert.equal(discordAlertRouter.levelSnapshots[0]?.payload.symbol, "BIRD");
  assert.equal(discordAlertRouter.levelSnapshots[0]?.payload.currentPrice, 2.2);
  assert.deepEqual(discordAlertRouter.levelSnapshots[0]?.payload.supportZones, [
    { representativePrice: 1.95, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  assert.deepEqual(discordAlertRouter.levelSnapshots[0]?.payload.resistanceZones, [
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
  });
  assert.equal(manager.getActiveEntries().length, 0);
  assert.equal(persistence.storedEntries[0]?.discordThreadId, "thread-HUBC");
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

test("ManualWatchlistRuntimeManager refreshes and reposts level snapshot when price approaches the highest posted resistance", async () => {
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

  assert.equal(discordAlertRouter.levelSnapshots.length, 2);
  assert.deepEqual(discordAlertRouter.levelSnapshots[1], {
    threadId: "thread-ALBT",
    payload: {
      symbol: "ALBT",
      currentPrice: 2.46,
      supportZones: [{ representativePrice: 1.95, strengthLabel: "moderate", freshness: "fresh", isExtension: false }],
      resistanceZones: [{ representativePrice: 2.72, strengthLabel: "moderate", freshness: "fresh", isExtension: false }],
      timestamp: 1000,
    },
  });
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
                zoneLow: 2.7,
                zoneHigh: 2.75,
                representativePrice: 2.72,
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
      levels: [2.72],
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

  assert.deepEqual(discordAlertRouter.levelSnapshots.at(-1)?.payload, {
    symbol: "GXAI",
    currentPrice: 1.55,
    supportZones: [
      { representativePrice: 1.33, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    ],
    resistanceZones: [
      { representativePrice: 1.62, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    ],
    timestamp: discordAlertRouter.levelSnapshots.at(-1)?.payload.timestamp,
  });
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

  assert.deepEqual(discordAlertRouter.levelSnapshots.at(-1)?.payload.supportZones, [
    { representativePrice: 1.53, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  assert.deepEqual(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones, [
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

  assert.deepEqual(discordAlertRouter.levelSnapshots.at(-1)?.payload.supportZones, [
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
  assert.deepEqual(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones, [
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

  assert.deepEqual(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones, [
    { representativePrice: 2.62, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 2.74, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
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

  assert.deepEqual(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones, [
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

  assert.deepEqual(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones, [
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

  assert.deepEqual(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones, [
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
  assert.equal(
    intelligentAlerts[0]?.payload.body,
    [
      "bullish breakout through heavy resistance 2.40-2.50",
      "why now: price cleared the outermost resistance instead of stalling underneath it",
      "movement: price is pushing farther above the zone high and follow-through is building (0.8%)",
      "pressure: buyers still have strong control (0.71), backing the move",
      "context: heavy resistance | outermost | fresh | 5m driven | recently refreshed",
      "room: limited overhead into next resistance 2.58 (+2.4%)",
      "target: first resistance objective 2.58 (+2.4%)",
      "trigger quality: clean trigger with early movement, strong control, and limited room",
      "setup state: continuation, so the move has started and now needs follow-through",
      "trade map: risk to invalidation 4.8%; room to next resistance 2.4% (~0.5x, tight skew)",
      "watch: hold above 2.50; invalidates back below 2.40",
      "severity CRITICAL | confidence HIGH | score 111.68",
      "trigger 2.52",
    ].join("\n"),
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
      "follow-through: breakout stayed strong after the alert",
      "status: strong | directional +2.38% | raw +2.38%",
      "path: tracked from 2.52 to 2.58",
    ].join("\n"),
  );
  assert.equal(followThroughPosts[0]?.payload.metadata?.messageKind, "follow_through_update");
  assert.equal(followThroughPosts[0]?.payload.metadata?.followThroughLabel, "strong");
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
  assert.equal(continuityPosts.length, 1);
  assert.equal(continuityPosts[0]?.payload.title, "ALBT setup update");
  assert.equal(continuityPosts[0]?.payload.metadata?.continuityType, "setup_forming");
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
  assert.equal(continuityPosts[0]?.payload.metadata?.continuityType, "setup_forming");
});

test("ManualWatchlistRuntimeManager still allows directional continuity progression when the setup genuinely advances", async () => {
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
  assert.equal(continuityPosts.length, 2);
  assert.equal(continuityPosts[0]?.payload.metadata?.continuityType, "setup_forming");
  assert.equal(continuityPosts[1]?.payload.metadata?.continuityType, "confirmation");
});

test("ManualWatchlistRuntimeManager keeps fragile rejection continuity to one live optional update", async () => {
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
  assert.equal(continuityPosts.length, 1);
  assert.equal(continuityPosts[0]?.payload.metadata?.continuityType, "setup_forming");
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
              outcomePrice: 2.47,
              returnPct: 0.82,
              directionalReturnPct: 0.82,
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
  assert.equal(messageKinds.length, 3);
  assert.ok(messageKinds.includes("continuity_update"));
  assert.ok(messageKinds.includes("follow_through_state_update"));
  assert.ok(!messageKinds.includes("symbol_recap"));
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

  assert.equal(continuityPosts.length, 1);
  assert.equal(continuityPosts[0]?.payload.metadata?.continuityType, "continuation");
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
