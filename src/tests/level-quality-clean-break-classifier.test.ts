import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import type { ForwardReactionLevelResult } from "../lib/validation/forward-reaction-validator.js";
import { classifyCleanBreak } from "../scripts/run-level-quality-detection-report.js";

function candle(timestamp: number, open: number, high: number, low: number, close: number, volume: number): Candle {
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
    strengthLabel: "major",
    strengthScore: 50,
    touchCount: 6,
    confluenceCount: 2,
    sourceEvidenceCount: 4,
    timeframeSources: ["4h", "5m"],
    sourceTypes: ["swing_high", "premarket_high"],
    reactionQualityScore: 0.45,
    rejectionScore: 0.34,
    followThroughScore: 0.76,
    displacementScore: 0.4,
    representativePrice: 3.85,
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
    maxFavorableExcursionPct: 0.013,
    maxAdverseExcursionPct: 0.039,
    volumeContext: {
      reliability: "reliable",
      label: "light",
      touchVolume: 200,
      baselineAverageVolume: 500,
      relativeVolumeRatio: 0.4,
      baselineBars: 20,
      reason: "test",
    },
    ...overrides,
  };
}

test("classifyCleanBreak promotes late volume drives to momentum-consumed", () => {
  const result = classifyCleanBreak(
    level(),
    {
      maxFavorablePct: 0.013,
      maxAdversePct: 0.039,
    },
    [
      candle(1, 3.85, 3.85, 3.84, 3.84, 1827),
      candle(2, 3.88, 3.88, 3.88, 3.88, 147),
      candle(3, 3.88, 3.88, 3.88, 3.88, 0),
      candle(4, 3.88, 3.88, 3.88, 3.88, 0),
      candle(5, 3.85, 3.85, 3.85, 3.85, 130),
      candle(6, 3.85, 3.85, 3.85, 3.85, 0),
      candle(7, 3.88, 3.88, 3.88, 3.88, 133),
      candle(8, 3.93, 3.93, 3.85, 3.925, 6914),
      candle(9, 3.993, 4, 3.993, 4, 350),
      candle(10, 3.94, 3.94, 3.8, 3.88, 1878),
      candle(11, 3.885, 3.885, 3.885, 3.885, 100),
      candle(12, 3.885, 3.9, 3.885, 3.9, 900),
    ],
  );

  assert.equal(result.classification, "momentum_consumed_level");
  assert.match(result.reasons.join(" "), /volume expansion/);
});

test("classifyCleanBreak separates active references that resolved before breaking", () => {
  const result = classifyCleanBreak(
    level({
      representativePrice: 7,
      touchCount: 34,
      sourceEvidenceCount: 10,
      confluenceCount: 3,
      reactionQualityScore: 0.55,
      rejectionScore: 0.55,
      followThroughScore: 0.65,
      volumeContext: {
        reliability: "reliable",
        label: "normal",
        touchVolume: 101509,
        baselineAverageVolume: 108029,
        relativeVolumeRatio: 0.94,
        baselineBars: 20,
        reason: "test",
      },
    }),
    {
      maxFavorablePct: 0.0529,
      maxAdversePct: 0.0214,
    },
    [
      candle(1, 7.01, 7.08, 6.93, 6.97, 101509),
      candle(2, 6.99, 7.09, 6.95, 7.07, 52437),
      candle(3, 7.06, 7.09, 7, 7.055, 39137),
      candle(4, 7.07, 7.15, 6.93, 6.93, 73389),
      candle(5, 6.94, 7, 6.86, 6.93, 33471),
      candle(6, 6.93, 6.99, 6.87, 6.915, 10964),
      candle(7, 6.93, 6.95, 6.63, 6.75, 59149),
      candle(8, 6.75, 6.835, 6.71, 6.76, 26451),
    ],
  );

  assert.equal(result.classification, "active_reference_resolved");
  assert.match(result.reasons.join(" "), /active reference/);
});

test("classifyCleanBreak keeps soft light-volume no-reaction failures as overstated-strength candidates", () => {
  const result = classifyCleanBreak(
    level({
      kind: "support",
      representativePrice: 3.42,
      touchCount: 12,
      sourceEvidenceCount: 3,
      confluenceCount: 2,
      rejectionScore: 0.25,
      followThroughScore: 0.51,
      maxFavorableExcursionPct: 0.0088,
      maxAdverseExcursionPct: 0.0497,
      volumeContext: {
        reliability: "reliable",
        label: "light",
        touchVolume: 243,
        baselineAverageVolume: 6295,
        relativeVolumeRatio: 0.04,
        baselineBars: 20,
        reason: "test",
      },
    }),
    {
      maxFavorablePct: 0.0088,
      maxAdversePct: 0.0497,
    },
    [
      candle(1, 3.44, 3.44, 3.44, 3.44, 243),
      candle(2, 3.44, 3.45, 3.43, 3.45, 3270),
      candle(3, 3.43, 3.44, 3.43, 3.43, 146),
      candle(4, 3.43, 3.43, 3.4, 3.4, 10548),
      candle(5, 3.38, 3.4, 3.26, 3.27, 18847),
      candle(6, 3.27, 3.27, 3.27, 3.27, 0),
      candle(7, 3.31, 3.31, 3.28, 3.28, 2617),
      candle(8, 3.28, 3.28, 3.28, 3.28, 0),
    ],
  );

  assert.equal(result.classification, "possible_overstated_strength");
  assert.match(result.reasons.join(" "), /light/);
});

test("classifyCleanBreak keeps unknown-volume clean breaks out of scoring changes", () => {
  const result = classifyCleanBreak(
    level({
      kind: "resistance",
      representativePrice: 13.49,
      timeframeSources: ["daily", "4h"],
      sourceTypes: ["swing_high"],
      volumeContext: {
        reliability: "watch",
        label: "unknown",
        touchVolume: 1090,
        baselineAverageVolume: 0,
        relativeVolumeRatio: null,
        baselineBars: 0,
        reason: "test",
      },
    }),
    {
      maxFavorablePct: 0,
      maxAdversePct: 0.1601,
    },
    [
      candle(Date.UTC(2026, 4, 1, 14, 15), 13.49, 13.79, 13.49, 13.79, 1090),
      candle(Date.UTC(2026, 4, 1, 14, 20), 13.79, 14.2, 13.79, 14.1, 0),
      candle(Date.UTC(2026, 4, 1, 14, 25), 14.1, 15.65, 14.1, 15.62, 653),
      candle(Date.UTC(2026, 4, 1, 14, 30), 15.62, 15.62, 15.62, 15.62, 0),
      candle(Date.UTC(2026, 4, 1, 14, 35), 15.62, 15.62, 15.62, 15.62, 0),
      candle(Date.UTC(2026, 4, 1, 14, 40), 15.62, 15.62, 15.62, 15.62, 0),
    ],
  );

  assert.equal(result.classification, "unknown_volume_clean_break_watch");
  assert.match(result.reasons.join(" "), /evidence-quality/);
});

test("classifyCleanBreak flags single-timeframe 5m swing breaks separately", () => {
  const result = classifyCleanBreak(
    level({
      kind: "resistance",
      representativePrice: 0.6615,
      timeframeSources: ["5m"],
      sourceTypes: ["swing_high"],
      strengthScore: 39.9,
      sourceEvidenceCount: 3,
      confluenceCount: 1,
      volumeContext: {
        reliability: "reliable",
        label: "light",
        touchVolume: 100,
        baselineAverageVolume: 2500,
        relativeVolumeRatio: 0.04,
        baselineBars: 20,
        reason: "test",
      },
    }),
    {
      maxFavorablePct: 0,
      maxAdversePct: 0.1489,
    },
    [
      candle(Date.UTC(2026, 3, 29, 20, 55), 0.6708, 0.6708, 0.6708, 0.6708, 100),
      candle(Date.UTC(2026, 3, 29, 21, 0), 0.671, 0.7, 0.671, 0.7, 500),
      candle(Date.UTC(2026, 3, 29, 21, 5), 0.7, 0.76, 0.7, 0.7372, 253),
      candle(Date.UTC(2026, 3, 29, 21, 10), 0.7372, 0.7372, 0.7372, 0.7372, 0),
      candle(Date.UTC(2026, 3, 29, 21, 15), 0.7372, 0.7372, 0.7372, 0.7372, 0),
      candle(Date.UTC(2026, 3, 29, 21, 20), 0.7372, 0.7372, 0.7372, 0.7372, 0),
    ],
  );

  assert.equal(result.classification, "single_timeframe_5m_swing_break_watch");
  assert.match(result.reasons.join(" "), /single-timeframe 5m swing/);
});

test("classifyCleanBreak flags off-hours light-volume failures as session/liquidity watch", () => {
  const result = classifyCleanBreak(
    level({
      kind: "support",
      representativePrice: 0.84,
      timeframeSources: ["4h", "5m"],
      sourceTypes: ["swing_low", "premarket_low"],
      strengthScore: 39.9,
      sourceEvidenceCount: 3,
      confluenceCount: 2,
      volumeContext: {
        reliability: "reliable",
        label: "light",
        touchVolume: 328,
        baselineAverageVolume: 650,
        relativeVolumeRatio: 0.51,
        baselineBars: 20,
        reason: "test",
      },
    }),
    {
      maxFavorablePct: 0.0024,
      maxAdversePct: 0.1013,
    },
    [
      candle(Date.UTC(2026, 4, 4, 13, 20), 0.842, 0.842, 0.842, 0.842, 328),
      candle(Date.UTC(2026, 4, 4, 13, 25), 0.842, 0.842, 0.82, 0.82, 0),
      candle(Date.UTC(2026, 4, 4, 13, 30), 0.82, 0.82, 0.8, 0.8, 300),
      candle(Date.UTC(2026, 4, 4, 13, 35), 0.8, 0.81, 0.76, 0.77, 1200),
      candle(Date.UTC(2026, 4, 4, 13, 40), 0.77, 0.8, 0.755, 0.7999, 3000),
      candle(Date.UTC(2026, 4, 4, 13, 45), 0.7999, 0.7999, 0.7999, 0.7999, 0),
    ],
  );

  assert.equal(result.classification, "off_hours_light_volume_break_watch");
  assert.match(result.reasons.join(" "), /outside regular hours/);
});

test("classifyCleanBreak flags local clustered supports before broad scoring changes", () => {
  const result = classifyCleanBreak(
    level({
      kind: "support",
      representativePrice: 0.326,
      timeframeSources: ["5m", "daily"],
      sourceTypes: ["swing_low"],
      strengthScore: 39.9,
      sourceEvidenceCount: 3,
      confluenceCount: 1,
      volumeContext: {
        reliability: "reliable",
        label: "light",
        touchVolume: 400,
        baselineAverageVolume: 2500,
        relativeVolumeRatio: 0.16,
        baselineBars: 20,
        reason: "test",
      },
    }),
    {
      maxFavorablePct: 0,
      maxAdversePct: 0.0798,
    },
    [
      candle(Date.UTC(2026, 4, 1, 20, 10), 0.3159, 0.3159, 0.3157, 0.3157, 400),
      candle(Date.UTC(2026, 4, 1, 20, 15), 0.3157, 0.3157, 0.31, 0.31, 0),
      candle(Date.UTC(2026, 4, 1, 20, 20), 0.31, 0.31, 0.305, 0.305, 240),
      candle(Date.UTC(2026, 4, 1, 20, 25), 0.305, 0.305, 0.3, 0.3, 0),
      candle(Date.UTC(2026, 4, 1, 20, 30), 0.3, 0.3, 0.3, 0.3, 0),
      candle(Date.UTC(2026, 4, 1, 20, 35), 0.3, 0.3, 0.3, 0.3, 0),
    ],
  );

  assert.equal(result.classification, "local_level_cluster_break_watch");
  assert.match(result.reasons.join(" "), /duplicate\/clustered/);
});

test("classifyCleanBreak keeps off-hours heavy-volume event breaks out of scoring changes", () => {
  const result = classifyCleanBreak(
    level({
      kind: "support",
      representativePrice: 6.02,
      timeframeSources: ["4h", "daily"],
      sourceTypes: ["swing_low"],
      strengthScore: 36.42,
      sourceEvidenceCount: 2,
      confluenceCount: 1,
      rejectionScore: 0.2,
      followThroughScore: 0.4,
      volumeContext: {
        reliability: "reliable",
        label: "heavy",
        touchVolume: 1655,
        baselineAverageVolume: 585,
        relativeVolumeRatio: 2.83,
        baselineBars: 20,
        reason: "test",
      },
    }),
    {
      maxFavorablePct: 0.0066,
      maxAdversePct: 0.0183,
    },
    [
      candle(Date.UTC(2026, 4, 4, 11, 0), 6.05, 6.06, 6.04, 6.06, 1655),
      candle(Date.UTC(2026, 4, 4, 11, 5), 6.06, 6.06, 6.0, 6.0, 1800),
      candle(Date.UTC(2026, 4, 4, 11, 10), 6.0, 6.02, 5.91, 5.92, 3300),
      candle(Date.UTC(2026, 4, 4, 11, 15), 5.92, 6.02, 5.92, 6.02, 391),
      candle(Date.UTC(2026, 4, 4, 11, 20), 6.02, 6.02, 6.02, 6.02, 0),
      candle(Date.UTC(2026, 4, 4, 11, 25), 6.02, 6.02, 6.02, 6.02, 0),
    ],
  );

  assert.equal(result.classification, "off_hours_event_context_break_watch");
  assert.match(result.reasons.join(" "), /event\/session context/);
});

test("classifyCleanBreak keeps halt-runner style regimes out of ordinary strength calibration", () => {
  const result = classifyCleanBreak(
    level({
      kind: "support",
      representativePrice: 3.42,
      touchCount: 12,
      sourceEvidenceCount: 3,
      confluenceCount: 2,
      rejectionScore: 0.25,
      followThroughScore: 0.51,
      volumeContext: {
        reliability: "reliable",
        label: "light",
        touchVolume: 243,
        baselineAverageVolume: 6295,
        relativeVolumeRatio: 0.04,
        baselineBars: 20,
        reason: "test",
      },
    }),
    {
      maxFavorablePct: 0.0088,
      maxAdversePct: 0.0497,
    },
    [
      candle(1, 3.44, 3.44, 3.44, 3.44, 243),
      candle(2, 3.44, 3.45, 3.43, 3.45, 3270),
      candle(3, 3.43, 3.44, 3.43, 3.43, 146),
      candle(4, 3.43, 3.43, 3.4, 3.4, 10548),
      candle(5, 3.38, 3.4, 3.26, 3.27, 18847),
      candle(6, 3.27, 3.27, 3.27, 3.27, 0),
      candle(7, 3.31, 3.31, 3.28, 3.28, 2617),
      candle(8, 3.28, 3.28, 3.28, 3.28, 0),
    ],
    {
      forwardHighPct: 77.9,
      forwardRangePct: 92,
    },
  );

  assert.equal(result.classification, "event_regime_change_watch");
  assert.match(result.reasons.join(" "), /event-regime/);
});
