import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  formatLevelIntelligenceReport,
  type FormattedLevelIntelligenceReport,
} from "./level-intelligence-report-formatter.js";
import {
  buildLevelIntelligenceReport,
  type LevelIntelligenceReport,
} from "./level-intelligence-report.js";
import type { LevelEngineOutput } from "./level-types.js";

export type LevelIntelligenceReportRunnerFormat = "text" | "json";

export type LevelIntelligenceReportRunnerOptions = {
  levelOutputPath: string;
  outPath?: string;
  format: LevelIntelligenceReportRunnerFormat;
};

export type LevelIntelligenceReportRunnerResult = {
  levelOutputPath: string;
  outPath?: string;
  format: LevelIntelligenceReportRunnerFormat;
  report: LevelIntelligenceReport;
  formatted: FormattedLevelIntelligenceReport;
  content: string;
};

export type LevelIntelligenceReportRunnerFileSystem = {
  readFileSync: typeof readFileSync;
  writeFileSync: typeof writeFileSync;
  mkdirSync: typeof mkdirSync;
};

const defaultFileSystem: LevelIntelligenceReportRunnerFileSystem = {
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

function parseFormat(value: string | undefined): LevelIntelligenceReportRunnerFormat {
  if (value === undefined) {
    return "text";
  }
  if (value === "text" || value === "json") {
    return value;
  }

  throw new Error(`Unsupported --format value "${value}". Expected text or json.`);
}

export function parseLevelIntelligenceReportRunnerArgs(
  args: string[],
): LevelIntelligenceReportRunnerOptions {
  let levelOutputPath: string | undefined;
  let outPath: string | undefined;
  let format: LevelIntelligenceReportRunnerFormat = "text";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--level-output") {
      levelOutputPath = requireValue(args, index, arg);
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

export function loadLevelEngineOutputJson(
  filePath: string,
  fileSystem: Pick<LevelIntelligenceReportRunnerFileSystem, "readFileSync"> = defaultFileSystem,
): LevelEngineOutput {
  let parsed: unknown;

  try {
    parsed = JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read LevelEngineOutput JSON from ${filePath}: ${message}`);
  }

  assertLevelEngineOutput(parsed);
  return parsed;
}

export function renderFormattedLevelIntelligenceReport(
  formatted: FormattedLevelIntelligenceReport,
): string {
  const lines: string[] = [formatted.summary, ""];

  for (const section of formatted.sections) {
    lines.push(`## ${section.title}`);
    lines.push(...section.lines.map((line) => `- ${line}`));
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildLevelIntelligenceReviewResult(
  output: LevelEngineOutput,
  format: LevelIntelligenceReportRunnerFormat = "text",
): Omit<LevelIntelligenceReportRunnerResult, "levelOutputPath" | "outPath" | "format"> {
  const report = buildLevelIntelligenceReport({ output });
  const formatted = formatLevelIntelligenceReport(report);
  const content =
    format === "json"
      ? `${JSON.stringify({ report, formatted }, null, 2)}\n`
      : renderFormattedLevelIntelligenceReport(formatted);

  return {
    report,
    formatted,
    content,
  };
}

export function runLevelIntelligenceReportRunner(
  options: LevelIntelligenceReportRunnerOptions,
  fileSystem: LevelIntelligenceReportRunnerFileSystem = defaultFileSystem,
): LevelIntelligenceReportRunnerResult {
  const output = loadLevelEngineOutputJson(options.levelOutputPath, fileSystem);
  const result = buildLevelIntelligenceReviewResult(output, options.format);

  if (options.outPath) {
    fileSystem.mkdirSync(dirname(options.outPath), { recursive: true });
    fileSystem.writeFileSync(options.outPath, result.content, "utf8");
  }

  return {
    levelOutputPath: options.levelOutputPath,
    outPath: options.outPath,
    format: options.format,
    ...result,
  };
}
