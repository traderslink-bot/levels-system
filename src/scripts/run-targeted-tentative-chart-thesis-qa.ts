import "dotenv/config";

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ChartThesisRead } from "../lib/alerts/alert-types.js";
import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import type { Candle, CandleProviderResponse, CandleTimeframe } from "../lib/market-data/candle-types.js";
import {
  buildChartThesisRead,
  buildImpulseFlagContinuationReadForQa,
} from "../lib/monitoring/chart-thesis-engine.js";
import {
  fetchNasdaqScreenerRows,
  normalizeNasdaqRow,
  readNasdaqUniverseSnapshot,
  type NasdaqUniverseRow,
} from "../lib/review/nasdaq-marketcap-universe.js";
import {
  resolveValidationCandleCacheMode,
  ValidationCachedCandleFetchService,
} from "../lib/validation/validation-candle-cache.js";

type TentativeThesisType =
  | "compression_breakout"
  | "opening_range_expansion"
  | "live_volume_expansion_confirmation"
  | "impulse_flag_continuation"
  | "cleared_shelf_power_continuation"
  | "quiet_range_accumulation"
  | "quiet_base_measured_expansion"
  | "upper_range_ignition";

type ForcedThesisType = "engine_best" | "impulse_flag_continuation";

type Outcome = "hit_target" | "partial_progress" | "invalidated" | "no_progress" | "insufficient_forward";

type TentativeQaRow = {
  symbol: string;
  cutoffTimestamp: number;
  cutoffIso: string;
  currentPrice: number;
  thesisType: TentativeThesisType;
  label: string;
  status: ChartThesisRead["status"];
  confidence: ChartThesisRead["confidence"];
  score: number;
  targetPrice: number | null;
  invalidationPrice: number | null;
  roomToTargetPct: number | null;
  outcome: Outcome;
  bestForwardPct: number;
  worstForwardPct: number;
  targetReached: boolean;
  invalidatedBeforeTarget: boolean;
  barsToTarget: number | null;
  forwardBars: number;
  diagnostics: TentativeSetupDiagnostics | null;
  lines: string[];
};

type TentativeSetupDiagnostics = {
  rangePct: number | null;
  positionPct: number | null;
  buyerLiftPct: number | null;
  latestRangePct: number | null;
  rangeExpansionRatio: number | null;
  constructiveRecentCount: number | null;
  latestUpperCloseRatio: number | null;
  triggerGapPct: number | null;
  activeAtCutoff: boolean | null;
};

type TentativeQaStats = {
  thesisType: TentativeThesisType;
  samples: number;
  hitTarget: number;
  partialProgress: number;
  invalidated: number;
  noProgress: number;
  insufficientForward: number;
  usefulCount: number;
  usefulRate: number;
  hitRate: number;
  invalidationRate: number;
  move15Count: number;
  move25Count: number;
  move50Count: number;
  move100Count: number;
  avgBestForwardPct: number | null;
  avgWorstForwardPct: number | null;
  avgRoomToTargetPct: number | null;
  statusCounts: Record<ChartThesisRead["status"], number>;
};

type FetchResult = {
  symbol: string;
  marketCap: number;
  volume: number;
  timeframe: CandleTimeframe;
  status: "fetched" | "empty" | "failed";
  candles: number;
  error?: string;
};

const TENTATIVE_TYPES = new Set<TentativeThesisType>([
  "compression_breakout",
  "opening_range_expansion",
  "live_volume_expansion_confirmation",
  "impulse_flag_continuation",
  "cleared_shelf_power_continuation",
  "quiet_range_accumulation",
  "quiet_base_measured_expansion",
  "upper_range_ignition",
]);

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function numberArg(flag: string, fallback: number): number {
  const raw = argValue(flag);
  if (raw === undefined) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${flag} value "${raw}".`);
  }
  return value;
}

function positiveIntegerArg(flag: string, fallback: number): number {
  const value = Math.floor(numberArg(flag, fallback));
  return value > 0 ? value : fallback;
}

function forcedThesisArg(): ForcedThesisType {
  const raw = argValue("--force-thesis");
  if (raw === undefined || raw === "engine_best") {
    return "engine_best";
  }
  if (raw === "impulse_flag_continuation") {
    return raw;
  }
  throw new Error(`Invalid --force-thesis value "${raw}". Supported values: engine_best, impulse_flag_continuation.`);
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function marketCapLabel(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readUniverseRows(path: string, refresh: boolean): Promise<NasdaqUniverseRow[]> {
  if (refresh) {
    const rows = await fetchNasdaqScreenerRows();
    return rows.map(normalizeNasdaqRow);
  }
  return (await readNasdaqUniverseSnapshot(path)).rows;
}

function selectSmallCapRows(rows: NasdaqUniverseRow[], params: {
  maxMarketCap: number;
  minVolume: number;
  maxSymbols: number;
}): NasdaqUniverseRow[] {
  return rows
    .filter((row) =>
      row.isLikelyCommonEquity &&
      row.marketCap > 0 &&
      row.marketCap <= params.maxMarketCap &&
      row.volume >= params.minVolume,
    )
    .sort((left, right) => right.volume - left.volume || left.marketCap - right.marketCap)
    .slice(0, params.maxSymbols);
}

function isValidCandle(candle: Candle): boolean {
  return (
    Number.isFinite(candle.timestamp) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    candle.open > 0 &&
    candle.high > 0 &&
    candle.low > 0 &&
    candle.close > 0 &&
    candle.high >= candle.low
  );
}

function normalizeCandles(candles: Candle[]): Candle[] {
  return candles
    .filter(isValidCandle)
    .sort((left, right) => left.timestamp - right.timestamp);
}

function candleRange(candle: Candle): number {
  return candle.high - candle.low;
}

function upperCloseRatio(candle: Candle): number {
  const range = candleRange(candle);
  return range <= 0 ? 0 : (candle.close - candle.low) / range;
}

function cloneResponseAtCutoff(
  response: CandleProviderResponse | undefined,
  cutoffTimestamp: number,
): CandleProviderResponse | undefined {
  if (!response) {
    return undefined;
  }

  return {
    ...response,
    candles: normalizeCandles(response.candles).filter((candle) => candle.timestamp <= cutoffTimestamp),
  };
}

function targetPriceForThesis(thesis: ChartThesisRead): number | null {
  if (thesis.targetLow !== undefined && Number.isFinite(thesis.targetLow)) {
    return thesis.targetLow;
  }

  if (thesis.returnTargetLow !== undefined && Number.isFinite(thesis.returnTargetLow)) {
    return thesis.returnTargetLow;
  }

  if (thesis.targetHigh !== undefined && Number.isFinite(thesis.targetHigh)) {
    return thesis.targetHigh;
  }

  return null;
}

function buildTentativeSetupDiagnostics(params: {
  currentPrice: number;
  thesis: ChartThesisRead;
  fourHourCandles: Candle[];
}): TentativeSetupDiagnostics | null {
  const latest = params.fourHourCandles.at(-1);
  if (!latest || params.fourHourCandles.length < 9) {
    return null;
  }

  const prior = params.fourHourCandles.slice(-9, -1);
  const recent = params.fourHourCandles.slice(-4);
  if (prior.length < 8 || recent.length < 4) {
    return null;
  }

  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const range = priorHigh - priorLow;
  if (range <= 0) {
    return null;
  }

  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const averagePriorRange = prior.reduce((sum, candle) => sum + candleRange(candle), 0) / Math.max(prior.length, 1);
  const latestRange = candleRange(latest);
  const trigger = params.thesis.triggerHigh ?? params.thesis.triggerLow ?? null;

  return {
    rangePct: (range / Math.max(params.currentPrice, 0.0001)) * 100,
    positionPct: ((params.currentPrice - priorLow) / Math.max(range, 0.0001)) * 100,
    buyerLiftPct: ((params.currentPrice - recentLow) / Math.max(recentLow, 0.0001)) * 100,
    latestRangePct: (latestRange / Math.max(params.currentPrice, 0.0001)) * 100,
    rangeExpansionRatio: latestRange / Math.max(averagePriorRange, 0.0001),
    constructiveRecentCount: recent.filter((candle) => candle.close >= candle.open || upperCloseRatio(candle) >= 0.55).length,
    latestUpperCloseRatio: upperCloseRatio(latest),
    triggerGapPct:
      trigger === null || !Number.isFinite(trigger)
        ? null
        : ((trigger - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100,
    activeAtCutoff: trigger === null || !Number.isFinite(trigger) ? null : params.currentPrice >= trigger,
  };
}

function evaluateOutcome(params: {
  currentPrice: number;
  targetPrice: number | null;
  invalidationPrice: number | null;
  forwardCandles: Candle[];
  partialProgressRatio: number;
}): {
  outcome: Outcome;
  bestForwardPct: number;
  worstForwardPct: number;
  targetReached: boolean;
  invalidatedBeforeTarget: boolean;
  barsToTarget: number | null;
  forwardBars: number;
} {
  if (params.forwardCandles.length === 0) {
    return {
      outcome: "insufficient_forward",
      bestForwardPct: 0,
      worstForwardPct: 0,
      targetReached: false,
      invalidatedBeforeTarget: false,
      barsToTarget: null,
      forwardBars: 0,
    };
  }

  const bestHigh = Math.max(...params.forwardCandles.map((candle) => candle.high));
  const worstLow = Math.min(...params.forwardCandles.map((candle) => candle.low));
  const bestForwardPct = ((bestHigh - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100;
  const worstForwardPct = ((worstLow - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100;
  let targetReached = false;
  let invalidatedBeforeTarget = false;
  let barsToTarget: number | null = null;

  for (let index = 0; index < params.forwardCandles.length; index += 1) {
    const candle = params.forwardCandles[index]!;
    if (params.invalidationPrice !== null && candle.low <= params.invalidationPrice && !targetReached) {
      invalidatedBeforeTarget = true;
      break;
    }

    if (params.targetPrice !== null && candle.high >= params.targetPrice) {
      targetReached = true;
      barsToTarget = index + 1;
      break;
    }
  }

  if (targetReached) {
    return {
      outcome: "hit_target",
      bestForwardPct,
      worstForwardPct,
      targetReached,
      invalidatedBeforeTarget,
      barsToTarget,
      forwardBars: params.forwardCandles.length,
    };
  }

  if (invalidatedBeforeTarget) {
    return {
      outcome: "invalidated",
      bestForwardPct,
      worstForwardPct,
      targetReached,
      invalidatedBeforeTarget,
      barsToTarget,
      forwardBars: params.forwardCandles.length,
    };
  }

  const targetRoomPct =
    params.targetPrice === null
      ? null
      : ((params.targetPrice - params.currentPrice) / Math.max(params.currentPrice, 0.0001)) * 100;
  const partialThreshold = targetRoomPct === null
    ? Number.POSITIVE_INFINITY
    : Math.max(8, targetRoomPct * params.partialProgressRatio);

  return {
    outcome: bestForwardPct >= partialThreshold ? "partial_progress" : "no_progress",
    bestForwardPct,
    worstForwardPct,
    targetReached,
    invalidatedBeforeTarget,
    barsToTarget,
    forwardBars: params.forwardCandles.length,
  };
}

function cutoffIndexes(candles: Candle[], params: {
  horizonBars: number;
  minHistoryBars: number;
  strideBars: number;
  maxCutoffsPerSymbol: number;
}): number[] {
  const latestUsable = candles.length - params.horizonBars - 1;
  if (latestUsable < params.minHistoryBars) {
    return [];
  }

  const indexes: number[] = [];
  for (let index = params.minHistoryBars; index <= latestUsable; index += params.strideBars) {
    indexes.push(index);
  }

  if (indexes.length <= params.maxCutoffsPerSymbol) {
    return indexes;
  }

  const sampled = new Set<number>();
  const span = indexes.length - 1;
  for (let step = 0; step < params.maxCutoffsPerSymbol; step += 1) {
    const sourceIndex = Math.round((span * step) / Math.max(1, params.maxCutoffsPerSymbol - 1));
    sampled.add(indexes[sourceIndex]!);
  }
  return [...sampled].sort((left, right) => left - right);
}

function buildRow(params: {
  symbol: string;
  cutoffIndex: number;
  fourHourCandles: Candle[];
  seriesMap: Partial<Record<CandleTimeframe, CandleProviderResponse>>;
  horizonBars: number;
  partialProgressRatio: number;
  forcedThesis: ForcedThesisType;
}): TentativeQaRow | null {
  const cutoffCandle = params.fourHourCandles[params.cutoffIndex]!;
  const cutoffTimestamp = cutoffCandle.timestamp;
  const currentPrice = cutoffCandle.close;
  const truncatedSeriesMap: Partial<Record<CandleTimeframe, CandleProviderResponse>> = {
    daily: cloneResponseAtCutoff(params.seriesMap.daily, cutoffTimestamp),
    "4h": cloneResponseAtCutoff(params.seriesMap["4h"], cutoffTimestamp),
    "5m": cloneResponseAtCutoff(params.seriesMap["5m"], cutoffTimestamp),
  };
  const engineInput = {
    symbol: params.symbol,
    currentPrice,
    seriesMap: truncatedSeriesMap,
  };
  const thesis = params.forcedThesis === "impulse_flag_continuation"
    ? buildImpulseFlagContinuationReadForQa(engineInput)
    : buildChartThesisRead(engineInput);
  if (!thesis || !TENTATIVE_TYPES.has(thesis.type as TentativeThesisType)) {
    return null;
  }
  if (params.forcedThesis !== "engine_best" && thesis.type !== params.forcedThesis) {
    return null;
  }

  const targetPrice = targetPriceForThesis(thesis);
  const invalidationPrice =
    thesis.invalidationLevel !== undefined && Number.isFinite(thesis.invalidationLevel)
      ? thesis.invalidationLevel
      : null;
  const forwardCandles = params.fourHourCandles.slice(
    params.cutoffIndex + 1,
    params.cutoffIndex + 1 + params.horizonBars,
  );
  const evaluation = evaluateOutcome({
    currentPrice,
    targetPrice,
    invalidationPrice,
    forwardCandles,
    partialProgressRatio: params.partialProgressRatio,
  });
  const roomToTargetPct = targetPrice === null
    ? null
    : ((targetPrice - currentPrice) / Math.max(currentPrice, 0.0001)) * 100;

  return {
    symbol: params.symbol,
    cutoffTimestamp,
    cutoffIso: new Date(cutoffTimestamp).toISOString(),
    currentPrice,
    thesisType: thesis.type as TentativeThesisType,
    label: thesis.label,
    status: thesis.status,
    confidence: thesis.confidence,
    score: thesis.score,
    targetPrice,
    invalidationPrice,
    roomToTargetPct,
    ...evaluation,
    diagnostics: buildTentativeSetupDiagnostics({
      currentPrice,
      thesis,
      fourHourCandles: truncatedSeriesMap["4h"]?.candles ?? [],
    }),
    lines: thesis.lines,
  };
}

function emptyStatusCounts(): Record<ChartThesisRead["status"], number> {
  return {
    active: 0,
    watch: 0,
    early: 0,
  };
}

function buildStats(rows: TentativeQaRow[]): TentativeQaStats[] {
  const byType = new Map<TentativeThesisType, TentativeQaRow[]>();
  for (const row of rows) {
    const existing = byType.get(row.thesisType) ?? [];
    existing.push(row);
    byType.set(row.thesisType, existing);
  }

  return [...byType.entries()]
    .map(([thesisType, items]) => {
      const hitTarget = items.filter((row) => row.outcome === "hit_target").length;
      const partialProgress = items.filter((row) => row.outcome === "partial_progress").length;
      const invalidated = items.filter((row) => row.outcome === "invalidated").length;
      const usefulCount = hitTarget + partialProgress;
      const bestValues = items.map((row) => row.bestForwardPct).filter(Number.isFinite);
      const worstValues = items.map((row) => row.worstForwardPct).filter(Number.isFinite);
      const roomValues = items
        .map((row) => row.roomToTargetPct)
        .filter((value): value is number => value !== null && Number.isFinite(value));
      return {
        thesisType,
        samples: items.length,
        hitTarget,
        partialProgress,
        invalidated,
        noProgress: items.filter((row) => row.outcome === "no_progress").length,
        insufficientForward: items.filter((row) => row.outcome === "insufficient_forward").length,
        usefulCount,
        usefulRate: items.length === 0 ? 0 : usefulCount / items.length,
        hitRate: items.length === 0 ? 0 : hitTarget / items.length,
        invalidationRate: items.length === 0 ? 0 : invalidated / items.length,
        move15Count: items.filter((row) => row.bestForwardPct >= 15).length,
        move25Count: items.filter((row) => row.bestForwardPct >= 25).length,
        move50Count: items.filter((row) => row.bestForwardPct >= 50).length,
        move100Count: items.filter((row) => row.bestForwardPct >= 100).length,
        avgBestForwardPct: bestValues.length === 0
          ? null
          : bestValues.reduce((sum, value) => sum + value, 0) / bestValues.length,
        avgWorstForwardPct: worstValues.length === 0
          ? null
          : worstValues.reduce((sum, value) => sum + value, 0) / worstValues.length,
        avgRoomToTargetPct: roomValues.length === 0
          ? null
          : roomValues.reduce((sum, value) => sum + value, 0) / roomValues.length,
        statusCounts: items.reduce((counts, row) => {
          counts[row.status] += 1;
          return counts;
        }, emptyStatusCounts()),
      };
    })
    .sort((left, right) => right.samples - left.samples || right.usefulRate - left.usefulRate);
}

function renderMarkdown(report: {
  generatedAt: string;
  source: string;
  settings: Record<string, unknown>;
  totals: Record<string, unknown>;
  stats: TentativeQaStats[];
  goodExamples: TentativeQaRow[];
  badExamples: TentativeQaRow[];
}): string {
  const lines: string[] = [];
  lines.push("# Targeted Tentative Chart Thesis QA");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Source: ${report.source}`);
  lines.push("");
  lines.push("## Totals");
  for (const [key, value] of Object.entries(report.totals)) {
    lines.push(`- ${key}: ${String(value)}`);
  }
  lines.push("");
  lines.push("## Thesis Stats");
  lines.push("| Thesis | Samples | Useful | Useful % | Hit % | Invalid % | >=25% | >=50% | Avg best | Avg room | Statuses |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const stat of report.stats) {
    lines.push([
      stat.thesisType,
      stat.samples,
      stat.usefulCount,
      `${(stat.usefulRate * 100).toFixed(1)}%`,
      `${(stat.hitRate * 100).toFixed(1)}%`,
      `${(stat.invalidationRate * 100).toFixed(1)}%`,
      stat.move25Count,
      stat.move50Count,
      formatPct(stat.avgBestForwardPct),
      formatPct(stat.avgRoomToTargetPct),
      `active ${stat.statusCounts.active}, watch ${stat.statusCounts.watch}, early ${stat.statusCounts.early}`,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("");
  lines.push("## Best Examples");
  for (const row of report.goodExamples) {
    lines.push(
      `- ${row.symbol} ${row.cutoffIso} ${row.thesisType}: ${row.outcome}, best ${formatPct(row.bestForwardPct)}, target ${formatPrice(row.targetPrice)}, room ${formatPct(row.roomToTargetPct)}.`,
    );
  }
  lines.push("");
  lines.push("## Weak / False Positive Examples");
  for (const row of report.badExamples) {
    lines.push(
      `- ${row.symbol} ${row.cutoffIso} ${row.thesisType}: ${row.outcome}, best ${formatPct(row.bestForwardPct)}, worst ${formatPct(row.worstForwardPct)}, target ${formatPrice(row.targetPrice)}.`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const universePath = argValue("--universe") ?? "data/nasdaq-universe/nasdaq-current-universe.json";
const outputDirectory = argValue("--out-dir") ?? join("artifacts", "chart-thesis-qa-targeted-tentative-under30m");
const cacheDirectoryPath = argValue("--cache-dir") ?? join(process.cwd(), ".validation-cache", "candles");
const cacheMode = resolveValidationCandleCacheMode(argValue("--cache-mode") ?? "replay");
const maxMarketCap = numberArg("--max-market-cap", 30_000_000);
const minVolume = numberArg("--min-volume", 50_000);
const maxSymbols = positiveIntegerArg("--max-symbols", 500);
const throttleMs = positiveIntegerArg("--throttle-ms", 1);
const dailyLookback = positiveIntegerArg("--daily-lookback", 180);
const fourHourLookback = positiveIntegerArg("--4h-lookback", 240);
const fiveMinuteLookback = positiveIntegerArg("--5m-lookback", 1_950);
const includeFiveMinute = hasFlag("--include-5m");
const horizonBars = positiveIntegerArg("--horizon-bars", 10);
const minHistoryBars = positiveIntegerArg("--min-history-bars", 10);
const strideBars = positiveIntegerArg("--stride-bars", 1);
const maxCutoffsPerSymbol = positiveIntegerArg("--max-cutoffs-per-symbol", 220);
const partialProgressRatio = Math.max(0.1, Math.min(0.9, numberArg("--partial-progress-ratio", 0.55)));
const maxExamples = positiveIntegerArg("--max-examples", 40);
const refreshUniverse = hasFlag("--refresh-universe");
const forcedThesis = forcedThesisArg();

const rows = await readUniverseRows(universePath, refreshUniverse);
const selectedRows = selectSmallCapRows(rows, {
  maxMarketCap,
  minVolume,
  maxSymbols,
});
await mkdir(outputDirectory, { recursive: true });

const service = new ValidationCachedCandleFetchService(new CandleFetchService({ providerName: "eodhd" }), {
  cacheDirectoryPath,
  mode: cacheMode,
});
const fetchResultsPath = join(outputDirectory, "fetch-results.jsonl");
const qaRows: TentativeQaRow[] = [];
const selected = selectedRows.map((row) => ({
  symbol: row.symbol,
  name: row.name,
  marketCap: row.marketCap,
  volume: row.volume,
  sector: row.sector,
  industry: row.industry,
}));

console.log(
  `[TargetedTentativeChartThesisQA] selected=${selectedRows.length} maxMarketCap=${marketCapLabel(maxMarketCap)} cacheMode=${cacheMode} include5m=${includeFiveMinute}`,
);

for (const row of selectedRows) {
  const seriesMap: Partial<Record<CandleTimeframe, CandleProviderResponse>> = {};
  for (const timeframe of (includeFiveMinute ? ["daily", "4h", "5m"] : ["daily", "4h"]) as CandleTimeframe[]) {
    const lookbackBars = timeframe === "daily"
      ? dailyLookback
      : timeframe === "4h"
        ? fourHourLookback
        : fiveMinuteLookback;
    let result: FetchResult;
    try {
      const response = await service.fetchCandles({
        symbol: row.symbol,
        timeframe,
        lookbackBars,
        preferredProvider: "eodhd",
      });
      seriesMap[timeframe] = { ...response, candles: normalizeCandles(response.candles) };
      result = {
        symbol: row.symbol,
        marketCap: row.marketCap,
        volume: row.volume,
        timeframe,
        status: response.candles.length > 0 ? "fetched" : "empty",
        candles: response.candles.length,
      };
    } catch (error) {
      result = {
        symbol: row.symbol,
        marketCap: row.marketCap,
        volume: row.volume,
        timeframe,
        status: "failed",
        candles: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    await appendFile(fetchResultsPath, `${JSON.stringify({ ...result, timestamp: Date.now() })}\n`, "utf8");
    await sleep(throttleMs);
  }

  const fourHourCandles = normalizeCandles(seriesMap["4h"]?.candles ?? []);
  const indexes = cutoffIndexes(fourHourCandles, {
    horizonBars,
    minHistoryBars,
    strideBars,
    maxCutoffsPerSymbol,
  });
  let matches = 0;
  for (const cutoffIndex of indexes) {
    const qaRow = buildRow({
      symbol: row.symbol,
      cutoffIndex,
      fourHourCandles,
      seriesMap,
      horizonBars,
      partialProgressRatio,
      forcedThesis,
    });
    if (qaRow) {
      qaRows.push(qaRow);
      matches += 1;
    }
  }
  console.log(
    `[TargetedTentativeChartThesisQA] ${row.symbol} 4h=${fourHourCandles.length} cutoffs=${indexes.length} tentativeMatches=${matches}`,
  );
}

const stats = buildStats(qaRows);
const goodExamples = qaRows
  .filter((row) => row.outcome === "hit_target" || row.outcome === "partial_progress")
  .sort((left, right) => right.bestForwardPct - left.bestForwardPct)
  .slice(0, maxExamples);
const badExamples = qaRows
  .filter((row) => row.outcome === "invalidated" || row.outcome === "no_progress")
  .sort((left, right) => left.bestForwardPct - right.bestForwardPct || right.score - left.score)
  .slice(0, maxExamples);
const generatedAt = new Date().toISOString();
const report = {
  generatedAt,
  source: [
    "targeted all-cutoff tentative thesis scan",
    `${selectedRows.length} Nasdaq common equities`,
    `marketCap<=${marketCapLabel(maxMarketCap)}`,
    `minVolume>=${minVolume}`,
    refreshUniverse ? "live Nasdaq screener" : "saved Nasdaq snapshot",
    `cacheMode=${cacheMode}`,
  ].join(" | "),
  settings: {
    universePath: refreshUniverse ? "live Nasdaq screener" : universePath,
    outputDirectory,
    maxMarketCap,
    minVolume,
    maxSymbols,
    dailyLookback,
    fourHourLookback,
    includeFiveMinute,
    fiveMinuteLookback,
    horizonBars,
    minHistoryBars,
    strideBars,
    maxCutoffsPerSymbol,
    partialProgressRatio,
    forcedThesis,
    tentativeTypes: [...TENTATIVE_TYPES],
  },
  totals: {
    selectedSymbols: selectedRows.length,
    symbolsWithMatches: new Set(qaRows.map((row) => row.symbol)).size,
    tentativeMatches: qaRows.length,
    hitTarget: qaRows.filter((row) => row.outcome === "hit_target").length,
    partialProgress: qaRows.filter((row) => row.outcome === "partial_progress").length,
    invalidated: qaRows.filter((row) => row.outcome === "invalidated").length,
    noProgress: qaRows.filter((row) => row.outcome === "no_progress").length,
    insufficientForward: qaRows.filter((row) => row.outcome === "insufficient_forward").length,
    move25: qaRows.filter((row) => row.bestForwardPct >= 25).length,
    move50: qaRows.filter((row) => row.bestForwardPct >= 50).length,
    move100: qaRows.filter((row) => row.bestForwardPct >= 100).length,
  },
  selected,
  stats,
  goodExamples,
  badExamples,
  rows: qaRows,
};

await writeFile(join(outputDirectory, "tentative-thesis-targeted-qa.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(join(outputDirectory, "tentative-thesis-targeted-qa.md"), renderMarkdown(report), "utf8");

console.log(
  `[TargetedTentativeChartThesisQA] matches=${qaRows.length} symbolsWithMatches=${new Set(qaRows.map((row) => row.symbol)).size} hit/partial/invalid/noProgress=${report.totals.hitTarget}/${report.totals.partialProgress}/${report.totals.invalidated}/${report.totals.noProgress}`,
);
console.log(`[TargetedTentativeChartThesisQA] wrote ${join(outputDirectory, "tentative-thesis-targeted-qa.md")}`);
