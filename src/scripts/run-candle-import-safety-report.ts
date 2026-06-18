import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { writeCandleImportSafetyReport } from "../lib/review/candle-import-safety-report.js";
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
  const flagsWithValues = new Set(["--out-dir", "--warehouse", "--max-trades", "--timeframes", "--input", "--provider"]);
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

const allSessions = hasFlag("--all-sessions");
const input = argValue("--input") ?? positionalArgs()[0] ?? (allSessions ? "artifacts/long-run" : latestLongRunSession());
const outDir = argValue("--out-dir") ?? (
  allSessions || input.endsWith(".jsonl") ? "artifacts/candle-import-safety" : input
);
const maxTradesArg = argValue("--max-trades");
const maxTrades = maxTradesArg ? Number(maxTradesArg) : undefined;
const report = await writeCandleImportSafetyReport({
  auditPath: allSessions ? input : input,
  warehouseDirectoryPath: argValue("--warehouse") ?? "data/candles",
  provider: (argValue("--provider") ?? "ibkr") as CandleProviderName,
  timeframes: parseTimeframes(argValue("--timeframes")),
  maxTrades: Number.isFinite(maxTrades) ? maxTrades : undefined,
  jsonPath: join(outDir, "candle-import-safety.json"),
  markdownPath: join(outDir, "candle-import-safety.md"),
});

console.log(
  `Candle import safety: verdict=${report.verdict}, trades=${report.totals.tradeProxies}, planned=${report.totals.plannedProviderTasks}, avoided=${report.totals.avoidedProviderTasks}, missing=${report.totals.missingTasks}.`,
);
