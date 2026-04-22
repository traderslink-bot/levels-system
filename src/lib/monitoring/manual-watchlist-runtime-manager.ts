import { CandleFetchService } from "../market-data/candle-fetch-service.js";
import { LevelEngine } from "../levels/level-engine.js";
import { resolveLevelRuntimeSettings } from "../levels/level-runtime-mode.js";
import type { FinalLevelZone } from "../levels/level-types.js";
import { decideLevelRefresh } from "../levels/level-refresh-policy.js";
import { AlertIntelligenceEngine } from "../alerts/alert-intelligence-engine.js";
import {
  formatIntelligentAlertAsPayload,
  type DiscordAlertRouter,
} from "../alerts/alert-router.js";
import type {
  LevelExtensionPayload,
  LevelExtensionSide,
  LevelSnapshotDisplayZone,
  LevelSnapshotPayload,
} from "../alerts/alert-types.js";
import { LevelStore } from "./level-store.js";
import type { LivePriceUpdate, MonitoringEvent, WatchlistEntry } from "./monitoring-types.js";
import { buildOpportunityDiagnosticsLogEntry } from "./opportunity-diagnostics.js";
import { OpportunityRuntimeController } from "./opportunity-runtime-controller.js";
import { formatInterpretationForConsole } from "./opportunity-interpretation.js";
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
  referencePrice: number | null;
  lastRefreshTriggerResistance: number | null;
  lastRefreshTriggerSupport: number | null;
  lastRefreshTimestamp: number | null;
  lastExtensionPostKey: string | null;
  lastExtensionPostTimestamp: number | null;
};

const LEVEL_REFRESH_THRESHOLD_PCT = 0.01;
const LEVEL_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const INITIAL_SNAPSHOT_RETRY_DELAY_MS = 1000;
const SNAPSHOT_PRICE_TOLERANCE_PCT = 0.001;
const SNAPSHOT_PRICE_TOLERANCE_ABSOLUTE = 0.001;
const SNAPSHOT_DISPLAY_COMPACTION_PCT = 0.0075;
const SNAPSHOT_DISPLAY_COMPACTION_ABSOLUTE = 0.01;
const SNAPSHOT_FORWARD_RESISTANCE_RANGE_PCT = 0.5;

function uniqueSortedLevels(levels: number[], direction: "asc" | "desc"): number[] {
  const unique = [...new Set(levels.filter((level) => Number.isFinite(level) && level > 0))];
  unique.sort((a, b) => (direction === "asc" ? a - b : b - a));
  return unique;
}

function snapshotPriceTolerance(price: number): number {
  return Math.max(price * SNAPSHOT_PRICE_TOLERANCE_PCT, SNAPSHOT_PRICE_TOLERANCE_ABSOLUTE);
}

function snapshotDisplayCompactionTolerance(price: number): number {
  return Math.max(price * SNAPSHOT_DISPLAY_COMPACTION_PCT, SNAPSHOT_DISPLAY_COMPACTION_ABSOLUTE);
}

function formatSnapshotLevel(level: number): string {
  return level >= 1 ? level.toFixed(2) : level.toFixed(4);
}

function freshnessRank(freshness: FinalLevelZone["freshness"]): number {
  switch (freshness) {
    case "fresh":
      return 2;
    case "aging":
      return 1;
    default:
      return 0;
  }
}

function timeframeRank(timeframeBias: FinalLevelZone["timeframeBias"]): number {
  switch (timeframeBias) {
    case "mixed":
      return 3;
    case "daily":
      return 2;
    case "4h":
      return 1;
    default:
      return 0;
  }
}

function isBetterSnapshotRepresentative(
  challenger: FinalLevelZone,
  incumbent: FinalLevelZone,
  currentPrice: number,
  side: "support" | "resistance",
): boolean {
  if (challenger.strengthScore !== incumbent.strengthScore) {
    return challenger.strengthScore > incumbent.strengthScore;
  }

  if (challenger.confluenceCount !== incumbent.confluenceCount) {
    return challenger.confluenceCount > incumbent.confluenceCount;
  }

  if (challenger.sourceEvidenceCount !== incumbent.sourceEvidenceCount) {
    return challenger.sourceEvidenceCount > incumbent.sourceEvidenceCount;
  }

  if (timeframeRank(challenger.timeframeBias) !== timeframeRank(incumbent.timeframeBias)) {
    return timeframeRank(challenger.timeframeBias) > timeframeRank(incumbent.timeframeBias);
  }

  if (freshnessRank(challenger.freshness) !== freshnessRank(incumbent.freshness)) {
    return freshnessRank(challenger.freshness) > freshnessRank(incumbent.freshness);
  }

  const challengerDistance = Math.abs(challenger.representativePrice - currentPrice);
  const incumbentDistance = Math.abs(incumbent.representativePrice - currentPrice);
  if (challengerDistance !== incumbentDistance) {
    return challengerDistance < incumbentDistance;
  }

  return side === "support"
    ? challenger.representativePrice > incumbent.representativePrice
    : challenger.representativePrice < incumbent.representativePrice;
}

function sortSnapshotZones(
  zones: FinalLevelZone[],
  side: "support" | "resistance",
): FinalLevelZone[] {
  return [...zones].sort((left, right) =>
    side === "support"
      ? right.representativePrice - left.representativePrice
      : left.representativePrice - right.representativePrice,
  );
}

function compactSnapshotZones(
  zones: FinalLevelZone[],
  currentPrice: number,
  side: "support" | "resistance",
): FinalLevelZone[] {
  const sorted = sortSnapshotZones(zones, side);
  const compacted: FinalLevelZone[] = [];
  const tolerance = snapshotDisplayCompactionTolerance(Math.max(currentPrice, 0.0001));

  for (const zone of sorted) {
    const last = compacted.at(-1);
    if (!last) {
      compacted.push(zone);
      continue;
    }

    const sameDisplayPrice =
      formatSnapshotLevel(last.representativePrice) === formatSnapshotLevel(zone.representativePrice);
    const veryClose =
      Math.abs(last.representativePrice - zone.representativePrice) <= tolerance;

    if (!sameDisplayPrice && !veryClose) {
      compacted.push(zone);
      continue;
    }

    if (isBetterSnapshotRepresentative(zone, last, currentPrice, side)) {
      compacted[compacted.length - 1] = zone;
    }
  }

  return compacted;
}

function buildSnapshotDisplayZones(
  zones: FinalLevelZone[],
  _currentPrice: number,
  side: "support" | "resistance",
): LevelSnapshotDisplayZone[] {
  return sortSnapshotZones(zones, side).map((zone) => ({
    representativePrice: zone.representativePrice,
  }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ManualWatchlistRuntimeManager {
  private readonly levelEngine: LevelEngine;
  private readonly watchlistStore: WatchlistStore;
  private readonly watchlistStatePersistence: WatchlistStatePersistence;
  private readonly alertIntelligenceEngine = new AlertIntelligenceEngine();
  private readonly activeSnapshotState = new Map<string, ActiveLevelSnapshotState>();
  private readonly pendingActivations = new Map<string, Promise<void>>();
  private isStarted = false;

  constructor(private readonly options: ManualWatchlistRuntimeManagerOptions) {
    const runtimeSettings = resolveLevelRuntimeSettings();
    this.levelEngine = new LevelEngine(options.candleFetchService, undefined, {
      runtimeMode: runtimeSettings.mode,
      compareActivePath: runtimeSettings.compareActivePath,
      onComparisonLog: runtimeSettings.compareLoggingEnabled
        ? (entry) => {
            console.log(JSON.stringify(entry));
          }
        : undefined,
    });
    this.watchlistStore = options.watchlistStore ?? new WatchlistStore();
    this.watchlistStatePersistence =
      options.watchlistStatePersistence ?? new WatchlistStatePersistence();
  }

  private persistWatchlist(): void {
    this.watchlistStatePersistence.save(this.watchlistStore.getEntries());
  }

  private buildLevelSnapshotPayload(
    symbol: string,
    timestamp: number,
    referencePriceOverride?: number,
  ): LevelSnapshotPayload {
    const levels = this.options.levelStore.getLevels(symbol);
    const currentPrice =
      (typeof referencePriceOverride === "number" && Number.isFinite(referencePriceOverride)
        ? referencePriceOverride
        : levels?.metadata.referencePrice) ?? 0;
    const normalizedPrice = Math.max(currentPrice, 0);
    const tolerance = snapshotPriceTolerance(Math.max(normalizedPrice, 0.0001));
    const levelsOutput = this.options.levelStore.getLevels(symbol);
    const maxForwardResistancePrice =
      normalizedPrice * (1 + SNAPSHOT_FORWARD_RESISTANCE_RANGE_PCT);
    const surfacedSupportZones = this.options.levelStore.getSupportZones(symbol);
    const surfacedResistanceZones = this.options.levelStore.getResistanceZones(symbol);
    const extensionResistanceZones =
      levelsOutput?.extensionLevels.resistance.filter(
        (zone) =>
          zone.representativePrice > normalizedPrice + tolerance &&
          zone.representativePrice <= maxForwardResistancePrice,
      ) ?? [];
    const supportZones = compactSnapshotZones(
      surfacedSupportZones.filter((zone) => zone.representativePrice < normalizedPrice - tolerance),
      normalizedPrice,
      "support",
    );
    const resistanceZones = compactSnapshotZones(
      [...surfacedResistanceZones, ...extensionResistanceZones].filter(
        (zone) =>
          zone.representativePrice > normalizedPrice + tolerance &&
          zone.representativePrice <= maxForwardResistancePrice,
      ),
      normalizedPrice,
      "resistance",
    );
    const supportDisplayZones = buildSnapshotDisplayZones(supportZones, normalizedPrice, "support");
    const resistanceDisplayZones = buildSnapshotDisplayZones(
      resistanceZones,
      normalizedPrice,
      "resistance",
    );

    return {
      symbol,
      currentPrice: normalizedPrice,
      supportZones: supportDisplayZones,
      resistanceZones: resistanceDisplayZones,
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

  private async postLevelSnapshot(
    symbol: string,
    threadId: string,
    timestamp: number,
    referencePriceOverride?: number,
  ): Promise<void> {
    const payload = this.buildLevelSnapshotPayload(symbol, timestamp, referencePriceOverride);
    const snapshotKey = JSON.stringify({
      symbol: payload.symbol,
      supportZones: payload.supportZones,
      resistanceZones: payload.resistanceZones,
    });
    const existingState = this.activeSnapshotState.get(symbol);

    if (existingState?.lastSnapshot === snapshotKey) {
      this.activeSnapshotState.set(symbol, {
        ...existingState,
        highestResistance: payload.resistanceZones[0]?.representativePrice ?? null,
        lowestSupport: payload.supportZones.at(-1)?.representativePrice ?? null,
        referencePrice: payload.currentPrice,
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
      highestResistance: payload.resistanceZones[0]?.representativePrice ?? null,
      lowestSupport: payload.supportZones.at(-1)?.representativePrice ?? null,
      referencePrice: payload.currentPrice,
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
      referencePrice: existingState?.referencePrice ?? null,
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
      await this.postLevelSnapshot(symbol, entry.discordThreadId, update.timestamp, update.lastPrice);
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
      referencePrice: refreshedState?.referencePrice ?? snapshotState.referencePrice,
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

  private emitTraderFacingInterpretations(
    interpretations?: ReturnType<OpportunityRuntimeController["processMonitoringEvent"]>["interpretations"],
  ): void {
    for (const interpretation of interpretations ?? []) {
      console.log(formatInterpretationForConsole(interpretation));
    }
  }

  private async ensureLevelsForActiveEntries(entries: WatchlistEntry[]): Promise<WatchlistEntry[]> {
    const startableEntries: WatchlistEntry[] = [];

    for (const entry of entries) {
      if (!entry.active) {
        continue;
      }

      if (!this.options.levelStore.getLevels(entry.symbol)) {
        this.watchlistStore.patchEntry(entry.symbol, {
          lifecycle: "refresh_pending",
          refreshPending: true,
        });

        try {
          await this.seedLevelsForSymbol(entry.symbol);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(
            `[ManualWatchlistRuntimeManager] Failed to seed levels for ${entry.symbol} during monitoring restart: ${message}`,
          );
          continue;
        }
      }

      const refreshedEntry = this.watchlistStore.getEntry(entry.symbol);
      if (refreshedEntry) {
        startableEntries.push(refreshedEntry);
      }
    }

    return startableEntries;
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
    this.emitTraderFacingInterpretations(snapshot.interpretations);
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
    if (!snapshot) {
      return;
    }

    this.emitTraderFacingInterpretations(snapshot.interpretations);
    if (snapshot.completedEvaluations.length === 0) {
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

    const startableEntries = await this.ensureLevelsForActiveEntries(activeEntries);
    if (startableEntries.length === 0) {
      return;
    }

    await this.options.monitor.start(
      startableEntries,
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
      const thread = await this.options.discordAlertRouter.ensureThread(
        entry.symbol,
        entry.discordThreadId,
      );
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
    for (const entry of this.watchlistStore.getActiveEntries()) {
      if (entry.discordThreadId) {
        try {
          await this.refreshLevelsIfNeeded(entry.symbol, Date.now());
          if (!this.options.levelStore.getLevels(entry.symbol)) {
            await this.seedLevelsForSymbol(entry.symbol);
          }
          await this.postLevelSnapshot(entry.symbol, entry.discordThreadId, Date.now());
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(
            `[ManualWatchlistRuntimeManager] Failed to restore active symbol ${entry.symbol} on startup: ${message}`,
          );
        }
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

  private async performActivation(
    input: ManualWatchlistActivationInput,
    rollbackEntries: WatchlistEntry[],
    preparedThreadId?: string | null,
  ): Promise<WatchlistEntry> {
    const symbol = normalizeSymbol(input.symbol);
    const existing = this.watchlistStore.getEntry(symbol);

    try {
      await this.seedLevelsForSymbol(symbol);
      const threadId =
        preparedThreadId ??
        (
          await this.options.discordAlertRouter.ensureThread(
            symbol,
            existing?.discordThreadId,
          )
        ).threadId;

      const entry = this.watchlistStore.upsertManualEntry({
        symbol,
        note: input.note,
        discordThreadId: threadId,
        active: true,
        lifecycle: "activating",
        activatedAt: Date.now(),
        refreshPending: true,
      });

      try {
        await this.postLevelSnapshot(symbol, threadId, Date.now());
      } catch (error) {
        if (preparedThreadId) {
          throw error;
        }

        await delay(INITIAL_SNAPSHOT_RETRY_DELAY_MS);
        await this.postLevelSnapshot(symbol, threadId, Date.now());
      }
      this.persistWatchlist();
      await this.restartMonitoring();
      return this.watchlistStore.getEntry(symbol) ?? entry;
    } catch (error) {
      this.watchlistStore.setEntries(rollbackEntries);
      this.activeSnapshotState.delete(symbol);
      this.persistWatchlist();
      throw error;
    }
  }

  async activateSymbol(input: ManualWatchlistActivationInput): Promise<WatchlistEntry> {
    return this.performActivation(input, this.watchlistStore.getEntries());
  }

  async queueActivation(input: ManualWatchlistActivationInput): Promise<WatchlistEntry> {
    const symbol = normalizeSymbol(input.symbol);
    const existing = this.watchlistStore.getEntry(symbol);
    const pending = this.pendingActivations.get(symbol);

    if (pending) {
      return (
        existing ??
        this.watchlistStore.upsertManualEntry({
          symbol,
          note: input.note,
          active: true,
          lifecycle: "activating",
          activatedAt: Date.now(),
          refreshPending: true,
        })
      );
    }

    if (existing?.active && existing.lifecycle === "active") {
      return existing;
    }

    const rollbackEntries = this.watchlistStore.getEntries();
    const thread = await this.options.discordAlertRouter.ensureThread(
      symbol,
      existing?.discordThreadId,
    );
    const queuedEntry = this.watchlistStore.upsertManualEntry({
      symbol,
      note: input.note,
      discordThreadId: thread.threadId,
      active: true,
      lifecycle: "activating",
      activatedAt: existing?.activatedAt ?? Date.now(),
      refreshPending: true,
    });
    this.persistWatchlist();

    const activationTask = this.performActivation(
      { symbol, note: input.note },
      rollbackEntries,
      thread.threadId,
    )
      .then(() => undefined)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[ManualWatchlistRuntimeManager] Background activation failed for ${symbol}: ${message}`,
        );
      })
      .finally(() => {
        this.pendingActivations.delete(symbol);
      });

    this.pendingActivations.set(symbol, activationTask);
    return queuedEntry;
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
