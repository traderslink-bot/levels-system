import { join } from "node:path";
import { writeThreadEndRecapReport } from "../lib/review/thread-end-recap.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run audit:end-recap -- <session-folder-or-discord-delivery-audit.jsonl>");
  process.exit(1);
}

const auditPath = input.endsWith(".jsonl") ? input : join(input, "discord-delivery-audit.jsonl");
const outputDirectory = input.endsWith(".jsonl") ? join(process.cwd(), "artifacts", "thread-end-recaps") : input;
const jsonPath = join(outputDirectory, "thread-end-recap-report.json");
const markdownPath = join(outputDirectory, "thread-end-recap-report.md");

const report = writeThreadEndRecapReport({ auditPath, jsonPath, markdownPath });
console.log(`Thread end recap: ${report.symbols.length} symbols.`);
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${markdownPath}`);
