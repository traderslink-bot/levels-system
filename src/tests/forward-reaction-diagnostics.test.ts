import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import {
  classifyForwardLevelDiagnostic,
  type ForwardLevelDiagnosticState,
} from "../lib/validation/forward-reaction-diagnostics.js";
import type { ForwardReactionLevelResult } from "../lib/validation/forward-reaction-validator.js";

function candle(timestamp: number, open: number, high: number, low: number, close: number, volume = 100000): Candle {
  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume,
  };
}

function level(overrides: Partial<ForwardReactionLevelResult> = {}): ForwardReactionLevelResult {
  return {
    zoneId: "R1",
    kind: "resistance",
    source: "surfaced",
    surfacedBucket: "5m",
    timeframeBias: "5m",
    strengthLabel: "strong",
    strengthScore: 24,
    touchCount: 3,
    confluenceCount: 2,
    sourceEvidenceCount: 2,
    timeframeSources: ["5m"],
    sourceTypes: ["swing_high"],
    reactionQualityScore: 0.55,
    rejectionScore: 0.42,
    followThroughScore: 0.55,
    displacementScore: 0.4,
    representativePrice: 1,
    distanceBand: "near",
    outcome: "broken",
    touched: true,
    useful: false,
    respected: false,
    partialRespected: false,
    broken: true,
    brokeAfterPartial: false,
    closestApproachPct: 0,
    firstTouchTimestamp: 1,
    resolutionTimestamp: 1,
    maxFavorableExcursionPct: 0,
    maxAdverseExcursionPct: 0.02,
    volumeContext: {
      reliability: "reliable",
      label: "normal",
      touchVolume: 100000,
      baselineAverageVolume: 100000,
      relativeVolumeRatio: 1,
      baselineBars: 20,
      reason: "test",
    },
    ...overrides,
  };
}

function assertState(
  result: ReturnType<typeof classifyForwardLevelDiagnostic>,
  state: ForwardLevelDiagnosticState,
): void {
  assert.equal(result.state, state);
}

test("classifyForwardLevelDiagnostic marks high-volume through-move as consumed by momentum", () => {
  const result = classifyForwardLevelDiagnostic({
    level: level({
      volumeContext: {
        reliability: "reliable",
        label: "heavy",
        touchVolume: 400000,
        baselineAverageVolume: 100000,
        relativeVolumeRatio: 4,
        baselineBars: 20,
        reason: "test",
      },
    }),
    resolutionCandles: [
      candle(1, 0.98, 1.03, 0.97, 1.02),
      candle(2, 1.02, 1.08, 1.01, 1.07),
    ],
  });

  assertState(result, "consumed_by_momentum");
  assert.equal(result.confidence, "high");
  assert.equal(result.maxAdverseExcursionPct, 0.08);
});

test("classifyForwardLevelDiagnostic marks soft reused levels as over-tested", () => {
  const result = classifyForwardLevelDiagnostic({
    level: level({
      touchCount: 24,
      sourceEvidenceCount: 7,
      rejectionScore: 0.22,
      followThroughScore: 0.38,
      volumeContext: {
        reliability: "reliable",
        label: "normal",
        touchVolume: 100000,
        baselineAverageVolume: 100000,
        relativeVolumeRatio: 1,
        baselineBars: 20,
        reason: "test",
      },
    }),
    resolutionCandles: [
      candle(1, 0.98, 1.02, 0.96, 1.01),
      candle(2, 1.01, 1.04, 0.99, 1.03),
    ],
  });

  assertState(result, "over_tested");
  assert.match(result.reasons.join(" "), /heavily reused/);
});

test("classifyForwardLevelDiagnostic keeps tiny breaks as testing", () => {
  const result = classifyForwardLevelDiagnostic({
    level: level({
      maxAdverseExcursionPct: 0.006,
    }),
    resolutionCandles: [
      candle(1, 0.99, 1.005, 0.98, 1.004),
      candle(2, 1.004, 1.008, 0.99, 1.006),
    ],
  });

  assertState(result, "testing");
  assert.equal(result.confidence, "watch");
});

test("classifyForwardLevelDiagnostic separates fresh, respected, and unresolved levels", () => {
  assertState(
    classifyForwardLevelDiagnostic({
      level: level({
        outcome: "untouched",
        touched: false,
        broken: false,
        closestApproachPct: 0.08,
        volumeContext: {
          reliability: "unavailable",
          label: "unknown",
          touchVolume: null,
          baselineAverageVolume: null,
          relativeVolumeRatio: null,
          baselineBars: 0,
          reason: "level was not touched",
        },
      }),
    }),
    "fresh",
  );

  assertState(
    classifyForwardLevelDiagnostic({
      level: level({
        outcome: "respected",
        useful: true,
        respected: true,
        broken: false,
        maxFavorableExcursionPct: 0.03,
      }),
    }),
    "respected",
  );

  assertState(
    classifyForwardLevelDiagnostic({
      level: level({
        outcome: "touched_no_resolution",
        broken: false,
      }),
    }),
    "testing",
  );
});

test("classifyForwardLevelDiagnostic tags weak 5m respected levels as active intraday references", () => {
  const result = classifyForwardLevelDiagnostic({
    level: level({
      strengthLabel: "weak",
      strengthScore: 8,
      timeframeSources: ["5m"],
      sourceTypes: ["premarket_high"],
      outcome: "respected",
      useful: true,
      respected: true,
      broken: false,
      maxFavorableExcursionPct: 0.04,
      maxAdverseExcursionPct: 0,
    }),
    resolutionCandles: [
      candle(1, 0.99, 1.01, 0.98, 1),
      candle(2, 1, 1.01, 0.94, 0.96),
    ],
  });

  assertState(result, "respected");
  assert.deepEqual(result.tags, ["active_intraday_reference"]);
});

test("classifyForwardLevelDiagnostic does not tag higher-timeframe or unresolved intraday levels as active references", () => {
  const higherTimeframe = classifyForwardLevelDiagnostic({
    level: level({
      strengthLabel: "weak",
      timeframeSources: ["4h"],
      sourceTypes: ["swing_high"],
      outcome: "respected",
      useful: true,
      respected: true,
      broken: false,
      maxFavorableExcursionPct: 0.06,
    }),
  });
  const unresolvedFiveMinute = classifyForwardLevelDiagnostic({
    level: level({
      strengthLabel: "weak",
      timeframeSources: ["5m"],
      sourceTypes: ["premarket_high"],
      outcome: "touched_no_resolution",
      touched: true,
      useful: false,
      respected: false,
      broken: false,
      maxFavorableExcursionPct: 0.006,
    }),
  });

  assert.deepEqual(higherTimeframe.tags, []);
  assert.deepEqual(unresolvedFiveMinute.tags, []);
});

test("classifyForwardLevelDiagnostic tags single-touch higher-timeframe weak references separately", () => {
  const result = classifyForwardLevelDiagnostic({
    level: level({
      strengthLabel: "weak",
      strengthScore: 9,
      timeframeSources: ["4h"],
      sourceTypes: ["swing_high"],
      touchCount: 1,
      sourceEvidenceCount: 1,
      followThroughScore: 0.62,
      outcome: "respected",
      useful: true,
      respected: true,
      broken: false,
      maxFavorableExcursionPct: 0.04,
      maxAdverseExcursionPct: 0.01,
      volumeContext: {
        reliability: "watch",
        label: "unknown",
        touchVolume: null,
        baselineAverageVolume: null,
        relativeVolumeRatio: null,
        baselineBars: 0,
        reason: "test",
      },
    }),
    resolutionCandles: [
      candle(1, 1, 1.01, 0.99, 1),
      candle(2, 1, 1.01, 0.95, 0.96),
    ],
  });

  assertState(result, "respected");
  assert.deepEqual(result.tags, ["single_touch_higher_timeframe_reference"]);
});

test("classifyForwardLevelDiagnostic tags two-percent single-touch higher-timeframe reactions", () => {
  const result = classifyForwardLevelDiagnostic({
    level: level({
      strengthLabel: "weak",
      timeframeSources: ["4h"],
      sourceTypes: ["swing_low"],
      touchCount: 1,
      sourceEvidenceCount: 1,
      followThroughScore: 0.58,
      outcome: "respected",
      useful: true,
      respected: true,
      broken: false,
      maxFavorableExcursionPct: 0.021,
    }),
  });

  assert.deepEqual(result.tags, ["single_touch_higher_timeframe_reference"]);
});

test("classifyForwardLevelDiagnostic does not tag repeated higher-timeframe references as single-touch", () => {
  const result = classifyForwardLevelDiagnostic({
    level: level({
      strengthLabel: "weak",
      timeframeSources: ["daily"],
      sourceTypes: ["swing_low"],
      touchCount: 2,
      sourceEvidenceCount: 1,
      followThroughScore: 0.62,
      outcome: "respected",
      useful: true,
      respected: true,
      broken: false,
      maxFavorableExcursionPct: 0.04,
    }),
  });

  assert.deepEqual(result.tags, []);
});

test("classifyForwardLevelDiagnostic tags sparse-tape low-volume clean breaks as watch items", () => {
  const result = classifyForwardLevelDiagnostic({
    level: level({
      strengthLabel: "major",
      volumeContext: {
        reliability: "reliable",
        label: "light",
        touchVolume: 1000,
        baselineAverageVolume: 10000,
        relativeVolumeRatio: 0.1,
        baselineBars: 20,
        reason: "test",
      },
    }),
    resolutionCandles: [
      candle(1, 1, 1.015, 0.99, 1.01, 0),
      candle(2, 1.01, 1.025, 1, 1.02, 1000),
      candle(3, 1.02, 1.04, 1.01, 1.035, 0),
      candle(4, 1.035, 1.045, 1.02, 1.04, 0),
      candle(5, 1.04, 1.046, 1.03, 1.04, 100),
      candle(6, 1.04, 1.044, 1.035, 1.04, 0),
    ],
  });

  assertState(result, "broken");
  assert.equal(result.confidence, "watch");
  assert.ok(result.tags.includes("sparse_tape_clean_break_watch"));
});

test("classifyForwardLevelDiagnostic tags small low-volume clean breaks as watch items", () => {
  const result = classifyForwardLevelDiagnostic({
    level: level({
      strengthLabel: "major",
      volumeContext: {
        reliability: "reliable",
        label: "light",
        touchVolume: 60000,
        baselineAverageVolume: 100000,
        relativeVolumeRatio: 0.6,
        baselineBars: 20,
        reason: "test",
      },
    }),
    resolutionCandles: [
      candle(1, 1, 1.018, 0.998, 1.012),
      candle(2, 1.012, 1.035, 1.01, 1.03),
    ],
  });

  assertState(result, "broken");
  assert.equal(result.confidence, "watch");
  assert.deepEqual(result.tags, ["small_clean_break_watch"]);
  assert.match(result.reasons.join(" "), /small clean break/);
});

test("classifyForwardLevelDiagnostic does not tag high-volume or larger clean breaks as small-break watch", () => {
  const highVolume = classifyForwardLevelDiagnostic({
    level: level({
      volumeContext: {
        reliability: "reliable",
        label: "elevated",
        touchVolume: 180000,
        baselineAverageVolume: 100000,
        relativeVolumeRatio: 1.8,
        baselineBars: 20,
        reason: "test",
      },
    }),
    resolutionCandles: [
      candle(1, 1, 1.025, 0.998, 1.02),
    ],
  });
  const largerBreak = classifyForwardLevelDiagnostic({
    level: level({
      volumeContext: {
        reliability: "reliable",
        label: "light",
        touchVolume: 60000,
        baselineAverageVolume: 100000,
        relativeVolumeRatio: 0.6,
        baselineBars: 20,
        reason: "test",
      },
    }),
    resolutionCandles: [
      candle(1, 1, 1.045, 0.998, 1.04),
    ],
  });

  assert.equal(highVolume.tags.includes("small_clean_break_watch"), false);
  assert.equal(largerBreak.tags.includes("small_clean_break_watch"), false);
});

test("classifyForwardLevelDiagnostic tags sparse-tape clean breaks as thin-liquidity watch items", () => {
  const result = classifyForwardLevelDiagnostic({
    level: level({
      strengthLabel: "major",
      timeframeSources: ["daily", "4h", "5m"],
      sourceTypes: ["swing_low", "opening_range_low", "premarket_low"],
      kind: "support",
      representativePrice: 3.4398,
      volumeContext: {
        reliability: "watch",
        label: "unknown",
        touchVolume: 6639,
        baselineAverageVolume: 200,
        relativeVolumeRatio: null,
        baselineBars: 4,
        reason: "insufficient prior candle volume baseline",
      },
    }),
    resolutionCandles: [
      candle(1, 3.36, 3.42, 3.35, 3.42, 6639),
      candle(2, 3.42, 3.42, 3.42, 3.42, 0),
      candle(3, 3.42, 3.42, 3.42, 3.42, 241),
      candle(4, 3.42, 3.42, 3.42, 3.42, 0),
      candle(5, 3.42, 3.42, 3.42, 3.42, 0),
      candle(6, 3.42, 3.42, 3.42, 3.42, 0),
      candle(7, 3.37, 3.37, 3.36, 3.36, 300),
      candle(8, 3.36, 3.37, 3.3, 3.31, 2290),
    ],
  });

  assertState(result, "broken");
  assert.equal(result.confidence, "watch");
  assert.deepEqual(result.tags, ["thin_liquidity_break_watch"]);
  assert.match(result.reasons.join(" "), /sparse\/zero-volume/);
});
