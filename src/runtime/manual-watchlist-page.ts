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
    .button-link { display: inline-flex; align-items: center; min-width: 94px; padding: 10px 14px; border-radius: 8px; background: #1d4ed8; color: #fff; text-decoration: none; box-sizing: border-box; }
    button:disabled { cursor: not-allowed; opacity: 0.62; }
    button[data-loading="true"] { cursor: wait; }
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
    .watchlist-admin-group { border-top: 1px solid #dbe3ee; padding-top: 14px; margin-top: 14px; }
    .watchlist-admin-group h3 { margin: 0 0 6px; }
    .watchlist-group-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
    .watchlist-group-heading h3 { margin: 0; }
    .danger { background: #b91c1c; }
    .secondary { background: #475569; }
    .quiet { background: #64748b; }
    .ai-read-console { border: 1px solid #dbe3ee; border-radius: 10px; padding: 14px; background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); margin-top: 12px; }
    .ai-read-console-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
    .ai-read-console-title { font-size: 15px; font-weight: 700; color: #0f172a; }
    .ai-read-console-subtitle { color: #64748b; font-size: 12px; margin-top: 3px; line-height: 1.35; }
    .ai-read-console-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .ai-read-console-controls input, .ai-read-console-controls select { width: auto; min-width: 150px; margin: 0; padding: 8px 10px; }
    .ai-read-console-controls button { padding: 8px 12px; min-width: auto; }
    .ai-read-filter-select { min-width: 170px !important; }
    .ai-read-table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
    .ai-read-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 680px; }
    .ai-read-table th { text-align: left; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; padding: 10px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
    .ai-read-table td { padding: 10px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
    .ai-read-table tr:last-child td { border-bottom: 0; }
    .ai-read-table tr:hover td { background: #f8fbff; }
    .ai-read-ticker-button { min-width: auto; padding: 0; border: 0; background: transparent; color: #1d4ed8; font-weight: 800; cursor: pointer; }
    .ai-read-ticker-button:hover { text-decoration: underline; }
    .ai-read-row-detail { color: #64748b; font-size: 12px; margin-top: 3px; max-width: 300px; overflow-wrap: anywhere; }
    .ai-read-status-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 8px; font-size: 11px; font-weight: 800; background: #e2e8f0; color: #475569; white-space: nowrap; }
    .ai-read-status-published { background: #dcfce7; color: #166534; }
    .ai-read-status-failed, .ai-read-status-missing { background: #fee2e2; color: #991b1b; }
    .ai-read-status-skipped, .ai-read-status-deferred, .ai-read-status-pending { background: #fef3c7; color: #92400e; }
    .ai-read-status-inactive { background: #e2e8f0; color: #475569; }
    .ai-read-status-active { background: #dbeafe; color: #1e40af; }
    .ai-read-detail { margin-top: 12px; padding: 14px; border: 1px solid #bfdbfe; border-radius: 8px; background: #eff6ff; }
    .ai-read-detail-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
    .ai-read-detail-title { font-size: 16px; font-weight: 800; color: #0f172a; }
    .ai-read-detail-close { min-width: auto; padding: 6px 10px; }
    .ai-read-detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 12px 0; }
    .ai-read-detail-grid .runtime-card { background: #fff; min-height: 44px; }
    .ai-read-cost-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .ai-read-cost-table th { text-align: left; color: #64748b; font-size: 11px; text-transform: uppercase; padding: 9px; border-bottom: 1px solid #e2e8f0; }
    .ai-read-cost-table td { padding: 9px; border-bottom: 1px solid #eef2f7; }
    .ai-read-cost-table tr:last-child td { border-bottom: 0; }
    .ai-read-empty { color: #64748b; padding: 14px; text-align: center; font-size: 13px; }
    .ai-read-timeline { display: grid; gap: 8px; }
    .ai-read-timeline-item { border-left: 3px solid #93c5fd; padding: 7px 0 7px 10px; background: rgba(255,255,255,0.72); }
    .ai-read-timeline-item strong { color: #0f172a; }
    .ai-read-timeline-item span { color: #64748b; font-size: 12px; display: block; margin-top: 2px; overflow-wrap: anywhere; }
    @media (max-width: 640px) {
      body { margin: 12px; }
      li { align-items: flex-start; flex-direction: column; }
      .entry-actions { width: 100%; justify-content: flex-start; }
      .activity-time { flex-basis: auto; }
      .ai-read-console-controls { width: 100%; }
      .ai-read-console-controls input, .ai-read-console-controls select, .ai-read-console-controls button { flex: 1 1 100%; width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <form id="watchlist-form">
      <h1>Manual Watchlist</h1>
      <div class="top-actions">
        <a class="button-link" id="open-live-watchlist-link" href="https://traderslink.pro/watchlist" target="_blank" rel="noopener noreferrer">Open Live Watchlist</a>
        <button class="secondary" id="ai-clean-read-button" type="button">Open AI Clean Read</button>
        <button class="secondary" id="trade-plan-review-button" type="button">Open Trade Plan Review</button>
        <button class="danger" id="clear-discord-button" type="button">Clear Discord Posts</button>
        <button class="danger" id="remove-all-tickers-button" type="button">Clear All Watchlists</button>
      </div>
      <div class="status" id="status"></div>
      <label for="symbol">Symbol</label>
      <input id="symbol" name="symbol" maxlength="10" required />
      <label for="watchlist-group">Add to watchlist</label>
      <select id="watchlist-group" name="watchlist-group" required>
        <option value="top_regular">Top Regular Hour Watches</option>
        <option value="main" selected>Main Session (Premarket + Regular Hours)</option>
        <option value="postmarket">Post-Market</option>
      </select>
      <div class="field-hint">
        Use this watchlist for small, micro, and nano-cap momentum tickers. Large liquid names should only be used for deliberate technical tests.
      </div>
      <label for="note">Notes to send to OpenAI (optional)</label>
      <textarea id="note" name="note" maxlength="1200"></textarea>
      <button type="submit">Add / Activate</button>
    </form>

    <section>
      <h2>Active Tickers by Watchlist</h2>
      <div class="health-grid" id="watchlist-health"></div>
      <div class="watchlist-admin-group">
        <div class="watchlist-group-heading">
          <h3>Top Regular Hour Watches</h3>
          <button class="danger" id="remove-top-regular-tickers-button" type="button">Clear Top Regular</button>
        </div>
        <ul id="top-regular-list"></ul>
      </div>
      <div class="watchlist-admin-group">
        <div class="watchlist-group-heading">
          <h3>Main Session</h3>
          <button class="danger" id="remove-main-tickers-button" type="button">Clear Main Session</button>
        </div>
        <ul id="main-session-list"></ul>
      </div>
      <div class="watchlist-admin-group">
        <div class="watchlist-group-heading">
          <h3>Post-Market</h3>
          <button class="danger" id="remove-postmarket-tickers-button" type="button">Clear Post-Market</button>
        </div>
        <ul id="postmarket-list"></ul>
      </div>
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
        <label for="reversal-watchlist-visible-toggle">Potential Reversal Watchlist</label>
        <div class="inline-control toggle-control">
          <label class="toggle-switch">
            <input id="reversal-watchlist-visible-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
            <span id="reversal-watchlist-visible-label">Visible to users</span>
          </label>
          <button class="danger" id="remove-reversal-tickers-button" type="button">Clear Reversal Watchlist</button>
        </div>
        <div class="inline-status" id="reversal-watchlist-visible-status"></div>
      </div>
      <div class="provider-control">
        <label for="top-regular-watchlist-visible-toggle">Top Regular Hour Watches</label>
        <div class="inline-control toggle-control">
          <label class="toggle-switch">
            <input id="top-regular-watchlist-visible-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
            <span id="top-regular-watchlist-visible-label">Visible to users</span>
          </label>
        </div>
        <div class="inline-status" id="top-regular-watchlist-visible-status"></div>
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
          <label>Minimum score to enter Main Session (%)<input id="auto-selector-main-vacancy-min-score" type="number" min="0" max="100" step="1" /></label>
          <label>Minimum score to enter Post-Market (%)<input id="auto-selector-postmarket-min-score" type="number" min="0" max="100" step="1" /></label>
          <label>Maximum market cap ($M)<input id="auto-selector-max-market-cap" type="number" min="1" step="1" /></label>
          <label>Maximum float (M shares)<input id="auto-selector-max-float" type="number" min="0.1" step="0.1" /></label>
          <label>Maximum outstanding (M shares)<input id="auto-selector-max-outstanding" type="number" min="0.1" step="0.1" /></label>
          <label>Low-price float treatment at or below ($)<input id="auto-selector-low-price-float-max-price" type="number" min="0.01" step="0.01" /></label>
          <label>Maximum low-price dollar float ($M)<input id="auto-selector-low-price-float-max-dollar" type="number" min="0.1" step="0.1" /></label>
          <label>Minimum price ($)<input id="auto-selector-min-price" type="number" min="0.01" step="0.01" /></label>
          <label>Maximum price ($)<input id="auto-selector-max-price" type="number" min="0.02" step="0.01" /></label>
          <label>Minimum gain (%)<input id="auto-selector-min-gain" type="number" min="0" step="0.1" /></label>
          <label>Premarket/regular minimum volume (shares)<input id="auto-selector-min-volume" type="number" min="0" step="1000" /></label>
          <label>Premarket/regular minimum dollar volume ($)<input id="auto-selector-min-dollar-volume" type="number" min="0" step="10000" /></label>
          <label>Post-market minimum session volume (shares)<input id="auto-selector-postmarket-min-volume" type="number" min="0" step="1000" /></label>
          <label>Post-market minimum session dollar volume ($)<input id="auto-selector-postmarket-min-dollar-volume" type="number" min="0" step="5000" /></label>
          <label>Consecutive passing scans<input id="auto-selector-passes" type="number" min="1" max="10" step="1" /></label>
          <label>Maximum active premarket/regular auto tickers (lowering keeps best current slot scores)<input id="auto-selector-max-active-main" type="number" min="1" max="20" step="1" /></label>
          <label>Maximum active post-market auto tickers<input id="auto-selector-max-active-postmarket" type="number" min="1" max="20" step="1" /></label>
          <label>Initial main-session new-ticker quota per day (does not trim active slots)<input id="auto-selector-max-adds" type="number" min="1" max="20" step="1" /></label>
          <label>Initial post-market automatic additions per day<input id="auto-selector-max-postmarket-adds" type="number" min="1" max="20" step="1" /></label>
          <label>Main-session automatic replacements per day<input id="auto-selector-max-main-replacements" type="number" min="0" max="50" step="1" /></label>
          <label>Post-market automatic replacements per day<input id="auto-selector-max-postmarket-replacements" type="number" min="0" max="50" step="1" /></label>
          <label>Post-market extreme-runner overrides after replacement limit<input id="auto-selector-max-postmarket-extreme-overrides" type="number" min="0" max="10" step="1" /></label>
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
          <label>Exact-zero recent-volume grace (minutes)<input id="auto-selector-zero-volume-grace" type="number" min="0" max="60" step="1" /></label>
          <label>Extended-hours candidates checked<input id="auto-selector-extended-candidate-limit" type="number" min="1" max="200" step="1" /></label>
          <label>Catalyst lookback (days)<input id="auto-selector-catalyst-lookback" type="number" min="0" max="30" step="1" /></label>
          <label>Same-day catalyst rank boost<input id="auto-selector-catalyst-boost" type="number" min="0" max="100" step="1" /></label>
          <label>Catalyst decay per day<input id="auto-selector-catalyst-decay" type="number" min="0" max="100" step="1" /></label>
          <label>Recent 15m activity maximum rank boost<input id="auto-selector-recent-volume-rank-boost" type="number" min="0" max="100" step="1" /></label>
          <label>Recent 15m dollar volume for full boost ($)<input id="auto-selector-recent-volume-full-score" type="number" min="1" step="25000" /></label>
          <label>Volume acceleration maximum rank boost<input id="auto-selector-acceleration-rank-boost" type="number" min="0" max="100" step="1" /></label>
          <label>Acceleration ratio for full boost<input id="auto-selector-acceleration-full-score" type="number" min="1.1" step="0.1" /></label>
          <label>Volume deceleration maximum rank penalty<input id="auto-selector-deceleration-rank-penalty" type="number" min="0" max="100" step="1" /></label>
          <label>Acceleration ratio for full deceleration penalty<input id="auto-selector-deceleration-full-penalty" type="number" min="0.01" max="0.99" step="0.05" /></label>
          <label>Top-gainers qualification score boost<input id="auto-selector-top-gainer-boost" type="number" min="0" max="100" step="1" /></label>
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
        <div class="inline-status">Catalysts never bypass the price, gain, volume, market-cap, share-count, or recent-activity rules, and top-gainer credit cannot bypass them either. Exact-zero recent volume on a previously strong active ticker is treated as a short data-gap warning while the free Nasdaq Trader halt feed is checked. Confirmed halts freeze failed-retention counting until a resumption trade is posted. Activity, turnover, and deceleration affect the live rank; sustained gains above 20% add current slot-survival credit only. Admitted-at scores stay frozen while live rank and current slot continue to update.</div>
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
        <label for="ai-read-model-select">AI Read Model and Reasoning Effort</label>
        <div class="inline-control">
          <select id="ai-read-model-select">
            <option value="gpt-5.6-luna">Luna</option>
            <option value="gpt-5.6-terra">Terra</option>
          </select>
          <select id="ai-read-reasoning-effort-select">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">Extra High</option>
          </select>
          <button id="ai-read-model-apply" type="button">Apply Model</button>
        </div>
        <div class="inline-status" id="ai-read-model-status"></div>
      </div>
      <div class="provider-control">
        <label for="ai-read-generation-toggle">AI Read Generation</label>
        <div class="inline-control toggle-control">
          <label class="toggle-switch">
            <input id="ai-read-generation-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
            <span id="ai-read-generation-label">On</span>
          </label>
        </div>
        <div class="inline-status" id="ai-read-generation-status"></div>
      </div>
      <div class="provider-control">
        <label>AI Read Sessions</label>
        <div class="inline-control toggle-control">
          <label class="toggle-switch">
            <input id="ai-read-premarket-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
            <span>Premarket</span>
          </label>
          <label class="toggle-switch">
            <input id="ai-read-regular-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
            <span>Regular Hours</span>
          </label>
          <label class="toggle-switch">
            <input id="ai-read-postmarket-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
            <span>Post-Market</span>
          </label>
        </div>
        <div class="inline-status" id="ai-read-session-status"></div>
      </div>
      <div class="provider-control">
        <label for="ai-read-top-regular-activation-toggle">Top Regular Watches AI Reads</label>
        <div class="inline-control toggle-control">
          <label class="toggle-switch">
            <input id="ai-read-top-regular-activation-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
            <span>Allow AI Reads for all Top Regular watches</span>
          </label>
        </div>
        <div class="inline-status" id="ai-read-top-regular-activation-status">
          When enabled, every ticker manually placed in Top Regular Hour Watches can receive AI Reads while it remains on that list, even if the current session switch is off. This toggle has no ticker or read-count limit. The master AI Read switch still stops every OpenAI request.
        </div>
      </div>
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
      <div class="provider-control">
        <label for="ai-read-boundary-refreshes-toggle">Automatic Boundary Refreshes</label>
        <div class="inline-control">
          <label class="toggle-switch">
            <input id="ai-read-boundary-refreshes-toggle" type="checkbox" />
            <span class="toggle-slider"></span>
            <span id="ai-read-boundary-refreshes-label">On</span>
          </label>
          <input id="ai-read-boundary-refreshes-limit" type="number" min="0" max="1000" step="1" value="2" aria-label="Automatic boundary refreshes per ticker" />
          <span>per ticker per New York trading date</span>
          <button id="ai-read-boundary-refreshes-apply" type="button">Apply Refresh Limit</button>
        </div>
        <div class="inline-status" id="ai-read-boundary-refreshes-status"></div>
      </div>
      <div class="ai-read-console" id="ai-read-cost-console">
        <div class="ai-read-console-toolbar">
          <div>
            <div class="ai-read-console-title">API Cost Explorer</div>
            <div class="ai-read-console-subtitle">Estimated OpenAI usage from the local cost ledger. Select a period to see spend by ticker.</div>
          </div>
          <div class="ai-read-console-controls">
            <label for="ai-read-cost-period" class="meta">Period</label>
            <select id="ai-read-cost-period" aria-label="AI Read cost period">
              <option value="today">Today</option>
              <option value="last7Days">Last 7 days</option>
              <option value="last30Days">Last 30 days</option>
              <option value="allTime">All time</option>
            </select>
          </div>
        </div>
        <div class="health-grid" id="ai-read-cost-grid"></div>
        <div class="ai-read-table-wrap" id="ai-read-cost-list"></div>
      </div>
      <div class="ai-read-console" id="ai-read-audit-console">
        <div class="ai-read-console-toolbar">
          <div>
            <div class="ai-read-console-title">AI Read Operations</div>
            <div class="ai-read-console-subtitle">Grouped by ticker. Select a row to inspect the expected outcome, actual outcome, reasons, requests, and timeline.</div>
          </div>
          <div class="ai-read-console-controls">
            <select id="ai-read-audit-status-filter" class="ai-read-filter-select" aria-label="AI Read status filter">
              <option value="needs_attention">Needs attention</option>
              <option value="all">All tickers</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="published">Published</option>
              <option value="failed">Failed</option>
              <option value="skipped">Skipped</option>
              <option value="missing">Missing</option>
              <option value="pending">Pending / deferred</option>
            </select>
            <input id="ai-read-audit-symbol" type="text" maxlength="12" placeholder="Ticker" aria-label="AI Read audit ticker filter" />
            <button class="secondary" id="ai-read-audit-refresh" type="button">Refresh</button>
          </div>
        </div>
        <div class="health-grid" id="ai-read-audit-grid"></div>
        <div class="ai-read-table-wrap">
          <table class="ai-read-table">
            <thead><tr><th>Ticker</th><th>State</th><th>Last read</th><th>Last outcome</th><th>Reason</th></tr></thead>
            <tbody id="ai-read-audit-current-list"></tbody>
          </table>
        </div>
        <div class="ai-read-detail" id="ai-read-detail" hidden>
          <div class="ai-read-detail-header">
            <div>
              <div class="ai-read-detail-title" id="ai-read-detail-title"></div>
              <div class="inline-status" id="ai-read-detail-summary"></div>
            </div>
            <button class="secondary ai-read-detail-close" id="ai-read-detail-close" type="button">Close</button>
          </div>
          <div class="ai-read-detail-grid" id="ai-read-detail-grid"></div>
          <div class="ai-read-timeline" id="ai-read-audit-event-list"></div>
        </div>
      </div>
    </section>

    <section>
      <h2>Provider Health</h2>
      <div class="runtime-grid" id="provider-health-grid"></div>
      <ul class="activity-list" id="restart-readiness-list"></ul>
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
      <h2>Runtime Status</h2>
      <div class="runtime-grid" id="runtime-grid"></div>
    </section>

  </main>

  <script>
    const statusEl = document.getElementById("status");
    const openLiveWatchlistLinkEl = document.getElementById("open-live-watchlist-link");
    const listEls = {
      top_regular: document.getElementById("top-regular-list"),
      main: document.getElementById("main-session-list"),
      postmarket: document.getElementById("postmarket-list"),
    };
    const watchlistHealthEl = document.getElementById("watchlist-health");
    const runtimeGridEl = document.getElementById("runtime-grid");
    const providerHealthGridEl = document.getElementById("provider-health-grid");
    const restartReadinessListEl = document.getElementById("restart-readiness-list");
    const configGridEl = document.getElementById("config-grid");
    const aiNoticeEl = document.getElementById("ai-notice");
    const formEl = document.getElementById("watchlist-form");
    const activateButtonEl = formEl.querySelector('button[type="submit"]');
    const clearDiscordButtonEl = document.getElementById("clear-discord-button");
    const removeAllTickersButtonEl = document.getElementById("remove-all-tickers-button");
    const removeTopRegularTickersButtonEl = document.getElementById("remove-top-regular-tickers-button");
    const removeMainTickersButtonEl = document.getElementById("remove-main-tickers-button");
    const removePostmarketTickersButtonEl = document.getElementById("remove-postmarket-tickers-button");
    const removeReversalTickersButtonEl = document.getElementById("remove-reversal-tickers-button");
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
    const reversalWatchlistVisibleToggleEl = document.getElementById("reversal-watchlist-visible-toggle");
    const reversalWatchlistVisibleLabelEl = document.getElementById("reversal-watchlist-visible-label");
    const reversalWatchlistVisibleStatusEl = document.getElementById("reversal-watchlist-visible-status");
    const topRegularWatchlistVisibleToggleEl = document.getElementById("top-regular-watchlist-visible-toggle");
    const topRegularWatchlistVisibleLabelEl = document.getElementById("top-regular-watchlist-visible-label");
    const topRegularWatchlistVisibleStatusEl = document.getElementById("top-regular-watchlist-visible-status");
    const aiReadGenerationToggleEl = document.getElementById("ai-read-generation-toggle");
    const aiReadModelSelectEl = document.getElementById("ai-read-model-select");
    const aiReadReasoningEffortSelectEl = document.getElementById("ai-read-reasoning-effort-select");
    const aiReadModelApplyEl = document.getElementById("ai-read-model-apply");
    const aiReadModelStatusEl = document.getElementById("ai-read-model-status");
    const aiReadGenerationLabelEl = document.getElementById("ai-read-generation-label");
    const aiReadGenerationStatusEl = document.getElementById("ai-read-generation-status");
    const aiReadPremarketToggleEl = document.getElementById("ai-read-premarket-toggle");
    const aiReadRegularToggleEl = document.getElementById("ai-read-regular-toggle");
    const aiReadPostmarketToggleEl = document.getElementById("ai-read-postmarket-toggle");
    const aiReadSessionStatusEl = document.getElementById("ai-read-session-status");
    const aiReadTopRegularActivationToggleEl = document.getElementById("ai-read-top-regular-activation-toggle");
    const aiReadTopRegularActivationStatusEl = document.getElementById("ai-read-top-regular-activation-status");
    const aiReadExternalResearchToggleEl = document.getElementById("ai-read-external-research-toggle");
    const aiReadExternalResearchLabelEl = document.getElementById("ai-read-external-research-label");
    const aiReadExternalResearchStatusEl = document.getElementById("ai-read-external-research-status");
    const aiReadCostBudgetToggleEl = document.getElementById("ai-read-cost-budget-toggle");
    const aiReadCostBudgetLabelEl = document.getElementById("ai-read-cost-budget-label");
    const aiReadCostBudgetUsdEl = document.getElementById("ai-read-cost-budget-usd");
    const aiReadCostBudgetApplyEl = document.getElementById("ai-read-cost-budget-apply");
    const aiReadCostBudgetStatusEl = document.getElementById("ai-read-cost-budget-status");
    const aiReadBoundaryRefreshesToggleEl = document.getElementById("ai-read-boundary-refreshes-toggle");
    const aiReadBoundaryRefreshesLabelEl = document.getElementById("ai-read-boundary-refreshes-label");
    const aiReadBoundaryRefreshesLimitEl = document.getElementById("ai-read-boundary-refreshes-limit");
    const aiReadBoundaryRefreshesApplyEl = document.getElementById("ai-read-boundary-refreshes-apply");
    const aiReadBoundaryRefreshesStatusEl = document.getElementById("ai-read-boundary-refreshes-status");
    const aiReadCostGridEl = document.getElementById("ai-read-cost-grid");
    const aiReadCostListEl = document.getElementById("ai-read-cost-list");
    const aiReadCostPeriodEl = document.getElementById("ai-read-cost-period");
    const aiReadAuditSymbolEl = document.getElementById("ai-read-audit-symbol");
    const aiReadAuditStatusFilterEl = document.getElementById("ai-read-audit-status-filter");
    const aiReadAuditRefreshEl = document.getElementById("ai-read-audit-refresh");
    const aiReadAuditGridEl = document.getElementById("ai-read-audit-grid");
    const aiReadAuditCurrentListEl = document.getElementById("ai-read-audit-current-list");
    const aiReadAuditEventListEl = document.getElementById("ai-read-audit-event-list");
    const aiReadDetailEl = document.getElementById("ai-read-detail");
    const aiReadDetailTitleEl = document.getElementById("ai-read-detail-title");
    const aiReadDetailSummaryEl = document.getElementById("ai-read-detail-summary");
    const aiReadDetailGridEl = document.getElementById("ai-read-detail-grid");
    const aiReadDetailCloseEl = document.getElementById("ai-read-detail-close");
    const autoSelectorEnabledToggleEl = document.getElementById("auto-selector-enabled-toggle");
    const autoSelectorEnabledLabelEl = document.getElementById("auto-selector-enabled-label");
    const autoSelectorStatusEl = document.getElementById("auto-selector-status");
    const autoSelectorDecisionsEl = document.getElementById("auto-selector-decisions");
    const autoSelectorApplyButtonEl = document.getElementById("auto-selector-apply-button");
    const autoSelectorPreviewButtonEl = document.getElementById("auto-selector-preview-button");
    const autoSelectorInputEls = {
      mainVacancyMinQualificationScore: document.getElementById("auto-selector-main-vacancy-min-score"),
      postmarketMinQualificationScore: document.getElementById("auto-selector-postmarket-min-score"),
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
      minPostmarketVolume: document.getElementById("auto-selector-postmarket-min-volume"),
      minPostmarketDollarVolume: document.getElementById("auto-selector-postmarket-min-dollar-volume"),
      consecutivePassesRequired: document.getElementById("auto-selector-passes"),
      maxActiveMainSessionTickers: document.getElementById("auto-selector-max-active-main"),
      maxActivePostmarketTickers: document.getElementById("auto-selector-max-active-postmarket"),
      maxAddsPerTradingDay: document.getElementById("auto-selector-max-adds"),
      maxPostmarketAddsPerTradingDay: document.getElementById("auto-selector-max-postmarket-adds"),
      maxMainSessionReplacementsPerTradingDay: document.getElementById("auto-selector-max-main-replacements"),
      maxPostmarketReplacementsPerTradingDay: document.getElementById("auto-selector-max-postmarket-replacements"),
      maxPostmarketExtremeRunnerOverridesPerTradingDay: document.getElementById("auto-selector-max-postmarket-extreme-overrides"),
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
      zeroRecentVolumeRetentionGraceMinutes: document.getElementById("auto-selector-zero-volume-grace"),
      extendedSessionCandidateLimit: document.getElementById("auto-selector-extended-candidate-limit"),
      catalystRankingEnabled: document.getElementById("auto-selector-catalyst-ranking"),
      catalystLookbackDays: document.getElementById("auto-selector-catalyst-lookback"),
      catalystSameDayRankBoost: document.getElementById("auto-selector-catalyst-boost"),
      catalystDailyRankDecay: document.getElementById("auto-selector-catalyst-decay"),
      recentDollarVolumeRankMaxBoost: document.getElementById("auto-selector-recent-volume-rank-boost"),
      recentDollarVolumeRankFullScore: document.getElementById("auto-selector-recent-volume-full-score"),
      volumeAccelerationRankMaxBoost: document.getElementById("auto-selector-acceleration-rank-boost"),
      volumeAccelerationRankFullScoreRatio: document.getElementById("auto-selector-acceleration-full-score"),
      volumeDecelerationRankMaxPenalty: document.getElementById("auto-selector-deceleration-rank-penalty"),
      volumeDecelerationRankFullPenaltyRatio: document.getElementById("auto-selector-deceleration-full-penalty"),
      topGainerQualificationScoreBoost: document.getElementById("auto-selector-top-gainer-boost"),
      shareTurnoverRankMaxBoost: document.getElementById("auto-selector-turnover-rank-boost"),
      shareTurnoverRankFullScorePct: document.getElementById("auto-selector-turnover-full-score"),
    };
    const symbolEl = document.getElementById("symbol");
    const watchlistGroupEl = document.getElementById("watchlist-group");
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
    let reversalWatchlistVisible = true;
    let reversalWatchlistVisibilityInFlight = false;
    let topRegularWatchlistVisible = true;
    let topRegularWatchlistVisibilityInFlight = false;
    let aiReadConfigured = null;
    let aiReadGenerationSettings = {
      enabled: true,
      premarketEnabled: true,
      regularEnabled: true,
      postmarketEnabled: true,
      topRegularActivationEnabled: true,
    };
    let aiReadGenerationInFlight = false;
    let aiReadGenerationAllowed = false;
    let aiReadExternalResearchEnabled = false;
    let aiReadExternalResearchInFlight = false;
    let aiReadCostBudgetEnabled = false;
    let aiReadCostBudgetInFlight = false;
    let aiReadBoundaryRefreshesEnabled = true;
    let aiReadBoundaryRefreshesInFlight = false;
    let aiReadCostPeriod = "today";
    let aiReadAuditPayload = null;
    let aiReadAuditSelectedSymbol = null;
    let autoSelectorEnabled = false;
    let autoSelectorSettingsDirty = false;
    let autoSelectorRequestInFlight = false;
    let runtimeStatusHydrated = false;
    let dashboardRefreshTimer = null;
    const DASHBOARD_REFRESH_INTERVAL_MS = 5000;
    const RUNTIME_DETAILS_REFRESH_INTERVAL_MS = 60000;
    const runtimeSettingsControlEls = [
      historicalProviderSelectEl,
      applyHistoricalProviderButtonEl,
      liveProviderSelectEl,
      applyLiveProviderButtonEl,
      liveTraderReadVisibleToggleEl,
      potentialGainVisibleToggleEl,
      watchlistLifecycleLabelsVisibleToggleEl,
      reversalWatchlistVisibleToggleEl,
      topRegularWatchlistVisibleToggleEl,
      aiReadGenerationToggleEl,
      aiReadPremarketToggleEl,
      aiReadRegularToggleEl,
      aiReadPostmarketToggleEl,
      aiReadTopRegularActivationToggleEl,
      aiReadExternalResearchToggleEl,
      aiReadCostBudgetToggleEl,
      aiReadCostBudgetUsdEl,
      aiReadCostBudgetApplyEl,
      aiReadBoundaryRefreshesToggleEl,
      aiReadBoundaryRefreshesLimitEl,
      aiReadBoundaryRefreshesApplyEl,
      autoSelectorEnabledToggleEl,
      autoSelectorApplyButtonEl,
      autoSelectorPreviewButtonEl,
      ...Object.values(autoSelectorInputEls),
    ];
    function setRuntimeStatusHydrated(hydrated) {
      runtimeStatusHydrated = hydrated;
      for (const control of runtimeSettingsControlEls) {
        control.disabled = !runtimeStatusHydrated;
      }
      runtimeGridEl.setAttribute("aria-busy", String(!runtimeStatusHydrated));
    }
    setRuntimeStatusHydrated(false);
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
      const selectorState = entry.selectorManagedState;
      header.appendChild(createBadge(
        selectorState === "followup"
          ? "Follow-up — not on public watchlist"
          : lifecycleLabel(entry.lifecycle),
        selectorState === "followup" ? "badge badge-working" : lifecycleBadgeClass(entry.lifecycle),
      ));
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
      if (selectorState === "followup") {
        appendMetaValue(details, "follow-up score", formatNumber(entry.selectorCurrentSlotScore));
        appendMetaValue(details, "follow-up reason", entry.selectorStatusReason);
      }

      meta.appendChild(header);
      meta.appendChild(details);
      if (entry.operationStatus) {
        const state = document.createElement("div");
        state.className = "entry-state";
        state.textContent = entry.operationStatus;
        meta.appendChild(state);
      }
      if (entry.tradersLinkAiReadFailure) {
        const failure = document.createElement("div");
        const aiReadFailure = entry.tradersLinkAiReadFailure;
        failure.className = "meta error-line";
        failure.textContent =
          "AI Read failed (" + String(aiReadFailure.stage || "unknown") + "): " +
          String(aiReadFailure.reason || "unknown reason") +
          " — trigger: " + String(aiReadFailure.trigger || "unknown") +
          " at " + formatTime(aiReadFailure.failedAt);
        meta.appendChild(failure);
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
        ["Last Website Post", lastPost],
        ["Last Website Failure", lastDeliveryFailure],
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
          " | publication " +
          lifecycleLabel(item.discordStatus);
        detail.className = "activity-detail";
        detail.textContent = (item.reason || "readiness check") + priceAge + levelAge;
        body.appendChild(detail);
        row.appendChild(body);
        restartReadinessListEl.appendChild(row);
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

    function renderReversalWatchlistVisibilityControl(status, options) {
      const visible = status.runtimeHealth?.reversalWatchlistVisible !== false;
      if (!options?.keepPreviousState) {
        reversalWatchlistVisible = visible;
      }
      reversalWatchlistVisibleToggleEl.checked = visible;
      reversalWatchlistVisibleToggleEl.disabled = reversalWatchlistVisibilityInFlight;
      reversalWatchlistVisibleLabelEl.textContent = visible ? "Visible to users" : "Hidden from users";
      reversalWatchlistVisibleStatusEl.textContent = visible
        ? "Protected Main-session runners can appear below the Main Session list after a pullback."
        : "The Potential Reversal Watchlist is hidden; ticker monitoring continues in the background.";
    }

    function renderTopRegularWatchlistVisibilityControl(status, options) {
      const visible = status.runtimeHealth?.topRegularWatchlistVisible !== false;
      if (!options?.keepPreviousState) {
        topRegularWatchlistVisible = visible;
      }
      topRegularWatchlistVisibleToggleEl.checked = visible;
      topRegularWatchlistVisibleToggleEl.disabled = topRegularWatchlistVisibilityInFlight;
      topRegularWatchlistVisibleLabelEl.textContent = visible ? "Visible to users" : "Hidden from users";
      topRegularWatchlistVisibleStatusEl.textContent = visible
        ? "The manually curated Top Regular Hour Watches list appears above Main Session."
        : "The list is hidden from users; its saved ticker membership is retained.";
    }

    function formatAiReadCost(value) {
      const amount = Number(value || 0);
      return "$" + amount.toFixed(amount >= 1 ? 2 : 4);
    }

    function renderAiReadControls(status) {
      aiReadConfigured = status.aiReadConfigured === true;
      if (status.aiReadModel) aiReadModelSelectEl.value = status.aiReadModel;
      if (status.aiReadReasoningEffort) {
        aiReadReasoningEffortSelectEl.value = status.aiReadReasoningEffort;
      }
      aiReadModelSelectEl.disabled = !aiReadConfigured;
      aiReadReasoningEffortSelectEl.disabled = !aiReadConfigured;
      aiReadModelApplyEl.disabled = !aiReadConfigured;
      aiReadModelStatusEl.textContent = aiReadConfigured
        ? "Current: " +
          (status.aiReadModel === "gpt-5.6-luna" ? "Luna" : "Terra") +
          " at " + String(status.aiReadReasoningEffort || "medium") +
          " effort. The other model is used as the fallback."
        : "Configure the TradersLink AI Read service before selecting a model.";
      const generationSettings =
        status.runtimeHealth?.tradersLinkAiReadGenerationSettings || aiReadGenerationSettings;
      if (!aiReadGenerationInFlight) {
        aiReadGenerationSettings = {
          enabled: generationSettings.enabled !== false,
          premarketEnabled: generationSettings.premarketEnabled !== false,
          regularEnabled: generationSettings.regularEnabled !== false,
          postmarketEnabled: generationSettings.postmarketEnabled !== false,
          topRegularActivationEnabled:
            generationSettings.topRegularActivationEnabled !== false,
        };
      }
      aiReadGenerationToggleEl.checked = aiReadGenerationSettings.enabled;
      aiReadPremarketToggleEl.checked = aiReadGenerationSettings.premarketEnabled;
      aiReadRegularToggleEl.checked = aiReadGenerationSettings.regularEnabled;
      aiReadPostmarketToggleEl.checked = aiReadGenerationSettings.postmarketEnabled;
      aiReadTopRegularActivationToggleEl.checked =
        aiReadGenerationSettings.topRegularActivationEnabled;
      aiReadGenerationLabelEl.textContent = aiReadGenerationSettings.enabled ? "On" : "Off";
      const generationControlsDisabled = !aiReadConfigured || aiReadGenerationInFlight;
      aiReadGenerationToggleEl.disabled = generationControlsDisabled;
      aiReadPremarketToggleEl.disabled =
        generationControlsDisabled || !aiReadGenerationSettings.enabled;
      aiReadRegularToggleEl.disabled =
        generationControlsDisabled || !aiReadGenerationSettings.enabled;
      aiReadPostmarketToggleEl.disabled =
        generationControlsDisabled || !aiReadGenerationSettings.enabled;
      aiReadTopRegularActivationToggleEl.disabled =
        generationControlsDisabled || !aiReadGenerationSettings.enabled;
      const availability = status.runtimeHealth?.tradersLinkAiReadGenerationAvailability;
      aiReadGenerationAllowed = availability?.allowed === true;
      aiReadGenerationStatusEl.textContent = aiReadGenerationSettings.enabled
        ? "Master generation is on. Session switches decide whether any OpenAI request can start."
        : "Master generation is off. No AI Read request preparation or OpenAI API call can start.";
      aiReadSessionStatusEl.textContent = availability?.allowed
        ? "Current session: " + availability.session + " — AI Reads allowed."
        : "Current session: " + String(availability?.session || "unknown") +
          " — " + String(availability?.reason || "AI Reads blocked.");
      aiReadTopRegularActivationStatusEl.textContent =
        aiReadGenerationSettings.topRegularActivationEnabled
          ? "On: all manually curated Top Regular watches may receive AI Reads with no ticker or read-count limit, even when the current session is off. The master switch still blocks every OpenAI request."
          : "Off: Top Regular watches obey the current session switch for all AI Reads.";
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
        const guardedSpend = formatAiReadCost(budgetStatus.guardedSpendUsd);
        const remaining = formatAiReadCost(budgetStatus.remainingUsd);
        const reserve = formatAiReadCost(budgetStatus.projectedNextRequestUsd);
        const unpricedCount = Number(budgetStatus.unpricedRequestCount || 0);
        const uncertainty = unpricedCount > 0
          ? " " + unpricedCount + " unpriced request" + (unpricedCount === 1 ? " is" : "s are") + " covered by " + formatAiReadCost(budgetStatus.unpricedReserveUsd) + " of uncertainty allowance."
          : "";
        aiReadCostBudgetStatusEl.textContent = budgetStatus.canStartRequest === false
          ? "Guard is holding new reads: " + String(budgetStatus.blockReason || "daily budget reached.")
          : "On. Today: " + spent + " known spend, " + guardedSpend + " guarded spend, " + remaining + " remaining; " + reserve + " is reserved before a new read starts." + uncertainty;
      }

      const boundaryRefreshes =
        status.runtimeHealth?.tradersLinkAiReadBoundaryRefreshSettings || {};
      if (!aiReadBoundaryRefreshesInFlight) {
        aiReadBoundaryRefreshesEnabled = boundaryRefreshes.enabled !== false;
        const limit = Number(boundaryRefreshes.maxPerTickerPerNewYorkDate);
        if (Number.isInteger(limit) && limit >= 0) {
          aiReadBoundaryRefreshesLimitEl.value = String(limit);
        }
      }
      aiReadBoundaryRefreshesToggleEl.checked = aiReadBoundaryRefreshesEnabled;
      aiReadBoundaryRefreshesToggleEl.disabled = !aiReadConfigured || aiReadBoundaryRefreshesInFlight;
      aiReadBoundaryRefreshesLimitEl.disabled = !aiReadConfigured || aiReadBoundaryRefreshesInFlight;
      aiReadBoundaryRefreshesApplyEl.disabled = !aiReadConfigured || aiReadBoundaryRefreshesInFlight;
      aiReadBoundaryRefreshesLabelEl.textContent = aiReadBoundaryRefreshesEnabled ? "On" : "Off";
      aiReadBoundaryRefreshesStatusEl.textContent = !aiReadConfigured
        ? "Configure the TradersLink AI Read service before changing automatic boundary refreshes."
        : aiReadBoundaryRefreshesEnabled
          ? "On. Automatic boundary-crossing reads are limited per ticker per New York trading date. Manual Refresh AI Read requests remain available separately."
          : "Off. Automatic boundary-crossing reads are disabled; manual Refresh AI Read requests remain available separately.";

      const summary = status.aiReadCostSummary || {};
      const windows = summary.windows || {};
      const periodKey = String(aiReadCostPeriod || "today");
      const period = windows[periodKey] || windows.today || {};
      const periodLabels = { today: "Today", last7Days: "Last 7 days", last30Days: "Last 30 days", allTime: "All time" };
      const tickerWindows = summary.tickerWindows || {};
      const perTicker = Array.isArray(tickerWindows[periodKey])
        ? tickerWindows[periodKey]
        : periodKey === "today"
          ? (Array.isArray(summary.todayPerTicker) ? summary.todayPerTicker : [])
          : (Array.isArray(summary.perTicker) ? summary.perTicker : []);
      const accountingHealth = summary.accountingHealth || {};
      aiReadCostGridEl.innerHTML = "";
      const cards = [
        [String(periodLabels[periodKey] || "Selected period") + " spend", formatAiReadCost(period.estimatedTotalCostUsd)],
        ["API requests", String(period.requestCount || 0)],
        ["Tickers", String(period.tickerCount || 0)],
        ["Average / request", formatAiReadCost(period.requestCount ? period.estimatedTotalCostUsd / period.requestCount : 0)],
        ["Web searches", String(period.webSearchCallCount || 0)],
        ["Unpriced requests", String(period.unpricedRequestCount || 0)],
        ["All-time spend", formatAiReadCost(windows.allTime?.estimatedTotalCostUsd)],
        ["Accounting", accountingHealth.healthy === false ? "CHECK LEDGER" : "Healthy"],
      ];
      for (const [label, value] of cards) aiReadCostGridEl.appendChild(createRuntimeCard(label, value));

      aiReadCostListEl.innerHTML = "";
      if (accountingHealth.healthy === false) {
        const warning = document.createElement("div");
        warning.className = "notice";
        warning.textContent = "Expense totals may be incomplete: " + String(accountingHealth.lastLoadError || "the usage ledger could not be read completely.");
        aiReadCostListEl.appendChild(warning);
      }
      if (perTicker.length === 0) {
        const empty = document.createElement("div");
        empty.className = "ai-read-empty";
        empty.textContent = "No API calls recorded for " + String(periodLabels[periodKey] || "this period") + ".";
        aiReadCostListEl.appendChild(empty);
      } else {
        const table = document.createElement("table");
        table.className = "ai-read-cost-table";
        table.innerHTML = "<thead><tr><th>Ticker</th><th>Spend</th><th>Requests</th><th>Average</th><th>Web searches</th><th>Last trigger</th></tr></thead>";
        const tbody = document.createElement("tbody");
        for (const ticker of perTicker) {
          const row = document.createElement("tr");
          row.innerHTML =
            "<td><strong>" + String(ticker.symbol || "") + "</strong></td>" +
            "<td>" + formatAiReadCost(ticker.estimatedTotalCostUsd) + "</td>" +
            "<td>" + String(ticker.requestCount || 0) + "</td>" +
            "<td>" + formatAiReadCost(ticker.averageCostPerRequestUsd) + "</td>" +
            "<td>" + String(ticker.webSearchCallCount || 0) + "</td>" +
            "<td>" + String(ticker.lastTrigger || "unknown") + "</td>";
          tbody.appendChild(row);
        }
        table.appendChild(tbody);
        aiReadCostListEl.appendChild(table);
      }

      const byModel = Array.isArray(summary.byModel) ? summary.byModel : [];
      if (byModel.length > 0) {
        const modelNote = document.createElement("div");
        modelNote.className = "inline-status";
        modelNote.textContent = byModel.map((model) =>
          String(model.model || "unknown") + ": " + formatAiReadCost(model.totals?.estimatedTotalCostUsd) + " / " + String(model.totals?.requestCount || 0) + " request(s)",
        ).join(" | ");
        aiReadCostListEl.appendChild(modelNote);
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

    function auditStatusLabel(value) {
      return String(value || "unknown").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    }

    function auditStatusClass(value) {
      const normalized = String(value || "unknown").replace(/_/g, "-");
      return "ai-read-status-pill ai-read-status-" + normalized;
    }

    function buildAiReadAuditRows(payload) {
      const rows = new Map();
      const currentEntries = Array.isArray(payload?.currentEntries) ? payload.currentEntries : [];
      const recentEvents = Array.isArray(payload?.recentEvents) ? payload.recentEvents : [];
      for (const entry of currentEntries) {
        rows.set(entry.symbol, { symbol: entry.symbol, current: entry, events: [], outcomes: new Set() });
      }
      for (const event of recentEvents) {
        const row = rows.get(event.symbol) || { symbol: event.symbol, current: null, events: [], outcomes: new Set() };
        row.events.push(event);
        row.outcomes.add(event.outcome);
        rows.set(event.symbol, row);
      }
      return [...rows.values()].map((row) => {
        row.events.sort((left, right) => Number(right.occurredAt || 0) - Number(left.occurredAt || 0));
        row.latestEvent = row.events[0] || null;
        row.state = row.current?.status || row.latestEvent?.outcome || "unknown";
        row.reason = row.current?.reason || row.latestEvent?.reason || "No additional state detail.";
        row.needsAttention = ["failed", "missing", "publishing_pending"].includes(row.current?.status) ||
          (row.current?.status !== "published" && ["failed", "missing", "skipped", "deferred", "expected"].some((outcome) => row.outcomes.has(outcome)));
        return row;
      });
    }

    function auditRowMatches(row, filter) {
      const currentStatus = row.current?.status || "";
      switch (filter) {
        case "active": return row.current?.active === true;
        case "inactive": return row.current?.active === false;
        case "published": return currentStatus === "published";
        case "failed": return currentStatus === "failed" || row.outcomes.has("failed");
        case "skipped": return row.outcomes.has("skipped");
        case "missing": return currentStatus === "missing" || row.outcomes.has("missing");
        case "pending": return currentStatus === "publishing_pending" || row.outcomes.has("deferred") || row.outcomes.has("expected");
        case "needs_attention": return row.needsAttention;
        default: return true;
      }
    }

    function renderAiReadDetail() {
      const row = buildAiReadAuditRows(aiReadAuditPayload || {}).find((candidate) => candidate.symbol === aiReadAuditSelectedSymbol);
      if (!row) {
        aiReadDetailEl.hidden = true;
        return;
      }
      aiReadDetailEl.hidden = false;
      aiReadDetailTitleEl.textContent = row.symbol + " — " + auditStatusLabel(row.state);
      aiReadDetailSummaryEl.textContent = row.reason;
      aiReadDetailGridEl.innerHTML = "";
      [
        ["Current state", auditStatusLabel(row.state)],
        ["Lifecycle", row.current?.active === false ? "Inactive" : "Active"],
        ["Last read", row.current?.lastReadGeneratedAt ? formatTime(row.current.lastReadGeneratedAt) : "None"],
        ["Latest trigger", row.latestEvent?.trigger || "None"],
        ["Events shown", String(row.events.length)],
      ].forEach(([label, value]) => aiReadDetailGridEl.appendChild(createRuntimeCard(label, value)));

      aiReadAuditEventListEl.innerHTML = "";
      if (row.events.length === 0) {
        const empty = document.createElement("div");
        empty.className = "ai-read-empty";
        empty.textContent = "No audit events are recorded for this ticker.";
        aiReadAuditEventListEl.appendChild(empty);
        return;
      }
      for (const event of row.events) {
        const item = document.createElement("div");
        item.className = "ai-read-timeline-item";
        const title = document.createElement("strong");
        title.textContent = auditStatusLabel(event.outcome) + " / " + auditStatusLabel(event.stage);
        const detail = document.createElement("span");
        const identifiers = [
          formatTime(event.occurredAt),
          event.trigger ? "trigger: " + event.trigger : "",
          event.attemptType ? "attempt: " + event.attemptType : "",
          event.model ? "model: " + event.model : "",
          event.requestId ? "request: " + event.requestId : "",
          event.durationMs ? "duration: " + event.durationMs + "ms" : "",
          event.estimatedCostUsd !== undefined && event.estimatedCostUsd !== null ? "cost: " + formatAiReadCost(event.estimatedCostUsd) : "",
          event.reason || "",
        ].filter(Boolean);
        detail.textContent = identifiers.join(" | ");
        item.appendChild(title);
        item.appendChild(detail);
        aiReadAuditEventListEl.appendChild(item);
      }
    }

    function renderAiReadAudit(payload) {
      aiReadAuditPayload = payload;
      const summary = payload?.summary || {};
      const byOutcome = summary.byOutcome || {};
      const rows = buildAiReadAuditRows(payload);
      const filter = String(aiReadAuditStatusFilterEl.value || "needs_attention");
      const filteredRows = rows
        .filter((row) => auditRowMatches(row, filter))
        .sort((left, right) => Number(right.latestEvent?.occurredAt || right.current?.lastReadGeneratedAt || 0) - Number(left.latestEvent?.occurredAt || left.current?.lastReadGeneratedAt || 0));
      aiReadAuditGridEl.innerHTML = "";
      [
        ["Showing", String(filteredRows.length)],
        ["Published", String(rows.filter((row) => row.current?.status === "published").length)],
        ["Needs attention", String(rows.filter((row) => row.needsAttention).length)],
        ["Failed", String(byOutcome.failed || 0)],
        ["Skipped", String(byOutcome.skipped || 0)],
        ["Missing", String(byOutcome.missing || 0)],
        ["Requests", String(byOutcome.request_started || 0)],
      ].forEach(([label, value]) => aiReadAuditGridEl.appendChild(createRuntimeCard(label, value)));

      aiReadAuditCurrentListEl.innerHTML = "";
      if (filteredRows.length === 0) {
        const emptyRow = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 5;
        cell.className = "ai-read-empty";
        cell.textContent = "No tickers match this view.";
        emptyRow.appendChild(cell);
        aiReadAuditCurrentListEl.appendChild(emptyRow);
      } else {
        for (const row of filteredRows) {
          const tableRow = document.createElement("tr");
          const tickerCell = document.createElement("td");
          const tickerButton = document.createElement("button");
          tickerButton.className = "ai-read-ticker-button";
          tickerButton.type = "button";
          tickerButton.dataset.aiReadSymbol = row.symbol;
          tickerButton.textContent = row.symbol;
          tickerCell.appendChild(tickerButton);
          const tickerDetail = document.createElement("div");
          tickerDetail.className = "ai-read-row-detail";
          tickerDetail.textContent = row.current?.active === false ? "Inactive" : "Active";
          tickerCell.appendChild(tickerDetail);
          const stateCell = document.createElement("td");
          const state = document.createElement("span");
          state.className = auditStatusClass(row.state);
          state.textContent = auditStatusLabel(row.state);
          stateCell.appendChild(state);
          const lastReadCell = document.createElement("td");
          lastReadCell.textContent = row.current?.lastReadGeneratedAt ? formatTime(row.current.lastReadGeneratedAt) : "None";
          const outcomeCell = document.createElement("td");
          outcomeCell.textContent = row.latestEvent ? auditStatusLabel(row.latestEvent.outcome) + " / " + auditStatusLabel(row.latestEvent.stage) : "None";
          const reasonCell = document.createElement("td");
          reasonCell.textContent = row.reason;
          tableRow.appendChild(tickerCell);
          tableRow.appendChild(stateCell);
          tableRow.appendChild(lastReadCell);
          tableRow.appendChild(outcomeCell);
          tableRow.appendChild(reasonCell);
          aiReadAuditCurrentListEl.appendChild(tableRow);
        }
      }
      renderAiReadDetail();
    }

    async function loadAiReadAudit() {
      const symbol = String(aiReadAuditSymbolEl.value || "").trim().toUpperCase();
      const query = symbol ? "?symbol=" + encodeURIComponent(symbol) + "&limit=150" : "?limit=150";
      const payload = await fetchJson("/api/runtime/ai-read-audit" + query);
      renderAiReadAudit(payload);
    }

    function renderAutoSelectorControl(status) {
      const selector = status.autoWatchlistSelector || {};
      const thresholds = selector.thresholds || {};
      autoSelectorEnabled = selector.enabled === true;
      autoSelectorEnabledToggleEl.checked = autoSelectorEnabled;
      autoSelectorEnabledToggleEl.disabled = autoSelectorRequestInFlight;
      autoSelectorEnabledLabelEl.textContent = autoSelectorEnabled ? "On" : "Off";
      autoSelectorApplyButtonEl.disabled = autoSelectorRequestInFlight || !autoSelectorSettingsDirty;
      autoSelectorApplyButtonEl.textContent = autoSelectorRequestInFlight
        ? "Saving..."
        : autoSelectorSettingsDirty
          ? "Apply Selection Settings"
          : "Settings Saved";
      autoSelectorPreviewButtonEl.disabled = autoSelectorRequestInFlight || selector.running === true;

      if (!autoSelectorSettingsDirty) {
        setAutoSelectorInputValue(
          "mainVacancyMinQualificationScore",
          thresholds.mainVacancyMinQualificationScore,
        );
        setAutoSelectorInputValue(
          "postmarketMinQualificationScore",
          thresholds.postmarketMinQualificationScore,
        );
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
        setAutoSelectorInputValue("minPostmarketVolume", thresholds.minPostmarketVolume);
        setAutoSelectorInputValue("minPostmarketDollarVolume", thresholds.minPostmarketDollarVolume);
        setAutoSelectorInputValue("consecutivePassesRequired", thresholds.consecutivePassesRequired);
        setAutoSelectorInputValue("maxActiveMainSessionTickers", thresholds.maxActiveMainSessionTickers);
        setAutoSelectorInputValue("maxActivePostmarketTickers", thresholds.maxActivePostmarketTickers);
        setAutoSelectorInputValue("maxAddsPerTradingDay", thresholds.maxAddsPerTradingDay);
        setAutoSelectorInputValue("maxPostmarketAddsPerTradingDay", thresholds.maxPostmarketAddsPerTradingDay);
        setAutoSelectorInputValue("maxMainSessionReplacementsPerTradingDay", thresholds.maxMainSessionReplacementsPerTradingDay);
        setAutoSelectorInputValue("maxPostmarketReplacementsPerTradingDay", thresholds.maxPostmarketReplacementsPerTradingDay);
        setAutoSelectorInputValue("maxPostmarketExtremeRunnerOverridesPerTradingDay", thresholds.maxPostmarketExtremeRunnerOverridesPerTradingDay);
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
        setAutoSelectorInputValue("zeroRecentVolumeRetentionGraceMinutes", thresholds.zeroRecentVolumeRetentionGraceMinutes);
        setAutoSelectorInputValue("extendedSessionCandidateLimit", thresholds.extendedSessionCandidateLimit);
        setAutoSelectorInputValue("catalystRankingEnabled", thresholds.catalystRankingEnabled);
        setAutoSelectorInputValue("catalystLookbackDays", thresholds.catalystLookbackDays);
        setAutoSelectorInputValue("catalystSameDayRankBoost", thresholds.catalystSameDayRankBoost);
        setAutoSelectorInputValue("catalystDailyRankDecay", thresholds.catalystDailyRankDecay);
        setAutoSelectorInputValue("recentDollarVolumeRankMaxBoost", thresholds.recentDollarVolumeRankMaxBoost);
        setAutoSelectorInputValue("recentDollarVolumeRankFullScore", thresholds.recentDollarVolumeRankFullScore);
        setAutoSelectorInputValue("volumeAccelerationRankMaxBoost", thresholds.volumeAccelerationRankMaxBoost);
        setAutoSelectorInputValue("volumeAccelerationRankFullScoreRatio", thresholds.volumeAccelerationRankFullScoreRatio);
        setAutoSelectorInputValue("volumeDecelerationRankMaxPenalty", thresholds.volumeDecelerationRankMaxPenalty);
        setAutoSelectorInputValue("volumeDecelerationRankFullPenaltyRatio", thresholds.volumeDecelerationRankFullPenaltyRatio);
        setAutoSelectorInputValue("topGainerQualificationScoreBoost", thresholds.topGainerQualificationScoreBoost);
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
      if (Number.isFinite(selector.postmarketExtremeRunnerOverridesAvailable)) {
        pieces.push(
          "Post-market extreme-runner override: " +
          String(selector.postmarketExtremeRunnerOverridesAvailable) + " available, " +
          String(selector.postmarketExtremeRunnerOverridesUsed || 0) + " used.",
        );
      }
      if (Array.isArray(selector.activeMainSessionSymbols)) {
        const activeEntries = new Map((selector.managedEntries || []).map((entry) => [entry.symbol, entry]));
        pieces.push("Active main auto slots: " + (selector.activeMainSessionSymbols
          .map((symbol) => {
            const entry = activeEntries.get(symbol);
            const scores = [];
            if (Number.isFinite(entry?.lastSlotSurvivalScore)) scores.push("slot " + entry.lastSlotSurvivalScore);
            if (Number.isFinite(entry?.admissionRankingScore)) scores.push("admitted rank " + entry.admissionRankingScore);
            return symbol + (scores.length ? " (" + scores.join("; ") + ")" : "");
          })
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
      if (selector.lastTradingHaltLookupError) {
        pieces.push("Nasdaq halt lookup: " + selector.lastTradingHaltLookupError + ".");
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
      const managedBySymbol = new Map((selector.managedEntries || []).map((entry) => [entry.symbol, entry]));
      for (const decision of (selector.recentDecisions || [])) {
        const item = document.createElement("li");
        const title = document.createElement("strong");
        title.textContent = decision.symbol + " — qualification " + decision.score + " — live rank " + decision.rankingScore + " — current slot " + decision.slotSurvivalScore + (
          decision.qualified
            ? decision.promotionReady === false
              ? " — qualifies, promotion held"
              : " — qualifies, promotion-ready"
            : decision.haltRetentionProtected
              ? " — confirmed halt, retention protected"
              : " — rejected"
        );
        const detail = document.createElement("div");
        detail.className = "activity-detail";
        const managed = managedBySymbol.get(decision.symbol);
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
          ...(Number.isFinite(managed?.admissionRankingScore)
            ? [
                "admitted at qualification " + managed.admissionQualificationScore +
                ", rank " + managed.admissionRankingScore +
                ", slot " + managed.admissionSlotSurvivalScore,
              ]
            : []),
          ...(Number.isFinite(managed?.holdProtectionEarnedAt)
            ? ["30-minute hold earned: " + (managed.holdProtectionReason || "repeat qualification")]
            : managed?.state === "active"
              ? ["30-minute hold not earned yet"]
              : []),
          ...(decision.slotSurvivalReasons || []),
          ...(decision.tradingHaltState === "halted"
            ? ["Nasdaq-confirmed trading halt" + (decision.tradingHaltReasonCode ? " (" + decision.tradingHaltReasonCode + ")" : "")]
            : []),
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
          : decision.haltRetentionProtected
            ? [decision.haltRetentionProtectionReason, ...(decision.rejectionReasons || [])].filter(Boolean)
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
      if (config.publicWatchlistUrl) {
        openLiveWatchlistLinkEl.href = config.publicWatchlistUrl;
      }
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
      renderReversalWatchlistVisibilityControl(status);
      renderTopRegularWatchlistVisibilityControl(status);
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
        ["Reversal Watchlist", health.reversalWatchlistVisible === false ? "hidden" : "visible"],
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

    async function activateEntry(symbol, note, retry, watchlistGroup) {
      try {
        const response = await fetch("/api/watchlist/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol,
            note,
            watchlistGroup: watchlistGroup || "main",
          }),
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
      } catch (error) {
        setStatus("Activation request failed: " + String(error), true);
        return false;
      }
    }

    async function postEntryAction(path, symbol, successPrefix) {
      try {
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
      } catch (error) {
        setStatus("Action request failed for " + symbol + ": " + String(error), true);
        return false;
      }
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

    function entryWatchlistGroup(entry) {
      if (
        entry.watchlistGroup === "top_regular" ||
        entry.watchlistGroup === "main" ||
        entry.watchlistGroup === "postmarket"
      ) {
        return entry.watchlistGroup;
      }
      if (Array.isArray(entry.tags) && entry.tags.includes("auto-postmarket")) {
        return "postmarket";
      }
      if (Number.isFinite(entry.activatedAt)) {
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            hour: "2-digit",
            hourCycle: "h23",
          }).formatToParts(new Date(entry.activatedAt)).map((part) => [part.type, part.value]),
        );
        const hour = Number(parts.hour);
        if (hour >= 16 && hour < 20) return "postmarket";
      }
      return "main";
    }

    function renderEntries(entries) {
      for (const list of Object.values(listEls)) {
        list.innerHTML = "";
      }

      for (const entry of entries) {
        const listEl = listEls[entryWatchlistGroup(entry)];
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
            try {
              await postEntryAction("/api/watchlist/repost-snapshot", entry.symbol, "Reposted snapshot for");
            } finally {
              repostButton.disabled = false;
            }
          });
          actions.appendChild(repostButton);

          const refreshButton = document.createElement("button");
          refreshButton.textContent = "Refresh Levels";
          refreshButton.className = "secondary";
          refreshButton.addEventListener("click", async () => {
            refreshButton.disabled = true;
            try {
              await postEntryAction("/api/watchlist/refresh-levels", entry.symbol, "Refreshed levels for");
            } finally {
              refreshButton.disabled = false;
            }
          });
          actions.appendChild(refreshButton);

          const aiRefreshButton = document.createElement("button");
          aiRefreshButton.textContent = "Refresh AI Read";
          aiRefreshButton.className = "secondary";
          aiRefreshButton.disabled = aiReadConfigured === false || !aiReadGenerationAllowed;
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
                await loadEntries();
                await loadRuntimeStatus();
                return;
              }
              setStatus(payload.generated
                ? "Published a fresh TradersLink AI Read for " + entry.symbol + "."
                : payload.failure?.reason
                  ? "AI Read was not published for " + entry.symbol + ": " + payload.failure.reason
                  : "No AI Read was published for " + entry.symbol + ". Check the ticker row for the reason.",
                !payload.generated);
              await loadEntries();
              await loadRuntimeStatus();
            } catch (error) {
              setStatus(String(error), true);
            } finally {
              aiRefreshButton.disabled = aiReadConfigured === false || !aiReadGenerationAllowed;
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
            const started = await activateEntry(
              entry.symbol,
              entry.note,
              true,
              entryWatchlistGroup(entry),
            );
            if (started) {
              await loadEntries();
              await loadRuntimeStatus();
            }
          });
          actions.appendChild(retryButton);
        }

        if (
          entry.lifecycle === "active" ||
          entry.lifecycle === "refresh_pending" ||
          entry.lifecycle === "extension_pending"
        ) {
          const moveSelect = document.createElement("select");
          moveSelect.setAttribute("aria-label", "Move " + entry.symbol + " to watchlist");
          const currentGroup = entryWatchlistGroup(entry);
          for (const [value, label] of [
            ["top_regular", "Top Regular Hour Watches"],
            ["main", "Main Session"],
            ["postmarket", "Post-Market"],
          ]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            option.selected = value === currentGroup;
            moveSelect.appendChild(option);
          }
          const moveButton = document.createElement("button");
          moveButton.textContent = "Move to List";
          moveButton.className = "secondary";
          moveButton.addEventListener("click", async () => {
            moveButton.disabled = true;
            moveSelect.disabled = true;
            try {
              const response = await fetch("/api/watchlist/move-to-list", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  symbol: entry.symbol,
                  watchlistGroup: moveSelect.value,
                }),
              });
              const payload = await response.json();
              if (!response.ok) {
                setStatus(payload.error || "Move to list failed", true);
                return;
              }
              setStatus(
                "Moved " + payload.entry.symbol + " to " +
                moveSelect.options[moveSelect.selectedIndex].text +
                " without deactivating it.",
              );
              await loadEntries();
              await loadRuntimeStatus();
            } catch (error) {
              setStatus("Move request failed for " + entry.symbol + ": " + String(error), true);
            } finally {
              moveButton.disabled = false;
              moveSelect.disabled = false;
            }
          });
          actions.appendChild(moveSelect);
          actions.appendChild(moveButton);
        }

        const removeFromListButton = document.createElement("button");
        removeFromListButton.textContent = "Remove from List";
        removeFromListButton.className = "secondary";
        removeFromListButton.addEventListener("click", async () => {
          removeFromListButton.disabled = true;
          try {
            await postEntryAction(
              "/api/watchlist/remove-from-list",
              entry.symbol,
              "Removed from list:",
            );
          } finally {
            removeFromListButton.disabled = false;
          }
        });
        actions.appendChild(removeFromListButton);

        const deactivateButton = document.createElement("button");
        deactivateButton.textContent = entry.lifecycle === "activating" ? "Cancel" : "Deactivate";
        deactivateButton.className = "danger";
        deactivateButton.addEventListener("click", async () => {
          deactivateButton.disabled = true;
          try {
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
          } catch (error) {
            setStatus("Deactivate request failed for " + entry.symbol + ": " + String(error), true);
          } finally {
            deactivateButton.disabled = false;
          }
        });
        actions.appendChild(deactivateButton);

        item.appendChild(meta);
        item.appendChild(actions);
        listEl.appendChild(item);
      }

      const emptyLabels = {
        top_regular: "No Top Regular Hour Watches are active.",
        main: "No Main Session tickers are active.",
        postmarket: "No Post-Market tickers are active.",
      };
      for (const [group, list] of Object.entries(listEls)) {
        if (list.childElementCount === 0) {
          const empty = document.createElement("li");
          empty.textContent = emptyLabels[group];
          list.appendChild(empty);
        }
      }
    }

    async function fetchJson(url) {
      const response = await fetch(url);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Request failed with HTTP " + response.status + ".");
      }
      return payload;
    }

    async function loadEntries() {
      const payload = await fetchJson("/api/watchlist");
      renderEntries(payload.activeEntries || []);
    }

    let lastRuntimeDetailsLoadedAt = 0;

    async function loadRuntimeStatus(includeDetails = false) {
      const payload = await fetchJson("/api/runtime/status" + (includeDetails ? "" : "?compact=1"));
      setRuntimeStatusHydrated(true);
      renderRuntimeStatus(payload);
      if (includeDetails) {
        renderRuntimeConfig(payload);
        lastRuntimeDetailsLoadedAt = Date.now();
      }
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
        await loadRuntimeStatus(true);
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        clearDiscordButtonEl.disabled = false;
      }
    }

    async function deactivateTickerGroup(scope, label) {
      const confirmed = window.confirm(
        "Clear " + label + " from the admin and public watchlist? Pending activations and existing selector scores/pass evidence for these tickers will be reset. Discord posts and threads will be kept. A ticker can return only after fresh discovery and fresh qualifying scans."
      );
      if (!confirmed) {
        return;
      }

      const bulkButtons = [
        removeAllTickersButtonEl,
        removeTopRegularTickersButtonEl,
        removeMainTickersButtonEl,
        removePostmarketTickersButtonEl,
        removeReversalTickersButtonEl,
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
          "Cleared " + payload.deactivatedCount + " " +
          (payload.deactivatedCount === 1 ? "ticker" : "tickers") +
          (symbols.length ? " (" + symbols.join(", ") + ")." : ".") +
          " Discord posts and threads were kept."
        );
        await loadEntries();
        await loadRuntimeStatus(true);
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

    async function applyReversalWatchlistVisibilitySelection() {
      const requestedVisible = reversalWatchlistVisibleToggleEl.checked;
      if (requestedVisible === reversalWatchlistVisible) {
        renderReversalWatchlistVisibilityControl({
          runtimeHealth: { reversalWatchlistVisible },
        });
        return;
      }

      reversalWatchlistVisibilityInFlight = true;
      renderReversalWatchlistVisibilityControl(
        { runtimeHealth: { reversalWatchlistVisible: requestedVisible } },
        { keepPreviousState: true },
      );
      setStatus((requestedVisible ? "Showing" : "Hiding") + " the Potential Reversal Watchlist...");
      try {
        const response = await fetch("/api/runtime/reversal-watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visible: requestedVisible }),
        });
        const payload = await response.json();
        if (!response.ok) {
          reversalWatchlistVisibleToggleEl.checked = reversalWatchlistVisible;
          setStatus(payload.error || "Potential Reversal Watchlist visibility change failed", true);
          return;
        }

        reversalWatchlistVisible = payload.visible !== false;
        setStatus(
          (reversalWatchlistVisible ? "Potential Reversal Watchlist visible" : "Potential Reversal Watchlist hidden") +
            " on /watchlist. Refreshed " +
            String(payload.refreshedSymbolCount || 0) +
            " active ticker records.",
        );
        await loadRuntimeStatus();
      } catch (error) {
        reversalWatchlistVisibleToggleEl.checked = reversalWatchlistVisible;
        setStatus(String(error), true);
      } finally {
        reversalWatchlistVisibilityInFlight = false;
        renderReversalWatchlistVisibilityControl({
          runtimeHealth: { reversalWatchlistVisible },
        });
      }
    }

    async function applyTopRegularWatchlistVisibilitySelection() {
      const requestedVisible = topRegularWatchlistVisibleToggleEl.checked;
      topRegularWatchlistVisibilityInFlight = true;
      renderTopRegularWatchlistVisibilityControl(
        { runtimeHealth: { topRegularWatchlistVisible: requestedVisible } },
        { keepPreviousState: true },
      );
      setStatus((requestedVisible ? "Showing" : "Hiding") + " Top Regular Hour Watches...");
      try {
        const response = await fetch("/api/runtime/top-regular-watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visible: requestedVisible }),
        });
        const payload = await response.json();
        if (!response.ok) {
          topRegularWatchlistVisibleToggleEl.checked = topRegularWatchlistVisible;
          setStatus(payload.error || "Top Regular Hour Watches visibility change failed", true);
          return;
        }
        topRegularWatchlistVisible = payload.visible !== false;
        setStatus(
          "Top Regular Hour Watches " +
            (topRegularWatchlistVisible ? "visible" : "hidden") +
            " on /watchlist.",
        );
        await loadRuntimeStatus();
      } catch (error) {
        topRegularWatchlistVisibleToggleEl.checked = topRegularWatchlistVisible;
        setStatus(String(error), true);
      } finally {
        topRegularWatchlistVisibilityInFlight = false;
        renderTopRegularWatchlistVisibilityControl({
          runtimeHealth: { topRegularWatchlistVisible },
        });
      }
    }

    async function applyAiReadGenerationSelection() {
      const requested = {
        enabled: aiReadGenerationToggleEl.checked,
        premarketEnabled: aiReadPremarketToggleEl.checked,
        regularEnabled: aiReadRegularToggleEl.checked,
        postmarketEnabled: aiReadPostmarketToggleEl.checked,
        topRegularActivationEnabled: aiReadTopRegularActivationToggleEl.checked,
      };
      aiReadGenerationInFlight = true;
      setStatus("Saving AI Read generation controls...");
      try {
        const response = await fetch("/api/runtime/ai-read-generation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requested),
        });
        const payload = await response.json();
        if (!response.ok) {
          setStatus(payload.error || "AI Read generation controls update failed", true);
          return;
        }
        aiReadGenerationSettings = payload.settings;
        setStatus(
          aiReadGenerationSettings.enabled
            ? "AI Read generation controls saved."
            : "AI Read generation is off. No OpenAI AI Read requests can start.",
        );
        await loadRuntimeStatus();
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        aiReadGenerationInFlight = false;
        aiReadGenerationToggleEl.checked = aiReadGenerationSettings.enabled;
        aiReadPremarketToggleEl.checked = aiReadGenerationSettings.premarketEnabled;
        aiReadRegularToggleEl.checked = aiReadGenerationSettings.regularEnabled;
        aiReadPostmarketToggleEl.checked = aiReadGenerationSettings.postmarketEnabled;
        aiReadTopRegularActivationToggleEl.checked =
          aiReadGenerationSettings.topRegularActivationEnabled;
        aiReadGenerationToggleEl.disabled = aiReadConfigured === false;
        aiReadPremarketToggleEl.disabled =
          aiReadConfigured === false || !aiReadGenerationSettings.enabled;
        aiReadRegularToggleEl.disabled =
          aiReadConfigured === false || !aiReadGenerationSettings.enabled;
        aiReadPostmarketToggleEl.disabled =
          aiReadConfigured === false || !aiReadGenerationSettings.enabled;
        aiReadTopRegularActivationToggleEl.disabled =
          aiReadConfigured === false || !aiReadGenerationSettings.enabled;
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

    async function applyAiReadModel() {
      aiReadModelApplyEl.disabled = true;
      setStatus("Saving AI Read model and effort...");
      try {
        const response = await fetch("/api/runtime/ai-read-model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: aiReadModelSelectEl.value,
            reasoningEffort: aiReadReasoningEffortSelectEl.value,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setStatus(payload.error || "AI Read model update failed.", true);
          return;
        }
        setStatus(
          "AI Reads now use " +
            (payload.model === "gpt-5.6-luna" ? "Luna" : "Terra") +
            " at " + payload.reasoningEffort + " effort.",
        );
        await loadRuntimeStatus();
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        aiReadModelApplyEl.disabled = !aiReadConfigured;
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
        mainVacancyMinQualificationScore: Math.round(readAutoSelectorNumber("mainVacancyMinQualificationScore")),
        postmarketMinQualificationScore: Math.round(readAutoSelectorNumber("postmarketMinQualificationScore")),
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
        minPostmarketVolume: Math.round(readAutoSelectorNumber("minPostmarketVolume")),
        minPostmarketDollarVolume: Math.round(readAutoSelectorNumber("minPostmarketDollarVolume")),
        consecutivePassesRequired: Math.round(readAutoSelectorNumber("consecutivePassesRequired")),
        maxActiveMainSessionTickers: Math.round(readAutoSelectorNumber("maxActiveMainSessionTickers")),
        maxActivePostmarketTickers: Math.round(readAutoSelectorNumber("maxActivePostmarketTickers")),
        maxAddsPerTradingDay: Math.round(readAutoSelectorNumber("maxAddsPerTradingDay")),
        maxPostmarketAddsPerTradingDay: Math.round(readAutoSelectorNumber("maxPostmarketAddsPerTradingDay")),
        maxMainSessionReplacementsPerTradingDay: Math.round(readAutoSelectorNumber("maxMainSessionReplacementsPerTradingDay")),
        maxPostmarketReplacementsPerTradingDay: Math.round(readAutoSelectorNumber("maxPostmarketReplacementsPerTradingDay")),
        maxPostmarketExtremeRunnerOverridesPerTradingDay: Math.round(readAutoSelectorNumber("maxPostmarketExtremeRunnerOverridesPerTradingDay")),
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
        zeroRecentVolumeRetentionGraceMinutes: Math.round(readAutoSelectorNumber("zeroRecentVolumeRetentionGraceMinutes")),
        extendedSessionCandidateLimit: Math.round(readAutoSelectorNumber("extendedSessionCandidateLimit")),
        catalystRankingEnabled: autoSelectorInputEls.catalystRankingEnabled.checked,
        catalystLookbackDays: Math.round(readAutoSelectorNumber("catalystLookbackDays")),
        catalystSameDayRankBoost: Math.round(readAutoSelectorNumber("catalystSameDayRankBoost")),
        catalystDailyRankDecay: Math.round(readAutoSelectorNumber("catalystDailyRankDecay")),
        recentDollarVolumeRankMaxBoost: Math.round(readAutoSelectorNumber("recentDollarVolumeRankMaxBoost")),
        recentDollarVolumeRankFullScore: Math.round(readAutoSelectorNumber("recentDollarVolumeRankFullScore")),
        volumeAccelerationRankMaxBoost: Math.round(readAutoSelectorNumber("volumeAccelerationRankMaxBoost")),
        volumeAccelerationRankFullScoreRatio: readAutoSelectorNumber("volumeAccelerationRankFullScoreRatio"),
        volumeDecelerationRankMaxPenalty: Math.round(readAutoSelectorNumber("volumeDecelerationRankMaxPenalty")),
        volumeDecelerationRankFullPenaltyRatio: readAutoSelectorNumber("volumeDecelerationRankFullPenaltyRatio"),
        topGainerQualificationScoreBoost: Math.round(readAutoSelectorNumber("topGainerQualificationScoreBoost")),
        shareTurnoverRankMaxBoost: Math.round(readAutoSelectorNumber("shareTurnoverRankMaxBoost")),
        shareTurnoverRankFullScorePct: Math.round(readAutoSelectorNumber("shareTurnoverRankFullScorePct")),
      };
    }

    async function updateAutoSelector(payload, progressMessage) {
      autoSelectorRequestInFlight = true;
      autoSelectorEnabledToggleEl.disabled = true;
      autoSelectorApplyButtonEl.disabled = true;
      autoSelectorApplyButtonEl.dataset.loading = "true";
      autoSelectorApplyButtonEl.setAttribute("aria-busy", "true");
      autoSelectorApplyButtonEl.textContent = "Saving...";
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
        delete autoSelectorApplyButtonEl.dataset.loading;
        autoSelectorApplyButtonEl.setAttribute("aria-busy", "false");
        autoSelectorApplyButtonEl.textContent = autoSelectorSettingsDirty
          ? "Apply Selection Settings"
          : "Settings Saved";
        autoSelectorApplyButtonEl.disabled = !autoSelectorSettingsDirty;
        autoSelectorPreviewButtonEl.disabled = false;
      }
    }

    async function applyAiReadBoundaryRefreshes() {
      const limit = Number(aiReadBoundaryRefreshesLimitEl.value);
      if (!Number.isInteger(limit) || limit < 0 || limit > 1000) {
        setStatus("Automatic boundary refreshes must be a whole number between 0 and 1,000.", true);
        return;
      }
      aiReadBoundaryRefreshesInFlight = true;
      aiReadBoundaryRefreshesToggleEl.disabled = true;
      aiReadBoundaryRefreshesLimitEl.disabled = true;
      aiReadBoundaryRefreshesApplyEl.disabled = true;
      setStatus("Saving automatic boundary refresh controls...");
      try {
        const response = await fetch("/api/runtime/ai-read-boundary-refreshes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: aiReadBoundaryRefreshesToggleEl.checked,
            maxPerTickerPerNewYorkDate: limit,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setStatus(payload.error || "Automatic boundary refresh update failed", true);
          return;
        }
        aiReadBoundaryRefreshesEnabled = payload.settings?.enabled === true;
        aiReadBoundaryRefreshesLimitEl.value = String(
          payload.settings?.maxPerTickerPerNewYorkDate ?? limit,
        );
        setStatus(
          aiReadBoundaryRefreshesEnabled
            ? "Automatic boundary refreshes enabled."
            : "Automatic boundary refreshes disabled.",
        );
        await loadRuntimeStatus();
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        aiReadBoundaryRefreshesInFlight = false;
        renderAiReadControls({
          aiReadConfigured,
          runtimeHealth: {
            tradersLinkAiReadBoundaryRefreshSettings: {
              enabled: aiReadBoundaryRefreshesEnabled,
              maxPerTickerPerNewYorkDate: Number(aiReadBoundaryRefreshesLimitEl.value) || 0,
            },
          },
        });
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
      activateButtonEl.disabled = true;
      try {
        const started = await activateEntry(
          symbolEl.value,
          noteEl.value,
          false,
          watchlistGroupEl.value,
        );
        if (!started) {
          return;
        }
        symbolEl.value = "";
        noteEl.value = "";
        await loadEntries();
        await loadRuntimeStatus(true);
      } catch (error) {
        setStatus("Activation refresh failed: " + String(error), true);
      } finally {
        activateButtonEl.disabled = false;
      }
    });
    clearDiscordButtonEl.addEventListener("click", clearDiscordPosts);
    removeAllTickersButtonEl.addEventListener("click", () => deactivateTickerGroup("all", "all watchlists"));
    removeTopRegularTickersButtonEl.addEventListener("click", () => deactivateTickerGroup("top_regular", "Top Regular Hour Watches"));
    removeMainTickersButtonEl.addEventListener("click", () => deactivateTickerGroup("main", "Main Session"));
    removePostmarketTickersButtonEl.addEventListener("click", () => deactivateTickerGroup("postmarket", "Post-Market"));
    removeReversalTickersButtonEl.addEventListener("click", () => deactivateTickerGroup("reversal", "Potential Reversal Watchlist"));
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
    reversalWatchlistVisibleToggleEl.addEventListener("change", applyReversalWatchlistVisibilitySelection);
    topRegularWatchlistVisibleToggleEl.addEventListener("change", applyTopRegularWatchlistVisibilitySelection);
    aiReadGenerationToggleEl.addEventListener("change", applyAiReadGenerationSelection);
    aiReadModelApplyEl.addEventListener("click", applyAiReadModel);
    aiReadPremarketToggleEl.addEventListener("change", applyAiReadGenerationSelection);
    aiReadRegularToggleEl.addEventListener("change", applyAiReadGenerationSelection);
    aiReadPostmarketToggleEl.addEventListener("change", applyAiReadGenerationSelection);
    aiReadTopRegularActivationToggleEl.addEventListener("change", applyAiReadGenerationSelection);
    aiReadExternalResearchToggleEl.addEventListener("change", applyAiReadExternalResearchSelection);
    aiReadCostBudgetToggleEl.addEventListener("change", applyAiReadCostBudget);
    aiReadCostBudgetApplyEl.addEventListener("click", applyAiReadCostBudget);
    aiReadBoundaryRefreshesToggleEl.addEventListener("change", applyAiReadBoundaryRefreshes);
    aiReadBoundaryRefreshesApplyEl.addEventListener("click", applyAiReadBoundaryRefreshes);
    aiReadCostPeriodEl.addEventListener("change", () => {
      aiReadCostPeriod = String(aiReadCostPeriodEl.value || "today");
      void loadRuntimeStatus(true).catch((error) => setStatus(String(error), true));
    });
    aiReadAuditStatusFilterEl.addEventListener("change", () => renderAiReadAudit(aiReadAuditPayload));
    aiReadAuditCurrentListEl.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-ai-read-symbol]") : null;
      if (!target) return;
      aiReadAuditSelectedSymbol = target.dataset.aiReadSymbol || null;
      renderAiReadDetail();
    });
    aiReadDetailCloseEl.addEventListener("click", () => {
      aiReadAuditSelectedSymbol = null;
      aiReadDetailEl.hidden = true;
    });
    aiReadAuditRefreshEl.addEventListener("click", async () => {
      aiReadAuditRefreshEl.disabled = true;
      try {
        await loadAiReadAudit();
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        aiReadAuditRefreshEl.disabled = false;
      }
    });
    aiReadAuditSymbolEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void aiReadAuditRefreshEl.click();
      }
    });
    autoSelectorEnabledToggleEl.addEventListener("change", applyAutoSelectorToggle);
    autoSelectorApplyButtonEl.addEventListener("click", applyAutoSelectorSettings);
    autoSelectorPreviewButtonEl.addEventListener("click", previewAutoSelector);
    for (const input of Object.values(autoSelectorInputEls)) {
      input.addEventListener("input", () => {
        autoSelectorSettingsDirty = true;
        autoSelectorApplyButtonEl.textContent = "Apply Selection Settings";
        autoSelectorApplyButtonEl.disabled = autoSelectorRequestInFlight;
      });
      input.addEventListener("change", () => {
        autoSelectorSettingsDirty = true;
        autoSelectorApplyButtonEl.textContent = "Apply Selection Settings";
        autoSelectorApplyButtonEl.disabled = autoSelectorRequestInFlight;
      });
    }

    async function refreshDashboard() {
      if (dashboardRefreshTimer !== null) {
        clearTimeout(dashboardRefreshTimer);
        dashboardRefreshTimer = null;
      }
      if (document.hidden) {
        return;
      }
      try {
        const includeDetails = Date.now() - lastRuntimeDetailsLoadedAt >= RUNTIME_DETAILS_REFRESH_INTERVAL_MS;
        await Promise.all([loadEntries(), loadRuntimeStatus(includeDetails)]);
      } catch (error) {
        setStatus(String(error), true);
      } finally {
        dashboardRefreshTimer = setTimeout(refreshDashboard, DASHBOARD_REFRESH_INTERVAL_MS);
      }
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        void refreshDashboard();
      }
    });
    void loadAiReadAudit().catch((error) => setStatus(String(error), true));
    void refreshDashboard();
  </script>
</body>
</html>
`;
