import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDefaultSurfacedShadowCases,
  evaluateSurfacedShadowBatch,
  summarizeSurfacedShadowResults,
  type SurfacedShadowCaseResult,
} from "../lib/levels/level-surfaced-shadow-evaluation.js";

function makeCaseResult(
  overrides: Partial<SurfacedShadowCaseResult> & {
    caseId: string;
    winner: "old" | "new" | "mixed" | "inconclusive";
    scoreDelta: number;
    oldScore: number;
    newScore: number;
    oldAlignment?: number;
    newAlignment?: number;
    oldActionable?: number;
    newActionable?: number;
    oldSanity?: number;
    newSanity?: number;
    oldAnchor?: number;
    newAnchor?: number;
    oldClutter?: number;
    newClutter?: number;
  },
): SurfacedShadowCaseResult {
  const oldAlignment = overrides.oldAlignment ?? 8;
  const newAlignment = overrides.newAlignment ?? 8;
  const oldActionable = overrides.oldActionable ?? 12;
  const newActionable = overrides.newActionable ?? 12;
  const oldSanity = overrides.oldSanity ?? 10;
  const newSanity = overrides.newSanity ?? 10;
  const oldAnchor = overrides.oldAnchor ?? 3;
  const newAnchor = overrides.newAnchor ?? 3;
  const oldClutter = overrides.oldClutter ?? 0;
  const newClutter = overrides.newClutter ?? 0;

  return {
    caseId: overrides.caseId,
    symbol: overrides.symbol ?? overrides.caseId.toUpperCase(),
    tags: overrides.tags ?? [],
    winner: overrides.winner,
    scoreDelta: overrides.scoreDelta,
    keyReason: overrides.keyReason ?? "reason",
    notableSurfacedDifference: overrides.notableSurfacedDifference ?? "difference",
    limitedEvidence: overrides.limitedEvidence ?? false,
    validation: {
      caseId: overrides.caseId,
      symbol: overrides.symbol ?? overrides.caseId.toUpperCase(),
      currentPrice: 10,
      oldSystem: {
        system: "old",
        surfacedOutput: {
          symbol: overrides.symbol ?? overrides.caseId.toUpperCase(),
          currentPrice: 10,
          topSupport: undefined,
          topResistance: undefined,
          nearestSupport: undefined,
          nearestResistance: undefined,
          supports: [],
          resistances: [],
          visibleSupportCount: 1,
          visibleResistanceCount: 1,
          nearbyDuplicateCount: oldClutter,
          outputShape: "old",
        },
        surfacedLevels: [],
        metrics: {
          actionableQualityScore: oldActionable,
          ladderCleanlinessScore: 10,
          forwardInteractionScore: 12,
          firstInteractionAlignmentScore: oldAlignment,
          structuralSanityScore: oldSanity,
          anchorUsefulnessScore: oldAnchor,
          validationScore: overrides.oldScore,
          actionableSupportCount: 1,
          actionableResistanceCount: 1,
          anchorCount: oldAnchor > 3 ? 1 : 0,
          redundantNearbyCount: oldClutter,
          interactionResults: [],
          notes: [],
        },
      },
      newSystem: {
        system: "new",
        surfacedOutput: {
          symbol: overrides.symbol ?? overrides.caseId.toUpperCase(),
          currentPrice: 10,
          topSupport: undefined,
          topResistance: undefined,
          nearestSupport: undefined,
          nearestResistance: undefined,
          supports: [],
          resistances: [],
          visibleSupportCount: 1,
          visibleResistanceCount: 1,
          nearbyDuplicateCount: newClutter,
          outputShape: "new",
        },
        surfacedLevels: [],
        metrics: {
          actionableQualityScore: newActionable,
          ladderCleanlinessScore: 10,
          forwardInteractionScore: 12,
          firstInteractionAlignmentScore: newAlignment,
          structuralSanityScore: newSanity,
          anchorUsefulnessScore: newAnchor,
          validationScore: overrides.newScore,
          actionableSupportCount: 1,
          actionableResistanceCount: 1,
          anchorCount: newAnchor > 3 ? 1 : 0,
          redundantNearbyCount: newClutter,
          interactionResults: [],
          notes: [],
        },
      },
      winner: overrides.winner,
      scoreDelta: overrides.scoreDelta,
      summary: "summary",
      notableDifferences: [],
      migrationReadiness: "ready_for_shadow_mode",
    },
  };
}

test("batch shadow evaluation preserves underlying validation results", () => {
  const report = evaluateSurfacedShadowBatch({
    cases: buildDefaultSurfacedShadowCases().slice(0, 2),
  });

  assert.equal(report.caseResults.length, 2);
  assert.equal(report.aggregateSummary.totalCases, 2);
  assert.ok(report.caseResults[0]?.validation.oldSystem.metrics.validationScore !== undefined);
});

test("summary aggregates winner counts and averages correctly", () => {
  const summary = summarizeSurfacedShadowResults([
    makeCaseResult({
      caseId: "new-win",
      winner: "new",
      scoreDelta: 10,
      oldScore: 60,
      newScore: 70,
      tags: ["support_case"],
      newActionable: 16,
      newAlignment: 12,
      newSanity: 13,
    }),
    makeCaseResult({
      caseId: "old-win",
      winner: "old",
      scoreDelta: -8,
      oldScore: 72,
      newScore: 64,
      tags: ["resistance_case"],
      oldActionable: 17,
      oldAlignment: 11,
    }),
    makeCaseResult({
      caseId: "mixed",
      winner: "mixed",
      scoreDelta: 2,
      oldScore: 68,
      newScore: 70,
      tags: ["support_case"],
    }),
  ]);

  assert.equal(summary.aggregateSummary.oldWins, 1);
  assert.equal(summary.aggregateSummary.newWins, 1);
  assert.equal(summary.aggregateSummary.mixed, 1);
  assert.equal(summary.aggregateSummary.averageValidationScoreOld, 66.67);
  assert.equal(summary.aggregateSummary.averageValidationScoreNew, 68);
});

test("category breakdowns group tagged cases and tolerate missing tags", () => {
  const summary = summarizeSurfacedShadowResults([
    makeCaseResult({
      caseId: "support-new",
      winner: "new",
      scoreDelta: 6,
      oldScore: 60,
      newScore: 66,
      tags: ["support_case", "near_price_case"],
    }),
    makeCaseResult({
      caseId: "untagged",
      winner: "inconclusive",
      scoreDelta: 0,
      oldScore: 50,
      newScore: 50,
      tags: [],
    }),
  ]);

  const supportBreakdown = summary.categoryBreakdowns.find(
    (breakdown) => breakdown.tag === "support_case",
  );
  const untaggedBreakdown = summary.categoryBreakdowns.find(
    (breakdown) => breakdown.tag === "untagged",
  );

  assert.equal(supportBreakdown?.newWins, 1);
  assert.equal(untaggedBreakdown?.inconclusive, 1);
});

test("manual review queue includes close deltas, old clear wins, contradictory results, and limited evidence", () => {
  const summary = summarizeSurfacedShadowResults([
    makeCaseResult({
      caseId: "close-delta",
      winner: "mixed",
      scoreDelta: 1,
      oldScore: 68,
      newScore: 69,
    }),
    makeCaseResult({
      caseId: "old-clear",
      winner: "old",
      scoreDelta: -10,
      oldScore: 75,
      newScore: 65,
      oldActionable: 18,
      newSanity: 14,
      oldSanity: 9,
    }),
    makeCaseResult({
      caseId: "limited",
      winner: "inconclusive",
      scoreDelta: 0,
      oldScore: 40,
      newScore: 40,
      limitedEvidence: true,
    }),
  ]);

  const reasons = summary.aggregateSummary.manualReviewQueue.map((item) => item.reason);
  assert.ok(reasons.includes("closest_score_delta"));
  assert.ok(reasons.includes("old_clear_win"));
  assert.ok(reasons.includes("contradictory_result"));
  assert.ok(reasons.includes("limited_evidence"));
});

test("biggest win sorting keeps strongest new and old deltas first", () => {
  const summary = summarizeSurfacedShadowResults([
    makeCaseResult({ caseId: "new-big", winner: "new", scoreDelta: 12, oldScore: 60, newScore: 72 }),
    makeCaseResult({ caseId: "new-small", winner: "new", scoreDelta: 5, oldScore: 63, newScore: 68 }),
    makeCaseResult({ caseId: "old-big", winner: "old", scoreDelta: -11, oldScore: 74, newScore: 63 }),
  ]);

  assert.equal(summary.aggregateSummary.biggestNewWins[0]?.caseId, "new-big");
  assert.equal(summary.aggregateSummary.biggestOldWins[0]?.caseId, "old-big");
});

test("broadly stronger new results move readiness toward more real case expansion", () => {
  const summary = summarizeSurfacedShadowResults([
    makeCaseResult({ caseId: "c1", winner: "new", scoreDelta: 8, oldScore: 61, newScore: 69, tags: ["support_case"] }),
    makeCaseResult({ caseId: "c2", winner: "new", scoreDelta: 7, oldScore: 60, newScore: 67, tags: ["resistance_case"] }),
    makeCaseResult({ caseId: "c3", winner: "new", scoreDelta: 9, oldScore: 58, newScore: 67, tags: ["near_price_case"] }),
    makeCaseResult({ caseId: "c4", winner: "new", scoreDelta: 6, oldScore: 62, newScore: 68, tags: ["anchor_case"] }),
    makeCaseResult({ caseId: "c5", winner: "mixed", scoreDelta: 2, oldScore: 67, newScore: 69, tags: ["support_case"] }),
    makeCaseResult({ caseId: "c6", winner: "new", scoreDelta: 5, oldScore: 64, newScore: 69, tags: ["resistance_case"] }),
    makeCaseResult({ caseId: "c7", winner: "old", scoreDelta: -3, oldScore: 70, newScore: 67, tags: ["broken_level_case"] }),
    makeCaseResult({ caseId: "c8", winner: "new", scoreDelta: 7, oldScore: 63, newScore: 70, tags: ["near_price_case"] }),
  ]);

  assert.equal(summary.aggregateSummary.migrationReadiness, "ready_for_more_real_case_expansion");
});
