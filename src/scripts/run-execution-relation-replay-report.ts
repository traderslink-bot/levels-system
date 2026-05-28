import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { writeExecutionRelationReplayReport } from "../lib/review/execution-relation-replay-report.js";
import type { CandleProviderName } from "../lib/support-resistance/index.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArgs(): string[] {
  const values: string[] = [];
  const flagsWithValues = new Set(["--out-dir", "--cache", "--provider", "--max-symbols"]);
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

const input = positionalArgs()[0] ?? latestLongRunSession();
const allSessions = process.argv.includes("--all-sessions");
const outDir = argValue("--out-dir") ?? (
  input.endsWith(".jsonl") || allSessions ? "artifacts/execution-relation-replay" : input
);
const maxSymbolsArg = argValue("--max-symbols");
const maxSymbols = maxSymbolsArg ? Number(maxSymbolsArg) : undefined;
const report = await writeExecutionRelationReplayReport({
  auditPath: allSessions ? "artifacts/long-run" : input,
  cacheDirectoryPath: argValue("--cache") ?? ".validation-cache/candles",
  provider: (argValue("--provider") ?? "ibkr") as CandleProviderName,
  maxSymbols: Number.isFinite(maxSymbols) ? maxSymbols : undefined,
  jsonPath: join(outDir, "execution-relation-replay.json"),
  markdownPath: join(outDir, "execution-relation-replay.md"),
});

console.log(
  `Execution relation replay: posts=${report.totals.postsReviewed}, valid=${report.totals.validRelationSamples}, useful=${report.totals.usefulContextCount}, needsEvidence=${report.totals.needsCandleEvidenceCount}.`,
);
