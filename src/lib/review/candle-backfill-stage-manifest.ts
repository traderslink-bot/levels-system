import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  CandleBackfillPriorityLevel,
  CandleBackfillPriorityReport,
  CandleBackfillPriorityStage,
  CandleBackfillPriorityTask,
} from "./candle-backfill-priority-report.js";

export type CandleBackfillStageManifest = {
  generatedAt: string;
  priorityReportPath: string;
  priorityReportGeneratedAt: string;
  warehouseDirectoryPath: string;
  selectedStageIndex: number | null;
  selectedPriority: CandleBackfillPriorityLevel;
  taskCount: number;
  estimatedCandleCount: number;
  symbols: string[];
  timeframes: string[];
  tasks: CandleBackfillPriorityTask[];
  safeDryRunCommand: string;
  executeCommand: string;
  notes: string[];
};

export type BuildCandleBackfillStageManifestOptions = {
  priorityReportPath: string;
  stageIndex?: number;
  priority?: CandleBackfillPriorityLevel;
  warehouseDirectoryPath?: string;
  outputDirectory?: string;
};

export type WriteCandleBackfillStageManifestOptions = BuildCandleBackfillStageManifestOptions & {
  jsonPath: string;
  markdownPath: string;
};

function loadPriorityReport(path: string): CandleBackfillPriorityReport {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as CandleBackfillPriorityReport;
  if (!Array.isArray(parsed.rankedTasks) || !Array.isArray(parsed.providerStages)) {
    throw new Error(`Invalid candle backfill priority report: ${path}`);
  }
  return parsed;
}

function selectStage(
  report: CandleBackfillPriorityReport,
  options: BuildCandleBackfillStageManifestOptions,
): { stage: CandleBackfillPriorityStage | null; tasks: CandleBackfillPriorityTask[]; priority: CandleBackfillPriorityLevel } {
  if (typeof options.stageIndex === "number" && Number.isFinite(options.stageIndex)) {
    const stage = report.providerStages.find((candidate) => candidate.stageIndex === options.stageIndex);
    if (!stage) {
      throw new Error(`Priority stage ${options.stageIndex} was not found.`);
    }
    return { stage, tasks: stage.tasks, priority: stage.priority };
  }

  const priority = options.priority ?? "fetch_first";
  const stage = report.providerStages.find((candidate) => candidate.priority === priority) ?? null;
  return {
    stage,
    tasks: stage?.tasks ?? report.rankedTasks.filter((task) => task.priority === priority),
    priority,
  };
}

function quote(value: string): string {
  return value.includes(" ") ? `"${value}"` : value;
}

export function buildCandleBackfillStageManifest(
  options: BuildCandleBackfillStageManifestOptions,
): CandleBackfillStageManifest {
  const priorityReportPath = resolve(options.priorityReportPath);
  const report = loadPriorityReport(priorityReportPath);
  const selected = selectStage(report, options);
  const warehouseDirectoryPath = options.warehouseDirectoryPath ?? report.warehouseDirectoryPath;
  const outputDirectory = options.outputDirectory ?? "artifacts/candle-warehouse-backfill";
  const stageFlag = selected.stage ? ` --priority-stage ${selected.stage.stageIndex}` : ` --priority ${selected.priority}`;
  const baseCommand =
    `npm run candles:backfill -- --priority-report ${quote(priorityReportPath)}${stageFlag} --warehouse ${quote(warehouseDirectoryPath)} --out-dir ${quote(outputDirectory)}`;

  return {
    generatedAt: new Date().toISOString(),
    priorityReportPath,
    priorityReportGeneratedAt: report.generatedAt,
    warehouseDirectoryPath,
    selectedStageIndex: selected.stage?.stageIndex ?? null,
    selectedPriority: selected.priority,
    taskCount: selected.tasks.length,
    estimatedCandleCount: selected.tasks.reduce((sum, task) => sum + (task.estimatedCandleCount || task.missingCandleCountEstimate), 0),
    symbols: [...new Set(selected.tasks.map((task) => task.symbol))].sort(),
    timeframes: [...new Set(selected.tasks.map((task) => task.timeframe))].sort(),
    tasks: selected.tasks,
    safeDryRunCommand: baseCommand,
    executeCommand: `${baseCommand} --execute --concurrency 1 --throttle-ms 250`,
    notes: [
      "Run the safe dry-run command first. It recalculates current warehouse gaps and does not call the provider.",
      "Use the execute command only when provider access is intentional.",
      "The backfill executor filters by symbol/session/timeframe keys from this manifest so already-covered ranges are skipped after recalculation.",
    ],
  };
}

export function formatCandleBackfillStageManifest(manifest: CandleBackfillStageManifest): string {
  const lines = [
    "# Candle Backfill Stage Manifest",
    "",
    "Operator-only handoff from the priority report to the dry-run backfill executor.",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Priority report: ${manifest.priorityReportPath}`,
    `Priority report generated: ${manifest.priorityReportGeneratedAt}`,
    `Selected stage: ${manifest.selectedStageIndex ?? "first matching priority"}`,
    `Selected priority: ${manifest.selectedPriority}`,
    `Warehouse: ${manifest.warehouseDirectoryPath}`,
    "",
    "## Summary",
    "",
    `- tasks: ${manifest.taskCount}`,
    `- estimated candles: ${manifest.estimatedCandleCount}`,
    `- symbols: ${manifest.symbols.join(", ") || "none"}`,
    `- timeframes: ${manifest.timeframes.join(", ") || "none"}`,
    "",
    "## Commands",
    "",
    "Safe dry-run first:",
    "",
    "```powershell",
    manifest.safeDryRunCommand,
    "```",
    "",
    "Execute only when provider access is intended:",
    "",
    "```powershell",
    manifest.executeCommand,
    "```",
    "",
    "## Notes",
    "",
    ...manifest.notes.map((note) => `- ${note}`),
    "",
    "## Tasks",
    "",
    "| Symbol | Session | Timeframe | Priority | Score | Est. Candles | Missing Candles | Reasons |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- |",
  ];

  for (const task of manifest.tasks) {
    lines.push(
      `| ${task.symbol} | ${task.sessionDate} | ${task.timeframe} | ${task.priority} | ${task.score} | ${task.estimatedCandleCount} | ${task.missingCandleCountEstimate} | ${task.reasons.join("<br>")} |`,
    );
  }
  if (manifest.tasks.length === 0) {
    lines.push("| none | n/a | n/a | n/a | 0 | 0 | 0 | no tasks selected |");
  }

  return `${lines.join("\n")}\n`;
}

export function writeCandleBackfillStageManifest(
  options: WriteCandleBackfillStageManifestOptions,
): CandleBackfillStageManifest {
  const manifest = buildCandleBackfillStageManifest(options);
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatCandleBackfillStageManifest(manifest), "utf8");
  return manifest;
}
