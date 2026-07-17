import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { CandleFetchService, type HistoricalFetchRequest } from "../market-data/candle-fetch-service.js";
import type { Candle, CandleProviderResponse, CandleTimeframe } from "../market-data/candle-types.js";
import type {
  BuildTradeCandleContextRequest,
  TradeCandleContext,
} from "../market-data/trade-candle-context.js";
import { LevelEngine } from "../levels/level-engine.js";
import { resolveLevelRuntimeSettings } from "../levels/level-runtime-mode.js";
import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";
import { buildSpecialLevelCandidates } from "../levels/special-level-builder.js";
import { decideLevelRefresh } from "../levels/level-refresh-policy.js";
import { assessFinalLevelImportance } from "./level-importance.js";
import { AlertIntelligenceEngine } from "../alerts/alert-intelligence-engine.js";
import {
  buildVisibleMarketStructureDiscordLines,
  formatLevelLadderMessage,
  formatContinuityUpdateAsPayload,
  formatFollowThroughStateUpdateAsPayload,
  formatFollowThroughUpdateAsPayload,
  formatIntelligentAlertAsPayload,
  formatMarketStructureUpdateAsPayload,
  formatSymbolRecapAsPayload,
  type DiscordAlertRouter,
} from "../alerts/alert-router.js";
import type { TraderCommentaryService } from "../ai/trader-commentary-service.js";
import type { TradersLinkAiReadService } from "../ai/traderslink-ai-read-service.js";
import {
  buildTradersLinkAiCompletedSessionWindow,
  mergeTradersLinkAiIntradayCandles,
  type TradersLinkAiReadPriceActionContext,
} from "../ai/traderslink-ai-read-price-action.js";
import type {
  TradersLinkAiReadCostLedger,
  TradersLinkAiReadCostTrigger,
} from "../ai/traderslink-ai-read-cost-ledger.js";
import {
  buildFinnhubThreadPreviewPayload,
  resolveStockContextCurrentPrice,
} from "../stock-context/finnhub-thread-preview.js";
import {
  buildLiveWatchlistLevelsUnavailablePatch,
  buildLiveWatchlistSnapshotPatch,
  buildLiveWatchlistPullbackReadPatch,
  buildLiveWatchlistStatusPatch,
  buildLiveWatchlistTechnicalContextPatch,
  buildLiveWatchlistTickerDataPatch,
  buildTradersLinkAiReadPatch,
  buildTradersLinkAiReadVisibilityPatch,
  createLiveWatchlistPublisherFromEnv,
} from "../live-watchlist/live-watchlist-publisher.js";
import {
  DEFAULT_LIVE_WATCHLIST_AUDIT_ARCHIVE_FILE,
  LiveWatchlistAuditArchivePersistence,
} from "../live-watchlist/live-watchlist-audit-archive.js";
import {
  deriveRecentWebsiteArticleCatalystFreshness,
  lookupRecentWebsiteArticlesForSymbol,
  publishRecentWebsiteArticlesForSymbol,
  type RecentWebsiteArticleCatalystFreshness,
  type RecentWebsiteArticleExecFile,
} from "../live-watchlist/recent-website-articles.js";
import {
  lookupPressReleaseCatalystContextForSymbol,
  newYorkDateKeyForTimestamp,
  type PressReleaseCatalystContext,
  type PressReleaseCatalystExecFile,
} from "../catalysts/press-release-catalyst-context.js";
import type {
  LiveWatchlistCardPatch,
  LiveWatchlistPublisher,
  LiveWatchlistStatus,
  LiveWatchlistTickerDataPatch,
  TradersLinkAiReadPayload,
} from "../live-watchlist/live-watchlist-types.js";
import type { LiveWatchlistPullbackVolumeRead } from "../live-watchlist/pullback-read.js";
import { resolveLiveWatchlistTradeSetupReadMode } from "../live-watchlist/trade-setup-read.js";
import {
  buildTechnicalContextFromCandles,
  refreshTechnicalContextForPrice,
} from "../technical-context/technical-context.js";
import { calculateCompletedFiveMinuteAtr } from "../technical-context/average-true-range.js";
import type { TechnicalContext } from "../technical-context/technical-context-types.js";
import {
  isSignalCategoryLiveEnabled,
  resolvePrimarySignalCategoryForAlert,
  routeMessageKindToSignalCategory,
} from "../signals/signal-category-routing.js";
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
  PotentialMoveRead,
} from "../alerts/alert-types.js";
import { deriveTraderFollowThroughContext, describeZoneStrength } from "../alerts/trader-message-language.js";
import { LevelStore } from "./level-store.js";
import type {
  LivePriceUpdate,
  MonitoringEvent,
  PracticalTradeStructureState,
  RuntimeMarketStructureSnapshot,
  TradersLinkAiReadBoundary,
  TradersLinkAiReadBoundaryState,
  WatchlistEntry,
  WatchlistLifecycleState,
} from "./monitoring-types.js";
import type { LivePriceProvider } from "./live-price-types.js";
import { buildOpportunityDiagnosticsLogEntry } from "./opportunity-diagnostics.js";
import { OpportunityRuntimeController } from "./opportunity-runtime-controller.js";
import type { OpportunityInterpretation } from "./opportunity-interpretation.js";
import type { EvaluatedOpportunity, OpportunityProgressUpdate } from "./opportunity-evaluator.js";
import { WatchlistMonitor } from "./watchlist-monitor.js";
import { WatchlistStatePersistence } from "./watchlist-state-persistence.js";
import { WatchlistStore } from "./watchlist-store.js";
import { LiveDerivedFiveMinuteCandleStore } from "./live-derived-technical-candles.js";
import {
  buildTradeSetupChartThesisRead,
  buildWatchlistChartThesisRead,
} from "./chart-thesis-engine.js";
import {
  getFreshFormalBosChochMarketStructureStoryKeys,
  getMaterialMarketStructureStoryKeys,
  MarketStructureStoryMemory,
  type MarketStructureStoryMemorySnapshot,
  type MarketStructureStoryDecision,
} from "./market-structure-story-memory.js";
import type {
  ManualWatchlistLifecycleEvent,
  ManualWatchlistLifecycleEventName,
  ManualWatchlistLifecycleListener,
} from "./manual-watchlist-runtime-events.js";
import {
  buildAiSignalStoryKey,
  buildFollowThroughStoryRecord,
  buildIntelligentAlertStoryRecord,
  buildThreadStoryPhaseAreaKey,
  buildThreadStoryPhaseRecord,
  decideCriticalLivePost,
  decideIntelligentAlertPost,
  decideNarrationBurst,
  decideAiSignalPost,
  decideFollowThroughPost,
  decideOptionalLivePost,
  decideThreadStoryPhasePost,
  deriveThreadStoryPhase,
  pruneAiSignalStoryRecords,
  pruneFollowThroughStoryRecords,
  pruneIntelligentAlertStoryRecords,
  pruneThreadStoryPhaseRecords,
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
  type ThreadStoryPhaseRecord,
} from "./live-thread-post-policy.js";

export type MarketStructureStandalonePostMode = "off" | "normal" | "testing";
export type LiveWatchlistLevelProvenanceMode = "off" | "observe" | "active";

export const LIVE_WATCHLIST_LEVEL_PROVENANCE_MODE_ENV =
  "LIVE_WATCHLIST_LEVEL_PROVENANCE_MODE";

export function resolveLiveWatchlistLevelProvenanceMode(
  value: string | null | undefined,
): LiveWatchlistLevelProvenanceMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "observe" || normalized === "active") {
    return normalized;
  }
  return "off";
}

export function resolveMarketStructureStandalonePostMode(
  value: MarketStructureStandalonePostMode | string | null | undefined,
): MarketStructureStandalonePostMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "off" || normalized === "0" || normalized === "false") {
    return "off";
  }
  if (normalized === "testing" || normalized === "test" || normalized === "diagnostic") {
    return "testing";
  }
  return "normal";
}

export type ManualWatchlistRuntimeManagerOptions = {
  candleFetchService: CandleFetchService;
  startupCachedCandleFetchService?: CandleFetchService | null;
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
  fastLevelClearCoalesceMs?: number;
  stockContextProvider?: {
    getThreadPreview(symbolInput: string): Promise<StockContextPreview>;
  } | null;
  marketStructureStoryMemoryPath?: string | null;
  marketStructureStandalonePostMode?: MarketStructureStandalonePostMode | string | null;
  liveWatchlistPublisher?: LiveWatchlistPublisher | null;
  tradersLinkAiReadService?: TradersLinkAiReadService | null;
  tradersLinkAiReadCostLedger?: TradersLinkAiReadCostLedger | null;
  initialTradersLinkAiReadDailyCostBudget?: {
    enabled: boolean;
    dailyLimitUsd: number;
  };
  tradersLinkAiReadStartupRefreshEnabled?: boolean;
  initialLiveTraderReadCardVisible?: boolean;
  initialPotentialGainCardVisible?: boolean;
  levelProvenanceMode?: LiveWatchlistLevelProvenanceMode | string | null;
  pullbackReadEnabled?: boolean;
  pullbackReadPollIntervalMs?: number;
  recentIntradayCandleFetchService?: Pick<CandleFetchService, "fetchCandles" | "getProviderName"> | null;
  tradersLinkAiReadHistoricalCandleLoader?: (
    request: BuildTradeCandleContextRequest,
  ) => Promise<TradeCandleContext>;
  recentWebsiteArticlesExecFileImpl?: RecentWebsiteArticleExecFile;
  pressReleaseCatalystContextEnabled?: boolean;
  pressReleaseCatalystExecFileImpl?: PressReleaseCatalystExecFile;
  autoCleanReadGenerator?: ((input: ManualWatchlistAutoCleanReadInput) => Promise<{
    id?: string;
    text?: string;
    model?: string;
  } | void>) | null;
};

const TRADERSLINK_AI_READ_RANGE_EDGE_PROGRESS = 0.85;
const DEFAULT_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD = 1;
export type TradersLinkAiReadRequestedTrigger = TradersLinkAiReadCostTrigger | "automatic";

export type TradersLinkAiReadRefreshState = TradersLinkAiReadBoundaryState;

export function buildTradersLinkAiReadRefreshState(
  read: Pick<
    TradersLinkAiReadPayload,
    | "generatedAt"
    | "currentPrice"
    | "needsToHold"
    | "cautionBelow"
    | "breakoutContinuation"
    | "momentumFailure"
    | "mustClear"
    | "targets"
    | "downsideCheckpoints"
  >,
): TradersLinkAiReadRefreshState {
  const positivePrice = (price: number | null): number | null =>
    typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
  const upsidePrices = [
    read.breakoutContinuation.price,
    ...read.targets.map((target) => target.price),
  ].map(positivePrice).filter((price): price is number => price !== null);
  const downsidePrices = [
    read.momentumFailure.price,
    ...read.downsideCheckpoints.map((checkpoint) => checkpoint.price),
  ].map(positivePrice).filter((price): price is number => price !== null);
  const primaryBoundaries: TradersLinkAiReadBoundary[] = [
    { role: "needsToHold", side: "downside", impact: "hold", price: read.needsToHold.price },
    { role: "cautionBelow", side: "downside", impact: "caution", price: read.cautionBelow.price },
    { role: "momentumFailure", side: "downside", impact: "invalidates", price: read.momentumFailure.price },
    { role: "mustClear", side: "upside", impact: "improves", price: read.mustClear.price },
    { role: "breakoutContinuation", side: "upside", impact: "improves", price: read.breakoutContinuation.price },
  ];
  const boundaries: TradersLinkAiReadBoundary[] = [
    ...primaryBoundaries,
    ...read.targets.map((target): TradersLinkAiReadBoundary => ({
      role: "upsideTarget" as const,
      side: "upside" as const,
      impact: "exhausts" as const,
      price: target.price,
    })),
    ...read.downsideCheckpoints.map((checkpoint): TradersLinkAiReadBoundary => ({
      role: "downsideCheckpoint" as const,
      side: "downside" as const,
      impact: "exhausts" as const,
      price: checkpoint.price,
    })),
  ].flatMap((boundary): TradersLinkAiReadBoundary[] => {
    const price = positivePrice(boundary.price);
    return price === null ? [] : [{ ...boundary, price }];
  });
  return {
    generatedAt: read.generatedAt,
    currentPrice: read.currentPrice,
    upperBoundary: upsidePrices.length > 0 ? Math.max(...upsidePrices) : null,
    lowerBoundary: downsidePrices.length > 0 ? Math.min(...downsidePrices) : null,
    ...(boundaries.length > 0 ? { boundaries } : {}),
  };
}

export function parseArchivedTradersLinkAiReadRefreshState(
  body: unknown,
): TradersLinkAiReadRefreshState | null {
  if (typeof body !== "string" || body.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const archivedLevel = (value: unknown, label: string) => {
      const candidate = value as Record<string, unknown> | undefined;
      return {
        label,
        price: typeof candidate?.price === "number" ? candidate.price : null,
        rationale: "Recovered from the published AI Read.",
      };
    };
    const breakoutContinuation = archivedLevel(parsed.breakoutContinuation, "Archived breakout continuation");
    const momentumFailure = archivedLevel(parsed.momentumFailure, "Archived momentum failure");
    const targets = Array.isArray(parsed.targets) ? parsed.targets : [];
    const downsideCheckpoints = Array.isArray(parsed.downsideCheckpoints)
      ? parsed.downsideCheckpoints
      : [];
    const archivedTargets = (values: unknown[]) => values
      .map((value) => value as Record<string, unknown>)
      .filter((value) => typeof value?.price === "number")
      .map((value) => ({
        label: typeof value.label === "string" ? value.label : "Archived target",
        price: value.price as number,
        condition: typeof value.condition === "string" ? value.condition : "Recovered from the published AI Read.",
      }));
    if (
      typeof parsed.generatedAt !== "number" ||
      !Number.isFinite(parsed.generatedAt) ||
      typeof parsed.currentPrice !== "number" ||
      !Number.isFinite(parsed.currentPrice) ||
      parsed.currentPrice <= 0 ||
      typeof breakoutContinuation.price !== "number" ||
      typeof momentumFailure.price !== "number"
    ) {
      return null;
    }
    return buildTradersLinkAiReadRefreshState({
      generatedAt: parsed.generatedAt,
      currentPrice: parsed.currentPrice,
      needsToHold: archivedLevel(parsed.needsToHold, "Archived needs-to-hold"),
      cautionBelow: archivedLevel(parsed.cautionBelow, "Archived caution below"),
      breakoutContinuation,
      momentumFailure,
      mustClear: archivedLevel(parsed.mustClear, "Archived must clear"),
      targets: archivedTargets(targets),
      downsideCheckpoints: archivedTargets(downsideCheckpoints),
    });
  } catch {
    return null;
  }
}

export function decideTradersLinkAiReadRefresh(args: {
  previous: TradersLinkAiReadRefreshState | null;
  currentPrice: number;
  dataAsOf: number;
  force: boolean;
  requestedTrigger: TradersLinkAiReadRequestedTrigger;
  allowInitialGeneration?: boolean;
}): {
  shouldRefresh: boolean;
  trigger: TradersLinkAiReadCostTrigger;
  automaticRefreshRegime: string | null;
} {
  const previous = args.previous;
  if (!previous) {
    return {
      shouldRefresh: args.force || args.allowInitialGeneration !== false,
      trigger: args.requestedTrigger === "automatic" ? "startup" : args.requestedTrigger,
      automaticRefreshRegime: null,
    };
  }
  const crossedTypedInvalidation = (previous.boundaries ?? []).find(
    (boundary) =>
      boundary.impact === "invalidates" &&
      boundary.side === "downside" &&
      previous.currentPrice >= boundary.price &&
      args.currentPrice < boundary.price,
  ) ?? null;
  const crossedUpperBoundary =
    previous.upperBoundary !== null &&
    previous.currentPrice <= previous.upperBoundary &&
    args.currentPrice > previous.upperBoundary;
  const crossedLowerBoundary =
    previous.lowerBoundary !== null &&
    previous.currentPrice >= previous.lowerBoundary &&
    args.currentPrice < previous.lowerBoundary;
  const crossedAnalysisBoundary =
    crossedTypedInvalidation !== null || crossedUpperBoundary || crossedLowerBoundary;
  const upperProgress = previous.upperBoundary !== null && previous.upperBoundary > previous.currentPrice
    ? (args.currentPrice - previous.currentPrice) /
      (previous.upperBoundary - previous.currentPrice)
    : Number.NEGATIVE_INFINITY;
  const lowerProgress = previous.lowerBoundary !== null && previous.lowerBoundary < previous.currentPrice
    ? (previous.currentPrice - args.currentPrice) /
      (previous.currentPrice - previous.lowerBoundary)
    : Number.NEGATIVE_INFINITY;
  const reachedRangeEdge =
    !crossedAnalysisBoundary &&
    (upperProgress >= TRADERSLINK_AI_READ_RANGE_EDGE_PROGRESS ||
      lowerProgress >= TRADERSLINK_AI_READ_RANGE_EDGE_PROGRESS);
  const trigger: TradersLinkAiReadCostTrigger = args.requestedTrigger === "automatic"
    ? crossedAnalysisBoundary
      ? "boundary_cross"
      : reachedRangeEdge
        ? "range_edge"
        : "scheduled"
    : args.requestedTrigger;
  const automaticRefreshRegime = args.requestedTrigger === "automatic" &&
    (crossedAnalysisBoundary || reachedRangeEdge)
    ? crossedTypedInvalidation
      ? `${crossedTypedInvalidation.side}:${crossedTypedInvalidation.role}:${crossedTypedInvalidation.price}`
      : crossedUpperBoundary || (reachedRangeEdge && upperProgress >= TRADERSLINK_AI_READ_RANGE_EDGE_PROGRESS)
      ? `upper:${previous.upperBoundary ?? "none"}`
      : `lower:${previous.lowerBoundary ?? "none"}`
    : null;
  const alreadyServedSameRegime =
    !args.force &&
    automaticRefreshRegime !== null &&
    previous.lastAutomaticRefreshRegime === automaticRefreshRegime;
  return {
    shouldRefresh:
      args.force || ((!alreadyServedSameRegime) && (reachedRangeEdge || crossedAnalysisBoundary)),
    trigger,
    automaticRefreshRegime,
  };
}

export type ManualWatchlistAutoCleanReadInput = {
  symbol: string;
  currentPrice: string;
  ladderText: string;
  aiPromptNotes?: string;
};

export type ManualWatchlistHistoricalLookbacks = {
  daily: number;
  "4h": number;
  "5m": number;
};

type PriorRegularCloseReference = {
  price: number;
  source: string;
};

export type ManualWatchlistActivationInput = {
  symbol: string;
  note?: string;
  source?: "manual" | "auto";
  autoSession?: "premarket" | "regular" | "postmarket";
};

function watchlistTagsForActivation(input: ManualWatchlistActivationInput): string[] {
  if (input.source !== "auto") {
    return ["manual"];
  }
  return [
    "auto",
    input.autoSession === "postmarket" ? "auto-postmarket" : "auto-main",
  ];
}

export type ManualWatchlistRuntimeHealth = {
  isStarted: boolean;
  pendingActivationCount: number;
  liveTraderReadCardVisible: boolean;
  potentialGainCardVisible: boolean;
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
  providerHealth: ManualWatchlistProviderHealth;
  aiCommentary: ManualWatchlistAiCommentaryHealth;
  mondayReview: ManualWatchlistMondayReviewHealth;
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

export type ManualWatchlistMondayReviewHealth = {
  postBudgetStatus: "calm" | "busy" | "optional_heavy" | "needs_attention";
  postsLast15m: number;
  criticalPostsLast15m: number;
  optionalPostsLast15m: number;
  lastWhyPosted: string | null;
  symbolBudgets: Array<{
    symbol: string;
    postsLast15m: number;
    criticalPostsLast15m: number;
    optionalPostsLast15m: number;
    status: "calm" | "busy" | "optional_heavy";
  }>;
  checklist: string[];
};

export type ManualWatchlistProviderHealth = {
  priceFeedStatus: "live" | "stale" | "waiting";
  lastPriceAgeMs: number | null;
  lastPriceSymbol: string | null;
  discordStatus: "ready" | "recent_failure" | "waiting";
  lastPostAgeMs: number | null;
  historicalDataStatus: "active" | "waiting" | "degraded";
  pendingActivationCount: number;
  stuckActivationCount: number;
  seedStats: ManualWatchlistLevelSeedStats;
  startupCache: ManualWatchlistStartupCacheHealth;
  restartReadiness: ManualWatchlistRestartReadiness[];
  notes: string[];
};

export type ManualWatchlistStartupCacheHealth = {
  enabled: boolean;
  warmingSymbols: string[];
  restoredSymbols: Array<{
    symbol: string;
    restoredAt: number;
    ageMs: number;
  }>;
  blockedSnapshotSymbols: Array<{
    symbol: string;
    reason: string;
  }>;
  discordSnapshotPolicy: "fresh_candles_required";
};

export type ManualWatchlistLevelSeedStats = {
  attempts: number;
  successes: number;
  failures: number;
  timeouts: number;
  inFlight: number;
  averageDurationMs: number | null;
  lastDurationMs: number | null;
  lastSymbol: string | null;
  lastStartedAt: number | null;
  lastCompletedAt: number | null;
  lastError: string | null;
};

export type ManualWatchlistRestartReadiness = {
  symbol: string;
  lifecycle: WatchlistLifecycleState;
  levelStatus: "ready" | "seeding" | "waiting" | "failed";
  priceStatus: "fresh" | "stale" | "waiting";
  discordStatus: "ready" | "missing_thread";
  operationStatus: string | null;
  lastError: string | null;
  lastPriceAgeMs: number | null;
  lastLevelPostAgeMs: number | null;
  reason: string;
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

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function resolvePriorRegularCloseReference(
  preview: StockContextPreview,
): PriorRegularCloseReference | null {
  const yahooPreviousClose = finitePositiveNumber(preview.yahoo?.quote?.regularMarketPreviousClose);
  if (yahooPreviousClose !== null) {
    return { price: yahooPreviousClose, source: "Yahoo regular close" };
  }

  const finnhubPreviousClose = finitePositiveNumber(preview.quote?.pc);
  if (finnhubPreviousClose !== null) {
    return { price: finnhubPreviousClose, source: "Finnhub regular close" };
  }

  return null;
}

function resolveInitialLiveTraderReadCardVisible(): boolean {
  const raw = process.env.TRADERSLINK_WATCHLIST_TRADER_READ_VISIBLE?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

function resolveInitialPotentialGainCardVisible(): boolean {
  const raw = process.env.TRADERSLINK_WATCHLIST_POTENTIAL_GAIN_VISIBLE?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

const NEW_YORK_TIMEZONE = "America/New_York";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const newYorkDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: NEW_YORK_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function newYorkParts(timestamp: number): {
  dateKey: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = newYorkDateFormatter.formatToParts(new Date(timestamp));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(byType.year);
  const month = Number(byType.month);
  const day = Number(byType.day);
  const hour = Number(byType.hour);
  const minute = Number(byType.minute);
  const second = Number(byType.second);

  return {
    dateKey: `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
      .toString()
      .padStart(2, "0")}`,
    year,
    month,
    day,
    hour,
    minute,
    second,
  };
}

function wallClockAsUtc(year: number, month: number, day: number, hour: number, minute: number, second = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

function newYorkWallClockTimestamp(dateKey: string, hour: number, minute: number): number {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-").map(Number);
  const year = yearRaw ?? 0;
  const month = monthRaw ?? 1;
  const day = dayRaw ?? 1;
  const targetWallClock = wallClockAsUtc(year, month, day, hour, minute);
  let guess = targetWallClock;

  for (let index = 0; index < 4; index += 1) {
    const parts = newYorkParts(guess);
    const observedWallClock = wallClockAsUtc(
      parts.year,
      parts.month,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const delta = targetWallClock - observedWallClock;
    guess += delta;
    if (delta === 0) {
      break;
    }
  }

  return guess;
}

function shiftDateKey(dateKey: string, days: number): string {
  const timestamp = Date.parse(`${dateKey}T12:00:00.000Z`);
  return new Date(timestamp + days * ONE_DAY_MS).toISOString().slice(0, 10);
}

export function resolveEodhdConfirmedLevelRequestEndTimeMs(
  timeframe: CandleTimeframe,
  nowMs: number = Date.now(),
): number | undefined {
  const currentNewYorkDateKey = newYorkParts(nowMs).dateKey;

  if (timeframe === "daily") {
    const previousNewYorkDateKey = shiftDateKey(currentNewYorkDateKey, -1);
    return Date.parse(`${previousNewYorkDateKey}T12:00:00.000Z`);
  }

  if (timeframe === "4h") {
    return newYorkWallClockTimestamp(currentNewYorkDateKey, 0, 0);
  }

  return undefined;
}

function isTechnicalContextDisplayReady(context: TechnicalContext): boolean {
  return (
    context.confidence !== "unavailable" &&
    context.vwap !== null &&
    context.ema9 !== null &&
    context.ema20 !== null &&
    context.aboveVwap !== null &&
    context.aboveEma9 !== null &&
    context.aboveEma20 !== null
  );
}

function technicalContextDataQualityFlags(flags: string[], candleCount: number): string[] {
  return candleCount > 0 ? flags.filter((flag) => !flag.startsWith("5m:")) : flags;
}

function bucketCandleTimestamp(timestamp: number, bucketMs: number): number {
  return Math.floor(timestamp / bucketMs) * bucketMs;
}

function isValidPullbackCandle(candle: Candle): boolean {
  return (
    Number.isFinite(candle.timestamp) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume) &&
    candle.open > 0 &&
    candle.high > 0 &&
    candle.low > 0 &&
    candle.close > 0 &&
    candle.volume >= 0 &&
    candle.high >= candle.low &&
    candle.high >= candle.open &&
    candle.high >= candle.close &&
    candle.low <= candle.open &&
    candle.low <= candle.close
  );
}

function normalizePullbackCandles(candles: Candle[]): Candle[] {
  const byTimestamp = new Map<number, Candle>();

  for (const candle of candles) {
    if (!isValidPullbackCandle(candle)) {
      continue;
    }

    const normalized = {
      ...candle,
      volume: Math.max(0, Math.round(candle.volume)),
    };
    const existing = byTimestamp.get(candle.timestamp);
    if (!existing || normalized.volume >= existing.volume) {
      byTimestamp.set(candle.timestamp, normalized);
    }
  }

  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

const TRADE_SETUP_FIVE_MINUTE_MS = 5 * 60 * 1000;
const TRADE_SETUP_FOUR_HOUR_BAR_COUNT = 48;

function completedFiveMinuteCandles(candles: Candle[], evaluatedAt: number): Candle[] {
  return normalizePullbackCandles(candles)
    .filter((candle) => candle.timestamp + TRADE_SETUP_FIVE_MINUTE_MS <= evaluatedAt);
}

function regularSessionCandlesForEvaluation(candles: Candle[], evaluatedAt: number): Candle[] {
  const evaluationDate = newYorkParts(evaluatedAt).dateKey;
  return candles.filter((candle) => {
    const parts = newYorkParts(candle.timestamp);
    const minutes = parts.hour * 60 + parts.minute;
    return parts.dateKey === evaluationDate && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  });
}

function aggregateTradeSetupFourHourBucket(candles: Candle[]): Candle {
  return {
    timestamp: candles[0]!.timestamp,
    open: candles[0]!.open,
    high: Math.max(...candles.map((candle) => candle.high)),
    low: Math.min(...candles.map((candle) => candle.low)),
    close: candles.at(-1)!.close,
    volume: candles.reduce((sum, candle) => sum + candle.volume, 0),
  };
}

export function buildLiveTradeSetupSeriesMap(params: {
  baseSeriesMap: Record<CandleTimeframe, CandleProviderResponse>;
  fiveMinuteCandles: Candle[];
  evaluatedAt: number;
}): Record<CandleTimeframe, CandleProviderResponse> {
  const completedFiveMinute = completedFiveMinuteCandles(
    params.fiveMinuteCandles,
    params.evaluatedAt,
  );
  const fiveMinuteBase = params.baseSeriesMap["5m"];
  const liveFiveMinute: CandleProviderResponse = {
    ...fiveMinuteBase,
    candles: completedFiveMinute.slice(-fiveMinuteBase.requestedLookbackBars),
    actualBarsReturned: Math.min(completedFiveMinute.length, fiveMinuteBase.requestedLookbackBars),
    fetchEndTimestamp: params.evaluatedAt,
    requestedEndTimestamp: params.evaluatedAt,
    completenessStatus: completedFiveMinute.length > 0 ? "complete" : "empty",
    stale: completedFiveMinute.length === 0,
    providerMetadata: {
      ...fiveMinuteBase.providerMetadata,
      tradeSetupCompletedFiveMinuteOnly: true,
    },
  };
  const currentRegularSession = regularSessionCandlesForEvaluation(
    liveFiveMinute.candles,
    params.evaluatedAt,
  );
  if (currentRegularSession.length === 0) {
    return {
      ...params.baseSeriesMap,
      "5m": liveFiveMinute,
    };
  }

  const partialFourHourCandles: Candle[] = [];
  for (let index = 0; index < currentRegularSession.length; index += TRADE_SETUP_FOUR_HOUR_BAR_COUNT) {
    partialFourHourCandles.push(
      aggregateTradeSetupFourHourBucket(
        currentRegularSession.slice(index, index + TRADE_SETUP_FOUR_HOUR_BAR_COUNT),
      ),
    );
  }
  const evaluationDate = newYorkParts(params.evaluatedAt).dateKey;
  const fourHourBase = params.baseSeriesMap["4h"];
  const priorFourHourCandles = fourHourBase.candles.filter((candle) => {
    const parts = newYorkParts(candle.timestamp);
    const minutes = parts.hour * 60 + parts.minute;
    return parts.dateKey !== evaluationDate || minutes < 9 * 60 + 30 || minutes >= 16 * 60;
  });
  const combinedFourHourCandles = [
    ...priorFourHourCandles,
    ...partialFourHourCandles,
  ]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-fourHourBase.requestedLookbackBars);
  const liveFourHour: CandleProviderResponse = {
    ...fourHourBase,
    candles: combinedFourHourCandles,
    actualBarsReturned: combinedFourHourCandles.length,
    fetchEndTimestamp: params.evaluatedAt,
    requestedEndTimestamp: params.evaluatedAt,
    completenessStatus: "partial",
    stale: false,
    providerMetadata: {
      ...fourHourBase.providerMetadata,
      tradeSetupCausalFourHourFromCompletedFiveMinute: true,
      tradeSetupCausalFourHourSourceBars: currentRegularSession.length,
    },
  };

  return {
    ...params.baseSeriesMap,
    "4h": liveFourHour,
    "5m": liveFiveMinute,
  };
}

function aggregateCandlesToFiveMinute(candles: Candle[]): Candle[] {
  const byBucket = new Map<number, Candle>();

  for (const candle of normalizePullbackCandles(candles)) {
    const timestamp = bucketCandleTimestamp(candle.timestamp, 5 * 60 * 1000);
    const existing = byBucket.get(timestamp);
    if (!existing) {
      byBucket.set(timestamp, {
        timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: Math.max(0, Math.round(candle.volume)),
      });
      continue;
    }

    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += Math.max(0, Math.round(candle.volume));
  }

  return [...byBucket.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function latestPullbackCandle(candles: Candle[]): Candle | null {
  return normalizePullbackCandles(candles).at(-1) ?? null;
}

function mergeWebsiteSpecialLevels(
  base: LevelEngineOutput["specialLevels"] | undefined,
  live: LevelEngineOutput["specialLevels"] | undefined,
): LevelEngineOutput["specialLevels"] | undefined {
  const merged: LevelEngineOutput["specialLevels"] = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(live ?? {})) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      (merged as Record<string, number>)[key] = value;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function hasUsableRecentPullbackCandles(candles: Candle[], endTimeMs: number): boolean {
  const latest = latestPullbackCandle(candles);
  return Boolean(
    latest &&
      endTimeMs - latest.timestamp <= PULLBACK_READ_MAX_LATEST_CANDLE_AGE_MS &&
      latest.timestamp - endTimeMs <= PULLBACK_READ_MAX_FUTURE_CANDLE_SKEW_MS,
  );
}

function volumeLabelForRatio(params: {
  relativeVolumeRatio: number;
  latestVolume: number;
  previousVolume: number | undefined;
}): LiveWatchlistPullbackVolumeRead["label"] {
  const fading = params.previousVolume !== undefined && params.latestVolume <= params.previousVolume * 0.75;
  return fading && params.relativeVolumeRatio < 1.2
    ? "fading"
    : params.relativeVolumeRatio >= 2
      ? "strong"
      : params.relativeVolumeRatio >= 1.4
        ? "expanding"
        : params.relativeVolumeRatio < 0.75
          ? "thin"
          : "normal";
}

function buildPullbackVolumeRead(
  candles: Candle[],
  options: { nowMs?: number; timeframeMs?: number; minPartialElapsedMs?: number } = {},
): LiveWatchlistPullbackVolumeRead {
  const sorted = normalizePullbackCandles(candles);
  const latest = sorted.at(-1);
  const timeframeMs = Math.max(1, options.timeframeMs ?? 5 * 60 * 1000);
  const minPartialElapsedMs = Math.max(1, options.minPartialElapsedMs ?? 60 * 1000);
  const baselineCandles = sorted
    .slice(0, -1)
    .slice(-20)
    .filter((candle) => Number.isFinite(candle.volume) && candle.volume > 0);
  const baseline = baselineCandles.map((candle) => candle.volume);

  if (!latest || !Number.isFinite(latest.volume) || latest.volume <= 0) {
    return {
      label: "unknown",
      currentVolume: null,
      averageVolume: null,
      relativeVolumeRatio: null,
      reason: "latest 5m volume missing",
    };
  }

  if (baseline.length < 10) {
    return {
      label: "unknown",
      currentVolume: Math.round(latest.volume),
      averageVolume: null,
      relativeVolumeRatio: null,
      reason: "not enough recent 5m volume baseline",
    };
  }

  const previousBaselineCandle = baselineCandles.at(-1);
  if (
    previousBaselineCandle &&
    latest.timestamp - previousBaselineCandle.timestamp > timeframeMs * 3
  ) {
    return {
      label: "unknown",
      currentVolume: Math.round(latest.volume),
      averageVolume: null,
      relativeVolumeRatio: null,
      reason: "recent 5m volume baseline is stale",
    };
  }

  const averageVolume = baseline.reduce((sum, volume) => sum + volume, 0) / baseline.length;
  const rawRelativeVolumeRatio = latest.volume / Math.max(averageVolume, 1);
  const previousVolume = baseline.at(-1);
  const nowMs = options.nowMs;
  const latestAgeMs = typeof nowMs === "number" && Number.isFinite(nowMs)
    ? nowMs - latest.timestamp
    : null;
  if (latestAgeMs !== null && latestAgeMs < 0) {
    return {
      label: "unknown",
      currentVolume: Math.round(latest.volume),
      averageVolume: Math.round(averageVolume),
      relativeVolumeRatio: null,
      rawRelativeVolumeRatio: Number(rawRelativeVolumeRatio.toFixed(4)),
      projectedVolume: null,
      partial: true,
      reason: "latest 5m candle timestamp is ahead of request time",
    };
  }
  const partial = latestAgeMs !== null && latestAgeMs >= 0 && latestAgeMs < timeframeMs;

  if (partial && latestAgeMs < minPartialElapsedMs) {
    return {
      label: "unknown",
      currentVolume: Math.round(latest.volume),
      averageVolume: Math.round(averageVolume),
      relativeVolumeRatio: null,
      rawRelativeVolumeRatio: Number(rawRelativeVolumeRatio.toFixed(4)),
      projectedVolume: null,
      partial: true,
      reason: "forming 5m candle is too young for a reliable volume read",
    };
  }

  const projectedVolume = partial
    ? latest.volume / Math.max(latestAgeMs! / timeframeMs, minPartialElapsedMs / timeframeMs)
    : null;
  const labelVolume = projectedVolume ?? latest.volume;
  const relativeVolumeRatio = labelVolume / Math.max(averageVolume, 1);
  const label = volumeLabelForRatio({
    relativeVolumeRatio,
    latestVolume: labelVolume,
    previousVolume,
  });

  return {
    label,
    currentVolume: Math.round(latest.volume),
    averageVolume: Math.round(averageVolume),
    relativeVolumeRatio: Number(relativeVolumeRatio.toFixed(4)),
    rawRelativeVolumeRatio: Number(rawRelativeVolumeRatio.toFixed(4)),
    projectedVolume: projectedVolume === null ? null : Math.round(projectedVolume),
    partial,
    reason: partial
      ? `forming 5m volume is pacing at ${relativeVolumeRatio.toFixed(2)}x recent average`
      : `latest 5m volume is ${relativeVolumeRatio.toFixed(2)}x recent average`,
  };
}

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || /aborted/i.test(error.message);
}

function isEpochTimestamp(timestamp: number): boolean {
  return Number.isFinite(timestamp) && timestamp > 1_000_000_000_000;
}

type ActiveLevelSnapshotState = {
  lastSnapshot: string;
  highestResistance: number | null;
  lowestSupport: number | null;
  referencePrice: number | null;
  displayedSupportZones?: LevelSnapshotDisplayZone[];
  displayedResistanceZones?: LevelSnapshotDisplayZone[];
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
const LOW_PRICE_SNAPSHOT_FORWARD_RESISTANCE_RANGE_PCT = 1;
const SNAPSHOT_FULL_LOW_PRICE_COVERAGE_AT = 2;
const SNAPSHOT_BASE_COVERAGE_AT = 3;
const SNAPSHOT_MAX_STRUCTURAL_OUTER_ANCHORS = 1;
const SNAPSHOT_CONTINUATION_MAP_MIN_GAP_PCT = 0.18;
const SNAPSHOT_CONTINUATION_MAP_TARGET_PCT = 0.55;
const SNAPSHOT_CONTINUATION_MAP_MIN_STEP_PCT = 0.03;
const SNAPSHOT_CONTINUATION_MAP_MIN_PATH_LEVELS = 5;
const SNAPSHOT_CONTINUATION_MAP_MIN_SUPPLEMENTAL_PRICE = 10;
const SNAPSHOT_CONTINUATION_MAP_MAX_LEVELS = 4;
const SNAPSHOT_CONTINUATION_MAP_MAX_CURRENT_PRICE = 50;
const SNAPSHOT_CROSSED_RESISTANCE_SUPPORT_FLIP_MAX_DISTANCE_PCT = 0.3;
const SNAPSHOT_LIVE_REFERENCE_MAX_AGE_MS = 30 * 60 * 1000;
const EXTENSION_LIVE_REFERENCE_MAX_AGE_MS = 30 * 60 * 1000;
const SYMBOL_RECAP_COOLDOWN_MS = 60 * 60 * 1000;
const AI_SIGNAL_COMMENTARY_COOLDOWN_MS = 10 * 60 * 1000;
const AI_SIGNAL_COMMENTARY_MAX_DELIVERY_LAG_MS = 8 * 1000;
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
const MARKET_STRUCTURE_STANDALONE_POST_DELAY_MS = 2500;
const MARKET_STRUCTURE_STANDALONE_TESTING_POST_DELAY_MS = 500;
const MARKET_STRUCTURE_STANDALONE_RETRY_DELAY_MS = 10 * 1000;
const MARKET_STRUCTURE_STANDALONE_REPEAT_COOLDOWN_MS = 30 * 60 * 1000;
const MARKET_STRUCTURE_STANDALONE_TESTING_REPEAT_COOLDOWN_MS = 5 * 60 * 1000;
const LEVEL_SEED_TIMEOUT_MS = 90 * 1000;
const QUEUED_ACTIVATION_SEED_GRACE_TIMEOUT_MS = 3 * 60 * 1000;
const ACTIVATION_AUTO_RETRY_DELAY_MS = 90 * 1000;
const ACTIVATION_MAX_AUTO_RETRIES = 1;
const ACTIVATION_STUCK_WARNING_MS = 2 * 60 * 1000;
const ACTIVATION_WATCHDOG_INTERVAL_MS = 15 * 1000;
const MAX_ACTIVITY_ENTRIES = 80;
const PRICE_UPDATE_PERSIST_INTERVAL_MS = 5 * 1000;
const WEBSITE_TICKER_DATA_PUBLISH_INTERVAL_MS = 2 * 1000;
const WEBSITE_TECHNICAL_CONTEXT_PUBLISH_INTERVAL_MS = 30 * 1000;
const WEBSITE_PULLBACK_READ_PUBLISH_INTERVAL_MS = 5 * 60 * 1000;
const PRIOR_REGULAR_CLOSE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const PULLBACK_READ_INTRADAY_POLL_INTERVAL_MS = 60 * 1000;
const PULLBACK_READ_1M_LOOKBACK_BARS = 120;
const PULLBACK_READ_5M_LOOKBACK_BARS = 80;
const TRADERSLINK_AI_READ_5M_FETCH_BARS = 720;
const TRADERSLINK_AI_READ_DAILY_FETCH_BARS = 30;
const PULLBACK_READ_MAX_LATEST_CANDLE_AGE_MS = 10 * 60 * 1000;
const PULLBACK_READ_MAX_FUTURE_CANDLE_SKEW_MS = 90 * 1000;
const TECHNICAL_CONTEXT_BOOTSTRAP_RETRY_DELAYS_MS = [
  60 * 1000,
  3 * 60 * 1000,
  10 * 60 * 1000,
  30 * 60 * 1000,
];
const LEVEL_TOUCH_SUPERSEDE_DELAY_MS = 1200;
const FAST_LEVEL_CLEAR_CONFIRM_PCT = 0.0025;
const FAST_LEVEL_CLUSTER_MAX_SPAN_PCT = 0.035;
const FAST_LEVEL_CLEAR_COALESCE_MS = 0;
const FOLLOW_THROUGH_MAJOR_MOVE_PCT = 2;
const AUTO_CLEAN_READ_MAX_ATTEMPTS = 2;
const AUTO_CLEAN_READ_RETRY_DELAY_MS = 1000;
export const DEFAULT_MANUAL_WATCHLIST_HISTORICAL_LOOKBACKS: ManualWatchlistHistoricalLookbacks = {
  daily: 520,
  "4h": 180,
  "5m": 100,
};
const SAME_LEVEL_STORY_WINDOW_MS = 10 * 60 * 1000;
const SAME_LEVEL_PRICE_TOLERANCE_PCT = 0.006;
const SAME_LEVEL_PRICE_TOLERANCE_ABSOLUTE = 0.02;
const MIN_DIRECTIONAL_STATE_UPDATE_PCT = 0.2;

function appendMarketStructureSection(
  body: string,
  marketStructure: LevelSnapshotPayload["marketStructure"],
  storyKeys?: string[],
): string {
  const lines = buildVisibleMarketStructureDiscordLines(marketStructure, { storyKeys });
  if (lines.length === 0) {
    return body;
  }

  return [
    body,
    "",
    "Market structure:",
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}

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

type SnapshotReferencePrice = {
  price: number;
  source: "override" | "live_price" | "level_metadata";
  livePriceAgeMs?: number;
  metadataReferencePrice?: number;
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

function snapshotForwardResistanceRangePct(currentPrice: number): number {
  if (currentPrice <= SNAPSHOT_FULL_LOW_PRICE_COVERAGE_AT) {
    return LOW_PRICE_SNAPSHOT_FORWARD_RESISTANCE_RANGE_PCT;
  }
  if (currentPrice >= SNAPSHOT_BASE_COVERAGE_AT) {
    return SNAPSHOT_FORWARD_RESISTANCE_RANGE_PCT;
  }

  const progress =
    (currentPrice - SNAPSHOT_FULL_LOW_PRICE_COVERAGE_AT) /
    (SNAPSHOT_BASE_COVERAGE_AT - SNAPSHOT_FULL_LOW_PRICE_COVERAGE_AT);
  return (
    LOW_PRICE_SNAPSHOT_FORWARD_RESISTANCE_RANGE_PCT -
    progress *
      (LOW_PRICE_SNAPSHOT_FORWARD_RESISTANCE_RANGE_PCT -
        SNAPSHOT_FORWARD_RESISTANCE_RANGE_PCT)
  );
}

function decimalPlacesForIncrement(increment: number): number {
  const text = increment.toString();
  const dotIndex = text.indexOf(".");
  return dotIndex === -1 ? 0 : text.length - dotIndex - 1;
}

function normalizeSnapshotContinuationPrice(price: number, increment: number): number {
  return Number(price.toFixed(Math.max(decimalPlacesForIncrement(increment), price >= 1 ? 2 : 4)));
}

function snapshotResistancePlanningIncrement(price: number): number {
  if (price < 0.5) return 0.025;
  if (price < 1) return 0.05;
  if (price < 2) return 0.1;
  if (price < 5) return 0.25;
  if (price < 10) return 0.5;
  if (price < 25) return 1;
  if (price < 50) return 2.5;
  return 5;
}

function nextSnapshotContinuationResistance(basePrice: number): number {
  const increment = snapshotResistancePlanningIncrement(basePrice);
  const rounded = Math.ceil((basePrice + increment * 0.05) / increment) * increment;
  return normalizeSnapshotContinuationPrice(rounded, increment);
}

type FastLevelReference = {
  representativePrice: number;
  lowPrice?: number;
  highPrice?: number;
  zoneLow?: number;
  zoneHigh?: number;
  strengthLabel?: FinalLevelZone["strengthLabel"];
  sourceLabel?: string;
};

function fastLevelLow(zone: FastLevelReference): number {
  return zone.zoneLow ?? zone.lowPrice ?? zone.representativePrice;
}

function fastLevelHigh(zone: FastLevelReference): number {
  return zone.zoneHigh ?? zone.highPrice ?? zone.representativePrice;
}

function formatFastLevelZone(zone: FastLevelReference | null, side: "support" | "resistance"): string | null {
  if (!zone) {
    return null;
  }

  return `${describeZoneStrength(zone.strengthLabel ?? "moderate")} ${side} ${formatSnapshotLevel(zone.representativePrice)}`;
}

function formatFastLevelOnly(zone: FastLevelReference | null): string | null {
  return zone ? formatSnapshotLevel(zone.representativePrice) : null;
}

function fastLevelStrengthRank(label: FinalLevelZone["strengthLabel"] | undefined): number {
  switch (label) {
    case "major":
      return 4;
    case "strong":
      return 3;
    case "moderate":
      return 2;
    case "weak":
      return 1;
    default:
      return 0;
  }
}

function fastLevelSourceRank(label: string | null | undefined): number {
  const normalized = label?.trim().toLowerCase() ?? "";
  if (normalized.includes("daily") && normalized.includes("confluence")) return 6;
  if (normalized.includes("daily")) return 5;
  if (normalized.includes("4h") && normalized.includes("confluence")) return 4;
  if (normalized.includes("4h")) return 3;
  if (normalized.includes("continuation") || normalized.includes("extension")) return 2;
  if (normalized.includes("intraday") || normalized.includes("5m")) return 1;
  if (normalized) return 0.5;
  return 0;
}

function withFastLevelSourceLabel(zone: FinalLevelZone): FastLevelReference {
  return {
    ...zone,
    sourceLabel: deriveSnapshotLevelSourceLabel(zone),
  };
}

function isTinySmallCapLevelStep(fromLevel: number, toLevel: number): boolean {
  if (!Number.isFinite(fromLevel) || !Number.isFinite(toLevel) || fromLevel <= 0 || toLevel <= 0) {
    return false;
  }
  const absoluteDistance = Math.abs(fromLevel - toLevel);
  const distancePct = absoluteDistance / Math.max(fromLevel, 0.0001);
  return fromLevel < 2 && (absoluteDistance < 0.04 || distancePct < 0.025);
}

function classifyRuntimePostBudgetSymbolType(price: number): string {
  if (!Number.isFinite(price) || price <= 0) {
    return "unknown";
  }
  if (price < 2) {
    return "low_priced_small_cap";
  }
  if (price < 10) {
    return "small_cap";
  }
  return "higher_priced_runner";
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
  const sourceTypes = new Set(zone.sourceTypes);
  if (sourceTypes.has("current_session_high")) return "high of day";
  if (sourceTypes.has("current_session_low")) return "low of day";
  if (sourceTypes.has("premarket_high")) return "premarket high";
  if (sourceTypes.has("premarket_low")) return "premarket low";
  if (sourceTypes.has("opening_range_high")) return "opening range high";
  if (sourceTypes.has("opening_range_low")) return "opening range low";
  if (sourceTypes.has("previous_day_high")) return "previous day high";
  if (sourceTypes.has("previous_day_low")) return "previous day low";
  if (sourceTypes.has("previous_day_close")) return "previous day close";

  if (zone.notes.includes("snapshot_continuation_map")) {
    return "continuation map";
  }

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
  const challengerDistance = Math.abs(challenger.representativePrice - currentPrice);
  const incumbentDistance = Math.abs(incumbent.representativePrice - currentPrice);
  const nearPriceDistance = Math.max(currentPrice, 0.0001) * 0.03;
  if (
    side === "resistance" &&
    currentPrice < 1 &&
    (challengerDistance <= nearPriceDistance || incumbentDistance <= nearPriceDistance) &&
    challengerDistance !== incumbentDistance
  ) {
    return challengerDistance < incumbentDistance;
  }

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

  const provenanceRank = (zone: FinalLevelZone): number =>
    zone.marketDataProvenance?.lastConfirmedAt !== undefined
      ? 2
      : zone.marketDataProvenance?.lastTestedAt !== undefined
        ? 1
        : 0;
  if (provenanceRank(challenger) !== provenanceRank(incumbent)) {
    return provenanceRank(challenger) > provenanceRank(incumbent);
  }
  const challengerInteractionAt =
    challenger.marketDataProvenance?.lastConfirmedAt ??
    challenger.marketDataProvenance?.lastTestedAt ??
    challenger.marketDataProvenance?.formedAt ??
    0;
  const incumbentInteractionAt =
    incumbent.marketDataProvenance?.lastConfirmedAt ??
    incumbent.marketDataProvenance?.lastTestedAt ??
    incumbent.marketDataProvenance?.formedAt ??
    0;
  if (challengerInteractionAt !== incumbentInteractionAt) {
    return challengerInteractionAt > incumbentInteractionAt;
  }

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
    lowPrice: zone.zoneLow,
    highPrice: zone.zoneHigh,
    strengthLabel: zone.strengthLabel,
    freshness: zone.freshness,
    touchCount: zone.touchCount,
    confluenceCount: zone.confluenceCount,
    reactionQualityScore: zone.reactionQualityScore,
    rejectionScore: zone.rejectionScore,
    displacementScore: zone.displacementScore,
    sessionSignificanceScore: zone.sessionSignificanceScore,
    sourceEvidenceCount: zone.sourceEvidenceCount,
    isExtension: zone.isExtension,
    sourceLabel: deriveSnapshotLevelSourceLabel(zone),
    ...(zone.marketDataProvenance
      ? { marketDataProvenance: { ...zone.marketDataProvenance } }
      : {}),
  }));
}

type SnapshotProvenancePolicyResult = {
  zones: FinalLevelZone[];
  wouldSuppressIds: Set<string>;
  suppressedIds: Set<string>;
  fallbackRestoredIds: Set<string>;
};

function isStaleUnconfirmedIntradaySnapshotZone(
  zone: FinalLevelZone,
  currentPrice: number,
  timestamp: number,
): boolean {
  const provenance = zone.marketDataProvenance;
  if (!provenance) {
    return false;
  }
  const isFiveMinuteOnly =
    zone.timeframeSources.length > 0 &&
    zone.timeframeSources.every((timeframe) => timeframe === "5m");
  if (!isFiveMinuteOnly || provenance.lastConfirmedAt !== undefined) {
    return false;
  }

  const currentDate = newYorkDateKeyForTimestamp(timestamp);
  const formedDate = newYorkDateKeyForTimestamp(provenance.formedAt);
  const lastTestedDate = provenance.lastTestedAt === undefined
    ? null
    : newYorkDateKeyForTimestamp(provenance.lastTestedAt);
  if (!currentDate || !formedDate || formedDate >= currentDate || lastTestedDate === currentDate) {
    return false;
  }

  const priceInsideZone = currentPrice >= zone.zoneLow && currentPrice <= zone.zoneHigh;
  const hasStrongOverride = zone.strengthLabel === "strong" || zone.strengthLabel === "major";
  return !priceInsideZone && !hasStrongOverride;
}

export function applySnapshotLevelProvenancePolicy(params: {
  zones: FinalLevelZone[];
  currentPrice: number;
  timestamp: number;
  side: "support" | "resistance";
  mode: LiveWatchlistLevelProvenanceMode;
}): SnapshotProvenancePolicyResult {
  const wouldSuppress = params.zones.filter((zone) =>
    isStaleUnconfirmedIntradaySnapshotZone(
      zone,
      params.currentPrice,
      params.timestamp,
    ),
  );
  const wouldSuppressIds = new Set(wouldSuppress.map(snapshotCandidateKey));
  if (params.mode === "off") {
    return {
      zones: params.zones,
      wouldSuppressIds: new Set(),
      suppressedIds: new Set(),
      fallbackRestoredIds: new Set(),
    };
  }
  if (params.mode === "observe" || wouldSuppress.length === 0) {
    return {
      zones: params.zones,
      wouldSuppressIds,
      suppressedIds: new Set(),
      fallbackRestoredIds: new Set(),
    };
  }

  const kept = params.zones.filter((zone) => !wouldSuppressIds.has(snapshotCandidateKey(zone)));
  const suppressedIds = new Set(wouldSuppressIds);
  const fallbackRestoredIds = new Set<string>();
  if (kept.length === 0 && params.zones.length > 0) {
    const fallback = params.zones.reduce((best, candidate) =>
      isBetterSnapshotRepresentative(
        candidate,
        best,
        params.currentPrice,
        params.side,
      )
        ? candidate
        : best,
    );
    const fallbackId = snapshotCandidateKey(fallback);
    kept.push(fallback);
    suppressedIds.delete(fallbackId);
    fallbackRestoredIds.add(fallbackId);
  }

  return {
    zones: kept,
    wouldSuppressIds,
    suppressedIds,
    fallbackRestoredIds,
  };
}

function buildRecentAtrRoleFlipContext(
  candles: Candle[],
  currentPrice: number,
  asOfTimestamp: number,
): NonNullable<LevelSnapshotPayload["roleFlipContext"]> {
  const atr = calculateCompletedFiveMinuteAtr(candles, currentPrice, asOfTimestamp);
  const usable = atr.reliability === "reliable";
  return {
    atrPct: usable ? atr.pct : null,
    atrValue: usable ? atr.value : null,
    atrPeriod: atr.period,
    atrTimeframe: atr.timeframe,
    atrCompletedCandleCount: atr.completedCandleCount,
    atrReliability: atr.reliability,
    atrReason: atr.reason,
  };
}

function inferredSmallCapTickSize(price: number): number {
  return price < 1 ? 0.0001 : 0.01;
}

function flipWrongSideSnapshotZone(
  zone: FinalLevelZone,
  side: "support" | "resistance",
): FinalLevelZone {
  return {
    ...zone,
    id: `${zone.id}-as-${side}`,
    kind: side,
    notes: [...zone.notes, `snapshot_role_flip:${zone.kind}_as_${side}`],
  };
}

function isActionableCrossedResistanceSupportFlip(
  zone: FinalLevelZone,
  currentPrice: number,
  distancePct: number,
): boolean {
  return (
    currentPrice < SNAPSHOT_CONTINUATION_MAP_MAX_CURRENT_PRICE &&
    distancePct <= SNAPSHOT_CROSSED_RESISTANCE_SUPPORT_FLIP_MAX_DISTANCE_PCT &&
    zone.strengthLabel !== "weak" &&
    zone.notes.includes("snapshot_role_flip:resistance_as_support") &&
    zone.timeframeSources.some((timeframe) => timeframe === "daily" || timeframe === "4h") &&
    (
      zone.sourceEvidenceCount >= 1 ||
      zone.rejectionScore >= 0.38 ||
      zone.displacementScore >= 0.5 ||
      zone.followThroughScore >= 0.5
    )
  );
}

function buildSnapshotSideZones(params: {
  primaryZones: FinalLevelZone[];
  oppositeZones: FinalLevelZone[];
  currentPrice: number;
  tolerance: number;
  side: "support" | "resistance";
  maxForwardResistancePrice: number;
}): FinalLevelZone[] {
  const maxFlipDistancePct = params.side === "support" ? 0.12 : 0.08;
  const roleFlippedZones = params.oppositeZones
    .map((zone) => flipWrongSideSnapshotZone(zone, params.side))
    .filter((zone) =>
      isSnapshotZoneDisplayableForSide(
        zone,
        params.currentPrice,
        params.tolerance,
        params.side,
      ),
    )
    .filter((zone) =>
      params.side === "resistance"
        ? zone.zoneLow <= params.maxForwardResistancePrice
        : true,
    )
    .filter((zone) =>
      params.side === "resistance"
        ? zone.representativePrice > params.currentPrice + params.tolerance ||
            isImportantAtPriceDecisionZone(zone, params.currentPrice, params.tolerance, params.side)
        : zone.representativePrice < params.currentPrice - params.tolerance ||
            isImportantAtPriceDecisionZone(zone, params.currentPrice, params.tolerance, params.side),
    )
    .filter((zone) => {
      const distancePct =
        Math.abs(zone.representativePrice - params.currentPrice) /
        Math.max(params.currentPrice, 0.0001);
      return (
        distancePct <= maxFlipDistancePct ||
        (
          params.side === "support" &&
          isActionableCrossedResistanceSupportFlip(zone, params.currentPrice, distancePct)
        )
      );
    })
    .sort((left, right) =>
      params.side === "support"
        ? right.representativePrice - left.representativePrice
        : left.representativePrice - right.representativePrice,
    )
    .slice(0, 2);

  return params.side === "support"
    ? [...params.primaryZones, ...roleFlippedZones]
    : [...params.primaryZones, ...roleFlippedZones];
}

function isMeaningfulStructuralOuterResistance(zone: FinalLevelZone): boolean {
  return (
    (zone.strengthLabel === "strong" || zone.strengthLabel === "major") &&
    zone.timeframeSources.some(
      (timeframe) => timeframe === "daily" || timeframe === "4h",
    ) &&
    !zone.notes.includes("snapshot_continuation_map")
  );
}

function addSnapshotStructuralOuterResistanceAnchor(params: {
  zones: FinalLevelZone[];
  allCandidates: FinalLevelZone[];
  currentPrice: number;
  tolerance: number;
  maxForwardResistancePrice: number;
}): FinalLevelZone[] {
  const existingIds = new Set(params.zones.map(snapshotCandidateKey));
  const anchors = sortSnapshotZones(
    params.allCandidates.filter(
      (zone) =>
        !existingIds.has(snapshotCandidateKey(zone)) &&
        zone.zoneLow > params.maxForwardResistancePrice &&
        isSnapshotZoneDisplayableForSide(
          zone,
          params.currentPrice,
          params.tolerance,
          "resistance",
        ) &&
        isMeaningfulStructuralOuterResistance(zone),
    ),
    "resistance",
  ).slice(0, SNAPSHOT_MAX_STRUCTURAL_OUTER_ANCHORS);

  return anchors.length > 0
    ? sortSnapshotZones([...params.zones, ...anchors], "resistance")
    : params.zones;
}

function hasNearbySnapshotZone(zones: FinalLevelZone[], price: number): boolean {
  return zones.some((zone) => {
    if (formatSnapshotLevel(zone.representativePrice) === formatSnapshotLevel(price)) {
      return true;
    }

    const distancePct =
      Math.abs(zone.representativePrice - price) /
      Math.max(Math.max(zone.representativePrice, price), 0.0001);
    return distancePct <= SNAPSHOT_CONTINUATION_MAP_MIN_STEP_PCT;
  });
}

function buildSnapshotContinuationMapZone(params: {
  symbol: string;
  price: number;
  currentPrice: number;
  timestamp: number;
}): FinalLevelZone {
  return {
    id: `${params.symbol}-snapshot-continuation-resistance-${formatSnapshotLevel(params.price)}`,
    symbol: params.symbol,
    kind: "resistance",
    timeframeBias: "5m",
    zoneLow: params.price,
    zoneHigh: params.price,
    representativePrice: params.price,
    strengthScore: 0,
    strengthLabel: "weak",
    touchCount: 0,
    confluenceCount: 0,
    sourceTypes: ["swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0,
    rejectionScore: 0,
    displacementScore: 0,
    sessionSignificanceScore: 0,
    followThroughScore: 0,
    gapContinuationScore: 0,
    sourceEvidenceCount: 0,
    firstTimestamp: params.timestamp,
    lastTimestamp: params.timestamp,
    isExtension: false,
    freshness: "fresh",
    notes: [
      "snapshot_continuation_map",
      `snapshotContinuationFrom=${formatSnapshotLevel(params.currentPrice)}`,
    ],
  };
}

function addSupplementalSnapshotContinuationResistances(params: {
  sortedResistanceZones: FinalLevelZone[];
  additions: FinalLevelZone[];
  currentPrice: number;
  maxForwardResistancePrice: number;
  symbol: string;
  timestamp: number;
}): FinalLevelZone[] {
  if (params.currentPrice < SNAPSHOT_CONTINUATION_MAP_MIN_SUPPLEMENTAL_PRICE) {
    return params.additions;
  }

  const supplemented = [...params.additions];
  let basePrice =
    sortSnapshotZones([...params.sortedResistanceZones, ...supplemented], "resistance")
      .filter((zone) => zone.representativePrice > params.currentPrice)
      .at(-1)?.representativePrice ?? params.currentPrice;
  const ceiling = Math.min(
    params.maxForwardResistancePrice,
    params.currentPrice * (1 + SNAPSHOT_CONTINUATION_MAP_TARGET_PCT),
  );

  for (
    let guard = 0;
    guard < 24 &&
      params.sortedResistanceZones.length + supplemented.length < SNAPSHOT_CONTINUATION_MAP_MIN_PATH_LEVELS &&
      supplemented.length < SNAPSHOT_CONTINUATION_MAP_MAX_LEVELS;
    guard += 1
  ) {
    const nextPrice = nextSnapshotContinuationResistance(basePrice);
    if (!Number.isFinite(nextPrice) || nextPrice <= basePrice || nextPrice > ceiling) {
      break;
    }

    basePrice = nextPrice;
    if (hasNearbySnapshotZone([...params.sortedResistanceZones, ...supplemented], nextPrice)) {
      continue;
    }

    supplemented.push(
      buildSnapshotContinuationMapZone({
        symbol: params.symbol,
        price: nextPrice,
        currentPrice: params.currentPrice,
        timestamp: params.timestamp,
      }),
    );
  }

  return supplemented;
}

function addSnapshotContinuationResistanceMap(params: {
  zones: FinalLevelZone[];
  currentPrice: number;
  maxForwardResistancePrice: number;
  symbol: string;
  timestamp: number;
}): FinalLevelZone[] {
  if (
    !Number.isFinite(params.currentPrice) ||
    params.currentPrice <= 0 ||
    params.currentPrice >= SNAPSHOT_CONTINUATION_MAP_MAX_CURRENT_PRICE
  ) {
    return params.zones;
  }

  const sorted = sortSnapshotZones(params.zones, "resistance").filter(
    (zone) =>
      Number.isFinite(zone.representativePrice) &&
      zone.representativePrice > params.currentPrice &&
      zone.zoneLow <= params.maxForwardResistancePrice,
  );
  const additions: FinalLevelZone[] = [];

  for (
    let index = 0;
    index < sorted.length - 1 && additions.length < SNAPSHOT_CONTINUATION_MAP_MAX_LEVELS;
    index += 1
  ) {
    const left = sorted[index]!;
    const right = sorted[index + 1]!;
    const gapPct =
      (right.representativePrice - left.representativePrice) /
      Math.max(params.currentPrice, 0.0001);

    if (gapPct < SNAPSHOT_CONTINUATION_MAP_MIN_GAP_PCT) {
      continue;
    }

    const ceiling = Math.min(
      right.representativePrice * 0.999,
      params.maxForwardResistancePrice,
      params.currentPrice * (1 + SNAPSHOT_CONTINUATION_MAP_TARGET_PCT),
    );
    let basePrice = left.representativePrice;

    for (
      let guard = 0;
      guard < 24 && additions.length < SNAPSHOT_CONTINUATION_MAP_MAX_LEVELS;
      guard += 1
    ) {
      const nextPrice = nextSnapshotContinuationResistance(basePrice);
      if (!Number.isFinite(nextPrice) || nextPrice <= basePrice || nextPrice >= ceiling) {
        break;
      }

      basePrice = nextPrice;
      if (hasNearbySnapshotZone([...sorted, ...additions], nextPrice)) {
        continue;
      }

      additions.push(
        buildSnapshotContinuationMapZone({
          symbol: params.symbol,
          price: nextPrice,
          currentPrice: params.currentPrice,
          timestamp: params.timestamp,
        }),
      );
    }
  }

  const supplementedAdditions = addSupplementalSnapshotContinuationResistances({
    sortedResistanceZones: sorted,
    additions,
    currentPrice: params.currentPrice,
    maxForwardResistancePrice: params.maxForwardResistancePrice,
    symbol: params.symbol,
    timestamp: params.timestamp,
  });

  return supplementedAdditions.length > 0
    ? sortSnapshotZones([...params.zones, ...supplementedAdditions], "resistance")
    : params.zones;
}

function snapshotCandidateKey(zone: FinalLevelZone): string {
  return zone.id;
}

function isImportantAtPriceDecisionZone(
  zone: FinalLevelZone,
  currentPrice: number,
  tolerance: number,
  side: "support" | "resistance",
): boolean {
  const important =
    zone.strengthLabel === "major" ||
    zone.strengthLabel === "strong" ||
    zone.strengthScore >= 25 ||
    zone.confluenceCount >= 2 ||
    zone.sourceEvidenceCount >= 3;
  const lowPricedStructuralShelf =
    currentPrice < 1 &&
    zone.strengthLabel === "moderate" &&
    zone.strengthScore >= 15 &&
    zone.timeframeSources.some((timeframe) => timeframe === "daily" || timeframe === "4h");
  if (!important && !lowPricedStructuralShelf) {
    return false;
  }

  const nearDecisionTolerance = Math.max(tolerance, currentPrice * 0.006);
  if (side === "support") {
    if (zone.zoneLow <= currentPrice && zone.zoneHigh >= currentPrice) {
      return true;
    }
    return zone.zoneHigh <= currentPrice && currentPrice - zone.zoneHigh <= nearDecisionTolerance;
  }

  if (zone.zoneLow <= currentPrice && zone.zoneHigh >= currentPrice) {
    return true;
  }
  return zone.zoneLow >= currentPrice && zone.zoneLow - currentPrice <= nearDecisionTolerance;
}

function isSnapshotZoneDisplayableForSide(
  zone: FinalLevelZone,
  currentPrice: number,
  tolerance: number,
  side: "support" | "resistance",
): boolean {
  const zoneWidth = Math.abs(zone.zoneHigh - zone.zoneLow);
  const wideEnoughToMatterAtPrice = zoneWidth >= tolerance * 2;
  return side === "support"
    ? zone.representativePrice < currentPrice - tolerance ||
        (zone.zoneLow < currentPrice && wideEnoughToMatterAtPrice) ||
        isImportantAtPriceDecisionZone(zone, currentPrice, tolerance, side)
    : zone.representativePrice > currentPrice + tolerance ||
        (zone.zoneHigh > currentPrice && wideEnoughToMatterAtPrice) ||
        isImportantAtPriceDecisionZone(zone, currentPrice, tolerance, side);
}

function buildSnapshotAuditZones(params: {
  zones: FinalLevelZone[];
  displayedZoneIds: Set<string>;
  side: "support" | "resistance";
  bucket: "surfaced" | "extension";
  currentPrice: number;
  tolerance: number;
  maxForwardResistancePrice: number;
  provenanceWouldSuppressIds: Set<string>;
  provenanceSuppressedIds: Set<string>;
  provenanceFallbackRestoredIds: Set<string>;
}): LevelSnapshotAuditZone[] {
  const sorted = sortSnapshotZones(params.zones, params.side);

  return sorted.map((zone) => {
    const candidateKey = snapshotCandidateKey(zone);
    const displayed = params.displayedZoneIds.has(candidateKey);
    const wrongSide =
      !isSnapshotZoneDisplayableForSide(
        zone,
        params.currentPrice,
        params.tolerance,
        params.side,
      );
    const outsideForwardRange =
      params.side === "resistance" &&
      zone.zoneLow > params.maxForwardResistancePrice;

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
      ...(zone.marketDataProvenance
        ? { marketDataProvenance: { ...zone.marketDataProvenance } }
        : {}),
      provenanceDisposition: params.provenanceFallbackRestoredIds.has(candidateKey)
        ? "fallback_restored"
        : params.provenanceSuppressedIds.has(candidateKey)
          ? "suppressed"
          : params.provenanceWouldSuppressIds.has(candidateKey)
            ? "would_suppress"
            : "eligible",
      isExtension: zone.isExtension,
      displayed,
      omittedReason: displayed
        ? "displayed"
        : wrongSide
          ? "wrong_side"
          : outsideForwardRange
            ? "outside_forward_range"
            : params.provenanceSuppressedIds.has(candidateKey)
              ? "stale_unconfirmed_intraday"
              : "compacted",
    };
  });
}

function buildSnapshotAudit(params: {
  currentPrice: number;
  tolerance: number;
  maxForwardResistancePrice: number;
  referencePriceSource?: LevelSnapshotAudit["referencePriceSource"];
  livePriceAgeMs?: number;
  metadataReferencePrice?: number;
  surfacedSupportZones: FinalLevelZone[];
  surfacedResistanceZones: FinalLevelZone[];
  extensionResistanceZones: FinalLevelZone[];
  displayedSupportZones: FinalLevelZone[];
  displayedResistanceZones: FinalLevelZone[];
  supportProvenancePolicy: SnapshotProvenancePolicyResult;
  resistanceProvenancePolicy: SnapshotProvenancePolicyResult;
}): LevelSnapshotAudit {
  const displayedSupportIds = params.displayedSupportZones.map(snapshotCandidateKey);
  const displayedResistanceIds = params.displayedResistanceZones.map(snapshotCandidateKey);
  const displayedSupportIdSet = new Set([
    ...displayedSupportIds,
    ...displayedResistanceIds
      .filter((id) => id.endsWith("-as-resistance"))
      .map((id) => id.slice(0, -"-as-resistance".length)),
  ]);
  const displayedResistanceIdSet = new Set([
    ...displayedResistanceIds,
    ...displayedSupportIds
      .filter((id) => id.endsWith("-as-support"))
      .map((id) => id.slice(0, -"-as-support".length)),
  ]);
  const supportCandidates = buildSnapshotAuditZones({
    zones: params.surfacedSupportZones,
    displayedZoneIds: displayedSupportIdSet,
    side: "support",
    bucket: "surfaced",
    currentPrice: params.currentPrice,
    tolerance: params.tolerance,
    maxForwardResistancePrice: params.maxForwardResistancePrice,
    provenanceWouldSuppressIds: params.supportProvenancePolicy.wouldSuppressIds,
    provenanceSuppressedIds: params.supportProvenancePolicy.suppressedIds,
    provenanceFallbackRestoredIds: params.supportProvenancePolicy.fallbackRestoredIds,
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
      provenanceWouldSuppressIds: params.resistanceProvenancePolicy.wouldSuppressIds,
      provenanceSuppressedIds: params.resistanceProvenancePolicy.suppressedIds,
      provenanceFallbackRestoredIds: params.resistanceProvenancePolicy.fallbackRestoredIds,
    }),
    ...buildSnapshotAuditZones({
      zones: params.extensionResistanceZones,
      displayedZoneIds: displayedResistanceIdSet,
      side: "resistance",
      bucket: "extension",
      currentPrice: params.currentPrice,
      tolerance: params.tolerance,
      maxForwardResistancePrice: params.maxForwardResistancePrice,
      provenanceWouldSuppressIds: params.resistanceProvenancePolicy.wouldSuppressIds,
      provenanceSuppressedIds: params.resistanceProvenancePolicy.suppressedIds,
      provenanceFallbackRestoredIds: params.resistanceProvenancePolicy.fallbackRestoredIds,
    }),
  ];

  return {
    referencePrice: params.currentPrice,
    referencePriceSource: params.referencePriceSource,
    livePriceAgeMs: params.livePriceAgeMs,
    metadataReferencePrice: params.metadataReferencePrice,
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
  private readonly startupCachedLevelEngine: LevelEngine | null;
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
  private readonly threadStoryPhaseState = new Map<string, ThreadStoryPhaseRecord[]>();
  private readonly aiSignalStoryState = new Map<string, AiSignalStoryRecord[]>();
  private readonly dominantLevelStories = new Map<string, SymbolDominantLevelStory[]>();
  private readonly liveThreadPostState = new Map<string, SymbolLiveThreadPostState>();
  private readonly narrationBurstState = new Map<string, SymbolNarrationBurstState>();
  private readonly storyCriticalState = new Map<string, SymbolStoryCriticalState>();
  private readonly deliveryPressureState = new Map<string, SymbolDeliveryPressureState>();
  private readonly marketStructureStoryMemory = new MarketStructureStoryMemory();
  private readonly marketStructureCarrierInFlightKeys = new Map<string, Set<string>>();
  private readonly pendingMarketStructureStandalonePosts = new Map<string, NodeJS.Timeout>();
  private readonly marketStructureStoryMemoryPath: string | null;
  private readonly marketStructureStandalonePostMode: MarketStructureStandalonePostMode;
  private readonly liveWatchlistPublisher: LiveWatchlistPublisher | null;
  private readonly levelProvenanceMode: LiveWatchlistLevelProvenanceMode;
  private readonly startupCacheWarmingSymbols = new Set<string>();
  private readonly startupCacheRestoredAt = new Map<string, number>();
  private readonly startupCacheFreshRefreshFailures = new Map<string, string>();
  private readonly aiReadInFlight = new Set<string>();
  private readonly aiReadState = new Map<string, TradersLinkAiReadRefreshState>();
  private readonly aiReadInitialGenerationSuppressedSymbols = new Set<string>();
  private tradersLinkAiReadDailyCostBudget = {
    enabled: false,
    dailyLimitUsd: DEFAULT_TRADERSLINK_AI_READ_DAILY_COST_BUDGET_USD,
  };
  private readonly levelSeedStats = {
    attempts: 0,
    successes: 0,
    failures: 0,
    timeouts: 0,
    inFlight: 0,
    totalDurationMs: 0,
    lastDurationMs: null as number | null,
    lastSymbol: null as string | null,
    lastStartedAt: null as number | null,
    lastCompletedAt: null as number | null,
    lastError: null as string | null,
  };
  private readonly optionalPostSettleDelayMs: number;
  private readonly levelSeedTimeoutMs: number;
  private readonly queuedActivationSeedGraceTimeoutMs: number;
  private readonly activationAutoRetryDelayMs: number;
  private readonly activationMaxAutoRetries: number;
  private readonly activationStuckWarningMs: number;
  private readonly levelTouchSupersedeDelayMs: number;
  private readonly fastLevelClearCoalesceMs: number;
  private readonly historicalLookbackBars: ManualWatchlistHistoricalLookbacks;
  private readonly postingPolicySettings: LiveThreadPostingPolicySettings;
  private readonly recentActivity: ManualWatchlistActivityEntry[] = [];
  private monitoringRestartQueue: Promise<void> = Promise.resolve();
  private activitySequence = 0;
  private readonly stuckActivationWarnings = new Set<string>();
  private activationWatchdogTimer: NodeJS.Timeout | null = null;
  private readonly pendingLevelTouchAlerts = new Map<string, NodeJS.Timeout>();
  private readonly pendingFastLevelClearAlerts = new Map<string, {
    timer: NodeJS.Timeout;
    update: LivePriceUpdate;
  }>();
  private lastPriceUpdateAt: number | null = null;
  private lastPriceUpdateSymbol: string | null = null;
  private lastPriceUpdatePersistAt: number | null = null;
  private readonly lastWebsiteTickerDataPublishAt = new Map<string, number>();
  private readonly lastWebsiteTickerDataObservedAt = new Map<string, number>();
  private readonly lastWebsiteTickerDataRevision = new Map<string, number>();
  private readonly lastWebsiteTechnicalContextPublishAt = new Map<string, number>();
  private readonly lastWebsiteTechnicalContextStateKey = new Map<string, string>();
  private readonly lastWebsitePullbackReadPublishAt = new Map<string, number>();
  private readonly lastWebsitePullbackReadStateKey = new Map<string, string>();
  private liveTraderReadCardVisible = resolveInitialLiveTraderReadCardVisible();
  private potentialGainCardVisible = resolveInitialPotentialGainCardVisible();
  private readonly technicalContextBySymbol = new Map<string, TechnicalContext>();
  private readonly potentialMoveReadBySymbol = new Map<string, PotentialMoveRead>();
  private readonly tradeSetupThesisReadBySymbol = new Map<string, PotentialMoveRead>();
  private readonly chartThesisLevelOutputBySymbol = new Map<string, LevelEngineOutput>();
  private readonly chartThesisSeriesMapBySymbol = new Map<string, Record<CandleTimeframe, CandleProviderResponse>>();
  private readonly recentWebsiteArticleFreshnessBySymbol = new Map<string, RecentWebsiteArticleCatalystFreshness>();
  private readonly pressReleaseCatalystContextBySymbol = new Map<string, PressReleaseCatalystContext>();
  private readonly priorRegularCloseBySymbol = new Map<string, PriorRegularCloseReference>();
  private readonly priorRegularCloseRefreshInFlight = new Set<string>();
  private readonly lastPriorRegularCloseRefreshAt = new Map<string, number>();
  private readonly technicalContextCandleStore = new LiveDerivedFiveMinuteCandleStore();
  private readonly technicalContextProviderBySymbol = new Map<string, string | null>();
  private readonly technicalContextDataQualityFlagsBySymbol = new Map<string, string[]>();
  private readonly technicalContextBootstrapRetryTimers = new Map<string, NodeJS.Timeout>();
  private readonly technicalContextBootstrapRetryAttempts = new Map<string, number>();
  private readonly technicalContextBootstrapRefreshInFlight = new Set<string>();
  private pullbackReadIntradayPollTimer: NodeJS.Timeout | null = null;
  private pullbackReadIntradayPollInFlight = false;
  private lastThreadPostAt: number | null = null;
  private lastThreadPostSymbol: string | null = null;
  private lastThreadPostKind: LiveThreadPostKind | null = null;
  private lastThreadPostReason: string | null = null;
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
    this.liveTraderReadCardVisible =
      options.initialLiveTraderReadCardVisible ?? resolveInitialLiveTraderReadCardVisible();
    this.potentialGainCardVisible =
      options.initialPotentialGainCardVisible ?? resolveInitialPotentialGainCardVisible();
    if (options.initialTradersLinkAiReadDailyCostBudget) {
      this.setTradersLinkAiReadDailyCostBudget(
        options.initialTradersLinkAiReadDailyCostBudget,
      );
    }
    this.marketStructureStoryMemoryPath = options.marketStructureStoryMemoryPath?.trim() || null;
    this.marketStructureStandalonePostMode = resolveMarketStructureStandalonePostMode(
      options.marketStructureStandalonePostMode,
    );
    this.liveWatchlistPublisher =
      options.liveWatchlistPublisher === undefined
        ? createLiveWatchlistPublisherFromEnv()
        : options.liveWatchlistPublisher;
    this.levelProvenanceMode = resolveLiveWatchlistLevelProvenanceMode(
      options.levelProvenanceMode ??
        process.env[LIVE_WATCHLIST_LEVEL_PROVENANCE_MODE_ENV],
    );
    this.loadMarketStructureStoryMemory();

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
    this.startupCachedLevelEngine = options.startupCachedCandleFetchService
      ? new LevelEngine(options.startupCachedCandleFetchService, undefined, {
          runtimeMode: runtimeSettings.mode,
          compareActivePath: runtimeSettings.compareActivePath,
        })
      : null;
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
    this.fastLevelClearCoalesceMs = Math.max(
      0,
      options.fastLevelClearCoalesceMs ?? FAST_LEVEL_CLEAR_COALESCE_MS,
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

  private restoreTradersLinkAiReadRefreshStates(activeEntries: WatchlistEntry[]): void {
    let archivedBySymbol = new Map<string, unknown>();
    try {
      const archive = new LiveWatchlistAuditArchivePersistence(
        process.env.LIVE_WATCHLIST_AUDIT_ARCHIVE_PATH?.trim() ||
          DEFAULT_LIVE_WATCHLIST_AUDIT_ARCHIVE_FILE,
      ).load();
      archivedBySymbol = new Map(
        archive.symbols.map((symbol) => [normalizeSymbol(symbol.symbol), symbol]),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[TradersLinkAiRead] Could not recover published read boundaries: ${message}`);
    }

    for (const entry of activeEntries) {
      let state = entry.tradersLinkAiReadBoundaryState;
      if (!state) {
        const archived = archivedBySymbol.get(entry.symbol) as
          | { cards?: Record<string, { body?: unknown } | null> }
          | undefined;
        const recovered = parseArchivedTradersLinkAiReadRefreshState(
          archived?.cards?.tradersLinkAiRead?.body,
        );
        if (
          recovered &&
          (entry.activatedAt === undefined || recovered.generatedAt >= entry.activatedAt)
        ) {
          state = recovered;
          this.watchlistStore.patchEntry(entry.symbol, {
            tradersLinkAiReadBoundaryState: recovered,
          });
        }
      }
      if (state) {
        this.aiReadState.set(entry.symbol, state);
      }
    }
  }

  isTradersLinkAiReadConfigured(): boolean {
    return Boolean(
      this.options.tradersLinkAiReadService && this.liveWatchlistPublisher,
    );
  }

  getTradersLinkAiReadDailyCostBudget(): { enabled: boolean; dailyLimitUsd: number } {
    return { ...this.tradersLinkAiReadDailyCostBudget };
  }

  setTradersLinkAiReadDailyCostBudget(input: {
    enabled: boolean;
    dailyLimitUsd: number;
  }): { enabled: boolean; dailyLimitUsd: number } {
    if (!Number.isFinite(input.dailyLimitUsd) || input.dailyLimitUsd < 0.01 || input.dailyLimitUsd > 10_000) {
      throw new Error("The TradersLink AI Read daily budget must be between $0.01 and $10,000.00.");
    }
    this.tradersLinkAiReadDailyCostBudget = {
      enabled: input.enabled === true,
      dailyLimitUsd: Math.round(input.dailyLimitUsd * 100) / 100,
    };
    return this.getTradersLinkAiReadDailyCostBudget();
  }

  getTradersLinkAiReadDailyCostBudgetStatus() {
    const ledger = this.options.tradersLinkAiReadCostLedger;
    if (!ledger) {
      return {
        ...this.tradersLinkAiReadDailyCostBudget,
        spentUsd: 0,
        projectedNextRequestUsd: 0,
        remainingUsd: this.tradersLinkAiReadDailyCostBudget.dailyLimitUsd,
        canStartRequest: !this.tradersLinkAiReadDailyCostBudget.enabled,
        blockReason: this.tradersLinkAiReadDailyCostBudget.enabled
          ? "Expense ledger is unavailable, so the budget guard cannot safely estimate today's spend."
          : null,
      };
    }
    return ledger.getDailyCostBudgetStatus(this.tradersLinkAiReadDailyCostBudget);
  }

  private async buildTradersLinkAiReadPriceActionContext(
    symbolInput: string,
    dataAsOf: number,
  ): Promise<TradersLinkAiReadPriceActionContext> {
    const symbol = normalizeSymbol(symbolInput);
    const storedSeries = this.chartThesisSeriesMapBySymbol.get(symbol);
    let intradayCandles = normalizePullbackCandles(
      this.technicalContextCandleStore.getCandles(symbol),
    );
    let dailyCandles = normalizePullbackCandles(storedSeries?.daily.candles ?? []);
    let source = this.technicalContextProviderBySymbol.get(symbol) ?? "runtime raw OHLCV";
    let recentIntradayProvider = source;
    const service = this.options.recentIntradayCandleFetchService;
    const historicalLoader = this.options.tradersLinkAiReadHistoricalCandleLoader;
    const fetchAsOf = Math.max(dataAsOf, Date.now());

    if (service) {
      const [intradayResult, dailyResult] = await Promise.allSettled([
        service.fetchCandles({
          symbol,
          timeframe: "5m",
          lookbackBars: TRADERSLINK_AI_READ_5M_FETCH_BARS,
          endTimeMs: fetchAsOf,
          preferredProvider: "yahoo",
        }),
        service.fetchCandles({
          symbol,
          timeframe: "daily",
          lookbackBars: TRADERSLINK_AI_READ_DAILY_FETCH_BARS,
          endTimeMs: fetchAsOf,
          preferredProvider: "yahoo",
        }),
      ]);
      if (intradayResult.status === "fulfilled") {
        const fetchedIntraday = normalizePullbackCandles(intradayResult.value.candles);
        if (fetchedIntraday.length > 0) {
          intradayCandles = fetchedIntraday;
          recentIntradayProvider = intradayResult.value.provider;
          source = `${intradayResult.value.provider} full-session OHLCV`;
        }
      }
      if (dailyResult.status === "fulfilled") {
        const fetchedDaily = normalizePullbackCandles(dailyResult.value.candles);
        if (fetchedDaily.length > 0) {
          dailyCandles = fetchedDaily;
        }
      }
    }

    if (historicalLoader) {
      const completedWindow = buildTradersLinkAiCompletedSessionWindow(
        intradayCandles,
        fetchAsOf,
      );
      const completedIntradayPromise = completedWindow
        ? historicalLoader({
            symbol,
            fromTimeMs: completedWindow.fromTimeMs,
            toTimeMs: completedWindow.toTimeMs,
            timeframes: ["5m"],
            nowMs: fetchAsOf,
          })
        : Promise.resolve(null);
      const dailyPromise = historicalLoader({
        symbol,
        fromTimeMs: fetchAsOf - 120 * 24 * 60 * 60 * 1_000,
        toTimeMs: fetchAsOf,
        timeframes: ["daily"],
        nowMs: fetchAsOf,
      });
      const [completedIntradayResult, historicalDailyResult] = await Promise.allSettled([
        completedIntradayPromise,
        dailyPromise,
      ]);

      if (completedIntradayResult.status === "fulfilled" && completedIntradayResult.value) {
        const historicalSeries = completedIntradayResult.value.series.find(
          (series) => series.timeframe === "5m",
        );
        const historicalCandles = normalizePullbackCandles(historicalSeries?.candles ?? []);
        if (historicalSeries && historicalCandles.length > 0) {
          intradayCandles = mergeTradersLinkAiIntradayCandles(
            intradayCandles,
            historicalCandles,
            fetchAsOf,
          );
          source = `${recentIntradayProvider} current-session + ${historicalSeries.provider} completed-session OHLCV`;
        }
      } else if (completedIntradayResult.status === "rejected") {
        const message = completedIntradayResult.reason instanceof Error
          ? completedIntradayResult.reason.message
          : String(completedIntradayResult.reason);
        console.warn(
          `[TradersLinkAiRead] Completed-session candle lookup failed for ${symbol}; using recent-provider history: ${message}`,
        );
      }

      if (historicalDailyResult.status === "fulfilled") {
        const dailySeries = historicalDailyResult.value.series.find(
          (series) => series.timeframe === "daily",
        );
        const historicalDailyCandles = normalizePullbackCandles(dailySeries?.candles ?? []);
        if (historicalDailyCandles.length > 0) {
          dailyCandles = historicalDailyCandles;
        }
      } else {
        const message = historicalDailyResult.reason instanceof Error
          ? historicalDailyResult.reason.message
          : String(historicalDailyResult.reason);
        console.warn(
          `[TradersLinkAiRead] Historical daily candle lookup failed for ${symbol}; using Yahoo daily fallback: ${message}`,
        );
      }
    }

    return {
      source,
      fetchedAt: Date.now(),
      priorRegularClose: this.priorRegularCloseBySymbol.get(symbol)?.price ?? null,
      intradayCandles,
      dailyCandles,
    };
  }

  private async generateTradersLinkAiRead(
    symbolInput: string,
    force: boolean,
    requestedTrigger: TradersLinkAiReadRequestedTrigger,
  ): Promise<TradersLinkAiReadPayload | null> {
    const service = this.options.tradersLinkAiReadService;
    const publisher = this.liveWatchlistPublisher;
    const symbol = normalizeSymbol(symbolInput);
    const entry = this.watchlistStore.getEntry(symbol);
    if (!service || !publisher || !entry?.active || entry.tradersLinkAiReadCardVisible === false) {
      return null;
    }
    if (this.aiReadInFlight.has(symbol)) {
      return null;
    }

    const currentPrice = entry.lastPrice;
    const dataAsOf = entry.lastPriceUpdateAt ?? Date.now();
    if (!Number.isFinite(currentPrice) || (currentPrice ?? 0) <= 0) {
      return null;
    }
    const snapshot = this.buildLevelSnapshotPayload(symbol, dataAsOf, currentPrice);
    if (!Number.isFinite(snapshot.currentPrice) || snapshot.currentPrice <= 0) {
      return null;
    }

    const refreshDecision = decideTradersLinkAiReadRefresh({
      previous: this.aiReadState.get(symbol) ?? null,
      currentPrice: snapshot.currentPrice,
      dataAsOf,
      force,
      requestedTrigger,
      allowInitialGeneration: !this.aiReadInitialGenerationSuppressedSymbols.has(symbol),
    });
    if (!refreshDecision.shouldRefresh) {
      return null;
    }

    const budgetStatus = this.getTradersLinkAiReadDailyCostBudgetStatus();
    if (!budgetStatus.canStartRequest) {
      console.warn(
        `[TradersLinkAiRead] Skipped ${symbol}: ${budgetStatus.blockReason ?? "daily budget guard blocked the new request"}`,
      );
      return null;
    }

    this.aiReadInFlight.add(symbol);
    try {
      const priceActionPromise = this.buildTradersLinkAiReadPriceActionContext(symbol, dataAsOf);
      let research;
      try {
        research = await lookupRecentWebsiteArticlesForSymbol({
          symbol,
          execFileImpl: this.options.recentWebsiteArticlesExecFileImpl,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[TradersLinkAiRead] Primary press-release/SEC lookup failed for ${symbol}: ${message}`,
        );
        research = {
          ticker: symbol,
          businessDays: 5,
          count: 0,
          articles: [],
        };
      }

      const priceAction = await priceActionPromise;
      let recordedAttemptCount = 0;
      const read = await service.generate({
        snapshot,
        research,
        priceAction,
        dataAsOf,
        onAttempt: (attempt) => {
          this.options.tradersLinkAiReadCostLedger?.recordAttempt({
            attempt,
            trigger: refreshDecision.trigger,
          });
          recordedAttemptCount += 1;
        },
      });
      if (recordedAttemptCount === 0) {
        this.options.tradersLinkAiReadCostLedger?.record({
          read,
          trigger: refreshDecision.trigger,
        });
      }
      const latestEntry = this.watchlistStore.getEntry(symbol);
      if (!latestEntry?.active || latestEntry.tradersLinkAiReadCardVisible === false) {
        return null;
      }
      try {
        await publisher.publish(buildTradersLinkAiReadPatch({ read, visible: true }));
      } catch (error) {
        this.options.tradersLinkAiReadCostLedger?.recordPublishFailure({
          read,
          trigger: refreshDecision.trigger,
          error,
        });
        throw error;
      }
      const nextRefreshState = {
        ...buildTradersLinkAiReadRefreshState(read),
        lastAutomaticRefreshRegime: refreshDecision.automaticRefreshRegime,
      };
      this.aiReadState.set(symbol, nextRefreshState);
      this.watchlistStore.patchEntry(symbol, {
        tradersLinkAiReadBoundaryState: nextRefreshState,
      });
      this.persistWatchlist();
      this.aiReadInitialGenerationSuppressedSymbols.delete(symbol);
      return read;
    } finally {
      this.aiReadInFlight.delete(symbol);
    }
  }

  private scheduleTradersLinkAiRead(
    symbol: string,
    force: boolean,
    trigger: TradersLinkAiReadRequestedTrigger,
  ): void {
    void this.generateTradersLinkAiRead(symbol, force, trigger).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[TradersLinkAiRead] Failed to generate ${normalizeSymbol(symbol)} read: ${message}`);
    });
  }

  async refreshTradersLinkAiRead(symbolInput: string): Promise<TradersLinkAiReadPayload | null> {
    if (!this.isTradersLinkAiReadConfigured()) {
      throw new Error("TradersLink AI Read is not configured.");
    }
    const symbol = normalizeSymbol(symbolInput);
    const entry = this.watchlistStore.getEntry(symbol);
    if (!entry?.active) {
      throw new Error(`${symbol} is not active.`);
    }
    return this.generateTradersLinkAiRead(symbol, true, "manual");
  }

  async setTradersLinkAiReadCardVisible(
    symbolInput: string,
    visible: boolean,
  ): Promise<WatchlistEntry | null> {
    const symbol = normalizeSymbol(symbolInput);
    const entry = this.watchlistStore.patchEntry(symbol, {
      tradersLinkAiReadCardVisible: visible,
    });
    if (!entry) {
      return null;
    }
    this.persistWatchlist();
    if (this.liveWatchlistPublisher) {
      await this.liveWatchlistPublisher.publish(
        buildTradersLinkAiReadVisibilityPatch({ symbol, visible }),
      );
    }
    if (visible) {
      this.scheduleTradersLinkAiRead(symbol, true, "visibility_enabled");
    }
    return entry;
  }

  private loadMarketStructureStoryMemory(): void {
    if (!this.marketStructureStoryMemoryPath || !existsSync(this.marketStructureStoryMemoryPath)) {
      return;
    }

    try {
      const snapshot = JSON.parse(
        readFileSync(this.marketStructureStoryMemoryPath, "utf8"),
      ) as MarketStructureStoryMemorySnapshot;
      this.marketStructureStoryMemory.hydrate(snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ManualWatchlistRuntimeManager] Failed to load market structure story memory: ${message}`);
    }
  }

  private persistMarketStructureStoryMemory(): void {
    if (!this.marketStructureStoryMemoryPath) {
      return;
    }

    try {
      mkdirSync(dirname(this.marketStructureStoryMemoryPath), { recursive: true });
      writeFileSync(
        this.marketStructureStoryMemoryPath,
        `${JSON.stringify(this.marketStructureStoryMemory.toSnapshot(), null, 2)}\n`,
        "utf8",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ManualWatchlistRuntimeManager] Failed to persist market structure story memory: ${message}`);
    }
  }

  private setEntryOperation(symbol: string, operationStatus: string | null): void {
    this.watchlistStore.patchEntry(symbol, {
      operationStatus: operationStatus ?? undefined,
    });
  }

  private setLevelsReadyOperation(symbol: string): void {
    const entry = this.watchlistStore.getEntry(symbol);
    this.setEntryOperation(
      symbol,
      entry?.active && entry.lifecycle === "active" ? "monitoring live price" : "levels ready",
    );
  }

  private markSeededLevelsReady(symbol: string): void {
    const entry = this.watchlistStore.getEntry(symbol);
    if (
      !entry?.active ||
      entry.lifecycle === "activating" ||
      entry.lifecycle === "activation_failed" ||
      entry.lifecycle === "inactive"
    ) {
      return;
    }

    this.watchlistStore.patchEntry(symbol, {
      lifecycle: "active",
      refreshPending: false,
      lastError: null,
      operationStatus: "monitoring live price",
    });
  }

  private isEntryActive(symbol: string): boolean {
    const entry = this.watchlistStore.getEntry(symbol);
    return Boolean(entry?.active && entry.lifecycle !== "inactive" && entry.lifecycle !== "activation_failed");
  }

  private isEntryAvailableForActivationWork(symbol: string): boolean {
    const entry = this.watchlistStore.getEntry(symbol);
    return Boolean(
      entry &&
      (this.isEntryActive(symbol) ||
        (!entry.active && entry.lifecycle === "activating")),
    );
  }

  private markSnapshotReady(symbol: string, timestamp?: number): void {
    const entry = this.watchlistStore.getEntry(symbol);
    const pendingActivation = entry?.active === false && entry.lifecycle === "activating";
    this.watchlistStore.patchEntry(symbol, pendingActivation
      ? {
          ...(timestamp !== undefined ? { lastLevelPostAt: timestamp } : {}),
          refreshPending: true,
          lastError: null,
          operationStatus: "snapshot ready; preparing live monitoring",
        }
      : {
          active: true,
          lifecycle: "active",
          ...(timestamp !== undefined ? { lastLevelPostAt: timestamp } : {}),
          refreshPending: false,
          lastError: null,
          operationStatus: "monitoring live price",
        });
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

    const entry = this.watchlistStore.getEntry(symbol);
    if (
      !this.isActivationCurrent(symbol, epoch) ||
      !entry ||
      entry.lifecycle === "inactive"
    ) {
      throw new ActivationCancelledError(symbol);
    }
  }

  private resolveSnapshotReferencePrice(
    symbol: string,
    timestamp: number,
    referencePriceOverride?: number,
  ): SnapshotReferencePrice {
    const levels = this.options.levelStore.getLevels(symbol);
    const metadataReferencePrice = levels?.metadata.referencePrice;

    if (
      typeof referencePriceOverride === "number" &&
      Number.isFinite(referencePriceOverride) &&
      referencePriceOverride > 0
    ) {
      return {
        price: referencePriceOverride,
        source: "override",
        metadataReferencePrice,
      };
    }

    const entry = this.watchlistStore.getEntry(symbol);
    if (
      typeof entry?.lastPrice === "number" &&
      Number.isFinite(entry.lastPrice) &&
      entry.lastPrice > 0 &&
      typeof entry.lastPriceUpdateAt === "number" &&
      Number.isFinite(entry.lastPriceUpdateAt)
    ) {
      const livePriceAgeMs = Math.max(0, timestamp - entry.lastPriceUpdateAt);
      if (livePriceAgeMs <= SNAPSHOT_LIVE_REFERENCE_MAX_AGE_MS) {
        return {
          price: entry.lastPrice,
          source: "live_price",
          livePriceAgeMs,
          metadataReferencePrice,
        };
      }
    }

    return {
      price: metadataReferencePrice ?? 0,
      source: "level_metadata",
      metadataReferencePrice,
    };
  }

  private buildLevelSnapshotPayload(
    symbol: string,
    timestamp: number,
    referencePriceOverride?: number,
  ): LevelSnapshotPayload {
    const referencePrice = this.resolveSnapshotReferencePrice(
      symbol,
      timestamp,
      referencePriceOverride,
    );
    const currentPrice = referencePrice.price;
    const normalizedPrice = Math.max(currentPrice, 0);
    const tolerance = snapshotPriceTolerance(Math.max(normalizedPrice, 0.0001));
    const levelsOutput = this.options.levelStore.getLevels(symbol);
    const websiteSpecialLevels = this.resolveWebsiteSpecialLevels(symbol, levelsOutput);
    const priorRegularClose = this.priorRegularCloseBySymbol.get(symbol) ?? null;
    const forwardResistanceRangePct = snapshotForwardResistanceRangePct(normalizedPrice);
    const maxForwardResistancePrice =
      normalizedPrice * (1 + forwardResistanceRangePct);
    const surfacedSupportZones = this.options.levelStore.getSupportZones(symbol);
    const surfacedResistanceZones = this.options.levelStore.getResistanceZones(symbol);
    const extensionResistanceCandidates = levelsOutput?.extensionLevels.resistance ?? [];
    const extensionResistanceZones = extensionResistanceCandidates.filter(
      (zone) =>
        isSnapshotZoneDisplayableForSide(zone, normalizedPrice, tolerance, "resistance") &&
        zone.zoneLow <= maxForwardResistancePrice,
    );
    const displayableSupportBase = surfacedSupportZones.filter((zone) =>
      isSnapshotZoneDisplayableForSide(zone, normalizedPrice, tolerance, "support"),
    );
    const displayableResistanceBase = [...surfacedResistanceZones, ...extensionResistanceZones].filter(
      (zone) =>
        isSnapshotZoneDisplayableForSide(zone, normalizedPrice, tolerance, "resistance") &&
        zone.zoneLow <= maxForwardResistancePrice,
    );
    const supportCandidatesForDisplay = buildSnapshotSideZones({
      primaryZones: displayableSupportBase,
      oppositeZones: surfacedResistanceZones,
      currentPrice: normalizedPrice,
      tolerance,
      side: "support",
      maxForwardResistancePrice,
    });
    const resistanceCandidatesForDisplay = buildSnapshotSideZones({
      primaryZones: displayableResistanceBase,
      oppositeZones: surfacedSupportZones,
      currentPrice: normalizedPrice,
      tolerance,
      side: "resistance",
      maxForwardResistancePrice,
    });
    const resistanceCandidatesWithOuterAnchor = addSnapshotStructuralOuterResistanceAnchor({
      zones: resistanceCandidatesForDisplay,
      allCandidates: [...surfacedResistanceZones, ...extensionResistanceCandidates],
      currentPrice: normalizedPrice,
      tolerance,
      maxForwardResistancePrice,
    });
    const resistanceCandidatesWithContinuationMap = addSnapshotContinuationResistanceMap({
      zones: resistanceCandidatesWithOuterAnchor,
      currentPrice: normalizedPrice,
      maxForwardResistancePrice,
      symbol,
      timestamp,
    });
    const supportProvenancePolicy = applySnapshotLevelProvenancePolicy({
      zones: supportCandidatesForDisplay,
      currentPrice: normalizedPrice,
      timestamp,
      side: "support",
      mode: this.levelProvenanceMode,
    });
    const resistanceProvenancePolicy = applySnapshotLevelProvenancePolicy({
      zones: resistanceCandidatesWithContinuationMap,
      currentPrice: normalizedPrice,
      timestamp,
      side: "resistance",
      mode: this.levelProvenanceMode,
    });
    const supportZones = compactSnapshotZones(
      supportProvenancePolicy.zones,
      normalizedPrice,
      "support",
    );
    const ladderSupportZones = sortSnapshotZones(
      supportProvenancePolicy.zones,
      "support",
    );
    const resistanceZones = compactSnapshotZones(
      resistanceProvenancePolicy.zones,
      normalizedPrice,
      "resistance",
    );
    const ladderResistanceZones = sortSnapshotZones(
      resistanceProvenancePolicy.zones,
      "resistance",
    );
    const supportDisplayZones = buildSnapshotDisplayZones(supportZones, normalizedPrice, "support");
    const resistanceDisplayZones = buildSnapshotDisplayZones(
      resistanceZones,
      normalizedPrice,
      "resistance",
    );
    const ladderSupportDisplayZones = buildSnapshotDisplayZones(
      ladderSupportZones,
      normalizedPrice,
      "support",
    );
    const ladderResistanceDisplayZones = buildSnapshotDisplayZones(
      ladderResistanceZones,
      normalizedPrice,
      "resistance",
    );
    const technicalContext = this.technicalContextBySymbol.get(symbol) ?? null;
    const refreshedTechnicalContext = technicalContext === null
      ? null
      : refreshTechnicalContextForPrice(technicalContext, normalizedPrice);
    const availableTimeframes = levelsOutput?.metadata.availableTimeframes ??
      (["daily", "4h", "5m"] as const).filter(
        (timeframe) => levelsOutput?.metadata.providerByTimeframe[timeframe] !== undefined,
      );
    const levelCoverage = levelsOutput?.metadata.coverage ??
      (availableTimeframes.length === 3 ? "full" : "limited");
    const roleFlipCandles = this.technicalContextCandleStore.getCandles(symbol);

    return {
      symbol,
      currentPrice: normalizedPrice,
      supportZones: supportDisplayZones,
      resistanceZones: resistanceDisplayZones,
      ladderSupportZones: ladderSupportDisplayZones,
      ladderResistanceZones: ladderResistanceDisplayZones,
      timestamp,
      audit: buildSnapshotAudit({
        currentPrice: normalizedPrice,
        tolerance,
        maxForwardResistancePrice,
        referencePriceSource: referencePrice.source,
        livePriceAgeMs: referencePrice.livePriceAgeMs,
        metadataReferencePrice: referencePrice.metadataReferencePrice,
        surfacedSupportZones,
        surfacedResistanceZones,
        extensionResistanceZones: extensionResistanceCandidates,
        displayedSupportZones: supportZones,
        displayedResistanceZones: resistanceZones,
        supportProvenancePolicy,
        resistanceProvenancePolicy,
      }),
      marketStructure: this.getMarketStructureSnapshot(symbol),
      potentialMoveRead: this.potentialMoveReadBySymbol.get(symbol) ?? null,
      tradeSetupThesisRead: this.tradeSetupThesisReadBySymbol.get(symbol) ?? null,
      technicalContext: refreshedTechnicalContext,
      priorRegularClosePrice: priorRegularClose?.price ?? null,
      priorRegularCloseSource: priorRegularClose?.source ?? null,
      specialLevels: websiteSpecialLevels,
      levelDataQuality: {
        status: levelCoverage,
        availableTimeframes: [...availableTimeframes],
        flags: levelsOutput?.metadata.dataQualityFlags ?? [],
        ...(levelCoverage === "limited"
          ? { message: "Limited-history map: use the available intraday structure, but verify higher-timeframe levels manually." }
          : {}),
      },
      roleFlipContext: {
        ...buildRecentAtrRoleFlipContext(roleFlipCandles, normalizedPrice, timestamp),
        tickSize: inferredSmallCapTickSize(normalizedPrice),
      },
    };
  }

  private resolveWebsiteSpecialLevels(
    symbolInput: string,
    levelsOutput: LevelEngineOutput | null | undefined = this.options.levelStore.getLevels(symbolInput),
  ): LevelSnapshotPayload["specialLevels"] {
    const symbol = normalizeSymbol(symbolInput);
    const liveCandles = this.technicalContextCandleStore.getCandles(symbol);
    const liveSpecialLevels = liveCandles.length > 0
      ? buildSpecialLevelCandidates(symbol, liveCandles, []).summary
      : undefined;
    return mergeWebsiteSpecialLevels(levelsOutput?.specialLevels, liveSpecialLevels);
  }

  private buildLevelExtensionPayload(
    symbol: string,
    side: LevelExtensionSide,
    timestamp: number,
  ): LevelExtensionPayload | null {
    const rawZones =
      side === "resistance"
        ? this.options.levelStore.getExtensionResistanceZones(symbol)
        : this.options.levelStore.getExtensionSupportZones(symbol);
    const snapshotState = this.activeSnapshotState.get(symbol);
    const levelsOutput = this.options.levelStore.getLevels(symbol);
    const referencePrice =
      snapshotState?.referencePrice ?? levelsOutput?.metadata.referencePrice ?? null;
    const entry = this.watchlistStore.getEntry(symbol);
    const livePrice =
      typeof entry?.lastPrice === "number" &&
      Number.isFinite(entry.lastPrice) &&
      entry.lastPrice > 0 &&
      typeof entry.lastPriceUpdateAt === "number" &&
      Number.isFinite(entry.lastPriceUpdateAt) &&
      Math.max(0, timestamp - entry.lastPriceUpdateAt) <= EXTENSION_LIVE_REFERENCE_MAX_AGE_MS
        ? entry.lastPrice
        : null;
    const referenceTolerance =
      typeof referencePrice === "number" && Number.isFinite(referencePrice) && referencePrice > 0
        ? snapshotPriceTolerance(referencePrice)
        : 0;
    const referenceFilteredZones =
      typeof referencePrice === "number" && Number.isFinite(referencePrice) && referencePrice > 0
        ? rawZones.filter((zone) =>
            side === "resistance"
              ? zone.zoneHigh > referencePrice + referenceTolerance
              : zone.zoneLow < referencePrice - referenceTolerance,
          )
        : rawZones;
    const clearedLevel =
      side === "resistance"
        ? snapshotState?.lastClearedResistance ?? null
        : snapshotState?.lastClearedSupport ?? null;
    const clearedFilteredZones =
      typeof clearedLevel === "number" && Number.isFinite(clearedLevel) && clearedLevel > 0
        ? referenceFilteredZones.filter((zone) => {
            const tolerance = snapshotPriceTolerance(clearedLevel);
            return side === "resistance"
              ? zone.zoneHigh > clearedLevel + tolerance
              : zone.zoneLow < clearedLevel - tolerance;
          })
        : referenceFilteredZones;
    const liveFilteredZones =
      livePrice !== null
        ? clearedFilteredZones.filter((zone) => {
            const tolerance = snapshotPriceTolerance(livePrice);
            return side === "resistance"
              ? zone.zoneHigh > livePrice + tolerance
              : zone.zoneLow < livePrice - tolerance;
          })
        : [];
    const zones = liveFilteredZones.length > 0 ? liveFilteredZones : clearedFilteredZones;
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
    allowPendingActivation = false,
  ): Promise<LevelSnapshotPayload | null> {
    if (
      !this.isEntryActive(symbol) &&
      !(allowPendingActivation && this.isEntryAvailableForActivationWork(symbol))
    ) {
      return null;
    }

    this.setEntryOperation(symbol, "posting level snapshot");
    const payload = this.buildLevelSnapshotPayload(symbol, timestamp, referencePriceOverride);
    if (payload.audit?.referencePriceSource === "live_price" && payload.currentPrice > 0) {
      const entry = this.watchlistStore.getEntry(symbol);
      const quoteTimestamp =
        typeof entry?.lastPriceUpdateAt === "number" && Number.isFinite(entry.lastPriceUpdateAt)
          ? entry.lastPriceUpdateAt
          : payload.timestamp;
      this.publishLiveTickerData({
        symbol,
        timestamp: quoteTimestamp,
        lastPrice: payload.currentPrice,
      }, { force: true });
    }
    const snapshotKey = JSON.stringify({
      symbol: payload.symbol,
      supportZones: payload.supportZones,
      resistanceZones: payload.resistanceZones,
    });
    const existingState = this.activeSnapshotState.get(symbol);
    const candidateLevelCount =
      (payload.audit?.supportCandidates.length ?? 0) +
      (payload.audit?.resistanceCandidates.length ?? 0);
    const hasDisplayedLevels =
      payload.supportZones.length > 0 || payload.resistanceZones.length > 0;

    if (!hasDisplayedLevels && candidateLevelCount > 0) {
      this.activeSnapshotState.set(symbol, {
        lastSnapshot: snapshotKey,
        highestResistance: null,
        lowestSupport: null,
        referencePrice: payload.currentPrice,
        displayedSupportZones: payload.supportZones,
        displayedResistanceZones: payload.resistanceZones,
        lastRefreshTriggerResistance: null,
        lastRefreshTriggerSupport: null,
        lastRefreshTimestamp: timestamp,
        lastExtensionPostKey: null,
        lastExtensionPostTimestamp: null,
        extensionPostInFlightKey: null,
      });
      this.markSnapshotReady(symbol);
      this.emitLifecycle("alert_suppressed", {
        symbol,
        threadId,
        details: {
          eventType: "level_snapshot",
          reason: "snapshot_no_actionable_levels",
          supportCount: payload.supportZones.length,
          resistanceCount: payload.resistanceZones.length,
          candidateLevelCount,
          currentPrice: payload.currentPrice,
        },
      });
      return null;
    }

    if (existingState?.lastSnapshot === snapshotKey) {
      if (
        !this.isEntryActive(symbol) &&
        !(allowPendingActivation && this.isEntryAvailableForActivationWork(symbol))
      ) {
        return null;
      }
      this.activeSnapshotState.set(symbol, {
        ...existingState,
        highestResistance: payload.resistanceZones.at(-1)?.representativePrice ?? null,
        lowestSupport: payload.supportZones.at(-1)?.representativePrice ?? null,
        referencePrice: payload.currentPrice,
        displayedSupportZones: payload.supportZones,
        displayedResistanceZones: payload.resistanceZones,
      });
      this.markSnapshotReady(symbol, timestamp);
      return payload;
    }

    await this.options.discordAlertRouter.routeLevelSnapshot(threadId, payload);
    if (
      !this.isEntryActive(symbol) &&
      !(allowPendingActivation && this.isEntryAvailableForActivationWork(symbol))
    ) {
      return null;
    }
    this.recordLiveThreadPost({
      symbol,
      timestamp,
      kind: "snapshot",
      critical: true,
      eventType: null,
      whyPosted: "level snapshot posted after candle seeding",
    });
    const postedMarketStructureKeys = this.marketStructureStoryMemory.markPosted(
      symbol,
      timestamp,
      payload.marketStructure,
    );
    if (postedMarketStructureKeys.length > 0) {
      this.persistMarketStructureStoryMemory();
    }
    this.emitLifecycle("snapshot_posted", {
      symbol,
      threadId,
      details: {
        supportCount: payload.supportZones.length,
        resistanceCount: payload.resistanceZones.length,
        currentPrice: payload.currentPrice,
        referencePriceSource: payload.audit?.referencePriceSource ?? null,
        metadataReferencePrice: payload.audit?.metadataReferencePrice ?? null,
      },
    });
    this.activeSnapshotState.set(symbol, {
      lastSnapshot: snapshotKey,
      highestResistance: payload.resistanceZones.at(-1)?.representativePrice ?? null,
      lowestSupport: payload.supportZones.at(-1)?.representativePrice ?? null,
      referencePrice: payload.currentPrice,
      displayedSupportZones: payload.supportZones,
      displayedResistanceZones: payload.resistanceZones,
      lastRefreshTriggerResistance: null,
      lastRefreshTriggerSupport: null,
      lastRefreshTimestamp: timestamp,
      lastExtensionPostKey: null,
      lastExtensionPostTimestamp: null,
      extensionPostInFlightKey: null,
    });
    this.markSnapshotReady(symbol, timestamp);
    return payload;
  }

  private triggerAutoCleanRead(params: {
    symbol: string;
    threadId: string;
    payload: LevelSnapshotPayload | null;
  }): void {
    const autoCleanReadGenerator = this.options.autoCleanReadGenerator;
    if (!autoCleanReadGenerator || !params.payload) {
      return;
    }

    const ladderText = formatLevelLadderMessage(params.payload);
    if (!ladderText) {
      return;
    }

    const entry = this.watchlistStore.getEntry(params.symbol);
    this.emitLifecycle("ai_clean_read_requested", {
      symbol: params.symbol,
      threadId: params.threadId,
      details: {
        currentPrice: params.payload.currentPrice,
        hasPromptNotes: Boolean(entry?.note),
      },
    });

    const input = {
      symbol: params.symbol,
      currentPrice: formatSnapshotLevel(params.payload.currentPrice),
      ladderText,
      aiPromptNotes: entry?.note,
    };

    void (async () => {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= AUTO_CLEAN_READ_MAX_ATTEMPTS; attempt += 1) {
        try {
          if (attempt > 1) {
            this.emitLifecycle("ai_clean_read_retrying", {
              symbol: params.symbol,
              threadId: params.threadId,
              details: {
                attempt,
                maxAttempts: AUTO_CLEAN_READ_MAX_ATTEMPTS,
              },
            });
          }

          const result = await autoCleanReadGenerator(input);
          if (attempt > 1) {
            this.emitLifecycle("ai_clean_read_retry_succeeded", {
              symbol: params.symbol,
              threadId: params.threadId,
              details: {
                attempt,
                recordId: result?.id ?? null,
                model: result?.model ?? null,
              },
            });
          }
          return result;
        } catch (error) {
          lastError = error;
          if (attempt < AUTO_CLEAN_READ_MAX_ATTEMPTS && isAbortLikeError(error)) {
            await delay(AUTO_CLEAN_READ_RETRY_DELAY_MS);
            continue;
          }
          throw error;
        }
      }

      throw lastError;
    })()
      .then((result) => {
        this.emitLifecycle("ai_clean_read_generated", {
          symbol: params.symbol,
          threadId: params.threadId,
          details: {
            recordId: result?.id ?? null,
            model: result?.model ?? null,
          },
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.emitLifecycle("ai_clean_read_failed", {
          symbol: params.symbol,
          threadId: params.threadId,
          details: {
            error: message,
          },
        });
        console.error(`[ManualWatchlistRuntimeManager] Failed to generate AI clean read for ${params.symbol}: ${message}`);
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
      const currentPrice = resolveStockContextCurrentPrice(preview);
      const priorRegularClose = resolvePriorRegularCloseReference(preview);
      if (priorRegularClose) {
        this.priorRegularCloseBySymbol.set(symbol, priorRegularClose);
      } else {
        this.priorRegularCloseBySymbol.delete(symbol);
      }
      if (currentPrice) {
        this.watchlistStore.patchEntry(symbol, {
          lastPrice: currentPrice.price,
          lastPriceUpdateAt: currentPrice.timestamp ?? timestamp,
        });
      }
      await this.options.discordAlertRouter.routeAlert(threadId, payload);
      this.recordLiveThreadPost({
        symbol,
        timestamp,
        kind: "stock_context",
        critical: false,
        budgeted: false,
        eventType: null,
        whyPosted: payload.metadata?.whyPosted ?? "stock context posted after activation",
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
          currentPrice: currentPrice?.price ?? null,
          currentPriceSource: currentPrice?.source ?? null,
          currentPriceTimestamp: currentPrice?.timestamp ?? null,
          priorRegularClose: priorRegularClose?.price ?? null,
          priorRegularCloseSource: priorRegularClose?.source ?? null,
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
      displayedSupportZones: existingState?.displayedSupportZones,
      displayedResistanceZones: existingState?.displayedResistanceZones,
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
        whyPosted: "level extension posted after price moved beyond snapshot ladder",
      });
      this.emitLifecycle("extension_posted", {
        symbol,
        threadId,
        details: {
          side,
          levelCount: payload.levels.length,
        },
      });
      const activatedZones = this.options.levelStore.activateExtensionLevels(symbol, side);
      const nextDisplayedResistanceZones =
        side === "resistance"
          ? buildSnapshotDisplayZones(activatedZones, existingState?.referencePrice ?? payload.levels[0] ?? 0, "resistance")
          : existingState?.displayedResistanceZones;
      const nextDisplayedSupportZones =
        side === "support"
          ? buildSnapshotDisplayZones(activatedZones, existingState?.referencePrice ?? payload.levels[0] ?? 0, "support")
          : existingState?.displayedSupportZones;
      this.activeSnapshotState.set(symbol, {
        lastSnapshot: existingState?.lastSnapshot ?? "",
        highestResistance:
          side === "resistance"
            ? activatedZones.at(-1)?.representativePrice ?? existingState?.highestResistance ?? null
            : existingState?.highestResistance ?? null,
        lowestSupport:
          side === "support"
            ? activatedZones.at(-1)?.representativePrice ?? existingState?.lowestSupport ?? null
            : existingState?.lowestSupport ?? null,
        referencePrice: existingState?.referencePrice ?? null,
        displayedSupportZones: nextDisplayedSupportZones,
        displayedResistanceZones: nextDisplayedResistanceZones,
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
      this.publishWebsiteSnapshotRefresh(symbol, timestamp);
      return "posted";
    } catch (error) {
      this.activeSnapshotState.set(symbol, {
        lastSnapshot: existingState?.lastSnapshot ?? "",
        highestResistance: existingState?.highestResistance ?? null,
        lowestSupport: existingState?.lowestSupport ?? null,
        referencePrice: existingState?.referencePrice ?? null,
        displayedSupportZones: existingState?.displayedSupportZones,
        displayedResistanceZones: existingState?.displayedResistanceZones,
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
    const refreshBoundary = this.resistanceMapRefreshBoundary(snapshotState);
    if (!refreshBoundary) {
      return false;
    }

    const crossedAbove =
      update.lastPrice > refreshBoundary * (1 + FAST_LEVEL_CLEAR_CONFIRM_PCT);
    const distancePct = crossedAbove
      ? (update.lastPrice - refreshBoundary) / Math.max(refreshBoundary, 0.0001)
      : (refreshBoundary - update.lastPrice) / Math.max(refreshBoundary, 0.0001);

    if (
      distancePct < 0 ||
      (!crossedAbove && distancePct > LEVEL_REFRESH_THRESHOLD_PCT)
    ) {
      return false;
    }

    if (
      snapshotState.lastRefreshTriggerResistance === refreshBoundary &&
      snapshotState.lastRefreshTimestamp !== null &&
      update.timestamp - snapshotState.lastRefreshTimestamp < LEVEL_REFRESH_COOLDOWN_MS
    ) {
      return false;
    }

    return true;
  }

  private resistanceMapRefreshBoundary(snapshotState: ActiveLevelSnapshotState): number | null {
    const zones = (snapshotState.displayedResistanceZones ?? [])
      .map((zone) => zone.representativePrice)
      .filter((price) => Number.isFinite(price))
      .sort((left, right) => left - right);
    if (zones.length >= 2) {
      return zones[zones.length - 2] ?? null;
    }
    return snapshotState.highestResistance;
  }

  private shouldTriggerSupportRefresh(
    update: LivePriceUpdate,
    snapshotState: ActiveLevelSnapshotState,
  ): boolean {
    const refreshBoundary = this.supportMapRefreshBoundary(snapshotState);
    if (!refreshBoundary) {
      return false;
    }

    const crossedBelow =
      update.lastPrice < refreshBoundary * (1 - FAST_LEVEL_CLEAR_CONFIRM_PCT);

    const distancePct = crossedBelow
      ? (refreshBoundary - update.lastPrice) / Math.max(refreshBoundary, 0.0001)
      : (update.lastPrice - refreshBoundary) / Math.max(refreshBoundary, 0.0001);

    if (distancePct < 0 || (!crossedBelow && distancePct > LEVEL_REFRESH_THRESHOLD_PCT)) {
      return false;
    }

    if (
      snapshotState.lastRefreshTriggerSupport === refreshBoundary &&
      snapshotState.lastRefreshTimestamp !== null &&
      update.timestamp - snapshotState.lastRefreshTimestamp < LEVEL_REFRESH_COOLDOWN_MS
    ) {
      return false;
    }

    return true;
  }

  private supportMapRefreshBoundary(snapshotState: ActiveLevelSnapshotState): number | null {
    const zones = (snapshotState.displayedSupportZones ?? [])
      .map((zone) => zone.representativePrice)
      .filter((price) => Number.isFinite(price))
      .sort((left, right) => right - left);
    if (zones.length >= 2) {
      return zones[zones.length - 2] ?? null;
    }
    return snapshotState.lowestSupport;
  }

  private hasRecentCriticalPost(symbol: string, timestamp: number, eventType: string): boolean {
    return this.pruneLiveThreadPosts(symbol, timestamp).critical.some(
      (entry) =>
        entry.eventType === eventType &&
        Math.abs(timestamp - entry.timestamp) <= OPTIONAL_POST_CRITICAL_PREEMPT_WINDOW_MS,
    );
  }

  private mergeFastLevelReferences(zones: FastLevelReference[]): FastLevelReference[] {
    const sorted = [...zones]
      .filter((zone) => Number.isFinite(zone.representativePrice) && zone.representativePrice > 0)
      .sort((left, right) => left.representativePrice - right.representativePrice);
    const merged: FastLevelReference[] = [];

    for (const zone of sorted) {
      const existing = merged.find(
        (candidate) =>
          Math.abs(candidate.representativePrice - zone.representativePrice) <=
          snapshotPriceTolerance(zone.representativePrice),
      );
      if (!existing) {
        merged.push({ ...zone });
        continue;
      }

      if (
        fastLevelStrengthRank(zone.strengthLabel) >
        fastLevelStrengthRank(existing.strengthLabel)
      ) {
        existing.strengthLabel = zone.strengthLabel;
      }
      if (
        fastLevelSourceRank(zone.sourceLabel) >
        fastLevelSourceRank(existing.sourceLabel)
      ) {
        existing.sourceLabel = zone.sourceLabel;
      }
    }

    return merged;
  }

  private mergeDisplayedLevelReferenceMetadata(
    displayedZones: FastLevelReference[],
    supplementalZones: FastLevelReference[],
  ): FastLevelReference[] {
    const merged = displayedZones.map((zone) => ({ ...zone }));
    for (const zone of supplementalZones) {
      const existing = merged.find(
        (candidate) =>
          Math.abs(candidate.representativePrice - zone.representativePrice) <=
          snapshotPriceTolerance(zone.representativePrice),
      );
      if (!existing) {
        continue;
      }
      if (
        fastLevelStrengthRank(zone.strengthLabel) >
        fastLevelStrengthRank(existing.strengthLabel)
      ) {
        existing.strengthLabel = zone.strengthLabel;
      }
      if (
        fastLevelSourceRank(zone.sourceLabel) >
        fastLevelSourceRank(existing.sourceLabel)
      ) {
        existing.sourceLabel = zone.sourceLabel;
      }
    }
    return merged;
  }

  private getFastResistanceReferences(
    symbol: string,
    snapshotState?: ActiveLevelSnapshotState,
  ): FastLevelReference[] {
    return this.mergeFastLevelReferences([
      ...(snapshotState?.displayedResistanceZones ?? []),
      ...this.options.levelStore.getResistanceZones(symbol).map(withFastLevelSourceLabel),
      ...this.options.levelStore.getExtensionResistanceZones(symbol).map(withFastLevelSourceLabel),
    ]);
  }

  private getWebsiteTickerResistanceReferences(
    symbol: string,
    snapshotState?: ActiveLevelSnapshotState,
  ): FastLevelReference[] {
    return this.mergeFastLevelReferences([
      ...(snapshotState?.displayedResistanceZones ?? []),
      ...this.options.levelStore.getResistanceZones(symbol).map(withFastLevelSourceLabel),
      ...this.options.levelStore.getExtensionResistanceZones(symbol).map(withFastLevelSourceLabel),
    ]);
  }

  private getFastSupportReferences(
    symbol: string,
    snapshotState?: ActiveLevelSnapshotState,
  ): FastLevelReference[] {
    return this.mergeFastLevelReferences([
      ...(snapshotState?.displayedSupportZones ?? []),
      ...this.options.levelStore.getSupportZones(symbol).map(withFastLevelSourceLabel),
      ...this.options.levelStore.getExtensionSupportZones(symbol).map(withFastLevelSourceLabel),
    ]);
  }

  private getWebsiteTickerSupportReferences(
    symbol: string,
    snapshotState?: ActiveLevelSnapshotState,
  ): FastLevelReference[] {
    return this.mergeFastLevelReferences([
      ...(snapshotState?.displayedSupportZones ?? []),
      ...this.options.levelStore.getSupportZones(symbol).map(withFastLevelSourceLabel),
      ...this.options.levelStore.getExtensionSupportZones(symbol).map(withFastLevelSourceLabel),
    ]);
  }

  private findNextResistanceAbove(
    symbol: string,
    clearedLevel: number,
    snapshotState?: ActiveLevelSnapshotState,
  ): FastLevelReference | null {
    return this.getFastResistanceReferences(symbol, snapshotState)
      .filter((zone) => zone.representativePrice > clearedLevel + snapshotPriceTolerance(clearedLevel))
      .sort((left, right) => left.representativePrice - right.representativePrice)[0] ?? null;
  }

  private findNextWebsiteResistanceAbove(
    symbol: string,
    clearedLevel: number,
    snapshotState?: ActiveLevelSnapshotState,
  ): FastLevelReference | null {
    return this.getWebsiteTickerResistanceReferences(symbol, snapshotState)
      .filter((zone) => zone.representativePrice > clearedLevel + snapshotPriceTolerance(clearedLevel))
      .sort((left, right) => left.representativePrice - right.representativePrice)[0] ?? null;
  }

  private findNextSupportBelow(
    symbol: string,
    clearedLevel: number,
    snapshotState?: ActiveLevelSnapshotState,
  ): FastLevelReference | null {
    return this.getFastSupportReferences(symbol, snapshotState)
      .filter((zone) => zone.representativePrice < clearedLevel - snapshotPriceTolerance(clearedLevel))
      .sort((left, right) => right.representativePrice - left.representativePrice)[0] ?? null;
  }

  private findTightLevelCluster(zones: FastLevelReference[]): FastLevelReference[] {
    const cluster: FastLevelReference[] = [];
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
    timestamp: number,
  ): FastLevelReference[] {
    const zones = this.getFastResistanceReferences(symbol, snapshotState)
      .sort((left, right) => left.representativePrice - right.representativePrice);
    const lastCleared = this.highestRecentlyPostedResistanceClear(symbol, timestamp, snapshotState);
    const candidates = zones.filter((zone) => {
      const level = zone.representativePrice;
      const clearLine = Math.max(fastLevelHigh(zone), zone.representativePrice);
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
    timestamp: number,
  ): FastLevelReference[] {
    const zones = this.getFastSupportReferences(symbol, snapshotState)
      .sort((left, right) => right.representativePrice - left.representativePrice);
    const lastCleared = this.lowestRecentlyPostedSupportClear(symbol, timestamp, snapshotState);
    const candidates = zones.filter((zone) => {
      const level = zone.representativePrice;
      const clearLine = Math.min(fastLevelLow(zone), zone.representativePrice);
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

    const resistanceCluster = this.findFastClearedResistanceCluster(
      symbol,
      snapshotState,
      update.lastPrice,
      update.timestamp,
    );
    const resistanceZone = resistanceCluster[resistanceCluster.length - 1] ?? null;
    const resistanceLevels = resistanceCluster.map((zone) => zone.representativePrice);
    const isResistanceCluster = resistanceLevels.length > 1;
    const resistance = resistanceZone?.representativePrice ?? null;
    const resistanceBreakLine =
      resistanceCluster.length > 0
        ? Math.max(...resistanceCluster.map((zone) => Math.max(fastLevelHigh(zone), zone.representativePrice)))
        : null;
    const lastClearedResistance = snapshotState.lastClearedResistance ?? null;
    const suppressRepeatedResistance =
      resistance !== null &&
      lastClearedResistance !== null &&
      Math.abs(resistance - lastClearedResistance) <= snapshotPriceTolerance(resistance);
    if (
      resistance !== null &&
      !suppressRepeatedResistance &&
      !this.shouldSuppressSameOrLowerValueLevelStory({
        symbol,
        level: resistance,
        eventType: "breakout",
        timestamp: update.timestamp,
      }) &&
      (
        !this.hasRecentCriticalPost(symbol, update.timestamp, "breakout") ||
        (
          lastClearedResistance !== null &&
          resistance > lastClearedResistance + snapshotPriceTolerance(lastClearedResistance)
        )
      )
    ) {
      const levelClearDecision = this.shouldPostLevelClearUpdate({
        symbol,
        timestamp: update.timestamp,
        eventType: "breakout",
        level: resistance,
        triggerPrice: update.lastPrice,
        majorChange: isResistanceCluster,
      });
      if (!levelClearDecision.shouldPost) {
        this.emitLifecycle("alert_suppressed", {
          symbol,
          threadId: entry.discordThreadId,
          details: {
            eventType: "level_clear_update",
            reason: levelClearDecision.reason,
          },
        });
        return;
      }
      if (
        !this.shouldAllowCriticalLivePost({
          symbol,
          timestamp: update.timestamp,
          kind: "level_clear_update",
          eventType: "breakout",
          majorChange: isResistanceCluster,
        })
      ) {
        this.emitLifecycle("alert_suppressed", {
          symbol,
          threadId: entry.discordThreadId,
          details: {
            eventType: "level_clear_update",
            reason: "critical_burst_governor",
          },
        });
        return;
      }

      const nextResistance = this.findNextWebsiteResistanceAbove(symbol, resistance, snapshotState);
      const pullbackSupport = this.findNextSupportBelow(symbol, resistance, snapshotState);
      const nextResistanceText = formatFastLevelZone(nextResistance, "resistance");
      const missingResistanceText = "higher resistance needs a fresh level check before treating the path as open";
      const pullbackSupportLevel =
        pullbackSupport ? formatSnapshotLevel(pullbackSupport.representativePrice) : null;
      const pullbackIsTinyStep =
        pullbackSupport !== null && isTinySmallCapLevelStep(resistance, pullbackSupport.representativePrice);
      const resistanceLine = formatSnapshotLevel(resistanceBreakLine ?? resistance);
      const resistanceRange = formatFastLevelRange(resistanceLevels);
      const title = isResistanceCluster
        ? `${symbol} resistance cluster crossed`
        : `${symbol} resistance crossed`;
      const bodyBase = isResistanceCluster ? [
        `price pushed through nearby resistance cluster ${resistanceRange}${nextResistanceText ? `; nearby resistance above is ${nextResistanceText}` : ""}`,
        "",
        "Old resistance is being tested as support.",
        "",
        "What it means:",
        `- ${resistanceRange} was resistance. Now buyers need that area to hold as support`,
        nextResistanceText
          ? `- nearby resistance above is ${nextResistanceText}`
          : `- ${missingResistanceText}`,
        "",
        "What to watch:",
        `- holding above ${resistanceLine} keeps the breakout attempt alive`,
        `- falling back into ${resistanceRange} means the cluster is still acting like resistance`,
        pullbackSupportLevel
          ? pullbackIsTinyStep
            ? `- if price cannot hold ${resistanceRange}, treat this as a tight support/retest area rather than a fresh downside story`
            : `- if price cannot hold ${resistanceRange}, the breakout needs to rebuild; broader support is ${pullbackSupportLevel}`
          : `- if price cannot hold ${resistanceLine}, the breakout needs to rebuild`,
        "",
        "Key levels:",
        `- Breakout support: ${resistanceRange}`,
        nextResistanceText
          ? `- Resistance above: ${nextResistanceText}`
          : "- Resistance above: needs fresh level check",
      ].join("\n") : [
        `price pushed above ${resistanceLine}${nextResistanceText ? `; nearby resistance above is ${nextResistanceText}` : ""}`,
        "",
        "Old resistance is being tested as support.",
        "",
        "What it means:",
        `- ${resistanceLine} was resistance. Now buyers need it to hold as support`,
        nextResistanceText
          ? `- nearby resistance above is ${nextResistanceText}`
          : `- ${missingResistanceText}`,
        "",
        "What to watch:",
        `- holding above ${resistanceLine} keeps the breakout attempt alive`,
        `- falling back below ${resistanceLine} means the level is still acting like resistance`,
        pullbackSupportLevel
          ? pullbackIsTinyStep
            ? `- if price cannot hold ${resistanceLine}, treat this as a tight support/retest area rather than a fresh downside story`
            : `- if price cannot hold ${resistanceLine}, the breakout needs to rebuild; broader support is ${pullbackSupportLevel}`
          : `- if price cannot hold ${resistanceLine}, the breakout needs to rebuild`,
        "",
        "Key levels:",
        `- Breakout support: ${resistanceLine}`,
        nextResistanceText
          ? `- Resistance above: ${nextResistanceText}`
          : "- Resistance above: needs fresh level check",
      ].join("\n");
      const marketStructureStoryDecision = this.resolveMarketStructureStoryDecision(
        symbol,
        update.timestamp,
      );
      const body = marketStructureStoryDecision.includeStory
        ? appendMarketStructureSection(
            bodyBase,
            marketStructureStoryDecision.snapshot,
            marketStructureStoryDecision.keys,
          )
        : bodyBase;
      const marketStructureStoryVisible = body !== bodyBase;
      if (this.cancelPendingLevelTouchAlert(symbol)) {
        this.emitLifecycle("alert_suppressed", {
          symbol,
          threadId: entry.discordThreadId,
          details: {
            eventType: "level_touch",
            reason: "superseded_by_fast_level_clear",
          },
        });
      }
      this.activeSnapshotState.set(symbol, {
        ...snapshotState,
        lastClearedResistance: resistance,
        lastLevelClearTimestamp: update.timestamp,
      });
      const payload: AlertPayload = {
        title,
        body,
        symbol,
        timestamp: update.timestamp,
        metadata: {
          messageKind: "level_clear_update",
          eventType: "breakout",
          signalCategory: "breakout_reclaim_quality",
          signalCategoryLiveEnabled: isSignalCategoryLiveEnabled("breakout_reclaim_quality"),
          targetSide: "resistance",
          targetPrice: resistance,
          crossedLevels: isResistanceCluster ? resistanceLevels : undefined,
          clusterLow: isResistanceCluster ? Math.min(...resistanceLevels) : undefined,
          clusterHigh: isResistanceCluster ? Math.max(...resistanceLevels) : undefined,
          clusteredLevelClear: isResistanceCluster ? true : undefined,
          whyPosted: isResistanceCluster ? "nearby resistance cluster crossed" : "new resistance level crossed",
          postBudgetSymbolType: classifyRuntimePostBudgetSymbolType(update.lastPrice),
          noLevelReason: nextResistance ? undefined : "higher resistance not available in active snapshot or extension cache",
          needsFreshLevelCheck: nextResistance ? undefined : true,
          marketStructureStoryVisible,
          runtimeMarketStructure: marketStructureStoryDecision.snapshot,
        },
      };
      this.annotateMarketStructureStoryPayload(
        payload,
        marketStructureStoryDecision,
        "level_clear",
      );
      const releaseMarketStructureCarrier = this.reserveMarketStructureStoryCarrier(
        symbol,
        payload.metadata?.marketStructureStoryKeys,
      );
      try {
        await this.options.discordAlertRouter.routeAlert(entry.discordThreadId, payload);
        this.markMarketStructureStoryPosted(
          symbol,
          update.timestamp,
          payload,
          marketStructureStoryDecision,
        );
      } finally {
        releaseMarketStructureCarrier();
      }
      this.recordLevelClearUpdate({
        symbol,
        timestamp: update.timestamp,
        eventType: "breakout",
        level: resistance,
        triggerPrice: update.lastPrice,
        majorChange: isResistanceCluster,
      });
      this.recordLiveThreadPost({
        symbol,
        timestamp: update.timestamp,
        kind: "level_clear_update",
        critical: true,
        eventType: "breakout",
        whyPosted: isResistanceCluster ? "nearby resistance cluster crossed" : "new resistance level crossed",
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

    const supportCluster = this.findFastLostSupportCluster(
      symbol,
      snapshotState,
      update.lastPrice,
      update.timestamp,
    );
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
      !this.shouldSuppressSameOrLowerValueLevelStory({
        symbol,
        level: support,
        eventType: "breakdown",
        timestamp: update.timestamp,
      }) &&
      (
        !this.hasRecentCriticalPost(symbol, update.timestamp, "breakdown") ||
        (
          lastClearedSupport !== null &&
          support < lastClearedSupport - snapshotPriceTolerance(lastClearedSupport)
        )
      )
    ) {
      const levelClearDecision = this.shouldPostLevelClearUpdate({
        symbol,
        timestamp: update.timestamp,
        eventType: "breakdown",
        level: support,
        triggerPrice: update.lastPrice,
        majorChange: isSupportCluster,
      });
      if (!levelClearDecision.shouldPost) {
        this.emitLifecycle("alert_suppressed", {
          symbol,
          threadId: entry.discordThreadId,
          details: {
            eventType: "level_clear_update",
            reason: levelClearDecision.reason,
          },
        });
        return;
      }
      if (
        !this.shouldAllowCriticalLivePost({
          symbol,
          timestamp: update.timestamp,
          kind: "level_clear_update",
          eventType: "breakdown",
          majorChange: isSupportCluster,
        })
      ) {
        this.emitLifecycle("alert_suppressed", {
          symbol,
          threadId: entry.discordThreadId,
          details: {
            eventType: "level_clear_update",
            reason: "critical_burst_governor",
          },
        });
        return;
      }

      const nextSupport = this.findNextSupportBelow(symbol, support, snapshotState);
      const nextSupportText = formatFastLevelZone(nextSupport, "support");
      const missingSupportText = "lower support needs a fresh level check before treating the path as open";
      const nextSupportLevel = formatFastLevelOnly(nextSupport);
      const nextSupportIsTinyStep =
        nextSupport !== null && isTinySmallCapLevelStep(support, nextSupport.representativePrice);
      const supportRange = formatFastLevelRange(supportLevels);
      const supportRepairLine = formatSnapshotLevel(Math.max(...supportLevels));
      const title = isSupportCluster
        ? `${symbol} support cluster crossed lower`
        : `${symbol} support crossed lower`;
      const bodyBase = isSupportCluster ? [
        `price slipped through nearby support cluster ${supportRange}${nextSupportText ? `; nearby support below is ${nextSupportText}` : ""}`,
        "",
        "Old support is now overhead.",
        "",
        "What it means:",
        `- ${supportRange} was support. Price is below it now, so buyers need a reclaim to repair the zone`,
        nextSupportText
          ? `- nearby support below is ${nextSupportText}`
          : `- ${missingSupportText}`,
        "",
        "What to watch:",
        `- reclaiming ${supportRepairLine} is needed to repair the zone`,
        nextSupportText
          ? `- nearby support reaction area: ${nextSupportText}; buyers need stabilization there or a reclaim of ${supportRepairLine}`
          : "- buyers need stabilization or a fresh lower-support check before the path is treated as open",
        nextSupportLevel
          ? nextSupportIsTinyStep
            ? `- below ${supportRange}, this is still a tight support area; the cleaner story changes on a broader failure or a reclaim`
            : `- below ${supportRange}, the next broader support area is ${nextSupportLevel}`
          : `- below ${supportRange}, risk stays elevated until a new support forms`,
      ].join("\n") : [
        `price slipped below ${formatSnapshotLevel(support)}${nextSupportText ? `; nearby support below is ${nextSupportText}` : ""}`,
        "",
        "Old support is now overhead.",
        "",
        "What it means:",
        `- ${formatSnapshotLevel(support)} was support. Price is below it now, so buyers need a reclaim to repair the level`,
        nextSupportText
          ? `- nearby support below is ${nextSupportText}`
          : `- ${missingSupportText}`,
        "",
        "What to watch:",
        `- reclaiming ${formatSnapshotLevel(support)} is needed to repair the level`,
        nextSupportText
          ? `- nearby support reaction area: ${nextSupportText}; buyers need stabilization there or a reclaim of ${formatSnapshotLevel(support)}`
          : "- buyers need stabilization or a fresh lower-support check before the path is treated as open",
        nextSupportLevel
          ? nextSupportIsTinyStep
            ? `- below ${formatSnapshotLevel(support)}, this is still a tight support area; the cleaner story changes on a broader failure or a reclaim`
            : `- below ${formatSnapshotLevel(support)}, the next broader support area is ${nextSupportLevel}`
          : `- below ${formatSnapshotLevel(support)}, risk stays elevated until a new support forms`,
      ].join("\n");
      const marketStructureStoryDecision = this.resolveMarketStructureStoryDecision(
        symbol,
        update.timestamp,
      );
      const body = marketStructureStoryDecision.includeStory
        ? appendMarketStructureSection(
            bodyBase,
            marketStructureStoryDecision.snapshot,
            marketStructureStoryDecision.keys,
          )
        : bodyBase;
      const marketStructureStoryVisible = body !== bodyBase;
      if (this.cancelPendingLevelTouchAlert(symbol)) {
        this.emitLifecycle("alert_suppressed", {
          symbol,
          threadId: entry.discordThreadId,
          details: {
            eventType: "level_touch",
            reason: "superseded_by_fast_level_clear",
          },
        });
      }
      this.activeSnapshotState.set(symbol, {
        ...snapshotState,
        lastClearedSupport: support,
        lastLevelClearTimestamp: update.timestamp,
      });
      const payload: AlertPayload = {
        title,
        body,
        symbol,
        timestamp: update.timestamp,
        metadata: {
          messageKind: "level_clear_update",
          eventType: "breakdown",
          signalCategory: "breakout_reclaim_quality",
          signalCategoryLiveEnabled: isSignalCategoryLiveEnabled("breakout_reclaim_quality"),
          targetSide: "support",
          targetPrice: support,
          crossedLevels: isSupportCluster ? supportLevels : undefined,
          clusterLow: isSupportCluster ? Math.min(...supportLevels) : undefined,
          clusterHigh: isSupportCluster ? Math.max(...supportLevels) : undefined,
          clusteredLevelClear: isSupportCluster ? true : undefined,
          whyPosted: isSupportCluster ? "nearby support cluster crossed lower" : "new support level crossed lower",
          postBudgetSymbolType: classifyRuntimePostBudgetSymbolType(update.lastPrice),
          noLevelReason: nextSupport ? undefined : "lower support not available in active snapshot or extension cache",
          needsFreshLevelCheck: nextSupport ? undefined : true,
          marketStructureStoryVisible,
          runtimeMarketStructure: marketStructureStoryDecision.snapshot,
        },
      };
      this.annotateMarketStructureStoryPayload(
        payload,
        marketStructureStoryDecision,
        "level_clear",
      );
      const releaseMarketStructureCarrier = this.reserveMarketStructureStoryCarrier(
        symbol,
        payload.metadata?.marketStructureStoryKeys,
      );
      try {
        await this.options.discordAlertRouter.routeAlert(entry.discordThreadId, payload);
        this.markMarketStructureStoryPosted(
          symbol,
          update.timestamp,
          payload,
          marketStructureStoryDecision,
        );
      } finally {
        releaseMarketStructureCarrier();
      }
      this.recordLevelClearUpdate({
        symbol,
        timestamp: update.timestamp,
        eventType: "breakdown",
        level: support,
        triggerPrice: update.lastPrice,
        majorChange: isSupportCluster,
      });
      this.recordLiveThreadPost({
        symbol,
        timestamp: update.timestamp,
        kind: "level_clear_update",
        critical: true,
        eventType: "breakdown",
        whyPosted: isSupportCluster ? "nearby support cluster crossed lower" : "new support level crossed lower",
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

  private scheduleFastLevelClear(update: LivePriceUpdate): void {
    if (this.fastLevelClearCoalesceMs <= 0) {
      void this.maybePostFastLevelClear(update).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ManualWatchlistRuntimeManager] Failed to post fast level clear: ${message}`);
      });
      return;
    }

    const symbol = normalizeSymbol(update.symbol);
    const existing = this.pendingFastLevelClearAlerts.get(symbol);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      this.pendingFastLevelClearAlerts.delete(symbol);
      void this.maybePostFastLevelClear(update).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ManualWatchlistRuntimeManager] Failed to post fast level clear: ${message}`);
      });
    }, this.fastLevelClearCoalesceMs);

    this.pendingFastLevelClearAlerts.set(symbol, { timer, update });
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
      side === "resistance"
        ? this.resistanceMapRefreshBoundary(snapshotState)
        : this.supportMapRefreshBoundary(snapshotState);

    this.extensionRefreshInFlight.add(symbol);
    try {
      this.watchlistStore.patchEntry(symbol, {
        lifecycle: "extension_pending",
        operationStatus: `checking next ${side} levels`,
      });

      const consumingOuterResistanceMap =
        side === "resistance" &&
        boundary !== null &&
        update.lastPrice > boundary * (1 + FAST_LEVEL_CLEAR_CONFIRM_PCT);
      const consumingOuterSupportMap =
        side === "support" &&
        boundary !== null &&
        update.lastPrice < boundary * (1 - FAST_LEVEL_CLEAR_CONFIRM_PCT);
      const shouldRefreshCandlesBeforeExtension =
        consumingOuterResistanceMap || consumingOuterSupportMap;

      if (shouldRefreshCandlesBeforeExtension) {
        this.watchlistStore.patchEntry(symbol, {
          lifecycle: "extension_pending",
          operationStatus: consumingOuterResistanceMap
            ? "refreshing candles for higher resistance"
            : "refreshing candles for lower support",
        });
        await this.seedLevelsForSymbol(symbol, {
          force: true,
          graceOnTimeout: true,
        });
      }

      let extensionResult = await this.postLevelExtension(
        symbol,
        entry.discordThreadId,
        side,
        update.timestamp,
      );

      if (extensionResult === "unavailable" && !this.options.levelStore.getLevels(symbol)) {
        this.watchlistStore.patchEntry(symbol, {
          lifecycle: "extension_pending",
          operationStatus: `refreshing ${side} levels`,
        });
        await this.seedLevelsForSymbol(symbol, {
          graceOnTimeout: true,
        });
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
        displayedSupportZones: refreshedState?.displayedSupportZones ?? snapshotState.displayedSupportZones,
        displayedResistanceZones: refreshedState?.displayedResistanceZones ?? snapshotState.displayedResistanceZones,
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

  private recordLevelSeedStarted(symbol: string): number {
    const startedAt = Date.now();
    this.levelSeedStats.attempts += 1;
    this.levelSeedStats.inFlight += 1;
    this.levelSeedStats.lastSymbol = symbol;
    this.levelSeedStats.lastStartedAt = startedAt;
    this.levelSeedStats.lastError = null;
    return startedAt;
  }

  private recordLevelSeedCompleted(symbol: string, startedAt: number): void {
    const completedAt = Date.now();
    const durationMs = Math.max(0, completedAt - startedAt);
    this.levelSeedStats.successes += 1;
    this.levelSeedStats.inFlight = Math.max(0, this.levelSeedStats.inFlight - 1);
    this.levelSeedStats.totalDurationMs += durationMs;
    this.levelSeedStats.lastDurationMs = durationMs;
    this.levelSeedStats.lastSymbol = symbol;
    this.levelSeedStats.lastCompletedAt = completedAt;
    this.levelSeedStats.lastError = null;
  }

  private recordLevelSeedFailed(symbol: string, startedAt: number, error: unknown): void {
    const completedAt = Date.now();
    const durationMs = Math.max(0, completedAt - startedAt);
    this.levelSeedStats.failures += 1;
    this.levelSeedStats.inFlight = Math.max(0, this.levelSeedStats.inFlight - 1);
    this.levelSeedStats.totalDurationMs += durationMs;
    this.levelSeedStats.lastDurationMs = durationMs;
    this.levelSeedStats.lastSymbol = symbol;
    this.levelSeedStats.lastCompletedAt = completedAt;
    this.levelSeedStats.lastError = error instanceof Error ? error.message : String(error);
  }

  private recordLevelSeedTimeout(symbol: string, error: unknown): void {
    if (!(error instanceof LevelSeedTimeoutError)) {
      return;
    }

    this.levelSeedStats.timeouts += 1;
    this.levelSeedStats.lastSymbol = symbol;
    this.levelSeedStats.lastError = error.message;
  }

  private getLevelSeedStats(): ManualWatchlistLevelSeedStats {
    const completed = this.levelSeedStats.successes + this.levelSeedStats.failures;
    return {
      attempts: this.levelSeedStats.attempts,
      successes: this.levelSeedStats.successes,
      failures: this.levelSeedStats.failures,
      timeouts: this.levelSeedStats.timeouts,
      inFlight: this.levelSeedStats.inFlight,
      averageDurationMs:
        completed > 0 ? Math.round(this.levelSeedStats.totalDurationMs / completed) : null,
      lastDurationMs: this.levelSeedStats.lastDurationMs,
      lastSymbol: this.levelSeedStats.lastSymbol,
      lastStartedAt: this.levelSeedStats.lastStartedAt,
      lastCompletedAt: this.levelSeedStats.lastCompletedAt,
      lastError: this.levelSeedStats.lastError,
    };
  }

  private resolveLevelSeedReferencePrice(symbol: string, timestamp: number): number | undefined {
    const entry = this.watchlistStore.getEntry(symbol);
    if (
      typeof entry?.lastPrice !== "number" ||
      !Number.isFinite(entry.lastPrice) ||
      entry.lastPrice <= 0 ||
      typeof entry.lastPriceUpdateAt !== "number" ||
      !Number.isFinite(entry.lastPriceUpdateAt)
    ) {
      return undefined;
    }

    const livePriceAgeMs = Math.max(0, timestamp - entry.lastPriceUpdateAt);
    return livePriceAgeMs <= SNAPSHOT_LIVE_REFERENCE_MAX_AGE_MS ? entry.lastPrice : undefined;
  }

  private refreshPotentialMoveReadForSymbol(
    symbol: string,
    output: LevelEngineOutput,
    seriesMap: Record<CandleTimeframe, CandleProviderResponse>,
  ): PotentialMoveRead | null {
    const normalizedSymbol = normalizeSymbol(symbol);
    const catalystCardFreshness = this.recentWebsiteArticleFreshnessBySymbol.get(normalizedSymbol);
    const catalystContext = this.pressReleaseCatalystContextBySymbol.get(normalizedSymbol);
    const currentPrice =
      output.metadata.referencePrice ??
      seriesMap["5m"].candles.at(-1)?.close ??
      seriesMap["4h"].candles.at(-1)?.close ??
      seriesMap.daily.candles.at(-1)?.close ??
      0;
    const potentialMoveRead = buildWatchlistChartThesisRead({
      symbol: normalizedSymbol,
      currentPrice,
      seriesMap,
      ...(catalystCardFreshness || catalystContext
        ? {
            activeRunnerContext: {
              activeRunner: this.isEntryActive(normalizedSymbol),
              catalystCardFreshness,
              catalystContext,
            },
          }
        : {}),
    });

    if (potentialMoveRead) {
      this.potentialMoveReadBySymbol.set(normalizedSymbol, potentialMoveRead);
    } else {
      this.potentialMoveReadBySymbol.delete(normalizedSymbol);
    }
    this.refreshTradeSetupThesisReadForSymbol({
      symbol: normalizedSymbol,
      currentPrice,
      baseSeriesMap: seriesMap,
      fiveMinuteCandles: seriesMap["5m"].candles,
      evaluatedAt: Date.now(),
    });
    return potentialMoveRead;
  }

  private refreshTradeSetupThesisReadForSymbol(params: {
    symbol: string;
    currentPrice: number;
    baseSeriesMap?: Record<CandleTimeframe, CandleProviderResponse>;
    fiveMinuteCandles: Candle[];
    evaluatedAt: number;
  }): PotentialMoveRead | null {
    const normalizedSymbol = normalizeSymbol(params.symbol);
    const baseSeriesMap = params.baseSeriesMap ??
      this.chartThesisSeriesMapBySymbol.get(normalizedSymbol);
    if (!baseSeriesMap) {
      this.tradeSetupThesisReadBySymbol.delete(normalizedSymbol);
      return null;
    }
    const seriesMap = buildLiveTradeSetupSeriesMap({
      baseSeriesMap,
      fiveMinuteCandles: params.fiveMinuteCandles,
      evaluatedAt: params.evaluatedAt,
    });
    const catalystCardFreshness = this.recentWebsiteArticleFreshnessBySymbol.get(normalizedSymbol);
    const catalystContext = this.pressReleaseCatalystContextBySymbol.get(normalizedSymbol);
    const completedPrice = seriesMap["5m"].candles.at(-1)?.close ?? params.currentPrice;
    const tradeSetupThesisRead = buildTradeSetupChartThesisRead({
      symbol: normalizedSymbol,
      currentPrice: completedPrice,
      seriesMap,
      activeRunnerContext: {
        activeRunner: this.isEntryActive(normalizedSymbol),
        ...(catalystCardFreshness ? { catalystCardFreshness } : {}),
        ...(catalystContext ? { catalystContext } : {}),
      },
    });
    if (tradeSetupThesisRead) {
      this.tradeSetupThesisReadBySymbol.set(normalizedSymbol, tradeSetupThesisRead);
    } else {
      this.tradeSetupThesisReadBySymbol.delete(normalizedSymbol);
    }
    return tradeSetupThesisRead;
  }

  private refreshPotentialMoveReadFromStoredChartContext(symbol: string): PotentialMoveRead | null {
    const normalizedSymbol = normalizeSymbol(symbol);
    const output = this.chartThesisLevelOutputBySymbol.get(normalizedSymbol);
    const seriesMap = this.chartThesisSeriesMapBySymbol.get(normalizedSymbol);
    if (!output || !seriesMap) {
      return null;
    }
    return this.refreshPotentialMoveReadForSymbol(normalizedSymbol, output, seriesMap);
  }

  private storeTechnicalContextForSymbol(
    symbol: string,
    output: LevelEngineOutput,
    seriesMap: Record<CandleTimeframe, CandleProviderResponse>,
  ): void {
    const fiveMinute = seriesMap["5m"];
    const normalizedSymbol = normalizeSymbol(symbol);
    this.chartThesisLevelOutputBySymbol.set(normalizedSymbol, output);
    this.chartThesisSeriesMapBySymbol.set(normalizedSymbol, seriesMap);
    this.refreshPotentialMoveReadForSymbol(normalizedSymbol, output, seriesMap);
    this.technicalContextProviderBySymbol.set(normalizedSymbol, fiveMinute.provider);
    this.technicalContextDataQualityFlagsBySymbol.set(
      normalizedSymbol,
      output.metadata.dataQualityFlags,
    );
    const candles = this.technicalContextCandleStore.setHistoricalCandles(
      normalizedSymbol,
      fiveMinute.candles,
    );
    const context = this.rebuildTechnicalContextForSymbol({
      symbol: normalizedSymbol,
      candles,
      currentPrice: output.metadata.referencePrice ?? null,
      provider: fiveMinute.provider,
      dataQualityFlags: output.metadata.dataQualityFlags,
    });
    this.scheduleTechnicalContextBootstrapRetryIfNeeded(normalizedSymbol, context);
  }

  private rebuildTechnicalContextForSymbol(params: {
    symbol: string;
    candles: CandleProviderResponse["candles"];
    currentPrice: number | null | undefined;
    provider: string | null | undefined;
    dataQualityFlags: string[];
  }): TechnicalContext {
    const context = buildTechnicalContextFromCandles({
      candles: params.candles,
      currentPrice: params.currentPrice ?? null,
      provider: params.provider ?? null,
      dataQualityFlags: technicalContextDataQualityFlags(
        params.dataQualityFlags,
        params.candles.length,
      ),
    });
    this.technicalContextBySymbol.set(params.symbol, context);
    return context;
  }

  private currentTechnicalContextPrice(
    symbol: string,
    fallback?: number | null,
    referenceTimestamp?: number,
  ): number | null {
    const entry = this.watchlistStore.getEntry(symbol);
    const livePrice =
      typeof entry?.lastPrice === "number" &&
      Number.isFinite(entry.lastPrice) &&
      entry.lastPrice > 0
        ? entry.lastPrice
        : null;
    if (livePrice !== null) {
      if (typeof referenceTimestamp !== "number" || !Number.isFinite(referenceTimestamp)) {
        return livePrice;
      }

      const hasLiveTimestamp =
        typeof entry?.lastPriceUpdateAt === "number" &&
        Number.isFinite(entry.lastPriceUpdateAt);
      if (
        hasLiveTimestamp &&
        Math.max(0, referenceTimestamp - entry.lastPriceUpdateAt!) <= SNAPSHOT_LIVE_REFERENCE_MAX_AGE_MS
      ) {
        return livePrice;
      }
    }

    if (typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0) {
      return fallback;
    }

    return livePrice;
  }

  private clearTechnicalContextBootstrapRetry(symbolInput: string): void {
    const symbol = normalizeSymbol(symbolInput);
    const timer = this.technicalContextBootstrapRetryTimers.get(symbol);
    if (timer) {
      clearTimeout(timer);
    }
    this.technicalContextBootstrapRetryTimers.delete(symbol);
    this.technicalContextBootstrapRetryAttempts.delete(symbol);
    this.technicalContextBootstrapRefreshInFlight.delete(symbol);
  }

  private scheduleTechnicalContextBootstrapRetryIfNeeded(
    symbolInput: string,
    context: TechnicalContext,
  ): void {
    const symbol = normalizeSymbol(symbolInput);
    if (isTechnicalContextDisplayReady(context)) {
      this.clearTechnicalContextBootstrapRetry(symbol);
      return;
    }

    if (
      this.technicalContextBootstrapRetryTimers.has(symbol) ||
      this.technicalContextBootstrapRefreshInFlight.has(symbol)
    ) {
      return;
    }

    const attempt = this.technicalContextBootstrapRetryAttempts.get(symbol) ?? 0;
    const delayMs = TECHNICAL_CONTEXT_BOOTSTRAP_RETRY_DELAYS_MS[attempt];
    if (delayMs === undefined) {
      return;
    }

    const timer = setTimeout(() => {
      this.technicalContextBootstrapRetryTimers.delete(symbol);
      void this.refreshTechnicalContextHistoricalCandles(symbol).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[ManualWatchlistRuntimeManager] Failed to refresh 5m technical context candles for ${symbol}: ${message}`,
        );
      });
    }, delayMs);
    timer.unref?.();
    this.technicalContextBootstrapRetryTimers.set(symbol, timer);
  }

  private async refreshTechnicalContextHistoricalCandles(symbolInput: string): Promise<void> {
    const symbol = normalizeSymbol(symbolInput);
    const entry = this.watchlistStore.getEntry(symbol);
    if (!entry?.active) {
      this.clearTechnicalContextBootstrapRetry(symbol);
      return;
    }

    this.technicalContextBootstrapRefreshInFlight.add(symbol);
    try {
      const response = await this.options.candleFetchService.fetchCandles({
        symbol,
        timeframe: "5m",
        lookbackBars: this.historicalLookbackBars["5m"],
      });
      this.technicalContextProviderBySymbol.set(symbol, response.provider);
      const dataQualityFlags = response.validationIssues.map((issue) => `5m:${issue.code}`);
      this.technicalContextDataQualityFlagsBySymbol.set(symbol, dataQualityFlags);
      const candles = this.technicalContextCandleStore.setHistoricalCandles(symbol, response.candles);
      const context = this.rebuildTechnicalContextForSymbol({
        symbol,
        candles,
        currentPrice: this.currentTechnicalContextPrice(symbol),
        provider: response.provider,
        dataQualityFlags,
      });
      if (isTechnicalContextDisplayReady(context)) {
        this.clearTechnicalContextBootstrapRetry(symbol);
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ManualWatchlistRuntimeManager] 5m technical context retry failed for ${symbol}: ${message}`,
      );
    } finally {
      this.technicalContextBootstrapRefreshInFlight.delete(symbol);
    }

    const attempt = (this.technicalContextBootstrapRetryAttempts.get(symbol) ?? 0) + 1;
    this.technicalContextBootstrapRetryAttempts.set(symbol, attempt);
    const context = this.technicalContextBySymbol.get(symbol);
    if (context) {
      this.scheduleTechnicalContextBootstrapRetryIfNeeded(symbol, context);
    }
  }

  private pullbackReadEnabled(): boolean {
    return this.options.pullbackReadEnabled !== false;
  }

  private pullbackReadPollIntervalMs(): number {
    const configured = this.options.pullbackReadPollIntervalMs;
    return typeof configured === "number" && Number.isFinite(configured) && configured > 0
      ? configured
      : PULLBACK_READ_INTRADAY_POLL_INTERVAL_MS;
  }

  private startPullbackReadIntradayPolling(): void {
    if (
      !this.pullbackReadEnabled() ||
      !this.options.recentIntradayCandleFetchService ||
      this.pullbackReadIntradayPollTimer
    ) {
      return;
    }

    void this.pollPullbackReadIntradayCandles();
    this.pullbackReadIntradayPollTimer = setInterval(() => {
      void this.pollPullbackReadIntradayCandles();
    }, this.pullbackReadPollIntervalMs());
    this.pullbackReadIntradayPollTimer.unref?.();
  }

  private stopPullbackReadIntradayPolling(): void {
    if (this.pullbackReadIntradayPollTimer) {
      clearInterval(this.pullbackReadIntradayPollTimer);
      this.pullbackReadIntradayPollTimer = null;
    }
    this.pullbackReadIntradayPollInFlight = false;
  }

  private async pollPullbackReadIntradayCandles(): Promise<void> {
    if (
      this.pullbackReadIntradayPollInFlight ||
      !this.pullbackReadEnabled() ||
      !this.options.recentIntradayCandleFetchService
    ) {
      return;
    }

    this.pullbackReadIntradayPollInFlight = true;
    try {
      for (const entry of this.watchlistStore.getActiveEntries()) {
        await this.refreshPullbackReadIntradayCandles(entry.symbol);
      }
    } finally {
      this.pullbackReadIntradayPollInFlight = false;
    }
  }

  private async refreshPullbackReadIntradayCandles(symbolInput: string): Promise<void> {
    const service = this.options.recentIntradayCandleFetchService;
    const symbol = normalizeSymbol(symbolInput);
    const entry = this.watchlistStore.getEntry(symbol);
    if (!service || !entry?.active) {
      return;
    }

    const endTimeMs = Date.now();
    try {
      const fiveMinute = await service.fetchCandles({
        symbol,
        timeframe: "5m",
        lookbackBars: PULLBACK_READ_5M_LOOKBACK_BARS,
        endTimeMs,
        preferredProvider: "yahoo",
      });
      const normalizedFiveMinuteCandles = normalizePullbackCandles(fiveMinute.candles);
      const oneMinute = !hasUsableRecentPullbackCandles(normalizedFiveMinuteCandles, endTimeMs)
        ? await service.fetchCandles({
            symbol,
            timeframe: "1m",
            lookbackBars: PULLBACK_READ_1M_LOOKBACK_BARS,
            endTimeMs,
            preferredProvider: "yahoo",
          })
        : null;
      const aggregatedOneMinuteCandles =
        oneMinute && hasUsableRecentPullbackCandles(oneMinute.candles, endTimeMs)
          ? aggregateCandlesToFiveMinute(oneMinute.candles)
          : [];
      const fiveMinuteCandles = hasUsableRecentPullbackCandles(normalizedFiveMinuteCandles, endTimeMs)
        ? normalizedFiveMinuteCandles
        : aggregatedOneMinuteCandles;
      if (fiveMinuteCandles.length === 0) {
        return;
      }

      if (!hasUsableRecentPullbackCandles(fiveMinuteCandles, endTimeMs)) {
        return;
      }

      this.technicalContextProviderBySymbol.set(symbol, "yahoo");
      const dataQualityFlags = [
        ...fiveMinute.validationIssues.map((issue) => `5m:${issue.code}`),
        ...(oneMinute?.validationIssues.map((issue) => `1m:${issue.code}`) ?? []),
        ...(oneMinute ? ["5m:derived_from_1m_yahoo"] : []),
      ];
      this.technicalContextDataQualityFlagsBySymbol.set(symbol, dataQualityFlags);
      const candles = this.technicalContextCandleStore.setHistoricalCandles(symbol, fiveMinuteCandles);
      const latestCandle = candles.at(-1);
      const currentPrice = this.currentTechnicalContextPrice(symbol, latestCandle?.close ?? null, endTimeMs);
      const context = this.rebuildTechnicalContextForSymbol({
        symbol,
        candles,
        currentPrice,
        provider: "yahoo",
        dataQualityFlags,
      });
      const volumeRead = buildPullbackVolumeRead(fiveMinuteCandles, { nowMs: endTimeMs });
      if (currentPrice !== null) {
        const timestamp = endTimeMs;
        this.publishWebsiteTechnicalContext({
          symbol,
          timestamp,
          lastPrice: currentPrice,
          volume: latestCandle?.volume,
        });
        this.publishWebsitePullbackTraderRead({
          symbol,
          timestamp,
          currentPrice,
          technicalContext: context,
          volumeRead,
        });
        this.publishWebsiteSnapshotRefresh(symbol, timestamp);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ManualWatchlistRuntimeManager] Yahoo pullback intraday candle refresh failed for ${symbol}: ${message}`,
      );
    }
  }

  private ingestLiveTechnicalContextPrice(update: LivePriceUpdate): void {
    const symbol = normalizeSymbol(update.symbol);
    const hadStoredCandles = this.technicalContextCandleStore.getCandles(symbol).length > 0;
    const existingContext = this.technicalContextBySymbol.get(symbol);
    if (!hadStoredCandles && existingContext && existingContext.candleCount > 0) {
      return;
    }

    const candles = this.technicalContextCandleStore.updateFromLivePrice({
      ...update,
      symbol,
    });
    const provider = this.technicalContextProviderBySymbol.get(symbol) ?? "live_stream";
    const dataQualityFlags = this.technicalContextDataQualityFlagsBySymbol.get(symbol) ?? [];
    const context = this.rebuildTechnicalContextForSymbol({
      symbol,
      candles,
      currentPrice: update.lastPrice,
      provider,
      dataQualityFlags,
    });
    this.scheduleTechnicalContextBootstrapRetryIfNeeded(symbol, context);
  }

  private buildLevelSeedHistoricalRequests(
    symbol: string,
    candleFetchService: Pick<CandleFetchService, "getProviderName">,
  ): Record<CandleTimeframe, HistoricalFetchRequest> {
    const providerName = candleFetchService.getProviderName();
    const now = Date.now();

    const buildRequest = (timeframe: CandleTimeframe): HistoricalFetchRequest => {
      const endTimeMs = providerName === "eodhd"
        ? resolveEodhdConfirmedLevelRequestEndTimeMs(timeframe, now)
        : undefined;

      return {
        symbol,
        timeframe,
        lookbackBars: this.historicalLookbackBars[timeframe],
        ...(endTimeMs === undefined ? {} : { endTimeMs }),
      };
    };

    return {
      daily: buildRequest("daily"),
      "4h": buildRequest("4h"),
      "5m": buildRequest("5m"),
    };
  }

  private beginSeedLevelsForSymbol(symbol: string): Promise<void> {
    const startedAt = this.recordLevelSeedStarted(symbol);
    return (async (): Promise<void> => {
      try {
        if (this.options.seedSymbolLevels) {
          await this.options.seedSymbolLevels(symbol);
          this.markSeededLevelsReady(symbol);
          this.emitLifecycle("levels_seeded", {
            symbol,
          });
          this.recordLevelSeedCompleted(symbol, startedAt);
          return;
        }

        const referencePriceOverride = this.resolveLevelSeedReferencePrice(symbol, Date.now());
        const { output, seriesMap } = await this.levelEngine.generateLevelsWithCandleSeries({
          symbol,
          historicalRequests: this.buildLevelSeedHistoricalRequests(symbol, this.options.candleFetchService),
          referencePriceOverride,
        });

        this.options.levelStore.setLevels(output);
        this.storeTechnicalContextForSymbol(symbol, output, seriesMap);
        this.options.monitor.seedMarketStructure(symbol, seriesMap);
        this.markSeededLevelsReady(symbol);
        this.emitLifecycle("levels_seeded", {
          symbol,
          details: {
            generatedAt: output.generatedAt,
          },
        });
        this.recordLevelSeedCompleted(symbol, startedAt);
      } catch (error) {
        this.recordLevelSeedFailed(symbol, startedAt, error);
        throw error;
      }
    })();
  }

  private async seedLevelsForSymbol(
    symbol: string,
    options: { force?: boolean; graceOnTimeout?: boolean } = {},
  ): Promise<void> {
    if (!options.force && this.options.levelStore.getLevels(symbol)) {
      this.setLevelsReadyOperation(symbol);
      return;
    }

    this.setEntryOperation(symbol, "loading candles and building levels");
    const seedOperation = this.beginSeedLevelsForSymbol(symbol);

    if (this.levelSeedTimeoutMs <= 0) {
      await seedOperation;
      this.setLevelsReadyOperation(symbol);
      return;
    }

    try {
      await withTimeout(
        seedOperation,
        this.levelSeedTimeoutMs,
        () => new LevelSeedTimeoutError(symbol, this.levelSeedTimeoutMs),
      );
    } catch (error) {
      this.recordLevelSeedTimeout(symbol, error);
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
    this.setLevelsReadyOperation(symbol);
  }

  private async restoreLevelsFromStartupCache(symbol: string): Promise<boolean> {
    if (!this.startupCachedLevelEngine) {
      return false;
    }

    if (this.options.levelStore.getLevels(symbol)) {
      return false;
    }

    try {
      const { output, seriesMap } = await this.startupCachedLevelEngine.generateLevelsWithCandleSeries({
        symbol,
        historicalRequests: this.buildLevelSeedHistoricalRequests(
          symbol,
          this.options.startupCachedCandleFetchService ?? this.options.candleFetchService,
        ),
        referencePriceOverride: this.resolveLevelSeedReferencePrice(symbol, Date.now()),
      });
      this.options.levelStore.setLevels(output);
      this.storeTechnicalContextForSymbol(symbol, output, seriesMap);
      this.options.monitor.seedMarketStructure(symbol, seriesMap);
      this.markSeededLevelsReady(symbol);
      this.startupCacheWarmingSymbols.add(symbol);
      this.startupCacheRestoredAt.set(symbol, Date.now());
      this.startupCacheFreshRefreshFailures.delete(symbol);
      this.watchlistStore.patchEntry(symbol, {
        lifecycle: "refresh_pending",
        refreshPending: true,
        operationStatus: "levels restored from cache, refreshing candles",
      });
      this.emitLifecycle("levels_seeded", {
        symbol,
        details: {
          generatedAt: output.generatedAt,
          source: "startup_cache",
          warming: true,
        },
      });
      return true;
    } catch (error) {
      this.emitLifecycle("restore_skipped", {
        symbol,
        details: {
          source: "startup_cache",
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
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
    budgeted?: boolean;
    eventType?: string | null;
    whyPosted?: string | null;
    tradeStoryState?: string | null;
    triggerPrice?: number | null;
  }): void {
    const state = this.pruneLiveThreadPosts(params.symbol, params.timestamp);
    if (params.budgeted !== false) {
      const target = params.critical ? state.critical : state.optional;
      target.push({
        kind: params.kind,
        timestamp: params.timestamp,
        eventType: params.eventType ?? null,
      });
    }
    this.lastThreadPostAt = params.timestamp;
    this.lastThreadPostSymbol = params.symbol;
    this.lastThreadPostKind = params.kind;
    this.lastThreadPostReason = params.whyPosted ?? null;
    const patch: Partial<WatchlistEntry> = {
      lastThreadPostAt: params.timestamp,
      lastThreadPostKind: params.kind,
      operationStatus: "monitoring live price",
    };
    if (params.tradeStoryState) {
      patch.lastTradeStoryState = params.tradeStoryState;
      patch.lastTradeStoryAt = params.timestamp;
    }
    if (typeof params.triggerPrice === "number" && Number.isFinite(params.triggerPrice)) {
      patch.lastTriggerPrice = params.triggerPrice;
    }
    this.watchlistStore.patchEntry(params.symbol, patch);
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

  private buildMondayReviewHealth(): ManualWatchlistMondayReviewHealth {
    const referenceTimestamp = Date.now();
    let criticalPostsLast15m = 0;
    let optionalPostsLast15m = 0;
    const symbolBudgets: ManualWatchlistMondayReviewHealth["symbolBudgets"] = [];

    for (const [symbol, state] of this.liveThreadPostState.entries()) {
      const pruned = this.pruneLiveThreadPosts(symbol, referenceTimestamp);
      const symbolCritical = pruned.critical.length;
      const symbolOptional = pruned.optional.length;
      const symbolTotal = symbolCritical + symbolOptional;
      criticalPostsLast15m += symbolCritical;
      optionalPostsLast15m += symbolOptional;
      if (symbolTotal > 0) {
        symbolBudgets.push({
          symbol,
          postsLast15m: symbolTotal,
          criticalPostsLast15m: symbolCritical,
          optionalPostsLast15m: symbolOptional,
          status:
            symbolTotal >= 6
              ? "busy"
              : symbolOptional >= 3 && symbolOptional > symbolCritical * 2
                ? "optional_heavy"
                : "calm",
        });
      }
    }

    const postsLast15m = criticalPostsLast15m + optionalPostsLast15m;
    const stuckActivations = this.getStuckActivations(referenceTimestamp);
    let postBudgetStatus: ManualWatchlistMondayReviewHealth["postBudgetStatus"] = "calm";
    if (this.lastDeliveryFailureAt !== null || stuckActivations.length > 0) {
      postBudgetStatus = "needs_attention";
    } else if (postsLast15m >= 12) {
      postBudgetStatus = "busy";
    } else if (optionalPostsLast15m >= 4 && optionalPostsLast15m > criticalPostsLast15m * 2) {
      postBudgetStatus = "optional_heavy";
    }

    const checklist = [
      "Review trader-post-quality-report.md after the next live run.",
      "Check all-symbol-stress-report.md for symbols above their post budget.",
      "Spot-check any post with a missing next support or resistance reason.",
    ];
    if (postsLast15m >= 12) {
      checklist.unshift("Post flow is busy; confirm the thread is telling one trade story, not level-by-level chatter.");
    }
    if (optionalPostsLast15m >= 4 && optionalPostsLast15m > criticalPostsLast15m * 2) {
      checklist.unshift("Optional context is heavier than critical alerts; review recap and follow-through settings.");
    }
    if (stuckActivations.length > 0) {
      checklist.unshift("Resolve stuck activations before trusting post-budget counts.");
    }
    if (this.lastDeliveryFailureAt !== null) {
      checklist.unshift("Resolve the latest Discord delivery failure before judging signal quality.");
    }

    return {
      postBudgetStatus,
      postsLast15m,
      criticalPostsLast15m,
      optionalPostsLast15m,
      lastWhyPosted: this.lastThreadPostReason,
      symbolBudgets: symbolBudgets.sort(
        (left, right) => right.postsLast15m - left.postsLast15m || left.symbol.localeCompare(right.symbol),
      ).slice(0, 12),
      checklist,
    };
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

  private shouldSuppressSameOrLowerValueLevelStory(params: {
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
        story.label !== "cleared" &&
        this.isSameStoryLevel(story.level, params.level) &&
        story.priority >= priority &&
        story.timestamp <= params.timestamp,
    );
  }

  private highestRecentlyPostedResistanceClear(
    symbol: string,
    timestamp: number,
    snapshotState: ActiveLevelSnapshotState,
  ): number | null {
    const recentPosted = this.pruneDominantLevelStories(symbol, timestamp)
      .filter((story) =>
        (story.eventType === "breakout" || story.eventType === "reclaim") &&
        story.timestamp <= timestamp &&
        Number.isFinite(story.level),
      )
      .map((story) => story.level);
    const levels = [
      ...(typeof snapshotState.lastClearedResistance === "number" ? [snapshotState.lastClearedResistance] : []),
      ...recentPosted,
    ];
    return levels.length > 0 ? Math.max(...levels) : null;
  }

  private lowestRecentlyPostedSupportClear(
    symbol: string,
    timestamp: number,
    snapshotState: ActiveLevelSnapshotState,
  ): number | null {
    const recentPosted = this.pruneDominantLevelStories(symbol, timestamp)
      .filter((story) =>
        story.eventType === "breakdown" &&
        story.timestamp <= timestamp &&
        Number.isFinite(story.level),
      )
      .map((story) => story.level);
    const levels = [
      ...(typeof snapshotState.lastClearedSupport === "number" ? [snapshotState.lastClearedSupport] : []),
      ...recentPosted,
    ];
    return levels.length > 0 ? Math.min(...levels) : null;
  }

  private cancelPendingFastLevelClearIfSameStory(params: {
    symbol: string;
    eventType: string;
    level: number;
  }): boolean {
    const normalizedSymbol = normalizeSymbol(params.symbol);
    const pending = this.pendingFastLevelClearAlerts.get(normalizedSymbol);
    const snapshotState = this.activeSnapshotState.get(normalizedSymbol);
    if (!pending || !snapshotState || !Number.isFinite(params.level)) {
      return false;
    }

    let pendingLevel: number | null = null;
    if (params.eventType === "breakout" || params.eventType === "reclaim") {
      const cluster = this.findFastClearedResistanceCluster(
        normalizedSymbol,
        snapshotState,
        pending.update.lastPrice,
        pending.update.timestamp,
      );
      pendingLevel = cluster.at(-1)?.representativePrice ?? null;
    } else if (params.eventType === "breakdown") {
      const cluster = this.findFastLostSupportCluster(
        normalizedSymbol,
        snapshotState,
        pending.update.lastPrice,
        pending.update.timestamp,
      );
      pendingLevel = cluster.at(-1)?.representativePrice ?? null;
    }

    if (pendingLevel === null || !this.isSameStoryLevel(pendingLevel, params.level)) {
      return false;
    }

    clearTimeout(pending.timer);
    this.pendingFastLevelClearAlerts.delete(normalizedSymbol);
    return true;
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
    const levelImportance = alert.zone
      ? assessFinalLevelImportance({ zone: alert.zone, price: alert.event.triggerPrice })
      : null;
    this.intelligentAlertPostState.set(alert.symbol, [
      ...previous,
      buildIntelligentAlertStoryRecord({
        timestamp: alert.event.timestamp,
        eventType: alert.event.eventType,
        level: alert.event.level,
        triggerPrice: alert.event.triggerPrice,
        severity: alert.severity,
        score: alert.score,
        practicalStructureState: alert.event.eventContext.tradeStructure?.state,
        practicalZoneKey: alert.event.eventContext.tradeStructure?.practicalZoneKey,
        stableMarketStructureState: alert.event.eventContext.stableMarketStructureState,
        stableMarketStructureKey: alert.event.eventContext.stableMarketStructureKey,
        formalStructureEventType: alert.event.eventContext.formalStructureEventType,
        formalStructureKey: alert.event.eventContext.formalStructureKey,
        formalStructureMaterialChange: alert.event.eventContext.formalStructureMaterialChange,
        selectedFormalStructureEventType: alert.event.eventContext.selectedFormalStructureEventType,
        selectedFormalStructureKey: alert.event.eventContext.selectedFormalStructureKey,
        selectedFormalStructureMaterialChange: alert.event.eventContext.selectedFormalStructureMaterialChange,
        tradeStoryState: alert.event.eventContext.tradeStoryState,
        rangeBoxLabel: alert.event.eventContext.rangeBox?.label,
        acceptanceLabel: alert.event.eventContext.acceptance?.label,
        behaviorBudgetLabel: alert.event.eventContext.behaviorBudget?.label,
        primaryTradeAreaLocked: alert.event.eventContext.primaryTradeArea?.locked,
        primaryTradeAreaEscapeSide: alert.event.eventContext.primaryTradeArea?.escapeSide,
        primaryTradeAreaEscapeConfidence: alert.event.eventContext.primaryTradeArea?.escapeConfidence,
        failedLevelOutcome: alert.event.eventContext.failedLevelMemory?.outcome,
        levelImportanceLabel: levelImportance?.label,
      }),
    ]);
    return previous;
  }

  private pruneThreadStoryPhaseState(symbol: string, timestamp: number): ThreadStoryPhaseRecord[] {
    const state = this.threadStoryPhaseState.get(symbol) ?? [];
    const pruned = pruneThreadStoryPhaseRecords(state, timestamp, this.postingPolicySettings);
    this.threadStoryPhaseState.set(symbol, pruned);
    return pruned;
  }

  private shouldPostThreadStoryPhase(params: {
    symbol: string;
    timestamp: number;
    eventType?: string | null;
    level: number;
    triggerPrice: number;
    practicalStructureState?: PracticalTradeStructureState;
    practicalZoneKey?: string;
    practicalStructureMaterialChange?: boolean;
    followThroughLabel?: string | null;
    zoneKind?: "support" | "resistance" | null;
    majorChange?: boolean;
  }): { shouldPost: boolean; reason: string; record?: ThreadStoryPhaseRecord } {
    const phase = deriveThreadStoryPhase({
      eventType: params.eventType,
      practicalStructureState: params.practicalStructureState,
      followThroughLabel: params.followThroughLabel,
      zoneKind: params.zoneKind,
    });
    if (!phase) {
      return { shouldPost: true, reason: "no_phase" };
    }

    const areaKey = buildThreadStoryPhaseAreaKey({
      eventType: params.eventType,
      level: params.level,
      practicalZoneKey: params.practicalZoneKey,
    });
    const decision = decideThreadStoryPhasePost({
      records: this.pruneThreadStoryPhaseState(params.symbol, params.timestamp),
      timestamp: params.timestamp,
      phase,
      areaKey,
      triggerPrice: params.triggerPrice,
      eventType: params.eventType,
      materialChange: params.practicalStructureMaterialChange,
      majorChange: params.majorChange,
      settings: this.postingPolicySettings,
    });
    if (!decision.shouldPost) {
      return { shouldPost: false, reason: decision.reason };
    }

    return {
      shouldPost: true,
      reason: decision.reason,
      record: buildThreadStoryPhaseRecord({
        timestamp: params.timestamp,
        phase,
        areaKey,
        triggerPrice: params.triggerPrice,
        eventType: params.eventType,
      }),
    };
  }

  private reserveThreadStoryPhase(params: {
    symbol: string;
    record?: ThreadStoryPhaseRecord;
  }): ThreadStoryPhaseRecord[] {
    const previous = [...(this.threadStoryPhaseState.get(params.symbol) ?? [])];
    if (params.record) {
      this.threadStoryPhaseState.set(params.symbol, [...previous, params.record]);
    }
    return previous;
  }

  private shouldPostIntelligentAlert(alert: IntelligentAlert): { shouldPost: boolean; reason: string } {
    const recent = this.pruneIntelligentAlertPostState(alert.symbol, alert.event.timestamp);
    const levelImportance = alert.zone
      ? assessFinalLevelImportance({ zone: alert.zone, price: alert.event.triggerPrice })
      : null;
    const decision = decideIntelligentAlertPost({
      records: recent,
      timestamp: alert.event.timestamp,
      eventType: alert.event.eventType,
      level: alert.event.level,
      triggerPrice: alert.event.triggerPrice,
      severity: alert.severity,
      score: alert.score,
      practicalStructureState: alert.event.eventContext.tradeStructure?.state,
      practicalZoneKey: alert.event.eventContext.tradeStructure?.practicalZoneKey,
      practicalStructureMaterialChange: alert.event.eventContext.tradeStructure?.isMaterialStateChange,
      stableMarketStructureState: alert.event.eventContext.stableMarketStructureState,
      stableMarketStructureKey: alert.event.eventContext.stableMarketStructureKey,
      stableMarketStructureMaterialChange: alert.event.eventContext.stableMarketStructureMaterialChange,
      stableMarketStructureConfidence: alert.event.eventContext.stableMarketStructureConfidence,
      formalStructureEventType: alert.event.eventContext.formalStructureEventType,
      formalStructureKey: alert.event.eventContext.formalStructureKey,
      formalStructureMaterialChange: alert.event.eventContext.formalStructureMaterialChange,
      formalStructureTimeframe: alert.event.eventContext.formalStructureTimeframe,
      formalStructureConfidence: alert.event.eventContext.formalStructureConfidence,
      selectedFormalStructureEventType: alert.event.eventContext.selectedFormalStructureEventType,
      selectedFormalStructureKey: alert.event.eventContext.selectedFormalStructureKey,
      selectedFormalStructureMaterialChange: alert.event.eventContext.selectedFormalStructureMaterialChange,
      selectedFormalStructureTimeframe: alert.event.eventContext.selectedFormalStructureTimeframe,
      selectedFormalStructureConfidence: alert.event.eventContext.selectedFormalStructureConfidence,
      tradeStoryState: alert.event.eventContext.tradeStoryState,
      rangeBoxLabel: alert.event.eventContext.rangeBox?.label,
      acceptanceLabel: alert.event.eventContext.acceptance?.label,
      behaviorBudgetLabel: alert.event.eventContext.behaviorBudget?.label,
      primaryTradeAreaLocked: alert.event.eventContext.primaryTradeArea?.locked,
      primaryTradeAreaEscapeSide: alert.event.eventContext.primaryTradeArea?.escapeSide,
      primaryTradeAreaEscapeConfidence: alert.event.eventContext.primaryTradeArea?.escapeConfidence,
      failedLevelOutcome: alert.event.eventContext.failedLevelMemory?.outcome,
      levelImportanceLabel: levelImportance?.label,
      settings: this.postingPolicySettings,
    });
    if (!decision.shouldPost) {
      return { shouldPost: false, reason: decision.reason };
    }

    const phaseDecision = this.shouldPostThreadStoryPhase({
      symbol: alert.symbol,
      timestamp: alert.event.timestamp,
      eventType: alert.event.eventType,
      level: alert.event.level,
      triggerPrice: alert.event.triggerPrice,
      practicalStructureState: alert.event.eventContext.tradeStructure?.state,
      practicalZoneKey: alert.event.eventContext.tradeStructure?.practicalZoneKey,
      zoneKind: alert.event.zoneKind,
      majorChange:
        alert.event.eventType === "breakout" ||
        alert.event.eventType === "breakdown" ||
        alert.event.eventType === "reclaim" ||
        alert.severity === "critical" ||
        (alert.severity === "high" && alert.confidence === "high"),
    });
    return {
      shouldPost: phaseDecision.shouldPost,
      reason: phaseDecision.shouldPost ? decision.reason : `phase_${phaseDecision.reason}`,
    };
  }

  private shouldPostLevelClearUpdate(params: {
    symbol: string;
    timestamp: number;
    eventType: "breakout" | "breakdown";
    level: number;
    triggerPrice: number;
    majorChange?: boolean;
  }): { shouldPost: boolean; reason: string } {
    const recent = this.pruneIntelligentAlertPostState(params.symbol, params.timestamp);
    const decision = decideIntelligentAlertPost({
      records: recent,
      timestamp: params.timestamp,
      eventType: params.eventType,
      level: params.level,
      triggerPrice: params.triggerPrice,
      ladderStepUpdate: true,
      practicalStructureMaterialChange: params.majorChange === true,
      settings: this.postingPolicySettings,
    });
    if (!decision.shouldPost) {
      return { shouldPost: false, reason: decision.reason };
    }

    const phaseDecision = this.shouldPostThreadStoryPhase({
      symbol: params.symbol,
      timestamp: params.timestamp,
      eventType: params.eventType,
      level: params.level,
      triggerPrice: params.triggerPrice,
      zoneKind: params.eventType === "breakdown" ? "support" : "resistance",
      majorChange: params.majorChange,
    });
    return {
      shouldPost: phaseDecision.shouldPost,
      reason: phaseDecision.shouldPost ? decision.reason : `phase_${phaseDecision.reason}`,
    };
  }

  private recordLevelClearUpdate(params: {
    symbol: string;
    timestamp: number;
    eventType: "breakout" | "breakdown";
    level: number;
    triggerPrice: number;
    majorChange?: boolean;
  }): void {
    const previous = this.pruneIntelligentAlertPostState(params.symbol, params.timestamp);
    this.intelligentAlertPostState.set(params.symbol, [
      ...previous,
      buildIntelligentAlertStoryRecord({
        timestamp: params.timestamp,
        eventType: params.eventType,
        level: params.level,
        triggerPrice: params.triggerPrice,
      }),
    ]);
    const phaseDecision = this.shouldPostThreadStoryPhase({
      symbol: params.symbol,
      timestamp: params.timestamp,
      eventType: params.eventType,
      level: params.level,
      triggerPrice: params.triggerPrice,
      zoneKind: params.eventType === "breakdown" ? "support" : "resistance",
      majorChange: params.majorChange,
    });
    if (phaseDecision.shouldPost) {
      this.reserveThreadStoryPhase({
        symbol: params.symbol,
        record: phaseDecision.record,
      });
    }
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
          whyPosted: payload.metadata?.whyPosted ?? null,
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

    const marketStructureStoryDecision = this.resolveMarketStructureStoryDecision(
      progressUpdate.symbol,
      progressUpdate.timestamp,
    );
    const payload = formatFollowThroughStateUpdateAsPayload({
      symbol: progressUpdate.symbol,
      timestamp: progressUpdate.timestamp,
      eventType: progressUpdate.eventType,
      progressLabel: progressUpdate.progressLabel,
      directionalReturnPct: progressUpdate.directionalReturnPct,
      entryPrice: progressUpdate.entryPrice,
      currentPrice: progressUpdate.currentPrice,
      marketStructure: marketStructureStoryDecision.snapshot,
      includeMarketStructureStory: marketStructureStoryDecision.includeStory,
      marketStructureStoryKeys: marketStructureStoryDecision.keys,
    });
    this.annotateMarketStructureStoryPayload(
      payload,
      marketStructureStoryDecision,
      "follow_through_state",
    );
    const releaseMarketStructureCarrier = this.reserveMarketStructureStoryCarrier(
      progressUpdate.symbol,
      payload.metadata?.marketStructureStoryKeys,
    );

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
          whyPosted: payload.metadata?.whyPosted ?? null,
        });
        this.markMarketStructureStoryPosted(
          progressUpdate.symbol,
          progressUpdate.timestamp,
          payload,
          marketStructureStoryDecision,
        );
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
      })
      .finally(releaseMarketStructureCarrier);

    return true;
  }

  private maybeBypassRecapCooldown(params: {
    interpretation?: OpportunityInterpretation;
    progressUpdate?: OpportunityProgressUpdate;
    evaluation?: EvaluatedOpportunity;
  }): boolean {
    const evaluationMove =
      params.evaluation?.directionalReturnPct === null || params.evaluation?.directionalReturnPct === undefined
        ? 0
        : Math.abs(params.evaluation.directionalReturnPct);
    const progressMove =
      params.progressUpdate?.directionalReturnPct === null || params.progressUpdate?.directionalReturnPct === undefined
        ? 0
        : Math.abs(params.progressUpdate.directionalReturnPct);
    return (
      ((params.evaluation?.followThroughLabel === "failed" || params.evaluation?.followThroughLabel === "strong") &&
        evaluationMove >= FOLLOW_THROUGH_MAJOR_MOVE_PCT) ||
      (params.progressUpdate?.progressLabel === "degrading" && progressMove >= FOLLOW_THROUGH_MAJOR_MOVE_PCT) ||
      params.interpretation?.type === "weakening"
    );
  }

  private hasMeaningfulRecapCatalyst(params: {
    interpretation?: OpportunityInterpretation;
    progressUpdate?: OpportunityProgressUpdate;
    evaluation?: EvaluatedOpportunity;
  }): boolean {
    if (params.interpretation?.type === "confirmation" || params.interpretation?.type === "weakening") {
      return true;
    }

    const progressMove =
      params.progressUpdate?.directionalReturnPct === null || params.progressUpdate?.directionalReturnPct === undefined
        ? 0
        : Math.abs(params.progressUpdate.directionalReturnPct);
    if (
      params.progressUpdate &&
      (params.progressUpdate.progressLabel === "improving" || params.progressUpdate.progressLabel === "degrading") &&
      progressMove >= this.postingPolicySettings.minFollowThroughStateMovePct
    ) {
      return true;
    }

    const evaluationMove =
      params.evaluation?.directionalReturnPct === null || params.evaluation?.directionalReturnPct === undefined
        ? 0
        : Math.abs(params.evaluation.directionalReturnPct);
    return Boolean(
      params.evaluation &&
        (params.evaluation.followThroughLabel === "failed" || params.evaluation.followThroughLabel === "strong") &&
        evaluationMove >= FOLLOW_THROUGH_MAJOR_MOVE_PCT,
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
      return `${eventType} is working with tight room, so buyers need a cleaner reaction.`;
    }

    if (topOpportunity.pathQualityLabel === "choppy") {
      return `${eventType} is working through a choppy path, so acceptance still needs to get cleaner.`;
    }

    if (
      topOpportunity.exhaustionLabel === "worn" ||
      topOpportunity.exhaustionLabel === "spent"
    ) {
      return `${eventType} is still near an important level, but weak reactions are less trustworthy here.`;
    }

    return `${eventType} still needs clean acceptance for the move to stay constructive.`;
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
        `${eventType} is still the main read near ${level}; quality is ${topOpportunity.classification.replaceAll("_", " ")}.`,
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
          `That level still matters, but it looks ${topOpportunity.exhaustionLabel}, so weak reactions are less trustworthy than fresh ones.`,
        );
      }

      const nextStepLine = this.describeWhatMattersNext(topOpportunity);
      if (nextStepLine) {
        parts.push(nextStepLine);
      }
    }

    if (params.interpretation) {
      parts.push(`${params.interpretation.message}.`);
    }

    if (params.progressUpdate) {
      parts.push(
        `Follow-through is ${params.progressUpdate.progressLabel}; price change from the watched level is ${
          params.progressUpdate.directionalReturnPct === null
            ? "still unclear"
            : `${params.progressUpdate.directionalReturnPct >= 0 ? "+" : "-"}${Math.abs(params.progressUpdate.directionalReturnPct).toFixed(2)}%`
        }.`,
      );
    } else if (params.evaluation) {
      parts.push(
        `Follow-through is ${params.evaluation.followThroughLabel}; price change from the watched level is ${
          params.evaluation.directionalReturnPct === null
            ? "n/a"
            : `${params.evaluation.directionalReturnPct >= 0 ? "+" : "-"}${Math.abs(params.evaluation.directionalReturnPct).toFixed(2)}%`
        }.`,
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
      const operatorNote = this.watchlistStore.getEntry(params.alert.symbol)?.note;
      const commentary = await aiCommentaryService.explainSignal({
        symbol: params.alert.symbol,
        title: params.deterministicPayload.title,
        deterministicBody: this.buildAiSignalCommentaryBody(params.deterministicPayload),
        eventType: params.alert.event.eventType,
        severity: params.alert.severity,
        confidence: params.alert.confidence,
        score: params.alert.score,
        operatorNote,
        metadata: this.buildAiSignalCommentaryMetadata(params.deterministicPayload),
      });

      if (!commentary?.text) {
        return;
      }

      const commentaryLagMs = Date.now() - params.alert.event.timestamp;
      if (
        isEpochTimestamp(params.alert.event.timestamp) &&
        commentaryLagMs > AI_SIGNAL_COMMENTARY_MAX_DELIVERY_LAG_MS
      ) {
        this.aiSignalStoryState.set(normalizeSymbol(params.alert.symbol), previousAiState);
        this.emitLifecycle("ai_commentary_suppressed", {
          symbol: params.alert.symbol,
          threadId: params.threadId,
          details: {
            commentaryType: "intelligent_alert",
            eventType: params.alert.event.eventType,
            reason: "stale_ai_commentary",
            lagMs: commentaryLagMs,
          },
        });
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

      const signalCategory = routeMessageKindToSignalCategory({
        messageKind: "ai_signal_commentary",
        eventType: params.alert.event.eventType,
      }).primaryCategory;

      await this.options.discordAlertRouter.routeAlert(params.threadId, {
        title: `${params.alert.symbol} setup read`,
        body: commentary.text,
        event: params.alert.event,
        symbol: params.alert.symbol,
        timestamp: params.alert.event.timestamp,
        metadata: {
          eventType: params.alert.event.eventType,
          messageKind: "ai_signal_commentary",
          signalCategory,
          signalCategoryLiveEnabled: isSignalCategoryLiveEnabled(signalCategory),
          supportingSignalCategories: [resolvePrimarySignalCategoryForAlert(params.alert)],
          severity: params.alert.severity,
          confidence: params.alert.confidence,
          score: params.alert.score,
          targetPrice: params.alert.event.level,
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
        whyPosted: "AI commentary posted after deterministic alert",
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
      const operatorNote = this.watchlistStore.getEntry(params.symbol)?.note;
      const commentary = await aiCommentaryService.summarizeSymbolThread({
        symbol: params.symbol,
        deterministicRecap: params.deterministicBody,
        operatorNote,
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
        body: `${params.deterministicBody}\n\n${commentary.text}`,
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

    if (!this.hasMeaningfulRecapCatalyst(params)) {
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
          whyPosted: payload.metadata?.whyPosted ?? null,
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

  private marketStructureSnapshotCoverageScore(snapshot: RuntimeMarketStructureSnapshot | null | undefined): number {
    if (!snapshot) {
      return 0;
    }

    let score = 0;
    if (snapshot.timeframes?.["4h"]?.formal) score += 40;
    if (snapshot.timeframes?.["4h"]?.stable) score += 20;
    if (snapshot.timeframes?.["5m"]?.formal) score += 12;
    if (snapshot.timeframes?.["5m"]?.stable) score += 8;
    if (snapshot.formal) score += 4;
    if (snapshot.stable) score += 2;
    return score;
  }

  private getMarketStructureSnapshot(symbol: string): RuntimeMarketStructureSnapshot | null {
    const monitor = this.options.monitor as WatchlistMonitor & {
      getMarketStructureSnapshot?: (symbolInput: string) => RuntimeMarketStructureSnapshot | null;
    };

    if (typeof monitor.getMarketStructureSnapshot !== "function") {
      return null;
    }

    return monitor.getMarketStructureSnapshot(symbol);
  }

  private resolveMarketStructureStoryDecision(
    symbol: string,
    timestamp: number,
  ): MarketStructureStoryDecision {
    this.recordExpiredMarketStructureStories(symbol, timestamp);
    return this.marketStructureStoryMemory.decide(
      symbol,
      timestamp,
      this.getMarketStructureSnapshot(symbol),
    );
  }

  private captureFreshMarketStructureStory(symbol: string, timestamp: number): string[] {
    this.recordExpiredMarketStructureStories(symbol, timestamp);
    const snapshot = this.getMarketStructureSnapshot(symbol);
    const capturedKeys = this.marketStructureStoryMemory.capture(
      symbol,
      timestamp,
      snapshot,
    );
    if (capturedKeys.length > 0) {
      this.persistMarketStructureStoryMemory();
    }
    const freshBosChochKeys = getFreshFormalBosChochMarketStructureStoryKeys(snapshot);
    return capturedKeys.filter((key) => freshBosChochKeys.includes(key));
  }

  private recordExpiredMarketStructureStories(symbol: string, timestamp: number): void {
    const expired = this.marketStructureStoryMemory.consumeExpired(symbol, timestamp);
    if (expired.length > 0) {
      this.persistMarketStructureStoryMemory();
    }
    for (const story of expired) {
      this.emitLifecycle("market_structure_story_expired", {
        symbol,
        details: {
          storyKey: story.key,
          capturedAt: story.capturedAt,
          expiresAt: story.expiresAt,
          expiredAt: story.expiredAt,
        },
      });
    }
  }

  private marketStructureStoryKeysForPayload(
    payload: AlertPayload,
    decision?: MarketStructureStoryDecision,
  ): string[] {
    if (
      payload.metadata?.marketStructureStoryVisible !== true &&
      decision?.includeStory !== true
    ) {
      return [];
    }

    const snapshotKeys = getMaterialMarketStructureStoryKeys(
      payload.metadata?.runtimeMarketStructure ?? decision?.snapshot ?? null,
    );
    if (decision?.keys && decision.keys.length > 0) {
      const selectedKeys = snapshotKeys.filter((key) => decision.keys.includes(key));
      return selectedKeys.length > 0 ? selectedKeys : decision.keys;
    }

    return snapshotKeys;
  }

  private annotateMarketStructureStoryPayload(
    payload: AlertPayload,
    decision: MarketStructureStoryDecision,
    source: string,
  ): void {
    payload.metadata = {
      ...payload.metadata,
      marketStructureStoryReason: decision.reason,
      marketStructureStoryKeys: this.marketStructureStoryKeysForPayload(payload, decision),
      marketStructureStorySource: source,
    };
  }

  private markMarketStructureStoryPosted(
    symbol: string,
    timestamp: number,
    payload: AlertPayload,
    decision?: MarketStructureStoryDecision,
  ): void {
    if (payload.metadata?.marketStructureStoryVisible !== true) {
      return;
    }

    const postedKeys = this.marketStructureStoryMemory.markPosted(
      symbol,
      timestamp,
      payload.metadata.runtimeMarketStructure ?? decision?.snapshot ?? null,
      payload.metadata.marketStructureStoryKeys,
    );
    if (postedKeys.length > 0) {
      this.persistMarketStructureStoryMemory();
    }
  }

  private reserveMarketStructureStoryCarrier(symbolInput: string, keysInput: string[] | undefined): () => void {
    const keys = keysInput?.filter((key) => key.trim().length > 0) ?? [];
    if (keys.length === 0) {
      return () => undefined;
    }

    const symbol = normalizeSymbol(symbolInput);
    const inFlight = this.marketStructureCarrierInFlightKeys.get(symbol) ?? new Set<string>();
    keys.forEach((key) => inFlight.add(key));
    this.marketStructureCarrierInFlightKeys.set(symbol, inFlight);

    return () => {
      const current = this.marketStructureCarrierInFlightKeys.get(symbol);
      if (!current) {
        return;
      }

      keys.forEach((key) => current.delete(key));
      if (current.size === 0) {
        this.marketStructureCarrierInFlightKeys.delete(symbol);
      }
    };
  }

  private hasMarketStructureCarrierInFlight(symbolInput: string, keys: string[]): boolean {
    const inFlight = this.marketStructureCarrierInFlightKeys.get(normalizeSymbol(symbolInput));
    if (!inFlight) {
      return false;
    }

    return keys.some((key) => inFlight.has(key));
  }

  private clearPendingMarketStructureStandalonePost(symbolInput: string): void {
    const symbol = normalizeSymbol(symbolInput);
    const pending = this.pendingMarketStructureStandalonePosts.get(symbol);
    if (!pending) {
      return;
    }

    clearTimeout(pending);
    this.pendingMarketStructureStandalonePosts.delete(symbol);
  }

  private marketStructureStandalonePostDelayMs(): number {
    return this.marketStructureStandalonePostMode === "testing"
      ? MARKET_STRUCTURE_STANDALONE_TESTING_POST_DELAY_MS
      : MARKET_STRUCTURE_STANDALONE_POST_DELAY_MS;
  }

  private marketStructureStandaloneRepeatCooldownMs(): number {
    return this.marketStructureStandalonePostMode === "testing"
      ? MARKET_STRUCTURE_STANDALONE_TESTING_REPEAT_COOLDOWN_MS
      : MARKET_STRUCTURE_STANDALONE_REPEAT_COOLDOWN_MS;
  }

  private scheduleStandaloneMarketStructurePost(
    symbolInput: string,
    timestamp: number,
    delayMs?: number,
  ): void {
    if (this.marketStructureStandalonePostMode === "off") {
      return;
    }

    const symbol = normalizeSymbol(symbolInput);
    if (this.pendingMarketStructureStandalonePosts.has(symbol)) {
      return;
    }

    const effectiveDelayMs = Math.max(0, delayMs ?? this.marketStructureStandalonePostDelayMs());
    const timer = setTimeout(() => {
      this.pendingMarketStructureStandalonePosts.delete(symbol);
      void this.maybePostStandaloneMarketStructureUpdate(symbol, timestamp);
    }, effectiveDelayMs);
    timer.unref();
    this.pendingMarketStructureStandalonePosts.set(symbol, timer);
  }

  private maybePostStandaloneMarketStructureUpdate = async (
    symbol: string,
    timestamp: number,
  ): Promise<void> => {
    const entry = this.watchlistStore.getEntry(symbol);
    if (!entry?.active || !entry.discordThreadId) {
      return;
    }

    if (this.marketStructureStandalonePostMode === "off") {
      this.emitLifecycle("market_structure_post_suppressed", {
        symbol,
        threadId: entry.discordThreadId,
        details: {
          reason: "standalone_mode_off",
        },
      });
      return;
    }

    const decision = this.resolveMarketStructureStoryDecision(symbol, timestamp);
    if (!decision.includeStory || !decision.snapshot) {
      return;
    }

    const freshBosChochKeys = getFreshFormalBosChochMarketStructureStoryKeys(decision.snapshot)
      .filter((key) => decision.keys.length === 0 || decision.keys.includes(key));
    if (freshBosChochKeys.length === 0) {
      return;
    }

    if (this.hasMarketStructureCarrierInFlight(symbol, freshBosChochKeys)) {
      this.scheduleStandaloneMarketStructurePost(
        symbol,
        timestamp,
        MARKET_STRUCTURE_STANDALONE_RETRY_DELAY_MS,
      );
      return;
    }

    if (
      this.shouldYieldOptionalPostToFreshCritical({
        symbol,
        timestamp,
      })
    ) {
      this.scheduleStandaloneMarketStructurePost(
        symbol,
        timestamp,
        MARKET_STRUCTURE_STANDALONE_RETRY_DELAY_MS,
      );
      return;
    }

    if (
      this.hasRecentLiveThreadPost({
        symbol,
        timestamp,
        kinds: ["market_structure_update"],
        critical: false,
        withinMs: this.marketStructureStandaloneRepeatCooldownMs(),
      })
    ) {
      this.emitLifecycle("market_structure_post_suppressed", {
        symbol,
        threadId: entry.discordThreadId,
        details: {
          reason: "standalone_repeat_cooldown",
          storyKeys: freshBosChochKeys.join(","),
          mode: this.marketStructureStandalonePostMode,
        },
      });
      return;
    }

    const payload = formatMarketStructureUpdateAsPayload({
      symbol,
      timestamp,
      marketStructure: decision.snapshot,
      storyReason: decision.reason,
      storyKeys: freshBosChochKeys,
      storySource: "standalone_structure_update",
    });
    if (payload.metadata?.signalCategoryLiveEnabled === false) {
      this.emitLifecycle("market_structure_post_suppressed", {
        symbol,
        threadId: entry.discordThreadId,
        details: {
          reason: "signal_category_not_live",
          signalCategory: payload.metadata.signalCategory ?? null,
        },
      });
      return;
    }

    const releaseCarrier = this.reserveMarketStructureStoryCarrier(symbol, freshBosChochKeys);
    try {
      await this.options.discordAlertRouter.routeAlert(entry.discordThreadId, payload);
      this.recordLiveThreadPost({
        symbol,
        timestamp,
        kind: "market_structure_update",
        critical: false,
        eventType: null,
        whyPosted: payload.metadata?.whyPosted ?? null,
      });
      this.markMarketStructureStoryPosted(symbol, timestamp, payload, decision);
      this.clearDeliveryFailure(symbol, timestamp);
      this.emitLifecycle("market_structure_posted", {
        symbol,
        threadId: entry.discordThreadId,
        details: {
          reason: decision.reason,
          storyKeys: freshBosChochKeys.join(","),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitLifecycle("market_structure_post_failed", {
        symbol,
        threadId: entry.discordThreadId,
        details: {
          error: message,
          storyKeys: freshBosChochKeys.join(","),
        },
      });
      this.recordDeliveryFailure(symbol, timestamp, message);
      console.error(`[ManualWatchlistRuntimeManager] Failed to route market structure update: ${message}`);
    } finally {
      releaseCarrier();
    }
  };

  private hydrateEventRuntimeMarketStructure(event: MonitoringEvent): void {
    const storyDecision = this.resolveMarketStructureStoryDecision(event.symbol, event.timestamp);
    const currentSnapshot = storyDecision.snapshot;
    if (!currentSnapshot) {
      return;
    }

    const existingSnapshot = event.eventContext.runtimeMarketStructure;
    if (
      storyDecision.includeStory ||
      this.marketStructureSnapshotCoverageScore(currentSnapshot) >
      this.marketStructureSnapshotCoverageScore(existingSnapshot)
    ) {
      event.eventContext.runtimeMarketStructure = currentSnapshot;
    }
  }

  private handleMonitoringEvent = (event: MonitoringEvent): void => {
    const entry = this.watchlistStore.getEntry(event.symbol);
    if (!entry?.active || !entry.discordThreadId) {
      return;
    }

    this.hydrateEventRuntimeMarketStructure(event);

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
      const marketStructureStoryDecision = this.resolveMarketStructureStoryDecision(
        event.symbol,
        event.timestamp,
      );
      if (marketStructureStoryDecision.snapshot) {
        alertResult.rawAlert.event.eventContext.runtimeMarketStructure =
          marketStructureStoryDecision.snapshot;
      }
      const alert = formatIntelligentAlertAsPayload(alertResult.rawAlert, {
        marketStructureStoryVisibility: marketStructureStoryDecision.includeStory
          ? "always"
          : "metadata_only",
        marketStructureStoryKeys: marketStructureStoryDecision.keys,
      });
      alert.metadata = {
        ...alert.metadata,
        postingFamily: alertResult.delivery.family,
        postingDecisionReason: alertResult.delivery.reason,
      };
      this.annotateMarketStructureStoryPayload(
        alert,
        marketStructureStoryDecision,
        "intelligent_alert",
      );
      const postAlert = (): void => {
        const alertPostDecision = this.shouldPostIntelligentAlert(alertResult.rawAlert);
        if (!alertPostDecision.shouldPost) {
          this.emitLifecycle("alert_suppressed", {
            symbol: event.symbol,
            threadId: entry.discordThreadId,
            details: {
              eventType: event.eventType,
              level: alertResult.rawAlert.event.level,
              triggerPrice: alertResult.rawAlert.event.triggerPrice,
              zoneKind: alertResult.rawAlert.event.zoneKind,
              severity: alertResult.rawAlert.severity,
              confidence: alertResult.rawAlert.confidence,
              score: alertResult.rawAlert.score,
              reason: alertPostDecision.reason,
              whyNotPosted: alertPostDecision.reason,
              tradeStoryState: alertResult.rawAlert.event.eventContext.tradeStoryState ?? null,
              rangeBoxLabel: alertResult.rawAlert.event.eventContext.rangeBox?.label ?? null,
              acceptanceLabel: alertResult.rawAlert.event.eventContext.acceptance?.label ?? null,
              behaviorBudgetLabel: alertResult.rawAlert.event.eventContext.behaviorBudget?.label ?? null,
              primaryTradeAreaLocked: alertResult.rawAlert.event.eventContext.primaryTradeArea?.locked ?? null,
              primaryTradeAreaEscapeSide: alertResult.rawAlert.event.eventContext.primaryTradeArea?.escapeSide ?? null,
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
              level: alertResult.rawAlert.event.level,
              triggerPrice: alertResult.rawAlert.event.triggerPrice,
              zoneKind: alertResult.rawAlert.event.zoneKind,
              severity: alertResult.rawAlert.severity,
              confidence: alertResult.rawAlert.confidence,
              score: alertResult.rawAlert.score,
              reason: "critical_burst_governor",
              whyNotPosted: "critical_burst_governor",
              tradeStoryState: alertResult.rawAlert.event.eventContext.tradeStoryState ?? null,
              rangeBoxLabel: alertResult.rawAlert.event.eventContext.rangeBox?.label ?? null,
              acceptanceLabel: alertResult.rawAlert.event.eventContext.acceptance?.label ?? null,
              behaviorBudgetLabel: alertResult.rawAlert.event.eventContext.behaviorBudget?.label ?? null,
              primaryTradeAreaLocked: alertResult.rawAlert.event.eventContext.primaryTradeArea?.locked ?? null,
              primaryTradeAreaEscapeSide: alertResult.rawAlert.event.eventContext.primaryTradeArea?.escapeSide ?? null,
            },
          });
          return;
        }

        const alertPhaseDecision = this.shouldPostThreadStoryPhase({
          symbol: alertResult.rawAlert.symbol,
          timestamp: alertResult.rawAlert.event.timestamp,
          eventType: alertResult.rawAlert.event.eventType,
          level: alertResult.rawAlert.event.level,
          triggerPrice: alertResult.rawAlert.event.triggerPrice,
          practicalStructureState: alertResult.rawAlert.event.eventContext.tradeStructure?.state,
          practicalZoneKey: alertResult.rawAlert.event.eventContext.tradeStructure?.practicalZoneKey,
          practicalStructureMaterialChange: alertResult.rawAlert.event.eventContext.tradeStructure?.isMaterialStateChange,
          zoneKind: alertResult.rawAlert.event.zoneKind,
          majorChange: criticalMajorChange,
        });
        if (!alertPhaseDecision.shouldPost) {
          this.emitLifecycle("alert_suppressed", {
            symbol: event.symbol,
            threadId: entry.discordThreadId,
            details: {
              eventType: event.eventType,
              level: alertResult.rawAlert.event.level,
              triggerPrice: alertResult.rawAlert.event.triggerPrice,
              zoneKind: alertResult.rawAlert.event.zoneKind,
              severity: alertResult.rawAlert.severity,
              confidence: alertResult.rawAlert.confidence,
              score: alertResult.rawAlert.score,
              reason: `phase_${alertPhaseDecision.reason}`,
              whyNotPosted: `phase_${alertPhaseDecision.reason}`,
              tradeStoryState: alertResult.rawAlert.event.eventContext.tradeStoryState ?? null,
              rangeBoxLabel: alertResult.rawAlert.event.eventContext.rangeBox?.label ?? null,
              acceptanceLabel: alertResult.rawAlert.event.eventContext.acceptance?.label ?? null,
              behaviorBudgetLabel: alertResult.rawAlert.event.eventContext.behaviorBudget?.label ?? null,
              primaryTradeAreaLocked: alertResult.rawAlert.event.eventContext.primaryTradeArea?.locked ?? null,
              primaryTradeAreaEscapeSide: alertResult.rawAlert.event.eventContext.primaryTradeArea?.escapeSide ?? null,
            },
          });
          return;
        }

        const previousIntelligentAlertPostState = this.reserveIntelligentAlertPost(alertResult.rawAlert);
        const previousThreadStoryPhaseState = this.reserveThreadStoryPhase({
          symbol: alertResult.rawAlert.symbol,
          record: alertPhaseDecision.record,
        });
        this.recordStoryCriticalAttempt({
          symbol: event.symbol,
          timestamp: event.timestamp,
          kind: "intelligent_alert",
        });
        const releaseMarketStructureCarrier = this.reserveMarketStructureStoryCarrier(
          event.symbol,
          alert.metadata?.marketStructureStoryKeys,
        );
        void this.options.discordAlertRouter
          .routeAlert(entry.discordThreadId!, alert)
          .then(() => {
            this.recordDominantLevelStory({
              symbol: event.symbol,
              level: alertResult.rawAlert.event.level,
              eventType: event.eventType,
              timestamp: event.timestamp,
            });
            if (
              this.cancelPendingFastLevelClearIfSameStory({
                symbol: event.symbol,
                eventType: event.eventType,
                level: alertResult.rawAlert.event.level,
              })
            ) {
              this.emitLifecycle("alert_suppressed", {
                symbol: event.symbol,
                threadId: entry.discordThreadId,
                details: {
                  eventType: "level_clear_update",
                  reason: "superseded_by_full_alert",
                },
              });
            }
            this.recordLiveThreadPost({
              symbol: event.symbol,
              timestamp: event.timestamp,
              kind: "intelligent_alert",
              critical: true,
              eventType: event.eventType,
              whyPosted: alert.metadata?.whyPosted ?? alertResult.delivery.reason,
              tradeStoryState: alertResult.rawAlert.event.eventContext.tradeStoryState,
              triggerPrice: alertResult.rawAlert.event.triggerPrice,
            });
            this.markMarketStructureStoryPosted(
              event.symbol,
              event.timestamp,
              alert,
              marketStructureStoryDecision,
            );
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
            this.threadStoryPhaseState.set(event.symbol, previousThreadStoryPhaseState);
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
          })
          .finally(releaseMarketStructureCarrier);
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
          level: alertResult.rawAlert.event.level,
          triggerPrice: alertResult.rawAlert.event.triggerPrice,
          zoneKind: alertResult.rawAlert.event.zoneKind,
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
          whyNotPosted: alertResult.delivery.reason,
          tradeStoryState: alertResult.rawAlert.event.eventContext.tradeStoryState ?? null,
          rangeBoxLabel: alertResult.rawAlert.event.eventContext.rangeBox?.label ?? null,
          acceptanceLabel: alertResult.rawAlert.event.eventContext.acceptance?.label ?? null,
          behaviorBudgetLabel: alertResult.rawAlert.event.eventContext.behaviorBudget?.label ?? null,
          primaryTradeAreaLocked: alertResult.rawAlert.event.eventContext.primaryTradeArea?.locked ?? null,
          primaryTradeAreaEscapeSide: alertResult.rawAlert.event.eventContext.primaryTradeArea?.escapeSide ?? null,
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
      this.emitLifecycle("alert_suppressed", {
        symbol: evaluation.symbol,
        threadId: entry.discordThreadId,
        details: {
          eventType: evaluation.eventType,
          followThroughLabel: evaluation.followThroughLabel,
          level: evaluation.entryPrice,
          triggerPrice: evaluation.outcomePrice,
          directionalReturnPct: evaluation.directionalReturnPct,
          reason: "lower_value_follow_through_story",
          whyNotPosted: "lower_value_follow_through_story",
        },
      });
      return false;
    }

    const followThroughDecision = this.decideFollowThroughUpdate(evaluation);
    if (!followThroughDecision.shouldPost) {
      this.emitLifecycle("alert_suppressed", {
        symbol: evaluation.symbol,
        threadId: entry.discordThreadId,
        details: {
          eventType: evaluation.eventType,
          followThroughLabel: evaluation.followThroughLabel,
          level: evaluation.entryPrice,
          triggerPrice: evaluation.outcomePrice,
          directionalReturnPct: evaluation.directionalReturnPct,
          reason: followThroughDecision.reason,
          whyNotPosted: followThroughDecision.reason,
        },
      });
      return false;
    }

    const followThroughMajorChange =
      evaluation.followThroughLabel === "failed" ||
      evaluation.followThroughLabel === "strong" ||
      (evaluation.directionalReturnPct !== null &&
        Math.abs(evaluation.directionalReturnPct) >= FOLLOW_THROUGH_MAJOR_MOVE_PCT);
    const phaseDecision = this.shouldPostThreadStoryPhase({
      symbol: evaluation.symbol,
      timestamp: evaluation.evaluatedAt,
      eventType: evaluation.eventType,
      level: evaluation.entryPrice,
      triggerPrice: evaluation.outcomePrice,
      followThroughLabel: evaluation.followThroughLabel,
      practicalStructureMaterialChange: followThroughDecision.reason === "materially_new",
      zoneKind: evaluation.eventType === "breakdown" ? "support" : "resistance",
      majorChange: followThroughMajorChange,
    });
    if (!phaseDecision.shouldPost) {
      this.emitLifecycle("alert_suppressed", {
        symbol: evaluation.symbol,
        threadId: entry.discordThreadId,
        details: {
          eventType: evaluation.eventType,
          followThroughLabel: evaluation.followThroughLabel,
          reason: `phase_${phaseDecision.reason}`,
        },
      });
      return false;
    }

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
    const previousThreadStoryPhaseState = this.reserveThreadStoryPhase({
      symbol: evaluation.symbol,
      record: phaseDecision.record,
    });
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
    const marketStructureStoryDecision = this.resolveMarketStructureStoryDecision(
      evaluation.symbol,
      evaluation.evaluatedAt,
    );
    const payload = formatFollowThroughUpdateAsPayload({
      symbol: evaluation.symbol,
      timestamp: evaluation.evaluatedAt,
      followThrough,
      entryPrice: evaluation.entryPrice,
      outcomePrice: evaluation.outcomePrice,
      repeatedOutcomeUpdate: followThroughDecision.reason === "materially_new",
      marketStructure: marketStructureStoryDecision.snapshot,
      includeMarketStructureStory: marketStructureStoryDecision.includeStory,
      marketStructureStoryKeys: marketStructureStoryDecision.keys,
    });
    this.annotateMarketStructureStoryPayload(
      payload,
      marketStructureStoryDecision,
      "follow_through",
    );
    if (payload.metadata?.signalCategoryLiveEnabled === false) {
      this.followThroughPostState.set(evaluation.symbol, previousFollowThroughPostState);
      this.threadStoryPhaseState.set(evaluation.symbol, previousThreadStoryPhaseState);
      this.emitLifecycle("alert_suppressed", {
        symbol: evaluation.symbol,
        threadId: entry.discordThreadId,
        details: {
          eventType: evaluation.eventType,
          followThroughLabel: evaluation.followThroughLabel,
          reason: "signal_category_not_live",
          signalCategory: payload.metadata.signalCategory ?? null,
        },
      });
      return false;
    }

    const releaseMarketStructureCarrier = this.reserveMarketStructureStoryCarrier(
      evaluation.symbol,
      payload.metadata?.marketStructureStoryKeys,
    );
    void this.options.discordAlertRouter
      .routeAlert(entry.discordThreadId, payload)
      .then(() => {
        this.recordLiveThreadPost({
          symbol: evaluation.symbol,
          timestamp: evaluation.evaluatedAt,
          kind: "follow_through",
          critical: true,
          eventType: evaluation.eventType,
          whyPosted: payload.metadata?.whyPosted ?? null,
        });
        this.markMarketStructureStoryPosted(
          evaluation.symbol,
          evaluation.evaluatedAt,
          payload,
          marketStructureStoryDecision,
        );
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
        this.threadStoryPhaseState.set(evaluation.symbol, previousThreadStoryPhaseState);
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
      })
      .finally(releaseMarketStructureCarrier);

    return true;
  }

  private handlePriceUpdate = (update: LivePriceUpdate): void => {
    this.lastPriceUpdateAt = update.timestamp;
    this.lastPriceUpdateSymbol = update.symbol;
    const freshStructureKeys = this.captureFreshMarketStructureStory(update.symbol, update.timestamp);
    if (freshStructureKeys.length > 0) {
      this.scheduleStandaloneMarketStructurePost(update.symbol, update.timestamp);
    }
    this.watchlistStore.patchEntry(update.symbol, {
      lastPriceUpdateAt: update.timestamp,
      lastPrice: update.lastPrice,
      operationStatus: "monitoring live price",
    });
    this.ingestLiveTechnicalContextPrice(update);
    this.publishLiveTickerData(update);
    if (
      this.lastPriceUpdatePersistAt === null ||
      update.timestamp - this.lastPriceUpdatePersistAt >= PRICE_UPDATE_PERSIST_INTERVAL_MS
    ) {
      this.persistWatchlist();
      this.lastPriceUpdatePersistAt = update.timestamp;
    }

    this.scheduleFastLevelClear(update);

    void this.maybeRefreshLevelSnapshot(update).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ManualWatchlistRuntimeManager] Failed to refresh level snapshot: ${message}`);
    }).finally(() => {
      this.scheduleTradersLinkAiRead(update.symbol, false, "automatic");
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

  private async restartMonitoringForPreparedActivation(entry: WatchlistEntry): Promise<void> {
    const restartTask = this.monitoringRestartQueue
      .catch(() => undefined)
      .then(async () => {
        await this.options.monitor.stop();
        const activeEntries = await this.ensureLevelsForActiveEntries(
          this.watchlistStore.getActiveEntries(),
          { seedMissingLevels: true },
        );
        const preparedEntry: WatchlistEntry = {
          ...entry,
          active: true,
          lifecycle: "active",
          refreshPending: false,
          operationStatus: "monitoring live price",
        };
        const startableEntries = [
          ...activeEntries.filter((candidate) => candidate.symbol !== preparedEntry.symbol),
          preparedEntry,
        ];
        await this.options.monitor.start(
          startableEntries,
          this.handleMonitoringEvent,
          this.handlePriceUpdate,
        );
        this.emitLifecycle("monitor_restart_completed", {
          symbol: preparedEntry.symbol,
          details: {
            activeSymbolCount: activeEntries.length,
            startableSymbolCount: startableEntries.length,
            preparedActivation: true,
          },
        });
      });
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

  async switchLivePriceProvider(provider: LivePriceProvider): Promise<void> {
    const restartTask = this.monitoringRestartQueue
      .catch(() => undefined)
      .then(async () => {
        const activeEntries = this.watchlistStore.getActiveEntries();
        const startableEntries = this.isStarted
          ? await this.ensureLevelsForActiveEntries(activeEntries, {
              seedMissingLevels: false,
            })
          : [];
        await this.options.monitor.stop();
        const previousProvider = this.options.monitor.setLivePriceProvider(provider);
        if (!this.isStarted) {
          return;
        }

        try {
          if (startableEntries.length === 0) {
            this.emitLifecycle("monitor_restart_completed", {
              details: {
                activeSymbolCount: activeEntries.length,
                startableSymbolCount: 0,
                liveProviderSwitched: true,
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
              liveProviderSwitched: true,
              readyOnly: true,
            },
          });
        } catch (error) {
          await provider.stop().catch((stopError) => {
            const message = stopError instanceof Error ? stopError.message : String(stopError);
            console.warn(`[ManualWatchlistRuntimeManager] Failed to stop rejected live provider: ${message}`);
          });
          this.options.monitor.setLivePriceProvider(previousProvider);
          if (startableEntries.length > 0) {
            try {
              await this.options.monitor.start(
                startableEntries,
                this.handleMonitoringEvent,
                this.handlePriceUpdate,
              );
            } catch (restoreError) {
              const message = restoreError instanceof Error ? restoreError.message : String(restoreError);
              console.error(`[ManualWatchlistRuntimeManager] Failed to restore previous live provider: ${message}`);
            }
          }
          throw error;
        }
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

    for (const entry of this.watchlistStore.getEntries()) {
      if (entry.lifecycle !== "activating" && entry.lifecycle !== "activation_failed") {
        continue;
      }
      const interrupted = entry.lifecycle === "activating";
      this.watchlistStore.patchEntry(entry.symbol, {
        active: false,
        lifecycle: "activation_failed",
        refreshPending: false,
        lastError: interrupted
          ? entry.lastError ?? "Activation was interrupted before readiness acknowledgement."
          : entry.lastError,
        operationStatus: interrupted
          ? "activation interrupted; retry required"
          : entry.operationStatus ?? "activation failed",
      });
      this.emitLifecycle("restore_skipped", {
        symbol: entry.symbol,
        threadId: entry.discordThreadId ?? null,
        details: {
          error: interrupted
            ? entry.lastError ?? "Activation was interrupted before readiness acknowledgement."
            : entry.lastError ?? "Activation failed before restart. Retry manually to restore.",
          source: "startup",
        },
      });
    }

    const activeEntries = this.watchlistStore.getActiveEntries();
    this.restoreTradersLinkAiReadRefreshStates(activeEntries);
    if (!this.options.tradersLinkAiReadStartupRefreshEnabled) {
      for (const entry of activeEntries) {
        this.aiReadInitialGenerationSuppressedSymbols.add(entry.symbol);
      }
    }
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
          await this.restoreLevelsFromStartupCache(entry.symbol);
          if (!this.isEntryActive(entry.symbol)) {
            continue;
          }
          const refreshedLevels = await this.refreshLevelsIfNeeded(entry.symbol, Date.now());
          if (!this.isEntryActive(entry.symbol)) {
            continue;
          }
          const restoredFromCache = this.startupCacheWarmingSymbols.has(entry.symbol);
          if (restoredFromCache && refreshedLevels) {
            this.startupCacheWarmingSymbols.delete(entry.symbol);
            this.startupCacheFreshRefreshFailures.delete(entry.symbol);
          }
          if (
            !this.options.levelStore.getLevels(entry.symbol) ||
            (restoredFromCache && !refreshedLevels)
          ) {
            await this.seedLevelsForSymbol(entry.symbol, {
              graceOnTimeout: true,
              force: restoredFromCache,
            });
            this.startupCacheWarmingSymbols.delete(entry.symbol);
            this.startupCacheFreshRefreshFailures.delete(entry.symbol);
          }
          if (!this.isEntryActive(entry.symbol)) {
            continue;
          }
          this.setEntryOperation(entry.symbol, "posting startup snapshot");
          await this.postLevelSnapshot(entry.symbol, entry.discordThreadId, Date.now());
          this.refreshPriorRegularClose(entry.symbol, Date.now());
          this.emitLifecycle("restore_completed", {
            symbol: entry.symbol,
            threadId: entry.discordThreadId,
          });
          await this.restartMonitoringWithReadyEntriesOnly();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const restoredFromCache = this.startupCacheWarmingSymbols.has(entry.symbol);
          if (!restoredFromCache && this.options.levelStore.getLevels(entry.symbol) && entry.discordThreadId) {
            this.setEntryOperation(entry.symbol, "posting startup snapshot");
            await this.postLevelSnapshot(entry.symbol, entry.discordThreadId, Date.now());
            this.refreshPriorRegularClose(entry.symbol, Date.now());
            this.emitLifecycle("restore_completed", {
              symbol: entry.symbol,
              threadId: entry.discordThreadId,
              details: {
                recoveredAfterTimeout: true,
              },
            });
            await this.restartMonitoringWithReadyEntriesOnly();
          } else {
            if (restoredFromCache) {
              this.startupCacheFreshRefreshFailures.set(entry.symbol, message);
            }
            this.watchlistStore.patchEntry(entry.symbol, {
              lifecycle: "refresh_pending",
              refreshPending: true,
              lastError: message,
              operationStatus: restoredFromCache
                ? "levels restored from cache, fresh candle refresh failed"
                : "restore needs retry",
            });
            this.emitLifecycle("restore_failed", {
              symbol: entry.symbol,
              threadId: entry.discordThreadId ?? null,
              details: {
                error: message,
                cachedLevelsHeldForOperator: restoredFromCache,
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
    if (this.isTradersLinkAiReadConfigured() && this.liveWatchlistPublisher) {
      for (const entry of this.watchlistStore.getActiveEntries()) {
        await this.liveWatchlistPublisher.publish(
          buildTradersLinkAiReadVisibilityPatch({
            symbol: entry.symbol,
            visible: entry.tradersLinkAiReadCardVisible !== false,
          }),
        );
        if (this.options.tradersLinkAiReadStartupRefreshEnabled) {
          this.scheduleTradersLinkAiRead(entry.symbol, false, "startup");
        }
      }
    }
    this.startPullbackReadIntradayPolling();
    this.emitLifecycle("runtime_started", {
      details: {
        activeSymbolCount: this.watchlistStore.getActiveEntries().length,
        startupRestoreInProgress: false,
      },
    });
  }

  async stop(): Promise<void> {
    this.stopPullbackReadIntradayPolling();
    this.stopActivationWatchdog();
    for (const timer of this.pendingLevelTouchAlerts.values()) {
      clearTimeout(timer);
    }
    this.pendingLevelTouchAlerts.clear();
    for (const pending of this.pendingFastLevelClearAlerts.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingFastLevelClearAlerts.clear();
    for (const pending of this.pendingMarketStructureStandalonePosts.values()) {
      clearTimeout(pending);
    }
    this.pendingMarketStructureStandalonePosts.clear();
    for (const timer of this.technicalContextBootstrapRetryTimers.values()) {
      clearTimeout(timer);
    }
    this.technicalContextBootstrapRetryTimers.clear();
    this.technicalContextBootstrapRetryAttempts.clear();
    this.technicalContextBootstrapRefreshInFlight.clear();
    this.technicalContextCandleStore.clearAll();
    this.aiReadInitialGenerationSuppressedSymbols.clear();
    this.persistMarketStructureStoryMemory();
    await this.options.monitor.stop();
    this.isStarted = false;
  }

  getActiveEntries(): WatchlistEntry[] {
    return this.watchlistStore.getActiveEntries();
  }

  async setLiveTraderReadCardVisible(visible: boolean): Promise<{
    visible: boolean;
    refreshedSymbols: string[];
  }> {
    this.liveTraderReadCardVisible = visible;
    const refreshedSymbols = this.watchlistStore.getActiveEntries().map((entry) => entry.symbol);
    const timestamp = Date.now();

    for (const symbol of refreshedSymbols) {
      this.lastWebsitePullbackReadPublishAt.delete(symbol);
      this.lastWebsitePullbackReadStateKey.delete(symbol);
      if (visible) {
        this.publishWebsiteSnapshotRefresh(symbol, timestamp);
      } else {
        await this.publishLiveTraderReadCardRemoval(symbol, timestamp);
      }
    }

    return {
      visible: this.liveTraderReadCardVisible,
      refreshedSymbols,
    };
  }

  async setPotentialGainCardVisible(visible: boolean): Promise<{
    visible: boolean;
    refreshedSymbols: string[];
  }> {
    this.potentialGainCardVisible = visible;
    const refreshedSymbols = this.watchlistStore.getActiveEntries().map((entry) => entry.symbol);
    const timestamp = Date.now();

    for (const symbol of refreshedSymbols) {
      if (!this.liveWatchlistPublisher) {
        break;
      }
      await this.liveWatchlistPublisher.publish({
        symbol,
        status: "live",
        updatedAt: timestamp,
        potentialGainCardVisible: visible,
        cards: {},
      });
    }

    return {
      visible: this.potentialGainCardVisible,
      refreshedSymbols,
    };
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
        this.watchlistStore.getEntry(symbol)?.lifecycle === "activating",
    ).length;

    return {
      isStarted: this.isStarted,
      pendingActivationCount,
      liveTraderReadCardVisible: this.liveTraderReadCardVisible,
      potentialGainCardVisible: this.potentialGainCardVisible,
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
      providerHealth: this.buildProviderHealth(pendingActivationCount),
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
      mondayReview: this.buildMondayReviewHealth(),
    };
  }

  private buildProviderHealth(pendingActivationCount: number): ManualWatchlistProviderHealth {
    const now = Date.now();
    const lastPriceAgeMs = this.lastPriceUpdateAt === null ? null : Math.max(0, now - this.lastPriceUpdateAt);
    const lastPostAgeMs = this.lastThreadPostAt === null ? null : Math.max(0, now - this.lastThreadPostAt);
    const stuckActivationCount = this.getStuckActivations().length;
    const notes: string[] = [];

    const priceFeedStatus =
      lastPriceAgeMs === null
        ? "waiting"
        : lastPriceAgeMs <= 2 * 60 * 1000
          ? "live"
          : "stale";
    if (priceFeedStatus === "waiting") {
      notes.push("waiting for first live price");
    } else if (priceFeedStatus === "stale") {
      notes.push("last live price is stale");
    }

    const failureAfterLastPost =
      this.lastDeliveryFailureAt !== null &&
      (this.lastThreadPostAt === null || this.lastDeliveryFailureAt >= this.lastThreadPostAt);
    const discordStatus =
      failureAfterLastPost && now - this.lastDeliveryFailureAt! <= 15 * 60 * 1000
        ? "recent_failure"
        : this.lastThreadPostAt === null
          ? "waiting"
          : "ready";
    if (discordStatus === "recent_failure") {
      notes.push("recent Discord delivery failure");
    } else if (discordStatus === "waiting") {
      notes.push("waiting for first Discord post");
    }

    const historicalDataStatus =
      stuckActivationCount > 0
        ? "degraded"
        : pendingActivationCount > 0
          ? "waiting"
          : "active";
    if (historicalDataStatus === "degraded") {
      notes.push(`${stuckActivationCount} stuck activation${stuckActivationCount === 1 ? "" : "s"}`);
    } else if (historicalDataStatus === "waiting") {
      notes.push(`${pendingActivationCount} activation${pendingActivationCount === 1 ? "" : "s"} still seeding`);
    }
    const startupCache = this.buildStartupCacheHealth(now);
    if (startupCache.warmingSymbols.length > 0) {
      notes.push(
        `${startupCache.warmingSymbols.length} symbol${startupCache.warmingSymbols.length === 1 ? "" : "s"} restored from cache and warming fresh candles`,
      );
    }
    if (startupCache.blockedSnapshotSymbols.length > 0) {
      notes.push(
        `${startupCache.blockedSnapshotSymbols.length} cached startup snapshot${startupCache.blockedSnapshotSymbols.length === 1 ? "" : "s"} blocked until fresh candles`,
      );
    }

    return {
      priceFeedStatus,
      lastPriceAgeMs,
      lastPriceSymbol: this.lastPriceUpdateSymbol,
      discordStatus,
      lastPostAgeMs,
      historicalDataStatus,
      pendingActivationCount,
      stuckActivationCount,
      seedStats: this.getLevelSeedStats(),
      startupCache,
      restartReadiness: this.buildRestartReadiness(now),
      notes,
    };
  }

  private buildStartupCacheHealth(now: number): ManualWatchlistStartupCacheHealth {
    return {
      enabled: this.startupCachedLevelEngine !== null,
      warmingSymbols: [...this.startupCacheWarmingSymbols].sort(),
      restoredSymbols: [...this.startupCacheRestoredAt.entries()]
        .map(([symbol, restoredAt]) => ({
          symbol,
          restoredAt,
          ageMs: Math.max(0, now - restoredAt),
        }))
        .sort((left, right) => left.symbol.localeCompare(right.symbol)),
      blockedSnapshotSymbols: [...this.startupCacheFreshRefreshFailures.entries()]
        .map(([symbol, reason]) => ({ symbol, reason }))
        .sort((left, right) => left.symbol.localeCompare(right.symbol)),
      discordSnapshotPolicy: "fresh_candles_required",
    };
  }

  private buildRestartReadiness(now: number): ManualWatchlistRestartReadiness[] {
    return this.watchlistStore.getActiveEntries()
      .map((entry): ManualWatchlistRestartReadiness => {
        const symbol = normalizeSymbol(entry.symbol);
        const lifecycle = entry.lifecycle ?? "active";
        const hasLevels = Boolean(this.options.levelStore.getLevels(symbol));
        const isSeeding =
          this.pendingActivations.has(symbol) ||
          lifecycle === "activating" ||
          lifecycle === "restoring" ||
          lifecycle === "refresh_pending" ||
          lifecycle === "extension_pending";
        const levelStatus: ManualWatchlistRestartReadiness["levelStatus"] =
          hasLevels
            ? "ready"
            : lifecycle === "activation_failed"
              ? "failed"
              : isSeeding
                ? "seeding"
                : "waiting";
        const lastPriceAgeMs =
          entry.lastPriceUpdateAt === undefined ? null : Math.max(0, now - entry.lastPriceUpdateAt);
        const lastLevelPostAgeMs =
          entry.lastLevelPostAt === undefined ? null : Math.max(0, now - entry.lastLevelPostAt);
        const priceStatus: ManualWatchlistRestartReadiness["priceStatus"] =
          lastPriceAgeMs === null
            ? "waiting"
            : lastPriceAgeMs <= 2 * 60 * 1000
              ? "fresh"
              : "stale";
        const discordStatus: ManualWatchlistRestartReadiness["discordStatus"] =
          entry.discordThreadId ? "ready" : "missing_thread";
        const isCacheWarming = this.startupCacheWarmingSymbols.has(symbol);
        const reason =
          entry.lastError ||
          entry.operationStatus ||
          (isCacheWarming
            ? "levels restored from cache, waiting for fresh candles"
            : null) ||
          (discordStatus === "missing_thread"
            ? "waiting for Discord thread"
            : levelStatus !== "ready"
              ? "waiting for candles and levels"
              : priceStatus !== "fresh"
                ? "waiting for fresh live price"
                : "ready for live monitoring");

        return {
          symbol,
          lifecycle,
          levelStatus,
          priceStatus,
          discordStatus,
          operationStatus: entry.operationStatus ?? null,
          lastError: entry.lastError ?? null,
          lastPriceAgeMs,
          lastLevelPostAgeMs,
          reason,
        };
      })
      .sort((a, b) => {
        const score = (item: ManualWatchlistRestartReadiness): number => {
          if (item.levelStatus === "failed") return 0;
          if (item.discordStatus === "missing_thread") return 1;
          if (item.levelStatus !== "ready") return 2;
          if (item.priceStatus !== "fresh") return 3;
          return 4;
        };
        const scoreDelta = score(a) - score(b);
        return scoreDelta !== 0 ? scoreDelta : a.symbol.localeCompare(b.symbol);
      });
  }

  private async performActivation(
    input: ManualWatchlistActivationInput,
    rollbackEntries: WatchlistEntry[],
    preparedThread?: DiscordThreadRoutingResult | null,
    activationEpoch?: number,
  ): Promise<WatchlistEntry> {
    const symbol = normalizeSymbol(input.symbol);
    this.aiReadInitialGenerationSuppressedSymbols.delete(symbol);
    const existing = this.watchlistStore.getEntry(symbol);

    try {
      this.emitLifecycle("activation_started", {
        symbol,
        threadId: preparedThread?.threadId ?? existing?.discordThreadId ?? null,
      });
      if (preparedThread) {
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
          this.recordLevelSeedTimeout(symbol, error);
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
      if (preparedThread && !this.isEntryAvailableForActivationWork(symbol)) {
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
        tags: watchlistTagsForActivation(input),
        note: input.note,
        discordThreadId: threadId,
        active: false,
        lifecycle: "activating",
        activatedAt: Date.now(),
        refreshPending: true,
        lastError: null,
        operationStatus: "posting level snapshot",
      });

      let snapshotPayload: LevelSnapshotPayload | null = null;
      try {
        snapshotPayload = await this.postLevelSnapshot(symbol, threadId, Date.now(), undefined, true);
      } catch (error) {
        if (preparedThread) {
          throw error;
        }

        await delay(INITIAL_SNAPSHOT_RETRY_DELAY_MS);
        snapshotPayload = await this.postLevelSnapshot(symbol, threadId, Date.now(), undefined, true);
      }
      this.assertActivationCurrent(symbol, activationEpoch);
      this.persistWatchlist();
      const preparedEntry = this.watchlistStore.getEntry(symbol) ?? entry;
      await this.restartMonitoringForPreparedActivation(preparedEntry);
      this.assertActivationCurrent(symbol, activationEpoch);
      await this.publishActivationWebsiteSnapshot(symbol, Date.now());
      this.assertActivationCurrent(symbol, activationEpoch);
      const activatedEntry = this.watchlistStore.patchEntry(symbol, {
        active: true,
        lifecycle: "active",
        refreshPending: false,
        lastError: null,
        operationStatus: "monitoring live price",
      }) ?? preparedEntry;
      this.persistWatchlist();
      this.emitLifecycle("activation_completed", {
        symbol,
        threadId,
      });
      this.triggerAutoCleanRead({
        symbol,
        threadId,
        payload: snapshotPayload,
      });
      this.publishRecentWebsiteArticles(symbol);
      if (this.isTradersLinkAiReadConfigured() && this.liveWatchlistPublisher) {
        const latestEntry = this.watchlistStore.getEntry(symbol) ?? activatedEntry;
        void this.liveWatchlistPublisher.publish(
          buildTradersLinkAiReadVisibilityPatch({
            symbol,
            visible: latestEntry.tradersLinkAiReadCardVisible !== false,
          }),
        ).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `[ManualWatchlistRuntimeManager] Failed to publish AI Read visibility for ${symbol}: ${message}`,
          );
        });
      }
      this.scheduleTradersLinkAiRead(symbol, true, "activation");
      return this.watchlistStore.getEntry(symbol) ?? activatedEntry;
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
      this.potentialMoveReadBySymbol.delete(symbol);
      this.tradeSetupThesisReadBySymbol.delete(symbol);
      this.chartThesisLevelOutputBySymbol.delete(symbol);
      this.chartThesisSeriesMapBySymbol.delete(symbol);
      this.recentWebsiteArticleFreshnessBySymbol.delete(symbol);
      this.pressReleaseCatalystContextBySymbol.delete(symbol);
      this.priorRegularCloseBySymbol.delete(symbol);
      this.priorRegularCloseRefreshInFlight.delete(symbol);
      this.lastPriorRegularCloseRefreshAt.delete(symbol);
      await this.restartMonitoring().catch((restartError) => {
        const restartMessage = restartError instanceof Error ? restartError.message : String(restartError);
        console.error(
          `[ManualWatchlistRuntimeManager] Failed to remove incomplete activation ${symbol} from monitoring: ${restartMessage}`,
        );
      });
      const message = error instanceof Error ? error.message : String(error);
      if (preparedThread) {
        this.watchlistStore.upsertManualEntry({
          symbol,
          tags: watchlistTagsForActivation(input),
          note: input.note,
          discordThreadId: preparedThread.threadId,
          active: false,
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
        if (/no usable candle series|no candles were returned|candle validation failed/i.test(message)) {
          const currentEntry = this.watchlistStore.getEntry(symbol);
          void this.liveWatchlistPublisher?.publish(
            buildLiveWatchlistLevelsUnavailablePatch({
              symbol,
              timestamp: Date.now(),
              currentPrice: currentEntry?.lastPrice ?? null,
            }),
          ).catch((publishError) => {
            const publishMessage = publishError instanceof Error ? publishError.message : String(publishError);
            console.warn(
              `[ManualWatchlistRuntimeManager] Failed to publish unavailable level state for ${symbol}: ${publishMessage}`,
            );
          });
        }
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

  private publishRecentWebsiteArticles(symbol: string): void {
    const normalizedSymbol = normalizeSymbol(symbol);
    void (async () => {
      const result = await publishRecentWebsiteArticlesForSymbol({
        symbol: normalizedSymbol,
        publisher: this.liveWatchlistPublisher,
        execFileImpl: this.options.recentWebsiteArticlesExecFileImpl,
      });
      const freshness = result
        ? deriveRecentWebsiteArticleCatalystFreshness({ result })
        : "lookup_unavailable";
      const catalystContext = await this.lookupPressReleaseCatalystContext(normalizedSymbol);
      const previousFreshness = this.recentWebsiteArticleFreshnessBySymbol.get(normalizedSymbol);
      const previousCatalystContext = this.pressReleaseCatalystContextBySymbol.get(normalizedSymbol);
      this.recentWebsiteArticleFreshnessBySymbol.set(normalizedSymbol, freshness);
      if (catalystContext) {
        this.pressReleaseCatalystContextBySymbol.set(normalizedSymbol, catalystContext);
      } else {
        this.pressReleaseCatalystContextBySymbol.delete(normalizedSymbol);
      }
      if (
        previousFreshness === freshness &&
        JSON.stringify(previousCatalystContext ?? null) === JSON.stringify(catalystContext ?? null)
      ) {
        return;
      }
      this.refreshPotentialMoveReadFromStoredChartContext(normalizedSymbol);
      this.publishWebsiteSnapshotRefresh(normalizedSymbol, Date.now());
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ManualWatchlistRuntimeManager] Failed to refresh catalyst-aware trader read for ${normalizedSymbol}: ${message}`,
      );
    });
  }

  private pressReleaseCatalystContextEnabled(): boolean {
    if (this.options.pressReleaseCatalystContextEnabled !== undefined) {
      return this.options.pressReleaseCatalystContextEnabled;
    }
    const raw = process.env.TRADERSLINK_PRESS_RELEASE_CATALYST_CONTEXT_ENABLED?.trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  }

  private async lookupPressReleaseCatalystContext(symbol: string): Promise<PressReleaseCatalystContext | null> {
    if (!this.pressReleaseCatalystContextEnabled()) {
      return null;
    }
    const referenceDate = newYorkDateKeyForTimestamp(Date.now());
    if (!referenceDate) {
      return null;
    }
    const context = await lookupPressReleaseCatalystContextForSymbol({
      symbol,
      referenceDate,
      lookbackDays: 7,
      lookaheadDays: 1,
      enabled: true,
      execFileImpl: this.options.pressReleaseCatalystExecFileImpl,
    });
    return context.timing === "lookup_unavailable" ? null : context;
  }

  private publishWebsiteSnapshotRefresh(symbol: string, timestamp: number): void {
    if (!this.liveWatchlistPublisher || !this.isEntryActive(symbol) || !this.options.levelStore.getLevels(symbol)) {
      return;
    }

    const patch = this.applyLiveTraderReadCardVisibility(
      buildLiveWatchlistSnapshotPatch(
        this.buildLevelSnapshotPayload(symbol, timestamp),
        { pullbackReadEnabled: this.options.pullbackReadEnabled },
      ),
    );
    void this.liveWatchlistPublisher.publish(patch).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ManualWatchlistRuntimeManager] Failed to publish catalyst-aware website snapshot for ${symbol}: ${message}`,
      );
    });
  }

  private async publishActivationWebsiteSnapshot(symbol: string, timestamp: number): Promise<void> {
    if (!this.liveWatchlistPublisher || !this.options.levelStore.getLevels(symbol)) {
      return;
    }
    const patch = this.applyLiveTraderReadCardVisibility(
      buildLiveWatchlistSnapshotPatch(
        this.buildLevelSnapshotPayload(symbol, timestamp),
        { pullbackReadEnabled: this.options.pullbackReadEnabled },
      ),
    );
    await this.liveWatchlistPublisher.publish(patch);
  }

  private applyLiveTraderReadCardVisibility(patch: LiveWatchlistCardPatch): LiveWatchlistCardPatch {
    const websitePatch = {
      ...patch,
      potentialGainCardVisible: this.potentialGainCardVisible,
    };
    if (this.liveTraderReadCardVisible) {
      return websitePatch;
    }
    return {
      ...websitePatch,
      cards: {
        ...websitePatch.cards,
        liveTraderRead: null,
      },
    };
  }

  private async publishLiveTraderReadCardRemoval(symbol: string, timestamp: number): Promise<void> {
    if (!this.liveWatchlistPublisher) {
      return;
    }

    try {
      await this.liveWatchlistPublisher.publish({
        symbol,
        status: "live",
        updatedAt: timestamp,
        cards: {
          liveTraderRead: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ManualWatchlistRuntimeManager] Failed to hide website trader read card for ${symbol}: ${message}`,
      );
    }
  }

  private publishWebsiteTickerStatus(
    symbol: string,
    status: LiveWatchlistStatus,
    firstPostedAt?: number | null,
  ): void {
    if (!this.liveWatchlistPublisher) {
      return;
    }

    const patch = buildLiveWatchlistStatusPatch({
      symbol,
      status,
      firstPostedAt,
      potentialGainCardVisible: this.potentialGainCardVisible,
    });
    void this.liveWatchlistPublisher.publish(patch).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ManualWatchlistRuntimeManager] Failed to publish website status for ${symbol}: ${message}`,
      );
    });
  }

  private async publishWebsiteTickerDeactivation(symbol: string, timestamp: number): Promise<void> {
    if (!this.liveWatchlistPublisher) {
      return;
    }

    const normalizedSymbol = normalizeSymbol(symbol);
    const levels = this.options.levelStore.getLevels(normalizedSymbol);
    const patch = levels
      ? {
          ...this.applyLiveTraderReadCardVisibility(
            buildLiveWatchlistSnapshotPatch(
              this.buildLevelSnapshotPayload(normalizedSymbol, timestamp),
              { pullbackReadEnabled: this.options.pullbackReadEnabled },
            ),
          ),
          status: "deactivated" as const,
          updatedAt: timestamp,
        }
      : buildLiveWatchlistStatusPatch({
          symbol: normalizedSymbol,
          status: "deactivated",
          updatedAt: timestamp,
        });

    try {
      await this.liveWatchlistPublisher.publish(patch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ManualWatchlistRuntimeManager] Failed to publish website deactivation for ${normalizedSymbol}: ${message}`,
      );
    }
  }

  private technicalContextStateKey(context: TechnicalContext): string {
    return [
      context.confidence,
      context.aboveVwap,
      context.aboveEma9,
      context.aboveEma20,
      this.technicalContextDistanceBucket(context.priceVsVwapPct),
      this.technicalContextDistanceBucket(context.priceVsEma9Pct),
      this.technicalContextDistanceBucket(context.priceVsEma20Pct),
    ].join("|");
  }

  private technicalContextDistanceBucket(value: number | null): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "n/a";
    }

    const absValue = Math.abs(value);
    if (absValue <= 0.5) {
      return "testing";
    }
    if (absValue <= 2) {
      return "near";
    }
    if (absValue <= 5) {
      return "approaching";
    }
    return "extended";
  }

  private pullbackVolumeRatioBucket(value: unknown): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "n/a";
    }
    if (value < 0.75) {
      return "thin";
    }
    if (value < 1.2) {
      return "normal";
    }
    if (value < 1.4) {
      return "building";
    }
    if (value < 2) {
      return "expanding";
    }
    if (value < 4) {
      return "strong";
    }
    return "surge";
  }

  private publishWebsiteTechnicalContext(update: LivePriceUpdate): void {
    if (!this.liveWatchlistPublisher) {
      return;
    }

    const technicalContext = this.technicalContextBySymbol.get(update.symbol);
    if (!technicalContext) {
      return;
    }

    const refreshedContext = refreshTechnicalContextForPrice(technicalContext, update.lastPrice);
    const stateKey = this.technicalContextStateKey(refreshedContext);
    const previousStateKey = this.lastWebsiteTechnicalContextStateKey.get(update.symbol);
    const firstPublish = previousStateKey === undefined;
    const relationChanged = !firstPublish && previousStateKey !== stateKey;
    const lastPublishedAt = this.lastWebsiteTechnicalContextPublishAt.get(update.symbol) ?? 0;
    if (
      !firstPublish &&
      !relationChanged &&
      update.timestamp - lastPublishedAt < WEBSITE_TECHNICAL_CONTEXT_PUBLISH_INTERVAL_MS
    ) {
      return;
    }

    const patch = buildLiveWatchlistTechnicalContextPatch({
      symbol: update.symbol,
      timestamp: update.timestamp,
      currentPrice: update.lastPrice,
      technicalContext: refreshedContext,
    });
    if (!patch) {
      return;
    }

    this.lastWebsiteTechnicalContextPublishAt.set(update.symbol, update.timestamp);
    this.lastWebsiteTechnicalContextStateKey.set(update.symbol, stateKey);
    void this.liveWatchlistPublisher.publish(patch).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ManualWatchlistRuntimeManager] Failed to publish technical context for ${update.symbol}: ${message}`,
      );
    });
  }

  private pullbackReadStateKey(patch: NonNullable<ReturnType<typeof buildLiveWatchlistPullbackReadPatch>>): string {
    const metadata = patch.cards.liveTraderRead?.metadata ?? {};
    return [
      metadata.pullbackPhase,
      metadata.pullbackConfidence,
      metadata.pullbackFallback1,
      metadata.pullbackFallback2,
      metadata.pullbackFallback3,
      metadata.pullbackContinuationTrigger,
      metadata.pullbackNextPathResistance,
      metadata.pullbackVolumeLabel,
      metadata.tradeSetupReadMode,
      metadata.tradeSetupThesisSource,
      metadata.tradeSetupType,
      metadata.tradeSetupState,
      metadata.tradeSetupActionable,
      metadata.tradeSetupZoneLow,
      metadata.tradeSetupZoneHigh,
      metadata.tradeSetupTrigger,
      metadata.tradeSetupInvalidation,
      metadata.tradeSetupTarget1,
      metadata.tradeSetupFirstTargetRewardRisk,
      metadata.tradeSetupFirstObstacle,
      metadata.tradeSetupNearestBarrierRewardRisk,
      metadata.tradeSetupInterveningBarrierCount,
      metadata.tradeSetupPrimaryBlocker,
      metadata.tradeSetupMarketStructureBias,
      metadata.tradeSetupMarketStructureFormalTimeframes,
      metadata.tradeSetupMarketStructureStable5mState,
      metadata.tradeSetupMarketStructureTacticalFormalMetadataOnly,
      this.pullbackVolumeRatioBucket(metadata.pullbackVolumeRatio),
      this.technicalContextDistanceBucket(
        typeof metadata.pullbackPriceVsVwapPct === "number" ? metadata.pullbackPriceVsVwapPct : null,
      ),
      this.technicalContextDistanceBucket(
        typeof metadata.pullbackPriceVsEma9Pct === "number" ? metadata.pullbackPriceVsEma9Pct : null,
      ),
      this.technicalContextDistanceBucket(
        typeof metadata.pullbackPriceVsEma20Pct === "number" ? metadata.pullbackPriceVsEma20Pct : null,
      ),
    ].join("|");
  }

  private publishWebsitePullbackTraderRead(args: {
    symbol: string;
    timestamp: number;
    currentPrice: number;
    technicalContext: TechnicalContext;
    volumeRead?: LiveWatchlistPullbackVolumeRead | null;
  }): void {
    const pullbackReadEnabled = this.pullbackReadEnabled();
    const tradeSetupReadMode = resolveLiveWatchlistTradeSetupReadMode();
    if (
      !this.liveWatchlistPublisher ||
      (!pullbackReadEnabled && tradeSetupReadMode === "off") ||
      !this.liveTraderReadCardVisible
    ) {
      return;
    }

    const snapshotState = this.activeSnapshotState.get(args.symbol);
    const levelsOutput = this.options.levelStore.getLevels(args.symbol);
    const availableTimeframes = levelsOutput?.metadata.availableTimeframes ??
      (["daily", "4h", "5m"] as const).filter(
        (timeframe) => levelsOutput?.metadata.providerByTimeframe[timeframe] !== undefined,
      );
    const levelCoverage = levelsOutput?.metadata.coverage ??
      (availableTimeframes.length === 3 ? "full" : "limited");
    const roleFlipCandles = this.technicalContextCandleStore.getCandles(args.symbol);
    const priorRegularClose = this.priorRegularCloseBySymbol.get(args.symbol) ?? null;
    this.refreshTradeSetupThesisReadForSymbol({
      symbol: args.symbol,
      currentPrice: args.currentPrice,
      fiveMinuteCandles: roleFlipCandles,
      evaluatedAt: args.timestamp,
    });
    const patch = buildLiveWatchlistPullbackReadPatch({
      symbol: args.symbol,
      timestamp: args.timestamp,
      currentPrice: args.currentPrice,
      supportZones: this.getWebsiteTickerSupportReferences(args.symbol, snapshotState),
      resistanceZones: this.getWebsiteTickerResistanceReferences(args.symbol, snapshotState),
      technicalContext: args.technicalContext,
      volumeRead: args.volumeRead,
      potentialMoveRead: this.potentialMoveReadBySymbol.get(args.symbol) ?? null,
      tradeSetupThesisRead: this.tradeSetupThesisReadBySymbol.get(args.symbol) ?? null,
      marketStructure: this.getMarketStructureSnapshot(args.symbol),
      pullbackReadEnabled,
      tradeSetupReadMode,
      specialLevels: this.resolveWebsiteSpecialLevels(args.symbol, levelsOutput),
      priorRegularClosePrice: priorRegularClose?.price ?? null,
      dataQuality: {
        status: levelCoverage,
        availableTimeframes: [...availableTimeframes],
        flags: levelsOutput?.metadata.dataQualityFlags ?? [],
      },
      roleFlipContext: {
        ...buildRecentAtrRoleFlipContext(roleFlipCandles, args.currentPrice, args.timestamp),
        tickSize: inferredSmallCapTickSize(args.currentPrice),
      },
    });
    if (!patch) {
      return;
    }

    const stateKey = this.pullbackReadStateKey(patch);
    const previousStateKey = this.lastWebsitePullbackReadStateKey.get(args.symbol);
    const lastPublishedAt = this.lastWebsitePullbackReadPublishAt.get(args.symbol) ?? 0;
    if (
      previousStateKey === stateKey &&
      args.timestamp - lastPublishedAt < WEBSITE_PULLBACK_READ_PUBLISH_INTERVAL_MS
    ) {
      return;
    }

    this.lastWebsitePullbackReadStateKey.set(args.symbol, stateKey);
    this.lastWebsitePullbackReadPublishAt.set(args.symbol, args.timestamp);
    void this.liveWatchlistPublisher.publish(patch).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ManualWatchlistRuntimeManager] Failed to publish pullback trader read for ${args.symbol}: ${message}`,
      );
    });
  }

  private refreshPriorRegularClose(symbolInput: string, timestamp = Date.now()): void {
    const symbol = normalizeSymbol(symbolInput);
    if (this.priorRegularCloseBySymbol.has(symbol) || this.priorRegularCloseRefreshInFlight.has(symbol)) {
      return;
    }
    const stockContextProvider = this.options.stockContextProvider;
    if (!stockContextProvider) {
      return;
    }
    const lastAttemptAt = this.lastPriorRegularCloseRefreshAt.get(symbol) ?? 0;
    if (lastAttemptAt > 0 && timestamp - lastAttemptAt < PRIOR_REGULAR_CLOSE_REFRESH_INTERVAL_MS) {
      return;
    }

    this.lastPriorRegularCloseRefreshAt.set(symbol, timestamp);
    this.priorRegularCloseRefreshInFlight.add(symbol);
    void stockContextProvider.getThreadPreview(symbol)
      .then((preview) => {
        const priorRegularClose = resolvePriorRegularCloseReference(preview);
        if (priorRegularClose) {
          this.priorRegularCloseBySymbol.set(symbol, priorRegularClose);
          const entry = this.watchlistStore.getEntry(symbol);
          if (
            entry?.active &&
            typeof entry.lastPrice === "number" &&
            Number.isFinite(entry.lastPrice) &&
            entry.lastPrice > 0 &&
            typeof entry.lastPriceUpdateAt === "number" &&
            Number.isFinite(entry.lastPriceUpdateAt) &&
            entry.lastPriceUpdateAt > 0
          ) {
            this.publishLiveTickerData({
              symbol,
              // Prior-close lookup changes card context, not the quote itself.
              // Reuse the actual price observation so stale restored data can
              // never outrank a newer trade in the website's monotonic store.
              timestamp: entry.lastPriceUpdateAt,
              lastPrice: entry.lastPrice,
            }, { force: true });
          }
        } else {
          this.priorRegularCloseBySymbol.delete(symbol);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[ManualWatchlistRuntimeManager] Failed to refresh prior regular close for ${symbol}: ${message}`);
      })
      .finally(() => {
        this.priorRegularCloseRefreshInFlight.delete(symbol);
      });
  }

  private publishLiveTickerData(
    update: LivePriceUpdate,
    options: { force?: boolean } = {},
  ): void {
    if (!this.liveWatchlistPublisher?.publishTickerData) {
      return;
    }

    const lastPublishedAt = this.lastWebsiteTickerDataPublishAt.get(update.symbol) ?? 0;
    if (!options.force && update.timestamp - lastPublishedAt < WEBSITE_TICKER_DATA_PUBLISH_INTERVAL_MS) {
      return;
    }

    const snapshotState = this.activeSnapshotState.get(update.symbol);
    this.refreshPriorRegularClose(update.symbol, update.timestamp);
    const priorRegularClose = this.priorRegularCloseBySymbol.get(update.symbol) ?? null;
    const levelsOutput = this.options.levelStore.getLevels(update.symbol);
    const availableTimeframes = levelsOutput?.metadata.availableTimeframes ??
      (["daily", "4h", "5m"] as const).filter(
        (timeframe) => levelsOutput?.metadata.providerByTimeframe[timeframe] !== undefined,
      );
    const levelCoverage = levelsOutput?.metadata.coverage ??
      (availableTimeframes.length === 3 ? "full" : "limited");
    const storedTechnicalContext = this.technicalContextBySymbol.get(update.symbol) ?? null;
    const refreshedTechnicalContext = storedTechnicalContext
      ? refreshTechnicalContextForPrice(storedTechnicalContext, update.lastPrice)
      : null;
    const roleFlipCandles = this.technicalContextCandleStore.getCandles(update.symbol);
    const previousMarketDataRevision = this.lastWebsiteTickerDataRevision.get(update.symbol) ?? -1;
    const previousMarketDataObservedAt = this.lastWebsiteTickerDataObservedAt.get(update.symbol);
    const observedAtRevisionBase = Math.max(0, Math.trunc(update.timestamp)) * 1_000;
    const marketDataRevision =
      previousMarketDataObservedAt === undefined || update.timestamp > previousMarketDataObservedAt
        ? Math.max(observedAtRevisionBase, previousMarketDataRevision + 1)
        : previousMarketDataRevision;
    const patch = buildLiveWatchlistTickerDataPatch({
      symbol: update.symbol,
      lastPrice: update.lastPrice,
      timestamp: update.timestamp,
      marketDataRevision,
      supportZones: this.getWebsiteTickerSupportReferences(update.symbol, snapshotState),
      resistanceZones: this.getWebsiteTickerResistanceReferences(update.symbol, snapshotState),
      volume: update.volume,
      priorRegularClosePrice: priorRegularClose?.price ?? null,
      priorRegularCloseSource: priorRegularClose?.source ?? null,
      specialLevels: this.resolveWebsiteSpecialLevels(update.symbol, levelsOutput),
      technicalContext: refreshedTechnicalContext,
      dataQuality: {
        status: levelCoverage,
        availableTimeframes: [...availableTimeframes],
        flags: levelsOutput?.metadata.dataQualityFlags ?? [],
        ...(levelCoverage === "limited"
          ? { message: "Limited-history map: verify missing higher-timeframe structure manually." }
          : {}),
      },
      roleFlipContext: {
        ...buildRecentAtrRoleFlipContext(roleFlipCandles, update.lastPrice, update.timestamp),
        tickSize: inferredSmallCapTickSize(update.lastPrice),
      },
    });
    if (!patch) {
      return;
    }

    this.lastWebsiteTickerDataPublishAt.set(update.symbol, update.timestamp);
    if (previousMarketDataObservedAt === undefined || update.timestamp > previousMarketDataObservedAt) {
      this.lastWebsiteTickerDataObservedAt.set(update.symbol, update.timestamp);
      this.lastWebsiteTickerDataRevision.set(update.symbol, marketDataRevision);
    }
    this.publishWebsiteTechnicalContext(update);
    const technicalContext = this.technicalContextBySymbol.get(update.symbol);
    if (technicalContext) {
      const liveVolumeRead =
        typeof update.volume === "number" && Number.isFinite(update.volume) && update.volume > 0
          ? buildPullbackVolumeRead(this.technicalContextCandleStore.getCandles(update.symbol), {
              nowMs: update.timestamp,
            })
          : null;
      this.publishWebsitePullbackTraderRead({
        symbol: update.symbol,
        timestamp: update.timestamp,
        currentPrice: update.lastPrice,
        technicalContext: refreshTechnicalContextForPrice(technicalContext, update.lastPrice),
        volumeRead: liveVolumeRead,
      });
    }
    void this.liveWatchlistPublisher.publishTickerData({
      ...patch,
      potentialGainCardVisible: this.potentialGainCardVisible,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ManualWatchlistRuntimeManager] Failed to publish live ticker data for ${update.symbol}: ${message}`,
      );
    });
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
          tags: watchlistTagsForActivation(input),
          note: input.note,
          discordThreadId: thread.threadId,
          active: false,
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
          tags: watchlistTagsForActivation(input),
          note: input.note,
          discordThreadId: thread.threadId,
          active: false,
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

    if (pending && existing?.lifecycle === "activating" && this.isActivationCurrent(symbol, pending.epoch)) {
      return (
        existing ??
        this.watchlistStore.upsertManualEntry({
          symbol,
          tags: watchlistTagsForActivation(input),
          note: input.note,
          active: false,
          lifecycle: "activating",
          activatedAt: Date.now(),
          refreshPending: true,
          lastError: null,
        })
      );
    }

    if (existing?.active && existing.lifecycle === "active") {
      if (input.source !== "auto" && existing.tags.includes("auto")) {
        const pinned = this.watchlistStore.patchEntry(symbol, {
          tags: ["manual"],
          note: input.note?.trim() || "Manually pinned; prior automatic selection retained in the lifecycle audit.",
        });
        this.persistWatchlist();
        return pinned ?? existing;
      }
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
      tags: watchlistTagsForActivation(input),
      note: input.note,
      discordThreadId: thread.threadId,
      active: false,
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
      { ...input, symbol },
      rollbackEntries,
      thread,
      activationEpoch,
    ).finally(() => {
      if (this.pendingActivations.get(symbol)?.epoch === activationEpoch) {
        this.pendingActivations.delete(symbol);
      }
    });

    this.pendingActivations.set(symbol, { promise: activationTask, epoch: activationEpoch });
    if (input.source === "auto") {
      await activationTask;
      const activatedEntry = this.watchlistStore.getEntry(symbol);
      if (!activatedEntry?.active || activatedEntry.lifecycle !== "active") {
        throw new Error(`${symbol} activation did not reach ready state.`);
      }
      return activatedEntry;
    }

    void activationTask.catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[ManualWatchlistRuntimeManager] Background activation failed for ${symbol}: ${message}`,
        );
      });
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
    this.potentialMoveReadBySymbol.delete(symbol);
    this.tradeSetupThesisReadBySymbol.delete(symbol);
    this.chartThesisLevelOutputBySymbol.delete(symbol);
    this.chartThesisSeriesMapBySymbol.delete(symbol);
    const pendingFastClear = this.pendingFastLevelClearAlerts.get(symbol);
    if (pendingFastClear) {
      clearTimeout(pendingFastClear.timer);
      this.pendingFastLevelClearAlerts.delete(symbol);
    }
    await this.postLevelSnapshot(symbol, entry.discordThreadId, Date.now());
    this.persistWatchlist();
    return this.watchlistStore.getEntry(symbol) ?? entry;
  }

  private prepareSymbolDeactivation(normalizedSymbol: string): WatchlistEntry | null {
    this.nextActivationEpoch(normalizedSymbol);
    this.pendingActivations.delete(normalizedSymbol);
    this.watchlistStore.patchEntry(normalizedSymbol, {
      tradersLinkAiReadBoundaryState: undefined,
    });
    const entry = this.watchlistStore.deactivateSymbol(normalizedSymbol);
    if (!entry) {
      return null;
    }

    this.activeSnapshotState.delete(normalizedSymbol);
    this.potentialMoveReadBySymbol.delete(normalizedSymbol);
    this.tradeSetupThesisReadBySymbol.delete(normalizedSymbol);
    this.priorRegularCloseBySymbol.delete(normalizedSymbol);
    this.priorRegularCloseRefreshInFlight.delete(normalizedSymbol);
    this.lastPriorRegularCloseRefreshAt.delete(normalizedSymbol);
    const pendingFastClear = this.pendingFastLevelClearAlerts.get(normalizedSymbol);
    if (pendingFastClear) {
      clearTimeout(pendingFastClear.timer);
      this.pendingFastLevelClearAlerts.delete(normalizedSymbol);
    }
    this.extensionRefreshInFlight.delete(normalizedSymbol);
    this.aiReadState.delete(normalizedSymbol);
    this.aiReadInitialGenerationSuppressedSymbols.delete(normalizedSymbol);
    this.recapState.delete(normalizedSymbol);
    this.continuityState.delete(normalizedSymbol);
    this.followThroughStatePosts.delete(normalizedSymbol);
    this.followThroughPostState.delete(normalizedSymbol);
    this.intelligentAlertPostState.delete(normalizedSymbol);
    this.threadStoryPhaseState.delete(normalizedSymbol);
    this.liveThreadPostState.delete(normalizedSymbol);
    this.narrationBurstState.delete(normalizedSymbol);
    this.storyCriticalState.delete(normalizedSymbol);
    this.deliveryPressureState.delete(normalizedSymbol);
    this.technicalContextBySymbol.delete(normalizedSymbol);
    this.potentialMoveReadBySymbol.delete(normalizedSymbol);
    this.tradeSetupThesisReadBySymbol.delete(normalizedSymbol);
    this.chartThesisLevelOutputBySymbol.delete(normalizedSymbol);
    this.chartThesisSeriesMapBySymbol.delete(normalizedSymbol);
    this.recentWebsiteArticleFreshnessBySymbol.delete(normalizedSymbol);
    this.pressReleaseCatalystContextBySymbol.delete(normalizedSymbol);
    this.technicalContextCandleStore.clear(normalizedSymbol);
    this.technicalContextProviderBySymbol.delete(normalizedSymbol);
    this.technicalContextDataQualityFlagsBySymbol.delete(normalizedSymbol);
    this.clearTechnicalContextBootstrapRetry(normalizedSymbol);
    this.lastWebsiteTechnicalContextPublishAt.delete(normalizedSymbol);
    this.lastWebsiteTechnicalContextStateKey.delete(normalizedSymbol);
    this.lastWebsitePullbackReadPublishAt.delete(normalizedSymbol);
    this.lastWebsitePullbackReadStateKey.delete(normalizedSymbol);
    this.marketStructureStoryMemory.clear(normalizedSymbol);
    this.marketStructureCarrierInFlightKeys.delete(normalizedSymbol);
    this.clearPendingMarketStructureStandalonePost(normalizedSymbol);
    return entry;
  }

  async deactivateSymbols(symbolInputs: string[]): Promise<WatchlistEntry[]> {
    const normalizedSymbols = [...new Set(symbolInputs.map(normalizeSymbol).filter(Boolean))];
    const entries = normalizedSymbols
      .map((symbol) => this.prepareSymbolDeactivation(symbol))
      .filter((entry): entry is WatchlistEntry => entry !== null);
    if (entries.length === 0) {
      return [];
    }

    const deactivatedAt = Date.now();
    this.persistMarketStructureStoryMemory();
    this.persistWatchlist();
    for (const entry of entries) {
      await this.publishWebsiteTickerDeactivation(entry.symbol, deactivatedAt);
    }
    await this.restartMonitoring();
    for (const entry of entries) {
      this.emitLifecycle("deactivated", {
        symbol: entry.symbol,
        threadId: entry.discordThreadId ?? null,
        details: {
          reason: entries.length > 1 ? "bulk watchlist removal" : "manual watchlist removal",
        },
      });
    }
    return entries;
  }

  async deactivateSymbol(symbol: string): Promise<WatchlistEntry | null> {
    return (await this.deactivateSymbols([symbol]))[0] ?? null;
  }

  async resetDiscordThreadState(): Promise<{
    entryCount: number;
    clearedThreadIds: number;
    clearedPostMarkers: number;
  }> {
    for (const entry of this.watchlistStore.getActiveEntries()) {
      this.nextActivationEpoch(entry.symbol);
      this.pendingActivations.delete(entry.symbol);
    }

    let clearedThreadIds = 0;
    let clearedPostMarkers = 0;
    const entries = this.watchlistStore.getEntries().map((entry) => {
      if (entry.discordThreadId) {
        clearedThreadIds += 1;
      }
      if (entry.lastLevelPostAt !== undefined) {
        clearedPostMarkers += 1;
      }
      if (entry.lastThreadPostAt !== undefined) {
        clearedPostMarkers += 1;
      }
      if (entry.lastThreadPostKind !== undefined) {
        clearedPostMarkers += 1;
      }

      return {
        ...entry,
        active: false,
        lifecycle: "inactive" as const,
        discordThreadId: null,
        lastLevelPostAt: undefined,
        lastThreadPostAt: undefined,
        lastThreadPostKind: undefined,
        refreshPending: false,
        operationStatus: undefined,
      };
    });

    this.watchlistStore.setEntries(entries);
    this.activeSnapshotState.clear();
    this.potentialMoveReadBySymbol.clear();
    this.tradeSetupThesisReadBySymbol.clear();
    this.chartThesisLevelOutputBySymbol.clear();
    this.chartThesisSeriesMapBySymbol.clear();
    this.recentWebsiteArticleFreshnessBySymbol.clear();
    this.pressReleaseCatalystContextBySymbol.clear();
    this.priorRegularCloseBySymbol.clear();
    this.priorRegularCloseRefreshInFlight.clear();
    this.lastPriorRegularCloseRefreshAt.clear();
    for (const pending of this.pendingFastLevelClearAlerts.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingFastLevelClearAlerts.clear();
    for (const pending of this.pendingLevelTouchAlerts.values()) {
      clearTimeout(pending);
    }
    this.pendingLevelTouchAlerts.clear();
    this.extensionRefreshInFlight.clear();
    this.recapState.clear();
    this.continuityState.clear();
    this.followThroughStatePosts.clear();
    this.followThroughPostState.clear();
    this.intelligentAlertPostState.clear();
    this.threadStoryPhaseState.clear();
    this.aiSignalStoryState.clear();
    this.dominantLevelStories.clear();
    this.liveThreadPostState.clear();
    this.narrationBurstState.clear();
    this.storyCriticalState.clear();
    this.deliveryPressureState.clear();
    this.marketStructureStoryMemory.clearAll();
    this.persistMarketStructureStoryMemory();
    this.marketStructureCarrierInFlightKeys.clear();
    for (const pending of this.pendingMarketStructureStandalonePosts.values()) {
      clearTimeout(pending);
    }
    this.pendingMarketStructureStandalonePosts.clear();
    this.lastThreadPostAt = null;
    this.lastThreadPostSymbol = null;
    this.lastThreadPostKind = null;
    this.lastThreadPostReason = null;
    this.lastDeliveryFailureAt = null;
    this.lastDeliveryFailureSymbol = null;
    this.lastDeliveryFailureMessage = null;
    this.technicalContextBySymbol.clear();
    this.potentialMoveReadBySymbol.clear();
    this.tradeSetupThesisReadBySymbol.clear();
    this.chartThesisLevelOutputBySymbol.clear();
    this.chartThesisSeriesMapBySymbol.clear();
    this.recentWebsiteArticleFreshnessBySymbol.clear();
    this.pressReleaseCatalystContextBySymbol.clear();
    this.technicalContextCandleStore.clearAll();
    this.technicalContextProviderBySymbol.clear();
    this.technicalContextDataQualityFlagsBySymbol.clear();
    for (const timer of this.technicalContextBootstrapRetryTimers.values()) {
      clearTimeout(timer);
    }
    this.technicalContextBootstrapRetryTimers.clear();
    this.technicalContextBootstrapRetryAttempts.clear();
    this.technicalContextBootstrapRefreshInFlight.clear();
    this.lastWebsiteTechnicalContextPublishAt.clear();
    this.lastWebsiteTechnicalContextStateKey.clear();
    this.lastWebsitePullbackReadPublishAt.clear();
    this.lastWebsitePullbackReadStateKey.clear();
    this.persistWatchlist();
    const deactivatedAt = Date.now();
    for (const entry of entries) {
      await this.publishWebsiteTickerDeactivation(entry.symbol, deactivatedAt);
    }
    await this.restartMonitoring();
    this.emitLifecycle("deactivated", {
      details: {
        reason: "discord channel cleared",
        entryCount: entries.length,
        clearedThreadIds,
      },
    });

    return {
      entryCount: entries.length,
      clearedThreadIds,
      clearedPostMarkers,
    };
  }
}
