import assert from "node:assert/strict";
import test from "node:test";

import { findNearestResistanceLevel, findNearestSupportLevel } from "../lib/execution-context/execution-market-context.js";
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
    symbol: "SYNX",
    timeframeBias: "daily",
    timeframeSources: ["daily"],
    zoneLow: params.representativePrice * 0.995,
    zoneHigh: params.representativePrice * 1.005,
    strengthScore: 32,
    strengthLabel: "strong",
    touchCount: 3,
    confluenceCount: 1,
    rejectionScore: 0.5,
    displacementScore: 0.55,
    reactionQualityScore: 0.72,
    followThroughScore: 0.5,
    ...params,
  });
}

function ids(zones: FinalLevelZone[]): string[] {
  return zones.map((level) => level.id);
}

function assertSynthetic(level: FinalLevelZone, side: "support" | "resistance"): void {
  assert.equal(level.kind, side);
  assert.equal(level.isExtension, true);
  assert.equal(level.extensionMetadata?.extensionSource, "synthetic_continuation_map");
  assert.equal(level.extensionMetadata?.generationMethod, "round_number_ladder");
  assert(level.notes.some((note) => note.includes("Synthetic continuation-map extension")));
  assert(level.notes.some((note) => note.includes("not historical support/resistance")));
  assert.equal(level.touchCount, 0);
  assert.equal(level.confluenceCount, 0);
  assert.equal(level.rejectionScore, 0);
  assert.equal(level.reactionQualityScore, 0);
  assert.equal(level.displacementScore, 0);
  assert.equal(level.followThroughScore, 0);
  assert.equal(level.sourceEvidenceCount, 0);
  assert.deepEqual(level.sourceTypes, []);
  assert.deepEqual(level.timeframeSources, []);
}

test("missing resistance extension gets synthetic continuation-map extensions", () => {
  const surfacedResistance = [
    zone({ id: "visible-resistance", kind: "resistance", representativePrice: 11 }),
  ];
  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones: surfacedResistance,
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 10,
    spacingPct: 0.01,
    searchWindowPct: 0.05,
  });

  assert.deepEqual(
    extensions.resistance.map((level) => level.representativePrice),
    [13, 15],
  );
  assert(extensions.resistance.every((level) => level.representativePrice > 10));
  assert(extensions.resistance.every((level) => level.id !== "visible-resistance"));
  extensions.resistance.forEach((level) => assertSynthetic(level, "resistance"));
});

test("missing support extension gets synthetic continuation-map extensions", () => {
  const surfacedSupport = [
    zone({ id: "visible-support", kind: "support", representativePrice: 9 }),
  ];
  const extensions = buildLevelExtensions({
    supportZones: surfacedSupport,
    resistanceZones: [],
    surfacedSupport,
    surfacedResistance: [],
    referencePrice: 10,
    spacingPct: 0.01,
    searchWindowPct: 0.05,
  });

  assert.deepEqual(
    extensions.support.map((level) => level.representativePrice),
    [7, 5],
  );
  assert(extensions.support.every((level) => level.representativePrice < 10));
  assert(extensions.support.every((level) => level.id !== "visible-support"));
  extensions.support.forEach((level) => assertSynthetic(level, "support"));
});

test("shallow real resistance coverage gets synthetic fill after real extension", () => {
  const surfacedResistance = [
    zone({ id: "visible-resistance", kind: "resistance", representativePrice: 10.5 }),
  ];
  const shallowRealExtension = zone({
    id: "shallow-real-resistance-extension",
    kind: "resistance",
    representativePrice: 11,
  });
  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones: [...surfacedResistance, shallowRealExtension],
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 10,
    maxExtensionPerSide: 3,
  });

  assert.deepEqual(ids(extensions.resistance), [
    "shallow-real-resistance-extension",
    "SYNX-synthetic-resistance-extension-1-13p0000",
  ]);
  assert.equal(extensions.resistance[0]!.extensionMetadata, undefined);
  assertSynthetic(extensions.resistance[1]!, "resistance");
});

test("shallow real support coverage gets synthetic fill after real extension", () => {
  const surfacedSupport = [
    zone({ id: "visible-support", kind: "support", representativePrice: 9.5 }),
  ];
  const shallowRealExtension = zone({
    id: "shallow-real-support-extension",
    kind: "support",
    representativePrice: 9,
  });
  const extensions = buildLevelExtensions({
    supportZones: [...surfacedSupport, shallowRealExtension],
    resistanceZones: [],
    surfacedSupport,
    surfacedResistance: [],
    referencePrice: 10,
    maxExtensionPerSide: 3,
  });

  assert.deepEqual(ids(extensions.support), [
    "shallow-real-support-extension",
    "SYNX-synthetic-support-extension-1-7p0000",
  ]);
  assert.equal(extensions.support[0]!.extensionMetadata, undefined);
  assertSynthetic(extensions.support[1]!, "support");
});

test("real extensions are preferred and no synthetic is added when coverage is healthy", () => {
  const surfacedResistance = [
    zone({ id: "visible-resistance", kind: "resistance", representativePrice: 11 }),
  ];
  const healthyRealExtension = zone({
    id: "healthy-real-resistance-extension",
    kind: "resistance",
    representativePrice: 13,
  });
  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones: [...surfacedResistance, healthyRealExtension],
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 10,
    maxExtensionPerSide: 3,
  });

  assert.deepEqual(ids(extensions.resistance), ["healthy-real-resistance-extension"]);
  assert.equal(extensions.resistance[0]!.extensionMetadata, undefined);
});

test("synthetic extensions do not duplicate surfaced or real extension levels", () => {
  const surfacedResistance = [
    zone({ id: "visible-resistance", kind: "resistance", representativePrice: 13 }),
  ];
  const realExtension = zone({
    id: "real-extension-at-upper-target",
    kind: "resistance",
    representativePrice: 15,
  });
  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones: [...surfacedResistance, realExtension],
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 10,
    maxExtensionPerSide: 3,
  });

  assert.deepEqual(ids(extensions.resistance), ["real-extension-at-upper-target"]);
  assert.equal(extensions.resistance[0]!.extensionMetadata, undefined);
});

test("low-price support synthetic ladder stays within practical coverage", () => {
  const surfacedSupport = [
    zone({
      id: "low-price-visible-support",
      kind: "support",
      representativePrice: 0.34,
      zoneLow: 0.335,
      zoneHigh: 0.345,
    }),
  ];
  const extensions = buildLevelExtensions({
    supportZones: surfacedSupport,
    resistanceZones: [],
    surfacedSupport,
    surfacedResistance: [],
    referencePrice: 0.4,
    maxExtensionPerSide: 3,
  });

  assert.deepEqual(
    extensions.support.map((level) => level.representativePrice),
    [0.28, 0.26],
  );
  assert(extensions.support.every((level) => level.representativePrice >= 0.26));
  assert(extensions.support.every((level) => level.representativePrice > 0));
  extensions.support.forEach((level) => assertSynthetic(level, "support"));
});

test("ranked surfaced buckets nearest levels and special levels remain unchanged", () => {
  const config = structuredClone(DEFAULT_LEVEL_ENGINE_CONFIG);
  config.timeframeConfig.daily.maxOutputPerSide = 1;
  const supportZones = [
    zone({ id: "surfaced-support", kind: "support", representativePrice: 9, strengthScore: 50 }),
  ];
  const resistanceZones = [
    zone({ id: "surfaced-resistance", kind: "resistance", representativePrice: 11, strengthScore: 50 }),
  ];
  const output = rankLevelZones({
    symbol: "SYNX",
    supportZones,
    resistanceZones,
    specialLevels: {
      premarketHigh: 11.25,
      premarketLow: 8.75,
    },
    metadata: {
      providerByTimeframe: {},
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10,
    },
    config,
  });

  assert.deepEqual(ids(output.majorSupport), ["surfaced-support"]);
  assert.deepEqual(ids(output.majorResistance), ["surfaced-resistance"]);
  assert.equal(findNearestSupportLevel(output, 10)?.id, "surfaced-support");
  assert.equal(findNearestResistanceLevel(output, 10)?.id, "surfaced-resistance");
  assert.deepEqual(output.specialLevels, {
    premarketHigh: 11.25,
    premarketLow: 8.75,
  });
  assert.deepEqual(
    output.extensionLevels.support.map((level) => level.extensionMetadata?.extensionSource),
    ["synthetic_continuation_map", "synthetic_continuation_map"],
  );
  assert.deepEqual(
    output.extensionLevels.resistance.map((level) => level.extensionMetadata?.extensionSource),
    ["synthetic_continuation_map", "synthetic_continuation_map"],
  );
});

test("diagnostics include synthetic selected coverage while preserving real inventory signal", () => {
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

  assert.deepEqual(result.diagnostics.resistance.eligibleCandidatePrices, []);
  assert.deepEqual(result.diagnostics.resistance.selectedExtensionPrices, [13, 15]);
  assert.equal(result.diagnostics.resistance.insufficientCandidateInventory, true);
  assert.equal(result.diagnostics.resistance.selectedCoveragePct, 50);
});

test("runtime mode old remains default", () => {
  assert.equal(resolveLevelRuntimeMode(), "old");
});
