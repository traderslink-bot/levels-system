import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { buildLevelExtensionDiagnosticsFromOutput } from "../lib/levels/level-extension-diagnostics.js";
import type { LevelEngineOutput } from "../lib/levels/level-types.js";

type LevelExtensionDiagnosticsFormat = "text" | "json";

type LevelExtensionDiagnosticsOptions = {
  levelOutputPaths: string[];
  fixtureDir?: string;
  outPath?: string;
  format: LevelExtensionDiagnosticsFormat;
};

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function parseFormat(value: string | undefined): LevelExtensionDiagnosticsFormat {
  if (value === undefined) {
    return "text";
  }
  if (value === "text" || value === "json") {
    return value;
  }

  throw new Error(`Unsupported --format value "${value}". Expected text or json.`);
}

function parseArgs(args: string[]): LevelExtensionDiagnosticsOptions {
  const levelOutputPaths: string[] = [];
  let fixtureDir: string | undefined;
  let outPath: string | undefined;
  let format: LevelExtensionDiagnosticsFormat = "text";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--level-output") {
      levelOutputPaths.push(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--fixture-dir") {
      fixtureDir = requireValue(args, index, arg);
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

  if (levelOutputPaths.length === 0 && !fixtureDir) {
    throw new Error("Missing required --level-output <path> or --fixture-dir <path>.");
  }

  return {
    levelOutputPaths,
    fixtureDir,
    outPath,
    format,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertLevelEngineOutput(value: unknown, filePath: string): asserts value is LevelEngineOutput {
  if (!isRecord(value)) {
    throw new Error(`Level output JSON from ${filePath} must contain an object.`);
  }
  if (typeof value.symbol !== "string" || value.symbol.length === 0) {
    throw new Error(`Level output JSON from ${filePath} is missing symbol.`);
  }
  if (typeof value.generatedAt !== "number") {
    throw new Error(`Level output JSON from ${filePath} is missing generatedAt.`);
  }
  if (!isRecord(value.metadata)) {
    throw new Error(`Level output JSON from ${filePath} is missing metadata.`);
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
      throw new Error(`Level output JSON from ${filePath} is missing ${bucket}.`);
    }
  }

  if (!isRecord(value.extensionLevels)) {
    throw new Error(`Level output JSON from ${filePath} is missing extensionLevels.`);
  }
  if (!Array.isArray(value.extensionLevels.support) || !Array.isArray(value.extensionLevels.resistance)) {
    throw new Error(`Level output JSON from ${filePath} extensionLevels must include support and resistance arrays.`);
  }
}

function readLevelOutput(filePath: string): LevelEngineOutput {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    assertLevelEngineOutput(parsed, filePath);
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read LevelEngineOutput JSON from ${filePath}: ${message}`);
  }
}

function findLevelOutputFiles(fixtureDir: string | undefined): string[] {
  if (!fixtureDir) {
    return [];
  }

  return readdirSync(fixtureDir)
    .filter((fileName) => fileName.endsWith("-level-output.json"))
    .sort()
    .map((fileName) => join(fixtureDir, fileName));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function formatNumber(value: number | undefined, suffix = ""): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${Math.round(value * 10000) / 10000}${suffix}`;
}

function formatList(values: Array<number | string>): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function formatReasonCounts(counts: Record<string, number | undefined>): string {
  const entries = Object.entries(counts)
    .filter(([, count]) => count !== undefined && count > 0)
    .sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return "none";
  }

  return entries.map(([reason, count]) => `${reason}: ${count}`).join(", ");
}

type ExtensionDiagnosticsBundle = ReturnType<typeof buildDiagnosticsBundle>;

function buildDiagnosticsBundle(levelOutputPaths: string[]) {
  const reports = levelOutputPaths.map((levelOutputPath) => {
    const output = readLevelOutput(levelOutputPath);
    return {
      levelOutputPath,
      report: buildLevelExtensionDiagnosticsFromOutput(output),
    };
  });

  return {
    levelOutputPaths,
    reports,
    summary: {
      sampleCount: reports.length,
      missingSupportExtensionCount: reports.filter(({ report }) => report.warnings.includes("missing_support_extension")).length,
      missingResistanceExtensionCount: reports.filter(({ report }) => report.warnings.includes("missing_resistance_extension")).length,
      limitedUpsideCoverageCount: reports.filter(({ report }) => report.warnings.includes("limited_upside_extension_coverage")).length,
      limitedDownsideCoverageCount: reports.filter(({ report }) => report.warnings.includes("limited_downside_extension_coverage")).length,
      insufficientCandidateInventoryCount: reports.filter(({ report }) => report.warnings.includes("insufficient_candidate_inventory")).length,
      undeterminedRejectionCount: reports.reduce(
        (total, { report }) => total + report.support.undeterminedRejectionCount + report.resistance.undeterminedRejectionCount,
        0,
      ),
    },
    safety: {
      extensionGenerationUnchanged: true,
      supportResistanceDetectionUnchanged: true,
      noRuntimeBehaviorChange: true,
      noScoringChange: true,
      reviewOnly: true,
    },
  };
}

function renderText(bundle: ExtensionDiagnosticsBundle): string {
  const lines: string[] = [
    "Level extension diagnostics multi-sample review",
    "",
    "## Inputs",
    ...bundle.levelOutputPaths.map((path) => `- ${path}`),
    "",
    "## Summary",
    `- Sample count: ${bundle.summary.sampleCount}`,
    `- Missing support extension samples: ${bundle.summary.missingSupportExtensionCount}`,
    `- Missing resistance extension samples: ${bundle.summary.missingResistanceExtensionCount}`,
    `- Limited upside coverage samples: ${bundle.summary.limitedUpsideCoverageCount}`,
    `- Limited downside coverage samples: ${bundle.summary.limitedDownsideCoverageCount}`,
    `- Insufficient candidate inventory samples: ${bundle.summary.insufficientCandidateInventoryCount}`,
    `- Undetermined rejection reasons: ${bundle.summary.undeterminedRejectionCount}`,
    "",
    "## Samples",
  ];

  for (const { levelOutputPath, report } of bundle.reports) {
    const coverage = report.extensionCoverage;
    lines.push(`### ${report.symbol}`);
    lines.push(`- Input: ${levelOutputPath}`);
    lines.push(`- Reference price: ${formatNumber(report.referencePrice)}`);
    lines.push(`- Support extensions: ${coverage.supportExtensions}`);
    lines.push(`- Resistance extensions: ${coverage.resistanceExtensions}`);
    lines.push(`- Lowest support extension: ${formatNumber(coverage.lowestSupportExtension)}`);
    lines.push(`- Highest resistance extension: ${formatNumber(coverage.highestResistanceExtension)}`);
    lines.push(`- Downside coverage: ${formatNumber(coverage.downsideCoveragePct, "%")}`);
    lines.push(`- Upside coverage: ${formatNumber(coverage.upsideCoveragePct, "%")}`);
    lines.push(`- Warnings: ${report.warnings.join(", ") || "none"}`);
    lines.push(`- Support input inventory: ${formatList(report.support.inputInventoryPrices)}`);
    lines.push(`- Support pre-selection candidates: ${formatList(report.support.preSelectionCandidatePrices)}`);
    lines.push(`- Support eligible candidates: ${formatList(report.support.eligibleCandidatePrices)}`);
    lines.push(`- Support selected: ${formatList(report.support.selectedExtensionPrices)}`);
    lines.push(`- Support candidate coverage: ${formatNumber(report.support.candidateCoveragePct, "%")}`);
    lines.push(`- Support selected coverage: ${formatNumber(report.support.selectedCoveragePct, "%")}`);
    lines.push(`- Support reason counts: ${formatReasonCounts(report.support.rejectionReasonCounts)}`);
    lines.push(`- Resistance input inventory: ${formatList(report.resistance.inputInventoryPrices)}`);
    lines.push(`- Resistance pre-selection candidates: ${formatList(report.resistance.preSelectionCandidatePrices)}`);
    lines.push(`- Resistance eligible candidates: ${formatList(report.resistance.eligibleCandidatePrices)}`);
    lines.push(`- Resistance selected: ${formatList(report.resistance.selectedExtensionPrices)}`);
    lines.push(`- Resistance candidate coverage: ${formatNumber(report.resistance.candidateCoveragePct, "%")}`);
    lines.push(`- Resistance selected coverage: ${formatNumber(report.resistance.selectedCoveragePct, "%")}`);
    lines.push(`- Resistance reason counts: ${formatReasonCounts(report.resistance.rejectionReasonCounts)}`);
    lines.push(`- Support insufficient inventory: ${report.support.insufficientCandidateInventory}`);
    lines.push(`- Resistance insufficient inventory: ${report.resistance.insufficientCandidateInventory}`);
    lines.push(`- Undetermined reasons: ${report.support.undeterminedRejectionCount + report.resistance.undeterminedRejectionCount}`);
    lines.push("");
  }

  lines.push("## Safety");
  lines.push(`- Extension generation unchanged: ${bundle.safety.extensionGenerationUnchanged}`);
  lines.push(`- Support/resistance detection unchanged: ${bundle.safety.supportResistanceDetectionUnchanged}`);
  lines.push(`- Runtime behavior unchanged: ${bundle.safety.noRuntimeBehaviorChange}`);
  lines.push(`- Scoring unchanged: ${bundle.safety.noScoringChange}`);
  lines.push(`- Review only: ${bundle.safety.reviewOnly}`);

  return `${lines.join("\n").trimEnd()}\n`;
}

function run(options: LevelExtensionDiagnosticsOptions): { bundle: ExtensionDiagnosticsBundle; content: string } {
  const levelOutputPaths = uniqueSorted([
    ...options.levelOutputPaths,
    ...findLevelOutputFiles(options.fixtureDir),
  ]);
  if (levelOutputPaths.length === 0) {
    throw new Error("No LevelEngineOutput fixture JSON files found.");
  }

  const bundle = buildDiagnosticsBundle(levelOutputPaths);
  const content = options.format === "json"
    ? `${JSON.stringify(bundle, null, 2)}\n`
    : renderText(bundle);

  if (options.outPath) {
    mkdirSync(dirname(options.outPath), { recursive: true });
    writeFileSync(options.outPath, content, "utf8");
  }

  return {
    bundle,
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
