import assert from "node:assert/strict";
import test from "node:test";

import type { LevelEngineOutput } from "../lib/levels/level-types.js";
import { validateLevelPersistence } from "../lib/validation/level-persistence-validator.js";
import { buildValidationZone } from "./helpers/level-validation-fixtures.js";

function buildOutput(
  generatedAt: number,
  overrides: Partial<LevelEngineOutput> = {},
): LevelEngineOutput {
  return {
    symbol: "GXAI",
    generatedAt,
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

test("validateLevelPersistence reports strong persistence when nearby refreshed levels remain structurally stable", () => {
  const outputs = [
    buildOutput(1, {
      intradayResistance: [
        buildValidationZone({ id: "R1", symbol: "GXAI", kind: "resistance", representativePrice: 1.49 }),
        buildValidationZone({ id: "R2", symbol: "GXAI", kind: "resistance", representativePrice: 1.58 }),
      ],
      extensionLevels: {
        support: [],
        resistance: [
          buildValidationZone({
            id: "RX1",
            symbol: "GXAI",
            kind: "resistance",
            representativePrice: 1.75,
            isExtension: true,
          }),
        ],
      },
    }),
    buildOutput(2, {
      intradayResistance: [
        buildValidationZone({ id: "R1b", symbol: "GXAI", kind: "resistance", representativePrice: 1.491 }),
        buildValidationZone({ id: "R2b", symbol: "GXAI", kind: "resistance", representativePrice: 1.582 }),
      ],
      extensionLevels: {
        support: [],
        resistance: [
          buildValidationZone({
            id: "RX1b",
            symbol: "GXAI",
            kind: "resistance",
            representativePrice: 1.752,
            isExtension: true,
          }),
        ],
      },
    }),
  ];

  const report = validateLevelPersistence(outputs);

  assert.equal(report.totalRunsCompared, 1);
  assert.equal(report.averageResistancePersistenceRate, 1);
  assert.equal(report.averageExtensionResistancePersistenceRate, 1);
  assert.ok(report.averageMatchedDriftPct > 0);
  assert.ok(report.averageMatchedDriftPct < 0.01);
});

test("validateLevelPersistence reports churn when surfaced levels rotate to different structure", () => {
  const outputs = [
    buildOutput(1, {
      intradayResistance: [
        buildValidationZone({ id: "R1", symbol: "GXAI", kind: "resistance", representativePrice: 1.49 }),
        buildValidationZone({ id: "R2", symbol: "GXAI", kind: "resistance", representativePrice: 1.58 }),
      ],
    }),
    buildOutput(2, {
      intradayResistance: [
        buildValidationZone({ id: "R3", symbol: "GXAI", kind: "resistance", representativePrice: 1.74 }),
      ],
    }),
  ];

  const report = validateLevelPersistence(outputs);

  assert.equal(report.totalRunsCompared, 1);
  assert.equal(report.averageResistancePersistenceRate, 0);
  assert.equal(report.averageSurfacedResistanceChurnRate, 1);
});

test("validateLevelPersistence returns an empty report when fewer than two outputs are supplied", () => {
  const report = validateLevelPersistence([
    buildOutput(1, {
      intradaySupport: [
        buildValidationZone({ id: "S1", symbol: "GXAI", kind: "support", representativePrice: 1.33 }),
      ],
    }),
  ]);

  assert.equal(report.totalRunsCompared, 0);
  assert.equal(report.averageSupportPersistenceRate, 0);
  assert.equal(report.runSummaries.length, 0);
});
