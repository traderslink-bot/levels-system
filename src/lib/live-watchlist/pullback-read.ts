import type { TechnicalContext } from "../technical-context/technical-context-types.js";
import type { LiveWatchlistLevelMap } from "./live-watchlist-types.js";

export const LIVE_WATCHLIST_PULLBACK_READ_ENABLED_ENV = "LIVE_WATCHLIST_PULLBACK_READ_ENABLED";

export type LiveWatchlistPullbackReadPhase =
  | "extended"
  | "pullback_forming"
  | "continuation_watch"
  | "failed_move_risk";

export type LiveWatchlistPullbackVolumeLabel =
  | "strong"
  | "expanding"
  | "normal"
  | "thin"
  | "fading"
  | "unknown";

export type LiveWatchlistPullbackVolumeRead = {
  label: LiveWatchlistPullbackVolumeLabel;
  currentVolume: number | null;
  averageVolume: number | null;
  relativeVolumeRatio: number | null;
  rawRelativeVolumeRatio?: number | null;
  projectedVolume?: number | null;
  partial?: boolean;
  reason: string;
};

export type LiveWatchlistPullbackRead = {
  phase: LiveWatchlistPullbackReadPhase;
  confidence: TechnicalContext["confidence"];
  body: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type LiveWatchlistPullbackReadInput = {
  symbol: string;
  currentPrice: number;
  levelMap: LiveWatchlistLevelMap | null;
  technicalContext: TechnicalContext | null | undefined;
  volumeRead?: LiveWatchlistPullbackVolumeRead | null;
  priorRegularClosePrice?: number | null;
};

const SMALL_CAP_ORDINARY_MATERIAL_DISTANCE_PCT = 15;
const SMALL_CAP_HIGH_QUALITY_MATERIAL_DISTANCE_PCT = 10;
const HIGHER_PRICED_RUNNER_MATERIAL_DISTANCE_PCT = 2;
const HIGHER_PRICED_RUNNER_PRICE = 10;
const NEAR_TERM_PULLBACK_HOLD_MAX_DISTANCE_PCT = 8;
const NEAR_TERM_PULLBACK_HOLD_MIN_DISTANCE_PCT = 0.5;
const LOW_PRICED_RUNNER_SUPPORT_HOLD_MAX_DISTANCE_PCT = 12;
const NEAR_TERM_CONTINUATION_RESISTANCE_MAX_DISTANCE_PCT = 12;
const LOW_PRICED_CONTINUATION_RESISTANCE_MAX_DISTANCE_PCT = 20;
const EXTREME_GAP_MIN_MOVE_PCT = 100;

function isTruthyFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isFalseyFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off";
}

export function resolveLiveWatchlistPullbackReadEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[LIVE_WATCHLIST_PULLBACK_READ_ENABLED_ENV];
  if (isFalseyFlag(value)) {
    return false;
  }
  // The legacy live Trader Read is opt-in. The AI Read and Potential Path
  // cards do not require the recurring pullback enrichment loop.
  return value === undefined ? false : isTruthyFlag(value);
}

function formatPrice(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function formatSignedPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function belowCurrent(price: number | null | undefined, currentPrice: number): boolean {
  return typeof price === "number" && Number.isFinite(price) && price > 0 && price < currentPrice;
}

function distanceFromCurrentPct(price: number, currentPrice: number): number {
  return Math.abs((price - currentPrice) / Math.max(currentPrice, 0.0001)) * 100;
}

function strengthRank(value: string | null | undefined): number {
  if (value === "major") return 4;
  if (value === "strong") return 3;
  if (value === "moderate") return 2;
  if (value === "weak") return 1;
  return 0;
}

function isHighQualityLevel(level: Pick<NonNullable<LiveWatchlistLevelMap["nearestSupport"]>, "strengthLabel" | "sourceLabel" | "freshness">): boolean {
  if (level.strengthLabel === "weak") {
    return false;
  }
  return (
    strengthRank(level.strengthLabel) >= strengthRank("strong") ||
    /daily|4h|confluence|structure/i.test(level.sourceLabel ?? "") ||
    level.freshness === "fresh"
  );
}

function isActionableLevel(level: Pick<NonNullable<LiveWatchlistLevelMap["nearestSupport"]>, "strengthLabel" | "sourceLabel" | "freshness">): boolean {
  if (level.strengthLabel === "weak") {
    return false;
  }
  return strengthRank(level.strengthLabel) >= strengthRank("moderate") || isHighQualityLevel(level);
}

function isMaterialSmallCapReference(price: number, currentPrice: number, highQuality = false): boolean {
  const distance = distanceFromCurrentPct(price, currentPrice);
  if (
    highQuality &&
    currentPrice >= HIGHER_PRICED_RUNNER_PRICE &&
    distance >= HIGHER_PRICED_RUNNER_MATERIAL_DISTANCE_PCT
  ) {
    return true;
  }
  return (
    distance >= SMALL_CAP_ORDINARY_MATERIAL_DISTANCE_PCT ||
    (highQuality && distance >= SMALL_CAP_HIGH_QUALITY_MATERIAL_DISTANCE_PCT)
  );
}

type PullbackReferenceCandidate = {
  label: string;
  price: number;
  highQuality?: boolean;
  nearTermHold?: boolean;
};

function dedupePrices(prices: PullbackReferenceCandidate[]): PullbackReferenceCandidate[] {
  const selected: PullbackReferenceCandidate[] = [];
  for (const candidate of prices) {
    const duplicate = selected.some((item) =>
      Math.abs(item.price - candidate.price) / Math.max(item.price, candidate.price, 0.0001) < 0.003,
    );
    if (!duplicate) {
      selected.push(candidate);
    }
  }
  return selected;
}

function isNearTermPullbackHold(price: number, currentPrice: number): boolean {
  const distance = distanceFromCurrentPct(price, currentPrice);
  return (
    currentPrice >= HIGHER_PRICED_RUNNER_PRICE &&
    distance >= NEAR_TERM_PULLBACK_HOLD_MIN_DISTANCE_PCT &&
    distance <= NEAR_TERM_PULLBACK_HOLD_MAX_DISTANCE_PCT
  );
}

function isRunnerSupportHold(
  level: NonNullable<LiveWatchlistLevelMap["nearestSupport"]>,
  currentPrice: number,
  phase: LiveWatchlistPullbackReadPhase,
): boolean {
  if (phase !== "extended" && phase !== "pullback_forming") {
    return false;
  }
  if (!isActionableLevel(level)) {
    return false;
  }
  const distance = distanceFromCurrentPct(level.price, currentPrice);
  if (currentPrice >= HIGHER_PRICED_RUNNER_PRICE) {
    return (
      distance >= NEAR_TERM_PULLBACK_HOLD_MIN_DISTANCE_PCT &&
      distance <= NEAR_TERM_PULLBACK_HOLD_MAX_DISTANCE_PCT
    );
  }
  return distance <= LOW_PRICED_RUNNER_SUPPORT_HOLD_MAX_DISTANCE_PCT;
}

function fallbackCandidates(params: {
  currentPrice: number;
  context: TechnicalContext;
  levelMap: LiveWatchlistLevelMap | null;
  phase: LiveWatchlistPullbackReadPhase;
}): PullbackReferenceCandidate[] {
  const candidates: PullbackReferenceCandidate[] = [];
  const nearestSupport = params.levelMap?.nearestSupport;
  const includeNearTermHolds = params.phase === "pullback_forming" || params.phase === "extended";

  if (belowCurrent(nearestSupport?.price, params.currentPrice) && isActionableLevel(nearestSupport!)) {
    candidates.push({
      label: "nearest support",
      price: nearestSupport!.price,
      highQuality: isHighQualityLevel(nearestSupport!),
      nearTermHold: isRunnerSupportHold(nearestSupport!, params.currentPrice, params.phase),
    });
  }
  if (belowCurrent(params.context.vwap, params.currentPrice)) {
    candidates.push({ label: "VWAP", price: params.context.vwap! });
  }
  if (belowCurrent(params.context.ema9, params.currentPrice)) {
    candidates.push({
      label: "EMA9",
      price: params.context.ema9!,
      nearTermHold: includeNearTermHolds && isNearTermPullbackHold(params.context.ema9!, params.currentPrice),
    });
  }
  if (belowCurrent(params.context.ema20, params.currentPrice)) {
    candidates.push({
      label: "EMA20",
      price: params.context.ema20!,
      nearTermHold: includeNearTermHolds && isNearTermPullbackHold(params.context.ema20!, params.currentPrice),
    });
  }

  return dedupePrices(candidates)
    .filter((candidate) =>
      candidate.nearTermHold ||
      isMaterialSmallCapReference(candidate.price, params.currentPrice, candidate.highQuality)
    )
    .sort((left, right) => right.price - left.price)
    .slice(0, 3);
}

type ContinuationRead = {
  line: string;
  triggerPrice: number | null;
  nextPathResistance: number | null;
};

function continuationRead(
  levelMap: LiveWatchlistLevelMap | null,
  currentPrice: number,
  includeTacticalRiskBoundary = false,
): ContinuationRead {
  const materialResistance = levelMap?.resistanceLevels.find((level) =>
    level.price > currentPrice &&
    isActionableLevel(level) &&
    (
      includeTacticalRiskBoundary ||
      isMaterialSmallCapReference(level.price, currentPrice, isHighQualityLevel(level))
    ),
  );
  if (!materialResistance) {
    return {
      line: "Continuation trigger: no clean higher path level on the current map yet.",
      triggerPrice: null,
      nextPathResistance: null,
    };
  }

  const distance = distanceFromCurrentPct(materialResistance.price, currentPrice);
  const maxTriggerDistance = currentPrice >= HIGHER_PRICED_RUNNER_PRICE
    ? NEAR_TERM_CONTINUATION_RESISTANCE_MAX_DISTANCE_PCT
    : LOW_PRICED_CONTINUATION_RESISTANCE_MAX_DISTANCE_PCT;
  if (distance <= maxTriggerDistance) {
    return {
      line: `Continuation trigger: reclaim/hold above ${formatPrice(materialResistance.price)} with fresh confirmation.`,
      triggerPrice: materialResistance.price,
      nextPathResistance: materialResistance.price,
    };
  }

  return {
    line: `Next higher resistance: ${formatPrice(materialResistance.price)} is +${distance.toFixed(1)}% away; no clean nearby breakout trigger on the current map yet.`,
    triggerPrice: null,
    nextPathResistance: materialResistance.price,
  };
}

function derivePhase(context: TechnicalContext): LiveWatchlistPullbackReadPhase | null {
  const vsVwap = context.priceVsVwapPct;
  const vsEma9 = context.priceVsEma9Pct;
  const vsEma20 = context.priceVsEma20Pct;

  if (context.aboveVwap === false && context.aboveEma9 === false) {
    return "failed_move_risk";
  }
  if (context.aboveVwap === true && context.aboveEma9 === false) {
    return "pullback_forming";
  }
  if (
    (typeof vsVwap === "number" && vsVwap >= 8) ||
    (typeof vsEma20 === "number" && vsEma20 >= 12) ||
    (typeof vsEma9 === "number" && vsEma9 >= 6)
  ) {
    return "extended";
  }
  if (context.aboveVwap === true && context.aboveEma9 === true) {
    return "continuation_watch";
  }

  return null;
}

function phaseLabel(phase: LiveWatchlistPullbackReadPhase): string {
  switch (phase) {
    case "extended":
      return "Extended";
    case "pullback_forming":
      return "Pullback forming";
    case "continuation_watch":
      return "Continuation watch";
    case "failed_move_risk":
      return "Failed move risk";
  }
}

function phaseLine(phase: LiveWatchlistPullbackReadPhase, context: TechnicalContext): string {
  switch (phase) {
    case "extended":
      return `Move phase: extended. Price is ${formatSignedPercent(context.priceVsVwapPct)} vs VWAP and ${formatSignedPercent(context.priceVsEma20Pct)} vs EMA20.`;
    case "pullback_forming":
      return "Move phase: pullback forming. Price is still above VWAP but has cooled below EMA9.";
    case "continuation_watch":
      return "Move phase: continuation watch. Price is holding above VWAP and short-term EMAs.";
    case "failed_move_risk":
      return "Move phase: failed move risk. Price is below VWAP/EMA9, so late buyers may be losing control.";
  }
}

function fallbackLine(candidates: PullbackReferenceCandidate[]): string {
  if (candidates.length === 0) {
    return "Needs to hold: no clean pullback area yet; wait for price to show where buyers actually defend.";
  }
  return `Needs to hold: ${candidates.map((item) => `${formatPrice(item.price)} ${item.label}`).join(" | ")}.`;
}

function volumeLabel(value: LiveWatchlistPullbackVolumeLabel): string {
  switch (value) {
    case "strong":
      return "strong";
    case "expanding":
      return "expanding";
    case "normal":
      return "normal";
    case "thin":
      return "thin";
    case "fading":
      return "fading";
    case "unknown":
      return "unknown";
  }
}

function volumeLine(volumeRead: LiveWatchlistPullbackVolumeRead | null | undefined): string | null {
  if (!volumeRead || volumeRead.label === "unknown" || volumeRead.relativeVolumeRatio === null) {
    return null;
  }

  if (
    volumeRead.partial &&
    typeof volumeRead.rawRelativeVolumeRatio === "number" &&
    Number.isFinite(volumeRead.rawRelativeVolumeRatio)
  ) {
    return `Volume read: ${volumeLabel(volumeRead.label)} (${volumeRead.relativeVolumeRatio.toFixed(2)}x projected 5m pace; raw ${volumeRead.rawRelativeVolumeRatio.toFixed(2)}x so far).`;
  }

  return `Volume read: ${volumeLabel(volumeRead.label)} (${volumeRead.relativeVolumeRatio.toFixed(2)}x recent 5m average).`;
}

function referencePrice(
  levelMap: LiveWatchlistLevelMap | null,
  key: "pmh" | "pml" | "orh" | "orl" | "hod" | "lod" | "pdh" | "pdl" | "pdc" | "vwap",
): number | null {
  return levelMap?.referenceLevels?.find((level) => level.key === key)?.price ?? null;
}

function buildExtremeGapLines(input: LiveWatchlistPullbackReadInput): {
  lines: string[];
  metadata: Record<string, string | number | boolean | null>;
} | null {
  const priorClose = input.priorRegularClosePrice;
  if (
    typeof priorClose !== "number" ||
    !Number.isFinite(priorClose) ||
    priorClose <= 0
  ) {
    return null;
  }

  const movePct = ((input.currentPrice - priorClose) / priorClose) * 100;
  const premarketLow = referencePrice(input.levelMap, "pml");
  const premarketHigh = referencePrice(input.levelMap, "pmh");
  const gapFloorMovePct =
    premarketLow !== null ? ((premarketLow - priorClose) / priorClose) * 100 : null;
  if (movePct < EXTREME_GAP_MIN_MOVE_PCT && (gapFloorMovePct ?? 0) < EXTREME_GAP_MIN_MOVE_PCT) {
    return null;
  }

  const downsideLevels = input.levelMap?.supportLevels.filter((level) => level.price < input.currentPrice) ?? [];
  const gapFloor = premarketLow !== null && premarketLow > priorClose ? premarketLow : null;
  const downsideLine = downsideLevels.length > 0
    ? `Downside map: ${downsideLevels
        .slice(0, 3)
        .map((level) => `${formatPrice(level.price)} ${level.sourceLabel ?? "risk boundary"}`)
        .join(" | ")}.`
    : "Downside map: no confirmed support is currently mapped below price.";
  const gapRiskLine = gapFloor !== null
    ? input.currentPrice < gapFloor
      ? `Premarket floor ${formatPrice(gapFloor)} has failed: open-air gap risk remains toward the ${formatPrice(priorClose)} prior-close area; no confirmed traded support is mapped inside that void.`
      : `Failure below ${formatPrice(gapFloor)}: open-air gap risk toward the ${formatPrice(priorClose)} prior-close area; no confirmed traded support is mapped inside that void.`
    : `Gap risk: the stock remains ${formatSignedPercent(movePct)} above the ${formatPrice(priorClose)} prior close, with no confirmed gap floor available from the current candle set.`;
  const rangeLine = premarketLow !== null && premarketHigh !== null
    ? `Extreme gap / price discovery: ${formatSignedPercent(movePct)} vs the ${formatPrice(priorClose)} prior close; premarket range ${formatPrice(premarketLow)}-${formatPrice(premarketHigh)}.`
    : `Extreme gap / price discovery: ${formatSignedPercent(movePct)} vs the ${formatPrice(priorClose)} prior close.`;

  return {
    lines: [rangeLine, downsideLine, gapRiskLine],
    metadata: {
      extremeGapActive: true,
      extremeGapMovePct: Number(movePct.toFixed(4)),
      extremeGapPriorClose: priorClose,
      extremeGapPremarketLow: premarketLow,
      extremeGapPremarketHigh: premarketHigh,
      extremeGapFloor: gapFloor,
      extremeGapOpenAirBelowFloor: gapFloor !== null,
    },
  };
}

export function buildLiveWatchlistPullbackRead(
  input: LiveWatchlistPullbackReadInput,
): LiveWatchlistPullbackRead | null {
  const context = input.technicalContext;
  if (
    !context ||
    context.confidence === "unavailable" ||
    !Number.isFinite(input.currentPrice) ||
    input.currentPrice <= 0 ||
    context.vwap === null ||
    context.ema9 === null ||
    context.ema20 === null
  ) {
    return null;
  }

  const phase = derivePhase(context);
  if (!phase) {
    return null;
  }

  const candidates = fallbackCandidates({
    currentPrice: input.currentPrice,
    context,
    levelMap: input.levelMap,
    phase,
  });
  const extremeGap = buildExtremeGapLines(input);
  const continuation = continuationRead(input.levelMap, input.currentPrice, extremeGap !== null);
  const lines = [
    `${input.symbol.toUpperCase()} ${extremeGap ? "Extreme gap / price discovery" : phaseLabel(phase)}`,
    ...(extremeGap?.lines ?? []),
    phaseLine(phase, context),
    volumeLine(input.volumeRead),
    extremeGap ? null : fallbackLine(candidates),
    continuation.line,
  ].filter((line): line is string => Boolean(line));

  return {
    phase,
    confidence: context.confidence,
    body: lines.join("\n"),
    metadata: {
      pullbackReadEnabled: true,
      pullbackPhase: phase,
      pullbackConfidence: context.confidence,
      pullbackProvider: context.provider,
      pullbackCandleCount: context.candleCount,
      pullbackVwap: context.vwap,
      pullbackEma9: context.ema9,
      pullbackEma20: context.ema20,
      pullbackPriceVsVwapPct: context.priceVsVwapPct,
      pullbackPriceVsEma9Pct: context.priceVsEma9Pct,
      pullbackPriceVsEma20Pct: context.priceVsEma20Pct,
      pullbackVolumeLabel: input.volumeRead?.label ?? "unknown",
      pullbackVolumeRatio: input.volumeRead?.relativeVolumeRatio ?? null,
      pullbackVolumeRawRatio: input.volumeRead?.rawRelativeVolumeRatio ?? null,
      pullbackCurrentVolume: input.volumeRead?.currentVolume ?? null,
      pullbackAverageVolume: input.volumeRead?.averageVolume ?? null,
      pullbackProjectedVolume: input.volumeRead?.projectedVolume ?? null,
      pullbackVolumePartial: input.volumeRead?.partial ?? false,
      pullbackFallback1: candidates[0]?.price ?? null,
      pullbackFallback2: candidates[1]?.price ?? null,
      pullbackFallback3: candidates[2]?.price ?? null,
      pullbackContinuationTrigger: continuation.triggerPrice,
      pullbackNextPathResistance: continuation.nextPathResistance,
      ...(extremeGap?.metadata ?? {}),
    },
  };
}
