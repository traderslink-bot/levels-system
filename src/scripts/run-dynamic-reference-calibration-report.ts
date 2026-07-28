import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { writeDynamicReferenceCalibrationReport } from "../lib/review/dynamic-reference-calibration-report.js";
import type { CandleProviderName } from "../lib/support-resistance/index.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArgs(): string[] {
  const values: string[] = [];
  const flagsWithValues = new Set(["--out-dir", "--cache", "--warehouse", "--provider", "--max-symbols", "--input"]);
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

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function numberArg(flag: string): number | undefined {
  const raw = argValue(flag);
  const value = raw ? Number(raw) : undefined;
  return Number.isFinite(value) ? value : undefined;
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

const allSessions = hasFlag("--all-sessions");
const input = argValue("--input") ?? positionalArgs()[0] ?? (allSessions ? "artifacts/long-run" : latestLongRunSession());
const auditPath = allSessions ? input : (input.endsWith(".jsonl") ? input : join(input, "discord-delivery-audit.jsonl"));
const outDir = argValue("--out-dir") ?? (
  allSessions || input.endsWith(".jsonl") ? "artifacts/dynamic-reference-calibration" : input
);
const report = writeDynamicReferenceCalibrationReport({
  auditPath,
  cacheDirectoryPath: argValue("--warehouse") ?? argValue("--cache") ?? ".validation-cache/candles",
  provider: (argValue("--provider") ?? "ibkr") as CandleProviderName,
  maxSymbols: numberArg("--max-symbols"),
  jsonPath: join(outDir, "dynamic-reference-calibration-report.json"),
  markdownPath: join(outDir, "dynamic-reference-calibration-report.md"),
});

console.log(
  `Dynamic/reference calibration: symbols=${report.totals.symbols}, dynamic=${report.totals.dynamicAvailable}, openingRange=${report.totals.openingRangeAvailable}, stretched=${report.totals.stretchedFromVwap}, trust=${report.totals.trustedSymbols}/${report.totals.watchSymbols}/${report.totals.unprovenSymbols}/${report.totals.brokenSymbols}.`,
);
