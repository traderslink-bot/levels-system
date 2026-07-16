// 2026-05-27 08:55 PM America/Toronto
// Compact comparable-output helpers for old/new runtime shadow checks.

import type { LevelEngineOutput, SourceTimeframe } from "./level-types.js";
import type { SurfacedSelectionResult } from "./level-surfaced-selection.js";

export type ComparableLevelSummary = {
  sourcePath: "old" | "surfaced_adapter";
  side: "support" | "resistance";
  price: number;
  zoneLow: number;
  zoneHigh: number;
  rank: number;
  nearestRank: number;
  score: number;
  strengthLabel?: string;
  bucket?: string;
  confidence?: number;
  state?: string;
  explanation?: string;
  sourceTimeframes: SourceTimeframe[];
};

export type ComparablePathOutput = {
  symbol: string;
  currentPrice: number;
  topSupport?: ComparableLevelSummary;
  nearestSupport?: ComparableLevelSummary;
  topResistance?: ComparableLevelSummary;
  nearestResistance?: ComparableLevelSummary;
  supports: ComparableLevelSummary[];
  resistances: ComparableLevelSummary[];
  visibleSupportCount: number;
  visibleResistanceCount: number;
  nearbyDuplicateCount: number;
  outputShape: string;
};

export type LevelRankingDifference = {
  changedTopSupport: boolean;
  changedTopResistance: boolean;
  changedNearestSupport: boolean;
  changedNearestResistance: boolean;
  supportRankChanges: Array<{ price: number; oldRank: number | null; newRank: number | null }>;
  resistanceRankChanges: Array<{ price: number; oldRank: number | null; newRank: number | null }>;
  duplicateSuppressionImproved: boolean;
  oldNearbyDuplicateCount: number;
  newNearbyDuplicateCount: number;
  noteworthyDisagreements: string[];
  incompatibilities: string[];
};

function sortNearest(
  levels: ComparableLevelSummary[],
  currentPrice: number,
  side: "support" | "resistance",
): ComparableLevelSummary[] {
  return [...levels]
    .filter((level) =>
      side === "support" ? level.zoneLow <= currentPrice : level.zoneHigh >= currentPrice,
    )
    .sort((left, right) => {
      const distance = (level: ComparableLevelSummary): number =>
        currentPrice < level.zoneLow
          ? level.zoneLow - currentPrice
          : currentPrice > level.zoneHigh
            ? currentPrice - level.zoneHigh
            : 0;
      return distance(left) - distance(right) || right.score - left.score;
    })
    .map((level, index) => ({
      ...level,
      nearestRank: index + 1,
    }));
}

function flattenOldSide(
  output: LevelEngineOutput,
  side: "support" | "resistance",
): Array<{ zone: LevelEngineOutput["majorSupport"][number]; bucket: string }> {
  if (side === "support") {
    return [
      ...output.majorSupport.map((zone) => ({ zone, bucket: "major" })),
      ...output.intermediateSupport.map((zone) => ({ zone, bucket: "intermediate" })),
      ...output.intradaySupport.map((zone) => ({ zone, bucket: "intraday" })),
    ];
  }

  return [
    ...output.majorResistance.map((zone) => ({ zone, bucket: "major" })),
    ...output.intermediateResistance.map((zone) => ({ zone, bucket: "intermediate" })),
    ...output.intradayResistance.map((zone) => ({ zone, bucket: "intraday" })),
  ];
}

export function normalizeOldPathOutput(
  output: LevelEngineOutput,
  currentPrice: number,
  maxComparableLevels = 8,
): ComparablePathOutput {
  const allSupports = flattenOldSide(output, "support")
    .map(({ zone, bucket }, index) => ({
      sourcePath: "old" as const,
      side: "support" as const,
      price: zone.representativePrice,
      zoneLow: zone.zoneLow,
      zoneHigh: zone.zoneHigh,
      rank: index + 1,
      nearestRank: index + 1,
      score: zone.strengthScore,
      strengthLabel: zone.strengthLabel,
      bucket,
      sourceTimeframes: zone.timeframeSources,
    }));
  const allResistances = flattenOldSide(output, "resistance")
    .map(({ zone, bucket }, index) => ({
      sourcePath: "old" as const,
      side: "resistance" as const,
      price: zone.representativePrice,
      zoneLow: zone.zoneLow,
      zoneHigh: zone.zoneHigh,
      rank: index + 1,
      nearestRank: index + 1,
      score: zone.strengthScore,
      strengthLabel: zone.strengthLabel,
      bucket,
      sourceTimeframes: zone.timeframeSources,
    }));
  const supports = allSupports.slice(0, maxComparableLevels);
  const resistances = allResistances.slice(0, maxComparableLevels);
  const nearestSupports = sortNearest(allSupports, currentPrice, "support");
  const nearestResistances = sortNearest(allResistances, currentPrice, "resistance");

  return {
    symbol: output.symbol,
    currentPrice,
    topSupport: supports[0],
    nearestSupport: nearestSupports[0],
    topResistance: resistances[0],
    nearestResistance: nearestResistances[0],
    supports,
    resistances,
    visibleSupportCount: allSupports.length,
    visibleResistanceCount: allResistances.length,
    nearbyDuplicateCount: 0,
    outputShape: "legacy_level_engine_output",
  };
}

export function normalizeSurfacedSelectionOutput(
  output: SurfacedSelectionResult,
  maxComparableLevels = 8,
): ComparablePathOutput {
  const allSupports = output.surfacedSupports.map((level, index) => ({
    sourcePath: "surfaced_adapter" as const,
    side: "support" as const,
    price: level.price,
    zoneLow: level.zoneLow,
    zoneHigh: level.zoneHigh,
    rank: index + 1,
    nearestRank: index + 1,
    score: level.surfacedSelectionScore,
    confidence: level.confidence,
    state: level.state,
    explanation: level.surfacedSelectionExplanation,
    sourceTimeframes: level.sourceTimeframes,
  }));
  const allResistances = output.surfacedResistances.map((level, index) => ({
    sourcePath: "surfaced_adapter" as const,
    side: "resistance" as const,
    price: level.price,
    zoneLow: level.zoneLow,
    zoneHigh: level.zoneHigh,
    rank: index + 1,
    nearestRank: index + 1,
    score: level.surfacedSelectionScore,
    confidence: level.confidence,
    state: level.state,
    explanation: level.surfacedSelectionExplanation,
    sourceTimeframes: level.sourceTimeframes,
  }));
  const supports = allSupports.slice(0, maxComparableLevels);
  const resistances = allResistances.slice(0, maxComparableLevels);
  const nearestSupports = sortNearest(allSupports, output.currentPrice, "support");
  const nearestResistances = sortNearest(allResistances, output.currentPrice, "resistance");

  return {
    symbol: output.symbol,
    currentPrice: output.currentPrice,
    topSupport: supports[0],
    nearestSupport: nearestSupports[0],
    topResistance: resistances[0],
    nearestResistance: nearestResistances[0],
    supports,
    resistances,
    visibleSupportCount: allSupports.length,
    visibleResistanceCount: allResistances.length,
    nearbyDuplicateCount: output.suppressedNearDuplicates.length,
    outputShape: "surfaced_selection_projection",
  };
}

function priceChanged(
  left: ComparableLevelSummary | undefined,
  right: ComparableLevelSummary | undefined,
): boolean {
  if (!left || !right) {
    return left !== right;
  }

  return Math.abs(left.price - right.price) > 0.0001;
}

export function computeComparisonDifferences(params: {
  oldPath: ComparablePathOutput;
  newPath: ComparablePathOutput;
  limitations?: string[];
}): LevelRankingDifference {
  const noteworthyDisagreements: string[] = [];

  if (priceChanged(params.oldPath.nearestSupport, params.newPath.nearestSupport)) {
    noteworthyDisagreements.push("Nearest support differs between old and projected paths.");
  }
  if (priceChanged(params.oldPath.nearestResistance, params.newPath.nearestResistance)) {
    noteworthyDisagreements.push("Nearest resistance differs between old and projected paths.");
  }

  return {
    changedTopSupport: priceChanged(params.oldPath.topSupport, params.newPath.topSupport),
    changedTopResistance: priceChanged(params.oldPath.topResistance, params.newPath.topResistance),
    changedNearestSupport: priceChanged(params.oldPath.nearestSupport, params.newPath.nearestSupport),
    changedNearestResistance: priceChanged(params.oldPath.nearestResistance, params.newPath.nearestResistance),
    supportRankChanges: [],
    resistanceRankChanges: [],
    duplicateSuppressionImproved: params.newPath.nearbyDuplicateCount < params.oldPath.nearbyDuplicateCount,
    oldNearbyDuplicateCount: params.oldPath.nearbyDuplicateCount,
    newNearbyDuplicateCount: params.newPath.nearbyDuplicateCount,
    noteworthyDisagreements,
    incompatibilities: params.limitations ?? [],
  };
}
