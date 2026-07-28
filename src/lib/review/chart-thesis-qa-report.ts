import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ChartThesisRead } from "../alerts/alert-types.js";
import { isFreshActivePressReleaseCatalyst } from "../catalysts/press-release-catalyst-context.js";
import type { Candle, CandleProviderName, CandleProviderResponse, CandleTimeframe } from "../market-data/candle-types.js";
import {
  buildChartThesisRead,
  buildWatchlistChartThesisRead,
  type ChartThesisEngineInput,
} from "../monitoring/chart-thesis-engine.js";
import { evaluateLiveVolumeExpansionConfirmationQuality } from "../monitoring/live-confirmation-quality.js";
import {
  classifyWatchlistLifecycleScope,
  emptyLifecycleScopeCounts,
  type WatchlistLifecycleSampleScope,
  type WatchlistLifecycleSession,
} from "./watchlist-lifecycle-sessions.js";

export type ChartThesisQaOutcome =
  | "hit_target"
  | "partial_progress"
  | "invalidated"
  | "no_progress"
  | "insufficient_forward";

export type ChartThesisQaMissedMoveReason =
  | "news_or_gap_burst"
  | "below_recent_range"
  | "loose_or_damaged_range"
  | "possible_upper_range_setup"
  | "delayed_move_after_quiet_chart";

export type ChartThesisQaThesisRejection = {
  thesisType: string;
  nearMissScore: number;
  blockers: string[];
  diagnostics: Record<string, number | string | boolean | null>;
};

export type ChartThesisQaRejectionAudit = {
  closestThesisType: string;
  primaryBlockers: string[];
  thesisRejections: ChartThesisQaThesisRejection[];
};

export type ChartThesisQaMissedMove = {
  symbol: string;
  cutoffTimestamp: number;
  cutoffIso: string;
  lifecycleScope: WatchlistLifecycleSampleScope;
  currentPrice: number;
  liveConfirmation: ChartThesisQaLiveConfirmationRead;
  bestForwardPct: number;
  forwardBars: number;
  reason: ChartThesisQaMissedMoveReason;
  priorRangePct: number | null;
  priorRangePositionPct: number | null;
  firstForwardGapPct: number | null;
  firstForwardRangePct: number | null;
  evidence: string[];
  rejectionAudit: ChartThesisQaRejectionAudit;
  summary: string;
};

export type ChartThesisQaSample = {
  symbol: string;
  cutoffTimestamp: number;
  cutoffIso: string;
  lifecycleScope: WatchlistLifecycleSampleScope;
  currentPrice: number;
  liveConfirmation: ChartThesisQaLiveConfirmationRead;
  thesis: ChartThesisRead | null;
  outcome: ChartThesisQaOutcome;
  targetPrice: number | null;
  invalidationPrice: number | null;
  roomToTargetPct: number | null;
  bestForwardPct: number;
  worstForwardPct: number;
  targetReached: boolean;
  invalidatedBeforeTarget: boolean;
  barsToTarget: number | null;
  forwardBars: number;
  summary: string;
  lines: string[];
};

export type ChartThesisQaThesisStats = {
  thesisType: string;
  samples: number;
  hitTarget: number;
  partialProgress: number;
  invalidated: number;
  noProgress: number;
  insufficientForward: number;
  usefulCount: number;
  usefulRate: number;
  hitRate: number;
  invalidationRate: number;
  move15Count: number;
  move15Rate: number;
  move25Count: number;
  move25Rate: number;
  move50Count: number;
  move50Rate: number;
  statusCounts: Record<ChartThesisRead["status"], number>;
  lifecycleScopes: Record<WatchlistLifecycleSampleScope, number>;
  liveConfirmationPresent: number;
  liveConfirmationRate: number;
  avgRoomToTargetPct: number | null;
  avgBestForwardPct: number | null;
  avgWorstForwardPct: number | null;
};

export type ChartThesisQaLiveConfirmationRead = {
  present: boolean;
  participationPresent: boolean;
  participationStatus: "unavailable" | "confirmed_breakout" | "hot_extended" | "constructive" | "quiet_or_choppy";
  volumeRatio: number | null;
  latestRangePct: number | null;
  priorRangePct: number | null;
  closeExtensionPct: number | null;
  sessionPositionPct: number | null;
  triggerPrice: number | null;
  summary: string;
};

export type ChartThesisQaReport = {
  generatedAt: string;
  source: string;
  settings: {
    horizonBars: number;
    samplesPerSymbol: number;
    meaningfulMovePct: number;
    partialProgressRatio: number;
    thesisMode: ChartThesisQaThesisMode;
  };
  totals: {
    symbols: number;
    samples: number;
    samplesWithThesis: number;
    hitTarget: number;
    partialProgress: number;
    invalidated: number;
    noProgress: number;
    insufficientForward: number;
    missedMeaningfulMoves: number;
    missedMoveAt50Pct: number;
    missedMoveAt100Pct: number;
  missedMoveReasons: Record<ChartThesisQaMissedMoveReason, number>;
    thesisStatuses: Record<ChartThesisRead["status"], number>;
    lifecycleScopes: Record<WatchlistLifecycleSampleScope, number>;
    liveConfirmationPresent: number;
    liveConfirmationWithThesis: number;
    liveConfirmationOnMissedMoves: number;
    fiveMinuteParticipationPresent: number;
    fiveMinuteParticipationWithThesis: number;
    fiveMinuteParticipationOnMissedMoves: number;
    noThesisBelowMeaningfulForward: number;
  };
  thesisStats: ChartThesisQaThesisStats[];
  goodExamples: ChartThesisQaSample[];
  badExamples: ChartThesisQaSample[];
  missedMoves: ChartThesisQaMissedMove[];
  noThesisBelowMeaningfulForwardRows: ChartThesisQaMissedMove[];
  samples: ChartThesisQaSample[];
};

export type ChartThesisQaSymbolInput = {
  symbol: string;
  seriesMap: Partial<Record<CandleTimeframe, CandleProviderResponse>>;
};

export type ChartThesisQaThesisMode = "internal" | "watchlist_approved";

export type BuildChartThesisQaReportOptions = {
  symbols: ChartThesisQaSymbolInput[];
  source?: string;
  thesisMode?: ChartThesisQaThesisMode;
  horizonBars?: number;
  samplesPerSymbol?: number;
  cutoffTimestampsBySymbol?: Record<string, number[]>;
  chartThesisContextBySymbolTimestamp?: Record<string, ChartThesisEngineInput["activeRunnerContext"]>;
  meaningfulMovePct?: number;
  partialProgressRatio?: number;
  maxExamples?: number;
  lifecycleSessionsBySymbol?: Record<string, WatchlistLifecycleSession[]>;
};

export type WriteChartThesisQaReportOptions = BuildChartThesisQaReportOptions & {
  outputDirectory: string;
};

type CachedCandlePayload = {
  response?: CandleProviderResponse;
  request?: {
    symbol?: string;
    timeframe?: CandleTimeframe;
    provider?: CandleProviderName;
    endTimeMs?: number;
  };
  cachedAt?: number;
};

type OutcomeEvaluation = {
  outcome: ChartThesisQaOutcome;
  targetReached: boolean;
  invalidatedBeforeTarget: boolean;
  barsToTarget: number | null;
  bestForwardPct: number;
  worstForwardPct: number;
  forwardBars: number;
};

const DEFAULT_HORIZON_BARS = 10;
const DEFAULT_SAMPLES_PER_SYMBOL = 12;
const DEFAULT_MEANINGFUL_MOVE_PCT = 25;
const DEFAULT_PARTIAL_PROGRESS_RATIO = 0.5;

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
    const existing = byTimestamp.get(candle.timestamp);
    if (!existing || candle.volume >= existing.volume) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function cloneResponseAtCutoff(
  response: CandleProviderResponse | undefined,
  cutoffTimestamp: number,
): CandleProviderResponse | undefined {
  if (!response) {
    return undefined;
  }
  const candles = normalizeCandles(response.candles).filter((candle) => candle.timestamp <= cutoffTimestamp);
  return {
    ...response,
    candles,
    actualBarsReturned: candles.length,
    fetchStartTimestamp: candles[0]?.timestamp ?? response.fetchStartTimestamp,
    fetchEndTimestamp: candles.at(-1)?.timestamp ?? response.fetchEndTimestamp,
  };
}

function formatPrice(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function formatPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function nullablePct(value: number | null): string {
  return value === null ? "n/a" : formatPct(value);
}

function targetPriceForThesis(thesis: ChartThesisRead): number | null {
  const target = thesis.targetLow ?? thesis.returnTargetLow ?? thesis.targetHigh ?? thesis.returnTargetHigh;
  return typeof target === "number" && Number.isFinite(target) && target > 0 ? target : null;
}

function candleRange(candle: Candle): number {
  return candle.high - candle.low;
}

function bodyBottom(candle: Candle): number {
  return Math.min(candle.open, candle.close);
}

function upperCloseRatio(candle: Candle): number {
  const range = candleRange(candle);
  return range <= 0 ? 0 : (candle.close - candle.low) / range;
}

function candleDateKey(candle: Candle): string {
  return new Date(candle.timestamp).toISOString().slice(0, 10);
}

function latestSessionCandles(candles: Candle[]): Candle[] {
  const latest = candles.at(-1);
  if (!latest) {
    return [];
  }

  const latestDateKey = candleDateKey(latest);
  const session = candles.filter((candle) => candleDateKey(candle) === latestDateKey);
  return session.length >= 8 ? session : candles.slice(-Math.min(candles.length, 30));
}

function emptyLiveConfirmationRead(summary = "No live 5m expansion confirmation at cutoff."): ChartThesisQaLiveConfirmationRead {
  return {
    present: false,
    participationPresent: false,
    participationStatus: "unavailable",
    volumeRatio: null,
    latestRangePct: null,
    priorRangePct: null,
    closeExtensionPct: null,
    sessionPositionPct: null,
    triggerPrice: null,
    summary,
  };
}

function buildLiveConfirmationRead(params: {
  currentPrice: number;
  fiveMinuteResponse: CandleProviderResponse | undefined;
}): ChartThesisQaLiveConfirmationRead {
  const session = latestSessionCandles(normalizeCandles(params.fiveMinuteResponse?.candles ?? []).slice(-120));
  const latest = session.at(-1);
  if (!latest || session.length < 18) {
    return emptyLiveConfirmationRead("Not enough same-session 5m candles for live confirmation.");
  }

  const prior = session.slice(-18, -1);
  const positiveVolumeCandles = prior.filter((candle) => Number.isFinite(candle.volume) && candle.volume > 0);
  if (positiveVolumeCandles.length < 8 || !Number.isFinite(latest.volume) || latest.volume <= 0) {
    return emptyLiveConfirmationRead("Not enough usable 5m volume to confirm the move.");
  }

  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const sessionHigh = Math.max(...session.map((candle) => candle.high));
  const sessionLow = Math.min(...session.map((candle) => candle.low));
  const priorRange = priorHigh - priorLow;
  const priorRangePct = (priorRange / Math.max(priorLow, 0.0001)) * 100;
  const latestRange = candleRange(latest);
  const latestRangePct = (latestRange / Math.max(latest.low, 0.0001)) * 100;
  const sessionRange = sessionHigh - sessionLow;
  const sessionPositionPct = sessionRange <= 0
    ? null
    : ((params.currentPrice - sessionLow) / sessionRange) * 100;
  const averagePriorVolume =
    positiveVolumeCandles.reduce((sum, candle) => sum + candle.volume, 0) / positiveVolumeCandles.length;
  const volumeRatio = latest.volume / Math.max(averagePriorVolume, 1);
  const brokeShortRange = latest.high >= priorHigh * 1.01 && params.currentPrice >= priorHigh * 0.995;
  const holdingExpansion = params.currentPrice >= Math.max(priorHigh * 0.995, latest.low + latestRange * 0.52);
  const strongClose = upperCloseRatio(latest) >= 0.58 || latest.close >= priorHigh;
  const closeExtensionPct = ((params.currentPrice - priorHigh) / Math.max(priorHigh, 0.0001)) * 100;
  const quality = evaluateLiveVolumeExpansionConfirmationQuality({
    currentPrice: params.currentPrice,
    latestRangePct,
    priorRangePct,
    closeExtensionPct,
    latestTimestamp: latest.timestamp,
  });
  const present = quality.passed &&
    brokeShortRange &&
    holdingExpansion &&
    strongClose &&
    volumeRatio >= 2;
  const holdingLatestCandle = params.currentPrice >= latest.low + latestRange * 0.45;
  const constructiveSessionPosition = sessionPositionPct !== null && sessionPositionPct >= 55;
  const participatingTape = (
    present ||
    (
      volumeRatio >= 2 &&
      latestRangePct >= 4 &&
      holdingLatestCandle &&
      constructiveSessionPosition &&
      params.currentPrice >= priorHigh * 0.98
    )
  );
  const participationStatus: ChartThesisQaLiveConfirmationRead["participationStatus"] = present
    ? "confirmed_breakout"
    : participatingTape && closeExtensionPct > 8
      ? "hot_extended"
      : participatingTape
        ? "constructive"
        : "quiet_or_choppy";

  return {
    present,
    participationPresent: participatingTape,
    participationStatus,
    volumeRatio,
    latestRangePct,
    priorRangePct,
    closeExtensionPct,
    sessionPositionPct,
    triggerPrice: priorHigh,
    summary: present
      ? `5m expansion confirmed above ${formatPrice(priorHigh)} on ${volumeRatio.toFixed(1)}x recent volume.`
      : participatingTape
        ? `5m tape participating (${participationStatus.replace(/_/g, " ")}): ${volumeRatio.toFixed(1)}x volume, ${formatPct(latestRangePct)} latest 5m range, ${sessionPositionPct === null ? "n/a" : formatPct(sessionPositionPct)} session position, ${formatPct(closeExtensionPct)} above short trigger ${formatPrice(priorHigh)}.`
      : `No live confirmation: ${volumeRatio.toFixed(1)}x volume, ${formatPct(latestRangePct)} latest 5m range, ${formatPct(closeExtensionPct)} extension, trigger ${formatPrice(priorHigh)}${
          quality.rejectReasons.length > 0 ? ` (${quality.rejectReasons.join("; ")})` : ""
        }.`,
  };
}

function buildMissedMoveDiagnostics(params: {
  currentPrice: number;
  priorCandles: Candle[];
  forwardCandles: Candle[];
}): Pick<
  ChartThesisQaMissedMove,
  | "reason"
  | "priorRangePct"
  | "priorRangePositionPct"
  | "firstForwardGapPct"
  | "firstForwardRangePct"
  | "evidence"
> {
  const priorHigh = params.priorCandles.length === 0
    ? null
    : Math.max(...params.priorCandles.map((candle) => candle.high));
  const priorLow = params.priorCandles.length === 0
    ? null
    : Math.min(...params.priorCandles.map((candle) => candle.low));
  const priorRangePct =
    priorHigh === null || priorLow === null
      ? null
      : ((priorHigh - priorLow) / Math.max(params.currentPrice, 0.0001)) * 100;
  const priorRangePositionPct =
    priorHigh === null || priorLow === null
      ? null
      : ((params.currentPrice - priorLow) / Math.max(priorHigh - priorLow, 0.0001)) * 100;
  const firstForward = params.forwardCandles[0];
  const firstForwardGapPct = firstForward
    ? ((firstForward.open - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100
    : null;
  const firstForwardRangePct = firstForward
    ? ((firstForward.high - firstForward.low) / Math.max(firstForward.low, 0.0001)) * 100
    : null;

  let reason: ChartThesisQaMissedMoveReason = "delayed_move_after_quiet_chart";
  if (
    (firstForwardGapPct !== null && firstForwardGapPct >= 25) ||
    (firstForwardRangePct !== null && firstForwardRangePct >= 50)
  ) {
    reason = "news_or_gap_burst";
  } else if (priorRangePositionPct !== null && priorRangePositionPct < 20) {
    reason = "below_recent_range";
  } else if (priorRangePct !== null && priorRangePct > 45) {
    reason = "loose_or_damaged_range";
  } else if (
    priorRangePositionPct !== null &&
    priorRangePct !== null &&
    priorRangePositionPct >= 55 &&
    priorRangePct <= 28
  ) {
    reason = "possible_upper_range_setup";
  }

  const evidence = [
    `Prior 7-bar range: ${nullablePct(priorRangePct)}.`,
    `Price position in prior range: ${priorRangePositionPct === null ? "n/a" : `${priorRangePositionPct.toFixed(1)}%`}.`,
    `Next 4h open gap: ${nullablePct(firstForwardGapPct)}.`,
    `Next 4h candle range: ${nullablePct(firstForwardRangePct)}.`,
  ];
  return {
    reason,
    priorRangePct,
    priorRangePositionPct,
    firstForwardGapPct,
    firstForwardRangePct,
    evidence,
  };
}

function addBlocker(blockers: string[], condition: boolean, label: string): void {
  if (!condition) {
    blockers.push(label);
  }
}

function rejectionScore(blockers: string[], totalChecks: number): number {
  return totalChecks <= 0 ? 0 : (totalChecks - blockers.length) / totalChecks;
}

function finiteNumber(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function buildThesisRejection(params: {
  thesisType: string;
  nearMissScore: number;
  blockers: string[];
  diagnostics: Record<string, number | string | boolean | null>;
}): ChartThesisQaThesisRejection {
  return params;
}

function buildThesisRejectionAudit(params: {
  currentPrice: number;
  latest: Candle;
  priorCandles: Candle[];
  forwardCandles: Candle[];
  activeRunnerContext?: ChartThesisEngineInput["activeRunnerContext"];
}): ChartThesisQaRejectionAudit {
  const priorHigh = params.priorCandles.length === 0
    ? null
    : Math.max(...params.priorCandles.map((candle) => candle.high));
  const priorLow = params.priorCandles.length === 0
    ? null
    : Math.min(...params.priorCandles.map((candle) => candle.low));
  const range = priorHigh === null || priorLow === null ? null : priorHigh - priorLow;
  const rangePct = range === null
    ? null
    : (range / Math.max(params.currentPrice, 0.0001)) * 100;
  const positionPct = range === null || priorLow === null
    ? null
    : ((params.currentPrice - priorLow) / Math.max(range, 0.0001)) * 100;
  const shelfExtensionPct = priorHigh === null
    ? null
    : ((params.currentPrice - priorHigh) / Math.max(priorHigh, 0.0001)) * 100;
  const latestRange = candleRange(params.latest);
  const latestRangePct = (latestRange / Math.max(params.currentPrice, 0.0001)) * 100;
  const latestBodyPct = ((params.latest.close - params.latest.open) / Math.max(params.latest.open, 0.0001)) * 100;
  const latestCloseRatio = upperCloseRatio(params.latest);
  const averagePriorRange = params.priorCandles.length === 0
    ? null
    : params.priorCandles.reduce((sum, candle) => sum + candleRange(candle), 0) / params.priorCandles.length;
  const rangeExpansionRatio = averagePriorRange === null
    ? null
    : latestRange / Math.max(averagePriorRange, 0.0001);
  const firstForward = params.forwardCandles[0];
  const firstForwardGapPct = firstForward
    ? ((firstForward.open - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100
    : null;
  const firstForwardRangePct = firstForward
    ? ((firstForward.high - firstForward.low) / Math.max(firstForward.low, 0.0001)) * 100
    : null;

  const activeRunner = params.activeRunnerContext?.activeRunner === true;
  const freshCatalystContext =
    isFreshActivePressReleaseCatalyst(params.activeRunnerContext?.catalystContext) ||
    params.activeRunnerContext?.catalystCardFreshness === "same_day";

  const clearedCleanTarget = range === null || priorHigh === null
    ? null
    : params.currentPrice + Math.max(range * 3.2, Math.max(0, params.currentPrice - priorHigh) * 0.38);
  const clearedCleanRoomPct = clearedCleanTarget === null
    ? null
    : ((clearedCleanTarget - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100;
  const clearedExtensionTarget = range === null || priorHigh === null
    ? null
    : params.currentPrice + Math.max(range * 5.3, Math.max(0, params.currentPrice - priorHigh) * 0.62);
  const clearedExtensionRoomPct = clearedExtensionTarget === null
    ? null
    : ((clearedExtensionTarget - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100;
  const clearedConstructiveClose = params.latest.close >= params.latest.open || latestCloseRatio >= 0.52;
  const clearedHoldingBreakout = priorHigh !== null &&
    params.currentPrice >= priorHigh * 1.01 &&
    params.latest.close >= priorHigh * 1.01 &&
    params.currentPrice >= params.latest.low + latestRange * 0.35;
  const clearedNotExhausted = latestCloseRatio >= 0.32 && latestRangePct <= 95;
  const clearedBaseShelfSetup = rangePct !== null &&
    rangePct >= 5 &&
    rangePct <= 12 &&
    positionPct !== null &&
    positionPct >= 400 &&
    positionPct <= 1200;
  const clearedCleanBreakoutSetup = activeRunner &&
    clearedBaseShelfSetup &&
    shelfExtensionPct !== null &&
    shelfExtensionPct >= 1 &&
    shelfExtensionPct <= 220 &&
    clearedConstructiveClose &&
    clearedHoldingBreakout &&
    clearedNotExhausted &&
    clearedCleanRoomPct !== null &&
    clearedCleanRoomPct >= 25 &&
    clearedCleanRoomPct <= 95;
  const clearedExtensionHoldSetup = activeRunner &&
    clearedBaseShelfSetup &&
    shelfExtensionPct !== null &&
    shelfExtensionPct >= 30 &&
    shelfExtensionPct <= 180 &&
    priorHigh !== null &&
    params.currentPrice >= priorHigh * 1.03 &&
    params.currentPrice >= params.latest.low + latestRange * 0.3 &&
    latestCloseRatio >= 0.18 &&
    latestRangePct <= 180 &&
    clearedExtensionRoomPct !== null &&
    clearedExtensionRoomPct >= 25 &&
    clearedExtensionRoomPct <= 95;
  const clearedRoomPct = clearedCleanBreakoutSetup ? clearedCleanRoomPct : clearedExtensionRoomPct;
  const clearedBlockers: string[] = [];
  addBlocker(clearedBlockers, activeRunner, "not an active-runner replay context");
  addBlocker(clearedBlockers, rangePct !== null && rangePct >= 5 && rangePct <= 12, "prior shelf range is outside 5-12%");
  addBlocker(clearedBlockers, positionPct !== null && positionPct >= 400 && positionPct <= 1200, "price is not in the 400-1200% power-shelf position band");
  addBlocker(
    clearedBlockers,
    clearedCleanBreakoutSetup || clearedExtensionHoldSetup,
    "neither clean breakout nor extension-hold shelf setup qualified",
  );

  const momentumTarget = range === null || priorHigh === null
    ? null
    : Math.max(params.latest.close + latestRange * 0.35, priorHigh + range * 0.35);
  const momentumRoomPct = momentumTarget === null
    ? null
    : ((momentumTarget - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100;
  const momentumBlockers: string[] = [];
  addBlocker(momentumBlockers, latestRangePct >= 18, "latest 4h range was below 18%");
  addBlocker(momentumBlockers, latestBodyPct >= 20, "latest 4h body was below 20%");
  addBlocker(momentumBlockers, rangeExpansionRatio !== null && rangeExpansionRatio >= 1.6, "latest range was not at least 1.6x the prior average");
  addBlocker(momentumBlockers, priorHigh !== null && params.latest.high > priorHigh * 1.03, "latest candle did not clear prior high by 3%");
  addBlocker(momentumBlockers, latestCloseRatio >= 0.62, "latest candle did not close strong enough");
  addBlocker(momentumBlockers, priorHigh !== null && params.currentPrice >= Math.max(bodyBottom(params.latest), priorHigh * 0.98), "price was not holding the breakout area");
  addBlocker(momentumBlockers, momentumRoomPct !== null && momentumRoomPct >= 12, "measured momentum room was below 12%");

  const catalystBlockers: string[] = [];
  addBlocker(catalystBlockers, activeRunner, "not an active-runner replay context");
  addBlocker(catalystBlockers, freshCatalystContext, "no fresh same-day/prior-evening catalyst context");
  addBlocker(catalystBlockers, latestRangePct >= 14 && latestRangePct <= 95, "active 4h range was outside 14-95%");
  addBlocker(catalystBlockers, rangeExpansionRatio !== null && rangeExpansionRatio >= 1.15, "latest range was not at least 1.15x the prior average");
  addBlocker(catalystBlockers, latestBodyPct >= 6, "active 4h body was below 6%");
  addBlocker(catalystBlockers, priorHigh !== null && (params.latest.high >= priorHigh * 1.01 || params.currentPrice >= priorHigh * 0.99), "price did not clear the prior high area");
  addBlocker(catalystBlockers, params.currentPrice >= params.latest.low + latestRange * 0.48, "price was not holding the upper half of the active candle");
  addBlocker(catalystBlockers, latestCloseRatio >= 0.38 && params.currentPrice <= params.latest.high * 1.04, "active candle looked too exhausted");
  addBlocker(catalystBlockers, rangePct !== null && rangePct >= 8, "prior range was below 8%");

  const upperRangeBlockers: string[] = [];
  const compressionOwnsSetup = priorHigh !== null && rangePct !== null && rangePct <= 16 && params.currentPrice >= priorHigh * 0.96;
  addBlocker(upperRangeBlockers, rangePct !== null && rangePct >= 8 && rangePct <= 16, "recent range was outside 8-16%");
  addBlocker(upperRangeBlockers, positionPct !== null && positionPct >= 60 && positionPct <= 68, "price was not sitting in the narrow upper-range ignition band");
  addBlocker(upperRangeBlockers, !compressionOwnsSetup, "compression setup is owned by another thesis path");
  addBlocker(upperRangeBlockers, latestCloseRatio >= 0.45, "latest candle close was not constructive");
  addBlocker(upperRangeBlockers, priorHigh !== null && ((priorHigh - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100 <= 6, "breakout trigger was more than 6% away");

  const newsBurstBlockers: string[] = [];
  const futureBurst = (firstForwardGapPct !== null && firstForwardGapPct >= 25) ||
    (firstForwardRangePct !== null && firstForwardRangePct >= 50);
  addBlocker(newsBurstBlockers, futureBurst, "forward move was not a gap/news-style burst");
  newsBurstBlockers.push("current engine has no standalone news/gap-burst continuation thesis");
  if (!freshCatalystContext) {
    newsBurstBlockers.push("no fresh same-day/prior-evening catalyst context at the cutoff");
  }

  const thesisRejections: ChartThesisQaThesisRejection[] = [
    buildThesisRejection({
      thesisType: "cleared_shelf_power_continuation",
      nearMissScore: rejectionScore(clearedBlockers, 8),
      blockers: clearedBlockers,
      diagnostics: {
        activeRunner,
        rangePct: finiteNumber(rangePct ?? Number.NaN),
        positionPct: finiteNumber(positionPct ?? Number.NaN),
        shelfExtensionPct: finiteNumber(shelfExtensionPct ?? Number.NaN),
        latestRangePct: finiteNumber(latestRangePct),
        latestCloseRatio: finiteNumber(latestCloseRatio),
        measuredRoomPct: finiteNumber(clearedRoomPct ?? Number.NaN),
      },
    }),
    buildThesisRejection({
      thesisType: "momentum_expansion_continuation",
      nearMissScore: rejectionScore(momentumBlockers, 7),
      blockers: momentumBlockers,
      diagnostics: {
        latestRangePct: finiteNumber(latestRangePct),
        latestBodyPct: finiteNumber(latestBodyPct),
        rangeExpansionRatio: finiteNumber(rangeExpansionRatio ?? Number.NaN),
        latestCloseRatio: finiteNumber(latestCloseRatio),
        measuredRoomPct: finiteNumber(momentumRoomPct ?? Number.NaN),
      },
    }),
    buildThesisRejection({
      thesisType: "catalyst_active_runner_continuation",
      nearMissScore: rejectionScore(catalystBlockers, 9),
      blockers: catalystBlockers,
      diagnostics: {
        activeRunner,
        catalystFreshness: params.activeRunnerContext?.catalystCardFreshness ?? "none",
        catalystContextTiming: params.activeRunnerContext?.catalystContext?.timing ?? "none",
        freshCatalystContext,
        latestRangePct: finiteNumber(latestRangePct),
        latestBodyPct: finiteNumber(latestBodyPct),
        rangeExpansionRatio: finiteNumber(rangeExpansionRatio ?? Number.NaN),
        latestCloseRatio: finiteNumber(latestCloseRatio),
        rangePct: finiteNumber(rangePct ?? Number.NaN),
      },
    }),
    buildThesisRejection({
      thesisType: "upper_range_ignition",
      nearMissScore: rejectionScore(upperRangeBlockers, 5),
      blockers: upperRangeBlockers,
      diagnostics: {
        rangePct: finiteNumber(rangePct ?? Number.NaN),
        positionPct: finiteNumber(positionPct ?? Number.NaN),
        shelfExtensionPct: finiteNumber(shelfExtensionPct ?? Number.NaN),
        latestCloseRatio: finiteNumber(latestCloseRatio),
      },
    }),
    buildThesisRejection({
      thesisType: "news_gap_burst_context_needed",
      nearMissScore: rejectionScore(newsBurstBlockers, 3),
      blockers: newsBurstBlockers,
      diagnostics: {
        firstForwardGapPct: finiteNumber(firstForwardGapPct ?? Number.NaN),
        firstForwardRangePct: finiteNumber(firstForwardRangePct ?? Number.NaN),
        catalystFreshness: params.activeRunnerContext?.catalystCardFreshness ?? "none",
        catalystContextTiming: params.activeRunnerContext?.catalystContext?.timing ?? "none",
        freshCatalystContext,
      },
    }),
  ].sort((left, right) => right.nearMissScore - left.nearMissScore || left.blockers.length - right.blockers.length);

  const closest = thesisRejections[0]!;
  return {
    closestThesisType: closest.thesisType,
    primaryBlockers: closest.blockers.slice(0, 4),
    thesisRejections,
  };
}

function evaluateOutcome(params: {
  currentPrice: number;
  targetPrice: number | null;
  invalidationPrice: number | null;
  forwardCandles: Candle[];
  partialProgressRatio: number;
}): OutcomeEvaluation {
  const forward = params.forwardCandles;
  const highs = forward.map((candle) => candle.high);
  const lows = forward.map((candle) => candle.low);
  const bestHigh = highs.length > 0 ? Math.max(...highs) : params.currentPrice;
  const worstLow = lows.length > 0 ? Math.min(...lows) : params.currentPrice;
  const bestForwardPct = ((bestHigh - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100;
  const worstForwardPct = ((worstLow - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100;

  if (!params.targetPrice || forward.length === 0) {
    return {
      outcome: "insufficient_forward",
      targetReached: false,
      invalidatedBeforeTarget: false,
      barsToTarget: null,
      bestForwardPct,
      worstForwardPct,
      forwardBars: forward.length,
    };
  }

  let targetReached = false;
  let invalidatedBeforeTarget = false;
  let barsToTarget: number | null = null;
  for (let index = 0; index < forward.length; index += 1) {
    const candle = forward[index]!;
    if (
      params.invalidationPrice !== null &&
      candle.low <= params.invalidationPrice &&
      !targetReached
    ) {
      invalidatedBeforeTarget = true;
      break;
    }
    if (candle.high >= params.targetPrice) {
      targetReached = true;
      barsToTarget = index + 1;
      break;
    }
  }

  const roomToTargetPct = ((params.targetPrice - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100;
  const partialThresholdPct = Math.max(8, roomToTargetPct * params.partialProgressRatio);
  const madeUsefulPartialProgress = bestForwardPct >= partialThresholdPct;
  const outcome: ChartThesisQaOutcome = targetReached
    ? "hit_target"
    : madeUsefulPartialProgress
      ? "partial_progress"
      : invalidatedBeforeTarget
        ? "invalidated"
        : "no_progress";

  return {
    outcome,
    targetReached,
    invalidatedBeforeTarget,
    barsToTarget,
    bestForwardPct,
    worstForwardPct,
    forwardBars: forward.length,
  };
}

function sampleCutoffIndexes(candles: Candle[], samplesPerSymbol: number, horizonBars: number): number[] {
  const latestUsable = candles.length - horizonBars - 1;
  const earliestUsable = Math.max(5, candles.length - horizonBars - samplesPerSymbol * 3);
  if (latestUsable < earliestUsable) {
    return [];
  }

  const indexes = new Set<number>();
  const span = latestUsable - earliestUsable;
  const count = Math.min(samplesPerSymbol, span + 1);
  for (let step = 0; step < count; step += 1) {
    const offset = count === 1 ? 0 : Math.round((span * step) / (count - 1));
    indexes.add(earliestUsable + offset);
  }
  return [...indexes].sort((left, right) => left - right);
}

function cutoffIndexesFromTimestamps(candles: Candle[], cutoffTimestamps: number[], horizonBars: number): number[] {
  const latestUsable = candles.length - horizonBars - 1;
  if (latestUsable < 5) {
    return [];
  }

  const indexes = new Set<number>();
  for (const cutoffTimestamp of cutoffTimestamps) {
    if (!Number.isFinite(cutoffTimestamp)) {
      continue;
    }
    let index = candles.findIndex((candle) => candle.timestamp === cutoffTimestamp);
    if (index < 0) {
      for (let candidateIndex = candles.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
        if (candles[candidateIndex]!.timestamp <= cutoffTimestamp) {
          index = candidateIndex;
          break;
        }
      }
    }
    if (index >= 5 && index <= latestUsable) {
      indexes.add(index);
    }
  }
  return [...indexes].sort((left, right) => left - right);
}

function buildSample(params: {
  symbol: string;
  cutoffIndex: number;
  fourHourCandles: Candle[];
  seriesMap: Partial<Record<CandleTimeframe, CandleProviderResponse>>;
  horizonBars: number;
  partialProgressRatio: number;
  lifecycleSessionsBySymbol?: Record<string, WatchlistLifecycleSession[]>;
  chartThesisContextBySymbolTimestamp?: Record<string, ChartThesisEngineInput["activeRunnerContext"]>;
  thesisMode: ChartThesisQaThesisMode;
}): ChartThesisQaSample | ChartThesisQaMissedMove {
  const cutoffCandle = params.fourHourCandles[params.cutoffIndex]!;
  const currentPrice = cutoffCandle.close;
  const cutoffTimestamp = cutoffCandle.timestamp;
  const lifecycleScope = classifyWatchlistLifecycleScope({
    symbol: params.symbol,
    timestamp: cutoffTimestamp,
    sessionsBySymbol: params.lifecycleSessionsBySymbol,
  });
  const truncatedSeriesMap: Partial<Record<CandleTimeframe, CandleProviderResponse>> = {
    daily: cloneResponseAtCutoff(params.seriesMap.daily, cutoffTimestamp),
    "4h": cloneResponseAtCutoff(params.seriesMap["4h"], cutoffTimestamp),
    "5m": cloneResponseAtCutoff(params.seriesMap["5m"], cutoffTimestamp),
  };
  const liveConfirmation = buildLiveConfirmationRead({
    currentPrice,
    fiveMinuteResponse: truncatedSeriesMap["5m"],
  });
  const thesisInput = {
    symbol: params.symbol,
    currentPrice,
    seriesMap: truncatedSeriesMap,
    activeRunnerContext: params.chartThesisContextBySymbolTimestamp?.[`${params.symbol.toUpperCase()}:${cutoffTimestamp}`],
  };
  const thesis = params.thesisMode === "watchlist_approved"
    ? buildWatchlistChartThesisRead(thesisInput)
    : buildChartThesisRead(thesisInput);
  const forwardCandles = params.fourHourCandles.slice(
    params.cutoffIndex + 1,
    params.cutoffIndex + 1 + params.horizonBars,
  );
  const targetPrice = thesis ? targetPriceForThesis(thesis) : null;
  const invalidationPrice =
    thesis?.invalidationLevel !== undefined && Number.isFinite(thesis.invalidationLevel)
      ? thesis.invalidationLevel
      : null;
  const evaluation = evaluateOutcome({
    currentPrice,
    targetPrice,
    invalidationPrice,
    forwardCandles,
    partialProgressRatio: params.partialProgressRatio,
  });

  if (!thesis) {
    const priorCandles = params.fourHourCandles.slice(Math.max(0, params.cutoffIndex - 7), params.cutoffIndex);
    const diagnostics = buildMissedMoveDiagnostics({
      currentPrice,
      priorCandles,
      forwardCandles,
    });
    const rejectionAudit = buildThesisRejectionAudit({
      currentPrice,
      latest: cutoffCandle,
      priorCandles,
      forwardCandles,
      activeRunnerContext: params.chartThesisContextBySymbolTimestamp?.[`${params.symbol.toUpperCase()}:${cutoffTimestamp}`],
    });
    return {
      symbol: params.symbol,
      cutoffTimestamp,
      cutoffIso: new Date(cutoffTimestamp).toISOString(),
      lifecycleScope,
      currentPrice,
      liveConfirmation,
      bestForwardPct: evaluation.bestForwardPct,
      forwardBars: evaluation.forwardBars,
      ...diagnostics,
      rejectionAudit,
      summary: `${params.symbol} had no thesis at ${formatPrice(currentPrice)}, then traded up ${formatPct(evaluation.bestForwardPct)} over ${evaluation.forwardBars} forward 4h bars (${diagnostics.reason}).`,
    };
  }

  const roomToTargetPct = targetPrice === null
    ? null
    : ((targetPrice - currentPrice) / Math.max(currentPrice, 0.0001)) * 100;
  return {
    symbol: params.symbol,
    cutoffTimestamp,
    cutoffIso: new Date(cutoffTimestamp).toISOString(),
    lifecycleScope,
    currentPrice,
    liveConfirmation,
    thesis,
    outcome: evaluation.outcome,
    targetPrice,
    invalidationPrice,
    roomToTargetPct,
    bestForwardPct: evaluation.bestForwardPct,
    worstForwardPct: evaluation.worstForwardPct,
    targetReached: evaluation.targetReached,
    invalidatedBeforeTarget: evaluation.invalidatedBeforeTarget,
    barsToTarget: evaluation.barsToTarget,
    forwardBars: evaluation.forwardBars,
    summary: `${params.symbol} ${thesis.label} at ${formatPrice(currentPrice)} targeted ${targetPrice === null ? "n/a" : formatPrice(targetPrice)}; outcome ${evaluation.outcome}, best forward ${formatPct(evaluation.bestForwardPct)}.`,
    lines: thesis.lines,
  };
}

function buildStats(samples: ChartThesisQaSample[]): ChartThesisQaThesisStats[] {
  const byType = new Map<string, ChartThesisQaSample[]>();
  for (const sample of samples) {
    const key = sample.thesis?.type ?? "none";
    const existing = byType.get(key) ?? [];
    existing.push(sample);
    byType.set(key, existing);
  }

  return [...byType.entries()]
    .filter(([type]) => type !== "none")
    .map(([thesisType, items]) => {
      const hitTarget = items.filter((sample) => sample.outcome === "hit_target").length;
      const roomValues = items
        .map((sample) => sample.roomToTargetPct)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const bestValues = items
        .map((sample) => sample.bestForwardPct)
        .filter((value) => Number.isFinite(value));
      const worstValues = items
        .map((sample) => sample.worstForwardPct)
        .filter((value) => Number.isFinite(value));
      const partialProgress = items.filter((sample) => sample.outcome === "partial_progress").length;
      const invalidated = items.filter((sample) => sample.outcome === "invalidated").length;
      const usefulCount = hitTarget + partialProgress;
      const move15Count = items.filter((sample) => sample.bestForwardPct >= 15).length;
      const move25Count = items.filter((sample) => sample.bestForwardPct >= 25).length;
      const move50Count = items.filter((sample) => sample.bestForwardPct >= 50).length;
      return {
        thesisType,
        samples: items.length,
        hitTarget,
        partialProgress,
        invalidated,
        noProgress: items.filter((sample) => sample.outcome === "no_progress").length,
        insufficientForward: items.filter((sample) => sample.outcome === "insufficient_forward").length,
        usefulCount,
        usefulRate: items.length === 0 ? 0 : usefulCount / items.length,
        hitRate: items.length === 0 ? 0 : hitTarget / items.length,
        invalidationRate: items.length === 0 ? 0 : invalidated / items.length,
        move15Count,
        move15Rate: items.length === 0 ? 0 : move15Count / items.length,
        move25Count,
        move25Rate: items.length === 0 ? 0 : move25Count / items.length,
        move50Count,
        move50Rate: items.length === 0 ? 0 : move50Count / items.length,
        statusCounts: items.reduce((counts, sample) => {
          counts[sample.thesis!.status] += 1;
          return counts;
        }, emptyThesisStatusCounts()),
        lifecycleScopes: items.reduce((counts, sample) => {
          counts[sample.lifecycleScope] += 1;
          return counts;
        }, emptyLifecycleScopeCounts()),
        liveConfirmationPresent: items.filter((sample) => sample.liveConfirmation.present).length,
        liveConfirmationRate: items.length === 0
          ? 0
          : items.filter((sample) => sample.liveConfirmation.present).length / items.length,
        avgRoomToTargetPct: roomValues.length === 0
          ? null
          : roomValues.reduce((sum, value) => sum + value, 0) / roomValues.length,
        avgBestForwardPct: bestValues.length === 0
          ? null
          : bestValues.reduce((sum, value) => sum + value, 0) / bestValues.length,
        avgWorstForwardPct: worstValues.length === 0
          ? null
          : worstValues.reduce((sum, value) => sum + value, 0) / worstValues.length,
      };
    })
    .sort((left, right) => right.samples - left.samples || right.hitRate - left.hitRate);
}

function emptyMissedReasonCounts(): Record<ChartThesisQaMissedMoveReason, number> {
  return {
    news_or_gap_burst: 0,
    below_recent_range: 0,
    loose_or_damaged_range: 0,
    possible_upper_range_setup: 0,
    delayed_move_after_quiet_chart: 0,
  };
}

function emptyThesisStatusCounts(): Record<ChartThesisRead["status"], number> {
  return {
    active: 0,
    watch: 0,
    early: 0,
  };
}

export function buildChartThesisQaReport(options: BuildChartThesisQaReportOptions): ChartThesisQaReport {
  const horizonBars = Math.max(1, Math.floor(options.horizonBars ?? DEFAULT_HORIZON_BARS));
  const samplesPerSymbol = Math.max(1, Math.floor(options.samplesPerSymbol ?? DEFAULT_SAMPLES_PER_SYMBOL));
  const meaningfulMovePct = Math.max(1, options.meaningfulMovePct ?? DEFAULT_MEANINGFUL_MOVE_PCT);
  const partialProgressRatio = Math.max(0.1, Math.min(0.9, options.partialProgressRatio ?? DEFAULT_PARTIAL_PROGRESS_RATIO));
  const thesisMode = options.thesisMode ?? "internal";
  const samples: ChartThesisQaSample[] = [];
  const missedCandidates: ChartThesisQaMissedMove[] = [];
  const noThesisBelowMeaningfulForwardCandidates: ChartThesisQaMissedMove[] = [];

  for (const symbolInput of options.symbols) {
    const fourHourCandles = normalizeCandles(symbolInput.seriesMap["4h"]?.candles ?? []);
    const explicitCutoffs = options.cutoffTimestampsBySymbol?.[symbolInput.symbol.toUpperCase()] ??
      options.cutoffTimestampsBySymbol?.[symbolInput.symbol];
    const cutoffIndexes = explicitCutoffs
      ? cutoffIndexesFromTimestamps(fourHourCandles, explicitCutoffs, horizonBars)
      : sampleCutoffIndexes(fourHourCandles, samplesPerSymbol, horizonBars);
    for (const cutoffIndex of cutoffIndexes) {
      const result = buildSample({
        symbol: symbolInput.symbol.toUpperCase(),
        cutoffIndex,
        fourHourCandles,
        seriesMap: symbolInput.seriesMap,
        horizonBars,
        partialProgressRatio,
        lifecycleSessionsBySymbol: options.lifecycleSessionsBySymbol,
        chartThesisContextBySymbolTimestamp: options.chartThesisContextBySymbolTimestamp,
        thesisMode,
      });
      if ("thesis" in result) {
        samples.push(result);
      } else if (result.bestForwardPct >= meaningfulMovePct) {
        missedCandidates.push(result);
      } else {
        noThesisBelowMeaningfulForwardCandidates.push(result);
      }
    }
  }

  const maxExamples = Math.max(1, options.maxExamples ?? 12);
  const goodExamples = samples
    .filter((sample) => sample.outcome === "hit_target" || sample.outcome === "partial_progress")
    .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
    .slice(0, maxExamples);
  const badExamples = samples
    .filter((sample) => sample.outcome === "invalidated" || sample.outcome === "no_progress")
    .sort((left, right) => right.thesis!.score - left.thesis!.score || left.bestForwardPct - right.bestForwardPct)
    .slice(0, maxExamples);
  const missedMoves = missedCandidates
    .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
    .slice(0, maxExamples);
  const noThesisBelowMeaningfulForwardRows = noThesisBelowMeaningfulForwardCandidates
    .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
    .slice(0, Math.max(maxExamples, noThesisBelowMeaningfulForwardCandidates.length));
  const missedMoveReasons = emptyMissedReasonCounts();
  for (const missed of missedCandidates) {
    missedMoveReasons[missed.reason] += 1;
  }
  const thesisStatuses = emptyThesisStatusCounts();
  const lifecycleScopes = emptyLifecycleScopeCounts();
  for (const sample of samples) {
    if (sample.thesis) {
      thesisStatuses[sample.thesis.status] += 1;
    }
    lifecycleScopes[sample.lifecycleScope] += 1;
  }
  for (const missed of missedCandidates) {
    lifecycleScopes[missed.lifecycleScope] += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    source: options.source ?? "in-memory candle series",
    settings: {
      horizonBars,
      samplesPerSymbol,
      meaningfulMovePct,
      partialProgressRatio,
      thesisMode,
    },
    totals: {
      symbols: options.symbols.length,
      samples: samples.length,
      samplesWithThesis: samples.length,
      hitTarget: samples.filter((sample) => sample.outcome === "hit_target").length,
      partialProgress: samples.filter((sample) => sample.outcome === "partial_progress").length,
      invalidated: samples.filter((sample) => sample.outcome === "invalidated").length,
      noProgress: samples.filter((sample) => sample.outcome === "no_progress").length,
      insufficientForward: samples.filter((sample) => sample.outcome === "insufficient_forward").length,
      missedMeaningfulMoves: missedCandidates.length,
      missedMoveAt50Pct: missedCandidates.filter((missed) => missed.bestForwardPct >= 50).length,
      missedMoveAt100Pct: missedCandidates.filter((missed) => missed.bestForwardPct >= 100).length,
      missedMoveReasons,
      thesisStatuses,
      lifecycleScopes,
      liveConfirmationPresent: samples.filter((sample) => sample.liveConfirmation.present).length +
        missedCandidates.filter((missed) => missed.liveConfirmation.present).length,
      liveConfirmationWithThesis: samples.filter((sample) => sample.liveConfirmation.present).length,
      liveConfirmationOnMissedMoves: missedCandidates.filter((missed) => missed.liveConfirmation.present).length,
      fiveMinuteParticipationPresent: samples.filter((sample) => sample.liveConfirmation.participationPresent).length +
        missedCandidates.filter((missed) => missed.liveConfirmation.participationPresent).length,
      fiveMinuteParticipationWithThesis: samples.filter((sample) => sample.liveConfirmation.participationPresent).length,
      fiveMinuteParticipationOnMissedMoves: missedCandidates.filter((missed) => missed.liveConfirmation.participationPresent).length,
      noThesisBelowMeaningfulForward: noThesisBelowMeaningfulForwardCandidates.length,
    },
    thesisStats: buildStats(samples),
    goodExamples,
    badExamples,
    missedMoves,
    noThesisBelowMeaningfulForwardRows,
    samples,
  };
}

function renderSample(sample: ChartThesisQaSample): string[] {
  const lines: string[] = [];
  lines.push(`- ${sample.summary}`);
  lines.push(`  - Cutoff: ${sample.cutoffIso}`);
  lines.push(`  - Watchlist scope: ${sample.lifecycleScope}`);
  lines.push(`  - Thesis: ${sample.thesis?.type ?? "none"} (${sample.thesis?.confidence ?? "n/a"} confidence, score ${sample.thesis?.score.toFixed(1) ?? "n/a"})`);
  lines.push(`  - Status: ${sample.thesis?.status ?? "n/a"}`);
  lines.push(`  - Live confirmation: ${sample.liveConfirmation.summary}`);
  lines.push(`  - Room: ${sample.roomToTargetPct === null ? "n/a" : formatPct(sample.roomToTargetPct)}, best forward: ${formatPct(sample.bestForwardPct)}, worst forward: ${formatPct(sample.worstForwardPct)}`);
  for (const thesisLine of sample.lines.slice(0, 3)) {
    lines.push(`  - Read: ${thesisLine}`);
  }
  return lines;
}

function renderMarkdown(report: ChartThesisQaReport): string {
  const lines: string[] = [];
  lines.push("# Chart Thesis QA Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Source: ${report.source}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Symbols scanned: ${report.totals.symbols}`);
  lines.push(`- Thesis samples: ${report.totals.samplesWithThesis}`);
  lines.push(`- Hit target: ${report.totals.hitTarget}`);
  lines.push(`- Partial progress: ${report.totals.partialProgress}`);
  lines.push(`- Invalidated: ${report.totals.invalidated}`);
  lines.push(`- No progress: ${report.totals.noProgress}`);
  lines.push(`- Missed meaningful moves with no thesis: ${report.totals.missedMeaningfulMoves}`);
  lines.push(`- No-thesis below meaningful forward threshold: ${report.totals.noThesisBelowMeaningfulForward}`);
  lines.push(`- Missed moves >=50%: ${report.totals.missedMoveAt50Pct}`);
  lines.push(`- Missed moves >=100%: ${report.totals.missedMoveAt100Pct}`);
  lines.push(`- Live 5m confirmation present: ${report.totals.liveConfirmationPresent} total, ${report.totals.liveConfirmationWithThesis} with thesis, ${report.totals.liveConfirmationOnMissedMoves} on missed moves`);
  lines.push(`- 5m tape participation present: ${report.totals.fiveMinuteParticipationPresent} total, ${report.totals.fiveMinuteParticipationWithThesis} with thesis, ${report.totals.fiveMinuteParticipationOnMissedMoves} on missed moves`);
  lines.push(`- Horizon: ${report.settings.horizonBars} forward 4h bars`);
  lines.push("");
  lines.push("## Thesis Statuses");
  lines.push("");
  lines.push(`- active: ${report.totals.thesisStatuses.active}`);
  lines.push(`- watch: ${report.totals.thesisStatuses.watch}`);
  lines.push(`- early: ${report.totals.thesisStatuses.early}`);
  lines.push("");
  lines.push("## Watchlist Lifecycle Scope");
  lines.push("");
  lines.push("- This is an audit label only. Candle replay performance is not filtered by saved watchlist state.");
  lines.push(`- active_window: ${report.totals.lifecycleScopes.active_window}`);
  lines.push(`- restart_restore_window: ${report.totals.lifecycleScopes.restart_restore_window}`);
  lines.push(`- archive_only: ${report.totals.lifecycleScopes.archive_only}`);
  lines.push(`- outside_active_window: ${report.totals.lifecycleScopes.outside_active_window}`);
  lines.push(`- unknown_lifecycle: ${report.totals.lifecycleScopes.unknown_lifecycle}`);
  lines.push("");
  lines.push("## Missed Move Reasons");
  lines.push("");
  for (const [reason, count] of Object.entries(report.totals.missedMoveReasons)) {
    lines.push(`- ${reason}: ${count}`);
  }
  lines.push("");
  lines.push("## Thesis Leaderboard");
  lines.push("");
  if (report.thesisStats.length === 0) {
    lines.push("No thesis samples found.");
  } else {
    const rankedStats = [...report.thesisStats].sort((left, right) =>
      right.usefulRate - left.usefulRate ||
      right.move25Rate - left.move25Rate ||
      right.samples - left.samples,
    );
    for (const stat of rankedStats) {
      lines.push(`- ${stat.thesisType}: useful ${stat.usefulCount}/${stat.samples} (${(stat.usefulRate * 100).toFixed(1)}%), +15% ${stat.move15Count}/${stat.samples} (${(stat.move15Rate * 100).toFixed(1)}%), +25% ${stat.move25Count}/${stat.samples} (${(stat.move25Rate * 100).toFixed(1)}%), +50% ${stat.move50Count}/${stat.samples} (${(stat.move50Rate * 100).toFixed(1)}%), invalidated ${stat.invalidated}/${stat.samples} (${(stat.invalidationRate * 100).toFixed(1)}%), avg best ${stat.avgBestForwardPct === null ? "n/a" : formatPct(stat.avgBestForwardPct)}, avg worst ${stat.avgWorstForwardPct === null ? "n/a" : formatPct(stat.avgWorstForwardPct)}`);
    }
  }
  lines.push("");
  lines.push("## Thesis Stats");
  lines.push("");
  if (report.thesisStats.length === 0) {
    lines.push("No thesis samples found.");
  } else {
    for (const stat of report.thesisStats) {
      lines.push(`- ${stat.thesisType}: ${stat.samples} samples, ${(stat.hitRate * 100).toFixed(1)}% target hit, useful ${(stat.usefulRate * 100).toFixed(1)}%, ${stat.partialProgress} partial, ${stat.invalidated} invalidated (${(stat.invalidationRate * 100).toFixed(1)}%), live confirm ${stat.liveConfirmationPresent}/${stat.samples}, statuses active/watch/early=${stat.statusCounts.active}/${stat.statusCounts.watch}/${stat.statusCounts.early}, lifecycle active/archive/outside/unknown=${stat.lifecycleScopes.active_window}/${stat.lifecycleScopes.archive_only}/${stat.lifecycleScopes.outside_active_window}/${stat.lifecycleScopes.unknown_lifecycle}, avg room ${stat.avgRoomToTargetPct === null ? "n/a" : formatPct(stat.avgRoomToTargetPct)}, avg best forward ${stat.avgBestForwardPct === null ? "n/a" : formatPct(stat.avgBestForwardPct)}, avg worst forward ${stat.avgWorstForwardPct === null ? "n/a" : formatPct(stat.avgWorstForwardPct)}`);
    }
  }
  lines.push("");
  lines.push("## Good Examples");
  lines.push("");
  if (report.goodExamples.length === 0) {
    lines.push("No good examples found.");
  } else {
    for (const sample of report.goodExamples) {
      lines.push(...renderSample(sample));
    }
  }
  lines.push("");
  lines.push("## Bad Or Noisy Examples");
  lines.push("");
  if (report.badExamples.length === 0) {
    lines.push("No bad/noisy examples found.");
  } else {
    for (const sample of report.badExamples) {
      lines.push(...renderSample(sample));
    }
  }
  lines.push("");
  lines.push("## Missed Meaningful Moves");
  lines.push("");
  if (report.missedMoves.length === 0) {
    lines.push("No missed meaningful moves found.");
  } else {
    for (const missed of report.missedMoves) {
      lines.push(`- ${missed.summary}`);
      lines.push(`  - Cutoff: ${missed.cutoffIso}`);
      lines.push(`  - Watchlist scope: ${missed.lifecycleScope}`);
      lines.push(`  - Live confirmation: ${missed.liveConfirmation.summary}`);
      for (const evidence of missed.evidence) {
        lines.push(`  - Evidence: ${evidence}`);
      }
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function writeChartThesisQaReport(options: WriteChartThesisQaReportOptions): ChartThesisQaReport {
  const report = buildChartThesisQaReport(options);
  mkdirSync(options.outputDirectory, { recursive: true });
  writeFileSync(join(options.outputDirectory, "chart-thesis-qa-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(options.outputDirectory, "chart-thesis-qa-report.md"), renderMarkdown(report));
  return report;
}

function readCachedResponse(filePath: string): CandleProviderResponse | null {
  const raw = JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as CachedCandlePayload;
  return raw.response ?? null;
}

function latestCacheFile(directoryPath: string): string | null {
  if (!existsSync(directoryPath)) {
    return null;
  }
  const files = readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(directoryPath, entry.name));
  return files
    .map((filePath) => {
      try {
        const raw = JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as CachedCandlePayload;
        return {
          filePath,
          endTimeMs: raw.request?.endTimeMs ?? 0,
          cachedAt: raw.cachedAt ?? 0,
          bars: raw.response?.candles?.length ?? 0,
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.endTimeMs - left.endTimeMs || right.cachedAt - left.cachedAt || right.bars - left.bars)[0]?.filePath ?? null;
}

export function readChartThesisQaSymbolsFromCache(options: {
  cacheDirectory: string;
  provider?: CandleProviderName;
  symbols?: string[];
  maxSymbols?: number;
}): ChartThesisQaSymbolInput[] {
  const provider = options.provider ?? "eodhd";
  const root = join(options.cacheDirectory, provider);
  if (!existsSync(root)) {
    return [];
  }

  const requested = new Set(options.symbols?.map((symbol) => symbol.toUpperCase()));
  const symbolNames = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name.toUpperCase())
    .filter((symbol) => requested.size === 0 || requested.has(symbol))
    .sort()
    .slice(0, options.maxSymbols ?? Number.POSITIVE_INFINITY);

  const result: ChartThesisQaSymbolInput[] = [];
  for (const symbol of symbolNames) {
    const seriesMap: Partial<Record<CandleTimeframe, CandleProviderResponse>> = {};
    for (const timeframe of ["daily", "4h", "5m"] as const) {
      const filePath = latestCacheFile(join(root, symbol, timeframe));
      if (!filePath) {
        continue;
      }
      const response = readCachedResponse(filePath);
      if (response) {
        seriesMap[timeframe] = response;
      }
    }
    if (seriesMap["4h"]?.candles?.length) {
      result.push({ symbol, seriesMap });
    }
  }
  return result;
}
