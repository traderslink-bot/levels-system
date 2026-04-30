// 2026-04-18 02:20 AM America/Toronto
// Run replayable batch shadow evaluation for the old surfaced runtime path versus the new surfaced adapter.

import {
  buildDefaultSurfacedShadowCases,
  evaluateSurfacedShadowBatch,
  type SurfacedShadowCaseResult,
} from "../lib/levels/level-surfaced-shadow-evaluation.js";

function formatDelta(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function summarizeCategory(result: SurfacedShadowCaseResult): string {
  const oldSupport = result.validation.oldSystem.surfacedOutput.nearestSupport?.price;
  const newSupport = result.validation.newSystem.surfacedOutput.nearestSupport?.price;
  const oldResistance = result.validation.oldSystem.surfacedOutput.nearestResistance?.price;
  const newResistance = result.validation.newSystem.surfacedOutput.nearestResistance?.price;

  const shifts: string[] = [];
  if (oldSupport !== newSupport) {
    shifts.push(
      `support ${oldSupport?.toFixed(2) ?? "none"} -> ${newSupport?.toFixed(2) ?? "none"}`,
    );
  }
  if (oldResistance !== newResistance) {
    shifts.push(
      `resistance ${oldResistance?.toFixed(2) ?? "none"} -> ${newResistance?.toFixed(2) ?? "none"}`,
    );
  }
  if (
    result.validation.newSystem.metrics.redundantNearbyCount <
    result.validation.oldSystem.metrics.redundantNearbyCount
  ) {
    shifts.push("less clutter");
  }
  return shifts[0] ?? result.notableSurfacedDifference;
}

function recommendedNextStep(
  readiness: ReturnType<typeof evaluateSurfacedShadowBatch>["aggregateSummary"]["migrationReadiness"],
): string {
  if (readiness === "ready_for_optional_runtime_flag_exploration") {
    return "ready for optional runtime flag exploration";
  }
  if (readiness === "ready_for_more_real_case_expansion") {
    return "continue shadow evaluation on more real cached cases";
  }
  if (readiness === "blocked_by_old_path_strength_in_key_categories") {
    return "not ready, old path is still stronger in key categories";
  }
  if (readiness === "needs_surface_calibration") {
    return "calibrate surfaced adapter before any runtime flag discussion";
  }
  return "continue shadow evaluation";
}

async function main(): Promise<void> {
  const report = evaluateSurfacedShadowBatch({
    cases: buildDefaultSurfacedShadowCases(),
  });

  console.log("LEVEL SURFACED SHADOW EVALUATION");
  console.log("");

  for (const result of report.caseResults) {
    console.log(
      `${result.caseId} | ${result.symbol} | old=${result.validation.oldSystem.metrics.validationScore.toFixed(2)} | new=${result.validation.newSystem.metrics.validationScore.toFixed(2)} | winner=${result.winner} | delta=${formatDelta(result.scoreDelta)}`,
    );
    console.log(`reason: ${result.keyReason}`);
    console.log(`difference: ${summarizeCategory(result)}`);
    if (result.tags.length > 0) {
      console.log(`tags: ${result.tags.join(", ")}`);
    }
    console.log("");
  }

  console.log("AGGREGATE SUMMARY");
  console.log(`total cases: ${report.aggregateSummary.totalCases}`);
  console.log(`old wins: ${report.aggregateSummary.oldWins}`);
  console.log(`new wins: ${report.aggregateSummary.newWins}`);
  console.log(`mixed: ${report.aggregateSummary.mixed}`);
  console.log(`inconclusive: ${report.aggregateSummary.inconclusive}`);
  console.log(`average old score: ${report.aggregateSummary.averageValidationScoreOld.toFixed(2)}`);
  console.log(`average new score: ${report.aggregateSummary.averageValidationScoreNew.toFixed(2)}`);
  console.log(`mean score delta: ${formatDelta(report.aggregateSummary.averageScoreDelta)}`);
  console.log(
    `metric wins | clutter=${report.aggregateSummary.practicalMetricWins.clutterReduction.new}/${report.aggregateSummary.practicalMetricWins.clutterReduction.old} new/old | alignment=${report.aggregateSummary.practicalMetricWins.firstInteractionAlignment.new}/${report.aggregateSummary.practicalMetricWins.firstInteractionAlignment.old} | near-price=${report.aggregateSummary.practicalMetricWins.actionableNearPriceQuality.new}/${report.aggregateSummary.practicalMetricWins.actionableNearPriceQuality.old} | sanity=${report.aggregateSummary.practicalMetricWins.structuralSanity.new}/${report.aggregateSummary.practicalMetricWins.structuralSanity.old} | anchor=${report.aggregateSummary.practicalMetricWins.anchorUsefulness.new}/${report.aggregateSummary.practicalMetricWins.anchorUsefulness.old}`,
  );

  if (report.aggregateSummary.biggestNewWins.length > 0) {
    console.log(
      `biggest new wins: ${report.aggregateSummary.biggestNewWins.map((item) => `${item.caseId} (${formatDelta(item.scoreDelta)})`).join(", ")}`,
    );
  }
  if (report.aggregateSummary.biggestOldWins.length > 0) {
    console.log(
      `biggest old wins: ${report.aggregateSummary.biggestOldWins.map((item) => `${item.caseId} (${formatDelta(item.scoreDelta)})`).join(", ")}`,
    );
  }

  console.log("");
  console.log("CATEGORY BREAKDOWNS");
  for (const breakdown of report.categoryBreakdowns) {
    console.log(
      `${breakdown.tag}: total=${breakdown.totalCases} | new=${breakdown.newWins} | old=${breakdown.oldWins} | mixed=${breakdown.mixed} | inconclusive=${breakdown.inconclusive} | avgDelta=${formatDelta(breakdown.averageScoreDelta)}`,
    );
  }

  console.log("");
  console.log("MANUAL REVIEW QUEUE");
  if (report.aggregateSummary.manualReviewQueue.length === 0) {
    console.log("none");
  } else {
    for (const item of report.aggregateSummary.manualReviewQueue) {
      console.log(
        `${item.caseId} | ${item.reason} | winner=${item.winner} | delta=${formatDelta(item.scoreDelta)} | ${item.notes.join(" ; ")}`,
      );
    }
  }

  console.log("");
  console.log(`recommended next step: ${recommendedNextStep(report.aggregateSummary.migrationReadiness)}`);
  console.log(`migration readiness: ${report.aggregateSummary.migrationReadiness}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
