import "dotenv/config";

import { execFileSync } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { finalizeCandleProviderResponse } from "../lib/market-data/candle-quality.js";
import type { BaseCandleProviderResponse, Candle, CandleProviderResponse, CandleTimeframe } from "../lib/market-data/candle-types.js";
import type {
  PressReleaseCatalystArticle,
  PressReleaseCatalystContext,
  PressReleaseCatalystTiming,
} from "../lib/catalysts/press-release-catalyst-context.js";
import {
  fetchNasdaqScreenerRows,
  normalizeNasdaqRow,
  readNasdaqUniverseSnapshot,
  type NasdaqUniverseRow,
} from "../lib/review/nasdaq-marketcap-universe.js";
import {
  writeChartThesisQaReport,
  type ChartThesisQaThesisMode,
  type ChartThesisQaMissedMove,
  type ChartThesisQaReport,
  type ChartThesisQaSample,
  type ChartThesisQaSymbolInput,
} from "../lib/review/chart-thesis-qa-report.js";
import { aggregateCandlesToFiveMinutes } from "../lib/support-resistance/single-timeframe-context.js";
import {
  ValidationCachedCandleFetchService,
  type ValidationCandleCacheMode,
} from "../lib/validation/validation-candle-cache.js";

type DailyRunnerCandidate = {
  symbol: string;
  name: string;
  marketCap: number;
  currentVolume: number;
  runnerDate: string;
  runnerTimestamp: number;
  runnerScorePct: number;
  highVsOpenPct: number;
  highVsPriorClosePct: number;
  open: number;
  high: number;
  low: number;
  close: number;
  priorClose: number;
  volume: number;
  dollarVolume: number;
};

type SelectedRunner = DailyRunnerCandidate & {
  cutoffTimestamp: number | null;
  cutoffIso: string | null;
  skipReason?: string;
  activeCutoffTimestamp: number | null;
  activeCutoffIso: string | null;
  activeSkipReason?: string;
  catalyst?: RunnerCatalystTag;
  catalystCard?: CatalystCardContext;
};

type LocalPressReleaseArticle = {
  ingestEventId: string;
  ticker: string;
  url: string;
  articlePath: string | null;
  title: string | null;
  publishedAt: string;
  eventType: string | null;
  filingType: string | null;
  routeTag: string | null;
  sourceUrl: string | null;
  observedAt: string | null;
  sourceKind?: "website_article_posts" | "ingest_events";
};

type RunnerCatalystLabel =
  | "same_day_premarket_pr"
  | "same_day_market_or_after_pr"
  | "prior_evening_pr"
  | "nearby_prior_pr"
  | "after_runner_day_article"
  | "no_local_pr_article_found"
  | "local_db_date_not_covered"
  | "lookup_unavailable";

type RunnerCatalystTag = {
  label: RunnerCatalystLabel;
  checked: boolean;
  source: "local_press_release_db";
  lookbackDays: number;
  lookaheadDays: number;
  articles: LocalPressReleaseArticle[];
  primaryArticle: LocalPressReleaseArticle | null;
  summary: string;
};

type CatalystCardFreshnessLabel =
  | "same_day"
  | "recent_1_2_days"
  | "stale_3_7_days"
  | "no_card"
  | "lookup_unavailable";

type CatalystCardContext = {
  label: CatalystCardFreshnessLabel;
  businessDays: number;
  sameDay: boolean;
  articleCount: number;
  primaryArticle: LocalPressReleaseArticle | null;
  summary: string;
};

type CatalystLookupResult = {
  available: boolean;
  error?: string;
  databasePath?: string;
  databaseCoverage?: {
    minPublishedAt: string | null;
    maxPublishedAt: string | null;
    ingestEvents: {
      count: number;
      minPublishedAt: string | null;
      maxPublishedAt: string | null;
    };
    websiteArticlePosts: {
      count: number;
      minPublishedAt: string | null;
      maxPublishedAt: string | null;
    };
  };
  articlesBySymbol: Record<string, LocalPressReleaseArticle[]>;
};

type EodhdNewsArticle = {
  date: string;
  title: string | null;
  link: string | null;
  symbols: string[];
  tags: string[];
};

type EodhdNewsLookupResult = {
  available: boolean;
  enabled: boolean;
  error?: string;
  checkedSymbols: string[];
  articlesBySymbol: Record<string, EodhdNewsArticle[]>;
};

type EodhdNewsLookupRunner = {
  symbol: string;
  runnerDate: string;
  bestForwardPct: number;
};

type StockTitanArticle = {
  date: string;
  title: string;
  link: string;
};

type StockTitanLookupResult = {
  available: boolean;
  enabled: boolean;
  error?: string;
  checkedSymbols: string[];
  articlesBySymbol: Record<string, StockTitanArticle[]>;
};

function uniqueLookupSymbolsInOrder(runners: EodhdNewsLookupRunner[], maxSymbols: number): string[] {
  return [...new Set(runners.map((runner) => runner.symbol.toUpperCase()))].slice(0, maxSymbols);
}

function mergeNewsLookupCandidates(...groups: EodhdNewsLookupRunner[][]): EodhdNewsLookupRunner[] {
  const seenKeys = new Set<string>();
  const merged: EodhdNewsLookupRunner[] = [];
  for (const group of groups) {
    for (const runner of group) {
      const key = `${runner.symbol.toUpperCase()}:${runner.runnerDate}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      merged.push(runner);
    }
  }
  return merged;
}

type ActiveRunnerFiveMinuteSource =
  | "eodhd_5m"
  | "eodhd_1m_aggregated"
  | "yahoo_5m"
  | "best_available";

type ActiveRunnerFiveMinuteSelectedSource = Exclude<ActiveRunnerFiveMinuteSource, "best_available">;

type ActiveRunnerFiveMinuteFetchResult = {
  symbol: string;
  status: "disabled" | "fetched" | "empty" | "failed" | "skipped";
  source?: ActiveRunnerFiveMinuteSource | ActiveRunnerFiveMinuteSelectedSource;
  candles: number;
  cutoffCount: number;
  lookbackBars?: number;
  endTimeIso?: string;
  sourceCandidates?: Array<{
    source: ActiveRunnerFiveMinuteSelectedSource;
    status: "fetched" | "empty" | "failed";
    candles: number;
    error?: string;
  }>;
  error?: string;
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function numberArg(flag: string, fallback: number): number {
  const raw = argValue(flag);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${flag} value "${raw}".`);
  }
  return value;
}

function positiveIntegerArg(flag: string, fallback: number): number {
  const value = Math.floor(numberArg(flag, fallback));
  return value > 0 ? value : fallback;
}

function dateArg(flag: string): string | null {
  const raw = argValue(flag);
  if (!raw) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(Date.parse(`${raw}T00:00:00.000Z`))) {
    throw new Error(`Invalid ${flag} value "${raw}". Expected YYYY-MM-DD.`);
  }
  return raw;
}

function activeRunnerFiveMinuteSourceArg(flag: string, fallback: ActiveRunnerFiveMinuteSource): ActiveRunnerFiveMinuteSource {
  const raw = argValue(flag);
  if (!raw) {
    return fallback;
  }
  if (
    raw === "eodhd_5m" ||
    raw === "eodhd_1m_aggregated" ||
    raw === "yahoo_5m" ||
    raw === "best_available"
  ) {
    return raw;
  }
  throw new Error(`Invalid ${flag} value "${raw}".`);
}

const FIVE_MINUTE_MS = 5 * 60 * 1000;

function fiveMinuteFetchPlanForCutoffs(params: {
  cutoffTimestamps: number[];
  minLookbackBars: number;
  paddingBars: number;
}): { endTimeMs: number; lookbackBars: number } | null {
  const cutoffs = params.cutoffTimestamps
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((left, right) => left - right);
  const earliestCutoff = cutoffs[0];
  const latestCutoff = cutoffs.at(-1);
  if (earliestCutoff === undefined || latestCutoff === undefined) {
    return null;
  }

  const spanBars = Math.ceil((latestCutoff - earliestCutoff) / FIVE_MINUTE_MS);
  return {
    endTimeMs: latestCutoff + params.paddingBars * FIVE_MINUTE_MS,
    lookbackBars: Math.max(params.minLookbackBars, spanBars + params.minLookbackBars + params.paddingBars),
  };
}

function aggregateOneMinuteResponseToFiveMinutes(
  oneMinuteResponse: CandleProviderResponse,
  requestedLookbackBars: number,
): CandleProviderResponse {
  const candles = aggregateCandlesToFiveMinutes(oneMinuteResponse.candles)
    .slice(-requestedLookbackBars);
  const baseResponse: BaseCandleProviderResponse = {
    provider: oneMinuteResponse.provider,
    symbol: oneMinuteResponse.symbol,
    timeframe: "5m",
    requestedLookbackBars,
    candles,
    fetchStartTimestamp: oneMinuteResponse.fetchStartTimestamp,
    fetchEndTimestamp: oneMinuteResponse.fetchEndTimestamp,
    requestedStartTimestamp: oneMinuteResponse.requestedStartTimestamp,
    requestedEndTimestamp: oneMinuteResponse.requestedEndTimestamp,
    sessionMetadataAvailable: oneMinuteResponse.sessionMetadataAvailable,
    providerMetadata: {
      ...(oneMinuteResponse.providerMetadata ?? {}),
      sourceTimeframe: "1m",
      derivedTimeframe: "5m",
      aggregationMethod: "ohlcv_1m_to_5m",
      sourceActualBarsReturned: oneMinuteResponse.actualBarsReturned,
    },
  };

  return finalizeCandleProviderResponse(baseResponse);
}

function cacheModeArg(flag: string, fallback: ValidationCandleCacheMode): ValidationCandleCacheMode {
  const raw = argValue(flag);
  if (!raw) {
    return fallback;
  }
  if (raw === "off" || raw === "read_write" || raw === "refresh" || raw === "replay") {
    return raw;
  }
  throw new Error(`Invalid ${flag} value "${raw}".`);
}

function thesisModeArg(flag: string, fallback: ChartThesisQaThesisMode): ChartThesisQaThesisMode {
  const raw = argValue(flag);
  if (!raw) {
    return fallback;
  }
  if (raw === "internal" || raw === "watchlist_approved") {
    return raw;
  }
  throw new Error(`Invalid ${flag} value "${raw}". Supported values: internal, watchlist_approved.`);
}

function marketCapLabel(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function dateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function addUtcDays(date: string, days: number): string {
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) {
    return date;
  }
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function previousCalendarDate(date: string): string {
  return addUtcDays(date, -1);
}

function envText(...names: string[]): string | undefined {
  return names.map((name) => process.env[name]?.trim()).find(Boolean);
}

function newYorkDateParts(iso: string): { date: string; hour: number; minute: number } | null {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function isValidCandle(candle: Candle): boolean {
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
    candle.high >= candle.low
  );
}

function normalizeCandles(candles: Candle[]): Candle[] {
  const byTimestamp = new Map<number, Candle>();
  for (const candle of candles) {
    if (!isValidCandle(candle)) {
      continue;
    }
    byTimestamp.set(candle.timestamp, candle);
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function candleDateKey(candle: Candle): string {
  return newYorkDateParts(new Date(candle.timestamp).toISOString())?.date ?? new Date(candle.timestamp).toISOString().slice(0, 10);
}

function candleRangeValue(candle: Candle): number {
  return Math.max(0, candle.high - candle.low);
}

function ratioPct(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return (numerator / denominator) * 100;
}

type FiveMinuteCandleStructureRead = {
  status: "available" | "unavailable";
  structureRead:
    | "buyers_in_control"
    | "controlled_pullback_holding"
    | "volatile_but_holding"
    | "wick_heavy_rejection_risk"
    | "one_candle_blowoff_risk"
    | "lost_near_term_hold"
    | "unavailable";
  summary: string;
  sessionCandles: number;
  latestCloseLocationPct: number | null;
  latestBodyPct: number | null;
  latestUpperWickPct: number | null;
  latestLowerWickPct: number | null;
  latestGreen: boolean | null;
  recentHigherHighs: number | null;
  recentHigherLows: number | null;
  recentHigherCloses: number | null;
  recentRedCloses: number | null;
  latestVolumeVsPriorFive: number | null;
  priorFiveVolumeVsPriorFifteen: number | null;
  pullbackHeldTrigger: boolean | null;
  closeAboveTrigger: boolean | null;
  reclaimedTriggerWithinNextSixCandles: boolean | null;
  triggerReclaimBars: number | null;
  closeClearedRecentHigh: boolean | null;
  oneCandleBlowoffRisk: boolean | null;
  wickHeavy: boolean | null;
};

function unavailableFiveMinuteCandleStructure(summary: string): FiveMinuteCandleStructureRead {
  return {
    status: "unavailable",
    structureRead: "unavailable",
    summary,
    sessionCandles: 0,
    latestCloseLocationPct: null,
    latestBodyPct: null,
    latestUpperWickPct: null,
    latestLowerWickPct: null,
    latestGreen: null,
    recentHigherHighs: null,
    recentHigherLows: null,
    recentHigherCloses: null,
    recentRedCloses: null,
    latestVolumeVsPriorFive: null,
    priorFiveVolumeVsPriorFifteen: null,
    pullbackHeldTrigger: null,
    closeAboveTrigger: null,
    reclaimedTriggerWithinNextSixCandles: null,
    triggerReclaimBars: null,
    closeClearedRecentHigh: null,
    oneCandleBlowoffRisk: null,
    wickHeavy: null,
  };
}

function average(values: number[]): number | null {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) {
    return null;
  }
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function buildFiveMinuteCandleStructureRead(params: {
  candles: Candle[];
  cutoffTimestamp: number;
  triggerPrice: number | null;
}): FiveMinuteCandleStructureRead {
  const normalizedCandles = normalizeCandles(params.candles);
  const candlesThroughCutoff = normalizedCandles.filter((candle) => candle.timestamp <= params.cutoffTimestamp);
  const latest = candlesThroughCutoff.at(-1);
  if (!latest) {
    return unavailableFiveMinuteCandleStructure("No 5m candle was available at this cutoff.");
  }

  const latestDate = candleDateKey(latest);
  const session = candlesThroughCutoff.filter((candle) => candleDateKey(candle) === latestDate);
  if (session.length < 4) {
    return {
      ...unavailableFiveMinuteCandleStructure("Not enough same-session 5m candles for structure diagnostics."),
      sessionCandles: session.length,
    };
  }

  const latestRange = candleRangeValue(latest);
  const latestCloseLocationPct = ratioPct(latest.close - latest.low, latestRange);
  const latestBodyPct = ratioPct(Math.abs(latest.close - latest.open), latestRange);
  const latestUpperWickPct = ratioPct(latest.high - Math.max(latest.open, latest.close), latestRange);
  const latestLowerWickPct = ratioPct(Math.min(latest.open, latest.close) - latest.low, latestRange);
  const latestGreen = latest.close >= latest.open;
  const recent = session.slice(-5);
  const recentPairs = recent.slice(1).map((candle, index) => ({ previous: recent[index]!, candle }));
  const recentHigherHighs = recentPairs.filter(({ previous, candle }) => candle.high > previous.high).length;
  const recentHigherLows = recentPairs.filter(({ previous, candle }) => candle.low >= previous.low).length;
  const recentHigherCloses = recentPairs.filter(({ previous, candle }) => candle.close >= previous.close).length;
  const recentRedCloses = recent.filter((candle) => candle.close < candle.open).length;
  const priorFive = session.slice(-6, -1);
  const priorFifteen = session.slice(-21, -6);
  const priorFiveAvgVolume = average(priorFive.map((candle) => candle.volume));
  const priorFifteenAvgVolume = average(priorFifteen.map((candle) => candle.volume));
  const latestVolumeVsPriorFive = priorFiveAvgVolume === null ? null : latest.volume / Math.max(priorFiveAvgVolume, 1);
  const priorFiveVolumeVsPriorFifteen = priorFifteenAvgVolume === null || priorFiveAvgVolume === null
    ? null
    : priorFiveAvgVolume / Math.max(priorFifteenAvgVolume, 1);
  const triggerPrice = params.triggerPrice;
  const closeAboveTrigger = triggerPrice === null ? null : latest.close >= triggerPrice;
  const futureSameSession = normalizedCandles
    .filter((candle) => candle.timestamp > params.cutoffTimestamp && candleDateKey(candle) === latestDate)
    .slice(0, 6);
  const triggerReclaimIndex = triggerPrice === null || closeAboveTrigger !== false
    ? -1
    : futureSameSession.findIndex((candle) => candle.close >= triggerPrice);
  const reclaimedTriggerWithinNextSixCandles = triggerPrice === null || closeAboveTrigger !== false
    ? null
    : triggerReclaimIndex >= 0;
  const triggerReclaimBars = triggerReclaimIndex >= 0 ? triggerReclaimIndex + 1 : null;
  const recentPullbackLow = Math.min(...recent.map((candle) => candle.low));
  const pullbackHeldTrigger = triggerPrice === null ? null : recentPullbackLow >= triggerPrice * 0.98;
  const previousRecentHigh = recent.length <= 1 ? null : Math.max(...recent.slice(0, -1).map((candle) => candle.high));
  const closeClearedRecentHigh = previousRecentHigh === null ? null : latest.close >= previousRecentHigh;
  const wickHeavy = latestUpperWickPct !== null && latestBodyPct !== null && latestUpperWickPct >= 35 && latestUpperWickPct > latestBodyPct;
  const oneCandleBlowoffRisk = latestVolumeVsPriorFive !== null &&
    latestVolumeVsPriorFive >= 2.5 &&
    (latestCloseLocationPct ?? 100) < 55;

  const structureRead: FiveMinuteCandleStructureRead["structureRead"] =
    closeAboveTrigger === false
      ? "lost_near_term_hold"
      : oneCandleBlowoffRisk
        ? "one_candle_blowoff_risk"
        : wickHeavy && (latestCloseLocationPct ?? 100) < 65
          ? "wick_heavy_rejection_risk"
          : closeClearedRecentHigh === true &&
              (latestCloseLocationPct ?? 0) >= 65 &&
              recentHigherLows >= Math.max(2, recentPairs.length - 1)
            ? "buyers_in_control"
            : pullbackHeldTrigger === true && recentHigherLows >= Math.max(2, recentPairs.length - 2)
              ? "controlled_pullback_holding"
              : "volatile_but_holding";

  const summaryParts = [
    `close location ${latestCloseLocationPct === null ? "n/a" : formatPct(latestCloseLocationPct)}`,
    `body ${latestBodyPct === null ? "n/a" : formatPct(latestBodyPct)}`,
    `upper wick ${latestUpperWickPct === null ? "n/a" : formatPct(latestUpperWickPct)}`,
    `higher lows ${recentHigherLows}/${recentPairs.length}`,
    `latest volume ${latestVolumeVsPriorFive === null ? "n/a" : `${latestVolumeVsPriorFive.toFixed(1)}x`} prior 5`,
    `pullback held near-term hold ${pullbackHeldTrigger === null ? "n/a" : pullbackHeldTrigger ? "yes" : "no"}`,
    `reclaimed in next 6 candles ${reclaimedTriggerWithinNextSixCandles === null ? "n/a" : reclaimedTriggerWithinNextSixCandles ? `yes${triggerReclaimBars === null ? "" : ` (${triggerReclaimBars})`}` : "no"}`,
  ];

  return {
    status: "available",
    structureRead,
    summary: summaryParts.join(", "),
    sessionCandles: session.length,
    latestCloseLocationPct,
    latestBodyPct,
    latestUpperWickPct,
    latestLowerWickPct,
    latestGreen,
    recentHigherHighs,
    recentHigherLows,
    recentHigherCloses,
    recentRedCloses,
    latestVolumeVsPriorFive,
    priorFiveVolumeVsPriorFifteen,
    pullbackHeldTrigger,
    closeAboveTrigger,
    reclaimedTriggerWithinNextSixCandles,
    triggerReclaimBars,
    closeClearedRecentHigh,
    oneCandleBlowoffRisk,
    wickHeavy,
  };
}

async function readUniverseRows(path: string, refresh: boolean): Promise<NasdaqUniverseRow[]> {
  if (refresh) {
    const rows = await fetchNasdaqScreenerRows();
    return rows.map(normalizeNasdaqRow);
  }
  return (await readNasdaqUniverseSnapshot(path)).rows;
}

function selectSmallCapRows(rows: NasdaqUniverseRow[], params: {
  maxMarketCap: number;
  minCurrentVolume: number;
  maxUniverseSymbols: number;
}): NasdaqUniverseRow[] {
  return rows
    .filter((row) =>
      row.isLikelyCommonEquity &&
      row.marketCap > 0 &&
      row.marketCap <= params.maxMarketCap &&
      row.volume >= params.minCurrentVolume,
    )
    .sort((left, right) => right.volume - left.volume || left.marketCap - right.marketCap)
    .slice(0, params.maxUniverseSymbols);
}

function findDailyRunners(params: {
  row: NasdaqUniverseRow;
  dailyCandles: Candle[];
  minRunnerVolume: number;
  minDollarVolume: number;
  minRunnerMovePct: number;
  minHighVsOpenPct: number;
  minHighVsPriorClosePct: number;
}): DailyRunnerCandidate[] {
  const candidates: DailyRunnerCandidate[] = [];
  for (let index = 1; index < params.dailyCandles.length; index += 1) {
    const candle = params.dailyCandles[index]!;
    const prior = params.dailyCandles[index - 1]!;
    const highVsOpenPct = ((candle.high - candle.open) / Math.max(candle.open, 0.0001)) * 100;
    const highVsPriorClosePct = ((candle.high - prior.close) / Math.max(prior.close, 0.0001)) * 100;
    const runnerScorePct = Math.max(highVsOpenPct, highVsPriorClosePct);
    const dollarVolume = candle.volume * candle.close;
    if (
      candle.volume < params.minRunnerVolume ||
      dollarVolume < params.minDollarVolume ||
      runnerScorePct < params.minRunnerMovePct ||
      (highVsOpenPct < params.minHighVsOpenPct && highVsPriorClosePct < params.minHighVsPriorClosePct)
    ) {
      continue;
    }
    candidates.push({
      symbol: params.row.symbol,
      name: params.row.name,
      marketCap: params.row.marketCap,
      currentVolume: params.row.volume,
      runnerDate: dateKey(candle.timestamp),
      runnerTimestamp: candle.timestamp,
      runnerScorePct,
      highVsOpenPct,
      highVsPriorClosePct,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      priorClose: prior.close,
      volume: candle.volume,
      dollarVolume,
    });
  }
  return candidates;
}

function selectTopRunnersByDay(candidates: DailyRunnerCandidate[], params: {
  runnersPerDay: number;
  targetRunnerSamples: number;
}): DailyRunnerCandidate[] {
  const byDate = new Map<string, DailyRunnerCandidate[]>();
  for (const candidate of candidates) {
    const items = byDate.get(candidate.runnerDate) ?? [];
    items.push(candidate);
    byDate.set(candidate.runnerDate, items);
  }

  const selected: DailyRunnerCandidate[] = [];
  for (const date of [...byDate.keys()].sort((left, right) => right.localeCompare(left))) {
    const dayRunners = byDate.get(date)!
      .sort((left, right) =>
        right.runnerScorePct - left.runnerScorePct ||
        right.dollarVolume - left.dollarVolume ||
        right.volume - left.volume,
      )
      .slice(0, params.runnersPerDay);
    selected.push(...dayRunners);
    if (selected.length >= params.targetRunnerSamples) {
      break;
    }
  }
  return selected.slice(0, params.targetRunnerSamples);
}

function lookupLocalPressReleaseArticles(params: {
  projectDirectory: string;
  symbols: string[];
  minRunnerDate: string;
  maxRunnerDate: string;
  lookbackDays: number;
  lookaheadDays: number;
  enabled: boolean;
}): CatalystLookupResult {
  const symbols = [...new Set(params.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].sort();
  if (!params.enabled || symbols.length === 0) {
    return {
      available: false,
      error: params.enabled ? "no_symbols" : "disabled",
      articlesBySymbol: {},
    };
  }

  const startIso = `${addUtcDays(params.minRunnerDate, -Math.max(0, params.lookbackDays))}T00:00:00.000Z`;
  const endIso = `${addUtcDays(params.maxRunnerDate, Math.max(0, params.lookaheadDays) + 1)}T00:00:00.000Z`;
  const queryScript = `
const Database = require("better-sqlite3");
const { INGEST_DATABASE_PATH } = require("./lib/config");
const symbols = JSON.parse(process.env.RUNNER_SYMBOLS_JSON || "[]");
const startIso = process.env.RUNNER_START_ISO;
const endIso = process.env.RUNNER_END_ISO;
const db = new Database(INGEST_DATABASE_PATH, { readonly: true, fileMustExist: true });
const placeholders = symbols.map((_, index) => "@s" + index).join(",");
const params = { startIso, endIso };
symbols.forEach((symbol, index) => { params["s" + index] = symbol; });
function tableCoverage(tableName, dateExpression) {
  try {
    const row = db.prepare(\`
      SELECT
        COUNT(*) AS count,
        MIN(\${dateExpression}) AS minPublishedAt,
        MAX(\${dateExpression}) AS maxPublishedAt
      FROM \${tableName}
    \`).get();
    return {
      count: Number(row.count || 0),
      minPublishedAt: row.minPublishedAt || null,
      maxPublishedAt: row.maxPublishedAt || null,
    };
  } catch {
    return { count: 0, minPublishedAt: null, maxPublishedAt: null };
  }
}
const ingestCoverage = tableCoverage("ingest_events", "COALESCE(message_timestamp, observed_at, created_at)");
const websiteCoverage = tableCoverage("website_article_posts", "COALESCE(website_published_at, observed_at, created_at)");
const coverageDates = [
  ingestCoverage.minPublishedAt,
  ingestCoverage.maxPublishedAt,
  websiteCoverage.minPublishedAt,
  websiteCoverage.maxPublishedAt,
].filter(Boolean).sort();
const websiteRows = placeholders
  ? db.prepare(\`
      SELECT
        ingest_event_id,
        ticker,
        article_url,
        article_path,
        title,
        event_type,
        filing_type,
        route_tag,
        source_url,
        website_published_at,
        observed_at
      FROM website_article_posts
      WHERE UPPER(ticker) IN (\${placeholders})
        AND article_url IS NOT NULL
        AND article_url != ''
        AND datetime(website_published_at) >= datetime(@startIso)
        AND datetime(website_published_at) < datetime(@endIso)
      ORDER BY UPPER(ticker), datetime(website_published_at) ASC, datetime(created_at) ASC
    \`).all(params)
  : [];
const ingestRows = placeholders
  ? db.prepare(\`
      SELECT
        id AS ingest_event_id,
        ticker,
        COALESCE(article_url, selected_document_url, source_hostname, id) AS article_url,
        NULL AS article_path,
        COALESCE(headline, summary, raw_discord_message, article_url, selected_document_url) AS title,
        event_type,
        filing_type,
        route_tag,
        COALESCE(article_url, selected_document_url, source_hostname) AS source_url,
        COALESCE(message_timestamp, observed_at, created_at) AS website_published_at,
        observed_at
      FROM ingest_events
      WHERE UPPER(ticker) IN (\${placeholders})
        AND datetime(COALESCE(message_timestamp, observed_at, created_at)) >= datetime(@startIso)
        AND datetime(COALESCE(message_timestamp, observed_at, created_at)) < datetime(@endIso)
      ORDER BY UPPER(ticker), datetime(COALESCE(message_timestamp, observed_at, created_at)) ASC, datetime(created_at) ASC
    \`).all(params)
  : [];
const articlesBySymbol = {};
const seenBySymbol = {};
function addArticle(row, sourceKind) {
  const key = String(row.ticker || "").toUpperCase();
  if (!key) return;
  const seen = seenBySymbol[key] || new Set();
  const dedupeKey = String(row.ingest_event_id || "") || String(row.article_url || "") + "|" + String(row.website_published_at || "");
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);
  seenBySymbol[key] = seen;
  const article = {
    ingestEventId: row.ingest_event_id,
    ticker: key,
    url: row.article_url,
    articlePath: row.article_path || null,
    title: row.title || null,
    publishedAt: row.website_published_at,
    eventType: row.event_type || null,
    filingType: row.filing_type || null,
    routeTag: row.route_tag || null,
    sourceUrl: row.source_url || null,
    observedAt: row.observed_at || null,
    sourceKind,
  };
  if (!articlesBySymbol[key]) articlesBySymbol[key] = [];
  articlesBySymbol[key].push(article);
}
for (const row of websiteRows) addArticle(row, "website_article_posts");
for (const row of ingestRows) addArticle(row, "ingest_events");
for (const key of Object.keys(articlesBySymbol)) {
  articlesBySymbol[key].sort((left, right) => String(left.publishedAt).localeCompare(String(right.publishedAt)));
}
console.log(JSON.stringify({
  available: true,
  databasePath: INGEST_DATABASE_PATH,
  databaseCoverage: {
    minPublishedAt: coverageDates[0] || null,
    maxPublishedAt: coverageDates[coverageDates.length - 1] || null,
    ingestEvents: ingestCoverage,
    websiteArticlePosts: websiteCoverage,
  },
  articlesBySymbol,
}));
`;

  try {
    const output = execFileSync(process.execPath, ["-e", queryScript], {
      cwd: params.projectDirectory,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        RUNNER_SYMBOLS_JSON: JSON.stringify(symbols),
        RUNNER_START_ISO: startIso,
        RUNNER_END_ISO: endIso,
      },
    });
    const parsed = JSON.parse(output) as CatalystLookupResult;
    return {
      available: parsed.available === true,
      databasePath: parsed.databasePath,
      databaseCoverage: parsed.databaseCoverage,
      articlesBySymbol: parsed.articlesBySymbol ?? {},
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
      articlesBySymbol: {},
    };
  }
}

function classifyRunnerCatalyst(params: {
  runner: DailyRunnerCandidate;
  lookup: CatalystLookupResult;
  lookbackDays: number;
  lookaheadDays: number;
}): RunnerCatalystTag {
  if (!params.lookup.available) {
    return {
      label: "lookup_unavailable",
      checked: false,
      source: "local_press_release_db",
      lookbackDays: params.lookbackDays,
      lookaheadDays: params.lookaheadDays,
      articles: [],
      primaryArticle: null,
      summary: params.lookup.error ? `Lookup unavailable: ${params.lookup.error}` : "Lookup unavailable.",
    };
  }

  const windowStart = addUtcDays(params.runner.runnerDate, -Math.max(0, params.lookbackDays));
  const windowEnd = addUtcDays(params.runner.runnerDate, Math.max(0, params.lookaheadDays));
  const coverageMin = params.lookup.databaseCoverage?.minPublishedAt ?? null;
  const coverageMax = params.lookup.databaseCoverage?.maxPublishedAt ?? null;
  const windowStartMs = Date.parse(`${windowStart}T00:00:00.000Z`);
  const windowEndExclusiveMs = Date.parse(`${addUtcDays(windowEnd, 1)}T00:00:00.000Z`);
  const coverageMinMs = coverageMin ? Date.parse(coverageMin) : Number.NaN;
  const coverageMaxMs = coverageMax ? Date.parse(coverageMax) : Number.NaN;
  const coverageOverlapsWindow =
    Number.isFinite(windowStartMs) &&
    Number.isFinite(windowEndExclusiveMs) &&
    Number.isFinite(coverageMinMs) &&
    Number.isFinite(coverageMaxMs) &&
    coverageMaxMs >= windowStartMs &&
    coverageMinMs < windowEndExclusiveMs;
  if (!coverageOverlapsWindow) {
    return {
      label: "local_db_date_not_covered",
      checked: false,
      source: "local_press_release_db",
      lookbackDays: params.lookbackDays,
      lookaheadDays: params.lookaheadDays,
      articles: [],
      primaryArticle: null,
      summary: coverageMin && coverageMax
        ? `Local press-release DB coverage (${coverageMin} to ${coverageMax}) does not overlap this runner window.`
        : "Local press-release DB coverage range is unavailable.",
    };
  }

  const symbolArticles = params.lookup.articlesBySymbol[params.runner.symbol.toUpperCase()] ?? [];
  const articles = symbolArticles.filter((article) => {
    const parts = newYorkDateParts(article.publishedAt);
    return parts !== null && parts.date >= windowStart && parts.date <= windowEnd;
  });
  if (articles.length === 0) {
    return {
      label: "no_local_pr_article_found",
      checked: true,
      source: "local_press_release_db",
      lookbackDays: params.lookbackDays,
      lookaheadDays: params.lookaheadDays,
      articles,
      primaryArticle: null,
      summary: "No local press-release article found in the runner window.",
    };
  }

  const runnerDate = params.runner.runnerDate;
  const priorDate = previousCalendarDate(runnerDate);
  const ranked = articles
    .map((article) => {
      const parts = newYorkDateParts(article.publishedAt);
      let label: RunnerCatalystLabel = "nearby_prior_pr";
      let rank = 4;
      if (parts && parts.date === runnerDate) {
        const minutes = parts.hour * 60 + parts.minute;
        if (minutes < 9 * 60 + 30) {
          label = "same_day_premarket_pr";
          rank = 0;
        } else {
          label = "same_day_market_or_after_pr";
          rank = 1;
        }
      } else if (parts && parts.date === priorDate && parts.hour >= 16) {
        label = "prior_evening_pr";
        rank = 2;
      } else if (parts && parts.date > runnerDate) {
        label = "after_runner_day_article";
        rank = 5;
      } else {
        label = "nearby_prior_pr";
        rank = 3;
      }
      return { article, label, rank };
    })
    .sort((left, right) => left.rank - right.rank || left.article.publishedAt.localeCompare(right.article.publishedAt));
  const primary = ranked[0]!;
  const title = primary.article.title ? `: ${primary.article.title}` : "";
  return {
    label: primary.label,
    checked: true,
    source: "local_press_release_db",
    lookbackDays: params.lookbackDays,
    lookaheadDays: params.lookaheadDays,
    articles,
    primaryArticle: primary.article,
    summary: `${primary.label.replace(/_/g, " ")} at ${primary.article.publishedAt}${title}`,
  };
}

function classifyCatalystCardContext(params: {
  runner: DailyRunnerCandidate;
  lookup: CatalystLookupResult;
  businessDays: number;
}): CatalystCardContext {
  if (!params.lookup.available) {
    return {
      label: "lookup_unavailable",
      businessDays: params.businessDays,
      sameDay: false,
      articleCount: 0,
      primaryArticle: null,
      summary: params.lookup.error ? `Catalyst card lookup unavailable: ${params.lookup.error}` : "Catalyst card lookup unavailable.",
    };
  }

  const symbolArticles = params.lookup.articlesBySymbol[params.runner.symbol.toUpperCase()] ?? [];
  const windowStart = addUtcDays(params.runner.runnerDate, -Math.max(0, params.businessDays));
  const windowEnd = params.runner.runnerDate;
  const articles = symbolArticles
    .filter((article) => {
      const parts = newYorkDateParts(article.publishedAt);
      return parts !== null && parts.date >= windowStart && parts.date <= windowEnd;
    })
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));

  if (articles.length === 0) {
    return {
      label: "no_card",
      businessDays: params.businessDays,
      sameDay: false,
      articleCount: 0,
      primaryArticle: null,
      summary: "No recent catalyst card would be shown from the local website article lookup.",
    };
  }

  const primary = articles[0]!;
  const parts = newYorkDateParts(primary.publishedAt);
  const publishedDate = parts?.date ?? primary.publishedAt.slice(0, 10);
  const ageDays = Math.max(
    0,
    Math.round((Date.parse(`${params.runner.runnerDate}T00:00:00.000Z`) - Date.parse(`${publishedDate}T00:00:00.000Z`)) / (24 * 60 * 60 * 1000)),
  );
  const label: CatalystCardFreshnessLabel = publishedDate === params.runner.runnerDate
    ? "same_day"
    : ageDays <= 2
      ? "recent_1_2_days"
      : "stale_3_7_days";

  return {
    label,
    businessDays: params.businessDays,
    sameDay: label === "same_day",
    articleCount: articles.length,
    primaryArticle: primary,
    summary: `${label.replace(/_/g, " ")} catalyst card: ${primary.title ?? primary.url}`,
  };
}

function mapRunnerCatalystToPressReleaseContext(
  catalyst: RunnerCatalystTag | undefined,
): PressReleaseCatalystContext | undefined {
  if (!catalyst) {
    return undefined;
  }
  const timingByLabel: Record<RunnerCatalystLabel, PressReleaseCatalystTiming> = {
    same_day_premarket_pr: "same_day_premarket",
    same_day_market_or_after_pr: "same_day_intraday",
    prior_evening_pr: "prior_evening",
    nearby_prior_pr: "recent_prior",
    after_runner_day_article: "after_runner_day",
    no_local_pr_article_found: "none",
    local_db_date_not_covered: "lookup_unavailable",
    lookup_unavailable: "lookup_unavailable",
  };
  return {
    source: "local_press_release_db",
    checked: catalyst.checked,
    timing: timingByLabel[catalyst.label],
    freshness:
      catalyst.label === "same_day_premarket_pr" || catalyst.label === "same_day_market_or_after_pr"
        ? "same_day"
        : catalyst.label === "prior_evening_pr" || catalyst.label === "nearby_prior_pr"
          ? "recent_1_2_days"
          : catalyst.label === "lookup_unavailable"
            ? "lookup_unavailable"
            : catalyst.label === "no_local_pr_article_found"
              ? "no_card"
              : catalyst.label === "local_db_date_not_covered"
                ? "lookup_unavailable"
                : "stale_3_7_days",
    articleCount: catalyst.articles.length,
    primaryArticle: catalyst.primaryArticle
      ? {
          ...catalyst.primaryArticle,
          sourceKind: catalyst.primaryArticle.sourceKind ?? "website_article_posts",
        } satisfies PressReleaseCatalystArticle
      : null,
    articles: catalyst.articles.map((article) => ({
      ...article,
      sourceKind: article.sourceKind ?? "website_article_posts",
    })) satisfies PressReleaseCatalystArticle[],
    summary: catalyst.summary,
  };
}

function normalizeEodhdNewsArticle(value: unknown): EodhdNewsArticle | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const date = typeof raw.date === "string" ? raw.date : "";
  if (!date || !Number.isFinite(Date.parse(date))) {
    return null;
  }
  return {
    date,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : null,
    link: typeof raw.link === "string" && raw.link.trim() ? raw.link.trim() : null,
    symbols: Array.isArray(raw.symbols) ? raw.symbols.map(String) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
  };
}

async function lookupEodhdNewsForMissedRunners(params: {
  runners: EodhdNewsLookupRunner[];
  enabled: boolean;
  maxSymbols: number;
  apiToken?: string;
  exchangeSuffix: string;
  baseUrl: string;
  lookbackDays: number;
  lookaheadDays: number;
  limit: number;
  throttleMs: number;
}): Promise<EodhdNewsLookupResult> {
  if (!params.enabled) {
    return {
      available: false,
      enabled: false,
      error: "disabled",
      checkedSymbols: [],
      articlesBySymbol: {},
    };
  }
  if (!params.apiToken) {
    return {
      available: false,
      enabled: true,
      error: "missing_eodhd_api_token",
      checkedSymbols: [],
      articlesBySymbol: {},
    };
  }

  const targetSymbols = uniqueLookupSymbolsInOrder(params.runners, params.maxSymbols);
  const articlesBySymbol: Record<string, EodhdNewsArticle[]> = {};
  const errors: string[] = [];

  for (const symbol of targetSymbols) {
    const symbolRunners = params.runners.filter((runner) => runner.symbol.toUpperCase() === symbol);
    const dates = symbolRunners.map((runner) => runner.runnerDate).sort();
    const from = addUtcDays(dates[0] ?? dateKey(Date.now()), -Math.max(0, params.lookbackDays));
    const to = addUtcDays(dates.at(-1) ?? dateKey(Date.now()), Math.max(0, params.lookaheadDays));
    const eodhdSymbol = symbol.includes(".") ? symbol : `${symbol}.${params.exchangeSuffix}`;
    const url = new URL("/api/news", params.baseUrl);
    url.searchParams.set("s", eodhdSymbol);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("limit", String(params.limit));
    url.searchParams.set("offset", "0");
    url.searchParams.set("api_token", params.apiToken);
    url.searchParams.set("fmt", "json");

    try {
      const response = await fetch(url);
      if (!response.ok) {
        errors.push(`${symbol}: HTTP ${response.status}`);
      } else {
        const payload = await response.json() as unknown;
        const articles = Array.isArray(payload)
          ? payload.map(normalizeEodhdNewsArticle).filter((article): article is EodhdNewsArticle => article !== null)
          : [];
        articlesBySymbol[symbol] = articles;
      }
    } catch (error) {
      errors.push(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(params.throttleMs);
  }

  return {
    available: true,
    enabled: true,
    error: errors.length > 0 ? errors.slice(0, 10).join("; ") : undefined,
    checkedSymbols: targetSymbols,
    articlesBySymbol,
  };
}

function classifyEodhdNewsCatalyst(params: {
  runner: Pick<SelectedRunner, "symbol" | "runnerDate">;
  articles: EodhdNewsArticle[];
  lookbackDays: number;
  lookaheadDays: number;
}): {
  label: "same_day_premarket_news" | "same_day_market_or_after_news" | "prior_evening_news" | "nearby_prior_news" | "after_runner_day_news" | "no_eodhd_news_found";
  primaryArticle: EodhdNewsArticle | null;
  articles: EodhdNewsArticle[];
} {
  const windowStart = addUtcDays(params.runner.runnerDate, -Math.max(0, params.lookbackDays));
  const windowEnd = addUtcDays(params.runner.runnerDate, Math.max(0, params.lookaheadDays));
  const articles = params.articles.filter((article) => {
    const parts = newYorkDateParts(article.date);
    return parts !== null && parts.date >= windowStart && parts.date <= windowEnd;
  });
  if (articles.length === 0) {
    return {
      label: "no_eodhd_news_found",
      primaryArticle: null,
      articles,
    };
  }

  const priorDate = previousCalendarDate(params.runner.runnerDate);
  const ranked = articles
    .map((article) => {
      const parts = newYorkDateParts(article.date);
      let label: ReturnType<typeof classifyEodhdNewsCatalyst>["label"] = "nearby_prior_news";
      let rank = 4;
      if (parts && parts.date === params.runner.runnerDate) {
        const minutes = parts.hour * 60 + parts.minute;
        if (minutes < 9 * 60 + 30) {
          label = "same_day_premarket_news";
          rank = 0;
        } else {
          label = "same_day_market_or_after_news";
          rank = 1;
        }
      } else if (parts && parts.date === priorDate && parts.hour >= 16) {
        label = "prior_evening_news";
        rank = 2;
      } else if (parts && parts.date > params.runner.runnerDate) {
        label = "after_runner_day_news";
        rank = 5;
      } else {
        label = "nearby_prior_news";
        rank = 3;
      }
      return { article, label, rank };
    })
    .sort((left, right) => left.rank - right.rank || left.article.date.localeCompare(right.article.date));

  return {
    label: ranked[0]!.label,
    primaryArticle: ranked[0]!.article,
    articles,
  };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "-")
    .replace(/&ndash;/g, "-")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function parseStockTitanArticles(symbol: string, html: string): StockTitanArticle[] {
  const articles: StockTitanArticle[] = [];
  const matches = html.matchAll(/<time[^>]+datetime="([^"]+)"[\s\S]*?<a href="([^"]+)" class="text-gray-dark feed-link">([\s\S]*?)<\/a>/g);
  for (const match of matches) {
    const date = match[1] ?? "";
    const href = match[2] ?? "";
    const rawTitle = match[3] ?? "";
    if (!date || !Number.isFinite(Date.parse(date)) || !href || !rawTitle) {
      continue;
    }
    const title = decodeHtmlEntities(rawTitle.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    const link = href.startsWith("http")
      ? href
      : `https://www.stocktitan.net${href.startsWith("/") ? href : `/news/${symbol.toUpperCase()}/${href}`}`;
    articles.push({ date, title, link });
  }
  return articles;
}

async function lookupStockTitanNewsForRunners(params: {
  runners: EodhdNewsLookupRunner[];
  enabled: boolean;
  maxSymbols: number;
  throttleMs: number;
}): Promise<StockTitanLookupResult> {
  if (!params.enabled) {
    return {
      available: false,
      enabled: false,
      error: "disabled",
      checkedSymbols: [],
      articlesBySymbol: {},
    };
  }

  const targetSymbols = uniqueLookupSymbolsInOrder(params.runners, params.maxSymbols);
  const checkedSymbols: string[] = [];
  const articlesBySymbol: Record<string, StockTitanArticle[]> = {};
  const errors: string[] = [];

  for (const symbol of targetSymbols) {
    try {
      const response = await fetch(`https://www.stocktitan.net/news/${encodeURIComponent(symbol)}/`, {
        headers: {
          "user-agent": "TraderLink QA catalyst coverage audit/1.0",
        },
      });
      if (!response.ok) {
        errors.push(`${symbol}: HTTP ${response.status}`);
      } else {
        articlesBySymbol[symbol] = parseStockTitanArticles(symbol, await response.text());
        checkedSymbols.push(symbol);
      }
    } catch (error) {
      errors.push(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(params.throttleMs);
  }

  return {
    available: true,
    enabled: true,
    error: errors.length > 0 ? errors.slice(0, 10).join("; ") : undefined,
    checkedSymbols,
    articlesBySymbol,
  };
}

function classifyStockTitanCatalyst(params: {
  runner: Pick<SelectedRunner, "runnerDate">;
  articles: StockTitanArticle[];
  lookbackDays: number;
  lookaheadDays: number;
}): {
  label: "same_day_premarket_stocktitan" | "same_day_market_or_after_stocktitan" | "prior_evening_stocktitan" | "nearby_prior_stocktitan" | "after_runner_day_stocktitan" | "no_stocktitan_news_found";
  primaryArticle: StockTitanArticle | null;
  articles: StockTitanArticle[];
} {
  const windowStart = addUtcDays(params.runner.runnerDate, -Math.max(0, params.lookbackDays));
  const windowEnd = addUtcDays(params.runner.runnerDate, Math.max(0, params.lookaheadDays));
  const articles = params.articles.filter((article) => {
    const parts = newYorkDateParts(article.date);
    return parts !== null && parts.date >= windowStart && parts.date <= windowEnd;
  });
  if (articles.length === 0) {
    return {
      label: "no_stocktitan_news_found",
      primaryArticle: null,
      articles,
    };
  }

  const priorDate = previousCalendarDate(params.runner.runnerDate);
  const ranked = articles
    .map((article) => {
      const parts = newYorkDateParts(article.date);
      let label: ReturnType<typeof classifyStockTitanCatalyst>["label"] = "nearby_prior_stocktitan";
      let rank = 4;
      if (parts && parts.date === params.runner.runnerDate) {
        const minutes = parts.hour * 60 + parts.minute;
        if (minutes < 9 * 60 + 30) {
          label = "same_day_premarket_stocktitan";
          rank = 0;
        } else {
          label = "same_day_market_or_after_stocktitan";
          rank = 1;
        }
      } else if (parts && parts.date === priorDate && parts.hour >= 16) {
        label = "prior_evening_stocktitan";
        rank = 2;
      } else if (parts && parts.date > params.runner.runnerDate) {
        label = "after_runner_day_stocktitan";
        rank = 5;
      } else {
        label = "nearby_prior_stocktitan";
        rank = 3;
      }
      return { article, label, rank };
    })
    .sort((left, right) => left.rank - right.rank || left.article.date.localeCompare(right.article.date));

  return {
    label: ranked[0]!.label,
    primaryArticle: ranked[0]!.article,
    articles,
  };
}

function findPreRunnerCutoff(fourHourCandles: Candle[], runnerDate: string, horizonBars: number): {
  cutoffTimestamp: number | null;
  skipReason?: string;
} {
  const firstRunnerDayIndex = fourHourCandles.findIndex((candle) => dateKey(candle.timestamp) === runnerDate);
  if (firstRunnerDayIndex < 0) {
    return { cutoffTimestamp: null, skipReason: "missing_runner_day_4h_candles" };
  }
  const cutoffIndex = firstRunnerDayIndex - 1;
  if (cutoffIndex < 5) {
    return { cutoffTimestamp: null, skipReason: "insufficient_prior_4h_history" };
  }
  if (cutoffIndex + horizonBars >= fourHourCandles.length) {
    return { cutoffTimestamp: null, skipReason: "insufficient_forward_4h_history" };
  }
  return { cutoffTimestamp: fourHourCandles[cutoffIndex]!.timestamp };
}

function findActiveRunnerCutoff(fourHourCandles: Candle[], runnerDate: string, horizonBars: number): {
  cutoffTimestamp: number | null;
  skipReason?: string;
} {
  const firstRunnerDayIndex = fourHourCandles.findIndex((candle) => dateKey(candle.timestamp) === runnerDate);
  if (firstRunnerDayIndex < 0) {
    return { cutoffTimestamp: null, skipReason: "missing_runner_day_4h_candles" };
  }
  if (firstRunnerDayIndex < 5) {
    return { cutoffTimestamp: null, skipReason: "insufficient_prior_4h_history" };
  }
  if (firstRunnerDayIndex + horizonBars >= fourHourCandles.length) {
    return { cutoffTimestamp: null, skipReason: "insufficient_forward_4h_history" };
  }
  return { cutoffTimestamp: fourHourCandles[firstRunnerDayIndex]!.timestamp };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function catalystLabel(tag: RunnerCatalystTag | undefined): string {
  if (!tag) {
    return "not checked";
  }
  return `${tag.label}${tag.primaryArticle?.title ? ` (${tag.primaryArticle.title})` : ""}`;
}

function renderRunnerBasketMarkdown(params: {
  selected: SelectedRunner[];
  skipped: SelectedRunner[];
  usable: SelectedRunner[];
  extraUsable: SelectedRunner[];
  settings: Record<string, unknown>;
}): string {
  const lines: string[] = [];
  lines.push("# EODHD Under-$30M Actual Runner Basket");
  lines.push("");
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Selected runner-days: ${params.selected.length}`);
  lines.push(`- QA usable pre-runner cutoffs: ${params.usable.length}`);
  lines.push(`- Extra usable runner-days not sent to QA: ${params.extraUsable.length}`);
  lines.push(`- Skipped runner-days: ${params.skipped.length}`);
  lines.push(`- Unique usable symbols: ${new Set(params.usable.map((item) => item.symbol)).size}`);
  lines.push(`- Active-runner cutoffs: ${params.usable.filter((item) => item.activeCutoffTimestamp !== null).length}`);
  lines.push(`- Settings: \`${JSON.stringify(params.settings)}\``);
  lines.push("");
  lines.push("## Top Usable Runners");
  lines.push("");
  for (const item of params.usable.slice(0, 40)) {
    lines.push(
      `- ${item.runnerDate} ${item.symbol}: score ${formatPct(item.runnerScorePct)}, high/open ${formatPct(item.highVsOpenPct)}, high/prior close ${formatPct(item.highVsPriorClosePct)}, volume ${Math.round(item.volume).toLocaleString("en-US")}, pre cutoff ${item.cutoffIso}, active cutoff ${item.activeCutoffIso}, card ${item.catalystCard?.label ?? "not_checked"}, catalyst ${catalystLabel(item.catalyst)}`,
    );
  }
  if (params.skipped.length > 0) {
    lines.push("");
    lines.push("## Skipped");
    lines.push("");
    for (const item of params.skipped.slice(0, 40)) {
      lines.push(`- ${item.runnerDate} ${item.symbol}: ${item.skipReason ?? "unknown"}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function incrementCount<T extends string>(counts: Record<T, number>, key: T): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function buildRunnerCatalystAnalysis(params: {
  usable: SelectedRunner[];
  report: ChartThesisQaReport;
  catalystLookup: CatalystLookupResult;
}): {
  generatedAt: string;
  catalystLookup: Pick<CatalystLookupResult, "available" | "error" | "databasePath" | "databaseCoverage">;
  totals: {
    usableRunners: number;
    thesisSamples: number;
    missedRunners: number;
    unmatchedUsableRunners: number;
  };
  catalystCounts: Record<RunnerCatalystLabel, number>;
  missedCatalystCounts: Record<RunnerCatalystLabel, number>;
  missedRunners: Array<SelectedRunner & {
    bestForwardPct: number;
    missedReason: string;
    missedSummary: string;
  }>;
  thesisRunners: SelectedRunner[];
  unmatchedUsableRunners: SelectedRunner[];
} {
  const missedByKey = new Map(
    params.report.missedMoves.map((missed) => [`${missed.symbol}:${missed.cutoffTimestamp}`, missed]),
  );
  const thesisByKey = new Map(
    params.report.samples.map((sample) => [`${sample.symbol}:${sample.cutoffTimestamp}`, sample]),
  );
  const catalystCounts = {
    same_day_premarket_pr: 0,
    same_day_market_or_after_pr: 0,
    prior_evening_pr: 0,
    nearby_prior_pr: 0,
    after_runner_day_article: 0,
    no_local_pr_article_found: 0,
    local_db_date_not_covered: 0,
    lookup_unavailable: 0,
  } satisfies Record<RunnerCatalystLabel, number>;
  const missedCatalystCounts = { ...catalystCounts };
  const missedRunners: Array<SelectedRunner & {
    bestForwardPct: number;
    missedReason: string;
    missedSummary: string;
  }> = [];
  const thesisRunners: SelectedRunner[] = [];
  const unmatchedUsableRunners: SelectedRunner[] = [];

  for (const runner of params.usable) {
    const label = runner.catalyst?.label ?? "lookup_unavailable";
    incrementCount(catalystCounts, label);
    const key = `${runner.symbol}:${runner.cutoffTimestamp}`;
    const missed = missedByKey.get(key);
    if (missed) {
      incrementCount(missedCatalystCounts, label);
      missedRunners.push({
        ...runner,
        bestForwardPct: missed.bestForwardPct,
        missedReason: missed.reason,
        missedSummary: missed.summary,
      });
      continue;
    }
    if (thesisByKey.has(key)) {
      thesisRunners.push(runner);
      continue;
    }
    unmatchedUsableRunners.push(runner);
  }

  return {
    generatedAt: new Date().toISOString(),
    catalystLookup: {
      available: params.catalystLookup.available,
      error: params.catalystLookup.error,
      databasePath: params.catalystLookup.databasePath,
      databaseCoverage: params.catalystLookup.databaseCoverage,
    },
    totals: {
      usableRunners: params.usable.length,
      thesisSamples: thesisRunners.length,
      missedRunners: missedRunners.length,
      unmatchedUsableRunners: unmatchedUsableRunners.length,
    },
    catalystCounts,
    missedCatalystCounts,
    missedRunners,
    thesisRunners,
    unmatchedUsableRunners,
  };
}

function renderRunnerCatalystAnalysisMarkdown(analysis: ReturnType<typeof buildRunnerCatalystAnalysis>): string {
  const lines: string[] = [];
  lines.push("# Actual Runner Catalyst Analysis");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- Local press-release DB available: ${analysis.catalystLookup.available ? "yes" : "no"}`);
  if (analysis.catalystLookup.databasePath) {
    lines.push(`- Local press-release DB: \`${analysis.catalystLookup.databasePath}\``);
  }
  if (analysis.catalystLookup.databaseCoverage) {
    const coverage = analysis.catalystLookup.databaseCoverage;
    lines.push(
      `- Local DB coverage: ${coverage.minPublishedAt ?? "n/a"} to ${coverage.maxPublishedAt ?? "n/a"} ` +
      `(ingest_events ${coverage.ingestEvents.count}, website_article_posts ${coverage.websiteArticlePosts.count})`,
    );
  }
  if (analysis.catalystLookup.error) {
    lines.push(`- Lookup error: \`${analysis.catalystLookup.error}\``);
  }
  lines.push(`- Usable runners: ${analysis.totals.usableRunners}`);
  lines.push(`- Thesis samples: ${analysis.totals.thesisSamples}`);
  lines.push(`- Missed runners: ${analysis.totals.missedRunners}`);
  lines.push(`- Unmatched usable runners: ${analysis.totals.unmatchedUsableRunners}`);
  lines.push("");
  lines.push("## Catalyst Counts");
  lines.push("");
  for (const [label, count] of Object.entries(analysis.catalystCounts)) {
    lines.push(`- ${label}: ${count}`);
  }
  lines.push("");
  lines.push("## Missed Runner Catalyst Counts");
  lines.push("");
  for (const [label, count] of Object.entries(analysis.missedCatalystCounts)) {
    lines.push(`- ${label}: ${count}`);
  }
  lines.push("");
  lines.push("## Top Missed Runners");
  lines.push("");
  for (const runner of analysis.missedRunners
    .slice()
    .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
    .slice(0, 60)) {
    lines.push(
      `- ${runner.runnerDate} ${runner.symbol}: best forward ${formatPct(runner.bestForwardPct)}, runner score ${formatPct(runner.runnerScorePct)}, missed reason ${runner.missedReason}, catalyst ${catalystLabel(runner.catalyst)}`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildEodhdNewsCatalystAnalysis(params: {
  runners: Array<SelectedRunner & {
    bestForwardPct: number;
    missedReason: string;
    missedSummary: string;
  }>;
  lookup: EodhdNewsLookupResult;
  lookbackDays: number;
  lookaheadDays: number;
}) {
  const checked = params.runners.filter((runner) => params.lookup.checkedSymbols.includes(runner.symbol.toUpperCase()));
  const rows = checked.map((runner) => {
    const news = classifyEodhdNewsCatalyst({
      runner,
      articles: params.lookup.articlesBySymbol[runner.symbol.toUpperCase()] ?? [],
      lookbackDays: params.lookbackDays,
      lookaheadDays: params.lookaheadDays,
    });
    return {
      ...runner,
      eodhdNews: news,
    };
  });
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.eodhdNews.label] = (counts[row.eodhdNews.label] ?? 0) + 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    lookup: {
      available: params.lookup.available,
      enabled: params.lookup.enabled,
      error: params.lookup.error,
      checkedSymbols: params.lookup.checkedSymbols,
    },
    totals: {
      candidateLocalEmptyMisses: params.runners.length,
      checkedRunners: rows.length,
      checkedSymbols: params.lookup.checkedSymbols.length,
      articlesFetched: Object.values(params.lookup.articlesBySymbol).reduce((sum, articles) => sum + articles.length, 0),
    },
    counts,
    rows,
  };
}

function emptyCatalystCardCounts(): Record<CatalystCardFreshnessLabel, number> {
  return {
    same_day: 0,
    recent_1_2_days: 0,
    stale_3_7_days: 0,
    no_card: 0,
    lookup_unavailable: 0,
  };
}

function buildActiveRunnerTraderReadAnalysis(params: {
  activeRunners: SelectedRunner[];
  report: ChartThesisQaReport;
}) {
  const samplesByKey = new Map(
    params.report.samples.map((sample) => [`${sample.symbol}:${sample.cutoffTimestamp}`, sample]),
  );
  const missedByKey = new Map(
    params.report.missedMoves.map((missed) => [`${missed.symbol}:${missed.cutoffTimestamp}`, missed]),
  );
  const cardCounts = emptyCatalystCardCounts();
  const cardThesisCounts = emptyCatalystCardCounts();
  const localCatalystCounts: Record<string, number> = {};
  const localCatalystThesisCounts: Record<string, number> = {};
  const rows = params.activeRunners.map((runner) => {
    const label = runner.catalystCard?.label ?? "lookup_unavailable";
    const localLabel = runner.catalyst?.label ?? "lookup_unavailable";
    cardCounts[label] += 1;
    localCatalystCounts[localLabel] = (localCatalystCounts[localLabel] ?? 0) + 1;
    const key = `${runner.symbol}:${runner.activeCutoffTimestamp}`;
    const sample = samplesByKey.get(key);
    const missed = missedByKey.get(key);
    if (sample) {
      cardThesisCounts[label] += 1;
      localCatalystThesisCounts[localLabel] = (localCatalystThesisCounts[localLabel] ?? 0) + 1;
    }
    return {
      symbol: runner.symbol,
      runnerDate: runner.runnerDate,
      runnerScorePct: runner.runnerScorePct,
      highVsOpenPct: runner.highVsOpenPct,
      highVsPriorClosePct: runner.highVsPriorClosePct,
      activeCutoffTimestamp: runner.activeCutoffTimestamp,
      activeCutoffIso: runner.activeCutoffIso,
      catalystCard: runner.catalystCard,
      localCatalyst: runner.catalyst,
      outcome: sample ? "thesis" : missed ? "missed_meaningful_move" : "no_thesis_below_meaningful_forward",
      thesisType: sample?.thesis?.type ?? null,
      thesisStatus: sample?.thesis?.status ?? null,
      bestForwardPct: sample?.bestForwardPct ?? missed?.bestForwardPct ?? null,
      missedReason: missed?.reason ?? null,
      summary: sample?.summary ?? missed?.summary ?? `${runner.symbol} had no active-runner thesis sample above the meaningful move threshold.`,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      activeRunners: params.activeRunners.length,
      thesisSamples: params.report.totals.samplesWithThesis,
      missedMeaningfulMoves: params.report.totals.missedMeaningfulMoves,
      hitTarget: params.report.totals.hitTarget,
      partialProgress: params.report.totals.partialProgress,
      noThesisBelowMeaningfulForward: rows.filter((row) => row.outcome === "no_thesis_below_meaningful_forward").length,
    },
    catalystCardCounts: cardCounts,
    catalystCardThesisCounts: cardThesisCounts,
    localCatalystCounts,
    localCatalystThesisCounts,
    thesisStats: params.report.thesisStats,
    rows,
  };
}

function renderActiveRunnerTraderReadAnalysisMarkdown(
  analysis: ReturnType<typeof buildActiveRunnerTraderReadAnalysis>,
): string {
  const lines: string[] = [];
  lines.push("# Active-Runner Trader Read Analysis");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- Active-runner cutoffs: ${analysis.totals.activeRunners}`);
  lines.push(`- Thesis samples: ${analysis.totals.thesisSamples}`);
  lines.push(`- Hit target: ${analysis.totals.hitTarget}`);
  lines.push(`- Partial progress: ${analysis.totals.partialProgress}`);
  lines.push(`- Missed meaningful moves with no thesis: ${analysis.totals.missedMeaningfulMoves}`);
  lines.push(`- No-thesis below meaningful forward threshold: ${analysis.totals.noThesisBelowMeaningfulForward}`);
  lines.push("");
  lines.push("## Catalyst Card State");
  lines.push("");
  for (const [label, count] of Object.entries(analysis.catalystCardCounts)) {
    const thesisCount = analysis.catalystCardThesisCounts[label as CatalystCardFreshnessLabel] ?? 0;
    lines.push(`- ${label}: ${count} active cutoffs, ${thesisCount} with thesis`);
  }
  lines.push("");
  lines.push("## Local Press-Release Catalyst Timing");
  lines.push("");
  for (const [label, count] of Object.entries(analysis.localCatalystCounts).sort((left, right) => right[1] - left[1])) {
    const thesisCount = analysis.localCatalystThesisCounts[label] ?? 0;
    lines.push(`- ${label}: ${count} active cutoffs, ${thesisCount} with thesis`);
  }
  lines.push("");
  lines.push("## Thesis Stats");
  lines.push("");
  if (analysis.thesisStats.length === 0) {
    lines.push("No active-runner thesis samples found.");
  } else {
    for (const stat of analysis.thesisStats) {
      lines.push(`- ${stat.thesisType}: ${stat.samples} samples, useful ${stat.usefulCount}/${stat.samples}, hit ${stat.hitTarget}/${stat.samples}, avg best ${stat.avgBestForwardPct === null ? "n/a" : formatPct(stat.avgBestForwardPct)}`);
    }
  }
  lines.push("");
  lines.push("## Top Active-Runner Rows");
  lines.push("");
  for (const row of analysis.rows
    .slice()
    .sort((left, right) => (right.bestForwardPct ?? -1) - (left.bestForwardPct ?? -1))
    .slice(0, 80)) {
    const title = row.localCatalyst?.primaryArticle?.title
      ? ` (${row.localCatalyst.primaryArticle.title})`
      : row.catalystCard?.primaryArticle?.title
        ? ` (${row.catalystCard.primaryArticle.title})`
        : "";
    lines.push(
      `- ${row.runnerDate} ${row.symbol}: active cutoff ${row.activeCutoffIso}, runner score ${formatPct(row.runnerScorePct)}, outcome ${row.outcome}, best forward ${row.bestForwardPct === null ? "n/a" : formatPct(row.bestForwardPct)}, local catalyst ${row.localCatalyst?.label ?? "not_checked"}, card ${row.catalystCard?.label ?? "not_checked"}${title}, thesis ${row.thesisType ?? "none"}`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

type FiveMinuteTapeParticipationClassification =
  | "strict_breakout_actionable"
  | "constructive_actionable"
  | "hot_but_extended";

type FiveMinuteTapeParticipationOutcome =
  | ChartThesisQaSample["outcome"]
  | "missed_meaningful_move"
  | "no_thesis_below_meaningful_forward";

type FiveMinuteTapeSegmentRow = {
  symbol: string;
  cutoffIso: string;
  outcome: FiveMinuteTapeParticipationOutcome;
  thesisType: string | null;
  bestForwardPct: number;
  classification: FiveMinuteTapeParticipationClassification;
  localCatalyst: string;
  catalystCard: string;
  liveConfirmation: ChartThesisQaSample["liveConfirmation"];
  candleStructure: FiveMinuteCandleStructureRead;
};

type FiveMinuteTapeSegmentStats = {
  key: string;
  label: string;
  rows: number;
  thesisRows: number;
  meaningfulRows: number;
  hitTargetRows: number;
  partialProgressRows: number;
  missedMeaningfulRows: number;
  invalidatedRows: number;
  belowThresholdRows: number;
  move50Rows: number;
  move100Rows: number;
  avgBestForwardPct: number | null;
  medianBestForwardPct: number | null;
  topExamples: Array<{
    symbol: string;
    date: string;
    outcome: FiveMinuteTapeParticipationOutcome;
    bestForwardPct: number;
    thesisType: string | null;
    summary: string;
  }>;
};

function classifyFiveMinuteTapeParticipation(
  status: ChartThesisQaSample["liveConfirmation"]["participationStatus"],
): FiveMinuteTapeParticipationClassification {
  if (status === "confirmed_breakout") {
    return "strict_breakout_actionable";
  }
  if (status === "constructive") {
    return "constructive_actionable";
  }
  return "hot_but_extended";
}

function buildEmptyFiveMinuteTapeParticipationCounts() {
  return {
    strict_breakout_actionable: 0,
    constructive_actionable: 0,
    hot_but_extended: 0,
  } satisfies Record<FiveMinuteTapeParticipationClassification, number>;
}

function buildEmptyFiveMinuteTapeOutcomeCounts() {
  return {
    hit_target: 0,
    partial_progress: 0,
    invalidated: 0,
    no_progress: 0,
    insufficient_forward: 0,
    missed_meaningful_move: 0,
    no_thesis_below_meaningful_forward: 0,
  } satisfies Record<FiveMinuteTapeParticipationOutcome, number>;
}

function isMeaningfulFiveMinuteTapeOutcome(outcome: FiveMinuteTapeParticipationOutcome): boolean {
  return (
    outcome === "hit_target" ||
    outcome === "partial_progress" ||
    outcome === "missed_meaningful_move"
  );
}

function fiveMinuteBucket(value: number | null, buckets: Array<{ max: number; label: string }>, overflowLabel: string): string {
  if (value === null || !Number.isFinite(value)) {
    return "unavailable";
  }
  for (const bucket of buckets) {
    if (value < bucket.max) {
      return bucket.label;
    }
  }
  return overflowLabel;
}

function fiveMinuteVolumeBucket(value: number | null): string {
  return fiveMinuteBucket(value, [
    { max: 2, label: "under_2x" },
    { max: 5, label: "2x_to_5x" },
    { max: 10, label: "5x_to_10x" },
    { max: 25, label: "10x_to_25x" },
  ], "25x_plus");
}

function fiveMinuteExtensionBucket(value: number | null): string {
  return fiveMinuteBucket(value, [
    { max: 0, label: "below_trigger" },
    { max: 6, label: "0_to_6_pct" },
    { max: 15, label: "6_to_15_pct" },
    { max: 40, label: "15_to_40_pct" },
  ], "40_pct_plus");
}

function fiveMinuteLatestRangeBucket(value: number | null): string {
  return fiveMinuteBucket(value, [
    { max: 4, label: "under_4_pct" },
    { max: 10, label: "4_to_10_pct" },
    { max: 20, label: "10_to_20_pct" },
  ], "20_pct_plus");
}

function fiveMinuteSessionPositionBucket(value: number | null): string {
  return fiveMinuteBucket(value, [
    { max: 75, label: "under_75_pct" },
    { max: 125, label: "75_to_125_pct" },
    { max: 250, label: "125_to_250_pct" },
  ], "250_pct_plus");
}

function fiveMinuteCatalystContextBucket(row: Pick<FiveMinuteTapeSegmentRow, "localCatalyst" | "catalystCard">): string {
  if (
    row.localCatalyst === "same_day_premarket_pr" ||
    row.localCatalyst === "same_day_market_or_after_pr" ||
    row.localCatalyst === "prior_evening_pr" ||
    row.catalystCard === "same_day"
  ) {
    return "fresh_context";
  }
  if (
    row.localCatalyst === "nearby_prior_pr" ||
    row.catalystCard === "recent_1_2_days" ||
    row.catalystCard === "stale_3_7_days"
  ) {
    return "recent_or_stale_context";
  }
  if (row.localCatalyst === "lookup_unavailable" || row.catalystCard === "lookup_unavailable") {
    return "lookup_unavailable";
  }
  return "no_context";
}

function buildFiveMinuteSegmentStats(
  key: string,
  label: string,
  rows: FiveMinuteTapeSegmentRow[],
): FiveMinuteTapeSegmentStats {
  const bestForwardValues = rows.map((row) => row.bestForwardPct).filter((value) => Number.isFinite(value));
  return {
    key,
    label,
    rows: rows.length,
    thesisRows: rows.filter((row) => row.thesisType !== null).length,
    meaningfulRows: rows.filter((row) => isMeaningfulFiveMinuteTapeOutcome(row.outcome)).length,
    hitTargetRows: rows.filter((row) => row.outcome === "hit_target").length,
    partialProgressRows: rows.filter((row) => row.outcome === "partial_progress").length,
    missedMeaningfulRows: rows.filter((row) => row.outcome === "missed_meaningful_move").length,
    invalidatedRows: rows.filter((row) => row.outcome === "invalidated").length,
    belowThresholdRows: rows.filter((row) => row.outcome === "no_thesis_below_meaningful_forward").length,
    move50Rows: rows.filter((row) => row.bestForwardPct >= 50).length,
    move100Rows: rows.filter((row) => row.bestForwardPct >= 100).length,
    avgBestForwardPct: bestForwardValues.length === 0
      ? null
      : bestForwardValues.reduce((sum, value) => sum + value, 0) / bestForwardValues.length,
    medianBestForwardPct: median(bestForwardValues),
    topExamples: rows
      .slice()
      .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
      .slice(0, 5)
      .map((row) => ({
        symbol: row.symbol,
        date: row.cutoffIso.slice(0, 10),
        outcome: row.outcome,
        bestForwardPct: row.bestForwardPct,
        thesisType: row.thesisType,
        summary: row.liveConfirmation.summary,
      })),
  };
}

function buildFiveMinuteSegmentGroup(
  label: string,
  rows: FiveMinuteTapeSegmentRow[],
  bucketForRow: (row: FiveMinuteTapeSegmentRow) => string,
) {
  const buckets = new Map<string, FiveMinuteTapeSegmentRow[]>();
  for (const row of rows) {
    const key = bucketForRow(row);
    const bucketRows = buckets.get(key) ?? [];
    bucketRows.push(row);
    buckets.set(key, bucketRows);
  }
  const segments = [...buckets.entries()]
    .map(([key, bucketRows]) => buildFiveMinuteSegmentStats(key, key, bucketRows))
    .sort((left, right) =>
      right.rows - left.rows ||
      right.meaningfulRows - left.meaningfulRows ||
      left.key.localeCompare(right.key),
    );
  return {
    label,
    segments,
  };
}

function findThesisRejection(row: ChartThesisQaMissedMove | undefined, thesisType: string) {
  return row?.rejectionAudit.thesisRejections.find((rejection) => rejection.thesisType === thesisType) ?? null;
}

function hasFreshCatalystBlocker(blockers: string[]): boolean {
  return blockers.some((blocker) => blocker.includes("no fresh same-day/prior-evening catalyst context"));
}

function summarizeNarrowCandidateGateRead(params: {
  outcome: FiveMinuteTapeParticipationOutcome;
  thesisType: string | null;
  primaryBlockers: string[];
  closestThesisType: string | null;
}): string {
  if (params.thesisType) {
    return "Already caught by the active-runner trader read; use as the control case for this QA candidate.";
  }
  if (params.outcome !== "missed_meaningful_move") {
    return "No live thesis, but forward move stayed below the meaningful-move miss bucket; keep as noise control.";
  }
  if (
    params.closestThesisType === "catalyst_active_runner_continuation" &&
    params.primaryBlockers.length === 1 &&
    hasFreshCatalystBlocker(params.primaryBlockers)
  ) {
    return "Missed mainly because catalyst context was absent; this is a scanner/news-context problem before it is a chart-thesis problem.";
  }
  if (hasFreshCatalystBlocker(params.primaryBlockers)) {
    return "Missed with both missing catalyst context and chart-structure blockers; do not promote from 5m tape alone yet.";
  }
  return "Missed despite chart/catalyst gates being near enough to inspect; candidate for deeper replay before engine promotion.";
}

function buildFiveMinuteTapeParticipationAudit(params: {
  activeRunners: SelectedRunner[];
  report: ChartThesisQaReport;
  fetchResults: ActiveRunnerFiveMinuteFetchResult[];
  fiveMinuteResponsesBySymbol: Map<string, CandleProviderResponse>;
}) {
  const activeRunnerByKey = new Map(
    params.activeRunners.map((runner) => [`${runner.symbol}:${runner.activeCutoffTimestamp}`, runner]),
  );
  const sourceBySymbol = new Map(
    params.fetchResults.map((result) => [result.symbol.toUpperCase(), result]),
  );
  const noThesisRowsByKey = new Map(
    [
      ...params.report.missedMoves,
      ...params.report.noThesisBelowMeaningfulForwardRows,
    ].map((row) => [`${row.symbol}:${row.cutoffTimestamp}`, row]),
  );
  const rows = [
    ...params.report.samples.map((sample) => ({
      symbol: sample.symbol,
      cutoffTimestamp: sample.cutoffTimestamp,
      cutoffIso: sample.cutoffIso,
      currentPrice: sample.currentPrice,
      outcome: sample.outcome as FiveMinuteTapeParticipationOutcome,
      thesisType: sample.thesis?.type ?? null,
      thesisStatus: sample.thesis?.status ?? null,
      bestForwardPct: sample.bestForwardPct,
      roomToTargetPct: sample.roomToTargetPct,
      summary: sample.summary,
      liveConfirmation: sample.liveConfirmation,
    })),
    ...params.report.missedMoves.map((missed) => ({
      symbol: missed.symbol,
      cutoffTimestamp: missed.cutoffTimestamp,
      cutoffIso: missed.cutoffIso,
      currentPrice: missed.currentPrice,
      outcome: "missed_meaningful_move" as FiveMinuteTapeParticipationOutcome,
      thesisType: null,
      thesisStatus: null,
      bestForwardPct: missed.bestForwardPct,
      roomToTargetPct: null,
      summary: missed.summary,
      liveConfirmation: missed.liveConfirmation,
    })),
    ...params.report.noThesisBelowMeaningfulForwardRows.map((missed) => ({
      symbol: missed.symbol,
      cutoffTimestamp: missed.cutoffTimestamp,
      cutoffIso: missed.cutoffIso,
      currentPrice: missed.currentPrice,
      outcome: "no_thesis_below_meaningful_forward" as FiveMinuteTapeParticipationOutcome,
      thesisType: null,
      thesisStatus: null,
      bestForwardPct: missed.bestForwardPct,
      roomToTargetPct: null,
      summary: missed.summary,
      liveConfirmation: missed.liveConfirmation,
    })),
  ]
    .filter((row) => row.liveConfirmation.participationPresent)
    .map((row) => {
      const runner = activeRunnerByKey.get(`${row.symbol}:${row.cutoffTimestamp}`);
      const source = sourceBySymbol.get(row.symbol.toUpperCase());
      const fiveMinuteResponse = params.fiveMinuteResponsesBySymbol.get(row.symbol.toUpperCase());
      return {
        ...row,
        classification: classifyFiveMinuteTapeParticipation(row.liveConfirmation.participationStatus),
        selectedFiveMinuteSource: source?.source ?? "unknown",
        selectedFiveMinuteCandles: source?.candles ?? null,
        runnerDate: runner?.runnerDate ?? null,
        runnerScorePct: runner?.runnerScorePct ?? null,
        localCatalyst: runner?.catalyst?.label ?? "lookup_unavailable",
        catalystCard: runner?.catalystCard?.label ?? "lookup_unavailable",
        candleStructure: buildFiveMinuteCandleStructureRead({
          candles: fiveMinuteResponse?.candles ?? [],
          cutoffTimestamp: row.cutoffTimestamp,
          triggerPrice: row.liveConfirmation.triggerPrice,
        }),
      };
    });

  const classificationCounts = buildEmptyFiveMinuteTapeParticipationCounts();
  const outcomeCounts = buildEmptyFiveMinuteTapeOutcomeCounts();
  const sourceStats = new Map<string, {
    source: string;
    rows: number;
    actionableRows: number;
    hotExtendedRows: number;
    thesisRows: number;
    missedMeaningfulRows: number;
    belowThresholdRows: number;
    avgBestForwardPct: number | null;
    bestForwardValues: number[];
  }>();

  for (const row of rows) {
    classificationCounts[row.classification] += 1;
    outcomeCounts[row.outcome] += 1;
    const source = String(row.selectedFiveMinuteSource);
    const sourceStat = sourceStats.get(source) ?? {
      source,
      rows: 0,
      actionableRows: 0,
      hotExtendedRows: 0,
      thesisRows: 0,
      missedMeaningfulRows: 0,
      belowThresholdRows: 0,
      avgBestForwardPct: null,
      bestForwardValues: [],
    };
    sourceStat.rows += 1;
    if (row.classification !== "hot_but_extended") {
      sourceStat.actionableRows += 1;
    } else {
      sourceStat.hotExtendedRows += 1;
    }
    if (row.thesisType) {
      sourceStat.thesisRows += 1;
    }
    if (row.outcome === "missed_meaningful_move") {
      sourceStat.missedMeaningfulRows += 1;
    }
    if (row.outcome === "no_thesis_below_meaningful_forward") {
      sourceStat.belowThresholdRows += 1;
    }
    sourceStat.bestForwardValues.push(row.bestForwardPct);
    sourceStats.set(source, sourceStat);
  }

  const renderedSourceStats = [...sourceStats.values()]
    .map((stat) => ({
      ...stat,
      avgBestForwardPct: stat.bestForwardValues.length === 0
        ? null
        : stat.bestForwardValues.reduce((sum, value) => sum + value, 0) / stat.bestForwardValues.length,
      bestForwardValues: undefined,
    }))
    .sort((left, right) => right.rows - left.rows);
  const narrowCandidateRows = rows.filter((row) =>
    row.classification !== "hot_but_extended" &&
    (row.liveConfirmation.volumeRatio ?? 0) >= 5 &&
    (row.liveConfirmation.latestRangePct ?? 0) >= 4 &&
    (row.liveConfirmation.latestRangePct ?? Number.POSITIVE_INFINITY) <= 15 &&
    (row.liveConfirmation.closeExtensionPct ?? Number.POSITIVE_INFINITY) <= 6
  );
  const broadActionableRows = rows.filter((row) => row.classification !== "hot_but_extended");
  const segmentRows: FiveMinuteTapeSegmentRow[] = rows;
  const segmentation = {
    groups: [
      buildFiveMinuteSegmentGroup("Participation Type", segmentRows, (row) => row.classification),
      buildFiveMinuteSegmentGroup("Live Participation Status", segmentRows, (row) => row.liveConfirmation.participationStatus),
      buildFiveMinuteSegmentGroup("Volume Ratio", segmentRows, (row) => fiveMinuteVolumeBucket(row.liveConfirmation.volumeRatio)),
      buildFiveMinuteSegmentGroup("Extension Above Trigger", segmentRows, (row) => fiveMinuteExtensionBucket(row.liveConfirmation.closeExtensionPct)),
      buildFiveMinuteSegmentGroup("Latest 5m Range", segmentRows, (row) => fiveMinuteLatestRangeBucket(row.liveConfirmation.latestRangePct)),
      buildFiveMinuteSegmentGroup("Session Position", segmentRows, (row) => fiveMinuteSessionPositionBucket(row.liveConfirmation.sessionPositionPct)),
      buildFiveMinuteSegmentGroup("5m Candle Structure", segmentRows, (row) => row.candleStructure.structureRead),
      buildFiveMinuteSegmentGroup("Catalyst Context", segmentRows, (row) => fiveMinuteCatalystContextBucket(row)),
      buildFiveMinuteSegmentGroup(
        "Participation Type x Extension",
        segmentRows,
        (row) => `${row.classification}__${fiveMinuteExtensionBucket(row.liveConfirmation.closeExtensionPct)}`,
      ),
      buildFiveMinuteSegmentGroup(
        "Participation Type x Volume",
        segmentRows,
        (row) => `${row.classification}__${fiveMinuteVolumeBucket(row.liveConfirmation.volumeRatio)}`,
      ),
      buildFiveMinuteSegmentGroup(
        "Participation Type x Catalyst Context",
        segmentRows,
        (row) => `${row.classification}__${fiveMinuteCatalystContextBucket(row)}`,
      ),
    ],
    strongestSegments: [
      ...[
        buildFiveMinuteSegmentGroup(
          "Participation Type x Extension",
          segmentRows,
          (row) => `${row.classification}__${fiveMinuteExtensionBucket(row.liveConfirmation.closeExtensionPct)}`,
        ),
        buildFiveMinuteSegmentGroup(
          "Participation Type x Volume",
          segmentRows,
          (row) => `${row.classification}__${fiveMinuteVolumeBucket(row.liveConfirmation.volumeRatio)}`,
        ),
        buildFiveMinuteSegmentGroup(
          "Participation Type x Catalyst Context",
          segmentRows,
          (row) => `${row.classification}__${fiveMinuteCatalystContextBucket(row)}`,
        ),
        buildFiveMinuteSegmentGroup(
          "Participation Type x 5m Candle Structure",
          segmentRows,
          (row) => `${row.classification}__${row.candleStructure.structureRead}`,
        ),
      ].flatMap((group) => group.segments.map((segment) => ({ ...segment, group: group.label }))),
    ]
      .filter((segment) => segment.rows >= 3)
      .sort((left, right) =>
        (right.meaningfulRows / Math.max(1, right.rows)) - (left.meaningfulRows / Math.max(1, left.rows)) ||
        right.move50Rows - left.move50Rows ||
        (right.avgBestForwardPct ?? 0) - (left.avgBestForwardPct ?? 0),
      )
      .slice(0, 10),
  };
  const narrowCandidateGateComparison = narrowCandidateRows
    .map((row) => {
      const noThesisRow = noThesisRowsByKey.get(`${row.symbol}:${row.cutoffTimestamp}`);
      const catalystRejection = findThesisRejection(noThesisRow, "catalyst_active_runner_continuation");
      const momentumRejection = findThesisRejection(noThesisRow, "momentum_expansion_continuation");
      const clearedShelfRejection = findThesisRejection(noThesisRow, "cleared_shelf_power_continuation");
      const closest = noThesisRow?.rejectionAudit.thesisRejections[0] ?? null;
      const primaryBlockers = noThesisRow?.rejectionAudit.primaryBlockers ?? [];
      const missingFreshCatalystContext =
        hasFreshCatalystBlocker(primaryBlockers) ||
        hasFreshCatalystBlocker(catalystRejection?.blockers ?? []);
      return {
        symbol: row.symbol,
        runnerDate: row.runnerDate,
        cutoffTimestamp: row.cutoffTimestamp,
        cutoffIso: row.cutoffIso,
        outcome: row.outcome,
        thesisType: row.thesisType,
        classification: row.classification,
        bestForwardPct: row.bestForwardPct,
        runnerScorePct: row.runnerScorePct,
        localCatalyst: row.localCatalyst,
        catalystCard: row.catalystCard,
        liveConfirmation: row.liveConfirmation,
        closestThesisType: noThesisRow?.rejectionAudit.closestThesisType ?? row.thesisType ?? null,
        nearMissScore: closest?.nearMissScore ?? (row.thesisType ? 1 : null),
        primaryBlockers,
        missingFreshCatalystContext,
        blockedOnlyByFreshCatalyst:
          row.thesisType === null &&
          row.outcome === "missed_meaningful_move" &&
          noThesisRow?.rejectionAudit.closestThesisType === "catalyst_active_runner_continuation" &&
          primaryBlockers.length === 1 &&
          hasFreshCatalystBlocker(primaryBlockers),
        catalystBlockers: catalystRejection?.blockers ?? [],
        momentumBlockers: momentumRejection?.blockers ?? [],
        clearedShelfBlockers: clearedShelfRejection?.blockers ?? [],
        catalystDiagnostics: catalystRejection?.diagnostics ?? null,
        momentumDiagnostics: momentumRejection?.diagnostics ?? null,
        clearedShelfDiagnostics: clearedShelfRejection?.diagnostics ?? null,
        gateRead: summarizeNarrowCandidateGateRead({
          outcome: row.outcome,
          thesisType: row.thesisType,
          primaryBlockers,
          closestThesisType: noThesisRow?.rejectionAudit.closestThesisType ?? row.thesisType ?? null,
        }),
        summary: row.summary,
      };
    })
    .sort((left, right) => right.bestForwardPct - left.bestForwardPct);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      participationRows: rows.length,
      actionableRows: broadActionableRows.length,
      hotExtendedRows: rows.filter((row) => row.classification === "hot_but_extended").length,
      thesisRows: rows.filter((row) => row.thesisType !== null).length,
      missedMeaningfulRows: rows.filter((row) => row.outcome === "missed_meaningful_move").length,
      belowThresholdRows: rows.filter((row) => row.outcome === "no_thesis_below_meaningful_forward").length,
    },
    classificationCounts,
    outcomeCounts,
    sourceStats: renderedSourceStats,
    segmentation,
    narrowCandidateRule: {
      description:
        "QA-only candidate: actionable 5m tape, 5x+ volume, 4%-15% latest 5m range, and no more than 6% above the near-term hold.",
      count: narrowCandidateRows.length,
      meaningfulRows: narrowCandidateRows.filter((row) => isMeaningfulFiveMinuteTapeOutcome(row.outcome)).length,
      thesisRows: narrowCandidateRows.filter((row) => row.thesisType !== null).length,
      missedMeaningfulRows: narrowCandidateRows.filter((row) => row.outcome === "missed_meaningful_move").length,
      invalidatedRows: narrowCandidateRows.filter((row) => row.outcome === "invalidated").length,
      belowThresholdRows: narrowCandidateRows.filter((row) => row.outcome === "no_thesis_below_meaningful_forward").length,
      avgBestForwardPct: narrowCandidateRows.length === 0
        ? null
        : narrowCandidateRows.reduce((sum, row) => sum + row.bestForwardPct, 0) / narrowCandidateRows.length,
      gateComparison: {
        description:
          "Cross-check of the narrow 5m candidate against the same 200-runner rejection audit, so we can see whether the candidate only bypasses missing catalyst context or also bypasses real chart-structure blockers.",
        withExistingThesis: narrowCandidateGateComparison.filter((row) => row.thesisType !== null).length,
        missedWithoutThesis: narrowCandidateGateComparison.filter((row) => row.outcome === "missed_meaningful_move" && row.thesisType === null).length,
        missingFreshCatalystContext: narrowCandidateGateComparison.filter((row) => row.missingFreshCatalystContext).length,
        blockedOnlyByFreshCatalyst: narrowCandidateGateComparison.filter((row) => row.blockedOnlyByFreshCatalyst).length,
        rows: narrowCandidateGateComparison,
      },
      rows: narrowCandidateRows.sort((left, right) => right.bestForwardPct - left.bestForwardPct),
    },
    broadActionableRule: {
      description: "QA-only broader bucket: strict breakout or constructive 5m tape, excluding hot-but-extended rows.",
      count: broadActionableRows.length,
      meaningfulRows: broadActionableRows.filter((row) => isMeaningfulFiveMinuteTapeOutcome(row.outcome)).length,
      thesisRows: broadActionableRows.filter((row) => row.thesisType !== null).length,
      missedMeaningfulRows: broadActionableRows.filter((row) => row.outcome === "missed_meaningful_move").length,
      invalidatedRows: broadActionableRows.filter((row) => row.outcome === "invalidated").length,
      belowThresholdRows: broadActionableRows.filter((row) => row.outcome === "no_thesis_below_meaningful_forward").length,
      avgBestForwardPct: broadActionableRows.length === 0
        ? null
        : broadActionableRows.reduce((sum, row) => sum + row.bestForwardPct, 0) / broadActionableRows.length,
      rows: broadActionableRows.sort((left, right) => right.bestForwardPct - left.bestForwardPct),
    },
    rows: rows
      .sort((left, right) => right.bestForwardPct - left.bestForwardPct),
  };
}

function renderFiveMinuteTapeParticipationAuditMarkdown(
  audit: ReturnType<typeof buildFiveMinuteTapeParticipationAudit>,
): string {
  const lines: string[] = [];
  const segmentLine = (segment: FiveMinuteTapeSegmentStats) =>
    `- ${segment.label}: rows ${segment.rows}, meaningful ${segment.meaningfulRows}/${segment.rows}, hit ${segment.hitTargetRows}, partial ${segment.partialProgressRows}, missed ${segment.missedMeaningfulRows}, invalidated ${segment.invalidatedRows}, below-threshold ${segment.belowThresholdRows}, >=50% ${segment.move50Rows}, >=100% ${segment.move100Rows}, median best ${segment.medianBestForwardPct === null ? "n/a" : formatPct(segment.medianBestForwardPct)}, avg best ${segment.avgBestForwardPct === null ? "n/a" : formatPct(segment.avgBestForwardPct)}`;
  lines.push("# Active-Runner 5m Tape Participation QA");
  lines.push("");
  lines.push(`- Generated: ${audit.generatedAt}`);
  lines.push(`- Participation rows: ${audit.totals.participationRows}`);
  lines.push(`- Actionable-style rows: ${audit.totals.actionableRows}`);
  lines.push(`- Hot-but-extended rows: ${audit.totals.hotExtendedRows}`);
  lines.push(`- With thesis: ${audit.totals.thesisRows}`);
  lines.push(`- Missed meaningful moves: ${audit.totals.missedMeaningfulRows}`);
  lines.push(`- Below meaningful threshold: ${audit.totals.belowThresholdRows}`);
  lines.push("- Recommendation: keep 5m tape participation as QA/supporting evidence for now; promote only the actionable-style subset after reviewing whether the hot-but-extended rows are useful warnings or chase-risk noise.");
  lines.push("");
  lines.push("## Candidate Rules");
  lines.push("");
  lines.push(`- Narrow actionable rule: ${audit.narrowCandidateRule.count} rows, meaningful ${audit.narrowCandidateRule.meaningfulRows}/${audit.narrowCandidateRule.count}, missed ${audit.narrowCandidateRule.missedMeaningfulRows}, invalidated ${audit.narrowCandidateRule.invalidatedRows}, below-threshold ${audit.narrowCandidateRule.belowThresholdRows}, avg best ${audit.narrowCandidateRule.avgBestForwardPct === null ? "n/a" : formatPct(audit.narrowCandidateRule.avgBestForwardPct)}`);
  lines.push(`  - ${audit.narrowCandidateRule.description}`);
  lines.push(`- Broad actionable bucket: ${audit.broadActionableRule.count} rows, meaningful ${audit.broadActionableRule.meaningfulRows}/${audit.broadActionableRule.count}, missed ${audit.broadActionableRule.missedMeaningfulRows}, invalidated ${audit.broadActionableRule.invalidatedRows}, below-threshold ${audit.broadActionableRule.belowThresholdRows}, avg best ${audit.broadActionableRule.avgBestForwardPct === null ? "n/a" : formatPct(audit.broadActionableRule.avgBestForwardPct)}`);
  lines.push(`  - ${audit.broadActionableRule.description}`);
  lines.push("");
  lines.push("### Narrow Candidate Rows");
  lines.push("");
  for (const row of audit.narrowCandidateRule.rows) {
    lines.push(`- ${row.runnerDate ?? row.cutoffIso.slice(0, 10)} ${row.symbol}: outcome ${row.outcome}, best ${formatPct(row.bestForwardPct)}, thesis ${row.thesisType ?? "none"}, local catalyst ${row.localCatalyst}, card ${row.catalystCard}`);
    lines.push(`  - ${row.liveConfirmation.summary}`);
    lines.push(`  - Structure: ${row.candleStructure.structureRead}; ${row.candleStructure.summary}`);
  }
  lines.push("");
  lines.push("### Narrow Candidate Gate Comparison");
  lines.push("");
  lines.push(`- ${audit.narrowCandidateRule.gateComparison.description}`);
  lines.push(`- Existing thesis controls: ${audit.narrowCandidateRule.gateComparison.withExistingThesis}`);
  lines.push(`- Missed without thesis: ${audit.narrowCandidateRule.gateComparison.missedWithoutThesis}`);
  lines.push(`- Missing fresh catalyst context: ${audit.narrowCandidateRule.gateComparison.missingFreshCatalystContext}`);
  lines.push(`- Blocked only by fresh catalyst context: ${audit.narrowCandidateRule.gateComparison.blockedOnlyByFreshCatalyst}`);
  lines.push("");
  for (const row of audit.narrowCandidateRule.gateComparison.rows) {
    lines.push(
      `- ${row.runnerDate ?? row.cutoffIso.slice(0, 10)} ${row.symbol}: ${row.gateRead}`,
    );
    lines.push(
      `  - Outcome ${row.outcome}, best ${formatPct(row.bestForwardPct)}, closest ${row.closestThesisType ?? "n/a"}${row.nearMissScore === null ? "" : ` (${(row.nearMissScore * 100).toFixed(0)}%)`}, runner score ${row.runnerScorePct === null ? "n/a" : formatPct(row.runnerScorePct)}, local catalyst ${row.localCatalyst}, card ${row.catalystCard}`,
    );
    for (const blocker of row.primaryBlockers.slice(0, 4)) {
      lines.push(`  - Blocker: ${blocker}`);
    }
  }
  lines.push("");
  lines.push("## Segmentation");
  lines.push("");
  lines.push("### Strongest Multi-Factor Segments");
  lines.push("");
  if (audit.segmentation.strongestSegments.length === 0) {
    lines.push("- No segment had at least 3 rows.");
  } else {
    for (const segment of audit.segmentation.strongestSegments) {
      lines.push(`- ${segment.group} / ${segment.label}: rows ${segment.rows}, meaningful ${segment.meaningfulRows}/${segment.rows}, hit ${segment.hitTargetRows}, partial ${segment.partialProgressRows}, missed ${segment.missedMeaningfulRows}, invalidated ${segment.invalidatedRows}, below-threshold ${segment.belowThresholdRows}, >=50% ${segment.move50Rows}, >=100% ${segment.move100Rows}, median best ${segment.medianBestForwardPct === null ? "n/a" : formatPct(segment.medianBestForwardPct)}, avg best ${segment.avgBestForwardPct === null ? "n/a" : formatPct(segment.avgBestForwardPct)}`);
    }
  }
  lines.push("");
  for (const group of audit.segmentation.groups) {
    lines.push(`### ${group.label}`);
    lines.push("");
    for (const segment of group.segments) {
      lines.push(segmentLine(segment));
      for (const example of segment.topExamples.slice(0, 2)) {
        lines.push(`  - ${example.date} ${example.symbol}: ${example.outcome}, best ${formatPct(example.bestForwardPct)}, thesis ${example.thesisType ?? "none"}`);
      }
    }
    lines.push("");
  }
  lines.push("## Classification Counts");
  lines.push("");
  for (const [classification, count] of Object.entries(audit.classificationCounts)) {
    lines.push(`- ${classification}: ${count}`);
  }
  lines.push("");
  lines.push("## Outcome Counts");
  lines.push("");
  for (const [outcome, count] of Object.entries(audit.outcomeCounts)) {
    lines.push(`- ${outcome}: ${count}`);
  }
  lines.push("");
  lines.push("## Source Stats");
  lines.push("");
  for (const stat of audit.sourceStats) {
    lines.push(
      `- ${stat.source}: ${stat.rows} rows, actionable ${stat.actionableRows}, hot-extended ${stat.hotExtendedRows}, thesis ${stat.thesisRows}, missed ${stat.missedMeaningfulRows}, below-threshold ${stat.belowThresholdRows}, avg best ${stat.avgBestForwardPct === null ? "n/a" : formatPct(stat.avgBestForwardPct)}`,
    );
  }
  lines.push("");
  lines.push("## Top Participation Rows");
  lines.push("");
  for (const row of audit.rows.slice(0, 80)) {
    lines.push(
      `- ${row.runnerDate ?? row.cutoffIso.slice(0, 10)} ${row.symbol}: ${row.classification}, outcome ${row.outcome}, best ${formatPct(row.bestForwardPct)}, source ${row.selectedFiveMinuteSource} (${row.selectedFiveMinuteCandles ?? "n/a"} candles), thesis ${row.thesisType ?? "none"}, local catalyst ${row.localCatalyst}, card ${row.catalystCard}`,
    );
    lines.push(`  - ${row.liveConfirmation.summary}`);
    lines.push(`  - Structure: ${row.candleStructure.structureRead}; ${row.candleStructure.summary}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function blockerCount(rows: Array<{ primaryBlockers: string[] }>): Array<{ blocker: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const blocker of row.primaryBlockers) {
      counts.set(blocker, (counts.get(blocker) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([blocker, count]) => ({ blocker, count }))
    .sort((left, right) => right.count - left.count || left.blocker.localeCompare(right.blocker));
}

function buildActiveRunnerHotExtendedVolumeAnalysis(params: {
  tapeAudit: ReturnType<typeof buildFiveMinuteTapeParticipationAudit>;
  report: ChartThesisQaReport;
}) {
  const noThesisRowsByKey = new Map(
    [
      ...params.report.missedMoves,
      ...params.report.noThesisBelowMeaningfulForwardRows,
    ].map((row) => [`${row.symbol}:${row.cutoffTimestamp}`, row]),
  );
  const rows = params.tapeAudit.rows
    .filter((row) =>
      row.classification === "hot_but_extended" &&
      (row.liveConfirmation.volumeRatio ?? 0) >= 5 &&
      (row.liveConfirmation.volumeRatio ?? Number.POSITIVE_INFINITY) < 10
    )
    .map((row) => {
      const noThesisRow = noThesisRowsByKey.get(`${row.symbol}:${row.cutoffTimestamp}`);
      const closest = noThesisRow?.rejectionAudit.thesisRejections[0] ?? null;
      const momentumRejection = findThesisRejection(noThesisRow, "momentum_expansion_continuation");
      const catalystRejection = findThesisRejection(noThesisRow, "catalyst_active_runner_continuation");
      const primaryBlockers = noThesisRow?.rejectionAudit.primaryBlockers ?? [];
      const closeStrengthBlocked =
        primaryBlockers.some((blocker) =>
          blocker === "latest candle did not close strong enough" ||
          blocker === "price was not holding the upper half of the active candle"
        ) ||
        (momentumRejection?.blockers ?? []).includes("latest candle did not close strong enough") ||
        (catalystRejection?.blockers ?? []).includes("price was not holding the upper half of the active candle");
      const freshContext =
        row.localCatalyst === "same_day_premarket_pr" ||
        row.localCatalyst === "same_day_market_or_after_pr" ||
        row.localCatalyst === "prior_evening_pr" ||
        row.catalystCard === "same_day";
      return {
        symbol: row.symbol,
        runnerDate: row.runnerDate ?? row.cutoffIso.slice(0, 10),
        cutoffTimestamp: row.cutoffTimestamp,
        cutoffIso: row.cutoffIso,
        currentPrice: row.currentPrice,
        outcome: row.outcome,
        thesisType: row.thesisType,
        classification: row.classification,
        bestForwardPct: row.bestForwardPct,
        meaningfulForward: isMeaningfulFiveMinuteTapeOutcome(row.outcome),
        move50: row.bestForwardPct >= 50,
        move100: row.bestForwardPct >= 100,
        localCatalyst: row.localCatalyst,
        catalystCard: row.catalystCard,
        freshContext,
        liveConfirmation: row.liveConfirmation,
        candleStructure: row.candleStructure,
        reason: noThesisRow?.reason ?? (row.thesisType ? "already_had_thesis" : "below_meaningful_forward"),
        closestThesisType: noThesisRow?.rejectionAudit.closestThesisType ?? row.thesisType ?? null,
        nearMissScore: closest?.nearMissScore ?? (row.thesisType ? 1 : null),
        primaryBlockers,
        closeStrengthBlocked,
        momentumBlockers: momentumRejection?.blockers ?? [],
        catalystBlockers: catalystRejection?.blockers ?? [],
        momentumDiagnostics: momentumRejection?.diagnostics ?? null,
        catalystDiagnostics: catalystRejection?.diagnostics ?? null,
        summary: row.summary,
      };
    })
    .sort((left, right) => right.bestForwardPct - left.bestForwardPct);

  const missedRows = rows.filter((row) => row.outcome === "missed_meaningful_move" && row.thesisType === null);
  const belowThresholdRows = rows.filter((row) => row.outcome === "no_thesis_below_meaningful_forward");
  const closeStrengthBlockedRows = rows.filter((row) => row.closeStrengthBlocked);
  const likelyContinuationRows = rows.filter((row) =>
    row.meaningfulForward &&
    row.thesisType === null &&
    row.closeStrengthBlocked &&
    (row.nearMissScore ?? 0) >= 0.85 &&
    (row.liveConfirmation.latestRangePct ?? 0) >= 4 &&
    (row.liveConfirmation.latestRangePct ?? 0) <= 14 &&
    (row.liveConfirmation.closeExtensionPct ?? 0) >= 10 &&
    (row.liveConfirmation.closeExtensionPct ?? 0) <= 45
  );

  return {
    generatedAt: new Date().toISOString(),
    description:
      "QA-only audit for hot-extended 5m participation with 5x-10x recent volume, the segment that showed many missed continuation moves in the 200-runner sample.",
    totals: {
      rows: rows.length,
      meaningfulRows: rows.filter((row) => row.meaningfulForward).length,
      missedMeaningfulRows: missedRows.length,
      belowThresholdRows: belowThresholdRows.length,
      move50Rows: rows.filter((row) => row.move50).length,
      move100Rows: rows.filter((row) => row.move100).length,
      closeStrengthBlockedRows: closeStrengthBlockedRows.length,
      likelyContinuationRows: likelyContinuationRows.length,
      freshContextRows: rows.filter((row) => row.freshContext).length,
    },
    blockerLeaderboard: blockerCount(rows),
    variants: [
      buildFiveMinuteSegmentStats("hot_extended_5x_to_10x_all", "All hot-extended 5x-10x rows", rows),
      buildFiveMinuteSegmentStats(
        "close_strength_blocked_near_miss",
        "4h close/hold blocker but 5m tape still participating",
        closeStrengthBlockedRows,
      ),
      buildFiveMinuteSegmentStats(
        "likely_continuation_candidate",
        "QA-only likely continuation candidate: close/hold blocker, near-miss score >=85%, 4%-14% latest 5m range, 10%-45% above trigger",
        likelyContinuationRows,
      ),
      buildFiveMinuteSegmentStats(
        "fresh_context_only",
        "Fresh catalyst context inside hot-extended 5x-10x",
        rows.filter((row) => row.freshContext),
      ),
      buildFiveMinuteSegmentStats(
        "no_fresh_context",
        "No fresh catalyst context inside hot-extended 5x-10x",
        rows.filter((row) => !row.freshContext),
      ),
    ],
    recommendation: likelyContinuationRows.length >= 4 && belowThresholdRows.length <= 1
      ? "This bucket deserves a broader QA replay as a possible 5m continuation-support signal, but it should not be promoted live until tested beyond this 200-runner sample."
      : "Keep this QA-only; the bucket is interesting, but the current sample is too small or too mixed for a trader-facing thesis.",
    rows,
  };
}

function renderActiveRunnerHotExtendedVolumeMarkdown(
  analysis: ReturnType<typeof buildActiveRunnerHotExtendedVolumeAnalysis>,
): string {
  const lines: string[] = [];
  lines.push("# Active-Runner Hot-Extended 5m Volume QA");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- ${analysis.description}`);
  lines.push(`- Rows: ${analysis.totals.rows}`);
  lines.push(`- Meaningful rows: ${analysis.totals.meaningfulRows}`);
  lines.push(`- Missed meaningful rows: ${analysis.totals.missedMeaningfulRows}`);
  lines.push(`- Below-threshold rows: ${analysis.totals.belowThresholdRows}`);
  lines.push(`- >=50% rows: ${analysis.totals.move50Rows}`);
  lines.push(`- >=100% rows: ${analysis.totals.move100Rows}`);
  lines.push(`- Close/hold blocker rows: ${analysis.totals.closeStrengthBlockedRows}`);
  lines.push(`- Likely continuation candidate rows: ${analysis.totals.likelyContinuationRows}`);
  lines.push(`- Fresh catalyst context rows: ${analysis.totals.freshContextRows}`);
  lines.push(`- Recommendation: ${analysis.recommendation}`);
  lines.push("");
  lines.push("## Candidate Variants");
  lines.push("");
  for (const variant of analysis.variants) {
    lines.push(
      `- ${variant.key}: ${variant.label}; rows ${variant.rows}, meaningful ${variant.meaningfulRows}/${variant.rows}, missed ${variant.missedMeaningfulRows}, below-threshold ${variant.belowThresholdRows}, >=50% ${variant.move50Rows}, >=100% ${variant.move100Rows}, median best ${variant.medianBestForwardPct === null ? "n/a" : formatPct(variant.medianBestForwardPct)}, avg best ${variant.avgBestForwardPct === null ? "n/a" : formatPct(variant.avgBestForwardPct)}`,
    );
  }
  lines.push("");
  lines.push("## Top Blockers");
  lines.push("");
  for (const item of analysis.blockerLeaderboard.slice(0, 12)) {
    lines.push(`- ${item.blocker}: ${item.count}`);
  }
  lines.push("");
  lines.push("## Rows");
  lines.push("");
  for (const row of analysis.rows) {
    lines.push(
      `- ${row.runnerDate} ${row.symbol}: outcome ${row.outcome}, best ${formatPct(row.bestForwardPct)}, closest ${row.closestThesisType ?? "n/a"}${row.nearMissScore === null ? "" : ` (${(row.nearMissScore * 100).toFixed(0)}%)`}, local ${row.localCatalyst}, card ${row.catalystCard}`,
    );
    lines.push(
      `  - 5m: volume ${row.liveConfirmation.volumeRatio === null ? "n/a" : `${row.liveConfirmation.volumeRatio.toFixed(1)}x`}, range ${row.liveConfirmation.latestRangePct === null ? "n/a" : formatPct(row.liveConfirmation.latestRangePct)}, extension ${row.liveConfirmation.closeExtensionPct === null ? "n/a" : formatPct(row.liveConfirmation.closeExtensionPct)}, session position ${row.liveConfirmation.sessionPositionPct === null ? "n/a" : `${row.liveConfirmation.sessionPositionPct.toFixed(1)}%`}`,
    );
    for (const blocker of row.primaryBlockers.slice(0, 4)) {
      lines.push(`  - Blocker: ${blocker}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

type CompositeCandidateScoreRow = FiveMinuteTapeSegmentRow & {
  runnerDate: string;
  cutoffTimestamp: number;
  selectedFiveMinuteSource: string;
  runnerScorePct: number | null;
  currentPrice: number;
  summary: string;
  closestThesisType: string | null;
  nearMissScore: number | null;
  primaryBlockers: string[];
  score: number;
  scoreBand: "high" | "medium" | "low";
  scoreReasons: string[];
  riskFlags: string[];
  meaningfulForward: boolean;
  move50: boolean;
  move100: boolean;
};

function scoreActiveRunnerCompositeCandidate(params: {
  row: ReturnType<typeof buildFiveMinuteTapeParticipationAudit>["rows"][number];
  noThesisRow: ChartThesisQaMissedMove | undefined;
}): Pick<CompositeCandidateScoreRow, "score" | "scoreBand" | "scoreReasons" | "riskFlags" | "closestThesisType" | "nearMissScore" | "primaryBlockers"> {
  const { row, noThesisRow } = params;
  const scoreReasons: string[] = [];
  const riskFlags: string[] = [];
  let score = 0;

  const volumeRatio = row.liveConfirmation.volumeRatio ?? 0;
  const latestRangePct = row.liveConfirmation.latestRangePct ?? 0;
  const closeExtensionPct = row.liveConfirmation.closeExtensionPct ?? 0;
  const sessionPositionPct = row.liveConfirmation.sessionPositionPct ?? 0;
  const closest = noThesisRow?.rejectionAudit.thesisRejections[0] ?? null;
  const primaryBlockers = noThesisRow?.rejectionAudit.primaryBlockers ?? [];
  const nearMissScore = closest?.nearMissScore ?? (row.thesisType ? 1 : null);
  const closestThesisType = noThesisRow?.rejectionAudit.closestThesisType ?? row.thesisType ?? null;

  if (row.classification === "strict_breakout_actionable") {
    score += 18;
    scoreReasons.push("strict 5m breakout participation");
  } else if (row.classification === "constructive_actionable") {
    score += 22;
    scoreReasons.push("constructive 5m participation");
  } else {
    score += 8;
    scoreReasons.push("hot extended 5m participation");
  }

  if (volumeRatio >= 2 && volumeRatio < 10) {
    score += 16;
    scoreReasons.push("measured 2x-10x recent volume");
  } else if (volumeRatio >= 10 && volumeRatio < 25) {
    score += 8;
    scoreReasons.push("strong 10x-25x recent volume");
  } else if (volumeRatio >= 25) {
    score += 4;
    riskFlags.push("very high volume can be exhaustion/noise");
  }

  if (latestRangePct >= 4 && latestRangePct <= 14) {
    score += 14;
    scoreReasons.push("latest 5m range is active but not extreme");
  } else if (latestRangePct > 14 && latestRangePct <= 25) {
    score += 6;
    riskFlags.push("wide latest 5m range");
  } else if (latestRangePct > 25) {
    score -= 8;
    riskFlags.push("latest 5m range is very wide");
  }

  if (closeExtensionPct <= 6) {
    score += 14;
    scoreReasons.push("near trigger instead of chasing far above it");
  } else if (closeExtensionPct <= 15) {
    score += 10;
    scoreReasons.push("modest extension above trigger");
  } else if (closeExtensionPct <= 45) {
    score += row.classification === "hot_but_extended" ? 8 : 3;
    scoreReasons.push("extended but still inside tested continuation band");
  } else {
    score -= 10;
    riskFlags.push("far above trigger");
  }

  if (sessionPositionPct >= 75 && sessionPositionPct <= 250) {
    score += 12;
    scoreReasons.push("price is in a tradable session-position band");
  } else if (sessionPositionPct > 250) {
    score += 2;
    riskFlags.push("very extended versus session range");
  } else if (sessionPositionPct > 0 && sessionPositionPct < 75) {
    score -= 4;
    riskFlags.push("session position has not proven upper-range control");
  }

  if (row.localCatalyst === "same_day_premarket_pr" || row.localCatalyst === "same_day_market_or_after_pr" || row.localCatalyst === "prior_evening_pr" || row.catalystCard === "same_day") {
    score += 12;
    scoreReasons.push("fresh catalyst context");
  } else if (row.catalystCard === "recent_1_2_days" || row.localCatalyst === "nearby_prior_pr") {
    score += 3;
    riskFlags.push("context is nearby but not fresh");
  } else {
    riskFlags.push("no verified same-day/prior-evening catalyst context");
  }

  if ((nearMissScore ?? 0) >= 0.85) {
    score += 12;
    scoreReasons.push("near-miss chart thesis gate");
  } else if ((nearMissScore ?? 0) >= 0.7) {
    score += 5;
    scoreReasons.push("partial near-miss chart thesis gate");
  }

  for (const blocker of primaryBlockers) {
    if (
      blocker === "latest candle did not close strong enough" ||
      blocker === "price was not holding the upper half of the active candle" ||
      blocker === "price did not clear the prior high area"
    ) {
      score -= 6;
      riskFlags.push(blocker);
    } else if (blocker === "active candle looked too exhausted") {
      score -= 12;
      riskFlags.push(blocker);
    } else if (blocker.includes("no fresh same-day/prior-evening catalyst context")) {
      score -= 3;
      riskFlags.push(blocker);
    }
  }

  if (row.thesisType) {
    score += 6;
    scoreReasons.push("already caught by baseline trader read");
  }

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const scoreBand = boundedScore >= 70 ? "high" : boundedScore >= 50 ? "medium" : "low";
  return {
    score: boundedScore,
    scoreBand,
    scoreReasons,
    riskFlags: [...new Set(riskFlags)],
    closestThesisType,
    nearMissScore,
    primaryBlockers,
  };
}

function summarizeCompositeCandidateVariant(name: string, description: string, rows: CompositeCandidateScoreRow[]) {
  const bestForwardValues = rows.map((row) => row.bestForwardPct).sort((left, right) => left - right);
  const meaningfulRows = rows.filter((row) => row.meaningfulForward);
  const hitTargetRows = rows.filter((row) => row.outcome === "hit_target");
  const partialProgressRows = rows.filter((row) => row.outcome === "partial_progress");
  const missedMeaningfulRows = rows.filter((row) => row.outcome === "missed_meaningful_move");
  const invalidatedRows = rows.filter((row) => row.outcome === "invalidated");
  const belowThresholdRows = rows.filter((row) => row.outcome === "no_thesis_below_meaningful_forward");
  return {
    name,
    description,
    rows: rows.length,
    meaningfulRows: meaningfulRows.length,
    hitTargetRows: hitTargetRows.length,
    partialProgressRows: partialProgressRows.length,
    missedMeaningfulRows: missedMeaningfulRows.length,
    invalidatedRows: invalidatedRows.length,
    belowThresholdRows: belowThresholdRows.length,
    move50Rows: rows.filter((row) => row.move50).length,
    move100Rows: rows.filter((row) => row.move100).length,
    avgScore: rows.length === 0 ? null : rows.reduce((sum, row) => sum + row.score, 0) / rows.length,
    avgBestForwardPct: rows.length === 0 ? null : rows.reduce((sum, row) => sum + row.bestForwardPct, 0) / rows.length,
    medianBestForwardPct: median(bestForwardValues),
    topRows: rows
      .slice()
      .sort((left, right) => right.score - left.score || right.bestForwardPct - left.bestForwardPct)
      .slice(0, 12),
  };
}

function buildActiveRunnerCompositeCandidateScoreAnalysis(params: {
  tapeAudit: ReturnType<typeof buildFiveMinuteTapeParticipationAudit>;
  report: ChartThesisQaReport;
}) {
  const noThesisRowsByKey = new Map(
    [
      ...params.report.missedMoves,
      ...params.report.noThesisBelowMeaningfulForwardRows,
    ].map((row) => [`${row.symbol}:${row.cutoffTimestamp}`, row]),
  );

  const rows: CompositeCandidateScoreRow[] = params.tapeAudit.rows
    .map((row) => {
      const noThesisRow = noThesisRowsByKey.get(`${row.symbol}:${row.cutoffTimestamp}`);
      const score = scoreActiveRunnerCompositeCandidate({ row, noThesisRow });
      return {
        symbol: row.symbol,
        cutoffIso: row.cutoffIso,
        runnerDate: row.runnerDate ?? row.cutoffIso.slice(0, 10),
        cutoffTimestamp: row.cutoffTimestamp,
        outcome: row.outcome,
        thesisType: row.thesisType,
        bestForwardPct: row.bestForwardPct,
        classification: row.classification,
        localCatalyst: row.localCatalyst,
        catalystCard: row.catalystCard,
        liveConfirmation: row.liveConfirmation,
        candleStructure: row.candleStructure,
        selectedFiveMinuteSource: row.selectedFiveMinuteSource,
        runnerScorePct: row.runnerScorePct,
        currentPrice: row.currentPrice,
        summary: row.summary,
        meaningfulForward: isMeaningfulFiveMinuteTapeOutcome(row.outcome),
        move50: row.bestForwardPct >= 50,
        move100: row.bestForwardPct >= 100,
        ...score,
      };
    })
    .sort((left, right) => right.score - left.score || right.bestForwardPct - left.bestForwardPct);

  const highScoreRows = rows.filter((row) => row.scoreBand === "high");
  const mediumPlusRows = rows.filter((row) => row.score >= 50);
  const newHighScoreRows = highScoreRows.filter((row) => row.thesisType === null);
  const highScoreMissedRows = newHighScoreRows.filter((row) => row.outcome === "missed_meaningful_move");
  const highScoreBelowRows = newHighScoreRows.filter((row) => row.outcome === "no_thesis_below_meaningful_forward");
  const highScoreInvalidatedRows = newHighScoreRows.filter((row) => row.outcome === "invalidated");
  const disciplinedHotExtendedRows = rows.filter((row) =>
    row.classification === "hot_but_extended" &&
    (row.liveConfirmation.volumeRatio ?? 0) >= 2 &&
    (row.liveConfirmation.volumeRatio ?? Number.POSITIVE_INFINITY) < 10 &&
    (row.liveConfirmation.latestRangePct ?? 0) >= 4 &&
    (row.liveConfirmation.latestRangePct ?? 0) <= 20 &&
    (row.liveConfirmation.closeExtensionPct ?? 0) >= 10 &&
    (row.liveConfirmation.closeExtensionPct ?? 0) <= 45 &&
    (row.nearMissScore ?? 0) >= 0.85
  );
  const hasFreshContext = (row: CompositeCandidateScoreRow) =>
    row.localCatalyst === "same_day_premarket_pr" ||
    row.localCatalyst === "same_day_market_or_after_pr" ||
    row.localCatalyst === "prior_evening_pr" ||
    row.catalystCard === "same_day";

  const variants = [
    summarizeCompositeCandidateVariant(
      "all_high_score",
      "All score >=70 rows, including baseline trader-read controls.",
      highScoreRows,
    ),
    summarizeCompositeCandidateVariant(
      "new_high_score_only",
      "Score >=70 rows that did not already have a baseline trader-read thesis.",
      newHighScoreRows,
    ),
    summarizeCompositeCandidateVariant(
      "near_trigger_constructive",
      "Constructive/strict 5m participation within 6% of the trigger.",
      rows.filter((row) =>
        row.classification !== "hot_but_extended" &&
        (row.liveConfirmation.closeExtensionPct ?? Number.POSITIVE_INFINITY) <= 6
      ),
    ),
    summarizeCompositeCandidateVariant(
      "disciplined_hot_extended",
      "Hot-extended rows with 2x-10x volume, 4%-20% latest range, 10%-45% extension, and near-miss score >=85%.",
      disciplinedHotExtendedRows,
    ),
    summarizeCompositeCandidateVariant(
      "new_disciplined_hot_extended",
      "Disciplined hot-extended rows that did not already have a baseline trader-read thesis.",
      disciplinedHotExtendedRows.filter((row) => row.thesisType === null),
    ),
    summarizeCompositeCandidateVariant(
      "fresh_disciplined_hot_extended",
      "Disciplined hot-extended rows with same-day/prior-evening local/card catalyst context.",
      disciplinedHotExtendedRows.filter(hasFreshContext),
    ),
    summarizeCompositeCandidateVariant(
      "chase_risk_warning",
      "Hot-extended rows with either 25x+ volume or more than 45% extension above trigger.",
      rows.filter((row) =>
        row.classification === "hot_but_extended" &&
        ((row.liveConfirmation.volumeRatio ?? 0) >= 25 || (row.liveConfirmation.closeExtensionPct ?? 0) > 45)
      ),
    ),
    summarizeCompositeCandidateVariant(
      "medium_plus_all",
      "All score >=50 rows, included as a broad coverage/noise control.",
      mediumPlusRows,
    ),
  ];

  const newHighScorePrecision = newHighScoreRows.length === 0
    ? null
    : highScoreMissedRows.length / newHighScoreRows.length;
  const readiness =
    newHighScoreRows.length >= 20 &&
    highScoreBelowRows.length / Math.max(1, newHighScoreRows.length) <= 0.25 &&
    highScoreInvalidatedRows.length / Math.max(1, newHighScoreRows.length) <= 0.1
      ? "candidate_for_replay_rule"
      : "qa_only";

  return {
    generatedAt: new Date().toISOString(),
    description:
      "QA-only composite scorer that combines 5m tape participation, extension, volume, session position, catalyst freshness, and chart-thesis near-miss blockers.",
    totals: {
      scoredRows: rows.length,
      highScoreRows: highScoreRows.length,
      mediumPlusRows: mediumPlusRows.length,
      newHighScoreRows: newHighScoreRows.length,
      newHighScoreMissedMeaningfulRows: highScoreMissedRows.length,
      newHighScoreBelowThresholdRows: highScoreBelowRows.length,
      newHighScoreInvalidatedRows: highScoreInvalidatedRows.length,
      newHighScoreMove50Rows: newHighScoreRows.filter((row) => row.move50).length,
      newHighScoreMove100Rows: newHighScoreRows.filter((row) => row.move100).length,
      newHighScoreMeaningfulRate: newHighScorePrecision,
    },
    readiness,
    recommendation: readiness === "candidate_for_replay_rule"
      ? "Composite scoring is promising enough for a replay-rule experiment, but should still stay out of live trader-facing output until it is validated on another runner basket."
      : "Keep this composite scorer QA-only. The broader replay shows useful pockets, but score coverage/noise is not strong enough for a trader-facing thesis yet.",
    variants,
    rows,
  };
}

function renderActiveRunnerCompositeCandidateScoreMarkdown(
  analysis: ReturnType<typeof buildActiveRunnerCompositeCandidateScoreAnalysis>,
): string {
  const lines: string[] = [];
  lines.push("# Active-Runner Composite Candidate Scorer QA");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- ${analysis.description}`);
  lines.push(`- Scored rows: ${analysis.totals.scoredRows}`);
  lines.push(`- High-score rows: ${analysis.totals.highScoreRows}`);
  lines.push(`- New high-score rows without baseline thesis: ${analysis.totals.newHighScoreRows}`);
  lines.push(`- New high-score outcomes: missed meaningful ${analysis.totals.newHighScoreMissedMeaningfulRows}, below-threshold ${analysis.totals.newHighScoreBelowThresholdRows}, invalidated ${analysis.totals.newHighScoreInvalidatedRows}, >=50% ${analysis.totals.newHighScoreMove50Rows}, >=100% ${analysis.totals.newHighScoreMove100Rows}`);
  lines.push(`- Readiness: ${analysis.readiness}`);
  lines.push(`- Recommendation: ${analysis.recommendation}`);
  lines.push("");
  lines.push("## Variants");
  lines.push("");
  for (const variant of analysis.variants) {
    lines.push(
      `- ${variant.name}: ${variant.description} rows ${variant.rows}, meaningful ${variant.meaningfulRows}/${variant.rows}, hit ${variant.hitTargetRows}, partial ${variant.partialProgressRows}, missed ${variant.missedMeaningfulRows}, invalidated ${variant.invalidatedRows}, below-threshold ${variant.belowThresholdRows}, >=50% ${variant.move50Rows}, >=100% ${variant.move100Rows}, avg score ${variant.avgScore === null ? "n/a" : variant.avgScore.toFixed(1)}, median best ${variant.medianBestForwardPct === null ? "n/a" : formatPct(variant.medianBestForwardPct)}, avg best ${variant.avgBestForwardPct === null ? "n/a" : formatPct(variant.avgBestForwardPct)}`,
    );
  }
  lines.push("");
  lines.push("## Top Rows");
  lines.push("");
  for (const row of analysis.rows.slice(0, 80)) {
    lines.push(
      `- ${row.runnerDate} ${row.symbol}: score ${row.score} (${row.scoreBand}), outcome ${row.outcome}, best ${formatPct(row.bestForwardPct)}, thesis ${row.thesisType ?? "none"}, closest ${row.closestThesisType ?? "n/a"}${row.nearMissScore === null ? "" : ` (${(row.nearMissScore * 100).toFixed(0)}%)`}, local ${row.localCatalyst}, card ${row.catalystCard}`,
    );
    lines.push(
      `  - 5m: ${row.classification}, volume ${row.liveConfirmation.volumeRatio === null ? "n/a" : `${row.liveConfirmation.volumeRatio.toFixed(1)}x`}, range ${row.liveConfirmation.latestRangePct === null ? "n/a" : formatPct(row.liveConfirmation.latestRangePct)}, extension ${row.liveConfirmation.closeExtensionPct === null ? "n/a" : formatPct(row.liveConfirmation.closeExtensionPct)}, session position ${row.liveConfirmation.sessionPositionPct === null ? "n/a" : `${row.liveConfirmation.sessionPositionPct.toFixed(1)}%`}`,
    );
    if (row.scoreReasons.length > 0) {
      lines.push(`  - Score reasons: ${row.scoreReasons.slice(0, 5).join("; ")}`);
    }
    if (row.riskFlags.length > 0) {
      lines.push(`  - Risk flags: ${row.riskFlags.slice(0, 5).join("; ")}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

type MultiThesisTapeBucket =
  | "all"
  | "with_5m_participation"
  | "no_5m_participation"
  | "steady_5m_support"
  | "hot_volatile_5m_support"
  | "extended_chase_risk";

type MultiThesisComparisonRow = {
  symbol: string;
  cutoffTimestamp: number;
  cutoffIso: string;
  runnerDate: string | null;
  thesisType: string;
  thesisStatus: string;
  outcome: FiveMinuteTapeParticipationOutcome;
  bestForwardPct: number;
  roomToTargetPct: number | null;
  tapeBucket: MultiThesisTapeBucket;
  tapeClassification: ReturnType<typeof buildFiveMinuteTapeParticipationAudit>["rows"][number]["classification"] | null;
  activeRunnerTapeClassification: string | null;
  activeRunnerTapeRiskFlags: string[];
  participationStatus: ChartThesisQaSample["liveConfirmation"]["participationStatus"];
  volumeRatio: number | null;
  latestRangePct: number | null;
  closeExtensionPct: number | null;
  sessionPositionPct: number | null;
  candleStructure: FiveMinuteCandleStructureRead;
  localCatalyst: string;
  catalystCard: string;
  summary: string;
};

function emptyMultiThesisSegmentStats(key: MultiThesisTapeBucket, label: string) {
  return {
    key,
    label,
    rows: 0,
    hitTargetRows: 0,
    partialProgressRows: 0,
    invalidatedRows: 0,
    noProgressRows: 0,
    insufficientForwardRows: 0,
    move25Rows: 0,
    move50Rows: 0,
    move100Rows: 0,
    avgBestForwardPct: null as number | null,
    medianBestForwardPct: null as number | null,
    bestForwardValues: [] as number[],
    topExamples: [] as Array<{
      symbol: string;
      date: string;
      outcome: FiveMinuteTapeParticipationOutcome;
      bestForwardPct: number;
      tapeBucket: MultiThesisTapeBucket;
      summary: string;
    }>,
  };
}

function buildMultiThesisSegmentStats(
  key: MultiThesisTapeBucket,
  label: string,
  rows: MultiThesisComparisonRow[],
) {
  const stats = emptyMultiThesisSegmentStats(key, label);
  stats.rows = rows.length;
  stats.hitTargetRows = rows.filter((row) => row.outcome === "hit_target").length;
  stats.partialProgressRows = rows.filter((row) => row.outcome === "partial_progress").length;
  stats.invalidatedRows = rows.filter((row) => row.outcome === "invalidated").length;
  stats.noProgressRows = rows.filter((row) => row.outcome === "no_progress").length;
  stats.insufficientForwardRows = rows.filter((row) => row.outcome === "insufficient_forward").length;
  stats.move25Rows = rows.filter((row) => row.bestForwardPct >= 25).length;
  stats.move50Rows = rows.filter((row) => row.bestForwardPct >= 50).length;
  stats.move100Rows = rows.filter((row) => row.bestForwardPct >= 100).length;
  stats.bestForwardValues = rows.map((row) => row.bestForwardPct).filter((value) => Number.isFinite(value));
  stats.avgBestForwardPct = stats.bestForwardValues.length === 0
    ? null
    : stats.bestForwardValues.reduce((sum, value) => sum + value, 0) / stats.bestForwardValues.length;
  stats.medianBestForwardPct = median(stats.bestForwardValues);
  stats.topExamples = rows
    .slice()
    .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
    .slice(0, 5)
    .map((row) => ({
      symbol: row.symbol,
      date: row.runnerDate ?? row.cutoffIso.slice(0, 10),
      outcome: row.outcome,
      bestForwardPct: row.bestForwardPct,
      tapeBucket: row.tapeBucket,
      summary: row.summary,
    }));
  return {
    ...stats,
    bestForwardValues: undefined,
  };
}

function multiThesisTapeBucketLabel(bucket: MultiThesisTapeBucket): string {
  switch (bucket) {
    case "all":
      return "All rows";
    case "with_5m_participation":
      return "With 5m participation";
    case "no_5m_participation":
      return "No 5m participation";
    case "steady_5m_support":
      return "Steady 5m support";
    case "hot_volatile_5m_support":
      return "Hot/volatile 5m support";
    case "extended_chase_risk":
      return "Extended chase-risk 5m";
  }
}

function classifyMultiThesisTapeBucketFromLiveConfirmation(
  liveConfirmation: ChartThesisQaSample["liveConfirmation"],
): MultiThesisTapeBucket {
  if (!liveConfirmation.participationPresent) {
    return "no_5m_participation";
  }

  const volumeRatio = liveConfirmation.volumeRatio ?? 0;
  const latestRangePct = liveConfirmation.latestRangePct ?? 0;
  const extensionPct = liveConfirmation.closeExtensionPct ?? 0;
  if (
    volumeRatio >= 25 ||
    latestRangePct >= 25 ||
    extensionPct >= 45 ||
    liveConfirmation.participationStatus === "hot_extended"
  ) {
    return "extended_chase_risk";
  }
  if (volumeRatio >= 8 || latestRangePct >= 12 || extensionPct >= 18) {
    return "hot_volatile_5m_support";
  }
  return "steady_5m_support";
}

function buildActiveRunnerMultiThesisComparison(params: {
  report: ChartThesisQaReport;
  tapeAudit: ReturnType<typeof buildFiveMinuteTapeParticipationAudit>;
}) {
  const tapeRowsByKey = new Map(
    params.tapeAudit.rows.map((row) => [`${row.symbol}:${row.cutoffTimestamp}`, row]),
  );
  const rows: MultiThesisComparisonRow[] = params.report.samples
    .filter((sample) => sample.thesis !== null)
    .map((sample) => {
      const tapeRow = tapeRowsByKey.get(`${sample.symbol}:${sample.cutoffTimestamp}`);
      const activeRunnerTapeClassification = sample.thesis?.activeRunnerTape?.classification ?? null;
      const tapeBucket: MultiThesisTapeBucket = !sample.liveConfirmation.participationPresent
        ? "no_5m_participation"
        : activeRunnerTapeClassification === "steady_5m_support" ||
            activeRunnerTapeClassification === "hot_volatile_5m_support" ||
            activeRunnerTapeClassification === "extended_chase_risk"
          ? activeRunnerTapeClassification
          : classifyMultiThesisTapeBucketFromLiveConfirmation(sample.liveConfirmation);
      return {
        symbol: sample.symbol,
        cutoffTimestamp: sample.cutoffTimestamp,
        cutoffIso: sample.cutoffIso,
        runnerDate: tapeRow?.runnerDate ?? sample.cutoffIso.slice(0, 10),
        thesisType: sample.thesis!.type,
        thesisStatus: sample.thesis!.status,
        outcome: sample.outcome,
        bestForwardPct: sample.bestForwardPct,
        roomToTargetPct: sample.roomToTargetPct,
        tapeBucket,
        tapeClassification: tapeRow?.classification ?? null,
        activeRunnerTapeClassification,
        activeRunnerTapeRiskFlags: sample.thesis?.activeRunnerTape?.riskFlags ?? [],
        participationStatus: sample.liveConfirmation.participationStatus,
        volumeRatio: sample.liveConfirmation.volumeRatio,
        latestRangePct: sample.liveConfirmation.latestRangePct,
        closeExtensionPct: sample.liveConfirmation.closeExtensionPct,
        sessionPositionPct: sample.liveConfirmation.sessionPositionPct,
        candleStructure: tapeRow?.candleStructure ?? unavailableFiveMinuteCandleStructure("No 5m tape-audit row was available for this thesis sample."),
        localCatalyst: tapeRow?.localCatalyst ?? "lookup_unavailable",
        catalystCard: tapeRow?.catalystCard ?? "lookup_unavailable",
        summary: sample.summary,
      };
    });

  const thesisTypes = [...new Set(rows.map((row) => row.thesisType))].sort();
  const segmentKeys: MultiThesisTapeBucket[] = [
    "all",
    "with_5m_participation",
    "steady_5m_support",
    "hot_volatile_5m_support",
    "extended_chase_risk",
    "no_5m_participation",
  ];
  const thesisComparisons = thesisTypes
    .map((thesisType) => {
      const thesisRows = rows.filter((row) => row.thesisType === thesisType);
      const segments = segmentKeys.map((key) => {
        const segmentRows = key === "all"
          ? thesisRows
          : key === "with_5m_participation"
            ? thesisRows.filter((row) => row.tapeBucket !== "no_5m_participation")
            : thesisRows.filter((row) => row.tapeBucket === key);
        return buildMultiThesisSegmentStats(key, multiThesisTapeBucketLabel(key), segmentRows);
      });
      const all = segments.find((segment) => segment.key === "all")!;
      const steady = segments.find((segment) => segment.key === "steady_5m_support")!;
      const hotVolatile = segments.find((segment) => segment.key === "hot_volatile_5m_support")!;
      const extended = segments.find((segment) => segment.key === "extended_chase_risk")!;
      const noTape = segments.find((segment) => segment.key === "no_5m_participation")!;
      const allMove50Rate = all.move50Rows / Math.max(1, all.rows);
      return {
        thesisType,
        rows: thesisRows.length,
        segments,
        qaRead:
          steady.rows >= 3 && steady.move50Rows / Math.max(1, steady.rows) > allMove50Rate
            ? "Steady 5m support improved the high-move bucket in this replay."
            : hotVolatile.rows >= 3 && hotVolatile.hitTargetRows + hotVolatile.partialProgressRows >= hotVolatile.invalidatedRows + hotVolatile.noProgressRows
              ? "Hot/volatile 5m tape still supported continuation; use supportive wording with volatility risk."
              : extended.rows >= 3 && extended.hitTargetRows + extended.partialProgressRows >= extended.invalidatedRows + extended.noProgressRows
                ? "Extended tape still produced continuation; keep it as momentum-with-risk context, not a rejection."
                : extended.rows >= 3
                  ? "Extended tape was noisy for this thesis; keep warning language prominent."
                  : noTape.rows > 0 && noTape.rows >= all.rows * 0.5
                    ? "This thesis often fired without 5m participation; avoid over-weighting the tape modifier."
                    : "Needs more replay evidence before changing trader-facing weighting.",
      };
    })
    .sort((left, right) => {
      const leftAll = left.segments.find((segment) => segment.key === "all")!;
      const rightAll = right.segments.find((segment) => segment.key === "all")!;
      return right.rows - left.rows ||
        rightAll.move50Rows - leftAll.move50Rows ||
        (rightAll.avgBestForwardPct ?? 0) - (leftAll.avgBestForwardPct ?? 0);
    });

  const noThesisRows = [
    ...params.report.missedMoves.map((row) => ({
      ...row,
      outcome: "missed_meaningful_move" as FiveMinuteTapeParticipationOutcome,
    })),
    ...params.report.noThesisBelowMeaningfulForwardRows.map((row) => ({
      ...row,
      outcome: "no_thesis_below_meaningful_forward" as FiveMinuteTapeParticipationOutcome,
    })),
  ];
  const noThesisTapeRows = noThesisRows.filter((row) => row.liveConfirmation.participationPresent);

  return {
    generatedAt: new Date().toISOString(),
    description:
      "QA-only multi-thesis comparison. It keeps thesis selection unchanged and measures whether 5m tape confirmation/warning buckets improve or weaken each existing thesis type.",
    totals: {
      thesisRows: rows.length,
      thesisTypes: thesisComparisons.length,
      withFiveMinuteParticipation: rows.filter((row) => row.tapeBucket !== "no_5m_participation").length,
      steadyFiveMinuteSupportRows: rows.filter((row) => row.tapeBucket === "steady_5m_support").length,
      hotVolatileFiveMinuteSupportRows: rows.filter((row) => row.tapeBucket === "hot_volatile_5m_support").length,
      extendedChaseRiskRows: rows.filter((row) => row.tapeBucket === "extended_chase_risk").length,
      noFiveMinuteParticipationRows: rows.filter((row) => row.tapeBucket === "no_5m_participation").length,
      noThesisMissedMeaningfulRows: params.report.missedMoves.length,
      noThesisBelowThresholdRows: params.report.noThesisBelowMeaningfulForwardRows.length,
      noThesisRowsWithFiveMinuteParticipation: noThesisTapeRows.length,
    },
    overallSegments: segmentKeys.map((key) => {
      const segmentRows = key === "all"
        ? rows
        : key === "with_5m_participation"
          ? rows.filter((row) => row.tapeBucket !== "no_5m_participation")
          : rows.filter((row) => row.tapeBucket === key);
      return buildMultiThesisSegmentStats(key, multiThesisTapeBucketLabel(key), segmentRows);
    }),
    thesisComparisons,
    rows: rows.sort((left, right) => right.bestForwardPct - left.bestForwardPct),
  };
}

function renderActiveRunnerMultiThesisComparisonMarkdown(
  analysis: ReturnType<typeof buildActiveRunnerMultiThesisComparison>,
): string {
  const lines: string[] = [];
  const segmentSummary = (segment: ReturnType<typeof buildMultiThesisSegmentStats>) =>
    `${segment.rows} rows; hit ${segment.hitTargetRows}, partial ${segment.partialProgressRows}, invalidated ${segment.invalidatedRows}, >=50% ${segment.move50Rows}, >=100% ${segment.move100Rows}, median ${segment.medianBestForwardPct === null ? "n/a" : formatPct(segment.medianBestForwardPct)}`;
  lines.push("# Active-Runner Multi-Thesis Comparison QA");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- Thesis rows: ${analysis.totals.thesisRows}`);
  lines.push(`- Thesis types: ${analysis.totals.thesisTypes}`);
  lines.push(`- With 5m participation: ${analysis.totals.withFiveMinuteParticipation}`);
  lines.push(`- Steady 5m support rows: ${analysis.totals.steadyFiveMinuteSupportRows}`);
  lines.push(`- Hot/volatile 5m support rows: ${analysis.totals.hotVolatileFiveMinuteSupportRows}`);
  lines.push(`- Extended chase-risk rows: ${analysis.totals.extendedChaseRiskRows}`);
  lines.push(`- No 5m participation rows: ${analysis.totals.noFiveMinuteParticipationRows}`);
  lines.push(`- No-thesis missed/below-threshold rows with 5m participation: ${analysis.totals.noThesisRowsWithFiveMinuteParticipation}/${analysis.totals.noThesisMissedMeaningfulRows + analysis.totals.noThesisBelowThresholdRows}`);
  lines.push("- Recommendation: use this table to compare thesis types together. 5m tape should describe participation quality/risk, not decide whether a thesis is valid by itself.");
  lines.push("");
  lines.push("## Overall 5m Tape Buckets");
  lines.push("");
  for (const segment of analysis.overallSegments) {
    lines.push(`- ${segment.label}: ${segmentSummary(segment)}`);
  }
  lines.push("");
  lines.push("## Thesis Comparison Table");
  lines.push("");
  lines.push("| Thesis | Rows | All | Steady 5m | Hot/Volatile 5m | Extended Chase-Risk | No 5m | QA Read |");
  lines.push("| --- | ---: | --- | --- | --- | --- | --- | --- |");
  for (const thesis of analysis.thesisComparisons) {
    const all = thesis.segments.find((segment) => segment.key === "all")!;
    const steady = thesis.segments.find((segment) => segment.key === "steady_5m_support")!;
    const hotVolatile = thesis.segments.find((segment) => segment.key === "hot_volatile_5m_support")!;
    const extended = thesis.segments.find((segment) => segment.key === "extended_chase_risk")!;
    const noTape = thesis.segments.find((segment) => segment.key === "no_5m_participation")!;
    const compact = (segment: typeof all) =>
      `${segment.rows}; H/P/I ${segment.hitTargetRows}/${segment.partialProgressRows}/${segment.invalidatedRows}; >=50 ${segment.move50Rows}; med ${segment.medianBestForwardPct === null ? "n/a" : formatPct(segment.medianBestForwardPct)}`;
    lines.push(`| ${thesis.thesisType} | ${thesis.rows} | ${compact(all)} | ${compact(steady)} | ${compact(hotVolatile)} | ${compact(extended)} | ${compact(noTape)} | ${thesis.qaRead} |`);
  }
  lines.push("");
  lines.push("## Top Rows By Forward Move");
  lines.push("");
  for (const row of analysis.rows.slice(0, 60)) {
    lines.push(
      `- ${row.runnerDate ?? row.cutoffIso.slice(0, 10)} ${row.symbol}: thesis ${row.thesisType}, tape ${row.tapeBucket}, outcome ${row.outcome}, best ${formatPct(row.bestForwardPct)}, volume ${row.volumeRatio === null ? "n/a" : `${row.volumeRatio.toFixed(1)}x`}, extension ${row.closeExtensionPct === null ? "n/a" : formatPct(row.closeExtensionPct)}`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

type ExtendedChaseControlRead =
  | "extended_but_controlled"
  | "extended_still_holding_but_volatile"
  | "wick_heavy_rejection_risk"
  | "one_candle_blowoff_risk"
  | "wide_candle_exhaustion_risk"
  | "far_above_trigger_risk"
  | "extreme_volume_risk"
  | "lost_near_term_hold_risk"
  | "losing_upper_half_risk";

type ExtendedChaseControlRow = MultiThesisComparisonRow & {
  controlRead: ExtendedChaseControlRead;
  controlReasons: string[];
  riskReasons: string[];
};

function classifyExtendedChaseControl(row: MultiThesisComparisonRow): Pick<ExtendedChaseControlRow, "controlRead" | "controlReasons" | "riskReasons"> {
  const volumeRatio = row.volumeRatio ?? 0;
  const latestRangePct = row.latestRangePct ?? 0;
  const closeExtensionPct = row.closeExtensionPct ?? 0;
  const sessionPositionPct = row.sessionPositionPct ?? 0;
  const riskReasons = [...row.activeRunnerTapeRiskFlags];
  const controlReasons: string[] = [];
  const losingUpperHalf = row.activeRunnerTapeRiskFlags.some((flag) =>
    flag.includes("not holding its upper half")
  );
  const structure = row.candleStructure;

  if (structure.status === "available") {
    if (structure.latestCloseLocationPct !== null && structure.latestCloseLocationPct >= 70) {
      controlReasons.push("latest 5m candle closed in its upper range");
    }
    if (structure.recentHigherLows !== null && structure.recentHigherLows >= 3) {
      controlReasons.push("recent 5m sequence is holding higher lows");
    }
    if (structure.pullbackHeldTrigger === true) {
      controlReasons.push("recent pullback held the near-term hold area");
    }
    if (structure.closeClearedRecentHigh === true) {
      controlReasons.push("latest 5m close cleared the recent high");
    }
    if (structure.wickHeavy) {
      riskReasons.push("latest 5m candle left a heavy upper wick");
    }
    if (structure.oneCandleBlowoffRisk) {
      riskReasons.push("latest 5m candle looks like a one-candle volume blowoff");
    }
    if (structure.closeAboveTrigger === false) {
      riskReasons.push("latest 5m close lost the near-term hold");
    }
    if (structure.reclaimedTriggerWithinNextSixCandles === true) {
      controlReasons.push("lost hold reclaimed within the next six 5m candles");
    } else if (structure.reclaimedTriggerWithinNextSixCandles === false) {
      riskReasons.push("lost hold did not reclaim within the next six 5m candles");
    }
  }

  if (sessionPositionPct >= 75) {
    controlReasons.push("price is still in the upper part of the session range");
  } else if (sessionPositionPct > 0) {
    riskReasons.push("session position is not proving upper-range control");
  }

  if (closeExtensionPct >= 80) {
    riskReasons.push("price is 80%+ above the thesis trigger");
  } else if (closeExtensionPct <= 45) {
    controlReasons.push("extension is still inside the tested continuation band");
  }

  if (latestRangePct <= 18) {
    controlReasons.push("latest 5m candle is active but not extremely wide");
  } else if (latestRangePct >= 25) {
    riskReasons.push("latest 5m candle is very wide");
  }

  if (volumeRatio >= 8 && volumeRatio < 25) {
    controlReasons.push("volume is elevated without being the extreme 25x+ bucket");
  } else if (volumeRatio >= 25) {
    riskReasons.push("volume is 25x+ recent average");
  }

  if (losingUpperHalf) {
    return {
      controlRead: "losing_upper_half_risk",
      controlReasons,
      riskReasons: [...new Set(riskReasons)],
    };
  }
  if (structure.structureRead === "lost_near_term_hold") {
    return {
      controlRead: "lost_near_term_hold_risk",
      controlReasons,
      riskReasons: [...new Set(riskReasons)],
    };
  }
  if (structure.structureRead === "one_candle_blowoff_risk") {
    return {
      controlRead: "one_candle_blowoff_risk",
      controlReasons,
      riskReasons: [...new Set(riskReasons)],
    };
  }
  if (structure.structureRead === "wick_heavy_rejection_risk") {
    return {
      controlRead: "wick_heavy_rejection_risk",
      controlReasons,
      riskReasons: [...new Set(riskReasons)],
    };
  }
  if (latestRangePct >= 25) {
    return {
      controlRead: "wide_candle_exhaustion_risk",
      controlReasons,
      riskReasons: [...new Set(riskReasons)],
    };
  }
  if (closeExtensionPct >= 80) {
    return {
      controlRead: "far_above_trigger_risk",
      controlReasons,
      riskReasons: [...new Set(riskReasons)],
    };
  }
  if (volumeRatio >= 25) {
    return {
      controlRead: "extreme_volume_risk",
      controlReasons,
      riskReasons: [...new Set(riskReasons)],
    };
  }
  if (
    closeExtensionPct <= 45 &&
    latestRangePct <= 18 &&
    sessionPositionPct >= 75 &&
    (structure.structureRead === "buyers_in_control" || structure.structureRead === "controlled_pullback_holding")
  ) {
    return {
      controlRead: "extended_but_controlled",
      controlReasons,
      riskReasons: [...new Set(riskReasons)],
    };
  }
  return {
    controlRead: "extended_still_holding_but_volatile",
    controlReasons,
    riskReasons: [...new Set(riskReasons)],
  };
}

function extendedChaseControlLabel(read: ExtendedChaseControlRead): string {
  switch (read) {
    case "extended_but_controlled":
      return "Extended but controlled";
    case "extended_still_holding_but_volatile":
      return "Still holding, but volatile";
    case "wick_heavy_rejection_risk":
      return "Wick-heavy rejection risk";
    case "one_candle_blowoff_risk":
      return "One-candle blowoff risk";
    case "wide_candle_exhaustion_risk":
      return "Wide-candle exhaustion risk";
    case "far_above_trigger_risk":
      return "Far above trigger risk";
    case "extreme_volume_risk":
      return "Extreme-volume risk";
    case "lost_near_term_hold_risk":
      return "Lost near-term hold risk";
    case "losing_upper_half_risk":
      return "Losing upper-half risk";
  }
}

function summarizeExtendedChaseControlRows(key: string, label: string, rows: ExtendedChaseControlRow[]) {
  const bestForwardValues = rows.map((row) => row.bestForwardPct).filter((value) => Number.isFinite(value));
  const avg = (values: number[]) =>
    values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const numericValues = (pick: (row: ExtendedChaseControlRow) => number | null) =>
    rows.map(pick).filter((value): value is number => value !== null && Number.isFinite(value));
  return {
    key,
    label,
    rows: rows.length,
    hitTargetRows: rows.filter((row) => row.outcome === "hit_target").length,
    partialProgressRows: rows.filter((row) => row.outcome === "partial_progress").length,
    invalidatedRows: rows.filter((row) => row.outcome === "invalidated").length,
    noProgressRows: rows.filter((row) => row.outcome === "no_progress").length,
    move50Rows: rows.filter((row) => row.bestForwardPct >= 50).length,
    move100Rows: rows.filter((row) => row.bestForwardPct >= 100).length,
    avgBestForwardPct: avg(bestForwardValues),
    medianBestForwardPct: median(bestForwardValues),
    avgVolumeRatio: avg(numericValues((row) => row.volumeRatio)),
    avgLatestRangePct: avg(numericValues((row) => row.latestRangePct)),
    avgCloseExtensionPct: avg(numericValues((row) => row.closeExtensionPct)),
    avgSessionPositionPct: avg(numericValues((row) => row.sessionPositionPct)),
    avgLatestCloseLocationPct: avg(numericValues((row) => row.candleStructure.latestCloseLocationPct)),
    avgLatestBodyPct: avg(numericValues((row) => row.candleStructure.latestBodyPct)),
    avgLatestUpperWickPct: avg(numericValues((row) => row.candleStructure.latestUpperWickPct)),
    avgLatestVolumeVsPriorFive: avg(numericValues((row) => row.candleStructure.latestVolumeVsPriorFive)),
    topWinners: rows
      .slice()
      .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
      .slice(0, 8)
      .map((row) => ({
        symbol: row.symbol,
        date: row.runnerDate ?? row.cutoffIso.slice(0, 10),
        thesisType: row.thesisType,
        outcome: row.outcome,
        bestForwardPct: row.bestForwardPct,
        volumeRatio: row.volumeRatio,
        latestRangePct: row.latestRangePct,
        closeExtensionPct: row.closeExtensionPct,
        sessionPositionPct: row.sessionPositionPct,
        structureRead: row.candleStructure.structureRead,
        candleStructureSummary: row.candleStructure.summary,
        reasons: row.controlReasons,
        risks: row.riskReasons,
      })),
    invalidatedExamples: rows
      .filter((row) => row.outcome === "invalidated")
      .slice()
      .sort((left, right) => (right.closeExtensionPct ?? 0) - (left.closeExtensionPct ?? 0))
      .slice(0, 8)
      .map((row) => ({
        symbol: row.symbol,
        date: row.runnerDate ?? row.cutoffIso.slice(0, 10),
        thesisType: row.thesisType,
        bestForwardPct: row.bestForwardPct,
        volumeRatio: row.volumeRatio,
        latestRangePct: row.latestRangePct,
        closeExtensionPct: row.closeExtensionPct,
        sessionPositionPct: row.sessionPositionPct,
        structureRead: row.candleStructure.structureRead,
        candleStructureSummary: row.candleStructure.summary,
        reasons: row.controlReasons,
        risks: row.riskReasons,
      })),
  };
}

function buildExtendedChaseSegmentGroup(
  label: string,
  rows: ExtendedChaseControlRow[],
  bucketForRow: (row: ExtendedChaseControlRow) => string,
) {
  const buckets = new Map<string, ExtendedChaseControlRow[]>();
  for (const row of rows) {
    const key = bucketForRow(row);
    const bucketRows = buckets.get(key) ?? [];
    bucketRows.push(row);
    buckets.set(key, bucketRows);
  }
  return {
    label,
    segments: [...buckets.entries()]
      .map(([key, bucketRows]) => summarizeExtendedChaseControlRows(key, key, bucketRows))
      .sort((left, right) =>
        right.rows - left.rows ||
        right.move50Rows - left.move50Rows ||
        (right.medianBestForwardPct ?? 0) - (left.medianBestForwardPct ?? 0) ||
        left.key.localeCompare(right.key),
      ),
  };
}

function buildActiveRunnerExtendedChaseRiskControlAnalysis(params: {
  multiThesisComparison: ReturnType<typeof buildActiveRunnerMultiThesisComparison>;
}) {
  const rows: ExtendedChaseControlRow[] = params.multiThesisComparison.rows
    .filter((row) => row.tapeBucket === "extended_chase_risk")
    .map((row) => ({
      ...row,
      ...classifyExtendedChaseControl(row),
    }));
  const controlReads: ExtendedChaseControlRead[] = [
    "extended_but_controlled",
    "extended_still_holding_but_volatile",
    "wick_heavy_rejection_risk",
    "one_candle_blowoff_risk",
    "wide_candle_exhaustion_risk",
    "far_above_trigger_risk",
    "extreme_volume_risk",
    "lost_near_term_hold_risk",
    "losing_upper_half_risk",
  ];
  const byControlRead = controlReads.map((read) =>
    summarizeExtendedChaseControlRows(read, extendedChaseControlLabel(read), rows.filter((row) => row.controlRead === read))
  );
  const winnerRows = rows.filter((row) => row.outcome === "hit_target" || row.outcome === "partial_progress");
  const invalidatedRows = rows.filter((row) => row.outcome === "invalidated");
  const controlledRows = rows.filter((row) =>
    row.controlRead === "extended_but_controlled" ||
    row.controlRead === "extended_still_holding_but_volatile"
  );
  const riskRows = rows.filter((row) =>
    row.controlRead !== "extended_but_controlled" &&
    row.controlRead !== "extended_still_holding_but_volatile"
  );
  const lostNearTermHoldRows = rows.filter((row) => row.candleStructure.structureRead === "lost_near_term_hold");
  const lostHoldReclaimedRows = lostNearTermHoldRows.filter((row) =>
    row.candleStructure.reclaimedTriggerWithinNextSixCandles === true
  );
  const lostHoldNoReclaimRows = lostNearTermHoldRows.filter((row) =>
    row.candleStructure.reclaimedTriggerWithinNextSixCandles === false
  );
  const lostHoldBuyerSequenceRows = lostNearTermHoldRows.filter((row) =>
    (row.candleStructure.recentHigherLows ?? 0) >= 3 ||
    (row.candleStructure.latestCloseLocationPct ?? 0) >= 70 ||
    row.candleStructure.closeClearedRecentHigh === true
  );
  const lostHoldWeakCloseRows = lostNearTermHoldRows.filter((row) =>
    (row.candleStructure.latestCloseLocationPct ?? 100) < 45 ||
    (row.candleStructure.latestUpperWickPct ?? 0) >= 45
  );
  const lostHoldFarExtendedRows = lostNearTermHoldRows.filter((row) =>
    (row.closeExtensionPct ?? 0) >= 80 ||
    (row.sessionPositionPct ?? 0) >= 250
  );
  const lostHoldNearOrModestExtensionRows = lostNearTermHoldRows.filter((row) =>
    (row.closeExtensionPct ?? Number.POSITIVE_INFINITY) <= 45
  );
  const controlledMove50Rate = controlledRows.length === 0
    ? null
    : controlledRows.filter((row) => row.bestForwardPct >= 50).length / controlledRows.length;
  const riskInvalidationRate = riskRows.length === 0
    ? null
    : riskRows.filter((row) => row.outcome === "invalidated").length / riskRows.length;

  return {
    generatedAt: new Date().toISOString(),
    description:
      "QA-only breakdown of extended chase-risk rows. This tests whether stretched active runners should be split into controlled continuation vs pullback/rug-risk language.",
    totals: {
      rows: rows.length,
      hitTargetRows: rows.filter((row) => row.outcome === "hit_target").length,
      partialProgressRows: rows.filter((row) => row.outcome === "partial_progress").length,
      invalidatedRows: invalidatedRows.length,
      move50Rows: rows.filter((row) => row.bestForwardPct >= 50).length,
      move100Rows: rows.filter((row) => row.bestForwardPct >= 100).length,
      controlledRows: controlledRows.length,
      controlledMove50Rate,
      riskRows: riskRows.length,
      riskInvalidationRate,
    },
    recommendation:
      controlledRows.length >= 10 && controlledMove50Rate !== null && controlledMove50Rate >= 0.45
        ? "Controlled extended rows are strong enough to test trader-facing wording like extended but still controlled, while keeping hard warning language for wide/losing-control rows."
        : rows.length >= 20
          ? "Keep this split QA-only for now. The extended bucket is useful, but this run does not yet prove a clean controlled-vs-risk trader-facing split."
          : "Sample is too small for a wording change; use this as diagnostic evidence only.",
    byControlRead,
    byCandleStructure: [...new Set(rows.map((row) => row.candleStructure.structureRead))]
      .sort()
      .map((structureRead) =>
        summarizeExtendedChaseControlRows(structureRead, structureRead, rows.filter((row) => row.candleStructure.structureRead === structureRead))
      )
      .sort((left, right) => right.rows - left.rows),
    crossSegments: [
      buildExtendedChaseSegmentGroup(
        "Candle Structure x Thesis",
        rows,
        (row) => `${row.candleStructure.structureRead}__${row.thesisType}`,
      ),
      buildExtendedChaseSegmentGroup(
        "Candle Structure x Extension",
        rows,
        (row) => `${row.candleStructure.structureRead}__${fiveMinuteExtensionBucket(row.closeExtensionPct)}`,
      ),
      buildExtendedChaseSegmentGroup(
        "Candle Structure x Catalyst Context",
        rows,
        (row) => `${row.candleStructure.structureRead}__${fiveMinuteCatalystContextBucket(row)}`,
      ),
      buildExtendedChaseSegmentGroup(
        "Lost Hold Reclaim State",
        rows,
        (row) => {
          if (row.candleStructure.structureRead !== "lost_near_term_hold") {
            return "did_not_lose_near_term_hold";
          }
          if (row.candleStructure.reclaimedTriggerWithinNextSixCandles === true) {
            return "lost_hold_reclaimed_next_six_5m";
          }
          if (row.candleStructure.reclaimedTriggerWithinNextSixCandles === false) {
            return "lost_hold_no_reclaim_next_six_5m";
          }
          return "lost_hold_reclaim_unknown";
        },
      ),
    ],
    lostNearTermHoldDiagnostics: {
      summary:
        "Rows where the latest 5m close lost the near-term hold. This bucket is not automatically bearish in small caps, so it is split into reclaim, buyer-sequence, and weak-close diagnostics.",
      segments: [
        summarizeExtendedChaseControlRows("all_lost_near_term_hold", "All lost near-term hold", lostNearTermHoldRows),
        summarizeExtendedChaseControlRows("reclaimed_within_next_six_5m", "Lost hold, then reclaimed within next six 5m candles", lostHoldReclaimedRows),
        summarizeExtendedChaseControlRows("no_reclaim_within_next_six_5m", "Lost hold, no reclaim within next six 5m candles", lostHoldNoReclaimRows),
        summarizeExtendedChaseControlRows("buyer_sequence", "Lost hold but still had buyer-sequence traits", lostHoldBuyerSequenceRows),
        summarizeExtendedChaseControlRows("weak_close_or_upper_wick", "Lost hold with weak close or heavy upper wick", lostHoldWeakCloseRows),
        summarizeExtendedChaseControlRows("far_extended_or_session_stretched", "Lost hold and far/session-stretched", lostHoldFarExtendedRows),
        summarizeExtendedChaseControlRows("near_or_modest_extension", "Lost hold but near/modestly above hold", lostHoldNearOrModestExtensionRows),
      ],
    },
    winnerVsInvalidated: [
      summarizeExtendedChaseControlRows("winners", "Hit target or partial progress", winnerRows),
      summarizeExtendedChaseControlRows("invalidated", "Invalidated", invalidatedRows),
    ],
    thesisBreakdown: [...new Set(rows.map((row) => row.thesisType))]
      .sort()
      .map((thesisType) =>
        summarizeExtendedChaseControlRows(thesisType, thesisType, rows.filter((row) => row.thesisType === thesisType))
      )
      .sort((left, right) => right.rows - left.rows),
    rows: rows
      .slice()
      .sort((left, right) => {
        const outcomeScore = (row: ExtendedChaseControlRow) =>
          row.outcome === "invalidated" ? 2 : row.bestForwardPct >= 50 ? 1 : 0;
        return outcomeScore(right) - outcomeScore(left) || right.bestForwardPct - left.bestForwardPct;
      }),
  };
}

function renderActiveRunnerExtendedChaseRiskControlMarkdown(
  analysis: ReturnType<typeof buildActiveRunnerExtendedChaseRiskControlAnalysis>,
): string {
  const lines: string[] = [];
  const metricSummary = (segment: ReturnType<typeof summarizeExtendedChaseControlRows>) =>
    `${segment.rows} rows; hit ${segment.hitTargetRows}, partial ${segment.partialProgressRows}, invalidated ${segment.invalidatedRows}, >=50% ${segment.move50Rows}, >=100% ${segment.move100Rows}, median ${segment.medianBestForwardPct === null ? "n/a" : formatPct(segment.medianBestForwardPct)}, avg volume ${segment.avgVolumeRatio === null ? "n/a" : `${segment.avgVolumeRatio.toFixed(1)}x`}, avg range ${segment.avgLatestRangePct === null ? "n/a" : formatPct(segment.avgLatestRangePct)}, avg extension ${segment.avgCloseExtensionPct === null ? "n/a" : formatPct(segment.avgCloseExtensionPct)}, avg close location ${segment.avgLatestCloseLocationPct === null ? "n/a" : formatPct(segment.avgLatestCloseLocationPct)}, avg upper wick ${segment.avgLatestUpperWickPct === null ? "n/a" : formatPct(segment.avgLatestUpperWickPct)}`;
  lines.push("# Active-Runner Extended Chase-Risk Control QA");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- ${analysis.description}`);
  lines.push(`- Extended rows: ${analysis.totals.rows}`);
  lines.push(`- Hit/partial/invalidated: ${analysis.totals.hitTargetRows}/${analysis.totals.partialProgressRows}/${analysis.totals.invalidatedRows}`);
  lines.push(`- >=50% rows: ${analysis.totals.move50Rows}`);
  lines.push(`- >=100% rows: ${analysis.totals.move100Rows}`);
  lines.push(`- Controlled rows: ${analysis.totals.controlledRows}${analysis.totals.controlledMove50Rate === null ? "" : ` (${(analysis.totals.controlledMove50Rate * 100).toFixed(1)}% reached >=50%)`}`);
  lines.push(`- Risk rows: ${analysis.totals.riskRows}${analysis.totals.riskInvalidationRate === null ? "" : ` (${(analysis.totals.riskInvalidationRate * 100).toFixed(1)}% invalidated)`}`);
  lines.push(`- Recommendation: ${analysis.recommendation}`);
  lines.push("");
  lines.push("## Control Buckets");
  lines.push("");
  for (const segment of analysis.byControlRead) {
    lines.push(`- ${segment.label}: ${metricSummary(segment)}`);
  }
  lines.push("");
  lines.push("## Candle Structure Buckets");
  lines.push("");
  for (const segment of analysis.byCandleStructure) {
    lines.push(`- ${segment.label}: ${metricSummary(segment)}`);
  }
  lines.push("");
  lines.push("## Lost Near-Term Hold Diagnostics");
  lines.push("");
  lines.push(`- ${analysis.lostNearTermHoldDiagnostics.summary}`);
  for (const segment of analysis.lostNearTermHoldDiagnostics.segments) {
    lines.push(`- ${segment.label}: ${metricSummary(segment)}`);
  }
  lines.push("");
  lines.push("## Cross Segments");
  lines.push("");
  for (const group of analysis.crossSegments) {
    lines.push(`### ${group.label}`);
    lines.push("");
    for (const segment of group.segments.slice(0, 12)) {
      lines.push(`- ${segment.label}: ${metricSummary(segment)}`);
    }
    lines.push("");
  }
  lines.push("## Winners Vs Invalidated");
  lines.push("");
  for (const segment of analysis.winnerVsInvalidated) {
    lines.push(`- ${segment.label}: ${metricSummary(segment)}`);
  }
  lines.push("");
  lines.push("## Thesis Breakdown");
  lines.push("");
  for (const segment of analysis.thesisBreakdown) {
    lines.push(`- ${segment.label}: ${metricSummary(segment)}`);
  }
  lines.push("");
  lines.push("## Rows");
  lines.push("");
  for (const row of analysis.rows.slice(0, 80)) {
    lines.push(
      `- ${row.runnerDate ?? row.cutoffIso.slice(0, 10)} ${row.symbol}: ${extendedChaseControlLabel(row.controlRead)}, structure ${row.candleStructure.structureRead}, thesis ${row.thesisType}, outcome ${row.outcome}, best ${formatPct(row.bestForwardPct)}, volume ${row.volumeRatio === null ? "n/a" : `${row.volumeRatio.toFixed(1)}x`}, range ${row.latestRangePct === null ? "n/a" : formatPct(row.latestRangePct)}, extension ${row.closeExtensionPct === null ? "n/a" : formatPct(row.closeExtensionPct)}, session position ${row.sessionPositionPct === null ? "n/a" : `${row.sessionPositionPct.toFixed(1)}%`}`,
    );
    lines.push(`  - Structure: ${row.candleStructure.summary}`);
    if (row.controlReasons.length > 0) {
      lines.push(`  - Control: ${row.controlReasons.slice(0, 4).join("; ")}`);
    }
    if (row.riskReasons.length > 0) {
      lines.push(`  - Risk: ${row.riskReasons.slice(0, 4).join("; ")}`);
    }
    lines.push(`  - ${row.summary}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildActiveRunnerRemainingMissRejectionAudit(params: {
  activeRunners: SelectedRunner[];
  report: ChartThesisQaReport;
}) {
  const activeRunnerByKey = new Map(
    params.activeRunners.map((runner) => [`${runner.symbol}:${runner.activeCutoffTimestamp}`, runner]),
  );
  const rows = params.report.missedMoves
    .map((missed) => {
      const runner = activeRunnerByKey.get(`${missed.symbol}:${missed.cutoffTimestamp}`);
      const closest = missed.rejectionAudit.thesisRejections[0] ?? null;
      return {
        symbol: missed.symbol,
        runnerDate: runner?.runnerDate ?? missed.cutoffIso.slice(0, 10),
        activeCutoffIso: missed.cutoffIso,
        runnerScorePct: runner?.runnerScorePct ?? null,
        catalystCard: runner?.catalystCard?.label ?? "lookup_unavailable",
        catalystTitle: runner?.catalystCard?.primaryArticle?.title ?? null,
        bestForwardPct: missed.bestForwardPct,
        reason: missed.reason,
        closestThesisType: missed.rejectionAudit.closestThesisType,
        nearMissScore: closest?.nearMissScore ?? 0,
        primaryBlockers: missed.rejectionAudit.primaryBlockers,
        priorRangePct: missed.priorRangePct,
        priorRangePositionPct: missed.priorRangePositionPct,
        shelfExtensionPct: computeShelfExtensionPct(missed),
        firstForwardGapPct: missed.firstForwardGapPct,
        firstForwardRangePct: missed.firstForwardRangePct,
        thesisRejections: missed.rejectionAudit.thesisRejections,
        summary: missed.summary,
      };
    })
    .sort((left, right) => right.bestForwardPct - left.bestForwardPct);

  const closestThesisCounts = rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.closestThesisType] = (counts[row.closestThesisType] ?? 0) + 1;
    return counts;
  }, {});
  const reasonCounts = rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.reason] = (counts[row.reason] ?? 0) + 1;
    return counts;
  }, {});
  const blockerCounts = rows.reduce<Record<string, number>>((counts, row) => {
    for (const blocker of row.primaryBlockers) {
      counts[blocker] = (counts[blocker] ?? 0) + 1;
    }
    return counts;
  }, {});
  const blockerLeaderboard = Object.entries(blockerCounts)
    .map(([blocker, count]) => ({ blocker, count }))
    .sort((left, right) => right.count - left.count || left.blocker.localeCompare(right.blocker));

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      remainingMisses: rows.length,
      missAt50Pct: rows.filter((row) => row.bestForwardPct >= 50).length,
      missAt100Pct: rows.filter((row) => row.bestForwardPct >= 100).length,
    },
    reasonCounts,
    closestThesisCounts,
    blockerLeaderboard,
    rows,
  };
}

function renderActiveRunnerRemainingMissRejectionAuditMarkdown(
  audit: ReturnType<typeof buildActiveRunnerRemainingMissRejectionAudit>,
): string {
  const lines: string[] = [];
  lines.push("# Active-Runner Remaining Miss Rejection Audit");
  lines.push("");
  lines.push(`- Generated: ${audit.generatedAt}`);
  lines.push(`- Remaining missed meaningful moves: ${audit.totals.remainingMisses}`);
  lines.push(`- Remaining misses >=50%: ${audit.totals.missAt50Pct}`);
  lines.push(`- Remaining misses >=100%: ${audit.totals.missAt100Pct}`);
  lines.push("");
  lines.push("## Miss Reason Counts");
  lines.push("");
  for (const [reason, count] of Object.entries(audit.reasonCounts).sort((left, right) => right[1] - left[1])) {
    lines.push(`- ${reason}: ${count}`);
  }
  lines.push("");
  lines.push("## Closest Thesis Family");
  lines.push("");
  for (const [thesisType, count] of Object.entries(audit.closestThesisCounts).sort((left, right) => right[1] - left[1])) {
    lines.push(`- ${thesisType}: ${count}`);
  }
  lines.push("");
  lines.push("## Top Blockers");
  lines.push("");
  for (const item of audit.blockerLeaderboard.slice(0, 16)) {
    lines.push(`- ${item.blocker}: ${item.count}`);
  }
  lines.push("");
  lines.push("## Highest-Impact Remaining Misses");
  lines.push("");
  for (const row of audit.rows.slice(0, 60)) {
    const catalyst = row.catalystTitle ? `, catalyst ${row.catalystCard} (${row.catalystTitle})` : `, catalyst ${row.catalystCard}`;
    lines.push(
      `- ${row.runnerDate} ${row.symbol}: best forward ${formatPct(row.bestForwardPct)}, runner score ${row.runnerScorePct === null ? "n/a" : formatPct(row.runnerScorePct)}, reason ${row.reason}, closest ${row.closestThesisType} (${(row.nearMissScore * 100).toFixed(0)}%)${catalyst}`,
    );
    lines.push(`  - Diagnostics: prior range ${row.priorRangePct === null ? "n/a" : formatPct(row.priorRangePct)}, position ${row.priorRangePositionPct === null ? "n/a" : `${row.priorRangePositionPct.toFixed(1)}%`}, shelf extension ${row.shelfExtensionPct === null ? "n/a" : formatPct(row.shelfExtensionPct)}, next gap ${row.firstForwardGapPct === null ? "n/a" : formatPct(row.firstForwardGapPct)}, next range ${row.firstForwardRangePct === null ? "n/a" : formatPct(row.firstForwardRangePct)}`);
    for (const blocker of row.primaryBlockers.slice(0, 4)) {
      lines.push(`  - Blocker: ${blocker}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

type ActiveRunnerNewsBurstCandidateVariant = {
  name: string;
  description: string;
  productionReadiness: "reject_noisy" | "scanner_context_only" | "candidate_for_engine_test";
  matches: (row: ActiveRunnerNewsBurstCandidateRow) => boolean;
};

type ActiveRunnerNewsBurstCandidateRow = {
  symbol: string;
  runnerDate: string;
  activeCutoffTimestamp: number;
  activeCutoffIso: string;
  runnerScorePct: number;
  catalystCard: CatalystCardFreshnessLabel;
  catalystTitle: string | null;
  localCatalyst: RunnerCatalystLabel | "not_checked";
  localCatalystTitle: string | null;
  bestForwardPct: number;
  meaningfulForward: boolean;
  move50: boolean;
  move100: boolean;
  reason: string;
  currentPrice: number;
  latestRangePct: number | null;
  latestBodyPct: number | null;
  rangeExpansionRatio: number | null;
  latestCloseRatio: number | null;
  rangePct: number | null;
  firstForwardGapPct: number | null;
  firstForwardRangePct: number | null;
  momentumBlockers: string[];
  catalystBlockers: string[];
  summary: string;
};

function numberDiagnostic(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function includesBlocker(blockers: string[], blocker: string): boolean {
  return blockers.includes(blocker);
}

function needsExternalCatalystContext(label: RunnerCatalystLabel | "not_checked"): boolean {
  return label === "no_local_pr_article_found" || label === "local_db_date_not_covered";
}

const activeRunnerNewsBurstCandidateVariants: ActiveRunnerNewsBurstCandidateVariant[] = [
  {
    name: "same_day_catalyst_relaxed",
    description: "Same-day local catalyst on a no-thesis active runner, even if the active candle body/close is weak.",
    productionReadiness: "reject_noisy",
    matches: (row) => row.localCatalyst === "same_day_premarket_pr" || row.localCatalyst === "same_day_market_or_after_pr",
  },
  {
    name: "same_day_catalyst_score_200",
    description: "Same-day local catalyst plus a 200%+ daily runner score.",
    productionReadiness: "reject_noisy",
    matches: (row) =>
      (row.localCatalyst === "same_day_premarket_pr" || row.localCatalyst === "same_day_market_or_after_pr") &&
      row.runnerScorePct >= 200,
  },
  {
    name: "no_local_catalyst_high_score_150_context_needed",
    description: "No local raw press-release catalyst, or local DB did not cover the date, but the daily runner score is already 150%+; this needs scanner/news context before it can be trader-facing.",
    productionReadiness: "scanner_context_only",
    matches: (row) => needsExternalCatalystContext(row.localCatalyst) && row.runnerScorePct >= 150,
  },
  {
    name: "no_local_catalyst_high_score_200_context_needed",
    description: "No local raw press-release catalyst, or local DB did not cover the date, but the daily runner score is already 200%+; narrower scanner-context candidate.",
    productionReadiness: "scanner_context_only",
    matches: (row) => needsExternalCatalystContext(row.localCatalyst) && row.runnerScorePct >= 200,
  },
  {
    name: "no_local_catalyst_high_score_150_clear_context_needed",
    description: "No local raw press-release catalyst, or local DB did not cover the date, 150%+ runner score, and the momentum gate did not reject the current price as failing to clear/hold the breakout area.",
    productionReadiness: "scanner_context_only",
    matches: (row) =>
      needsExternalCatalystContext(row.localCatalyst) &&
      row.runnerScorePct >= 150 &&
      !includesBlocker(row.momentumBlockers, "latest candle did not clear prior high by 3%") &&
      !includesBlocker(row.momentumBlockers, "price was not holding the breakout area"),
  },
  {
    name: "no_local_catalyst_high_score_200_clear_context_needed",
    description: "No local raw press-release catalyst, or local DB did not cover the date, 200%+ runner score, and no clear/hold blocker from the momentum gate.",
    productionReadiness: "scanner_context_only",
    matches: (row) =>
      needsExternalCatalystContext(row.localCatalyst) &&
      row.runnerScorePct >= 200 &&
      !includesBlocker(row.momentumBlockers, "latest candle did not clear prior high by 3%") &&
      !includesBlocker(row.momentumBlockers, "price was not holding the breakout area"),
  },
];

function buildActiveRunnerNewsBurstCandidateAnalysis(params: {
  activeRunners: SelectedRunner[];
  report: ChartThesisQaReport;
}) {
  const noThesisRows = [
    ...params.report.missedMoves,
    ...(params.report.noThesisBelowMeaningfulForwardRows ?? []),
  ];
  const noThesisByKey = new Map(noThesisRows.map((row) => [`${row.symbol}:${row.cutoffTimestamp}`, row]));
  const rows: ActiveRunnerNewsBurstCandidateRow[] = params.activeRunners
    .map((runner) => {
      const row = noThesisByKey.get(`${runner.symbol}:${runner.activeCutoffTimestamp}`);
      if (!row || runner.activeCutoffIso === null || runner.activeCutoffTimestamp === null) {
        return null;
      }
      const momentum = row.rejectionAudit.thesisRejections.find((item) =>
        item.thesisType === "momentum_expansion_continuation"
      );
      const catalyst = row.rejectionAudit.thesisRejections.find((item) =>
        item.thesisType === "catalyst_active_runner_continuation"
      );
      const diagnostics = {
        ...(catalyst?.diagnostics ?? {}),
        ...(momentum?.diagnostics ?? {}),
      };
      return {
        symbol: runner.symbol,
        runnerDate: runner.runnerDate,
        activeCutoffTimestamp: runner.activeCutoffTimestamp,
        activeCutoffIso: runner.activeCutoffIso,
        runnerScorePct: runner.runnerScorePct,
        catalystCard: runner.catalystCard?.label ?? "lookup_unavailable",
        catalystTitle: runner.catalystCard?.primaryArticle?.title ?? null,
        localCatalyst: runner.catalyst?.label ?? "not_checked",
        localCatalystTitle: runner.catalyst?.primaryArticle?.title ?? null,
        bestForwardPct: row.bestForwardPct,
        meaningfulForward: row.bestForwardPct >= params.report.settings.meaningfulMovePct,
        move50: row.bestForwardPct >= 50,
        move100: row.bestForwardPct >= 100,
        reason: row.bestForwardPct >= params.report.settings.meaningfulMovePct
          ? row.reason
          : "below_meaningful_forward",
        currentPrice: row.currentPrice,
        latestRangePct: numberDiagnostic(diagnostics.latestRangePct),
        latestBodyPct: numberDiagnostic(diagnostics.latestBodyPct),
        rangeExpansionRatio: numberDiagnostic(diagnostics.rangeExpansionRatio),
        latestCloseRatio: numberDiagnostic(diagnostics.latestCloseRatio),
        rangePct: numberDiagnostic(diagnostics.rangePct),
        firstForwardGapPct: row.firstForwardGapPct,
        firstForwardRangePct: row.firstForwardRangePct,
        momentumBlockers: momentum?.blockers ?? [],
        catalystBlockers: catalyst?.blockers ?? [],
        summary: row.summary,
      };
    })
    .filter((row): row is ActiveRunnerNewsBurstCandidateRow => Boolean(row));

  const variantStats = activeRunnerNewsBurstCandidateVariants.map((variant) => {
    const matches = rows.filter(variant.matches);
    const bestForwardValues = matches.map((row) => row.bestForwardPct);
    const reasonCounts = matches.reduce<Record<string, number>>((counts, row) => {
      counts[row.reason] = (counts[row.reason] ?? 0) + 1;
      return counts;
    }, {});
    const catalystCounts = matches.reduce<Record<string, number>>((counts, row) => {
      counts[row.localCatalyst] = (counts[row.localCatalyst] ?? 0) + 1;
      return counts;
    }, {});
    return {
      name: variant.name,
      description: variant.description,
      productionReadiness: variant.productionReadiness,
      candidates: matches.length,
      meaningfulMoveCount: matches.filter((row) => row.meaningfulForward).length,
      belowMeaningfulCount: matches.filter((row) => !row.meaningfulForward).length,
      move50Count: matches.filter((row) => row.move50).length,
      move100Count: matches.filter((row) => row.move100).length,
      meaningfulMoveRate: matches.length === 0
        ? 0
        : matches.filter((row) => row.meaningfulForward).length / matches.length,
      move50Rate: matches.length === 0 ? 0 : matches.filter((row) => row.move50).length / matches.length,
      avgBestForwardPct: bestForwardValues.length === 0
        ? null
        : bestForwardValues.reduce((sum, value) => sum + value, 0) / bestForwardValues.length,
      medianBestForwardPct: median(bestForwardValues),
      reasonCounts,
      catalystCounts,
      topExamples: matches
        .slice()
        .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
        .slice(0, 16),
      belowThresholdExamples: matches
        .filter((row) => !row.meaningfulForward)
        .slice()
        .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
        .slice(0, 12),
    };
  });

  const productionReady = variantStats.filter((stat) =>
    stat.productionReadiness === "candidate_for_engine_test" &&
    stat.candidates >= 5 &&
    stat.meaningfulMoveRate >= 0.6
  );

  return {
    generatedAt: new Date().toISOString(),
    meaningfulMovePct: params.report.settings.meaningfulMovePct,
    totals: {
      activeRunners: params.activeRunners.length,
      noThesisRows: rows.length,
      noThesisMeaningfulRows: rows.filter((row) => row.meaningfulForward).length,
      noThesisBelowMeaningfulRows: rows.filter((row) => !row.meaningfulForward).length,
      productionReadyCandidates: productionReady.length,
    },
    recommendation: productionReady.length > 0
      ? "A variant is strong enough for a production engine test."
      : "Do not add a trader-facing news/gap-burst thesis yet; strongest variants still need scanner/news context or are too noisy.",
    variantStats,
    rows,
  };
}

function renderActiveRunnerNewsBurstCandidateMarkdown(
  analysis: ReturnType<typeof buildActiveRunnerNewsBurstCandidateAnalysis>,
): string {
  const lines: string[] = [];
  lines.push("# Active-Runner News/GAP Burst Candidate QA");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- Active-runner cutoffs: ${analysis.totals.activeRunners}`);
  lines.push(`- No-thesis rows evaluated: ${analysis.totals.noThesisRows}`);
  lines.push(`- No-thesis meaningful rows: ${analysis.totals.noThesisMeaningfulRows}`);
  lines.push(`- No-thesis below-threshold rows: ${analysis.totals.noThesisBelowMeaningfulRows}`);
  lines.push(`- Meaningful threshold: ${formatPct(analysis.meaningfulMovePct)}`);
  lines.push(`- Recommendation: ${analysis.recommendation}`);
  lines.push("");
  lines.push("## Variant Stats");
  lines.push("");
  for (const stat of analysis.variantStats) {
    lines.push(
      `- ${stat.name}: ${stat.candidates} candidates, meaningful ${stat.meaningfulMoveCount}/${stat.candidates} (${(stat.meaningfulMoveRate * 100).toFixed(1)}%), >=50% ${stat.move50Count}/${stat.candidates} (${(stat.move50Rate * 100).toFixed(1)}%), >=100% ${stat.move100Count}/${stat.candidates}, below-threshold ${stat.belowMeaningfulCount}, median best ${stat.medianBestForwardPct === null ? "n/a" : formatPct(stat.medianBestForwardPct)}, avg best ${stat.avgBestForwardPct === null ? "n/a" : formatPct(stat.avgBestForwardPct)}, readiness ${stat.productionReadiness}`,
    );
    lines.push(`  - ${stat.description}`);
    lines.push(`  - Reason mix: ${Object.entries(stat.reasonCounts).map(([reason, count]) => `${reason}=${count}`).join(", ") || "none"}`);
  }
  lines.push("");
  lines.push("## Top Examples");
  lines.push("");
  for (const stat of analysis.variantStats) {
    lines.push(`### ${stat.name}`);
    if (stat.topExamples.length === 0) {
      lines.push("- No candidates.");
    } else {
      for (const row of stat.topExamples) {
        const title = row.catalystTitle ? ` (${row.catalystTitle})` : "";
        lines.push(
          `- ${row.runnerDate} ${row.symbol}: best ${formatPct(row.bestForwardPct)}, runner score ${formatPct(row.runnerScorePct)}, card ${row.catalystCard}${title}, reason ${row.reason}, latest range ${row.latestRangePct === null ? "n/a" : formatPct(row.latestRangePct)}, latest body ${row.latestBodyPct === null ? "n/a" : formatPct(row.latestBodyPct)}`,
        );
      }
    }
    if (stat.belowThresholdExamples.length > 0) {
      lines.push(`  - Highest below-threshold examples: ${stat.belowThresholdExamples.map((row) => `${row.symbol} ${formatPct(row.bestForwardPct)}`).join(", ")}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function hasTradeDayOrPriorEveningNews(label: ReturnType<typeof classifyEodhdNewsCatalyst>["label"]): boolean {
  return (
    label === "same_day_premarket_news" ||
    label === "same_day_market_or_after_news" ||
    label === "prior_evening_news"
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isGenericMoverTitle(title: string | null): boolean {
  return Boolean(title && /\b(top|premarket|midday|after-hours|market)\b.*\b(gainers|movers|stocks moving|on watch)\b/i.test(title));
}

function hasExplicitTickerMention(article: EodhdNewsArticle, symbol: string): boolean {
  const escaped = escapeRegExp(symbol.toUpperCase());
  const explicitPattern = new RegExp(`(?:\\$${escaped}\\b|\\bNASDAQ:\\s*${escaped}\\b|\\(${escaped}\\))`, "i");
  const title = article.title ?? "";
  if (explicitPattern.test(title)) {
    return true;
  }
  return article.tags.some((tag) => explicitPattern.test(tag));
}

function matchingUsEquitySymbols(article: EodhdNewsArticle): string[] {
  return article.symbols
    .map((symbol) => symbol.toUpperCase())
    .filter((symbol) => symbol.endsWith(".US"));
}

function classifyEodhdNewsEvidenceQuality(params: {
  symbol: string;
  eodhdNews: ReturnType<typeof classifyEodhdNewsCatalyst>;
}): "strong_ticker_catalyst" | "weak_multi_symbol_news" | "generic_market_mover" | "no_external_news" {
  const article = params.eodhdNews.primaryArticle;
  if (!article || params.eodhdNews.label === "no_eodhd_news_found") {
    return "no_external_news";
  }

  const symbol = params.symbol.toUpperCase();
  const matchingSymbol = `${symbol}.US`;
  const usEquitySymbols = matchingUsEquitySymbols(article);
  const includesSymbol = usEquitySymbols.includes(matchingSymbol);
  const genericMoverTitle = isGenericMoverTitle(article.title);
  if (genericMoverTitle) {
    return "generic_market_mover";
  }
  if (hasExplicitTickerMention(article, symbol) || (includesSymbol && usEquitySymbols.length === 1)) {
    return "strong_ticker_catalyst";
  }
  return includesSymbol ? "weak_multi_symbol_news" : "generic_market_mover";
}

function buildActiveRunnerExternalNewsCatalystAnalysis(params: {
  candidateAnalysis: ReturnType<typeof buildActiveRunnerNewsBurstCandidateAnalysis>;
  lookup: EodhdNewsLookupResult;
  lookbackDays: number;
  lookaheadDays: number;
  minRunnerScorePct: number;
}) {
  const candidates = params.candidateAnalysis.rows
    .filter((row) => needsExternalCatalystContext(row.localCatalyst) && row.runnerScorePct >= params.minRunnerScorePct)
    .sort((left, right) =>
      right.bestForwardPct - left.bestForwardPct ||
      right.runnerScorePct - left.runnerScorePct ||
      left.symbol.localeCompare(right.symbol),
    );
  const checked = candidates.filter((row) => params.lookup.checkedSymbols.includes(row.symbol.toUpperCase()));
  const rows = checked.map((row) => {
    const eodhdNews = classifyEodhdNewsCatalyst({
      runner: row,
      articles: params.lookup.articlesBySymbol[row.symbol.toUpperCase()] ?? [],
      lookbackDays: params.lookbackDays,
      lookaheadDays: params.lookaheadDays,
    });
    const evidenceQuality = classifyEodhdNewsEvidenceQuality({
      symbol: row.symbol,
      eodhdNews,
    });
    return {
      ...row,
      eodhdNews,
      evidenceQuality,
      externalCatalystEvidence: hasTradeDayOrPriorEveningNews(eodhdNews.label),
      strongExternalCatalystEvidence: hasTradeDayOrPriorEveningNews(eodhdNews.label) && evidenceQuality === "strong_ticker_catalyst",
    };
  });

  const counts: Record<string, number> = {};
  const evidenceQualityCounts: Record<string, number> = {};
  const meaningfulCountsByNewsLabel: Record<string, { total: number; meaningful: number; move50: number; move100: number }> = {};
  for (const row of rows) {
    counts[row.eodhdNews.label] = (counts[row.eodhdNews.label] ?? 0) + 1;
    evidenceQualityCounts[row.evidenceQuality] = (evidenceQualityCounts[row.evidenceQuality] ?? 0) + 1;
    const bucket = meaningfulCountsByNewsLabel[row.eodhdNews.label] ?? { total: 0, meaningful: 0, move50: 0, move100: 0 };
    bucket.total += 1;
    bucket.meaningful += row.meaningfulForward ? 1 : 0;
    bucket.move50 += row.move50 ? 1 : 0;
    bucket.move100 += row.move100 ? 1 : 0;
    meaningfulCountsByNewsLabel[row.eodhdNews.label] = bucket;
  }

  const externalEvidenceRows = rows.filter((row) => row.externalCatalystEvidence);
  const strongExternalEvidenceRows = rows.filter((row) => row.strongExternalCatalystEvidence);
  const noExternalEvidenceRows = rows.filter((row) => !row.externalCatalystEvidence);
  const articlesFetched = Object.values(params.lookup.articlesBySymbol).reduce((sum, articles) => sum + articles.length, 0);

  return {
    generatedAt: new Date().toISOString(),
    lookup: {
      available: params.lookup.available,
      enabled: params.lookup.enabled,
      error: params.lookup.error,
      checkedSymbols: params.lookup.checkedSymbols,
    },
    settings: {
      minRunnerScorePct: params.minRunnerScorePct,
      lookbackDays: params.lookbackDays,
      lookaheadDays: params.lookaheadDays,
    },
    totals: {
      candidateNoCardHighScoreRows: candidates.length,
      checkedRows: rows.length,
      checkedSymbols: params.lookup.checkedSymbols.length,
      articlesFetched,
      tradeDayOrPriorEveningNewsRows: externalEvidenceRows.length,
      strongTradeDayOrPriorEveningNewsRows: strongExternalEvidenceRows.length,
      noTradeDayOrPriorEveningNewsRows: noExternalEvidenceRows.length,
      evidenceMeaningfulRows: externalEvidenceRows.filter((row) => row.meaningfulForward).length,
      evidenceBelowMeaningfulRows: externalEvidenceRows.filter((row) => !row.meaningfulForward).length,
      evidenceMove50Rows: externalEvidenceRows.filter((row) => row.move50).length,
      evidenceMove100Rows: externalEvidenceRows.filter((row) => row.move100).length,
      strongEvidenceMeaningfulRows: strongExternalEvidenceRows.filter((row) => row.meaningfulForward).length,
      strongEvidenceBelowMeaningfulRows: strongExternalEvidenceRows.filter((row) => !row.meaningfulForward).length,
      strongEvidenceMove50Rows: strongExternalEvidenceRows.filter((row) => row.move50).length,
      strongEvidenceMove100Rows: strongExternalEvidenceRows.filter((row) => row.move100).length,
      noEvidenceMeaningfulRows: noExternalEvidenceRows.filter((row) => row.meaningfulForward).length,
      noEvidenceBelowMeaningfulRows: noExternalEvidenceRows.filter((row) => !row.meaningfulForward).length,
    },
    counts,
    evidenceQualityCounts,
    meaningfulCountsByNewsLabel,
    recommendation: !params.lookup.enabled
      ? "Run with --eodhd-news-lookup to test whether no-local-catalyst high-score active runners had external same-day or prior-evening catalysts."
      : strongExternalEvidenceRows.length > 0
        ? "Use this as catalyst coverage QA before adding chart-only reads; strong trade-day/prior-evening external news means the missing piece is likely enrichment, not a looser thesis gate."
        : "No external catalyst evidence was found for the checked no-local-catalyst high-score active runners; keep treating this bucket as scanner-context-only.",
    rows,
    uncheckedCandidates: candidates.filter((row) => !params.lookup.checkedSymbols.includes(row.symbol.toUpperCase())),
  };
}

function renderActiveRunnerExternalNewsCatalystMarkdown(
  analysis: ReturnType<typeof buildActiveRunnerExternalNewsCatalystAnalysis>,
): string {
  const lines: string[] = [];
  lines.push("# Active-Runner External News Catalyst QA");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- Enabled: ${analysis.lookup.enabled ? "yes" : "no"}`);
  lines.push(`- Available: ${analysis.lookup.available ? "yes" : "no"}`);
  if (analysis.lookup.error) {
    lines.push(`- Lookup note: \`${analysis.lookup.error}\``);
  }
  lines.push(`- No-local-catalyst high-score candidate rows: ${analysis.totals.candidateNoCardHighScoreRows}`);
  lines.push(`- Checked rows: ${analysis.totals.checkedRows}`);
  lines.push(`- Checked symbols: ${analysis.totals.checkedSymbols}`);
  lines.push(`- EODHD articles fetched: ${analysis.totals.articlesFetched}`);
  lines.push(`- Trade-day/prior-evening external-news rows: ${analysis.totals.tradeDayOrPriorEveningNewsRows}`);
  lines.push(`- Strong ticker-specific trade-day/prior-evening catalyst rows: ${analysis.totals.strongTradeDayOrPriorEveningNewsRows}`);
  lines.push(`- External-news evidence outcomes: meaningful ${analysis.totals.evidenceMeaningfulRows}, below-threshold ${analysis.totals.evidenceBelowMeaningfulRows}, >=50% ${analysis.totals.evidenceMove50Rows}, >=100% ${analysis.totals.evidenceMove100Rows}`);
  lines.push(`- Strong catalyst outcomes: meaningful ${analysis.totals.strongEvidenceMeaningfulRows}, below-threshold ${analysis.totals.strongEvidenceBelowMeaningfulRows}, >=50% ${analysis.totals.strongEvidenceMove50Rows}, >=100% ${analysis.totals.strongEvidenceMove100Rows}`);
  lines.push(`- No-evidence outcomes: meaningful ${analysis.totals.noEvidenceMeaningfulRows}, below-threshold ${analysis.totals.noEvidenceBelowMeaningfulRows}`);
  lines.push(`- Recommendation: ${analysis.recommendation}`);
  lines.push("");
  lines.push("## Evidence Quality Counts");
  lines.push("");
  for (const [label, count] of Object.entries(analysis.evidenceQualityCounts).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`- ${label}: ${count}`);
  }
  lines.push("");
  lines.push("## EODHD News Counts");
  lines.push("");
  for (const [label, count] of Object.entries(analysis.counts).sort(([left], [right]) => left.localeCompare(right))) {
    const outcome = analysis.meaningfulCountsByNewsLabel[label];
    lines.push(
      `- ${label}: ${count}${outcome ? `, meaningful ${outcome.meaningful}/${outcome.total}, >=50% ${outcome.move50}/${outcome.total}, >=100% ${outcome.move100}/${outcome.total}` : ""}`,
    );
  }
  lines.push("");
  lines.push("## Checked Rows");
  lines.push("");
  for (const row of analysis.rows
    .slice()
    .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
    .slice(0, 80)) {
    const title = row.eodhdNews.primaryArticle?.title ? ` (${row.eodhdNews.primaryArticle.title})` : "";
    lines.push(
      `- ${row.runnerDate} ${row.symbol}: best ${formatPct(row.bestForwardPct)}, runner score ${formatPct(row.runnerScorePct)}, eodhd ${row.eodhdNews.label}, quality ${row.evidenceQuality}${title}, reason ${row.reason}`,
    );
  }
  if (analysis.uncheckedCandidates.length > 0) {
    lines.push("");
    lines.push("## Unchecked Candidate Rows");
    lines.push("");
    for (const row of analysis.uncheckedCandidates.slice(0, 40)) {
      lines.push(
        `- ${row.runnerDate} ${row.symbol}: best ${formatPct(row.bestForwardPct)}, runner score ${formatPct(row.runnerScorePct)}, reason ${row.reason}`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function hasTradeDayOrPriorEveningStockTitan(label: ReturnType<typeof classifyStockTitanCatalyst>["label"]): boolean {
  return (
    label === "same_day_premarket_stocktitan" ||
    label === "same_day_market_or_after_stocktitan" ||
    label === "prior_evening_stocktitan"
  );
}

function buildActiveRunnerStockTitanCatalystAnalysis(params: {
  candidateAnalysis: ReturnType<typeof buildActiveRunnerNewsBurstCandidateAnalysis>;
  lookup: StockTitanLookupResult;
  lookbackDays: number;
  lookaheadDays: number;
  minRunnerScorePct: number;
}) {
  const candidates = params.candidateAnalysis.rows
    .filter((row) => needsExternalCatalystContext(row.localCatalyst) && row.runnerScorePct >= params.minRunnerScorePct)
    .sort((left, right) =>
      right.bestForwardPct - left.bestForwardPct ||
      right.runnerScorePct - left.runnerScorePct ||
      left.symbol.localeCompare(right.symbol),
    );
  const checked = candidates.filter((row) => params.lookup.checkedSymbols.includes(row.symbol.toUpperCase()));
  const rows = checked.map((row) => {
    const stockTitanNews = classifyStockTitanCatalyst({
      runner: row,
      articles: params.lookup.articlesBySymbol[row.symbol.toUpperCase()] ?? [],
      lookbackDays: params.lookbackDays,
      lookaheadDays: params.lookaheadDays,
    });
    const genericMoverTitle = isGenericMoverTitle(stockTitanNews.primaryArticle?.title ?? null);
    return {
      ...row,
      stockTitanNews,
      evidenceQuality: stockTitanNews.primaryArticle === null
        ? "no_stocktitan_news"
        : genericMoverTitle
          ? "generic_market_mover"
          : "ticker_page_catalyst",
      tradeDayOrPriorEveningEvidence: hasTradeDayOrPriorEveningStockTitan(stockTitanNews.label),
    };
  });

  const counts: Record<string, number> = {};
  const evidenceQualityCounts: Record<string, number> = {};
  const evidenceRows = rows.filter((row) => row.tradeDayOrPriorEveningEvidence);
  const tickerCatalystRows = evidenceRows.filter((row) => row.evidenceQuality === "ticker_page_catalyst");
  for (const row of rows) {
    counts[row.stockTitanNews.label] = (counts[row.stockTitanNews.label] ?? 0) + 1;
    evidenceQualityCounts[row.evidenceQuality] = (evidenceQualityCounts[row.evidenceQuality] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    lookup: {
      available: params.lookup.available,
      enabled: params.lookup.enabled,
      error: params.lookup.error,
      checkedSymbols: params.lookup.checkedSymbols,
    },
    settings: {
      minRunnerScorePct: params.minRunnerScorePct,
      lookbackDays: params.lookbackDays,
      lookaheadDays: params.lookaheadDays,
    },
    totals: {
      candidateNoCardHighScoreRows: candidates.length,
      checkedRows: rows.length,
      checkedSymbols: params.lookup.checkedSymbols.length,
      articlesFetched: Object.values(params.lookup.articlesBySymbol).reduce((sum, articles) => sum + articles.length, 0),
      tradeDayOrPriorEveningRows: evidenceRows.length,
      tickerCatalystTradeDayOrPriorEveningRows: tickerCatalystRows.length,
      tickerCatalystMeaningfulRows: tickerCatalystRows.filter((row) => row.meaningfulForward).length,
      tickerCatalystBelowMeaningfulRows: tickerCatalystRows.filter((row) => !row.meaningfulForward).length,
      tickerCatalystMove50Rows: tickerCatalystRows.filter((row) => row.move50).length,
      tickerCatalystMove100Rows: tickerCatalystRows.filter((row) => row.move100).length,
      noStockTitanNewsRows: rows.filter((row) => row.stockTitanNews.label === "no_stocktitan_news_found").length,
    },
    counts,
    evidenceQualityCounts,
    recommendation: !params.lookup.enabled
      ? "Run with --stocktitan-lookup to cross-check active-runner no-local-catalyst candidates against StockTitan ticker pages."
      : tickerCatalystRows.length > 0
        ? "StockTitan found ticker-page catalyst coverage missing from the local raw press-release lookup; use this before trusting no-local-catalyst labels."
        : "StockTitan did not find additional ticker-page catalyst coverage for this checked bucket.",
    rows,
    uncheckedCandidates: candidates.filter((row) => !params.lookup.checkedSymbols.includes(row.symbol.toUpperCase())),
  };
}

function renderActiveRunnerStockTitanCatalystMarkdown(
  analysis: ReturnType<typeof buildActiveRunnerStockTitanCatalystAnalysis>,
): string {
  const lines: string[] = [];
  lines.push("# Active-Runner StockTitan Catalyst QA");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- Enabled: ${analysis.lookup.enabled ? "yes" : "no"}`);
  lines.push(`- Available: ${analysis.lookup.available ? "yes" : "no"}`);
  if (analysis.lookup.error) {
    lines.push(`- Lookup note: \`${analysis.lookup.error}\``);
  }
  lines.push(`- No-local-catalyst high-score candidate rows: ${analysis.totals.candidateNoCardHighScoreRows}`);
  lines.push(`- Checked rows: ${analysis.totals.checkedRows}`);
  lines.push(`- Checked symbols: ${analysis.totals.checkedSymbols}`);
  lines.push(`- StockTitan articles fetched: ${analysis.totals.articlesFetched}`);
  lines.push(`- Trade-day/prior-evening StockTitan rows: ${analysis.totals.tradeDayOrPriorEveningRows}`);
  lines.push(`- Ticker-catalyst trade-day/prior-evening rows: ${analysis.totals.tickerCatalystTradeDayOrPriorEveningRows}`);
  lines.push(`- Ticker-catalyst outcomes: meaningful ${analysis.totals.tickerCatalystMeaningfulRows}, below-threshold ${analysis.totals.tickerCatalystBelowMeaningfulRows}, >=50% ${analysis.totals.tickerCatalystMove50Rows}, >=100% ${analysis.totals.tickerCatalystMove100Rows}`);
  lines.push(`- No StockTitan news rows: ${analysis.totals.noStockTitanNewsRows}`);
  lines.push(`- Recommendation: ${analysis.recommendation}`);
  lines.push("");
  lines.push("## Evidence Quality Counts");
  lines.push("");
  for (const [label, count] of Object.entries(analysis.evidenceQualityCounts).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`- ${label}: ${count}`);
  }
  lines.push("");
  lines.push("## StockTitan News Counts");
  lines.push("");
  for (const [label, count] of Object.entries(analysis.counts).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`- ${label}: ${count}`);
  }
  lines.push("");
  lines.push("## Checked Rows");
  lines.push("");
  for (const row of analysis.rows
    .slice()
    .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
    .slice(0, 80)) {
    const title = row.stockTitanNews.primaryArticle?.title ? ` (${row.stockTitanNews.primaryArticle.title})` : "";
    lines.push(
      `- ${row.runnerDate} ${row.symbol}: best ${formatPct(row.bestForwardPct)}, runner score ${formatPct(row.runnerScorePct)}, stocktitan ${row.stockTitanNews.label}, quality ${row.evidenceQuality}${title}, reason ${row.reason}`,
    );
  }
  if (analysis.uncheckedCandidates.length > 0) {
    lines.push("");
    lines.push("## Unchecked Candidate Rows");
    lines.push("");
    for (const row of analysis.uncheckedCandidates.slice(0, 40)) {
      lines.push(
        `- ${row.runnerDate} ${row.symbol}: best ${formatPct(row.bestForwardPct)}, runner score ${formatPct(row.runnerScorePct)}, reason ${row.reason}`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

type ActiveRunnerExternalNewsBurstContextVariant = {
  name: string;
  description: string;
  productionReadiness: "needs_more_samples" | "reject_noisy" | "candidate_for_engine_test";
  matches: (row: ActiveRunnerNewsBurstExternalContextRow) => boolean;
};

type ActiveRunnerNewsBurstExternalContextRow = ActiveRunnerNewsBurstCandidateRow & {
  eodhdNews: ReturnType<typeof classifyEodhdNewsCatalyst> | null;
  eodhdEvidenceQuality: ReturnType<typeof classifyEodhdNewsEvidenceQuality> | "not_checked";
  stockTitanNews: ReturnType<typeof classifyStockTitanCatalyst> | null;
  stockTitanEvidenceQuality: "no_stocktitan_news" | "generic_market_mover" | "ticker_page_catalyst" | "not_checked";
  strongEodhdContext: boolean;
  stockTitanTickerContext: boolean;
  externalTickerContext: boolean;
  playableRange: boolean;
  bodyNotDeepRed: boolean;
};

function buildActiveRunnerNewsBurstExternalContextAnalysis(params: {
  candidateAnalysis: ReturnType<typeof buildActiveRunnerNewsBurstCandidateAnalysis>;
  eodhdAnalysis: ReturnType<typeof buildActiveRunnerExternalNewsCatalystAnalysis>;
  stockTitanAnalysis: ReturnType<typeof buildActiveRunnerStockTitanCatalystAnalysis>;
  minRunnerScorePct: number;
}) {
  const keyFor = (row: Pick<ActiveRunnerNewsBurstCandidateRow, "symbol" | "activeCutoffTimestamp">): string =>
    `${row.symbol.toUpperCase()}:${row.activeCutoffTimestamp}`;
  const eodhdByKey = new Map(params.eodhdAnalysis.rows.map((row) => [keyFor(row), row]));
  const stockTitanByKey = new Map(params.stockTitanAnalysis.rows.map((row) => [keyFor(row), row]));
  const rows: ActiveRunnerNewsBurstExternalContextRow[] = params.candidateAnalysis.rows
    .filter((row) => needsExternalCatalystContext(row.localCatalyst) && row.runnerScorePct >= params.minRunnerScorePct)
    .map((row) => {
      const eodhdRow = eodhdByKey.get(keyFor(row));
      const stockTitanRow = stockTitanByKey.get(keyFor(row));
      const eodhdEvidenceQuality: ActiveRunnerNewsBurstExternalContextRow["eodhdEvidenceQuality"] =
        eodhdRow?.evidenceQuality ?? "not_checked";
      const stockTitanEvidenceQuality: ActiveRunnerNewsBurstExternalContextRow["stockTitanEvidenceQuality"] =
        (stockTitanRow?.evidenceQuality ?? "not_checked") as ActiveRunnerNewsBurstExternalContextRow["stockTitanEvidenceQuality"];
      const strongEodhdContext = Boolean(eodhdRow?.strongExternalCatalystEvidence);
      const stockTitanTickerContext = Boolean(
        stockTitanRow?.tradeDayOrPriorEveningEvidence &&
        stockTitanRow.evidenceQuality === "ticker_page_catalyst",
      );
      const externalTickerContext = strongEodhdContext || stockTitanTickerContext;
      const playableRange =
        row.latestRangePct !== null &&
        row.latestRangePct >= 25 &&
        row.latestRangePct <= 95 &&
        row.rangePct !== null &&
        row.rangePct >= 8;
      const bodyNotDeepRed = row.latestBodyPct !== null && row.latestBodyPct > -5;
      return {
        ...row,
        eodhdNews: eodhdRow?.eodhdNews ?? null,
        eodhdEvidenceQuality,
        stockTitanNews: stockTitanRow?.stockTitanNews ?? null,
        stockTitanEvidenceQuality,
        strongEodhdContext,
        stockTitanTickerContext,
        externalTickerContext,
        playableRange,
        bodyNotDeepRed,
      };
    })
    .sort((left, right) => right.bestForwardPct - left.bestForwardPct);

  const variants: ActiveRunnerExternalNewsBurstContextVariant[] = [
    {
      name: "external_ticker_context_all",
      description: "EODHD strong ticker catalyst or StockTitan ticker-page catalyst on the trade day/prior evening.",
      productionReadiness: "needs_more_samples",
      matches: (row) => row.externalTickerContext,
    },
    {
      name: "stocktitan_ticker_context_all",
      description: "StockTitan ticker-page catalyst on the trade day/prior evening.",
      productionReadiness: "needs_more_samples",
      matches: (row) => row.stockTitanTickerContext,
    },
    {
      name: "external_ticker_playable_range",
      description: "External ticker catalyst plus active candle range 25-95% and prior range at least 8%.",
      productionReadiness: "needs_more_samples",
      matches: (row) => row.externalTickerContext && row.playableRange,
    },
    {
      name: "external_ticker_playable_range_body_not_deep_red",
      description: "External ticker catalyst, playable range, and active 4h body better than -5%.",
      productionReadiness: "candidate_for_engine_test",
      matches: (row) => row.externalTickerContext && row.playableRange && row.bodyNotDeepRed,
    },
  ];

  const variantStats = variants.map((variant) => {
    const matches = rows.filter(variant.matches);
    const bestForwardValues = matches.map((row) => row.bestForwardPct);
    const reasonCounts = matches.reduce<Record<string, number>>((counts, row) => {
      counts[row.reason] = (counts[row.reason] ?? 0) + 1;
      return counts;
    }, {});
    return {
      name: variant.name,
      description: variant.description,
      productionReadiness: matches.length < 10 ? "needs_more_samples" : variant.productionReadiness,
      candidates: matches.length,
      meaningfulMoveCount: matches.filter((row) => row.meaningfulForward).length,
      belowMeaningfulCount: matches.filter((row) => !row.meaningfulForward).length,
      move50Count: matches.filter((row) => row.move50).length,
      move100Count: matches.filter((row) => row.move100).length,
      medianBestForwardPct: median(bestForwardValues),
      avgBestForwardPct: bestForwardValues.length > 0
        ? bestForwardValues.reduce((sum, value) => sum + value, 0) / bestForwardValues.length
        : null,
      reasonCounts,
      topExamples: matches.slice().sort((left, right) => right.bestForwardPct - left.bestForwardPct).slice(0, 12),
      belowThresholdExamples: matches
        .filter((row) => !row.meaningfulForward)
        .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
        .slice(0, 8),
    };
  });
  const bestVariant = variantStats
    .slice()
    .sort((left, right) =>
      right.meaningfulMoveCount - left.meaningfulMoveCount ||
      right.move50Count - left.move50Count ||
      right.candidates - left.candidates,
    )[0] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    settings: {
      minRunnerScorePct: params.minRunnerScorePct,
    },
    totals: {
      candidateRows: rows.length,
      externalTickerContextRows: rows.filter((row) => row.externalTickerContext).length,
      strongEodhdContextRows: rows.filter((row) => row.strongEodhdContext).length,
      stockTitanTickerContextRows: rows.filter((row) => row.stockTitanTickerContext).length,
      externalTickerMeaningfulRows: rows.filter((row) => row.externalTickerContext && row.meaningfulForward).length,
      externalTickerBelowMeaningfulRows: rows.filter((row) => row.externalTickerContext && !row.meaningfulForward).length,
      externalTickerMove50Rows: rows.filter((row) => row.externalTickerContext && row.move50).length,
      externalTickerMove100Rows: rows.filter((row) => row.externalTickerContext && row.move100).length,
    },
    recommendation: bestVariant && bestVariant.candidates >= 10 && bestVariant.meaningfulMoveCount / Math.max(bestVariant.candidates, 1) >= 0.65
      ? "A ticker-confirmed news/gap-burst variant is strong enough for a focused engine test."
      : "External ticker catalyst context is promising but still too small for a live trader-read rule; keep gathering same-day catalyst runner samples.",
    variantStats,
    rows,
  };
}

function renderActiveRunnerNewsBurstExternalContextMarkdown(
  analysis: ReturnType<typeof buildActiveRunnerNewsBurstExternalContextAnalysis>,
): string {
  const lines: string[] = [];
  lines.push("# Active-Runner News/GAP Burst External Context QA");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- Candidate rows: ${analysis.totals.candidateRows}`);
  lines.push(`- External ticker-context rows: ${analysis.totals.externalTickerContextRows}`);
  lines.push(`- Strong EODHD context rows: ${analysis.totals.strongEodhdContextRows}`);
  lines.push(`- StockTitan ticker-context rows: ${analysis.totals.stockTitanTickerContextRows}`);
  lines.push(`- External ticker outcomes: meaningful ${analysis.totals.externalTickerMeaningfulRows}, below-threshold ${analysis.totals.externalTickerBelowMeaningfulRows}, >=50% ${analysis.totals.externalTickerMove50Rows}, >=100% ${analysis.totals.externalTickerMove100Rows}`);
  lines.push(`- Recommendation: ${analysis.recommendation}`);
  lines.push("");
  lines.push("## Variant Stats");
  lines.push("");
  for (const stat of analysis.variantStats) {
    lines.push(
      `- ${stat.name}: ${stat.candidates} candidates, meaningful ${stat.meaningfulMoveCount}/${stat.candidates}, >=50% ${stat.move50Count}/${stat.candidates}, >=100% ${stat.move100Count}/${stat.candidates}, below-threshold ${stat.belowMeaningfulCount}, median best ${stat.medianBestForwardPct === null ? "n/a" : formatPct(stat.medianBestForwardPct)}, avg best ${stat.avgBestForwardPct === null ? "n/a" : formatPct(stat.avgBestForwardPct)}, readiness ${stat.productionReadiness}`,
    );
    lines.push(`  - ${stat.description}`);
    const reasonSummary = Object.entries(stat.reasonCounts)
      .sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
      .map(([reason, count]) => `${reason}=${count}`)
      .join(", ");
    if (reasonSummary) {
      lines.push(`  - Reason mix: ${reasonSummary}`);
    }
  }
  lines.push("");
  lines.push("## Top Examples");
  lines.push("");
  for (const stat of analysis.variantStats) {
    lines.push(`### ${stat.name}`);
    if (stat.topExamples.length === 0) {
      lines.push("- No candidates.");
    } else {
      for (const row of stat.topExamples) {
        const sources = [
          row.strongEodhdContext ? `EODHD ${row.eodhdNews?.label}` : null,
          row.stockTitanTickerContext ? `StockTitan ${row.stockTitanNews?.label}` : null,
        ].filter(Boolean).join(", ");
        lines.push(
          `- ${row.runnerDate} ${row.symbol}: best ${formatPct(row.bestForwardPct)}, runner score ${formatPct(row.runnerScorePct)}, source ${sources || "none"}, reason ${row.reason}, latest range ${row.latestRangePct === null ? "n/a" : formatPct(row.latestRangePct)}, body ${row.latestBodyPct === null ? "n/a" : formatPct(row.latestBodyPct)}, close ratio ${row.latestCloseRatio === null ? "n/a" : row.latestCloseRatio.toFixed(2)}, prior range ${row.rangePct === null ? "n/a" : formatPct(row.rangePct)}`,
        );
      }
    }
    if (stat.belowThresholdExamples.length > 0) {
      lines.push(`  - Highest below-threshold examples: ${stat.belowThresholdExamples.map((row) => `${row.symbol} ${formatPct(row.bestForwardPct)}`).join(", ")}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function hasFreshLocalPressReleaseLabel(label: string): boolean {
  return (
    label === "same_day_premarket_pr" ||
    label === "same_day_market_or_after_pr" ||
    label === "prior_evening_pr"
  );
}

function buildActiveRunnerNarrowFiveMinuteNewsContextAnalysis(params: {
  tapeAudit: ReturnType<typeof buildFiveMinuteTapeParticipationAudit>;
  eodhdLookup: EodhdNewsLookupResult;
  stockTitanLookup: StockTitanLookupResult;
  lookbackDays: number;
  lookaheadDays: number;
}) {
  const rows = params.tapeAudit.narrowCandidateRule.gateComparison.rows
    .map((row) => {
      const runnerDate = row.runnerDate ?? row.cutoffIso.slice(0, 10);
      const symbol = row.symbol.toUpperCase();
      const eodhdNews = classifyEodhdNewsCatalyst({
        runner: { symbol, runnerDate },
        articles: params.eodhdLookup.articlesBySymbol[symbol] ?? [],
        lookbackDays: params.lookbackDays,
        lookaheadDays: params.lookaheadDays,
      });
      const eodhdEvidenceQuality = classifyEodhdNewsEvidenceQuality({
        symbol,
        eodhdNews,
      });
      const stockTitanNews = classifyStockTitanCatalyst({
        runner: { runnerDate },
        articles: params.stockTitanLookup.articlesBySymbol[symbol] ?? [],
        lookbackDays: params.lookbackDays,
        lookaheadDays: params.lookaheadDays,
      });
      const stockTitanEvidenceQuality = stockTitanNews.primaryArticle === null
        ? "no_stocktitan_news"
        : isGenericMoverTitle(stockTitanNews.primaryArticle.title)
          ? "generic_market_mover"
          : "ticker_page_catalyst";
      const freshLocalContext = hasFreshLocalPressReleaseLabel(row.localCatalyst);
      const strongEodhdContext = hasTradeDayOrPriorEveningNews(eodhdNews.label) && eodhdEvidenceQuality === "strong_ticker_catalyst";
      const stockTitanTickerContext = hasTradeDayOrPriorEveningStockTitan(stockTitanNews.label) && stockTitanEvidenceQuality === "ticker_page_catalyst";
      const scannerNewsContextPresent = freshLocalContext || strongEodhdContext || stockTitanTickerContext;
      return {
        ...row,
        runnerDate,
        eodhdChecked: params.eodhdLookup.checkedSymbols.includes(symbol),
        stockTitanChecked: params.stockTitanLookup.checkedSymbols.includes(symbol),
        eodhdNews,
        eodhdEvidenceQuality,
        stockTitanNews,
        stockTitanEvidenceQuality,
        freshLocalContext,
        strongEodhdContext,
        stockTitanTickerContext,
        scannerNewsContextPresent,
      };
    })
    .sort((left, right) => right.bestForwardPct - left.bestForwardPct);

  const contextRows = rows.filter((row) => row.scannerNewsContextPresent);
  const noContextRows = rows.filter((row) => !row.scannerNewsContextPresent);
  const meaningfulRows = rows.filter((row) => isMeaningfulFiveMinuteTapeOutcome(row.outcome));
  const missedRows = rows.filter((row) => row.outcome === "missed_meaningful_move" && row.thesisType === null);

  return {
    generatedAt: new Date().toISOString(),
    settings: {
      lookbackDays: params.lookbackDays,
      lookaheadDays: params.lookaheadDays,
    },
    lookup: {
      eodhd: {
        enabled: params.eodhdLookup.enabled,
        available: params.eodhdLookup.available,
        error: params.eodhdLookup.error,
        checkedSymbols: params.eodhdLookup.checkedSymbols,
      },
      stockTitan: {
        enabled: params.stockTitanLookup.enabled,
        available: params.stockTitanLookup.available,
        error: params.stockTitanLookup.error,
        checkedSymbols: params.stockTitanLookup.checkedSymbols,
      },
    },
    totals: {
      narrowRows: rows.length,
      meaningfulRows: meaningfulRows.length,
      missedWithoutThesisRows: missedRows.length,
      eodhdCheckedRows: rows.filter((row) => row.eodhdChecked).length,
      stockTitanCheckedRows: rows.filter((row) => row.stockTitanChecked).length,
      scannerNewsContextRows: contextRows.length,
      scannerNewsContextMeaningfulRows: contextRows.filter((row) => isMeaningfulFiveMinuteTapeOutcome(row.outcome)).length,
      scannerNewsContextMissedRows: contextRows.filter((row) => row.outcome === "missed_meaningful_move" && row.thesisType === null).length,
      noScannerNewsContextRows: noContextRows.length,
      noScannerNewsContextMeaningfulRows: noContextRows.filter((row) => isMeaningfulFiveMinuteTapeOutcome(row.outcome)).length,
      noScannerNewsContextMissedRows: noContextRows.filter((row) => row.outcome === "missed_meaningful_move" && row.thesisType === null).length,
      freshLocalContextRows: rows.filter((row) => row.freshLocalContext).length,
      strongEodhdContextRows: rows.filter((row) => row.strongEodhdContext).length,
      stockTitanTickerContextRows: rows.filter((row) => row.stockTitanTickerContext).length,
    },
    recommendation: missedRows.length > 0 && contextRows.every((row) => row.outcome !== "missed_meaningful_move")
      ? "The checked scanner/news sources did not explain the missed narrow 5m candidates; do not promote this as a live thesis from the current evidence."
      : contextRows.length === 0
        ? "No same-day/prior-evening scanner-news context was found for the narrow 5m candidate bucket; do not promote this as a live thesis from the current evidence."
        : noContextRows.some((row) => row.outcome === "missed_meaningful_move")
          ? "Scanner/news context explains some but not all narrow 5m misses; keep this QA-only and expand the sample before adding a trader-facing rule."
          : "Scanner/news context is present on the narrow 5m candidates in this run, but the sample is still too small for a live rule; expand the replay before promotion.",
    rows,
  };
}

function renderActiveRunnerNarrowFiveMinuteNewsContextMarkdown(
  analysis: ReturnType<typeof buildActiveRunnerNarrowFiveMinuteNewsContextAnalysis>,
): string {
  const lines: string[] = [];
  lines.push("# Active-Runner Narrow 5m News Context QA");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- Narrow 5m candidate rows: ${analysis.totals.narrowRows}`);
  lines.push(`- Meaningful rows: ${analysis.totals.meaningfulRows}`);
  lines.push(`- Missed without thesis: ${analysis.totals.missedWithoutThesisRows}`);
  lines.push(`- EODHD checked rows: ${analysis.totals.eodhdCheckedRows}`);
  lines.push(`- StockTitan checked rows: ${analysis.totals.stockTitanCheckedRows}`);
  lines.push(`- Scanner/news context rows: ${analysis.totals.scannerNewsContextRows}`);
  lines.push(`- Scanner/news context outcomes: meaningful ${analysis.totals.scannerNewsContextMeaningfulRows}, missed ${analysis.totals.scannerNewsContextMissedRows}`);
  lines.push(`- No scanner/news context outcomes: rows ${analysis.totals.noScannerNewsContextRows}, meaningful ${analysis.totals.noScannerNewsContextMeaningfulRows}, missed ${analysis.totals.noScannerNewsContextMissedRows}`);
  lines.push(`- Context source counts: local ${analysis.totals.freshLocalContextRows}, EODHD strong ${analysis.totals.strongEodhdContextRows}, StockTitan ticker ${analysis.totals.stockTitanTickerContextRows}`);
  lines.push(`- Recommendation: ${analysis.recommendation}`);
  lines.push("");
  lines.push("## Rows");
  lines.push("");
  for (const row of analysis.rows) {
    const eodhdTitle = row.eodhdNews.primaryArticle?.title ? ` (${row.eodhdNews.primaryArticle.title})` : "";
    const stockTitanTitle = row.stockTitanNews.primaryArticle?.title ? ` (${row.stockTitanNews.primaryArticle.title})` : "";
    lines.push(
      `- ${row.runnerDate} ${row.symbol}: context ${row.scannerNewsContextPresent ? "yes" : "no"}, outcome ${row.outcome}, best ${formatPct(row.bestForwardPct)}, thesis ${row.thesisType ?? "none"}, gate ${row.gateRead}`,
    );
    lines.push(
      `  - Local ${row.localCatalyst}; EODHD ${row.eodhdNews.label}/${row.eodhdEvidenceQuality}${eodhdTitle}; StockTitan ${row.stockTitanNews.label}/${row.stockTitanEvidenceQuality}${stockTitanTitle}`,
    );
    lines.push(`  - ${row.liveConfirmation.summary}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

type DelayedQuietCandidateVariant = {
  name: string;
  description: string;
  productionReadiness: "qa_only" | "candidate_for_engine_test" | "reject_noisy";
  matches: (row: DelayedQuietCandidateRow) => boolean;
};

type DelayedQuietCandidateRow = {
  symbol: string;
  runnerDate: string;
  activeCutoffTimestamp: number;
  activeCutoffIso: string;
  catalystCard: CatalystCardFreshnessLabel;
  localCatalyst: RunnerCatalystLabel | "not_checked";
  freshContext: boolean;
  currentPrice: number;
  bestForwardPct: number;
  meaningfulForward: boolean;
  move50: boolean;
  move100: boolean;
  missedReason: string;
  priorRangePct: number | null;
  priorRangePositionPct: number | null;
  shelfExtensionPct: number | null;
  firstForwardGapPct: number | null;
  firstForwardRangePct: number | null;
  latestRangePct: number | null;
  latestBodyPct: number | null;
  rangeExpansionRatio: number | null;
  latestCloseRatio: number | null;
  tapeClassification: string | null;
  tapeVolumeRatio: number | null;
  tapeLatestRangePct: number | null;
  tapeCloseExtensionPct: number | null;
  tapeSessionPositionPct: number | null;
  tapeSummary: string | null;
  summary: string;
};

function diagnosticFromRejections(
  row: Pick<DelayedQuietCandidateRow, "symbol"> & { rejectionAudit?: ChartThesisQaMissedMove["rejectionAudit"] },
  thesisTypes: string[],
  key: string,
): number | null {
  for (const thesisType of thesisTypes) {
    const rejection = row.rejectionAudit?.thesisRejections.find((item) => item.thesisType === thesisType);
    const value = numberDiagnostic(rejection?.diagnostics[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function hasQuietRangeBase(row: DelayedQuietCandidateRow): boolean {
  return (
    row.priorRangePct !== null &&
    row.priorRangePositionPct !== null &&
    row.shelfExtensionPct !== null &&
    row.priorRangePct >= 25 &&
    row.priorRangePct <= 45 &&
    row.priorRangePositionPct >= 25 &&
    row.priorRangePositionPct <= 180 &&
    row.shelfExtensionPct >= -25 &&
    row.shelfExtensionPct <= 35
  );
}

function hasControlledQuietExpansionState(row: DelayedQuietCandidateRow): boolean {
  return (
    hasQuietRangeBase(row) &&
    (row.latestRangePct ?? 0) >= 10 &&
    (row.latestRangePct ?? Number.POSITIVE_INFINITY) <= 80 &&
    (row.rangeExpansionRatio ?? 0) >= 1.1 &&
    (row.rangeExpansionRatio ?? Number.POSITIVE_INFINITY) <= 8 &&
    (row.latestCloseRatio ?? -1) >= 0.2
  );
}

function hasQuietFiveMinuteParticipation(row: DelayedQuietCandidateRow): boolean {
  return (
    row.tapeClassification !== null &&
    row.tapeClassification !== "hot_but_extended" &&
    (row.tapeVolumeRatio ?? 0) >= 1.8 &&
    (row.tapeLatestRangePct ?? 0) >= 3 &&
    (row.tapeLatestRangePct ?? Number.POSITIVE_INFINITY) <= 18 &&
    (row.tapeCloseExtensionPct ?? Number.POSITIVE_INFINITY) <= 15
  );
}

const delayedQuietCandidateVariants: DelayedQuietCandidateVariant[] = [
  {
    name: "quiet_range_base",
    description: "Price is sitting in a wide-but-not-broken recent range, without using the future next-candle move as a gate.",
    productionReadiness: "qa_only",
    matches: hasQuietRangeBase,
  },
  {
    name: "quiet_range_controlled_expansion",
    description: "Quiet-range base plus a controlled current 4h expansion state and at least a modest upper-half close.",
    productionReadiness: "candidate_for_engine_test",
    matches: hasControlledQuietExpansionState,
  },
  {
    name: "quiet_range_5m_participating",
    description: "Quiet-range base plus actionable 5m participation near the cutoff, excluding hot-but-extended tape.",
    productionReadiness: "candidate_for_engine_test",
    matches: (row) => hasQuietRangeBase(row) && hasQuietFiveMinuteParticipation(row),
  },
  {
    name: "quiet_range_context_or_5m",
    description: "Controlled quiet-range state with either fresh catalyst context or actionable 5m participation.",
    productionReadiness: "candidate_for_engine_test",
    matches: (row) =>
      hasControlledQuietExpansionState(row) &&
      (row.freshContext || hasQuietFiveMinuteParticipation(row)),
  },
];

function buildActiveRunnerDelayedQuietCandidateAnalysis(params: {
  activeRunners: SelectedRunner[];
  report: ChartThesisQaReport;
  tapeAudit: ReturnType<typeof buildFiveMinuteTapeParticipationAudit>;
}) {
  const noThesisRows = [
    ...params.report.missedMoves,
    ...(params.report.noThesisBelowMeaningfulForwardRows ?? []),
  ];
  const noThesisByKey = new Map(noThesisRows.map((row) => [`${row.symbol}:${row.cutoffTimestamp}`, row]));
  const tapeByKey = new Map(params.tapeAudit.rows.map((row) => [`${row.symbol}:${row.cutoffTimestamp}`, row]));
  const meaningfulMovePct = params.report.settings.meaningfulMovePct;
  const rows: DelayedQuietCandidateRow[] = params.activeRunners
    .map((runner): DelayedQuietCandidateRow | null => {
      const key = `${runner.symbol}:${runner.activeCutoffTimestamp}`;
      const row = noThesisByKey.get(key);
      if (!row || runner.activeCutoffIso === null || runner.activeCutoffTimestamp === null) {
        return null;
      }
      const tape = tapeByKey.get(key);
      const shelfExtensionPct = computeShelfExtensionPct(row);
      const diagnosticsSource = {
        symbol: row.symbol,
        rejectionAudit: row.rejectionAudit,
      };
      return {
        symbol: runner.symbol,
        runnerDate: runner.runnerDate,
        activeCutoffTimestamp: runner.activeCutoffTimestamp,
        activeCutoffIso: runner.activeCutoffIso,
        catalystCard: runner.catalystCard?.label ?? "lookup_unavailable",
        localCatalyst: (runner.catalyst?.label ?? "not_checked") as RunnerCatalystLabel | "not_checked",
        freshContext: hasFreshRunnerContext(runner),
        currentPrice: row.currentPrice,
        bestForwardPct: row.bestForwardPct,
        meaningfulForward: row.bestForwardPct >= meaningfulMovePct,
        move50: row.bestForwardPct >= 50,
        move100: row.bestForwardPct >= 100,
        missedReason: row.bestForwardPct >= meaningfulMovePct ? row.reason : "below_meaningful_forward",
        priorRangePct: row.priorRangePct,
        priorRangePositionPct: row.priorRangePositionPct,
        shelfExtensionPct,
        firstForwardGapPct: row.firstForwardGapPct,
        firstForwardRangePct: row.firstForwardRangePct,
        latestRangePct: diagnosticFromRejections(diagnosticsSource, [
          "momentum_expansion_continuation",
          "catalyst_active_runner_continuation",
        ], "latestRangePct"),
        latestBodyPct: diagnosticFromRejections(diagnosticsSource, [
          "momentum_expansion_continuation",
          "catalyst_active_runner_continuation",
        ], "latestBodyPct"),
        rangeExpansionRatio: diagnosticFromRejections(diagnosticsSource, [
          "momentum_expansion_continuation",
          "catalyst_active_runner_continuation",
        ], "rangeExpansionRatio"),
        latestCloseRatio: diagnosticFromRejections(diagnosticsSource, [
          "momentum_expansion_continuation",
          "catalyst_active_runner_continuation",
        ], "latestCloseRatio"),
        tapeClassification: tape?.classification ?? null,
        tapeVolumeRatio: tape?.liveConfirmation.volumeRatio ?? null,
        tapeLatestRangePct: tape?.liveConfirmation.latestRangePct ?? null,
        tapeCloseExtensionPct: tape?.liveConfirmation.closeExtensionPct ?? null,
        tapeSessionPositionPct: tape?.liveConfirmation.sessionPositionPct ?? null,
        tapeSummary: tape?.liveConfirmation.summary ?? null,
        summary: row.summary,
      };
    })
    .filter((row): row is DelayedQuietCandidateRow => Boolean(row));

  const variantStats = delayedQuietCandidateVariants.map((variant) => {
    const candidates = rows.filter(variant.matches);
    const bestForwardValues = candidates.map((row) => row.bestForwardPct);
    const reasonCounts = candidates.reduce<Record<string, number>>((counts, row) => {
      counts[row.missedReason] = (counts[row.missedReason] ?? 0) + 1;
      return counts;
    }, {});
    const tapeCounts = candidates.reduce<Record<string, number>>((counts, row) => {
      const key = row.tapeClassification ?? "no_5m_confirmation";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
    return {
      name: variant.name,
      description: variant.description,
      productionReadiness: variant.productionReadiness,
      candidates: candidates.length,
      meaningfulMoveCount: candidates.filter((row) => row.meaningfulForward).length,
      belowMeaningfulCount: candidates.filter((row) => !row.meaningfulForward).length,
      move50Count: candidates.filter((row) => row.move50).length,
      move100Count: candidates.filter((row) => row.move100).length,
      freshContextCount: candidates.filter((row) => row.freshContext).length,
      meaningfulMoveRate: candidates.length === 0
        ? 0
        : candidates.filter((row) => row.meaningfulForward).length / candidates.length,
      move50Rate: candidates.length === 0 ? 0 : candidates.filter((row) => row.move50).length / candidates.length,
      avgBestForwardPct: bestForwardValues.length === 0
        ? null
        : bestForwardValues.reduce((sum, value) => sum + value, 0) / bestForwardValues.length,
      medianBestForwardPct: median(bestForwardValues),
      reasonCounts,
      tapeCounts,
      topExamples: candidates
        .slice()
        .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
        .slice(0, 14),
      belowThresholdExamples: candidates
        .filter((row) => !row.meaningfulForward)
        .slice()
        .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
        .slice(0, 12),
    };
  });

  const engineTestCandidates = variantStats.filter((stat) =>
    stat.productionReadiness === "candidate_for_engine_test" &&
    stat.candidates >= 4 &&
    stat.meaningfulMoveRate >= 0.6 &&
    stat.belowMeaningfulCount <= Math.max(1, Math.floor(stat.candidates * 0.35))
  );

  return {
    generatedAt: new Date().toISOString(),
    meaningfulMovePct,
    totals: {
      activeRunners: params.activeRunners.length,
      noThesisRows: rows.length,
      noThesisMeaningfulRows: rows.filter((row) => row.meaningfulForward).length,
      noThesisBelowMeaningfulRows: rows.filter((row) => !row.meaningfulForward).length,
      delayedQuietMisses: rows.filter((row) => row.missedReason === "delayed_move_after_quiet_chart").length,
      engineTestCandidates: engineTestCandidates.length,
    },
    recommendation: engineTestCandidates.length > 0
      ? "At least one delayed-quiet variant is strong enough for a targeted engine replay, but keep it QA-only until tested as an actual thesis across more windows."
      : "Do not promote delayed-quiet continuation yet; the current gates are still too noisy or too sparse for trader-facing use.",
    variantStats,
    rows,
  };
}

function renderActiveRunnerDelayedQuietCandidateMarkdown(
  analysis: ReturnType<typeof buildActiveRunnerDelayedQuietCandidateAnalysis>,
): string {
  const lines: string[] = [];
  lines.push("# Active-Runner Delayed Quiet Candidate QA");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- Active-runner cutoffs: ${analysis.totals.activeRunners}`);
  lines.push(`- No-thesis rows evaluated: ${analysis.totals.noThesisRows}`);
  lines.push(`- No-thesis meaningful rows: ${analysis.totals.noThesisMeaningfulRows}`);
  lines.push(`- No-thesis below-threshold rows: ${analysis.totals.noThesisBelowMeaningfulRows}`);
  lines.push(`- Delayed-quiet misses: ${analysis.totals.delayedQuietMisses}`);
  lines.push(`- Meaningful threshold: ${formatPct(analysis.meaningfulMovePct)}`);
  lines.push(`- Recommendation: ${analysis.recommendation}`);
  lines.push("");
  lines.push("## Variant Stats");
  lines.push("");
  for (const stat of analysis.variantStats) {
    lines.push(
      `- ${stat.name}: ${stat.candidates} candidates, meaningful ${stat.meaningfulMoveCount}/${stat.candidates} (${(stat.meaningfulMoveRate * 100).toFixed(1)}%), >=50% ${stat.move50Count}/${stat.candidates} (${(stat.move50Rate * 100).toFixed(1)}%), >=100% ${stat.move100Count}/${stat.candidates}, below-threshold ${stat.belowMeaningfulCount}, fresh context ${stat.freshContextCount}, median best ${stat.medianBestForwardPct === null ? "n/a" : formatPct(stat.medianBestForwardPct)}, avg best ${stat.avgBestForwardPct === null ? "n/a" : formatPct(stat.avgBestForwardPct)}, readiness ${stat.productionReadiness}`,
    );
    lines.push(`  - ${stat.description}`);
    lines.push(`  - Reason mix: ${Object.entries(stat.reasonCounts).map(([reason, count]) => `${reason}=${count}`).join(", ") || "none"}`);
    lines.push(`  - 5m mix: ${Object.entries(stat.tapeCounts).map(([label, count]) => `${label}=${count}`).join(", ") || "none"}`);
  }
  lines.push("");
  lines.push("## Top Examples");
  lines.push("");
  for (const stat of analysis.variantStats) {
    lines.push(`### ${stat.name}`);
    if (stat.topExamples.length === 0) {
      lines.push("- No candidates.");
    } else {
      for (const row of stat.topExamples) {
        lines.push(
          `- ${row.runnerDate} ${row.symbol}: best ${formatPct(row.bestForwardPct)}, prior range ${row.priorRangePct === null ? "n/a" : formatPct(row.priorRangePct)}, position ${row.priorRangePositionPct === null ? "n/a" : `${row.priorRangePositionPct.toFixed(1)}%`}, shelf extension ${row.shelfExtensionPct === null ? "n/a" : formatPct(row.shelfExtensionPct)}, latest range ${row.latestRangePct === null ? "n/a" : formatPct(row.latestRangePct)}, close ratio ${row.latestCloseRatio === null ? "n/a" : row.latestCloseRatio.toFixed(2)}, 5m ${row.tapeClassification ?? "n/a"}, local ${row.localCatalyst}, card ${row.catalystCard}, reason ${row.missedReason}`,
        );
        if (row.tapeSummary) {
          lines.push(`  - ${row.tapeSummary}`);
        }
      }
    }
    if (stat.belowThresholdExamples.length > 0) {
      lines.push(`  - Highest below-threshold examples: ${stat.belowThresholdExamples.map((row) => `${row.symbol} ${formatPct(row.bestForwardPct)}`).join(", ")}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

type ExternalNewsCatalystEnrichmentMode = {
  name: string;
  description: string;
  include: (row: ReturnType<typeof buildActiveRunnerExternalNewsCatalystAnalysis>["rows"][number]) => boolean;
};

type StockTitanCatalystEnrichmentMode = {
  name: string;
  description: string;
  include: (row: ReturnType<typeof buildActiveRunnerStockTitanCatalystAnalysis>["rows"][number]) => boolean;
};

type EnrichedCatalystReplayRow = Pick<
  ActiveRunnerNewsBurstCandidateRow,
  "symbol" | "activeCutoffTimestamp" | "bestForwardPct"
>;

const externalNewsCatalystEnrichmentModes: ExternalNewsCatalystEnrichmentMode[] = [
  {
    name: "strong_same_day_only",
    description: "Treat only strong ticker-specific same-day EODHD news as same-day catalyst context.",
    include: (row) =>
      row.evidenceQuality === "strong_ticker_catalyst" &&
      (row.eodhdNews.label === "same_day_premarket_news" || row.eodhdNews.label === "same_day_market_or_after_news"),
  },
  {
    name: "strong_same_day_or_prior_evening",
    description: "Treat strong ticker-specific same-day or prior-evening EODHD news as active catalyst context.",
    include: (row) =>
      row.evidenceQuality === "strong_ticker_catalyst" &&
      hasTradeDayOrPriorEveningNews(row.eodhdNews.label),
  },
];

const stockTitanCatalystEnrichmentModes: StockTitanCatalystEnrichmentMode[] = [
  {
    name: "stocktitan_ticker_same_day_only",
    description: "Treat only StockTitan ticker-page same-day catalyst rows as same-day catalyst context.",
    include: (row) =>
      row.evidenceQuality === "ticker_page_catalyst" &&
      (
        row.stockTitanNews.label === "same_day_premarket_stocktitan" ||
        row.stockTitanNews.label === "same_day_market_or_after_stocktitan"
      ),
  },
  {
    name: "stocktitan_ticker_same_day_or_prior_evening",
    description: "Treat StockTitan ticker-page same-day or prior-evening catalyst rows as active catalyst context.",
    include: (row) =>
      row.evidenceQuality === "ticker_page_catalyst" &&
      hasTradeDayOrPriorEveningStockTitan(row.stockTitanNews.label),
  },
];

function reportSampleKey(row: Pick<ChartThesisQaSample, "symbol" | "cutoffTimestamp">): string {
  return `${row.symbol.toUpperCase()}:${row.cutoffTimestamp}`;
}

function buildEnrichedActiveRunnerContext<Row extends EnrichedCatalystReplayRow>(params: {
  baseContext: Record<string, { activeRunner: true; catalystCardFreshness: CatalystCardFreshnessLabel }>;
  rows: Row[];
  include: (row: Row) => boolean;
}): {
  context: Record<string, { activeRunner: true; catalystCardFreshness: CatalystCardFreshnessLabel }>;
  enrichedRows: Row[];
} {
  const context = Object.fromEntries(
    Object.entries(params.baseContext).map(([key, value]) => [key, { ...value }]),
  ) as Record<string, { activeRunner: true; catalystCardFreshness: CatalystCardFreshnessLabel }>;
  const enrichedRows = params.rows.filter(params.include);
  for (const row of enrichedRows) {
    context[`${row.symbol.toUpperCase()}:${row.activeCutoffTimestamp}`] = {
      activeRunner: true,
      catalystCardFreshness: "same_day",
    };
  }
  return { context, enrichedRows };
}

function summarizeEnrichedActiveRunnerReport(params: {
  mode: { name: string; description: string };
  baselineReport: ChartThesisQaReport;
  enrichedReport: ChartThesisQaReport;
  enrichedRows: EnrichedCatalystReplayRow[];
}) {
  const baselineSampleKeys = new Set(params.baselineReport.samples.map(reportSampleKey));
  const enrichedKeys = new Set(
    params.enrichedRows.map((row) => `${row.symbol.toUpperCase()}:${row.activeCutoffTimestamp}`),
  );
  const newSamples = params.enrichedReport.samples
    .filter((sample) => !baselineSampleKeys.has(reportSampleKey(sample)))
    .filter((sample) => enrichedKeys.has(reportSampleKey(sample)));
  const newCatalystSamples = newSamples.filter((sample) => sample.thesis?.type === "catalyst_active_runner_continuation");
  const newUsefulSamples = newSamples.filter((sample) =>
    sample.outcome === "hit_target" || sample.outcome === "partial_progress"
  );
  const newInvalidatedSamples = newSamples.filter((sample) => sample.outcome === "invalidated");
  const enrichedRowKeys = new Set(newSamples.map(reportSampleKey));
  const enrichedRowsWithNoNewSample = params.enrichedRows.filter((row) =>
    !enrichedRowKeys.has(`${row.symbol.toUpperCase()}:${row.activeCutoffTimestamp}`)
  );

  return {
    name: params.mode.name,
    description: params.mode.description,
    totals: {
      enrichedCatalystRows: params.enrichedRows.length,
      baselineThesisSamples: params.baselineReport.totals.samplesWithThesis,
      enrichedThesisSamples: params.enrichedReport.totals.samplesWithThesis,
      deltaThesisSamples: params.enrichedReport.totals.samplesWithThesis - params.baselineReport.totals.samplesWithThesis,
      baselineHitTarget: params.baselineReport.totals.hitTarget,
      enrichedHitTarget: params.enrichedReport.totals.hitTarget,
      deltaHitTarget: params.enrichedReport.totals.hitTarget - params.baselineReport.totals.hitTarget,
      baselinePartialProgress: params.baselineReport.totals.partialProgress,
      enrichedPartialProgress: params.enrichedReport.totals.partialProgress,
      deltaPartialProgress: params.enrichedReport.totals.partialProgress - params.baselineReport.totals.partialProgress,
      baselineInvalidated: params.baselineReport.totals.invalidated,
      enrichedInvalidated: params.enrichedReport.totals.invalidated,
      deltaInvalidated: params.enrichedReport.totals.invalidated - params.baselineReport.totals.invalidated,
      baselineMissedMeaningfulMoves: params.baselineReport.totals.missedMeaningfulMoves,
      enrichedMissedMeaningfulMoves: params.enrichedReport.totals.missedMeaningfulMoves,
      deltaMissedMeaningfulMoves: params.enrichedReport.totals.missedMeaningfulMoves - params.baselineReport.totals.missedMeaningfulMoves,
      newSamples: newSamples.length,
      newCatalystSamples: newCatalystSamples.length,
      newUsefulSamples: newUsefulSamples.length,
      newInvalidatedSamples: newInvalidatedSamples.length,
      enrichedRowsWithNoNewSample: enrichedRowsWithNoNewSample.length,
    },
    thesisStats: params.enrichedReport.thesisStats,
    newSamples: newSamples
      .slice()
      .sort((left, right) => right.bestForwardPct - left.bestForwardPct),
    enrichedRowsWithNoNewSample,
  };
}

function renderExternalNewsEnrichedReplayMarkdown(
  analysis: ReturnType<typeof buildExternalNewsEnrichedReplayAnalysis>,
): string {
  const lines: string[] = [];
  lines.push("# Active-Runner External News Enriched Replay QA");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- Baseline thesis samples: ${analysis.baseline.totals.samplesWithThesis}`);
  lines.push(`- Baseline hit/partial/invalidated: ${analysis.baseline.totals.hitTarget}/${analysis.baseline.totals.partialProgress}/${analysis.baseline.totals.invalidated}`);
  lines.push(`- Baseline missed meaningful moves: ${analysis.baseline.totals.missedMeaningfulMoves}`);
  lines.push(`- Recommendation: ${analysis.recommendation}`);
  lines.push("");
  lines.push("## Replay Modes");
  lines.push("");
  for (const mode of analysis.modes) {
    lines.push(`### ${mode.name}`);
    lines.push(`- ${mode.description}`);
    lines.push(`- Enriched catalyst rows: ${mode.totals.enrichedCatalystRows}`);
    lines.push(`- Thesis samples: ${mode.totals.enrichedThesisSamples} (${mode.totals.deltaThesisSamples >= 0 ? "+" : ""}${mode.totals.deltaThesisSamples})`);
    lines.push(`- Hit target: ${mode.totals.enrichedHitTarget} (${mode.totals.deltaHitTarget >= 0 ? "+" : ""}${mode.totals.deltaHitTarget})`);
    lines.push(`- Partial progress: ${mode.totals.enrichedPartialProgress} (${mode.totals.deltaPartialProgress >= 0 ? "+" : ""}${mode.totals.deltaPartialProgress})`);
    lines.push(`- Invalidated: ${mode.totals.enrichedInvalidated} (${mode.totals.deltaInvalidated >= 0 ? "+" : ""}${mode.totals.deltaInvalidated})`);
    lines.push(`- Missed meaningful moves: ${mode.totals.enrichedMissedMeaningfulMoves} (${mode.totals.deltaMissedMeaningfulMoves >= 0 ? "+" : ""}${mode.totals.deltaMissedMeaningfulMoves})`);
    lines.push(`- New samples from enriched rows: ${mode.totals.newSamples}; useful ${mode.totals.newUsefulSamples}, invalidated ${mode.totals.newInvalidatedSamples}, catalyst thesis ${mode.totals.newCatalystSamples}`);
    if (mode.newSamples.length > 0) {
      lines.push("  - New sample examples:");
      for (const sample of mode.newSamples.slice(0, 12)) {
        lines.push(
          `    - ${sample.cutoffIso.slice(0, 10)} ${sample.symbol}: ${sample.thesis?.type ?? "unknown"}, outcome ${sample.outcome}, best ${formatPct(sample.bestForwardPct)}, room ${sample.roomToTargetPct === null ? "n/a" : formatPct(sample.roomToTargetPct)}`,
        );
      }
    }
    if (mode.enrichedRowsWithNoNewSample.length > 0) {
      lines.push(`  - Enriched rows that still did not produce a new thesis: ${mode.enrichedRowsWithNoNewSample.slice(0, 12).map((row) => `${row.symbol} ${formatPct(row.bestForwardPct)}`).join(", ")}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function buildExternalNewsEnrichedReplayAnalysis(params: {
  baselineReport: ChartThesisQaReport;
  modeSummaries: ReturnType<typeof summarizeEnrichedActiveRunnerReport>[];
}) {
  const bestMode = params.modeSummaries
    .slice()
    .sort((left, right) =>
      right.totals.newUsefulSamples - left.totals.newUsefulSamples ||
      left.totals.newInvalidatedSamples - right.totals.newInvalidatedSamples ||
      right.totals.deltaThesisSamples - left.totals.deltaThesisSamples,
    )[0] ?? null;
  const recommendation = bestMode && bestMode.totals.newUsefulSamples > 0
    ? "External catalyst enrichment improves replay coverage; next production work should enrich catalyst context before loosening chart-only thesis gates."
    : "External catalyst enrichment did not add useful active-runner thesis samples in this replay; keep this as QA evidence only.";
  return {
    generatedAt: new Date().toISOString(),
    baseline: params.baselineReport,
    recommendation,
    bestMode: bestMode?.name ?? null,
    modes: params.modeSummaries,
  };
}

type ClearedShelfCandidateVariant = {
  name: string;
  minPriorRangePct: number;
  maxPriorRangePct: number;
  minPositionPct: number;
  maxPositionPct: number;
  minShelfExtensionPct: number;
  maxShelfExtensionPct: number;
};

const clearedShelfCandidateVariants: ClearedShelfCandidateVariant[] = [
  {
    name: "cleared_shelf_continuation_power",
    minPriorRangePct: 5,
    maxPriorRangePct: 12,
    minPositionPct: 400,
    maxPositionPct: 1200,
    minShelfExtensionPct: 1,
    maxShelfExtensionPct: 220,
  },
  {
    name: "cleared_shelf_continuation_strict",
    minPriorRangePct: 5,
    maxPriorRangePct: 25,
    minPositionPct: 105,
    maxPositionPct: 700,
    minShelfExtensionPct: 1,
    maxShelfExtensionPct: 90,
  },
  {
    name: "cleared_shelf_continuation_wide",
    minPriorRangePct: 5,
    maxPriorRangePct: 25,
    minPositionPct: 105,
    maxPositionPct: 1400,
    minShelfExtensionPct: 1,
    maxShelfExtensionPct: 250,
  },
  {
    name: "cleared_shelf_continuation_tight_range",
    minPriorRangePct: 5,
    maxPriorRangePct: 18,
    minPositionPct: 110,
    maxPositionPct: 1400,
    minShelfExtensionPct: 1,
    maxShelfExtensionPct: 250,
  },
];

function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function computeShelfExtensionPct(row: {
  currentPrice: number;
  priorRangePct: number | null;
  priorRangePositionPct: number | null;
}): number | null {
  if (
    row.priorRangePct === null ||
    row.priorRangePositionPct === null ||
    row.currentPrice <= 0 ||
    row.priorRangePct <= 0
  ) {
    return null;
  }

  const range = row.currentPrice * (row.priorRangePct / 100);
  const priorLow = row.currentPrice - range * (row.priorRangePositionPct / 100);
  const priorHigh = priorLow + range;
  if (!Number.isFinite(priorHigh) || priorHigh <= 0) {
    return null;
  }
  return ((row.currentPrice - priorHigh) / priorHigh) * 100;
}

function passesClearedShelfVariant(row: {
  priorRangePct: number | null;
  priorRangePositionPct: number | null;
  shelfExtensionPct: number | null;
}, variant: ClearedShelfCandidateVariant): boolean {
  return (
    row.priorRangePct !== null &&
    row.priorRangePositionPct !== null &&
    row.shelfExtensionPct !== null &&
    row.priorRangePct >= variant.minPriorRangePct &&
    row.priorRangePct <= variant.maxPriorRangePct &&
    row.priorRangePositionPct >= variant.minPositionPct &&
    row.priorRangePositionPct <= variant.maxPositionPct &&
    row.shelfExtensionPct >= variant.minShelfExtensionPct &&
    row.shelfExtensionPct <= variant.maxShelfExtensionPct
  );
}

function buildActiveRunnerClearedShelfCandidateAnalysis(params: {
  activeRunners: SelectedRunner[];
  report: ChartThesisQaReport;
}) {
  const noThesisRows = [
    ...params.report.missedMoves,
    ...(params.report.noThesisBelowMeaningfulForwardRows ?? []),
  ];
  const noThesisByKey = new Map(noThesisRows.map((row) => [`${row.symbol}:${row.cutoffTimestamp}`, row]));
  const meaningfulMovePct = params.report.settings.meaningfulMovePct;
  const rows = params.activeRunners
    .map((runner) => {
      const key = `${runner.symbol}:${runner.activeCutoffTimestamp}`;
      const row = noThesisByKey.get(key);
      if (!row) {
        return null;
      }
      const shelfExtensionPct = computeShelfExtensionPct(row);
      const variants = clearedShelfCandidateVariants
        .filter((variant) => passesClearedShelfVariant({ ...row, shelfExtensionPct }, variant))
        .map((variant) => variant.name);
      return {
        symbol: runner.symbol,
        runnerDate: runner.runnerDate,
        activeCutoffTimestamp: runner.activeCutoffTimestamp,
        activeCutoffIso: runner.activeCutoffIso,
        catalystCard: runner.catalystCard?.label ?? "lookup_unavailable",
        currentPrice: row.currentPrice,
        bestForwardPct: row.bestForwardPct,
        meaningfulForward: row.bestForwardPct >= meaningfulMovePct,
        move50: row.bestForwardPct >= 50,
        move100: row.bestForwardPct >= 100,
        missedReason: row.bestForwardPct >= meaningfulMovePct ? row.reason : "below_meaningful_forward",
        priorRangePct: row.priorRangePct,
        priorRangePositionPct: row.priorRangePositionPct,
        shelfExtensionPct,
        firstForwardGapPct: row.firstForwardGapPct,
        firstForwardRangePct: row.firstForwardRangePct,
        candidateVariants: variants,
        summary: row.summary,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const variantStats = clearedShelfCandidateVariants.map((variant) => {
    const candidates = rows.filter((row) => row.candidateVariants.includes(variant.name));
    const bestForwardValues = candidates.map((row) => row.bestForwardPct);
    const reasonCounts = candidates.reduce<Record<string, number>>((counts, row) => {
      counts[row.missedReason] = (counts[row.missedReason] ?? 0) + 1;
      return counts;
    }, {});
    return {
      name: variant.name,
      settings: variant,
      candidates: candidates.length,
      meaningfulMoveCount: candidates.filter((row) => row.meaningfulForward).length,
      belowMeaningfulCount: candidates.filter((row) => !row.meaningfulForward).length,
      move50Count: candidates.filter((row) => row.move50).length,
      move100Count: candidates.filter((row) => row.move100).length,
      meaningfulMoveRate: candidates.length === 0
        ? 0
        : candidates.filter((row) => row.meaningfulForward).length / candidates.length,
      move50Rate: candidates.length === 0 ? 0 : candidates.filter((row) => row.move50).length / candidates.length,
      avgBestForwardPct: bestForwardValues.length === 0
        ? null
        : bestForwardValues.reduce((sum, value) => sum + value, 0) / bestForwardValues.length,
      medianBestForwardPct: median(bestForwardValues),
      reasonCounts,
      topExamples: candidates
        .slice()
        .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
        .slice(0, 12),
      quietFalsePositiveExamples: candidates
        .filter((row) => !row.meaningfulForward)
        .slice()
        .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
        .slice(0, 12),
    };
  });

  const preferred = variantStats
    .slice()
    .sort((left, right) =>
      right.meaningfulMoveRate - left.meaningfulMoveRate ||
      right.meaningfulMoveCount - left.meaningfulMoveCount ||
      right.move50Count - left.move50Count,
    )[0] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    meaningfulMovePct,
    totals: {
      activeRunners: params.activeRunners.length,
      noThesisRows: rows.length,
      noThesisMeaningfulRows: rows.filter((row) => row.meaningfulForward).length,
      noThesisBelowMeaningfulRows: rows.filter((row) => !row.meaningfulForward).length,
    },
    preferredVariant: preferred?.name ?? null,
    variantStats,
    rows,
  };
}

function renderActiveRunnerClearedShelfCandidateMarkdown(
  analysis: ReturnType<typeof buildActiveRunnerClearedShelfCandidateAnalysis>,
): string {
  const lines: string[] = [];
  lines.push("# Active-Runner Cleared Shelf Candidate QA");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- Active-runner cutoffs: ${analysis.totals.activeRunners}`);
  lines.push(`- No-thesis rows evaluated: ${analysis.totals.noThesisRows}`);
  lines.push(`- No-thesis meaningful rows: ${analysis.totals.noThesisMeaningfulRows}`);
  lines.push(`- No-thesis below-threshold rows: ${analysis.totals.noThesisBelowMeaningfulRows}`);
  lines.push(`- Meaningful threshold: ${formatPct(analysis.meaningfulMovePct)}`);
  lines.push(`- Preferred QA variant: ${analysis.preferredVariant ?? "none"}`);
  lines.push("");
  lines.push("## Variant Stats");
  lines.push("");
  for (const stat of analysis.variantStats) {
    lines.push(
      `- ${stat.name}: ${stat.candidates} candidates, meaningful ${stat.meaningfulMoveCount}/${stat.candidates} (${(stat.meaningfulMoveRate * 100).toFixed(1)}%), >=50% ${stat.move50Count}/${stat.candidates} (${(stat.move50Rate * 100).toFixed(1)}%), >=100% ${stat.move100Count}/${stat.candidates}, below-threshold ${stat.belowMeaningfulCount}, median best ${stat.medianBestForwardPct === null ? "n/a" : formatPct(stat.medianBestForwardPct)}, avg best ${stat.avgBestForwardPct === null ? "n/a" : formatPct(stat.avgBestForwardPct)}`,
    );
    lines.push(`  - Reason mix: ${Object.entries(stat.reasonCounts).map(([reason, count]) => `${reason}=${count}`).join(", ") || "none"}`);
  }
  lines.push("");
  lines.push("## Top Candidate Examples");
  lines.push("");
  for (const stat of analysis.variantStats) {
    lines.push(`### ${stat.name}`);
    if (stat.topExamples.length === 0) {
      lines.push("- No candidates.");
    } else {
      for (const row of stat.topExamples) {
        lines.push(
          `- ${row.runnerDate} ${row.symbol}: best ${formatPct(row.bestForwardPct)}, prior range ${row.priorRangePct === null ? "n/a" : formatPct(row.priorRangePct)}, position ${row.priorRangePositionPct === null ? "n/a" : `${row.priorRangePositionPct.toFixed(1)}%`}, shelf extension ${row.shelfExtensionPct === null ? "n/a" : formatPct(row.shelfExtensionPct)}, card ${row.catalystCard}, reason ${row.missedReason}`,
        );
      }
    }
    if (stat.quietFalsePositiveExamples.length > 0) {
      lines.push(`  - Highest below-threshold examples: ${stat.quietFalsePositiveExamples.map((row) => `${row.symbol} ${formatPct(row.bestForwardPct)}`).join(", ")}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

type UpperRangeCandidateVariant = {
  name: string;
  description: string;
  productionReadiness: "qa_only" | "candidate_for_engine_test" | "reject_noisy";
  matches: (row: UpperRangeCandidateRow) => boolean;
};

type UpperRangeCandidateRow = {
  symbol: string;
  runnerDate: string;
  activeCutoffTimestamp: number;
  activeCutoffIso: string;
  catalystCard: CatalystCardFreshnessLabel;
  localCatalyst: RunnerCatalystLabel | "not_checked";
  freshContext: boolean;
  currentPrice: number;
  bestForwardPct: number;
  meaningfulForward: boolean;
  move50: boolean;
  move100: boolean;
  missedReason: string;
  priorRangePct: number | null;
  priorRangePositionPct: number | null;
  shelfExtensionPct: number | null;
  firstForwardGapPct: number | null;
  firstForwardRangePct: number | null;
  upperRangeNearMissScore: number | null;
  upperRangeBlockers: string[];
  latestCloseRatio: number | null;
  tapeClassification: string | null;
  tapeVolumeRatio: number | null;
  tapeLatestRangePct: number | null;
  tapeCloseExtensionPct: number | null;
  tapeSessionPositionPct: number | null;
  tapeSummary: string | null;
  summary: string;
};

function hasFreshRunnerContext(runner: SelectedRunner): boolean {
  return (
    runner.catalystCard?.label === "same_day" ||
    (runner.catalyst ? hasFreshLocalPressReleaseLabel(runner.catalyst.label) : false)
  );
}

function hasUpperRangeStructure(row: UpperRangeCandidateRow): boolean {
  return (
    row.priorRangePct !== null &&
    row.priorRangePositionPct !== null &&
    row.priorRangePct >= 8 &&
    row.priorRangePct <= 28 &&
    row.priorRangePositionPct >= 55 &&
    row.priorRangePositionPct <= 180
  );
}

function hasConstructiveFiveMinuteParticipation(row: UpperRangeCandidateRow): boolean {
  return (
    row.tapeClassification !== null &&
    row.tapeClassification !== "hot_but_extended" &&
    (row.tapeVolumeRatio ?? 0) >= 2 &&
    (row.tapeLatestRangePct ?? 0) >= 4 &&
    (row.tapeLatestRangePct ?? Number.POSITIVE_INFINITY) <= 20 &&
    (row.tapeCloseExtensionPct ?? Number.POSITIVE_INFINITY) <= 12
  );
}

function hasControlledHotFiveMinuteParticipation(row: UpperRangeCandidateRow): boolean {
  return (
    row.tapeClassification === "hot_but_extended" &&
    (row.tapeVolumeRatio ?? 0) >= 2 &&
    (row.tapeVolumeRatio ?? Number.POSITIVE_INFINITY) <= 25 &&
    (row.tapeLatestRangePct ?? 0) >= 4 &&
    (row.tapeLatestRangePct ?? Number.POSITIVE_INFINITY) <= 18 &&
    (row.tapeCloseExtensionPct ?? 0) >= 6 &&
    (row.tapeCloseExtensionPct ?? Number.POSITIVE_INFINITY) <= 45 &&
    (row.tapeSessionPositionPct ?? 0) >= 70 &&
    (row.tapeSessionPositionPct ?? Number.POSITIVE_INFINITY) <= 260
  );
}

function hasConstructiveUpperRangeClose(row: UpperRangeCandidateRow): boolean {
  return (row.latestCloseRatio ?? 0) >= 0.45;
}

function isNotOverextendedAboveUpperRange(row: UpperRangeCandidateRow): boolean {
  return (row.shelfExtensionPct ?? Number.NEGATIVE_INFINITY) <= 15;
}

const upperRangeCandidateVariants: UpperRangeCandidateVariant[] = [
  {
    name: "strict_disabled_upper_ignition",
    description: "Rows that clear the existing disabled upper-range ignition gate exactly, based on the rejection audit.",
    productionReadiness: "qa_only",
    matches: (row) => row.upperRangeNearMissScore === 1,
  },
  {
    name: "possible_upper_range_core",
    description: "Upper-half 4h setup: prior range 8%-28%, price in or modestly above the prior range, no 5m confirmation required.",
    productionReadiness: "reject_noisy",
    matches: hasUpperRangeStructure,
  },
  {
    name: "constructive_upper_range",
    description: "Core upper-range setup with a constructive 4h close.",
    productionReadiness: "qa_only",
    matches: (row) => hasUpperRangeStructure(row) && hasConstructiveUpperRangeClose(row),
  },
  {
    name: "constructive_upper_range_not_overextended",
    description: "Core upper-range setup with a constructive 4h close and no more than 15% extension above the prior range high.",
    productionReadiness: "candidate_for_engine_test",
    matches: (row) =>
      hasUpperRangeStructure(row) &&
      hasConstructiveUpperRangeClose(row) &&
      isNotOverextendedAboveUpperRange(row),
  },
  {
    name: "constructive_upper_range_no_hot_5m",
    description: "Constructive upper-range setup that excludes hot-but-extended 5m tape, used as a chase-risk control.",
    productionReadiness: "qa_only",
    matches: (row) =>
      hasUpperRangeStructure(row) &&
      hasConstructiveUpperRangeClose(row) &&
      row.tapeClassification !== "hot_but_extended",
  },
  {
    name: "upper_range_constructive_5m",
    description: "Core upper-range setup with actionable 5m participation near the trigger, excluding hot-but-extended tape.",
    productionReadiness: "candidate_for_engine_test",
    matches: (row) => hasUpperRangeStructure(row) && hasConstructiveFiveMinuteParticipation(row),
  },
  {
    name: "upper_range_controlled_hot_5m",
    description: "Core upper-range setup with hot but still controlled 5m participation, avoiding extreme volume and far-above-trigger chase.",
    productionReadiness: "qa_only",
    matches: (row) => hasUpperRangeStructure(row) && hasControlledHotFiveMinuteParticipation(row),
  },
  {
    name: "fresh_upper_range_5m",
    description: "Core upper-range setup with fresh same-day/prior-evening catalyst context and either constructive or controlled-hot 5m participation.",
    productionReadiness: "candidate_for_engine_test",
    matches: (row) =>
      hasUpperRangeStructure(row) &&
      row.freshContext &&
      (hasConstructiveFiveMinuteParticipation(row) || hasControlledHotFiveMinuteParticipation(row)),
  },
];

function buildActiveRunnerUpperRangeCandidateAnalysis(params: {
  activeRunners: SelectedRunner[];
  report: ChartThesisQaReport;
  tapeAudit: ReturnType<typeof buildFiveMinuteTapeParticipationAudit>;
}) {
  const noThesisRows = [
    ...params.report.missedMoves,
    ...(params.report.noThesisBelowMeaningfulForwardRows ?? []),
  ];
  const noThesisByKey = new Map(noThesisRows.map((row) => [`${row.symbol}:${row.cutoffTimestamp}`, row]));
  const tapeByKey = new Map(params.tapeAudit.rows.map((row) => [`${row.symbol}:${row.cutoffTimestamp}`, row]));
  const meaningfulMovePct = params.report.settings.meaningfulMovePct;
  const rows: UpperRangeCandidateRow[] = params.activeRunners
    .map((runner) => {
      const key = `${runner.symbol}:${runner.activeCutoffTimestamp}`;
      const row = noThesisByKey.get(key);
      if (!row || runner.activeCutoffIso === null || runner.activeCutoffTimestamp === null) {
        return null;
      }
      const tape = tapeByKey.get(key);
      const upperRange = row.rejectionAudit.thesisRejections.find((item) =>
        item.thesisType === "upper_range_ignition"
      );
      const shelfExtensionPct = computeShelfExtensionPct(row);
      const candidate: UpperRangeCandidateRow = {
        symbol: runner.symbol,
        runnerDate: runner.runnerDate,
        activeCutoffTimestamp: runner.activeCutoffTimestamp,
        activeCutoffIso: runner.activeCutoffIso,
        catalystCard: runner.catalystCard?.label ?? "lookup_unavailable",
        localCatalyst: runner.catalyst?.label ?? "not_checked",
        freshContext: hasFreshRunnerContext(runner),
        currentPrice: row.currentPrice,
        bestForwardPct: row.bestForwardPct,
        meaningfulForward: row.bestForwardPct >= meaningfulMovePct,
        move50: row.bestForwardPct >= 50,
        move100: row.bestForwardPct >= 100,
        missedReason: row.bestForwardPct >= meaningfulMovePct ? row.reason : "below_meaningful_forward",
        priorRangePct: row.priorRangePct,
        priorRangePositionPct: row.priorRangePositionPct,
        shelfExtensionPct,
        firstForwardGapPct: row.firstForwardGapPct,
        firstForwardRangePct: row.firstForwardRangePct,
        upperRangeNearMissScore: upperRange?.nearMissScore ?? null,
        upperRangeBlockers: upperRange?.blockers ?? [],
        latestCloseRatio: numberDiagnostic(upperRange?.diagnostics.latestCloseRatio),
        tapeClassification: tape?.classification ?? null,
        tapeVolumeRatio: tape?.liveConfirmation.volumeRatio ?? null,
        tapeLatestRangePct: tape?.liveConfirmation.latestRangePct ?? null,
        tapeCloseExtensionPct: tape?.liveConfirmation.closeExtensionPct ?? null,
        tapeSessionPositionPct: tape?.liveConfirmation.sessionPositionPct ?? null,
        tapeSummary: tape?.liveConfirmation.summary ?? null,
        summary: row.summary,
      };
      return candidate;
    })
    .filter((row): row is UpperRangeCandidateRow => Boolean(row));

  const variantStats = upperRangeCandidateVariants.map((variant) => {
    const candidates = rows.filter(variant.matches);
    const bestForwardValues = candidates.map((row) => row.bestForwardPct);
    const reasonCounts = candidates.reduce<Record<string, number>>((counts, row) => {
      counts[row.missedReason] = (counts[row.missedReason] ?? 0) + 1;
      return counts;
    }, {});
    const tapeCounts = candidates.reduce<Record<string, number>>((counts, row) => {
      const key = row.tapeClassification ?? "no_5m_confirmation";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
    return {
      name: variant.name,
      description: variant.description,
      productionReadiness: variant.productionReadiness,
      candidates: candidates.length,
      meaningfulMoveCount: candidates.filter((row) => row.meaningfulForward).length,
      belowMeaningfulCount: candidates.filter((row) => !row.meaningfulForward).length,
      move50Count: candidates.filter((row) => row.move50).length,
      move100Count: candidates.filter((row) => row.move100).length,
      freshContextCount: candidates.filter((row) => row.freshContext).length,
      meaningfulMoveRate: candidates.length === 0
        ? 0
        : candidates.filter((row) => row.meaningfulForward).length / candidates.length,
      move50Rate: candidates.length === 0 ? 0 : candidates.filter((row) => row.move50).length / candidates.length,
      avgBestForwardPct: bestForwardValues.length === 0
        ? null
        : bestForwardValues.reduce((sum, value) => sum + value, 0) / bestForwardValues.length,
      medianBestForwardPct: median(bestForwardValues),
      reasonCounts,
      tapeCounts,
      topExamples: candidates
        .slice()
        .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
        .slice(0, 14),
      belowThresholdExamples: candidates
        .filter((row) => !row.meaningfulForward)
        .slice()
        .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
        .slice(0, 12),
    };
  });

  const engineTestCandidates = variantStats.filter((stat) =>
    stat.productionReadiness === "candidate_for_engine_test" &&
    stat.candidates >= 4 &&
    stat.meaningfulMoveRate >= 0.6 &&
    stat.belowMeaningfulCount <= Math.max(1, Math.floor(stat.candidates * 0.35))
  );

  return {
    generatedAt: new Date().toISOString(),
    meaningfulMovePct,
    totals: {
      activeRunners: params.activeRunners.length,
      noThesisRows: rows.length,
      noThesisMeaningfulRows: rows.filter((row) => row.meaningfulForward).length,
      noThesisBelowMeaningfulRows: rows.filter((row) => !row.meaningfulForward).length,
      possibleUpperRangeMisses: rows.filter((row) => row.missedReason === "possible_upper_range_setup").length,
      engineTestCandidates: engineTestCandidates.length,
    },
    recommendation: engineTestCandidates.length > 0
      ? "A 5m-confirmed upper-range variant is strong enough for a targeted engine test, but keep it out of the live approved set until replayed as an actual thesis."
      : "Do not promote upper-range ignition yet; the upper-range bucket still needs a cleaner 5m/context gate before trader-facing use.",
    variantStats,
    rows,
  };
}

function renderActiveRunnerUpperRangeCandidateMarkdown(
  analysis: ReturnType<typeof buildActiveRunnerUpperRangeCandidateAnalysis>,
): string {
  const lines: string[] = [];
  lines.push("# Active-Runner Upper-Range Candidate QA");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- Active-runner cutoffs: ${analysis.totals.activeRunners}`);
  lines.push(`- No-thesis rows evaluated: ${analysis.totals.noThesisRows}`);
  lines.push(`- No-thesis meaningful rows: ${analysis.totals.noThesisMeaningfulRows}`);
  lines.push(`- No-thesis below-threshold rows: ${analysis.totals.noThesisBelowMeaningfulRows}`);
  lines.push(`- Possible upper-range misses: ${analysis.totals.possibleUpperRangeMisses}`);
  lines.push(`- Meaningful threshold: ${formatPct(analysis.meaningfulMovePct)}`);
  lines.push(`- Recommendation: ${analysis.recommendation}`);
  lines.push("");
  lines.push("## Variant Stats");
  lines.push("");
  for (const stat of analysis.variantStats) {
    lines.push(
      `- ${stat.name}: ${stat.candidates} candidates, meaningful ${stat.meaningfulMoveCount}/${stat.candidates} (${(stat.meaningfulMoveRate * 100).toFixed(1)}%), >=50% ${stat.move50Count}/${stat.candidates} (${(stat.move50Rate * 100).toFixed(1)}%), >=100% ${stat.move100Count}/${stat.candidates}, below-threshold ${stat.belowMeaningfulCount}, fresh context ${stat.freshContextCount}, median best ${stat.medianBestForwardPct === null ? "n/a" : formatPct(stat.medianBestForwardPct)}, avg best ${stat.avgBestForwardPct === null ? "n/a" : formatPct(stat.avgBestForwardPct)}, readiness ${stat.productionReadiness}`,
    );
    lines.push(`  - ${stat.description}`);
    lines.push(`  - Reason mix: ${Object.entries(stat.reasonCounts).map(([reason, count]) => `${reason}=${count}`).join(", ") || "none"}`);
    lines.push(`  - 5m mix: ${Object.entries(stat.tapeCounts).map(([label, count]) => `${label}=${count}`).join(", ") || "none"}`);
  }
  lines.push("");
  lines.push("## Top Examples");
  lines.push("");
  for (const stat of analysis.variantStats) {
    lines.push(`### ${stat.name}`);
    if (stat.topExamples.length === 0) {
      lines.push("- No candidates.");
    } else {
      for (const row of stat.topExamples) {
        lines.push(
          `- ${row.runnerDate} ${row.symbol}: best ${formatPct(row.bestForwardPct)}, prior range ${row.priorRangePct === null ? "n/a" : formatPct(row.priorRangePct)}, position ${row.priorRangePositionPct === null ? "n/a" : `${row.priorRangePositionPct.toFixed(1)}%`}, shelf extension ${row.shelfExtensionPct === null ? "n/a" : formatPct(row.shelfExtensionPct)}, 5m ${row.tapeClassification ?? "n/a"}, local ${row.localCatalyst}, card ${row.catalystCard}, reason ${row.missedReason}`,
        );
        if (row.tapeSummary) {
          lines.push(`  - ${row.tapeSummary}`);
        }
      }
    }
    if (stat.belowThresholdExamples.length > 0) {
      lines.push(`  - Highest below-threshold examples: ${stat.belowThresholdExamples.map((row) => `${row.symbol} ${formatPct(row.bestForwardPct)}`).join(", ")}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderEodhdNewsCatalystAnalysisMarkdown(analysis: ReturnType<typeof buildEodhdNewsCatalystAnalysis>): string {
  const lines: string[] = [];
  lines.push("# EODHD News Catalyst Analysis");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- Enabled: ${analysis.lookup.enabled ? "yes" : "no"}`);
  lines.push(`- Available: ${analysis.lookup.available ? "yes" : "no"}`);
  if (analysis.lookup.error) {
    lines.push(`- Lookup note: \`${analysis.lookup.error}\``);
  }
  lines.push(`- Candidate local-empty misses: ${analysis.totals.candidateLocalEmptyMisses}`);
  lines.push(`- Checked runners: ${analysis.totals.checkedRunners}`);
  lines.push(`- Checked symbols: ${analysis.totals.checkedSymbols}`);
  lines.push(`- EODHD articles fetched: ${analysis.totals.articlesFetched}`);
  lines.push("");
  lines.push("## EODHD News Counts");
  lines.push("");
  for (const [label, count] of Object.entries(analysis.counts).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`- ${label}: ${count}`);
  }
  lines.push("");
  lines.push("## Top Checked Missed Runners");
  lines.push("");
  for (const row of analysis.rows
    .slice()
    .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
    .slice(0, 80)) {
    const title = row.eodhdNews.primaryArticle?.title ? ` (${row.eodhdNews.primaryArticle.title})` : "";
    lines.push(
      `- ${row.runnerDate} ${row.symbol}: best forward ${formatPct(row.bestForwardPct)}, runner score ${formatPct(row.runnerScorePct)}, local ${row.catalyst?.label ?? "not_checked"}, eodhd ${row.eodhdNews.label}${title}`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const universePath = argValue("--universe") ?? "data/nasdaq-universe/nasdaq-current-universe.json";
const outputDirectory = argValue("--out-dir") ?? join("artifacts", "chart-thesis-qa-report-eodhd-under30m-runners");
const cacheDirectoryPath = argValue("--cache-dir") ?? join(process.cwd(), ".validation-cache", "candles");
const cacheMode = cacheModeArg("--cache-mode", "read_write");
const thesisMode = thesisModeArg("--thesis-mode", "internal");
const maxMarketCap = numberArg("--max-market-cap", 30_000_000);
const minCurrentVolume = numberArg("--min-current-volume", 0);
const maxUniverseSymbols = positiveIntegerArg("--max-universe-symbols", 500);
const dailyLookback = positiveIntegerArg("--daily-lookback", 180);
const fourHourLookback = positiveIntegerArg("--4h-lookback", 900);
const activeRunnerFiveMinuteConfirmationLookupEnabled = hasFlag("--active-runner-5m-confirmation-lookup");
const activeRunnerFiveMinuteSource = activeRunnerFiveMinuteSourceArg("--active-runner-5m-source", "eodhd_5m");
const activeRunnerFiveMinuteMinLookback = positiveIntegerArg("--active-runner-5m-min-lookback", 180);
const activeRunnerFiveMinutePaddingBars = positiveIntegerArg("--active-runner-5m-padding-bars", 30);
const targetRunnerSamples = positiveIntegerArg("--target-runner-samples", 200);
const selectionBufferMultiple = numberArg("--selection-buffer-multiple", 1.35);
const runnersPerDay = positiveIntegerArg("--runners-per-day", 5);
const throttleMs = positiveIntegerArg("--throttle-ms", 250);
const minRunnerVolume = numberArg("--min-runner-volume", 250_000);
const minDollarVolume = numberArg("--min-dollar-volume", 100_000);
const minRunnerMovePct = numberArg("--min-runner-move-pct", 35);
const minHighVsOpenPct = numberArg("--min-high-vs-open-pct", 20);
const minHighVsPriorClosePct = numberArg("--min-high-vs-prior-close-pct", 35);
const runnerDateFrom = dateArg("--runner-date-from");
const runnerDateTo = dateArg("--runner-date-to");
const horizonBars = positiveIntegerArg("--horizon-bars", 10);
const meaningfulMovePct = numberArg("--meaningful-move-pct", 25);
const maxExamples = positiveIntegerArg("--max-examples", 200);
const refreshUniverse = hasFlag("--refresh-universe");
const pressReleaseProjectDirectory = argValue("--press-release-project-dir") ??
  "C:\\Users\\jerac\\Documents\\TraderLink\\playwright\\projects\\press_release_levels_v2";
const catalystLookbackDays = positiveIntegerArg("--catalyst-lookback-days", 3);
const catalystLookaheadDays = positiveIntegerArg("--catalyst-lookahead-days", 1);
const catalystCardBusinessDays = positiveIntegerArg("--catalyst-card-business-days", 7);
const catalystLookupEnabled = !hasFlag("--skip-catalyst-lookup");
const eodhdNewsLookupEnabled = hasFlag("--eodhd-news-lookup");
const eodhdNewsMaxSymbols = positiveIntegerArg("--eodhd-news-max-symbols", 40);
const eodhdNewsLimit = positiveIntegerArg("--eodhd-news-limit", 100);
const eodhdNewsThrottleMs = positiveIntegerArg("--eodhd-news-throttle-ms", 250);
const activeRunnerExternalNewsMinScorePct = numberArg("--active-runner-external-news-min-score", 150);
const stockTitanLookupEnabled = hasFlag("--stocktitan-lookup");
const stockTitanMaxSymbols = positiveIntegerArg("--stocktitan-max-symbols", 50);
const stockTitanThrottleMs = positiveIntegerArg("--stocktitan-throttle-ms", 250);
const eodhdApiToken = envText("EODHD_API_TOKEN", "LEVEL_EODHD_API_TOKEN");
const eodhdExchangeSuffix = envText("EODHD_EXCHANGE_SUFFIX", "LEVEL_EODHD_EXCHANGE_SUFFIX") ?? "US";
const eodhdBaseUrl = envText("EODHD_BASE_URL", "LEVEL_EODHD_BASE_URL") ?? "https://eodhd.com";

const settings = {
  maxMarketCap,
  minCurrentVolume,
  maxUniverseSymbols,
  dailyLookback,
  fourHourLookback,
  activeRunnerFiveMinuteConfirmationLookupEnabled,
  activeRunnerFiveMinuteSource,
  activeRunnerFiveMinuteMinLookback,
  activeRunnerFiveMinutePaddingBars,
  targetRunnerSamples,
  selectionBufferMultiple,
  runnersPerDay,
  minRunnerVolume,
  minDollarVolume,
  minRunnerMovePct,
  minHighVsOpenPct,
  minHighVsPriorClosePct,
  runnerDateFrom,
  runnerDateTo,
  horizonBars,
  meaningfulMovePct,
  cacheMode,
  catalystLookupEnabled,
  catalystLookbackDays,
  catalystLookaheadDays,
  catalystCardBusinessDays,
  pressReleaseProjectDirectory,
  eodhdNewsLookupEnabled,
  eodhdNewsMaxSymbols,
  eodhdNewsLimit,
  eodhdNewsThrottleMs,
  eodhdExchangeSuffix,
  activeRunnerExternalNewsMinScorePct,
  stockTitanLookupEnabled,
  stockTitanMaxSymbols,
  stockTitanThrottleMs,
};

await mkdir(outputDirectory, { recursive: true });

const rows = await readUniverseRows(universePath, refreshUniverse);
const selectedRows = selectSmallCapRows(rows, {
  maxMarketCap,
  minCurrentVolume,
  maxUniverseSymbols,
});

console.log(
  `[EodhdSmallcapRunnerChartThesisQA] candidateSymbols=${selectedRows.length} maxMarketCap=${marketCapLabel(maxMarketCap)} targetRunnerSamples=${targetRunnerSamples} runnersPerDay=${runnersPerDay}`,
);

const baseService = new CandleFetchService({ providerName: "eodhd" });
const candleFetchService = new ValidationCachedCandleFetchService(baseService, {
  cacheDirectoryPath,
  mode: cacheMode,
});
const yahooFetchService = new ValidationCachedCandleFetchService(new CandleFetchService({ providerName: "yahoo" }), {
  cacheDirectoryPath,
  mode: cacheMode,
});
const fetchResultsPath = join(outputDirectory, "eodhd-runner-fetch-results.jsonl");
const dailyResponsesBySymbol = new Map<string, CandleProviderResponse>();
const runnerCandidates: DailyRunnerCandidate[] = [];

for (const row of selectedRows) {
  try {
    const dailyResponse = await candleFetchService.fetchCandles({
      symbol: row.symbol,
      timeframe: "daily",
      lookbackBars: dailyLookback,
      preferredProvider: "eodhd",
    });
    const dailyCandles = normalizeCandles(dailyResponse.candles);
    dailyResponsesBySymbol.set(row.symbol, { ...dailyResponse, candles: dailyCandles });
    const runners = findDailyRunners({
      row,
      dailyCandles,
      minRunnerVolume,
      minDollarVolume,
      minRunnerMovePct,
      minHighVsOpenPct,
      minHighVsPriorClosePct,
    });
    runnerCandidates.push(...runners);
    console.log(
      `[EodhdSmallcapRunnerChartThesisQA] ${row.symbol} daily candles=${dailyCandles.length} runners=${runners.length}`,
    );
    await appendFile(fetchResultsPath, `${JSON.stringify({
      timestamp: Date.now(),
      symbol: row.symbol,
      marketCap: row.marketCap,
      timeframe: "daily",
      status: dailyCandles.length > 0 ? "fetched" : "empty",
      candles: dailyCandles.length,
      runners: runners.length,
    })}\n`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[EodhdSmallcapRunnerChartThesisQA] ${row.symbol} daily failed: ${message}`);
    await appendFile(fetchResultsPath, `${JSON.stringify({
      timestamp: Date.now(),
      symbol: row.symbol,
      marketCap: row.marketCap,
      timeframe: "daily",
      status: "failed",
      candles: 0,
      error: message,
    })}\n`, "utf8");
  }
  await sleep(throttleMs);
}

const dateFilteredRunnerCandidates = runnerCandidates.filter((runner) =>
  (runnerDateFrom === null || runner.runnerDate >= runnerDateFrom) &&
  (runnerDateTo === null || runner.runnerDate <= runnerDateTo)
);
const selectedRunnerDays = selectTopRunnersByDay(dateFilteredRunnerCandidates, {
  runnersPerDay,
  targetRunnerSamples: Math.ceil(targetRunnerSamples * Math.max(1, selectionBufferMultiple)),
});
const selectedSymbols = [...new Set(selectedRunnerDays.map((runner) => runner.symbol))].sort();
console.log(
  `[EodhdSmallcapRunnerChartThesisQA] runnerCandidates=${runnerCandidates.length} dateFilteredRunnerCandidates=${dateFilteredRunnerCandidates.length} selectedRunnerDays=${selectedRunnerDays.length} selectedSymbols=${selectedSymbols.length}`,
);
const selectedRunnerDates = [...new Set(selectedRunnerDays.map((runner) => runner.runnerDate))].sort();
const catalystLookup = lookupLocalPressReleaseArticles({
  projectDirectory: pressReleaseProjectDirectory,
  symbols: selectedSymbols,
  minRunnerDate: selectedRunnerDates[0] ?? dateKey(Date.now()),
  maxRunnerDate: selectedRunnerDates.at(-1) ?? dateKey(Date.now()),
  lookbackDays: Math.max(catalystLookbackDays, catalystCardBusinessDays),
  lookaheadDays: catalystLookaheadDays,
  enabled: catalystLookupEnabled,
});
console.log(
  `[EodhdSmallcapRunnerChartThesisQA] catalystLookup=${catalystLookup.available ? "available" : "unavailable"} articles=${Object.values(catalystLookup.articlesBySymbol).reduce((sum, articles) => sum + articles.length, 0)}${catalystLookup.error ? ` error=${catalystLookup.error}` : ""}`,
);

const fourHourResponsesBySymbol = new Map<string, CandleProviderResponse>();
const selectedWithCutoffs: SelectedRunner[] = [];

for (const symbol of selectedSymbols) {
  try {
    const response = await candleFetchService.fetchCandles({
      symbol,
      timeframe: "4h",
      lookbackBars: fourHourLookback,
      preferredProvider: "eodhd",
    });
    const fourHourCandles = normalizeCandles(response.candles);
    fourHourResponsesBySymbol.set(symbol, { ...response, candles: fourHourCandles });
    const symbolRunners = selectedRunnerDays.filter((runner) => runner.symbol === symbol);
    for (const runner of symbolRunners) {
      const cutoff = findPreRunnerCutoff(fourHourCandles, runner.runnerDate, horizonBars);
      const activeCutoff = findActiveRunnerCutoff(fourHourCandles, runner.runnerDate, horizonBars);
      selectedWithCutoffs.push({
        ...runner,
        cutoffTimestamp: cutoff.cutoffTimestamp,
        cutoffIso: cutoff.cutoffTimestamp === null ? null : new Date(cutoff.cutoffTimestamp).toISOString(),
        skipReason: cutoff.skipReason,
        activeCutoffTimestamp: activeCutoff.cutoffTimestamp,
        activeCutoffIso: activeCutoff.cutoffTimestamp === null ? null : new Date(activeCutoff.cutoffTimestamp).toISOString(),
        activeSkipReason: activeCutoff.skipReason,
        catalyst: classifyRunnerCatalyst({
          runner,
          lookup: catalystLookup,
          lookbackDays: catalystLookbackDays,
          lookaheadDays: catalystLookaheadDays,
        }),
        catalystCard: classifyCatalystCardContext({
          runner,
          lookup: catalystLookup,
          businessDays: catalystCardBusinessDays,
        }),
      });
    }
    console.log(
      `[EodhdSmallcapRunnerChartThesisQA] ${symbol} 4h candles=${fourHourCandles.length} runnerDays=${symbolRunners.length}`,
    );
    await appendFile(fetchResultsPath, `${JSON.stringify({
      timestamp: Date.now(),
      symbol,
      timeframe: "4h",
      status: fourHourCandles.length > 0 ? "fetched" : "empty",
      candles: fourHourCandles.length,
      runnerDays: symbolRunners.length,
    })}\n`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[EodhdSmallcapRunnerChartThesisQA] ${symbol} 4h failed: ${message}`);
    for (const runner of selectedRunnerDays.filter((item) => item.symbol === symbol)) {
      selectedWithCutoffs.push({
        ...runner,
        cutoffTimestamp: null,
        cutoffIso: null,
        skipReason: "failed_4h_fetch",
        activeCutoffTimestamp: null,
        activeCutoffIso: null,
        activeSkipReason: "failed_4h_fetch",
        catalyst: classifyRunnerCatalyst({
          runner,
          lookup: catalystLookup,
          lookbackDays: catalystLookbackDays,
          lookaheadDays: catalystLookaheadDays,
        }),
        catalystCard: classifyCatalystCardContext({
          runner,
          lookup: catalystLookup,
          businessDays: catalystCardBusinessDays,
        }),
      });
    }
  }
  await sleep(throttleMs);
}

const usableRunnersAll = selectedWithCutoffs.filter((runner) => runner.cutoffTimestamp !== null);
const usableRunners = usableRunnersAll.slice(0, targetRunnerSamples);
const extraUsableRunners = usableRunnersAll.slice(targetRunnerSamples);
const skippedRunners = selectedWithCutoffs.filter((runner) => runner.cutoffTimestamp === null);
const cutoffTimestampsBySymbol: Record<string, number[]> = {};
for (const runner of usableRunners) {
  const timestamps = cutoffTimestampsBySymbol[runner.symbol] ?? [];
  timestamps.push(runner.cutoffTimestamp!);
  cutoffTimestampsBySymbol[runner.symbol] = timestamps;
}
const activeRunners = usableRunners.filter((runner) => runner.activeCutoffTimestamp !== null);
const activeCutoffTimestampsBySymbol: Record<string, number[]> = {};
const activeChartThesisContextBySymbolTimestamp: Record<string, {
  activeRunner: true;
  catalystCardFreshness: CatalystCardFreshnessLabel;
  catalystContext?: PressReleaseCatalystContext;
}> = {};
for (const runner of activeRunners) {
  const timestamps = activeCutoffTimestampsBySymbol[runner.symbol] ?? [];
  timestamps.push(runner.activeCutoffTimestamp!);
  activeCutoffTimestampsBySymbol[runner.symbol] = timestamps;
  activeChartThesisContextBySymbolTimestamp[`${runner.symbol.toUpperCase()}:${runner.activeCutoffTimestamp}`] = {
    activeRunner: true,
    catalystCardFreshness: runner.catalystCard?.label ?? "lookup_unavailable",
    catalystContext: mapRunnerCatalystToPressReleaseContext(runner.catalyst),
  };
}

const fiveMinuteResponsesBySymbol = new Map<string, CandleProviderResponse>();
const activeRunnerFiveMinuteFetchResults: ActiveRunnerFiveMinuteFetchResult[] = [];

async function fetchActiveRunnerFiveMinuteSource(params: {
  source: ActiveRunnerFiveMinuteSelectedSource;
  symbol: string;
  lookbackBars: number;
  endTimeMs: number;
}): Promise<CandleProviderResponse> {
  if (params.source === "yahoo_5m") {
    return yahooFetchService.fetchCandles({
      symbol: params.symbol,
      timeframe: "5m",
      lookbackBars: params.lookbackBars,
      endTimeMs: params.endTimeMs,
      preferredProvider: "yahoo",
    });
  }

  if (params.source === "eodhd_1m_aggregated") {
    const oneMinuteResponse = await candleFetchService.fetchCandles({
      symbol: params.symbol,
      timeframe: "1m",
      lookbackBars: params.lookbackBars * 5,
      endTimeMs: params.endTimeMs,
      preferredProvider: "eodhd",
    });
    return aggregateOneMinuteResponseToFiveMinutes(oneMinuteResponse, params.lookbackBars);
  }

  return candleFetchService.fetchCandles({
    symbol: params.symbol,
    timeframe: "5m",
    lookbackBars: params.lookbackBars,
    endTimeMs: params.endTimeMs,
    preferredProvider: "eodhd",
  });
}

async function fetchActiveRunnerFiveMinuteResponse(params: {
  symbol: string;
  lookbackBars: number;
  endTimeMs: number;
  source: ActiveRunnerFiveMinuteSource;
}): Promise<{
  response: CandleProviderResponse;
  selectedSource: ActiveRunnerFiveMinuteSelectedSource;
  sourceCandidates: NonNullable<ActiveRunnerFiveMinuteFetchResult["sourceCandidates"]>;
}> {
  const sourceOrder: ActiveRunnerFiveMinuteSelectedSource[] =
    params.source === "best_available"
      ? ["eodhd_5m", "eodhd_1m_aggregated", "yahoo_5m"]
      : [params.source];
  const fetched: Array<{ source: ActiveRunnerFiveMinuteSelectedSource; response: CandleProviderResponse }> = [];
  const sourceCandidates: NonNullable<ActiveRunnerFiveMinuteFetchResult["sourceCandidates"]> = [];

  for (const source of sourceOrder) {
    try {
      const response = await fetchActiveRunnerFiveMinuteSource({
        source,
        symbol: params.symbol,
        lookbackBars: params.lookbackBars,
        endTimeMs: params.endTimeMs,
      });
      const normalized = {
        ...response,
        candles: normalizeCandles(response.candles),
      };
      fetched.push({ source, response: normalized });
      sourceCandidates.push({
        source,
        status: normalized.candles.length > 0 ? "fetched" : "empty",
        candles: normalized.candles.length,
      });
    } catch (error) {
      sourceCandidates.push({
        source,
        status: "failed",
        candles: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const best = fetched
    .sort((left, right) => right.response.candles.length - left.response.candles.length)[0];
  if (!best) {
    const errors = sourceCandidates
      .filter((candidate) => candidate.error)
      .map((candidate) => `${candidate.source}: ${candidate.error}`)
      .join("; ");
    throw new Error(errors || "No 5m source returned candles.");
  }

  return {
    response: best.response,
    selectedSource: best.source,
    sourceCandidates,
  };
}

if (activeRunnerFiveMinuteConfirmationLookupEnabled) {
  const activeSymbols = selectedSymbols
    .filter((symbol) => (activeCutoffTimestampsBySymbol[symbol]?.length ?? 0) > 0);
  console.log(
    `[EodhdSmallcapRunnerChartThesisQA] activeRunner5mConfirmation=enabled source=${activeRunnerFiveMinuteSource} symbols=${activeSymbols.length} minLookback=${activeRunnerFiveMinuteMinLookback} paddingBars=${activeRunnerFiveMinutePaddingBars}`,
  );

  for (const symbol of activeSymbols) {
    const cutoffTimestamps = activeCutoffTimestampsBySymbol[symbol] ?? [];
    const plan = fiveMinuteFetchPlanForCutoffs({
      cutoffTimestamps,
      minLookbackBars: activeRunnerFiveMinuteMinLookback,
      paddingBars: activeRunnerFiveMinutePaddingBars,
    });
    if (!plan) {
      activeRunnerFiveMinuteFetchResults.push({
        symbol,
        status: "skipped",
        candles: 0,
        cutoffCount: cutoffTimestamps.length,
      });
      continue;
    }

    try {
      const result = await fetchActiveRunnerFiveMinuteResponse({
        symbol,
        source: activeRunnerFiveMinuteSource,
        lookbackBars: plan.lookbackBars,
        endTimeMs: plan.endTimeMs,
      });
      const fiveMinuteCandles = normalizeCandles(result.response.candles);
      fiveMinuteResponsesBySymbol.set(symbol, { ...result.response, candles: fiveMinuteCandles });
      activeRunnerFiveMinuteFetchResults.push({
        symbol,
        status: fiveMinuteCandles.length > 0 ? "fetched" : "empty",
        source: result.selectedSource,
        candles: fiveMinuteCandles.length,
        cutoffCount: cutoffTimestamps.length,
        lookbackBars: plan.lookbackBars,
        endTimeIso: new Date(plan.endTimeMs).toISOString(),
        sourceCandidates: result.sourceCandidates,
      });
      console.log(
        `[EodhdSmallcapRunnerChartThesisQA] ${symbol} 5m source=${result.selectedSource} candles=${fiveMinuteCandles.length} activeCutoffs=${cutoffTimestamps.length} lookbackBars=${plan.lookbackBars}`,
      );
      await appendFile(fetchResultsPath, `${JSON.stringify({
        timestamp: Date.now(),
        symbol,
        timeframe: "5m",
        status: fiveMinuteCandles.length > 0 ? "fetched" : "empty",
        source: result.selectedSource,
        candles: fiveMinuteCandles.length,
        activeCutoffs: cutoffTimestamps.length,
        lookbackBars: plan.lookbackBars,
        endTimeMs: plan.endTimeMs,
        sourceCandidates: result.sourceCandidates,
      })}\n`, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[EodhdSmallcapRunnerChartThesisQA] ${symbol} 5m failed: ${message}`);
      activeRunnerFiveMinuteFetchResults.push({
        symbol,
        status: "failed",
        source: activeRunnerFiveMinuteSource,
        candles: 0,
        cutoffCount: cutoffTimestamps.length,
        lookbackBars: plan.lookbackBars,
        endTimeIso: new Date(plan.endTimeMs).toISOString(),
        error: message,
      });
      await appendFile(fetchResultsPath, `${JSON.stringify({
        timestamp: Date.now(),
        symbol,
        timeframe: "5m",
        status: "failed",
        source: activeRunnerFiveMinuteSource,
        candles: 0,
        activeCutoffs: cutoffTimestamps.length,
        lookbackBars: plan.lookbackBars,
        endTimeMs: plan.endTimeMs,
        error: message,
      })}\n`, "utf8");
    }
    await sleep(throttleMs);
  }
} else {
  activeRunnerFiveMinuteFetchResults.push({
    symbol: "*",
    status: "disabled",
    source: activeRunnerFiveMinuteSource,
    candles: 0,
    cutoffCount: activeRunners.length,
  });
  console.log("[EodhdSmallcapRunnerChartThesisQA] activeRunner5mConfirmation=disabled");
}

const qaSymbols: ChartThesisQaSymbolInput[] = selectedSymbols
  .filter((symbol) => (cutoffTimestampsBySymbol[symbol]?.length ?? 0) > 0)
  .map((symbol) => ({
    symbol,
    seriesMap: {
      daily: dailyResponsesBySymbol.get(symbol),
      "4h": fourHourResponsesBySymbol.get(symbol),
    },
  }));
const activeQaSymbols: ChartThesisQaSymbolInput[] = selectedSymbols
  .filter((symbol) => (activeCutoffTimestampsBySymbol[symbol]?.length ?? 0) > 0)
  .map((symbol) => ({
    symbol,
    seriesMap: {
      daily: dailyResponsesBySymbol.get(symbol),
      "4h": fourHourResponsesBySymbol.get(symbol),
      "5m": fiveMinuteResponsesBySymbol.get(symbol),
    },
  }));

await writeFile(
  join(outputDirectory, "selected-runner-basket.json"),
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: refreshUniverse ? "live Nasdaq screener" : universePath,
    settings,
    selectedRunnerDays: selectedWithCutoffs,
    usableRunnerDays: usableRunners,
    extraUsableRunnerDays: extraUsableRunners,
    activeRunnerDays: activeRunners,
    skippedRunnerDays: skippedRunners,
    catalystLookup: {
      available: catalystLookup.available,
      error: catalystLookup.error,
      databasePath: catalystLookup.databasePath,
    },
    cutoffTimestampsBySymbol,
    activeCutoffTimestampsBySymbol,
    activeRunnerFiveMinuteFetchResults,
  }, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(outputDirectory, "selected-runner-basket.md"),
  renderRunnerBasketMarkdown({
    selected: selectedWithCutoffs,
    usable: usableRunners,
    extraUsable: extraUsableRunners,
    skipped: skippedRunners,
    settings,
  }),
  "utf8",
);

const report = writeChartThesisQaReport({
  symbols: qaSymbols,
  source: [
    "EODHD actual daily runner basket",
    `thesisMode=${thesisMode}`,
    `${usableRunners.length} usable runner-days`,
    `${selectedSymbols.length} selected symbols`,
    `marketCap<=${marketCapLabel(maxMarketCap)}`,
    `runner score>=${formatPct(minRunnerMovePct)}`,
    `top ${runnersPerDay}/day`,
  ].join(" | "),
  outputDirectory,
  thesisMode,
  cutoffTimestampsBySymbol,
  samplesPerSymbol: targetRunnerSamples,
  horizonBars,
  meaningfulMovePct,
  maxExamples,
});

const activeRunnerOutputDirectory = join(outputDirectory, "active-runner-trader-read");
const activeRunnerReport = writeChartThesisQaReport({
  symbols: activeQaSymbols,
  source: [
    "EODHD actual daily runner basket",
    "active-runner first 4h cutoff",
    `thesisMode=${thesisMode}`,
    `${activeRunners.length} active runner-days`,
    `${activeQaSymbols.length} selected symbols`,
    `marketCap<=${marketCapLabel(maxMarketCap)}`,
    `runner score>=${formatPct(minRunnerMovePct)}`,
    `catalyst card window=${catalystCardBusinessDays} business days`,
    "raw local catalyst context enabled",
    activeRunnerFiveMinuteConfirmationLookupEnabled
      ? `5m confirmation source=${activeRunnerFiveMinuteSource}`
      : "5m confirmation not fetched",
  ].join(" | "),
  outputDirectory: activeRunnerOutputDirectory,
  thesisMode,
  cutoffTimestampsBySymbol: activeCutoffTimestampsBySymbol,
  chartThesisContextBySymbolTimestamp: activeChartThesisContextBySymbolTimestamp,
  samplesPerSymbol: targetRunnerSamples,
  horizonBars,
  meaningfulMovePct,
  maxExamples,
});
const activeRunnerTraderReadAnalysis = buildActiveRunnerTraderReadAnalysis({
  activeRunners,
  report: activeRunnerReport,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-trader-read-analysis.json"),
  `${JSON.stringify(activeRunnerTraderReadAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-trader-read-analysis.md"),
  renderActiveRunnerTraderReadAnalysisMarkdown(activeRunnerTraderReadAnalysis),
  "utf8",
);
const fiveMinuteTapeParticipationAudit = buildFiveMinuteTapeParticipationAudit({
  activeRunners,
  report: activeRunnerReport,
  fetchResults: activeRunnerFiveMinuteFetchResults,
  fiveMinuteResponsesBySymbol,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-5m-tape-participation-audit.json"),
  `${JSON.stringify(fiveMinuteTapeParticipationAudit, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-5m-tape-participation-audit.md"),
  renderFiveMinuteTapeParticipationAuditMarkdown(fiveMinuteTapeParticipationAudit),
  "utf8",
);
const activeRunnerHotExtendedVolumeAnalysis = buildActiveRunnerHotExtendedVolumeAnalysis({
  tapeAudit: fiveMinuteTapeParticipationAudit,
  report: activeRunnerReport,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-hot-extended-5m-volume-analysis.json"),
  `${JSON.stringify(activeRunnerHotExtendedVolumeAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-hot-extended-5m-volume-analysis.md"),
  renderActiveRunnerHotExtendedVolumeMarkdown(activeRunnerHotExtendedVolumeAnalysis),
  "utf8",
);
const activeRunnerCompositeCandidateScoreAnalysis = buildActiveRunnerCompositeCandidateScoreAnalysis({
  tapeAudit: fiveMinuteTapeParticipationAudit,
  report: activeRunnerReport,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-composite-candidate-scorer.json"),
  `${JSON.stringify(activeRunnerCompositeCandidateScoreAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-composite-candidate-scorer.md"),
  renderActiveRunnerCompositeCandidateScoreMarkdown(activeRunnerCompositeCandidateScoreAnalysis),
  "utf8",
);
const activeRunnerMultiThesisComparison = buildActiveRunnerMultiThesisComparison({
  report: activeRunnerReport,
  tapeAudit: fiveMinuteTapeParticipationAudit,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-multi-thesis-comparison.json"),
  `${JSON.stringify(activeRunnerMultiThesisComparison, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-multi-thesis-comparison.md"),
  renderActiveRunnerMultiThesisComparisonMarkdown(activeRunnerMultiThesisComparison),
  "utf8",
);
const activeRunnerExtendedChaseRiskControlAnalysis = buildActiveRunnerExtendedChaseRiskControlAnalysis({
  multiThesisComparison: activeRunnerMultiThesisComparison,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-extended-chase-risk-control-analysis.json"),
  `${JSON.stringify(activeRunnerExtendedChaseRiskControlAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-extended-chase-risk-control-analysis.md"),
  renderActiveRunnerExtendedChaseRiskControlMarkdown(activeRunnerExtendedChaseRiskControlAnalysis),
  "utf8",
);
const activeRunnerRemainingMissRejectionAudit = buildActiveRunnerRemainingMissRejectionAudit({
  activeRunners,
  report: activeRunnerReport,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-remaining-miss-rejection-audit.json"),
  `${JSON.stringify(activeRunnerRemainingMissRejectionAudit, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-remaining-miss-rejection-audit.md"),
  renderActiveRunnerRemainingMissRejectionAuditMarkdown(activeRunnerRemainingMissRejectionAudit),
  "utf8",
);
const activeRunnerNewsBurstCandidateAnalysis = buildActiveRunnerNewsBurstCandidateAnalysis({
  activeRunners,
  report: activeRunnerReport,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-news-burst-candidate-analysis.json"),
  `${JSON.stringify(activeRunnerNewsBurstCandidateAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-news-burst-candidate-analysis.md"),
  renderActiveRunnerNewsBurstCandidateMarkdown(activeRunnerNewsBurstCandidateAnalysis),
  "utf8",
);
const activeRunnerNarrowFiveMinuteNewsLookupCandidates = fiveMinuteTapeParticipationAudit.narrowCandidateRule.gateComparison.rows
  .map((row) => ({
    symbol: row.symbol,
    runnerDate: row.runnerDate ?? row.cutoffIso.slice(0, 10),
    bestForwardPct: row.bestForwardPct,
  }));
const activeRunnerHighScoreExternalNewsLookupCandidates = activeRunnerNewsBurstCandidateAnalysis.rows
  .filter((row) => needsExternalCatalystContext(row.localCatalyst) && row.runnerScorePct >= activeRunnerExternalNewsMinScorePct)
  .map((row) => ({
    symbol: row.symbol,
    runnerDate: row.runnerDate,
    bestForwardPct: row.bestForwardPct,
  }));
const activeRunnerExternalNewsLookupCandidates = mergeNewsLookupCandidates(
  activeRunnerNarrowFiveMinuteNewsLookupCandidates,
  activeRunnerHighScoreExternalNewsLookupCandidates
    .slice()
    .sort((left, right) => right.bestForwardPct - left.bestForwardPct),
);
const activeRunnerExternalNewsLookup = await lookupEodhdNewsForMissedRunners({
  runners: activeRunnerExternalNewsLookupCandidates,
  enabled: eodhdNewsLookupEnabled,
  maxSymbols: eodhdNewsMaxSymbols,
  apiToken: eodhdApiToken,
  exchangeSuffix: eodhdExchangeSuffix,
  baseUrl: eodhdBaseUrl,
  lookbackDays: catalystLookbackDays,
  lookaheadDays: catalystLookaheadDays,
  limit: eodhdNewsLimit,
  throttleMs: eodhdNewsThrottleMs,
});
const activeRunnerStockTitanLookup = await lookupStockTitanNewsForRunners({
  runners: activeRunnerExternalNewsLookupCandidates,
  enabled: stockTitanLookupEnabled,
  maxSymbols: stockTitanMaxSymbols,
  throttleMs: stockTitanThrottleMs,
});
const activeRunnerExternalNewsCatalystAnalysis = buildActiveRunnerExternalNewsCatalystAnalysis({
  candidateAnalysis: activeRunnerNewsBurstCandidateAnalysis,
  lookup: activeRunnerExternalNewsLookup,
  lookbackDays: catalystLookbackDays,
  lookaheadDays: catalystLookaheadDays,
  minRunnerScorePct: activeRunnerExternalNewsMinScorePct,
});
const activeRunnerStockTitanCatalystAnalysis = buildActiveRunnerStockTitanCatalystAnalysis({
  candidateAnalysis: activeRunnerNewsBurstCandidateAnalysis,
  lookup: activeRunnerStockTitanLookup,
  lookbackDays: catalystLookbackDays,
  lookaheadDays: catalystLookaheadDays,
  minRunnerScorePct: activeRunnerExternalNewsMinScorePct,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-external-news-catalyst-analysis.json"),
  `${JSON.stringify(activeRunnerExternalNewsCatalystAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-external-news-catalyst-analysis.md"),
  renderActiveRunnerExternalNewsCatalystMarkdown(activeRunnerExternalNewsCatalystAnalysis),
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-stocktitan-catalyst-analysis.json"),
  `${JSON.stringify(activeRunnerStockTitanCatalystAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-stocktitan-catalyst-analysis.md"),
  renderActiveRunnerStockTitanCatalystMarkdown(activeRunnerStockTitanCatalystAnalysis),
  "utf8",
);
const activeRunnerNewsBurstExternalContextAnalysis = buildActiveRunnerNewsBurstExternalContextAnalysis({
  candidateAnalysis: activeRunnerNewsBurstCandidateAnalysis,
  eodhdAnalysis: activeRunnerExternalNewsCatalystAnalysis,
  stockTitanAnalysis: activeRunnerStockTitanCatalystAnalysis,
  minRunnerScorePct: activeRunnerExternalNewsMinScorePct,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-news-burst-external-context-analysis.json"),
  `${JSON.stringify(activeRunnerNewsBurstExternalContextAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-news-burst-external-context-analysis.md"),
  renderActiveRunnerNewsBurstExternalContextMarkdown(activeRunnerNewsBurstExternalContextAnalysis),
  "utf8",
);
const activeRunnerNarrowFiveMinuteNewsContextAnalysis = buildActiveRunnerNarrowFiveMinuteNewsContextAnalysis({
  tapeAudit: fiveMinuteTapeParticipationAudit,
  eodhdLookup: activeRunnerExternalNewsLookup,
  stockTitanLookup: activeRunnerStockTitanLookup,
  lookbackDays: catalystLookbackDays,
  lookaheadDays: catalystLookaheadDays,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-narrow-5m-news-context-analysis.json"),
  `${JSON.stringify(activeRunnerNarrowFiveMinuteNewsContextAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-narrow-5m-news-context-analysis.md"),
  renderActiveRunnerNarrowFiveMinuteNewsContextMarkdown(activeRunnerNarrowFiveMinuteNewsContextAnalysis),
  "utf8",
);
const externalNewsEnrichedModeSummaries = [];
for (const mode of externalNewsCatalystEnrichmentModes) {
  const enriched = buildEnrichedActiveRunnerContext({
    baseContext: activeChartThesisContextBySymbolTimestamp,
    rows: activeRunnerExternalNewsCatalystAnalysis.rows,
    include: mode.include,
  });
  const enrichedOutputDirectory = join(activeRunnerOutputDirectory, "external-news-enriched", "eodhd", mode.name);
  await mkdir(enrichedOutputDirectory, { recursive: true });
  const enrichedReport = writeChartThesisQaReport({
    symbols: activeQaSymbols,
    source: [
      "EODHD actual daily runner basket",
      "active-runner first 4h cutoff",
      `thesisMode=${thesisMode}`,
      `external-news catalyst enrichment=eodhd:${mode.name}`,
      `${activeRunners.length} active runner-days`,
      `${activeQaSymbols.length} selected symbols`,
      `marketCap<=${marketCapLabel(maxMarketCap)}`,
      `runner score>=${formatPct(minRunnerMovePct)}`,
    ].join(" | "),
    outputDirectory: enrichedOutputDirectory,
    thesisMode,
    cutoffTimestampsBySymbol: activeCutoffTimestampsBySymbol,
    chartThesisContextBySymbolTimestamp: enriched.context,
    samplesPerSymbol: targetRunnerSamples,
    horizonBars,
    meaningfulMovePct,
    maxExamples,
  });
  externalNewsEnrichedModeSummaries.push(summarizeEnrichedActiveRunnerReport({
    mode,
    baselineReport: activeRunnerReport,
    enrichedReport,
    enrichedRows: enriched.enrichedRows,
  }));
}
for (const mode of stockTitanCatalystEnrichmentModes) {
  const enriched = buildEnrichedActiveRunnerContext({
    baseContext: activeChartThesisContextBySymbolTimestamp,
    rows: activeRunnerStockTitanCatalystAnalysis.rows,
    include: mode.include,
  });
  const enrichedOutputDirectory = join(activeRunnerOutputDirectory, "external-news-enriched", "stocktitan", mode.name);
  await mkdir(enrichedOutputDirectory, { recursive: true });
  const enrichedReport = writeChartThesisQaReport({
    symbols: activeQaSymbols,
    source: [
      "EODHD actual daily runner basket",
      "active-runner first 4h cutoff",
      `thesisMode=${thesisMode}`,
      `external-news catalyst enrichment=stocktitan:${mode.name}`,
      `${activeRunners.length} active runner-days`,
      `${activeQaSymbols.length} selected symbols`,
      `marketCap<=${marketCapLabel(maxMarketCap)}`,
      `runner score>=${formatPct(minRunnerMovePct)}`,
    ].join(" | "),
    outputDirectory: enrichedOutputDirectory,
    thesisMode,
    cutoffTimestampsBySymbol: activeCutoffTimestampsBySymbol,
    chartThesisContextBySymbolTimestamp: enriched.context,
    samplesPerSymbol: targetRunnerSamples,
    horizonBars,
    meaningfulMovePct,
    maxExamples,
  });
  externalNewsEnrichedModeSummaries.push(summarizeEnrichedActiveRunnerReport({
    mode,
    baselineReport: activeRunnerReport,
    enrichedReport,
    enrichedRows: enriched.enrichedRows,
  }));
}
const externalNewsEnrichedReplayAnalysis = buildExternalNewsEnrichedReplayAnalysis({
  baselineReport: activeRunnerReport,
  modeSummaries: externalNewsEnrichedModeSummaries,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-external-news-enriched-replay-analysis.json"),
  `${JSON.stringify(externalNewsEnrichedReplayAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-external-news-enriched-replay-analysis.md"),
  renderExternalNewsEnrichedReplayMarkdown(externalNewsEnrichedReplayAnalysis),
  "utf8",
);
const activeRunnerClearedShelfCandidateAnalysis = buildActiveRunnerClearedShelfCandidateAnalysis({
  activeRunners,
  report: activeRunnerReport,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-cleared-shelf-candidate-analysis.json"),
  `${JSON.stringify(activeRunnerClearedShelfCandidateAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-cleared-shelf-candidate-analysis.md"),
  renderActiveRunnerClearedShelfCandidateMarkdown(activeRunnerClearedShelfCandidateAnalysis),
  "utf8",
);
const activeRunnerUpperRangeCandidateAnalysis = buildActiveRunnerUpperRangeCandidateAnalysis({
  activeRunners,
  report: activeRunnerReport,
  tapeAudit: fiveMinuteTapeParticipationAudit,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-upper-range-candidate-analysis.json"),
  `${JSON.stringify(activeRunnerUpperRangeCandidateAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-upper-range-candidate-analysis.md"),
  renderActiveRunnerUpperRangeCandidateMarkdown(activeRunnerUpperRangeCandidateAnalysis),
  "utf8",
);
const activeRunnerDelayedQuietCandidateAnalysis = buildActiveRunnerDelayedQuietCandidateAnalysis({
  activeRunners,
  report: activeRunnerReport,
  tapeAudit: fiveMinuteTapeParticipationAudit,
});
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-delayed-quiet-candidate-analysis.json"),
  `${JSON.stringify(activeRunnerDelayedQuietCandidateAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(activeRunnerOutputDirectory, "active-runner-delayed-quiet-candidate-analysis.md"),
  renderActiveRunnerDelayedQuietCandidateMarkdown(activeRunnerDelayedQuietCandidateAnalysis),
  "utf8",
);

const catalystAnalysis = buildRunnerCatalystAnalysis({
  usable: usableRunners,
  report,
  catalystLookup,
});
await writeFile(
  join(outputDirectory, "runner-catalyst-analysis.json"),
  `${JSON.stringify(catalystAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(outputDirectory, "runner-catalyst-analysis.md"),
  renderRunnerCatalystAnalysisMarkdown(catalystAnalysis),
  "utf8",
);

const localEmptyMissedRunners = catalystAnalysis.missedRunners.filter((runner) =>
  runner.catalyst ? needsExternalCatalystContext(runner.catalyst.label) : false,
).sort((left, right) => right.bestForwardPct - left.bestForwardPct);
const eodhdNewsLookup = await lookupEodhdNewsForMissedRunners({
  runners: localEmptyMissedRunners,
  enabled: eodhdNewsLookupEnabled,
  maxSymbols: eodhdNewsMaxSymbols,
  apiToken: eodhdApiToken,
  exchangeSuffix: eodhdExchangeSuffix,
  baseUrl: eodhdBaseUrl,
  lookbackDays: catalystLookbackDays,
  lookaheadDays: catalystLookaheadDays,
  limit: eodhdNewsLimit,
  throttleMs: eodhdNewsThrottleMs,
});
const eodhdNewsCatalystAnalysis = buildEodhdNewsCatalystAnalysis({
  runners: localEmptyMissedRunners,
  lookup: eodhdNewsLookup,
  lookbackDays: catalystLookbackDays,
  lookaheadDays: catalystLookaheadDays,
});
await writeFile(
  join(outputDirectory, "eodhd-news-catalyst-analysis.json"),
  `${JSON.stringify(eodhdNewsCatalystAnalysis, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(outputDirectory, "eodhd-news-catalyst-analysis.md"),
  renderEodhdNewsCatalystAnalysisMarkdown(eodhdNewsCatalystAnalysis),
  "utf8",
);

console.log(
  `Runner basket: selected=${selectedWithCutoffs.length}, usableForQa=${usableRunners.length}, extraUsable=${extraUsableRunners.length}, skipped=${skippedRunners.length}, uniqueUsableSymbols=${qaSymbols.length}.`,
);
console.log(
  `Chart thesis QA: ${report.totals.symbols} symbols, ${report.totals.samplesWithThesis} thesis samples, ${report.totals.hitTarget} target hits, ${report.totals.partialProgress} partial, ${report.totals.invalidated} invalidated, ${report.totals.missedMeaningfulMoves} missed meaningful moves.`,
);
console.log(
  `Active-runner trader read QA: ${activeRunnerReport.totals.symbols} symbols, ${activeRunnerReport.totals.samplesWithThesis} thesis samples, ${activeRunnerReport.totals.hitTarget} target hits, ${activeRunnerReport.totals.partialProgress} partial, ${activeRunnerReport.totals.invalidated} invalidated, ${activeRunnerReport.totals.missedMeaningfulMoves} missed meaningful moves.`,
);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(outputDirectory, "selected-runner-basket.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(outputDirectory, "chart-thesis-qa-report.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-trader-read-analysis.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-5m-tape-participation-audit.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-hot-extended-5m-volume-analysis.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-composite-candidate-scorer.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-multi-thesis-comparison.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-extended-chase-risk-control-analysis.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-remaining-miss-rejection-audit.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-news-burst-candidate-analysis.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-external-news-catalyst-analysis.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-stocktitan-catalyst-analysis.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-narrow-5m-news-context-analysis.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-external-news-enriched-replay-analysis.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-cleared-shelf-candidate-analysis.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-upper-range-candidate-analysis.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(activeRunnerOutputDirectory, "active-runner-delayed-quiet-candidate-analysis.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(outputDirectory, "runner-catalyst-analysis.md")}`);
console.log(`[EodhdSmallcapRunnerChartThesisQA] wrote ${join(outputDirectory, "eodhd-news-catalyst-analysis.md")}`);
