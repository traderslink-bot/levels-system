import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  buildLivePostReplaySimulationReport,
  buildLivePostProfileComparisonReport,
  buildRunnerStoryReport,
  writeLivePostReplaySimulationReports,
  writeLivePostProfileComparisonReports,
  writeRunnerStoryReports,
} from "../lib/review/live-post-replay-simulator.js";
import { resolveLiveThreadPostingProfile } from "../lib/monitoring/live-thread-post-policy.js";

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }

  const index = process.argv.indexOf(name);
  if (index >= 0) {
    return process.argv[index + 1];
  }

  return undefined;
}

function resolveAuditPath(input: string): string {
  const resolved = resolve(input);
  if (!existsSync(resolved)) {
    throw new Error(`Path not found: ${resolved}`);
  }

  const stats = statSync(resolved);
  if (stats.isDirectory()) {
    return join(resolved, "discord-delivery-audit.jsonl");
  }

  return resolved;
}

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run longrun:simulate:posts -- <session-folder-or-discord-audit.jsonl> [--profile quiet|balanced|active] [--symbols ATER,BIYA]");
  process.exit(1);
}

const profileArg = readFlag("--profile");
const symbolsArg = readFlag("--symbols");
const profile = resolveLiveThreadPostingProfile(profileArg ?? process.env.WATCHLIST_POSTING_PROFILE);
const symbols = symbolsArg?.split(",").map((symbol) => symbol.trim()).filter(Boolean);

const auditPath = resolveAuditPath(input);
if (!existsSync(auditPath)) {
  console.error(`Discord audit file not found: ${auditPath}`);
  process.exit(1);
}

const outputDirectory = statSync(resolve(input)).isDirectory()
  ? resolve(input)
  : dirname(resolve(input));
const jsonPath = join(outputDirectory, "live-post-replay-simulation.json");
const markdownPath = join(outputDirectory, "live-post-replay-simulation.md");
const comparisonJsonPath = join(outputDirectory, "live-post-profile-comparison.json");
const comparisonMarkdownPath = join(outputDirectory, "live-post-profile-comparison.md");
const runnerStoryJsonPath = join(outputDirectory, "runner-story-report.json");
const runnerStoryMarkdownPath = join(outputDirectory, "runner-story-report.md");
const report = buildLivePostReplaySimulationReport(auditPath, profile);
writeLivePostReplaySimulationReports({ jsonPath, markdownPath, report });
writeLivePostProfileComparisonReports({
  jsonPath: comparisonJsonPath,
  markdownPath: comparisonMarkdownPath,
  report: buildLivePostProfileComparisonReport(auditPath),
});
writeRunnerStoryReports({
  jsonPath: runnerStoryJsonPath,
  markdownPath: runnerStoryMarkdownPath,
  report: buildRunnerStoryReport(auditPath, symbols),
});

console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${markdownPath}`);
console.log(`Wrote ${comparisonJsonPath}`);
console.log(`Wrote ${comparisonMarkdownPath}`);
console.log(`Wrote ${runnerStoryJsonPath}`);
console.log(`Wrote ${runnerStoryMarkdownPath}`);
console.log(
  `Simulated posts (${report.profile}): ${report.totals.originalPosted} -> ${report.totals.simulatedPosted} ` +
    `(${report.totals.reductionPct}% reduction)`,
);
console.log(
  `Max burst 5m: ${report.totals.originalMaxPostsInFiveMinutes} -> ${report.totals.simulatedMaxPostsInFiveMinutes}`,
);
