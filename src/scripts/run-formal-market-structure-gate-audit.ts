import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  buildFormalMarketStructureGateAuditReport,
  writeFormalMarketStructureGateAuditReport,
} from "../lib/review/formal-market-structure-gate-audit.js";

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveAuditPath(input: string): string {
  const resolved = resolve(input);
  return resolved.toLowerCase().endsWith(".jsonl")
    ? resolved
    : join(resolved, "discord-delivery-audit.jsonl");
}

const input = process.argv[2];
if (!input || input === "--help" || input === "-h") {
  console.error("Usage: npx tsx src/scripts/run-formal-market-structure-gate-audit.ts <session-folder-or-discord-delivery-audit.jsonl> [--output artifacts/formal-market-structure-gate-audit]");
  process.exit(1);
}

const auditPath = resolveAuditPath(input);
if (!existsSync(auditPath)) {
  throw new Error(`Discord delivery audit not found: ${auditPath}`);
}

const outputDirectory = resolve(readFlag("--output") ?? join("artifacts", "formal-market-structure-gate-audit"));
const report = buildFormalMarketStructureGateAuditReport(auditPath);

writeFormalMarketStructureGateAuditReport({
  report,
  jsonPath: join(outputDirectory, "formal-market-structure-gate-audit.json"),
  markdownPath: join(outputDirectory, "formal-market-structure-gate-audit.md"),
});

console.log(`Formal BOS/CHOCH events: ${report.totals.formalBosChochEvents}`);
console.log(`Actionable after gate: ${report.totals.actionable}`);
console.log(`Metadata-only after gate: ${report.totals.metadataOnly}`);
console.log(`Newly quieted by gate: ${report.totals.newlyQuieted}`);
console.log(`JSON: ${join(outputDirectory, "formal-market-structure-gate-audit.json")}`);
console.log(`Markdown: ${join(outputDirectory, "formal-market-structure-gate-audit.md")}`);
