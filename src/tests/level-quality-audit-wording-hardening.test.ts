import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildLevelQualityAuditReport,
} from "../lib/levels/level-quality-audit-runner.js";
import {
  classifyLevelQualityDiagnostic,
  describeLevelQualityDiagnostic,
  isLevelQualityDiagnosticFactualOnly,
  LEVEL_QUALITY_AUDIT_DIAGNOSTIC_LABELS,
} from "../lib/levels/level-quality-audit-wording.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";

const GENERATED_AT = Date.parse("2026-06-01T15:30:00-04:00");

const REQUIRED_CODES = [
  "wide_downside_support_gap",
  "wide_overhead_resistance_gap",
  "no_support_extension_coverage",
  "no_resistance_extension_coverage",
  "limited_upside_extension_coverage",
  "limited_downside_extension_coverage",
  "clustered_level_areas_present",
  "unenriched_levels_present",
  "unenriched_historical_levels_present",
  "unenriched_extension_levels_present",
  "unenriched_synthetic_levels_present",
  "levels_without_context_present",
  "reference_price_missing",
] as const;

function zone(
  id: string,
  kind: "support" | "resistance",
  representativePrice: number,
  overrides: Partial<FinalLevelZone> = {},
): FinalLevelZone {
  return {
    id,
    symbol: "WORD",
    kind,
    timeframeBias: "5m",
    zoneLow: representativePrice - 0.02,
    zoneHigh: representativePrice + 0.02,
    representativePrice,
    strengthScore: 60,
    strengthLabel: "moderate",
    touchCount: 2,
    confluenceCount: 1,
    sourceTypes: [kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.52,
    rejectionScore: 0.48,
    displacementScore: 0.4,
    sessionSignificanceScore: 0.35,
    followThroughScore: 0.42,
    sourceEvidenceCount: 1,
    firstTimestamp: Date.parse("2026-06-01T09:30:00-04:00"),
    lastTimestamp: Date.parse("2026-06-01T10:30:00-04:00"),
    isExtension: false,
    freshness: "fresh",
    notes: [],
    ...overrides,
  };
}

function levelOutput(overrides: Partial<LevelEngineOutput> = {}): LevelEngineOutput {
  const output: LevelEngineOutput = {
    symbol: "WORD",
    generatedAt: GENERATED_AT,
    metadata: {
      providerByTimeframe: { "5m": "fixture" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10,
    },
    majorSupport: [zone("support-wide", "support", 8.5)],
    majorResistance: [zone("resistance-wide", "resistance", 11.6)],
    intermediateSupport: [zone("support-cluster-a", "support", 9.01)],
    intermediateResistance: [zone("resistance-cluster-a", "resistance", 10.99)],
    intradaySupport: [zone("support-cluster-b", "support", 9.04)],
    intradayResistance: [zone("resistance-cluster-b", "resistance", 11.02)],
    extensionLevels: {
      support: [
        zone("support-extension", "support", 8.7, {
          isExtension: true,
          extensionMetadata: { extensionSource: "historical_candidate" },
        }),
      ],
      resistance: [
        zone("synthetic-resistance-extension", "resistance", 15, {
          isExtension: true,
          extensionMetadata: {
            extensionSource: "synthetic_continuation_map",
            generationMethod: "percentage_ladder",
            referencePrice: 10,
            targetCoveragePct: 50,
            maxCoveragePct: 50,
            syntheticIndex: 1,
            evidenceLimitations: [
              "no_real_extension_candidate_available",
              "not_historical_support_resistance",
              "no_touch_or_rejection_history",
            ],
          },
        }),
      ],
    },
    specialLevels: {},
  };

  return {
    ...output,
    ...overrides,
    metadata: {
      ...output.metadata,
      ...overrides.metadata,
    },
    extensionLevels: overrides.extensionLevels ?? output.extensionLevels,
  };
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

test("diagnostic codes have factual labels descriptions categories and severities", () => {
  for (const code of REQUIRED_CODES) {
    const description = describeLevelQualityDiagnostic(code);

    assert.equal(description.code, code);
    assert.equal(description.factualOnly, true);
    assert.equal(isLevelQualityDiagnosticFactualOnly(code), true);
    assert.equal(description.label.length > 0, true);
    assert.equal(description.description.length > 0, true);
    assertNoProhibitedLanguage(description);
  }

  assert.equal(classifyLevelQualityDiagnostic("wide_downside_support_gap"), "coverage");
  assert.equal(classifyLevelQualityDiagnostic("wide_overhead_resistance_gap"), "coverage");
  assert.equal(classifyLevelQualityDiagnostic("clustered_level_areas_present"), "density");
  assert.equal(classifyLevelQualityDiagnostic("unenriched_historical_levels_present"), "enrichment");
  assert.equal(classifyLevelQualityDiagnostic("unenriched_extension_levels_present"), "enrichment");
  assert.equal(classifyLevelQualityDiagnostic("unenriched_synthetic_levels_present"), "synthetic");
});

test("compatibility enrichment diagnostic remains supported with sharper specific diagnostics", () => {
  const broad = describeLevelQualityDiagnostic("unenriched_levels_present");
  const historical = describeLevelQualityDiagnostic("unenriched_historical_levels_present");
  const extension = describeLevelQualityDiagnostic("unenriched_extension_levels_present");
  const synthetic = describeLevelQualityDiagnostic("unenriched_synthetic_levels_present");

  assert.match(broad.description, /compatibility/);
  assert.match(historical.description, /historical support or resistance/);
  assert.match(extension.description, /extension row/);
  assert.equal(synthetic.category, "synthetic");
  assert.equal(synthetic.severity, "info");
  assertNoProhibitedLanguage([broad, historical, extension, synthetic]);
});

test("synthetic wording keeps continuation-map rows marked as forward context", () => {
  const synthetic = describeLevelQualityDiagnostic("unenriched_synthetic_levels_present");

  assert.match(synthetic.description, /marked synthetic continuation-map row/);
  assert.match(synthetic.description, /forward-planning context/);
  assert.doesNotMatch(synthetic.description, /\bis historical evidence\b/);
  assert.doesNotMatch(synthetic.description, /\bhistorical support\/resistance row\b/);
});

test("audit report carries additive diagnostic semantics without changing output or counts", () => {
  const output = levelOutput();
  const outputBefore = JSON.stringify(output);
  const report = buildLevelQualityAuditReport({
    output,
    clusterThresholdPct: 1,
    nearbyThresholdPct: 8,
    extensionCoverageWarningPct: 20,
  });

  assert.equal(JSON.stringify(output), outputBefore);
  assert.equal(report.summary.totalLevels, 8);
  assert.equal(report.summary.supportCount, 4);
  assert.equal(report.summary.resistanceCount, 4);
  assert.equal(report.extensionCoverage.supportExtensions, 1);
  assert.equal(report.extensionCoverage.resistanceExtensions, 1);
  assert(report.diagnostics.includes("wide_downside_support_gap"));
  assert(report.diagnostics.includes("wide_overhead_resistance_gap"));
  assert(report.diagnostics.includes("limited_downside_extension_coverage"));
  assert(report.diagnostics.includes("clustered_level_areas_present"));
  assert.equal(report.diagnosticSemantics?.length, report.diagnostics.length);
  assert.deepEqual(report.diagnosticSemantics?.map((item) => item.code), report.diagnostics);
  assertNoProhibitedLanguage(report.diagnosticSemantics);
});

test("wording catalog source stays isolated from LevelEngine alert monitoring Discord and journal paths", () => {
  const sourcePath = fileURLToPath(new URL("../lib/levels/level-quality-audit-wording.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("level-engine"), false);
  assert.equal(source.includes("new LevelEngine"), false);
  assert.equal(source.includes("../alerts"), false);
  assert.equal(source.includes("../monitoring"), false);
  assert.equal(source.toLowerCase().includes("discord"), false);
  assert.equal(source.includes("../trader-context"), false);
  assert.equal(resolveLevelRuntimeMode(), "old");
});

test("all catalog entries remain factual-only and use known categories", () => {
  const categories = new Set(["coverage", "density", "enrichment", "synthetic", "freshness", "context", "safety"]);
  const severities = new Set(["info", "watch", "review"]);

  for (const code of Object.keys(LEVEL_QUALITY_AUDIT_DIAGNOSTIC_LABELS)) {
    const description = describeLevelQualityDiagnostic(code);

    assert(categories.has(description.category));
    assert(severities.has(description.severity));
    assert.equal(description.factualOnly, true);
    assertNoProhibitedLanguage(description);
  }
});
