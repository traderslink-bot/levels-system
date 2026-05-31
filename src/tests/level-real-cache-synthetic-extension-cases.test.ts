import assert from "node:assert/strict";
import test from "node:test";

import {
  findNearestResistanceLevel,
  findNearestSupportLevel,
} from "../lib/execution-context/execution-market-context.js";
import { DEFAULT_LEVEL_ENGINE_CONFIG } from "../lib/levels/level-config.js";
import { buildLevelExtensionsWithDiagnostics } from "../lib/levels/level-extension-engine.js";
import { rankLevelZones } from "../lib/levels/level-ranker.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { FinalLevelZone } from "../lib/levels/level-types.js";
import { buildValidationZone } from "./helpers/level-validation-fixtures.js";

function zone(
  params: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "kind" | "representativePrice">,
): FinalLevelZone {
  return buildValidationZone({
    symbol: "RCSE",
    timeframeBias: "daily",
    timeframeSources: ["daily"],
    zoneLow: params.representativePrice * 0.995,
    zoneHigh: params.representativePrice * 1.005,
    strengthScore: 34,
    strengthLabel: "strong",
    touchCount: 3,
    confluenceCount: 1,
    rejectionScore: 0.52,
    displacementScore: 0.56,
    reactionQualityScore: 0.74,
    followThroughScore: 0.58,
    ...params,
  });
}

function ids(zones: FinalLevelZone[]): string[] {
  return zones.map((level) => level.id);
}

function syntheticCount(zones: FinalLevelZone[]): number {
  return zones.filter(
    (level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map",
  ).length;
}

test("real-cache DEVS-style missing resistance stays unsynthesized when targets are blocked", () => {
  const surfacedResistance = [
    zone({ id: "devs-visible-resistance-1", kind: "resistance", representativePrice: 0.2624 }),
    zone({ id: "devs-visible-resistance-2", kind: "resistance", representativePrice: 0.2838 }),
    zone({ id: "devs-visible-resistance-3", kind: "resistance", representativePrice: 0.2875 }),
    zone({ id: "devs-visible-resistance-4", kind: "resistance", representativePrice: 0.3126 }),
    zone({ id: "devs-visible-resistance-5", kind: "resistance", representativePrice: 0.3501 }),
  ];
  const result = buildLevelExtensionsWithDiagnostics({
    supportZones: [],
    resistanceZones: surfacedResistance,
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 0.2592,
  });

  assert.deepEqual(result.extensionLevels.resistance, []);
  assert.equal(syntheticCount(result.extensionLevels.resistance), 0);
  assert.equal(result.diagnostics.resistance.insufficientCandidateInventory, true);
  assert.deepEqual(result.diagnostics.resistance.selectedExtensionPrices, []);
  assert.equal(result.diagnostics.resistance.rejectionReasonCounts.already_surfaced, 5);
  assert.equal(result.diagnostics.resistance.rejectionReasonCounts.inside_surfaced_map, 5);
  assert.equal(result.diagnostics.resistance.rejectionReasonCounts.too_close_to_surfaced_level, 5);
});

test("synthetic resistance is not generated when the rounded target is inside surfaced resistance", () => {
  const surfacedResistance = [
    zone({ id: "surface-covers-thirty-percent", kind: "resistance", representativePrice: 13.2 }),
  ];
  const result = buildLevelExtensionsWithDiagnostics({
    supportZones: [],
    resistanceZones: surfacedResistance,
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 10,
    syntheticExtensionOptions: {
      maxSyntheticExtensionsPerSide: 1,
    },
  });

  assert.deepEqual(result.extensionLevels.resistance, []);
  assert.equal(result.diagnostics.resistance.insufficientCandidateInventory, true);
  assert.equal(result.diagnostics.resistance.selectedCoveragePct, undefined);
});

test("synthetic resistance is not generated when the rounded target exceeds practical max", () => {
  const surfacedResistance = [
    zone({ id: "visible-low-price-resistance", kind: "resistance", representativePrice: 0.45 }),
  ];
  const result = buildLevelExtensionsWithDiagnostics({
    supportZones: [],
    resistanceZones: surfacedResistance,
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 0.373,
    syntheticExtensionOptions: {
      minTargetCoveragePct: 0.5,
      maxTargetCoveragePct: 0.5,
      maxSyntheticExtensionsPerSide: 1,
    },
  });

  assert.deepEqual(result.extensionLevels.resistance, []);
  assert.equal(result.diagnostics.resistance.insufficientCandidateInventory, true);
});

test("healthy real-cache DXYZ-style resistance extension remains historical", () => {
  const surfacedResistance = [
    zone({ id: "dxyz-visible-1", kind: "resistance", representativePrice: 46.8 }),
    zone({ id: "dxyz-visible-2", kind: "resistance", representativePrice: 50 }),
    zone({ id: "dxyz-visible-3", kind: "resistance", representativePrice: 55.38 }),
    zone({ id: "dxyz-visible-4", kind: "resistance", representativePrice: 61.7 }),
    zone({ id: "dxyz-visible-5", kind: "resistance", representativePrice: 67 }),
  ];
  const realExtension = zone({
    id: "dxyz-real-resistance-extension",
    kind: "resistance",
    representativePrice: 67.69,
  });
  const result = buildLevelExtensionsWithDiagnostics({
    supportZones: [],
    resistanceZones: [...surfacedResistance, realExtension],
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 46.47,
  });

  assert.deepEqual(ids(result.extensionLevels.resistance), ["dxyz-real-resistance-extension"]);
  assert.equal(result.extensionLevels.resistance[0]?.extensionMetadata, undefined);
  assert.equal(result.diagnostics.resistance.selectedCoveragePct, 45.6639);
  assert.equal(syntheticCount(result.extensionLevels.resistance), 0);
});

test("real support extensions fill slots before synthetic fill in ENVX-style shallow downside case", () => {
  const surfacedSupport = [
    zone({ id: "envx-visible-support", kind: "support", representativePrice: 6.68 }),
  ];
  const realSupportExtensions = [
    zone({ id: "envx-real-support-extension-1", kind: "support", representativePrice: 6.55 }),
    zone({ id: "envx-real-support-extension-2", kind: "support", representativePrice: 5.86 }),
    zone({ id: "envx-real-support-extension-3", kind: "support", representativePrice: 5.59 }),
  ];
  const result = buildLevelExtensionsWithDiagnostics({
    supportZones: [...surfacedSupport, ...realSupportExtensions],
    resistanceZones: [],
    surfacedSupport,
    surfacedResistance: [],
    referencePrice: 6.73,
    maxExtensionPerSide: 3,
  });

  assert.deepEqual(ids(result.extensionLevels.support), [
    "envx-real-support-extension-1",
    "envx-real-support-extension-2",
    "envx-real-support-extension-3",
  ]);
  assert.equal(result.diagnostics.support.selectedCoveragePct, 16.9391);
  assert.equal(syntheticCount(result.extensionLevels.support), 0);
});

test("normal missing-extension synthetic fallback still works", () => {
  const surfacedResistance = [
    zone({ id: "visible-resistance", kind: "resistance", representativePrice: 11 }),
  ];
  const result = buildLevelExtensionsWithDiagnostics({
    supportZones: [],
    resistanceZones: surfacedResistance,
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 10,
  });

  assert.deepEqual(
    result.extensionLevels.resistance.map((level) => level.representativePrice),
    [13, 15],
  );
  assert.equal(syntheticCount(result.extensionLevels.resistance), 2);
  assert.equal(result.diagnostics.resistance.selectedCoveragePct, 50);
});

test("blocked synthetic fallback leaves surfaced buckets nearest levels and special levels unchanged", () => {
  const config = structuredClone(DEFAULT_LEVEL_ENGINE_CONFIG);
  config.timeframeConfig.daily.maxOutputPerSide = 6;
  const supportZones = [
    zone({ id: "visible-support", kind: "support", representativePrice: 0.2264 }),
  ];
  const resistanceZones = [
    zone({ id: "visible-resistance-frontier", kind: "resistance", representativePrice: 0.3501 }),
  ];
  const output = rankLevelZones({
    symbol: "RCSE",
    supportZones,
    resistanceZones,
    specialLevels: {
      premarketHigh: 0.3501,
      premarketLow: 0.2264,
    },
    metadata: {
      providerByTimeframe: {},
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 0.2592,
    },
    config,
  });

  const surfacedResistanceIds = [
    ...output.majorResistance,
    ...output.intermediateResistance,
    ...output.intradayResistance,
  ].map((level) => level.id);

  assert(surfacedResistanceIds.every((id) => resistanceZones.some((level) => level.id === id)));
  assert.equal(findNearestSupportLevel(output, 0.2592)?.id, "visible-support");
  assert.equal(findNearestResistanceLevel(output, 0.2592)?.id, "visible-resistance-frontier");
  assert.deepEqual(output.extensionLevels.resistance, []);
  assert.deepEqual(output.specialLevels, {
    premarketHigh: 0.3501,
    premarketLow: 0.2264,
  });
});

test("runtime mode old remains default", () => {
  assert.equal(resolveLevelRuntimeMode(), "old");
});
