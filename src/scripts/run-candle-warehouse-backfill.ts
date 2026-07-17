import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  writeCandleWarehouseBackfillReport,
} from "../lib/review/candle-warehouse-backfill-report.js";
import type { CandleBackfillPriorityLevel } from "../lib/review/candle-backfill-priority-report.js";
import {
  CandleFetchService,
  type CandleFetchTimeframe,
  type CandleProviderName,
  type CandleWarehouseBackfillMode,
} from "../lib/support-resistance/index.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import {
  createIbkrClient,
  DEFAULT_IBKR_HOST,
  DEFAULT_IBKR_PORT,
} from "./shared/ibkr-runtime.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArgs(): string[] {
  const values: string[] = [];
  const flagsWithValues = new Set([
    "--out-dir",
    "--warehouse",
    "--max-trades",
    "--max-tasks",
    "--timeframes",
    "--concurrency",
    "--throttle-ms",
    "--mode",
    "--priority-report",
    "--priority-stage",
    "--priority",
    "--provider",
    "--ibkr-timeout-ms",
  ]);
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
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

function parseTimeframes(raw: string | undefined): CandleFetchTimeframe[] | undefined {
  if (!raw) {
    return undefined;
  }
  const allowed = new Set(["daily", "4h", "5m", "1m"]);
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is CandleFetchTimeframe => allowed.has(item));
}

function numberArg(flag: string): number | undefined {
  const raw = argValue(flag);
  const value = raw ? Number(raw) : undefined;
  return Number.isFinite(value) ? value : undefined;
}

function parsePriority(raw: string | undefined): CandleBackfillPriorityLevel | undefined {
  return raw === "fetch_first" || raw === "fetch_next" || raw === "fetch_later" ? raw : undefined;
}

function parseProvider(raw: string | undefined): CandleProviderName {
  return raw === "stub" || raw === "ibkr" || raw === "eodhd" ? raw : "ibkr";
}

function envPositiveInteger(name: string): number | undefined {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function envText(...names: string[]): string | undefined {
  return names.map((name) => process.env[name]?.trim()).find(Boolean);
}

function createBackfillIbkrClient() {
  return createIbkrClient(
    envPositiveInteger("LEVEL_BACKFILL_IBKR_CLIENT_ID") ??
      envPositiveInteger("LEVEL_VALIDATION_IBKR_CLIENT_ID") ??
      202,
    envText("LEVEL_BACKFILL_IBKR_HOST", "LEVEL_VALIDATION_IBKR_HOST") ?? DEFAULT_IBKR_HOST,
    envPositiveInteger("LEVEL_BACKFILL_IBKR_PORT") ??
      envPositiveInteger("LEVEL_VALIDATION_IBKR_PORT") ??
      DEFAULT_IBKR_PORT,
  );
}

const input = positionalArgs()[0] ?? latestLongRunSession();
const mode = (argValue("--mode") ?? (process.argv.includes("--execute") ? "execute" : "dry_run")) as CandleWarehouseBackfillMode;
const outDir = argValue("--out-dir") ?? (input.endsWith(".jsonl") ? "artifacts/candle-warehouse-backfill" : input);
const provider = parseProvider(argValue("--provider"));
const ibkrTimeoutMs = numberArg("--ibkr-timeout-ms") ?? numberArg("--timeout-ms") ?? 10_000;
const fetchClient = mode === "execute" && provider === "ibkr"
  ? (() => {
      const ib = createBackfillIbkrClient();
      return { ib, client: new CandleFetchService({ providerName: "ibkr", ib, ibkrTimeoutMs }) };
    })()
  : null;

if (fetchClient) {
  console.log(`Connecting to IBKR for candle backfill execute mode (timeout ${ibkrTimeoutMs}ms)...`);
  await waitForIbkrConnection(fetchClient.ib, ibkrTimeoutMs);
}

try {
  const result = await writeCandleWarehouseBackfillReport({
    auditPath: process.argv.includes("--all-sessions") ? "artifacts/long-run" : input,
    warehouseDirectoryPath: argValue("--warehouse") ?? "data/candles",
    provider,
    timeframes: parseTimeframes(argValue("--timeframes")),
    mode,
    maxTrades: numberArg("--max-trades"),
    maxTasks: numberArg("--max-tasks"),
    concurrency: numberArg("--concurrency"),
    throttleMs: numberArg("--throttle-ms"),
    priorityReportPath: argValue("--priority-report"),
    priorityStage: numberArg("--priority-stage"),
    priority: parsePriority(argValue("--priority")),
    fetchClient: fetchClient?.client,
    jsonPath: join(outDir, "candle-warehouse-backfill.json"),
    markdownPath: join(outDir, "candle-warehouse-backfill.md"),
  });

  console.log(`Candle warehouse backfill ${result.mode}: planned=${result.totals.plannedTasks} attempted=${result.totals.attemptedTasks} fetched=${result.totals.fetchedTasks} failed=${result.totals.failedTasks}`);
} finally {
  fetchClient?.ib.disconnect();
}
