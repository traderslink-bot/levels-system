import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  buildCandleImportReadinessReport,
  type BuildCandleImportReadinessReportOptions,
  type CandleImportReadinessReport,
} from "./candle-import-readiness-report.js";

export type CandleImportSafetyVerdict =
  | "safe_to_plan"
  | "provider_pressure_watch"
  | "warehouse_gap"
  | "no_trade_rows";

export type CandleImportSafetyReport = {
  generatedAt: string;
  sourceAuditPath: string;
  sourceAuditPaths: string[];
  warehouseDirectoryPath: string;
  provider: CandleImportReadinessReport["provider"];
  verdict: CandleImportSafetyVerdict;
  totals: {
    tradeProxies: number;
    symbols: number;
    sessions: number;
    timeframes: number;
    naiveProviderTasks: number;
    plannedProviderTasks: number;
    avoidedProviderTasks: number;
    avoidedProviderTaskPct: number;
    missingTasks: number;
    fullyCoveredTasks: number;
    estimatedMissingCandles: number;
    providerBatchCount: number;
    maxBatchTasks: number;
    maxBatchEstimatedCandles: number;
    maxTaskEstimatedCandles: number;
  };
  reasons: string[];
  providerBatches: Array<{
    batchIndex: number;
    taskCount: number;
    estimatedCandleCount: number;
    symbols: string[];
    timeframes: string[];
  }>;
  topMissingTasks: Array<{
    symbol: string;
    sessionDate: string;
    timeframe: string;
    missingRanges: number;
    storedCandles: number;
    missingCandleCountEstimate: number;
    estimatedCandleCount: number | null;
  }>;
  symbolSessionCoverage: Array<{
    symbol: string;
    sessionDate: string;
    status: "covered" | "partial" | "missing";
    coveredTimeframes: string[];
    missingTimeframes: string[];
    estimatedMissingCandles: number;
  }>;
};

export type BuildCandleImportSafetyReportOptions = BuildCandleImportReadinessReportOptions;

export type WriteCandleImportSafetyReportOptions = BuildCandleImportSafetyReportOptions & {
  jsonPath: string;
  markdownPath: string;
};

function pct(part: number, total: number): number {
  return total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;
}

function verdictFor(report: CandleImportSafetyReport): Pick<CandleImportSafetyReport, "verdict" | "reasons"> {
  const reasons: string[] = [];
  if (report.totals.tradeProxies === 0) {
    return {
      verdict: "no_trade_rows",
      reasons: ["no saved Discord trade proxies were found in the audit source"],
    };
  }
  if (report.totals.maxBatchEstimatedCandles > 12_000 || report.totals.maxBatchTasks > 80) {
    reasons.push("largest provider batch is large enough to require throttled/backoff execution");
  }
  if (report.totals.missingTasks > report.totals.fullyCoveredTasks * 2 && report.totals.missingTasks > 20) {
    reasons.push("warehouse has materially more missing tasks than covered tasks");
  }
  if (report.totals.estimatedMissingCandles > 40_000) {
    reasons.push("missing candle estimate is high enough to schedule staged backfills");
  }
  if (reasons.some((reason) => /warehouse/i.test(reason))) {
    return { verdict: "warehouse_gap", reasons };
  }
  if (reasons.length > 0) {
    return { verdict: "provider_pressure_watch", reasons };
  }
  return {
    verdict: "safe_to_plan",
    reasons: ["provider request plan is deduped and within current safety thresholds"],
  };
}

export async function buildCandleImportSafetyReport(
  options: BuildCandleImportSafetyReportOptions,
): Promise<CandleImportSafetyReport> {
  const readiness = await buildCandleImportReadinessReport(options);
  const providerBatches = readiness.plan.providerBatches ?? [];
  const naiveProviderTasks = readiness.plan.naiveTaskCount ?? readiness.plan.plannedTaskCount;
  const plannedProviderTasks = readiness.plan.plannedTaskCount;
  const avoidedProviderTasks = readiness.plan.avoidedTaskCount ?? Math.max(0, naiveProviderTasks - plannedProviderTasks);
  const draft: CandleImportSafetyReport = {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: readiness.sourceAuditPath,
    sourceAuditPaths: readiness.sourceAuditPaths,
    warehouseDirectoryPath: readiness.warehouseDirectoryPath,
    provider: readiness.provider,
    verdict: "safe_to_plan",
    totals: {
      tradeProxies: readiness.tradeCount,
      symbols: readiness.symbolCount,
      sessions: readiness.sessionCount,
      timeframes: readiness.timeframes.length,
      naiveProviderTasks,
      plannedProviderTasks,
      avoidedProviderTasks,
      avoidedProviderTaskPct: readiness.plan.avoidedTaskPct ?? pct(avoidedProviderTasks, naiveProviderTasks),
      missingTasks: readiness.plan.missingTaskCount,
      fullyCoveredTasks: readiness.plan.fullyCoveredTaskCount,
      estimatedMissingCandles: readiness.plan.missingCandleCountEstimate,
      providerBatchCount: providerBatches.length,
      maxBatchTasks: providerBatches.reduce((max, batch) => Math.max(max, batch.taskCount), 0),
      maxBatchEstimatedCandles: providerBatches.reduce((max, batch) => Math.max(max, batch.estimatedCandleCount), 0),
      maxTaskEstimatedCandles: readiness.plan.maxTaskEstimatedCandles ?? 0,
    },
    reasons: [],
    providerBatches: providerBatches.slice(0, 30).map((batch) => ({
      batchIndex: batch.batchIndex,
      taskCount: batch.taskCount,
      estimatedCandleCount: batch.estimatedCandleCount,
      symbols: batch.symbols,
      timeframes: batch.timeframes,
    })),
    topMissingTasks: [...readiness.plan.tasks]
      .sort((left, right) =>
        right.missingCandleCountEstimate - left.missingCandleCountEstimate ||
        left.symbol.localeCompare(right.symbol),
      )
      .slice(0, 40)
      .map((task) => ({
        symbol: task.symbol,
        sessionDate: task.sessionDate,
        timeframe: task.timeframe,
        missingRanges: task.missingRanges.length,
        storedCandles: task.coverage.candleCount,
        missingCandleCountEstimate: task.missingCandleCountEstimate,
        estimatedCandleCount: task.estimatedCandleCount ?? null,
      })),
    symbolSessionCoverage: readiness.coverageBySymbolSession.slice(0, 80).map((item) => ({
      symbol: item.symbol,
      sessionDate: item.sessionDate,
      status: item.status,
      coveredTimeframes: item.coveredTimeframes,
      missingTimeframes: item.missingTimeframes,
      estimatedMissingCandles: item.estimatedMissingCandles,
    })),
  };
  const verdict = verdictFor(draft);
  return {
    ...draft,
    verdict: verdict.verdict,
    reasons: verdict.reasons,
  };
}

export function formatCandleImportSafetyReport(report: CandleImportSafetyReport): string {
  const lines = [
    "# Candle Import Safety Report",
    "",
    "Operator-only report for preventing IBKR or a future candle provider from being hammered by repeated symbol/date/timeframe requests.",
    "",
    `Generated: ${report.generatedAt}`,
    `Source audit: ${report.sourceAuditPath}`,
    `Source audit files: ${report.sourceAuditPaths.length}`,
    `Warehouse: ${report.warehouseDirectoryPath}`,
    `Provider: ${report.provider}`,
    `Verdict: ${report.verdict}`,
    "",
    "## Totals",
    "",
    `- trade proxies: ${report.totals.tradeProxies}`,
    `- symbols/sessions/timeframes: ${report.totals.symbols}/${report.totals.sessions}/${report.totals.timeframes}`,
    `- naive provider tasks: ${report.totals.naiveProviderTasks}`,
    `- deduped provider tasks: ${report.totals.plannedProviderTasks}`,
    `- avoided provider tasks: ${report.totals.avoidedProviderTasks} (${report.totals.avoidedProviderTaskPct}%)`,
    `- missing tasks: ${report.totals.missingTasks}`,
    `- fully covered tasks: ${report.totals.fullyCoveredTasks}`,
    `- estimated missing candles: ${report.totals.estimatedMissingCandles}`,
    `- provider batches: ${report.totals.providerBatchCount}`,
    `- largest batch: ${report.totals.maxBatchTasks} tasks / ${report.totals.maxBatchEstimatedCandles} candles`,
    `- largest task estimate: ${report.totals.maxTaskEstimatedCandles} candles`,
    "",
    "## Reasons",
    "",
    ...report.reasons.map((reason) => `- ${reason}`),
    "",
    "## Provider Batches",
    "",
    "| Batch | Tasks | Candles | Symbols | Timeframes |",
    "| ---: | ---: | ---: | --- | --- |",
  ];
  for (const batch of report.providerBatches) {
    lines.push(
      `| ${batch.batchIndex} | ${batch.taskCount} | ${batch.estimatedCandleCount} | ${batch.symbols.slice(0, 12).join(", ")} | ${batch.timeframes.join(", ")} |`,
    );
  }
  if (!report.providerBatches.length) {
    lines.push("| n/a | 0 | 0 | none | none |");
  }

  lines.push("", "## Largest Missing Tasks", "");
  lines.push("| Symbol | Session | Timeframe | Stored | Missing Ranges | Missing Candles | Est. Candles |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: |");
  for (const task of report.topMissingTasks) {
    lines.push(
      `| ${task.symbol} | ${task.sessionDate} | ${task.timeframe} | ${task.storedCandles} | ${task.missingRanges} | ${task.missingCandleCountEstimate} | ${task.estimatedCandleCount ?? "n/a"} |`,
    );
  }
  if (!report.topMissingTasks.length) {
    lines.push("| none | n/a | n/a | 0 | 0 | 0 | n/a |");
  }

  lines.push("", "## Symbol / Session Coverage", "");
  lines.push("This is the practical backfill checklist: missing rows need provider/backfill work; covered rows can be reused from the warehouse.");
  lines.push("");
  lines.push("| Symbol | Session | Status | Covered Timeframes | Missing Timeframes | Missing Candles Est. |");
  lines.push("| --- | --- | --- | --- | --- | ---: |");
  for (const item of report.symbolSessionCoverage) {
    lines.push(
      `| ${item.symbol} | ${item.sessionDate} | ${item.status} | ${item.coveredTimeframes.join(", ") || "none"} | ${item.missingTimeframes.join(", ") || "none"} | ${item.estimatedMissingCandles} |`,
    );
  }
  if (!report.symbolSessionCoverage.length) {
    lines.push("| none | n/a | n/a | none | none | 0 |");
  }

  return `${lines.join("\n")}\n`;
}

export async function writeCandleImportSafetyReport(
  options: WriteCandleImportSafetyReportOptions,
): Promise<CandleImportSafetyReport> {
  const report = await buildCandleImportSafetyReport(options);
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatCandleImportSafetyReport(report), "utf8");
  return report;
}
