import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  CandleFetchService,
  DurableCandleWarehouse,
  executeCandleWarehouseBackfill,
  type BulkCandleBackfillTradeInput,
  type CandleFetchTimeframe,
  type CandleProviderName,
  type CandleWarehouseBackfillMode,
  type CandleWarehouseBackfillResult,
} from "../support-resistance/index.js";

type AuditRow = {
  operation?: string;
  status?: string;
  timestamp?: number;
  sourceTimestamp?: number;
  symbol?: string;
};

export type WriteCandleWarehouseBackfillReportOptions = {
  auditPath: string;
  warehouseDirectoryPath?: string;
  provider?: CandleProviderName;
  timeframes?: CandleFetchTimeframe[];
  mode?: CandleWarehouseBackfillMode;
  maxTrades?: number;
  maxTasks?: number;
  concurrency?: number;
  throttleMs?: number;
  jsonPath: string;
  markdownPath: string;
};

const newYorkDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function resolveAuditPaths(pathOrDirectory: string): string[] {
  const path = resolve(pathOrDirectory);
  if (path.endsWith(".jsonl")) {
    return [path];
  }
  const direct = join(path, "discord-delivery-audit.jsonl");
  if (existsSync(direct)) {
    return [direct];
  }
  if (!existsSync(path)) {
    return [direct];
  }
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name, "discord-delivery-audit.jsonl"))
    .filter((candidate) => existsSync(candidate))
    .sort();
}

function readRows(path: string): AuditRow[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AuditRow];
      } catch {
        return [];
      }
    });
}

function rowTimestamp(row: AuditRow): number | null {
  const timestamp = row.sourceTimestamp ?? row.timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : null;
}

function symbolOf(row: AuditRow): string | null {
  const symbol = row.symbol?.trim().toUpperCase();
  return symbol ? symbol : null;
}

function isUsableRow(row: AuditRow): boolean {
  return (
    (row.status === "posted" || row.status === "success") &&
    ["post_alert", "post_level_snapshot", "post_level_extension"].includes(String(row.operation)) &&
    symbolOf(row) !== null &&
    rowTimestamp(row) !== null
  );
}

function sessionDate(timestamp: number): string {
  return newYorkDateFormatter.format(new Date(timestamp));
}

function buildTradeInputs(rows: AuditRow[], maxTrades?: number): BulkCandleBackfillTradeInput[] {
  const byKey = new Map<string, BulkCandleBackfillTradeInput>();
  for (const row of rows.filter(isUsableRow)) {
    const timestamp = rowTimestamp(row)!;
    const symbol = symbolOf(row)!;
    const date = sessionDate(timestamp);
    const key = `${symbol}:${date}`;
    const existing = byKey.get(key);
    if (!existing || Date.parse(String(existing.asOfTimestamp)) < timestamp) {
      byKey.set(key, { symbol, sessionDate: date, asOfTimestamp: timestamp });
    }
  }
  const trades = [...byKey.values()].sort((left, right) =>
    left.symbol.localeCompare(right.symbol) || left.sessionDate.localeCompare(right.sessionDate),
  );
  return typeof maxTrades === "number" && Number.isFinite(maxTrades) ? trades.slice(0, maxTrades) : trades;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function formatCandleWarehouseBackfillReport(result: CandleWarehouseBackfillResult): string {
  const lines = [
    "# Candle Warehouse Backfill Report",
    "",
    `Generated: ${result.generatedAt}`,
    `Mode: ${result.mode}`,
    `Provider: ${result.provider}`,
    "",
    "## Totals",
    "",
    `- planned tasks: ${result.totals.plannedTasks}`,
    `- attempted tasks: ${result.totals.attemptedTasks}`,
    `- fetched tasks: ${result.totals.fetchedTasks}`,
    `- skipped tasks: ${result.totals.skippedTasks}`,
    `- failed tasks: ${result.totals.failedTasks}`,
    `- fetched candles: ${result.totals.fetchedCandles}`,
    `- stored candles: ${result.totals.storedCandles}`,
    `- already covered tasks: ${result.plan.fullyCoveredTaskCount}`,
    `- missing candle estimate: ${result.plan.missingCandleCountEstimate}`,
    "",
    "## Provider Readiness",
    "",
    "- `already_covered`: warehouse already has the requested symbol/date/timeframe range.",
    "- `safe_to_fetch`: dry-run found missing ranges that can be fetched without duplicate provider work.",
    "- `refreshed`: execute mode fetched and stored candles for the range.",
    "- `provider_risk`: provider fetch/storage failed and needs review before bulk imports depend on it.",
    "",
    "## Task Evidence",
    "",
    "| Symbol | Timeframe | Status | Readiness | Lookback | Missing Ranges | Fetched | Stored | Error |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const task of result.taskResults.slice(0, 100)) {
    lines.push(
      `| ${task.symbol} | ${task.timeframe} | ${task.status} | ${task.readiness} | ${task.requestedLookbackBars} | ${task.missingRangeCount} | ${task.fetchedCandles} | ${task.storedCandles} | ${task.error ?? ""} |`,
    );
  }
  if (result.taskResults.length > 100) {
    lines.push(`| ... | ... | ... | ... | ... | ... | ... | ... | ${result.taskResults.length - 100} additional tasks omitted |`);
  }

  lines.push("", "## Missing Range Summary", "");
  for (const task of result.plan.tasks.slice(0, 20)) {
    lines.push(
      `- ${task.symbol} ${task.timeframe}: ${task.missingRanges.map((range) => `${iso(range.startTimestamp)} to ${iso(range.endTimestamp)}`).join(", ")}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function writeCandleWarehouseBackfillReport(
  options: WriteCandleWarehouseBackfillReportOptions,
): Promise<CandleWarehouseBackfillResult> {
  const sourceAuditPaths = resolveAuditPaths(options.auditPath);
  const rows = sourceAuditPaths.flatMap((path) => readRows(path));
  const warehouse = new DurableCandleWarehouse(options.warehouseDirectoryPath ?? "data/candles");
  const result = await executeCandleWarehouseBackfill({
    warehouse,
    fetchClient: new CandleFetchService({ providerName: options.provider }),
    provider: options.provider ?? "ibkr",
    trades: buildTradeInputs(rows, options.maxTrades),
    timeframes: options.timeframes,
    mode: options.mode ?? "dry_run",
    maxTasks: options.maxTasks,
    concurrency: options.concurrency,
    throttleMs: options.throttleMs,
  });
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatCandleWarehouseBackfillReport(result), "utf8");
  return result;
}
