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
    .badge-confidence-high { background: #dcfce7; color: #166534; }
    .badge-confidence-medium { background: #fef3c7; color: #92400e; }
    .badge-confidence-low { background: #fee2e2; color: #991b1b; }
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
    .selector-settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px 12px; margin-top: 14px; }
    .selector-settings-grid label { color: #475569; font-size: 12px; margin: 0; }
    .selector-settings-grid input { margin: 5px 0 0; }
    .selector-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .selector-decisions { margin-top: 10px; }
    .selector-decisions li { align-items: flex-start; display: block; font-size: 12px; padding: 8px 0; }
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
        <button class="danger" id="remove-all-tickers-button" type="button">Remove All Tickers</button>
        <button class="danger" id="remove-main-tickers-button" type="button">Remove Main Session</button>
        <button class="danger" id="remove-postmarket-tickers-button" type="button">Remove Post-Market</button>
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
      <div class="provider-control">
        <label for="potential-gain-visible-toggle">Potential Gain Card</label>
        <div class="inline-control toggle-control">
          <label class="toggle-switch">
            <input id="potential-gain-visible-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
            <span id="potential-gain-visible-label">Visible to users</span>
          </label>
        </div>
        <div class="inline-status" id="potential-gain-visible-status"></div>
      </div>
      <div class="provider-control">
        <label for="watchlist-lifecycle-labels-visible-toggle">Watchlist Lifecycle Labels</label>
        <div class="inline-control toggle-control">
          <label class="toggle-switch">
            <input id="watchlist-lifecycle-labels-visible-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
            <span id="watchlist-lifecycle-labels-visible-label">Hidden from users</span>
          </label>
        </div>
        <div class="inline-status" id="watchlist-lifecycle-labels-visible-status"></div>
      </div>
      <div class="provider-control">
        <label for="auto-selector-enabled-toggle">Automatic Low-Float Selection</label>
        <div class="inline-control toggle-control">
          <label class="toggle-switch">
            <input id="auto-selector-enabled-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
            <span id="auto-selector-enabled-label">Off</span>
          </label>
        </div>
        <div class="inline-status" id="auto-selector-status"></div>
        <div class="selector-settings-grid">
          <label>Maximum market cap ($M)<input id="auto-selector-max-market-cap" type="number" min="1" step="1" /></label>
          <label>Maximum float (M shares)<input id="auto-selector-max-float" type="number" min="0.1" step="0.1" /></label>
          <label>Maximum outstanding (M shares)<input id="auto-selector-max-outstanding" type="number" min="0.1" step="0.1" /></label>
          <label>Low-price float treatment at or below ($)<input id="auto-selector-low-price-float-max-price" type="number" min="0.01" step="0.01" /></label>
          <label>Maximum low-price dollar float ($M)<input id="auto-selector-low-price-float-max-dollar" type="number" min="0.1" step="0.1" /></label>
          <label>Minimum price ($)<input id="auto-selector-min-price" type="number" min="0.01" step="0.01" /></label>
          <label>Maximum price ($)<input id="auto-selector-max-price" type="number" min="0.02" step="0.01" /></label>
          <label>Minimum gain (%)<input id="auto-selector-min-gain" type="number" min="0" step="0.1" /></label>
          <label>Minimum volume (shares)<input id="auto-selector-min-volume" type="number" min="0" step="1000" /></label>
          <label>Minimum dollar volume ($)<input id="auto-selector-min-dollar-volume" type="number" min="0" step="10000" /></label>
          <label>Minimum score (0-100)<input id="auto-selector-min-score" type="number" min="0" max="100" step="1" /></label>
          <label>Consecutive passing scans<input id="auto-selector-passes" type="number" min="1" max="10" step="1" /></label>
          <label>Maximum active premarket/regular auto tickers (lowering keeps best current slot scores)<input id="auto-selector-max-active-main" type="number" min="1" max="20" step="1" /></label>
          <label>Maximum active post-market auto tickers<input id="auto-selector-max-active-postmarket" type="number" min="1" max="20" step="1" /></label>
          <label>Initial main-session new-ticker quota per day (does not trim active slots)<input id="auto-selector-max-adds" type="number" min="1" max="20" step="1" /></label>
          <label>Initial post-market automatic additions per day<input id="auto-selector-max-postmarket-adds" type="number" min="1" max="20" step="1" /></label>
          <label>Main-session automatic replacements per day<input id="auto-selector-max-main-replacements" type="number" min="0" max="50" step="1" /></label>
          <label>Post-market automatic replacements per day<input id="auto-selector-max-postmarket-replacements" type="number" min="0" max="50" step="1" /></label>
          <label>Late main-session admission reserve<input id="auto-selector-late-main-reserve" type="number" min="0" max="20" step="1" /></label>
          <label>Late reserve unlock hour ET<input id="auto-selector-late-main-unlock-hour" type="number" min="0" max="23" step="1" /></label>
          <label>Minimum hold after auto add (minutes)<input id="auto-selector-min-hold" type="number" min="0" max="240" step="1" /></label>
          <label>Failed scans before standby<input id="auto-selector-retention-failures" type="number" min="1" max="10" step="1" /></label>
          <label>Normal replacement rank advantage<input id="auto-selector-replacement-margin" type="number" min="0" max="100" step="1" /></label>
          <label>Obvious-runner recent-volume multiplier<input id="auto-selector-obvious-volume-multiplier" type="number" min="1" max="20" step="0.1" /></label>
          <label>Obvious-runner minimum acceleration<input id="auto-selector-obvious-acceleration" type="number" min="1" max="20" step="0.1" /></label>
          <label>Obvious-runner replacement advantage<input id="auto-selector-obvious-margin" type="number" min="0" max="100" step="1" /></label>
          <label>Premarket protection after open (minutes)<input id="auto-selector-open-protection" type="number" min="0" max="120" step="1" /></label>
          <label>Candidates enriched per scan<input id="auto-selector-enrichment-limit" type="number" min="1" max="50" step="1" /></label>
          <label>Scan interval (minutes)<input id="auto-selector-scan-interval" type="number" min="0.5" max="60" step="0.5" /></label>
          <label>Overall scan start hour ET (advanced)<input id="auto-selector-start-hour" type="number" min="0" max="23" step="1" /></label>
          <label>Overall scan end hour ET (advanced)<input id="auto-selector-end-hour" type="number" min="0" max="23" step="1" /></label>
          <label>Overall scan end minute ET (advanced)<input id="auto-selector-end-minute" type="number" min="0" max="59" step="1" /></label>
          <label>Premarket minimum last-15m dollar volume ($)<input id="auto-selector-premarket-recent-dollar-volume" type="number" min="0" step="5000" /></label>
          <label>Regular minimum last-15m dollar volume ($)<input id="auto-selector-regular-recent-dollar-volume" type="number" min="0" step="5000" /></label>
          <label>Post-market minimum last-15m dollar volume ($)<input id="auto-selector-postmarket-recent-dollar-volume" type="number" min="0" step="5000" /></label>
          <label>Post-market promotion minimum gain (%)<input id="auto-selector-postmarket-promotion-min-gain" type="number" min="0" max="100" step="0.1" /></label>
          <label>Post-market promotion minimum last-15m dollar volume ($)<input id="auto-selector-postmarket-promotion-recent-dollar-volume" type="number" min="0" step="5000" /></label>
          <label>Maximum latest-trade age (minutes)<input id="auto-selector-max-activity-age" type="number" min="1" max="60" step="1" /></label>
          <label>Extended-hours candidates checked<input id="auto-selector-extended-candidate-limit" type="number" min="1" max="200" step="1" /></label>
          <label>Catalyst lookback (days)<input id="auto-selector-catalyst-lookback" type="number" min="0" max="30" step="1" /></label>
          <label>Same-day catalyst rank boost<input id="auto-selector-catalyst-boost" type="number" min="0" max="100" step="1" /></label>
          <label>Catalyst decay per day<input id="auto-selector-catalyst-decay" type="number" min="0" max="100" step="1" /></label>
          <label>Recent 15m activity maximum rank boost<input id="auto-selector-recent-volume-rank-boost" type="number" min="0" max="100" step="1" /></label>
          <label>Recent 15m dollar volume for full boost ($)<input id="auto-selector-recent-volume-full-score" type="number" min="1" step="25000" /></label>
          <label>Volume acceleration maximum rank boost<input id="auto-selector-acceleration-rank-boost" type="number" min="0" max="100" step="1" /></label>
          <label>Acceleration ratio for full boost<input id="auto-selector-acceleration-full-score" type="number" min="1.1" step="0.1" /></label>
          <label>Share turnover maximum rank boost<input id="auto-selector-turnover-rank-boost" type="number" min="0" max="100" step="1" /></label>
          <label>Share turnover for full boost (%)<input id="auto-selector-turnover-full-score" type="number" min="1" step="5" /></label>
        </div>
        <div class="inline-status">The overall start/end fields are only an outer safety window. Session switches below decide whether premarket (4:00-9:30), regular hours (9:30-16:00), or post-market (16:00-20:00 ET) can add tickers.</div>
        <div class="inline-control toggle-control">
          <label class="toggle-switch"><input id="auto-selector-dynamic-replacement" type="checkbox" /><span class="toggle-slider"></span><span>Continuously replace faded auto tickers</span></label>
        </div>
        <div class="inline-control toggle-control">
          <label class="toggle-switch"><input id="auto-selector-obvious-runner" type="checkbox" /><span class="toggle-slider"></span><span>Allow obvious-runner fast replacement</span></label>
        </div>
        <div class="inline-control toggle-control">
          <label class="toggle-switch"><input id="auto-selector-premarket-enabled" type="checkbox" /><span class="toggle-slider"></span><span>Allow premarket automatic additions</span></label>
        </div>
        <div class="inline-control toggle-control">
          <label class="toggle-switch"><input id="auto-selector-regular-enabled" type="checkbox" /><span class="toggle-slider"></span><span>Allow regular-hours automatic additions</span></label>
        </div>
        <div class="inline-control toggle-control">
          <label class="toggle-switch"><input id="auto-selector-postmarket-enabled" type="checkbox" /><span class="toggle-slider"></span><span>Allow post-market automatic additions</span></label>
        </div>
        <div class="inline-control toggle-control">
          <label class="toggle-switch"><input id="auto-selector-require-recent-activity" type="checkbox" /><span class="toggle-slider"></span><span>Require reliable recent 15-minute activity data</span></label>
        </div>
        <div class="inline-control toggle-control">
          <label class="toggle-switch">
            <input id="auto-selector-require-share-data" type="checkbox" />
            <span class="toggle-slider"></span>
            <span>Require float or outstanding-share data</span>
          </label>
        </div>
        <div class="inline-control toggle-control">
          <label class="toggle-switch">
            <input id="auto-selector-low-price-float-normalization" type="checkbox" />
            <span class="toggle-slider"></span>
            <span>Allow low-price shares to qualify on verified dollar float</span>
          </label>
        </div>
        <div class="inline-status">This only applies to a known float above the share cap when its dollar float is below the setting. It keeps a true low-float ticker ranked higher and never relaxes the fallback outstanding-share cap.</div>
        <div class="inline-control toggle-control">
          <label class="toggle-switch">
            <input id="auto-selector-catalyst-ranking" type="checkbox" />
            <span class="toggle-slider"></span>
            <span>Use recent press-release catalysts as a secondary ranking preference</span>
          </label>
        </div>
        <div class="inline-status">Catalysts never bypass the price, gain, volume, market-cap, share-count, recent-activity, or base-score qualification rules. Activity and turnover bonuses affect admission rank; sustained gains above 20% add current slot-survival credit only. Set any maximum rank boost to 0 for no ranking effect.</div>
        <div class="selector-actions">
          <button id="auto-selector-apply-button" type="button">Apply Selection Settings</button>
          <button class="secondary" id="auto-selector-preview-button" type="button">Run Preview Only</button>
        </div>
        <ul class="selector-decisions" id="auto-selector-decisions"></ul>
      </div>
    </section>

    <section>
      <h2>TradersLink AI Read</h2>
      <div class="provider-control">
        <label for="ai-read-external-research-toggle">External Catalyst, SEC, and Web Research</label>
        <div class="inline-control toggle-control">
          <label class="toggle-switch">
            <input id="ai-read-external-research-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
            <span id="ai-read-external-research-label">Off</span>
          </label>
        </div>
        <div class="inline-status" id="ai-read-external-research-status"></div>
      </div>
      <div class="provider-control">
        <label for="ai-read-cost-budget-toggle">Optional Daily AI Spend Guard</label>
        <div class="inline-control">
          <label class="toggle-switch">
            <input id="ai-read-cost-budget-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
            <span id="ai-read-cost-budget-label">Off</span>
          </label>
          <input id="ai-read-cost-budget-usd" type="number" min="0.01" max="10000" step="0.01" value="1.00" aria-label="Daily AI spend budget in US dollars" />
          <button id="ai-read-cost-budget-apply" type="button">Apply Budget</button>
        </div>
        <div class="inline-status" id="ai-read-cost-budget-status"></div>
      </div>
      <div class="health-grid" id="ai-read-cost-grid"></div>
      <ul class="activity-list" id="ai-read-cost-list"></ul>
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
    const removeAllTickersButtonEl = document.getElementById("remove-all-tickers-button");
    const removeMainTickersButtonEl = document.getElementById("remove-main-tickers-button");
    const removePostmarketTickersButtonEl = document.getElementById("remove-postmarket-tickers-button");
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
    const potentialGainVisibleToggleEl = document.getElementById("potential-gain-visible-toggle");
    const potentialGainVisibleLabelEl = document.getElementById("potential-gain-visible-label");
    const potentialGainVisibleStatusEl = document.getElementById("potential-gain-visible-status");
    const watchlistLifecycleLabelsVisibleToggleEl = document.getElementById("watchlist-lifecycle-labels-visible-toggle");
    const watchlistLifecycleLabelsVisibleLabelEl = document.getElementById("watchlist-lifecycle-labels-visible-label");
    const watchlistLifecycleLabelsVisibleStatusEl = document.getElementById("watchlist-lifecycle-labels-visible-status");
    const aiReadExternalResearchToggleEl = document.getElementById("ai-read-external-research-toggle");
    const aiReadExternalResearchLabelEl = document.getElementById("ai-read-external-research-label");
    const aiReadExternalResearchStatusEl = document.getElementById("ai-read-external-research-status");
    const aiReadCostBudgetToggleEl = document.getElementById("ai-read-cost-budget-toggle");
    const aiReadCostBudgetLabelEl = document.getElementById("ai-read-cost-budget-label");
    const aiReadCostBudgetUsdEl = document.getElementById("ai-read-cost-budget-usd");
    const aiReadCostBudgetApplyEl = document.getElementById("ai-read-cost-budget-apply");
    const aiReadCostBudgetStatusEl = document.getElementById("ai-read-cost-budget-status");
    const aiReadCostGridEl = document.getElementById("ai-read-cost-grid");
    const aiReadCostListEl = document.getElementById("ai-read-cost-list");
    const autoSelectorEnabledToggleEl = document.getElementById("auto-selector-enabled-toggle");
    const autoSelectorEnabledLabelEl = document.getElementById("auto-selector-enabled-label");
    const autoSelectorStatusEl = document.getElementById("auto-selector-status");
    const autoSelectorDecisionsEl = document.getElementById("auto-selector-decisions");
    const autoSelectorApplyButtonEl = document.getElementById("auto-selector-apply-button");
    const autoSelectorPreviewButtonEl = document.getElementById("auto-selector-preview-button");
    const autoSelectorInputEls = {
      maxMarketCap: document.getElementById("auto-selector-max-market-cap"),
      maxFloatShares: document.getElementById("auto-selector-max-float"),
      maxSharesOutstanding: document.getElementById("auto-selector-max-outstanding"),
      lowPriceFloatNormalizationEnabled: document.getElementById("auto-selector-low-price-float-normalization"),
      lowPriceFloatNormalizationMaxPrice: document.getElementById("auto-selector-low-price-float-max-price"),
      lowPriceFloatNormalizationMaxDollarValue: document.getElementById("auto-selector-low-price-float-max-dollar"),
      requireShareData: document.getElementById("auto-selector-require-share-data"),
      minPrice: document.getElementById("auto-selector-min-price"),
      maxPrice: document.getElementById("auto-selector-max-price"),
      minGainPct: document.getElementById("auto-selector-min-gain"),
      minVolume: document.getElementById("auto-selector-min-volume"),
      minDollarVolume: document.getElementById("auto-selector-min-dollar-volume"),
      minimumScore: document.getElementById("auto-selector-min-score"),
      consecutivePassesRequired: document.getElementById("auto-selector-passes"),
      maxActiveMainSessionTickers: document.getElementById("auto-selector-max-active-main"),
      maxActivePostmarketTickers: document.getElementById("auto-selector-max-active-postmarket"),
      maxAddsPerTradingDay: document.getElementById("auto-selector-max-adds"),
      maxPostmarketAddsPerTradingDay: document.getElementById("auto-selector-max-postmarket-adds"),
      maxMainSessionReplacementsPerTradingDay: document.getElementById("auto-selector-max-main-replacements"),
      maxPostmarketReplacementsPerTradingDay: document.getElementById("auto-selector-max-postmarket-replacements"),
      lateMainSessionAdmissionReserve: document.getElementById("auto-selector-late-main-reserve"),
      lateMainSessionAdmissionUnlockHourEastern: document.getElementById("auto-selector-late-main-unlock-hour"),
      dynamicReplacementEnabled: document.getElementById("auto-selector-dynamic-replacement"),
      minimumAutoHoldMinutes: document.getElementById("auto-selector-min-hold"),
      retentionFailureScansRequired: document.getElementById("auto-selector-retention-failures"),
      replacementRankingMargin: document.getElementById("auto-selector-replacement-margin"),
      obviousRunnerOverrideEnabled: document.getElementById("auto-selector-obvious-runner"),
      obviousRunnerRecentDollarVolumeMultiplier: document.getElementById("auto-selector-obvious-volume-multiplier"),
      obviousRunnerMinVolumeAcceleration: document.getElementById("auto-selector-obvious-acceleration"),
      obviousRunnerReplacementMargin: document.getElementById("auto-selector-obvious-margin"),
      regularOpenProtectionMinutes: document.getElementById("auto-selector-open-protection"),
      enrichmentLimit: document.getElementById("auto-selector-enrichment-limit"),
      scanIntervalMs: document.getElementById("auto-selector-scan-interval"),
      scanStartHourEastern: document.getElementById("auto-selector-start-hour"),
      scanEndHourEastern: document.getElementById("auto-selector-end-hour"),
      scanEndMinuteEastern: document.getElementById("auto-selector-end-minute"),
      premarketEnabled: document.getElementById("auto-selector-premarket-enabled"),
      regularHoursEnabled: document.getElementById("auto-selector-regular-enabled"),
      postmarketEnabled: document.getElementById("auto-selector-postmarket-enabled"),
      requireRecentActivityData: document.getElementById("auto-selector-require-recent-activity"),
      minRecentDollarVolume15mPremarket: document.getElementById("auto-selector-premarket-recent-dollar-volume"),
      minRecentDollarVolume15mRegular: document.getElementById("auto-selector-regular-recent-dollar-volume"),
      minRecentDollarVolume15mPostmarket: document.getElementById("auto-selector-postmarket-recent-dollar-volume"),
      postmarketPromotionMinGainPct: document.getElementById("auto-selector-postmarket-promotion-min-gain"),
      postmarketPromotionMinRecentDollarVolume: document.getElementById("auto-selector-postmarket-promotion-recent-dollar-volume"),
      maxActivityQuoteAgeMinutes: document.getElementById("auto-selector-max-activity-age"),
      extendedSessionCandidateLimit: document.getElementById("auto-selector-extended-candidate-limit"),
      catalystRankingEnabled: document.getElementById("auto-selector-catalyst-ranking"),
      catalystLookbackDays: document.getElementById("auto-selector-catalyst-lookback"),
      catalystSameDayRankBoost: document.getElementById("auto-selector-catalyst-boost"),
      catalystDailyRankDecay: document.getElementById("auto-selector-catalyst-decay"),
      recentDollarVolumeRankMaxBoost: document.getElementById("auto-selector-recent-volume-rank-boost"),
      recentDollarVolumeRankFullScore: document.getElementById("auto-selector-recent-volume-full-score"),
      volumeAccelerationRankMaxBoost: document.getElementById("auto-selector-acceleration-rank-boost"),
      volumeAccelerationRankFullScoreRatio: document.getElementById("auto-selector-acceleration-full-score"),
      shareTurnoverRankMaxBoost: document.getElementById("auto-selector-turnover-rank-boost"),
      shareTurnoverRankFullScorePct: document.getElementById("auto-selector-turnover-full-score"),
    };
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
    let potentialGainVisible = true;
    let potentialGainVisibilityInFlight = false;
    let watchlistLifecycleLabelsVisible = false;
    let watchlistLifecycleLabelsVisibilityInFlight = false;
    let aiReadConfigured = null;
    let aiReadExternalResearchEnabled = false;
    let aiReadExternalResearchInFlight = false;
    let aiReadCostBudgetEnabled = false;
    let aiReadCostBudgetInFlight = false;
    let autoSelectorEnabled = false;
    let autoSelectorSettingsDirty = false;
    let autoSelectorRequestInFlight = false;
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

    function formatShareVolume(value) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return "unavailable";
      }
      return Math.round(value).toLocaleString() + " shares";
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
      const aiConfidence = entry.tradersLinkAiReadConfidence;
      header.appendChild(createBadge(
        "AI confidence: " + (aiConfidence ? lifecycleLabel(aiConfidence) : "Pending"),
        aiConfidence ? "badge badge-confidence-" + aiConfidence : "badge",
      ));

      details.className = "meta";
      details.appendChild(
        document.createTextNode("Discord thread ID: " + (entry.discordThreadId || "pending")),
      );
      appendMetaValue(details, "last snapshot", lastPostText);
      appendMetaValue(details, "last price", lastLiveText);
      appendMetaValue(details, "price", formatNumber(entry.lastPrice));
      const selectorActivity = entry.selectorSessionActivity;
      const sessionVolumeLabel = selectorActivity?.session
        ? lifecycleLabel(selectorActivity.session) + " volume"
        : "session volume";
      appendMetaValue(
        details,
        sessionVolumeLabel,
        selectorActivity?.dataAvailable === true
          ? formatShareVolume(selectorActivity.volume)
          : "unavailable",
      );
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

    function renderPotentialGainVisibilityControl(status, options) {
      const visible = status.runtimeHealth?.potentialGainCardVisible !== false;
      if (!options?.keepPreviousState) {
        potentialGainVisible = visible;
      }
      potentialGainVisibleToggleEl.checked = visible;
      potentialGainVisibleToggleEl.disabled = potentialGainVisibilityInFlight;
      potentialGainVisibleLabelEl.textContent = visible ? "Visible to users" : "Hidden from users";
      potentialGainVisibleStatusEl.textContent = visible
        ? "Active ticker pages can show the Potential Gain card."
        : "Active ticker pages will hide the Potential Gain card.";
    }

    function renderWatchlistLifecycleLabelsVisibilityControl(status, options) {
      const visible = status.runtimeHealth?.watchlistLifecycleLabelsVisible === true;
      if (!options?.keepPreviousState) {
        watchlistLifecycleLabelsVisible = visible;
      }
      watchlistLifecycleLabelsVisibleToggleEl.checked = visible;
      watchlistLifecycleLabelsVisibleToggleEl.disabled = watchlistLifecycleLabelsVisibilityInFlight;
      watchlistLifecycleLabelsVisibleLabelEl.textContent = visible ? "Visible to users" : "Hidden from users";
      watchlistLifecycleLabelsVisibleStatusEl.textContent = visible
        ? "Main watchlist rows and ticker detail pages can show deterministic lifecycle labels."
        : "Lifecycle labels are hidden; watchlist selection and replacement behavior is unchanged.";
    }

    function formatAiReadCost(value) {
      const amount = Number(value || 0);
      return "$" + amount.toFixed(amount >= 1 ? 2 : 4);
    }

    function renderAiReadControls(status) {
      aiReadConfigured = status.aiReadConfigured === true;
      if (!aiReadExternalResearchInFlight) {
        aiReadExternalResearchEnabled = status.aiReadExternalResearchEnabled === true;
      }
      aiReadExternalResearchToggleEl.checked = aiReadExternalResearchEnabled;
      aiReadExternalResearchToggleEl.disabled = !aiReadConfigured || aiReadExternalResearchInFlight;
      aiReadExternalResearchLabelEl.textContent = aiReadExternalResearchEnabled ? "On" : "Off";
      aiReadExternalResearchStatusEl.textContent = aiReadConfigured
        ? aiReadExternalResearchEnabled
          ? "External web research is enabled and can add cost. The local press-release/SEC database remains the first source."
          : "External web research is off. AI reads still use the local press-release/SEC database as their first research source."
        : "TradersLink AI Read is unavailable because its OpenAI service or live website publisher is not configured.";

      const budget = status.aiReadDailyCostBudget || {};
      const budgetStatus = status.aiReadDailyCostBudgetStatus || {};
      if (!aiReadCostBudgetInFlight) {
        aiReadCostBudgetEnabled = budget.enabled === true;
        const dailyLimitUsd = Number(budget.dailyLimitUsd);
        if (Number.isFinite(dailyLimitUsd) && dailyLimitUsd > 0) {
          aiReadCostBudgetUsdEl.value = dailyLimitUsd.toFixed(2);
        }
      }
      aiReadCostBudgetToggleEl.checked = aiReadCostBudgetEnabled;
      aiReadCostBudgetToggleEl.disabled = !aiReadConfigured || aiReadCostBudgetInFlight;
      aiReadCostBudgetUsdEl.disabled = !aiReadConfigured || aiReadCostBudgetInFlight;
      aiReadCostBudgetApplyEl.disabled = !aiReadConfigured || aiReadCostBudgetInFlight;
      aiReadCostBudgetLabelEl.textContent = aiReadCostBudgetEnabled ? "On" : "Off";
      if (!aiReadConfigured) {
        aiReadCostBudgetStatusEl.textContent = "Configure the TradersLink AI Read service before using the budget guard.";
      } else if (!aiReadCostBudgetEnabled) {
        aiReadCostBudgetStatusEl.textContent =
          "Off. This does not limit AI Reads. Set a dollar amount and turn it on whenever you want a daily preflight guard.";
      } else {
        const spent = formatAiReadCost(budgetStatus.spentUsd);
        const remaining = formatAiReadCost(budgetStatus.remainingUsd);
        const reserve = formatAiReadCost(budgetStatus.projectedNextRequestUsd);
        aiReadCostBudgetStatusEl.textContent = budgetStatus.canStartRequest === false
          ? "Guard is holding new reads: " + String(budgetStatus.blockReason || "daily budget reached.")
          : "On. Today: " + spent + " spent, " + remaining + " remaining; " + reserve + " is reserved before a new read starts.";
      }

      const summary = status.aiReadCostSummary || {};
      const windows = summary.windows || {};
      const today = windows.today || {};
      const last7Days = windows.last7Days || {};
      const last30Days = windows.last30Days || {};
      const allTime = windows.allTime || {};
      const accountingHealth = summary.accountingHealth || {};
      aiReadCostGridEl.innerHTML = "";
      const cards = [
        ["Today", formatAiReadCost(today.estimatedTotalCostUsd)],
        ["Today Requests", String(today.requestCount || 0)],
        ["AI Model", String(status.aiReadModel || "not configured")],
        ["Reasoning", String(status.aiReadReasoningEffort || "not configured")],
        ["Daily Guard", aiReadCostBudgetEnabled ? formatAiReadCost(budget.dailyLimitUsd) : "Off"],
        ["Last 7 Days", formatAiReadCost(last7Days.estimatedTotalCostUsd)],
        ["Last 30 Days", formatAiReadCost(last30Days.estimatedTotalCostUsd)],
        ["All Time", formatAiReadCost(allTime.estimatedTotalCostUsd)],
        ["Web Searches", String(allTime.webSearchCallCount || 0)],
        ["Accounting", accountingHealth.healthy === false ? "CHECK LEDGER" : "Healthy"],
      ];
      for (const [label, value] of cards) {
        aiReadCostGridEl.appendChild(createRuntimeCard(label, value));
      }

      aiReadCostListEl.innerHTML = "";
      if (accountingHealth.healthy === false) {
        const warning = document.createElement("li");
        warning.className = "warning-text";
        warning.textContent =
          "Expense totals may be incomplete: " +
          String(accountingHealth.lastLoadError || "the usage ledger could not be read completely.");
        aiReadCostListEl.appendChild(warning);
      }
      const perTicker = Array.isArray(summary.perTicker) ? summary.perTicker : [];
      if (perTicker.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No recorded TradersLink AI Read expense yet.";
        aiReadCostListEl.appendChild(empty);
        return;
      }
      for (const ticker of perTicker.slice(0, 20)) {
        const item = document.createElement("li");
        const body = document.createElement("div");
        const detail = document.createElement("div");
        body.className = "activity-message";
        body.textContent = ticker.symbol + " — " + formatAiReadCost(ticker.estimatedTotalCostUsd);
        detail.className = "activity-detail";
        detail.textContent =
          String(ticker.requestCount || 0) + " request(s) | average " +
          formatAiReadCost(ticker.averageCostPerRequestUsd) + " | web searches " +
          String(ticker.webSearchCallCount || 0) + " | last trigger " +
          String(ticker.lastTrigger || "unknown");
        body.appendChild(detail);
        item.appendChild(body);
        aiReadCostListEl.appendChild(item);
      }

      const byModel = Array.isArray(summary.byModel) ? summary.byModel : [];
      for (const model of byModel) {
        const item = document.createElement("li");
        item.className = "activity-detail";
        item.textContent =
          "Model " + String(model.model || "unknown") + ": " +
          formatAiReadCost(model.totals?.estimatedTotalCostUsd) + " across " +
          String(model.totals?.requestCount || 0) + " recorded request(s).";
        aiReadCostListEl.appendChild(item);
      }
    }

    function setAutoSelectorInputValue(key, value, divisor) {
      const input = autoSelectorInputEls[key];
      if (!input || value === undefined || value === null) {
        return;
      }
      if (input.type === "checkbox") {
        input.checked = value === true;
        return;
      }
      input.value = String(divisor ? value / divisor : value);
    }

    function renderAutoSelectorControl(status) {
      const selector = status.autoWatchlistSelector || {};
      const thresholds = selector.thresholds || {};
      autoSelectorEnabled = selector.enabled === true;
      autoSelectorEnabledToggleEl.checked = autoSelectorEnabled;
      autoSelectorEnabledToggleEl.disabled = autoSelectorRequestInFlight;
      autoSelectorEnabledLabelEl.textContent = autoSelectorEnabled ? "On" : "Off";
      autoSelectorApplyButtonEl.disabled = autoSelectorRequestInFlight || !autoSelectorSettingsDirty;
      autoSelectorPreviewButtonEl.disabled = autoSelectorRequestInFlight || selector.running === true;

      if (!autoSelectorSettingsDirty) {
        setAutoSelectorInputValue("maxMarketCap", thresholds.maxMarketCap, 1000000);
        setAutoSelectorInputValue("maxFloatShares", thresholds.maxFloatShares, 1000000);
        setAutoSelectorInputValue("maxSharesOutstanding", thresholds.maxSharesOutstanding, 1000000);
        setAutoSelectorInputValue("lowPriceFloatNormalizationEnabled", thresholds.lowPriceFloatNormalizationEnabled);
        setAutoSelectorInputValue("lowPriceFloatNormalizationMaxPrice", thresholds.lowPriceFloatNormalizationMaxPrice);
        setAutoSelectorInputValue("lowPriceFloatNormalizationMaxDollarValue", thresholds.lowPriceFloatNormalizationMaxDollarValue, 1000000);
        setAutoSelectorInputValue("requireShareData", thresholds.requireShareData);
        setAutoSelectorInputValue("minPrice", thresholds.minPrice);
        setAutoSelectorInputValue("maxPrice", thresholds.maxPrice);
        setAutoSelectorInputValue("minGainPct", thresholds.minGainPct);
        setAutoSelectorInputValue("minVolume", thresholds.minVolume);
        setAutoSelectorInputValue("minDollarVolume", thresholds.minDollarVolume);
        setAutoSelectorInputValue("minimumScore", thresholds.minimumScore);
        setAutoSelectorInputValue("consecutivePassesRequired", thresholds.consecutivePassesRequired);
        setAutoSelectorInputValue("maxActiveMainSessionTickers", thresholds.maxActiveMainSessionTickers);
        setAutoSelectorInputValue("maxActivePostmarketTickers", thresholds.maxActivePostmarketTickers);
        setAutoSelectorInputValue("maxAddsPerTradingDay", thresholds.maxAddsPerTradingDay);
        setAutoSelectorInputValue("maxPostmarketAddsPerTradingDay", thresholds.maxPostmarketAddsPerTradingDay);
        setAutoSelectorInputValue("maxMainSessionReplacementsPerTradingDay", thresholds.maxMainSessionReplacementsPerTradingDay);
        setAutoSelectorInputValue("maxPostmarketReplacementsPerTradingDay", thresholds.maxPostmarketReplacementsPerTradingDay);
        setAutoSelectorInputValue("lateMainSessionAdmissionReserve", thresholds.lateMainSessionAdmissionReserve);
        setAutoSelectorInputValue("lateMainSessionAdmissionUnlockHourEastern", thresholds.lateMainSessionAdmissionUnlockHourEastern);
        setAutoSelectorInputValue("dynamicReplacementEnabled", thresholds.dynamicReplacementEnabled);
        setAutoSelectorInputValue("minimumAutoHoldMinutes", thresholds.minimumAutoHoldMinutes);
        setAutoSelectorInputValue("retentionFailureScansRequired", thresholds.retentionFailureScansRequired);
        setAutoSelectorInputValue("replacementRankingMargin", thresholds.replacementRankingMargin);
        setAutoSelectorInputValue("obviousRunnerOverrideEnabled", thresholds.obviousRunnerOverrideEnabled);
        setAutoSelectorInputValue("obviousRunnerRecentDollarVolumeMultiplier", thresholds.obviousRunnerRecentDollarVolumeMultiplier);
        setAutoSelectorInputValue("obviousRunnerMinVolumeAcceleration", thresholds.obviousRunnerMinVolumeAcceleration);
        setAutoSelectorInputValue("obviousRunnerReplacementMargin", thresholds.obviousRunnerReplacementMargin);
        setAutoSelectorInputValue("regularOpenProtectionMinutes", thresholds.regularOpenProtectionMinutes);
        setAutoSelectorInputValue("enrichmentLimit", thresholds.enrichmentLimit);
        setAutoSelectorInputValue("scanIntervalMs", thresholds.scanIntervalMs, 60000);
        setAutoSelectorInputValue("scanStartHourEastern", thresholds.scanStartHourEastern);
        setAutoSelectorInputValue("scanEndHourEastern", thresholds.scanEndHourEastern);
        setAutoSelectorInputValue("scanEndMinuteEastern", thresholds.scanEndMinuteEastern);
        setAutoSelectorInputValue("premarketEnabled", thresholds.premarketEnabled);
        setAutoSelectorInputValue("regularHoursEnabled", thresholds.regularHoursEnabled);
        setAutoSelectorInputValue("postmarketEnabled", thresholds.postmarketEnabled);
        setAutoSelectorInputValue("requireRecentActivityData", thresholds.requireRecentActivityData);
        setAutoSelectorInputValue("minRecentDollarVolume15mPremarket", thresholds.minRecentDollarVolume15mPremarket);
        setAutoSelectorInputValue("minRecentDollarVolume15mRegular", thresholds.minRecentDollarVolume15mRegular);
        setAutoSelectorInputValue("minRecentDollarVolume15mPostmarket", thresholds.minRecentDollarVolume15mPostmarket);
        setAutoSelectorInputValue("postmarketPromotionMinGainPct", thresholds.postmarketPromotionMinGainPct);
        setAutoSelectorInputValue("postmarketPromotionMinRecentDollarVolume", thresholds.postmarketPromotionMinRecentDollarVolume);
        setAutoSelectorInputValue("maxActivityQuoteAgeMinutes", thresholds.maxActivityQuoteAgeMinutes);
        setAutoSelectorInputValue("extendedSessionCandidateLimit", thresholds.extendedSessionCandidateLimit);
        setAutoSelectorInputValue("catalystRankingEnabled", thresholds.catalystRankingEnabled);
        setAutoSelectorInputValue("catalystLookbackDays", thresholds.catalystLookbackDays);
        setAutoSelectorInputValue("catalystSameDayRankBoost", thresholds.catalystSameDayRankBoost);
        setAutoSelectorInputValue("catalystDailyRankDecay", thresholds.catalystDailyRankDecay);
        setAutoSelectorInputValue("recentDollarVolumeRankMaxBoost", thresholds.recentDollarVolumeRankMaxBoost);
        setAutoSelectorInputValue("recentDollarVolumeRankFullScore", thresholds.recentDollarVolumeRankFullScore);
        setAutoSelectorInputValue("volumeAccelerationRankMaxBoost", thresholds.volumeAccelerationRankMaxBoost);
        setAutoSelectorInputValue("volumeAccelerationRankFullScoreRatio", thresholds.volumeAccelerationRankFullScoreRatio);
        setAutoSelectorInputValue("shareTurnoverRankMaxBoost", thresholds.shareTurnoverRankMaxBoost);
        setAutoSelectorInputValue("shareTurnoverRankFullScorePct", thresholds.shareTurnoverRankFullScorePct);
      }

      const pieces = [autoSelectorEnabled ? "Automatic additions enabled." : "Automatic additions disabled."];
      if (selector.running) {
        pieces.push("Scan in progress.");
      } else if (selector.lastScanCompletedAt) {
        pieces.push(
          "Last scan " + formatTime(selector.lastScanCompletedAt) +
          ": " + String(selector.lastScanCandidateCount || 0) + " discovered, " +
          String(selector.lastEvaluatedCount || 0) + " evaluated, " +
          String(selector.lastQualifiedCount || 0) + " qualified.",
        );
      }
      if (Array.isArray(selector.lastDiscoverySources) && selector.lastDiscoverySources.length > 0) {
        pieces.push("Discovery: " + selector.lastDiscoverySources.join(", ") + ".");
      }
      if (Array.isArray(selector.mainSessionAddedToday) && selector.mainSessionAddedToday.length > 0) {
        pieces.push("Main session added today: " + selector.mainSessionAddedToday.join(", ") + ".");
      }
      if (Array.isArray(selector.postmarketAddedToday) && selector.postmarketAddedToday.length > 0) {
        pieces.push("Post-market added today: " + selector.postmarketAddedToday.join(", ") + ".");
      }
      if (Number.isFinite(selector.lateMainSessionAdmissionReserveAvailable)) {
        pieces.push(
          "Late main-session reserve: " +
          String(selector.lateMainSessionAdmissionReserveAvailable) + " available, " +
          String(selector.lateMainSessionAdmissionReserveUsed || 0) + " used; " +
          (selector.lateMainSessionAdmissionReserveUnlocked ? "unlocked" : "locked") + ".",
        );
      }
      if (Array.isArray(selector.activeMainSessionSymbols)) {
        const activeScores = new Map((selector.managedEntries || []).map((entry) => [entry.symbol, entry.lastSlotSurvivalScore]));
        pieces.push("Active main auto slots: " + (selector.activeMainSessionSymbols
          .map((symbol) => symbol + (Number.isFinite(activeScores.get(symbol)) ? " (slot " + activeScores.get(symbol) + ")" : ""))
          .join(", ") || "none") + ".");
      }
      if (Array.isArray(selector.activePostmarketSymbols)) {
        pieces.push("Active post-market auto slots: " + (selector.activePostmarketSymbols.join(", ") || "none") + ".");
      }
      if (Array.isArray(selector.standbyToday) && selector.standbyToday.length > 0) {
        pieces.push(
          "Standby today: " + selector.standbyToday
            .map((entry) => entry.symbol + " (" + entry.statusReason + ")")
            .join(", ") + ".",
        );
      }
      if (Array.isArray(selector.recentReplacements) && selector.recentReplacements.length > 0) {
        const replacement = selector.recentReplacements[0];
        pieces.push("Latest automatic lifecycle change: " + replacement.reason);
      }
      if (selector.lastError) {
        pieces.push("Last error: " + selector.lastError);
      }
      if (selector.lastDiscoveryError) {
        pieces.push("Live exchange discovery fallback: " + selector.lastDiscoveryError + ".");
      }
      if (selector.lastCatalystLookupError) {
        pieces.push("Catalyst lookup: " + selector.lastCatalystLookupError + ".");
      }
      if (selector.lastActivityLookupError) {
        pieces.push("Recent activity lookup: " + selector.lastActivityLookupError + ".");
      }
      if (Array.isArray(selector.lastActivationErrors) && selector.lastActivationErrors.length > 0) {
        pieces.push(
          "Activation errors: " + selector.lastActivationErrors
            .map((entry) => entry.symbol + " (" + entry.error + ")")
            .join(", ") + ".",
        );
      }
      autoSelectorStatusEl.textContent = pieces.join(" ");

      autoSelectorDecisionsEl.innerHTML = "";
      for (const decision of (selector.recentDecisions || [])) {
        const item = document.createElement("li");
        const title = document.createElement("strong");
        title.textContent = decision.symbol + " — qualification " + decision.score + " — admission rank " + decision.rankingScore + " — current slot " + decision.slotSurvivalScore + (
          decision.qualified
            ? decision.promotionReady === false
              ? " — qualifies, promotion held"
              : " — qualifies, promotion-ready"
            : " — rejected"
        );
        const detail = document.createElement("div");
        detail.className = "activity-detail";
        const facts = [
          decision.gainPct !== null ? Number(decision.gainPct).toFixed(1) + "% gain" : "gain unavailable",
          decision.marketCap ? "$" + Math.round(decision.marketCap / 1000000) + "M cap" : "cap unavailable",
          decision.effectiveShares ? (decision.effectiveShares / 1000000).toFixed(1) + "M shares" : "share count unavailable",
          "pass " + String(decision.consecutivePasses || 0),
          String(decision.session || "unknown") + " session",
          decision.recent15mDollarVolume !== null
            ? "$" + Math.round(decision.recent15mDollarVolume / 1000) + "K last 15m"
            : "last-15m activity unavailable",
          decision.volumeAcceleration !== null
            ? Number(decision.volumeAcceleration).toFixed(1) + "x volume acceleration"
            : "acceleration baseline unavailable",
          decision.shareTurnoverPct !== null
            ? Number(decision.shareTurnoverPct).toFixed(1) + "% share turnover"
            : "share turnover unavailable",
          ...(decision.slotSurvivalReasons || []),
        ];
        if (decision.catalystPublishedAt) {
          facts.push(
            (decision.catalystAgeDays === 0 ? "same-day catalyst" : String(decision.catalystAgeDays) + "-day-old catalyst")
              + (decision.catalystRankBoost ? " +" + String(decision.catalystRankBoost) + " rank" : " no rank effect"),
          );
        } else {
          facts.push("no recent catalyst");
        }
        const explanation = decision.qualified
          ? [...(decision.reasons || []), ...(decision.promotionRejectionReasons || [])]
          : decision.rejectionReasons;
        const rankingExplanation = decision.rankingReasons || [];
        detail.textContent = facts.join(" | ")
          + (explanation?.length ? " | " + explanation.join("; ") : "")
          + (rankingExplanation.length ? " | " + rankingExplanation.join("; ") : "");
        item.appendChild(title);
        item.appendChild(detail);
        autoSelectorDecisionsEl.appendChild(item);
      }
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
      renderPotentialGainVisibilityControl(status);
      renderWatchlistLifecycleLabelsVisibilityControl(status);
      renderAiReadControls(status);
      renderAutoSelectorControl(status);
      aiNoticeEl.textContent =
        "AI commentary can add separate AI read posts after deterministic alerts and can enhance optional symbol recaps. Snapshots, continuity, and follow-through posts still use deterministic text.";

      const cards = [
        ["Server", (config.bindHost || "127.0.0.1") + ":" + (config.port || "3010")],
        ["Historical Provider", config.historicalProvider],
        ["Live Provider", config.liveProvider],
        ["Trader Read Card", health.liveTraderReadCardVisible === false ? "hidden" : "visible"],
        ["Potential Gain Card", health.potentialGainCardVisible === false ? "hidden" : "visible"],
        ["Lifecycle Labels", health.watchlistLifecycleLabelsVisible === true ? "visible" : "hidden"],
        ["Automatic Selection", status.autoWatchlistSelector?.enabled ? "enabled" : "disabled"],
        ["TradersLink AI Read", status.aiReadConfigured ? "available" : "unavailable"],
        ["AI External Research", status.aiReadExternalResearchEnabled ? "enabled" : "disabled"],
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

          const aiRefreshButton = document.createElement("button");
          aiRefreshButton.textContent = "Refresh AI Read";
          aiRefreshButton.className = "secondary";
          aiRefreshButton.disabled = aiReadConfigured === false;
          aiRefreshButton.addEventListener("click", async () => {
            aiRefreshButton.disabled = true;
            setStatus("Generating a fresh TradersLink AI Read for " + entry.symbol + "...");
            try {
              const response = await fetch("/api/watchlist/ai-read-refresh", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ symbol: entry.symbol }),
              });
              const payload = await response.json();
              if (!response.ok) {
                setStatus(payload.error || "AI Read refresh failed", true);
                return;
              }
              setStatus(payload.generated
                ? "Published a fresh TradersLink AI Read for " + entry.symbol + "."
                : "No AI Read was generated for " + entry.symbol + " because a live price is not available yet.");
              await loadRuntimeStatus();
            } catch (error) {
              setStatus(String(error), true);
            } finally {
              aiRefreshButton.disabled = aiReadConfigured === false;
            }
          });
          actions.appendChild(aiRefreshButton);
        }

        const aiCardVisible = entry.tradersLinkAiReadCardVisible !== false;
        const aiVisibilityButton = document.createElement("button");
        aiVisibilityButton.textContent = aiCardVisible ? "AI Card: Shown" : "AI Card: Hidden";
        aiVisibilityButton.className = aiCardVisible ? "" : "secondary";
        aiVisibilityButton.disabled = aiReadConfigured === false;
        aiVisibilityButton.addEventListener("click", async () => {
          aiVisibilityButton.disabled = true;
          try {
            const response = await fetch("/api/watchlist/ai-read-visibility", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ symbol: entry.symbol, visible: !aiCardVisible }),
            });
            const payload = await response.json();
            if (!response.ok) {
              setStatus(payload.error || "AI Read visibility update failed", true);
              return;
            }
            setStatus(
              "TradersLink AI Read " + (!aiCardVisible ? "shown" : "hidden") +
              " for " + entry.symbol + ".",
            );
            await loadEntries();
            await loadRuntimeStatus();
          } catch (error) {
            setStatus(String(error), true);
          } finally {
            aiVisibilityButton.disabled = false;
          }
        });
        actions.appendChild(aiVisibilityButton);

        const dipBuyPlanVisible = entry.tradersLinkAiReadDipBuyPlanVisible !== false;
        const dipBuyPlanVisibilityButton = document.createElement("button");
        dipBuyPlanVisibilityButton.type = "button";
        dipBuyPlanVisibilityButton.setAttribute("role", "switch");
        dipBuyPlanVisibilityButton.setAttribute(
          "aria-checked",
          dipBuyPlanVisible ? "true" : "false",
        );
        dipBuyPlanVisibilityButton.setAttribute(
          "aria-label",
          "Show Potential dip-buy plan for " + entry.symbol,
        );
        dipBuyPlanVisibilityButton.textContent = dipBuyPlanVisible
          ? "Potential dip-buy plan: Shown"
          : "Potential dip-buy plan: Hidden";
        dipBuyPlanVisibilityButton.className = dipBuyPlanVisible ? "" : "secondary";
        dipBuyPlanVisibilityButton.addEventListener("click", async () => {
          dipBuyPlanVisibilityButton.disabled = true;
          try {
            const response = await fetch("/api/watchlist/ai-read-dip-buy-visibility", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ symbol: entry.symbol, visible: !dipBuyPlanVisible }),
            });
            const payload = await response.json();
            if (!response.ok) {
              setStatus(payload.error || "Dip-buy plan visibility update failed", true);
              return;
            }
            setStatus(
              "Potential dip-buy plan " + (!dipBuyPlanVisible ? "shown" : "hidden") +
              " for " + entry.symbol + ".",
            );
            await loadEntries();
            await loadRuntimeStatus();
          } catch (error) {
            setStatus(String(error), true);
          } finally {
            dipBuyPlanVisibilityButton.disabled = false;
          }
        });
        actions.appendChild(dipBuyPlanVisibilityButton);

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

    async function deactivateTickerGroup(scope, label) {
      const confirmed = window.confirm(
        "Remove " + label + " from the active watchlist? Discord posts and threads will be kept. Automatic selection will remain enabled and can add new qualifying tickers during an enabled trading session."
      );
      if (!confirmed) {
        return;
      }

      const bulkButtons = [
        removeAllTickersButtonEl,
        removeMainTickersButtonEl,
        removePostmarketTickersButtonEl,
      ];
      for (const button of bulkButtons) button.disabled = true;
      setStatus("Removing " + label + " from the active watchlist...");
      try {
        const response = await fetch("/api/watchlist/deactivate-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope,
            confirmation: "DEACTIVATE_WATCHLIST_TICKERS",
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setStatus(payload.error || "Bulk ticker removal failed", true);
          return;
        }
        const symbols = payload.deactivatedSymbols || [];
        setStatus(
          "Removed " + payload.deactivatedCount + " " +
          (payload.deactivatedCount === 1 ? "ticker" : "tickers") +
          (symbols.length ? " (" + symbols.join(", ") + ")." : ".") +
          " Discord posts and threads were kept."
        );
        await loadEntries();
        await loadRuntimeStatus();
        await loadReviewArtifacts();
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        for (const button of bulkButtons) button.disabled = false;
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

    async function applyPotentialGainVisibilitySelection() {
      const requestedVisible = potentialGainVisibleToggleEl.checked;
      if (requestedVisible === potentialGainVisible) {
        renderPotentialGainVisibilityControl({ runtimeHealth: { potentialGainCardVisible: potentialGainVisible } });
        return;
      }

      potentialGainVisibilityInFlight = true;
      renderPotentialGainVisibilityControl(
        { runtimeHealth: { potentialGainCardVisible: requestedVisible } },
        { keepPreviousState: true },
      );
      setStatus((requestedVisible ? "Showing" : "Hiding") + " the live website Potential Gain card...");
      try {
        const response = await fetch("/api/runtime/potential-gain-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visible: requestedVisible }),
        });
        const payload = await response.json();
        if (!response.ok) {
          potentialGainVisibleToggleEl.checked = potentialGainVisible;
          setStatus(payload.error || "Potential Gain card visibility change failed", true);
          return;
        }

        potentialGainVisible = payload.visible !== false;
        setStatus(
          (potentialGainVisible ? "Potential Gain card visible" : "Potential Gain card hidden") +
            " on the live website. Refreshed " +
            String(payload.refreshedSymbolCount || 0) +
            " active ticker records.",
        );
        await loadRuntimeStatus();
      } catch (error) {
        potentialGainVisibleToggleEl.checked = potentialGainVisible;
        setStatus(String(error), true);
      } finally {
        potentialGainVisibilityInFlight = false;
        renderPotentialGainVisibilityControl({ runtimeHealth: { potentialGainCardVisible: potentialGainVisible } });
      }
    }

    async function applyWatchlistLifecycleLabelsVisibilitySelection() {
      const requestedVisible = watchlistLifecycleLabelsVisibleToggleEl.checked;
      if (requestedVisible === watchlistLifecycleLabelsVisible) {
        renderWatchlistLifecycleLabelsVisibilityControl({
          runtimeHealth: { watchlistLifecycleLabelsVisible },
        });
        return;
      }

      watchlistLifecycleLabelsVisibilityInFlight = true;
      renderWatchlistLifecycleLabelsVisibilityControl(
        { runtimeHealth: { watchlistLifecycleLabelsVisible: requestedVisible } },
        { keepPreviousState: true },
      );
      setStatus((requestedVisible ? "Showing" : "Hiding") + " watchlist lifecycle labels...");
      try {
        const response = await fetch("/api/runtime/watchlist-lifecycle-labels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visible: requestedVisible }),
        });
        const payload = await response.json();
        if (!response.ok) {
          watchlistLifecycleLabelsVisibleToggleEl.checked = watchlistLifecycleLabelsVisible;
          setStatus(payload.error || "Lifecycle label visibility change failed", true);
          return;
        }

        watchlistLifecycleLabelsVisible = payload.visible === true;
        setStatus(
          (watchlistLifecycleLabelsVisible ? "Lifecycle labels visible" : "Lifecycle labels hidden") +
            " on the live website. Refreshed " +
            String(payload.refreshedSymbolCount || 0) +
            " active ticker records.",
        );
        await loadRuntimeStatus();
      } catch (error) {
        watchlistLifecycleLabelsVisibleToggleEl.checked = watchlistLifecycleLabelsVisible;
        setStatus(String(error), true);
      } finally {
        watchlistLifecycleLabelsVisibilityInFlight = false;
        renderWatchlistLifecycleLabelsVisibilityControl({
          runtimeHealth: { watchlistLifecycleLabelsVisible },
        });
      }
    }

    async function applyAiReadExternalResearchSelection() {
      const requestedEnabled = aiReadExternalResearchToggleEl.checked;
      if (requestedEnabled === aiReadExternalResearchEnabled) {
        aiReadExternalResearchToggleEl.checked = aiReadExternalResearchEnabled;
        return;
      }

      aiReadExternalResearchInFlight = true;
      aiReadExternalResearchToggleEl.disabled = true;
      setStatus((requestedEnabled ? "Enabling" : "Disabling") + " external AI research...");
      try {
        const response = await fetch("/api/runtime/ai-read-external-research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: requestedEnabled }),
        });
        const payload = await response.json();
        if (!response.ok) {
          aiReadExternalResearchToggleEl.checked = aiReadExternalResearchEnabled;
          setStatus(payload.error || "External AI research update failed", true);
          return;
        }
        aiReadExternalResearchEnabled = payload.enabled === true;
        setStatus(
          "External AI research " + (aiReadExternalResearchEnabled ? "enabled" : "disabled") +
          ". The local press-release/SEC database remains active as the first source.",
        );
        await loadRuntimeStatus();
      } catch (error) {
        aiReadExternalResearchToggleEl.checked = aiReadExternalResearchEnabled;
        setStatus(String(error), true);
      } finally {
        aiReadExternalResearchInFlight = false;
        aiReadExternalResearchToggleEl.disabled = aiReadConfigured === false;
      }
    }

    async function applyAiReadCostBudget() {
      const dailyLimitUsd = Number(aiReadCostBudgetUsdEl.value);
      if (!Number.isFinite(dailyLimitUsd) || dailyLimitUsd < 0.01 || dailyLimitUsd > 10000) {
        setStatus("AI Read daily budget must be between $0.01 and $10,000.00.", true);
        return;
      }
      const requestedEnabled = aiReadCostBudgetToggleEl.checked;
      aiReadCostBudgetInFlight = true;
      aiReadCostBudgetToggleEl.disabled = true;
      aiReadCostBudgetUsdEl.disabled = true;
      aiReadCostBudgetApplyEl.disabled = true;
      setStatus("Saving AI Read daily spend guard...");
      try {
        const response = await fetch("/api/runtime/ai-read-cost-budget", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: requestedEnabled, dailyLimitUsd }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setStatus(payload.error || "AI Read daily budget update failed", true);
          return;
        }
        aiReadCostBudgetEnabled = payload.budget?.enabled === true;
        aiReadCostBudgetUsdEl.value = Number(payload.budget?.dailyLimitUsd || dailyLimitUsd).toFixed(2);
        setStatus(
          aiReadCostBudgetEnabled
            ? "AI Read daily spend guard enabled."
            : "AI Read daily spend guard disabled.",
        );
        await loadRuntimeStatus();
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        aiReadCostBudgetInFlight = false;
        renderAiReadControls({
          aiReadConfigured,
          aiReadDailyCostBudget: {
            enabled: aiReadCostBudgetEnabled,
            dailyLimitUsd: Number(aiReadCostBudgetUsdEl.value) || 1,
          },
        });
      }
    }

    function readAutoSelectorNumber(key, multiplier) {
      const value = Number(autoSelectorInputEls[key].value);
      if (!Number.isFinite(value)) {
        throw new Error("All automatic selection settings require numeric values.");
      }
      return multiplier ? Math.round(value * multiplier) : value;
    }

    function collectAutoSelectorThresholds() {
      return {
        maxMarketCap: readAutoSelectorNumber("maxMarketCap", 1000000),
        maxFloatShares: readAutoSelectorNumber("maxFloatShares", 1000000),
        maxSharesOutstanding: readAutoSelectorNumber("maxSharesOutstanding", 1000000),
        lowPriceFloatNormalizationEnabled: autoSelectorInputEls.lowPriceFloatNormalizationEnabled.checked,
        lowPriceFloatNormalizationMaxPrice: readAutoSelectorNumber("lowPriceFloatNormalizationMaxPrice"),
        lowPriceFloatNormalizationMaxDollarValue: readAutoSelectorNumber("lowPriceFloatNormalizationMaxDollarValue", 1000000),
        requireShareData: autoSelectorInputEls.requireShareData.checked,
        minPrice: readAutoSelectorNumber("minPrice"),
        maxPrice: readAutoSelectorNumber("maxPrice"),
        minGainPct: readAutoSelectorNumber("minGainPct"),
        minVolume: Math.round(readAutoSelectorNumber("minVolume")),
        minDollarVolume: Math.round(readAutoSelectorNumber("minDollarVolume")),
        minimumScore: Math.round(readAutoSelectorNumber("minimumScore")),
        consecutivePassesRequired: Math.round(readAutoSelectorNumber("consecutivePassesRequired")),
        maxActiveMainSessionTickers: Math.round(readAutoSelectorNumber("maxActiveMainSessionTickers")),
        maxActivePostmarketTickers: Math.round(readAutoSelectorNumber("maxActivePostmarketTickers")),
        maxAddsPerTradingDay: Math.round(readAutoSelectorNumber("maxAddsPerTradingDay")),
        maxPostmarketAddsPerTradingDay: Math.round(readAutoSelectorNumber("maxPostmarketAddsPerTradingDay")),
        maxMainSessionReplacementsPerTradingDay: Math.round(readAutoSelectorNumber("maxMainSessionReplacementsPerTradingDay")),
        maxPostmarketReplacementsPerTradingDay: Math.round(readAutoSelectorNumber("maxPostmarketReplacementsPerTradingDay")),
        lateMainSessionAdmissionReserve: Math.round(readAutoSelectorNumber("lateMainSessionAdmissionReserve")),
        lateMainSessionAdmissionUnlockHourEastern: Math.round(readAutoSelectorNumber("lateMainSessionAdmissionUnlockHourEastern")),
        dynamicReplacementEnabled: autoSelectorInputEls.dynamicReplacementEnabled.checked,
        minimumAutoHoldMinutes: Math.round(readAutoSelectorNumber("minimumAutoHoldMinutes")),
        retentionFailureScansRequired: Math.round(readAutoSelectorNumber("retentionFailureScansRequired")),
        replacementRankingMargin: Math.round(readAutoSelectorNumber("replacementRankingMargin")),
        obviousRunnerOverrideEnabled: autoSelectorInputEls.obviousRunnerOverrideEnabled.checked,
        obviousRunnerRecentDollarVolumeMultiplier: readAutoSelectorNumber("obviousRunnerRecentDollarVolumeMultiplier"),
        obviousRunnerMinVolumeAcceleration: readAutoSelectorNumber("obviousRunnerMinVolumeAcceleration"),
        obviousRunnerReplacementMargin: Math.round(readAutoSelectorNumber("obviousRunnerReplacementMargin")),
        regularOpenProtectionMinutes: Math.round(readAutoSelectorNumber("regularOpenProtectionMinutes")),
        enrichmentLimit: Math.round(readAutoSelectorNumber("enrichmentLimit")),
        scanIntervalMs: readAutoSelectorNumber("scanIntervalMs", 60000),
        scanStartHourEastern: Math.round(readAutoSelectorNumber("scanStartHourEastern")),
        scanEndHourEastern: Math.round(readAutoSelectorNumber("scanEndHourEastern")),
        scanEndMinuteEastern: Math.round(readAutoSelectorNumber("scanEndMinuteEastern")),
        premarketEnabled: autoSelectorInputEls.premarketEnabled.checked,
        regularHoursEnabled: autoSelectorInputEls.regularHoursEnabled.checked,
        postmarketEnabled: autoSelectorInputEls.postmarketEnabled.checked,
        requireRecentActivityData: autoSelectorInputEls.requireRecentActivityData.checked,
        minRecentDollarVolume15mPremarket: Math.round(readAutoSelectorNumber("minRecentDollarVolume15mPremarket")),
        minRecentDollarVolume15mRegular: Math.round(readAutoSelectorNumber("minRecentDollarVolume15mRegular")),
        minRecentDollarVolume15mPostmarket: Math.round(readAutoSelectorNumber("minRecentDollarVolume15mPostmarket")),
        postmarketPromotionMinGainPct: readAutoSelectorNumber("postmarketPromotionMinGainPct"),
        postmarketPromotionMinRecentDollarVolume: Math.round(readAutoSelectorNumber("postmarketPromotionMinRecentDollarVolume")),
        maxActivityQuoteAgeMinutes: Math.round(readAutoSelectorNumber("maxActivityQuoteAgeMinutes")),
        extendedSessionCandidateLimit: Math.round(readAutoSelectorNumber("extendedSessionCandidateLimit")),
        catalystRankingEnabled: autoSelectorInputEls.catalystRankingEnabled.checked,
        catalystLookbackDays: Math.round(readAutoSelectorNumber("catalystLookbackDays")),
        catalystSameDayRankBoost: Math.round(readAutoSelectorNumber("catalystSameDayRankBoost")),
        catalystDailyRankDecay: Math.round(readAutoSelectorNumber("catalystDailyRankDecay")),
        recentDollarVolumeRankMaxBoost: Math.round(readAutoSelectorNumber("recentDollarVolumeRankMaxBoost")),
        recentDollarVolumeRankFullScore: Math.round(readAutoSelectorNumber("recentDollarVolumeRankFullScore")),
        volumeAccelerationRankMaxBoost: Math.round(readAutoSelectorNumber("volumeAccelerationRankMaxBoost")),
        volumeAccelerationRankFullScoreRatio: readAutoSelectorNumber("volumeAccelerationRankFullScoreRatio"),
        shareTurnoverRankMaxBoost: Math.round(readAutoSelectorNumber("shareTurnoverRankMaxBoost")),
        shareTurnoverRankFullScorePct: Math.round(readAutoSelectorNumber("shareTurnoverRankFullScorePct")),
      };
    }

    async function updateAutoSelector(payload, progressMessage) {
      autoSelectorRequestInFlight = true;
      autoSelectorEnabledToggleEl.disabled = true;
      autoSelectorApplyButtonEl.disabled = true;
      autoSelectorPreviewButtonEl.disabled = true;
      setStatus(progressMessage);
      try {
        const response = await fetch("/api/runtime/auto-watchlist-selector", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Automatic selection update failed");
        }
        autoSelectorSettingsDirty = false;
        renderAutoSelectorControl({ autoWatchlistSelector: result.status });
        setStatus(result.status.enabled ? "Automatic low-float selection enabled." : "Automatic low-float selection disabled.");
        await loadRuntimeStatus();
      } catch (error) {
        autoSelectorEnabledToggleEl.checked = autoSelectorEnabled;
        setStatus(String(error), true);
      } finally {
        autoSelectorRequestInFlight = false;
        autoSelectorApplyButtonEl.disabled = !autoSelectorSettingsDirty;
        autoSelectorPreviewButtonEl.disabled = false;
      }
    }

    async function applyAutoSelectorToggle() {
      await updateAutoSelector(
        { enabled: autoSelectorEnabledToggleEl.checked },
        (autoSelectorEnabledToggleEl.checked ? "Enabling" : "Disabling") + " automatic low-float selection...",
      );
    }

    async function applyAutoSelectorSettings() {
      try {
        await updateAutoSelector(
          { thresholds: collectAutoSelectorThresholds() },
          "Saving automatic selection settings...",
        );
      } catch (error) {
        setStatus(String(error), true);
      }
    }

    async function previewAutoSelector() {
      autoSelectorRequestInFlight = true;
      autoSelectorPreviewButtonEl.disabled = true;
      setStatus("Running an automatic selection preview. No tickers will be added...");
      try {
        if (autoSelectorSettingsDirty) {
          const saveResponse = await fetch("/api/runtime/auto-watchlist-selector", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ thresholds: collectAutoSelectorThresholds() }),
          });
          const saveResult = await saveResponse.json();
          if (!saveResponse.ok) {
            throw new Error(saveResult.error || "Automatic selection settings could not be saved");
          }
          autoSelectorSettingsDirty = false;
        }
        const response = await fetch("/api/runtime/auto-watchlist-selector/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Automatic selection preview failed");
        }
        renderAutoSelectorControl({ autoWatchlistSelector: result.status });
        setStatus(
          "Preview complete: " + String(result.status.lastScanCandidateCount || 0) +
          " discovered, " + String(result.status.lastEvaluatedCount || 0) +
          " evaluated, and " + String(result.status.lastQualifiedCount || 0) +
          " qualifiers. Nothing was added.",
        );
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        autoSelectorRequestInFlight = false;
        autoSelectorPreviewButtonEl.disabled = false;
        autoSelectorApplyButtonEl.disabled = !autoSelectorSettingsDirty;
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
    removeAllTickersButtonEl.addEventListener("click", () => deactivateTickerGroup("all", "all tickers"));
    removeMainTickersButtonEl.addEventListener("click", () => deactivateTickerGroup("main", "all Main Session tickers"));
    removePostmarketTickersButtonEl.addEventListener("click", () => deactivateTickerGroup("postmarket", "all Post-Market tickers"));
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
    potentialGainVisibleToggleEl.addEventListener("change", applyPotentialGainVisibilitySelection);
    watchlistLifecycleLabelsVisibleToggleEl.addEventListener("change", applyWatchlistLifecycleLabelsVisibilitySelection);
    aiReadExternalResearchToggleEl.addEventListener("change", applyAiReadExternalResearchSelection);
    aiReadCostBudgetToggleEl.addEventListener("change", applyAiReadCostBudget);
    aiReadCostBudgetApplyEl.addEventListener("click", applyAiReadCostBudget);
    autoSelectorEnabledToggleEl.addEventListener("change", applyAutoSelectorToggle);
    autoSelectorApplyButtonEl.addEventListener("click", applyAutoSelectorSettings);
    autoSelectorPreviewButtonEl.addEventListener("click", previewAutoSelector);
    for (const input of Object.values(autoSelectorInputEls)) {
      input.addEventListener("input", () => {
        autoSelectorSettingsDirty = true;
        autoSelectorApplyButtonEl.disabled = autoSelectorRequestInFlight;
      });
      input.addEventListener("change", () => {
        autoSelectorSettingsDirty = true;
        autoSelectorApplyButtonEl.disabled = autoSelectorRequestInFlight;
      });
    }

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
