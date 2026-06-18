import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  writeCandleBackfillStageManifest,
} from "../lib/review/candle-backfill-stage-manifest.js";
import type { CandleBackfillPriorityLevel } from "../lib/review/candle-backfill-priority-report.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArg(flag: string): number | undefined {
  const raw = argValue(flag);
  const value = raw ? Number(raw) : undefined;
  return Number.isFinite(value) ? value : undefined;
}

function parsePriority(raw: string | undefined): CandleBackfillPriorityLevel | undefined {
  return raw === "fetch_first" || raw === "fetch_next" || raw === "fetch_later" ? raw : undefined;
}

function defaultPriorityReportPath(): string {
  const allSessionPath = "artifacts/candle-backfill-priority/candle-backfill-priority.json";
  if (existsSync(allSessionPath)) {
    return allSessionPath;
  }
  return join("artifacts", "candle-backfill-priority.json");
}

const priorityReportPath = argValue("--priority-report") ?? argValue("--input") ?? defaultPriorityReportPath();
const outDir = argValue("--out-dir") ?? "artifacts/candle-backfill-stage-manifest";
const manifest = writeCandleBackfillStageManifest({
  priorityReportPath,
  stageIndex: numberArg("--stage") ?? numberArg("--priority-stage") ?? 1,
  priority: parsePriority(argValue("--priority")) ?? "fetch_first",
  warehouseDirectoryPath: argValue("--warehouse"),
  outputDirectory: argValue("--backfill-out-dir") ?? "artifacts/candle-warehouse-backfill",
  jsonPath: join(outDir, "candle-backfill-stage-manifest.json"),
  markdownPath: join(outDir, "candle-backfill-stage-manifest.md"),
});

console.log(
  `Candle backfill stage manifest: stage=${manifest.selectedStageIndex ?? "priority"} priority=${manifest.selectedPriority} tasks=${manifest.taskCount} estimatedCandles=${manifest.estimatedCandleCount}.`,
);
console.log(`Dry-run: ${manifest.safeDryRunCommand}`);
