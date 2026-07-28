import { join } from "node:path";

import { writeMissedMeaningfulMoveAudit } from "../lib/review/missed-meaningful-move-audit.js";
import type { CandleFetchTimeframe, CandleProviderName } from "../lib/market-data/candle-types.js";

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run audit:missed-moves -- <session-folder-or-discord-delivery-audit.jsonl> [--cache .validation-cache/candles] [--warehouse data/candles] [--provider ibkr] [--timeframe 5m]");
  process.exit(1);
}

const auditPath = input.endsWith(".jsonl") ? input : join(input, "discord-delivery-audit.jsonl");
const outputDirectory = input.endsWith(".jsonl")
  ? join(process.cwd(), "artifacts", "missed-meaningful-moves")
  : input;
const provider = (readFlag("--provider") ?? "ibkr") as CandleProviderName;
const timeframe = (readFlag("--timeframe") ?? "5m") as CandleFetchTimeframe;
const cacheDirectoryPath = readFlag("--cache") ?? join(process.cwd(), ".validation-cache", "candles");
const warehouseDirectoryPath = readFlag("--warehouse");

const report = writeMissedMeaningfulMoveAudit({
  auditPath,
  cacheDirectoryPath,
  warehouseDirectoryPath,
  provider,
  timeframe,
  jsonPath: join(outputDirectory, "missed-meaningful-move-audit.json"),
  markdownPath: join(outputDirectory, "missed-meaningful-move-audit.md"),
});

console.log(
  `Missed meaningful move audit: ${report.totals.candidates} candidates, ${report.totals.missed} missed, ${report.totals.major} major.`,
);
if (report.totals.symbolsWithoutAuditWindowCandles > 0) {
  console.log(
    `Data quality: ${report.totals.symbolsWithoutAuditWindowCandles} symbols had cached candles outside the audited Discord window.`,
  );
}
console.log(`Wrote ${join(outputDirectory, "missed-meaningful-move-audit.json")}`);
console.log(`Wrote ${join(outputDirectory, "missed-meaningful-move-audit.md")}`);
