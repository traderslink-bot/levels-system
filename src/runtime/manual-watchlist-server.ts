import "dotenv/config";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { createTradersLinkAiReadServiceFromEnv } from "../lib/ai/traderslink-ai-read-service.js";
import { TradersLinkAiReadCostLedger } from "../lib/ai/traderslink-ai-read-cost-ledger.js";
import { TradersLinkAiReadSettingsPersistence } from "../lib/ai/traderslink-ai-read-settings.js";
import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { EodhdHistoricalCandleProvider } from "../lib/market-data/eodhd-historical-candle-provider.js";
import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import { DiscordAlertRouter } from "../lib/alerts/alert-router.js";
import { DiscordRestThreadGateway } from "../lib/alerts/discord-rest-thread-gateway.js";
import { LocalDiscordThreadGateway } from "../lib/alerts/local-discord-thread-gateway.js";
import { createLiveWatchlistPublisherFromEnv } from "../lib/live-watchlist/live-watchlist-publisher.js";
import type {
  LiveWatchlistMarketDataStatus,
  LiveWatchlistPublisher,
} from "../lib/live-watchlist/live-watchlist-types.js";
import { WebsitePublishingDiscordGateway } from "../lib/live-watchlist/website-publishing-discord-gateway.js";
import { EodhdLivePriceProvider } from "../lib/monitoring/eodhd-live-price-provider.js";
import { IBKRLivePriceProvider } from "../lib/monitoring/ibkr-live-price-provider.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import {
  LEVEL_INTELLIGENCE_ALERT_PREVIEW_DRY_RUN_ENV,
  ManualWatchlistRuntimeManager,
  type ManualWatchlistRuntimeManagerOptions,
  resolveLevelIntelligenceAlertPreviewDryRun,
} from "../lib/monitoring/manual-watchlist-runtime-manager.js";
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
const LIVE_WATCHLIST_HEALTH_PUBLISH_INTERVAL_MS = 15_000;
const HISTORICAL_PROVIDER_ENV = "LEVEL_HISTORICAL_CANDLE_PROVIDER";
const LIVE_PRICE_PROVIDER_ENV = "LEVEL_LIVE_PRICE_PROVIDER";

type ManualWatchlistProviderName = "ibkr" | "eodhd";

function resolveManualWatchlistProviderName(value: string | undefined): ManualWatchlistProviderName {
  return value?.trim().toLowerCase() === "eodhd" ? "eodhd" : "ibkr";
}

function resolveBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

type DiscordRuntimeEnv = {
  botToken: string | null;
  watchlistChannelId: string | null;
  guildId: string | null;
};

function readDiscordRuntimeEnv(): DiscordRuntimeEnv {
  return {
    botToken: process.env.DISCORD_BOT_TOKEN?.trim() || null,
    watchlistChannelId: process.env.DISCORD_WATCHLIST_CHANNEL_ID?.trim() || null,
    guildId: process.env.DISCORD_GUILD_ID?.trim() || null,
  };
}

function logDiscordRuntimeDiagnostics(env: DiscordRuntimeEnv, mode: "real" | "fallback"): void {
  console.log("[ManualWatchlistRuntime] Discord env diagnostics:");
  console.log(`- DISCORD_BOT_TOKEN: ${env.botToken ? "present" : "missing"}`);
  console.log(
    `- DISCORD_WATCHLIST_CHANNEL_ID: ${env.watchlistChannelId ? "present" : "missing"}`,
  );
  console.log(`- DISCORD_GUILD_ID: ${env.guildId ? "present" : "missing"}`);
  console.log(
    `- Discord gateway mode: ${
      mode === "real" ? "real Discord REST gateway" : "local persisted gateway fallback"
    }`,
  );
}

function logTraderReadRuntimeMode(aiConfigured: boolean): void {
  console.log(
    aiConfigured
      ? "[ManualWatchlistRuntime] TradersLink AI Read enabled; deterministic Trader Read remains available as the baseline."
      : "[ManualWatchlistRuntime] TradersLink AI Read disabled; deterministic Trader Read remains available.",
  );
}

function createDiscordAlertRouter(
  liveWatchlistPublisher: LiveWatchlistPublisher | null,
): DiscordAlertRouter {
  const env = readDiscordRuntimeEnv();
  const hasAnyDiscordConfig = Boolean(env.botToken || env.watchlistChannelId || env.guildId);
  const shouldUseRealDiscord = Boolean(env.botToken && env.watchlistChannelId);

  if (hasAnyDiscordConfig && !shouldUseRealDiscord) {
    throw new Error(
      "Incomplete Discord runtime configuration. Set both DISCORD_BOT_TOKEN and DISCORD_WATCHLIST_CHANNEL_ID to use the real Discord gateway, or remove the partial Discord env values to use the local fallback.",
    );
  }

  if (shouldUseRealDiscord) {
    logDiscordRuntimeDiagnostics(env, "real");
    if (!env.guildId) {
      console.log(
        "[ManualWatchlistRuntime] DISCORD_GUILD_ID is missing. Real Discord posting will still work, but exact-name thread recovery will be limited.",
      );
    }

    const gateway = new DiscordRestThreadGateway({
        botToken: env.botToken!,
        watchlistChannelId: env.watchlistChannelId!,
        guildId: env.guildId ?? undefined,
    });
    return new DiscordAlertRouter(
      new WebsitePublishingDiscordGateway(gateway, liveWatchlistPublisher),
    );
  }

  logDiscordRuntimeDiagnostics(env, "fallback");
  console.log(
    "[ManualWatchlistRuntime] Set DISCORD_BOT_TOKEN and DISCORD_WATCHLIST_CHANNEL_ID in .env for real Discord posting.",
  );
  return new DiscordAlertRouter(
    new WebsitePublishingDiscordGateway(
      new LocalDiscordThreadGateway(),
      liveWatchlistPublisher,
    ),
  );
}

function createLevelIntelligenceAlertPreviewDryRunOptions():
  | ManualWatchlistRuntimeManagerOptions["levelIntelligenceAlertPreviewDryRun"]
  | undefined {
  const enabled = resolveLevelIntelligenceAlertPreviewDryRun(
    process.env[LEVEL_INTELLIGENCE_ALERT_PREVIEW_DRY_RUN_ENV],
  );

  if (!enabled) {
    return undefined;
  }

  console.log(
    "[ManualWatchlistRuntime] Level Intelligence alert preview dry-run sidecar enabled.",
  );
  return {
    enabled: true,
    onPreview: (result) => {
      console.log(result.content);
    },
  };
}

const MANUAL_WATCHLIST_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Manual Watchlist</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; background: #f5f7fb; color: #1f2937; }
    main { max-width: 1080px; margin: 0 auto; }
    form, section { background: #fff; border: 1px solid #d7dee8; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    label { display: block; font-size: 14px; margin-bottom: 6px; }
    input { width: 100%; padding: 10px; border: 1px solid #c7d0dc; border-radius: 8px; margin-bottom: 12px; box-sizing: border-box; }
    button { padding: 10px 14px; border: 0; border-radius: 8px; cursor: pointer; background: #1d4ed8; color: #fff; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { display: flex; justify-content: space-between; gap: 16px; align-items: center; border-top: 1px solid #e5e7eb; padding: 14px 0; }
    li:first-child { border-top: 0; }
    .meta { color: #4b5563; font-size: 13px; }
    .status { min-height: 20px; font-size: 14px; margin-bottom: 12px; color: #1d4ed8; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .secondary { background: #475569; }
    .switch { display: inline-flex; align-items: center; gap: 8px; background: #475569; }
    .switch[aria-checked="true"] { background: #047857; }
    .switch-dot { width: 14px; height: 14px; border-radius: 999px; background: #fff; box-shadow: 0 0 0 2px rgba(255,255,255,.3); }
    button:disabled { cursor: not-allowed; opacity: .5; }
    .danger { background: #b91c1c; }
    .cost-note { color: #4b5563; font-size: 13px; line-height: 1.45; }
    .control-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
    .control-row h2 { margin: 0 0 6px; }
    .control-row p { margin: 0; }
    .cost-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 14px 0 18px; }
    .cost-metric { border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; padding: 12px; }
    .cost-metric span { display: block; color: #64748b; font-size: 12px; }
    .cost-metric strong { display: block; margin-top: 4px; font-size: 20px; }
    .cost-metric small { color: #475569; font-size: 11px; }
    .cost-table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-top: 1px solid #e5e7eb; padding: 9px 8px; text-align: right; white-space: nowrap; }
    th:first-child, td:first-child { text-align: left; }
    th { color: #475569; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .cost-breakdowns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
    .cost-breakdowns > div { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; }
    .cost-breakdowns h3 { margin: 0 0 6px; font-size: 14px; }
    .cost-breakdowns p { margin: 4px 0; color: #475569; font-size: 12px; }
    @media (max-width: 680px) {
      li { align-items: flex-start; flex-direction: column; }
      .actions { justify-content: flex-start; }
      .control-row { align-items: flex-start; flex-direction: column; }
      .cost-grid, .cost-breakdowns { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <form id="watchlist-form">
      <h1>Manual Watchlist</h1>
      <div class="status" id="status"></div>
      <label for="symbol">npm run watchlist:manual</label>
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

    <section>
      <div class="control-row">
        <div>
          <h2>AI Research Controls</h2>
          <p class="cost-note">External web research is optional and costs extra. Your local press-release/SEC database stays active either way. Changing this setting does not regenerate existing reads.</p>
        </div>
        <button id="external-research-toggle" type="button" class="switch" role="switch" aria-checked="false">
          <span class="switch-dot" aria-hidden="true"></span>
          <span id="external-research-label">External web research: Off</span>
        </button>
      </div>
    </section>

    <section>
      <h2>TradersLink AI Read Expense Tracking</h2>
      <p class="cost-note" id="cost-note">Loading estimated OpenAI usage...</p>
      <div class="cost-grid" id="cost-grid"></div>
      <div class="cost-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Reads</th>
              <th>Web searches</th>
              <th>Tokens</th>
              <th>Total cost</th>
              <th>Avg / read</th>
              <th>Last reason</th>
              <th>Last generated</th>
            </tr>
          </thead>
          <tbody id="cost-ticker-body"></tbody>
        </table>
      </div>
      <div class="cost-breakdowns">
        <div><h3>Cost by refresh reason</h3><div id="cost-trigger-list"></div></div>
        <div><h3>Cost by model</h3><div id="cost-model-list"></div></div>
      </div>
    </section>
  </main>

  <script>
    const statusEl = document.getElementById("status");
    const listEl = document.getElementById("active-list");
    const formEl = document.getElementById("watchlist-form");
    const symbolEl = document.getElementById("symbol");
    const noteEl = document.getElementById("note");
    const costNoteEl = document.getElementById("cost-note");
    const costGridEl = document.getElementById("cost-grid");
    const costTickerBodyEl = document.getElementById("cost-ticker-body");
    const costTriggerListEl = document.getElementById("cost-trigger-list");
    const costModelListEl = document.getElementById("cost-model-list");
    const externalResearchToggleEl = document.getElementById("external-research-toggle");
    const externalResearchLabelEl = document.getElementById("external-research-label");

    function setStatus(message, isError = false) {
      statusEl.textContent = message;
      statusEl.style.color = isError ? "#b91c1c" : "#1d4ed8";
    }

    function formatUsd(value) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 4,
        maximumFractionDigits: 6,
      }).format(Number(value || 0));
    }

    function formatCount(value) {
      return new Intl.NumberFormat("en-US").format(Number(value || 0));
    }

    function formatReason(value) {
      return String(value || "unknown").replaceAll("_", " ");
    }

    function renderCostSummary(summary) {
      if (!summary || !summary.windows) {
        costNoteEl.textContent = "No expense summary is available.";
        return;
      }
      costNoteEl.textContent = summary.estimateNotice;
      costGridEl.innerHTML = "";
      const windows = [
        ["Today", summary.windows.today],
        ["Last 7 days", summary.windows.last7Days],
        ["Last 30 days", summary.windows.last30Days],
        ["All time", summary.windows.allTime],
      ];
      for (const [label, totals] of windows) {
        const metric = document.createElement("div");
        metric.className = "cost-metric";
        const title = document.createElement("span");
        title.textContent = label;
        const value = document.createElement("strong");
        value.textContent = formatUsd(totals.estimatedTotalCostUsd);
        const detail = document.createElement("small");
        detail.textContent = formatCount(totals.requestCount) + " reads | " +
          formatCount(totals.webSearchCallCount) + " searches" +
          (totals.unpricedRequestCount ? " | " + totals.unpricedRequestCount + " unpriced" : "");
        metric.append(title, value, detail);
        costGridEl.appendChild(metric);
      }

      costTickerBodyEl.innerHTML = "";
      if (!summary.perTicker.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 8;
        cell.textContent = "No AI Read usage has been recorded yet.";
        row.appendChild(cell);
        costTickerBodyEl.appendChild(row);
      }
      for (const ticker of summary.perTicker) {
        const row = document.createElement("tr");
        const values = [
          ticker.symbol,
          formatCount(ticker.requestCount),
          formatCount(ticker.webSearchCallCount),
          formatCount(ticker.totalTokens),
          formatUsd(ticker.estimatedTotalCostUsd),
          formatUsd(ticker.averageCostPerRequestUsd),
          formatReason(ticker.lastTrigger),
          new Date(ticker.lastGeneratedAt).toLocaleString(),
        ];
        for (const value of values) {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        }
        costTickerBodyEl.appendChild(row);
      }

      const renderBreakdown = (element, items, labelKey) => {
        element.innerHTML = "";
        if (!items.length) {
          const empty = document.createElement("p");
          empty.textContent = "No usage yet.";
          element.appendChild(empty);
          return;
        }
        for (const item of items) {
          const line = document.createElement("p");
          line.textContent = formatReason(item[labelKey]) + ": " +
            formatUsd(item.totals.estimatedTotalCostUsd) + " (" +
            formatCount(item.totals.requestCount) + " reads)";
          element.appendChild(line);
        }
      };
      renderBreakdown(costTriggerListEl, summary.byTrigger, "trigger");
      renderBreakdown(costModelListEl, summary.byModel, "model");
    }

    function renderExternalResearch(enabled) {
      externalResearchToggleEl.setAttribute("aria-checked", enabled ? "true" : "false");
      externalResearchLabelEl.textContent = "External web research: " + (enabled ? "On" : "Off");
      externalResearchToggleEl.dataset.enabled = enabled ? "true" : "false";
    }

    function renderEntries(entries, aiReadConfigured) {
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
        const symbol = document.createElement("strong");
        symbol.textContent = entry.symbol;
        const details = document.createElement("div");
        details.className = "meta";
        details.textContent = "thread: " + (entry.discordThreadId || "none") + (entry.note ? " | note: " + entry.note : "");
        meta.appendChild(symbol);
        meta.appendChild(details);

        const actions = document.createElement("div");
        actions.className = "actions";

        const visible = entry.tradersLinkAiReadCardVisible !== false;
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "switch";
        toggle.setAttribute("role", "switch");
        toggle.setAttribute("aria-checked", visible ? "true" : "false");
        toggle.setAttribute("aria-label", "Show TradersLink AI Read for " + entry.symbol);
        const dot = document.createElement("span");
        dot.className = "switch-dot";
        dot.setAttribute("aria-hidden", "true");
        const toggleLabel = document.createElement("span");
        toggleLabel.textContent = "AI Read: " + (visible ? "Shown" : "Hidden");
        toggle.appendChild(dot);
        toggle.appendChild(toggleLabel);
        toggle.addEventListener("click", async () => {
          toggle.disabled = true;
          const response = await fetch("/api/watchlist/ai-read-visibility", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: entry.symbol, visible: !visible }),
          });
          const payload = await response.json();
          if (!response.ok) {
            toggle.disabled = false;
            setStatus(payload.error || "AI Read visibility update failed", true);
            return;
          }
          setStatus("TradersLink AI Read " + (!visible ? "shown" : "hidden") + " for " + entry.symbol);
          await loadEntries();
        });

        const dipBuyPlanVisible = entry.tradersLinkAiReadDipBuyPlanVisible !== false;
        const dipBuyPlanToggle = document.createElement("button");
        dipBuyPlanToggle.type = "button";
        dipBuyPlanToggle.className = "switch";
        dipBuyPlanToggle.setAttribute("role", "switch");
        dipBuyPlanToggle.setAttribute("aria-checked", dipBuyPlanVisible ? "true" : "false");
        dipBuyPlanToggle.setAttribute(
          "aria-label",
          "Show Potential dip-buy plan for " + entry.symbol,
        );
        const dipBuyPlanDot = document.createElement("span");
        dipBuyPlanDot.className = "switch-dot";
        dipBuyPlanDot.setAttribute("aria-hidden", "true");
        const dipBuyPlanLabel = document.createElement("span");
        dipBuyPlanLabel.textContent =
          "Potential dip-buy plan: " + (dipBuyPlanVisible ? "Shown" : "Hidden");
        dipBuyPlanToggle.appendChild(dipBuyPlanDot);
        dipBuyPlanToggle.appendChild(dipBuyPlanLabel);
        dipBuyPlanToggle.addEventListener("click", async () => {
          dipBuyPlanToggle.disabled = true;
          const response = await fetch("/api/watchlist/ai-read-dip-buy-visibility", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: entry.symbol, visible: !dipBuyPlanVisible }),
          });
          const payload = await response.json();
          if (!response.ok) {
            dipBuyPlanToggle.disabled = false;
            setStatus(payload.error || "Dip-buy plan visibility update failed", true);
            return;
          }
          setStatus(
            "Potential dip-buy plan " + (!dipBuyPlanVisible ? "shown" : "hidden") +
            " for " + entry.symbol,
          );
          await loadEntries();
        });

        const refresh = document.createElement("button");
        refresh.type = "button";
        refresh.className = "secondary";
        refresh.textContent = "Refresh AI Read";
        refresh.disabled = !aiReadConfigured || !visible;
        refresh.title = aiReadConfigured ? "Generate a fresh read now" : "OpenAI is not configured";
        refresh.addEventListener("click", async () => {
          refresh.disabled = true;
          setStatus("Refreshing TradersLink AI Read for " + entry.symbol + "...");
          const response = await fetch("/api/watchlist/ai-read-refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: entry.symbol }),
          });
          const payload = await response.json();
          refresh.disabled = false;
          if (!response.ok) {
            setStatus(payload.error || "AI Read refresh failed", true);
            return;
          }
          setStatus(payload.generated ? "Refreshed TradersLink AI Read for " + entry.symbol : "An AI Read refresh is already running for " + entry.symbol);
        });

        const button = document.createElement("button");
        button.type = "button";
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
        actions.appendChild(toggle);
        actions.appendChild(dipBuyPlanToggle);
        actions.appendChild(refresh);
        actions.appendChild(button);
        item.appendChild(actions);
        listEl.appendChild(item);
      }
    }

    async function loadEntries() {
      const response = await fetch("/api/watchlist");
      const payload = await response.json();
      renderEntries(payload.activeEntries || [], payload.aiReadConfigured === true);
      renderCostSummary(payload.aiReadCostSummary);
      renderExternalResearch(payload.aiReadExternalResearchEnabled === true);
    }

    externalResearchToggleEl.addEventListener("click", async () => {
      const enabled = externalResearchToggleEl.dataset.enabled !== "true";
      externalResearchToggleEl.disabled = true;
      const response = await fetch("/api/watchlist/ai-read-external-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json();
      externalResearchToggleEl.disabled = false;
      if (!response.ok) {
        setStatus(payload.error || "External research update failed", true);
        return;
      }
      renderExternalResearch(payload.enabled === true);
      setStatus(
        "External web research " + (payload.enabled ? "enabled" : "disabled") +
        ". Local press-release/SEC research remains enabled.",
      );
    });

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

function resolveMarketDataStatus(args: {
  startupState: "booting" | "ready" | "error";
  priceFeedStatus?: "live" | "stale" | "waiting";
}): LiveWatchlistMarketDataStatus {
  if (args.startupState === "error") {
    return "offline";
  }
  if (args.startupState === "booting") {
    return "starting";
  }
  switch (args.priceFeedStatus) {
    case "live":
      return "live";
    case "stale":
      return "stale";
    case "waiting":
    default:
      return "starting";
  }
}

function publishLiveWatchlistHealth(args: {
  publisher: LiveWatchlistPublisher | null;
  manager: ManualWatchlistRuntimeManager;
  startupState: "booting" | "ready" | "error";
}): void {
  if (!args.publisher?.publishHealth) {
    return;
  }

  const health = args.manager.getRuntimeHealth();
  const marketDataStatus = resolveMarketDataStatus({
    startupState: args.startupState,
    priceFeedStatus: health.providerHealth.priceFeedStatus,
  });
  void args.publisher
    .publishHealth({
      type: "health",
      marketDataStatus,
      marketDataUpdatedAt: health.lastPriceUpdateAt ?? Date.now(),
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ManualWatchlistRuntime] Failed to publish live watchlist health: ${message}`);
    });
}

async function main(): Promise<void> {
  const historicalProviderName = resolveManualWatchlistProviderName(
    process.env[HISTORICAL_PROVIDER_ENV],
  );
  const liveProviderName = resolveManualWatchlistProviderName(
    process.env[LIVE_PRICE_PROVIDER_ENV],
  );
  const needsIbkr = historicalProviderName === "ibkr" || liveProviderName === "ibkr";
  const ib = needsIbkr ? createIbkrClient() : null;
  const historicalProvider = historicalProviderName === "eodhd"
    ? new EodhdHistoricalCandleProvider()
    : new IbkrHistoricalCandleProvider(ib!);
  const liveProvider = liveProviderName === "eodhd"
    ? new EodhdLivePriceProvider()
    : new IBKRLivePriceProvider(ib!);
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
  const levelIntelligenceAlertPreviewDryRun = createLevelIntelligenceAlertPreviewDryRunOptions();
  const liveWatchlistPublisher = createLiveWatchlistPublisherFromEnv();
  const tradersLinkAiReadService = createTradersLinkAiReadServiceFromEnv();
  const tradersLinkAiReadSettingsPersistence = new TradersLinkAiReadSettingsPersistence({
    ...(process.env.TRADERSLINK_AI_READ_SETTINGS_FILE?.trim()
      ? { filePath: process.env.TRADERSLINK_AI_READ_SETTINGS_FILE.trim() }
      : {}),
  });
  const persistedTradersLinkAiReadSettings = tradersLinkAiReadSettingsPersistence.load();
  let aiReadExternalResearchEnabled =
    persistedTradersLinkAiReadSettings?.externalResearchEnabled ??
    tradersLinkAiReadService?.isExternalResearchEnabled() ??
    false;
  tradersLinkAiReadService?.setExternalResearchEnabled(aiReadExternalResearchEnabled);
  if (!persistedTradersLinkAiReadSettings) {
    tradersLinkAiReadSettingsPersistence.save(aiReadExternalResearchEnabled);
  }
  const tradersLinkAiReadCostLedger = new TradersLinkAiReadCostLedger({
    ...(process.env.TRADERSLINK_AI_READ_COST_LEDGER_FILE?.trim()
      ? { filePath: process.env.TRADERSLINK_AI_READ_COST_LEDGER_FILE.trim() }
      : {}),
  });
  logTraderReadRuntimeMode(Boolean(tradersLinkAiReadService && liveWatchlistPublisher));
  console.log(
    `[ManualWatchlistRuntime] Live website watchlist publisher ${
      liveWatchlistPublisher ? "enabled" : "disabled"
    }.`,
  );
  const manager = new ManualWatchlistRuntimeManager({
    candleFetchService: candleService,
    levelStore,
    monitor,
    discordAlertRouter: createDiscordAlertRouter(liveWatchlistPublisher),
    opportunityRuntimeController,
    liveWatchlistPublisher,
    tradersLinkAiReadService,
    tradersLinkAiReadCostLedger,
    tradersLinkAiReadStartupRefreshEnabled: resolveBoolean(
      process.env.TRADERSLINK_AI_READ_STARTUP_REFRESH_ENABLED,
      false,
    ),
    watchlistStatePersistence: new WatchlistStatePersistence(),
    ...(levelIntelligenceAlertPreviewDryRun
      ? { levelIntelligenceAlertPreviewDryRun }
      : {}),
  });
  let startupState: "booting" | "ready" | "error" = "booting";
  const liveWatchlistHealthTimer = setInterval(() => {
    publishLiveWatchlistHealth({
      publisher: liveWatchlistPublisher,
      manager,
      startupState,
    });
  }, LIVE_WATCHLIST_HEALTH_PUBLISH_INTERVAL_MS);

  try {
    if (ib) {
      await waitForIbkrConnection(ib);
    }
    console.log(
      `[ManualWatchlistRuntime] Candle provider path: ${candleService.getProviderName()}`,
    );
    console.log(`[ManualWatchlistRuntime] Live price provider path: ${liveProviderName}`);
    await manager.start();
    startupState = "ready";
    publishLiveWatchlistHealth({
      publisher: liveWatchlistPublisher,
      manager,
      startupState,
    });
  } catch (error) {
    startupState = "error";
    publishLiveWatchlistHealth({
      publisher: liveWatchlistPublisher,
      manager,
      startupState,
    });
    throw error;
  }

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
        startupState,
        activeEntries: manager.getActiveEntries(),
        aiReadConfigured: manager.isTradersLinkAiReadConfigured(),
        aiReadExternalResearchEnabled,
        aiReadCostSummary: tradersLinkAiReadCostLedger.summarize(),
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

    if (request.method === "POST" && url.pathname === "/api/watchlist/ai-read-visibility") {
      try {
        const body = await readJsonBody(request);
        const symbol = typeof body.symbol === "string" ? body.symbol : "";
        const visible = body.visible;
        if (symbol.trim().length === 0 || typeof visible !== "boolean") {
          sendJson(response, 400, { error: "Symbol and boolean visible value are required." });
          return;
        }
        const entry = await manager.setTradersLinkAiReadCardVisible(symbol, visible);
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

    if (request.method === "POST" && url.pathname === "/api/watchlist/ai-read-external-research") {
      try {
        const body = await readJsonBody(request);
        const enabled = body.enabled;
        if (typeof enabled !== "boolean") {
          sendJson(response, 400, { error: "Boolean enabled value is required." });
          return;
        }
        tradersLinkAiReadSettingsPersistence.save(enabled);
        aiReadExternalResearchEnabled = enabled;
        tradersLinkAiReadService?.setExternalResearchEnabled(enabled);
        sendJson(response, 200, { enabled });
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
        sendJson(response, 200, { generated: Boolean(read), read });
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
    clearInterval(liveWatchlistHealthTimer);
    await liveWatchlistPublisher?.publishHealth?.({
      type: "health",
      marketDataStatus: "offline",
      marketDataUpdatedAt: Date.now(),
    });
    if (signal) {
      console.log(`Received ${signal}. Shutting down manual watchlist server...`);
    }

    server.close();
    await manager.stop();
    ib?.disconnect();
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
