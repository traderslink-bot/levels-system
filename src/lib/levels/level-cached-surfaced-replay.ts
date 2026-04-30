// 2026-04-17 11:35 PM America/Toronto
// Build lightweight offline surfaced-validation replay cases from cached candle files.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Candle, CandleTimeframe } from "../market-data/candle-types.js";
import {
  summarizeSurfacedValidationResults,
  validateSurfacedOutputs,
  type LevelSurfacedValidationInput,
  type SurfacedValidationComparison,
  type SurfacedValidationSummary,
} from "./level-surfaced-validation.js";

type ValidationCacheEntry = {
  schemaVersion: number;
  request: {
    symbol: string;
    timeframe: CandleTimeframe;
    lookbackBars: number;
    endTimeMs: number;
    provider: string;
  };
  response: {
    candles: Candle[];
  };
};

type CachedTimeframeFile = {
  path: string;
  symbol: string;
  timeframe: CandleTimeframe;
  lookbackBars: number;
  endTimeMs: number;
};

export type CachedSurfacedReplaySymbolInventory = {
  symbol: string;
  timeframeFileCounts: Record<CandleTimeframe, number>;
  usableForReplay: boolean;
  notes: string[];
};

export type CachedSurfacedReplayCase = LevelSurfacedValidationInput & {
  cacheSource: {
    symbol: string;
    snapshot5mFilePath: string;
    fourHourFilePath: string;
    dailyFilePath: string;
    snapshotBars5m: number;
    forwardBars5m: number;
    snapshotLatestTimestamp: number;
  };
};

export type CachedSurfacedReplaySkippedCase = {
  symbol: string;
  reason: string;
  sourcePath?: string;
};

export type CachedSurfacedReplayPreparation = {
  cacheDirectoryPath: string;
  inventory: CachedSurfacedReplaySymbolInventory[];
  cases: CachedSurfacedReplayCase[];
  skipped: CachedSurfacedReplaySkippedCase[];
};

export type CachedSurfacedReplayManualReviewItem = {
  caseId: string;
  symbol: string;
  winner: SurfacedValidationComparison["winner"];
  reason:
    | "old_win"
    | "mixed_result"
    | "close_score_delta"
    | "broken_handling_signal"
    | "first_interaction_alignment";
  scoreDelta: number;
};

export type CachedSurfacedReplayReport = CachedSurfacedReplayPreparation & {
  results: SurfacedValidationComparison[];
  summary: SurfacedValidationSummary;
  oldWinSymbols: string[];
  brokenHandlingSymbols: string[];
  firstInteractionAlignmentProblemSymbols: string[];
  manualReviewQueue: CachedSurfacedReplayManualReviewItem[];
};

export type CachedSurfacedReplayOptions = {
  cacheDirectoryPath?: string;
  symbols?: string[];
  maxCasesPerSymbol?: number;
  minSnapshotBars5m?: number;
  forwardBars5m?: number;
  minDailyBars?: number;
  minFourHourBars?: number;
  minSnapshotRangePct?: number;
  minForwardRangePct?: number;
};

const DEFAULT_CACHE_DIRECTORY_PATH = join(
  process.cwd(),
  ".validation-cache",
  "candles",
  "ibkr",
);
const DEFAULT_MAX_CASES_PER_SYMBOL = 2;
const DEFAULT_MIN_SNAPSHOT_BARS_5M = 96;
const DEFAULT_FORWARD_BARS_5M = 24;
const DEFAULT_MIN_DAILY_BARS = 40;
const DEFAULT_MIN_FOUR_HOUR_BARS = 60;
const DEFAULT_MIN_SNAPSHOT_RANGE_PCT = 0.01;
const DEFAULT_MIN_FORWARD_RANGE_PCT = 0.01;

function toPositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

function normalizeSymbolFilter(symbols: string[] | undefined): Set<string> | null {
  if (!symbols || symbols.length === 0) {
    return null;
  }

  return new Set(
    symbols
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean),
  );
}

function parseCacheFilename(
  directoryPath: string,
  symbol: string,
  timeframe: CandleTimeframe,
  filename: string,
): CachedTimeframeFile | null {
  if (!filename.endsWith(".json")) {
    return null;
  }

  const separatorIndex = filename.indexOf("-");
  if (separatorIndex <= 0) {
    return null;
  }

  const lookbackBars = Number(filename.slice(0, separatorIndex));
  const endTimeMs = Number(filename.slice(separatorIndex + 1, -".json".length));
  if (!Number.isFinite(lookbackBars) || !Number.isFinite(endTimeMs)) {
    return null;
  }

  return {
    path: join(directoryPath, filename),
    symbol,
    timeframe,
    lookbackBars,
    endTimeMs,
  };
}

async function readCacheMetadata(
  cacheDirectoryPath: string,
  symbol: string,
  timeframe: CandleTimeframe,
): Promise<CachedTimeframeFile[]> {
  const timeframeDirectoryPath = join(cacheDirectoryPath, symbol, timeframe);

  try {
    const filenames = await readdir(timeframeDirectoryPath);
    return filenames
      .map((filename) =>
        parseCacheFilename(timeframeDirectoryPath, symbol, timeframe, filename),
      )
      .filter((value): value is CachedTimeframeFile => value !== null)
      .sort(
        (left, right) =>
          left.endTimeMs - right.endTimeMs || left.lookbackBars - right.lookbackBars,
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readCacheEntry(file: CachedTimeframeFile): Promise<ValidationCacheEntry> {
  const raw = await readFile(file.path, "utf8");
  return JSON.parse(raw) as ValidationCacheEntry;
}

function dedupeAndSortCandles(candles: Candle[]): Candle[] {
  const deduped = new Map<number, Candle>();
  for (const candle of candles) {
    deduped.set(candle.timestamp, candle);
  }

  return [...deduped.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function candleRangePct(candles: Candle[]): number {
  if (candles.length === 0) {
    return 0;
  }

  const highestHigh = Math.max(...candles.map((candle) => candle.high));
  const lowestLow = Math.min(...candles.map((candle) => candle.low));
  const reference = Math.max(candles.at(-1)?.close ?? 0, 0.0001);
  return (highestHigh - lowestLow) / reference;
}

function pickRepresentativeFiveMinuteFiles(
  files: CachedTimeframeFile[],
  minBarsRequired: number,
  maxCasesPerSymbol: number,
): CachedTimeframeFile[] {
  const groupedByEndTime = new Map<number, CachedTimeframeFile>();

  for (const file of files) {
    if (file.lookbackBars < minBarsRequired) {
      continue;
    }

    const current = groupedByEndTime.get(file.endTimeMs);
    if (!current || file.lookbackBars > current.lookbackBars) {
      groupedByEndTime.set(file.endTimeMs, file);
    }
  }

  return [...groupedByEndTime.values()]
    .sort(
      (left, right) =>
        right.endTimeMs - left.endTimeMs || right.lookbackBars - left.lookbackBars,
    )
    .slice(0, maxCasesPerSymbol);
}

function chooseNearestHistoricalFile(
  files: CachedTimeframeFile[],
  snapshotLatestTimestamp: number,
): CachedTimeframeFile | null {
  return files
    .filter((file) => file.endTimeMs <= snapshotLatestTimestamp)
    .sort(
      (left, right) =>
        right.endTimeMs - left.endTimeMs || right.lookbackBars - left.lookbackBars,
    )[0] ?? null;
}

function buildCaseId(
  symbol: string,
  snapshotLatestTimestamp: number,
  replayWindowEndTimeMs: number,
): string {
  return `${symbol.toUpperCase()}-${snapshotLatestTimestamp}-${replayWindowEndTimeMs}`;
}

function buildManualReviewQueue(
  results: SurfacedValidationComparison[],
): CachedSurfacedReplayManualReviewItem[] {
  const items: CachedSurfacedReplayManualReviewItem[] = [];

  for (const result of results) {
    const oldAlignment = result.oldSystem.metrics.firstInteractionAlignmentScore;
    const newAlignment = result.newSystem.metrics.firstInteractionAlignmentScore;
    const brokenSignal =
      result.winner === "old" &&
      [...result.oldSystem.metrics.interactionResults, ...result.newSystem.metrics.interactionResults]
        .some((interaction) => interaction.role === "actionable" && interaction.broken);

    if (result.winner === "old") {
      items.push({
        caseId: result.caseId,
        symbol: result.symbol,
        winner: result.winner,
        reason: "old_win",
        scoreDelta: result.scoreDelta,
      });
    } else if (result.winner === "mixed") {
      items.push({
        caseId: result.caseId,
        symbol: result.symbol,
        winner: result.winner,
        reason: "mixed_result",
        scoreDelta: result.scoreDelta,
      });
    } else if (Math.abs(result.scoreDelta) < 6) {
      items.push({
        caseId: result.caseId,
        symbol: result.symbol,
        winner: result.winner,
        reason: "close_score_delta",
        scoreDelta: result.scoreDelta,
      });
    }

    if (brokenSignal) {
      items.push({
        caseId: result.caseId,
        symbol: result.symbol,
        winner: result.winner,
        reason: "broken_handling_signal",
        scoreDelta: result.scoreDelta,
      });
    }

    if (oldAlignment - newAlignment >= 2) {
      items.push({
        caseId: result.caseId,
        symbol: result.symbol,
        winner: result.winner,
        reason: "first_interaction_alignment",
        scoreDelta: result.scoreDelta,
      });
    }
  }

  return items.sort(
    (left, right) =>
      Math.abs(right.scoreDelta) - Math.abs(left.scoreDelta) ||
      left.symbol.localeCompare(right.symbol) ||
      left.caseId.localeCompare(right.caseId),
  );
}

export async function discoverCachedSurfacedReplayInventory(
  options: Pick<CachedSurfacedReplayOptions, "cacheDirectoryPath" | "symbols"> = {},
): Promise<CachedSurfacedReplaySymbolInventory[]> {
  const cacheDirectoryPath = options.cacheDirectoryPath ?? DEFAULT_CACHE_DIRECTORY_PATH;
  const symbolFilter = normalizeSymbolFilter(options.symbols);

  const directories = await readdir(cacheDirectoryPath, { withFileTypes: true });
  const symbols = directories
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name.toUpperCase())
    .filter((symbol) => !symbolFilter || symbolFilter.has(symbol))
    .sort();

  const inventory: CachedSurfacedReplaySymbolInventory[] = [];

  for (const symbol of symbols) {
    const [dailyFiles, fourHourFiles, fiveMinuteFiles] = await Promise.all([
      readCacheMetadata(cacheDirectoryPath, symbol, "daily"),
      readCacheMetadata(cacheDirectoryPath, symbol, "4h"),
      readCacheMetadata(cacheDirectoryPath, symbol, "5m"),
    ]);

    const notes: string[] = [];
    if (dailyFiles.length === 0) {
      notes.push("missing daily context");
    }
    if (fourHourFiles.length === 0) {
      notes.push("missing 4h context");
    }
    if (fiveMinuteFiles.length === 0) {
      notes.push("missing 5m replay windows");
    }

    inventory.push({
      symbol,
      timeframeFileCounts: {
        daily: dailyFiles.length,
        "4h": fourHourFiles.length,
        "5m": fiveMinuteFiles.length,
      },
      usableForReplay:
        dailyFiles.length > 0 && fourHourFiles.length > 0 && fiveMinuteFiles.length > 0,
      notes,
    });
  }

  return inventory;
}

export async function buildCachedSurfacedReplayCases(
  options: CachedSurfacedReplayOptions = {},
): Promise<CachedSurfacedReplayPreparation> {
  const cacheDirectoryPath = options.cacheDirectoryPath ?? DEFAULT_CACHE_DIRECTORY_PATH;
  const maxCasesPerSymbol = toPositiveInteger(
    options.maxCasesPerSymbol,
    DEFAULT_MAX_CASES_PER_SYMBOL,
  );
  const minSnapshotBars5m = toPositiveInteger(
    options.minSnapshotBars5m,
    DEFAULT_MIN_SNAPSHOT_BARS_5M,
  );
  const forwardBars5m = toPositiveInteger(
    options.forwardBars5m,
    DEFAULT_FORWARD_BARS_5M,
  );
  const minDailyBars = toPositiveInteger(options.minDailyBars, DEFAULT_MIN_DAILY_BARS);
  const minFourHourBars = toPositiveInteger(
    options.minFourHourBars,
    DEFAULT_MIN_FOUR_HOUR_BARS,
  );
  const minSnapshotRangePct =
    options.minSnapshotRangePct ?? DEFAULT_MIN_SNAPSHOT_RANGE_PCT;
  const minForwardRangePct = options.minForwardRangePct ?? DEFAULT_MIN_FORWARD_RANGE_PCT;
  const inventory = await discoverCachedSurfacedReplayInventory({
    cacheDirectoryPath,
    symbols: options.symbols,
  });

  const cases: CachedSurfacedReplayCase[] = [];
  const skipped: CachedSurfacedReplaySkippedCase[] = [];

  for (const symbolInventory of inventory) {
    if (!symbolInventory.usableForReplay) {
      skipped.push({
        symbol: symbolInventory.symbol,
        reason: symbolInventory.notes.join(", ") || "symbol missing required cache files",
      });
      continue;
    }

    const [dailyFiles, fourHourFiles, fiveMinuteFiles] = await Promise.all([
      readCacheMetadata(cacheDirectoryPath, symbolInventory.symbol, "daily"),
      readCacheMetadata(cacheDirectoryPath, symbolInventory.symbol, "4h"),
      readCacheMetadata(cacheDirectoryPath, symbolInventory.symbol, "5m"),
    ]);

    const selectedFiveMinuteFiles = pickRepresentativeFiveMinuteFiles(
      fiveMinuteFiles,
      minSnapshotBars5m + forwardBars5m,
      maxCasesPerSymbol,
    );

    for (const file of selectedFiveMinuteFiles) {
      const fiveMinuteEntry = await readCacheEntry(file);
      const fiveMinuteCandles = dedupeAndSortCandles(fiveMinuteEntry.response.candles);
      if (fiveMinuteCandles.length < minSnapshotBars5m + forwardBars5m) {
        skipped.push({
          symbol: symbolInventory.symbol,
          reason: "5m replay window too short after reading cache entry",
          sourcePath: file.path,
        });
        continue;
      }

      const snapshotCandles5m = fiveMinuteCandles.slice(0, fiveMinuteCandles.length - forwardBars5m);
      const forwardCandles = fiveMinuteCandles.slice(fiveMinuteCandles.length - forwardBars5m);
      const snapshotLatestTimestamp = snapshotCandles5m.at(-1)?.timestamp;
      if (!snapshotLatestTimestamp) {
        skipped.push({
          symbol: symbolInventory.symbol,
          reason: "missing snapshot latest timestamp",
          sourcePath: file.path,
        });
        continue;
      }

      if (
        candleRangePct(snapshotCandles5m) < minSnapshotRangePct &&
        candleRangePct(forwardCandles) < minForwardRangePct
      ) {
        skipped.push({
          symbol: symbolInventory.symbol,
          reason: "insufficient snapshot and forward price motion",
          sourcePath: file.path,
        });
        continue;
      }

      const dailyFile = chooseNearestHistoricalFile(dailyFiles, snapshotLatestTimestamp);
      const fourHourFile = chooseNearestHistoricalFile(fourHourFiles, snapshotLatestTimestamp);
      if (!dailyFile || !fourHourFile) {
        skipped.push({
          symbol: symbolInventory.symbol,
          reason: "missing non-leaking higher-timeframe context",
          sourcePath: file.path,
        });
        continue;
      }

      const [dailyEntry, fourHourEntry] = await Promise.all([
        readCacheEntry(dailyFile),
        readCacheEntry(fourHourFile),
      ]);

      const dailyCandles = dedupeAndSortCandles(dailyEntry.response.candles).filter(
        (candle) => candle.timestamp <= snapshotLatestTimestamp,
      );
      const fourHourCandles = dedupeAndSortCandles(fourHourEntry.response.candles).filter(
        (candle) => candle.timestamp <= snapshotLatestTimestamp,
      );

      if (dailyCandles.length < minDailyBars) {
        skipped.push({
          symbol: symbolInventory.symbol,
          reason: `daily context too short after trimming (${dailyCandles.length})`,
          sourcePath: dailyFile.path,
        });
        continue;
      }
      if (fourHourCandles.length < minFourHourBars) {
        skipped.push({
          symbol: symbolInventory.symbol,
          reason: `4h context too short after trimming (${fourHourCandles.length})`,
          sourcePath: fourHourFile.path,
        });
        continue;
      }

      cases.push({
        caseId: buildCaseId(
          symbolInventory.symbol,
          snapshotLatestTimestamp,
          file.endTimeMs,
        ),
        symbol: symbolInventory.symbol,
        currentPrice: snapshotCandles5m.at(-1)?.close ?? 0,
        snapshotCandlesByTimeframe: {
          daily: dailyCandles,
          "4h": fourHourCandles,
          "5m": snapshotCandles5m,
        },
        forwardCandles,
        latestTimestamp: snapshotLatestTimestamp,
        currentTimeframe: "5m",
        expectedBehaviorLabel: "cache-derived replay validation case",
        cacheSource: {
          symbol: symbolInventory.symbol,
          snapshot5mFilePath: file.path,
          fourHourFilePath: fourHourFile.path,
          dailyFilePath: dailyFile.path,
          snapshotBars5m: snapshotCandles5m.length,
          forwardBars5m: forwardCandles.length,
          snapshotLatestTimestamp,
        },
      });
    }
  }

  return {
    cacheDirectoryPath,
    inventory,
    cases,
    skipped,
  };
}

export async function runCachedSurfacedReplay(
  options: CachedSurfacedReplayOptions = {},
): Promise<CachedSurfacedReplayReport> {
  const preparation = await buildCachedSurfacedReplayCases(options);
  const results = preparation.cases.map((input) => validateSurfacedOutputs(input));
  const summary = summarizeSurfacedValidationResults(results);
  const oldWinSymbols = [...new Set(results.filter((result) => result.winner === "old").map((result) => result.symbol))];
  const brokenHandlingSymbols = [
    ...new Set(
      results
        .filter(
          (result) =>
            result.winner === "old" &&
            [...result.oldSystem.metrics.interactionResults, ...result.newSystem.metrics.interactionResults]
              .some((interaction) => interaction.role === "actionable" && interaction.broken),
        )
        .map((result) => result.symbol),
    ),
  ];
  const firstInteractionAlignmentProblemSymbols = [
    ...new Set(
      results
        .filter(
          (result) =>
            result.oldSystem.metrics.firstInteractionAlignmentScore -
              result.newSystem.metrics.firstInteractionAlignmentScore >=
            2,
        )
        .map((result) => result.symbol),
    ),
  ];

  return {
    ...preparation,
    results,
    summary,
    oldWinSymbols,
    brokenHandlingSymbols,
    firstInteractionAlignmentProblemSymbols,
    manualReviewQueue: buildManualReviewQueue(results),
  };
}
