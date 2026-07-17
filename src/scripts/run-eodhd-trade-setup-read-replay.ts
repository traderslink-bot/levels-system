import "dotenv/config";

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ChartThesisRead } from "../lib/alerts/alert-types.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import type { FinalLevelZone } from "../lib/levels/level-types.js";
import { CandleFetchService, type HistoricalFetchRequest } from "../lib/market-data/candle-fetch-service.js";
import { finalizeCandleProviderResponse } from "../lib/market-data/candle-quality.js";
import type {
  BaseCandleProviderResponse,
  Candle,
  CandleProviderResponse,
  CandleTimeframe,
} from "../lib/market-data/candle-types.js";
import {
  buildChartThesisRead,
  buildSmallCapTradeSetupReadsForQa,
  buildTradeSetupChartThesisRead,
  buildWatchlistChartThesisRead,
} from "../lib/monitoring/chart-thesis-engine.js";
import { buildTechnicalContextFromCandles } from "../lib/technical-context/technical-context.js";
import { buildLiveWatchlistLevelMap } from "../lib/live-watchlist/live-watchlist-publisher.js";
import {
  buildLiveWatchlistTradeSetupRead,
  type LiveWatchlistTradeSetupRead,
  type LiveWatchlistTradeSetupState,
} from "../lib/live-watchlist/trade-setup-read.js";
import type { LiveWatchlistLevelDataQuality } from "../lib/live-watchlist/live-watchlist-types.js";
import { aggregateCandlesToFiveMinutes } from "../lib/support-resistance/single-timeframe-context.js";
import {
  ValidationCachedCandleFetchService,
  type ValidationCandleCacheMode,
} from "../lib/validation/validation-candle-cache.js";

type RunnerRow = {
  symbol: string;
  runnerDate: string;
  marketCap: number;
  runnerScorePct: number;
  activeCutoffTimestamp: number | null;
  activeCutoffIso: string | null;
  catalystCard?: {
    label: "same_day" | "recent_1_2_days" | "stale_3_7_days" | "no_card" | "lookup_unavailable";
  };
};

type RunnerBasket = {
  generatedAt: string;
  settings: {
    horizonBars?: number;
    runnersPerDay?: number;
    maxMarketCap?: number;
  };
  activeRunnerDays: RunnerRow[];
  extraUsableRunnerDays?: RunnerRow[];
};

type QaSample = {
  symbol: string;
  cutoffTimestamp: number;
  cutoffIso: string;
  currentPrice: number;
  thesis?: ChartThesisRead | null;
  outcome?: string;
  bestForwardPct?: number;
  worstForwardPct?: number;
  summary?: string;
};

type QaReport = {
  generatedAt: string;
  samples: QaSample[];
  missedMoves: QaSample[];
  noThesisBelowMeaningfulForwardRows: QaSample[];
};

type ReplayOutcome =
  | "target_before_invalidation"
  | "invalidation_before_target"
  | "same_bar_ambiguous_conservative_loss"
  | "failed_before_trigger"
  | "triggered_no_resolution"
  | "never_triggered"
  | "abstained_missed_25pct_move"
  | "abstained_no_25pct_move"
  | "unscorable";

type ReplayRow = {
  symbol: string;
  runnerDate: string;
  cutoffIso: string;
  marketCap: number;
  runnerScorePct: number;
  currentPrice: number;
  sourceFourHourCandleTimestamp: string;
  candleProviders: Partial<Record<CandleTimeframe, string>>;
  candleCountsAtCutoff: Partial<Record<CandleTimeframe, number>>;
  causalPartialFourHourCandle: Candle | null;
  thesis: ChartThesisRead | null;
  legacyWatchlistThesis: ChartThesisRead | null;
  bestAnyThesis: ChartThesisRead | null;
  originalQaThesis: ChartThesisRead | null;
  originalThesisOutcome: string | null;
  tradeSetupRead: LiveWatchlistTradeSetupRead;
  broaderCandidateTradeSetupRead: LiveWatchlistTradeSetupRead | null;
  replayOutcome: ReplayOutcome;
  shadowReplayOutcome: ReplayOutcome | null;
  broaderCandidateReplayOutcome: ReplayOutcome | null;
  broaderCandidateShadowReplayOutcome: ReplayOutcome | null;
  v2FamilyReplays: Array<{
    thesis: ChartThesisRead;
    tradeSetupRead: LiveWatchlistTradeSetupRead;
    replayOutcome: ReplayOutcome;
    shadowReplayOutcome: ReplayOutcome | null;
  }>;
  forwardBars: number;
  bestForwardPct: number | null;
  worstForwardPct: number | null;
  triggerObservedAt: string | null;
  resolutionObservedAt: string | null;
  limitations: string[];
};

const DEFAULT_BASKET_PATH = join(
  "artifacts",
  "chart-thesis-qa-report-eodhd-under30m-runners-200",
  "selected-runner-basket.json",
);
const DEFAULT_QA_REPORT_PATH = join(
  "artifacts",
  "chart-thesis-qa-report-eodhd-under30m-runners-200",
  "active-runner-trader-read",
  "chart-thesis-qa-report.json",
);
const DEFAULT_OUTPUT_DIRECTORY = join("artifacts", "eodhd-trade-setup-read-replay");
const FIVE_MINUTE_MS = 5 * 60 * 1000;
const FOUR_HOUR_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MEANINGFUL_MOVE_PCT = 25;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function positiveIntegerArg(flag: string): number | null {
  const raw = argValue(flag);
  if (!raw) return null;
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${flag} value "${raw}".`);
  }
  return value;
}

function cacheModeArg(value: string | undefined): ValidationCandleCacheMode {
  if (value === "off" || value === "read_write" || value === "refresh" || value === "replay") {
    return value;
  }
  return "read_write";
}

function normalizeCandles(candles: Candle[]): Candle[] {
  return candles
    .filter((candle) =>
      Number.isFinite(candle.timestamp) &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close) &&
      candle.open > 0 &&
      candle.high >= candle.low &&
      candle.low > 0,
    )
    .sort((left, right) => left.timestamp - right.timestamp);
}

function truncateResponse(
  response: CandleProviderResponse,
  candleCutoffTimestamp: number,
  lookbackBars: number,
  requestedEndTimestamp = candleCutoffTimestamp,
): CandleProviderResponse {
  const candles = normalizeCandles(response.candles)
    .filter((candle) => candle.timestamp <= candleCutoffTimestamp)
    .slice(-lookbackBars);
  return {
    ...response,
    requestedLookbackBars: lookbackBars,
    candles,
    actualBarsReturned: candles.length,
    requestedEndTimestamp,
    fetchEndTimestamp: requestedEndTimestamp,
    stale: false,
    completenessStatus: candles.length > 0 ? "complete" : "empty",
  };
}

function appendCausalPartialFourHour(params: {
  response: CandleProviderResponse;
  fiveMinuteCandles: Candle[];
  firstRunnerBucketTimestamp: number;
  effectiveCutoffTimestamp: number;
}): CandleProviderResponse {
  const elapsedMs = params.effectiveCutoffTimestamp - params.firstRunnerBucketTimestamp;
  if (elapsedMs <= 0) return params.response;
  const bucketOffset = Math.floor((elapsedMs - 1) / FOUR_HOUR_MS) * FOUR_HOUR_MS;
  const bucketStart = params.firstRunnerBucketTimestamp + bucketOffset;
  if (params.response.candles.some((candle) => candle.timestamp === bucketStart)) {
    return params.response;
  }
  const sourceCandles = normalizeCandles(params.fiveMinuteCandles)
    .filter((candle) => candle.timestamp >= bucketStart && candle.timestamp < params.effectiveCutoffTimestamp);
  if (sourceCandles.length === 0) return params.response;
  const partialCandle: Candle = {
    timestamp: bucketStart,
    open: sourceCandles[0]!.open,
    high: Math.max(...sourceCandles.map((candle) => candle.high)),
    low: Math.min(...sourceCandles.map((candle) => candle.low)),
    close: sourceCandles.at(-1)!.close,
    volume: sourceCandles.reduce((sum, candle) => sum + candle.volume, 0),
  };
  const candles = [...params.response.candles, partialCandle]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-params.response.requestedLookbackBars);
  return {
    ...params.response,
    candles,
    actualBarsReturned: candles.length,
    completenessStatus: "partial",
    stale: false,
    providerMetadata: {
      ...params.response.providerMetadata,
      replayPartialFourHourFromCompletedFiveMinuteBars: true,
      replayPartialFourHourSourceBars: sourceCandles.length,
    },
  };
}

function aggregateOneMinuteResponse(
  response: CandleProviderResponse,
  requestedLookbackBars: number,
): CandleProviderResponse {
  const candles = aggregateCandlesToFiveMinutes(response.candles).slice(-requestedLookbackBars);
  const base: BaseCandleProviderResponse = {
    provider: response.provider,
    symbol: response.symbol,
    timeframe: "5m",
    requestedLookbackBars,
    candles,
    fetchStartTimestamp: response.fetchStartTimestamp,
    fetchEndTimestamp: response.fetchEndTimestamp,
    requestedStartTimestamp: response.requestedStartTimestamp,
    requestedEndTimestamp: response.requestedEndTimestamp,
    sessionMetadataAvailable: response.sessionMetadataAvailable,
    providerMetadata: {
      ...(response.providerMetadata ?? {}),
      sourceTimeframe: "1m",
      derivedTimeframe: "5m",
      aggregationMethod: "ohlcv_1m_to_5m",
    },
  };
  return finalizeCandleProviderResponse(base);
}

function sourceLabel(zone: FinalLevelZone): string {
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
  if (zone.isExtension) return "extension";
  const timeframes = new Set(zone.timeframeSources);
  if (timeframes.has("daily")) return zone.timeframeSources.length > 1 ? "daily confluence" : "daily structure";
  if (timeframes.has("4h")) return zone.timeframeSources.length > 1 ? "4h confluence" : "4h structure";
  if (timeframes.has("5m")) return zone.freshness === "fresh" ? "fresh intraday" : "intraday";
  return "price structure";
}

function toDisplayZone(zone: FinalLevelZone) {
  return {
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
    sourceLabel: sourceLabel(zone),
    marketDataProvenance: zone.marketDataProvenance,
  };
}

function uniqueZones(zones: FinalLevelZone[]): FinalLevelZone[] {
  return [...new Map(zones.map((zone) => [zone.id, zone])).values()];
}

function latestCompleteRunnerDate(rows: RunnerRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.activeCutoffTimestamp !== null) {
      counts.set(row.runnerDate, (counts.get(row.runnerDate) ?? 0) + 1);
    }
  }
  const date = [...counts.entries()]
    .filter(([, count]) => count >= 5)
    .map(([candidate]) => candidate)
    .sort()
    .at(-1);
  if (!date) {
    throw new Error("No runner date contains five usable active-runner cutoffs.");
  }
  return date;
}

function qaRowsByKey(report: QaReport): Map<string, QaSample> {
  const rows = [
    ...report.samples,
    ...report.missedMoves,
    ...report.noThesisBelowMeaningfulForwardRows,
  ];
  return new Map(rows.map((row) => [`${row.symbol.toUpperCase()}:${row.cutoffTimestamp}`, row]));
}

function minMaxForwardPct(candles: Candle[], currentPrice: number): {
  bestForwardPct: number | null;
  worstForwardPct: number | null;
} {
  if (candles.length === 0 || currentPrice <= 0) {
    return { bestForwardPct: null, worstForwardPct: null };
  }
  return {
    bestForwardPct: ((Math.max(...candles.map((candle) => candle.high)) - currentPrice) / currentPrice) * 100,
    worstForwardPct: ((Math.min(...candles.map((candle) => candle.low)) - currentPrice) / currentPrice) * 100,
  };
}

function evaluateRead(params: {
  read: LiveWatchlistTradeSetupRead;
  forwardCandles: Candle[];
  currentPrice: number;
  evaluatedAt: number;
  stateOverride?: LiveWatchlistTradeSetupState;
}): {
  outcome: ReplayOutcome;
  triggerObservedAt: string | null;
  resolutionObservedAt: string | null;
} {
  const { read, forwardCandles, currentPrice } = params;
  const effectiveState = params.stateOverride ?? read.state;
  const bestForwardPct = forwardCandles.length === 0
    ? null
    : ((Math.max(...forwardCandles.map((candle) => candle.high)) - currentPrice) / currentPrice) * 100;
  if (effectiveState === "no_trade" || effectiveState === "failed" || effectiveState === "extended_risk") {
    return {
      outcome: bestForwardPct !== null && bestForwardPct >= MEANINGFUL_MOVE_PCT
        ? "abstained_missed_25pct_move"
        : "abstained_no_25pct_move",
      triggerObservedAt: null,
      resolutionObservedAt: null,
    };
  }
  const target = read.targets[0]?.price;
  const invalidation = read.invalidationPrice;
  const trigger = read.triggerPrice;
  if (!target || !invalidation || !trigger || forwardCandles.length === 0) {
    return { outcome: "unscorable", triggerObservedAt: null, resolutionObservedAt: null };
  }

  let triggered = effectiveState === "triggered";
  let triggerObservedAt = triggered ? new Date(params.evaluatedAt).toISOString() : null;
  for (const candle of forwardCandles) {
    const timestamp = new Date(candle.timestamp).toISOString();
    if (!triggered) {
      if (candle.low <= invalidation && candle.high < trigger) {
        return { outcome: "failed_before_trigger", triggerObservedAt: null, resolutionObservedAt: timestamp };
      }
      if (candle.high < trigger) {
        continue;
      }
      triggered = true;
      triggerObservedAt = timestamp;
    }

    const targetHit = candle.high >= target;
    const invalidationHit = candle.low <= invalidation;
    if (targetHit && invalidationHit) {
      return {
        outcome: "same_bar_ambiguous_conservative_loss",
        triggerObservedAt,
        resolutionObservedAt: timestamp,
      };
    }
    if (invalidationHit) {
      return { outcome: "invalidation_before_target", triggerObservedAt, resolutionObservedAt: timestamp };
    }
    if (targetHit) {
      return { outcome: "target_before_invalidation", triggerObservedAt, resolutionObservedAt: timestamp };
    }
  }
  return {
    outcome: triggered ? "triggered_no_resolution" : "never_triggered",
    triggerObservedAt,
    resolutionObservedAt: null,
  };
}

function countBy(rows: ReplayRow[], value: (row: ReplayRow) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = value(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function price(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function renderMarkdown(report: {
  generatedAt: string;
  runnerDate: string;
  sourceBasket: string;
  checkpointDescription: string;
  forwardDescription: string;
  totals: Record<string, unknown>;
  stateCounts: Record<string, number>;
  replayOutcomeCounts: Record<string, number>;
  rows: ReplayRow[];
}): string {
  const lines = [
    "# EODHD Trade Setup Read Replay",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Runner date: ${report.runnerDate}`,
    `- Basket: ${report.sourceBasket}`,
    `- Tickers: ${report.rows.length}`,
    `- Cutoff: ${report.checkpointDescription}`,
    "- Look-ahead control: the same-day daily candle is excluded because it was not complete at the cutoff",
    `- Forward grading: ${report.forwardDescription}`,
    "- Spread: unavailable by design in this historical replay; no candle-derived spread was invented",
    "- Excluded context: live order book, live partial-volume delta, and formal runtime Market Structure state",
    "",
    "## Counts",
    "",
    `- Setup states: ${Object.entries(report.stateCounts).map(([key, count]) => `${key}=${count}`).join(", ")}`,
    `- Replay outcomes: ${Object.entries(report.replayOutcomeCounts).map(([key, count]) => `${key}=${count}`).join(", ")}`,
    "",
    "## Tickers",
    "",
  ];
  for (const row of report.rows) {
    lines.push(
      `### ${row.symbol}`,
      "",
      `- Price at cutoff: ${price(row.currentPrice)}`,
      `- Candle thesis: ${row.thesis ? `${row.thesis.label} (${row.thesis.confidence})` : "none"}`,
      `- V2 small-cap candidates: ${row.v2FamilyReplays.length > 0 ? row.v2FamilyReplays.map((item) => item.thesis.type).join(", ") : "none"}`,
      `- Best broader-engine thesis: ${row.bestAnyThesis ? `${row.bestAnyThesis.label} (${row.bestAnyThesis.confidence})` : "none"}`,
      `- Broader-candidate setup state: ${row.broaderCandidateTradeSetupRead ? `${row.broaderCandidateTradeSetupRead.state}; ${row.broaderCandidateTradeSetupRead.blockers[0] ?? "no blocker"}` : "not applicable"}`,
      `- New Trade Setup state: ${row.tradeSetupRead.state}; actionable=${row.tradeSetupRead.actionable ? "yes" : "no"}`,
      `- Dip zone: ${row.tradeSetupRead.zone ? `${price(row.tradeSetupRead.zone.low)}-${price(row.tradeSetupRead.zone.high)}` : "none"}`,
      `- Trigger / invalidation / T1: ${price(row.tradeSetupRead.triggerPrice)} / ${price(row.tradeSetupRead.invalidationPrice)} / ${price(row.tradeSetupRead.targets[0]?.price)}`,
      `- Planned risk / T1 skew: ${row.tradeSetupRead.plannedRiskPct === null ? "n/a" : `${row.tradeSetupRead.plannedRiskPct.toFixed(1)}%`} / ${row.tradeSetupRead.firstTargetRewardRiskRatio === null ? "n/a" : `${row.tradeSetupRead.firstTargetRewardRiskRatio.toFixed(1)}R`}`,
      `- Primary blocker: ${row.tradeSetupRead.blockers[0] ?? "none"}`,
      `- Forward result: ${row.replayOutcome}; best ${row.bestForwardPct === null ? "n/a" : `${row.bestForwardPct.toFixed(1)}%`}, worst ${row.worstForwardPct === null ? "n/a" : `${row.worstForwardPct.toFixed(1)}%`}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderCohortMarkdown(report: {
  generatedAt: string;
  runnerDates: string[];
  totals: Record<string, number>;
  stateCounts: Record<string, number>;
  primaryBlockerCounts: Record<string, number>;
  cleanMisses: ReplayRow[];
}): string {
  const lines = [
    "# EODHD Trade Setup Read Replay Cohort",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Runner dates: ${report.runnerDates.join(", ")}`,
    `- Top-five runner samples: ${report.totals.runners}`,
    `- Corrected candle theses: ${report.totals.candleTheses}`,
    `- Trade zones built: ${report.totals.zonesBuilt}`,
    `- Actionable at cutoff: ${report.totals.actionableAtCutoff}`,
    `- Forward drawdown at least 20%: ${report.totals.forwardDrawdown20Pct}`,
    `- Forward move at least 25%: ${report.totals.forwardMove25Pct}`,
    `- Both 25% move and 20% drawdown: ${report.totals.moveAndDamage}`,
    `- Clean retrospective misses (25% move, drawdown better than -15%): ${report.totals.cleanMisses}`,
    "- Spread, live order book, partial-volume delta, and formal runtime Market Structure were unavailable and were not inferred",
    "",
    "## Setup states",
    "",
    ...Object.entries(report.stateCounts).map(([state, count]) => `- ${state}: ${count}`),
    "",
    "## Primary blockers on accepted candle theses",
    "",
    ...Object.entries(report.primaryBlockerCounts)
      .sort(([, left], [, right]) => right - left)
      .map(([blocker, count]) => `- ${count}x ${blocker}`),
    "",
    "## Clean retrospective misses",
    "",
    ...report.cleanMisses.map((row) =>
      `- ${row.runnerDate} ${row.symbol}: best +${row.bestForwardPct!.toFixed(1)}%, worst ${row.worstForwardPct!.toFixed(1)}%, ` +
      `${row.thesis ? `${row.thesis.label}; ${row.tradeSetupRead.blockers[0] ?? row.tradeSetupRead.state}` : "no candle thesis"}`,
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

const basketPath = argValue("--basket") ?? DEFAULT_BASKET_PATH;
const qaReportPath = argValue("--qa-report") ?? DEFAULT_QA_REPORT_PATH;
const outputDirectory = argValue("--out-dir") ?? DEFAULT_OUTPUT_DIRECTORY;
const cacheDirectory = argValue("--cache-dir") ?? join(process.cwd(), ".validation-cache", "candles");
const cacheMode = cacheModeArg(argValue("--cache-mode"));

const basket = JSON.parse(await readFile(basketPath, "utf8")) as RunnerBasket;
const qaReport = JSON.parse(await readFile(qaReportPath, "utf8")) as QaReport;
const allRunnerDays = hasFlag("--all-runner-days");
const intradaySession = hasFlag("--intraday-session");
const reconstructLiveFourHour = hasFlag("--reconstruct-live-four-hour");
const tradeSetupV2 = hasFlag("--trade-setup-v2");
if (reconstructLiveFourHour && !intradaySession) {
  throw new Error("--reconstruct-live-four-hour is only valid with --intraday-session.");
}
const checkpointMinutesAfterOpen = positiveIntegerArg("--checkpoint-minutes-after-open") ?? 240;
if (checkpointMinutesAfterOpen > 385) {
  throw new Error("--checkpoint-minutes-after-open must be 385 or less so at least one forward 5m bar remains.");
}
const dateFrom = argValue("--date-from") ?? null;
const dateTo = argValue("--date-to") ?? null;
const maxSamples = positiveIntegerArg("--max-samples");
const combinedBasketRows = [
  ...basket.activeRunnerDays,
  ...(basket.extraUsableRunnerDays ?? []),
];
const uniqueBasketRows = [...new Map(combinedBasketRows.map((runner) => [
  `${runner.symbol.toUpperCase()}:${runner.activeCutoffTimestamp}`,
  runner,
])).values()];
const defaultRunnerDate = latestCompleteRunnerDate(uniqueBasketRows);
const requestedRunnerDate = argValue("--runner-date") ?? defaultRunnerDate;
const runnerDate = allRunnerDays ? "all-usable-runner-days" : requestedRunnerDate;
const eligibleRunners = uniqueBasketRows
  .filter((runner) =>
    runner.activeCutoffTimestamp !== null &&
    (dateFrom === null || runner.runnerDate >= dateFrom) &&
    (dateTo === null || runner.runnerDate <= dateTo),
  );
const runners = allRunnerDays
  ? [...new Map(
      [...new Set(eligibleRunners.map((runner) => runner.runnerDate))]
        .sort((left, right) => right.localeCompare(left))
        .flatMap((date) => eligibleRunners
          .filter((runner) => runner.runnerDate === date)
          .sort((left, right) => right.runnerScorePct - left.runnerScorePct)
          .slice(0, 5))
        .map((runner) => [`${runner.symbol.toUpperCase()}:${runner.activeCutoffTimestamp}`, runner]),
    ).values()].slice(0, maxSamples ?? Number.POSITIVE_INFINITY)
  : eligibleRunners
      .filter((runner) => runner.runnerDate === requestedRunnerDate)
      .sort((left, right) => right.runnerScorePct - left.runnerScorePct)
      .slice(0, 5);
if ((!allRunnerDays && runners.length !== 5) || (allRunnerDays && runners.length === 0)) {
  throw new Error(`Expected five active runners for ${runnerDate}, found ${runners.length}.`);
}

const qaByKey = qaRowsByKey(qaReport);
const artifactDay = Date.parse(`${basket.generatedAt.slice(0, 10)}T00:00:00.000Z`);
const dailyDataEndTime = artifactDay;
const fourHourDataEndTime = artifactDay + DAY_MS;
const eodhdService = new ValidationCachedCandleFetchService(
  new CandleFetchService({ providerName: "eodhd" }),
  { cacheDirectoryPath: cacheDirectory, mode: cacheMode },
);
const yahooService = new ValidationCachedCandleFetchService(
  new CandleFetchService({ providerName: "yahoo" }),
  { cacheDirectoryPath: cacheDirectory, mode: cacheMode },
);

async function fetchBestFiveMinute(symbol: string, endTimeMs: number): Promise<CandleProviderResponse> {
  const requests: Array<() => Promise<CandleProviderResponse>> = [
    () => eodhdService.fetchCandles({
      symbol,
      timeframe: "5m",
      lookbackBars: 210,
      endTimeMs,
      preferredProvider: "eodhd",
    }),
    async () => aggregateOneMinuteResponse(await eodhdService.fetchCandles({
      symbol,
      timeframe: "1m",
      lookbackBars: 1_050,
      endTimeMs,
      preferredProvider: "eodhd",
    }), 210),
    () => yahooService.fetchCandles({
      symbol,
      timeframe: "5m",
      lookbackBars: 210,
      endTimeMs,
      preferredProvider: "yahoo",
    }),
  ];
  let lastError: unknown = null;
  for (const request of requests) {
    try {
      const response = await request();
      if (response.candles.length > 0) return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`No 5m candles available for ${symbol}.`);
}

const rows: ReplayRow[] = [];
for (const [runnerIndex, runner] of runners.entries()) {
  const cutoffTimestamp = runner.activeCutoffTimestamp!;
  const effectiveCutoffTimestamp = cutoffTimestamp + checkpointMinutesAfterOpen * 60 * 1000;
  const sessionCloseTimestamp = cutoffTimestamp + 390 * 60 * 1000;
  const runnerDayStart = Date.parse(`${runner.runnerDate}T00:00:00.000Z`);
  const qaRow = qaByKey.get(`${runner.symbol.toUpperCase()}:${cutoffTimestamp}`);
  console.log(`[TradeSetupReplay] ${runnerIndex + 1}/${runners.length} ${runner.runnerDate} ${runner.symbol} loading candles...`);
  const [dailyFull, fourHourFull, fiveMinuteResult] = await Promise.all([
    eodhdService.fetchCandles({
      symbol: runner.symbol,
      timeframe: "daily",
      lookbackBars: 180,
      endTimeMs: dailyDataEndTime,
      preferredProvider: "eodhd",
    }),
    eodhdService.fetchCandles({
      symbol: runner.symbol,
      timeframe: "4h",
      lookbackBars: 900,
      endTimeMs: fourHourDataEndTime,
      preferredProvider: "eodhd",
    }),
    fetchBestFiveMinute(
      runner.symbol,
      intradaySession ? sessionCloseTimestamp : effectiveCutoffTimestamp,
    )
      .then((response) => ({ response, error: null as string | null }))
      .catch((error) => ({
        response: null,
        error: error instanceof Error ? error.message : String(error),
      })),
  ]);
  const daily = truncateResponse(dailyFull, runnerDayStart - 1, 180);
  const completedFourHourCutoff = effectiveCutoffTimestamp >= cutoffTimestamp + FOUR_HOUR_MS
    ? cutoffTimestamp
    : cutoffTimestamp - 1;
  const fourHour = truncateResponse(
    fourHourFull,
    completedFourHourCutoff,
    900,
    effectiveCutoffTimestamp,
  );
  const fiveMinute = fiveMinuteResult.response
    ? truncateResponse(
        fiveMinuteResult.response,
        effectiveCutoffTimestamp - FIVE_MINUTE_MS,
        210,
        effectiveCutoffTimestamp,
      )
    : null;
  const analysisFourHour = reconstructLiveFourHour && fiveMinute
    ? appendCausalPartialFourHour({
        response: fourHour,
        fiveMinuteCandles: fiveMinute.candles,
        firstRunnerBucketTimestamp: cutoffTimestamp,
        effectiveCutoffTimestamp,
      })
    : fourHour;
  const causalPartialFourHourCandle = reconstructLiveFourHour &&
      analysisFourHour.candles.length > fourHour.candles.length
    ? analysisFourHour.candles.at(-1) ?? null
    : null;
  const currentPrice = intradaySession
    ? fiveMinute?.candles.at(-1)?.close ?? null
    : fourHour.candles.find((candle) => candle.timestamp === cutoffTimestamp)?.close ??
      qaRow?.currentPrice ??
      null;
  if (currentPrice === null || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error(`No valid cutoff price found for ${runner.symbol} at ${new Date(effectiveCutoffTimestamp).toISOString()}.`);
  }
  if (
    causalPartialFourHourCandle &&
    Math.abs(causalPartialFourHourCandle.close - currentPrice) > Math.max(0.000001, currentPrice * 0.000001)
  ) {
    throw new Error(`Causal partial 4h close does not match the completed-5m cutoff price for ${runner.symbol}.`);
  }
  const seriesMap: Record<"daily" | "4h" | "5m", CandleProviderResponse> = {
    daily,
    "4h": analysisFourHour,
    "5m": fiveMinute ?? {
      ...fourHour,
      timeframe: "5m",
      requestedLookbackBars: 210,
      candles: [],
      actualBarsReturned: 0,
      completenessStatus: "empty",
      stale: true,
      validationIssues: [{
        code: "zero_results",
        severity: "error",
        message: fiveMinuteResult.error ?? "5m candles unavailable",
      }],
    },
  };
  const replayFetchService = {
    getProviderName: () => "eodhd" as const,
    fetchCandles: async (request: HistoricalFetchRequest): Promise<CandleProviderResponse> => {
      if (request.timeframe === "daily" || request.timeframe === "4h" || request.timeframe === "5m") {
        return seriesMap[request.timeframe];
      }
      throw new Error(`Unsupported replay timeframe ${request.timeframe}.`);
    },
  };
  const levelEngine = new LevelEngine(replayFetchService as unknown as CandleFetchService);
  const { output } = await levelEngine.generateLevelsWithCandleSeries({
    symbol: runner.symbol,
    referencePriceOverride: currentPrice,
    historicalRequests: {
      daily: { symbol: runner.symbol, timeframe: "daily", lookbackBars: 180, endTimeMs: effectiveCutoffTimestamp },
      "4h": { symbol: runner.symbol, timeframe: "4h", lookbackBars: 900, endTimeMs: effectiveCutoffTimestamp },
      "5m": { symbol: runner.symbol, timeframe: "5m", lookbackBars: 210, endTimeMs: effectiveCutoffTimestamp },
    },
  });
  const technicalContext = fiveMinute && fiveMinute.candles.length > 0
    ? buildTechnicalContextFromCandles({
        candles: fiveMinute.candles,
        currentPrice,
        provider: fiveMinute.provider,
        sessionDate: runner.runnerDate,
        dataQualityFlags: fiveMinute.validationIssues.map((issue) => `5m:${issue.code}`),
      })
    : null;
  const supportZones = uniqueZones([
    ...output.majorSupport,
    ...output.intermediateSupport,
    ...output.intradaySupport,
    ...output.extensionLevels.support,
  ]);
  const resistanceZones = uniqueZones([
    ...output.majorResistance,
    ...output.intermediateResistance,
    ...output.intradayResistance,
    ...output.extensionLevels.resistance,
  ]);
  const availableTimeframes = (["daily", "4h", "5m"] as const)
    .filter((timeframe) => seriesMap[timeframe].candles.length > 0);
  const dataQuality: LiveWatchlistLevelDataQuality = {
    status: availableTimeframes.length === 3 ? "full" : "limited",
    availableTimeframes: [...availableTimeframes],
    flags: output.metadata.dataQualityFlags,
  };
  const levelMap = buildLiveWatchlistLevelMap({
    currentPrice,
    supportZones: supportZones.map(toDisplayZone),
    resistanceZones: resistanceZones.map(toDisplayZone),
    preferStructuralLevels: true,
    specialLevels: output.specialLevels,
    technicalContext,
    dataQuality,
    selectionMode: "trade_setup",
  });
  const thesisInput = {
    symbol: runner.symbol,
    currentPrice,
    seriesMap,
    activeRunnerContext: {
      activeRunner: true,
      catalystCardFreshness: runner.catalystCard?.label ?? "lookup_unavailable",
    },
  } satisfies Parameters<typeof buildWatchlistChartThesisRead>[0];
  const legacyWatchlistThesis = buildWatchlistChartThesisRead(thesisInput);
  const thesis = tradeSetupV2
    ? buildTradeSetupChartThesisRead(thesisInput)
    : legacyWatchlistThesis;
  const v2FamilyTheses = tradeSetupV2
    ? buildSmallCapTradeSetupReadsForQa(thesisInput)
    : [];
  const bestAnyThesis = buildChartThesisRead(thesisInput);
  const read = buildLiveWatchlistTradeSetupRead({
    symbol: runner.symbol,
    currentPrice,
    evaluatedAt: effectiveCutoffTimestamp,
    thesis,
    levelMap,
    technicalContext,
    marketStructure: null,
    bidPrice: null,
    askPrice: null,
  });
  const broaderCandidateRead = thesis === null && bestAnyThesis !== null
    ? buildLiveWatchlistTradeSetupRead({
        symbol: runner.symbol,
        currentPrice,
        evaluatedAt: effectiveCutoffTimestamp,
        thesis: bestAnyThesis,
        levelMap,
        technicalContext,
        marketStructure: null,
        bidPrice: null,
        askPrice: null,
      })
    : null;
  const forwardCandles = intradaySession
    ? normalizeCandles(fiveMinuteResult.response?.candles ?? [])
        .filter((candle) =>
          candle.timestamp >= effectiveCutoffTimestamp &&
          candle.timestamp < sessionCloseTimestamp,
        )
    : normalizeCandles(fourHourFull.candles)
        .filter((candle) => candle.timestamp > cutoffTimestamp)
        .slice(0, basket.settings.horizonBars ?? 10);
  const movement = minMaxForwardPct(forwardCandles, currentPrice);
  const evaluated = evaluateRead({
    read,
    forwardCandles,
    currentPrice,
    evaluatedAt: effectiveCutoffTimestamp,
  });
  const stateBeforeBlockersRaw = read.metadata.tradeSetupStateBeforeBlockers;
  const stateBeforeBlockers = typeof stateBeforeBlockersRaw === "string"
    ? stateBeforeBlockersRaw as LiveWatchlistTradeSetupState
    : null;
  const shadowEvaluated = stateBeforeBlockers === null
    ? null
    : evaluateRead({
        read,
        forwardCandles,
        currentPrice,
        evaluatedAt: effectiveCutoffTimestamp,
        stateOverride: stateBeforeBlockers,
      });
  const broaderCandidateEvaluated = broaderCandidateRead === null
    ? null
    : evaluateRead({
        read: broaderCandidateRead,
        forwardCandles,
        currentPrice,
        evaluatedAt: effectiveCutoffTimestamp,
      });
  const broaderCandidateStateBeforeBlockersRaw =
    broaderCandidateRead?.metadata.tradeSetupStateBeforeBlockers;
  const broaderCandidateStateBeforeBlockers = typeof broaderCandidateStateBeforeBlockersRaw === "string"
    ? broaderCandidateStateBeforeBlockersRaw as LiveWatchlistTradeSetupState
    : null;
  const broaderCandidateShadowEvaluated = broaderCandidateRead === null || broaderCandidateStateBeforeBlockers === null
    ? null
    : evaluateRead({
        read: broaderCandidateRead,
        forwardCandles,
        currentPrice,
        evaluatedAt: effectiveCutoffTimestamp,
        stateOverride: broaderCandidateStateBeforeBlockers,
      });
  const v2FamilyReplays = v2FamilyTheses.map((familyThesis) => {
    const familyRead = buildLiveWatchlistTradeSetupRead({
      symbol: runner.symbol,
      currentPrice,
      evaluatedAt: effectiveCutoffTimestamp,
      thesis: familyThesis,
      levelMap,
      technicalContext,
      marketStructure: null,
      bidPrice: null,
      askPrice: null,
    });
    const familyEvaluated = evaluateRead({
      read: familyRead,
      forwardCandles,
      currentPrice,
      evaluatedAt: effectiveCutoffTimestamp,
    });
    const familyStateBeforeBlockersRaw = familyRead.metadata.tradeSetupStateBeforeBlockers;
    const familyStateBeforeBlockers = typeof familyStateBeforeBlockersRaw === "string"
      ? familyStateBeforeBlockersRaw as LiveWatchlistTradeSetupState
      : null;
    const familyShadowEvaluated = familyStateBeforeBlockers === null
      ? null
      : evaluateRead({
          read: familyRead,
          forwardCandles,
          currentPrice,
          evaluatedAt: effectiveCutoffTimestamp,
          stateOverride: familyStateBeforeBlockers,
        });
    return {
      thesis: familyThesis,
      tradeSetupRead: familyRead,
      replayOutcome: familyEvaluated.outcome,
      shadowReplayOutcome: familyShadowEvaluated?.outcome ?? null,
    };
  });
  rows.push({
    symbol: runner.symbol,
    runnerDate: runner.runnerDate,
    cutoffIso: new Date(effectiveCutoffTimestamp).toISOString(),
    marketCap: runner.marketCap,
    runnerScorePct: runner.runnerScorePct,
    currentPrice,
    sourceFourHourCandleTimestamp: new Date(cutoffTimestamp).toISOString(),
    candleProviders: {
      daily: daily.provider,
      "4h": fourHour.provider,
      ...(fiveMinute ? { "5m": fiveMinute.provider } : {}),
    },
    candleCountsAtCutoff: {
      daily: daily.candles.length,
      "4h": analysisFourHour.candles.length,
      "5m": fiveMinute?.candles.length ?? 0,
    },
    causalPartialFourHourCandle,
    thesis,
    legacyWatchlistThesis,
    bestAnyThesis,
    originalQaThesis: qaRow?.thesis ?? null,
    originalThesisOutcome: qaRow?.outcome ?? null,
    tradeSetupRead: read,
    broaderCandidateTradeSetupRead: broaderCandidateRead,
    replayOutcome: evaluated.outcome,
    shadowReplayOutcome: shadowEvaluated?.outcome ?? null,
    broaderCandidateReplayOutcome: broaderCandidateEvaluated?.outcome ?? null,
    broaderCandidateShadowReplayOutcome: broaderCandidateShadowEvaluated?.outcome ?? null,
    v2FamilyReplays,
    forwardBars: forwardCandles.length,
    bestForwardPct: movement.bestForwardPct,
    worstForwardPct: movement.worstForwardPct,
    triggerObservedAt: evaluated.triggerObservedAt,
    resolutionObservedAt: evaluated.resolutionObservedAt,
    limitations: [
      "historical spread unavailable",
      "historical partial-volume delta unavailable",
      "formal runtime Market Structure snapshot unavailable",
      reconstructLiveFourHour
        ? "in-progress 4h candle reconstructed only from completed historical 5m bars"
        : "only completed provider 4h candles are visible",
      intradaySession
        ? "5m forward bars cannot order target and invalidation inside the same candle"
        : "4h forward bars cannot order target and invalidation inside the same candle",
      ...(fiveMinuteResult.error ? [`5m fallback unavailable: ${fiveMinuteResult.error}`] : []),
    ],
  });
  console.log(`[TradeSetupReplay] ${runnerIndex + 1}/${runners.length} ${runner.symbol} state=${read.state} outcome=${evaluated.outcome}`);
}

const generatedAt = new Date().toISOString();
const report = {
  generatedAt,
  runnerDate,
  sourceBasket: basketPath,
  sourceQaReport: qaReportPath,
  checkpointDescription: intradaySession
    ? `${checkpointMinutesAfterOpen} minutes after the 09:30 ET open`
    : "end of the first completed regular-session 4h runner candle (normally 13:30 ET)",
  forwardDescription: intradaySession
    ? "remaining same-session completed 5m bars; same-bar target/invalidation is scored conservatively as a loss"
    : "next 10 completed 4h bars; same-bar target/invalidation is scored conservatively as a loss",
  settings: {
    topRunnersPerDay: 5,
    allRunnerDays,
    intradaySession,
    reconstructLiveFourHour,
    tradeSetupModel: tradeSetupV2 ? "v2_small_cap" : "v1_approved_chart_thesis",
    checkpointMinutesAfterOpen,
    dateFrom,
    dateTo,
    maxMarketCap: basket.settings.maxMarketCap ?? null,
    forwardBars: intradaySession ? null : basket.settings.horizonBars ?? 10,
    forwardTimeframe: intradaySession ? "5m_same_session" : "4h_next_10_bars",
    spreadMode: "unknown_not_estimated",
    marketStructureMode: "unavailable_not_inferred",
  },
  totals: {
    runners: rows.length,
    candleTheses: rows.filter((row) => row.thesis !== null).length,
    zonesBuilt: rows.filter((row) => row.tradeSetupRead.zone !== null).length,
    actionableAtCutoff: rows.filter((row) => row.tradeSetupRead.actionable).length,
    causalPartialFourHourRows: rows.filter((row) => row.causalPartialFourHourCandle !== null).length,
    abstainedMissed25PctMove: rows.filter((row) => row.replayOutcome === "abstained_missed_25pct_move").length,
  },
  stateCounts: countBy(rows, (row) => row.tradeSetupRead.state),
  replayOutcomeCounts: countBy(rows, (row) => row.replayOutcome),
  primaryBlockerCounts: countBy(rows, (row) => row.tradeSetupRead.blockers[0] ?? "none"),
  rows,
};
const baseName = allRunnerDays
  ? intradaySession
    ? `trade-setup-read-replay${tradeSetupV2 ? "-v2" : ""}-heavy-intraday-${checkpointMinutesAfterOpen}m${reconstructLiveFourHour ? "-live4h" : ""}-${rows.length}`
    : `trade-setup-read-replay${tradeSetupV2 ? "-v2" : ""}-heavy-${rows.length}`
  : `trade-setup-read-replay${tradeSetupV2 ? "-v2" : ""}-${runnerDate}`;
const jsonPath = join(outputDirectory, `${baseName}.json`);
const markdownPath = join(outputDirectory, `${baseName}.md`);
await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownPath, renderMarkdown(report), "utf8");

const replayFilePattern = /^trade-setup-read-replay-\d{4}-\d{2}-\d{2}\.json$/;
const replayFiles = (await readdir(outputDirectory)).filter((fileName) => replayFilePattern.test(fileName));
const cohortReports = await Promise.all(replayFiles.map(async (fileName) =>
  JSON.parse(await readFile(join(outputDirectory, fileName), "utf8")) as {
    runnerDate: string;
    rows: ReplayRow[];
  }
));
const cohortRows = cohortReports.flatMap((item) => item.rows);
const thesisRows = cohortRows.filter((row) => row.thesis !== null);
const cleanMisses = cohortRows
  .filter((row) =>
    row.bestForwardPct !== null &&
    row.worstForwardPct !== null &&
    row.bestForwardPct >= MEANINGFUL_MOVE_PCT &&
    row.worstForwardPct > -15,
  )
  .sort((left, right) => right.bestForwardPct! - left.bestForwardPct!);
const cohortReport = {
  generatedAt,
  runnerDates: cohortReports.map((item) => item.runnerDate).sort().reverse(),
  totals: {
    runners: cohortRows.length,
    candleTheses: thesisRows.length,
    zonesBuilt: cohortRows.filter((row) => row.tradeSetupRead.zone !== null).length,
    actionableAtCutoff: cohortRows.filter((row) => row.tradeSetupRead.actionable).length,
    forwardDrawdown20Pct: cohortRows.filter((row) =>
      row.worstForwardPct !== null && row.worstForwardPct <= -20
    ).length,
    forwardMove25Pct: cohortRows.filter((row) =>
      row.bestForwardPct !== null && row.bestForwardPct >= MEANINGFUL_MOVE_PCT
    ).length,
    moveAndDamage: cohortRows.filter((row) =>
      row.bestForwardPct !== null &&
      row.worstForwardPct !== null &&
      row.bestForwardPct >= MEANINGFUL_MOVE_PCT &&
      row.worstForwardPct <= -20
    ).length,
    cleanMisses: cleanMisses.length,
    cleanMissesWithoutThesis: cleanMisses.filter((row) => row.thesis === null).length,
    cleanMissesWithThesis: cleanMisses.filter((row) => row.thesis !== null).length,
  },
  stateCounts: countBy(cohortRows, (row) => row.tradeSetupRead.state),
  replayOutcomeCounts: countBy(cohortRows, (row) => row.replayOutcome),
  primaryBlockerCounts: countBy(thesisRows, (row) => row.tradeSetupRead.blockers[0] ?? "none"),
  cleanMisses,
};
await writeFile(
  join(outputDirectory, "trade-setup-read-replay-cohort.json"),
  `${JSON.stringify(cohortReport, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(outputDirectory, "trade-setup-read-replay-cohort.md"),
  renderCohortMarkdown(cohortReport),
  "utf8",
);
console.log(`[TradeSetupReplay] wrote ${jsonPath}`);
console.log(`[TradeSetupReplay] wrote ${markdownPath}`);
console.log(`[TradeSetupReplay] wrote ${join(outputDirectory, "trade-setup-read-replay-cohort.md")}`);
