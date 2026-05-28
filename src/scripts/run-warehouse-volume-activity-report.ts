import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { writeWarehouseVolumeActivityReport } from "../lib/review/warehouse-volume-activity-report.js";
import type { CandleProviderName } from "../lib/support-resistance/index.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArgs(): string[] {
  const values: string[] = [];
  const flagsWithValues = new Set(["--out-dir", "--cache", "--provider", "--max-drift-minutes"]);
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith("--")) {
      if (flagsWithValues.has(arg)) {
        index += 1;
      }
      continue;
    }
    values.push(arg);
  }
  return values;
}

function latestLongRunSession(): string {
  const root = "artifacts/long-run";
  if (!existsSync(root)) {
    return root;
  }
  const sessions = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((path) => existsSync(join(path, "discord-delivery-audit.jsonl")))
    .sort();
  return sessions.at(-1) ?? root;
}

function numberArg(flag: string): number | undefined {
  const raw = argValue(flag);
  const value = raw ? Number(raw) : undefined;
  return Number.isFinite(value) ? value : undefined;
}

const input = positionalArgs()[0] ?? latestLongRunSession();
const outDir = argValue("--out-dir") ?? (input.endsWith(".jsonl") ? "artifacts/warehouse-volume-activity" : input);
const report = writeWarehouseVolumeActivityReport({
  auditPath: process.argv.includes("--all-sessions") ? "artifacts/long-run" : input,
  cacheDirectoryPath: argValue("--cache") ?? ".validation-cache/candles",
  provider: (argValue("--provider") ?? "ibkr") as CandleProviderName,
  maxTimestampDriftMinutes: numberArg("--max-drift-minutes"),
  jsonPath: join(outDir, "warehouse-volume-activity-report.json"),
  markdownPath: join(outDir, "warehouse-volume-activity-report.md"),
});

console.log(
  `Warehouse volume activity replay: alerts=${report.totals.alertRows}, matched=${report.totals.matchedRows}, may-help=${report.totals.wouldHelpCount}, hide=${report.totals.shouldStayHiddenCount}.`,
);
