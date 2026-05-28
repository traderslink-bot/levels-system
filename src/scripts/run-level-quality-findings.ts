import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  classifyLevelQualityFindings,
  type LevelQualityFinding,
  type LevelQualityFindingsReport,
} from "../lib/levels/level-quality-findings-classifier.js";
import type { LevelQualityAuditReport } from "../lib/levels/level-quality-audit-runner.js";

type LevelQualityFindingsFormat = "text" | "json";

type LevelQualityFindingsOptions = {
  auditPaths: string[];
  auditDir?: string;
  outPath?: string;
  format: LevelQualityFindingsFormat;
};

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function parseFormat(value: string | undefined): LevelQualityFindingsFormat {
  if (value === undefined) {
    return "text";
  }
  if (value === "text" || value === "json") {
    return value;
  }

  throw new Error(`Unsupported --format value "${value}". Expected text or json.`);
}

function parseArgs(args: string[]): LevelQualityFindingsOptions {
  const auditPaths: string[] = [];
  let auditDir: string | undefined;
  let outPath: string | undefined;
  let format: LevelQualityFindingsFormat = "text";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--audit") {
      auditPaths.push(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--audit-dir") {
      auditDir = requireValue(args, index, arg);
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

  if (auditPaths.length === 0 && !auditDir) {
    throw new Error("Missing required --audit <path> or --audit-dir <path>.");
  }

  return {
    auditPaths,
    auditDir,
    outPath,
    format,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertLevelQualityAuditReport(value: unknown, filePath: string): asserts value is LevelQualityAuditReport {
  if (!isRecord(value)) {
    throw new Error(`Audit JSON from ${filePath} must contain an object.`);
  }
  if (typeof value.symbol !== "string" || value.symbol.length === 0) {
    throw new Error(`Audit JSON from ${filePath} is missing symbol.`);
  }
  if (!isRecord(value.summary)) {
    throw new Error(`Audit JSON from ${filePath} is missing summary.`);
  }
  if (!isRecord(value.extensionCoverage)) {
    throw new Error(`Audit JSON from ${filePath} is missing extensionCoverage.`);
  }
  if (!isRecord(value.nearbyCoverage)) {
    throw new Error(`Audit JSON from ${filePath} is missing nearbyCoverage.`);
  }
  if (!Array.isArray(value.diagnostics)) {
    throw new Error(`Audit JSON from ${filePath} is missing diagnostics.`);
  }
}

function readAuditReport(filePath: string): LevelQualityAuditReport {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    const report = isRecord(parsed) && "report" in parsed ? parsed.report : parsed;

    assertLevelQualityAuditReport(report, filePath);
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read level quality audit JSON from ${filePath}: ${message}`);
  }
}

function findAuditFiles(auditDir: string | undefined): string[] {
  if (!auditDir) {
    return [];
  }

  return readdirSync(auditDir)
    .filter((fileName) => fileName.endsWith("-level-quality-audit.json"))
    .sort()
    .map((fileName) => join(auditDir, fileName));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function formatFinding(finding: LevelQualityFinding): string {
  const evidence = finding.evidence.length > 0 ? finding.evidence.join(" | ") : "none";
  return [
    `${finding.type} (${finding.severity})`,
    `samples ${finding.sampleCount}`,
    `symbols ${finding.sampleSymbols.join(", ") || "none"}`,
    `evidence ${evidence}`,
  ].join("; ");
}

function renderFindingsText(auditPaths: string[], report: LevelQualityFindingsReport): string {
  const lines: string[] = [
    "Level quality findings review",
    "",
    "## Inputs",
    ...auditPaths.map((auditPath) => `- ${auditPath}`),
    "",
    "## Summary",
    `- Sample count: ${report.sampleCount}`,
    `- Finding count: ${report.findings.length}`,
    `- Recurring finding count: ${report.recurringFindings.length}`,
    `- Recommended next gates: ${report.recommendedNextGates.join(", ") || "none"}`,
    "",
    "## Recurring Findings",
    ...(report.recurringFindings.length > 0
      ? report.recurringFindings.map((finding) => `- ${formatFinding(finding)}`)
      : ["- none"]),
    "",
    "## All Findings",
    ...(report.findings.length > 0
      ? report.findings.map((finding) => `- ${formatFinding(finding)}`)
      : ["- none"]),
    "",
    "## Safety",
    `- Runtime behavior unchanged: ${report.safety.noRuntimeBehaviorChange}`,
    `- Scoring unchanged: ${report.safety.noScoringChange}`,
    `- Review only: ${report.safety.reviewOnly}`,
  ];

  return `${lines.join("\n").trimEnd()}\n`;
}

function run(options: LevelQualityFindingsOptions): { auditPaths: string[]; report: LevelQualityFindingsReport; content: string } {
  const auditPaths = uniqueSorted([...options.auditPaths, ...findAuditFiles(options.auditDir)]);
  if (auditPaths.length === 0) {
    throw new Error("No level quality audit JSON files found.");
  }

  const reports = auditPaths.map((auditPath) => readAuditReport(auditPath));
  const report = classifyLevelQualityFindings(reports);
  const content = options.format === "json"
    ? `${JSON.stringify({ auditPaths, report }, null, 2)}\n`
    : renderFindingsText(auditPaths, report);

  if (options.outPath) {
    mkdirSync(dirname(options.outPath), { recursive: true });
    writeFileSync(options.outPath, content, "utf8");
  }

  return {
    auditPaths,
    report,
    content,
  };
}

try {
  const result = run(parseArgs(process.argv.slice(2)));
  process.stdout.write(result.content);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
