import { join } from "node:path";
import { writeDailyTraderReview } from "../lib/review/daily-trader-review.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run audit:daily-review -- <session-folder-or-discord-delivery-audit.jsonl>");
  process.exit(1);
}

const auditPath = input.endsWith(".jsonl") ? input : join(input, "discord-delivery-audit.jsonl");
const outputDirectory = input.endsWith(".jsonl") ? join(process.cwd(), "artifacts", "daily-trader-review") : input;
const jsonPath = join(outputDirectory, "daily-trader-review.json");
const markdownPath = join(outputDirectory, "daily-trader-review.md");
const htmlPath = join(outputDirectory, "daily-trader-review.html");

const report = writeDailyTraderReview({ auditPath, jsonPath, markdownPath, htmlPath });
console.log(`Daily trader review: ${report.symbols.length} symbols, ${report.totals.posts} posts.`);
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${markdownPath}`);
console.log(`Wrote ${htmlPath}`);
