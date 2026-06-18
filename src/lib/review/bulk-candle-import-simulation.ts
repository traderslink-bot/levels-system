import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  DurableCandleWarehouse,
  planBulkCandleBackfill,
  planWarehouseMissingCandleBackfill,
  type BulkCandleBackfillTradeInput,
  type CandleFetchTimeframe,
  type CandleProviderName,
  type WarehouseMissingCandleBackfillPlan,
} from "../support-resistance/index.js";

export type BulkCandleImportSimulationOptions = {
  warehouseDirectoryPath?: string;
  provider?: CandleProviderName;
  symbolCount?: number;
  sessionCount?: number;
  tradesPerSymbolSession?: number;
  timeframes?: CandleFetchTimeframe[];
  startSessionDate?: string;
};

export type WriteBulkCandleImportSimulationOptions = BulkCandleImportSimulationOptions & {
  jsonPath: string;
  markdownPath: string;
};

export type BulkCandleImportSimulationReport = {
  generatedAt: string;
  provider: CandleProviderName;
  warehouseDirectoryPath: string;
  input: {
    symbolCount: number;
    sessionCount: number;
    tradesPerSymbolSession: number;
    timeframes: CandleFetchTimeframe[];
    startSessionDate: string;
  };
  totals: {
    generatedTradeRows: number;
    naiveProviderTasks: number;
    dedupedProviderTasks: number;
    avoidedProviderTasks: number;
    avoidedProviderTaskPct: number;
    plannedWarehouseTasks: number;
    fullyCoveredWarehouseTasks: number;
    missingWarehouseTasks: number;
    missingCandleCountEstimate: number;
    providerBatchCount: number;
    maxTaskEstimatedCandles: number;
  };
  plan: WarehouseMissingCandleBackfillPlan;
  sampleTrades: BulkCandleBackfillTradeInput[];
};

const DEFAULT_SYMBOL_COUNT = 40;
const DEFAULT_SESSION_COUNT = 60;
const DEFAULT_TRADES_PER_SYMBOL_SESSION = 4;
const DEFAULT_TIMEFRAMES: CandleFetchTimeframe[] = ["daily", "4h", "5m", "1m"];
const DEFAULT_WAREHOUSE_DIRECTORY = "data/candles";

function formatSessionDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sessionDates(startSessionDate: string, count: number): string[] {
  const start = Date.parse(`${startSessionDate}T00:00:00.000Z`);
  if (!Number.isFinite(start)) {
    throw new Error(`Invalid startSessionDate: ${startSessionDate}`);
  }
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start + index * 24 * 60 * 60_000);
    return formatSessionDate(date);
  });
}

function generatedSymbols(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `SIM${String(index + 1).padStart(3, "0")}`);
}

function tradeTimestamp(sessionDate: string, tradeIndex: number, tradesPerSymbolSession: number): string {
  const start = Date.parse(`${sessionDate}T13:45:00.000Z`);
  const end = Date.parse(`${sessionDate}T19:45:00.000Z`);
  const step = tradesPerSymbolSession <= 1 ? 0 : Math.floor((end - start) / (tradesPerSymbolSession - 1));
  return new Date(start + tradeIndex * step).toISOString();
}

function buildSyntheticTrades(params: {
  symbolCount: number;
  sessionCount: number;
  tradesPerSymbolSession: number;
  startSessionDate: string;
}): BulkCandleBackfillTradeInput[] {
  const symbols = generatedSymbols(params.symbolCount);
  const dates = sessionDates(params.startSessionDate, params.sessionCount);
  const trades: BulkCandleBackfillTradeInput[] = [];
  for (const symbol of symbols) {
    for (const sessionDate of dates) {
      for (let tradeIndex = 0; tradeIndex < params.tradesPerSymbolSession; tradeIndex += 1) {
        trades.push({
          symbol,
          sessionDate,
          asOfTimestamp: tradeTimestamp(sessionDate, tradeIndex, params.tradesPerSymbolSession),
        });
      }
    }
  }
  return trades;
}

function pct(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(2));
}

export async function buildBulkCandleImportSimulationReport(
  options: BulkCandleImportSimulationOptions = {},
): Promise<BulkCandleImportSimulationReport> {
  const symbolCount = Math.max(1, options.symbolCount ?? DEFAULT_SYMBOL_COUNT);
  const sessionCount = Math.max(1, options.sessionCount ?? DEFAULT_SESSION_COUNT);
  const tradesPerSymbolSession = Math.max(1, options.tradesPerSymbolSession ?? DEFAULT_TRADES_PER_SYMBOL_SESSION);
  const timeframes = options.timeframes ?? DEFAULT_TIMEFRAMES;
  const startSessionDate = options.startSessionDate ?? "2026-01-02";
  const provider = options.provider ?? "ibkr";
  const warehouseDirectoryPath = options.warehouseDirectoryPath ?? DEFAULT_WAREHOUSE_DIRECTORY;
  const trades = buildSyntheticTrades({
    symbolCount,
    sessionCount,
    tradesPerSymbolSession,
    startSessionDate,
  });
  const naiveProviderTasks = trades.length * timeframes.length;
  const dedupedPlan = planBulkCandleBackfill({
    provider,
    trades,
    timeframes,
  });
  const warehouse = new DurableCandleWarehouse(warehouseDirectoryPath);
  const plan = await planWarehouseMissingCandleBackfill({
    warehouse,
    provider,
    trades,
    timeframes,
  });
  const avoidedProviderTasks = naiveProviderTasks - dedupedPlan.dedupedTaskCount;

  return {
    generatedAt: new Date().toISOString(),
    provider,
    warehouseDirectoryPath,
    input: {
      symbolCount,
      sessionCount,
      tradesPerSymbolSession,
      timeframes,
      startSessionDate,
    },
    totals: {
      generatedTradeRows: trades.length,
      naiveProviderTasks,
      dedupedProviderTasks: dedupedPlan.dedupedTaskCount,
      avoidedProviderTasks,
      avoidedProviderTaskPct: pct(avoidedProviderTasks, naiveProviderTasks),
      plannedWarehouseTasks: plan.plannedTaskCount,
      fullyCoveredWarehouseTasks: plan.fullyCoveredTaskCount,
      missingWarehouseTasks: plan.missingTaskCount,
      missingCandleCountEstimate: plan.missingCandleCountEstimate,
      providerBatchCount: plan.providerBatches?.length ?? 0,
      maxTaskEstimatedCandles: plan.maxTaskEstimatedCandles ?? 0,
    },
    plan,
    sampleTrades: trades.slice(0, 20),
  };
}

export function formatBulkCandleImportSimulationReport(report: BulkCandleImportSimulationReport): string {
  const lines = [
    "# Bulk Candle Import Simulation",
    "",
    `Generated: ${report.generatedAt}`,
    `Provider: ${report.provider}`,
    `Warehouse: ${report.warehouseDirectoryPath}`,
    "",
    "## Scenario",
    "",
    `- symbols: ${report.input.symbolCount}`,
    `- sessions: ${report.input.sessionCount}`,
    `- trades per symbol/session: ${report.input.tradesPerSymbolSession}`,
    `- timeframes: ${report.input.timeframes.join(", ")}`,
    `- start session date: ${report.input.startSessionDate}`,
    "",
    "## Provider Protection",
    "",
    `- generated trade rows: ${report.totals.generatedTradeRows}`,
    `- naive provider tasks: ${report.totals.naiveProviderTasks}`,
    `- deduped provider tasks: ${report.totals.dedupedProviderTasks}`,
    `- avoided provider tasks: ${report.totals.avoidedProviderTasks} (${report.totals.avoidedProviderTaskPct}%)`,
    "",
    "## Warehouse Readiness",
    "",
    `- planned warehouse tasks: ${report.totals.plannedWarehouseTasks}`,
    `- fully covered warehouse tasks: ${report.totals.fullyCoveredWarehouseTasks}`,
    `- missing warehouse tasks: ${report.totals.missingWarehouseTasks}`,
    `- estimated missing candles: ${report.totals.missingCandleCountEstimate}`,
    `- provider batches: ${report.totals.providerBatchCount}`,
    `- largest missing task estimate: ${report.totals.maxTaskEstimatedCandles} candles`,
    "",
    "## Provider Batches",
    "",
    "| Batch | Tasks | Est. Candles | Symbols | Timeframes |",
    "| ---: | ---: | ---: | ---: | --- |",
  ];

  const providerBatches = report.plan.providerBatches ?? [];
  for (const batch of providerBatches.slice(0, 20)) {
    lines.push(
      `| ${batch.batchIndex} | ${batch.taskCount} | ${batch.estimatedCandleCount} | ${batch.symbols.length} | ${batch.timeframes.join(", ")} |`,
    );
  }
  if (providerBatches.length > 20) {
    lines.push(`| ... | ... | ... | ... | ${providerBatches.length - 20} additional batches omitted |`);
  }

  lines.push(
    "",
    "## Sample Missing Tasks",
    "",
    "| Symbol | Session | Timeframe | Trade Requests | Est. Candles | Stored | Missing Ranges | Missing Candles Est. |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
  );

  for (const task of report.plan.tasks.slice(0, 60)) {
    lines.push(
      `| ${task.symbol} | ${task.sessionDate} | ${task.timeframe} | ${task.tradeRequestCount ?? "n/a"} | ${task.estimatedCandleCount ?? "n/a"} | ${task.coverage.candleCount} | ${task.missingRanges.length} | ${task.missingCandleCountEstimate} |`,
    );
  }
  if (report.plan.tasks.length > 60) {
    lines.push(`| ... | ... | ... | ... | ... | ... | ... | ${report.plan.tasks.length - 60} additional missing tasks omitted |`);
  }

  lines.push("", "## Sample Trade Rows", "");
  for (const trade of report.sampleTrades) {
    lines.push(`- ${trade.symbol} ${trade.sessionDate} as of ${String(trade.asOfTimestamp)}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function writeBulkCandleImportSimulationReport(
  options: WriteBulkCandleImportSimulationOptions,
): Promise<BulkCandleImportSimulationReport> {
  const report = await buildBulkCandleImportSimulationReport(options);
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatBulkCandleImportSimulationReport(report), "utf8");
  return report;
}
