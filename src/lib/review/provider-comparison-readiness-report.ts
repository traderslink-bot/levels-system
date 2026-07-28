import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  buildCandleMarketStructureContext,
  buildDynamicLevelsFromCandles,
  buildSupportResistanceContextFromCandles,
  type Candle,
  type CandleFetchTimeframe,
  type CandleProviderName,
} from "../support-resistance/index.js";

type CachedCandleEntry = {
  response?: {
    candles?: Candle[];
  };
  candles?: Candle[];
};

export type ProviderTimeframeComparisonStatus =
  | "both_available"
  | "primary_only"
  | "comparison_only"
  | "missing_both";

export type ProviderTimeframeComparison = {
  symbol: string;
  timeframe: CandleFetchTimeframe;
  status: ProviderTimeframeComparisonStatus;
  primaryCount: number;
  comparisonCount: number;
  primaryLatestTimestamp: number | null;
  comparisonLatestTimestamp: number | null;
  latestTimestampDriftMinutes: number | null;
  latestCloseDriftPct: number | null;
  averageVolumeDriftPct: number | null;
  vwapDriftPct: number | null;
  ema9DriftPct: number | null;
  ema20DriftPct: number | null;
  missingBehavior: string[];
};

export type ProviderLevelComparison = {
  symbol: string;
  status: "compared" | "insufficient_data" | "error";
  reason: string;
  primarySupportCount: number | null;
  primaryResistanceCount: number | null;
  comparisonSupportCount: number | null;
  comparisonResistanceCount: number | null;
  supportCountDelta: number | null;
  resistanceCountDelta: number | null;
  primaryHasForwardResistance: boolean | null;
  comparisonHasForwardResistance: boolean | null;
};

export type ProviderStructureComparison = {
  symbol: string;
  status: "compared" | "insufficient_data" | "error";
  reason: string;
  primaryState: string | null;
  comparisonState: string | null;
  primaryConfidence: string | null;
  comparisonConfidence: string | null;
  stateMatches: boolean | null;
  confidenceScoreDrift: number | null;
};

export type ProviderComparisonSymbolReport = {
  symbol: string;
  timeframeComparisons: ProviderTimeframeComparison[];
  levelComparison: ProviderLevelComparison;
  structureComparison: ProviderStructureComparison;
};

export type ProviderComparisonReadinessReport = {
  generatedAt: string;
  cacheDirectoryPath: string;
  primaryProvider: CandleProviderName;
  comparisonProvider: CandleProviderName;
  timeframes: CandleFetchTimeframe[];
  totals: {
    symbolsCompared: number;
    commonSymbols: number;
    primaryOnlySymbols: number;
    comparisonOnlySymbols: number;
    timeframeComparisons: number;
    bothAvailable: number;
    primaryOnly: number;
    comparisonOnly: number;
    missingBoth: number;
    highCloseDriftCount: number;
    highVolumeDriftCount: number;
    highDynamicDriftCount: number;
    levelDriftWatchCount: number;
    marketStructureDriftWatchCount: number;
    providerMissingBehaviorCount: number;
  };
  symbols: ProviderComparisonSymbolReport[];
};

export type GenerateProviderComparisonReadinessReportOptions = {
  cacheDirectoryPath?: string;
  primaryProvider?: CandleProviderName;
  comparisonProvider?: CandleProviderName;
  timeframes?: CandleFetchTimeframe[];
  symbols?: string[];
  maxSymbols?: number;
  highCloseDriftPct?: number;
  highVolumeDriftPct?: number;
  highDynamicDriftPct?: number;
};

export type WriteProviderComparisonReadinessReportOptions =
  GenerateProviderComparisonReadinessReportOptions & {
    jsonPath: string;
    markdownPath: string;
  };

const DEFAULT_CACHE_DIRECTORY = ".validation-cache/candles";
const DEFAULT_TIMEFRAMES: CandleFetchTimeframe[] = ["daily", "4h", "5m", "1m"];

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
}): Candle[] {
  const directory = join(params.cacheDirectoryPath, params.provider, params.symbol, params.timeframe);
  const byTimestamp = new Map<number, Candle>();
  for (const file of walkJsonFiles(directory)) {
    for (const candle of extractCandles(parseCacheEntry(file))) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  for (const file of walkJsonlFiles(directory)) {
    for (const candle of readWarehouseCandles(file)) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function providerSymbols(cacheDirectoryPath: string, provider: CandleProviderName): Set<string> {
  const root = join(cacheDirectoryPath, provider);
  if (!existsSync(root)) {
    return new Set();
  }
  return new Set(
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name.toUpperCase()),
  );
}

function driftPct(primary: number | null, comparison: number | null): number | null {
  if (
    typeof primary !== "number" ||
    typeof comparison !== "number" ||
    !Number.isFinite(primary) ||
    !Number.isFinite(comparison) ||
    primary === 0
  ) {
    return null;
  }
  return Number((Math.abs(primary - comparison) / Math.abs(primary) * 100).toFixed(4));
}

function averageVolume(candles: Candle[], maxBars = 30): number | null {
  const sample = candles
    .slice(-maxBars)
    .map((candle) => candle.volume)
    .filter((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (sample.length === 0) {
    return null;
  }
  return sample.reduce((sum, value) => sum + value, 0) / sample.length;
}

function timeframeMinutes(timeframe: CandleFetchTimeframe): number {
  switch (timeframe) {
    case "1m":
      return 1;
    case "5m":
      return 5;
    case "4h":
      return 240;
    case "daily":
      return 24 * 60;
  }
}

function timestampDriftMinutes(primary: number | null, comparison: number | null): number | null {
  if (primary === null || comparison === null) {
    return null;
  }
  return Number((Math.abs(primary - comparison) / 60_000).toFixed(2));
}

function status(primaryCount: number, comparisonCount: number): ProviderTimeframeComparisonStatus {
  if (primaryCount > 0 && comparisonCount > 0) {
    return "both_available";
  }
  if (primaryCount > 0) {
    return "primary_only";
  }
  if (comparisonCount > 0) {
    return "comparison_only";
  }
  return "missing_both";
}

function compareTimeframe(params: {
  symbol: string;
  timeframe: CandleFetchTimeframe;
  primaryProvider: CandleProviderName;
  comparisonProvider: CandleProviderName;
  primary: Candle[];
  comparison: Candle[];
}): ProviderTimeframeComparison {
  const primaryLatest = params.primary.at(-1) ?? null;
  const comparisonLatest = params.comparison.at(-1) ?? null;
  const primaryDynamic = params.timeframe === "5m" ? buildDynamicLevelsFromCandles(params.primary) : null;
  const comparisonDynamic = params.timeframe === "5m" ? buildDynamicLevelsFromCandles(params.comparison) : null;
  const latestTimestampDrift = timestampDriftMinutes(primaryLatest?.timestamp ?? null, comparisonLatest?.timestamp ?? null);
  const primaryAverageVolume = averageVolume(params.primary);
  const comparisonAverageVolume = averageVolume(params.comparison);
  const missingBehavior: string[] = [];
  if (params.primary.length === 0) {
    missingBehavior.push(`${params.primaryProvider} missing ${params.timeframe} candles`);
  }
  if (params.comparison.length === 0) {
    missingBehavior.push(`${params.comparisonProvider} missing ${params.timeframe} candles`);
  }
  if (params.primary.length > 0 && primaryLatest === null) {
    missingBehavior.push(`${params.primaryProvider} has no usable latest ${params.timeframe} close`);
  }
  if (params.comparison.length > 0 && comparisonLatest === null) {
    missingBehavior.push(`${params.comparisonProvider} has no usable latest ${params.timeframe} close`);
  }
  if (params.primary.length > 0 && primaryAverageVolume === null) {
    missingBehavior.push(`${params.primaryProvider} has no usable ${params.timeframe} volume baseline`);
  }
  if (params.comparison.length > 0 && comparisonAverageVolume === null) {
    missingBehavior.push(`${params.comparisonProvider} has no usable ${params.timeframe} volume baseline`);
  }
  if (latestTimestampDrift !== null && latestTimestampDrift > timeframeMinutes(params.timeframe) * 2) {
    missingBehavior.push(`latest ${params.timeframe} candle timestamps differ by ${latestTimestampDrift.toFixed(1)} minutes`);
  }
  return {
    symbol: params.symbol,
    timeframe: params.timeframe,
    status: status(params.primary.length, params.comparison.length),
    primaryCount: params.primary.length,
    comparisonCount: params.comparison.length,
    primaryLatestTimestamp: primaryLatest?.timestamp ?? null,
    comparisonLatestTimestamp: comparisonLatest?.timestamp ?? null,
    latestTimestampDriftMinutes: latestTimestampDrift,
    latestCloseDriftPct: driftPct(primaryLatest?.close ?? null, comparisonLatest?.close ?? null),
    averageVolumeDriftPct: driftPct(primaryAverageVolume, comparisonAverageVolume),
    vwapDriftPct: driftPct(primaryDynamic?.vwap ?? null, comparisonDynamic?.vwap ?? null),
    ema9DriftPct: driftPct(primaryDynamic?.ema9 ?? null, comparisonDynamic?.ema9 ?? null),
    ema20DriftPct: driftPct(primaryDynamic?.ema20 ?? null, comparisonDynamic?.ema20 ?? null),
    missingBehavior,
  };
}

function levelCount(context: Awaited<ReturnType<typeof buildSupportResistanceContextFromCandles>>, side: "support" | "resistance"): number {
  const levels = context.levels;
  return side === "support"
    ? levels.majorSupport.length + levels.intermediateSupport.length + levels.intradaySupport.length + levels.extensionLevels.support.length
    : levels.majorResistance.length + levels.intermediateResistance.length + levels.intradayResistance.length + levels.extensionLevels.resistance.length;
}

async function compareLevels(params: {
  symbol: string;
  primaryDaily: Candle[];
  primaryFourHour: Candle[];
  primaryFiveMinute: Candle[];
  comparisonDaily: Candle[];
  comparisonFourHour: Candle[];
  comparisonFiveMinute: Candle[];
}): Promise<ProviderLevelComparison> {
  if (
    params.primaryDaily.length === 0 ||
    params.primaryFourHour.length === 0 ||
    params.comparisonDaily.length === 0 ||
    params.comparisonFourHour.length === 0
  ) {
    return {
      symbol: params.symbol,
      status: "insufficient_data",
      reason: "daily and 4h candles are required from both providers for level comparison",
      primarySupportCount: null,
      primaryResistanceCount: null,
      comparisonSupportCount: null,
      comparisonResistanceCount: null,
      supportCountDelta: null,
      resistanceCountDelta: null,
      primaryHasForwardResistance: null,
      comparisonHasForwardResistance: null,
    };
  }
  try {
    const currentPrice = params.primaryFiveMinute.at(-1)?.close ?? params.primaryDaily.at(-1)?.close;
    const primary = await buildSupportResistanceContextFromCandles({
      symbol: params.symbol,
      currentPrice,
      candlesByTimeframe: {
        daily: params.primaryDaily,
        "4h": params.primaryFourHour,
        "5m": params.primaryFiveMinute,
      },
    });
    const comparison = await buildSupportResistanceContextFromCandles({
      symbol: params.symbol,
      currentPrice,
      candlesByTimeframe: {
        daily: params.comparisonDaily,
        "4h": params.comparisonFourHour,
        "5m": params.comparisonFiveMinute,
      },
    });
    const primarySupportCount = levelCount(primary, "support");
    const primaryResistanceCount = levelCount(primary, "resistance");
    const comparisonSupportCount = levelCount(comparison, "support");
    const comparisonResistanceCount = levelCount(comparison, "resistance");
    return {
      symbol: params.symbol,
      status: "compared",
      reason: "support/resistance counts compared from cached provider candles",
      primarySupportCount,
      primaryResistanceCount,
      comparisonSupportCount,
      comparisonResistanceCount,
      supportCountDelta: comparisonSupportCount - primarySupportCount,
      resistanceCountDelta: comparisonResistanceCount - primaryResistanceCount,
      primaryHasForwardResistance: currentPrice === undefined
        ? null
        : primary.levels.majorResistance.concat(primary.levels.intermediateResistance, primary.levels.intradayResistance, primary.levels.extensionLevels.resistance)
          .some((level) => level.representativePrice >= currentPrice),
      comparisonHasForwardResistance: currentPrice === undefined
        ? null
        : comparison.levels.majorResistance.concat(comparison.levels.intermediateResistance, comparison.levels.intradayResistance, comparison.levels.extensionLevels.resistance)
          .some((level) => level.representativePrice >= currentPrice),
    };
  } catch (error) {
    return {
      symbol: params.symbol,
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
      primarySupportCount: null,
      primaryResistanceCount: null,
      comparisonSupportCount: null,
      comparisonResistanceCount: null,
      supportCountDelta: null,
      resistanceCountDelta: null,
      primaryHasForwardResistance: null,
      comparisonHasForwardResistance: null,
    };
  }
}

function compareStructure(params: {
  symbol: string;
  primaryFiveMinute: Candle[];
  comparisonFiveMinute: Candle[];
}): ProviderStructureComparison {
  if (params.primaryFiveMinute.length < 12 || params.comparisonFiveMinute.length < 12) {
    return {
      symbol: params.symbol,
      status: "insufficient_data",
      reason: "at least 12 cached 5m candles are required from both providers for market-structure comparison",
      primaryState: null,
      comparisonState: null,
      primaryConfidence: null,
      comparisonConfidence: null,
      stateMatches: null,
      confidenceScoreDrift: null,
    };
  }
  try {
    const primary = buildCandleMarketStructureContext({
      symbol: params.symbol,
      candles: params.primaryFiveMinute,
      currentPrice: params.primaryFiveMinute.at(-1)?.close,
    });
    const comparison = buildCandleMarketStructureContext({
      symbol: params.symbol,
      candles: params.comparisonFiveMinute,
      currentPrice: params.comparisonFiveMinute.at(-1)?.close,
    });
    return {
      symbol: params.symbol,
      status: "compared",
      reason: "5m market-structure states compared from cached provider candles",
      primaryState: primary.state,
      comparisonState: comparison.state,
      primaryConfidence: primary.confidence.label,
      comparisonConfidence: comparison.confidence.label,
      stateMatches: primary.state === comparison.state,
      confidenceScoreDrift: driftPct(primary.confidence.score, comparison.confidence.score),
    };
  } catch (error) {
    return {
      symbol: params.symbol,
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
      primaryState: null,
      comparisonState: null,
      primaryConfidence: null,
      comparisonConfidence: null,
      stateMatches: null,
      confidenceScoreDrift: null,
    };
  }
}

export async function generateProviderComparisonReadinessReport(
  options: GenerateProviderComparisonReadinessReportOptions = {},
): Promise<ProviderComparisonReadinessReport> {
  const cacheDirectoryPath = options.cacheDirectoryPath ?? DEFAULT_CACHE_DIRECTORY;
  const primaryProvider = options.primaryProvider ?? "ibkr";
  const comparisonProvider = options.comparisonProvider ?? "stub";
  const timeframes = options.timeframes ?? DEFAULT_TIMEFRAMES;
  const highCloseDriftPct = options.highCloseDriftPct ?? 1;
  const highVolumeDriftPct = options.highVolumeDriftPct ?? 35;
  const highDynamicDriftPct = options.highDynamicDriftPct ?? 2;
  const primarySymbols = providerSymbols(cacheDirectoryPath, primaryProvider);
  const comparisonSymbols = providerSymbols(cacheDirectoryPath, comparisonProvider);
  const selectedSymbols = options.symbols
    ? options.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)
    : [...new Set([...primarySymbols, ...comparisonSymbols])].sort();
  const symbolsToCompare = selectedSymbols.slice(0, options.maxSymbols ?? Number.POSITIVE_INFINITY);
  const symbols: ProviderComparisonSymbolReport[] = [];

  for (const symbol of symbolsToCompare) {
    const candlesByProviderTimeframe = new Map<string, Candle[]>();
    for (const provider of [primaryProvider, comparisonProvider]) {
      for (const timeframe of timeframes) {
        candlesByProviderTimeframe.set(
          `${provider}:${timeframe}`,
          loadCandles({ cacheDirectoryPath, provider, symbol, timeframe }),
        );
      }
    }
    const timeframeComparisons = timeframes.map((timeframe) =>
      compareTimeframe({
        symbol,
        timeframe,
        primaryProvider,
        comparisonProvider,
        primary: candlesByProviderTimeframe.get(`${primaryProvider}:${timeframe}`) ?? [],
        comparison: candlesByProviderTimeframe.get(`${comparisonProvider}:${timeframe}`) ?? [],
      }),
    );
    const levelComparison = await compareLevels({
      symbol,
      primaryDaily: candlesByProviderTimeframe.get(`${primaryProvider}:daily`) ?? [],
      primaryFourHour: candlesByProviderTimeframe.get(`${primaryProvider}:4h`) ?? [],
      primaryFiveMinute: candlesByProviderTimeframe.get(`${primaryProvider}:5m`) ?? [],
      comparisonDaily: candlesByProviderTimeframe.get(`${comparisonProvider}:daily`) ?? [],
      comparisonFourHour: candlesByProviderTimeframe.get(`${comparisonProvider}:4h`) ?? [],
      comparisonFiveMinute: candlesByProviderTimeframe.get(`${comparisonProvider}:5m`) ?? [],
    });
    const structureComparison = compareStructure({
      symbol,
      primaryFiveMinute: candlesByProviderTimeframe.get(`${primaryProvider}:5m`) ?? [],
      comparisonFiveMinute: candlesByProviderTimeframe.get(`${comparisonProvider}:5m`) ?? [],
    });
    symbols.push({ symbol, timeframeComparisons, levelComparison, structureComparison });
  }

  const allTimeframes = symbols.flatMap((symbol) => symbol.timeframeComparisons);
  const highDynamicDriftCount = allTimeframes.filter((comparison) =>
    [comparison.vwapDriftPct, comparison.ema9DriftPct, comparison.ema20DriftPct].some(
      (value) => typeof value === "number" && value >= highDynamicDriftPct,
    ),
  ).length;
  const highVolumeDriftCount = allTimeframes.filter((comparison) =>
    typeof comparison.averageVolumeDriftPct === "number" && comparison.averageVolumeDriftPct >= highVolumeDriftPct,
  ).length;
  const levelDriftWatchCount = symbols.filter((symbol) =>
    symbol.levelComparison.status === "compared" &&
    (Math.abs(symbol.levelComparison.supportCountDelta ?? 0) >= 3 ||
      Math.abs(symbol.levelComparison.resistanceCountDelta ?? 0) >= 3 ||
      symbol.levelComparison.primaryHasForwardResistance !== symbol.levelComparison.comparisonHasForwardResistance),
  ).length;
  const marketStructureDriftWatchCount = symbols.filter((symbol) =>
    symbol.structureComparison.status === "compared" && symbol.structureComparison.stateMatches === false,
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    cacheDirectoryPath,
    primaryProvider,
    comparisonProvider,
    timeframes,
    totals: {
      symbolsCompared: symbols.length,
      commonSymbols: [...primarySymbols].filter((symbol) => comparisonSymbols.has(symbol)).length,
      primaryOnlySymbols: [...primarySymbols].filter((symbol) => !comparisonSymbols.has(symbol)).length,
      comparisonOnlySymbols: [...comparisonSymbols].filter((symbol) => !primarySymbols.has(symbol)).length,
      timeframeComparisons: allTimeframes.length,
      bothAvailable: allTimeframes.filter((comparison) => comparison.status === "both_available").length,
      primaryOnly: allTimeframes.filter((comparison) => comparison.status === "primary_only").length,
      comparisonOnly: allTimeframes.filter((comparison) => comparison.status === "comparison_only").length,
      missingBoth: allTimeframes.filter((comparison) => comparison.status === "missing_both").length,
      highCloseDriftCount: allTimeframes.filter((comparison) =>
        typeof comparison.latestCloseDriftPct === "number" && comparison.latestCloseDriftPct >= highCloseDriftPct,
      ).length,
      highVolumeDriftCount,
      highDynamicDriftCount,
      levelDriftWatchCount,
      marketStructureDriftWatchCount,
      providerMissingBehaviorCount: allTimeframes.reduce((sum, comparison) => sum + comparison.missingBehavior.length, 0),
    },
    symbols,
  };
}

function formatTimestamp(timestamp: number | null): string {
  return timestamp === null ? "n/a" : new Date(timestamp).toISOString();
}

function pct(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}%` : "n/a";
}

export function formatProviderComparisonReadinessReport(report: ProviderComparisonReadinessReport): string {
  const lines = [
    "# Provider Comparison Readiness Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Cache: ${report.cacheDirectoryPath}`,
    `Primary provider: ${report.primaryProvider}`,
    `Comparison provider: ${report.comparisonProvider}`,
    `Timeframes: ${report.timeframes.join(", ")}`,
    "",
    "## Totals",
    "",
    `- symbols compared: ${report.totals.symbolsCompared}`,
    `- common symbols: ${report.totals.commonSymbols}`,
    `- primary-only symbols: ${report.totals.primaryOnlySymbols}`,
    `- comparison-only symbols: ${report.totals.comparisonOnlySymbols}`,
    `- timeframe comparisons: ${report.totals.timeframeComparisons}`,
    `- both available: ${report.totals.bothAvailable}`,
    `- primary only: ${report.totals.primaryOnly}`,
    `- comparison only: ${report.totals.comparisonOnly}`,
    `- missing both: ${report.totals.missingBoth}`,
    `- high close drift: ${report.totals.highCloseDriftCount}`,
    `- high volume drift: ${report.totals.highVolumeDriftCount}`,
    `- high dynamic drift: ${report.totals.highDynamicDriftCount}`,
    `- level drift watch: ${report.totals.levelDriftWatchCount}`,
    `- market-structure drift watch: ${report.totals.marketStructureDriftWatchCount}`,
    `- provider missing/stale behavior findings: ${report.totals.providerMissingBehaviorCount}`,
    "",
    "## Symbol Evidence",
    "",
    "| Symbol | TF | Status | Primary Count | Compare Count | Primary Latest | Compare Latest | Time Drift | Close Drift | Volume Drift | VWAP Drift | EMA9 Drift | EMA20 Drift |",
    "| --- | --- | --- | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const symbol of report.symbols.slice(0, 80)) {
    for (const comparison of symbol.timeframeComparisons) {
      lines.push(
        `| ${symbol.symbol} | ${comparison.timeframe} | ${comparison.status} | ${comparison.primaryCount} | ${comparison.comparisonCount} | ${formatTimestamp(comparison.primaryLatestTimestamp)} | ${formatTimestamp(comparison.comparisonLatestTimestamp)} | ${comparison.latestTimestampDriftMinutes ?? "n/a"}m | ${pct(comparison.latestCloseDriftPct)} | ${pct(comparison.averageVolumeDriftPct)} | ${pct(comparison.vwapDriftPct)} | ${pct(comparison.ema9DriftPct)} | ${pct(comparison.ema20DriftPct)} |`,
      );
    }
  }

  const missingRows = report.symbols.flatMap((symbol) =>
    symbol.timeframeComparisons
      .filter((comparison) => comparison.missingBehavior.length > 0)
      .map((comparison) => ({ symbol: symbol.symbol, comparison })),
  );
  lines.push("", "## Missing / Stale Provider Behavior", "");
  if (missingRows.length === 0) {
    lines.push("- none detected");
  } else {
    for (const item of missingRows.slice(0, 120)) {
      lines.push(`- ${item.symbol} ${item.comparison.timeframe}: ${item.comparison.missingBehavior.join("; ")}`);
    }
  }

  lines.push("", "## Level Comparison", "");
  for (const symbol of report.symbols.slice(0, 80)) {
    const level = symbol.levelComparison;
    lines.push(
      `- ${symbol.symbol}: ${level.status}; ${level.reason}; support ${level.primarySupportCount ?? "n/a"} vs ${level.comparisonSupportCount ?? "n/a"}; resistance ${level.primaryResistanceCount ?? "n/a"} vs ${level.comparisonResistanceCount ?? "n/a"}; forward resistance ${level.primaryHasForwardResistance ?? "n/a"} vs ${level.comparisonHasForwardResistance ?? "n/a"}`,
    );
  }

  lines.push("", "## Market Structure Comparison", "");
  for (const symbol of report.symbols.slice(0, 80)) {
    const structure = symbol.structureComparison;
    lines.push(
      `- ${symbol.symbol}: ${structure.status}; ${structure.reason}; state ${structure.primaryState ?? "n/a"} vs ${structure.comparisonState ?? "n/a"}; confidence ${structure.primaryConfidence ?? "n/a"} vs ${structure.comparisonConfidence ?? "n/a"}; score drift ${pct(structure.confidenceScoreDrift)}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function writeProviderComparisonReadinessReport(
  options: WriteProviderComparisonReadinessReportOptions,
): Promise<ProviderComparisonReadinessReport> {
  const report = await generateProviderComparisonReadinessReport(options);
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatProviderComparisonReadinessReport(report), "utf8");
  return report;
}
