import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import type { LevelEngineOutput } from "../lib/levels/level-types.js";
import { validateForwardReactions } from "../lib/validation/forward-reaction-validator.js";
import { buildValidationZone } from "./helpers/level-validation-fixtures.js";

function buildOutput(
  overrides: Partial<LevelEngineOutput> = {},
): LevelEngineOutput {
  return {
    symbol: "GXAI",
    generatedAt: 1,
    metadata: {
      providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 1.48,
    },
    majorSupport: [],
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
    ...overrides,
  };
}

function candle(timestamp: number, open: number, high: number, low: number, close: number): Candle {
  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume: 100000,
  };
}

test("validateForwardReactions marks a surfaced resistance as respected after touch and rejection", () => {
  const output = buildOutput({
    intradayResistance: [
      buildValidationZone({
        id: "R1",
        symbol: "GXAI",
        kind: "resistance",
        representativePrice: 1.75,
        zoneLow: 1.74,
        zoneHigh: 1.76,
        strengthLabel: "strong",
      }),
    ],
  });
  const futureCandles = [
    candle(1, 1.70, 1.74, 1.68, 1.72),
    candle(2, 1.72, 1.76, 1.71, 1.74),
    candle(3, 1.74, 1.75, 1.68, 1.69),
    candle(4, 1.69, 1.70, 1.64, 1.66),
  ];

  const report = validateForwardReactions({ output, futureCandles });

  assert.equal(report.surfacedLevelsEvaluated, 1);
  assert.equal(report.surfacedTouchRate, 1);
  assert.equal(report.surfacedUsefulnessRate, 1);
  assert.equal(report.surfacedRespectRate, 1);
  assert.equal(report.surfacedPartialRespectRate, 0);
  assert.equal(report.levelResults[0]?.outcome, "respected");
  assert.equal(report.byKindSource.surfacedResistance.usefulnessRate, 1);
});

test("validateForwardReactions marks a partial reaction as useful even when it later breaks", () => {
  const output = buildOutput({
    intradayResistance: [
      buildValidationZone({
        id: "R1",
        symbol: "GXAI",
        kind: "resistance",
        representativePrice: 1.75,
        zoneLow: 1.74,
        zoneHigh: 1.76,
      }),
    ],
  });
  const futureCandles = [
    candle(1, 1.74, 1.76, 1.742, 1.748),
    candle(2, 1.748, 1.77, 1.739, 1.755),
    candle(3, 1.755, 1.79, 1.748, 1.78),
  ];

  const report = validateForwardReactions(
    { output, futureCandles },
    { partialReactionMovePct: 0.005, reactionMovePct: 0.02 },
  );

  assert.equal(report.surfacedUsefulnessRate, 1);
  assert.equal(report.surfacedRespectRate, 0);
  assert.equal(report.surfacedPartialRespectRate, 1);
  assert.equal(report.surfacedBreakRate, 1);
  assert.equal(report.levelResults[0]?.outcome, "partial_respect");
  assert.equal(report.levelResults[0]?.brokeAfterPartial, true);
});

test("validateForwardReactions marks an extension resistance as broken when price closes through it", () => {
  const output = buildOutput({
    extensionLevels: {
      support: [],
      resistance: [
        buildValidationZone({
          id: "RX1",
          symbol: "GXAI",
          kind: "resistance",
          representativePrice: 1.97,
          zoneLow: 1.96,
          zoneHigh: 1.98,
          isExtension: true,
          strengthLabel: "moderate",
        }),
      ],
    },
  });
  const futureCandles = [
    candle(1, 1.95, 1.969, 1.952, 1.965),
    candle(2, 1.965, 1.98, 1.962, 1.975),
    candle(3, 1.975, 2.02, 1.971, 2.01),
  ];

  const report = validateForwardReactions({ output, futureCandles });

  assert.equal(report.extensionLevelsEvaluated, 1);
  assert.equal(report.extensionTouchRate, 1);
  assert.equal(report.extensionUsefulnessRate, 0);
  assert.equal(report.extensionRespectRate, 0);
  assert.equal(report.extensionBreakRate, 1);
  assert.equal(report.levelResults[0]?.distanceBand, "far");
  assert.equal(report.levelResults[0]?.outcome, "broken");
});

test("validateForwardReactions separates support/resistance and near/intermediate/far usefulness deterministically", () => {
  const output = buildOutput({
    intradaySupport: [
      buildValidationZone({
        id: "S-near",
        symbol: "GXAI",
        kind: "support",
        representativePrice: 1.45,
        zoneLow: 1.44,
        zoneHigh: 1.46,
        strengthLabel: "major",
      }),
    ],
    intermediateResistance: [
      buildValidationZone({
        id: "R-mid",
        symbol: "GXAI",
        kind: "resistance",
        timeframeBias: "4h",
        timeframeSources: ["4h"],
        representativePrice: 1.62,
        zoneLow: 1.61,
        zoneHigh: 1.63,
        strengthLabel: "strong",
      }),
    ],
    extensionLevels: {
      support: [],
      resistance: [
        buildValidationZone({
          id: "R-far",
          symbol: "GXAI",
          kind: "resistance",
          representativePrice: 1.92,
          zoneLow: 1.91,
          zoneHigh: 1.93,
          isExtension: true,
          strengthLabel: "weak",
        }),
      ],
    },
  });
  const futureCandles = [
    candle(1, 1.47, 1.48, 1.44, 1.46),
    candle(2, 1.46, 1.47, 1.43, 1.45),
    candle(3, 1.61, 1.62, 1.612, 1.615),
    candle(4, 1.615, 1.63, 1.614, 1.625),
  ];

  const report = validateForwardReactions(
    { output, futureCandles },
    { partialReactionMovePct: 0.005 },
  );

  assert.equal(report.byKindSource.surfacedSupport.usefulnessRate, 1);
  assert.equal(report.byKindSource.surfacedResistance.usefulnessRate, 0);
  assert.equal(report.byKindSource.extensionResistance.usefulnessRate, 0);
  assert.equal(report.bySurfacedSupportBucket.daily.evaluated, 0);
  assert.equal(report.bySurfacedSupportBucket["4h"].evaluated, 0);
  assert.equal(report.bySurfacedSupportBucket["5m"].usefulnessRate, 1);
  assert.equal(report.bySurfacedSupportBucket["5m"].usefulWhenTouchedRate, 1);
  assert.equal(report.byDistanceBand.near.usefulnessRate, 1);
  assert.equal(report.byDistanceBand.intermediate.touchRate, 1);
  assert.equal(report.byDistanceBand.intermediate.usefulnessRate, 0);
  assert.equal(report.byDistanceBand.far.touchRate, 0);
});

test("validateForwardReactions leaves untouched levels as untouched and keeps strength summaries deterministic", () => {
  const output = buildOutput({
    intradaySupport: [
      buildValidationZone({
        id: "S1",
        symbol: "GXAI",
        kind: "support",
        representativePrice: 1.21,
        zoneLow: 1.2,
        zoneHigh: 1.22,
        strengthLabel: "major",
      }),
    ],
    extensionLevels: {
      support: [
        buildValidationZone({
          id: "SX1",
          symbol: "GXAI",
          kind: "support",
          representativePrice: 1.12,
          zoneLow: 1.11,
          zoneHigh: 1.13,
          isExtension: true,
          strengthLabel: "weak",
        }),
      ],
      resistance: [],
    },
  });
  const futureCandles = [
    candle(1, 1.40, 1.42, 1.38, 1.41),
    candle(2, 1.41, 1.43, 1.39, 1.42),
  ];

  const report = validateForwardReactions({ output, futureCandles });

  assert.equal(report.totalLevelsEvaluated, 2);
  assert.equal(report.surfacedTouchRate, 0);
  assert.equal(report.extensionTouchRate, 0);
  assert.equal(report.surfacedUsefulnessRate, 0);
  assert.equal(report.byStrengthLabel.major.evaluated, 1);
  assert.equal(report.byStrengthLabel.weak.evaluated, 1);
  assert.equal(report.levelResults.every((result) => result.outcome === "untouched"), true);
});

test("validateForwardReactions ignores non-actionable levels on the wrong side of the live reference price", () => {
  const output = buildOutput({
    intradaySupport: [
      buildValidationZone({
        id: "S-bad",
        symbol: "GXAI",
        kind: "support",
        representativePrice: 1.52,
        zoneLow: 1.51,
        zoneHigh: 1.53,
      }),
      buildValidationZone({
        id: "S-good",
        symbol: "GXAI",
        kind: "support",
        representativePrice: 1.45,
        zoneLow: 1.44,
        zoneHigh: 1.46,
      }),
    ],
    intradayResistance: [
      buildValidationZone({
        id: "R-bad",
        symbol: "GXAI",
        kind: "resistance",
        representativePrice: 1.40,
        zoneLow: 1.39,
        zoneHigh: 1.41,
      }),
      buildValidationZone({
        id: "R-good",
        symbol: "GXAI",
        kind: "resistance",
        representativePrice: 1.62,
        zoneLow: 1.61,
        zoneHigh: 1.63,
      }),
    ],
  });
  const futureCandles = [
    candle(1, 1.47, 1.48, 1.44, 1.46),
    candle(2, 1.60, 1.62, 1.59, 1.61),
  ];

  const report = validateForwardReactions({ output, futureCandles });

  assert.equal(report.totalLevelsEvaluated, 2);
  assert.deepEqual(
    report.levelResults.map((result) => result.zoneId).sort(),
    ["R-good", "S-good"],
  );
  assert.equal(report.byKindSource.surfacedSupport.evaluated, 1);
  assert.equal(report.byKindSource.surfacedResistance.evaluated, 1);
  assert.equal(report.bySurfacedSupportBucket["5m"].evaluated, 1);
  assert.equal(report.bySurfacedSupportBucket.daily.evaluated, 0);
});
