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
        averageSupportBucketPersistenceRate: {
          daily: 1,
          "4h": 0.75,
          "5m": 0.5,
        },
        averageExtensionSupportPersistenceRate: 0.7,
        averageExtensionResistancePersistenceRate: 0.75,
        averageSurfacedSupportChurnRate: 0.2,
        averageSurfacedResistanceChurnRate: 0.1,
        averageSupportLooseMatchRate: 0.1,
        averageResistanceLooseMatchRate: 0.2,
        averageSupportBucketLooseMatchRate: {
          daily: 0,
          "4h": 0.1,
          "5m": 0.25,
        },
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
        surfacedUsefulWhenTouchedRate: 0.8,
        extensionUsefulWhenTouchedRate: 0.625,
        surfacedRespectRate: 0.3,
        extensionRespectRate: 0.2,
        surfacedPartialRespectRate: 0.1,
        extensionPartialRespectRate: 0.05,
        surfacedBreakRate: 0.1,
        extensionBreakRate: 0.2,
        byKindSource: {
          surfacedSupport: { evaluated: 3, touched: 2, touchRate: 0.66, usefulnessRate: 0.5, usefulWhenTouchedRate: 0.75, respectRate: 0.33, partialRespectRate: 0.17, breakRate: 0.17 },
          surfacedResistance: { evaluated: 5, touched: 2, touchRate: 0.4, usefulnessRate: 0.3, usefulWhenTouchedRate: 0.75, respectRate: 0.2, partialRespectRate: 0.1, breakRate: 0.1 },
          extensionSupport: { evaluated: 1, touched: 1, touchRate: 1, usefulnessRate: 1, usefulWhenTouchedRate: 1, respectRate: 1, partialRespectRate: 0, breakRate: 0 },
          extensionResistance: { evaluated: 1, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0.4 },
        },
        bySurfacedSupportBucket: {
          daily: { evaluated: 1, touched: 1, touchRate: 1, usefulnessRate: 1, usefulWhenTouchedRate: 1, respectRate: 1, partialRespectRate: 0, breakRate: 0 },
          "4h": { evaluated: 1, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
          "5m": { evaluated: 1, touched: 1, touchRate: 1, usefulnessRate: 0.5, usefulWhenTouchedRate: 0.5, respectRate: 0, partialRespectRate: 0.5, breakRate: 0.5 },
        },
        byDistanceBand: {
          near: { evaluated: 4, touched: 3, touchRate: 0.75, usefulnessRate: 0.5, usefulWhenTouchedRate: 0.6667, respectRate: 0.25, partialRespectRate: 0.25, breakRate: 0.25 },
          intermediate: { evaluated: 3, touched: 1, touchRate: 0.33, usefulnessRate: 0.33, usefulWhenTouchedRate: 1, respectRate: 0.33, partialRespectRate: 0, breakRate: 0 },
          far: { evaluated: 3, touched: 1, touchRate: 0.33, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0.33 },
        },
        byStrengthLabel: {
          weak: { evaluated: 1, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
          moderate: { evaluated: 4, touched: 2, touchRate: 0.5, usefulnessRate: 0.25, usefulWhenTouchedRate: 0.5, respectRate: 0.25, partialRespectRate: 0, breakRate: 0.25 },
          strong: { evaluated: 3, touched: 2, touchRate: 0.66, usefulnessRate: 0.33, usefulWhenTouchedRate: 0.5, respectRate: 0.33, partialRespectRate: 0, breakRate: 0 },
          major: { evaluated: 2, touched: 1, touchRate: 0.5, usefulnessRate: 0.5, usefulWhenTouchedRate: 1, respectRate: 0.5, partialRespectRate: 0, breakRate: 0 },
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
        averageSupportBucketPersistenceRate: {
          daily: 0.9,
          "4h": 0.7,
          "5m": 0.4,
        },
        averageExtensionSupportPersistenceRate: 0.5,
        averageExtensionResistancePersistenceRate: 0.4,
        averageSurfacedSupportChurnRate: 0.3,
        averageSurfacedResistanceChurnRate: 0.4,
        averageSupportLooseMatchRate: 0.2,
        averageResistanceLooseMatchRate: 0.4,
        averageSupportBucketLooseMatchRate: {
          daily: 0,
          "4h": 0.2,
          "5m": 0.5,
        },
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
        surfacedUsefulWhenTouchedRate: 0.6667,
        extensionUsefulWhenTouchedRate: 0.5,
        surfacedRespectRate: 0.1,
        extensionRespectRate: 0.05,
        surfacedPartialRespectRate: 0.1,
        extensionPartialRespectRate: 0.05,
        surfacedBreakRate: 0.2,
        extensionBreakRate: 0.15,
        byKindSource: {
          surfacedSupport: { evaluated: 2, touched: 1, touchRate: 0.5, usefulnessRate: 0.5, usefulWhenTouchedRate: 1, respectRate: 0.5, partialRespectRate: 0, breakRate: 0 },
          surfacedResistance: { evaluated: 4, touched: 1, touchRate: 0.2, usefulnessRate: 0.05, usefulWhenTouchedRate: 0.25, respectRate: 0, partialRespectRate: 0.05, breakRate: 0.3 },
          extensionSupport: { evaluated: 1, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
          extensionResistance: { evaluated: 1, touched: 1, touchRate: 0.4, usefulnessRate: 0.2, usefulWhenTouchedRate: 0.5, respectRate: 0.1, partialRespectRate: 0.1, breakRate: 0.3 },
        },
        bySurfacedSupportBucket: {
          daily: { evaluated: 0, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
          "4h": { evaluated: 1, touched: 1, touchRate: 1, usefulnessRate: 1, usefulWhenTouchedRate: 1, respectRate: 1, partialRespectRate: 0, breakRate: 0 },
          "5m": { evaluated: 1, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
        },
        byDistanceBand: {
          near: { evaluated: 3, touched: 2, touchRate: 0.5, usefulnessRate: 0.33, usefulWhenTouchedRate: 0.5, respectRate: 0.33, partialRespectRate: 0, breakRate: 0 },
          intermediate: { evaluated: 3, touched: 1, touchRate: 0.33, usefulnessRate: 0.17, usefulWhenTouchedRate: 0.5, respectRate: 0, partialRespectRate: 0.17, breakRate: 0.17 },
          far: { evaluated: 2, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0.5 },
        },
        byStrengthLabel: {
          weak: { evaluated: 2, touched: 1, touchRate: 0.5, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0.5 },
          moderate: { evaluated: 3, touched: 1, touchRate: 0.33, usefulnessRate: 0.33, usefulWhenTouchedRate: 1, respectRate: 0.33, partialRespectRate: 0, breakRate: 0 },
          strong: { evaluated: 2, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
          major: { evaluated: 1, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
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
  assert.equal(summary.averageSupportBucketPersistenceRate.daily, 0.95);
  assert.equal(summary.averageSupportBucketPersistenceRate["4h"], 0.725);
  assert.equal(summary.averageSupportBucketPersistenceRate["5m"], 0.45);
  assert.equal(summary.averageExtensionSupportPersistenceRate, 0.6);
  assert.equal(summary.averageExtensionResistancePersistenceRate, 0.575);
  assert.equal(summary.averageSupportLooseMatchRate, 0.15);
  assert.equal(summary.averageResistanceLooseMatchRate, 0.3);
  assert.equal(summary.averageSupportBucketLooseMatchRate.daily, 0);
  assert.equal(summary.averageSupportBucketLooseMatchRate["4h"], 0.15);
  assert.equal(summary.averageSupportBucketLooseMatchRate["5m"], 0.375);
  assert.equal(summary.averageSurfacedSupportUsefulnessRate, 0.5);
  assert.equal(summary.averageSurfacedResistanceUsefulnessRate, 0.175);
  assert.equal(summary.averageExtensionResistanceUsefulnessRate, 0.1);
  assert.equal(summary.averageSupportBucketTouchRate.daily, 0.5);
  assert.equal(summary.averageSupportBucketTouchRate["4h"], 0.5);
  assert.equal(summary.averageSupportBucketTouchRate["5m"], 0.5);
  assert.equal(summary.averageSupportBucketUsefulnessRate.daily, 0.5);
  assert.equal(summary.averageSupportBucketUsefulnessRate["4h"], 0.5);
  assert.equal(summary.averageSupportBucketUsefulnessRate["5m"], 0.25);
  assert.equal(summary.averageSupportBucketUsefulWhenTouchedRate.daily, 0.5);
  assert.equal(summary.averageSupportBucketUsefulWhenTouchedRate["4h"], 0.5);
  assert.equal(summary.averageSupportBucketUsefulWhenTouchedRate["5m"], 0.25);
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
          averageSupportBucketPersistenceRate: {
            daily: 1,
            "4h": 0.75,
            "5m": 0.5,
          },
          averageExtensionSupportPersistenceRate: 1,
          averageExtensionResistancePersistenceRate: 0.8,
          averageSurfacedSupportChurnRate: 0,
          averageSurfacedResistanceChurnRate: 0.1,
          averageSupportLooseMatchRate: 0.1,
          averageResistanceLooseMatchRate: 0.2,
          averageSupportBucketLooseMatchRate: {
            daily: 0,
            "4h": 0.1,
            "5m": 0.25,
          },
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
        surfacedUsefulWhenTouchedRate: 0.75,
        extensionUsefulWhenTouchedRate: 0.6,
        surfacedRespectRate: 0.4,
        extensionRespectRate: 0.3,
          surfacedPartialRespectRate: 0.1,
          extensionPartialRespectRate: 0,
          surfacedBreakRate: 0.2,
          extensionBreakRate: 0.1,
          byKindSource: {
            surfacedSupport: { evaluated: 1, touched: 1, touchRate: 1, usefulnessRate: 1, usefulWhenTouchedRate: 1, respectRate: 1, partialRespectRate: 0, breakRate: 0 },
            surfacedResistance: { evaluated: 2, touched: 1, touchRate: 0.5, usefulnessRate: 0.25, usefulWhenTouchedRate: 0.5, respectRate: 0.1, partialRespectRate: 0.15, breakRate: 0.2 },
            extensionSupport: { evaluated: 0, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
            extensionResistance: { evaluated: 1, touched: 1, touchRate: 0.5, usefulnessRate: 0.3, usefulWhenTouchedRate: 0.6, respectRate: 0.3, partialRespectRate: 0, breakRate: 0.1 },
          },
          bySurfacedSupportBucket: {
            daily: { evaluated: 1, touched: 1, touchRate: 1, usefulnessRate: 1, usefulWhenTouchedRate: 1, respectRate: 1, partialRespectRate: 0, breakRate: 0 },
            "4h": { evaluated: 0, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
            "5m": { evaluated: 0, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
          },
          byDistanceBand: {
            near: { evaluated: 2, touched: 1, touchRate: 0.5, usefulnessRate: 0.5, usefulWhenTouchedRate: 1, respectRate: 0.5, partialRespectRate: 0, breakRate: 0 },
            intermediate: { evaluated: 1, touched: 1, touchRate: 1, usefulnessRate: 0.5, usefulWhenTouchedRate: 0.5, respectRate: 0, partialRespectRate: 0.5, breakRate: 0.5 },
            far: { evaluated: 1, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
          },
          byStrengthLabel: {
            weak: { evaluated: 1, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
            moderate: { evaluated: 1, touched: 1, touchRate: 1, usefulnessRate: 1, usefulWhenTouchedRate: 1, respectRate: 1, partialRespectRate: 0, breakRate: 0 },
            strong: { evaluated: 1, touched: 1, touchRate: 1, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 1 },
            major: { evaluated: 1, touched: 0, touchRate: 0, usefulnessRate: 0, usefulWhenTouchedRate: 0, respectRate: 0, partialRespectRate: 0, breakRate: 0 },
          },
          levelResults: [],
        },
      },
    ]),
  );

  assert.equal(lines[0], "[LevelValidation] Batch summary | symbols=1 | completed=1 | failed=0");
  assert.equal(lines[1], "[LevelValidation] Health summary | healthy=1 | degraded=0 | unavailable=0");
  assert.equal(
    lines[3],
    "[LevelValidation] Support bucket persistence | daily=1.0000 | 4h=0.7500 | 5m=0.5000",
  );
  assert.equal(
    lines[5],
    "[LevelValidation] Surfaced usefulness | support=1.0000 | resistance=0.2500",
  );
  assert.equal(
    lines[9],
    "[LevelValidation] Support bucket usefulness | daily=1.0000 | 4h=0.0000 | 5m=0.0000",
  );
  assert.equal(
    lines[10],
    "[LevelValidation] Support bucket touch | daily=1.0000 | 4h=0.0000 | 5m=0.0000",
  );
  assert.equal(
    lines[11],
    "[LevelValidation] Support bucket useful when touched | daily=1.0000 | 4h=0.0000 | 5m=0.0000",
  );
  assert.equal(
    lines[12],
    "[LevelValidation] Surfaced respect | support=1.0000 | resistance=0.1000",
  );
  assert.equal(
    lines[14],
    "[LevelValidation] Distance usefulness | near=0.5000 | intermediate=0.5000 | far=0.0000",
  );
  assert.equal(
    lines[15],
    "[LevelValidation] Distance touch | near=0.5000 | intermediate=1.0000 | far=0.0000",
  );
  assert.equal(
    lines[16],
    "[LevelValidation] Distance useful when touched | near=1.0000 | intermediate=0.5000 | far=0.0000",
  );
  assert.equal(
    lines[18],
    "[LevelValidation] Support bucket loose matches | daily=0.0000 | 4h=0.1000 | 5m=0.2500",
  );
  assert.equal(
    lines[19],
    "[LevelValidation] Weakest usefulness areas | far=0.0000(1) | surfacedResistance=0.2500(2) | extensionResistance=0.3000(1)",
  );
  assert.equal(
    lines[20],
    "[LevelValidation] Symbol AAPL | health=healthy | surfacedPersist=1.0000/0.9000 | supportBuckets=1.0000/0.7500/0.5000 | extensionPersist=1.0000/0.8000 | loose=0.1000/0.2000 | supportBucketLoose=0.0000/0.1000/0.2500 | surfacedUseful=1.0000/0.2500 | surfacedTouchedUseful=1.0000/0.5000 | supportBucketUseful=1.0000/0.0000/0.0000 | supportBucketTouch=1.0000/0.0000/0.0000 | extensionUseful=0.0000/0.3000 | bands=0.5000/0.5000/0.0000 | bandTouch=0.5000/1.0000/0.0000",
  );
});

test("summarizeLevelValidationBatch treats 5m-only unavailability as degraded instead of structurally unavailable", () => {
  const summary = summarizeLevelValidationBatch([
    {
      symbol: "FAMI",
      healthReports: [
        buildHealthReport("FAMI", "daily", "healthy"),
        buildHealthReport("FAMI", "4h", "degraded"),
        buildHealthReport("FAMI", "5m", "unavailable"),
      ],
      errorMessage: "forward validation unavailable: no future 5m candles",
    },
  ]);

  assert.equal(summary.healthySymbols, 0);
  assert.equal(summary.degradedSymbols, 1);
  assert.equal(summary.unavailableSymbols, 0);
  assert.equal(summary.failedSymbols, 1);
});
