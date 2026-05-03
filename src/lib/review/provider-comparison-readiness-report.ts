import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
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
  latestCloseDriftPct: number | null;
  vwapDriftPct: number | null;
  ema9DriftPct: number | null;
  ema20DriftPct: number | null;
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

export type ProviderComparisonSymbolReport = {
  symbol: string;
  timeframeComparisons: ProviderTimeframeComparison[];
  levelComparison: ProviderLevelComparison;
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
    highDynamicDriftCount: number;
    levelDriftWatchCount: number;
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

function parseCacheEntry(path: string): CachedCandleEntry | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CachedCandleEntry;
  } catch {
    return null;
  }
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
  primary: Candle[];
  comparison: Candle[];
}): ProviderTimeframeComparison {
  const primaryLatest = params.primary.at(-1) ?? null;
  const comparisonLatest = params.comparison.at(-1) ?? null;
  const primaryDynamic = params.timeframe === "5m" ? buildDynamicLevelsFromCandles(params.primary) : null;
  const comparisonDynamic = params.timeframe === "5m" ? buildDynamicLevelsFromCandles(params.comparison) : null;
  return {
    symbol: params.symbol,
    timeframe: params.timeframe,
    status: status(params.primary.length, params.comparison.length),
    primaryCount: params.primary.length,
    comparisonCount: params.comparison.length,
    primaryLatestTimestamp: primaryLatest?.timestamp ?? null,
    comparisonLatestTimestamp: comparisonLatest?.timestamp ?? null,
    latestCloseDriftPct: driftPct(primaryLatest?.close ?? null, comparisonLatest?.close ?? null),
    vwapDriftPct: driftPct(primaryDynamic?.vwap ?? null, comparisonDynamic?.vwap ?? null),
    ema9DriftPct: driftPct(primaryDynamic?.ema9 ?? null, comparisonDynamic?.ema9 ?? null),
    ema20DriftPct: driftPct(primaryDynamic?.ema20 ?? null, comparisonDynamic?.ema20 ?? null),
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

export async function generateProviderComparisonReadinessReport(
  options: GenerateProviderComparisonReadinessReportOptions = {},
): Promise<ProviderComparisonReadinessReport> {
  const cacheDirectoryPath = options.cacheDirectoryPath ?? DEFAULT_CACHE_DIRECTORY;
  const primaryProvider = options.primaryProvider ?? "ibkr";
  const comparisonProvider = options.comparisonProvider ?? "twelve_data";
  const timeframes = options.timeframes ?? DEFAULT_TIMEFRAMES;
  const highCloseDriftPct = options.highCloseDriftPct ?? 1;
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
    symbols.push({ symbol, timeframeComparisons, levelComparison });
  }

  const allTimeframes = symbols.flatMap((symbol) => symbol.timeframeComparisons);
  const highDynamicDriftCount = allTimeframes.filter((comparison) =>
    [comparison.vwapDriftPct, comparison.ema9DriftPct, comparison.ema20DriftPct].some(
      (value) => typeof value === "number" && value >= highDynamicDriftPct,
    ),
  ).length;
  const levelDriftWatchCount = symbols.filter((symbol) =>
    symbol.levelComparison.status === "compared" &&
    (Math.abs(symbol.levelComparison.supportCountDelta ?? 0) >= 3 ||
      Math.abs(symbol.levelComparison.resistanceCountDelta ?? 0) >= 3 ||
      symbol.levelComparison.primaryHasForwardResistance !== symbol.levelComparison.comparisonHasForwardResistance),
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
      highDynamicDriftCount,
      levelDriftWatchCount,
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
    `- high dynamic drift: ${report.totals.highDynamicDriftCount}`,
    `- level drift watch: ${report.totals.levelDriftWatchCount}`,
    "",
    "## Symbol Evidence",
    "",
    "| Symbol | TF | Status | Primary Count | Compare Count | Primary Latest | Compare Latest | Close Drift | VWAP Drift | EMA9 Drift | EMA20 Drift |",
    "| --- | --- | --- | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: |",
  ];

  for (const symbol of report.symbols.slice(0, 80)) {
    for (const comparison of symbol.timeframeComparisons) {
      lines.push(
        `| ${symbol.symbol} | ${comparison.timeframe} | ${comparison.status} | ${comparison.primaryCount} | ${comparison.comparisonCount} | ${formatTimestamp(comparison.primaryLatestTimestamp)} | ${formatTimestamp(comparison.comparisonLatestTimestamp)} | ${pct(comparison.latestCloseDriftPct)} | ${pct(comparison.vwapDriftPct)} | ${pct(comparison.ema9DriftPct)} | ${pct(comparison.ema20DriftPct)} |`,
      );
    }
  }

  lines.push("", "## Level Comparison", "");
  for (const symbol of report.symbols.slice(0, 80)) {
    const level = symbol.levelComparison;
    lines.push(
      `- ${symbol.symbol}: ${level.status}; ${level.reason}; support ${level.primarySupportCount ?? "n/a"} vs ${level.comparisonSupportCount ?? "n/a"}; resistance ${level.primaryResistanceCount ?? "n/a"} vs ${level.comparisonResistanceCount ?? "n/a"}; forward resistance ${level.primaryHasForwardResistance ?? "n/a"} vs ${level.comparisonHasForwardResistance ?? "n/a"}`,
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
