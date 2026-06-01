import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildLevelExtensions,
  buildLevelExtensionsWithDiagnostics,
} from "../lib/levels/level-extension-engine.js";
import { buildLevelQualityAuditReport } from "../lib/levels/level-quality-audit-runner.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import { buildValidationZone } from "./helpers/level-validation-fixtures.js";

const GENERATED_AT = Date.parse("2026-06-01T16:00:00.000Z");

function zone(
  params: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "kind" | "representativePrice">,
): FinalLevelZone {
  const zoneWidth = params.representativePrice * 0.005;

  return buildValidationZone({
    symbol: "EXTF",
    timeframeBias: "daily",
    timeframeSources: ["daily"],
    zoneLow: params.representativePrice - zoneWidth,
    zoneHigh: params.representativePrice + zoneWidth,
    strengthScore: 64,
    strengthLabel: "strong",
    touchCount: 3,
    confluenceCount: 1,
    rejectionScore: 0.58,
    displacementScore: 0.44,
    reactionQualityScore: 0.62,
    followThroughScore: 0.46,
    sourceEvidenceCount: 2,
    ...params,
  });
}

function extensionZone(
  id: string,
  kind: "support" | "resistance",
  representativePrice: number,
  overrides: Partial<FinalLevelZone> = {},
): FinalLevelZone {
  return zone({
    id,
    kind,
    representativePrice,
    isExtension: true,
    extensionMetadata: { extensionSource: "historical_candidate" },
    ...overrides,
  });
}

function levelOutput(overrides: Partial<LevelEngineOutput> = {}): LevelEngineOutput {
  const base: LevelEngineOutput = {
    symbol: "EXTF",
    generatedAt: GENERATED_AT,
    metadata: {
      providerByTimeframe: { "5m": "fixture", "4h": "fixture", daily: "fixture" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10,
    },
    majorSupport: [zone({ id: "major-support", kind: "support", representativePrice: 9 })],
    majorResistance: [zone({ id: "major-resistance", kind: "resistance", representativePrice: 11 })],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [],
    intradayResistance: [],
    extensionLevels: {
      support: [extensionZone("support-extension-deep", "support", 7)],
      resistance: [extensionZone("resistance-extension-deep", "resistance", 13)],
    },
    specialLevels: {},
  };

  return {
    ...base,
    ...overrides,
    metadata: {
      ...base.metadata,
      ...overrides.metadata,
    },
    extensionLevels: overrides.extensionLevels ?? base.extensionLevels,
    specialLevels: overrides.specialLevels ?? base.specialLevels,
  };
}

function extensionWarningCodes(output: LevelEngineOutput): string[] {
  return buildLevelQualityAuditReport({
    output,
    extensionCoverageWarningPct: 20,
    clusterThresholdPct: 0.5,
    nearbyThresholdPct: 8,
  }).extensionCoverage.warnings;
}

test("balanced extension coverage is represented without coverage warnings or synthetic rows", () => {
  const output = levelOutput();
  const report = buildLevelQualityAuditReport({
    output,
    extensionCoverageWarningPct: 20,
    clusterThresholdPct: 0.5,
  });

  assert.equal(report.extensionCoverage.supportExtensions, 1);
  assert.equal(report.extensionCoverage.resistanceExtensions, 1);
  assert.equal(report.extensionCoverage.downsideCoveragePct, 30);
  assert.equal(report.extensionCoverage.upsideCoveragePct, 30);
  assert.deepEqual(report.extensionCoverage.warnings, []);
  assert.equal(
    [...output.extensionLevels.support, ...output.extensionLevels.resistance].some(
      (level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map",
    ),
    false,
  );
});

test("missing resistance extension coverage is an audit warning and does not fabricate rows", () => {
  const output = levelOutput({
    extensionLevels: {
      support: [extensionZone("support-extension-deep", "support", 7)],
      resistance: [],
    },
  });
  const outputBefore = JSON.stringify(output);
  const report = buildLevelQualityAuditReport({
    output,
    extensionCoverageWarningPct: 20,
  });

  assert.equal(JSON.stringify(output), outputBefore);
  assert.equal(report.extensionCoverage.supportExtensions, 1);
  assert.equal(report.extensionCoverage.resistanceExtensions, 0);
  assert(report.extensionCoverage.warnings.includes("no_resistance_extension_coverage"));
  assert(report.diagnostics.includes("no_resistance_extension_coverage"));
  assert.equal(output.extensionLevels.resistance.length, 0);
});

test("limited downside extension coverage is reported while selected rows stay factual", () => {
  const output = levelOutput({
    extensionLevels: {
      support: [extensionZone("support-extension-shallow", "support", 9)],
      resistance: [extensionZone("resistance-extension-deep", "resistance", 13)],
    },
  });
  const report = buildLevelQualityAuditReport({
    output,
    extensionCoverageWarningPct: 20,
  });

  assert.equal(report.extensionCoverage.downsideCoveragePct, 10);
  assert(report.extensionCoverage.warnings.includes("limited_downside_extension_coverage"));
  assert.equal(report.extensionCoverage.warnings.includes("no_support_extension_coverage"), false);
  assert.equal(output.extensionLevels.support[0]?.extensionMetadata?.extensionSource, "historical_candidate");
  assert.notEqual(output.extensionLevels.support[0]?.extensionMetadata?.extensionSource, "synthetic_continuation_map");
});

test("synthetic continuation-map rows remain marked forward context and separate from historical enrichment gaps", () => {
  const surfacedResistance = [zone({ id: "visible-resistance", kind: "resistance", representativePrice: 11 })];
  const extensionLevels = buildLevelExtensions({
    supportZones: [],
    resistanceZones: surfacedResistance,
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 10,
    spacingPct: 0.01,
    searchWindowPct: 0.05,
  });
  const output = levelOutput({
    extensionLevels: {
      support: [],
      resistance: extensionLevels.resistance,
    },
  });
  const report = buildLevelQualityAuditReport({ output, extensionCoverageWarningPct: 20 });
  const syntheticIds = extensionLevels.resistance.map((level) => level.id);

  assert.equal(extensionLevels.resistance.length, 2);
  for (const level of extensionLevels.resistance) {
    assert.equal(level.extensionMetadata?.extensionSource, "synthetic_continuation_map");
    assert(level.notes.some((note) => note.includes("forward planning only")));
    assert(level.notes.some((note) => note.includes("not historical support/resistance")));
    assert.equal(level.sourceEvidenceCount, 0);
    assert.deepEqual(level.sourceTypes, []);
  }
  assert.deepEqual(report.enrichmentBreakdown?.synthetic.unenrichedLevelIds, syntheticIds);
  assert.equal(
    report.enrichmentBreakdown?.historical.unenrichedLevelIds.some((id) => syntheticIds.includes(id)),
    false,
  );
  assert.equal(
    report.enrichmentBreakdown?.extension.unenrichedLevelIds.some((id) => syntheticIds.includes(id)),
    false,
  );
  assert(report.diagnostics.includes("unenriched_synthetic_levels_present"));
  assert.equal(
    report.diagnosticSemantics?.find((semantic) => semantic.code === "unenriched_synthetic_levels_present")?.category,
    "synthetic",
  );
});

test("spacing diagnostics lock current behavior without tuning extension selection", () => {
  const surfacedResistance = [zone({ id: "surfaced-resistance", kind: "resistance", representativePrice: 11 })];
  const resistanceZones = [
    ...surfacedResistance,
    zone({ id: "resistance-close-a", kind: "resistance", representativePrice: 13 }),
    zone({ id: "resistance-close-b", kind: "resistance", representativePrice: 13.05 }),
    zone({ id: "resistance-far", kind: "resistance", representativePrice: 15 }),
  ];
  const result = buildLevelExtensionsWithDiagnostics({
    supportZones: [],
    resistanceZones,
    surfacedSupport: [],
    surfacedResistance,
    referencePrice: 10,
    maxExtensionPerSide: 3,
    spacingPct: 0.01,
    searchWindowPct: 0.05,
    syntheticExtensionOptions: { enabled: false },
  });
  const closeCandidate = result.diagnostics.resistance.candidates.find(
    (candidate) => candidate.id === "resistance-close-b",
  );

  assert.deepEqual(
    result.extensionLevels.resistance.map((level) => level.id),
    ["resistance-close-a", "resistance-far"],
  );
  assert.equal(closeCandidate?.isSelectedExtension, false);
  assert(closeCandidate?.skipReasons.includes("too_close_to_another_extension"));
  assert.equal(result.diagnostics.resistance.rejectionReasonCounts.too_close_to_another_extension, 1);
  assert.equal(result.diagnostics.safety.extensionGenerationUnchanged, true);
  assert.equal(result.diagnostics.safety.diagnosticOnly, true);
});

test("extension fixture pack source stays isolated from 15m LevelEngine input and alert monitoring Discord paths", () => {
  const sourceFiles = [
    "../lib/levels/level-extension-engine.ts",
    "../lib/levels/level-quality-audit-runner.ts",
  ].map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));

  for (const source of sourceFiles) {
    assert.equal(source.includes("15m"), false);
    assert.equal(source.includes("../alerts"), false);
    assert.equal(source.includes("../monitoring"), false);
    assert.equal(source.toLowerCase().includes("discord"), false);
    assert.equal(source.toLowerCase().includes("recommendation"), false);
    assert.equal(source.toLowerCase().includes("trade advice"), false);
  }

  assert.deepEqual(
    extensionWarningCodes(levelOutput({ extensionLevels: { support: [], resistance: [] } })).sort(),
    ["no_resistance_extension_coverage", "no_support_extension_coverage"].sort(),
  );
});
