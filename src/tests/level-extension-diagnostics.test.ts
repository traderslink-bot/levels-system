import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildLevelExtensions,
  buildLevelExtensionsWithDiagnostics,
} from "../lib/levels/level-extension-engine.js";
import {
  buildLevelExtensionDiagnostics,
  buildLevelExtensionDiagnosticsFromOutput,
} from "../lib/levels/level-extension-diagnostics.js";
import type { FinalLevelZone, LevelEngineOutput, LevelLadderExtension } from "../lib/levels/level-types.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";

const GENERATED_AT = Date.parse("2026-05-28T10:00:00-04:00");

function zone(overrides: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "kind" | "representativePrice">): FinalLevelZone {
  return {
    id: overrides.id,
    symbol: overrides.symbol ?? "DIAG",
    kind: overrides.kind,
    timeframeBias: overrides.timeframeBias ?? "4h",
    zoneLow: overrides.zoneLow ?? overrides.representativePrice - 0.05,
    zoneHigh: overrides.zoneHigh ?? overrides.representativePrice + 0.05,
    representativePrice: overrides.representativePrice,
    strengthScore: overrides.strengthScore ?? 30,
    strengthLabel: overrides.strengthLabel ?? "strong",
    touchCount: overrides.touchCount ?? 3,
    confluenceCount: overrides.confluenceCount ?? 1,
    sourceTypes: overrides.sourceTypes ?? (overrides.kind === "support" ? ["swing_low"] : ["swing_high"]),
    timeframeSources: overrides.timeframeSources ?? ["4h"],
    reactionQualityScore: overrides.reactionQualityScore ?? 0.72,
    rejectionScore: overrides.rejectionScore ?? 0.42,
    displacementScore: overrides.displacementScore ?? 0.6,
    sessionSignificanceScore: overrides.sessionSignificanceScore ?? 0.15,
    followThroughScore: overrides.followThroughScore ?? 0.55,
    gapContinuationScore: overrides.gapContinuationScore,
    sourceEvidenceCount: overrides.sourceEvidenceCount ?? 1,
    firstTimestamp: overrides.firstTimestamp ?? GENERATED_AT - 60_000,
    lastTimestamp: overrides.lastTimestamp ?? GENERATED_AT,
    sessionDate: overrides.sessionDate,
    isExtension: overrides.isExtension ?? false,
    freshness: overrides.freshness ?? "fresh",
    notes: overrides.notes ?? [],
    enrichedAnalysis: overrides.enrichedAnalysis,
  };
}

function baseRequest(overrides: Partial<Parameters<typeof buildLevelExtensionDiagnostics>[0]> = {}) {
  const surfacedSupport = [zone({ id: "support-visible", kind: "support", representativePrice: 9 })];
  const surfacedResistance = [zone({ id: "resistance-visible", kind: "resistance", representativePrice: 11 })];
  const supportZones = [
    ...surfacedSupport,
    zone({ id: "support-extension", kind: "support", representativePrice: 8 }),
  ];
  const resistanceZones = [
    ...surfacedResistance,
    zone({ id: "resistance-extension", kind: "resistance", representativePrice: 13 }),
  ];

  return {
    symbol: "DIAG",
    referencePrice: 10,
    supportZones,
    resistanceZones,
    surfacedSupport,
    surfacedResistance,
    ...overrides,
  };
}

function outputFixture(overrides: Partial<LevelEngineOutput> = {}): LevelEngineOutput {
  const surfacedSupport = zone({ id: "support-visible", kind: "support", representativePrice: 9 });
  const surfacedResistance = zone({ id: "resistance-visible", kind: "resistance", representativePrice: 11 });
  const extensionSupport = zone({
    id: "support-extension",
    kind: "support",
    representativePrice: 8,
    isExtension: true,
  });
  const extensionResistance = zone({
    id: "resistance-extension",
    kind: "resistance",
    representativePrice: 13,
    isExtension: true,
  });

  return {
    symbol: "DIAG",
    generatedAt: GENERATED_AT,
    metadata: {
      providerByTimeframe: {},
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10,
    },
    majorSupport: [surfacedSupport],
    majorResistance: [surfacedResistance],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [],
    intradayResistance: [],
    extensionLevels: {
      support: [extensionSupport],
      resistance: [extensionResistance],
    },
    specialLevels: {},
    ...overrides,
  };
}

test("diagnoses healthy extension coverage", () => {
  const report = buildLevelExtensionDiagnostics(baseRequest());

  assert.deepEqual(report.extensionCoverage.warnings, []);
  assert.deepEqual(report.support.selectedExtensionPrices, [8]);
  assert.deepEqual(report.resistance.selectedExtensionPrices, [13]);
  assert.equal(report.extensionCoverage.downsideCoveragePct, 20);
  assert.equal(report.extensionCoverage.upsideCoveragePct, 30);
  assert.equal(report.support.syntheticGenerationAvailable, false);
  assert.equal(report.safety.extensionGenerationUnchanged, true);
});

test("diagnoses missing resistance extension and insufficient candidate inventory", () => {
  const request = baseRequest({
    resistanceZones: [zone({ id: "resistance-visible", kind: "resistance", representativePrice: 11 })],
    surfacedResistance: [zone({ id: "resistance-visible", kind: "resistance", representativePrice: 11 })],
  });
  const report = buildLevelExtensionDiagnostics(request);

  assert(report.warnings.includes("missing_resistance_extension"));
  assert(report.warnings.includes("insufficient_candidate_inventory"));
  assert.equal(report.resistance.insufficientCandidateInventory, true);
  assert.deepEqual(report.resistance.selectedExtensionPrices, []);
});

test("diagnoses missing support extension", () => {
  const visibleSupport = zone({ id: "support-visible", kind: "support", representativePrice: 9 });
  const report = buildLevelExtensionDiagnostics(baseRequest({
    supportZones: [visibleSupport],
    surfacedSupport: [visibleSupport],
  }));

  assert(report.warnings.includes("missing_support_extension"));
  assert.equal(report.support.insufficientCandidateInventory, true);
});

test("diagnoses limited upside extension coverage", () => {
  const surfacedResistance = [zone({ id: "resistance-visible", kind: "resistance", representativePrice: 10.5 })];
  const report = buildLevelExtensionDiagnostics(baseRequest({
    surfacedResistance,
    resistanceZones: [
      ...surfacedResistance,
      zone({ id: "near-resistance-extension", kind: "resistance", representativePrice: 11 }),
    ],
  }));

  assert(report.warnings.includes("limited_upside_extension_coverage"));
  assert.equal(report.extensionCoverage.upsideCoveragePct, 10);
});

test("diagnoses limited downside extension coverage", () => {
  const surfacedSupport = [zone({ id: "support-visible", kind: "support", representativePrice: 9.5 })];
  const report = buildLevelExtensionDiagnostics(baseRequest({
    surfacedSupport,
    supportZones: [
      ...surfacedSupport,
      zone({ id: "near-support-extension", kind: "support", representativePrice: 9 }),
    ],
  }));

  assert(report.warnings.includes("limited_downside_extension_coverage"));
  assert.equal(report.extensionCoverage.downsideCoveragePct, 10);
});

test("identifies already surfaced candidate exclusion when candidate inventory is supplied", () => {
  const visibleSupport = zone({ id: "support-visible", kind: "support", representativePrice: 9 });
  const report = buildLevelExtensionDiagnostics(baseRequest({
    supportZones: [
      visibleSupport,
      zone({ id: "too-close-support", kind: "support", representativePrice: 8.95 }),
      zone({ id: "support-extension", kind: "support", representativePrice: 8 }),
    ],
    surfacedSupport: [visibleSupport],
  }));
  const surfacedCandidate = report.support.candidates.find((candidate) => candidate.id === "support-visible");
  const closeCandidate = report.support.candidates.find((candidate) => candidate.id === "too-close-support");

  assert(surfacedCandidate?.skipReasons.includes("already_surfaced"));
  assert(closeCandidate?.skipReasons.includes("too_close_to_surfaced_level"));
});

test("extension instrumentation preserves selected output while exposing pre-selection inventory", () => {
  const visibleResistance = zone({ id: "visible-resistance", kind: "resistance", representativePrice: 11 });
  const wrongSideResistance = zone({ id: "wrong-side-resistance", kind: "resistance", representativePrice: 9.5 });
  const eligibleResistance = zone({ id: "eligible-resistance", kind: "resistance", representativePrice: 13 });
  const tooFarResistance = zone({ id: "too-far-resistance", kind: "resistance", representativePrice: 16 });
  const request = baseRequest({
    surfacedResistance: [visibleResistance],
    resistanceZones: [
      wrongSideResistance,
      visibleResistance,
      eligibleResistance,
      tooFarResistance,
    ],
  });
  const baseline = buildLevelExtensions(request);
  const instrumented = buildLevelExtensionsWithDiagnostics(request);
  const wrongSide = instrumented.diagnostics.resistance.candidates.find(
    (candidate) => candidate.id === "wrong-side-resistance",
  );
  const visible = instrumented.diagnostics.resistance.candidates.find(
    (candidate) => candidate.id === "visible-resistance",
  );
  const tooFar = instrumented.diagnostics.resistance.candidates.find(
    (candidate) => candidate.id === "too-far-resistance",
  );

  assert.deepEqual(instrumented.extensionLevels, baseline);
  assert.deepEqual(
    instrumented.diagnostics.resistance.inputInventoryPrices,
    [9.5, 11, 13, 16],
  );
  assert.deepEqual(instrumented.diagnostics.resistance.preSelectionCandidatePrices, [13]);
  assert.deepEqual(instrumented.diagnostics.resistance.eligibleCandidatePrices, [13]);
  assert.deepEqual(instrumented.diagnostics.resistance.selectedExtensionPrices, [13]);
  assert.equal(instrumented.diagnostics.resistance.candidateCoveragePct, 30);
  assert.equal(instrumented.diagnostics.resistance.selectedCoveragePct, 30);
  assert(wrongSide?.skipReasons.includes("wrong_side_of_reference_price"));
  assert(visible?.skipReasons.includes("already_surfaced"));
  assert(tooFar?.skipReasons.includes("outside_practical_range"));
});

test("diagnoses limited coverage with spacing-related skipped candidates without changing selection", () => {
  const visibleSupport = zone({ id: "support-visible", kind: "support", representativePrice: 9.5 });
  const selectedSupport = zone({
    id: "selected-near-support",
    kind: "support",
    representativePrice: 9,
    isExtension: true,
  });
  const skippedSupport = zone({ id: "skipped-close-support", kind: "support", representativePrice: 8.95 });
  const selectedExtensions: LevelLadderExtension = {
    support: [selectedSupport],
    resistance: [zone({ id: "resistance-extension", kind: "resistance", representativePrice: 13, isExtension: true })],
  };
  const report = buildLevelExtensionDiagnostics(baseRequest({
    surfacedSupport: [visibleSupport],
    supportZones: [visibleSupport, selectedSupport, skippedSupport],
    selectedExtensions,
  }));
  const skipped = report.support.candidates.find((candidate) => candidate.id === "skipped-close-support");

  assert(report.warnings.includes("limited_downside_extension_coverage"));
  assert.equal(report.support.selectedCoveragePct, 10);
  assert.equal(report.support.candidateCoveragePct, 10.5);
  assert(skipped?.skipReasons.includes("too_close_to_another_extension"));
});

test("diagnoses outside practical range for resistance candidates", () => {
  const surfacedResistance = [zone({ id: "resistance-visible", kind: "resistance", representativePrice: 11 })];
  const report = buildLevelExtensionDiagnostics(baseRequest({
    surfacedResistance,
    resistanceZones: [
      ...surfacedResistance,
      zone({ id: "too-far-resistance", kind: "resistance", representativePrice: 16 }),
    ],
  }));
  const candidate = report.resistance.candidates.find((entry) => entry.id === "too-far-resistance");

  assert(candidate?.skipReasons.includes("outside_practical_range"));
  assert(report.warnings.includes("missing_resistance_extension"));
});

test("reports ladder-selection reasons when supplied candidate inventory is not selected", () => {
  const visibleResistance = zone({ id: "visible", kind: "resistance", representativePrice: 11 });
  const skippedResistance = zone({ id: "skipped", kind: "resistance", representativePrice: 12 });
  const selectedResistance = zone({ id: "selected", kind: "resistance", representativePrice: 13, isExtension: true });
  const selectedExtensions: LevelLadderExtension = {
    support: [zone({ id: "support-extension", kind: "support", representativePrice: 8, isExtension: true })],
    resistance: [selectedResistance],
  };
  const report = buildLevelExtensionDiagnostics(baseRequest({
    surfacedResistance: [visibleResistance],
    resistanceZones: [visibleResistance, skippedResistance, selectedResistance],
    selectedExtensions,
  }));
  const skipped = report.resistance.candidates.find((candidate) => candidate.id === "skipped");

  assert(skipped?.skipReasons.includes("not_selected_by_ladder_selection"));
  assert.equal(report.resistance.undeterminedRejectionCount, 0);
});

test("diagnoses LevelEngineOutput without mutating it", () => {
  const output = outputFixture();
  const before = structuredClone(output);
  const report = buildLevelExtensionDiagnosticsFromOutput(output);

  assert.deepEqual(output, before);
  assert.deepEqual(report.support.selectedExtensionPrices, [8]);
  assert.deepEqual(report.resistance.selectedExtensionPrices, [13]);
  assert(report.support.notes.some((note) => note.includes("final LevelEngineOutput levels")));
  assert(report.diagnostics.includes("candidate_inventory_limited_to_level_output"));
});

test("diagnostic output is deterministic", () => {
  const request = baseRequest();
  const first = buildLevelExtensionDiagnostics(request);
  const second = buildLevelExtensionDiagnostics(request);

  assert.deepEqual(first, second);
});

test("diagnostics do not change extension selection behavior", () => {
  const request = baseRequest();
  const expected = buildLevelExtensions({
    supportZones: request.supportZones,
    resistanceZones: request.resistanceZones,
    surfacedSupport: request.surfacedSupport,
    surfacedResistance: request.surfacedResistance,
    referencePrice: request.referencePrice,
  });
  const report = buildLevelExtensionDiagnostics(request);

  assert.deepEqual(report.support.selectedExtensionPrices, expected.support.map((level) => level.representativePrice));
  assert.deepEqual(report.resistance.selectedExtensionPrices, expected.resistance.map((level) => level.representativePrice));
});

test("does not import LevelEngine and keeps runtime defaults unchanged", () => {
  const sourcePath = fileURLToPath(new URL("../lib/levels/level-extension-diagnostics.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("../lib/levels/level-engine"), false);
  assert.equal(source.includes("./level-engine"), false);
  assert.equal(source.includes("new LevelEngine"), false);
  assert.equal(resolveLevelRuntimeMode(), "old");
});
