import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_LEVEL_ENGINE_CONFIG } from "../lib/levels/level-config.js";
import { buildLevelExtensions } from "../lib/levels/level-extension-engine.js";
import { rankLevelZones } from "../lib/levels/level-ranker.js";
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
