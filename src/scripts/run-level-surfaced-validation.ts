// 2026-04-18 01:20 AM America/Toronto
// Run a surfaced usefulness showdown between the old bucketed runtime output and the new surfaced selection adapter.

import type { Candle } from "../lib/market-data/candle-types.js";
import {
  summarizeSurfacedValidationResults,
  validateSurfacedOutputs,
  type LevelSurfacedValidationInput,
  type SurfacedValidationComparison,
} from "../lib/levels/level-surfaced-validation.js";
import type { LevelCandidate, LevelTouch, RawLevelCandidate } from "../lib/levels/level-types.js";
import { buildZoneBounds } from "../lib/levels/level-zone-utils.js";

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

function makeRawCandidate(symbol: string, overrides: Partial<RawLevelCandidate>): RawLevelCandidate {
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

function summarizeTouches(touches: LevelTouch[]) {
  const meaningful = touches.filter(
    (touch) =>
      touch.reactionMovePct >= 0.015 ||
      touch.volumeRatio >= 1.2 ||
      (touch.closedAwayFromLevel && (touch.wickRejectStrength >= 0.4 || touch.bodyRejectStrength >= 0.4)) ||
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
    averageReactionMovePct: reactionMoves.length > 0 ? reactionMoves.reduce((sum, value) => sum + value, 0) / reactionMoves.length : 0,
    bestVolumeRatio: volumeRatios.length > 0 ? Math.max(...volumeRatios) : 1,
    averageVolumeRatio: volumeRatios.length > 0 ? volumeRatios.reduce((sum, value) => sum + value, 0) / volumeRatios.length : 1,
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
      ? [makeTouch({ reactionType: "clean_break", reactionMovePct: 0.004, closedAwayFromLevel: false })]
      : stateProfile === "weak"
        ? [
            makeTouch({ reactionMovePct: 0.016, volumeRatio: 1.05 }),
            makeTouch({ reactionMovePct: 0.011, volumeRatio: 1.02 }),
            makeTouch({ reactionMovePct: 0.009, volumeRatio: 1 }),
          ]
        : stateProfile === "flipped"
          ? [makeTouch(), makeTouch({ reactionType: "reclaim" }), makeTouch({ timeframe: "4h" })]
          : [makeTouch(), makeTouch({ timeframe: "4h" }), makeTouch({ reactionType: "failed_break" })]);
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
    strongestReactionMovePct: overrides.strongestReactionMovePct ?? summary.strongestReactionMovePct,
    averageReactionMovePct: overrides.averageReactionMovePct ?? summary.averageReactionMovePct,
    bestVolumeRatio: overrides.bestVolumeRatio ?? summary.bestVolumeRatio,
    averageVolumeRatio: overrides.averageVolumeRatio ?? summary.averageVolumeRatio,
    cleanlinessStdDevPct: overrides.cleanlinessStdDevPct ?? (stateProfile === "weak" ? 0.006 : 0.0012),
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

function buildFixtures(): LevelSurfacedValidationInput[] {
  const start = Date.parse("2026-04-17T14:30:00Z");

  return [
    {
      caseId: "support-hold-near",
      symbol: "SPTH",
      currentPrice: 10,
      rawCandidates: [
        makeRawCandidate("SPTH", { id: "spth-s1", kind: "support", price: 9.94, timeframe: "daily", sourceType: "swing_low", reactionQuality: 0.82, rejectionScore: 0.79 }),
        makeRawCandidate("SPTH", { id: "spth-s2", kind: "support", price: 9.89, timeframe: "5m", sourceType: "swing_low", reactionQuality: 0.58, rejectionScore: 0.54 }),
        makeRawCandidate("SPTH", { id: "spth-r1", kind: "resistance", price: 10.22, timeframe: "4h", sourceType: "swing_high", reactionQuality: 0.7, rejectionScore: 0.68 }),
      ],
      newCandidates: [
        makeNewCandidate("SPTH", { id: "spth-new-s1", type: "support", price: 9.94, sourceTimeframes: ["daily", "4h"] }),
        makeNewCandidate("SPTH", { id: "spth-new-s2", type: "support", price: 9.55, sourceTimeframes: ["daily"], strongestReactionMovePct: 0.08, averageReactionMovePct: 0.05, bestVolumeRatio: 1.8, averageVolumeRatio: 1.5 }),
        makeNewCandidate("SPTH", { id: "spth-new-r1", type: "resistance", price: 10.22, sourceTimeframes: ["4h"] }),
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
      rawCandidates: [
        makeRawCandidate("RREJ", { id: "rrej-r1", kind: "resistance", price: 6.08, timeframe: "daily", sourceType: "swing_high", reactionQuality: 0.78, rejectionScore: 0.75 }),
        makeRawCandidate("RREJ", { id: "rrej-r2", kind: "resistance", price: 6.1, timeframe: "4h", sourceType: "swing_high", reactionQuality: 0.69, rejectionScore: 0.67 }),
        makeRawCandidate("RREJ", { id: "rrej-r3", kind: "resistance", price: 6.12, timeframe: "5m", sourceType: "swing_high", reactionQuality: 0.55, rejectionScore: 0.5 }),
        makeRawCandidate("RREJ", { id: "rrej-s1", kind: "support", price: 5.82, timeframe: "4h", sourceType: "swing_low", reactionQuality: 0.7, rejectionScore: 0.68 }),
      ],
      newCandidates: [
        makeNewCandidate("RREJ", { id: "rrej-new-r1", type: "resistance", price: 6.09, sourceTimeframes: ["daily", "4h"] }),
        makeNewCandidate("RREJ", { id: "rrej-new-r2", type: "resistance", price: 6.34, sourceTimeframes: ["daily"], strongestReactionMovePct: 0.09, averageReactionMovePct: 0.06 }),
        makeNewCandidate("RREJ", { id: "rrej-new-s1", type: "support", price: 5.82, sourceTimeframes: ["4h"] }),
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
      rawCandidates: [
        makeRawCandidate("CBRK", { id: "cbrk-r1", kind: "resistance", price: 4.05, timeframe: "daily", sourceType: "swing_high", reactionQuality: 0.76, rejectionScore: 0.72 }),
        makeRawCandidate("CBRK", { id: "cbrk-r2", kind: "resistance", price: 4.08, timeframe: "5m", sourceType: "swing_high", reactionQuality: 0.56, rejectionScore: 0.5 }),
        makeRawCandidate("CBRK", { id: "cbrk-s1", kind: "support", price: 3.88, timeframe: "4h", sourceType: "swing_low", reactionQuality: 0.66, rejectionScore: 0.63 }),
      ],
      newCandidates: [
        makeNewCandidate("CBRK", { id: "cbrk-new-r1", type: "resistance", price: 4.06, sourceTimeframes: ["daily", "4h"] }),
        makeNewCandidate("CBRK", { id: "cbrk-new-r2", type: "resistance", price: 4.34, sourceTimeframes: ["daily"], strongestReactionMovePct: 0.075, averageReactionMovePct: 0.05 }),
        makeNewCandidate("CBRK", { id: "cbrk-new-s1", type: "support", price: 3.89, sourceTimeframes: ["4h"] }),
      ],
      forwardCandles: buildForwardCandles(start, [
        { high: 4.03, low: 3.98, close: 4.01 },
        { high: 4.07, low: 4.0, close: 4.06 },
        { high: 4.14, low: 4.05, close: 4.12 },
        { high: 4.22, low: 4.1, close: 4.19 },
      ]),
      expectedBehaviorLabel: "clean breakout through resistance still counts as relevance",
    },
    {
      caseId: "weak-near-clutter-vs-real-level",
      symbol: "CLTR",
      currentPrice: 2,
      rawCandidates: [
        makeRawCandidate("CLTR", { id: "cltr-s1", kind: "support", price: 1.99, timeframe: "5m", sourceType: "swing_low", reactionQuality: 0.4, rejectionScore: 0.35, touchCount: 5 }),
        makeRawCandidate("CLTR", { id: "cltr-s2", kind: "support", price: 1.97, timeframe: "4h", sourceType: "swing_low", reactionQuality: 0.42, rejectionScore: 0.36, touchCount: 4 }),
        makeRawCandidate("CLTR", { id: "cltr-s3", kind: "support", price: 1.89, timeframe: "daily", sourceType: "swing_low", reactionQuality: 0.84, rejectionScore: 0.8, touchCount: 3 }),
        makeRawCandidate("CLTR", { id: "cltr-r1", kind: "resistance", price: 2.14, timeframe: "4h", sourceType: "swing_high", reactionQuality: 0.66, rejectionScore: 0.63 }),
      ],
      newCandidates: [
        makeNewCandidate("CLTR", { id: "cltr-new-s1", type: "support", price: 1.99, sourceTimeframes: ["5m"], stateProfile: "weak" }),
        makeNewCandidate("CLTR", { id: "cltr-new-s2", type: "support", price: 1.89, sourceTimeframes: ["daily", "4h"], strongestReactionMovePct: 0.07, averageReactionMovePct: 0.045, bestVolumeRatio: 1.9, averageVolumeRatio: 1.55 }),
        makeNewCandidate("CLTR", { id: "cltr-new-r1", type: "resistance", price: 2.14, sourceTimeframes: ["4h"] }),
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
      rawCandidates: [
        makeRawCandidate("ANCH", { id: "anch-s1", kind: "support", price: 11.72, timeframe: "daily", sourceType: "swing_low", reactionQuality: 0.8, rejectionScore: 0.76 }),
        makeRawCandidate("ANCH", { id: "anch-s2", kind: "support", price: 11.28, timeframe: "4h", sourceType: "swing_low", reactionQuality: 0.67, rejectionScore: 0.64 }),
        makeRawCandidate("ANCH", { id: "anch-r1", kind: "resistance", price: 12.28, timeframe: "4h", sourceType: "swing_high", reactionQuality: 0.68, rejectionScore: 0.65 }),
      ],
      newCandidates: [
        makeNewCandidate("ANCH", { id: "anch-new-s1", type: "support", price: 11.72, sourceTimeframes: ["daily", "4h"] }),
        makeNewCandidate("ANCH", { id: "anch-new-s2", type: "support", price: 10.95, sourceTimeframes: ["daily"], strongestReactionMovePct: 0.1, averageReactionMovePct: 0.07, bestVolumeRatio: 2.0, averageVolumeRatio: 1.7 }),
        makeNewCandidate("ANCH", { id: "anch-new-r1", type: "resistance", price: 12.28, sourceTimeframes: ["4h"] }),
      ],
      forwardCandles: buildForwardCandles(start, [
        { high: 12.02, low: 11.84, close: 11.88 },
        { high: 11.9, low: 11.7, close: 11.74 },
        { high: 11.76, low: 11.42, close: 11.46 },
        { high: 11.48, low: 10.97, close: 11.02 },
        { high: 11.18, low: 10.94, close: 11.12 },
      ]),
      expectedBehaviorLabel: "deeper anchor becomes relevant later without cluttering the near ladder",
    },
    {
      caseId: "broken-level-exclusion",
      symbol: "BRKN",
      currentPrice: 8,
      rawCandidates: [
        makeRawCandidate("BRKN", { id: "brkn-s1", kind: "support", price: 7.96, timeframe: "daily", sourceType: "swing_low", reactionQuality: 0.74, rejectionScore: 0.7 }),
        makeRawCandidate("BRKN", { id: "brkn-s2", kind: "support", price: 7.58, timeframe: "4h", sourceType: "swing_low", reactionQuality: 0.69, rejectionScore: 0.65 }),
        makeRawCandidate("BRKN", { id: "brkn-r1", kind: "resistance", price: 8.22, timeframe: "4h", sourceType: "swing_high", reactionQuality: 0.64, rejectionScore: 0.61 }),
      ],
      newCandidates: [
        makeNewCandidate("BRKN", { id: "brkn-new-s1", type: "support", price: 7.96, sourceTimeframes: ["daily"], stateProfile: "broken" }),
        makeNewCandidate("BRKN", { id: "brkn-new-s2", type: "support", price: 7.58, sourceTimeframes: ["4h", "daily"] }),
        makeNewCandidate("BRKN", { id: "brkn-new-r1", type: "resistance", price: 8.22, sourceTimeframes: ["4h"] }),
      ],
      forwardCandles: buildForwardCandles(start, [
        { high: 8.01, low: 7.92, close: 7.94 },
        { high: 7.96, low: 7.76, close: 7.8 },
        { high: 7.82, low: 7.58, close: 7.61 },
        { high: 7.71, low: 7.55, close: 7.68 },
      ]),
      expectedBehaviorLabel: "broken nearby support should not win just because it is closest",
    },
  ];
}

function formatLevel(level: SurfacedValidationComparison["oldSystem"]["surfacedOutput"]["nearestSupport"]): string {
  if (!level) {
    return "none";
  }

  const extras: string[] = [];
  if (typeof level.score === "number") {
    extras.push(`score=${level.score.toFixed(2)}`);
  }
  if (level.confidence !== undefined) {
    extras.push(`confidence=${level.confidence.toFixed(0)}`);
  }
  if (level.state) {
    extras.push(`state=${level.state}`);
  }
  if (level.bucket) {
    extras.push(`bucket=${level.bucket}`);
  }
  return `${level.price.toFixed(level.price >= 1 ? 2 : 4)}${extras.length > 0 ? ` [${extras.join(" | ")}]` : ""}`;
}

async function main(): Promise<void> {
  const results = buildFixtures().map((fixture) => validateSurfacedOutputs(fixture));
  const summary = summarizeSurfacedValidationResults(results);

  console.log("LEVEL SURFACED VALIDATION SHOWDOWN");
  console.log("");

  for (const result of results) {
    console.log(`CASE: ${result.caseId} | SYMBOL: ${result.symbol} | price=${result.currentPrice.toFixed(result.currentPrice >= 1 ? 2 : 4)}`);
    console.log(`OLD nearest support/resistance: ${formatLevel(result.oldSystem.surfacedOutput.nearestSupport)} / ${formatLevel(result.oldSystem.surfacedOutput.nearestResistance)}`);
    console.log(`NEW nearest support/resistance: ${formatLevel(result.newSystem.surfacedOutput.nearestSupport)} / ${formatLevel(result.newSystem.surfacedOutput.nearestResistance)}`);
    console.log(`Clutter: old=${result.oldSystem.metrics.redundantNearbyCount} | new=${result.newSystem.metrics.redundantNearbyCount}`);
    console.log(
      `Forward score: old=${result.oldSystem.metrics.forwardInteractionScore.toFixed(2)} | new=${result.newSystem.metrics.forwardInteractionScore.toFixed(2)}`,
    );
    console.log(
      `Validation score: old=${result.oldSystem.metrics.validationScore.toFixed(2)} | new=${result.newSystem.metrics.validationScore.toFixed(2)}`,
    );
    console.log(`Winner: ${result.winner} | readiness=${result.migrationReadiness}`);
    console.log(`Summary: ${result.summary}`);
    if (result.notableDifferences.length > 0) {
      console.log(`Notable: ${result.notableDifferences.join(" ; ")}`);
    }
    console.log("");
  }

  console.log("AGGREGATE SUMMARY");
  console.log(`Total cases: ${summary.totalCases}`);
  console.log(`Old wins: ${summary.oldWins}`);
  console.log(`New wins: ${summary.newWins}`);
  console.log(`Mixed: ${summary.mixed}`);
  console.log(`Inconclusive: ${summary.inconclusive}`);
  console.log(`Average validation score old: ${summary.averageValidationScoreOld.toFixed(2)}`);
  console.log(`Average validation score new: ${summary.averageValidationScoreNew.toFixed(2)}`);
  console.log(`Cases where new reduced clutter: ${summary.casesWhereNewReducedClutter}`);
  console.log(`Cases where new improved first interaction alignment: ${summary.casesWhereNewImprovedFirstInteractionAlignment}`);
  console.log(`Cases needing manual review: ${summary.casesNeedingManualReview.length > 0 ? summary.casesNeedingManualReview.join(", ") : "none"}`);
  console.log(`Migration readiness: ${summary.migrationReadiness}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
