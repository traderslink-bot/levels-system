import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { CandleFetchTimeframe } from "../market-data/candle-types.js";

export type IbkrSmallCapProbeStatus = "completed" | "timeout" | "error";

export type IbkrSmallCapReadinessStatus =
  | "ready"
  | "thin_history"
  | "provider_unavailable";

export type IbkrSmallCapReadinessProbe = {
  symbol: string;
  timeframe: CandleFetchTimeframe;
  status: IbkrSmallCapProbeStatus;
  barsReceived: number;
  firstBar: unknown;
  lastBar: unknown;
  durationMs: number;
  details: unknown;
};

export type IbkrSmallCapReadinessSymbol = IbkrSmallCapReadinessProbe & {
  readiness: IbkrSmallCapReadinessStatus;
  reason: string;
};

export type IbkrSmallCapReadinessReport = {
  generatedAt: string;
  timeframe: CandleFetchTimeframe;
  requestedLookbackBars: number;
  minimumReadyBars: number;
  timeoutMs: number;
  totals: {
    symbols: number;
    ready: number;
    thinHistory: number;
    providerUnavailable: number;
    completed: number;
    timeout: number;
    error: number;
  };
  symbols: IbkrSmallCapReadinessSymbol[];
};

export type BuildIbkrSmallCapReadinessReportOptions = {
  probes: IbkrSmallCapReadinessProbe[];
  timeframe: CandleFetchTimeframe;
  requestedLookbackBars: number;
  timeoutMs: number;
  minimumReadyBars?: number;
  generatedAt?: string;
};

export type WriteIbkrSmallCapReadinessReportOptions = {
  report: IbkrSmallCapReadinessReport;
  jsonPath: string;
  markdownPath: string;
};

function classifyProbe(
  probe: IbkrSmallCapReadinessProbe,
  minimumReadyBars: number,
): Pick<IbkrSmallCapReadinessSymbol, "readiness" | "reason"> {
  if (probe.status !== "completed") {
    return {
      readiness: "provider_unavailable",
      reason: `IBKR ${probe.status} before a complete historical candle response.`,
    };
  }

  if (probe.barsReceived >= minimumReadyBars) {
    return {
      readiness: "ready",
      reason: `IBKR returned at least ${minimumReadyBars} historical candles.`,
    };
  }

  return {
    readiness: "thin_history",
    reason: `IBKR completed but returned only ${probe.barsReceived} historical candle(s).`,
  };
}

export function buildIbkrSmallCapReadinessReport(
  options: BuildIbkrSmallCapReadinessReportOptions,
): IbkrSmallCapReadinessReport {
  const minimumReadyBars = options.minimumReadyBars ?? options.requestedLookbackBars;
  const symbols = options.probes
    .map((probe) => {
      const classification = classifyProbe(probe, minimumReadyBars);
      return {
        ...probe,
        symbol: probe.symbol.trim().toUpperCase(),
        ...classification,
      };
    })
    .sort((left, right) => left.symbol.localeCompare(right.symbol));

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    timeframe: options.timeframe,
    requestedLookbackBars: options.requestedLookbackBars,
    minimumReadyBars,
    timeoutMs: options.timeoutMs,
    totals: {
      symbols: symbols.length,
      ready: symbols.filter((row) => row.readiness === "ready").length,
      thinHistory: symbols.filter((row) => row.readiness === "thin_history").length,
      providerUnavailable: symbols.filter((row) => row.readiness === "provider_unavailable").length,
      completed: symbols.filter((row) => row.status === "completed").length,
      timeout: symbols.filter((row) => row.status === "timeout").length,
      error: symbols.filter((row) => row.status === "error").length,
    },
    symbols,
  };
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "n/a";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function formatIbkrSmallCapReadinessMarkdown(
  report: IbkrSmallCapReadinessReport,
): string {
  const lines: string[] = [
    "# IBKR Small-Cap Readiness Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Timeframe: ${report.timeframe}`,
    `Requested lookback bars: ${report.requestedLookbackBars}`,
    `Minimum ready bars: ${report.minimumReadyBars}`,
    `Timeout: ${report.timeoutMs}ms`,
    "",
    "## Summary",
    "",
    `- symbols checked: ${report.totals.symbols}`,
    `- ready: ${report.totals.ready}`,
    `- thin history: ${report.totals.thinHistory}`,
    `- provider unavailable: ${report.totals.providerUnavailable}`,
    `- completed/timeout/error: ${report.totals.completed}/${report.totals.timeout}/${report.totals.error}`,
    "",
    "## Symbols",
    "",
    "| Symbol | Readiness | Status | Bars | Duration ms | Reason |",
    "| --- | --- | --- | ---: | ---: | --- |",
  ];

  for (const row of report.symbols) {
    lines.push(
      `| ${row.symbol} | ${row.readiness} | ${row.status} | ${row.barsReceived} | ${row.durationMs} | ${row.reason} |`,
    );
  }

  lines.push(
    "",
    "## Operator Notes",
    "",
    "- `ready` means IBKR returned enough historical candles for a controlled activation seed check.",
    "- `thin_history` means IBKR responded, but the history is too small for a confident market-structure seed.",
    "- `provider_unavailable` is an IBKR/data-readiness issue, not a market-structure gate failure.",
    "",
    "## Raw Boundary Bars",
    "",
    "| Symbol | First Bar | Last Bar | Details |",
    "| --- | --- | --- | --- |",
  );

  for (const row of report.symbols) {
    lines.push(
      `| ${row.symbol} | ${formatCell(row.firstBar)} | ${formatCell(row.lastBar)} | ${formatCell(row.details)} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function writeIbkrSmallCapReadinessReport(
  options: WriteIbkrSmallCapReadinessReportOptions,
): IbkrSmallCapReadinessReport {
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(options.report, null, 2)}\n`);
  writeFileSync(options.markdownPath, formatIbkrSmallCapReadinessMarkdown(options.report));
  return options.report;
}

