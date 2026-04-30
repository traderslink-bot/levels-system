import assert from "node:assert/strict";
import test from "node:test";

import {
  compareLevelRankingPaths,
  computeComparisonDifferences,
  normalizeOldPathOutput,
  normalizeSurfacedSelectionOutput,
  summarizeMigrationReadiness,
  type ComparablePathOutput,
} from "../lib/levels/level-ranking-comparison.js";
import type { SurfacedSelectionResult } from "../lib/levels/level-surfaced-selection.js";
import type { Candle } from "../lib/market-data/candle-types.js";
import type { LevelEngineOutput, RawLevelCandidate } from "../lib/levels/level-types.js";

function makeCandles(price: number, timeframeStepMs: number, bars = 30): Candle[] {
  const start = Date.parse("2026-04-17T13:30:00Z");

  return Array.from({ length: bars }, (_, index) => {
    const anchor = price + Math.sin(index / 3) * price * 0.015 + index * price * 0.0008;
    const close = Number(anchor.toFixed(4));
    const open = Number((close - price * 0.003).toFixed(4));
    const high = Number((Math.max(open, close) + price * 0.009 + (index % 5 === 0 ? price * 0.012 : 0)).toFixed(4));
    const low = Number((Math.min(open, close) - price * 0.009 - (index % 7 === 0 ? price * 0.011 : 0)).toFixed(4));

    return {
      timestamp: start + index * timeframeStepMs,
      open,
      high,
      low,
      close,
      volume: 1_000 + index * 25,
    };
  });
}

function makeRawCandidate(overrides: Partial<RawLevelCandidate> = {}): RawLevelCandidate {
  return {
    id: "candidate-1",
    symbol: "TEST",
    price: 10,
    kind: "support",
    timeframe: "daily",
    sourceType: "swing_low",
    touchCount: 2,
    reactionScore: 1,
    reactionQuality: 0.72,
    rejectionScore: 0.68,
    displacementScore: 0.62,
    sessionSignificance: 0.55,
    followThroughScore: 0.71,
    gapContinuationScore: 0,
    repeatedReactionCount: 1,
    gapStructure: false,
    firstTimestamp: 1,
    lastTimestamp: 2,
    notes: [],
    ...overrides,
  };
}

function makeComparablePath(overrides: Partial<ComparablePathOutput> = {}): ComparablePathOutput {
  return {
    symbol: "TEST",
    currentPrice: 10.5,
    topSupport: {
      sourcePath: "old",
      side: "support",
      price: 10,
      zoneLow: 9.97,
      zoneHigh: 10.03,
      rank: 1,
      nearestRank: 1,
    },
    nearestSupport: {
      sourcePath: "old",
      side: "support",
      price: 10,
      zoneLow: 9.97,
      zoneHigh: 10.03,
      rank: 1,
      nearestRank: 1,
    },
    topResistance: {
      sourcePath: "old",
      side: "resistance",
      price: 11.9,
      zoneLow: 11.87,
      zoneHigh: 11.93,
      rank: 1,
      nearestRank: 1,
    },
    nearestResistance: {
      sourcePath: "old",
      side: "resistance",
      price: 11.9,
      zoneLow: 11.87,
      zoneHigh: 11.93,
      rank: 1,
      nearestRank: 1,
    },
    supports: [
      {
        sourcePath: "old",
        side: "support",
        price: 10,
        zoneLow: 9.97,
        zoneHigh: 10.03,
        rank: 1,
        nearestRank: 1,
      },
    ],
    resistances: [
      {
        sourcePath: "old",
        side: "resistance",
        price: 11.9,
        zoneLow: 11.87,
        zoneHigh: 11.93,
        rank: 1,
        nearestRank: 1,
      },
    ],
    visibleSupportCount: 1,
    visibleResistanceCount: 1,
    nearbyDuplicateCount: 0,
    outputShape: "test",
    ...overrides,
  };
}

test("comparison module normalizes both paths and preserves new metadata", () => {
  const result = compareLevelRankingPaths({
    symbol: "TEST",
    currentPrice: 10.55,
    candlesByTimeframe: {
      daily: makeCandles(10, 24 * 60 * 60 * 1000),
      "4h": makeCandles(10.2, 4 * 60 * 60 * 1000),
      "5m": makeCandles(10.45, 5 * 60 * 1000, 60),
    },
    rawCandidates: [
      makeRawCandidate(),
      makeRawCandidate({
        id: "candidate-2",
        kind: "resistance",
        price: 11.9,
        timeframe: "4h",
        sourceType: "swing_high",
      }),
      makeRawCandidate({
        id: "candidate-3",
        kind: "resistance",
        price: 11.95,
        timeframe: "5m",
        sourceType: "opening_range_high",
      }),
    ],
  });

  assert.equal(result.oldPath.topSupport?.sourcePath, "old");
  assert.equal(result.newPath.topResistance?.sourcePath, "new");
  assert.ok(result.newPath.topResistance?.confidence !== undefined);
  assert.ok(result.newPath.topResistance?.state !== undefined);
  assert.ok(result.newPath.topResistance?.durabilityLabel !== undefined);
  assert.ok(result.newPath.topResistance?.explanation);
});

test("differences are detected correctly and missing optional score fields do not break comparison", () => {
  const oldPath = makeComparablePath({
    topResistance: {
      sourcePath: "old",
      side: "resistance",
      price: 12,
      zoneLow: 11.96,
      zoneHigh: 12.04,
      rank: 1,
      nearestRank: 1,
      score: undefined,
    },
    nearestResistance: {
      sourcePath: "old",
      side: "resistance",
      price: 12,
      zoneLow: 11.96,
      zoneHigh: 12.04,
      rank: 1,
      nearestRank: 1,
      score: undefined,
    },
    resistances: [
      {
        sourcePath: "old",
        side: "resistance",
        price: 12,
        zoneLow: 11.96,
        zoneHigh: 12.04,
        rank: 1,
        nearestRank: 1,
      },
      {
        sourcePath: "old",
        side: "resistance",
        price: 12.04,
        zoneLow: 12.01,
        zoneHigh: 12.07,
        rank: 2,
        nearestRank: 2,
      },
    ],
    nearbyDuplicateCount: 1,
  });
  const newPath = makeComparablePath({
    topResistance: {
      sourcePath: "new",
      side: "resistance",
      price: 12.32,
      zoneLow: 12.29,
      zoneHigh: 12.35,
      rank: 1,
      nearestRank: 1,
      score: 71,
      confidence: 74,
      state: "respected",
      explanation: "Strong daily resistance with elevated reaction volume",
    },
    nearestResistance: {
      sourcePath: "new",
      side: "resistance",
      price: 12.32,
      zoneLow: 12.29,
      zoneHigh: 12.35,
      rank: 1,
      nearestRank: 1,
      score: 71,
      confidence: 74,
      state: "respected",
      explanation: "Strong daily resistance with elevated reaction volume",
    },
    resistances: [
      {
        sourcePath: "new",
        side: "resistance",
        price: 12.32,
        zoneLow: 12.29,
        zoneHigh: 12.35,
        rank: 1,
        nearestRank: 1,
        score: 71,
        confidence: 74,
        state: "respected",
        explanation: "Strong daily resistance with elevated reaction volume",
      },
    ],
    nearbyDuplicateCount: 0,
  });

  const differences = computeComparisonDifferences({
    oldPath,
    newPath,
    limitations: [],
  });

  assert.equal(differences.changedTopResistance, true);
  assert.equal(differences.duplicateSuppressionImproved, true);
  assert.ok(differences.incompatibilities.length > 0);
});

test("migration summary flags output compatibility blockers and duplicate suppression improvement", () => {
  const oldPath = makeComparablePath({ nearbyDuplicateCount: 2 });
  const newPath = makeComparablePath({
    nearbyDuplicateCount: 0,
    outputShape: "ranked strength output",
  });
  const differences = computeComparisonDifferences({
    oldPath,
    newPath,
    limitations: [],
  });
  const summary = summarizeMigrationReadiness({
    oldPath,
    newPath,
    differences,
    limitations: [],
  });

  assert.equal(summary.category, "blocked_by_output_compatibility");
  assert.ok(summary.improvements.some((item) => item.includes("confidence")));
  assert.ok(summary.blockers.some((item) => item.includes("bucketed LevelEngineOutput")));
});

test("comparison does not silently hide missing old-path timeframe assumptions", () => {
  const result = compareLevelRankingPaths({
    symbol: "MISS",
    currentPrice: 10.2,
    candlesByTimeframe: {
      "5m": makeCandles(10.1, 5 * 60 * 1000, 50),
    },
    rawCandidates: [
      makeRawCandidate({
        symbol: "MISS",
        timeframe: "5m",
      }),
    ],
  });

  assert.ok(
    result.migrationReadiness.limitations.some(
      (item) => item.includes("Missing daily candles") || item.includes("Missing 4h candles"),
    ),
  );
});

test("normalizeOldPathOutput produces comparable summaries for bucketed output", () => {
  const output: LevelEngineOutput = {
    symbol: "TEST",
    generatedAt: 1,
    metadata: {
      providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10.5,
    },
    majorSupport: [
      {
        id: "s-1",
        symbol: "TEST",
        kind: "support",
        timeframeBias: "daily",
        zoneLow: 9.97,
        zoneHigh: 10.03,
        representativePrice: 10,
        strengthScore: 44,
        strengthLabel: "major",
        touchCount: 3,
        confluenceCount: 2,
        sourceTypes: ["swing_low"],
        timeframeSources: ["daily"],
        reactionQualityScore: 0.8,
        rejectionScore: 0.7,
        displacementScore: 0.6,
        sessionSignificanceScore: 0.5,
        followThroughScore: 0.6,
        gapContinuationScore: 0,
        sourceEvidenceCount: 2,
        firstTimestamp: 1,
        lastTimestamp: 2,
        sessionDate: undefined,
        isExtension: false,
        freshness: "fresh",
        notes: [],
      },
    ],
    majorResistance: [],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [],
    intradayResistance: [],
    extensionLevels: {
      support: [],
      resistance: [],
    },
    specialLevels: {},
  };

  const normalized = normalizeOldPathOutput(output, 10.5);
  assert.equal(normalized.topSupport?.bucket, "major");
  assert.equal(normalized.supports[0]?.sourcePath, "old");
});

test("normalizeSurfacedSelectionOutput keeps compare output focused on actionable levels", () => {
  const surfaced: SurfacedSelectionResult = {
    symbol: "TEST",
    currentPrice: 10.5,
    surfacedSupports: [
      {
        id: "support-1",
        symbol: "TEST",
        type: "support",
        price: 10.1,
        zoneLow: 10.05,
        zoneHigh: 10.15,
        sourceTimeframes: ["daily"],
        originKinds: ["swing_low"],
        touches: [],
        touchCount: 3,
        meaningfulTouchCount: 2,
        rejectionCount: 2,
        failedBreakCount: 1,
        cleanBreakCount: 0,
        reclaimCount: 0,
        roleFlipCount: 0,
        strongestReactionMovePct: 0.04,
        averageReactionMovePct: 0.03,
        bestVolumeRatio: 1.5,
        averageVolumeRatio: 1.3,
        cleanlinessStdDevPct: 0.001,
        ageInBars: 20,
        barsSinceLastReaction: 3,
        structuralStrengthScore: 68,
        activeRelevanceScore: 63,
        finalLevelScore: 66,
        score: 66,
        rank: 1,
        confidence: 78,
        state: "respected",
        isClusterRepresentative: true,
        clusterId: null,
        explanation: "Structural explanation",
        scoreBreakdown: {
          timeframeScore: 12,
          touchScore: 10,
          reactionQualityScore: 8,
          reactionMagnitudeScore: 7,
          volumeScore: 6,
          cleanlinessScore: 8,
          roleFlipScore: 0,
          defenseScore: 4,
          recencyScore: 5,
          breakDamagePenalty: 0,
          overtestPenalty: 0,
          clusterPenalty: 0,
          structuralStrengthScore: 68,
          distanceToPriceScore: 24,
          freshReactionScore: 12,
          intradayPressureScore: 8,
          recentVolumeActivityScore: 8,
          currentInteractionScore: 4,
          activeRelevanceScore: 63,
          finalLevelScore: 66,
        },
        selectionCategory: "actionable",
        surfacedSelectionScore: 73,
        surfacedSelectionBreakdown: {
          structuralQualityComponent: 30,
          proximityComponent: 28,
          actionableStateComponent: 10,
          ladderUsefulnessComponent: 5,
          anchorAdjustment: 0,
          redundancyPenalty: 0,
          surfacedSelectionScore: 73,
          distanceToPricePct: 0.038,
          proximityBand: "local",
        },
        surfacedSelectionExplanation: "Selected as nearest actionable support with strong structural score and clean zone behavior.",
        surfacedSelectionNotes: ["first actionable level"],
      },
    ],
    surfacedResistances: [],
    topActionableSupport: undefined,
    topActionableResistance: undefined,
    deeperSupportAnchor: {
      id: "support-anchor",
      symbol: "TEST",
      type: "support",
      price: 9.4,
      zoneLow: 9.35,
      zoneHigh: 9.45,
      sourceTimeframes: ["daily"],
      originKinds: ["swing_low"],
      touches: [],
      touchCount: 4,
      meaningfulTouchCount: 3,
      rejectionCount: 3,
      failedBreakCount: 1,
      cleanBreakCount: 0,
      reclaimCount: 0,
      roleFlipCount: 0,
      strongestReactionMovePct: 0.05,
      averageReactionMovePct: 0.04,
      bestVolumeRatio: 1.6,
      averageVolumeRatio: 1.4,
      cleanlinessStdDevPct: 0.001,
      ageInBars: 24,
      barsSinceLastReaction: 8,
      structuralStrengthScore: 82,
      activeRelevanceScore: 38,
      finalLevelScore: 71,
      score: 71,
      rank: 2,
      confidence: 80,
      state: "respected",
      isClusterRepresentative: true,
      clusterId: null,
      explanation: "Structural explanation",
      scoreBreakdown: {
        timeframeScore: 16,
        touchScore: 10,
        reactionQualityScore: 10,
        reactionMagnitudeScore: 8,
        volumeScore: 7,
        cleanlinessScore: 9,
        roleFlipScore: 0,
        defenseScore: 5,
        recencyScore: 4,
        breakDamagePenalty: 0,
        overtestPenalty: 0,
        clusterPenalty: 0,
        structuralStrengthScore: 82,
        distanceToPriceScore: 10,
        freshReactionScore: 5,
        intradayPressureScore: 3,
        recentVolumeActivityScore: 5,
        currentInteractionScore: 0,
        activeRelevanceScore: 38,
        finalLevelScore: 71,
      },
      selectionCategory: "anchor",
      surfacedSelectionScore: 69,
      surfacedSelectionBreakdown: {
        structuralQualityComponent: 35,
        proximityComponent: 8,
        actionableStateComponent: 10,
        ladderUsefulnessComponent: 7,
        anchorAdjustment: 9,
        redundancyPenalty: 0,
        surfacedSelectionScore: 69,
        distanceToPricePct: 0.105,
        proximityBand: "distant",
      },
      surfacedSelectionExplanation: "Selected as deeper anchor support because it kept a very strong structural score after nearer alternatives became weak or redundant.",
      surfacedSelectionNotes: ["deeper structural context"],
    },
    deeperResistanceAnchor: undefined,
    suppressedNearbyLevels: [],
    surfacedSelectionNotes: [],
    computedAt: 1,
  };

  const normalized = normalizeSurfacedSelectionOutput(surfaced);
  assert.equal(normalized.supports.length, 1);
  assert.equal(normalized.supports[0]?.sourcePath, "surfaced_adapter");
  assert.equal(normalized.visibleSupportCount, 1);
  assert.equal(normalized.topSupport?.price, 10.1);
});

test("normalizeSurfacedSelectionOutput does not promote a deeper anchor into top actionable resistance", () => {
  const surfaced: SurfacedSelectionResult = {
    symbol: "TEST",
    currentPrice: 0.235,
    surfacedSupports: [],
    surfacedResistances: [],
    topActionableSupport: undefined,
    topActionableResistance: undefined,
    deeperSupportAnchor: undefined,
    deeperResistanceAnchor: {
      id: "far-resistance-anchor",
      symbol: "TEST",
      type: "resistance",
      price: 23.98,
      zoneLow: 23.7,
      zoneHigh: 24.2,
      sourceTimeframes: ["daily"],
      originKinds: ["swing_high"],
      touches: [],
      touchCount: 4,
      meaningfulTouchCount: 3,
      rejectionCount: 3,
      failedBreakCount: 0,
      cleanBreakCount: 0,
      reclaimCount: 0,
      roleFlipCount: 0,
      strongestReactionMovePct: 0.08,
      averageReactionMovePct: 0.05,
      bestVolumeRatio: 1.8,
      averageVolumeRatio: 1.5,
      cleanlinessStdDevPct: 0.001,
      ageInBars: 18,
      barsSinceLastReaction: 4,
      structuralStrengthScore: 88,
      activeRelevanceScore: 20,
      finalLevelScore: 71,
      score: 71,
      rank: 1,
      confidence: 87,
      state: "respected",
      isClusterRepresentative: true,
      clusterId: null,
      explanation: "Structural explanation",
      scoreBreakdown: {
        timeframeScore: 16,
        touchScore: 10,
        reactionQualityScore: 10,
        reactionMagnitudeScore: 9,
        volumeScore: 7,
        cleanlinessScore: 9,
        roleFlipScore: 0,
        defenseScore: 5,
        recencyScore: 4,
        breakDamagePenalty: 0,
        overtestPenalty: 0,
        clusterPenalty: 0,
        structuralStrengthScore: 88,
        distanceToPriceScore: 0,
        freshReactionScore: 5,
        intradayPressureScore: 0,
        recentVolumeActivityScore: 3,
        currentInteractionScore: 0,
        activeRelevanceScore: 20,
        finalLevelScore: 71,
      },
      selectionCategory: "anchor",
      surfacedSelectionScore: 68,
      surfacedSelectionBreakdown: {
        structuralQualityComponent: 36,
        proximityComponent: 0,
        actionableStateComponent: 10,
        ladderUsefulnessComponent: 13,
        anchorAdjustment: 9,
        redundancyPenalty: 0,
        surfacedSelectionScore: 68,
        distanceToPricePct: 100.0,
        proximityBand: "distant",
      },
      surfacedSelectionExplanation:
        "Selected as deeper anchor resistance because it kept a very strong structural score after nearer alternatives became weak or redundant.",
      surfacedSelectionNotes: ["deeper structural context"],
    },
    suppressedNearbyLevels: [],
    surfacedSelectionNotes: [],
    computedAt: 1,
  };

  const normalized = normalizeSurfacedSelectionOutput(surfaced);
  assert.equal(normalized.topResistance, undefined);
  assert.equal(normalized.visibleResistanceCount, 0);
  assert.equal(normalized.resistances.length, 0);
});
