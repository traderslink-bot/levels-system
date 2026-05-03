import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { writeEndOfDaySymbolVerdict } from "../lib/review/end-of-day-symbol-verdict.js";

function resolveAuditPath(raw: string | undefined): string {
  const input = raw?.trim();
  if (!input) {
    throw new Error("Usage: npm run audit:eod-verdict -- <session-folder-or-discord-delivery-audit.jsonl>");
  }
  const path = resolve(process.cwd(), input);
  if (!existsSync(path)) {
    throw new Error(`Audit source not found: ${path}`);
  }
  return path.endsWith(".jsonl") ? path : resolve(path, "discord-delivery-audit.jsonl");
}

const auditPath = resolveAuditPath(process.argv[2]);
const outputDir = dirname(auditPath);
const jsonPath = resolve(outputDir, "end-of-day-symbol-verdict.json");
const markdownPath = resolve(outputDir, "end-of-day-symbol-verdict.md");
const report = writeEndOfDaySymbolVerdict({ auditPath, jsonPath, markdownPath });

console.log(`End-of-day symbol verdict wrote ${markdownPath}`);
console.log(`Symbols: ${report.totals.symbols}`);
console.log(`Needs work: ${report.totals.needsWork}`);
