import "dotenv/config";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { createHistoricalCandleProvider } from "../lib/market-data/provider-factory.js";
import { YahooHistoricalCandleProvider } from "../lib/market-data/yahoo-historical-candle-provider.js";
import { buildTradeCandleContext } from "../lib/market-data/trade-candle-context.js";
import {
  ValidationCachedCandleFetchService,
  resolveValidationCandleCacheMode,
} from "../lib/validation/validation-candle-cache.js";
import { createOpenAITraderCommentaryServiceFromEnv } from "../lib/ai/trader-commentary-service.js";
import { createTradersLinkAiReadServiceFromEnv } from "../lib/ai/traderslink-ai-read-service.js";
import { TradersLinkAiReadCostLedger } from "../lib/ai/traderslink-ai-read-cost-ledger.js";
import { TradersLinkAiReadRunLedger } from "../lib/ai/traderslink-ai-read-run-ledger.js";
import { TradersLinkAiReadSettingsPersistence } from "../lib/ai/traderslink-ai-read-settings.js";
import { createFinnhubClientFromEnv } from "../lib/stock-context/finnhub-client.js";
import { createYahooClientFromEnv } from "../lib/stock-context/yahoo-client.js";
import { CombinedStockContextProvider } from "../lib/stock-context/stock-context-provider.js";
import {
  createLivePriceProvider,
  resolveLivePriceProviderName,
  type LivePriceProviderName,
} from "../lib/monitoring/live-price-provider-factory.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import {
  DEFAULT_MANUAL_WATCHLIST_HISTORICAL_LOOKBACKS,
  ManualWatchlistRuntimeManager,
  resolveMarketStructureStandalonePostMode,
  type ManualWatchlistHistoricalLookbacks,
} from "../lib/monitoring/manual-watchlist-runtime-manager.js";

import {
  AdaptiveScoringEngine,
  DEFAULT_ADAPTIVE_SCORING_CONFIG,
} from "../lib/monitoring/adaptive-scoring.js";
import {
  createCompositeManualWatchlistLifecycleListener,
  createConsoleManualWatchlistLifecycleListener,
  createManualWatchlistLifecycleFileListener,
  isMarketStructureLifecycleEvent,
} from "../lib/monitoring/manual-watchlist-runtime-events.js";
import { AdaptiveStatePersistence } from "../lib/monitoring/adaptive-state-persistence.js";
import { OpportunityRuntimeController } from "../lib/monitoring/opportunity-runtime-controller.js";
import { createMonitoringEventDiagnosticListener } from "../lib/monitoring/monitoring-event-diagnostic-logger.js";
import { WatchlistMonitor } from "../lib/monitoring/watchlist-monitor.js";
import { WatchlistStatePersistence } from "../lib/monitoring/watchlist-state-persistence.js";
import {
  migrateLegacyManualWatchlistFile,
  resolveDurableManualWatchlistFile,
  resolveManualWatchlistDurableDirectory,
} from "../lib/monitoring/manual-watchlist-durable-storage.js";
import { getWatchlistEntrySessionGroup } from "../lib/monitoring/watchlist-entry-session.js";
import { waitForIbkrConnection } from "../scripts/shared/ibkr-connection.js";
import {
  createIbkrClient,
  isIbkrConnected,
  isIbkrReconnecting,
} from "../scripts/shared/ibkr-runtime.js";
import { createDiscordAlertRouter } from "./manual-watchlist-discord.js";
import { createLiveWatchlistPublisherFromEnv } from "../lib/live-watchlist/live-watchlist-publisher.js";
import { createDailyWatchlistRecapServiceFromEnv } from "../lib/live-watchlist/daily-watchlist-recap.js";
import { resolveLiveWatchlistPullbackReadEnabled } from "../lib/live-watchlist/pullback-read.js";
import type { LiveWatchlistPublisher } from "../lib/live-watchlist/live-watchlist-types.js";
import {
  LOCAL_BIND_HOST,
  RequestBodyParseError,
  readJsonBody,
  sendJson,
} from "./manual-watchlist-http.js";
import { resolveMarketDataStatus } from "./manual-watchlist-market-data-status.js";
import { MANUAL_WATCHLIST_PAGE } from "./manual-watchlist-page.js";
import { TRADE_PLAN_REVIEW_PAGE } from "./trade-plan-review-page.js";
import { AI_CLEAN_READ_PAGE } from "./ai-clean-read-page.js";
import {
  appendTradePlanReviewNote,
  buildTradePlanReviewPayload,
  type TradePlanReviewNote,
} from "./trade-plan-review.js";
import {
  AI_CLEAN_READ_REASONING_EFFORT,
  DEFAULT_AI_CLEAN_READ_MODEL,
  appendAiCleanReadComment,
  appendAiCleanReadRecord,
  buildAiCleanReadPayload,
  createOpenAICleanReadServiceFromEnv,
  resolveLatestCleanReadSnapshotInput,
} from "./ai-clean-read.js";
import { resolveLiveThreadPostingProfile } from "../lib/monitoring/live-thread-post-policy.js";
import {
  AutoWatchlistSelector,
  DEFAULT_AUTO_WATCHLIST_SELECTOR_CONFIG,
  type AutoWatchlistSelectorThresholds,
} from "../lib/auto-watchlist/auto-watchlist-selector.js";

const MANUAL_WATCHLIST_RUNTIME_IDENTITY = {
  checkoutRole: "canonical-levels-v2",
  runtimeRoot: process.cwd(),
  entrypointPath: fileURLToPath(import.meta.url),
} as const;
const PORT = Number(process.env.MANUAL_WATCHLIST_PORT ?? 3010);
const MONITORING_EVENT_DIAGNOSTICS_ENV = "LEVEL_MONITORING_EVENT_DIAGNOSTICS";
const SESSION_DIRECTORY_ENV = "LEVEL_MANUAL_SESSION_DIRECTORY";
const AI_COMMENTARY_ENV = "LEVEL_AI_COMMENTARY";
const AI_MODEL_ENV = "LEVEL_AI_MODEL";
const AI_CLEAN_READ_MODEL_ENV = "LEVEL_CLEAN_READ_AI_MODEL";
const LEGACY_OPENAI_FEATURES_ENV = "LEVEL_LEGACY_OPENAI_FEATURES_ENABLED";
const MANUAL_WATCHLIST_IBKR_TIMEOUT_ENV = "MANUAL_WATCHLIST_IBKR_TIMEOUT_MS";
const MANUAL_WATCHLIST_LEVEL_SEED_TIMEOUT_ENV = "MANUAL_WATCHLIST_LEVEL_SEED_TIMEOUT_MS";
const MANUAL_WATCHLIST_FAST_LEVEL_CLEAR_COALESCE_ENV = "MANUAL_WATCHLIST_FAST_LEVEL_CLEAR_COALESCE_MS";
const MANUAL_WATCHLIST_CANDLE_CACHE_MODE_ENV = "MANUAL_WATCHLIST_CANDLE_CACHE_MODE";
const MANUAL_WATCHLIST_CANDLE_CACHE_DIR_ENV = "MANUAL_WATCHLIST_CANDLE_CACHE_DIR";
const MANUAL_WATCHLIST_STARTUP_CANDLE_CACHE_ENV = "MANUAL_WATCHLIST_STARTUP_CANDLE_CACHE";
const MANUAL_WATCHLIST_HISTORICAL_PROVIDER_ENV = "LEVEL_HISTORICAL_CANDLE_PROVIDER";
const MANUAL_WATCHLIST_LIVE_PRICE_PROVIDER_ENV = "LEVEL_LIVE_PRICE_PROVIDER";
const MANUAL_WATCHLIST_PROVIDER_CONFIG_PATH_ENV = "LEVEL_MANUAL_PROVIDER_CONFIG_PATH";
const MANUAL_WATCHLIST_LOOKBACK_DAILY_ENV = "LEVEL_MANUAL_LOOKBACK_DAILY";
const MANUAL_WATCHLIST_LOOKBACK_4H_ENV = "LEVEL_MANUAL_LOOKBACK_4H";
const MANUAL_WATCHLIST_LOOKBACK_5M_ENV = "LEVEL_MANUAL_LOOKBACK_5M";
const WATCHLIST_POSTING_PROFILE_ENV = "WATCHLIST_POSTING_PROFILE";
const MARKET_STRUCTURE_STANDALONE_POSTS_ENV = "MARKET_STRUCTURE_STANDALONE_POSTS";
const LIVE_WATCHLIST_HEALTH_PUBLISH_INTERVAL_MS = 15_000;
let lastPublishedLiveWatchlistHealthStatus: string | null = null;
let pendingLiveWatchlistHealthStatus: string | null = null;
const DEFAULT_MANUAL_WATCHLIST_IBKR_TIMEOUT_MS = 90_000;
const DEFAULT_MANUAL_WATCHLIST_LEVEL_SEED_TIMEOUT_MS = 90_000;
const DEFAULT_MANUAL_WATCHLIST_FAST_LEVEL_CLEAR_COALESCE_MS = 5000;
const DEFAULT_EODHD_MANUAL_WATCHLIST_4H_LOOKBACK = 900;
type DiscordMessage = {
  id: string;
  content?: string;
  thread?: {
    id?: string;
    name?: string;
  };
};

type DiscordThreadChannel = {
  id: string;
  name?: string;
  parent_id?: string | null;
};

type DiscordThreadListResponse = {
  threads?: DiscordThreadChannel[];
};

type DiscordChannelCleanupResult = {
  threadDeleteCount: number;
  parentMessageDeleteCount: number;
  skippedParentMessageCount: number;
  deletedThreads: Array<{ id: string; name: string }>;
  deletedParentMessages: Array<{ id: string; label: string }>;
};

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_CLEANUP_PAGE_LIMIT = 100;
const DISCORD_CLEANUP_PARENT_MESSAGE_PAGE_LIMIT = 50;
const DISCORD_CLEANUP_RETRY_DELAY_MS = 1000;
const RUNTIME_HISTORICAL_PROVIDER_OPTIONS = ["ibkr", "eodhd"] as const;
const RUNTIME_LIVE_PROVIDER_OPTIONS = ["ibkr", "eodhd"] as const;
const PROVIDER_CONFIG_VERSION = 1;
const AUTO_WATCHLIST_THRESHOLD_KEYS = new Set<keyof AutoWatchlistSelectorThresholds>(
  Object.keys(DEFAULT_AUTO_WATCHLIST_SELECTOR_CONFIG) as Array<keyof AutoWatchlistSelectorThresholds>,
);

type RuntimeHistoricalProviderName = (typeof RUNTIME_HISTORICAL_PROVIDER_OPTIONS)[number];

type RuntimeProviderConfig = {
  version: typeof PROVIDER_CONFIG_VERSION;
  lastUpdated: number;
  historicalProvider: RuntimeHistoricalProviderName;
  liveProvider: LivePriceProviderName;
};

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseAutoWatchlistThresholds(
  raw: unknown,
): Partial<AutoWatchlistSelectorThresholds> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("thresholds must be an object.");
  }
  const parsed: Partial<AutoWatchlistSelectorThresholds> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!AUTO_WATCHLIST_THRESHOLD_KEYS.has(key as keyof AutoWatchlistSelectorThresholds)) {
      throw new Error(`Unknown automatic selector threshold: ${key}.`);
    }
    (parsed as Record<string, unknown>)[key] = value;
  }
  return parsed;
}

function resolvePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveHistoricalProviderName(raw: string | undefined): RuntimeHistoricalProviderName {
  return raw?.trim().toLowerCase() === "eodhd" ? "eodhd" : "ibkr";
}

function parseRuntimeHistoricalProviderName(raw: unknown): RuntimeHistoricalProviderName | null {
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return normalized === "ibkr" || normalized === "eodhd" ? normalized : null;
}

function parseRuntimeLiveProviderName(raw: unknown): LivePriceProviderName | null {
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return normalized === "ibkr" || normalized === "eodhd" ? normalized : null;
}

function resolveProviderConfigPath(): string {
  return process.env[MANUAL_WATCHLIST_PROVIDER_CONFIG_PATH_ENV]?.trim() ||
    resolveDurableManualWatchlistFile("manual-watchlist-provider-config.json");
}

function loadRuntimeProviderConfig(path: string): RuntimeProviderConfig | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const historicalProvider = parseRuntimeHistoricalProviderName(parsed.historicalProvider);
    const liveProvider = parseRuntimeLiveProviderName(parsed.liveProvider) ?? "ibkr";
    if (parsed.version !== PROVIDER_CONFIG_VERSION || !historicalProvider) {
      return null;
    }

    return {
      version: PROVIDER_CONFIG_VERSION,
      lastUpdated:
        typeof parsed.lastUpdated === "number" && Number.isFinite(parsed.lastUpdated)
          ? parsed.lastUpdated
          : 0,
      historicalProvider,
      liveProvider,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ManualWatchlistRuntime] Failed to load provider config at ${path}: ${message}`);
    }

    return null;
  }
}

function saveRuntimeProviderConfig(
  path: string,
  config: Omit<RuntimeProviderConfig, "version" | "lastUpdated">,
): void {
  const persisted: RuntimeProviderConfig = {
    version: PROVIDER_CONFIG_VERSION,
    lastUpdated: Date.now(),
    ...config,
  };
  const tempPath = `${path}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tempPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

function resolveDefaultManualWatchlistHistoricalLookbacks(
  providerName: RuntimeHistoricalProviderName,
): ManualWatchlistHistoricalLookbacks {
  if (providerName === "eodhd") {
    return {
      ...DEFAULT_MANUAL_WATCHLIST_HISTORICAL_LOOKBACKS,
      "4h": DEFAULT_EODHD_MANUAL_WATCHLIST_4H_LOOKBACK,
    };
  }

  return DEFAULT_MANUAL_WATCHLIST_HISTORICAL_LOOKBACKS;
}

function resolveManualWatchlistHistoricalLookbacks(
  providerName: RuntimeHistoricalProviderName,
): ManualWatchlistHistoricalLookbacks {
  const defaults = resolveDefaultManualWatchlistHistoricalLookbacks(providerName);

  return {
    daily: resolvePositiveIntegerEnv(
      process.env[MANUAL_WATCHLIST_LOOKBACK_DAILY_ENV],
      defaults.daily,
    ),
    "4h": resolvePositiveIntegerEnv(
      process.env[MANUAL_WATCHLIST_LOOKBACK_4H_ENV],
      defaults["4h"],
    ),
    "5m": resolvePositiveIntegerEnv(
      process.env[MANUAL_WATCHLIST_LOOKBACK_5M_ENV],
      defaults["5m"],
    ),
  };
}

function publishLiveWatchlistHealth(args: {
  publisher: LiveWatchlistPublisher | null;
  manager: ManualWatchlistRuntimeManager;
  startupState: "booting" | "ready" | "error";
  liveProviderName: LivePriceProviderName;
  ibkrConnected: boolean;
  ibkrReconnecting: boolean;
}): void {
  if (!args.publisher?.publishHealth) {
    return;
  }

  const health = args.manager.getRuntimeHealth();
  const marketDataStatus = resolveMarketDataStatus({
    liveProviderName: args.liveProviderName,
    startupState: args.startupState,
    ibkrConnected: args.ibkrConnected,
    ibkrReconnecting: args.ibkrReconnecting,
    priceFeedStatus: health.providerHealth.priceFeedStatus,
  });
  if (
    marketDataStatus === lastPublishedLiveWatchlistHealthStatus ||
    marketDataStatus === pendingLiveWatchlistHealthStatus
  ) {
    return;
  }
  pendingLiveWatchlistHealthStatus = marketDataStatus;
  void args.publisher
    .publishHealth({
      type: "health",
      marketDataStatus,
      marketDataUpdatedAt: health.lastPriceUpdateAt,
    })
    .then(() => {
      lastPublishedLiveWatchlistHealthStatus = marketDataStatus;
      if (pendingLiveWatchlistHealthStatus === marketDataStatus) {
        pendingLiveWatchlistHealthStatus = null;
      }
    })
    .catch((error) => {
      if (pendingLiveWatchlistHealthStatus === marketDataStatus) {
        pendingLiveWatchlistHealthStatus = null;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ManualWatchlistRuntime] Failed to publish live watchlist health: ${message}`);
    });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discordCleanupRequest<T>(
  path: string,
  botToken: string,
  init: RequestInit = {},
): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (response.ok) {
      const text = await response.text();
      return text.trim() ? (JSON.parse(text) as T) : null;
    }

    if (response.status === 404 && init.method === "DELETE") {
      return null;
    }

    if (response.status === 429 || response.status >= 500) {
      const retryAfterSeconds = Number(response.headers.get("retry-after") ?? "");
      await delay(
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
          ? retryAfterSeconds * 1000
          : DISCORD_CLEANUP_RETRY_DELAY_MS,
      );
      continue;
    }

    const body = await response.text();
    throw new Error(
      `Discord cleanup request failed (${response.status}) for ${path}: ${body || response.statusText}`,
    );
  }

  throw new Error(`Discord cleanup request failed after retries for ${path}.`);
}

async function fetchWatchlistParentMessages(
  watchlistChannelId: string,
  botToken: string,
): Promise<DiscordMessage[]> {
  const messages: DiscordMessage[] = [];
  let before: string | null = null;

  for (let page = 0; page < DISCORD_CLEANUP_PARENT_MESSAGE_PAGE_LIMIT; page += 1) {
    const query = new URLSearchParams({ limit: String(DISCORD_CLEANUP_PAGE_LIMIT) });
    if (before) {
      query.set("before", before);
    }
    const batch = await discordCleanupRequest<DiscordMessage[]>(
      `/channels/${watchlistChannelId}/messages?${query.toString()}`,
      botToken,
    );
    if (!batch || batch.length === 0) {
      break;
    }

    messages.push(...batch);
    before = batch[batch.length - 1]?.id ?? null;
    if (batch.length < DISCORD_CLEANUP_PAGE_LIMIT || !before) {
      break;
    }
  }

  return messages;
}

async function fetchWatchlistThreads(
  watchlistChannelId: string,
  guildId: string | undefined,
  botToken: string,
): Promise<DiscordThreadChannel[]> {
  const threads: DiscordThreadChannel[] = [];

  if (guildId) {
    const active = await discordCleanupRequest<DiscordThreadListResponse>(
      `/guilds/${guildId}/threads/active`,
      botToken,
    );
    threads.push(...(active?.threads ?? []).filter((thread) => thread.parent_id === watchlistChannelId));
  }

  const archived = await discordCleanupRequest<DiscordThreadListResponse>(
    `/channels/${watchlistChannelId}/threads/archived/public?limit=${DISCORD_CLEANUP_PAGE_LIMIT}`,
    botToken,
  );
  threads.push(...(archived?.threads ?? []).filter((thread) => thread.parent_id === watchlistChannelId));

  const seen = new Set<string>();
  return threads.filter((thread) => {
    if (seen.has(thread.id)) {
      return false;
    }
    seen.add(thread.id);
    return true;
  });
}

async function clearDiscordWatchlistChannel(): Promise<DiscordChannelCleanupResult> {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const watchlistChannelId = process.env.DISCORD_WATCHLIST_CHANNEL_ID?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim() || undefined;

  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN is required to clear Discord posts.");
  }
  if (!watchlistChannelId) {
    throw new Error("DISCORD_WATCHLIST_CHANNEL_ID is required to clear Discord posts.");
  }

  const [threads, parentMessages] = await Promise.all([
    fetchWatchlistThreads(watchlistChannelId, guildId, botToken),
    fetchWatchlistParentMessages(watchlistChannelId, botToken),
  ]);

  const deletedThreads: Array<{ id: string; name: string }> = [];
  for (const thread of threads) {
    await discordCleanupRequest(`/channels/${thread.id}`, botToken, { method: "DELETE" });
    deletedThreads.push({ id: thread.id, name: thread.name ?? thread.id });
  }

  const deletedParentMessages: Array<{ id: string; label: string }> = [];
  let skippedParentMessageCount = 0;
  for (const message of parentMessages) {
    try {
      await discordCleanupRequest(
        `/channels/${watchlistChannelId}/messages/${message.id}`,
        botToken,
        { method: "DELETE" },
      );
      deletedParentMessages.push({
        id: message.id,
        label: message.thread?.name ?? message.content?.slice(0, 30) ?? "message",
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      if (messageText.includes("(403)") || messageText.includes("(404)")) {
        skippedParentMessageCount += 1;
        continue;
      }
      throw error;
    }
  }

  return {
    threadDeleteCount: deletedThreads.length,
    parentMessageDeleteCount: deletedParentMessages.length,
    skippedParentMessageCount,
    deletedThreads,
    deletedParentMessages,
  };
}

async function main(): Promise<void> {
  const ib = createIbkrClient();
  const durableDataDirectory = resolveManualWatchlistDurableDirectory();
  const legacyArtifactsDirectory = join(process.cwd(), "artifacts");
  const durableFiles = {
    providerConfig: resolveDurableManualWatchlistFile("manual-watchlist-provider-config.json"),
    aiReadSettings: resolveDurableManualWatchlistFile("traderslink-ai-read-settings.json"),
    autoSelectorConfig: resolveDurableManualWatchlistFile("auto-watchlist-selector-config.json"),
    watchlistState: resolveDurableManualWatchlistFile("manual-watchlist-state.json"),
    adaptiveState: resolveDurableManualWatchlistFile("adaptive-state.json"),
    aiReadCostLedger: resolveDurableManualWatchlistFile("traderslink-ai-read-cost-ledger.jsonl"),
    aiReadRunLedger: resolveDurableManualWatchlistFile("traderslink-ai-read-run-events.jsonl"),
  };
  for (const [fileName, durablePath] of Object.entries({
    "manual-watchlist-provider-config.json": durableFiles.providerConfig,
    "traderslink-ai-read-settings.json": durableFiles.aiReadSettings,
    "auto-watchlist-selector-config.json": durableFiles.autoSelectorConfig,
    "manual-watchlist-state.json": durableFiles.watchlistState,
    "adaptive-state.json": durableFiles.adaptiveState,
    "traderslink-ai-read-cost-ledger.jsonl": durableFiles.aiReadCostLedger,
    "traderslink-ai-read-run-events.jsonl": durableFiles.aiReadRunLedger,
  })) {
    migrateLegacyManualWatchlistFile(
      durablePath,
      join(legacyArtifactsDirectory, fileName),
    );
  }
  const manualWatchlistIbkrTimeoutMs = Number(
    process.env[MANUAL_WATCHLIST_IBKR_TIMEOUT_ENV] ?? DEFAULT_MANUAL_WATCHLIST_IBKR_TIMEOUT_MS,
  );
  const manualWatchlistLevelSeedTimeoutMs = resolvePositiveIntegerEnv(
    process.env[MANUAL_WATCHLIST_LEVEL_SEED_TIMEOUT_ENV],
    DEFAULT_MANUAL_WATCHLIST_LEVEL_SEED_TIMEOUT_MS,
  );
  const manualWatchlistFastLevelClearCoalesceMs = resolvePositiveIntegerEnv(
    process.env[MANUAL_WATCHLIST_FAST_LEVEL_CLEAR_COALESCE_ENV],
    DEFAULT_MANUAL_WATCHLIST_FAST_LEVEL_CLEAR_COALESCE_MS,
  );
  const providerConfigPath = resolveProviderConfigPath();
  const persistedProviderConfig = loadRuntimeProviderConfig(providerConfigPath);
  let historicalProviderName = resolveHistoricalProviderName(
    persistedProviderConfig?.historicalProvider ??
      process.env[MANUAL_WATCHLIST_HISTORICAL_PROVIDER_ENV],
  );
  let liveProviderName = resolveLivePriceProviderName(
    persistedProviderConfig?.liveProvider ??
      process.env[MANUAL_WATCHLIST_LIVE_PRICE_PROVIDER_ENV],
  );
  const historicalLookbackBars = resolveManualWatchlistHistoricalLookbacks(historicalProviderName);
  const historicalProvider = createHistoricalCandleProvider({
    provider: historicalProviderName,
    ib,
    ibkrTimeoutMs: Number.isFinite(manualWatchlistIbkrTimeoutMs) && manualWatchlistIbkrTimeoutMs > 0
      ? manualWatchlistIbkrTimeoutMs
      : DEFAULT_MANUAL_WATCHLIST_IBKR_TIMEOUT_MS,
  });
  const liveProvider = createLivePriceProvider({
    provider: liveProviderName,
    ib,
  });
  const rawCandleService = new CandleFetchService(historicalProvider);
  const requestedCandleCacheMode = resolveValidationCandleCacheMode(
    process.env[MANUAL_WATCHLIST_CANDLE_CACHE_MODE_ENV],
  );
  const candleCacheDirectoryPath = process.env[MANUAL_WATCHLIST_CANDLE_CACHE_DIR_ENV]?.trim() ||
    join(process.cwd(), ".validation-cache", "candles");
  const startupCandleCacheEnabled =
    requestedCandleCacheMode !== "off" &&
    process.env[MANUAL_WATCHLIST_STARTUP_CANDLE_CACHE_ENV]?.trim() !== "0";
  const runtimeCandleCacheMode =
    startupCandleCacheEnabled && requestedCandleCacheMode === "read_write"
      ? "refresh"
      : requestedCandleCacheMode;
  const candleService =
    runtimeCandleCacheMode === "off"
      ? rawCandleService
      : new ValidationCachedCandleFetchService(rawCandleService, {
          cacheDirectoryPath: candleCacheDirectoryPath,
          mode: runtimeCandleCacheMode,
        });
  const startupCachedCandleFetchService = startupCandleCacheEnabled
    ? new ValidationCachedCandleFetchService(rawCandleService, {
        cacheDirectoryPath: candleCacheDirectoryPath,
        mode: "replay",
      })
    : null;
  const levelStore = new LevelStore();
  const monitoringEventDiagnosticsEnabled = isTruthyEnv(
    process.env[MONITORING_EVENT_DIAGNOSTICS_ENV],
  );
  const monitor = new WatchlistMonitor(
    levelStore,
    liveProvider,
    undefined,
    monitoringEventDiagnosticsEnabled
      ? {
          diagnosticListener: createMonitoringEventDiagnosticListener(),
        }
      : undefined,
  );
  const adaptiveStatePersistence = new AdaptiveStatePersistence({
    minMultiplier: DEFAULT_ADAPTIVE_SCORING_CONFIG.minMultiplier,
    maxMultiplier: DEFAULT_ADAPTIVE_SCORING_CONFIG.maxMultiplier,
    filePath: durableFiles.adaptiveState,
  });
  const initialAdaptiveState = adaptiveStatePersistence.load() ?? undefined;
  const adaptiveScoringEngine = new AdaptiveScoringEngine(
    DEFAULT_ADAPTIVE_SCORING_CONFIG,
    undefined,
    initialAdaptiveState,
  );
  const opportunityRuntimeController = new OpportunityRuntimeController({
    adaptiveScoringEngine,
    adaptiveStatePersistence,
  });
  const legacyOpenAiFeaturesEnabled = isTruthyEnv(
    process.env[LEGACY_OPENAI_FEATURES_ENV],
  );
  const aiCommentaryRequested = isTruthyEnv(process.env[AI_COMMENTARY_ENV]);
  const aiCommentaryEnabled = legacyOpenAiFeaturesEnabled && aiCommentaryRequested;
  const aiCommentaryModel = process.env[AI_MODEL_ENV]?.trim() || "gpt-5-mini";
  const aiCleanReadModel =
    process.env[AI_CLEAN_READ_MODEL_ENV]?.trim() || DEFAULT_AI_CLEAN_READ_MODEL;
  const postingProfile = resolveLiveThreadPostingProfile(process.env[WATCHLIST_POSTING_PROFILE_ENV]);
  const marketStructureStandalonePostMode = resolveMarketStructureStandalonePostMode(
    process.env[MARKET_STRUCTURE_STANDALONE_POSTS_ENV],
  );
  const pullbackReadEnabled = resolveLiveWatchlistPullbackReadEnabled();
  const recentIntradayCandleFetchService = (
    pullbackReadEnabled || Boolean(process.env.OPENAI_API_KEY?.trim())
  )
    ? new CandleFetchService(new YahooHistoricalCandleProvider())
    : null;
  // EODHD is still the source of truth for daily/4h levels, but its 5m
  // endpoint can be empty during the live session. Keep deterministic level
  // detection supplied with a recent chart series in that case.
  const levelIntradayFallbackCandleFetchService =
    new CandleFetchService(new YahooHistoricalCandleProvider());
  const sessionDirectory = process.env[SESSION_DIRECTORY_ENV]?.trim() || null;
  const marketStructureLifecyclePath = sessionDirectory
    ? join(sessionDirectory, "market-structure-lifecycle.jsonl")
    : null;
  const watchlistLifecyclePath = sessionDirectory
    ? join(sessionDirectory, "watchlist-lifecycle-events.jsonl")
    : join("artifacts", "watchlist-lifecycle-events.jsonl");
  const marketStructureStoryMemoryPath = sessionDirectory
    ? join(sessionDirectory, "market-structure-story-memory.json")
    : null;
  const lifecycleFileListeners = [
    createManualWatchlistLifecycleFileListener(watchlistLifecyclePath, {
      include: (event) =>
        event.event === "activation_queued" ||
        event.event === "activation_started" ||
        event.event === "activation_completed" ||
        event.event === "activation_failed" ||
        event.event === "activation_marked_failed" ||
        event.event === "activation_retry_scheduled" ||
        event.event === "restore_started" ||
        event.event === "restore_completed" ||
        event.event === "restore_failed" ||
        event.event === "restore_skipped" ||
        event.event === "deactivated",
    }),
    ...(marketStructureLifecyclePath
      ? [
          createManualWatchlistLifecycleFileListener(marketStructureLifecyclePath, {
            include: isMarketStructureLifecycleEvent,
          }),
        ]
      : []),
  ];
  const lifecycleListener = createCompositeManualWatchlistLifecycleListener([
    createConsoleManualWatchlistLifecycleListener(),
    ...lifecycleFileListeners,
  ]);
  const openAiApiKeyPresent = Boolean(process.env.OPENAI_API_KEY?.trim());
  const aiCommentaryService = aiCommentaryEnabled
    ? createOpenAITraderCommentaryServiceFromEnv()
    : null;
  const aiCleanReadService = legacyOpenAiFeaturesEnabled
    ? createOpenAICleanReadServiceFromEnv()
    : null;
  const liveWatchlistPublisher = createLiveWatchlistPublisherFromEnv();
  const dailyWatchlistRecapService = createDailyWatchlistRecapServiceFromEnv();
  const tradersLinkAiReadService = createTradersLinkAiReadServiceFromEnv();
  const tradersLinkAiReadSettingsPersistence = new TradersLinkAiReadSettingsPersistence({
    ...(process.env.TRADERSLINK_AI_READ_SETTINGS_FILE?.trim()
      ? { filePath: process.env.TRADERSLINK_AI_READ_SETTINGS_FILE.trim() }
      : { filePath: durableFiles.aiReadSettings }),
  });
  const persistedTradersLinkAiReadSettings = tradersLinkAiReadSettingsPersistence.load();
  let aiReadModelSettings = {
    model: persistedTradersLinkAiReadSettings?.model ??
      (tradersLinkAiReadService?.getConfiguredModel() === "gpt-5.6-luna"
        ? "gpt-5.6-luna"
        : "gpt-5.6-terra"),
    reasoningEffort:
      persistedTradersLinkAiReadSettings?.reasoningEffort ??
      tradersLinkAiReadService?.getReasoningEffort() ??
      "medium",
  } as const;
  let liveTraderReadCardVisible =
    persistedTradersLinkAiReadSettings?.liveTraderReadCardVisible ?? true;
  let aiReadExternalResearchEnabled =
    persistedTradersLinkAiReadSettings?.externalResearchEnabled ??
    tradersLinkAiReadService?.isExternalResearchEnabled() ??
    false;
  let aiReadDailyCostBudget = {
    enabled: persistedTradersLinkAiReadSettings?.dailyCostBudgetEnabled ?? false,
    dailyLimitUsd: persistedTradersLinkAiReadSettings?.dailyCostBudgetUsd ?? 1,
  };
  let aiReadBoundaryRefreshSettings = {
    enabled: persistedTradersLinkAiReadSettings?.automaticBoundaryRefreshesEnabled ?? true,
    maxPerTickerPerNewYorkDate:
      persistedTradersLinkAiReadSettings?.automaticBoundaryRefreshesPerTicker ?? 2,
  };
  let aiReadGenerationSettings = {
    enabled: persistedTradersLinkAiReadSettings?.generationEnabled ?? true,
    premarketEnabled:
      persistedTradersLinkAiReadSettings?.premarketGenerationEnabled ?? true,
    regularEnabled:
      persistedTradersLinkAiReadSettings?.regularGenerationEnabled ?? true,
    postmarketEnabled:
      persistedTradersLinkAiReadSettings?.postmarketGenerationEnabled ?? true,
    topRegularActivationEnabled:
      persistedTradersLinkAiReadSettings?.topRegularActivationGenerationEnabled ?? true,
  };
  tradersLinkAiReadService?.setExternalResearchEnabled(aiReadExternalResearchEnabled);
  tradersLinkAiReadService?.setRuntimeConfiguration(aiReadModelSettings);
  if (!persistedTradersLinkAiReadSettings) {
    tradersLinkAiReadSettingsPersistence.save({
      model: aiReadModelSettings.model,
      reasoningEffort: aiReadModelSettings.reasoningEffort,
      externalResearchEnabled: aiReadExternalResearchEnabled,
      generationEnabled: aiReadGenerationSettings.enabled,
      premarketGenerationEnabled: aiReadGenerationSettings.premarketEnabled,
      regularGenerationEnabled: aiReadGenerationSettings.regularEnabled,
      postmarketGenerationEnabled: aiReadGenerationSettings.postmarketEnabled,
      topRegularActivationGenerationEnabled:
        aiReadGenerationSettings.topRegularActivationEnabled,
      liveTraderReadCardVisible: true,
      potentialGainCardVisible: true,
      watchlistLifecycleLabelsVisible: false,
      reversalWatchlistVisible: true,
      topRegularWatchlistVisible: true,
      dailyCostBudgetEnabled: aiReadDailyCostBudget.enabled,
      dailyCostBudgetUsd: aiReadDailyCostBudget.dailyLimitUsd,
      automaticBoundaryRefreshesEnabled: aiReadBoundaryRefreshSettings.enabled,
      automaticBoundaryRefreshesPerTicker: aiReadBoundaryRefreshSettings.maxPerTickerPerNewYorkDate,
    });
  }
  const tradersLinkAiReadCostLedger = new TradersLinkAiReadCostLedger({
    ...(process.env.TRADERSLINK_AI_READ_COST_LEDGER_FILE?.trim()
      ? { filePath: process.env.TRADERSLINK_AI_READ_COST_LEDGER_FILE.trim() }
      : { filePath: durableFiles.aiReadCostLedger }),
  });
  const tradersLinkAiReadRunLedger = new TradersLinkAiReadRunLedger({
    filePath: durableFiles.aiReadRunLedger,
  });
  const finnhubClient = createFinnhubClientFromEnv();
  const yahooClient = createYahooClientFromEnv();
  const stockContextProvider =
    finnhubClient || yahooClient
      ? new CombinedStockContextProvider({
          finnhubClient,
          yahooClient,
        })
      : null;
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: candleService,
    startupCachedCandleFetchService,
    levelStore,
    monitor,
    discordAlertRouter: createDiscordAlertRouter({
      isLiveTraderReadCardVisible: () => liveTraderReadCardVisible,
    }),
    opportunityRuntimeController,
    historicalLookbackBars,
    aiCommentaryService,
    stockContextProvider,
    watchlistStatePersistence: new WatchlistStatePersistence({
      filePath: durableFiles.watchlistState,
    }),
    lifecycleListener,
    optionalPostSettleDelayMs: 250,
    postingProfile,
    levelSeedTimeoutMs: manualWatchlistLevelSeedTimeoutMs,
    fastLevelClearCoalesceMs: manualWatchlistFastLevelClearCoalesceMs,
    marketStructureStoryMemoryPath,
    marketStructureStandalonePostMode,
    liveWatchlistPublisher,
    tradersLinkAiReadService,
    tradersLinkAiReadCostLedger,
    tradersLinkAiReadRunLedger,
    initialTradersLinkAiReadDailyCostBudget: aiReadDailyCostBudget,
    initialTradersLinkAiReadGenerationSettings: aiReadGenerationSettings,
    initialTradersLinkAiReadBoundaryRefreshSettings: aiReadBoundaryRefreshSettings,
    tradersLinkAiReadStartupRefreshEnabled: isTruthyEnv(
      process.env.TRADERSLINK_AI_READ_STARTUP_REFRESH_ENABLED,
    ),
    initialLiveTraderReadCardVisible: liveTraderReadCardVisible,
    liveTraderReadCardVisibilityListener: (visible) => {
      liveTraderReadCardVisible = visible;
    },
    initialPotentialGainCardVisible:
      persistedTradersLinkAiReadSettings?.potentialGainCardVisible,
    initialWatchlistLifecycleLabelsVisible:
      persistedTradersLinkAiReadSettings?.watchlistLifecycleLabelsVisible,
    initialReversalWatchlistVisible:
      persistedTradersLinkAiReadSettings?.reversalWatchlistVisible,
    initialTopRegularWatchlistVisible:
      persistedTradersLinkAiReadSettings?.topRegularWatchlistVisible,
    pullbackReadEnabled,
    recentIntradayCandleFetchService,
    levelIntradayFallbackCandleFetchService,
    tradersLinkAiReadHistoricalCandleLoader: buildTradeCandleContext,
    opportunityDiagnosticsEnabled: monitoringEventDiagnosticsEnabled,
    autoCleanReadGenerator: aiCleanReadService
      ? async (input) => {
          const result = await aiCleanReadService.generateCleanRead(input);
          return appendAiCleanReadRecord(sessionDirectory, input, result);
        }
      : null,
  });
  let startupState: "booting" | "ready" | "error" = "booting";
  let startupError: string | null = null;
  const autoWatchlistSelector = new AutoWatchlistSelector({
    configPath: durableFiles.autoSelectorConfig,
    yahooClient,
    finnhubClient,
    getActiveSymbols: () => manager.getActiveEntries().map((entry) => entry.symbol),
    getActiveEntries: () => manager.getActiveEntries().map((entry) => ({
      symbol: entry.symbol,
      tags: entry.tags,
      note: entry.note,
      activatedAt: entry.activatedAt,
    })),
    isRuntimeReady: () => startupState === "ready" && manager.getRuntimeHealth().isStarted,
    activateSymbol: (input) => manager.queueActivation(input),
    deactivateSymbol: (symbol) => manager.deactivateSymbol(symbol, { source: "auto" }),
    setSymbolFollowup: (symbol, followup, options) =>
      manager.setAutoWatchlistFollowup(symbol, followup, options),
    onPremarketVolumeSnapshot: (snapshots) => manager.ingestPremarketVolumeSnapshots(snapshots),
  });
  const liveWatchlistHealthPublisher = liveWatchlistPublisher;
  const liveWatchlistHealthTimer = setInterval(() => {
    publishLiveWatchlistHealth({
      publisher: liveWatchlistHealthPublisher,
      manager,
      startupState,
      liveProviderName,
      ibkrConnected: isIbkrConnected(ib),
      ibkrReconnecting: isIbkrReconnecting(ib),
    });
  }, LIVE_WATCHLIST_HEALTH_PUBLISH_INTERVAL_MS);

  const bootRuntime = async (): Promise<void> => {
    try {
      const needsIbkrConnection = historicalProviderName === "ibkr" || liveProviderName === "ibkr";
      if (needsIbkrConnection) {
        await waitForIbkrConnection(ib);
      }
      startupState = "ready";
      startupError = null;
      console.log(
        `[ManualWatchlistRuntime] Candle provider path: ${candleService.getProviderName()}`,
      );
      console.log(
        `[ManualWatchlistRuntime] Live price provider path: ${liveProviderName}`,
      );
      if (requestedCandleCacheMode !== "off") {
        console.log(
          `[ManualWatchlistRuntime] Candle cache: requested=${requestedCandleCacheMode}, runtime=${runtimeCandleCacheMode}, startup=${startupCandleCacheEnabled ? "enabled" : "disabled"}, path=${candleCacheDirectoryPath}.`,
        );
      }
      console.log(
        `[ManualWatchlistRuntime] IBKR historical timeout: ${Number.isFinite(manualWatchlistIbkrTimeoutMs) && manualWatchlistIbkrTimeoutMs > 0 ? manualWatchlistIbkrTimeoutMs : DEFAULT_MANUAL_WATCHLIST_IBKR_TIMEOUT_MS}ms.`,
      );
      console.log(
        `[ManualWatchlistRuntime] Level seed timeout: ${manualWatchlistLevelSeedTimeoutMs}ms.`,
      );
      console.log(
        `[ManualWatchlistRuntime] Fast level-clear coalesce window: ${manualWatchlistFastLevelClearCoalesceMs}ms.`,
      );
      console.log(
        `[ManualWatchlistRuntime] Historical lookbacks: daily=${historicalLookbackBars.daily}, 4h=${historicalLookbackBars["4h"]}, 5m=${historicalLookbackBars["5m"]}.`,
      );
      console.log(`[ManualWatchlistRuntime] Posting profile: ${postingProfile}.`);
      console.log(
        `[ManualWatchlistRuntime] Market structure standalone posts: ${marketStructureStandalonePostMode}.`,
      );
      if (marketStructureLifecyclePath) {
        console.log(
          `[ManualWatchlistRuntime] Market structure lifecycle log: ${marketStructureLifecyclePath}.`,
        );
      }
      if (monitoringEventDiagnosticsEnabled) {
        console.log(
          `[ManualWatchlistRuntime] Monitoring event diagnostics enabled via ${MONITORING_EVENT_DIAGNOSTICS_ENV}.`,
        );
      }
      if (aiCommentaryEnabled) {
        console.log(
          `[ManualWatchlistRuntime] AI commentary ${aiCommentaryService ? "enabled" : "requested but OPENAI_API_KEY is missing"}.`,
        );
      } else if (aiCommentaryRequested) {
        console.log(
          `[ManualWatchlistRuntime] Legacy Discord AI commentary disabled; ${LEGACY_OPENAI_FEATURES_ENV}=1 is required to re-enable it.`,
        );
      }
      console.log(
        `[ManualWatchlistRuntime] Finnhub stock context ${finnhubClient ? "enabled" : "disabled (FINNHUB_API_KEY missing)"}.`,
      );
      console.log(
        `[ManualWatchlistRuntime] Yahoo stock context ${yahooClient ? "enabled" : "disabled (YAHOO_STOCK_CONTEXT_ENABLED=false)"}.`,
      );
      await manager.start();
      autoWatchlistSelector.start();
      void (async () => {
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          const health = manager.getRuntimeHealth();
          const restoreCount =
            health.lifecycleCounts.restoring + health.lifecycleCounts.activating;
          if (health.pendingActivationCount === 0 && restoreCount === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        for (const entry of autoWatchlistSelector.getFollowupPublicationStates()) {
          await manager.setAutoWatchlistFollowup(entry.symbol, true, {
            reversalWatchEligible: entry.reversalWatchEligible,
            reversalWatchAttemptReady: entry.reversalWatchAttemptReady,
          });
        }
      })().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[ManualWatchlistRuntime] Failed to restore follow-up publishing state: ${message}`,
        );
      });
      dailyWatchlistRecapService?.start();
      publishLiveWatchlistHealth({
        publisher: liveWatchlistHealthPublisher,
        manager,
        startupState,
        liveProviderName,
        ibkrConnected: isIbkrConnected(ib),
        ibkrReconnecting: isIbkrReconnecting(ib),
      });
      console.log("[ManualWatchlistRuntime] Runtime startup complete.");
    } catch (error) {
      startupState = "error";
      startupError = error instanceof Error ? error.message : String(error);
      publishLiveWatchlistHealth({
        publisher: liveWatchlistHealthPublisher,
        manager,
        startupState,
        liveProviderName,
        ibkrConnected: isIbkrConnected(ib),
        ibkrReconnecting: isIbkrReconnecting(ib),
      });
      console.error(`[ManualWatchlistRuntime] Startup failed: ${startupError}`);
    }
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${LOCAL_BIND_HOST}`);

    if (request.method === "GET" && url.pathname === "/") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(MANUAL_WATCHLIST_PAGE);
      return;
    }

    if (request.method === "GET" && url.pathname === "/trade-plan-review") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(TRADE_PLAN_REVIEW_PAGE);
      return;
    }

    if (request.method === "GET" && url.pathname === "/ai-clean-read") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(AI_CLEAN_READ_PAGE);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/watchlist") {
      const selectorStatus = autoWatchlistSelector.getStatus();
      const activityBySymbol = new Map(
        selectorStatus.recentDecisions.map((decision) => [decision.symbol, {
          session: decision.session,
          volume: decision.sessionVolume,
          dataAvailable: decision.activityDataAvailable,
        }]),
      );
      const managedBySymbol = new Map(
        selectorStatus.managedEntries.map((entry) => [entry.symbol, entry]),
      );
      sendJson(response, 200, {
        activeEntries: manager.getActiveEntries().map((entry) => ({
          ...entry,
          selectorSessionActivity: activityBySymbol.get(entry.symbol) ?? null,
          selectorManagedState: managedBySymbol.get(entry.symbol)?.state ?? null,
          selectorStatusReason: managedBySymbol.get(entry.symbol)?.statusReason ?? null,
          selectorCurrentSlotScore: managedBySymbol.get(entry.symbol)?.lastSlotSurvivalScore ?? null,
        })),
        startupState,
        startupError,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/runtime/status") {
      const compact = url.searchParams.get("compact") === "1";
      const runtimeHealth = manager.getRuntimeHealth();
      const aiReadCostSnapshot = compact ? null : manager.getTradersLinkAiReadCostSnapshot();
      sendJson(response, 200, {
        providerName: candleService.getProviderName(),
        diagnosticsEnabled: monitoringEventDiagnosticsEnabled,
        aiCommentaryEnabled: aiCommentaryService !== null,
        aiReadConfigured: manager.isTradersLinkAiReadConfigured(),
        aiReadExternalResearchEnabled,
        aiReadModel: tradersLinkAiReadService?.getConfiguredModel() ?? null,
        aiReadReasoningEffort: tradersLinkAiReadService?.getReasoningEffort() ?? null,
        aiReadDailyCostBudget: manager.getTradersLinkAiReadDailyCostBudget(),
        ...(aiReadCostSnapshot
          ? {
              aiReadDailyCostBudgetStatus: aiReadCostSnapshot.dailyCostBudgetStatus,
              aiReadCostSummary: aiReadCostSnapshot.summary,
            }
          : {}),
        runtimeConfig: {
          runtimeIdentity: MANUAL_WATCHLIST_RUNTIME_IDENTITY,
          bindHost: LOCAL_BIND_HOST,
          port: PORT,
          historicalProvider: candleService.getProviderName(),
          availableHistoricalProviders: RUNTIME_HISTORICAL_PROVIDER_OPTIONS,
          historicalProviderRuntimeMutable: true,
          providerConfigPath,
          durableDataDirectory,
          aiReadRunLedgerPath: durableFiles.aiReadRunLedger,
          publicWatchlistUrl:
            process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL?.trim() ||
            "https://traderslink.pro/watchlist",
          liveProvider: liveProviderName,
          availableLiveProviders: RUNTIME_LIVE_PROVIDER_OPTIONS,
          liveProviderRuntimeMutable: true,
          ibkrHistoricalTimeoutMs:
            Number.isFinite(manualWatchlistIbkrTimeoutMs) && manualWatchlistIbkrTimeoutMs > 0
              ? manualWatchlistIbkrTimeoutMs
              : DEFAULT_MANUAL_WATCHLIST_IBKR_TIMEOUT_MS,
          levelSeedTimeoutMs: manualWatchlistLevelSeedTimeoutMs,
          fastLevelClearCoalesceMs: manualWatchlistFastLevelClearCoalesceMs,
          candleCacheMode: requestedCandleCacheMode,
          runtimeCandleCacheMode,
          candleCacheDirectoryPath,
          startupCandleCacheEnabled,
          historicalLookbackBars: manager.getHistoricalLookbackBars(),
          postingProfile,
          marketStructureStandalonePostMode,
          marketStructureLifecyclePath,
          marketStructureStoryMemoryPath,
          monitoringDiagnosticsRequested: monitoringEventDiagnosticsEnabled,
          legacyOpenAiFeaturesEnabled,
          aiCommentaryRequested,
          aiCommentaryServiceAvailable: aiCommentaryService !== null,
          aiCommentaryModel,
          openAiApiKeyPresent,
          aiCommentaryRoute: legacyOpenAiFeaturesEnabled
            ? "symbol recaps and live alert AI reads"
            : "disabled legacy Discord route",
          aiCleanReadModel,
          aiCleanReadReasoningEffort: AI_CLEAN_READ_REASONING_EFFORT,
          aiCleanReadRoute: legacyOpenAiFeaturesEnabled
            ? "automatic initial watchlist activation and manual clean-read UI"
            : "disabled legacy local route",
        },
        activeSymbolCount: manager.getActiveEntries().length,
        ibkrConnected: isIbkrConnected(ib),
        ibkrReconnecting: isIbkrReconnecting(ib),
        runtimeHealth,
        ...(!compact ? { autoWatchlistSelector: autoWatchlistSelector.getStatus() } : {}),
        sessionDirectory,
        startupState,
        startupError,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/runtime/ai-read-audit") {
      const symbol = url.searchParams.get("symbol")?.trim().toUpperCase() || undefined;
      const requestedLimit = Number(url.searchParams.get("limit") ?? "100");
      const limit = Number.isFinite(requestedLimit) ? Math.min(500, Math.max(1, Math.floor(requestedLimit))) : 100;
      sendJson(response, 200, manager.getTradersLinkAiReadAudit({ symbol, limit }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/ai-read-external-research") {
      try {
        const body = await readJsonBody(request);
        if (typeof body.enabled !== "boolean") {
          sendJson(response, 400, { error: "Boolean enabled value is required." });
          return;
        }
        const visibility = manager.getRuntimeHealth();
        tradersLinkAiReadSettingsPersistence.save({
          externalResearchEnabled: body.enabled,
          generationEnabled: aiReadGenerationSettings.enabled,
          premarketGenerationEnabled: aiReadGenerationSettings.premarketEnabled,
          regularGenerationEnabled: aiReadGenerationSettings.regularEnabled,
          postmarketGenerationEnabled: aiReadGenerationSettings.postmarketEnabled,
          topRegularActivationGenerationEnabled:
            aiReadGenerationSettings.topRegularActivationEnabled,
          liveTraderReadCardVisible: visibility.liveTraderReadCardVisible,
          potentialGainCardVisible: visibility.potentialGainCardVisible,
          watchlistLifecycleLabelsVisible: visibility.watchlistLifecycleLabelsVisible,
          reversalWatchlistVisible: visibility.reversalWatchlistVisible,
          topRegularWatchlistVisible: visibility.topRegularWatchlistVisible,
          dailyCostBudgetEnabled: aiReadDailyCostBudget.enabled,
          dailyCostBudgetUsd: aiReadDailyCostBudget.dailyLimitUsd,
        });
        aiReadExternalResearchEnabled = body.enabled;
        tradersLinkAiReadService?.setExternalResearchEnabled(body.enabled);
        sendJson(response, 200, {
          ok: true,
          enabled: body.enabled,
          localResearchEnabled: true,
        });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/ai-read-model") {
      try {
        const body = await readJsonBody(request);
        const model =
          body.model === "gpt-5.6-luna" || body.model === "gpt-5.6-terra"
            ? body.model
            : null;
        const reasoningEffort =
          body.reasoningEffort === "low" ||
          body.reasoningEffort === "medium" ||
          body.reasoningEffort === "high" ||
          body.reasoningEffort === "xhigh"
            ? body.reasoningEffort
            : null;
        if (!model || !reasoningEffort) {
          sendJson(response, 400, {
            error: "Choose Luna or Terra and a low, medium, high, or xhigh effort.",
          });
          return;
        }
        aiReadModelSettings = { model, reasoningEffort };
        tradersLinkAiReadService?.setRuntimeConfiguration(aiReadModelSettings);
        const visibility = manager.getRuntimeHealth();
        tradersLinkAiReadSettingsPersistence.save({
          model,
          reasoningEffort,
          externalResearchEnabled: aiReadExternalResearchEnabled,
          generationEnabled: aiReadGenerationSettings.enabled,
          premarketGenerationEnabled: aiReadGenerationSettings.premarketEnabled,
          regularGenerationEnabled: aiReadGenerationSettings.regularEnabled,
          postmarketGenerationEnabled: aiReadGenerationSettings.postmarketEnabled,
          topRegularActivationGenerationEnabled:
            aiReadGenerationSettings.topRegularActivationEnabled,
          liveTraderReadCardVisible: visibility.liveTraderReadCardVisible,
          potentialGainCardVisible: visibility.potentialGainCardVisible,
          watchlistLifecycleLabelsVisible: visibility.watchlistLifecycleLabelsVisible,
          reversalWatchlistVisible: visibility.reversalWatchlistVisible,
          topRegularWatchlistVisible: visibility.topRegularWatchlistVisible,
          dailyCostBudgetEnabled: aiReadDailyCostBudget.enabled,
          dailyCostBudgetUsd: aiReadDailyCostBudget.dailyLimitUsd,
        });
        sendJson(response, 200, { ok: true, ...aiReadModelSettings });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/ai-read-cost-budget") {
      try {
        const body = await readJsonBody(request);
        if (typeof body.enabled !== "boolean") {
          sendJson(response, 400, { error: "Boolean enabled value is required." });
          return;
        }
        const dailyLimitUsd = typeof body.dailyLimitUsd === "number" ? body.dailyLimitUsd : Number.NaN;
        aiReadDailyCostBudget = manager.setTradersLinkAiReadDailyCostBudget({
          enabled: body.enabled,
          dailyLimitUsd,
        });
        const visibility = manager.getRuntimeHealth();
        tradersLinkAiReadSettingsPersistence.save({
          externalResearchEnabled: aiReadExternalResearchEnabled,
          generationEnabled: aiReadGenerationSettings.enabled,
          premarketGenerationEnabled: aiReadGenerationSettings.premarketEnabled,
          regularGenerationEnabled: aiReadGenerationSettings.regularEnabled,
          postmarketGenerationEnabled: aiReadGenerationSettings.postmarketEnabled,
          topRegularActivationGenerationEnabled:
            aiReadGenerationSettings.topRegularActivationEnabled,
          liveTraderReadCardVisible: visibility.liveTraderReadCardVisible,
          potentialGainCardVisible: visibility.potentialGainCardVisible,
          watchlistLifecycleLabelsVisible: visibility.watchlistLifecycleLabelsVisible,
          reversalWatchlistVisible: visibility.reversalWatchlistVisible,
          topRegularWatchlistVisible: visibility.topRegularWatchlistVisible,
          dailyCostBudgetEnabled: aiReadDailyCostBudget.enabled,
          dailyCostBudgetUsd: aiReadDailyCostBudget.dailyLimitUsd,
        });
        sendJson(response, 200, {
          ok: true,
          budget: aiReadDailyCostBudget,
          status: manager.getTradersLinkAiReadDailyCostBudgetStatus(),
        });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 400, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/ai-read-generation") {
      try {
        const body = await readJsonBody(request);
        if (
          typeof body.enabled !== "boolean" ||
          typeof body.premarketEnabled !== "boolean" ||
          typeof body.regularEnabled !== "boolean" ||
          typeof body.postmarketEnabled !== "boolean" ||
          typeof body.topRegularActivationEnabled !== "boolean"
        ) {
          sendJson(response, 400, {
            error:
              "Boolean enabled, premarketEnabled, regularEnabled, postmarketEnabled, and topRegularActivationEnabled values are required.",
          });
          return;
        }
        aiReadGenerationSettings = manager.setTradersLinkAiReadGenerationSettings({
          enabled: body.enabled,
          premarketEnabled: body.premarketEnabled,
          regularEnabled: body.regularEnabled,
          postmarketEnabled: body.postmarketEnabled,
          topRegularActivationEnabled: body.topRegularActivationEnabled,
        });
        const visibility = manager.getRuntimeHealth();
        tradersLinkAiReadSettingsPersistence.save({
          externalResearchEnabled: aiReadExternalResearchEnabled,
          generationEnabled: aiReadGenerationSettings.enabled,
          premarketGenerationEnabled: aiReadGenerationSettings.premarketEnabled,
          regularGenerationEnabled: aiReadGenerationSettings.regularEnabled,
          postmarketGenerationEnabled: aiReadGenerationSettings.postmarketEnabled,
          topRegularActivationGenerationEnabled:
            aiReadGenerationSettings.topRegularActivationEnabled,
          liveTraderReadCardVisible: visibility.liveTraderReadCardVisible,
          potentialGainCardVisible: visibility.potentialGainCardVisible,
          watchlistLifecycleLabelsVisible: visibility.watchlistLifecycleLabelsVisible,
          reversalWatchlistVisible: visibility.reversalWatchlistVisible,
          topRegularWatchlistVisible: visibility.topRegularWatchlistVisible,
          dailyCostBudgetEnabled: aiReadDailyCostBudget.enabled,
          dailyCostBudgetUsd: aiReadDailyCostBudget.dailyLimitUsd,
        });
        sendJson(response, 200, {
          ok: true,
          settings: aiReadGenerationSettings,
          availability: manager.getTradersLinkAiReadGenerationAvailability(),
        });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/ai-read-boundary-refreshes") {
      try {
        const body = await readJsonBody(request);
        if (typeof body.enabled !== "boolean") {
          sendJson(response, 400, { error: "Boolean enabled value is required." });
          return;
        }
        const limit = typeof body.maxPerTickerPerNewYorkDate === "number"
          ? body.maxPerTickerPerNewYorkDate
          : Number.NaN;
        aiReadBoundaryRefreshSettings = manager.setTradersLinkAiReadBoundaryRefreshSettings({
          enabled: body.enabled,
          maxPerTickerPerNewYorkDate: limit,
        });
        const visibility = manager.getRuntimeHealth();
        tradersLinkAiReadSettingsPersistence.save({
          externalResearchEnabled: aiReadExternalResearchEnabled,
          generationEnabled: aiReadGenerationSettings.enabled,
          premarketGenerationEnabled: aiReadGenerationSettings.premarketEnabled,
          regularGenerationEnabled: aiReadGenerationSettings.regularEnabled,
          postmarketGenerationEnabled: aiReadGenerationSettings.postmarketEnabled,
          topRegularActivationGenerationEnabled:
            aiReadGenerationSettings.topRegularActivationEnabled,
          liveTraderReadCardVisible: visibility.liveTraderReadCardVisible,
          potentialGainCardVisible: visibility.potentialGainCardVisible,
          watchlistLifecycleLabelsVisible: visibility.watchlistLifecycleLabelsVisible,
          reversalWatchlistVisible: visibility.reversalWatchlistVisible,
          topRegularWatchlistVisible: visibility.topRegularWatchlistVisible,
          dailyCostBudgetEnabled: aiReadDailyCostBudget.enabled,
          dailyCostBudgetUsd: aiReadDailyCostBudget.dailyLimitUsd,
          automaticBoundaryRefreshesEnabled: aiReadBoundaryRefreshSettings.enabled,
          automaticBoundaryRefreshesPerTicker:
            aiReadBoundaryRefreshSettings.maxPerTickerPerNewYorkDate,
        });
        sendJson(response, 200, { ok: true, settings: aiReadBoundaryRefreshSettings });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 400, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/auto-watchlist-selector") {
      try {
        const body = await readJsonBody(request);
        if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
          sendJson(response, 400, { error: "enabled must be true or false." });
          return;
        }
        const thresholds = parseAutoWatchlistThresholds(body.thresholds);
        const status = await autoWatchlistSelector.updateConfiguration({
          enabled: body.enabled as boolean | undefined,
          thresholds,
        });
        sendJson(response, 200, { ok: true, status });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 400, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/auto-watchlist-selector/preview") {
      if (startupState !== "ready") {
        sendJson(response, 503, { error: "Runtime must be ready before running a preview scan." });
        return;
      }
      try {
        const status = await autoWatchlistSelector.previewScan();
        sendJson(response, 200, { ok: true, status });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/historical-provider") {
      if (startupState !== "ready") {
        sendJson(response, 503, {
          error:
            startupState === "error"
              ? `Runtime startup failed: ${startupError ?? "unknown error"}`
              : "Runtime is still starting. Try again when startup completes.",
        });
        return;
      }

      try {
        const body = await readJsonBody(request);
        const requestedProvider = parseRuntimeHistoricalProviderName(
          body.historicalProvider ?? body.provider,
        );
        if (!requestedProvider) {
          sendJson(response, 400, {
            error: "historicalProvider must be ibkr or eodhd.",
          });
          return;
        }

        const previousHistoricalProvider = candleService.getProviderName();
        if (requestedProvider === previousHistoricalProvider) {
          saveRuntimeProviderConfig(providerConfigPath, {
            historicalProvider: requestedProvider,
            liveProvider: liveProviderName,
          });
          sendJson(response, 200, {
            ok: true,
            changed: false,
            persisted: true,
            providerConfigPath,
            historicalProvider: previousHistoricalProvider,
            liveProvider: liveProviderName,
            activeSymbolCount: manager.getActiveEntries().length,
          });
          return;
        }

        const nextProvider = createHistoricalCandleProvider({
          provider: requestedProvider,
          ib,
          ibkrTimeoutMs:
            Number.isFinite(manualWatchlistIbkrTimeoutMs) && manualWatchlistIbkrTimeoutMs > 0
              ? manualWatchlistIbkrTimeoutMs
              : DEFAULT_MANUAL_WATCHLIST_IBKR_TIMEOUT_MS,
        });

        if (requestedProvider === "ibkr") {
          await waitForIbkrConnection(
            ib,
            Number.isFinite(manualWatchlistIbkrTimeoutMs) && manualWatchlistIbkrTimeoutMs > 0
              ? manualWatchlistIbkrTimeoutMs
              : DEFAULT_MANUAL_WATCHLIST_IBKR_TIMEOUT_MS,
          );
        }

        saveRuntimeProviderConfig(providerConfigPath, {
          historicalProvider: requestedProvider,
          liveProvider: liveProviderName,
        });
        rawCandleService.setProvider(nextProvider);
        historicalProviderName = requestedProvider;
        console.log(
          `[ManualWatchlistRuntime] Historical candle provider changed from ${previousHistoricalProvider} to ${requestedProvider}.`,
        );

        sendJson(response, 200, {
          ok: true,
          changed: true,
          persisted: true,
          providerConfigPath,
          previousHistoricalProvider,
          historicalProvider: candleService.getProviderName(),
          liveProvider: liveProviderName,
          activeSymbolCount: manager.getActiveEntries().length,
        });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        const statusCode =
          message.includes("EODHD_API_TOKEN") || message.includes("IBKR connection")
            ? 503
            : 500;
        console.error(`[ManualWatchlistRuntime] Historical provider switch failed: ${message}`);
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/live-provider") {
      if (startupState !== "ready") {
        sendJson(response, 503, {
          error:
            startupState === "error"
              ? `Runtime startup failed: ${startupError ?? "unknown error"}`
              : "Runtime is still starting. Try again when startup completes.",
        });
        return;
      }

      try {
        const body = await readJsonBody(request);
        const requestedProvider = parseRuntimeLiveProviderName(
          body.liveProvider ?? body.provider,
        );
        if (!requestedProvider) {
          sendJson(response, 400, {
            error: "liveProvider must be ibkr or eodhd.",
          });
          return;
        }

        const previousLiveProvider = liveProviderName;
        if (requestedProvider === previousLiveProvider) {
          saveRuntimeProviderConfig(providerConfigPath, {
            historicalProvider: historicalProviderName,
            liveProvider: requestedProvider,
          });
          sendJson(response, 200, {
            ok: true,
            changed: false,
            persisted: true,
            providerConfigPath,
            historicalProvider: candleService.getProviderName(),
            liveProvider: previousLiveProvider,
            activeSymbolCount: manager.getActiveEntries().length,
          });
          return;
        }

        const nextProvider = createLivePriceProvider({
          provider: requestedProvider,
          ib,
        });

        if (requestedProvider === "ibkr") {
          await waitForIbkrConnection(
            ib,
            Number.isFinite(manualWatchlistIbkrTimeoutMs) && manualWatchlistIbkrTimeoutMs > 0
              ? manualWatchlistIbkrTimeoutMs
              : DEFAULT_MANUAL_WATCHLIST_IBKR_TIMEOUT_MS,
          );
        }

        await manager.switchLivePriceProvider(nextProvider);
        liveProviderName = requestedProvider;
        let persisted = true;
        let persistenceWarning: string | null = null;
        try {
          saveRuntimeProviderConfig(providerConfigPath, {
            historicalProvider: historicalProviderName,
            liveProvider: requestedProvider,
          });
        } catch (error) {
          persisted = false;
          persistenceWarning = error instanceof Error ? error.message : String(error);
          console.error(
            `[ManualWatchlistRuntime] Live provider switched but provider config save failed: ${persistenceWarning}`,
          );
        }
        publishLiveWatchlistHealth({
          publisher: liveWatchlistHealthPublisher,
          manager,
          startupState,
          liveProviderName,
          ibkrConnected: isIbkrConnected(ib),
          ibkrReconnecting: isIbkrReconnecting(ib),
        });
        console.log(
          `[ManualWatchlistRuntime] Live price provider changed from ${previousLiveProvider} to ${requestedProvider}.`,
        );

        sendJson(response, 200, {
          ok: true,
          changed: true,
          persisted,
          warning: persistenceWarning,
          providerConfigPath,
          previousLiveProvider,
          historicalProvider: candleService.getProviderName(),
          liveProvider: liveProviderName,
          activeSymbolCount: manager.getActiveEntries().length,
        });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        const statusCode =
          message.includes("EODHD_API_TOKEN") ||
          message.includes("EODHD WebSocket") ||
          message.includes("Global WebSocket") ||
          message.includes("IBKR connection")
            ? 503
            : 500;
        console.error(`[ManualWatchlistRuntime] Live provider switch failed: ${message}`);
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/live-trader-read-card") {
      if (startupState !== "ready") {
        sendJson(response, 503, {
          error:
            startupState === "error"
              ? `Runtime startup failed: ${startupError ?? "unknown error"}`
              : "Runtime is still starting. Try again when startup completes.",
        });
        return;
      }

      try {
        const body = await readJsonBody(request);
        if (typeof body.visible !== "boolean") {
          sendJson(response, 400, {
            error: "visible must be true or false.",
          });
          return;
        }

        const result = await manager.setLiveTraderReadCardVisible(body.visible);
        const visibility = manager.getRuntimeHealth();
        tradersLinkAiReadSettingsPersistence.save({
          externalResearchEnabled: aiReadExternalResearchEnabled,
          generationEnabled: aiReadGenerationSettings.enabled,
          premarketGenerationEnabled: aiReadGenerationSettings.premarketEnabled,
          regularGenerationEnabled: aiReadGenerationSettings.regularEnabled,
          postmarketGenerationEnabled: aiReadGenerationSettings.postmarketEnabled,
          topRegularActivationGenerationEnabled:
            aiReadGenerationSettings.topRegularActivationEnabled,
          liveTraderReadCardVisible: result.visible,
          potentialGainCardVisible: visibility.potentialGainCardVisible,
          watchlistLifecycleLabelsVisible: visibility.watchlistLifecycleLabelsVisible,
          reversalWatchlistVisible: visibility.reversalWatchlistVisible,
          topRegularWatchlistVisible: visibility.topRegularWatchlistVisible,
          dailyCostBudgetEnabled: aiReadDailyCostBudget.enabled,
          dailyCostBudgetUsd: aiReadDailyCostBudget.dailyLimitUsd,
        });
        publishLiveWatchlistHealth({
          publisher: liveWatchlistHealthPublisher,
          manager,
          startupState,
          liveProviderName,
          ibkrConnected: isIbkrConnected(ib),
          ibkrReconnecting: isIbkrReconnecting(ib),
        });
        sendJson(response, 200, {
          ok: true,
          visible: result.visible,
          refreshedSymbols: result.refreshedSymbols,
          refreshedSymbolCount: result.refreshedSymbols.length,
        });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ManualWatchlistRuntime] Trader Read card visibility change failed: ${message}`);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/potential-gain-card") {
      if (startupState !== "ready") {
        sendJson(response, 503, {
          error:
            startupState === "error"
              ? `Runtime startup failed: ${startupError ?? "unknown error"}`
              : "Runtime is still starting. Try again when startup completes.",
        });
        return;
      }

      try {
        const body = await readJsonBody(request);
        if (typeof body.visible !== "boolean") {
          sendJson(response, 400, { error: "visible must be true or false." });
          return;
        }

        const result = await manager.setPotentialGainCardVisible(body.visible);
        const visibility = manager.getRuntimeHealth();
        tradersLinkAiReadSettingsPersistence.save({
          externalResearchEnabled: aiReadExternalResearchEnabled,
          generationEnabled: aiReadGenerationSettings.enabled,
          premarketGenerationEnabled: aiReadGenerationSettings.premarketEnabled,
          regularGenerationEnabled: aiReadGenerationSettings.regularEnabled,
          postmarketGenerationEnabled: aiReadGenerationSettings.postmarketEnabled,
          topRegularActivationGenerationEnabled:
            aiReadGenerationSettings.topRegularActivationEnabled,
          liveTraderReadCardVisible: visibility.liveTraderReadCardVisible,
          potentialGainCardVisible: result.visible,
          watchlistLifecycleLabelsVisible: visibility.watchlistLifecycleLabelsVisible,
          reversalWatchlistVisible: visibility.reversalWatchlistVisible,
          topRegularWatchlistVisible: visibility.topRegularWatchlistVisible,
          dailyCostBudgetEnabled: aiReadDailyCostBudget.enabled,
          dailyCostBudgetUsd: aiReadDailyCostBudget.dailyLimitUsd,
        });
        sendJson(response, 200, {
          ok: true,
          visible: result.visible,
          refreshedSymbols: result.refreshedSymbols,
          refreshedSymbolCount: result.refreshedSymbols.length,
        });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ManualWatchlistRuntime] Potential Gain card visibility change failed: ${message}`);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/watchlist-lifecycle-labels") {
      if (startupState !== "ready") {
        sendJson(response, 503, {
          error:
            startupState === "error"
              ? `Runtime startup failed: ${startupError ?? "unknown error"}`
              : "Runtime is still starting. Try again when startup completes.",
        });
        return;
      }

      try {
        const body = await readJsonBody(request);
        if (typeof body.visible !== "boolean") {
          sendJson(response, 400, { error: "visible must be true or false." });
          return;
        }

        const result = await manager.setWatchlistLifecycleLabelsVisible(body.visible);
        const visibility = manager.getRuntimeHealth();
        tradersLinkAiReadSettingsPersistence.save({
          externalResearchEnabled: aiReadExternalResearchEnabled,
          generationEnabled: aiReadGenerationSettings.enabled,
          premarketGenerationEnabled: aiReadGenerationSettings.premarketEnabled,
          regularGenerationEnabled: aiReadGenerationSettings.regularEnabled,
          postmarketGenerationEnabled: aiReadGenerationSettings.postmarketEnabled,
          topRegularActivationGenerationEnabled:
            aiReadGenerationSettings.topRegularActivationEnabled,
          liveTraderReadCardVisible: visibility.liveTraderReadCardVisible,
          potentialGainCardVisible: visibility.potentialGainCardVisible,
          watchlistLifecycleLabelsVisible: result.visible,
          reversalWatchlistVisible: visibility.reversalWatchlistVisible,
          topRegularWatchlistVisible: visibility.topRegularWatchlistVisible,
          dailyCostBudgetEnabled: aiReadDailyCostBudget.enabled,
          dailyCostBudgetUsd: aiReadDailyCostBudget.dailyLimitUsd,
        });
        sendJson(response, 200, {
          ok: true,
          visible: result.visible,
          refreshedSymbols: result.refreshedSymbols,
          refreshedSymbolCount: result.refreshedSymbols.length,
        });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ManualWatchlistRuntime] Watchlist lifecycle label visibility change failed: ${message}`);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/reversal-watchlist") {
      try {
        const body = await readJsonBody(request);
        if (typeof body.visible !== "boolean") {
          sendJson(response, 400, { error: "Boolean visible value is required." });
          return;
        }
        const result = await manager.setReversalWatchlistVisible(body.visible);
        const visibility = manager.getRuntimeHealth();
        tradersLinkAiReadSettingsPersistence.save({
          externalResearchEnabled: aiReadExternalResearchEnabled,
          generationEnabled: aiReadGenerationSettings.enabled,
          premarketGenerationEnabled: aiReadGenerationSettings.premarketEnabled,
          regularGenerationEnabled: aiReadGenerationSettings.regularEnabled,
          postmarketGenerationEnabled: aiReadGenerationSettings.postmarketEnabled,
          topRegularActivationGenerationEnabled:
            aiReadGenerationSettings.topRegularActivationEnabled,
          liveTraderReadCardVisible: visibility.liveTraderReadCardVisible,
          potentialGainCardVisible: visibility.potentialGainCardVisible,
          watchlistLifecycleLabelsVisible: visibility.watchlistLifecycleLabelsVisible,
          reversalWatchlistVisible: result.visible,
          topRegularWatchlistVisible: visibility.topRegularWatchlistVisible,
          dailyCostBudgetEnabled: aiReadDailyCostBudget.enabled,
          dailyCostBudgetUsd: aiReadDailyCostBudget.dailyLimitUsd,
        });
        sendJson(response, 200, {
          ok: true,
          visible: result.visible,
          refreshedSymbols: result.refreshedSymbols,
          refreshedSymbolCount: result.refreshedSymbols.length,
        });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/top-regular-watchlist") {
      try {
        const body = await readJsonBody(request);
        if (typeof body.visible !== "boolean") {
          sendJson(response, 400, { error: "Boolean visible value is required." });
          return;
        }
        const result = await manager.setTopRegularWatchlistVisible(body.visible);
        const visibility = manager.getRuntimeHealth();
        tradersLinkAiReadSettingsPersistence.save({
          externalResearchEnabled: aiReadExternalResearchEnabled,
          generationEnabled: aiReadGenerationSettings.enabled,
          premarketGenerationEnabled: aiReadGenerationSettings.premarketEnabled,
          regularGenerationEnabled: aiReadGenerationSettings.regularEnabled,
          postmarketGenerationEnabled: aiReadGenerationSettings.postmarketEnabled,
          topRegularActivationGenerationEnabled:
            aiReadGenerationSettings.topRegularActivationEnabled,
          liveTraderReadCardVisible: visibility.liveTraderReadCardVisible,
          potentialGainCardVisible: visibility.potentialGainCardVisible,
          watchlistLifecycleLabelsVisible: visibility.watchlistLifecycleLabelsVisible,
          reversalWatchlistVisible: visibility.reversalWatchlistVisible,
          topRegularWatchlistVisible: result.visible,
          dailyCostBudgetEnabled: aiReadDailyCostBudget.enabled,
          dailyCostBudgetUsd: aiReadDailyCostBudget.dailyLimitUsd,
        });
        sendJson(response, 200, {
          ok: true,
          visible: result.visible,
          refreshedSymbols: result.refreshedSymbols,
          refreshedSymbolCount: result.refreshedSymbols.length,
        });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/trade-plan-review") {
      sendJson(response, 200, buildTradePlanReviewPayload(sessionDirectory));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/ai-clean-read") {
      sendJson(
        response,
        200,
        buildAiCleanReadPayload({
          sessionDirectory,
          model: aiCleanReadModel,
          openAiApiKeyPresent,
        }),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ai-clean-read/generate") {
      if (!aiCleanReadService) {
        sendJson(response, 503, {
          error: "OPENAI_API_KEY is required to generate AI clean reads.",
        });
        return;
      }

      try {
        const body = await readJsonBody(request, 128 * 1024);
        let symbol = typeof body.symbol === "string" ? body.symbol : "";
        let currentPrice = typeof body.currentPrice === "string" ? body.currentPrice : "";
        let ladderText = typeof body.ladderText === "string" ? body.ladderText : "";
        const aiPromptNotes =
          typeof body.aiPromptNotes === "string" ? body.aiPromptNotes : undefined;

        if (!symbol.trim() || !currentPrice.trim() || !ladderText.trim()) {
          const snapshot = resolveLatestCleanReadSnapshotInput(sessionDirectory, symbol);
          if (snapshot) {
            symbol = symbol.trim() || snapshot.input.symbol;
            currentPrice = currentPrice.trim() || snapshot.input.currentPrice;
            ladderText = ladderText.trim() || snapshot.input.ladderText;
          }
        }

        if (!symbol.trim() || !currentPrice.trim() || !ladderText.trim()) {
          const target = symbol.trim() ? ` for $${symbol.trim().toUpperCase()}` : "";
          sendJson(response, 400, {
            error:
              `No posted support/resistance ladder was found${target}. Add/activate a ticker on the watchlist first, then retry the clean read.`,
          });
          return;
        }

        const result = await aiCleanReadService.generateCleanRead({
          symbol,
          currentPrice,
          ladderText,
          aiPromptNotes,
        });
        const record = appendAiCleanReadRecord(
          sessionDirectory,
          {
            symbol,
            currentPrice,
            ladderText,
            aiPromptNotes,
          },
          result,
        );
        sendJson(response, 200, { record });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ai-clean-read/comments") {
      try {
        const body = await readJsonBody(request, 32 * 1024);
        const cleanReadId =
          typeof body.cleanReadId === "string" ? body.cleanReadId : null;
        const symbol = typeof body.symbol === "string" ? body.symbol : "";
        const comments = typeof body.comments === "string" ? body.comments : "";
        const comment = appendAiCleanReadComment(sessionDirectory, {
          cleanReadId,
          symbol,
          comments,
        });
        sendJson(response, 200, { comment });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/trade-plan-review/notes") {
      try {
        const body = await readJsonBody(request, 32 * 1024);
        const itemId = typeof body.itemId === "string" ? body.itemId : "";
        const symbol = typeof body.symbol === "string" ? body.symbol : "";
        const verdict = typeof body.verdict === "string" ? body.verdict : "unreviewed";
        const notes = typeof body.notes === "string" ? body.notes : "";
        const tags = Array.isArray(body.tags)
          ? body.tags.filter((tag): tag is string => typeof tag === "string")
          : [];
        const allowedVerdicts: TradePlanReviewNote["verdict"][] = [
          "unreviewed",
          "useful",
          "needs_work",
          "ignore",
        ];

        if (!itemId.trim() || !symbol.trim()) {
          sendJson(response, 400, { error: "itemId and symbol are required." });
          return;
        }
        if (!allowedVerdicts.includes(verdict as TradePlanReviewNote["verdict"])) {
          sendJson(response, 400, { error: "Invalid review verdict." });
          return;
        }

        const note = appendTradePlanReviewNote(sessionDirectory, {
          itemId,
          symbol,
          verdict: verdict as TradePlanReviewNote["verdict"],
          notes,
          tags,
        });
        sendJson(response, 200, { note });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/discord/clear-watchlist-channel") {
      try {
        const body = await readJsonBody(request);
        const confirmation = typeof body.confirmation === "string" ? body.confirmation : "";
        if (confirmation !== "DELETE_DISCORD_WATCHLIST") {
          sendJson(response, 400, {
            error: "Confirmation is required to clear Discord watchlist posts.",
          });
          return;
        }

        const localReset = await manager.resetDiscordThreadState();
        const discordCleanup = await clearDiscordWatchlistChannel();
        sendJson(response, 200, {
          ok: true,
          localReset,
          discordCleanup,
        });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ManualWatchlistRuntime] Discord channel cleanup failed: ${message}`);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/watchlist/activate") {
      if (startupState !== "ready") {
        sendJson(response, 503, {
          error:
            startupState === "error"
              ? `Runtime startup failed: ${startupError ?? "unknown error"}`
              : "Runtime is still starting. Try again when startup completes.",
        });
        return;
      }
      try {
        const body = await readJsonBody(request);
        const symbol = typeof body.symbol === "string" ? body.symbol : "";
        const note = typeof body.note === "string" ? body.note : undefined;
        const watchlistGroup =
          body.watchlistGroup === "top_regular" ||
          body.watchlistGroup === "main" ||
          body.watchlistGroup === "postmarket"
            ? body.watchlistGroup
            : null;

        if (symbol.trim().length === 0 || watchlistGroup === null) {
          sendJson(response, 400, {
            error: "Symbol and a valid watchlistGroup are required.",
          });
          return;
        }

        const entry = await manager.queueActivation({
          symbol,
          note,
          watchlistGroup,
          source: "manual",
        });
        sendJson(response, 202, { entry, queued: true });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ManualWatchlistRuntime] Activation failed: ${message}`);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/watchlist/deactivate") {
      try {
        const body = await readJsonBody(request);
        const symbol = typeof body.symbol === "string" ? body.symbol : "";

        if (symbol.trim().length === 0) {
          sendJson(response, 400, { error: "Symbol is required." });
          return;
        }

        const entry = await manager.deactivateSymbol(symbol);
        if (!entry) {
          sendJson(response, 404, { error: "Symbol was not found." });
          return;
        }

        sendJson(response, 200, { entry });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/watchlist/remove-from-list") {
      try {
        const body = await readJsonBody(request);
        const symbol = typeof body.symbol === "string" ? body.symbol : "";
        if (symbol.trim().length === 0) {
          sendJson(response, 400, { error: "Symbol is required." });
          return;
        }
        const entry = await manager.removeSymbolFromWatchlist(symbol);
        if (!entry) {
          sendJson(response, 404, { error: "Symbol was not found." });
          return;
        }
        sendJson(response, 200, { entry });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/watchlist/move-to-list") {
      try {
        const body = await readJsonBody(request);
        const symbol = typeof body.symbol === "string" ? body.symbol : "";
        const watchlistGroup =
          body.watchlistGroup === "top_regular" ||
          body.watchlistGroup === "main" ||
          body.watchlistGroup === "postmarket"
            ? body.watchlistGroup
            : null;
        if (symbol.trim().length === 0 || watchlistGroup === null) {
          sendJson(response, 400, {
            error: "Symbol and a valid watchlistGroup are required.",
          });
          return;
        }
        const entry = await manager.moveSymbolToWatchlistGroup(symbol, watchlistGroup);
        sendJson(response, 200, { ok: true, entry });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 400, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/watchlist/ai-read-visibility") {
      try {
        const body = await readJsonBody(request);
        const symbol = typeof body.symbol === "string" ? body.symbol : "";
        if (symbol.trim().length === 0 || typeof body.visible !== "boolean") {
          sendJson(response, 400, {
            error: "Symbol and boolean visible value are required.",
          });
          return;
        }
        const entry = await manager.setTradersLinkAiReadCardVisible(symbol, body.visible);
        if (!entry) {
          sendJson(response, 404, { error: "Symbol was not found." });
          return;
        }
        sendJson(response, 200, { ok: true, entry });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/watchlist/ai-read-dip-buy-visibility") {
      try {
        const body = await readJsonBody(request);
        const symbol = typeof body.symbol === "string" ? body.symbol : "";
        const visible = body.visible;
        if (symbol.trim().length === 0 || typeof visible !== "boolean") {
          sendJson(response, 400, { error: "Symbol and boolean visible value are required." });
          return;
        }
        const entry = await manager.setTradersLinkAiReadDipBuyPlanVisible(symbol, visible);
        if (!entry) {
          sendJson(response, 404, { error: "Symbol was not found." });
          return;
        }
        sendJson(response, 200, { entry });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/watchlist/ai-read-refresh") {
      try {
        const body = await readJsonBody(request);
        const symbol = typeof body.symbol === "string" ? body.symbol : "";
        if (symbol.trim().length === 0) {
          sendJson(response, 400, { error: "Symbol is required." });
          return;
        }
        const read = await manager.refreshTradersLinkAiRead(symbol);
        const entry = manager.getEntries().find(
          (candidate) => candidate.symbol === symbol.trim().toUpperCase(),
        );
        sendJson(response, 200, {
          ok: true,
          generated: Boolean(read),
          read,
          failure: entry?.tradersLinkAiReadFailure ?? null,
        });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/watchlist/deactivate-bulk") {
      if (startupState !== "ready") {
        sendJson(response, 503, {
          error:
            startupState === "error"
              ? `Runtime startup failed: ${startupError ?? "unknown error"}`
              : "Runtime is still starting. Try again when startup completes.",
        });
        return;
      }
      try {
        const body = await readJsonBody(request);
        const scope = body.scope;
        const confirmation = body.confirmation;
        const publishedSymbols = Array.isArray(body.publishedSymbols)
          ? body.publishedSymbols.filter((symbol): symbol is string => typeof symbol === "string")
          : [];
        if (
          scope !== "all" &&
          scope !== "top_regular" &&
          scope !== "main" &&
          scope !== "postmarket" &&
          scope !== "reversal"
        ) {
          sendJson(response, 400, {
            error: "scope must be all, top_regular, main, postmarket, or reversal.",
          });
          return;
        }
        if (confirmation !== "DEACTIVATE_WATCHLIST_TICKERS") {
          sendJson(response, 400, { error: "Confirmation is required for bulk ticker removal." });
          return;
        }

        const symbols = manager.getEntries()
          .filter((entry) =>
            (
              scope === "all" ||
              (scope === "reversal"
                ? entry.tags.includes("auto-reversal-watch")
                : getWatchlistEntrySessionGroup(entry) === scope)
            ),
          )
          .map((entry) => entry.symbol);
        const entries = await manager.deactivateSymbols(symbols, { source: "clear" });
        const additionallyDeactivatedPublishedSymbols =
          await manager.deactivatePublishedSymbols(
            publishedSymbols.filter((symbol) => !symbols.includes(symbol)),
          );
        autoWatchlistSelector.resetSymbolsForFreshDiscovery([
          ...symbols,
          ...additionallyDeactivatedPublishedSymbols,
        ]);
        sendJson(response, 200, {
          ok: true,
          scope,
          deactivatedCount: entries.length + additionallyDeactivatedPublishedSymbols.length,
          deactivatedSymbols: [
            ...entries.map((entry) => entry.symbol),
            ...additionallyDeactivatedPublishedSymbols,
          ],
          resetSelectorSymbols: [
            ...symbols,
            ...additionallyDeactivatedPublishedSymbols,
          ],
        });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/watchlist/refresh-levels") {
      try {
        const body = await readJsonBody(request);
        const symbol = typeof body.symbol === "string" ? body.symbol : "";

        if (symbol.trim().length === 0) {
          sendJson(response, 400, { error: "Symbol is required." });
          return;
        }

        const entry = await manager.refreshSymbolLevels(symbol);
        sendJson(response, 200, { entry });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/watchlist/repost-snapshot") {
      try {
        const body = await readJsonBody(request);
        const symbol = typeof body.symbol === "string" ? body.symbol : "";

        if (symbol.trim().length === 0) {
          sendJson(response, 400, { error: "Symbol is required." });
          return;
        }

        const entry = await manager.repostLevelSnapshot(symbol);
        sendJson(response, 200, { entry });
      } catch (error) {
        if (error instanceof RequestBodyParseError) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 500, { error: message });
      }
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  });

  let shuttingDown = false;
  const shutdown = async (signal?: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    clearInterval(liveWatchlistHealthTimer);
    autoWatchlistSelector.stop();
    dailyWatchlistRecapService?.stop();
    await liveWatchlistHealthPublisher?.publishHealth?.({
      type: "health",
      marketDataStatus: "offline",
      marketDataUpdatedAt: manager.getRuntimeHealth().lastPriceUpdateAt,
    });
    if (signal) {
      console.log(`Received ${signal}. Shutting down manual watchlist server...`);
    }

    server.close();
    await manager.stop();
    ib.disconnect();
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT").finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => process.exit(0));
  });

  server.listen(PORT, LOCAL_BIND_HOST, () => {
    console.log(`Manual watchlist server running at http://127.0.0.1:${PORT}`);
    console.log(
      `[ManualWatchlistRuntimeIdentity] ${JSON.stringify(MANUAL_WATCHLIST_RUNTIME_IDENTITY)}`,
    );
  });

  void bootRuntime();
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
