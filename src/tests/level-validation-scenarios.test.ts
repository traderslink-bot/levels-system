import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_LEVEL_ENGINE_CONFIG } from "../lib/levels/level-config.js";
import { buildLevelExtensions } from "../lib/levels/level-extension-engine.js";
import { rankLevelZones } from "../lib/levels/level-ranker.js";
import { scoreLevelZones } from "../lib/levels/level-scorer.js";
import { buildValidationZone } from "./helpers/level-validation-fixtures.js";

test("validation scenario: dense nearby resistance band preserves the stronger anchor instead of every nearby step", () => {
  const resistanceZones = [
    buildValidationZone({
      id: "near",
      symbol: "GXAI",
      kind: "resistance",
      representativePrice: 1.49,
      strengthScore: 15,
    }),
    buildValidationZone({
      id: "anchor",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "5m",
      timeframeSources: ["5m"],
      representativePrice: 1.58,
      strengthScore: 27,
      confluenceCount: 2,
      rejectionScore: 0.49,
      followThroughScore: 0.56,
      reactionQualityScore: 0.71,
    }),
    buildValidationZone({
      id: "band-1",
      symbol: "GXAI",
      kind: "resistance",
      representativePrice: 1.62,
      strengthScore: 18,
    }),
    buildValidationZone({
      id: "band-2",
      symbol: "GXAI",
      kind: "resistance",
      representativePrice: 1.64,
      strengthScore: 17,
    }),
    buildValidationZone({
      id: "band-3",
      symbol: "GXAI",
      kind: "resistance",
      representativePrice: 1.67,
      strengthScore: 16,
    }),
    buildValidationZone({
      id: "far",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "daily",
      timeframeSources: ["daily"],
      representativePrice: 1.85,
      strengthScore: 24,
      rejectionScore: 0.52,
      followThroughScore: 0.48,
    }),
  ];

  const output = rankLevelZones({
    symbol: "GXAI",
    supportZones: [],
    resistanceZones,
    specialLevels: {},
    metadata: {
      providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
      dataQualityFlags: [],
      freshness: "fresh",
    },
    config: DEFAULT_LEVEL_ENGINE_CONFIG,
  });

  const surfacedIds = [
    ...output.majorResistance.map((zone) => zone.id),
    ...output.intermediateResistance.map((zone) => zone.id),
    ...output.intradayResistance.map((zone) => zone.id),
  ];

  assert.ok(surfacedIds.includes("near"));
  assert.ok(surfacedIds.includes("anchor"));
  assert.ok(surfacedIds.includes("far"));
  assert.ok(!surfacedIds.includes("band-2"));
  assert.ok(!surfacedIds.includes("band-3"));
});

test("validation scenario: forward ladder keeps near, intermediate, and far resistance continuity", () => {
  const surfacedResistance = [
    buildValidationZone({
      id: "visible",
      symbol: "GXAI",
      kind: "resistance",
      representativePrice: 1.49,
      strengthScore: 18,
    }),
  ];

  const resistanceZones = [
    ...surfacedResistance,
    buildValidationZone({
      id: "near-step",
      symbol: "GXAI",
      kind: "resistance",
      representativePrice: 1.58,
      strengthScore: 22,
      followThroughScore: 0.52,
      rejectionScore: 0.46,
    }),
    buildValidationZone({
      id: "intermediate-step",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "daily",
      timeframeSources: ["daily"],
      representativePrice: 1.75,
      strengthScore: 24,
      rejectionScore: 0.62,
      followThroughScore: 0.55,
    }),
    buildValidationZone({
      id: "far-step",
      symbol: "GXAI",
      kind: "resistance",
      representativePrice: 2.05,
      strengthScore: 20,
    }),
  ];

  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones,
    surfacedSupport: [],
    surfacedResistance,
    spacingPct: 0.01,
    searchWindowPct: 0.08,
  });

  assert.deepEqual(
    extensions.resistance.map((zone) => zone.id),
    ["near-step", "intermediate-step", "far-step"],
  );
});

test("validation scenario: extension selection favors decisive forward structure over weak local continuation leftovers", () => {
  const surfacedResistance = [
    buildValidationZone({
      id: "visible",
      symbol: "GXAI",
      kind: "resistance",
      representativePrice: 1.49,
      strengthScore: 18,
    }),
  ];

  const resistanceZones = [
    ...surfacedResistance,
    buildValidationZone({
      id: "weak-leftover",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "5m",
      timeframeSources: ["5m"],
      representativePrice: 1.54,
      strengthScore: 27,
      reactionQualityScore: 0.54,
      rejectionScore: 0.24,
      displacementScore: 0.34,
      followThroughScore: 0.57,
      confluenceCount: 1,
    }),
    buildValidationZone({
      id: "decisive-forward",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "4h",
      timeframeSources: ["4h"],
      representativePrice: 1.6,
      strengthScore: 23,
      reactionQualityScore: 0.74,
      rejectionScore: 0.53,
      displacementScore: 0.66,
      followThroughScore: 0.44,
      confluenceCount: 2,
    }),
  ];

  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones,
    surfacedSupport: [],
    surfacedResistance,
    spacingPct: 0.01,
    searchWindowPct: 0.08,
    maxExtensionPerSide: 1,
  });

  assert.deepEqual(extensions.resistance.map((zone) => zone.id), ["decisive-forward"]);
});

test("validation scenario: extension selection ignores a very far surfaced outlier when a practical forward resistance exists", () => {
  const surfacedResistance = [
    buildValidationZone({
      id: "visible",
      symbol: "GXAI",
      kind: "resistance",
      representativePrice: 1.74,
      strengthScore: 18,
      timeframeBias: "4h",
      timeframeSources: ["4h"],
    }),
    buildValidationZone({
      id: "surfaced-far-outlier",
      symbol: "GXAI",
      kind: "resistance",
      representativePrice: 2.65,
      strengthScore: 14,
      timeframeBias: "daily",
      timeframeSources: ["daily"],
    }),
  ];

  const resistanceZones = [
    ...surfacedResistance,
    buildValidationZone({
      id: "practical-forward",
      symbol: "GXAI",
      kind: "resistance",
      representativePrice: 1.85,
      strengthScore: 23,
      timeframeBias: "4h",
      timeframeSources: ["4h"],
      reactionQualityScore: 0.66,
      rejectionScore: 0.41,
      displacementScore: 0.57,
      followThroughScore: 0.5,
    }),
    buildValidationZone({
      id: "too-far-forward",
      symbol: "GXAI",
      kind: "resistance",
      representativePrice: 2.96,
      strengthScore: 13,
      timeframeBias: "daily",
      timeframeSources: ["daily"],
      reactionQualityScore: 0.55,
      rejectionScore: 0.4,
      displacementScore: 0.49,
      followThroughScore: 0.38,
    }),
  ];

  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones,
    surfacedSupport: [],
    surfacedResistance,
    spacingPct: 0.01,
    searchWindowPct: 0.08,
    maxExtensionPerSide: 1,
    referencePrice: 1.48,
  });

  assert.deepEqual(extensions.resistance.map((zone) => zone.id), ["practical-forward"]);
});

test("validation scenario: recycled intraday resistance loses to a stronger decisive nearby anchor", () => {
  const scoredResistance = scoreLevelZones(
    [
      buildValidationZone({
        id: "recycled-local",
        symbol: "GXAI",
        kind: "resistance",
        representativePrice: 1.53,
        zoneLow: 1.51,
        zoneHigh: 1.55,
        touchCount: 5,
        sourceEvidenceCount: 4,
        confluenceCount: 1,
        reactionQualityScore: 0.48,
        rejectionScore: 0.25,
        displacementScore: 0.3,
        followThroughScore: 0.21,
      }),
      buildValidationZone({
        id: "decisive-anchor",
        symbol: "GXAI",
        kind: "resistance",
        representativePrice: 1.58,
        zoneLow: 1.56,
        zoneHigh: 1.6,
        touchCount: 2,
        sourceEvidenceCount: 2,
        confluenceCount: 2,
        reactionQualityScore: 0.72,
        rejectionScore: 0.5,
        displacementScore: 0.62,
        followThroughScore: 0.58,
      }),
      buildValidationZone({
        id: "far-structure",
        symbol: "GXAI",
        kind: "resistance",
        timeframeBias: "daily",
        timeframeSources: ["daily"],
        representativePrice: 1.85,
        zoneLow: 1.83,
        zoneHigh: 1.87,
        reactionQualityScore: 0.67,
        rejectionScore: 0.52,
        displacementScore: 0.6,
        followThroughScore: 0.48,
      }),
    ],
    DEFAULT_LEVEL_ENGINE_CONFIG,
  );

  const output = rankLevelZones({
    symbol: "GXAI",
    supportZones: [],
    resistanceZones: scoredResistance,
    specialLevels: {},
    metadata: {
      providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
      dataQualityFlags: [],
      freshness: "fresh",
    },
    config: DEFAULT_LEVEL_ENGINE_CONFIG,
  });

  const surfacedIds = [
    ...output.majorResistance.map((zone) => zone.id),
    ...output.intermediateResistance.map((zone) => zone.id),
    ...output.intradayResistance.map((zone) => zone.id),
  ];
  const decisive = scoredResistance.find((zone) => zone.id === "decisive-anchor")!;
  const recycled = scoredResistance.find((zone) => zone.id === "recycled-local")!;

  assert.ok(decisive.strengthScore > recycled.strengthScore);
  assert.ok(surfacedIds.includes("decisive-anchor"));
  assert.ok(surfacedIds.includes("far-structure"));
  assert.ok(!surfacedIds.includes("recycled-local"));
});
