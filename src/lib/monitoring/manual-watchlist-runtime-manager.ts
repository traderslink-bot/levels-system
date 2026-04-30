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
import { buildFinnhubThreadPreviewPayload } from "../stock-context/finnhub-thread-preview.js";
import type { StockContextPreview } from "../stock-context/stock-context-types.js";
import type {
  DiscordThreadRoutingResult,
  AlertPayload,
  IntelligentAlert,
  LevelExtensionPayload,
  LevelExtensionSide,
  LevelSnapshotAudit,
  LevelSnapshotAuditZone,
  LevelSnapshotDisplayZone,
  LevelSnapshotPayload,
} from "../alerts/alert-types.js";
import { deriveTraderFollowThroughContext, describeZoneStrength } from "../alerts/trader-message-language.js";
import { LevelStore } from "./level-store.js";
import type {
  LivePriceUpdate,
  MonitoringEvent,
  WatchlistEntry,
  WatchlistLifecycleState,
} from "./monitoring-types.js";
import { buildOpportunityDiagnosticsLogEntry } from "./opportunity-diagnostics.js";
import { OpportunityRuntimeController } from "./opportunity-runtime-controller.js";
import type { OpportunityInterpretation } from "./opportunity-interpretation.js";
import type { EvaluatedOpportunity, OpportunityProgressUpdate } from "./opportunity-evaluator.js";
import { WatchlistMonitor } from "./watchlist-monitor.js";
import { WatchlistStatePersistence } from "./watchlist-state-persistence.js";
import { WatchlistStore } from "./watchlist-store.js";
import type {
  ManualWatchlistLifecycleEvent,
  ManualWatchlistLifecycleEventName,
  ManualWatchlistLifecycleListener,
} from "./manual-watchlist-runtime-events.js";
import {
  buildAiSignalStoryKey,
  buildFollowThroughStoryRecord,
  buildIntelligentAlertStoryRecord,
  decideCriticalLivePost,
  decideIntelligentAlertPost,
  decideNarrationBurst,
  decideAiSignalPost,
  decideFollowThroughPost,
  decideOptionalLivePost,
  pruneAiSignalStoryRecords,
  pruneFollowThroughStoryRecords,
  pruneIntelligentAlertStoryRecords,
  getLiveThreadPostingPolicySettings,
  resolveLiveThreadPostingProfile,
  type AiSignalStoryRecord,
  type CriticalLivePostKind,
  type FollowThroughPostDecision,
  type FollowThroughStoryRecord,
  type IntelligentAlertStoryRecord,
  type LiveThreadPostingPolicySettings,
  type LiveThreadPostingProfile,
  type LiveThreadPostRecord,
  type LiveThreadRuntimePostKind,
  type NarrationBurstKind,
  type NarrationBurstRecord,
} from "./live-thread-post-policy.js";

export type ManualWatchlistRuntimeManagerOptions = {
  candleFetchService: CandleFetchService;
  levelStore: LevelStore;
  monitor: WatchlistMonitor;
  discordAlertRouter: DiscordAlertRouter;
  opportunityRuntimeController: OpportunityRuntimeController;
  historicalLookbackBars?: ManualWatchlistHistoricalLookbacks;
  aiCommentaryService?: TraderCommentaryService | null;
  symbolRecapCooldownMs?: number;
  watchlistStore?: WatchlistStore;
  watchlistStatePersistence?: WatchlistStatePersistence;
  seedSymbolLevels?: (symbol: string) => Promise<void>;
  lifecycleListener?: ManualWatchlistLifecycleListener;
  optionalPostSettleDelayMs?: number;
  postingProfile?: LiveThreadPostingProfile | string | null;
  levelSeedTimeoutMs?: number;
  queuedActivationSeedGraceTimeoutMs?: number;
  activationAutoRetryDelayMs?: number;
  activationMaxAutoRetries?: number;
  activationStuckWarningMs?: number;
  levelTouchSupersedeDelayMs?: number;
  stockContextProvider?: {
    getThreadPreview(symbolInput: string): Promise<StockContextPreview>;
  } | null;
};

export type ManualWatchlistHistoricalLookbacks = {
  daily: number;
  "4h": number;
  "5m": number;
};

export type ManualWatchlistActivationInput = {
  symbol: string;
  note?: string;
};

export type ManualWatchlistRuntimeHealth = {
  isStarted: boolean;
  pendingActivationCount: number;
  lifecycleCounts: Record<WatchlistLifecycleState, number>;
  lastPriceUpdateAt: number | null;
  lastPriceUpdateSymbol: string | null;
  lastThreadPostAt: number | null;
  lastThreadPostSymbol: string | null;
  lastThreadPostKind: LiveThreadPostKind | null;
  lastDeliveryFailureAt: number | null;
  lastDeliveryFailureSymbol: string | null;
  lastDeliveryFailureMessage: string | null;
  stuckActivations: ManualWatchlistStuckActivation[];
  aiCommentary: ManualWatchlistAiCommentaryHealth;
};

export type ManualWatchlistActivityEntry = ManualWatchlistLifecycleEvent & {
  id: number;
  message: string;
};

export type ManualWatchlistAiCommentaryHealth = {
  serviceAvailable: boolean;
  generatedCount: number;
  failedCount: number;
  lastGeneratedAt: number | null;
  lastGeneratedSymbol: string | null;
  lastGeneratedModel: string | null;
  lastFailedAt: number | null;
  lastFailedSymbol: string | null;
  lastFailureMessage: string | null;
  route: "symbol_recaps_and_live_alert_ai_reads";
};

export type ManualWatchlistStuckActivation = {
  symbol: string;
  threadId: string | null;
  activatedAt: number | null;
  stuckForMs: number;
  reason: string;
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
  extensionPostInFlightKey: string | null;
  lastClearedResistance?: number | null;
  lastClearedSupport?: number | null;
  lastLevelClearTimestamp?: number | null;
};

const LEVEL_REFRESH_THRESHOLD_PCT = 0.01;
const LEVEL_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const INITIAL_SNAPSHOT_RETRY_DELAY_MS = 1000;
const SNAPSHOT_PRICE_TOLERANCE_PCT = 0.001;
const SNAPSHOT_PRICE_TOLERANCE_ABSOLUTE = 0.001;
const SNAPSHOT_DISPLAY_COMPACTION_PCT = 0.0075;
const SNAPSHOT_DISPLAY_COMPACTION_ABSOLUTE = 0.01;
const SNAPSHOT_FORWARD_RESISTANCE_RANGE_PCT = 0.5;
const SYMBOL_RECAP_COOLDOWN_MS = 30 * 60 * 1000;
const AI_SIGNAL_COMMENTARY_COOLDOWN_MS = 10 * 60 * 1000;
const RECAP_AFTER_STORY_MIN_GAP_MS = 3 * 60 * 1000;
const CONTINUITY_UPDATE_COOLDOWN_MS = 5 * 60 * 1000;
const CONTINUITY_MAJOR_TRANSITION_COOLDOWN_MS = 12 * 60 * 1000;
const CONTINUITY_EXACT_MESSAGE_COOLDOWN_MS = 20 * 60 * 1000;
const CONTINUITY_AFTER_STORY_MIN_GAP_MS = 3 * 60 * 1000;
const FOLLOW_THROUGH_UPDATE_REPEAT_COOLDOWN_MS = 5 * 60 * 1000;
const FOLLOW_THROUGH_STATE_UPDATE_COOLDOWN_MS = 4 * 60 * 1000;
const OPTIONAL_LIVE_POST_WINDOW_MS = 15 * 60 * 1000;
const NARRATION_BURST_WINDOW_MS = 90 * 1000;
const NARRATION_RECAP_BURST_WINDOW_MS = 75 * 1000;
const DELIVERY_FAILURE_BACKOFF_MS = 2 * 60 * 1000;
const OPTIONAL_POST_SETTLE_DELAY_MS = 250;
const OPTIONAL_POST_CRITICAL_PREEMPT_WINDOW_MS = 1500;
const LEVEL_SEED_TIMEOUT_MS = 45 * 1000;
const QUEUED_ACTIVATION_SEED_GRACE_TIMEOUT_MS = 3 * 60 * 1000;
const ACTIVATION_AUTO_RETRY_DELAY_MS = 90 * 1000;
const ACTIVATION_MAX_AUTO_RETRIES = 1;
const ACTIVATION_STUCK_WARNING_MS = 2 * 60 * 1000;
const ACTIVATION_WATCHDOG_INTERVAL_MS = 15 * 1000;
const MAX_ACTIVITY_ENTRIES = 80;
const LEVEL_TOUCH_SUPERSEDE_DELAY_MS = 1200;
const FAST_LEVEL_CLEAR_CONFIRM_PCT = 0.0025;
const FAST_LEVEL_CLUSTER_MAX_SPAN_PCT = 0.035;
const FOLLOW_THROUGH_MAJOR_MOVE_PCT = 2;
export const DEFAULT_MANUAL_WATCHLIST_HISTORICAL_LOOKBACKS: ManualWatchlistHistoricalLookbacks = {
  daily: 520,
  "4h": 180,
  "5m": 100,
};
const SAME_LEVEL_STORY_WINDOW_MS = 10 * 60 * 1000;
const SAME_LEVEL_PRICE_TOLERANCE_PCT = 0.006;
const SAME_LEVEL_PRICE_TOLERANCE_ABSOLUTE = 0.02;
const MIN_DIRECTIONAL_STATE_UPDATE_PCT = 0.2;

type SymbolRecapState = {
  lastSignature: string | null;
  lastPostedAt: number | null;
  lastAiBody: string | null;
};

type SymbolContinuityState = {
  lastLabel: string | null;
  lastPostedAt: number | null;
  lastMessage: string | null;
  recentMessages?: Record<string, number>;
};

type SymbolFollowThroughStatePost = {
  lastLabel: OpportunityProgressUpdate["progressLabel"] | null;
  lastPostedAt: number | null;
  lastDirectionalReturnPct: number | null;
};

type SymbolFollowThroughPostState = FollowThroughStoryRecord[];

type SymbolDominantLevelStory = {
  level: number;
  eventType: string;
  timestamp: number;
  priority: number;
  label: string | null;
};

type LiveThreadPostKind = LiveThreadRuntimePostKind;

type SymbolLiveThreadPostState = {
  critical: LiveThreadPostRecord[];
  optional: LiveThreadPostRecord[];
};

type SymbolNarrationBurstState = NarrationBurstRecord[];

type StoryCriticalKind = "intelligent_alert" | "follow_through";

type SymbolStoryCriticalState = Array<{
  kind: StoryCriticalKind;
  timestamp: number;
}>;

type SymbolDeliveryPressureState = {
  lastFailureAt: number | null;
  lastFailureMessage: string | null;
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

function formatFastLevelZone(zone: FinalLevelZone | null, side: "support" | "resistance"): string | null {
  if (!zone) {
    return null;
  }

  return `${describeZoneStrength(zone.strengthLabel)} ${side} ${formatSnapshotLevel(zone.representativePrice)}`;
}

function formatFastLevelOnly(zone: FinalLevelZone | null): string | null {
  return zone ? formatSnapshotLevel(zone.representativePrice) : null;
}

function relativeLevelSpan(levels: number[]): number {
  if (levels.length <= 1) {
    return 0;
  }
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const midpoint = (min + max) / 2;
  return midpoint > 0 ? (max - min) / midpoint : 0;
}

function formatFastLevelRange(levels: number[]): string {
  const validLevels = levels.filter((level) => Number.isFinite(level) && level > 0);
  if (validLevels.length === 0) {
    return "unknown";
  }
  const low = Math.min(...validLevels);
  const high = Math.max(...validLevels);
  if (Math.abs(high - low) <= snapshotPriceTolerance(low)) {
    return formatSnapshotLevel(high);
  }
  return `${formatSnapshotLevel(low)}-${formatSnapshotLevel(high)}`;
}

function deriveSnapshotLevelSourceLabel(zone: FinalLevelZone): string {
  if (zone.isExtension) {
    return "extension";
  }

  const sources = new Set(zone.timeframeSources);
  if (sources.has("daily")) {
    return zone.timeframeSources.length > 1 ? "daily confluence" : "daily structure";
  }

  if (sources.has("4h")) {
    return zone.timeframeSources.length > 1 ? "4h confluence" : "4h structure";
  }

  if (sources.has("5m")) {
    return zone.freshness === "fresh" ? "fresh intraday" : "intraday";
  }

  return "price structure";
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
    sourceLabel: deriveSnapshotLevelSourceLabel(zone),
  }));
}

function snapshotCandidateKey(zone: FinalLevelZone): string {
  return zone.id;
}

function buildSnapshotAuditZones(params: {
  zones: FinalLevelZone[];
  displayedZoneIds: Set<string>;
  side: "support" | "resistance";
  bucket: "surfaced" | "extension";
  currentPrice: number;
  tolerance: number;
  maxForwardResistancePrice: number;
}): LevelSnapshotAuditZone[] {
  const sorted = sortSnapshotZones(params.zones, params.side);

  return sorted.map((zone) => {
    const displayed = params.displayedZoneIds.has(snapshotCandidateKey(zone));
    const wrongSide =
      params.side === "support"
        ? zone.representativePrice >= params.currentPrice - params.tolerance
        : zone.representativePrice <= params.currentPrice + params.tolerance;
    const outsideForwardRange =
      params.side === "resistance" &&
      zone.representativePrice > params.maxForwardResistancePrice;

    return {
      id: zone.id,
      side: params.side,
      bucket: params.bucket,
      representativePrice: zone.representativePrice,
      zoneLow: zone.zoneLow,
      zoneHigh: zone.zoneHigh,
      strengthLabel: zone.strengthLabel,
      strengthScore: zone.strengthScore,
      confluenceCount: zone.confluenceCount,
      sourceEvidenceCount: zone.sourceEvidenceCount,
      timeframeBias: zone.timeframeBias,
      timeframeSources: [...zone.timeframeSources],
      sourceTypes: [...zone.sourceTypes],
      sourceLabel: deriveSnapshotLevelSourceLabel(zone),
      freshness: zone.freshness,
      isExtension: zone.isExtension,
      displayed,
      omittedReason: displayed
        ? "displayed"
        : wrongSide
          ? "wrong_side"
          : outsideForwardRange
            ? "outside_forward_range"
            : "compacted",
    };
  });
}

function buildSnapshotAudit(params: {
  currentPrice: number;
  tolerance: number;
  maxForwardResistancePrice: number;
  surfacedSupportZones: FinalLevelZone[];
  surfacedResistanceZones: FinalLevelZone[];
  extensionResistanceZones: FinalLevelZone[];
  displayedSupportZones: FinalLevelZone[];
  displayedResistanceZones: FinalLevelZone[];
}): LevelSnapshotAudit {
  const displayedSupportIds = params.displayedSupportZones.map(snapshotCandidateKey);
  const displayedResistanceIds = params.displayedResistanceZones.map(snapshotCandidateKey);
  const displayedSupportIdSet = new Set(displayedSupportIds);
  const displayedResistanceIdSet = new Set(displayedResistanceIds);
  const supportCandidates = buildSnapshotAuditZones({
    zones: params.surfacedSupportZones,
    displayedZoneIds: displayedSupportIdSet,
    side: "support",
    bucket: "surfaced",
    currentPrice: params.currentPrice,
    tolerance: params.tolerance,
    maxForwardResistancePrice: params.maxForwardResistancePrice,
  });
  const resistanceCandidates = [
    ...buildSnapshotAuditZones({
      zones: params.surfacedResistanceZones,
      displayedZoneIds: displayedResistanceIdSet,
      side: "resistance",
      bucket: "surfaced",
      currentPrice: params.currentPrice,
      tolerance: params.tolerance,
      maxForwardResistancePrice: params.maxForwardResistancePrice,
    }),
    ...buildSnapshotAuditZones({
      zones: params.extensionResistanceZones,
      displayedZoneIds: displayedResistanceIdSet,
      side: "resistance",
      bucket: "extension",
      currentPrice: params.currentPrice,
      tolerance: params.tolerance,
      maxForwardResistancePrice: params.maxForwardResistancePrice,
    }),
  ];

  return {
    referencePrice: params.currentPrice,
    displayTolerance: params.tolerance,
    forwardResistanceLimit: params.maxForwardResistancePrice,
    displayedSupportIds,
    displayedResistanceIds,
    supportCandidates,
    resistanceCandidates,
    omittedSupportCount: supportCandidates.filter((candidate) => !candidate.displayed).length,
    omittedResistanceCount: resistanceCandidates.filter((candidate) => !candidate.displayed).length,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(onTimeout());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

class LevelSeedTimeoutError extends Error {
  constructor(symbol: string, timeoutMs: number) {
    super(`Level seeding timed out for ${symbol} after ${timeoutMs}ms.`);
    this.name = "LevelSeedTimeoutError";
  }
}

class ActivationCancelledError extends Error {
  constructor(symbol: string) {
    super(`Activation for ${symbol} was cancelled.`);
    this.name = "ActivationCancelledError";
  }
}

export class ManualWatchlistRuntimeManager {
  private readonly levelEngine: LevelEngine;
  private readonly watchlistStore: WatchlistStore;
  private readonly watchlistStatePersistence: WatchlistStatePersistence;
  private readonly alertIntelligenceEngine = new AlertIntelligenceEngine();
  private readonly activeSnapshotState = new Map<string, ActiveLevelSnapshotState>();
  private readonly pendingActivations = new Map<string, { promise: Promise<void>; epoch: number }>();
  private readonly activationEpochs = new Map<string, number>();
  private readonly extensionRefreshInFlight = new Set<string>();
  private readonly recapState = new Map<string, SymbolRecapState>();
  private readonly continuityState = new Map<string, SymbolContinuityState>();
  private readonly followThroughStatePosts = new Map<string, SymbolFollowThroughStatePost>();
  private readonly followThroughPostState = new Map<string, SymbolFollowThroughPostState>();
  private readonly intelligentAlertPostState = new Map<string, IntelligentAlertStoryRecord[]>();
  private readonly aiSignalStoryState = new Map<string, AiSignalStoryRecord[]>();
  private readonly dominantLevelStories = new Map<string, SymbolDominantLevelStory[]>();
  private readonly liveThreadPostState = new Map<string, SymbolLiveThreadPostState>();
  private readonly narrationBurstState = new Map<string, SymbolNarrationBurstState>();
  private readonly storyCriticalState = new Map<string, SymbolStoryCriticalState>();
  private readonly deliveryPressureState = new Map<string, SymbolDeliveryPressureState>();
  private readonly optionalPostSettleDelayMs: number;
  private readonly levelSeedTimeoutMs: number;
  private readonly queuedActivationSeedGraceTimeoutMs: number;
  private readonly activationAutoRetryDelayMs: number;
  private readonly activationMaxAutoRetries: number;
  private readonly activationStuckWarningMs: number;
  private readonly levelTouchSupersedeDelayMs: number;
  private readonly historicalLookbackBars: ManualWatchlistHistoricalLookbacks;
  private readonly postingPolicySettings: LiveThreadPostingPolicySettings;
  private readonly recentActivity: ManualWatchlistActivityEntry[] = [];
  private monitoringRestartQueue: Promise<void> = Promise.resolve();
  private activitySequence = 0;
  private readonly stuckActivationWarnings = new Set<string>();
  private activationWatchdogTimer: NodeJS.Timeout | null = null;
  private readonly pendingLevelTouchAlerts = new Map<string, NodeJS.Timeout>();
  private lastPriceUpdateAt: number | null = null;
  private lastPriceUpdateSymbol: string | null = null;
  private lastThreadPostAt: number | null = null;
  private lastThreadPostSymbol: string | null = null;
  private lastThreadPostKind: LiveThreadPostKind | null = null;
  private lastDeliveryFailureAt: number | null = null;
  private lastDeliveryFailureSymbol: string | null = null;
  private lastDeliveryFailureMessage: string | null = null;
  private aiCommentaryGeneratedCount = 0;
  private aiCommentaryFailedCount = 0;
  private lastAiCommentaryGeneratedAt: number | null = null;
  private lastAiCommentaryGeneratedSymbol: string | null = null;
  private lastAiCommentaryGeneratedModel: string | null = null;
  private lastAiCommentaryFailedAt: number | null = null;
  private lastAiCommentaryFailedSymbol: string | null = null;
  private lastAiCommentaryFailureMessage: string | null = null;
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
    this.postingPolicySettings = getLiveThreadPostingPolicySettings(
      options.postingProfile ?? resolveLiveThreadPostingProfile(process.env.WATCHLIST_POSTING_PROFILE),
    );
    this.optionalPostSettleDelayMs = Math.max(0, options.optionalPostSettleDelayMs ?? 0);
    this.levelSeedTimeoutMs = Math.max(0, options.levelSeedTimeoutMs ?? LEVEL_SEED_TIMEOUT_MS);
    this.queuedActivationSeedGraceTimeoutMs = Math.max(
      0,
      options.queuedActivationSeedGraceTimeoutMs ?? QUEUED_ACTIVATION_SEED_GRACE_TIMEOUT_MS,
    );
    this.activationAutoRetryDelayMs = Math.max(
      0,
      options.activationAutoRetryDelayMs ?? ACTIVATION_AUTO_RETRY_DELAY_MS,
    );
    this.activationMaxAutoRetries = Math.max(
      0,
      Math.floor(options.activationMaxAutoRetries ?? ACTIVATION_MAX_AUTO_RETRIES),
    );
    this.activationStuckWarningMs = Math.max(
      0,
      options.activationStuckWarningMs ?? ACTIVATION_STUCK_WARNING_MS,
    );
    this.levelTouchSupersedeDelayMs = Math.max(
      0,
      options.levelTouchSupersedeDelayMs ?? LEVEL_TOUCH_SUPERSEDE_DELAY_MS,
    );
    this.historicalLookbackBars = {
      daily: Math.max(
        1,
        Math.floor(
          options.historicalLookbackBars?.daily ??
            DEFAULT_MANUAL_WATCHLIST_HISTORICAL_LOOKBACKS.daily,
        ),
      ),
      "4h": Math.max(
        1,
        Math.floor(
          options.historicalLookbackBars?.["4h"] ??
            DEFAULT_MANUAL_WATCHLIST_HISTORICAL_LOOKBACKS["4h"],
        ),
      ),
      "5m": Math.max(
        1,
        Math.floor(
          options.historicalLookbackBars?.["5m"] ??
            DEFAULT_MANUAL_WATCHLIST_HISTORICAL_LOOKBACKS["5m"],
        ),
      ),
    };
  }

  getHistoricalLookbackBars(): ManualWatchlistHistoricalLookbacks {
    return { ...this.historicalLookbackBars };
  }

  private formatLifecycleMessage(event: ManualWatchlistLifecycleEvent): string {
    const symbolPrefix = event.symbol ? `${event.symbol}: ` : "";
    const error = typeof event.details?.error === "string" ? event.details.error : null;
    const source = typeof event.details?.source === "string" ? event.details.source : null;

    switch (event.event) {
      case "runtime_started":
        return "Runtime started";
      case "monitor_restart_completed":
        return "Monitoring restarted";
      case "thread_ready":
        return `${symbolPrefix}Discord thread ready${source ? ` (${source})` : ""}`;
      case "activation_queued":
        return `${symbolPrefix}activation queued`;
      case "activation_started":
        return `${symbolPrefix}activation started`;
      case "activation_stuck":
        return `${symbolPrefix}activation is still waiting on level seeding`;
      case "levels_seeded":
        return `${symbolPrefix}levels seeded`;
      case "activation_completed":
        return `${symbolPrefix}activation completed`;
      case "activation_retry_scheduled":
        return `${symbolPrefix}auto retry scheduled`;
      case "activation_marked_failed":
      case "activation_failed":
        return `${symbolPrefix}activation failed${error ? `: ${error}` : ""}`;
      case "restore_started":
        return `${symbolPrefix}startup restore started`;
      case "restore_completed":
        return `${symbolPrefix}startup restore completed`;
      case "restore_skipped":
        return `${symbolPrefix}startup restore skipped${error ? `: ${error}` : ""}`;
      case "stock_context_posted":
        return `${symbolPrefix}stock context posted`;
      case "stock_context_post_failed":
        return `${symbolPrefix}stock context post failed${error ? `: ${error}` : ""}`;
      case "snapshot_posted":
        return `${symbolPrefix}level snapshot posted`;
      case "extension_posted":
        return `${symbolPrefix}extension levels posted`;
      case "alert_posted":
        return `${symbolPrefix}alert posted`;
      case "alert_suppressed":
        return `${symbolPrefix}alert suppressed`;
      case "alert_post_failed":
        return `${symbolPrefix}alert post failed${error ? `: ${error}` : ""}`;
      case "continuity_posted":
        return `${symbolPrefix}continuity posted`;
      case "continuity_post_failed":
        return `${symbolPrefix}continuity post failed${error ? `: ${error}` : ""}`;
      case "follow_through_posted":
        return `${symbolPrefix}follow-through posted`;
      case "follow_through_post_failed":
        return `${symbolPrefix}follow-through post failed${error ? `: ${error}` : ""}`;
      case "follow_through_state_posted":
        return `${symbolPrefix}follow-through state posted`;
      case "follow_through_state_post_failed":
        return `${symbolPrefix}follow-through state post failed${error ? `: ${error}` : ""}`;
      case "recap_posted":
        return `${symbolPrefix}recap posted`;
      case "recap_post_failed":
        return `${symbolPrefix}recap post failed${error ? `: ${error}` : ""}`;
      case "ai_commentary_generated":
        return `${symbolPrefix}AI commentary generated`;
      case "ai_commentary_failed":
        return `${symbolPrefix}AI commentary failed${error ? `: ${error}` : ""}`;
      case "deactivated":
        return `${symbolPrefix}deactivated`;
      case "restore_failed":
        return `${symbolPrefix}restore failed${error ? `: ${error}` : ""}`;
      default:
        return `${symbolPrefix}${String(event.event).replace(/_/g, " ")}`;
    }
  }

  private recordActivity(event: ManualWatchlistLifecycleEvent): void {
    this.recentActivity.unshift({
      ...event,
      id: ++this.activitySequence,
      message: this.formatLifecycleMessage(event),
    });

    if (this.recentActivity.length > MAX_ACTIVITY_ENTRIES) {
      this.recentActivity.length = MAX_ACTIVITY_ENTRIES;
    }
  }

  private emitLifecycle(
    event: ManualWatchlistLifecycleEventName,
    payload: {
      symbol?: string;
      threadId?: string | null;
      details?: Record<string, string | number | boolean | null>;
    } = {},
  ): void {
    const lifecycleEvent: ManualWatchlistLifecycleEvent = {
      type: "manual_watchlist_lifecycle",
      event,
      timestamp: Date.now(),
      symbol: payload.symbol,
      threadId: payload.threadId,
      details: payload.details,
    };
    this.recordActivity(lifecycleEvent);
    this.options.lifecycleListener?.(lifecycleEvent);
  }

  private persistWatchlist(): void {
    this.watchlistStatePersistence.save(this.watchlistStore.getEntries());
  }

  private setEntryOperation(symbol: string, operationStatus: string | null): void {
    this.watchlistStore.patchEntry(symbol, {
      operationStatus: operationStatus ?? undefined,
    });
  }

  private isEntryActive(symbol: string): boolean {
    const entry = this.watchlistStore.getEntry(symbol);
    return Boolean(entry?.active && entry.lifecycle !== "inactive");
  }

  private nextActivationEpoch(symbol: string): number {
    const normalizedSymbol = normalizeSymbol(symbol);
    const nextEpoch = (this.activationEpochs.get(normalizedSymbol) ?? 0) + 1;
    this.activationEpochs.set(normalizedSymbol, nextEpoch);
    return nextEpoch;
  }

  private isActivationCurrent(symbol: string, epoch: number | undefined): boolean {
    return epoch === undefined || this.activationEpochs.get(normalizeSymbol(symbol)) === epoch;
  }

  private assertActivationCurrent(symbol: string, epoch: number | undefined): void {
    if (epoch === undefined) {
      return;
    }

    if (!this.isActivationCurrent(symbol, epoch) || !this.isEntryActive(symbol)) {
      throw new ActivationCancelledError(symbol);
    }
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
    const extensionResistanceCandidates = levelsOutput?.extensionLevels.resistance ?? [];
    const extensionResistanceZones = extensionResistanceCandidates.filter(
      (zone) =>
        zone.representativePrice > normalizedPrice + tolerance &&
        zone.representativePrice <= maxForwardResistancePrice,
    );
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
      audit: buildSnapshotAudit({
        currentPrice: normalizedPrice,
        tolerance,
        maxForwardResistancePrice,
        surfacedSupportZones,
        surfacedResistanceZones,
        extensionResistanceZones: extensionResistanceCandidates,
        displayedSupportZones: supportZones,
        displayedResistanceZones: resistanceZones,
      }),
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
    if (!this.isEntryActive(symbol)) {
      return;
    }

    this.setEntryOperation(symbol, "posting level snapshot");
    const payload = this.buildLevelSnapshotPayload(symbol, timestamp, referencePriceOverride);
    const snapshotKey = JSON.stringify({
      symbol: payload.symbol,
      supportZones: payload.supportZones,
      resistanceZones: payload.resistanceZones,
    });
    const existingState = this.activeSnapshotState.get(symbol);

    if (existingState?.lastSnapshot === snapshotKey) {
      if (!this.isEntryActive(symbol)) {
        return;
      }
      this.activeSnapshotState.set(symbol, {
        ...existingState,
        highestResistance: payload.resistanceZones.at(-1)?.representativePrice ?? null,
        lowestSupport: payload.supportZones.at(-1)?.representativePrice ?? null,
        referencePrice: payload.currentPrice,
      });
      this.watchlistStore.patchEntry(symbol, {
        lifecycle: "active",
        lastLevelPostAt: timestamp,
        refreshPending: false,
        lastError: null,
        operationStatus: "monitoring live price",
      });
      return;
    }

    await this.options.discordAlertRouter.routeLevelSnapshot(threadId, payload);
    if (!this.isEntryActive(symbol)) {
      return;
    }
    this.recordLiveThreadPost({
      symbol,
      timestamp,
      kind: "snapshot",
      critical: true,
      eventType: null,
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
      highestResistance: payload.resistanceZones.at(-1)?.representativePrice ?? null,
      lowestSupport: payload.supportZones.at(-1)?.representativePrice ?? null,
      referencePrice: payload.currentPrice,
      lastRefreshTriggerResistance: null,
      lastRefreshTriggerSupport: null,
      lastRefreshTimestamp: timestamp,
      lastExtensionPostKey: null,
      lastExtensionPostTimestamp: null,
      extensionPostInFlightKey: null,
    });
    this.watchlistStore.patchEntry(symbol, {
      lifecycle: "active",
      lastLevelPostAt: timestamp,
      refreshPending: false,
      operationStatus: "monitoring live price",
    });
  }

  private async maybePostStockContext(
    symbol: string,
    threadId: string,
    timestamp: number,
  ): Promise<void> {
    const stockContextProvider = this.options.stockContextProvider;
    if (!stockContextProvider) {
      return;
    }

    try {
      const preview = await stockContextProvider.getThreadPreview(symbol);
      const payload = buildFinnhubThreadPreviewPayload(preview);
      await this.options.discordAlertRouter.routeAlert(threadId, payload);
      this.recordLiveThreadPost({
        symbol,
        timestamp,
        kind: "intelligent_alert",
        critical: true,
        eventType: null,
      });
      this.clearDeliveryFailure(symbol, timestamp);
      this.emitLifecycle("stock_context_posted", {
        symbol,
        threadId,
        details: {
          exchange: preview.profile.exchange?.trim() || null,
          industry: preview.profile.finnhubIndustry?.trim() || null,
          marketCap: preview.profile.marketCapitalization ?? null,
          yahooMarketCap: preview.yahoo?.summary?.marketCap ?? preview.yahoo?.quote?.marketCap ?? null,
          yahooFloatShares: preview.yahoo?.summary?.floatShares ?? null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitLifecycle("stock_context_post_failed", {
        symbol,
        threadId,
        details: {
          error: message,
        },
      });
      console.error(`[ManualWatchlistRuntimeManager] Failed to post stock context for ${symbol}: ${message}`);
    }
  }

  private async postLevelExtension(
    symbol: string,
    threadId: string,
    side: LevelExtensionSide,
    timestamp: number,
  ): Promise<"posted" | "duplicate" | "unavailable"> {
    if (!this.isEntryActive(symbol)) {
      return "unavailable";
    }

    const payload = this.buildLevelExtensionPayload(symbol, side, timestamp);
    if (!payload) {
      return "unavailable";
    }

    const extensionKey = JSON.stringify({
      symbol: payload.symbol,
      side: payload.side,
      levels: payload.levels,
    });
    const existingState = this.activeSnapshotState.get(symbol);
    if (
      existingState?.extensionPostInFlightKey === extensionKey ||
      existingState?.lastExtensionPostKey === extensionKey
    ) {
      return "duplicate";
    }

    this.activeSnapshotState.set(symbol, {
      lastSnapshot: existingState?.lastSnapshot ?? "",
      highestResistance: existingState?.highestResistance ?? null,
      lowestSupport: existingState?.lowestSupport ?? null,
      referencePrice: existingState?.referencePrice ?? null,
      lastRefreshTriggerResistance: existingState?.lastRefreshTriggerResistance ?? null,
      lastRefreshTriggerSupport: existingState?.lastRefreshTriggerSupport ?? null,
      lastRefreshTimestamp: existingState?.lastRefreshTimestamp ?? null,
      lastExtensionPostKey: existingState?.lastExtensionPostKey ?? null,
      lastExtensionPostTimestamp: existingState?.lastExtensionPostTimestamp ?? null,
      extensionPostInFlightKey: extensionKey,
      lastClearedResistance: existingState?.lastClearedResistance ?? null,
      lastClearedSupport: existingState?.lastClearedSupport ?? null,
      lastLevelClearTimestamp: existingState?.lastLevelClearTimestamp ?? null,
    });

    try {
      await this.options.discordAlertRouter.routeLevelExtension(threadId, payload);
      if (!this.isEntryActive(symbol)) {
        return "unavailable";
      }
      this.recordLiveThreadPost({
        symbol,
        timestamp,
        kind: "extension",
        critical: true,
        eventType: null,
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
        extensionPostInFlightKey: null,
        lastClearedResistance: existingState?.lastClearedResistance ?? null,
        lastClearedSupport: existingState?.lastClearedSupport ?? null,
        lastLevelClearTimestamp: existingState?.lastLevelClearTimestamp ?? null,
      });
      this.watchlistStore.patchEntry(symbol, {
        lifecycle: "active",
        lastExtensionPostAt: timestamp,
        operationStatus: "monitoring live price",
      });
      return "posted";
    } catch (error) {
      this.activeSnapshotState.set(symbol, {
        lastSnapshot: existingState?.lastSnapshot ?? "",
        highestResistance: existingState?.highestResistance ?? null,
        lowestSupport: existingState?.lowestSupport ?? null,
        referencePrice: existingState?.referencePrice ?? null,
        lastRefreshTriggerResistance: existingState?.lastRefreshTriggerResistance ?? null,
        lastRefreshTriggerSupport: existingState?.lastRefreshTriggerSupport ?? null,
        lastRefreshTimestamp: existingState?.lastRefreshTimestamp ?? null,
        lastExtensionPostKey: existingState?.lastExtensionPostKey ?? null,
        lastExtensionPostTimestamp: existingState?.lastExtensionPostTimestamp ?? null,
        extensionPostInFlightKey: null,
        lastClearedResistance: existingState?.lastClearedResistance ?? null,
        lastClearedSupport: existingState?.lastClearedSupport ?? null,
        lastLevelClearTimestamp: existingState?.lastLevelClearTimestamp ?? null,
      });
      throw error;
    }
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
      operationStatus: "refreshing stale levels",
    });
    try {
      await this.seedLevelsForSymbol(symbol, { force: true });
    } catch (error) {
      const existingLevels = this.options.levelStore.getLevels(symbol);
      if (existingLevels) {
        this.watchlistStore.patchEntry(symbol, {
          lifecycle: "active",
          refreshPending: false,
          operationStatus: "monitoring live price",
        });
      }
      throw error;
    }
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

  private hasRecentCriticalPost(symbol: string, timestamp: number, eventType: string): boolean {
    return this.pruneLiveThreadPosts(symbol, timestamp).critical.some(
      (entry) =>
        entry.eventType === eventType &&
        Math.abs(timestamp - entry.timestamp) <= OPTIONAL_POST_CRITICAL_PREEMPT_WINDOW_MS,
    );
  }

  private findNextResistanceAbove(symbol: string, clearedLevel: number): FinalLevelZone | null {
    return this.options.levelStore
      .getResistanceZones(symbol)
      .filter((zone) => zone.representativePrice > clearedLevel + snapshotPriceTolerance(clearedLevel))
      .sort((left, right) => left.representativePrice - right.representativePrice)[0] ?? null;
  }

  private findNextSupportBelow(symbol: string, clearedLevel: number): FinalLevelZone | null {
    return this.options.levelStore
      .getSupportZones(symbol)
      .filter((zone) => zone.representativePrice < clearedLevel - snapshotPriceTolerance(clearedLevel))
      .sort((left, right) => right.representativePrice - left.representativePrice)[0] ?? null;
  }

  private findTightLevelCluster(zones: FinalLevelZone[]): FinalLevelZone[] {
    const cluster: FinalLevelZone[] = [];
    for (const zone of zones) {
      const levels = [...cluster, zone].map((candidate) => candidate.representativePrice);
      if (cluster.length > 0 && relativeLevelSpan(levels) > FAST_LEVEL_CLUSTER_MAX_SPAN_PCT) {
        break;
      }
      cluster.push(zone);
    }
    return cluster;
  }

  private findFastClearedResistanceCluster(
    symbol: string,
    snapshotState: ActiveLevelSnapshotState,
    lastPrice: number,
  ): FinalLevelZone[] {
    const zones = this.options.levelStore
      .getResistanceZones(symbol)
      .sort((left, right) => left.representativePrice - right.representativePrice);
    const lastCleared = snapshotState.lastClearedResistance ?? null;
    const candidates = zones.filter((zone) => {
      const level = zone.representativePrice;
      const clearLine = Math.max(zone.zoneHigh, zone.representativePrice);
      if (
        lastCleared !== null &&
        level <= lastCleared + snapshotPriceTolerance(lastCleared)
      ) {
        return false;
      }
      return lastPrice >= clearLine * (1 + FAST_LEVEL_CLEAR_CONFIRM_PCT);
    });

    return this.findTightLevelCluster(candidates);
  }

  private findFastLostSupportCluster(
    symbol: string,
    snapshotState: ActiveLevelSnapshotState,
    lastPrice: number,
  ): FinalLevelZone[] {
    const zones = this.options.levelStore
      .getSupportZones(symbol)
      .sort((left, right) => right.representativePrice - left.representativePrice);
    const lastCleared = snapshotState.lastClearedSupport ?? null;
    const candidates = zones.filter((zone) => {
      const level = zone.representativePrice;
      const clearLine = Math.min(zone.zoneLow, zone.representativePrice);
      if (
        lastCleared !== null &&
        level >= lastCleared - snapshotPriceTolerance(lastCleared)
      ) {
        return false;
      }
      return lastPrice <= clearLine * (1 - FAST_LEVEL_CLEAR_CONFIRM_PCT);
    });

    return this.findTightLevelCluster(candidates);
  }

  private async maybePostFastLevelClear(update: LivePriceUpdate): Promise<void> {
    const symbol = normalizeSymbol(update.symbol);
    const entry = this.watchlistStore.getEntry(symbol);
    const snapshotState = this.activeSnapshotState.get(symbol);

    if (!entry?.active || !entry.discordThreadId || !snapshotState) {
      return;
    }

    const resistanceCluster = this.findFastClearedResistanceCluster(symbol, snapshotState, update.lastPrice);
    const resistanceZone = resistanceCluster[resistanceCluster.length - 1] ?? null;
    const resistanceLevels = resistanceCluster.map((zone) => zone.representativePrice);
    const isResistanceCluster = resistanceLevels.length > 1;
    const resistance = resistanceZone?.representativePrice ?? null;
    const resistanceBreakLine =
      resistanceCluster.length > 0
        ? Math.max(...resistanceCluster.map((zone) => Math.max(zone.zoneHigh, zone.representativePrice)))
        : null;
    const lastClearedResistance = snapshotState.lastClearedResistance ?? null;
    const suppressRepeatedResistance =
      resistance !== null &&
      lastClearedResistance !== null &&
      Math.abs(resistance - lastClearedResistance) <= snapshotPriceTolerance(resistance);
    if (
      resistance !== null &&
      !suppressRepeatedResistance &&
      (
        !this.hasRecentCriticalPost(symbol, update.timestamp, "breakout") ||
        (
          lastClearedResistance !== null &&
          resistance > lastClearedResistance + snapshotPriceTolerance(lastClearedResistance)
        )
      )
    ) {
      const nextResistance = this.findNextResistanceAbove(symbol, resistance);
      const pullbackSupport = this.findNextSupportBelow(symbol, resistance);
      const nextResistanceText = formatFastLevelZone(nextResistance, "resistance");
      const pullbackSupportLevel =
        pullbackSupport ? formatSnapshotLevel(pullbackSupport.representativePrice) : null;
      const resistanceLine = formatSnapshotLevel(resistanceBreakLine ?? resistance);
      const resistanceRange = formatFastLevelRange(resistanceLevels);
      const title = isResistanceCluster
        ? `${symbol} resistance cluster crossed`
        : `${symbol} resistance crossed`;
      const body = isResistanceCluster ? [
        `price pushed through nearby resistance cluster ${resistanceRange}${nextResistanceText ? `; nearby resistance above is ${nextResistanceText}` : ""}`,
        "",
        "Breakout attempt is being tested.",
        "",
        "What it means:",
        `- ${resistanceRange} was crossed in the same move and now needs to hold as a zone`,
        nextResistanceText
          ? `- nearby resistance above is ${nextResistanceText}`
          : "- no higher resistance is currently in the surfaced ladder",
        "",
        "What to watch:",
        `- acceptance above ${resistanceLine} keeps the breakout attempt alive`,
        `- falling back into ${resistanceRange} means the cluster is still acting like resistance`,
        pullbackSupportLevel
          ? `- if price cannot hold ${resistanceRange}, risk opens back toward ${pullbackSupportLevel}`
          : `- if price cannot hold ${resistanceLine}, the breakout needs to rebuild`,
      ].join("\n") : [
        `price pushed above ${resistanceLine}${nextResistanceText ? `; nearby resistance above is ${nextResistanceText}` : ""}`,
        "",
        "Breakout attempt is being tested.",
        "",
        "What it means:",
        `- ${resistanceLine} is being tested from above, but it still needs to hold`,
        nextResistanceText
          ? `- nearby resistance above is ${nextResistanceText}`
          : "- no higher resistance is currently in the surfaced ladder",
        "",
        "What to watch:",
        `- acceptance above ${resistanceLine} keeps the breakout attempt alive`,
        `- falling back below ${resistanceLine} means the level is still acting like resistance`,
        pullbackSupportLevel
          ? `- if price cannot hold ${resistanceLine}, risk opens back toward ${pullbackSupportLevel}`
          : `- if price cannot hold ${resistanceLine}, the breakout needs to rebuild`,
      ].join("\n");
      this.activeSnapshotState.set(symbol, {
        ...snapshotState,
        lastClearedResistance: resistance,
        lastLevelClearTimestamp: update.timestamp,
      });
      await this.options.discordAlertRouter.routeAlert(entry.discordThreadId, {
        title,
        body,
        symbol,
        timestamp: update.timestamp,
        metadata: {
          messageKind: "level_clear_update",
          eventType: "breakout",
          targetSide: "resistance",
          targetPrice: resistance,
          crossedLevels: isResistanceCluster ? resistanceLevels : undefined,
          clusterLow: isResistanceCluster ? Math.min(...resistanceLevels) : undefined,
          clusterHigh: isResistanceCluster ? Math.max(...resistanceLevels) : undefined,
          clusteredLevelClear: isResistanceCluster ? true : undefined,
        },
      });
      this.recordLiveThreadPost({
        symbol,
        timestamp: update.timestamp,
        kind: "intelligent_alert",
        critical: true,
        eventType: "breakout",
      });
      this.recordDominantLevelStory({
        symbol,
        level: resistance,
        eventType: "breakout",
        timestamp: update.timestamp,
        label: "cleared",
      });
      return;
    }

    const supportCluster = this.findFastLostSupportCluster(symbol, snapshotState, update.lastPrice);
    const supportZone = supportCluster[supportCluster.length - 1] ?? null;
    const supportLevels = supportCluster.map((zone) => zone.representativePrice);
    const isSupportCluster = supportLevels.length > 1;
    const support = supportZone?.representativePrice ?? null;
    const lastClearedSupport = snapshotState.lastClearedSupport ?? null;
    const suppressRepeatedSupport =
      support !== null &&
      lastClearedSupport !== null &&
      Math.abs(support - lastClearedSupport) <= snapshotPriceTolerance(support);
    if (
      support !== null &&
      !suppressRepeatedSupport &&
      (
        !this.hasRecentCriticalPost(symbol, update.timestamp, "breakdown") ||
        (
          lastClearedSupport !== null &&
          support < lastClearedSupport - snapshotPriceTolerance(lastClearedSupport)
        )
      )
    ) {
      const nextSupport = this.findNextSupportBelow(symbol, support);
      const nextSupportText = formatFastLevelZone(nextSupport, "support");
      const nextSupportLevel = formatFastLevelOnly(nextSupport);
      const supportRange = formatFastLevelRange(supportLevels);
      const supportRepairLine = formatSnapshotLevel(Math.max(...supportLevels));
      const title = isSupportCluster
        ? `${symbol} support cluster crossed lower`
        : `${symbol} support crossed lower`;
      const body = isSupportCluster ? [
        `price slipped through nearby support cluster ${supportRange}${nextSupportText ? `; nearby support below is ${nextSupportText}` : ""}`,
        "",
        "Support loss is being tested.",
        "",
        "What it means:",
        `- ${supportRange} was crossed in the same move and can still be reclaimed as a zone`,
        nextSupportText
          ? `- nearby support below is ${nextSupportText}`
          : "- no lower support is currently in the surfaced ladder",
        "",
        "What to watch:",
        `- reclaiming ${supportRepairLine} is needed to repair the zone`,
        nextSupportText
          ? `- nearby support reaction area: ${nextSupportText}; buyers need stabilization there or a reclaim of ${supportRepairLine}`
          : "- buyers need to stabilize before the drop looks repaired",
        nextSupportLevel
          ? `- below ${supportRange}, risk stays open toward ${nextSupportLevel}`
          : `- below ${supportRange}, risk stays elevated until a new support forms`,
      ].join("\n") : [
        `price slipped below ${formatSnapshotLevel(support)}${nextSupportText ? `; nearby support below is ${nextSupportText}` : ""}`,
        "",
        "Support loss is being tested.",
        "",
        "What it means:",
        `- ${formatSnapshotLevel(support)} is being tested from below, but it can still be reclaimed`,
        nextSupportText
          ? `- nearby support below is ${nextSupportText}`
          : "- no lower support is currently in the surfaced ladder",
        "",
        "What to watch:",
        `- reclaiming ${formatSnapshotLevel(support)} is needed to repair the level`,
        nextSupportText
          ? `- nearby support reaction area: ${nextSupportText}; buyers need stabilization there or a reclaim of ${formatSnapshotLevel(support)}`
          : "- buyers need to stabilize before the drop looks repaired",
        nextSupportLevel
          ? `- below ${formatSnapshotLevel(support)}, risk stays open toward ${nextSupportLevel}`
          : `- below ${formatSnapshotLevel(support)}, risk stays elevated until a new support forms`,
      ].join("\n");
      this.activeSnapshotState.set(symbol, {
        ...snapshotState,
        lastClearedSupport: support,
        lastLevelClearTimestamp: update.timestamp,
      });
      await this.options.discordAlertRouter.routeAlert(entry.discordThreadId, {
        title,
        body,
        symbol,
        timestamp: update.timestamp,
        metadata: {
          messageKind: "level_clear_update",
          eventType: "breakdown",
          targetSide: "support",
          targetPrice: support,
          crossedLevels: isSupportCluster ? supportLevels : undefined,
          clusterLow: isSupportCluster ? Math.min(...supportLevels) : undefined,
          clusterHigh: isSupportCluster ? Math.max(...supportLevels) : undefined,
          clusteredLevelClear: isSupportCluster ? true : undefined,
        },
      });
      this.recordLiveThreadPost({
        symbol,
        timestamp: update.timestamp,
        kind: "intelligent_alert",
        critical: true,
        eventType: "breakdown",
      });
      this.recordDominantLevelStory({
        symbol,
        level: support,
        eventType: "breakdown",
        timestamp: update.timestamp,
        label: "cleared",
      });
    }
  }

  private async maybeRefreshLevelSnapshot(update: LivePriceUpdate): Promise<void> {
    const symbol = normalizeSymbol(update.symbol);
    if (this.extensionRefreshInFlight.has(symbol)) {
      return;
    }

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

    this.extensionRefreshInFlight.add(symbol);
    try {
      this.watchlistStore.patchEntry(symbol, {
        lifecycle: "extension_pending",
        operationStatus: `checking next ${side} levels`,
      });

      let extensionResult = await this.postLevelExtension(
        symbol,
        entry.discordThreadId,
        side,
        update.timestamp,
      );

      if (extensionResult === "unavailable" && !this.options.levelStore.getLevels(symbol)) {
        await this.seedLevelsForSymbol(symbol);
        await this.postLevelSnapshot(symbol, entry.discordThreadId, update.timestamp, update.lastPrice);
        extensionResult = await this.postLevelExtension(
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
        extensionPostInFlightKey:
          refreshedState?.extensionPostInFlightKey ?? snapshotState.extensionPostInFlightKey,
        lastClearedResistance: refreshedState?.lastClearedResistance ?? snapshotState.lastClearedResistance ?? null,
        lastClearedSupport: refreshedState?.lastClearedSupport ?? snapshotState.lastClearedSupport ?? null,
        lastLevelClearTimestamp:
          refreshedState?.lastLevelClearTimestamp ?? snapshotState.lastLevelClearTimestamp ?? null,
      });

      if (extensionResult !== "posted") {
        this.watchlistStore.patchEntry(symbol, {
          lifecycle: "active",
          operationStatus: "monitoring live price",
        });
      }
    } finally {
      this.extensionRefreshInFlight.delete(symbol);
    }
  }

  private beginSeedLevelsForSymbol(symbol: string): Promise<void> {
    return (async (): Promise<void> => {
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
          daily: { symbol, timeframe: "daily", lookbackBars: this.historicalLookbackBars.daily },
          "4h": { symbol, timeframe: "4h", lookbackBars: this.historicalLookbackBars["4h"] },
          "5m": { symbol, timeframe: "5m", lookbackBars: this.historicalLookbackBars["5m"] },
        },
      });

      this.options.levelStore.setLevels(output);
      this.emitLifecycle("levels_seeded", {
        symbol,
        details: {
          generatedAt: output.generatedAt,
        },
      });
    })();
  }

  private async seedLevelsForSymbol(
    symbol: string,
    options: { force?: boolean; graceOnTimeout?: boolean } = {},
  ): Promise<void> {
    if (!options.force && this.options.levelStore.getLevels(symbol)) {
      this.setEntryOperation(symbol, "levels ready");
      return;
    }

    this.setEntryOperation(symbol, "loading candles and building levels");
    const seedOperation = this.beginSeedLevelsForSymbol(symbol);

    if (this.levelSeedTimeoutMs <= 0) {
      await seedOperation;
      this.setEntryOperation(symbol, "levels ready");
      return;
    }

    try {
      await withTimeout(
        seedOperation,
        this.levelSeedTimeoutMs,
        () => new LevelSeedTimeoutError(symbol, this.levelSeedTimeoutMs),
      );
    } catch (error) {
      if (
        options.graceOnTimeout &&
        error instanceof LevelSeedTimeoutError &&
        this.queuedActivationSeedGraceTimeoutMs > 0
      ) {
        await withTimeout(
          seedOperation,
          this.queuedActivationSeedGraceTimeoutMs,
          () =>
            new LevelSeedTimeoutError(
              symbol,
              this.levelSeedTimeoutMs + this.queuedActivationSeedGraceTimeoutMs,
            ),
        );
      } else {
        throw error;
      }
    }
    this.setEntryOperation(symbol, "levels ready");
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

  private hasRecentLiveThreadPost(params: {
    symbol: string;
    timestamp: number;
    kinds?: LiveThreadPostKind[];
    critical?: boolean;
    withinMs: number;
  }): boolean {
    const state = this.pruneLiveThreadPosts(params.symbol, params.timestamp);
    const posts = params.critical === true
      ? state.critical
      : params.critical === false
        ? state.optional
        : [...state.critical, ...state.optional];
    return posts.some((entry) => {
      if (params.kinds && !params.kinds.includes(entry.kind)) {
        return false;
      }

      return params.timestamp - entry.timestamp >= 0 && params.timestamp - entry.timestamp < params.withinMs;
    });
  }

  private recordLiveThreadPost(params: {
    symbol: string;
    timestamp: number;
    kind: LiveThreadPostKind;
    critical: boolean;
    eventType?: string | null;
  }): void {
    const state = this.pruneLiveThreadPosts(params.symbol, params.timestamp);
    const target = params.critical ? state.critical : state.optional;
    target.push({
      kind: params.kind,
      timestamp: params.timestamp,
      eventType: params.eventType ?? null,
    });
    this.lastThreadPostAt = params.timestamp;
    this.lastThreadPostSymbol = params.symbol;
    this.lastThreadPostKind = params.kind;
    this.watchlistStore.patchEntry(params.symbol, {
      lastThreadPostAt: params.timestamp,
      lastThreadPostKind: params.kind,
      operationStatus: "monitoring live price",
    });
  }

  private getDeliveryPressureState(symbol: string): SymbolDeliveryPressureState {
    const existing = this.deliveryPressureState.get(symbol);
    if (existing) {
      return existing;
    }

    const created: SymbolDeliveryPressureState = {
      lastFailureAt: null,
      lastFailureMessage: null,
    };
    this.deliveryPressureState.set(symbol, created);
    return created;
  }

  private recordDeliveryFailure(symbol: string, timestamp: number, message: string): void {
    const state = this.getDeliveryPressureState(symbol);
    state.lastFailureAt = timestamp;
    state.lastFailureMessage = message;
    this.deliveryPressureState.set(symbol, state);
    this.lastDeliveryFailureAt = timestamp;
    this.lastDeliveryFailureSymbol = symbol;
    this.lastDeliveryFailureMessage = message;
  }

  private clearDeliveryFailure(symbol: string, timestamp: number): void {
    const state = this.getDeliveryPressureState(symbol);
    if (state.lastFailureAt !== null && timestamp - state.lastFailureAt > DELIVERY_FAILURE_BACKOFF_MS) {
      state.lastFailureAt = null;
      state.lastFailureMessage = null;
      this.deliveryPressureState.set(symbol, state);
    }
  }

  private getStuckActivations(timestamp: number = Date.now()): ManualWatchlistStuckActivation[] {
    if (this.activationStuckWarningMs <= 0) {
      return [];
    }

    return this.watchlistStore
      .getActiveEntries()
      .filter((entry) => entry.lifecycle === "activating")
      .map((entry) => {
        const activatedAt = entry.activatedAt ?? null;
        return {
          symbol: entry.symbol,
          threadId: entry.discordThreadId ?? null,
          activatedAt,
          stuckForMs: activatedAt ? Math.max(0, timestamp - activatedAt) : 0,
          reason: "waiting on IBKR level seeding",
        };
      })
      .filter((entry) => entry.activatedAt !== null && entry.stuckForMs >= this.activationStuckWarningMs);
  }

  private runActivationWatchdog(timestamp: number = Date.now()): void {
    const stuckActivations = this.getStuckActivations(timestamp);
    const activeStuckSymbols = new Set(stuckActivations.map((entry) => entry.symbol));
    let changed = false;

    for (const entry of stuckActivations) {
      if (this.stuckActivationWarnings.has(entry.symbol)) {
        continue;
      }

      const minutes = Math.max(1, Math.round(entry.stuckForMs / 60_000));
      const message = `Still activating after ${minutes} minute${minutes === 1 ? "" : "s"}; ${entry.reason}.`;
      this.watchlistStore.patchEntry(entry.symbol, {
        lastError: message,
      });
      this.stuckActivationWarnings.add(entry.symbol);
      changed = true;
      this.emitLifecycle("activation_stuck", {
        symbol: entry.symbol,
        threadId: entry.threadId,
        details: {
          stuckForMs: entry.stuckForMs,
          reason: entry.reason,
        },
      });
    }

    for (const symbol of [...this.stuckActivationWarnings]) {
      if (!activeStuckSymbols.has(symbol)) {
        this.stuckActivationWarnings.delete(symbol);
      }
    }

    if (changed) {
      this.persistWatchlist();
    }
  }

  private startActivationWatchdog(): void {
    if (this.activationWatchdogTimer || this.activationStuckWarningMs <= 0) {
      return;
    }

    this.runActivationWatchdog();
    this.activationWatchdogTimer = setInterval(
      () => this.runActivationWatchdog(),
      ACTIVATION_WATCHDOG_INTERVAL_MS,
    );
    this.activationWatchdogTimer.unref();
  }

  private stopActivationWatchdog(): void {
    if (!this.activationWatchdogTimer) {
      return;
    }

    clearInterval(this.activationWatchdogTimer);
    this.activationWatchdogTimer = null;
  }

  private cancelPendingLevelTouchAlert(symbol: string): boolean {
    const normalizedSymbol = normalizeSymbol(symbol);
    const timer = this.pendingLevelTouchAlerts.get(normalizedSymbol);
    if (!timer) {
      return false;
    }

    clearTimeout(timer);
    this.pendingLevelTouchAlerts.delete(normalizedSymbol);
    return true;
  }

  private hasPendingLevelTouchAlert(symbol: string): boolean {
    return this.pendingLevelTouchAlerts.has(normalizeSymbol(symbol));
  }

  private isSameStoryLevel(left: number, right: number): boolean {
    const tolerance = Math.max(
      SAME_LEVEL_PRICE_TOLERANCE_ABSOLUTE,
      Math.max(Math.abs(left), Math.abs(right)) * SAME_LEVEL_PRICE_TOLERANCE_PCT,
    );
    return Math.abs(left - right) <= tolerance;
  }

  private getStoryPriority(eventType: string, label?: string | null): number {
    if (
      (eventType === "breakout" || eventType === "breakdown") &&
      (label === "failed" || label === "degrading")
    ) {
      return 100;
    }

    if (eventType === "fake_breakout" || eventType === "fake_breakdown" || eventType === "rejection") {
      return 95;
    }

    if (eventType === "breakout" || eventType === "breakdown" || eventType === "reclaim") {
      return 80;
    }

    if (eventType === "compression") {
      return 45;
    }

    if (eventType === "level_touch") {
      return 30;
    }

    return 10;
  }

  private pruneDominantLevelStories(symbol: string, timestamp: number): SymbolDominantLevelStory[] {
    const normalizedSymbol = normalizeSymbol(symbol);
    const stories = (this.dominantLevelStories.get(normalizedSymbol) ?? []).filter(
      (story) => timestamp - story.timestamp <= SAME_LEVEL_STORY_WINDOW_MS,
    );
    this.dominantLevelStories.set(normalizedSymbol, stories);
    return stories;
  }

  private recordDominantLevelStory(params: {
    symbol: string;
    level: number;
    eventType: string;
    timestamp: number;
    label?: string | null;
  }): void {
    if (!Number.isFinite(params.level)) {
      return;
    }

    const normalizedSymbol = normalizeSymbol(params.symbol);
    const priority = this.getStoryPriority(params.eventType, params.label);
    const stories = this.pruneDominantLevelStories(normalizedSymbol, params.timestamp).filter(
      (story) => !this.isSameStoryLevel(story.level, params.level) || story.priority > priority,
    );

    stories.push({
      level: params.level,
      eventType: params.eventType,
      timestamp: params.timestamp,
      priority,
      label: params.label ?? null,
    });
    this.dominantLevelStories.set(normalizedSymbol, stories);
  }

  private shouldSuppressLowerValueLevelStory(params: {
    symbol: string;
    level: number;
    eventType: string;
    timestamp: number;
    label?: string | null;
  }): boolean {
    if (!Number.isFinite(params.level)) {
      return false;
    }

    const priority = this.getStoryPriority(params.eventType, params.label);
    return this.pruneDominantLevelStories(params.symbol, params.timestamp).some(
      (story) =>
        this.isSameStoryLevel(story.level, params.level) &&
        story.priority > priority &&
        story.timestamp <= params.timestamp,
    );
  }

  private isDeliveryBackoffActive(symbol: string, timestamp: number): boolean {
    const state = this.getDeliveryPressureState(symbol);
    if (state.lastFailureAt === null) {
      return false;
    }

    if (timestamp - state.lastFailureAt > DELIVERY_FAILURE_BACKOFF_MS) {
      state.lastFailureAt = null;
      state.lastFailureMessage = null;
      this.deliveryPressureState.set(symbol, state);
      return false;
    }

    return true;
  }

  private getNarrationBurstState(symbol: string): SymbolNarrationBurstState {
    const existing = this.narrationBurstState.get(symbol);
    if (existing) {
      return existing;
    }

    const created: SymbolNarrationBurstState = [];
    this.narrationBurstState.set(symbol, created);
    return created;
  }

  private pruneNarrationBurstState(symbol: string, timestamp: number): SymbolNarrationBurstState {
    const state = this.getNarrationBurstState(symbol).filter(
      (entry) => timestamp - entry.timestamp <= NARRATION_BURST_WINDOW_MS,
    );
    this.narrationBurstState.set(symbol, state);
    return state;
  }

  private recordNarrationAttempt(params: {
    symbol: string;
    timestamp: number;
    kind: NarrationBurstKind;
    eventType?: string | null;
  }): void {
    const state = this.pruneNarrationBurstState(params.symbol, params.timestamp);
    state.push({
      kind: params.kind,
      eventType: params.eventType ?? null,
      timestamp: params.timestamp,
    });
    this.narrationBurstState.set(params.symbol, state);
  }

  private getStoryCriticalState(symbol: string): SymbolStoryCriticalState {
    const existing = this.storyCriticalState.get(symbol);
    if (existing) {
      return existing;
    }

    const created: SymbolStoryCriticalState = [];
    this.storyCriticalState.set(symbol, created);
    return created;
  }

  private pruneStoryCriticalState(symbol: string, timestamp: number): SymbolStoryCriticalState {
    const state = this.getStoryCriticalState(symbol).filter(
      (entry) => timestamp - entry.timestamp <= CONTINUITY_UPDATE_COOLDOWN_MS,
    );
    this.storyCriticalState.set(symbol, state);
    return state;
  }

  private recordStoryCriticalAttempt(params: {
    symbol: string;
    timestamp: number;
    kind: StoryCriticalKind;
  }): void {
    const state = this.pruneStoryCriticalState(params.symbol, params.timestamp);
    state.push({
      kind: params.kind,
      timestamp: params.timestamp,
    });
    this.storyCriticalState.set(params.symbol, state);
  }

  private shouldYieldOptionalPostToFreshCritical(params: {
    symbol: string;
    timestamp: number;
    eventType?: string | null;
    progressLabel?: OpportunityProgressUpdate["progressLabel"] | null;
    directionalReturnPct?: number | null;
  }): boolean {
    const timestampForPrune = params.timestamp + OPTIONAL_POST_CRITICAL_PREEMPT_WINDOW_MS;
    const recentStoryCritical = this.pruneStoryCriticalState(params.symbol, timestampForPrune);
    if (
      recentStoryCritical.some(
        (entry) =>
          entry.timestamp <= timestampForPrune &&
          Math.abs(entry.timestamp - params.timestamp) <= OPTIONAL_POST_CRITICAL_PREEMPT_WINDOW_MS,
      )
    ) {
      return true;
    }

    const recentCriticalPosts = this.pruneLiveThreadPosts(params.symbol, timestampForPrune).critical;
    return recentCriticalPosts.some((entry) => {
      if (entry.timestamp > timestampForPrune) {
        return false;
      }

      if (Math.abs(entry.timestamp - params.timestamp) > OPTIONAL_POST_CRITICAL_PREEMPT_WINDOW_MS) {
        return false;
      }

      if (params.eventType === null || params.eventType === undefined) {
        return true;
      }

      return entry.eventType === null || entry.eventType === params.eventType;
    });
  }

  private shouldAllowNarrationBurst(params: {
    symbol: string;
    timestamp: number;
    kind: NarrationBurstKind;
    eventType?: string | null;
  }): boolean {
    return decideNarrationBurst({
      state: this.pruneNarrationBurstState(params.symbol, params.timestamp),
      timestamp: params.timestamp,
      kind: params.kind,
      eventType: params.eventType,
      narrationBurstWindowMs: NARRATION_BURST_WINDOW_MS,
      recapBurstWindowMs: NARRATION_RECAP_BURST_WINDOW_MS,
      continuityCooldownMs: CONTINUITY_UPDATE_COOLDOWN_MS,
    }).shouldPost;
  }

  private pruneFollowThroughPostState(symbol: string, timestamp: number): SymbolFollowThroughPostState {
    const state = this.followThroughPostState.get(symbol) ?? [];
    const pruned = pruneFollowThroughStoryRecords(state, timestamp, this.postingPolicySettings);
    this.followThroughPostState.set(symbol, pruned);
    return pruned;
  }

  private decideFollowThroughUpdate(evaluation: EvaluatedOpportunity): FollowThroughPostDecision {
    const recent = this.pruneFollowThroughPostState(evaluation.symbol, evaluation.evaluatedAt);
    return decideFollowThroughPost({ records: recent, evaluation, settings: this.postingPolicySettings });
  }

  private pruneIntelligentAlertPostState(symbol: string, timestamp: number): IntelligentAlertStoryRecord[] {
    const state = this.intelligentAlertPostState.get(symbol) ?? [];
    const pruned = pruneIntelligentAlertStoryRecords(state, timestamp, this.postingPolicySettings);
    this.intelligentAlertPostState.set(symbol, pruned);
    return pruned;
  }

  private reserveIntelligentAlertPost(alert: IntelligentAlert): IntelligentAlertStoryRecord[] {
    const previous = [...this.pruneIntelligentAlertPostState(alert.symbol, alert.event.timestamp)];
    this.intelligentAlertPostState.set(alert.symbol, [
      ...previous,
      buildIntelligentAlertStoryRecord({
        timestamp: alert.event.timestamp,
        eventType: alert.event.eventType,
        level: alert.event.level,
        triggerPrice: alert.event.triggerPrice,
        severity: alert.severity,
        score: alert.score,
      }),
    ]);
    return previous;
  }

  private shouldPostIntelligentAlert(alert: IntelligentAlert): { shouldPost: boolean; reason: string } {
    const recent = this.pruneIntelligentAlertPostState(alert.symbol, alert.event.timestamp);
    const decision = decideIntelligentAlertPost({
      records: recent,
      timestamp: alert.event.timestamp,
      eventType: alert.event.eventType,
      level: alert.event.level,
      triggerPrice: alert.event.triggerPrice,
      severity: alert.severity,
      score: alert.score,
      settings: this.postingPolicySettings,
    });
    return { shouldPost: decision.shouldPost, reason: decision.reason };
  }

  private shouldAllowCriticalLivePost(params: {
    symbol: string;
    timestamp: number;
    kind: CriticalLivePostKind;
    eventType?: string | null;
    majorChange: boolean;
  }): boolean {
    const state = this.pruneLiveThreadPosts(params.symbol, params.timestamp);
    return decideCriticalLivePost({
      criticalPosts: state.critical,
      timestamp: params.timestamp,
      kind: params.kind,
      eventType: params.eventType,
      majorChange: params.majorChange,
      settings: this.postingPolicySettings,
    }).shouldPost;
  }

  private reserveFollowThroughUpdate(evaluation: EvaluatedOpportunity): SymbolFollowThroughPostState {
    const previous = [...this.pruneFollowThroughPostState(evaluation.symbol, evaluation.evaluatedAt)];
    this.followThroughPostState.set(evaluation.symbol, [
      ...previous,
      buildFollowThroughStoryRecord(evaluation),
    ]);
    return previous;
  }

  private shouldAllowOptionalLivePost(params: {
    symbol: string;
    timestamp: number;
    kind: "continuity" | "follow_through_state" | "recap";
    majorChange: boolean;
    eventType?: string | null;
    progressLabel?: OpportunityProgressUpdate["progressLabel"] | null;
    directionalReturnPct?: number | null;
  }): boolean {
    const state = this.pruneLiveThreadPosts(params.symbol, params.timestamp);
    return decideOptionalLivePost({
      criticalPosts: state.critical,
      optionalPosts: state.optional,
      narrationAttempts: this.pruneNarrationBurstState(params.symbol, params.timestamp),
      timestamp: params.timestamp,
      kind: params.kind,
      majorChange: params.majorChange,
      eventType: params.eventType,
      progressLabel: params.progressLabel,
      directionalReturnPct: params.directionalReturnPct,
      deliveryBackoffActive: this.isDeliveryBackoffActive(params.symbol, params.timestamp),
      optionalDensityLimit: this.postingPolicySettings.optionalLivePostDensityLimit,
      optionalKindLimit: this.postingPolicySettings.optionalLivePostKindLimit,
      continuityCooldownMs: CONTINUITY_UPDATE_COOLDOWN_MS,
      continuityMajorTransitionCooldownMs: CONTINUITY_MAJOR_TRANSITION_COOLDOWN_MS,
      narrationBurstWindowMs: NARRATION_BURST_WINDOW_MS,
      settings: this.postingPolicySettings,
    }).shouldPost;
  }

  private shouldPostContinuityUpdate(params: {
    symbol: string;
    label: string;
    message: string;
    timestamp: number;
    eventType?: string | null;
  }): boolean {
    const priorStoryCritical = this.pruneStoryCriticalState(params.symbol, params.timestamp).filter(
      (entry) => entry.timestamp < params.timestamp,
    );
    const recentNarration = this.pruneNarrationBurstState(params.symbol, params.timestamp);
    const recentFollowThroughState =
      (params.label === "setup_forming" ||
        params.label === "confirmation" ||
        params.label === "weakening") &&
      recentNarration.some(
        (entry) =>
          entry.kind === "follow_through_state" &&
          params.timestamp - entry.timestamp <= CONTINUITY_UPDATE_COOLDOWN_MS &&
          (params.eventType === null || params.eventType === undefined || entry.eventType === params.eventType),
      );
    const existing = this.continuityState.get(params.symbol);
    const recentStoryPost = priorStoryCritical.some(
      (entry) => params.timestamp - entry.timestamp < CONTINUITY_AFTER_STORY_MIN_GAP_MS,
    );
    if (recentStoryPost) {
      return false;
    }

    if (!existing) {
      if (
        recentFollowThroughState ||
        params.label === "setup_forming" &&
        priorStoryCritical.length > 0
      ) {
        return false;
      }

      const initialMajorChange = params.label === "failed" || params.label === "confirmation";
      return this.shouldAllowOptionalLivePost({
        symbol: params.symbol,
        timestamp: params.timestamp,
        kind: "continuity",
        majorChange: initialMajorChange,
        eventType: params.eventType ?? null,
      });
    }

    const age =
      existing.lastPostedAt === null ? Number.POSITIVE_INFINITY : params.timestamp - existing.lastPostedAt;
    const previousRank = this.continuityLabelRank(existing.lastLabel ?? "setup_forming");
    const nextRank = this.continuityLabelRank(params.label);

    if (
      recentFollowThroughState
    ) {
      return false;
    }

    const recentSameMessageAt = existing.recentMessages?.[params.message] ?? null;
    if (
      recentSameMessageAt !== null &&
      params.timestamp - recentSameMessageAt < CONTINUITY_EXACT_MESSAGE_COOLDOWN_MS
    ) {
      return false;
    }

    if (
      params.label === "setup_forming" &&
      priorStoryCritical.length > 0
    ) {
      return false;
    }

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
      params.label === "confirmation";
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
    level?: number;
    zoneKind?: "support" | "resistance";
  } {
    const continuityType = this.mapInterpretationTypeToContinuityLabel(interpretation);
    return {
      symbol: interpretation.symbol,
      timestamp: interpretation.timestamp,
      continuityType,
      confidence: interpretation.confidence,
      eventType: interpretation.eventType,
      level: interpretation.level,
      zoneKind: interpretation.zoneKind,
      message:
        continuityType === "setup_forming"
          ? `${interpretation.message}; the setup is still forming, so price still needs a cleaner decision.`
          : continuityType === "confirmation"
            ? `${interpretation.message}; the setup is now moving into confirmation and needs acceptance to hold.`
            : continuityType === "continuation"
              ? `${interpretation.message}; the setup is following through, so confirmation matters more than fresh anticipation.`
              : `${interpretation.message}; the setup is weakening and needs a better reaction.`,
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
    const eventLabel = progressUpdate.eventType.replaceAll("_", " ");
    const longCautionEvent = this.isLongCautionEventType(progressUpdate.eventType);

    if (progressUpdate.progressLabel === "improving") {
      if (directional < 0.2) {
        return null;
      }

      if (longCautionEvent) {
        return {
          symbol: progressUpdate.symbol,
          timestamp: progressUpdate.timestamp,
          continuityType: directional >= 0.45 ? "continuation" : "confirmation",
          eventType: progressUpdate.eventType,
          message:
            directional >= 0.45
              ? `${eventLabel} caution is still active, so the setup needs stabilization or a reclaim before it looks cleaner.`
              : `${eventLabel} caution is improving, so longs still need confirmation before stepping back in.`,
        };
      }

      return {
        symbol: progressUpdate.symbol,
        timestamp: progressUpdate.timestamp,
        continuityType: directional >= 0.45 ? "continuation" : "confirmation",
        eventType: progressUpdate.eventType,
        message:
          directional >= 0.45
            ? `${eventLabel} is still improving, so the setup is moving from early confirmation into follow-through.`
            : `${eventLabel} is improving, so the setup is moving toward real confirmation.`,
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
        message: longCautionEvent
          ? `${eventLabel} caution is stalling, so the long-side risk signal needs fresh confirmation.`
          : `${eventLabel} is stalling, so the setup is weakening and needs a better reaction.`,
      };
    }

    return {
      symbol: progressUpdate.symbol,
      timestamp: progressUpdate.timestamp,
      continuityType: "failed",
      eventType: progressUpdate.eventType,
      message: longCautionEvent
        ? `${eventLabel} caution is fading, so the chart needs a cleaner long-side decision.`
        : `${eventLabel} is degrading enough that the setup is now close to failure unless it stabilizes.`,
    };
  }

  private isLongCautionEventType(eventType: string): boolean {
    return eventType === "breakdown" || eventType === "fake_breakout" || eventType === "rejection";
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
    const eventLabel = evaluation.eventType.replaceAll("_", " ");
    const longCautionEvent = this.isLongCautionEventType(evaluation.eventType);

    if (evaluation.followThroughLabel === "strong" || evaluation.followThroughLabel === "working") {
      return {
        symbol: evaluation.symbol,
        timestamp: evaluation.evaluatedAt,
        continuityType: "continuation",
        eventType: evaluation.eventType,
        message: longCautionEvent
          ? `${eventLabel} caution stayed active; the setup needs stabilization or a reclaim before it looks cleaner.`
          : `${eventLabel} kept working, so the setup still has follow-through instead of fading immediately.`,
      };
    }

    if (evaluation.followThroughLabel === "stalled") {
      return {
        symbol: evaluation.symbol,
        timestamp: evaluation.evaluatedAt,
        continuityType: "weakening",
        eventType: evaluation.eventType,
        message: longCautionEvent
          ? `${eventLabel} caution stalled, so the long-side risk signal is less urgent but still needs confirmation.`
          : `${eventLabel} stalled, so the setup weakened instead of following through cleanly.`,
      };
    }

    return {
      symbol: evaluation.symbol,
      timestamp: evaluation.evaluatedAt,
      continuityType: "failed",
      eventType: evaluation.eventType,
      message: longCautionEvent
        ? `${eventLabel} caution failed, so the chart needs a fresh setup before acting.`
        : `${eventLabel} failed, so the setup should be treated as failed until a new setup forms.`,
    };
  }

  private postContinuityUpdate(update: {
    symbol: string;
    timestamp: number;
    continuityType: string;
    message: string;
    confidence?: number;
    eventType?: string | null;
    level?: number;
    zoneKind?: "support" | "resistance";
  }): boolean {
    if (
      !this.shouldPostContinuityUpdate({
        symbol: update.symbol,
        label: update.continuityType,
        message: update.message,
        timestamp: update.timestamp,
        eventType: update.eventType ?? null,
      })
    ) {
      return false;
    }

    const entry = this.watchlistStore.getEntry(update.symbol);
    if (!entry?.active || !entry.discordThreadId) {
      return false;
    }

    if (
      !this.shouldAllowNarrationBurst({
        symbol: update.symbol,
        timestamp: update.timestamp,
        kind: "continuity",
        eventType: update.eventType ?? null,
      })
    ) {
      return false;
    }

    this.recordNarrationAttempt({
      symbol: update.symbol,
      timestamp: update.timestamp,
      kind: "continuity",
      eventType: update.eventType ?? null,
    });

    const previousState = this.continuityState.get(update.symbol);
    const recentMessages = Object.fromEntries(
      Object.entries(previousState?.recentMessages ?? {}).filter(
        ([, postedAt]) => update.timestamp - postedAt < CONTINUITY_EXACT_MESSAGE_COOLDOWN_MS,
      ),
    );
    recentMessages[update.message] = update.timestamp;
    this.continuityState.set(update.symbol, {
      lastLabel: update.continuityType,
      lastPostedAt: update.timestamp,
      lastMessage: update.message,
      recentMessages,
    });

    const payload = formatContinuityUpdateAsPayload({
      update,
    });

    void (async (): Promise<boolean> => {
      if (this.optionalPostSettleDelayMs > 0) {
        await delay(this.optionalPostSettleDelayMs);
        if (
          this.shouldYieldOptionalPostToFreshCritical({
            symbol: update.symbol,
            timestamp: update.timestamp,
            eventType: update.eventType ?? null,
          })
        ) {
          if (previousState) {
            this.continuityState.set(update.symbol, previousState);
          } else {
            this.continuityState.delete(update.symbol);
          }
          return false;
        }
      }

      await this.options.discordAlertRouter.routeAlert(entry.discordThreadId!, payload);
      return true;
    })()
      .then((posted) => {
        if (!posted) {
          return;
        }
        this.recordLiveThreadPost({
          symbol: update.symbol,
          timestamp: update.timestamp,
          kind: "continuity",
          critical: false,
          eventType: update.eventType ?? null,
        });
        this.clearDeliveryFailure(update.symbol, update.timestamp);
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
        if (previousState) {
          this.continuityState.set(update.symbol, previousState);
        } else {
          this.continuityState.delete(update.symbol);
        }
        this.emitLifecycle("continuity_post_failed", {
          symbol: update.symbol,
          threadId: entry.discordThreadId,
          details: {
            continuityType: update.continuityType,
            error: message,
          },
        });
        this.recordDeliveryFailure(update.symbol, update.timestamp, message);
        console.error(`[ManualWatchlistRuntimeManager] Failed to route continuity update: ${message}`);
      });

    return true;
  }

  private emitTraderFacingInterpretations(
    interpretations?: ReturnType<OpportunityRuntimeController["processMonitoringEvent"]>["interpretations"],
    options?: {
      suppressPosting?: boolean;
      freshCriticalPosted?: boolean;
      matchingEvent?: Pick<MonitoringEvent, "eventType" | "level" | "zoneKind">;
    },
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

      const continuityUpdate = this.buildContinuityUpdateFromInterpretation(interpretation);
      if (options?.suppressPosting) {
        continue;
      }

      if (
        options?.matchingEvent &&
        !this.doesInterpretationMatchEvent(interpretation, options.matchingEvent)
      ) {
        continue;
      }

      if (
        options?.freshCriticalPosted &&
        (continuityUpdate.continuityType === "setup_forming" ||
          continuityUpdate.continuityType === "weakening")
      ) {
        continue;
      }

      this.postContinuityUpdate(continuityUpdate);
    }
  }

  private doesInterpretationMatchEvent(
    interpretation: OpportunityInterpretation,
    event: Pick<MonitoringEvent, "eventType" | "level" | "zoneKind">,
  ): boolean {
    if (interpretation.eventType !== event.eventType) {
      return false;
    }

    if (interpretation.zoneKind && interpretation.zoneKind !== event.zoneKind) {
      return false;
    }

    if (
      typeof interpretation.level === "number" &&
      Math.abs(interpretation.level - event.level) > 0.02
    ) {
      return false;
    }

    return true;
  }

  private postFollowThroughStateUpdate(progressUpdate: OpportunityProgressUpdate): boolean {
    const entry = this.watchlistStore.getEntry(progressUpdate.symbol);
    if (!entry?.active || !entry.discordThreadId) {
      return false;
    }

    if (
      (progressUpdate.eventType === "breakout" || progressUpdate.eventType === "breakdown") &&
      progressUpdate.progressLabel === "stalling" &&
      Math.abs(progressUpdate.directionalReturnPct ?? 0) < MIN_DIRECTIONAL_STATE_UPDATE_PCT
    ) {
      return false;
    }

    if (
      this.shouldSuppressLowerValueLevelStory({
        symbol: progressUpdate.symbol,
        level: progressUpdate.entryPrice,
        eventType: progressUpdate.eventType,
        timestamp: progressUpdate.timestamp,
        label: progressUpdate.progressLabel,
      })
    ) {
      return false;
    }

    if (
      !this.shouldAllowOptionalLivePost({
        symbol: progressUpdate.symbol,
        timestamp: progressUpdate.timestamp,
        kind: "follow_through_state",
        majorChange: progressUpdate.progressLabel === "degrading",
        eventType: progressUpdate.eventType,
        progressLabel: progressUpdate.progressLabel,
        directionalReturnPct: progressUpdate.directionalReturnPct,
      })
    ) {
      return false;
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
      return false;
    }

    if (
      existing &&
      existing.lastLabel !== progressUpdate.progressLabel &&
      age < CONTINUITY_UPDATE_COOLDOWN_MS &&
      directionalDelta < minimumDelta
    ) {
      return false;
    }

    if (
      !this.shouldAllowNarrationBurst({
        symbol: progressUpdate.symbol,
        timestamp: progressUpdate.timestamp,
        kind: "follow_through_state",
        eventType: progressUpdate.eventType,
      })
    ) {
      return false;
    }

    this.recordNarrationAttempt({
      symbol: progressUpdate.symbol,
      timestamp: progressUpdate.timestamp,
      kind: "follow_through_state",
      eventType: progressUpdate.eventType,
    });

    const payload = formatFollowThroughStateUpdateAsPayload({
      symbol: progressUpdate.symbol,
      timestamp: progressUpdate.timestamp,
      eventType: progressUpdate.eventType,
      progressLabel: progressUpdate.progressLabel,
      directionalReturnPct: progressUpdate.directionalReturnPct,
      entryPrice: progressUpdate.entryPrice,
      currentPrice: progressUpdate.currentPrice,
    });

    void (async (): Promise<boolean> => {
      if (this.optionalPostSettleDelayMs > 0) {
        await delay(this.optionalPostSettleDelayMs);
        if (
          this.shouldYieldOptionalPostToFreshCritical({
            symbol: progressUpdate.symbol,
            timestamp: progressUpdate.timestamp,
            eventType: progressUpdate.eventType,
          })
        ) {
          return false;
        }
      }

      await this.options.discordAlertRouter.routeAlert(entry.discordThreadId!, payload);
      return true;
    })()
      .then((posted) => {
        if (!posted) {
          return;
        }
        this.recordLiveThreadPost({
          symbol: progressUpdate.symbol,
          timestamp: progressUpdate.timestamp,
          kind: "follow_through_state",
          critical: false,
          eventType: progressUpdate.eventType,
        });
        this.clearDeliveryFailure(progressUpdate.symbol, progressUpdate.timestamp);
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
        this.recordDeliveryFailure(progressUpdate.symbol, progressUpdate.timestamp, message);
        console.error(`[ManualWatchlistRuntimeManager] Failed to route follow-through state update: ${message}`);
      });

    return true;
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
      return `What matters next: ${eventType} needs a decisive reaction because room still looks tight.`;
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

    return `What matters next: ${eventType} still needs clean acceptance so the setup can keep following through.`;
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
        `current read: ${eventType} is still the lead idea near ${level} with ${topOpportunity.classification.replaceAll("_", " ")} quality.`,
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
      parts.push(`Current read: ${params.interpretation.message}.`);
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

  private buildAiSignalCommentaryBody(payload: AlertPayload): string {
    const blockedLinePatterns = [
      /\blimited downside\b/i,
      /\bdownside\b/i,
      /\bFirst support\b/i,
      /\bNext support\b/i,
      /\bRisk support\b/i,
    ];
    const lines = payload.body.split("\n");
    const cleanedLines: string[] = [];
    let skippingLevelSection = false;

    for (const line of lines) {
      if (/^(Next levels|Key levels):/i.test(line.trim())) {
        skippingLevelSection = true;
        continue;
      }

      if (skippingLevelSection) {
        if (/^(Signal|Importance):/i.test(line.trim()) || /^(?:Trigger|Triggered near):/i.test(line.trim())) {
          skippingLevelSection = false;
        } else {
          continue;
        }
      }

      if (blockedLinePatterns.some((pattern) => pattern.test(line))) {
        continue;
      }

      cleanedLines.push(line);
    }

    return cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  private buildAiSignalCommentaryMetadata(payload: AlertPayload): Record<string, unknown> | null {
    if (!payload.metadata) {
      return null;
    }

    const {
      nextBarrierSide,
      nextBarrierDistancePct,
      targetSide,
      targetPrice,
      targetDistancePct,
      roomToRiskRatio,
      ...safeMetadata
    } = payload.metadata;
    return safeMetadata;
  }

  private pruneAiSignalStoryState(symbol: string, timestamp: number): AiSignalStoryRecord[] {
    const normalizedSymbol = normalizeSymbol(symbol);
    const state = this.aiSignalStoryState.get(normalizedSymbol) ?? [];
    const pruned = pruneAiSignalStoryRecords(state, timestamp, this.postingPolicySettings);
    this.aiSignalStoryState.set(normalizedSymbol, pruned);
    return pruned;
  }

  private reserveAiSignalStory(symbol: string, timestamp: number, storyKey: string): AiSignalStoryRecord[] {
    const normalizedSymbol = normalizeSymbol(symbol);
    const previous = [...this.pruneAiSignalStoryState(normalizedSymbol, timestamp)];
    this.aiSignalStoryState.set(normalizedSymbol, [
      ...previous,
      {
        storyKey,
        reservedAt: timestamp,
      },
    ]);
    return previous;
  }

  private async maybePostSignalCommentaryWithAI(params: {
    threadId: string;
    alert: IntelligentAlert;
    deterministicPayload: AlertPayload;
  }): Promise<void> {
    const aiCommentaryService = this.options.aiCommentaryService;
    if (!aiCommentaryService) {
      return;
    }

    const storyKey = buildAiSignalStoryKey({
      symbol: params.alert.symbol,
      eventType: params.alert.event.eventType,
      level: params.alert.event.level,
      title: params.deterministicPayload.title,
    });
    const recentAiStories = this.pruneAiSignalStoryState(params.alert.symbol, params.alert.event.timestamp);
    const aiDecision = decideAiSignalPost({
      records: recentAiStories,
      symbolAiRecords: recentAiStories,
      timestamp: params.alert.event.timestamp,
      storyKey,
      severity: params.alert.severity,
      confidence: params.alert.confidence,
      score: params.alert.score,
      settings: this.postingPolicySettings,
    });
    if (!aiDecision.shouldPost) {
      return;
    }

    if (
      !this.shouldAllowOptionalLivePost({
        symbol: params.alert.symbol,
        timestamp: params.alert.event.timestamp,
        kind: "recap",
        majorChange: false,
        eventType: params.alert.event.eventType,
      }) ||
      !this.shouldAllowNarrationBurst({
        symbol: params.alert.symbol,
        timestamp: params.alert.event.timestamp,
        kind: "recap",
        eventType: params.alert.event.eventType,
      })
    ) {
      return;
    }

    const previousAiState = this.reserveAiSignalStory(
      params.alert.symbol,
      params.alert.event.timestamp,
      storyKey,
    );
    this.recordNarrationAttempt({
      symbol: params.alert.symbol,
      timestamp: params.alert.event.timestamp,
      kind: "recap",
      eventType: params.alert.event.eventType,
    });

    try {
      const commentary = await aiCommentaryService.explainSignal({
        symbol: params.alert.symbol,
        title: params.deterministicPayload.title,
        deterministicBody: this.buildAiSignalCommentaryBody(params.deterministicPayload),
        eventType: params.alert.event.eventType,
        severity: params.alert.severity,
        confidence: params.alert.confidence,
        score: params.alert.score,
        metadata: this.buildAiSignalCommentaryMetadata(params.deterministicPayload),
      });

      if (!commentary?.text) {
        return;
      }

      this.aiCommentaryGeneratedCount += 1;
      this.lastAiCommentaryGeneratedAt = Date.now();
      this.lastAiCommentaryGeneratedSymbol = params.alert.symbol;
      this.lastAiCommentaryGeneratedModel = commentary.model;
      this.emitLifecycle("ai_commentary_generated", {
        symbol: params.alert.symbol,
        threadId: params.threadId,
        details: {
          model: commentary.model,
          commentaryType: "intelligent_alert",
          eventType: params.alert.event.eventType,
        },
      });

      const currentEntry = this.watchlistStore.getEntry(params.alert.symbol);
      if (!currentEntry?.active || currentEntry.discordThreadId !== params.threadId) {
        return;
      }

      await this.options.discordAlertRouter.routeAlert(params.threadId, {
        title: `${params.alert.symbol} AI read`,
        body: [
          "AI read:",
          commentary.text,
          "",
          `Based on: ${params.deterministicPayload.title}`,
        ].join("\n"),
        event: params.alert.event,
        symbol: params.alert.symbol,
        timestamp: params.alert.event.timestamp,
        metadata: {
          eventType: params.alert.event.eventType,
          messageKind: "ai_signal_commentary",
          severity: params.alert.severity,
          confidence: params.alert.confidence,
          score: params.alert.score,
          aiGenerated: true,
          suppressEmbeds: true,
        },
      });

      this.recordLiveThreadPost({
        symbol: params.alert.symbol,
        timestamp: params.alert.event.timestamp,
        kind: "ai_signal_commentary",
        critical: false,
        eventType: params.alert.event.eventType,
      });
    } catch (error) {
      this.aiSignalStoryState.set(normalizeSymbol(params.alert.symbol), previousAiState);
      const message = error instanceof Error ? error.message : String(error);
      this.aiCommentaryFailedCount += 1;
      this.lastAiCommentaryFailedAt = Date.now();
      this.lastAiCommentaryFailedSymbol = params.alert.symbol;
      this.lastAiCommentaryFailureMessage = message;
      this.emitLifecycle("ai_commentary_failed", {
        symbol: params.alert.symbol,
        threadId: params.threadId,
        details: {
          error: message,
          commentaryType: "intelligent_alert",
          eventType: params.alert.event.eventType,
        },
      });
      console.error(`[ManualWatchlistRuntimeManager] Failed to build AI signal commentary: ${message}`);
    }
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

      this.aiCommentaryGeneratedCount += 1;
      this.lastAiCommentaryGeneratedAt = Date.now();
      this.lastAiCommentaryGeneratedSymbol = params.symbol;
      this.lastAiCommentaryGeneratedModel = commentary.model;
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
      this.aiCommentaryFailedCount += 1;
      this.lastAiCommentaryFailedAt = Date.now();
      this.lastAiCommentaryFailedSymbol = params.symbol;
      this.lastAiCommentaryFailureMessage = message;
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

    if (
      this.hasRecentLiveThreadPost({
        symbol: params.symbol,
        timestamp: params.timestamp,
        critical: true,
        withinMs: RECAP_AFTER_STORY_MIN_GAP_MS,
      })
    ) {
      return;
    }

    if (
      this.pruneStoryCriticalState(params.symbol, params.timestamp).some(
        (entry) => params.timestamp - entry.timestamp >= 0 && params.timestamp - entry.timestamp < RECAP_AFTER_STORY_MIN_GAP_MS,
      )
    ) {
      return;
    }

    if (
      this.hasRecentLiveThreadPost({
        symbol: params.symbol,
        timestamp: params.timestamp,
        kinds: ["ai_signal_commentary"],
        critical: false,
        withinMs: AI_SIGNAL_COMMENTARY_COOLDOWN_MS,
      })
    ) {
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

    if (
      !this.shouldAllowNarrationBurst({
        symbol: params.symbol,
        timestamp: params.timestamp,
        kind: "recap",
        eventType:
          params.evaluation?.eventType ??
          params.progressUpdate?.eventType ??
          params.interpretation?.eventType ??
          null,
      })
    ) {
      return;
    }

    this.recordNarrationAttempt({
      symbol: params.symbol,
      timestamp: params.timestamp,
      kind: "recap",
      eventType:
        params.evaluation?.eventType ??
        params.progressUpdate?.eventType ??
        params.interpretation?.eventType ??
        null,
    });

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
          eventType:
            params.evaluation?.eventType ??
            params.progressUpdate?.eventType ??
            params.interpretation?.eventType ??
            null,
        });
        this.clearDeliveryFailure(params.symbol, params.timestamp);
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
          this.recordDeliveryFailure(params.symbol, params.timestamp, message);
          console.error(`[ManualWatchlistRuntimeManager] Failed to route symbol recap: ${message}`);
        });
    });
  }

  private async ensureLevelsForActiveEntries(
    entries: WatchlistEntry[],
    options: { seedMissingLevels?: boolean } = {},
  ): Promise<WatchlistEntry[]> {
    const startableEntries: WatchlistEntry[] = [];
    const seedMissingLevels = options.seedMissingLevels ?? true;

    for (const entry of entries) {
      const currentEntry = this.watchlistStore.getEntry(entry.symbol);
      if (!currentEntry?.active) {
        continue;
      }

      if (
        currentEntry.lifecycle === "activation_failed" ||
        currentEntry.lifecycle === "activating" ||
        currentEntry.lifecycle === "restoring"
      ) {
        continue;
      }

      if (!this.options.levelStore.getLevels(currentEntry.symbol)) {
        if (!seedMissingLevels) {
          continue;
        }

        this.watchlistStore.patchEntry(currentEntry.symbol, {
          lifecycle: "refresh_pending",
          refreshPending: true,
        });

        try {
          await this.seedLevelsForSymbol(currentEntry.symbol);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(
            `[ManualWatchlistRuntimeManager] Failed to seed levels for ${currentEntry.symbol} during monitoring restart: ${message}`,
          );
          continue;
        }
      }

      const refreshedEntry = this.watchlistStore.getEntry(currentEntry.symbol);
      if (refreshedEntry?.active && refreshedEntry.lifecycle !== "activating") {
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

    const supersedesLevelTouch =
      event.eventType === "breakout" ||
      event.eventType === "breakdown" ||
      event.eventType === "reclaim" ||
      event.eventType === "fake_breakout" ||
      event.eventType === "fake_breakdown" ||
      event.eventType === "rejection";
    if (supersedesLevelTouch && this.cancelPendingLevelTouchAlert(event.symbol)) {
      this.emitLifecycle("alert_suppressed", {
        symbol: event.symbol,
        threadId: entry.discordThreadId,
        details: {
          eventType: "level_touch",
          reason: "superseded_by_resolution",
        },
      });
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
      const postAlert = (): void => {
        const alertPostDecision = this.shouldPostIntelligentAlert(alertResult.rawAlert);
        if (!alertPostDecision.shouldPost) {
          this.emitLifecycle("alert_suppressed", {
            symbol: event.symbol,
            threadId: entry.discordThreadId,
            details: {
              eventType: event.eventType,
              severity: alertResult.rawAlert.severity,
              confidence: alertResult.rawAlert.confidence,
              score: alertResult.rawAlert.score,
              reason: alertPostDecision.reason,
            },
          });
          return;
        }

        const criticalMajorChange =
          event.eventType === "breakout" ||
          event.eventType === "breakdown" ||
          event.eventType === "reclaim" ||
          alertResult.rawAlert.severity === "critical" ||
          (alertResult.rawAlert.severity === "high" && alertResult.rawAlert.confidence === "high");
        if (
          !this.shouldAllowCriticalLivePost({
            symbol: event.symbol,
            timestamp: event.timestamp,
            kind: "intelligent_alert",
            eventType: event.eventType,
            majorChange: criticalMajorChange,
          })
        ) {
          this.emitLifecycle("alert_suppressed", {
            symbol: event.symbol,
            threadId: entry.discordThreadId,
            details: {
              eventType: event.eventType,
              severity: alertResult.rawAlert.severity,
              confidence: alertResult.rawAlert.confidence,
              score: alertResult.rawAlert.score,
              reason: "critical_burst_governor",
            },
          });
          return;
        }

        const previousIntelligentAlertPostState = this.reserveIntelligentAlertPost(alertResult.rawAlert);
        this.recordStoryCriticalAttempt({
          symbol: event.symbol,
          timestamp: event.timestamp,
          kind: "intelligent_alert",
        });
        void this.options.discordAlertRouter
          .routeAlert(entry.discordThreadId!, alert)
          .then(() => {
            this.recordLiveThreadPost({
              symbol: event.symbol,
              timestamp: event.timestamp,
              kind: "intelligent_alert",
              critical: true,
              eventType: event.eventType,
            });
            this.clearDeliveryFailure(event.symbol, event.timestamp);
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
            void this.maybePostSignalCommentaryWithAI({
              threadId: entry.discordThreadId!,
              alert: alertResult.rawAlert,
              deterministicPayload: alert,
            });
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.intelligentAlertPostState.set(event.symbol, previousIntelligentAlertPostState);
            this.emitLifecycle("alert_post_failed", {
              symbol: event.symbol,
              threadId: entry.discordThreadId,
              details: {
                eventType: event.eventType,
                error: message,
              },
            });
            this.recordDeliveryFailure(event.symbol, event.timestamp, message);
            console.error(`[ManualWatchlistRuntimeManager] Failed to route Discord alert: ${message}`);
          });
      };

      if (event.eventType === "level_touch") {
        this.cancelPendingLevelTouchAlert(event.symbol);
        if (this.levelTouchSupersedeDelayMs === 0) {
          postAlert();
          return;
        }
        const timer = setTimeout(() => {
          this.pendingLevelTouchAlerts.delete(normalizeSymbol(event.symbol));
          postAlert();
        }, this.levelTouchSupersedeDelayMs);
        timer.unref();
        this.pendingLevelTouchAlerts.set(normalizeSymbol(event.symbol), timer);
      } else {
        postAlert();
      }
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
    this.emitTraderFacingInterpretations(snapshot.interpretations, {
      freshCriticalPosted: Boolean(alertResult.formatted),
      matchingEvent: event,
    });
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

  private postFollowThroughUpdate(evaluation: EvaluatedOpportunity): boolean {
    const entry = this.watchlistStore.getEntry(evaluation.symbol);
    if (!entry?.active || !entry.discordThreadId) {
      return false;
    }

    if (
      this.shouldSuppressLowerValueLevelStory({
        symbol: evaluation.symbol,
        level: evaluation.entryPrice,
        eventType: evaluation.eventType,
        timestamp: evaluation.evaluatedAt,
        label: evaluation.followThroughLabel,
      })
    ) {
      return false;
    }

    const followThroughDecision = this.decideFollowThroughUpdate(evaluation);
    if (!followThroughDecision.shouldPost) {
      return false;
    }

    const followThroughMajorChange =
      evaluation.followThroughLabel === "failed" ||
      evaluation.followThroughLabel === "strong" ||
      (evaluation.directionalReturnPct !== null &&
        Math.abs(evaluation.directionalReturnPct) >= FOLLOW_THROUGH_MAJOR_MOVE_PCT);
    if (
      !this.shouldAllowCriticalLivePost({
        symbol: evaluation.symbol,
        timestamp: evaluation.evaluatedAt,
        kind: "follow_through",
        eventType: evaluation.eventType,
        majorChange: followThroughMajorChange,
      })
    ) {
      this.emitLifecycle("alert_suppressed", {
        symbol: evaluation.symbol,
        threadId: entry.discordThreadId,
        details: {
          eventType: evaluation.eventType,
          followThroughLabel: evaluation.followThroughLabel,
          reason: "critical_burst_governor",
        },
      });
      return false;
    }

    if (
      !this.shouldAllowNarrationBurst({
        symbol: evaluation.symbol,
        timestamp: evaluation.evaluatedAt,
        kind: "follow_through",
        eventType: evaluation.eventType,
      })
    ) {
      return false;
    }

    const previousFollowThroughPostState = this.reserveFollowThroughUpdate(evaluation);
    this.recordNarrationAttempt({
      symbol: evaluation.symbol,
      timestamp: evaluation.evaluatedAt,
      kind: "follow_through",
      eventType: evaluation.eventType,
    });
    this.recordStoryCriticalAttempt({
      symbol: evaluation.symbol,
      timestamp: evaluation.evaluatedAt,
      kind: "follow_through",
    });
    this.recordDominantLevelStory({
      symbol: evaluation.symbol,
      level: evaluation.entryPrice,
      eventType: evaluation.eventType,
      timestamp: evaluation.evaluatedAt,
      label: evaluation.followThroughLabel,
    });

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
      repeatedOutcomeUpdate: followThroughDecision.reason === "materially_new",
    });

    void this.options.discordAlertRouter
      .routeAlert(entry.discordThreadId, payload)
      .then(() => {
        this.recordLiveThreadPost({
          symbol: evaluation.symbol,
          timestamp: evaluation.evaluatedAt,
          kind: "follow_through",
          critical: true,
          eventType: evaluation.eventType,
        });
        this.clearDeliveryFailure(evaluation.symbol, evaluation.evaluatedAt);
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
        this.followThroughPostState.set(evaluation.symbol, previousFollowThroughPostState);
        this.emitLifecycle("follow_through_post_failed", {
          symbol: evaluation.symbol,
          threadId: entry.discordThreadId,
          details: {
            eventType: evaluation.eventType,
            error: message,
          },
        });
        this.recordDeliveryFailure(evaluation.symbol, evaluation.evaluatedAt, message);
        console.error(`[ManualWatchlistRuntimeManager] Failed to route follow-through update: ${message}`);
      });

    return true;
  }

  private handlePriceUpdate = (update: LivePriceUpdate): void => {
    this.lastPriceUpdateAt = update.timestamp;
    this.lastPriceUpdateSymbol = update.symbol;
    this.watchlistStore.patchEntry(update.symbol, {
      lastPriceUpdateAt: update.timestamp,
      operationStatus: "monitoring live price",
    });

    void this.maybePostFastLevelClear(update).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ManualWatchlistRuntimeManager] Failed to post fast level clear: ${message}`);
    });

    void this.maybeRefreshLevelSnapshot(update).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ManualWatchlistRuntimeManager] Failed to refresh level snapshot: ${message}`);
    });

    const snapshot = this.options.opportunityRuntimeController.processPriceUpdate(update);
    if (!snapshot) {
      return;
    }

    this.emitTraderFacingInterpretations(snapshot.interpretations, {
      suppressPosting: true,
    });
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

    const completedEvaluationKeys = new Set(
      snapshot.completedEvaluations.map((evaluation) => `${evaluation.symbol}:${evaluation.eventType}`),
    );
    for (const evaluation of snapshot.completedEvaluations) {
      this.recordDominantLevelStory({
        symbol: evaluation.symbol,
        level: evaluation.entryPrice,
        eventType: evaluation.eventType,
        timestamp: evaluation.evaluatedAt,
        label: evaluation.followThroughLabel,
      });
    }

    for (const progressUpdate of snapshot.progressUpdates) {
      if (completedEvaluationKeys.has(`${progressUpdate.symbol}:${progressUpdate.eventType}`)) {
        continue;
      }
      if (
        (progressUpdate.eventType === "breakout" || progressUpdate.eventType === "breakdown") &&
        progressUpdate.progressLabel === "stalling" &&
        Math.abs(progressUpdate.directionalReturnPct ?? 0) < MIN_DIRECTIONAL_STATE_UPDATE_PCT
      ) {
        continue;
      }
      if (
        progressUpdate.eventType === "level_touch" &&
        this.hasPendingLevelTouchAlert(progressUpdate.symbol)
      ) {
        continue;
      }

      const followThroughStatePosted = this.postFollowThroughStateUpdate(progressUpdate);
      const continuityUpdate = this.buildContinuityUpdateFromProgress(progressUpdate);
      if (
        continuityUpdate &&
        !followThroughStatePosted &&
        continuityUpdate.continuityType === "failed"
      ) {
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
      this.maybePostSymbolRecap({
        symbol: evaluation.symbol,
        timestamp: evaluation.evaluatedAt,
        snapshot,
        evaluation,
        interpretation: (snapshot.interpretations ?? []).find((interpretation) => interpretation.symbol === evaluation.symbol),
      });
    }
  };

  private async performRestartMonitoring(): Promise<void> {
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

    const startableEntries = await this.ensureLevelsForActiveEntries(activeEntries, {
      seedMissingLevels: true,
    });
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

  private async restartMonitoring(): Promise<void> {
    const restartTask = this.monitoringRestartQueue
      .catch(() => undefined)
      .then(() => this.performRestartMonitoring());
    this.monitoringRestartQueue = restartTask;
    await restartTask;
  }

  private async restartMonitoringWithReadyEntriesOnly(): Promise<void> {
    const restartTask = this.monitoringRestartQueue
      .catch(() => undefined)
      .then(async () => {
        await this.options.monitor.stop();
        const activeEntries = this.watchlistStore.getActiveEntries();
        const startableEntries = await this.ensureLevelsForActiveEntries(activeEntries, {
          seedMissingLevels: false,
        });
        if (startableEntries.length === 0) {
          this.emitLifecycle("monitor_restart_completed", {
            details: {
              activeSymbolCount: activeEntries.length,
              startableSymbolCount: 0,
              readyOnly: true,
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
            readyOnly: true,
          },
        });
      });
    this.monitoringRestartQueue = restartTask;
    await restartTask;
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
      if (entry.lifecycle === "activation_failed") {
        this.emitLifecycle("restore_skipped", {
          symbol: entry.symbol,
          threadId: entry.discordThreadId ?? null,
          details: {
            error: entry.lastError ?? "Activation failed before restart. Retry manually to restore.",
            source: "startup",
          },
        });
        continue;
      }

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
        lifecycle: "restoring",
        activatedAt: entry.lifecycle === "activating" ? Date.now() : entry.activatedAt ?? Date.now(),
        refreshPending: true,
        operationStatus: "validating Discord thread",
      });
      this.emitLifecycle("restore_started", {
        symbol: entry.symbol,
        threadId: thread.threadId,
      });
    }

    this.isStarted = true;
    this.startActivationWatchdog();
    this.emitLifecycle("runtime_started", {
      details: {
        activeSymbolCount: this.watchlistStore.getActiveEntries().length,
        startupRestoreInProgress: true,
      },
    });

    for (const entry of this.watchlistStore.getActiveEntries()) {
      if (entry.lifecycle === "activation_failed") {
        continue;
      }

      if (entry.discordThreadId) {
        try {
          if (!this.isEntryActive(entry.symbol)) {
            continue;
          }
          await this.refreshLevelsIfNeeded(entry.symbol, Date.now());
          if (!this.isEntryActive(entry.symbol)) {
            continue;
          }
          if (!this.options.levelStore.getLevels(entry.symbol)) {
            await this.seedLevelsForSymbol(entry.symbol, { graceOnTimeout: true });
          }
          if (!this.isEntryActive(entry.symbol)) {
            continue;
          }
          this.setEntryOperation(entry.symbol, "posting startup snapshot");
          await this.postLevelSnapshot(entry.symbol, entry.discordThreadId, Date.now());
          this.emitLifecycle("restore_completed", {
            symbol: entry.symbol,
            threadId: entry.discordThreadId,
          });
          await this.restartMonitoringWithReadyEntriesOnly();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (this.options.levelStore.getLevels(entry.symbol) && entry.discordThreadId) {
            this.setEntryOperation(entry.symbol, "posting startup snapshot");
            await this.postLevelSnapshot(entry.symbol, entry.discordThreadId, Date.now());
            this.emitLifecycle("restore_completed", {
              symbol: entry.symbol,
              threadId: entry.discordThreadId,
              details: {
                recoveredAfterTimeout: true,
              },
            });
            await this.restartMonitoringWithReadyEntriesOnly();
          } else {
            this.watchlistStore.patchEntry(entry.symbol, {
              lifecycle: "refresh_pending",
              refreshPending: true,
              lastError: message,
              operationStatus: "restore needs retry",
            });
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
            await this.restartMonitoringWithReadyEntriesOnly();
          }
        }
      }
    }

    this.persistWatchlist();
    await this.restartMonitoring();
    this.emitLifecycle("runtime_started", {
      details: {
        activeSymbolCount: this.watchlistStore.getActiveEntries().length,
        startupRestoreInProgress: false,
      },
    });
  }

  async stop(): Promise<void> {
    this.stopActivationWatchdog();
    for (const timer of this.pendingLevelTouchAlerts.values()) {
      clearTimeout(timer);
    }
    this.pendingLevelTouchAlerts.clear();
    await this.options.monitor.stop();
    this.isStarted = false;
  }

  getActiveEntries(): WatchlistEntry[] {
    return this.watchlistStore.getActiveEntries();
  }

  getRecentActivity(limit = 30): ManualWatchlistActivityEntry[] {
    return this.recentActivity.slice(0, Math.max(0, limit));
  }

  getRuntimeHealth(): ManualWatchlistRuntimeHealth {
    const lifecycleCounts: Record<WatchlistLifecycleState, number> = {
      inactive: 0,
      activating: 0,
      restoring: 0,
      activation_failed: 0,
      active: 0,
      stale: 0,
      refresh_pending: 0,
      extension_pending: 0,
    };

    for (const entry of this.watchlistStore.getEntries()) {
      if (!entry.active) {
        lifecycleCounts.inactive += 1;
        continue;
      }
      const lifecycle = entry.lifecycle ?? (entry.active ? "active" : "inactive");
      lifecycleCounts[lifecycle] += 1;
    }
    const pendingActivationCount = [...this.pendingActivations.entries()].filter(
      ([symbol, pending]) =>
        this.isActivationCurrent(symbol, pending.epoch) &&
        this.watchlistStore.getEntry(symbol)?.active,
    ).length;

    return {
      isStarted: this.isStarted,
      pendingActivationCount,
      lifecycleCounts,
      lastPriceUpdateAt: this.lastPriceUpdateAt,
      lastPriceUpdateSymbol: this.lastPriceUpdateSymbol,
      lastThreadPostAt: this.lastThreadPostAt,
      lastThreadPostSymbol: this.lastThreadPostSymbol,
      lastThreadPostKind: this.lastThreadPostKind,
      lastDeliveryFailureAt: this.lastDeliveryFailureAt,
      lastDeliveryFailureSymbol: this.lastDeliveryFailureSymbol,
      lastDeliveryFailureMessage: this.lastDeliveryFailureMessage,
      stuckActivations: this.getStuckActivations(),
      aiCommentary: {
        serviceAvailable: Boolean(this.options.aiCommentaryService),
        generatedCount: this.aiCommentaryGeneratedCount,
        failedCount: this.aiCommentaryFailedCount,
        lastGeneratedAt: this.lastAiCommentaryGeneratedAt,
        lastGeneratedSymbol: this.lastAiCommentaryGeneratedSymbol,
        lastGeneratedModel: this.lastAiCommentaryGeneratedModel,
        lastFailedAt: this.lastAiCommentaryFailedAt,
        lastFailedSymbol: this.lastAiCommentaryFailedSymbol,
        lastFailureMessage: this.lastAiCommentaryFailureMessage,
        route: "symbol_recaps_and_live_alert_ai_reads",
      },
    };
  }

  private async performActivation(
    input: ManualWatchlistActivationInput,
    rollbackEntries: WatchlistEntry[],
    preparedThread?: DiscordThreadRoutingResult | null,
    activationEpoch?: number,
  ): Promise<WatchlistEntry> {
    const symbol = normalizeSymbol(input.symbol);
    const existing = this.watchlistStore.getEntry(symbol);

    try {
      this.emitLifecycle("activation_started", {
        symbol,
        threadId: preparedThread?.threadId ?? existing?.discordThreadId ?? null,
      });
      if (preparedThread?.created) {
        await this.maybePostStockContext(symbol, preparedThread.threadId, Date.now());
      }
      this.assertActivationCurrent(symbol, activationEpoch);
      if (this.options.levelStore.getLevels(symbol)) {
        this.setEntryOperation(symbol, "levels ready");
      } else if (preparedThread) {
        this.setEntryOperation(symbol, "loading candles and building levels");
        const seedOperation = this.beginSeedLevelsForSymbol(symbol);
        try {
          if (this.levelSeedTimeoutMs <= 0) {
            await seedOperation;
          } else {
            await withTimeout(
              seedOperation,
              this.levelSeedTimeoutMs,
              () => new LevelSeedTimeoutError(symbol, this.levelSeedTimeoutMs),
            );
          }
        } catch (error) {
          if (
            error instanceof LevelSeedTimeoutError &&
            this.queuedActivationSeedGraceTimeoutMs > 0
          ) {
            await withTimeout(
              seedOperation,
              this.queuedActivationSeedGraceTimeoutMs,
              () =>
                new LevelSeedTimeoutError(
                  symbol,
                  this.levelSeedTimeoutMs + this.queuedActivationSeedGraceTimeoutMs,
                ),
            );
          } else {
            throw error;
          }
        }
      } else {
        await this.seedLevelsForSymbol(symbol);
      }
      if (preparedThread && !this.isEntryActive(symbol)) {
        throw new ActivationCancelledError(symbol);
      }
      this.assertActivationCurrent(symbol, activationEpoch);
      const threadId =
        preparedThread?.threadId ??
        (
          await this.options.discordAlertRouter.ensureThread(
            symbol,
            existing?.discordThreadId,
          )
        ).threadId;
      if (!preparedThread) {
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
        lastError: null,
        operationStatus: "posting level snapshot",
      });

      try {
        await this.postLevelSnapshot(symbol, threadId, Date.now());
      } catch (error) {
        if (preparedThread) {
          throw error;
        }

        await delay(INITIAL_SNAPSHOT_RETRY_DELAY_MS);
        await this.postLevelSnapshot(symbol, threadId, Date.now());
      }
      this.assertActivationCurrent(symbol, activationEpoch);
      this.persistWatchlist();
      await this.restartMonitoring();
      this.emitLifecycle("activation_completed", {
        symbol,
        threadId,
      });
      return this.watchlistStore.getEntry(symbol) ?? entry;
    } catch (error) {
      if (error instanceof ActivationCancelledError) {
        this.persistWatchlist();
        this.emitLifecycle("activation_failed", {
          symbol,
          threadId: preparedThread?.threadId ?? existing?.discordThreadId ?? null,
          details: {
            error: error.message,
          },
        });
        throw error;
      }

      this.watchlistStore.setEntries(rollbackEntries);
      this.activeSnapshotState.delete(symbol);
      const message = error instanceof Error ? error.message : String(error);
      if (preparedThread) {
        this.watchlistStore.upsertManualEntry({
          symbol,
          note: input.note,
          discordThreadId: preparedThread.threadId,
          active: true,
          lifecycle: "activation_failed",
          activatedAt: Date.now(),
          refreshPending: false,
          lastError: message,
          operationStatus: "activation failed",
        });
        this.emitLifecycle("activation_marked_failed", {
          symbol,
          threadId: preparedThread.threadId,
          details: {
            error: message,
          },
        });
      }
      this.persistWatchlist();
      this.emitLifecycle("activation_failed", {
        symbol,
        threadId: preparedThread?.threadId ?? existing?.discordThreadId ?? null,
        details: {
          error: message,
        },
      });
      throw error;
    }
  }

  private shouldAutoRetryActivation(error: unknown, attempt: number): boolean {
    return error instanceof LevelSeedTimeoutError && attempt < this.activationMaxAutoRetries;
  }

  private buildRetryThread(thread: DiscordThreadRoutingResult): DiscordThreadRoutingResult {
    return {
      threadId: thread.threadId,
      reused: true,
      recovered: thread.recovered,
      created: false,
    };
  }

  private async runQueuedActivationWithRetry(
    input: ManualWatchlistActivationInput,
    initialRollbackEntries: WatchlistEntry[],
    thread: DiscordThreadRoutingResult,
    activationEpoch: number,
  ): Promise<void> {
    const symbol = normalizeSymbol(input.symbol);
    let attempt = 0;
    let retryThread = thread;
    let rollbackEntries = initialRollbackEntries;

    while (true) {
      try {
        await this.performActivation(input, rollbackEntries, retryThread, activationEpoch);
        return;
      } catch (error) {
        if (!this.shouldAutoRetryActivation(error, attempt)) {
          throw error;
        }

        attempt += 1;
        const message = error instanceof Error ? error.message : String(error);
        const retryMessage = `Retrying after level seeding timeout (${attempt}/${this.activationMaxAutoRetries}).`;
        this.watchlistStore.upsertManualEntry({
          symbol,
          note: input.note,
          discordThreadId: thread.threadId,
          active: true,
          lifecycle: "activation_failed",
          activatedAt: this.watchlistStore.getEntry(symbol)?.activatedAt ?? Date.now(),
          refreshPending: false,
          lastError: `${retryMessage} Last error: ${message}`,
          operationStatus: "waiting to retry activation",
        });
        this.persistWatchlist();
        this.emitLifecycle("activation_retry_scheduled", {
          symbol,
          threadId: thread.threadId,
          details: {
            attempt,
            maxRetries: this.activationMaxAutoRetries,
            retryDelayMs: this.activationAutoRetryDelayMs,
            error: message,
          },
        });

        if (this.activationAutoRetryDelayMs > 0) {
          await delay(this.activationAutoRetryDelayMs);
        }
        this.assertActivationCurrent(symbol, activationEpoch);

        this.watchlistStore.upsertManualEntry({
          symbol,
          note: input.note,
          discordThreadId: thread.threadId,
          active: true,
          lifecycle: "activating",
          activatedAt: this.watchlistStore.getEntry(symbol)?.activatedAt ?? Date.now(),
          refreshPending: true,
          lastError: retryMessage,
          operationStatus: "retrying activation",
        });
        this.persistWatchlist();
        retryThread = this.buildRetryThread(thread);
        rollbackEntries = this.watchlistStore.getEntries();
      }
    }
  }

  async activateSymbol(input: ManualWatchlistActivationInput): Promise<WatchlistEntry> {
    return this.performActivation(input, this.watchlistStore.getEntries());
  }

  async queueActivation(input: ManualWatchlistActivationInput): Promise<WatchlistEntry> {
    const symbol = normalizeSymbol(input.symbol);
    const existing = this.watchlistStore.getEntry(symbol);
    const pending = this.pendingActivations.get(symbol);

    if (pending && existing?.active && this.isActivationCurrent(symbol, pending.epoch)) {
      return (
        existing ??
        this.watchlistStore.upsertManualEntry({
          symbol,
          note: input.note,
          active: true,
          lifecycle: "activating",
          activatedAt: Date.now(),
          refreshPending: true,
          lastError: null,
        })
      );
    }

    if (existing?.active && existing.lifecycle === "active") {
      return existing;
    }

    const activationEpoch = this.nextActivationEpoch(symbol);
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
      activatedAt: Date.now(),
      refreshPending: true,
      lastError: null,
      operationStatus: "queued for activation",
    });
    this.persistWatchlist();
    this.emitLifecycle("activation_queued", {
      symbol,
      threadId: thread.threadId,
    });

    const activationTask = this.runQueuedActivationWithRetry(
      { symbol, note: input.note },
      rollbackEntries,
      thread,
      activationEpoch,
    )
      .then(() => undefined)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[ManualWatchlistRuntimeManager] Background activation failed for ${symbol}: ${message}`,
        );
      })
      .finally(() => {
        if (this.pendingActivations.get(symbol)?.epoch === activationEpoch) {
          this.pendingActivations.delete(symbol);
        }
      });

    this.pendingActivations.set(symbol, { promise: activationTask, epoch: activationEpoch });
    return queuedEntry;
  }

  async refreshSymbolLevels(symbolInput: string): Promise<WatchlistEntry> {
    const symbol = normalizeSymbol(symbolInput);
    const entry = this.watchlistStore.getEntry(symbol);
    if (!entry?.active) {
      throw new Error(`${symbol} is not active.`);
    }

    this.watchlistStore.patchEntry(symbol, {
      lifecycle: "refresh_pending",
      refreshPending: true,
      operationStatus: "manual level refresh started",
      lastError: null,
    });
    this.persistWatchlist();
    await this.seedLevelsForSymbol(symbol, { force: true });
    if (entry.discordThreadId) {
      await this.postLevelSnapshot(symbol, entry.discordThreadId, Date.now());
    }
    await this.restartMonitoring();
    this.persistWatchlist();
    return this.watchlistStore.getEntry(symbol) ?? entry;
  }

  async repostLevelSnapshot(symbolInput: string): Promise<WatchlistEntry> {
    const symbol = normalizeSymbol(symbolInput);
    const entry = this.watchlistStore.getEntry(symbol);
    if (!entry?.active) {
      throw new Error(`${symbol} is not active.`);
    }
    if (!entry.discordThreadId) {
      throw new Error(`${symbol} does not have a Discord thread yet.`);
    }
    if (!this.options.levelStore.getLevels(symbol)) {
      this.watchlistStore.patchEntry(symbol, {
        lifecycle: "refresh_pending",
        refreshPending: true,
        operationStatus: "building levels before repost",
      });
      await this.seedLevelsForSymbol(symbol);
    }

    this.activeSnapshotState.delete(symbol);
    await this.postLevelSnapshot(symbol, entry.discordThreadId, Date.now());
    this.persistWatchlist();
    return this.watchlistStore.getEntry(symbol) ?? entry;
  }

  async deactivateSymbol(symbol: string): Promise<WatchlistEntry | null> {
    const normalizedSymbol = normalizeSymbol(symbol);
    this.nextActivationEpoch(normalizedSymbol);
    this.pendingActivations.delete(normalizedSymbol);
    const entry = this.watchlistStore.deactivateSymbol(normalizedSymbol);
    if (!entry) {
      return null;
    }

    this.activeSnapshotState.delete(normalizedSymbol);
    this.extensionRefreshInFlight.delete(normalizedSymbol);
    this.recapState.delete(normalizedSymbol);
    this.continuityState.delete(normalizedSymbol);
    this.followThroughStatePosts.delete(normalizedSymbol);
    this.followThroughPostState.delete(normalizedSymbol);
    this.intelligentAlertPostState.delete(normalizedSymbol);
    this.liveThreadPostState.delete(normalizedSymbol);
    this.narrationBurstState.delete(normalizedSymbol);
    this.storyCriticalState.delete(normalizedSymbol);
    this.deliveryPressureState.delete(normalizedSymbol);
    this.persistWatchlist();
    await this.restartMonitoring();
    this.emitLifecycle("deactivated", {
      symbol: entry.symbol,
      threadId: entry.discordThreadId ?? null,
    });
    return entry;
  }
}
