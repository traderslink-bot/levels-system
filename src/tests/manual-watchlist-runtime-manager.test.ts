import assert from "node:assert/strict";
import test from "node:test";

import type { DiscordThreadRoutingResult } from "../lib/alerts/alert-types.js";
import { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
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
  assert.deepEqual(discordAlertRouter.levelSnapshots[0]?.payload.supportLevels, [1.95]);
  assert.deepEqual(discordAlertRouter.levelSnapshots[0]?.payload.resistanceLevels, [2.45]);
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
  assert.deepEqual(discordAlertRouter.levelSnapshots[1], {
    threadId: "thread-ALBT",
    payload: {
      symbol: "ALBT",
      supportLevels: [1.95],
      resistanceLevels: [2.72],
      timestamp: 1000,
    },
  });
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
