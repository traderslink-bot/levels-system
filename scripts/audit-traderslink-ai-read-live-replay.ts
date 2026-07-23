import "dotenv/config";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { OpenAITradersLinkAiReadService } from "../src/lib/ai/traderslink-ai-read-service.js";
import type { TradersLinkAiReadPriceActionContext } from "../src/lib/ai/traderslink-ai-read-price-action.js";
import type { LevelSnapshotPayload } from "../src/lib/alerts/alert-types.js";
import type { Candle } from "../src/lib/market-data/candle-types.js";
import { classifyIntradayCandleTimestamp } from "../src/lib/market-data/candle-session-classifier.js";
import { YahooHistoricalCandleProvider } from "../src/lib/market-data/yahoo-historical-candle-provider.js";
import { buildTradeCandleContext } from "../src/lib/market-data/trade-candle-context.js";
import type {
  TradersLinkAiReadForwardHorizon,
  TradersLinkAiReadPayload,
} from "../src/lib/live-watchlist/live-watchlist-types.js";

type ArchiveRecord = {
  symbol: string;
  generationId: string;
  generatedAt: number;
  generatedAtIso: string;
  read: {
    dataAsOf: number;
    currentPrice: number;
  };
};

type ArchiveFile = {
  recordCount: number;
  records: ArchiveRecord[];
};

type AttemptSummary = {
  attemptType: string;
  status: string;
  model: string;
  durationMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedTotalCostUsd: number | null;
  error: string | null;
};

type ReplayResult = {
  symbol: string;
  archiveGenerationId: string;
  replayGenerationId: string;
  replayClass: "historical_reconstruction";
  dataAsOf: number;
  dataAsOfIso: string;
  archivedReferencePrice: number;
  reconstructionWarnings: string[];
  candleCoverage: {
    oneMinuteBars: number;
    fiveMinuteBars: number;
    dailyBars: number;
    oneMinuteFirstAt: string | null;
    oneMinuteLastAt: string | null;
    fiveMinuteFirstAt: string | null;
    fiveMinuteLastAt: string | null;
    dailyFirstAt: string | null;
    dailyLastAt: string | null;
  };
  attempts: AttemptSummary[];
  status: "accepted" | "failed" | "unrecoverable";
  elapsedMs: number;
  estimatedTotalCostUsd: number;
  failure: string | null;
  acceptedRead: TradersLinkAiReadPayload | null;
};

type ReplayArtifact = {
  schemaVersion: 2;
  auditOnly: true;
  publishingDisabled: true;
  webSearchDisabled: true;
  archivePath: string;
  model: string;
  fallbackModel: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  maxCostUsd: number;
  startedAt: number;
  startedAtIso: string;
  updatedAt: number;
  updatedAtIso: string;
  completedAt: number | null;
  completedAtIso: string | null;
  requestedSymbols: string[];
  results: ReplayResult[];
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_ARCHIVE_PATH = "data/traderslink-ai-reads/archive.json";
const DEFAULT_OUTPUT_PATH = "artifacts/traderslink-ai-read-v4-live-replay.json";
const HORIZON_NAMES = [
  "nearestRealistic",
  "continuedMomentum",
  "strongExpansion",
  "extremeMomentum",
] as const;

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function finitePositive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function reasoningEffort(
  value: string | undefined,
): ReplayArtifact["reasoningEffort"] {
  const normalized = value?.trim().toLowerCase();
  return normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "xhigh"
    ? normalized
    : "high";
}

function iso(timestamp: number | undefined): string | null {
  return Number.isFinite(timestamp) ? new Date(timestamp!).toISOString() : null;
}

function costOf(attempts: AttemptSummary[]): number {
  return attempts.reduce((sum, attempt) => sum + (attempt.estimatedTotalCostUsd ?? 0), 0);
}

function sortCandles(candles: Candle[]): Candle[] {
  return [...candles].sort((left, right) => left.timestamp - right.timestamp);
}

function previousRegularClose(candles: Candle[], dataAsOf: number): number | null {
  const currentSessionDate = classifyIntradayCandleTimestamp(dataAsOf).sessionDate;
  const eligible = sortCandles(candles).filter((candle) => {
    const classified = classifyIntradayCandleTimestamp(candle.timestamp);
    return classified.sessionDate < currentSessionDate &&
      (classified.session === "opening_range" || classified.session === "regular");
  });
  return eligible.at(-1)?.close ?? null;
}

function coverage(candles: Candle[]): { firstAt: string | null; lastAt: string | null } {
  const sorted = sortCandles(candles);
  return { firstAt: iso(sorted[0]?.timestamp), lastAt: iso(sorted.at(-1)?.timestamp) };
}

function checkpoint(path: string, artifact: ReplayArtifact): void {
  artifact.updatedAt = Date.now();
  artifact.updatedAtIso = new Date(artifact.updatedAt).toISOString();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

async function reconstructPriceAction(record: ArchiveRecord): Promise<{
  priceAction: TradersLinkAiReadPriceActionContext;
  coverage: ReplayResult["candleCoverage"];
  warnings: string[];
}> {
  const provider = new YahooHistoricalCandleProvider();
  const warnings: string[] = [];
  let oneMinuteCandles: Candle[] = [];
  try {
    const oneMinute = await buildTradeCandleContext({
      symbol: record.symbol,
      fromTimeMs: record.read.dataAsOf - 5 * DAY_MS,
      toTimeMs: record.read.dataAsOf,
      timeframes: ["1m"],
      nowMs: record.read.dataAsOf,
      recentProvider: provider,
      historicalProvider: provider,
    });
    oneMinuteCandles = oneMinute.series.find((series) => series.timeframe === "1m")?.candles ?? [];
  } catch (error) {
    warnings.push(`One-minute reconstruction unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const intraday = await buildTradeCandleContext({
    symbol: record.symbol,
    fromTimeMs: record.read.dataAsOf - 8 * DAY_MS,
    toTimeMs: record.read.dataAsOf,
    timeframes: ["5m"],
    nowMs: record.read.dataAsOf,
    recentProvider: provider,
    historicalProvider: provider,
  });
  const daily = await buildTradeCandleContext({
    symbol: record.symbol,
    fromTimeMs: record.read.dataAsOf - 730 * DAY_MS,
    toTimeMs: record.read.dataAsOf,
    timeframes: ["daily"],
    nowMs: record.read.dataAsOf,
  });
  const intradayCandles = intraday.series.find((series) => series.timeframe === "5m")?.candles ?? [];
  const dailyCandles = daily.series.find((series) => series.timeframe === "daily")?.candles ?? [];
  const dailySeries = daily.series.find((series) => series.timeframe === "daily");
  const adjustmentMode = dailySeries?.response.providerMetadata?.providerAdjustmentMode;
  const dailyAdjustmentMode =
    adjustmentMode === "adjusted_close_ratio" ||
    adjustmentMode === "split_adjusted" ||
    adjustmentMode === "raw"
      ? adjustmentMode
      : "unknown";
  const oneMinuteCoverage = coverage(oneMinuteCandles);
  const fiveMinuteCoverage = coverage(intradayCandles);
  const dailyCoverage = coverage(dailyCandles);

  if (intradayCandles.length < 12 || dailyCandles.length < 10) {
    throw new Error(
      `Insufficient reconstructable candles (1m=${oneMinuteCandles.length}, 5m=${intradayCandles.length}, daily=${dailyCandles.length}).`,
    );
  }

  return {
    priceAction: {
      source: "audit-only Yahoo intraday + EODHD adjusted daily reconstruction; original request packet was not archived",
      fetchedAt: Date.now(),
      priorRegularClose: previousRegularClose(intradayCandles, record.read.dataAsOf),
      dailyAdjustmentMode,
      oneMinuteCandles,
      intradayCandles,
      dailyCandles,
    },
    coverage: {
      oneMinuteBars: oneMinuteCandles.length,
      fiveMinuteBars: intradayCandles.length,
      dailyBars: dailyCandles.length,
      oneMinuteFirstAt: oneMinuteCoverage.firstAt,
      oneMinuteLastAt: oneMinuteCoverage.lastAt,
      fiveMinuteFirstAt: fiveMinuteCoverage.firstAt,
      fiveMinuteLastAt: fiveMinuteCoverage.lastAt,
      dailyFirstAt: dailyCoverage.firstAt,
      dailyLastAt: dailyCoverage.lastAt,
    },
    warnings,
  };
}

function compactConsoleResult(result: ReplayResult): Record<string, unknown> {
  const read = result.acceptedRead;
  const horizons = read
    ? Object.fromEntries(HORIZON_NAMES.map((name) => {
        const horizon = read.forwardPlan[name] as TradersLinkAiReadForwardHorizon;
        return [name, horizon.available ? horizon.price : horizon.unavailableReasonCode];
      }))
    : null;
  return {
    symbol: result.symbol,
    status: result.status,
    attempts: result.attempts.map((attempt) => `${attempt.attemptType}:${attempt.status}`),
    costUsd: Number(result.estimatedTotalCostUsd.toFixed(6)),
    horizons,
    failure: result.failure,
  };
}

async function main(): Promise<void> {
  const archivePath = resolve(flag("--archive") ?? DEFAULT_ARCHIVE_PATH);
  const outputPath = resolve(flag("--out") ?? DEFAULT_OUTPUT_PATH);
  const maxCostUsd = finitePositive(flag("--max-cost-usd"), 5);
  const effort = reasoningEffort(flag("--reasoning-effort"));
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required. Set DOTENV_CONFIG_PATH to the owner worktree .env when running the audit.");
  }
  const model = process.env.TRADERSLINK_AI_READ_MODEL?.trim() || "gpt-5.6-luna";
  const fallbackModel = process.env.TRADERSLINK_AI_READ_FALLBACK_MODEL?.trim() || model;
  const archive = JSON.parse(readFileSync(archivePath, "utf8")) as ArchiveFile;
  const requested = (flag("--symbols") ?? "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const requestedSet = new Set(requested);
  const records = archive.records.filter((record) => requestedSet.size === 0 || requestedSet.has(record.symbol));
  if (records.length === 0) {
    throw new Error("No archive records matched --symbols.");
  }

  const existing = hasFlag("--resume")
    ? (() => {
        try {
          return JSON.parse(readFileSync(outputPath, "utf8")) as ReplayArtifact;
        } catch {
          return null;
        }
      })()
    : null;
  const now = Date.now();
  const artifact: ReplayArtifact = existing ?? {
    schemaVersion: 2,
    auditOnly: true,
    publishingDisabled: true,
    webSearchDisabled: true,
    archivePath,
    model,
    fallbackModel,
    reasoningEffort: effort,
    maxCostUsd,
    startedAt: now,
    startedAtIso: new Date(now).toISOString(),
    updatedAt: now,
    updatedAtIso: new Date(now).toISOString(),
    completedAt: null,
    completedAtIso: null,
    requestedSymbols: records.map((record) => record.symbol),
    results: [],
  };
  artifact.maxCostUsd = maxCostUsd;
  artifact.reasoningEffort = effort;
  artifact.requestedSymbols = Array.from(new Set([...artifact.requestedSymbols, ...records.map((record) => record.symbol)]));
  const completedIds = new Set(artifact.results.map((result) => result.archiveGenerationId));
  const service = new OpenAITradersLinkAiReadService({
    apiKey,
    model,
    fallbackModel,
    reasoningEffort: effort,
    webSearchEnabled: false,
    timeoutMs: 120_000,
    maxOutputTokens: Number(process.env.TRADERSLINK_AI_READ_MAX_OUTPUT_TOKENS) || 8_000,
  });

  checkpoint(outputPath, artifact);
  for (const record of records) {
    if (completedIds.has(record.generationId)) {
      continue;
    }
    const spent = artifact.results.reduce((sum, result) => sum + result.estimatedTotalCostUsd, 0);
    if (spent >= maxCostUsd) {
      throw new Error(`Audit cost ceiling reached before ${record.symbol}: $${spent.toFixed(4)} spent of $${maxCostUsd.toFixed(2)}.`);
    }

    const attempts: AttemptSummary[] = [];
    const startedAt = Date.now();
    let candleCoverage: ReplayResult["candleCoverage"] = {
      oneMinuteBars: 0,
      fiveMinuteBars: 0,
      dailyBars: 0,
      oneMinuteFirstAt: null,
      oneMinuteLastAt: null,
      fiveMinuteFirstAt: null,
      fiveMinuteLastAt: null,
      dailyFirstAt: null,
      dailyLastAt: null,
    };
    let acceptedRead: TradersLinkAiReadPayload | null = null;
    let reconstructionWarnings: string[] = [];
    let failure: string | null = null;
    let status: ReplayResult["status"] = "failed";
    const replayGenerationId =
      `${record.symbol}-V4-AUDIT-${effort.toUpperCase()}-${record.read.dataAsOf}`;
    try {
      const reconstructed = await reconstructPriceAction(record);
      candleCoverage = reconstructed.coverage;
      reconstructionWarnings = reconstructed.warnings;
      const snapshot = {
        symbol: record.symbol,
        timestamp: record.read.dataAsOf,
        currentPrice: record.read.currentPrice,
        marketStructure: null,
        supportZones: [],
        resistanceZones: [],
      } as LevelSnapshotPayload;
      acceptedRead = await service.generate({
        snapshot,
        priceAction: reconstructed.priceAction,
        research: {
          ticker: record.symbol,
          businessDays: 5,
          count: 0,
          articles: [],
        },
        dataAsOf: record.read.dataAsOf,
        generationId: replayGenerationId,
        onAttempt: (attempt) => {
          attempts.push({
            attemptType: attempt.attemptType,
            status: attempt.status,
            model: attempt.model,
            durationMs: attempt.durationMs,
            inputTokens: attempt.usage.inputTokens,
            cachedInputTokens: attempt.usage.cachedInputTokens,
            outputTokens: attempt.usage.outputTokens,
            estimatedTotalCostUsd: attempt.usage.estimatedTotalCostUsd,
            error: attempt.error,
          });
        },
      });
      status = "accepted";
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      status = candleCoverage.fiveMinuteBars < 12 || candleCoverage.dailyBars < 10
        ? "unrecoverable"
        : "failed";
    }
    const result: ReplayResult = {
      symbol: record.symbol,
      archiveGenerationId: record.generationId,
      replayGenerationId,
      replayClass: "historical_reconstruction",
      dataAsOf: record.read.dataAsOf,
      dataAsOfIso: new Date(record.read.dataAsOf).toISOString(),
      archivedReferencePrice: record.read.currentPrice,
      reconstructionWarnings,
      candleCoverage,
      attempts,
      status,
      elapsedMs: Date.now() - startedAt,
      estimatedTotalCostUsd: costOf(attempts),
      failure,
      acceptedRead,
    };
    artifact.results.push(result);
    checkpoint(outputPath, artifact);
    process.stdout.write(`${JSON.stringify(compactConsoleResult(result))}\n`);
  }

  artifact.completedAt = Date.now();
  artifact.completedAtIso = new Date(artifact.completedAt).toISOString();
  checkpoint(outputPath, artifact);
  const totalCostUsd = artifact.results.reduce((sum, result) => sum + result.estimatedTotalCostUsd, 0);
  process.stdout.write(`${JSON.stringify({
    complete: true,
    outputPath,
    requested: records.length,
    accepted: artifact.results.filter((result) => result.status === "accepted").length,
    failed: artifact.results.filter((result) => result.status === "failed").length,
    unrecoverable: artifact.results.filter((result) => result.status === "unrecoverable").length,
    totalCostUsd: Number(totalCostUsd.toFixed(6)),
  })}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[audit-traderslink-ai-read-live-replay] ${message}`);
  process.exitCode = 1;
});
