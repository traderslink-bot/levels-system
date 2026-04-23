import { CandleFetchService } from "../market-data/candle-fetch-service.js";
import { LevelEngine } from "../levels/level-engine.js";
import { resolveLevelRuntimeSettings } from "../levels/level-runtime-mode.js";
import type { FinalLevelZone } from "../levels/level-types.js";
import { decideLevelRefresh } from "../levels/level-refresh-policy.js";
import { AlertIntelligenceEngine } from "../alerts/alert-intelligence-engine.js";
import {
  formatContinuityUpdateAsPayload,
  formatFollowThroughStateUpdateAsPayload,
  formatFollowThroughUpdateAsPayload,
  formatIntelligentAlertAsPayload,
  formatSymbolRecapAsPayload,
  type DiscordAlertRouter,
} from "../alerts/alert-router.js";
import type { TraderCommentaryService } from "../ai/trader-commentary-service.js";
import type {
  LevelExtensionPayload,
  LevelExtensionSide,
  LevelSnapshotDisplayZone,
  LevelSnapshotPayload,
} from "../alerts/alert-types.js";
import { deriveTraderFollowThroughContext } from "../alerts/trader-message-language.js";
import { LevelStore } from "./level-store.js";
import type { LivePriceUpdate, MonitoringEvent, WatchlistEntry } from "./monitoring-types.js";
import { buildOpportunityDiagnosticsLogEntry } from "./opportunity-diagnostics.js";
import { OpportunityRuntimeController } from "./opportunity-runtime-controller.js";
import type { OpportunityInterpretation } from "./opportunity-interpretation.js";
import type { EvaluatedOpportunity, OpportunityProgressUpdate } from "./opportunity-evaluator.js";
import { WatchlistMonitor } from "./watchlist-monitor.js";
import { WatchlistStatePersistence } from "./watchlist-state-persistence.js";
import { WatchlistStore } from "./watchlist-store.js";
import type {
  ManualWatchlistLifecycleEventName,
  ManualWatchlistLifecycleListener,
} from "./manual-watchlist-runtime-events.js";

export type ManualWatchlistRuntimeManagerOptions = {
  candleFetchService: CandleFetchService;
  levelStore: LevelStore;
  monitor: WatchlistMonitor;
  discordAlertRouter: DiscordAlertRouter;
  opportunityRuntimeController: OpportunityRuntimeController;
  aiCommentaryService?: TraderCommentaryService | null;
  symbolRecapCooldownMs?: number;
  watchlistStore?: WatchlistStore;
  watchlistStatePersistence?: WatchlistStatePersistence;
  seedSymbolLevels?: (symbol: string) => Promise<void>;
  lifecycleListener?: ManualWatchlistLifecycleListener;
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
const SYMBOL_RECAP_COOLDOWN_MS = 12 * 60 * 1000;
const CONTINUITY_UPDATE_COOLDOWN_MS = 3 * 60 * 1000;
const CONTINUITY_MAJOR_TRANSITION_COOLDOWN_MS = 8 * 60 * 1000;
const FOLLOW_THROUGH_STATE_UPDATE_COOLDOWN_MS = 4 * 60 * 1000;
const OPTIONAL_LIVE_POST_WINDOW_MS = 15 * 60 * 1000;
const OPTIONAL_LIVE_POST_DENSITY_LIMIT = 4;
const OPTIONAL_LIVE_POST_KIND_LIMIT = 2;

type SymbolRecapState = {
  lastSignature: string | null;
  lastPostedAt: number | null;
  lastAiBody: string | null;
};

type SymbolContinuityState = {
  lastLabel: string | null;
  lastPostedAt: number | null;
  lastMessage: string | null;
};

type SymbolFollowThroughStatePost = {
  lastLabel: OpportunityProgressUpdate["progressLabel"] | null;
  lastPostedAt: number | null;
  lastDirectionalReturnPct: number | null;
};

type LiveThreadPostKind =
  | "snapshot"
  | "extension"
  | "intelligent_alert"
  | "follow_through"
  | "continuity"
  | "follow_through_state"
  | "recap";

type SymbolLiveThreadPostState = {
  critical: Array<{ kind: LiveThreadPostKind; timestamp: number }>;
  optional: Array<{ kind: LiveThreadPostKind; timestamp: number }>;
};

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
    strengthLabel: zone.strengthLabel,
    freshness: zone.freshness,
    isExtension: zone.isExtension,
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
  private readonly recapState = new Map<string, SymbolRecapState>();
  private readonly continuityState = new Map<string, SymbolContinuityState>();
  private readonly followThroughStatePosts = new Map<string, SymbolFollowThroughStatePost>();
  private readonly liveThreadPostState = new Map<string, SymbolLiveThreadPostState>();
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

  private emitLifecycle(
    event: ManualWatchlistLifecycleEventName,
    payload: {
      symbol?: string;
      threadId?: string | null;
      details?: Record<string, string | number | boolean | null>;
    } = {},
  ): void {
    this.options.lifecycleListener?.({
      type: "manual_watchlist_lifecycle",
      event,
      timestamp: Date.now(),
      symbol: payload.symbol,
      threadId: payload.threadId,
      details: payload.details,
    });
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
    this.recordLiveThreadPost({
      symbol,
      timestamp,
      kind: "snapshot",
      critical: true,
    });
    this.emitLifecycle("snapshot_posted", {
      symbol,
      threadId,
      details: {
        supportCount: payload.supportZones.length,
        resistanceCount: payload.resistanceZones.length,
        currentPrice: payload.currentPrice,
      },
    });
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
    this.recordLiveThreadPost({
      symbol,
      timestamp,
      kind: "extension",
      critical: true,
    });
    this.emitLifecycle("extension_posted", {
      symbol,
      threadId,
      details: {
        side,
        levelCount: payload.levels.length,
      },
    });
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
      this.emitLifecycle("levels_seeded", {
        symbol,
      });
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
    this.emitLifecycle("levels_seeded", {
      symbol,
      details: {
        generatedAt: output.generatedAt,
      },
    });
  }

  private recapCooldownMs(): number {
    return this.options.symbolRecapCooldownMs ?? SYMBOL_RECAP_COOLDOWN_MS;
  }

  private continuityLabelRank(label: string): number {
    switch (label) {
      case "setup_forming":
        return 0;
      case "confirmation":
        return 1;
      case "continuation":
        return 2;
      case "weakening":
        return 3;
      case "failed":
        return 4;
      default:
        return 0;
    }
  }

  private getLiveThreadPostState(symbol: string): SymbolLiveThreadPostState {
    const existing = this.liveThreadPostState.get(symbol);
    if (existing) {
      return existing;
    }

    const created: SymbolLiveThreadPostState = {
      critical: [],
      optional: [],
    };
    this.liveThreadPostState.set(symbol, created);
    return created;
  }

  private pruneLiveThreadPosts(symbol: string, timestamp: number): SymbolLiveThreadPostState {
    const state = this.getLiveThreadPostState(symbol);
    state.critical = state.critical.filter((entry) => timestamp - entry.timestamp <= OPTIONAL_LIVE_POST_WINDOW_MS);
    state.optional = state.optional.filter((entry) => timestamp - entry.timestamp <= OPTIONAL_LIVE_POST_WINDOW_MS);
    return state;
  }

  private recordLiveThreadPost(params: {
    symbol: string;
    timestamp: number;
    kind: LiveThreadPostKind;
    critical: boolean;
  }): void {
    const state = this.pruneLiveThreadPosts(params.symbol, params.timestamp);
    const target = params.critical ? state.critical : state.optional;
    target.push({
      kind: params.kind,
      timestamp: params.timestamp,
    });
  }

  private shouldAllowOptionalLivePost(params: {
    symbol: string;
    timestamp: number;
    kind: "continuity" | "follow_through_state" | "recap";
    majorChange: boolean;
    eventType?: string | null;
  }): boolean {
    const state = this.pruneLiveThreadPosts(params.symbol, params.timestamp);
    const recentCritical = state.critical.length;
    const recentOptional = state.optional.length;
    const recentKind = state.optional.filter((entry) => entry.kind === params.kind).length;
    const lastCriticalAt = state.critical.at(-1)?.timestamp ?? null;
    const recentCriticalAge =
      lastCriticalAt === null ? Number.POSITIVE_INFINITY : params.timestamp - lastCriticalAt;
    const optionalLead = recentOptional - recentCritical;
    const reactiveEvent =
      params.eventType !== undefined &&
      params.eventType !== null &&
      ["level_touch", "compression"].includes(params.eventType);
    const directionalEvent =
      params.eventType !== undefined &&
      params.eventType !== null &&
      ["breakout", "breakdown", "reclaim", "fake_breakout", "fake_breakdown", "rejection"].includes(params.eventType);

    if (params.majorChange) {
      return true;
    }

    if (recentOptional >= OPTIONAL_LIVE_POST_DENSITY_LIMIT && recentCriticalAge > CONTINUITY_UPDATE_COOLDOWN_MS) {
      return false;
    }

    if (recentKind >= OPTIONAL_LIVE_POST_KIND_LIMIT && recentCriticalAge > CONTINUITY_UPDATE_COOLDOWN_MS) {
      return false;
    }

    if (optionalLead >= 2 && recentCriticalAge > CONTINUITY_UPDATE_COOLDOWN_MS) {
      return false;
    }

    if (reactiveEvent && params.kind === "recap" && !params.majorChange) {
      return false;
    }

    if (reactiveEvent && params.kind === "continuity" && recentKind >= 1) {
      return false;
    }

    if (reactiveEvent && params.kind === "follow_through_state" && recentKind >= 1) {
      return false;
    }

    if (params.kind === "recap" && recentOptional >= 2 && recentCriticalAge > CONTINUITY_MAJOR_TRANSITION_COOLDOWN_MS) {
      return false;
    }

    if (
      params.kind === "recap" &&
      recentKind >= 1 &&
      optionalLead >= 1 &&
      recentCriticalAge > CONTINUITY_UPDATE_COOLDOWN_MS
    ) {
      return false;
    }

    if (
      params.kind === "continuity" &&
      recentKind >= 2 &&
      optionalLead >= 1 &&
      recentCriticalAge > CONTINUITY_UPDATE_COOLDOWN_MS
    ) {
      return false;
    }

    if (params.kind === "continuity" && !directionalEvent && recentOptional >= 2 && recentCriticalAge > CONTINUITY_UPDATE_COOLDOWN_MS) {
      return false;
    }

    if (
      params.kind === "follow_through_state" &&
      recentKind >= 1 &&
      optionalLead >= 1 &&
      recentCriticalAge > CONTINUITY_UPDATE_COOLDOWN_MS
    ) {
      return false;
    }

    if (params.kind === "follow_through_state" && !directionalEvent && recentOptional >= 2) {
      return false;
    }

    return true;
  }

  private shouldPostContinuityUpdate(params: {
    symbol: string;
    label: string;
    message: string;
    timestamp: number;
    eventType?: string | null;
  }): boolean {
    const existing = this.continuityState.get(params.symbol);
    if (!existing) {
      return true;
    }

    const age =
      existing.lastPostedAt === null ? Number.POSITIVE_INFINITY : params.timestamp - existing.lastPostedAt;
    const previousRank = this.continuityLabelRank(existing.lastLabel ?? "setup_forming");
    const nextRank = this.continuityLabelRank(params.label);

    if (
      params.label === "setup_forming" &&
      previousRank >= this.continuityLabelRank("confirmation") &&
      age < CONTINUITY_MAJOR_TRANSITION_COOLDOWN_MS
    ) {
      return false;
    }

    if (
      params.label === "confirmation" &&
      previousRank >= this.continuityLabelRank("continuation") &&
      age < CONTINUITY_MAJOR_TRANSITION_COOLDOWN_MS
    ) {
      return false;
    }

    if (
      params.label === "weakening" &&
      existing.lastLabel === "failed" &&
      age < CONTINUITY_MAJOR_TRANSITION_COOLDOWN_MS
    ) {
      return false;
    }

    const majorChange =
      params.label === "failed" ||
      params.label === "continuation" ||
      params.label === "weakening";
    const labelChanged = existing.lastLabel !== params.label;
    const meaningfullyReworded =
      existing.lastMessage !== params.message &&
      existing.lastPostedAt !== null &&
      params.timestamp - existing.lastPostedAt >= CONTINUITY_MAJOR_TRANSITION_COOLDOWN_MS;
    if (!labelChanged && !meaningfullyReworded) {
      return false;
    }

    if (
      !this.shouldAllowOptionalLivePost({
        symbol: params.symbol,
        timestamp: params.timestamp,
        kind: "continuity",
        majorChange,
        eventType: params.eventType ?? null,
      })
    ) {
      return false;
    }

    return true;
  }

  private mapInterpretationTypeToContinuityLabel(
    interpretation: OpportunityInterpretation,
  ): string {
    switch (interpretation.type) {
      case "pre_zone":
      case "in_zone":
        return "setup_forming";
      case "confirmation":
        return "confirmation";
      case "breakout_context":
        return "continuation";
      case "weakening":
        return "weakening";
      default:
        return "setup_forming";
    }
  }

  private buildContinuityUpdateFromInterpretation(
    interpretation: OpportunityInterpretation,
  ): {
    symbol: string;
    timestamp: number;
    continuityType: string;
    message: string;
    confidence: number;
    eventType: string;
  } {
    const continuityType = this.mapInterpretationTypeToContinuityLabel(interpretation);
    return {
      symbol: interpretation.symbol,
      timestamp: interpretation.timestamp,
      continuityType,
      confidence: interpretation.confidence,
      eventType: interpretation.eventType,
      message:
        continuityType === "setup_forming"
          ? `${interpretation.message}; the setup is still forming, so price still needs a cleaner decision.`
          : continuityType === "confirmation"
            ? `${interpretation.message}; the setup is now moving into confirmation and needs acceptance to hold.`
            : continuityType === "continuation"
              ? `${interpretation.message}; the setup is now in continuation and follow-through matters more than fresh anticipation.`
              : `${interpretation.message}; the setup is weakening and needs a better reaction quickly.`,
    };
  }

  private buildContinuityUpdateFromProgress(
    progressUpdate: OpportunityProgressUpdate,
  ): {
    symbol: string;
    timestamp: number;
    continuityType: string;
    message: string;
    eventType: string;
  } | null {
    const directional = progressUpdate.directionalReturnPct ?? 0;

    if (progressUpdate.progressLabel === "improving") {
      if (directional < 0.2) {
        return null;
      }

      return {
        symbol: progressUpdate.symbol,
        timestamp: progressUpdate.timestamp,
        continuityType: directional >= 0.45 ? "continuation" : "confirmation",
        eventType: progressUpdate.eventType,
        message:
          directional >= 0.45
            ? `${progressUpdate.eventType.replaceAll("_", " ")} is still improving, so the thread has moved into continuation rather than just setup.`
            : `${progressUpdate.eventType.replaceAll("_", " ")} is improving, so the setup is moving toward real confirmation.`,
      };
    }

    if (progressUpdate.progressLabel === "stalling") {
      if (directional >= 0.15) {
        return null;
      }

      return {
        symbol: progressUpdate.symbol,
        timestamp: progressUpdate.timestamp,
        continuityType: "weakening",
        eventType: progressUpdate.eventType,
        message: `${progressUpdate.eventType.replaceAll("_", " ")} is stalling, so the setup is weakening and needs fresh follow-through.`,
      };
    }

    return {
      symbol: progressUpdate.symbol,
      timestamp: progressUpdate.timestamp,
      continuityType: "failed",
      eventType: progressUpdate.eventType,
      message: `${progressUpdate.eventType.replaceAll("_", " ")} is degrading enough that the setup is now close to failure unless it stabilizes quickly.`,
    };
  }

  private buildContinuityUpdateFromEvaluation(
    evaluation: EvaluatedOpportunity,
  ): {
    symbol: string;
    timestamp: number;
    continuityType: string;
    message: string;
    eventType: string;
  } {
    if (evaluation.followThroughLabel === "strong" || evaluation.followThroughLabel === "working") {
      return {
        symbol: evaluation.symbol,
        timestamp: evaluation.evaluatedAt,
        continuityType: "continuation",
        eventType: evaluation.eventType,
        message: `${evaluation.eventType.replaceAll("_", " ")} kept working after the alert, so the thread stayed in continuation instead of fading immediately.`,
      };
    }

    if (evaluation.followThroughLabel === "stalled") {
      return {
        symbol: evaluation.symbol,
        timestamp: evaluation.evaluatedAt,
        continuityType: "weakening",
        eventType: evaluation.eventType,
        message: `${evaluation.eventType.replaceAll("_", " ")} stalled after the alert, so the setup weakened instead of following through cleanly.`,
      };
    }

    return {
      symbol: evaluation.symbol,
      timestamp: evaluation.evaluatedAt,
      continuityType: "failed",
      eventType: evaluation.eventType,
      message: `${evaluation.eventType.replaceAll("_", " ")} failed after the alert, so the thread should now be treated as failed until a new setup forms.`,
    };
  }

  private postContinuityUpdate(update: {
    symbol: string;
    timestamp: number;
    continuityType: string;
    message: string;
    confidence?: number;
    eventType?: string | null;
  }): void {
    if (
      !this.shouldPostContinuityUpdate({
        symbol: update.symbol,
        label: update.continuityType,
        message: update.message,
        timestamp: update.timestamp,
        eventType: update.eventType ?? null,
      })
    ) {
      return;
    }

    const entry = this.watchlistStore.getEntry(update.symbol);
    if (!entry?.active || !entry.discordThreadId) {
      return;
    }

    const payload = formatContinuityUpdateAsPayload({
      update,
    });

    void this.options.discordAlertRouter
      .routeAlert(entry.discordThreadId, payload)
      .then(() => {
        this.continuityState.set(update.symbol, {
          lastLabel: update.continuityType,
          lastPostedAt: update.timestamp,
          lastMessage: update.message,
        });
        this.recordLiveThreadPost({
          symbol: update.symbol,
          timestamp: update.timestamp,
          kind: "continuity",
          critical: false,
        });
        this.emitLifecycle("continuity_posted", {
          symbol: update.symbol,
          threadId: entry.discordThreadId,
          details: {
            continuityType: update.continuityType,
            confidence: update.confidence ?? null,
          },
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.emitLifecycle("continuity_post_failed", {
          symbol: update.symbol,
          threadId: entry.discordThreadId,
          details: {
            continuityType: update.continuityType,
            error: message,
          },
        });
        console.error(`[ManualWatchlistRuntimeManager] Failed to route continuity update: ${message}`);
      });
  }

  private emitTraderFacingInterpretations(
    interpretations?: ReturnType<OpportunityRuntimeController["processMonitoringEvent"]>["interpretations"],
  ): void {
    for (const interpretation of interpretations ?? []) {
      console.log(JSON.stringify({
        type: "trader_continuity_interpretation",
        symbol: interpretation.symbol,
        continuityType: interpretation.type,
        confidence: interpretation.confidence,
        message: interpretation.message,
        timestamp: interpretation.timestamp,
      }));
      this.postContinuityUpdate(this.buildContinuityUpdateFromInterpretation(interpretation));
    }
  }

  private postFollowThroughStateUpdate(progressUpdate: OpportunityProgressUpdate): void {
    const entry = this.watchlistStore.getEntry(progressUpdate.symbol);
    if (!entry?.active || !entry.discordThreadId) {
      return;
    }

    if (
      !this.shouldAllowOptionalLivePost({
        symbol: progressUpdate.symbol,
        timestamp: progressUpdate.timestamp,
        kind: "follow_through_state",
        majorChange: progressUpdate.progressLabel === "degrading",
        eventType: progressUpdate.eventType,
      })
    ) {
      return;
    }

    const existing = this.followThroughStatePosts.get(progressUpdate.symbol);
    const age =
      existing?.lastPostedAt === null || existing?.lastPostedAt === undefined
        ? Number.POSITIVE_INFINITY
        : progressUpdate.timestamp - existing.lastPostedAt;
    const previousDirectional = existing?.lastDirectionalReturnPct ?? null;
    const directionalDelta =
      previousDirectional === null || progressUpdate.directionalReturnPct === null
        ? Number.POSITIVE_INFINITY
        : Math.abs(progressUpdate.directionalReturnPct - previousDirectional);
    const minimumDelta =
      progressUpdate.progressLabel === "improving"
        ? 0.45
        : progressUpdate.progressLabel === "stalling"
          ? 0.35
          : 0.25;

    if (
      existing &&
      existing.lastLabel === progressUpdate.progressLabel &&
      age < FOLLOW_THROUGH_STATE_UPDATE_COOLDOWN_MS
    ) {
      return;
    }

    if (
      existing &&
      existing.lastLabel !== progressUpdate.progressLabel &&
      age < CONTINUITY_UPDATE_COOLDOWN_MS &&
      directionalDelta < minimumDelta
    ) {
      return;
    }

    const payload = formatFollowThroughStateUpdateAsPayload({
      symbol: progressUpdate.symbol,
      timestamp: progressUpdate.timestamp,
      eventType: progressUpdate.eventType,
      progressLabel: progressUpdate.progressLabel,
      directionalReturnPct: progressUpdate.directionalReturnPct,
      entryPrice: progressUpdate.entryPrice,
      currentPrice: progressUpdate.currentPrice,
    });

    void this.options.discordAlertRouter
      .routeAlert(entry.discordThreadId, payload)
      .then(() => {
        this.recordLiveThreadPost({
          symbol: progressUpdate.symbol,
          timestamp: progressUpdate.timestamp,
          kind: "follow_through_state",
          critical: false,
        });
        this.followThroughStatePosts.set(progressUpdate.symbol, {
          lastLabel: progressUpdate.progressLabel,
          lastPostedAt: progressUpdate.timestamp,
          lastDirectionalReturnPct: progressUpdate.directionalReturnPct,
        });
        this.emitLifecycle("follow_through_state_posted", {
          symbol: progressUpdate.symbol,
          threadId: entry.discordThreadId,
          details: {
            eventType: progressUpdate.eventType,
            progressLabel: progressUpdate.progressLabel,
            directionalReturnPct: progressUpdate.directionalReturnPct,
          },
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.emitLifecycle("follow_through_state_post_failed", {
          symbol: progressUpdate.symbol,
          threadId: entry.discordThreadId,
          details: {
            eventType: progressUpdate.eventType,
            error: message,
          },
        });
        console.error(`[ManualWatchlistRuntimeManager] Failed to route follow-through state update: ${message}`);
      });
  }

  private maybeBypassRecapCooldown(params: {
    interpretation?: OpportunityInterpretation;
    progressUpdate?: OpportunityProgressUpdate;
    evaluation?: EvaluatedOpportunity;
  }): boolean {
    return (
      params.evaluation?.followThroughLabel === "failed" ||
      params.evaluation?.followThroughLabel === "strong" ||
      params.progressUpdate?.progressLabel === "degrading" ||
      params.interpretation?.type === "weakening"
    );
  }

  private describeWhatMattersNext(
    topOpportunity:
      | ReturnType<OpportunityRuntimeController["processMonitoringEvent"]>["top"][number]
      | undefined,
  ): string | null {
    if (!topOpportunity) {
      return null;
    }

    const eventType = (topOpportunity.eventType ?? topOpportunity.type).replaceAll("_", " ");
    if (topOpportunity.clearanceLabel === "tight") {
      return `What matters next: ${eventType} needs immediate follow-through because room still looks tight.`;
    }

    if (topOpportunity.pathQualityLabel === "choppy") {
      return `What matters next: ${eventType} needs cleaner acceptance because the path ahead still looks choppy.`;
    }

    if (
      topOpportunity.exhaustionLabel === "worn" ||
      topOpportunity.exhaustionLabel === "spent"
    ) {
      return `What matters next: ${eventType} needs a decisive reaction because the active level is getting too worn to trust on weak follow-through.`;
    }

    return `What matters next: ${eventType} still needs clean acceptance so the thread can stay in continuation.`;
  }

  private buildSymbolRecapBody(params: {
    symbol: string;
    timestamp: number;
    snapshot: ReturnType<OpportunityRuntimeController["processMonitoringEvent"]>;
    interpretation?: OpportunityInterpretation;
    progressUpdate?: OpportunityProgressUpdate;
    evaluation?: EvaluatedOpportunity;
  }): string | null {
    const topOpportunity = (params.snapshot.top ?? []).find((opportunity) => opportunity.symbol === params.symbol);
    const parts: string[] = [];

    if (topOpportunity) {
      const eventType = (topOpportunity.eventType ?? topOpportunity.type).replaceAll("_", " ");
      const level = topOpportunity.level >= 1 ? topOpportunity.level.toFixed(2) : topOpportunity.level.toFixed(4);
      parts.push(
        `state recap: ${eventType} is still the lead idea near ${level} with ${topOpportunity.classification.replaceAll("_", " ")} quality.`,
      );

      const pathLine =
        topOpportunity.pathQualityLabel === "choppy"
          ? "Path still looks messy beyond the first barrier, so chop risk remains high."
          : topOpportunity.pathQualityLabel === "layered"
            ? "Path is still layered beyond the first barrier, so follow-through may need to stair-step."
            : topOpportunity.clearanceLabel === "open"
              ? "Room still looks open enough for clean follow-through if the move holds."
              : topOpportunity.clearanceLabel === "limited"
                ? "Room still looks limited, so the move needs tighter follow-through."
                : null;
      if (pathLine) {
        parts.push(pathLine);
      }

      if (topOpportunity.exhaustionLabel === "worn" || topOpportunity.exhaustionLabel === "spent") {
        parts.push(
          `The active level still matters structurally, but it now looks ${topOpportunity.exhaustionLabel}, so reactions there are less trustworthy than fresh ones.`,
        );
      }

      const nextStepLine = this.describeWhatMattersNext(topOpportunity);
      if (nextStepLine) {
        parts.push(nextStepLine);
      }
    }

    if (params.interpretation) {
      parts.push(`Continuity: ${params.interpretation.message}.`);
    }

    if (params.progressUpdate) {
      parts.push(
        `Live follow-through is ${params.progressUpdate.progressLabel}, with directional progress ${
          params.progressUpdate.directionalReturnPct === null
            ? "still unclear"
            : `${params.progressUpdate.directionalReturnPct >= 0 ? "+" : "-"}${Math.abs(params.progressUpdate.directionalReturnPct).toFixed(2)}%`
        }.`,
      );
    } else if (params.evaluation) {
      parts.push(
        `Latest tracked follow-through finished ${params.evaluation.followThroughLabel} at ${
          params.evaluation.directionalReturnPct === null
            ? "n/a"
            : `${params.evaluation.directionalReturnPct >= 0 ? "+" : "-"}${Math.abs(params.evaluation.directionalReturnPct).toFixed(2)}%`
        } directional return.`,
      );
    }

    if (parts.length === 0) {
      return null;
    }

    return parts.join("\n");
  }

  private buildRecapSignature(params: {
    snapshot: ReturnType<OpportunityRuntimeController["processMonitoringEvent"]>;
    symbol: string;
    interpretation?: OpportunityInterpretation;
    progressUpdate?: OpportunityProgressUpdate;
    evaluation?: EvaluatedOpportunity;
  }): string {
    const topOpportunity = (params.snapshot.top ?? []).find((opportunity) => opportunity.symbol === params.symbol);
    return JSON.stringify({
      topEventType: topOpportunity?.eventType ?? topOpportunity?.type ?? null,
      classification: topOpportunity?.classification ?? null,
      clearance: topOpportunity?.clearanceLabel ?? null,
      pathQuality: topOpportunity?.pathQualityLabel ?? null,
      exhaustion: topOpportunity?.exhaustionLabel ?? null,
      interpretationType: params.interpretation?.type ?? null,
      progressLabel: params.progressUpdate?.progressLabel ?? null,
      followThroughLabel: params.evaluation?.followThroughLabel ?? null,
    });
  }

  private async maybeBuildRecapBodyWithAI(params: {
    symbol: string;
    deterministicBody: string;
    snapshot: ReturnType<OpportunityRuntimeController["processMonitoringEvent"]>;
    progressUpdate?: OpportunityProgressUpdate;
    evaluation?: EvaluatedOpportunity;
  }): Promise<{
    body: string;
    aiGenerated: boolean;
  }> {
    const aiCommentaryService = this.options.aiCommentaryService;
    if (!aiCommentaryService) {
      return {
        body: params.deterministicBody,
        aiGenerated: false,
      };
    }

    try {
      const commentary = await aiCommentaryService.summarizeSymbolThread({
        symbol: params.symbol,
        deterministicRecap: params.deterministicBody,
        topOpportunity: (params.snapshot.top ?? []).find((opportunity) => opportunity.symbol === params.symbol) ?? null,
        latestProgress: params.progressUpdate ?? null,
        latestEvaluation: params.evaluation ?? null,
      });

      if (!commentary?.text) {
        return {
          body: params.deterministicBody,
          aiGenerated: false,
        };
      }

      this.emitLifecycle("ai_commentary_generated", {
        symbol: params.symbol,
        details: {
          model: commentary.model,
          commentaryType: "symbol_thread_recap",
        },
      });

      return {
        body: `${params.deterministicBody}\nAI note: ${commentary.text}`,
        aiGenerated: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitLifecycle("ai_commentary_failed", {
        symbol: params.symbol,
        details: {
          error: message,
          commentaryType: "symbol_thread_recap",
        },
      });
      console.error(`[ManualWatchlistRuntimeManager] Failed to build AI recap commentary: ${message}`);
      return {
        body: params.deterministicBody,
        aiGenerated: false,
      };
    }
  }

  private maybePostSymbolRecap(params: {
    symbol: string;
    timestamp: number;
    snapshot: ReturnType<OpportunityRuntimeController["processMonitoringEvent"]>;
    interpretation?: OpportunityInterpretation;
    progressUpdate?: OpportunityProgressUpdate;
    evaluation?: EvaluatedOpportunity;
  }): void {
    const entry = this.watchlistStore.getEntry(params.symbol);
    if (!entry?.active || !entry.discordThreadId) {
      return;
    }

    const deterministicBody = this.buildSymbolRecapBody(params);
    if (!deterministicBody) {
      return;
    }

    if (
      !params.progressUpdate &&
      !params.evaluation &&
      (!params.interpretation ||
        (params.interpretation.type !== "confirmation" && params.interpretation.type !== "weakening"))
    ) {
      return;
    }

    const signature = this.buildRecapSignature(params);
    const recapState = this.recapState.get(params.symbol) ?? {
      lastSignature: null,
      lastPostedAt: null,
      lastAiBody: null,
    };
    const recentlyPosted =
      recapState.lastPostedAt !== null &&
      params.timestamp - recapState.lastPostedAt < this.recapCooldownMs();

    if (recentlyPosted && recapState.lastSignature === signature) {
      return;
    }

    if (
      recentlyPosted &&
      !this.maybeBypassRecapCooldown({
        interpretation: params.interpretation,
        progressUpdate: params.progressUpdate,
        evaluation: params.evaluation,
      })
    ) {
      return;
    }

    if (
      !this.shouldAllowOptionalLivePost({
        symbol: params.symbol,
        timestamp: params.timestamp,
        kind: "recap",
        majorChange: this.maybeBypassRecapCooldown({
          interpretation: params.interpretation,
          progressUpdate: params.progressUpdate,
          evaluation: params.evaluation,
        }),
        eventType:
          params.evaluation?.eventType ??
          params.progressUpdate?.eventType ??
          params.interpretation?.eventType ??
          null,
      })
    ) {
      return;
    }

    void this.maybeBuildRecapBodyWithAI({
      symbol: params.symbol,
      deterministicBody,
      snapshot: params.snapshot,
      progressUpdate: params.progressUpdate,
      evaluation: params.evaluation,
    }).then(({ body, aiGenerated }) => {
      const payload = formatSymbolRecapAsPayload({
        symbol: params.symbol,
        timestamp: params.timestamp,
        body,
        aiGenerated,
      });

      void this.options.discordAlertRouter
        .routeAlert(entry.discordThreadId!, payload)
        .then(() => {
        this.recapState.set(params.symbol, {
          lastSignature: signature,
          lastPostedAt: params.timestamp,
          lastAiBody: aiGenerated ? body : null,
        });
        this.recordLiveThreadPost({
          symbol: params.symbol,
          timestamp: params.timestamp,
          kind: "recap",
          critical: false,
        });
        this.emitLifecycle("recap_posted", {
            symbol: params.symbol,
            threadId: entry.discordThreadId,
            details: {
              aiGenerated,
            },
          });
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.emitLifecycle("recap_post_failed", {
            symbol: params.symbol,
            threadId: entry.discordThreadId,
            details: {
              error: message,
            },
          });
          console.error(`[ManualWatchlistRuntimeManager] Failed to route symbol recap: ${message}`);
        });
    });
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
      alert.metadata = {
        ...alert.metadata,
        postingFamily: alertResult.delivery.family,
        postingDecisionReason: alertResult.delivery.reason,
      };
      void this.options.discordAlertRouter
      .routeAlert(entry.discordThreadId, alert)
      .then(() => {
        this.recordLiveThreadPost({
          symbol: event.symbol,
          timestamp: event.timestamp,
          kind: "intelligent_alert",
          critical: true,
        });
        this.emitLifecycle("alert_posted", {
            symbol: event.symbol,
            threadId: entry.discordThreadId,
            details: {
              eventType: event.eventType,
              severity: alertResult.rawAlert.severity,
              confidence: alertResult.rawAlert.confidence,
              score: alertResult.rawAlert.score,
              family: alertResult.delivery.family ?? null,
              reason: alertResult.delivery.reason,
              clearanceLabel: alertResult.rawAlert.nextBarrier?.clearanceLabel ?? null,
              barrierClutterLabel: alertResult.rawAlert.nextBarrier?.clutterLabel ?? null,
              nearbyBarrierCount: alertResult.rawAlert.nextBarrier?.nearbyBarrierCount ?? null,
              nextBarrierSide: alertResult.rawAlert.nextBarrier?.side ?? null,
              nextBarrierDistancePct: alertResult.rawAlert.nextBarrier?.distancePct ?? null,
              tacticalRead: alertResult.rawAlert.tacticalRead ?? null,
              pathQualityLabel: alertResult.rawAlert.pathQuality?.label ?? null,
              pathConstraintScore: alertResult.rawAlert.pathQuality?.pathConstraintScore ?? null,
              pathWindowDistancePct: alertResult.rawAlert.pathQuality?.pathWindowDistancePct ?? null,
              dipBuyQualityLabel: alertResult.rawAlert.dipBuyQuality?.label ?? null,
              exhaustionLabel: alertResult.rawAlert.exhaustion?.label ?? null,
            },
          });
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.emitLifecycle("alert_post_failed", {
            symbol: event.symbol,
            threadId: entry.discordThreadId,
            details: {
              eventType: event.eventType,
              error: message,
            },
          });
          console.error(`[ManualWatchlistRuntimeManager] Failed to route Discord alert: ${message}`);
        });
    } else {
      this.emitLifecycle("alert_suppressed", {
        symbol: event.symbol,
        threadId: entry.discordThreadId,
        details: {
          eventType: event.eventType,
          severity: alertResult.rawAlert.severity,
          confidence: alertResult.rawAlert.confidence,
          score: alertResult.rawAlert.score,
          family: alertResult.delivery.family ?? null,
          reason: alertResult.delivery.reason,
          clearanceLabel: alertResult.rawAlert.nextBarrier?.clearanceLabel ?? null,
          barrierClutterLabel: alertResult.rawAlert.nextBarrier?.clutterLabel ?? null,
          nearbyBarrierCount: alertResult.rawAlert.nextBarrier?.nearbyBarrierCount ?? null,
          nextBarrierSide: alertResult.rawAlert.nextBarrier?.side ?? null,
          nextBarrierDistancePct: alertResult.rawAlert.nextBarrier?.distancePct ?? null,
          tacticalRead: alertResult.rawAlert.tacticalRead ?? null,
          pathQualityLabel: alertResult.rawAlert.pathQuality?.label ?? null,
          pathConstraintScore: alertResult.rawAlert.pathQuality?.pathConstraintScore ?? null,
          pathWindowDistancePct: alertResult.rawAlert.pathQuality?.pathWindowDistancePct ?? null,
          dipBuyQualityLabel: alertResult.rawAlert.dipBuyQuality?.label ?? null,
          exhaustionLabel: alertResult.rawAlert.exhaustion?.label ?? null,
        },
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
      ));
    }
    this.maybePostSymbolRecap({
      symbol: event.symbol,
      timestamp: event.timestamp,
      snapshot,
      interpretation: (snapshot.interpretations ?? []).find((interpretation) => interpretation.symbol === event.symbol),
    });
  };

  private postFollowThroughUpdate(evaluation: EvaluatedOpportunity): void {
    const entry = this.watchlistStore.getEntry(evaluation.symbol);
    if (!entry?.active || !entry.discordThreadId) {
      return;
    }

    const followThrough = deriveTraderFollowThroughContext({
      eventType: evaluation.eventType,
      returnPct: evaluation.returnPct,
      directionalReturnPct: evaluation.directionalReturnPct,
      followThroughLabel: evaluation.followThroughLabel,
    });
    const payload = formatFollowThroughUpdateAsPayload({
      symbol: evaluation.symbol,
      timestamp: evaluation.evaluatedAt,
      followThrough,
      entryPrice: evaluation.entryPrice,
      outcomePrice: evaluation.outcomePrice,
    });

    void this.options.discordAlertRouter
      .routeAlert(entry.discordThreadId, payload)
      .then(() => {
        this.recordLiveThreadPost({
          symbol: evaluation.symbol,
          timestamp: evaluation.evaluatedAt,
          kind: "follow_through",
          critical: true,
        });
        this.emitLifecycle("follow_through_posted", {
          symbol: evaluation.symbol,
          threadId: entry.discordThreadId,
          details: {
            eventType: evaluation.eventType,
            followThroughLabel: evaluation.followThroughLabel,
            directionalReturnPct: evaluation.directionalReturnPct,
            rawReturnPct: evaluation.returnPct,
          },
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.emitLifecycle("follow_through_post_failed", {
          symbol: evaluation.symbol,
          threadId: entry.discordThreadId,
          details: {
            eventType: evaluation.eventType,
            error: message,
          },
        });
        console.error(`[ManualWatchlistRuntimeManager] Failed to route follow-through update: ${message}`);
      });
  }

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
    if (
      snapshot.completedEvaluations.length > 0 ||
      snapshot.progressUpdates.length > 0
    ) {
      console.log(JSON.stringify(
        buildOpportunityDiagnosticsLogEntry("evaluation_update", snapshot, {
          symbol: update.symbol,
          timestamp: update.timestamp,
        }),
      ));
    }

    for (const progressUpdate of snapshot.progressUpdates) {
      this.postFollowThroughStateUpdate(progressUpdate);
      const continuityUpdate = this.buildContinuityUpdateFromProgress(progressUpdate);
      if (continuityUpdate) {
        this.postContinuityUpdate(continuityUpdate);
      }
      this.maybePostSymbolRecap({
        symbol: progressUpdate.symbol,
        timestamp: progressUpdate.timestamp,
        snapshot,
        progressUpdate,
        interpretation: (snapshot.interpretations ?? []).find((interpretation) => interpretation.symbol === progressUpdate.symbol),
      });
    }

    for (const evaluation of snapshot.completedEvaluations) {
      this.postFollowThroughUpdate(evaluation);
      this.postContinuityUpdate(this.buildContinuityUpdateFromEvaluation(evaluation));
      this.maybePostSymbolRecap({
        symbol: evaluation.symbol,
        timestamp: evaluation.evaluatedAt,
        snapshot,
        evaluation,
        interpretation: (snapshot.interpretations ?? []).find((interpretation) => interpretation.symbol === evaluation.symbol),
      });
    }
  };

  private async restartMonitoring(): Promise<void> {
    await this.options.monitor.stop();
    const activeEntries = this.watchlistStore.getActiveEntries();

    if (activeEntries.length === 0) {
      this.emitLifecycle("monitor_restart_completed", {
        details: {
          activeSymbolCount: 0,
          startableSymbolCount: 0,
        },
      });
      return;
    }

    const startableEntries = await this.ensureLevelsForActiveEntries(activeEntries);
    if (startableEntries.length === 0) {
      this.emitLifecycle("monitor_restart_completed", {
        details: {
          activeSymbolCount: activeEntries.length,
          startableSymbolCount: 0,
        },
      });
      return;
    }

    await this.options.monitor.start(
      startableEntries,
      this.handleMonitoringEvent,
      this.handlePriceUpdate,
    );
    this.emitLifecycle("monitor_restart_completed", {
      details: {
        activeSymbolCount: activeEntries.length,
        startableSymbolCount: startableEntries.length,
      },
    });
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
      this.emitLifecycle("thread_ready", {
        symbol: entry.symbol,
        threadId: thread.threadId,
        details: {
          reused: thread.reused,
          recovered: thread.recovered,
          created: thread.created,
          source: "startup",
        },
      });
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
          this.emitLifecycle("restore_failed", {
            symbol: entry.symbol,
            threadId: entry.discordThreadId ?? null,
            details: {
              error: message,
            },
          });
          console.error(
            `[ManualWatchlistRuntimeManager] Failed to restore active symbol ${entry.symbol} on startup: ${message}`,
          );
        }
      }
    }

    this.persistWatchlist();
    await this.restartMonitoring();
    this.isStarted = true;
    this.emitLifecycle("runtime_started", {
      details: {
        activeSymbolCount: this.watchlistStore.getActiveEntries().length,
      },
    });
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
      this.emitLifecycle("activation_started", {
        symbol,
        threadId: preparedThreadId ?? existing?.discordThreadId ?? null,
      });
      await this.seedLevelsForSymbol(symbol);
      const threadId =
        preparedThreadId ??
        (
          await this.options.discordAlertRouter.ensureThread(
            symbol,
            existing?.discordThreadId,
          )
        ).threadId;
      if (!preparedThreadId) {
        this.emitLifecycle("thread_ready", {
          symbol,
          threadId,
          details: {
            reused: Boolean(existing?.discordThreadId),
            recovered: false,
            created: !existing?.discordThreadId,
            source: "activation",
          },
        });
      }

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
      this.emitLifecycle("activation_completed", {
        symbol,
        threadId,
      });
      return this.watchlistStore.getEntry(symbol) ?? entry;
    } catch (error) {
      this.watchlistStore.setEntries(rollbackEntries);
      this.activeSnapshotState.delete(symbol);
      this.persistWatchlist();
      const message = error instanceof Error ? error.message : String(error);
      this.emitLifecycle("activation_failed", {
        symbol,
        threadId: preparedThreadId ?? existing?.discordThreadId ?? null,
        details: {
          error: message,
        },
      });
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
    this.emitLifecycle("thread_ready", {
      symbol,
      threadId: thread.threadId,
      details: {
        reused: thread.reused,
        recovered: thread.recovered,
        created: thread.created,
        source: "queue",
      },
    });
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
    this.emitLifecycle("activation_queued", {
      symbol,
      threadId: thread.threadId,
    });

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
    this.recapState.delete(normalizeSymbol(symbol));
    this.continuityState.delete(normalizeSymbol(symbol));
    this.followThroughStatePosts.delete(normalizeSymbol(symbol));
    this.liveThreadPostState.delete(normalizeSymbol(symbol));
    this.persistWatchlist();
    await this.restartMonitoring();
    this.emitLifecycle("deactivated", {
      symbol: entry.symbol,
      threadId: entry.discordThreadId ?? null,
    });
    return entry;
  }
}
