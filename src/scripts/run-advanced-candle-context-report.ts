import { join } from "node:path";

import { writeAdvancedCandleContextReport } from "../lib/review/advanced-candle-context-report.js";
import type { CandleProviderName } from "../lib/support-resistance/index.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArgs(): string[] {
  const values: string[] = [];
  const flagsWithValues = new Set(["--out-dir", "--cache", "--warehouse", "--provider", "--symbols", "--max-symbols"]);
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

function numberArg(flag: string): number | undefined {
  const value = Number(argValue(flag));
  return Number.isFinite(value) ? value : undefined;
}

function listArg(flag: string): string[] | undefined {
  return argValue(flag)
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const input = positionalArgs()[0];
const outDir = argValue("--out-dir") ?? (input && !input.endsWith(".jsonl") ? input : "artifacts/advanced-candle-context");
const report = await writeAdvancedCandleContextReport({
  cacheDirectoryPath: argValue("--warehouse") ?? argValue("--cache") ?? ".validation-cache/candles",
  provider: (argValue("--provider") ?? "ibkr") as CandleProviderName,
  symbols: listArg("--symbols"),
  maxSymbols: numberArg("--max-symbols"),
  jsonPath: join(outDir, "advanced-candle-context.json"),
  markdownPath: join(outDir, "advanced-candle-context.md"),
});

console.log(
  `Advanced candle context: symbols=${report.totals.symbols}, ready=${report.totals.ready}, vwap=${report.totals.vwapAvailable}, gaps=${report.totals.gapsDetected}, weakData=${report.totals.weakDataQuality}.`,
);
