import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import type { LevelEngineOutput } from "../lib/levels/level-types.js";
import {
  validateForwardReactions,
} from "../lib/validation/forward-reaction-validator.js";
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
  assert.equal(report.surfacedRespectRate, 1);
  assert.equal(report.surfacedBreakRate, 0);
  assert.equal(report.levelResults[0]?.outcome, "respected");
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
    candle(1, 1.90, 1.96, 1.88, 1.95),
    candle(2, 1.95, 1.98, 1.94, 1.975),
    candle(3, 1.975, 2.02, 1.97, 2.01),
  ];

  const report = validateForwardReactions({ output, futureCandles });

  assert.equal(report.extensionLevelsEvaluated, 1);
  assert.equal(report.extensionTouchRate, 1);
  assert.equal(report.extensionRespectRate, 0);
  assert.equal(report.extensionBreakRate, 1);
  assert.equal(report.levelResults[0]?.outcome, "broken");
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
  assert.equal(report.byStrengthLabel.major.evaluated, 1);
  assert.equal(report.byStrengthLabel.weak.evaluated, 1);
  assert.equal(report.levelResults.every((result) => result.outcome === "untouched"), true);
});
