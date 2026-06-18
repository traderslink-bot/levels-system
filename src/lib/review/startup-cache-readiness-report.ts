import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { Candle, CandleFetchTimeframe, CandleProviderName } from "../support-resistance/index.js";

type StartupCacheTimeframe = Extract<CandleFetchTimeframe, "daily" | "4h" | "5m">;

type CachedCandleEntry = {
  response?: {
    candles?: Candle[];
  };
  candles?: Candle[];
};

type PersistedWatchlistEntry = {
  symbol?: unknown;
  active?: unknown;
  lifecycle?: unknown;
  discordThreadId?: unknown;
};

type PersistedWatchlistState = {
  entries?: PersistedWatchlistEntry[];
};

export type StartupCacheReadinessStatus =
  | "ready_for_fast_restore"
  | "usable_but_stale"
  | "partial_cache"
  | "blocked"
  | "inactive";

export type StartupCacheTimeframeReadiness = {
  timeframe: StartupCacheTimeframe;
  candleCount: number;
  requiredCount: number;
  earliestTimestamp: number | null;
  latestTimestamp: number | null;
  latestAgeMinutes: number | null;
  enoughCandles: boolean;
  stale: boolean;
};

export type StartupCacheSymbolReadiness = {
  symbol: string;
  active: boolean;
  lifecycle: string | null;
  hasDiscordThread: boolean;
  status: StartupCacheReadinessStatus;
  reason: string;
  timeframes: Record<StartupCacheTimeframe, StartupCacheTimeframeReadiness>;
  canRestoreLevelsFromCache: boolean;
  discordSnapshotPolicy: "wait_for_fresh_refresh" | "do_not_post_from_cache";
  freshRefreshRequiredBeforeDiscordSnapshot: true;
};

export type StartupCacheReadinessReport = {
  generatedAt: string;
  watchlistStatePath: string;
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  requiredCandles: Record<StartupCacheTimeframe, number>;
  totals: {
    symbols: number;
    activeSymbols: number;
    readyForFastRestore: number;
    usableButStale: number;
    partialCache: number;
    blocked: number;
    inactive: number;
  };
  symbols: StartupCacheSymbolReadiness[];
};

export type BuildStartupCacheReadinessReportOptions = {
  watchlistStatePath?: string;
  cacheDirectoryPath?: string;
  provider?: CandleProviderName;
  activeOnly?: boolean;
  now?: number;
  requiredCandles?: Partial<Record<StartupCacheTimeframe, number>>;
  maxAgeMs?: Partial<Record<StartupCacheTimeframe, number>>;
};

export type WriteStartupCacheReadinessReportOptions =
  BuildStartupCacheReadinessReportOptions & {
    jsonPath: string;
    markdownPath: string;
  };

const DEFAULT_WATCHLIST_STATE_PATH = "artifacts/manual-watchlist-state.json";
const DEFAULT_CACHE_DIRECTORY = ".validation-cache/candles";
const DEFAULT_REQUIRED_CANDLES: Record<StartupCacheTimeframe, number> = {
  daily: 520,
  "4h": 180,
  "5m": 100,
};
const DEFAULT_MAX_AGE_MS: Record<StartupCacheTimeframe, number> = {
  daily: 14 * 24 * 60 * 60 * 1000,
  "4h": 7 * 24 * 60 * 60 * 1000,
  "5m": 3 * 24 * 60 * 60 * 1000,
};
const TIMEFRAMES: StartupCacheTimeframe[] = ["daily", "4h", "5m"];

function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function loadWatchlistEntries(path: string): PersistedWatchlistEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PersistedWatchlistState;
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

function walkJsonFiles(directoryPath: string): string[] {
  if (!existsSync(directoryPath)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const path = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsonFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(path);
    }
  }
  return files;
}

function extractCandles(path: string): Candle[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CachedCandleEntry;
    const candles = parsed.response?.candles ?? parsed.candles ?? [];
    return candles.filter((candle) =>
      [candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ),
    );
  } catch {
    return [];
  }
}

function loadCachedCandles(params: {
  cacheDirectoryPath: string;
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
}): Candle[] {
  const directory = join(params.cacheDirectoryPath, params.provider, params.symbol, params.timeframe);
  const byTimestamp = new Map<number, Candle>();
  for (const file of walkJsonFiles(directory)) {
    for (const candle of extractCandles(file)) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function buildTimeframeReadiness(params: {
  candles: Candle[];
  timeframe: StartupCacheTimeframe;
  requiredCount: number;
  maxAgeMs: number;
  now: number;
}): StartupCacheTimeframeReadiness {
  const earliestTimestamp = params.candles.at(0)?.timestamp ?? null;
  const latestTimestamp = params.candles.at(-1)?.timestamp ?? null;
  const latestAgeMinutes =
    latestTimestamp === null
      ? null
      : Number(((params.now - latestTimestamp) / 60_000).toFixed(1));
  return {
    timeframe: params.timeframe,
    candleCount: params.candles.length,
    requiredCount: params.requiredCount,
    earliestTimestamp,
    latestTimestamp,
    latestAgeMinutes,
    enoughCandles: params.candles.length >= params.requiredCount,
    stale: latestTimestamp === null || params.now - latestTimestamp > params.maxAgeMs,
  };
}

function classifySymbol(params: {
  active: boolean;
  timeframes: Record<StartupCacheTimeframe, StartupCacheTimeframeReadiness>;
}): Pick<StartupCacheSymbolReadiness, "status" | "reason" | "canRestoreLevelsFromCache"> {
  if (!params.active) {
    return {
      status: "inactive",
      reason: "symbol is not active in the persisted watchlist",
      canRestoreLevelsFromCache: false,
    };
  }

  const rows = TIMEFRAMES.map((timeframe) => params.timeframes[timeframe]);
  if (rows.every((row) => row.enoughCandles && !row.stale)) {
    return {
      status: "ready_for_fast_restore",
      reason: "all required startup candle groups are cached and fresh enough for fast level restore",
      canRestoreLevelsFromCache: true,
    };
  }
  if (rows.every((row) => row.enoughCandles)) {
    return {
      status: "usable_but_stale",
      reason: "all required candle groups are cached, but at least one group is stale; restore can warm the UI, Discord snapshot still waits for fresh candles",
      canRestoreLevelsFromCache: true,
    };
  }
  if (rows.some((row) => row.candleCount > 0)) {
    return {
      status: "partial_cache",
      reason: "some candles exist but one or more required groups are missing or below the startup lookback",
      canRestoreLevelsFromCache: false,
    };
  }
  return {
    status: "blocked",
    reason: "no usable startup candle cache was found for the symbol",
    canRestoreLevelsFromCache: false,
  };
}

export function buildStartupCacheReadinessReport(
  options: BuildStartupCacheReadinessReportOptions = {},
): StartupCacheReadinessReport {
  const now = options.now ?? Date.now();
  const watchlistStatePath = resolve(options.watchlistStatePath ?? DEFAULT_WATCHLIST_STATE_PATH);
  const cacheDirectoryPath = options.cacheDirectoryPath ?? DEFAULT_CACHE_DIRECTORY;
  const provider = options.provider ?? "ibkr";
  const requiredCandles = {
    ...DEFAULT_REQUIRED_CANDLES,
    ...options.requiredCandles,
  };
  const maxAgeMs = {
    ...DEFAULT_MAX_AGE_MS,
    ...options.maxAgeMs,
  };
  const entries = loadWatchlistEntries(watchlistStatePath)
    .map((entry) => ({
      symbol: normalizeSymbol(entry.symbol),
      active: entry.active === true,
      lifecycle: typeof entry.lifecycle === "string" ? entry.lifecycle : null,
      hasDiscordThread: typeof entry.discordThreadId === "string" && entry.discordThreadId.trim().length > 0,
    }))
    .filter((entry): entry is { symbol: string; active: boolean; lifecycle: string | null; hasDiscordThread: boolean } =>
      entry.symbol !== null && ((options.activeOnly ?? true) === false || entry.active),
    )
    .sort((left, right) => left.symbol.localeCompare(right.symbol));

  const symbols = entries.map((entry): StartupCacheSymbolReadiness => {
    const timeframes = Object.fromEntries(
      TIMEFRAMES.map((timeframe) => {
        const candles = loadCachedCandles({ cacheDirectoryPath, provider, symbol: entry.symbol, timeframe });
        return [
          timeframe,
          buildTimeframeReadiness({
            candles,
            timeframe,
            requiredCount: requiredCandles[timeframe],
            maxAgeMs: maxAgeMs[timeframe],
            now,
          }),
        ];
      }),
    ) as Record<StartupCacheTimeframe, StartupCacheTimeframeReadiness>;
    const classification = classifySymbol({ active: entry.active, timeframes });
    return {
      symbol: entry.symbol,
      active: entry.active,
      lifecycle: entry.lifecycle,
      hasDiscordThread: entry.hasDiscordThread,
      ...classification,
      timeframes,
      discordSnapshotPolicy: classification.canRestoreLevelsFromCache
        ? "wait_for_fresh_refresh"
        : "do_not_post_from_cache",
      freshRefreshRequiredBeforeDiscordSnapshot: true,
    };
  });

  return {
    generatedAt: new Date(now).toISOString(),
    watchlistStatePath,
    cacheDirectoryPath,
    provider,
    requiredCandles,
    totals: {
      symbols: symbols.length,
      activeSymbols: symbols.filter((symbol) => symbol.active).length,
      readyForFastRestore: symbols.filter((symbol) => symbol.status === "ready_for_fast_restore").length,
      usableButStale: symbols.filter((symbol) => symbol.status === "usable_but_stale").length,
      partialCache: symbols.filter((symbol) => symbol.status === "partial_cache").length,
      blocked: symbols.filter((symbol) => symbol.status === "blocked").length,
      inactive: symbols.filter((symbol) => symbol.status === "inactive").length,
    },
    symbols,
  };
}

function formatTimestamp(timestamp: number | null): string {
  return timestamp === null ? "n/a" : new Date(timestamp).toISOString();
}

export function formatStartupCacheReadinessMarkdown(report: StartupCacheReadinessReport): string {
  const lines = [
    "# Startup Cache Readiness Report",
    "",
    "Operator-only report. It checks whether active watchlist symbols have enough cached daily, 4h, and 5m candles to restore levels quickly on restart. Cached levels can warm the UI, but Discord snapshots still wait for fresh candle refresh.",
    "",
    `Generated: ${report.generatedAt}`,
    `Watchlist state: ${report.watchlistStatePath}`,
    `Cache: ${report.cacheDirectoryPath}`,
    `Provider: ${report.provider}`,
    "",
    "## Totals",
    "",
    `- symbols: ${report.totals.symbols}`,
    `- active symbols: ${report.totals.activeSymbols}`,
    `- ready for fast restore: ${report.totals.readyForFastRestore}`,
    `- usable but stale: ${report.totals.usableButStale}`,
    `- partial cache: ${report.totals.partialCache}`,
    `- blocked: ${report.totals.blocked}`,
    `- inactive: ${report.totals.inactive}`,
    "",
    "## Symbol Evidence",
    "",
  ];

  for (const symbol of report.symbols) {
    lines.push(
      `### ${symbol.symbol} - ${symbol.status}`,
      "",
      `- reason: ${symbol.reason}`,
      `- active: ${symbol.active}; lifecycle: ${symbol.lifecycle ?? "n/a"}; Discord thread: ${symbol.hasDiscordThread}`,
      `- restore from cache: ${symbol.canRestoreLevelsFromCache}; Discord snapshot policy: ${symbol.discordSnapshotPolicy}; fresh refresh required before Discord snapshot: ${symbol.freshRefreshRequiredBeforeDiscordSnapshot}`,
    );
    for (const timeframe of TIMEFRAMES) {
      const row = symbol.timeframes[timeframe];
      lines.push(
        `- ${timeframe}: ${row.candleCount}/${row.requiredCount}; latest ${formatTimestamp(row.latestTimestamp)}; age minutes ${row.latestAgeMinutes ?? "n/a"}; stale ${row.stale}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function writeStartupCacheReadinessReport(
  options: WriteStartupCacheReadinessReportOptions,
): StartupCacheReadinessReport {
  const report = buildStartupCacheReadinessReport(options);
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatStartupCacheReadinessMarkdown(report), "utf8");
  return report;
}
