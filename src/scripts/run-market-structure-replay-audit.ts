import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  buildMarketStructureReplayAuditReport,
  formatMarketStructureReplayAuditMarkdown,
} from "../lib/review/market-structure-replay-audit.js";

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

const provider = readFlag("--provider") ?? "ibkr";
const warehouseDirectory = readFlag("--warehouse");
const candleDirectory = resolve(
  warehouseDirectory ? join(warehouseDirectory, provider) : readFlag("--cache") ?? join(".validation-cache", "candles", "ibkr"),
);
const outputDirectory = resolve(readFlag("--output") ?? join("artifacts", "market-structure-replay"));
const symbols = readFlag("--symbols")
  ?.split(",")
  .map((symbol) => symbol.trim())
  .filter(Boolean);
const maxFilesPerSymbol = parsePositiveInteger(readFlag("--max-files-per-symbol"));
const rollingStepBars = parsePositiveInteger(readFlag("--rolling-step-bars"));

const report = buildMarketStructureReplayAuditReport({
  cacheDirectory: candleDirectory,
  symbols,
  maxFilesPerSymbol,
  rollingStepBars,
});

mkdirSync(outputDirectory, { recursive: true });
const jsonPath = join(outputDirectory, "market-structure-replay-audit.json");
const markdownPath = join(outputDirectory, "market-structure-replay-audit.md");

writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(markdownPath, formatMarketStructureReplayAuditMarkdown(report));

console.log(`Market-structure replay audit scanned ${report.filesScanned} file(s) across ${report.symbolsScanned} symbol(s).`);
console.log(`Findings: review=${report.summary.findingCounts.review}, watch=${report.summary.findingCounts.watch}, info=${report.summary.findingCounts.info}`);
console.log(`JSON: ${jsonPath}`);
console.log(`Markdown: ${markdownPath}`);
