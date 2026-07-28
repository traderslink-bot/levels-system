import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  buildDynamicLevelsFromCandles,
  buildReferenceLevels,
  type Candle,
  type CandleFetchTimeframe,
  type CandleProviderName,
  type DynamicLevelsFromCandles,
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
  triggerPrice?: number;
};

type CachedCandleEntry = {
  response?: {
    candles?: Candle[];
  };
  candles?: Candle[];
};

export type DynamicReferenceCalibrationSample = {
  symbol: string;
  timestamp: number;
  timestampIso: string;
  price: number | null;
  title?: string;
  operation?: string;
  openingRange: {
    high: number | null;
    low: number | null;
    state: "above" | "inside" | "below" | "unavailable";
  };
  dynamicLevels: {
    vwap: number | null;
    ema9: number | null;
    ema20: number | null;
    priceVsVwapPct: number | null;
    priceVsEma9Pct: number | null;
    priceVsEma20Pct: number | null;
  };
  diagnostics: string[];
};

export type DynamicReferenceTrust = "trusted" | "watch" | "unproven" | "broken";

export type DynamicReferenceCalibrationSymbolReport = {
  symbol: string;
  postsReviewed: number;
  dailyCandles: number;
  fiveMinuteCandles: number;
  openingRangeAvailableCount: number;
  dynamicAvailableCount: number;
  aboveOpeningRangeCount: number;
  insideOpeningRangeCount: number;
  belowOpeningRangeCount: number;
  aboveVwapCount: number;
  belowVwapCount: number;
  stretchedFromVwapCount: number;
  openingRangeTrust: DynamicReferenceTrust;
  dynamicLevelTrust: DynamicReferenceTrust;
  overallTrust: DynamicReferenceTrust;
  trustReasons: string[];
  diagnosticReasons: string[];
  samples: DynamicReferenceCalibrationSample[];
};

export type DynamicReferenceCalibrationReport = {
  generatedAt: string;
  sourceAuditPath: string;
  sourceAuditPaths: string[];
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  totals: {
    symbols: number;
    postsReviewed: number;
    openingRangeAvailable: number;
    dynamicAvailable: number;
    stretchedFromVwap: number;
    symbolsWithoutDynamicEvidence: number;
    symbolsWithoutOpeningRangeEvidence: number;
    trustedSymbols: number;
    watchSymbols: number;
    unprovenSymbols: number;
    brokenSymbols: number;
  };
  symbols: DynamicReferenceCalibrationSymbolReport[];
  examples: {
    openingRangeAvailable: DynamicReferenceCalibrationSample[];
    dynamicAvailable: DynamicReferenceCalibrationSample[];
    stretchedFromVwap: DynamicReferenceCalibrationSample[];
    missingEvidence: DynamicReferenceCalibrationSample[];
  };
};

export type DynamicReferenceCalibrationGateResult = {
  status: "pass" | "review" | "fail";
  generatedAt: string;
  sourceAuditPath: string;
  sourceAuditPaths: string[];
  thresholds: {
    maxBrokenSymbols: number;
    maxUnprovenSymbols: number;
    minTrustedSymbolPct: number;
  };
  totals: DynamicReferenceCalibrationReport["totals"];
  reasons: string[];
  traderFacingUse: "allowed" | "operator_only";
};

export type GenerateDynamicReferenceCalibrationReportOptions = {
  auditPath: string;
  cacheDirectoryPath?: string;
  provider?: CandleProviderName;
  maxSymbols?: number;
};

export type WriteDynamicReferenceCalibrationReportOptions = GenerateDynamicReferenceCalibrationReportOptions & {
  jsonPath: string;
  markdownPath: string;
};

const DEFAULT_CACHE_DIRECTORY = ".validation-cache/candles";
const STRETCHED_FROM_VWAP_PCT = 8;

const sessionDateFormatter = new Intl.DateTimeFormat("en-CA", {
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

function isPosted(row: AuditRow): boolean {
  return (
    (row.status === "posted" || row.status === "success") &&
    ["post_alert", "post_level_snapshot", "post_level_extension"].includes(String(row.operation)) &&
    symbolOf(row) !== null &&
    rowTimestamp(row) !== null
  );
}

function symbolOf(row: AuditRow): string | null {
  const symbol = row.symbol?.trim().toUpperCase();
  return symbol || null;
}

function rowTimestamp(row: AuditRow): number | null {
  const timestamp = row.sourceTimestamp ?? row.timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : null;
}

function sessionDate(timestamp: number): string {
  return sessionDateFormatter.format(new Date(timestamp));
}

function textOf(row: AuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function extractPrice(row: AuditRow): number | null {
  if (typeof row.triggerPrice === "number" && Number.isFinite(row.triggerPrice) && row.triggerPrice > 0) {
    return row.triggerPrice;
  }
  const text = textOf(row);
  for (const pattern of [/\bPrice:\s*([0-9]+(?:\.[0-9]+)?)/i, /\bTriggered near:\s*([0-9]+(?:\.[0-9]+)?)/i]) {
    const match = text.match(pattern);
    const value = match?.[1] ? Number(match[1]) : NaN;
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
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

function loadCandles(params: {
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  asOfTimestamp?: number;
}): Candle[] {
  const directory = join(params.cacheDirectoryPath, params.provider, params.symbol, params.timeframe);
  const byTimestamp = new Map<number, Candle>();
  for (const file of walkJsonFiles(directory)) {
    for (const candle of extractCandles(parseCacheEntry(file))) {
      if (params.asOfTimestamp === undefined || candle.timestamp <= params.asOfTimestamp) {
        byTimestamp.set(candle.timestamp, candle);
      }
    }
  }
  for (const file of walkJsonlFiles(directory)) {
    for (const candle of readWarehouseCandles(file)) {
      if (params.asOfTimestamp === undefined || candle.timestamp <= params.asOfTimestamp) {
        byTimestamp.set(candle.timestamp, candle);
      }
    }
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function openingRangeState(
  price: number | null,
  referenceLevels: SharedReferenceLevels,
): DynamicReferenceCalibrationSample["openingRange"]["state"] {
  if (price === null || referenceLevels.openingRangeHigh === null || referenceLevels.openingRangeLow === null) {
    return "unavailable";
  }
  if (price > referenceLevels.openingRangeHigh) {
    return "above";
  }
  if (price < referenceLevels.openingRangeLow) {
    return "below";
  }
  return "inside";
}

function dynamicAvailable(dynamicLevels: DynamicLevelsFromCandles): boolean {
  return dynamicLevels.vwap !== null || dynamicLevels.ema9 !== null || dynamicLevels.ema20 !== null;
}

function rankTrust(trust: DynamicReferenceTrust): number {
  return {
    trusted: 0,
    watch: 1,
    unproven: 2,
    broken: 3,
  }[trust];
}

function worstTrust(values: DynamicReferenceTrust[]): DynamicReferenceTrust {
  return values.sort((left, right) => rankTrust(right) - rankTrust(left))[0] ?? "unproven";
}

function openingRangeTrustFor(params: {
  postsReviewed: number;
  fiveMinuteCandles: number;
  openingRangeAvailableCount: number;
  diagnosticReasons: string[];
}): Pick<DynamicReferenceCalibrationSymbolReport, "openingRangeTrust" | "trustReasons"> {
  const reasons: string[] = [];
  if (params.postsReviewed === 0) {
    return { openingRangeTrust: "unproven", trustReasons: ["no saved posts reviewed"] };
  }
  if (params.fiveMinuteCandles === 0) {
    return { openingRangeTrust: "unproven", trustReasons: ["no cached 5m candles for opening-range proof"] };
  }
  if (params.openingRangeAvailableCount === 0) {
    return { openingRangeTrust: "broken", trustReasons: ["5m candles exist but opening range was unavailable for reviewed posts"] };
  }
  const availabilityRatio = params.postsReviewed > 0
    ? params.openingRangeAvailableCount / params.postsReviewed
    : 0;
  if (availabilityRatio < 0.35) {
    reasons.push(`opening range was available on only ${(availabilityRatio * 100).toFixed(1)}% of reviewed posts`);
  } else if (params.openingRangeAvailableCount < params.postsReviewed) {
    reasons.push("opening range unavailable on some early, premarket, or after-hours posts");
  }
  if (params.diagnosticReasons.some((reason) => /reference:missing|reference:insufficient/i.test(reason))) {
    reasons.push("reference diagnostics still include missing/insufficient evidence");
  }
  return {
    openingRangeTrust: reasons.some((reason) => /only|missing|insufficient/i.test(reason)) ? "watch" : "trusted",
    trustReasons: reasons,
  };
}

function dynamicLevelTrustFor(params: {
  postsReviewed: number;
  fiveMinuteCandles: number;
  dynamicAvailableCount: number;
  diagnosticReasons: string[];
}): Pick<DynamicReferenceCalibrationSymbolReport, "dynamicLevelTrust" | "trustReasons"> {
  const reasons: string[] = [];
  if (params.postsReviewed === 0) {
    return { dynamicLevelTrust: "unproven", trustReasons: ["no saved posts reviewed"] };
  }
  if (params.fiveMinuteCandles === 0) {
    return { dynamicLevelTrust: "unproven", trustReasons: ["no cached 5m candles for VWAP/EMA proof"] };
  }
  if (params.dynamicAvailableCount === 0) {
    return { dynamicLevelTrust: "broken", trustReasons: ["5m candles exist but VWAP/EMA evidence was unavailable"] };
  }
  if (params.dynamicAvailableCount < params.postsReviewed) {
    reasons.push("VWAP/EMA evidence was not available on every reviewed post");
  }
  if (params.diagnosticReasons.some((reason) => /dynamic:missing|dynamic:insufficient/i.test(reason))) {
    reasons.push("dynamic diagnostics still include missing/insufficient evidence");
  }
  return {
    dynamicLevelTrust: reasons.length ? "watch" : "trusted",
    trustReasons: reasons,
  };
}

function buildSample(params: {
  row: AuditRow;
  dailyCandles: Candle[];
  fiveMinuteCandles: Candle[];
}): DynamicReferenceCalibrationSample {
  const timestamp = rowTimestamp(params.row)!;
  const price = extractPrice(params.row);
  const session = sessionDate(timestamp);
  const intradayAsOf = params.fiveMinuteCandles.filter((candle) => candle.timestamp <= timestamp);
  const referenceLevels = buildReferenceLevels({
    dailyCandles: params.dailyCandles.filter((candle) => candle.timestamp <= timestamp),
    intradayCandles: intradayAsOf,
    sessionDate: session,
  });
  const dynamicLevels = buildDynamicLevelsFromCandles(intradayAsOf, {
    sessionDate: session,
    currentPrice: price ?? intradayAsOf.at(-1)?.close,
  });
  const diagnostics = [
    ...referenceLevels.diagnostics.map((diagnostic) => `reference:${diagnostic.code}`),
    ...dynamicLevels.diagnostics.map((diagnostic) => `dynamic:${diagnostic.code}`),
  ];

  return {
    symbol: symbolOf(params.row)!,
    timestamp,
    timestampIso: new Date(timestamp).toISOString(),
    price,
    title: params.row.title,
    operation: params.row.operation,
    openingRange: {
      high: referenceLevels.openingRangeHigh,
      low: referenceLevels.openingRangeLow,
      state: openingRangeState(price, referenceLevels),
    },
    dynamicLevels: {
      vwap: dynamicLevels.vwap,
      ema9: dynamicLevels.ema9,
      ema20: dynamicLevels.ema20,
      priceVsVwapPct: dynamicLevels.priceContext?.priceVsVwapPct ?? null,
      priceVsEma9Pct: dynamicLevels.priceContext?.priceVsEma9Pct ?? null,
      priceVsEma20Pct: dynamicLevels.priceContext?.priceVsEma20Pct ?? null,
    },
    diagnostics,
  };
}

function buildSymbolReport(
  symbol: string,
  rows: AuditRow[],
  dailyCandles: Candle[],
  fiveMinuteCandles: Candle[],
): DynamicReferenceCalibrationSymbolReport {
  const samples = rows.map((row) => buildSample({ row, dailyCandles, fiveMinuteCandles }));
  const diagnosticReasons = [...new Set(samples.flatMap((sample) => sample.diagnostics))].slice(0, 12);
  const openingRangeAvailableCount = samples.filter((sample) => sample.openingRange.state !== "unavailable").length;
  const dynamicAvailableCount = samples.filter((sample) =>
    sample.dynamicLevels.vwap !== null || sample.dynamicLevels.ema9 !== null || sample.dynamicLevels.ema20 !== null,
  ).length;
  const opening = openingRangeTrustFor({
    postsReviewed: rows.length,
    fiveMinuteCandles: fiveMinuteCandles.length,
    openingRangeAvailableCount,
    diagnosticReasons,
  });
  const dynamic = dynamicLevelTrustFor({
    postsReviewed: rows.length,
    fiveMinuteCandles: fiveMinuteCandles.length,
    dynamicAvailableCount,
    diagnosticReasons,
  });
  const overallTrust = worstTrust([opening.openingRangeTrust, dynamic.dynamicLevelTrust]);
  const trustReasons = [...new Set([...opening.trustReasons, ...dynamic.trustReasons])];
  return {
    symbol,
    postsReviewed: rows.length,
    dailyCandles: dailyCandles.length,
    fiveMinuteCandles: fiveMinuteCandles.length,
    openingRangeAvailableCount,
    dynamicAvailableCount,
    aboveOpeningRangeCount: samples.filter((sample) => sample.openingRange.state === "above").length,
    insideOpeningRangeCount: samples.filter((sample) => sample.openingRange.state === "inside").length,
    belowOpeningRangeCount: samples.filter((sample) => sample.openingRange.state === "below").length,
    aboveVwapCount: samples.filter((sample) =>
      typeof sample.dynamicLevels.priceVsVwapPct === "number" && sample.dynamicLevels.priceVsVwapPct >= 0,
    ).length,
    belowVwapCount: samples.filter((sample) =>
      typeof sample.dynamicLevels.priceVsVwapPct === "number" && sample.dynamicLevels.priceVsVwapPct < 0,
    ).length,
    stretchedFromVwapCount: samples.filter((sample) =>
      typeof sample.dynamicLevels.priceVsVwapPct === "number" &&
      Math.abs(sample.dynamicLevels.priceVsVwapPct) >= STRETCHED_FROM_VWAP_PCT,
    ).length,
    openingRangeTrust: opening.openingRangeTrust,
    dynamicLevelTrust: dynamic.dynamicLevelTrust,
    overallTrust,
    trustReasons,
    diagnosticReasons,
    samples,
  };
}

export function generateDynamicReferenceCalibrationReport(
  options: GenerateDynamicReferenceCalibrationReportOptions,
): DynamicReferenceCalibrationReport {
  const sourceAuditPaths = resolveAuditPaths(options.auditPath);
  const cacheDirectoryPath = options.cacheDirectoryPath ?? DEFAULT_CACHE_DIRECTORY;
  const provider = options.provider ?? "ibkr";
  const rows = sourceAuditPaths.flatMap((path) => readRows(path)).filter(isPosted);
  const bySymbol = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const symbol = symbolOf(row)!;
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), row]);
  }

  const symbols: DynamicReferenceCalibrationSymbolReport[] = [];
  for (const [symbol, symbolRows] of [...bySymbol.entries()].sort().slice(0, options.maxSymbols ?? Number.POSITIVE_INFINITY)) {
    const maxTimestamp = Math.max(...symbolRows.map((row) => rowTimestamp(row)!).filter(Number.isFinite));
    const dailyCandles = loadCandles({ cacheDirectoryPath, provider, symbol, timeframe: "daily", asOfTimestamp: maxTimestamp });
    const fiveMinuteCandles = loadCandles({ cacheDirectoryPath, provider, symbol, timeframe: "5m", asOfTimestamp: maxTimestamp });
    symbols.push(buildSymbolReport(symbol, symbolRows, dailyCandles, fiveMinuteCandles));
  }

  const samples = symbols.flatMap((symbol) => symbol.samples);
  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: sourceAuditPaths.length === 1
      ? sourceAuditPaths[0]!
      : `${sourceAuditPaths.length} audit files from ${resolve(options.auditPath)}`,
    sourceAuditPaths,
    cacheDirectoryPath,
    provider,
    totals: {
      symbols: symbols.length,
      postsReviewed: samples.length,
      openingRangeAvailable: samples.filter((sample) => sample.openingRange.state !== "unavailable").length,
      dynamicAvailable: samples.filter((sample) => sample.dynamicLevels.vwap !== null || sample.dynamicLevels.ema9 !== null || sample.dynamicLevels.ema20 !== null).length,
      stretchedFromVwap: samples.filter((sample) =>
        typeof sample.dynamicLevels.priceVsVwapPct === "number" &&
        Math.abs(sample.dynamicLevels.priceVsVwapPct) >= STRETCHED_FROM_VWAP_PCT,
      ).length,
      symbolsWithoutDynamicEvidence: symbols.filter((symbol) => symbol.dynamicAvailableCount === 0).length,
      symbolsWithoutOpeningRangeEvidence: symbols.filter((symbol) => symbol.openingRangeAvailableCount === 0).length,
      trustedSymbols: symbols.filter((symbol) => symbol.overallTrust === "trusted").length,
      watchSymbols: symbols.filter((symbol) => symbol.overallTrust === "watch").length,
      unprovenSymbols: symbols.filter((symbol) => symbol.overallTrust === "unproven").length,
      brokenSymbols: symbols.filter((symbol) => symbol.overallTrust === "broken").length,
    },
    symbols: symbols.sort((left, right) =>
      right.stretchedFromVwapCount - left.stretchedFromVwapCount ||
      left.symbol.localeCompare(right.symbol),
    ),
    examples: {
      openingRangeAvailable: samples.filter((sample) => sample.openingRange.state !== "unavailable").slice(0, 20),
      dynamicAvailable: samples.filter((sample) => sample.dynamicLevels.vwap !== null || sample.dynamicLevels.ema9 !== null || sample.dynamicLevels.ema20 !== null).slice(0, 20),
      stretchedFromVwap: samples.filter((sample) =>
        typeof sample.dynamicLevels.priceVsVwapPct === "number" &&
        Math.abs(sample.dynamicLevels.priceVsVwapPct) >= STRETCHED_FROM_VWAP_PCT,
      ).slice(0, 20),
      missingEvidence: samples.filter((sample) =>
        sample.openingRange.state === "unavailable" &&
        sample.dynamicLevels.vwap === null &&
        sample.dynamicLevels.ema9 === null &&
        sample.dynamicLevels.ema20 === null,
      ).slice(0, 20),
    },
  };
}

function price(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? (value >= 1 ? value.toFixed(2) : value.toFixed(4)) : "n/a";
}

function pct(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(1)}%` : "n/a";
}

export function formatDynamicReferenceCalibrationReport(report: DynamicReferenceCalibrationReport): string {
  const lines = [
    "# Dynamic Reference Calibration Report",
    "",
    "Operator-only report proving whether saved candles support opening-range, VWAP, and EMA facts around saved Discord posts.",
    "",
    `Generated: ${report.generatedAt}`,
    `Source audit: ${report.sourceAuditPath}`,
    `Source audit files: ${report.sourceAuditPaths.length}`,
    `Cache: ${report.cacheDirectoryPath}`,
    `Provider: ${report.provider}`,
    "",
    "## Totals",
    "",
    `- symbols: ${report.totals.symbols}`,
    `- posts reviewed: ${report.totals.postsReviewed}`,
    `- opening range available samples: ${report.totals.openingRangeAvailable}`,
    `- dynamic VWAP/EMA available samples: ${report.totals.dynamicAvailable}`,
    `- stretched from VWAP samples: ${report.totals.stretchedFromVwap}`,
    `- symbols without dynamic evidence: ${report.totals.symbolsWithoutDynamicEvidence}`,
    `- symbols without opening-range evidence: ${report.totals.symbolsWithoutOpeningRangeEvidence}`,
    `- trust: ${report.totals.trustedSymbols} trusted / ${report.totals.watchSymbols} watch / ${report.totals.unprovenSymbols} unproven / ${report.totals.brokenSymbols} broken`,
    "",
    "## Per Symbol",
    "",
    "| Symbol | Trust | Posts | D/5m Candles | Opening Range | Dynamic | Above/Inside/Below OR | Above/Below VWAP | Stretched VWAP | Reasons | Diagnostics |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | --- | ---: | --- | --- |",
  ];

  for (const symbol of report.symbols.slice(0, 120)) {
    lines.push(
      `| ${symbol.symbol} | ${symbol.overallTrust} (OR ${symbol.openingRangeTrust}, dyn ${symbol.dynamicLevelTrust}) | ${symbol.postsReviewed} | ${symbol.dailyCandles}/${symbol.fiveMinuteCandles} | ${symbol.openingRangeAvailableCount} | ${symbol.dynamicAvailableCount} | ${symbol.aboveOpeningRangeCount}/${symbol.insideOpeningRangeCount}/${symbol.belowOpeningRangeCount} | ${symbol.aboveVwapCount}/${symbol.belowVwapCount} | ${symbol.stretchedFromVwapCount} | ${symbol.trustReasons.join("; ") || "none"} | ${symbol.diagnosticReasons.join("; ") || "none"} |`,
    );
  }

  lines.push("", "## Stretched From VWAP Examples", "");
  for (const sample of report.examples.stretchedFromVwap) {
    lines.push(
      `- ${sample.symbol} ${sample.timestampIso}: price ${price(sample.price)}, VWAP ${price(sample.dynamicLevels.vwap)} (${pct(sample.dynamicLevels.priceVsVwapPct)}); ${sample.title ?? sample.operation ?? "post"}`,
    );
  }
  if (report.examples.stretchedFromVwap.length === 0) {
    lines.push("- none");
  }

  lines.push("", "## Missing Evidence Examples", "");
  for (const sample of report.examples.missingEvidence) {
    lines.push(`- ${sample.symbol} ${sample.timestampIso}: ${sample.title ?? sample.operation ?? "post"}; diagnostics ${sample.diagnostics.join("; ") || "none"}`);
  }
  if (report.examples.missingEvidence.length === 0) {
    lines.push("- none");
  }

  return `${lines.join("\n")}\n`;
}

export function evaluateDynamicReferenceCalibrationGate(
  report: DynamicReferenceCalibrationReport,
  thresholds: Partial<DynamicReferenceCalibrationGateResult["thresholds"]> = {},
): DynamicReferenceCalibrationGateResult {
  const resolved = {
    maxBrokenSymbols: thresholds.maxBrokenSymbols ?? 0,
    maxUnprovenSymbols: thresholds.maxUnprovenSymbols ?? 0,
    minTrustedSymbolPct: thresholds.minTrustedSymbolPct ?? 65,
  };
  const trustedPct = report.totals.symbols
    ? (report.totals.trustedSymbols / report.totals.symbols) * 100
    : 0;
  const reasons: string[] = [];
  if (report.totals.brokenSymbols > resolved.maxBrokenSymbols) {
    reasons.push(`${report.totals.brokenSymbols} symbols are broken, above the allowed ${resolved.maxBrokenSymbols}`);
  }
  if (report.totals.unprovenSymbols > resolved.maxUnprovenSymbols) {
    reasons.push(`${report.totals.unprovenSymbols} symbols are unproven, above the allowed ${resolved.maxUnprovenSymbols}`);
  }
  if (trustedPct < resolved.minTrustedSymbolPct) {
    reasons.push(`trusted symbol rate ${trustedPct.toFixed(1)}% is below ${resolved.minTrustedSymbolPct}%`);
  }
  const hasHardFailure = report.totals.brokenSymbols > resolved.maxBrokenSymbols ||
    report.totals.unprovenSymbols > resolved.maxUnprovenSymbols;
  const status: DynamicReferenceCalibrationGateResult["status"] = hasHardFailure
    ? "fail"
    : reasons.length
      ? "review"
      : "pass";
  return {
    status,
    generatedAt: new Date().toISOString(),
    sourceAuditPath: report.sourceAuditPath,
    sourceAuditPaths: report.sourceAuditPaths,
    thresholds: resolved,
    totals: report.totals,
    reasons: reasons.length ? reasons : ["dynamic/reference evidence passed configured trust gates"],
    traderFacingUse: status === "pass" ? "allowed" : "operator_only",
  };
}

export function formatDynamicReferenceCalibrationGate(result: DynamicReferenceCalibrationGateResult): string {
  return `${[
    "# Dynamic Reference Trust Gate",
    "",
    "Operator-only gate for deciding whether VWAP/EMA/opening-range facts are ready for trader-facing use.",
    "",
    `Generated: ${result.generatedAt}`,
    `Source audit: ${result.sourceAuditPath}`,
    `Status: ${result.status}`,
    `Trader-facing use: ${result.traderFacingUse}`,
    "",
    "## Thresholds",
    "",
    `- max broken symbols: ${result.thresholds.maxBrokenSymbols}`,
    `- max unproven symbols: ${result.thresholds.maxUnprovenSymbols}`,
    `- min trusted symbol pct: ${result.thresholds.minTrustedSymbolPct}`,
    "",
    "## Totals",
    "",
    `- symbols: ${result.totals.symbols}`,
    `- trusted/watch/unproven/broken: ${result.totals.trustedSymbols}/${result.totals.watchSymbols}/${result.totals.unprovenSymbols}/${result.totals.brokenSymbols}`,
    "",
    "## Reasons",
    "",
    ...result.reasons.map((reason) => `- ${reason}`),
  ].join("\n")}\n`;
}

export function writeDynamicReferenceCalibrationReport(
  options: WriteDynamicReferenceCalibrationReportOptions,
): DynamicReferenceCalibrationReport {
  const report = generateDynamicReferenceCalibrationReport(options);
  const gate = evaluateDynamicReferenceCalibrationGate(report);
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatDynamicReferenceCalibrationReport(report), "utf8");
  writeFileSync(
    options.jsonPath.replace(/\.json$/i, "-gate.json"),
    `${JSON.stringify(gate, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    options.markdownPath.replace(/\.md$/i, "-gate.md"),
    formatDynamicReferenceCalibrationGate(gate),
    "utf8",
  );
  return report;
}
