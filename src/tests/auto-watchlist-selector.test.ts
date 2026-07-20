import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AutoWatchlistSelector,
  autoWatchlistSessionForTimestamp,
  buildAutoWatchlistRetentionProtection,
  buildAutoWatchlistSlotSurvivalScore,
  buildVolumeDecelerationRankPenalty,
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
  assert.match(lowFloat.reasons.join(" "), /top-gainers list \+5 qualification points/);
  assert.equal(lowFloat.effectiveSharesSource, "yahoo_float");
  assert.ok(lowFloat.score > largerFloat.score);
  assert.equal(fallbackOutstanding.qualified, true);
  assert.equal(fallbackOutstanding.effectiveSharesSource, "finnhub_outstanding");
  assert.equal(tooLarge.qualified, false);
  assert.match(tooLarge.rejectionReasons.join(" "), /shares outstanding must be at most 60M/);
});

test("auto selector does not admit a SKYQ-like low-float ticker on a roughly 5% premarket move", () => {
  const decision = scoreAutoWatchlistCandidate({
    candidate: {
      symbol: "SKYQ",
      price: 4.0185,
      gainPct: 5.75,
      volume: 219_144,
      averageVolume: null,
      marketCap: 18_219_654,
      quoteTime: 1_784_552_040,
      sourceScreens: ["live_exchange_gainers", "live_exchange_premarket_activity"],
    },
    finnhubFloatShares: 4_140_000,
    finnhubSharesOutstanding: 4_790_000,
    session: "premarket",
    activity: {
      symbol: "SKYQ",
      session: "premarket",
      price: 4.0185,
      gainPct: 5.75,
      sessionVolume: 219_144,
      sessionDollarVolume: 854_902,
      recent15mVolume: 33_886,
      recent15mDollarVolume: 134_752,
      sessionElapsedMinutes: 294,
      volumeAcceleration: 3.4,
      quoteTime: 1_784_552_040,
      quoteAgeMinutes: 0.8,
      available: true,
    },
  });

  assert.equal(decision.qualified, false);
  assert.match(decision.rejectionReasons.join(" "), /gain must be at least 10%/i);
});

test("auto selector rejects an RPGL-like ticker with only about 300K session shares", () => {
  const decision = scoreAutoWatchlistCandidate({
    candidate: {
      ...BASE_CANDIDATE,
      symbol: "RPGL",
      gainPct: 12.3,
      volume: 310_000,
      marketCap: 2_000_000,
    },
    floatShares: 1_000_000,
    session: "regular",
  });

  assert.equal(decision.qualified, false);
  assert.match(decision.rejectionReasons.join(" "), /volume must be at least 500,000/i);
});

test("exact zero recent volume gets a bounded data-gap grace after strong session activity", () => {
  const now = Date.parse("2026-07-20T19:40:00Z");
  const decision = {
    score: 80,
    rejectionReasons: [
      "latest regular trade is too old",
      "last 15m dollar volume must be at least $50K",
    ],
    tradingHaltState: "not_found" as const,
    tradingHaltReasonCode: null,
    recent15mDollarVolume: 0,
    sessionDollarVolume: 150_000_000,
    sessionVolume: 73_000_000,
  };
  const protectedGap = buildAutoWatchlistRetentionProtection({
    decision,
    entry: { lastQualifiedAt: now - 10 * 60_000 },
    thresholds: { ...DEFAULT_AUTO_WATCHLIST_SELECTOR_CONFIG },
    now,
  });
  const expiredGap = buildAutoWatchlistRetentionProtection({
    decision,
    entry: { lastQualifiedAt: now - 16 * 60_000 },
    thresholds: { ...DEFAULT_AUTO_WATCHLIST_SELECTOR_CONFIG },
    now,
  });

  assert.equal(protectedGap.kind, "zero_volume_data_gap");
  assert.equal(protectedGap.protected, true);
  assert.equal(expiredGap.protected, false);
});

test("auto selector falls back to Finnhub float only when Yahoo float is unavailable", () => {
  const candidate = {
    ...BASE_CANDIDATE,
    price: 0.35,
    gainPct: 24,
    volume: 25_000_000,
    marketCap: 39_000_000,
  };
  const finnhubFallback = scoreAutoWatchlistCandidate({
    candidate,
    finnhubFloatShares: 77_820_000,
    finnhubSharesOutstanding: 167_750_000,
  });
  const yahooPreferred = scoreAutoWatchlistCandidate({
    candidate,
    floatShares: 8_000_000,
    finnhubFloatShares: 77_820_000,
    finnhubSharesOutstanding: 167_750_000,
  });

  assert.equal(finnhubFallback.qualified, true);
  assert.equal(finnhubFallback.floatShares, 77_820_000);
  assert.equal(finnhubFallback.effectiveSharesSource, "finnhub_float");
  assert.equal(finnhubFallback.lowPriceFloatNormalized, true);
  assert.equal(yahooPreferred.floatShares, 8_000_000);
  assert.equal(yahooPreferred.effectiveSharesSource, "yahoo_float");
});

test("low-priced candidates can pass a dollar-float exception without outranking a true low float", () => {
  const lowFloat = scoreAutoWatchlistCandidate({
    candidate: {
      ...BASE_CANDIDATE,
      price: 0.3,
      volume: 1_000_000,
    },
    floatShares: 10_000_000,
  });
  const normalized = scoreAutoWatchlistCandidate({
    candidate: {
      ...BASE_CANDIDATE,
      price: 0.3,
      volume: 1_000_000,
    },
    floatShares: 100_000_000,
  });
  const oversizedDollarFloat = scoreAutoWatchlistCandidate({
    candidate: {
      ...BASE_CANDIDATE,
      price: 0.3,
      volume: 1_000_000,
    },
    floatShares: 200_000_000,
  });

  assert.equal(normalized.qualified, true);
  assert.equal(normalized.lowPriceFloatNormalized, true);
  assert.equal(normalized.floatDollarValue, 30_000_000);
  assert.ok(lowFloat.score > normalized.score);
  assert.equal(oversizedDollarFloat.qualified, false);
  assert.match(oversizedDollarFloat.rejectionReasons.join(" "), /low-price dollar float/i);
});

test("the low-price dollar-float exception never relaxes the fallback outstanding-share cap", () => {
  const result = scoreAutoWatchlistCandidate({
    candidate: {
      ...BASE_CANDIDATE,
      price: 0.3,
      volume: 1_000_000,
    },
    finnhubSharesOutstanding: 60_000_001,
  });

  assert.equal(result.qualified, false);
  assert.equal(result.lowPriceFloatNormalized, false);
  assert.match(result.rejectionReasons.join(" "), /shares outstanding must be at most 60M/);
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

test("automatic selection rejects a ticker that an authoritative security master cannot verify as common stock", () => {
  const result = scoreAutoWatchlistCandidate({
    candidate: { ...BASE_CANDIDATE, securityMasterStatus: "not_found" },
    floatShares: 4_500_000,
  });

  assert.equal(result.qualified, false);
  assert.match(result.rejectionReasons.join(" "), /security master did not verify common stock/i);
});

test("automatic selection fails closed when authoritative common-equity verification is unavailable", () => {
  const result = scoreAutoWatchlistCandidate({
    candidate: { ...BASE_CANDIDATE, securityMasterStatus: "unavailable" },
    floatShares: 4_500_000,
  });

  assert.equal(result.qualified, false);
  assert.match(result.rejectionReasons.join(" "), /common-equity verification is unavailable/i);
});

test("current enrichment market cap overrides a stale smaller discovery cap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-market-cap-authority-"));
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    finance: {
      result: [{
        quotes: [{
          symbol: "LARG",
          quoteType: "EQUITY",
          regularMarketPrice: 2,
          regularMarketChangePercent: 20,
          regularMarketVolume: 1_000_000,
          averageDailyVolume3Month: 200_000,
          // Simulates a stale discovery snapshot below the $100M automatic ceiling.
          marketCap: 80_000_000,
          regularMarketTime: 1_784_207_400,
        }],
      }],
      error: null,
    },
  }), { status: 200 });
  const selector = new AutoWatchlistSelector({
    yahooClient: {
      getSummary: async () => ({
        source: "Yahoo" as const,
        // Current enrichment must win, so this automatic candidate is rejected.
        marketCap: 500_000_000,
        floatShares: 4_500_000,
        sharesOutstanding: 20_000_000,
      }),
    } as unknown as YahooClient,
    finnhubClient: {
      getCompanyProfile: async () => ({ ticker: "LARG", marketCapitalization: 500, shareOutstanding: 20 }),
    } as unknown as FinnhubClient,
    fetchImpl,
    configPath: join(directory, "config.json"),
    now: () => Date.parse("2026-07-16T15:00:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });
  try {
    const preview = await selector.previewScan();
    const decision = preview.recentDecisions.find((item) => item.symbol === "LARG");
    assert.ok(decision);
    assert.equal(decision.qualified, false);
    assert.match(decision.rejectionReasons.join(" "), /market cap must be known and at most \$100M/i);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
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
    thresholds: { minVolume: 100_000 },
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

test("automatic scans do not treat a U.S. exchange holiday as a weekday trading window", () => {
  const thresholds = { ...DEFAULT_AUTO_WATCHLIST_SELECTOR_CONFIG };
  const goodFridayAtTenEastern = Date.parse("2026-04-03T14:00:00Z");
  assert.equal(autoWatchlistSessionForTimestamp(goodFridayAtTenEastern), "closed");
  assert.equal(isWithinAutoWatchlistScanWindow(goodFridayAtTenEastern, thresholds), false);
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
        volumeDecelerationRankMaxPenalty: 14,
        volumeDecelerationRankFullPenaltyRatio: 0.2,
        topGainerQualificationScoreBoost: 7,
        zeroRecentVolumeRetentionGraceMinutes: 12,
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
    assert.equal(restored.thresholds.volumeDecelerationRankMaxPenalty, 14);
    assert.equal(restored.thresholds.volumeDecelerationRankFullPenaltyRatio, 0.2);
    assert.equal(restored.thresholds.topGainerQualificationScoreBoost, 7);
    assert.equal(restored.thresholds.zeroRecentVolumeRetentionGraceMinutes, 12);
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
  let currentVolumeAcceleration = 1;
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
    sessionActivityLookup: async (input) => Object.fromEntries(
      input.symbols.map((symbol) => [symbol, {
        symbol,
        session: input.session,
        price: 2,
        gainPct: 20,
        sessionVolume: 1_000_000,
        recent15mVolume: 100_000,
        recent15mDollarVolume: 200_000,
        volumeAcceleration: currentVolumeAcceleration,
        quoteTime: Math.floor(input.now / 1000),
        quoteAgeMinutes: 0,
        available: true,
      }]),
    ),
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
    const admitted = second.managedEntries.find((entry) => entry.symbol === "LOWF");
    assert.equal(admitted?.admissionQualificationScore, second.recentDecisions[0]?.score);
    assert.equal(admitted?.admissionRankingScore, second.recentDecisions[0]?.rankingScore);
    assert.equal(admitted?.admissionSlotSurvivalScore, second.recentDecisions[0]?.slotSurvivalScore);

    currentVolumeAcceleration = 3;
    const retained = await selector.runNow({ activate: true });
    assert.deepEqual(activated, ["LOWF"]);
    const retainedEntry = retained.managedEntries.find((entry) => entry.symbol === "LOWF");
    assert.ok((retainedEntry?.lastRankingScore ?? 0) > (retainedEntry?.admissionRankingScore ?? 0));
    assert.equal(retainedEntry?.admissionRankingScore, admitted?.admissionRankingScore);

    const restoredEntry = new AutoWatchlistSelector({
      yahooClient,
      finnhubClient,
      fetchImpl,
      configPath,
      getActiveSymbols: () => [...active],
      isRuntimeReady: () => true,
      activateSymbol: async () => undefined,
      catalystLookup: NO_CATALYST_LOOKUP,
      sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
    }).getStatus().managedEntries.find((entry) => entry.symbol === "LOWF");
    assert.equal(restoredEntry?.admissionRankingScore, admitted?.admissionRankingScore);
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
    now: () => Date.parse("2026-07-16T12:00:00Z"),
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

test("legacy runtime notes recover the frozen admission snapshot during migration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-admission-migration-"));
  const configPath = join(directory, "config.json");
  const activatedAt = Date.parse("2026-07-20T13:28:49Z");
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    enabled: false,
    lastUpdated: activatedAt,
    managedEntries: [{
      symbol: "SKYQ",
      bucket: "main",
      state: "active",
      firstAddedAt: activatedAt,
      lastActivatedAt: activatedAt,
      addedSession: "regular",
      lastSession: "regular",
      lastRankingScore: 95,
      lastSlotSurvivalScore: 96,
      lastQualifiedAt: activatedAt,
      retentionFailures: 0,
      standbyAt: null,
      statusReason: "retained",
    }],
  }));
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient: null,
    configPath,
    now: () => Date.parse("2026-07-20T19:00:00Z"),
    getActiveSymbols: () => ["SKYQ"],
    getActiveEntries: () => [{
      symbol: "SKYQ",
      tags: ["auto", "auto-main"],
      activatedAt,
      note: "Auto-selected during regular: qualification score 73; admission rank 81.21; current slot score 81.21; lifecycle: reactivated.",
    }],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  });

  try {
    selector.start();
    const entry = selector.getStatus().managedEntries.find((item) => item.symbol === "SKYQ");
    assert.equal(entry?.admissionAt, activatedAt);
    assert.equal(entry?.admissionQualificationScore, 73);
    assert.equal(entry?.admissionRankingScore, 81.21);
    assert.equal(entry?.admissionSlotSurvivalScore, 81.21);
    assert.equal(entry?.lastRankingScore, 95);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the 9:00 ET main-session reserve admits only three late tickers and survives restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-late-reserve-"));
  const configPath = join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    enabled: true,
    lastUpdated: Date.now(),
    thresholds: {
      maxAddsPerTradingDay: 1,
      lateMainSessionAdmissionReserve: 3,
      lateMainSessionAdmissionUnlockHourEastern: 9,
      consecutivePassesRequired: 1,
      dynamicReplacementEnabled: false,
      maxActiveMainSessionTickers: 10,
    },
    tradingDay: "2026-07-16",
    mainSessionAddedToday: ["FIRST"],
  }));
  let now = Date.parse("2026-07-16T12:59:00Z");
  let candidateSymbol = "EARLY";
  const active = new Set<string>();
  const activated: string[] = [];
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    data: {
      rows: [{
        symbol: candidateSymbol,
        name: `${candidateSymbol} Common Stock`,
        lastsale: "$2.00",
        pctchange: "20%",
        volume: "1000000",
        marketCap: "30000000",
      }],
    },
  }), { status: 200 });
  const finnhubClient = {
    getCompanyProfile: async (symbol: string) => ({
      ticker: symbol,
      marketCapitalization: 30,
      shareOutstanding: 15,
    }),
  } as unknown as FinnhubClient;
  const options = {
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    configPath,
    now: () => now,
    getActiveSymbols: () => [...active],
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol }: { symbol: string }) => {
      activated.push(symbol);
      active.add(symbol);
    },
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: ACTIVE_SESSION_LOOKUP,
  };
  const selector = new AutoWatchlistSelector(options);
  try {
    const beforeUnlock = await selector.runNow({ activate: true });
    assert.deepEqual(activated, []);
    assert.equal(beforeUnlock.lateMainSessionAdmissionReserveUnlocked, false);

    now = Date.parse("2026-07-16T13:00:00Z");
    for (const symbol of ["LATE1", "LATE2", "LATE3", "LATE4"]) {
      candidateSymbol = symbol;
      await selector.runNow({ activate: true });
    }
    const exhausted = selector.getStatus();
    assert.deepEqual(activated, ["LATE1", "LATE2", "LATE3"]);
    assert.equal(exhausted.lateMainSessionAdmissionReserveUnlocked, true);
    assert.equal(exhausted.lateMainSessionAdmissionReserveUsed, 3);
    assert.equal(exhausted.lateMainSessionAdmissionReserveAvailable, 0);

    selector.stop();
    candidateSymbol = "LATE5";
    const restored = new AutoWatchlistSelector(options);
    try {
      await restored.runNow({ activate: true });
      assert.deepEqual(activated, ["LATE1", "LATE2", "LATE3"]);
      assert.equal(restored.getStatus().lateMainSessionAdmissionReserveUsed, 3);
    } finally {
      restored.stop();
    }
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the late main-session reserve also extends an exhausted replacement quota", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-late-replacement-"));
  const configPath = join(directory, "config.json");
  const now = Date.parse("2026-07-16T13:00:00Z");
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    enabled: true,
    lastUpdated: now,
    thresholds: {
      maxActiveMainSessionTickers: 1,
      maxMainSessionReplacementsPerTradingDay: 0,
      lateMainSessionAdmissionReserve: 3,
      lateMainSessionAdmissionUnlockHourEastern: 9,
      consecutivePassesRequired: 1,
      minimumAutoHoldMinutes: 0,
      retentionFailureScansRequired: 1,
    },
    tradingDay: "2026-07-16",
    mainSessionAddedToday: ["OLD"],
    lateMainSessionAdmissionReserveUsed: 2,
    managedEntries: [{
      symbol: "OLD",
      bucket: "main",
      state: "active",
      firstAddedAt: now - 60_000,
      lastActivatedAt: now - 60_000,
      addedSession: "premarket",
      lastSession: "premarket",
      lastRankingScore: 40,
      lastQualifiedAt: now - 60_000,
      retentionFailures: 0,
      standbyAt: null,
      statusReason: "active before late replacement",
    }],
  }));
  const active = new Set(["OLD"]);
  const activated: string[] = [];
  const deactivated: string[] = [];
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    data: {
      rows: [{
        symbol: "NEW",
        name: "New Common Stock",
        lastsale: "$2.00",
        pctchange: "20%",
        volume: "1000000",
        marketCap: "30000000",
      }],
    },
  }), { status: 200 });
  const finnhubClient = {
    getCompanyProfile: async (symbol: string) => ({
      ticker: symbol,
      marketCapitalization: 30,
      shareOutstanding: 15,
    }),
  } as unknown as FinnhubClient;
  const sessionActivityLookup: AutoWatchlistSessionActivityLookup = async (input) =>
    Object.fromEntries(input.symbols.map((symbol) => [symbol, symbol === "OLD"
      ? {
          symbol,
          session: input.session,
          price: null,
          gainPct: null,
          sessionVolume: null,
          recent15mVolume: null,
          recent15mDollarVolume: null,
          quoteTime: null,
          quoteAgeMinutes: null,
          available: false,
        }
      : {
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
        }]));
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient,
    fetchImpl,
    configPath,
    now: () => now,
    getActiveSymbols: () => [...active],
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol }) => {
      activated.push(symbol);
      active.add(symbol);
    },
    deactivateSymbol: async (symbol) => {
      deactivated.push(symbol);
      active.delete(symbol);
    },
    setSymbolFollowup: async () => undefined,
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup,
  });
  try {
    const status = await selector.runNow({ activate: true });
    assert.deepEqual(deactivated, []);
    assert.deepEqual(activated, ["NEW"]);
    assert.deepEqual(status.followupSymbols, ["OLD"]);
    assert.equal(status.lateMainSessionAdmissionReserveUsed, 3);
    assert.equal(status.lateMainSessionAdmissionReserveAvailable, 0);
    assert.equal(status.recentReplacements[0]?.incomingSymbol, "NEW");
    assert.equal(status.recentReplacements[0]?.outgoingSymbol, "OLD");
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
  assert.deepEqual(preview.recentDecisions.map((decision) => decision.score), [68, 68, 68, 68]);
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

test("decelerating SKYQ-like activity lowers live rank instead of leaving a misleading 95", async () => {
  assert.equal(buildVolumeDecelerationRankPenalty({
    volumeAcceleration: 0.625,
    fullPenaltyAtRatio: 0.25,
    maxPenalty: 12,
  }), 6);
  assert.equal(buildVolumeDecelerationRankPenalty({
    volumeAcceleration: 0.2,
    fullPenaltyAtRatio: 0.25,
    maxPenalty: 12,
  }), 12);

  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-skyq-rank-"));
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient: {
      getCompanyProfile: async () => ({
        ticker: "SKYQ",
        marketCapitalization: 18.219654,
        floatingShare: 4.14,
        shareOutstanding: 4.79,
      }),
    } as unknown as FinnhubClient,
    fetchImpl: async () => new Response(JSON.stringify({
      data: {
        rows: [{
          symbol: "SKYQ",
          name: "Sky Quarry Inc. Common Stock",
          lastsale: "$4.725",
          pctchange: "24.3421%",
          volume: "13789966",
          marketCap: "18219654",
        }],
      },
    }), { status: 200 }),
    configPath: join(directory, "config.json"),
    now: () => Date.parse("2026-07-20T18:58:43Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup: NO_CATALYST_LOOKUP,
    requireVerifiedCommonEquity: false,
    sessionActivityLookup: async ({ session, now }) => ({
      SKYQ: {
        symbol: "SKYQ",
        session,
        price: 4.725,
        gainPct: 24.34210526315789,
        sessionVolume: 13_789_966.495912,
        sessionDollarVolume: 63_823_184.9025119,
        recent15mVolume: 247_535.071818,
        recent15mDollarVolume: 1_156_045.4149058545,
        sessionElapsedMinutes: 328,
        volumeAcceleration: 0.38141096455883716,
        quoteTime: Math.floor(now / 1000),
        quoteAgeMinutes: 0,
        available: true,
      },
    }),
  });

  try {
    const decision = (await selector.previewScan()).recentDecisions[0];
    assert.ok(decision);
    assert.equal(decision.score, 85);
    assert.equal(decision.volumeDecelerationRankPenalty, 9.9);
    assert.equal(decision.rankingScore, 90.1);
    assert.equal(decision.slotSurvivalScore, 91.1);
    assert.match(decision.rankingReasons.join(" "), /volume deceleration -9\.9 ranking points/);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
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

test("slot-survival scoring keeps a dominant live runner ahead of a marginal lower-float ticker", () => {
  const skyq = buildAutoWatchlistSlotSurvivalScore({ rankingScore: 95, gainPct: 22 });
  const zybt = buildAutoWatchlistSlotSurvivalScore({ rankingScore: 90, gainPct: 169 });

  assert.ok(zybt.slotSurvivalScore > skyq.slotSurvivalScore);
  assert.equal(zybt.slotSurvivalScore, 120);
  assert.match(zybt.slotSurvivalReasons[0] ?? "", /sustained runner gain/);
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
  assert.equal(preview.recentDecisions[0]?.promotionReady, true);
  assert.equal(preview.recentDecisions.find((decision) => decision.symbol === "LGPS"), undefined);
});

test("postmarket promotion holds a marginal pop even when acceleration would qualify it as an obvious runner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-watchlist-postmarket-promotion-"));
  const activated: string[] = [];
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    data: {
      rows: [{
        symbol: "VIVK",
        name: "Vivakor Inc. Common Stock",
        lastsale: "$2.17",
        pctchange: "1.2%",
        volume: "180000",
        marketCap: "2000000",
      }],
    },
  }), { status: 200 });
  const selector = new AutoWatchlistSelector({
    yahooClient: null,
    finnhubClient: {
      getCompanyProfile: async () => ({
        ticker: "VIVK",
        marketCapitalization: 2,
        floatingShare: 3.2,
        shareOutstanding: 4,
      }),
    } as unknown as FinnhubClient,
    fetchImpl,
    configPath: join(directory, "config.json"),
    thresholds: {
      extendedSessionCandidateLimit: 1,
      enrichmentLimit: 1,
      minGainPct: 5,
      minVolume: 100_000,
    },
    now: () => Date.parse("2026-07-17T22:30:00Z"),
    getActiveSymbols: () => [...activated],
    isRuntimeReady: () => true,
    activateSymbol: async ({ symbol }) => {
      activated.push(symbol);
    },
    catalystLookup: NO_CATALYST_LOOKUP,
    requireVerifiedCommonEquity: false,
    sessionActivityLookup: async ({ symbols, session, now }) => Object.fromEntries(
      symbols.map((symbol) => [symbol, {
        symbol,
        session,
        price: 2.31,
        gainPct: 6.2,
        sessionVolume: 180_000,
        sessionDollarVolume: 415_800,
        recent15mVolume: 52_000,
        recent15mDollarVolume: 120_000,
        sessionElapsedMinutes: 150,
        volumeAcceleration: 3.7,
        quoteTime: Math.floor(now / 1000),
        quoteAgeMinutes: 0,
        available: true,
      }]),
    ),
  });
  try {
    const status = await selector.runNow({ activate: true });
    const vivk = status.recentDecisions.find((decision) => decision.symbol === "VIVK");
    assert.ok(vivk);
    assert.equal(vivk.qualified, true);
    assert.equal(vivk.promotionReady, false);
    assert.match(vivk.promotionRejectionReasons.join(" "), /promotion gain must be at least 10%/i);
    assert.deepEqual(activated, []);
  } finally {
    selector.stop();
    await rm(directory, { recursive: true, force: true });
  }
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

test("postmarket discovery probes liquid names even when Nasdaq movers would otherwise fill the activity budget", async () => {
  const staleMoverRows = Array.from({ length: 8 }, (_, index) => ({
    symbol: `MVR${index}`,
    name: `Mover ${index} Corporation Common Stock`,
    lastsale: "$1.00",
    pctchange: "2%",
    volume: "1000000",
    marketCap: "10000000",
  }));
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes("/api/marketmovers")) {
      return new Response(JSON.stringify({
        data: {
          STOCKS: {
            MostAdvanced: {
              table: {
                rows: staleMoverRows.map((row) => ({
                  symbol: row.symbol,
                  name: row.name,
                  lastSalePrice: "$1.20",
                  lastSaleChange: "+0.20",
                  change: "+20%",
                  deltaIndicator: "up",
                })),
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
          ...staleMoverRows,
          {
            // The ADVB-shaped runner is only a modest regular-session gainer,
            // but its $9M+ regular-session dollar volume earns it an
            // extended-hours activity probe.
            symbol: "ADVB",
            name: "Advanced Biomed Inc. Common Stock",
            lastsale: "$5.03",
            pctchange: "2.653%",
            volume: "1846868",
            marketCap: "8310229",
          },
          {
            symbol: "GAIN",
            name: "Gain Leader Corporation Common Stock",
            lastsale: "$0.50",
            pctchange: "30%",
            volume: "200000",
            marketCap: "10000000",
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
      price: symbol === "ADVB" ? 7.05 : 1.2,
      gainPct: symbol === "ADVB" ? 40.16 : 10,
      sessionVolume: symbol === "ADVB" ? 2_500_000 : 1_000_000,
      sessionDollarVolume: symbol === "ADVB" ? 16_000_000 : 1_200_000,
      recent15mVolume: symbol === "ADVB" ? 60_000 : 100_000,
      recent15mDollarVolume: symbol === "ADVB" ? 423_000 : 120_000,
      sessionElapsedMinutes: 150,
      volumeAcceleration: 2,
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
        marketCapitalization: symbol === "ADVB" ? 8.3 : 10,
        floatingShare: 1,
        shareOutstanding: 10,
      }),
    } as unknown as FinnhubClient,
    fetchImpl,
    configPath: join(tmpdir(), "auto-watchlist-postmarket-liquid-probe-test.json"),
    thresholds: { extendedSessionCandidateLimit: 3, enrichmentLimit: 3 },
    now: () => Date.parse("2026-07-17T22:30:00Z"),
    getActiveSymbols: () => [],
    isRuntimeReady: () => true,
    activateSymbol: async () => undefined,
    catalystLookup: NO_CATALYST_LOOKUP,
    sessionActivityLookup: activityLookup,
  });

  const preview = await selector.previewScan();
  const advb = preview.recentDecisions.find((decision) => decision.symbol === "ADVB");
  assert.equal(lookedUpSymbols.includes("ADVB"), true);
  assert.ok(advb);
  assert.equal(advb.qualified, true);
  assert.equal(advb.gainPct, 40.16);
  assert.equal(advb.sourceScreens.includes("live_exchange_postmarket_activity"), true);
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
