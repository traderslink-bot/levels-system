import { join, resolve } from "node:path";

import {
  buildFormalMarketStructureGateCalibrationReport,
  writeFormalMarketStructureGateCalibrationReport,
} from "../lib/review/formal-market-structure-gate-calibration.js";

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function numberFlag(name: string): number | undefined {
  const value = Number(readFlag(name));
  return Number.isFinite(value) ? value : undefined;
}

const input = process.argv[2];
if (!input || input === "--help" || input === "-h") {
  console.error("Usage: npx tsx src/scripts/run-formal-market-structure-gate-calibration.ts <audit-root-or-file> [--output artifacts/formal-market-structure-gate-calibration] [--limit 25] [--all] [--window-minutes 90]");
  process.exit(1);
}

const outputDirectory = resolve(readFlag("--output") ?? join("artifacts", "formal-market-structure-gate-calibration"));
const explicitLimit = readFlag("--limit");
const limit = hasFlag("--all") ? null : explicitLimit ? Number.parseInt(explicitLimit, 10) : 25;
const report = buildFormalMarketStructureGateCalibrationReport({
  sourceRoot: resolve(input),
  limit,
  forwardWindowMinutes: numberFlag("--window-minutes"),
});

writeFormalMarketStructureGateCalibrationReport({
  report,
  jsonPath: join(outputDirectory, "formal-market-structure-gate-calibration.json"),
  markdownPath: join(outputDirectory, "formal-market-structure-gate-calibration.md"),
});

console.log(`Audit files: ${report.auditCount}`);
console.log(`Formal BOS/CHOCH events: ${report.totals.formalBosChochEvents}`);
console.log(`Actionable/metadata-only: ${report.totals.actionable}/${report.totals.metadataOnly}`);
console.log(`Outcomes continued/failed/mixed/insufficient: ${report.totals.continued}/${report.totals.failed}/${report.totals.mixed}/${report.totals.insufficientPriceEvidence}`);
console.log(`JSON: ${join(outputDirectory, "formal-market-structure-gate-calibration.json")}`);
console.log(`Markdown: ${join(outputDirectory, "formal-market-structure-gate-calibration.md")}`);
