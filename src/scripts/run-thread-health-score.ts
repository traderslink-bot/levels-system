import { join } from "node:path";
import { writeThreadHealthScoreReport } from "../lib/review/thread-health-score.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run audit:thread-health -- <session-folder-or-discord-delivery-audit.jsonl>");
  process.exit(1);
}

const auditPath = input.endsWith(".jsonl") ? input : join(input, "discord-delivery-audit.jsonl");
const outputDirectory = input.endsWith(".jsonl") ? join(process.cwd(), "artifacts", "thread-health") : input;
const jsonPath = join(outputDirectory, "thread-health-score.json");
const markdownPath = join(outputDirectory, "thread-health-score.md");

const report = writeThreadHealthScoreReport({ auditPath, jsonPath, markdownPath });
console.log(`Thread health score: ${report.symbols.length} symbols.`);
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${markdownPath}`);

