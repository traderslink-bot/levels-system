import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLevelAnalysisSnapshotFromCandles,
  type LevelAnalysisSnapshotFromCandlesInput,
} from "../lib/analysis/level-analysis-snapshot-from-candles.js";
import type { LevelAnalysisSnapshot } from "../lib/analysis/level-analysis-snapshot.js";
import type { Candle } from "../lib/market-data/candle-types.js";

export type LevelAnalysisSnapshotRunnerFormat = "json";

export type LevelAnalysisSnapshotRunnerOptions = {
  symbol: string;
  asOfTimestamp: number;
  referencePrice: number;
  candles5mPath: string;
  candles4hPath?: string;
  candlesDailyPath?: string;
  previousClose?: number;
  outPath?: string;
  format: LevelAnalysisSnapshotRunnerFormat;
};

export type LevelAnalysisSnapshotRunnerResult = {
  symbol: string;
  asOfTimestamp: number;
  referencePrice: number;
  inputPaths: {
    candles5m: string;
    candles4h?: string;
    candlesDaily?: string;
  };
  outPath?: string;
  format: LevelAnalysisSnapshotRunnerFormat;
  snapshot: LevelAnalysisSnapshot;
  content: string;
};

export type LevelAnalysisSnapshotRunnerFileSystem = {
  readFileSync: typeof readFileSync;
  writeFileSync: typeof writeFileSync;
  mkdirSync: typeof mkdirSync;
};

const defaultFileSystem: LevelAnalysisSnapshotRunnerFileSystem = {
  readFileSync,
  writeFileSync,
  mkdirSync,
};

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function parseTimestamp(value: string, flag: string): number {
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric) && value.trim() !== "" ? numeric : Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid ${flag} value "${value}". Expected milliseconds timestamp or ISO date.`);
  }

  return timestamp;
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${flag} value "${value}". Expected a finite number.`);
  }

  return parsed;
}

function parseFormat(value: string | undefined): LevelAnalysisSnapshotRunnerFormat {
  if (value === undefined || value === "json") {
    return "json";
  }

  throw new Error(`Unsupported --format value "${value}". Expected json.`);
}

export function parseLevelAnalysisSnapshotRunnerArgs(
  args: string[],
): LevelAnalysisSnapshotRunnerOptions {
  let symbol: string | undefined;
  let asOfTimestamp: number | undefined;
  let referencePrice: number | undefined;
  let candles5mPath: string | undefined;
  let candles4hPath: string | undefined;
  let candlesDailyPath: string | undefined;
  let previousClose: number | undefined;
  let outPath: string | undefined;
  let format: LevelAnalysisSnapshotRunnerFormat = "json";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--symbol") {
      symbol = requireValue(args, index, arg).trim().toUpperCase();
      index += 1;
      continue;
    }
    if (arg === "--as-of") {
      asOfTimestamp = parseTimestamp(requireValue(args, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--reference-price") {
      referencePrice = parseNumber(requireValue(args, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--candles-5m") {
      candles5mPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--candles-4h") {
      candles4hPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--candles-daily") {
      candlesDailyPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--previous-close") {
      previousClose = parseNumber(requireValue(args, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--out") {
      outPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--format") {
      format = parseFormat(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument "${arg}".`);
  }

  if (!symbol) {
    throw new Error("Missing required --symbol <ticker>.");
  }
  if (asOfTimestamp === undefined) {
    throw new Error("Missing required --as-of <timestamp|ISO>.");
  }
  if (referencePrice === undefined) {
    throw new Error("Missing required --reference-price <number>.");
  }
  if (!candles5mPath) {
    throw new Error("Missing required --candles-5m <path>.");
  }

  return {
    symbol,
    asOfTimestamp,
    referencePrice,
    candles5mPath,
    candles4hPath,
    candlesDailyPath,
    previousClose,
    outPath,
    format,
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
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) {
      return timestamp;
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

  throw new Error(`Candle JSON from ${filePath} must be an array or object with candles array.`);
}

export function loadCandleJson(
  filePath: string,
  fileSystem: Pick<LevelAnalysisSnapshotRunnerFileSystem, "readFileSync"> = defaultFileSystem,
): Candle[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read candle JSON from ${filePath}: ${message}`);
  }

  return extractCandleArray(parsed, filePath).map((item, index) =>
    normalizeCandle(item, filePath, index),
  );
}

function buildSnapshotInput(
  options: LevelAnalysisSnapshotRunnerOptions,
  fileSystem: Pick<LevelAnalysisSnapshotRunnerFileSystem, "readFileSync">,
): LevelAnalysisSnapshotFromCandlesInput {
  return {
    symbol: options.symbol,
    asOfTimestamp: options.asOfTimestamp,
    referencePrice: options.referencePrice,
    candles5m: loadCandleJson(options.candles5mPath, fileSystem),
    fourHourCandles: options.candles4hPath
      ? loadCandleJson(options.candles4hPath, fileSystem)
      : undefined,
    dailyCandles: options.candlesDailyPath
      ? loadCandleJson(options.candlesDailyPath, fileSystem)
      : undefined,
    previousClose: options.previousClose,
  };
}

export function runLevelAnalysisSnapshotRunner(
  options: LevelAnalysisSnapshotRunnerOptions,
  fileSystem: LevelAnalysisSnapshotRunnerFileSystem = defaultFileSystem,
): LevelAnalysisSnapshotRunnerResult {
  const snapshot = buildLevelAnalysisSnapshotFromCandles(buildSnapshotInput(options, fileSystem));
  const content = `${JSON.stringify(snapshot, null, 2)}\n`;

  if (options.outPath) {
    fileSystem.mkdirSync(dirname(options.outPath), { recursive: true });
    fileSystem.writeFileSync(options.outPath, content, "utf8");
  }

  return {
    symbol: options.symbol,
    asOfTimestamp: options.asOfTimestamp,
    referencePrice: options.referencePrice,
    inputPaths: {
      candles5m: options.candles5mPath,
      candles4h: options.candles4hPath,
      candlesDaily: options.candlesDailyPath,
    },
    outPath: options.outPath,
    format: options.format,
    snapshot,
    content,
  };
}

function isDirectRun(): boolean {
  const argvPath = process.argv[1];
  return argvPath !== undefined && fileURLToPath(import.meta.url) === resolve(argvPath);
}

if (isDirectRun()) {
  try {
    const options = parseLevelAnalysisSnapshotRunnerArgs(process.argv.slice(2));
    const result = runLevelAnalysisSnapshotRunner(options);

    if (!options.outPath) {
      process.stdout.write(result.content);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
