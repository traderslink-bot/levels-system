import { readFileSync } from "node:fs";
import { basename } from "node:path";

import {
  aggregateOpportunityDiagnosticsRuns,
  summarizeOpportunityDiagnostics,
  type OpportunityDiagnosticsLogEntry,
  type OpportunityDiagnosticsRun,
} from "../lib/monitoring/opportunity-diagnostics.js";

function readNdjsonFile(path: string): OpportunityDiagnosticsLogEntry[] {
  const raw = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return raw.map((line) => JSON.parse(line) as OpportunityDiagnosticsLogEntry);
}

function main(): void {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    throw new Error("Provide one or more .ndjson validation files.");
  }

  const runs: OpportunityDiagnosticsRun[] = files.map((file) => ({
    source: basename(file),
    entries: readNdjsonFile(file),
  }));

  console.log(JSON.stringify({
    aggregate: aggregateOpportunityDiagnosticsRuns(runs),
    perRun: runs.map((run) => ({
      source: run.source,
      summary: summarizeOpportunityDiagnostics(run.entries),
    })),
  }, null, 2));
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
}
