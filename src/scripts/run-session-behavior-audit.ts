import { join } from "node:path";

import { writeSessionBehaviorAudit } from "../lib/review/session-behavior-audit.js";
import type { CandleProviderName } from "../lib/market-data/candle-types.js";

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
  console.error("Usage: npm run audit:session-behavior -- <session-folder-or-discord-delivery-audit.jsonl> [--cache .validation-cache/candles] [--provider ibkr]");
  process.exit(1);
}

const auditPath = input.endsWith(".jsonl") ? input : join(input, "discord-delivery-audit.jsonl");
const outputDirectory = input.endsWith(".jsonl")
  ? join(process.cwd(), "artifacts", "session-behavior-audit")
  : input;
const provider = (readFlag("--provider") ?? "ibkr") as CandleProviderName;
const cacheDirectoryPath = readFlag("--cache") ?? join(process.cwd(), ".validation-cache", "candles");

const report = writeSessionBehaviorAudit({
  auditPath,
  cacheDirectoryPath,
  provider,
  jsonPath: join(outputDirectory, "session-behavior-audit.json"),
  markdownPath: join(outputDirectory, "session-behavior-audit.md"),
});

console.log(
  `Session behavior audit: ${report.totals.symbols} symbols; readiness ${report.totals.ready}/${report.totals.partial}/${report.totals.blocked}; balance noisy=${report.totals.tooNoisy}, quiet=${report.totals.possiblyTooQuiet}, mixed=${report.totals.mixedReview}, unproven=${report.totals.dataUnproven}.`,
);
console.log(`Wrote ${join(outputDirectory, "session-behavior-audit.json")}`);
console.log(`Wrote ${join(outputDirectory, "session-behavior-audit.md")}`);
