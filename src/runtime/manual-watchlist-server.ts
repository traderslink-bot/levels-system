import "dotenv/config";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import { IBKRLivePriceProvider } from "../lib/monitoring/ibkr-live-price-provider.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import {
  AdaptiveScoringEngine,
  DEFAULT_ADAPTIVE_SCORING_CONFIG,
} from "../lib/monitoring/adaptive-scoring.js";
import { AdaptiveStatePersistence } from "../lib/monitoring/adaptive-state-persistence.js";
import { OpportunityRuntimeController } from "../lib/monitoring/opportunity-runtime-controller.js";
import { createMonitoringEventDiagnosticListener } from "../lib/monitoring/monitoring-event-diagnostic-logger.js";
import { WatchlistMonitor } from "../lib/monitoring/watchlist-monitor.js";
import { WatchlistStatePersistence } from "../lib/monitoring/watchlist-state-persistence.js";
import { waitForIbkrConnection } from "../scripts/shared/ibkr-connection.js";
import { createIbkrClient } from "../scripts/shared/ibkr-runtime.js";
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

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

async function main(): Promise<void> {
  const ib = createIbkrClient();
  const historicalProvider = new IbkrHistoricalCandleProvider(ib);
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
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: candleService,
    levelStore,
    monitor,
    discordAlertRouter: createDiscordAlertRouter(),
    opportunityRuntimeController,
    watchlistStatePersistence: new WatchlistStatePersistence(),
  });

  await waitForIbkrConnection(ib);
  console.log(
    `[ManualWatchlistRuntime] Candle provider path: ${candleService.getProviderName()}`,
  );
  if (monitoringEventDiagnosticsEnabled) {
    console.log(
      `[ManualWatchlistRuntime] Monitoring event diagnostics enabled via ${MONITORING_EVENT_DIAGNOSTICS_ENV}.`,
    );
  }
  await manager.start();

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
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/watchlist/activate") {
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
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
