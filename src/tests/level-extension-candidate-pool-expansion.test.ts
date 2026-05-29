import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { DEFAULT_LEVEL_ENGINE_CONFIG } from "../lib/levels/level-config.js";
import {
  buildLevelExtensions,
  buildLevelExtensionsWithDiagnostics,
} from "../lib/levels/level-extension-engine.js";
import { rankLevelZones } from "../lib/levels/level-ranker.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { FinalLevelZone } from "../lib/levels/level-types.js";
import { buildValidationZone } from "./helpers/level-validation-fixtures.js";

function zone(
  params: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "kind" | "representativePrice">,
): FinalLevelZone {
  return buildValidationZone({
    symbol: "XPOOL",
    timeframeBias: "daily",
    timeframeSources: ["daily"],
    zoneLow: params.representativePrice * 0.995,
    zoneHigh: params.representativePrice * 1.005,
    strengthScore: 28,
    strengthLabel: "strong",
    touchCount: 3,
    confluenceCount: 1,
    rejectionScore: 0.48,
    displacementScore: 0.58,
    reactionQualityScore: 0.72,
    followThroughScore: 0.54,
    ...params,
  });
}

function ids(zones: FinalLevelZone[]): string[] {
  return zones.map((level) => level.id);
}

function surfacedIds(output: ReturnType<typeof rankLevelZones>): string[] {
  return [
    ...output.majorSupport,
    ...output.intermediateSupport,
    ...output.intradaySupport,
    ...output.majorResistance,
    ...output.intermediateResistance,
    ...output.intradayResistance,
  ].map((level) => level.id);
}

test("expands resistance extensions from unselected scored zones when surfaced frontier owns the map", () => {
  const surfacedResistance = [
    zone({
      id: "surfaced-resistance-frontier",
      kind: "resistance",
      representativePrice: 14,
      strengthScore: 44,
    }),
  ];
  const insideResistance = [
    zone({ id: "inside-resistance-near", kind: "resistance", representativePrice: 12 }),
    zone({ id: "inside-resistance-far", kind: "resistance", representativePrice: 13 }),
  ];
  const result = buildLevelExtensionsWithDiagnostics({
    supportZones: [],
    resistanceZones: [...surfacedResistance, ...insideResistance],
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 10,
    spacingPct: 0.01,
    searchWindowPct: 0.05,
  });

  assert.equal(result.diagnostics.resistance.candidatePoolMode, "expanded_unselected_scored");
  assert.deepEqual(ids(result.extensionLevels.resistance), [
    "inside-resistance-near",
    "inside-resistance-far",
  ]);
  assert(result.extensionLevels.resistance.every((level) => level.isExtension));
  assert(result.extensionLevels.resistance.every((level) => level.representativePrice > 10));
  assert(!result.extensionLevels.resistance.some((level) => ids(surfacedResistance).includes(level.id)));
  assert.equal(result.diagnostics.resistance.selectedCoveragePct, 30);
});

test("expands support extensions from unselected scored zones without duplicating surfaced support", () => {
  const surfacedSupport = [
    zone({
      id: "surfaced-support-frontier",
      kind: "support",
      representativePrice: 6,
      strengthScore: 44,
    }),
  ];
  const insideSupport = [
    zone({ id: "inside-support-near", kind: "support", representativePrice: 8 }),
    zone({ id: "inside-support-far", kind: "support", representativePrice: 7 }),
  ];
  const result = buildLevelExtensionsWithDiagnostics({
    supportZones: [...surfacedSupport, ...insideSupport],
    resistanceZones: [],
    surfacedSupport,
    surfacedResistance: [],
    referencePrice: 10,
    spacingPct: 0.01,
    searchWindowPct: 0.05,
  });

  assert.equal(result.diagnostics.support.candidatePoolMode, "expanded_unselected_scored");
  assert.deepEqual(ids(result.extensionLevels.support), [
    "inside-support-near",
    "inside-support-far",
  ]);
  assert(result.extensionLevels.support.every((level) => level.isExtension));
  assert(result.extensionLevels.support.every((level) => level.representativePrice < 10));
  assert(!result.extensionLevels.support.some((level) => ids(surfacedSupport).includes(level.id)));
  assert.equal(result.diagnostics.support.selectedCoveragePct, 30);
});

test("keeps strict frontier behavior when a beyond-frontier extension candidate exists", () => {
  const surfacedResistance = [
    zone({ id: "visible-resistance", kind: "resistance", representativePrice: 12 }),
  ];
  const result = buildLevelExtensionsWithDiagnostics({
    supportZones: [],
    resistanceZones: [
      ...surfacedResistance,
      zone({ id: "inside-map-resistance", kind: "resistance", representativePrice: 11 }),
      zone({ id: "strict-frontier-resistance", kind: "resistance", representativePrice: 13 }),
    ],
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 10,
    spacingPct: 0.01,
    searchWindowPct: 0.05,
  });

  assert.equal(result.diagnostics.resistance.candidatePoolMode, "strict_frontier");
  assert.deepEqual(ids(result.extensionLevels.resistance), ["strict-frontier-resistance"]);
});

test("ranked surfaced buckets and nearest surfaced levels remain unchanged while extensions use expanded pool", () => {
  const config = structuredClone(DEFAULT_LEVEL_ENGINE_CONFIG);
  config.timeframeConfig.daily.maxOutputPerSide = 1;
  const supportZones = [
    zone({ id: "surfaced-support", kind: "support", representativePrice: 6, strengthScore: 50 }),
    zone({ id: "support-extension-near", kind: "support", representativePrice: 8, strengthScore: 24 }),
    zone({ id: "support-extension-far", kind: "support", representativePrice: 7, strengthScore: 23 }),
  ];
  const resistanceZones = [
    zone({ id: "surfaced-resistance", kind: "resistance", representativePrice: 14, strengthScore: 50 }),
    zone({ id: "resistance-extension-near", kind: "resistance", representativePrice: 12, strengthScore: 24 }),
    zone({ id: "resistance-extension-far", kind: "resistance", representativePrice: 13, strengthScore: 23 }),
  ];
  const output = rankLevelZones({
    symbol: "XPOOL",
    supportZones,
    resistanceZones,
    specialLevels: {},
    metadata: {
      providerByTimeframe: {},
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10,
    },
    config,
  });

  assert.deepEqual(surfacedIds(output).sort(), ["surfaced-resistance", "surfaced-support"]);
  assert.deepEqual(ids(output.extensionLevels.support), [
    "support-extension-near",
    "support-extension-far",
  ]);
  assert.deepEqual(ids(output.extensionLevels.resistance), [
    "resistance-extension-near",
    "resistance-extension-far",
  ]);
  assert.equal(output.majorSupport[0]?.id, "surfaced-support");
  assert.equal(output.majorResistance[0]?.id, "surfaced-resistance");
  assert.deepEqual(output.intermediateSupport, []);
  assert.deepEqual(output.intermediateResistance, []);
  assert.deepEqual(output.intradaySupport, []);
  assert.deepEqual(output.intradayResistance, []);
  assert.deepEqual(output.specialLevels, {});
});

test("low-price runner practical resistance behavior stays inside forward range", () => {
  const surfacedResistance = [
    zone({ id: "low-price-visible", kind: "resistance", representativePrice: 0.52 }),
  ];
  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones: [
      ...surfacedResistance,
      zone({ id: "low-price-practical-forward", kind: "resistance", representativePrice: 0.58 }),
      zone({ id: "low-price-too-far", kind: "resistance", representativePrice: 0.72 }),
    ],
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 0.4,
    spacingPct: 0.01,
    searchWindowPct: 0.05,
  });

  assert.deepEqual(ids(extensions.resistance), ["low-price-practical-forward"]);
  assert(extensions.resistance.every((level) => level.representativePrice <= 0.6));
});

test("extension candidate pool expansion does not import runtime alert or Discord wiring", () => {
  const sourcePath = fileURLToPath(new URL("../lib/levels/level-extension-engine.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("../alerts/"), false);
  assert.equal(source.includes("discord"), false);
  assert.equal(source.includes("monitor"), false);
  assert.equal(resolveLevelRuntimeMode(), "old");
});
