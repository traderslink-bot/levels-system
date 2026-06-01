import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  buildLevelQualityAuditReport,
  type LevelQualityCluster,
  type LevelQualityAuditItem,
  type LevelQualityAuditReport,
} from "./level-quality-audit-runner.js";
import { describeLevelQualityDiagnostic } from "./level-quality-audit-wording.js";
import type { LevelIntelligenceReport } from "./level-intelligence-report.js";
import type { LevelEngineOutput } from "./level-types.js";

export type LevelQualityAuditReviewFormat = "text" | "json";

export type LevelQualityAuditReviewRunnerOptions = {
  levelOutputPath: string;
  levelIntelligenceReportPath?: string;
  outPath?: string;
  format: LevelQualityAuditReviewFormat;
};

export type LevelQualityAuditReviewRunnerResult = {
  levelOutputPath: string;
  levelIntelligenceReportPath?: string;
  outPath?: string;
  format: LevelQualityAuditReviewFormat;
  report: LevelQualityAuditReport;
  content: string;
};

export type LevelQualityAuditReviewRunnerFileSystem = {
  readFileSync: typeof readFileSync;
  writeFileSync: typeof writeFileSync;
  mkdirSync: typeof mkdirSync;
};

const defaultFileSystem: LevelQualityAuditReviewRunnerFileSystem = {
  readFileSync,
  writeFileSync,
  mkdirSync,
};

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function parseFormat(value: string | undefined): LevelQualityAuditReviewFormat {
  if (value === undefined) {
    return "text";
  }
  if (value === "text" || value === "json") {
    return value;
  }

  throw new Error(`Unsupported --format value "${value}". Expected text or json.`);
}

export function parseLevelQualityAuditReviewRunnerArgs(
  args: string[],
): LevelQualityAuditReviewRunnerOptions {
  let levelOutputPath: string | undefined;
  let levelIntelligenceReportPath: string | undefined;
  let outPath: string | undefined;
  let format: LevelQualityAuditReviewFormat = "text";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--level-output") {
      levelOutputPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--level-intelligence-report") {
      levelIntelligenceReportPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out") {
      outPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--format") {
      format = parseFormat(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument "${arg}".`);
  }

  if (!levelOutputPath) {
    throw new Error("Missing required --level-output <path>.");
  }

  return {
    levelOutputPath,
    levelIntelligenceReportPath,
    outPath,
    format,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertLevelEngineOutput(value: unknown): asserts value is LevelEngineOutput {
  if (!isRecord(value)) {
    throw new Error("Level output JSON must contain an object.");
  }
  if (typeof value.symbol !== "string" || value.symbol.length === 0) {
    throw new Error("Level output JSON is missing symbol.");
  }
  if (typeof value.generatedAt !== "number") {
    throw new Error("Level output JSON is missing generatedAt.");
  }
  if (!isRecord(value.metadata)) {
    throw new Error("Level output JSON is missing metadata.");
  }

  for (const bucket of [
    "majorSupport",
    "majorResistance",
    "intermediateSupport",
    "intermediateResistance",
    "intradaySupport",
    "intradayResistance",
  ] as const) {
    if (!Array.isArray(value[bucket])) {
      throw new Error(`Level output JSON is missing ${bucket}.`);
    }
  }

  if (!isRecord(value.extensionLevels)) {
    throw new Error("Level output JSON is missing extensionLevels.");
  }
  if (!Array.isArray(value.extensionLevels.support) || !Array.isArray(value.extensionLevels.resistance)) {
    throw new Error("Level output JSON extensionLevels must include support and resistance arrays.");
  }
}

function assertLevelIntelligenceReport(value: unknown): asserts value is LevelIntelligenceReport {
  if (!isRecord(value)) {
    throw new Error("Level intelligence report JSON must contain an object.");
  }
  if (typeof value.symbol !== "string" || value.symbol.length === 0) {
    throw new Error("Level intelligence report JSON is missing symbol.");
  }
  if (typeof value.generatedAt !== "number") {
    throw new Error("Level intelligence report JSON is missing generatedAt.");
  }
  if (!Array.isArray(value.profiles)) {
    throw new Error("Level intelligence report JSON is missing profiles.");
  }
  if (!isRecord(value.counts)) {
    throw new Error("Level intelligence report JSON is missing counts.");
  }
}

function parseJsonFile(filePath: string, label: string, fileSystem: Pick<LevelQualityAuditReviewRunnerFileSystem, "readFileSync">): unknown {
  try {
    return JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${label} JSON from ${filePath}: ${message}`);
  }
}

export function loadLevelQualityAuditLevelOutputJson(
  filePath: string,
  fileSystem: Pick<LevelQualityAuditReviewRunnerFileSystem, "readFileSync"> = defaultFileSystem,
): LevelEngineOutput {
  const parsed = parseJsonFile(filePath, "LevelEngineOutput", fileSystem);
  assertLevelEngineOutput(parsed);
  return parsed;
}

export function loadLevelQualityAuditIntelligenceReportJson(
  filePath: string,
  fileSystem: Pick<LevelQualityAuditReviewRunnerFileSystem, "readFileSync"> = defaultFileSystem,
): LevelIntelligenceReport {
  const parsed = parseJsonFile(filePath, "LevelIntelligenceReport", fileSystem);
  assertLevelIntelligenceReport(parsed);
  return parsed;
}

function formatNumber(value: number | undefined, suffix = ""): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${Math.round(value * 10000) / 10000}${suffix}`;
}

function formatItem(item: LevelQualityAuditItem): string {
  const context = item.contextCounts;
  return [
    `${item.bucket} ${item.kind} ${formatNumber(item.representativePrice)}`,
    `zone ${formatNumber(item.zoneLow)}-${formatNumber(item.zoneHigh)}`,
    `audit ${formatNumber(item.auditScore)}`,
    `strength ${item.strengthScore}/${item.strengthLabel}`,
    `freshness ${item.freshness}`,
    `touches ${item.touchCount}`,
    `confluence ${item.confluenceCount}`,
    `context session ${context.session} volume ${context.volume} shelf ${context.shelf} market ${context.marketContext}`,
    `enriched ${item.hasEnrichedAnalysis ? "yes" : "no"}`,
  ].join("; ");
}

function addItemSection(lines: string[], title: string, items: LevelQualityAuditItem[]): void {
  lines.push(`## ${title}`);
  if (items.length === 0) {
    lines.push("- none");
  } else {
    lines.push(...items.map((item) => `- ${formatItem(item)}`));
  }
  lines.push("");
}

function formatCluster(cluster: LevelQualityCluster): string {
  return [
    `${cluster.kind} area ${formatNumber(cluster.zoneLow)}-${formatNumber(cluster.zoneHigh)}`,
    `prices ${cluster.representativePrices.map((price) => formatNumber(price)).join(", ")}`,
    `buckets ${cluster.buckets.join(", ")}`,
    `max distance ${formatNumber(cluster.maxDistancePct, "%")}`,
  ].join("; ");
}

export function renderLevelQualityAuditReport(report: LevelQualityAuditReport): string {
  const { summary } = report;
  const lines: string[] = [
    `${report.symbol} level quality audit`,
    `Generated at: ${report.generatedAt}`,
    `Reference price: ${formatNumber(report.referencePrice)}`,
    "",
    "## Summary",
    `- Total levels: ${summary.totalLevels}`,
    `- Support / resistance: ${summary.supportCount} / ${summary.resistanceCount}`,
    `- Extensions: ${summary.extensionCount}`,
    `- Fresh / stale: ${summary.freshCount} / ${summary.staleCount}`,
    `- Enriched / unenriched: ${summary.enrichedCount} / ${summary.unenrichedCount}`,
    "",
  ];

  addItemSection(lines, "Strongest Levels", report.strongestLevels);
  addItemSection(lines, "Weakest Levels", report.weakestLevels);
  addItemSection(lines, "Stale Levels", report.staleLevels);

  lines.push("## Clustered Areas");
  if (report.clusteredAreas.length === 0) {
    lines.push("- none");
  } else {
    lines.push(...report.clusteredAreas.map((cluster) => `- ${formatCluster(cluster)}`));
  }
  lines.push("");

  addItemSection(lines, "Possible Clutter Levels", report.possibleClutterLevels);

  lines.push("## Extension Coverage");
  lines.push(`- Support extensions: ${report.extensionCoverage.supportExtensions}`);
  lines.push(`- Resistance extensions: ${report.extensionCoverage.resistanceExtensions}`);
  lines.push(`- Lowest support extension: ${formatNumber(report.extensionCoverage.lowestSupportExtension)}`);
  lines.push(`- Highest resistance extension: ${formatNumber(report.extensionCoverage.highestResistanceExtension)}`);
  lines.push(`- Downside coverage: ${formatNumber(report.extensionCoverage.downsideCoveragePct, "%")}`);
  lines.push(`- Upside coverage: ${formatNumber(report.extensionCoverage.upsideCoveragePct, "%")}`);
  lines.push(`- Warnings: ${report.extensionCoverage.warnings.join(", ") || "none"}`);
  lines.push("");

  lines.push("## Nearby Coverage");
  lines.push(`- Nearby support count: ${report.nearbyCoverage.nearbySupportCount}`);
  lines.push(`- Nearby resistance count: ${report.nearbyCoverage.nearbyResistanceCount}`);
  lines.push(`- Nearest support: ${report.nearbyCoverage.nearestSupport ? formatItem(report.nearbyCoverage.nearestSupport) : "n/a"}`);
  lines.push(`- Nearest resistance: ${report.nearbyCoverage.nearestResistance ? formatItem(report.nearbyCoverage.nearestResistance) : "n/a"}`);
  lines.push(`- Downside support gap: ${formatNumber(report.nearbyCoverage.downsideSupportGapPct, "%")}`);
  lines.push(`- Overhead resistance gap: ${formatNumber(report.nearbyCoverage.overheadResistanceGapPct, "%")}`);
  lines.push(`- Warnings: ${report.nearbyCoverage.warnings.join(", ") || "none"}`);
  lines.push("");

  lines.push("## Confluence Summary");
  lines.push(`- Session: ${report.confluenceSummary.sessionConfluenceCount}`);
  lines.push(`- Volume: ${report.confluenceSummary.volumeConfluenceCount}`);
  lines.push(`- Shelf: ${report.confluenceSummary.shelfConfluenceCount}`);
  lines.push(`- Market context: ${report.confluenceSummary.marketContextConfluenceCount}`);
  lines.push("");

  lines.push("## Diagnostics");
  lines.push(
    ...(report.diagnostics.length > 0
      ? report.diagnostics.map((diagnostic) => {
        const semantics = describeLevelQualityDiagnostic(diagnostic);
        return `- ${diagnostic} (${semantics.category}/${semantics.severity}): ${semantics.label}. ${semantics.description}`;
      })
      : ["- none"]),
  );
  lines.push("");

  lines.push("## Safety");
  lines.push(`- Level output unchanged: ${report.safety.levelOutputUnchanged}`);
  lines.push(`- Runtime behavior unchanged: ${report.safety.noRuntimeBehaviorChange}`);
  lines.push(`- Scoring unchanged: ${report.safety.noScoringChange}`);

  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildLevelQualityAuditReviewResult(
  output: LevelEngineOutput,
  intelligenceReport: LevelIntelligenceReport | undefined,
  format: LevelQualityAuditReviewFormat = "text",
): Omit<LevelQualityAuditReviewRunnerResult, "levelOutputPath" | "levelIntelligenceReportPath" | "outPath" | "format"> {
  const report = buildLevelQualityAuditReport({ output, intelligenceReport });
  const content = format === "json"
    ? `${JSON.stringify({ report }, null, 2)}\n`
    : renderLevelQualityAuditReport(report);

  return {
    report,
    content,
  };
}

export function runLevelQualityAuditReviewRunner(
  options: LevelQualityAuditReviewRunnerOptions,
  fileSystem: LevelQualityAuditReviewRunnerFileSystem = defaultFileSystem,
): LevelQualityAuditReviewRunnerResult {
  const output = loadLevelQualityAuditLevelOutputJson(options.levelOutputPath, fileSystem);
  const intelligenceReport = options.levelIntelligenceReportPath
    ? loadLevelQualityAuditIntelligenceReportJson(options.levelIntelligenceReportPath, fileSystem)
    : undefined;
  const result = buildLevelQualityAuditReviewResult(output, intelligenceReport, options.format);

  if (options.outPath) {
    fileSystem.mkdirSync(dirname(options.outPath), { recursive: true });
    fileSystem.writeFileSync(options.outPath, result.content, "utf8");
  }

  return {
    levelOutputPath: options.levelOutputPath,
    levelIntelligenceReportPath: options.levelIntelligenceReportPath,
    outPath: options.outPath,
    format: options.format,
    ...result,
  };
}
