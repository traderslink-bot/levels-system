import assert from "node:assert/strict";
import test from "node:test";

import type { DiscordThreadRoutingResult } from "../lib/alerts/alert-types.js";
import { OpportunityRuntimeController } from "../lib/monitoring/opportunity-runtime-controller.js";
import { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import { WatchlistStore } from "../lib/monitoring/watchlist-store.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import {
  CandleFetchService,
  StubHistoricalCandleProvider,
  type HistoricalFetchRequest,
} from "../lib/market-data/candle-fetch-service.js";

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

function representativeZones(zones: Array<{ representativePrice: number }> | undefined) {
  return (zones ?? []).map((zone) => ({
    representativePrice: zone.representativePrice,
  }));
}

function snapshotWithRepresentativeZones(payload: any) {
  return {
    ...payload,
    supportZones: representativeZones(payload?.supportZones),
    resistanceZones: representativeZones(payload?.resistanceZones),
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
        extensionLevels: {
          support: [
            buildZone({
              id: "SX1",
              symbol,
              kind: "support",
              representativePrice: 1.5,
              zoneLow: 1.48,
              zoneHigh: 1.52,
              isExtension: true,
            }),
          ],
          resistance: [],
        },
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
      lastLevelPostAt: monitor.startCalls[0]?.[0]?.lastLevelPostAt,
    },
  ]);
  assert.equal(discordAlertRouter.levelSnapshots.length, 1);
  assert.equal(discordAlertRouter.levelSnapshots[0]?.threadId, "thread-bird");
  assert.equal(discordAlertRouter.levelSnapshots[0]?.payload.symbol, "BIRD");
  assert.equal(discordAlertRouter.levelSnapshots[0]?.payload.currentPrice, 2.2);
  assert.deepEqual(representativeZones(discordAlertRouter.levelSnapshots[0]?.payload.supportZones), [
    { representativePrice: 1.95 },
    { representativePrice: 1.5 },
  ]);
  assert.deepEqual(representativeZones(discordAlertRouter.levelSnapshots[0]?.payload.resistanceZones), [
    { representativePrice: 2.45 },
  ]);
  assert.equal(typeof discordAlertRouter.levelSnapshots[0]?.payload.timestamp, "number");
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
  assert.deepEqual({
    threadId: discordAlertRouter.levelSnapshots[1]?.threadId,
    payload: snapshotWithRepresentativeZones(discordAlertRouter.levelSnapshots[1]?.payload),
  }, {
    threadId: "thread-ALBT",
    payload: {
      symbol: "ALBT",
      currentPrice: 2.46,
      supportZones: [{ representativePrice: 1.95 }],
      resistanceZones: [{ representativePrice: 2.72 }],
      timestamp: 1000,
    },
  });
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

  assert.deepEqual(snapshotWithRepresentativeZones(discordAlertRouter.levelSnapshots.at(-1)?.payload), {
    symbol: "GXAI",
    currentPrice: 1.55,
    supportZones: [
      { representativePrice: 1.33 },
    ],
    resistanceZones: [
      { representativePrice: 1.62 },
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

  assert.deepEqual(representativeZones(discordAlertRouter.levelSnapshots.at(-1)?.payload.supportZones), [
    { representativePrice: 1.53 },
  ]);
  assert.deepEqual(representativeZones(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones), [
    { representativePrice: 1.58 },
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

  assert.deepEqual(representativeZones(discordAlertRouter.levelSnapshots.at(-1)?.payload.supportZones), [
    { representativePrice: 1.431 },
    { representativePrice: 1.36 },
    { representativePrice: 1.33 },
    { representativePrice: 1.3 },
    { representativePrice: 1.28 },
    { representativePrice: 1.251 },
    { representativePrice: 1.221 },
    { representativePrice: 1.17 },
    { representativePrice: 1.11 },
  ]);
  assert.deepEqual(representativeZones(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones), [
    { representativePrice: 1.52 },
    { representativePrice: 1.58 },
    { representativePrice: 1.6 },
    { representativePrice: 1.62 },
    { representativePrice: 1.64 },
    { representativePrice: 1.67 },
    { representativePrice: 1.75 },
    { representativePrice: 1.89 },
    { representativePrice: 2.08 },
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

  assert.deepEqual(representativeZones(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones), [
    { representativePrice: 2.62 },
    { representativePrice: 2.74 },
  ]);
});

test("ManualWatchlistRuntimeManager gives low-priced runners wider forward resistance coverage", async () => {
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

  assert.deepEqual(representativeZones(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones), [
    { representativePrice: 1.47 },
    { representativePrice: 1.53 },
    { representativePrice: 1.58 },
    { representativePrice: 1.72 },
    { representativePrice: 1.84 },
    { representativePrice: 2.05 },
    { representativePrice: 2.2 },
  ]);
});

test("ManualWatchlistRuntimeManager keeps all real resistance levels while bounding synthetic extensions", async () => {
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
          referencePrice: 2.01,
        },
        intradayResistance: [
          buildZone({ id: "R-250", symbol, kind: "resistance", representativePrice: 2.5 }),
          buildZone({ id: "R-340", symbol, kind: "resistance", representativePrice: 3.4 }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({
              id: "RX-345-synthetic-in-range",
              symbol,
              kind: "resistance",
              representativePrice: 3.45,
              isExtension: true,
              extensionMetadata: {
                extensionSource: "synthetic_continuation_map",
              },
            }),
            buildZone({
              id: "RX-360-historical-weak",
              symbol,
              kind: "resistance",
              representativePrice: 3.6,
              strengthLabel: "weak",
              isExtension: true,
              extensionMetadata: {
                extensionSource: "historical_candidate",
              },
            }),
            buildZone({
              id: "RX-380-historical-strong-daily",
              symbol,
              kind: "resistance",
              representativePrice: 3.8,
              strengthLabel: "strong",
              timeframeBias: "daily",
              timeframeSources: ["daily"],
              isExtension: true,
              extensionMetadata: {
                extensionSource: "historical_candidate",
              },
            }),
            buildZone({
              id: "RX-420-historical-major-daily",
              symbol,
              kind: "resistance",
              representativePrice: 4.2,
              strengthLabel: "major",
              timeframeBias: "daily",
              timeframeSources: ["daily"],
              isExtension: true,
              extensionMetadata: {
                extensionSource: "historical_candidate",
              },
            }),
            buildZone({
              id: "RX-440-synthetic-out-of-range",
              symbol,
              kind: "resistance",
              representativePrice: 4.4,
              isExtension: true,
              extensionMetadata: {
                extensionSource: "synthetic_continuation_map",
              },
            }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "VIVS" });

  assert.deepEqual(
    representativeZones(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones),
    [
      { representativePrice: 2.5 },
      { representativePrice: 3.4 },
      { representativePrice: 3.45 },
      { representativePrice: 3.6 },
      { representativePrice: 3.8 },
      { representativePrice: 4.2 },
    ],
  );
});

test("ManualWatchlistRuntimeManager exposes clustered and confluence source labels", async () => {
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
          referencePrice: 2,
        },
        majorResistance: [
          buildZone({
            id: "R-daily-cluster",
            symbol,
            kind: "resistance",
            representativePrice: 2.2,
            timeframeBias: "daily",
            timeframeSources: ["daily"],
            sourceEvidenceCount: 3,
            zoneLow: 2.16,
            zoneHigh: 2.23,
            firstTimestamp: 100,
            lastTimestamp: 300,
          }),
          buildZone({
            id: "R-multi-timeframe-cluster",
            symbol,
            kind: "resistance",
            representativePrice: 2.5,
            timeframeBias: "mixed",
            timeframeSources: ["daily", "4h"],
            confluenceCount: 2,
            sourceEvidenceCount: 2,
            zoneLow: 2.46,
            zoneHigh: 2.54,
            firstTimestamp: 200,
            lastTimestamp: 400,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "CLST" });

  assert.deepEqual(
    discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones.map((zone: any) => ({
      representativePrice: zone.representativePrice,
      lowPrice: zone.lowPrice,
      highPrice: zone.highPrice,
      sourceLabel: zone.sourceLabel,
      evidenceCount: zone.sourceEvidenceCount,
      firstEvidenceAt: zone.firstEvidenceAt,
      lastEvidenceAt: zone.lastEvidenceAt,
      timeframeSources: zone.timeframeSources,
    })),
    [
      {
        representativePrice: 2.2,
        lowPrice: 2.16,
        highPrice: 2.23,
        sourceLabel: "daily structure clustered levels",
        evidenceCount: 3,
        firstEvidenceAt: 100,
        lastEvidenceAt: 300,
        timeframeSources: ["daily"],
      },
      {
        representativePrice: 2.5,
        lowPrice: 2.46,
        highPrice: 2.54,
        sourceLabel: "daily/4h clustered confluence",
        evidenceCount: 2,
        firstEvidenceAt: 200,
        lastEvidenceAt: 400,
        timeframeSources: ["daily", "4h"],
      },
    ],
  );
});

test("ManualWatchlistRuntimeManager refreshes early when only three resistance path levels remain", async () => {
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
      const resistancePrices = generationCount === 1
        ? [110, 120, 130]
        : [105, 110, 115, 120, 135];
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: generationCount === 1 ? 100 : 100.5,
        },
        intradaySupport: [95, 90, 80, 70].map((representativePrice, index) =>
          buildZone({
            id: `S-${index}`,
            symbol,
            kind: "support",
            representativePrice,
          }),
        ),
        intradayResistance: resistancePrices.map((representativePrice, index) =>
          buildZone({
            id: `R-${generationCount}-${index}`,
            symbol,
            kind: "resistance",
            representativePrice,
          }),
        ),
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "RUNR" });
  monitor.onPriceUpdate?.({
    symbol: "RUNR",
    timestamp: 2_000,
    lastPrice: 100.5,
  });
  await waitForAsyncWork();
  await waitForAsyncWork();

  assert.equal(generationCount, 2);
  assert.equal(discordAlertRouter.levelSnapshots.length, 2);
  assert.deepEqual(
    representativeZones(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones),
    [105, 110, 115, 120, 135].map((representativePrice) => ({ representativePrice })),
  );
});

test("ManualWatchlistRuntimeManager leaves a four-level thirty-percent path alone", async () => {
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
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 100,
        },
        intradaySupport: [95, 90, 80, 70].map((representativePrice, index) =>
          buildZone({ id: `S-${index}`, symbol, kind: "support", representativePrice }),
        ),
        intradayResistance: [105, 110, 120, 130].map((representativePrice, index) =>
          buildZone({ id: `R-${index}`, symbol, kind: "resistance", representativePrice }),
        ),
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ROOM" });
  monitor.onPriceUpdate?.({
    symbol: "ROOM",
    timestamp: 2_000,
    lastPrice: 100,
  });
  await waitForAsyncWork();

  assert.equal(generationCount, 1);
  assert.equal(discordAlertRouter.levelSnapshots.length, 1);
});

test("ManualWatchlistRuntimeManager realigns an adequate ladder to a materially different first live price", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const seedReferences: Array<number | undefined> = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string, referencePriceOverride?: number) => {
      seedReferences.push(referencePriceOverride);
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: referencePriceOverride ?? 100,
        },
        intradaySupport: [100, 95, 90, 80].map((representativePrice, index) =>
          buildZone({ id: `S-${index}`, symbol, kind: "support", representativePrice }),
        ),
        intradayResistance: [110, 120, 130, 140].map((representativePrice, index) =>
          buildZone({ id: `R-${index}`, symbol, kind: "resistance", representativePrice }),
        ),
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "GAP" });
  monitor.onPriceUpdate?.({
    symbol: "GAP",
    timestamp: Date.now(),
    lastPrice: 105,
  });
  await waitForAsyncWork();
  await waitForAsyncWork();

  assert.deepEqual(seedReferences, [undefined, 105]);
  assert.equal(discordAlertRouter.levelSnapshots.at(-1)?.payload.currentPrice, 105);
});

test("ManualWatchlistRuntimeManager retries first-live-price alignment after a transient seed failure", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  persistence.storedEntries = [];
  const seedReferences: Array<number | undefined> = [];
  let failedLiveAlignment = false;
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string, referencePriceOverride?: number) => {
      seedReferences.push(referencePriceOverride);
      if (referencePriceOverride !== undefined && !failedLiveAlignment) {
        failedLiveAlignment = true;
        throw new Error("temporary candle fetch failure");
      }
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: referencePriceOverride ?? 100,
        },
        intradaySupport: [99, 95, 90, 80].map((representativePrice, index) =>
          buildZone({ id: `S-${index}`, symbol, kind: "support", representativePrice }),
        ),
        intradayResistance: [110, 120, 130, 140].map((representativePrice, index) =>
          buildZone({ id: `R-${index}`, symbol, kind: "resistance", representativePrice }),
        ),
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "RETRY" });
  monitor.onPriceUpdate?.({ symbol: "RETRY", timestamp: Date.now(), lastPrice: 105 });
  await waitForAsyncWork();
  await waitForAsyncWork();
  monitor.onPriceUpdate?.({ symbol: "RETRY", timestamp: Date.now(), lastPrice: 105.2 });
  await waitForAsyncWork();
  await waitForAsyncWork();

  assert.deepEqual(seedReferences, [undefined, 105, 105.2]);
  assert.equal(levelStore.getLevels("RETRY")?.metadata.referencePrice, 105.2);
});

test("ManualWatchlistRuntimeManager refreshes support after price breaks below the full support path", async () => {
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
      const supportPrices = generationCount === 1
        ? [95, 90, 85]
        : [78, 72, 65, 60];
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: generationCount === 1 ? 100 : 80,
        },
        intradaySupport: supportPrices.map((representativePrice, index) =>
          buildZone({
            id: `S-${generationCount}-${index}`,
            symbol,
            kind: "support",
            representativePrice,
          }),
        ),
        intradayResistance: [82, 88, 96, 104].map((representativePrice, index) =>
          buildZone({ id: `R-${index}`, symbol, kind: "resistance", representativePrice }),
        ),
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "DROP" });
  monitor.onPriceUpdate?.({
    symbol: "DROP",
    timestamp: 2_000,
    lastPrice: 80,
  });
  await waitForAsyncWork();
  await waitForAsyncWork();

  assert.equal(generationCount, 2);
  assert.equal(discordAlertRouter.levelSnapshots.length, 2);
  assert.deepEqual(
    representativeZones(discordAlertRouter.levelSnapshots.at(-1)?.payload.supportZones),
    [78, 72, 65, 60].map((representativePrice) => ({ representativePrice })),
  );
});

test("ManualWatchlistRuntimeManager republishes the complete website snapshot after a level extension", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const published: any[] = [];
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher: {
      async publish(patch: any) {
        published.push(patch);
      },
    },
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 2.2,
        },
        intradayResistance: [
          buildZone({ id: "R-245", symbol, kind: "resistance", representativePrice: 2.45 }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({
              id: "RX-320",
              symbol,
              kind: "resistance",
              representativePrice: 3.2,
              strengthLabel: "strong",
              timeframeBias: "daily",
              timeframeSources: ["daily"],
              isExtension: true,
            }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "EXTN" });
  const result = await (manager as any).postLevelExtension(
    "EXTN",
    "thread-EXTN",
    "resistance",
    2_000,
    2.8,
  );

  assert.equal(result, true);
  assert.equal(published.length, 1);
  assert.equal(published[0]?.cards?.fullLadder?.title, "EXTN full level ladder");
  assert.equal(
    published[0]?.cards?.nearestSupportResistance?.title,
    "Potential Path Levels",
  );
  assert.equal(published[0]?.cards?.nearestSupportResistance?.source, "level_snapshot");
});

test("ManualWatchlistRuntimeManager still refreshes resistance when a fast quote jumps beyond the outer ladder", () => {
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore: new LevelStore(),
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: new FakeWatchlistStatePersistence() as any,
  });
  const snapshotState = {
    lastSnapshot: "snapshot",
    highestResistance: 4,
    resistanceRefreshBoundary: 3.5,
    lowestSupport: 1.8,
    referencePrice: 2,
    lastRefreshTriggerResistance: null,
    lastRefreshTriggerSupport: null,
    lastRefreshTimestamp: null,
    lastExtensionPostKey: null,
    lastExtensionPostTimestamp: null,
  };

  assert.equal(
    (manager as any).shouldTriggerResistanceRefresh(
      { symbol: "FAST", timestamp: 2_000, lastPrice: 4.1 },
      snapshotState,
    ),
    true,
  );
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

  assert.deepEqual(representativeZones(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones), [
    { representativePrice: 1.49 },
    { representativePrice: 1.58 },
    { representativePrice: 1.64 },
    { representativePrice: 1.75 },
    { representativePrice: 1.85 },
    { representativePrice: 2.06 },
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

  assert.deepEqual(representativeZones(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones), [
    { representativePrice: 1.49 },
    { representativePrice: 1.58 },
    { representativePrice: 1.64 },
    { representativePrice: 1.72 },
    { representativePrice: 1.75 },
    { representativePrice: 1.85 },
    { representativePrice: 1.95 },
    { representativePrice: 2.05 },
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
    },
    timestamp: 10,
    notes: ["Breakout through outermost resistance."],
  });
  await waitForAsyncWork();

  assert.equal(discordAlertRouter.routed.length, 1);
  assert.equal(discordAlertRouter.routed[0]?.payload.title, "ALBT breakout");
  assert.equal(
    discordAlertRouter.routed[0]?.payload.body,
    "breakout resistance 2.40-2.50 | strong outermost | fresh | refreshed",
  );
});

test("ManualWatchlistRuntimeManager suppresses near-duplicate alert posts for the same structural state", async () => {
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

  assert.equal(discordAlertRouter.routed.length, 1);
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

  const originalConsoleLog = console.log;
  const capturedLogs: string[] = [];
  console.log = (...args: unknown[]) => {
    capturedLogs.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
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
  } finally {
    console.log = originalConsoleLog;
  }

  const expectedInterpretation = [
    "SYMBOL: ALBT",
    "TYPE: pre_zone",
    "MESSAGE: watching pullback into support near 2.45",
    "CONFIDENCE: 0.82",
  ].join("\n");

  assert.equal(
    capturedLogs.filter((entry) => entry === expectedInterpretation).length,
    1,
  );
});

test("ManualWatchlistRuntimeManager includes support extensions in the initial ladder without a redundant later post", async () => {
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
          referencePrice: 1.99,
        },
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

  assert.deepEqual(
    representativeZones(discordAlertRouter.levelSnapshots.at(-1)?.payload.supportZones),
    [
      { representativePrice: 1.98 },
      { representativePrice: 1.72 },
    ],
  );
  assert.deepEqual(discordAlertRouter.levelExtensions, []);
});

test("default seeding reuses the exact candle series for market structure", async () => {
  const baseService = new CandleFetchService(new StubHistoricalCandleProvider());
  const fetches: HistoricalFetchRequest[] = [];
  const countingService = {
    getProviderName: () => baseService.getProviderName(),
    async fetchCandles(request: HistoricalFetchRequest) {
      fetches.push({ ...request });
      return baseService.fetchCandles(request);
    },
  } as unknown as CandleFetchService;
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: countingService,
    levelStore: new LevelStore(),
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: new FakeWatchlistStatePersistence() as any,
  });

  await (manager as unknown as {
    seedLevelsForSymbol(symbol: string): Promise<void>;
  }).seedLevelsForSymbol("TEST");

  assert.deepEqual(
    fetches.map((request) => request.timeframe).sort(),
    ["4h", "5m", "daily"],
  );
  const structureSummary = (manager as unknown as {
    marketStructureBySymbol: Map<string, string>;
  }).marketStructureBySymbol.get("TEST");
  assert.match(structureSummary ?? "", /Daily:/);
  assert.match(structureSummary ?? "", /HTF 4h:/);
  assert.match(structureSummary ?? "", /Tactical 5m:/);
});
