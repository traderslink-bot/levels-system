import { join } from "node:path";

import { DEFAULT_LIVE_WATCHLIST_AUDIT_ARCHIVE_FILE } from "../lib/live-watchlist/live-watchlist-audit-archive.js";
import type { CandleProviderName } from "../lib/market-data/candle-types.js";
import {
  readChartThesisQaSymbolsFromCache,
  writeChartThesisQaReport,
} from "../lib/review/chart-thesis-qa-report.js";
import {
  groupWatchlistLifecycleSessionsBySymbol,
  readWatchlistLifecycleSessionsFromFiles,
} from "../lib/review/watchlist-lifecycle-sessions.js";

function readFlag(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (inline !== undefined) {
    return inline;
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readRepeatedFlag(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1] as string);
      index += 1;
      continue;
    }
    if (arg?.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1));
    }
  }
  return values;
}

function readNumberFlag(name: string, fallback: number): number {
  const raw = readFlag(name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${name} value "${raw}".`);
  }
  return value;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

const cacheDirectory = readFlag("--cache-dir") ?? join(".validation-cache", "candles");
const provider = (readFlag("--provider") ?? "eodhd") as CandleProviderName;
const outputDirectory = readFlag("--out-dir") ?? join("artifacts", "chart-thesis-qa-report");
const symbols = readRepeatedFlag("--symbol")
  .flatMap((value) => value.split(","))
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);
const maxSymbols = readNumberFlag("--max-symbols", 80);
const samplesPerSymbol = readNumberFlag("--samples-per-symbol", 12);
const horizonBars = readNumberFlag("--horizon-bars", 10);
const meaningfulMovePct = readNumberFlag("--meaningful-move-pct", 25);
const maxExamples = readNumberFlag("--max-examples", 12);
const lifecycleArchivePath = hasFlag("--no-lifecycle")
  ? null
  : readFlag("--lifecycle-archive") ?? DEFAULT_LIVE_WATCHLIST_AUDIT_ARCHIVE_FILE;
const lifecycleStatePath = hasFlag("--no-lifecycle")
  ? null
  : readFlag("--watchlist-state") ?? join("artifacts", "manual-watchlist-state.json");
const lifecycleEventLogPath = hasFlag("--no-lifecycle")
  ? null
  : readFlag("--lifecycle-events") ?? join("artifacts", "watchlist-lifecycle-events.jsonl");

const qaSymbols = readChartThesisQaSymbolsFromCache({
  cacheDirectory,
  provider,
  symbols,
  maxSymbols,
});
const lifecycleSessions = readWatchlistLifecycleSessionsFromFiles({
  eventLogPath: lifecycleEventLogPath,
  archivePath: lifecycleArchivePath,
  statePath: lifecycleStatePath,
});
const lifecycleSessionsBySymbol = groupWatchlistLifecycleSessionsBySymbol(lifecycleSessions);

const report = writeChartThesisQaReport({
  symbols: qaSymbols,
  source: hasFlag("--no-lifecycle")
    ? `${cacheDirectory}/${provider}`
    : `${cacheDirectory}/${provider} + lifecycle:${lifecycleSessions.length} sessions`,
  outputDirectory,
  samplesPerSymbol,
  horizonBars,
  meaningfulMovePct,
  maxExamples,
  lifecycleSessionsBySymbol,
});

console.log(
  `Chart thesis QA: ${report.totals.symbols} symbols, ${report.totals.samplesWithThesis} thesis samples, ${report.totals.hitTarget} target hits, ${report.totals.partialProgress} partial, ${report.totals.invalidated} invalidated, statuses active/watch/early=${report.totals.thesisStatuses.active}/${report.totals.thesisStatuses.watch}/${report.totals.thesisStatuses.early}, lifecycle active/archive/outside/unknown=${report.totals.lifecycleScopes.active_window}/${report.totals.lifecycleScopes.archive_only}/${report.totals.lifecycleScopes.outside_active_window}/${report.totals.lifecycleScopes.unknown_lifecycle}, live confirmation total/with-thesis/missed=${report.totals.liveConfirmationPresent}/${report.totals.liveConfirmationWithThesis}/${report.totals.liveConfirmationOnMissedMoves}, ${report.totals.missedMeaningfulMoves} missed meaningful moves.`,
);
console.log(`Wrote ${join(outputDirectory, "chart-thesis-qa-report.json")}`);
console.log(`Wrote ${join(outputDirectory, "chart-thesis-qa-report.md")}`);
