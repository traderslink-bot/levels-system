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

test("summarizeLevelValidationBatch aggregates health, persistence, and forward metrics", () => {
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
        averageMatchedDriftPct: 0.01,
        runSummaries: [],
      },
      forwardReactionReport: {
        totalLevelsEvaluated: 10,
        surfacedLevelsEvaluated: 8,
        extensionLevelsEvaluated: 2,
        surfacedTouchRate: 0.5,
        extensionTouchRate: 0.4,
        surfacedRespectRate: 0.3,
        extensionRespectRate: 0.2,
        surfacedBreakRate: 0.1,
        extensionBreakRate: 0.2,
        byStrengthLabel: {
          weak: { evaluated: 1, touchRate: 0, respectRate: 0, breakRate: 0 },
          moderate: { evaluated: 4, touchRate: 0.5, respectRate: 0.25, breakRate: 0.25 },
          strong: { evaluated: 3, touchRate: 0.66, respectRate: 0.33, breakRate: 0 },
          major: { evaluated: 2, touchRate: 0.5, respectRate: 0.5, breakRate: 0 },
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
        averageMatchedDriftPct: 0.02,
        runSummaries: [],
      },
      forwardReactionReport: {
        totalLevelsEvaluated: 8,
        surfacedLevelsEvaluated: 6,
        extensionLevelsEvaluated: 2,
        surfacedTouchRate: 0.3,
        extensionTouchRate: 0.2,
        surfacedRespectRate: 0.1,
        extensionRespectRate: 0.05,
        surfacedBreakRate: 0.2,
        extensionBreakRate: 0.15,
        byStrengthLabel: {
          weak: { evaluated: 2, touchRate: 0.5, respectRate: 0, breakRate: 0.5 },
          moderate: { evaluated: 3, touchRate: 0.33, respectRate: 0.33, breakRate: 0 },
          strong: { evaluated: 2, touchRate: 0, respectRate: 0, breakRate: 0 },
          major: { evaluated: 1, touchRate: 0, respectRate: 0, breakRate: 0 },
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
  assert.equal(summary.averageSurfacedResistancePersistenceRate, 0.75);
  assert.equal(summary.averageExtensionResistancePersistenceRate, 0.575);
  assert.equal(summary.averageSurfacedRespectRate, 0.2);
  assert.equal(summary.averageExtensionRespectRate, 0.125);
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
          averageMatchedDriftPct: 0.01,
          runSummaries: [],
        },
        forwardReactionReport: {
          totalLevelsEvaluated: 4,
          surfacedLevelsEvaluated: 3,
          extensionLevelsEvaluated: 1,
          surfacedTouchRate: 0.6,
          extensionTouchRate: 0.5,
          surfacedRespectRate: 0.4,
          extensionRespectRate: 0.3,
          surfacedBreakRate: 0.2,
          extensionBreakRate: 0.1,
          byStrengthLabel: {
            weak: { evaluated: 1, touchRate: 0, respectRate: 0, breakRate: 0 },
            moderate: { evaluated: 1, touchRate: 1, respectRate: 1, breakRate: 0 },
            strong: { evaluated: 1, touchRate: 1, respectRate: 0, breakRate: 1 },
            major: { evaluated: 1, touchRate: 0, respectRate: 0, breakRate: 0 },
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
    "[LevelValidation] Symbol AAPL | health=healthy | surfacedResistance=0.9000 | extensionResistance=0.8000 | surfacedRespect=0.4000 | extensionRespect=0.3000",
  );
});
