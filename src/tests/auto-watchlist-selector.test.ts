import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AutoWatchlistSelector,
  compareAutoWatchlistDecisions,
  DEFAULT_AUTO_WATCHLIST_SELECTOR_CONFIG,
  isWithinAutoWatchlistScanWindow,
  normalizeNasdaqChartTimestamp,
  scoreAutoWatchlistCandidate,
  type AutoWatchlistDiscoveryCandidate,
  type AutoWatchlistCandidateDecision,
  type AutoWatchlistSessionActivityLookup,
} from "../lib/auto-watchlist/auto-watchlist-selector.js";
import { derivePressReleaseCatalystContext } from "../lib/catalysts/press-release-catalyst-context.js";
import type { FinnhubClient } from "../lib/stock-context/finnhub-client.js";
import type { YahooClient } from "../lib/stock-context/yahoo-client.js";

const NO_CATALYST_LOOKUP = async (input: { symbols: string[] }) => ({
  available: true,
  articlesBySymbol: Object.fromEntries(input.symbols.map((symbol) => [symbol, []])),
});

const ACTIVE_SESSION_LOOKUP: AutoWatchlistSessionActivityLookup = async (input) => Object.fromEntries(
  input.symbols.map((symbol) => [symbol, {
    symbol,
    session: input.session,
    price: 2,
    gainPct: 20,
    sessionVolume: 1_000_000,
    recent15mVolume: 100_000,
    recent15mDollarVolume: 200_000,
    quoteTime: Math.floor(input.now / 1000),
    quoteAgeMinutes: 0,
    available: true,
  }]),
);

const BASE_CANDIDATE: AutoWatchlistDiscoveryCandidate = {
  symbol: "LOWF",
  price: 2,
  gainPct: 14,
  volume: 800_000,
  averageVolume: 200_000,
  marketCap: 40_000_000,
  quoteTime: 1_784_207_400,
  sourceScreens: ["small_cap_gainers"],
};

test("auto selector strongly favors known low float and rejects oversized share counts", () => {
  const lowFloat = scoreAutoWatchlistCandidate({
    candidate: BASE_CANDIDATE,
    floatShares: 4_500_000,
  });
  const largerFloat = scoreAutoWatchlistCandidate({
    candidate: BASE_CANDIDATE,
    floatShares: 45_000_000,
  });
  const fallbackOutstanding = scoreAutoWatchlistCandidate({
    candidate: BASE_CANDIDATE,
    finnhubSharesOutstanding: 54_220_000,
  });
  const tooLarge = scoreAutoWatchlistCandidate({
    candidate: BASE_CANDIDATE,
    finnhubSharesOutstanding: 60_000_001,
  });

  assert.equal(lowFloat.qualified, true);
  assert.equal(lowFloat.effectiveSharesSource, "yahoo_float");
  assert.ok(lowFloat.score > largerFloat.score);
  assert.equal(fallbackOutstanding.qualified, true);
  assert.equal(fallbackOutstanding.effectiveSharesSource, "finnhub_outstanding");
  assert.equal(tooLarge.qualified, false);
  assert.match(tooLarge.rejectionReasons.join(" "), /shares outstanding must be at most 60M/);
});

test("auto selector rejects candidates over the $100M default market-cap ceiling", () => {
  const result = scoreAutoWatchlistCandidate({
    candidate: {
      ...BASE_CANDIDATE,
      marketCap: 100_000_001,
    },
    floatShares: 4_500_000,
  });

  assert.equal(result.qualified, false);
  assert.match(result.rejectionReasons.join(" "), /at most \$100M/);
});

test("recent 15-minute activity gate rejects an otherwise qualifying late isolated spike", () => {
  const result = scoreAutoWatchlistCandidate({
    candidate: { ...BASE_CANDIDATE, gainPct: 26.7, volume: 200_000, marketCap: 34_000_000 },
    finnhubSharesOutstanding: 23_600_000,
    session: "regular",
    activity: {
      symbol: "LOWF",
      session: "regular",
      price: 1.4,
      gainPct: 26.7,
      sessionVolume: 200_000,
      recent15mVolume: 0,
      recent15mDollarVolume: 0,
      quoteTime: 1_784_231_610,
      quoteAgeMinutes: 1,
      available: true,
    },
  });

  assert.equal(result.qualified, false);
  assert.match(result.rejectionReasons.join(" "), /last 15m dollar volume/);
});

test("session dollar volume, not latest price times volume, drives dollar-volume qualification", () => {
  const result = scoreAutoWatchlistCandidate({
    candidate: {
      ...BASE_CANDIDATE,
      price: 0.3,
      gainPct: 25,
      volume: 100_000,
      averageVolume: null,
      marketCap: 10_000_000,
    },
    floatShares: 5_000_000,
    session: "postmarket",
    activity: {
      symbol: "LOWF",
      session: "postmarket",
      price: 0.3,
      gainPct: 25,
      sessionVolume: 100_000,
      sessionDollarVolume: 2_000_000,
      recent15mVolume: 50_000,
      recent15mDollarVolume: 50_000,
      quoteTime: 1_784_231_610,
      quoteAgeMinutes: 1,
      available: true,
    },
  });

  assert.equal(result.qualified, true);
  assert.match(result.reasons.join(" "), /\$2M\+ dollar volume/);
  assert.doesNotMatch(result.rejectionReasons.join(" "), /dollar volume must/);
});

test("non-press-release ingest events cannot become catalyst boosts", () => {
  const context = derivePressReleaseCatalystContext({
    symbol: "SAFE",
    referenceDate: "2026-07-16",
    lookbackDays: 7,
    articles: [{
      ingestEventId: "skip-1",
      ticker: "SAFE",
      url: "skip-1",
      articlePath: null,
      title: "Skipped stale market-cap scanner event",
      publishedAt: "2026-07-16T13:00:00.000Z",
      eventType: "market_cap_stale_skip",
      filingType: null,
      routeTag: "market_cap_under_30m",
      sourceUrl: null,
      observedAt: "2026-07-16T13:00:00.000Z",
      sourceKind: "ingest_events",
    }],
  });

  assert.equal(context.timing, "none");
  assert.equal(context.articleCount, 0);
  assert.equal(context.primaryArticle, null);
});

test("automatic scans are limited to the configured weekday day-trading window in New York", () => {
  const thresholds = { ...DEFAULT_AUTO_WATCHLIST_SELECTOR_CONFIG };
  assert.equal(
    isWithinAutoWatchlistScanWindow(Date.parse("2026-07-16T13:00:00Z"), thresholds),
    true,
  );
  assert.equal(
    isWithinAutoWatchlistScanWindow(Date.parse("2026-07-16T21:00:00Z"), thresholds),
    true,
  );
  assert.equal(
    isWithinAutoWatchlistScanWindow(Date.parse("2026-07-17T00:30:00Z"), thresholds),
    false,
  );
  assert.equal(
    isWithinAutoWatchlistScanWindow(Date.parse("2026-07-18T13:00:00Z"), thresholds),
    false,
  );
});

test("Nasdaq chart wall-clock timestamps normalize into the correct New York session", () => {
  const encodedWallClock = Date.parse("2026-07-16T17:20:00Z");
  const referenceTimestamp = Date.parse("2026-07-16T21:20:30Z");
  const normalized = normalizeNasdaqChartTimestamp(encodedWallClock, referenceTimestamp);
  assert.equal(normalized, Date.parse("2026-07-16T21:20:00Z"));
});

test("admin threshold changes persist without enabling automatic additions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-settings-"));
  const configPath = join(directory, "config.json");
  const options = {
    yahooClient: null,
    finnhubClient: null,
    configPath,
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  };
  try {
    const selector = new AutoWatchlistSelector(options);
    const updated = await selector.updateConfiguration({
      thresholds: {
        maxMarketCap: 75_000_000,
        maxFloatShares: 20_000_000,
        maxSharesOutstanding: 35_000_000,
        minimumScore: 55,
        recentDollarVolumeRankMaxBoost: 18,
        volumeAccelerationRankFullScoreRatio: 2.5,
        shareTurnoverRankFullScorePct: 80,
      },
    });
    assert.equal(updated.enabled, false);
    assert.equal(updated.thresholds.maxMarketCap, 75_000_000);

    const restored = new AutoWatchlistSelector(options).getStatus();
    assert.equal(restored.enabled, false);
    assert.equal(restored.thresholds.maxMarketCap, 75_000_000);
    assert.equal(restored.thresholds.maxFloatShares, 20_000_000);
    assert.equal(restored.thresholds.maxSharesOutstanding, 35_000_000);
    assert.equal(restored.thresholds.minimumScore, 55);
    assert.equal(restored.thresholds.recentDollarVolumeRankMaxBoost, 18);
    assert.equal(restored.thresholds.volumeAccelerationRankFullScoreRatio, 2.5);
    assert.equal(restored.thresholds.shareTurnoverRankFullScorePct, 80);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("selector requires two passing observations before activating and does not duplicate active symbols", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-selector-"));
  const configPath = join(directory, "config.json");
  mkdirSync(directory, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    enabled: true,
    lastUpdated: Date.now(),
  }));
  const activated: string[] = [];
  const active = new Set<string>();
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    finance: {
      result: [{
        quotes: [{
          symbol: "LOWF",
          quoteType: "EQUITY",
          regularMarketPrice: 2,
          regularMarketChangePercent: 14,
          regularMarketVolume: 800_000,
          averageDailyVolume3Month: 200_000,
          marketCap: 40_000_000,
          regularMarketTime: 1_784_207_400,
        }],
      }],
      error: null,
    },
  }), { status: 200 });
  const yahooClient = {
    getSummary: async () => ({
      source: "Yahoo" as const,
      marketCap: 40_000_000,
      floatShares: 4_500_000,
      sharesOutstanding: 20_000_000,
    }),
  } as unknown as YahooClient;
  const finnhubClient = {
    getCompanyProfile: async () => ({
      ticker: "LOWF",
      marketCapitalization: 40,
      shareOutstanding: 20,
    }),
  } as unknown as FinnhubClient;
  const selector = new AutoWatchlistSelector({
    yahooClient,
    finnhubClient,
    fetchImpl,
    configPath,
    now: () => Date.parse("2026-07-16T13:00:00Z"),
    getActiveSymbols: () => [...active],
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol }) => {
      activated.push(symbol);
      active.add(symbol);
    },
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });

  try {
    const preview = await selector.previewScan();
    assert.equal(preview.recentDecisions[0]?.consecutivePasses, 0);
    assert.deepEqual(activated, []);

    const first = await selector.runNow({ activate: true });
    assert.deepEqual(activated, []);
    assert.equal(first.recentDecisions[0]?.consecutivePasses, 1);

    const second = await selector.runNow({ activate: true });
    assert.deepEqual(activated, ["LOWF"]);
    assert.deepEqual(second.addedToday, ["LOWF"]);

    await selector.runNow({ activate: true });
    assert.deepEqual(activated, ["LOWF"]);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("daily automatic-add limit survives a runtime restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-daily-limit-"));
  const configPath = join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    enabled: true,
    lastUpdated: Date.now(),
    thresholds: { maxAddsPerTradingDay: 1, consecutivePassesRequired: 1 },
    tradingDay: "2026-07-16",
    addedToday: ["FIRST"],
  }));
  const activated: string[] = [];
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    data: { rows: [{ symbol: "SECOND", name: "Second Common Stock", lastsale: "$2.00", pctchange: "20%", volume: "1000000", marketCap: "30000000" }] },
  }), { status: 200 });
  const finnhubClient = {
    getCompanyProfile: async () => ({ ticker: "SECOND", marketCapitalization: 30, shareOutstanding: 15 }),
  } as unknown as FinnhubClient;
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    configPath,
    now: () => Date.parse("2026-07-16T15:00:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol }) => {
      activated.push(symbol);
    },
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });
  try {
    const status = await selector.runNow({ activate: true });
    assert.deepEqual(status.addedToday, ["FIRST"]);
    assert.deepEqual(activated, []);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a full main-session allowance does not block the separate post-market allowance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-postmarket-limit-"));
  const configPath = join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    enabled: true,
    lastUpdated: Date.now(),
    thresholds: {
      maxAddsPerTradingDay: 1,
      maxPostmarketAddsPerTradingDay: 1,
      consecutivePassesRequired: 1,
    },
    tradingDay: "2026-07-16",
    mainSessionAddedToday: ["MAIN"],
    postmarketAddedToday: [],
  }));
  const activated: string[] = [];
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    data: { rows: [{ symbol: "BIYA", name: "Baiya International Group Class A Ordinary Shares", lastsale: "$3.04", pctchange: "-8.4%", volume: "2997321", marketCap: "8205601" }] },
  }), { status: 200 });
  const finnhubClient = {
    getCompanyProfile: async () => ({ ticker: "BIYA", marketCapitalization: 8.2, shareOutstanding: 2.7 }),
  } as unknown as FinnhubClient;
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    configPath,
    now: () => Date.parse("2026-07-16T22:00:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol }) => activated.push(symbol),
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });
  try {
    const status = await selector.runNow({ activate: true });
    assert.deepEqual(activated, ["BIYA"]);
    assert.deepEqual(status.mainSessionAddedToday, ["MAIN"]);
    assert.deepEqual(status.postmarketAddedToday, ["BIYA"]);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("live exchange discovery surfaces current day-trader leaders and ignores warrants", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/marketmovers")) {
      return new Response(JSON.stringify({ data: { STOCKS: {} } }), { status: 200 });
    }
    assert.match(url, /api\.nasdaq\.com\/api\/screener\/stocks/);
    return new Response(JSON.stringify({
      data: {
        rows: [
          { symbol: "TGHL", name: "The GrowHub Limited Class A Ordinary Shares", lastsale: "$1.40", pctchange: "71.8%", volume: "116000000", marketCap: "35000000" },
          { symbol: "ATPC", name: "Agape ATP Corporation Common Stock", lastsale: "$4.19", pctchange: "66.2%", volume: "31000000", marketCap: "4200000" },
          { symbol: "EVLVW", name: "Evolv Technologies Holdings Inc. Warrant", lastsale: "$0.01", pctchange: "280%", volume: "1000000", marketCap: "3000000" },
        ],
      },
    }), { status: 200 });
  };
  const finnhubClient = {
    getCompanyProfile: async (symbol: string) => ({
      ticker: symbol,
      marketCapitalization: symbol === "TGHL" ? 35 : 4.2,
      shareOutstanding: symbol === "TGHL" ? 25.3 : 1,
    }),
  } as unknown as FinnhubClient;
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    configPath: join(tmpdir(), "auto-watchlist-live-leaders-test.json"),
    now: () => Date.parse("2026-07-16T15:00:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });

  const preview = await selector.previewScan();
  assert.equal(preview.lastDiscoverySources[0], "live_exchange_gainers");
  assert.deepEqual(preview.recentDecisions.map((decision) => decision.symbol), ["ATPC", "TGHL"]);
  assert.equal(preview.recentDecisions.every((decision) => decision.qualified), true);
  assert.doesNotMatch(JSON.stringify(preview.recentDecisions), /EVLVW/);
});

test("press-release catalysts rerank only candidates that already pass the base filters", async () => {
  const rows = ["NONE", "OLDER", "PRIOR", "SAME"].map((symbol) => ({
    symbol,
    name: `${symbol} Corporation Common Stock`,
    lastsale: "$2.00",
    pctchange: "20%",
    volume: "1000000",
    marketCap: "30000000",
  }));
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ data: { rows } }), { status: 200 });
  const finnhubClient = {
    getCompanyProfile: async (symbol: string) => ({ ticker: symbol, marketCapitalization: 30, shareOutstanding: 15 }),
  } as unknown as FinnhubClient;
  const publishedAtBySymbol: Record<string, string> = {
    SAME: "2026-07-16T13:00:00.000Z",
    PRIOR: "2026-07-15T13:00:00.000Z",
    OLDER: "2026-07-13T13:00:00.000Z",
  };
  const catalystLookup = async (input: { symbols: string[] }) => ({
    available: true,
    articlesBySymbol: Object.fromEntries(input.symbols.map((symbol) => [
      symbol,
      publishedAtBySymbol[symbol]
        ? [{
            ingestEventId: `event-${symbol}`,
            ticker: symbol,
            url: `https://traderslink.pro/news/${symbol}/test`,
            articlePath: null,
            title: `${symbol} catalyst`,
            publishedAt: publishedAtBySymbol[symbol],
            eventType: "press_release",
            filingType: null,
            routeTag: null,
            sourceUrl: null,
            observedAt: publishedAtBySymbol[symbol],
            sourceKind: "website_article_posts" as const,
          }]
        : [],
    ])),
  });
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    configPath: join(tmpdir(), "auto-watchlist-catalyst-rerank-test.json"),
    now: () => Date.parse("2026-07-16T15:00:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });

  const preview = await selector.previewScan();
  assert.deepEqual(preview.recentDecisions.map((decision) => decision.symbol), ["SAME", "PRIOR", "OLDER", "NONE"]);
  assert.deepEqual(preview.recentDecisions.map((decision) => decision.score), [63, 63, 63, 63]);
  assert.deepEqual(preview.recentDecisions.map((decision) => decision.catalystRankBoost), [12, 9, 3, 0]);
  assert.equal(preview.recentDecisions.every((decision) => decision.qualified), true);
});

test("strong recent activity and acceleration can outrank a same-day catalyst", async () => {
  const rows = ["CAT", "RUN"].map((symbol) => ({
    symbol,
    name: `${symbol} Corporation Common Stock`,
    lastsale: "$2.00",
    pctchange: "25%",
    volume: "2000000",
    marketCap: "10000000",
  }));
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ data: { rows } }), { status: 200 });
  const finnhubClient = {
    getCompanyProfile: async (symbol: string) => ({ ticker: symbol, marketCapitalization: 10, shareOutstanding: 10 }),
  } as unknown as FinnhubClient;
  const activityLookup: AutoWatchlistSessionActivityLookup = async ({ symbols, session, now }) => Object.fromEntries(
    symbols.map((symbol) => [symbol, {
      symbol,
      session,
      price: 2,
      gainPct: 25,
      sessionVolume: 2_000_000,
      sessionDollarVolume: 4_000_000,
      recent15mVolume: symbol === "RUN" ? 500_000 : 50_000,
      recent15mDollarVolume: symbol === "RUN" ? 1_000_000 : 100_000,
      sessionElapsedMinutes: 120,
      volumeAcceleration: symbol === "RUN" ? 3 : 1,
      quoteTime: Math.floor(now / 1000),
      quoteAgeMinutes: 0,
      available: true,
    }]),
  );
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    configPath: join(tmpdir(), "auto-watchlist-activity-rerank-test.json"),
    now: () => Date.parse("2026-07-16T15:00:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup: async (input: { symbols: string[] }) => ({
      available: true,
      articlesBySymbol: Object.fromEntries(input.symbols.map((symbol) => [symbol, symbol === "CAT" ? [{
        ingestEventId: "event-CAT",
        ticker: "CAT",
        url: "https://traderslink.pro/news/CAT/test",
        articlePath: null,
        title: "CAT catalyst",
        publishedAt: "2026-07-16T13:00:00.000Z",
        eventType: "press_release",
        filingType: null,
        routeTag: null,
        sourceUrl: null,
        observedAt: "2026-07-16T13:00:00.000Z",
        sourceKind: "website_article_posts" as const,
      }] : []])),
    }),
    sessionActivityLookup: activityLookup,
  });

  const preview = await selector.previewScan();
  assert.deepEqual(preview.recentDecisions.map((decision) => decision.symbol), ["RUN", "CAT"]);
  assert.equal(preview.recentDecisions[0]?.recentDollarVolumeRankBoost, 15);
  assert.equal(preview.recentDecisions[0]?.volumeAccelerationRankBoost, 10);
  assert.equal(preview.recentDecisions[1]?.catalystRankBoost, 12);
  assert.ok((preview.recentDecisions[0]?.rankingScore ?? 0) > (preview.recentDecisions[1]?.rankingScore ?? 0));
});

test("ranking ties resolve by recent activity, gain, turnover, then symbol", () => {
  const decision = (
    symbol: string,
    recent15mDollarVolume: number,
    gainPct: number,
    shareTurnoverPct: number,
  ) => ({
    symbol,
    rankingScore: 80,
    recent15mDollarVolume,
    gainPct,
    shareTurnoverPct,
  }) as AutoWatchlistCandidateDecision;
  const decisions = [
    decision("AGAIN", 100_000, 20, 10),
    decision("ZTURN", 100_000, 20, 20),
    decision("RECENT", 200_000, 10, 10),
    decision("AALPHA", 100_000, 20, 20),
  ];

  assert.deepEqual(
    decisions.sort(compareAutoWatchlistDecisions).map((item) => item.symbol),
    ["RECENT", "AALPHA", "ZTURN", "AGAIN"],
  );

  const rejected = { ...decision("REJECTED", 999_999, 99, 99), qualified: false, rankingScore: 999 };
  const qualified = { ...decision("QUALIFIED", 1, 1, 1), qualified: true, rankingScore: 1 };
  assert.deepEqual(
    [rejected, qualified].sort(compareAutoWatchlistDecisions).map((item) => item.symbol),
    ["QUALIFIED", "REJECTED"],
  );
});

test("catalyst ranking has a true no-effect setting and lookup failures fail open", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    data: { rows: [{ symbol: "SAFE", name: "Safe Common Stock", lastsale: "$2.00", pctchange: "20%", volume: "1000000", marketCap: "30000000" }] },
  }), { status: 200 });
  const finnhubClient = {
    getCompanyProfile: async () => ({ ticker: "SAFE", marketCapitalization: 30, shareOutstanding: 15 }),
  } as unknown as FinnhubClient;
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    thresholds: { catalystRankingEnabled: false },
    now: () => Date.parse("2026-07-16T15:00:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup: async () => {
      throw new Error("press database offline");
    },
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });

  const preview = await selector.previewScan();
  assert.equal(preview.recentDecisions[0]?.qualified, true);
  assert.equal(preview.recentDecisions[0]?.catalystRankBoost, 0);
  assert.doesNotMatch(preview.recentDecisions[0]?.rankingReasons.join(" ") ?? "", /catalyst/);
  assert.match(preview.lastCatalystLookupError ?? "", /press database offline/);
});

test("post-market discovery can promote an active after-hours runner that was down in regular trading", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    data: {
      rows: [
        { symbol: "LGPS", name: "LogProstyle Common Stock", lastsale: "$1.40", pctchange: "26.7%", volume: "200000", marketCap: "34000000" },
        { symbol: "BIYA", name: "Baiya International Group Class A Ordinary Shares", lastsale: "$3.04", pctchange: "-8.4%", volume: "2997321", marketCap: "8205601" },
      ],
    },
  }), { status: 200 });
  const activityLookup: AutoWatchlistSessionActivityLookup = async ({ symbols, session, now }) => Object.fromEntries(
    symbols.map((symbol) => [symbol, {
      symbol,
      session,
      price: symbol === "BIYA" ? 4.18 : 1.42,
      gainPct: symbol === "BIYA" ? 37.5 : 1.4,
      sessionVolume: symbol === "BIYA" ? 500_000 : 10_000,
      recent15mVolume: symbol === "BIYA" ? 100_000 : 0,
      recent15mDollarVolume: symbol === "BIYA" ? 418_000 : 0,
      quoteTime: Math.floor(now / 1000),
      quoteAgeMinutes: 0,
      available: true,
    }]),
  );
  const finnhubClient = {
    getCompanyProfile: async (symbol: string) => ({ ticker: symbol, marketCapitalization: symbol === "BIYA" ? 8.2 : 34, shareOutstanding: symbol === "BIYA" ? 2.7 : 23.6 }),
  } as unknown as FinnhubClient;
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    now: () => Date.parse("2026-07-16T22:00:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: activityLookup,
  });

  const preview = await selector.previewScan();
  assert.equal(preview.recentDecisions[0]?.symbol, "BIYA");
  assert.equal(preview.recentDecisions[0]?.session, "postmarket");
  assert.equal(preview.recentDecisions[0]?.qualified, true);
  assert.equal(preview.recentDecisions.find((decision) => decision.symbol === "LGPS")?.qualified, false);
});

test("premarket discovery prioritizes current market movers that stale regular-session rankings would omit", async () => {
  const regularLeaders = Array.from({ length: 8 }, (_, index) => ({
    symbol: `OLD${index}`,
    name: `Old Leader ${index} Common Stock`,
    lastsale: "$2.00",
    pctchange: `${30 - index}%`,
    volume: String(5_000_000 - index * 100_000),
    marketCap: "10000000",
  }));
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/marketmovers")) {
      return new Response(JSON.stringify({
        data: {
          STOCKS: {
            MostAdvanced: {
              table: {
                rows: [{
                  symbol: "SLND",
                  name: "Southland Holdings, Inc. Common Stock",
                  lastSalePrice: "$1.1385",
                  lastSaleChange: "+0.4572",
                  change: "+67.10%",
                  deltaIndicator: "up",
                }],
              },
            },
            MostActiveByShareVolume: { table: { rows: [] } },
          },
        },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      data: {
        rows: [
          ...regularLeaders,
          {
            symbol: "SLND",
            name: "Southland Holdings, Inc. Common Stock",
            lastsale: "$0.6813",
            pctchange: "-4.177%",
            volume: "109245",
            marketCap: "36939324",
          },
        ],
      },
    }), { status: 200 });
  };
  let lookedUpSymbols: string[] = [];
  const activityLookup: AutoWatchlistSessionActivityLookup = async ({ symbols, session, now }) => {
    lookedUpSymbols = [...symbols];
    return Object.fromEntries(symbols.map((symbol) => [symbol, {
      symbol,
      session,
      price: symbol === "SLND" ? 1.1385 : 2,
      gainPct: symbol === "SLND" ? 67.1 : 10,
      sessionVolume: symbol === "SLND" ? 41_000_000 : 1_000_000,
      sessionDollarVolume: symbol === "SLND" ? 46_000_000 : 2_000_000,
      recent15mVolume: symbol === "SLND" ? 2_000_000 : 100_000,
      recent15mDollarVolume: symbol === "SLND" ? 2_277_000 : 200_000,
      sessionElapsedMinutes: 310,
      volumeAcceleration: symbol === "SLND" ? 4 : 1.2,
      quoteTime: Math.floor(now / 1000),
      quoteAgeMinutes: 0,
      available: true,
    }]));
  };
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient: {
      getCompanyProfile: async (symbol: string) => ({
        ticker: symbol,
        marketCapitalization: symbol === "SLND" ? 36.9 : 10,
        shareOutstanding: 10,
      }),
    } as unknown as FinnhubClient,
    fetchImpl,
    configPath: join(tmpdir(), "auto-watchlist-premarket-movers-test.json"),
    thresholds: { extendedSessionCandidateLimit: 4, enrichmentLimit: 4 },
    now: () => Date.parse("2026-07-17T13:10:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: activityLookup,
  });

  const preview = await selector.previewScan();
  assert.equal(lookedUpSymbols.includes("SLND"), true);
  assert.equal(preview.recentDecisions[0]?.symbol, "SLND");
  assert.equal(preview.recentDecisions[0]?.qualified, true);
  assert.equal(
    preview.recentDecisions[0]?.sourceScreens.includes("nasdaq_live_most_advanced"),
    true,
  );
});

test("Nasdaq movers are independently evaluated when the bulk screener omits them", async () => {
  const cases = [
    { label: "premarket", now: Date.parse("2026-07-17T12:30:00Z") },
    { label: "regular", now: Date.parse("2026-07-17T15:00:00Z") },
    { label: "postmarket", now: Date.parse("2026-07-17T21:30:00Z") },
  ] as const;

  for (const scenario of cases) {
    const actualTradeTime = Math.floor((scenario.now - 30_000) / 1000);
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).includes("/api/marketmovers")) {
        return new Response(JSON.stringify({
          data: {
            STOCKS: {
              MostAdvanced: {
                table: {
                  rows: [{
                    symbol: "NEWA",
                    name: "New Arrival Corporation Common Stock",
                    lastSalePrice: "$1.50",
                    lastSaleChange: "+0.50",
                    change: "+50.00%",
                    deltaIndicator: "up",
                  }, {
                    symbol: "BADW",
                    name: "Bad Security Warrant",
                    lastSalePrice: "$1.50",
                    lastSaleChange: "+0.50",
                    change: "+50.00%",
                    deltaIndicator: "up",
                  }],
                },
              },
              MostActiveByShareVolume: {
                table: {
                  rows: [{
                    symbol: "NEWA",
                    name: "New Arrival Corporation Common Stock",
                    lastSalePrice: "$1.50",
                    lastSaleChange: "+0.50",
                    change: "2500000",
                    deltaIndicator: "up",
                  }],
                },
              },
            },
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { rows: [] } }), { status: 200 });
    };
    const selector = new AutoWatchlistSelector({
      yahooClient: null,
      finnhubClient: {
        getCompanyProfile: async (symbol: string) => ({
          ticker: symbol,
          marketCapitalization: 25,
          shareOutstanding: 10,
        }),
      } as unknown as FinnhubClient,
      fetchImpl,
      configPath: join(tmpdir(), `auto-watchlist-independent-mover-${scenario.label}.json`),
      thresholds: { enrichmentLimit: 10 },
      now: () => scenario.now,
      getActiveSymbols: () => [],
      isRuntimeReady: () => true,
      activateSymbol: async () => undefined,
      catalystLookup: NO_CATALYST_LOOKUP,
      sessionActivityLookup: async ({ symbols, session }) => Object.fromEntries(
        symbols.map((symbol) => [symbol, {
          symbol,
          session,
          price: 1.5,
          gainPct: 50,
          sessionVolume: 2_500_000,
          sessionDollarVolume: 3_750_000,
          recent15mVolume: 250_000,
          recent15mDollarVolume: 375_000,
          sessionElapsedMinutes: 30,
          volumeAcceleration: 2,
          quoteTime: actualTradeTime,
          quoteAgeMinutes: 0.5,
          available: true,
        }]),
      ),
    });

    const preview = await selector.previewScan();
    const decision = preview.recentDecisions.find((candidate) => candidate.symbol === "NEWA");
    assert.ok(decision, `${scenario.label} should independently evaluate NEWA`);
    assert.equal(decision.quoteTime, actualTradeTime);
    assert.equal(decision.qualified, true);
    assert.equal(decision.sourceScreens.includes("nasdaq_live_most_advanced"), true);
    assert.equal(decision.sourceScreens.includes("nasdaq_live_most_active"), true);
    assert.equal(preview.recentDecisions.some((candidate) => candidate.symbol === "BADW"), false);
  }
});

test("regular-hours discovery uses live market movers when the downloadable screener is stale", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes("/api/marketmovers")) {
      return new Response(JSON.stringify({
        data: {
          STOCKS: {
            MostAdvanced: {
              table: {
                rows: [{
                  symbol: "SLND",
                  name: "Southland Holdings, Inc.",
                  lastSalePrice: "$1.0601",
                  lastSaleChange: "+0.3788",
                  change: "+55.5996%",
                  deltaIndicator: "up",
                }],
              },
            },
            MostActiveByShareVolume: {
              table: {
                rows: [{
                  symbol: "SLND",
                  name: "Southland Holdings, Inc.",
                  lastSalePrice: "$1.0601",
                  lastSaleChange: "+0.3788",
                  change: "90250836",
                  deltaIndicator: "up",
                }],
              },
            },
          },
        },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      data: {
        rows: [{
          symbol: "SLND",
          name: "Southland Holdings, Inc. Common Stock",
          lastsale: "$0.6813",
          pctchange: "-4.177%",
          volume: "109245",
          marketCap: "36939324",
        }],
      },
    }), { status: 200 });
  };
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient: {
      getCompanyProfile: async () => ({
        ticker: "SLND",
        marketCapitalization: 36.9,
        shareOutstanding: 10,
      }),
    } as unknown as FinnhubClient,
    fetchImpl,
    configPath: join(tmpdir(), "auto-watchlist-regular-live-mover-test.json"),
    thresholds: { enrichmentLimit: 4 },
    now: () => Date.parse("2026-07-17T13:45:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: async ({ symbols, session, now }) => Object.fromEntries(
      symbols.map((symbol) => [symbol, {
        symbol,
        session,
        price: 1.0601,
        gainPct: 55.5996,
        sessionVolume: 90_250_836,
        sessionDollarVolume: 95_000_000,
        recent15mVolume: 2_000_000,
        recent15mDollarVolume: 2_120_000,
        sessionElapsedMinutes: 15,
        volumeAcceleration: 3,
        quoteTime: Math.floor(now / 1000),
        quoteAgeMinutes: 0,
        available: true,
      }]),
    ),
  });

  const preview = await selector.previewScan();
  assert.equal(preview.recentDecisions[0]?.symbol, "SLND");
  assert.equal(preview.recentDecisions[0]?.gainPct, 55.5996);
  assert.equal(preview.recentDecisions[0]?.qualified, true);
  assert.equal(preview.recentDecisions[0]?.sourceScreens.includes("nasdaq_live_most_advanced"), true);
  assert.equal(preview.recentDecisions[0]?.sourceScreens.includes("nasdaq_live_most_active"), true);
});

test("enabling the selector runs an immediate scan even outside the recurring window", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-immediate-"));
  const activated: string[] = [];
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    data: {
      rows: [
        { symbol: "ATPC", name: "Agape ATP Corporation Common Stock", lastsale: "$4.19", pctchange: "66.2%", volume: "31000000", marketCap: "4200000" },
      ],
    },
  }), { status: 200 });
  const finnhubClient = {
    getCompanyProfile: async () => ({ ticker: "ATPC", marketCapitalization: 4.2, shareOutstanding: 1 }),
  } as unknown as FinnhubClient;
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    configPath: join(directory, "config.json"),
    now: () => Date.parse("2026-07-16T22:00:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol }) => {
      activated.push(symbol);
    },
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });
  try {
    const status = await selector.updateConfiguration({
      enabled: true,
      thresholds: { consecutivePassesRequired: 1 },
    });
    assert.equal(status.lastScanAt, Date.parse("2026-07-16T22:00:00Z"));
    assert.equal(status.lastScanCompletedAt, Date.parse("2026-07-16T22:00:00Z"));
    assert.deepEqual(activated, ["ATPC"]);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a preview requested during an active scan waits for that scan instead of returning stale state", async () => {
  let fetchCalls = 0;
  let releaseFetch!: () => void;
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes("/api/marketmovers")) {
      return new Response(JSON.stringify({ data: { STOCKS: {} } }), { status: 200 });
    }
    fetchCalls += 1;
    await fetchGate;
    return new Response(JSON.stringify({
      data: { rows: [{ symbol: "WAIT", name: "Wait Corporation Common Stock", lastsale: "$2.00", pctchange: "20%", volume: "1000000", marketCap: "10000000" }] },
    }), { status: 200 });
  };
  const finnhubClient = {
    getCompanyProfile: async () => ({ ticker: "WAIT", marketCapitalization: 10, shareOutstanding: 10 }),
  } as unknown as FinnhubClient;
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    configPath: join(tmpdir(), "auto-watchlist-concurrent-preview-test.json"),
    now: () => Date.parse("2026-07-16T15:00:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });

  const first = selector.previewScan();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = selector.previewScan();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fetchCalls, 1);
  assert.equal(selector.getStatus().running, true);

  releaseFetch();
  const [firstStatus, secondStatus] = await Promise.all([first, second]);
  assert.equal(firstStatus.lastEvaluatedCount, 1);
  assert.equal(secondStatus.lastEvaluatedCount, 1);
  assert.equal(secondStatus.recentDecisions[0]?.symbol, "WAIT");
  assert.equal(selector.getStatus().running, false);
});

test("consecutive-pass credit resets when a ticker disappears from the evaluated scan", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-consecutive-reset-"));
  const configPath = join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify({ version: 1, enabled: true, lastUpdated: Date.now() }));
  const symbolsByScan = ["ALFA", "BETA", "ALFA", "ALFA"];
  let scanIndex = 0;
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes("/api/marketmovers")) {
      return new Response(JSON.stringify({ data: { STOCKS: {} } }), { status: 200 });
    }
    const symbol = symbolsByScan[Math.min(scanIndex, symbolsByScan.length - 1)]!;
    scanIndex += 1;
    return new Response(JSON.stringify({
      data: { rows: [{ symbol, name: `${symbol} Corporation Common Stock`, lastsale: "$2.00", pctchange: "20%", volume: "1000000", marketCap: "10000000" }] },
    }), { status: 200 });
  };
  const finnhubClient = {
    getCompanyProfile: async (symbol: string) => ({ ticker: symbol, marketCapitalization: 10, shareOutstanding: 10 }),
  } as unknown as FinnhubClient;
  const activated: string[] = [];
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    configPath,
    thresholds: { consecutivePassesRequired: 2 },
    now: () => Date.parse("2026-07-16T15:00:00Z"),
    getActiveSymbols: () => [...activated],
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol }) => activated.push(symbol),
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });
  try {
    await selector.runNow({ activate: true });
    await selector.runNow({ activate: true });
    const returned = await selector.runNow({ activate: true });
    assert.equal(returned.recentDecisions[0]?.symbol, "ALFA");
    assert.equal(returned.recentDecisions[0]?.consecutivePasses, 1);
    assert.deepEqual(activated, []);

    await selector.runNow({ activate: true });
    assert.deepEqual(activated, ["ALFA"]);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("regular-hours pass credit does not satisfy the post-market consecutive-pass requirement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-session-pass-reset-"));
  const configPath = join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify({ version: 1, enabled: true, lastUpdated: Date.now() }));
  let now = Date.parse("2026-07-16T19:59:00Z");
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    data: { rows: [{ symbol: "ROLL", name: "Roll Corporation Common Stock", lastsale: "$2.00", pctchange: "20%", volume: "1000000", marketCap: "10000000" }] },
  }), { status: 200 });
  const finnhubClient = {
    getCompanyProfile: async () => ({ ticker: "ROLL", marketCapitalization: 10, shareOutstanding: 10 }),
  } as unknown as FinnhubClient;
  const activated: string[] = [];
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    configPath,
    thresholds: { consecutivePassesRequired: 2 },
    now: () => now,
    getActiveSymbols: () => [...activated],
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol }) => activated.push(symbol),
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });
  try {
    const regular = await selector.runNow({ activate: true });
    assert.equal(regular.recentDecisions[0]?.consecutivePasses, 1);

    now = Date.parse("2026-07-16T20:01:00Z");
    const firstPost = await selector.runNow({ activate: true });
    assert.equal(firstPost.recentDecisions[0]?.session, "postmarket");
    assert.equal(firstPost.recentDecisions[0]?.consecutivePasses, 1);
    assert.deepEqual(activated, []);

    await selector.runNow({ activate: true });
    assert.deepEqual(activated, ["ROLL"]);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("premarket pass credit carries into regular hours as one continuous trade session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-premarket-roll-"));
  const configPath = join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify({ version: 1, enabled: true, lastUpdated: Date.now() }));
  let now = Date.parse("2026-07-16T13:29:00Z");
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    data: { rows: [{ symbol: "PREM", name: "Premarket Corporation Common Stock", lastsale: "$2.00", pctchange: "20%", volume: "1000000", marketCap: "10000000" }] },
  }), { status: 200 });
  const finnhubClient = {
    getCompanyProfile: async () => ({ ticker: "PREM", marketCapitalization: 10, shareOutstanding: 10 }),
  } as unknown as FinnhubClient;
  const activated: string[] = [];
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    configPath,
    thresholds: { consecutivePassesRequired: 2 },
    now: () => now,
    getActiveSymbols: () => [...activated],
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol }) => activated.push(symbol),
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });
  try {
    const premarket = await selector.runNow({ activate: true });
    assert.equal(premarket.recentDecisions[0]?.session, "premarket");
    assert.equal(premarket.recentDecisions[0]?.consecutivePasses, 1);

    now = Date.parse("2026-07-16T13:31:00Z");
    const regular = await selector.runNow({ activate: true });
    assert.equal(regular.recentDecisions[0]?.session, "regular");
    assert.equal(regular.recentDecisions[0]?.consecutivePasses, 2);
    assert.deepEqual(activated, ["PREM"]);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("one activation failure is reported and does not block the next qualified ticker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-activation-failure-"));
  const configPath = join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify({ version: 1, enabled: true, lastUpdated: Date.now() }));
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    data: {
      rows: ["ALFA", "BETA"].map((symbol) => ({
        symbol,
        name: `${symbol} Corporation Common Stock`,
        lastsale: "$2.00",
        pctchange: "20%",
        volume: "1000000",
        marketCap: "10000000",
      })),
    },
  }), { status: 200 });
  const finnhubClient = {
    getCompanyProfile: async (symbol: string) => ({ ticker: symbol, marketCapitalization: 10, shareOutstanding: 10 }),
  } as unknown as FinnhubClient;
  const activated: string[] = [];
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    configPath,
    thresholds: { consecutivePassesRequired: 1, maxAddsPerTradingDay: 2 },
    now: () => Date.parse("2026-07-16T15:00:00Z"),
    getActiveSymbols: () => [...activated],
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol }) => {
      if (symbol === "ALFA") throw new Error("synthetic activation failure");
      activated.push(symbol);
    },
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });
  try {
    const status = await selector.runNow({ activate: true });
    assert.deepEqual(activated, ["BETA"]);
    assert.deepEqual(status.lastAddedSymbols, ["BETA"]);
    assert.deepEqual(status.lastActivationErrors, [{ symbol: "ALFA", error: "synthetic activation failure" }]);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("extended-hours discovery honors its configured candidate lookup ceiling", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-extended-ceiling-"));
  const rows = Array.from({ length: 10 }, (_, index) => ({
    symbol: `S${String(index).padStart(2, "0")}`,
    name: `Session ${index} Corporation Common Stock`,
    lastsale: "$2.00",
    pctchange: `${20 - index}%`,
    volume: String(1_000_000 - index * 10_000),
    marketCap: "10000000",
  }));
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ data: { rows } }), { status: 200 });
  const finnhubClient = {
    getCompanyProfile: async (symbol: string) => ({ ticker: symbol, marketCapitalization: 10, shareOutstanding: 10 }),
  } as unknown as FinnhubClient;
  let largestLookup = 0;
  const activityLookup: AutoWatchlistSessionActivityLookup = async ({ symbols, session, now }) => {
    largestLookup = Math.max(largestLookup, symbols.length);
    return Object.fromEntries(symbols.map((symbol) => [symbol, {
      symbol,
      session,
      price: 2,
      gainPct: 20,
      sessionVolume: 1_000_000,
      sessionDollarVolume: 2_000_000,
      recent15mVolume: 100_000,
      recent15mDollarVolume: 200_000,
      quoteTime: Math.floor(now / 1000),
      quoteAgeMinutes: 0,
      available: true,
    }]));
  };
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    configPath: join(directory, "config.json"),
    thresholds: { extendedSessionCandidateLimit: 3, enrichmentLimit: 3 },
    now: () => Date.parse("2026-07-16T22:00:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: activityLookup,
  });
  try {
    const status = await selector.previewScan();
    assert.equal(largestLookup, 3);
    assert.equal(status.lastScanCandidateCount, 3);
    assert.equal(status.lastEvaluatedCount, 3);
    assert.equal(status.lastDiscoverySources.includes("live_exchange_postmarket_activity"), true);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("provider status exposes live-exchange fallback while keeping Yahoo discovery operational", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes("api.nasdaq.com")) {
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }
    return new Response(JSON.stringify({
      finance: {
        result: [{ quotes: [{
          symbol: "FALL",
          quoteType: "EQUITY",
          regularMarketPrice: 2,
          regularMarketChangePercent: 20,
          regularMarketVolume: 1_000_000,
          averageDailyVolume3Month: 500_000,
          marketCap: 10_000_000,
          regularMarketTime: 1_784_207_400,
        }] }],
        error: null,
      },
    }), { status: 200 });
  };
  const finnhubClient = {
    getCompanyProfile: async () => ({ ticker: "FALL", marketCapitalization: 10, shareOutstanding: 10 }),
  } as unknown as FinnhubClient;
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    now: () => Date.parse("2026-07-16T15:00:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });

  const status = await selector.previewScan();
  assert.equal(status.providerStatus.liveExchangeDiscoveryAvailable, false);
  assert.equal(status.providerStatus.yahooDiscoveryAvailable, true);
  assert.match(status.lastDiscoveryError ?? "", /did not return stock rows/);
  assert.deepEqual(status.lastDiscoverySources.sort(), ["aggressive_small_caps", "small_cap_gainers"]);
  assert.equal(status.recentDecisions[0]?.symbol, "FALL");
});
