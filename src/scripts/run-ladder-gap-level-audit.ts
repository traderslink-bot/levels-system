import { join } from "node:path";

import { writeLadderGapLevelAudit } from "../lib/review/ladder-gap-level-audit.js";

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

const inputPath = readFlag("--input") ?? process.argv[2] ?? "artifacts/long-run";
const allSessions = hasFlag("--all-sessions") || inputPath === "artifacts/long-run";
const outputDirectory = readFlag("--out-dir") ?? (
  allSessions
    ? join("artifacts", "ladder-gap-level-audit")
    : inputPath.endsWith(".jsonl")
      ? join("artifacts", "ladder-gap-level-audit")
      : inputPath
);

const report = writeLadderGapLevelAudit({
  inputPath,
  outputDirectory,
  allSessions,
  warehouseDirectoryPath: readFlag("--warehouse") ?? "data/candles",
  provider: readFlag("--provider") ?? "ibkr",
  minGapPct: Number(readFlag("--min-gap-pct") ?? 8),
  maxGapDistancePct: Number(readFlag("--max-gap-distance-pct") ?? 45),
  maxFindings: Number(readFlag("--max-findings") ?? 60),
});

console.log(
  `Ladder gap level audit: ${report.totals.snapshots} snapshots, ${report.totals.hiddenGapZones} hidden gap candidates, ${report.totals.nearWrongSideLevels} near wrong-side levels.`,
);
console.log(`Wrote ${join(outputDirectory, "ladder-gap-level-audit.json")}`);
console.log(`Wrote ${join(outputDirectory, "ladder-gap-level-audit.md")}`);
