// 2026-04-18 01:05 AM America/Toronto
// Validate old surfaced runtime output against the new surfaced selection adapter on shared snapshot and forward candles.

import type { Candle, CandleTimeframe } from "../market-data/candle-types.js";
import { DEFAULT_LEVEL_ENGINE_CONFIG, type LevelEngineConfig } from "./level-config.js";
import { clusterRawLevelCandidates } from "./level-clusterer.js";
import { rankLevelZones } from "./level-ranker.js";
import { rankLevels } from "./level-ranking.js";
import type { ComparablePathOutput } from "./level-ranking-comparison.js";
import {
  normalizeOldPathOutput,
  normalizeSurfacedSelectionOutput,
} from "./level-ranking-comparison.js";
import type { LevelScoreConfig } from "./level-score-config.js";
import { LEVEL_SCORE_CONFIG } from "./level-score-config.js";
import type { LevelSurfacedSelectionConfig } from "./level-surfaced-selection-config.js";
import { LEVEL_SURFACED_SELECTION_CONFIG } from "./level-surfaced-selection-config.js";
import type {
  SurfacedLevelSelection,
  SurfacedSelectionResult,
} from "./level-surfaced-selection.js";
import { selectSurfacedLevels } from "./level-surfaced-selection.js";
import { scoreLevelZones } from "./level-scorer.js";
import { buildSpecialLevelCandidates } from "./special-level-builder.js";
import { detectSwingPoints } from "./swing-detector.js";
import { buildRawLevelCandidates } from "./raw-level-candidate-builder.js";
import type {
  LevelCandidate,
  LevelEngineOutput,
  LevelScoringContext,
  LevelState,
  RawLevelCandidate,
  SourceTimeframe,
} from "./level-types.js";
import { buildZoneBounds, clamp, overlapRatio, priceDistancePct, safeDivide } from "./level-zone-utils.js";

export type SurfacedValidationWinner = "old" | "new" | "mixed" | "inconclusive";

export type SurfacedValidationMigrationCategory =
  | "ready_for_shadow_mode"
  | "ready_for_optional_runtime_flag"
  | "needs_more_surface_calibration"
  | "blocked_by_output_contract"
  | "inconclusive_needs_more_cases";

export type LevelSurfacedValidationInput = {
  caseId?: string;
  symbol: string;
  currentPrice: number;
  snapshotCandlesByTimeframe?: Partial<Record<CandleTimeframe, Candle[]>>;
  forwardCandles: Candle[];
  latestTimestamp?: number;
  currentTimeframe?: SourceTimeframe;
  currentSessionVolumeRatio?: number;
  rawCandidates?: RawLevelCandidate[];
  newCandidates?: LevelCandidate[];
  specialLevels?: LevelEngineOutput["specialLevels"];
  expectedBehaviorLabel?: string;
};

export type SurfacedComparableLevel = {
  system: "old" | "new";
  role: "actionable" | "anchor";
  side: "support" | "resistance";
  price: number;
  zoneLow: number;
  zoneHigh: number;
  rank: number;
  score?: number;
  confidence?: number;
  state?: LevelState;
  explanation?: string;
  strengthLabel?: string;
  bucket?: "major" | "intermediate" | "intraday";
  sourceTimeframes?: SourceTimeframe[];
};

export type SurfacedInteractionOutcome =
  | "untouched"
  | "respected"
  | "partial_respect"
  | "broken"
  | "touched_no_resolution";

export type SurfacedLevelInteractionResult = {
  system: "old" | "new";
  role: "actionable" | "anchor";
  side: "support" | "resistance";
  price: number;
  outcome: SurfacedInteractionOutcome;
  touched: boolean;
  useful: boolean;
  broken: boolean;
  closestApproachPct: number;
  firstTouchTimestamp?: number;
  resolutionTimestamp?: number;
};

export type SurfacedLevelValidationMetrics = {
  actionableQualityScore: number;
  ladderCleanlinessScore: number;
  forwardInteractionScore: number;
  firstInteractionAlignmentScore: number;
  structuralSanityScore: number;
  anchorUsefulnessScore: number;
  validationScore: number;
  nearestSupportDistancePct?: number;
  nearestResistanceDistancePct?: number;
  actionableSupportCount: number;
  actionableResistanceCount: number;
  anchorCount: number;
  redundantNearbyCount: number;
  firstInteractionMissDistancePct?: number;
  interactionResults: SurfacedLevelInteractionResult[];
  notes: string[];
};

export type SurfacedSystemValidationResult = {
  system: "old" | "new";
  surfacedOutput: ComparablePathOutput;
  surfacedLevels: SurfacedComparableLevel[];
  metrics: SurfacedLevelValidationMetrics;
};

export type SurfacedValidationComparison = {
  caseId: string;
  symbol: string;
  currentPrice: number;
  expectedBehaviorLabel?: string;
  oldSystem: SurfacedSystemValidationResult;
  newSystem: SurfacedSystemValidationResult;
  winner: SurfacedValidationWinner;
  scoreDelta: number;
  summary: string;
  notableDifferences: string[];
  migrationReadiness: SurfacedValidationMigrationCategory;
};

export type SurfacedValidationSummary = {
  totalCases: number;
  oldWins: number;
  newWins: number;
  mixed: number;
  inconclusive: number;
  averageValidationScoreOld: number;
  averageValidationScoreNew: number;
  casesWhereNewReducedClutter: number;
  casesWhereNewImprovedFirstInteractionAlignment: number;
  casesNeedingManualReview: string[];
  migrationReadiness: SurfacedValidationMigrationCategory;
};

const DEFAULT_TOUCH_TOLERANCE_PCT = 0.0035;
const DEFAULT_TOUCH_TOLERANCE_ABSOLUTE = 0.01;
const DEFAULT_REACTION_MOVE_PCT = 0.02;
const DEFAULT_PARTIAL_REACTION_MOVE_PCT = 0.01;
const DEFAULT_RESOLUTION_LOOKAHEAD_BARS = 12;

function deriveLatestTimestamp(
  candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>> | undefined,
  fallback: number | undefined,
): number {
  if (fallback !== undefined) {
    return fallback;
  }

  if (!candlesByTimeframe) {
    return Date.now();
  }

  return Math.max(0, ...Object.values(candlesByTimeframe).map((candles) => candles?.at(-1)?.timestamp ?? 0));
}

function deriveCurrentTimeframe(
  candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>> | undefined,
  fallback: SourceTimeframe | undefined,
): SourceTimeframe {
  if (fallback) {
    return fallback;
  }
  if ((candlesByTimeframe?.["5m"]?.length ?? 0) > 0) {
    return "5m";
  }
  if ((candlesByTimeframe?.["4h"]?.length ?? 0) > 0) {
    return "4h";
  }
  return "daily";
}

function deriveFreshness(latestTimestamp: number): LevelEngineOutput["metadata"]["freshness"] {
  const ageHours = (Date.now() - latestTimestamp) / (1000 * 60 * 60);
  if (ageHours <= 24) {
    return "fresh";
  }
  if (ageHours <= 24 * 7) {
    return "aging";
  }
  return "stale";
}

function buildSharedRawCandidates(
  input: LevelSurfacedValidationInput,
  oldConfig: LevelEngineConfig,
): { rawCandidates: RawLevelCandidate[]; specialLevels: LevelEngineOutput["specialLevels"] } {
  if (input.rawCandidates) {
    return {
      rawCandidates: input.rawCandidates,
      specialLevels: input.specialLevels ?? {},
    };
  }

  const candlesByTimeframe = input.snapshotCandlesByTimeframe ?? {};
  const rawCandidates: RawLevelCandidate[] = [];

  for (const timeframe of ["daily", "4h", "5m"] as const) {
    const candles = candlesByTimeframe[timeframe];
    if (!candles || candles.length === 0) {
      continue;
    }

    const swings = detectSwingPoints(candles, {
      swingWindow: oldConfig.timeframeConfig[timeframe].swingWindow,
      minimumDisplacementPct: oldConfig.timeframeConfig[timeframe].minimumDisplacementPct,
      minimumSeparationBars: oldConfig.timeframeConfig[timeframe].minimumSwingSeparationBars,
    });

    rawCandidates.push(
      ...buildRawLevelCandidates({
        symbol: input.symbol.toUpperCase(),
        timeframe,
        candles,
        swings,
      }),
    );
  }

  const special = input.specialLevels
    ? { summary: input.specialLevels, candidates: [] }
    : buildSpecialLevelCandidates(
        input.symbol.toUpperCase(),
        candlesByTimeframe["5m"] ?? [],
      );

  rawCandidates.push(...special.candidates);

  return {
    rawCandidates,
    specialLevels: special.summary,
  };
}

function buildOldMetadata(input: LevelSurfacedValidationInput): LevelEngineOutput["metadata"] {
  const latestTimestamp = deriveLatestTimestamp(input.snapshotCandlesByTimeframe, input.latestTimestamp);

  return {
    providerByTimeframe: {
      daily: "validation",
      "4h": "validation",
      "5m": "validation",
    },
    dataQualityFlags: [],
    freshness: deriveFreshness(latestTimestamp),
    referencePrice: input.currentPrice,
  };
}

function buildNewScoringContext(input: LevelSurfacedValidationInput): LevelScoringContext {
  const currentTimeframe = deriveCurrentTimeframe(input.snapshotCandlesByTimeframe, input.currentTimeframe);
  const recentCandles =
    input.snapshotCandlesByTimeframe?.[currentTimeframe as CandleTimeframe] ??
    input.snapshotCandlesByTimeframe?.["5m"] ??
    input.snapshotCandlesByTimeframe?.["4h"] ??
    input.snapshotCandlesByTimeframe?.daily ??
    [];

  return {
    symbol: input.symbol.toUpperCase(),
    currentPrice: input.currentPrice,
    latestTimestamp: deriveLatestTimestamp(input.snapshotCandlesByTimeframe, input.latestTimestamp),
    currentSessionVolumeRatio: input.currentSessionVolumeRatio,
    recentCandles,
    currentTimeframe,
  };
}

function convertRawCandidateToLevelCandidate(
  candidate: RawLevelCandidate,
  input: LevelSurfacedValidationInput,
): LevelCandidate {
  const zoneBounds = buildZoneBounds(candidate.price);

  return {
    id: candidate.id,
    symbol: candidate.symbol,
    type: candidate.kind === "support" ? "support" : "resistance",
    price: candidate.price,
    zoneLow: zoneBounds.zoneLow,
    zoneHigh: zoneBounds.zoneHigh,
    sourceTimeframes: [candidate.timeframe],
    originKinds: [candidate.sourceType],
    analysisCandles: input.snapshotCandlesByTimeframe?.[candidate.timeframe],
  };
}

function buildOldOutput(
  input: LevelSurfacedValidationInput,
  oldConfig: LevelEngineConfig,
): LevelEngineOutput {
  const { rawCandidates, specialLevels } = buildSharedRawCandidates(input, oldConfig);
  const tolerance = Math.max(
    oldConfig.timeframeConfig.daily.clusterTolerancePct,
    oldConfig.timeframeConfig["4h"].clusterTolerancePct,
  );

  const supportZones = scoreLevelZones(
    clusterRawLevelCandidates(input.symbol.toUpperCase(), "support", rawCandidates, tolerance, oldConfig),
    oldConfig,
  );
  const resistanceZones = scoreLevelZones(
    clusterRawLevelCandidates(input.symbol.toUpperCase(), "resistance", rawCandidates, tolerance, oldConfig),
    oldConfig,
  );

  return rankLevelZones({
    symbol: input.symbol.toUpperCase(),
    supportZones,
    resistanceZones,
    specialLevels,
    metadata: buildOldMetadata(input),
    config: oldConfig,
  });
}

function buildNewOutput(
  input: LevelSurfacedValidationInput,
  newConfig: LevelScoreConfig,
  surfacedConfig: LevelSurfacedSelectionConfig,
): { ranked: ReturnType<typeof rankLevels>; surfaced: SurfacedSelectionResult } {
  const { rawCandidates } = buildSharedRawCandidates(input, DEFAULT_LEVEL_ENGINE_CONFIG);
  const newCandidates = input.newCandidates ?? rawCandidates.map((candidate) => convertRawCandidateToLevelCandidate(candidate, input));
  const ranked = rankLevels(newCandidates, buildNewScoringContext(input), newConfig);
  const surfaced = selectSurfacedLevels(ranked, surfacedConfig);
  return { ranked, surfaced };
}

function mapOldSurfacedLevels(oldOutput: LevelEngineOutput, currentPrice: number): SurfacedComparableLevel[] {
  const normalized = normalizeOldPathOutput(oldOutput, currentPrice, 12);

  return [
    ...normalized.supports.map((level) => ({
      system: "old" as const,
      role: "actionable" as const,
      side: "support" as const,
      price: level.price,
      zoneLow: level.zoneLow,
      zoneHigh: level.zoneHigh,
      rank: level.nearestRank,
      score: level.score,
      confidence: level.confidence,
      state: level.state,
      explanation: level.explanation,
      strengthLabel: level.strengthLabel,
      bucket: level.bucket,
      sourceTimeframes: level.sourceTimeframes,
    })),
    ...normalized.resistances.map((level) => ({
      system: "old" as const,
      role: "actionable" as const,
      side: "resistance" as const,
      price: level.price,
      zoneLow: level.zoneLow,
      zoneHigh: level.zoneHigh,
      rank: level.nearestRank,
      score: level.score,
      confidence: level.confidence,
      state: level.state,
      explanation: level.explanation,
      strengthLabel: level.strengthLabel,
      bucket: level.bucket,
      sourceTimeframes: level.sourceTimeframes,
    })),
  ];
}

function mapNewSurfacedLevels(surfaced: SurfacedSelectionResult): SurfacedComparableLevel[] {
  const mapLevel = (level: SurfacedLevelSelection, side: "support" | "resistance"): SurfacedComparableLevel => ({
    system: "new",
    role: level.selectionCategory,
    side,
    price: level.price,
    zoneLow: level.zoneLow,
    zoneHigh: level.zoneHigh,
    rank: Math.max(level.rank, 1),
    score: level.surfacedSelectionScore,
    confidence: level.confidence,
    state: level.state,
    explanation: level.surfacedSelectionExplanation,
    sourceTimeframes: level.sourceTimeframes,
  });

  return [
    ...surfaced.surfacedSupports.map((level) => mapLevel(level, "support")),
    ...surfaced.surfacedResistances.map((level) => mapLevel(level, "resistance")),
    ...(surfaced.deeperSupportAnchor ? [mapLevel(surfaced.deeperSupportAnchor, "support")] : []),
    ...(surfaced.deeperResistanceAnchor ? [mapLevel(surfaced.deeperResistanceAnchor, "resistance")] : []),
  ];
}

function countRedundantNearby(levels: SurfacedComparableLevel[]): number {
  const actionable = levels.filter((level) => level.role === "actionable");
  let count = 0;

  for (const side of ["support", "resistance"] as const) {
    const sideLevels = actionable.filter((level) => level.side === side).sort((left, right) => left.price - right.price);
    for (let index = 1; index < sideLevels.length; index += 1) {
      const left = sideLevels[index - 1]!;
      const right = sideLevels[index]!;
      const overlap = overlapRatio(
        { zoneLow: left.zoneLow, zoneHigh: left.zoneHigh },
        { zoneLow: right.zoneLow, zoneHigh: right.zoneHigh },
      );
      const distancePct = priceDistancePct(left.price, right.price);
      if (overlap >= 0.35 || distancePct <= LEVEL_SURFACED_SELECTION_CONFIG.sameBandSuppressionDistancePct) {
        count += 1;
      }
    }
  }

  return count;
}

function nearestActionableLevel(
  levels: SurfacedComparableLevel[],
  currentPrice: number,
  side: "support" | "resistance",
): SurfacedComparableLevel | undefined {
  return levels
    .filter((level) => level.side === side && level.role === "actionable")
    .sort(
      (left, right) =>
        Math.abs(left.price - currentPrice) - Math.abs(right.price - currentPrice) || left.rank - right.rank,
    )[0];
}

function distanceBandScore(distancePct: number | undefined, maxScore: number): number {
  if (distancePct === undefined) {
    return 0;
  }
  if (distancePct <= 0.005) {
    return maxScore;
  }
  if (distancePct <= 0.01) {
    return maxScore * 0.8;
  }
  if (distancePct <= 0.02) {
    return maxScore * 0.6;
  }
  if (distancePct <= 0.03) {
    return maxScore * 0.4;
  }
  if (distancePct <= 0.05) {
    return maxScore * 0.2;
  }
  return 0;
}

function surfacedCredibilityMultiplier(level: SurfacedComparableLevel | undefined): number {
  if (!level) {
    return 0;
  }

  let multiplier = 1;

  if (level.state === "broken") {
    multiplier -= 0.45;
  } else if (level.state === "weakened") {
    multiplier -= 0.2;
  } else if (
    level.state === "respected" ||
    level.state === "reclaimed" ||
    level.state === "flipped"
  ) {
    multiplier += 0.05;
  }

  if (level.confidence !== undefined) {
    if (level.confidence >= 70) {
      multiplier += 0.05;
    } else if (level.confidence < 50) {
      multiplier -= 0.12;
    }
  } else if (level.score !== undefined) {
    if (level.score >= 70) {
      multiplier += 0.05;
    } else if (level.score < 20) {
      multiplier -= 0.22;
    } else if (level.score < 35) {
      multiplier -= 0.12;
    }
  }

  if (level.strengthLabel === "weak") {
    multiplier -= 0.1;
  } else if (level.strengthLabel === "major" || level.strengthLabel === "strong") {
    multiplier += 0.04;
  }

  return clamp(multiplier, 0.35, 1.15);
}

function touchTolerance(price: number): number {
  return Math.max(price * DEFAULT_TOUCH_TOLERANCE_PCT, DEFAULT_TOUCH_TOLERANCE_ABSOLUTE);
}

function candleTouchesLevel(level: SurfacedComparableLevel, candle: Candle): boolean {
  const tolerance = touchTolerance(level.price);
  return candle.high >= level.zoneLow - tolerance && candle.low <= level.zoneHigh + tolerance;
}

function closestApproach(level: SurfacedComparableLevel, candle: Candle): number {
  const tolerance = touchTolerance(level.price);
  const low = level.zoneLow - tolerance;
  const high = level.zoneHigh + tolerance;

  if (candle.high >= low && candle.low <= high) {
    return 0;
  }

  const gapAbove = candle.low - high;
  const gapBelow = low - candle.high;
  const distance = Math.max(Math.max(gapAbove, gapBelow), 0);
  return distance / Math.max(level.price, 0.0001);
}

function favorableExcursion(level: SurfacedComparableLevel, candle: Candle): number {
  if (level.side === "resistance") {
    return Math.max(level.price - candle.low, 0) / Math.max(level.price, 0.0001);
  }

  return Math.max(candle.high - level.price, 0) / Math.max(level.price, 0.0001);
}

function breaksThrough(level: SurfacedComparableLevel, candle: Candle): boolean {
  const tolerance = touchTolerance(level.price);
  if (level.side === "resistance") {
    return candle.close >= level.price + tolerance;
  }
  return candle.close <= level.price - tolerance;
}

function evaluateForwardInteraction(
  level: SurfacedComparableLevel,
  futureCandles: Candle[],
): SurfacedLevelInteractionResult {
  const firstTouchIndex = futureCandles.findIndex((candle) => candleTouchesLevel(level, candle));
  const closestApproachPct =
    futureCandles.length === 0 ? 0 : Math.min(...futureCandles.map((candle) => closestApproach(level, candle)));

  if (firstTouchIndex < 0) {
    return {
      system: level.system,
      role: level.role,
      side: level.side,
      price: level.price,
      outcome: "untouched",
      touched: false,
      useful: false,
      broken: false,
      closestApproachPct: Number(closestApproachPct.toFixed(4)),
    };
  }

  const resolutionWindow = futureCandles.slice(firstTouchIndex, firstTouchIndex + DEFAULT_RESOLUTION_LOOKAHEAD_BARS);
  let maxFavorable = 0;
  let partialTimestamp: number | undefined;

  for (const candle of resolutionWindow) {
    maxFavorable = Math.max(maxFavorable, favorableExcursion(level, candle));
    if (maxFavorable >= DEFAULT_REACTION_MOVE_PCT) {
      return {
        system: level.system,
        role: level.role,
        side: level.side,
        price: level.price,
        outcome: "respected",
        touched: true,
        useful: true,
        broken: false,
        closestApproachPct: 0,
        firstTouchTimestamp: futureCandles[firstTouchIndex]!.timestamp,
        resolutionTimestamp: candle.timestamp,
      };
    }
    if (partialTimestamp === undefined && maxFavorable >= DEFAULT_PARTIAL_REACTION_MOVE_PCT) {
      partialTimestamp = candle.timestamp;
    }
    if (breaksThrough(level, candle)) {
      return {
        system: level.system,
        role: level.role,
        side: level.side,
        price: level.price,
        outcome: partialTimestamp !== undefined ? "partial_respect" : "broken",
        touched: true,
        useful: partialTimestamp !== undefined || true,
        broken: true,
        closestApproachPct: 0,
        firstTouchTimestamp: futureCandles[firstTouchIndex]!.timestamp,
        resolutionTimestamp: candle.timestamp,
      };
    }
  }

  if (partialTimestamp !== undefined) {
    return {
      system: level.system,
      role: level.role,
      side: level.side,
      price: level.price,
      outcome: "partial_respect",
      touched: true,
      useful: true,
      broken: false,
      closestApproachPct: 0,
      firstTouchTimestamp: futureCandles[firstTouchIndex]!.timestamp,
      resolutionTimestamp: partialTimestamp,
    };
  }

  return {
    system: level.system,
    role: level.role,
    side: level.side,
    price: level.price,
    outcome: "touched_no_resolution",
    touched: true,
    useful: false,
    broken: false,
    closestApproachPct: 0,
    firstTouchTimestamp: futureCandles[firstTouchIndex]!.timestamp,
  };
}

function actionableQualityScore(
  levels: SurfacedComparableLevel[],
  currentPrice: number,
  notes: string[],
): { score: number; nearestSupportDistancePct?: number; nearestResistanceDistancePct?: number } {
  const nearestSupport = nearestActionableLevel(levels, currentPrice, "support");
  const nearestResistance = nearestActionableLevel(levels, currentPrice, "resistance");
  const supportDistance = nearestSupport ? priceDistancePct(nearestSupport.price, currentPrice) : undefined;
  const resistanceDistance = nearestResistance ? priceDistancePct(nearestResistance.price, currentPrice) : undefined;
  const score =
    distanceBandScore(supportDistance, 10) * surfacedCredibilityMultiplier(nearestSupport) +
    distanceBandScore(resistanceDistance, 10) * surfacedCredibilityMultiplier(nearestResistance);

  if (!nearestSupport) {
    notes.push("missing nearest actionable support");
  }
  if (!nearestResistance) {
    notes.push("missing nearest actionable resistance");
  }

  return {
    score: Number(score.toFixed(2)),
    nearestSupportDistancePct: supportDistance,
    nearestResistanceDistancePct: resistanceDistance,
  };
}

function ladderCleanlinessScore(levels: SurfacedComparableLevel[]): { score: number; redundantNearbyCount: number } {
  const actionableSupports = levels.filter((level) => level.side === "support" && level.role === "actionable");
  const actionableResistances = levels.filter((level) => level.side === "resistance" && level.role === "actionable");
  const redundantNearbyCount = countRedundantNearby(levels);

  const sideCountScore = [actionableSupports.length, actionableResistances.length].reduce((sum, count) => {
    if (count === 0) {
      return sum;
    }
    if (count <= 3) {
      return sum + 3;
    }
    if (count === 4) {
      return sum + 1;
    }
    return sum;
  }, 0);

  const spacingPairs = [actionableSupports, actionableResistances].flatMap((sideLevels) => {
    const sorted = [...sideLevels].sort((left, right) => left.price - right.price);
    const spacings: number[] = [];
    for (let index = 1; index < sorted.length; index += 1) {
      spacings.push(priceDistancePct(sorted[index - 1]!.price, sorted[index]!.price));
    }
    return spacings;
  });

  const spacingQuality =
    spacingPairs.length === 0
      ? 4
      : clamp(
          safeDivide(
            spacingPairs.filter((spacing) => spacing >= LEVEL_SURFACED_SELECTION_CONFIG.ladderSpacingRules.minSpacingPct).length,
            spacingPairs.length,
            0,
          ) * 4,
          0,
          4,
        );

  const duplicateScore = clamp(5 - redundantNearbyCount * 3, 0, 5);

  return {
    score: Number(clamp(sideCountScore + spacingQuality + duplicateScore, 0, 15).toFixed(2)),
    redundantNearbyCount,
  };
}

function forwardInteractionScore(
  levels: SurfacedComparableLevel[],
  futureCandles: Candle[],
): { score: number; interactionResults: SurfacedLevelInteractionResult[] } {
  const interactionResults = levels.map((level) => evaluateForwardInteraction(level, futureCandles));
  const actionableResults = interactionResults.filter((result) => result.role === "actionable");
  const anchorResults = interactionResults.filter((result) => result.role === "anchor");
  const actionableUsefulRate = safeDivide(
    actionableResults.filter((result) => result.useful).length,
    actionableResults.length,
    0,
  );
  const actionableTouchRate = safeDivide(
    actionableResults.filter((result) => result.touched).length,
    actionableResults.length,
    0,
  );
  const anchorUseful = anchorResults.some((result) => result.useful) ? 1 : 0;
  const score = clamp(
    actionableUsefulRate * 15 +
      actionableTouchRate * 6 +
      (actionableResults.some((result) => result.useful || result.broken) ? 4 : 0) +
      anchorUseful * 2,
    0,
    25,
  );

  return {
    score: Number(score.toFixed(2)),
    interactionResults,
  };
}

function structuralSanityScore(levels: SurfacedComparableLevel[]): number {
  const actionable = levels.filter((level) => level.role === "actionable");
  let raw = 8;

  for (const level of actionable.slice(0, 4)) {
    if (level.state === "broken") {
      raw -= 5;
    } else if (level.state === "weakened") {
      raw -= 2;
    } else if (level.state === "respected" || level.state === "reclaimed" || level.state === "flipped") {
      raw += 2;
    }

    if (level.confidence !== undefined) {
      if (level.confidence >= 70) {
        raw += 2;
      } else if (level.confidence < 45) {
        raw -= 2;
      }
    } else if (level.strengthLabel === "major" || level.strengthLabel === "strong") {
      raw += 2;
    } else if (level.strengthLabel === "weak") {
      raw -= 2;
    }

    if (level.score !== undefined && level.score >= 70) {
      raw += 1;
    } else if (level.score !== undefined && level.score < 30) {
      raw -= 2;
    }
  }

  return Number(clamp(raw, 0, 15).toFixed(2));
}

function anchorUsefulnessScore(
  levels: SurfacedComparableLevel[],
  interactionResults: SurfacedLevelInteractionResult[],
  currentPrice: number,
): number {
  const anchors = levels.filter((level) => level.role === "anchor");
  if (anchors.length === 0) {
    return 3;
  }

  const primaryAnchor = anchors.sort(
    (left, right) => priceDistancePct(right.price, currentPrice) - priceDistancePct(left.price, currentPrice),
  )[0]!;
  let raw = 0;

  if (priceDistancePct(primaryAnchor.price, currentPrice) >= LEVEL_SURFACED_SELECTION_CONFIG.deeperAnchorMinDistancePct) {
    raw += 2;
  }
  if ((primaryAnchor.score ?? 0) >= 55 || (primaryAnchor.confidence ?? 0) >= 65) {
    raw += 2;
  }
  if (interactionResults.some((result) => result.role === "anchor" && result.useful)) {
    raw += 1;
  }

  return Number(clamp(raw, 0, 5).toFixed(2));
}

function findReferenceFirstInteractions(
  allLevels: SurfacedComparableLevel[],
  futureCandles: Candle[],
): Partial<Record<"support" | "resistance", SurfacedLevelInteractionResult>> {
  const interactions = allLevels
    .map((level) => evaluateForwardInteraction(level, futureCandles))
    .filter((result) => result.useful || result.broken)
    .sort(
      (left, right) =>
        (left.firstTouchTimestamp ?? Number.MAX_SAFE_INTEGER) - (right.firstTouchTimestamp ?? Number.MAX_SAFE_INTEGER),
    );

  return {
    support: interactions.find((result) => result.side === "support"),
    resistance: interactions.find((result) => result.side === "resistance"),
  };
}

function firstInteractionAlignmentScore(
  levels: SurfacedComparableLevel[],
  currentPrice: number,
  references: Partial<Record<"support" | "resistance", SurfacedLevelInteractionResult>>,
): { score: number; missDistancePct?: number } {
  const perSideScores: number[] = [];
  const missDistances: number[] = [];

  for (const side of ["support", "resistance"] as const) {
    const reference = references[side];
    if (!reference) {
      continue;
    }
    const nearest = nearestActionableLevel(levels, currentPrice, side);
    if (!nearest) {
      perSideScores.push(0);
      continue;
    }
    const missDistancePct = priceDistancePct(nearest.price, reference.price);
    missDistances.push(missDistancePct);
    perSideScores.push(
      distanceBandScore(missDistancePct, 10) * surfacedCredibilityMultiplier(nearest),
    );
  }

  if (perSideScores.length === 0) {
    return {
      score: 10,
    };
  }

  return {
    score: Number(clamp(safeDivide(perSideScores.reduce((sum, value) => sum + value, 0), perSideScores.length, 0) * 2, 0, 20).toFixed(2)),
    missDistancePct: missDistances.length > 0 ? Number(Math.min(...missDistances).toFixed(4)) : undefined,
  };
}

function summarizeSystem(
  system: "old" | "new",
  surfacedOutput: ComparablePathOutput,
  levels: SurfacedComparableLevel[],
  input: LevelSurfacedValidationInput,
  references: Partial<Record<"support" | "resistance", SurfacedLevelInteractionResult>>,
): SurfacedSystemValidationResult {
  const notes: string[] = [];
  const actionable = actionableQualityScore(levels, input.currentPrice, notes);
  const cleanliness = ladderCleanlinessScore(levels);
  const forward = forwardInteractionScore(levels, input.forwardCandles);
  const alignment = firstInteractionAlignmentScore(levels, input.currentPrice, references);
  const structural = structuralSanityScore(levels);
  const anchor = anchorUsefulnessScore(levels, forward.interactionResults, input.currentPrice);
  const validationScore = Number(
    clamp(
      actionable.score +
        cleanliness.score +
        forward.score +
        alignment.score +
        structural +
        anchor,
      0,
      100,
    ).toFixed(2),
  );

  return {
    system,
    surfacedOutput,
    surfacedLevels: levels,
    metrics: {
      actionableQualityScore: actionable.score,
      ladderCleanlinessScore: cleanliness.score,
      forwardInteractionScore: forward.score,
      firstInteractionAlignmentScore: alignment.score,
      structuralSanityScore: structural,
      anchorUsefulnessScore: anchor,
      validationScore,
      nearestSupportDistancePct: actionable.nearestSupportDistancePct,
      nearestResistanceDistancePct: actionable.nearestResistanceDistancePct,
      actionableSupportCount: levels.filter((level) => level.role === "actionable" && level.side === "support").length,
      actionableResistanceCount: levels.filter((level) => level.role === "actionable" && level.side === "resistance").length,
      anchorCount: levels.filter((level) => level.role === "anchor").length,
      redundantNearbyCount: cleanliness.redundantNearbyCount,
      firstInteractionMissDistancePct: alignment.missDistancePct,
      interactionResults: forward.interactionResults,
      notes,
    },
  };
}

function winnerForScores(oldScore: number, newScore: number): SurfacedValidationWinner {
  const delta = Number((newScore - oldScore).toFixed(2));
  if (Math.abs(delta) < 4) {
    if (oldScore < 55 && newScore < 55) {
      return "inconclusive";
    }
    return "mixed";
  }
  return delta > 0 ? "new" : "old";
}

function migrationCategoryForCase(
  winner: SurfacedValidationWinner,
  oldSystem: SurfacedSystemValidationResult,
  newSystem: SurfacedSystemValidationResult,
): SurfacedValidationMigrationCategory {
  const delta = newSystem.metrics.validationScore - oldSystem.metrics.validationScore;

  if (winner === "inconclusive") {
    return "inconclusive_needs_more_cases";
  }
  if (winner === "mixed") {
    return "needs_more_surface_calibration";
  }
  if (winner === "old") {
    return "needs_more_surface_calibration";
  }
  if (delta >= 8 && newSystem.metrics.validationScore >= 72) {
    return "ready_for_shadow_mode";
  }
  return "needs_more_surface_calibration";
}

function buildComparisonSummary(
  winner: SurfacedValidationWinner,
  oldSystem: SurfacedSystemValidationResult,
  newSystem: SurfacedSystemValidationResult,
): { summary: string; notableDifferences: string[] } {
  const notableDifferences: string[] = [];
  if (newSystem.metrics.redundantNearbyCount < oldSystem.metrics.redundantNearbyCount) {
    notableDifferences.push("new adapter reduced nearby ladder clutter");
  }
  if (
    (newSystem.metrics.firstInteractionMissDistancePct ?? Number.MAX_SAFE_INTEGER) <
    (oldSystem.metrics.firstInteractionMissDistancePct ?? Number.MAX_SAFE_INTEGER)
  ) {
    notableDifferences.push("new adapter aligned more closely with the first forward interaction");
  }
  if (newSystem.metrics.anchorCount > 0 && oldSystem.metrics.anchorCount === 0) {
    notableDifferences.push("new adapter supplied an explicit deeper anchor context");
  }

  const summary =
    winner === "new"
      ? "The new surfaced adapter produced the more useful trader-facing surfaced ladder on this forward window."
      : winner === "old"
        ? "The old surfaced runtime output remained more practical on this forward window."
        : winner === "mixed"
          ? "The result was mixed: one path won on some surfaced-usefulness dimensions while the other still held advantages."
          : "The result was inconclusive on this case and needs more evidence.";

  return { summary, notableDifferences };
}

export function validateSurfacedOutputs(
  input: LevelSurfacedValidationInput,
  configs: {
    oldConfig?: LevelEngineConfig;
    newConfig?: LevelScoreConfig;
    surfacedConfig?: LevelSurfacedSelectionConfig;
  } = {},
): SurfacedValidationComparison {
  const oldConfig = configs.oldConfig ?? DEFAULT_LEVEL_ENGINE_CONFIG;
  const newConfig = configs.newConfig ?? LEVEL_SCORE_CONFIG;
  const surfacedConfig = configs.surfacedConfig ?? LEVEL_SURFACED_SELECTION_CONFIG;
  const oldOutput = buildOldOutput(input, oldConfig);
  const oldNormalized = normalizeOldPathOutput(oldOutput, input.currentPrice, 12);
  const oldLevels = mapOldSurfacedLevels(oldOutput, input.currentPrice);

  const newOutput = buildNewOutput(input, newConfig, surfacedConfig);
  const newNormalized = normalizeSurfacedSelectionOutput(newOutput.surfaced, 12);
  const newLevels = mapNewSurfacedLevels(newOutput.surfaced);

  const references = findReferenceFirstInteractions([...oldLevels, ...newLevels], input.forwardCandles);
  const oldSystem = summarizeSystem("old", oldNormalized, oldLevels, input, references);
  const newSystem = summarizeSystem("new", newNormalized, newLevels, input, references);
  const winner = winnerForScores(oldSystem.metrics.validationScore, newSystem.metrics.validationScore);
  const { summary, notableDifferences } = buildComparisonSummary(winner, oldSystem, newSystem);

  return {
    caseId: input.caseId ?? input.symbol.toUpperCase(),
    symbol: input.symbol.toUpperCase(),
    currentPrice: input.currentPrice,
    expectedBehaviorLabel: input.expectedBehaviorLabel,
    oldSystem,
    newSystem,
    winner,
    scoreDelta: Number((newSystem.metrics.validationScore - oldSystem.metrics.validationScore).toFixed(2)),
    summary,
    notableDifferences,
    migrationReadiness: migrationCategoryForCase(winner, oldSystem, newSystem),
  };
}

export function summarizeSurfacedValidationResults(
  results: SurfacedValidationComparison[],
): SurfacedValidationSummary {
  const oldWins = results.filter((result) => result.winner === "old").length;
  const newWins = results.filter((result) => result.winner === "new").length;
  const mixed = results.filter((result) => result.winner === "mixed").length;
  const inconclusive = results.filter((result) => result.winner === "inconclusive").length;
  const averageValidationScoreOld = Number(
    safeDivide(
      results.reduce((sum, result) => sum + result.oldSystem.metrics.validationScore, 0),
      results.length,
      0,
    ).toFixed(2),
  );
  const averageValidationScoreNew = Number(
    safeDivide(
      results.reduce((sum, result) => sum + result.newSystem.metrics.validationScore, 0),
      results.length,
      0,
    ).toFixed(2),
  );
  const casesWhereNewReducedClutter = results.filter(
    (result) => result.newSystem.metrics.redundantNearbyCount < result.oldSystem.metrics.redundantNearbyCount,
  ).length;
  const casesWhereNewImprovedFirstInteractionAlignment = results.filter(
    (result) =>
      (result.newSystem.metrics.firstInteractionMissDistancePct ?? Number.MAX_SAFE_INTEGER) <
      (result.oldSystem.metrics.firstInteractionMissDistancePct ?? Number.MAX_SAFE_INTEGER),
  ).length;
  const casesNeedingManualReview = results
    .filter((result) => result.winner === "mixed" || result.winner === "inconclusive" || Math.abs(result.scoreDelta) < 6)
    .map((result) => result.caseId);

  let migrationReadiness: SurfacedValidationMigrationCategory = "inconclusive_needs_more_cases";
  if (results.length >= 5) {
    if (newWins > oldWins && averageValidationScoreNew >= averageValidationScoreOld + 4) {
      migrationReadiness = "ready_for_shadow_mode";
    } else if (newWins >= oldWins * 2 && averageValidationScoreNew >= averageValidationScoreOld + 8 && mixed <= 1) {
      migrationReadiness = "ready_for_optional_runtime_flag";
    } else if (oldWins > newWins) {
      migrationReadiness = "needs_more_surface_calibration";
    } else if (mixed + inconclusive >= Math.ceil(results.length / 2)) {
      migrationReadiness = "inconclusive_needs_more_cases";
    } else {
      migrationReadiness = "needs_more_surface_calibration";
    }
  }

  return {
    totalCases: results.length,
    oldWins,
    newWins,
    mixed,
    inconclusive,
    averageValidationScoreOld,
    averageValidationScoreNew,
    casesWhereNewReducedClutter,
    casesWhereNewImprovedFirstInteractionAlignment,
    casesNeedingManualReview,
    migrationReadiness,
  };
}
