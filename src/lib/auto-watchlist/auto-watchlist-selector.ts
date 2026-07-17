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

type FetchLike = typeof fetch;

const CONFIG_VERSION = 1;
const EASTERN_TIME_ZONE = "America/New_York";

export const DEFAULT_AUTO_WATCHLIST_SELECTOR_CONFIG = {
  maxMarketCap: 100_000_000,
  maxFloatShares: 50_000_000,
  maxSharesOutstanding: 50_000_000,
  requireShareData: true,
  minPrice: 0.25,
  maxPrice: 20,
  minGainPct: 5,
  minVolume: 100_000,
  minDollarVolume: 250_000,
  minimumScore: 50,
  consecutivePassesRequired: 2,
  maxAddsPerTradingDay: 12,
  maxPostmarketAddsPerTradingDay: 8,
  maxActiveMainSessionTickers: 5,
  maxActivePostmarketTickers: 3,
  maxMainSessionReplacementsPerTradingDay: 7,
  maxPostmarketReplacementsPerTradingDay: 5,
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
  shareTurnoverRankMaxBoost: 10,
  shareTurnoverRankFullScorePct: 100,
} as const;

export type AutoWatchlistSelectorThresholds = {
  maxMarketCap: number;
  maxFloatShares: number;
  maxSharesOutstanding: number;
  requireShareData: boolean;
  minPrice: number;
  maxPrice: number;
  minGainPct: number;
  minVolume: number;
  minDollarVolume: number;
  minimumScore: number;
  consecutivePassesRequired: number;
  maxAddsPerTradingDay: number;
  maxPostmarketAddsPerTradingDay: number;
  maxActiveMainSessionTickers: number;
  maxActivePostmarketTickers: number;
  maxMainSessionReplacementsPerTradingDay: number;
  maxPostmarketReplacementsPerTradingDay: number;
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
};

export type AutoWatchlistCandidateDecision = AutoWatchlistDiscoveryCandidate & {
  score: number;
  rankingScore: number;
  qualified: boolean;
  consecutivePasses: number;
  floatShares: number | null;
  sharesOutstanding: number | null;
  effectiveShares: number | null;
  effectiveSharesSource: "yahoo_float" | "yahoo_outstanding" | "finnhub_outstanding" | null;
  session: AutoWatchlistSession;
  sessionVolume: number | null;
  sessionDollarVolume: number | null;
  recent15mVolume: number | null;
  recent15mDollarVolume: number | null;
  sessionElapsedMinutes: number | null;
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
  shareTurnoverRankBoost: number;
  reasons: string[];
  rankingReasons: string[];
  rejectionReasons: string[];
};

export type AutoWatchlistBucket = "main" | "postmarket";

export type AutoWatchlistManagedEntry = {
  symbol: string;
  bucket: AutoWatchlistBucket;
  state: "active" | "standby";
  firstAddedAt: number;
  lastActivatedAt: number;
  addedSession: AutoWatchlistSession;
  lastSession: AutoWatchlistSession;
  lastRankingScore: number;
  lastQualifiedAt: number | null;
  retentionFailures: number;
  standbyAt: number | null;
  statusReason: string;
};

export type AutoWatchlistReplacementEvent = {
  timestamp: number;
  bucket: AutoWatchlistBucket;
  incomingSymbol: string | null;
  outgoingSymbol: string;
  incomingRankingScore: number | null;
  outgoingRankingScore: number;
  reason: string;
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
  lastCatalystLookupError: string | null;
  lastActivityLookupError: string | null;
  tradingDay: string | null;
  addedToday: string[];
  mainSessionAddedToday: string[];
  postmarketAddedToday: string[];
  activeMainSessionSymbols: string[];
  activePostmarketSymbols: string[];
  standbyToday: AutoWatchlistManagedEntry[];
  managedEntries: AutoWatchlistManagedEntry[];
  recentReplacements: AutoWatchlistReplacementEvent[];
  recentDecisions: AutoWatchlistCandidateDecision[];
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
  managedEntries?: AutoWatchlistManagedEntry[];
  replacementHistory?: AutoWatchlistReplacementEvent[];
};

type AutoWatchlistSelectorOptions = {
  yahooClient: YahooClient | null;
  finnhubClient: FinnhubClient | null;
  activateSymbol: (input: {
    symbol: string;
    note?: string;
    source?: "manual" | "auto";
    autoSession?: Exclude<AutoWatchlistSession, "closed">;
  }) => Promise<unknown>;
  deactivateSymbol?: (symbol: string) => Promise<unknown>;
  getActiveSymbols: () => string[];
  getActiveEntries?: () => AutoWatchlistRuntimeEntry[];
  isRuntimeReady: () => boolean;
  fetchImpl?: FetchLike;
  configPath?: string;
  thresholds?: Partial<AutoWatchlistSelectorThresholds>;
  now?: () => number;
  catalystLookup?: typeof lookupLocalPressReleaseCatalystArticles;
  sessionActivityLookup?: AutoWatchlistSessionActivityLookup;
};

export type AutoWatchlistSession = "premarket" | "regular" | "postmarket" | "closed";

export type AutoWatchlistSessionActivity = {
  symbol: string;
  session: AutoWatchlistSession;
  price: number | null;
  gainPct: number | null;
  sessionVolume: number | null;
  sessionDollarVolume?: number | null;
  recent15mVolume: number | null;
  recent15mDollarVolume: number | null;
  sessionElapsedMinutes?: number | null;
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

function normalizeSymbol(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

const INTEGER_THRESHOLD_KEYS = new Set<keyof AutoWatchlistSelectorThresholds>([
  "maxMarketCap",
  "maxFloatShares",
  "maxSharesOutstanding",
  "minVolume",
  "minDollarVolume",
  "minimumScore",
  "consecutivePassesRequired",
  "maxAddsPerTradingDay",
  "maxPostmarketAddsPerTradingDay",
  "maxActiveMainSessionTickers",
  "maxActivePostmarketTickers",
  "maxMainSessionReplacementsPerTradingDay",
  "maxPostmarketReplacementsPerTradingDay",
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
  "shareTurnoverRankMaxBoost",
  "shareTurnoverRankFullScorePct",
  "minRecentDollarVolume15mPremarket",
  "minRecentDollarVolume15mRegular",
  "minRecentDollarVolume15mPostmarket",
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
    resolved.maxPostmarketReplacementsPerTradingDay > 50
  ) {
    throw new Error("Daily automatic replacement limits cannot exceed 50.");
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
  if (resolved.catalystLookbackDays > 30) {
    throw new Error("catalystLookbackDays cannot exceed 30.");
  }
  if (resolved.catalystSameDayRankBoost > 100 || resolved.catalystDailyRankDecay > 100) {
    throw new Error("Catalyst ranking boost and daily decay cannot exceed 100.");
  }
  if (
    resolved.recentDollarVolumeRankMaxBoost > 100 ||
    resolved.volumeAccelerationRankMaxBoost > 100 ||
    resolved.shareTurnoverRankMaxBoost > 100
  ) {
    throw new Error("Activity and turnover ranking boosts cannot exceed 100.");
  }
  if (resolved.recentDollarVolumeRankFullScore <= 0) {
    throw new Error("recentDollarVolumeRankFullScore must be greater than zero.");
  }
  if (resolved.volumeAccelerationRankFullScoreRatio <= 1) {
    throw new Error("volumeAccelerationRankFullScoreRatio must be greater than 1.");
  }
  if (resolved.shareTurnoverRankFullScorePct <= 0) {
    throw new Error("shareTurnoverRankFullScorePct must be greater than zero.");
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
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    weekday: values.weekday,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

export function autoWatchlistSessionForTimestamp(timestamp: number): AutoWatchlistSession {
  const parts = easternParts(timestamp);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return "closed";
  }
  const minutes = parts.hour * 60 + parts.minute;
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) {
    return "premarket";
  }
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) {
    return "regular";
  }
  if (minutes >= 16 * 60 && minutes < 20 * 60) {
    return "postmarket";
  }
  return "closed";
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

function elapsedSessionMinutes(timestamp: number, session: AutoWatchlistSession): number | null {
  const parts = easternParts(timestamp);
  const currentMinutes = parts.hour * 60 + parts.minute;
  const startMinutes = session === "premarket"
    ? 4 * 60
    : session === "regular"
      ? 9 * 60 + 30
      : session === "postmarket"
        ? 16 * 60
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
  const shareTurnoverPct = args.effectiveShares && args.activity?.sessionVolume
    ? (args.activity.sessionVolume / args.effectiveShares) * 100
    : null;
  const shareTurnoverRankBoost = graduatedRankingBoost({
    value: shareTurnoverPct,
    floor: 0,
    fullScoreAt: args.thresholds.shareTurnoverRankFullScorePct,
    maxBoost: args.thresholds.shareTurnoverRankMaxBoost,
  });
  const eligibilityDollarVolumePoints = args.dollarVolume >= 2_000_000
    ? 20
    : args.dollarVolume >= 1_000_000
      ? 15
      : args.dollarVolume >= args.thresholds.minDollarVolume
        ? 8
        : 0;
  const supportingDollarVolumePoints = args.dollarVolume >= 2_000_000
    ? 10
    : args.dollarVolume >= 1_000_000
      ? 7
      : args.dollarVolume >= args.thresholds.minDollarVolume
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
  if (shareTurnoverRankBoost > 0) {
    rankingReasons.push(`share turnover +${shareTurnoverRankBoost} ranking points`);
  }
  if (supportingDollarVolumePoints > 0) {
    rankingReasons.push(`cumulative dollar volume +${supportingDollarVolumePoints} supporting points`);
  }
  return {
    rankingScore: Math.round((
      rankingBaseScore +
      catalystRankBoost +
      recentDollarVolumeRankBoost +
      volumeAccelerationRankBoost +
      shareTurnoverRankBoost
    ) * 100) / 100,
    catalystAgeDays,
    catalystTiming: args.context.timing,
    catalystPublishedAt: article?.publishedAt ?? null,
    catalystTitle: article?.title ?? null,
    catalystRankBoost,
    recentDollarVolumeRankBoost,
    volumeAccelerationRankBoost,
    shareTurnoverRankBoost,
    shareTurnoverPct,
    rankingReasons,
  };
}

export function isWithinAutoWatchlistScanWindow(
  timestamp: number,
  thresholds: AutoWatchlistSelectorThresholds,
): boolean {
  const parts = easternParts(timestamp);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return false;
  }
  const currentMinutes = parts.hour * 60 + parts.minute;
  const startMinutes = thresholds.scanStartHourEastern * 60;
  const endMinutes = thresholds.scanEndHourEastern * 60 + thresholds.scanEndMinuteEastern;
  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

export function scoreAutoWatchlistCandidate(input: {
  candidate: AutoWatchlistDiscoveryCandidate;
  floatShares?: number | null;
  yahooSharesOutstanding?: number | null;
  finnhubSharesOutstanding?: number | null;
  thresholds?: Partial<AutoWatchlistSelectorThresholds>;
  session?: AutoWatchlistSession;
  activity?: AutoWatchlistSessionActivity | null;
}): Omit<
  AutoWatchlistCandidateDecision,
  | "consecutivePasses"
  | "rankingScore"
  | "catalystAgeDays"
  | "catalystTiming"
  | "catalystPublishedAt"
  | "catalystTitle"
  | "catalystRankBoost"
  | "recentDollarVolumeRankBoost"
  | "volumeAccelerationRankBoost"
  | "shareTurnoverRankBoost"
  | "shareTurnoverPct"
  | "rankingReasons"
  | "session"
  | "sessionVolume"
  | "sessionDollarVolume"
  | "recent15mVolume"
  | "recent15mDollarVolume"
  | "sessionElapsedMinutes"
  | "volumeAcceleration"
  | "activityQuoteAgeMinutes"
  | "activityDataAvailable"
> {
  const thresholds = resolveAutoWatchlistSelectorThresholds(input.thresholds);
  const candidate = input.candidate;
  const floatShares = finitePositive(input.floatShares);
  const yahooOutstanding = finitePositive(input.yahooSharesOutstanding);
  const finnhubOutstanding = finitePositive(input.finnhubSharesOutstanding);
  const sharesOutstanding = yahooOutstanding ?? finnhubOutstanding;
  const effectiveShares = floatShares ?? sharesOutstanding;
  const effectiveSharesSource = floatShares
    ? "yahoo_float" as const
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
  if (!candidate.gainPct || candidate.gainPct < thresholds.minGainPct) {
    rejectionReasons.push(`gain must be at least ${thresholds.minGainPct}%`);
  }
  if (!candidate.volume || candidate.volume < thresholds.minVolume) {
    rejectionReasons.push(`volume must be at least ${thresholds.minVolume.toLocaleString("en-US")}`);
  }
  const dollarVolume = finitePositive(activity?.sessionDollarVolume) ??
    (candidate.price && candidate.volume ? candidate.price * candidate.volume : 0);
  if (dollarVolume < thresholds.minDollarVolume) {
    rejectionReasons.push(`dollar volume must be at least $${Math.round(thresholds.minDollarVolume / 1_000).toLocaleString("en-US")}K`);
  }
  if (!effectiveShares && thresholds.requireShareData) {
    rejectionReasons.push("float or shares outstanding must be available");
  } else if (floatShares && floatShares > thresholds.maxFloatShares) {
    rejectionReasons.push(`float must be at most ${Math.round(thresholds.maxFloatShares / 1_000_000)}M shares`);
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

  if (dollarVolume >= 2_000_000) {
    score += 20;
    reasons.push("$2M+ dollar volume");
  } else if (dollarVolume >= 1_000_000) {
    score += 15;
    reasons.push("$1M+ dollar volume");
  } else if (dollarVolume >= thresholds.minDollarVolume) {
    score += 8;
    reasons.push("minimum dollar volume met");
  }

  const relativeVolume = candidate.volume && candidate.averageVolume
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
      reasons.push("float at or below 50M");
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
      reasons.push("outstanding shares at or below 50M");
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

function normalizeManagedEntry(value: unknown): AutoWatchlistManagedEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AutoWatchlistManagedEntry>;
  const symbol = normalizeSymbol(candidate.symbol);
  if (
    !symbol ||
    (candidate.bucket !== "main" && candidate.bucket !== "postmarket") ||
    (candidate.state !== "active" && candidate.state !== "standby") ||
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
    lastQualifiedAt: finiteNumber(candidate.lastQualifiedAt),
    retentionFailures: Math.max(0, Math.floor(finiteNumber(candidate.retentionFailures) ?? 0)),
    standbyAt: finiteNumber(candidate.standbyAt),
    statusReason: typeof candidate.statusReason === "string" ? candidate.statusReason : "restored",
  };
}

function isReplacementEvent(value: unknown): value is AutoWatchlistReplacementEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AutoWatchlistReplacementEvent>;
  return (
    finiteNumber(candidate.timestamp) !== null &&
    (candidate.bucket === "main" || candidate.bucket === "postmarket") &&
    typeof candidate.outgoingSymbol === "string" &&
    (candidate.incomingSymbol === null || typeof candidate.incomingSymbol === "string") &&
    typeof candidate.reason === "string"
  );
}

export class AutoWatchlistSelector {
  private readonly fetchImpl: FetchLike;
  private readonly catalystLookup: typeof lookupLocalPressReleaseCatalystArticles;
  private readonly sessionActivityLookup: AutoWatchlistSessionActivityLookup;
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
  private liveExchangeDiscoveryAvailable = false;
  private yahooDiscoveryAvailable = true;
  private lastCatalystLookupError: string | null = null;
  private pressReleaseCatalystAvailable = false;
  private sessionActivityAvailable = false;
  private lastActivityLookupError: string | null = null;
  private tradingDay: string | null = null;
  private readonly mainSessionAddedToday = new Set<string>();
  private readonly postmarketAddedToday = new Set<string>();
  private readonly managedEntries = new Map<string, AutoWatchlistManagedEntry>();
  private replacementHistory: AutoWatchlistReplacementEvent[] = [];
  private recentDecisions: AutoWatchlistCandidateDecision[] = [];
  private consecutivePasses = new Map<string, number>();
  private consecutivePassSessions = new Map<string, AutoWatchlistSession>();
  private prefetchedActivityBySymbol = new Map<string, AutoWatchlistSessionActivity>();
  private scanPromise: Promise<void> | null = null;

  constructor(private readonly options: AutoWatchlistSelectorOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.catalystLookup = options.catalystLookup ?? lookupLocalPressReleaseCatalystArticles;
    this.sessionActivityLookup = options.sessionActivityLookup ?? ((input) => this.fetchNasdaqSessionActivities(input));
    this.configPath = options.configPath ?? join(process.cwd(), "artifacts", "auto-watchlist-selector-config.json");
    const persistedConfig = this.loadConfig();
    this.thresholds = resolveAutoWatchlistSelectorThresholds({
      ...persistedConfig?.thresholds,
      ...options.thresholds,
    });
    this.now = options.now ?? Date.now;
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
    for (const entry of persistedConfig?.managedEntries ?? []) {
      const normalized = normalizeManagedEntry(entry);
      if (normalized) {
        this.managedEntries.set(normalized.symbol, normalized);
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
        managedEntries: Array.isArray(parsed.managedEntries)
          ? parsed.managedEntries.map(normalizeManagedEntry).filter((entry): entry is AutoWatchlistManagedEntry => entry !== null)
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
      managedEntries: [...this.managedEntries.values()],
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
      lastCatalystLookupError: this.lastCatalystLookupError,
      lastActivityLookupError: this.lastActivityLookupError,
      tradingDay: this.tradingDay,
      addedToday: [...this.mainSessionAddedToday, ...this.postmarketAddedToday],
      mainSessionAddedToday: [...this.mainSessionAddedToday],
      postmarketAddedToday: [...this.postmarketAddedToday],
      activeMainSessionSymbols: this.managedEntriesFor("main", "active").map((entry) => entry.symbol),
      activePostmarketSymbols: this.managedEntriesFor("postmarket", "active").map((entry) => entry.symbol),
      standbyToday: this.managedEntriesFor(undefined, "standby"),
      managedEntries: this.managedEntriesFor(),
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
      this.managedEntries.set(runtimeEntry.symbol, {
        symbol: runtimeEntry.symbol,
        bucket,
        state: "active",
        firstAddedAt: existing?.firstAddedAt ?? runtimeEntry.activatedAt ?? timestamp,
        lastActivatedAt: existing?.lastActivatedAt ?? runtimeEntry.activatedAt ?? timestamp,
        addedSession: existing?.addedSession ?? inferredSession,
        lastSession: existing?.lastSession ?? session,
        lastRankingScore: existing?.lastRankingScore ?? 0,
        lastQualifiedAt: existing?.lastQualifiedAt ?? null,
        retentionFailures: existing?.retentionFailures ?? 0,
        standbyAt: null,
        statusReason: existing?.statusReason ?? "recognized active automatic entry",
      });
    }
    for (const entry of this.managedEntries.values()) {
      if (entry.state === "active" && !runtimeSymbols.has(entry.symbol)) {
        entry.state = "standby";
        entry.standbyAt = timestamp;
        entry.statusReason = "removed outside automatic replacement";
      }
    }
  }

  private isProtectedIncumbent(
    entry: AutoWatchlistManagedEntry,
    timestamp: number,
    session: AutoWatchlistSession,
  ): boolean {
    const heldMinutes = Math.max(0, timestamp - entry.lastActivatedAt) / 60_000;
    if (heldMinutes < this.thresholds.minimumAutoHoldMinutes) {
      return true;
    }
    return session === "regular" &&
      entry.addedSession === "premarket" &&
      (elapsedSessionMinutes(timestamp, session) ?? Number.POSITIVE_INFINITY) <
        this.thresholds.regularOpenProtectionMinutes;
  }

  private isObviousRunner(decision: AutoWatchlistCandidateDecision): boolean {
    if (!this.thresholds.obviousRunnerOverrideEnabled || !decision.qualified) return false;
    const requiredRecentDollarVolume = minimumRecentDollarVolume(decision.session, this.thresholds);
    return (
      (decision.recent15mDollarVolume ?? 0) >=
        requiredRecentDollarVolume * this.thresholds.obviousRunnerRecentDollarVolumeMultiplier &&
      (decision.volumeAcceleration ?? 0) >= this.thresholds.obviousRunnerMinVolumeAcceleration
    );
  }

  private replacementCount(bucket: AutoWatchlistBucket): number {
    return this.replacementHistory.filter(
      (event) => event.bucket === bucket && event.incomingSymbol !== null,
    ).length;
  }

  private replacementLimit(bucket: AutoWatchlistBucket): number {
    return bucket === "postmarket"
      ? this.thresholds.maxPostmarketReplacementsPerTradingDay
      : this.thresholds.maxMainSessionReplacementsPerTradingDay;
  }

  private activeSlotLimit(bucket: AutoWatchlistBucket): number {
    return bucket === "postmarket"
      ? this.thresholds.maxActivePostmarketTickers
      : this.thresholds.maxActiveMainSessionTickers;
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
    const sharesLabel = decision.effectiveShares
      ? `${(decision.effectiveShares / 1_000_000).toFixed(1)}M ${decision.effectiveSharesSource === "yahoo_float" ? "float" : "shares outstanding"}`
      : "share count unavailable";
    try {
      await this.options.activateSymbol({
        symbol: decision.symbol,
        source: "auto",
        autoSession: decision.session === "closed" ? "regular" : decision.session,
        note: `Auto-selected during ${decision.session}: qualification score ${decision.score}; rank ${decision.rankingScore}; ${(decision.gainPct ?? 0).toFixed(1)}% gain; $${Math.round((decision.recent15mDollarVolume ?? 0) / 1_000).toLocaleString("en-US")}K last-15m dollar volume; ${decision.volumeAcceleration ? `${decision.volumeAcceleration.toFixed(1)}x activity acceleration; ` : ""}${decision.shareTurnoverPct !== null ? `${decision.shareTurnoverPct.toFixed(1)}% share turnover; ` : ""}$${Math.round((decision.marketCap ?? 0) / 1_000_000)}M market cap; ${sharesLabel}; ranking: ${decision.rankingReasons.join(", ") || "base signals only"}; lifecycle: ${reason}.`,
      });
    } catch (error) {
      this.lastActivationErrors.push({
        symbol: decision.symbol,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
    const existing = this.managedEntries.get(decision.symbol);
    this.managedEntries.set(decision.symbol, {
      symbol: decision.symbol,
      bucket,
      state: "active",
      firstAddedAt: existing?.firstAddedAt ?? timestamp,
      lastActivatedAt: timestamp,
      addedSession: existing?.addedSession ?? decision.session,
      lastSession: decision.session,
      lastRankingScore: decision.rankingScore,
      lastQualifiedAt: timestamp,
      retentionFailures: 0,
      standbyAt: null,
      statusReason: reason,
    });
    this.sessionAddedSet(bucket).add(decision.symbol);
    this.lastAddedSymbols.push(decision.symbol);
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
    entry.standbyAt = timestamp;
    entry.statusReason = reason;
    this.managedEntries.set(entry.symbol, entry);
    this.persistConfig();
    return true;
  }

  private recordReplacement(
    bucket: AutoWatchlistBucket,
    incoming: AutoWatchlistCandidateDecision | null,
    outgoing: AutoWatchlistManagedEntry,
    timestamp: number,
    reason: string,
  ): void {
    this.replacementHistory.push({
      timestamp,
      bucket,
      incomingSymbol: incoming?.symbol ?? null,
      outgoingSymbol: outgoing.symbol,
      incomingRankingScore: incoming?.rankingScore ?? null,
      outgoingRankingScore: outgoing.lastRankingScore,
      reason,
    });
    this.replacementHistory = this.replacementHistory.slice(-50);
    this.persistConfig();
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
    for (const [symbol, entry] of this.managedEntries) {
      if (entry.state === "standby") {
        this.managedEntries.delete(symbol);
      }
    }
    this.replacementHistory = [];
    this.consecutivePasses.clear();
    this.consecutivePassSessions.clear();
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
      sessionDollarVolume,
      recent15mVolume,
      recent15mDollarVolume,
      sessionElapsedMinutes,
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
      const candidates = body.data.rows
        .map(normalizeNasdaqRow)
        .filter((row) => row.isLikelyCommonEquity)
        .map((row): AutoWatchlistDiscoveryCandidate => ({
          symbol: row.symbol,
          price: finitePositive(Number(row.lastSale.replace(/[^0-9.-]/g, ""))),
          gainPct: finiteNumber(Number(row.percentChange.replace(/[^0-9.-]/g, ""))),
          volume: finitePositive(row.volume),
          averageVolume: null,
          marketCap: finitePositive(row.marketCap),
          quoteTime: Math.floor(this.now() / 1000),
          sourceScreens: ["live_exchange_gainers"],
        }))
        .filter((candidate) =>
          candidate.price !== null &&
          candidate.price >= this.thresholds.minPrice &&
          candidate.price <= this.thresholds.maxPrice &&
          (candidate.marketCap ?? Number.POSITIVE_INFINITY) <= this.thresholds.maxMarketCap &&
          (candidate.volume ?? 0) >= this.thresholds.minVolume,
        );
      const session = autoWatchlistSessionForTimestamp(this.now());
      if (session === "premarket" || session === "postmarket") {
        const candidateLimit = this.thresholds.extendedSessionCandidateLimit;
        const byVolume = [...candidates]
          .sort((left, right) => (right.volume ?? 0) - (left.volume ?? 0))
          .slice(0, candidateLimit);
        const byRegularGain = [...candidates]
          .sort((left, right) => (right.gainPct ?? 0) - (left.gainPct ?? 0))
          .slice(0, candidateLimit);
        const extendedBySymbol = new Map<string, AutoWatchlistDiscoveryCandidate>();
        let volumeIndex = 0;
        let gainIndex = 0;
        while (
          extendedBySymbol.size < candidateLimit &&
          (volumeIndex < byVolume.length || gainIndex < byRegularGain.length)
        ) {
          for (let offset = 0; offset < 2 && volumeIndex < byVolume.length; offset += 1) {
            const candidate = byVolume[volumeIndex++]!;
            extendedBySymbol.set(candidate.symbol, candidate);
            if (extendedBySymbol.size >= candidateLimit) break;
          }
          if (extendedBySymbol.size < candidateLimit && gainIndex < byRegularGain.length) {
            const candidate = byRegularGain[gainIndex++]!;
            extendedBySymbol.set(candidate.symbol, candidate);
          }
        }
        const extendedUniverse = [...extendedBySymbol.values()];
        const activities = await this.lookupSessionActivities(extendedUniverse, session, this.now());
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
                  sourceScreens: [`live_exchange_${session}_activity`],
                }
              : candidate;
          })
          .filter((candidate) => (candidate.gainPct ?? 0) > 0)
          .sort((left, right) => (right.gainPct ?? 0) - (left.gainPct ?? 0))
          .slice(0, 50);
      }
      return candidates
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
          candidate.marketCap ??
          finitePositive(yahoo?.marketCap) ??
          (finitePositive(finnhub?.marketCapitalization)
            ? finnhub!.marketCapitalization! * 1_000_000
            : null),
      },
      floatShares: yahoo?.floatShares,
      yahooSharesOutstanding: yahoo?.sharesOutstanding,
      finnhubSharesOutstanding: finitePositive(finnhub?.shareOutstanding)
        ? finnhub!.shareOutstanding! * 1_000_000
        : null,
      thresholds: this.thresholds,
      session,
      activity,
    });
    const priorPassSession = this.consecutivePassSessions.get(candidate.symbol);
    const canCarryPriorPasses =
      priorPassSession === session ||
      (priorPassSession === "premarket" && session === "regular");
    const currentPasses = canCarryPriorPasses
      ? this.consecutivePasses.get(candidate.symbol) ?? 0
      : 0;
    const nextPasses = recordPassingObservation
      ? scored.qualified
        ? currentPasses + 1
        : 0
      : currentPasses;
    if (recordPassingObservation) {
      this.consecutivePasses.set(candidate.symbol, nextPasses);
      this.consecutivePassSessions.set(candidate.symbol, session);
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
    return {
      ...scored,
      ...ranking,
      session,
      sessionVolume: activity?.sessionVolume ?? null,
      sessionDollarVolume: activity?.sessionDollarVolume ?? null,
      recent15mVolume: activity?.recent15mVolume ?? null,
      recent15mDollarVolume: activity?.recent15mDollarVolume ?? null,
      sessionElapsedMinutes: activity?.sessionElapsedMinutes ?? null,
      volumeAcceleration: activity?.volumeAcceleration ?? null,
      activityQuoteAgeMinutes: activity?.quoteAgeMinutes ?? null,
      activityDataAvailable: activity?.available === true,
      consecutivePasses: nextPasses,
    };
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
      for (const entry of this.managedEntriesFor(bucket, "active")) {
        if (evaluatedSymbols.has(entry.symbol)) continue;
        enrichmentCandidates.push({
          symbol: entry.symbol,
          price: null,
          gainPct: null,
          volume: null,
          averageVolume: null,
          marketCap: null,
          quoteTime: null,
          sourceScreens: ["active_auto_retention_check"],
        });
        evaluatedSymbols.add(entry.symbol);
      }
      this.lastEvaluatedCount = enrichmentCandidates.length;
      const activities = await this.lookupSessionActivities(enrichmentCandidates, session, scanStartedAt);
      const referenceDate = easternParts(scanStartedAt).date;
      const catalystContexts = await this.lookupCatalysts(enrichmentCandidates, referenceDate);
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
        decisions.push(await this.enrichAndScore(
          sessionCandidate,
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
        ));
      }
      this.recentDecisions = decisions.sort(compareAutoWatchlistDecisions);
      if (activate) {
        const evaluatedDecisionSymbols = new Set(decisions.map((decision) => decision.symbol));
        for (const symbol of this.consecutivePasses.keys()) {
          if (!evaluatedDecisionSymbols.has(symbol)) {
            this.consecutivePasses.delete(symbol);
            this.consecutivePassSessions.delete(symbol);
          }
        }
      }
      const qualified = this.recentDecisions.filter((decision) => decision.qualified);
      this.lastQualifiedCount = qualified.length;
      if (activate) {
        const decisionBySymbol = new Map(decisions.map((decision) => [decision.symbol, decision]));
        for (const entry of this.managedEntriesFor(bucket, "active")) {
          const current = this.managedEntries.get(entry.symbol)!;
          const decision = decisionBySymbol.get(entry.symbol);
          current.lastSession = session;
          if (decision?.qualified) {
            current.retentionFailures = 0;
            current.lastQualifiedAt = scanStartedAt;
            current.lastRankingScore = decision.rankingScore;
            current.statusReason = "retained: still meets automatic selection requirements";
          } else {
            current.retentionFailures += 1;
            if (decision) current.lastRankingScore = decision.rankingScore;
            current.statusReason = `at risk ${current.retentionFailures}/${this.thresholds.retentionFailureScansRequired}: ${decision?.rejectionReasons.join("; ") || "no current activity evidence"}`;
          }
        }

        const eligibleChallengers = qualified.filter((decision) => {
          const activeSymbols = new Set(this.options.getActiveSymbols().map(normalizeSymbol));
          if (activeSymbols.has(decision.symbol)) return false;
          const requiredPasses = this.isObviousRunner(decision)
            ? 1
            : this.thresholds.consecutivePassesRequired;
          return decision.consecutivePasses >= requiredPasses;
        });
        const overflowCount = Math.max(
          0,
          this.managedEntriesFor(bucket, "active").length - this.activeSlotLimit(bucket),
        );
        if (overflowCount > 0) {
          const overflowEntries = this.managedEntriesFor(bucket, "active")
            .sort((left, right) =>
              right.retentionFailures - left.retentionFailures ||
              left.lastRankingScore - right.lastRankingScore ||
              (left.lastQualifiedAt ?? 0) - (right.lastQualifiedAt ?? 0),
            )
            .slice(0, overflowCount);
          for (const entry of overflowEntries) {
            const reason = `moved to standby because the active automatic slot limit was reduced to ${this.activeSlotLimit(bucket)}`;
            if (await this.moveManagedEntryToStandby(entry, scanStartedAt, reason)) {
              this.recordReplacement(bucket, null, entry, scanStartedAt, reason);
            }
          }
        }
        const fadedDepartures: AutoWatchlistManagedEntry[] = [];
        if (this.thresholds.dynamicReplacementEnabled) {
          const faded = this.managedEntriesFor(bucket, "active")
            .filter((entry) =>
              entry.retentionFailures >= this.thresholds.retentionFailureScansRequired &&
              !this.isProtectedIncumbent(entry, scanStartedAt, session),
            )
            .sort((left, right) =>
              right.retentionFailures - left.retentionFailures ||
              left.lastRankingScore - right.lastRankingScore,
            );
          for (const entry of faded) {
            const reason = `moved to standby after ${entry.retentionFailures} failed retention scans`;
            if (await this.moveManagedEntryToStandby(entry, scanStartedAt, reason)) {
              fadedDepartures.push(entry);
            }
          }
        }

        const usedChallengers = new Set<string>();
        let activeManagedCount = this.managedEntriesFor(bucket, "active").length;
        for (const decision of eligibleChallengers) {
          if (activeManagedCount >= this.activeSlotLimit(bucket)) break;
          const alreadyAdded = this.sessionAddedSet(bucket).has(decision.symbol);
          const departure = fadedDepartures.shift();
          const isReplacement = Boolean(departure);
          if (
            !alreadyAdded &&
            !isReplacement &&
            this.sessionAddedSet(bucket).size >= this.initialAdditionLimit(bucket)
          ) {
            continue;
          }
          if (
            isReplacement &&
            this.replacementCount(bucket) >= this.replacementLimit(bucket)
          ) {
            fadedDepartures.unshift(departure!);
            continue;
          }
          const reason = departure
            ? `replaced ${departure.symbol} after confirmed fading`
            : alreadyAdded
              ? "reactivated from standby after renewed qualification"
              : "filled an available automatic slot";
          if (!await this.activateManagedDecision(decision, bucket, scanStartedAt, reason)) {
            if (departure) fadedDepartures.unshift(departure);
            continue;
          }
          usedChallengers.add(decision.symbol);
          activeManagedCount += 1;
          if (departure) {
            this.recordReplacement(
              bucket,
              decision,
              departure,
              scanStartedAt,
              `${decision.symbol} replaced ${departure.symbol}: challenger rank ${decision.rankingScore.toFixed(1)}; incumbent failed retention ${departure.retentionFailures} scans.`,
            );
          }
        }
        for (const departure of fadedDepartures) {
          this.recordReplacement(
            bucket,
            null,
            departure,
            scanStartedAt,
            `${departure.symbol} moved to standby after ${departure.retentionFailures} failed retention scans; no qualified replacement was admitted.`,
          );
        }

        if (
          this.thresholds.dynamicReplacementEnabled &&
          activeManagedCount >= this.activeSlotLimit(bucket) &&
          this.replacementCount(bucket) < this.replacementLimit(bucket)
        ) {
          for (const challenger of eligibleChallengers.filter((decision) =>
            !usedChallengers.has(decision.symbol) && !this.isObviousRunner(decision),
          )) {
            const incumbent = this.managedEntriesFor(bucket, "active")
              .filter((entry) =>
                entry.retentionFailures > 0 &&
                !this.isProtectedIncumbent(entry, scanStartedAt, session),
              )
              .sort((left, right) =>
                right.retentionFailures - left.retentionFailures ||
                left.lastRankingScore - right.lastRankingScore,
              )[0];
            if (!incumbent) break;
            if (
              challenger.rankingScore <
              incumbent.lastRankingScore + this.thresholds.replacementRankingMargin
            ) {
              continue;
            }
            const reason = `stronger sustained runner over at-risk ${incumbent.symbol}`;
            if (!await this.activateManagedDecision(challenger, bucket, scanStartedAt, reason)) continue;
            if (!await this.moveManagedEntryToStandby(
              incumbent,
              scanStartedAt,
              `replaced by stronger sustained runner ${challenger.symbol}`,
            )) {
              await this.options.deactivateSymbol?.(challenger.symbol);
              const activatedEntry = this.managedEntries.get(challenger.symbol);
              if (activatedEntry) {
                activatedEntry.state = "standby";
                activatedEntry.standbyAt = scanStartedAt;
                activatedEntry.statusReason = `rollback: could not retire ${incumbent.symbol}`;
              }
              continue;
            }
            this.recordReplacement(
              bucket,
              challenger,
              incumbent,
              scanStartedAt,
              `${challenger.symbol} replaced ${incumbent.symbol}: rank ${challenger.rankingScore.toFixed(1)} versus ${incumbent.lastRankingScore.toFixed(1)} after ${incumbent.retentionFailures} failed retention scan(s).`,
            );
            usedChallengers.add(challenger.symbol);
            break;
          }
        }

        if (
          this.thresholds.dynamicReplacementEnabled &&
          activeManagedCount >= this.activeSlotLimit(bucket) &&
          this.replacementCount(bucket) < this.replacementLimit(bucket)
        ) {
          for (const challenger of eligibleChallengers.filter((decision) =>
            !usedChallengers.has(decision.symbol) && this.isObviousRunner(decision),
          )) {
            const incumbent = this.managedEntriesFor(bucket, "active")
              .filter((entry) => !this.isProtectedIncumbent(entry, scanStartedAt, session))
              .sort((left, right) => left.lastRankingScore - right.lastRankingScore)[0];
            if (!incumbent) break;
            if (
              challenger.rankingScore <
              incumbent.lastRankingScore + this.thresholds.obviousRunnerReplacementMargin
            ) {
              continue;
            }
            const reason = `obvious-runner override over ${incumbent.symbol}`;
            if (!await this.activateManagedDecision(challenger, bucket, scanStartedAt, reason)) continue;
            if (!await this.moveManagedEntryToStandby(
              incumbent,
              scanStartedAt,
              `replaced by obvious runner ${challenger.symbol}`,
            )) {
              await this.options.deactivateSymbol?.(challenger.symbol);
              const activatedEntry = this.managedEntries.get(challenger.symbol);
              if (activatedEntry) {
                activatedEntry.state = "standby";
                activatedEntry.standbyAt = scanStartedAt;
                activatedEntry.statusReason = `rollback: could not retire ${incumbent.symbol}`;
              }
              continue;
            }
            this.recordReplacement(
              bucket,
              challenger,
              incumbent,
              scanStartedAt,
              `${challenger.symbol} replaced ${incumbent.symbol}: obvious runner rank ${challenger.rankingScore.toFixed(1)} versus ${incumbent.lastRankingScore.toFixed(1)}, with $${Math.round((challenger.recent15mDollarVolume ?? 0) / 1_000)}K last-15m dollar volume and ${(challenger.volumeAcceleration ?? 0).toFixed(1)}x acceleration.`,
            );
            break;
          }
        }
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
