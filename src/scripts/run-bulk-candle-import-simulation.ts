import { join } from "node:path";

import { writeBulkCandleImportSimulationReport } from "../lib/review/bulk-candle-import-simulation.js";
import type { CandleFetchTimeframe, CandleProviderName } from "../lib/support-resistance/index.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArg(flag: string): number | undefined {
  const raw = argValue(flag);
  const value = raw ? Number(raw) : undefined;
  return Number.isFinite(value) ? value : undefined;
}

function timeframeArg(): CandleFetchTimeframe[] | undefined {
  const raw = argValue("--timeframes");
  if (!raw) {
    return undefined;
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as CandleFetchTimeframe[];
}

const outDir = argValue("--out-dir") ?? "artifacts/bulk-candle-import-simulation";
const report = await writeBulkCandleImportSimulationReport({
  warehouseDirectoryPath: argValue("--warehouse") ?? "data/candles",
  provider: (argValue("--provider") ?? "ibkr") as CandleProviderName,
  symbolCount: numberArg("--symbols"),
  sessionCount: numberArg("--sessions"),
  tradesPerSymbolSession: numberArg("--trades-per-symbol-session"),
  timeframes: timeframeArg(),
  startSessionDate: argValue("--start-session-date"),
  jsonPath: join(outDir, "bulk-candle-import-simulation.json"),
  markdownPath: join(outDir, "bulk-candle-import-simulation.md"),
});

console.log(
  `Bulk candle import simulation: trades=${report.totals.generatedTradeRows}, naiveTasks=${report.totals.naiveProviderTasks}, dedupedTasks=${report.totals.dedupedProviderTasks}, avoided=${report.totals.avoidedProviderTasks} (${report.totals.avoidedProviderTaskPct}%).`,
);
