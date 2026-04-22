import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeSurfacedValidationResults,
  validateSurfacedOutputs,
  type LevelSurfacedValidationInput,
} from "../lib/levels/level-surfaced-validation.js";
import type { Candle } from "../lib/market-data/candle-types.js";
import type { LevelCandidate, LevelTouch, RawLevelCandidate } from "../lib/levels/level-types.js";
import { buildZoneBounds } from "../lib/levels/level-zone-utils.js";

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

function makeRawCandidate(symbol: string, overrides: Partial<RawLevelCandidate>): RawLevelCandidate {
  return {
    id: `${symbol}-candidate-1`,
    symbol,
    price: 10,
    kind: "support",
    timeframe: "daily",
    sourceType: "swing_low",
    touchCount: 2,
    reactionScore: 1,
    reactionQuality: 0.7,
    rejectionScore: 0.65,
    displacementScore: 0.6,
    sessionSignificance: 0.52,
    followThroughScore: 0.62,
    gapContinuationScore: 0,
    repeatedReactionCount: 1,
    gapStructure: false,
    firstTimestamp: 1,
    lastTimestamp: 2,
    notes: [],
    ...overrides,
  };
}

function makeNewCandidate(symbol: string, overrides: Partial<LevelCandidate> = {}): LevelCandidate {
  const price = overrides.price ?? 10;
  const zone = buildZoneBounds(price);
  const touches = overrides.touches ?? [makeTouch(), makeTouch({ timeframe: "4h" }), makeTouch({ reactionType: "failed_break" })];
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
    roleFlipCount: overrides.roleFlipCount ?? 0,
    strongestReactionMovePct: overrides.strongestReactionMovePct ?? summary.strongestReactionMovePct,
    averageReactionMovePct: overrides.averageReactionMovePct ?? summary.averageReactionMovePct,
    bestVolumeRatio: overrides.bestVolumeRatio ?? summary.bestVolumeRatio,
    averageVolumeRatio: overrides.averageVolumeRatio ?? summary.averageVolumeRatio,
    cleanlinessStdDevPct: overrides.cleanlinessStdDevPct ?? 0.001,
    ageInBars: overrides.ageInBars ?? 20,
    barsSinceLastReaction: overrides.barsSinceLastReaction ?? 2,
    ...overrides,
  };
}

function buildForwardCandles(
  startTimestamp: number,
  bars: Array<{ high: number; low: number; close: number; open?: number }>,
): Candle[] {
  return bars.map((bar, index) => ({
    timestamp: startTimestamp + index * 5 * 60 * 1000,
    open: bar.open ?? bar.close,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: 10_000 + index * 1_000,
  }));
}

function makeValidationInput(overrides: Partial<LevelSurfacedValidationInput> = {}): LevelSurfacedValidationInput {
  const start = Date.parse("2026-04-17T14:30:00Z");

  return {
    caseId: "case-1",
    symbol: "TEST",
    currentPrice: 10,
    rawCandidates: [
      makeRawCandidate("TEST", { id: "test-s1", kind: "support", price: 9.92, timeframe: "daily", reactionQuality: 0.78, rejectionScore: 0.74 }),
      makeRawCandidate("TEST", { id: "test-r1", kind: "resistance", price: 10.12, timeframe: "4h", sourceType: "swing_high", reactionQuality: 0.72, rejectionScore: 0.7 }),
    ],
    newCandidates: [
      makeNewCandidate("TEST", { id: "test-new-s1", type: "support", price: 9.92, sourceTimeframes: ["daily", "4h"] }),
      makeNewCandidate("TEST", { id: "test-new-r1", type: "resistance", price: 10.12, sourceTimeframes: ["4h"] }),
    ],
    forwardCandles: buildForwardCandles(start, [
      { high: 10.03, low: 9.94, close: 9.97 },
      { high: 10.09, low: 9.92, close: 10.05 },
      { high: 10.16, low: 10.02, close: 10.08 },
    ]),
    expectedBehaviorLabel: "baseline",
    ...overrides,
  };
}

test("validation runs old surfaced output and new surfaced adapter on the same input", () => {
  const result = validateSurfacedOutputs(makeValidationInput());

  assert.equal(result.oldSystem.system, "old");
  assert.equal(result.newSystem.system, "new");
  assert.ok(result.oldSystem.surfacedOutput.nearestSupport);
  assert.ok(result.newSystem.surfacedOutput.nearestSupport);
});

test("hold, reject, and break all count as meaningful forward interaction when appropriate", () => {
  const holdResult = validateSurfacedOutputs(makeValidationInput());
  const breakResult = validateSurfacedOutputs(
    makeValidationInput({
      caseId: "break-case",
      rawCandidates: [
        makeRawCandidate("BRK", { id: "brk-r1", symbol: "BRK", kind: "resistance", price: 10.05, timeframe: "daily", sourceType: "swing_high" }),
      ],
      newCandidates: [
        makeNewCandidate("BRK", { id: "brk-new-r1", symbol: "BRK", type: "resistance", price: 10.05 }),
      ],
      currentPrice: 10,
      forwardCandles: buildForwardCandles(Date.parse("2026-04-17T14:30:00Z"), [
        { high: 10.06, low: 9.99, close: 10.04 },
        { high: 10.18, low: 10.03, close: 10.16 },
        { high: 10.24, low: 10.12, close: 10.22 },
      ]),
    }),
  );

  assert.ok(holdResult.newSystem.metrics.forwardInteractionScore > 0);
  assert.ok(breakResult.newSystem.metrics.forwardInteractionScore > 0);
  assert.ok(
    breakResult.newSystem.metrics.interactionResults.some(
      (result) => result.outcome === "broken" || result.outcome === "partial_respect",
    ),
  );
});

test("clutter penalty reduces score for redundant same-band levels", () => {
  const cluttered = validateSurfacedOutputs(
    makeValidationInput({
      caseId: "cluttered",
      rawCandidates: [
        makeRawCandidate("CLUT", { id: "clut-s1", symbol: "CLUT", kind: "support", price: 9.98, timeframe: "daily" }),
        makeRawCandidate("CLUT", { id: "clut-s2", symbol: "CLUT", kind: "support", price: 9.96, timeframe: "4h" }),
        makeRawCandidate("CLUT", { id: "clut-s3", symbol: "CLUT", kind: "support", price: 9.95, timeframe: "5m" }),
        makeRawCandidate("CLUT", { id: "clut-r1", symbol: "CLUT", kind: "resistance", price: 10.12, timeframe: "4h", sourceType: "swing_high" }),
      ],
      newCandidates: [
        makeNewCandidate("CLUT", { id: "clut-new-s1", symbol: "CLUT", type: "support", price: 9.96 }),
        makeNewCandidate("CLUT", { id: "clut-new-r1", symbol: "CLUT", type: "resistance", price: 10.12 }),
      ],
    }),
  );

  assert.ok(cluttered.oldSystem.metrics.redundantNearbyCount >= cluttered.newSystem.metrics.redundantNearbyCount);
  assert.ok(cluttered.oldSystem.metrics.ladderCleanlinessScore <= cluttered.newSystem.metrics.ladderCleanlinessScore);
});

test("first interaction alignment is scored correctly", () => {
  const result = validateSurfacedOutputs(
    makeValidationInput({
      caseId: "alignment",
      rawCandidates: [
        makeRawCandidate("ALGN", { id: "algn-s1", symbol: "ALGN", kind: "support", price: 9.82, timeframe: "daily" }),
        makeRawCandidate("ALGN", { id: "algn-r1", symbol: "ALGN", kind: "resistance", price: 10.3, timeframe: "4h", sourceType: "swing_high" }),
      ],
      newCandidates: [
        makeNewCandidate("ALGN", { id: "algn-new-s1", symbol: "ALGN", type: "support", price: 9.93 }),
        makeNewCandidate("ALGN", { id: "algn-new-r1", symbol: "ALGN", type: "resistance", price: 10.3 }),
      ],
      forwardCandles: buildForwardCandles(Date.parse("2026-04-17T14:30:00Z"), [
        { high: 10.01, low: 9.94, close: 9.96 },
        { high: 10.07, low: 9.93, close: 10.03 },
      ]),
    }),
  );

  assert.ok(result.newSystem.metrics.firstInteractionAlignmentScore >= result.oldSystem.metrics.firstInteractionAlignmentScore);
});

test("deeper anchor is evaluated separately from near price actionable levels", () => {
  const result = validateSurfacedOutputs(
    makeValidationInput({
      caseId: "anchor",
      rawCandidates: [
        makeRawCandidate("ANCH", { id: "anch-s1", symbol: "ANCH", kind: "support", price: 9.9, timeframe: "daily" }),
        makeRawCandidate("ANCH", { id: "anch-r1", symbol: "ANCH", kind: "resistance", price: 10.18, timeframe: "4h", sourceType: "swing_high" }),
      ],
      newCandidates: [
        makeNewCandidate("ANCH", { id: "anch-new-s1", symbol: "ANCH", type: "support", price: 9.9 }),
        makeNewCandidate("ANCH", { id: "anch-new-s2", symbol: "ANCH", type: "support", price: 8.7, strongestReactionMovePct: 0.08, averageReactionMovePct: 0.05 }),
        makeNewCandidate("ANCH", { id: "anch-new-r1", symbol: "ANCH", type: "resistance", price: 10.18 }),
      ],
      forwardCandles: buildForwardCandles(Date.parse("2026-04-17T14:30:00Z"), [
        { high: 10.0, low: 9.88, close: 9.91 },
        { high: 9.95, low: 8.76, close: 8.82 },
        { high: 8.94, low: 8.68, close: 8.84 },
      ]),
    }),
  );

  assert.ok(result.newSystem.metrics.anchorCount > 0);
  assert.ok(result.newSystem.metrics.anchorUsefulnessScore >= 3);
});

test("broken surfaced levels are penalized and winner calculation returns a concrete result", () => {
  const result = validateSurfacedOutputs(
    makeValidationInput({
      caseId: "broken",
      rawCandidates: [
        makeRawCandidate("BRKN", { id: "brkn-s1", symbol: "BRKN", kind: "support", price: 9.98, timeframe: "daily" }),
        makeRawCandidate("BRKN", { id: "brkn-r1", symbol: "BRKN", kind: "resistance", price: 10.22, timeframe: "4h", sourceType: "swing_high" }),
      ],
      newCandidates: [
        makeNewCandidate("BRKN", {
          id: "brkn-new-s1",
          symbol: "BRKN",
          type: "support",
          price: 9.98,
          touches: [makeTouch({ reactionType: "clean_break", reactionMovePct: 0.004, closedAwayFromLevel: false })],
          cleanBreakCount: 1,
          rejectionCount: 0,
          failedBreakCount: 0,
          meaningfulTouchCount: 0,
          touchCount: 1,
          averageReactionMovePct: 0.004,
          strongestReactionMovePct: 0.004,
        }),
        makeNewCandidate("BRKN", { id: "brkn-new-s2", symbol: "BRKN", type: "support", price: 9.62 }),
        makeNewCandidate("BRKN", { id: "brkn-new-r1", symbol: "BRKN", type: "resistance", price: 10.22 }),
      ],
      forwardCandles: buildForwardCandles(Date.parse("2026-04-17T14:30:00Z"), [
        { high: 10.0, low: 9.96, close: 9.97 },
        { high: 9.98, low: 9.68, close: 9.72 },
        { high: 9.75, low: 9.6, close: 9.65 },
      ]),
    }),
  );

  assert.ok(result.newSystem.metrics.structuralSanityScore >= result.oldSystem.metrics.structuralSanityScore);
  assert.ok(["old", "new"].includes(result.winner));
});

test("mixed and inconclusive outcomes are handled explicitly in batch summary", () => {
  const mixed = validateSurfacedOutputs(
    makeValidationInput({
      caseId: "mixed",
      rawCandidates: [
        makeRawCandidate("MIXD", { id: "mixd-s1", symbol: "MIXD", kind: "support", price: 9.9, timeframe: "daily" }),
        makeRawCandidate("MIXD", { id: "mixd-r1", symbol: "MIXD", kind: "resistance", price: 10.12, timeframe: "4h", sourceType: "swing_high" }),
      ],
      newCandidates: [
        makeNewCandidate("MIXD", { id: "mixd-new-s1", symbol: "MIXD", type: "support", price: 9.92 }),
        makeNewCandidate("MIXD", { id: "mixd-new-r1", symbol: "MIXD", type: "resistance", price: 10.12 }),
      ],
    }),
  );
  const inconclusive = validateSurfacedOutputs(
    makeValidationInput({
      caseId: "inconclusive",
      rawCandidates: [makeRawCandidate("INCN", { id: "incn-s1", symbol: "INCN", kind: "support", price: 8.5, timeframe: "daily" })],
      newCandidates: [makeNewCandidate("INCN", { id: "incn-new-s1", symbol: "INCN", type: "support", price: 8.5 })],
      currentPrice: 10,
      forwardCandles: buildForwardCandles(Date.parse("2026-04-17T14:30:00Z"), [
        { high: 10.1, low: 9.95, close: 10.02 },
        { high: 10.08, low: 9.97, close: 10.01 },
      ]),
    }),
  );
  const summary = summarizeSurfacedValidationResults([mixed, inconclusive]);

  assert.ok(["mixed", "inconclusive", "old", "new"].includes(mixed.winner));
  assert.equal(inconclusive.winner, "inconclusive");
  assert.equal(summary.totalCases, 2);
});
