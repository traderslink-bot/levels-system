import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { writeFirstSnapshotTradeMapAudit } from "../lib/review/first-snapshot-trade-map-audit.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArgs(): string[] {
  const values: string[] = [];
  const flagsWithValues = new Set(["--out-dir"]);
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith("--")) {
      if (flagsWithValues.has(arg)) {
        index += 1;
      }
      continue;
    }
    values.push(arg);
  }
  return values;
}

function latestLongRunSession(): string {
  const root = "artifacts/long-run";
  if (!existsSync(root)) {
    return root;
  }
  const sessions = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((path) => existsSync(join(path, "discord-delivery-audit.jsonl")))
    .sort();
  return sessions.at(-1) ?? root;
}

const input = positionalArgs()[0] ?? latestLongRunSession();
const outDir = argValue("--out-dir") ?? (input.endsWith(".jsonl") ? "artifacts/first-snapshot-trade-map-audit" : input);
const report = writeFirstSnapshotTradeMapAudit({
  auditPath: process.argv.includes("--all-sessions") ? "artifacts/long-run" : input,
  jsonPath: join(outDir, "first-snapshot-trade-map-audit.json"),
  markdownPath: join(outDir, "first-snapshot-trade-map-audit.md"),
});

console.log(
  `First snapshot trade-map audit: ${report.totals.symbols} symbols; strong=${report.totals.strong}, usable=${report.totals.usable}, weak=${report.totals.weak}, missing=${report.totals.missing}, average=${report.totals.averageScore}/100.`,
);
