import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DurableCandleWarehouse } from "../lib/candle-warehouse/index.js";
import type { Candle, CandleFetchTimeframe } from "../lib/market-data/candle-types.js";
import { buildSupportResistanceContextFromCandles } from "../lib/support-resistance/index.js";
import {
  classifyForwardLevelDiagnostic,
  type ForwardLevelDiagnosticConfidence,
  type ForwardLevelDiagnosticState,
  type ForwardLevelDiagnosticTag,
} from "../lib/validation/forward-reaction-diagnostics.js";
import {
  validateForwardReactions,
  type ForwardReactionLevelResult,
  type ForwardReactionSummary,
  type ForwardReactionVolumeLabel,
} from "../lib/validation/forward-reaction-validator.js";

type PriceBucket = "sub_1" | "1_to_2" | "2_to_5" | "5_to_10" | "10_plus";

type LevelQualityTestCase = {
  symbol: string;
  date: string;
  time: string;
  startTimestamp: number;
  endTimestamp: number;
  startPrice: number;
  priceBucket: PriceBucket;
  forwardHigh: number;
  forwardHighPct: number;
  forwardLow: number;
  forwardLowPct: number;
  forwardRangePct: number;
  score: number;
  dailyCount: number;
  fourHourCount: number;
  fiveMinuteCount: number;
  selectionReason: string;
  priorityTags: string[];
};

type CaseQualityResult = LevelQualityTestCase & {
  status: "scored" | "unscored";
  errorMessage?: string;
  levelCounts?: {
    surfacedSupport: number;
    surfacedResistance: number;
    extensionSupport: number;
    extensionResistance: number;
  };
  reaction?: {
    totalLevelsEvaluated: number;
    surfacedSupport: ForwardReactionSummary;
    surfacedResistance: ForwardReactionSummary;
    extensionSupport: ForwardReactionSummary;
    extensionResistance: ForwardReactionSummary;
    byStrengthLabel: Record<string, ForwardReactionSummary>;
    byVolumeLabel: Record<ForwardReactionVolumeLabel, ForwardReactionSummary>;
    volumeEvidence: {
      touched: number;
      reliable: number;
      highVolumeTouches: number;
      highVolumeUsefulWhenTouchedRate: number;
      highVolumeRespectRate: number;
      highVolumeBreakRate: number;
      lightVolumeTouches: number;
      lightVolumeBreakRate: number;
    };
    examples: ForwardReactionLevelResult[];
  };
  cleanBreakClassifications?: LevelCleanBreakClassification[];
  levelDiagnostics?: LevelOperatorDiagnostic[];
  findings: string[];
};

export type CleanBreakClassificationCode =
  | "momentum_consumed_level"
  | "consumed_or_overtested_level"
  | "active_reference_resolved"
  | "possible_overstated_strength"
  | "event_regime_change_watch"
  | "local_level_cluster_break_watch"
  | "single_timeframe_5m_swing_break_watch"
  | "off_hours_light_volume_break_watch"
  | "off_hours_event_context_break_watch"
  | "unknown_volume_clean_break_watch"
  | "minor_break_watch"
  | "thin_liquidity_break_watch"
  | "sparse_tape_clean_break_watch"
  | "needs_manual_review";

type CleanBreakCandleSnapshot = {
  timestamp: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeDistancePct: number;
};

type LevelCleanBreakClassification = {
  symbol: string;
  date: string;
  startTime: string;
  kind: "support" | "resistance";
  levelPrice: number;
  strengthLabel: "strong" | "major";
  strengthScore: number;
  timeframeSources: string[];
  sourceTypes: string[];
  touchCount: number;
  sourceEvidenceCount: number;
  confluenceCount: number;
  reactionQualityScore: number;
  rejectionScore: number;
  followThroughScore: number;
  volumeLabel: ForwardReactionVolumeLabel;
  volumeReliability: string;
  relativeVolumeRatio: number | null;
  maxFavorablePct: number;
  maxAdversePct: number;
  firstTouchTimestamp?: number;
  resolutionTimestamp?: number;
  firstTouchCandle?: CleanBreakCandleSnapshot;
  resolutionWindow: CleanBreakCandleSnapshot[];
  classification: CleanBreakClassificationCode;
  reasons: string[];
};

type LevelOperatorDiagnostic = {
  zoneId: string;
  symbol: string;
  date: string;
  startTime: string;
  kind: "support" | "resistance";
  source: "surfaced" | "extension";
  timeframeSources: string[];
  sourceTypes: string[];
  levelPrice: number;
  strengthScore: number;
  strengthLabel: string;
  touchCount: number;
  sourceEvidenceCount: number;
  confluenceCount: number;
  reactionQualityScore: number;
  rejectionScore: number;
  followThroughScore: number;
  outcome: string;
  state: ForwardLevelDiagnosticState;
  confidence: ForwardLevelDiagnosticConfidence;
  tags: ForwardLevelDiagnosticTag[];
  reasons: string[];
  volumeLabel: ForwardReactionVolumeLabel;
  volumeReliability: string;
  relativeVolumeRatio: number | null;
  maxFavorablePct: number;
  maxAdversePct: number;
  closestApproachPct: number;
  resolutionBarCount: number;
  zeroVolumeBarCount: number;
  zeroVolumePct: number;
  totalResolutionVolume: number;
};

type ActiveReferenceRiskBucket =
  | "reacted_and_held"
  | "reacted_then_broke"
  | "reacted_then_consumed";

type WeakRespectedExplanation = {
  symbol: string;
  date: string;
  startTime: string;
  zoneId: string;
  kind: "support" | "resistance";
  levelPrice: number;
  source: "surfaced" | "extension";
  surfacedBucket?: string;
  strengthScore: number;
  timeframeSources: string[];
  sourceTypes: string[];
  maxFavorablePct: number;
  maxAdversePct: number;
  tags: ForwardLevelDiagnosticTag[];
  explainedByActiveIntradayReference: boolean;
  explainedBySingleTouchHigherTimeframe: boolean;
};

type ScoreboardComparison = {
  generatedAt: string;
  baselinePath: string;
  currentPath: string;
  baselineCases: number;
  currentCases: number;
  totals: Array<{
    metric: string;
    baseline: number;
    current: number;
    delta: number;
  }>;
  diagnosticStateCounts: Array<{
    state: ForwardLevelDiagnosticState;
    baseline: number;
    current: number;
    delta: number;
  }>;
  diagnosticTagCounts: Array<{
    tag: ForwardLevelDiagnosticTag;
    baseline: number;
    current: number;
    delta: number;
  }>;
  activeReferenceRiskBuckets: Array<{
    bucket: ActiveReferenceRiskBucket;
    baseline: number;
    current: number;
    delta: number;
  }>;
};

type LevelQualityScoreboard = {
  generatedAt: string;
  sourceChecklistPath: string;
  warehouseDirectoryPath: string;
  casesReviewed: number;
  scoredCases: number;
  unscoredCases: number;
  totals: {
    noForwardResistanceCases: number;
    highVolumeTouches: number;
    highVolumeBreaks: number;
    strongOrMajorBreakExamples: number;
    strongOrMajorCleanBreakExamples: number;
    strongOrMajorPartialBreakExamples: number;
    majorCleanBreakExamples: number;
    underratedWeakRespectExamples: number;
    wideFutureMoveCases: number;
    consumedByMomentumLevels: number;
    overTestedLevels: number;
    unexplainedBrokenLevels: number;
    unexplainedStrongMajorCleanBreakLevels: number;
    activeIntradayReferenceLevels: number;
    thinLiquidityBreakWatchLevels: number;
    singleTouchHigherTimeframeReferenceLevels: number;
    sparseTapeCleanBreakWatchLevels: number;
    weakRespectedExplainedByActiveReference: number;
    weakRespectedExplainedBySingleTouchHigherTimeframe: number;
    weakRespectedUntagged: number;
  };
  diagnosticStateCounts: Record<ForwardLevelDiagnosticState, number>;
  diagnosticTagCounts: Record<ForwardLevelDiagnosticTag, number>;
  activeReferenceRiskBuckets: Record<ActiveReferenceRiskBucket, number>;
  weakRespectedExplanation: {
    total: number;
    explainedByActiveIntradayReference: number;
    explainedBySingleTouchHigherTimeframe: number;
    untagged: number;
    examples: WeakRespectedExplanation[];
    untaggedExamples: WeakRespectedExplanation[];
  };
  cleanBreakClassifications: LevelCleanBreakClassification[];
  levelDiagnostics: LevelOperatorDiagnostic[];
  rankedTuningTargets: Array<{
    rank: number;
    code: string;
    label: string;
    evidenceCount: number;
    affectedSymbols: string[];
    likelyCodeArea: string;
    risk: string;
    expectedImprovement: string;
  }>;
  results: CaseQualityResult[];
};

const PROVIDER = "ibkr" as const;
const DEFAULT_WAREHOUSE = "data/candles";
const DEFAULT_CHECKLIST = "docs/nasdaq-under-100m-checklist-with-previous-tickers.md";
const DEFAULT_OUT_DIR = "artifacts/level-quality-detection";
const DEFAULT_SEED_QUEUE = "artifacts/support-resistance-story-test-queue/support-resistance-story-test-queue.json";
const DEFAULT_MAX_CASES = 60;
const DEFAULT_HORIZON_HOURS = 5;
const MIN_DAILY_CANDLES = 40;
const MIN_FOUR_HOUR_CANDLES = 20;
const MIN_FIVE_MINUTE_WINDOW_CANDLES = 18;
const MIN_SELECTION_SCORE = 12;
const HIGH_RANGE_SCORE = 30;
const BATCH_SIZE = 10;
const LEVEL_DIAGNOSTIC_STATES: ForwardLevelDiagnosticState[] = [
  "fresh",
  "respected",
  "testing",
  "broken",
  "consumed_by_momentum",
  "over_tested",
];
const LEVEL_DIAGNOSTIC_TAGS: ForwardLevelDiagnosticTag[] = [
  "active_intraday_reference",
  "small_clean_break_watch",
  "thin_liquidity_break_watch",
  "single_touch_higher_timeframe_reference",
  "sparse_tape_clean_break_watch",
];
const ACTIVE_REFERENCE_RISK_BUCKETS: ActiveReferenceRiskBucket[] = [
  "reacted_and_held",
  "reacted_then_broke",
  "reacted_then_consumed",
];
const SCOREBOARD_TOTAL_KEYS = [
  "noForwardResistanceCases",
  "highVolumeTouches",
  "highVolumeBreaks",
  "strongOrMajorBreakExamples",
  "strongOrMajorCleanBreakExamples",
  "strongOrMajorPartialBreakExamples",
  "majorCleanBreakExamples",
  "underratedWeakRespectExamples",
  "wideFutureMoveCases",
  "consumedByMomentumLevels",
  "overTestedLevels",
  "unexplainedBrokenLevels",
  "unexplainedStrongMajorCleanBreakLevels",
  "activeIntradayReferenceLevels",
  "thinLiquidityBreakWatchLevels",
  "singleTouchHigherTimeframeReferenceLevels",
  "sparseTapeCleanBreakWatchLevels",
  "weakRespectedExplainedByActiveReference",
  "weakRespectedExplainedBySingleTouchHigherTimeframe",
  "weakRespectedUntagged",
] as const satisfies ReadonlyArray<keyof LevelQualityScoreboard["totals"]>;
const KNOWN_PRIORITY_SYMBOLS = new Set([
  "AKAN",
  "ATER",
  "ATXI",
  "EFOI",
  "HCAI",
  "AIOS",
  "XTLB",
  "CCM",
]);

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function numberArg(flag: string, fallback: number): number {
  const parsed = Number.parseFloat(argValue(flag) ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function timeframeMs(timeframe: CandleFetchTimeframe): number {
  if (timeframe === "1m") {
    return 60_000;
  }
  if (timeframe === "5m") {
    return 5 * 60_000;
  }
  if (timeframe === "4h") {
    return 4 * 60 * 60_000;
  }
  return 24 * 60 * 60_000;
}

function round(value: number, decimals = 4): number {
  return Number(value.toFixed(decimals));
}

function rate(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : round(numerator / denominator);
}

function easternDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function easternTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function formatPrice(price: number): string {
  return price >= 1 ? price.toFixed(2) : price.toFixed(4);
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function priceBucket(price: number): PriceBucket {
  if (price < 1) {
    return "sub_1";
  }
  if (price < 2) {
    return "1_to_2";
  }
  if (price < 5) {
    return "2_to_5";
  }
  if (price < 10) {
    return "5_to_10";
  }
  return "10_plus";
}

function cleanBreakCandleSnapshot(
  candle: Candle,
  level: ForwardReactionLevelResult,
): CleanBreakCandleSnapshot {
  const closeDistancePct = level.kind === "resistance"
    ? ((candle.close / Math.max(level.representativePrice, 0.0001)) - 1) * 100
    : (1 - (candle.close / Math.max(level.representativePrice, 0.0001))) * 100;

  return {
    timestamp: candle.timestamp,
    time: easternTime(candle.timestamp),
    open: round(candle.open),
    high: round(candle.high),
    low: round(candle.low),
    close: round(candle.close),
    volume: Math.round(candle.volume),
    closeDistancePct: round(closeDistancePct, 2),
  };
}

function cleanBreakFavorableExcursionPct(
  level: ForwardReactionLevelResult,
  candle: Candle,
): number {
  if (level.kind === "resistance") {
    return Math.max(level.representativePrice - candle.low, 0) /
      Math.max(level.representativePrice, 0.0001);
  }

  return Math.max(candle.high - level.representativePrice, 0) /
    Math.max(level.representativePrice, 0.0001);
}

function cleanBreakAdverseExcursionPct(
  level: ForwardReactionLevelResult,
  candle: Candle,
): number {
  if (level.kind === "resistance") {
    return Math.max(candle.high - level.representativePrice, 0) /
      Math.max(level.representativePrice, 0.0001);
  }

  return Math.max(level.representativePrice - candle.low, 0) /
    Math.max(level.representativePrice, 0.0001);
}

function cleanBreakWindowExcursions(params: {
  level: ForwardReactionLevelResult;
  resolutionCandles: Candle[];
}): {
  maxFavorablePct: number;
  maxAdversePct: number;
} {
  if (params.resolutionCandles.length === 0) {
    return {
      maxFavorablePct: params.level.maxFavorableExcursionPct ?? 0,
      maxAdversePct: params.level.maxAdverseExcursionPct ?? 0,
    };
  }

  return {
    maxFavorablePct: Math.max(
      ...params.resolutionCandles.map((candle) =>
        cleanBreakFavorableExcursionPct(params.level, candle),
      ),
    ),
    maxAdversePct: Math.max(
      ...params.resolutionCandles.map((candle) =>
        cleanBreakAdverseExcursionPct(params.level, candle),
      ),
    ),
  };
}

function medianPositiveVolume(candles: Candle[]): number | null {
  const volumes = candles
    .map((candle) => candle.volume)
    .filter((volume) => volume > 0)
    .sort((left, right) => left - right);

  if (volumes.length === 0) {
    return null;
  }

  return volumes[Math.floor(volumes.length / 2)];
}

function isAdverseDriveCandle(level: ForwardReactionLevelResult, candle: Candle): boolean {
  if (level.kind === "resistance") {
    return candle.high > level.representativePrice &&
      candle.close >= level.representativePrice;
  }

  return candle.low < level.representativePrice &&
    candle.close <= level.representativePrice;
}

function hasLateResolutionVolumeDrive(
  level: ForwardReactionLevelResult,
  resolutionCandles: Candle[],
): boolean {
  if (resolutionCandles.length < 6) {
    return false;
  }

  const medianVolume = medianPositiveVolume(resolutionCandles);
  if (medianVolume === null || medianVolume <= 0) {
    return false;
  }

  return resolutionCandles
    .slice(Math.floor(resolutionCandles.length / 3))
    .some((candle) =>
      isAdverseDriveCandle(level, candle) &&
      candle.volume >= medianVolume * 3 &&
      cleanBreakAdverseExcursionPct(level, candle) >= 0.01,
    );
}

function easternMinutes(timestamp: number): number {
  const [hourText, minuteText] = easternTime(timestamp).split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

function isOffHoursWindow(candles: Candle[]): boolean {
  const firstTimestamp = candles[0]?.timestamp;
  if (firstTimestamp === undefined) {
    return false;
  }
  if (firstTimestamp < Date.UTC(2020, 0, 1)) {
    return false;
  }
  const minutes = easternMinutes(firstTimestamp);
  return minutes < 9 * 60 + 30 || minutes >= 16 * 60;
}

function isSingleTimeframeFiveMinuteSwing(example: ForwardReactionLevelResult): boolean {
  return example.timeframeSources.length === 1 &&
    example.timeframeSources[0] === "5m" &&
    example.sourceTypes.some((type) => type === "swing_high" || type === "swing_low");
}

function isLocalLevelClusterCandidate(example: ForwardReactionLevelResult): boolean {
  return example.timeframeSources.includes("5m") &&
    example.sourceTypes.some((type) => type === "swing_high" || type === "swing_low") &&
    !example.sourceTypes.some((type) => type === "premarket_high" || type === "premarket_low") &&
    example.strengthScore <= 45 &&
    example.sourceEvidenceCount <= 4 &&
    example.confluenceCount <= 2;
}

export function classifyCleanBreak(
  example: ForwardReactionLevelResult,
  windowExcursions: {
    maxFavorablePct: number;
    maxAdversePct: number;
  },
  resolutionCandles: Candle[],
  eventContext?: {
    forwardHighPct: number;
    forwardRangePct: number;
  },
): {
  classification: CleanBreakClassificationCode;
  reasons: string[];
} {
  const reasons: string[] = [];
  const adversePct = windowExcursions.maxAdversePct;
  const favorablePct = windowExcursions.maxFavorablePct;
  const highVolume =
    example.volumeContext.reliability === "reliable" &&
    (example.volumeContext.label === "heavy" || example.volumeContext.label === "elevated");
  const lightVolume =
    example.volumeContext.reliability === "reliable" &&
    example.volumeContext.label === "light";
  const overTested = example.touchCount >= 20 || example.sourceEvidenceCount >= 6;
  const softDecision =
    example.rejectionScore < 0.3 || example.followThroughScore < 0.5;
  const verySoftDecision =
    example.rejectionScore < 0.25 && example.followThroughScore < 0.45;
  const thinEvidence =
    example.sourceEvidenceCount <= 2 &&
    example.confluenceCount <= 2 &&
    (example.reactionQualityScore < 0.4 || example.rejectionScore < 0.35);
  const zeroBars = zeroVolumeBarCount(resolutionCandles);
  const zeroRatio = rate(zeroBars, resolutionCandles.length);
  const thinTape =
    resolutionCandles.length >= 6 &&
    zeroRatio >= 0.4 &&
    (
      example.volumeContext.reliability !== "reliable" ||
      example.volumeContext.label === "unknown"
    );
  const sparseLowVolumeTape =
    resolutionCandles.length >= 6 &&
    zeroRatio >= 0.4 &&
    !highVolume;
  const lateVolumeDrive = hasLateResolutionVolumeDrive(example, resolutionCandles);
  const activeReferenceResolved =
    favorablePct >= 0.03 &&
    favorablePct > adversePct * 1.25 &&
    (
      example.touchCount >= 10 ||
      example.sourceEvidenceCount >= 4 ||
      example.confluenceCount >= 3
    );
  const eventRegimeChange =
    eventContext !== undefined &&
    (
      eventContext.forwardHighPct >= 75 ||
      eventContext.forwardRangePct >= 125
    );
  const unknownVolume =
    example.volumeContext.reliability !== "reliable" ||
    example.volumeContext.label === "unknown";
  const offHoursLightVolume =
    isOffHoursWindow(resolutionCandles) &&
    lightVolume &&
    favorablePct < 0.01;
  const offHoursEventContext =
    isOffHoursWindow(resolutionCandles) &&
    highVolume &&
    adversePct >= 0.015 &&
    adversePct < 0.05;
  const singleTimeframeFiveMinuteSwing =
    isSingleTimeframeFiveMinuteSwing(example) &&
    lightVolume &&
    favorablePct < 0.01;
  const localLevelCluster =
    isLocalLevelClusterCandidate(example) &&
    lightVolume &&
    favorablePct < 0.01 &&
    adversePct >= 0.05;

  if (adversePct < 0.01) {
    reasons.push(
      `break distance stayed below 1% (${formatPct(adversePct * 100)} adverse), so the clean-break flag may be too sensitive for tuning`,
    );
    if (highVolume) {
      reasons.push(`touch volume was ${example.volumeContext.label}, so keep it on watch instead of ignoring it`);
    }
    return {
      classification: "minor_break_watch",
      reasons,
    };
  }

  if (!highVolume && favorablePct < 0.01 && adversePct < 0.04) {
    reasons.push(
      `small clean break without elevated/heavy volume (${formatPct(adversePct * 100)} adverse), so keep it on watch before tuning strength labels`,
    );
    return {
      classification: "minor_break_watch",
      reasons,
    };
  }

  if (!highVolume && favorablePct < 0.01 && adversePct < 0.05 && thinTape) {
    reasons.push(
      `break occurred in a sparse tape (${zeroBars}/${resolutionCandles.length} zero-volume bars), so keep it on watch before tuning strength labels`,
    );
    return {
      classification: "thin_liquidity_break_watch",
      reasons,
    };
  }

  if (sparseLowVolumeTape && adversePct >= 0.01 && adversePct < 0.05) {
    reasons.push(
      `clean break happened in sparse low-volume tape (${zeroBars}/${resolutionCandles.length} zero-volume bars), so keep it on watch before tuning strength labels`,
    );
    return {
      classification: "sparse_tape_clean_break_watch",
      reasons,
    };
  }

  if (activeReferenceResolved) {
    reasons.push(
      `level behaved like an active reference first (${formatPct(favorablePct * 100)} favorable vs ${formatPct(adversePct * 100)} adverse), so do not treat the later break as a clean detection miss`,
    );
    return {
      classification: "active_reference_resolved",
      reasons,
    };
  }

  if (eventRegimeChange && favorablePct < 0.02) {
    reasons.push(
      `broader case entered an event-regime move (forward high ${formatPct(eventContext.forwardHighPct)}, range ${formatPct(eventContext.forwardRangePct)}), so do not treat this clean break as ordinary level-strength calibration`,
    );
    return {
      classification: "event_regime_change_watch",
      reasons,
    };
  }

  if (unknownVolume && favorablePct < 0.01 && adversePct >= 0.04) {
    reasons.push(
      `clean break used ${example.volumeContext.label}/${example.volumeContext.reliability} volume evidence, so treat it as an evidence-quality watch before tuning level strength`,
    );
    return {
      classification: "unknown_volume_clean_break_watch",
      reasons,
    };
  }

  if (offHoursEventContext) {
    reasons.push(
      `off-hours break happened on ${example.volumeContext.label} volume with limited adverse travel, so treat it as event/session context before tuning level strength`,
    );
    return {
      classification: "off_hours_event_context_break_watch",
      reasons,
    };
  }

  if (singleTimeframeFiveMinuteSwing && adversePct >= 0.04) {
    reasons.push(
      `strong label came from a single-timeframe 5m swing level with light touch volume and no favorable reaction`,
    );
    return {
      classification: "single_timeframe_5m_swing_break_watch",
      reasons,
    };
  }

  if (localLevelCluster) {
    reasons.push(
      `local swing-derived level failed with light volume and no favorable reaction; inspect nearby duplicate/clustered levels before broad scoring changes`,
    );
    return {
      classification: "local_level_cluster_break_watch",
      reasons,
    };
  }

  if (offHoursLightVolume && adversePct >= 0.04) {
    reasons.push(
      `clean break started outside regular hours on light volume with no favorable reaction, so watch session/liquidity before weakening strength labels`,
    );
    return {
      classification: "off_hours_light_volume_break_watch",
      reasons,
    };
  }

  if (overTested && verySoftDecision) {
    reasons.push(
      `level was heavily reused (touches=${example.touchCount}, evidence=${example.sourceEvidenceCount}) with soft rejection/follow-through`,
    );
    return {
      classification: "consumed_or_overtested_level",
      reasons,
    };
  }

  if (favorablePct < 0.01 && (thinEvidence || (lightVolume && softDecision))) {
    if (thinEvidence) {
      reasons.push(
        `strong label rested on thin/soft evidence (evidence=${example.sourceEvidenceCount}, confluence=${example.confluenceCount})`,
      );
    }
    if (lightVolume && softDecision) {
      reasons.push("touch volume was light while rejection/follow-through evidence was soft");
    }
    return {
      classification: "possible_overstated_strength",
      reasons,
    };
  }

  if (lateVolumeDrive && adversePct >= 0.015) {
    reasons.push(
      `later candles drove through the level on a volume expansion inside the resolution window (${formatPct(adversePct * 100)} adverse travel)`,
    );
    return {
      classification: "momentum_consumed_level",
      reasons,
    };
  }

  if (highVolume && adversePct >= 0.015) {
    reasons.push(
      `break happened on ${example.volumeContext.label} volume (${example.volumeContext.relativeVolumeRatio?.toFixed(2) ?? "n/a"}x) with ${formatPct(adversePct * 100)} adverse travel`,
    );
    return {
      classification: "momentum_consumed_level",
      reasons,
    };
  }

  if (adversePct >= 0.05) {
    reasons.push(
      `price traveled ${formatPct(adversePct * 100)} beyond the level inside the resolution window`,
    );
    return {
      classification: "momentum_consumed_level",
      reasons,
    };
  }

  if (thinEvidence || (lightVolume && softDecision)) {
    if (thinEvidence) {
      reasons.push(
        `strong label rested on thin/soft evidence (evidence=${example.sourceEvidenceCount}, confluence=${example.confluenceCount})`,
      );
    }
    if (lightVolume && softDecision) {
      reasons.push("touch volume was light while rejection/follow-through evidence was soft");
    }
    return {
      classification: "possible_overstated_strength",
      reasons,
    };
  }

  reasons.push(
    `mixed evidence: ${formatPct(favorablePct * 100)} favorable before break, ${formatPct(adversePct * 100)} adverse after break`,
  );
  return {
    classification: "needs_manual_review",
    reasons,
  };
}

function buildCleanBreakClassifications(params: {
  testCase: LevelQualityTestCase;
  examples: ForwardReactionLevelResult[];
  futureFiveMinute: Candle[];
}): LevelCleanBreakClassification[] {
  return params.examples
    .filter(
      (example) =>
        example.outcome === "broken" &&
        (example.strengthLabel === "strong" || example.strengthLabel === "major"),
    )
    .map((example) => {
      const touchIndex = params.futureFiveMinute.findIndex(
        (candle) => candle.timestamp === example.firstTouchTimestamp,
      );
      const resolutionIndex = touchIndex >= 0
        ? touchIndex
        : params.futureFiveMinute.findIndex(
            (candle) => candle.timestamp === example.resolutionTimestamp,
          );
      const resolutionCandles = resolutionIndex >= 0
        ? params.futureFiveMinute
            .slice(resolutionIndex, resolutionIndex + 12)
        : [];
      const resolutionWindow = resolutionCandles
        .map((candle) => cleanBreakCandleSnapshot(candle, example));
      const windowExcursions = cleanBreakWindowExcursions({
        level: example,
        resolutionCandles,
      });
      const classified = classifyCleanBreak(example, windowExcursions, resolutionCandles, {
        forwardHighPct: params.testCase.forwardHighPct,
        forwardRangePct: params.testCase.forwardRangePct,
      });

      return {
        symbol: params.testCase.symbol,
        date: params.testCase.date,
        startTime: params.testCase.time,
        kind: example.kind,
        levelPrice: round(example.representativePrice),
        strengthLabel: example.strengthLabel as "strong" | "major",
        strengthScore: round(example.strengthScore),
        timeframeSources: example.timeframeSources,
        sourceTypes: example.sourceTypes,
        touchCount: example.touchCount,
        sourceEvidenceCount: example.sourceEvidenceCount,
        confluenceCount: example.confluenceCount,
        reactionQualityScore: round(example.reactionQualityScore),
        rejectionScore: round(example.rejectionScore),
        followThroughScore: round(example.followThroughScore),
        volumeLabel: example.volumeContext.label,
        volumeReliability: example.volumeContext.reliability,
        relativeVolumeRatio: example.volumeContext.relativeVolumeRatio,
        maxFavorablePct: round(windowExcursions.maxFavorablePct * 100),
        maxAdversePct: round(windowExcursions.maxAdversePct * 100),
        firstTouchTimestamp: example.firstTouchTimestamp,
        resolutionTimestamp: example.resolutionTimestamp,
        firstTouchCandle: resolutionWindow[0],
        resolutionWindow,
        ...classified,
      };
    });
}

function levelResolutionCandles(level: ForwardReactionLevelResult, futureFiveMinute: Candle[]): Candle[] {
  const touchIndex = futureFiveMinute.findIndex(
    (candle) => candle.timestamp === level.firstTouchTimestamp,
  );
  return touchIndex >= 0 ? futureFiveMinute.slice(touchIndex, touchIndex + 12) : [];
}

function zeroVolumeBarCount(candles: Candle[]): number {
  return candles.filter((candle) => candle.volume <= 0).length;
}

function totalVolume(candles: Candle[]): number {
  return candles.reduce((sum, candle) => sum + Math.max(0, candle.volume), 0);
}

function buildLevelOperatorDiagnostics(params: {
  testCase: LevelQualityTestCase;
  levels: ForwardReactionLevelResult[];
  futureFiveMinute: Candle[];
}): LevelOperatorDiagnostic[] {
  return params.levels
    .map((level) => {
      const resolutionCandles = levelResolutionCandles(level, params.futureFiveMinute);
      const diagnostic = classifyForwardLevelDiagnostic({
        level,
        resolutionCandles,
      });
      const zeroBars = zeroVolumeBarCount(resolutionCandles);

      return {
        zoneId: level.zoneId,
        symbol: params.testCase.symbol,
        date: params.testCase.date,
        startTime: params.testCase.time,
        kind: level.kind,
        source: level.source,
        timeframeSources: level.timeframeSources,
        sourceTypes: level.sourceTypes,
        levelPrice: round(level.representativePrice),
        strengthScore: round(level.strengthScore),
        strengthLabel: level.strengthLabel,
        touchCount: level.touchCount,
        sourceEvidenceCount: level.sourceEvidenceCount,
        confluenceCount: level.confluenceCount,
        reactionQualityScore: round(level.reactionQualityScore),
        rejectionScore: round(level.rejectionScore),
        followThroughScore: round(level.followThroughScore),
        outcome: level.outcome,
        state: diagnostic.state,
        confidence: diagnostic.confidence,
        tags: diagnostic.tags,
        reasons: diagnostic.reasons,
        volumeLabel: level.volumeContext.label,
        volumeReliability: level.volumeContext.reliability,
        relativeVolumeRatio: level.volumeContext.relativeVolumeRatio,
        maxFavorablePct: round(diagnostic.maxFavorableExcursionPct * 100),
        maxAdversePct: round(diagnostic.maxAdverseExcursionPct * 100),
        closestApproachPct: round(level.closestApproachPct * 100),
        resolutionBarCount: resolutionCandles.length,
        zeroVolumeBarCount: zeroBars,
        zeroVolumePct: round(rate(zeroBars, resolutionCandles.length) * 100, 1),
        totalResolutionVolume: totalVolume(resolutionCandles),
      };
    });
}

function parseChecklistSymbols(path: string): Set<string> {
  if (!existsSync(path)) {
    return new Set();
  }
  const text = readFileSyncSafe(path);
  const symbols = new Set<string>();
  for (const match of text.matchAll(/\b[A-Z]{1,5}(?:Q)?\b/g)) {
    const symbol = match[0].trim().toUpperCase();
    if (!["NASDAQ", "THIS", "FILE", "CANDLE", "DATA", "ONLY", "MARKET", "CAP"].includes(symbol)) {
      symbols.add(symbol);
    }
  }
  return symbols;
}

function readFileSyncSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

async function readRows(path: string): Promise<Candle[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as Candle;
          return Number.isFinite(parsed.timestamp) &&
            Number.isFinite(parsed.open) &&
            Number.isFinite(parsed.high) &&
            Number.isFinite(parsed.low) &&
            Number.isFinite(parsed.close) &&
            Number.isFinite(parsed.volume)
            ? [parsed]
            : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

async function readAllFiveMinuteCandles(warehouseRoot: string, symbol: string): Promise<Candle[]> {
  const directory = join(warehouseRoot, PROVIDER, symbol, "5m");
  if (!existsSync(directory)) {
    return [];
  }
  const candles: Candle[] = [];
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".jsonl"))) {
    candles.push(...await readRows(join(directory, file)));
  }
  const byTimestamp = new Map<number, Candle>();
  for (const candle of candles) {
    byTimestamp.set(candle.timestamp, candle);
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function groupByDate(candles: Candle[]): Map<string, Candle[]> {
  const byDate = new Map<string, Candle[]>();
  for (const candle of candles) {
    const date = easternDate(candle.timestamp);
    byDate.set(date, [...(byDate.get(date) ?? []), candle]);
  }
  return byDate;
}

function scoreWindow(startPrice: number, window: Candle[]): {
  forwardHigh: number;
  forwardHighPct: number;
  forwardLow: number;
  forwardLowPct: number;
  forwardRangePct: number;
  score: number;
} {
  const safeStart = Math.max(startPrice, 0.0001);
  const forwardHigh = Math.max(...window.map((candle) => candle.high));
  const forwardLow = Math.min(...window.map((candle) => candle.low));
  const forwardHighPct = ((forwardHigh / safeStart) - 1) * 100;
  const forwardLowPct = (1 - (forwardLow / safeStart)) * 100;
  const forwardRangePct = ((forwardHigh - forwardLow) / Math.max(forwardLow, 0.0001)) * 100;
  return {
    forwardHigh,
    forwardHighPct,
    forwardLow,
    forwardLowPct,
    forwardRangePct,
    score: Math.max(forwardHighPct, forwardLowPct * 0.9, forwardRangePct * 0.7),
  };
}

async function countCandles(
  warehouse: DurableCandleWarehouse,
  symbol: string,
  timeframe: CandleFetchTimeframe,
  startTimestamp: number,
): Promise<number> {
  const lookback =
    timeframe === "daily"
      ? 540 * timeframeMs("daily")
      : timeframe === "4h"
        ? 240 * timeframeMs("4h")
        : 120 * timeframeMs("5m");
  const candles = await warehouse.getCandles({
    provider: PROVIDER,
    symbol,
    timeframe,
    startTimestamp: startTimestamp - lookback,
    endTimestamp: startTimestamp,
  });
  return candles.length;
}

type ScoredDayWindow = {
  start: Candle;
  startPrice: number;
  endTimestamp: number;
  window: Candle[];
  scored: ReturnType<typeof scoreWindow>;
};

function isFarEnoughFromSelected(
  candidate: ScoredDayWindow,
  selected: ScoredDayWindow[],
  minimumSeparationMs: number,
): boolean {
  return selected.every((item) =>
    Math.abs(item.start.timestamp - candidate.start.timestamp) >= minimumSeparationMs,
  );
}

async function casesForDay(params: {
  warehouse: DurableCandleWarehouse;
  symbol: string;
  dayCandles: Candle[];
  horizonHours: number;
  maxWindowsPerDay: number;
  minSelectionScore: number;
}): Promise<LevelQualityTestCase[]> {
  const selectedWindows: ScoredDayWindow[] = [];
  const horizonMs = params.horizonHours * 60 * 60_000;
  const minimumSeparationMs = Math.max(60 * 60_000, horizonMs / Math.max(2, params.maxWindowsPerDay));
  const scoredWindows: ScoredDayWindow[] = [];

  for (let index = 0; index < params.dayCandles.length; index += 3) {
    const start = params.dayCandles[index]!;
    const startPrice = start.close || start.open;
    if (!Number.isFinite(startPrice) || startPrice <= 0) {
      continue;
    }
    const endTimestamp = start.timestamp + horizonMs;
    const window = params.dayCandles.filter(
      (candle) => candle.timestamp >= start.timestamp && candle.timestamp <= endTimestamp,
    );
    if (window.length < MIN_FIVE_MINUTE_WINDOW_CANDLES) {
      continue;
    }

    const scored = scoreWindow(startPrice, window);
    if (scored.score < params.minSelectionScore && !KNOWN_PRIORITY_SYMBOLS.has(params.symbol)) {
      continue;
    }

    scoredWindows.push({
      start,
      startPrice,
      endTimestamp,
      window,
      scored,
    });
  }

  for (const candidate of scoredWindows.sort((left, right) =>
    right.scored.score - left.scored.score ||
    left.start.timestamp - right.start.timestamp,
  )) {
    if (selectedWindows.length >= params.maxWindowsPerDay) {
      break;
    }
    if (!isFarEnoughFromSelected(candidate, selectedWindows, minimumSeparationMs)) {
      continue;
    }
    selectedWindows.push(candidate);
  }

  const cases: LevelQualityTestCase[] = [];
  for (const [index, selected] of selectedWindows.entries()) {
    const [dailyCount, fourHourCount] = await Promise.all([
      countCandles(params.warehouse, params.symbol, "daily", selected.start.timestamp),
      countCandles(params.warehouse, params.symbol, "4h", selected.start.timestamp),
    ]);
    if (dailyCount < MIN_DAILY_CANDLES || fourHourCount < MIN_FOUR_HOUR_CANDLES) {
      continue;
    }

    const tags = [
      selected.scored.score >= HIGH_RANGE_SCORE ? "high_range" : "normal_range",
      selected.scored.score < MIN_SELECTION_SCORE ? "expanded_low_motion" : "standard_motion",
      KNOWN_PRIORITY_SYMBOLS.has(params.symbol) ? "known_problem_symbol" : "warehouse_candidate",
      priceBucket(selected.startPrice),
      `day_window_${index + 1}`,
    ];
    const candidate: LevelQualityTestCase = {
      symbol: params.symbol,
      date: easternDate(selected.start.timestamp),
      time: easternTime(selected.start.timestamp),
      startTimestamp: selected.start.timestamp,
      endTimestamp: selected.endTimestamp,
      startPrice: round(selected.startPrice),
      priceBucket: priceBucket(selected.startPrice),
      forwardHigh: round(selected.scored.forwardHigh),
      forwardHighPct: round(selected.scored.forwardHighPct),
      forwardLow: round(selected.scored.forwardLow),
      forwardLowPct: round(selected.scored.forwardLowPct),
      forwardRangePct: round(selected.scored.forwardRangePct),
      score: round(selected.scored.score),
      dailyCount,
      fourHourCount,
      fiveMinuteCount: selected.window.length,
      selectionReason:
        `warehouse ${params.horizonHours}h move: high ${formatPct(selected.scored.forwardHighPct)}, low -${formatPct(selected.scored.forwardLowPct)}, range ${formatPct(selected.scored.forwardRangePct)}`,
      priorityTags: tags,
    };

    cases.push(candidate);
  }

  return cases;
}

function uniqueBySymbol(cases: LevelQualityTestCase[]): LevelQualityTestCase[] {
  const seen = new Set<string>();
  const output: LevelQualityTestCase[] = [];
  for (const item of cases) {
    if (seen.has(item.symbol)) {
      continue;
    }
    seen.add(item.symbol);
    output.push(item);
  }
  return output;
}

function caseKey(item: LevelQualityTestCase): string {
  return `${item.symbol}:${item.startTimestamp}`;
}

function selectedIncludesCase(
  selected: LevelQualityTestCase[],
  item: LevelQualityTestCase,
  allowRepeatSymbols: boolean,
): boolean {
  if (!allowRepeatSymbols && selected.some((selectedItem) => selectedItem.symbol === item.symbol)) {
    return true;
  }

  return selected.some((selectedItem) => caseKey(selectedItem) === caseKey(item));
}

function selectCases(
  candidates: LevelQualityTestCase[],
  maxCases: number,
  options: { allowRepeatSymbols?: boolean } = {},
): LevelQualityTestCase[] {
  const allowRepeatSymbols = options.allowRepeatSymbols ?? false;
  const sortedCandidates = [...candidates].sort((left, right) => {
    const priorityDelta =
      Number(KNOWN_PRIORITY_SYMBOLS.has(right.symbol)) - Number(KNOWN_PRIORITY_SYMBOLS.has(left.symbol));
    return priorityDelta || right.score - left.score || left.symbol.localeCompare(right.symbol);
  });
  const sorted = allowRepeatSymbols ? sortedCandidates : uniqueBySymbol(sortedCandidates);
  const selected: LevelQualityTestCase[] = [];

  for (const symbol of KNOWN_PRIORITY_SYMBOLS) {
    const match = sorted.find((item) => item.symbol === symbol);
    if (match && selected.length < maxCases) {
      selected.push(match);
    }
  }

  for (const bucket of ["sub_1", "1_to_2", "2_to_5", "5_to_10", "10_plus"] as const) {
    for (const match of sorted.filter((item) => item.priceBucket === bucket).slice(0, 6)) {
      if (selected.length >= maxCases) {
        break;
      }
      if (!selectedIncludesCase(selected, match, allowRepeatSymbols)) {
        selected.push(match);
      }
    }
  }

  for (const match of sorted) {
    if (selected.length >= maxCases) {
      break;
    }
    if (!selectedIncludesCase(selected, match, allowRepeatSymbols)) {
      selected.push(match);
    }
  }

  return selected.sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
}

async function buildTestBatch(params: {
  checklistPath: string;
  warehouseRoot: string;
  maxCases: number;
  horizonHours: number;
  allowRepeatSymbols?: boolean;
  maxWindowsPerDay?: number;
  minSelectionScore?: number;
}): Promise<LevelQualityTestCase[]> {
  const checklistSymbols = parseChecklistSymbols(params.checklistPath);
  const warehouse = new DurableCandleWarehouse(params.warehouseRoot);
  const symbols = (await readdir(join(params.warehouseRoot, PROVIDER), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name.toUpperCase())
    .filter((symbol) => checklistSymbols.size === 0 || checklistSymbols.has(symbol))
    .sort();
  const candidates: LevelQualityTestCase[] = [];

  for (const symbol of symbols) {
    const fiveMinuteCandles = await readAllFiveMinuteCandles(params.warehouseRoot, symbol);
    const byDate = groupByDate(fiveMinuteCandles);
    for (const dayCandles of byDate.values()) {
      if (dayCandles.length < MIN_FIVE_MINUTE_WINDOW_CANDLES) {
        continue;
      }
      const dayCases = await casesForDay({
        warehouse,
        symbol,
        dayCandles,
        horizonHours: params.horizonHours,
        maxWindowsPerDay: Math.max(1, params.maxWindowsPerDay ?? 1),
        minSelectionScore: Math.max(0, params.minSelectionScore ?? MIN_SELECTION_SCORE),
      });
      candidates.push(...dayCases);
    }
  }

  return selectCases(candidates, params.maxCases, { allowRepeatSymbols: params.allowRepeatSymbols });
}

async function buildCasesFromSeedQueue(params: {
  seedPath: string;
  checklistPath: string;
  warehouseRoot: string;
  maxCases: number;
  horizonHours: number;
  allowRepeatSymbols?: boolean;
}): Promise<LevelQualityTestCase[]> {
  if (!existsSync(params.seedPath)) {
    return [];
  }
  const checklistSymbols = parseChecklistSymbols(params.checklistPath);
  const warehouse = new DurableCandleWarehouse(params.warehouseRoot);
  const raw = JSON.parse(await readFile(params.seedPath, "utf8")) as Array<Partial<LevelQualityTestCase>>;
  const cases: LevelQualityTestCase[] = [];

  for (const item of raw) {
    const symbol = item.symbol?.toUpperCase();
    const startTimestamp = item.startTimestamp;
    const endTimestamp = item.endTimestamp ?? (typeof startTimestamp === "number"
      ? startTimestamp + params.horizonHours * 60 * 60_000
      : undefined);
    const startPrice = item.startPrice;
    if (
      !symbol ||
      !Number.isFinite(startTimestamp) ||
      !Number.isFinite(endTimestamp) ||
      !Number.isFinite(startPrice) ||
      (hasFlag("--strict-checklist") && checklistSymbols.size > 0 && !checklistSymbols.has(symbol))
    ) {
      continue;
    }
    const [dailyCount, fourHourCount, window] = await Promise.all([
      countCandles(warehouse, symbol, "daily", startTimestamp as number),
      countCandles(warehouse, symbol, "4h", startTimestamp as number),
      warehouse.getCandles({
        provider: PROVIDER,
        symbol,
        timeframe: "5m",
        startTimestamp: startTimestamp as number,
        endTimestamp: endTimestamp as number,
      }),
    ]);
    if (
      dailyCount < MIN_DAILY_CANDLES ||
      fourHourCount < MIN_FOUR_HOUR_CANDLES ||
      window.length < MIN_FIVE_MINUTE_WINDOW_CANDLES
    ) {
      continue;
    }
    const scored = scoreWindow(startPrice as number, window);
    cases.push({
      symbol,
      date: item.date ?? easternDate(startTimestamp as number),
      time: item.time ?? easternTime(startTimestamp as number),
      startTimestamp: startTimestamp as number,
      endTimestamp: endTimestamp as number,
      startPrice: round(startPrice as number),
      priceBucket: priceBucket(startPrice as number),
      forwardHigh: round(scored.forwardHigh),
      forwardHighPct: round(scored.forwardHighPct),
      forwardLow: round(scored.forwardLow),
      forwardLowPct: round(scored.forwardLowPct),
      forwardRangePct: round(scored.forwardRangePct),
      score: round(scored.score),
      dailyCount,
      fourHourCount,
      fiveMinuteCount: window.length,
      selectionReason:
        `seeded warehouse case: high ${formatPct(scored.forwardHighPct)}, low -${formatPct(scored.forwardLowPct)}, range ${formatPct(scored.forwardRangePct)}`,
      priorityTags: [
        "seed_queue",
        checklistSymbols.has(symbol) ? "under_100m_checklist" : "seed_outside_current_checklist",
        scored.score >= HIGH_RANGE_SCORE ? "high_range" : "normal_range",
        KNOWN_PRIORITY_SYMBOLS.has(symbol) ? "known_problem_symbol" : "warehouse_candidate",
        priceBucket(startPrice as number),
      ],
    });
  }

  return selectCases(cases, params.maxCases, { allowRepeatSymbols: params.allowRepeatSymbols });
}

function allSurfacedSupport(levels: Awaited<ReturnType<typeof buildSupportResistanceContextFromCandles>>["levels"]) {
  return [...levels.majorSupport, ...levels.intermediateSupport, ...levels.intradaySupport];
}

function allSurfacedResistance(levels: Awaited<ReturnType<typeof buildSupportResistanceContextFromCandles>>["levels"]) {
  return [...levels.majorResistance, ...levels.intermediateResistance, ...levels.intradayResistance];
}

function summaryFindings(result: CaseQualityResult): string[] {
  if (result.status === "unscored") {
    return [`unscored: ${result.errorMessage ?? "unknown error"}`];
  }
  const findings: string[] = [];
  const reaction = result.reaction;
  if (!reaction) {
    return ["missing reaction report"];
  }
  if ((result.levelCounts?.surfacedResistance ?? 0) + (result.levelCounts?.extensionResistance ?? 0) === 0) {
    findings.push("no forward resistance inventory in scored context");
  }
  if (result.forwardHighPct >= 30 && reaction.totalLevelsEvaluated === 0) {
    findings.push("large future move but no forward levels evaluated");
  }
  if (reaction.volumeEvidence.highVolumeTouches > 0 && reaction.volumeEvidence.highVolumeBreakRate >= 0.5) {
    findings.push("high-volume touches broke too often");
  }
  const strongBreaks = reaction.examples.filter(
    (example) =>
      example.broken &&
      (example.strengthLabel === "strong" || example.strengthLabel === "major"),
  );
  const cleanStrongBreaks = strongBreaks.filter((example) => example.outcome === "broken");
  const partialStrongBreaks = strongBreaks.filter((example) => example.outcome === "partial_respect");
  if (cleanStrongBreaks.length > 0) {
    findings.push("strong/major level cleanly broke in forward window");
  }
  if (partialStrongBreaks.length > 0) {
    findings.push("strong/major level partially respected then broke");
  }
  if (result.levelDiagnostics?.some((item) => item.state === "consumed_by_momentum")) {
    findings.push("operator diagnostic: level consumed by momentum");
  }
  if (result.levelDiagnostics?.some((item) => item.state === "over_tested")) {
    findings.push("operator diagnostic: over-tested level");
  }
  if (
    result.levelDiagnostics?.some((item) =>
      isUnexplainedCleanBrokenDiagnostic(item) &&
      (item.strengthLabel === "strong" || item.strengthLabel === "major")
    )
  ) {
    findings.push("operator diagnostic: unexplained strong/major break");
  }
  if (result.levelDiagnostics?.some((item) => item.tags.includes("active_intraday_reference"))) {
    findings.push("operator diagnostic: active intraday reference");
  }
  if (result.levelDiagnostics?.some((item) => item.tags.includes("small_clean_break_watch"))) {
    findings.push("operator diagnostic: small clean break watch");
  }
  if (result.levelDiagnostics?.some((item) => item.tags.includes("thin_liquidity_break_watch"))) {
    findings.push("operator diagnostic: thin liquidity break watch");
  }
  const weakRespects = reaction.examples.filter(
    (example) => example.respected && example.strengthLabel === "weak",
  );
  if (weakRespects.length > 0) {
    findings.push("weak level produced full respect reaction");
  }
  if (findings.length === 0) {
    findings.push("no urgent level-quality finding");
  }
  return findings;
}

async function scoreCase(
  warehouse: DurableCandleWarehouse,
  testCase: LevelQualityTestCase,
): Promise<CaseQualityResult> {
  try {
    const [daily, fourHour, fiveMinuteContext, futureFiveMinute, baselineFiveMinute] = await Promise.all([
      warehouse.getCandles({
        provider: PROVIDER,
        symbol: testCase.symbol,
        timeframe: "daily",
        startTimestamp: testCase.startTimestamp - 540 * timeframeMs("daily"),
        endTimestamp: testCase.startTimestamp,
      }),
      warehouse.getCandles({
        provider: PROVIDER,
        symbol: testCase.symbol,
        timeframe: "4h",
        startTimestamp: testCase.startTimestamp - 240 * timeframeMs("4h"),
        endTimestamp: testCase.startTimestamp,
      }),
      warehouse.getCandles({
        provider: PROVIDER,
        symbol: testCase.symbol,
        timeframe: "5m",
        startTimestamp: testCase.startTimestamp - 160 * timeframeMs("5m"),
        endTimestamp: testCase.startTimestamp,
      }),
      warehouse.getCandles({
        provider: PROVIDER,
        symbol: testCase.symbol,
        timeframe: "5m",
        startTimestamp: testCase.startTimestamp + timeframeMs("5m"),
        endTimestamp: testCase.endTimestamp,
      }),
      warehouse.getCandles({
        provider: PROVIDER,
        symbol: testCase.symbol,
        timeframe: "5m",
        startTimestamp: testCase.startTimestamp - 80 * timeframeMs("5m"),
        endTimestamp: testCase.startTimestamp,
      }),
    ]);

    if (daily.length < MIN_DAILY_CANDLES || fourHour.length < MIN_FOUR_HOUR_CANDLES) {
      throw new Error(`insufficient higher-timeframe candles daily=${daily.length} 4h=${fourHour.length}`);
    }
    if (futureFiveMinute.length < 6) {
      throw new Error(`insufficient future 5m candles (${futureFiveMinute.length})`);
    }

    const context = await buildSupportResistanceContextFromCandles({
      symbol: testCase.symbol,
      candlesByTimeframe: {
        daily,
        "4h": fourHour,
        "5m": fiveMinuteContext,
      },
      asOfTimestamp: testCase.startTimestamp,
      currentPrice: testCase.startPrice,
    });
    const report = validateForwardReactions({
      output: context.levels,
      futureCandles: futureFiveMinute,
      baselineCandles: baselineFiveMinute,
    });
    const examples = [...report.levelResults]
      .filter((item) => item.touched || item.closestApproachPct <= 0.02)
      .sort((left, right) => {
        const outcomePriority = Number(right.broken) - Number(left.broken);
        return outcomePriority || left.closestApproachPct - right.closestApproachPct;
      })
      .slice(0, 8);
    const levelDiagnostics = buildLevelOperatorDiagnostics({
      testCase,
      levels: report.levelResults,
      futureFiveMinute,
    });

    const result: CaseQualityResult = {
      ...testCase,
      status: "scored",
      levelCounts: {
        surfacedSupport: allSurfacedSupport(context.levels).length,
        surfacedResistance: allSurfacedResistance(context.levels).length,
        extensionSupport: context.levels.extensionLevels.support.length,
        extensionResistance: context.levels.extensionLevels.resistance.length,
      },
      reaction: {
        totalLevelsEvaluated: report.totalLevelsEvaluated,
        surfacedSupport: report.byKindSource.surfacedSupport,
        surfacedResistance: report.byKindSource.surfacedResistance,
        extensionSupport: report.byKindSource.extensionSupport,
        extensionResistance: report.byKindSource.extensionResistance,
        byStrengthLabel: report.byStrengthLabel,
        byVolumeLabel: report.byVolumeLabel,
        volumeEvidence: {
          touched: report.volumeEvidence.touched,
          reliable: report.volumeEvidence.reliable,
          highVolumeTouches: report.volumeEvidence.highVolumeTouches,
          highVolumeUsefulWhenTouchedRate: report.volumeEvidence.highVolumeUsefulWhenTouchedRate,
          highVolumeRespectRate: report.volumeEvidence.highVolumeRespectRate,
          highVolumeBreakRate: report.volumeEvidence.highVolumeBreakRate,
          lightVolumeTouches: report.volumeEvidence.lightVolumeTouches,
          lightVolumeBreakRate: report.volumeEvidence.lightVolumeBreakRate,
        },
        examples,
      },
      cleanBreakClassifications: buildCleanBreakClassifications({
        testCase,
        examples,
        futureFiveMinute,
      }),
      levelDiagnostics,
      findings: [],
    };
    return {
      ...result,
      findings: summaryFindings(result),
    };
  } catch (error) {
    return {
      ...testCase,
      status: "unscored",
      errorMessage: error instanceof Error ? error.message : String(error),
      findings: [],
    };
  }
}

function affectedSymbols(results: CaseQualityResult[], predicate: (result: CaseQualityResult) => boolean): string[] {
  return [...new Set(results.filter(predicate).map((result) => result.symbol))].sort();
}

function activeReferenceRiskBucket(item: LevelOperatorDiagnostic): ActiveReferenceRiskBucket {
  if (item.maxAdversePct >= 5) {
    return "reacted_then_consumed";
  }

  if (item.maxAdversePct >= 1) {
    return "reacted_then_broke";
  }

  return "reacted_and_held";
}

function buildActiveReferenceRiskBuckets(
  diagnostics: LevelOperatorDiagnostic[],
): Record<ActiveReferenceRiskBucket, number> {
  const tagged = diagnostics.filter((item) => item.tags.includes("active_intraday_reference"));
  return Object.fromEntries(
    ACTIVE_REFERENCE_RISK_BUCKETS.map((bucket) => [
      bucket,
      tagged.filter((item) => activeReferenceRiskBucket(item) === bucket).length,
    ]),
  ) as Record<ActiveReferenceRiskBucket, number>;
}

function isWeakRespectedExplanationTag(tag: ForwardLevelDiagnosticTag): boolean {
  return tag === "active_intraday_reference" ||
    tag === "single_touch_higher_timeframe_reference";
}

function isUnexplainedCleanBrokenDiagnostic(item: LevelOperatorDiagnostic): boolean {
  return item.state === "broken" &&
    item.outcome === "broken" &&
    !item.tags.includes("small_clean_break_watch") &&
    !item.tags.includes("thin_liquidity_break_watch") &&
    !item.tags.includes("sparse_tape_clean_break_watch");
}

function isUnexplainedStrongMajorCleanBrokenDiagnostic(item: LevelOperatorDiagnostic): boolean {
  return isUnexplainedCleanBrokenDiagnostic(item) &&
    (item.strengthLabel === "strong" || item.strengthLabel === "major");
}

function diagnosticIndex(result: CaseQualityResult): Map<string, LevelOperatorDiagnostic> {
  return new Map(
    (result.levelDiagnostics ?? []).map((item) => [item.zoneId, item]),
  );
}

function buildWeakRespectedExplanations(results: CaseQualityResult[]): WeakRespectedExplanation[] {
  return results.flatMap((result) => {
    if (result.status !== "scored" || !result.reaction) {
      return [];
    }

    const diagnosticsByZoneId = diagnosticIndex(result);
    return result.reaction.examples
      .filter((example) => example.respected && example.strengthLabel === "weak")
      .map((example) => {
        const diagnostic = diagnosticsByZoneId.get(example.zoneId);
        const tags = diagnostic?.tags ?? [];
        return {
          symbol: result.symbol,
          date: result.date,
          startTime: result.time,
          zoneId: example.zoneId,
          kind: example.kind,
          levelPrice: round(example.representativePrice),
          source: example.source,
          surfacedBucket: example.surfacedBucket,
          strengthScore: round(example.strengthScore),
          timeframeSources: example.timeframeSources,
          sourceTypes: example.sourceTypes,
          maxFavorablePct: round((example.maxFavorableExcursionPct ?? 0) * 100),
          maxAdversePct: round(diagnostic?.maxAdversePct ?? ((example.maxAdverseExcursionPct ?? 0) * 100)),
          tags,
          explainedByActiveIntradayReference: tags.includes("active_intraday_reference"),
          explainedBySingleTouchHigherTimeframe: tags.includes("single_touch_higher_timeframe_reference"),
        };
      });
  });
}

function buildScoreboard(results: CaseQualityResult[], checklistPath: string, warehouseRoot: string): LevelQualityScoreboard {
  const scored = results.filter((result) => result.status === "scored");
  const levelDiagnostics = scored.flatMap((result) => result.levelDiagnostics ?? []);
  const weakRespectedExplanations = buildWeakRespectedExplanations(scored);
  const weakRespectedExplainedByActiveReference = weakRespectedExplanations.filter(
    (item) => item.explainedByActiveIntradayReference,
  );
  const weakRespectedExplainedBySingleTouchHigherTimeframe = weakRespectedExplanations.filter(
    (item) => item.explainedBySingleTouchHigherTimeframe,
  );
  const weakRespectedUntagged = weakRespectedExplanations.filter(
    (item) => !item.tags.some(isWeakRespectedExplanationTag),
  );
  const diagnosticStateCounts = Object.fromEntries(
    LEVEL_DIAGNOSTIC_STATES.map((state) => [
      state,
      levelDiagnostics.filter((item) => item.state === state).length,
    ]),
  ) as Record<ForwardLevelDiagnosticState, number>;
  const diagnosticTagCounts = Object.fromEntries(
    LEVEL_DIAGNOSTIC_TAGS.map((tag) => [
      tag,
      levelDiagnostics.filter((item) => item.tags.includes(tag)).length,
    ]),
  ) as Record<ForwardLevelDiagnosticTag, number>;
  const activeReferenceRiskBuckets = buildActiveReferenceRiskBuckets(levelDiagnostics);
  const highVolumeBreakSymbols = affectedSymbols(
    scored,
    (result) => (result.reaction?.volumeEvidence.highVolumeBreakRate ?? 0) >= 0.5 &&
      (result.reaction?.volumeEvidence.highVolumeTouches ?? 0) > 0,
  );
  const noForwardResistanceSymbols = affectedSymbols(
    scored,
    (result) => (result.levelCounts?.surfacedResistance ?? 0) + (result.levelCounts?.extensionResistance ?? 0) === 0,
  );
  const strongBreakSymbols = affectedSymbols(
    scored,
    (result) => result.reaction?.examples.some(
      (example) =>
        example.outcome === "broken" &&
        (example.strengthLabel === "strong" || example.strengthLabel === "major"),
    ) ?? false,
  );
  const partialStrongBreakSymbols = affectedSymbols(
    scored,
    (result) => result.reaction?.examples.some(
      (example) =>
        example.outcome === "partial_respect" &&
        (example.strengthLabel === "strong" || example.strengthLabel === "major"),
    ) ?? false,
  );
  const weakRespectSymbols = affectedSymbols(
    scored,
    (result) => result.reaction?.examples.some(
      (example) => example.respected && example.strengthLabel === "weak",
    ) ?? false,
  );
  const consumedByMomentumSymbols = affectedSymbols(
    scored,
    (result) => result.levelDiagnostics?.some((item) => item.state === "consumed_by_momentum") ?? false,
  );
  const overTestedSymbols = affectedSymbols(
    scored,
    (result) => result.levelDiagnostics?.some((item) => item.state === "over_tested") ?? false,
  );
  const unexplainedStrongBreakSymbols = affectedSymbols(
    scored,
    (result) => result.levelDiagnostics?.some((item) =>
      isUnexplainedStrongMajorCleanBrokenDiagnostic(item)
    ) ?? false,
  );
  const wideFutureMoveSymbols = affectedSymbols(scored, (result) => result.forwardHighPct >= 30);
  const targets = [
    {
      code: "no_forward_resistance",
      label: "Scored contexts with no practical forward resistance inventory",
      evidenceCount: noForwardResistanceSymbols.length,
      affectedSymbols: noForwardResistanceSymbols,
      likelyCodeArea: "src/lib/levels/level-extension-engine.ts and src/lib/levels/level-ranker.ts",
      risk: "Could over-create extension levels if data coverage is actually missing.",
      expectedImprovement: "Reduce cases where traders reach the last shown resistance with no next map.",
    },
    {
      code: "high_volume_breaks",
      label: "High-volume touches broke levels instead of respecting them",
      evidenceCount: highVolumeBreakSymbols.length,
      affectedSymbols: highVolumeBreakSymbols,
      likelyCodeArea: "src/lib/levels/level-ranker.ts strength scoring and source confidence",
      risk: "News momentum can break good levels, so this needs multiple examples before downgrading.",
      expectedImprovement: "Better distinguish real resistance from levels that are likely already consumed.",
    },
    {
      code: "strong_major_clean_broken",
      label: "Strong/major labels cleanly broke without a useful reaction",
      evidenceCount: strongBreakSymbols.length,
      affectedSymbols: strongBreakSymbols,
      likelyCodeArea: "src/lib/levels/raw-level-candidate-builder.ts and src/lib/levels/level-ranker.ts",
      risk: "A clean breakout through a strong level is not automatically a bad level.",
      expectedImprovement: "Improve strong/moderate/weak calibration.",
    },
    {
      code: "operator_consumed_by_momentum",
      label: "Levels broke because momentum consumed them",
      evidenceCount: consumedByMomentumSymbols.length,
      affectedSymbols: consumedByMomentumSymbols,
      likelyCodeArea: "src/lib/validation/forward-reaction-diagnostics.ts and level-quality reporting",
      risk: "This should not automatically downgrade support/resistance quality.",
      expectedImprovement: "Separate real levels blown through by momentum from actual level-detection misses.",
    },
    {
      code: "operator_over_tested_levels",
      label: "Levels look over-tested or tactically spent",
      evidenceCount: overTestedSymbols.length,
      affectedSymbols: overTestedSymbols,
      likelyCodeArea: "src/lib/levels/level-scorer.ts and forward reaction diagnostics",
      risk: "Repeated high-quality confluence can still matter, so only soft reused levels should be flagged.",
      expectedImprovement: "Avoid treating worn-out small-cap levels like fresh strong/major levels.",
    },
    {
      code: "operator_unexplained_strong_major_break",
      label: "Strong/major breaks not explained by momentum, over-testing, small-break watch, or thin-liquidity watch",
      evidenceCount: unexplainedStrongBreakSymbols.length,
      affectedSymbols: unexplainedStrongBreakSymbols,
      likelyCodeArea: "src/lib/levels/level-scorer.ts and raw-level candidate scoring",
      risk: "Some unexplained breaks may still be news or liquidity artifacts.",
      expectedImprovement: "Find the remaining actual strength-label mistakes.",
    },
    {
      code: "strong_major_partial_then_broken",
      label: "Strong/major labels partially respected before later breaking",
      evidenceCount: partialStrongBreakSymbols.length,
      affectedSymbols: partialStrongBreakSymbols,
      likelyCodeArea: "src/lib/validation/forward-reaction-validator.ts and level-quality reporting",
      risk: "This is often a real level that reacted first, so it should not drive scoring changes by itself.",
      expectedImprovement: "Keep tuning focused on clean misses instead of useful but eventually consumed levels.",
    },
    {
      code: "weak_level_respected",
      label: "Weak levels produced strong respect reactions",
      evidenceCount: weakRespectSymbols.length,
      affectedSymbols: weakRespectSymbols,
      likelyCodeArea: "src/lib/levels/level-ranker.ts",
      risk: "A one-off wick reaction can make weak levels look better than they are.",
      expectedImprovement: "Find underrated shelf/pivot evidence.",
    },
  ]
    .filter((target) => target.evidenceCount > 0)
    .sort((left, right) => right.evidenceCount - left.evidenceCount || left.code.localeCompare(right.code))
    .map((target, index) => ({ rank: index + 1, ...target }));

  return {
    generatedAt: new Date().toISOString(),
    sourceChecklistPath: checklistPath,
    warehouseDirectoryPath: warehouseRoot,
    casesReviewed: results.length,
    scoredCases: scored.length,
    unscoredCases: results.length - scored.length,
    totals: {
      noForwardResistanceCases: noForwardResistanceSymbols.length,
      highVolumeTouches: scored.reduce((sum, result) => sum + (result.reaction?.volumeEvidence.highVolumeTouches ?? 0), 0),
      highVolumeBreaks: scored.reduce((sum, result) => {
        const evidence = result.reaction?.volumeEvidence;
        return sum + (evidence && evidence.highVolumeBreakRate > 0 ? 1 : 0);
      }, 0),
      strongOrMajorBreakExamples: scored.reduce(
        (sum, result) =>
          sum +
          (result.reaction?.examples.filter(
            (example) => example.broken && (example.strengthLabel === "strong" || example.strengthLabel === "major"),
          ).length ?? 0),
        0,
      ),
      strongOrMajorCleanBreakExamples: scored.reduce(
        (sum, result) =>
          sum +
          (result.reaction?.examples.filter(
            (example) =>
              example.outcome === "broken" &&
              (example.strengthLabel === "strong" || example.strengthLabel === "major"),
          ).length ?? 0),
        0,
      ),
      strongOrMajorPartialBreakExamples: scored.reduce(
        (sum, result) =>
          sum +
          (result.reaction?.examples.filter(
            (example) =>
              example.outcome === "partial_respect" &&
              (example.strengthLabel === "strong" || example.strengthLabel === "major"),
          ).length ?? 0),
        0,
      ),
      majorCleanBreakExamples: scored.reduce(
        (sum, result) =>
          sum +
          (result.reaction?.examples.filter(
            (example) => example.outcome === "broken" && example.strengthLabel === "major",
          ).length ?? 0),
        0,
      ),
      underratedWeakRespectExamples: scored.reduce(
        (sum, result) =>
          sum + (result.reaction?.examples.filter((example) => example.respected && example.strengthLabel === "weak").length ?? 0),
        0,
      ),
      wideFutureMoveCases: wideFutureMoveSymbols.length,
      consumedByMomentumLevels: diagnosticStateCounts.consumed_by_momentum,
      overTestedLevels: diagnosticStateCounts.over_tested,
      unexplainedBrokenLevels: levelDiagnostics.filter(isUnexplainedCleanBrokenDiagnostic).length,
      unexplainedStrongMajorCleanBreakLevels: levelDiagnostics.filter(isUnexplainedStrongMajorCleanBrokenDiagnostic).length,
      activeIntradayReferenceLevels: diagnosticTagCounts.active_intraday_reference,
      thinLiquidityBreakWatchLevels: diagnosticTagCounts.thin_liquidity_break_watch,
      singleTouchHigherTimeframeReferenceLevels: diagnosticTagCounts.single_touch_higher_timeframe_reference,
      sparseTapeCleanBreakWatchLevels: diagnosticTagCounts.sparse_tape_clean_break_watch,
      weakRespectedExplainedByActiveReference: weakRespectedExplainedByActiveReference.length,
      weakRespectedExplainedBySingleTouchHigherTimeframe: weakRespectedExplainedBySingleTouchHigherTimeframe.length,
      weakRespectedUntagged: weakRespectedUntagged.length,
    },
    diagnosticStateCounts,
    diagnosticTagCounts,
    activeReferenceRiskBuckets,
    weakRespectedExplanation: {
      total: weakRespectedExplanations.length,
      explainedByActiveIntradayReference: weakRespectedExplainedByActiveReference.length,
      explainedBySingleTouchHigherTimeframe: weakRespectedExplainedBySingleTouchHigherTimeframe.length,
      untagged: weakRespectedUntagged.length,
      examples: weakRespectedExplanations,
      untaggedExamples: weakRespectedUntagged,
    },
    cleanBreakClassifications: scored.flatMap((result) => result.cleanBreakClassifications ?? []),
    levelDiagnostics,
    rankedTuningTargets: targets,
    results,
  };
}

function formatBatchMarkdown(cases: LevelQualityTestCase[]): string {
  const lines = [
    "# Level Quality Detection Test Batch",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Purpose: warehouse-backed symbol/session cases for support/resistance level-quality testing.",
    "",
    "| Batch | Symbol | Date | Time ET | Start | Bucket | Future high | Future low | Score | Candles d/4h/5m | Reason |",
    "| ---: | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | --- | --- |",
  ];
  cases.forEach((item, index) => {
    lines.push(
      `| ${Math.floor(index / BATCH_SIZE) + 1} | ${item.symbol} | ${item.date} | ${item.time} | ${formatPrice(item.startPrice)} | ${item.priceBucket} | ${formatPrice(item.forwardHigh)} (${formatPct(item.forwardHighPct)}) | ${formatPrice(item.forwardLow)} (-${formatPct(item.forwardLowPct)}) | ${formatPct(item.score)} | ${item.dailyCount}/${item.fourHourCount}/${item.fiveMinuteCount} | ${item.selectionReason} |`,
    );
  });
  return `${lines.join("\n")}\n`;
}

function formatCleanBreakClassificationLabel(code: CleanBreakClassificationCode): string {
  if (code === "momentum_consumed_level") {
    return "Momentum consumed a real level";
  }
  if (code === "consumed_or_overtested_level") {
    return "Consumed or over-tested level";
  }
  if (code === "active_reference_resolved") {
    return "Active reference resolved before break";
  }
  if (code === "possible_overstated_strength") {
    return "Possible overstated strength";
  }
  if (code === "event_regime_change_watch") {
    return "Event-regime change watch";
  }
  if (code === "local_level_cluster_break_watch") {
    return "Local level cluster break watch";
  }
  if (code === "single_timeframe_5m_swing_break_watch") {
    return "Single-timeframe 5m swing break watch";
  }
  if (code === "off_hours_light_volume_break_watch") {
    return "Off-hours light-volume break watch";
  }
  if (code === "off_hours_event_context_break_watch") {
    return "Off-hours event-context break watch";
  }
  if (code === "unknown_volume_clean_break_watch") {
    return "Unknown-volume clean break watch";
  }
  if (code === "minor_break_watch") {
    return "Minor break, watch before tuning";
  }
  if (code === "thin_liquidity_break_watch") {
    return "Thin liquidity break, watch before tuning";
  }
  if (code === "sparse_tape_clean_break_watch") {
    return "Sparse-tape clean break, watch before tuning";
  }
  return "Needs manual review";
}

function formatLevelDiagnosticStateLabel(state: ForwardLevelDiagnosticState): string {
  if (state === "fresh") {
    return "Fresh / still ahead";
  }
  if (state === "respected") {
    return "Respected";
  }
  if (state === "testing") {
    return "Testing / unresolved";
  }
  if (state === "consumed_by_momentum") {
    return "Consumed by momentum";
  }
  if (state === "over_tested") {
    return "Over-tested";
  }
  return "Broken";
}

function formatLevelDiagnosticTagLabel(tag: ForwardLevelDiagnosticTag): string {
  if (tag === "active_intraday_reference") {
    return "Active intraday reference";
  }
  if (tag === "small_clean_break_watch") {
    return "Small clean break watch";
  }
  if (tag === "thin_liquidity_break_watch") {
    return "Thin liquidity break watch";
  }
  if (tag === "single_touch_higher_timeframe_reference") {
    return "Single-touch higher-timeframe reference";
  }
  if (tag === "sparse_tape_clean_break_watch") {
    return "Sparse-tape clean break watch";
  }

  return tag;
}

function formatActiveReferenceRiskBucket(bucket: ActiveReferenceRiskBucket): string {
  if (bucket === "reacted_and_held") {
    return "Reacted and held";
  }
  if (bucket === "reacted_then_broke") {
    return "Reacted then broke";
  }
  return "Reacted then consumed";
}

function formatCleanBreakClassificationSummary(
  classifications: LevelCleanBreakClassification[],
): string[] {
  if (classifications.length === 0) {
    return ["- No clean strong/major breaks appeared in the report examples.", ""];
  }

  const byClassification = new Map<CleanBreakClassificationCode, number>();
  for (const item of classifications) {
    byClassification.set(item.classification, (byClassification.get(item.classification) ?? 0) + 1);
  }

  return [
    `- Classified clean break examples: ${classifications.length}`,
    ...[...byClassification.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([code, count]) => `- ${formatCleanBreakClassificationLabel(code)}: ${count}`),
    "",
  ];
}

function formatDiagnosticEvidence(item: LevelOperatorDiagnostic): string {
  return `score ${item.strengthScore.toFixed(2)}, t/e/c ${item.touchCount}/${item.sourceEvidenceCount}/${item.confluenceCount}, rej/follow ${item.rejectionScore.toFixed(2)}/${item.followThroughScore.toFixed(2)}`;
}

function formatDiagnosticTape(item: LevelOperatorDiagnostic): string {
  if (item.resolutionBarCount === 0) {
    return "no touch window";
  }

  return `${item.zeroVolumeBarCount}/${item.resolutionBarCount} zero bars, vol ${Math.round(item.totalResolutionVolume)}`;
}

function formatLevelDiagnosticSummary(scoreboard: LevelQualityScoreboard): string[] {
  const lines = LEVEL_DIAGNOSTIC_STATES.map((state) =>
    `- ${formatLevelDiagnosticStateLabel(state)}: ${scoreboard.diagnosticStateCounts[state]}`,
  );
  const priorityDiagnostics = scoreboard.levelDiagnostics
    .filter((item) =>
      item.state === "consumed_by_momentum" ||
      item.state === "over_tested" ||
      item.state === "broken" ||
      item.state === "testing"
    )
    .sort((left, right) => {
      const priority: Record<ForwardLevelDiagnosticState, number> = {
        consumed_by_momentum: 0,
        over_tested: 1,
        broken: 2,
        testing: 3,
        respected: 4,
        fresh: 5,
      };
      return priority[left.state] - priority[right.state] || right.maxAdversePct - left.maxAdversePct;
    })
    .slice(0, 40);

  if (priorityDiagnostics.length === 0) {
    return [...lines, "", "- No priority diagnostics in this batch.", ""];
  }

  return [
    ...lines,
    "",
    "| Symbol | Level | Outcome | State | Volume | Evidence | Tape | Move through | Reasons |",
    "| --- | ---: | --- | --- | --- | --- | --- | ---: | --- |",
    ...priorityDiagnostics.map((item) =>
      `| ${item.symbol} | ${formatPrice(item.levelPrice)} ${item.kind} ${item.strengthLabel} | ${item.outcome} | ${formatLevelDiagnosticStateLabel(item.state)} | ${item.volumeLabel}/${item.volumeReliability}${item.relativeVolumeRatio === null ? "" : ` ${item.relativeVolumeRatio.toFixed(2)}x`} | ${formatDiagnosticEvidence(item)} | ${formatDiagnosticTape(item)} | ${formatPct(item.maxAdversePct)} | ${item.reasons.join("; ")} |`,
    ),
    "",
  ];
}

function formatLevelDiagnosticTagSummary(scoreboard: LevelQualityScoreboard): string[] {
  const taggedDiagnostics = scoreboard.levelDiagnostics
    .filter((item) => item.tags.length > 0)
    .sort((left, right) =>
      right.maxFavorablePct - left.maxFavorablePct ||
      left.symbol.localeCompare(right.symbol),
    );
  const lines = LEVEL_DIAGNOSTIC_TAGS.map((tag) =>
    `- ${formatLevelDiagnosticTagLabel(tag)}: ${scoreboard.diagnosticTagCounts[tag]}`,
  );

  if (taggedDiagnostics.length === 0) {
    return [...lines, "", "- No tagged operator diagnostics in this batch.", ""];
  }

  return [
    ...lines,
    ...ACTIVE_REFERENCE_RISK_BUCKETS.map((bucket) =>
      `- ${formatActiveReferenceRiskBucket(bucket)}: ${scoreboard.activeReferenceRiskBuckets[bucket]}`,
    ),
    "",
    "| Symbol | Level | Tags | State | Volume | Tape | Favorable reaction | Move through | Reasons |",
    "| --- | ---: | --- | --- | --- | --- | ---: | ---: | --- |",
    ...taggedDiagnostics.map((item) =>
      `| ${item.symbol} | ${formatPrice(item.levelPrice)} ${item.kind} ${item.strengthLabel} | ${item.tags.map(formatLevelDiagnosticTagLabel).join(", ")} | ${formatLevelDiagnosticStateLabel(item.state)} | ${item.volumeLabel}/${item.volumeReliability}${item.relativeVolumeRatio === null ? "" : ` ${item.relativeVolumeRatio.toFixed(2)}x`} | ${formatDiagnosticTape(item)} | ${formatPct(item.maxFavorablePct)} | ${formatPct(item.maxAdversePct)} | ${item.reasons.join("; ")} |`,
    ),
    "",
  ];
}

function formatWeakRespectedExplanation(scoreboard: LevelQualityScoreboard): string[] {
  const explanation = scoreboard.weakRespectedExplanation;
  const lines = [
    `- Total weak-respected examples: ${explanation.total}`,
    `- Explained by active intraday reference: ${explanation.explainedByActiveIntradayReference}`,
    `- Explained by single-touch higher-timeframe reference: ${explanation.explainedBySingleTouchHigherTimeframe}`,
    `- Untagged weak-respected examples: ${explanation.untagged}`,
    "",
  ];

  if (explanation.untaggedExamples.length === 0) {
    return [...lines, "- No untagged weak-respected examples remain.", ""];
  }

  return [
    ...lines,
    "| Symbol | Level | Source | Score | Favorable reaction | Move through | Why untagged |",
    "| --- | ---: | --- | ---: | ---: | ---: | --- |",
    ...explanation.untaggedExamples.map((item) => {
      const source = `${item.surfacedBucket ?? item.source} ${item.timeframeSources.join("/")}`;
      const reason = item.tags.includes("single_touch_higher_timeframe_reference")
        ? "single-touch higher-timeframe reference"
        : item.timeframeSources.includes("5m")
          ? "5m criteria did not qualify"
          : "higher-timeframe weak level, not an explanatory tag";
      return `| ${item.symbol} | ${formatPrice(item.levelPrice)} ${item.kind} | ${source} ${item.sourceTypes.join("/")} | ${item.strengthScore.toFixed(2)} | ${formatPct(item.maxFavorablePct)} | ${formatPct(item.maxAdversePct)} | ${reason} |`;
    }),
    "",
  ];
}

function formatScoreboardMarkdown(scoreboard: LevelQualityScoreboard): string {
  const lines = [
    "# Level Quality Scoreboard",
    "",
    `Generated: ${scoreboard.generatedAt}`,
    "",
    `Cases reviewed: ${scoreboard.casesReviewed}`,
    `Scored cases: ${scoreboard.scoredCases}`,
    `Unscored cases: ${scoreboard.unscoredCases}`,
    "",
    "## Totals",
    "",
    `- No forward resistance cases: ${scoreboard.totals.noForwardResistanceCases}`,
    `- High-volume touches: ${scoreboard.totals.highVolumeTouches}`,
    `- High-volume break cases: ${scoreboard.totals.highVolumeBreaks}`,
    `- Strong/major break examples: ${scoreboard.totals.strongOrMajorBreakExamples}`,
    `- Strong/major clean break examples: ${scoreboard.totals.strongOrMajorCleanBreakExamples}`,
    `- Strong/major partial-then-break examples: ${scoreboard.totals.strongOrMajorPartialBreakExamples}`,
    `- Major clean break examples: ${scoreboard.totals.majorCleanBreakExamples}`,
    `- Weak respected examples: ${scoreboard.totals.underratedWeakRespectExamples}`,
    `- Wide future move cases: ${scoreboard.totals.wideFutureMoveCases}`,
    `- Consumed-by-momentum level diagnostics: ${scoreboard.totals.consumedByMomentumLevels}`,
    `- Over-tested level diagnostics: ${scoreboard.totals.overTestedLevels}`,
    `- Clean broken level diagnostics not explained yet: ${scoreboard.totals.unexplainedBrokenLevels}`,
    `- Clean strong/major broken diagnostics not explained yet: ${scoreboard.totals.unexplainedStrongMajorCleanBreakLevels}`,
    `- Active intraday reference tags: ${scoreboard.totals.activeIntradayReferenceLevels}`,
    `- Thin liquidity break watch tags: ${scoreboard.totals.thinLiquidityBreakWatchLevels}`,
    `- Single-touch higher-timeframe reference tags: ${scoreboard.totals.singleTouchHigherTimeframeReferenceLevels}`,
    `- Sparse-tape clean break watch tags: ${scoreboard.totals.sparseTapeCleanBreakWatchLevels}`,
    `- Weak-respected explained by active intraday reference: ${scoreboard.totals.weakRespectedExplainedByActiveReference}`,
    `- Weak-respected explained by single-touch higher-timeframe reference: ${scoreboard.totals.weakRespectedExplainedBySingleTouchHigherTimeframe}`,
    `- Weak-respected still untagged: ${scoreboard.totals.weakRespectedUntagged}`,
    "",
    "## Ranked Tuning Targets",
    "",
  ];

  if (scoreboard.rankedTuningTargets.length === 0) {
    lines.push("- No ranked tuning target had enough evidence in this batch.", "");
  } else {
    for (const target of scoreboard.rankedTuningTargets) {
      lines.push(
        `### ${target.rank}. ${target.label}`,
        "",
        `- Code: ${target.code}`,
        `- Evidence count: ${target.evidenceCount}`,
        `- Affected symbols: ${target.affectedSymbols.join(", ") || "none"}`,
        `- Likely code area: ${target.likelyCodeArea}`,
        `- Risk: ${target.risk}`,
        `- Expected improvement: ${target.expectedImprovement}`,
        "",
      );
    }
  }

  lines.push("## Operator-Only Level State Diagnostics", "");
  lines.push(...formatLevelDiagnosticSummary(scoreboard));

  lines.push("## Operator-Only Diagnostic Tags", "");
  lines.push(...formatLevelDiagnosticTagSummary(scoreboard));

  lines.push("## Weak-Respected Explanation", "");
  lines.push(...formatWeakRespectedExplanation(scoreboard));

  lines.push("## Operator-Only Clean Break Classification", "");
  lines.push(...formatCleanBreakClassificationSummary(scoreboard.cleanBreakClassifications));

  for (const item of scoreboard.cleanBreakClassifications) {
    lines.push(
      `### ${item.symbol} ${item.kind} ${formatPrice(item.levelPrice)} ${item.strengthLabel}`,
      "",
      `- Classification: ${formatCleanBreakClassificationLabel(item.classification)} (${item.classification})`,
      `- Reasons: ${item.reasons.join("; ")}`,
      `- Score inputs: score ${item.strengthScore.toFixed(2)}, touches ${item.touchCount}, evidence ${item.sourceEvidenceCount}, confluence ${item.confluenceCount}, sources ${item.timeframeSources.join("/")}, reaction ${item.reactionQualityScore.toFixed(2)}, rejection ${item.rejectionScore.toFixed(2)}, follow-through ${item.followThroughScore.toFixed(2)}`,
      `- Volume: ${item.volumeLabel}/${item.volumeReliability}${item.relativeVolumeRatio === null ? "" : ` ${item.relativeVolumeRatio.toFixed(2)}x`}`,
      `- Break window: favorable ${formatPct(item.maxFavorablePct)}, adverse ${formatPct(item.maxAdversePct)}`,
      "",
      "| ET | Open | High | Low | Close | Volume | Close distance |",
      "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const candle of item.resolutionWindow) {
      lines.push(
        `| ${candle.time} | ${formatPrice(candle.open)} | ${formatPrice(candle.high)} | ${formatPrice(candle.low)} | ${formatPrice(candle.close)} | ${candle.volume} | ${formatPct(candle.closeDistancePct)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Case Results", "");
  lines.push("| Symbol | Status | Start | Future high | Levels S/R/ExtS/ExtR | Touched | High-volume | Findings |");
  lines.push("| --- | --- | ---: | ---: | --- | ---: | ---: | --- |");
  for (const result of scoreboard.results) {
    const levels = result.levelCounts
      ? `${result.levelCounts.surfacedSupport}/${result.levelCounts.surfacedResistance}/${result.levelCounts.extensionSupport}/${result.levelCounts.extensionResistance}`
      : "n/a";
    const touched = result.reaction?.volumeEvidence.touched ?? 0;
    const highVolume = result.reaction?.volumeEvidence.highVolumeTouches ?? 0;
    lines.push(
      `| ${result.symbol} | ${result.status} | ${formatPrice(result.startPrice)} | ${formatPct(result.forwardHighPct)} | ${levels} | ${touched} | ${highVolume} | ${result.findings.join("; ") || result.errorMessage || "none"} |`,
    );
  }

  lines.push("", "## Reaction Examples", "");
  for (const result of scoreboard.results.filter((item) => item.reaction?.examples.length)) {
    lines.push(`### ${result.symbol}`, "");
    for (const example of result.reaction!.examples.slice(0, 5)) {
      lines.push(
        `- ${example.kind} ${formatPrice(example.representativePrice)} ${example.strengthLabel} ${example.source}: ${example.outcome}; volume ${example.volumeContext.label}/${example.volumeContext.reliability}${example.volumeContext.relativeVolumeRatio === null ? "" : ` ${example.volumeContext.relativeVolumeRatio.toFixed(2)}x`}; favorable ${formatPct((example.maxFavorableExcursionPct ?? 0) * 100)}; adverse ${formatPct((example.maxAdverseExcursionPct ?? 0) * 100)}`,
        `  - score ${example.strengthScore.toFixed(2)}, touches ${example.touchCount}, evidence ${example.sourceEvidenceCount}, confluence ${example.confluenceCount}, sources ${example.timeframeSources.join("/")}, reaction ${example.reactionQualityScore.toFixed(2)}, rejection ${example.rejectionScore.toFixed(2)}, follow-through ${example.followThroughScore.toFixed(2)}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

async function readScoreboard(path: string): Promise<LevelQualityScoreboard> {
  return JSON.parse(await readFile(path, "utf8")) as LevelQualityScoreboard;
}

function buildScoreboardComparison(params: {
  baselinePath: string;
  currentPath: string;
  baseline: LevelQualityScoreboard;
  current: LevelQualityScoreboard;
}): ScoreboardComparison {
  return {
    generatedAt: new Date().toISOString(),
    baselinePath: params.baselinePath,
    currentPath: params.currentPath,
    baselineCases: params.baseline.casesReviewed,
    currentCases: params.current.casesReviewed,
    totals: SCOREBOARD_TOTAL_KEYS.map((metric) => {
      const baseline = Number(params.baseline.totals?.[metric] ?? 0);
      const current = Number(params.current.totals?.[metric] ?? 0);
      return {
        metric,
        baseline,
        current,
        delta: current - baseline,
      };
    }),
    diagnosticStateCounts: LEVEL_DIAGNOSTIC_STATES.map((state) => {
      const baseline = Number(params.baseline.diagnosticStateCounts?.[state] ?? 0);
      const current = Number(params.current.diagnosticStateCounts?.[state] ?? 0);
      return {
        state,
        baseline,
        current,
        delta: current - baseline,
      };
    }),
    diagnosticTagCounts: LEVEL_DIAGNOSTIC_TAGS.map((tag) => {
      const baseline = Number(params.baseline.diagnosticTagCounts?.[tag] ?? 0);
      const current = Number(params.current.diagnosticTagCounts?.[tag] ?? 0);
      return {
        tag,
        baseline,
        current,
        delta: current - baseline,
      };
    }),
    activeReferenceRiskBuckets: ACTIVE_REFERENCE_RISK_BUCKETS.map((bucket) => {
      const baseline = Number(params.baseline.activeReferenceRiskBuckets?.[bucket] ?? 0);
      const current = Number(params.current.activeReferenceRiskBuckets?.[bucket] ?? 0);
      return {
        bucket,
        baseline,
        current,
        delta: current - baseline,
      };
    }),
  };
}

function formatDelta(delta: number): string {
  if (delta > 0) {
    return `+${delta}`;
  }

  return String(delta);
}

function formatScoreboardComparisonMarkdown(comparison: ScoreboardComparison): string {
  const lines = [
    "# Level Quality Scoreboard Comparison",
    "",
    `Generated: ${comparison.generatedAt}`,
    "",
    `Baseline: ${comparison.baselinePath}`,
    `Current: ${comparison.currentPath}`,
    `Cases: ${comparison.baselineCases} -> ${comparison.currentCases}`,
    "",
    "## Totals",
    "",
    "| Metric | Baseline | Current | Delta |",
    "| --- | ---: | ---: | ---: |",
    ...comparison.totals.map((item) =>
      `| ${item.metric} | ${item.baseline} | ${item.current} | ${formatDelta(item.delta)} |`,
    ),
    "",
    "## Diagnostic States",
    "",
    "| State | Baseline | Current | Delta |",
    "| --- | ---: | ---: | ---: |",
    ...comparison.diagnosticStateCounts.map((item) =>
      `| ${formatLevelDiagnosticStateLabel(item.state)} | ${item.baseline} | ${item.current} | ${formatDelta(item.delta)} |`,
    ),
    "",
    "## Diagnostic Tags",
    "",
    "| Tag | Baseline | Current | Delta |",
    "| --- | ---: | ---: | ---: |",
    ...comparison.diagnosticTagCounts.map((item) =>
      `| ${formatLevelDiagnosticTagLabel(item.tag)} | ${item.baseline} | ${item.current} | ${formatDelta(item.delta)} |`,
    ),
    "",
    "## Active Reference Risk Buckets",
    "",
    "| Bucket | Baseline | Current | Delta |",
    "| --- | ---: | ---: | ---: |",
    ...comparison.activeReferenceRiskBuckets.map((item) =>
      `| ${formatActiveReferenceRiskBucket(item.bucket)} | ${item.baseline} | ${item.current} | ${formatDelta(item.delta)} |`,
    ),
    "",
  ];

  return `${lines.join("\n").trim()}\n`;
}

async function main(): Promise<void> {
  const outDir = argValue("--out") ?? DEFAULT_OUT_DIR;
  const warehouseRoot = argValue("--warehouse") ?? DEFAULT_WAREHOUSE;
  const checklistPath = argValue("--checklist") ?? DEFAULT_CHECKLIST;
  const seedPath = argValue("--seed") ?? DEFAULT_SEED_QUEUE;
  const compareTo = argValue("--compare-to");
  const allowRepeatSymbols = hasFlag("--allow-repeat-symbols");
  const maxCases = Math.floor(numberArg("--max-cases", DEFAULT_MAX_CASES));
  const horizonHours = numberArg("--hours", DEFAULT_HORIZON_HOURS);
  const maxWindowsPerDay = Math.max(1, Math.floor(numberArg("--windows-per-day", 1)));
  const minSelectionScore = Math.max(0, numberArg("--min-selection-score", MIN_SELECTION_SCORE));
  const warehouse = new DurableCandleWarehouse(warehouseRoot);

  const seededCases = hasFlag("--rescan-warehouse")
    ? []
    : await buildCasesFromSeedQueue({
        seedPath,
        checklistPath,
        warehouseRoot,
        maxCases,
        horizonHours,
        allowRepeatSymbols,
      });
  const cases = seededCases.length > 0
    ? seededCases
    : await buildTestBatch({
        checklistPath,
        warehouseRoot,
        maxCases,
        horizonHours,
        allowRepeatSymbols,
        maxWindowsPerDay,
        minSelectionScore,
      });
  const results: CaseQualityResult[] = [];
  for (const testCase of cases) {
    results.push(await scoreCase(warehouse, testCase));
  }
  const scoreboard = buildScoreboard(results, checklistPath, warehouseRoot);

  await mkdir(outDir, { recursive: true });
  const scoreboardJsonPath = join(outDir, "level-quality-scoreboard.json");
  await writeFile(join(outDir, "test-batch.json"), `${JSON.stringify(cases, null, 2)}\n`, "utf8");
  await writeFile(join(outDir, "test-batch.md"), formatBatchMarkdown(cases), "utf8");
  await writeFile(scoreboardJsonPath, `${JSON.stringify(scoreboard, null, 2)}\n`, "utf8");
  await writeFile(join(outDir, "level-quality-scoreboard.md"), formatScoreboardMarkdown(scoreboard), "utf8");
  if (compareTo) {
    const comparison = buildScoreboardComparison({
      baselinePath: compareTo,
      currentPath: scoreboardJsonPath,
      baseline: await readScoreboard(compareTo),
      current: scoreboard,
    });
    await writeFile(join(outDir, "level-quality-comparison.json"), `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
    await writeFile(join(outDir, "level-quality-comparison.md"), formatScoreboardComparisonMarkdown(comparison), "utf8");
  }
  console.log(
    `Level quality detection: cases=${scoreboard.casesReviewed}, scored=${scoreboard.scoredCases}, unscored=${scoreboard.unscoredCases}, targets=${scoreboard.rankedTuningTargets.length}.`,
  );
  console.log(`Wrote ${join(outDir, "test-batch.json")}`);
  console.log(`Wrote ${join(outDir, "level-quality-scoreboard.md")}`);
}

const isDirectRun = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
