import "dotenv/config";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { createOpenAITraderCommentaryServiceFromEnv } from "../lib/ai/trader-commentary-service.js";
import { createFinnhubClientFromEnv } from "../lib/stock-context/finnhub-client.js";
import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import { IBKRLivePriceProvider } from "../lib/monitoring/ibkr-live-price-provider.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import {
  DEFAULT_MANUAL_WATCHLIST_HISTORICAL_LOOKBACKS,
  ManualWatchlistRuntimeManager,
  type ManualWatchlistHistoricalLookbacks,
} from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import {
  AdaptiveScoringEngine,
  DEFAULT_ADAPTIVE_SCORING_CONFIG,
} from "../lib/monitoring/adaptive-scoring.js";
import { createConsoleManualWatchlistLifecycleListener } from "../lib/monitoring/manual-watchlist-runtime-events.js";
import { AdaptiveStatePersistence } from "../lib/monitoring/adaptive-state-persistence.js";
import { OpportunityRuntimeController } from "../lib/monitoring/opportunity-runtime-controller.js";
import { createMonitoringEventDiagnosticListener } from "../lib/monitoring/monitoring-event-diagnostic-logger.js";
import { WatchlistMonitor } from "../lib/monitoring/watchlist-monitor.js";
import { WatchlistStatePersistence } from "../lib/monitoring/watchlist-state-persistence.js";
import { waitForIbkrConnection } from "../scripts/shared/ibkr-connection.js";
import {
  createIbkrClient,
  isIbkrConnected,
  isIbkrReconnecting,
} from "../scripts/shared/ibkr-runtime.js";
import { createDiscordAlertRouter } from "./manual-watchlist-discord.js";
import {
  LOCAL_BIND_HOST,
  RequestBodyParseError,
  readJsonBody,
  sendJson,
} from "./manual-watchlist-http.js";
import { MANUAL_WATCHLIST_PAGE } from "./manual-watchlist-page.js";

const PORT = Number(process.env.MANUAL_WATCHLIST_PORT ?? 3010);
const MONITORING_EVENT_DIAGNOSTICS_ENV = "LEVEL_MONITORING_EVENT_DIAGNOSTICS";
const SESSION_DIRECTORY_ENV = "LEVEL_MANUAL_SESSION_DIRECTORY";
const AI_COMMENTARY_ENV = "LEVEL_AI_COMMENTARY";
const AI_MODEL_ENV = "LEVEL_AI_MODEL";
const MANUAL_WATCHLIST_IBKR_TIMEOUT_ENV = "MANUAL_WATCHLIST_IBKR_TIMEOUT_MS";
const MANUAL_WATCHLIST_LOOKBACK_DAILY_ENV = "LEVEL_MANUAL_LOOKBACK_DAILY";
const MANUAL_WATCHLIST_LOOKBACK_4H_ENV = "LEVEL_MANUAL_LOOKBACK_4H";
const MANUAL_WATCHLIST_LOOKBACK_5M_ENV = "LEVEL_MANUAL_LOOKBACK_5M";
const DEFAULT_MANUAL_WATCHLIST_IBKR_TIMEOUT_MS = 90_000;

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function resolvePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveManualWatchlistHistoricalLookbacks(): ManualWatchlistHistoricalLookbacks {
  return {
    daily: resolvePositiveIntegerEnv(
      process.env[MANUAL_WATCHLIST_LOOKBACK_DAILY_ENV],
      DEFAULT_MANUAL_WATCHLIST_HISTORICAL_LOOKBACKS.daily,
    ),
    "4h": resolvePositiveIntegerEnv(
      process.env[MANUAL_WATCHLIST_LOOKBACK_4H_ENV],
      DEFAULT_MANUAL_WATCHLIST_HISTORICAL_LOOKBACKS["4h"],
    ),
    "5m": resolvePositiveIntegerEnv(
      process.env[MANUAL_WATCHLIST_LOOKBACK_5M_ENV],
      DEFAULT_MANUAL_WATCHLIST_HISTORICAL_LOOKBACKS["5m"],
    ),
  };
}

async function main(): Promise<void> {
  const ib = createIbkrClient();
  const manualWatchlistIbkrTimeoutMs = Number(
    process.env[MANUAL_WATCHLIST_IBKR_TIMEOUT_ENV] ?? DEFAULT_MANUAL_WATCHLIST_IBKR_TIMEOUT_MS,
  );
  const historicalLookbackBars = resolveManualWatchlistHistoricalLookbacks();
  const historicalProvider = new IbkrHistoricalCandleProvider(
    ib,
    Number.isFinite(manualWatchlistIbkrTimeoutMs) && manualWatchlistIbkrTimeoutMs > 0
      ? manualWatchlistIbkrTimeoutMs
      : DEFAULT_MANUAL_WATCHLIST_IBKR_TIMEOUT_MS,
  );
  const liveProvider = new IBKRLivePriceProvider(ib);
  const candleService = new CandleFetchService(historicalProvider);
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
  const aiCommentaryEnabled = isTruthyEnv(process.env[AI_COMMENTARY_ENV]);
  const aiCommentaryModel = process.env[AI_MODEL_ENV]?.trim() || "gpt-5-mini";
  const openAiApiKeyPresent = Boolean(process.env.OPENAI_API_KEY?.trim());
  const aiCommentaryService = aiCommentaryEnabled
    ? createOpenAITraderCommentaryServiceFromEnv()
    : null;
  const finnhubClient = createFinnhubClientFromEnv();
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: candleService,
    levelStore,
    monitor,
    discordAlertRouter: createDiscordAlertRouter(),
    opportunityRuntimeController,
    historicalLookbackBars,
    aiCommentaryService,
    stockContextProvider: finnhubClient,
    watchlistStatePersistence: new WatchlistStatePersistence(),
    lifecycleListener: createConsoleManualWatchlistLifecycleListener(),
    optionalPostSettleDelayMs: 250,
  });
  const sessionDirectory = process.env[SESSION_DIRECTORY_ENV]?.trim() || null;
  let startupState: "booting" | "ready" | "error" = "booting";
  let startupError: string | null = null;

  const bootRuntime = async (): Promise<void> => {
    try {
      await waitForIbkrConnection(ib);
      startupState = "ready";
      startupError = null;
      console.log(
        `[ManualWatchlistRuntime] Candle provider path: ${candleService.getProviderName()}`,
      );
      console.log(
        `[ManualWatchlistRuntime] IBKR historical timeout: ${Number.isFinite(manualWatchlistIbkrTimeoutMs) && manualWatchlistIbkrTimeoutMs > 0 ? manualWatchlistIbkrTimeoutMs : DEFAULT_MANUAL_WATCHLIST_IBKR_TIMEOUT_MS}ms.`,
      );
      console.log(
        `[ManualWatchlistRuntime] Historical lookbacks: daily=${historicalLookbackBars.daily}, 4h=${historicalLookbackBars["4h"]}, 5m=${historicalLookbackBars["5m"]}.`,
      );
      if (monitoringEventDiagnosticsEnabled) {
        console.log(
          `[ManualWatchlistRuntime] Monitoring event diagnostics enabled via ${MONITORING_EVENT_DIAGNOSTICS_ENV}.`,
        );
      }
      if (aiCommentaryEnabled) {
        console.log(
          `[ManualWatchlistRuntime] AI commentary ${aiCommentaryService ? "enabled" : "requested but OPENAI_API_KEY is missing"}.`,
        );
      }
      console.log(
        `[ManualWatchlistRuntime] Finnhub stock context ${finnhubClient ? "enabled" : "disabled (FINNHUB_API_KEY missing)"}.`,
      );
      await manager.start();
      console.log("[ManualWatchlistRuntime] Runtime startup complete.");
    } catch (error) {
      startupState = "error";
      startupError = error instanceof Error ? error.message : String(error);
      console.error(`[ManualWatchlistRuntime] Startup failed: ${startupError}`);
    }
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${LOCAL_BIND_HOST}`);

    if (request.method === "GET" && url.pathname === "/") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(MANUAL_WATCHLIST_PAGE);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/watchlist") {
      sendJson(response, 200, {
        activeEntries: manager.getActiveEntries(),
        startupState,
        startupError,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/runtime/status") {
      const runtimeHealth = manager.getRuntimeHealth();
      sendJson(response, 200, {
        providerName: candleService.getProviderName(),
        diagnosticsEnabled: monitoringEventDiagnosticsEnabled,
        aiCommentaryEnabled: aiCommentaryService !== null,
        runtimeConfig: {
          bindHost: LOCAL_BIND_HOST,
          port: PORT,
          historicalProvider: candleService.getProviderName(),
          liveProvider: "ibkr",
          ibkrHistoricalTimeoutMs:
            Number.isFinite(manualWatchlistIbkrTimeoutMs) && manualWatchlistIbkrTimeoutMs > 0
              ? manualWatchlistIbkrTimeoutMs
              : DEFAULT_MANUAL_WATCHLIST_IBKR_TIMEOUT_MS,
          historicalLookbackBars: manager.getHistoricalLookbackBars(),
          monitoringDiagnosticsRequested: monitoringEventDiagnosticsEnabled,
          aiCommentaryRequested: aiCommentaryEnabled,
          aiCommentaryServiceAvailable: aiCommentaryService !== null,
          aiCommentaryModel,
          openAiApiKeyPresent,
          aiCommentaryRoute: "symbol recaps and live alert AI reads",
        },
        activeSymbolCount: manager.getActiveEntries().length,
        ibkrConnected: isIbkrConnected(ib),
        ibkrReconnecting: isIbkrReconnecting(ib),
        runtimeHealth,
        recentActivity: manager.getRecentActivity(),
        sessionDirectory,
        startupState,
        startupError,
      });
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

        if (symbol.trim().length === 0) {
          sendJson(response, 400, { error: "Symbol is required." });
          return;
        }

        const entry = await manager.queueActivation({ symbol, note });
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
  });

  void bootRuntime();
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
