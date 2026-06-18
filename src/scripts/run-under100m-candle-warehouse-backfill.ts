import "dotenv/config";

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { DurableCandleWarehouse } from "../lib/candle-warehouse/index.js";
import {
  CandleFetchService,
} from "../lib/market-data/candle-fetch-service.js";
import type { CandleFetchTimeframe } from "../lib/market-data/candle-types.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import {
  createIbkrClient,
  DEFAULT_IBKR_HOST,
  DEFAULT_IBKR_PORT,
} from "./shared/ibkr-runtime.js";

type FetchStatus = "fetched" | "skipped_existing" | "failed";

type SymbolResult = {
  symbol: string;
  status: FetchStatus;
  fetchedTimeframes: CandleFetchTimeframe[];
  failedTimeframes: Array<{ timeframe: CandleFetchTimeframe; error: string }>;
};

const DEFAULT_FILE = "docs/nasdaq-under-100m-checklist-with-previous-tickers.md";
const DEFAULT_WAREHOUSE = "data/candles";
const DEFAULT_OUT_DIR = "artifacts/under100m-candle-backfill";
const DEFAULT_TIMEFRAMES: CandleFetchTimeframe[] = ["daily", "4h", "5m"];
const LOOKBACKS: Record<CandleFetchTimeframe, number> = {
  daily: 220,
  "4h": 180,
  "5m": 240,
  "1m": 390,
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function numberArg(flag: string, fallback: number): number {
  const raw = argValue(flag);
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envPositiveInteger(name: string): number | undefined {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function parseTimeframes(raw: string | undefined): CandleFetchTimeframe[] {
  if (!raw) {
    return DEFAULT_TIMEFRAMES;
  }
  const allowed = new Set<CandleFetchTimeframe>(["daily", "4h", "5m", "1m"]);
  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is CandleFetchTimeframe => allowed.has(item as CandleFetchTimeframe));
  return parsed.length > 0 ? parsed : DEFAULT_TIMEFRAMES;
}

function parseSymbolsArg(raw: string | undefined): string[] | null {
  if (!raw) {
    return null;
  }
  const symbols = uniqueSorted(raw.split(","));
  return symbols.length > 0 ? symbols : null;
}

function uniqueSorted(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].sort();
}

function parseDedupedUniverse(markdown: string): string[] {
  const heading = "# All bucketed NASDAQ under $100M tickers, deduped";
  const lines = markdown.split(/\r?\n/);
  const start = lines.indexOf(heading);
  if (start < 0) {
    throw new Error(`Could not find ${heading}`);
  }

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line === "---") {
      break;
    }
    if (/^[A-Z0-9, ]+$/.test(line) && line.includes(",")) {
      return uniqueSorted(line.split(","));
    }
  }

  throw new Error("Could not parse deduped ticker universe.");
}

function warehouseSymbolDate(symbol: string, providerRoot: string): Date | null {
  const path = join(providerRoot, symbol);
  if (!existsSync(path)) {
    return null;
  }
  return new Date(statSync(path).mtimeMs);
}

function formatMonthDay(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Toronto",
  });
}

async function updateCoverageSection(params: {
  filePath: string;
  warehouseDirectoryPath: string;
  symbols: string[];
  failedSymbols?: string[];
}): Promise<{ covered: string[]; missing: string[] }> {
  const markdown = await readFile(params.filePath, "utf8");
  const providerRoot = join(params.warehouseDirectoryPath, "ibkr");
  const covered = params.symbols.filter((symbol) => warehouseSymbolDate(symbol, providerRoot));
  const missing = params.symbols.filter((symbol) => !warehouseSymbolDate(symbol, providerRoot));
  const failedSymbols = params.failedSymbols ?? [];

  const coverageLines = [
    "## Warehouse Candle Data Coverage",
    "",
    "Updated: 2026-05-04 America/Toronto",
    "",
    "Coverage source: data/candles/ibkr symbol folders. Dates beside covered tickers are warehouse folder last-write month/day.",
    "",
    `All bucketed NASDAQ under $100M tickers: ${params.symbols.length}`,
    `Have warehouse candle data: ${covered.length}`,
    `Need warehouse candle data: ${missing.length}`,
    "",
    "### Have Warehouse Candle Data",
    "",
    ...covered.map((symbol) => {
      const date = warehouseSymbolDate(symbol, providerRoot);
      return `- [x] ${symbol} - ${date ? formatMonthDay(date) : "unknown"}`;
    }),
    "",
    "### Need Warehouse Candle Data",
    "",
    ...(missing.length > 0 ? missing.map((symbol) => `- [ ] ${symbol}`) : ["None."]),
    "",
    "### Provider Failures To Retry Later",
    "",
    ...(failedSymbols.length > 0 ? failedSymbols.map((symbol) => `- [ ] ${symbol}`) : ["None."]),
    "",
    "---",
  ];

  const coverageStart = markdown.indexOf("## Warehouse Candle Data Coverage");
  const previousHeading = markdown.indexOf("## Previously given tickers from chat");
  const replacement = coverageLines.join("\n");
  const nextMarkdown =
    coverageStart >= 0 && previousHeading > coverageStart
      ? `${markdown.slice(0, coverageStart)}${replacement}\n\n${markdown.slice(previousHeading)}`
      : markdown.replace("---\n\n## Previously given tickers from chat", `---\n\n${replacement}\n\n## Previously given tickers from chat`);

  await writeFile(params.filePath, nextMarkdown);
  return { covered, missing };
}

async function readKnownAllTimeframeFailures(logPath: string): Promise<string[]> {
  if (!existsSync(logPath)) {
    return [];
  }
  const text = await readFile(logPath, "utf8");
  const failed = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as SymbolResult;
      if (parsed.status === "failed") {
        failed.add(parsed.symbol);
      }
    } catch {
      // Ignore malformed operator log rows.
    }
  }
  return [...failed].sort();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

async function fetchSymbol(params: {
  symbol: string;
  timeframes: CandleFetchTimeframe[];
  service: CandleFetchService;
  warehouse: DurableCandleWarehouse;
  throttleMs: number;
}): Promise<SymbolResult> {
  const result: SymbolResult = {
    symbol: params.symbol,
    status: "fetched",
    fetchedTimeframes: [],
    failedTimeframes: [],
  };

  for (const timeframe of params.timeframes) {
    try {
      const response = await params.service.fetchCandles({
        symbol: params.symbol,
        timeframe,
        lookbackBars: LOOKBACKS[timeframe],
      });
      if (response.candles.length <= 0) {
        throw new Error("provider returned zero candles");
      }
      await params.warehouse.upsertCandles({
        provider: "ibkr",
        symbol: params.symbol,
        timeframe,
        candles: response.candles,
        sourceFetchedAt: response.fetchEndTimestamp,
      });
      result.fetchedTimeframes.push(timeframe);
      console.log(`[Under100MBackfill] ${params.symbol} ${timeframe}: ${response.candles.length} candles`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failedTimeframes.push({ timeframe, error: message });
      console.log(`[Under100MBackfill] ${params.symbol} ${timeframe}: FAILED ${message}`);
    }
    await sleep(params.throttleMs);
  }

  if (result.fetchedTimeframes.length === 0) {
    result.status = "failed";
  }

  return result;
}

const filePath = argValue("--file") ?? DEFAULT_FILE;
const warehouseDirectoryPath = argValue("--warehouse") ?? DEFAULT_WAREHOUSE;
const outDir = argValue("--out-dir") ?? DEFAULT_OUT_DIR;
const maxSymbols = numberArg("--max-symbols", Number.POSITIVE_INFINITY);
const throttleMs = numberArg("--throttle-ms", 1_500);
const ibkrTimeoutMs = numberArg("--ibkr-timeout-ms", 30_000);
const timeframes = parseTimeframes(argValue("--timeframes"));
const explicitSymbols = parseSymbolsArg(argValue("--symbols"));
const forceFetch = hasFlag("--force");

await mkdir(outDir, { recursive: true });
const logPath = join(outDir, "under100m-candle-backfill.jsonl");
const knownFailedSymbols = hasFlag("--retry-failed") ? [] : await readKnownAllTimeframeFailures(logPath);

const markdown = await readFile(filePath, "utf8");
const checklistUniverse = parseDedupedUniverse(markdown);
const universe = uniqueSorted([...checklistUniverse, ...(explicitSymbols ?? [])]);
const initialCoverage = await updateCoverageSection({
  filePath,
  warehouseDirectoryPath,
  symbols: universe,
  failedSymbols: knownFailedSymbols,
});
const targetUniverse = explicitSymbols ?? initialCoverage.missing;
const targets = targetUniverse
  .filter((symbol) => forceFetch || initialCoverage.missing.includes(symbol))
  .filter((symbol) => !knownFailedSymbols.includes(symbol))
  .slice(0, maxSymbols);

console.log(
  `[Under100MBackfill] universe=${universe.length} covered=${initialCoverage.covered.length} missing=${initialCoverage.missing.length} targets=${targets.length} timeframes=${timeframes.join(",")}`,
);

if (targets.length === 0 || hasFlag("--dry-run")) {
  process.exit(0);
}

const ib = createBackfillClient();
const service = new CandleFetchService({ providerName: "ibkr", ib, ibkrTimeoutMs });
const warehouse = new DurableCandleWarehouse(warehouseDirectoryPath);

try {
  console.log(`[Under100MBackfill] Connecting to IBKR timeout=${ibkrTimeoutMs}ms`);
  await waitForIbkrConnection(ib, ibkrTimeoutMs);

  for (const symbol of targets) {
    const result = await fetchSymbol({
      symbol,
      timeframes,
      service,
      warehouse,
      throttleMs,
    });
    await appendFile(logPath, `${JSON.stringify({ ...result, timestamp: Date.now() })}\n`);
    await updateCoverageSection({
      filePath,
      warehouseDirectoryPath,
      symbols: universe,
      failedSymbols: knownFailedSymbols,
    });
  }
} finally {
  ib.disconnect();
}

const finalCoverage = await updateCoverageSection({
  filePath,
  warehouseDirectoryPath,
  symbols: universe,
  failedSymbols: await readKnownAllTimeframeFailures(logPath),
});

console.log(
  `[Under100MBackfill] done covered=${finalCoverage.covered.length} missing=${finalCoverage.missing.length} log=${logPath}`,
);
