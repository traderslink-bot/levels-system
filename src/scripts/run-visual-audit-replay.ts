import { join } from "node:path";
import { writeVisualAuditReplay } from "../lib/review/visual-audit-replay.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run audit:visual-replay -- <session-folder-or-discord-delivery-audit.jsonl>");
  process.exit(1);
}

const auditPath = input.endsWith(".jsonl") ? input : join(input, "discord-delivery-audit.jsonl");
const outputDirectory = input.endsWith(".jsonl") ? join(process.cwd(), "artifacts", "visual-audit-replay") : input;
const jsonPath = join(outputDirectory, "visual-audit-replay.json");
const htmlPath = join(outputDirectory, "visual-audit-replay.html");

const report = writeVisualAuditReplay({ auditPath, jsonPath, htmlPath });
console.log(`Visual audit replay: ${report.symbols.length} symbols.`);
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${htmlPath}`);
