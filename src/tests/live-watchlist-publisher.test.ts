import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  buildLiveWatchlistAlertPatch,
  buildLiveWatchlistLevelMap,
  buildLiveWatchlistPullbackReadPatch,
  buildLiveWatchlistSnapshotPatch,
  buildLiveWatchlistStatusPatch,
  buildLiveWatchlistTechnicalContextPatch,
  buildLiveWatchlistTickerDataPatch,
  buildTradersLinkAiReadStatusPatch,
  buildTradersLinkAiReadVisibilityPatch,
  LiveWatchlistHttpPublisher,
} from "../lib/live-watchlist/live-watchlist-publisher.js";
import { DurableLiveWatchlistPublisher } from "../lib/live-watchlist/live-watchlist-publish-outbox.js";
import type { LiveWatchlistTickerDataPatch } from "../lib/live-watchlist/live-watchlist-types.js";
import {
  buildRecentWebsiteArticlesPatch,
  deriveRecentWebsiteArticleCatalystFreshness,
  normalizeRecentWebsiteArticleLookupResult,
  publishRecentWebsiteArticlesForSymbol,
} from "../lib/live-watchlist/recent-website-articles.js";
import type { LevelSnapshotPayload } from "../lib/alerts/alert-types.js";
import type { TechnicalContext } from "../lib/technical-context/technical-context-types.js";

describe("live watchlist publisher", () => {
  it("builds an explicit pending AI Read status without fabricating a card", () => {
    const patch = buildTradersLinkAiReadStatusPatch({
      symbol: "abcd",
      status: "analyzing",
      updatedAt: 1234,
    });

    assert.equal(patch.symbol, "ABCD");
    assert.equal(patch.tradersLinkAiReadStatus, "analyzing");
    assert.deepEqual(patch.cards, {});
  });

  it("preserves stored article summaries and balanced points for the AI research packet", () => {
    const result = normalizeRecentWebsiteArticleLookupResult({
      ticker: "ABCD",
      businessDays: 5,
      count: 1,
      articles: [{
        ticker: "ABCD",
        title: "ABCD announces a clinical update",
        url: "https://traderslink.pro/news/abcd-update",
        summary: "The company reported a defined clinical milestone.",
        positives: ["The milestone was reached on the stated timeline.", ""],
        negatives: ["The update did not include efficacy data."],
      }],
    }, "ABCD");

    assert.deepEqual(result.articles[0]?.positives, [
      "The milestone was reached on the stated timeline.",
    ]);
    assert.deepEqual(result.articles[0]?.negatives, [
      "The update did not include efficacy data.",
    ]);
    assert.equal(result.articles[0]?.summary, "The company reported a defined clinical milestone.");
  });

  it("builds an independent dip-buy plan visibility patch", () => {
    const patch = buildTradersLinkAiReadVisibilityPatch({
      symbol: "tghl",
      dipBuyPlanVisible: false,
    });
    assert.equal(patch.symbol, "TGHL");
    assert.equal(patch.tradersLinkAiReadCardVisible, undefined);
    assert.equal(patch.tradersLinkAiReadDipBuyPlanVisible, false);
    assert.deepEqual(patch.cards, {});
  });

  it("durably replays an unacknowledged payload after publisher recovery", async () => {
    const directory = mkdtempSync(join(tmpdir(), "live-watchlist-outbox-"));
    const filePath = join(directory, "outbox.json");
    try {
      const failing = new DurableLiveWatchlistPublisher({
        async publish() {
          throw new Error("ingest unavailable");
        },
      }, filePath);
      await assert.rejects(
        failing.publish({ symbol: "RETRY", updatedAt: 1, cards: {} }),
        /ingest unavailable/,
      );
      assert.equal(failing.pendingCount(), 1);

      const published: string[] = [];
      const recovered = new DurableLiveWatchlistPublisher({
        async publish(patch) {
          published.push(patch.symbol);
        },
      }, filePath);
      await recovered.replayPending();
      assert.deepEqual(published, ["RETRY"]);
      assert.equal(recovered.pendingCount(), 0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps only the latest queued live quote for a symbol while delivery is unavailable", async () => {
    const directory = mkdtempSync(join(tmpdir(), "live-watchlist-outbox-coalesce-"));
    const filePath = join(directory, "outbox.json");
    try {
      const failing = new DurableLiveWatchlistPublisher({
        async publish() {},
        async publishTickerData() {
          throw new Error("ingest unavailable");
        },
      }, filePath);
      await assert.rejects(
        failing.publishTickerData({
          type: "tickerData",
          symbol: "QUEUE",
          updatedAt: 1,
          latestPrice: 1,
          nearestSupport: null,
          nearestResistance: null,
        }),
        /ingest unavailable/,
      );
      await assert.rejects(
        failing.publishTickerData({
          type: "tickerData",
          symbol: "QUEUE",
          updatedAt: 2,
          latestPrice: 1.25,
          nearestSupport: null,
          nearestResistance: null,
        }),
        /ingest unavailable/,
      );
      assert.equal(failing.pendingCount(), 1);

      const delivered: LiveWatchlistTickerDataPatch[] = [];
      const recovered = new DurableLiveWatchlistPublisher({
        async publish() {},
        async publishTickerData(patch) {
          delivered.push(patch);
        },
      }, filePath);
      await recovered.replayPending();
      assert.deepEqual(delivered.map((patch) => patch.latestPrice), [1.25]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("coalesces in-memory ticker bursts while one website delivery is in flight", async () => {
    const directory = mkdtempSync(join(tmpdir(), "live-watchlist-outbox-memory-coalesce-"));
    const filePath = join(directory, "outbox.json");
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const delivered: LiveWatchlistTickerDataPatch[] = [];

    try {
      const publisher = new DurableLiveWatchlistPublisher({
        async publish() {},
        async publishTickerData(patch) {
          delivered.push(patch);
          if (delivered.length === 1) {
            markFirstStarted();
            await firstRelease;
          }
        },
      }, filePath);
      const tickerPatch = (
        symbol: string,
        updatedAt: number,
        latestPrice: number,
      ): LiveWatchlistTickerDataPatch => ({
        type: "tickerData",
        symbol,
        updatedAt,
        latestPrice,
        nearestSupport: null,
        nearestResistance: null,
      });

      const first = publisher.publishTickerData(tickerPatch("BURST", 1, 1));
      await firstStarted;
      const second = publisher.publishTickerData(tickerPatch("BURST", 2, 1.1));
      const newest = publisher.publishTickerData(tickerPatch("BURST", 4, 1.4));
      const stale = publisher.publishTickerData(tickerPatch("BURST", 3, 1.3));
      const other = publisher.publishTickerData(tickerPatch("OTHER", 2, 5));
      releaseFirst();

      await Promise.all([first, second, newest, stale, other]);

      assert.deepEqual(
        delivered.map((patch) => [patch.symbol, patch.updatedAt, patch.latestPrice]),
        [
          ["BURST", 1, 1],
          ["BURST", 4, 1.4],
          ["OTHER", 2, 5],
        ],
      );
      assert.equal(publisher.pendingCount(), 0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("publishes a card update before the next queued ticker update", async () => {
    const directory = mkdtempSync(join(tmpdir(), "live-watchlist-outbox-priority-"));
    const filePath = join(directory, "outbox.json");
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const delivered: string[] = [];

    try {
      const publisher = new DurableLiveWatchlistPublisher({
        async publish(patch) {
          delivered.push(`card:${patch.symbol}`);
        },
        async publishTickerData(patch) {
          delivered.push(`ticker:${patch.symbol}`);
          if (patch.symbol === "FIRST") {
            markFirstStarted();
            await firstRelease;
          }
        },
      }, filePath);
      const ticker = (symbol: string): LiveWatchlistTickerDataPatch => ({
        type: "tickerData",
        symbol,
        updatedAt: 1,
        latestPrice: 1,
        nearestSupport: null,
        nearestResistance: null,
      });

      const first = publisher.publishTickerData(ticker("FIRST"));
      await firstStarted;
      const second = publisher.publishTickerData(ticker("SECOND"));
      const card = publisher.publish({ symbol: "URGENT", updatedAt: 2, cards: {} });
      releaseFirst();
      await Promise.all([first, second, card]);

      assert.deepEqual(delivered, ["ticker:FIRST", "card:URGENT", "ticker:SECOND"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  const readyTechnicalContext: TechnicalContext = {
    source: "levels_system_intraday",
    sourceTimeframe: "5m",
    provider: "ibkr",
    sessionDate: "2026-07-09",
    updatedAt: 1_000,
    candleCount: 42,
    currentPrice: 2,
    vwap: 1.9,
    ema9: 1.95,
    ema20: 1.8,
    priceVsVwapPct: 5,
    priceVsEma9Pct: 2.5,
    priceVsEma20Pct: 10,
    aboveVwap: true,
    aboveEma9: true,
    aboveEma20: true,
    confidence: "high",
    diagnostics: [],
  };

  it("builds card patches from level snapshots", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "ABCD",
      currentPrice: 2,
      timestamp: 1000,
      supportZones: [{
        representativePrice: 1.8,
        strengthLabel: "major",
        marketDataProvenance: {
          formedAt: 100,
          sourceLastSeenAt: 100,
          lastConfirmedAt: 900,
        },
      }],
      resistanceZones: [{ representativePrice: 2.3, strengthLabel: "major", sourceLabel: "intraday" }],
      technicalContext: readyTechnicalContext,
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload, { pullbackReadEnabled: false });

    assert.equal(patch.symbol, "ABCD");
    assert.equal(patch.levelMap?.rangeState, "wide");
    assert.deepEqual(patch.levelMap?.supportLevels[0]?.marketDataProvenance, {
      formedAt: 100,
      sourceLastSeenAt: 100,
      lastConfirmedAt: 900,
    });
    assert.equal(patch.cards.levelMap, null);
    assert.equal(patch.cards.nearestSupportResistance?.title, "Potential Path Levels");
    assert.doesNotMatch(patch.cards.nearestSupportResistance?.body ?? "", /Current price:/);
    assert.doesNotMatch(patch.cards.nearestSupportResistance?.body ?? "", /Tight decision zone:/);
    assert.doesNotMatch(patch.cards.nearestSupportResistance?.body ?? "", /Next stronger:/);
    assert.match(patch.cards.nearestSupportResistance?.body ?? "", /Support path:/);
    assert.match(patch.cards.nearestSupportResistance?.body ?? "", /Resistance path:/);
    assert.doesNotMatch(patch.cards.nearestSupportResistance?.body ?? "", /Needs to hold:/);
    assert.doesNotMatch(patch.cards.nearestSupportResistance?.body ?? "", /Must clear:|T1:|T2:/);
    assert.doesNotMatch(patch.cards.nearestSupportResistance?.body ?? "", /Overhead:/);
    assert.doesNotMatch(patch.cards.nearestSupportResistance?.body ?? "", /Nearest overhead:/);
    assert.equal(patch.cards.fullLadder?.priceWhenPosted, 2);
    assert.equal(
      patch.cards.nearestSupportResistance?.metadata?.nearestSupport,
      1.8,
    );
    assert.equal(
      patch.cards.nearestSupportResistance?.metadata?.nearestResistance,
      2.3,
    );
    assert.equal(
      patch.cards.nearestSupportResistance?.metadata?.nearestResistanceLabel,
      "2.30 (+15.0%, major, intraday)",
    );
    assert.doesNotMatch(
      patch.cards.liveTraderRead?.body ?? "",
      /^ABCD support and resistance|^Price:|^Level context:/m,
    );
    assert.doesNotMatch(
      patch.cards.liveTraderRead?.body ?? "",
      /Closest levels to watch:/,
    );
    assert.match(
      String(patch.cards.liveTraderRead?.metadata?.headline ?? ""),
      /^Current Read:/,
    );
    assert.equal(patch.cards.technicalContext?.title, "Technical Context");
    assert.match(patch.cards.technicalContext?.body ?? "", /bullish short-term posture/);
  });

  it("dedupes Full Ladder rows that round to the same displayed price", () => {
    const patch = buildLiveWatchlistSnapshotPatch({
      symbol: "ROUND",
      currentPrice: 12,
      timestamp: 1_000,
      supportZones: [
        { representativePrice: 11.166, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 11.174, strengthLabel: "weak", sourceLabel: "daily structure" },
      ],
      resistanceZones: [
        { representativePrice: 12.5, strengthLabel: "strong", sourceLabel: "daily structure" },
      ],
    }, { pullbackReadEnabled: false });
    const body = patch.cards.fullLadder?.body ?? "";

    assert.equal(body.match(/^11\.17 \(/gm)?.length, 1);
  });

  it("keeps pullback read disabled when explicitly opted out", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "ABCD",
      currentPrice: 2.2,
      timestamp: 1000,
      supportZones: [{ representativePrice: 1.95, strengthLabel: "major", sourceLabel: "daily" }],
      resistanceZones: [{ representativePrice: 2.5, strengthLabel: "major", sourceLabel: "daily" }],
      technicalContext: {
        ...readyTechnicalContext,
        currentPrice: 2.2,
        priceVsVwapPct: 15.8,
        priceVsEma9Pct: 12.8,
        priceVsEma20Pct: 22.2,
      },
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload, { pullbackReadEnabled: false });

    assert.doesNotMatch(patch.cards.liveTraderRead?.body ?? "", /Move phase:/);
    assert.equal(patch.cards.liveTraderRead?.metadata?.pullbackReadEnabled, undefined);
  });

  it("publishes a deterministic lifecycle read only when requested", () => {
    const base = {
      symbol: "ABCD",
      timestamp: 1_000,
      currentPrice: 2,
      supportZones: [{ representativePrice: 1.8, strengthLabel: "major" as const }],
      resistanceZones: [{ representativePrice: 2.3, strengthLabel: "major" as const }],
      technicalContext: readyTechnicalContext,
      pullbackReadEnabled: true,
    };

    const hidden = buildLiveWatchlistPullbackReadPatch(base);
    const visible = buildLiveWatchlistPullbackReadPatch({ ...base, includeLifecycle: true });

    assert.equal(hidden?.watchlistLifecycle, undefined);
    assert.equal(visible?.watchlistLifecycle?.status, "active");
    assert.match(visible?.watchlistLifecycle?.reason ?? "", /VWAP and EMA9/i);
  });

  it("derives Pullback Watch from five-minute candle structure and VWAP rather than HOD distance", () => {
    const patch = buildLiveWatchlistPullbackReadPatch({
      symbol: "CANDLE",
      timestamp: 1_000,
      currentPrice: 1.92,
      supportZones: [{ representativePrice: 1.4, strengthLabel: "weak", sourceLabel: "intraday" }],
      resistanceZones: [{ representativePrice: 2.3, strengthLabel: "major", sourceLabel: "daily" }],
      technicalContext: {
        ...readyTechnicalContext,
        currentPrice: 1.92,
        vwap: 1.9,
        ema9: 1.95,
        ema20: 1.8,
        priceVsVwapPct: 1.05,
        priceVsEma9Pct: -1.54,
        priceVsEma20Pct: 6.67,
        aboveVwap: true,
        aboveEma9: false,
        aboveEma20: true,
      },
      marketStructure: {
        timeframes: {
          "5m": {
            stable: {
              state: "pullback_to_structure",
              previousState: "higher_lows_intact",
              structureKey: "pullback_to_structure|range:1.900-2.150",
              materialChange: true,
              confidence: "high",
              materialityScore: 0.72,
              rawState: "pullback_to_structure",
              reason: "persistent_material_change",
              candleCount: 48,
              rawRunLength: 3,
              trendDirection: "uptrend",
              higherLowCount: 2,
              lowerHighCount: 0,
              higherHighCount: 1,
              lowerLowCount: 0,
              latestSwingLow: 1.9,
              latestSwingHigh: 2.15,
              priorSwingLow: 1.72,
              priorSwingHigh: 2.04,
              activeRangeLow: 1.9,
              activeRangeHigh: 2.15,
              activeRangeWidthPct: 0.1316,
              activeRangeQuality: "clean",
              pivotEventType: "none",
              pivotEventTriggerPrice: null,
            },
          },
        },
      },
      pullbackReadEnabled: true,
      includeLifecycle: true,
    });

    assert.equal(patch?.watchlistLifecycle?.status, "pullback_watch");
    assert.match(patch?.watchlistLifecycle?.reason ?? "", /five-minute candles/i);
    assert.doesNotMatch(patch?.watchlistLifecycle?.reason ?? "", /HOD|percent|ATR/i);
  });

  it("includes chart thesis context in the live trader read card", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "ABCD",
      currentPrice: 2.2,
      timestamp: 1000,
      supportZones: [{ representativePrice: 1.95, strengthLabel: "major", sourceLabel: "daily" }],
      resistanceZones: [{ representativePrice: 2.5, strengthLabel: "major", sourceLabel: "daily" }],
      potentialMoveRead: {
        type: "catalyst_active_runner_continuation",
        label: "same-day catalyst runner continuation",
        timeframe: "4h",
        status: "active",
        confidence: "medium",
        score: 90,
        targetLow: 3.1,
        targetHigh: 3.1,
        invalidationLevel: 1.95,
        roomToTargetPct: 40.9,
        evidence: ["same-day catalyst card"],
        lines: [
          "ABCD has a same-day catalyst card and an active 4h runner candle.",
          "If buyers hold the upper half, the measured continuation area is near 3.10.",
        ],
      },
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload, { pullbackReadEnabled: false });
    const traderRead = patch.cards.liveTraderRead?.body ?? "";

    assert.match(traderRead, /Chart Thesis/);
    assert.match(traderRead, /same-day catalyst card/);
    assert.doesNotMatch(traderRead, /Current Read:/);
    assert.doesNotMatch(traderRead, /Breakout Area To Watch:/);
    assert.doesNotMatch(traderRead, /Pullback Zones:/);
    assert.doesNotMatch(traderRead, /Closest levels to watch:/);
  });

  it("keeps chart thesis primary when pullback phase context is also available", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "ABCD",
      currentPrice: 2.2,
      timestamp: 1000,
      supportZones: [{ representativePrice: 1.95, strengthLabel: "major", sourceLabel: "daily" }],
      resistanceZones: [{ representativePrice: 2.5, strengthLabel: "major", sourceLabel: "daily" }],
      technicalContext: {
        ...readyTechnicalContext,
        currentPrice: 2.2,
        priceVsVwapPct: 15.8,
        priceVsEma9Pct: 12.8,
        priceVsEma20Pct: 22.2,
      },
      potentialMoveRead: {
        type: "catalyst_active_runner_continuation",
        label: "same-day catalyst runner continuation",
        timeframe: "4h",
        status: "active",
        confidence: "medium",
        score: 90,
        targetLow: 3.1,
        targetHigh: 3.1,
        invalidationLevel: 1.95,
        roomToTargetPct: 40.9,
        evidence: ["same-day catalyst card"],
        lines: [
          "ABCD has a same-day catalyst card and an active 4h runner candle.",
          "If buyers hold the upper half, the measured continuation area is near 3.10.",
        ],
      },
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload);
    const traderRead = patch.cards.liveTraderRead?.body ?? "";

    assert.match(traderRead, /^Chart Thesis/);
    assert.match(traderRead, /Pullback \/ Tape Read:/);
    assert.match(traderRead, /Move phase: extended/);
    assert.doesNotMatch(traderRead, /Level read:/);
    assert.doesNotMatch(traderRead, /Current Read:/);
  });

  it("enriches the trader read with a pullback phase read by default", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "ABCD",
      currentPrice: 2.2,
      timestamp: 1000,
      supportZones: [{ representativePrice: 1.95, strengthLabel: "major", sourceLabel: "daily" }],
      resistanceZones: [{ representativePrice: 2.5, strengthLabel: "major", sourceLabel: "daily" }],
      technicalContext: {
        ...readyTechnicalContext,
        currentPrice: 2.2,
        priceVsVwapPct: 15.8,
        priceVsEma9Pct: 12.8,
        priceVsEma20Pct: 22.2,
      },
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload);
    const traderRead = patch.cards.liveTraderRead?.body ?? "";

    assert.match(traderRead, /^ABCD Extended/);
    assert.match(traderRead, /Move phase: extended/);
    assert.doesNotMatch(traderRead, /Volume read: unknown/);
    assert.match(traderRead, /Needs to hold: 1\.95 nearest support \| 1\.80 EMA20\./);
    assert.match(traderRead, /Continuation trigger: reclaim\/hold above 2\.50 with fresh confirmation\./);
    assert.doesNotMatch(traderRead, /Level read:/);
    assert.equal(patch.cards.liveTraderRead?.metadata?.pullbackReadEnabled, true);
    assert.equal(patch.cards.liveTraderRead?.metadata?.pullbackPhase, "extended");
    assert.equal(patch.cards.liveTraderRead?.metadata?.pullbackVolumeLabel, "unknown");
    assert.equal(patch.cards.liveTraderRead?.metadata?.pullbackFallback1, 1.95);
  });

  it("uses near-term EMA holds and role-flipped structure for higher-priced runner pullbacks", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "VEEE",
      currentPrice: 22.4,
      timestamp: 1000,
      supportZones: [
        { representativePrice: 11.84, strengthLabel: "major", freshness: "stale", sourceLabel: "daily confluence" },
      ],
      resistanceZones: [
        { representativePrice: 17.69, strengthLabel: "major", freshness: "stale", sourceLabel: "daily confluence" },
        { representativePrice: 23.05, strengthLabel: "strong", freshness: "stale", sourceLabel: "daily confluence" },
      ],
      technicalContext: {
        ...readyTechnicalContext,
        provider: "yahoo",
        currentPrice: 22.4,
        vwap: 15.04,
        ema9: 21.53,
        ema20: 21.97,
        priceVsVwapPct: 32.8571,
        priceVsEma9Pct: 3.8839,
        priceVsEma20Pct: 1.9196,
        aboveVwap: true,
        aboveEma9: true,
        aboveEma20: true,
      },
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload);
    const traderRead = patch.cards.liveTraderRead?.body ?? "";

    assert.equal(patch.levelMap?.nearestSupport?.price, 17.69);
    assert.equal(patch.levelMap?.nearestSupport?.roleFlipFromSide, "resistance");
    assert.match(traderRead, /^VEEE Extended/);
    assert.match(traderRead, /Needs to hold: 21\.97 EMA20 \| 21\.53 EMA9 \| 17\.69 nearest support\./);
    assert.match(traderRead, /Continuation trigger: reclaim\/hold above 23\.05 with fresh confirmation\./);
    assert.equal(patch.cards.liveTraderRead?.metadata?.pullbackFallback1, 21.97);
    assert.equal(patch.cards.liveTraderRead?.metadata?.pullbackFallback2, 21.53);
    assert.equal(patch.cards.liveTraderRead?.metadata?.pullbackFallback3, 17.69);
  });

  it("does not promote weak nearby levels or distant resistance into must-hold breakout guidance", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "VEEE",
      currentPrice: 26.35,
      timestamp: 1000,
      supportZones: [
        { representativePrice: 25, strengthLabel: "weak", freshness: "fresh", sourceLabel: "fresh intraday" },
      ],
      resistanceZones: [
        { representativePrice: 30, strengthLabel: "weak", freshness: "fresh", sourceLabel: "fresh intraday" },
        { representativePrice: 38.665, strengthLabel: "moderate", freshness: "stale", sourceLabel: "4h structure" },
      ],
      technicalContext: {
        ...readyTechnicalContext,
        provider: "yahoo",
        currentPrice: 26.35,
        vwap: 16.35,
        ema9: 25.72,
        ema20: 23.88,
        priceVsVwapPct: 61.1621,
        priceVsEma9Pct: 2.4495,
        priceVsEma20Pct: 10.379,
        aboveVwap: true,
        aboveEma9: true,
        aboveEma20: true,
      },
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload);
    const traderRead = patch.cards.liveTraderRead?.body ?? "";

    assert.match(traderRead, /^VEEE Extended/);
    assert.doesNotMatch(traderRead, /25\.00 nearest support/);
    assert.doesNotMatch(traderRead, /Continuation trigger: reclaim\/hold above 38\.66/);
    assert.match(traderRead, /Needs to hold: 25\.72 EMA9 \| 16\.35 VWAP/);
    assert.match(traderRead, /Next higher resistance: 38\.66 is \+46\.7% away; no clean nearby breakout trigger/);
    assert.equal(patch.cards.liveTraderRead?.metadata?.pullbackFallback1, 25.72);
    assert.equal(patch.cards.liveTraderRead?.metadata?.pullbackFallback2, 16.35);
    assert.equal(patch.cards.liveTraderRead?.metadata?.pullbackContinuationTrigger, null);
    assert.equal(patch.cards.liveTraderRead?.metadata?.pullbackNextPathResistance, 38.665);
  });

  it("uses nearby support as the first hold for lower-priced extended runners", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "FTRK",
      currentPrice: 0.6935,
      timestamp: 1000,
      supportZones: [
        { representativePrice: 0.6516, strengthLabel: "moderate", freshness: "fresh", sourceLabel: "fresh intraday" },
      ],
      resistanceZones: [
        { representativePrice: 0.75, strengthLabel: "strong", freshness: "fresh", sourceLabel: "fresh intraday" },
      ],
      technicalContext: {
        ...readyTechnicalContext,
        provider: "yahoo",
        currentPrice: 0.6935,
        vwap: 0.553,
        ema9: 0.62,
        ema20: 0.613,
        priceVsVwapPct: 25.4,
        priceVsEma9Pct: 11.9,
        priceVsEma20Pct: 13.1,
        aboveVwap: true,
        aboveEma9: true,
        aboveEma20: true,
      },
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload);
    const traderRead = patch.cards.liveTraderRead?.body ?? "";

    assert.match(traderRead, /^FTRK Extended/);
    assert.match(traderRead, /Needs to hold: 0\.6516 nearest support \| 0\.5530 VWAP\./);
    assert.equal(patch.cards.liveTraderRead?.metadata?.pullbackFallback1, 0.6516);
    assert.equal(patch.cards.liveTraderRead?.metadata?.pullbackFallback2, 0.553);
  });

  it("builds potential path levels from the full ladder while preferring daily and 4h structure", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "HAO",
      currentPrice: 1.63,
      timestamp: 1000,
      supportZones: [
        { representativePrice: 1.58, strengthLabel: "weak", sourceLabel: "fresh intraday" },
      ],
      resistanceZones: [
        { representativePrice: 1.65, strengthLabel: "weak", sourceLabel: "fresh intraday" },
      ],
      ladderSupportZones: [
        { representativePrice: 1.58, strengthLabel: "weak", sourceLabel: "fresh intraday" },
        { representativePrice: 1.34, strengthLabel: "strong", sourceLabel: "daily structure" },
        { representativePrice: 1.22, strengthLabel: "moderate", sourceLabel: "4h structure" },
      ],
      ladderResistanceZones: [
        { representativePrice: 1.65, strengthLabel: "weak", sourceLabel: "fresh intraday" },
        { representativePrice: 2.04, strengthLabel: "strong", sourceLabel: "daily confluence" },
        { representativePrice: 2.176, strengthLabel: "moderate", sourceLabel: "daily structure" },
        { representativePrice: 2.688, strengthLabel: "moderate", sourceLabel: "daily structure" },
      ],
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload);
    const pathLevelsBody = patch.cards.nearestSupportResistance?.body ?? "";
    const traderRead = patch.cards.liveTraderRead?.body ?? "";

    assert.match(patch.cards.fullLadder?.body ?? "", /1\.65 \(\+1\.2%, light, fresh intraday\)/);
    assert.match(patch.cards.fullLadder?.body ?? "", /2\.04 \(\+25\.2%, heavy, daily confluence\)/);
    assert.match(pathLevelsBody, /1\.65 \(\+1\.2%, weak, intraday\)/);
    assert.match(pathLevelsBody, /2\.04 \(\+25\.2%, strong, daily confluence\)/);
    assert.match(pathLevelsBody, /1\.58 \(-3\.1%, weak, intraday\)/);
    assert.match(pathLevelsBody, /1\.34 \(-17\.8%, strong, daily structure\)/);
    assert.match(traderRead, /1\.65/);
    assert.match(traderRead, /2\.04/);
    assert.match(traderRead, /1\.58/);
    assert.match(traderRead, /1\.34/);
    assert.match(traderRead, /nearby gate, not the material target/);
    assert.match(traderRead, /not a material small-cap pullback zone by itself/);
    assert.equal(patch.levelMap?.nearestResistance?.price, 1.65);
    assert.equal(patch.levelMap?.nearestSupport?.price, 1.58);
    assert.equal(patch.cards.nearestSupportResistance?.metadata?.resistanceCount, 4);
  });

  it("omits freshness wording from potential path labels while preserving freshness metadata", () => {
    const patch = buildLiveWatchlistSnapshotPatch({
      symbol: "FRESH",
      currentPrice: 1,
      timestamp: 1000,
      supportZones: [
        { representativePrice: 0.72, strengthLabel: "major", freshness: "stale", sourceLabel: "daily confluence" },
      ],
      resistanceZones: [
        { representativePrice: 1.28, strengthLabel: "strong", freshness: "fresh", sourceLabel: "4h structure" },
      ],
    });

    const pathLevelsBody = patch.cards.nearestSupportResistance?.body ?? "";

    assert.match(pathLevelsBody, /1\.28 \(\+28\.0%, strong, 4h structure\)/);
    assert.match(pathLevelsBody, /0\.7200 \(-28\.0%, major, daily confluence\)/);
    assert.doesNotMatch(pathLevelsBody, /fresh reaction|aging context|older context/);
    assert.equal(patch.levelMap?.resistanceLevels[0]?.freshness, "fresh");
    assert.equal(patch.levelMap?.supportLevels[0]?.freshness, "stale");
  });

  it("keeps reliable 5m ATR classification internal for every Potential Path level", () => {
    const patch = buildLiveWatchlistSnapshotPatch({
      symbol: "ATRX",
      currentPrice: 10,
      timestamp: 1_000,
      supportZones: [
        { representativePrice: 9.9, strengthLabel: "strong", sourceLabel: "4h structure" },
        { representativePrice: 9, strengthLabel: "strong", sourceLabel: "daily structure" },
      ],
      resistanceZones: [
        { representativePrice: 10.75, strengthLabel: "strong", sourceLabel: "daily structure" },
        { representativePrice: 11.5, strengthLabel: "strong", sourceLabel: "4h structure" },
      ],
      roleFlipContext: {
        atrPct: 0.05,
        atrValue: 0.5,
        atrPeriod: 14,
        atrTimeframe: "5m",
        atrCompletedCandleCount: 30,
        atrReliability: "reliable",
      },
    }, { pullbackReadEnabled: false });

    assert.equal(patch.levelMap?.nearestSupport?.distanceAtr, 0.2);
    assert.equal(patch.levelMap?.nearestSupport?.atrDistanceState, "inside_normal_noise");
    assert.equal(patch.levelMap?.nearestResistance?.distanceAtr, 1.5);
    assert.equal(patch.levelMap?.nearestResistance?.atrDistanceState, "meaningful");
    const allPotentialPathLevels = [
      ...(patch.levelMap?.supportLevels ?? []),
      ...(patch.levelMap?.resistanceLevels ?? []),
    ];
    assert.deepEqual(
      allPotentialPathLevels.map((level) => level.distanceAtr),
      [0.2, 2, 1.5, 3],
    );
    assert.ok(allPotentialPathLevels.every((level) => Boolean(level.atrDistanceState)));
    assert.ok(
      allPotentialPathLevels.every(
        (level) => !/ATR|normal 5m movement|meaningful room|meaningful separation/i.test(level.label),
      ),
    );
    assert.doesNotMatch(
      patch.cards.nearestSupportResistance?.body ?? "",
      /ATR|normal 5m movement|meaningful room|meaningful separation/i,
    );
    assert.equal(patch.cards.nearestSupportResistance?.metadata?.atr5m, 0.5);
    assert.equal(patch.cards.nearestSupportResistance?.metadata?.nearestSupportDistanceAtr, 0.2);
  });

  it("suppresses ATR level wording when the ATR window is unstable", () => {
    const levelMap = buildLiveWatchlistLevelMap({
      currentPrice: 10,
      supportZones: [{ representativePrice: 9.9, strengthLabel: "strong" }],
      resistanceZones: [{ representativePrice: 10.75, strengthLabel: "strong" }],
      roleFlipContext: {
        atrPct: 0.05,
        atrValue: 0.5,
        atrReliability: "unstable",
      },
    });

    assert.equal(levelMap?.volatilityContext, undefined);
    assert.equal(levelMap?.nearestSupport?.distanceAtr, undefined);
    assert.doesNotMatch(levelMap?.nearestSupport?.label ?? "", /ATR|normal 5m movement/);
  });

  it("uses ATR clustering on Potential Path while keeping the Full Ladder complete", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "ATRP",
      currentPrice: 10,
      timestamp: 1_000,
      supportZones: [{ representativePrice: 9, strengthLabel: "strong", sourceLabel: "daily structure" }],
      resistanceZones: [
        { representativePrice: 10.1, strengthLabel: "weak", sourceLabel: "intraday" },
        { representativePrice: 10.4, strengthLabel: "strong", sourceLabel: "daily structure" },
        { representativePrice: 11.2, strengthLabel: "strong", sourceLabel: "4h structure" },
      ],
      roleFlipContext: {
        atrPct: 0.1,
        atrValue: 1,
        atrPeriod: 14,
        atrTimeframe: "5m",
        atrCompletedCandleCount: 30,
        atrReliability: "reliable",
      },
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload, { pullbackReadEnabled: false });
    const pathBody = patch.cards.nearestSupportResistance?.body ?? "";
    const fullLadderBody = patch.cards.fullLadder?.body ?? "";

    assert.deepEqual(
      patch.levelMap?.resistanceLevels.map((level) => level.price),
      [10.4, 11.2],
    );
    assert.doesNotMatch(pathBody, /10\.10/);
    assert.match(pathBody, /10\.40/);
    assert.match(fullLadderBody, /10\.10/);
    assert.match(fullLadderBody, /10\.40/);

    const fullContextMap = buildLiveWatchlistLevelMap({
      currentPrice: payload.currentPrice,
      supportZones: payload.supportZones,
      resistanceZones: payload.resistanceZones,
      preferStructuralLevels: true,
      roleFlipContext: payload.roleFlipContext,
      selectionMode: "full_context",
    });
    assert.equal(fullContextMap?.volatilityContext, undefined);
    assert.equal(fullContextMap?.resistanceLevels.some((level) => level.price === 10.1), true);
    assert.equal(fullContextMap?.resistanceLevels.some((level) => level.price === 10.4), true);
  });

  it("keeps tight level clutter and deep reset support out of the fallback trader read plan", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "SDOT",
      currentPrice: 23.47,
      timestamp: 1000,
      supportZones: [
        { representativePrice: 23.13, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 20.41, strengthLabel: "major", sourceLabel: "daily structure" },
        { representativePrice: 20, strengthLabel: "major", sourceLabel: "daily structure" },
      ],
      resistanceZones: [
        { representativePrice: 23.86, strengthLabel: "major", sourceLabel: "4h structure" },
        { representativePrice: 26.1, strengthLabel: "major", sourceLabel: "daily structure" },
      ],
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload, { pullbackReadEnabled: false });
    const traderRead = patch.cards.liveTraderRead?.body ?? "";

    assert.match(traderRead, /tight nearby level cluster/);
    assert.match(traderRead, /small pushes inside that band are noise/);
    assert.doesNotMatch(traderRead, /range-bound between moderate support 23\.13 and major resistance 23\.86/);
    assert.match(traderRead, /first material upside map area is major resistance 26\.10 \(\+11\.2%\)/);
    assert.match(traderRead, /First real support below that is major support 20\.41 \(-13\.0%\); that is a deeper reset area, not a routine pullback zone/);
    assert.doesNotMatch(traderRead, /First pullback area: major support 20\.41/);
  });

  it("keeps tiny small-cap references out of the pullback trader read", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "SCAP",
      currentPrice: 2,
      timestamp: 1000,
      supportZones: [{ representativePrice: 1.96, strengthLabel: "major", sourceLabel: "daily" }],
      resistanceZones: [{ representativePrice: 2.05, strengthLabel: "major", sourceLabel: "daily" }],
      technicalContext: {
        ...readyTechnicalContext,
        currentPrice: 2,
        vwap: 1.96,
        ema9: 1.95,
        ema20: 1.94,
        priceVsVwapPct: 2,
        priceVsEma9Pct: 2.6,
        priceVsEma20Pct: 3.1,
      },
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload);
    const traderRead = patch.cards.liveTraderRead?.body ?? "";

    assert.match(traderRead, /no clean pullback area yet/);
    assert.match(traderRead, /no clean higher path level on the current map yet/);
    assert.doesNotMatch(traderRead, /1\.96 nearest support/);
    assert.doesNotMatch(traderRead, /2\.05 with fresh 1m\/5m confirmation/);
  });

  it("builds concise technical context cards from local indicators", () => {
    const patch = buildLiveWatchlistTechnicalContextPatch({
      symbol: "abcd",
      timestamp: 2_000,
      currentPrice: 2.05,
      technicalContext: readyTechnicalContext,
    });

    assert.equal(patch?.symbol, "ABCD");
    assert.equal(patch?.cards.technicalContext?.title, "Technical Context");
    assert.equal(patch?.cards.technicalContext?.priceWhenPosted, 2.05);
    assert.match(
      patch?.cards.technicalContext?.body ?? "",
      /^Levels: VWAP 1\.90 \(\+7\.3%\) \| EMA9 1\.95 \(\+4\.9%\) \| EMA20 1\.80 \(\+12\.2%\)\./,
    );
    assert.match(
      patch?.cards.technicalContext?.body ?? "",
      /EMA read: bullish short-term posture\. Price is above EMA9 and EMA20\./,
    );
    assert.match(
      patch?.cards.technicalContext?.body ?? "",
      /VWAP read: bullish intraday posture\. Price is \+7\.3% above VWAP\./,
    );
    assert.doesNotMatch(patch?.cards.technicalContext?.body ?? "", /Data:/);
    assert.doesNotMatch(patch?.cards.technicalContext?.body ?? "", /volume-weighted average price/);
    assert.doesNotMatch(patch?.cards.technicalContext?.body ?? "", /Pullback refs below:/);
    assert.doesNotMatch(patch?.cards.technicalContext?.body ?? "", /bid planning areas before price gets there/);
    assert.equal(patch?.cards.technicalContext?.metadata?.aboveEma9, true);
    assert.equal(patch?.cards.technicalContext?.metadata?.aboveEma20, true);
    assert.ok(Number(patch?.cards.technicalContext?.metadata?.priceVsVwapPct) > 7);
  });

  it("uses bearish language when price is below VWAP and short-term EMAs", () => {
    const patch = buildLiveWatchlistTechnicalContextPatch({
      symbol: "abcd",
      timestamp: 2_000,
      currentPrice: 1.7,
      technicalContext: readyTechnicalContext,
    });

    assert.match(patch?.cards.technicalContext?.body ?? "", /bearish short-term posture/);
    assert.match(patch?.cards.technicalContext?.body ?? "", /bearish intraday posture/);
    assert.doesNotMatch(patch?.cards.technicalContext?.body ?? "", /Reclaim refs above:/);
    assert.doesNotMatch(patch?.cards.technicalContext?.body ?? "", /improve posture after a weaker read/);
    assert.equal(patch?.cards.technicalContext?.metadata?.aboveVwap, false);
    assert.equal(patch?.cards.technicalContext?.metadata?.aboveEma9, false);
    assert.equal(patch?.cards.technicalContext?.metadata?.aboveEma20, false);
  });

  it("clears the technical context card when indicators are unavailable", () => {
    const patch = buildLiveWatchlistTechnicalContextPatch({
      symbol: "thin",
      timestamp: 2_000,
      currentPrice: 2.05,
      technicalContext: {
        ...readyTechnicalContext,
        candleCount: 0,
        currentPrice: null,
        vwap: null,
        ema9: null,
        ema20: null,
        priceVsVwapPct: null,
        priceVsEma9Pct: null,
        priceVsEma20Pct: null,
        aboveVwap: null,
        aboveEma9: null,
        aboveEma20: null,
        confidence: "unavailable",
        diagnostics: ["5m:unavailable"],
      },
    });

    assert.equal(patch?.symbol, "THIN");
    assert.equal(patch?.cards.technicalContext, null);
  });

  it("builds a tight level map from existing support and resistance zones", () => {
    const levelMap = buildLiveWatchlistLevelMap({
      currentPrice: 2,
      supportZones: [
        { representativePrice: 1.98, strengthLabel: "moderate", sourceLabel: "intraday" },
        { representativePrice: 1.75, strengthLabel: "major", sourceLabel: "daily" },
      ],
      resistanceZones: [
        { representativePrice: 2.03, strengthLabel: "moderate", sourceLabel: "intraday" },
        { representativePrice: 2.4, strengthLabel: "major", sourceLabel: "4h" },
      ],
    });

    assert.equal(levelMap?.rangeState, "tight");
    assert.equal(levelMap?.nearestSupport?.price, 1.98);
    assert.equal(levelMap?.nearestResistance?.price, 2.03);
    assert.equal(levelMap?.nextStrongSupport?.price, 1.75);
    assert.equal(levelMap?.nextStrongResistance?.price, 2.4);
    assert.equal(levelMap?.nearestSupport?.label, "1.98 (-1.0%, moderate, intraday)");
    assert.equal(levelMap?.nearestResistance?.label, "2.03 (+1.5%, moderate, intraday)");
  });

  it("uses trader-facing strength and source labels in closest level labels", () => {
    const levelMap = buildLiveWatchlistLevelMap({
      currentPrice: 0.9469,
      supportZones: [],
      resistanceZones: [
        { representativePrice: 1.07, strengthLabel: "strong", sourceLabel: "daily confluence" },
        { representativePrice: 1.12, strengthLabel: "major", sourceLabel: "daily structure" },
      ],
    });

    assert.equal(
      levelMap?.resistanceLevels[0]?.label,
      "1.07 (+13.0%, strong, daily confluence)",
    );
    assert.equal(
      levelMap?.resistanceLevels[1]?.label,
      "1.12 (+18.3%, major, daily structure)",
    );
  });

  it("orders level map ladders nearest first", () => {
    const levelMap = buildLiveWatchlistLevelMap({
      currentPrice: 10,
      supportZones: [
        { representativePrice: 6, strengthLabel: "major" },
        { representativePrice: 9.5, strengthLabel: "weak" },
        { representativePrice: 8.5, strengthLabel: "strong" },
        { representativePrice: 7.5, strengthLabel: "moderate" },
        { representativePrice: 7, strengthLabel: "moderate" },
      ],
      resistanceZones: [
        { representativePrice: 13, strengthLabel: "moderate" },
        { representativePrice: 10.5, strengthLabel: "weak" },
        { representativePrice: 11.5, strengthLabel: "major" },
        { representativePrice: 12.5, strengthLabel: "strong" },
      ],
    });

    assert.deepEqual(levelMap?.supportLevels.map((level) => level.price), [9.5, 8.5, 7.5, 7, 6]);
    assert.deepEqual(levelMap?.resistanceLevels.map((level) => level.price), [10.5, 11.5, 12.5, 13]);
    assert.equal(levelMap?.nextStrongSupport?.price, 8.5);
    assert.equal(levelMap?.nextStrongResistance?.price, 11.5);
  });

  it("keeps nearby structural levels without automatically adding the farthest anchor", () => {
    const levelMap = buildLiveWatchlistLevelMap({
      currentPrice: 10,
      supportZones: [],
      resistanceZones: [
        { representativePrice: 10.5, strengthLabel: "weak", sourceLabel: "fresh intraday" },
        { representativePrice: 11.5, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 12.5, strengthLabel: "moderate", sourceLabel: "daily structure" },
        { representativePrice: 13, strengthLabel: "weak", sourceLabel: "fresh intraday" },
        { representativePrice: 13.5, strengthLabel: "strong", sourceLabel: "daily confluence" },
        { representativePrice: 15, strengthLabel: "major", sourceLabel: "daily confluence" },
      ],
    });

    assert.deepEqual(
      levelMap?.resistanceLevels.map((level) => level.price),
      [10.5, 11.5, 12.5, 13, 13.5],
    );
  });

  it("keeps a hidden far anchor in Full Ladder while omitting it from Potential Path", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "GAPX",
      currentPrice: 1,
      timestamp: 1_000,
      supportZones: [
        { representativePrice: 0.9, strengthLabel: "strong", sourceLabel: "daily structure" },
      ],
      resistanceZones: [
        { representativePrice: 1.1, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 1.2, strengthLabel: "strong", sourceLabel: "daily structure" },
        { representativePrice: 2.95, strengthLabel: "major", sourceLabel: "daily confluence" },
      ],
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload, { pullbackReadEnabled: false });

    assert.deepEqual(
      patch.levelMap?.resistanceLevels.map((level) => level.price),
      [1.1, 1.2],
    );
    assert.match(patch.cards.fullLadder?.body ?? "", /2\.95/);
  });

  it("does not escape the 50 percent Potential Path cap when a side has a real vacuum", () => {
    const levelMap = buildLiveWatchlistLevelMap({
      currentPrice: 10,
      supportZones: [
        { representativePrice: 3.6, strengthLabel: "major", sourceLabel: "daily confluence" },
        { representativePrice: 2.5, strengthLabel: "strong", sourceLabel: "daily structure" },
      ],
      resistanceZones: [],
    });

    assert.deepEqual(levelMap?.supportLevels.map((level) => level.price), []);
  });

  it("keeps only the nearest detected checkpoint between 30 and 50 percent", () => {
    const levelMap = buildLiveWatchlistLevelMap({
      currentPrice: 15.74,
      supportZones: [],
      resistanceZones: [
        { representativePrice: 20.89, strengthLabel: "weak", sourceLabel: "4h structure" },
        { representativePrice: 21.95, strengthLabel: "weak", sourceLabel: "daily structure" },
        { representativePrice: 22.56, strengthLabel: "weak", sourceLabel: "4h structure" },
      ],
    });

    assert.deepEqual(levelMap?.resistanceLevels.map((level) => level.price), [20.89]);
  });

  it("uses market-data confirmation time to choose between stacked equal-quality levels", () => {
    const levelMap = buildLiveWatchlistLevelMap({
      currentPrice: 1,
      supportZones: [],
      resistanceZones: [
        {
          representativePrice: 1.1,
          strengthLabel: "strong",
          sourceLabel: "daily confluence",
          freshness: "fresh",
          marketDataProvenance: { formedAt: 900, sourceLastSeenAt: 900 },
        },
        {
          representativePrice: 1.115,
          strengthLabel: "strong",
          sourceLabel: "daily confluence",
          freshness: "fresh",
          marketDataProvenance: {
            formedAt: 100,
            sourceLastSeenAt: 950,
            lastConfirmedAt: 950,
          },
        },
      ],
    });

    assert.deepEqual(levelMap?.resistanceLevels.map((level) => level.price), [1.115]);
  });

  it("consolidates stacked small-cap steps and keeps one checkpoint between 30 and 50 percent", () => {
    const levelMap = buildLiveWatchlistLevelMap({
      currentPrice: 0.64,
      supportZones: [],
      resistanceZones: [
        { representativePrice: 0.65, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 0.66, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 0.7, strengthLabel: "major", sourceLabel: "daily structure" },
        { representativePrice: 0.7432, strengthLabel: "strong", sourceLabel: "4h structure" },
        { representativePrice: 0.75, strengthLabel: "major", sourceLabel: "daily confluence" },
        { representativePrice: 0.8, strengthLabel: "strong", sourceLabel: "daily structure" },
        { representativePrice: 0.83, strengthLabel: "major", sourceLabel: "daily confluence" },
        { representativePrice: 0.95, strengthLabel: "major", sourceLabel: "daily confluence" },
      ],
    });

    assert.deepEqual(
      levelMap?.resistanceLevels.map((level) => level.price),
      [0.65, 0.7, 0.75, 0.8, 0.83, 0.95],
    );
    assert.equal(levelMap?.resistanceLevels.some((level) => level.price === 0.7432), false);
  });

  it("reserves one Potential Path slot for the nearest checkpoint over 30 percent", () => {
    const levelMap = buildLiveWatchlistLevelMap({
      currentPrice: 10,
      supportZones: [],
      resistanceZones: [
        10.3,
        10.6,
        10.9,
        11.2,
        11.5,
        11.8,
        12.1,
        12.4,
      ].map((representativePrice) => ({
        representativePrice,
        strengthLabel: "moderate" as const,
        sourceLabel: "4h structure",
      })).concat([
        {
          representativePrice: 13.5,
          strengthLabel: "weak" as const,
          sourceLabel: "continuation map",
        } as any,
        {
          representativePrice: 14.2,
          strengthLabel: "strong" as const,
          sourceLabel: "daily structure",
        } as any,
      ]),
    });

    assert.deepEqual(
      levelMap?.resistanceLevels.map((level) => level.price),
      [10.3, 10.6, 10.9, 11.2, 11.5, 11.8, 12.1, 13.5],
    );
  });

  it("keeps TGHL-style strong resistance near 88 percent in Full Ladder only", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "TGHL",
      currentPrice: 1.32,
      timestamp: 1_000,
      supportZones: [],
      resistanceZones: [
        { representativePrice: 1.43, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 1.5, strengthLabel: "moderate", sourceLabel: "daily structure" },
        { representativePrice: 1.65, strengthLabel: "moderate", sourceLabel: "daily structure" },
        { representativePrice: 1.71, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 2.48, strengthLabel: "strong", sourceLabel: "daily confluence" },
      ],
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload, { pullbackReadEnabled: false });

    assert.deepEqual(
      patch.levelMap?.resistanceLevels.map((level) => level.price),
      [1.43, 1.5, 1.65, 1.71],
    );
    assert.doesNotMatch(patch.cards.nearestSupportResistance?.body ?? "", /2\.48/);
    assert.match(patch.cards.fullLadder?.body ?? "", /2\.48/);
  });

  it("keeps one strong daily confluence checkpoint just beyond 30 percent", () => {
    const patch = buildLiveWatchlistTickerDataPatch({
      symbol: "ZBAO",
      lastPrice: 0.4215,
      timestamp: 1_000,
      supportZones: [
        { representativePrice: 0.41, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 0.4, strengthLabel: "strong" },
        { representativePrice: 0.35, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 0.296, strengthLabel: "moderate" },
        { representativePrice: 0.291, strengthLabel: "strong", sourceLabel: "daily confluence" },
      ],
      resistanceZones: [],
    });

    assert.ok(patch?.levelMap);
    assert.deepEqual(
      patch.levelMap.supportLevels.map((level) => level.price),
      [0.41, 0.35, 0.291],
    );
    assert.equal(
      patch.levelMap.supportLevels.at(-1)?.label,
      "0.2910 (-31.0%, strong, daily confluence)",
    );
    assert.equal(
      patch.levelMap.supportLevels.some((level) => level.price === 0.296),
      false,
    );
  });

  it("suppresses weaker visual-stack levels around stronger structural support", () => {
    const patch = buildLiveWatchlistTickerDataPatch({
      symbol: "ZBAO",
      lastPrice: 0.4215,
      timestamp: 1_000,
      supportZones: [
        { representativePrice: 0.41, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 0.4, strengthLabel: "strong", sourceLabel: "daily confluence" },
        { representativePrice: 0.296, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 0.291, strengthLabel: "strong", sourceLabel: "daily confluence" },
      ],
      resistanceZones: [],
    });

    assert.ok(patch?.levelMap);
    assert.deepEqual(
      patch.levelMap.supportLevels.map((level) => level.price),
      [0.41, 0.4, 0.291],
    );
    assert.equal(
      patch.levelMap.supportLevels.some((level) => level.price === 0.296),
      false,
    );
    assert.equal(patch.levelMap.supportLevels.some((level) => level.price === 0.291), true);
  });

  it("builds a usable level map when one side is missing", () => {
    const levelMap = buildLiveWatchlistLevelMap({
      currentPrice: 5,
      supportZones: [{ representativePrice: 4.5, strengthLabel: "strong" }],
      resistanceZones: [],
    });

    assert.equal(levelMap?.rangeState, "normal");
    assert.equal(levelMap?.nearestSupport?.price, 4.5);
    assert.equal(levelMap?.nearestResistance, null);
    assert.deepEqual(levelMap?.resistanceLevels, []);
  });

  it("moves levels across support and resistance when live price crosses them", () => {
    const levelMap = buildLiveWatchlistLevelMap({
      currentPrice: 21.04,
      supportZones: [
        { representativePrice: 26.6, strengthLabel: "strong", sourceLabel: "daily confluence" },
        { representativePrice: 26.01, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 22.89, strengthLabel: "strong", sourceLabel: "daily confluence" },
        { representativePrice: 20.39, strengthLabel: "moderate", sourceLabel: "4h structure" },
      ],
      resistanceZones: [
        { representativePrice: 19.31, strengthLabel: "strong", sourceLabel: "daily confluence" },
        { representativePrice: 27.5, strengthLabel: "moderate", sourceLabel: "daily structure" },
      ],
    });

    assert.ok(levelMap);
    assert.equal(levelMap?.nearestSupport?.price, 20.39);
    assert.equal(levelMap?.nearestResistance?.price, 22.89);
    assert.equal(levelMap?.nearestSupport?.roleFlipFromSide, null);
    assert.equal(levelMap?.nearestResistance?.roleFlipFromSide, "support");
    assert.equal("nearestOverhead" in levelMap, false);
    assert.equal("overheadLevels" in levelMap, false);
    assert.deepEqual(levelMap?.supportLevels.map((level) => level.price), [20.39, 19.31]);
    assert.deepEqual(levelMap?.resistanceLevels.map((level) => level.price), [22.89, 26.01, 26.6, 27.5]);
    assert.equal(levelMap?.supportLevels[1]?.roleFlipFromSide, "resistance");
  });

  it("keeps levels on their original side until a role flip is confirmed", () => {
    const nearBoundary = buildLiveWatchlistLevelMap({
      currentPrice: 99.9,
      supportZones: [
        { representativePrice: 100, strengthLabel: "strong", sourceLabel: "daily confluence" },
        { representativePrice: 95, strengthLabel: "moderate", sourceLabel: "4h structure" },
      ],
      resistanceZones: [
        { representativePrice: 105, strengthLabel: "moderate", sourceLabel: "daily structure" },
      ],
    });

    assert.equal(nearBoundary?.nearestSupport?.price, 100);
    assert.equal(nearBoundary?.nearestSupport?.roleFlipFromSide, null);
    assert.equal(
      nearBoundary?.resistanceLevels.some((level) => level.price === 100),
      false,
    );

    const confirmedBreak = buildLiveWatchlistLevelMap({
      currentPrice: 99.7,
      supportZones: [
        { representativePrice: 100, strengthLabel: "strong", sourceLabel: "daily confluence" },
        { representativePrice: 95, strengthLabel: "moderate", sourceLabel: "4h structure" },
      ],
      resistanceZones: [
        { representativePrice: 105, strengthLabel: "moderate", sourceLabel: "daily structure" },
      ],
    });

    assert.equal(confirmedBreak?.nearestSupport?.price, 95);
    assert.equal(confirmedBreak?.nearestResistance?.price, 100);
    assert.equal(confirmedBreak?.nearestResistance?.roleFlipFromSide, "support");
  });

  it("does not show the same boundary as both support and resistance", () => {
    const underBoundary = buildLiveWatchlistLevelMap({
      currentPrice: 2.438,
      supportZones: [
        { representativePrice: 2.44, strengthLabel: "major", sourceLabel: "daily confluence" },
        { representativePrice: 2.3, strengthLabel: "major", sourceLabel: "daily confluence" },
      ],
      resistanceZones: [
        { representativePrice: 2.44, strengthLabel: "major", sourceLabel: "daily confluence" },
        { representativePrice: 2.62, strengthLabel: "major", sourceLabel: "daily confluence" },
      ],
    });

    assert.equal(underBoundary?.nearestSupport?.price, 2.3);
    assert.equal(underBoundary?.nearestResistance?.price, 2.44);
    assert.equal(
      underBoundary?.supportLevels.some((level) => level.price === 2.44),
      false,
    );

    const overBoundary = buildLiveWatchlistLevelMap({
      currentPrice: 2.442,
      supportZones: [
        { representativePrice: 2.44, strengthLabel: "major", sourceLabel: "daily confluence" },
        { representativePrice: 2.3, strengthLabel: "major", sourceLabel: "daily confluence" },
      ],
      resistanceZones: [
        { representativePrice: 2.44, strengthLabel: "major", sourceLabel: "daily confluence" },
        { representativePrice: 2.62, strengthLabel: "major", sourceLabel: "daily confluence" },
      ],
    });

    assert.equal(overBoundary?.nearestSupport?.price, 2.44);
    assert.equal(overBoundary?.nearestResistance?.price, 2.62);
    assert.equal(
      overBoundary?.resistanceLevels.some((level) => level.price === 2.44),
      false,
    );
  });

  it("uses crossed levels for ticker-data nearest support and resistance labels", () => {
    const patch = buildLiveWatchlistTickerDataPatch({
      symbol: "JLHL",
      lastPrice: 21.04,
      timestamp: 1_000,
      supportZones: [
        { representativePrice: 26.01, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 22.89, strengthLabel: "major", sourceLabel: "daily confluence" },
        { representativePrice: 20.39, strengthLabel: "moderate", sourceLabel: "4h structure" },
      ],
      resistanceZones: [
        { representativePrice: 19.31, strengthLabel: "strong", sourceLabel: "daily confluence" },
        { representativePrice: 27.5, strengthLabel: "moderate", sourceLabel: "daily structure" },
      ],
    });

    assert.equal(patch?.nearestSupport, 20.39);
    assert.equal(patch?.nearestResistance, 22.89);
    assert.equal(patch?.nearestSupportLabel, "20.39 (-3.1%, moderate, 4h structure)");
    assert.equal(patch?.nearestResistanceLabel, "22.89 (+8.8%, major, daily confluence)");
    assert.equal(patch?.levelMap?.supportLevels[1]?.roleFlipFromSide, "resistance");
    assert.equal(patch?.levelMap?.nearestResistance?.roleFlipFromSide, "support");
  });

  it("maps stock context alerts to company info cards", () => {
    const patch = buildLiveWatchlistAlertPatch({
      title: "",
      body: [
        "Current price: 1.23",
        "",
        "Company: Example Corp",
        "Exchange: Nasdaq",
        "Industry: Biotechnology",
        "Country: China",
        "Market cap: 12.30M",
      ].join("\n"),
      symbol: "EXMP",
      timestamp: 2000,
      metadata: {
        messageKind: "stock_context",
      },
    });

    assert.equal(patch?.cards.companyInfo?.title, "Example Corp");
    assert.equal(patch?.cards.companyInfo?.metadata?.industry, "Biotechnology");
    assert.equal(patch?.cards.companyInfo?.metadata?.country, "China");
    assert.equal(patch?.cards.companyInfo?.metadata?.marketCap, "12.30M");
    assert.equal(patch?.cards.companyInfo?.priceWhenPosted, 1.23);
    assert.equal(patch?.firstPostedAt, 2000);
    assert.match(patch?.cards.companyInfo?.body ?? "", /Country: China \(High Risk Country\)/);
    assert.doesNotMatch(patch?.cards.companyInfo?.body ?? "", /Current price:/);
    assert.doesNotMatch(patch?.cards.companyInfo?.body ?? "", /Levels are loading/);
  });

  it("uses explicit fallback copy when stock context has no usable company profile", () => {
    const patch = buildLiveWatchlistAlertPatch({
      title: "",
      body: [
        "Current price: 1.23",
        "",
        "Company: JLHL",
        "",
        "Levels are loading.",
      ].join("\n"),
      symbol: "JLHL",
      timestamp: 2000,
      metadata: {
        messageKind: "stock_context",
      },
    });

    assert.equal(patch?.cards.companyInfo?.title, "Company Info");
    assert.equal(patch?.cards.companyInfo?.body, "couldn't get company info");
    assert.equal(patch?.cards.companyInfo?.metadata?.company, null);
    assert.equal(patch?.cards.companyInfo?.metadata?.highRiskCountry, false);
    assert.equal(patch?.cards.companyInfo?.priceWhenPosted, 1.23);
  });

  it("reports terminal publish failures and still rejects the caller", async () => {
    let handled = false;
    const publisher = new LiveWatchlistHttpPublisher({
      ingestUrl: "https://example.invalid/ingest",
      token: "test",
      retryAttempts: 0,
      fetchImpl: async () => new Response("nope", { status: 500 }),
      onError: () => {
        handled = true;
      },
    });

    await assert.rejects(
      publisher.publish({
        symbol: "FAIL",
        updatedAt: 1,
        cards: {},
      }),
      /failed with 500/,
    );

    assert.equal(handled, true);
  });

  it("publishes market data health patches independently from card patches", async () => {
    let publishedBody: unknown = null;
    const publisher = new LiveWatchlistHttpPublisher({
      ingestUrl: "https://example.test/ingest",
      token: "test",
      retryAttempts: 0,
      fetchImpl: async (_url, init) => {
        publishedBody = JSON.parse(String(init?.body));
        return new Response("ok", { status: 200 });
      },
    });

    await publisher.publishHealth({
      type: "health",
      marketDataStatus: "live",
      marketDataUpdatedAt: 1234,
    });

    assert.deepEqual(publishedBody, {
      type: "health",
      marketDataStatus: "live",
      marketDataUpdatedAt: 1234,
    });
  });

  it("builds live ticker data patches with nearest levels from current price", () => {
    const patch = buildLiveWatchlistTickerDataPatch({
      symbol: "abcd",
      lastPrice: 2,
      timestamp: 3000,
      volume: 123_456,
      supportZones: [
        { representativePrice: 1.5, strengthLabel: "moderate" },
        { representativePrice: 1.9, strengthLabel: "major", sourceLabel: "intraday" },
      ],
      resistanceZones: [
        { representativePrice: 2.1, strengthLabel: "strong", sourceLabel: "intraday" },
        { representativePrice: 2.8, strengthLabel: "major" },
      ],
    });

    assert.equal(patch?.type, "tickerData");
    assert.equal(patch?.symbol, "ABCD");
    assert.equal(patch?.latestPrice, 2);
    assert.equal(patch?.volume, 123_456);
    assert.equal(patch?.nearestSupport, 1.9);
    assert.equal(patch?.nearestResistance, 2.1);
    assert.equal(patch?.nearestSupportLabel, "1.90 (-5.0%, major, intraday)");
    assert.equal(patch?.nearestResistanceLabel, "2.10 (+5.0%, strong, intraday)");
    assert.equal(patch?.levelMap?.nearestSupport?.price, 1.9);
    assert.equal(patch?.levelMap?.supportLevels.length, 2);
  });

  it("includes extended quote data in ticker data patches when provided", () => {
    const patch = buildLiveWatchlistTickerDataPatch({
      symbol: "abcd",
      lastPrice: 2,
      timestamp: 3000,
      supportZones: [],
      resistanceZones: [],
      extendedQuote: {
        source: "eodhd_live_v2",
        symbol: "ABCD",
        providerSymbol: "ABCD.US",
        updatedAt: 3000,
        fetchedAt: 3010,
        name: "Example Corp",
        exchange: "XNAS",
        currency: "USD",
        open: 1.9,
        high: 2.1,
        low: 1.8,
        lastTradePrice: 2,
        lastTradeSize: 100,
        lastTradeTime: 3000,
        bidPrice: 1.99,
        bidSize: 4,
        bidTime: 3001,
        askPrice: 2.01,
        askSize: 6,
        askTime: 3002,
        volume: 100_000,
        change: 0.1,
        changePercent: 5,
        previousClosePrice: 1.9,
        ethPrice: null,
        ethVolume: null,
        ethTime: null,
        marketCap: 50_000_000,
        sharesOutstanding: 20_000_000,
        sharesFloat: 12_000_000,
        timestamp: 3000,
      },
    });

    assert.equal(patch?.extendedQuote?.providerSymbol, "ABCD.US");
    assert.equal(patch?.extendedQuote?.bidPrice, 1.99);
    assert.equal(patch?.extendedQuote?.askPrice, 2.01);
    assert.equal(patch?.priorRegularClosePrice, 1.9);
    assert.ok(Math.abs((patch?.moveFromPriorRegularClosePct ?? 0) - ((2 - 1.9) / 1.9) * 100) < 0.000001);
    assert.equal(patch?.priorRegularCloseSource, "EODHD regular close");
  });

  it("computes move from explicit prior regular close data", () => {
    const patch = buildLiveWatchlistTickerDataPatch({
      symbol: "move",
      lastPrice: 2.5,
      timestamp: 3000,
      supportZones: [],
      resistanceZones: [],
      priorRegularClosePrice: 2,
      priorRegularCloseSource: "Finnhub regular close",
    });

    assert.equal(patch?.priorRegularClosePrice, 2);
    assert.equal(patch?.moveFromPriorRegularClosePct, 25);
    assert.equal(patch?.priorRegularCloseSource, "Finnhub regular close");
  });

  it("publishes ticker data patches independently from card patches", async () => {
    let publishedBody: unknown = null;
    const publisher = new LiveWatchlistHttpPublisher({
      ingestUrl: "https://example.test/ingest",
      token: "test",
      retryAttempts: 0,
      fetchImpl: async (_url, init) => {
        publishedBody = JSON.parse(String(init?.body));
        return new Response("ok", { status: 200 });
      },
    });

    await publisher.publishTickerData({
      type: "tickerData",
      symbol: "ABCD",
      status: "live",
      updatedAt: 3000,
      latestPrice: 2,
      nearestSupport: 1.9,
      nearestResistance: 2.1,
    });

    assert.deepEqual(publishedBody, {
      type: "tickerData",
      symbol: "ABCD",
      status: "live",
      updatedAt: 3000,
      latestPrice: 2,
      nearestSupport: 1.9,
      nearestResistance: 2.1,
    });
  });

  it("builds status-only patches for website ticker deactivation", () => {
    const patch = buildLiveWatchlistStatusPatch({
      symbol: "abcd",
      status: "deactivated",
      updatedAt: 4000,
      firstPostedAt: 3000,
    });

    assert.deepEqual(patch, {
      symbol: "ABCD",
      status: "deactivated",
      updatedAt: 4000,
      firstPostedAt: 3000,
      cards: {},
    });
  });

  it("builds recent news and SEC filings card patches from website article lookup results", () => {
    const patch = buildRecentWebsiteArticlesPatch({
      symbol: "aapl",
      updatedAt: 5000,
      result: {
        ticker: "AAPL",
        businessDays: 5,
        count: 1,
        articles: [
          {
            ticker: "AAPL",
            title: "Apple files an 8-K",
            url: "https://traderslink.pro/news/apple-files-8-k",
            publishedAt: "2026-06-19T14:00:00.000Z",
            eventType: "press_release",
            filingType: "8-K",
          },
        ],
      },
    });

    assert.equal(patch?.symbol, "AAPL");
    assert.equal(patch?.cards.recentNewsFilings?.title, "Known Recent News / SEC Filings");
    assert.equal(patch?.cards.recentNewsFilings?.source, "website_article_lookup");
    assert.match(
      patch?.cards.recentNewsFilings?.body ?? "",
      /https:\/\/traderslink\.pro\/news\/apple-files-8-k/,
    );
    assert.equal(patch?.cards.recentNewsFilings?.metadata?.articleCount, 1);
  });

  it("keeps the original website link when route-specific posts duplicate an article", () => {
    const patch = buildRecentWebsiteArticlesPatch({
      symbol: "RANI",
      updatedAt: 5000,
      result: {
        ticker: "RANI",
        businessDays: 5,
        count: 3,
        articles: [
          {
            ticker: "RANI",
            title: "RANI inks R&D deal with PegBio",
            url: "https://traderslink.pro/news/RANI/rani-deal-2026-07-09-efa02f",
            publishedAt: "2026-07-09T20:05:51.227Z",
          },
          {
            ticker: "RANI",
            title: "  RANI inks R&D deal   with PegBio ",
            url: "https://traderslink.pro/news/RANI/rani-deal-2026-07-09",
            publishedAt: "2026-07-09T20:05:01.206Z",
          },
          {
            ticker: "RANI",
            title: "RANI inks R&D deal with PegBio",
            url: "https://traderslink.pro/news/RANI/rani-deal-2026-07-10",
            publishedAt: "2026-07-10T20:05:01.206Z",
          },
        ],
      },
    });

    const body = JSON.parse(patch?.cards.recentNewsFilings?.body ?? "{}") as {
      articles?: Array<{ url: string }>;
    };
    assert.deepEqual(
      body.articles?.map((article) => article.url),
      [
        "https://traderslink.pro/news/RANI/rani-deal-2026-07-10",
        "https://traderslink.pro/news/RANI/rani-deal-2026-07-09",
      ],
    );
    assert.equal(patch?.cards.recentNewsFilings?.metadata?.articleCount, 2);
  });

  it("does not build a recent news card when no website articles are found", () => {
    const patch = buildRecentWebsiteArticlesPatch({
      symbol: "AAPL",
      result: {
        ticker: "AAPL",
        businessDays: 5,
        count: 0,
        articles: [],
      },
    });

    assert.equal(patch, null);
  });

  it("does not reject activation-adjacent publishing when website article lookup fails", async () => {
    let warning = "";
    let publishCount = 0;
    await publishRecentWebsiteArticlesForSymbol({
      symbol: "AAPL",
      publisher: {
        async publish() {
          publishCount += 1;
        },
      },
      execFileImpl: async () => {
        throw new Error("lookup failed");
      },
      logger: {
        warn(message) {
          warning = message;
        },
      },
    });

    assert.equal(publishCount, 0);
    assert.match(warning, /lookup failed/);
  });

  it("classifies recent website article freshness by New York trading date", () => {
    const result = {
      ticker: "AAPL",
      businessDays: 7,
      count: 1,
      articles: [
        {
          ticker: "AAPL",
          title: "Apple announces news",
          url: "https://traderslink.pro/news/apple-announces-news",
          publishedAt: "2026-06-19T13:45:00.000Z",
        },
      ],
    };

    assert.equal(
      deriveRecentWebsiteArticleCatalystFreshness({
        result,
        referenceTimeMs: Date.parse("2026-06-19T19:30:00.000Z"),
      }),
      "same_day",
    );
    assert.equal(
      deriveRecentWebsiteArticleCatalystFreshness({
        result,
        referenceTimeMs: Date.parse("2026-06-21T19:30:00.000Z"),
      }),
      "recent_1_2_days",
    );
    assert.equal(
      deriveRecentWebsiteArticleCatalystFreshness({
        result,
        referenceTimeMs: Date.parse("2026-06-24T19:30:00.000Z"),
      }),
      "stale_3_7_days",
    );
  });

  it("maps JTAI-style extreme-gap risk boundaries after the last structural support breaks", () => {
    const patch = buildLiveWatchlistSnapshotPatch({
      symbol: "JTAI",
      currentPrice: 4.37,
      timestamp: Date.parse("2026-07-15T14:00:00.000Z"),
      priorRegularClosePrice: 0.4617,
      priorRegularCloseSource: "Nasdaq regular close",
      supportZones: [
        { representativePrice: 4.86, strengthLabel: "moderate", sourceLabel: "daily structure" },
        { representativePrice: 4.46, strengthLabel: "moderate", sourceLabel: "4h structure" },
      ],
      resistanceZones: [
        { representativePrice: 5.7, strengthLabel: "major", sourceLabel: "daily confluence" },
      ],
      specialLevels: {
        premarketLow: 3.82,
        premarketHigh: 7.32,
        openingRangeLow: 4.28,
        openingRangeHigh: 5.01,
        currentSessionLow: 4.31,
        currentSessionHigh: 5.01,
      },
      technicalContext: {
        ...readyTechnicalContext,
        currentPrice: 4.37,
        vwap: 4.87,
        ema9: 4.61,
        ema20: 4.75,
        priceVsVwapPct: -10.27,
        priceVsEma9Pct: -5.21,
        priceVsEma20Pct: -8,
        aboveVwap: false,
        aboveEma9: false,
        aboveEma20: false,
      },
    });

    assert.deepEqual(
      patch.levelMap?.supportLevels.map((level) => level.price),
      [4.31, 3.82],
    );
    assert.equal(patch.levelMap?.nearestResistance?.price, 4.46);
    assert.match(
      patch.cards.nearestSupportResistance?.body ?? "",
      /5\.01 .*opening range high resistance/,
    );
    assert.match(
      patch.cards.nearestSupportResistance?.body ?? "",
      /5\.70 .*daily confluence/,
    );
    assert.match(patch.cards.fullLadder?.body ?? "", /5\.70 .*daily confluence/);
    assert.match(
      patch.cards.nearestSupportResistance?.body ?? "",
      /4\.31 .*session low risk boundary/,
    );
    assert.match(
      patch.cards.nearestSupportResistance?.body ?? "",
      /3\.82 .*premarket gap floor/,
    );
    assert.doesNotMatch(
      patch.cards.nearestSupportResistance?.body ?? "",
      /0\.4617/,
    );
    assert.match(patch.cards.fullLadder?.body ?? "", /0\.4617 .*prior-close gap origin/);
    assert.match(patch.cards.liveTraderRead?.body ?? "", /Extreme gap \/ price discovery/);
    assert.match(patch.cards.liveTraderRead?.body ?? "", /Failure below 3\.82: open-air gap risk/);
    assert.equal(patch.cards.liveTraderRead?.metadata?.extremeGapActive, true);
    assert.equal(patch.cards.liveTraderRead?.metadata?.extremeGapPremarketLow, 3.82);
  });

  it("flips a failed extreme-gap floor into the reclaim path while retaining lower risk landmarks", () => {
    const patch = buildLiveWatchlistSnapshotPatch({
      symbol: "JTAI",
      currentPrice: 3.79,
      timestamp: Date.parse("2026-07-15T14:15:00.000Z"),
      priorRegularClosePrice: 0.4617,
      supportZones: [],
      resistanceZones: [
        { representativePrice: 5.7, strengthLabel: "major", sourceLabel: "daily confluence" },
      ],
      ladderSupportZones: [],
      ladderResistanceZones: [
        { representativePrice: 5.7, strengthLabel: "major", sourceLabel: "daily confluence" },
      ],
      specialLevels: {
        premarketLow: 3.82,
        premarketHigh: 7.32,
        openingRangeLow: 4,
        openingRangeHigh: 5.01,
        currentSessionLow: 3.33,
        currentSessionHigh: 5.01,
      },
      technicalContext: {
        ...readyTechnicalContext,
        currentPrice: 3.79,
        vwap: 4.84,
        ema9: 4,
        ema20: 4.35,
        priceVsVwapPct: -21.7,
        priceVsEma9Pct: -5.25,
        priceVsEma20Pct: -12.87,
        aboveVwap: false,
        aboveEma9: false,
        aboveEma20: false,
      },
    });

    assert.equal(patch.levelMap?.nearestSupport?.price, 3.33);
    assert.equal(patch.levelMap?.nearestResistance?.price, 3.82);
    assert.equal(patch.levelMap?.nearestResistance?.roleFlipFromSide, "support");
    assert.deepEqual(
      patch.levelMap?.resistanceLevels.map((level) => level.price),
      [3.82, 4, 5.01],
    );
    assert.match(
      patch.cards.nearestSupportResistance?.body ?? "",
      /Resistance path:[\s\S]*3\.82 .*premarket gap floor/,
    );
    assert.match(patch.cards.fullLadder?.body ?? "", /Resistance:[\s\S]*3\.82 .*premarket gap floor/);
    assert.match(patch.cards.fullLadder?.body ?? "", /5\.01 .*opening range high resistance/);
    assert.match(patch.cards.fullLadder?.body ?? "", /5\.70 .*daily confluence/);
    assert.match(patch.cards.fullLadder?.body ?? "", /Support:[\s\S]*0\.4617 .*prior-close gap origin/);
    assert.match(patch.cards.liveTraderRead?.body ?? "", /Premarket floor 3\.82 has failed/);
    assert.match(patch.cards.liveTraderRead?.body ?? "", /Continuation trigger: reclaim\/hold above 3\.82/);
  });
});
