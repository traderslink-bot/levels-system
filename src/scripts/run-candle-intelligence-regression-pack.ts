import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { writeCandleIntelligenceRegressionPack } from "../lib/review/candle-intelligence-regression-pack.js";
import type { CandleProviderName } from "../lib/support-resistance/index.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArgs(): string[] {
  const values: string[] = [];
  const flagsWithValues = new Set(["--out-dir", "--cache", "--provider", "--max-cases-per-type"]);
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
const allSessions = process.argv.includes("--all-sessions");
const outDir = argValue("--out-dir") ?? (
  input.endsWith(".jsonl") || allSessions ? "artifacts/candle-intelligence-regression-pack" : input
);
const pack = await writeCandleIntelligenceRegressionPack({
  auditPath: allSessions ? "artifacts/long-run" : input,
  cacheDirectoryPath: argValue("--cache") ?? ".validation-cache/candles",
  provider: (argValue("--provider") ?? "ibkr") as CandleProviderName,
  maxCasesPerType: numberArg("--max-cases-per-type"),
  jsonPath: join(outDir, "candle-intelligence-regression-pack.json"),
  markdownPath: join(outDir, "candle-intelligence-regression-pack.md"),
});

console.log(
  `Candle intelligence regression pack: cases=${pack.totals.cases}, weakSnapshots=${pack.totals.weakFirstSnapshot}, volumeHide=${pack.totals.volumeShouldHide}, executionMissing=${pack.totals.executionRelationMissingEvidence}.`,
);
