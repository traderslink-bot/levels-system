import { join } from "node:path";
import { writeTraderUsefulnessReplayReport } from "../lib/review/trader-usefulness-replay-score.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run audit:usefulness -- <session-folder-or-discord-delivery-audit.jsonl>");
  process.exit(1);
}

const auditPath = input.endsWith(".jsonl") ? input : join(input, "discord-delivery-audit.jsonl");
const outputDirectory = input.endsWith(".jsonl")
  ? join(process.cwd(), "artifacts", "trader-usefulness")
  : input;
const jsonPath = join(outputDirectory, "trader-usefulness-replay-score.json");
const markdownPath = join(outputDirectory, "trader-usefulness-replay-score.md");

const report = writeTraderUsefulnessReplayReport({ auditPath, jsonPath, markdownPath });
console.log(`Trader usefulness replay: ${report.symbols.length} symbols, ${report.totals.posts} posts.`);
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${markdownPath}`);
