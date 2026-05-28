import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  writeCandleIntelligenceCalibrationReport,
} from "../lib/review/candle-intelligence-calibration.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArgs(): string[] {
  const values: string[] = [];
  const flagsWithValues = new Set(["--out-dir", "--max-symbols"]);
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
  input.endsWith(".jsonl") || allSessions ? "artifacts/candle-intelligence-calibration" : input
);
const maxSymbolsArg = argValue("--max-symbols");
const maxSymbols = maxSymbolsArg ? Number(maxSymbolsArg) : undefined;
const auditPath = allSessions ? "artifacts/long-run" : input;

const report = await writeCandleIntelligenceCalibrationReport({
  auditPath,
  jsonPath: join(outDir, "candle-intelligence-calibration.json"),
  markdownPath: join(outDir, "candle-intelligence-calibration.md"),
  maxSymbols: Number.isFinite(maxSymbols) ? maxSymbols : undefined,
});

console.log(`Candle intelligence calibration reviewed ${report.symbolsReviewed} symbols.`);
console.log(`auditFiles=${report.sourceAuditPaths.length} trustedRefs=${report.totals.trustedReferenceLevels} watchRefs=${report.totals.watchReferenceLevels} relationWarnings=${report.totals.relationWarnings}`);
