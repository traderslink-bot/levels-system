import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LevelSnapshotPayload } from "../lib/alerts/alert-types.js";
import {
  createTradersLinkAiReadServiceFromEnv,
  OpenAITradersLinkAiReadService,
} from "../lib/ai/traderslink-ai-read-service.js";

const DATA_AS_OF = Date.parse("2026-07-15T20:30:00.000Z");

function snapshot(): LevelSnapshotPayload {
  return {
    symbol: "TGHL",
    timestamp: DATA_AS_OF,
    currentPrice: 1.36,
    marketStructure: "Postmarket consolidation below resistance",
    supportZones: [{
      representativePrice: 1.25,
      lowPrice: 1.23,
      highPrice: 1.27,
      strengthLabel: "moderate",
      freshness: "fresh",
      touchCount: 3,
      confluenceCount: 2,
      timeframeSources: ["5m"],
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
      timeframeSources: ["5m", "4h"],
      sourceLabel: "postmarket breakout pivot",
    }],
  } as LevelSnapshotPayload;
}

function modelRead(): Record<string, unknown> {
  return {
    bias: "bullish",
    confidence: "medium",
    currentRead: "TGHL remains constructive while it holds above the postmarket support area. Acceptance above $1.50 would confirm continuation rather than another failed spike.",
    needsToHold: { label: "Postmarket support", price: 1.25, rationale: "Holding this area preserves the higher-low structure." },
    cautionBelow: { label: "Momentum caution", price: 1.25, rationale: "A loss would weaken the immediate higher-low structure." },
    momentumFailure: { label: "Momentum failure", price: 1.2, rationale: "A clean loss exposes lower support." },
    mustClear: { label: "Breakout pivot", price: 1.5, rationale: "Price needs sustained acceptance above this supply area." },
    breakoutContinuation: { label: "Continuation trigger", price: 1.68, rationale: "Acceptance above this pivot opens the extension targets." },
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

    assert.equal(read.currentPrice, 1.36);
    assert.equal(read.marketSession, "postmarket");
    assert.equal(read.mustClear.price, 1.5);
    assert.equal(read.usedWebSearch, true);
    assert.equal(read.usage.webSearchCallCount, 1);
    assert.equal(read.usage.totalTokens, 2_500);
    assert.equal(read.usage.webSearchCostUsd, 0.01);
    assert.equal(read.usage.tokenCostUsd, 0.01205);
    assert.equal(read.usage.estimatedTotalCostUsd, 0.02205);
    assert.equal(read.model, "test-model");
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
    const packet = JSON.parse(input[1]!.content[0]!.text) as {
      marketPacket: { currentPrice: number };
      primaryCatalystResearch: { source: string; articles: unknown[] };
    };
    assert.equal(packet.marketPacket.currentPrice, 1.36);
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
