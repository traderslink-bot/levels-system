import { join, resolve } from "node:path";

import { writeMarketStructureCalibrationReport } from "../lib/review/market-structure-calibration-report.js";

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberFlag(name: string): number | undefined {
  const value = Number(readFlag(name));
  return Number.isFinite(value) ? value : undefined;
}

function listFlag(name: string): string[] | undefined {
  return readFlag(name)
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function positionalArgs(): string[] {
  const values: string[] = [];
  const flagsWithValues = new Set([
    "--output",
    "--out-dir",
    "--cache",
    "--warehouse",
    "--provider",
    "--symbols",
    "--max-files-per-symbol",
    "--rolling-step-bars",
    "--audit-root",
    "--audit-limit",
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

const input = positionalArgs()[0];
const outputDirectory = resolve(
  readFlag("--output") ?? readFlag("--out-dir") ?? (input && !input.endsWith(".jsonl")
    ? input
    : join("artifacts", "market-structure-calibration")),
);
const provider = readFlag("--provider") ?? "ibkr";
const cacheDirectory = resolve(
  readFlag("--warehouse")
    ? join(readFlag("--warehouse")!, provider)
    : readFlag("--cache") ?? join(".validation-cache", "candles", "ibkr"),
);
const report = writeMarketStructureCalibrationReport({
  replay: {
    cacheDirectory,
    symbols: listFlag("--symbols"),
    maxFilesPerSymbol: numberFlag("--max-files-per-symbol"),
    rollingStepBars: numberFlag("--rolling-step-bars"),
  },
  alignment: {
    auditRoot: resolve(readFlag("--audit-root") ?? input ?? "artifacts"),
    cacheDirectory,
    symbols: listFlag("--symbols"),
    auditLimit: numberFlag("--audit-limit") ?? null,
  },
  jsonPath: join(outputDirectory, "market-structure-calibration.json"),
  markdownPath: join(outputDirectory, "market-structure-calibration.md"),
});

console.log(
  `Market-structure calibration: symbols=${report.totals.symbols}, trusted=${report.totals.trustedForSuppression}, watch=${report.totals.watchStructureChop}, repeats=${report.totals.sameStructureRepeats}.`,
);
