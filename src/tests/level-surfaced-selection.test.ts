import assert from "node:assert/strict";
import test from "node:test";

import { selectSurfacedLevels } from "../lib/levels/level-surfaced-selection.js";
import { normalizeSurfacedSelectionOutput } from "../lib/levels/level-ranking-comparison.js";
import type { SurfacedLevelSelection } from "../lib/levels/level-surfaced-selection.js";
import type {
  LevelScoreBreakdown,
  RankedLevel,
  RankedLevelsOutput,
} from "../lib/levels/level-types.js";

function scoreBreakdown(score: number): LevelScoreBreakdown {
  return {
    timeframeScore: 0,
    touchScore: 0,
    reactionQualityScore: 0,
    reactionMagnitudeScore: 0,
    volumeScore: 0,
    cleanlinessScore: 0,
    roleFlipScore: 0,
    defenseScore: 0,
    recencyScore: 0,
    overtestPenalty: 0,
    clusterPenalty: 0,
    structuralStrengthScore: score,
    distanceToPriceScore: 0,
    freshReactionScore: 0,
    intradayPressureScore: 0,
    recentVolumeActivityScore: 0,
    currentInteractionScore: 0,
    activeRelevanceScore: score,
    finalLevelScore: score,
  };
}

function rankedLevel(params: {
  id: string;
  price: number;
  type?: RankedLevel["type"];
  score?: number;
  sourceTimeframes?: RankedLevel["sourceTimeframes"];
  zoneLow?: number;
  zoneHigh?: number;
}): RankedLevel {
  const score = params.score ?? 50;
  return {
    id: params.id,
    symbol: "TEST",
    type: params.type ?? "support",
    price: params.price,
    zoneLow: params.zoneLow ?? params.price * 0.9975,
    zoneHigh: params.zoneHigh ?? params.price * 1.0025,
    sourceTimeframes: params.sourceTimeframes ?? ["5m"],
    originKinds: [params.type === "resistance" ? "swing_high" : "swing_low"],
    touches: [],
    touchCount: 1,
    meaningfulTouchCount: 1,
    rejectionCount: 1,
    failedBreakCount: 0,
    cleanBreakCount: 0,
    reclaimCount: 0,
    roleFlipCount: 0,
    strongestReactionMovePct: 0.02,
    averageReactionMovePct: 0.02,
    bestVolumeRatio: 1.2,
    averageVolumeRatio: 1.1,
    cleanlinessStdDevPct: 0.001,
    ageInBars: 1,
    barsSinceLastReaction: 1,
    structuralStrengthScore: score,
    activeRelevanceScore: score,
    finalLevelScore: score,
    score,
    rank: 1,
    confidence: 50,
    state: "fresh",
    isClusterRepresentative: true,
    clusterId: params.id,
    explanation: "fixture",
    scoreBreakdown: scoreBreakdown(score),
  };
}

function rankedOutput(
  supports: RankedLevel[],
  resistances: RankedLevel[] = [],
): RankedLevelsOutput {
  return {
    symbol: "TEST",
    currentPrice: 10,
    supports,
    resistances,
    topSupport: supports[0],
    topResistance: resistances[0],
    computedAt: 1,
  };
}

test("surfaced path keeps every unique row when there are at most twelve", () => {
  const prices = [9.9, 9.6, 9.2, 8.8, 8.4, 8, 7.6, 7.2, 6.7, 5];
  const output = selectSurfacedLevels(
    rankedOutput(prices.map((price, index) => rankedLevel({
      id: `support-${index}`,
      price,
    }))),
  );

  assert.equal(output.surfacedSupports.length, prices.length);
  assert.deepEqual(
    output.surfacedSupports.map((level) => level.price),
    prices,
  );
  assert.equal(output.surfacedSupports.some((level) => level.price === 5), true);
  assert.equal(output.diagnostics.rankedSupportCount, prices.length);
});

test("surfaced selection relies on evidence clustering instead of merging by current-price distance", () => {
  const weakerNearer = rankedLevel({ id: "weaker-nearer", price: 9.9, score: 45 });
  const strongerNearby = rankedLevel({
    id: "stronger-nearby",
    price: 9.82,
    score: 75,
    sourceTimeframes: ["daily"],
  });
  const output = selectSurfacedLevels(rankedOutput([weakerNearer, strongerNearby]));

  assert.deepEqual(
    output.surfacedSupports.map((level) => level.id),
    ["weaker-nearer", "stronger-nearby"],
  );
  assert.deepEqual(output.suppressedNearDuplicates, []);
});

test("large inventory reserves nearest rows and samples the full detected range", () => {
  const prices = Array.from({ length: 20 }, (_, index) => 9.8 - index * 0.4);
  const levels = prices.map((price, index) => rankedLevel({
    id: `coverage-${index}`,
    price,
    sourceTimeframes: index === 18 ? ["daily"] : ["5m"],
  }));
  const output = selectSurfacedLevels(
    rankedOutput(levels),
  );

  assert.equal(output.surfacedSupports.length, 12);
  assert.deepEqual(
    output.surfacedSupports.slice(0, 4).map((level) => level.price),
    prices.slice(0, 4),
  );
  assert.equal(output.surfacedSupports.at(-1)?.price, prices.at(-1));
  assert.equal(output.surfacedSupports.at(-1)?.selectionCategory, "anchor");
  assert.ok(output.surfacedSupports.some((level) => level.sourceTimeframes.includes("daily")));
  assert.ok(output.surfacedSupports.some((level) => level.price < 5));
});

test("far continuation levels remain visible because percentages allocate no hard boundary", () => {
  const distances = [0.02, 0.1, 0.25, 0.55, 1];
  const levels = distances.map((distance, index) => rankedLevel({
    id: `continuation-${index}`,
    type: "resistance",
    price: 10 * (1 + distance),
    sourceTimeframes: ["daily"],
  }));
  const output = selectSurfacedLevels(rankedOutput([], levels));

  assert.deepEqual(
    output.surfacedResistances.map((level) => level.id),
    levels.map((level) => level.id),
  );
});

test("a current-price interaction area cannot occupy both support and resistance", () => {
  const sharedSupport = rankedLevel({
    id: "shared-support",
    price: 10,
    type: "support",
    score: 75,
    sourceTimeframes: ["4h"],
    zoneLow: 9.95,
    zoneHigh: 10.05,
  });
  const sharedResistance = rankedLevel({
    id: "shared-resistance",
    price: 10,
    type: "resistance",
    score: 60,
    sourceTimeframes: ["5m"],
    zoneLow: 9.95,
    zoneHigh: 10.05,
  });
  const nextResistance = rankedLevel({
    id: "next-resistance",
    price: 10.3,
    type: "resistance",
  });
  const input = rankedOutput([sharedSupport], [sharedResistance, nextResistance]);
  input.currentPrice = 10.01;

  const output = selectSurfacedLevels(input);

  assert.deepEqual(output.surfacedSupports.map((level) => level.id), ["shared-support"]);
  assert.deepEqual(output.surfacedResistances.map((level) => level.id), ["next-resistance"]);
  assert.equal(
    output.suppressedNearDuplicates.some((level) => level.id === "shared-resistance"),
    true,
  );
});

test("comparison nearest and visible count use the full inventory beyond twelve rows", () => {
  const ranked = Array.from({ length: 15 }, (_, index) => rankedLevel({
    id: `normalizer-${index}`,
    price: 5 + index * 0.35,
    score: 100 - index,
  }));
  const surfaced = ranked.map((level): SurfacedLevelSelection => ({
    ...level,
    selectionCategory: "actionable",
    surfacedSelectionScore: level.score,
    surfacedSelectionExplanation: level.explanation,
    surfacedSelectionNotes: [],
    durabilityLabel: "tested",
  }));
  const comparable = normalizeSurfacedSelectionOutput({
    symbol: "TEST",
    currentPrice: 10,
    surfacedSupports: surfaced,
    surfacedResistances: [],
    deeperSupportAnchor: surfaced.at(-1),
    suppressedNearDuplicates: [],
    diagnostics: {
      rankedSupportCount: surfaced.length,
      rankedResistanceCount: 0,
      surfacedSupportCount: surfaced.length,
      surfacedResistanceCount: 0,
    },
  }, 12);

  assert.equal(comparable.supports.length, 12);
  assert.equal(comparable.visibleSupportCount, 15);
  assert.equal(comparable.nearestSupport?.price, surfaced.at(-1)?.price);
});
