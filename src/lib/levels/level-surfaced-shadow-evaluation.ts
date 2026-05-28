// 2026-04-18 02:05 AM America/Toronto
// Batch shadow evaluation for old surfaced runtime output versus the new surfaced selection adapter.

import type { Candle } from "../market-data/candle-types.js";
import type {
  LevelCandidate,
  LevelTouch,
  RawLevelCandidate,
} from "./level-types.js";
import { buildZoneBounds, safeDivide } from "./level-zone-utils.js";
import type {
  LevelSurfacedValidationInput,
  SurfacedValidationComparison,
  SurfacedValidationWinner,
} from "./level-surfaced-validation.js";
import { validateSurfacedOutputs } from "./level-surfaced-validation.js";

export type SurfacedShadowTag =
  | "support_hold"
  | "resistance_rejection"
  | "clean_breakout"
  | "weak_clutter"
  | "anchor_case"
  | "broken_level_case"
  | "support_case"
  | "resistance_case"
  | "near_price_case"
  | "mixed_case"
  | "first_interaction_case"
  | "flipped_case"
  | "untagged";

export type LevelSurfacedShadowCaseInput = LevelSurfacedValidationInput & {
  tags?: string[];
};

export type LevelSurfacedShadowEvaluationInput = {
  cases: LevelSurfacedShadowCaseInput[];
  reviewQueueSize?: number;
};

export type SurfacedShadowMetricWins = {
  old: number;
  new: number;
  tied: number;
};

export type SurfacedShadowManualReviewReason =
  | "closest_score_delta"
  | "old_clear_win"
  | "contradictory_result"
  | "limited_evidence";

export type SurfacedShadowManualReviewItem = {
  caseId: string;
  symbol: string;
  winner: SurfacedValidationWinner;
  scoreDelta: number;
  reason: SurfacedShadowManualReviewReason;
  notes: string[];
  tags: string[];
};

export type SurfacedShadowCaseResult = {
  caseId: string;
  symbol: string;
  tags: string[];
  validation: SurfacedValidationComparison;
  winner: SurfacedValidationWinner;
  scoreDelta: number;
  keyReason: string;
  notableSurfacedDifference: string;
  limitedEvidence: boolean;
};

export type SurfacedShadowCategoryBreakdown = {
  tag: string;
  totalCases: number;
  oldWins: number;
  newWins: number;
  mixed: number;
  inconclusive: number;
  averageValidationScoreOld: number;
  averageValidationScoreNew: number;
  averageScoreDelta: number;
};

export type SurfacedShadowMigrationReadiness =
  | "continue_shadow_mode"
  | "ready_for_more_real_case_expansion"
  | "needs_surface_calibration"
  | "ready_for_optional_runtime_flag_exploration"
  | "blocked_by_old_path_strength_in_key_categories";

export type SurfacedShadowAggregateSummary = {
  totalCases: number;
  oldWins: number;
  newWins: number;
  mixed: number;
  inconclusive: number;
  averageValidationScoreOld: number;
  averageValidationScoreNew: number;
  averageScoreDelta: number;
  practicalMetricWins: {
    clutterReduction: SurfacedShadowMetricWins;
    firstInteractionAlignment: SurfacedShadowMetricWins;
    actionableNearPriceQuality: SurfacedShadowMetricWins;
    structuralSanity: SurfacedShadowMetricWins;
    anchorUsefulness: SurfacedShadowMetricWins;
  };
  biggestNewWins: Array<{ caseId: string; symbol: string; scoreDelta: number }>;
  biggestOldWins: Array<{ caseId: string; symbol: string; scoreDelta: number }>;
  manualReviewQueue: SurfacedShadowManualReviewItem[];
  migrationReadiness: SurfacedShadowMigrationReadiness;
};

export type SurfacedShadowEvaluationReport = {
  caseResults: SurfacedShadowCaseResult[];
  aggregateSummary: SurfacedShadowAggregateSummary;
  categoryBreakdowns: SurfacedShadowCategoryBreakdown[];
};

const DEFAULT_REVIEW_QUEUE_SIZE = 8;

function makeTouch(overrides: Partial<LevelTouch> = {}): LevelTouch {
  return {
    candleTimestamp: 1,
    timeframe: "daily",
    reactionType: "rejection",
    touchDistancePct: 0.0012,
    reactionMovePct: 0.028,
    reactionMoveCandles: 2,
    volumeRatio: 1.45,
    closedAwayFromLevel: true,
    wickRejectStrength: 0.68,
    bodyRejectStrength: 0.52,
    ...overrides,
  };
}

function summarizeTouches(touches: LevelTouch[]) {
  const meaningful = touches.filter(
    (touch) =>
      touch.reactionMovePct >= 0.015 ||
      touch.volumeRatio >= 1.2 ||
      (touch.closedAwayFromLevel &&
        (touch.wickRejectStrength >= 0.4 || touch.bodyRejectStrength >= 0.4)) ||
      touch.reactionType === "failed_break" ||
      touch.reactionType === "reclaim",
  );
  const reactionMoves = meaningful.map((touch) => touch.reactionMovePct);
  const volumeRatios = meaningful.map((touch) => touch.volumeRatio);

  return {
    touches,
    touchCount: touches.length,
    meaningfulTouchCount: meaningful.length,
    rejectionCount: touches.filter((touch) => touch.reactionType === "rejection").length,
    failedBreakCount: touches.filter((touch) => touch.reactionType === "failed_break").length,
    cleanBreakCount: touches.filter((touch) => touch.reactionType === "clean_break").length,
    reclaimCount: touches.filter((touch) => touch.reactionType === "reclaim").length,
    strongestReactionMovePct: reactionMoves.length > 0 ? Math.max(...reactionMoves) : 0,
    averageReactionMovePct:
      reactionMoves.length > 0
        ? reactionMoves.reduce((sum, value) => sum + value, 0) / reactionMoves.length
        : 0,
    bestVolumeRatio: volumeRatios.length > 0 ? Math.max(...volumeRatios) : 1,
    averageVolumeRatio:
      volumeRatios.length > 0
        ? volumeRatios.reduce((sum, value) => sum + value, 0) / volumeRatios.length
        : 1,
  };
}

function makeRawCandidate(
  symbol: string,
  overrides: Partial<RawLevelCandidate>,
): RawLevelCandidate {
  return {
    id: `${symbol}-candidate-1`,
    symbol,
    price: 10,
    kind: "support",
    timeframe: "daily",
    sourceType: "swing_low",
    touchCount: 2,
    reactionScore: 1.05,
    reactionQuality: 0.7,
    rejectionScore: 0.66,
    displacementScore: 0.62,
    sessionSignificance: 0.5,
    followThroughScore: 0.64,
    gapContinuationScore: 0,
    repeatedReactionCount: 1,
    gapStructure: false,
    firstTimestamp: 1,
    lastTimestamp: 2,
    notes: [],
    ...overrides,
  };
}

function makeNewCandidate(
  symbol: string,
  overrides: Partial<LevelCandidate & { stateProfile?: "strong" | "weak" | "broken" | "flipped" }> = {},
): LevelCandidate {
  const price = overrides.price ?? 10;
  const zone = buildZoneBounds(price);
  const stateProfile = overrides.stateProfile ?? "strong";
  const touches =
    overrides.touches ??
    (stateProfile === "broken"
      ? [
          makeTouch({
            reactionType: "clean_break",
            reactionMovePct: 0.004,
            closedAwayFromLevel: false,
          }),
        ]
      : stateProfile === "weak"
        ? [
            makeTouch({ reactionMovePct: 0.016, volumeRatio: 1.05 }),
            makeTouch({ reactionMovePct: 0.011, volumeRatio: 1.02 }),
            makeTouch({ reactionMovePct: 0.009, volumeRatio: 1 }),
          ]
        : stateProfile === "flipped"
          ? [makeTouch(), makeTouch({ reactionType: "reclaim" }), makeTouch({ timeframe: "4h" })]
          : [
              makeTouch(),
              makeTouch({ timeframe: "4h" }),
              makeTouch({ reactionType: "failed_break" }),
            ]);
  const summary = summarizeTouches(touches);

  return {
    id: `${symbol}-level-1`,
    symbol,
    type: overrides.type ?? "support",
    price,
    zoneLow: overrides.zoneLow ?? zone.zoneLow,
    zoneHigh: overrides.zoneHigh ?? zone.zoneHigh,
    sourceTimeframes: overrides.sourceTimeframes ?? ["daily"],
    originKinds: overrides.originKinds ?? ["swing_low"],
    touches,
    touchCount: overrides.touchCount ?? summary.touchCount,
    meaningfulTouchCount: overrides.meaningfulTouchCount ?? summary.meaningfulTouchCount,
    rejectionCount: overrides.rejectionCount ?? summary.rejectionCount,
    failedBreakCount: overrides.failedBreakCount ?? summary.failedBreakCount,
    cleanBreakCount: overrides.cleanBreakCount ?? summary.cleanBreakCount,
    reclaimCount: overrides.reclaimCount ?? summary.reclaimCount,
    roleFlipCount: overrides.roleFlipCount ?? (stateProfile === "flipped" ? 1 : 0),
    strongestReactionMovePct:
      overrides.strongestReactionMovePct ?? summary.strongestReactionMovePct,
    averageReactionMovePct:
      overrides.averageReactionMovePct ?? summary.averageReactionMovePct,
    bestVolumeRatio: overrides.bestVolumeRatio ?? summary.bestVolumeRatio,
    averageVolumeRatio: overrides.averageVolumeRatio ?? summary.averageVolumeRatio,
    cleanlinessStdDevPct:
      overrides.cleanlinessStdDevPct ?? (stateProfile === "weak" ? 0.006 : 0.0012),
    ageInBars: overrides.ageInBars ?? 22,
    barsSinceLastReaction: overrides.barsSinceLastReaction ?? 3,
    ...overrides,
  };
}

function buildForwardCandles(
  startTimestamp: number,
  bars: Array<{ open?: number; high: number; low: number; close: number; volume?: number }>,
): Candle[] {
  return bars.map((bar, index) => ({
    timestamp: startTimestamp + index * 5 * 60 * 1000,
    open: bar.open ?? bar.close,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume ?? 100_000 + index * 2_500,
  }));
}

function deltaNotes(
  result: SurfacedValidationComparison,
): Array<{ label: string; delta: number }> {
  return [
    {
      label: "near-price usefulness",
      delta:
        result.newSystem.metrics.actionableQualityScore -
        result.oldSystem.metrics.actionableQualityScore,
    },
    {
      label: "ladder cleanliness",
      delta:
        result.newSystem.metrics.ladderCleanlinessScore -
        result.oldSystem.metrics.ladderCleanlinessScore,
    },
    {
      label: "forward interaction relevance",
      delta:
        result.newSystem.metrics.forwardInteractionScore -
        result.oldSystem.metrics.forwardInteractionScore,
    },
    {
      label: "first interaction alignment",
      delta:
        result.newSystem.metrics.firstInteractionAlignmentScore -
        result.oldSystem.metrics.firstInteractionAlignmentScore,
    },
    {
      label: "structural sanity",
      delta:
        result.newSystem.metrics.structuralSanityScore -
        result.oldSystem.metrics.structuralSanityScore,
    },
    {
      label: "anchor usefulness",
      delta:
        result.newSystem.metrics.anchorUsefulnessScore -
        result.oldSystem.metrics.anchorUsefulnessScore,
    },
  ];
}

function inferKeyReason(result: SurfacedValidationComparison): string {
  const sorted = deltaNotes(result).sort(
    (left, right) => Math.abs(right.delta) - Math.abs(left.delta),
  );
  const primary = sorted[0];
  if (!primary || Math.abs(primary.delta) < 0.75) {
    return "No single surfaced dimension dominated; this case stayed relatively balanced.";
  }

  if (primary.delta > 0) {
    return `New adapter advantage came mostly from ${primary.label}.`;
  }

  return `Old surfaced path advantage came mostly from ${primary.label}.`;
}

function inferNotableSurfacedDifference(
  result: SurfacedValidationComparison,
): string {
  const differences: string[] = [];
  const oldSupport = result.oldSystem.surfacedOutput.nearestSupport;
  const newSupport = result.newSystem.surfacedOutput.nearestSupport;
  const oldResistance = result.oldSystem.surfacedOutput.nearestResistance;
  const newResistance = result.newSystem.surfacedOutput.nearestResistance;

  if (oldSupport?.price !== newSupport?.price) {
    differences.push(
      `support changed ${oldSupport?.price?.toFixed(2) ?? "none"} -> ${newSupport?.price?.toFixed(2) ?? "none"}`,
    );
  }
  if (oldResistance?.price !== newResistance?.price) {
    differences.push(
      `resistance changed ${oldResistance?.price?.toFixed(2) ?? "none"} -> ${newResistance?.price?.toFixed(2) ?? "none"}`,
    );
  }
  if (
    result.newSystem.metrics.redundantNearbyCount <
    result.oldSystem.metrics.redundantNearbyCount
  ) {
    differences.push("new adapter cut duplicate nearby levels");
  }
  if (
    result.newSystem.metrics.anchorCount > 0 &&
    result.oldSystem.metrics.anchorCount === 0
  ) {
    differences.push("new adapter added a deeper anchor");
  }

  return differences[0] ?? result.summary;
}

function hasLimitedEvidence(result: SurfacedValidationComparison): boolean {
  const oldUseful = result.oldSystem.metrics.interactionResults.some(
    (interaction) => interaction.useful || interaction.broken,
  );
  const newUseful = result.newSystem.metrics.interactionResults.some(
    (interaction) => interaction.useful || interaction.broken,
  );
  const forwardCeiling = Math.max(
    result.oldSystem.metrics.forwardInteractionScore,
    result.newSystem.metrics.forwardInteractionScore,
  );

  return !oldUseful && !newUseful && forwardCeiling <= 8;
}

function compareMetric(
  caseResults: SurfacedShadowCaseResult[],
  getter: (result: SurfacedShadowCaseResult) => { old: number; new: number },
): SurfacedShadowMetricWins {
  let old = 0;
  let next = 0;
  let tied = 0;

  for (const result of caseResults) {
    const metrics = getter(result);
    if (metrics.new > metrics.old) {
      next += 1;
    } else if (metrics.old > metrics.new) {
      old += 1;
    } else {
      tied += 1;
    }
  }

  return { old, new: next, tied };
}

function buildCategoryBreakdowns(
  caseResults: SurfacedShadowCaseResult[],
): SurfacedShadowCategoryBreakdown[] {
  const tagMap = new Map<string, SurfacedShadowCaseResult[]>();

  for (const result of caseResults) {
    const tags = result.tags.length > 0 ? result.tags : ["untagged"];
    for (const tag of tags) {
      const existing = tagMap.get(tag) ?? [];
      existing.push(result);
      tagMap.set(tag, existing);
    }
  }

  return [...tagMap.entries()]
    .map(([tag, results]) => ({
      tag,
      totalCases: results.length,
      oldWins: results.filter((result) => result.winner === "old").length,
      newWins: results.filter((result) => result.winner === "new").length,
      mixed: results.filter((result) => result.winner === "mixed").length,
      inconclusive: results.filter((result) => result.winner === "inconclusive").length,
      averageValidationScoreOld: Number(
        safeDivide(
          results.reduce(
            (sum, result) => sum + result.validation.oldSystem.metrics.validationScore,
            0,
          ),
          results.length,
          0,
        ).toFixed(2),
      ),
      averageValidationScoreNew: Number(
        safeDivide(
          results.reduce(
            (sum, result) => sum + result.validation.newSystem.metrics.validationScore,
            0,
          ),
          results.length,
          0,
        ).toFixed(2),
      ),
      averageScoreDelta: Number(
        safeDivide(
          results.reduce((sum, result) => sum + result.scoreDelta, 0),
          results.length,
          0,
        ).toFixed(2),
      ),
    }))
    .sort((left, right) => left.tag.localeCompare(right.tag));
}

function buildManualReviewQueue(
  caseResults: SurfacedShadowCaseResult[],
  limit: number,
): SurfacedShadowManualReviewItem[] {
  const queue: SurfacedShadowManualReviewItem[] = [];

  const closest = [...caseResults]
    .filter((result) => result.winner !== "inconclusive")
    .sort((left, right) => Math.abs(left.scoreDelta) - Math.abs(right.scoreDelta))
    .slice(0, Math.min(3, caseResults.length))
    .map((result) => ({
      caseId: result.caseId,
      symbol: result.symbol,
      winner: result.winner,
      scoreDelta: result.scoreDelta,
      reason: "closest_score_delta" as const,
      notes: [result.keyReason],
      tags: result.tags,
    }));

  queue.push(...closest);

  for (const result of caseResults) {
    const notes = deltaNotes(result.validation);
    const oldNearPriceWin =
      result.validation.oldSystem.metrics.actionableQualityScore >=
      result.validation.newSystem.metrics.actionableQualityScore + 3;
    const newStructuralWin =
      result.validation.newSystem.metrics.structuralSanityScore >=
      result.validation.oldSystem.metrics.structuralSanityScore + 3;

    if (result.winner === "old" && Math.abs(result.scoreDelta) >= 8) {
      queue.push({
        caseId: result.caseId,
        symbol: result.symbol,
        winner: result.winner,
        scoreDelta: result.scoreDelta,
        reason: "old_clear_win",
        notes: [notes[0]?.label ? `Old lead was strongest in ${notes[0].label}.` : result.keyReason],
        tags: result.tags,
      });
    }

    if (
      (result.winner === "new" && oldNearPriceWin) ||
      (result.winner === "old" && newStructuralWin) ||
      result.winner === "mixed"
    ) {
      queue.push({
        caseId: result.caseId,
        symbol: result.symbol,
        winner: result.winner,
        scoreDelta: result.scoreDelta,
        reason: "contradictory_result",
        notes: [result.keyReason, result.notableSurfacedDifference],
        tags: result.tags,
      });
    }

    if (result.limitedEvidence) {
      queue.push({
        caseId: result.caseId,
        symbol: result.symbol,
        winner: result.winner,
        scoreDelta: result.scoreDelta,
        reason: "limited_evidence",
        notes: [result.validation.summary],
        tags: result.tags,
      });
    }
  }

  const seen = new Set<string>();
  return queue
    .filter((item) => {
      const key = `${item.caseId}:${item.reason}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function inferMigrationReadiness(
  caseResults: SurfacedShadowCaseResult[],
  categoryBreakdowns: SurfacedShadowCategoryBreakdown[],
  averageScoreDelta: number,
  newWins: number,
  oldWins: number,
  mixed: number,
  practicalMetricWins: SurfacedShadowAggregateSummary["practicalMetricWins"],
): SurfacedShadowMigrationReadiness {
  if (caseResults.length < 8) {
    return "continue_shadow_mode";
  }

  const keyBreakdowns = categoryBreakdowns.filter((breakdown) =>
    ["support_case", "resistance_case", "near_price_case", "broken_level_case"].includes(
      breakdown.tag,
    ),
  );
  const oldStrengthInKeyCategories = keyBreakdowns.filter(
    (breakdown) => breakdown.oldWins > breakdown.newWins && breakdown.totalCases >= 1,
  );

  if (oldStrengthInKeyCategories.length >= 2) {
    return "blocked_by_old_path_strength_in_key_categories";
  }

  if (
    newWins >= oldWins * 2 &&
    averageScoreDelta >= 6 &&
    mixed <= Math.ceil(caseResults.length * 0.2) &&
    practicalMetricWins.actionableNearPriceQuality.new >
      practicalMetricWins.actionableNearPriceQuality.old &&
    practicalMetricWins.firstInteractionAlignment.new >=
      practicalMetricWins.firstInteractionAlignment.old &&
    practicalMetricWins.clutterReduction.new >= practicalMetricWins.clutterReduction.old
  ) {
    return "ready_for_optional_runtime_flag_exploration";
  }

  if (
    practicalMetricWins.firstInteractionAlignment.old >
      practicalMetricWins.firstInteractionAlignment.new ||
    practicalMetricWins.actionableNearPriceQuality.old >
      practicalMetricWins.actionableNearPriceQuality.new
  ) {
    return "needs_surface_calibration";
  }

  if (newWins > oldWins && averageScoreDelta >= 3) {
    return "ready_for_more_real_case_expansion";
  }

  if (oldWins > 0 || mixed >= Math.ceil(caseResults.length * 0.25)) {
    return "needs_surface_calibration";
  }

  return "continue_shadow_mode";
}

export function summarizeSurfacedShadowResults(
  caseResults: SurfacedShadowCaseResult[],
  reviewQueueSize = DEFAULT_REVIEW_QUEUE_SIZE,
): Pick<SurfacedShadowEvaluationReport, "aggregateSummary" | "categoryBreakdowns"> {
  const categoryBreakdowns = buildCategoryBreakdowns(caseResults);
  const totalCases = caseResults.length;
  const oldWins = caseResults.filter((result) => result.winner === "old").length;
  const newWins = caseResults.filter((result) => result.winner === "new").length;
  const mixed = caseResults.filter((result) => result.winner === "mixed").length;
  const inconclusive = caseResults.filter(
    (result) => result.winner === "inconclusive",
  ).length;
  const averageValidationScoreOld = Number(
    safeDivide(
      caseResults.reduce(
        (sum, result) => sum + result.validation.oldSystem.metrics.validationScore,
        0,
      ),
      totalCases,
      0,
    ).toFixed(2),
  );
  const averageValidationScoreNew = Number(
    safeDivide(
      caseResults.reduce(
        (sum, result) => sum + result.validation.newSystem.metrics.validationScore,
        0,
      ),
      totalCases,
      0,
    ).toFixed(2),
  );
  const averageScoreDelta = Number(
    safeDivide(
      caseResults.reduce((sum, result) => sum + result.scoreDelta, 0),
      totalCases,
      0,
    ).toFixed(2),
  );
  const practicalMetricWins = {
    clutterReduction: compareMetric(caseResults, (result) => ({
      old: result.validation.oldSystem.metrics.ladderCleanlinessScore,
      new: result.validation.newSystem.metrics.ladderCleanlinessScore,
    })),
    firstInteractionAlignment: compareMetric(caseResults, (result) => ({
      old: result.validation.oldSystem.metrics.firstInteractionAlignmentScore,
      new: result.validation.newSystem.metrics.firstInteractionAlignmentScore,
    })),
    actionableNearPriceQuality: compareMetric(caseResults, (result) => ({
      old: result.validation.oldSystem.metrics.actionableQualityScore,
      new: result.validation.newSystem.metrics.actionableQualityScore,
    })),
    structuralSanity: compareMetric(caseResults, (result) => ({
      old: result.validation.oldSystem.metrics.structuralSanityScore,
      new: result.validation.newSystem.metrics.structuralSanityScore,
    })),
    anchorUsefulness: compareMetric(caseResults, (result) => ({
      old: result.validation.oldSystem.metrics.anchorUsefulnessScore,
      new: result.validation.newSystem.metrics.anchorUsefulnessScore,
    })),
  };

  const biggestNewWins = [...caseResults]
    .filter((result) => result.scoreDelta > 0)
    .sort((left, right) => right.scoreDelta - left.scoreDelta)
    .slice(0, 3)
    .map((result) => ({
      caseId: result.caseId,
      symbol: result.symbol,
      scoreDelta: result.scoreDelta,
    }));

  const biggestOldWins = [...caseResults]
    .filter((result) => result.scoreDelta < 0)
    .sort((left, right) => left.scoreDelta - right.scoreDelta)
    .slice(0, 3)
    .map((result) => ({
      caseId: result.caseId,
      symbol: result.symbol,
      scoreDelta: result.scoreDelta,
    }));

  const aggregateSummary: SurfacedShadowAggregateSummary = {
    totalCases,
    oldWins,
    newWins,
    mixed,
    inconclusive,
    averageValidationScoreOld,
    averageValidationScoreNew,
    averageScoreDelta,
    practicalMetricWins,
    biggestNewWins,
    biggestOldWins,
    manualReviewQueue: buildManualReviewQueue(caseResults, reviewQueueSize),
    migrationReadiness: inferMigrationReadiness(
      caseResults,
      categoryBreakdowns,
      averageScoreDelta,
      newWins,
      oldWins,
      mixed,
      practicalMetricWins,
    ),
  };

  return {
    aggregateSummary,
    categoryBreakdowns,
  };
}

export function evaluateSurfacedShadowBatch(
  input: LevelSurfacedShadowEvaluationInput,
): SurfacedShadowEvaluationReport {
  const caseResults = input.cases.map((shadowCase) => {
    const validation = validateSurfacedOutputs(shadowCase);
    return {
      caseId: validation.caseId,
      symbol: validation.symbol,
      tags: shadowCase.tags ?? [],
      validation,
      winner: validation.winner,
      scoreDelta: validation.scoreDelta,
      keyReason: inferKeyReason(validation),
      notableSurfacedDifference: inferNotableSurfacedDifference(validation),
      limitedEvidence: hasLimitedEvidence(validation),
    } satisfies SurfacedShadowCaseResult;
  });

  const summary = summarizeSurfacedShadowResults(
    caseResults,
    input.reviewQueueSize ?? DEFAULT_REVIEW_QUEUE_SIZE,
  );

  return {
    caseResults,
    aggregateSummary: summary.aggregateSummary,
    categoryBreakdowns: summary.categoryBreakdowns,
  };
}

export function buildDefaultSurfacedShadowCases(): LevelSurfacedShadowCaseInput[] {
  const start = Date.parse("2026-04-17T14:30:00Z");

  return [
    {
      caseId: "support-hold-near",
      symbol: "SPTH",
      currentPrice: 10,
      tags: ["support_hold", "support_case", "near_price_case"],
      rawCandidates: [
        makeRawCandidate("SPTH", {
          id: "spth-s1",
          kind: "support",
          price: 9.94,
          timeframe: "daily",
          sourceType: "swing_low",
          reactionQuality: 0.82,
          rejectionScore: 0.79,
        }),
        makeRawCandidate("SPTH", {
          id: "spth-s2",
          kind: "support",
          price: 9.89,
          timeframe: "5m",
          sourceType: "swing_low",
          reactionQuality: 0.58,
          rejectionScore: 0.54,
        }),
        makeRawCandidate("SPTH", {
          id: "spth-r1",
          kind: "resistance",
          price: 10.22,
          timeframe: "4h",
          sourceType: "swing_high",
          reactionQuality: 0.7,
          rejectionScore: 0.68,
        }),
      ],
      newCandidates: [
        makeNewCandidate("SPTH", {
          id: "spth-new-s1",
          type: "support",
          price: 9.94,
          sourceTimeframes: ["daily", "4h"],
        }),
        makeNewCandidate("SPTH", {
          id: "spth-new-s2",
          type: "support",
          price: 9.55,
          sourceTimeframes: ["daily"],
          strongestReactionMovePct: 0.08,
          averageReactionMovePct: 0.05,
          bestVolumeRatio: 1.8,
          averageVolumeRatio: 1.5,
        }),
        makeNewCandidate("SPTH", {
          id: "spth-new-r1",
          type: "resistance",
          price: 10.22,
          sourceTimeframes: ["4h"],
        }),
      ],
      forwardCandles: buildForwardCandles(start, [
        { high: 10.04, low: 9.97, close: 9.99 },
        { high: 10.01, low: 9.93, close: 9.96 },
        { high: 10.08, low: 9.95, close: 10.05 },
        { high: 10.18, low: 10.02, close: 10.15 },
      ]),
      expectedBehaviorLabel: "near price support hold",
    },
    {
      caseId: "resistance-rejection-clean-ladder",
      symbol: "RREJ",
      currentPrice: 6,
      tags: ["resistance_rejection", "resistance_case", "near_price_case", "mixed_case"],
      rawCandidates: [
        makeRawCandidate("RREJ", {
          id: "rrej-r1",
          kind: "resistance",
          price: 6.08,
          timeframe: "daily",
          sourceType: "swing_high",
          reactionQuality: 0.78,
          rejectionScore: 0.75,
        }),
        makeRawCandidate("RREJ", {
          id: "rrej-r2",
          kind: "resistance",
          price: 6.1,
          timeframe: "4h",
          sourceType: "swing_high",
          reactionQuality: 0.69,
          rejectionScore: 0.67,
        }),
        makeRawCandidate("RREJ", {
          id: "rrej-r3",
          kind: "resistance",
          price: 6.12,
          timeframe: "5m",
          sourceType: "swing_high",
          reactionQuality: 0.55,
          rejectionScore: 0.5,
        }),
        makeRawCandidate("RREJ", {
          id: "rrej-s1",
          kind: "support",
          price: 5.82,
          timeframe: "4h",
          sourceType: "swing_low",
          reactionQuality: 0.7,
          rejectionScore: 0.68,
        }),
      ],
      newCandidates: [
        makeNewCandidate("RREJ", {
          id: "rrej-new-r1",
          type: "resistance",
          price: 6.09,
          sourceTimeframes: ["daily", "4h"],
        }),
        makeNewCandidate("RREJ", {
          id: "rrej-new-r2",
          type: "resistance",
          price: 6.34,
          sourceTimeframes: ["daily"],
          strongestReactionMovePct: 0.09,
          averageReactionMovePct: 0.06,
        }),
        makeNewCandidate("RREJ", {
          id: "rrej-new-s1",
          type: "support",
          price: 5.82,
          sourceTimeframes: ["4h"],
        }),
      ],
      forwardCandles: buildForwardCandles(start, [
        { high: 6.05, low: 5.97, close: 6.02 },
        { high: 6.1, low: 5.99, close: 6.06 },
        { high: 6.11, low: 5.92, close: 5.96 },
        { high: 6.0, low: 5.84, close: 5.87 },
      ]),
      expectedBehaviorLabel: "near price resistance rejection",
    },
    {
      caseId: "clean-breakout-through-resistance",
      symbol: "CBRK",
      currentPrice: 4,
      tags: ["clean_breakout", "resistance_case", "near_price_case"],
      rawCandidates: [
        makeRawCandidate("CBRK", {
          id: "cbrk-r1",
          kind: "resistance",
          price: 4.05,
          timeframe: "daily",
          sourceType: "swing_high",
          reactionQuality: 0.76,
          rejectionScore: 0.72,
        }),
        makeRawCandidate("CBRK", {
          id: "cbrk-r2",
          kind: "resistance",
          price: 4.08,
          timeframe: "5m",
          sourceType: "swing_high",
          reactionQuality: 0.56,
          rejectionScore: 0.5,
        }),
        makeRawCandidate("CBRK", {
          id: "cbrk-s1",
          kind: "support",
          price: 3.88,
          timeframe: "4h",
          sourceType: "swing_low",
          reactionQuality: 0.66,
          rejectionScore: 0.63,
        }),
      ],
      newCandidates: [
        makeNewCandidate("CBRK", {
          id: "cbrk-new-r1",
          type: "resistance",
          price: 4.06,
          sourceTimeframes: ["daily", "4h"],
        }),
        makeNewCandidate("CBRK", {
          id: "cbrk-new-r2",
          type: "resistance",
          price: 4.34,
          sourceTimeframes: ["daily"],
          strongestReactionMovePct: 0.075,
          averageReactionMovePct: 0.05,
        }),
        makeNewCandidate("CBRK", {
          id: "cbrk-new-s1",
          type: "support",
          price: 3.89,
          sourceTimeframes: ["4h"],
        }),
      ],
      forwardCandles: buildForwardCandles(start, [
        { high: 4.03, low: 3.98, close: 4.01 },
        { high: 4.07, low: 4.0, close: 4.06 },
        { high: 4.14, low: 4.05, close: 4.12 },
        { high: 4.22, low: 4.1, close: 4.19 },
      ]),
      expectedBehaviorLabel:
        "clean breakout through resistance still counts as relevance",
    },
    {
      caseId: "weak-near-clutter-vs-real-level",
      symbol: "CLTR",
      currentPrice: 2,
      tags: ["weak_clutter", "support_case", "near_price_case"],
      rawCandidates: [
        makeRawCandidate("CLTR", {
          id: "cltr-s1",
          kind: "support",
          price: 1.99,
          timeframe: "5m",
          sourceType: "swing_low",
          reactionQuality: 0.4,
          rejectionScore: 0.35,
          touchCount: 5,
        }),
        makeRawCandidate("CLTR", {
          id: "cltr-s2",
          kind: "support",
          price: 1.97,
          timeframe: "4h",
          sourceType: "swing_low",
          reactionQuality: 0.42,
          rejectionScore: 0.36,
          touchCount: 4,
        }),
        makeRawCandidate("CLTR", {
          id: "cltr-s3",
          kind: "support",
          price: 1.89,
          timeframe: "daily",
          sourceType: "swing_low",
          reactionQuality: 0.84,
          rejectionScore: 0.8,
          touchCount: 3,
        }),
        makeRawCandidate("CLTR", {
          id: "cltr-r1",
          kind: "resistance",
          price: 2.14,
          timeframe: "4h",
          sourceType: "swing_high",
          reactionQuality: 0.66,
          rejectionScore: 0.63,
        }),
      ],
      newCandidates: [
        makeNewCandidate("CLTR", {
          id: "cltr-new-s1",
          type: "support",
          price: 1.99,
          sourceTimeframes: ["5m"],
          stateProfile: "weak",
        }),
        makeNewCandidate("CLTR", {
          id: "cltr-new-s2",
          type: "support",
          price: 1.89,
          sourceTimeframes: ["daily", "4h"],
          strongestReactionMovePct: 0.07,
          averageReactionMovePct: 0.045,
          bestVolumeRatio: 1.9,
          averageVolumeRatio: 1.55,
        }),
        makeNewCandidate("CLTR", {
          id: "cltr-new-r1",
          type: "resistance",
          price: 2.14,
          sourceTimeframes: ["4h"],
        }),
      ],
      forwardCandles: buildForwardCandles(start, [
        { high: 2.01, low: 1.95, close: 1.97 },
        { high: 1.98, low: 1.89, close: 1.9 },
        { high: 1.96, low: 1.88, close: 1.95 },
        { high: 2.03, low: 1.94, close: 2.01 },
      ]),
      expectedBehaviorLabel: "weak nearby clutter should not win over the real level",
    },
    {
      caseId: "deeper-anchor-adds-context",
      symbol: "ANCH",
      currentPrice: 12,
      tags: ["anchor_case", "support_case"],
      rawCandidates: [
        makeRawCandidate("ANCH", {
          id: "anch-s1",
          kind: "support",
          price: 11.72,
          timeframe: "daily",
          sourceType: "swing_low",
          reactionQuality: 0.8,
          rejectionScore: 0.76,
        }),
        makeRawCandidate("ANCH", {
          id: "anch-s2",
          kind: "support",
          price: 11.28,
          timeframe: "4h",
          sourceType: "swing_low",
          reactionQuality: 0.67,
          rejectionScore: 0.64,
        }),
        makeRawCandidate("ANCH", {
          id: "anch-r1",
          kind: "resistance",
          price: 12.28,
          timeframe: "4h",
          sourceType: "swing_high",
          reactionQuality: 0.68,
          rejectionScore: 0.65,
        }),
      ],
      newCandidates: [
        makeNewCandidate("ANCH", {
          id: "anch-new-s1",
          type: "support",
          price: 11.72,
          sourceTimeframes: ["daily", "4h"],
        }),
        makeNewCandidate("ANCH", {
          id: "anch-new-s2",
          type: "support",
          price: 10.95,
          sourceTimeframes: ["daily"],
          strongestReactionMovePct: 0.1,
          averageReactionMovePct: 0.07,
          bestVolumeRatio: 2.0,
          averageVolumeRatio: 1.7,
        }),
        makeNewCandidate("ANCH", {
          id: "anch-new-r1",
          type: "resistance",
          price: 12.28,
          sourceTimeframes: ["4h"],
        }),
      ],
      forwardCandles: buildForwardCandles(start, [
        { high: 12.02, low: 11.84, close: 11.88 },
        { high: 11.9, low: 11.7, close: 11.74 },
        { high: 11.76, low: 11.42, close: 11.46 },
        { high: 11.48, low: 10.97, close: 11.02 },
        { high: 11.18, low: 10.94, close: 11.12 },
      ]),
      expectedBehaviorLabel:
        "deeper anchor becomes relevant later without cluttering the near ladder",
    },
    {
      caseId: "broken-level-exclusion",
      symbol: "BRKN",
      currentPrice: 8,
      tags: ["broken_level_case", "support_case", "near_price_case"],
      rawCandidates: [
        makeRawCandidate("BRKN", {
          id: "brkn-s1",
          kind: "support",
          price: 7.96,
          timeframe: "daily",
          sourceType: "swing_low",
          reactionQuality: 0.74,
          rejectionScore: 0.7,
        }),
        makeRawCandidate("BRKN", {
          id: "brkn-s2",
          kind: "support",
          price: 7.58,
          timeframe: "4h",
          sourceType: "swing_low",
          reactionQuality: 0.69,
          rejectionScore: 0.65,
        }),
        makeRawCandidate("BRKN", {
          id: "brkn-r1",
          kind: "resistance",
          price: 8.22,
          timeframe: "4h",
          sourceType: "swing_high",
          reactionQuality: 0.64,
          rejectionScore: 0.61,
        }),
      ],
      newCandidates: [
        makeNewCandidate("BRKN", {
          id: "brkn-new-s1",
          type: "support",
          price: 7.96,
          sourceTimeframes: ["daily"],
          stateProfile: "broken",
        }),
        makeNewCandidate("BRKN", {
          id: "brkn-new-s2",
          type: "support",
          price: 7.58,
          sourceTimeframes: ["4h", "daily"],
        }),
        makeNewCandidate("BRKN", {
          id: "brkn-new-r1",
          type: "resistance",
          price: 8.22,
          sourceTimeframes: ["4h"],
        }),
      ],
      forwardCandles: buildForwardCandles(start, [
        { high: 8.01, low: 7.92, close: 7.94 },
        { high: 7.96, low: 7.76, close: 7.8 },
        { high: 7.82, low: 7.58, close: 7.61 },
        { high: 7.71, low: 7.55, close: 7.68 },
      ]),
      expectedBehaviorLabel:
        "broken nearby support should not win just because it is closest",
    },
    {
      caseId: "first-interaction-alignment-vs-noisy-near",
      symbol: "ALGN",
      currentPrice: 20,
      tags: ["first_interaction_case", "support_case", "near_price_case"],
      rawCandidates: [
        makeRawCandidate("ALGN", {
          id: "algn-s1",
          kind: "support",
          price: 19.98,
          timeframe: "daily",
          sourceType: "swing_low",
          reactionQuality: 0.76,
          rejectionScore: 0.72,
          touchCount: 5,
        }),
        makeRawCandidate("ALGN", {
          id: "algn-s2",
          kind: "support",
          price: 19.94,
          timeframe: "5m",
          sourceType: "swing_low",
          reactionQuality: 0.45,
          rejectionScore: 0.41,
          touchCount: 4,
        }),
        makeRawCandidate("ALGN", {
          id: "algn-s3",
          kind: "support",
          price: 19.79,
          timeframe: "4h",
          sourceType: "swing_low",
          reactionQuality: 0.62,
          rejectionScore: 0.58,
          touchCount: 3,
        }),
        makeRawCandidate("ALGN", {
          id: "algn-r1",
          kind: "resistance",
          price: 20.28,
          timeframe: "4h",
          sourceType: "swing_high",
        }),
      ],
      newCandidates: [
        makeNewCandidate("ALGN", {
          id: "algn-new-s1",
          type: "support",
          price: 19.98,
          sourceTimeframes: ["5m"],
          stateProfile: "weak",
        }),
        makeNewCandidate("ALGN", {
          id: "algn-new-s2",
          type: "support",
          price: 19.79,
          sourceTimeframes: ["daily", "4h"],
          strongestReactionMovePct: 0.085,
          averageReactionMovePct: 0.055,
          bestVolumeRatio: 1.85,
          averageVolumeRatio: 1.5,
        }),
        makeNewCandidate("ALGN", {
          id: "algn-new-r1",
          type: "resistance",
          price: 20.28,
          sourceTimeframes: ["4h"],
        }),
      ],
      forwardCandles: buildForwardCandles(start, [
        { high: 20.02, low: 19.9, close: 19.92 },
        { high: 19.94, low: 19.78, close: 19.81 },
        { high: 19.96, low: 19.79, close: 19.95 },
        { high: 20.08, low: 19.93, close: 20.05 },
      ]),
      expectedBehaviorLabel:
        "the real first interaction should beat weak ultra-near clutter",
    },
    {
      caseId: "duplicate-resistance-band-suppression",
      symbol: "DBND",
      currentPrice: 5,
      tags: ["weak_clutter", "resistance_rejection", "resistance_case", "near_price_case"],
      rawCandidates: [
        makeRawCandidate("DBND", {
          id: "dbnd-r1",
          kind: "resistance",
          price: 5.04,
          timeframe: "daily",
          sourceType: "swing_high",
          reactionQuality: 0.68,
          rejectionScore: 0.64,
        }),
        makeRawCandidate("DBND", {
          id: "dbnd-r2",
          kind: "resistance",
          price: 5.06,
          timeframe: "4h",
          sourceType: "swing_high",
          reactionQuality: 0.63,
          rejectionScore: 0.6,
        }),
        makeRawCandidate("DBND", {
          id: "dbnd-r3",
          kind: "resistance",
          price: 5.08,
          timeframe: "5m",
          sourceType: "swing_high",
          reactionQuality: 0.52,
          rejectionScore: 0.48,
        }),
        makeRawCandidate("DBND", {
          id: "dbnd-s1",
          kind: "support",
          price: 4.86,
          timeframe: "4h",
          sourceType: "swing_low",
        }),
      ],
      newCandidates: [
        makeNewCandidate("DBND", {
          id: "dbnd-new-r1",
          type: "resistance",
          price: 5.07,
          sourceTimeframes: ["daily", "4h"],
        }),
        makeNewCandidate("DBND", {
          id: "dbnd-new-r2",
          type: "resistance",
          price: 5.32,
          sourceTimeframes: ["daily"],
          strongestReactionMovePct: 0.082,
          averageReactionMovePct: 0.054,
        }),
        makeNewCandidate("DBND", {
          id: "dbnd-new-s1",
          type: "support",
          price: 4.86,
          sourceTimeframes: ["4h"],
        }),
      ],
      forwardCandles: buildForwardCandles(start, [
        { high: 5.03, low: 4.98, close: 5.01 },
        { high: 5.08, low: 4.99, close: 5.05 },
        { high: 5.09, low: 4.94, close: 4.97 },
        { high: 5.0, low: 4.88, close: 4.91 },
      ]),
      expectedBehaviorLabel:
        "a strong representative should beat a cluttered nearby resistance band",
    },
    {
      caseId: "flipped-support-reclaims",
      symbol: "FLIP",
      currentPrice: 15,
      tags: ["flipped_case", "support_case", "near_price_case"],
      rawCandidates: [
        makeRawCandidate("FLIP", {
          id: "flip-s1",
          kind: "support",
          price: 14.88,
          timeframe: "4h",
          sourceType: "swing_low",
          reactionQuality: 0.68,
          rejectionScore: 0.64,
        }),
        makeRawCandidate("FLIP", {
          id: "flip-r1",
          kind: "resistance",
          price: 15.34,
          timeframe: "daily",
          sourceType: "swing_high",
          reactionQuality: 0.72,
          rejectionScore: 0.69,
        }),
      ],
      newCandidates: [
        makeNewCandidate("FLIP", {
          id: "flip-new-s1",
          type: "support",
          price: 14.92,
          sourceTimeframes: ["daily", "4h"],
          stateProfile: "flipped",
          originKinds: ["role_flip", "swing_low"],
        }),
        makeNewCandidate("FLIP", {
          id: "flip-new-r1",
          type: "resistance",
          price: 15.34,
          sourceTimeframes: ["daily"],
        }),
      ],
      forwardCandles: buildForwardCandles(start, [
        { high: 15.03, low: 14.94, close: 14.98 },
        { high: 15.01, low: 14.9, close: 14.93 },
        { high: 15.14, low: 14.92, close: 15.08 },
        { high: 15.26, low: 15.03, close: 15.21 },
      ]),
      expectedBehaviorLabel:
        "a flipped support should still be surfaced when the reclaim is actionable",
    },
  ];
}
