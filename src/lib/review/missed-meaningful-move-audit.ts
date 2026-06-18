import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { Candle, CandleFetchTimeframe, CandleProviderName } from "../market-data/candle-types.js";

type AuditRow = {
  operation?: string;
  status?: string;
  timestamp?: number;
  sourceTimestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
  messageKind?: string;
  eventType?: string;
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
  };
  candles?: Candle[];
};

export type MissedMoveKind = "upside_break" | "downside_loss" | "large_range";
export type MissedMoveCoverage = "covered" | "weak_coverage" | "missed";
export type MissedMoveSeverity = "major" | "watch" | "data_quality_only";

export type MissedMeaningfulMoveCandidate = {
  symbol: string;
  kind: MissedMoveKind;
  timestamp: number;
  timestampIso: string;
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  closeMovePct: number;
  rangePct: number;
  rollingHigh: number | null;
  rollingLow: number | null;
  breakDistancePct: number | null;
  coverage: MissedMoveCoverage;
  severity: MissedMoveSeverity;
  reason: string;
  nearestPosts: Array<{
    timestamp: number;
    timestampIso: string;
    title?: string;
    operation?: string;
    eventType?: string;
    excerpt: string;
    distanceMinutes: number;
  }>;
};

export type ReviewedCandleMove = {
  timestamp: number;
  timestampIso: string;
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  closeMovePct: number;
  rangePct: number;
};

export type MissedMeaningfulMoveSymbolReport = {
  symbol: string;
  candleCount: number;
  reviewedCandleCount: number;
  postCount: number;
  firstPostAt: number | null;
  lastPostAt: number | null;
  candidateCount: number;
  coveredCount: number;
  weakCoverageCount: number;
  missedCount: number;
  majorCount: number;
  candidates: MissedMeaningfulMoveCandidate[];
  largestReviewedMoves: ReviewedCandleMove[];
};

export type MissedMeaningfulMoveAuditReport = {
  generatedAt: string;
  sourceAuditPath: string;
  sourceAuditPaths: string[];
  cacheDirectoryPath: string;
  warehouseDirectoryPath: string | null;
  provider: CandleProviderName;
  timeframe: CandleFetchTimeframe;
  auditWindow: {
    startTimestamp: number | null;
    endTimestamp: number | null;
  };
  totals: {
    symbols: number;
    candles: number;
    posts: number;
    candidates: number;
    covered: number;
    weakCoverage: number;
    missed: number;
    major: number;
    symbolsWithoutCandles: number;
    symbolsWithoutAuditWindowCandles: number;
  };
  symbolsWithoutCandles: string[];
  symbolsWithoutAuditWindowCandles: string[];
  symbols: MissedMeaningfulMoveSymbolReport[];
};

export type GenerateMissedMeaningfulMoveAuditOptions = {
  auditPath: string;
  cacheDirectoryPath?: string;
  warehouseDirectoryPath?: string;
  provider?: CandleProviderName;
  timeframe?: CandleFetchTimeframe;
  coverageWindowMs?: number;
  auditWindowPaddingMs?: number;
  maxAuditFiles?: number;
};

export type WriteMissedMeaningfulMoveAuditOptions = GenerateMissedMeaningfulMoveAuditOptions & {
  jsonPath: string;
  markdownPath: string;
};

const DEFAULT_COVERAGE_WINDOW_MS = 12 * 60 * 1000;
const DEFAULT_AUDIT_WINDOW_PADDING_MS = 10 * 60 * 1000;
const ROLLING_WINDOW_BARS = 6;

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

function symbolOf(row: AuditRow): string {
  return row.symbol?.trim().toUpperCase() || "UNKNOWN";
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

function text(row: AuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function excerpt(row: AuditRow, maxLength = 240): string {
  const value = text(row);
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function pctChange(next: number, previous: number): number {
  if (!Number.isFinite(next) || !Number.isFinite(previous) || Math.abs(previous) <= 0.000001) {
    return 0;
  }
  return ((next - previous) / previous) * 100;
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatDistancePct(value: number): string {
  return `${Math.abs(value).toFixed(1)}%`;
}

function formatPrice(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
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

function walkJsonlFiles(directoryPath: string): string[] {
  if (!existsSync(directoryPath)) {
    return [];
  }
  const output: string[] = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const path = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      output.push(...walkJsonlFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      output.push(path);
    }
  }
  return output;
}

function limitAuditPaths(paths: string[], maxAuditFiles?: number): string[] {
  if (typeof maxAuditFiles !== "number" || !Number.isFinite(maxAuditFiles) || maxAuditFiles <= 0) {
    return paths;
  }
  return paths.slice(0, Math.floor(maxAuditFiles));
}

function resolveAuditPaths(pathOrDirectory: string, maxAuditFiles?: number): string[] {
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
  return limitAuditPaths(readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name, "discord-delivery-audit.jsonl"))
    .filter((candidate) => existsSync(candidate))
    .sort(), maxAuditFiles);
}

function extractCandles(entry: CachedCandleEntry | null): Candle[] {
  const candles = entry?.response?.candles ?? entry?.candles ?? [];
  return candles.filter((candle) =>
    [candle.timestamp, candle.open, candle.high, candle.low, candle.close].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ),
  );
}

function loadCandlesForSymbol(params: {
  cacheDirectoryPath: string;
  warehouseDirectoryPath?: string;
  provider: CandleProviderName;
  timeframe: CandleFetchTimeframe;
  symbol: string;
}): Candle[] {
  const byTimestamp = new Map<number, Candle>();
  const cacheSymbolDirectory = join(
    params.cacheDirectoryPath,
    params.provider,
    params.symbol,
    params.timeframe,
  );
  for (const file of walkJsonFiles(cacheSymbolDirectory)) {
    for (const candle of extractCandles(parseCacheEntry(file))) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }

  if (params.warehouseDirectoryPath) {
    const warehouseSymbolDirectory = join(
      params.warehouseDirectoryPath,
      params.provider,
      params.symbol,
      params.timeframe,
    );
    for (const file of walkJsonlFiles(warehouseSymbolDirectory)) {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const candle = JSON.parse(trimmed) as Candle;
          if ([candle.timestamp, candle.open, candle.high, candle.low, candle.close].every(
            (value) => typeof value === "number" && Number.isFinite(value),
          )) {
            byTimestamp.set(candle.timestamp, candle);
          }
        } catch {
          // Ignore corrupt warehouse lines here; warehouse audits own row-quality reporting.
        }
      }
    }
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function candidateThresholdPct(price: number): number {
  if (price < 2) {
    return 5.5;
  }
  if (price < 10) {
    return 4.5;
  }
  return 4;
}

function rollingBreakThresholdPct(price: number): number {
  if (price < 2) {
    return 3;
  }
  if (price < 10) {
    return 2.5;
  }
  return 2;
}

function movesInAuditWindow(params: {
  symbol: string;
  candles: Candle[];
  auditStart: number | null;
  auditEnd: number | null;
  paddingMs: number;
}): ReviewedCandleMove[] {
  const moves: ReviewedCandleMove[] = [];
  for (let index = 1; index < params.candles.length; index += 1) {
    const candle = params.candles[index]!;
    const previous = params.candles[index - 1]!;
    if (
      params.auditStart !== null &&
      (candle.timestamp < params.auditStart - params.paddingMs || candle.timestamp > (params.auditEnd ?? candle.timestamp) + params.paddingMs)
    ) {
      continue;
    }

    moves.push({
      timestamp: candle.timestamp,
      timestampIso: new Date(candle.timestamp).toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      previousClose: previous.close,
      closeMovePct: pctChange(candle.close, previous.close),
      rangePct: pctChange(candle.high, candle.low),
    });
  }
  return moves;
}

function classifyCandidates(params: {
  symbol: string;
  candles: Candle[];
  auditStart: number | null;
  auditEnd: number | null;
  paddingMs: number;
}): Array<Omit<MissedMeaningfulMoveCandidate, "coverage" | "severity" | "nearestPosts">> {
  const candidates: Array<Omit<MissedMeaningfulMoveCandidate, "coverage" | "severity" | "nearestPosts">> = [];
  for (let index = 1; index < params.candles.length; index += 1) {
    const candle = params.candles[index]!;
    const previous = params.candles[index - 1]!;
    if (
      params.auditStart !== null &&
      (candle.timestamp < params.auditStart - params.paddingMs || candle.timestamp > (params.auditEnd ?? candle.timestamp) + params.paddingMs)
    ) {
      continue;
    }

    const priorWindow = params.candles.slice(Math.max(0, index - ROLLING_WINDOW_BARS), index);
    const rollingHigh = priorWindow.length ? Math.max(...priorWindow.map((item) => item.high)) : null;
    const rollingLow = priorWindow.length ? Math.min(...priorWindow.map((item) => item.low)) : null;
    const closeMovePct = pctChange(candle.close, previous.close);
    const rangePct = pctChange(candle.high, candle.low);
    const threshold = candidateThresholdPct(previous.close);
    const rollingBreakThreshold = rollingBreakThresholdPct(previous.close);

    const aboveRollingHigh =
      rollingHigh !== null && candle.close > rollingHigh ? pctChange(candle.close, rollingHigh) : null;
    const belowRollingLow =
      rollingLow !== null && candle.close < rollingLow ? pctChange(rollingLow, candle.close) : null;
    const materialAboveRollingHigh = (aboveRollingHigh ?? 0) >= rollingBreakThreshold;
    const materialBelowRollingLow = (belowRollingLow ?? 0) >= rollingBreakThreshold;

    const base = {
      symbol: params.symbol,
      timestamp: candle.timestamp,
      timestampIso: new Date(candle.timestamp).toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      previousClose: previous.close,
      closeMovePct,
      rangePct,
      rollingHigh,
      rollingLow,
    };

    if (closeMovePct >= threshold && materialAboveRollingHigh) {
      candidates.push({
        ...base,
        kind: "upside_break",
        breakDistancePct: aboveRollingHigh,
        reason: `5m close moved ${formatPct(closeMovePct)} and pressed above recent resistance near ${formatPrice(rollingHigh ?? candle.high)}`,
      });
      continue;
    }

    if (closeMovePct <= -threshold && materialBelowRollingLow) {
      candidates.push({
        ...base,
        kind: "downside_loss",
        breakDistancePct: belowRollingLow,
        reason: `5m close moved ${formatPct(closeMovePct)} and pressed below recent support near ${formatPrice(rollingLow ?? candle.low)}`,
      });
      continue;
    }

    if (materialAboveRollingHigh) {
      candidates.push({
        ...base,
        kind: "upside_break",
        breakDistancePct: aboveRollingHigh,
        reason: `5m close pressed ${formatDistancePct(aboveRollingHigh ?? 0)} above recent resistance near ${formatPrice(rollingHigh ?? candle.high)}, enough to review whether a trader-facing update was warranted`,
      });
      continue;
    }

    if (materialBelowRollingLow) {
      candidates.push({
        ...base,
        kind: "downside_loss",
        breakDistancePct: belowRollingLow,
        reason: `5m close pressed ${formatDistancePct(belowRollingLow ?? 0)} below recent support near ${formatPrice(rollingLow ?? candle.low)}, enough to review whether a trader-facing update was warranted`,
      });
      continue;
    }

    if (Math.abs(closeMovePct) >= threshold) {
      const nearbyLevelText = closeMovePct > 0 && rollingHigh !== null
        ? aboveRollingHigh !== null
          ? ` while only ${formatDistancePct(aboveRollingHigh)} above recent resistance near ${formatPrice(rollingHigh)}`
          : ` without closing above recent resistance near ${formatPrice(rollingHigh)}`
        : closeMovePct < 0 && rollingLow !== null
          ? belowRollingLow !== null
            ? ` while only ${formatDistancePct(belowRollingLow)} below recent support near ${formatPrice(rollingLow)}`
            : ` without closing below recent support near ${formatPrice(rollingLow)}`
          : "";
      candidates.push({
        ...base,
        kind: "large_range",
        breakDistancePct: closeMovePct > 0 ? aboveRollingHigh : belowRollingLow,
        reason: `5m close moved ${formatPct(closeMovePct)}${nearbyLevelText}, enough to review whether context was needed`,
      });
      continue;
    }

    if (rangePct >= threshold * 1.35) {
      candidates.push({
        ...base,
        kind: "large_range",
        breakDistancePct: null,
        reason: `5m candle range expanded to ${formatPct(rangePct)}, large enough to check whether a trader-facing update was warranted`,
      });
    }
  }
  return candidates;
}

function coverageKeywords(kind: MissedMoveKind): RegExp {
  if (kind === "upside_break") {
    return /breakout|resistance crossed|reclaim|cleared|above resistance|pushed above/i;
  }
  if (kind === "downside_loss") {
    return /breakdown|support crossed|support lost|lost support|below support|slipped below/i;
  }
  return /breakout|breakdown|support crossed|resistance crossed|level touch|support and resistance|current read/i;
}

function nearestPosts(params: {
  candidate: Omit<MissedMeaningfulMoveCandidate, "coverage" | "severity" | "nearestPosts">;
  rows: AuditRow[];
  coverageWindowMs: number;
}): MissedMeaningfulMoveCandidate["nearestPosts"] {
  return params.rows
    .map((row) => {
      const timestamp = rowTimestamp(row);
      if (timestamp === null) {
        return null;
      }
      return {
        timestamp,
        timestampIso: new Date(timestamp).toISOString(),
        title: row.title,
        operation: row.operation,
        eventType: row.eventType,
        excerpt: excerpt(row),
        distanceMinutes: Math.round((Math.abs(timestamp - params.candidate.timestamp) / 60_000) * 10) / 10,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .filter((item) => item.distanceMinutes <= Math.max(30, params.coverageWindowMs / 60_000))
    .sort((left, right) => left.distanceMinutes - right.distanceMinutes)
    .slice(0, 4);
}

function classifyCoverage(params: {
  candidate: Omit<MissedMeaningfulMoveCandidate, "coverage" | "severity" | "nearestPosts">;
  rows: AuditRow[];
  coverageWindowMs: number;
}): MissedMoveCoverage {
  const candidateText = coverageKeywords(params.candidate.kind);
  const nearby = params.rows.filter((row) => {
    const timestamp = rowTimestamp(row);
    return timestamp !== null && Math.abs(timestamp - params.candidate.timestamp) <= params.coverageWindowMs;
  });
  if (nearby.some((row) => row.operation === "post_alert" && candidateText.test(text(row)))) {
    return "covered";
  }
  if (nearby.some((row) => ["post_alert", "post_level_snapshot", "post_level_extension"].includes(String(row.operation)))) {
    return "weak_coverage";
  }
  return "missed";
}

function severityFor(
  candidate: Omit<MissedMeaningfulMoveCandidate, "coverage" | "severity" | "nearestPosts">,
  coverage: MissedMoveCoverage,
): MissedMoveSeverity {
  if (coverage === "covered") {
    return "data_quality_only";
  }
  if (
    coverage === "missed" &&
    (Math.abs(candidate.closeMovePct) >= 10 ||
      candidate.rangePct >= 15 ||
      (candidate.breakDistancePct ?? 0) >= 5)
  ) {
    return "major";
  }
  return "watch";
}

export function generateMissedMeaningfulMoveAudit(
  options: GenerateMissedMeaningfulMoveAuditOptions,
): MissedMeaningfulMoveAuditReport {
  const sourceAuditPaths = resolveAuditPaths(options.auditPath, options.maxAuditFiles);
  const cacheDirectoryPath = resolve(
    options.cacheDirectoryPath ?? join(process.cwd(), ".validation-cache", "candles"),
  );
  const warehouseDirectoryPath = options.warehouseDirectoryPath
    ? resolve(options.warehouseDirectoryPath)
    : undefined;
  const provider = options.provider ?? "ibkr";
  const timeframe = options.timeframe ?? "5m";
  const coverageWindowMs = options.coverageWindowMs ?? DEFAULT_COVERAGE_WINDOW_MS;
  const auditWindowPaddingMs = options.auditWindowPaddingMs ?? DEFAULT_AUDIT_WINDOW_PADDING_MS;

  const rows = sourceAuditPaths.flatMap((path) => readRows(path)).filter(isPosted);
  const rowsBySymbol = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const symbol = symbolOf(row);
    rowsBySymbol.set(symbol, [...(rowsBySymbol.get(symbol) ?? []), row]);
  }

  const timestamps = rows.map(rowTimestamp).filter((value): value is number => value !== null);
  const auditStart = timestamps.length ? Math.min(...timestamps) : null;
  const auditEnd = timestamps.length ? Math.max(...timestamps) : null;

  const symbolsWithoutCandles: string[] = [];
  const symbolsWithoutAuditWindowCandles: string[] = [];
  const symbols = [...rowsBySymbol.keys()].sort().map((symbol): MissedMeaningfulMoveSymbolReport => {
    const symbolRows = rowsBySymbol.get(symbol) ?? [];
    const symbolTimestamps = symbolRows
      .map(rowTimestamp)
      .filter((value): value is number => value !== null);
    const symbolAuditStart = symbolTimestamps.length ? Math.min(...symbolTimestamps) : auditStart;
    const symbolAuditEnd = symbolTimestamps.length ? Math.max(...symbolTimestamps) : auditEnd;
    const candles = loadCandlesForSymbol({
      cacheDirectoryPath,
      warehouseDirectoryPath,
      provider,
      timeframe,
      symbol,
    });
    if (!candles.length) {
      symbolsWithoutCandles.push(symbol);
    }

    const reviewedMoves = movesInAuditWindow({
      symbol,
      candles,
      auditStart: symbolAuditStart,
      auditEnd: symbolAuditEnd,
      paddingMs: auditWindowPaddingMs,
    });
    const largestReviewedMoves = [...reviewedMoves]
      .sort((left, right) => Math.max(Math.abs(right.closeMovePct), right.rangePct) - Math.max(Math.abs(left.closeMovePct), left.rangePct))
      .slice(0, 5);
    if (candles.length && !reviewedMoves.length) {
      symbolsWithoutAuditWindowCandles.push(symbol);
    }

    const candidates = classifyCandidates({
      symbol,
      candles,
      auditStart: symbolAuditStart,
      auditEnd: symbolAuditEnd,
      paddingMs: auditWindowPaddingMs,
    })
      .map((candidate): MissedMeaningfulMoveCandidate => {
        const coverage = classifyCoverage({ candidate, rows: symbolRows, coverageWindowMs });
        return {
          ...candidate,
          coverage,
          severity: severityFor(candidate, coverage),
          nearestPosts: nearestPosts({ candidate, rows: symbolRows, coverageWindowMs }),
        };
      })
      .sort((left, right) => {
        const severityRank = { major: 0, watch: 1, data_quality_only: 2 } as const;
        return severityRank[left.severity] - severityRank[right.severity] || left.timestamp - right.timestamp;
      });

    return {
      symbol,
      candleCount: candles.length,
      reviewedCandleCount: reviewedMoves.length,
      postCount: symbolRows.length,
      firstPostAt: symbolAuditStart,
      lastPostAt: symbolAuditEnd,
      candidateCount: candidates.length,
      coveredCount: candidates.filter((candidate) => candidate.coverage === "covered").length,
      weakCoverageCount: candidates.filter((candidate) => candidate.coverage === "weak_coverage").length,
      missedCount: candidates.filter((candidate) => candidate.coverage === "missed").length,
      majorCount: candidates.filter((candidate) => candidate.severity === "major").length,
      candidates,
      largestReviewedMoves,
    };
  });

  const totals = symbols.reduce(
    (accumulator, symbol) => ({
      symbols: accumulator.symbols + 1,
      candles: accumulator.candles + symbol.candleCount,
      posts: accumulator.posts + symbol.postCount,
      candidates: accumulator.candidates + symbol.candidateCount,
      covered: accumulator.covered + symbol.coveredCount,
      weakCoverage: accumulator.weakCoverage + symbol.weakCoverageCount,
      missed: accumulator.missed + symbol.missedCount,
      major: accumulator.major + symbol.majorCount,
      symbolsWithoutCandles: accumulator.symbolsWithoutCandles,
      symbolsWithoutAuditWindowCandles: accumulator.symbolsWithoutAuditWindowCandles,
    }),
    {
      symbols: 0,
      candles: 0,
      posts: 0,
      candidates: 0,
      covered: 0,
      weakCoverage: 0,
      missed: 0,
      major: 0,
      symbolsWithoutCandles: symbolsWithoutCandles.length,
      symbolsWithoutAuditWindowCandles: symbolsWithoutAuditWindowCandles.length,
    },
  );

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: sourceAuditPaths.length === 1
      ? sourceAuditPaths[0]!
      : `${sourceAuditPaths.length} audit files from ${resolve(options.auditPath)}`,
    sourceAuditPaths,
    cacheDirectoryPath,
    warehouseDirectoryPath: warehouseDirectoryPath ?? null,
    provider,
    timeframe,
    auditWindow: {
      startTimestamp: auditStart,
      endTimestamp: auditEnd,
    },
    totals,
    symbolsWithoutCandles,
    symbolsWithoutAuditWindowCandles,
    symbols: symbols.sort((left, right) => {
      return right.majorCount - left.majorCount || right.missedCount - left.missedCount || right.candidateCount - left.candidateCount;
    }),
  };
}

function renderCandidate(candidate: MissedMeaningfulMoveCandidate): string[] {
  const lines = [
    `- ${candidate.timestampIso} ${candidate.kind}: ${candidate.reason}`,
    `  - candle: open ${formatPrice(candidate.open)}, high ${formatPrice(candidate.high)}, low ${formatPrice(candidate.low)}, close ${formatPrice(candidate.close)}; close move ${formatPct(candidate.closeMovePct)}, range ${formatPct(candidate.rangePct)}`,
    `  - coverage: ${candidate.coverage}; severity: ${candidate.severity}`,
  ];
  if (candidate.nearestPosts.length) {
    lines.push("  - nearest posts:");
    for (const post of candidate.nearestPosts) {
      lines.push(`    - ${post.distanceMinutes}m ${post.title ?? post.operation ?? "post"}: ${post.excerpt}`);
    }
  } else {
    lines.push("  - nearest posts: none within review window");
  }
  return lines;
}

function renderReviewedMove(move: ReviewedCandleMove): string {
  return `- ${move.timestampIso}: close ${formatPrice(move.previousClose)} -> ${formatPrice(move.close)} (${formatPct(move.closeMovePct)}), range ${formatPrice(move.low)}-${formatPrice(move.high)} (${formatPct(move.rangePct)})`;
}

export function renderMissedMeaningfulMoveAuditMarkdown(report: MissedMeaningfulMoveAuditReport): string {
  const lines = [
    "# Missed Meaningful Move Audit",
    "",
    "Operator-only report. It checks cached candles against saved Discord posts so quieter posting rules do not hide real breakouts, support losses, reclaims, or large candle moves.",
    "",
    `Generated: ${report.generatedAt}`,
    `Audit source: ${report.sourceAuditPath}`,
    `Audit files: ${report.sourceAuditPaths.length}`,
    `Candle cache: ${report.cacheDirectoryPath}`,
    `Warehouse: ${report.warehouseDirectoryPath ?? "none"}`,
    `Provider/timeframe: ${report.provider} ${report.timeframe}`,
    "",
    "## Totals",
    "",
    `- Symbols: ${report.totals.symbols}`,
    `- Posted rows reviewed: ${report.totals.posts}`,
    `- Cached candles reviewed: ${report.totals.candles}`,
    `- Meaningful move candidates: ${report.totals.candidates}`,
    `- Covered: ${report.totals.covered}`,
    `- Weak coverage: ${report.totals.weakCoverage}`,
    `- Missed candidates: ${report.totals.missed}`,
    `- Major missed candidates: ${report.totals.major}`,
    `- Symbols without cached candles: ${report.totals.symbolsWithoutCandles}`,
    `- Symbols without candles inside the audited Discord window: ${report.totals.symbolsWithoutAuditWindowCandles}`,
    "",
    "## How To Read This",
    "",
    "- `covered` means a nearby Discord alert told the same basic story.",
    "- `weak_coverage` means there was a nearby post, but it may not have explained the actual move.",
    "- `missed` means no nearby saved Discord post was found for that candle move.",
    "- A candidate is not automatically a bug; it is a candle-backed reason to review whether suppression was too strict.",
    "",
  ];

  const problemSymbols = report.symbols.filter((symbol) => symbol.missedCount || symbol.weakCoverageCount || symbol.majorCount);
  lines.push("## Symbols Needing Review", "");
  if (!problemSymbols.length) {
    lines.push("- none", "");
  } else {
    lines.push("| Symbol | Candidates | Covered | Weak | Missed | Major |", "| --- | ---: | ---: | ---: | ---: | ---: |");
    for (const symbol of problemSymbols) {
      lines.push(`| ${symbol.symbol} | ${symbol.candidateCount} | ${symbol.coveredCount} | ${symbol.weakCoverageCount} | ${symbol.missedCount} | ${symbol.majorCount} |`);
    }
    lines.push("");
  }

  lines.push("## Largest Reviewed 5m Moves", "");
  for (const symbol of report.symbols.slice(0, 12)) {
    if (!symbol.largestReviewedMoves.length) {
      continue;
    }
    lines.push(`### ${symbol.symbol}`, "");
    for (const move of symbol.largestReviewedMoves.slice(0, 3)) {
      lines.push(renderReviewedMove(move));
    }
    lines.push("");
  }

  for (const symbol of problemSymbols.slice(0, 12)) {
    lines.push(`## ${symbol.symbol}`, "");
    const candidates = symbol.candidates.filter((candidate) => candidate.coverage !== "covered").slice(0, 8);
    if (!candidates.length) {
      lines.push("- no uncovered candidates", "");
      continue;
    }
    for (const candidate of candidates) {
      lines.push(...renderCandidate(candidate), "");
    }
  }

  if (report.symbolsWithoutCandles.length) {
    lines.push("## Data Quality", "");
    lines.push(`- Missing cached ${report.provider} ${report.timeframe} candles for: ${report.symbolsWithoutCandles.join(", ")}`);
    lines.push("");
  }

  if (report.symbolsWithoutAuditWindowCandles.length) {
    if (!report.symbolsWithoutCandles.length) {
      lines.push("## Data Quality", "");
    }
    lines.push(`- Cached ${report.provider} ${report.timeframe} candles did not overlap the audited Discord window for: ${report.symbolsWithoutAuditWindowCandles.join(", ")}`);
    lines.push("- Treat `0 missed candidates` as unproven for those symbols until fresher candle cache exists.");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function writeMissedMeaningfulMoveAudit(
  options: WriteMissedMeaningfulMoveAuditOptions,
): MissedMeaningfulMoveAuditReport {
  const report = generateMissedMeaningfulMoveAudit(options);
  mkdirSync(dirname(options.jsonPath), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, renderMissedMeaningfulMoveAuditMarkdown(report), "utf8");
  return report;
}
