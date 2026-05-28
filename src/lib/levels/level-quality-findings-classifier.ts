import type { LevelQualityAuditReport } from "./level-quality-audit-runner.js";

export type LevelQualityFindingType =
  | "limited_upside_extension_coverage"
  | "limited_downside_extension_coverage"
  | "missing_resistance_extension"
  | "missing_support_extension"
  | "clustered_levels_detected"
  | "possible_level_clutter"
  | "sparse_level_coverage"
  | "weak_context_levels_present"
  | "unenriched_levels_present"
  | "stale_levels_present"
  | "healthy_extension_coverage"
  | "no_engine_change_supported";

export type LevelQualityFindingSeverity = "info" | "watch" | "review";

export type LevelQualityFinding = {
  type: LevelQualityFindingType;
  severity: LevelQualityFindingSeverity;
  sampleCount: number;
  sampleSymbols: string[];
  evidence: string[];
  message: string;
};

export type LevelQualityRecommendedNextGate =
  | "extension_coverage_review"
  | "cluster_cleanup_review"
  | "thin_liquidity_handling_review"
  | "stale_freshness_review"
  | "confluence_enrichment_review"
  | "no_engine_change_yet";

export type LevelQualityFindingsReport = {
  sampleCount: number;
  findings: LevelQualityFinding[];
  recurringFindings: LevelQualityFinding[];
  recommendedNextGates: LevelQualityRecommendedNextGate[];
  safety: {
    noRuntimeBehaviorChange: true;
    noScoringChange: true;
    reviewOnly: true;
  };
};

type FindingSeed = {
  type: LevelQualityFindingType;
  severity: LevelQualityFindingSeverity;
  symbol: string;
  evidence: string;
};

const FINDING_ORDER: LevelQualityFindingType[] = [
  "missing_support_extension",
  "missing_resistance_extension",
  "limited_downside_extension_coverage",
  "limited_upside_extension_coverage",
  "clustered_levels_detected",
  "possible_level_clutter",
  "sparse_level_coverage",
  "stale_levels_present",
  "weak_context_levels_present",
  "unenriched_levels_present",
  "healthy_extension_coverage",
  "no_engine_change_supported",
];

const SPARSE_TOTAL_LEVEL_THRESHOLD = 6;

function asArray(input: LevelQualityAuditReport | LevelQualityAuditReport[]): LevelQualityAuditReport[] {
  return Array.isArray(input) ? input : [input];
}

function round(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${Math.round(value * 10000) / 10000}`;
}

function hasWarning(report: LevelQualityAuditReport, warning: string): boolean {
  return report.extensionCoverage.warnings.includes(warning) || report.diagnostics.includes(warning);
}

function extensionCoverageIsHealthy(report: LevelQualityAuditReport): boolean {
  return (
    report.extensionCoverage.supportExtensions > 0 &&
    report.extensionCoverage.resistanceExtensions > 0 &&
    report.extensionCoverage.warnings.length === 0
  );
}

function pushFinding(
  findings: FindingSeed[],
  report: LevelQualityAuditReport,
  type: LevelQualityFindingType,
  severity: LevelQualityFindingSeverity,
  evidence: string,
): void {
  findings.push({
    type,
    severity,
    symbol: report.symbol,
    evidence,
  });
}

function collectReportFindings(report: LevelQualityAuditReport): FindingSeed[] {
  const findings: FindingSeed[] = [];

  if (report.extensionCoverage.supportExtensions === 0 || hasWarning(report, "no_support_extension_coverage")) {
    pushFinding(
      findings,
      report,
      "missing_support_extension",
      "review",
      `${report.symbol}: support extension count is ${report.extensionCoverage.supportExtensions}`,
    );
  }
  if (report.extensionCoverage.resistanceExtensions === 0 || hasWarning(report, "no_resistance_extension_coverage")) {
    pushFinding(
      findings,
      report,
      "missing_resistance_extension",
      "review",
      `${report.symbol}: resistance extension count is ${report.extensionCoverage.resistanceExtensions}`,
    );
  }
  if (hasWarning(report, "limited_downside_extension_coverage")) {
    pushFinding(
      findings,
      report,
      "limited_downside_extension_coverage",
      "watch",
      `${report.symbol}: downside extension coverage is ${round(report.extensionCoverage.downsideCoveragePct)}%`,
    );
  }
  if (hasWarning(report, "limited_upside_extension_coverage")) {
    pushFinding(
      findings,
      report,
      "limited_upside_extension_coverage",
      "watch",
      `${report.symbol}: upside extension coverage is ${round(report.extensionCoverage.upsideCoveragePct)}%`,
    );
  }
  if (report.clusteredAreas.length > 0 || report.diagnostics.includes("clustered_level_areas_present")) {
    pushFinding(
      findings,
      report,
      "clustered_levels_detected",
      "review",
      `${report.symbol}: clustered area count is ${report.clusteredAreas.length}`,
    );
  }
  if (report.possibleClutterLevels.length > 0) {
    pushFinding(
      findings,
      report,
      "possible_level_clutter",
      "watch",
      `${report.symbol}: possible clutter level count is ${report.possibleClutterLevels.length}`,
    );
  }
  if (
    report.summary.totalLevels <= SPARSE_TOTAL_LEVEL_THRESHOLD ||
    report.summary.supportCount < 3 ||
    report.summary.resistanceCount < 3 ||
    report.nearbyCoverage.nearbySupportCount === 0 ||
    report.nearbyCoverage.nearbyResistanceCount === 0
  ) {
    pushFinding(
      findings,
      report,
      "sparse_level_coverage",
      "watch",
      `${report.symbol}: total ${report.summary.totalLevels}, nearby ${report.nearbyCoverage.nearbySupportCount}/${report.nearbyCoverage.nearbyResistanceCount}`,
    );
  }
  if (report.summary.staleCount > 0 || report.staleLevels.length > 0) {
    pushFinding(
      findings,
      report,
      "stale_levels_present",
      "watch",
      `${report.symbol}: stale level count is ${report.summary.staleCount}`,
    );
  }
  if (report.weakContextLevels.length > 0 || report.diagnostics.includes("levels_without_context_present")) {
    pushFinding(
      findings,
      report,
      "weak_context_levels_present",
      "watch",
      `${report.symbol}: weak context level count is ${report.weakContextLevels.length}`,
    );
  }
  if (report.summary.unenrichedCount > 0 || report.diagnostics.includes("unenriched_levels_present")) {
    pushFinding(
      findings,
      report,
      "unenriched_levels_present",
      "watch",
      `${report.symbol}: unenriched level count is ${report.summary.unenrichedCount}`,
    );
  }
  if (extensionCoverageIsHealthy(report)) {
    pushFinding(
      findings,
      report,
      "healthy_extension_coverage",
      "info",
      `${report.symbol}: support/resistance extension coverage has no audit warnings`,
    );
  }

  if (findings.every((finding) => finding.severity === "info")) {
    pushFinding(
      findings,
      report,
      "no_engine_change_supported",
      "info",
      `${report.symbol}: no review finding supports a level engine change from this sample alone`,
    );
  }

  return findings;
}

function findingMessage(type: LevelQualityFindingType): string {
  switch (type) {
    case "limited_upside_extension_coverage":
      return "Upside extension coverage is limited in the audit output.";
    case "limited_downside_extension_coverage":
      return "Downside extension coverage is limited in the audit output.";
    case "missing_resistance_extension":
      return "Resistance extension coverage is missing in the audit output.";
    case "missing_support_extension":
      return "Support extension coverage is missing in the audit output.";
    case "clustered_levels_detected":
      return "Clustered level areas are present in the audit output.";
    case "possible_level_clutter":
      return "Possible level clutter is present in the audit output.";
    case "sparse_level_coverage":
      return "Level coverage is sparse in the audit output.";
    case "weak_context_levels_present":
      return "Some levels have weak or missing context in the audit output.";
    case "unenriched_levels_present":
      return "Some levels are missing enrichedAnalysis metadata in the audit output.";
    case "stale_levels_present":
      return "Stale levels are present in the audit output.";
    case "healthy_extension_coverage":
      return "Extension coverage has no audit warnings.";
    case "no_engine_change_supported":
      return "Current audit evidence does not support a level engine change.";
  }
}

function aggregateFindings(seeds: FindingSeed[]): LevelQualityFinding[] {
  const byType = new Map<LevelQualityFindingType, FindingSeed[]>();

  for (const seed of seeds) {
    byType.set(seed.type, [...(byType.get(seed.type) ?? []), seed]);
  }

  return FINDING_ORDER
    .filter((type) => byType.has(type))
    .map((type) => {
      const typedSeeds = byType.get(type) ?? [];
      const severities = typedSeeds.map((seed) => seed.severity);
      const severity: LevelQualityFindingSeverity = severities.includes("review")
        ? "review"
        : severities.includes("watch")
          ? "watch"
          : "info";

      return {
        type,
        severity,
        sampleCount: new Set(typedSeeds.map((seed) => seed.symbol)).size,
        sampleSymbols: [...new Set(typedSeeds.map((seed) => seed.symbol))].sort(),
        evidence: [...new Set(typedSeeds.map((seed) => seed.evidence))].sort(),
        message: findingMessage(type),
      };
    });
}

function hasRecurring(findingByType: Map<LevelQualityFindingType, LevelQualityFinding>, types: LevelQualityFindingType[]): boolean {
  return types.some((type) => (findingByType.get(type)?.sampleCount ?? 0) > 1);
}

function buildRecommendedNextGates(
  findings: LevelQualityFinding[],
  sampleCount: number,
): LevelQualityRecommendedNextGate[] {
  const findingByType = new Map(findings.map((finding) => [finding.type, finding]));
  const gates: LevelQualityRecommendedNextGate[] = [];

  if (
    hasRecurring(findingByType, [
      "limited_upside_extension_coverage",
      "limited_downside_extension_coverage",
      "missing_resistance_extension",
      "missing_support_extension",
    ])
  ) {
    gates.push("extension_coverage_review");
  }
  if (hasRecurring(findingByType, ["clustered_levels_detected", "possible_level_clutter"])) {
    gates.push("cluster_cleanup_review");
  }
  if (hasRecurring(findingByType, ["sparse_level_coverage"])) {
    gates.push("thin_liquidity_handling_review");
  }
  if (hasRecurring(findingByType, ["stale_levels_present"])) {
    gates.push("stale_freshness_review");
  }
  if (hasRecurring(findingByType, ["weak_context_levels_present", "unenriched_levels_present"])) {
    gates.push("confluence_enrichment_review");
  }

  if (sampleCount < 2 || gates.length === 0) {
    gates.push("no_engine_change_yet");
  }

  return gates;
}

export function classifyLevelQualityFindings(
  input: LevelQualityAuditReport | LevelQualityAuditReport[],
): LevelQualityFindingsReport {
  const reports = asArray(input);
  const findings = aggregateFindings(reports.flatMap((report) => collectReportFindings(report)));
  const recurringFindings = findings.filter((finding) => finding.sampleCount > 1);

  return {
    sampleCount: reports.length,
    findings,
    recurringFindings,
    recommendedNextGates: buildRecommendedNextGates(findings, reports.length),
    safety: {
      noRuntimeBehaviorChange: true,
      noScoringChange: true,
      reviewOnly: true,
    },
  };
}
