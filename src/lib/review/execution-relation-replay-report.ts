import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  buildExecutionLevelRelations,
  buildSupportResistanceContextFromCandles,
  type Candle,
  type CandleFetchTimeframe,
  type CandleProviderName,
  type ExecutionLevelRelations,
  type FinalLevelZone,
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
  triggerPrice?: number;
};

type CachedCandleEntry = {
  response?: {
    candles?: Candle[];
  };
  candles?: Candle[];
};

export type ExecutionRelationReplayRecommendation =
  | "already_explained"
  | "useful_context_available"
  | "needs_candle_evidence";

export type ExecutionRelationReplaySample = {
  symbol: string;
  timestamp: number;
  timestampIso: string;
  sessionDate: string | null;
  operation?: string;
  title?: string;
  eventType?: string;
  price: number | null;
  recommendation: ExecutionRelationReplayRecommendation;
  reason: string;
  candles: {
    daily: number;
    fourHour: number;
    fiveMinute: number;
  };
  nearestSupportBelow: LevelSummary | null;
  nearestResistanceAbove: LevelSummary | null;
  nearestResistanceBelow: LevelSummary | null;
  roomAbovePct: number | null;
  roomBelowPct: number | null;
  stackedResistanceAboveCount: number | null;
  stackedSupportBelowCount: number | null;
  occurredInOpenAir: boolean | null;
  nearestReferenceLabel: string | null;
  nearestReferencePrice: number | null;
  dynamicContext: {
    vwapDistancePct: number | null;
    ema9DistancePct: number | null;
    ema20DistancePct: number | null;
  };
  marketStructure: {
    state: string | null;
    trend: string | null;
    confidence: string | null;
  };
  excerpt: string;
};

export type LevelSummary = {
  price: number;
  zoneLow: number;
  zoneHigh: number;
  strengthLabel: FinalLevelZone["strengthLabel"];
  timeframeSources: string[];
};

export type ExecutionRelationReplaySymbolReport = {
  symbol: string;
  postsReviewed: number;
  validRelationSamples: number;
  needsCandleEvidenceCount: number;
  usefulContextCount: number;
  alreadyExplainedCount: number;
  openAirCount: number;
  missingForwardResistanceCount: number;
  samples: ExecutionRelationReplaySample[];
};

export type ExecutionRelationReplayReport = {
  generatedAt: string;
  sourceAuditPath: string;
  sourceAuditPaths: string[];
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  totals: {
    postsReviewed: number;
    validRelationSamples: number;
    needsCandleEvidenceCount: number;
    usefulContextCount: number;
    alreadyExplainedCount: number;
    openAirCount: number;
    missingForwardResistanceCount: number;
    symbolsReviewed: number;
  };
  symbols: ExecutionRelationReplaySymbolReport[];
  examples: {
    usefulContextAvailable: ExecutionRelationReplaySample[];
    needsCandleEvidence: ExecutionRelationReplaySample[];
    noForwardResistance: ExecutionRelationReplaySample[];
  };
};

export type GenerateExecutionRelationReplayReportOptions = {
  auditPath: string;
  cacheDirectoryPath?: string;
  provider?: CandleProviderName;
  maxSymbols?: number;
};

export type WriteExecutionRelationReplayReportOptions = GenerateExecutionRelationReplayReportOptions & {
  jsonPath: string;
  markdownPath: string;
};

const DEFAULT_CACHE_DIRECTORY = ".validation-cache/candles";

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
  return symbol || null;
}

function isPosted(row: AuditRow): boolean {
  return (
    (row.status === "posted" || row.status === "success") &&
    ["post_alert", "post_level_snapshot", "post_level_extension"].includes(String(row.operation)) &&
    symbolOf(row) !== null &&
    rowTimestamp(row) !== null
  );
}

function textOf(row: AuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function excerpt(row: AuditRow, maxLength = 260): string {
  const text = textOf(row);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function extractPrice(row: AuditRow): number | null {
  if (typeof row.triggerPrice === "number" && Number.isFinite(row.triggerPrice) && row.triggerPrice > 0) {
    return row.triggerPrice;
  }
  const text = textOf(row);
  const patterns = [
    /\bPrice:\s*([0-9]+(?:\.[0-9]+)?)/i,
    /\bTriggered near:\s*([0-9]+(?:\.[0-9]+)?)/i,
    /\btriggered near\s*([0-9]+(?:\.[0-9]+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1] ? Number(match[1]) : NaN;
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function sessionDate(timestamp: number): string {
  return newYorkDateFormatter.format(new Date(timestamp));
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

function extractCandles(entry: CachedCandleEntry | null): Candle[] {
  const candles = entry?.response?.candles ?? entry?.candles ?? [];
  return candles.filter((candle) =>
    [candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ),
  );
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

function parseCacheEntry(path: string): CachedCandleEntry | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CachedCandleEntry;
  } catch {
    return null;
  }
}

function loadCandles(params: {
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  asOfTimestamp: number;
}): Candle[] {
  const directory = join(params.cacheDirectoryPath, params.provider, params.symbol, params.timeframe);
  const byTimestamp = new Map<number, Candle>();
  for (const file of walkJsonFiles(directory)) {
    for (const candle of extractCandles(parseCacheEntry(file))) {
      if (candle.timestamp <= params.asOfTimestamp) {
        byTimestamp.set(candle.timestamp, candle);
      }
    }
  }
  for (const file of walkJsonlFiles(directory)) {
    for (const candle of readWarehouseCandles(file)) {
      if (candle.timestamp <= params.asOfTimestamp) {
        byTimestamp.set(candle.timestamp, candle);
      }
    }
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function levelSummary(level: FinalLevelZone | null): LevelSummary | null {
  return level
    ? {
        price: level.representativePrice,
        zoneLow: level.zoneLow,
        zoneHigh: level.zoneHigh,
        strengthLabel: level.strengthLabel,
        timeframeSources: level.timeframeSources,
      }
    : null;
}

function price(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function pct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${value.toFixed(1)}%`;
}

function postedTextHasRelationStory(row: AuditRow): boolean {
  const text = textOf(row).toLowerCase();
  return (
    (text.includes("support") && text.includes("resistance")) ||
    text.includes("closest levels to watch") ||
    text.includes("key levels") ||
    text.includes("more support and resistance")
  );
}

function recommendationFor(row: AuditRow, relations: ExecutionLevelRelations | null, error?: string): {
  recommendation: ExecutionRelationReplayRecommendation;
  reason: string;
} {
  if (!relations) {
    return {
      recommendation: "needs_candle_evidence",
      reason: error ?? "missing candle evidence or price prevented relation replay",
    };
  }
  if (!relations.nearestResistanceAbove) {
    return {
      recommendation: "useful_context_available",
      reason: "no forward resistance surfaced in replay; audit should verify whether this is real or cache-limited",
    };
  }
  if (postedTextHasRelationStory(row)) {
    return {
      recommendation: "already_explained",
      reason: "saved post already includes nearby level context",
    };
  }
  return {
    recommendation: "useful_context_available",
    reason: "nearest support/resistance and room facts were available for the saved post",
  };
}

async function buildSample(params: {
  row: AuditRow;
  cacheDirectoryPath: string;
  provider: CandleProviderName;
}): Promise<ExecutionRelationReplaySample> {
  const symbol = symbolOf(params.row)!;
  const timestamp = rowTimestamp(params.row)!;
  const rowPrice = extractPrice(params.row);
  const session = sessionDate(timestamp);
  const daily = loadCandles({ ...params, symbol, timeframe: "daily", asOfTimestamp: timestamp });
  const fourHour = loadCandles({ ...params, symbol, timeframe: "4h", asOfTimestamp: timestamp });
  const fiveMinute = loadCandles({ ...params, symbol, timeframe: "5m", asOfTimestamp: timestamp });
  let relations: ExecutionLevelRelations | null = null;
  let error: string | undefined;
  let dynamicContext: ExecutionRelationReplaySample["dynamicContext"] = {
    vwapDistancePct: null,
    ema9DistancePct: null,
    ema20DistancePct: null,
  };
  let marketStructure: ExecutionRelationReplaySample["marketStructure"] = {
    state: null,
    trend: null,
    confidence: null,
  };

  if (rowPrice === null) {
    error = "no usable price in saved audit row";
  } else if (daily.length === 0 || fourHour.length === 0) {
    error = "missing daily or 4h candles for support/resistance replay";
  } else {
    try {
      const context = await buildSupportResistanceContextFromCandles({
        symbol,
        sessionDate: session,
        asOfTimestamp: timestamp,
        currentPrice: rowPrice,
        candlesByTimeframe: {
          daily,
          "4h": fourHour,
          "5m": fiveMinute,
        },
      });
      relations = buildExecutionLevelRelations({
        price: rowPrice,
        levels: context.levels,
        referenceLevels: context.referenceLevels,
      });
      dynamicContext = {
        vwapDistancePct: context.dynamicLevels.priceContext?.priceVsVwapPct ?? null,
        ema9DistancePct: context.dynamicLevels.priceContext?.priceVsEma9Pct ?? null,
        ema20DistancePct: context.dynamicLevels.priceContext?.priceVsEma20Pct ?? null,
      };
      marketStructure = {
        state: context.marketStructure.state,
        trend: context.marketStructure.trend.direction,
        confidence: context.marketStructure.confidence.label,
      };
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  const verdict = recommendationFor(params.row, relations, error);
  return {
    symbol,
    timestamp,
    timestampIso: new Date(timestamp).toISOString(),
    sessionDate: session,
    operation: params.row.operation,
    title: params.row.title,
    eventType: params.row.eventType,
    price: rowPrice,
    recommendation: verdict.recommendation,
    reason: verdict.reason,
    candles: {
      daily: daily.length,
      fourHour: fourHour.length,
      fiveMinute: fiveMinute.length,
    },
    nearestSupportBelow: levelSummary(relations?.nearestSupportBelow ?? null),
    nearestResistanceAbove: levelSummary(relations?.nearestResistanceAbove ?? null),
    nearestResistanceBelow: levelSummary(relations?.nearestResistanceBelow ?? null),
    roomAbovePct: relations?.roomAbovePct ?? null,
    roomBelowPct: relations?.roomBelowPct ?? null,
    stackedResistanceAboveCount: relations?.stackedResistanceAboveCount ?? null,
    stackedSupportBelowCount: relations?.stackedSupportBelowCount ?? null,
    occurredInOpenAir: relations?.occurredInOpenAir ?? null,
    nearestReferenceLabel: relations?.nearestReference?.label ?? null,
    nearestReferencePrice: relations?.nearestReference?.price ?? null,
    dynamicContext,
    marketStructure,
    excerpt: excerpt(params.row),
  };
}

function buildSymbolReport(symbol: string, samples: ExecutionRelationReplaySample[]): ExecutionRelationReplaySymbolReport {
  return {
    symbol,
    postsReviewed: samples.length,
    validRelationSamples: samples.filter((sample) => sample.recommendation !== "needs_candle_evidence").length,
    needsCandleEvidenceCount: samples.filter((sample) => sample.recommendation === "needs_candle_evidence").length,
    usefulContextCount: samples.filter((sample) => sample.recommendation === "useful_context_available").length,
    alreadyExplainedCount: samples.filter((sample) => sample.recommendation === "already_explained").length,
    openAirCount: samples.filter((sample) => sample.occurredInOpenAir).length,
    missingForwardResistanceCount: samples.filter((sample) =>
      sample.recommendation !== "needs_candle_evidence" && sample.nearestResistanceAbove === null,
    ).length,
    samples,
  };
}

export async function generateExecutionRelationReplayReport(
  options: GenerateExecutionRelationReplayReportOptions,
): Promise<ExecutionRelationReplayReport> {
  const sourceAuditPaths = resolveAuditPaths(options.auditPath);
  const cacheDirectoryPath = options.cacheDirectoryPath ?? DEFAULT_CACHE_DIRECTORY;
  const provider = options.provider ?? "ibkr";
  const rows = sourceAuditPaths.flatMap((path) => readRows(path)).filter(isPosted);
  const bySymbol = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const symbol = symbolOf(row)!;
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), row]);
  }
  const symbols: ExecutionRelationReplaySymbolReport[] = [];
  for (const symbol of [...bySymbol.keys()].sort().slice(0, options.maxSymbols ?? Number.POSITIVE_INFINITY)) {
    const samples = [];
    for (const row of bySymbol.get(symbol) ?? []) {
      samples.push(await buildSample({ row, cacheDirectoryPath, provider }));
    }
    symbols.push(buildSymbolReport(symbol, samples));
  }
  symbols.sort((left, right) =>
    right.usefulContextCount - left.usefulContextCount ||
    right.needsCandleEvidenceCount - left.needsCandleEvidenceCount ||
    left.symbol.localeCompare(right.symbol),
  );
  const allSamples = symbols.flatMap((symbol) => symbol.samples);
  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: sourceAuditPaths.length === 1
      ? sourceAuditPaths[0]!
      : `${sourceAuditPaths.length} audit files from ${resolve(options.auditPath)}`,
    sourceAuditPaths,
    cacheDirectoryPath,
    provider,
    totals: {
      postsReviewed: allSamples.length,
      validRelationSamples: allSamples.filter((sample) => sample.recommendation !== "needs_candle_evidence").length,
      needsCandleEvidenceCount: allSamples.filter((sample) => sample.recommendation === "needs_candle_evidence").length,
      usefulContextCount: allSamples.filter((sample) => sample.recommendation === "useful_context_available").length,
      alreadyExplainedCount: allSamples.filter((sample) => sample.recommendation === "already_explained").length,
      openAirCount: allSamples.filter((sample) => sample.occurredInOpenAir).length,
      missingForwardResistanceCount: allSamples.filter((sample) =>
        sample.recommendation !== "needs_candle_evidence" && sample.nearestResistanceAbove === null,
      ).length,
      symbolsReviewed: symbols.length,
    },
    symbols,
    examples: {
      usefulContextAvailable: allSamples
        .filter((sample) => sample.recommendation === "useful_context_available")
        .slice(0, 25),
      needsCandleEvidence: allSamples
        .filter((sample) => sample.recommendation === "needs_candle_evidence")
        .slice(0, 25),
      noForwardResistance: allSamples
        .filter((sample) => sample.recommendation !== "needs_candle_evidence" && sample.nearestResistanceAbove === null)
        .slice(0, 25),
    },
  };
}

export function formatExecutionRelationReplayReport(report: ExecutionRelationReplayReport): string {
  const lines = [
    "# Execution Relation Replay Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Source audit: ${report.sourceAuditPath}`,
    `Source audit files: ${report.sourceAuditPaths.length}`,
    `Cache: ${report.cacheDirectoryPath}`,
    `Provider: ${report.provider}`,
    "",
    "## Totals",
    "",
    `- posts reviewed: ${report.totals.postsReviewed}`,
    `- valid relation samples: ${report.totals.validRelationSamples}`,
    `- needs candle evidence: ${report.totals.needsCandleEvidenceCount}`,
    `- useful context available: ${report.totals.usefulContextCount}`,
    `- already explained: ${report.totals.alreadyExplainedCount}`,
    `- open-air samples: ${report.totals.openAirCount}`,
    `- missing forward resistance samples: ${report.totals.missingForwardResistanceCount}`,
    `- symbols reviewed: ${report.totals.symbolsReviewed}`,
    "",
    "## Useful Context Candidates",
    "",
  ];

  for (const sample of report.examples.usefulContextAvailable) {
    lines.push(
      `- ${sample.symbol} ${sample.timestampIso} ${sample.title ?? sample.operation ?? "post"}: price ${price(sample.price)}, support ${price(sample.nearestSupportBelow?.price)} (${pct(sample.roomBelowPct)}), resistance ${price(sample.nearestResistanceAbove?.price)} (${pct(sample.roomAbovePct)}) - ${sample.reason}`,
    );
  }
  if (report.examples.usefulContextAvailable.length === 0) {
    lines.push("- none");
  }

  lines.push("", "## Needs Candle Evidence", "");
  for (const sample of report.examples.needsCandleEvidence) {
    lines.push(
      `- ${sample.symbol} ${sample.timestampIso}: ${sample.reason}; candles D/4h/5m ${sample.candles.daily}/${sample.candles.fourHour}/${sample.candles.fiveMinute}; ${sample.excerpt}`,
    );
  }
  if (report.examples.needsCandleEvidence.length === 0) {
    lines.push("- none");
  }

  lines.push("", "## Per Symbol", "");
  for (const symbol of report.symbols.slice(0, 120)) {
    lines.push(
      `- ${symbol.symbol}: posts ${symbol.postsReviewed}, valid ${symbol.validRelationSamples}, useful ${symbol.usefulContextCount}, explained ${symbol.alreadyExplainedCount}, needs evidence ${symbol.needsCandleEvidenceCount}, open-air ${symbol.openAirCount}, no forward resistance ${symbol.missingForwardResistanceCount}`,
    );
  }
  if (report.symbols.length > 120) {
    lines.push(`- ... ${report.symbols.length - 120} additional symbols omitted from markdown`);
  }

  return `${lines.join("\n")}\n`;
}

export async function writeExecutionRelationReplayReport(
  options: WriteExecutionRelationReplayReportOptions,
): Promise<ExecutionRelationReplayReport> {
  const report = await generateExecutionRelationReplayReport(options);
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatExecutionRelationReplayReport(report), "utf8");
  return report;
}
