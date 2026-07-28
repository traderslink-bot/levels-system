import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  buildAllSymbolStressReport,
  renderAllSymbolStressMarkdown,
} from "../lib/review/all-symbol-stress-report.js";

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }

  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sourceRoot = resolve(readFlag("--input") ?? join("artifacts", "long-run"));
const outputDirectory = resolve(readFlag("--output") ?? join("artifacts", "all-symbol-stress"));

const report = await buildAllSymbolStressReport(sourceRoot);

await mkdir(outputDirectory, { recursive: true });
const jsonPath = join(outputDirectory, "all-symbol-stress-report.json");
const markdownPath = join(outputDirectory, "all-symbol-stress-report.md");

await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownPath, renderAllSymbolStressMarkdown(report), "utf8");

console.log(`All-symbol stress report discovered ${report.auditFilesDiscovered} audit file(s), scanned ${report.auditFilesScanned} after dedupe.`);
console.log(`Symbols: ${report.totals.symbols}; original posts: ${report.totals.originalPosted}; simulated posts: ${report.totals.simulatedPosted}; reduction: ${report.totals.reductionPct}%.`);
console.log(`Still noisy symbols: ${report.totals.stillNoisyAfterPolicySymbols}; tight-range chop symbols: ${report.totals.tightRangeChopSymbols}; fast-runner cascade symbols: ${report.totals.fastRunnerCascadeSymbols}.`);
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${markdownPath}`);
