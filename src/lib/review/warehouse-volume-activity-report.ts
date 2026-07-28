import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { Candle, CandleProviderName } from "../market-data/candle-types.js";
import {
  buildVolumeActivityContextFromWarehouseCandles,
  type WarehouseVolumeActivityContext,
  type WarehouseVolumeReliability,
} from "../support-resistance/index.js";
import type { VolumeActivityLabel } from "../monitoring/volume-activity.js";

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
  triggerPrice?: number;
};

type CachedCandleEntry = {
  response?: {
    candles?: Candle[];
  };
  candles?: Candle[];
};

export type WarehouseVolumeInteractionKind =
  | "expanding_into_resistance"
  | "activity_pickup_on_reclaim"
  | "fading_while_retesting"
  | "thin_activity_chop"
  | "normal_or_unhelpful"
  | "stale_or_unreliable";

export type WarehouseVolumeActivityReplaySample = {
  symbol: string;
  timestamp: number;
  timestampIso: string;
  title?: string;
  eventType?: string;
  operation?: string;
  label: VolumeActivityLabel;
  reliability: WarehouseVolumeReliability;
  relativeVolumeRatio: number | null;
  currentVolume: number | null;
  baselineAverageVolume: number | null;
  liquidityLabel: WarehouseVolumeActivityContext["liquidityLabel"];
  sessionBucket: WarehouseVolumeActivityContext["sessionBucket"];
  atLevel: WarehouseVolumeActivityContext["atLevel"];
  interactionKind: WarehouseVolumeInteractionKind;
  recommendation: "may_help_existing_alert" | "keep_operator_only";
  reason: string;
  latestCandleTimestamp: number | null;
  latestCandleIso: string | null;
  candleLagMinutes: number | null;
};

export type WarehouseVolumeActivitySymbolReport = {
  symbol: string;
  alertRows: number;
  matchedRows: number;
  unmatchedRows: number;
  reliabilityCounts: Record<WarehouseVolumeReliability, number>;
  labelCounts: Record<VolumeActivityLabel, number>;
  interactionCounts: Record<WarehouseVolumeInteractionKind, number>;
  averageRelativeVolumeRatio: number | null;
  wouldHelpCount: number;
  shouldStayHiddenCount: number;
  operatorOnlyReasons: string[];
  samples: WarehouseVolumeActivityReplaySample[];
};

export type WarehouseVolumeActivityReport = {
  generatedAt: string;
  sourceAuditPath: string;
  sourceAuditPaths: string[];
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  maxTimestampDriftMinutes: number;
  totals: {
    alertRows: number;
    matchedRows: number;
    unmatchedRows: number;
    symbolsWithMatches: number;
    wouldHelpCount: number;
    shouldStayHiddenCount: number;
    reliabilityCounts: Record<WarehouseVolumeReliability, number>;
    labelCounts: Record<VolumeActivityLabel, number>;
    interactionCounts: Record<WarehouseVolumeInteractionKind, number>;
  };
  symbols: WarehouseVolumeActivitySymbolReport[];
  examples: {
    mayHelpExistingAlert: WarehouseVolumeActivityReplaySample[];
    keepOperatorOnly: WarehouseVolumeActivityReplaySample[];
  };
};

export type GenerateWarehouseVolumeActivityReportOptions = {
  auditPath: string;
  cacheDirectoryPath?: string;
  provider?: CandleProviderName;
  maxTimestampDriftMinutes?: number;
};

export type WriteWarehouseVolumeActivityReportOptions = GenerateWarehouseVolumeActivityReportOptions & {
  jsonPath: string;
  markdownPath: string;
};

const LABELS: VolumeActivityLabel[] = ["strong", "expanding", "normal", "thin", "fading", "unknown"];
const RELIABILITIES: WarehouseVolumeReliability[] = ["reliable", "watch", "unreliable"];
const INTERACTIONS: WarehouseVolumeInteractionKind[] = [
  "expanding_into_resistance",
  "activity_pickup_on_reclaim",
  "fading_while_retesting",
  "thin_activity_chop",
  "normal_or_unhelpful",
  "stale_or_unreliable",
];
const DEFAULT_CACHE_DIRECTORY = join(process.cwd(), ".validation-cache", "candles");
const DEFAULT_MAX_TIMESTAMP_DRIFT_MINUTES = 90;

function emptyLabelCounts(): Record<VolumeActivityLabel, number> {
  return LABELS.reduce((counts, label) => {
    counts[label] = 0;
    return counts;
  }, {} as Record<VolumeActivityLabel, number>);
}

function emptyReliabilityCounts(): Record<WarehouseVolumeReliability, number> {
  return RELIABILITIES.reduce((counts, reliability) => {
    counts[reliability] = 0;
    return counts;
  }, {} as Record<WarehouseVolumeReliability, number>);
}

function emptyInteractionCounts(): Record<WarehouseVolumeInteractionKind, number> {
  return INTERACTIONS.reduce((counts, interaction) => {
    counts[interaction] = 0;
    return counts;
  }, {} as Record<WarehouseVolumeInteractionKind, number>);
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

function symbolOf(row: AuditRow): string | null {
  const symbol = row.symbol?.trim().toUpperCase();
  return symbol ? symbol : null;
}

function isAlertRow(row: AuditRow): boolean {
  return (
    (row.status === "posted" || row.status === "success") &&
    row.operation === "post_alert" &&
    symbolOf(row) !== null &&
    rowTimestamp(row) !== null
  );
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

function parseCacheEntry(path: string): CachedCandleEntry | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CachedCandleEntry;
  } catch {
    return null;
  }
}

function readWarehouseCandles(path: string): Candle[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Candle];
      } catch {
        return [];
      }
    })
    .filter((candle) =>
      [candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ),
    );
}

function extractCandles(entry: CachedCandleEntry | null): Candle[] {
  const candles = entry?.response?.candles ?? entry?.candles ?? [];
  return candles.filter((candle) =>
    [candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ),
  );
}

function loadFiveMinuteCandles(params: {
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  symbol: string;
}): Candle[] {
  const directoryPath = join(params.cacheDirectoryPath, params.provider, params.symbol, "5m");
  const byTimestamp = new Map<number, Candle>();
  for (const path of walkJsonFiles(directoryPath)) {
    for (const candle of extractCandles(parseCacheEntry(path))) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  for (const path of walkJsonlFiles(directoryPath)) {
    for (const candle of readWarehouseCandles(path)) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function latestCandleBefore(candles: Candle[], timestamp: number): Candle | null {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index]!;
    if (candle.timestamp <= timestamp) {
      return candle;
    }
  }
  return null;
}

function shouldHelp(context: WarehouseVolumeActivityContext): boolean {
  return (
    context.reliability === "reliable" &&
    ["strong", "expanding", "fading"].includes(context.label) &&
    context.liquidityLabel !== "thin" &&
    context.label !== "unknown"
  );
}

function textOf(row: AuditRow): string {
  return [row.title, row.body, row.bodyPreview, row.eventType].filter(Boolean).join(" ").toLowerCase();
}

function isExpandingLabel(label: VolumeActivityLabel): boolean {
  return label === "strong" || label === "expanding";
}

function classifyInteraction(params: {
  row: AuditRow;
  context: WarehouseVolumeActivityContext;
  stale: boolean;
}): WarehouseVolumeInteractionKind {
  if (params.stale || params.context.reliability !== "reliable") {
    return "stale_or_unreliable";
  }
  const text = textOf(params.row);
  const atResistance = params.context.atLevel.side === "resistance" || /\bresistance\b|breakout/.test(text);
  const atSupport = params.context.atLevel.side === "support" || /\bsupport\b|level touch|breakdown/.test(text);
  if (isExpandingLabel(params.context.label) && /reclaim/.test(text)) {
    return "activity_pickup_on_reclaim";
  }
  if (isExpandingLabel(params.context.label) && atResistance) {
    return "expanding_into_resistance";
  }
  if (params.context.label === "fading" && atSupport) {
    return "fading_while_retesting";
  }
  if (
    (params.context.label === "thin" || params.context.liquidityLabel === "thin") &&
    /compression|level touch|range|support|resistance|breakout|breakdown/.test(text)
  ) {
    return "thin_activity_chop";
  }
  return "normal_or_unhelpful";
}

function shouldHelpInteraction(interactionKind: WarehouseVolumeInteractionKind, context: WarehouseVolumeActivityContext): boolean {
  return (
    context.reliability === "reliable" &&
    context.liquidityLabel !== "thin" &&
    ["expanding_into_resistance", "activity_pickup_on_reclaim", "fading_while_retesting"].includes(interactionKind)
  );
}

function reasonFor(
  context: WarehouseVolumeActivityContext,
  stale: boolean,
  interactionKind: WarehouseVolumeInteractionKind,
): string {
  if (stale) {
    return "nearest cached 5m candle is too far from the alert timestamp";
  }
  if (context.reliability !== "reliable") {
    return `volume reliability is ${context.reliability}`;
  }
  if (context.liquidityLabel === "thin") {
    return "dollar-volume is thin, so the read should stay operator-only";
  }
  if (interactionKind === "expanding_into_resistance") {
    return "activity expansion lines up with a resistance or breakout test";
  }
  if (interactionKind === "activity_pickup_on_reclaim") {
    return "activity pickup lines up with a reclaim attempt";
  }
  if (interactionKind === "fading_while_retesting") {
    return "activity fade lines up with a level retest";
  }
  if (interactionKind === "thin_activity_chop") {
    return "thin activity around a level should stay operator-only to avoid noisy wording";
  }
  if (context.label === "normal" || context.label === "thin" || context.label === "unknown") {
    return `activity label ${context.label} does not add enough meaning to the existing alert`;
  }
  return `${context.label} activity may add context to the existing alert`;
}

function buildSample(params: {
  row: AuditRow;
  context: WarehouseVolumeActivityContext;
  latestCandle: Candle | null;
  maxTimestampDriftMinutes: number;
}): WarehouseVolumeActivityReplaySample {
  const timestamp = rowTimestamp(params.row)!;
  const candleLagMinutes = params.latestCandle === null
    ? null
    : Number(((timestamp - params.latestCandle.timestamp) / 60_000).toFixed(1));
  const stale = candleLagMinutes === null || candleLagMinutes > params.maxTimestampDriftMinutes;
  const interactionKind = classifyInteraction({
    row: params.row,
    context: params.context,
    stale,
  });
  const recommendation = !stale && shouldHelp(params.context) && shouldHelpInteraction(interactionKind, params.context)
    ? "may_help_existing_alert"
    : "keep_operator_only";
  return {
    symbol: symbolOf(params.row)!,
    timestamp,
    timestampIso: new Date(timestamp).toISOString(),
    title: params.row.title,
    eventType: params.row.eventType,
    operation: params.row.operation,
    label: params.context.label,
    reliability: params.context.reliability,
    relativeVolumeRatio: params.context.relativeVolumeRatio,
    currentVolume: params.context.currentVolume,
    baselineAverageVolume: params.context.baselineAverageVolume,
    liquidityLabel: params.context.liquidityLabel,
    sessionBucket: params.context.sessionBucket,
    atLevel: params.context.atLevel,
    interactionKind,
    recommendation,
    reason: reasonFor(params.context, stale, interactionKind),
    latestCandleTimestamp: params.latestCandle?.timestamp ?? null,
    latestCandleIso: params.latestCandle ? new Date(params.latestCandle.timestamp).toISOString() : null,
    candleLagMinutes,
  };
}

function symbolReport(symbol: string, rows: AuditRow[], samples: WarehouseVolumeActivityReplaySample[]): WarehouseVolumeActivitySymbolReport {
  const reliabilityCounts = emptyReliabilityCounts();
  const labelCounts = emptyLabelCounts();
  const interactionCounts = emptyInteractionCounts();
  for (const sample of samples) {
    reliabilityCounts[sample.reliability] += 1;
    labelCounts[sample.label] += 1;
    interactionCounts[sample.interactionKind] += 1;
  }
  const ratios = samples
    .map((sample) => sample.relativeVolumeRatio)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const operatorOnlyReasons = [...new Set(
    samples
      .filter((sample) => sample.recommendation === "keep_operator_only")
      .map((sample) => sample.reason),
  )].slice(0, 10);
  return {
    symbol,
    alertRows: rows.length,
    matchedRows: samples.length,
    unmatchedRows: rows.length - samples.length,
    reliabilityCounts,
    labelCounts,
    interactionCounts,
    averageRelativeVolumeRatio:
      ratios.length > 0 ? Number((ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length).toFixed(3)) : null,
    wouldHelpCount: samples.filter((sample) => sample.recommendation === "may_help_existing_alert").length,
    shouldStayHiddenCount: samples.filter((sample) => sample.recommendation === "keep_operator_only").length,
    operatorOnlyReasons,
    samples,
  };
}

export function generateWarehouseVolumeActivityReport(
  options: GenerateWarehouseVolumeActivityReportOptions,
): WarehouseVolumeActivityReport {
  const sourceAuditPaths = resolveAuditPaths(options.auditPath);
  const cacheDirectoryPath = options.cacheDirectoryPath ?? DEFAULT_CACHE_DIRECTORY;
  const provider = options.provider ?? "ibkr";
  const maxTimestampDriftMinutes = options.maxTimestampDriftMinutes ?? DEFAULT_MAX_TIMESTAMP_DRIFT_MINUTES;
  const rows = sourceAuditPaths.flatMap((path) => readRows(path)).filter(isAlertRow);
  const rowsBySymbol = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const symbol = symbolOf(row)!;
    rowsBySymbol.set(symbol, [...(rowsBySymbol.get(symbol) ?? []), row]);
  }

  const symbols = [...rowsBySymbol.entries()].map(([symbol, symbolRows]) => {
    const candles = loadFiveMinuteCandles({ cacheDirectoryPath, provider, symbol });
    const samples = symbolRows.flatMap((row) => {
      const timestamp = rowTimestamp(row)!;
      const latestCandle = latestCandleBefore(candles, timestamp);
      if (!latestCandle) {
        return [];
      }
      const context = buildVolumeActivityContextFromWarehouseCandles({
        symbol,
        provider,
        candles,
        asOfTimestamp: timestamp,
        currentPrice: row.triggerPrice ?? latestCandle.close,
      });
      return [buildSample({
        row,
        context,
        latestCandle,
        maxTimestampDriftMinutes,
      })];
    });
    return symbolReport(symbol, symbolRows, samples);
  }).sort((left, right) =>
    right.wouldHelpCount - left.wouldHelpCount ||
    right.shouldStayHiddenCount - left.shouldStayHiddenCount ||
    left.symbol.localeCompare(right.symbol),
  );

  const reliabilityCounts = emptyReliabilityCounts();
  const labelCounts = emptyLabelCounts();
  const interactionCounts = emptyInteractionCounts();
  const allSamples = symbols.flatMap((symbol) => symbol.samples);
  for (const sample of allSamples) {
    reliabilityCounts[sample.reliability] += 1;
    labelCounts[sample.label] += 1;
    interactionCounts[sample.interactionKind] += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: sourceAuditPaths.length === 1
      ? sourceAuditPaths[0]!
      : `${sourceAuditPaths.length} audit files from ${resolve(options.auditPath)}`,
    sourceAuditPaths,
    cacheDirectoryPath,
    provider,
    maxTimestampDriftMinutes,
    totals: {
      alertRows: rows.length,
      matchedRows: symbols.reduce((sum, symbol) => sum + symbol.matchedRows, 0),
      unmatchedRows: symbols.reduce((sum, symbol) => sum + symbol.unmatchedRows, 0),
      symbolsWithMatches: symbols.filter((symbol) => symbol.matchedRows > 0).length,
      wouldHelpCount: symbols.reduce((sum, symbol) => sum + symbol.wouldHelpCount, 0),
      shouldStayHiddenCount: symbols.reduce((sum, symbol) => sum + symbol.shouldStayHiddenCount, 0),
      reliabilityCounts,
      labelCounts,
      interactionCounts,
    },
    symbols,
    examples: {
      mayHelpExistingAlert: allSamples
        .filter((sample) => sample.recommendation === "may_help_existing_alert")
        .sort((left, right) => (right.relativeVolumeRatio ?? 0) - (left.relativeVolumeRatio ?? 0))
        .slice(0, 20),
      keepOperatorOnly: allSamples
        .filter((sample) => sample.recommendation === "keep_operator_only")
        .slice(0, 20),
    },
  };
}

export function formatWarehouseVolumeActivityReport(report: WarehouseVolumeActivityReport): string {
  const lines = [
    "# Warehouse Volume Activity Replay Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Source audit: ${report.sourceAuditPath}`,
    `Source audit files: ${report.sourceAuditPaths.length}`,
    `Cache: ${report.cacheDirectoryPath}`,
    `Provider: ${report.provider}`,
    `Max candle drift: ${report.maxTimestampDriftMinutes} minutes`,
    "",
    "## Totals",
    "",
    `- alert rows: ${report.totals.alertRows}`,
    `- matched rows: ${report.totals.matchedRows}`,
    `- unmatched rows: ${report.totals.unmatchedRows}`,
    `- symbols with matches: ${report.totals.symbolsWithMatches}`,
    `- volume context that may help existing alerts: ${report.totals.wouldHelpCount}`,
    `- volume context to hide/operator-only: ${report.totals.shouldStayHiddenCount}`,
    `- reliability counts: ${JSON.stringify(report.totals.reliabilityCounts)}`,
    `- label counts: ${JSON.stringify(report.totals.labelCounts)}`,
    `- interaction counts: ${JSON.stringify(report.totals.interactionCounts)}`,
    "",
    "## Volume Context That May Help",
    "",
  ];

  for (const sample of report.examples.mayHelpExistingAlert) {
    lines.push(
      `- ${sample.symbol} ${sample.timestampIso}: ${sample.interactionKind}, ${sample.label} (${sample.relativeVolumeRatio ?? "n/a"}x), ${sample.liquidityLabel}; ${sample.title ?? sample.eventType ?? "alert"} - ${sample.reason}`,
    );
  }
  if (report.examples.mayHelpExistingAlert.length === 0) {
    lines.push("- none found in this replay; keep Discord volume enrichment quiet until more evidence appears");
  }

  lines.push("", "## Volume Context To Hide / Keep Operator-Only", "");
  for (const sample of report.examples.keepOperatorOnly) {
    lines.push(
      `- ${sample.symbol} ${sample.timestampIso}: ${sample.interactionKind}, ${sample.label}/${sample.reliability}, ${sample.liquidityLabel}; ${sample.reason}`,
    );
  }
  if (report.examples.keepOperatorOnly.length === 0) {
    lines.push("- none");
  }

  lines.push("", "## Per Symbol", "");
  for (const symbol of report.symbols.slice(0, 120)) {
    lines.push(
      `- ${symbol.symbol}: alerts ${symbol.alertRows}, matched ${symbol.matchedRows}, unmatched ${symbol.unmatchedRows}, may-help ${symbol.wouldHelpCount}, hide ${symbol.shouldStayHiddenCount}, avg RVOL ${symbol.averageRelativeVolumeRatio ?? "n/a"}, labels ${JSON.stringify(symbol.labelCounts)}, interactions ${JSON.stringify(symbol.interactionCounts)}`,
    );
  }
  if (report.symbols.length > 120) {
    lines.push(`- ... ${report.symbols.length - 120} additional symbols omitted from markdown`);
  }

  return `${lines.join("\n")}\n`;
}

export function writeWarehouseVolumeActivityReport(
  options: WriteWarehouseVolumeActivityReportOptions,
): WarehouseVolumeActivityReport {
  const report = generateWarehouseVolumeActivityReport(options);
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatWarehouseVolumeActivityReport(report), "utf8");
  return report;
}
