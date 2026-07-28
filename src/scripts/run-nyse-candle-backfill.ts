import "dotenv/config";

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DurableCandleWarehouse } from "../lib/candle-warehouse/index.js";
import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import type { CandleFetchTimeframe } from "../lib/market-data/candle-types.js";
import {
  buildNyseCandleBackfillPlan,
  formatNyseCandleBackfillPlan,
  NYSE_DEFAULT_TIMEFRAMES,
  NYSE_LOOKBACKS,
} from "../lib/review/nyse-candle-backfill.js";
import { readNyseUniverseSnapshot } from "../lib/review/nyse-marketcap-universe.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import {
  createIbkrClient,
  DEFAULT_IBKR_HOST,
  DEFAULT_IBKR_PORT,
} from "./shared/ibkr-runtime.js";

type ExecuteResult = {
  symbol: string;
  timeframe: CandleFetchTimeframe;
  status: "fetched" | "failed" | "contract_unresolved";
  candleCount: number;
  error?: string;
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

function parseTimeframes(raw: string | undefined): CandleFetchTimeframe[] {
  if (!raw) {
    return NYSE_DEFAULT_TIMEFRAMES;
  }
  const allowed = new Set<CandleFetchTimeframe>(["daily", "4h", "5m", "1m"]);
  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is CandleFetchTimeframe => allowed.has(item as CandleFetchTimeframe));
  return parsed.length > 0 ? parsed : NYSE_DEFAULT_TIMEFRAMES;
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

const execute = hasFlag("--execute");
const universePath = argValue("--universe") ?? "data/nyse-universe/nyse-current-universe.json";
const warehouseDirectoryPath = argValue("--warehouse") ?? "data/candles";
const timeframes = parseTimeframes(argValue("--timeframes"));
const maxSymbols = numberArg("--max-symbols");
const throttleMs = numberArg("--throttle-ms") ?? 1_500;
const ibkrTimeoutMs = numberArg("--ibkr-timeout-ms") ?? 30_000;
const outDir = argValue("--out-dir") ?? join("artifacts", "nyse-marketcap-universe", new Date().toISOString().slice(0, 10), "nyse-candle-backfill");

const snapshot = await readNyseUniverseSnapshot(universePath);
const plan = buildNyseCandleBackfillPlan({
  snapshot,
  sourceUniversePath: universePath,
  warehouseDirectoryPath,
  timeframes,
  maxSymbols,
  dryRun: !execute,
});

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "nyse-candle-backfill-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
await writeFile(join(outDir, "nyse-candle-backfill-plan.md"), formatNyseCandleBackfillPlan(plan), "utf8");

console.log(
  `[NyseCandleBackfill] mode=${execute ? "execute" : "dry_run"} symbols=${plan.totals.symbols} selected=${plan.totals.selectedForFetch} covered=${plan.totals.covered} partial=${plan.totals.partial} missing=${plan.totals.missing}`,
);
console.log(`[NyseCandleBackfill] wrote ${join(outDir, "nyse-candle-backfill-plan.md")}`);

if (!execute || plan.selectedTasks.length === 0) {
  if (!execute) {
    console.log("[NyseCandleBackfill] dry-run only; no IBKR connection attempted.");
  }
  process.exit(0);
}

const ib = createBackfillClient();
const service = new CandleFetchService({ providerName: "ibkr", ib, ibkrTimeoutMs });
const warehouse = new DurableCandleWarehouse(warehouseDirectoryPath);
const resultsPath = join(outDir, "nyse-candle-backfill-results.jsonl");

try {
  console.log(`[NyseCandleBackfill] Connecting to IBKR timeout=${ibkrTimeoutMs}ms`);
  await waitForIbkrConnection(ib, ibkrTimeoutMs);

  for (const task of plan.selectedTasks) {
    for (const timeframe of task.fetchTimeframes) {
      let result: ExecuteResult;
      try {
        const response = await service.fetchCandles({
          symbol: task.symbol,
          timeframe,
          lookbackBars: NYSE_LOOKBACKS[timeframe],
        });
        const coverage = await warehouse.upsertCandles({
          provider: "ibkr",
          symbol: task.symbol,
          timeframe,
          candles: response.candles,
          sourceFetchedAt: response.fetchEndTimestamp,
        });
        result = {
          symbol: task.symbol,
          timeframe,
          status: "fetched",
          candleCount: coverage.candleCount,
        };
        console.log(`[NyseCandleBackfill] ${task.symbol} ${timeframe}: fetched ${response.candles.length}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = {
          symbol: task.symbol,
          timeframe,
          status: isContractUnresolved(message) ? "contract_unresolved" : "failed",
          candleCount: 0,
          error: message,
        };
        console.log(`[NyseCandleBackfill] ${task.symbol} ${timeframe}: FAILED ${message}`);
      }
      await appendFile(resultsPath, `${JSON.stringify({ ...result, timestamp: Date.now() })}\n`);
      await sleep(throttleMs);
    }
  }
} finally {
  ib.disconnect();
}
