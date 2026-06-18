import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  buildStableStructureDiscordAlignmentReport,
  formatStableStructureDiscordAlignmentMarkdown,
} from "../lib/review/stable-structure-discord-alignment.js";

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

function parseAuditLimit(value: string | undefined): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.toLowerCase() === "all" || value === "0") {
    return null;
  }
  return parsePositiveInteger(value);
}

const auditRoot = resolve(readFlag("--audit-root") ?? "artifacts");
const provider = readFlag("--provider") ?? "ibkr";
const warehouseDirectory = readFlag("--warehouse");
const cacheDirectory = resolve(
  warehouseDirectory ? join(warehouseDirectory, provider) : readFlag("--cache") ?? join(".validation-cache", "candles", "ibkr"),
);
const outputDirectory = resolve(readFlag("--output") ?? join("artifacts", "stable-structure-discord-alignment"));
const symbols = readFlag("--symbols")
  ?.split(",")
  .map((symbol) => symbol.trim())
  .filter(Boolean);
const auditLimit = parseAuditLimit(readFlag("--limit"));
const minCandles = parsePositiveInteger(readFlag("--min-candles"));
const maxCacheLagMinutes = parsePositiveInteger(readFlag("--max-cache-lag-minutes"));
const repeatWindowMinutes = parsePositiveInteger(readFlag("--repeat-window-minutes"));

const report = buildStableStructureDiscordAlignmentReport({
  auditRoot,
  cacheDirectory,
  symbols,
  auditLimit,
  minCandles,
  maxCacheLagMinutes,
  repeatWindowMinutes,
});

mkdirSync(outputDirectory, { recursive: true });
const jsonPath = join(outputDirectory, "stable-structure-discord-alignment.json");
const markdownPath = join(outputDirectory, "stable-structure-discord-alignment.md");

writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(markdownPath, formatStableStructureDiscordAlignmentMarkdown(report));

console.log(`Stable structure / Discord alignment scanned ${report.summary.postedRows} posted row(s) from ${report.auditFilesScanned} audit file(s).`);
console.log(`Aligned rows: ${report.summary.alignedRows}`);
console.log(`Same-structure repeats: ${report.summary.sameStructureRepeats}`);
console.log(`Findings: review=${report.summary.reviewFindings}, watch=${report.summary.watchFindings}, info=${report.summary.infoFindings}`);
console.log(`JSON: ${jsonPath}`);
console.log(`Markdown: ${markdownPath}`);
