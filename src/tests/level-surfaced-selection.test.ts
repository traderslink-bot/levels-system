import assert from "node:assert/strict";
import test from "node:test";

import { LEVEL_SURFACED_SELECTION_CONFIG } from "../lib/levels/level-surfaced-selection-config.js";
import { selectSurfacedLevels } from "../lib/levels/level-surfaced-selection.js";
import type { LevelScoreBreakdown, LevelTouch, RankedLevel, RankedLevelsOutput } from "../lib/levels/level-types.js";

function makeTouch(overrides: Partial<LevelTouch> = {}): LevelTouch {
  return {
    candleTimestamp: 1,
    timeframe: "daily",
    reactionType: "rejection",
    touchDistancePct: 0.001,
    reactionMovePct: 0.03,
    reactionMoveCandles: 2,
    volumeRatio: 1.4,
    closedAwayFromLevel: true,
    wickRejectStrength: 0.7,
    bodyRejectStrength: 0.5,
    ...overrides,
  };
}

function makeScoreBreakdown(overrides: Partial<LevelScoreBreakdown> = {}): LevelScoreBreakdown {
  return {
    timeframeScore: 12,
    touchScore: 10,
    reactionQualityScore: 10,
    reactionMagnitudeScore: 7,
    volumeScore: 6,
    cleanlinessScore: 8,
    roleFlipScore: 0,
    defenseScore: 4,
    recencyScore: 5,
    breakDamagePenalty: 0,
    overtestPenalty: 0,
    clusterPenalty: 0,
    structuralStrengthScore: 62,
    distanceToPriceScore: 24,
    freshReactionScore: 14,
    intradayPressureScore: 10,
    recentVolumeActivityScore: 9,
    currentInteractionScore: 0,
    activeRelevanceScore: 57,
    finalLevelScore: 61,
    ...overrides,
  };
}

function makeRankedLevel(overrides: Partial<RankedLevel> = {}): RankedLevel {
  const price = overrides.price ?? 10;
  const type = overrides.type ?? "support";
  const defaultState = overrides.state ?? "respected";
  const defaultStructural = overrides.structuralStrengthScore ?? 62;
  const defaultConfidence = overrides.confidence ?? 72;
  const scoreBreakdown = makeScoreBreakdown({
    structuralStrengthScore: defaultStructural,
    currentInteractionScore:
      overrides.scoreBreakdown?.currentInteractionScore ??
      (defaultState === "reclaimed" ? 7 : 0),
    ...overrides.scoreBreakdown,
  });

  return {
    id: overrides.id ?? "level-1",
    symbol: overrides.symbol ?? "TEST",
    type,
    price,
    zoneLow: overrides.zoneLow ?? price * 0.998,
    zoneHigh: overrides.zoneHigh ?? price * 1.002,
    sourceTimeframes: overrides.sourceTimeframes ?? ["daily"],
    originKinds: overrides.originKinds ?? ["swing_low"],
    touches: overrides.touches ?? [makeTouch()],
    touchCount: overrides.touchCount ?? 3,
    meaningfulTouchCount: overrides.meaningfulTouchCount ?? 3,
    rejectionCount: overrides.rejectionCount ?? 2,
    failedBreakCount: overrides.failedBreakCount ?? 1,
    cleanBreakCount: overrides.cleanBreakCount ?? 0,
    reclaimCount: overrides.reclaimCount ?? 0,
    roleFlipCount: overrides.roleFlipCount ?? 0,
    strongestReactionMovePct: overrides.strongestReactionMovePct ?? 0.05,
    averageReactionMovePct: overrides.averageReactionMovePct ?? 0.03,
    bestVolumeRatio: overrides.bestVolumeRatio ?? 1.6,
    averageVolumeRatio: overrides.averageVolumeRatio ?? 1.35,
    cleanlinessStdDevPct: overrides.cleanlinessStdDevPct ?? 0.001,
    ageInBars: overrides.ageInBars ?? 20,
    barsSinceLastReaction: overrides.barsSinceLastReaction ?? 3,
    structuralStrengthScore: defaultStructural,
    activeRelevanceScore: overrides.activeRelevanceScore ?? 57,
    finalLevelScore: overrides.finalLevelScore ?? 61,
    score: overrides.score ?? 61,
    rank: overrides.rank ?? 1,
    confidence: defaultConfidence,
    state: defaultState,
    isClusterRepresentative: overrides.isClusterRepresentative ?? true,
    clusterId: overrides.clusterId ?? null,
    explanation: overrides.explanation ?? "stub explanation",
    scoreBreakdown,
  };
}

function makeOutput(params: {
  currentPrice?: number;
  supports?: RankedLevel[];
  resistances?: RankedLevel[];
} = {}): RankedLevelsOutput {
  const currentPrice = params.currentPrice ?? 10;
  const supports = params.supports ?? [];
  const resistances = params.resistances ?? [];

  return {
    symbol: "TEST",
    currentPrice,
    supports,
    resistances,
    topSupport: supports[0],
    topResistance: resistances[0],
    computedAt: Date.now(),
  };
}

test("nearest structurally credible level is surfaced ahead of deeper but stronger distant level", () => {
  const result = selectSurfacedLevels(
    makeOutput({
      currentPrice: 10,
      supports: [
        makeRankedLevel({
          id: "near",
          price: 9.91,
          zoneLow: 9.88,
          zoneHigh: 9.94,
          structuralStrengthScore: 60,
          confidence: 70,
          rank: 2,
        }),
        makeRankedLevel({
          id: "deep",
          price: 8.6,
          zoneLow: 8.54,
          zoneHigh: 8.66,
          structuralStrengthScore: 89,
          confidence: 84,
          score: 88,
          rank: 1,
        }),
      ],
    }),
  );

  assert.equal(result.topActionableSupport?.id, "near");
  assert.equal(result.deeperSupportAnchor?.id, "deep");
});

test("very weak near price level does not beat a much stronger slightly farther level", () => {
  const result = selectSurfacedLevels(
    makeOutput({
      currentPrice: 10,
      supports: [
        makeRankedLevel({
          id: "weak-near",
          price: 9.95,
          zoneLow: 9.93,
          zoneHigh: 9.97,
          structuralStrengthScore: 35,
          confidence: 48,
          state: "weakened",
          score: 43,
          rank: 2,
        }),
        makeRankedLevel({
          id: "stronger-slightly-farther",
          price: 9.9,
          zoneLow: 9.87,
          zoneHigh: 9.93,
          structuralStrengthScore: 78,
          confidence: 80,
          score: 79,
          rank: 1,
        }),
      ],
    }),
  );

  assert.equal(result.topActionableSupport?.id, "stronger-slightly-farther");
  assert.ok(!result.surfacedSupports.some((level) => level.id === "weak-near"));
});

test("duplicate nearby levels are suppressed", () => {
  const result = selectSurfacedLevels(
    makeOutput({
      currentPrice: 10,
      resistances: [
        makeRankedLevel({
          id: "stronger-band",
          type: "resistance",
          price: 10.4,
          zoneLow: 10.37,
          zoneHigh: 10.43,
          structuralStrengthScore: 76,
          confidence: 79,
          rank: 1,
        }),
        makeRankedLevel({
          id: "weaker-band",
          type: "resistance",
          price: 10.43,
          zoneLow: 10.4,
          zoneHigh: 10.46,
          structuralStrengthScore: 61,
          confidence: 70,
          rank: 2,
        }),
      ],
    }),
  );

  assert.equal(result.surfacedResistances.length, 1);
  assert.equal(result.surfacedResistances[0]?.id, "stronger-band");
  assert.ok(
    result.suppressedNearbyLevels.some(
      (entry) => entry.level.id === "weaker-band" && entry.reason === "nearby_stronger_level",
    ),
  );
});

test("weakened and broken levels are penalized or excluded correctly", () => {
  const result = selectSurfacedLevels(
    makeOutput({
      currentPrice: 10,
      supports: [
        makeRankedLevel({
          id: "broken-near",
          price: 9.98,
          zoneLow: 9.96,
          zoneHigh: 10,
          structuralStrengthScore: 72,
          confidence: 75,
          state: "broken",
        }),
        makeRankedLevel({
          id: "healthy",
          price: 9.82,
          zoneLow: 9.79,
          zoneHigh: 9.85,
          structuralStrengthScore: 70,
          confidence: 76,
          state: "respected",
        }),
      ],
    }),
  );

  assert.equal(result.topActionableSupport?.id, "healthy");
  assert.ok(!result.surfacedSupports.some((level) => level.id === "broken-near"));
  assert.ok(
    result.suppressedNearbyLevels.some(
      (entry) => entry.level.id === "broken-near" && entry.reason === "broken_state",
    ),
  );
});

test("broken resistance near price is excluded from actionable surfaced resistance", () => {
  const result = selectSurfacedLevels(
    makeOutput({
      currentPrice: 10,
      resistances: [
        makeRankedLevel({
          id: "broken-resistance",
          type: "resistance",
          price: 10.04,
          zoneLow: 10.01,
          zoneHigh: 10.07,
          state: "broken",
          structuralStrengthScore: 76,
          confidence: 78,
        }),
        makeRankedLevel({
          id: "healthy-resistance",
          type: "resistance",
          price: 10.22,
          zoneLow: 10.19,
          zoneHigh: 10.25,
          state: "respected",
          structuralStrengthScore: 72,
          confidence: 77,
        }),
      ],
    }),
  );

  assert.equal(result.topActionableResistance?.id, "healthy-resistance");
  assert.ok(!result.surfacedResistances.some((level) => level.id === "broken-resistance"));
});

test("credible practical interaction level is favored ahead of a deeper stronger level for the first actionable slot", () => {
  const result = selectSurfacedLevels(
    makeOutput({
      currentPrice: 10,
      supports: [
        makeRankedLevel({
          id: "credible-near",
          price: 9.84,
          zoneLow: 9.81,
          zoneHigh: 9.87,
          structuralStrengthScore: 57,
          confidence: 68,
          rank: 2,
        }),
        makeRankedLevel({
          id: "deeper-stronger",
          price: 9.55,
          zoneLow: 9.5,
          zoneHigh: 9.6,
          structuralStrengthScore: 86,
          confidence: 84,
          rank: 1,
        }),
      ],
    }),
  );

  assert.equal(result.topActionableSupport?.id, "credible-near");
  assert.equal(result.deeperSupportAnchor?.id, "deeper-stronger");
});

test("one deeper anchor can be included without cluttering the surfaced ladder", () => {
  const result = selectSurfacedLevels(
    makeOutput({
      currentPrice: 10,
      supports: [
        makeRankedLevel({ id: "near-1", price: 9.92, zoneLow: 9.89, zoneHigh: 9.95, rank: 1 }),
        makeRankedLevel({ id: "near-2", price: 9.74, zoneLow: 9.71, zoneHigh: 9.77, rank: 2 }),
        makeRankedLevel({
          id: "deep-anchor",
          price: 8.4,
          zoneLow: 8.34,
          zoneHigh: 8.46,
          structuralStrengthScore: 88,
          confidence: 82,
          rank: 3,
        }),
      ],
    }),
  );

  assert.equal(result.surfacedSupports.length, 1);
  assert.ok(result.deeperSupportAnchor);
  assert.ok(["near-2", "deep-anchor"].includes(result.deeperSupportAnchor.id));
});

test("surfaced output is stable, ordered correctly, and behaves directionally", () => {
  const result = selectSurfacedLevels(
    makeOutput({
      currentPrice: 10,
      supports: [
        makeRankedLevel({ id: "support-near", price: 9.94, zoneLow: 9.91, zoneHigh: 9.97, rank: 2 }),
        makeRankedLevel({ id: "support-far", price: 9.7, zoneLow: 9.67, zoneHigh: 9.73, rank: 1 }),
        makeRankedLevel({
          id: "wrong-side-support",
          price: 10.15,
          zoneLow: 10.12,
          zoneHigh: 10.18,
          rank: 3,
        }),
      ],
      resistances: [
        makeRankedLevel({
          id: "resistance-near",
          type: "resistance",
          price: 10.08,
          zoneLow: 10.05,
          zoneHigh: 10.11,
          rank: 1,
        }),
        makeRankedLevel({
          id: "resistance-far",
          type: "resistance",
          price: 10.36,
          zoneLow: 10.33,
          zoneHigh: 10.39,
          rank: 2,
        }),
        makeRankedLevel({
          id: "wrong-side-resistance",
          type: "resistance",
          price: 9.8,
          zoneLow: 9.77,
          zoneHigh: 9.83,
          rank: 3,
        }),
      ],
    }),
  );

  assert.deepEqual(
    result.surfacedSupports.map((level) => level.id),
    ["support-near"],
  );
  assert.deepEqual(
    result.surfacedResistances.map((level) => level.id),
    ["resistance-near"],
  );
  assert.equal(result.deeperSupportAnchor?.id, "support-far");
  assert.equal(result.deeperResistanceAnchor?.id, "resistance-far");
  assert.ok(
    result.suppressedNearbyLevels.some(
      (entry) => entry.level.id === "wrong-side-support" && entry.reason === "wrong_side_of_price",
    ),
  );
  assert.ok(
    result.suppressedNearbyLevels.some(
      (entry) => entry.level.id === "wrong-side-resistance" && entry.reason === "wrong_side_of_price",
    ),
  );
});

test("flipped support can still surface when structurally sound and actionable", () => {
  const result = selectSurfacedLevels(
    makeOutput({
      currentPrice: 10,
      supports: [
        makeRankedLevel({
          id: "flipped-support",
          price: 9.9,
          zoneLow: 9.87,
          zoneHigh: 9.93,
          state: "flipped",
          roleFlipCount: 1,
          originKinds: ["role_flip"],
          structuralStrengthScore: 71,
          confidence: 78,
        }),
      ],
    }),
  );

  assert.equal(result.topActionableSupport?.id, "flipped-support");
});

test("selection explanations reflect actual surfaced drivers", () => {
  const result = selectSurfacedLevels(
    makeOutput({
      currentPrice: 10,
      resistances: [
        makeRankedLevel({
          id: "explained",
          type: "resistance",
          price: 10.06,
          zoneLow: 10.03,
          zoneHigh: 10.09,
          structuralStrengthScore: 74,
          confidence: 80,
          state: "respected",
        }),
        makeRankedLevel({
          id: "suppressed",
          type: "resistance",
          price: 10.09,
          zoneLow: 10.06,
          zoneHigh: 10.12,
          structuralStrengthScore: 58,
          confidence: 70,
          state: "weakened",
        }),
      ],
    }),
  );

  assert.match(result.topActionableResistance?.surfacedSelectionExplanation ?? "", /nearest actionable resistance|actionable resistance/i);
  assert.match(
    result.suppressedNearbyLevels.find((entry) => entry.level.id === "suppressed")?.explanation ?? "",
    /stronger nearby resistance/i,
  );
});

test("weak near-price clutter inside the practical interaction band is suppressed in favor of the cleaner representative", () => {
  const result = selectSurfacedLevels(
    makeOutput({
      currentPrice: 10,
      supports: [
        makeRankedLevel({
          id: "weak-immediate-1",
          price: 9.98,
          zoneLow: 9.96,
          zoneHigh: 10,
          structuralStrengthScore: 41,
          confidence: 52,
          state: "weakened",
          rank: 3,
        }),
        makeRankedLevel({
          id: "weak-immediate-2",
          price: 9.95,
          zoneLow: 9.93,
          zoneHigh: 9.97,
          structuralStrengthScore: 44,
          confidence: 54,
          state: "weakened",
          rank: 2,
        }),
        makeRankedLevel({
          id: "clean-near",
          price: 9.86,
          zoneLow: 9.83,
          zoneHigh: 9.89,
          structuralStrengthScore: 66,
          confidence: 76,
          state: "respected",
          rank: 1,
        }),
      ],
    }),
  );

  assert.equal(result.topActionableSupport?.id, "clean-near");
  assert.ok(result.surfacedSupports.length <= 1);
  assert.ok(result.suppressedNearbyLevels.length >= 2);
});

test("surfaced selection stays within configured maximum counts", () => {
  const supports = Array.from({ length: 6 }, (_, index) =>
    makeRankedLevel({
      id: `support-${index}`,
      price: 9.95 - index * 0.12,
      zoneLow: 9.92 - index * 0.12,
      zoneHigh: 9.98 - index * 0.12,
      rank: index + 1,
      structuralStrengthScore: 68 - index,
      confidence: 76,
    }),
  );
  const result = selectSurfacedLevels(makeOutput({ currentPrice: 10, supports }));

  assert.ok(result.surfacedSupports.length <= LEVEL_SURFACED_SELECTION_CONFIG.maximumSurfacedSupportCount);
});
