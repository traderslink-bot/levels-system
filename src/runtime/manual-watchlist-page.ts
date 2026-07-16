export const MANUAL_WATCHLIST_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Manual Watchlist</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; background: #f5f7fb; color: #1f2937; }
    main { max-width: 920px; margin: 0 auto; }
    form, section { background: #fff; border: 1px solid #d7dee8; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    label { display: block; font-size: 14px; margin-bottom: 6px; }
    input, select, textarea { width: 100%; padding: 10px; border: 1px solid #c7d0dc; border-radius: 8px; margin-bottom: 12px; box-sizing: border-box; }
    textarea { min-height: 84px; resize: vertical; font-family: Arial, sans-serif; line-height: 1.35; }
    button { min-width: 94px; padding: 10px 14px; border: 0; border-radius: 8px; cursor: pointer; background: #1d4ed8; color: #fff; white-space: nowrap; }
    button:disabled { cursor: wait; opacity: 0.62; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { display: flex; justify-content: space-between; gap: 12px; align-items: center; border-top: 1px solid #e5e7eb; padding: 12px 0; }
    li:first-child { border-top: 0; }
    h1, h2 { margin-top: 0; }
    .meta { color: #4b5563; font-size: 13px; }
    .entry-main { min-width: 0; }
    .top-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
    .entry-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 4px; }
    .entry-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .entry-state { margin-top: 6px; color: #334155; font-size: 13px; overflow-wrap: anywhere; }
    .badge { display: inline-flex; align-items: center; min-height: 22px; padding: 2px 8px; border-radius: 999px; background: #e5e7eb; color: #374151; font-size: 12px; font-weight: 700; }
    .badge-active { background: #dcfce7; color: #166534; }
    .badge-working { background: #fef3c7; color: #92400e; }
    .badge-failed { background: #fee2e2; color: #991b1b; }
    .error-line { color: #991b1b; margin-top: 4px; overflow-wrap: anywhere; }
    .status { min-height: 20px; font-size: 14px; margin-bottom: 12px; color: #1d4ed8; }
    .runtime-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .runtime-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; min-height: 58px; }
    .runtime-label { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
    .runtime-value { font-size: 14px; word-break: break-word; }
    .provider-control { border: 1px solid #dbe3ee; border-radius: 8px; padding: 12px; background: #fbfdff; margin-bottom: 12px; }
    .inline-control { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
    .inline-control select { flex: 1 1 220px; margin-bottom: 0; }
    .inline-control button { flex: 0 0 auto; }
    .inline-status { color: #475569; font-size: 13px; margin-top: 8px; min-height: 18px; overflow-wrap: anywhere; }
    .toggle-control { align-items: center; }
    .toggle-switch { align-items: center; cursor: pointer; display: inline-flex; gap: 10px; margin: 0; }
    .toggle-switch input { height: 1px; margin: 0; opacity: 0; position: absolute; width: 1px; }
    .toggle-slider { background: #cbd5e1; border-radius: 999px; display: inline-flex; height: 24px; position: relative; transition: background 0.16s ease; width: 44px; }
    .toggle-slider::after { background: #fff; border-radius: 999px; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2); content: ""; height: 18px; left: 3px; position: absolute; top: 3px; transition: transform 0.16s ease; width: 18px; }
    .toggle-switch input:checked + .toggle-slider { background: #16a34a; }
    .toggle-switch input:checked + .toggle-slider::after { transform: translateX(20px); }
    .toggle-switch input:disabled + .toggle-slider { opacity: 0.6; }
    .health-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 16px; }
    .health-item { border: 1px solid #dbe3ee; border-radius: 8px; padding: 10px; background: #fbfdff; min-height: 54px; }
    .health-label { color: #64748b; font-size: 12px; margin-bottom: 4px; }
    .health-value { font-size: 18px; font-weight: 700; }
    .activity-list li { align-items: flex-start; justify-content: flex-start; }
    .activity-time { color: #64748b; flex: 0 0 96px; font-size: 13px; }
    .activity-message { min-width: 0; overflow-wrap: anywhere; }
    .activity-detail { color: #64748b; font-size: 12px; margin-top: 2px; }
    .notice { border: 1px solid #fde68a; background: #fffbeb; border-radius: 8px; color: #78350f; padding: 10px; font-size: 13px; margin-bottom: 12px; }
    .field-hint { color: #64748b; font-size: 12px; line-height: 1.4; margin: -6px 0 12px; }
    .artifact-list { display: grid; grid-template-columns: 1fr; gap: 10px; }
    .artifact-card { border: 1px solid #dbe3ee; border-radius: 8px; padding: 10px; background: #fbfdff; }
    .artifact-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .artifact-preview { margin: 0; max-height: 180px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; background: #0f172a; color: #e2e8f0; border-radius: 6px; padding: 10px; }
    .danger { background: #b91c1c; }
    .secondary { background: #475569; }
    .quiet { background: #64748b; }
    @media (max-width: 640px) {
      body { margin: 12px; }
      li { align-items: flex-start; flex-direction: column; }
      .entry-actions { width: 100%; justify-content: flex-start; }
      .activity-time { flex-basis: auto; }
    }
  </style>
</head>
<body>
  <main>
    <form id="watchlist-form">
      <h1>Manual Watchlist</h1>
      <div class="top-actions">
        <button class="secondary" id="ai-clean-read-button" type="button">Open AI Clean Read</button>
        <button class="secondary" id="trade-plan-review-button" type="button">Open Trade Plan Review</button>
        <button class="danger" id="clear-discord-button" type="button">Clear Discord Posts</button>
      </div>
      <div class="status" id="status"></div>
      <label for="symbol">npm run watchlist:manual</label>
      <label for="symbol">Symbol</label>
      <input id="symbol" name="symbol" maxlength="10" required />
      <div class="field-hint">
        Use this watchlist for small, micro, and nano-cap momentum tickers. Large liquid names should only be used for deliberate technical tests.
      </div>
      <label for="note">Notes to send to OpenAI (optional)</label>
      <textarea id="note" name="note" maxlength="1200"></textarea>
      <button type="submit">Add / Activate</button>
    </form>

    <section>
      <h2>Active Tickers</h2>
      <div class="health-grid" id="watchlist-health"></div>
      <ul id="active-list"></ul>
    </section>

    <section>
      <h2>Runtime Status</h2>
      <div class="runtime-grid" id="runtime-grid"></div>
    </section>

    <section>
      <h2>Live Website Controls</h2>
      <div class="provider-control">
        <label for="live-trader-read-visible-toggle">Live Website Trader Read Card</label>
        <div class="inline-control toggle-control">
          <label class="toggle-switch">
            <input id="live-trader-read-visible-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
            <span id="live-trader-read-visible-label">Visible to users</span>
          </label>
        </div>
        <div class="inline-status" id="live-trader-read-visible-status"></div>
      </div>
    </section>

    <section>
      <h2>Provider Health</h2>
      <div class="runtime-grid" id="provider-health-grid"></div>
      <ul class="activity-list" id="restart-readiness-list"></ul>
    </section>

    <section>
      <h2>Monday Live Review</h2>
      <div class="runtime-grid" id="monday-review-grid"></div>
      <ul class="activity-list" id="monday-review-list"></ul>
    </section>

    <section>
      <h2>Review Artifacts</h2>
      <div class="artifact-list" id="artifact-list"></div>
    </section>

    <section>
      <h2>Runtime Config</h2>
      <div class="provider-control">
        <label for="historical-provider-select">Historical Candle Provider</label>
        <div class="inline-control">
          <select id="historical-provider-select" name="historical-provider">
            <option value="ibkr">IBKR</option>
            <option value="eodhd">EODHD</option>
          </select>
          <button id="apply-historical-provider-button" type="button">Apply</button>
        </div>
        <div class="inline-status" id="historical-provider-status"></div>
      </div>
      <div class="provider-control">
        <label for="live-provider-select">Live Price Provider</label>
        <div class="inline-control">
          <select id="live-provider-select" name="live-provider">
            <option value="ibkr">IBKR</option>
            <option value="eodhd">EODHD</option>
          </select>
          <button id="apply-live-provider-button" type="button">Apply</button>
        </div>
        <div class="inline-status" id="live-provider-status"></div>
      </div>
      <div class="notice" id="ai-notice"></div>
      <div class="runtime-grid" id="config-grid"></div>
    </section>

    <section>
      <h2>Activity</h2>
      <ul class="activity-list" id="activity-list"></ul>
    </section>
  </main>

  <script>
    const statusEl = document.getElementById("status");
    const listEl = document.getElementById("active-list");
    const watchlistHealthEl = document.getElementById("watchlist-health");
    const runtimeGridEl = document.getElementById("runtime-grid");
    const providerHealthGridEl = document.getElementById("provider-health-grid");
    const restartReadinessListEl = document.getElementById("restart-readiness-list");
    const mondayReviewGridEl = document.getElementById("monday-review-grid");
    const mondayReviewListEl = document.getElementById("monday-review-list");
    const artifactListEl = document.getElementById("artifact-list");
    const configGridEl = document.getElementById("config-grid");
    const aiNoticeEl = document.getElementById("ai-notice");
    const activityListEl = document.getElementById("activity-list");
    const formEl = document.getElementById("watchlist-form");
    const clearDiscordButtonEl = document.getElementById("clear-discord-button");
    const aiCleanReadButtonEl = document.getElementById("ai-clean-read-button");
    const tradePlanReviewButtonEl = document.getElementById("trade-plan-review-button");
    const historicalProviderSelectEl = document.getElementById("historical-provider-select");
    const applyHistoricalProviderButtonEl = document.getElementById("apply-historical-provider-button");
    const historicalProviderStatusEl = document.getElementById("historical-provider-status");
    const liveProviderSelectEl = document.getElementById("live-provider-select");
    const applyLiveProviderButtonEl = document.getElementById("apply-live-provider-button");
    const liveProviderStatusEl = document.getElementById("live-provider-status");
    const liveTraderReadVisibleToggleEl = document.getElementById("live-trader-read-visible-toggle");
    const liveTraderReadVisibleLabelEl = document.getElementById("live-trader-read-visible-label");
    const liveTraderReadVisibleStatusEl = document.getElementById("live-trader-read-visible-status");
    const symbolEl = document.getElementById("symbol");
    const noteEl = document.getElementById("note");
    let currentHistoricalProvider = "";
    let currentLiveProvider = "";
    let providerSelectionDirty = false;
    let providerApplyInFlight = false;
    let liveProviderSelectionDirty = false;
    let liveProviderApplyInFlight = false;
    let liveTraderReadVisible = true;
    let liveTraderReadVisibilityInFlight = false;
    const largeLiquidTickerSymbols = new Set([
      "AAPL",
      "MSFT",
      "NVDA",
      "AMZN",
      "META",
      "GOOGL",
      "GOOG",
      "TSLA",
      "AMD",
      "NFLX",
      "AVGO",
      "CRM",
      "COST",
      "LLY",
      "JPM",
      "V",
      "MA",
      "SPY",
      "QQQ",
      "IWM"
    ]);

    function setStatus(message, isError = false) {
      statusEl.textContent = message;
      statusEl.style.color = isError ? "#b91c1c" : "#1d4ed8";
    }

    function appendMetaValue(container, label, value) {
      if (!value) {
        return;
      }

      container.appendChild(document.createTextNode(" | " + label + ": " + value));
    }

    function formatTime(value) {
      return value ? new Date(value).toLocaleTimeString() : "";
    }

    function lifecycleLabel(value) {
      return String(value || "unknown").replace(/_/g, " ");
    }

    function formatNumber(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return "";
      }
      return value >= 1 ? value.toFixed(2) : value.toFixed(4);
    }

    function providerLabel(value) {
      if (value === "eodhd") {
        return "EODHD";
      }
      if (value === "ibkr") {
        return "IBKR";
      }
      return lifecycleLabel(value);
    }

    function lifecycleBadgeClass(value) {
      if (value === "active") {
        return "badge badge-active";
      }
      if (value === "activation_failed") {
        return "badge badge-failed";
      }
      if (
        value === "activating" ||
        value === "restoring" ||
        value === "refresh_pending" ||
        value === "extension_pending"
      ) {
        return "badge badge-working";
      }
      return "badge";
    }

    function createBadge(text, className) {
      const badge = document.createElement("span");
      badge.className = className || "badge";
      badge.textContent = text;
      return badge;
    }

    function shouldConfirmLargeLiquidTicker(symbol) {
      return largeLiquidTickerSymbols.has(String(symbol || "").trim().toUpperCase());
    }

    function buildEntryMeta(entry) {
      const meta = document.createElement("div");
      const header = document.createElement("div");
      const title = document.createElement("strong");
      const details = document.createElement("div");
      const lastPostText = formatTime(entry.lastLevelPostAt);
      const lastLiveText = formatTime(entry.lastPriceUpdateAt);
      const lastThreadPostText = formatTime(entry.lastThreadPostAt);
      const lastStoryText = entry.lastTradeStoryState
        ? lifecycleLabel(entry.lastTradeStoryState) + (entry.lastTradeStoryAt ? " at " + formatTime(entry.lastTradeStoryAt) : "")
        : "";
      const priceFreshness = entry.lastPriceUpdateAt
        ? formatAge(Date.now() - entry.lastPriceUpdateAt)
        : "";
      const levelFreshness = entry.lastLevelPostAt
        ? formatAge(Date.now() - entry.lastLevelPostAt)
        : "";

      meta.className = "entry-main";
      header.className = "entry-title";
      title.textContent = entry.symbol;
      header.appendChild(title);
      header.appendChild(createBadge(lifecycleLabel(entry.lifecycle), lifecycleBadgeClass(entry.lifecycle)));

      details.className = "meta";
      details.appendChild(
        document.createTextNode("Discord thread ID: " + (entry.discordThreadId || "pending")),
      );
      appendMetaValue(details, "last snapshot", lastPostText);
      appendMetaValue(details, "last price", lastLiveText);
      appendMetaValue(details, "price", formatNumber(entry.lastPrice));
      appendMetaValue(details, "price age", priceFreshness);
      appendMetaValue(details, "last post", lastThreadPostText);
      appendMetaValue(details, "post type", entry.lastThreadPostKind);
      appendMetaValue(details, "story", lastStoryText);
      appendMetaValue(details, "trigger", formatNumber(entry.lastTriggerPrice));
      appendMetaValue(details, "levels age", levelFreshness);
      appendMetaValue(details, "OpenAI notes", entry.note);

      meta.appendChild(header);
      meta.appendChild(details);
      if (entry.operationStatus) {
        const state = document.createElement("div");
        state.className = "entry-state";
        state.textContent = entry.operationStatus;
        meta.appendChild(state);
      }
      if (entry.lastError) {
        const error = document.createElement("div");
        error.className = "meta error-line";
        error.textContent = "last error: " + entry.lastError;
        meta.appendChild(error);
      }
      return meta;
    }

    function createRuntimeCard(label, value) {
      const card = document.createElement("div");
      const labelEl = document.createElement("div");
      const valueEl = document.createElement("div");

      card.className = "runtime-card";
      labelEl.className = "runtime-label";
      valueEl.className = "runtime-value";
      labelEl.textContent = label;
      valueEl.textContent = value || "n/a";
      card.appendChild(labelEl);
      card.appendChild(valueEl);
      return card;
    }

    function createHealthItem(label, value) {
      const item = document.createElement("div");
      const labelEl = document.createElement("div");
      const valueEl = document.createElement("div");

      item.className = "health-item";
      labelEl.className = "health-label";
      valueEl.className = "health-value";
      labelEl.textContent = label;
      valueEl.textContent = value;
      item.appendChild(labelEl);
      item.appendChild(valueEl);
      return item;
    }

    function renderWatchlistHealth(status) {
      const health = status.runtimeHealth || {};
      const counts = health.lifecycleCounts || {};
      const stuck = health.stuckActivations || [];
      watchlistHealthEl.innerHTML = "";
      const values = [
        ["Active", String(counts.active || 0)],
        ["Activating", String(counts.activating || 0)],
        ["Restoring", String(counts.restoring || 0)],
        ["Stuck", String(stuck.length)],
        ["Failed", String(counts.activation_failed || 0)],
        ["Pending", String((counts.refresh_pending || 0) + (counts.extension_pending || 0))],
        ["Queued", String(health.pendingActivationCount || 0)],
      ];

      for (const [label, value] of values) {
        watchlistHealthEl.appendChild(createHealthItem(label, value));
      }
    }

    function renderRuntimeStatus(status) {
      runtimeGridEl.innerHTML = "";
      renderWatchlistHealth(status);
      renderProviderHealth(status);
      renderMondayReview(status);

      const health = status.runtimeHealth || {};
      const lastPrice = health.lastPriceUpdateAt
        ? health.lastPriceUpdateSymbol + " at " + formatTime(health.lastPriceUpdateAt)
        : "";
      const lastPost = health.lastThreadPostAt
        ? health.lastThreadPostSymbol + " " + health.lastThreadPostKind + " at " + formatTime(health.lastThreadPostAt)
        : "";
      const lastDeliveryFailure = health.lastDeliveryFailureAt
        ? health.lastDeliveryFailureSymbol + " at " + formatTime(health.lastDeliveryFailureAt) + ": " + health.lastDeliveryFailureMessage
        : "";

      const cards = [
        ["Startup", status.startupState],
        ["IBKR", status.ibkrConnected ? "connected" : status.ibkrReconnecting ? "reconnecting" : "disconnected"],
        ["Provider", status.providerName],
        ["Last Price", lastPrice],
        ["Last Discord Post", lastPost],
        ["Last Discord Failure", lastDeliveryFailure],
        ["Diagnostics", status.diagnosticsEnabled ? "on" : "off"],
        ["Active Count", String(status.activeSymbolCount ?? 0)],
        ["Session Folder", status.sessionDirectory],
        ["Review Log", "manual-watchlist-operational.log"],
        ["Diagnostic Log", "manual-watchlist-diagnostics.log"],
        ["Discord Audit", "discord-delivery-audit.jsonl"],
        ["Structure Posts", status.runtimeConfig?.marketStructureStandalonePostMode],
        ["Structure Lifecycle", "market-structure-lifecycle.jsonl"],
        ["Structure Memory", "market-structure-story-memory.json"],
        ["Structure Delivery Audit", "market-structure-delivery-audit.md"],
        ["Structure Outcome Audit", "market-structure-outcome-calibration.md"],
        ["Thread Summary", "thread-summaries.json"],
      ];

      for (const [label, value] of cards) {
        runtimeGridEl.appendChild(createRuntimeCard(label, value));
      }
    }

    function formatAge(value) {
      if (value === null || value === undefined) {
        return "";
      }
      const seconds = Math.round(value / 1000);
      if (seconds < 90) {
        return seconds + "s ago";
      }
      const minutes = Math.round(seconds / 60);
      if (minutes < 90) {
        return minutes + "m ago";
      }
      return Math.round(minutes / 60) + "h ago";
    }

    function renderProviderHealth(status) {
      const health = status.runtimeHealth?.providerHealth || {};
      const seedStats = health.seedStats || {};
      providerHealthGridEl.innerHTML = "";
      restartReadinessListEl.innerHTML = "";
      const notes = Array.isArray(health.notes) ? health.notes.join(" | ") : "";
      const lastPrice =
        health.lastPriceSymbol && health.lastPriceAgeMs !== null && health.lastPriceAgeMs !== undefined
          ? health.lastPriceSymbol + " " + formatAge(health.lastPriceAgeMs)
          : "";
      const lastPost = health.lastPostAgeMs !== null && health.lastPostAgeMs !== undefined
        ? formatAge(health.lastPostAgeMs)
        : "";
      const seedAverage = seedStats.averageDurationMs !== null && seedStats.averageDurationMs !== undefined
        ? formatAge(seedStats.averageDurationMs).replace(" ago", "")
        : "";
      const lastSeed = seedStats.lastSymbol
        ? seedStats.lastSymbol +
          (seedStats.lastDurationMs !== null && seedStats.lastDurationMs !== undefined
            ? " " + formatAge(seedStats.lastDurationMs).replace(" ago", "")
            : "")
        : "";
      const cards = [
        ["Price Feed", lifecycleLabel(health.priceFeedStatus || "waiting")],
        ["Last Price Age", lastPrice],
        ["Discord Delivery", lifecycleLabel(health.discordStatus || "waiting")],
        ["Last Post Age", lastPost],
        ["Historical Data", lifecycleLabel(health.historicalDataStatus || "waiting")],
        ["Pending Seeds", String(health.pendingActivationCount || 0)],
        ["Stuck Seeds", String(health.stuckActivationCount || 0)],
        ["Seed Attempts", String(seedStats.attempts || 0)],
        ["Seed Success / Fail", String(seedStats.successes || 0) + " / " + String(seedStats.failures || 0)],
        ["Seed Timeouts", String(seedStats.timeouts || 0)],
        ["Seeds In Flight", String(seedStats.inFlight || 0)],
        ["Avg Seed Time", seedAverage],
        ["Last Seed", lastSeed],
        ["Notes", notes],
      ];
      for (const [label, value] of cards) {
        providerHealthGridEl.appendChild(createRuntimeCard(label, value));
      }

      const readiness = Array.isArray(health.restartReadiness) ? health.restartReadiness.slice(0, 16) : [];
      if (readiness.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No active symbols to check for restart readiness";
        restartReadinessListEl.appendChild(empty);
        return;
      }

      for (const item of readiness) {
        const row = document.createElement("li");
        const body = document.createElement("div");
        const detail = document.createElement("div");
        const priceAge = item.lastPriceAgeMs !== null && item.lastPriceAgeMs !== undefined
          ? " | price " + formatAge(item.lastPriceAgeMs)
          : "";
        const levelAge = item.lastLevelPostAgeMs !== null && item.lastLevelPostAgeMs !== undefined
          ? " | levels " + formatAge(item.lastLevelPostAgeMs)
          : "";
        body.className = "activity-message";
        body.textContent =
          item.symbol +
          ": levels " +
          lifecycleLabel(item.levelStatus) +
          " | price " +
          lifecycleLabel(item.priceStatus) +
          " | Discord " +
          lifecycleLabel(item.discordStatus);
        detail.className = "activity-detail";
        detail.textContent = (item.reason || "readiness check") + priceAge + levelAge;
        body.appendChild(detail);
        row.appendChild(body);
        restartReadinessListEl.appendChild(row);
      }
    }

    function renderMondayReview(status) {
      const review = status.runtimeHealth?.mondayReview || {};
      mondayReviewGridEl.innerHTML = "";
      mondayReviewListEl.innerHTML = "";

      const cards = [
        ["Post Budget", lifecycleLabel(review.postBudgetStatus || "calm")],
        ["Posts 15m", String(review.postsLast15m || 0)],
        ["Critical 15m", String(review.criticalPostsLast15m || 0)],
        ["Optional 15m", String(review.optionalPostsLast15m || 0)],
        ["Last Why Posted", review.lastWhyPosted || ""],
      ];
      for (const [label, value] of cards) {
        mondayReviewGridEl.appendChild(createRuntimeCard(label, value));
      }

      const checklist = review.checklist || [];
      const symbolBudgets = review.symbolBudgets || [];
      for (const symbolBudget of symbolBudgets) {
        const item = document.createElement("li");
        const body = document.createElement("div");
        const detail = document.createElement("div");
        body.className = "activity-message";
        body.textContent =
          symbolBudget.symbol +
          ": " +
          lifecycleLabel(symbolBudget.status) +
          " | posts 15m " +
          symbolBudget.postsLast15m +
          " | critical " +
          symbolBudget.criticalPostsLast15m +
          " | optional " +
          symbolBudget.optionalPostsLast15m;
        detail.className = "activity-detail";
        detail.textContent = "symbol post budget";
        body.appendChild(detail);
        item.appendChild(body);
        mondayReviewListEl.appendChild(item);
      }

      if (checklist.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No live review checklist yet";
        mondayReviewListEl.appendChild(empty);
        return;
      }
      for (const itemText of checklist) {
        const item = document.createElement("li");
        const body = document.createElement("div");
        body.className = "activity-message";
        body.textContent = itemText;
        item.appendChild(body);
        mondayReviewListEl.appendChild(item);
      }
    }

    function updateHistoricalProviderApplyState() {
      const selected = historicalProviderSelectEl.value;
      const hasChanged = selected && selected !== currentHistoricalProvider;
      applyHistoricalProviderButtonEl.disabled = providerApplyInFlight || !hasChanged;
    }

    function updateLiveProviderApplyState() {
      const selected = liveProviderSelectEl.value;
      const hasChanged = selected && selected !== currentLiveProvider;
      applyLiveProviderButtonEl.disabled = liveProviderApplyInFlight || !hasChanged;
    }

    function renderHistoricalProviderControl(config) {
      const providers = Array.isArray(config.availableHistoricalProviders) && config.availableHistoricalProviders.length > 0
        ? config.availableHistoricalProviders
        : ["ibkr", "eodhd"];
      const activeProvider = config.historicalProvider || "ibkr";
      const priorSelection = historicalProviderSelectEl.value;
      currentHistoricalProvider = activeProvider;
      historicalProviderSelectEl.innerHTML = "";

      for (const provider of providers) {
        const option = document.createElement("option");
        option.value = provider;
        option.textContent = providerLabel(provider);
        historicalProviderSelectEl.appendChild(option);
      }

      const canKeepSelection = providerSelectionDirty && providers.includes(priorSelection);
      historicalProviderSelectEl.value = canKeepSelection ? priorSelection : activeProvider;
      historicalProviderSelectEl.disabled = config.historicalProviderRuntimeMutable === false;
      historicalProviderStatusEl.textContent = "Active: " + providerLabel(activeProvider);
      updateHistoricalProviderApplyState();
    }

    function renderLiveProviderControl(config) {
      const providers = Array.isArray(config.availableLiveProviders) && config.availableLiveProviders.length > 0
        ? config.availableLiveProviders
        : ["ibkr", "eodhd"];
      const activeProvider = config.liveProvider || "ibkr";
      const priorSelection = liveProviderSelectEl.value;
      currentLiveProvider = activeProvider;
      liveProviderSelectEl.innerHTML = "";

      for (const provider of providers) {
        const option = document.createElement("option");
        option.value = provider;
        option.textContent = providerLabel(provider);
        liveProviderSelectEl.appendChild(option);
      }

      const canKeepSelection = liveProviderSelectionDirty && providers.includes(priorSelection);
      liveProviderSelectEl.value = canKeepSelection ? priorSelection : activeProvider;
      liveProviderSelectEl.disabled = config.liveProviderRuntimeMutable === false;
      liveProviderStatusEl.textContent = "Active: " + providerLabel(activeProvider);
      updateLiveProviderApplyState();
    }

    function renderLiveTraderReadVisibilityControl(status, options) {
      const visible = status.runtimeHealth?.liveTraderReadCardVisible !== false;
      if (!options?.keepPreviousState) {
        liveTraderReadVisible = visible;
      }
      liveTraderReadVisibleToggleEl.checked = visible;
      liveTraderReadVisibleToggleEl.disabled = liveTraderReadVisibilityInFlight;
      liveTraderReadVisibleLabelEl.textContent = visible ? "Visible to users" : "Hidden from users";
      liveTraderReadVisibleStatusEl.textContent = visible
        ? "Active live ticker pages can show Trader Read when the runtime has one."
        : "Active live ticker pages will remove the Trader Read card.";
    }

    function renderRuntimeConfig(status) {
      const config = status.runtimeConfig || {};
      const health = status.runtimeHealth || {};
      const ai = health.aiCommentary || {};
      const lastAiGenerated = ai.lastGeneratedAt
        ? ai.lastGeneratedSymbol + " at " + formatTime(ai.lastGeneratedAt) + " via " + ai.lastGeneratedModel
        : "";
      const lastAiFailure = ai.lastFailedAt
        ? ai.lastFailedSymbol + " at " + formatTime(ai.lastFailedAt) + ": " + ai.lastFailureMessage
        : "";

      configGridEl.innerHTML = "";
      renderHistoricalProviderControl(config);
      renderLiveProviderControl(config);
      renderLiveTraderReadVisibilityControl(status);
      aiNoticeEl.textContent =
        "AI commentary can add separate AI read posts after deterministic alerts and can enhance optional symbol recaps. Snapshots, continuity, and follow-through posts still use deterministic text.";

      const cards = [
        ["Server", (config.bindHost || "127.0.0.1") + ":" + (config.port || "3010")],
        ["Historical Provider", config.historicalProvider],
        ["Live Provider", config.liveProvider],
        ["Trader Read Card", health.liveTraderReadCardVisible === false ? "hidden" : "visible"],
        ["Provider Config", config.providerConfigPath],
        ["IBKR Timeout", config.ibkrHistoricalTimeoutMs ? config.ibkrHistoricalTimeoutMs + "ms" : ""],
        ["Candle Cache", config.candleCacheMode],
        ["Runtime Candle Cache", config.runtimeCandleCacheMode],
        ["Startup Cache", config.startupCandleCacheEnabled ? "enabled" : "disabled"],
        ["Candle Cache Dir", config.candleCacheDirectoryPath],
        ["Structure Posts", config.marketStructureStandalonePostMode],
        ["Structure Lifecycle Log", config.marketStructureLifecyclePath],
        ["Structure Memory", config.marketStructureStoryMemoryPath],
        ["Diagnostics Requested", config.monitoringDiagnosticsRequested ? "yes" : "no"],
        ["AI Requested", config.aiCommentaryRequested ? "yes" : "no"],
        ["AI Service", config.aiCommentaryServiceAvailable ? "available" : "unavailable"],
        ["OpenAI Key", config.openAiApiKeyPresent ? "present" : "missing"],
        ["AI Model", config.aiCommentaryModel],
        ["AI Route", config.aiCommentaryRoute],
        ["Clean Read Model", config.aiCleanReadModel],
        ["Clean Read Reasoning", config.aiCleanReadReasoningEffort],
        ["Clean Read Route", config.aiCleanReadRoute],
        ["AI Generated", String(ai.generatedCount || 0)],
        ["AI Failed", String(ai.failedCount || 0)],
        ["Last AI Generated", lastAiGenerated],
        ["Last AI Failure", lastAiFailure],
      ];

      for (const [label, value] of cards) {
        configGridEl.appendChild(createRuntimeCard(label, value));
      }
    }

    function formatBytes(value) {
      if (!value) {
        return "";
      }
      if (value < 1024) {
        return value + " B";
      }
      return Math.round(value / 1024) + " KB";
    }

    function renderReviewArtifacts(payload) {
      artifactListEl.innerHTML = "";
      const artifacts = payload.artifacts || [];
      if (artifacts.length === 0) {
        const empty = document.createElement("div");
        empty.className = "notice";
        empty.textContent = "No review artifact paths are configured.";
        artifactListEl.appendChild(empty);
        return;
      }

      for (const artifact of artifacts) {
        const card = document.createElement("div");
        const head = document.createElement("div");
        const title = document.createElement("strong");
        const meta = document.createElement("div");

        card.className = "artifact-card";
        head.className = "artifact-head";
        title.textContent = artifact.name;
        meta.className = "meta";
        meta.textContent = artifact.exists
          ? [formatBytes(artifact.sizeBytes), artifact.updatedAt ? "updated " + formatTime(artifact.updatedAt) : ""].filter(Boolean).join(" | ")
          : "not generated yet";
        if (artifact.readError) {
          meta.textContent = "temporarily unavailable";
        }
        head.appendChild(title);
        head.appendChild(createBadge(artifact.exists ? "ready" : "missing", artifact.exists ? "badge badge-active" : "badge"));
        card.appendChild(head);
        card.appendChild(meta);

        if (artifact.preview) {
          const preview = document.createElement("pre");
          preview.className = "artifact-preview";
          preview.textContent = artifact.preview;
          card.appendChild(preview);
        }

        if (artifact.readError) {
          const notice = document.createElement("div");
          notice.className = "notice";
          notice.textContent = "This review file is locked right now. Refresh again in a moment.";
          card.appendChild(notice);
        }

        artifactListEl.appendChild(card);
      }
    }

    function renderActivity(entries) {
      activityListEl.innerHTML = "";
      if (!entries || entries.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No recent activity";
        activityListEl.appendChild(empty);
        return;
      }

      for (const entry of entries.slice(0, 25)) {
        const item = document.createElement("li");
        const time = document.createElement("div");
        const body = document.createElement("div");
        const message = document.createElement("div");

        time.className = "activity-time";
        body.className = "activity-message";
        time.textContent = formatTime(entry.timestamp);
        message.textContent = entry.message || lifecycleLabel(entry.event);
        body.appendChild(message);

        if (entry.threadId || entry.details?.reason) {
          const detail = document.createElement("div");
          detail.className = "activity-detail";
          detail.textContent = [
            entry.threadId ? "Discord thread ID: " + entry.threadId : "",
            entry.details?.reason ? "reason: " + entry.details.reason : "",
          ].filter(Boolean).join(" | ");
          body.appendChild(detail);
        }

        item.appendChild(time);
        item.appendChild(body);
        activityListEl.appendChild(item);
      }
    }

    async function activateEntry(symbol, note, retry) {
      const response = await fetch("/api/watchlist/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, note }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.error || "Activate failed", true);
        return false;
      }

      const thread = payload.entry.discordThreadId || "pending";
      setStatus(
        (retry ? "Retry started for " : "Activation started for ") +
          payload.entry.symbol +
          " in thread " +
          thread +
          ".",
      );
      return true;
    }

    async function postEntryAction(path, symbol, successPrefix) {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.error || "Action failed", true);
        return false;
      }

      setStatus(successPrefix + " " + payload.entry.symbol);
      await loadEntries();
      await loadRuntimeStatus();
      return true;
    }

    async function copyThreadId(entry) {
      if (!entry.discordThreadId) {
        setStatus("No Discord thread id yet.", true);
        return;
      }

      try {
        await navigator.clipboard.writeText(entry.discordThreadId);
        setStatus("Copied thread id for " + entry.symbol);
      } catch {
        setStatus("Thread id: " + entry.discordThreadId);
      }
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
        const meta = buildEntryMeta(entry);
        const actions = document.createElement("div");

        actions.className = "entry-actions";
        if (entry.discordThreadId) {
          const copyButton = document.createElement("button");
          copyButton.textContent = "Copy Thread";
          copyButton.className = "quiet";
          copyButton.addEventListener("click", async () => {
            await copyThreadId(entry);
          });
          actions.appendChild(copyButton);
        }

        if (entry.lifecycle === "active" || entry.lifecycle === "refresh_pending" || entry.lifecycle === "extension_pending") {
          const repostButton = document.createElement("button");
          repostButton.textContent = "Repost Snapshot";
          repostButton.className = "secondary";
          repostButton.addEventListener("click", async () => {
            repostButton.disabled = true;
            await postEntryAction("/api/watchlist/repost-snapshot", entry.symbol, "Reposted snapshot for");
            repostButton.disabled = false;
          });
          actions.appendChild(repostButton);

          const refreshButton = document.createElement("button");
          refreshButton.textContent = "Refresh Levels";
          refreshButton.className = "secondary";
          refreshButton.addEventListener("click", async () => {
            refreshButton.disabled = true;
            await postEntryAction("/api/watchlist/refresh-levels", entry.symbol, "Refreshed levels for");
            refreshButton.disabled = false;
          });
          actions.appendChild(refreshButton);
        }

        if (entry.lifecycle === "activation_failed") {
          const retryButton = document.createElement("button");
          retryButton.textContent = "Retry";
          retryButton.className = "secondary";
          retryButton.addEventListener("click", async () => {
            const started = await activateEntry(entry.symbol, entry.note, true);
            if (started) {
              await loadEntries();
              await loadRuntimeStatus();
            }
          });
          actions.appendChild(retryButton);
        }

        const deactivateButton = document.createElement("button");
        deactivateButton.textContent = entry.lifecycle === "activating" ? "Cancel" : "Deactivate";
        deactivateButton.className = "danger";
        deactivateButton.addEventListener("click", async () => {
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
          await loadRuntimeStatus();
        });
        actions.appendChild(deactivateButton);

        item.appendChild(meta);
        item.appendChild(actions);
        listEl.appendChild(item);
      }
    }

    async function loadEntries() {
      const response = await fetch("/api/watchlist");
      const payload = await response.json();
      renderEntries(payload.activeEntries || []);
    }

    async function loadRuntimeStatus() {
      const response = await fetch("/api/runtime/status");
      const payload = await response.json();
      renderRuntimeStatus(payload);
      renderRuntimeConfig(payload);
      renderActivity(payload.recentActivity || []);
    }

    async function loadReviewArtifacts() {
      const response = await fetch("/api/runtime/review-artifacts");
      const payload = await response.json();
      renderReviewArtifacts(payload);
    }

    async function clearDiscordPosts() {
      const confirmed = window.confirm(
        "Delete all posts and threads in the watchlist Discord channel and reset local thread memory?"
      );
      if (!confirmed) {
        return;
      }

      clearDiscordButtonEl.disabled = true;
      setStatus("Clearing Discord posts and resetting local thread memory...");
      try {
        const response = await fetch("/api/discord/clear-watchlist-channel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation: "DELETE_DISCORD_WATCHLIST" }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setStatus(payload.error || "Discord cleanup failed", true);
          return;
        }

        setStatus(
          "Cleared " +
            payload.discordCleanup.threadDeleteCount +
            " Discord threads and " +
            payload.discordCleanup.parentMessageDeleteCount +
            " channel posts. Local thread memory reset."
        );
        await loadEntries();
        await loadRuntimeStatus();
        await loadReviewArtifacts();
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        clearDiscordButtonEl.disabled = false;
      }
    }

    async function applyHistoricalProviderSelection() {
      const selectedProvider = historicalProviderSelectEl.value;
      if (!selectedProvider || selectedProvider === currentHistoricalProvider) {
        updateHistoricalProviderApplyState();
        return;
      }

      providerApplyInFlight = true;
      updateHistoricalProviderApplyState();
      setStatus("Switching historical candle provider to " + providerLabel(selectedProvider) + "...");
      try {
        const response = await fetch("/api/runtime/historical-provider", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ historicalProvider: selectedProvider }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setStatus(payload.error || "Provider switch failed", true);
          return;
        }

        providerSelectionDirty = false;
        currentHistoricalProvider = payload.historicalProvider || selectedProvider;
        setStatus(
          payload.changed
            ? "Historical candle provider switched to " + providerLabel(currentHistoricalProvider) + " and saved for restart."
            : "Historical candle provider already set to " + providerLabel(currentHistoricalProvider) + " and saved for restart.",
        );
        await loadRuntimeStatus();
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        providerApplyInFlight = false;
        updateHistoricalProviderApplyState();
      }
    }

    async function applyLiveProviderSelection() {
      const selectedProvider = liveProviderSelectEl.value;
      if (!selectedProvider || selectedProvider === currentLiveProvider) {
        updateLiveProviderApplyState();
        return;
      }

      liveProviderApplyInFlight = true;
      updateLiveProviderApplyState();
      setStatus("Switching live price provider to " + providerLabel(selectedProvider) + "...");
      try {
        const response = await fetch("/api/runtime/live-provider", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ liveProvider: selectedProvider }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setStatus(payload.error || "Live provider switch failed", true);
          return;
        }

        liveProviderSelectionDirty = false;
        currentLiveProvider = payload.liveProvider || selectedProvider;
        if (payload.persisted === false) {
          setStatus(
            "Live price provider switched to " + providerLabel(currentLiveProvider) + " and active tickers resubscribed, but the restart config was not saved: " + (payload.warning || "unknown save error"),
            true,
          );
        } else {
          setStatus(
            payload.changed
              ? "Live price provider switched to " + providerLabel(currentLiveProvider) + ", active tickers resubscribed, and saved for restart."
              : "Live price provider already set to " + providerLabel(currentLiveProvider) + " and saved for restart.",
          );
        }
        await loadRuntimeStatus();
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        liveProviderApplyInFlight = false;
        updateLiveProviderApplyState();
      }
    }

    async function applyLiveTraderReadVisibilitySelection() {
      const requestedVisible = liveTraderReadVisibleToggleEl.checked;
      if (requestedVisible === liveTraderReadVisible) {
        renderLiveTraderReadVisibilityControl({ runtimeHealth: { liveTraderReadCardVisible: liveTraderReadVisible } });
        return;
      }

      liveTraderReadVisibilityInFlight = true;
      renderLiveTraderReadVisibilityControl(
        { runtimeHealth: { liveTraderReadCardVisible: requestedVisible } },
        { keepPreviousState: true },
      );
      setStatus((requestedVisible ? "Showing" : "Hiding") + " the live website Trader Read card...");
      try {
        const response = await fetch("/api/runtime/live-trader-read-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visible: requestedVisible }),
        });
        const payload = await response.json();
        if (!response.ok) {
          liveTraderReadVisibleToggleEl.checked = liveTraderReadVisible;
          setStatus(payload.error || "Trader Read card visibility change failed", true);
          return;
        }

        liveTraderReadVisible = payload.visible !== false;
        setStatus(
          (liveTraderReadVisible ? "Trader Read card visible" : "Trader Read card hidden") +
            " on the live website. Refreshed " +
            String(payload.refreshedSymbolCount || 0) +
            " active ticker records.",
        );
        await loadRuntimeStatus();
      } catch (error) {
        liveTraderReadVisibleToggleEl.checked = liveTraderReadVisible;
        setStatus(String(error), true);
      } finally {
        liveTraderReadVisibilityInFlight = false;
        renderLiveTraderReadVisibilityControl({ runtimeHealth: { liveTraderReadCardVisible: liveTraderReadVisible } });
      }
    }

    formEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (shouldConfirmLargeLiquidTicker(symbolEl.value)) {
        const confirmed = window.confirm(
          "This looks like a large liquid ticker. This watchlist is intended for small, micro, and nano-cap momentum names. Continue only if this is a deliberate technical test."
        );
        if (!confirmed) {
          setStatus("Activation cancelled. Use a small, micro, or nano-cap ticker for the live watchlist.", true);
          return;
        }
      }
      const started = await activateEntry(symbolEl.value, noteEl.value, false);
      if (!started) {
        return;
      }
      symbolEl.value = "";
      noteEl.value = "";
      await loadEntries();
      await loadRuntimeStatus();
      await loadReviewArtifacts();
    });
    clearDiscordButtonEl.addEventListener("click", clearDiscordPosts);
    aiCleanReadButtonEl.addEventListener("click", () => {
      window.open("/ai-clean-read", "ai-clean-read");
    });
    tradePlanReviewButtonEl.addEventListener("click", () => {
      window.open("/trade-plan-review", "trade-plan-review");
    });
    historicalProviderSelectEl.addEventListener("change", () => {
      providerSelectionDirty = true;
      updateHistoricalProviderApplyState();
    });
    applyHistoricalProviderButtonEl.addEventListener("click", applyHistoricalProviderSelection);
    liveProviderSelectEl.addEventListener("change", () => {
      liveProviderSelectionDirty = true;
      updateLiveProviderApplyState();
    });
    applyLiveProviderButtonEl.addEventListener("click", applyLiveProviderSelection);
    liveTraderReadVisibleToggleEl.addEventListener("change", applyLiveTraderReadVisibilitySelection);

    Promise.all([loadEntries(), loadRuntimeStatus(), loadReviewArtifacts()]).catch((error) => {
      setStatus(String(error), true);
    });
    setInterval(() => {
      Promise.all([loadEntries(), loadRuntimeStatus(), loadReviewArtifacts()]).catch((error) => {
        setStatus(String(error), true);
      });
    }, 5000);
  </script>
</body>
</html>
`;
