import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { CandleFetchTimeframe } from "../market-data/candle-types.js";
import type { NasdaqUniverseRow, NasdaqUniverseSnapshot } from "./nasdaq-marketcap-universe.js";

export type NyseCandleCoverageStatus =
  | "covered"
  | "partial"
  | "missing"
  | "contract_unresolved";

export type NyseTimeframeCoverage = {
  timeframe: CandleFetchTimeframe;
  status: Exclude<NyseCandleCoverageStatus, "contract_unresolved">;
  rowCount: number;
  uniqueTimestampCount: number;
  duplicateTimestampCount: number;
  invalidRowCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  minRowsForComplete: number;
  staleAfterDays: number;
  reason: string;
};

export type NyseCandleSymbolTask = {
  symbol: string;
  name: string;
  marketCap: number;
  marketCapBucket: string;
  status: NyseCandleCoverageStatus;
  timeframeCoverage: NyseTimeframeCoverage[];
  fetchTimeframes: CandleFetchTimeframe[];
};

export type NyseCandleBackfillPlan = {
  generatedAt: string;
  sourceUniversePath: string;
  warehouseDirectoryPath: string;
  provider: "ibkr";
  timeframes: CandleFetchTimeframe[];
  dryRun: boolean;
  maxSymbols: number | null;
  totals: {
    symbols: number;
    covered: number;
    partial: number;
    missing: number;
    contractUnresolved: number;
    selectedForFetch: number;
  };
  tasks: NyseCandleSymbolTask[];
  selectedTasks: NyseCandleSymbolTask[];
};

export const NYSE_DEFAULT_TIMEFRAMES: CandleFetchTimeframe[] = ["daily", "4h", "5m"];

export const NYSE_LOOKBACKS: Record<CandleFetchTimeframe, number> = {
  daily: 220,
  "4h": 180,
  "5m": 240,
  "1m": 390,
};

const MIN_ROWS_FOR_COMPLETE: Record<CandleFetchTimeframe, number> = {
  daily: 120,
  "4h": 60,
  "5m": 100,
  "1m": 100,
};

const STALE_AFTER_DAYS: Record<CandleFetchTimeframe, number> = {
  daily: 14,
  "4h": 14,
  "5m": 14,
  "1m": 7,
};

type WarehouseRowCandidate = {
  timestamp?: unknown;
};

export function buildNyseCleanUniverse(snapshot: NasdaqUniverseSnapshot): NasdaqUniverseRow[] {
  return snapshot.rows
    .filter((row) => row.isLikelyCommonEquity)
    .sort((left, right) =>
      left.marketCapBucket.localeCompare(right.marketCapBucket) ||
      left.marketCap - right.marketCap ||
      left.symbol.localeCompare(right.symbol),
    );
}

export function buildNyseCandleBackfillPlan(params: {
  snapshot: NasdaqUniverseSnapshot;
  sourceUniversePath: string;
  warehouseDirectoryPath?: string;
  timeframes?: CandleFetchTimeframe[];
  maxSymbols?: number;
  dryRun?: boolean;
  knownContractUnresolvedSymbols?: string[];
  now?: number;
}): NyseCandleBackfillPlan {
  const warehouseDirectoryPath = params.warehouseDirectoryPath ?? "data/candles";
  const timeframes = params.timeframes ?? NYSE_DEFAULT_TIMEFRAMES;
  const unresolved = new Set((params.knownContractUnresolvedSymbols ?? []).map((symbol) => symbol.toUpperCase()));
  const now = params.now ?? Date.now();
  const tasks = buildNyseCleanUniverse(params.snapshot).map((row): NyseCandleSymbolTask => {
    const timeframeCoverage = timeframes.map((timeframe) =>
      readTimeframeCoverage({
        warehouseDirectoryPath,
        symbol: row.symbol,
        timeframe,
        now,
      }),
    );
    const fetchTimeframes = timeframeCoverage
      .filter((coverage) => coverage.status !== "covered")
      .map((coverage) => coverage.timeframe);
    const status = unresolved.has(row.symbol)
      ? "contract_unresolved"
      : symbolStatus(timeframeCoverage);
    return {
      symbol: row.symbol,
      name: row.name,
      marketCap: row.marketCap,
      marketCapBucket: row.marketCapBucket,
      status,
      timeframeCoverage,
      fetchTimeframes: status === "contract_unresolved" ? [] : fetchTimeframes,
    };
  });

  const fetchableTasks = tasks.filter((task) => task.fetchTimeframes.length > 0);
  const selectedTasks = typeof params.maxSymbols === "number" && Number.isFinite(params.maxSymbols)
    ? fetchableTasks.slice(0, params.maxSymbols)
    : fetchableTasks;

  return {
    generatedAt: new Date(now).toISOString(),
    sourceUniversePath: params.sourceUniversePath,
    warehouseDirectoryPath,
    provider: "ibkr",
    timeframes,
    dryRun: params.dryRun ?? true,
    maxSymbols: params.maxSymbols ?? null,
    totals: {
      symbols: tasks.length,
      covered: tasks.filter((task) => task.status === "covered").length,
      partial: tasks.filter((task) => task.status === "partial").length,
      missing: tasks.filter((task) => task.status === "missing").length,
      contractUnresolved: tasks.filter((task) => task.status === "contract_unresolved").length,
      selectedForFetch: selectedTasks.length,
    },
    tasks,
    selectedTasks,
  };
}

export function formatNyseCandleBackfillPlan(plan: NyseCandleBackfillPlan): string {
  const lines = [
    "# NYSE Candle Backfill Execution Plan",
    "",
    `Generated at: ${plan.generatedAt}`,
    "",
    `Source universe: ${plan.sourceUniversePath}`,
    `Warehouse: ${plan.warehouseDirectoryPath}`,
    `Provider: ${plan.provider}`,
    `Mode: ${plan.dryRun ? "dry_run" : "execute"}`,
    `Timeframes: ${plan.timeframes.join(", ")}`,
    "",
    "This plan selects all clean NYSE common-equity tickers. It skips covered symbol/timeframe pairs before provider fetch, and execute mode writes through the durable warehouse upsert path keyed by timestamp.",
    "",
    "## Totals",
    "",
    `- symbols: ${plan.totals.symbols}`,
    `- covered: ${plan.totals.covered}`,
    `- partial: ${plan.totals.partial}`,
    `- missing: ${plan.totals.missing}`,
    `- contract unresolved: ${plan.totals.contractUnresolved}`,
    `- selected for fetch: ${plan.totals.selectedForFetch}`,
    "",
    "## Selected Fetch Tasks",
    "",
    "| Symbol | Bucket | Market Cap | Status | Fetch Timeframes | Coverage Reasons |",
    "| --- | --- | ---: | --- | --- | --- |",
    ...plan.selectedTasks.map((task) => {
      const reasons = task.timeframeCoverage
        .filter((coverage) => coverage.status !== "covered")
        .map((coverage) => `${coverage.timeframe}: ${coverage.reason}`)
        .join("; ");
      return `| ${task.symbol} | ${task.marketCapBucket} | ${formatDollars(task.marketCap)} | ${task.status} | ${task.fetchTimeframes.join(", ")} | ${escapeMarkdownCell(reasons)} |`;
    }),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function readTimeframeCoverage(params: {
  warehouseDirectoryPath: string;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  now: number;
}): NyseTimeframeCoverage {
  const directory = join(params.warehouseDirectoryPath, "ibkr", params.symbol, params.timeframe);
  const rows = readWarehouseRows(directory);
  const timestamps = rows
    .map((row) => (typeof row.timestamp === "number" && Number.isFinite(row.timestamp) ? row.timestamp : null))
    .filter((timestamp): timestamp is number => timestamp !== null);
  const uniqueTimestamps = new Set(timestamps);
  const invalidRowCount = rows.length - timestamps.length;
  const duplicateTimestampCount = timestamps.length - uniqueTimestamps.size;
  const sorted = [...uniqueTimestamps].sort((left, right) => left - right);
  const firstTimestamp = sorted[0] ?? null;
  const lastTimestamp = sorted.at(-1) ?? null;
  const minRowsForComplete = MIN_ROWS_FOR_COMPLETE[params.timeframe];
  const staleAfterDays = STALE_AFTER_DAYS[params.timeframe];

  if (rows.length === 0) {
    return {
      timeframe: params.timeframe,
      status: "missing",
      rowCount: 0,
      uniqueTimestampCount: 0,
      duplicateTimestampCount: 0,
      invalidRowCount: 0,
      firstTimestamp,
      lastTimestamp,
      minRowsForComplete,
      staleAfterDays,
      reason: "no warehouse rows",
    };
  }

  const stale = lastTimestamp !== null && params.now - lastTimestamp > staleAfterDays * 24 * 60 * 60 * 1000;
  const lowRows = uniqueTimestamps.size < minRowsForComplete;
  const invalid = invalidRowCount > 0 || duplicateTimestampCount > 0;
  const status = stale || lowRows || invalid ? "partial" : "covered";
  const reasons = [
    stale ? `latest candle older than ${staleAfterDays} days` : null,
    lowRows ? `only ${uniqueTimestamps.size}/${minRowsForComplete} minimum rows` : null,
    invalidRowCount > 0 ? `${invalidRowCount} invalid rows` : null,
    duplicateTimestampCount > 0 ? `${duplicateTimestampCount} duplicate timestamps` : null,
  ].filter((reason): reason is string => reason !== null);

  return {
    timeframe: params.timeframe,
    status,
    rowCount: rows.length,
    uniqueTimestampCount: uniqueTimestamps.size,
    duplicateTimestampCount,
    invalidRowCount,
    firstTimestamp,
    lastTimestamp,
    minRowsForComplete,
    staleAfterDays,
    reason: reasons.join("; ") || "complete enough for broad NYSE baseline",
  };
}

function readWarehouseRows(directory: string): WarehouseRowCandidate[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".jsonl"))
    .flatMap((entry) => {
      const path = join(directory, entry);
      return readFileSync(path, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line): WarehouseRowCandidate[] => {
          try {
            return [JSON.parse(line) as WarehouseRowCandidate];
          } catch {
            return [{}];
          }
        });
    });
}

function symbolStatus(coverage: NyseTimeframeCoverage[]): NyseCandleCoverageStatus {
  if (coverage.every((item) => item.status === "covered")) {
    return "covered";
  }
  if (coverage.every((item) => item.status === "missing")) {
    return "missing";
  }
  return "partial";
}

function formatDollars(value: number): string {
  return `$${(value / 1_000_000).toFixed(2)}M`;
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "/").replace(/\r?\n/g, " ").trim();
}
