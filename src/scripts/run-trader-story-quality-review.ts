import { join } from "node:path";

import { writeTraderStoryQualityReview } from "../lib/review/trader-story-quality-review.js";

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const inputPath = readFlag("--input") ?? process.argv[2] ?? "latest";
const outputDirectory = readFlag("--out-dir");

const report = writeTraderStoryQualityReview({
  inputPath,
  outputDirectory,
  warehouseDirectoryPath: readFlag("--warehouse") ?? "data/candles",
  provider: readFlag("--provider") ?? "ibkr",
  minGapPct: Number(readFlag("--min-gap-pct") ?? 8),
  maxGapDistancePct: Number(readFlag("--max-gap-distance-pct") ?? 45),
  maxFindings: Number(readFlag("--max-findings") ?? 60),
});

console.log(
  `Trader story quality review: ${report.verdict}; ${report.totals.symbols} symbols, ${report.totals.storyRiskSymbols} story risks, ${report.totals.ladderFindings} ladder findings.`,
);
console.log(`Wrote ${join(report.outputDirectory, "trader-story-quality-review.json")}`);
console.log(`Wrote ${join(report.outputDirectory, "trader-story-quality-review.md")}`);
