import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  buildKnownBadPostPatternReport,
  writeKnownBadPostPatternReport,
} from "../lib/review/known-bad-post-patterns.js";

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
  console.error("Usage: npm run audit:known-bad-posts -- <session-folder-or-discord-delivery-audit.jsonl> [--output artifacts\\known-bad-post-patterns]");
  process.exit(1);
}

const auditPath = resolveAuditPath(input);
if (!existsSync(auditPath)) {
  console.error(`Discord audit file not found: ${auditPath}`);
  process.exit(1);
}

const outputDirectory = resolve(readFlag("--output") ?? join(resolve(auditPath, ".."), "known-bad-post-patterns"));
const report = buildKnownBadPostPatternReport(auditPath);
const jsonPath = join(outputDirectory, "known-bad-post-patterns.json");
const markdownPath = join(outputDirectory, "known-bad-post-patterns.md");

writeKnownBadPostPatternReport({ report, jsonPath, markdownPath });

console.log(`Known-bad pattern scan checked ${report.checkedRows} posted row(s).`);
console.log(`Pattern hits: ${report.hitCount}.`);
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${markdownPath}`);
