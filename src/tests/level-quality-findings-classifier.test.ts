import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  classifyLevelQualityFindings,
  type LevelQualityFindingType,
} from "../lib/levels/level-quality-findings-classifier.js";
import type {
  LevelQualityCluster,
  LevelQualityAuditItem,
  LevelQualityAuditReport,
} from "../lib/levels/level-quality-audit-runner.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";

const GENERATED_AT = Date.parse("2026-05-28T10:00:00-04:00");

function item(
  levelId: string,
  kind: "support" | "resistance",
  representativePrice: number,
  overrides: Partial<LevelQualityAuditItem> = {},
): LevelQualityAuditItem {
  return {
    levelId,
    symbol: "FIND",
    kind,
    bucket: kind === "support" ? "majorSupport" : "majorResistance",
    representativePrice,
    zoneLow: representativePrice - 0.05,
    zoneHigh: representativePrice + 0.05,
    strengthScore: 70,
    strengthLabel: "strong",
    auditScore: 0.7,
    freshness: "fresh",
    touchCount: 3,
    confluenceCount: 2,
    isExtension: false,
    hasEnrichedAnalysis: false,
    contextCounts: {
      session: 0,
      volume: 0,
      shelf: 0,
      marketContext: 0,
    },
    diagnostics: [],
    ...overrides,
  };
}

function auditReport(overrides: Partial<LevelQualityAuditReport> = {}): LevelQualityAuditReport {
  const nearestSupport = item("support-near", "support", 9.8);
  const nearestResistance = item("resistance-near", "resistance", 10.2);

  const base: LevelQualityAuditReport = {
    symbol: "FIND",
    generatedAt: GENERATED_AT,
    referencePrice: 10,
    summary: {
      totalLevels: 8,
      supportCount: 4,
      resistanceCount: 4,
      extensionCount: 2,
      freshCount: 6,
      staleCount: 0,
      enrichedCount: 0,
      unenrichedCount: 8,
    },
    strongestLevels: [item("strong-resistance", "resistance", 11)],
    weakestLevels: [item("weak-support", "support", 9, { auditScore: 0.4, strengthScore: 40, strengthLabel: "weak" })],
    staleLevels: [],
    freshLevels: [nearestSupport, nearestResistance],
    strongConfluenceLevels: [item("confluence-resistance", "resistance", 11.5)],
    weakContextLevels: [],
    enrichedLevels: [],
    unenrichedLevels: [nearestSupport, nearestResistance],
    possibleClutterLevels: [],
    clusteredAreas: [],
    extensionCoverage: {
      supportExtensions: 1,
      resistanceExtensions: 1,
      highestResistanceExtension: 12.5,
      lowestSupportExtension: 8,
      upsideCoveragePct: 25,
      downsideCoveragePct: 20,
      warnings: [],
    },
    nearbyCoverage: {
      referencePrice: 10,
      nearbySupportCount: 2,
      nearbyResistanceCount: 2,
      nearestSupport,
      nearestResistance,
      overheadResistanceGapPct: 2,
      downsideSupportGapPct: 2,
      warnings: [],
    },
    confluenceSummary: {
      sessionConfluenceCount: 0,
      volumeConfluenceCount: 0,
      shelfConfluenceCount: 0,
      marketContextConfluenceCount: 0,
    },
    diagnostics: ["unenriched_levels_present"],
    safety: {
      levelOutputUnchanged: true,
      noRuntimeBehaviorChange: true,
      noScoringChange: true,
    },
  };

  return {
    ...base,
    ...overrides,
    summary: {
      ...base.summary,
      ...overrides.summary,
    },
    extensionCoverage: {
      ...base.extensionCoverage,
      ...overrides.extensionCoverage,
    },
    nearbyCoverage: {
      ...base.nearbyCoverage,
      ...overrides.nearbyCoverage,
    },
    confluenceSummary: {
      ...base.confluenceSummary,
      ...overrides.confluenceSummary,
    },
    safety: {
      ...base.safety,
      ...overrides.safety,
    },
  };
}

function findingTypes(report: ReturnType<typeof classifyLevelQualityFindings>): LevelQualityFindingType[] {
  return report.findings.map((finding) => finding.type);
}

function byType(report: ReturnType<typeof classifyLevelQualityFindings>, type: LevelQualityFindingType) {
  return report.findings.find((finding) => finding.type === type);
}

test("classifies limited upside extension coverage", () => {
  const report = classifyLevelQualityFindings(auditReport({
    extensionCoverage: {
      supportExtensions: 1,
      resistanceExtensions: 1,
      highestResistanceExtension: 11.5,
      lowestSupportExtension: 8,
      upsideCoveragePct: 15,
      downsideCoveragePct: 20,
      warnings: ["limited_upside_extension_coverage"],
    },
  }));

  assert(findingTypes(report).includes("limited_upside_extension_coverage"));
  assert.equal(byType(report, "limited_upside_extension_coverage")?.severity, "watch");
  assert(report.recommendedNextGates.includes("no_engine_change_yet"));
});

test("classifies limited downside extension coverage", () => {
  const report = classifyLevelQualityFindings(auditReport({
    extensionCoverage: {
      supportExtensions: 1,
      resistanceExtensions: 1,
      highestResistanceExtension: 12.5,
      lowestSupportExtension: 8.6,
      upsideCoveragePct: 25,
      downsideCoveragePct: 14,
      warnings: ["limited_downside_extension_coverage"],
    },
  }));

  assert(findingTypes(report).includes("limited_downside_extension_coverage"));
  assert.deepEqual(byType(report, "limited_downside_extension_coverage")?.sampleSymbols, ["FIND"]);
});

test("classifies missing resistance extension", () => {
  const report = classifyLevelQualityFindings(auditReport({
    extensionCoverage: {
      supportExtensions: 1,
      resistanceExtensions: 0,
      highestResistanceExtension: undefined,
      lowestSupportExtension: 8,
      upsideCoveragePct: undefined,
      downsideCoveragePct: 20,
      warnings: ["no_resistance_extension_coverage"],
    },
  }));

  assert(findingTypes(report).includes("missing_resistance_extension"));
  assert.equal(byType(report, "missing_resistance_extension")?.severity, "review");
});

test("classifies clustered levels and possible clutter", () => {
  const clutterLevel = item("cluster-support", "support", 9.9);
  const report = classifyLevelQualityFindings(auditReport({
    possibleClutterLevels: [clutterLevel],
    clusteredAreas: [
      {
        kind: "support",
        zoneLow: 9.8,
        zoneHigh: 10,
        representativePrices: [9.85, 9.9],
        levelIds: ["cluster-support-a", "cluster-support-b"],
        buckets: ["intermediateSupport", "intradaySupport"],
        maxDistancePct: 0.5,
        reason: "Fixture clustered area.",
      },
    ],
    diagnostics: ["clustered_level_areas_present"],
  }));

  assert(findingTypes(report).includes("clustered_levels_detected"));
  assert(findingTypes(report).includes("possible_level_clutter"));
});

test("classifies sparse coverage", () => {
  const report = classifyLevelQualityFindings(auditReport({
    summary: {
      totalLevels: 5,
      supportCount: 2,
      resistanceCount: 3,
      extensionCount: 1,
      freshCount: 4,
      staleCount: 1,
      enrichedCount: 0,
      unenrichedCount: 5,
    },
    nearbyCoverage: {
      referencePrice: 10,
      nearbySupportCount: 0,
      nearbyResistanceCount: 2,
      warnings: ["no_nearby_support"],
    },
  }));

  assert(findingTypes(report).includes("sparse_level_coverage"));
  assert.equal(byType(report, "sparse_level_coverage")?.severity, "watch");
});

test("classifies healthy extension coverage", () => {
  const report = classifyLevelQualityFindings(auditReport());

  assert(findingTypes(report).includes("healthy_extension_coverage"));
});

test("aggregates recurring findings across multiple reports", () => {
  const first = auditReport({
    symbol: "ONE",
    extensionCoverage: {
      supportExtensions: 1,
      resistanceExtensions: 1,
      highestResistanceExtension: 11,
      lowestSupportExtension: 8,
      upsideCoveragePct: 10,
      downsideCoveragePct: 20,
      warnings: ["limited_upside_extension_coverage"],
    },
  });
  const second = auditReport({
    symbol: "TWO",
    extensionCoverage: {
      supportExtensions: 1,
      resistanceExtensions: 1,
      highestResistanceExtension: 21,
      lowestSupportExtension: 16,
      upsideCoveragePct: 10,
      downsideCoveragePct: 20,
      warnings: ["limited_upside_extension_coverage"],
    },
  });
  const report = classifyLevelQualityFindings([first, second]);
  const recurring = report.recurringFindings.map((finding) => finding.type);

  assert.equal(report.sampleCount, 2);
  assert(recurring.includes("limited_upside_extension_coverage"));
  assert.equal(byType(report, "limited_upside_extension_coverage")?.sampleCount, 2);
});

test("recommends extension coverage review when extension issues recur", () => {
  const report = classifyLevelQualityFindings([
    auditReport({
      symbol: "ONE",
      extensionCoverage: {
        supportExtensions: 1,
        resistanceExtensions: 0,
        highestResistanceExtension: undefined,
        lowestSupportExtension: 8,
        upsideCoveragePct: undefined,
        downsideCoveragePct: 20,
        warnings: ["no_resistance_extension_coverage"],
      },
    }),
    auditReport({
      symbol: "TWO",
      extensionCoverage: {
        supportExtensions: 1,
        resistanceExtensions: 0,
        highestResistanceExtension: undefined,
        lowestSupportExtension: 8,
        upsideCoveragePct: undefined,
        downsideCoveragePct: 20,
        warnings: ["no_resistance_extension_coverage"],
      },
    }),
  ]);

  assert(report.recommendedNextGates.includes("extension_coverage_review"));
});

test("recommends cluster cleanup review when clusters recur", () => {
  const cluster: LevelQualityCluster = {
    kind: "mixed" as const,
    zoneLow: 9.8,
    zoneHigh: 10.1,
    representativePrices: [9.9, 10],
    levelIds: ["a", "b"],
    buckets: ["intermediateSupport", "intradaySupport"],
    maxDistancePct: 1,
    reason: "Fixture cluster.",
  };
  const report = classifyLevelQualityFindings([
    auditReport({ symbol: "ONE", clusteredAreas: [cluster], diagnostics: ["clustered_level_areas_present"] }),
    auditReport({ symbol: "TWO", clusteredAreas: [cluster], diagnostics: ["clustered_level_areas_present"] }),
  ]);

  assert(report.recommendedNextGates.includes("cluster_cleanup_review"));
});

test("recommends no engine change when evidence is insufficient", () => {
  const report = classifyLevelQualityFindings(auditReport({
    extensionCoverage: {
      supportExtensions: 1,
      resistanceExtensions: 1,
      highestResistanceExtension: 11,
      lowestSupportExtension: 8,
      upsideCoveragePct: 10,
      downsideCoveragePct: 20,
      warnings: ["limited_upside_extension_coverage"],
    },
  }));

  assert.deepEqual(report.recommendedNextGates, ["no_engine_change_yet"]);
});

test("is deterministic and does not mutate input audit reports", () => {
  const input = [
    auditReport({ symbol: "ONE" }),
    auditReport({ symbol: "TWO", weakContextLevels: [item("weak-context", "support", 9.7)] }),
  ];
  const before = JSON.stringify(input);
  const first = classifyLevelQualityFindings(input);
  const second = classifyLevelQualityFindings(input);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), before);
  assert.equal(first.safety.noRuntimeBehaviorChange, true);
  assert.equal(first.safety.noScoringChange, true);
  assert.equal(first.safety.reviewOnly, true);
});

test("does not import LevelEngine and keeps runtime defaults unchanged", () => {
  const sourcePath = fileURLToPath(new URL("../lib/levels/level-quality-findings-classifier.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("level-engine"), false);
  assert.equal(source.includes("new LevelEngine"), false);
  assert.equal(resolveLevelRuntimeMode(), "old");
});
