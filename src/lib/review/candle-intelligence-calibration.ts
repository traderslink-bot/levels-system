import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { Candle, CandleFetchTimeframe, CandleProviderName } from "../market-data/candle-types.js";
import {
  buildExecutionLevelRelations,
  buildGapStructure,
  buildReferenceLevels,
  buildSupportResistanceContextFromCandles,
  type ExecutionLevelRelations,
  type SharedGapStructure,
  type SharedReferenceLevels,
} from "../support-resistance/index.js";

type AuditRow = {
  operation?: string;
  status?: string;
  timestamp?: number;
  sourceTimestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
  eventType?: string;
  messageKind?: string;
};

type CachedCandleEntry = {
  request?: {
    symbol?: string;
    timeframe?: CandleFetchTimeframe;
    provider?: CandleProviderName;
  };
  response?: {
    symbol?: string;
    timeframe?: CandleFetchTimeframe;
    candles?: Candle[];
    validationIssues?: Array<{ code?: string; severity?: string; message?: string }>;
  };
  candles?: Candle[];
};

export type CandleIntelligenceTrust = "trusted" | "watch" | "experimental" | "broken";

export type CandleIntelligenceCalibrationEvidence = {
  referenceSummary: string[];
  gapSummary: string[];
  relationSummary: string[];
  knownProblemFlags: string[];
};

export type CandleIntelligenceCalibrationSymbol = {
  symbol: string;
  postCount: number;
  snapshotCount: number;
  firstPostAt: number | null;
  lastPostAt: number | null;
  sessionDate: string | null;
  currentPrice: number | null;
  candles: {
    daily: number;
    fourHour: number;
    fiveMinute: number;
  };
  referenceLevels: {
    trust: CandleIntelligenceTrust;
    levels: SharedReferenceLevels | null;
    reasons: string[];
  };
  gapStructure: {
    trust: CandleIntelligenceTrust;
    structure: SharedGapStructure | null;
    reasons: string[];
  };
  executionRelations: {
    trust: CandleIntelligenceTrust;
    relations: ExecutionLevelRelations | null;
    reasons: string[];
  };
  evidence: CandleIntelligenceCalibrationEvidence;
  examples: string[];
};

export type CandleIntelligenceCalibrationReport = {
  generatedAt: string;
  sourceAuditPath: string;
  sourceAuditPaths: string[];
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  symbolsReviewed: number;
  totals: {
    trustedReferenceLevels: number;
    watchReferenceLevels: number;
    brokenReferenceLevels: number;
    trustedGapStructures: number;
    watchGapStructures: number;
    experimentalGapStructures: number;
    brokenGapStructures: number;
    trustedRelations: number;
    relationWarnings: number;
    relationBroken: number;
    missingCandleSymbols: number;
    knownProblemSymbolsReviewed: number;
  };
  symbols: CandleIntelligenceCalibrationSymbol[];
};

export type BuildCandleIntelligenceCalibrationReportOptions = {
  auditPath: string;
  cacheDirectoryPath?: string;
  provider?: CandleProviderName;
  maxSymbols?: number;
};

export type WriteCandleIntelligenceCalibrationReportOptions =
  BuildCandleIntelligenceCalibrationReportOptions & {
    jsonPath: string;
    markdownPath: string;
  };

const DEFAULT_CACHE_DIRECTORY = ".validation-cache/candles";
const KNOWN_PROBLEM_SYMBOLS = new Set(["CYCU", "PBM", "FATN", "AKAN", "CUE"]);

function resolveAuditPath(pathOrDirectory: string): string {
  const path = resolve(pathOrDirectory);
  if (path.endsWith(".jsonl")) {
    return path;
  }
  return join(path, "discord-delivery-audit.jsonl");
}

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

function isPosted(row: AuditRow): boolean {
  return (
    (row.status === "posted" || row.status === "success") &&
    ["post_alert", "post_level_snapshot", "post_level_extension"].includes(String(row.operation))
  );
}

function symbolOf(row: AuditRow): string {
  return row.symbol?.trim().toUpperCase() || "UNKNOWN";
}

function textOf(row: AuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function excerpt(row: AuditRow, maxLength = 240): string {
  const text = textOf(row);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function priceFromRow(row: AuditRow): number | null {
  const text = textOf(row);
  const patterns = [
    /\bPrice:\s*([0-9]+(?:\.[0-9]+)?)/i,
    /\bTriggered near:\s*([0-9]+(?:\.[0-9]+)?)/i,
    /\bprice\s+([0-9]+(?:\.[0-9]+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
  }
  return null;
}

const newYorkDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function sessionDateFromTimestamp(timestamp: number | null): string | null {
  return timestamp === null ? null : newYorkDateFormatter.format(new Date(timestamp));
}

function parseCacheEntry(path: string): CachedCandleEntry | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CachedCandleEntry;
  } catch {
    return null;
  }
}

function walkJsonFiles(directoryPath: string): string[] {
  if (!existsSync(directoryPath)) {
    return [];
  }
  const output: string[] = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const path = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      output.push(...walkJsonFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      output.push(path);
    }
  }
  return output;
}

function extractCandles(entry: CachedCandleEntry | null): Candle[] {
  const candles = entry?.response?.candles ?? entry?.candles ?? [];
  return candles.filter((candle) =>
    [candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ),
  );
}

function loadCandles(params: {
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
}): Candle[] {
  const directory = join(params.cacheDirectoryPath, params.provider, params.symbol, params.timeframe);
  const byTimestamp = new Map<number, Candle>();
  for (const file of walkJsonFiles(directory)) {
    for (const candle of extractCandles(parseCacheEntry(file))) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function classifyReferenceTrust(referenceLevels: SharedReferenceLevels, counts: {
  daily: number;
  fiveMinute: number;
}): { trust: CandleIntelligenceTrust; reasons: string[] } {
  const reasons = referenceLevels.diagnostics.map((diagnostic) => diagnostic.code);
  if (counts.daily === 0 || counts.fiveMinute === 0 || referenceLevels.previousDayHigh === null) {
    return { trust: "broken", reasons: reasons.length ? reasons : ["missing required candle evidence"] };
  }
  const criticalMissing = referenceLevels.openingRangeHigh === null || referenceLevels.currentSessionHigh === null;
  if (criticalMissing || reasons.length > 0) {
    return { trust: "watch", reasons: reasons.length ? reasons : ["partial session reference evidence"] };
  }
  return { trust: "trusted", reasons: ["previous-day and intraday references available"] };
}

function classifyGapTrust(gapStructure: SharedGapStructure, dailyCount: number): {
  trust: CandleIntelligenceTrust;
  reasons: string[];
} {
  if (dailyCount < 2) {
    return { trust: "broken", reasons: ["missing daily candles for gap review"] };
  }
  if (gapStructure.recentGaps.length === 0) {
    return { trust: "experimental", reasons: ["no meaningful gaps found in saved daily candles"] };
  }
  return { trust: "experimental", reasons: ["gap facts available but still need saved-data calibration before trader wording"] };
}

function classifyRelations(relations: ExecutionLevelRelations | null, error?: string): {
  trust: CandleIntelligenceTrust;
  reasons: string[];
} {
  if (!relations) {
    return { trust: "broken", reasons: [error ?? "could not build support/resistance context"] };
  }
  const reasons: string[] = [];
  if (!relations.nearestSupportBelow) {
    reasons.push("missing nearest support below");
  }
  if (!relations.nearestResistanceAbove) {
    reasons.push("missing nearest resistance above");
  }
  if (relations.occurredInOpenAir) {
    reasons.push("open-air relation needs review before trader wording");
  }
  return {
    trust: reasons.length ? "watch" : "trusted",
    reasons: reasons.length ? reasons : ["nearest support/resistance relation available"],
  };
}

async function buildSymbolReport(params: {
  symbol: string;
  rows: AuditRow[];
  cacheDirectoryPath: string;
  provider: CandleProviderName;
}): Promise<CandleIntelligenceCalibrationSymbol> {
  const sortedRows = [...params.rows].sort((left, right) => (rowTimestamp(left) ?? 0) - (rowTimestamp(right) ?? 0));
  const firstPostAt = rowTimestamp(sortedRows[0] ?? {});
  const lastPostAt = rowTimestamp(sortedRows.at(-1) ?? {});
  const sessionDate = sessionDateFromTimestamp(firstPostAt);
  const latestPrice = [...sortedRows].reverse().map(priceFromRow).find((price) => price !== null) ?? null;
  const daily = loadCandles({ ...params, timeframe: "daily" });
  const fourHour = loadCandles({ ...params, timeframe: "4h" });
  const fiveMinute = loadCandles({ ...params, timeframe: "5m" });
  const referenceLevels = buildReferenceLevels({
    dailyCandles: daily,
    intradayCandles: fiveMinute,
    sessionDate: sessionDate ?? undefined,
  });
  const referenceTrust = classifyReferenceTrust(referenceLevels, { daily: daily.length, fiveMinute: fiveMinute.length });
  const gapStructure = buildGapStructure({
    candles: daily,
    currentPrice: latestPrice ?? undefined,
  });
  const gapTrust = classifyGapTrust(gapStructure, daily.length);
  let relations: ExecutionLevelRelations | null = null;
  let relationError: string | undefined;
  if (latestPrice !== null && daily.length > 0 && fourHour.length > 0) {
    try {
      const context = await buildSupportResistanceContextFromCandles({
        symbol: params.symbol,
        sessionDate: sessionDate ?? undefined,
        currentPrice: latestPrice,
        candlesByTimeframe: {
          daily,
          "4h": fourHour,
          "5m": fiveMinute,
        },
      });
      relations = buildExecutionLevelRelations({
        price: latestPrice,
        levels: context.levels,
        referenceLevels: context.referenceLevels,
      });
    } catch (error) {
      relationError = error instanceof Error ? error.message : String(error);
    }
  } else {
    relationError = "missing current price or daily/4h candles";
  }
  const relationTrust = classifyRelations(relations, relationError);

  return {
    symbol: params.symbol,
    postCount: params.rows.length,
    snapshotCount: params.rows.filter((row) => row.operation === "post_level_snapshot").length,
    firstPostAt,
    lastPostAt,
    sessionDate,
    currentPrice: latestPrice,
    candles: {
      daily: daily.length,
      fourHour: fourHour.length,
      fiveMinute: fiveMinute.length,
    },
    referenceLevels: {
      trust: referenceTrust.trust,
      levels: referenceLevels,
      reasons: referenceTrust.reasons,
    },
    gapStructure: {
      trust: gapTrust.trust,
      structure: gapStructure,
      reasons: gapTrust.reasons,
    },
    executionRelations: {
      trust: relationTrust.trust,
      relations,
      reasons: relationTrust.reasons,
    },
    evidence: buildEvidence({
      symbol: params.symbol,
      referenceLevels,
      gapStructure,
      relations,
    }),
    examples: sortedRows.slice(0, 3).map(excerpt),
  };
}

export async function buildCandleIntelligenceCalibrationReport(
  options: BuildCandleIntelligenceCalibrationReportOptions,
): Promise<CandleIntelligenceCalibrationReport> {
  const auditPaths = resolveAuditPaths(options.auditPath);
  const auditPath = auditPaths[0] ?? resolveAuditPath(options.auditPath);
  const cacheDirectoryPath = options.cacheDirectoryPath ?? DEFAULT_CACHE_DIRECTORY;
  const provider = options.provider ?? "ibkr";
  const rows = auditPaths
    .flatMap((path) => readRows(path))
    .filter((row) => isPosted(row) && symbolOf(row) !== "UNKNOWN");
  const bySymbol = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const symbol = symbolOf(row);
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), row]);
  }
  const symbolReports: CandleIntelligenceCalibrationSymbol[] = [];
  for (const symbol of [...bySymbol.keys()].sort().slice(0, options.maxSymbols ?? Number.POSITIVE_INFINITY)) {
    symbolReports.push(await buildSymbolReport({
      symbol,
      rows: bySymbol.get(symbol) ?? [],
      cacheDirectoryPath,
      provider,
    }));
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPaths.length === 1 ? auditPath : `${auditPaths.length} audit files from ${resolve(options.auditPath)}`,
    sourceAuditPaths: auditPaths,
    cacheDirectoryPath,
    provider,
    symbolsReviewed: symbolReports.length,
    totals: {
      trustedReferenceLevels: symbolReports.filter((symbol) => symbol.referenceLevels.trust === "trusted").length,
      watchReferenceLevels: symbolReports.filter((symbol) => symbol.referenceLevels.trust === "watch").length,
      brokenReferenceLevels: symbolReports.filter((symbol) => symbol.referenceLevels.trust === "broken").length,
      trustedGapStructures: symbolReports.filter((symbol) => symbol.gapStructure.trust === "trusted").length,
      watchGapStructures: symbolReports.filter((symbol) => symbol.gapStructure.trust === "watch").length,
      experimentalGapStructures: symbolReports.filter((symbol) => symbol.gapStructure.trust === "experimental").length,
      brokenGapStructures: symbolReports.filter((symbol) => symbol.gapStructure.trust === "broken").length,
      trustedRelations: symbolReports.filter((symbol) => symbol.executionRelations.trust === "trusted").length,
      relationWarnings: symbolReports.filter((symbol) => symbol.executionRelations.trust === "watch").length,
      relationBroken: symbolReports.filter((symbol) => symbol.executionRelations.trust === "broken").length,
      missingCandleSymbols: symbolReports.filter((symbol) =>
        symbol.candles.daily === 0 || symbol.candles.fourHour === 0 || symbol.candles.fiveMinute === 0,
      ).length,
      knownProblemSymbolsReviewed: symbolReports.filter((symbol) => KNOWN_PROBLEM_SYMBOLS.has(symbol.symbol)).length,
    },
    symbols: symbolReports,
  };
}

function iso(timestamp: number | null): string {
  return timestamp === null ? "n/a" : new Date(timestamp).toISOString();
}

function price(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function range(left: number | null | undefined, right: number | null | undefined): string {
  if (left === null || left === undefined || right === null || right === undefined) {
    return "n/a";
  }
  return `${price(left)}-${price(right)}`;
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${value.toFixed(1)}%`;
}

function buildEvidence(params: {
  symbol: string;
  referenceLevels: SharedReferenceLevels;
  gapStructure: SharedGapStructure;
  relations: ExecutionLevelRelations | null;
}): CandleIntelligenceCalibrationEvidence {
  const relation = params.relations;
  const knownProblemFlags = KNOWN_PROBLEM_SYMBOLS.has(params.symbol)
    ? [`known regression symbol: ${params.symbol}`]
    : [];
  return {
    knownProblemFlags,
    referenceSummary: [
      `previous day H/L/C: ${price(params.referenceLevels.previousDayHigh)} / ${price(params.referenceLevels.previousDayLow)} / ${price(params.referenceLevels.previousDayClose)}`,
      `premarket H/L/base: ${price(params.referenceLevels.premarketHigh)} / ${price(params.referenceLevels.premarketLow)} / ${price(params.referenceLevels.premarketBase)}`,
      `opening range: ${range(params.referenceLevels.openingRangeLow, params.referenceLevels.openingRangeHigh)}`,
      `current session: ${range(params.referenceLevels.currentSessionLow, params.referenceLevels.currentSessionHigh)}`,
    ],
    gapSummary: [
      `nearest gap above: ${params.gapStructure.nearestGapAbove ? `${price(params.gapStructure.nearestGapAbove.start)}-${price(params.gapStructure.nearestGapAbove.end)} ${params.gapStructure.nearestGapAbove.direction} ${formatPct(params.gapStructure.nearestGapAbove.distancePctFromPrice)}` : "none"}`,
      `nearest gap below: ${params.gapStructure.nearestGapBelow ? `${price(params.gapStructure.nearestGapBelow.start)}-${price(params.gapStructure.nearestGapBelow.end)} ${params.gapStructure.nearestGapBelow.direction} ${formatPct(params.gapStructure.nearestGapBelow.distancePctFromPrice)}` : "none"}`,
      `recent gaps: ${params.gapStructure.recentGaps.length}`,
    ],
    relationSummary: [
      `nearest support below: ${price(relation?.nearestSupportBelow?.representativePrice)} (${formatPct(relation?.distanceToSupportPct)})`,
      `nearest resistance above: ${price(relation?.nearestResistanceAbove?.representativePrice)} (${formatPct(relation?.distanceToResistancePct)})`,
      `resistance below: ${price(relation?.nearestResistanceBelow?.representativePrice)}`,
      `stacked support/resistance: ${relation?.stackedSupportBelowCount ?? "n/a"} / ${relation?.stackedResistanceAboveCount ?? "n/a"}`,
      `nearest reference: ${relation?.nearestReference?.label ?? "n/a"}`,
    ],
  };
}

export function formatCandleIntelligenceCalibrationReport(report: CandleIntelligenceCalibrationReport): string {
  const lines = [
    "# Candle Intelligence Calibration Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Source audit: ${report.sourceAuditPath}`,
    `Source audit files: ${report.sourceAuditPaths.length}`,
    `Cache: ${report.cacheDirectoryPath}`,
    `Provider: ${report.provider}`,
    "",
    "## Totals",
    "",
    `- symbols reviewed: ${report.symbolsReviewed}`,
    `- trusted reference levels: ${report.totals.trustedReferenceLevels}`,
    `- watch reference levels: ${report.totals.watchReferenceLevels}`,
    `- broken reference levels: ${report.totals.brokenReferenceLevels}`,
    `- trusted gap structures: ${report.totals.trustedGapStructures}`,
    `- watch gap structures: ${report.totals.watchGapStructures}`,
    `- experimental gap structures: ${report.totals.experimentalGapStructures}`,
    `- broken gap structures: ${report.totals.brokenGapStructures}`,
    `- trusted relations: ${report.totals.trustedRelations}`,
    `- relation warnings: ${report.totals.relationWarnings}`,
    `- relation broken: ${report.totals.relationBroken}`,
    `- missing candle symbols: ${report.totals.missingCandleSymbols}`,
    `- known problem symbols reviewed: ${report.totals.knownProblemSymbolsReviewed}`,
    "",
    "## Symbol Evidence",
    "",
    "| Symbol | Posts | Candles D/4h/5m | Ref | Gap | Relations | Current | Nearest Support | Nearest Resistance | Reasons |",
    "| --- | ---: | --- | --- | --- | --- | ---: | --- | --- | --- |",
  ];

  for (const symbol of report.symbols) {
    const relation = symbol.executionRelations.relations;
    const flags = symbol.evidence.knownProblemFlags.length ? ` ${symbol.evidence.knownProblemFlags.join(", ")}` : "";
    lines.push(
      `| ${symbol.symbol} | ${symbol.postCount} | ${symbol.candles.daily}/${symbol.candles.fourHour}/${symbol.candles.fiveMinute} | ${symbol.referenceLevels.trust} | ${symbol.gapStructure.trust} | ${symbol.executionRelations.trust} | ${price(symbol.currentPrice)} | ${price(relation?.nearestSupportBelow?.representativePrice)} | ${price(relation?.nearestResistanceAbove?.representativePrice)} | ${[
        ...symbol.referenceLevels.reasons,
        ...symbol.gapStructure.reasons,
        ...symbol.executionRelations.reasons,
      ].slice(0, 4).join("; ")}${flags} |`,
    );
  }

  const knownProblems = report.symbols.filter((symbol) => KNOWN_PROBLEM_SYMBOLS.has(symbol.symbol));
  if (knownProblems.length > 0) {
    lines.push("", "## Known Problem Symbol Regression Evidence", "");
    for (const symbol of knownProblems) {
      lines.push(
        `### ${symbol.symbol}`,
        "",
        `- posts: ${symbol.postCount}`,
        `- candles D/4h/5m: ${symbol.candles.daily}/${symbol.candles.fourHour}/${symbol.candles.fiveMinute}`,
        `- trust: reference=${symbol.referenceLevels.trust}, gap=${symbol.gapStructure.trust}, relations=${symbol.executionRelations.trust}`,
        `- references: ${symbol.evidence.referenceSummary.join("; ")}`,
        `- relations: ${symbol.evidence.relationSummary.join("; ")}`,
        `- gaps: ${symbol.evidence.gapSummary.join("; ")}`,
        `- saved post excerpt: ${symbol.examples[0] ?? "n/a"}`,
        "",
      );
    }
  }

  const attention = report.symbols.filter((symbol) =>
    symbol.referenceLevels.trust === "broken" ||
    symbol.executionRelations.trust === "broken" ||
    symbol.executionRelations.trust === "watch",
  ).slice(0, 12);
  if (attention.length > 0) {
    lines.push("", "## Attention Samples", "");
    for (const symbol of attention) {
      lines.push(
        `### ${symbol.symbol}`,
        "",
        `- window: ${iso(symbol.firstPostAt)} to ${iso(symbol.lastPostAt)}`,
        `- session date: ${symbol.sessionDate ?? "n/a"}`,
        `- reference trust: ${symbol.referenceLevels.trust} (${symbol.referenceLevels.reasons.join("; ")})`,
        `- gap trust: ${symbol.gapStructure.trust} (${symbol.gapStructure.reasons.join("; ")})`,
        `- relation trust: ${symbol.executionRelations.trust} (${symbol.executionRelations.reasons.join("; ")})`,
        `- references: ${symbol.evidence.referenceSummary.join("; ")}`,
        `- relations: ${symbol.evidence.relationSummary.join("; ")}`,
        `- examples: ${symbol.examples[0] ?? "n/a"}`,
        "",
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export function writeCandleIntelligenceCalibrationReport(
  options: WriteCandleIntelligenceCalibrationReportOptions,
): Promise<CandleIntelligenceCalibrationReport> {
  return buildCandleIntelligenceCalibrationReport(options).then((report) => {
    mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
    mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
    writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    writeFileSync(options.markdownPath, formatCandleIntelligenceCalibrationReport(report), "utf8");
    return report;
  });
}
