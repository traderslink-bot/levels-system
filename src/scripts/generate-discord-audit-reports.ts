import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
import {
  buildTraderPostQualityReport,
  writeTraderPostQualityReport,
} from "../lib/review/trader-post-quality-grader.js";
import {
  buildPostReasonAuditReport,
  writePostReasonAuditReport,
} from "../lib/review/post-reason-audit-report.js";
import {
  buildKnownBadPostPatternReport,
  writeKnownBadPostPatternReport,
} from "../lib/review/known-bad-post-patterns.js";
import {
  buildMarketStructureDeliveryAuditReportFromPaths,
  writeMarketStructureDeliveryAuditReport,
} from "../lib/review/market-structure-delivery-audit.js";
import {
  buildMarketStructureOutcomeCalibrationReport,
  writeMarketStructureOutcomeCalibrationReport,
} from "../lib/review/market-structure-outcome-calibration.js";

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
const reportDirectory = isAuditFile ? dirname(resolvedInput) : resolvedInput;
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
      traderPostQualityJsonPath: resolve(resolvedInput, "..", "trader-post-quality-report.json"),
      traderPostQualityMarkdownPath: resolve(resolvedInput, "..", "trader-post-quality-report.md"),
      postReasonAuditJsonPath: resolve(resolvedInput, "..", "post-reason-audit.json"),
      postReasonAuditMarkdownPath: resolve(resolvedInput, "..", "post-reason-audit.md"),
      knownBadPostPatternsJsonPath: resolve(resolvedInput, "..", "known-bad-post-patterns.json"),
      knownBadPostPatternsMarkdownPath: resolve(resolvedInput, "..", "known-bad-post-patterns.md"),
      marketStructureDeliveryJsonPath: resolve(resolvedInput, "..", "market-structure-delivery-audit.json"),
      marketStructureDeliveryMarkdownPath: resolve(resolvedInput, "..", "market-structure-delivery-audit.md"),
      marketStructureOutcomeJsonPath: resolve(resolvedInput, "..", "market-structure-outcome-calibration.json"),
      marketStructureOutcomeMarkdownPath: resolve(resolvedInput, "..", "market-structure-outcome-calibration.md"),
    }
  : {
      ...defaultReportPaths(resolvedInput),
      marketStructureDeliveryJsonPath: join(resolvedInput, "market-structure-delivery-audit.json"),
      marketStructureDeliveryMarkdownPath: join(resolvedInput, "market-structure-delivery-audit.md"),
      marketStructureOutcomeJsonPath: join(resolvedInput, "market-structure-outcome-calibration.json"),
      marketStructureOutcomeMarkdownPath: join(resolvedInput, "market-structure-outcome-calibration.md"),
    };

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
writeTraderPostQualityReport({
  jsonPath: paths.traderPostQualityJsonPath,
  markdownPath: paths.traderPostQualityMarkdownPath,
  report: buildTraderPostQualityReport(paths.auditPath),
});
writePostReasonAuditReport({
  jsonPath: paths.postReasonAuditJsonPath,
  markdownPath: paths.postReasonAuditMarkdownPath,
  report: buildPostReasonAuditReport(paths.auditPath),
});
writeKnownBadPostPatternReport({
  jsonPath: paths.knownBadPostPatternsJsonPath,
  markdownPath: paths.knownBadPostPatternsMarkdownPath,
  report: buildKnownBadPostPatternReport(paths.auditPath),
});
writeMarketStructureDeliveryAuditReport({
  jsonPath: paths.marketStructureDeliveryJsonPath,
  markdownPath: paths.marketStructureDeliveryMarkdownPath,
  report: buildMarketStructureDeliveryAuditReportFromPaths([
    paths.auditPath,
    join(reportDirectory, "market-structure-lifecycle.jsonl"),
  ].filter((path) => existsSync(path))),
});
writeMarketStructureOutcomeCalibrationReport({
  jsonPath: paths.marketStructureOutcomeJsonPath,
  markdownPath: paths.marketStructureOutcomeMarkdownPath,
  report: buildMarketStructureOutcomeCalibrationReport({
    auditPath: paths.auditPath,
  }),
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
console.log(`Wrote ${paths.traderPostQualityJsonPath}`);
console.log(`Wrote ${paths.traderPostQualityMarkdownPath}`);
console.log(`Wrote ${paths.postReasonAuditJsonPath}`);
console.log(`Wrote ${paths.postReasonAuditMarkdownPath}`);
console.log(`Wrote ${paths.knownBadPostPatternsJsonPath}`);
console.log(`Wrote ${paths.knownBadPostPatternsMarkdownPath}`);
console.log(`Wrote ${paths.marketStructureDeliveryJsonPath}`);
console.log(`Wrote ${paths.marketStructureDeliveryMarkdownPath}`);
console.log(`Wrote ${paths.marketStructureOutcomeJsonPath}`);
console.log(`Wrote ${paths.marketStructureOutcomeMarkdownPath}`);
