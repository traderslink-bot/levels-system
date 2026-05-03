import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  DurableCandleWarehouse,
  planWarehouseMissingCandleBackfill,
  type BulkCandleBackfillTradeInput,
  type CandleFetchTimeframe,
  type CandleProviderName,
  type WarehouseMissingCandleBackfillPlan,
} from "../support-resistance/index.js";

type AuditRow = {
  operation?: string;
  status?: string;
  timestamp?: number;
  sourceTimestamp?: number;
  symbol?: string;
};

export type CandleImportReadinessReport = {
  generatedAt: string;
  sourceAuditPath: string;
  sourceAuditPaths: string[];
  warehouseDirectoryPath: string;
  provider: CandleProviderName;
  timeframes: CandleFetchTimeframe[];
  tradeCount: number;
  symbolCount: number;
  sessionCount: number;
  plan: WarehouseMissingCandleBackfillPlan;
  samples: Array<{
    symbol: string;
    sessionDate: string;
    asOfTimestamp: number;
  }>;
};

export type BuildCandleImportReadinessReportOptions = {
  auditPath: string;
  warehouseDirectoryPath?: string;
  provider?: CandleProviderName;
  timeframes?: CandleFetchTimeframe[];
  maxTrades?: number;
};

export type WriteCandleImportReadinessReportOptions = BuildCandleImportReadinessReportOptions & {
  jsonPath: string;
  markdownPath: string;
};

const DEFAULT_WAREHOUSE_DIRECTORY = "data/candles";

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

function sessionDate(timestamp: number): string {
  return newYorkDateFormatter.format(new Date(timestamp));
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

function buildTradeInputs(rows: AuditRow[], maxTrades?: number): BulkCandleBackfillTradeInput[] {
  const byKey = new Map<string, BulkCandleBackfillTradeInput>();
  for (const row of rows.filter(isUsableRow)) {
    const timestamp = rowTimestamp(row)!;
    const symbol = symbolOf(row)!;
    const date = sessionDate(timestamp);
    const key = `${symbol}:${date}`;
    const existing = byKey.get(key);
    if (!existing || Date.parse(String(existing.asOfTimestamp)) < timestamp) {
      byKey.set(key, {
        symbol,
        sessionDate: date,
        asOfTimestamp: timestamp,
      });
    }
  }
  const trades = [...byKey.values()].sort((left, right) =>
    left.symbol.localeCompare(right.symbol) ||
    left.sessionDate.localeCompare(right.sessionDate),
  );
  return typeof maxTrades === "number" && Number.isFinite(maxTrades) ? trades.slice(0, maxTrades) : trades;
}

export async function buildCandleImportReadinessReport(
  options: BuildCandleImportReadinessReportOptions,
): Promise<CandleImportReadinessReport> {
  const sourceAuditPaths = resolveAuditPaths(options.auditPath);
  const rows = sourceAuditPaths.flatMap((path) => readRows(path));
  const trades = buildTradeInputs(rows, options.maxTrades);
  const provider = options.provider ?? "ibkr";
  const timeframes = options.timeframes ?? ["daily", "4h", "5m", "1m"];
  const warehouseDirectoryPath = options.warehouseDirectoryPath ?? DEFAULT_WAREHOUSE_DIRECTORY;
  const warehouse = new DurableCandleWarehouse(warehouseDirectoryPath);
  const plan = await planWarehouseMissingCandleBackfill({
    provider,
    trades,
    timeframes,
    warehouse,
  });

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: sourceAuditPaths.length === 1
      ? sourceAuditPaths[0]!
      : `${sourceAuditPaths.length} audit files from ${resolve(options.auditPath)}`,
    sourceAuditPaths,
    warehouseDirectoryPath,
    provider,
    timeframes,
    tradeCount: trades.length,
    symbolCount: plan.symbolCount,
    sessionCount: plan.sessionCount,
    plan,
    samples: trades.slice(0, 20).map((trade) => ({
      symbol: trade.symbol,
      sessionDate: trade.sessionDate,
      asOfTimestamp: typeof trade.asOfTimestamp === "number" ? trade.asOfTimestamp : Date.parse(String(trade.asOfTimestamp)),
    })),
  };
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function formatCandleImportReadinessReport(report: CandleImportReadinessReport): string {
  const lines = [
    "# Candle Import Readiness Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Source audit: ${report.sourceAuditPath}`,
    `Source audit files: ${report.sourceAuditPaths.length}`,
    `Warehouse: ${report.warehouseDirectoryPath}`,
    `Provider: ${report.provider}`,
    `Timeframes: ${report.timeframes.join(", ")}`,
    "",
    "## Totals",
    "",
    `- trade proxies: ${report.tradeCount}`,
    `- symbols: ${report.symbolCount}`,
    `- sessions: ${report.sessionCount}`,
    `- planned tasks: ${report.plan.plannedTaskCount}`,
    `- fully covered tasks: ${report.plan.fullyCoveredTaskCount}`,
    `- missing tasks: ${report.plan.missingTaskCount}`,
    `- estimated missing candles: ${report.plan.missingCandleCountEstimate}`,
    "",
    "## Missing Range Evidence",
    "",
    "| Symbol | Session | Timeframe | Stored | Missing Ranges | Missing Candles Est. |",
    "| --- | --- | --- | ---: | --- | ---: |",
  ];

  for (const task of report.plan.tasks.slice(0, 100)) {
    lines.push(
      `| ${task.symbol} | ${task.sessionDate} | ${task.timeframe} | ${task.coverage.candleCount} | ${task.missingRanges.map((range) => `${iso(range.startTimestamp)} to ${iso(range.endTimestamp)}`).join("<br>")} | ${task.missingCandleCountEstimate} |`,
    );
  }
  if (report.plan.tasks.length > 100) {
    lines.push(`| ... | ... | ... | ... | ${report.plan.tasks.length - 100} additional missing tasks omitted from markdown table | ... |`);
  }

  lines.push("", "## Sample Trade Proxies", "");
  for (const sample of report.samples) {
    lines.push(`- ${sample.symbol} ${sample.sessionDate} as of ${iso(sample.asOfTimestamp)}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function writeCandleImportReadinessReport(
  options: WriteCandleImportReadinessReportOptions,
): Promise<CandleImportReadinessReport> {
  const report = await buildCandleImportReadinessReport(options);
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatCandleImportReadinessReport(report), "utf8");
  return report;
}
