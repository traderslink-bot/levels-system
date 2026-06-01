import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLevelAnalysisSnapshotFromCandles,
} from "../lib/analysis/level-analysis-snapshot-from-candles.js";
import {
  buildLevelAnalysisSnapshotBatchManifest,
  type LevelAnalysisSnapshotBatchManifest,
} from "../lib/analysis/level-analysis-snapshot-batch-manifest.js";
import type { LevelAnalysisSnapshot } from "../lib/analysis/level-analysis-snapshot.js";
import { candleCloseTimestamp } from "../lib/market-data/candle-as-of-filter.js";
import type {
  Candle,
  CandleFetchTimeframe,
  CandleProviderName,
} from "../lib/market-data/candle-types.js";

type BatchTimeframe = "5m" | "15m" | "4h" | "daily";

type CacheSelection = {
  filePath: string;
  candles: Candle[];
  endTimeMs: number;
  lookbackBars: number;
};

type GeneratedSnapshotArtifact = {
  symbol: string;
  asOfTimestamp: number;
  referencePrice: number;
  artifactPath: string;
  fileSizeBytes: number;
  content: string;
  snapshot: LevelAnalysisSnapshot;
  sourceFiles: Partial<Record<BatchTimeframe, string>>;
};

export type LevelAnalysisSnapshotRealCacheBatchRunnerOptions = {
  cacheRoot: string;
  symbols: string[];
  outRoot: string;
  batchId: string;
  generatedAt: string;
  provider: CandleProviderName;
};

export type LevelAnalysisSnapshotRealCacheBatchRunnerResult = {
  batchId: string;
  generatedAt: string;
  outputRoot: string;
  manifestPath: string;
  artifacts: GeneratedSnapshotArtifact[];
  manifest: LevelAnalysisSnapshotBatchManifest;
  manifestContent: string;
  summaryText: string;
};

const REQUIRED_TIMEFRAMES: BatchTimeframe[] = ["5m", "4h", "daily"];
const OPTIONAL_TIMEFRAMES: BatchTimeframe[] = ["15m"];
const SNAPSHOT_FILE_NAME = "level-analysis-snapshot-v1.json";
const MANIFEST_FILE_NAME = "level-analysis-snapshot-batch-manifest-v1.json";

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function parseProvider(value: string | undefined): CandleProviderName {
  if (value === undefined || value === "ibkr") {
    return "ibkr";
  }
  if (value === "stub" || value === "twelve_data") {
    return value;
  }

  throw new Error(`Unsupported --provider value "${value}".`);
}

function parseGeneratedAt(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid --generated-at value "${value}". Expected ISO date.`);
  }

  return new Date(value).toISOString();
}

function parseSymbols(value: string): string[] {
  const symbols = value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => item.length > 0);

  return [...new Set(symbols)];
}

export function parseLevelAnalysisSnapshotRealCacheBatchRunnerArgs(
  args: string[],
): LevelAnalysisSnapshotRealCacheBatchRunnerOptions {
  let cacheRoot: string | undefined;
  let symbols: string[] | undefined;
  let outRoot: string | undefined;
  let batchId: string | undefined;
  let generatedAt = new Date().toISOString();
  let provider: CandleProviderName = "ibkr";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--cache-root") {
      cacheRoot = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--symbols") {
      symbols = parseSymbols(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--out-root") {
      outRoot = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--batch-id") {
      batchId = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--generated-at") {
      generatedAt = parseGeneratedAt(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--provider") {
      provider = parseProvider(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument "${arg}".`);
  }

  if (!cacheRoot) {
    throw new Error("Missing required --cache-root <path>.");
  }
  if (!symbols || symbols.length === 0) {
    throw new Error("Missing required --symbols <comma-separated>.");
  }
  if (!outRoot) {
    throw new Error("Missing required --out-root <path>.");
  }
  if (!batchId) {
    throw new Error("Missing required --batch-id <id>.");
  }

  return {
    cacheRoot,
    symbols,
    outRoot,
    batchId,
    generatedAt,
    provider,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCandleTimestamp(value: unknown, filePath: string, index: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`Candle ${index} in ${filePath} has invalid timestamp.`);
}

function parseCandleNumber(
  value: unknown,
  field: "open" | "high" | "low" | "close" | "volume",
  filePath: string,
  index: number,
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw new Error(`Candle ${index} in ${filePath} has invalid ${field}.`);
}

function normalizeCandle(value: unknown, filePath: string, index: number): Candle {
  if (!isRecord(value)) {
    throw new Error(`Candle ${index} in ${filePath} must be an object.`);
  }

  const candle: Candle = {
    timestamp: parseCandleTimestamp(value.timestamp, filePath, index),
    open: parseCandleNumber(value.open, "open", filePath, index),
    high: parseCandleNumber(value.high, "high", filePath, index),
    low: parseCandleNumber(value.low, "low", filePath, index),
    close: parseCandleNumber(value.close, "close", filePath, index),
    volume: parseCandleNumber(value.volume, "volume", filePath, index),
  };

  if (candle.high < candle.low) {
    throw new Error(`Candle ${index} in ${filePath} has high below low.`);
  }

  return candle;
}

function extractCandleArray(parsed: unknown, filePath: string): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (isRecord(parsed) && Array.isArray(parsed.candles)) {
    return parsed.candles;
  }
  if (isRecord(parsed) && isRecord(parsed.response) && Array.isArray(parsed.response.candles)) {
    return parsed.response.candles;
  }

  throw new Error(
    `Candle cache JSON from ${filePath} must be an array, object with candles array, or validation-cache response.`,
  );
}

function parseFilenameNumber(filePath: string, part: "lookback" | "endTime"): number | undefined {
  const name = basename(filePath, ".json");
  const separator = name.indexOf("-");
  if (separator <= 0) {
    return undefined;
  }

  const raw = part === "lookback" ? name.slice(0, separator) : name.slice(separator + 1);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numberFromRecord(value: unknown, field: string): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const raw = value[field];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function deriveCacheEndTime(
  parsed: unknown,
  filePath: string,
  timeframe: CandleFetchTimeframe,
  candles: Candle[],
): number {
  if (isRecord(parsed)) {
    const requestEnd = numberFromRecord(parsed.request, "endTimeMs");
    if (requestEnd !== undefined) {
      return requestEnd;
    }

    const responseEnd = numberFromRecord(parsed.response, "requestedEndTimestamp");
    if (responseEnd !== undefined) {
      return responseEnd;
    }
  }

  const filenameEnd = parseFilenameNumber(filePath, "endTime");
  if (filenameEnd !== undefined) {
    return filenameEnd;
  }

  return Math.max(0, ...candles.map((candle) => candleCloseTimestamp(candle, timeframe)));
}

function deriveCacheLookback(parsed: unknown, filePath: string, candles: Candle[]): number {
  if (isRecord(parsed)) {
    const requestLookback = numberFromRecord(parsed.request, "lookbackBars");
    if (requestLookback !== undefined) {
      return requestLookback;
    }

    const responseLookback = numberFromRecord(parsed.response, "requestedLookbackBars");
    if (responseLookback !== undefined) {
      return responseLookback;
    }
  }

  return parseFilenameNumber(filePath, "lookback") ?? candles.length;
}

function readCacheSelection(
  filePath: string,
  timeframe: BatchTimeframe,
): CacheSelection {
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  const candles = extractCandleArray(parsed, filePath).map((item, index) =>
    normalizeCandle(item, filePath, index),
  );

  return {
    filePath,
    candles,
    endTimeMs: deriveCacheEndTime(parsed, filePath, timeframe, candles),
    lookbackBars: deriveCacheLookback(parsed, filePath, candles),
  };
}

function cacheDirectory(
  options: LevelAnalysisSnapshotRealCacheBatchRunnerOptions,
  symbol: string,
  timeframe: BatchTimeframe,
): string {
  return join(options.cacheRoot, options.provider, symbol, timeframe);
}

function latestCacheSelection(
  options: LevelAnalysisSnapshotRealCacheBatchRunnerOptions,
  symbol: string,
  timeframe: BatchTimeframe,
): CacheSelection | undefined {
  const dir = cacheDirectory(options, symbol, timeframe);
  let entries: string[];

  try {
    entries = readdirSync(dir)
      .filter((item) => item.endsWith(".json"))
      .map((item) => join(dir, item));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  const selections = entries.map((filePath) => readCacheSelection(filePath, timeframe));
  selections.sort((left, right) => {
    if (right.endTimeMs !== left.endTimeMs) {
      return right.endTimeMs - left.endTimeMs;
    }
    if (right.lookbackBars !== left.lookbackBars) {
      return right.lookbackBars - left.lookbackBars;
    }
    return left.filePath.localeCompare(right.filePath);
  });

  return selections[0];
}

function requireCacheSelection(
  options: LevelAnalysisSnapshotRealCacheBatchRunnerOptions,
  symbol: string,
  timeframe: BatchTimeframe,
): CacheSelection {
  const selection = latestCacheSelection(options, symbol, timeframe);
  if (!selection) {
    throw new Error(
      `Missing required cached candles for ${symbol} ${timeframe} at ${cacheDirectory(options, symbol, timeframe)}.`,
    );
  }

  return selection;
}

function sortedCandles(candles: Candle[]): Candle[] {
  return [...candles].sort((left, right) => left.timestamp - right.timestamp);
}

function deriveAsOfTimestamp(fiveMinuteCandles: Candle[]): number {
  const latest = sortedCandles(fiveMinuteCandles).at(-1);
  if (!latest) {
    throw new Error("Cannot derive as-of timestamp without 5m candles.");
  }

  return candleCloseTimestamp(latest, "5m");
}

function deriveReferencePrice(fiveMinuteCandles: Candle[]): number {
  const latest = sortedCandles(fiveMinuteCandles).at(-1);
  if (!latest) {
    throw new Error("Cannot derive reference price without 5m candles.");
  }

  return latest.close;
}

function derivePreviousClose(dailyCandles: Candle[], asOfTimestamp: number): number | undefined {
  return sortedCandles(dailyCandles)
    .filter((candle) => candleCloseTimestamp(candle, "daily") <= asOfTimestamp)
    .at(-1)?.close;
}

function outputRoot(options: LevelAnalysisSnapshotRealCacheBatchRunnerOptions): string {
  return join(options.outRoot, options.batchId);
}

function buildSnapshotArtifact(
  options: LevelAnalysisSnapshotRealCacheBatchRunnerOptions,
  symbol: string,
): GeneratedSnapshotArtifact {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const fiveMinute = requireCacheSelection(options, normalizedSymbol, "5m");
  const fourHour = requireCacheSelection(options, normalizedSymbol, "4h");
  const daily = requireCacheSelection(options, normalizedSymbol, "daily");
  const fifteenMinute = latestCacheSelection(options, normalizedSymbol, "15m");
  const asOfTimestamp = deriveAsOfTimestamp(fiveMinute.candles);
  const referencePrice = deriveReferencePrice(fiveMinute.candles);
  const previousClose = derivePreviousClose(daily.candles, asOfTimestamp);
  const snapshot = buildLevelAnalysisSnapshotFromCandles({
    symbol: normalizedSymbol,
    asOfTimestamp,
    referencePrice,
    candles5m: fiveMinute.candles,
    ...(fifteenMinute ? { candles15m: fifteenMinute.candles } : {}),
    fourHourCandles: fourHour.candles,
    dailyCandles: daily.candles,
    previousClose,
  });
  const artifactPath = join(
    outputRoot(options),
    normalizedSymbol,
    String(asOfTimestamp),
    SNAPSHOT_FILE_NAME,
  );
  const content = `${JSON.stringify(snapshot, null, 2)}\n`;

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, content, "utf8");

  return {
    symbol: normalizedSymbol,
    asOfTimestamp,
    referencePrice,
    artifactPath,
    fileSizeBytes: statSync(artifactPath).size,
    content,
    snapshot,
    sourceFiles: {
      "5m": fiveMinute.filePath,
      "4h": fourHour.filePath,
      daily: daily.filePath,
      ...(fifteenMinute ? { "15m": fifteenMinute.filePath } : {}),
    },
  };
}

function formatSummary(result: Omit<LevelAnalysisSnapshotRealCacheBatchRunnerResult, "summaryText">): string {
  const summary = result.manifest.summary;
  const lines = [
    "LevelAnalysisSnapshot real-cache batch complete",
    `Batch: ${result.batchId}`,
    `Generated: ${result.generatedAt}`,
    `Output root: ${result.outputRoot}`,
    `Manifest: ${result.manifestPath}`,
    `Entries: ${summary.totalEntries}`,
    `Accepted: ${summary.acceptedCount}`,
    `Failed: ${summary.failedCount}`,
    `Quarantined: ${summary.quarantinedCount}`,
    `With 15m input: ${summary.with15mInputCount}`,
    `Missing 15m input: ${summary.missing15mInputCount}`,
    `No-lookahead accepted count: ${summary.noLookaheadAppliedCount}`,
    `Synthetic marking accepted count: ${summary.syntheticExtensionsClearlyMarkedCount}`,
  ];

  return `${lines.join("\n")}\n`;
}

export function runLevelAnalysisSnapshotRealCacheBatchRunner(
  options: LevelAnalysisSnapshotRealCacheBatchRunnerOptions,
): LevelAnalysisSnapshotRealCacheBatchRunnerResult {
  const normalizedOptions = {
    ...options,
    symbols: options.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
  };
  const artifacts = normalizedOptions.symbols.map((symbol) =>
    buildSnapshotArtifact(normalizedOptions, symbol),
  );
  const root = outputRoot(normalizedOptions);
  const manifestPath = join(root, MANIFEST_FILE_NAME);
  const { manifest, validation } = buildLevelAnalysisSnapshotBatchManifest({
    batchId: normalizedOptions.batchId,
    generatedAt: normalizedOptions.generatedAt,
    outputRoot: root,
    runConfig: {
      cacheRoot: normalizedOptions.cacheRoot,
      provider: normalizedOptions.provider,
      symbols: normalizedOptions.symbols,
      requiredTimeframes: REQUIRED_TIMEFRAMES,
      optionalTimeframes: OPTIONAL_TIMEFRAMES,
      generatedSnapshotCount: artifacts.length,
    },
    entries: artifacts.map((artifact) => ({
      artifactPath: artifact.artifactPath,
      artifactExists: true,
      fileSizeBytes: artifact.fileSizeBytes,
      content: artifact.content,
      snapshot: artifact.snapshot,
      diagnostics: ["real_cache_batch_snapshot_generated"],
    })),
    diagnostics: ["real_cache_batch_manifest_generated_from_local_cache"],
  });

  if (!validation.valid) {
    throw new Error(`Generated invalid real-cache batch manifest: ${validation.errors.join(", ")}`);
  }

  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, manifestContent, "utf8");

  const result = {
    batchId: normalizedOptions.batchId,
    generatedAt: normalizedOptions.generatedAt,
    outputRoot: root,
    manifestPath,
    artifacts,
    manifest,
    manifestContent,
  };

  return {
    ...result,
    summaryText: formatSummary(result),
  };
}

function isDirectRun(): boolean {
  const argvPath = process.argv[1];
  return argvPath !== undefined && fileURLToPath(import.meta.url) === resolve(argvPath);
}

if (isDirectRun()) {
  try {
    const result = runLevelAnalysisSnapshotRealCacheBatchRunner(
      parseLevelAnalysisSnapshotRealCacheBatchRunnerArgs(process.argv.slice(2)),
    );
    process.stdout.write(result.summaryText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
