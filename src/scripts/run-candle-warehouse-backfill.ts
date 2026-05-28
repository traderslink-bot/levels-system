import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  writeCandleWarehouseBackfillReport,
} from "../lib/review/candle-warehouse-backfill-report.js";
import type { CandleFetchTimeframe, CandleWarehouseBackfillMode } from "../lib/support-resistance/index.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArgs(): string[] {
  const values: string[] = [];
  const flagsWithValues = new Set([
    "--out-dir",
    "--warehouse",
    "--max-trades",
    "--max-tasks",
    "--timeframes",
    "--concurrency",
    "--throttle-ms",
    "--mode",
  ]);
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

const input = positionalArgs()[0] ?? latestLongRunSession();
const mode = (argValue("--mode") ?? (process.argv.includes("--execute") ? "execute" : "dry_run")) as CandleWarehouseBackfillMode;
const outDir = argValue("--out-dir") ?? (input.endsWith(".jsonl") ? "artifacts/candle-warehouse-backfill" : input);

const result = await writeCandleWarehouseBackfillReport({
  auditPath: process.argv.includes("--all-sessions") ? "artifacts/long-run" : input,
  warehouseDirectoryPath: argValue("--warehouse") ?? "data/candles",
  timeframes: parseTimeframes(argValue("--timeframes")),
  mode,
  maxTrades: numberArg("--max-trades"),
  maxTasks: numberArg("--max-tasks"),
  concurrency: numberArg("--concurrency"),
  throttleMs: numberArg("--throttle-ms"),
  jsonPath: join(outDir, "candle-warehouse-backfill.json"),
  markdownPath: join(outDir, "candle-warehouse-backfill.md"),
});

console.log(`Candle warehouse backfill ${result.mode}: planned=${result.totals.plannedTasks} attempted=${result.totals.attemptedTasks} fetched=${result.totals.fetchedTasks} failed=${result.totals.failedTasks}`);
