import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { writeCandleBackfillPriorityReport } from "../lib/review/candle-backfill-priority-report.js";
import type { CandleFetchTimeframe, CandleProviderName } from "../lib/support-resistance/index.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function positionalArgs(): string[] {
  const values: string[] = [];
  const flagsWithValues = new Set([
    "--out-dir",
    "--warehouse",
    "--cache",
    "--max-trades",
    "--timeframes",
    "--input",
    "--provider",
    "--max-tasks-per-stage",
    "--max-candles-per-stage",
    "--max-sessions",
  ]);
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index]!;
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

function parseTimeframes(raw: string | undefined): CandleFetchTimeframe[] | undefined {
  if (!raw) {
    return undefined;
  }
  const allowed = new Set(["daily", "4h", "5m", "1m"]);
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is CandleFetchTimeframe => allowed.has(item));
}

function numberArg(flag: string): number | undefined {
  const raw = argValue(flag);
  const value = raw ? Number(raw) : undefined;
  return Number.isFinite(value) ? value : undefined;
}

const allSessions = hasFlag("--all-sessions");
const input = argValue("--input") ?? positionalArgs()[0] ?? (allSessions ? "artifacts/long-run" : latestLongRunSession());
const outDir = argValue("--out-dir") ?? (
  allSessions || input.endsWith(".jsonl") ? "artifacts/candle-backfill-priority" : input
);

const report = await writeCandleBackfillPriorityReport({
  auditPath: input,
  warehouseDirectoryPath: argValue("--warehouse") ?? "data/candles",
  cacheDirectoryPath: argValue("--cache") ?? ".validation-cache/candles",
  provider: (argValue("--provider") ?? "ibkr") as CandleProviderName,
  timeframes: parseTimeframes(argValue("--timeframes")),
  maxTrades: numberArg("--max-trades"),
  maxAuditFiles: numberArg("--max-sessions"),
  maxTasksPerStage: numberArg("--max-tasks-per-stage"),
  maxEstimatedCandlesPerStage: numberArg("--max-candles-per-stage"),
  jsonPath: join(outDir, "candle-backfill-priority.json"),
  markdownPath: join(outDir, "candle-backfill-priority.md"),
});

console.log(
  `Candle backfill priority: missing=${report.totals.missingTasks}, fetchFirst=${report.totals.fetchFirstTasks}, fetchNext=${report.totals.fetchNextTasks}, stages=${report.totals.priorityStages}.`,
);
