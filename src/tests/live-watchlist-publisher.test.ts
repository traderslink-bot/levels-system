import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLiveWatchlistAlertPatch,
  buildLiveWatchlistSnapshotPatch,
  buildLiveWatchlistStatusPatch,
  buildLiveWatchlistTickerDataPatch,
  buildTradersLinkAiReadPatch,
  buildTradersLinkAiReadVisibilityPatch,
  LiveWatchlistHttpPublisher,
} from "../lib/live-watchlist/live-watchlist-publisher.js";
import {
  buildRecentWebsiteArticlesPatch,
  publishRecentWebsiteArticlesForSymbol,
} from "../lib/live-watchlist/recent-website-articles.js";
import type { LevelSnapshotPayload } from "../lib/alerts/alert-types.js";
import type { MonitoringEvent } from "../lib/monitoring/monitoring-types.js";
import type { TradersLinkAiReadPayload } from "../lib/live-watchlist/live-watchlist-types.js";

function testMonitoringEvent(symbol = "EXMP", timestamp = 2000): MonitoringEvent {
  return {
    id: `${symbol}-event`,
    episodeId: `${symbol}-episode`,
    symbol,
    type: "breakout",
    eventType: "breakout",
    zoneId: `${symbol}-zone`,
    zoneKind: "resistance",
    level: 1.23,
    triggerPrice: 1.24,
    strength: 0.7,
    confidence: 0.8,
    priority: 70,
    bias: "bullish",
    pressureScore: 0.6,
    eventContext: {
      monitoredZoneId: `${symbol}-monitored-zone`,
      canonicalZoneId: `${symbol}-zone`,
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "new",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: false,
      ladderPosition: "inner",
      zoneStrengthLabel: "moderate",
    },
    timestamp,
    notes: [],
  };
}

describe("live watchlist publisher", () => {
  it("builds card patches from level snapshots", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "ABCD",
      currentPrice: 2,
      timestamp: 1000,
      supportZones: [{ representativePrice: 1.8, strengthLabel: "major" }],
      resistanceZones: [{ representativePrice: 2.3, strengthLabel: "major", sourceLabel: "intraday" }],
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload);

    assert.equal(patch.symbol, "ABCD");
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
    assert.equal(patch.cards.nearestSupportResistance?.title, "Potential Path Levels");
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
  });

  it("dedupes Full Ladder rows that round to the same displayed price", () => {
    const patch = buildLiveWatchlistSnapshotPatch({
      symbol: "ROUND",
      currentPrice: 12,
      timestamp: 1000,
      supportZones: [
        { representativePrice: 11.166, strengthLabel: "moderate", sourceLabel: "4h structure" },
        { representativePrice: 11.174, strengthLabel: "weak", sourceLabel: "daily structure" },
      ],
      resistanceZones: [
        { representativePrice: 12.5, strengthLabel: "strong", sourceLabel: "daily structure" },
      ],
    });
    const body = patch.cards.fullLadder?.body ?? "";

    assert.equal(body.match(/^11\.17 \(/gm)?.length, 1);
  });

  it("reserves a Potential Path slot for the next meaningful structural resistance beyond 30 percent", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "VIVS",
      currentPrice: 10,
      timestamp: 1000,
      supportZones: [],
      resistanceZones: [
        ...[
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
        })),
        {
          representativePrice: 13.5,
          strengthLabel: "weak" as const,
          sourceLabel: "extension",
        },
        {
          representativePrice: 14.2,
          strengthLabel: "strong" as const,
          sourceLabel: "daily structure",
        },
      ],
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload);
    const body = patch.cards.nearestSupportResistance?.body ?? "";

    assert.match(body, /14\.20 \(\+42\.0%, strong, daily structure\)/);
    assert.doesNotMatch(body, /13\.50/);
    assert.doesNotMatch(body, /12\.40/);
    assert.equal(
      patch.cards.nearestSupportResistance?.metadata?.resistanceCount,
      8,
    );
  });

  it("keeps two structural checkpoints when a side begins beyond 30 percent", () => {
    const patch = buildLiveWatchlistSnapshotPatch({
      symbol: "NVVE",
      currentPrice: 15.74,
      timestamp: 1000,
      supportZones: [],
      resistanceZones: [
        { representativePrice: 20.89, strengthLabel: "weak", sourceLabel: "4h structure" },
        { representativePrice: 21.95, strengthLabel: "weak", sourceLabel: "daily structure" },
        { representativePrice: 22.56, strengthLabel: "weak", sourceLabel: "4h structure" },
      ],
    });
    const body = patch.cards.nearestSupportResistance?.body ?? "";

    assert.match(body, /20\.89/);
    assert.match(body, /21\.95/);
    assert.equal(patch.cards.nearestSupportResistance?.metadata?.resistanceCount, 2);
  });

  it("preserves clustered and confluence labels in Full Ladder and Potential Path output", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "CLST",
      currentPrice: 2,
      timestamp: 1000,
      supportZones: [],
      resistanceZones: [
        {
          representativePrice: 2.2,
          strengthLabel: "strong",
          sourceLabel: "daily structure clustered levels",
        },
        {
          representativePrice: 2.5,
          strengthLabel: "major",
          sourceLabel: "daily/4h clustered confluence",
        },
      ],
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload);

    for (const body of [
      patch.cards.fullLadder?.body ?? "",
      patch.cards.nearestSupportResistance?.body ?? "",
    ]) {
      assert.match(body, /daily structure clustered levels/);
      assert.match(body, /daily\/4h clustered confluence/);
    }
  });

  it("merges nearby Potential Path levels into one evidence-backed zone", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "ZONE",
      currentPrice: 2,
      timestamp: 1000,
      supportZones: [],
      resistanceZones: [
        {
          representativePrice: 2.2,
          lowPrice: 2.18,
          highPrice: 2.22,
          strengthLabel: "strong",
          sourceLabel: "daily structure clustered levels",
          sourceEvidenceCount: 2,
          firstEvidenceAt: 100,
          lastEvidenceAt: 300,
          timeframeSources: ["daily"],
          touchCount: 2,
        },
        {
          representativePrice: 2.23,
          lowPrice: 2.21,
          highPrice: 2.25,
          strengthLabel: "major",
          sourceLabel: "4h structure",
          sourceEvidenceCount: 1,
          firstEvidenceAt: 50,
          lastEvidenceAt: 400,
          timeframeSources: ["4h"],
          touchCount: 1,
        },
      ],
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload);
    const zone = patch.levelMap?.resistanceLevels[0];

    assert.equal(patch.levelMap?.resistanceLevels.length, 1);
    assert.equal(zone?.side, "resistance");
    assert.equal(zone?.price, 2.23);
    assert.equal(zone?.lowPrice, 2.18);
    assert.equal(zone?.highPrice, 2.25);
    assert.ok(Math.abs((zone?.distancePct ?? 0) - 0.115) < 1e-9);
    assert.ok(Math.abs((zone?.lowDistancePct ?? 0) - 0.09) < 1e-9);
    assert.equal(zone?.highDistancePct, 0.125);
    assert.equal(zone?.strengthLabel, "major");
    assert.equal(zone?.sourceLabel, "daily/4h clustered confluence");
    assert.equal(zone?.evidenceCount, 3);
    assert.equal(zone?.firstEvidenceAt, 50);
    assert.equal(zone?.lastEvidenceAt, 400);
    assert.deepEqual(zone?.timeframes, ["daily", "4h"]);
    assert.equal(zone?.isClustered, true);
    assert.equal(zone?.evidenceStatus, "historically_tested");
    assert.equal(zone?.roleFlipState, "original");
    assert.equal(
      zone?.label,
      "2.18-2.25 zone (+9.0% to +12.5%, major, daily/4h clustered confluence)",
    );
    assert.match(
      patch.cards.nearestSupportResistance?.body ?? "",
      /2\.18-2\.25 zone \(\+9\.0% to \+12\.5%, major, daily\/4h clustered confluence\)/,
    );
  });

  it("transports confirmed role-flip state without exposing an evidence control", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "FLIP",
      currentPrice: 10.5,
      timestamp: 1_000,
      supportZones: [
        {
          representativePrice: 10,
          strengthLabel: "strong",
          sourceLabel: "daily structure",
          firstEvidenceAt: 100,
          lastEvidenceAt: 600,
          roleFlipEvidence: {
            originalType: "resistance",
            flippedType: "support",
            timeframe: "daily",
            formationTimestamp: 100,
            firstBreakTimestamp: 200,
            confirmationTimestamp: 300,
            retestTimestamp: 500,
            reactionTimestamp: 600,
          },
        },
      ],
      resistanceZones: [],
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload);
    const level = patch.levelMap?.supportLevels[0];
    const visibleCopy = [
      level?.label ?? "",
      patch.cards.fullLadder?.body ?? "",
      patch.cards.nearestSupportResistance?.body ?? "",
    ].join("\n");

    assert.equal(level?.roleFlipState, "confirmed");
    assert.equal(level?.firstEvidenceAt, 100);
    assert.equal(level?.lastEvidenceAt, 600);
    assert.doesNotMatch(visibleCopy, /role[ -]?flip|zone evidence|confirmed at/i);
  });

  it("builds a market structure card from snapshot market structure payload", () => {
    const payload: LevelSnapshotPayload = {
      symbol: "ABCD",
      currentPrice: 2,
      timestamp: 1000,
      supportZones: [{ representativePrice: 1.8, strengthLabel: "major" }],
      resistanceZones: [{ representativePrice: 2.3, strengthLabel: "major" }],
      marketStructure: [
        "Daily: no confirmed BOS/CHOCH; bias range; protected high 2.80; protected low 1.20; confidence low",
        "HTF 4h: bullish BOS above 2.20; bias bullish; protected high 2.80; protected low 1.80; confidence high",
        "Tactical 5m: 5m structure is holding higher lows; trend uptrend; confidence medium",
      ].join("\n"),
    };

    const patch = buildLiveWatchlistSnapshotPatch(payload);

    assert.equal(patch.cards.marketStructure?.title, "Market Structure");
    assert.equal(patch.cards.marketStructure?.source, "level_snapshot");
    assert.match(patch.cards.marketStructure?.body ?? "", /HTF 4h: bullish BOS/);
    assert.match(patch.cards.marketStructure?.body ?? "", /Tactical 5m:/);
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
      event: testMonitoringEvent("EXMP", 2000),
      metadata: {
        messageKind: "stock_context",
      },
    });

    assert.equal(patch?.cards.companyInfo?.title, "Example Corp");
    assert.equal(patch?.cards.companyInfo?.metadata?.industry, "Biotechnology");
    assert.equal(patch?.cards.companyInfo?.metadata?.country, "China");
    assert.equal(patch?.cards.companyInfo?.metadata?.marketCap, "12.30M");
    assert.equal(patch?.cards.companyInfo?.priceWhenPosted, 1.23);
    assert.match(patch?.cards.companyInfo?.body ?? "", /Country: China \(High Risk Country\)/);
    assert.doesNotMatch(patch?.cards.companyInfo?.body ?? "", /Current price:/);
    assert.doesNotMatch(patch?.cards.companyInfo?.body ?? "", /Levels are loading/);
  });

  it("does not throw when onError handles publish failures", async () => {
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

    await publisher.publish({
      symbol: "FAIL",
      updatedAt: 1,
      cards: {},
    });

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
    assert.equal(patch?.nearestSupport, 1.9);
    assert.equal(patch?.nearestResistance, 2.1);
    assert.equal(patch?.nearestSupportLabel, "1.90 (-5.0%, major, intraday)");
    assert.equal(patch?.nearestResistanceLabel, "2.10 (+5.0%, strong, intraday)");
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
    });

    assert.deepEqual(patch, {
      symbol: "ABCD",
      status: "deactivated",
      updatedAt: 4000,
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

  it("builds a structured TradersLink AI Read card and an independent visibility patch", () => {
    const read: TradersLinkAiReadPayload = {
      version: 2,
      symbol: "TGHL",
      generatedAt: 3_000,
      dataAsOf: 2_900,
      currentPrice: 1.36,
      marketSession: "postmarket",
      bias: "bullish",
      confidence: "medium",
      currentRead: "Constructive while support holds.",
      needsToHold: { label: "Support", price: 1.25, rationale: "Preserves structure." },
      cautionBelow: { label: "Caution", price: 1.25, rationale: "Momentum starts to weaken." },
      momentumFailure: { label: "Failure", price: 1.2, rationale: "Exposes lower support." },
      mustClear: { label: "Breakout", price: 1.5, rationale: "Confirms continuation." },
      breakoutContinuation: { label: "Continuation", price: 1.68, rationale: "Opens higher targets." },
      targets: [{ label: "Target one", price: 1.8, condition: "After acceptance." }],
      downsideCheckpoints: [
        { label: "Lower support", price: 1.05, condition: "If momentum failure cannot reclaim." },
      ],
      catalystRealityCheck: {
        status: "conditional",
        summary: "A recent filing is the primary catalyst context.",
        dayTradeRelevance: "Momentum still needs confirmation.",
        sourceUrls: ["https://www.sec.gov/Archives/example"],
      },
      dilutionRisk: {
        level: "high",
        summary: "The transaction contemplates substantial share issuance.",
        dayTradeRelevance: "Watch supply into spikes.",
        sourceUrls: ["https://www.sec.gov/Archives/example"],
        canCompanyIssueToday: false,
        companyIssuance: {
          status: "conditional",
          earliestDate: null,
          trigger: "merger_closing",
          summary: "Issuance requires the transaction to close.",
        },
        publicResale: {
          status: "conditional",
          earliestDate: null,
          trigger: "resale_registration",
          summary: "Public resale requires registration or an exemption.",
        },
      },
      listingStatus: {
        status: "hearing_pending",
        immediacy: "monitor",
        summary: "The appeal is pending under an interim stay.",
        dayTradeRelevance: "Background headline risk while trading remains active.",
        sourceUrls: ["https://www.sec.gov/Archives/example"],
      },
      riskSummary: ["Thin liquidity."],
      sources: [{
        title: "Current report",
        url: "https://www.sec.gov/Archives/example",
        sourceType: "press_release_sec_database",
      }],
      model: "test-model",
      usedWebSearch: true,
      usage: {
        inputTokens: 2_000,
        cachedInputTokens: 200,
        outputTokens: 500,
        totalTokens: 2_500,
        webSearchCallCount: 1,
        tokenCostUsd: 0.01205,
        webSearchCostUsd: 0.01,
        estimatedTotalCostUsd: 0.02205,
        pricing: {
          source: "env_override",
          inputPer1M: 2.5,
          cachedInputPer1M: 0.25,
          outputPer1M: 15,
          webSearchPer1KCalls: 10,
        },
      },
    };

    const patch = buildTradersLinkAiReadPatch({ read, visible: true });
    assert.equal(patch.symbol, "TGHL");
    assert.equal(patch.tradersLinkAiReadCardVisible, true);
    assert.deepEqual(JSON.parse(patch.cards.tradersLinkAiRead?.body ?? "{}"), read);
    assert.equal(patch.cards.tradersLinkAiRead?.metadata?.model, "test-model");
    assert.equal(patch.cards.tradersLinkAiRead?.metadata?.listingImmediacy, "monitor");

    const visibility = buildTradersLinkAiReadVisibilityPatch({ symbol: "tghl", visible: false });
    assert.equal(visibility.symbol, "TGHL");
    assert.equal(visibility.tradersLinkAiReadCardVisible, false);
    assert.deepEqual(visibility.cards, {});
  });
});
