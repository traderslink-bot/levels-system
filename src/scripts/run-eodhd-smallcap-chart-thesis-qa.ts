import "dotenv/config";

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import type { CandleProviderResponse, CandleTimeframe } from "../lib/market-data/candle-types.js";
import {
  fetchNasdaqScreenerRows,
  normalizeNasdaqRow,
  readNasdaqUniverseSnapshot,
  type NasdaqUniverseRow,
} from "../lib/review/nasdaq-marketcap-universe.js";
import {
  writeChartThesisQaReport,
  type ChartThesisQaSymbolInput,
} from "../lib/review/chart-thesis-qa-report.js";
import { writeFiveMinuteConfirmationAudit } from "../lib/review/five-minute-confirmation-audit.js";
import {
  ValidationCachedCandleFetchService,
} from "../lib/validation/validation-candle-cache.js";

type FetchResult = {
  symbol: string;
  marketCap: number;
  volume: number;
  timeframe: CandleTimeframe;
  status: "fetched" | "empty" | "failed";
  candles: number;
  error?: string;
};

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

function marketCapLabel(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return `$${Math.round(value).toLocaleString("en-US")}`;
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function timeframeLookback(timeframe: CandleTimeframe, lookbacks: Record<CandleTimeframe, number>): number {
  return lookbacks[timeframe];
}

function sourceLine(params: {
  rows: NasdaqUniverseRow[];
  provider: string;
  maxMarketCap: number;
  minVolume: number;
  refreshUniverse: boolean;
}): string {
  return [
    `${params.provider} refreshed candles`,
    `${params.rows.length} Nasdaq common equities`,
    `marketCap<=${marketCapLabel(params.maxMarketCap)}`,
    `minVolume>=${params.minVolume}`,
    params.refreshUniverse ? "live Nasdaq screener" : "saved Nasdaq snapshot",
  ].join(" | ");
}

const universePath = argValue("--universe") ?? "data/nasdaq-universe/nasdaq-current-universe.json";
const outputDirectory = argValue("--out-dir") ?? join("artifacts", "chart-thesis-qa-report-eodhd-under30m");
const cacheDirectoryPath = argValue("--cache-dir") ?? join(process.cwd(), ".validation-cache", "candles");
const maxMarketCap = numberArg("--max-market-cap", 30_000_000);
const minVolume = numberArg("--min-volume", 50_000);
const maxSymbols = positiveIntegerArg("--max-symbols", 25);
const throttleMs = positiveIntegerArg("--throttle-ms", 750);
const dailyLookback = positiveIntegerArg("--daily-lookback", 180);
const fourHourLookback = positiveIntegerArg("--4h-lookback", 180);
const fiveMinuteLookback = positiveIntegerArg("--5m-lookback", 1_950);
const horizonBars = positiveIntegerArg("--horizon-bars", 10);
const samplesPerSymbol = positiveIntegerArg("--samples-per-symbol", 12);
const meaningfulMovePct = numberArg("--meaningful-move-pct", 25);
const maxExamples = positiveIntegerArg("--max-examples", 100);
const fiveMinuteHorizonBars = positiveIntegerArg("--5m-horizon-bars", 24);
const fiveMinuteTargetMovePct = numberArg("--5m-target-pct", 15);
const fiveMinutePartialMovePct = numberArg("--5m-partial-pct", 8);
const refreshUniverse = hasFlag("--refresh-universe");
const timeframes: CandleTimeframe[] = ["daily", "4h", "5m"];
const lookbacks: Record<CandleTimeframe, number> = {
  daily: dailyLookback,
  "4h": fourHourLookback,
  "5m": fiveMinuteLookback,
};

const rows = await readUniverseRows(universePath, refreshUniverse);
const selectedRows = selectSmallCapRows(rows, {
  maxMarketCap,
  minVolume,
  maxSymbols,
});

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  join(outputDirectory, "selected-under30m-symbols.json"),
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    universePath: refreshUniverse ? "live Nasdaq screener" : universePath,
    maxMarketCap,
    minVolume,
    maxSymbols,
    selected: selectedRows.map((row) => ({
      symbol: row.symbol,
      name: row.name,
      marketCap: row.marketCap,
      volume: row.volume,
      sector: row.sector,
      industry: row.industry,
    })),
  }, null, 2)}\n`,
  "utf8",
);

console.log(
  `[EodhdSmallcapChartThesisQA] selected=${selectedRows.length} maxMarketCap=${marketCapLabel(maxMarketCap)} minVolume=${minVolume} refreshUniverse=${refreshUniverse}`,
);
console.log(
  `[EodhdSmallcapChartThesisQA] symbols=${selectedRows.map((row) => row.symbol).join(",")}`,
);

const baseService = new CandleFetchService({ providerName: "eodhd" });
const candleFetchService = new ValidationCachedCandleFetchService(baseService, {
  cacheDirectoryPath,
  mode: "refresh",
});
const resultsPath = join(outputDirectory, "eodhd-fetch-results.jsonl");
const qaSymbols: ChartThesisQaSymbolInput[] = [];

for (const row of selectedRows) {
  const seriesMap: Partial<Record<CandleTimeframe, CandleProviderResponse>> = {};

  for (const timeframe of timeframes) {
    let result: FetchResult;
    try {
      const response = await candleFetchService.fetchCandles({
        symbol: row.symbol,
        timeframe,
        lookbackBars: timeframeLookback(timeframe, lookbacks),
        preferredProvider: "eodhd",
      });
      seriesMap[timeframe] = response;
      result = {
        symbol: row.symbol,
        marketCap: row.marketCap,
        volume: row.volume,
        timeframe,
        status: response.candles.length > 0 ? "fetched" : "empty",
        candles: response.candles.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = {
        symbol: row.symbol,
        marketCap: row.marketCap,
        volume: row.volume,
        timeframe,
        status: "failed",
        candles: 0,
        error: message,
      };
    }

    await appendFile(resultsPath, `${JSON.stringify({ ...result, timestamp: Date.now() })}\n`, "utf8");
    console.log(
      `[EodhdSmallcapChartThesisQA] ${row.symbol} ${timeframe}: ${result.status} candles=${result.candles}`,
    );
    await sleep(throttleMs);
  }

  qaSymbols.push({
    symbol: row.symbol,
    seriesMap,
  });
}

const report = writeChartThesisQaReport({
  symbols: qaSymbols,
  source: sourceLine({
    rows: selectedRows,
    provider: "EODHD",
    maxMarketCap,
    minVolume,
    refreshUniverse,
  }),
  outputDirectory,
  samplesPerSymbol,
  horizonBars,
  meaningfulMovePct,
  maxExamples,
});

const fiveMinuteReport = writeFiveMinuteConfirmationAudit({
  symbols: qaSymbols.map((symbolInput) => ({
    symbol: symbolInput.symbol,
    fiveMinuteResponse: symbolInput.seriesMap["5m"],
  })),
  source: sourceLine({
    rows: selectedRows,
    provider: "EODHD",
    maxMarketCap,
    minVolume,
    refreshUniverse,
  }),
  outputDirectory,
  horizonBars: fiveMinuteHorizonBars,
  targetMovePct: fiveMinuteTargetMovePct,
  partialMovePct: fiveMinutePartialMovePct,
  maxExamples,
});

console.log(
  `Chart thesis QA: ${report.totals.symbols} symbols, ${report.totals.samplesWithThesis} thesis samples, ${report.totals.hitTarget} target hits, ${report.totals.partialProgress} partial, ${report.totals.invalidated} invalidated, live confirmation total/with-thesis/missed=${report.totals.liveConfirmationPresent}/${report.totals.liveConfirmationWithThesis}/${report.totals.liveConfirmationOnMissedMoves}, ${report.totals.missedMeaningfulMoves} missed meaningful moves.`,
);
console.log(
  `5m confirmation audit: ${fiveMinuteReport.totals.symbolsWithUsable5m}/${fiveMinuteReport.totals.symbols} symbols usable, ${fiveMinuteReport.totals.evaluatedCutoffs} cutoffs, ${fiveMinuteReport.totals.confirmationSamples} confirmations, target/partial/invalid/no-progress=${fiveMinuteReport.totals.targetHit}/${fiveMinuteReport.totals.partialProgress}/${fiveMinuteReport.totals.invalidated}/${fiveMinuteReport.totals.noProgress}.`,
);
console.log(`[EodhdSmallcapChartThesisQA] wrote ${join(outputDirectory, "chart-thesis-qa-report.md")}`);
console.log(`[EodhdSmallcapChartThesisQA] wrote ${join(outputDirectory, "five-minute-confirmation-audit.md")}`);
