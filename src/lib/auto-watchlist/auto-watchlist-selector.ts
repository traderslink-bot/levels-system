import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { FinnhubClient } from "../stock-context/finnhub-client.js";
import type { YahooClient } from "../stock-context/yahoo-client.js";
import {
  normalizeNasdaqRow,
  type NasdaqRawScreenerRow,
} from "../review/nasdaq-marketcap-universe.js";
import {
  derivePressReleaseCatalystContext,
  lookupLocalPressReleaseCatalystArticles,
  newYorkDateKeyForTimestamp,
  type PressReleaseCatalystContext,
  type PressReleaseCatalystLookupResult,
  type PressReleaseCatalystTiming,
} from "../catalysts/press-release-catalyst-context.js";
import {
  classifyUsEquityMarketSession,
  newYorkDateTimeParts,
  usEquitySessionStartMinutes,
} from "../market-data/us-equity-exchange-calendar.js";
import {
  EodhdCommonStockSecurityMaster,
  type CommonEquitySecurityMasterLookup,
  type CommonEquitySecurityMasterStatus,
} from "./eodhd-common-stock-security-master.js";
import {
  NasdaqTradingHaltService,
  type NasdaqTradingHaltLookup,
  type NasdaqTradingHaltRecord,
  type NasdaqTradingHaltState,
} from "./nasdaq-trading-halt-service.js";

type FetchLike = typeof fetch;

const CONFIG_VERSION = 1;
const MAX_AUTO_WATCHLIST_FOLLOWUP_TICKERS = 3;
const CONSECUTIVE_PASS_MAX_GAP_MS = 15 * 60 * 1000;
const REVERSAL_WATCH_FULL_MAIN_SESSION_VOLUME = 50_000_000;
const REVERSAL_WATCH_DEAD_CONFIRMATION_MS = 10 * 60 * 1000;
const MAIN_WATCH_WINDOW_MINUTES = 12 * 60;
const NASDAQ_TOP_FIVE_GAINER_SOURCE = "nasdaq_live_most_advanced_top5";
const STOCKANALYSIS_PREMARKET_TOP_FIVE_GAINER_SOURCE = "stockanalysis_live_premarket_gainers_top5";
const STOCKANALYSIS_REGULAR_TOP_FIVE_GAINER_SOURCE = "stockanalysis_live_regular_gainers_top5";
const STOCKANALYSIS_AFTERHOURS_TOP_FIVE_GAINER_SOURCE = "stockanalysis_live_afterhours_gainers_top5";
const TRADINGVIEW_PREMARKET_TOP_FIVE_GAINER_SOURCE = "tradingview_live_premarket_gainers_top5";
const TRADINGVIEW_REGULAR_TOP_FIVE_GAINER_SOURCE = "tradingview_live_regular_gainers_top5";
const TRADINGVIEW_AFTERHOURS_TOP_FIVE_GAINER_SOURCE = "tradingview_live_afterhours_gainers_top5";
const TOP_FIVE_GAINER_SOURCE_SCREENS = new Set([
  NASDAQ_TOP_FIVE_GAINER_SOURCE,
  STOCKANALYSIS_PREMARKET_TOP_FIVE_GAINER_SOURCE,
  STOCKANALYSIS_REGULAR_TOP_FIVE_GAINER_SOURCE,
  STOCKANALYSIS_AFTERHOURS_TOP_FIVE_GAINER_SOURCE,
  TRADINGVIEW_PREMARKET_TOP_FIVE_GAINER_SOURCE,
  TRADINGVIEW_REGULAR_TOP_FIVE_GAINER_SOURCE,
  TRADINGVIEW_AFTERHOURS_TOP_FIVE_GAINER_SOURCE,
]);
const TOP_GAINER_SOURCE_SCREENS = new Set([
  "nasdaq_live_most_advanced",
  "stockanalysis_live_premarket_gainers",
  "stockanalysis_live_regular_gainers",
  "stockanalysis_live_afterhours_gainers",
  "tradingview_live_premarket_gainers",
  "tradingview_live_regular_gainers",
  "tradingview_live_afterhours_gainers",
  "small_cap_gainers",
]);
const INDEPENDENT_RUNNER_SOURCE_SCREENS = new Set([
  "live_exchange_screener",
  "nasdaq_live_most_advanced",
  "nasdaq_live_most_active",
  "stockanalysis_live_premarket_gainers",
  "stockanalysis_live_regular_gainers",
  "stockanalysis_live_afterhours_gainers",
  "tradingview_live_premarket_gainers",
  "tradingview_live_regular_gainers",
  "tradingview_live_afterhours_gainers",
  "small_cap_gainers",
  "aggressive_small_caps",
]);

export const DEFAULT_AUTO_WATCHLIST_SELECTOR_CONFIG = {
  maxMarketCap: 100_000_000,
  maxFloatShares: 50_000_000,
  maxSharesOutstanding: 60_000_000,
  lowPriceFloatNormalizationEnabled: true,
  lowPriceFloatNormalizationMaxPrice: 1,
  lowPriceFloatNormalizationMaxDollarValue: 50_000_000,
  requireShareData: true,
  minPrice: 0.25,
  maxPrice: 20,
  minGainPct: 10,
  minVolume: 500_000,
  minDollarVolume: 250_000,
  minPostmarketVolume: 100_000,
  minPostmarketDollarVolume: 250_000,
  minimumScore: 50,
  consecutivePassesRequired: 2,
  maxAddsPerTradingDay: 12,
  maxPostmarketAddsPerTradingDay: 8,
  maxActiveMainSessionTickers: 5,
  maxActivePostmarketTickers: 3,
  maxMainSessionReplacementsPerTradingDay: 7,
  maxPostmarketReplacementsPerTradingDay: 5,
  maxPostmarketExtremeRunnerOverridesPerTradingDay: 1,
  lateMainSessionAdmissionReserve: 3,
  lateMainSessionAdmissionUnlockHourEastern: 9,
  dynamicReplacementEnabled: true,
  minimumAutoHoldMinutes: 30,
  retentionFailureScansRequired: 3,
  replacementRankingMargin: 15,
  obviousRunnerOverrideEnabled: true,
  obviousRunnerRecentDollarVolumeMultiplier: 2,
  obviousRunnerMinVolumeAcceleration: 1.5,
  obviousRunnerReplacementMargin: 8,
  regularOpenProtectionMinutes: 15,
  enrichmentLimit: 12,
  scanIntervalMs: 2 * 60 * 1000,
  scanStartHourEastern: 4,
  scanEndHourEastern: 20,
  scanEndMinuteEastern: 0,
  premarketEnabled: true,
  regularHoursEnabled: true,
  postmarketEnabled: true,
  minRecentDollarVolume15mPremarket: 25_000,
  minRecentDollarVolume15mRegular: 50_000,
  minRecentDollarVolume15mPostmarket: 25_000,
  postmarketPromotionMinGainPct: 10,
  postmarketPromotionMinRecentDollarVolume: 75_000,
  requireRecentActivityData: true,
  maxActivityQuoteAgeMinutes: 10,
  extendedSessionCandidateLimit: 60,
  catalystRankingEnabled: true,
  catalystLookbackDays: 7,
  catalystSameDayRankBoost: 12,
  catalystDailyRankDecay: 3,
  recentDollarVolumeRankMaxBoost: 15,
  recentDollarVolumeRankFullScore: 1_000_000,
  volumeAccelerationRankMaxBoost: 10,
  volumeAccelerationRankFullScoreRatio: 3,
  volumeDecelerationRankMaxPenalty: 12,
  volumeDecelerationRankFullPenaltyRatio: 0.25,
  topGainerQualificationScoreBoost: 5,
  zeroRecentVolumeRetentionGraceMinutes: 15,
  shareTurnoverRankMaxBoost: 10,
  shareTurnoverRankFullScorePct: 100,
} as const;

export type AutoWatchlistSelectorThresholds = {
  maxMarketCap: number;
  maxFloatShares: number;
  maxSharesOutstanding: number;
  /**
   * Allows a known float above maxFloatShares only when a sub-dollar ticker's
   * float value remains under the dollar ceiling. This is deliberately not a
   * replacement for the share-count cap on normal-priced names.
   */
  lowPriceFloatNormalizationEnabled: boolean;
  lowPriceFloatNormalizationMaxPrice: number;
  lowPriceFloatNormalizationMaxDollarValue: number;
  requireShareData: boolean;
  minPrice: number;
  maxPrice: number;
  minGainPct: number;
  minVolume: number;
  minDollarVolume: number;
  /** After-hours-only share volume required for post-market qualification. */
  minPostmarketVolume: number;
  /** After-hours-only dollar volume required for post-market qualification. */
  minPostmarketDollarVolume: number;
  minimumScore: number;
  consecutivePassesRequired: number;
  maxAddsPerTradingDay: number;
  maxPostmarketAddsPerTradingDay: number;
  maxActiveMainSessionTickers: number;
  maxActivePostmarketTickers: number;
  maxMainSessionReplacementsPerTradingDay: number;
  maxPostmarketReplacementsPerTradingDay: number;
  /** Break-glass replacements after the normal post-market replacement allowance is exhausted. */
  maxPostmarketExtremeRunnerOverridesPerTradingDay: number;
  /** Shared late-session capacity for main-bucket additions and replacements after the normal quota is exhausted. */
  lateMainSessionAdmissionReserve: number;
  lateMainSessionAdmissionUnlockHourEastern: number;
  dynamicReplacementEnabled: boolean;
  minimumAutoHoldMinutes: number;
  retentionFailureScansRequired: number;
  replacementRankingMargin: number;
  obviousRunnerOverrideEnabled: boolean;
  obviousRunnerRecentDollarVolumeMultiplier: number;
  obviousRunnerMinVolumeAcceleration: number;
  obviousRunnerReplacementMargin: number;
  regularOpenProtectionMinutes: number;
  enrichmentLimit: number;
  scanIntervalMs: number;
  scanStartHourEastern: number;
  scanEndHourEastern: number;
  scanEndMinuteEastern: number;
  premarketEnabled: boolean;
  regularHoursEnabled: boolean;
  postmarketEnabled: boolean;
  minRecentDollarVolume15mPremarket: number;
  minRecentDollarVolume15mRegular: number;
  minRecentDollarVolume15mPostmarket: number;
  /** Applies only when a post-market candidate would take a new automatic slot. */
  postmarketPromotionMinGainPct: number;
  /** Applies only when a post-market candidate would take a new automatic slot. */
  postmarketPromotionMinRecentDollarVolume: number;
  requireRecentActivityData: boolean;
  maxActivityQuoteAgeMinutes: number;
  extendedSessionCandidateLimit: number;
  catalystRankingEnabled: boolean;
  catalystLookbackDays: number;
  catalystSameDayRankBoost: number;
  catalystDailyRankDecay: number;
  recentDollarVolumeRankMaxBoost: number;
  recentDollarVolumeRankFullScore: number;
  volumeAccelerationRankMaxBoost: number;
  volumeAccelerationRankFullScoreRatio: number;
  volumeDecelerationRankMaxPenalty: number;
  volumeDecelerationRankFullPenaltyRatio: number;
  topGainerQualificationScoreBoost: number;
  zeroRecentVolumeRetentionGraceMinutes: number;
  shareTurnoverRankMaxBoost: number;
  shareTurnoverRankFullScorePct: number;
};

export type AutoWatchlistDiscoveryCandidate = {
  symbol: string;
  price: number | null;
  gainPct: number | null;
  volume: number | null;
  averageVolume: number | null;
  marketCap: number | null;
  quoteTime: number | null;
  sourceScreens: string[];
  securityMasterStatus?: CommonEquitySecurityMasterStatus;
};

export type AutoWatchlistCandidateDecision = AutoWatchlistDiscoveryCandidate & {
  score: number;
  rankingScore: number;
  slotSurvivalScore: number;
  slotSurvivalReasons: string[];
  qualified: boolean;
  promotionReady: boolean;
  promotionRejectionReasons: string[];
  consecutivePasses: number;
  floatShares: number | null;
  sharesOutstanding: number | null;
  effectiveShares: number | null;
  effectiveSharesSource:
    | "yahoo_float"
    | "finnhub_float"
    | "yahoo_outstanding"
    | "finnhub_outstanding"
    | null;
  floatDollarValue: number | null;
  lowPriceFloatNormalized: boolean;
  session: AutoWatchlistSession;
  sessionVolume: number | null;
  mainSessionVolume: number | null;
  sessionDollarVolume: number | null;
  recent15mVolume: number | null;
  recent15mDollarVolume: number | null;
  sessionElapsedMinutes: number | null;
  mainSessionElapsedMinutes: number | null;
  volumeAcceleration: number | null;
  shareTurnoverPct: number | null;
  activityQuoteAgeMinutes: number | null;
  activityDataAvailable: boolean;
  catalystAgeDays: number | null;
  catalystTiming: PressReleaseCatalystTiming;
  catalystPublishedAt: string | null;
  catalystTitle: string | null;
  catalystRankBoost: number;
  recentDollarVolumeRankBoost: number;
  volumeAccelerationRankBoost: number;
  volumeDecelerationRankPenalty: number;
  shareTurnoverRankBoost: number;
  tradingHaltState: NasdaqTradingHaltState | "not_checked" | "unavailable";
  tradingHaltReasonCode: string | null;
  haltRetentionProtected: boolean;
  haltRetentionProtectionReason: string | null;
  reasons: string[];
  rankingReasons: string[];
  rejectionReasons: string[];
};

export type AutoWatchlistBucket = "main" | "postmarket";

export type AutoWatchlistManagedEntry = {
  symbol: string;
  bucket: AutoWatchlistBucket;
  state: "active" | "followup" | "standby";
  firstAddedAt: number;
  lastActivatedAt: number;
  addedSession: AutoWatchlistSession;
  lastSession: AutoWatchlistSession;
  lastRankingScore: number;
  lastSlotSurvivalScore: number;
  admissionAt: number | null;
  admissionQualificationScore: number | null;
  admissionRankingScore: number | null;
  admissionSlotSurvivalScore: number | null;
  lastQualifiedAt: number | null;
  holdProtectionEarnedAt: number | null;
  holdProtectionReason: string | null;
  reversalWatchQualifiedAt: number | null;
  reversalWatchQualificationReason: string | null;
  reversalWatchLowPrice: number | null;
  reversalWatchLowAt: number | null;
  reversalAttemptEvidenceScans: number;
  reversalWatchAttemptReady: boolean;
  peakGainPct: number | null;
  peakGainAt: number | null;
  lastObservedGainPct: number | null;
  lastObservedAt: number | null;
  topFiveGainerFirstObservedAt: number | null;
  topFiveGainerLastObservedAt: number | null;
  topFiveGainerObservationCount: number;
  topFiveGainerConsecutiveObservations: number;
  retentionFailures: number;
  followupAt?: number | null;
  vacatedSlotAt?: number | null;
  standbyAt: number | null;
  statusReason: string;
};

export type AutoWatchlistFirstPassEvidence = {
  symbol: string;
  observedAt: number;
  session: AutoWatchlistSession;
  rankingScore: number;
  slotSurvivalScore: number;
  gainPct: number | null;
  recent15mDollarVolume: number | null;
  volumeAcceleration: number | null;
  shareTurnoverPct: number | null;
  sourceScreens: string[];
};

export type AutoWatchlistConsecutivePassEvidence = {
  symbol: string;
  count: number;
  session: AutoWatchlistSession;
  observedAt: number;
};

export type AutoWatchlistReplacementEvent = {
  timestamp: number;
  bucket: AutoWatchlistBucket;
  incomingSymbol: string | null;
  outgoingSymbol: string;
  incomingRankingScore: number | null;
  outgoingRankingScore: number;
  reason: string;
  exceptionKind?: "postmarket_extreme_runner";
};

export type AutoWatchlistRuntimeEntry = {
  symbol: string;
  tags?: string[];
  note?: string;
  activatedAt?: number;
};

export type AutoWatchlistSelectorStatus = {
  enabled: boolean;
  running: boolean;
  configPath: string;
  thresholds: AutoWatchlistSelectorThresholds;
  providerStatus: {
    liveExchangeDiscoveryAvailable: boolean;
    yahooDiscoveryAvailable: boolean;
    yahooFloatAvailable: boolean;
    finnhubOutstandingAvailable: boolean;
    pressReleaseCatalystAvailable: boolean;
    sessionActivityAvailable: boolean;
    tradingHaltFeedAvailable: boolean;
    commonEquitySecurityMasterEnabled: boolean;
    commonEquitySecurityMasterAvailable: boolean;
    commonEquitySecurityMasterCheckedAt: number | null;
    commonEquitySecurityMasterCacheUsed: boolean | null;
  };
  lastScanAt: number | null;
  lastScanCompletedAt: number | null;
  lastScanCandidateCount: number;
  lastEvaluatedCount: number;
  lastQualifiedCount: number;
  lastAddedSymbols: string[];
  lastActivationErrors: Array<{ symbol: string; error: string }>;
  lastError: string | null;
  lastDiscoverySources: string[];
  lastDiscoveryError: string | null;
  discoveryFeedComparison: AutoWatchlistDiscoveryFeedComparison | null;
  lastCatalystLookupError: string | null;
  lastActivityLookupError: string | null;
  lastTradingHaltLookupError: string | null;
  lastSecurityMasterError: string | null;
  tradingDay: string | null;
  addedToday: string[];
  mainSessionAddedToday: string[];
  postmarketAddedToday: string[];
  lateMainSessionAdmissionReserveUsed: number;
  lateMainSessionAdmissionReserveAvailable: number;
  lateMainSessionAdmissionReserveUnlocked: boolean;
  postmarketExtremeRunnerOverridesUsed: number;
  postmarketExtremeRunnerOverridesAvailable: number;
  activeMainSessionSymbols: string[];
  activePostmarketSymbols: string[];
  followupSymbols: string[];
  pendingReplacementSymbols: string[];
  standbyToday: AutoWatchlistManagedEntry[];
  managedEntries: AutoWatchlistManagedEntry[];
  firstPassEvidence: AutoWatchlistFirstPassEvidence[];
  consecutivePassEvidence: AutoWatchlistConsecutivePassEvidence[];
  recentReplacements: AutoWatchlistReplacementEvent[];
  recentDecisions: AutoWatchlistCandidateDecision[];
};

export type AutoWatchlistDiscoveryFeedComparison = {
  checkedAt: number;
  session: "premarket";
  status: "agreeing" | "nasdaq_stale_or_mismatched" | "stockanalysis_stale_or_mismatched" | "inconclusive";
  overlapSymbols: string[];
  nasdaq: AutoWatchlistDiscoveryFeedHealth;
  stockAnalysis: AutoWatchlistDiscoveryFeedHealth;
};

export type AutoWatchlistDiscoveryFeedHealth = {
  available: boolean;
  error: string | null;
  leaderSymbols: string[];
  currentSessionMatches: string[];
};

type PersistedConfig = {
  version: typeof CONFIG_VERSION;
  enabled: boolean;
  lastUpdated: number;
  thresholds?: Partial<AutoWatchlistSelectorThresholds>;
  tradingDay?: string | null;
  addedToday?: string[];
  mainSessionAddedToday?: string[];
  postmarketAddedToday?: string[];
  lateMainSessionAdmissionReserveUsed?: number;
  managedEntries?: AutoWatchlistManagedEntry[];
  firstPassEvidence?: AutoWatchlistFirstPassEvidence[];
  consecutivePassEvidence?: AutoWatchlistConsecutivePassEvidence[];
  replacementHistory?: AutoWatchlistReplacementEvent[];
};

type NasdaqMarketMoverRow = {
  symbol?: unknown;
  name?: unknown;
  lastSalePrice?: unknown;
  lastSaleChange?: unknown;
  change?: unknown;
  deltaIndicator?: unknown;
};

type AutoWatchlistSelectorOptions = {
  yahooClient: YahooClient | null;
  finnhubClient: FinnhubClient | null;
  activateSymbol: (input: {
    symbol: string;
    note?: string;
    source?: "manual" | "auto";
    autoSession?: Exclude<AutoWatchlistSession, "closed">;
    selectionPrice?: number;
    selectionGainPct?: number;
  }) => Promise<unknown>;
  deactivateSymbol?: (symbol: string) => Promise<unknown>;
  setSymbolFollowup?: (
    symbol: string,
    followup: boolean,
    options?: {
      reversalWatchEligible?: boolean;
      reversalWatchAttemptReady?: boolean;
    },
  ) => Promise<unknown>;
  getActiveSymbols: () => string[];
  getActiveEntries?: () => AutoWatchlistRuntimeEntry[];
  isRuntimeReady: () => boolean;
  fetchImpl?: FetchLike;
  configPath?: string;
  thresholds?: Partial<AutoWatchlistSelectorThresholds>;
  now?: () => number;
  catalystLookup?: typeof lookupLocalPressReleaseCatalystArticles;
  sessionActivityLookup?: AutoWatchlistSessionActivityLookup;
  tradingHaltLookup?: NasdaqTradingHaltLookup;
  securityMasterLookup?: CommonEquitySecurityMasterLookup;
  requireVerifiedCommonEquity?: boolean;
  onPremarketVolumeSnapshot?: (snapshots: AutoWatchlistPremarketVolumeSnapshot[]) => void;
};

export type AutoWatchlistPremarketVolumeSnapshot = {
  symbol: string;
  cumulativeVolume: number;
  observedAt: number;
};

export type AutoWatchlistSession = "premarket" | "regular" | "postmarket" | "closed";

export type AutoWatchlistSessionActivity = {
  symbol: string;
  session: AutoWatchlistSession;
  price: number | null;
  gainPct: number | null;
  sessionVolume: number | null;
  mainSessionVolume?: number | null;
  sessionDollarVolume?: number | null;
  recent15mVolume: number | null;
  recent15mDollarVolume: number | null;
  sessionElapsedMinutes?: number | null;
  mainSessionElapsedMinutes?: number | null;
  volumeAcceleration?: number | null;
  quoteTime: number | null;
  quoteAgeMinutes: number | null;
  available: boolean;
  error?: string;
};

export type AutoWatchlistSessionActivityLookup = (input: {
  symbols: string[];
  session: AutoWatchlistSession;
  now: number;
}) => Promise<Record<string, AutoWatchlistSessionActivity>>;

type YahooScreenerQuote = {
  symbol?: string;
  quoteType?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  averageDailyVolume3Month?: number;
  marketCap?: number;
  regularMarketTime?: number;
};

type YahooScreenerResponse = {
  finance?: {
    result?: Array<{
      quotes?: YahooScreenerQuote[];
    }>;
    error?: unknown;
  };
};

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function discoveryDollarVolume(candidate: AutoWatchlistDiscoveryCandidate): number {
  return Math.max(0, candidate.price ?? 0) * Math.max(0, candidate.volume ?? 0);
}

function isEligibleForExtendedSessionProbe(
  candidate: AutoWatchlistDiscoveryCandidate,
  thresholds: AutoWatchlistSelectorThresholds,
): boolean {
  const price = candidate.price;
  return (
    (candidate.marketCap === null || candidate.marketCap <= thresholds.maxMarketCap) &&
    (price === null || (price >= thresholds.minPrice && price <= thresholds.maxPrice))
  );
}

/**
 * A single regular-hours leader board cannot identify an after-hours runner.
 * Keep the session-activity request budget fixed, but split it across direct
 * movers, regular-session dollar volume, regular-session percentage gain, and
 * a rotating exploration slice. The exploration slice prevents a stock that
 * was quiet in regular hours from remaining permanently invisible when a
 * direct extended-hours source is temporarily unavailable.
 */
export function selectExtendedSessionProbeCandidates(input: {
  candidates: AutoWatchlistDiscoveryCandidate[];
  explorationCandidates?: AutoWatchlistDiscoveryCandidate[];
  marketMovers: AutoWatchlistDiscoveryCandidate[];
  limit: number;
  thresholds: AutoWatchlistSelectorThresholds;
  explorationStartIndex?: number;
}): AutoWatchlistDiscoveryCandidate[] {
  const eligible = (candidate: AutoWatchlistDiscoveryCandidate) =>
    isEligibleForExtendedSessionProbe(candidate, input.thresholds);
  const byDollarVolume = [...input.candidates]
    .filter(eligible)
    .sort((left, right) =>
      discoveryDollarVolume(right) - discoveryDollarVolume(left) ||
      (right.gainPct ?? 0) - (left.gainPct ?? 0),
    );
  const byGain = [...input.candidates]
    .filter(eligible)
    .sort((left, right) =>
      (right.gainPct ?? 0) - (left.gainPct ?? 0) ||
      discoveryDollarVolume(right) - discoveryDollarVolume(left),
    );
  const byMover = [...input.marketMovers]
    .filter(eligible)
    .sort((left, right) =>
      (right.gainPct ?? 0) - (left.gainPct ?? 0) ||
      discoveryDollarVolume(right) - discoveryDollarVolume(left),
    );
  const lanes = [byMover, byDollarVolume, byGain];
  const nextIndex = lanes.map(() => 0);
  const selected = new Map<string, AutoWatchlistDiscoveryCandidate>();
  const explorationPool = [...(input.explorationCandidates ?? input.candidates)]
    .filter(eligible)
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
  const explorationSlots = Math.floor(input.limit / 4);
  const leaderLimit = Math.max(0, input.limit - explorationSlots);

  while (selected.size < leaderLimit) {
    let addedAny = false;
    for (const [laneIndex, lane] of lanes.entries()) {
      while (nextIndex[laneIndex]! < lane.length) {
        const candidate = lane[nextIndex[laneIndex]++]!;
        if (selected.has(candidate.symbol)) continue;
        selected.set(candidate.symbol, candidate);
        addedAny = true;
        break;
      }
      if (selected.size >= leaderLimit) break;
    }
    if (!addedAny) break;
  }

  if (explorationSlots > 0 && explorationPool.length > 0) {
    const start = Math.max(0, input.explorationStartIndex ?? 0) % explorationPool.length;
    let explorationAdded = 0;
    for (
      let offset = 0;
      offset < explorationPool.length && selected.size < input.limit && explorationAdded < explorationSlots;
      offset += 1
    ) {
      const candidate = explorationPool[(start + offset) % explorationPool.length]!;
      if (selected.has(candidate.symbol)) continue;
      selected.set(candidate.symbol, {
        ...candidate,
        sourceScreens: [...new Set([...candidate.sourceScreens, "extended_session_rotating_probe"])],
      });
      explorationAdded += 1;
    }
  }

  while (selected.size < input.limit) {
    let addedAny = false;
    for (const [laneIndex, lane] of lanes.entries()) {
      while (nextIndex[laneIndex]! < lane.length) {
        const candidate = lane[nextIndex[laneIndex]++]!;
        if (selected.has(candidate.symbol)) continue;
        selected.set(candidate.symbol, candidate);
        addedAny = true;
        break;
      }
      if (selected.size >= input.limit) break;
    }
    if (!addedAny) break;
  }

  return [...selected.values()];
}

export function parseStockAnalysisAfterhoursGainers(
  html: string,
  expectedDate?: string,
): AutoWatchlistDiscoveryCandidate[] {
  const numberPattern = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
  const rowPattern = new RegExp(
    `\\{no:(\\d+),s:\"([A-Z0-9.-]+)\",n:\"(?:\\\\.|[^\"\\\\])*\",` +
      `postmarketChangePercent:(${numberPattern}),postmarketDate:\"([^\"]+)\",` +
      `postmarketPrice:(${numberPattern}),postClose:${numberPattern},marketCap:(${numberPattern})`,
    "g",
  );
  const bySymbol = new Map<string, AutoWatchlistDiscoveryCandidate>();
  for (const match of html.matchAll(rowPattern)) {
    const rank = Number(match[1]);
    const symbol = normalizeSymbol(match[2]);
    const gainPct = finiteNumber(Number(match[3]));
    const postmarketDate = match[4];
    const price = finitePositive(Number(match[5]));
    const marketCap = finitePositive(Number(match[6]));
    if (expectedDate && postmarketDate !== expectedDate) continue;
    if (!symbol || gainPct === null || price === null) continue;
    bySymbol.set(symbol, {
      symbol,
      price,
      gainPct,
      volume: null,
      averageVolume: null,
      marketCap,
      quoteTime: null,
      sourceScreens: [
        "stockanalysis_live_afterhours_gainers",
        ...(rank <= 5 ? [STOCKANALYSIS_AFTERHOURS_TOP_FIVE_GAINER_SOURCE] : []),
      ],
    });
  }
  return [...bySymbol.values()].sort(
    (left, right) => (right.gainPct ?? 0) - (left.gainPct ?? 0),
  );
}

export function parseStockAnalysisPremarketGainers(
  html: string,
  expectedDate?: string,
): AutoWatchlistDiscoveryCandidate[] {
  const numberPattern = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
  const rowPattern = new RegExp(
    `\\{no:(\\d+),s:\"([A-Z0-9.-]+)\",n:\"(?:\\\\.|[^\"\\\\])*\",` +
      `premarketChangePercent:(${numberPattern}),premarketDate:\"([^\"]+)\",` +
      `premarketPrice:(${numberPattern})(?:,premarketVolume:(${numberPattern}))?,marketCap:(${numberPattern})`,
    "g",
  );
  const bySymbol = new Map<string, AutoWatchlistDiscoveryCandidate>();
  for (const match of html.matchAll(rowPattern)) {
    const rank = Number(match[1]);
    const symbol = normalizeSymbol(match[2]);
    const gainPct = finiteNumber(Number(match[3]));
    const premarketDate = match[4];
    const price = finitePositive(Number(match[5]));
    const volume = finitePositive(Number(match[6]));
    const marketCap = finitePositive(Number(match[7]));
    if (expectedDate && premarketDate !== expectedDate) continue;
    if (!symbol || gainPct === null || price === null) continue;
    bySymbol.set(symbol, {
      symbol,
      price,
      gainPct,
      volume,
      averageVolume: null,
      marketCap,
      quoteTime: null,
      sourceScreens: [
        "stockanalysis_live_premarket_gainers",
        ...(rank <= 5 ? [STOCKANALYSIS_PREMARKET_TOP_FIVE_GAINER_SOURCE] : []),
      ],
    });
  }
  return [...bySymbol.values()].sort(
    (left, right) => (right.gainPct ?? 0) - (left.gainPct ?? 0),
  );
}

export function parseStockAnalysisRegularGainers(
  html: string,
  expectedDate?: string,
): AutoWatchlistDiscoveryCandidate[] {
  const numberPattern = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
  const rowPattern = new RegExp(
    `\\{no:(\\d+),s:\"([A-Z0-9.-]+)\",n:\"(?:\\\\.|[^\"\\\\])*\",` +
      `change:(${numberPattern}),priceDate:\"([^\"]+)\",price:(${numberPattern}),` +
      `volume:(${numberPattern}),marketCap:(${numberPattern})`,
    "g",
  );
  const bySymbol = new Map<string, AutoWatchlistDiscoveryCandidate>();
  for (const match of html.matchAll(rowPattern)) {
    const rank = Number(match[1]);
    const symbol = normalizeSymbol(match[2]);
    const gainPct = finiteNumber(Number(match[3]));
    const priceDate = match[4];
    const price = finitePositive(Number(match[5]));
    const volume = finitePositive(Number(match[6]));
    const marketCap = finitePositive(Number(match[7]));
    if (expectedDate && priceDate !== expectedDate) continue;
    if (!symbol || gainPct === null || price === null) continue;
    bySymbol.set(symbol, {
      symbol,
      price,
      gainPct,
      volume,
      averageVolume: null,
      marketCap,
      quoteTime: null,
      sourceScreens: [
        "stockanalysis_live_regular_gainers",
        ...(rank <= 5 ? [STOCKANALYSIS_REGULAR_TOP_FIVE_GAINER_SOURCE] : []),
      ],
    });
  }
  return [...bySymbol.values()].sort(
    (left, right) => (right.gainPct ?? 0) - (left.gainPct ?? 0),
  );
}

export function parseTradingViewGainers(
  html: string,
  session: Exclude<AutoWatchlistSession, "closed">,
): AutoWatchlistDiscoveryCandidate[] {
  const sessionName = session === "postmarket" ? "afterhours" : session;
  const source = `tradingview_live_${sessionName}_gainers`;
  const topFiveSource = `tradingview_live_${sessionName}_gainers_top5`;
  const rowPattern = /<tr\b[^>]*data-rowkey="(?:NASDAQ|NYSE|AMEX):([A-Z0-9.-]+)"[^>]*>([\s\S]*?)<\/tr>/gi;
  const bySymbol = new Map<string, AutoWatchlistDiscoveryCandidate>();
  let rank = 0;
  for (const match of html.matchAll(rowPattern)) {
    rank += 1;
    const symbol = normalizeSymbol(match[1]);
    const rowHtml = match[2] ?? "";
    const gainMatch = rowHtml.match(/class="positive-[^"]*"[^>]*>\+?([0-9][0-9,.]*)%<\/span>/i);
    const gainPct = gainMatch ? finiteNumber(Number(gainMatch[1]!.replace(/,/g, ""))) : null;
    if (!symbol || gainPct === null) continue;
    bySymbol.set(symbol, {
      symbol,
      price: null,
      gainPct,
      volume: null,
      averageVolume: null,
      marketCap: null,
      quoteTime: null,
      sourceScreens: [source, ...(rank <= 5 ? [topFiveSource] : [])],
    });
  }
  return [...bySymbol.values()].sort(
    (left, right) => (right.gainPct ?? 0) - (left.gainPct ?? 0),
  );
}

export function buildAutoWatchlistDiscoveryFeedComparison(input: {
  checkedAt: number;
  nasdaqAvailable: boolean;
  nasdaqError: string | null;
  nasdaqCandidates: AutoWatchlistDiscoveryCandidate[];
  stockAnalysisAvailable: boolean;
  stockAnalysisError: string | null;
  stockAnalysisCandidates: AutoWatchlistDiscoveryCandidate[];
  activities: Map<string, AutoWatchlistSessionActivity>;
}): AutoWatchlistDiscoveryFeedComparison {
  const buildHealth = (
    available: boolean,
    error: string | null,
    candidates: AutoWatchlistDiscoveryCandidate[],
  ): AutoWatchlistDiscoveryFeedHealth => {
    const leaders = candidates.slice(0, 10);
    const currentSessionMatches = leaders
      .filter((candidate) => {
        const activity = input.activities.get(candidate.symbol);
        if (!activity?.available || activity.gainPct === null || candidate.gainPct === null) return false;
        const tolerance = Math.max(15, Math.abs(activity.gainPct) * 0.5);
        return activity.gainPct > 0 && Math.abs(candidate.gainPct - activity.gainPct) <= tolerance;
      })
      .map((candidate) => candidate.symbol);
    return {
      available,
      error,
      leaderSymbols: leaders.map((candidate) => candidate.symbol),
      currentSessionMatches,
    };
  };
  const nasdaq = buildHealth(input.nasdaqAvailable, input.nasdaqError, input.nasdaqCandidates);
  const stockAnalysis = buildHealth(
    input.stockAnalysisAvailable,
    input.stockAnalysisError,
    input.stockAnalysisCandidates,
  );
  const stockAnalysisSymbols = new Set(stockAnalysis.leaderSymbols);
  const overlapSymbols = nasdaq.leaderSymbols.filter((symbol) => stockAnalysisSymbols.has(symbol));
  const nasdaqClearlyMismatched =
    nasdaq.leaderSymbols.length >= 3 &&
    nasdaq.currentSessionMatches.length <= 1 &&
    stockAnalysis.currentSessionMatches.length >= 2;
  const stockAnalysisClearlyMismatched =
    stockAnalysis.leaderSymbols.length >= 3 &&
    stockAnalysis.currentSessionMatches.length <= 1 &&
    nasdaq.currentSessionMatches.length >= 2;
  const status = nasdaqClearlyMismatched
    ? "nasdaq_stale_or_mismatched"
    : stockAnalysisClearlyMismatched
      ? "stockanalysis_stale_or_mismatched"
      : overlapSymbols.length >= 2 || (
          nasdaq.currentSessionMatches.length >= 2 &&
          stockAnalysis.currentSessionMatches.length >= 2
        )
        ? "agreeing"
        : "inconclusive";
  return {
    checkedAt: input.checkedAt,
    session: "premarket",
    status,
    overlapSymbols,
    nasdaq,
    stockAnalysis,
  };
}

function normalizeSymbol(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function isTopGainerCandidate(candidate: AutoWatchlistDiscoveryCandidate): boolean {
  return candidate.sourceScreens.some((source) => TOP_GAINER_SOURCE_SCREENS.has(source));
}

const INTEGER_THRESHOLD_KEYS = new Set<keyof AutoWatchlistSelectorThresholds>([
  "maxMarketCap",
  "maxFloatShares",
  "maxSharesOutstanding",
  "lowPriceFloatNormalizationMaxDollarValue",
  "minVolume",
  "minDollarVolume",
  "minPostmarketVolume",
  "minPostmarketDollarVolume",
  "minimumScore",
  "consecutivePassesRequired",
  "maxAddsPerTradingDay",
  "maxPostmarketAddsPerTradingDay",
  "maxActiveMainSessionTickers",
  "maxActivePostmarketTickers",
  "maxMainSessionReplacementsPerTradingDay",
  "maxPostmarketReplacementsPerTradingDay",
  "maxPostmarketExtremeRunnerOverridesPerTradingDay",
  "lateMainSessionAdmissionReserve",
  "lateMainSessionAdmissionUnlockHourEastern",
  "minimumAutoHoldMinutes",
  "retentionFailureScansRequired",
  "replacementRankingMargin",
  "obviousRunnerReplacementMargin",
  "regularOpenProtectionMinutes",
  "enrichmentLimit",
  "scanIntervalMs",
  "scanStartHourEastern",
  "scanEndHourEastern",
  "scanEndMinuteEastern",
  "catalystLookbackDays",
  "catalystSameDayRankBoost",
  "catalystDailyRankDecay",
  "recentDollarVolumeRankMaxBoost",
  "recentDollarVolumeRankFullScore",
  "volumeAccelerationRankMaxBoost",
  "volumeDecelerationRankMaxPenalty",
  "topGainerQualificationScoreBoost",
  "zeroRecentVolumeRetentionGraceMinutes",
  "shareTurnoverRankMaxBoost",
  "shareTurnoverRankFullScorePct",
  "minRecentDollarVolume15mPremarket",
  "minRecentDollarVolume15mRegular",
  "minRecentDollarVolume15mPostmarket",
  "postmarketPromotionMinRecentDollarVolume",
  "maxActivityQuoteAgeMinutes",
  "extendedSessionCandidateLimit",
]);

export function resolveAutoWatchlistSelectorThresholds(
  input: Partial<AutoWatchlistSelectorThresholds> = {},
): AutoWatchlistSelectorThresholds {
  const resolved = {
    ...DEFAULT_AUTO_WATCHLIST_SELECTOR_CONFIG,
    ...input,
  } as AutoWatchlistSelectorThresholds;
  for (const [key, value] of Object.entries(resolved) as Array<[
    keyof AutoWatchlistSelectorThresholds,
    number | boolean,
  ]>) {
    if (
      key === "requireShareData" ||
      key === "lowPriceFloatNormalizationEnabled" ||
      key === "catalystRankingEnabled" ||
      key === "premarketEnabled" ||
      key === "regularHoursEnabled" ||
      key === "postmarketEnabled" ||
      key === "requireRecentActivityData" ||
      key === "dynamicReplacementEnabled" ||
      key === "obviousRunnerOverrideEnabled"
    ) {
      if (typeof value !== "boolean") {
        throw new Error(`${key} must be true or false.`);
      }
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`${key} must be a non-negative number.`);
    }
    if (INTEGER_THRESHOLD_KEYS.has(key) && !Number.isInteger(value)) {
      throw new Error(`${key} must be a whole number.`);
    }
  }
  if (resolved.maxMarketCap <= 0 || resolved.maxFloatShares <= 0 || resolved.maxSharesOutstanding <= 0) {
    throw new Error("Market-cap and share ceilings must be greater than zero.");
  }
  if (
    resolved.lowPriceFloatNormalizationMaxPrice <= 0 ||
    resolved.lowPriceFloatNormalizationMaxPrice > resolved.maxPrice ||
    resolved.lowPriceFloatNormalizationMaxDollarValue <= 0
  ) {
    throw new Error("Low-price float normalization limits must be positive and inside the price range.");
  }
  if (resolved.minPrice <= 0 || resolved.maxPrice <= resolved.minPrice) {
    throw new Error("maxPrice must be greater than minPrice, and both must be positive.");
  }
  if (resolved.minimumScore > 100) {
    throw new Error("minimumScore cannot exceed 100.");
  }
  if (resolved.consecutivePassesRequired < 1 || resolved.consecutivePassesRequired > 10) {
    throw new Error("consecutivePassesRequired must be between 1 and 10.");
  }
  if (resolved.maxAddsPerTradingDay < 1 || resolved.maxAddsPerTradingDay > 20) {
    throw new Error("maxAddsPerTradingDay must be between 1 and 20.");
  }
  if (resolved.maxPostmarketAddsPerTradingDay < 1 || resolved.maxPostmarketAddsPerTradingDay > 20) {
    throw new Error("maxPostmarketAddsPerTradingDay must be between 1 and 20.");
  }
  if (resolved.maxActiveMainSessionTickers < 1 || resolved.maxActiveMainSessionTickers > 20) {
    throw new Error("maxActiveMainSessionTickers must be between 1 and 20.");
  }
  if (resolved.maxActivePostmarketTickers < 1 || resolved.maxActivePostmarketTickers > 20) {
    throw new Error("maxActivePostmarketTickers must be between 1 and 20.");
  }
  if (
    resolved.maxMainSessionReplacementsPerTradingDay > 50 ||
    resolved.maxPostmarketReplacementsPerTradingDay > 50 ||
    resolved.maxPostmarketExtremeRunnerOverridesPerTradingDay > 10
  ) {
    throw new Error("Daily automatic replacement limits are too large.");
  }
  if (resolved.lateMainSessionAdmissionReserve > 20) {
    throw new Error("lateMainSessionAdmissionReserve cannot exceed 20.");
  }
  if (resolved.lateMainSessionAdmissionUnlockHourEastern > 23) {
    throw new Error("lateMainSessionAdmissionUnlockHourEastern must be between 0 and 23.");
  }
  if (resolved.retentionFailureScansRequired < 1 || resolved.retentionFailureScansRequired > 10) {
    throw new Error("retentionFailureScansRequired must be between 1 and 10.");
  }
  if (resolved.minimumAutoHoldMinutes > 240 || resolved.regularOpenProtectionMinutes > 120) {
    throw new Error("Automatic hold and open-protection windows are too large.");
  }
  if (resolved.obviousRunnerRecentDollarVolumeMultiplier < 1) {
    throw new Error("obviousRunnerRecentDollarVolumeMultiplier must be at least 1.");
  }
  if (resolved.obviousRunnerMinVolumeAcceleration < 1) {
    throw new Error("obviousRunnerMinVolumeAcceleration must be at least 1.");
  }
  if (resolved.enrichmentLimit < 1 || resolved.enrichmentLimit > 50) {
    throw new Error("enrichmentLimit must be between 1 and 50.");
  }
  if (resolved.extendedSessionCandidateLimit < 1 || resolved.extendedSessionCandidateLimit > 200) {
    throw new Error("extendedSessionCandidateLimit must be between 1 and 200.");
  }
  if (resolved.maxActivityQuoteAgeMinutes < 1 || resolved.maxActivityQuoteAgeMinutes > 60) {
    throw new Error("maxActivityQuoteAgeMinutes must be between 1 and 60.");
  }
  if (resolved.postmarketPromotionMinGainPct > 100) {
    throw new Error("postmarketPromotionMinGainPct cannot exceed 100.");
  }
  if (resolved.catalystLookbackDays > 30) {
    throw new Error("catalystLookbackDays cannot exceed 30.");
  }
  if (resolved.catalystSameDayRankBoost > 100 || resolved.catalystDailyRankDecay > 100) {
    throw new Error("Catalyst ranking boost and daily decay cannot exceed 100.");
  }
  if (
    resolved.recentDollarVolumeRankMaxBoost > 100 ||
    resolved.volumeAccelerationRankMaxBoost > 100 ||
    resolved.volumeDecelerationRankMaxPenalty > 100 ||
    resolved.topGainerQualificationScoreBoost > 100 ||
    resolved.shareTurnoverRankMaxBoost > 100
  ) {
    throw new Error("Activity ranking boosts, penalties, and turnover boosts cannot exceed 100.");
  }
  if (resolved.recentDollarVolumeRankFullScore <= 0) {
    throw new Error("recentDollarVolumeRankFullScore must be greater than zero.");
  }
  if (resolved.volumeAccelerationRankFullScoreRatio <= 1) {
    throw new Error("volumeAccelerationRankFullScoreRatio must be greater than 1.");
  }
  if (
    resolved.volumeDecelerationRankFullPenaltyRatio <= 0 ||
    resolved.volumeDecelerationRankFullPenaltyRatio >= 1
  ) {
    throw new Error("volumeDecelerationRankFullPenaltyRatio must be greater than 0 and less than 1.");
  }
  if (resolved.shareTurnoverRankFullScorePct <= 0) {
    throw new Error("shareTurnoverRankFullScorePct must be greater than zero.");
  }
  if (resolved.zeroRecentVolumeRetentionGraceMinutes > 60) {
    throw new Error("zeroRecentVolumeRetentionGraceMinutes cannot exceed 60.");
  }
  if (resolved.scanIntervalMs < 30_000 || resolved.scanIntervalMs > 60 * 60 * 1000) {
    throw new Error("scanIntervalMs must be between 30000 and 3600000.");
  }
  if (
    resolved.scanStartHourEastern < 0 ||
    resolved.scanStartHourEastern > 23 ||
    resolved.scanEndHourEastern < 0 ||
    resolved.scanEndHourEastern > 23 ||
    resolved.scanEndMinuteEastern < 0 ||
    resolved.scanEndMinuteEastern > 59
  ) {
    throw new Error("Scan-window hours and minutes are invalid.");
  }
  const startMinutes = resolved.scanStartHourEastern * 60;
  const endMinutes = resolved.scanEndHourEastern * 60 + resolved.scanEndMinuteEastern;
  if (endMinutes <= startMinutes) {
    throw new Error("The scan end time must be after the scan start time.");
  }
  return resolved;
}

function easternParts(timestamp: number): {
  date: string;
  weekday: string;
  hour: number;
  minute: number;
} {
  const values = newYorkDateTimeParts(timestamp);
  return {
    date: values?.date ?? "",
    weekday: values?.weekday ?? "",
    hour: values?.hour ?? Number.NaN,
    minute: values?.minute ?? Number.NaN,
  };
}

export function autoWatchlistSessionForTimestamp(timestamp: number): AutoWatchlistSession {
  return classifyUsEquityMarketSession(timestamp).session;
}

function isAutoWatchlistSessionEnabled(
  session: AutoWatchlistSession,
  thresholds: AutoWatchlistSelectorThresholds,
): boolean {
  if (session === "premarket") return thresholds.premarketEnabled;
  if (session === "regular") return thresholds.regularHoursEnabled;
  if (session === "postmarket") return thresholds.postmarketEnabled;
  return false;
}

function minimumRecentDollarVolume(
  session: AutoWatchlistSession,
  thresholds: AutoWatchlistSelectorThresholds,
): number {
  if (session === "premarket") return thresholds.minRecentDollarVolume15mPremarket;
  if (session === "postmarket") return thresholds.minRecentDollarVolume15mPostmarket;
  return thresholds.minRecentDollarVolume15mRegular;
}

function minimumSessionVolume(
  session: AutoWatchlistSession,
  thresholds: AutoWatchlistSelectorThresholds,
): number {
  return session === "postmarket"
    ? thresholds.minPostmarketVolume
    : thresholds.minVolume;
}

function minimumSessionDollarVolume(
  session: AutoWatchlistSession,
  thresholds: AutoWatchlistSelectorThresholds,
): number {
  return session === "postmarket"
    ? thresholds.minPostmarketDollarVolume
    : thresholds.minDollarVolume;
}

function sessionDollarVolumeScoreThresholds(
  session: AutoWatchlistSession,
  thresholds: AutoWatchlistSelectorThresholds,
): { minimum: number; strong: number; exceptional: number } {
  const minimum = minimumSessionDollarVolume(session, thresholds);
  if (session === "postmarket") {
    return {
      minimum,
      strong: minimum * 4,
      exceptional: minimum * 8,
    };
  }
  return {
    minimum,
    strong: 1_000_000,
    exceptional: 2_000_000,
  };
}

function compactDollarThreshold(value: number): string {
  if (value >= 1_000_000) {
    return `$${Number((value / 1_000_000).toFixed(2))}M`;
  }
  return `$${Math.round(value / 1_000)}K`;
}

function activityNeedsTradingHaltCheck(
  activity: AutoWatchlistSessionActivity | null | undefined,
  session: AutoWatchlistSession,
  thresholds: AutoWatchlistSelectorThresholds,
): boolean {
  if (!activity?.available) return true;
  return (
    (activity.quoteAgeMinutes ?? Number.POSITIVE_INFINITY) > thresholds.maxActivityQuoteAgeMinutes ||
    (activity.recent15mDollarVolume ?? 0) < minimumRecentDollarVolume(session, thresholds)
  );
}

function isRecentActivityRejection(reason: string): boolean {
  return (
    reason === "recent 15-minute activity data is unavailable" ||
    /^latest (premarket|regular|postmarket) trade is too old$/.test(reason) ||
    reason.startsWith("last 15m dollar volume must be at least ")
  );
}

export function buildAutoWatchlistRetentionProtection(input: {
  decision: Pick<
    AutoWatchlistCandidateDecision,
    | "score"
    | "rejectionReasons"
    | "tradingHaltState"
    | "tradingHaltReasonCode"
    | "recent15mDollarVolume"
    | "sessionDollarVolume"
    | "sessionVolume"
  >;
  entry: Pick<AutoWatchlistManagedEntry, "lastQualifiedAt">;
  thresholds: AutoWatchlistSelectorThresholds;
  now: number;
}): {
  protected: boolean;
  kind: "confirmed_halt" | "zero_volume_data_gap" | null;
  reason: string | null;
} {
  const activityOnlyFailure =
    input.decision.rejectionReasons.length > 0 &&
    input.decision.rejectionReasons.every(isRecentActivityRejection);
  if (!activityOnlyFailure || input.decision.score < input.thresholds.minimumScore) {
    return { protected: false, kind: null, reason: null };
  }
  if (input.decision.tradingHaltState === "halted") {
    const reasonCode = input.decision.tradingHaltReasonCode
      ? ` (${input.decision.tradingHaltReasonCode})`
      : "";
    return {
      protected: true,
      kind: "confirmed_halt",
      reason: `retained: Nasdaq Trader confirms an active trading halt${reasonCode}`,
    };
  }
  const lastQualifiedAt = input.entry.lastQualifiedAt;
  const graceMs = input.thresholds.zeroRecentVolumeRetentionGraceMinutes * 60_000;
  const strongPriorSession =
    (input.decision.sessionVolume ?? 0) >= input.thresholds.minVolume &&
    (input.decision.sessionDollarVolume ?? 0) >= Math.max(1_000_000, input.thresholds.minDollarVolume * 4);
  if (
    input.decision.recent15mDollarVolume === 0 &&
    strongPriorSession &&
    lastQualifiedAt !== null &&
    input.now - lastQualifiedAt <= graceMs
  ) {
    return {
      protected: true,
      kind: "zero_volume_data_gap",
      reason: `retained: exact zero recent volume treated as a data-gap/halt warning for up to ${input.thresholds.zeroRecentVolumeRetentionGraceMinutes} minutes`,
    };
  }
  return { protected: false, kind: null, reason: null };
}

function postmarketPromotionRejectionReasons(input: {
  qualified: boolean;
  session: AutoWatchlistSession;
  gainPct: number | null;
  recent15mDollarVolume: number | null;
  thresholds: AutoWatchlistSelectorThresholds;
}): string[] {
  if (!input.qualified || input.session !== "postmarket") return [];
  const reasons: string[] = [];
  if ((input.gainPct ?? 0) < input.thresholds.postmarketPromotionMinGainPct) {
    reasons.push(
      `post-market promotion gain must be at least ${input.thresholds.postmarketPromotionMinGainPct}%`,
    );
  }
  if ((input.recent15mDollarVolume ?? 0) < input.thresholds.postmarketPromotionMinRecentDollarVolume) {
    reasons.push(
      `post-market promotion last-15m dollar volume must be at least $${Math.round(input.thresholds.postmarketPromotionMinRecentDollarVolume / 1_000).toLocaleString("en-US")}K`,
    );
  }
  return reasons;
}

function elapsedSessionMinutes(timestamp: number, session: AutoWatchlistSession): number | null {
  const parts = easternParts(timestamp);
  const currentMinutes = parts.hour * 60 + parts.minute;
  const classification = classifyUsEquityMarketSession(timestamp);
  const startMinutes = classification.tradingDay
    ? usEquitySessionStartMinutes(session, classification.tradingDay)
    : null;
  return startMinutes === null ? null : Math.max(0, currentMinutes - startMinutes);
}

function newYorkUtcOffsetMs(timestamp: number): number {
  const parts = easternParts(timestamp);
  const localWallClockAsUtc = Date.parse(
    `${parts.date}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:00.000Z`,
  );
  const timestampAtMinute = Math.floor(timestamp / 60_000) * 60_000;
  return localWallClockAsUtc - timestampAtMinute;
}

export function normalizeNasdaqChartTimestamp(encodedTimestamp: number, referenceTimestamp: number): number {
  return encodedTimestamp - newYorkUtcOffsetMs(referenceTimestamp);
}

function calendarDayAge(referenceDate: string, publishedAt: string | null | undefined): number | null {
  if (!publishedAt) {
    return null;
  }
  const publishedTimestamp = Date.parse(publishedAt);
  const publishedDate = newYorkDateKeyForTimestamp(publishedTimestamp);
  const referenceTimestamp = Date.parse(`${referenceDate}T12:00:00.000Z`);
  const publishedDateTimestamp = publishedDate
    ? Date.parse(`${publishedDate}T12:00:00.000Z`)
    : Number.NaN;
  if (!Number.isFinite(referenceTimestamp) || !Number.isFinite(publishedDateTimestamp)) {
    return null;
  }
  return Math.max(0, Math.round((referenceTimestamp - publishedDateTimestamp) / 86_400_000));
}

function graduatedRankingBoost(args: {
  value: number | null | undefined;
  floor: number;
  fullScoreAt: number;
  maxBoost: number;
}): number {
  if (
    args.maxBoost <= 0 ||
    args.value === null ||
    args.value === undefined ||
    !Number.isFinite(args.value) ||
    args.value <= args.floor ||
    args.fullScoreAt <= args.floor
  ) {
    return 0;
  }
  const progress = Math.min(1, (args.value - args.floor) / (args.fullScoreAt - args.floor));
  return Math.round(progress * args.maxBoost * 100) / 100;
}

export function buildVolumeDecelerationRankPenalty(args: {
  volumeAcceleration: number | null | undefined;
  fullPenaltyAtRatio: number;
  maxPenalty: number;
}): number {
  if (
    args.maxPenalty <= 0 ||
    args.volumeAcceleration === null ||
    args.volumeAcceleration === undefined ||
    !Number.isFinite(args.volumeAcceleration) ||
    args.volumeAcceleration >= 1 ||
    args.fullPenaltyAtRatio <= 0 ||
    args.fullPenaltyAtRatio >= 1
  ) {
    return 0;
  }
  const progress = Math.min(
    1,
    (1 - Math.max(0, args.volumeAcceleration)) / (1 - args.fullPenaltyAtRatio),
  );
  return Math.round(progress * args.maxPenalty * 100) / 100;
}

function rankingFields(args: {
  context: PressReleaseCatalystContext;
  referenceDate: string;
  baseScore: number;
  session: AutoWatchlistSession;
  activity: AutoWatchlistSessionActivity | null;
  effectiveShares: number | null;
  dollarVolume: number;
  thresholds: AutoWatchlistSelectorThresholds;
}): Pick<
  AutoWatchlistCandidateDecision,
  | "rankingScore"
  | "catalystAgeDays"
  | "catalystTiming"
  | "catalystPublishedAt"
  | "catalystTitle"
  | "catalystRankBoost"
  | "recentDollarVolumeRankBoost"
  | "volumeAccelerationRankBoost"
  | "volumeDecelerationRankPenalty"
  | "shareTurnoverRankBoost"
  | "shareTurnoverPct"
  | "rankingReasons"
> {
  const article = args.context.primaryArticle;
  const catalystAgeDays = calendarDayAge(args.referenceDate, article?.publishedAt);
  const catalystCanAffectRanking =
    args.thresholds.catalystRankingEnabled &&
    catalystAgeDays !== null &&
    catalystAgeDays <= args.thresholds.catalystLookbackDays;
  const catalystRankBoost = catalystCanAffectRanking
    ? Math.max(
        0,
        args.thresholds.catalystSameDayRankBoost -
          catalystAgeDays * args.thresholds.catalystDailyRankDecay,
      )
    : 0;
  const requiredRecentDollarVolume = minimumRecentDollarVolume(args.session, args.thresholds);
  const recentDollarVolumeRankBoost = graduatedRankingBoost({
    value: args.activity?.recent15mDollarVolume,
    floor: requiredRecentDollarVolume,
    fullScoreAt: args.thresholds.recentDollarVolumeRankFullScore,
    maxBoost: args.thresholds.recentDollarVolumeRankMaxBoost,
  });
  const volumeAccelerationRankBoost = graduatedRankingBoost({
    value: args.activity?.volumeAcceleration,
    floor: 1,
    fullScoreAt: args.thresholds.volumeAccelerationRankFullScoreRatio,
    maxBoost: args.thresholds.volumeAccelerationRankMaxBoost,
  });
  const volumeDecelerationRankPenalty = buildVolumeDecelerationRankPenalty({
    volumeAcceleration: args.activity?.volumeAcceleration,
    fullPenaltyAtRatio: args.thresholds.volumeDecelerationRankFullPenaltyRatio,
    maxPenalty: args.thresholds.volumeDecelerationRankMaxPenalty,
  });
  const shareTurnoverPct = args.effectiveShares && args.activity?.sessionVolume
    ? (args.activity.sessionVolume / args.effectiveShares) * 100
    : null;
  const shareTurnoverRankBoost = graduatedRankingBoost({
    value: shareTurnoverPct,
    floor: 0,
    fullScoreAt: args.thresholds.shareTurnoverRankFullScorePct,
    maxBoost: args.thresholds.shareTurnoverRankMaxBoost,
  });
  const dollarVolumeThresholds = sessionDollarVolumeScoreThresholds(args.session, args.thresholds);
  const eligibilityDollarVolumePoints = args.dollarVolume >= dollarVolumeThresholds.exceptional
    ? 20
    : args.dollarVolume >= dollarVolumeThresholds.strong
      ? 15
      : args.dollarVolume >= dollarVolumeThresholds.minimum
        ? 8
        : 0;
  const supportingDollarVolumePoints = args.dollarVolume >= dollarVolumeThresholds.exceptional
    ? 10
    : args.dollarVolume >= dollarVolumeThresholds.strong
      ? 7
      : args.dollarVolume >= dollarVolumeThresholds.minimum
        ? 4
        : 0;
  const rankingBaseScore = args.baseScore - eligibilityDollarVolumePoints + supportingDollarVolumePoints;
  const rankingReasons: string[] = [];
  if (catalystRankBoost > 0) {
    rankingReasons.push(
      `${catalystAgeDays === 0 ? "same-day" : `${catalystAgeDays}-day-old`} catalyst +${catalystRankBoost} ranking points`,
    );
  }
  if (recentDollarVolumeRankBoost > 0) {
    rankingReasons.push(`recent 15-minute dollar volume +${recentDollarVolumeRankBoost} ranking points`);
  }
  if (volumeAccelerationRankBoost > 0) {
    rankingReasons.push(`volume acceleration +${volumeAccelerationRankBoost} ranking points`);
  }
  if (volumeDecelerationRankPenalty > 0) {
    rankingReasons.push(`volume deceleration -${volumeDecelerationRankPenalty} ranking points`);
  }
  if (shareTurnoverRankBoost > 0) {
    rankingReasons.push(`share turnover +${shareTurnoverRankBoost} ranking points`);
  }
  if (supportingDollarVolumePoints > 0) {
    rankingReasons.push(`cumulative dollar volume +${supportingDollarVolumePoints} supporting points`);
  }
  return {
    rankingScore: Math.max(0, Math.round((
      rankingBaseScore +
      catalystRankBoost +
      recentDollarVolumeRankBoost +
      volumeAccelerationRankBoost +
      shareTurnoverRankBoost -
      volumeDecelerationRankPenalty
    ) * 100) / 100),
    catalystAgeDays,
    catalystTiming: args.context.timing,
    catalystPublishedAt: article?.publishedAt ?? null,
    catalystTitle: article?.title ?? null,
    catalystRankBoost,
    recentDollarVolumeRankBoost,
    volumeAccelerationRankBoost,
    volumeDecelerationRankPenalty,
    shareTurnoverRankBoost,
    shareTurnoverPct,
    rankingReasons,
  };
}

export function buildAutoWatchlistSlotSurvivalScore(args: {
  rankingScore: number;
  gainPct: number | null;
}): { slotSurvivalScore: number; slotSurvivalReasons: string[] } {
  const gainFloorPct = 20;
  const fullGainCreditPct = 150;
  const maxContinuationBoost = 30;
  const gainPct = finiteNumber(args.gainPct);
  const continuationBoost = gainPct === null || gainPct <= gainFloorPct
    ? 0
    : Math.min(
        maxContinuationBoost,
        ((gainPct - gainFloorPct) / (fullGainCreditPct - gainFloorPct)) * maxContinuationBoost,
      );
  return {
    slotSurvivalScore: Math.round((args.rankingScore + continuationBoost) * 100) / 100,
    slotSurvivalReasons: continuationBoost > 0
      ? [`sustained runner gain +${continuationBoost.toFixed(1)} slot points`]
      : [],
  };
}

export function isWithinAutoWatchlistScanWindow(
  timestamp: number,
  thresholds: AutoWatchlistSelectorThresholds,
): boolean {
  const classification = classifyUsEquityMarketSession(timestamp);
  if (!classification.tradingDay?.isTradingDay) return false;
  const parts = easternParts(timestamp);
  const currentMinutes = parts.hour * 60 + parts.minute;
  const startMinutes = thresholds.scanStartHourEastern * 60;
  const endMinutes = thresholds.scanEndHourEastern * 60 + thresholds.scanEndMinuteEastern;
  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

export function scoreAutoWatchlistCandidate(input: {
  candidate: AutoWatchlistDiscoveryCandidate;
  floatShares?: number | null;
  finnhubFloatShares?: number | null;
  yahooSharesOutstanding?: number | null;
  finnhubSharesOutstanding?: number | null;
  thresholds?: Partial<AutoWatchlistSelectorThresholds>;
  session?: AutoWatchlistSession;
  activity?: AutoWatchlistSessionActivity | null;
}): Omit<
  AutoWatchlistCandidateDecision,
  | "promotionReady"
  | "promotionRejectionReasons"
  | "consecutivePasses"
  | "rankingScore"
  | "catalystAgeDays"
  | "catalystTiming"
  | "catalystPublishedAt"
  | "catalystTitle"
  | "catalystRankBoost"
  | "recentDollarVolumeRankBoost"
  | "volumeAccelerationRankBoost"
  | "volumeDecelerationRankPenalty"
  | "shareTurnoverRankBoost"
  | "shareTurnoverPct"
  | "rankingReasons"
  | "slotSurvivalScore"
  | "slotSurvivalReasons"
  | "tradingHaltState"
  | "tradingHaltReasonCode"
  | "haltRetentionProtected"
  | "haltRetentionProtectionReason"
  | "session"
  | "sessionVolume"
  | "mainSessionVolume"
  | "sessionDollarVolume"
  | "recent15mVolume"
  | "recent15mDollarVolume"
  | "sessionElapsedMinutes"
  | "mainSessionElapsedMinutes"
  | "volumeAcceleration"
  | "activityQuoteAgeMinutes"
  | "activityDataAvailable"
> {
  const thresholds = resolveAutoWatchlistSelectorThresholds(input.thresholds);
  const candidate = input.candidate;
  const yahooFloatShares = finitePositive(input.floatShares);
  const finnhubFloatShares = finitePositive(input.finnhubFloatShares);
  const floatShares = yahooFloatShares ?? finnhubFloatShares;
  const yahooOutstanding = finitePositive(input.yahooSharesOutstanding);
  const finnhubOutstanding = finitePositive(input.finnhubSharesOutstanding);
  const sharesOutstanding = yahooOutstanding ?? finnhubOutstanding;
  const effectiveShares = floatShares ?? sharesOutstanding;
  const effectiveSharesSource = yahooFloatShares
    ? "yahoo_float" as const
    : finnhubFloatShares
      ? "finnhub_float" as const
      : yahooOutstanding
        ? "yahoo_outstanding" as const
        : finnhubOutstanding
          ? "finnhub_outstanding" as const
          : null;
  const rejectionReasons: string[] = [];
  const reasons: string[] = [];
  let score = 0;
  const session = input.session ?? "regular";
  const activity = input.activity ?? null;
  const requiredRecentDollarVolume = minimumRecentDollarVolume(session, thresholds);
  const requiredSessionVolume = minimumSessionVolume(session, thresholds);
  const dollarVolumeThresholds = sessionDollarVolumeScoreThresholds(session, thresholds);
  const floatDollarValue = floatShares && candidate.price
    ? floatShares * candidate.price
    : null;
  const lowPriceFloatNormalized = Boolean(
    thresholds.lowPriceFloatNormalizationEnabled &&
    floatShares &&
    candidate.price &&
    candidate.price <= thresholds.lowPriceFloatNormalizationMaxPrice &&
    floatShares > thresholds.maxFloatShares &&
    floatDollarValue !== null &&
    floatDollarValue <= thresholds.lowPriceFloatNormalizationMaxDollarValue,
  );

  if (input.session && session === "closed") {
    rejectionReasons.push("the market session is closed");
  } else if (input.session && !isAutoWatchlistSessionEnabled(session, thresholds)) {
    rejectionReasons.push(`${session} automatic selection is disabled`);
  }
  if (input.session && !activity?.available) {
    if (thresholds.requireRecentActivityData) {
      rejectionReasons.push("recent 15-minute activity data is unavailable");
    }
  } else if (input.session && activity) {
    if ((activity.quoteAgeMinutes ?? Number.POSITIVE_INFINITY) > thresholds.maxActivityQuoteAgeMinutes) {
      rejectionReasons.push(`latest ${session} trade is too old`);
    }
    if ((activity.recent15mDollarVolume ?? 0) < requiredRecentDollarVolume) {
      rejectionReasons.push(
        `last 15m dollar volume must be at least $${Math.round(requiredRecentDollarVolume / 1_000).toLocaleString("en-US")}K`,
      );
    }
  }

  if (!candidate.price || candidate.price < thresholds.minPrice || candidate.price > thresholds.maxPrice) {
    rejectionReasons.push(`price must be $${thresholds.minPrice}-$${thresholds.maxPrice}`);
  }
  if (!candidate.marketCap || candidate.marketCap > thresholds.maxMarketCap) {
    rejectionReasons.push(`market cap must be known and at most $${Math.round(thresholds.maxMarketCap / 1_000_000)}M`);
  }
  if (candidate.securityMasterStatus && candidate.securityMasterStatus !== "verified_common_stock") {
    rejectionReasons.push(
      candidate.securityMasterStatus === "unavailable"
        ? "authoritative common-equity verification is unavailable"
        : "authoritative security master did not verify common stock",
    );
  }
  if (!candidate.gainPct || candidate.gainPct < thresholds.minGainPct) {
    rejectionReasons.push(`gain must be at least ${thresholds.minGainPct}%`);
  }
  if (!candidate.volume || candidate.volume < requiredSessionVolume) {
    rejectionReasons.push(
      `${session === "postmarket" ? "post-market volume" : "volume"} must be at least ${requiredSessionVolume.toLocaleString("en-US")}`,
    );
  }
  const dollarVolume = finitePositive(activity?.sessionDollarVolume) ??
    (candidate.price && candidate.volume ? candidate.price * candidate.volume : 0);
  if (dollarVolume < dollarVolumeThresholds.minimum) {
    rejectionReasons.push(
      `${session === "postmarket" ? "post-market dollar volume" : "dollar volume"} must be at least ${compactDollarThreshold(dollarVolumeThresholds.minimum)}`,
    );
  }
  if (!effectiveShares && thresholds.requireShareData) {
    rejectionReasons.push("float or shares outstanding must be available");
  } else if (floatShares && floatShares > thresholds.maxFloatShares && !lowPriceFloatNormalized) {
    if (
      thresholds.lowPriceFloatNormalizationEnabled &&
      candidate.price &&
      candidate.price <= thresholds.lowPriceFloatNormalizationMaxPrice &&
      floatDollarValue !== null
    ) {
      rejectionReasons.push(
        `float must be at most ${Math.round(thresholds.maxFloatShares / 1_000_000)}M shares or have at most $${Math.round(thresholds.lowPriceFloatNormalizationMaxDollarValue / 1_000_000)}M low-price dollar float`,
      );
    } else {
      rejectionReasons.push(`float must be at most ${Math.round(thresholds.maxFloatShares / 1_000_000)}M shares`);
    }
  } else if (!floatShares && sharesOutstanding && sharesOutstanding > thresholds.maxSharesOutstanding) {
    rejectionReasons.push(`shares outstanding must be at most ${Math.round(thresholds.maxSharesOutstanding / 1_000_000)}M`);
  }

  if ((candidate.gainPct ?? 0) >= 20) {
    score += 25;
    reasons.push("20%+ gain");
  } else if ((candidate.gainPct ?? 0) >= 10) {
    score += 18;
    reasons.push("10%+ gain");
  } else if ((candidate.gainPct ?? 0) >= thresholds.minGainPct) {
    score += 10;
    reasons.push(`${thresholds.minGainPct}%+ gain`);
  }

  if (isTopGainerCandidate(candidate) && thresholds.topGainerQualificationScoreBoost > 0) {
    score += thresholds.topGainerQualificationScoreBoost;
    reasons.push(`top-gainers list +${thresholds.topGainerQualificationScoreBoost} qualification points`);
  }

  if (dollarVolume >= dollarVolumeThresholds.exceptional) {
    score += 20;
    reasons.push(`${compactDollarThreshold(dollarVolumeThresholds.exceptional)}+ dollar volume`);
  } else if (dollarVolume >= dollarVolumeThresholds.strong) {
    score += 15;
    reasons.push(`${compactDollarThreshold(dollarVolumeThresholds.strong)}+ dollar volume`);
  } else if (dollarVolume >= dollarVolumeThresholds.minimum) {
    score += 8;
    reasons.push("minimum dollar volume met");
  }

  const relativeVolume = session !== "postmarket" && candidate.volume && candidate.averageVolume
    ? candidate.volume / candidate.averageVolume
    : 0;
  if (relativeVolume >= 3) {
    score += 15;
    reasons.push("3x+ volume pace");
  } else if (relativeVolume >= 1.5) {
    score += 10;
    reasons.push("1.5x+ volume pace");
  } else if (relativeVolume >= 0.75) {
    score += 5;
    reasons.push("active volume pace");
  }

  if (floatShares) {
    if (floatShares <= 5_000_000) {
      score += 25;
      reasons.push("float at or below 5M");
    } else if (floatShares <= 10_000_000) {
      score += 22;
      reasons.push("float at or below 10M");
    } else if (floatShares <= 20_000_000) {
      score += 17;
      reasons.push("float at or below 20M");
    } else if (floatShares <= thresholds.maxFloatShares) {
      score += 10;
      reasons.push(`float at or below ${Math.round(thresholds.maxFloatShares / 1_000_000)}M`);
    } else if (lowPriceFloatNormalized && floatDollarValue !== null) {
      score += 5;
      reasons.push(
        `$${(floatDollarValue / 1_000_000).toFixed(1)}M dollar float meets the low-price limit`,
      );
    }
  } else if (sharesOutstanding) {
    if (sharesOutstanding <= 10_000_000) {
      score += 15;
      reasons.push("outstanding shares at or below 10M");
    } else if (sharesOutstanding <= 25_000_000) {
      score += 10;
      reasons.push("outstanding shares at or below 25M");
    } else if (sharesOutstanding <= thresholds.maxSharesOutstanding) {
      score += 5;
      reasons.push(`outstanding shares at or below ${Math.round(thresholds.maxSharesOutstanding / 1_000_000)}M`);
    }
  }

  if ((candidate.marketCap ?? Number.POSITIVE_INFINITY) <= 25_000_000) {
    score += 10;
    reasons.push("market cap at or below $25M");
  } else if ((candidate.marketCap ?? Number.POSITIVE_INFINITY) <= 50_000_000) {
    score += 8;
    reasons.push("market cap at or below $50M");
  } else if ((candidate.marketCap ?? Number.POSITIVE_INFINITY) <= thresholds.maxMarketCap) {
    score += 5;
    reasons.push(`market cap at or below $${Math.round(thresholds.maxMarketCap / 1_000_000)}M`);
  }

  if (score < thresholds.minimumScore) {
    rejectionReasons.push(`score ${score} is below ${thresholds.minimumScore}`);
  }

  return {
    ...candidate,
    score,
    qualified: rejectionReasons.length === 0,
    floatShares,
    sharesOutstanding,
    effectiveShares,
    effectiveSharesSource,
    floatDollarValue,
    lowPriceFloatNormalized,
    reasons,
    rejectionReasons,
  };
}

export function compareAutoWatchlistDecisions(
  left: AutoWatchlistCandidateDecision,
  right: AutoWatchlistCandidateDecision,
): number {
  return Number(right.qualified) - Number(left.qualified) ||
    right.rankingScore - left.rankingScore ||
    (right.recent15mDollarVolume ?? 0) - (left.recent15mDollarVolume ?? 0) ||
    (right.gainPct ?? 0) - (left.gainPct ?? 0) ||
    (right.shareTurnoverPct ?? 0) - (left.shareTurnoverPct ?? 0) ||
    left.symbol.localeCompare(right.symbol);
}

function autoWatchlistBucketForSession(session: AutoWatchlistSession): AutoWatchlistBucket {
  return session === "postmarket" ? "postmarket" : "main";
}

function isAutoWatchlistSession(value: unknown): value is AutoWatchlistSession {
  return value === "premarket" || value === "regular" || value === "postmarket" || value === "closed";
}

function admissionSnapshotFromNote(note: string | undefined): {
  qualificationScore: number;
  rankingScore: number;
  slotSurvivalScore: number;
} | null {
  const match = /qualification score\s+([+-]?\d+(?:\.\d+)?)\s*;\s*(?:admission rank|rank)\s+([+-]?\d+(?:\.\d+)?)/i.exec(
    note ?? "",
  );
  if (!match) return null;
  const qualificationScore = finiteNumber(Number(match[1]));
  const rankingScore = finiteNumber(Number(match[2]));
  if (qualificationScore === null || rankingScore === null) return null;
  const slotMatch = /(?:current|admission) slot(?: score)?\s+([+-]?\d+(?:\.\d+)?)/i.exec(note ?? "");
  return {
    qualificationScore,
    rankingScore,
    slotSurvivalScore: finiteNumber(Number(slotMatch?.[1])) ?? rankingScore,
  };
}

function normalizeManagedEntry(value: unknown): AutoWatchlistManagedEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AutoWatchlistManagedEntry>;
  const symbol = normalizeSymbol(candidate.symbol);
  if (
    !symbol ||
    (candidate.bucket !== "main" && candidate.bucket !== "postmarket") ||
    (candidate.state !== "active" && candidate.state !== "followup" && candidate.state !== "standby") ||
    !isAutoWatchlistSession(candidate.addedSession) ||
    !isAutoWatchlistSession(candidate.lastSession)
  ) {
    return null;
  }
  const firstAddedAt = finiteNumber(candidate.firstAddedAt) ?? 0;
  const lastActivatedAt = finiteNumber(candidate.lastActivatedAt) ?? firstAddedAt;
  return {
    symbol,
    bucket: candidate.bucket,
    state: candidate.state,
    firstAddedAt,
    lastActivatedAt,
    addedSession: candidate.addedSession,
    lastSession: candidate.lastSession,
    lastRankingScore: finiteNumber(candidate.lastRankingScore) ?? 0,
    lastSlotSurvivalScore:
      finiteNumber(candidate.lastSlotSurvivalScore) ?? finiteNumber(candidate.lastRankingScore) ?? 0,
    admissionAt: finiteNumber(candidate.admissionAt),
    admissionQualificationScore: finiteNumber(candidate.admissionQualificationScore),
    admissionRankingScore: finiteNumber(candidate.admissionRankingScore),
    admissionSlotSurvivalScore: finiteNumber(candidate.admissionSlotSurvivalScore),
    lastQualifiedAt: finiteNumber(candidate.lastQualifiedAt),
    holdProtectionEarnedAt: finiteNumber(candidate.holdProtectionEarnedAt),
    holdProtectionReason:
      typeof candidate.holdProtectionReason === "string" ? candidate.holdProtectionReason : null,
    reversalWatchQualifiedAt: finiteNumber(candidate.reversalWatchQualifiedAt),
    reversalWatchQualificationReason:
      typeof candidate.reversalWatchQualificationReason === "string"
        ? candidate.reversalWatchQualificationReason
        : null,
    reversalWatchLowPrice: finitePositive(candidate.reversalWatchLowPrice),
    reversalWatchLowAt: finiteNumber(candidate.reversalWatchLowAt),
    reversalAttemptEvidenceScans: Math.max(
      0,
      Math.floor(finiteNumber(candidate.reversalAttemptEvidenceScans) ?? 0),
    ),
    reversalWatchAttemptReady: candidate.reversalWatchAttemptReady === true,
    peakGainPct: finiteNumber(candidate.peakGainPct),
    peakGainAt: finiteNumber(candidate.peakGainAt),
    lastObservedGainPct: finiteNumber(candidate.lastObservedGainPct),
    lastObservedAt: finiteNumber(candidate.lastObservedAt),
    topFiveGainerFirstObservedAt: finiteNumber(candidate.topFiveGainerFirstObservedAt),
    topFiveGainerLastObservedAt: finiteNumber(candidate.topFiveGainerLastObservedAt),
    topFiveGainerObservationCount: Math.max(
      0,
      Math.floor(finiteNumber(candidate.topFiveGainerObservationCount) ?? 0),
    ),
    topFiveGainerConsecutiveObservations: Math.max(
      0,
      Math.floor(finiteNumber(candidate.topFiveGainerConsecutiveObservations) ?? 0),
    ),
    retentionFailures: Math.max(0, Math.floor(finiteNumber(candidate.retentionFailures) ?? 0)),
    followupAt: finiteNumber(candidate.followupAt),
    vacatedSlotAt: finiteNumber(candidate.vacatedSlotAt),
    standbyAt: finiteNumber(candidate.standbyAt),
    statusReason: typeof candidate.statusReason === "string" ? candidate.statusReason : "restored",
  };
}

function normalizeFirstPassEvidence(value: unknown): AutoWatchlistFirstPassEvidence | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AutoWatchlistFirstPassEvidence>;
  const symbol = normalizeSymbol(candidate.symbol);
  const observedAt = finiteNumber(candidate.observedAt);
  const rankingScore = finiteNumber(candidate.rankingScore);
  const slotSurvivalScore = finiteNumber(candidate.slotSurvivalScore);
  if (
    !symbol ||
    observedAt === null ||
    rankingScore === null ||
    slotSurvivalScore === null ||
    !isAutoWatchlistSession(candidate.session)
  ) {
    return null;
  }
  return {
    symbol,
    observedAt,
    session: candidate.session,
    rankingScore,
    slotSurvivalScore,
    gainPct: finiteNumber(candidate.gainPct),
    recent15mDollarVolume: finiteNumber(candidate.recent15mDollarVolume),
    volumeAcceleration: finiteNumber(candidate.volumeAcceleration),
    shareTurnoverPct: finiteNumber(candidate.shareTurnoverPct),
    sourceScreens: Array.isArray(candidate.sourceScreens)
      ? candidate.sourceScreens.filter((source): source is string => typeof source === "string")
      : [],
  };
}

function normalizeConsecutivePassEvidence(
  value: unknown,
): AutoWatchlistConsecutivePassEvidence | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AutoWatchlistConsecutivePassEvidence>;
  const symbol = normalizeSymbol(candidate.symbol);
  const count = finiteNumber(candidate.count);
  const observedAt = finiteNumber(candidate.observedAt);
  if (
    !symbol ||
    count === null ||
    count < 1 ||
    !Number.isInteger(count) ||
    observedAt === null ||
    !isAutoWatchlistSession(candidate.session)
  ) {
    return null;
  }
  return { symbol, count, session: candidate.session, observedAt };
}

function isReplacementEvent(value: unknown): value is AutoWatchlistReplacementEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AutoWatchlistReplacementEvent>;
  return (
    finiteNumber(candidate.timestamp) !== null &&
    (candidate.bucket === "main" || candidate.bucket === "postmarket") &&
    typeof candidate.outgoingSymbol === "string" &&
    (candidate.incomingSymbol === null || typeof candidate.incomingSymbol === "string") &&
    typeof candidate.reason === "string" &&
    (
      candidate.exceptionKind === undefined ||
      candidate.exceptionKind === "postmarket_extreme_runner"
    )
  );
}

export class AutoWatchlistSelector {
  private readonly fetchImpl: FetchLike;
  private readonly catalystLookup: typeof lookupLocalPressReleaseCatalystArticles;
  private readonly sessionActivityLookup: AutoWatchlistSessionActivityLookup;
  private readonly tradingHaltLookup: NasdaqTradingHaltLookup;
  private readonly securityMasterLookup: CommonEquitySecurityMasterLookup;
  private readonly requireVerifiedCommonEquity: boolean;
  private readonly configPath: string;
  private thresholds: AutoWatchlistSelectorThresholds;
  private readonly now: () => number;
  private enabled = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private lastScanAt: number | null = null;
  private lastScanCompletedAt: number | null = null;
  private lastScanCandidateCount = 0;
  private lastEvaluatedCount = 0;
  private lastQualifiedCount = 0;
  private lastAddedSymbols: string[] = [];
  private lastActivationErrors: Array<{ symbol: string; error: string }> = [];
  private lastError: string | null = null;
  private lastDiscoverySources: string[] = [];
  private lastDiscoveryError: string | null = null;
  private lastDiscoveryFeedComparison: AutoWatchlistDiscoveryFeedComparison | null = null;
  private liveExchangeDiscoveryAvailable = false;
  private yahooDiscoveryAvailable = true;
  private lastCatalystLookupError: string | null = null;
  private pressReleaseCatalystAvailable = false;
  private sessionActivityAvailable = false;
  private lastActivityLookupError: string | null = null;
  private tradingHaltFeedAvailable = false;
  private lastTradingHaltLookupError: string | null = null;
  private commonEquitySecurityMasterAvailable = false;
  private commonEquitySecurityMasterCheckedAt: number | null = null;
  private commonEquitySecurityMasterCacheUsed: boolean | null = null;
  private lastSecurityMasterError: string | null = null;
  private tradingDay: string | null = null;
  private readonly mainSessionAddedToday = new Set<string>();
  private readonly postmarketAddedToday = new Set<string>();
  private lateMainSessionAdmissionReserveUsed = 0;
  private readonly managedEntries = new Map<string, AutoWatchlistManagedEntry>();
  private readonly firstPassEvidence = new Map<string, AutoWatchlistFirstPassEvidence>();
  private replacementHistory: AutoWatchlistReplacementEvent[] = [];
  private recentDecisions: AutoWatchlistCandidateDecision[] = [];
  private consecutivePasses = new Map<string, number>();
  private consecutivePassSessions = new Map<string, AutoWatchlistSession>();
  private consecutivePassObservedAt = new Map<string, number>();
  private prefetchedActivityBySymbol = new Map<string, AutoWatchlistSessionActivity>();
  private extendedSessionExplorationCursor = 0;
  private scanPromise: Promise<void> | null = null;
  private activeSlotReconciliationPromise: Promise<void> | null = null;

  constructor(private readonly options: AutoWatchlistSelectorOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.catalystLookup = options.catalystLookup ?? lookupLocalPressReleaseCatalystArticles;
    this.sessionActivityLookup = options.sessionActivityLookup ?? ((input) => this.fetchNasdaqSessionActivities(input));
    this.tradingHaltLookup = options.tradingHaltLookup ?? (() => {
      const service = new NasdaqTradingHaltService({ fetchImpl: this.fetchImpl });
      return service.lookup.bind(service);
    })();
    this.configPath = options.configPath ?? join(process.cwd(), "artifacts", "auto-watchlist-selector-config.json");
    const persistedConfig = this.loadConfig();
    this.thresholds = resolveAutoWatchlistSelectorThresholds({
      ...persistedConfig?.thresholds,
      ...options.thresholds,
    });
    this.now = options.now ?? Date.now;
    this.requireVerifiedCommonEquity = options.requireVerifiedCommonEquity ?? Boolean(
      process.env.EODHD_API_TOKEN?.trim() || process.env.LEVEL_EODHD_API_TOKEN?.trim(),
    );
    this.securityMasterLookup = options.securityMasterLookup ?? (() => {
      const master = new EodhdCommonStockSecurityMaster({
        cachePath: join(dirname(this.configPath), "eodhd-common-stock-security-master.json"),
        fetchImpl: this.fetchImpl,
        now: this.now,
      });
      return master.verifySymbols.bind(master);
    })();
    this.enabled = persistedConfig?.enabled ?? false;
    this.tradingDay = persistedConfig?.tradingDay ?? null;
    for (const symbol of persistedConfig?.mainSessionAddedToday ?? persistedConfig?.addedToday ?? []) {
      const normalized = normalizeSymbol(symbol);
      if (normalized) {
        this.mainSessionAddedToday.add(normalized);
      }
    }
    for (const symbol of persistedConfig?.postmarketAddedToday ?? []) {
      const normalized = normalizeSymbol(symbol);
      if (normalized) {
        this.postmarketAddedToday.add(normalized);
      }
    }
    this.lateMainSessionAdmissionReserveUsed = Math.min(
      persistedConfig?.lateMainSessionAdmissionReserveUsed ?? 0,
      this.thresholds.lateMainSessionAdmissionReserve,
    );
    for (const entry of persistedConfig?.managedEntries ?? []) {
      const normalized = normalizeManagedEntry(entry);
      if (normalized) {
        this.managedEntries.set(normalized.symbol, normalized);
      }
    }
    for (const evidence of persistedConfig?.firstPassEvidence ?? []) {
      const normalized = normalizeFirstPassEvidence(evidence);
      if (normalized) {
        this.firstPassEvidence.set(normalized.symbol, normalized);
      }
    }
    for (const evidence of persistedConfig?.consecutivePassEvidence ?? []) {
      const normalized = normalizeConsecutivePassEvidence(evidence);
      if (normalized) {
        this.consecutivePasses.set(normalized.symbol, normalized.count);
        this.consecutivePassSessions.set(normalized.symbol, normalized.session);
        this.consecutivePassObservedAt.set(normalized.symbol, normalized.observedAt);
      }
    }
    this.replacementHistory = (persistedConfig?.replacementHistory ?? [])
      .filter(isReplacementEvent)
      .slice(-50);
  }

  private loadConfig(): PersistedConfig | null {
    try {
      const parsed = JSON.parse(readFileSync(this.configPath, "utf8")) as Partial<PersistedConfig>;
      if (parsed.version !== CONFIG_VERSION || typeof parsed.enabled !== "boolean") {
        return null;
      }
      return {
        version: CONFIG_VERSION,
        enabled: parsed.enabled,
        lastUpdated: finiteNumber(parsed.lastUpdated) ?? 0,
        thresholds:
          typeof parsed.thresholds === "object" && parsed.thresholds !== null
            ? parsed.thresholds
            : undefined,
        tradingDay:
          typeof parsed.tradingDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.tradingDay)
            ? parsed.tradingDay
            : null,
        addedToday: Array.isArray(parsed.addedToday)
          ? parsed.addedToday.filter((symbol): symbol is string => typeof symbol === "string")
          : [],
        mainSessionAddedToday: Array.isArray(parsed.mainSessionAddedToday)
          ? parsed.mainSessionAddedToday.filter((symbol): symbol is string => typeof symbol === "string")
          : undefined,
        postmarketAddedToday: Array.isArray(parsed.postmarketAddedToday)
          ? parsed.postmarketAddedToday.filter((symbol): symbol is string => typeof symbol === "string")
          : [],
        lateMainSessionAdmissionReserveUsed: Math.max(
          0,
          Math.floor(finiteNumber(parsed.lateMainSessionAdmissionReserveUsed) ?? 0),
        ),
        managedEntries: Array.isArray(parsed.managedEntries)
          ? parsed.managedEntries.map(normalizeManagedEntry).filter((entry): entry is AutoWatchlistManagedEntry => entry !== null)
          : [],
        firstPassEvidence: Array.isArray(parsed.firstPassEvidence)
          ? parsed.firstPassEvidence
              .map(normalizeFirstPassEvidence)
              .filter((entry): entry is AutoWatchlistFirstPassEvidence => entry !== null)
          : [],
        consecutivePassEvidence: Array.isArray(parsed.consecutivePassEvidence)
          ? parsed.consecutivePassEvidence
              .map(normalizeConsecutivePassEvidence)
              .filter((entry): entry is AutoWatchlistConsecutivePassEvidence => entry !== null)
          : [],
        replacementHistory: Array.isArray(parsed.replacementHistory)
          ? parsed.replacementHistory.filter(isReplacementEvent)
          : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[AutoWatchlistSelector] Failed to load config: ${message}`);
      }
      return null;
    }
  }

  private persistConfig(): void {
    const tempPath = `${this.configPath}.tmp`;
    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(tempPath, `${JSON.stringify({
      version: CONFIG_VERSION,
      enabled: this.enabled,
      lastUpdated: this.now(),
      thresholds: this.thresholds,
      tradingDay: this.tradingDay,
      addedToday: [...this.mainSessionAddedToday, ...this.postmarketAddedToday],
      mainSessionAddedToday: [...this.mainSessionAddedToday],
      postmarketAddedToday: [...this.postmarketAddedToday],
      lateMainSessionAdmissionReserveUsed: this.lateMainSessionAdmissionReserveUsed,
      managedEntries: [...this.managedEntries.values()],
      firstPassEvidence: [...this.firstPassEvidence.values()]
        .sort((left, right) => left.observedAt - right.observedAt)
        .slice(-100),
      consecutivePassEvidence: [...this.consecutivePasses.entries()]
        .map(([symbol, count]) => ({
          symbol,
          count,
          session: this.consecutivePassSessions.get(symbol),
          observedAt: this.consecutivePassObservedAt.get(symbol),
        }))
        .filter((entry): entry is AutoWatchlistConsecutivePassEvidence =>
          entry.count > 0 &&
          isAutoWatchlistSession(entry.session) &&
          typeof entry.observedAt === "number" &&
          Number.isFinite(entry.observedAt),
        )
        .sort((left, right) => left.observedAt - right.observedAt)
        .slice(-100),
      replacementHistory: this.replacementHistory.slice(-50),
    }, null, 2)}\n`, "utf8");
    renameSync(tempPath, this.configPath);
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.syncManagedEntriesFromRuntime(
      autoWatchlistSessionForTimestamp(this.now()),
      this.now(),
    );
    this.persistConfig();
    this.timer = setInterval(() => {
      void this.runScheduledScan();
    }, this.thresholds.scanIntervalMs);
    if (this.enabled) {
      void this.runImmediateEnabledScan();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async setEnabled(enabled: boolean): Promise<AutoWatchlistSelectorStatus> {
    this.enabled = enabled;
    this.persistConfig();
    if (!enabled) {
      this.consecutivePasses.clear();
      this.consecutivePassSessions.clear();
    } else {
      await this.runImmediateEnabledScan();
    }
    return this.getStatus();
  }

  async updateConfiguration(input: {
    enabled?: boolean;
    thresholds?: Partial<AutoWatchlistSelectorThresholds>;
  }): Promise<AutoWatchlistSelectorStatus> {
    const priorInterval = this.thresholds.scanIntervalMs;
    const priorMainActiveLimit = this.thresholds.maxActiveMainSessionTickers;
    const priorPostmarketActiveLimit = this.thresholds.maxActivePostmarketTickers;
    if (input.thresholds) {
      this.thresholds = resolveAutoWatchlistSelectorThresholds({
        ...this.thresholds,
        ...input.thresholds,
      });
    }
    if (typeof input.enabled === "boolean") {
      this.enabled = input.enabled;
      if (!input.enabled) {
        this.consecutivePasses.clear();
        this.consecutivePassSessions.clear();
      }
    }
    this.persistConfig();
    if (this.timer && this.thresholds.scanIntervalMs !== priorInterval) {
      this.stop();
      this.start();
    }
    if (input.enabled === true) {
      await this.runImmediateEnabledScan();
    } else if (
      this.enabled &&
      (
        this.thresholds.maxActiveMainSessionTickers < priorMainActiveLimit ||
        this.thresholds.maxActivePostmarketTickers < priorPostmarketActiveLimit
      )
    ) {
      this.queueActiveSlotLimitReconciliation();
    }
    return this.getStatus();
  }

  getStatus(): AutoWatchlistSelectorStatus {
    return {
      enabled: this.enabled,
      running: this.running,
      configPath: this.configPath,
      thresholds: { ...this.thresholds },
      providerStatus: {
        liveExchangeDiscoveryAvailable: this.liveExchangeDiscoveryAvailable,
        yahooDiscoveryAvailable: this.yahooDiscoveryAvailable,
        yahooFloatAvailable: this.options.yahooClient !== null,
        finnhubOutstandingAvailable: this.options.finnhubClient !== null,
        pressReleaseCatalystAvailable: this.pressReleaseCatalystAvailable,
        sessionActivityAvailable: this.sessionActivityAvailable,
        tradingHaltFeedAvailable: this.tradingHaltFeedAvailable,
        commonEquitySecurityMasterEnabled: this.requireVerifiedCommonEquity,
        commonEquitySecurityMasterAvailable: this.commonEquitySecurityMasterAvailable,
        commonEquitySecurityMasterCheckedAt: this.commonEquitySecurityMasterCheckedAt,
        commonEquitySecurityMasterCacheUsed: this.commonEquitySecurityMasterCacheUsed,
      },
      lastScanAt: this.lastScanAt,
      lastScanCompletedAt: this.lastScanCompletedAt,
      lastScanCandidateCount: this.lastScanCandidateCount,
      lastEvaluatedCount: this.lastEvaluatedCount,
      lastQualifiedCount: this.lastQualifiedCount,
      lastAddedSymbols: [...this.lastAddedSymbols],
      lastActivationErrors: this.lastActivationErrors.map((entry) => ({ ...entry })),
      lastError: this.lastError,
      lastDiscoverySources: [...this.lastDiscoverySources],
      lastDiscoveryError: this.lastDiscoveryError,
      discoveryFeedComparison: this.lastDiscoveryFeedComparison
        ? {
            ...this.lastDiscoveryFeedComparison,
            overlapSymbols: [...this.lastDiscoveryFeedComparison.overlapSymbols],
            nasdaq: {
              ...this.lastDiscoveryFeedComparison.nasdaq,
              leaderSymbols: [...this.lastDiscoveryFeedComparison.nasdaq.leaderSymbols],
              currentSessionMatches: [...this.lastDiscoveryFeedComparison.nasdaq.currentSessionMatches],
            },
            stockAnalysis: {
              ...this.lastDiscoveryFeedComparison.stockAnalysis,
              leaderSymbols: [...this.lastDiscoveryFeedComparison.stockAnalysis.leaderSymbols],
              currentSessionMatches: [...this.lastDiscoveryFeedComparison.stockAnalysis.currentSessionMatches],
            },
          }
        : null,
      lastCatalystLookupError: this.lastCatalystLookupError,
      lastActivityLookupError: this.lastActivityLookupError,
      lastTradingHaltLookupError: this.lastTradingHaltLookupError,
      lastSecurityMasterError: this.lastSecurityMasterError,
      tradingDay: this.tradingDay,
      addedToday: [...this.mainSessionAddedToday, ...this.postmarketAddedToday],
      mainSessionAddedToday: [...this.mainSessionAddedToday],
      postmarketAddedToday: [...this.postmarketAddedToday],
      lateMainSessionAdmissionReserveUsed: this.lateMainSessionAdmissionReserveUsed,
      lateMainSessionAdmissionReserveAvailable: Math.max(
        0,
        this.thresholds.lateMainSessionAdmissionReserve - this.lateMainSessionAdmissionReserveUsed,
      ),
      lateMainSessionAdmissionReserveUnlocked: this.isLateMainSessionAdmissionReserveUnlocked(
        "main",
        this.now(),
      ),
      postmarketExtremeRunnerOverridesUsed: this.postmarketExtremeRunnerOverrideCount(),
      postmarketExtremeRunnerOverridesAvailable: Math.max(
        0,
        this.thresholds.maxPostmarketExtremeRunnerOverridesPerTradingDay -
          this.postmarketExtremeRunnerOverrideCount(),
      ),
      activeMainSessionSymbols: this.managedEntriesFor("main", "active").map((entry) => entry.symbol),
      activePostmarketSymbols: this.managedEntriesFor("postmarket", "active").map((entry) => entry.symbol),
      followupSymbols: this.managedEntriesFor(undefined, "followup").map((entry) => entry.symbol),
      pendingReplacementSymbols: [
        ...this.pendingReplacementDepartures("main"),
        ...this.pendingReplacementDepartures("postmarket"),
      ].map((entry) => entry.symbol),
      standbyToday: this.managedEntriesFor(undefined, "standby"),
      managedEntries: this.managedEntriesFor(),
      firstPassEvidence: [...this.firstPassEvidence.values()]
        .sort((left, right) => right.observedAt - left.observedAt)
        .map((entry) => ({ ...entry, sourceScreens: [...entry.sourceScreens] })),
      consecutivePassEvidence: [...this.consecutivePasses.entries()]
        .map(([symbol, count]) => ({
          symbol,
          count,
          session: this.consecutivePassSessions.get(symbol),
          observedAt: this.consecutivePassObservedAt.get(symbol),
        }))
        .filter((entry): entry is AutoWatchlistConsecutivePassEvidence =>
          entry.count > 0 &&
          isAutoWatchlistSession(entry.session) &&
          typeof entry.observedAt === "number" &&
          Number.isFinite(entry.observedAt),
        )
        .sort((left, right) => right.observedAt - left.observedAt),
      recentReplacements: this.replacementHistory.slice(-20).reverse(),
      recentDecisions: this.recentDecisions.map((decision) => ({
        ...decision,
        sourceScreens: [...decision.sourceScreens],
        reasons: [...decision.reasons],
        rankingReasons: [...decision.rankingReasons],
        rejectionReasons: [...decision.rejectionReasons],
      })),
    };
  }

  private managedEntriesFor(
    bucket?: AutoWatchlistBucket,
    state?: AutoWatchlistManagedEntry["state"],
  ): AutoWatchlistManagedEntry[] {
    return [...this.managedEntries.values()]
      .filter((entry) => (!bucket || entry.bucket === bucket) && (!state || entry.state === state))
      .map((entry) => ({ ...entry }))
      .sort((left, right) => left.firstAddedAt - right.firstAddedAt || left.symbol.localeCompare(right.symbol));
  }

  private runtimeEntries(): AutoWatchlistRuntimeEntry[] {
    if (this.options.getActiveEntries) {
      return this.options.getActiveEntries().map((entry) => ({
        ...entry,
        symbol: normalizeSymbol(entry.symbol),
        tags: [...(entry.tags ?? [])],
      })).filter((entry) => Boolean(entry.symbol));
    }
    return this.options.getActiveSymbols()
      .map(normalizeSymbol)
      .filter(Boolean)
      .map((symbol) => ({ symbol }));
  }

  private syncManagedEntriesFromRuntime(session: AutoWatchlistSession, timestamp: number): void {
    const runtimeEntries = this.runtimeEntries();
    const runtimeSymbols = new Set(runtimeEntries.map((entry) => entry.symbol));
    for (const runtimeEntry of runtimeEntries) {
      const tags = new Set(runtimeEntry.tags ?? []);
      const legacyAutoNote = /^Auto-selected(?: during (premarket|regular|postmarket))?:/i.exec(runtimeEntry.note ?? "");
      const existing = this.managedEntries.get(runtimeEntry.symbol);
      const noteAdmission = admissionSnapshotFromNote(runtimeEntry.note);
      const explicitlyManual = Boolean(this.options.getActiveEntries) &&
        tags.has("manual") &&
        !tags.has("auto") &&
        !legacyAutoNote;
      const explicitlyAutomatic = !explicitlyManual &&
        (Boolean(existing) || tags.has("auto") || Boolean(legacyAutoNote));
      if (!explicitlyAutomatic) {
        if (existing?.state === "active") {
          this.managedEntries.delete(runtimeEntry.symbol);
        }
        continue;
      }
      const inferredSession = tags.has("auto-postmarket") || legacyAutoNote?.[1]?.toLowerCase() === "postmarket"
        ? "postmarket"
        : legacyAutoNote?.[1]?.toLowerCase() === "premarket"
          ? "premarket"
          : "regular";
      const bucket = autoWatchlistBucketForSession(inferredSession);
      const runtimeFollowup = tags.has("auto-followup");
      const runtimeReversalWatch = tags.has("auto-reversal-watch");
      const runtimeReversalAttemptReady = tags.has("auto-reversal-attempt-ready");
      const state = runtimeFollowup || existing?.state === "followup" ? "followup" : "active";
      this.managedEntries.set(runtimeEntry.symbol, {
        symbol: runtimeEntry.symbol,
        bucket,
        state,
        firstAddedAt: existing?.firstAddedAt ?? runtimeEntry.activatedAt ?? timestamp,
        lastActivatedAt: existing?.lastActivatedAt ?? runtimeEntry.activatedAt ?? timestamp,
        addedSession: existing?.addedSession ?? inferredSession,
        lastSession: existing?.lastSession ?? session,
        lastRankingScore: existing?.lastRankingScore ?? 0,
        lastSlotSurvivalScore: existing?.lastSlotSurvivalScore ?? existing?.lastRankingScore ?? 0,
        admissionAt: existing?.admissionAt ?? (
          noteAdmission ? runtimeEntry.activatedAt ?? existing?.lastActivatedAt ?? timestamp : null
        ),
        admissionQualificationScore:
          existing?.admissionQualificationScore ?? noteAdmission?.qualificationScore ?? null,
        admissionRankingScore: existing?.admissionRankingScore ?? noteAdmission?.rankingScore ?? null,
        admissionSlotSurvivalScore:
          existing?.admissionSlotSurvivalScore ?? noteAdmission?.slotSurvivalScore ?? null,
        lastQualifiedAt: existing?.lastQualifiedAt ?? null,
        holdProtectionEarnedAt: existing?.holdProtectionEarnedAt ?? null,
        holdProtectionReason: existing?.holdProtectionReason ?? null,
        reversalWatchQualifiedAt:
          existing?.reversalWatchQualifiedAt ?? (runtimeReversalWatch ? timestamp : null),
        reversalWatchQualificationReason:
          existing?.reversalWatchQualificationReason ??
          (runtimeReversalWatch ? "restored persistent reversal-watch membership" : null),
        reversalWatchLowPrice: existing?.reversalWatchLowPrice ?? null,
        reversalWatchLowAt: existing?.reversalWatchLowAt ?? null,
        reversalAttemptEvidenceScans: existing?.reversalAttemptEvidenceScans ?? 0,
        reversalWatchAttemptReady:
          existing?.reversalWatchAttemptReady ?? runtimeReversalAttemptReady,
        peakGainPct: existing?.peakGainPct ?? null,
        peakGainAt: existing?.peakGainAt ?? null,
        lastObservedGainPct: existing?.lastObservedGainPct ?? null,
        lastObservedAt: existing?.lastObservedAt ?? null,
        topFiveGainerFirstObservedAt: existing?.topFiveGainerFirstObservedAt ?? null,
        topFiveGainerLastObservedAt: existing?.topFiveGainerLastObservedAt ?? null,
        topFiveGainerObservationCount: existing?.topFiveGainerObservationCount ?? 0,
        topFiveGainerConsecutiveObservations:
          existing?.topFiveGainerConsecutiveObservations ?? 0,
        retentionFailures: existing?.retentionFailures ?? 0,
        followupAt: state === "followup" ? existing?.followupAt ?? timestamp : null,
        vacatedSlotAt: state === "followup" ? existing?.vacatedSlotAt ?? timestamp : null,
        standbyAt: null,
        statusReason: existing?.statusReason ?? "recognized active automatic entry",
      });
    }
    for (const entry of this.managedEntries.values()) {
      if ((entry.state === "active" || entry.state === "followup") && !runtimeSymbols.has(entry.symbol)) {
        entry.state = "standby";
        entry.followupAt = null;
        entry.vacatedSlotAt = null;
        entry.standbyAt = timestamp;
        entry.reversalWatchQualifiedAt = null;
        entry.reversalWatchQualificationReason = null;
        entry.reversalWatchLowPrice = null;
        entry.reversalWatchLowAt = null;
        entry.reversalAttemptEvidenceScans = 0;
        entry.reversalWatchAttemptReady = false;
        entry.statusReason = "removed outside automatic replacement";
      }
    }
  }

  private isProtectedIncumbent(
    entry: AutoWatchlistManagedEntry,
    timestamp: number,
    session: AutoWatchlistSession,
  ): boolean {
    const protectedMinutes = entry.holdProtectionEarnedAt === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, timestamp - entry.holdProtectionEarnedAt) / 60_000;
    if (protectedMinutes < this.thresholds.minimumAutoHoldMinutes) {
      return true;
    }
    return session === "regular" &&
      entry.addedSession === "premarket" &&
      (elapsedSessionMinutes(timestamp, session) ?? Number.POSITIVE_INFINITY) <
        this.thresholds.regularOpenProtectionMinutes;
  }

  private retentionFailuresRequiredForEntry(entry: AutoWatchlistManagedEntry): number {
    if (entry.reversalWatchQualifiedAt === null) {
      return this.thresholds.retentionFailureScansRequired;
    }
    return Math.max(
      this.thresholds.retentionFailureScansRequired,
      Math.ceil(REVERSAL_WATCH_DEAD_CONFIRMATION_MS / this.thresholds.scanIntervalMs),
    );
  }

  private isDeadReversalCandidate(
    entry: AutoWatchlistManagedEntry,
    decision: AutoWatchlistCandidateDecision | undefined,
  ): boolean {
    const peakGainPct = entry.peakGainPct ?? 0;
    const currentGainPct = decision?.gainPct ?? entry.lastObservedGainPct;
    return (
      entry.bucket === "main" &&
      entry.reversalWatchQualifiedAt !== null &&
      peakGainPct >= 50 &&
      currentGainPct !== null &&
      currentGainPct <= peakGainPct * 0.5 &&
      decision?.volumeAcceleration !== null &&
      decision?.volumeAcceleration !== undefined &&
      decision.volumeAcceleration < 1
    );
  }

  private isObviousRunner(decision: AutoWatchlistCandidateDecision): boolean {
    if (!this.thresholds.obviousRunnerOverrideEnabled || !decision.qualified) return false;
    const requiredRecentDollarVolume = minimumRecentDollarVolume(decision.session, this.thresholds);
    const postmarketFastTrackMinimum = decision.session === "postmarket"
      ? Math.max(
          this.thresholds.postmarketPromotionMinRecentDollarVolume * 2,
          requiredRecentDollarVolume * this.thresholds.obviousRunnerRecentDollarVolumeMultiplier,
        )
      : requiredRecentDollarVolume * this.thresholds.obviousRunnerRecentDollarVolumeMultiplier;
    if (
      decision.session === "postmarket" &&
      (decision.gainPct ?? 0) < Math.max(20, this.thresholds.postmarketPromotionMinGainPct)
    ) {
      return false;
    }
    return (
      (decision.recent15mDollarVolume ?? 0) >= postmarketFastTrackMinimum &&
      (decision.volumeAcceleration ?? 0) >= this.thresholds.obviousRunnerMinVolumeAcceleration
    );
  }

  private isExtremeRunner(decision: AutoWatchlistCandidateDecision): boolean {
    const independentRunnerSourceCount = new Set(
      decision.sourceScreens.filter((source) => INDEPENDENT_RUNNER_SOURCE_SCREENS.has(source)),
    ).size;
    const hasTopGainerSource = decision.sourceScreens.some((source) =>
      TOP_GAINER_SOURCE_SCREENS.has(source)
    );
    const hasVerifiedSessionVolume = decision.session === "postmarket"
      ? (decision.sessionVolume ?? 0) > 0
      : this.hasReversalWatchVolumePace(decision);
    const hasVerifiedTopGainerRank = decision.session === "postmarket"
      ? hasTopGainerSource
      : decision.sourceScreens.some((source) => TOP_FIVE_GAINER_SOURCE_SCREENS.has(source));
    if (
      !this.thresholds.obviousRunnerOverrideEnabled ||
      !decision.qualified ||
      !decision.promotionReady ||
      (decision.gainPct ?? 0) < 50 ||
      !hasVerifiedSessionVolume ||
      (decision.shareTurnoverPct ?? 0) < 50 ||
      !hasVerifiedTopGainerRank ||
      independentRunnerSourceCount < 2 ||
      (this.requireVerifiedCommonEquity && decision.securityMasterStatus !== "verified_common_stock")
    ) {
      return false;
    }
    const requiredRecentDollarVolume = minimumRecentDollarVolume(decision.session, this.thresholds);
    return (decision.recent15mDollarVolume ?? 0) >= Math.max(1_000_000, requiredRecentDollarVolume * 10);
  }

  private reversalWatchMainSessionElapsedMinutes(
    decision: AutoWatchlistCandidateDecision,
  ): number | null {
    if (decision.mainSessionElapsedMinutes !== null) {
      return decision.mainSessionElapsedMinutes;
    }
    if (decision.sessionElapsedMinutes === null) return null;
    return decision.session === "regular"
      ? 330 + decision.sessionElapsedMinutes
      : decision.session === "premarket"
        ? decision.sessionElapsedMinutes
        : null;
  }

  private hasReversalWatchVolumePace(decision: AutoWatchlistCandidateDecision): boolean {
    const elapsedMinutes = this.reversalWatchMainSessionElapsedMinutes(decision);
    const mainSessionVolume = decision.mainSessionVolume ?? decision.sessionVolume;
    if (elapsedMinutes === null || mainSessionVolume === null) return false;
    const requiredVolume = REVERSAL_WATCH_FULL_MAIN_SESSION_VOLUME * Math.min(
      1,
      Math.max(1, elapsedMinutes) / MAIN_WATCH_WINDOW_MINUTES,
    );
    return mainSessionVolume >= requiredVolume;
  }

  private updateManagedRunnerEvidence(
    entry: AutoWatchlistManagedEntry,
    decision: AutoWatchlistCandidateDecision,
    timestamp: number,
  ): void {
    if (decision.gainPct !== null) {
      entry.lastObservedGainPct = decision.gainPct;
      entry.lastObservedAt = timestamp;
      if (entry.peakGainPct === null || decision.gainPct > entry.peakGainPct) {
        entry.peakGainPct = decision.gainPct;
        entry.peakGainAt = timestamp;
      }
    }
    if (decision.sourceScreens.includes(NASDAQ_TOP_FIVE_GAINER_SOURCE)) {
      entry.topFiveGainerFirstObservedAt ??= timestamp;
      entry.topFiveGainerLastObservedAt = timestamp;
      entry.topFiveGainerObservationCount += 1;
      entry.topFiveGainerConsecutiveObservations += 1;
    } else {
      entry.topFiveGainerConsecutiveObservations = 0;
    }
  }

  private reversalWatchQualification(
    decision: AutoWatchlistCandidateDecision,
    entry: AutoWatchlistManagedEntry,
  ): string | null {
    if (
      decision.session === "postmarket" ||
      entry.topFiveGainerConsecutiveObservations < 2 ||
      !this.isExtremeRunner(decision)
    ) {
      return null;
    }
    return `verified top runner: peak gain ${(entry.peakGainPct ?? decision.gainPct ?? 0).toFixed(1)}%, Nasdaq top-five gainer across ${entry.topFiveGainerConsecutiveObservations} consecutive scans, and ${Math.round((decision.mainSessionVolume ?? decision.sessionVolume ?? 0) / 1_000_000)}M main-session shares on qualifying pace`;
  }

  private isReversalWatchEligibleNow(
    entry: AutoWatchlistManagedEntry,
    decision: AutoWatchlistCandidateDecision | undefined,
  ): boolean {
    if (
      entry.bucket === "main" &&
      entry.state === "followup" &&
      entry.reversalWatchQualifiedAt !== null
    ) {
      return true;
    }
    if (
      entry.bucket !== "main" ||
      entry.reversalWatchQualifiedAt === null ||
      decision === undefined ||
      !this.hasReversalWatchVolumePace(decision)
    ) {
      return false;
    }
    const peakGainPct = entry.peakGainPct ?? 0;
    const currentGainPct = decision.gainPct ?? entry.lastObservedGainPct;
    return (
      peakGainPct >= 50 &&
      currentGainPct !== null &&
      currentGainPct >= Math.max(10, peakGainPct * 0.25)
    );
  }

  private updateReversalAttemptEvidence(
    entry: AutoWatchlistManagedEntry,
    decision: AutoWatchlistCandidateDecision,
    timestamp: number,
  ): void {
    if (
      entry.bucket !== "main" ||
      entry.state !== "followup" ||
      entry.reversalWatchQualifiedAt === null ||
      decision.price === null
    ) {
      return;
    }
    if (entry.reversalWatchLowPrice === null || decision.price < entry.reversalWatchLowPrice) {
      entry.reversalWatchLowPrice = decision.price;
      entry.reversalWatchLowAt = timestamp;
      entry.reversalAttemptEvidenceScans = 0;
      entry.reversalWatchAttemptReady = false;
      return;
    }
    const lowAgeMs = entry.reversalWatchLowAt === null
      ? 0
      : Math.max(0, timestamp - entry.reversalWatchLowAt);
    const reboundPct = ((decision.price - entry.reversalWatchLowPrice) / entry.reversalWatchLowPrice) * 100;
    const participationRecovered =
      (decision.volumeAcceleration ?? 0) >= 1 &&
      (decision.recent15mDollarVolume ?? 0) >= minimumRecentDollarVolume(
        decision.session,
        this.thresholds,
      );
    if (lowAgeMs >= 10 * 60_000 && reboundPct >= 10 && participationRecovered) {
      entry.reversalAttemptEvidenceScans += 1;
      entry.reversalWatchAttemptReady = entry.reversalAttemptEvidenceScans >= 2;
      return;
    }
    entry.reversalAttemptEvidenceScans = 0;
    entry.reversalWatchAttemptReady = false;
  }

  private isFastTrackRunner(decision: AutoWatchlistCandidateDecision): boolean {
    return this.isObviousRunner(decision) || this.isExtremeRunner(decision);
  }

  private automaticHoldQualification(decision: AutoWatchlistCandidateDecision): string | null {
    if (!decision.qualified || !decision.promotionReady) return null;
    const repeatedPassRequirement = Math.max(2, this.thresholds.consecutivePassesRequired + 1);
    if (decision.consecutivePasses >= repeatedPassRequirement) {
      return `earned after ${decision.consecutivePasses} qualifying observations`;
    }
    const requiredRecentDollarVolume = minimumRecentDollarVolume(decision.session, this.thresholds);
    const immediateHoldRecentDollarVolume = decision.session === "postmarket"
      ? Math.max(
          this.thresholds.postmarketPromotionMinRecentDollarVolume * 2,
          requiredRecentDollarVolume * 4,
        )
      : requiredRecentDollarVolume * 4;
    if (
      (decision.gainPct ?? 0) >= 20 &&
      (decision.recent15mDollarVolume ?? 0) >= immediateHoldRecentDollarVolume &&
      (decision.volumeAcceleration ?? 0) >= this.thresholds.obviousRunnerMinVolumeAcceleration
    ) {
      return `earned immediately as a 20%+ runner with at least $${Math.round(immediateHoldRecentDollarVolume / 1_000)}K recent dollar volume`;
    }
    return null;
  }

  private replacementCount(bucket: AutoWatchlistBucket): number {
    return this.replacementHistory.filter(
      (event) => event.bucket === bucket && event.incomingSymbol !== null,
    ).length;
  }

  private postmarketExtremeRunnerOverrideCount(): number {
    return this.replacementHistory.filter(
      (event) => event.exceptionKind === "postmarket_extreme_runner",
    ).length;
  }

  private postmarketExtremeRunnerOverrideAvailable(bucket: AutoWatchlistBucket): boolean {
    return (
      bucket === "postmarket" &&
      this.replacementCount(bucket) >= this.replacementLimit(bucket) &&
      this.postmarketExtremeRunnerOverrideCount() <
        this.thresholds.maxPostmarketExtremeRunnerOverridesPerTradingDay
    );
  }

  private pendingReplacementDepartures(bucket: AutoWatchlistBucket): AutoWatchlistManagedEntry[] {
    const pendingBySymbol = new Map<string, number>();
    for (const entry of this.managedEntries.values()) {
      if (
        entry.bucket === bucket &&
        (entry.state === "followup" || entry.state === "standby") &&
        typeof entry.vacatedSlotAt === "number"
      ) {
        pendingBySymbol.set(entry.symbol, entry.vacatedSlotAt);
      }
    }
    for (const event of this.replacementHistory) {
      if (event.bucket !== bucket) continue;
      if (event.incomingSymbol === null) {
        pendingBySymbol.set(event.outgoingSymbol, event.timestamp);
      } else {
        pendingBySymbol.delete(event.outgoingSymbol);
      }
    }
    return [...pendingBySymbol.entries()]
      .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
      .map(([symbol]) => this.managedEntries.get(symbol))
      .filter((entry): entry is AutoWatchlistManagedEntry =>
        entry?.bucket === bucket &&
        (entry.state === "followup" || entry.state === "standby") &&
        typeof entry.vacatedSlotAt === "number",
      )
      .map((entry) => ({ ...entry }));
  }

  private replacementLimit(bucket: AutoWatchlistBucket): number {
    return bucket === "postmarket"
      ? this.thresholds.maxPostmarketReplacementsPerTradingDay
      : this.thresholds.maxMainSessionReplacementsPerTradingDay;
  }

  private isLateMainSessionAdmissionReserveUnlocked(
    bucket: AutoWatchlistBucket,
    timestamp: number,
  ): boolean {
    return (
      bucket === "main" &&
      easternParts(timestamp).hour >= this.thresholds.lateMainSessionAdmissionUnlockHourEastern
    );
  }

  private lateMainSessionAdmissionReserveAvailable(
    bucket: AutoWatchlistBucket,
    timestamp: number,
  ): boolean {
    return (
      this.isLateMainSessionAdmissionReserveUnlocked(bucket, timestamp) &&
      this.lateMainSessionAdmissionReserveUsed < this.thresholds.lateMainSessionAdmissionReserve
    );
  }

  private consumeLateMainSessionAdmissionReserve(): void {
    this.lateMainSessionAdmissionReserveUsed += 1;
    this.persistConfig();
  }

  private replacementAdmissionCapacityAvailable(
    bucket: AutoWatchlistBucket,
    timestamp: number,
    options: { allowMainSessionFastTrackOverride?: boolean } = {},
  ): boolean {
    return (
      this.replacementCount(bucket) < this.replacementLimit(bucket) ||
      this.lateMainSessionAdmissionReserveAvailable(bucket, timestamp) ||
      (bucket === "main" && options.allowMainSessionFastTrackOverride === true)
    );
  }

  private activeSlotLimit(bucket: AutoWatchlistBucket): number {
    return bucket === "postmarket"
      ? this.thresholds.maxActivePostmarketTickers
      : this.thresholds.maxActiveMainSessionTickers;
  }

  private async enforceActiveSlotLimits(
    timestamp: number,
    buckets: AutoWatchlistBucket[] = ["main", "postmarket"],
    decisionBySymbol: Map<string, AutoWatchlistCandidateDecision> = new Map(),
  ): Promise<void> {
    for (const bucket of buckets) {
      const overflowCount = Math.max(
        0,
        this.managedEntriesFor(bucket, "active").length - this.activeSlotLimit(bucket),
      );
      if (overflowCount === 0) continue;
      const overflowEntries = this.managedEntriesFor(bucket, "active")
        .sort((left, right) => {
          const leftDecision = decisionBySymbol.get(left.symbol);
          const rightDecision = decisionBySymbol.get(right.symbol);
          return (
          (leftDecision?.slotSurvivalScore ?? left.lastSlotSurvivalScore) -
            (rightDecision?.slotSurvivalScore ?? right.lastSlotSurvivalScore) ||
          right.retentionFailures - left.retentionFailures ||
          (left.lastQualifiedAt ?? 0) - (right.lastQualifiedAt ?? 0)
          );
        })
        .slice(0, overflowCount);
      for (const entry of overflowEntries) {
        const decision = decisionBySymbol.get(entry.symbol);
        if (decision) {
          entry.lastRankingScore = decision.rankingScore;
          entry.lastSlotSurvivalScore = decision.slotSurvivalScore;
        }
        await this.moveManagedEntryToFollowup(
          entry,
          timestamp,
          `moved to follow-up because the active automatic slot limit was reduced to ${this.activeSlotLimit(bucket)}`,
          decision,
        );
      }
    }
  }

  private queueActiveSlotLimitReconciliation(): void {
    if (this.activeSlotReconciliationPromise) return;
    const pendingScan = this.scanPromise;
    let reconciliationPromise: Promise<void>;
    reconciliationPromise = Promise.resolve()
      .then(async () => {
        if (pendingScan) await pendingScan;
        if (!this.enabled) return;
        const timestamp = this.now();
        this.syncManagedEntriesFromRuntime(autoWatchlistSessionForTimestamp(timestamp), timestamp);
        await this.enforceActiveSlotLimits(timestamp);
        this.persistConfig();
        await this.runImmediateEnabledScan();
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = `Active slot reconciliation failed: ${message}`;
        console.error(`[AutoWatchlistSelector] ${this.lastError}`);
      })
      .finally(() => {
        if (this.activeSlotReconciliationPromise === reconciliationPromise) {
          this.activeSlotReconciliationPromise = null;
        }
      });
    this.activeSlotReconciliationPromise = reconciliationPromise;
  }

  private sessionAddedSet(bucket: AutoWatchlistBucket): Set<string> {
    return bucket === "postmarket" ? this.postmarketAddedToday : this.mainSessionAddedToday;
  }

  private initialAdditionLimit(bucket: AutoWatchlistBucket): number {
    return bucket === "postmarket"
      ? this.thresholds.maxPostmarketAddsPerTradingDay
      : this.thresholds.maxAddsPerTradingDay;
  }

  private async activateManagedDecision(
    decision: AutoWatchlistCandidateDecision,
    bucket: AutoWatchlistBucket,
    timestamp: number,
    reason: string,
  ): Promise<boolean> {
    const holdProtectionReason = this.automaticHoldQualification(decision);
    const sharesLabel = decision.effectiveShares
      ? `${(decision.effectiveShares / 1_000_000).toFixed(1)}M ${
        decision.effectiveSharesSource === "yahoo_float" || decision.effectiveSharesSource === "finnhub_float"
          ? "float"
          : "shares outstanding"
      }`
      : "share count unavailable";
    try {
      await this.options.activateSymbol({
        symbol: decision.symbol,
        source: "auto",
        autoSession: decision.session === "closed" ? "regular" : decision.session,
        selectionPrice: decision.price ?? undefined,
        selectionGainPct: decision.gainPct ?? undefined,
        note: `Auto-selected during ${decision.session}: qualification score ${decision.score}; admission rank ${decision.rankingScore}; admission slot score ${decision.slotSurvivalScore}; ${(decision.gainPct ?? 0).toFixed(1)}% gain; $${Math.round((decision.recent15mDollarVolume ?? 0) / 1_000).toLocaleString("en-US")}K last-15m dollar volume; ${decision.volumeAcceleration ? `${decision.volumeAcceleration.toFixed(1)}x activity acceleration; ` : ""}${decision.shareTurnoverPct !== null ? `${decision.shareTurnoverPct.toFixed(1)}% share turnover; ` : ""}$${Math.round((decision.marketCap ?? 0) / 1_000_000)}M market cap; ${sharesLabel}; ranking: ${[...decision.rankingReasons, ...decision.slotSurvivalReasons].join(", ") || "base signals only"}; lifecycle: ${reason}.`,
      });
    } catch (error) {
      this.lastActivationErrors.push({
        symbol: decision.symbol,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
    const existing = this.managedEntries.get(decision.symbol);
    const managedEntry: AutoWatchlistManagedEntry = {
      symbol: decision.symbol,
      bucket,
      state: "active",
      firstAddedAt: existing?.firstAddedAt ?? timestamp,
      lastActivatedAt: timestamp,
      addedSession: existing?.addedSession ?? decision.session,
      lastSession: decision.session,
      lastRankingScore: decision.rankingScore,
      lastSlotSurvivalScore: decision.slotSurvivalScore,
      admissionAt: timestamp,
      admissionQualificationScore: decision.score,
      admissionRankingScore: decision.rankingScore,
      admissionSlotSurvivalScore: decision.slotSurvivalScore,
      lastQualifiedAt: timestamp,
      holdProtectionEarnedAt: holdProtectionReason ? timestamp : null,
      holdProtectionReason,
      reversalWatchQualifiedAt: existing?.reversalWatchQualifiedAt ?? null,
      reversalWatchQualificationReason: existing?.reversalWatchQualificationReason ?? null,
      reversalWatchLowPrice: existing?.reversalWatchLowPrice ?? null,
      reversalWatchLowAt: existing?.reversalWatchLowAt ?? null,
      reversalAttemptEvidenceScans: existing?.reversalAttemptEvidenceScans ?? 0,
      reversalWatchAttemptReady: existing?.reversalWatchAttemptReady ?? false,
      peakGainPct: existing?.peakGainPct ?? null,
      peakGainAt: existing?.peakGainAt ?? null,
      lastObservedGainPct: existing?.lastObservedGainPct ?? null,
      lastObservedAt: existing?.lastObservedAt ?? null,
      topFiveGainerFirstObservedAt: existing?.topFiveGainerFirstObservedAt ?? null,
      topFiveGainerLastObservedAt: existing?.topFiveGainerLastObservedAt ?? null,
      topFiveGainerObservationCount: existing?.topFiveGainerObservationCount ?? 0,
      topFiveGainerConsecutiveObservations:
        existing?.topFiveGainerConsecutiveObservations ?? 0,
      retentionFailures: 0,
      followupAt: null,
      vacatedSlotAt: null,
      standbyAt: null,
      statusReason: reason,
    };
    this.updateManagedRunnerEvidence(managedEntry, decision, timestamp);
    const reversalWatchQualificationReason = this.reversalWatchQualification(
      decision,
      managedEntry,
    );
    if (reversalWatchQualificationReason) {
      managedEntry.reversalWatchQualifiedAt = timestamp;
      managedEntry.reversalWatchQualificationReason = reversalWatchQualificationReason;
    }
    this.managedEntries.set(decision.symbol, managedEntry);
    this.sessionAddedSet(bucket).add(decision.symbol);
    this.lastAddedSymbols.push(decision.symbol);
    this.persistConfig();
    return true;
  }

  private async moveManagedEntryToFollowup(
    entry: AutoWatchlistManagedEntry,
    timestamp: number,
    reason: string,
    currentDecision?: AutoWatchlistCandidateDecision,
  ): Promise<boolean> {
    if (!this.options.setSymbolFollowup) return false;
    const reversalWatchEligible = this.isReversalWatchEligibleNow(entry, currentDecision);
    if (reversalWatchEligible && currentDecision?.price !== null && currentDecision?.price !== undefined) {
      entry.reversalWatchLowPrice = currentDecision.price;
      entry.reversalWatchLowAt = timestamp;
      entry.reversalAttemptEvidenceScans = 0;
      entry.reversalWatchAttemptReady = false;
    }
    try {
      await this.options.setSymbolFollowup(entry.symbol, true, {
        reversalWatchEligible,
        reversalWatchAttemptReady: false,
      });
    } catch (error) {
      this.lastActivationErrors.push({
        symbol: entry.symbol,
        error: `automatic follow-up transition failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      return false;
    }
    entry.state = "followup";
    entry.followupAt = timestamp;
    entry.vacatedSlotAt = timestamp;
    entry.standbyAt = null;
    entry.statusReason = reason;
    this.managedEntries.set(entry.symbol, entry);
    this.persistConfig();
    return true;
  }

  private async promoteManagedFollowupDecision(
    decision: AutoWatchlistCandidateDecision,
    entry: AutoWatchlistManagedEntry,
    timestamp: number,
  ): Promise<boolean> {
    if (!this.options.setSymbolFollowup) return false;
    try {
      await this.options.setSymbolFollowup(entry.symbol, false);
    } catch (error) {
      this.lastActivationErrors.push({
        symbol: entry.symbol,
        error: `automatic follow-up promotion failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      return false;
    }
    entry.state = "active";
    entry.lastActivatedAt = timestamp;
    entry.lastQualifiedAt = timestamp;
    entry.lastRankingScore = decision.rankingScore;
    entry.lastSlotSurvivalScore = decision.slotSurvivalScore;
    entry.admissionAt = timestamp;
    entry.admissionQualificationScore = decision.score;
    entry.admissionRankingScore = decision.rankingScore;
    entry.admissionSlotSurvivalScore = decision.slotSurvivalScore;
    const holdProtectionReason = this.automaticHoldQualification(decision);
    entry.holdProtectionEarnedAt = holdProtectionReason ? timestamp : null;
    entry.holdProtectionReason = holdProtectionReason;
    const reversalWatchQualificationReason = this.reversalWatchQualification(decision, entry);
    if (reversalWatchQualificationReason) {
      entry.reversalWatchQualifiedAt = timestamp;
      entry.reversalWatchQualificationReason = reversalWatchQualificationReason;
    }
    entry.retentionFailures = 0;
    entry.reversalWatchLowPrice = null;
    entry.reversalWatchLowAt = null;
    entry.reversalAttemptEvidenceScans = 0;
    entry.reversalWatchAttemptReady = false;
    entry.followupAt = null;
    entry.vacatedSlotAt = null;
    entry.standbyAt = null;
    entry.statusReason = "returned from follow-up after renewed qualification";
    this.managedEntries.set(entry.symbol, entry);
    this.persistConfig();
    return true;
  }

  private async restoreManagedFollowupAfterConfirmedHalt(
    decision: AutoWatchlistCandidateDecision,
    entry: AutoWatchlistManagedEntry,
  ): Promise<boolean> {
    if (!this.options.setSymbolFollowup) return false;
    try {
      await this.options.setSymbolFollowup(entry.symbol, false);
    } catch (error) {
      this.lastActivationErrors.push({
        symbol: entry.symbol,
        error: `automatic halt-protection restore failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      return false;
    }
    entry.state = "active";
    entry.lastRankingScore = decision.rankingScore;
    entry.lastSlotSurvivalScore = decision.slotSurvivalScore;
    entry.retentionFailures = 0;
    entry.followupAt = null;
    entry.vacatedSlotAt = null;
    entry.standbyAt = null;
    entry.statusReason = decision.haltRetentionProtectionReason ??
      "restored from follow-up because Nasdaq Trader confirms an active trading halt";
    this.managedEntries.set(entry.symbol, entry);
    this.persistConfig();
    return true;
  }

  private async moveManagedEntryToStandby(
    entry: AutoWatchlistManagedEntry,
    timestamp: number,
    reason: string,
  ): Promise<boolean> {
    if (!this.options.deactivateSymbol) return false;
    try {
      await this.options.deactivateSymbol(entry.symbol);
    } catch (error) {
      this.lastActivationErrors.push({
        symbol: entry.symbol,
        error: `automatic standby failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      return false;
    }
    entry.state = "standby";
    entry.followupAt = null;
    entry.standbyAt = timestamp;
    entry.statusReason = reason;
    this.managedEntries.set(entry.symbol, entry);
    this.persistConfig();
    return true;
  }

  private async restoreManagedEntryAfterFailedReplacement(
    entry: AutoWatchlistManagedEntry,
    timestamp: number,
    challengerSymbol: string,
  ): Promise<boolean> {
    if (entry.state === "active" && this.options.setSymbolFollowup) {
      try {
        await this.options.setSymbolFollowup(entry.symbol, false);
        entry.followupAt = null;
        entry.vacatedSlotAt = null;
        entry.standbyAt = null;
        entry.statusReason = `restored after ${challengerSymbol} failed replacement activation`;
        this.managedEntries.set(entry.symbol, entry);
        this.persistConfig();
        return true;
      } catch (error) {
        this.lastActivationErrors.push({
          symbol: entry.symbol,
          error: `automatic replacement restore failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    try {
      await this.options.activateSymbol({
        symbol: entry.symbol,
        source: "auto",
        autoSession: entry.lastSession === "closed" ? "regular" : entry.lastSession,
        note: `Auto-restored after ${challengerSymbol} failed to complete replacement activation.`,
      });
    } catch (error) {
      this.lastActivationErrors.push({
        symbol: entry.symbol,
        error: `automatic replacement restore failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      entry.statusReason = `replacement by ${challengerSymbol} failed and incumbent restore failed`;
      this.managedEntries.set(entry.symbol, entry);
      this.persistConfig();
      return false;
    }

    entry.state = "active";
    entry.lastActivatedAt = timestamp;
    entry.followupAt = null;
    entry.vacatedSlotAt = null;
    entry.standbyAt = null;
    entry.statusReason = `restored after ${challengerSymbol} failed replacement activation`;
    this.managedEntries.set(entry.symbol, entry);
    this.persistConfig();
    return true;
  }

  private async replaceManagedDecision(
    challenger: AutoWatchlistCandidateDecision,
    incumbent: AutoWatchlistManagedEntry,
    bucket: AutoWatchlistBucket,
    timestamp: number,
    reason: string,
    incumbentDecision?: AutoWatchlistCandidateDecision,
  ): Promise<boolean> {
    if (normalizeSymbol(challenger.symbol) === normalizeSymbol(incumbent.symbol)) {
      return false;
    }
    const incumbentBeforeReplacement = { ...incumbent };
    if (!await this.moveManagedEntryToFollowup(
      incumbent,
      timestamp,
      `replacement pending for ${challenger.symbol}`,
      incumbentDecision,
    )) {
      return false;
    }

    const managedChallenger = this.managedEntries.get(challenger.symbol);
    const activated = managedChallenger?.state === "followup"
      ? await this.promoteManagedFollowupDecision(challenger, managedChallenger, timestamp)
      : await this.activateManagedDecision(challenger, bucket, timestamp, reason);
    if (activated) {
      const liveIncumbent = this.managedEntries.get(incumbent.symbol);
      if (liveIncumbent) {
        liveIncumbent.vacatedSlotAt = null;
        liveIncumbent.statusReason = `${liveIncumbent.statusReason}; active slot filled by ${challenger.symbol}`;
        this.managedEntries.set(liveIncumbent.symbol, liveIncumbent);
        this.persistConfig();
      }
      return true;
    }

    await this.restoreManagedEntryAfterFailedReplacement(
      incumbentBeforeReplacement,
      timestamp,
      challenger.symbol,
    );
    return false;
  }

  private recordReplacement(
    bucket: AutoWatchlistBucket,
    incoming: AutoWatchlistCandidateDecision | null,
    outgoing: AutoWatchlistManagedEntry,
    timestamp: number,
    reason: string,
    exceptionKind?: AutoWatchlistReplacementEvent["exceptionKind"],
  ): void {
    this.replacementHistory.push({
      timestamp,
      bucket,
      incomingSymbol: incoming?.symbol ?? null,
      outgoingSymbol: outgoing.symbol,
      incomingRankingScore: incoming?.rankingScore ?? null,
      outgoingRankingScore: outgoing.lastRankingScore,
      reason,
      ...(exceptionKind ? { exceptionKind } : {}),
    });
    this.replacementHistory = this.replacementHistory.slice(-50);
    this.persistConfig();
  }

  private async trimFollowupShelf(
    timestamp: number,
    decisionBySymbol: Map<string, AutoWatchlistCandidateDecision> = new Map(),
  ): Promise<void> {
    const tradingDay = easternParts(timestamp).date;
    const expired = this.managedEntriesFor(undefined, "followup").filter((entry) =>
      typeof entry.followupAt === "number" &&
      easternParts(entry.followupAt).date !== tradingDay,
    );
    for (const entry of expired) {
      await this.moveManagedEntryToStandby(
        entry,
        timestamp,
        "moved to standby when the prior-session follow-up window expired",
      );
    }

    const ordinaryFollowups = this.managedEntriesFor(undefined, "followup")
      .filter((entry) => entry.reversalWatchQualifiedAt === null);
    // A follow-up seat is a live tactical decision, not a reward for an old
    // admission score. Rebalance only when every competing symbol has fresh
    // activity data; otherwise preserve the shelf until a healthy scan can
    // compare the entire pool without evicting a ticker on a provider gap.
    const freshDecisionBySymbol = new Map<string, AutoWatchlistCandidateDecision>();
    for (const entry of ordinaryFollowups) {
      const decision = decisionBySymbol.get(entry.symbol);
      if (
        !decision?.activityDataAvailable ||
        decision.activityQuoteAgeMinutes === null ||
        decision.activityQuoteAgeMinutes > this.thresholds.maxActivityQuoteAgeMinutes
      ) {
        return;
      }
      freshDecisionBySymbol.set(entry.symbol, decision);
      entry.lastRankingScore = decision.rankingScore;
      entry.lastSlotSurvivalScore = decision.slotSurvivalScore;
      this.managedEntries.set(entry.symbol, entry);
    }

    if (ordinaryFollowups.length <= MAX_AUTO_WATCHLIST_FOLLOWUP_TICKERS) {
      return;
    }

    ordinaryFollowups.sort((left, right) => {
      const leftDecision = freshDecisionBySymbol.get(left.symbol)!;
      const rightDecision = freshDecisionBySymbol.get(right.symbol)!;
      return (
        leftDecision.slotSurvivalScore - rightDecision.slotSurvivalScore ||
        leftDecision.rankingScore - rightDecision.rankingScore ||
        right.retentionFailures - left.retentionFailures ||
        (left.followupAt ?? 0) - (right.followupAt ?? 0)
      );
    });
    const overflow = Math.max(0, ordinaryFollowups.length - MAX_AUTO_WATCHLIST_FOLLOWUP_TICKERS);
    for (const entry of ordinaryFollowups.slice(0, overflow)) {
      const decision = freshDecisionBySymbol.get(entry.symbol)!;
      await this.moveManagedEntryToStandby(
        entry,
        timestamp,
        `moved to standby after fresh follow-up rebalance: current slot score ${decision.slotSurvivalScore.toFixed(2)} ranked outside the best ${MAX_AUTO_WATCHLIST_FOLLOWUP_TICKERS}`,
      );
    }

    for (const entry of ordinaryFollowups.slice(overflow)) {
      const decision = freshDecisionBySymbol.get(entry.symbol)!;
      entry.statusReason = `retained after fresh follow-up rebalance: current slot score ${decision.slotSurvivalScore.toFixed(2)} ranks in the best ${MAX_AUTO_WATCHLIST_FOLLOWUP_TICKERS}`;
      this.managedEntries.set(entry.symbol, entry);
    }
  }

  async previewScan(): Promise<AutoWatchlistSelectorStatus> {
    await this.runScan(false);
    return this.getStatus();
  }

  async runNow(options: { activate?: boolean } = {}): Promise<AutoWatchlistSelectorStatus> {
    const activate = options.activate === true && this.enabled && this.options.isRuntimeReady();
    await this.runScan(activate);
    return this.getStatus();
  }

  private async runScheduledScan(): Promise<void> {
    if (!this.enabled || !this.options.isRuntimeReady()) {
      return;
    }
    if (!isWithinAutoWatchlistScanWindow(this.now(), this.thresholds)) {
      return;
    }
    if (!isAutoWatchlistSessionEnabled(autoWatchlistSessionForTimestamp(this.now()), this.thresholds)) {
      return;
    }
    await this.runScan(true);
  }

  private async runImmediateEnabledScan(): Promise<void> {
    if (!this.enabled || !this.options.isRuntimeReady()) {
      return;
    }
    if (!isAutoWatchlistSessionEnabled(autoWatchlistSessionForTimestamp(this.now()), this.thresholds)) {
      return;
    }
    await this.runScan(true);
  }

  private resetTradingDayIfNeeded(timestamp: number): void {
    const nextTradingDay = easternParts(timestamp).date;
    if (nextTradingDay === this.tradingDay) {
      return;
    }
    this.tradingDay = nextTradingDay;
    this.mainSessionAddedToday.clear();
    this.postmarketAddedToday.clear();
    this.lateMainSessionAdmissionReserveUsed = 0;
    for (const [symbol, entry] of this.managedEntries) {
      if (entry.state === "standby") {
        this.managedEntries.delete(symbol);
      }
    }
    this.replacementHistory = [];
    this.firstPassEvidence.clear();
    this.consecutivePasses.clear();
    this.consecutivePassSessions.clear();
    this.consecutivePassObservedAt.clear();
    this.persistConfig();
  }

  private async fetchNasdaqSessionActivity(
    symbol: string,
    session: AutoWatchlistSession,
    now: number,
  ): Promise<AutoWatchlistSessionActivity> {
    const url = new URL(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/chart`);
    url.searchParams.set("assetclass", "stocks");
    url.searchParams.set("charttype", "rs");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json,text/plain,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
          Origin: "https://www.nasdaq.com",
          Referer: `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}`,
        },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error(`Nasdaq activity request failed for ${symbol} (${response.status}).`);
    }
    const body = await response.json() as {
      data?: {
        chartPrevClose?: number | string;
        chart?: Array<{ x?: number; y?: number; w?: number }>;
      };
    };
    const bars = (Array.isArray(body.data?.chart) ? body.data.chart : [])
      .map((bar) => ({
        timestamp: finitePositive(bar.x) !== null
          ? normalizeNasdaqChartTimestamp(finitePositive(bar.x)!, now)
          : null,
        price: finitePositive(bar.y),
        volume: finiteNumber(bar.w) ?? 0,
      }))
      .filter((bar): bar is { timestamp: number; price: number; volume: number } =>
        bar.timestamp !== null && bar.price !== null,
      )
      .filter((bar) => easternParts(bar.timestamp).date === easternParts(now).date)
      .sort((left, right) => left.timestamp - right.timestamp);
    const sessionBars = bars.filter((bar) => autoWatchlistSessionForTimestamp(bar.timestamp) === session);
    const mainSessionBars = bars.filter((bar) => {
      const barSession = autoWatchlistSessionForTimestamp(bar.timestamp);
      return barSession === "premarket" || barSession === "regular";
    });
    const latest = sessionBars.at(-1);
    if (!latest) {
      return {
        symbol,
        session,
        price: null,
        gainPct: null,
        sessionVolume: null,
        sessionDollarVolume: null,
        recent15mVolume: null,
        recent15mDollarVolume: null,
        sessionElapsedMinutes: null,
        volumeAcceleration: null,
        quoteTime: null,
        quoteAgeMinutes: null,
        available: false,
        error: `No ${session} trades were returned.`,
      };
    }
    const previousClose = finitePositive(Number(body.data?.chartPrevClose));
    const regularClose = bars.filter((bar) => autoWatchlistSessionForTimestamp(bar.timestamp) === "regular").at(-1)?.price ?? null;
    const referencePrice = session === "postmarket" ? regularClose : previousClose;
    const recentCutoff = now - 15 * 60 * 1000;
    const recentBars = sessionBars.filter((bar) => bar.timestamp >= recentCutoff);
    const sessionVolume = sessionBars.reduce((sum, bar) => sum + Math.max(0, bar.volume), 0);
    const mainSessionVolume = mainSessionBars.reduce(
      (sum, bar) => sum + Math.max(0, bar.volume),
      0,
    );
    const sessionDollarVolume = sessionBars.reduce(
      (sum, bar) => sum + Math.max(0, bar.volume) * bar.price,
      0,
    );
    const recent15mVolume = recentBars.reduce((sum, bar) => sum + Math.max(0, bar.volume), 0);
    const recent15mDollarVolume = recentBars.reduce(
      (sum, bar) => sum + Math.max(0, bar.volume) * bar.price,
      0,
    );
    const sessionElapsedMinutes = elapsedSessionMinutes(now, session);
    const nowEastern = easternParts(now);
    const mainSessionElapsedMinutes = Math.min(
      MAIN_WATCH_WINDOW_MINUTES,
      Math.max(0, nowEastern.hour * 60 + nowEastern.minute - 4 * 60),
    );
    const earlierSessionMinutes = Math.max(0, (sessionElapsedMinutes ?? 0) - 15);
    const earlierSessionVolume = Math.max(0, sessionVolume - recent15mVolume);
    const recentVolumeRate = recent15mVolume / 15;
    const earlierVolumeRate = earlierSessionMinutes > 0
      ? earlierSessionVolume / earlierSessionMinutes
      : 0;
    const volumeAcceleration = earlierSessionMinutes < 15 || recent15mVolume <= 0
      ? null
      : earlierVolumeRate > 0
        ? recentVolumeRate / earlierVolumeRate
        : 10;
    return {
      symbol,
      session,
      price: latest.price,
      gainPct: referencePrice ? ((latest.price - referencePrice) / referencePrice) * 100 : null,
      sessionVolume,
      mainSessionVolume,
      sessionDollarVolume,
      recent15mVolume,
      recent15mDollarVolume,
      sessionElapsedMinutes,
      mainSessionElapsedMinutes,
      volumeAcceleration,
      quoteTime: Math.floor(latest.timestamp / 1000),
      quoteAgeMinutes: Math.max(0, (now - latest.timestamp) / 60_000),
      available: true,
    };
  }

  private async fetchNasdaqSessionActivities(input: {
    symbols: string[];
    session: AutoWatchlistSession;
    now: number;
  }): Promise<Record<string, AutoWatchlistSessionActivity>> {
    const output: Record<string, AutoWatchlistSessionActivity> = {};
    for (let index = 0; index < input.symbols.length; index += 10) {
      const batch = input.symbols.slice(index, index + 10);
      const results = await Promise.allSettled(
        batch.map((symbol) => this.fetchNasdaqSessionActivity(symbol, input.session, input.now)),
      );
      for (const [resultIndex, result] of results.entries()) {
        const symbol = batch[resultIndex]!;
        output[symbol] = result.status === "fulfilled"
          ? result.value
          : {
              symbol,
              session: input.session,
              price: null,
              gainPct: null,
              sessionVolume: null,
              sessionDollarVolume: null,
              recent15mVolume: null,
              recent15mDollarVolume: null,
              sessionElapsedMinutes: null,
              volumeAcceleration: null,
              quoteTime: null,
              quoteAgeMinutes: null,
              available: false,
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            };
      }
    }
    return output;
  }

  private async lookupSessionActivities(
    candidates: AutoWatchlistDiscoveryCandidate[],
    session: AutoWatchlistSession,
    now: number,
  ): Promise<Map<string, AutoWatchlistSessionActivity>> {
    const symbols = candidates
      .map((candidate) => candidate.symbol)
      .filter((symbol) => !this.prefetchedActivityBySymbol.has(symbol));
    if (symbols.length > 0) {
      try {
        const result = await this.sessionActivityLookup({ symbols, session, now });
        for (const symbol of symbols) {
          const activity = result[symbol];
          if (activity) this.prefetchedActivityBySymbol.set(symbol, activity);
        }
        const availableCount = symbols.filter((symbol) => result[symbol]?.available).length;
        this.sessionActivityAvailable = availableCount > 0;
        const errors = symbols
          .map((symbol) => result[symbol]?.error)
          .filter((error): error is string => Boolean(error));
        const unavailableCount = symbols.length - availableCount;
        this.lastActivityLookupError = unavailableCount > 0
          ? `${unavailableCount} of ${symbols.length} activity lookups unavailable${errors[0] ? `: ${errors[0]}` : "."}`
          : null;
      } catch (error) {
        this.sessionActivityAvailable = false;
        this.lastActivityLookupError = error instanceof Error ? error.message : String(error);
      }
    }
    return new Map(
      candidates
        .map((candidate) => [candidate.symbol, this.prefetchedActivityBySymbol.get(candidate.symbol)] as const)
        .filter((entry): entry is readonly [string, AutoWatchlistSessionActivity] => entry[1] !== undefined),
    );
  }

  private async revalidatePromotionCandidatesBeforeActivation(
    decisions: AutoWatchlistCandidateDecision[],
    session: AutoWatchlistSession,
  ): Promise<void> {
    const activeSymbols = new Set(this.options.getActiveSymbols().map(normalizeSymbol));
    const targets = decisions.filter((decision) => {
      if (!decision.promotionReady) return false;
      const managed = this.managedEntries.get(decision.symbol);
      return !activeSymbols.has(decision.symbol) || managed?.state === "followup";
    });
    if (targets.length === 0) return;

    const revalidationNow = this.now();
    let result: Record<string, AutoWatchlistSessionActivity> = {};
    try {
      result = await this.sessionActivityLookup({
        symbols: targets.map((decision) => decision.symbol),
        session,
        now: revalidationNow,
      });
    } catch (error) {
      this.lastActivityLookupError = `final activation revalidation failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    for (const decision of targets) {
      const activity = result[decision.symbol] ?? {
        symbol: decision.symbol,
        session,
        price: null,
        gainPct: null,
        sessionVolume: null,
        sessionDollarVolume: null,
        recent15mVolume: null,
        recent15mDollarVolume: null,
        sessionElapsedMinutes: null,
        volumeAcceleration: null,
        quoteTime: null,
        quoteAgeMinutes: null,
        available: false,
        error: "fresh activation activity was unavailable",
      };
      const refreshedCandidate: AutoWatchlistDiscoveryCandidate = {
        symbol: decision.symbol,
        price: activity.available ? activity.price : decision.price,
        gainPct: activity.available ? activity.gainPct : decision.gainPct,
        volume: activity.available ? activity.sessionVolume : decision.volume,
        averageVolume: decision.averageVolume,
        marketCap: decision.marketCap,
        quoteTime: activity.available ? activity.quoteTime : decision.quoteTime,
        sourceScreens: [
          ...new Set([...decision.sourceScreens, "fresh_activation_revalidation"]),
        ],
        ...(decision.securityMasterStatus
          ? { securityMasterStatus: decision.securityMasterStatus }
          : {}),
      };
      const scored = scoreAutoWatchlistCandidate({
        candidate: refreshedCandidate,
        floatShares: decision.effectiveSharesSource === "yahoo_float" ? decision.floatShares : null,
        finnhubFloatShares:
          decision.effectiveSharesSource === "finnhub_float" ? decision.floatShares : null,
        yahooSharesOutstanding:
          decision.effectiveSharesSource === "yahoo_outstanding" ? decision.sharesOutstanding : null,
        finnhubSharesOutstanding:
          decision.effectiveSharesSource === "finnhub_outstanding" ? decision.sharesOutstanding : null,
        thresholds: this.thresholds,
        session,
        activity,
      });
      const promotionRejectionReasons = postmarketPromotionRejectionReasons({
        qualified: scored.qualified,
        session,
        gainPct: scored.gainPct,
        recent15mDollarVolume: activity.recent15mDollarVolume,
        thresholds: this.thresholds,
      });
      const slotSurvival = buildAutoWatchlistSlotSurvivalScore({
        rankingScore: decision.rankingScore,
        gainPct: scored.gainPct,
      });
      Object.assign(decision, scored, slotSurvival, {
        promotionReady: scored.qualified && promotionRejectionReasons.length === 0,
        promotionRejectionReasons,
        sessionVolume: activity.sessionVolume,
        mainSessionVolume: activity.mainSessionVolume ?? decision.mainSessionVolume,
        sessionDollarVolume: activity.sessionDollarVolume ?? null,
        recent15mVolume: activity.recent15mVolume,
        recent15mDollarVolume: activity.recent15mDollarVolume,
        sessionElapsedMinutes: activity.sessionElapsedMinutes ?? null,
        mainSessionElapsedMinutes: activity.mainSessionElapsedMinutes ?? null,
        volumeAcceleration: activity.volumeAcceleration ?? null,
        activityQuoteAgeMinutes: activity.quoteAgeMinutes,
        activityDataAvailable: activity.available,
      });
      if (!decision.promotionReady) {
        decision.consecutivePasses = 0;
        this.consecutivePasses.set(decision.symbol, 0);
        this.consecutivePassSessions.set(decision.symbol, session);
      }
    }
  }

  private async lookupTradingHalts(
    symbols: string[],
    now: number,
  ): Promise<Map<string, NasdaqTradingHaltRecord>> {
    if (symbols.length === 0) return new Map();
    try {
      const result = await this.tradingHaltLookup({ symbols, now });
      this.tradingHaltFeedAvailable = result.available;
      this.lastTradingHaltLookupError = result.error;
      return new Map(
        Object.entries(result.bySymbol)
          .filter((entry): entry is [string, NasdaqTradingHaltRecord] => entry[1].state !== "not_found"),
      );
    } catch (error) {
      this.tradingHaltFeedAvailable = false;
      this.lastTradingHaltLookupError = error instanceof Error ? error.message : String(error);
      return new Map();
    }
  }

  private async fetchScreen(screenId: string): Promise<YahooScreenerQuote[]> {
    const url = new URL("https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved");
    url.searchParams.set("formatted", "false");
    url.searchParams.set("scrIds", screenId);
    url.searchParams.set("count", "100");
    url.searchParams.set("start", "0");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 TraderLink levels-system",
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Yahoo ${screenId} screener failed (${response.status}).`);
      }
      const body = await response.json() as YahooScreenerResponse;
      return body.finance?.result?.[0]?.quotes ?? [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchNasdaqMarketMovers(): Promise<{
    advanced: NasdaqMarketMoverRow[];
    active: NasdaqMarketMoverRow[];
  }> {
    const url = new URL("https://api.nasdaq.com/api/marketmovers");
    url.searchParams.set("assetclass", "stocks");
    url.searchParams.set("limit", "50");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json,text/plain,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
          Origin: "https://www.nasdaq.com",
          Referer: "https://www.nasdaq.com/market-activity/most-active",
        },
      });
      if (!response.ok) {
        throw new Error(`Nasdaq market-movers request failed (${response.status}).`);
      }
      const body = await response.json() as {
        data?: {
          STOCKS?: {
            MostAdvanced?: { table?: { rows?: NasdaqMarketMoverRow[] } };
            MostActiveByShareVolume?: { table?: { rows?: NasdaqMarketMoverRow[] } };
          };
        };
      };
      return {
        advanced: Array.isArray(body.data?.STOCKS?.MostAdvanced?.table?.rows)
          ? body.data.STOCKS.MostAdvanced.table.rows
          : [],
        active: Array.isArray(body.data?.STOCKS?.MostActiveByShareVolume?.table?.rows)
          ? body.data.STOCKS.MostActiveByShareVolume.table.rows
          : [],
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchStockAnalysisAfterhoursGainers(
    expectedDate: string,
  ): Promise<AutoWatchlistDiscoveryCandidate[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetchImpl("https://stockanalysis.com/markets/afterhours/gainers/", {
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
        },
      });
      if (!response.ok) {
        throw new Error(`after-hours gainers request failed (${response.status}).`);
      }
      return parseStockAnalysisAfterhoursGainers(await response.text(), expectedDate);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchStockAnalysisPremarketGainers(
    expectedDate: string,
  ): Promise<AutoWatchlistDiscoveryCandidate[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetchImpl("https://stockanalysis.com/markets/premarket/gainers/", {
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
        },
      });
      if (!response.ok) {
        throw new Error(`premarket gainers request failed (${response.status}).`);
      }
      return parseStockAnalysisPremarketGainers(await response.text(), expectedDate);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchStockAnalysisRegularGainers(
    expectedDate: string,
  ): Promise<AutoWatchlistDiscoveryCandidate[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetchImpl("https://stockanalysis.com/markets/gainers/", {
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
        },
      });
      if (!response.ok) {
        throw new Error(`regular-hours gainers request failed (${response.status}).`);
      }
      return parseStockAnalysisRegularGainers(await response.text(), expectedDate);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchTradingViewGainers(
    session: Exclude<AutoWatchlistSession, "closed">,
  ): Promise<AutoWatchlistDiscoveryCandidate[]> {
    const path = session === "premarket"
      ? "market-movers-pre-market-gainers"
      : session === "postmarket"
        ? "market-movers-after-hours-gainers"
        : "market-movers-gainers";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetchImpl(`https://www.tradingview.com/markets/stocks-usa/${path}/`, {
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
        },
      });
      if (!response.ok) {
        throw new Error(`TradingView ${session} gainers request failed (${response.status}).`);
      }
      return parseTradingViewGainers(await response.text(), session);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchLiveExchangeCandidates(): Promise<AutoWatchlistDiscoveryCandidate[]> {
    const url = new URL("https://api.nasdaq.com/api/screener/stocks");
    url.searchParams.set("download", "true");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json,text/plain,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
          Origin: "https://www.nasdaq.com",
          Referer: "https://www.nasdaq.com/market-activity/stocks/screener",
        },
      });
      if (!response.ok) {
        throw new Error(`Live exchange screener failed (${response.status}).`);
      }
      const body = await response.json() as { data?: { rows?: NasdaqRawScreenerRow[] } };
      if (!Array.isArray(body.data?.rows)) {
        throw new Error("Live exchange screener did not return stock rows.");
      }
      this.liveExchangeDiscoveryAvailable = true;
      const commonCandidates = body.data.rows
        .map(normalizeNasdaqRow)
        .filter((row) => row.isLikelyCommonEquity)
        .map((row): AutoWatchlistDiscoveryCandidate => ({
          symbol: row.symbol,
          price: finitePositive(Number(row.lastSale.replace(/[^0-9.-]/g, ""))),
          gainPct: finiteNumber(Number(row.percentChange.replace(/[^0-9.-]/g, ""))),
          volume: finitePositive(row.volume),
          averageVolume: null,
          marketCap: finitePositive(row.marketCap),
          // The screener response does not expose an actual trade timestamp.
          // Session activity or a timestamped quote may fill this later, but
          // fetch time must never masquerade as market-event time.
          quoteTime: null,
          sourceScreens: ["live_exchange_screener"],
        }))
        .filter((candidate) =>
          (candidate.marketCap ?? Number.POSITIVE_INFINITY) <= this.thresholds.maxMarketCap,
        );
      const candidates = commonCandidates.filter((candidate) =>
        candidate.price !== null &&
        candidate.price >= this.thresholds.minPrice &&
        candidate.price <= this.thresholds.maxPrice &&
        (candidate.volume ?? 0) >= this.thresholds.minVolume,
      );
      const session = autoWatchlistSessionForTimestamp(this.now());
      const commonBySymbol = new Map(commonCandidates.map((candidate) => [candidate.symbol, candidate]));
      const marketMoversBySymbol = new Map<string, AutoWatchlistDiscoveryCandidate>();
      const mergeMovers = (movers: AutoWatchlistDiscoveryCandidate[]) => {
        for (const mover of movers) {
          const existing = marketMoversBySymbol.get(mover.symbol) ?? commonBySymbol.get(mover.symbol);
          marketMoversBySymbol.set(mover.symbol, {
            ...(existing ?? mover),
            price: mover.price ?? existing?.price ?? null,
            gainPct: mover.gainPct ?? existing?.gainPct ?? null,
            volume: mover.volume ?? existing?.volume ?? null,
            marketCap: mover.marketCap ?? existing?.marketCap ?? null,
            sourceScreens: [
              ...new Set([
                ...(existing?.sourceScreens ?? []),
                ...mover.sourceScreens,
              ]),
            ],
          });
        }
      };
      let nasdaqAvailable = false;
      let nasdaqError: string | null = null;
      let nasdaqGainers: AutoWatchlistDiscoveryCandidate[] = [];
      let stockAnalysisAvailable = false;
      let stockAnalysisError: string | null = null;
      let stockAnalysisGainers: AutoWatchlistDiscoveryCandidate[] = [];
      try {
        const movers = await this.fetchNasdaqMarketMovers();
        nasdaqAvailable = true;
        for (const [rows, source] of [
          [movers.advanced, "nasdaq_live_most_advanced"],
          [movers.active, "nasdaq_live_most_active"],
        ] as const) {
          for (const [rowIndex, row] of rows.entries()) {
            const symbol = normalizeSymbol(String(row.symbol ?? ""));
            const existing = marketMoversBySymbol.get(symbol) ?? commonBySymbol.get(symbol);
            const identity = normalizeNasdaqRow({
              symbol,
              name: row.name,
              // Market-mover rows do not contain market cap. Use a positive
              // sentinel only for the existing name/symbol security-type
              // classifier; enrichment still owns the real market-cap value.
              marketCap: 1,
            });
            if (!existing && !identity.isLikelyCommonEquity) continue;
            const base: AutoWatchlistDiscoveryCandidate = existing ?? {
              symbol,
              price: null,
              gainPct: null,
              volume: null,
              averageVolume: null,
              marketCap: null,
              quoteTime: null,
              sourceScreens: [],
            };
            const moverPrice = finitePositive(Number(String(row.lastSalePrice ?? "").replace(/[^0-9.-]/g, "")));
            const moverGain = source === "nasdaq_live_most_advanced"
              ? finiteNumber(Number(String(row.change ?? "").replace(/[^0-9.-]/g, "")))
              : null;
            const moverVolume = source === "nasdaq_live_most_active"
              ? finitePositive(Number(String(row.change ?? "").replace(/[^0-9.-]/g, "")))
              : null;
            marketMoversBySymbol.set(symbol, {
              ...base,
              price: moverPrice ?? base.price,
              gainPct: moverGain ?? base.gainPct,
              volume: moverVolume ?? base.volume,
              sourceScreens: [
                ...new Set([
                  ...base.sourceScreens,
                  source,
                  ...(source === "nasdaq_live_most_advanced" && rowIndex < 5
                    ? [NASDAQ_TOP_FIVE_GAINER_SOURCE]
                    : []),
                ]),
              ],
            });
          }
        }
        nasdaqGainers = [...marketMoversBySymbol.values()]
          .filter((candidate) => candidate.sourceScreens.includes("nasdaq_live_most_advanced"))
          .sort((left, right) => (right.gainPct ?? 0) - (left.gainPct ?? 0));
      } catch (error) {
        nasdaqError = error instanceof Error ? error.message : String(error);
        console.warn(
          `[AutoWatchlistSelector] Nasdaq live market movers unavailable; using the regular screener fallback: ${nasdaqError}`,
        );
      }
      if (session === "premarket") {
        try {
          stockAnalysisGainers = await this.fetchStockAnalysisPremarketGainers(easternParts(this.now()).date);
          stockAnalysisAvailable = true;
          const observedAt = this.now();
          this.options.onPremarketVolumeSnapshot?.(
            stockAnalysisGainers
              .filter((mover) => mover.volume !== null && mover.volume > 0)
              .map((mover) => ({
                symbol: mover.symbol,
                cumulativeVolume: mover.volume!,
                observedAt,
              })),
          );
          mergeMovers(stockAnalysisGainers);
        } catch (error) {
          stockAnalysisError = error instanceof Error ? error.message : String(error);
          console.warn(
            `[AutoWatchlistSelector] Direct premarket gainers unavailable; retaining Nasdaq and rotating probe discovery: ${stockAnalysisError}`,
          );
        }
      }
      if (session === "regular") {
        try {
          stockAnalysisGainers = await this.fetchStockAnalysisRegularGainers(easternParts(this.now()).date);
          stockAnalysisAvailable = true;
          mergeMovers(stockAnalysisGainers);
        } catch (error) {
          stockAnalysisError = error instanceof Error ? error.message : String(error);
          console.warn(
            `[AutoWatchlistSelector] Direct regular-hours gainers unavailable; retaining Nasdaq discovery: ${stockAnalysisError}`,
          );
        }
      }
      if (session === "postmarket") {
        try {
          stockAnalysisGainers = await this.fetchStockAnalysisAfterhoursGainers(easternParts(this.now()).date);
          stockAnalysisAvailable = true;
          mergeMovers(stockAnalysisGainers);
        } catch (error) {
          stockAnalysisError = error instanceof Error ? error.message : String(error);
          console.warn(
            `[AutoWatchlistSelector] Direct after-hours gainers unavailable; retaining rotating probe discovery: ${stockAnalysisError}`,
          );
        }
      }
      if (session !== "closed") {
        try {
          mergeMovers(await this.fetchTradingViewGainers(session));
        } catch (error) {
          console.warn(
            `[AutoWatchlistSelector] TradingView ${session} gainers unavailable; retaining other discovery feeds: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (session === "premarket" || session === "postmarket") {
        const candidateLimit = this.thresholds.extendedSessionCandidateLimit;
        const explorationSlots = Math.floor(candidateLimit / 4);
        const extendedUniverse = selectExtendedSessionProbeCandidates({
          candidates,
          explorationCandidates: commonCandidates,
          marketMovers: [...marketMoversBySymbol.values()],
          limit: candidateLimit,
          thresholds: this.thresholds,
          explorationStartIndex: this.extendedSessionExplorationCursor,
        });
        if (commonCandidates.length > 0 && explorationSlots > 0) {
          this.extendedSessionExplorationCursor =
            (this.extendedSessionExplorationCursor + explorationSlots) % commonCandidates.length;
        }
        const activities = await this.lookupSessionActivities(extendedUniverse, session, this.now());
        if (session === "premarket") {
          this.lastDiscoveryFeedComparison = buildAutoWatchlistDiscoveryFeedComparison({
            checkedAt: this.now(),
            nasdaqAvailable,
            nasdaqError,
            nasdaqCandidates: nasdaqGainers,
            stockAnalysisAvailable,
            stockAnalysisError,
            stockAnalysisCandidates: stockAnalysisGainers,
            activities,
          });
        }
        return extendedUniverse
          .map((candidate) => {
            const activity = activities.get(candidate.symbol);
            return activity?.available
              ? {
                  ...candidate,
                  price: activity.price,
                  gainPct: activity.gainPct,
                  volume: activity.sessionVolume,
                  quoteTime: activity.quoteTime,
                  sourceScreens: [
                    ...new Set([...candidate.sourceScreens, `live_exchange_${session}_activity`]),
                  ],
                }
              : candidate;
          })
          .filter((candidate) => (candidate.gainPct ?? 0) > 0)
          .sort((left, right) => (right.gainPct ?? 0) - (left.gainPct ?? 0))
          .slice(0, 50);
      }
      this.lastDiscoveryFeedComparison = null;
      const liveBySymbol = new Map(marketMoversBySymbol);
      for (const candidate of [...candidates].sort(
        (left, right) => (right.gainPct ?? 0) - (left.gainPct ?? 0),
      )) {
        if (!liveBySymbol.has(candidate.symbol)) {
          liveBySymbol.set(candidate.symbol, candidate);
        }
      }
      return [...liveBySymbol.values()]
        .filter((candidate) => (candidate.gainPct ?? 0) > 0)
        .sort((left, right) => (right.gainPct ?? 0) - (left.gainPct ?? 0))
        .slice(0, 50);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async discoverCandidates(): Promise<AutoWatchlistDiscoveryCandidate[]> {
    try {
      const liveCandidates = await this.fetchLiveExchangeCandidates();
      this.lastDiscoveryError = null;
      if (liveCandidates.length > 0) {
        this.lastDiscoverySources = [...new Set(liveCandidates.flatMap((candidate) => candidate.sourceScreens))];
        return liveCandidates;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.liveExchangeDiscoveryAvailable = false;
      this.lastDiscoveryError = message;
      console.warn(`[AutoWatchlistSelector] Live exchange discovery unavailable; using Yahoo fallback: ${message}`);
    }

    const screens = ["small_cap_gainers", "aggressive_small_caps"];
    const results = await Promise.allSettled(screens.map((screen) => this.fetchScreen(screen)));
    const merged = new Map<string, AutoWatchlistDiscoveryCandidate>();
    let successfulScreens = 0;
    for (const [index, result] of results.entries()) {
      if (result.status !== "fulfilled") {
        continue;
      }
      successfulScreens += 1;
      const screen = screens[index];
      for (const quote of result.value) {
        const symbol = normalizeSymbol(quote.symbol);
        if (!symbol || quote.quoteType?.toUpperCase() !== "EQUITY") {
          continue;
        }
        const existing = merged.get(symbol);
        const sourceScreens = existing?.sourceScreens ?? [];
        if (!sourceScreens.includes(screen)) {
          sourceScreens.push(screen);
        }
        merged.set(symbol, {
          symbol,
          price: finitePositive(quote.regularMarketPrice),
          gainPct: finiteNumber(quote.regularMarketChangePercent),
          volume: finitePositive(quote.regularMarketVolume),
          averageVolume: finitePositive(quote.averageDailyVolume3Month),
          marketCap: finitePositive(quote.marketCap),
          quoteTime: finitePositive(quote.regularMarketTime),
          sourceScreens,
        });
      }
    }
    if (successfulScreens === 0) {
      this.yahooDiscoveryAvailable = false;
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
      throw new Error(errors.join("; ") || "Yahoo candidate screens were unavailable.");
    }
    this.yahooDiscoveryAvailable = true;
    this.lastDiscoverySources = screens.filter((_, index) => results[index]?.status === "fulfilled");
    return [...merged.values()]
      .filter((candidate) => (candidate.gainPct ?? 0) > 0)
      .sort((left, right) => (right.gainPct ?? 0) - (left.gainPct ?? 0))
      .slice(0, 50);
  }

  private async enrichAndScore(
    candidate: AutoWatchlistDiscoveryCandidate,
    recordPassingObservation: boolean,
    catalystContext: PressReleaseCatalystContext,
    referenceDate: string,
    session: AutoWatchlistSession,
    activity: AutoWatchlistSessionActivity | null,
    tradingHalt: NasdaqTradingHaltRecord | null,
    tradingHaltChecked: boolean,
  ): Promise<AutoWatchlistCandidateDecision> {
    const [yahooResult, finnhubResult] = await Promise.allSettled([
      this.options.yahooClient?.getSummary(candidate.symbol) ?? Promise.resolve(null),
      this.options.finnhubClient?.getCompanyProfile(candidate.symbol) ?? Promise.resolve(null),
    ]);
    const yahoo = yahooResult.status === "fulfilled" ? yahooResult.value : null;
    const finnhub = finnhubResult.status === "fulfilled" ? finnhubResult.value : null;
    const scored = scoreAutoWatchlistCandidate({
      candidate: {
        ...candidate,
        marketCap:
          finitePositive(yahoo?.marketCap) ??
          (finitePositive(finnhub?.marketCapitalization)
            ? finnhub!.marketCapitalization! * 1_000_000
            : null) ??
          candidate.marketCap,
      },
      floatShares: yahoo?.floatShares,
      finnhubFloatShares: finitePositive(finnhub?.floatingShare)
        ? finnhub!.floatingShare! * 1_000_000
        : null,
      yahooSharesOutstanding: yahoo?.sharesOutstanding,
      finnhubSharesOutstanding: finitePositive(finnhub?.shareOutstanding)
        ? finnhub!.shareOutstanding! * 1_000_000
        : null,
      thresholds: this.thresholds,
      session,
      activity,
    });
    const observationTimestamp = this.now();
    const priorPassSession = this.consecutivePassSessions.get(candidate.symbol);
    const priorPassObservedAt = this.consecutivePassObservedAt.get(candidate.symbol);
    const canCarryPriorPasses =
      priorPassObservedAt !== undefined &&
      observationTimestamp - priorPassObservedAt <= CONSECUTIVE_PASS_MAX_GAP_MS &&
      (
        priorPassSession === session ||
        (priorPassSession === "premarket" && session === "regular")
      );
    const currentPasses = canCarryPriorPasses
      ? this.consecutivePasses.get(candidate.symbol) ?? 0
      : 0;
    const nextPasses = recordPassingObservation
      ? scored.qualified
        ? currentPasses + 1
        : 0
      : currentPasses;
    if (recordPassingObservation) {
      if (nextPasses > 0) {
        this.consecutivePasses.set(candidate.symbol, nextPasses);
        this.consecutivePassSessions.set(candidate.symbol, session);
        this.consecutivePassObservedAt.set(candidate.symbol, observationTimestamp);
      } else {
        this.consecutivePasses.delete(candidate.symbol);
        this.consecutivePassSessions.delete(candidate.symbol);
        this.consecutivePassObservedAt.delete(candidate.symbol);
      }
    }
    const ranking = rankingFields({
      context: catalystContext,
      referenceDate,
      baseScore: scored.score,
      session,
      activity,
      effectiveShares: scored.effectiveShares,
      dollarVolume: finitePositive(activity?.sessionDollarVolume) ??
        (scored.price ?? 0) * (scored.volume ?? 0),
      thresholds: this.thresholds,
    });
    const promotionRejectionReasons = postmarketPromotionRejectionReasons({
      qualified: scored.qualified,
      session,
      gainPct: scored.gainPct,
      recent15mDollarVolume: activity?.recent15mDollarVolume ?? null,
      thresholds: this.thresholds,
    });
    const slotSurvival = buildAutoWatchlistSlotSurvivalScore({
      rankingScore: ranking.rankingScore,
      gainPct: scored.gainPct,
    });
    const decision: AutoWatchlistCandidateDecision = {
      ...scored,
      ...ranking,
      ...slotSurvival,
      promotionReady: scored.qualified && promotionRejectionReasons.length === 0,
      promotionRejectionReasons,
      session,
      sessionVolume: activity?.sessionVolume ?? null,
      mainSessionVolume: activity?.mainSessionVolume ?? null,
      sessionDollarVolume: activity?.sessionDollarVolume ?? null,
      recent15mVolume: activity?.recent15mVolume ?? null,
      recent15mDollarVolume: activity?.recent15mDollarVolume ?? null,
      sessionElapsedMinutes: activity?.sessionElapsedMinutes ?? null,
      mainSessionElapsedMinutes: activity?.mainSessionElapsedMinutes ?? null,
      volumeAcceleration: activity?.volumeAcceleration ?? null,
      activityQuoteAgeMinutes: activity?.quoteAgeMinutes ?? null,
      activityDataAvailable: activity?.available === true,
      tradingHaltState: tradingHalt?.state ?? (
        tradingHaltChecked
          ? this.tradingHaltFeedAvailable ? "not_found" : "unavailable"
          : "not_checked"
      ),
      tradingHaltReasonCode: tradingHalt?.reasonCode ?? null,
      haltRetentionProtected: false,
      haltRetentionProtectionReason: null,
      consecutivePasses: nextPasses,
    };
    const haltProtection = buildAutoWatchlistRetentionProtection({
      decision,
      entry: { lastQualifiedAt: null },
      thresholds: this.thresholds,
      now: this.now(),
    });
    decision.haltRetentionProtected = haltProtection.kind === "confirmed_halt";
    decision.haltRetentionProtectionReason = decision.haltRetentionProtected
      ? haltProtection.reason
      : null;
    if (
      recordPassingObservation &&
      decision.promotionReady &&
      nextPasses === 1 &&
      !this.firstPassEvidence.has(candidate.symbol)
    ) {
      this.firstPassEvidence.set(candidate.symbol, {
        symbol: candidate.symbol,
        observedAt: observationTimestamp,
        session,
        rankingScore: decision.rankingScore,
        slotSurvivalScore: decision.slotSurvivalScore,
        gainPct: decision.gainPct,
        recent15mDollarVolume: decision.recent15mDollarVolume,
        volumeAcceleration: decision.volumeAcceleration,
        shareTurnoverPct: decision.shareTurnoverPct,
        sourceScreens: [...decision.sourceScreens],
      });
    }
    return decision;
  }

  private async lookupCatalysts(
    candidates: AutoWatchlistDiscoveryCandidate[],
    referenceDate: string,
  ): Promise<Map<string, PressReleaseCatalystContext>> {
    const contexts = new Map<string, PressReleaseCatalystContext>();
    let lookup: PressReleaseCatalystLookupResult;
    try {
      lookup = await this.catalystLookup({
        symbols: candidates.map((candidate) => candidate.symbol),
        minReferenceDate: referenceDate,
        maxReferenceDate: referenceDate,
        lookbackDays: this.thresholds.catalystLookbackDays,
        enabled: true,
      });
    } catch (error) {
      lookup = {
        available: false,
        error: error instanceof Error ? error.message : String(error),
        articlesBySymbol: {},
      };
    }
    this.pressReleaseCatalystAvailable = lookup.available;
    this.lastCatalystLookupError = lookup.available ? null : lookup.error ?? "lookup unavailable";
    for (const candidate of candidates) {
      const articles = lookup.articlesBySymbol[candidate.symbol] ?? [];
      contexts.set(candidate.symbol, derivePressReleaseCatalystContext({
        symbol: candidate.symbol,
        articles,
        referenceDate,
        lookbackDays: this.thresholds.catalystLookbackDays,
      }));
    }
    return contexts;
  }

  private async runScan(activate: boolean): Promise<void> {
    if (this.scanPromise) {
      await this.scanPromise;
      return;
    }
    const scanPromise = this.executeScan(activate);
    this.scanPromise = scanPromise;
    try {
      await scanPromise;
    } finally {
      if (this.scanPromise === scanPromise) {
        this.scanPromise = null;
      }
    }
  }

  private async executeScan(activate: boolean): Promise<void> {
    this.running = true;
    const scanStartedAt = this.now();
    this.lastScanAt = scanStartedAt;
    this.lastScanCandidateCount = 0;
    this.lastEvaluatedCount = 0;
    this.lastQualifiedCount = 0;
    this.lastAddedSymbols = [];
    this.lastActivationErrors = [];
    this.lastError = null;
    this.lastDiscoverySources = [];
    this.recentDecisions = [];
    this.prefetchedActivityBySymbol.clear();
    if (activate) {
      this.resetTradingDayIfNeeded(scanStartedAt);
    }
    try {
      const session = autoWatchlistSessionForTimestamp(scanStartedAt);
      const bucket = autoWatchlistBucketForSession(session);
      if (activate) {
        this.syncManagedEntriesFromRuntime(session, scanStartedAt);
      }
      const discovered = await this.discoverCandidates();
      this.lastScanCandidateCount = discovered.length;
      const enrichmentCandidates = discovered.slice(0, this.thresholds.enrichmentLimit);
      const evaluatedSymbols = new Set(enrichmentCandidates.map((candidate) => candidate.symbol));
      const retainedEntries = [
        ...this.managedEntriesFor(bucket, "active"),
        ...this.managedEntriesFor(undefined, "followup"),
      ];
      for (const entry of retainedEntries) {
        if (evaluatedSymbols.has(entry.symbol)) continue;
        enrichmentCandidates.push({
          symbol: entry.symbol,
          price: null,
          gainPct: null,
          volume: null,
          averageVolume: null,
          marketCap: null,
          quoteTime: null,
          sourceScreens: [entry.state === "followup" ? "followup_auto_retention_check" : "active_auto_retention_check"],
        });
        evaluatedSymbols.add(entry.symbol);
      }
      this.lastEvaluatedCount = enrichmentCandidates.length;
      const activities = await this.lookupSessionActivities(enrichmentCandidates, session, scanStartedAt);
      const haltCheckSymbols = new Set(
        retainedEntries
          .filter((entry) => activityNeedsTradingHaltCheck(
            activities.get(entry.symbol),
            session,
            this.thresholds,
          ))
          .map((entry) => entry.symbol),
      );
      const tradingHalts = await this.lookupTradingHalts([...haltCheckSymbols], scanStartedAt);
      const referenceDate = easternParts(scanStartedAt).date;
      const catalystContexts = await this.lookupCatalysts(enrichmentCandidates, referenceDate);
      const securityMasterBySymbol = new Map<string, CommonEquitySecurityMasterStatus>();
      if (this.requireVerifiedCommonEquity) {
        try {
          const securityMaster = await this.securityMasterLookup({
            symbols: enrichmentCandidates.map((candidate) => candidate.symbol),
          });
          this.commonEquitySecurityMasterAvailable = securityMaster.available;
          this.commonEquitySecurityMasterCheckedAt = securityMaster.checkedAt;
          this.commonEquitySecurityMasterCacheUsed = securityMaster.cacheUsed;
          this.lastSecurityMasterError = securityMaster.error;
          for (const [symbol, verification] of Object.entries(securityMaster.bySymbol)) {
            securityMasterBySymbol.set(normalizeSymbol(symbol), verification.status);
          }
        } catch (error) {
          this.commonEquitySecurityMasterAvailable = false;
          this.commonEquitySecurityMasterCheckedAt = this.now();
          this.commonEquitySecurityMasterCacheUsed = false;
          this.lastSecurityMasterError = error instanceof Error ? error.message : String(error);
        }
      } else {
        this.commonEquitySecurityMasterAvailable = false;
        this.commonEquitySecurityMasterCheckedAt = null;
        this.commonEquitySecurityMasterCacheUsed = null;
        this.lastSecurityMasterError = null;
      }
      const decisions: AutoWatchlistCandidateDecision[] = [];
      for (const candidate of enrichmentCandidates) {
        const activity = activities.get(candidate.symbol) ?? null;
        const sessionCandidate = activity?.available
          ? {
              ...candidate,
              price: activity.price ?? candidate.price,
              gainPct: activity.gainPct ?? candidate.gainPct,
              volume: activity.sessionVolume ?? candidate.volume,
              quoteTime: activity.quoteTime ?? candidate.quoteTime,
            }
          : candidate;
        const verifiedSessionCandidate = this.requireVerifiedCommonEquity
          ? {
              ...sessionCandidate,
              securityMasterStatus: securityMasterBySymbol.get(candidate.symbol) ?? "unavailable" as const,
            }
          : sessionCandidate;
        decisions.push(await this.enrichAndScore(
          verifiedSessionCandidate,
          activate,
          catalystContexts.get(candidate.symbol) ?? derivePressReleaseCatalystContext({
            symbol: candidate.symbol,
            articles: [],
            referenceDate,
            lookbackDays: this.thresholds.catalystLookbackDays,
          }),
          referenceDate,
          session,
          activity,
          tradingHalts.get(candidate.symbol) ?? null,
          haltCheckSymbols.has(candidate.symbol),
        ));
      }
      if (activate) {
        await this.revalidatePromotionCandidatesBeforeActivation(decisions, session);
      }
      this.recentDecisions = decisions.sort(compareAutoWatchlistDecisions);
      if (activate) {
        const evaluatedDecisionSymbols = new Set(decisions.map((decision) => decision.symbol));
        for (const symbol of this.consecutivePasses.keys()) {
          if (!evaluatedDecisionSymbols.has(symbol)) {
            this.consecutivePasses.delete(symbol);
            this.consecutivePassSessions.delete(symbol);
            this.consecutivePassObservedAt.delete(symbol);
          }
        }
      }
      const qualified = this.recentDecisions.filter((decision) => decision.qualified);
      this.lastQualifiedCount = qualified.length;
      if (activate) {
        const decisionBySymbol = new Map(decisions.map((decision) => [decision.symbol, decision]));
        await this.enforceActiveSlotLimits(scanStartedAt, ["main", "postmarket"], decisionBySymbol);
        for (const entry of [
          ...this.managedEntriesFor(undefined, "active"),
          ...this.managedEntriesFor(undefined, "followup"),
        ]) {
          const decision = decisionBySymbol.get(entry.symbol);
          const current = this.managedEntries.get(entry.symbol);
          if (decision && current) {
            this.updateManagedRunnerEvidence(current, decision, scanStartedAt);
            this.updateReversalAttemptEvidence(current, decision, scanStartedAt);
            this.managedEntries.set(current.symbol, current);
          }
        }
        for (const entry of this.managedEntriesFor(bucket, "active")) {
          const current = this.managedEntries.get(entry.symbol)!;
          const decision = decisionBySymbol.get(entry.symbol);
          const retentionProtection = decision
            ? buildAutoWatchlistRetentionProtection({
                decision,
                entry: current,
                thresholds: this.thresholds,
                now: scanStartedAt,
              })
            : { protected: false, kind: null, reason: null } as const;
          const deadReversalCandidate = this.isDeadReversalCandidate(current, decision);
          current.lastSession = session;
          if ((decision?.qualified && !deadReversalCandidate) || retentionProtection.protected) {
            current.retentionFailures = 0;
            if (decision) {
              if (decision.qualified) current.lastQualifiedAt = scanStartedAt;
              current.lastRankingScore = decision.rankingScore;
              current.lastSlotSurvivalScore = decision.slotSurvivalScore;
            }
            const newlyEarnedHoldReason =
              decision?.qualified && current.holdProtectionEarnedAt === null
                ? this.automaticHoldQualification(decision)
                : null;
            if (newlyEarnedHoldReason) {
              current.holdProtectionEarnedAt = this.now();
              current.holdProtectionReason = newlyEarnedHoldReason;
            }
            const newlyEarnedReversalWatchReason =
              decision?.qualified && current.reversalWatchQualifiedAt === null
                ? this.reversalWatchQualification(decision, current)
                : null;
            if (newlyEarnedReversalWatchReason) {
              current.reversalWatchQualifiedAt = this.now();
              current.reversalWatchQualificationReason = newlyEarnedReversalWatchReason;
            }
            current.statusReason = retentionProtection.reason ?? (
              newlyEarnedHoldReason
                ? `retained and ${newlyEarnedHoldReason}`
                : "retained: still meets automatic selection requirements"
            );
          } else {
            current.retentionFailures += 1;
            if (decision) {
              current.lastRankingScore = decision.rankingScore;
              current.lastSlotSurvivalScore = decision.slotSurvivalScore;
            }
            current.statusReason = deadReversalCandidate
              ? `dead reversal warning ${current.retentionFailures}/${this.retentionFailuresRequiredForEntry(current)}: gain has retraced at least half of the peak and volume acceleration remains below 1x`
              : `retention warning ${current.retentionFailures}/${this.retentionFailuresRequiredForEntry(current)}: ${decision?.rejectionReasons.join("; ") || "no current activity evidence"}`;
          }
        }

        for (const entry of this.managedEntriesFor(undefined, "followup")
          .filter((candidate) =>
            candidate.reversalWatchQualifiedAt === null &&
            decisionBySymbol.get(candidate.symbol)?.haltRetentionProtected
          )
          .sort((left, right) => right.lastSlotSurvivalScore - left.lastSlotSurvivalScore)) {
          if (
            this.managedEntriesFor(entry.bucket, "active").length >=
            this.activeSlotLimit(entry.bucket)
          ) continue;
          const decision = decisionBySymbol.get(entry.symbol);
          if (decision) {
            await this.restoreManagedFollowupAfterConfirmedHalt(decision, entry);
          }
        }

        if (this.options.setSymbolFollowup) {
          const runtimeReversalWatchSymbols = new Set(
            this.runtimeEntries()
              .filter((runtimeEntry) => runtimeEntry.tags?.includes("auto-reversal-watch"))
              .map((runtimeEntry) => runtimeEntry.symbol),
          );
          const runtimeReversalAttemptSymbols = new Set(
            this.runtimeEntries()
              .filter((runtimeEntry) => runtimeEntry.tags?.includes("auto-reversal-attempt-ready"))
              .map((runtimeEntry) => runtimeEntry.symbol),
          );
          for (const entry of this.managedEntriesFor(undefined, "followup")) {
            const currentDecision = decisionBySymbol.get(entry.symbol);
            const reversalWatchEligible = this.isReversalWatchEligibleNow(
              entry,
              currentDecision,
            );
            const reversalWatchAttemptReady =
              reversalWatchEligible && entry.reversalWatchAttemptReady;
            if (
              runtimeReversalWatchSymbols.has(entry.symbol) === reversalWatchEligible &&
              runtimeReversalAttemptSymbols.has(entry.symbol) === reversalWatchAttemptReady
            ) {
              continue;
            }
            try {
              await this.options.setSymbolFollowup(entry.symbol, true, {
                reversalWatchEligible,
                reversalWatchAttemptReady,
              });
            } catch (error) {
              this.lastActivationErrors.push({
                symbol: entry.symbol,
                error: `automatic reversal-watch refresh failed: ${error instanceof Error ? error.message : String(error)}`,
              });
            }
          }
        }

        const eligibleChallengers = qualified.filter((decision) => {
          const activeSymbols = new Set(this.options.getActiveSymbols().map(normalizeSymbol));
          const managed = this.managedEntries.get(decision.symbol);
          if (managed && managed.bucket !== bucket) return false;
          if (
            managed?.state === "followup" &&
            managed.reversalWatchQualifiedAt !== null
          ) return false;
          if (activeSymbols.has(decision.symbol) && managed?.state !== "followup") return false;
          if (!decision.promotionReady) return false;
          const requiredPasses = this.isFastTrackRunner(decision)
            ? 1
            : this.thresholds.consecutivePassesRequired;
          return decision.consecutivePasses >= requiredPasses;
        });
        const fadedFollowups: AutoWatchlistManagedEntry[] = [];
        if (this.thresholds.dynamicReplacementEnabled) {
          const faded = this.managedEntriesFor(bucket, "active")
            .filter((entry) =>
              entry.retentionFailures >= this.retentionFailuresRequiredForEntry(entry) &&
              !this.isProtectedIncumbent(entry, scanStartedAt, session),
            )
            .sort((left, right) =>
              right.retentionFailures - left.retentionFailures ||
              left.lastSlotSurvivalScore - right.lastSlotSurvivalScore,
            );
          for (const entry of faded) {
            const reason = `moved to follow-up after ${entry.retentionFailures} failed retention scans`;
            if (await this.moveManagedEntryToFollowup(
              entry,
              scanStartedAt,
              reason,
              decisionBySymbol.get(entry.symbol),
            )) {
              fadedFollowups.push(entry);
            }
          }
        }

        const pendingDepartures = this.pendingReplacementDepartures(bucket);
        const availableReplacementDepartures = [
          ...pendingDepartures,
          ...fadedFollowups.filter((departure) =>
            !pendingDepartures.some((pending) => pending.symbol === departure.symbol),
          ),
        ];
        const usedChallengers = new Set<string>();
        let activeManagedCount = this.managedEntriesFor(bucket, "active").length;
        for (const decision of eligibleChallengers) {
          if (activeManagedCount >= this.activeSlotLimit(bucket)) break;
          const alreadyAdded = this.sessionAddedSet(bucket).has(decision.symbol);
          for (let index = availableReplacementDepartures.length - 1; index >= 0; index -= 1) {
            const live = this.managedEntries.get(availableReplacementDepartures[index]!.symbol);
            if (
              !live ||
              live.state === "active" ||
              typeof live.vacatedSlotAt !== "number"
            ) {
              availableReplacementDepartures.splice(index, 1);
            } else {
              availableReplacementDepartures[index] = live;
            }
          }
          const departureIndex = alreadyAdded
            ? -1
            : availableReplacementDepartures.findIndex(
                (candidate) => candidate.symbol !== decision.symbol,
              );
          const departure = departureIndex >= 0
            ? availableReplacementDepartures.splice(departureIndex, 1)[0]
            : undefined;
          const isReplacement = Boolean(departure);
          const normalInitialAdditionLimitReached =
            !alreadyAdded &&
            !isReplacement &&
            this.sessionAddedSet(bucket).size >= this.initialAdditionLimit(bucket);
          const normalReplacementLimitReached =
            isReplacement &&
            this.replacementCount(bucket) >= this.replacementLimit(bucket);
          const usesLateMainSessionAdmissionReserve =
            normalInitialAdditionLimitReached || normalReplacementLimitReached;
          if (
            usesLateMainSessionAdmissionReserve &&
            !this.lateMainSessionAdmissionReserveAvailable(bucket, scanStartedAt)
          ) {
            if (departure) {
              availableReplacementDepartures.splice(departureIndex, 0, departure);
            }
            continue;
          }
          const managedChallenger = this.managedEntries.get(decision.symbol);
          const reason = departure
            ? `filled the active slot vacated by ${departure.symbol} after confirmed fading`
            : managedChallenger?.state === "followup"
              ? "returned from follow-up after renewed qualification"
              : alreadyAdded
                ? "reactivated from standby after renewed qualification"
                : "filled an available automatic slot";
          const activationTimestamp = this.now();
          const activated = managedChallenger?.state === "followup"
            ? await this.promoteManagedFollowupDecision(decision, managedChallenger, activationTimestamp)
            : await this.activateManagedDecision(decision, bucket, activationTimestamp, reason);
          if (!activated) {
            if (departure) {
              availableReplacementDepartures.splice(departureIndex, 0, departure);
            }
            continue;
          }
          if (usesLateMainSessionAdmissionReserve) {
            this.consumeLateMainSessionAdmissionReserve();
          }
          usedChallengers.add(decision.symbol);
          activeManagedCount += 1;
          if (departure) {
            const liveDeparture = this.managedEntries.get(departure.symbol);
            if (liveDeparture) {
              liveDeparture.vacatedSlotAt = null;
              liveDeparture.statusReason = `${liveDeparture.statusReason}; active slot filled by ${decision.symbol}`;
              this.managedEntries.set(liveDeparture.symbol, liveDeparture);
            }
            this.recordReplacement(
              bucket,
              decision,
              departure,
              scanStartedAt,
              `${decision.symbol} filled the active slot vacated by ${departure.symbol}: challenger slot score ${decision.slotSurvivalScore.toFixed(1)}; former incumbent failed retention ${departure.retentionFailures} scans.`,
            );
            this.persistConfig();
          }
        }

        if (
          this.thresholds.dynamicReplacementEnabled &&
          activeManagedCount >= this.activeSlotLimit(bucket) &&
          this.replacementAdmissionCapacityAvailable(bucket, scanStartedAt)
        ) {
          for (const challenger of eligibleChallengers.filter((decision) =>
            !usedChallengers.has(decision.symbol) && !this.isFastTrackRunner(decision),
          )) {
            const incumbent = this.managedEntriesFor(bucket, "active")
              .filter((entry) =>
                entry.symbol !== challenger.symbol &&
                entry.retentionFailures > 0 &&
                !this.isProtectedIncumbent(entry, scanStartedAt, session),
              )
              .sort((left, right) =>
                right.retentionFailures - left.retentionFailures ||
                left.lastSlotSurvivalScore - right.lastSlotSurvivalScore,
              )[0];
            if (!incumbent) break;
            if (
              challenger.slotSurvivalScore <
              incumbent.lastSlotSurvivalScore + this.thresholds.replacementRankingMargin
            ) {
              continue;
            }
            const reason = `stronger sustained runner over at-risk ${incumbent.symbol}`;
            const usesLateMainSessionAdmissionReserve =
              this.replacementCount(bucket) >= this.replacementLimit(bucket);
            if (!await this.replaceManagedDecision(
              challenger,
              incumbent,
              bucket,
              this.now(),
              reason,
              decisionBySymbol.get(incumbent.symbol),
            )) continue;
            if (usesLateMainSessionAdmissionReserve) {
              this.consumeLateMainSessionAdmissionReserve();
            }
            this.recordReplacement(
              bucket,
              challenger,
              incumbent,
              scanStartedAt,
              `${challenger.symbol} replaced ${incumbent.symbol}: slot score ${challenger.slotSurvivalScore.toFixed(1)} versus ${incumbent.lastSlotSurvivalScore.toFixed(1)} after ${incumbent.retentionFailures} failed retention scan(s).`,
            );
            usedChallengers.add(challenger.symbol);
            break;
          }
        }

        const standardFastTrackCapacityAvailable = this.replacementAdmissionCapacityAvailable(
          bucket,
          scanStartedAt,
          {
            // The daily limit prevents ordinary list churn. It must not hide a
            // verified late Main-session runner merely because earlier replacements used
            // the normal allowance and late-session reserve.
            allowMainSessionFastTrackOverride: true,
          },
        );
        const postmarketExtremeOverrideAvailable =
          this.postmarketExtremeRunnerOverrideAvailable(bucket);
        if (
          this.thresholds.dynamicReplacementEnabled &&
          activeManagedCount >= this.activeSlotLimit(bucket) &&
          (standardFastTrackCapacityAvailable || postmarketExtremeOverrideAvailable)
        ) {
          for (const challenger of eligibleChallengers.filter((decision) =>
            !usedChallengers.has(decision.symbol) &&
            this.isFastTrackRunner(decision) &&
            (
              standardFastTrackCapacityAvailable ||
              (postmarketExtremeOverrideAvailable && this.isExtremeRunner(decision))
            ),
          )) {
            const incumbent = this.managedEntriesFor(bucket, "active")
              .filter((entry) =>
                entry.symbol !== challenger.symbol &&
                !this.isProtectedIncumbent(entry, scanStartedAt, session),
              )
              .sort((left, right) => left.lastSlotSurvivalScore - right.lastSlotSurvivalScore)[0];
            if (!incumbent) break;
            if (
              challenger.slotSurvivalScore <
              incumbent.lastSlotSurvivalScore + this.thresholds.obviousRunnerReplacementMargin
            ) {
              continue;
            }
            const fastTrackLabel = this.isExtremeRunner(challenger)
              ? "verified extreme runner"
              : "obvious runner";
            const reason = `${fastTrackLabel} override over ${incumbent.symbol}`;
            const usesLateMainSessionAdmissionReserve =
              this.replacementCount(bucket) >= this.replacementLimit(bucket) &&
              this.lateMainSessionAdmissionReserveAvailable(bucket, scanStartedAt);
            const usesPostmarketExtremeRunnerOverride =
              bucket === "postmarket" &&
              this.replacementCount(bucket) >= this.replacementLimit(bucket) &&
              this.isExtremeRunner(challenger);
            if (!await this.replaceManagedDecision(
              challenger,
              incumbent,
              bucket,
              this.now(),
              reason,
              decisionBySymbol.get(incumbent.symbol),
            )) continue;
            if (usesLateMainSessionAdmissionReserve) {
              this.consumeLateMainSessionAdmissionReserve();
            }
            this.recordReplacement(
              bucket,
              challenger,
              incumbent,
              scanStartedAt,
              `${challenger.symbol} replaced ${incumbent.symbol}: ${fastTrackLabel} slot score ${challenger.slotSurvivalScore.toFixed(1)} versus ${incumbent.lastSlotSurvivalScore.toFixed(1)}, with $${Math.round((challenger.recent15mDollarVolume ?? 0) / 1_000)}K last-15m dollar volume, ${(challenger.shareTurnoverPct ?? 0).toFixed(1)}% turnover${challenger.volumeAcceleration !== null ? `, and ${challenger.volumeAcceleration.toFixed(1)}x acceleration` : ""}.`,
              usesPostmarketExtremeRunnerOverride ? "postmarket_extreme_runner" : undefined,
            );
            break;
          }
        }
        await this.trimFollowupShelf(scanStartedAt, decisionBySymbol);
        this.persistConfig();
      }
      this.lastScanCompletedAt = this.now();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.lastScanCompletedAt = this.now();
      console.error(`[AutoWatchlistSelector] Scan failed: ${this.lastError}`);
    } finally {
      this.running = false;
    }
  }
}
