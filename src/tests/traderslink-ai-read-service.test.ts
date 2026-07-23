import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LevelSnapshotPayload } from "../lib/alerts/alert-types.js";
import {
  createTradersLinkAiReadServiceFromEnv,
  OpenAITradersLinkAiReadService,
} from "../lib/ai/traderslink-ai-read-service.js";
import {
  buildTradersLinkAiCompletedSessionWindow,
  buildTradersLinkAiPriceActionPacket,
  mergeTradersLinkAiIntradayCandles,
  resolveTradersLinkAiCurrentPremarketHigh,
  resolveTradersLinkAiReadReferenceQuote,
  type TradersLinkAiReadPriceActionContext,
} from "../lib/ai/traderslink-ai-read-price-action.js";

const DATA_AS_OF = Date.parse("2026-07-15T20:30:00.000Z");
const PREMARKET_DATA_AS_OF = Date.parse("2026-07-20T11:45:00.000Z");

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

function priceActionWithOneMinuteCandidates(): TradersLinkAiReadPriceActionContext {
  const oneMinuteCandles: TradersLinkAiReadPriceActionContext["intradayCandles"] = [];
  const start = DATA_AS_OF - 27 * 60_000;
  const push = (index: number, open: number, close: number, volume: number) => {
    oneMinuteCandles.push({
      timestamp: start + index * 60_000,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume,
    });
  };
  for (let index = 0; index < 10; index += 1) {
    push(index, 1, 1 + (index % 2) * 0.002, 100_000);
  }
  for (let index = 0; index < 5; index += 1) {
    push(10 + index, 1 + index * 0.16, 1 + (index + 1) * 0.16, 700_000);
  }
  for (let index = 0; index < 3; index += 1) {
    push(15 + index, 1.45, 1.46, 350_000);
  }
  for (let index = 0; index < 10; index += 1) {
    push(18 + index, 1.48 + index * 0.007, 1.49 + index * 0.007, 250_000);
  }
  return {
    ...priceAction(),
    oneMinuteCandles,
  };
}

function premarketPriceAction(): TradersLinkAiReadPriceActionContext {
  const intradayCandles = Array.from({ length: 24 }, (_, index) => {
    const timestamp = PREMARKET_DATA_AS_OF - (23 - index) * 5 * 60 * 1_000;
    return {
      timestamp,
      open: 0.331,
      high: index === 10 ? 0.3469 : 0.34,
      low: 0.325,
      close: index === 23 ? 0.3336 : 0.334,
      volume: 75_000 + index * 2_000,
    };
  });
  return {
    source: "yahoo full-session OHLCV",
    fetchedAt: PREMARKET_DATA_AS_OF,
    priorRegularClose: 0.28,
    intradayCandles,
    dailyCandles: priceAction().dailyCandles,
  };
}

function premarketModelRead(currentRead: string): Record<string, unknown> {
  return {
    ...modelRead(),
    currentRead,
    needsToHold: {
      label: "Premarket shelf",
      price: 0.32,
      rationale: "Repeated premarket tests held the consolidation shelf.",
    },
    cautionBelow: {
      label: "Premarket caution",
      price: 0.312,
      rationale: "A loss of the premarket higher-low base would weaken the rebound.",
    },
    momentumFailure: {
      label: "Premarket failure",
      price: 0.3,
      rationale: "A clean loss of the premarket range low would invalidate the rebound.",
    },
    mustClear: {
      label: "Premarket rejection zone",
      price: 0.35,
      rationale: "Repeated premarket rejection tests require sustained acceptance here.",
    },
    breakoutContinuation: {
      label: "Prior-session continuation",
      price: 0.3658,
      rationale: "Acceptance above the prior regular-session range opens the continuation path.",
    },
    forwardPlan: {
      nearestRealistic: projectedHorizon("Nearest realistic", 0.3851, "psychological_boundary"),
      continuedMomentum: projectedHorizon("Continued momentum", 0.42, "measured_move"),
      strongExpansion: projectedHorizon("Strong expansion", 0.46, "volatility_projection"),
      extremeMomentum: projectedHorizon("Extreme momentum", 0.49, "combined"),
      additionalObservedOutcomes: [],
    },
    downsideCheckpoints: [{
      label: "Lower daily range",
      price: 0.2446,
      condition: "The recent daily range low is exposed if the premarket floor fails.",
    }],
    pullbackPlans: { shallow: null, deep: null },
    failureRecovery: null,
  };
}

function projectedHorizon(
  label: string,
  price: number,
  basisType: "psychological_boundary" | "measured_move" | "volatility_projection" | "combined",
): Record<string, unknown> {
  return {
    label,
    available: true,
    price,
    condition: `Sustained acceptance must confirm the ${label.toLowerCase()} branch.`,
    basisType,
    basisSummary: `A conditional ${basisType.replaceAll("_", " ")} scenario derived from the supplied tape.`,
    sourceFacts: ["Supplied session range", "Supplied realized impulse", "Supplied daily volatility context"],
    unavailableReasonCode: null,
    unavailableReason: null,
  };
}

function fiveMinuteFallbackPullback(): Record<string, unknown> {
  const packet = buildTradersLinkAiPriceActionPacket(priceAction(), 1.36, DATA_AS_OF);
  const evidence = packet.oneMinuteEvidence as Record<string, unknown>;
  const candidate = (evidence.pullbackCandidates as Array<Record<string, number | string>>)[0]!;
  const zoneLow = Number(candidate.zoneLow);
  const zoneHigh = Number(candidate.zoneHigh);
  return {
    zoneLow,
    zoneHigh,
    confirmationPrice: zoneHigh,
    confirmation: "Hold the observed five-minute shelf and reclaim its upper body boundary.",
    invalidationPrice: Number((zoneLow - Math.max(0.01, zoneLow * 0.01)).toFixed(4)),
    firstObjectivePrice: 1.5,
    rationale: "The supplied five-minute candles preserve a candidate-backed pullback branch.",
    evidenceIds: [String(candidate.id)],
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
    forwardPlan: {
      nearestRealistic: projectedHorizon("Nearest realistic", 1.72, "psychological_boundary"),
      continuedMomentum: projectedHorizon("Continued momentum", 1.8, "measured_move"),
      strongExpansion: projectedHorizon("Strong expansion", 1.9, "volatility_projection"),
      extremeMomentum: projectedHorizon("Extreme momentum", 2, "combined"),
      additionalObservedOutcomes: [],
    },
    downsideCheckpoints: [
      { label: "First lower support", price: 1.12, condition: "Exposed if the prior regular session low loses acceptance." },
      { label: "Outer lower support", price: 1.05, condition: "Next daily range low if $1.12 fails." },
    ],
    pullbackPlans: { shallow: fiveMinuteFallbackPullback(), deep: null },
    failureRecovery: null,
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
  it("uses the candle observation time and rejects a stale intraday close as the current quote", () => {
    const freshContext = priceAction();
    const latest = freshContext.intradayCandles.at(-1)!;
    const fresh = resolveTradersLinkAiReadReferenceQuote(freshContext, 1.7, DATA_AS_OF);
    assert.equal(fresh.price, latest.close);
    assert.equal(fresh.dataAsOf, latest.timestamp);

    const staleContext = priceAction();
    staleContext.fetchedAt = DATA_AS_OF;
    staleContext.intradayCandles = staleContext.intradayCandles.map((candle) => ({
      ...candle,
      timestamp: candle.timestamp - 24 * 60 * 60_000,
    }));
    const stale = resolveTradersLinkAiReadReferenceQuote(staleContext, 1.7, DATA_AS_OF);
    assert.equal(stale.price, 1.7);
    assert.equal(stale.dataAsOf, DATA_AS_OF);
    assert.equal(stale.source, "runtime live-price fallback");
  });

  it("replaces completed-session Yahoo bars with EODHD while keeping today's Yahoo bars", () => {
    const priorOpen = Date.parse("2026-07-16T20:00:00.000Z");
    const priorClose = Date.parse("2026-07-16T23:55:00.000Z");
    const currentBar = Date.parse("2026-07-17T14:00:00.000Z");
    const dataAsOf = Date.parse("2026-07-17T15:00:00.000Z");
    const candle = (timestamp: number, close: number, volume: number) => ({
      timestamp,
      open: close,
      high: close,
      low: close,
      close,
      volume,
    });
    const yahoo = [
      candle(priorOpen, 1.35, 0),
      candle(priorClose, 1.46, 0),
      candle(currentBar, 1.52, 25_000),
    ];
    const eodhd = [
      candle(priorOpen, 1.35, 10_000),
      candle(priorClose, 1.46, 2_700_000),
    ];

    assert.deepEqual(buildTradersLinkAiCompletedSessionWindow(yahoo, dataAsOf), {
      currentSessionDate: "2026-07-17",
      fromTimeMs: priorOpen,
      toTimeMs: priorClose + 5 * 60_000,
    });
    const merged = mergeTradersLinkAiIntradayCandles(yahoo, eodhd, dataAsOf);
    assert.equal(merged.find((item) => item.timestamp === priorOpen)?.volume, 10_000);
    assert.equal(merged.find((item) => item.timestamp === priorClose)?.volume, 2_700_000);
    assert.equal(merged.find((item) => item.timestamp === currentBar)?.volume, 25_000);
  });

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

  it("does not promote unreported NXXT or VMAR Yahoo opening wicks to the premarket session high", () => {
    const context = premarketPriceAction();
    const first = context.intradayCandles[0]!;
    const second = context.intradayCandles[1]!;
    first.open = 0.345;
    first.high = 0.3658;
    first.low = 0.316;
    first.close = 0.3209;
    first.volume = 0;
    second.open = 0.3209;
    second.high = 0.3633;
    second.low = 0.3209;
    second.close = 0.3367;
    second.volume = 0;
    for (const candle of context.intradayCandles) {
      candle.volume = 0;
    }

    const packet = buildTradersLinkAiPriceActionPacket(
      context,
      context.intradayCandles.at(-1)!.close,
      PREMARKET_DATA_AS_OF,
    ) as { sessionPhaseSummaries: Array<{ session: string; high: number }> };
    const premarket = packet.sessionPhaseSummaries.find((summary) => summary.session === "premarket");

    assert.equal(premarket?.high, 0.3469);
    assert.equal(
      resolveTradersLinkAiCurrentPremarketHigh(context.intradayCandles, PREMARKET_DATA_AS_OF),
      0.3469,
    );

    const vmar = premarketPriceAction();
    for (const candle of vmar.intradayCandles) {
      candle.open = 1.08;
      candle.high = 1.1;
      candle.low = 1.03;
      candle.close = 1.07;
      candle.volume = 0;
    }
    Object.assign(vmar.intradayCandles[0]!, {
      open: 1.11,
      high: 1.23,
      low: 1.0201,
      close: 1.0698,
    });
    Object.assign(vmar.intradayCandles[1]!, {
      open: 1.0602,
      high: 1.2,
      low: 1.06,
      close: 1.0902,
    });
    Object.assign(vmar.intradayCandles[10]!, {
      open: 1.1011,
      high: 1.16,
      low: 1.07,
      close: 1.15,
    });
    Object.assign(vmar.intradayCandles[11]!, {
      open: 1.1598,
      high: 1.16,
      low: 1.1,
      close: 1.13,
    });
    assert.equal(
      resolveTradersLinkAiCurrentPremarketHigh(vmar.intradayCandles, PREMARKET_DATA_AS_OF),
      1.16,
    );
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
                title: "Supplemental financing catalyst source",
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
      priorPlanBoundary: {
        direction: "upper",
        price: 1.42,
        priorPlanGeneratedAt: DATA_AS_OF - 60_000,
      },
      research: {
        ticker: "TGHL",
        businessDays: 5,
        generatedAt: "2026-07-15T20:31:00.000Z",
        count: 1,
        articles: [{
          ticker: "TGHL",
          title: "TGHL files merger and financing 8-K",
          summary: "The Form 8-K describes the merger consideration and related financing terms.",
          positives: ["The filing identifies a defined merger consideration."],
          negatives: ["The related financing can add share supply after its stated gates."],
          url: "https://traderslink.pro/news/tghl-current-report",
          sourceUrl: "https://www.sec.gov/Archives/example",
          publishedAt: "2026-07-15T19:45:00.000Z",
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
    const filingSource = read.sources.find((source) => source.url === "https://www.sec.gov/Archives/example");
    assert.ok(filingSource?.evidence);
    assert.equal(filingSource.evidence?.excerptKind, "article_summary");
    assert.equal(filingSource.evidence?.publishedAt, "2026-07-15T19:45:00.000Z");
    assert.equal(filingSource.evidence?.retrievedAt, "2026-07-15T20:31:00.000Z");
    assert.match(filingSource.evidence?.supportingExcerpt ?? "", /merger consideration/i);
    assert.equal(filingSource.evidence?.supersessionStatus, "latest_in_retrieved_window");
    assert.equal(read.version, 4);
    assert.equal(read.breakoutContinuation.price, 1.68);
    assert.deepEqual(read.downsideCheckpoints.map((checkpoint) => checkpoint.price), [1.12, 1.05]);
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
    assert.equal((requestBody.text as { verbosity?: string }).verbosity, "low");
    const schema = (requestBody.text as {
      format: { schema: { properties: Record<string, unknown> } };
    }).format.schema;
    assert.ok(schema.properties.cautionBelow);
    assert.ok(schema.properties.momentumFailure);
    assert.ok(schema.properties.breakoutContinuation);
    assert.ok(schema.properties.catalystRealityCheck);
    assert.ok(schema.properties.downsideCheckpoints);
    assert.ok(schema.properties.pullbackPlans);
    assert.ok(schema.properties.failureRecovery);
    assert.ok(schema.properties.dilutionRisk);
    assert.ok(schema.properties.listingStatus);
    const input = requestBody.input as Array<{ role: string; content: Array<{ text: string }> }>;
    assert.match(
      input[0]!.content[0]!.text,
      /currentPrice >= needsToHold >= cautionBelow >= momentumFailure/,
    );
    assert.match(
      input[0]!.content[0]!.text,
      /invalidationPrice < zoneLow <= zoneHigh < currentPrice/,
    );
    assert.match(
      input[0]!.content[0]!.text,
      /recoveryZoneLow <= recoveryZoneHigh < firstReclaimPrice < setupRestorePrice/,
    );
    const pullbackPlansSchema = schema.properties.pullbackPlans as {
      properties: {
        shallow: {
          properties: Record<string, { description?: string }>;
        };
      };
    };
    assert.match(
      pullbackPlansSchema.properties.shallow.properties.invalidationPrice?.description ?? "",
      /strictly below zoneLow/i,
    );
    const failureRecoverySchema = schema.properties.failureRecovery as {
      properties: Record<string, { description?: string }>;
    };
    assert.match(
      failureRecoverySchema.properties.firstReclaimPrice?.description ?? "",
      /strictly greater than recoveryZoneHigh/i,
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
          oneMinuteEvidence: { available: boolean; recentOneMinuteBars: unknown[] };
        };
        supportLevels?: unknown;
        resistanceLevels?: unknown;
      };
      confirmedPriorPlanBoundary: {
        direction: "upper" | "lower";
        price: number;
        priorPlanGeneratedAt: number;
      } | null;
      primaryCatalystResearch: {
        source: string;
        articles: Array<{
          sourceSummary: string | null;
          positivePoints: string[];
          negativePoints: string[];
        }>;
      };
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
    assert.equal(packet.marketPacket.priceAction.oneMinuteEvidence.available, false);
    assert.deepEqual(packet.marketPacket.priceAction.oneMinuteEvidence.recentOneMinuteBars, []);
    assert.equal(packet.marketPacket.supportLevels, undefined);
    assert.equal(packet.marketPacket.resistanceLevels, undefined);
    assert.deepEqual(packet.confirmedPriorPlanBoundary, {
      direction: "upper",
      price: 1.42,
      priorPlanGeneratedAt: DATA_AS_OF - 60_000,
    });
    assert.equal(packet.primaryCatalystResearch.source, "TradersLink press-release/SEC database");
    assert.equal(packet.primaryCatalystResearch.articles.length, 1);
    assert.equal(
      packet.primaryCatalystResearch.articles[0]?.sourceSummary,
      "The Form 8-K describes the merger consideration and related financing terms.",
    );
    assert.deepEqual(packet.primaryCatalystResearch.articles[0]?.positivePoints, [
      "The filing identifies a defined merger consideration.",
    ]);
    assert.deepEqual(packet.primaryCatalystResearch.articles[0]?.negativePoints, [
      "The related financing can add share supply after its stated gates.",
    ]);
    assert.equal(read.dilutionRisk.canCompanyIssueToday, false);
    assert.equal(read.dilutionRisk.companyIssuance.earliestDate, "2026-07-18");
    assert.match(read.riskSummary.join(" "), /prior plan boundary near \$1\.42/i);
  });

  it("publishes only candidate-backed, separated v4 pullback and recovery structures", async () => {
    const tape = priceActionWithOneMinuteCandidates();
    const currentPrice = tape.oneMinuteCandles!.at(-1)!.close;
    const packet = buildTradersLinkAiPriceActionPacket(tape, currentPrice, DATA_AS_OF);
    const oneMinuteEvidence = packet.oneMinuteEvidence as {
      pullbackCandidates: Array<{ id: string; kind: string; zoneLow: number; zoneHigh: number }>;
    };
    const shallowCandidate = oneMinuteEvidence.pullbackCandidates.find(
      (candidate) => candidate.kind === "first_consolidation",
    );
    const deepCandidate = oneMinuteEvidence.pullbackCandidates.find(
      (candidate) => candidate.kind === "pre_impulse_base",
    );
    assert.ok(shallowCandidate);
    assert.ok(deepCandidate);

    const draft = modelRead();
    draft.needsToHold = { label: "Post-impulse shelf", price: 1.3, rationale: "Regular-session consolidation held this shelf." };
    draft.cautionBelow = { label: "Base caution", price: 1.1, rationale: "The intraday base loses acceptance below this price." };
    draft.momentumFailure = { label: "Momentum failure", price: 0.95, rationale: "The daily range low invalidates the momentum setup." };
    draft.mustClear = { label: "Reclaim pivot", price: 1.6, rationale: "The intraday rejection pivot must be reclaimed." };
    draft.downsideCheckpoints = [{ label: "Lower daily base", price: 0.85, condition: "The daily range low is exposed after momentum failure." }];
    draft.pullbackPlans = {
      shallow: {
        zoneLow: shallowCandidate.zoneLow,
        zoneHigh: shallowCandidate.zoneHigh,
        confirmationPrice: shallowCandidate.zoneHigh,
        confirmation: "Require a higher low and reclaim of the one-minute consolidation high.",
        invalidationPrice: Number((shallowCandidate.zoneLow * 0.98).toFixed(2)),
        firstObjectivePrice: 1.6,
        rationale: "The first one-minute consolidation after the impulse supplies the momentum retest.",
        evidenceIds: [shallowCandidate.id],
      },
      deep: {
        zoneLow: deepCandidate.zoneLow,
        zoneHigh: deepCandidate.zoneHigh,
        confirmationPrice: deepCandidate.zoneHigh,
        confirmation: "Require a new base and reclaim of the pre-impulse base high.",
        invalidationPrice: Number((deepCandidate.zoneLow * 0.97).toFixed(2)),
        firstObjectivePrice: 1.3,
        rationale: "The observed pre-impulse one-minute base supplies the deeper reset.",
        evidenceIds: [deepCandidate.id],
      },
    };
    draft.failureRecovery = {
      recoveryZoneLow: deepCandidate.zoneLow,
      recoveryZoneHigh: deepCandidate.zoneHigh,
      firstReclaimPrice: 1.1,
      setupRestorePrice: 1.3,
      firstObjectivePrice: 1.6,
      rationale: "After failure, require a new base, a first reclaim, and then restoration of the former shelf.",
      evidenceIds: [deepCandidate.id],
    };

    const generate = async (responseDraft: Record<string, unknown>) => {
      const service = new OpenAITradersLinkAiReadService({
        apiKey: "test-key",
        model: "test-model",
        fetchImpl: async () => new Response(JSON.stringify({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(responseDraft) }],
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } }),
      });
      return service.generate({
        snapshot: { ...snapshot(), currentPrice },
        priceAction: tape,
        research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
      });
    };

    const read = await generate(draft);
    assert.equal(read.pullbackPlans.shallow?.evidenceIds[0], shallowCandidate.id);
    assert.equal(read.pullbackPlans.deep?.evidenceIds[0], deepCandidate.id);
    assert.equal(read.failureRecovery?.firstReclaimPrice, 1.1);

    const inventedCandidate = structuredClone(draft) as Record<string, any>;
    inventedCandidate.pullbackPlans.shallow.evidenceIds = ["invented-zone"];
    await assert.rejects(generate(inventedCandidate), /invented candidate ID/i);

    const optionalPullbackCases: Array<[
      string,
      (value: Record<string, any>) => void,
      (read: Awaited<ReturnType<typeof generate>>) => void,
    ]> = [
      ["overlapping zones", (value) => {
        value.pullbackPlans.deep = { ...value.pullbackPlans.shallow };
      }, (result) => assert.equal(result.pullbackPlans.deep, null)],
      ["reversed zone", (value) => {
        const low = value.pullbackPlans.shallow.zoneLow;
        value.pullbackPlans.shallow.zoneLow = value.pullbackPlans.shallow.zoneHigh;
        value.pullbackPlans.shallow.zoneHigh = low;
      }, (result) => assert.equal(result.pullbackPlans.shallow, null)],
      ["objective below entry", (value) => {
        value.pullbackPlans.shallow.firstObjectivePrice = value.pullbackPlans.shallow.zoneLow;
      }, (result) => assert.equal(result.pullbackPlans.shallow, null)],
    ];
    for (const [label, mutate, verify] of optionalPullbackCases) {
      const invalid = structuredClone(draft) as Record<string, any>;
      mutate(invalid);
      verify(await generate(invalid));
      assert.ok(true, label);
    }

    const invalidCases: Array<[string, (value: Record<string, any>) => void, RegExp]> = [
      ["recovery without reclaim", (value) => {
        value.failureRecovery.firstReclaimPrice = value.failureRecovery.recoveryZoneHigh;
      }, /first reclaim must be above/i],
      ["recovery objective duplicates restoration", (value) => {
        value.failureRecovery.firstObjectivePrice = value.failureRecovery.setupRestorePrice;
      }, /objective must be distinct/i],
    ];
    for (const [label, mutate, errorPattern] of invalidCases) {
      const invalid = structuredClone(draft) as Record<string, any>;
      mutate(invalid);
      await assert.rejects(generate(invalid), errorPattern, label);
    }

    const originRecovery = structuredClone(draft) as Record<string, any>;
    const tightOriginReclaim = Number((deepCandidate.zoneHigh * 1.006).toFixed(4));
    originRecovery.failureRecovery.firstReclaimPrice = tightOriginReclaim;
    originRecovery.failureRecovery.setupRestorePrice = Number((tightOriginReclaim + 0.05).toFixed(4));
    originRecovery.failureRecovery.firstObjectivePrice = Number((tightOriginReclaim + 0.15).toFixed(4));
    const originRecoveryRead = await generate(originRecovery);
    assert.equal(
      originRecoveryRead.failureRecovery?.firstReclaimPrice,
      Number(tightOriginReclaim.toFixed(2)),
    );
    assert.ok(
      (originRecoveryRead.failureRecovery?.setupRestorePrice ?? Number.POSITIVE_INFINITY) <
      (originRecoveryRead.cautionBelow.price ?? Number.POSITIVE_INFINITY),
    );
  });

  it("treats StockTitan RSS as title-only catalyst evidence without enabling web search", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const draft = modelRead() as any;
    const stockTitanUrl = "https://www.stocktitan.net/news/PAPL/pineapple-financial-reports-results.html";
    draft.catalystRealityCheck = {
      status: "confirmed",
      summary: "A same-day third-quarter results headline is present.",
      dayTradeRelevance: "The title confirms a catalyst exists, but its strength remains unverified.",
      sourceUrls: [stockTitanUrl],
    };
    draft.dilutionRisk = {
      level: "unknown",
      summary: "The title does not establish dilution terms.",
      dayTradeRelevance: "Do not infer dilution from the RSS title.",
      sourceUrls: [],
      canCompanyIssueToday: null,
      companyIssuance: {
        status: "unknown",
        earliestDate: null,
        trigger: "unknown",
        summary: "No issuance evidence is present in the title.",
      },
      publicResale: {
        status: "unknown",
        earliestDate: null,
        trigger: "unknown",
        summary: "No resale evidence is present in the title.",
      },
    };
    draft.listingStatus = {
      status: "unknown",
      immediacy: "unknown",
      summary: "The title does not establish listing status.",
      dayTradeRelevance: "Do not infer listing risk from the RSS title.",
      sourceUrls: [],
    };
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async (_url, init) => {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(draft) }],
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });

    const read = await service.generate({
      snapshot: snapshot(),
      priceAction: priceAction(),
      dataAsOf: DATA_AS_OF,
      research: {
        ticker: "PAPL",
        businessDays: 5,
        generatedAt: "2026-07-20T21:41:00.000Z",
        count: 1,
        articles: [{
          ticker: "PAPL",
          title: "Pineapple Financial Reports $25.3 Million in Third-Quarter Net Income",
          url: stockTitanUrl,
          publishedAt: "2026-07-20T21:19:00.000Z",
          eventType: "stocktitan_rss_catalyst",
          sourceKind: "stocktitan_rss",
        }],
      },
    });

    assert.equal(read.externalResearchEnabled, false);
    assert.equal(read.usedWebSearch, false);
    assert.equal(read.usage.webSearchCallCount, 0);
    assert.equal(read.sources.length, 1);
    assert.equal(read.sources[0]?.sourceType, "stocktitan_rss");
    assert.equal(read.sources[0]?.evidence?.excerptKind, "article_title");
    const requestBody = requestBodies[0]!;
    assert.equal(requestBody.tools, undefined);
    const input = requestBody.input as Array<{ role: string; content: Array<{ text: string }> }>;
    assert.match(input[0]!.content[0]!.text, /title-only fallback/i);
    assert.match(input[0]!.content[0]!.text, /Do not infer catalyst strength/i);
    const packet = JSON.parse(input[1]!.content[0]!.text) as {
      primaryCatalystResearch: {
        source: string;
        articles: Array<{ sourceKind: string; sourceSummary: string | null }>;
      };
    };
    assert.equal(packet.primaryCatalystResearch.source, "StockTitan ticker RSS title fallback");
    assert.equal(packet.primaryCatalystResearch.articles[0]?.sourceKind, "stocktitan_rss");
    assert.equal(packet.primaryCatalystResearch.articles[0]?.sourceSummary, null);
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
          title: "TGHL files merger and financing 8-K",
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

  it("does not let a source URL support an unrelated dilution or listing claim", async () => {
    const unsafeRead = modelRead();
    unsafeRead.dilutionRisk = {
      level: "high",
      summary: "A large offering could create immediate supply.",
      dayTradeRelevance: "Supply can cap spikes.",
      sourceUrls: ["https://example.com/unrelated"],
      canCompanyIssueToday: true,
      companyIssuance: { status: "immediate", earliestDate: "2026-07-17", trigger: "already_issued", summary: "Immediate." },
      publicResale: { status: "unknown", earliestDate: null, trigger: "unknown", summary: "Unknown." },
    };
    unsafeRead.listingStatus = {
      status: "suspension_scheduled",
      immediacy: "immediate",
      summary: "Trading suspension is scheduled.",
      dayTradeRelevance: "Trading access could be affected now.",
      sourceUrls: ["https://example.com/unrelated"],
    };
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async () => new Response(JSON.stringify({
        output: [{
          type: "web_search_call",
          action: { sources: [{ title: "TGHL announces new product launch", url: "https://example.com/unrelated" }] },
        }, {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(unsafeRead) }],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    });

    const read = await service.generate({
      snapshot: snapshot(),
      priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
    });

    assert.equal(read.dilutionRisk.level, "unknown");
    assert.deepEqual(read.dilutionRisk.sourceUrls, []);
    assert.equal(read.listingStatus.status, "unknown");
    assert.deepEqual(read.listingStatus.sourceUrls, []);
  });

  it("lowers confidence when the runtime quote materially disagrees with the current candle", async () => {
    const highConfidenceRead = modelRead();
    highConfidenceRead.confidence = "high";
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async () => new Response(JSON.stringify({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(highConfidenceRead) }],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    const conflictingSnapshot = { ...snapshot(), currentPrice: 1 };

    const read = await service.generate({
      snapshot: conflictingSnapshot,
      priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
    });

    assert.equal(read.confidence, "low");
    assert.ok(read.riskSummary.some((item) => /differs from the runtime quote/i.test(item)));
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

    const attempts: Array<{ attemptType: string; status: string }> = [];
    await assert.rejects(
      service.generate({
        snapshot: snapshot(),
        priceAction: priceAction(),
        research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
        onAttempt: (attempt) => attempts.push({
          attemptType: attempt.attemptType,
          status: attempt.status,
        }),
      }),
      /invalid tactical trade map.*needsToHold/i,
    );
    assert.deepEqual(attempts, [
      { attemptType: "primary", status: "invalid_output" },
      { attemptType: "correction", status: "invalid_output" },
    ]);
  });

  it("rejects an AI Read that relabels a continuation level as the current premarket high", async () => {
    for (const currentRead of [
      "NXXT is holding above its premarket rebound shelf after rejecting the $0.3658 session high.",
      "VMAR has built a premarket shelf around $0.32-$0.33 after rejecting the $0.3658 high.",
    ]) {
      const invalidRead = premarketModelRead(currentRead);
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
          snapshot: { ...snapshot(), timestamp: PREMARKET_DATA_AS_OF, currentPrice: 0.3336 },
          dataAsOf: PREMARKET_DATA_AS_OF,
          priceAction: premarketPriceAction(),
          research: { ticker: "NXXT", businessDays: 5, count: 0, articles: [] },
        }),
        /current premarket high.*0\.3469/i,
      );
    }
  });

  it("allows a separate continuation level when the stated premarket high matches OHLCV", async () => {
    const validRead = premarketModelRead(
      "NXXT rejected the $0.3469 premarket high; $0.3658 remains a separate prior-session continuation boundary.",
    );
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async () => new Response(JSON.stringify({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(validRead) }],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    });

    const read = await service.generate({
      snapshot: { ...snapshot(), timestamp: PREMARKET_DATA_AS_OF, currentPrice: 0.3336 },
      dataAsOf: PREMARKET_DATA_AS_OF,
      priceAction: premarketPriceAction(),
      research: { ticker: "NXXT", businessDays: 5, count: 0, articles: [] },
    });

    assert.equal(read.breakoutContinuation.price, 0.3658);
    assert.match(read.currentRead, /0\.3469 premarket high/i);
  });

  it("does not mistake a calendar date for a claimed premarket-high price", async () => {
    const validRead = premarketModelRead(
      "The July 23 premarket high remains the immediate reference while price holds the rebound shelf.",
    );
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async () => new Response(JSON.stringify({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(validRead) }],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    });

    const read = await service.generate({
      snapshot: { ...snapshot(), timestamp: PREMARKET_DATA_AS_OF, currentPrice: 0.3336 },
      dataAsOf: PREMARKET_DATA_AS_OF,
      priceAction: premarketPriceAction(),
      research: { ticker: "NXXT", businessDays: 5, count: 0, articles: [] },
    });

    assert.match(read.currentRead, /July 23 premarket high/i);
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
            : { input_tokens: 200, output_tokens: 30 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });

    const attempts: Array<{ attemptType: string; status: string; totalTokens: number }> = [];
    const authorizedAttempts: Array<{ attemptNumber: number; attemptType: string; model: string }> = [];
    const read = await service.generate({
      snapshot: snapshot(),
      priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
      onAttempt: (attempt) => attempts.push({
        attemptType: attempt.attemptType,
        status: attempt.status,
        totalTokens: attempt.usage.totalTokens,
      }),
      authorizeAttempt: (attempt) => authorizedAttempts.push({
        attemptNumber: attempt.attemptNumber,
        attemptType: attempt.attemptType,
        model: attempt.model,
      }),
    });

    assert.equal(requestBodies.length, 2);
    assert.deepEqual(requestBodies[0]!.tools, [{ type: "web_search" }]);
    assert.equal(requestBodies[1]!.tools, undefined);
    assert.equal(
      (requestBodies[1]!.input as unknown[]).length,
      3,
    );
    const correctionInput = requestBodies[1]!.input as Array<{
      content: Array<{ text: string }>;
    }>;
    const correctionPayload = correctionInput[2]!.content[0]!.text;
    assert.doesNotMatch(correctionPayload, /authoritativeMarketPacket|rejectedDraft|rejectedNormalizedResponse/);
    assert.deepEqual(authorizedAttempts, [
      { attemptNumber: 1, attemptType: "primary", model: "test-model" },
      { attemptNumber: 2, attemptType: "correction", model: "test-model" },
    ]);
    assert.equal(read.cautionBelow.price, 1.25);
    assert.equal(read.usage.inputTokens, 300);
    assert.equal(read.usage.outputTokens, 50);
    assert.equal(read.usage.totalTokens, 350);
    assert.deepEqual(attempts, [
      { attemptType: "primary", status: "invalid_output", totalTokens: 120 },
      { attemptType: "correction", status: "success", totalTokens: 230 },
    ]);
  });

  it("stops after two invalid drafts without buying a validation fallback", async () => {
    const invalidRead = modelRead();
    invalidRead.needsToHold = {
      label: "Invalid hold",
      price: 1.5,
      rationale: "This intentionally invalid fixture is above the reference quote.",
    };
    let requestCount = 0;
    const attempts: Array<{ attemptType: string; status: string; model: string }> = [];
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-primary",
      fallbackModel: "test-fallback",
      fetchImpl: async () => {
        requestCount += 1;
        const responseRead = requestCount < 3 ? invalidRead : modelRead();
        return new Response(JSON.stringify({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(responseRead) }],
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });

    await assert.rejects(
      service.generate({
        snapshot: snapshot(),
        priceAction: priceAction(),
        research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
        onAttempt: (attempt) => attempts.push({
          attemptType: attempt.attemptType,
          status: attempt.status,
          model: attempt.model,
        }),
      }),
      /invalid tactical trade map/i,
    );

    assert.equal(requestCount, 2);
    assert.deepEqual(attempts, [
      { attemptType: "primary", status: "invalid_output", model: "test-primary" },
      { attemptType: "correction", status: "invalid_output", model: "test-primary" },
    ]);
  });

  it("does not count a budget-blocked correction as an API attempt", async () => {
    const invalidRead = modelRead();
    invalidRead.needsToHold = {
      label: "Invalid hold",
      price: 1.5,
      rationale: "This fixture is above the reference quote.",
    };
    let requestCount = 0;
    const attempts: Array<{ attemptType: string; status: string }> = [];
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-primary",
      fetchImpl: async () => {
        requestCount += 1;
        return new Response(JSON.stringify({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(invalidRead) }],
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });

    await assert.rejects(
      service.generate({
        snapshot: snapshot(),
        priceAction: priceAction(),
        research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
        authorizeAttempt: ({ attemptNumber }) => {
          if (attemptNumber === 2) {
            throw new Error("fixture per-ticker budget reached");
          }
        },
        onAttempt: (attempt) => attempts.push({
          attemptType: attempt.attemptType,
          status: attempt.status,
        }),
      }),
      /fixture per-ticker budget reached/,
    );

    assert.equal(requestCount, 1);
    assert.deepEqual(attempts, [
      { attemptType: "primary", status: "invalid_output" },
    ]);
  });

  it("keeps operational volume availability out of the user-facing AI Read", async () => {
    const invalidRead = modelRead();
    invalidRead.currentRead =
      "Price is holding the premarket shelf. There is no premarket volume reported by the provider.";
    let requestNumber = 0;
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async () => {
        requestNumber += 1;
        const draft = requestNumber === 1 ? invalidRead : modelRead();
        return new Response(JSON.stringify({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(draft) }],
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });

    const read = await service.generate({
      snapshot: snapshot(),
      priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
    });

    assert.equal(requestNumber, 2);
    assert.doesNotMatch(read.currentRead, /no premarket volume/i);
  });

  it("grounds a candle-matched checkpoint deterministically instead of buying a correction", async () => {
    const draft = modelRead();
    draft.downsideCheckpoints = [{
      label: "Outer downside checkpoint",
      price: 1.05,
      condition: "Relevant only if the original setup fails.",
    }];
    let requestCount = 0;
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async () => {
        requestCount += 1;
        return new Response(JSON.stringify({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(draft) }],
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });

    const read = await service.generate({
      snapshot: snapshot(),
      priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
    });

    assert.equal(requestCount, 1);
    assert.match(read.downsideCheckpoints[0]?.condition ?? "", /observed daily candle/i);
  });

  it("grounds a prior-close checkpoint deterministically instead of buying a correction", async () => {
    const draft = modelRead();
    draft.downsideCheckpoints = [{
      label: "Outer downside checkpoint",
      price: 0.8,
      condition: "Relevant only if the original setup fails.",
    }];
    const tape = priceAction();
    tape.priorRegularClose = 0.8;
    let requestCount = 0;
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async () => {
        requestCount += 1;
        return new Response(JSON.stringify({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(draft) }],
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });

    const read = await service.generate({
      snapshot: snapshot(),
      priceAction: tape,
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
    });

    assert.equal(requestCount, 1);
    assert.match(read.downsideCheckpoints[0]?.condition ?? "", /observed prior close/i);
  });

  it("drops an unsupported optional checkpoint instead of rejecting the complete AI Read", async () => {
    const draft = modelRead();
    draft.downsideCheckpoints = [{
      label: "Unsupported outer checkpoint",
      price: 0.7,
      condition: "Relevant only if the original setup fails.",
    }];
    let requestCount = 0;
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async () => {
        requestCount += 1;
        return new Response(JSON.stringify({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(draft) }],
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });

    const read = await service.generate({
      snapshot: snapshot(),
      priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
    });

    assert.equal(requestCount, 1);
    assert.deepEqual(read.downsideCheckpoints, []);
  });

  it("drops duplicate scenario checkpoints instead of paying for a correction", async () => {
    const duplicateCheckpointRead = modelRead();
    const duplicateMomentumFailure = duplicateCheckpointRead.momentumFailure as { price: number };
    duplicateCheckpointRead.downsideCheckpoints = [
      {
        label: "Duplicate failure reference",
        price: duplicateMomentumFailure.price,
        condition: "The prior regular session low becomes the same failure reference.",
      },
      {
        label: "Lower daily range",
        price: 1.05,
        condition: "The recent daily range low is exposed if the regular-session floor fails.",
      },
    ];
    let requestCount = 0;
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async () => {
        requestCount += 1;
        return new Response(JSON.stringify({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(duplicateCheckpointRead) }],
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });

    const read = await service.generate({
      snapshot: snapshot(),
      priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
    });

    assert.equal(requestCount, 1);
    assert.deepEqual(read.downsideCheckpoints.map((checkpoint) => checkpoint.price), [1.05]);
  });

  it("records an unavailable primary model and successful fallback as separate attempts", async () => {
    const requestedModels: string[] = [];
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "unavailable-model",
      fallbackModel: "test-fallback-model",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { model?: string };
        requestedModels.push(body.model ?? "");
        if (body.model === "unavailable-model") {
          return new Response(JSON.stringify({
            error: { message: "The requested model was not found or is not accessible." },
          }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          id: "resp_fallback_success",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(modelRead()) }],
          }],
          usage: { input_tokens: 200, output_tokens: 30, total_tokens: 230 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });

    const attempts: Array<{
      attemptType: string;
      status: string;
      model: string;
      totalTokens: number;
    }> = [];
    const generated = await service.generate({
      snapshot: snapshot(),
      priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
      onAttempt: (attempt) => attempts.push({
        attemptType: attempt.attemptType,
        status: attempt.status,
        model: attempt.model,
        totalTokens: attempt.usage.totalTokens,
      }),
    });

    assert.deepEqual(requestedModels, ["unavailable-model", "test-fallback-model"]);
    assert.equal(generated.model, "test-fallback-model");
    assert.deepEqual(attempts, [
      {
        attemptType: "primary",
        status: "transport_error",
        model: "unavailable-model",
        totalTokens: 0,
      },
      {
        attemptType: "fallback",
        status: "success",
        model: "test-fallback-model",
        totalTokens: 230,
      },
    ]);
  });

  it("uses the existing API key by default and honors the global off switch", () => {
    const service = createTradersLinkAiReadServiceFromEnv({ OPENAI_API_KEY: "test-key" });
    assert.ok(service);
    assert.equal(service.isExternalResearchEnabled(), false);
    assert.equal(service.getConfiguredModel(), "gpt-5.6-terra");
    assert.equal(service.getReasoningEffort(), "high");
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
