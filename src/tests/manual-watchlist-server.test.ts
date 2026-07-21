import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";
import type { IncomingMessage } from "node:http";

import {
  MAX_JSON_BODY_BYTES,
  RequestBodyParseError,
  readJsonBody,
} from "../runtime/manual-watchlist-http.js";
import { AI_CLEAN_READ_PAGE } from "../runtime/ai-clean-read-page.js";
import { MANUAL_WATCHLIST_PAGE } from "../runtime/manual-watchlist-page.js";
import { TRADE_PLAN_REVIEW_PAGE } from "../runtime/trade-plan-review-page.js";

const MANUAL_WATCHLIST_SERVER_SOURCE = readFileSync(
  new URL("../runtime/manual-watchlist-server.ts", import.meta.url),
  "utf8",
);

function buildRequest(
  body: string,
  headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
  },
): IncomingMessage {
  const request = Readable.from(body.length > 0 ? [body] : []) as IncomingMessage;
  Object.assign(request, { headers });
  return request;
}

test("manual watchlist page builds entry metadata without innerHTML interpolation", () => {
  assert.match(MANUAL_WATCHLIST_PAGE, /title\.textContent = entry\.symbol;/);
  assert.match(MANUAL_WATCHLIST_PAGE, /appendMetaValue\(details, "OpenAI notes", entry\.note\);/);
  assert.doesNotMatch(MANUAL_WATCHLIST_PAGE, /meta\.innerHTML/);
});

test("manual watchlist page hydrates settings before enabling controls and avoids overlapping polls", () => {
  assert.doesNotMatch(MANUAL_WATCHLIST_PAGE, /<label for="symbol">npm run watchlist:manual<\/label>/);
  assert.match(MANUAL_WATCHLIST_PAGE, /let runtimeStatusHydrated = false/);
  assert.match(MANUAL_WATCHLIST_PAGE, /control\.disabled = !runtimeStatusHydrated/);
  assert.match(MANUAL_WATCHLIST_PAGE, /setRuntimeStatusHydrated\(false\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /setRuntimeStatusHydrated\(true\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /if \(!response\.ok\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /await Promise\.all\(\[loadEntries\(\), loadRuntimeStatus\(\), loadReviewArtifacts\(\)\]\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /setTimeout\(refreshDashboard, DASHBOARD_REFRESH_INTERVAL_MS\)/);
  assert.doesNotMatch(MANUAL_WATCHLIST_PAGE, /setInterval\(\(\) => \{\s+Promise\.all\(\[loadEntries/);
});

test("manual watchlist row actions recover their controls after request failures", () => {
  assert.match(MANUAL_WATCHLIST_PAGE, /Activation request failed:/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Action request failed for/);
  assert.match(
    MANUAL_WATCHLIST_PAGE,
    /repostButton\.disabled = true;\s+try \{[\s\S]*?finally \{\s+repostButton\.disabled = false;/,
  );
  assert.match(
    MANUAL_WATCHLIST_PAGE,
    /refreshButton\.disabled = true;\s+try \{[\s\S]*?finally \{\s+refreshButton\.disabled = false;/,
  );
  assert.match(
    MANUAL_WATCHLIST_PAGE,
    /deactivateButton\.disabled = true;[\s\S]*?finally \{\s+deactivateButton\.disabled = false;/,
  );
  assert.match(
    MANUAL_WATCHLIST_PAGE,
    /activateButtonEl\.disabled = true;[\s\S]*?finally \{\s+activateButtonEl\.disabled = false;/,
  );
});

test("manual watchlist page shows runtime status and separate review surfaces", () => {
  assert.match(MANUAL_WATCHLIST_PAGE, /Runtime Status/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Provider Health/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Runtime Config/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Historical Candle Provider/);
  assert.match(MANUAL_WATCHLIST_PAGE, /id="historical-provider-select"/);
  assert.match(MANUAL_WATCHLIST_PAGE, /id="apply-historical-provider-button"/);
  assert.match(MANUAL_WATCHLIST_PAGE, /\/api\/runtime\/historical-provider/);
  assert.match(MANUAL_WATCHLIST_PAGE, /renderHistoricalProviderControl/);
  assert.match(MANUAL_WATCHLIST_PAGE, /historicalProviderSelectEl\.addEventListener\("change"/);
  assert.match(MANUAL_WATCHLIST_PAGE, /providerSelectionDirty = true/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Live Price Provider/);
  assert.match(MANUAL_WATCHLIST_PAGE, /id="live-provider-select"/);
  assert.match(MANUAL_WATCHLIST_PAGE, /id="apply-live-provider-button"/);
  assert.match(MANUAL_WATCHLIST_PAGE, /\/api\/runtime\/live-provider/);
  assert.match(MANUAL_WATCHLIST_PAGE, /renderLiveProviderControl/);
  assert.match(MANUAL_WATCHLIST_PAGE, /liveProviderSelectEl\.addEventListener\("change"/);
  assert.match(MANUAL_WATCHLIST_PAGE, /liveProviderSelectionDirty = true/);
  assert.match(MANUAL_WATCHLIST_PAGE, /payload\.persisted === false/);
  assert.match(MANUAL_WATCHLIST_PAGE, /active tickers resubscribed/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Provider Config/);
  assert.match(MANUAL_WATCHLIST_PAGE, /saved for restart/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Review Artifacts/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Open AI Clean Read/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Notes to send to OpenAI \(optional\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /<textarea id="note" name="note"/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Open Trade Plan Review/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Monday Live Review/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Last Why Posted/);
  assert.match(MANUAL_WATCHLIST_PAGE, /symbol post budget/);
  assert.match(MANUAL_WATCHLIST_PAGE, /AI commentary can add separate AI read posts after deterministic alerts/);
  assert.match(MANUAL_WATCHLIST_PAGE, /manual-watchlist-operational\.log/);
  assert.match(MANUAL_WATCHLIST_PAGE, /manual-watchlist-diagnostics\.log/);
  assert.match(MANUAL_WATCHLIST_PAGE, /discord-delivery-audit\.jsonl/);
  assert.match(MANUAL_WATCHLIST_PAGE, /thread-summaries\.json/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Discord thread ID/);
  assert.match(MANUAL_WATCHLIST_PAGE, /fetchJson\("\/api\/runtime\/status"\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /fetchJson\("\/api\/runtime\/review-artifacts"\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /renderReviewArtifacts/);
  assert.match(MANUAL_WATCHLIST_PAGE, /renderMondayReview/);
  assert.match(MANUAL_WATCHLIST_PAGE, /renderProviderHealth/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Historical Data/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Pending Seeds/);
  assert.match(MANUAL_WATCHLIST_PAGE, /restart-readiness-list/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Seed Attempts/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Seed Timeouts/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Seeds In Flight/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Candle Cache/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Runtime Candle Cache/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Startup Cache/);
  assert.match(MANUAL_WATCHLIST_PAGE, /lastTradeStoryState/);
  assert.match(MANUAL_WATCHLIST_PAGE, /levels age/);
  assert.match(MANUAL_WATCHLIST_PAGE, /price age/);
  assert.match(MANUAL_WATCHLIST_PAGE, /artifact\.name/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Refresh Levels/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Repost Snapshot/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Copy Thread/);
  assert.match(MANUAL_WATCHLIST_PAGE, /\/api\/watchlist\/refresh-levels/);
  assert.match(MANUAL_WATCHLIST_PAGE, /\/api\/watchlist\/repost-snapshot/);
  assert.match(MANUAL_WATCHLIST_PAGE, /window\.open\("\/trade-plan-review", "trade-plan-review"\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /window\.open\("\/ai-clean-read", "ai-clean-read"\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /entry\.operationStatus/);
  assert.match(TRADE_PLAN_REVIEW_PAGE, /Support Must Hold/);
  assert.match(AI_CLEAN_READ_PAGE, /Generate Clean Read/);
  assert.match(AI_CLEAN_READ_PAGE, /Notes to send to OpenAI \(optional\)/);
  assert.match(AI_CLEAN_READ_PAGE, /Token usage will appear after generation/);
  assert.match(AI_CLEAN_READ_PAGE, /Recent usage:/);
  assert.match(AI_CLEAN_READ_PAGE, /These comments are not sent to OpenAI/);
  assert.match(AI_CLEAN_READ_PAGE, /\/api\/ai-clean-read\/generate/);
  assert.match(AI_CLEAN_READ_PAGE, /\/api\/ai-clean-read\/comments/);
  assert.match(AI_CLEAN_READ_PAGE, /Audit comments/);
  assert.match(AI_CLEAN_READ_PAGE, /AUTO_REFRESH_INTERVAL_MS = 4000/);
  assert.match(AI_CLEAN_READ_PAGE, /setInterval/);
  assert.match(AI_CLEAN_READ_PAGE, /forceLatest/);
  assert.match(AI_CLEAN_READ_PAGE, /button\.dataset\.recordId/);
  assert.match(AI_CLEAN_READ_PAGE, /Show clean read for/);
});

test("manual watchlist server exposes and persists historical and live provider selectors", () => {
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /MANUAL_WATCHLIST_HISTORICAL_PROVIDER_ENV = "LEVEL_HISTORICAL_CANDLE_PROVIDER"/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /MANUAL_WATCHLIST_LIVE_PRICE_PROVIDER_ENV = "LEVEL_LIVE_PRICE_PROVIDER"/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /MANUAL_WATCHLIST_PROVIDER_CONFIG_PATH_ENV = "LEVEL_MANUAL_PROVIDER_CONFIG_PATH"/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /loadRuntimeProviderConfig\(providerConfigPath\)/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /persistedProviderConfig\?\.historicalProvider/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /persistedProviderConfig\?\.liveProvider/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /availableHistoricalProviders: RUNTIME_HISTORICAL_PROVIDER_OPTIONS/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /availableLiveProviders: RUNTIME_LIVE_PROVIDER_OPTIONS/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /providerConfigPath/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /url\.pathname === "\/api\/runtime\/historical-provider"/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /saveRuntimeProviderConfig\(providerConfigPath, \{\s+historicalProvider: requestedProvider,\s+liveProvider: liveProviderName,/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /rawCandleService\.setProvider\(nextProvider\)/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /url\.pathname === "\/api\/runtime\/live-provider"/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /await manager\.switchLivePriceProvider\(nextProvider\)/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /persisted = false/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /Live provider switched but provider config save failed/);
});

test("manual watchlist server exposes Potential Gain website visibility controls", () => {
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /\/api\/runtime\/potential-gain-card/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /await manager\.setPotentialGainCardVisible\(body\.visible\)/);
});

test("manual watchlist admin adds TradersLink AI Read without replacing full controls", () => {
  assert.match(MANUAL_WATCHLIST_PAGE, /TradersLink AI Read/);
  assert.match(MANUAL_WATCHLIST_PAGE, /External Catalyst, SEC, and Web Research/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Refresh AI Read/);
  assert.match(MANUAL_WATCHLIST_PAGE, /AI confidence:/);
  assert.match(MANUAL_WATCHLIST_PAGE, /AI Card: Shown/);
  assert.match(MANUAL_WATCHLIST_PAGE, /ai-read-cost-grid/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Optional Daily AI Spend Guard/);
  assert.match(MANUAL_WATCHLIST_PAGE, /ai-read-cost-budget-toggle/);
  assert.match(MANUAL_WATCHLIST_PAGE, /summary\.todayPerTicker/);
  assert.match(MANUAL_WATCHLIST_PAGE, /No TradersLink AI Read API calls recorded today/);
  assert.doesNotMatch(MANUAL_WATCHLIST_PAGE, /perTicker\.slice\(0, 20\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Automatic Low-Float Selection/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Provider Health/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Review Artifacts/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /\/api\/runtime\/ai-read-external-research/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /\/api\/runtime\/ai-read-cost-budget/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /\/api\/watchlist\/ai-read-visibility/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /\/api\/watchlist\/ai-read-refresh/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /manager\.getTradersLinkAiReadCostSnapshot\(\)/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /selectorSessionActivity/);
  assert.match(MANUAL_WATCHLIST_PAGE, /formatShareVolume/);
  assert.match(MANUAL_WATCHLIST_PAGE, /session volume/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Watchlist Lifecycle Labels/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /\/api\/runtime\/watchlist-lifecycle-labels/);
});

test("legacy OpenAI routes are opt-in and remain separate from website TradersLink AI Read", () => {
  assert.match(
    MANUAL_WATCHLIST_SERVER_SOURCE,
    /LEGACY_OPENAI_FEATURES_ENV = "LEVEL_LEGACY_OPENAI_FEATURES_ENABLED"/,
  );
  assert.match(
    MANUAL_WATCHLIST_SERVER_SOURCE,
    /aiCommentaryEnabled = legacyOpenAiFeaturesEnabled && aiCommentaryRequested/,
  );
  assert.match(
    MANUAL_WATCHLIST_SERVER_SOURCE,
    /aiCleanReadService = legacyOpenAiFeaturesEnabled\s+\? createOpenAICleanReadServiceFromEnv\(\)\s+: null/,
  );
  assert.match(
    MANUAL_WATCHLIST_SERVER_SOURCE,
    /tradersLinkAiReadService = createTradersLinkAiReadServiceFromEnv\(\)/,
  );
  assert.doesNotMatch(
    MANUAL_WATCHLIST_SERVER_SOURCE,
    /legacyOpenAiFeaturesEnabled\s+\? createTradersLinkAiReadServiceFromEnv/,
  );
});

test("manual watchlist admin exposes persisted automatic low-float selection controls", () => {
  assert.match(MANUAL_WATCHLIST_PAGE, /Automatic Low-Float Selection/);
  assert.match(MANUAL_WATCHLIST_PAGE, /id="auto-selector-enabled-toggle"/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Maximum market cap \(\$M\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Maximum float \(M shares\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Maximum outstanding \(M shares\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /minimum dollar volume/i);
  assert.match(MANUAL_WATCHLIST_PAGE, /Consecutive passing scans/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Maximum active premarket\/regular auto tickers/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Maximum active post-market auto tickers/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Post-market minimum session volume/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Post-market minimum session dollar volume/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Late main-session admission reserve/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Late reserve unlock hour ET/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Initial main-session new-ticker quota per day/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Main-session automatic replacements per day/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Continuously replace faded auto tickers/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Allow obvious-runner fast replacement/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Failed scans before standby/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Catalyst lookback \(days\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Same-day catalyst rank boost/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Recent 15m activity maximum rank boost/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Volume acceleration maximum rank boost/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Volume deceleration maximum rank penalty/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Top-gainers qualification score boost/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Exact-zero recent-volume grace/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Confirmed halts freeze failed-retention counting/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Share turnover maximum rank boost/);
  assert.match(MANUAL_WATCHLIST_PAGE, /id="auto-selector-catalyst-ranking"/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Catalysts never bypass/);
  assert.match(MANUAL_WATCHLIST_PAGE, /live rank/);
  assert.match(MANUAL_WATCHLIST_PAGE, /admitted at qualification/);
  assert.match(MANUAL_WATCHLIST_PAGE, /confirmed halt, retention protected/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Allow premarket automatic additions/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Allow regular-hours automatic additions/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Allow post-market automatic additions/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Regular minimum last-15m dollar volume/);
  assert.match(MANUAL_WATCHLIST_PAGE, /outer safety window/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Run Preview Only/);
  assert.match(MANUAL_WATCHLIST_PAGE, /collectAutoSelectorThresholds/);
  assert.match(MANUAL_WATCHLIST_PAGE, /\/api\/runtime\/auto-watchlist-selector\/preview/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /new AutoWatchlistSelector/);
  assert.match(
    MANUAL_WATCHLIST_SERVER_SOURCE,
    /Object\.keys\(DEFAULT_AUTO_WATCHLIST_SELECTOR_CONFIG\)/,
  );
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /autoWatchlistSelector: autoWatchlistSelector\.getStatus\(\)/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /url\.pathname === "\/api\/runtime\/auto-watchlist-selector"/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /url\.pathname === "\/api\/runtime\/auto-watchlist-selector\/preview"/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /autoWatchlistSelector\.stop\(\)/);
});

test("manual watchlist admin exposes scoped bulk ticker removal without clearing Discord", () => {
  assert.match(MANUAL_WATCHLIST_PAGE, /id="remove-all-tickers-button"/);
  assert.match(MANUAL_WATCHLIST_PAGE, /id="remove-main-tickers-button"/);
  assert.match(MANUAL_WATCHLIST_PAGE, /id="remove-postmarket-tickers-button"/);
  assert.match(MANUAL_WATCHLIST_PAGE, /deactivateTickerGroup\("all", "all tickers"\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /deactivateTickerGroup\("main", "all Main Session tickers"\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /deactivateTickerGroup\("postmarket", "all Post-Market tickers"\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Discord posts and threads will be kept/);
  assert.match(MANUAL_WATCHLIST_PAGE, /\/api\/watchlist\/deactivate-bulk/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /url\.pathname === "\/api\/watchlist\/deactivate-bulk"/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /getWatchlistEntrySessionGroup\(entry\) === scope/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /await manager\.deactivateSymbols\(symbols\)/);
});

test("manual watchlist server uses a deeper default 4h lookback for EODHD", () => {
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /DEFAULT_EODHD_MANUAL_WATCHLIST_4H_LOOKBACK = 900/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /providerName === "eodhd"/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /"4h": DEFAULT_EODHD_MANUAL_WATCHLIST_4H_LOOKBACK/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /process\.env\[MANUAL_WATCHLIST_LOOKBACK_4H_ENV\],\s+defaults\["4h"\]/);
  assert.match(MANUAL_WATCHLIST_SERVER_SOURCE, /resolveManualWatchlistHistoricalLookbacks\(historicalProviderName\)/);
});

test("readJsonBody parses valid JSON requests", async () => {
  const body = await readJsonBody(buildRequest('{"symbol":"ALBT","note":"watch"}'));

  assert.deepEqual(body, {
    symbol: "ALBT",
    note: "watch",
  });
});

test("readJsonBody rejects non-json content types", async () => {
  await assert.rejects(
    readJsonBody(buildRequest('{"symbol":"ALBT"}', { "content-type": "text/plain" })),
    (error: unknown) =>
      error instanceof RequestBodyParseError &&
      error.statusCode === 415 &&
      error.message === "Content-Type must be application/json.",
  );
});

test("readJsonBody rejects invalid JSON bodies", async () => {
  await assert.rejects(
    readJsonBody(buildRequest('{"symbol":')),
    (error: unknown) =>
      error instanceof RequestBodyParseError &&
      error.statusCode === 400 &&
      error.message === "Invalid JSON body.",
  );
});

test("readJsonBody rejects oversized bodies", async () => {
  const oversizedNote = "x".repeat(MAX_JSON_BODY_BYTES);
  const request = buildRequest(
    JSON.stringify({ note: oversizedNote }),
    {
      "content-type": "application/json",
      "content-length": String(MAX_JSON_BODY_BYTES + 1),
    },
  );

  await assert.rejects(
    readJsonBody(request),
    (error: unknown) =>
      error instanceof RequestBodyParseError &&
      error.statusCode === 413 &&
      error.message === `Request body too large. Max ${MAX_JSON_BODY_BYTES} bytes.`,
  );
});
