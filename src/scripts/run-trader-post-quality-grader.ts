import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  buildTraderPostQualityReport,
  writeTraderPostQualityReport,
} from "../lib/review/trader-post-quality-grader.js";

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return null;
  }
  return process.argv[index + 1] ?? null;
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
  console.error("Usage: npm run quality:posts -- <session-folder-or-discord-delivery-audit.jsonl> [--output artifacts\\post-quality]");
  process.exit(1);
}

const auditPath = resolveAuditPath(input);
if (!existsSync(auditPath)) {
  console.error(`Discord audit file not found: ${auditPath}`);
  process.exit(1);
}

const outputDirectory = resolve(readFlag("--output") ?? join(resolve(auditPath, ".."), "trader-post-quality"));
const report = buildTraderPostQualityReport(auditPath);
const jsonPath = join(outputDirectory, "trader-post-quality-report.json");
const markdownPath = join(outputDirectory, "trader-post-quality-report.md");

writeTraderPostQualityReport({ report, jsonPath, markdownPath });

console.log(`Trader post quality grader checked ${report.totals.posted} posted row(s).`);
console.log(`Findings: ${report.totals.findings} (${report.totals.blocker} blocker, ${report.totals.major} major, ${report.totals.watch} watch).`);
console.log(`Repeated-story clusters: ${report.totals.repeatedStoryClusters}.`);
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${markdownPath}`);
