import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  generateCandleIntelligenceRegressionPack,
  writeCandleIntelligenceRegressionGate,
  type CandleIntelligenceRegressionCaseType,
} from "../lib/review/candle-intelligence-regression-pack.js";
import type { CandleProviderName } from "../lib/support-resistance/index.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArg(flag: string): number | undefined {
  const raw = argValue(flag);
  const value = raw ? Number(raw) : undefined;
  return Number.isFinite(value) ? value : undefined;
}

type RegressionGatePreset = "strict" | "review" | "exploratory";

function resolvePreset(): RegressionGatePreset {
  if (process.argv.includes("--strict")) {
    return "strict";
  }
  const raw = argValue("--preset")?.trim().toLowerCase();
  if (raw === "strict" || raw === "review" || raw === "exploratory") {
    return raw;
  }
  return "strict";
}

function presetThresholds(preset: RegressionGatePreset): {
  maxMajorCandidateCases: number;
  maxWeakFirstSnapshotCases: number;
  maxMissingForwardResistanceCases: number;
  maxExecutionRelationMissingEvidenceCases: number;
  maxFirstSnapshotMapFailureCases: number;
  maxMarketStructureChopWatchCases: number;
  maxAdvancedContextMissingCases: number;
  maxProviderReadinessWatchCases: number;
  maxQuietMayHideMoveCases: number;
  maxRuntimeFeedSilenceCases: number;
  maxPostNoiseBudgetWatchCases: number;
  maxSupportResistanceWatchCases: number;
  maxSupportResistanceBrokenCases: number;
  maxSupportResistanceUnprovenCoverageCases: number;
} {
  if (preset === "exploratory") {
    return {
      maxMajorCandidateCases: 999,
      maxWeakFirstSnapshotCases: 999,
      maxMissingForwardResistanceCases: 999,
      maxExecutionRelationMissingEvidenceCases: 999,
      maxFirstSnapshotMapFailureCases: 999,
      maxMarketStructureChopWatchCases: 999,
      maxAdvancedContextMissingCases: 999,
      maxProviderReadinessWatchCases: 999,
      maxQuietMayHideMoveCases: 999,
      maxRuntimeFeedSilenceCases: 999,
      maxPostNoiseBudgetWatchCases: 999,
      maxSupportResistanceWatchCases: 999,
      maxSupportResistanceBrokenCases: 999,
      maxSupportResistanceUnprovenCoverageCases: 999,
    };
  }
  if (preset === "review") {
    return {
      maxMajorCandidateCases: 0,
      maxWeakFirstSnapshotCases: 0,
      maxMissingForwardResistanceCases: 0,
      maxExecutionRelationMissingEvidenceCases: 50,
      maxFirstSnapshotMapFailureCases: 0,
      maxMarketStructureChopWatchCases: 12,
      maxAdvancedContextMissingCases: 12,
      maxProviderReadinessWatchCases: 20,
      maxQuietMayHideMoveCases: 0,
      maxRuntimeFeedSilenceCases: 10,
      maxPostNoiseBudgetWatchCases: 15,
      maxSupportResistanceWatchCases: 12,
      maxSupportResistanceBrokenCases: 0,
      maxSupportResistanceUnprovenCoverageCases: 25,
    };
  }
  return {
    maxMajorCandidateCases: 0,
    maxWeakFirstSnapshotCases: 0,
    maxMissingForwardResistanceCases: 0,
    maxExecutionRelationMissingEvidenceCases: 0,
    maxFirstSnapshotMapFailureCases: 0,
    maxMarketStructureChopWatchCases: 0,
    maxAdvancedContextMissingCases: 0,
    maxProviderReadinessWatchCases: 0,
    maxQuietMayHideMoveCases: 0,
    maxRuntimeFeedSilenceCases: 0,
    maxPostNoiseBudgetWatchCases: 0,
    maxSupportResistanceWatchCases: 0,
    maxSupportResistanceBrokenCases: 0,
    maxSupportResistanceUnprovenCoverageCases: 0,
  };
}

function overrideNumber(flag: string, fallback: number): number {
  return numberArg(flag) ?? fallback;
}

function positionalArgs(): string[] {
  const values: string[] = [];
  const flagsWithValues = new Set([
    "--out-dir",
    "--cache",
    "--warehouse",
    "--provider",
    "--max-cases-per-type",
    "--max-major-candidates",
    "--max-weak-first-snapshots",
    "--max-missing-forward-resistance",
    "--max-execution-missing-evidence",
    "--max-first-snapshot-map-failures",
    "--max-market-structure-chop-watch",
    "--max-advanced-context-missing",
    "--max-provider-readiness-watch",
    "--max-quiet-may-hide-moves",
    "--max-runtime-feed-silence",
    "--max-post-noise-budget-watch",
    "--max-support-resistance-watch",
    "--max-support-resistance-broken",
    "--max-support-resistance-unproven-coverage",
    "--require-case-types",
    "--preset",
  ]);
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index]!;
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

function caseTypesArg(): CandleIntelligenceRegressionCaseType[] {
  const raw = argValue("--require-case-types");
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as CandleIntelligenceRegressionCaseType[];
}

const input = positionalArgs()[0] ?? latestLongRunSession();
const allSessions = process.argv.includes("--all-sessions");
const preset = resolvePreset();
const thresholds = presetThresholds(preset);
const outDir = argValue("--out-dir") ?? (
  input.endsWith(".jsonl") || allSessions ? "artifacts/candle-intelligence-regression-gate" : input
);

const pack = await generateCandleIntelligenceRegressionPack({
  auditPath: allSessions ? "artifacts/long-run" : input,
  cacheDirectoryPath: argValue("--cache") ?? ".validation-cache/candles",
  warehouseDirectoryPath: argValue("--warehouse"),
  provider: (argValue("--provider") ?? "ibkr") as CandleProviderName,
  maxCasesPerType: numberArg("--max-cases-per-type"),
});

const result = writeCandleIntelligenceRegressionGate({
  pack,
  options: {
    maxMajorCandidateCases: overrideNumber("--max-major-candidates", thresholds.maxMajorCandidateCases),
    maxWeakFirstSnapshotCases: overrideNumber("--max-weak-first-snapshots", thresholds.maxWeakFirstSnapshotCases),
    maxMissingForwardResistanceCases: overrideNumber("--max-missing-forward-resistance", thresholds.maxMissingForwardResistanceCases),
    maxExecutionRelationMissingEvidenceCases: overrideNumber("--max-execution-missing-evidence", thresholds.maxExecutionRelationMissingEvidenceCases),
    maxFirstSnapshotMapFailureCases: overrideNumber("--max-first-snapshot-map-failures", thresholds.maxFirstSnapshotMapFailureCases),
    maxMarketStructureChopWatchCases: overrideNumber("--max-market-structure-chop-watch", thresholds.maxMarketStructureChopWatchCases),
    maxAdvancedContextMissingCases: overrideNumber("--max-advanced-context-missing", thresholds.maxAdvancedContextMissingCases),
    maxProviderReadinessWatchCases: overrideNumber("--max-provider-readiness-watch", thresholds.maxProviderReadinessWatchCases),
    maxQuietMayHideMoveCases: overrideNumber("--max-quiet-may-hide-moves", thresholds.maxQuietMayHideMoveCases),
    maxRuntimeFeedSilenceCases: overrideNumber("--max-runtime-feed-silence", thresholds.maxRuntimeFeedSilenceCases),
    maxPostNoiseBudgetWatchCases: overrideNumber("--max-post-noise-budget-watch", thresholds.maxPostNoiseBudgetWatchCases),
    maxSupportResistanceWatchCases: overrideNumber("--max-support-resistance-watch", thresholds.maxSupportResistanceWatchCases),
    maxSupportResistanceBrokenCases: overrideNumber("--max-support-resistance-broken", thresholds.maxSupportResistanceBrokenCases),
    maxSupportResistanceUnprovenCoverageCases: overrideNumber("--max-support-resistance-unproven-coverage", thresholds.maxSupportResistanceUnprovenCoverageCases),
    requiredCaseTypes: caseTypesArg(),
  },
  jsonPath: join(outDir, "candle-intelligence-regression-gate.json"),
  markdownPath: join(outDir, "candle-intelligence-regression-gate.md"),
});

console.log(
  `Candle intelligence regression gate: preset=${preset}, status=${result.status}, major=${result.totals.majorCandidateCases}, weakSnapshots=${result.totals.weakFirstSnapshot}, mapFailures=${result.totals.firstSnapshotMapFailure}, structureWatch=${result.totals.marketStructureChopWatch}, advancedMissing=${result.totals.advancedContextMissing}, providerWatch=${result.totals.providerReadinessWatch}, quietMayHide=${result.totals.quietMayHideMove}, runtimeFeedSilence=${result.totals.runtimeFeedSilence}, postNoiseWatch=${result.totals.postNoiseBudgetWatch}, missingForwardResistance=${result.totals.missingForwardResistance}, supportResistanceWatch=${result.totals.supportResistanceWatch}, supportResistanceBroken=${result.totals.supportResistanceBroken}, supportResistanceUnprovenCoverage=${result.totals.supportResistanceUnprovenCoverage}.`,
);

if (result.status === "fail" && !process.argv.includes("--no-fail")) {
  process.exitCode = 1;
}
