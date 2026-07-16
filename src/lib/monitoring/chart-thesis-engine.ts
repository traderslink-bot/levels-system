import type {
  ChartThesisRead,
  LevelSnapshotPayload,
} from "../alerts/alert-types.js";
import {
  isFreshActivePressReleaseCatalyst,
  type PressReleaseCatalystContext,
} from "../catalysts/press-release-catalyst-context.js";
import { classifyIntradayCandleTimestamp } from "../market-data/candle-session-classifier.js";
import type { Candle, CandleProviderResponse, CandleTimeframe } from "../market-data/candle-types.js";
import { evaluateLiveVolumeExpansionConfirmationQuality } from "./live-confirmation-quality.js";

export type ChartThesisEngineInput = {
  symbol: string;
  currentPrice: number;
  seriesMap: Partial<Record<CandleTimeframe, CandleProviderResponse>>;
  activeRunnerContext?: {
    catalystCardFreshness?: "same_day" | "recent_1_2_days" | "stale_3_7_days" | "no_card" | "lookup_unavailable";
    catalystContext?: PressReleaseCatalystContext;
    activeRunner?: boolean;
  };
};

type ThesisCandidate = ChartThesisRead & {
  score: number;
};

type SelloffCandidate = {
  timeframe: "daily" | "4h";
  candles: Candle[];
  index: number;
  dropPct: number;
  rangePct: number;
};

function formatPrice(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function formatPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatTriggerDistance(value: number): string {
  return value >= 0
    ? `${formatPct(value)} above the thesis trigger`
    : `${formatPct(Math.abs(value))} below the thesis trigger`;
}

function formatVolumeRatio(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "unavailable versus recent average";
  }

  if (value >= 100) {
    return ">100x recent average";
  }

  return value >= 10 ? `${value.toFixed(0)}x recent average` : `${value.toFixed(1)}x recent average`;
}

function bodyTop(candle: Candle): number {
  return Math.max(candle.open, candle.close);
}

function bodyBottom(candle: Candle): number {
  return Math.min(candle.open, candle.close);
}

function isValidCandle(candle: Candle): boolean {
  return (
    Number.isFinite(candle.timestamp) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    candle.open > 0 &&
    candle.high > 0 &&
    candle.low > 0 &&
    candle.close > 0 &&
    candle.high >= candle.low
  );
}

function recentCandles(series: CandleProviderResponse | undefined, count: number): Candle[] {
  return (series?.candles ?? [])
    .filter(isValidCandle)
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-count);
}

function rangeLabel(low: number, high: number): string {
  return Math.abs(high - low) / Math.max(high, 0.0001) <= 0.01
    ? formatPrice(high)
    : `${formatPrice(low)}-${formatPrice(high)}`;
}

function candleRange(candle: Candle): number {
  return candle.high - candle.low;
}

function upperCloseRatio(candle: Candle): number {
  const range = candleRange(candle);
  return range <= 0 ? 0 : (candle.close - candle.low) / range;
}

function ratioPct(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return (numerator / denominator) * 100;
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

function latestRegularSessionCandles(candles: Candle[]): Candle[] {
  const annotated = candles.map((candle) => ({
    candle,
    ...classifyIntradayCandleTimestamp(candle.timestamp),
  }));
  const latestSessionDate = annotated
    .filter((item) => item.session === "opening_range" || item.session === "regular")
    .at(-1)?.sessionDate;
  if (!latestSessionDate) return [];
  return annotated
    .filter((item) =>
      item.sessionDate === latestSessionDate &&
      (item.session === "opening_range" || item.session === "regular")
    )
    .map((item) => item.candle);
}

function buildActiveRunnerTapeContext(
  input: ChartThesisEngineInput,
  read: ThesisCandidate,
): ChartThesisRead["activeRunnerTape"] | null {
  if (input.activeRunnerContext?.activeRunner !== true) {
    return null;
  }

  const recentTapeCandles = recentCandles(input.seriesMap["5m"], 120);
  const regularSession = latestRegularSessionCandles(recentTapeCandles);
  const session = regularSession.length >= 12
    ? regularSession
    : latestSessionCandles(recentTapeCandles);
  const latest = session.at(-1);
  if (!latest || session.length < 12 || !Number.isFinite(latest.volume) || latest.volume <= 0) {
    return null;
  }

  const prior = session.slice(-18, -1);
  const positiveVolumeCandles = prior.filter((candle) => Number.isFinite(candle.volume) && candle.volume > 0);
  if (positiveVolumeCandles.length < 8) {
    return null;
  }

  const averagePriorVolume =
    positiveVolumeCandles.reduce((sum, candle) => sum + candle.volume, 0) / positiveVolumeCandles.length;
  const volumeRatio = latest.volume / Math.max(averagePriorVolume, 1);
  const latestRange = candleRange(latest);
  const latestRangePct = (latestRange / Math.max(latest.low, 0.0001)) * 100;
  const trigger = read.triggerHigh ?? read.triggerLow;
  if (!Number.isFinite(trigger) || !trigger || trigger <= 0) {
    return null;
  }

  const extensionPct = ((input.currentPrice - trigger) / Math.max(trigger, 0.0001)) * 100;
  const holdingUpperHalf = input.currentPrice >= latest.low + latestRange * 0.5;
  const latestCloseLocationPct = ratioPct(latest.close - latest.low, latestRange);
  const latestBodyPct = ratioPct(Math.abs(latest.close - latest.open), latestRange);
  const latestUpperWickPct = ratioPct(latest.high - Math.max(latest.open, latest.close), latestRange);
  const closeAboveTrigger = latest.close >= trigger;
  const recent = session.slice(-5);
  const recentPairs = recent.slice(1).map((candle, index) => ({ previous: recent[index]!, candle }));
  const recentHigherLows = recentPairs.filter(({ previous, candle }) => candle.low >= previous.low).length;
  const pullbackHeldTrigger = Math.min(...recent.map((candle) => candle.low)) >= trigger * 0.98;
  const closeClearedRecentHigh =
    recent.length > 1 && latest.close >= Math.max(...recent.slice(0, -1).map((candle) => candle.high));
  const weakCloseOrHeavyWick =
    (latestCloseLocationPct !== null && latestCloseLocationPct < 45) ||
    (latestUpperWickPct !== null && latestBodyPct !== null && latestUpperWickPct >= 35 && latestUpperWickPct > latestBodyPct);
  const structure: NonNullable<ChartThesisRead["activeRunnerTape"]>["structure"] =
    !closeAboveTrigger
      ? "lost_near_term_hold"
      : weakCloseOrHeavyWick
        ? "weak_close_or_heavy_wick"
        : closeClearedRecentHigh && (latestCloseLocationPct ?? 0) >= 65 && recentHigherLows >= Math.max(2, recentPairs.length - 1)
          ? "upper_range_control"
          : pullbackHeldTrigger
            ? "holding_near_term_hold"
            : "unavailable";
  const riskFlags = [
    volumeRatio > 25 ? "extreme 5m volume burst" : null,
    latestRangePct > 25 ? "very wide latest 5m candle" : null,
    extensionPct > 45 ? "price is far above the thesis trigger" : null,
    !holdingUpperHalf ? "latest 5m candle is not holding its upper half" : null,
    !closeAboveTrigger ? "latest 5m close lost the near-term hold" : null,
    weakCloseOrHeavyWick ? "latest 5m candle has a weak close or heavy upper wick" : null,
  ].filter((item): item is string => item !== null);
  const structureLine =
    structure === "lost_near_term_hold"
      ? `Latest 5m close is below the near-term hold at ${formatPrice(trigger)}, so buyers need a reclaim before the continuation read deserves stronger confidence.`
      : structure === "weak_close_or_heavy_wick"
        ? "Latest 5m candle is showing a weak close or heavy upper wick, so continuation is still possible but the read needs caution."
        : structure === "upper_range_control"
          ? "Latest 5m structure is still showing upper-range control, which supports continuation while buyers keep that hold."
          : structure === "holding_near_term_hold"
            ? `Recent 5m pullbacks are still holding the near-term hold area around ${formatPrice(trigger)}.`
            : `The 5m hold is mixed, so treat this as momentum with chase risk unless buyers tighten the hold.`;
  const tapeStatsLine = `latest candle range ${formatPct(latestRangePct)}, volume ${formatVolumeRatio(volumeRatio)}, and price is ${formatTriggerDistance(extensionPct)}`;

  if (volumeRatio >= 25 || latestRangePct >= 25 || extensionPct >= 45 || !holdingUpperHalf) {
    return {
      latestCandleAt: latest.timestamp,
      classification: "extended_chase_risk",
      structure,
      volumeRatio,
      latestRangePct,
      extensionPct,
      latestCloseLocationPct,
      latestUpperWickPct,
      line: `5m tape shows real momentum, but this is extended rather than clean: ${tapeStatsLine}. ${structureLine}`,
      riskFlags,
    };
  }

  if (volumeRatio >= 8 || latestRangePct >= 12 || extensionPct >= 18) {
    return {
      latestCandleAt: latest.timestamp,
      classification: "hot_volatile_5m_support",
      structure,
      volumeRatio,
      latestRangePct,
      extensionPct,
      latestCloseLocationPct,
      latestUpperWickPct,
      line: `5m tape supports the move, but volatility is elevated: ${tapeStatsLine}. ${structureLine}`,
      riskFlags,
    };
  }

  return {
    latestCandleAt: latest.timestamp,
    classification: "steady_5m_support",
    structure,
    volumeRatio,
    latestRangePct,
    extensionPct,
    latestCloseLocationPct,
    latestUpperWickPct,
    line: `5m tape is steady support for the thesis: ${tapeStatsLine}. ${structureLine}`,
    riskFlags,
  };
}

function confidenceFromScore(score: number): ChartThesisRead["confidence"] {
  if (score >= 82) return "high";
  if (score >= 62) return "medium";
  return "low";
}

function statusLabel(status: ChartThesisRead["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "watch":
      return "Setup watch";
    case "early":
      return "Early";
  }
}

function isWatchlistApprovedThesis(type: ChartThesisRead["type"]): boolean {
  return (
    type === "return_to_selloff_origin" ||
    type === "failed_breakdown_reclaim" ||
    type === "gap_fill_reclaim" ||
    type === "momentum_expansion_continuation" ||
    type === "catalyst_active_runner_continuation" ||
    type === "cleared_shelf_power_continuation" ||
    type === "washout_base_reversal" ||
    type === "damaged_range_reclaim" ||
    type === "below_range_buyer_reclaim" ||
    type === "lower_range_springboard" ||
    type === "controlled_range_breakout"
  );
}

function chartReadTitle(read: ChartThesisRead): string {
  return `Chart Thesis (${statusLabel(read.status)}: ${read.label}, ${read.confidence} confidence):`;
}

function findSelloffCandidate(timeframe: "daily" | "4h", candles: Candle[]): SelloffCandidate | null {
  const candidates: SelloffCandidate[] = [];
  const latestIndex = candles.length - 1;
  for (let index = Math.max(0, candles.length - 12); index < latestIndex; index += 1) {
    const candle = candles[index]!;
    const dropPct = ((candle.close - candle.open) / candle.open) * 100;
    const rangePct = ((candle.high - candle.low) / candle.high) * 100;
    const closeInLowerHalf = candle.close <= candle.low + (candle.high - candle.low) * 0.55;
    if ((dropPct <= -12 || rangePct >= 18) && closeInLowerHalf) {
      candidates.push({ timeframe, candles, index, dropPct, rangePct });
    }
  }

  return candidates
    .sort((left, right) => Math.max(right.rangePct, Math.abs(right.dropPct)) - Math.max(left.rangePct, Math.abs(left.dropPct)))[0] ?? null;
}

function bestSelloffCandidate(input: ChartThesisEngineInput): SelloffCandidate | null {
  const daily = findSelloffCandidate("daily", recentCandles(input.seriesMap.daily, 20));
  const fourHour = findSelloffCandidate("4h", recentCandles(input.seriesMap["4h"], 42));
  if (!daily) return fourHour;
  if (!fourHour) return daily;
  return Math.max(daily.rangePct, Math.abs(daily.dropPct)) >= Math.max(fourHour.rangePct, Math.abs(fourHour.dropPct))
    ? daily
    : fourHour;
}

function buildReturnToSelloffOriginThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const candidate = bestSelloffCandidate(input);
  if (!candidate) {
    return null;
  }

  const selloff = candidate.candles[candidate.index]!;
  const after = candidate.candles.slice(candidate.index + 1);
  if (after.length === 0) {
    return null;
  }

  const buyerResponseLow = Math.min(...after.map((candle) => candle.low));
  const buyerResponseHigh = Math.max(...after.map((candle) => candle.high));
  const bouncePct = ((input.currentPrice - buyerResponseLow) / Math.max(buyerResponseLow, 0.0001)) * 100;
  if (bouncePct < 15) {
    return null;
  }

  const selloffOriginLow = Math.min(bodyTop(selloff), selloff.high);
  const selloffOriginHigh = Math.max(bodyTop(selloff), selloff.high);
  if (selloffOriginHigh <= input.currentPrice) {
    return null;
  }

  const reclaimTrigger = Math.max(selloff.close, buyerResponseLow + (selloffOriginHigh - buyerResponseLow) * 0.38);
  const triggerGapPct = ((reclaimTrigger - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  const reclaimedTrigger = input.currentPrice >= reclaimTrigger;
  if (!reclaimedTrigger && triggerGapPct > 10) {
    return null;
  }

  const latest = candidate.candles.at(-1)!;
  const latestBodyPct = ((latest.close - latest.open) / Math.max(latest.open, 0.0001)) * 100;
  const recentHighAboveCurrentPct = ((buyerResponseHigh - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (!reclaimedTrigger && (latestBodyPct < 0 || recentHighAboveCurrentPct < 8)) {
    return null;
  }

  const roomToTargetPct = ((selloffOriginLow - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 18 || roomToTargetPct > 26) {
    return null;
  }

  const sessionsAgo = candidate.candles.length - 1 - candidate.index;
  const status: ChartThesisRead["status"] = reclaimedTrigger ? "active" : triggerGapPct <= 5 ? "watch" : "early";
  const score =
    38 +
    Math.min(16, Math.max(0, bouncePct)) +
    Math.min(18, Math.max(0, roomToTargetPct)) +
    (reclaimedTrigger ? 18 : Math.max(0, 12 - triggerGapPct)) -
    (status === "early" ? 8 : 0) -
    (candidate.timeframe === "daily" ? Math.max(0, sessionsAgo - 5) * 1.5 : 0);
  const origin = rangeLabel(selloffOriginLow, selloffOriginHigh);
  const triggerLine = reclaimedTrigger
    ? `Buyers responded near ${formatPrice(buyerResponseLow)}; holding above ${formatPrice(reclaimTrigger)} keeps the return-to-origin path in play.`
    : `Buyers responded near ${formatPrice(buyerResponseLow)}; a reclaim through ${formatPrice(reclaimTrigger)} is still needed before the return-to-origin path is active.`;

  return {
    type: "return_to_selloff_origin",
    label: "Return to selloff origin",
    timeframe: candidate.timeframe,
    status,
    confidence: confidenceFromScore(score),
    score,
    triggerLow: reclaimTrigger,
    triggerHigh: reclaimTrigger,
    targetLow: selloffOriginLow,
    targetHigh: selloffOriginHigh,
    invalidationLevel: buyerResponseLow,
    roomToTargetPct,
    sessionsAgo,
    evidence: [
      `selloff ${sessionsAgo} ${candidate.timeframe === "daily" ? "session" : "bar"}${sessionsAgo === 1 ? "" : "s"} ago`,
      `buyers responded near ${formatPrice(buyerResponseLow)}`,
      reclaimedTrigger
        ? `reclaimed ${formatPrice(reclaimTrigger)}`
        : `${formatPct(triggerGapPct)} below reclaim trigger`,
      reclaimedTrigger
        ? `active above reclaim trigger`
        : `${formatPct(recentHighAboveCurrentPct)} recent high-water mark above current`,
      `${formatPct(roomToTargetPct)} room to selloff-origin lower edge`,
    ],
    selloffOriginLow,
    selloffOriginHigh,
    buyerResponseLow,
    reclaimTrigger,
    returnTargetLow: selloffOriginLow,
    returnTargetHigh: selloffOriginHigh,
    lines: [
      `${input.symbol.toUpperCase()} had a sharp ${candidate.timeframe} selloff ${sessionsAgo} ${candidate.timeframe === "daily" ? "session" : "bar"}${sessionsAgo === 1 ? "" : "s"} ago from the ${origin} area.`,
      triggerLine,
      `If that reclaim holds, the chart has room back toward ${origin} (${formatPct(roomToTargetPct)} to the lower edge).`,
    ],
  };
}

function buildFailedBreakdownReclaimThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const candles = recentCandles(input.seriesMap["4h"], 24);
  const latest = candles.at(-1);
  if (!latest || candles.length < 6) {
    return null;
  }

  const prior = candles.slice(-7, -1);
  const older = candles.slice(-13, -7);
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const olderLow = older.length >= 3 ? Math.min(...older.map((candle) => candle.low)) : null;
  const sweptLow = latest.low < priorLow * 0.985;
  const reclaimed = latest.close > priorLow && input.currentPrice > priorLow;
  const sweepDepthPct = ((priorLow - latest.low) / Math.max(priorLow, 0.0001)) * 100;
  const reclaimExtensionPct = ((input.currentPrice - priorLow) / Math.max(priorLow, 0.0001)) * 100;
  const supportDriftPct = olderLow ? ((priorLow - olderLow) / Math.max(olderLow, 0.0001)) * 100 : 0;
  const latestRangePct = (candleRange(latest) / Math.max(latest.low, 0.0001)) * 100;
  const latestClosePositionPct = upperCloseRatio(latest) * 100;
  const reclaimCandleBodyPct = ((latest.close - latest.open) / Math.max(latest.open, 0.0001)) * 100;
  if (!sweptLow || !reclaimed || priorHigh <= input.currentPrice) {
    return null;
  }

  const roomToTargetPct = ((priorHigh - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  const controlledReclaimClose = latestClosePositionPct >= 45 || reclaimCandleBodyPct >= 2.5;
  const driftingSupportNeedsStrongerReclaim = supportDriftPct < -8 && sweepDepthPct >= 5 && reclaimCandleBodyPct < 1;
  if (
    roomToTargetPct < 12 ||
    roomToTargetPct > 32 ||
    sweepDepthPct < 2 ||
    reclaimExtensionPct > 5 ||
    latestRangePct > 35 ||
    driftingSupportNeedsStrongerReclaim ||
    !controlledReclaimClose
  ) {
    return null;
  }

  const score = 55 + Math.min(25, roomToTargetPct) + (input.currentPrice > latest.open ? 8 : 0);
  return {
    type: "failed_breakdown_reclaim",
    label: "Failed breakdown reclaim",
    timeframe: "4h",
    status: "active",
    confidence: confidenceFromScore(score),
    score,
    triggerLow: priorLow,
    triggerHigh: priorLow,
    targetLow: priorHigh,
    targetHigh: priorHigh,
    invalidationLevel: latest.low,
    roomToTargetPct,
    evidence: [
      `swept below ${formatPrice(priorLow)} and reclaimed`,
      `reclaim is ${formatPct(reclaimExtensionPct)} above swept support`,
      `support shelf drifted ${formatPct(supportDriftPct)} before the reclaim`,
      `range high sits near ${formatPrice(priorHigh)}`,
    ],
    lines: [
      `${input.symbol.toUpperCase()} swept below the recent ${formatPrice(priorLow)} support area and reclaimed it.`,
      `Holding above ${formatPrice(priorLow)} keeps the failed-breakdown read alive.`,
      `If buyers keep control, the natural return area is the prior range high near ${formatPrice(priorHigh)} (${formatPct(roomToTargetPct)}).`,
    ],
  };
}

function buildCompressionBreakoutThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const candles = recentCandles(input.seriesMap["4h"], 18);
  if (candles.length < 8) {
    return null;
  }

  const base = candles.slice(-7);
  const baseHigh = Math.max(...base.map((candle) => candle.high));
  const baseLow = Math.min(...base.map((candle) => candle.low));
  const baseRangePct = ((baseHigh - baseLow) / Math.max(input.currentPrice, 0.0001)) * 100;
  const triggerGapPct = ((baseHigh - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  const nearBaseHigh = triggerGapPct <= 4;
  if (baseRangePct < 11 || baseRangePct > 12 || !nearBaseHigh) {
    return null;
  }

  const expansionTarget = baseHigh + (baseHigh - baseLow);
  const roomToTargetPct = ((expansionTarget - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 14 || roomToTargetPct > 18) {
    return null;
  }

  const score = 48 + Math.max(0, 16 - baseRangePct) + Math.min(25, roomToTargetPct);
  return {
    type: "compression_breakout",
    label: "Compression breakout",
    timeframe: "4h",
    status: input.currentPrice >= baseHigh ? "active" : "watch",
    confidence: confidenceFromScore(score),
    score,
    triggerLow: baseHigh,
    triggerHigh: baseHigh,
    targetLow: expansionTarget,
    targetHigh: expansionTarget,
    invalidationLevel: baseLow,
    roomToTargetPct,
    evidence: [
      `recent 4h base compressed inside ${formatPrice(baseLow)}-${formatPrice(baseHigh)}`,
      `breakout trigger is ${formatPct(triggerGapPct)} away`,
    ],
    lines: [
      `${input.symbol.toUpperCase()} is compressing inside a tight 4h base from ${formatPrice(baseLow)} to ${formatPrice(baseHigh)}.`,
      `Acceptance above ${formatPrice(baseHigh)} would turn the base into a breakout setup.`,
      `A measured first expansion area is near ${formatPrice(expansionTarget)} (${formatPct(roomToTargetPct)}).`,
    ],
  };
}

function buildGapFillReclaimThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const candles = recentCandles(input.seriesMap.daily, 8);
  const latest = candles.at(-1);
  const prior = candles.at(-2);
  if (!latest || !prior) {
    return null;
  }

  const priorClose = prior.close;
  const gapDownPct = ((latest.open - priorClose) / Math.max(priorClose, 0.0001)) * 100;
  const reclaimedFromOpenPct = ((input.currentPrice - latest.open) / Math.max(latest.open, 0.0001)) * 100;
  const reclaimedFromLowPct = ((input.currentPrice - latest.low) / Math.max(latest.low, 0.0001)) * 100;
  const target = Math.min(priorClose, prior.high);
  if (
    gapDownPct > -10 ||
    reclaimedFromOpenPct < 6 ||
    reclaimedFromLowPct < 10 ||
    target <= input.currentPrice
  ) {
    return null;
  }

  const roomToTargetPct = ((target - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 10) {
    return null;
  }

  const score =
    52 +
    Math.min(18, Math.abs(gapDownPct)) +
    Math.min(15, reclaimedFromLowPct) +
    Math.min(20, roomToTargetPct);
  return {
    type: "gap_fill_reclaim",
    label: "Gap-fill reclaim",
    timeframe: "daily",
    status: "active",
    confidence: confidenceFromScore(score),
    score,
    triggerLow: latest.open,
    triggerHigh: latest.open,
    targetLow: target,
    targetHigh: target,
    invalidationLevel: latest.low,
    roomToTargetPct,
    evidence: [
      `gapped down ${formatPct(gapDownPct)} from prior close`,
      `buyers reclaimed ${formatPct(reclaimedFromOpenPct)} from the gap open`,
      `gap-fill target sits near ${formatPrice(target)}`,
    ],
    lines: [
      `${input.symbol.toUpperCase()} opened well below the prior close near ${formatPrice(priorClose)} and buyers are reclaiming the gap-down open.`,
      `Holding above the ${formatPrice(latest.open)} open keeps the gap-fill route in play.`,
      `The clean fill target is near ${formatPrice(target)} (${formatPct(roomToTargetPct)} from current price).`,
    ],
  };
}

function buildOpeningRangeExpansionThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const session = latestSessionCandles(recentCandles(input.seriesMap["5m"], 90));
  const latest = session.at(-1);
  if (!latest || session.length < 10) {
    return null;
  }

  const openingRange = session.slice(0, 6);
  const rangeHigh = Math.max(...openingRange.map((candle) => candle.high));
  const rangeLow = Math.min(...openingRange.map((candle) => candle.low));
  const rangePct = ((rangeHigh - rangeLow) / Math.max(rangeLow, 0.0001)) * 100;
  const holdingBreakout = input.currentPrice >= rangeHigh && latest.close >= rangeHigh;
  if (rangePct < 5 || !holdingBreakout) {
    return null;
  }

  const expansionTarget = rangeHigh + (rangeHigh - rangeLow) * 1.25;
  if (expansionTarget <= input.currentPrice) {
    return null;
  }

  const roomToTargetPct = ((expansionTarget - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 10) {
    return null;
  }

  const score = 50 + Math.min(18, rangePct) + Math.min(24, roomToTargetPct) + (input.currentPrice >= rangeHigh ? 8 : 0);
  return {
    type: "opening_range_expansion",
    label: "Opening range expansion",
    timeframe: "5m",
    status: "active",
    confidence: confidenceFromScore(score),
    score,
    triggerLow: rangeHigh,
    triggerHigh: rangeHigh,
    targetLow: expansionTarget,
    targetHigh: expansionTarget,
    invalidationLevel: rangeLow,
    roomToTargetPct,
    evidence: [
      `opening range ${formatPrice(rangeLow)}-${formatPrice(rangeHigh)}`,
      `price is holding above the opening-range high`,
      `measured expansion target near ${formatPrice(expansionTarget)}`,
    ],
    lines: [
      `${input.symbol.toUpperCase()} built an opening range from ${formatPrice(rangeLow)} to ${formatPrice(rangeHigh)} and is holding above the top of it.`,
      `Holding above ${formatPrice(rangeHigh)} keeps the opening-range expansion read active instead of anticipating it early.`,
      `The measured expansion area is near ${formatPrice(expansionTarget)} (${formatPct(roomToTargetPct)}).`,
    ],
  };
}

function buildLiveVolumeExpansionConfirmationThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const session = latestSessionCandles(recentCandles(input.seriesMap["5m"], 120));
  const latest = session.at(-1);
  if (!latest || session.length < 18) {
    return null;
  }

  const prior = session.slice(-18, -1);
  const positiveVolumeCandles = prior.filter((candle) => Number.isFinite(candle.volume) && candle.volume > 0);
  if (prior.length < 12 || positiveVolumeCandles.length < 8 || !Number.isFinite(latest.volume) || latest.volume <= 0) {
    return null;
  }

  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const priorRange = priorHigh - priorLow;
  const priorRangePct = (priorRange / Math.max(priorLow, 0.0001)) * 100;
  const latestRange = candleRange(latest);
  const latestRangePct = (latestRange / Math.max(latest.low, 0.0001)) * 100;
  const averagePriorVolume =
    positiveVolumeCandles.reduce((sum, candle) => sum + candle.volume, 0) / positiveVolumeCandles.length;
  const volumeRatio = latest.volume / Math.max(averagePriorVolume, 1);
  const brokeShortRange = latest.high >= priorHigh * 1.01 && input.currentPrice >= priorHigh * 0.995;
  const holdingExpansion = input.currentPrice >= Math.max(priorHigh * 0.995, latest.low + latestRange * 0.52);
  const strongClose = upperCloseRatio(latest) >= 0.58 || latest.close >= priorHigh;
  const closeExtensionPct = ((input.currentPrice - priorHigh) / Math.max(priorHigh, 0.0001)) * 100;
  const quality = evaluateLiveVolumeExpansionConfirmationQuality({
    currentPrice: input.currentPrice,
    latestRangePct,
    priorRangePct,
    closeExtensionPct,
    latestTimestamp: latest.timestamp,
  });

  if (
    !quality.passed ||
    !brokeShortRange ||
    !holdingExpansion ||
    !strongClose ||
    volumeRatio < 2
  ) {
    return null;
  }

  const trigger = priorHigh;
  const expansionUnit = Math.max(priorRange, latestRange);
  const target = Math.max(priorHigh + expansionUnit * 1.15, input.currentPrice + latestRange * 0.8);
  const roomToTargetPct = ((target - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 8 || roomToTargetPct > 120) {
    return null;
  }

  const score =
    56 +
    Math.min(18, volumeRatio * 4) +
    Math.min(16, latestRangePct) +
    Math.min(20, roomToTargetPct) +
    (input.currentPrice >= trigger ? 8 : 0);

  return {
    type: "live_volume_expansion_confirmation",
    label: "Live volume expansion confirmation",
    timeframe: "5m",
    status: "active",
    confidence: confidenceFromScore(score),
    score,
    triggerLow: trigger,
    triggerHigh: trigger,
    targetLow: target,
    targetHigh: target,
    invalidationLevel: Math.min(latest.low, trigger * 0.96),
    roomToTargetPct,
    evidence: [
      `cleared short-term 5m high near ${formatPrice(trigger)}`,
      `${volumeRatio.toFixed(1)}x recent 5m volume`,
      `close is ${formatPct(closeExtensionPct)} above the trigger`,
      `${formatPct(roomToTargetPct)} measured room to first expansion area`,
    ],
    lines: [
      `${input.symbol.toUpperCase()} is giving fresh 5m confirmation through the short-term high near ${formatPrice(trigger)}.`,
      `Volume expanded to ${volumeRatio.toFixed(1)}x the recent 5m average, so this is live tape confirmation rather than a quiet-base prediction.`,
      `If buyers hold the breakout area, the first practical expansion target is near ${formatPrice(target)} (${formatPct(roomToTargetPct)}).`,
    ],
  };
}

function buildImpulseFlagContinuationThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const candles = recentCandles(input.seriesMap["4h"], 30);
  const latest = candles.at(-1);
  if (!latest || candles.length < 9) {
    return null;
  }

  const candidates: ThesisCandidate[] = [];
  for (let index = Math.max(0, candles.length - 14); index <= candles.length - 4; index += 1) {
    const impulse = candles[index]!;
    const impulseRange = impulse.high - impulse.low;
    const impulsePct = (impulseRange / Math.max(impulse.low, 0.0001)) * 100;
    const closedStrong = impulse.close >= impulse.low + impulseRange * 0.62;
    if (impulsePct < 25 || !closedStrong) {
      continue;
    }

    const flag = candles.slice(index + 1);
    const flagLow = Math.min(...flag.map((candle) => candle.low));
    const flagHigh = Math.max(...flag.map((candle) => candle.high));
    const upperHalfHold = flagLow >= impulse.low + impulseRange * 0.45;
    const pressingFlagHigh = input.currentPrice >= flagHigh * 0.96;
    const target = impulse.high + impulseRange * 0.55;
    const buyerLiftPct = ((input.currentPrice - flagLow) / Math.max(flagLow, 0.0001)) * 100;
    const latestRangePct = (candleRange(latest) / Math.max(input.currentPrice, 0.0001)) * 100;
    if (!upperHalfHold || !pressingFlagHigh || target <= input.currentPrice) {
      continue;
    }

    const roomToTargetPct = ((target - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
    if (roomToTargetPct < 12 || roomToTargetPct > 18 || buyerLiftPct < 8 || latestRangePct > 10) {
      continue;
    }

    const barsAgo = candles.length - 1 - index;
    const score =
      54 +
      Math.min(20, impulsePct / 2) +
      Math.min(22, roomToTargetPct) +
      (input.currentPrice >= flagHigh ? 6 : 0);
    candidates.push({
      type: "impulse_flag_continuation",
      label: "Impulse flag continuation",
      timeframe: "4h",
      status: input.currentPrice >= flagHigh ? "active" : "watch",
      confidence: confidenceFromScore(score),
      score,
      triggerLow: flagHigh,
      triggerHigh: flagHigh,
      targetLow: target,
      targetHigh: target,
      invalidationLevel: flagLow,
      roomToTargetPct,
      sessionsAgo: barsAgo,
      evidence: [
        `${formatPct(impulsePct)} impulse ${barsAgo} 4h bars ago`,
        `pullback held the upper half above ${formatPrice(flagLow)}`,
        `continuation target near ${formatPrice(target)}`,
      ],
      lines: [
        `${input.symbol.toUpperCase()} made a strong 4h impulse ${barsAgo} bars ago and the pullback has held the upper half of that move.`,
        `A push through ${formatPrice(flagHigh)} would confirm the flag is turning back into continuation.`,
        `The next measured continuation area is near ${formatPrice(target)} (${formatPct(roomToTargetPct)}).`,
      ],
    });
  }

  return candidates.sort((left, right) => right.score - left.score)[0] ?? null;
}

export function buildImpulseFlagContinuationReadForQa(input: ChartThesisEngineInput): ChartThesisRead | null {
  return buildImpulseFlagContinuationThesis(input);
}

function buildMomentumExpansionContinuationThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const candles = recentCandles(input.seriesMap["4h"], 24);
  const latest = candles.at(-1);
  if (!latest || candles.length < 8) {
    return null;
  }

  const prior = candles.slice(-8, -1);
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const averagePriorRange =
    prior.reduce((sum, candle) => sum + candleRange(candle), 0) / Math.max(prior.length, 1);
  const latestRange = candleRange(latest);
  const expansionPct = (latestRange / Math.max(latest.low, 0.0001)) * 100;
  const rangeExpansionRatio = latestRange / Math.max(averagePriorRange, 0.0001);
  const brokePriorHigh = latest.high > priorHigh * 1.03;
  const strongClose = upperCloseRatio(latest) >= 0.62;
  const expansionBodyPct = ((latest.close - latest.open) / Math.max(latest.open, 0.0001)) * 100;
  const holdingBreakout = input.currentPrice >= Math.max(bodyBottom(latest), priorHigh * 0.98);
  if (
    expansionPct < 18 ||
    expansionBodyPct < 20 ||
    rangeExpansionRatio < 1.6 ||
    !brokePriorHigh ||
    !strongClose ||
    !holdingBreakout
  ) {
    return null;
  }

  const measuredTarget = latest.close + latestRange * 0.35;
  const priorRangeTarget = priorHigh + (priorHigh - priorLow) * 0.35;
  const target = Math.max(measuredTarget, priorRangeTarget);
  if (target <= input.currentPrice) {
    return null;
  }

  const roomToTargetPct = ((target - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 12) {
    return null;
  }

  const score =
    50 +
    Math.min(20, expansionPct / 2) +
    Math.min(14, rangeExpansionRatio * 3) +
    Math.min(20, roomToTargetPct);
  return {
    type: "momentum_expansion_continuation",
    label: "Momentum expansion continuation",
    timeframe: "4h",
    status: "active",
    confidence: confidenceFromScore(score),
    score,
    triggerLow: priorHigh,
    triggerHigh: priorHigh,
    targetLow: target,
    targetHigh: target,
    invalidationLevel: Math.max(priorHigh * 0.92, latest.low),
    roomToTargetPct,
    evidence: [
      `${formatPct(expansionPct)} latest 4h range`,
      `${formatPct(expansionBodyPct)} latest 4h body`,
      `${rangeExpansionRatio.toFixed(1)}x recent average range`,
      `cleared prior range high near ${formatPrice(priorHigh)}`,
    ],
    lines: [
      `${input.symbol.toUpperCase()} is in a live 4h expansion candle that cleared the recent range high near ${formatPrice(priorHigh)}.`,
      `As long as price holds above the breakout area, this is a momentum-continuation read rather than a pullback read.`,
      `The measured continuation area is near ${formatPrice(target)} (${formatPct(roomToTargetPct)}).`,
    ],
  };
}

function buildCatalystActiveRunnerContinuationThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const catalystContext = input.activeRunnerContext?.catalystContext;
  const hasFreshCatalyst =
    isFreshActivePressReleaseCatalyst(catalystContext) ||
    input.activeRunnerContext?.catalystCardFreshness === "same_day";
  if (
    input.activeRunnerContext?.activeRunner !== true ||
    !hasFreshCatalyst
  ) {
    return null;
  }

  const candles = recentCandles(input.seriesMap["4h"], 18);
  const latest = candles.at(-1);
  if (!latest || candles.length < 7) {
    return null;
  }

  const prior = candles.slice(-7, -1);
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const averagePriorRange =
    prior.reduce((sum, candle) => sum + candleRange(candle), 0) / Math.max(prior.length, 1);
  const latestRange = candleRange(latest);
  const expansionPct = (latestRange / Math.max(latest.low, 0.0001)) * 100;
  const expansionBodyPct = ((latest.close - latest.open) / Math.max(latest.open, 0.0001)) * 100;
  const rangeExpansionRatio = latestRange / Math.max(averagePriorRange, 0.0001);
  const latestCloseRatio = upperCloseRatio(latest);
  const clearedPriorHigh = latest.high >= priorHigh * 1.01 || input.currentPrice >= priorHigh * 0.99;
  const holdingUpperHalf = input.currentPrice >= latest.low + latestRange * 0.48;
  const notFullyExhausted = latestCloseRatio >= 0.38 && input.currentPrice <= latest.high * 1.04;
  const priorRangePct = ((priorHigh - priorLow) / Math.max(input.currentPrice, 0.0001)) * 100;

  if (
    expansionPct < 14 ||
    expansionPct > 95 ||
    rangeExpansionRatio < 1.15 ||
    expansionBodyPct < 6 ||
    !clearedPriorHigh ||
    !holdingUpperHalf ||
    !notFullyExhausted ||
    priorRangePct < 8
  ) {
    return null;
  }

  const target = Math.max(
    latest.high + latestRange * 0.55,
    priorHigh + (priorHigh - priorLow) * 0.45,
  );
  if (target <= input.currentPrice) {
    return null;
  }

  const roomToTargetPct = ((target - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 15 || roomToTargetPct > 95) {
    return null;
  }

  const invalidationLevel = Math.max(latest.low, priorHigh * 0.9);
  const catalystEvidence = catalystContext
    ? `${catalystContext.timing.replace(/_/g, " ")} local press-release catalyst`
    : "same-day catalyst card present";
  const catalystLine = catalystContext?.primaryArticle?.title
    ? `${input.symbol.toUpperCase()} has a fresh local press-release catalyst (${catalystContext.timing.replace(/_/g, " ")}): ${catalystContext.primaryArticle.title}.`
    : catalystContext
      ? `${input.symbol.toUpperCase()} has a fresh local press-release catalyst (${catalystContext.timing.replace(/_/g, " ")}).`
      : `${input.symbol.toUpperCase()} has a same-day catalyst card.`;

  const score =
    48 +
    Math.min(18, expansionPct / 2.5) +
    Math.min(12, rangeExpansionRatio * 3) +
    Math.min(18, roomToTargetPct / 2) +
    (latestCloseRatio >= 0.58 ? 8 : 0) +
    (catalystContext?.primaryArticle?.sourceKind === "ingest_events" ? 10 : 8);

  return {
    type: "catalyst_active_runner_continuation",
    label: "Catalyst active-runner continuation",
    timeframe: "4h",
    status: "active",
    confidence: confidenceFromScore(score),
    score,
    triggerLow: priorHigh,
    triggerHigh: priorHigh,
    targetLow: target,
    targetHigh: target,
    invalidationLevel,
    roomToTargetPct,
    evidence: [
      catalystEvidence,
      `${formatPct(expansionPct)} active 4h range`,
      `${rangeExpansionRatio.toFixed(1)}x recent average range`,
      `holding upper half of the active runner candle`,
    ],
    lines: [
      `${catalystLine} It is already in an active 4h runner candle.`,
      `As long as buyers keep price above the active-runner hold area near ${formatPrice(invalidationLevel)}, the continuation read stays alive.`,
      `The next practical extension area is near ${formatPrice(target)} (${formatPct(roomToTargetPct)}); losing that hold area turns this into a chase-risk read.`,
    ],
  };
}

function buildClearedShelfPowerContinuationThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  if (input.activeRunnerContext?.activeRunner !== true) {
    return null;
  }

  const candles = recentCandles(input.seriesMap["4h"], 18);
  const latest = candles.at(-1);
  if (!latest || candles.length < 8) {
    return null;
  }

  const prior = candles.slice(-8, -1);
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const range = priorHigh - priorLow;
  if (range <= 0) {
    return null;
  }

  const rangePct = (range / Math.max(input.currentPrice, 0.0001)) * 100;
  const positionPct = ((input.currentPrice - priorLow) / range) * 100;
  const shelfExtensionPct = ((input.currentPrice - priorHigh) / Math.max(priorHigh, 0.0001)) * 100;
  const latestRange = candleRange(latest);
  const latestRangePct = (latestRange / Math.max(input.currentPrice, 0.0001)) * 100;
  const constructiveClose = latest.close >= latest.open || upperCloseRatio(latest) >= 0.52;
  const stillHoldingBreakout = input.currentPrice >= priorHigh * 1.01 &&
    latest.close >= priorHigh * 1.01 &&
    input.currentPrice >= latest.low + latestRange * 0.35;
  const notOneCandleExhaustion = upperCloseRatio(latest) >= 0.32 && latestRangePct <= 95;
  const baseShelfSetup =
    rangePct >= 5 &&
    rangePct <= 12 &&
    positionPct >= 400 &&
    positionPct <= 1200;
  const cleanBreakoutSetup =
    baseShelfSetup &&
    shelfExtensionPct >= 1 &&
    shelfExtensionPct <= 220 &&
    constructiveClose &&
    stillHoldingBreakout &&
    notOneCandleExhaustion;
  const extensionHoldSetup =
    baseShelfSetup &&
    shelfExtensionPct >= 30 &&
    shelfExtensionPct <= 180 &&
    input.currentPrice >= priorHigh * 1.03 &&
    input.currentPrice >= latest.low + latestRange * 0.3 &&
    upperCloseRatio(latest) >= 0.18 &&
    latestRangePct <= 180;

  if (!cleanBreakoutSetup && !extensionHoldSetup) {
    return null;
  }

  const breakoutLeg = input.currentPrice - priorHigh;
  const target = cleanBreakoutSetup
    ? input.currentPrice + Math.max(range * 3.2, breakoutLeg * 0.38)
    : input.currentPrice + Math.max(range * 5.3, breakoutLeg * 0.62);
  const roomToTargetPct = ((target - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 25 || roomToTargetPct > 95) {
    return null;
  }

  const invalidationLevel = cleanBreakoutSetup
    ? Math.max(priorHigh, input.currentPrice - Math.max(range * 2.2, breakoutLeg * 0.28))
    : Math.max(priorHigh, input.currentPrice - Math.max(range * 2.7, breakoutLeg * 0.34));
  const score = cleanBreakoutSetup
    ? 54 +
      Math.max(0, Math.min(14, 12 - rangePct)) +
      Math.min(12, Math.max(0, positionPct - 400) / 80) +
      Math.min(18, roomToTargetPct / 3) +
      (input.activeRunnerContext.catalystCardFreshness === "same_day" ? 6 : 0) +
      (constructiveClose ? 6 : 0)
    : 48 +
      Math.max(0, Math.min(12, 12 - rangePct)) +
      Math.min(14, shelfExtensionPct / 8) +
      Math.min(18, roomToTargetPct / 3) +
      (input.activeRunnerContext.catalystCardFreshness === "same_day" ? 5 : 0) +
      (constructiveClose ? 4 : 0);
  const extensionHoldLabel = cleanBreakoutSetup
    ? "cleared-shelf continuation read"
    : "cleared-shelf extension-hold read";

  return {
    type: "cleared_shelf_power_continuation",
    label: "Cleared shelf power continuation",
    timeframe: "4h",
    status: "active",
    confidence: confidenceFromScore(score),
    score,
    triggerLow: priorHigh,
    triggerHigh: priorHigh,
    targetLow: target,
    targetHigh: target,
    invalidationLevel,
    roomToTargetPct,
    evidence: [
      `active runner cleared a tight 4h shelf near ${formatPrice(priorHigh)}`,
      `prior shelf range was ${formatPct(rangePct)}`,
      `price is extended ${formatPct(shelfExtensionPct)} beyond the shelf high`,
      `${formatPct(roomToTargetPct)} measured room to the next power-continuation area`,
    ],
    lines: [
      `${input.symbol.toUpperCase()} has already cleared a tight 4h shelf from ${formatPrice(priorLow)} to ${formatPrice(priorHigh)} and is holding above it as an active runner.`,
      `This is a ${extensionHoldLabel}: buyers need to keep price above the acceleration hold area near ${formatPrice(invalidationLevel)}.`,
      `If that hold survives, the next power-continuation area is near ${formatPrice(target)} (${formatPct(roomToTargetPct)}); losing the hold area makes it a chase-risk move.`,
    ],
  };
}

function buildWashoutBaseReversalThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const candles = recentCandles(input.seriesMap["4h"], 22);
  const latest = candles.at(-1);
  if (!latest || candles.length < 8) {
    return null;
  }

  const lookback = candles.slice(-10);
  const prior = lookback.slice(0, -1);
  const recent = lookback.slice(-4);
  if (prior.length < 5 || recent.length < 3) {
    return null;
  }

  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const range = priorHigh - Math.min(priorLow, recentLow);
  const rangePct = (range / Math.max(input.currentPrice, 0.0001)) * 100;
  const positionPct = ((input.currentPrice - recentLow) / Math.max(range, 0.0001)) * 100;
  const selloffPct = ((priorHigh - recentLow) / Math.max(priorHigh, 0.0001)) * 100;
  const currentAboveRecentLowPct = ((input.currentPrice - recentLow) / Math.max(recentLow, 0.0001)) * 100;
  const repeatedLowTouches = recent.filter((candle) => candle.low <= recentLow * 1.04).length >= 2;
  const constructiveLatest = latest.close >= latest.open || upperCloseRatio(latest) >= 0.42;
  const notAlreadyExtended = input.currentPrice <= priorHigh * 0.78;

  if (
    selloffPct < 28 ||
    selloffPct > 32 ||
    rangePct < 14 ||
    positionPct > 38 ||
    currentAboveRecentLowPct > 12 ||
    !notAlreadyExtended ||
    (!repeatedLowTouches && !constructiveLatest)
  ) {
    return null;
  }

  const reclaimTrigger = Math.max(recentHigh, recentLow + range * 0.22);
  const target = Math.min(priorHigh, recentLow + range * 0.72);
  if (target <= input.currentPrice || reclaimTrigger <= recentLow) {
    return null;
  }

  const roomToTargetPct = ((target - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  const triggerGapPct = ((reclaimTrigger - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 18 || roomToTargetPct > 30 || triggerGapPct <= 10 || triggerGapPct > 25) {
    return null;
  }

  const status: ChartThesisRead["status"] = "early";
  const rawScore =
    32 +
    Math.min(18, selloffPct / 1.5) +
    Math.min(20, roomToTargetPct / 2) +
    (repeatedLowTouches ? 8 : 0) +
    (constructiveLatest ? 5 : 0) +
    Math.max(0, 8 - triggerGapPct / 2) -
    8;
  const score = Math.min(rawScore, 58);

  return {
    type: "washout_base_reversal",
    label: "Washout base reversal",
    timeframe: "4h",
    status,
    confidence: confidenceFromScore(score),
    score,
    triggerLow: reclaimTrigger,
    triggerHigh: reclaimTrigger,
    targetLow: target,
    targetHigh: target,
    invalidationLevel: recentLow * 0.96,
    roomToTargetPct,
    evidence: [
      `washed out ${formatPct(-selloffPct)} from the recent 4h shelf`,
      `base low near ${formatPrice(recentLow)}`,
      `${formatPct(roomToTargetPct)} room back toward the lower return shelf`,
    ],
    buyerResponseLow: recentLow,
    reclaimTrigger,
    returnTargetLow: target,
    returnTargetHigh: priorHigh,
    lines: [
      `${input.symbol.toUpperCase()} is washed out near the lower end of its recent 4h range after a ${formatPct(-selloffPct)} slide from the prior shelf.`,
      `The first useful reclaim trigger is near ${formatPrice(reclaimTrigger)}; without that, this is still a base-reversal watch, not confirmation.`,
      `If buyers keep defending ${formatPrice(recentLow)}, the first practical return area is near ${formatPrice(target)} (${formatPct(roomToTargetPct)}), with the wider shelf up toward ${formatPrice(priorHigh)}.`,
    ],
  };
}

function buildDamagedRangeReclaimThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const candles = recentCandles(input.seriesMap["4h"], 22);
  const latest = candles.at(-1);
  if (!latest || candles.length < 9) {
    return null;
  }

  const lookback = candles.slice(-10);
  const prior = lookback.slice(0, -1);
  const recent = lookback.slice(-4);
  if (prior.length < 5 || recent.length < 3) {
    return null;
  }

  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const range = priorHigh - Math.min(priorLow, recentLow);
  const selloffPct = ((priorHigh - recentLow) / Math.max(priorHigh, 0.0001)) * 100;
  const positionPct = ((input.currentPrice - recentLow) / Math.max(range, 0.0001)) * 100;
  const currentAboveRecentLowPct = ((input.currentPrice - recentLow) / Math.max(recentLow, 0.0001)) * 100;
  const reclaimedRecentBody = input.currentPrice >= Math.min(...recent.map((candle) => bodyTop(candle))) * 0.98;
  const latestCloseAbovePrevious = latest.close > (candles.at(-2)?.close ?? Number.POSITIVE_INFINITY);
  const recentUpperCloses = recent.filter((candle) => upperCloseRatio(candle) >= 0.45).length;
  const recentLowIndex = recent.findIndex((candle) => candle.low === recentLow);
  const candlesAfterDamageLow = recent.slice(recentLowIndex + 1);
  const higherLowAfterDamage =
    candlesAfterDamageLow.length > 0 && Math.min(...candlesAfterDamageLow.map((candle) => candle.low)) > recentLow * 1.02;

  if (
    selloffPct < 35 ||
    selloffPct > 48 ||
    positionPct > 35 ||
    (!reclaimedRecentBody && currentAboveRecentLowPct < 4)
  ) {
    return null;
  }

  const reclaimTrigger = Math.max(recentHigh, recentLow + range * 0.3);
  const target = Math.min(priorHigh, recentLow + range * 0.62);
  if (target <= input.currentPrice || reclaimTrigger <= recentLow) {
    return null;
  }

  const triggerGapPct = ((reclaimTrigger - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  const roomToTargetPct = ((target - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 18 || roomToTargetPct > 30 || triggerGapPct > 30) {
    return null;
  }

  const hasFreshRepairCandle =
    latestCloseAbovePrevious && triggerGapPct <= 30 && (currentAboveRecentLowPct >= 15 || recentUpperCloses >= 2);
  const hasConstructiveRepairShelf = recentUpperCloses >= 3 && higherLowAfterDamage && triggerGapPct <= 20;
  if (
    currentAboveRecentLowPct < 14 ||
    currentAboveRecentLowPct > 24 ||
    !reclaimedRecentBody ||
    (!hasFreshRepairCandle && !hasConstructiveRepairShelf)
  ) {
    return null;
  }

  const reclaimedTrigger = input.currentPrice >= reclaimTrigger;
  const status: ChartThesisRead["status"] = reclaimedTrigger
    ? "active"
    : triggerGapPct <= 15
      ? "watch"
      : "early";
  const score =
    44 +
    Math.min(18, (selloffPct - 32) / 1.6) +
    Math.min(22, roomToTargetPct / 2) +
    Math.min(12, currentAboveRecentLowPct / 2) +
    (reclaimedRecentBody ? 8 : 0) +
    (hasFreshRepairCandle ? 8 : 0) +
    (hasConstructiveRepairShelf ? 6 : 0) +
    (reclaimedTrigger ? 10 : Math.max(0, 8 - triggerGapPct / 4)) -
    (status === "early" ? 6 : 0);

  return {
    type: "damaged_range_reclaim",
    label: "Damaged range reclaim",
    timeframe: "4h",
    status,
    confidence: confidenceFromScore(score),
    score,
    triggerLow: reclaimTrigger,
    triggerHigh: reclaimTrigger,
    targetLow: target,
    targetHigh: target,
    invalidationLevel: recentLow * 0.93,
    roomToTargetPct,
    evidence: [
      `range was damaged by a ${formatPct(-selloffPct)} 4h break`,
      `buyers lifted price ${formatPct(currentAboveRecentLowPct)} from the damage low`,
      `${formatPct(roomToTargetPct)} room back toward the first broken shelf`,
    ],
    buyerResponseLow: recentLow,
    reclaimTrigger,
    returnTargetLow: target,
    returnTargetHigh: priorHigh,
    lines: [
      `${input.symbol.toUpperCase()} is not a clean base reversal; the prior 4h range was damaged by a ${formatPct(-selloffPct)} break from the shelf.`,
      reclaimedTrigger
        ? `Price has reclaimed the damaged-range trigger near ${formatPrice(reclaimTrigger)}, which puts the first broken shelf back in play.`
        : `A reclaim through ${formatPrice(reclaimTrigger)} is the confirmation trigger that buyers are repairing the damaged range.`,
      `If that repair holds, the first practical destination is near ${formatPrice(target)} (${formatPct(roomToTargetPct)}), with the wider broken shelf up toward ${formatPrice(priorHigh)}.`,
    ],
  };
}

function buildBelowRangeBuyerReclaimThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const candles = recentCandles(input.seriesMap["4h"], 18);
  const latest = candles.at(-1);
  if (!latest || candles.length < 9) {
    return null;
  }

  const prior = candles.slice(-9, -1);
  const recent = candles.slice(-3);
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const range = priorHigh - priorLow;
  const rangePct = (range / Math.max(input.currentPrice, 0.0001)) * 100;
  const positionPct = ((input.currentPrice - priorLow) / Math.max(range, 0.0001)) * 100;
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const bounceFromRecentLowPct = ((input.currentPrice - recentLow) / Math.max(recentLow, 0.0001)) * 100;
  const latestRangePct = (candleRange(latest) / Math.max(input.currentPrice, 0.0001)) * 100;
  const latestCloseRatio = upperCloseRatio(latest);
  const constructiveLatest = latest.close >= latest.open || latestCloseRatio >= 0.58;
  const reclaimedRecentBody = input.currentPrice >= Math.min(...recent.map((candle) => bodyTop(candle))) * 0.98;
  const touchedOrUndercutRangeLow = recentLow <= priorLow * 1.04;
  const notPureCollapse = latest.close >= latest.low + candleRange(latest) * 0.45;
  const notAlreadyUpperRange = positionPct <= 48;
  const quietEnoughForRead = latestRangePct <= 42;

  if (
    rangePct < 18 ||
    rangePct > 160 ||
    positionPct < 8 ||
    positionPct > 48 ||
    bounceFromRecentLowPct < 10 ||
    bounceFromRecentLowPct > 16 ||
    !notAlreadyUpperRange ||
    !constructiveLatest ||
    !reclaimedRecentBody ||
    !touchedOrUndercutRangeLow ||
    !notPureCollapse ||
    !quietEnoughForRead
  ) {
    return null;
  }

  const midpointTarget = priorLow + range * 0.55;
  const upperShelfTarget = priorLow + range * 0.82;
  const target = positionPct < 12 ? midpointTarget : upperShelfTarget;
  if (target <= input.currentPrice) {
    return null;
  }

  const roomToTargetPct = ((target - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 18 || roomToTargetPct > 32) {
    return null;
  }

  const reclaimTrigger = priorLow;
  const triggerGapPct = ((reclaimTrigger - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  const reclaimedRangeLow = input.currentPrice >= reclaimTrigger;
  if (!reclaimedRangeLow) {
    return null;
  }
  const status: ChartThesisRead["status"] = reclaimedRangeLow
    ? "active"
    : triggerGapPct <= 12
      ? "watch"
      : "early";
  const score =
    40 +
    Math.min(16, bounceFromRecentLowPct) +
    Math.min(22, roomToTargetPct / 2) +
    Math.max(0, Math.min(12, 48 - positionPct) / 3) +
    (reclaimedRangeLow ? 10 : Math.max(0, 8 - triggerGapPct / 2)) +
    (latestCloseRatio >= 0.68 ? 5 : 0) -
    (status === "early" ? 8 : 0);

  return {
    type: "below_range_buyer_reclaim",
    label: "Below-range buyer reclaim",
    timeframe: "4h",
    status,
    confidence: confidenceFromScore(score),
    score,
    triggerLow: reclaimTrigger,
    triggerHigh: reclaimTrigger,
    targetLow: target,
    targetHigh: target,
    invalidationLevel: recentLow * 0.94,
    roomToTargetPct,
    evidence: [
      `price is ${positionPct.toFixed(1)}% through the recent 4h range`,
      `buyers lifted it ${formatPct(bounceFromRecentLowPct)} from the response low`,
      `${formatPct(roomToTargetPct)} room back toward the range return area`,
    ],
    buyerResponseLow: recentLow,
    reclaimTrigger,
    returnTargetLow: target,
    returnTargetHigh: priorHigh,
    lines: [
      `${input.symbol.toUpperCase()} is still low in its recent 4h range from ${formatPrice(priorLow)} to ${formatPrice(priorHigh)}, but buyers have started responding near ${formatPrice(recentLow)}.`,
      reclaimedRangeLow
        ? `Price has reclaimed the lower range edge near ${formatPrice(reclaimTrigger)}, which turns this from a dead-chart look into a buyer-reclaim read.`
        : `A reclaim through the lower range edge near ${formatPrice(reclaimTrigger)} is the cleaner confirmation trigger; until then this is a buyer-response watch.`,
      `If buyers keep defending that response low, the first practical return area is near ${formatPrice(target)} (${formatPct(roomToTargetPct)}), with the wider shelf up toward ${formatPrice(priorHigh)}.`,
    ],
  };
}

function buildLowerRangeSpringboardThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const candles = recentCandles(input.seriesMap["4h"], 18);
  const latest = candles.at(-1);
  if (!latest || candles.length < 9) {
    return null;
  }

  const prior = candles.slice(-9, -1);
  const recent = candles.slice(-3);
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const range = priorHigh - priorLow;
  const rangePct = (range / Math.max(input.currentPrice, 0.0001)) * 100;
  const positionPct = ((input.currentPrice - priorLow) / Math.max(range, 0.0001)) * 100;
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const bounceFromRecentLowPct = ((input.currentPrice - recentLow) / Math.max(recentLow, 0.0001)) * 100;
  const latestRangePct = (candleRange(latest) / Math.max(input.currentPrice, 0.0001)) * 100;
  const latestCloseRatio = upperCloseRatio(latest);
  const recentUpperCloses = recent.filter((candle) => upperCloseRatio(candle) >= 0.45).length;
  const reclaimedRecentBody = input.currentPrice >= Math.min(...recent.map((candle) => bodyTop(candle))) * 0.985;
  const touchedOrUndercutRangeLow = recentLow <= priorLow * 1.04;

  if (
    rangePct < 14 ||
    rangePct > 120 ||
    positionPct < -20 ||
    positionPct > 12 ||
    bounceFromRecentLowPct < 1 ||
    !touchedOrUndercutRangeLow ||
    latestRangePct > 18 ||
    recentUpperCloses < 1 ||
    !reclaimedRecentBody ||
    latestCloseRatio < 0.22 ||
    latestCloseRatio > 0.65
  ) {
    return null;
  }

  const midpointTarget = priorLow + range * 0.55;
  const upperShelfTarget = priorLow + range * 0.82;
  const target = positionPct < 12 ? midpointTarget : upperShelfTarget;
  if (target <= input.currentPrice) {
    return null;
  }

  const roomToTargetPct = ((target - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 30 || roomToTargetPct > 48) {
    return null;
  }

  const reclaimTrigger = priorLow;
  const triggerGapPct = ((reclaimTrigger - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  const reclaimedRangeLow = input.currentPrice >= reclaimTrigger;
  const status: ChartThesisRead["status"] = reclaimedRangeLow
    ? "active"
    : triggerGapPct <= 12
      ? "watch"
      : "early";
  const score =
    26 +
    Math.min(12, bounceFromRecentLowPct) +
    Math.min(18, roomToTargetPct / 4) +
    Math.max(0, Math.min(10, 35 - positionPct) / 3) +
    (recentUpperCloses >= 2 ? 5 : 0) +
    (reclaimedRangeLow ? 7 : Math.max(0, 6 - triggerGapPct / 3)) -
    (status === "early" ? 6 : 0);

  return {
    type: "lower_range_springboard",
    label: "Lower-range springboard",
    timeframe: "4h",
    status,
    confidence: confidenceFromScore(score),
    score,
    triggerLow: reclaimTrigger,
    triggerHigh: reclaimTrigger,
    targetLow: target,
    targetHigh: target,
    invalidationLevel: recentLow * 0.78,
    roomToTargetPct,
    evidence: [
      `price is ${positionPct.toFixed(1)}% through the recent 4h range`,
      `buyers are trying to spring from the lower range after a ${formatPct(bounceFromRecentLowPct)} lift`,
      `${formatPct(roomToTargetPct)} room back toward the first range-return area`,
    ],
    buyerResponseLow: recentLow,
    reclaimTrigger,
    returnTargetLow: target,
    returnTargetHigh: priorHigh,
    lines: [
      `${input.symbol.toUpperCase()} is still near the lower end of its recent 4h range from ${formatPrice(priorLow)} to ${formatPrice(priorHigh)}.`,
      reclaimedRangeLow
        ? `Price is back above the lower range edge near ${formatPrice(reclaimTrigger)}, so this can act as a lower-range springboard if buyers keep absorbing dips.`
        : `A reclaim through ${formatPrice(reclaimTrigger)} is the cleaner springboard trigger; before that, this is still a lower-range buyer-response watch.`,
      `Because this is still low in the range, the first practical destination is near ${formatPrice(target)} (${formatPct(roomToTargetPct)}), while the risk marker has to stay wider near ${formatPrice(recentLow * 0.78)}.`,
    ],
  };
}

function buildQuietRangeAccumulationThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const candles = recentCandles(input.seriesMap["4h"], 18);
  const latest = candles.at(-1);
  if (!latest || candles.length < 9) {
    return null;
  }

  const prior = candles.slice(-9, -1);
  const recent = candles.slice(-4);
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const range = priorHigh - priorLow;
  const rangePct = (range / Math.max(input.currentPrice, 0.0001)) * 100;
  const positionPct = ((input.currentPrice - priorLow) / Math.max(range, 0.0001)) * 100;
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const earlyLow = Math.min(...prior.slice(0, 4).map((candle) => candle.low));
  const lateLow = Math.min(...prior.slice(-4).map((candle) => candle.low));
  const averagePriorRange = prior.reduce((sum, candle) => sum + candleRange(candle), 0) / Math.max(prior.length, 1);
  const latestRange = candleRange(latest);
  const latestRangePct = (latestRange / Math.max(input.currentPrice, 0.0001)) * 100;
  const rangeExpansionRatio = latestRange / Math.max(averagePriorRange, 0.0001);
  const constructiveRecentCount = recent.filter((candle) => candle.close >= candle.open || upperCloseRatio(candle) >= 0.55).length;
  const holdingHigherSupport = lateLow >= earlyLow * 0.96;
  const notPressingBreakout = input.currentPrice <= priorHigh * 0.94;
  const notBelowRange = input.currentPrice >= priorLow * 0.99;
  const quietLatest = latestRangePct <= 22 && rangeExpansionRatio <= 2.1;
  const buyerLiftPct = ((input.currentPrice - recentLow) / Math.max(recentLow, 0.0001)) * 100;

  if (
    rangePct < 10 ||
    rangePct > 42 ||
    positionPct < 24 ||
    positionPct > 40 ||
    !notBelowRange ||
    !notPressingBreakout ||
    !quietLatest ||
    !holdingHigherSupport ||
    constructiveRecentCount < 2 ||
    buyerLiftPct < 3
  ) {
    return null;
  }

  const trigger = Math.max(recentHigh, priorLow + range * 0.55);
  const target = priorHigh;
  if (target <= input.currentPrice || trigger <= priorLow) {
    return null;
  }

  const triggerGapPct = ((trigger - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  const roomToTargetPct = ((target - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 18 || roomToTargetPct > 30 || triggerGapPct < 12 || triggerGapPct > 22) {
    return null;
  }

  const status: ChartThesisRead["status"] = "early";
  const score =
    42 +
    Math.max(0, Math.min(14, 42 - rangePct) / 2) +
    Math.min(18, roomToTargetPct / 1.8) +
    Math.min(10, buyerLiftPct / 2) +
    (constructiveRecentCount >= 3 ? 6 : 0) +
    Math.max(0, 8 - triggerGapPct / 3) -
    6;

  return {
    type: "quiet_range_accumulation",
    label: "Quiet range accumulation",
    timeframe: "4h",
    status,
    confidence: confidenceFromScore(score),
    score,
    triggerLow: trigger,
    triggerHigh: trigger,
    targetLow: target,
    targetHigh: target,
    invalidationLevel: recentLow * 0.95,
    roomToTargetPct,
    evidence: [
      `price is ${positionPct.toFixed(1)}% through a quiet 4h range`,
      `higher support is holding near ${formatPrice(lateLow)}`,
      `${formatPct(roomToTargetPct)} room back to the range high`,
    ],
    buyerResponseLow: recentLow,
    reclaimTrigger: trigger,
    returnTargetLow: target,
    returnTargetHigh: target,
    lines: [
      `${input.symbol.toUpperCase()} is not at the breakout yet; it is building quietly inside a 4h range from ${formatPrice(priorLow)} to ${formatPrice(priorHigh)}.`,
      `A push through ${formatPrice(trigger)} is the first accumulation trigger to confirm buyers are taking control.`,
      `If that buyer build continues, the practical first destination is the prior range high near ${formatPrice(target)} (${formatPct(roomToTargetPct)}).`,
    ],
  };
}

function buildQuietBaseMeasuredExpansionThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const candles = recentCandles(input.seriesMap["4h"], 18);
  const latest = candles.at(-1);
  if (!latest || candles.length < 9) {
    return null;
  }

  const prior = candles.slice(-9, -1);
  const recent = candles.slice(-4);
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const range = priorHigh - priorLow;
  if (range <= 0) {
    return null;
  }

  const rangePct = (range / Math.max(input.currentPrice, 0.0001)) * 100;
  const positionPct = ((input.currentPrice - priorLow) / Math.max(range, 0.0001)) * 100;
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const averagePriorRange = prior.reduce((sum, candle) => sum + candleRange(candle), 0) / Math.max(prior.length, 1);
  const latestRange = candleRange(latest);
  const latestRangePct = (latestRange / Math.max(input.currentPrice, 0.0001)) * 100;
  const rangeExpansionRatio = latestRange / Math.max(averagePriorRange, 0.0001);
  const constructiveRecentCount = recent.filter((candle) => candle.close >= candle.open || upperCloseRatio(candle) >= 0.55).length;
  const latestUpperCloseRatio = upperCloseRatio(latest);
  const buyerLiftPct = ((input.currentPrice - recentLow) / Math.max(recentLow, 0.0001)) * 100;
  const notBelowRange = input.currentPrice >= priorLow * 0.99;
  const notPressingBreakout = input.currentPrice <= priorHigh * 0.94;
  const quietLatest = latestRangePct <= 18 && rangeExpansionRatio <= 2.1;

  if (
    rangePct < 16 ||
    rangePct > 23 ||
    positionPct < 50 ||
    positionPct > 65 ||
    !notBelowRange ||
    !notPressingBreakout ||
    !quietLatest ||
    constructiveRecentCount < 3 ||
    buyerLiftPct < 8 ||
    latestUpperCloseRatio < 0.5 ||
    latestUpperCloseRatio > 0.68
  ) {
    return null;
  }

  const trigger = Math.max(recentHigh, priorLow + range * 0.55);
  const target = priorHigh + range * 0.75;
  if (target <= input.currentPrice || trigger <= priorLow) {
    return null;
  }

  const triggerGapPct = ((trigger - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  const roomToTargetPct = ((target - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 18 || roomToTargetPct > 30 || triggerGapPct > 3) {
    return null;
  }

  const active = input.currentPrice >= trigger;
  const status: ChartThesisRead["status"] = active ? "active" : "watch";
  const score =
    50 +
    Math.max(0, Math.min(12, 35 - rangePct) / 1.5) +
    Math.min(18, roomToTargetPct / 2.5) +
    Math.min(12, buyerLiftPct / 2) +
    (constructiveRecentCount >= 4 ? 5 : 0) +
    (active ? 6 : Math.max(0, 6 - triggerGapPct));

  return {
    type: "quiet_base_measured_expansion",
    label: "Quiet base measured expansion",
    timeframe: "4h",
    status,
    confidence: confidenceFromScore(score),
    score,
    triggerLow: trigger,
    triggerHigh: trigger,
    targetLow: target,
    targetHigh: target,
    invalidationLevel: recentLow * 0.85,
    roomToTargetPct,
    evidence: [
      `buyers lifted price ${formatPct(buyerLiftPct)} off the recent base low`,
      `price is ${positionPct.toFixed(1)}% through a quiet 4h base`,
      `${formatPct(roomToTargetPct)} room into the measured expansion area`,
    ],
    buyerResponseLow: recentLow,
    reclaimTrigger: trigger,
    returnTargetLow: target,
    returnTargetHigh: target,
    lines: [
      `${input.symbol.toUpperCase()} is still quiet, but buyers have lifted it into the upper half of the 4h base.`,
      active
        ? `Price is through the nearby base trigger at ${formatPrice(trigger)}, so the measured-expansion read is active.`
        : `A push through ${formatPrice(trigger)} is the nearby trigger that would confirm the quiet base is starting to expand.`,
      `If that expansion follows through, the next practical destination is near ${formatPrice(target)} (${formatPct(roomToTargetPct)}); below ${formatPrice(recentLow * 0.85)} weakens the read.`,
    ],
  };
}

function buildControlledRangeBreakoutThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const candles = recentCandles(input.seriesMap["4h"], 18);
  const latest = candles.at(-1);
  if (!latest || candles.length < 8) {
    return null;
  }

  const prior = candles.slice(-8, -1);
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const range = priorHigh - priorLow;
  const rangePct = (range / Math.max(input.currentPrice, 0.0001)) * 100;
  const positionPct = ((input.currentPrice - priorLow) / Math.max(range, 0.0001)) * 100;
  const averagePriorRange =
    prior.reduce((sum, candle) => sum + candleRange(candle), 0) / Math.max(prior.length, 1);
  const latestRange = candleRange(latest);
  const latestRangePct = (latestRange / Math.max(input.currentPrice, 0.0001)) * 100;
  const rangeExpansionRatio = latestRange / Math.max(averagePriorRange, 0.0001);
  const closedConstructively = latest.close >= latest.open || upperCloseRatio(latest) >= 0.58;
  const trigger = priorHigh;
  const active = input.currentPrice >= trigger;
  const notNewsBurst = latestRangePct <= 15 && rangeExpansionRatio <= 2.4;
  const baseHeldSupport = Math.min(...prior.slice(-3).map((candle) => candle.low)) >= priorLow * 0.96;
  const notOverextendedFromShelf = input.currentPrice <= priorHigh * 1.18;

  if (
    rangePct < 10 ||
    rangePct > 30 ||
    positionPct < 58 ||
    !active ||
    !closedConstructively ||
    !notNewsBurst ||
    !baseHeldSupport ||
    !notOverextendedFromShelf
  ) {
    return null;
  }

  const measuredTarget = priorHigh + range * 1.35;
  const target = Math.max(measuredTarget, input.currentPrice + range * 0.75);
  if (target <= input.currentPrice) {
    return null;
  }

  const roomToTargetPct = ((target - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 18 || roomToTargetPct > 32) {
    return null;
  }

  const score =
    44 +
    Math.max(0, Math.min(16, 30 - rangePct)) +
    Math.min(14, Math.max(0, positionPct - 58) / 4) +
    Math.min(18, roomToTargetPct) +
    8;
  return {
    type: "controlled_range_breakout",
    label: "Controlled range breakout",
    timeframe: "4h",
    status: "active",
    confidence: confidenceFromScore(score),
    score,
    triggerLow: trigger,
    triggerHigh: trigger,
    targetLow: target,
    targetHigh: target,
    invalidationLevel: Math.max(priorLow + range * 0.45, trigger * 0.94),
    roomToTargetPct,
    evidence: [
      `4h shelf ${formatPrice(priorLow)}-${formatPrice(priorHigh)}`,
      `cleared shelf trigger near ${formatPrice(trigger)}`,
      `${formatPct(roomToTargetPct)} measured room to first continuation area`,
    ],
    lines: [
      `${input.symbol.toUpperCase()} has built a controlled 4h shelf from ${formatPrice(priorLow)} to ${formatPrice(priorHigh)}.`,
      `Price is working through the shelf high near ${formatPrice(trigger)}, so this is a controlled breakout read rather than a random spike.`,
      `If buyers hold the shelf, the first continuation area is near ${formatPrice(target)} (${formatPct(roomToTargetPct)}).`,
    ],
  };
}

function buildUpperRangeIgnitionThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  if (input.activeRunnerContext?.activeRunner !== true) {
    return null;
  }

  const candles = recentCandles(input.seriesMap["4h"], 18);
  const latest = candles.at(-1);
  if (!latest || candles.length < 8) {
    return null;
  }

  const prior = candles.slice(-8, -1);
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const range = priorHigh - priorLow;
  const rangePct = (range / Math.max(input.currentPrice, 0.0001)) * 100;
  const positionPct = ((input.currentPrice - priorLow) / Math.max(range, 0.0001)) * 100;
  const shelfExtensionPct = ((input.currentPrice - priorHigh) / Math.max(priorHigh, 0.0001)) * 100;
  const constructiveClose = upperCloseRatio(latest) >= 0.45;
  if (
    rangePct < 8 ||
    rangePct > 28 ||
    positionPct < 55 ||
    positionPct > 180 ||
    shelfExtensionPct > 15 ||
    !constructiveClose
  ) {
    return null;
  }

  const breakoutTrigger = priorHigh;
  const active = input.currentPrice >= breakoutTrigger;
  const measuredTarget = priorHigh + range * 3.1;
  const fallbackTarget = input.currentPrice + range * 1.7;
  const target = Math.max(measuredTarget, fallbackTarget);
  const roomToTargetPct = ((target - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  const triggerGapPct = ((breakoutTrigger - input.currentPrice) / Math.max(input.currentPrice, 0.0001)) * 100;
  if (roomToTargetPct < 18 || roomToTargetPct > 95 || triggerGapPct > 8) {
    return null;
  }

  const score =
    48 +
    Math.max(0, Math.min(16, 28 - rangePct)) +
    Math.min(14, Math.max(0, positionPct - 55) / 8) +
    Math.min(18, roomToTargetPct / 2) +
    Math.min(8, upperCloseRatio(latest) * 8);
  return {
    type: "upper_range_ignition",
    label: "Upper-range ignition",
    timeframe: "4h",
    status: active ? "active" : "watch",
    confidence: confidenceFromScore(score),
    score,
    triggerLow: breakoutTrigger,
    triggerHigh: breakoutTrigger,
    targetLow: target,
    targetHigh: target,
    invalidationLevel: priorLow + range * 0.45,
    roomToTargetPct,
    evidence: [
      `price is ${positionPct.toFixed(1)}% through the recent range`,
      `recent 4h range is ${formatPct(rangePct)}`,
      `price is ${formatPct(shelfExtensionPct)} beyond the prior range high`,
      `breakout trigger is ${formatPct(triggerGapPct)} away near ${formatPrice(breakoutTrigger)}`,
    ],
    lines: [
      `${input.symbol.toUpperCase()} is holding the upper part of a recent 4h range from ${formatPrice(priorLow)} to ${formatPrice(priorHigh)}.`,
      active
        ? `Price is through the range high near ${formatPrice(breakoutTrigger)}, but it is not overextended enough to make the setup a pure chase read.`
        : `A push through ${formatPrice(breakoutTrigger)} would be the ignition trigger for continuation.`,
      `If that trigger works, the first measured expansion area is near ${formatPrice(target)} (${formatPct(roomToTargetPct)}).`,
    ],
  };
}

function pctAbove(value: number, base: number): number {
  return ((value - base) / Math.max(base, 0.0001)) * 100;
}

function emaClose(candles: Candle[], period: number): number | null {
  if (candles.length === 0) return null;
  const multiplier = 2 / (period + 1);
  let value = candles[0]!.close;
  for (const candle of candles.slice(1)) {
    value = candle.close * multiplier + value * (1 - multiplier);
  }
  return value;
}

function sessionVwap(candles: Candle[]): number | null {
  const usable = candles.filter((candle) => Number.isFinite(candle.volume) && candle.volume > 0);
  if (usable.length === 0) return null;
  const volume = usable.reduce((sum, candle) => sum + candle.volume, 0);
  if (volume <= 0) return null;
  return usable.reduce(
    (sum, candle) => sum + ((candle.high + candle.low + candle.close) / 3) * candle.volume,
    0,
  ) / volume;
}

function activeSmallCapSession(input: ChartThesisEngineInput, minimumCandles: number): Candle[] {
  if (input.activeRunnerContext?.activeRunner !== true) return [];
  const session = latestRegularSessionCandles(recentCandles(input.seriesMap["5m"], 120));
  return session.length >= minimumCandles ? session : [];
}

function buildSmallCapFirstPullbackThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const session = activeSmallCapSession(input, 14);
  const latest = session.at(-1);
  const previous = session.at(-2);
  if (!latest || !previous) return null;

  const impulseWindow = session.slice(0, -3);
  const high = Math.max(...impulseWindow.map((candle) => candle.high));
  const highIndex = session.findIndex((candle) => candle.high === high);
  if (highIndex < 2 || highIndex > session.length - 4) return null;
  const impulseLow = Math.min(...session.slice(0, highIndex + 1).map((candle) => candle.low));
  const impulsePct = pctAbove(high, impulseLow);
  const afterHigh = session.slice(highIndex + 1);
  const pullbackLow = Math.min(...afterHigh.map((candle) => candle.low));
  const pullbackDepthPct = ((high - pullbackLow) / Math.max(high, 0.0001)) * 100;
  const recoveryPct = pctAbove(input.currentPrice, pullbackLow);
  const roomToHodPct = pctAbove(high, input.currentPrice);
  const recent = session.slice(-4);
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const higherLowHolding = recentLow >= pullbackLow * 0.995 && latest.low > pullbackLow * 1.002;
  const constructiveLatest = latest.close >= latest.open && upperCloseRatio(latest) >= 0.55;
  const ema9 = emaClose(session, 9);
  if (
    impulsePct < 20 || impulsePct > 500 ||
    pullbackDepthPct < 5 || pullbackDepthPct > 32 ||
    recoveryPct < 4 || roomToHodPct < 5 || roomToHodPct > 35 ||
    !higherLowHolding || !constructiveLatest || ema9 === null
  ) {
    return null;
  }

  const trigger = Math.max(ema9, previous.high);
  const active = latest.close >= trigger && input.currentPrice >= trigger;
  const impulseRange = high - impulseLow;
  const extensionTarget = high + impulseRange * 0.3;
  const score =
    54 +
    Math.min(18, impulsePct / 5) +
    Math.min(12, recoveryPct / 2) +
    Math.max(0, 12 - pullbackDepthPct / 3) +
    (active ? 10 : 3);
  return {
    type: "small_cap_first_pullback",
    label: "First pullback reclaim",
    timeframe: "5m",
    status: active ? "active" : "watch",
    confidence: confidenceFromScore(score),
    score,
    triggerLow: trigger,
    triggerHigh: trigger,
    targetLow: high,
    targetHigh: extensionTarget,
    invalidationLevel: pullbackLow * 0.98,
    buyerResponseLow: pullbackLow,
    roomToTargetPct: roomToHodPct,
    evidence: [
      `${formatPct(impulsePct)} session impulse before the first controlled pullback`,
      `${formatPct(pullbackDepthPct)} pullback from HOD`,
      `higher low is holding above ${formatPrice(pullbackLow)}`,
      `reclaim trigger near ${formatPrice(trigger)}`,
    ],
    lines: [
      `${input.symbol.toUpperCase()} made a ${formatPct(impulsePct)} intraday impulse and is working through its first controlled pullback.`,
      `The dip-buy area is the higher-low response around ${formatPrice(pullbackLow)}; confirmation requires a reclaim through ${formatPrice(trigger)}.`,
      `HOD near ${formatPrice(high)} is the first obstacle/objective, with measured continuation near ${formatPrice(extensionTarget)} if HOD clears.`,
    ],
  };
}

function buildSmallCapOpeningRangeRetestThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const session = activeSmallCapSession(input, 12);
  const latest = session.at(-1);
  const previous = session.at(-2);
  if (!latest || !previous) return null;
  const openingRange = session.slice(0, 6);
  const rangeHigh = Math.max(...openingRange.map((candle) => candle.high));
  const rangeLow = Math.min(...openingRange.map((candle) => candle.low));
  const range = rangeHigh - rangeLow;
  const rangePct = (range / Math.max(rangeLow, 0.0001)) * 100;
  const breakoutIndex = session.findIndex((candle, index) =>
    index >= 6 && candle.high >= rangeHigh * 1.025 && candle.close >= rangeHigh
  );
  if (breakoutIndex < 6 || breakoutIndex > session.length - 3) return null;
  const afterBreakout = session.slice(breakoutIndex + 1);
  const retestCandidates = afterBreakout.filter((candle) =>
    candle.low <= rangeHigh * 1.04 && candle.low >= rangeHigh * 0.94
  );
  const retest = retestCandidates.at(-1);
  if (!retest) return null;
  const reclaimTrigger = Math.max(rangeHigh, previous.high);
  const active = latest.close >= reclaimTrigger && upperCloseRatio(latest) >= 0.55;
  const sessionHigh = Math.max(...session.map((candle) => candle.high));
  const measuredTarget = rangeHigh + range * 1.5;
  const targetLow = sessionHigh > input.currentPrice * 1.04 ? sessionHigh : measuredTarget;
  const targetHigh = Math.max(measuredTarget, targetLow + range * 0.75);
  const roomToTargetPct = pctAbove(targetLow, input.currentPrice);
  if (
    rangePct < 5 || rangePct > 45 ||
    retest.timestamp < session[breakoutIndex]!.timestamp ||
    latest.close < rangeHigh * 0.995 ||
    roomToTargetPct < 5 || roomToTargetPct > 80
  ) {
    return null;
  }
  const score =
    56 +
    Math.min(16, rangePct / 2) +
    Math.min(14, roomToTargetPct) +
    (active ? 12 : 3) +
    (retest.low >= rangeHigh * 0.98 ? 6 : 0);
  return {
    type: "small_cap_opening_range_retest",
    label: "Opening-range breakout retest",
    timeframe: "5m",
    status: active ? "active" : "watch",
    confidence: confidenceFromScore(score),
    score,
    triggerLow: reclaimTrigger,
    triggerHigh: reclaimTrigger,
    targetLow,
    targetHigh,
    invalidationLevel: Math.min(retest.low, rangeHigh * 0.975) * 0.99,
    buyerResponseLow: retest.low,
    roomToTargetPct,
    evidence: [
      `opening range ${formatPrice(rangeLow)}-${formatPrice(rangeHigh)}`,
      `breakout retested the opening-range high instead of extending blindly`,
      `reclaim confirmation near ${formatPrice(reclaimTrigger)}`,
    ],
    lines: [
      `${input.symbol.toUpperCase()} cleared the opening-range high near ${formatPrice(rangeHigh)} and then retested that breakout area.`,
      `The retest low near ${formatPrice(retest.low)} is the hold; a reclaim through ${formatPrice(reclaimTrigger)} confirms buyers are defending it.`,
      `The next meaningful objective is ${formatPrice(targetLow)}, with extension toward ${formatPrice(targetHigh)} only after the nearer obstacle clears.`,
    ],
  };
}

function buildSmallCapVwapReclaimThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const session = activeSmallCapSession(input, 14);
  const latest = session.at(-1);
  const previous = session.at(-2);
  if (!latest || !previous) return null;
  const vwap = sessionVwap(session);
  if (vwap === null) return null;
  const recent = session.slice(-9);
  const early = recent.slice(0, -3);
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const earlyLow = Math.min(...early.map((candle) => candle.low));
  const lateLow = Math.min(...recent.slice(-3).map((candle) => candle.low));
  const maxBelowVwapPct = Math.max(...recent.map((candle) =>
    ((vwap - candle.low) / Math.max(vwap, 0.0001)) * 100
  ));
  const reclaimed = latest.close >= vwap && previous.close >= vwap * 0.995;
  const higherLow = lateLow >= earlyLow * 1.005;
  const constructiveLatest = latest.close >= latest.open && upperCloseRatio(latest) >= 0.55;
  const sessionHigh = Math.max(...session.map((candle) => candle.high));
  const sessionLow = Math.min(...session.map((candle) => candle.low));
  const sessionRange = sessionHigh - sessionLow;
  const sessionRangePct = (sessionRange / Math.max(sessionLow, 0.0001)) * 100;
  const trigger = Math.max(vwap, previous.high);
  const active = reclaimed && higherLow && constructiveLatest && latest.close >= trigger;
  const targetLow = sessionHigh > input.currentPrice * 1.05
    ? sessionHigh
    : sessionHigh + sessionRange * 0.3;
  const targetHigh = Math.max(targetLow + sessionRange * 0.25, sessionHigh + sessionRange * 0.55);
  const roomToTargetPct = pctAbove(targetLow, input.currentPrice);
  if (
    maxBelowVwapPct < 2.5 || maxBelowVwapPct > 35 ||
    !reclaimed || !higherLow || !constructiveLatest ||
    sessionRangePct < 15 || roomToTargetPct < 6 || roomToTargetPct > 80
  ) {
    return null;
  }
  const score =
    55 +
    Math.min(14, maxBelowVwapPct) +
    Math.min(12, pctAbove(input.currentPrice, recentLow) / 2) +
    Math.min(14, roomToTargetPct) +
    (active ? 12 : 4);
  return {
    type: "small_cap_vwap_reclaim",
    label: "VWAP reclaim with higher low",
    timeframe: "5m",
    status: active ? "active" : "watch",
    confidence: confidenceFromScore(score),
    score,
    triggerLow: trigger,
    triggerHigh: trigger,
    targetLow,
    targetHigh,
    invalidationLevel: recentLow * 0.985,
    buyerResponseLow: recentLow,
    roomToTargetPct,
    evidence: [
      `price recovered from ${formatPct(-maxBelowVwapPct)} below session VWAP`,
      `recent 5m lows improved from ${formatPrice(earlyLow)} to ${formatPrice(lateLow)}`,
      `VWAP reclaim trigger near ${formatPrice(trigger)}`,
    ],
    lines: [
      `${input.symbol.toUpperCase()} traded below VWAP, reclaimed it, and is building a higher 5m low instead of merely crossing the line once.`,
      `The higher-low response near ${formatPrice(recentLow)} is the risk point; confirmation is a hold through ${formatPrice(trigger)}.`,
      `The first meaningful objective is near ${formatPrice(targetLow)}, with extension toward ${formatPrice(targetHigh)} if the session high clears.`,
    ],
  };
}

function buildSmallCapFlushReclaimThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const session = activeSmallCapSession(input, 14);
  const latest = session.at(-1);
  if (!latest) return null;
  let selected: { candle: Candle; priorLow: number; priorHigh: number; index: number } | null = null;
  for (let index = Math.max(6, session.length - 9); index < session.length - 1; index += 1) {
    const prior = session.slice(index - 6, index);
    const candle = session[index]!;
    const priorLow = Math.min(...prior.map((item) => item.low));
    const priorHigh = Math.max(...prior.map((item) => item.high));
    const flushRangePct = (candleRange(candle) / Math.max(candle.low, 0.0001)) * 100;
    if (candle.low <= priorLow * 0.96 && flushRangePct >= 8) {
      selected = { candle, priorLow, priorHigh, index };
    }
  }
  if (!selected) return null;
  const afterFlush = session.slice(selected.index + 1);
  const reclaimClose = Math.max(...afterFlush.map((candle) => candle.close));
  const latestConstructive = latest.close >= latest.open && upperCloseRatio(latest) >= 0.52;
  const reclaimed = reclaimClose >= selected.priorLow && latest.close >= selected.priorLow * 0.995;
  const liftFromFlushPct = pctAbove(input.currentPrice, selected.candle.low);
  const trigger = Math.max(selected.priorLow, session.at(-2)?.high ?? selected.priorLow);
  const active = reclaimed && latest.close >= trigger && latestConstructive;
  const sessionHigh = Math.max(...session.map((candle) => candle.high));
  const preFlushRange = selected.priorHigh - selected.priorLow;
  const targetLow = selected.priorHigh > input.currentPrice * 1.05
    ? selected.priorHigh
    : Math.max(sessionHigh, input.currentPrice + preFlushRange * 0.8);
  const targetHigh = Math.max(targetLow + preFlushRange * 0.55, sessionHigh + preFlushRange * 0.75);
  const roomToTargetPct = pctAbove(targetLow, input.currentPrice);
  if (
    !reclaimed || !latestConstructive ||
    liftFromFlushPct < 8 || liftFromFlushPct > 80 ||
    roomToTargetPct < 7 || roomToTargetPct > 100
  ) {
    return null;
  }
  const score =
    58 +
    Math.min(18, liftFromFlushPct / 2) +
    Math.min(14, roomToTargetPct) +
    (active ? 12 : 4) +
    (selected.candle.close >= selected.priorLow ? 5 : 0);
  return {
    type: "small_cap_flush_reclaim",
    label: "Flush-and-reclaim dip buy",
    timeframe: "5m",
    status: active ? "active" : "watch",
    confidence: confidenceFromScore(score),
    score,
    triggerLow: trigger,
    triggerHigh: trigger,
    targetLow,
    targetHigh,
    invalidationLevel: selected.candle.low * 0.985,
    buyerResponseLow: selected.candle.low,
    roomToTargetPct,
    evidence: [
      `flush swept ${formatPrice(selected.priorLow)} down to ${formatPrice(selected.candle.low)}`,
      `buyers reclaimed the pre-flush support area`,
      `${formatPct(liftFromFlushPct)} recovery from the flush low`,
    ],
    lines: [
      `${input.symbol.toUpperCase()} flushed below the prior 5m support area near ${formatPrice(selected.priorLow)} and then reclaimed it.`,
      `The flush low at ${formatPrice(selected.candle.low)} is the failure point; confirmation requires holding through ${formatPrice(trigger)}.`,
      `The pre-flush origin near ${formatPrice(targetLow)} is the first meaningful objective, with ${formatPrice(targetHigh)} available only if that supply clears.`,
    ],
  };
}

function buildSmallCapIntradayBaseBreakoutThesis(input: ChartThesisEngineInput): ThesisCandidate | null {
  const session = activeSmallCapSession(input, 18);
  const latest = session.at(-1);
  if (!latest) return null;
  const candidates: ThesisCandidate[] = [];
  const firstBreakoutIndex = Math.max(8, session.length - 5);
  for (let breakoutIndex = firstBreakoutIndex; breakoutIndex < session.length; breakoutIndex += 1) {
    const breakout = session[breakoutIndex]!;
    for (const baseBars of [6, 8, 10, 12]) {
      if (breakoutIndex <= baseBars + 4) continue;
      const base = session.slice(breakoutIndex - baseBars, breakoutIndex);
      const beforeBase = session.slice(0, breakoutIndex - baseBars);
      if (base.length !== baseBars || beforeBase.length < 4) continue;
      const baseHigh = Math.max(...base.map((candle) => candle.high));
      const baseLow = Math.min(...base.map((candle) => candle.low));
      const baseRange = baseHigh - baseLow;
      const baseRangePct = (baseRange / Math.max(baseLow, 0.0001)) * 100;
      const priorLow = Math.min(...beforeBase.map((candle) => candle.low));
      const priorHigh = Math.max(...beforeBase.map((candle) => candle.high));
      const priorImpulsePct = pctAbove(priorHigh, priorLow);
      const breakoutPct = pctAbove(breakout.close, baseHigh);
      const breakoutRangePct = (candleRange(breakout) / Math.max(breakout.low, 0.0001)) * 100;
      const positiveVolume = base.filter((candle) => candle.volume > 0);
      const averageVolume = positiveVolume.length > 0
        ? positiveVolume.reduce((sum, candle) => sum + candle.volume, 0) / positiveVolume.length
        : null;
      const volumeRatio = averageVolume && breakout.volume > 0 ? breakout.volume / averageVolume : null;
      const volumeConfirmed = volumeRatio === null || volumeRatio >= 1.2;
      if (
        priorImpulsePct < 15 ||
        baseRangePct < 4 || baseRangePct > 18 ||
        breakoutPct < 0.4 || breakoutPct > 12 ||
        breakout.close < breakout.open || upperCloseRatio(breakout) < 0.6 ||
        breakoutRangePct > 22 || !volumeConfirmed
      ) {
        continue;
      }

      // A breakout candle alone is only a watch. It becomes actionable after a
      // later candle tests the breakout area and a separate candle reclaims it.
      const afterBreakoutBeforeLatest = session.slice(breakoutIndex + 1, -1);
      const retest = [...afterBreakoutBeforeLatest].reverse().find((candle) =>
        candle.low <= baseHigh * 1.035 &&
        candle.low >= baseHigh * 0.94 &&
        candle.close >= baseHigh * 0.98
      ) ?? null;
      const retestIndex = retest ? session.indexOf(retest) : -1;
      const retestConfirmed =
        retest !== null &&
        retestIndex > breakoutIndex &&
        retestIndex < session.length - 1 &&
        latest.close >= Math.max(baseHigh, retest.high) &&
        latest.close >= latest.open &&
        upperCloseRatio(latest) >= 0.55;
      const trigger = retestConfirmed ? Math.max(baseHigh, retest!.high) : baseHigh;
      const targetLow = baseHigh + baseRange * 1.5;
      const targetHigh = baseHigh + baseRange * 2.5;
      const roomToTargetPct = pctAbove(targetLow, input.currentPrice);
      if (roomToTargetPct < 7 || roomToTargetPct > 80) continue;
      const score =
        56 +
        Math.min(14, priorImpulsePct / 4) +
        Math.max(0, 12 - baseRangePct / 2) +
        Math.min(12, roomToTargetPct) +
        Math.min(8, (volumeRatio ?? 1.2) * 2) +
        (retestConfirmed ? 12 : 0);
      const responseLow = retest?.low ?? Math.min(...base.slice(-3).map((candle) => candle.low));
      candidates.push({
        type: "small_cap_intraday_base_breakout",
        label: retestConfirmed ? "Intraday base breakout retest" : "Intraday base breakout watch",
        timeframe: "5m",
        status: retestConfirmed ? "active" : "watch",
        confidence: confidenceFromScore(score),
        score,
        triggerLow: trigger,
        triggerHigh: trigger,
        targetLow,
        targetHigh,
        invalidationLevel: (retestConfirmed ? Math.min(responseLow, baseHigh * 0.985) : baseLow) * 0.99,
        buyerResponseLow: responseLow,
        roomToTargetPct,
        evidence: [
          `${formatPct(priorImpulsePct)} earlier session impulse`,
          `${baseBars}-bar base held inside ${formatPrice(baseLow)}-${formatPrice(baseHigh)}`,
          `breakout closed ${formatPct(breakoutPct)} above the base`,
          volumeRatio === null ? "volume confirmation unavailable" : `${volumeRatio.toFixed(1)}x base volume`,
          retestConfirmed
            ? `later retest held near ${formatPrice(responseLow)} and reclaimed ${formatPrice(trigger)}`
            : "breakout retest has not confirmed yet",
        ],
        lines: [
          `${input.symbol.toUpperCase()} paused after an earlier ${formatPct(priorImpulsePct)} impulse and built a ${baseBars}-bar intraday base.`,
          retestConfirmed
            ? `The breakout was retested near ${formatPrice(responseLow)} and reclaimed through ${formatPrice(trigger)}; losing the retest low invalidates the setup.`
            : `The close through ${formatPrice(baseHigh)} starts a watch, but it still needs a later retest and reclaim before it is a confirmed trade setup.`,
          `The measured objectives are ${formatPrice(targetLow)} and ${formatPrice(targetHigh)}, subject to clearing nearer mapped resistance first.`,
        ],
      });
    }
  }
  return candidates.sort((left, right) => right.score - left.score)[0] ?? null;
}

function buildSmallCapTradeSetupCandidates(input: ChartThesisEngineInput): ThesisCandidate[] {
  return [
    buildSmallCapFirstPullbackThesis(input),
    buildSmallCapOpeningRangeRetestThesis(input),
    buildSmallCapVwapReclaimThesis(input),
    buildSmallCapFlushReclaimThesis(input),
    buildSmallCapIntradayBaseBreakoutThesis(input),
  ].filter((candidate): candidate is ThesisCandidate => candidate !== null);
}

function buildChartThesisCandidates(input: ChartThesisEngineInput): ThesisCandidate[] {
  return [
    buildReturnToSelloffOriginThesis(input),
    buildFailedBreakdownReclaimThesis(input),
    buildCompressionBreakoutThesis(input),
    buildGapFillReclaimThesis(input),
    buildOpeningRangeExpansionThesis(input),
    buildLiveVolumeExpansionConfirmationThesis(input),
    buildImpulseFlagContinuationThesis(input),
    buildMomentumExpansionContinuationThesis(input),
    buildCatalystActiveRunnerContinuationThesis(input),
    buildClearedShelfPowerContinuationThesis(input),
    buildDamagedRangeReclaimThesis(input),
    buildBelowRangeBuyerReclaimThesis(input),
    buildLowerRangeSpringboardThesis(input),
    buildQuietRangeAccumulationThesis(input),
    buildQuietBaseMeasuredExpansionThesis(input),
    buildWashoutBaseReversalThesis(input),
    buildControlledRangeBreakoutThesis(input),
    buildUpperRangeIgnitionThesis(input),
  ].filter((item): item is ThesisCandidate => Boolean(item));
}

function withActiveRunnerTape(input: ChartThesisEngineInput, read: ThesisCandidate): ChartThesisRead {
  const activeRunnerTape = buildActiveRunnerTapeContext(input, read);
  return activeRunnerTape ? { ...read, activeRunnerTape } : read;
}

export function buildSmallCapTradeSetupReadsForQa(
  input: ChartThesisEngineInput,
): ChartThesisRead[] {
  if (!Number.isFinite(input.currentPrice) || input.currentPrice <= 0) return [];
  return buildSmallCapTradeSetupCandidates(input)
    .sort((left, right) => right.score - left.score)
    .map((candidate) => withActiveRunnerTape(input, candidate));
}

export function buildTradeSetupChartThesisRead(
  input: ChartThesisEngineInput,
): ChartThesisRead | null {
  if (!Number.isFinite(input.currentPrice) || input.currentPrice <= 0) return null;
  const best = [
    ...buildChartThesisCandidates(input).filter((candidate) => isWatchlistApprovedThesis(candidate.type)),
    ...buildSmallCapTradeSetupCandidates(input),
  ].sort((left, right) => right.score - left.score)[0] ?? null;
  return best ? withActiveRunnerTape(input, best) : null;
}

export function buildChartThesisRead(input: ChartThesisEngineInput): ChartThesisRead | null {
  if (!Number.isFinite(input.currentPrice) || input.currentPrice <= 0) {
    return null;
  }

  const best = buildChartThesisCandidates(input).sort((left, right) => right.score - left.score)[0] ?? null;
  if (!best) {
    return null;
  }

  return withActiveRunnerTape(input, best);
}

export function buildWatchlistChartThesisRead(input: ChartThesisEngineInput): ChartThesisRead | null {
  if (!Number.isFinite(input.currentPrice) || input.currentPrice <= 0) {
    return null;
  }

  const best = buildChartThesisCandidates(input)
    .filter((candidate) => isWatchlistApprovedThesis(candidate.type))
    .sort((left, right) => right.score - left.score)[0] ?? null;
  if (!best) {
    return null;
  }

  return withActiveRunnerTape(input, best);
}

export function formatChartThesisRead(read: LevelSnapshotPayload["potentialMoveRead"]): string[] {
  if (!read) {
    return [];
  }
  if (!isWatchlistApprovedThesis(read.type)) {
    return [];
  }
  return [
    chartReadTitle(read),
    ...read.lines,
    ...(read.activeRunnerTape ? [read.activeRunnerTape.line] : []),
  ];
}
