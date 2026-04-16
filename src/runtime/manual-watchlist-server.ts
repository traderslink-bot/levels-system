import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import { DiscordAlertRouter } from "../lib/alerts/alert-router.js";
import { LocalDiscordThreadGateway } from "../lib/alerts/local-discord-thread-gateway.js";
import { IBKRLivePriceProvider } from "../lib/monitoring/ibkr-live-price-provider.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import {
  AdaptiveScoringEngine,
  DEFAULT_ADAPTIVE_SCORING_CONFIG,
} from "../lib/monitoring/adaptive-scoring.js";
import { AdaptiveStatePersistence } from "../lib/monitoring/adaptive-state-persistence.js";
import { OpportunityRuntimeController } from "../lib/monitoring/opportunity-runtime-controller.js";
import { WatchlistMonitor } from "../lib/monitoring/watchlist-monitor.js";
import { WatchlistStatePersistence } from "../lib/monitoring/watchlist-state-persistence.js";
import { waitForIbkrConnection } from "../scripts/shared/ibkr-connection.js";
import { createIbkrClient } from "../scripts/shared/ibkr-runtime.js";

const PORT = Number(process.env.MANUAL_WATCHLIST_PORT ?? 3010);

const MANUAL_WATCHLIST_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Manual Watchlist</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; background: #f5f7fb; color: #1f2937; }
    main { max-width: 760px; margin: 0 auto; }
    form, section { background: #fff; border: 1px solid #d7dee8; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    label { display: block; font-size: 14px; margin-bottom: 6px; }
    input { width: 100%; padding: 10px; border: 1px solid #c7d0dc; border-radius: 8px; margin-bottom: 12px; box-sizing: border-box; }
    button { padding: 10px 14px; border: 0; border-radius: 8px; cursor: pointer; background: #1d4ed8; color: #fff; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { display: flex; justify-content: space-between; gap: 12px; align-items: center; border-top: 1px solid #e5e7eb; padding: 12px 0; }
    li:first-child { border-top: 0; }
    .meta { color: #4b5563; font-size: 13px; }
    .status { min-height: 20px; font-size: 14px; margin-bottom: 12px; color: #1d4ed8; }
    .danger { background: #b91c1c; }
  </style>
</head>
<body>
  <main>
    <form id="watchlist-form">
      <h1>Manual Watchlist</h1>
      <div class="status" id="status"></div>
      <label for="symbol">Symbol</label>
      <input id="symbol" name="symbol" maxlength="10" required />
      <label for="note">Note (optional)</label>
      <input id="note" name="note" maxlength="200" />
      <button type="submit">Add / Activate</button>
    </form>

    <section>
      <h2>Active Tickers</h2>
      <ul id="active-list"></ul>
    </section>
  </main>

  <script>
    const statusEl = document.getElementById("status");
    const listEl = document.getElementById("active-list");
    const formEl = document.getElementById("watchlist-form");
    const symbolEl = document.getElementById("symbol");
    const noteEl = document.getElementById("note");

    function setStatus(message, isError = false) {
      statusEl.textContent = message;
      statusEl.style.color = isError ? "#b91c1c" : "#1d4ed8";
    }

    function renderEntries(entries) {
      listEl.innerHTML = "";
      if (entries.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No active tickers";
        listEl.appendChild(empty);
        return;
      }

      for (const entry of entries) {
        const item = document.createElement("li");
        const meta = document.createElement("div");
        const noteText = entry.note ? " | note: " + entry.note : "";
        meta.innerHTML = "<strong>" + entry.symbol + "</strong><div class=\\"meta\\">thread: " + (entry.discordThreadId || "none") + noteText + "</div>";

        const button = document.createElement("button");
        button.textContent = "Deactivate";
        button.className = "danger";
        button.addEventListener("click", async () => {
          const response = await fetch("/api/watchlist/deactivate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: entry.symbol }),
          });
          const payload = await response.json();
          if (!response.ok) {
            setStatus(payload.error || "Deactivate failed", true);
            return;
          }
          setStatus("Deactivated " + payload.entry.symbol);
          await loadEntries();
        });

        item.appendChild(meta);
        item.appendChild(button);
        listEl.appendChild(item);
      }
    }

    async function loadEntries() {
      const response = await fetch("/api/watchlist");
      const payload = await response.json();
      renderEntries(payload.activeEntries || []);
    }

    formEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      const response = await fetch("/api/watchlist/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: symbolEl.value,
          note: noteEl.value,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.error || "Activate failed", true);
        return;
      }
      setStatus("Activated " + payload.entry.symbol + " in thread " + payload.entry.discordThreadId);
      symbolEl.value = "";
      noteEl.value = "";
      await loadEntries();
    });

    loadEntries().catch((error) => {
      setStatus(String(error), true);
    });
  </script>
</body>
</html>
`;

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const ib = createIbkrClient();
  const historicalProvider = new IbkrHistoricalCandleProvider(ib);
  const liveProvider = new IBKRLivePriceProvider(ib);
  const candleService = new CandleFetchService(historicalProvider);
  const levelStore = new LevelStore();
  const monitor = new WatchlistMonitor(levelStore, liveProvider);
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
    discordAlertRouter: new DiscordAlertRouter(new LocalDiscordThreadGateway()),
    opportunityRuntimeController,
    watchlistStatePersistence: new WatchlistStatePersistence(),
  });

  await waitForIbkrConnection(ib);
  await manager.start();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

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

        const entry = await manager.activateSymbol({ symbol, note });
        sendJson(response, 200, { entry });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
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

  server.listen(PORT, () => {
    console.log(`Manual watchlist server running at http://127.0.0.1:${PORT}`);
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
