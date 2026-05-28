import { join } from "node:path";
import { writeTradeLifecycleSummaryReport } from "../lib/review/trade-lifecycle-summary.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run audit:lifecycle -- <session-folder-or-discord-delivery-audit.jsonl>");
  process.exit(1);
}

const auditPath = input.endsWith(".jsonl") ? input : join(input, "discord-delivery-audit.jsonl");
const outputDirectory = input.endsWith(".jsonl") ? join(process.cwd(), "artifacts", "trade-lifecycle") : input;
const jsonPath = join(outputDirectory, "trade-lifecycle-summary.json");
const markdownPath = join(outputDirectory, "trade-lifecycle-summary.md");

const report = writeTradeLifecycleSummaryReport({ auditPath, jsonPath, markdownPath });
console.log(`Trade lifecycle summary: ${report.symbols.length} symbols.`);
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${markdownPath}`);

