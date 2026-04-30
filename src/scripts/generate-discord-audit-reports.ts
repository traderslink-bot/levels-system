import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildSnapshotAuditReport,
  buildThreadPostPolicyReport,
  buildTradingDayEvidenceReport,
  defaultReportPaths,
  formatSnapshotAuditMarkdown,
  formatThreadPostPolicyMarkdown,
  formatTradingDayEvidenceMarkdown,
  writeJsonReport,
  writeTextReport,
} from "../lib/review/discord-audit-reports.js";
import {
  buildLongRunTuningSuggestionsReport,
  writeLongRunTuningSuggestionsReports,
} from "../lib/review/long-run-tuning-suggestions.js";
import {
  buildLivePostReplaySimulationReport,
  buildLivePostProfileComparisonReport,
  buildRunnerStoryReport,
  writeLivePostReplaySimulationReports,
  writeLivePostProfileComparisonReports,
  writeRunnerStoryReports,
} from "../lib/review/live-post-replay-simulator.js";

function printUsage(): never {
  console.error("Usage: npm run longrun:audit:reports -- <session-folder-or-discord-audit.jsonl>");
  process.exit(1);
}

const input = process.argv[2];
if (!input) {
  printUsage();
}

const resolvedInput = resolve(input);
const isAuditFile = resolvedInput.toLowerCase().endsWith("discord-delivery-audit.jsonl");
const paths = isAuditFile
  ? {
      auditPath: resolvedInput,
      policyReportPath: resolve(resolvedInput, "..", "thread-post-policy-report.json"),
      snapshotReportPath: resolve(resolvedInput, "..", "snapshot-audit-report.json"),
      policyMarkdownPath: resolve(resolvedInput, "..", "thread-post-policy-report.md"),
      snapshotMarkdownPath: resolve(resolvedInput, "..", "snapshot-audit-report.md"),
      tuningJsonPath: resolve(resolvedInput, "..", "long-run-tuning-suggestions.json"),
      tuningMarkdownPath: resolve(resolvedInput, "..", "long-run-tuning-suggestions.md"),
      replaySimulationJsonPath: resolve(resolvedInput, "..", "live-post-replay-simulation.json"),
      replaySimulationMarkdownPath: resolve(resolvedInput, "..", "live-post-replay-simulation.md"),
      profileComparisonJsonPath: resolve(resolvedInput, "..", "live-post-profile-comparison.json"),
      profileComparisonMarkdownPath: resolve(resolvedInput, "..", "live-post-profile-comparison.md"),
      runnerStoryJsonPath: resolve(resolvedInput, "..", "runner-story-report.json"),
      runnerStoryMarkdownPath: resolve(resolvedInput, "..", "runner-story-report.md"),
      evidenceJsonPath: resolve(resolvedInput, "..", "trading-day-evidence-report.json"),
      evidenceMarkdownPath: resolve(resolvedInput, "..", "trading-day-evidence-report.md"),
    }
  : defaultReportPaths(resolvedInput);

if (!existsSync(paths.auditPath)) {
  console.error(`Discord audit file not found: ${paths.auditPath}`);
  process.exit(1);
}

const policyReport = buildThreadPostPolicyReport(paths.auditPath);
const snapshotReport = buildSnapshotAuditReport(paths.auditPath);
const evidenceReport = buildTradingDayEvidenceReport(paths.auditPath);

writeJsonReport(paths.policyReportPath, policyReport);
writeJsonReport(paths.snapshotReportPath, snapshotReport);
writeJsonReport(paths.evidenceJsonPath, evidenceReport);
writeTextReport(paths.policyMarkdownPath, formatThreadPostPolicyMarkdown(policyReport));
writeTextReport(paths.snapshotMarkdownPath, formatSnapshotAuditMarkdown(snapshotReport));
writeTextReport(paths.evidenceMarkdownPath, formatTradingDayEvidenceMarkdown(evidenceReport));
writeLongRunTuningSuggestionsReports({
  jsonPath: paths.tuningJsonPath,
  markdownPath: paths.tuningMarkdownPath,
  report: buildLongRunTuningSuggestionsReport({ policyReport, snapshotReport }),
});
writeLivePostReplaySimulationReports({
  jsonPath: paths.replaySimulationJsonPath,
  markdownPath: paths.replaySimulationMarkdownPath,
  report: buildLivePostReplaySimulationReport(paths.auditPath),
});
writeLivePostProfileComparisonReports({
  jsonPath: paths.profileComparisonJsonPath,
  markdownPath: paths.profileComparisonMarkdownPath,
  report: buildLivePostProfileComparisonReport(paths.auditPath),
});
writeRunnerStoryReports({
  jsonPath: paths.runnerStoryJsonPath,
  markdownPath: paths.runnerStoryMarkdownPath,
  report: buildRunnerStoryReport(paths.auditPath),
});

console.log(`Wrote ${paths.policyReportPath}`);
console.log(`Wrote ${paths.snapshotReportPath}`);
console.log(`Wrote ${paths.evidenceJsonPath}`);
console.log(`Wrote ${paths.policyMarkdownPath}`);
console.log(`Wrote ${paths.snapshotMarkdownPath}`);
console.log(`Wrote ${paths.evidenceMarkdownPath}`);
console.log(`Wrote ${paths.tuningJsonPath}`);
console.log(`Wrote ${paths.tuningMarkdownPath}`);
console.log(`Wrote ${paths.replaySimulationJsonPath}`);
console.log(`Wrote ${paths.replaySimulationMarkdownPath}`);
console.log(`Wrote ${paths.profileComparisonJsonPath}`);
console.log(`Wrote ${paths.profileComparisonMarkdownPath}`);
console.log(`Wrote ${paths.runnerStoryJsonPath}`);
console.log(`Wrote ${paths.runnerStoryMarkdownPath}`);
