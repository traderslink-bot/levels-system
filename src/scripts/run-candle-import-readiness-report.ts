import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  writeCandleImportReadinessReport,
} from "../lib/review/candle-import-readiness-report.js";
import type { CandleFetchTimeframe } from "../lib/support-resistance/index.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArgs(): string[] {
  const values: string[] = [];
  const flagsWithValues = new Set(["--out-dir", "--warehouse", "--max-trades", "--timeframes"]);
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

const input = positionalArgs()[0] ?? latestLongRunSession();
const outDir = argValue("--out-dir") ?? (
  input.endsWith(".jsonl") ? "artifacts/candle-import-readiness" : input
);
const maxTradesArg = argValue("--max-trades");
const maxTrades = maxTradesArg ? Number(maxTradesArg) : undefined;
const report = await writeCandleImportReadinessReport({
  auditPath: process.argv.includes("--all-sessions") ? "artifacts/long-run" : input,
  warehouseDirectoryPath: argValue("--warehouse") ?? "data/candles",
  timeframes: parseTimeframes(argValue("--timeframes")),
  maxTrades: Number.isFinite(maxTrades) ? maxTrades : undefined,
  jsonPath: join(outDir, "candle-import-readiness.json"),
  markdownPath: join(outDir, "candle-import-readiness.md"),
});

console.log(`Candle import readiness reviewed ${report.tradeCount} trade proxies.`);
console.log(`planned=${report.plan.plannedTaskCount} covered=${report.plan.fullyCoveredTaskCount} missing=${report.plan.missingTaskCount} missingCandles=${report.plan.missingCandleCountEstimate}`);
