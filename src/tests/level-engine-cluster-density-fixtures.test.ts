import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildLevelQualityAuditReport } from "../lib/levels/level-quality-audit-runner.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import { buildValidationZone } from "./helpers/level-validation-fixtures.js";

const GENERATED_AT = Date.parse("2026-06-01T16:00:00.000Z");

function zone(
  params: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "kind" | "representativePrice">,
): FinalLevelZone {
  const zoneWidth = Math.max(params.representativePrice * 0.0025, 0.01);

  return buildValidationZone({
    symbol: "DENS",
    timeframeBias: "5m",
    timeframeSources: ["5m"],
    zoneLow: params.representativePrice - zoneWidth,
    zoneHigh: params.representativePrice + zoneWidth,
    strengthScore: 58,
    strengthLabel: "moderate",
    touchCount: 3,
    confluenceCount: 1,
    rejectionScore: 0.42,
    displacementScore: 0.36,
    reactionQualityScore: 0.55,
    followThroughScore: 0.4,
    sourceEvidenceCount: 2,
    ...params,
  });
}

function extensionZone(id: string, kind: "support" | "resistance", representativePrice: number): FinalLevelZone {
  return zone({
    id,
    kind,
    representativePrice,
    isExtension: true,
    extensionMetadata: { extensionSource: "historical_candidate" },
  });
}

function levelOutput(overrides: Partial<LevelEngineOutput> = {}): LevelEngineOutput {
  const base: LevelEngineOutput = {
    symbol: "DENS",
    generatedAt: GENERATED_AT,
    metadata: {
      providerByTimeframe: { "5m": "fixture", "4h": "fixture", daily: "fixture" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10,
    },
    majorSupport: [zone({ id: "major-support-850", kind: "support", representativePrice: 8.5 })],
    majorResistance: [zone({ id: "major-resistance-1150", kind: "resistance", representativePrice: 11.5 })],
    intermediateSupport: [zone({ id: "intermediate-support-920", kind: "support", representativePrice: 9.2 })],
    intermediateResistance: [zone({ id: "intermediate-resistance-1080", kind: "resistance", representativePrice: 10.8 })],
    intradaySupport: [zone({ id: "intraday-support-970", kind: "support", representativePrice: 9.7 })],
    intradayResistance: [zone({ id: "intraday-resistance-1030", kind: "resistance", representativePrice: 10.3 })],
    extensionLevels: {
      support: [extensionZone("extension-support-700", "support", 7)],
      resistance: [extensionZone("extension-resistance-1300", "resistance", 13)],
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

function audit(output: LevelEngineOutput, clusterThresholdPct = 1) {
  return buildLevelQualityAuditReport({
    output,
    clusterThresholdPct,
    nearbyThresholdPct: 8,
    extensionCoverageWarningPct: 20,
    maxItems: 10,
  });
}

function assertNoProhibitedLanguage(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();
  const prohibited = [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["hold", /\bhold\b/],
    ["recommendation", /\brecommendation\b/],
    ["trade advice", /trade advice/],
    ["grade", /\bgrade\b/],
    ["grading", /\bgrading\b/],
    ["coaching", /\bcoaching\b/],
    ["coach", /\bcoach\b/],
    ["p/l", /p\/l/],
    ["pnl", /\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior score", /behavior score/],
    ["good trade", /good trade/],
    ["bad trade", /bad trade/],
    ["should have", /should have/],
    ["mistake", /\bmistake\b/],
    ["discipline", /\bdiscipline\b/],
  ] as const;

  for (const [label, pattern] of prohibited) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} wording`);
  }
}

test("sparse map reports no clustered areas", () => {
  const output = levelOutput();
  const report = audit(output);

  assert.equal(report.clusteredAreas.length, 0);
  assert.deepEqual(report.possibleClutterLevels, []);
  assert.equal(report.diagnostics.includes("clustered_level_areas_present"), false);
});

test("support-only cluster is diagnostic-only and preserves surfaced levels", () => {
  const output = levelOutput({
    majorSupport: [zone({ id: "support-cluster-a", kind: "support", representativePrice: 9.8 })],
    intermediateSupport: [zone({ id: "support-cluster-b", kind: "support", representativePrice: 9.86 })],
    intradaySupport: [zone({ id: "support-far", kind: "support", representativePrice: 8.9 })],
  });
  const before = JSON.stringify(output);
  const report = audit(output);

  assert.equal(JSON.stringify(output), before);
  assert.equal(report.clusteredAreas.length, 1);
  assert.equal(report.clusteredAreas[0]?.kind, "support");
  assert.deepEqual(report.clusteredAreas[0]?.levelIds, ["support-cluster-a", "support-cluster-b"]);
  assert.deepEqual(
    report.possibleClutterLevels.map((item) => item.levelId),
    ["support-cluster-a", "support-cluster-b"],
  );
  assert(report.diagnostics.includes("clustered_level_areas_present"));
  assert.deepEqual(
    output.majorSupport.concat(output.intermediateSupport).map((level) => level.id),
    ["support-cluster-a", "support-cluster-b"],
  );
});

test("resistance-only cluster is diagnostic-only and preserves surfaced levels", () => {
  const output = levelOutput({
    majorResistance: [zone({ id: "resistance-cluster-a", kind: "resistance", representativePrice: 10.2 })],
    intermediateResistance: [zone({ id: "resistance-cluster-b", kind: "resistance", representativePrice: 10.28 })],
    intradayResistance: [zone({ id: "resistance-far", kind: "resistance", representativePrice: 11.2 })],
  });
  const report = audit(output);

  assert.equal(report.clusteredAreas.length, 1);
  assert.equal(report.clusteredAreas[0]?.kind, "resistance");
  assert.deepEqual(report.clusteredAreas[0]?.levelIds, ["resistance-cluster-a", "resistance-cluster-b"]);
  assert.deepEqual(
    report.possibleClutterLevels.map((item) => item.levelId),
    ["resistance-cluster-a", "resistance-cluster-b"],
  );
  assert.deepEqual(
    output.majorResistance.concat(output.intermediateResistance).map((level) => level.id),
    ["resistance-cluster-a", "resistance-cluster-b"],
  );
});

test("mixed cluster keeps support and resistance sides intact", () => {
  const output = levelOutput({
    intradaySupport: [zone({ id: "support-near-reference", kind: "support", representativePrice: 9.99 })],
    intradayResistance: [zone({ id: "resistance-near-reference", kind: "resistance", representativePrice: 10.02 })],
  });
  const report = audit(output);

  assert.equal(report.clusteredAreas.length, 1);
  assert.equal(report.clusteredAreas[0]?.kind, "mixed");
  assert.deepEqual(report.clusteredAreas[0]?.levelIds, [
    "support-near-reference",
    "resistance-near-reference",
  ]);
  assert.deepEqual(report.clusteredAreas[0]?.buckets, ["intradaySupport", "intradayResistance"]);
  assert.equal(report.nearbyCoverage.nearestSupport?.levelId, "support-near-reference");
  assert.equal(report.nearbyCoverage.nearestSupport?.kind, "support");
  assert.equal(report.nearbyCoverage.nearestResistance?.levelId, "resistance-near-reference");
  assert.equal(report.nearbyCoverage.nearestResistance?.kind, "resistance");
});

test("dense clustered map surfaces factual density diagnostics without retuning levels", () => {
  const output = levelOutput({
    majorSupport: [zone({ id: "dense-support-a", kind: "support", representativePrice: 9.82 })],
    intermediateSupport: [zone({ id: "dense-support-b", kind: "support", representativePrice: 9.86 })],
    intradaySupport: [zone({ id: "dense-support-c", kind: "support", representativePrice: 9.9 })],
    majorResistance: [zone({ id: "dense-resistance-a", kind: "resistance", representativePrice: 10.04 })],
    intermediateResistance: [zone({ id: "dense-resistance-b", kind: "resistance", representativePrice: 10.08 })],
    intradayResistance: [zone({ id: "dense-resistance-c", kind: "resistance", representativePrice: 10.12 })],
  });
  const report = audit(output, 3);
  const densitySemantic = report.diagnosticSemantics?.find(
    (semantic) => semantic.code === "clustered_level_areas_present",
  );

  assert.equal(report.clusteredAreas.length, 1);
  assert.equal(report.clusteredAreas[0]?.kind, "mixed");
  assert.equal(report.clusteredAreas[0]?.levelIds.length, 5);
  assert.deepEqual(report.clusteredAreas[0]?.levelIds, [
    "dense-support-a",
    "dense-support-b",
    "dense-support-c",
    "dense-resistance-a",
    "dense-resistance-b",
  ]);
  assert.equal(report.possibleClutterLevels.length, 5);
  assert(report.diagnostics.includes("clustered_level_areas_present"));
  assert.equal(densitySemantic?.category, "density");
  assert.equal(densitySemantic?.factualOnly, true);
  assertNoProhibitedLanguage(densitySemantic);
  assert.equal(report.safety.levelOutputUnchanged, true);
});

test("large separated map documents dense review cases without cluster diagnostics", () => {
  const output = levelOutput({
    majorSupport: [zone({ id: "separated-support-a", kind: "support", representativePrice: 7.8 })],
    intermediateSupport: [
      zone({ id: "separated-support-b", kind: "support", representativePrice: 8.4 }),
      zone({ id: "separated-support-c", kind: "support", representativePrice: 9.0 }),
    ],
    intradaySupport: [
      zone({ id: "separated-support-d", kind: "support", representativePrice: 9.55 }),
      zone({ id: "separated-support-e", kind: "support", representativePrice: 9.72 }),
    ],
    majorResistance: [zone({ id: "separated-resistance-a", kind: "resistance", representativePrice: 10.28 })],
    intermediateResistance: [
      zone({ id: "separated-resistance-b", kind: "resistance", representativePrice: 10.75 }),
      zone({ id: "separated-resistance-c", kind: "resistance", representativePrice: 11.25 }),
    ],
    intradayResistance: [
      zone({ id: "separated-resistance-d", kind: "resistance", representativePrice: 11.8 }),
      zone({ id: "separated-resistance-e", kind: "resistance", representativePrice: 12.4 }),
    ],
  });
  const report = audit(output, 1);

  assert.equal(report.summary.totalLevels, 12);
  assert.equal(report.clusteredAreas.length, 0);
  assert.equal(report.diagnostics.includes("clustered_level_areas_present"), false);
  assert.equal(report.nearbyCoverage.nearestSupport?.levelId, "separated-support-e");
  assert.equal(report.nearbyCoverage.nearestResistance?.levelId, "separated-resistance-a");
});

test("nearest levels are preserved when nearby clusters are only audited", () => {
  const output = levelOutput({
    intradaySupport: [
      zone({ id: "nearest-support", kind: "support", representativePrice: 9.98 }),
      zone({ id: "support-near-duplicate", kind: "support", representativePrice: 9.94 }),
    ],
    intradayResistance: [
      zone({ id: "nearest-resistance", kind: "resistance", representativePrice: 10.04 }),
      zone({ id: "resistance-near-duplicate", kind: "resistance", representativePrice: 10.08 }),
    ],
  });
  const before = JSON.stringify(output);
  const report = audit(output, 1);

  assert.equal(JSON.stringify(output), before);
  assert.equal(report.nearbyCoverage.nearestSupport?.levelId, "nearest-support");
  assert.equal(report.nearbyCoverage.nearestResistance?.levelId, "nearest-resistance");
  assert(report.clusteredAreas.length > 0);
  assert(report.diagnostics.includes("clustered_level_areas_present"));
});

test("cluster density fixture source stays isolated from alert monitoring Discord and advice paths", () => {
  const sourceFiles = [
    "../lib/levels/level-clusterer.ts",
    "../lib/levels/level-ranker.ts",
    "../lib/levels/level-ranking.ts",
    "../lib/levels/level-zone-utils.ts",
    "../lib/levels/level-quality-audit-runner.ts",
  ].map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));

  for (const source of sourceFiles) {
    assert.equal(source.includes("../alerts"), false);
    assert.equal(source.includes("../monitoring"), false);
    assert.equal(source.toLowerCase().includes("discord"), false);
    assert.equal(source.toLowerCase().includes("trade advice"), false);
  }
});
