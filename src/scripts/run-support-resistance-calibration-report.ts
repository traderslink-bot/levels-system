import "dotenv/config";

import { join, resolve } from "node:path";

import type { CandleProviderName } from "../lib/market-data/candle-types.js";
import {
  writeSupportResistanceCalibrationGate,
  writeSupportResistanceCalibrationReport,
} from "../lib/review/support-resistance-calibration-report.js";

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0) {
    return process.argv[index + 1];
  }
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function resolveProvider(raw: string | undefined): CandleProviderName {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "ibkr" || normalized === "eodhd" || normalized === "stub") {
    return normalized;
  }
  return "ibkr";
}

function resolveMaxSymbols(): number | undefined {
  const raw = readFlag("--max-symbols");
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveMaxSessions(): number | undefined {
  const raw = readFlag("--max-sessions");
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

const allSessions = hasFlag("--all-sessions");
const positionalInput = process.argv
  .slice(2)
  .find((arg) => !arg.startsWith("--"));
const input = allSessions
  ? "artifacts/long-run"
  : positionalInput ?? "artifacts/long-run";
const outputDirectory = resolve(
  readFlag("--output") ??
  (allSessions || input.endsWith(".jsonl")
    ? join("artifacts", "support-resistance-calibration")
    : input),
);

const report = await writeSupportResistanceCalibrationReport({
  auditPath: input,
  cacheDirectoryPath: readFlag("--cache") ?? ".validation-cache/candles",
  warehouseDirectoryPath: readFlag("--warehouse"),
  provider: resolveProvider(readFlag("--provider")),
  maxSymbols: resolveMaxSymbols(),
  maxAuditFiles: resolveMaxSessions(),
  jsonPath: join(outputDirectory, "support-resistance-calibration.json"),
  markdownPath: join(outputDirectory, "support-resistance-calibration.md"),
});
const gate = writeSupportResistanceCalibrationGate({
  report,
  options: {
    maxBrokenSymbols: hasFlag("--strict") ? 0 : 0,
    maxWatchSymbols: hasFlag("--strict") ? 0 : 8,
    maxUnprovenPct: hasFlag("--strict") ? 0.25 : 0.5,
    maxFetchFirstCoverageGaps: hasFlag("--strict") ? 0 : 0,
    maxNoForwardResistanceSymbols: hasFlag("--strict") ? 0 : 8,
    maxRankingWatchSymbols: hasFlag("--strict") ? 0 : 8,
    maxStructureQuestionSymbols: 0,
  },
  jsonPath: join(outputDirectory, "support-resistance-calibration-gate.json"),
  markdownPath: join(outputDirectory, "support-resistance-calibration-gate.md"),
});

console.log(
  `Support/resistance calibration: symbols=${report.symbolsReviewed}, trusted=${report.totals.trusted}, watch=${report.totals.watch}, broken=${report.totals.broken}, unproven=${report.totals.unproven}, noForwardR=${report.totals.noForwardResistanceSymbols}, wideGap=${report.totals.wideForwardGapSymbols}, coverageGaps=${report.totals.coverageGapTasks}, gate=${gate.status}.`,
);

if (hasFlag("--strict") && gate.status === "fail" && !hasFlag("--no-fail")) {
  process.exitCode = 1;
}
