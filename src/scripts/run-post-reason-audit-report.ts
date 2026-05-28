import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  buildPostReasonAuditReport,
  writePostReasonAuditReport,
} from "../lib/review/post-reason-audit-report.js";

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function resolveAuditPath(input: string): string {
  const resolved = resolve(input);
  if (resolved.toLowerCase().endsWith("discord-delivery-audit.jsonl")) {
    return resolved;
  }
  return join(resolved, "discord-delivery-audit.jsonl");
}

const input = process.argv[2];
if (!input || input.startsWith("--")) {
  console.error("Usage: npm run audit:post-reasons -- <session-folder-or-discord-delivery-audit.jsonl> [--output artifacts\\post-reason-audit]");
  process.exit(1);
}

const auditPath = resolveAuditPath(input);
if (!existsSync(auditPath)) {
  console.error(`Discord audit file not found: ${auditPath}`);
  process.exit(1);
}

const outputDirectory = resolve(readFlag("--output") ?? join(resolve(auditPath, ".."), "post-reason-audit"));
const report = buildPostReasonAuditReport(auditPath);
const jsonPath = join(outputDirectory, "post-reason-audit.json");
const markdownPath = join(outputDirectory, "post-reason-audit.md");

writePostReasonAuditReport({ report, jsonPath, markdownPath });

console.log(`Post reason audit checked ${report.totals.postedRows} posted row(s).`);
console.log(`whyPosted rows: ${report.totals.rowsWithWhyPosted}; missing whyPosted rows: ${report.totals.rowsWithoutWhyPosted}.`);
console.log(`noLevelReason rows: ${report.totals.rowsWithNoLevelReason}.`);
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${markdownPath}`);
