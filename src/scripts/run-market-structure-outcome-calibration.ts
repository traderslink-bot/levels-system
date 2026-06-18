import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  buildMarketStructureOutcomeCalibrationReport,
  writeMarketStructureOutcomeCalibrationReport,
} from "../lib/review/market-structure-outcome-calibration.js";

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberFlag(name: string): number | undefined {
  const value = Number(readFlag(name));
  return Number.isFinite(value) ? value : undefined;
}

function resolveAuditPath(input: string): string {
  const resolved = resolve(input);
  return resolved.toLowerCase().endsWith(".jsonl")
    ? resolved
    : join(resolved, "discord-delivery-audit.jsonl");
}

const input = process.argv[2];
if (!input || input === "--help" || input === "-h") {
  console.error("Usage: npx tsx src/scripts/run-market-structure-outcome-calibration.ts <session-folder-or-discord-delivery-audit.jsonl> [--output artifacts/market-structure-outcome-calibration] [--window-minutes 90]");
  process.exit(1);
}

const auditPath = resolveAuditPath(input);
if (!existsSync(auditPath)) {
  throw new Error(`Discord delivery audit not found: ${auditPath}`);
}

const outputDirectory = resolve(readFlag("--output") ?? join("artifacts", "market-structure-outcome-calibration"));
const report = buildMarketStructureOutcomeCalibrationReport({
  auditPath,
  forwardWindowMinutes: numberFlag("--window-minutes"),
  continuationThresholdPct: numberFlag("--continuation-pct"),
  failureThresholdPct: numberFlag("--failure-pct"),
});
const jsonPath = join(outputDirectory, "market-structure-outcome-calibration.json");
const markdownPath = join(outputDirectory, "market-structure-outcome-calibration.md");

writeMarketStructureOutcomeCalibrationReport({ report, jsonPath, markdownPath });

console.log(`Market structure outcome events: ${report.totals.structureEvents}`);
console.log(`Evaluated with price evidence: ${report.totals.evaluatedWithPriceEvidence}`);
console.log(`Continued/failed/mixed: ${report.totals.continued}/${report.totals.failed}/${report.totals.mixed}`);
console.log(`Insufficient price evidence: ${report.totals.insufficientPriceEvidence}`);
console.log(`JSON: ${jsonPath}`);
console.log(`Markdown: ${markdownPath}`);
