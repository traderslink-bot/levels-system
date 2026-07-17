import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LevelSnapshotPayload } from "../lib/alerts/alert-types.js";
import {
  createTradersLinkAiReadServiceFromEnv,
  OpenAITradersLinkAiReadService,
} from "../lib/ai/traderslink-ai-read-service.js";
import {
  buildTradersLinkAiPriceActionPacket,
  type TradersLinkAiReadPriceActionContext,
} from "../lib/ai/traderslink-ai-read-price-action.js";

const DATA_AS_OF = Date.parse("2026-07-15T20:30:00.000Z");

function snapshot(): LevelSnapshotPayload {
  return {
    symbol: "TGHL",
    timestamp: DATA_AS_OF,
    currentPrice: 1.36,
    marketStructure: null,
    supportZones: [{
      representativePrice: 1.25,
      lowPrice: 1.23,
      highPrice: 1.27,
      strengthLabel: "moderate",
      freshness: "fresh",
      touchCount: 3,
      confluenceCount: 2,
      sourceLabel: "intraday support",
    }],
    resistanceZones: [{
      representativePrice: 1.5,
      lowPrice: 1.48,
      highPrice: 1.52,
      strengthLabel: "strong",
      freshness: "fresh",
      touchCount: 4,
      confluenceCount: 3,
      sourceLabel: "postmarket breakout pivot",
    }],
  } as LevelSnapshotPayload;
}

function priceAction(): TradersLinkAiReadPriceActionContext {
  const intradayCandles = Array.from({ length: 24 }, (_, index) => {
    const timestamp = DATA_AS_OF - (23 - index) * 5 * 60 * 1_000;
    const open = 1.22 + index * 0.006;
    const close = open + (index % 3 === 0 ? 0.012 : 0.004);
    return {
      timestamp,
      open,
      high: Math.max(open, close) + 0.018,
      low: Math.min(open, close) - 0.014,
      close,
      volume: 100_000 + index * 8_000,
    };
  });
  const dailyCandles = Array.from({ length: 20 }, (_, index) => {
    const timestamp = DATA_AS_OF - (20 - index) * 24 * 60 * 60 * 1_000;
    const open = 1 + index * 0.01;
    const close = open + 0.03;
    return {
      timestamp,
      open,
      high: close + 0.08,
      low: open - 0.05,
      close,
      volume: 500_000 + index * 10_000,
    };
  });
  return {
    source: "yahoo full-session OHLCV",
    fetchedAt: DATA_AS_OF,
    priorRegularClose: 1.2,
    intradayCandles,
    dailyCandles,
  };
}

function modelRead(): Record<string, unknown> {
  return {
    bias: "bullish",
    confidence: "medium",
    currentRead: "TGHL remains constructive while it holds above the postmarket support area. Acceptance above $1.50 would confirm continuation rather than another failed spike.",
    needsToHold: { label: "Postmarket shelf", price: 1.25, rationale: "Three postmarket tests held this higher-low shelf." },
    cautionBelow: { label: "Momentum caution", price: 1.25, rationale: "A loss of the postmarket consolidation floor would weaken the immediate higher low." },
    momentumFailure: { label: "Momentum failure", price: 1.2, rationale: "A clean loss of the prior regular-session low exposes the lower daily range." },
    mustClear: { label: "Repeated rejection zone", price: 1.5, rationale: "Repeated postmarket rejection tests make sustained acceptance necessary here." },
    breakoutContinuation: { label: "Range-high continuation", price: 1.68, rationale: "Acceptance above the postmarket range high opens the extension targets." },
    targets: [{ label: "First continuation area", price: 1.8, condition: "Only after $1.68 holds as support." }],
    downsideCheckpoints: [
      { label: "First lower support", price: 1.2, condition: "Exposed after momentum failure." },
      { label: "Outer lower support", price: 1.05, condition: "Next structural area if $1.20 fails." },
    ],
    catalystRealityCheck: {
      status: "conditional",
      summary: "A recent company filing is the primary known catalyst context.",
      dayTradeRelevance: "Momentum still needs price and volume confirmation.",
      sourceUrls: [
        "https://www.sec.gov/Archives/example?utm_source=test",
        "https://example.com/listing-source",
      ],
    },
    dilutionRisk: {
      level: "high",
      summary: "The proposed transaction would issue a large new share block.",
      dayTradeRelevance: "Supply expectations can amplify failed spikes.",
      sourceUrls: ["https://www.sec.gov/Archives/example"],
      canCompanyIssueToday: false,
      companyIssuance: {
        status: "conditional",
        earliestDate: "2026-07-18",
        trigger: "merger_closing",
        summary: "Company issuance requires the transaction to close.",
      },
      publicResale: {
        status: "delayed",
        earliestDate: null,
        trigger: "resale_registration",
        summary: "Public resale requires registration or an exemption.",
      },
    },
    listingStatus: {
      status: "hearing_pending",
      immediacy: "monitor",
      summary: "A listing appeal is pending and trading remains active under an interim stay.",
      dayTradeRelevance: "This is background headline risk unless a suspension date is announced.",
      sourceUrls: ["https://www.sec.gov/Archives/example"],
    },
    riskSummary: ["Low-priced shares can move quickly and may halt."],
  };
}

describe("TradersLink AI price-action volume quality", () => {
  it("treats a provider zero placeholder as unavailable volume", () => {
    const context = priceAction();
    context.intradayCandles.at(-1)!.volume = 0;
    const packet = buildTradersLinkAiPriceActionPacket(
      context,
      context.intradayCandles.at(-1)!.close,
      DATA_AS_OF,
    ) as {
      recentFiveMinuteBars: Array<{ volume: number | null; volumeDataQuality: string }>;
      sessionPhaseSummaries: Array<{
        session: string;
        volume: number | null;
        volumeDataQuality: string;
      }>;
    };

    assert.equal(packet.recentFiveMinuteBars.at(-1)!.volume, null);
    assert.equal(packet.recentFiveMinuteBars.at(-1)!.volumeDataQuality, "unavailable");
    const affectedSession = packet.sessionPhaseSummaries.find((summary) =>
      summary.volumeDataQuality !== "reported"
    );
    assert.ok(affectedSession);
    assert.equal(affectedSession.volume, null);
  });
});

describe("OpenAITradersLinkAiReadService", () => {
  it("sends authoritative market data, database-first research, web search, and a strict schema", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        output: [
          {
            type: "web_search_call",
            action: {
              sources: [{
                type: "url",
                title: "Supplemental listing source",
                url: "https://example.com/listing-source",
              }],
            },
          },
          {
            type: "message",
            content: [{
              type: "output_text",
              text: JSON.stringify(modelRead()),
              annotations: [],
            }],
          },
        ],
        usage: {
          input_tokens: 2_000,
          output_tokens: 500,
          total_tokens: 2_500,
          input_tokens_details: { cached_tokens: 200 },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      webSearchEnabled: true,
      pricing: {
        inputPer1M: 2.5,
        cachedInputPer1M: 0.25,
        outputPer1M: 15,
      },
      fetchImpl,
    });

    const read = await service.generate({
      snapshot: snapshot(),
      priceAction: priceAction(),
      dataAsOf: DATA_AS_OF,
      research: {
        ticker: "TGHL",
        businessDays: 5,
        count: 1,
        articles: [{
          ticker: "TGHL",
          title: "TGHL files current report",
          url: "https://traderslink.pro/news/tghl-current-report",
          sourceUrl: "https://www.sec.gov/Archives/example",
          filingType: "8-K",
        }],
      },
    });

    assert.equal(read.currentPrice, priceAction().intradayCandles.at(-1)!.close);
    assert.equal(read.marketSession, "postmarket");
    assert.equal(read.mustClear.price, 1.5);
    assert.equal(read.usedWebSearch, true);
    assert.equal(read.usage.webSearchCallCount, 1);
    assert.equal(read.usage.totalTokens, 2_500);
    assert.equal(read.usage.webSearchCostUsd, 0.01);
    assert.equal(read.usage.tokenCostUsd, 0.01205);
    assert.equal(read.usage.estimatedTotalCostUsd, 0.02205);
    assert.equal(read.model, "test-model");
    assert.equal(read.externalResearchEnabled, true);
    assert.equal(
      read.sources.filter((source) => source.sourceType === "press_release_sec_database").length,
      2,
    );
    assert.equal(read.sources.filter((source) => source.sourceType === "web_search").length, 1);
    assert.equal(read.version, 2);
    assert.equal(read.breakoutContinuation.price, 1.68);
    assert.deepEqual(read.downsideCheckpoints.map((checkpoint) => checkpoint.price), [1.2, 1.05]);
    assert.deepEqual(read.catalystRealityCheck.sourceUrls, [
      "https://www.sec.gov/Archives/example",
      "https://example.com/listing-source",
    ]);

    const requestBody = requestBodies[0];
    assert.ok(requestBody);
    assert.deepEqual(requestBody.tools, [{ type: "web_search" }]);
    assert.deepEqual(requestBody.include, ["web_search_call.action.sources"]);
    assert.equal(
      (requestBody.text as { format: { strict: boolean } }).format.strict,
      true,
    );
    const schema = (requestBody.text as {
      format: { schema: { properties: Record<string, unknown> } };
    }).format.schema;
    assert.ok(schema.properties.cautionBelow);
    assert.ok(schema.properties.momentumFailure);
    assert.ok(schema.properties.breakoutContinuation);
    assert.ok(schema.properties.catalystRealityCheck);
    assert.ok(schema.properties.downsideCheckpoints);
    assert.ok(schema.properties.dilutionRisk);
    assert.ok(schema.properties.listingStatus);
    const input = requestBody.input as Array<{ role: string; content: Array<{ text: string }> }>;
    assert.match(
      input[0]!.content[0]!.text,
      /currentPrice >= needsToHold >= cautionBelow >= momentumFailure/,
    );
    const packet = JSON.parse(input[1]!.content[0]!.text) as {
      marketPacket: {
        currentPrice: number;
        secondaryRuntimeQuote: { price: number };
        quoteDisagreementPct: number;
        priceAction: {
          recentFiveMinuteBars: unknown[];
          sessionPhaseSummaries: unknown[];
          recentSessionReferencePoints: unknown[];
          completedRegularSessionFifteenMinuteBars: unknown[];
          includesRegularHours: boolean;
          recentRange: { highBar: { session: string } };
        };
        supportLevels?: unknown;
        resistanceLevels?: unknown;
      };
      primaryCatalystResearch: { source: string; articles: unknown[] };
    };
    assert.equal(packet.marketPacket.currentPrice, priceAction().intradayCandles.at(-1)!.close);
    assert.equal(packet.marketPacket.secondaryRuntimeQuote.price, 1.36);
    assert.ok(packet.marketPacket.quoteDisagreementPct > 0);
    assert.equal(packet.marketPacket.priceAction.recentFiveMinuteBars.length, 24);
    assert.ok(packet.marketPacket.priceAction.sessionPhaseSummaries.length > 0);
    assert.ok(packet.marketPacket.priceAction.recentSessionReferencePoints.length > 0);
    assert.equal(typeof packet.marketPacket.priceAction.recentRange.highBar.session, "string");
    assert.ok(packet.marketPacket.priceAction.completedRegularSessionFifteenMinuteBars.length > 0);
    assert.equal(packet.marketPacket.priceAction.includesRegularHours, true);
    assert.equal(packet.marketPacket.supportLevels, undefined);
    assert.equal(packet.marketPacket.resistanceLevels, undefined);
    assert.equal(packet.primaryCatalystResearch.source, "TradersLink press-release/SEC database");
    assert.equal(packet.primaryCatalystResearch.articles.length, 1);
    assert.equal(read.dilutionRisk.canCompanyIssueToday, false);
    assert.equal(read.dilutionRisk.companyIssuance.earliestDate, "2026-07-18");
  });

  it("keeps external web research off by default and allows the admin setting to change it", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const readWithoutExternalUrls = modelRead();
    readWithoutExternalUrls.catalystRealityCheck = {
      status: "confirmed",
      summary: "A current company filing is the known catalyst.",
      dayTradeRelevance: "Price still needs technical confirmation.",
      sourceUrls: ["https://www.sec.gov/Archives/example"],
    };
    readWithoutExternalUrls.listingStatus = {
      status: "unknown",
      immediacy: "unknown",
      summary: "No current listing conclusion is available from supplied records.",
      dayTradeRelevance: "Do not make listing status part of the trade thesis.",
      sourceUrls: [],
    };
    const fetchImpl: typeof fetch = async (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(readWithoutExternalUrls) }],
        }],
        usage: { input_tokens: 1_000, output_tokens: 400, total_tokens: 1_400 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl,
    });

    assert.equal(service.isExternalResearchEnabled(), false);
    const read = await service.generate({
      snapshot: snapshot(),
      priceAction: priceAction(),
      research: {
        ticker: "TGHL",
        businessDays: 5,
        count: 1,
        articles: [{
          ticker: "TGHL",
          title: "TGHL files current report",
          url: "https://traderslink.pro/news/tghl-current-report",
          sourceUrl: "https://www.sec.gov/Archives/example",
          filingType: "8-K",
        }],
      },
    });

    assert.equal(read.usedWebSearch, false);
    assert.equal(read.externalResearchEnabled, false);
    assert.equal(read.usage.webSearchCallCount, 0);
    assert.equal(requestBodies[0]!.tools, undefined);
    assert.equal(requestBodies[0]!.include, undefined);

    service.setExternalResearchEnabled(true);
    assert.equal(service.isExternalResearchEnabled(), true);
  });

  it("rejects ungrounded context URLs and downgrades unsupported immediate delisting language", async () => {
    const unsafeRead = modelRead();
    unsafeRead.catalystRealityCheck = {
      status: "confirmed",
      summary: "An unsupported catalyst claim.",
      dayTradeRelevance: "Would be important if true.",
      sourceUrls: ["https://unsupported.example/claim"],
    };
    unsafeRead.dilutionRisk = {
      level: "medium",
      summary: "A source-backed dilution item exists.",
      dayTradeRelevance: "Watch supply into spikes.",
      sourceUrls: ["https://example.com/dilution?utm_campaign=test"],
      canCompanyIssueToday: null,
      companyIssuance: {
        status: "conditional",
        earliestDate: "not-a-date",
        trigger: "warrant_exercise",
        summary: "Issuance requires warrant exercise.",
      },
      publicResale: {
        status: "unknown",
        earliestDate: null,
        trigger: "unknown",
        summary: "Resale timing is unknown.",
      },
    };
    unsafeRead.listingStatus = {
      status: "hearing_pending",
      immediacy: "immediate",
      summary: "TGHL will be delisted immediately.",
      dayTradeRelevance: "Trading could stop now.",
      sourceUrls: ["https://www.sec.gov/Archives/hearing?utm_source=test"],
    };
    unsafeRead.currentRead = "The trade remains constructive above support. Nasdaq delisting risk is unresolved.";
    unsafeRead.riskSummary = [
      "Thin liquidity can amplify failed spikes.",
      "Nasdaq listing risk remains active.",
    ];

    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      output: [
        {
          type: "web_search_call",
          action: {
            sources: [
              ...Array.from({ length: 18 }, (_, index) => ({
                title: `Background source ${index}`,
                url: `https://background.example/${index}`,
              })),
              { title: "Dilution source", url: "https://example.com/dilution" },
              { title: "SEC hearing source", url: "https://www.sec.gov/Archives/hearing" },
            ],
          },
        },
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(unsafeRead), annotations: [] }],
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl,
    });

    const read = await service.generate({
      snapshot: snapshot(),
      priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
    });

    assert.equal(read.catalystRealityCheck.status, "unverified");
    assert.deepEqual(read.catalystRealityCheck.sourceUrls, []);
    assert.equal(read.dilutionRisk.level, "medium");
    assert.deepEqual(read.dilutionRisk.sourceUrls, ["https://example.com/dilution"]);
    assert.equal(read.dilutionRisk.companyIssuance.earliestDate, null);
    assert.equal(read.listingStatus.status, "hearing_pending");
    assert.equal(read.listingStatus.immediacy, "monitor");
    assert.match(read.listingStatus.summary, /no source-backed suspension date/i);
    assert.doesNotMatch(read.currentRead, /nasdaq|delist/i);
    assert.deepEqual(read.riskSummary, ["Thin liquidity can amplify failed spikes."]);
    assert.ok(read.sources.some((source) => source.url === "https://example.com/dilution"));
    assert.ok(read.sources.some((source) => source.url === "https://www.sec.gov/Archives/hearing"));
  });

  it("does not call OpenAI without a usable full-session tape", async () => {
    let requestCount = 0;
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async () => {
        requestCount += 1;
        return new Response("{}", { status: 200 });
      },
    });
    const insufficientPriceAction = priceAction();
    insufficientPriceAction.intradayCandles = insufficientPriceAction.intradayCandles.slice(-3);

    await assert.rejects(
      service.generate({
        snapshot: snapshot(),
        priceAction: insufficientPriceAction,
        research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
      }),
      /price action was unavailable/i,
    );
    assert.equal(requestCount, 0);
  });

  it("rejects a semantically invalid ladder-like map instead of publishing it", async () => {
    const invalidRead = modelRead();
    invalidRead.needsToHold = {
      label: "Nearest detected support",
      price: 1.42,
      rationale: "This is the next supplied level.",
    };
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async () => new Response(JSON.stringify({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(invalidRead) }],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    });

    await assert.rejects(
      service.generate({
        snapshot: snapshot(),
        priceAction: priceAction(),
        research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
      }),
      /invalid tactical trade map.*needsToHold/i,
    );
  });

  it("rejects a caution threshold above the stated needs-to-hold boundary", async () => {
    const invalidRead = modelRead();
    invalidRead.needsToHold = {
      label: "Consolidation floor",
      price: 1.25,
      rationale: "Three postmarket tests held the consolidation floor.",
    };
    invalidRead.cautionBelow = {
      label: "Early caution",
      price: 1.3,
      rationale: "The postmarket higher low was tested twice.",
    };
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async () => new Response(JSON.stringify({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(invalidRead) }],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    });

    await assert.rejects(
      service.generate({
        snapshot: snapshot(),
        priceAction: priceAction(),
        research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
      }),
      /cautionBelow must not be above needsToHold/i,
    );
  });

  it("automatically requests one corrected draft after tactical validation fails", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const invalidRead = modelRead();
    invalidRead.needsToHold = {
      label: "Consolidation floor",
      price: 1.25,
      rationale: "Three postmarket tests held the consolidation floor.",
    };
    invalidRead.cautionBelow = {
      label: "Early caution",
      price: 1.3,
      rationale: "The postmarket higher low was tested twice.",
    };
    let requestNumber = 0;
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      webSearchEnabled: true,
      pricing: {
        inputPer1M: 1,
        cachedInputPer1M: 0.1,
        outputPer1M: 2,
      },
      fetchImpl: async (_url, init) => {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        requestNumber += 1;
        const draft = requestNumber === 1 ? invalidRead : modelRead();
        return new Response(JSON.stringify({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(draft) }],
          }],
          usage: requestNumber === 1
            ? { input_tokens: 100, output_tokens: 20, total_tokens: 120 }
            : { input_tokens: 200, output_tokens: 30, total_tokens: 230 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });

    const read = await service.generate({
      snapshot: snapshot(),
      priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
    });

    assert.equal(requestBodies.length, 2);
    assert.deepEqual(requestBodies[0]!.tools, [{ type: "web_search" }]);
    assert.equal(requestBodies[1]!.tools, undefined);
    assert.equal(
      (requestBodies[1]!.input as unknown[]).length,
      3,
    );
    assert.equal(read.cautionBelow.price, 1.25);
    assert.equal(read.usage.inputTokens, 300);
    assert.equal(read.usage.outputTokens, 50);
    assert.equal(read.usage.totalTokens, 350);
  });

  it("uses the existing API key by default and honors the global off switch", () => {
    const service = createTradersLinkAiReadServiceFromEnv({ OPENAI_API_KEY: "test-key" });
    assert.ok(service);
    assert.equal(service.isExternalResearchEnabled(), false);
    const enabledService = createTradersLinkAiReadServiceFromEnv({
      OPENAI_API_KEY: "test-key",
      TRADERSLINK_AI_READ_WEB_SEARCH_ENABLED: "true",
    });
    assert.equal(enabledService?.isExternalResearchEnabled(), true);
    assert.equal(createTradersLinkAiReadServiceFromEnv({
      OPENAI_API_KEY: "test-key",
      WATCHLIST_TRADER_READ_AI_ENABLED: "false",
    }), null);
  });
});
