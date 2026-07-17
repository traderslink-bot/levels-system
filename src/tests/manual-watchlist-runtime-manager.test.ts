import assert from "node:assert/strict";
import test from "node:test";

import type { DiscordThreadRoutingResult } from "../lib/alerts/alert-types.js";
import type { Candle, CandleProviderName, CandleProviderResponse, CandleTimeframe } from "../lib/market-data/candle-types.js";
import type { HistoricalFetchRequest } from "../lib/market-data/candle-fetch-service.js";
import { OpportunityRuntimeController } from "../lib/monitoring/opportunity-runtime-controller.js";
import {
  buildLiveTradeSetupSeriesMap,
  ManualWatchlistRuntimeManager,
  resolveEodhdConfirmedLevelRequestEndTimeMs,
} from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import type { ManualWatchlistLifecycleEvent } from "../lib/monitoring/manual-watchlist-runtime-events.js";
import { WatchlistStore } from "../lib/monitoring/watchlist-store.js";
import type { WatchlistEntry } from "../lib/monitoring/monitoring-types.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import type {
  LiveWatchlistCardPatch,
  LiveWatchlistHealthPatch,
  LiveWatchlistPublisher,
  LiveWatchlistTickerDataPatch,
} from "../lib/live-watchlist/live-watchlist-types.js";
import type { TechnicalContext } from "../lib/technical-context/technical-context-types.js";

function waitForAsyncWork(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function withoutSnapshotSourceLabels<T extends {
  representativePrice: number;
  strengthLabel?: string;
  freshness?: string;
  isExtension?: boolean;
}>(zones: T[]) {
  return zones.map((zone) => ({
    representativePrice: zone.representativePrice,
    strengthLabel: zone.strengthLabel,
    freshness: zone.freshness,
    isExtension: zone.isExtension,
  }));
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
  public providerSetCalls: any[] = [];
  public currentLivePriceProvider?: FakeLivePriceProvider;
  public failNextStart?: Error;
  public marketStructureSeedCalls: any[] = [];
  public marketStructureSnapshots = new Map<string, any>();

  async start(entries: any[], listener: (event: any) => void, onPriceUpdate?: (update: any) => void): Promise<void> {
    this.startCalls.push(entries.map((entry) => ({ ...entry })));
    if (this.failNextStart) {
      const error = this.failNextStart;
      this.failNextStart = undefined;
      throw error;
    }
    this.listener = listener;
    this.onPriceUpdate = onPriceUpdate;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    await this.currentLivePriceProvider?.stop();
  }

  setLivePriceProvider(provider: FakeLivePriceProvider): FakeLivePriceProvider {
    const previousProvider = this.currentLivePriceProvider ?? new FakeLivePriceProvider("previous");
    this.currentLivePriceProvider = provider;
    this.providerSetCalls.push(provider);
    return previousProvider;
  }

  public listener?: (event: any) => void;
  public onPriceUpdate?: (update: any) => void;

  seedMarketStructure(symbol: string, seedInput: any): null {
    this.marketStructureSeedCalls.push({ symbol, seedInput });
    return null;
  }

  getMarketStructureSnapshot(symbolInput?: string): any {
    return this.marketStructureSnapshots.get(String(symbolInput ?? "").toUpperCase()) ?? null;
  }
}

class FakeLivePriceProvider {
  public stopCalls = 0;

  constructor(public readonly name: string) {}

  async start(): Promise<void> {
    return undefined;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
  }
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

class FakeLiveWatchlistPublisher implements LiveWatchlistPublisher {
  public cardPatches: LiveWatchlistCardPatch[] = [];
  public healthPatches: LiveWatchlistHealthPatch[] = [];
  public tickerDataPatches: LiveWatchlistTickerDataPatch[] = [];

  async publish(patch: LiveWatchlistCardPatch): Promise<void> {
    this.cardPatches.push(patch);
  }

  async publishHealth(patch: LiveWatchlistHealthPatch): Promise<void> {
    this.healthPatches.push(patch);
  }

  async publishTickerData(patch: LiveWatchlistTickerDataPatch): Promise<void> {
    this.tickerDataPatches.push(patch);
  }
}

class FailingLiveWatchlistPublisher extends FakeLiveWatchlistPublisher {
  override async publish(): Promise<void> {
    throw new Error("website ingest unavailable");
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

function buildTestCandle(day: number, open: number, high: number, low: number, close: number): Candle {
  return {
    timestamp: day * 24 * 60 * 60 * 1000,
    open,
    high,
    low,
    close,
    volume: 1_000_000,
  };
}

function buildTestCandleResponse(timeframe: CandleTimeframe, candles: Candle[]): CandleProviderResponse {
  return {
    provider: "stub",
    symbol: "CAT",
    timeframe,
    requestedLookbackBars: candles.length,
    candles,
    fetchStartTimestamp: candles[0]?.timestamp ?? 0,
    fetchEndTimestamp: candles.at(-1)?.timestamp ?? 0,
    requestedStartTimestamp: candles[0]?.timestamp ?? 0,
    requestedEndTimestamp: candles.at(-1)?.timestamp ?? 0,
    sessionMetadataAvailable: false,
    actualBarsReturned: candles.length,
    completenessStatus: candles.length > 0 ? "complete" : "empty",
    stale: false,
    validationIssues: [],
    sessionSummary: null,
  };
}

class RecordingCandleFetchService {
  public requests: HistoricalFetchRequest[] = [];

  constructor(private readonly providerName: CandleProviderName = "stub") {}

  getProviderName(): CandleProviderName {
    return this.providerName;
  }

  async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    this.requests.push({ ...request });
    return {
      ...buildCandleResponse(request),
      provider: this.providerName,
    };
  }
}

class StaticRecentIntradayCandleFetchService {
  public requests: HistoricalFetchRequest[] = [];

  constructor(
    private readonly latestCandleAgeMs = 5 * 60 * 1000,
    private readonly latestVolume = 500_000,
    private readonly baselineVolume = 100_000,
  ) {}

  getProviderName(): CandleProviderName {
    return "yahoo";
  }

  async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    this.requests.push({ ...request });
    const intervalMs = request.timeframe === "1m" ? 60_000 : 5 * 60_000;
    const end = (request.endTimeMs ?? Date.now()) - this.latestCandleAgeMs;
    const candles = Array.from({ length: request.lookbackBars }, (_, index) => {
      const price = index === request.lookbackBars - 1 ? 2.2 : 1.8 + index * 0.001;
      return {
        timestamp: end - (request.lookbackBars - index - 1) * intervalMs,
        open: price,
        high: price + 0.02,
        low: price - 0.02,
        close: price,
        volume: index === request.lookbackBars - 1 ? this.latestVolume : this.baselineVolume,
      };
    });

    return {
      provider: "yahoo",
      symbol: request.symbol.toUpperCase(),
      timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars,
      candles,
      fetchStartTimestamp: end - candles.length * intervalMs,
      fetchEndTimestamp: end,
      requestedStartTimestamp: end - request.lookbackBars * intervalMs,
      requestedEndTimestamp: end,
      sessionMetadataAvailable: true,
      actualBarsReturned: candles.length,
      completenessStatus: "complete",
      stale: false,
      validationIssues: [],
      sessionSummary: null,
    };
  }
}

class StaleFiveMinuteFreshOneMinuteCandleFetchService extends StaticRecentIntradayCandleFetchService {
  override async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    if (request.timeframe === "5m") {
      const staleService = new StaticRecentIntradayCandleFetchService(30 * 60 * 1000);
      const response = await staleService.fetchCandles(request);
      this.requests.push({ ...request });
      return response;
    }

    return super.fetchCandles(request);
  }
}

class OutOfOrderRecentFiveMinuteCandleFetchService extends StaticRecentIntradayCandleFetchService {
  override async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    if (request.timeframe === "1m") {
      throw new Error("1m fallback should not be needed when 5m contains a fresh candle.");
    }

    const response = await super.fetchCandles(request);
    const latest = response.candles.at(-1);
    const earlier = response.candles.slice(0, -1);
    return {
      ...response,
      candles: latest ? [latest, ...earlier] : response.candles,
      validationIssues: [
        {
          code: "out_of_order_timestamps",
          severity: "error",
          message: "Synthetic out-of-order 5m response.",
        },
      ],
    };
  }
}

class DuplicateOneMinuteFallbackCandleFetchService extends StaticRecentIntradayCandleFetchService {
  override async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    if (request.timeframe === "5m") {
      const staleService = new StaticRecentIntradayCandleFetchService(30 * 60 * 1000);
      const response = await staleService.fetchCandles(request);
      this.requests.push({ ...request });
      return response;
    }

    this.requests.push({ ...request });
    const end = request.endTimeMs ?? Date.now();
    const latestTimestamp = end - 5 * 60 * 1000;
    const candles = Array.from({ length: request.lookbackBars }, (_, index) => {
      const timestamp = latestTimestamp - (request.lookbackBars - index - 1) * 60 * 1000;
      const price = index === request.lookbackBars - 1 ? 2.2 : 1.8 + index * 0.001;
      return {
        timestamp,
        open: price,
        high: price + 0.02,
        low: price - 0.02,
        close: price,
        volume: 20_000,
      };
    });
    const latest = candles.at(-1)!;
    const duplicateLatestBars = Array.from({ length: 25 }, () => ({ ...latest }));

    return {
      provider: "yahoo",
      symbol: request.symbol.toUpperCase(),
      timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars,
      candles: [...candles, ...duplicateLatestBars],
      fetchStartTimestamp: end - request.lookbackBars * 60 * 1000,
      fetchEndTimestamp: end,
      requestedStartTimestamp: end - request.lookbackBars * 60 * 1000,
      requestedEndTimestamp: end,
      sessionMetadataAvailable: true,
      actualBarsReturned: candles.length + duplicateLatestBars.length,
      completenessStatus: "complete",
      stale: false,
      validationIssues: [
        {
          code: "duplicate_timestamps",
          severity: "error",
          message: "Synthetic duplicated 1m latest bar.",
        },
      ],
      sessionSummary: null,
    };
  }
}

test("ManualWatchlistRuntimeManager blends EODHD completed sessions with Yahoo current-session candles for AI reads", async () => {
  const historicalRequests: any[] = [];
  const historicalLoader = async (request: any) => {
    historicalRequests.push({ ...request });
    const timeframe = request.timeframes[0];
    const timestamp = timeframe === "daily"
      ? request.toTimeMs - 24 * 60 * 60 * 1_000
      : request.fromTimeMs;
    const candles = [{
      timestamp,
      open: 1.4,
      high: 1.5,
      low: 1.35,
      close: 1.46,
      volume: timeframe === "daily" ? 888_000 : 777_000,
    }];
    return {
      symbol: request.symbol,
      fromTimeMs: request.fromTimeMs,
      toTimeMs: request.toTimeMs,
      generatedAt: Date.now(),
      series: [{
        timeframe,
        provider: "eodhd" as const,
        selectionReason: "historical_or_daily_window" as const,
        requestedStartTimestamp: request.fromTimeMs,
        requestedEndTimestamp: request.toTimeMs,
        candles,
        response: { provider: "eodhd" },
      }],
    };
  };
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore: new LevelStore(),
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    recentIntradayCandleFetchService: new StaticRecentIntradayCandleFetchService() as any,
    tradersLinkAiReadHistoricalCandleLoader: historicalLoader as any,
  });

  const context = await (manager as any).buildTradersLinkAiReadPriceActionContext(
    "GLXG",
    Date.now(),
  );

  assert.deepEqual(
    historicalRequests.map((request) => request.timeframes[0]).sort(),
    ["5m", "daily"],
  );
  assert.match(context.source, /yahoo current-session \+ eodhd completed-session OHLCV/);
  assert.ok(context.intradayCandles.some((candle: Candle) => candle.volume === 777_000));
  assert.ok(context.dailyCandles.some((candle: Candle) => candle.volume === 888_000));
});

test("ManualWatchlistRuntimeManager polls Yahoo recent intraday candles for pullback trader reads", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  persistence.storedEntries = [
    {
      symbol: "CAST",
      active: true,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-cast",
      lifecycle: "active",
      refreshPending: false,
      lastPrice: 2.2,
      lastPriceUpdateAt: Date.now(),
    },
  ];
  const levelStore = new LevelStore();
  levelStore.setLevels(buildLevelOutput("CAST", {
    majorSupport: [
      buildZone({
        id: "support-cast",
        symbol: "CAST",
        kind: "support",
        representativePrice: 1.95,
        zoneLow: 1.94,
        zoneHigh: 1.96,
        strengthLabel: "major",
        timeframeSources: ["daily"],
      }),
    ],
    majorResistance: [
      buildZone({
        id: "resistance-cast",
        symbol: "CAST",
        kind: "resistance",
        representativePrice: 2.5,
        zoneLow: 2.49,
        zoneHigh: 2.51,
        strengthLabel: "major",
        timeframeSources: ["daily"],
      }),
    ],
  }));
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const recentIntradayCandleFetchService = new StaticRecentIntradayCandleFetchService();
  const watchlistStore = new WatchlistStore();
  watchlistStore.setEntries(persistence.storedEntries);
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    recentIntradayCandleFetchService: recentIntradayCandleFetchService as any,
    pullbackReadEnabled: true,
  });

  await (manager as any).refreshPullbackReadIntradayCandles("CAST");
  await waitForAsyncWork();

  assert.deepEqual(
    recentIntradayCandleFetchService.requests.map((request) => request.timeframe).sort(),
    ["5m"],
  );
  const traderReadPatch = liveWatchlistPublisher.cardPatches.find((patch) =>
    Boolean(patch.cards.liveTraderRead),
  );
  assert.equal(traderReadPatch?.cards.liveTraderRead?.source, "pullback_read");
  assert.match(traderReadPatch?.cards.liveTraderRead?.body ?? "", /^CAST Extended/);
  assert.match(traderReadPatch?.cards.liveTraderRead?.body ?? "", /Volume read: strong \(5\.00x recent 5m average\)/);
  assert.match(traderReadPatch?.cards.liveTraderRead?.body ?? "", /Needs to hold:/);
  assert.equal(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackReadEnabled, true);
  assert.equal(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackProvider, "yahoo");
  assert.equal(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackVolumeLabel, "strong");
  assert.equal(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackVolumeRatio, 5);
  assert.ok(
    liveWatchlistPublisher.cardPatches.some((patch) =>
      Boolean(patch.cards.nearestSupportResistance && patch.cards.fullLadder),
    ),
    "expected refreshed Yahoo session candles to republish Potential Path and Full Ladder",
  );
});

test("ManualWatchlistRuntimeManager projects forming Yahoo 5m volume before labeling pullbacks", async () => {
  const persistence = new FakeWatchlistStatePersistence();
  persistence.storedEntries = [
    {
      symbol: "CAST",
      active: true,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-cast",
      lifecycle: "active",
      refreshPending: false,
      lastPrice: 2.2,
      lastPriceUpdateAt: Date.now(),
    },
  ];
  const watchlistStore = new WatchlistStore();
  watchlistStore.setEntries(persistence.storedEntries);
  const levelStore = new LevelStore();
  levelStore.setLevels(buildLevelOutput("CAST", {
    majorSupport: [
      buildZone({ id: "support-cast", symbol: "CAST", kind: "support", representativePrice: 1.95 }),
    ],
    majorResistance: [
      buildZone({ id: "resistance-cast", symbol: "CAST", kind: "resistance", representativePrice: 2.5 }),
    ],
  }));
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore,
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    recentIntradayCandleFetchService: new StaticRecentIntradayCandleFetchService(60 * 1000, 40_000, 100_000) as any,
    pullbackReadEnabled: true,
  });

  await (manager as any).refreshPullbackReadIntradayCandles("CAST");
  await waitForAsyncWork();

  const traderReadPatch = liveWatchlistPublisher.cardPatches.find((patch) =>
    Boolean(patch.cards.liveTraderRead),
  );
  assert.match(
    traderReadPatch?.cards.liveTraderRead?.body ?? "",
    /Volume read: strong \(2\.00x projected 5m pace; raw 0\.40x so far\)/,
  );
  assert.equal(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackVolumeLabel, "strong");
  assert.equal(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackVolumeRatio, 2);
  assert.equal(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackVolumeRawRatio, 0.4);
  assert.equal(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackProjectedVolume, 200_000);
  assert.equal(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackVolumePartial, true);
});

test("ManualWatchlistRuntimeManager uses fresh live price over Yahoo candle close for pullback reads", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const now = Date.now();
  persistence.storedEntries = [
    {
      symbol: "CAST",
      active: true,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-cast",
      lifecycle: "active",
      refreshPending: false,
      lastPrice: 2.55,
      lastPriceUpdateAt: now,
    },
  ];
  const levelStore = new LevelStore();
  levelStore.setLevels(buildLevelOutput("CAST", {
    majorSupport: [
      buildZone({
        id: "support-cast",
        symbol: "CAST",
        kind: "support",
        representativePrice: 1.95,
        strengthLabel: "major",
        timeframeSources: ["daily"],
      }),
    ],
    majorResistance: [
      buildZone({
        id: "resistance-cast",
        symbol: "CAST",
        kind: "resistance",
        representativePrice: 2.8,
        strengthLabel: "major",
        timeframeSources: ["daily"],
      }),
    ],
  }));
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const watchlistStore = new WatchlistStore();
  watchlistStore.setEntries(persistence.storedEntries);
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    recentIntradayCandleFetchService: new StaticRecentIntradayCandleFetchService() as any,
    pullbackReadEnabled: true,
  });

  await (manager as any).refreshPullbackReadIntradayCandles("CAST");
  await waitForAsyncWork();

  const traderReadPatch = liveWatchlistPublisher.cardPatches.find((patch) =>
    Boolean(patch.cards.liveTraderRead),
  );
  assert.equal(traderReadPatch?.cards.liveTraderRead?.priceWhenPosted, 2.55);
  assert.match(
    traderReadPatch?.cards.liveTraderRead?.body ?? "",
    /Continuation trigger: no clean higher path level on the current map yet/,
  );
  assert.doesNotMatch(
    traderReadPatch?.cards.liveTraderRead?.body ?? "",
    /Continuation trigger: reclaim\/hold above 2\.80/,
  );
});

test("ManualWatchlistRuntimeManager skips stale Yahoo pullback candles", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const watchlistStore = new WatchlistStore();
  persistence.storedEntries = [
    {
      symbol: "CAST",
      active: true,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-cast",
      lifecycle: "active",
      refreshPending: false,
    },
  ];
  watchlistStore.setEntries(persistence.storedEntries);
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore: new LevelStore(),
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    recentIntradayCandleFetchService: new StaticRecentIntradayCandleFetchService(30 * 60 * 1000) as any,
    pullbackReadEnabled: true,
  });

  await (manager as any).refreshPullbackReadIntradayCandles("CAST");
  await waitForAsyncWork();

  assert.equal(liveWatchlistPublisher.cardPatches.length, 0);
});

test("ManualWatchlistRuntimeManager falls back to Yahoo 1m when 5m candles are stale", async () => {
  const persistence = new FakeWatchlistStatePersistence();
  persistence.storedEntries = [
    {
      symbol: "CAST",
      active: true,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-cast",
      lifecycle: "active",
      refreshPending: false,
      lastPrice: 2.2,
      lastPriceUpdateAt: Date.now(),
    },
  ];
  const watchlistStore = new WatchlistStore();
  watchlistStore.setEntries(persistence.storedEntries);
  const levelStore = new LevelStore();
  levelStore.setLevels(buildLevelOutput("CAST", {
    majorSupport: [
      buildZone({ id: "support-cast", symbol: "CAST", kind: "support", representativePrice: 1.95 }),
    ],
    majorResistance: [
      buildZone({ id: "resistance-cast", symbol: "CAST", kind: "resistance", representativePrice: 2.5 }),
    ],
  }));
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const recentIntradayCandleFetchService = new StaleFiveMinuteFreshOneMinuteCandleFetchService();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore,
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    recentIntradayCandleFetchService: recentIntradayCandleFetchService as any,
    pullbackReadEnabled: true,
  });

  await (manager as any).refreshPullbackReadIntradayCandles("CAST");
  await waitForAsyncWork();

  assert.deepEqual(
    recentIntradayCandleFetchService.requests.map((request) => request.timeframe),
    ["5m", "1m"],
  );
  const traderReadPatch = liveWatchlistPublisher.cardPatches.find((patch) =>
    Boolean(patch.cards.liveTraderRead),
  );
  assert.equal(traderReadPatch?.cards.liveTraderRead?.source, "pullback_read");
  assert.equal(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackProvider, "yahoo");
  assert.doesNotMatch(traderReadPatch?.cards.liveTraderRead?.body ?? "", /5m candles from yahoo/);
});

test("ManualWatchlistRuntimeManager treats out-of-order Yahoo 5m candles by latest timestamp", async () => {
  const persistence = new FakeWatchlistStatePersistence();
  persistence.storedEntries = [
    {
      symbol: "CAST",
      active: true,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-cast",
      lifecycle: "active",
      refreshPending: false,
      lastPrice: 2.2,
      lastPriceUpdateAt: Date.now(),
    },
  ];
  const watchlistStore = new WatchlistStore();
  watchlistStore.setEntries(persistence.storedEntries);
  const levelStore = new LevelStore();
  levelStore.setLevels(buildLevelOutput("CAST", {
    majorSupport: [
      buildZone({ id: "support-cast", symbol: "CAST", kind: "support", representativePrice: 1.95 }),
    ],
    majorResistance: [
      buildZone({ id: "resistance-cast", symbol: "CAST", kind: "resistance", representativePrice: 2.5 }),
    ],
  }));
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const recentIntradayCandleFetchService = new OutOfOrderRecentFiveMinuteCandleFetchService();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore,
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    recentIntradayCandleFetchService: recentIntradayCandleFetchService as any,
    pullbackReadEnabled: true,
  });

  await (manager as any).refreshPullbackReadIntradayCandles("CAST");
  await waitForAsyncWork();

  assert.deepEqual(
    recentIntradayCandleFetchService.requests.map((request) => request.timeframe),
    ["5m"],
  );
  const traderReadPatch = liveWatchlistPublisher.cardPatches.find((patch) =>
    Boolean(patch.cards.liveTraderRead),
  );
  assert.equal(traderReadPatch?.cards.liveTraderRead?.source, "pullback_read");
  assert.match(traderReadPatch?.cards.liveTraderRead?.body ?? "", /^CAST Extended/);
});

test("ManualWatchlistRuntimeManager dedupes Yahoo 1m fallback candles before volume reads", async () => {
  const persistence = new FakeWatchlistStatePersistence();
  persistence.storedEntries = [
    {
      symbol: "CAST",
      active: true,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-cast",
      lifecycle: "active",
      refreshPending: false,
      lastPrice: 2.2,
      lastPriceUpdateAt: Date.now(),
    },
  ];
  const watchlistStore = new WatchlistStore();
  watchlistStore.setEntries(persistence.storedEntries);
  const levelStore = new LevelStore();
  levelStore.setLevels(buildLevelOutput("CAST", {
    majorSupport: [
      buildZone({ id: "support-cast", symbol: "CAST", kind: "support", representativePrice: 1.95 }),
    ],
    majorResistance: [
      buildZone({ id: "resistance-cast", symbol: "CAST", kind: "resistance", representativePrice: 2.5 }),
    ],
  }));
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const recentIntradayCandleFetchService = new DuplicateOneMinuteFallbackCandleFetchService();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore,
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    recentIntradayCandleFetchService: recentIntradayCandleFetchService as any,
    pullbackReadEnabled: true,
  });

  await (manager as any).refreshPullbackReadIntradayCandles("CAST");
  await waitForAsyncWork();

  assert.deepEqual(
    recentIntradayCandleFetchService.requests.map((request) => request.timeframe),
    ["5m", "1m"],
  );
  const traderReadPatch = liveWatchlistPublisher.cardPatches.find((patch) =>
    Boolean(patch.cards.liveTraderRead),
  );
  assert.notEqual(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackVolumeLabel, "strong");
  assert.ok(
    Number(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackCurrentVolume) < 120_000,
  );
});

test("ManualWatchlistRuntimeManager marks live pullback volume unknown when the baseline is stale", async () => {
  const levelStore = new LevelStore();
  levelStore.setLevels(buildLevelOutput("CAST", {
    majorSupport: [
      buildZone({ id: "support-cast", symbol: "CAST", kind: "support", representativePrice: 1.95 }),
    ],
    majorResistance: [
      buildZone({ id: "resistance-cast", symbol: "CAST", kind: "resistance", representativePrice: 2.5 }),
    ],
  }));
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore,
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: new FakeWatchlistStatePersistence() as any,
    liveWatchlistPublisher,
    pullbackReadEnabled: true,
  });
  const staleStart = Date.UTC(2026, 6, 10, 14, 0, 0);
  const staleCandles = Array.from({ length: 20 }, (_, index) => {
    const price = 2 + index * 0.005;
    return {
      timestamp: staleStart + index * 5 * 60 * 1000,
      open: price,
      high: price + 0.02,
      low: price - 0.02,
      close: price,
      volume: 10_000,
    };
  });
  const liveTimestamp = staleStart + 4 * 60 * 60 * 1000;
  const liveUpdates = [
    {
      symbol: "CAST",
      timestamp: liveTimestamp + 1_000,
      lastPrice: 2.45,
      volume: 250_000,
    },
    {
      symbol: "CAST",
      timestamp: liveTimestamp + 61_000,
      lastPrice: 2.46,
      volume: 250_100,
    },
  ];

  (manager as any).technicalContextProviderBySymbol.set("CAST", "yahoo");
  (manager as any).technicalContextDataQualityFlagsBySymbol.set("CAST", []);
  (manager as any).technicalContextCandleStore.setHistoricalCandles("CAST", staleCandles);
  (manager as any).rebuildTechnicalContextForSymbol({
    symbol: "CAST",
    candles: staleCandles,
    currentPrice: 2.2,
    provider: "yahoo",
    dataQualityFlags: [],
  });

  for (const update of liveUpdates) {
    (manager as any).ingestLiveTechnicalContextPrice(update);
  }
  (manager as any).publishLiveTickerData(liveUpdates.at(-1)!);
  await waitForAsyncWork();

  const traderReadPatch = liveWatchlistPublisher.cardPatches.find((patch) =>
    Boolean(patch.cards.liveTraderRead),
  );
  assert.equal(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackVolumeLabel, "unknown");
  assert.equal(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackVolumeRatio, null);
  assert.doesNotMatch(
    traderReadPatch?.cards.liveTraderRead?.body ?? "",
    /Volume read: unknown \(recent 5m volume baseline is stale\)/,
  );
});

test("ManualWatchlistRuntimeManager uses cumulative live volume deltas for pullback reads", async () => {
  const levelStore = new LevelStore();
  levelStore.setLevels(buildLevelOutput("CAST", {
    majorSupport: [
      buildZone({ id: "support-cast", symbol: "CAST", kind: "support", representativePrice: 1.95 }),
    ],
    majorResistance: [
      buildZone({ id: "resistance-cast", symbol: "CAST", kind: "resistance", representativePrice: 2.5 }),
    ],
  }));
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore,
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: new FakeWatchlistStatePersistence() as any,
    liveWatchlistPublisher,
    pullbackReadEnabled: true,
  });
  const baselineStart = Date.UTC(2026, 6, 10, 14, 0, 0);
  const baselineCandles = Array.from({ length: 20 }, (_, index) => {
    const price = 2 + index * 0.005;
    return {
      timestamp: baselineStart + index * 5 * 60 * 1000,
      open: price,
      high: price + 0.02,
      low: price - 0.02,
      close: price,
      volume: 10_000,
    };
  });
  const liveBucketStart = baselineStart + 20 * 5 * 60 * 1000;
  const liveUpdates = [
    { symbol: "CAST", timestamp: liveBucketStart + 1_000, lastPrice: 2.45, volume: 250_000 },
    { symbol: "CAST", timestamp: liveBucketStart + 30_000, lastPrice: 2.46, volume: 250_050 },
    { symbol: "CAST", timestamp: liveBucketStart + 61_000, lastPrice: 2.47, volume: 250_120 },
  ];

  (manager as any).technicalContextProviderBySymbol.set("CAST", "yahoo");
  (manager as any).technicalContextDataQualityFlagsBySymbol.set("CAST", []);
  (manager as any).technicalContextCandleStore.setHistoricalCandles("CAST", baselineCandles);
  (manager as any).rebuildTechnicalContextForSymbol({
    symbol: "CAST",
    candles: baselineCandles,
    currentPrice: 2.2,
    provider: "yahoo",
    dataQualityFlags: [],
  });

  for (const update of liveUpdates) {
    (manager as any).ingestLiveTechnicalContextPrice(update);
  }
  (manager as any).publishLiveTickerData(liveUpdates.at(-1)!);
  await waitForAsyncWork();

  const traderReadPatch = liveWatchlistPublisher.cardPatches.find((patch) =>
    Boolean(patch.cards.liveTraderRead),
  );
  assert.notEqual(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackVolumeLabel, "strong");
  assert.equal(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackCurrentVolume, 120);
  assert.ok(
    Number(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackProjectedVolume) < 1_000,
  );
});

test("ManualWatchlistRuntimeManager skips future-dated Yahoo pullback candles", async () => {
  const persistence = new FakeWatchlistStatePersistence();
  const watchlistStore = new WatchlistStore();
  persistence.storedEntries = [
    {
      symbol: "CAST",
      active: true,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-cast",
      lifecycle: "active",
      refreshPending: false,
    },
  ];
  watchlistStore.setEntries(persistence.storedEntries);
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore: new LevelStore(),
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    recentIntradayCandleFetchService: new StaticRecentIntradayCandleFetchService(-5 * 60 * 1000) as any,
    pullbackReadEnabled: true,
  });

  await (manager as any).refreshPullbackReadIntradayCandles("CAST");
  await waitForAsyncWork();

  assert.equal(liveWatchlistPublisher.cardPatches.length, 0);
});

test("ManualWatchlistRuntimeManager clamps slightly future Yahoo candles without confident volume", async () => {
  const persistence = new FakeWatchlistStatePersistence();
  persistence.storedEntries = [
    {
      symbol: "CAST",
      active: true,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-cast",
      lifecycle: "active",
      refreshPending: false,
      lastPrice: 2.2,
      lastPriceUpdateAt: Date.now(),
    },
  ];
  const watchlistStore = new WatchlistStore();
  watchlistStore.setEntries(persistence.storedEntries);
  const levelStore = new LevelStore();
  levelStore.setLevels(buildLevelOutput("CAST", {
    majorSupport: [
      buildZone({ id: "support-cast", symbol: "CAST", kind: "support", representativePrice: 1.95 }),
    ],
    majorResistance: [
      buildZone({ id: "resistance-cast", symbol: "CAST", kind: "resistance", representativePrice: 2.5 }),
    ],
  }));
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const recentIntradayCandleFetchService = new StaticRecentIntradayCandleFetchService(-30 * 1000, 500_000, 100_000);
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore,
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    recentIntradayCandleFetchService: recentIntradayCandleFetchService as any,
    pullbackReadEnabled: true,
  });

  await (manager as any).refreshPullbackReadIntradayCandles("CAST");
  await waitForAsyncWork();

  const requestEndTime = recentIntradayCandleFetchService.requests[0]?.endTimeMs;
  const traderReadPatch = liveWatchlistPublisher.cardPatches.find((patch) =>
    Boolean(patch.cards.liveTraderRead),
  );
  assert.equal(traderReadPatch?.updatedAt, requestEndTime);
  assert.equal(traderReadPatch?.cards.liveTraderRead?.metadata?.pullbackVolumeLabel, "unknown");
  assert.doesNotMatch(
    traderReadPatch?.cards.liveTraderRead?.body ?? "",
    /latest 5m candle timestamp is ahead of request time/,
  );
});

test("ManualWatchlistRuntimeManager republishes pullback read when volume label changes", async () => {
  const levelStore = new LevelStore();
  levelStore.setLevels(buildLevelOutput("CAST", {
    majorSupport: [
      buildZone({
        id: "support-cast",
        symbol: "CAST",
        kind: "support",
        representativePrice: 1.95,
        strengthLabel: "major",
        timeframeSources: ["daily"],
      }),
    ],
    majorResistance: [
      buildZone({
        id: "resistance-cast",
        symbol: "CAST",
        kind: "resistance",
        representativePrice: 2.5,
        strengthLabel: "major",
        timeframeSources: ["daily"],
      }),
    ],
  }));
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore,
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: new FakeWatchlistStatePersistence() as any,
    liveWatchlistPublisher,
    pullbackReadEnabled: true,
  });
  const technicalContext: TechnicalContext = {
    source: "levels_system_intraday",
    sourceTimeframe: "5m",
    provider: "yahoo",
    sessionDate: "2026-07-10",
    updatedAt: 1_000,
    candleCount: 80,
    currentPrice: 2.2,
    vwap: 1.9,
    ema9: 1.95,
    ema20: 1.8,
    priceVsVwapPct: 13.6364,
    priceVsEma9Pct: 11.3636,
    priceVsEma20Pct: 18.1818,
    aboveVwap: true,
    aboveEma9: true,
    aboveEma20: true,
    confidence: "high",
    diagnostics: [],
  };

  (manager as any).publishWebsitePullbackTraderRead({
    symbol: "CAST",
    timestamp: 1_000,
    currentPrice: 2.2,
    technicalContext,
    volumeRead: {
      label: "strong",
      currentVolume: 500_000,
      averageVolume: 100_000,
      relativeVolumeRatio: 5,
      reason: "latest 5m volume is 5.00x recent average",
    },
  });
  await waitForAsyncWork();

  (manager as any).publishWebsitePullbackTraderRead({
    symbol: "CAST",
    timestamp: 2_000,
    currentPrice: 2.2,
    technicalContext,
    volumeRead: {
      label: "fading",
      currentVolume: 50_000,
      averageVolume: 100_000,
      relativeVolumeRatio: 0.5,
      reason: "latest 5m volume is 0.50x recent average",
    },
  });
  await waitForAsyncWork();

  assert.equal(liveWatchlistPublisher.cardPatches.length, 2);
  assert.match(liveWatchlistPublisher.cardPatches[0]?.cards.liveTraderRead?.body ?? "", /Volume read: strong/);
  assert.match(liveWatchlistPublisher.cardPatches[1]?.cards.liveTraderRead?.body ?? "", /Volume read: fading/);
});

test("live trade setup series uses only completed 5m candles and builds causal regular-session 4h bars", () => {
  const sessionOpen = Date.parse("2026-07-15T09:30:00-04:00");
  const fiveMinuteCandles = Array.from({ length: 50 }, (_, index): Candle => ({
    timestamp: sessionOpen + index * 5 * 60 * 1000,
    open: 1 + index * 0.01,
    high: 1.03 + index * 0.01,
    low: 0.98 + index * 0.01,
    close: 1.02 + index * 0.01,
    volume: 100_000 + index,
  }));
  const evaluatedAt = sessionOpen + 49 * 5 * 60 * 1000;
  const oldFourHour = buildTestCandle(1, 0.8, 0.9, 0.75, 0.85);
  const staleCurrentSessionFourHour: Candle = {
    timestamp: sessionOpen,
    open: 9,
    high: 10,
    low: 8,
    close: 9.5,
    volume: 1,
  };
  const fiveMinuteResponse = {
    ...buildTestCandleResponse("5m", fiveMinuteCandles),
    requestedLookbackBars: 120,
  };
  const fourHourResponse = {
    ...buildTestCandleResponse("4h", [oldFourHour, staleCurrentSessionFourHour]),
    requestedLookbackBars: 240,
  };
  const dailyResponse = {
    ...buildTestCandleResponse("daily", []),
    requestedLookbackBars: 180,
  };

  const result = buildLiveTradeSetupSeriesMap({
    baseSeriesMap: {
      daily: dailyResponse,
      "4h": fourHourResponse,
      "5m": fiveMinuteResponse,
    },
    fiveMinuteCandles,
    evaluatedAt,
  });

  assert.equal(result["5m"].candles.length, 49);
  assert.equal(result["5m"].candles.at(-1)?.timestamp, sessionOpen + 48 * 5 * 60 * 1000);
  assert.equal(result["5m"].providerMetadata?.tradeSetupCompletedFiveMinuteOnly, true);
  const currentSessionFourHour = result["4h"].candles.filter((candle) => candle.timestamp >= sessionOpen);
  assert.equal(currentSessionFourHour.length, 2);
  assert.equal(currentSessionFourHour[0]?.close, fiveMinuteCandles[47]?.close);
  assert.equal(currentSessionFourHour[1]?.timestamp, sessionOpen + 48 * 5 * 60 * 1000);
  assert.equal(currentSessionFourHour[1]?.close, fiveMinuteCandles[48]?.close);
  assert.equal(result["4h"].providerMetadata?.tradeSetupCausalFourHourSourceBars, 49);
  assert.equal(result["4h"].candles.some((candle) => candle.open === 9), false);
});

test("ManualWatchlistRuntimeManager stores the V2 small-cap thesis for live observation snapshots", () => {
  const sessionOpen = Date.parse("2026-07-15T09:30:00-04:00");
  const values = [
    [1.00, 1.08, 0.98, 1.05],
    [1.05, 1.12, 1.02, 1.10],
    [1.10, 1.18, 1.08, 1.16],
    [1.16, 1.20, 1.12, 1.18],
    [1.18, 1.20, 1.14, 1.17],
    [1.17, 1.19, 1.13, 1.18],
    [1.18, 1.31, 1.17, 1.28],
    [1.28, 1.42, 1.26, 1.38],
    [1.38, 1.40, 1.30, 1.34],
    [1.34, 1.36, 1.24, 1.27],
    [1.27, 1.30, 1.18, 1.23],
    [1.23, 1.27, 1.21, 1.25],
    [1.25, 1.32, 1.23, 1.30],
  ] as const;
  const candles = values.map(([open, high, low, close], index): Candle => ({
    timestamp: sessionOpen + index * 5 * 60 * 1000,
    open,
    high,
    low,
    close,
    volume: 200_000 + index * 10_000,
  }));
  const evaluatedAt = candles.at(-1)!.timestamp + 5 * 60 * 1000;
  const persistence = new FakeWatchlistStatePersistence();
  const watchlistStore = new WatchlistStore();
  persistence.storedEntries = [{
    symbol: "SCAP",
    active: true,
    priority: 1,
    tags: ["manual"],
    lifecycle: "active",
    refreshPending: false,
    lastPrice: 1.30,
    lastPriceUpdateAt: evaluatedAt,
  }];
  watchlistStore.setEntries(persistence.storedEntries);
  const levelStore = new LevelStore();
  const output = buildLevelOutput("SCAP", {
    metadata: {
      providerByTimeframe: {},
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 1.30,
    },
  });
  levelStore.setLevels(output);
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
  });
  const seriesMap = {
    daily: { ...buildTestCandleResponse("daily", []), requestedLookbackBars: 180 },
    "4h": { ...buildTestCandleResponse("4h", []), requestedLookbackBars: 240 },
    "5m": { ...buildTestCandleResponse("5m", candles), requestedLookbackBars: 120 },
  };

  const read = (manager as any).refreshTradeSetupThesisReadForSymbol({
    symbol: "SCAP",
    currentPrice: 1.30,
    baseSeriesMap: seriesMap,
    fiveMinuteCandles: candles,
    evaluatedAt,
  });

  assert.equal(read?.type, "small_cap_opening_range_retest");
  assert.equal((manager as any).tradeSetupThesisReadBySymbol.get("SCAP")?.type, read?.type);
  const payload = (manager as any).buildLevelSnapshotPayload("SCAP", evaluatedAt);
  assert.equal(payload.tradeSetupThesisRead?.type, "small_cap_opening_range_retest");
});

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
  assert.deepEqual(
    candleFetchService.requests.map((request) => request.endTimeMs),
    [undefined, undefined, undefined],
  );
});

test("ManualWatchlistRuntimeManager pins EODHD higher-timeframe level seeding to prior confirmed structure", async () => {
  const fixedNow = Date.parse("2026-07-10T15:00:00-04:00");
  assert.equal(
    resolveEodhdConfirmedLevelRequestEndTimeMs("daily", fixedNow),
    Date.parse("2026-07-09T12:00:00.000Z"),
  );
  assert.equal(
    resolveEodhdConfirmedLevelRequestEndTimeMs("4h", fixedNow),
    Date.parse("2026-07-10T04:00:00.000Z"),
  );
  assert.equal(resolveEodhdConfirmedLevelRequestEndTimeMs("5m", fixedNow), undefined);

  const originalNow = Date.now;
  Date.now = () => fixedNow;
  try {
    const monitor = new FakeMonitor();
    const discordAlertRouter = new FakeDiscordAlertRouter();
    const persistence = new FakeWatchlistStatePersistence();
    persistence.storedEntries = [];
    const candleFetchService = new RecordingCandleFetchService("eodhd");
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

    const daily = candleFetchService.requests.find((request) => request.timeframe === "daily");
    const fourHour = candleFetchService.requests.find((request) => request.timeframe === "4h");
    const fiveMinute = candleFetchService.requests.find((request) => request.timeframe === "5m");

    assert.equal(daily?.endTimeMs, Date.parse("2026-07-09T12:00:00.000Z"));
    assert.equal(fourHour?.endTimeMs, Date.parse("2026-07-10T04:00:00.000Z"));
    assert.equal(fiveMinute?.endTimeMs, undefined);
  } finally {
    Date.now = originalNow;
  }
});

test("ManualWatchlistRuntimeManager exposes level seed stats and restart readiness", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  persistence.storedEntries = [];
  const levelStore = new LevelStore();
  const watchlistStore = new WatchlistStore();
  watchlistStore.upsertManualEntry({
    symbol: "ALBT",
    active: true,
    lifecycle: "refresh_pending",
    discordThreadId: "thread-albt",
    operationStatus: "loading candles and building levels",
  });
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await (manager as any).seedLevelsForSymbol("ALBT", { force: true });
  const health = manager.getRuntimeHealth();

  assert.equal(health.providerHealth.seedStats.attempts, 1);
  assert.equal(health.providerHealth.seedStats.successes, 1);
  assert.equal(health.providerHealth.seedStats.failures, 0);
  assert.equal(health.providerHealth.seedStats.inFlight, 0);
  assert.equal(health.providerHealth.restartReadiness[0]?.symbol, "ALBT");
  assert.equal(health.providerHealth.restartReadiness[0]?.levelStatus, "ready");
  assert.equal(health.providerHealth.restartReadiness[0]?.priceStatus, "waiting");
  assert.equal(health.providerHealth.restartReadiness[0]?.discordStatus, "ready");
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

test("ManualWatchlistRuntimeManager hot-swaps the live provider and resubscribes ready entries", async () => {
  const monitor = new FakeMonitor();
  const previousProvider = new FakeLivePriceProvider("ibkr");
  const nextProvider = new FakeLivePriceProvider("eodhd");
  monitor.currentLivePriceProvider = previousProvider;
  const levelStore = new LevelStore();
  const watchlistStore = new WatchlistStore();
  watchlistStore.upsertManualEntry({
    symbol: "ALBT",
    active: true,
    discordThreadId: "thread-albt",
    lifecycle: "active",
  });
  levelStore.setLevels(buildLevelOutput("ALBT"));
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: new FakeWatchlistStatePersistence() as any,
    liveWatchlistPublisher: null,
  });
  (manager as any).isStarted = true;

  await manager.switchLivePriceProvider(nextProvider as any);

  assert.equal(previousProvider.stopCalls, 1);
  assert.deepEqual(monitor.providerSetCalls, [nextProvider]);
  assert.equal(monitor.currentLivePriceProvider, nextProvider);
  assert.deepEqual(monitor.startCalls.at(-1)?.map((entry) => entry.symbol), ["ALBT"]);
});

test("ManualWatchlistRuntimeManager restores the previous live provider when the new provider cannot subscribe", async () => {
  const monitor = new FakeMonitor();
  const previousProvider = new FakeLivePriceProvider("ibkr");
  const nextProvider = new FakeLivePriceProvider("eodhd");
  monitor.currentLivePriceProvider = previousProvider;
  monitor.failNextStart = new Error("new provider subscribe failed");
  const levelStore = new LevelStore();
  const watchlistStore = new WatchlistStore();
  watchlistStore.upsertManualEntry({
    symbol: "ALBT",
    active: true,
    discordThreadId: "thread-albt",
    lifecycle: "active",
  });
  levelStore.setLevels(buildLevelOutput("ALBT"));
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: new FakeWatchlistStatePersistence() as any,
    liveWatchlistPublisher: null,
  });
  (manager as any).isStarted = true;

  await assert.rejects(
    manager.switchLivePriceProvider(nextProvider as any),
    /new provider subscribe failed/,
  );

  assert.equal(previousProvider.stopCalls, 1);
  assert.equal(nextProvider.stopCalls, 1);
  assert.deepEqual(monitor.providerSetCalls, [nextProvider, previousProvider]);
  assert.equal(monitor.currentLivePriceProvider, previousProvider);
  assert.deepEqual(monitor.startCalls.map((entries) => entries.map((entry) => entry.symbol)), [
    ["ALBT"],
    ["ALBT"],
  ]);
});

test("ManualWatchlistRuntimeManager anchors queued activation snapshot to stock context current price", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  persistence.storedEntries = [];
  const levelStore = new LevelStore();
  const watchlistStore = new WatchlistStore();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    stockContextProvider: {
      async getThreadPreview(symbol: string) {
        return {
          symbol,
          quote: { c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0, t: 0 },
          profile: {
            name: "Digi Power X Inc",
            exchange: "TSX VENTURE EXCHANGE - NEX",
            finnhubIndustry: "Technology",
            marketCapitalization: 264.98,
            shareOutstanding: 70.47,
          },
          yahoo: {
            source: "Yahoo" as const,
            symbol,
            fetchedAt: Date.now(),
            quote: {
              source: "Yahoo" as const,
              symbol,
              preMarketPrice: 4.96,
              preMarketTime: nowSeconds,
            },
            errors: [],
          },
        };
      },
    },
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 4.15,
        },
        majorSupport: [
          buildZone({
            id: "S-DGXX",
            symbol,
            kind: "support",
            zoneLow: 4.48,
            zoneHigh: 4.52,
            representativePrice: 4.51,
            timeframeSources: ["daily"],
            timeframeBias: "daily",
          }),
        ],
        majorResistance: [
          buildZone({
            id: "R-DGXX",
            symbol,
            kind: "resistance",
            zoneLow: 5.04,
            zoneHigh: 5.08,
            representativePrice: 5.07,
            timeframeSources: ["daily"],
            timeframeBias: "daily",
          }),
        ],
      }));
    },
  });

  await manager.queueActivation({ symbol: "DGXX" });
  for (let attempt = 0; attempt < 10 && discordAlertRouter.levelSnapshots.length === 0; attempt += 1) {
    await waitForAsyncWork();
  }

  const snapshot = discordAlertRouter.levelSnapshots[0]?.payload;
  assert.equal(snapshot?.currentPrice, 4.96);
  assert.equal(snapshot?.audit?.referencePriceSource, "live_price");
  assert.equal(snapshot?.audit?.metadataReferencePrice, 4.15);
  assert.equal(watchlistStore.getEntry("DGXX")?.lastPrice, 4.96);
  assert.equal(
    liveWatchlistPublisher.tickerDataPatches.some(
      (patch) => patch.symbol === "DGXX" && patch.latestPrice === 4.96,
    ),
    true,
  );
  assert.match(discordAlertRouter.routed[0]?.payload.body ?? "", /Current price: 4\.96 \(premarket\)/);
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
    fastLevelClearCoalesceMs: 20,
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

test("ManualWatchlistRuntimeManager restores cached levels but waits for fresh candles before startup snapshot", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const lifecycleEvents: ManualWatchlistLifecycleEvent[] = [];
  let freshSeedCount = 0;
  const startupCachedCandleFetchService = new RecordingCandleFetchService();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    startupCachedCandleFetchService: startupCachedCandleFetchService as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    lifecycleListener: (event) => lifecycleEvents.push(event),
    seedSymbolLevels: async (symbol: string) => {
      freshSeedCount += 1;
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [buildZone({ id: "S1", symbol, kind: "support" })],
        intradayResistance: [buildZone({ id: "R1", symbol, kind: "resistance" })],
      }));
    },
  });

  await manager.start();

  assert.equal(startupCachedCandleFetchService.requests.length, 3);
  assert.equal(freshSeedCount, 1);
  assert.equal(discordAlertRouter.levelSnapshots.length, 1);
  assert.equal(
    lifecycleEvents.some(
      (event) => event.event === "levels_seeded" && event.details?.source === "startup_cache",
    ),
    true,
  );
  const health = manager.getRuntimeHealth();
  assert.equal(health.providerHealth.startupCache.enabled, true);
  assert.equal(health.providerHealth.startupCache.restoredSymbols[0]?.symbol, "BIRD");
  assert.equal(health.providerHealth.startupCache.warmingSymbols.length, 0);
  assert.equal(health.providerHealth.startupCache.blockedSnapshotSymbols.length, 0);
  assert.equal(manager.getActiveEntries()[0]?.operationStatus, "monitoring live price");
});

test("ManualWatchlistRuntimeManager does not post cached-only startup snapshots when fresh seed fails", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const startupCachedCandleFetchService = new RecordingCandleFetchService();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    startupCachedCandleFetchService: startupCachedCandleFetchService as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async () => {
      throw new Error("fresh provider unavailable");
    },
  });

  await manager.start();

  const entry = manager.getActiveEntries()[0];
  assert.equal(startupCachedCandleFetchService.requests.length, 3);
  assert.equal(discordAlertRouter.levelSnapshots.length, 0);
  assert.equal(entry?.lifecycle, "refresh_pending");
  assert.equal(entry?.operationStatus, "levels restored from cache, fresh candle refresh failed");
  assert.match(entry?.lastError ?? "", /fresh provider unavailable/);
  const health = manager.getRuntimeHealth();
  assert.deepEqual(health.providerHealth.startupCache.warmingSymbols, ["BIRD"]);
  assert.equal(health.providerHealth.startupCache.blockedSnapshotSymbols[0]?.symbol, "BIRD");
  assert.match(health.providerHealth.startupCache.blockedSnapshotSymbols[0]?.reason ?? "", /fresh provider unavailable/);
});

test("ManualWatchlistRuntimeManager starts monitoring restored symbols while later startup restores are still slow", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const lifecycleEvents: ManualWatchlistLifecycleEvent[] = [];
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
    lifecycleListener: (event) => lifecycleEvents.push(event),
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

test("ManualWatchlistRuntimeManager clears stale refresh-pending state when a startup seed finishes after timeout", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const lifecycleEvents: ManualWatchlistLifecycleEvent[] = [];
  let seedAttempts = 0;
  persistence.storedEntries = [
    {
      symbol: "OSRH",
      active: true,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-OSRH",
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
    levelSeedTimeoutMs: 5,
    queuedActivationSeedGraceTimeoutMs: 0,
    seedSymbolLevels: async (symbol: string) => {
      seedAttempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [buildZone({ id: `${symbol}-S1`, symbol, kind: "support" })],
        intradayResistance: [buildZone({ id: `${symbol}-R1`, symbol, kind: "resistance" })],
      }));
    },
  });

  await manager.start();
  await new Promise((resolve) => setTimeout(resolve, 40));

  const recoveredEntry = manager.getActiveEntries().find((entry) => entry.symbol === "OSRH");
  assert.equal(
    lifecycleEvents.some(
      (event) =>
        event.event === "restore_failed" &&
        event.symbol === "OSRH" &&
        String(event.details?.error ?? "").includes("Level seeding timed out for OSRH"),
    ),
    true,
  );
  assert.equal(seedAttempts >= 1, true);
  assert.equal(recoveredEntry?.lifecycle, "active");
  assert.equal(recoveredEntry?.refreshPending, false);
  assert.equal(recoveredEntry?.lastError ?? null, null);
  assert.equal(recoveredEntry?.operationStatus, "monitoring live price");
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

  const failedEntry = (manager as any).watchlistStore.getEntry("UCAR") as WatchlistEntry | undefined;
  assert.equal(failedEntry?.active, false);
  assert.equal(manager.getActiveEntries().some((entry) => entry.symbol === "UCAR"), false);
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

test("ManualWatchlistRuntimeManager treats adding an already-active ticker as an idempotent no-op", async () => {
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const persistence = new FakeWatchlistStatePersistence();
  const watchlistStore = new WatchlistStore();
  const oldActivatedAt = Date.UTC(2026, 6, 10, 13, 30, 0);
  watchlistStore.setEntries([
    {
      symbol: "FTRK",
      active: true,
      priority: 1,
      tags: ["manual"],
      note: "old test add",
      discordThreadId: "thread-FTRK",
      lifecycle: "active",
      refreshPending: false,
      activatedAt: oldActivatedAt,
      operationStatus: "monitoring live price",
    },
  ]);
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore: new LevelStore(),
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
  });
  const persistedBeforeDuplicateAdd = structuredClone(persistence.storedEntries);

  const existing = await manager.queueActivation({ symbol: "FTRK", note: "today add" });

  assert.equal(manager.getActiveEntries().length, 1);
  assert.equal(existing.symbol, "FTRK");
  assert.equal(existing.activatedAt, oldActivatedAt);
  assert.equal(existing.note, "old test add");
  assert.deepEqual(persistence.storedEntries, persistedBeforeDuplicateAdd);
  assert.equal(liveWatchlistPublisher.cardPatches.length, 0);
});

test("ManualWatchlistRuntimeManager automatically generates an AI clean read after activation snapshot", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const lifecycleEvents: ManualWatchlistLifecycleEvent[] = [];
  const cleanReadInputs: any[] = [];
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
    autoCleanReadGenerator: async (input) => {
      cleanReadInputs.push(input);
      return {
        id: "clean-read-1",
        model: "gpt-test",
        text: "Clean read:\n$1.90-$2.45 = key hold / reclaim area",
      };
    },
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 2.2,
        },
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 1.9,
            zoneHigh: 2.0,
            representativePrice: 1.95,
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.4,
            zoneHigh: 2.5,
            representativePrice: 2.45,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({
    symbol: "albt",
    note: "Only trust a clean read if volume expands.",
  });
  await waitForAsyncWork();

  assert.equal(cleanReadInputs.length, 1);
  assert.equal(cleanReadInputs[0]?.symbol, "ALBT");
  assert.equal(cleanReadInputs[0]?.currentPrice, "2.20");
  assert.equal(cleanReadInputs[0]?.aiPromptNotes, "Only trust a clean read if volume expands.");
  assert.match(cleanReadInputs[0]?.ladderText ?? "", /ALBT full level ladder/);
  assert.match(cleanReadInputs[0]?.ladderText ?? "", /Resistance:/);
  assert.match(cleanReadInputs[0]?.ladderText ?? "", /Support:/);
  assert.equal(
    lifecycleEvents.some((event) => event.event === "ai_clean_read_requested" && event.symbol === "ALBT"),
    true,
  );
  assert.equal(
    lifecycleEvents.some(
      (event) =>
        event.event === "ai_clean_read_generated" &&
        event.symbol === "ALBT" &&
        event.details?.recordId === "clean-read-1",
    ),
    true,
  );
});

test("ManualWatchlistRuntimeManager retries an aborted automatic AI clean read", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const lifecycleEvents: ManualWatchlistLifecycleEvent[] = [];
  let attempts = 0;
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
    autoCleanReadGenerator: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("This operation was aborted");
      }
      return {
        id: "clean-read-retry",
        model: "gpt-test",
        text: "Clean read:\n$1.90-$2.45 = key hold / reclaim area",
      };
    },
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 2.2,
        },
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            representativePrice: 1.95,
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            representativePrice: 2.45,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  await waitMs(1100);

  assert.equal(attempts, 2);
  assert.equal(
    lifecycleEvents.some((event) => event.event === "ai_clean_read_retrying" && event.symbol === "ALBT"),
    true,
  );
  assert.equal(
    lifecycleEvents.some(
      (event) =>
        event.event === "ai_clean_read_generated" &&
        event.symbol === "ALBT" &&
        event.details?.recordId === "clean-read-retry",
    ),
    true,
  );
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

test("ManualWatchlistRuntimeManager bulk deactivates once while preserving Discord thread ids", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "MAIN" });
  await manager.activateSymbol({ symbol: "POST" });
  await manager.activateSymbol({ symbol: "KEEP" });
  const stopCallsBeforeBulkRemoval = monitor.stopCalls;
  liveWatchlistPublisher.cardPatches = [];

  const deactivated = await manager.deactivateSymbols(["main", "POST", "missing", "MAIN"]);

  assert.deepEqual(deactivated.map((entry) => entry.symbol), ["MAIN", "POST"]);
  assert.deepEqual(manager.getActiveEntries().map((entry) => entry.symbol), ["KEEP"]);
  assert.equal(monitor.stopCalls, stopCallsBeforeBulkRemoval + 1);
  assert.equal(persistence.storedEntries.find((entry) => entry.symbol === "MAIN")?.discordThreadId, "thread-MAIN");
  assert.equal(persistence.storedEntries.find((entry) => entry.symbol === "POST")?.discordThreadId, "thread-POST");
  assert.deepEqual(
    liveWatchlistPublisher.cardPatches.map((patch) => [patch.symbol, patch.status]),
    [["MAIN", "deactivated"], ["POST", "deactivated"]],
  );
});

test("ManualWatchlistRuntimeManager publishes a full deactivation snapshot for website archives", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            representativePrice: 1.95,
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            representativePrice: 2.45,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "CAST" });
  await waitForAsyncWork();

  liveWatchlistPublisher.cardPatches = [];
  await manager.deactivateSymbol("CAST");
  await waitForAsyncWork();

  assert.equal(liveWatchlistPublisher.cardPatches.length, 1);
  const patch = liveWatchlistPublisher.cardPatches[0];
  assert.equal(patch?.symbol, "CAST");
  assert.equal(patch?.status, "deactivated");
  assert.equal(patch?.cards.fullLadder?.source, "level_snapshot");
  assert.equal(patch?.cards.levelMap, null);
  assert.equal(patch?.cards.nearestSupportResistance?.source, "level_snapshot");
  assert.equal(patch?.cards.liveTraderRead?.source, "level_snapshot");
});

test("ManualWatchlistRuntimeManager can hide and restore the live website Trader Read card", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            representativePrice: 1.95,
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            representativePrice: 2.45,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "CAST" });
  await waitForAsyncWork();

  liveWatchlistPublisher.cardPatches = [];
  const hiddenResult = await manager.setLiveTraderReadCardVisible(false);

  assert.equal(hiddenResult.visible, false);
  assert.deepEqual(hiddenResult.refreshedSymbols, ["CAST"]);
  assert.equal(manager.getRuntimeHealth().liveTraderReadCardVisible, false);
  assert.equal(liveWatchlistPublisher.cardPatches.length, 1);
  assert.equal(liveWatchlistPublisher.cardPatches[0]?.cards.liveTraderRead, null);

  liveWatchlistPublisher.cardPatches = [];
  const visibleResult = await manager.setLiveTraderReadCardVisible(true);
  await waitForAsyncWork();

  assert.equal(visibleResult.visible, true);
  assert.deepEqual(visibleResult.refreshedSymbols, ["CAST"]);
  assert.equal(manager.getRuntimeHealth().liveTraderReadCardVisible, true);
  assert.equal(liveWatchlistPublisher.cardPatches.length, 1);
  assert.equal(liveWatchlistPublisher.cardPatches[0]?.cards.liveTraderRead?.source, "level_snapshot");
});

test("ManualWatchlistRuntimeManager can hide and restore the live website Potential Gain card", async () => {
  const persistence = new FakeWatchlistStatePersistence();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const watchlistStore = new WatchlistStore();
  watchlistStore.upsertManualEntry({
    symbol: "GAIN",
    active: true,
    lifecycle: "active",
    activatedAt: 1000,
  });
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore: new LevelStore(),
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
  });

  liveWatchlistPublisher.cardPatches = [];

  const hidden = await manager.setPotentialGainCardVisible(false);
  assert.equal(hidden.visible, false);
  assert.deepEqual(hidden.refreshedSymbols, ["GAIN"]);
  assert.equal(manager.getRuntimeHealth().potentialGainCardVisible, false);
  assert.equal(liveWatchlistPublisher.cardPatches[0]?.potentialGainCardVisible, false);

  liveWatchlistPublisher.cardPatches = [];
  const visible = await manager.setPotentialGainCardVisible(true);
  assert.equal(visible.visible, true);
  assert.equal(manager.getRuntimeHealth().potentialGainCardVisible, true);
  assert.equal(liveWatchlistPublisher.cardPatches[0]?.potentialGainCardVisible, true);
});

test("ManualWatchlistRuntimeManager refreshes live trader read from same-day catalyst card context", async () => {
  const persistence = new FakeWatchlistStatePersistence();
  const watchlistStore = new WatchlistStore();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const now = Date.now();
  persistence.storedEntries = [
    {
      symbol: "CAT",
      active: true,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-cat",
      lifecycle: "active",
      refreshPending: false,
      activatedAt: now,
      lastPrice: 2.35,
      lastPriceUpdateAt: now,
    },
  ];
  watchlistStore.setEntries(persistence.storedEntries);
  const output = buildLevelOutput("CAT", {
    metadata: {
      providerByTimeframe: {},
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 2.35,
    },
  });
  levelStore.setLevels(output);
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore,
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    recentWebsiteArticlesExecFileImpl: async () => ({
      stderr: "",
      stdout: JSON.stringify({
        ticker: "CAT",
        businessDays: 7,
        count: 1,
        articles: [
          {
            ticker: "CAT",
            title: "CAT announces same-day catalyst",
            url: "https://traderslink.pro/news/cat-announces-same-day-catalyst",
            publishedAt: new Date(now).toISOString(),
          },
        ],
      }),
    }),
  });
  const seriesMap = {
    daily: buildTestCandleResponse("daily", []),
    "4h": buildTestCandleResponse("4h", [
      buildTestCandle(1, 1.2, 1.32, 1.15, 1.24),
      buildTestCandle(2, 1.24, 1.38, 1.18, 1.3),
      buildTestCandle(3, 1.3, 1.44, 1.22, 1.34),
      buildTestCandle(4, 1.34, 1.48, 1.26, 1.4),
      buildTestCandle(5, 1.4, 1.52, 1.32, 1.45),
      buildTestCandle(6, 1.45, 1.58, 1.36, 1.5),
      buildTestCandle(7, 1.5, 1.66, 1.42, 1.56),
      buildTestCandle(8, 1.58, 2.48, 1.52, 2.35),
    ]),
    "5m": buildTestCandleResponse("5m", []),
  };

  (manager as any).storeTechnicalContextForSymbol("CAT", output, seriesMap);
  assert.notEqual(
    (manager as any).potentialMoveReadBySymbol.get("CAT")?.type,
    "catalyst_active_runner_continuation",
  );

  (manager as any).publishRecentWebsiteArticles("CAT");
  await waitForAsyncWork();
  await waitForAsyncWork();

  assert.equal(
    (manager as any).potentialMoveReadBySymbol.get("CAT")?.type,
    "catalyst_active_runner_continuation",
  );
  const snapshotPatch = liveWatchlistPublisher.cardPatches
    .slice()
    .reverse()
    .find((patch) => Boolean(patch.cards.liveTraderRead));
  assert.match(snapshotPatch?.cards.liveTraderRead?.body ?? "", /same-day catalyst card/);
  assert.match(snapshotPatch?.cards.liveTraderRead?.body ?? "", /active 4h runner candle/);
});

test("ManualWatchlistRuntimeManager can refresh live trader read from raw press-release catalyst context", async () => {
  const persistence = new FakeWatchlistStatePersistence();
  const watchlistStore = new WatchlistStore();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const now = Date.now();
  persistence.storedEntries = [
    {
      symbol: "RAW",
      active: true,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-raw",
      lifecycle: "active",
      refreshPending: false,
      activatedAt: now,
      lastPrice: 2.35,
      lastPriceUpdateAt: now,
    },
  ];
  watchlistStore.setEntries(persistence.storedEntries);
  const output = buildLevelOutput("RAW", {
    metadata: {
      providerByTimeframe: {},
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 2.35,
    },
  });
  levelStore.setLevels(output);
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore,
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    pressReleaseCatalystContextEnabled: true,
    recentWebsiteArticlesExecFileImpl: async () => ({
      stderr: "",
      stdout: JSON.stringify({
        ticker: "RAW",
        businessDays: 7,
        count: 0,
        articles: [],
      }),
    }),
    pressReleaseCatalystExecFileImpl: async () => ({
      stderr: "",
      stdout: JSON.stringify({
        available: true,
        databasePath: "test.db",
        articlesBySymbol: {
          RAW: [
            {
              ingestEventId: "raw-1",
              ticker: "RAW",
              url: "raw-1",
              articlePath: null,
              title: "RAW announces same-day catalyst from ingest",
              publishedAt: new Date(now).toISOString(),
              eventType: "press_release",
              filingType: null,
              routeTag: null,
              sourceUrl: null,
              observedAt: null,
              sourceKind: "ingest_events",
            },
          ],
        },
      }),
    }),
  });
  const seriesMap = {
    daily: buildTestCandleResponse("daily", []),
    "4h": buildTestCandleResponse("4h", [
      buildTestCandle(1, 1.2, 1.32, 1.15, 1.24),
      buildTestCandle(2, 1.24, 1.38, 1.18, 1.3),
      buildTestCandle(3, 1.3, 1.44, 1.22, 1.34),
      buildTestCandle(4, 1.34, 1.48, 1.26, 1.4),
      buildTestCandle(5, 1.4, 1.52, 1.32, 1.45),
      buildTestCandle(6, 1.45, 1.58, 1.36, 1.5),
      buildTestCandle(7, 1.5, 1.66, 1.42, 1.56),
      buildTestCandle(8, 1.58, 2.48, 1.52, 2.35),
    ]),
    "5m": buildTestCandleResponse("5m", []),
  };

  (manager as any).storeTechnicalContextForSymbol("RAW", output, seriesMap);
  (manager as any).publishRecentWebsiteArticles("RAW");
  await waitForAsyncWork();
  await waitForAsyncWork();

  assert.equal(
    (manager as any).potentialMoveReadBySymbol.get("RAW")?.type,
    "catalyst_active_runner_continuation",
  );
  const snapshotPatch = liveWatchlistPublisher.cardPatches
    .slice()
    .reverse()
    .find((patch) => Boolean(patch.cards.liveTraderRead));
  assert.match(snapshotPatch?.cards.liveTraderRead?.body ?? "", /fresh local press-release catalyst/);
  assert.match(snapshotPatch?.cards.liveTraderRead?.body ?? "", /RAW announces same-day catalyst from ingest/);
});

test("ManualWatchlistRuntimeManager does not use catalyst runner thesis for stale catalyst cards", async () => {
  const persistence = new FakeWatchlistStatePersistence();
  const watchlistStore = new WatchlistStore();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const now = Date.now();
  persistence.storedEntries = [
    {
      symbol: "CAT",
      active: true,
      priority: 1,
      tags: ["manual"],
      discordThreadId: "thread-cat",
      lifecycle: "active",
      refreshPending: false,
      activatedAt: now,
      lastPrice: 2.35,
      lastPriceUpdateAt: now,
    },
  ];
  watchlistStore.setEntries(persistence.storedEntries);
  const output = buildLevelOutput("CAT", {
    metadata: {
      providerByTimeframe: {},
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 2.35,
    },
  });
  levelStore.setLevels(output);
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: new RecordingCandleFetchService() as any,
    levelStore,
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    recentWebsiteArticlesExecFileImpl: async () => ({
      stderr: "",
      stdout: JSON.stringify({
        ticker: "CAT",
        businessDays: 7,
        count: 1,
        articles: [
          {
            ticker: "CAT",
            title: "CAT old catalyst",
            url: "https://traderslink.pro/news/cat-old-catalyst",
            publishedAt: new Date(now - 4 * 86_400_000).toISOString(),
          },
        ],
      }),
    }),
  });
  const seriesMap = {
    daily: buildTestCandleResponse("daily", []),
    "4h": buildTestCandleResponse("4h", [
      buildTestCandle(1, 1.2, 1.32, 1.15, 1.24),
      buildTestCandle(2, 1.24, 1.38, 1.18, 1.3),
      buildTestCandle(3, 1.3, 1.44, 1.22, 1.34),
      buildTestCandle(4, 1.34, 1.48, 1.26, 1.4),
      buildTestCandle(5, 1.4, 1.52, 1.32, 1.45),
      buildTestCandle(6, 1.45, 1.58, 1.36, 1.5),
      buildTestCandle(7, 1.5, 1.66, 1.42, 1.56),
      buildTestCandle(8, 1.58, 2.48, 1.52, 2.35),
    ]),
    "5m": buildTestCandleResponse("5m", []),
  };

  (manager as any).storeTechnicalContextForSymbol("CAT", output, seriesMap);
  (manager as any).publishRecentWebsiteArticles("CAT");
  await waitForAsyncWork();
  await waitForAsyncWork();

  assert.notEqual(
    (manager as any).potentialMoveReadBySymbol.get("CAT")?.type,
    "catalyst_active_runner_continuation",
  );
});

test("ManualWatchlistRuntimeManager publishes live volume in website ticker data", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support", representativePrice: 1.95 }),
        ],
        intradayResistance: [
          buildZone({ id: "R1", symbol, kind: "resistance", representativePrice: 2.45 }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "CAST" });
  await waitForAsyncWork();

  liveWatchlistPublisher.tickerDataPatches = [];
  monitor.onPriceUpdate?.({
    symbol: "CAST",
    timestamp: 3000,
    lastPrice: 2.12,
    volume: 123_456,
  });
  await waitForAsyncWork();

  assert.equal(liveWatchlistPublisher.tickerDataPatches.length, 1);
  assert.equal(liveWatchlistPublisher.tickerDataPatches[0]?.symbol, "CAST");
  assert.equal(liveWatchlistPublisher.tickerDataPatches[0]?.latestPrice, 2.12);
  assert.equal(liveWatchlistPublisher.tickerDataPatches[0]?.volume, 123_456);
});

test("ManualWatchlistRuntimeManager keeps stronger duplicate metadata in live website ticker levels", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S-displayed",
            symbol,
            kind: "support",
            representativePrice: 1.95,
            strengthLabel: "weak",
            timeframeSources: ["5m"],
          }),
        ],
        intradayResistance: [
          buildZone({ id: "R1", symbol, kind: "resistance", representativePrice: 2.45 }),
        ],
        extensionLevels: {
          support: [
            buildZone({
              id: "S-extension-duplicate",
              symbol,
              kind: "support",
              representativePrice: 1.95,
              strengthLabel: "major",
              isExtension: true,
            }),
          ],
          resistance: [],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "CAST" });
  await waitForAsyncWork();

  liveWatchlistPublisher.tickerDataPatches = [];
  monitor.onPriceUpdate?.({
    symbol: "CAST",
    timestamp: 3000,
    lastPrice: 2.12,
  });
  await waitForAsyncWork();

  const support = liveWatchlistPublisher.tickerDataPatches[0]?.levelMap?.supportLevels[0];
  assert.equal(support?.price, 1.95);
  assert.equal(support?.strengthLabel, "major");
  assert.equal(support?.sourceLabel, "extension");
  assert.match(support?.label ?? "", /major, .*extension/);
});

test("ManualWatchlistRuntimeManager keeps ticker data level map anchored to the active snapshot ladder", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
  });

  levelStore.setLevels(buildLevelOutput("FTRK", {
    intradayResistance: [
      buildZone({ id: "R-extra-near", symbol: "FTRK", kind: "resistance", representativePrice: 0.66 }),
      buildZone({ id: "R70", symbol: "FTRK", kind: "resistance", representativePrice: 0.7, strengthLabel: "major" }),
      buildZone({ id: "R7432-extra", symbol: "FTRK", kind: "resistance", representativePrice: 0.7432 }),
      buildZone({ id: "R75", symbol: "FTRK", kind: "resistance", representativePrice: 0.75, strengthLabel: "moderate" }),
      buildZone({ id: "R80-extra", symbol: "FTRK", kind: "resistance", representativePrice: 0.8 }),
    ],
  }));
  (manager as any).activeSnapshotState.set("FTRK", {
    displayedSupportZones: [],
    displayedResistanceZones: [
      { representativePrice: 0.65, strengthLabel: "moderate", sourceLabel: "4h structure" },
      { representativePrice: 0.7, strengthLabel: "moderate", sourceLabel: "4h structure" },
      { representativePrice: 0.75, strengthLabel: "major", sourceLabel: "daily confluence" },
    ],
  });

  (manager as any).publishLiveTickerData({
    symbol: "FTRK",
    timestamp: 3_000,
    lastPrice: 0.639,
  });
  await waitForAsyncWork();

  assert.deepEqual(
    liveWatchlistPublisher.tickerDataPatches[0]?.levelMap?.resistanceLevels.map((level) => level.price),
    [0.65, 0.7, 0.75],
  );
  assert.equal(liveWatchlistPublisher.tickerDataPatches[0]?.levelMap?.nearestResistance?.price, 0.65);
  assert.equal(
    liveWatchlistPublisher.tickerDataPatches[0]?.levelMap?.resistanceLevels.some((level) => level.price === 0.7432),
    false,
  );
  assert.equal(
    liveWatchlistPublisher.tickerDataPatches[0]?.levelMap?.resistanceLevels[1]?.strengthLabel,
    "major",
  );
  assert.equal(
    liveWatchlistPublisher.tickerDataPatches[0]?.levelMap?.resistanceLevels[1]?.sourceLabel,
    "4h structure",
  );
  assert.equal(
    liveWatchlistPublisher.tickerDataPatches[0]?.levelMap?.resistanceLevels[2]?.strengthLabel,
    "major",
  );
  assert.equal(
    liveWatchlistPublisher.tickerDataPatches[0]?.levelMap?.resistanceLevels[2]?.sourceLabel,
    "daily confluence",
  );

  liveWatchlistPublisher.cardPatches = [];
  (manager as any).publishWebsitePullbackTraderRead({
    symbol: "FTRK",
    timestamp: 4_000,
    currentPrice: 0.639,
    technicalContext: {
      source: "levels_system_intraday",
      sourceTimeframe: "5m",
      provider: "yahoo",
      sessionDate: "2026-07-13",
      updatedAt: 4_000,
      candleCount: 42,
      currentPrice: 0.639,
      vwap: 0.5,
      ema9: 0.58,
      ema20: 0.52,
      priceVsVwapPct: 27.8,
      priceVsEma9Pct: 10.2,
      priceVsEma20Pct: 22.9,
      aboveVwap: true,
      aboveEma9: true,
      aboveEma20: true,
      confidence: "high",
      diagnostics: [],
    } satisfies TechnicalContext,
  });
  await waitForAsyncWork();

  assert.deepEqual(
    liveWatchlistPublisher.cardPatches[0]?.levelMap?.resistanceLevels.map((level) => level.price),
    [0.65, 0.7, 0.75],
  );
  assert.equal(
    liveWatchlistPublisher.cardPatches[0]?.levelMap?.resistanceLevels[1]?.label,
    "0.7000 (+9.5%, major, 4h structure)",
  );
  assert.equal(
    liveWatchlistPublisher.cardPatches[0]?.levelMap?.resistanceLevels[2]?.label,
    "0.7500 (+17.4%, major, daily confluence)",
  );
});

test("ManualWatchlistRuntimeManager republishes technical context when live price flips VWAP and EMA posture", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    pullbackReadEnabled: false,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });
  const technicalContext: TechnicalContext = {
    source: "levels_system_intraday",
    sourceTimeframe: "5m",
    provider: "ibkr",
    sessionDate: "2026-07-09",
    updatedAt: 1_000,
    candleCount: 42,
    currentPrice: 1.9,
    vwap: 2,
    ema9: 2,
    ema20: 1.95,
    priceVsVwapPct: -5.2632,
    priceVsEma9Pct: -5.2632,
    priceVsEma20Pct: -2.6316,
    aboveVwap: false,
    aboveEma9: false,
    aboveEma20: false,
    confidence: "high",
    diagnostics: [],
  };

  await manager.start();
  await manager.activateSymbol({ symbol: "ABCD" });
  await waitForAsyncWork();
  (manager as any).technicalContextBySymbol.set("ABCD", technicalContext);
  liveWatchlistPublisher.cardPatches = [];
  liveWatchlistPublisher.tickerDataPatches = [];

  monitor.onPriceUpdate?.({
    symbol: "ABCD",
    timestamp: 2_000,
    lastPrice: 1.9,
  });
  await waitForAsyncWork();

  assert.equal(liveWatchlistPublisher.cardPatches.length, 1);
  assert.match(
    liveWatchlistPublisher.cardPatches[0]?.cards.technicalContext?.body ?? "",
    /bearish intraday posture/,
  );
  assert.equal(
    liveWatchlistPublisher.cardPatches[0]?.cards.technicalContext?.metadata?.aboveVwap,
    false,
  );

  monitor.onPriceUpdate?.({
    symbol: "ABCD",
    timestamp: 3_000,
    lastPrice: 1.91,
  });
  await waitForAsyncWork();

  assert.equal(liveWatchlistPublisher.cardPatches.length, 1);

  monitor.onPriceUpdate?.({
    symbol: "ABCD",
    timestamp: 4_000,
    lastPrice: 2.05,
  });
  await waitForAsyncWork();

  assert.equal(liveWatchlistPublisher.cardPatches.length, 2);
  assert.match(
    liveWatchlistPublisher.cardPatches[1]?.cards.technicalContext?.body ?? "",
    /bullish intraday posture/,
  );
  assert.match(
    liveWatchlistPublisher.cardPatches[1]?.cards.technicalContext?.body ?? "",
    /bullish short-term posture/,
  );
  assert.equal(
    liveWatchlistPublisher.cardPatches[1]?.cards.technicalContext?.metadata?.aboveVwap,
    true,
  );
  assert.equal(
    liveWatchlistPublisher.cardPatches[1]?.cards.technicalContext?.metadata?.aboveEma9,
    true,
  );
  assert.equal(
    liveWatchlistPublisher.cardPatches[1]?.cards.technicalContext?.metadata?.aboveEma20,
    true,
  );
});

test("ManualWatchlistRuntimeManager republishes technical context when price approaches indicator levels before crossing", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    pullbackReadEnabled: false,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });
  const technicalContext: TechnicalContext = {
    source: "levels_system_intraday",
    sourceTimeframe: "5m",
    provider: "ibkr",
    sessionDate: "2026-07-09",
    updatedAt: 1_000,
    candleCount: 42,
    currentPrice: 2.3,
    vwap: 2,
    ema9: 2.02,
    ema20: 1.95,
    priceVsVwapPct: 13.0435,
    priceVsEma9Pct: 12.1739,
    priceVsEma20Pct: 15.2174,
    aboveVwap: true,
    aboveEma9: true,
    aboveEma20: true,
    confidence: "high",
    diagnostics: [],
  };

  await manager.start();
  await manager.activateSymbol({ symbol: "ABCD" });
  await waitForAsyncWork();
  (manager as any).technicalContextBySymbol.set("ABCD", technicalContext);
  liveWatchlistPublisher.cardPatches = [];
  liveWatchlistPublisher.tickerDataPatches = [];

  monitor.onPriceUpdate?.({
    symbol: "ABCD",
    timestamp: 2_000,
    lastPrice: 2.3,
  });
  await waitForAsyncWork();

  assert.equal(liveWatchlistPublisher.cardPatches.length, 1);
  assert.match(
    liveWatchlistPublisher.cardPatches[0]?.cards.technicalContext?.body ?? "",
    /^Levels:/,
  );
  assert.doesNotMatch(
    liveWatchlistPublisher.cardPatches[0]?.cards.technicalContext?.body ?? "",
    /Pullback refs below:/,
  );
  assert.equal(
    liveWatchlistPublisher.cardPatches[0]?.cards.technicalContext?.metadata?.aboveVwap,
    true,
  );

  monitor.onPriceUpdate?.({
    symbol: "ABCD",
    timestamp: 4_000,
    lastPrice: 2.1,
  });
  await waitForAsyncWork();

  assert.equal(liveWatchlistPublisher.cardPatches.length, 2);
  assert.equal(
    liveWatchlistPublisher.cardPatches[1]?.cards.technicalContext?.metadata?.aboveVwap,
    true,
  );
  assert.equal(
    liveWatchlistPublisher.cardPatches[1]?.cards.technicalContext?.metadata?.aboveEma9,
    true,
  );
  assert.match(
    liveWatchlistPublisher.cardPatches[1]?.cards.technicalContext?.body ?? "",
    /VWAP 2\.00 \(\+4\.8%\)/,
  );
  assert.ok(
    Number(liveWatchlistPublisher.cardPatches[1]?.cards.technicalContext?.metadata?.priceVsVwapPct) < 5,
  );
});

test("ManualWatchlistRuntimeManager derives technical context from live 5m buckets when historical candles are not ready", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ZBAO" });
  await waitForAsyncWork();

  liveWatchlistPublisher.cardPatches = [];
  liveWatchlistPublisher.tickerDataPatches = [];
  const start = Date.UTC(2026, 6, 10, 8, 0, 0);
  for (let index = 0; index < 20; index += 1) {
    monitor.onPriceUpdate?.({
      symbol: "ZBAO",
      timestamp: start + index * 5 * 60 * 1000,
      lastPrice: 0.3 + index * 0.01,
      volume: 1_000 + index,
    });
  }
  await waitForAsyncWork();

  const readyPatch = [...liveWatchlistPublisher.cardPatches]
    .reverse()
    .find((patch) => patch.cards.technicalContext);
  assert.ok(readyPatch?.cards.technicalContext);
  assert.equal(readyPatch.cards.technicalContext.metadata?.provider, "live_stream");
  assert.equal(readyPatch.cards.technicalContext.metadata?.candleCount, 20);
  assert.equal(readyPatch.cards.technicalContext.metadata?.confidence, "medium");
  assert.match(readyPatch.cards.technicalContext.body, /EMA read:/);
  assert.match(readyPatch.cards.technicalContext.body, /VWAP read:/);
});

test("ManualWatchlistRuntimeManager starts live technical buckets after an empty historical placeholder", async () => {
  const monitor = new FakeMonitor();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ZBAO" });
  await waitForAsyncWork();

  (manager as any).technicalContextBySymbol.set("ZBAO", {
    source: "levels_system_intraday",
    sourceTimeframe: "5m",
    provider: "eodhd",
    sessionDate: "2026-07-10",
    updatedAt: null,
    candleCount: 0,
    currentPrice: null,
    vwap: null,
    ema9: null,
    ema20: null,
    priceVsVwapPct: null,
    priceVsEma9Pct: null,
    priceVsEma20Pct: null,
    aboveVwap: null,
    aboveEma9: null,
    aboveEma20: null,
    confidence: "unavailable",
    diagnostics: ["5m:unavailable", "missing_intraday_candles"],
  } satisfies TechnicalContext);

  liveWatchlistPublisher.cardPatches = [];
  const start = Date.UTC(2026, 6, 10, 8, 0, 0);
  for (let index = 0; index < 20; index += 1) {
    monitor.onPriceUpdate?.({
      symbol: "ZBAO",
      timestamp: start + index * 5 * 60 * 1000,
      lastPrice: 0.3 + index * 0.01,
      volume: 1_000 + index,
    });
  }
  await waitForAsyncWork();

  const readyPatch = [...liveWatchlistPublisher.cardPatches]
    .reverse()
    .find((patch) => patch.cards.technicalContext);
  assert.ok(readyPatch?.cards.technicalContext);
  assert.equal(readyPatch.cards.technicalContext.metadata?.provider, "live_stream");
  assert.equal(readyPatch.cards.technicalContext.metadata?.candleCount, 20);
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

  await new Promise((resolve) => setTimeout(resolve, 160));

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

test("ManualWatchlistRuntimeManager suppresses empty snapshots when levels are too far away to coach", async () => {
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
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 0.48,
        },
        intradayResistance: [
          buildZone({
            id: "R-far-1",
            symbol,
            kind: "resistance",
            representativePrice: 1.25,
            zoneLow: 1.25,
            zoneHigh: 1.26,
            timeframeBias: "daily",
            timeframeSources: ["daily"],
          }),
          buildZone({
            id: "R-far-2",
            symbol,
            kind: "resistance",
            representativePrice: 1.4,
            zoneLow: 1.4,
            zoneHigh: 1.4,
            timeframeBias: "4h",
            timeframeSources: ["4h"],
          }),
        ],
      }));
    },
  });

  await manager.start();
  const activated = await manager.activateSymbol({ symbol: "EZGO" });

  assert.equal(activated.symbol, "EZGO");
  assert.equal(discordAlertRouter.levelSnapshots.length, 0);
  assert.equal(manager.getActiveEntries()[0]?.lifecycle, "active");
  assert.equal(manager.getActiveEntries()[0]?.operationStatus, "monitoring live price");
  assert.equal(
    lifecycleEvents.some(
      (event) =>
        event.event === "alert_suppressed" &&
        event.symbol === "EZGO" &&
        event.details?.reason === "snapshot_no_actionable_levels",
    ),
    true,
  );
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
  assert.equal(queued.active, false);
  assert.equal(queued.refreshPending, true);
  assert.equal(queued.discordThreadId, "thread-BMGL");
  assert.equal(manager.getActiveEntries().length, 0);
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

test("ManualWatchlistRuntimeManager does not activate a ticker when the website snapshot is not acknowledged", async () => {
  const levelStore = new LevelStore();
  const persistence = new FakeWatchlistStatePersistence();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher: new FailingLiveWatchlistPublisher(),
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.queueActivation({ symbol: "NOACK" });
  await waitForAsyncWork();
  await waitForAsyncWork();

  const failed = (manager as any).watchlistStore.getEntry("NOACK") as WatchlistEntry | undefined;
  assert.equal(failed?.active, false);
  assert.equal(failed?.lifecycle, "activation_failed");
  assert.match(failed?.lastError ?? "", /website ingest unavailable/);
  assert.equal(manager.getActiveEntries().some((entry) => entry.symbol === "NOACK"), false);
});

test("ManualWatchlistRuntimeManager posts stock context into a newly created thread before the level snapshot", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  persistence.storedEntries = [];

  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
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

  monitor.onPriceUpdate?.({
    symbol: "EXMP",
    timestamp: 5_000,
    lastPrice: 12.5,
  });
  await waitForAsyncWork();

  assert.equal(liveWatchlistPublisher.tickerDataPatches[0]?.priorRegularClosePrice, 11.11);
  assert.equal(liveWatchlistPublisher.tickerDataPatches[0]?.priorRegularCloseSource, "Finnhub regular close");
  assert.equal(
    liveWatchlistPublisher.tickerDataPatches[0]?.moveFromPriorRegularClosePct,
    ((12.5 - 11.11) / 11.11) * 100,
  );
});

test("ManualWatchlistRuntimeManager preserves the source observation time when prior-close enrichment republishes a stored quote", async () => {
  const observationTime = Date.parse("2026-07-17T13:45:00Z");
  const enrichmentTime = observationTime + 45 * 60 * 1000;
  const watchlistStore = new WatchlistStore();
  watchlistStore.setEntries([
    {
      symbol: "STALE",
      active: true,
      priority: 1,
      tags: ["manual"],
      lifecycle: "active",
      refreshPending: false,
      lastPrice: 4.2,
      lastPriceUpdateAt: observationTime,
    },
  ]);
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore: new LevelStore(),
    monitor: new FakeMonitor() as any,
    discordAlertRouter: new FakeDiscordAlertRouter() as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: new FakeWatchlistStatePersistence() as any,
    liveWatchlistPublisher,
    stockContextProvider: {
      async getThreadPreview(symbolInput: string) {
        return {
          symbol: symbolInput.toUpperCase(),
          quote: { c: 4.2, d: 0, dp: 0, h: 4.3, l: 4.1, o: 4.15, pc: 4, t: 1_700_000_000 },
          profile: {
            country: "US",
            exchange: "NASDAQ",
            finnhubIndustry: "Technology",
            marketCapitalization: 850,
            name: "Stale Quote Corp",
            weburl: "https://example.com",
          },
        };
      },
    },
  });

  (manager as any).refreshPriorRegularClose("STALE", enrichmentTime);
  await waitForAsyncWork();
  await waitForAsyncWork();

  const patch = liveWatchlistPublisher.tickerDataPatches.at(-1);
  assert.equal(patch?.latestPrice, 4.2);
  assert.equal(patch?.marketDataObservedAt, observationTime);
  assert.equal(patch?.marketDataRevision, observationTime * 1_000);
});

test("ManualWatchlistRuntimeManager posts stock context when reactivating a reused thread", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  let previewCalls = 0;
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
        previewCalls += 1;
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
      levelStore.setLevels(buildLevelOutput(symbol));
    },
  });

  await manager.start();
  await manager.queueActivation({ symbol: "EXMP" });
  await waitForAsyncWork();
  await manager.deactivateSymbol("EXMP");
  await manager.queueActivation({ symbol: "EXMP" });
  await waitForAsyncWork();

  const stockContextPosts = discordAlertRouter.routed.filter(
    (item) => item.payload.metadata?.messageKind === "stock_context",
  );
  assert.equal(previewCalls, 2);
  assert.equal(stockContextPosts.length, 2);
  assert.equal(discordAlertRouter.ensured[1]?.storedThreadId, "thread-EXMP");
  assert.equal(discordAlertRouter.ensured[1]?.symbol, "EXMP");
});

test("ManualWatchlistRuntimeManager records stock context without consuming trader-story budget", async () => {
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
  });

  await (manager as any).maybePostStockContext("EXMP", "thread-EXMP", 1_000);

  assert.equal(discordAlertRouter.routed[0]?.payload.metadata?.messageKind, "stock_context");
  assert.equal(manager.getRuntimeHealth().lastThreadPostKind, "stock_context");
  assert.equal(manager.getRuntimeHealth().mondayReview.postsLast15m, 0);
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

  const failedEntry = (manager as any).watchlistStore.getEntry("INTC") as WatchlistEntry | undefined;
  assert.equal(failedEntry?.active, false);
  assert.equal(manager.getActiveEntries().some((entry) => entry.symbol === "INTC"), false);
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

  await new Promise((resolve) => setTimeout(resolve, 160));

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
    lastPrice: 3.23,
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

test("ManualWatchlistRuntimeManager posts extension levels when price reaches the second-last displayed resistance", async () => {
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
    lastPrice: 2.41,
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

test("ManualWatchlistRuntimeManager shows a deeper upside ladder for low-priced small-cap runners", async () => {
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
          referencePrice: 1.17,
        },
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support", representativePrice: 1.15 }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 1.19,
            zoneHigh: 1.19,
            representativePrice: 1.19,
          }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({
              id: "XR1",
              symbol,
              kind: "resistance",
              zoneLow: 1.55,
              zoneHigh: 1.55,
              representativePrice: 1.55,
              isExtension: true,
            }),
            buildZone({
              id: "XR2",
              symbol,
              kind: "resistance",
              zoneLow: 2.03,
              zoneHigh: 2.03,
              representativePrice: 2.03,
              isExtension: true,
            }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "MNDR" });

  const snapshot = discordAlertRouter.levelSnapshots.at(-1)?.payload;
  assert.deepEqual(
    snapshot?.resistanceZones.map((zone: any) => zone.representativePrice),
    [1.19, 1.3, 1.4, 1.5, 1.55, 1.6, 2.03],
  );
  assert.deepEqual(
    snapshot?.resistanceZones
      .filter((zone: any) => zone.sourceLabel === "continuation map")
      .map((zone: any) => zone.representativePrice),
    [1.3, 1.4, 1.5, 1.6],
  );

  await manager.stop();
});

test("ManualWatchlistRuntimeManager does not repost cleared resistance as the next extension level", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const watchlistStore = new WatchlistStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 3.84,
        },
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 4.6,
            zoneHigh: 4.62,
            representativePrice: 4.62,
          }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({
              id: "XR-cleared",
              symbol,
              kind: "resistance",
              zoneLow: 4.62,
              zoneHigh: 4.62,
              representativePrice: 4.62,
              isExtension: true,
            }),
            buildZone({
              id: "XR-next",
              symbol,
              kind: "resistance",
              zoneLow: 5.5,
              zoneHigh: 5.5,
              representativePrice: 5.5,
              isExtension: true,
            }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "RXT" });
  const snapshotState = (manager as any).activeSnapshotState.get("RXT");
  (manager as any).activeSnapshotState.set("RXT", {
    ...snapshotState,
    lastClearedResistance: 4.62,
  });
  watchlistStore.patchEntry("RXT", {
    lastPrice: 4.61,
    lastPriceUpdateAt: 2_000,
  });

  const result = await (manager as any).postLevelExtension("RXT", "thread-RXT", "resistance", 3_000);

  assert.equal(result, "posted");
  assert.deepEqual(discordAlertRouter.levelExtensions.at(-1), {
    threadId: "thread-RXT",
    payload: {
      symbol: "RXT",
      side: "resistance",
      levels: [5.5],
      timestamp: 3_000,
    },
  });
  await waitForAsyncWork();
  const refreshedWebsitePatch = liveWatchlistPublisher.cardPatches.at(-1);
  assert.equal(refreshedWebsitePatch?.cards.fullLadder?.title, "RXT full level ladder");
  assert.equal(
    refreshedWebsitePatch?.cards.nearestSupportResistance?.title,
    "Potential Path Levels",
  );
  assert.equal(
    refreshedWebsitePatch?.cards.nearestSupportResistance?.source,
    "level_snapshot",
  );

  await manager.stop();
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
  assert.match(clearPosts[0]?.payload.body ?? "", /price pushed above 2\.90; nearby resistance above is moderate resistance 3\.10/);
  assert.match(clearPosts[0]?.payload.body ?? "", /Old resistance is being tested as support/);
  assert.match(clearPosts[0]?.payload.body ?? "", /2\.90 was resistance\. Now buyers need it to hold as support/);
  assert.match(clearPosts[0]?.payload.body ?? "", /holding above 2\.90 keeps the breakout attempt alive/);
  assert.match(clearPosts[0]?.payload.body ?? "", /nearby resistance above is moderate resistance 3\.10/);
  assert.match(clearPosts[0]?.payload.body ?? "", /Key levels:\n- Breakout support: 2\.90\n- Resistance above: moderate resistance 3\.10/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /being tested from above/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /acceptance above/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /price target/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /mapped/);
  assert.equal(manager.getRuntimeHealth().lastThreadPostKind, "level_clear_update");

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

test("ManualWatchlistRuntimeManager keeps quiet market structure out of fast level-clear posts", async () => {
  const monitor = new FakeMonitor();
  const alreadyPostedStructure = {
    timeframes: {
      "4h": {
        formal: {
          timeframe: "4h",
          bias: "range",
          previousBias: "range",
          eventType: "failed_break_low",
          eventFreshness: "fresh",
          confirmation: "failed",
          confidence: "medium",
          confidenceScore: 0.55,
          materialChange: true,
          brokenSwingPrice: null,
          sweptSwingPrice: 0.785,
          protectedHigh: 0.8999,
          protectedLow: 0.785,
          latestHigh: 0.8999,
          latestLow: 0.785,
          swingSequence: ["LH", "LL"],
          structureKey: "4h|failed_break_low|range|none|BIYA:4h:external:low|0.7850",
          traderLine: "4h structure failed to hold below 0.7850.",
          debug: { candleCount: 116, reasons: ["failed_break"] },
        },
      },
    },
  };
  monitor.marketStructureSnapshots.set("BIYA", alreadyPostedStructure);
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
            zoneLow: 1.12,
            zoneHigh: 1.15,
            representativePrice: 1.15,
          }),
          buildZone({
            id: "R2",
            symbol,
            kind: "resistance",
            zoneLow: 1.18,
            zoneHigh: 1.18,
            representativePrice: 1.18,
            strengthLabel: "major",
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "BIYA" });
  (manager as any).marketStructureStoryMemory.markPosted("BIYA", 900, alreadyPostedStructure);
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "BIYA",
    timestamp: 1000,
    lastPrice: 1.16,
  });
  await waitForAsyncWork();

  const clearPost = discordAlertRouter.routed.find(
    (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
  );
  assert.ok(clearPost);
  assert.doesNotMatch(clearPost.payload.body ?? "", /Market structure:/);
  assert.doesNotMatch(clearPost.payload.body ?? "", /0\.7850/);
  assert.equal(clearPost.payload.metadata?.marketStructureStoryVisible, false);
  assert.equal(clearPost.payload.metadata?.marketStructureStoryReason, "quiet_structure");
  assert.deepEqual(clearPost.payload.metadata?.marketStructureStoryKeys, []);

  await manager.stop();
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
  assert.match(clearPosts[0]?.payload.body ?? "", /price pushed above 7\.04; nearby resistance above is moderate resistance 7\.73/);
  assert.match(clearPosts[0]?.payload.body ?? "", /7\.04 was resistance\. Now buyers need it to hold as support/);
  assert.match(clearPosts[0]?.payload.body ?? "", /falling back below 7\.04 means the level is still acting like resistance/);
  assert.match(clearPosts[0]?.payload.body ?? "", /Resistance above: moderate resistance 7\.73/);
});

test("ManualWatchlistRuntimeManager limits fast resistance clears when a critical breakout already owns the runner story", async () => {
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
  await waitMs(35);
  await waitForAsyncWork();

  const clearPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
  );
  assert.equal(clearPosts.length, 1);
  assert.equal(clearPosts[0]?.payload.title, "ALBT resistance crossed");
  assert.match(clearPosts[0]?.payload.body ?? "", /price pushed above 1\.32; nearby resistance above is moderate resistance 1\.33/);
  assert.match(clearPosts[0]?.payload.body ?? "", /1\.32 was resistance\. Now buyers need it to hold as support/);
  assert.match(clearPosts[0]?.payload.body ?? "", /Breakout support: 1\.32/);
  assert.match(clearPosts[0]?.payload.body ?? "", /Resistance above: moderate resistance 1\.33/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /mapped/);
});

test("ManualWatchlistRuntimeManager uses snapshot extension resistance for fast resistance clears", async () => {
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
          referencePrice: 27.55,
        },
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            representativePrice: 26.8,
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 35.7,
            zoneHigh: 35.98,
            representativePrice: 35.7,
            strengthLabel: "major",
          }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({
              id: "XR1",
              symbol,
              kind: "resistance",
              zoneLow: 36.6,
              zoneHigh: 36.6,
              representativePrice: 36.6,
              strengthLabel: "moderate",
              isExtension: true,
            }),
            buildZone({
              id: "XR2",
              symbol,
              kind: "resistance",
              zoneLow: 38.4,
              zoneHigh: 38.4,
              representativePrice: 38.4,
              strengthLabel: "moderate",
              isExtension: true,
            }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "CUE" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "CUE",
    timestamp: 1000,
    lastPrice: 36.2,
  });
  await waitForAsyncWork();

  const clearPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
  );
  assert.equal(clearPosts.length, 1);
  assert.equal(clearPosts[0]?.payload.metadata?.targetPrice, 35.7);
  assert.match(clearPosts[0]?.payload.body ?? "", /nearby resistance above is moderate resistance 36\.60/);
  assert.match(clearPosts[0]?.payload.body ?? "", /Resistance above: moderate resistance 36\.60/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /none currently surfaced/);
});

test("ManualWatchlistRuntimeManager suppresses same-level fast clear after full breakout alert", async () => {
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
    fastLevelClearCoalesceMs: 20,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support", representativePrice: 2.2 }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.45,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
          buildZone({
            id: "R2",
            symbol,
            kind: "resistance",
            zoneLow: 2.7,
            zoneHigh: 2.72,
            representativePrice: 2.71,
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
    lastPrice: 2.52,
  });
  monitor.listener?.({
    id: "evt-breakout",
    episodeId: "evt-breakout-episode",
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
      ladderPosition: "inner",
      zoneStrengthLabel: "strong",
      sourceGeneratedAt: 1,
      nextBarrierKind: "resistance",
      nextBarrierLevel: 2.71,
      nextBarrierDistancePct: 0.075,
      clearanceLabel: "open",
    },
    timestamp: 1005,
    notes: ["Breakout through resistance."],
  });
  await waitMs(35);
  await waitForAsyncWork();

  const fullAlerts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "intelligent_alert",
  );
  const clearPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
  );
  assert.equal(fullAlerts.length, 1);
  assert.equal(fullAlerts[0]?.payload.title, "ALBT breakout");
  assert.equal(clearPosts.length, 0);

  await manager.stop();
});

test("ManualWatchlistRuntimeManager cancels pending level touch when a fast clear posts", async () => {
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
    levelTouchSupersedeDelayMs: 20,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support", representativePrice: 2.2 }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 2.45,
            zoneHigh: 2.5,
            representativePrice: 2.45,
            strengthLabel: "strong",
            strengthScore: 28,
          }),
          buildZone({
            id: "R2",
            symbol,
            kind: "resistance",
            zoneLow: 2.7,
            zoneHigh: 2.72,
            representativePrice: 2.71,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  monitor.listener?.({
    id: "evt-touch",
    episodeId: "evt-touch-episode",
    symbol: "ALBT",
    type: "level_touch",
    eventType: "level_touch",
    zoneId: "ALBT-resistance-monitored-1",
    zoneKind: "resistance",
    level: 2.45,
    triggerPrice: 2.47,
    strength: 0.7,
    confidence: 0.7,
    priority: 65,
    bias: "neutral",
    pressureScore: 0.55,
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
      ladderPosition: "inner",
      zoneStrengthLabel: "strong",
      sourceGeneratedAt: 1,
      nextBarrierKind: "support",
      nextBarrierLevel: 2.2,
      nextBarrierDistancePct: 0.1,
      clearanceLabel: "open",
    },
    timestamp: 1000,
    notes: ["Resistance touch."],
  });
  monitor.onPriceUpdate?.({
    symbol: "ALBT",
    timestamp: 1005,
    lastPrice: 2.52,
  });
  await waitMs(40);
  await waitForAsyncWork();

  const touchPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.title === "ALBT level touch",
  );
  const clearPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
  );
  assert.equal(touchPosts.length, 0);
  assert.equal(clearPosts.length, 1);
  assert.equal(clearPosts[0]?.payload.title, "ALBT resistance crossed");

  await manager.stop();
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
  assert.equal(clearPosts[1]?.payload.metadata?.targetPrice, 1.41);
  assert.deepEqual(clearPosts[1]?.payload.metadata?.crossedLevels, [1.39, 1.41]);
  assert.match(clearPosts[0]?.payload.body ?? "", /falling back below 1\.32 means the level is still acting like resistance/);
  assert.match(clearPosts[0]?.payload.body ?? "", /the breakout needs to rebuild; broader support is 1\.22/);
  assert.match(clearPosts[0]?.payload.body ?? "", /1\.32 was resistance\. Now buyers need it to hold as support/);
  assert.match(clearPosts[0]?.payload.body ?? "", /Breakout support: 1\.32/);
  assert.match(clearPosts[1]?.payload.body ?? "", /resistance cluster 1\.39-1\.41/);
  assert.match(clearPosts[1]?.payload.body ?? "", /1\.39-1\.41 was resistance\. Now buyers need that area to hold as support/);
  assert.match(clearPosts[1]?.payload.body ?? "", /Breakout support: 1\.39-1\.41/);
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
  assert.equal(clearPosts[1]?.payload.title, "ALBT support cluster crossed lower");
  assert.equal(clearPosts[1]?.payload.metadata?.targetPrice, 1.06);
  assert.deepEqual(clearPosts[1]?.payload.metadata?.crossedLevels, [1.08, 1.06]);
  assert.equal(clearPosts[1]?.payload.metadata?.clusteredLevelClear, true);
  assert.match(clearPosts[0]?.payload.body ?? "", /price slipped below 1\.22; nearby support below is moderate support 1\.08/);
  assert.match(clearPosts[0]?.payload.body ?? "", /nearby support below is moderate support 1\.08/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /price target/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /mapped/);
  assert.match(clearPosts[0]?.payload.body ?? "", /Old support is now overhead/);
  assert.match(clearPosts[0]?.payload.body ?? "", /1\.22 was support\. Price is below it now, so buyers need a reclaim to repair the level/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /being tested from below/);
  assert.match(clearPosts[0]?.payload.body ?? "", /nearby support reaction area: moderate support 1\.08; buyers need stabilization there or a reclaim of 1\.22/);
  assert.doesNotMatch(clearPosts[0]?.payload.body ?? "", /dip-buy/i);
  assert.match(clearPosts[0]?.payload.body ?? "", /below 1\.22, the next broader support area is 1\.08/);
  assert.match(clearPosts[1]?.payload.body ?? "", /price slipped through nearby support cluster 1\.06-1\.08/);
  assert.match(clearPosts[1]?.payload.body ?? "", /Old support is now overhead/);
  assert.match(clearPosts[1]?.payload.body ?? "", /1\.06-1\.08 was support\. Price is below it now, so buyers need a reclaim to repair the zone/);
  assert.match(clearPosts[1]?.payload.body ?? "", /reclaiming 1\.08 is needed to repair the zone/);
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

test("ManualWatchlistRuntimeManager coalesces near-instant fast resistance crosses into one cluster story", async () => {
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
    fastLevelClearCoalesceMs: 20,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 3.2,
            zoneHigh: 3.25,
            representativePrice: 3.25,
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 3.74,
            zoneHigh: 3.75,
            representativePrice: 3.75,
          }),
          buildZone({
            id: "R2",
            symbol,
            kind: "resistance",
            zoneLow: 3.79,
            zoneHigh: 3.8,
            representativePrice: 3.8,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "XTLB" });
  discordAlertRouter.routed.length = 0;

  monitor.onPriceUpdate?.({
    symbol: "XTLB",
    timestamp: 1000,
    lastPrice: 3.77,
  });
  monitor.onPriceUpdate?.({
    symbol: "XTLB",
    timestamp: 1010,
    lastPrice: 3.82,
  });
  await waitMs(35);
  await waitForAsyncWork();

  const clearPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
  );
  assert.equal(clearPosts.length, 1);
  assert.equal(clearPosts[0]?.payload.title, "XTLB resistance cluster crossed");
  assert.equal(clearPosts[0]?.payload.metadata?.clusteredLevelClear, true);
  assert.deepEqual(clearPosts[0]?.payload.metadata?.crossedLevels, [3.75, 3.8]);
  assert.match(clearPosts[0]?.payload.body ?? "", /resistance cluster 3\.75-3\.80/);

  await manager.stop();
});

test("ManualWatchlistRuntimeManager advances fast clears past an already posted lower breakout", async () => {
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
          referencePrice: 1.17,
        },
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 1.15,
            zoneHigh: 1.15,
            representativePrice: 1.15,
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 1.19,
            zoneHigh: 1.19,
            representativePrice: 1.19,
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
            zoneLow: 1.35,
            zoneHigh: 1.35,
            representativePrice: 1.35,
          }),
          buildZone({
            id: "R4",
            symbol,
            kind: "resistance",
            zoneLow: 1.38,
            zoneHigh: 1.38,
            representativePrice: 1.38,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "MNDR" });
  discordAlertRouter.routed.length = 0;
  (manager as any).recordDominantLevelStory({
    symbol: "MNDR",
    level: 1.19,
    eventType: "breakout",
    timestamp: 9_000,
    label: null,
  });
  const snapshotState = (manager as any).activeSnapshotState.get("MNDR");
  assert.deepEqual((manager as any).pruneDominantLevelStories("MNDR", 10_000).map((story: any) => story.level), [1.19]);
  assert.deepEqual(
    (manager as any).findFastClearedResistanceCluster("MNDR", snapshotState, 1.37, 10_000)
      .map((zone: FinalLevelZone) => zone.representativePrice),
    [1.33, 1.35],
  );

  await (manager as any).maybePostFastLevelClear({
    symbol: "MNDR",
    timestamp: 10_000,
    lastPrice: 1.37,
  });

  const clearPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
  );
  assert.equal(clearPosts.length, 1);
  assert.equal(clearPosts[0]?.payload.title, "MNDR resistance cluster crossed");
  assert.deepEqual(clearPosts[0]?.payload.metadata?.crossedLevels, [1.33, 1.35]);
  assert.match(clearPosts[0]?.payload.body ?? "", /resistance cluster 1\.33-1\.35/);

  await manager.stop();
});

test("ManualWatchlistRuntimeManager posts fast support loss from displayed snapshot support", async () => {
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
          referencePrice: 1.64,
        },
        intradaySupport: [],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 1.67,
            zoneHigh: 1.69,
            representativePrice: 1.68,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "MNDR" });
  discordAlertRouter.routed.length = 0;
  const displayedSupport = buildZone({
    id: "MNDR-support-monitored-11",
    symbol: "MNDR",
    kind: "support",
    zoneLow: 1.52,
    zoneHigh: 1.54,
    representativePrice: 1.53,
    timeframeBias: "daily",
    timeframeSources: ["daily"],
  });
  const snapshotState = (manager as any).activeSnapshotState.get("MNDR");
  (manager as any).activeSnapshotState.set("MNDR", {
    ...snapshotState,
    lowestSupport: 1.53,
    displayedSupportZones: [displayedSupport],
  });

  assert.deepEqual(levelStore.getSupportZones("MNDR"), []);
  assert.deepEqual(
    (manager as any).findFastLostSupportCluster("MNDR", (manager as any).activeSnapshotState.get("MNDR"), 1.45, 10_000)
      .map((zone: any) => zone.representativePrice),
    [1.53],
  );

  await (manager as any).maybePostFastLevelClear({
    symbol: "MNDR",
    timestamp: 10_000,
    lastPrice: 1.45,
  });

  const clearPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "level_clear_update",
  );
  assert.equal(clearPosts.length, 1);
  assert.equal(clearPosts[0]?.payload.title, "MNDR support crossed lower");
  assert.equal(clearPosts[0]?.payload.metadata?.targetPrice, 1.53);
  assert.match(clearPosts[0]?.payload.body ?? "", /price slipped below 1\.53/);
  assert.match(clearPosts[0]?.payload.body ?? "", /Old support is now overhead/);

  await manager.stop();
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

test("ManualWatchlistRuntimeManager promotes posted extension resistance into the fast clear ladder", async () => {
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
          referencePrice: 1.17,
        },
        intradaySupport: [
          buildZone({ id: "S1", symbol, kind: "support", representativePrice: 1.15 }),
        ],
        intradayResistance: [
          buildZone({
            id: "R1",
            symbol,
            kind: "resistance",
            zoneLow: 1.55,
            zoneHigh: 1.55,
            representativePrice: 1.55,
          }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({
              id: "XR1",
              symbol,
              kind: "resistance",
              zoneLow: 1.78,
              zoneHigh: 1.78,
              representativePrice: 1.78,
              isExtension: true,
            }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "MNDR" });
  await (manager as any).postLevelExtension("MNDR", "thread-MNDR", "resistance", 2_000);
  const snapshotState = (manager as any).activeSnapshotState.get("MNDR");

  assert.equal(snapshotState.highestResistance, 1.78);
  assert.deepEqual(
    snapshotState.displayedResistanceZones.map((zone: any) => zone.representativePrice),
    [1.55, 1.78],
  );

  await manager.stop();
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
    lastPrice: 3.23,
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
    { representativePrice: 1.6, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.62, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  assert.equal(snapshot.supportZones[0]?.sourceLabel, "fresh intraday");
  assert.equal(typeof snapshot.timestamp, "number");
  assert.equal(snapshot.audit?.omittedSupportCount, 0);
  assert.equal(snapshot.audit?.omittedResistanceCount, 1);
  assert.equal(
    snapshot.audit?.supportCandidates.find((candidate: any) => candidate.id === "GXAI-support-monitored-1")?.omittedReason,
    "displayed",
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

test("ManualWatchlistRuntimeManager keeps important at-price decision levels visible", async () => {
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
          referencePrice: 0.3719,
        },
        intradaySupport: [
          buildZone({
            id: "S-major-at-price",
            symbol,
            kind: "support",
            representativePrice: 0.371,
            zoneLow: 0.371,
            zoneHigh: 0.371,
            strengthLabel: "major",
            strengthScore: 40,
            confluenceCount: 3,
            sourceEvidenceCount: 5,
          }),
          buildZone({
            id: "S-lower",
            symbol,
            kind: "support",
            representativePrice: 0.35,
            zoneLow: 0.35,
            zoneHigh: 0.35,
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R-next",
            symbol,
            kind: "resistance",
            representativePrice: 0.39,
            zoneLow: 0.39,
            zoneHigh: 0.39,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "FEMY" });

  const snapshot = discordAlertRouter.levelSnapshots.at(-1)?.payload;
  assert.deepEqual(withoutSnapshotSourceLabels(snapshot.supportZones), [
    { representativePrice: 0.371, strengthLabel: "major", freshness: "fresh", isExtension: false },
    { representativePrice: 0.35, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  assert.equal(
    snapshot.audit?.supportCandidates.find((candidate: any) =>
      candidate.representativePrice === 0.371
    )?.omittedReason,
    "displayed",
  );
});

test("ManualWatchlistRuntimeManager keeps low-priced structural shelves visible near snapshot price", async () => {
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
          referencePrice: 0.2268,
        },
        intradaySupport: [
          buildZone({
            id: "S-near-daily",
            symbol,
            kind: "support",
            representativePrice: 0.2261,
            zoneLow: 0.2261,
            zoneHigh: 0.2261,
            strengthLabel: "moderate",
            strengthScore: 17.93,
            timeframeBias: "daily",
            timeframeSources: ["daily"],
            sourceTypes: ["swing_low"],
          }),
          buildZone({
            id: "S-lower",
            symbol,
            kind: "support",
            representativePrice: 0.2151,
            zoneLow: 0.2151,
            zoneHigh: 0.2151,
            strengthLabel: "major",
            strengthScore: 58,
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R-next",
            symbol,
            kind: "resistance",
            representativePrice: 0.23,
            zoneLow: 0.23,
            zoneHigh: 0.23,
            strengthLabel: "major",
            strengthScore: 80,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "VRAX" });

  const snapshot = discordAlertRouter.levelSnapshots.at(-1)?.payload;
  assert.equal(snapshot.supportZones[0]?.representativePrice, 0.2261);
  assert.equal(
    snapshot.audit?.supportCandidates.find((candidate: any) =>
      candidate.representativePrice === 0.2261
    )?.omittedReason,
    "displayed",
  );
});

test("ManualWatchlistRuntimeManager flips important just-overhead support into reclaim resistance", async () => {
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
          referencePrice: 6,
        },
        intradaySupport: [
          buildZone({
            id: "S-reclaim",
            symbol,
            kind: "support",
            representativePrice: 6.02,
            zoneLow: 6.02,
            zoneHigh: 6.02,
            strengthLabel: "major",
            strengthScore: 42,
            confluenceCount: 3,
            sourceEvidenceCount: 6,
          }),
          buildZone({
            id: "S-lower",
            symbol,
            kind: "support",
            representativePrice: 5.85,
            zoneLow: 5.85,
            zoneHigh: 5.85,
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R-next",
            symbol,
            kind: "resistance",
            representativePrice: 6.3,
            zoneLow: 6.3,
            zoneHigh: 6.3,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "PBM" });

  const snapshot = discordAlertRouter.levelSnapshots.at(-1)?.payload;
  assert.deepEqual(withoutSnapshotSourceLabels(snapshot.resistanceZones), [
    { representativePrice: 6.02, strengthLabel: "major", freshness: "fresh", isExtension: false },
    { representativePrice: 6.3, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  assert.equal(
    snapshot.audit?.supportCandidates.find((candidate: any) =>
      candidate.representativePrice === 6.02
    )?.omittedReason,
    "displayed",
  );
});

test("ManualWatchlistRuntimeManager flips meaningful crossed higher-timeframe resistance into snapshot support", async () => {
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
          referencePrice: 28.17,
        },
        intradaySupport: [
          buildZone({
            id: "S-1769",
            symbol,
            kind: "support",
            representativePrice: 17.69,
            zoneLow: 17.69,
            zoneHigh: 17.69,
            strengthLabel: "major",
            strengthScore: 48,
            timeframeBias: "mixed",
            timeframeSources: ["daily", "4h"],
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R-2305",
            symbol,
            kind: "resistance",
            representativePrice: 23.05,
            zoneLow: 23.05,
            zoneHigh: 23.05,
            strengthLabel: "strong",
            strengthScore: 34,
            confluenceCount: 2,
            sourceEvidenceCount: 2,
            rejectionScore: 0.48,
            displacementScore: 0.68,
            followThroughScore: 0.58,
            timeframeBias: "mixed",
            timeframeSources: ["daily", "4h"],
            sourceTypes: ["swing_high"],
          }),
          buildZone({
            id: "R-3866",
            symbol,
            kind: "resistance",
            representativePrice: 38.66,
            zoneLow: 38.66,
            zoneHigh: 38.66,
            timeframeBias: "4h",
            timeframeSources: ["4h"],
            sourceTypes: ["swing_high"],
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "VEEE" });

  const snapshot = discordAlertRouter.levelSnapshots.at(-1)?.payload;
  assert.deepEqual(withoutSnapshotSourceLabels(snapshot.supportZones), [
    { representativePrice: 23.05, strengthLabel: "strong", freshness: "fresh", isExtension: false },
    { representativePrice: 17.69, strengthLabel: "major", freshness: "fresh", isExtension: false },
  ]);
  assert.equal(snapshot.supportZones[0]?.sourceLabel, "daily confluence");
});

test("ManualWatchlistRuntimeManager keeps resistance zones that touch price but extend overhead", async () => {
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
          referencePrice: 5.185,
        },
        intradayResistance: [
          buildZone({
            id: "R-touching-zone",
            symbol,
            kind: "resistance",
            representativePrice: 5.19,
            zoneLow: 5.19,
            zoneHigh: 5.24,
          }),
          buildZone({
            id: "R-next",
            symbol,
            kind: "resistance",
            representativePrice: 5.34,
            zoneLow: 5.34,
            zoneHigh: 5.34,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "TMC" });

  const snapshot = discordAlertRouter.levelSnapshots.at(-1)?.payload;
  assert.deepEqual(withoutSnapshotSourceLabels(snapshot.resistanceZones), [
    { representativePrice: 5.19, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 5.34, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  assert.equal(
    snapshot.audit?.resistanceCandidates.find((candidate: any) =>
      candidate.representativePrice === 5.19 &&
      candidate.zoneHigh === 5.24
    )?.omittedReason,
    "displayed",
  );
});

test("ManualWatchlistRuntimeManager keeps low-priced resistance shelves that straddle current price", async () => {
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
          referencePrice: 0.7165,
        },
        intradayResistance: [
          buildZone({
            id: "R-straddle",
            symbol,
            kind: "resistance",
            representativePrice: 0.7172,
            zoneLow: 0.7107,
            zoneHigh: 0.7176,
          }),
          buildZone({
            id: "R-next",
            symbol,
            kind: "resistance",
            representativePrice: 0.7446,
            zoneLow: 0.7446,
            zoneHigh: 0.7446,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "YYAI" });

  const snapshot = discordAlertRouter.levelSnapshots.at(-1)?.payload;
  assert.deepEqual(withoutSnapshotSourceLabels(snapshot.resistanceZones), [
    { representativePrice: 0.7172, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 0.7446, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  assert.equal(
    snapshot.audit?.resistanceCandidates.find((candidate: any) =>
      candidate.representativePrice === 0.7172 &&
      candidate.zoneHigh === 0.7176
    )?.omittedReason,
    "displayed",
  );
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

test("ManualWatchlistRuntimeManager prefers stronger $1+ resistance over penny-closer duplicate", async () => {
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
          referencePrice: 1.3599,
        },
        intradayResistance: [
          buildZone({
            id: "R-penny-close",
            symbol,
            kind: "resistance",
            representativePrice: 1.3599,
            zoneLow: 1.3599,
            zoneHigh: 1.38,
            strengthScore: 12,
            confluenceCount: 1,
            sourceEvidenceCount: 1,
            timeframeBias: "5m",
            timeframeSources: ["5m"],
          }),
          buildZone({
            id: "R-better-close",
            symbol,
            kind: "resistance",
            representativePrice: 1.3692,
            zoneLow: 1.3692,
            zoneHigh: 1.37,
            strengthScore: 33,
            confluenceCount: 2,
            sourceEvidenceCount: 2,
            timeframeBias: "mixed",
            timeframeSources: ["4h", "5m"],
          }),
          buildZone({
            id: "R-next",
            symbol,
            kind: "resistance",
            representativePrice: 1.4,
            strengthScore: 28,
            confluenceCount: 2,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "ATLN" });

  assert.deepEqual(withoutSnapshotSourceLabels(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones ?? []), [
    { representativePrice: 1.3692, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 1.4, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
  const auditCandidates =
    discordAlertRouter.levelSnapshots.at(-1)?.payload.audit?.resistanceCandidates ?? [];
  assert.equal(
    auditCandidates.find((candidate: any) => candidate.id === "ATLN-resistance-monitored-1")
      ?.omittedReason,
    "compacted",
  );
  assert.equal(
    auditCandidates.find((candidate: any) => candidate.id === "ATLN-resistance-monitored-2")
      ?.displayed,
    true,
  );
});

test("ManualWatchlistRuntimeManager keeps the nearest shelf when compacting levels directly above price", async () => {
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
          referencePrice: 0.2579,
        },
        intradayResistance: [
          buildZone({
            id: "R-nearest",
            symbol,
            kind: "resistance",
            representativePrice: 0.2595,
            zoneLow: 0.2595,
            zoneHigh: 0.2595,
            strengthScore: 1.4,
          }),
          buildZone({
            id: "R-stronger-close",
            symbol,
            kind: "resistance",
            representativePrice: 0.265,
            zoneLow: 0.265,
            zoneHigh: 0.265,
            strengthScore: 4.2,
            confluenceCount: 2,
          }),
          buildZone({
            id: "R-next",
            symbol,
            kind: "resistance",
            representativePrice: 0.2761,
            zoneLow: 0.2761,
            zoneHigh: 0.2761,
            strengthScore: 1.2,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "OTLK" });

  assert.deepEqual(withoutSnapshotSourceLabels(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones ?? []), [
    { representativePrice: 0.2595, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 0.2761, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
});

test("ManualWatchlistRuntimeManager keeps fresh sub-dollar shelves within three percent of price", async () => {
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
          referencePrice: 0.6498,
        },
        intradayResistance: [
          buildZone({
            id: "R-fresh-nearest",
            symbol,
            kind: "resistance",
            representativePrice: 0.6654,
            zoneLow: 0.66,
            zoneHigh: 0.6654,
            strengthScore: 1.4,
            freshness: "fresh",
          }),
          buildZone({
            id: "R-stronger-close",
            symbol,
            kind: "resistance",
            representativePrice: 0.6703,
            zoneLow: 0.67,
            zoneHigh: 0.6732,
            strengthScore: 4.2,
            confluenceCount: 3,
            freshness: "fresh",
          }),
          buildZone({
            id: "R-next",
            symbol,
            kind: "resistance",
            representativePrice: 0.68,
            zoneLow: 0.68,
            zoneHigh: 0.68,
            strengthScore: 3.5,
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "WYHG" });

  assert.deepEqual(withoutSnapshotSourceLabels(discordAlertRouter.levelSnapshots.at(-1)?.payload.resistanceZones ?? []), [
    { representativePrice: 0.6654, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
    { representativePrice: 0.68, strengthLabel: "moderate", freshness: "fresh", isExtension: false },
  ]);
});

test("ManualWatchlistRuntimeManager extends low-priced resistance snapshots beyond the 50 percent forward planning range", async () => {
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
    { representativePrice: 2.2, strengthLabel: "moderate", freshness: "fresh", isExtension: true },
  ]);
});

test("ManualWatchlistRuntimeManager smooths the two-dollar ladder boundary and keeps one structural outer anchor", async () => {
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
          buildZone({
            id: "R-250",
            symbol,
            kind: "resistance",
            representativePrice: 2.5,
            zoneLow: 2.5,
            zoneHigh: 2.5,
          }),
          buildZone({
            id: "R-340",
            symbol,
            kind: "resistance",
            representativePrice: 3.4,
            zoneLow: 3.4,
            zoneHigh: 3.4,
          }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({
              id: "RX-405-weak",
              symbol,
              kind: "resistance",
              representativePrice: 4.05,
              zoneLow: 4.05,
              zoneHigh: 4.05,
              strengthLabel: "weak",
              isExtension: true,
            }),
            buildZone({
              id: "RX-420-strong-daily",
              symbol,
              kind: "resistance",
              representativePrice: 4.2,
              zoneLow: 4.2,
              zoneHigh: 4.2,
              strengthLabel: "strong",
              timeframeBias: "daily",
              timeframeSources: ["daily"],
              isExtension: true,
            }),
            buildZone({
              id: "RX-440-major-daily",
              symbol,
              kind: "resistance",
              representativePrice: 4.4,
              zoneLow: 4.4,
              zoneHigh: 4.4,
              strengthLabel: "major",
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
  await manager.activateSymbol({ symbol: "VIVS" });

  const resistancePrices = discordAlertRouter.levelSnapshots.at(-1)?.payload
    .ladderResistanceZones.map((zone: any) => zone.representativePrice) ?? [];
  assert.equal(resistancePrices.includes(4.2), true);
  assert.equal(resistancePrices.includes(4.05), false);
  assert.equal(resistancePrices.includes(4.4), false);
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

test("ManualWatchlistRuntimeManager adds continuation-map resistance checkpoints inside wide small-cap gaps", async () => {
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
          referencePrice: 1.9402,
        },
        intradaySupport: [
          buildZone({
            id: "S-192",
            symbol,
            kind: "support",
            representativePrice: 1.92,
            zoneLow: 1.92,
            zoneHigh: 1.92,
            strengthScore: 3.2,
            strengthLabel: "strong",
            timeframeBias: "4h",
            timeframeSources: ["4h"],
          }),
        ],
        intradayResistance: [
          buildZone({
            id: "R-195",
            symbol,
            kind: "resistance",
            representativePrice: 1.95,
            zoneLow: 1.95,
            zoneHigh: 1.95,
            strengthScore: 2.2,
            strengthLabel: "moderate",
            timeframeBias: "mixed",
            timeframeSources: ["daily", "5m"],
          }),
          buildZone({
            id: "R-204",
            symbol,
            kind: "resistance",
            representativePrice: 2.04,
            zoneLow: 2.04,
            zoneHigh: 2.04,
            strengthScore: 0.7,
            strengthLabel: "weak",
          }),
          buildZone({
            id: "R-210",
            symbol,
            kind: "resistance",
            representativePrice: 2.1,
            zoneLow: 2.1,
            zoneHigh: 2.1,
            strengthScore: 2.1,
            strengthLabel: "moderate",
          }),
          buildZone({
            id: "R-359",
            symbol,
            kind: "resistance",
            representativePrice: 3.59,
            zoneLow: 3.59,
            zoneHigh: 3.59,
            timeframeBias: "daily",
            timeframeSources: ["daily"],
          }),
          buildZone({
            id: "R-368",
            symbol,
            kind: "resistance",
            representativePrice: 3.68,
            zoneLow: 3.68,
            zoneHigh: 3.68,
            timeframeBias: "daily",
            timeframeSources: ["daily"],
          }),
          buildZone({
            id: "R-375",
            symbol,
            kind: "resistance",
            representativePrice: 3.75,
            zoneLow: 3.75,
            zoneHigh: 3.75,
            timeframeBias: "daily",
            timeframeSources: ["daily"],
          }),
        ],
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "AUUD" });

  const snapshot = discordAlertRouter.levelSnapshots.at(-1)?.payload;
  assert.equal(snapshot.symbol, "AUUD");
  assert.deepEqual(
    snapshot.resistanceZones
      .filter((zone: any) => zone.sourceLabel === "continuation map")
      .map((zone: any) => zone.representativePrice),
    [2.25, 2.5, 2.75, 3],
  );
  assert.equal(
    snapshot.resistanceZones
      .filter((zone: any) => zone.sourceLabel === "continuation map")
      .every((zone: any) => zone.strengthLabel === "weak"),
    true,
  );
  assert.equal(
    snapshot.ladderResistanceZones.some(
      (zone: any) => zone.representativePrice === 3.59 && zone.sourceLabel === "daily structure",
    ),
    true,
  );
  assert.equal(snapshot.audit?.omittedResistanceCount, 0);
});

test("ManualWatchlistRuntimeManager fills a runner resistance path when only one nearby overhead level remains", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const liveWatchlistPublisher = new FakeLiveWatchlistPublisher();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore: new WatchlistStore(),
    watchlistStatePersistence: persistence as any,
    liveWatchlistPublisher,
    pullbackReadEnabled: false,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 22.1,
        },
        intradaySupport: [
          buildZone({
            id: "S-1769",
            symbol,
            kind: "support",
            representativePrice: 17.686,
            zoneLow: 17.686,
            zoneHigh: 17.686,
            strengthScore: 4,
            strengthLabel: "major",
            freshness: "stale",
            timeframeBias: "daily",
            timeframeSources: ["daily"],
          }),
        ],
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({
              id: "RX-2305",
              symbol,
              kind: "resistance",
              representativePrice: 23.051,
              zoneLow: 23.051,
              zoneHigh: 23.051,
              strengthScore: 3,
              strengthLabel: "strong",
              freshness: "stale",
              isExtension: true,
              timeframeBias: "daily",
              timeframeSources: ["daily"],
            }),
            buildZone({
              id: "RX-3866",
              symbol,
              kind: "resistance",
              representativePrice: 38.665,
              zoneLow: 38.665,
              zoneHigh: 38.665,
              strengthScore: 2,
              strengthLabel: "moderate",
              freshness: "stale",
              isExtension: true,
              timeframeBias: "4h",
              timeframeSources: ["4h"],
            }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "VEEE" });
  await waitForAsyncWork();

  const snapshot = discordAlertRouter.levelSnapshots.at(-1)?.payload;
  assert.equal(snapshot.symbol, "VEEE");
  assert.deepEqual(
    snapshot.resistanceZones.map((zone: any) => zone.representativePrice),
    [23.051, 24, 25, 27.5, 30],
  );
  assert.deepEqual(
    snapshot.resistanceZones.map((zone: any) => zone.sourceLabel),
    ["extension", "continuation map", "continuation map", "continuation map", "continuation map"],
  );
  assert.equal(
    snapshot.ladderResistanceZones.some((zone: any) => zone.representativePrice === 38.665),
    false,
  );
  assert.equal(snapshot.audit?.omittedResistanceCount, 1);

  liveWatchlistPublisher.cardPatches = [];
  await manager.setLiveTraderReadCardVisible(true);
  await waitForAsyncWork();

  const pathLevelsBody = liveWatchlistPublisher.cardPatches.at(-1)?.cards.nearestSupportResistance?.body ?? "";
  assert.match(pathLevelsBody, /23\.05/);
  assert.match(pathLevelsBody, /24\.00/);
  assert.match(pathLevelsBody, /25\.00/);
  assert.match(pathLevelsBody, /27\.50/);
  assert.match(pathLevelsBody, /30\.00/);
  assert.deepEqual(
    liveWatchlistPublisher.cardPatches.at(-1)?.levelMap?.resistanceLevels.map((level) => level.price),
    [23.051, 24, 25, 27.5, 30],
  );
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
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 1.88,
        },
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
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 1.88,
        },
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
        extensionLevels: {
          support: [],
          resistance: [
            buildZone({
              id: "R2",
              symbol,
              kind: "resistance",
              zoneLow: 2.9,
              zoneHigh: 2.92,
              representativePrice: 2.92,
              isExtension: true,
            }),
            buildZone({
              id: "R3",
              symbol,
              kind: "resistance",
              zoneLow: 3.28,
              zoneHigh: 3.3,
              representativePrice: 3.3,
              isExtension: true,
            }),
          ],
        },
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
  assert.match(
    intelligentAlerts[0]?.payload.body ?? "",
    /Resistance map: 2\.58 \(\+2\.4%\) -> 2\.92 \(\+15\.9%\) -> 3\.30 \(\+31\.0%\)/,
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
      assert.equal(input.operatorNote, "Needs clean volume before I trust the move.");
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
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 1.88,
        },
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
  await manager.activateSymbol({ symbol: "ALBT", note: "Needs clean volume before I trust the move." });
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
  assert.equal(aiPosts[0]?.payload.title, "ALBT setup read");
  assert.match(aiPosts[0]?.payload.body ?? "", /AI says buyers need acceptance above resistance/);
  assert.doesNotMatch(aiPosts[0]?.payload.body ?? "", /AI read:|Based on:/);
  assert.equal(aiPosts[0]?.payload.metadata?.aiGenerated, true);
  assert.equal(aiPosts[0]?.payload.metadata?.targetPrice, 2.45);
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

test("ManualWatchlistRuntimeManager suppresses stale AI signal commentary and allows a fresh retry", async () => {
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
          text: "Buyers need acceptance above resistance before the setup looks cleaner.",
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

  const deterministicPayload = {
    title: "ALBT breakout",
    body: "Price is above resistance for now.",
    symbol: "ALBT",
    timestamp: Date.now() - 20_000,
    metadata: {
      messageKind: "intelligent_alert",
    },
  };
  const alert = {
    symbol: "ALBT",
    event: {
      symbol: "ALBT",
      eventType: "breakout",
      level: 2.45,
      timestamp: Date.now() - 20_000,
    },
    severity: "critical",
    confidence: "high",
    score: 90,
  };

  await (manager as any).maybePostSignalCommentaryWithAI({
    threadId: "thread-ALBT",
    alert,
    deterministicPayload,
  });
  assert.equal(aiCalls, 1);
  assert.equal(
    discordAlertRouter.routed.filter(
      (entry) => entry.payload.metadata?.messageKind === "ai_signal_commentary",
    ).length,
    0,
  );

  await (manager as any).maybePostSignalCommentaryWithAI({
    threadId: "thread-ALBT",
    alert: {
      ...alert,
      event: {
        ...alert.event,
        timestamp: Date.now() + 120_000,
      },
    },
    deterministicPayload: {
      ...deterministicPayload,
      timestamp: Date.now() + 120_000,
    },
  });

  assert.equal(aiCalls, 2);
  const aiPosts = discordAlertRouter.routed.filter(
    (entry) => entry.payload.metadata?.messageKind === "ai_signal_commentary",
  );
  assert.equal(aiPosts.length, 1);
  assert.equal(aiPosts[0]?.payload.title, "ALBT setup read");
  assert.equal(aiPosts[0]?.payload.metadata?.targetPrice, 2.45);
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
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 1.88,
        },
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

test("ManualWatchlistRuntimeManager keeps non-live compression follow-through out of Discord", async () => {
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
  await manager.activateSymbol({ symbol: "ALBT" });
  discordAlertRouter.routed.length = 0;

  assert.equal((manager as any).postFollowThroughUpdate({
    symbol: "ALBT",
    timestamp: 1000,
    evaluatedAt: 2000,
    entryPrice: 2.45,
    outcomePrice: 2.51,
    returnPct: 2.45,
    directionalReturnPct: 2.45,
    followThroughLabel: "strong",
    success: true,
    eventType: "compression",
  }), false);
  await waitForAsyncWork();

  assert.equal(
    discordAlertRouter.routed.some((entry) => entry.payload.metadata?.messageKind === "follow_through_update"),
    false,
  );
  assert.equal(
    lifecycleEvents.some(
      (event) =>
        event.event === "alert_suppressed" &&
        event.symbol === "ALBT" &&
        event.details?.reason === "signal_category_not_live",
    ),
    true,
  );
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

test("ManualWatchlistRuntimeManager keeps recap Discord body trader-facing without system or AI labels", async () => {
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
    aiCommentaryService: {
      summarizeSymbolThread: async (input: any) => {
        assert.equal(input.operatorNote, "Recap should respect the operator note.");
        return {
          text: "Buyers still need acceptance above resistance before the setup looks cleaner.",
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
  await manager.activateSymbol({ symbol: "ALBT", note: "Recap should respect the operator note." });
  discordAlertRouter.routed.length = 0;

  (manager as any).maybePostSymbolRecap({
    symbol: "ALBT",
    timestamp: 20_000,
    snapshot: {
      top: [
        {
          symbol: "ALBT",
          type: "breakout",
          eventType: "breakout",
          level: 2.45,
          classification: "high_conviction",
          clearanceLabel: "limited",
          pathQualityLabel: "layered",
          exhaustionLabel: "fresh",
        },
      ],
    },
    progressUpdate: {
      symbol: "ALBT",
      timestamp: 20_000,
      eventType: "breakout",
      progressLabel: "improving",
      directionalReturnPct: 1.24,
      entryPrice: 2.45,
      currentPrice: 2.48,
    },
  });
  await waitForAsyncWork();
  await waitForAsyncWork();

  const recap = discordAlertRouter.routed.find(
    (entry) => entry.payload.metadata?.messageKind === "symbol_recap",
  );
  assert.ok(recap);
  const visibleThreadText = `${recap.payload.title}\n${recap.payload.body}`;
  assert.match(visibleThreadText, /breakout is still the main read near 2\.45/);
  assert.match(visibleThreadText, /Follow-through is improving; price change from the watched level is \+1\.24%/);
  assert.match(visibleThreadText, /Buyers still need acceptance above resistance/);
  assert.doesNotMatch(
    visibleThreadText,
    /current read:|Current read:|What matters next:|Live follow-through|directional progress|Latest tracked follow-through|AI note:|follow-through check|trade returned|key level/i,
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

test("ManualWatchlistRuntimeManager posts next resistance levels even when price gaps far beyond the top surfaced resistance", async () => {
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
              zoneLow: 2.7,
              zoneHigh: 2.8,
              representativePrice: 2.75,
              isExtension: true,
            }),
          ],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "AMST" });
  monitor.onPriceUpdate?.({
    symbol: "AMST",
    timestamp: 1000,
    lastPrice: 4.05,
  });
  await waitForAsyncWork();

  assert.deepEqual(discordAlertRouter.levelExtensions, [
    {
      threadId: "thread-AMST",
      payload: {
        symbol: "AMST",
        side: "resistance",
        levels: [2.75],
        timestamp: 1000,
      },
    },
  ]);
});

test("ManualWatchlistRuntimeManager posts next support levels when price has already broken below the lowest surfaced support", async () => {
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
    lastPrice: 1.62,
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
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 1.88,
        },
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

test("ManualWatchlistRuntimeManager filters support extensions to levels below the live trade area", async () => {
  const monitor = new FakeMonitor();
  const discordAlertRouter = new FakeDiscordAlertRouter();
  const persistence = new FakeWatchlistStatePersistence();
  const levelStore = new LevelStore();
  const watchlistStore = new WatchlistStore();
  persistence.storedEntries = [];
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: {} as any,
    levelStore,
    monitor: monitor as any,
    discordAlertRouter: discordAlertRouter as any,
    opportunityRuntimeController: new FakeOpportunityRuntimeController() as any,
    watchlistStore,
    watchlistStatePersistence: persistence as any,
    seedSymbolLevels: async (symbol: string) => {
      levelStore.setLevels(buildLevelOutput(symbol, {
        metadata: {
          providerByTimeframe: {},
          dataQualityFlags: [],
          freshness: "fresh",
          referencePrice: 0.2221,
        },
        intradaySupport: [
          buildZone({
            id: "S1",
            symbol,
            kind: "support",
            zoneLow: 0.2109,
            zoneHigh: 0.2109,
            representativePrice: 0.2109,
          }),
        ],
        extensionLevels: {
          support: [
            buildZone({
              id: "XS-above-1",
              symbol,
              kind: "support",
              zoneLow: 1.19,
              zoneHigh: 1.19,
              representativePrice: 1.19,
              isExtension: true,
            }),
            buildZone({
              id: "XS-above-2",
              symbol,
              kind: "support",
              zoneLow: 0.2054,
              zoneHigh: 0.2054,
              representativePrice: 0.2054,
              isExtension: true,
            }),
            buildZone({
              id: "XS-below",
              symbol,
              kind: "support",
              zoneLow: 0.19,
              zoneHigh: 0.19,
              representativePrice: 0.19,
              isExtension: true,
            }),
          ],
          resistance: [],
        },
      }));
    },
  });

  await manager.start();
  await manager.activateSymbol({ symbol: "EZGO" });
  watchlistStore.patchEntry("EZGO", {
    lastPrice: 0.2041,
    lastPriceUpdateAt: 2_000,
  });

  const result = await (manager as any).postLevelExtension("EZGO", "thread-EZGO", "support", 3_000);

  assert.equal(result, "posted");
  assert.equal(discordAlertRouter.levelExtensions.length, 1);
  assert.deepEqual(discordAlertRouter.levelExtensions[0], {
    threadId: "thread-EZGO",
    payload: {
      symbol: "EZGO",
      side: "support",
      levels: [0.19],
      timestamp: 3_000,
    },
  });

  await manager.stop();
});
