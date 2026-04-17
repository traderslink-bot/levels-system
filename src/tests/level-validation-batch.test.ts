import assert from "node:assert/strict";
import test from "node:test";

import type { CandleSourceHealthReport } from "../lib/validation/candle-source-health.js";
import {
  formatLevelValidationBatchSummary,
  summarizeLevelValidationBatch,
} from "../lib/validation/level-validation-batch.js";

function buildHealthReport(
  symbol: string,
  timeframe: "daily" | "4h" | "5m",
  status: "healthy" | "degraded" | "unavailable",
): CandleSourceHealthReport {
  return {
    provider: "stub",
    symbol,
    timeframe,
    requestedLookbackBars: 120,
    status,
    reason: status,
    diagnostics: `${symbol}-${timeframe}-${status}`,
    response: null,
  };
}

test("summarizeLevelValidationBatch aggregates support, resistance, and distance-band usefulness", () => {
  const summary = summarizeLevelValidationBatch([
    {
      symbol: "AAPL",
      healthReports: [
        buildHealthReport("AAPL", "daily", "healthy"),
        buildHealthReport("AAPL", "4h", "healthy"),
        buildHealthReport("AAPL", "5m", "healthy"),
      ],
      persistenceReport: {
        totalRunsCompared: 2,
        averageSupportPersistenceRate: 0.8,
        averageResistancePersistenceRate: 0.9,
        averageExtensionSupportPersistenceRate: 0.7,
        averageExtensionResistancePersistenceRate: 0.75,
        averageSurfacedSupportChurnRate: 0.2,
        averageSurfacedResistanceChurnRate: 0.1,
        averageSupportLooseMatchRate: 0.1,
        averageResistanceLooseMatchRate: 0.2,
        averageMatchedDriftPct: 0.01,
        runSummaries: [],
      },
      forwardReactionReport: {
        totalLevelsEvaluated: 10,
        surfacedLevelsEvaluated: 8,
        extensionLevelsEvaluated: 2,
        surfacedTouchRate: 0.5,
        extensionTouchRate: 0.4,
        surfacedUsefulnessRate: 0.4,
        extensionUsefulnessRate: 0.25,
        surfacedRespectRate: 0.3,
        extensionRespectRate: 0.2,
        surfacedPartialRespectRate: 0.1,
        extensionPartialRespectRate: 0.05,
        surfacedBreakRate: 0.1,
        extensionBreakRate: 0.2,
        byKindSource: {
          surfacedSupport: { evaluated: 3, touchRate: 0.66, usefulnessRate: 0.5, respectRate: 0.33, partialRespectRate: 0.17, breakRate: 0.17 },
          surfacedResistance: { evaluated: 5, touchRate: 0.4, usefulnessRate: 0.3, respectRate: 0.2, partialRespectRate: 0.1, breakRate: 0.1 },
          extensionSupport: { evaluated: 1, touchRate: 1, usefulnessRate: 1, respectRate: 1, partialRespectRate: 0, breakRate: 0 },
          extensionResistance: { evaluated: 1, touchRate: 0, usefulnessRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0.4 },
        },
        byDistanceBand: {
          near: { evaluated: 4, touchRate: 0.75, usefulnessRate: 0.5, respectRate: 0.25, partialRespectRate: 0.25, breakRate: 0.25 },
          intermediate: { evaluated: 3, touchRate: 0.33, usefulnessRate: 0.33, respectRate: 0.33, partialRespectRate: 0, breakRate: 0 },
          far: { evaluated: 3, touchRate: 0.33, usefulnessRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0.33 },
        },
        byStrengthLabel: {
          weak: { evaluated: 1, touchRate: 0, usefulnessRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
          moderate: { evaluated: 4, touchRate: 0.5, usefulnessRate: 0.25, respectRate: 0.25, partialRespectRate: 0, breakRate: 0.25 },
          strong: { evaluated: 3, touchRate: 0.66, usefulnessRate: 0.33, respectRate: 0.33, partialRespectRate: 0, breakRate: 0 },
          major: { evaluated: 2, touchRate: 0.5, usefulnessRate: 0.5, respectRate: 0.5, partialRespectRate: 0, breakRate: 0 },
        },
        levelResults: [],
      },
    },
    {
      symbol: "TSLA",
      healthReports: [
        buildHealthReport("TSLA", "daily", "degraded"),
        buildHealthReport("TSLA", "4h", "healthy"),
        buildHealthReport("TSLA", "5m", "healthy"),
      ],
      persistenceReport: {
        totalRunsCompared: 2,
        averageSupportPersistenceRate: 0.7,
        averageResistancePersistenceRate: 0.6,
        averageExtensionSupportPersistenceRate: 0.5,
        averageExtensionResistancePersistenceRate: 0.4,
        averageSurfacedSupportChurnRate: 0.3,
        averageSurfacedResistanceChurnRate: 0.4,
        averageSupportLooseMatchRate: 0.2,
        averageResistanceLooseMatchRate: 0.4,
        averageMatchedDriftPct: 0.02,
        runSummaries: [],
      },
      forwardReactionReport: {
        totalLevelsEvaluated: 8,
        surfacedLevelsEvaluated: 6,
        extensionLevelsEvaluated: 2,
        surfacedTouchRate: 0.3,
        extensionTouchRate: 0.2,
        surfacedUsefulnessRate: 0.2,
        extensionUsefulnessRate: 0.1,
        surfacedRespectRate: 0.1,
        extensionRespectRate: 0.05,
        surfacedPartialRespectRate: 0.1,
        extensionPartialRespectRate: 0.05,
        surfacedBreakRate: 0.2,
        extensionBreakRate: 0.15,
        byKindSource: {
          surfacedSupport: { evaluated: 2, touchRate: 0.5, usefulnessRate: 0.5, respectRate: 0.5, partialRespectRate: 0, breakRate: 0 },
          surfacedResistance: { evaluated: 4, touchRate: 0.2, usefulnessRate: 0.05, respectRate: 0, partialRespectRate: 0.05, breakRate: 0.3 },
          extensionSupport: { evaluated: 1, touchRate: 0, usefulnessRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
          extensionResistance: { evaluated: 1, touchRate: 0.4, usefulnessRate: 0.2, respectRate: 0.1, partialRespectRate: 0.1, breakRate: 0.3 },
        },
        byDistanceBand: {
          near: { evaluated: 3, touchRate: 0.5, usefulnessRate: 0.33, respectRate: 0.33, partialRespectRate: 0, breakRate: 0 },
          intermediate: { evaluated: 3, touchRate: 0.33, usefulnessRate: 0.17, respectRate: 0, partialRespectRate: 0.17, breakRate: 0.17 },
          far: { evaluated: 2, touchRate: 0, usefulnessRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0.5 },
        },
        byStrengthLabel: {
          weak: { evaluated: 2, touchRate: 0.5, usefulnessRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0.5 },
          moderate: { evaluated: 3, touchRate: 0.33, usefulnessRate: 0.33, respectRate: 0.33, partialRespectRate: 0, breakRate: 0 },
          strong: { evaluated: 2, touchRate: 0, usefulnessRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
          major: { evaluated: 1, touchRate: 0, usefulnessRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
        },
        levelResults: [],
      },
    },
    {
      symbol: "GXAI",
      healthReports: [
        buildHealthReport("GXAI", "daily", "unavailable"),
        buildHealthReport("GXAI", "4h", "unavailable"),
        buildHealthReport("GXAI", "5m", "unavailable"),
      ],
      errorMessage: "provider unavailable",
    },
  ]);

  assert.equal(summary.totalSymbols, 3);
  assert.equal(summary.healthySymbols, 1);
  assert.equal(summary.degradedSymbols, 1);
  assert.equal(summary.unavailableSymbols, 1);
  assert.equal(summary.completedSymbols, 2);
  assert.equal(summary.failedSymbols, 1);
  assert.equal(summary.averageSurfacedSupportPersistenceRate, 0.75);
  assert.equal(summary.averageSurfacedResistancePersistenceRate, 0.75);
  assert.equal(summary.averageExtensionSupportPersistenceRate, 0.6);
  assert.equal(summary.averageExtensionResistancePersistenceRate, 0.575);
  assert.equal(summary.averageSupportLooseMatchRate, 0.15);
  assert.equal(summary.averageResistanceLooseMatchRate, 0.3);
  assert.equal(summary.averageSurfacedSupportUsefulnessRate, 0.5);
  assert.equal(summary.averageSurfacedResistanceUsefulnessRate, 0.175);
  assert.equal(summary.averageExtensionResistanceUsefulnessRate, 0.1);
  assert.equal(summary.byDistanceBand.far.usefulnessRate, 0);
  assert.deepEqual(summary.weakestUsefulnessAreas, [
    { label: "far", usefulnessRate: 0, evaluated: 5 },
    { label: "extensionResistance", usefulnessRate: 0.1, evaluated: 2 },
    { label: "surfacedResistance", usefulnessRate: 0.175, evaluated: 9 },
  ]);
});

test("formatLevelValidationBatchSummary produces deterministic readable lines", () => {
  const lines = formatLevelValidationBatchSummary(
    summarizeLevelValidationBatch([
      {
        symbol: "AAPL",
        healthReports: [
          buildHealthReport("AAPL", "daily", "healthy"),
          buildHealthReport("AAPL", "4h", "healthy"),
          buildHealthReport("AAPL", "5m", "healthy"),
        ],
        persistenceReport: {
          totalRunsCompared: 1,
          averageSupportPersistenceRate: 1,
          averageResistancePersistenceRate: 0.9,
          averageExtensionSupportPersistenceRate: 1,
          averageExtensionResistancePersistenceRate: 0.8,
          averageSurfacedSupportChurnRate: 0,
          averageSurfacedResistanceChurnRate: 0.1,
          averageSupportLooseMatchRate: 0.1,
          averageResistanceLooseMatchRate: 0.2,
          averageMatchedDriftPct: 0.01,
          runSummaries: [],
        },
        forwardReactionReport: {
          totalLevelsEvaluated: 4,
          surfacedLevelsEvaluated: 3,
          extensionLevelsEvaluated: 1,
          surfacedTouchRate: 0.6,
          extensionTouchRate: 0.5,
          surfacedUsefulnessRate: 0.5,
          extensionUsefulnessRate: 0.3,
          surfacedRespectRate: 0.4,
          extensionRespectRate: 0.3,
          surfacedPartialRespectRate: 0.1,
          extensionPartialRespectRate: 0,
          surfacedBreakRate: 0.2,
          extensionBreakRate: 0.1,
          byKindSource: {
            surfacedSupport: { evaluated: 1, touchRate: 1, usefulnessRate: 1, respectRate: 1, partialRespectRate: 0, breakRate: 0 },
            surfacedResistance: { evaluated: 2, touchRate: 0.5, usefulnessRate: 0.25, respectRate: 0.1, partialRespectRate: 0.15, breakRate: 0.2 },
            extensionSupport: { evaluated: 0, touchRate: 0, usefulnessRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
            extensionResistance: { evaluated: 1, touchRate: 0.5, usefulnessRate: 0.3, respectRate: 0.3, partialRespectRate: 0, breakRate: 0.1 },
          },
          byDistanceBand: {
            near: { evaluated: 2, touchRate: 0.5, usefulnessRate: 0.5, respectRate: 0.5, partialRespectRate: 0, breakRate: 0 },
            intermediate: { evaluated: 1, touchRate: 1, usefulnessRate: 0.5, respectRate: 0, partialRespectRate: 0.5, breakRate: 0.5 },
            far: { evaluated: 1, touchRate: 0, usefulnessRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
          },
          byStrengthLabel: {
            weak: { evaluated: 1, touchRate: 0, usefulnessRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
            moderate: { evaluated: 1, touchRate: 1, usefulnessRate: 1, respectRate: 1, partialRespectRate: 0, breakRate: 0 },
            strong: { evaluated: 1, touchRate: 1, usefulnessRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 1 },
            major: { evaluated: 1, touchRate: 0, usefulnessRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
          },
          levelResults: [],
        },
      },
    ]),
  );

  assert.equal(lines[0], "[LevelValidation] Batch summary | symbols=1 | completed=1 | failed=0");
  assert.equal(lines[1], "[LevelValidation] Health summary | healthy=1 | degraded=0 | unavailable=0");
  assert.equal(
    lines[4],
    "[LevelValidation] Surfaced usefulness | support=1.0000 | resistance=0.2500",
  );
  assert.equal(
    lines[10],
    "[LevelValidation] Weakest usefulness areas | far=0.0000(1) | surfacedResistance=0.2500(2) | extensionResistance=0.3000(1)",
  );
  assert.equal(
    lines[11],
    "[LevelValidation] Symbol AAPL | health=healthy | surfacedPersist=1.0000/0.9000 | extensionPersist=1.0000/0.8000 | loose=0.1000/0.2000 | surfacedUseful=1.0000/0.2500 | extensionUseful=0.0000/0.3000 | bands=0.5000/0.5000/0.0000",
  );
});
