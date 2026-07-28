import "dotenv/config";

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DurableCandleWarehouse } from "../lib/candle-warehouse/index.js";
import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import type { CandleFetchTimeframe } from "../lib/market-data/candle-types.js";
import {
  buildUnder500Universe,
  readNasdaqUniverseSnapshot,
  type NasdaqUniverseRow,
} from "../lib/review/nasdaq-marketcap-universe.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import {
  createIbkrClient,
  DEFAULT_IBKR_HOST,
  DEFAULT_IBKR_PORT,
} from "./shared/ibkr-runtime.js";

type DeepTimeframe = Extract<CandleFetchTimeframe, "daily" | "4h">;

type Segment = "under500" | "over500";

type DeepTask = {
  segment: Segment;
  symbol: string;
  name: string;
  marketCap: number;
  marketCapBucket: string;
  fetchTimeframes: DeepTimeframe[];
  coverage: Record<DeepTimeframe, TimeframeCoverage>;
};

type TimeframeCoverage = {
  timeframe: DeepTimeframe;
  uniqueTimestampCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  minRowsForComplete: number;
  status: "covered" | "partial" | "missing";
  reason: string;
};

type ExecuteResult = {
  segment: Segment;
  symbol: string;
  timeframe: DeepTimeframe;
  status: "fetched" | "failed" | "contract_unresolved";
  candleCount: number;
  error?: string;
};

type RunPhase =
  | "planning"
  | "planned"
  | "connecting"
  | "fetching"
  | "completed"
  | "exiting"
  | "fatal";

type RunState = {
  pid: number;
  startedAt: string;
  updatedAt: string;
  phase: RunPhase;
  outDir: string;
  execute: boolean;
  startAfterSymbol?: string;
  selectedSymbols?: number;
  selectedRequests?: number;
  completedRequests: number;
  currentSymbol?: string;
  currentTimeframe?: DeepTimeframe;
  lastResult?: ExecuteResult & { timestamp: number };
  exit?: {
    reason: string;
    code?: number;
    signal?: string;
    message?: string;
  };
};

const LOOKBACKS: Record<DeepTimeframe, number> = {
  daily: 1_300,
  "4h": 6_500,
};

const MIN_ROWS_FOR_COMPLETE: Record<DeepTimeframe, number> = {
  daily: 1_000,
  "4h": 2_500,
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function numberArg(flag: string): number | undefined {
  const raw = argValue(flag);
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? value : undefined;
}

function envPositiveInteger(name: string): number | undefined {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function createBackfillClient() {
  return createIbkrClient(
    envPositiveInteger("LEVEL_BACKFILL_IBKR_CLIENT_ID") ??
      envPositiveInteger("LEVEL_VALIDATION_IBKR_CLIENT_ID") ??
      202,
    process.env.LEVEL_BACKFILL_IBKR_HOST?.trim() ||
      process.env.LEVEL_VALIDATION_IBKR_HOST?.trim() ||
      DEFAULT_IBKR_HOST,
    envPositiveInteger("LEVEL_BACKFILL_IBKR_PORT") ??
      envPositiveInteger("LEVEL_VALIDATION_IBKR_PORT") ??
      DEFAULT_IBKR_PORT,
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isContractUnresolved(error: string): boolean {
  return error.includes("code 200") || /No security definition/i.test(error);
}

function taskBase(row: NasdaqUniverseRow, segment: Segment) {
  return {
    segment,
    symbol: row.symbol,
    name: row.name,
    marketCap: row.marketCap,
    marketCapBucket: row.marketCapBucket,
  };
}

function buildOrderedUniverse(rows: NasdaqUniverseRow[]): Array<Omit<DeepTask, "fetchTimeframes" | "coverage">> {
  const cleanRows = rows.filter((row) => row.isLikelyCommonEquity);
  const under = buildUnder500Universe({
    generatedAt: "",
    source: "",
    rawCount: cleanRows.length,
    cleanCount: cleanRows.length,
    rows: cleanRows,
  });
  const underRows = Object.values(under.buckets).flat();
  const underSymbols = new Set(underRows.map((row) => row.symbol));
  const overRows = cleanRows
    .filter((row) => !underSymbols.has(row.symbol))
    .sort((left, right) => left.marketCap - right.marketCap || left.symbol.localeCompare(right.symbol));

  return [
    ...underRows.map((row) => taskBase(row, "under500")),
    ...overRows.map((row) => taskBase(row, "over500")),
  ];
}

function readCoverage(warehouseDirectoryPath: string, symbol: string, timeframe: DeepTimeframe): TimeframeCoverage {
  const directory = join(warehouseDirectoryPath, "ibkr", symbol, timeframe);
  const minRowsForComplete = MIN_ROWS_FOR_COMPLETE[timeframe];
  const coverage = readTimestampCoverage(directory, minRowsForComplete);
  const status =
    coverage.uniqueTimestampCount === 0
      ? "missing"
      : coverage.uniqueTimestampCount >= minRowsForComplete
        ? "covered"
        : "partial";
  return {
    timeframe,
    uniqueTimestampCount: coverage.uniqueTimestampCount,
    firstTimestamp: coverage.firstTimestamp,
    lastTimestamp: coverage.lastTimestamp,
    minRowsForComplete,
    status,
    reason:
      status === "covered"
        ? "complete enough for 5-year deep baseline"
        : coverage.uniqueTimestampCount === 0
          ? "no warehouse rows"
          : `only ${coverage.uniqueTimestampCount}/${minRowsForComplete} minimum rows`,
  };
}

function readTimestampCoverage(
  directory: string,
  minRowsForComplete: number,
): Pick<TimeframeCoverage, "uniqueTimestampCount" | "firstTimestamp" | "lastTimestamp"> {
  if (!existsSync(directory)) {
    return { uniqueTimestampCount: 0, firstTimestamp: null, lastTimestamp: null };
  }
  const timestamps = new Set<number>();
  let firstTimestamp: number | null = null;
  let lastTimestamp: number | null = null;
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith(".jsonl")) {
      continue;
    }
    for (const line of readFileSync(join(directory, entry), "utf8").split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        const row = JSON.parse(line) as { timestamp?: unknown };
        if (typeof row.timestamp === "number" && Number.isFinite(row.timestamp)) {
          timestamps.add(row.timestamp);
          firstTimestamp = firstTimestamp === null ? row.timestamp : Math.min(firstTimestamp, row.timestamp);
          lastTimestamp = lastTimestamp === null ? row.timestamp : Math.max(lastTimestamp, row.timestamp);
          if (timestamps.size >= minRowsForComplete) {
            return { uniqueTimestampCount: timestamps.size, firstTimestamp, lastTimestamp };
          }
        }
      } catch {
        // Bad rows are ignored for this row-count gate; warehouse upsert is timestamp keyed.
      }
    }
  }
  return { uniqueTimestampCount: timestamps.size, firstTimestamp, lastTimestamp };
}

function formatDate(timestamp: number | null): string | null {
  return timestamp === null ? null : new Date(timestamp).toISOString().slice(0, 10);
}

const execute = hasFlag("--execute");
const universePath = argValue("--universe") ?? "data/nyse-universe/nyse-current-universe.json";
const warehouseDirectoryPath = argValue("--warehouse") ?? "data/candles";
const maxSymbols = numberArg("--max-symbols");
const startAfterSymbol = argValue("--start-after-symbol")?.trim().toUpperCase();
const throttleMs = numberArg("--throttle-ms") ?? 10_500;
const ibkrTimeoutMs = numberArg("--ibkr-timeout-ms") ?? 600_000;
const outDir =
  argValue("--out-dir") ??
  join("artifacts", "nyse-marketcap-universe", new Date().toISOString().slice(0, 10), "nyse-deep-daily-4h-backfill");
const statePath = join(outDir, "nyse-deep-daily-4h-backfill-state.json");
const heartbeatPath = join(outDir, "nyse-deep-daily-4h-backfill-heartbeat.json");
const exitPath = join(outDir, "nyse-deep-daily-4h-backfill-exit.json");
const startedAt = new Date().toISOString();
const runState: RunState = {
  pid: process.pid,
  startedAt,
  updatedAt: startedAt,
  phase: "planning",
  outDir,
  execute,
  startAfterSymbol,
  completedRequests: 0,
};

function writeJsonSync(path: string, value: unknown): void {
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error(`[NyseDeepDaily4hBackfill] failed to write ${path}:`, error);
  }
}

function updateRunState(partial: Partial<RunState>): void {
  Object.assign(runState, partial, { updatedAt: new Date().toISOString() });
  writeJsonSync(statePath, runState);
}

function writeHeartbeat(): void {
  writeJsonSync(heartbeatPath, {
    pid: process.pid,
    timestamp: new Date().toISOString(),
    phase: runState.phase,
    completedRequests: runState.completedRequests,
    selectedRequests: runState.selectedRequests,
    currentSymbol: runState.currentSymbol,
    currentTimeframe: runState.currentTimeframe,
  });
}

function writeExit(reason: string, details: Omit<NonNullable<RunState["exit"]>, "reason"> = {}): void {
  const exit = { reason, ...details };
  updateRunState({ phase: reason === "completed" ? "completed" : reason === "fatal" ? "fatal" : "exiting", exit });
  writeJsonSync(exitPath, {
    ...exit,
    pid: process.pid,
    timestamp: new Date().toISOString(),
    completedRequests: runState.completedRequests,
    selectedRequests: runState.selectedRequests,
    currentSymbol: runState.currentSymbol,
    currentTimeframe: runState.currentTimeframe,
  });
}

let heartbeatTimer: NodeJS.Timeout | undefined;

process.on("uncaughtException", (error) => {
  writeExit("fatal", { message: error.stack ?? error.message });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  writeExit("fatal", { message });
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    writeExit("signal", { signal });
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

const snapshot = await readNasdaqUniverseSnapshot(universePath);
const baseTasks = buildOrderedUniverse(snapshot.rows);
const startAfterIndex =
  startAfterSymbol === undefined ? -1 : baseTasks.findIndex((task) => task.symbol === startAfterSymbol);
if (startAfterSymbol !== undefined && startAfterIndex < 0) {
  throw new Error(`Could not find --start-after-symbol ${startAfterSymbol} in ${universePath}`);
}
const scannedBaseTasks = startAfterIndex < 0 ? baseTasks : baseTasks.slice(startAfterIndex + 1);
const tasks: DeepTask[] = scannedBaseTasks.map((task, index) => {
  if (execute && index > 0 && index % 100 === 0) {
    console.log(`[NyseDeepDaily4hBackfill] scanned coverage for ${index}/${scannedBaseTasks.length} symbols`);
  }
  const coverage = {
    daily: readCoverage(warehouseDirectoryPath, task.symbol, "daily"),
    "4h": readCoverage(warehouseDirectoryPath, task.symbol, "4h"),
  };
  return {
    ...task,
    coverage,
    fetchTimeframes: (["daily", "4h"] as DeepTimeframe[]).filter((timeframe) => coverage[timeframe].status !== "covered"),
  };
});
const fetchableTasks = tasks.filter((task) => task.fetchTimeframes.length > 0);
const selectedTasks =
  typeof maxSymbols === "number" && Number.isFinite(maxSymbols)
    ? fetchableTasks.slice(0, maxSymbols)
    : fetchableTasks;

const plan = {
  generatedAt: new Date().toISOString(),
  sourceUniversePath: universePath,
  warehouseDirectoryPath,
  startAfterSymbol,
  provider: "ibkr",
  mode: execute ? "execute" : "dry_run",
  lookbacks: LOOKBACKS,
  minRowsForComplete: MIN_ROWS_FOR_COMPLETE,
  throttleMs,
  ibkrTimeoutMs,
  totals: {
    universeSymbols: baseTasks.length,
    skippedByStartAfter: baseTasks.length - scannedBaseTasks.length,
    symbols: tasks.length,
    under500Symbols: tasks.filter((task) => task.segment === "under500").length,
    over500Symbols: tasks.filter((task) => task.segment === "over500").length,
    covered: tasks.filter((task) => task.fetchTimeframes.length === 0).length,
    selectedForFetch: selectedTasks.length,
    selectedUnder500: selectedTasks.filter((task) => task.segment === "under500").length,
    selectedOver500: selectedTasks.filter((task) => task.segment === "over500").length,
    selectedRequests: selectedTasks.reduce((total, task) => total + task.fetchTimeframes.length, 0),
  },
  selectedTasks,
};

await mkdir(outDir, { recursive: true });
updateRunState({ phase: "planned", selectedSymbols: selectedTasks.length, selectedRequests: plan.totals.selectedRequests });
heartbeatTimer = setInterval(writeHeartbeat, 30_000);
writeHeartbeat();
await writeFile(join(outDir, "nyse-deep-daily-4h-backfill-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
await writeFile(
  join(outDir, "nyse-deep-daily-4h-backfill-plan.md"),
  [
    "# NYSE Deep Daily/4h Backfill Plan",
    "",
    `Generated at: ${plan.generatedAt}`,
    `Mode: ${plan.mode}`,
    `Universe: ${universePath}`,
    `Warehouse: ${warehouseDirectoryPath}`,
    `Lookbacks: daily ${LOOKBACKS.daily}; 4h ${LOOKBACKS["4h"]}`,
    `Minimum complete rows: daily ${MIN_ROWS_FOR_COMPLETE.daily}; 4h ${MIN_ROWS_FOR_COMPLETE["4h"]}`,
    "",
    "## Totals",
    "",
    `- symbols: ${plan.totals.symbols}`,
    `- under $500M symbols: ${plan.totals.under500Symbols}`,
    `- $500M+ symbols: ${plan.totals.over500Symbols}`,
    `- already covered: ${plan.totals.covered}`,
    `- selected symbols: ${plan.totals.selectedForFetch}`,
    `- selected under $500M: ${plan.totals.selectedUnder500}`,
    `- selected $500M+: ${plan.totals.selectedOver500}`,
    `- selected requests: ${plan.totals.selectedRequests}`,
    "",
    "## Selected Tasks",
    "",
    "| Segment | Symbol | Bucket | Market Cap | Fetch | Daily Rows | 4h Rows | Earliest Daily | Earliest 4h |",
    "| --- | --- | --- | ---: | --- | ---: | ---: | --- | --- |",
    ...selectedTasks.map((task) =>
      [
        task.segment,
        task.symbol,
        task.marketCapBucket,
        task.marketCap,
        task.fetchTimeframes.join(", "),
        task.coverage.daily.uniqueTimestampCount,
        task.coverage["4h"].uniqueTimestampCount,
        formatDate(task.coverage.daily.firstTimestamp) ?? "",
        formatDate(task.coverage["4h"].firstTimestamp) ?? "",
      ].join(" | "),
    ),
    "",
  ].join("\n"),
  "utf8",
);

console.log(
  `[NyseDeepDaily4hBackfill] mode=${plan.mode} symbols=${plan.totals.symbols} selected=${plan.totals.selectedForFetch} requests=${plan.totals.selectedRequests} under500=${plan.totals.selectedUnder500} over500=${plan.totals.selectedOver500}`,
);
console.log(`[NyseDeepDaily4hBackfill] wrote ${join(outDir, "nyse-deep-daily-4h-backfill-plan.md")}`);

if (!execute || selectedTasks.length === 0) {
  if (!execute) {
    console.log("[NyseDeepDaily4hBackfill] dry-run only; no IBKR connection attempted.");
  }
  writeExit(selectedTasks.length === 0 ? "completed" : "dry_run", { code: 0 });
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  process.exit(0);
}

const ib = createBackfillClient();
const service = new CandleFetchService({ providerName: "ibkr", ib, ibkrTimeoutMs });
const warehouse = new DurableCandleWarehouse(warehouseDirectoryPath);
const resultsPath = join(outDir, "nyse-deep-daily-4h-backfill-results.jsonl");

try {
  updateRunState({ phase: "connecting" });
  console.log(`[NyseDeepDaily4hBackfill] Connecting to IBKR timeout=${ibkrTimeoutMs}ms`);
  await waitForIbkrConnection(ib, ibkrTimeoutMs);

  for (const task of selectedTasks) {
    for (const timeframe of task.fetchTimeframes) {
      updateRunState({ phase: "fetching", currentSymbol: task.symbol, currentTimeframe: timeframe });
      let result: ExecuteResult;
      try {
        const response = await service.fetchCandles({
          symbol: task.symbol,
          timeframe,
          lookbackBars: LOOKBACKS[timeframe],
        });
        const coverage = await warehouse.upsertCandles({
          provider: "ibkr",
          symbol: task.symbol,
          timeframe,
          candles: response.candles,
          sourceFetchedAt: response.fetchEndTimestamp,
        });
        result = {
          segment: task.segment,
          symbol: task.symbol,
          timeframe,
          status: "fetched",
          candleCount: coverage.candleCount,
        };
        console.log(
          `[NyseDeepDaily4hBackfill] ${task.segment} ${task.symbol} ${timeframe}: fetched ${response.candles.length}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = {
          segment: task.segment,
          symbol: task.symbol,
          timeframe,
          status: isContractUnresolved(message) ? "contract_unresolved" : "failed",
          candleCount: 0,
          error: message,
        };
        console.log(`[NyseDeepDaily4hBackfill] ${task.segment} ${task.symbol} ${timeframe}: FAILED ${message}`);
      }
      const timestampedResult = { ...result, timestamp: Date.now() };
      await appendFile(resultsPath, `${JSON.stringify(timestampedResult)}\n`);
      updateRunState({
        completedRequests: runState.completedRequests + 1,
        lastResult: timestampedResult,
      });
      writeHeartbeat();
      await sleep(throttleMs);
    }
  }
  writeExit("completed", { code: 0 });
} finally {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  ib.disconnect();
}
