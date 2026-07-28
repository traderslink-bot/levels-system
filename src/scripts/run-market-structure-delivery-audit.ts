import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  buildMarketStructureDeliveryAuditReportFromPaths,
  writeMarketStructureDeliveryAuditReport,
} from "../lib/review/market-structure-delivery-audit.js";

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveAuditPaths(input: string): string[] {
  const resolved = resolve(input);
  if (resolved.toLowerCase().endsWith(".jsonl")) {
    const siblingLifecyclePath = join(dirname(resolved), "market-structure-lifecycle.jsonl");
    return existsSync(siblingLifecyclePath) && resolved.toLowerCase().endsWith("discord-delivery-audit.jsonl")
      ? [resolved, siblingLifecyclePath]
      : [resolved];
  }

  return [
    join(resolved, "discord-delivery-audit.jsonl"),
    join(resolved, "market-structure-lifecycle.jsonl"),
  ].filter((path) => existsSync(path));
}

const input = process.argv[2];
if (!input || input === "--help" || input === "-h") {
  console.error("Usage: npx tsx src/scripts/run-market-structure-delivery-audit.ts <session-folder-or-discord-delivery-audit.jsonl> [--output artifacts/market-structure-delivery-audit]");
  process.exit(1);
}

const auditPaths = resolveAuditPaths(input);
if (auditPaths.length === 0 || !auditPaths.some((path) => path.toLowerCase().endsWith("discord-delivery-audit.jsonl"))) {
  throw new Error(`Discord delivery audit not found for input: ${resolve(input)}`);
}

const outputDirectory = resolve(readFlag("--output") ?? join("artifacts", "market-structure-delivery-audit"));
const report = buildMarketStructureDeliveryAuditReportFromPaths(auditPaths);
const jsonPath = join(outputDirectory, "market-structure-delivery-audit.json");
const markdownPath = join(outputDirectory, "market-structure-delivery-audit.md");

writeMarketStructureDeliveryAuditReport({ report, jsonPath, markdownPath });

console.log(`Market structure delivery rows: ${report.totals.structureEvents}`);
console.log(`Posted/carried: ${report.totals.posted}`);
console.log(`Expired unposted: ${report.totals.expiredUnposted}`);
console.log(`Findings: ${report.totals.findings}`);
console.log(`JSON: ${jsonPath}`);
console.log(`Markdown: ${markdownPath}`);
