import { CandleFetchService } from "../market-data/candle-fetch-service.js";
import { LevelEngine } from "../levels/level-engine.js";
import { decideLevelRefresh } from "../levels/level-refresh-policy.js";
import { AlertIntelligenceEngine } from "../alerts/alert-intelligence-engine.js";
import {
  formatIntelligentAlertAsPayload,
  type DiscordAlertRouter,
} from "../alerts/alert-router.js";
import type { LevelExtensionPayload, LevelExtensionSide, LevelSnapshotPayload } from "../alerts/alert-types.js";
import { LevelStore } from "./level-store.js";
import type { LivePriceUpdate, MonitoringEvent, WatchlistEntry } from "./monitoring-types.js";
import { buildOpportunityDiagnosticsLogEntry } from "./opportunity-diagnostics.js";
import { OpportunityRuntimeController } from "./opportunity-runtime-controller.js";
import { WatchlistMonitor } from "./watchlist-monitor.js";
import { WatchlistStatePersistence } from "./watchlist-state-persistence.js";
import { WatchlistStore } from "./watchlist-store.js";

export type ManualWatchlistRuntimeManagerOptions = {
  candleFetchService: CandleFetchService;
  levelStore: LevelStore;
  monitor: WatchlistMonitor;
  discordAlertRouter: DiscordAlertRouter;
  opportunityRuntimeController: OpportunityRuntimeController;
  watchlistStore?: WatchlistStore;
  watchlistStatePersistence?: WatchlistStatePersistence;
  seedSymbolLevels?: (symbol: string) => Promise<void>;
};

export type ManualWatchlistActivationInput = {
  symbol: string;
  note?: string;
};

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

type ActiveLevelSnapshotState = {
  lastSnapshot: string;
  highestResistance: number | null;
  lowestSupport: number | null;
  lastRefreshTriggerResistance: number | null;
  lastRefreshTriggerSupport: number | null;
  lastRefreshTimestamp: number | null;
  lastExtensionPostKey: string | null;
  lastExtensionPostTimestamp: number | null;
};

const LEVEL_REFRESH_THRESHOLD_PCT = 0.01;
const LEVEL_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

function uniqueSortedLevels(levels: number[], direction: "asc" | "desc"): number[] {
  const unique = [...new Set(levels.filter((level) => Number.isFinite(level) && level > 0))];
  unique.sort((a, b) => (direction === "asc" ? a - b : b - a));
  return unique;
}

export class ManualWatchlistRuntimeManager {
  private readonly levelEngine: LevelEngine;
  private readonly watchlistStore: WatchlistStore;
  private readonly watchlistStatePersistence: WatchlistStatePersistence;
  private readonly alertIntelligenceEngine = new AlertIntelligenceEngine();
  private readonly activeSnapshotState = new Map<string, ActiveLevelSnapshotState>();
  private isStarted = false;

  constructor(private readonly options: ManualWatchlistRuntimeManagerOptions) {
    this.levelEngine = new LevelEngine(options.candleFetchService);
    this.watchlistStore = options.watchlistStore ?? new WatchlistStore();
    this.watchlistStatePersistence =
      options.watchlistStatePersistence ?? new WatchlistStatePersistence();
  }

  private persistWatchlist(): void {
    this.watchlistStatePersistence.save(this.watchlistStore.getEntries());
  }

  private buildLevelSnapshotPayload(symbol: string, timestamp: number): LevelSnapshotPayload {
    const supportLevels = uniqueSortedLevels(
      this.options.levelStore.getSupportZones(symbol).map((zone) => zone.representativePrice),
      "desc",
    );
    const resistanceLevels = uniqueSortedLevels(
      this.options.levelStore.getResistanceZones(symbol).map((zone) => zone.representativePrice),
      "asc",
    );

    return {
      symbol,
      supportLevels,
      resistanceLevels,
      timestamp,
    };
  }

  private buildLevelExtensionPayload(
    symbol: string,
    side: LevelExtensionSide,
    timestamp: number,
  ): LevelExtensionPayload | null {
    const zones =
      side === "resistance"
        ? this.options.levelStore.getExtensionResistanceZones(symbol)
        : this.options.levelStore.getExtensionSupportZones(symbol);
    const levels = uniqueSortedLevels(
      zones.map((zone) => zone.representativePrice),
      side === "resistance" ? "asc" : "desc",
    );

    if (levels.length === 0) {
      return null;
    }

    return {
      symbol,
      side,
      levels,
      timestamp,
    };
  }

  private async postLevelSnapshot(symbol: string, threadId: string, timestamp: number): Promise<void> {
    const payload = this.buildLevelSnapshotPayload(symbol, timestamp);
    const snapshotKey = JSON.stringify({
      symbol: payload.symbol,
      supportLevels: payload.supportLevels,
      resistanceLevels: payload.resistanceLevels,
    });
    const existingState = this.activeSnapshotState.get(symbol);

    if (existingState?.lastSnapshot === snapshotKey) {
      this.activeSnapshotState.set(symbol, {
        ...existingState,
        highestResistance: payload.resistanceLevels[0] ?? null,
        lowestSupport: payload.supportLevels.at(-1) ?? null,
      });
      this.watchlistStore.patchEntry(symbol, {
        lifecycle: "active",
        lastLevelPostAt: timestamp,
        refreshPending: false,
      });
      return;
    }

    await this.options.discordAlertRouter.routeLevelSnapshot(threadId, payload);
    this.activeSnapshotState.set(symbol, {
      lastSnapshot: snapshotKey,
      highestResistance: payload.resistanceLevels[0] ?? null,
      lowestSupport: payload.supportLevels.at(-1) ?? null,
      lastRefreshTriggerResistance: null,
      lastRefreshTriggerSupport: null,
      lastRefreshTimestamp: timestamp,
      lastExtensionPostKey: null,
      lastExtensionPostTimestamp: null,
    });
    this.watchlistStore.patchEntry(symbol, {
      lifecycle: "active",
      lastLevelPostAt: timestamp,
      refreshPending: false,
    });
  }

  private async postLevelExtension(
    symbol: string,
    threadId: string,
    side: LevelExtensionSide,
    timestamp: number,
  ): Promise<boolean> {
    const payload = this.buildLevelExtensionPayload(symbol, side, timestamp);
    if (!payload) {
      return false;
    }

    const extensionKey = JSON.stringify(payload);
    const existingState = this.activeSnapshotState.get(symbol);
    if (
      existingState?.lastExtensionPostKey === extensionKey &&
      existingState.lastExtensionPostTimestamp !== null &&
      timestamp - existingState.lastExtensionPostTimestamp < LEVEL_REFRESH_COOLDOWN_MS
    ) {
      return false;
    }

    await this.options.discordAlertRouter.routeLevelExtension(threadId, payload);
    this.options.levelStore.activateExtensionLevels(symbol, side);
    this.activeSnapshotState.set(symbol, {
      lastSnapshot: existingState?.lastSnapshot ?? "",
      highestResistance: existingState?.highestResistance ?? null,
      lowestSupport: existingState?.lowestSupport ?? null,
      lastRefreshTriggerResistance: existingState?.lastRefreshTriggerResistance ?? null,
      lastRefreshTriggerSupport: existingState?.lastRefreshTriggerSupport ?? null,
      lastRefreshTimestamp: existingState?.lastRefreshTimestamp ?? null,
      lastExtensionPostKey: extensionKey,
      lastExtensionPostTimestamp: timestamp,
    });
    this.watchlistStore.patchEntry(symbol, {
      lifecycle: "active",
      lastExtensionPostAt: timestamp,
    });
    return true;
  }

  private async refreshLevelsIfNeeded(symbol: string, timestamp: number): Promise<boolean> {
    const current = this.options.levelStore.getLevels(symbol);
    const decision = decideLevelRefresh({
      output: current,
      referenceTimestamp: timestamp,
    });

    if (!decision.shouldRefresh) {
      return false;
    }

    this.watchlistStore.patchEntry(symbol, {
      lifecycle: "refresh_pending",
      refreshPending: true,
    });
    await this.seedLevelsForSymbol(symbol);
    return true;
  }

  private shouldTriggerResistanceRefresh(
    update: LivePriceUpdate,
    snapshotState: ActiveLevelSnapshotState,
  ): boolean {
    if (!snapshotState.highestResistance) {
      return false;
    }

    if (update.lastPrice > snapshotState.highestResistance) {
      return false;
    }

    const distancePct =
      (snapshotState.highestResistance - update.lastPrice) /
      Math.max(snapshotState.highestResistance, 0.0001);

    if (distancePct < 0 || distancePct > LEVEL_REFRESH_THRESHOLD_PCT) {
      return false;
    }

    if (
      snapshotState.lastRefreshTriggerResistance === snapshotState.highestResistance &&
      snapshotState.lastRefreshTimestamp !== null &&
      update.timestamp - snapshotState.lastRefreshTimestamp < LEVEL_REFRESH_COOLDOWN_MS
    ) {
      return false;
    }

    return true;
  }

  private shouldTriggerSupportRefresh(
    update: LivePriceUpdate,
    snapshotState: ActiveLevelSnapshotState,
  ): boolean {
    if (!snapshotState.lowestSupport) {
      return false;
    }

    if (update.lastPrice < snapshotState.lowestSupport) {
      return false;
    }

    const distancePct =
      (update.lastPrice - snapshotState.lowestSupport) /
      Math.max(snapshotState.lowestSupport, 0.0001);

    if (distancePct < 0 || distancePct > LEVEL_REFRESH_THRESHOLD_PCT) {
      return false;
    }

    if (
      snapshotState.lastRefreshTriggerSupport === snapshotState.lowestSupport &&
      snapshotState.lastRefreshTimestamp !== null &&
      update.timestamp - snapshotState.lastRefreshTimestamp < LEVEL_REFRESH_COOLDOWN_MS
    ) {
      return false;
    }

    return true;
  }

  private async maybeRefreshLevelSnapshot(update: LivePriceUpdate): Promise<void> {
    const symbol = normalizeSymbol(update.symbol);
    const entry = this.watchlistStore.getEntry(symbol);
    const snapshotState = this.activeSnapshotState.get(symbol);

    if (
      !entry?.active ||
      !entry.discordThreadId ||
      !snapshotState ||
      (snapshotState.highestResistance === null && snapshotState.lowestSupport === null)
    ) {
      return;
    }

    const triggeredResistance = this.shouldTriggerResistanceRefresh(update, snapshotState);
    const triggeredSupport = this.shouldTriggerSupportRefresh(update, snapshotState);

    if (!triggeredResistance && !triggeredSupport) {
      return;
    }

    const side: LevelExtensionSide = triggeredResistance ? "resistance" : "support";
    const boundary =
      side === "resistance" ? snapshotState.highestResistance : snapshotState.lowestSupport;

    this.watchlistStore.patchEntry(symbol, {
      lifecycle: "extension_pending",
    });

    let extensionPosted = await this.postLevelExtension(
      symbol,
      entry.discordThreadId,
      side,
      update.timestamp,
    );

    if (!extensionPosted) {
      await this.seedLevelsForSymbol(symbol);
      await this.postLevelSnapshot(symbol, entry.discordThreadId, update.timestamp);
      extensionPosted = await this.postLevelExtension(
        symbol,
        entry.discordThreadId,
        side,
        update.timestamp,
      );
    }

    const refreshedState = this.activeSnapshotState.get(symbol);
    this.activeSnapshotState.set(symbol, {
      lastSnapshot: refreshedState?.lastSnapshot ?? snapshotState.lastSnapshot,
      highestResistance: refreshedState?.highestResistance ?? snapshotState.highestResistance,
      lowestSupport: refreshedState?.lowestSupport ?? snapshotState.lowestSupport,
      lastRefreshTriggerResistance:
        side === "resistance" ? boundary : refreshedState?.lastRefreshTriggerResistance ?? snapshotState.lastRefreshTriggerResistance,
      lastRefreshTriggerSupport:
        side === "support" ? boundary : refreshedState?.lastRefreshTriggerSupport ?? snapshotState.lastRefreshTriggerSupport,
      lastRefreshTimestamp: update.timestamp,
      lastExtensionPostKey: refreshedState?.lastExtensionPostKey ?? snapshotState.lastExtensionPostKey,
      lastExtensionPostTimestamp:
        refreshedState?.lastExtensionPostTimestamp ?? snapshotState.lastExtensionPostTimestamp,
    });

    if (!extensionPosted) {
      this.watchlistStore.patchEntry(symbol, {
        lifecycle: "active",
      });
    }
  }

  private async seedLevelsForSymbol(symbol: string): Promise<void> {
    if (this.options.seedSymbolLevels) {
      await this.options.seedSymbolLevels(symbol);
      return;
    }

    const output = await this.levelEngine.generateLevels({
      symbol,
      historicalRequests: {
        daily: { symbol, timeframe: "daily", lookbackBars: 220 },
        "4h": { symbol, timeframe: "4h", lookbackBars: 180 },
        "5m": { symbol, timeframe: "5m", lookbackBars: 100 },
      },
    });

    this.options.levelStore.setLevels(output);
  }

  private async ensureLevelsForActiveEntries(entries: WatchlistEntry[]): Promise<void> {
    for (const entry of entries) {
      if (!entry.active) {
        continue;
      }

      if (!this.options.levelStore.getLevels(entry.symbol)) {
        this.watchlistStore.patchEntry(entry.symbol, {
          lifecycle: "refresh_pending",
          refreshPending: true,
        });
        await this.seedLevelsForSymbol(entry.symbol);
      }
    }
  }

  private handleMonitoringEvent = (event: MonitoringEvent): void => {
    const entry = this.watchlistStore.getEntry(event.symbol);
    if (!entry?.active || !entry.discordThreadId) {
      return;
    }

    const levels = this.options.levelStore.getLevels(event.symbol);
    const alertResult = this.alertIntelligenceEngine.processEvent(event, levels);
    if (alertResult.formatted) {
      const alert = formatIntelligentAlertAsPayload(alertResult.rawAlert);
      void this.options.discordAlertRouter.routeAlert(entry.discordThreadId, alert).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ManualWatchlistRuntimeManager] Failed to route Discord alert: ${message}`);
      });
    }

    const snapshot = this.options.opportunityRuntimeController.processMonitoringEvent(event);
    if (snapshot.newOpportunity) {
      console.log(JSON.stringify(
        buildOpportunityDiagnosticsLogEntry("opportunity_snapshot", snapshot, {
          symbol: event.symbol,
          timestamp: event.timestamp,
        }),
        null,
        2,
      ));
    }
  };

  private handlePriceUpdate = (update: LivePriceUpdate): void => {
    void this.maybeRefreshLevelSnapshot(update).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ManualWatchlistRuntimeManager] Failed to refresh level snapshot: ${message}`);
    });

    const snapshot = this.options.opportunityRuntimeController.processPriceUpdate(update);
    if (!snapshot || snapshot.completedEvaluations.length === 0) {
      return;
    }

    console.log(JSON.stringify(
      buildOpportunityDiagnosticsLogEntry("evaluation_update", snapshot, {
        symbol: update.symbol,
        timestamp: update.timestamp,
      }),
      null,
      2,
    ));
  };

  private async restartMonitoring(): Promise<void> {
    await this.options.monitor.stop();
    const activeEntries = this.watchlistStore.getActiveEntries();

    if (activeEntries.length === 0) {
      return;
    }

    await this.ensureLevelsForActiveEntries(activeEntries);
    await this.options.monitor.start(
      activeEntries,
      this.handleMonitoringEvent,
      this.handlePriceUpdate,
    );
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    const persistedEntries = this.watchlistStatePersistence.load();
    if (persistedEntries) {
      this.watchlistStore.setEntries(persistedEntries);
    }

    const activeEntries = this.watchlistStore.getActiveEntries();
    for (const entry of activeEntries) {
      if (!entry.discordThreadId) {
        const thread = await this.options.discordAlertRouter.ensureThread(entry.symbol);
        this.watchlistStore.upsertManualEntry({
          symbol: entry.symbol,
          note: entry.note,
          discordThreadId: thread.threadId,
          active: true,
          lifecycle: "activating",
          activatedAt: entry.activatedAt ?? Date.now(),
          refreshPending: true,
        });
      }
    }
    for (const entry of activeEntries) {
      if (entry.discordThreadId) {
        await this.refreshLevelsIfNeeded(entry.symbol, Date.now());
        if (!this.options.levelStore.getLevels(entry.symbol)) {
          await this.seedLevelsForSymbol(entry.symbol);
        }
        await this.postLevelSnapshot(entry.symbol, entry.discordThreadId, Date.now());
      }
    }

    this.persistWatchlist();
    await this.restartMonitoring();
    this.isStarted = true;
  }

  async stop(): Promise<void> {
    await this.options.monitor.stop();
    this.isStarted = false;
  }

  getActiveEntries(): WatchlistEntry[] {
    return this.watchlistStore.getActiveEntries();
  }

  async activateSymbol(input: ManualWatchlistActivationInput): Promise<WatchlistEntry> {
    const symbol = normalizeSymbol(input.symbol);
    const existing = this.watchlistStore.getEntry(symbol);
    const thread = await this.options.discordAlertRouter.ensureThread(
      symbol,
      existing?.discordThreadId,
    );

    const entry = this.watchlistStore.upsertManualEntry({
      symbol,
      note: input.note,
      discordThreadId: thread.threadId,
      active: true,
      lifecycle: "activating",
      activatedAt: Date.now(),
      refreshPending: true,
    });

    await this.seedLevelsForSymbol(symbol);
    await this.postLevelSnapshot(symbol, thread.threadId, Date.now());
    this.persistWatchlist();
    await this.restartMonitoring();
    return this.watchlistStore.getEntry(symbol) ?? entry;
  }

  async deactivateSymbol(symbol: string): Promise<WatchlistEntry | null> {
    const entry = this.watchlistStore.deactivateSymbol(symbol);
    if (!entry) {
      return null;
    }

    this.activeSnapshotState.delete(normalizeSymbol(symbol));
    this.persistWatchlist();
    await this.restartMonitoring();
    return entry;
  }
}
