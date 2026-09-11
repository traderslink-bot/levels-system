import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildBreakoutEvidence } from "../lib/ai/traderslink-ai-read-breakout-selection.js";
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
  // Synthetic historical spike supports the fixture's 1.68 continuation.
  // The continuation must not pass solely because its rationale says "range high".
  dailyCandles[0] = { ...dailyCandles[0]!, open: 1.4, high: 1.68, close: 1.5 };
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
    dailyCandles: [...priceAction().dailyCandles, {
      timestamp: PREMARKET_DATA_AS_OF - 86400000, open: 0.34, high: 0.3658, low: 0.32, close: 0.35, volume: 75000,
    }],
  };
}

function premarketModelRead(currentRead: string): Record<string, unknown> {
  return {
    ...modelRead(),
    currentRead,
    mustClearEvidence: { anchorPrice: 0.3469, basis: "confirmation_above", explanation: "Confirmation above the observed premarket high." },
    coreEvidence: {
      needsToHold: { anchorPrice: 0.325, basis: "threshold_below", explanation: "Decision threshold below the observed premarket low." },
      cautionBelow: { anchorPrice: 0.325, basis: "threshold_below", explanation: "Lower caution threshold below that base." },
      momentumFailure: { anchorPrice: 0.325, basis: "threshold_below", explanation: "Proposed thesis-failure threshold, not an observed traded low." },
    },
    needsToHold: {
      label: "Premarket shelf",
      price: 0.32,
      rationale: "Proposed hold threshold below the observed premarket consolidation low.",
    },
    cautionBelow: {
      label: "Premarket caution",
      price: 0.312,
      rationale: "A loss of the premarket higher-low base would weaken the rebound.",
    },
    momentumFailure: {
      label: "Premarket failure",
      price: 0.3,
      rationale: "A move to this proposed threshold below the premarket low would invalidate the rebound.",
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
    targets: [{
      label: "Daily range objective",
      price: 0.3851,
      condition: "Only after the prior regular-session range holds as support.",
    }],
    downsideCheckpoints: [{
      label: "Lower daily range",
      price: 0.2446,
      condition: "The recent daily range low is exposed if the premarket floor fails.",
    }],
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
    mustClear: { label: "Confirmation threshold", price: 1.5, rationale: "Proposed confirmation above the observed daily high, not a tested price." },
    mustClearEvidence: { anchorPrice: 1.3, basis: "confirmation_above", explanation: "Proposed confirmation beyond the daily high." },
    breakoutContinuation: { label: "Range-high continuation", price: 1.68, rationale: "Acceptance above the observed daily spike high opens the continuation path." },
    targets: [{ label: "First continuation area", price: 1.8, condition: "Only after $1.68 holds as support." }],
    downsideCheckpoints: [
      { label: "First lower support", price: 1.12, condition: "Exposed if the prior regular session low loses acceptance." },
      { label: "Outer lower support", price: 1.05, condition: "Next daily range low if $1.12 fails." },
    ],
    pullbackPlans: { shallow: null, deep: null },
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
  it("keeps conflicting and future bars out of the model packet and breakout catalog", () => {
    const context = priceAction();
    const latest = context.intradayCandles.at(-1)!;
    context.intradayCandles.push({ ...latest, close: latest.close - 0.001, volume: latest.volume + 1000 });
    context.intradayCandles.push({ ...latest, timestamp: DATA_AS_OF + 60000 });
    const packet = buildTradersLinkAiPriceActionPacket(context, 1.36, DATA_AS_OF) as {
      recentFiveMinuteBars: Array<{ timestamp: number }>;
    };
    assert.ok(packet.recentFiveMinuteBars.length > 0);
    assert.ok(packet.recentFiveMinuteBars.every(bar => bar.timestamp < latest.timestamp));
    assert.ok(buildBreakoutEvidence(context, 1, DATA_AS_OF).every(observation => observation.observedAt < latest.timestamp));
  });
  it("does not choose a conflicting reference candle by volume or input order", () => {
    const earlier = { timestamp: DATA_AS_OF - 60000, open: 1.3, high: 1.4, low: 1.2, close: 1.31, volume: 1000 };
    const current = { ...earlier, timestamp: DATA_AS_OF, close: 1.35 };
    const conflict = { ...current, close: 1.38, volume: 2000 };
    for (const field of ["oneMinuteCandles", "intradayCandles"] as const) {
      for (const bars of [[earlier, current, conflict], [conflict, current, earlier],
        [earlier, current, { ...current, close: NaN }]]) {
        const context = { ...priceAction(), oneMinuteCandles: [], intradayCandles: [], [field]: bars };
        assert.equal(resolveTradersLinkAiReadReferenceQuote(context, 1.25, DATA_AS_OF).price, earlier.close);
      }
      const duplicates = { ...priceAction(), oneMinuteCandles: [], intradayCandles: [],
        [field]: [current, { ...current, volume: 2000 }] };
      assert.equal(resolveTradersLinkAiReadReferenceQuote(duplicates, 1.25, DATA_AS_OF).price, current.close);
    }
  });
  it("never selects a future one-minute or five-minute reference candle", () => {
    for (const field of ["oneMinuteCandles", "intradayCandles"] as const) {
      const current = { timestamp: DATA_AS_OF, open: 1.3, high: 1.4, low: 1.2, close: 1.35, volume: 1000 };
      const future = { ...current, timestamp: DATA_AS_OF + 60000, close: 1.38 };
      const context: TradersLinkAiReadPriceActionContext = { ...priceAction(), oneMinuteCandles: [], intradayCandles: [], [field]: [current, future] };
      const quote = resolveTradersLinkAiReadReferenceQuote(context, 1.25, DATA_AS_OF);
      assert.equal(quote.price, current.close, field);
      assert.equal(quote.dataAsOf, DATA_AS_OF, field);
      context[field] = [future];
      const fallback = resolveTradersLinkAiReadReferenceQuote(context, 1.25, DATA_AS_OF);
      assert.equal(fallback.price, 1.25, field);
      assert.equal(fallback.dataAsOf, DATA_AS_OF, field);
    }
  });
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
  it("refusal, malformed and incomplete responses never publish or buy a repair request", async () => {
    const scenarios = [
      { output: [{ type: "message", content: [{ type: "refusal", refusal: "Cannot provide this analysis" }] }] },
      { output_text: "not JSON" },
      { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: '{"currentRead":' },
      { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: JSON.stringify(modelRead()) },
    ];
    for (const response of scenarios) {
      let calls = 0;
      const captures: any[] = [];
      const service = new OpenAITradersLinkAiReadService({ apiKey: "test-key", model: "test-model",
        auditStore: { save: event => { captures.push(event); return { saved: true }; } },
        fetchImpl: async () => { calls++; return Response.json(response); },
      });
      await assert.rejects(service.generate({ snapshot: snapshot(), priceAction: priceAction(),
        research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
      }), /OpenAI returned/);
      assert.equal(calls, 1);
      assert.equal(captures.some(event => event.phase === "prepared_payload"), false);
      assert.ok(captures.some(event => event.phase === "validation" && event.payload.valid === false));
    }
  });

  it("restricts Stock Titan web search to explicit no-article authority in the same request", async () => {
    for (const status of [undefined, "eligible", "lookup_unavailable", "no_eligible_article"] as const) {
      for (const hasProcessedArticle of [false, true]) {
        const requests: any[] = [];
        const service = new OpenAITradersLinkAiReadService({ apiKey: "test-key", model: "test-model", webSearchEnabled: true,
          fetchImpl: async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(modelRead()) }] }] });
          },
        });
        await service.generate({ snapshot: snapshot(), priceAction: priceAction(), research: {
          ticker: "TGHL", businessDays: 5, officialArticleSourceStatus: status,
          count: hasProcessedArticle ? 1 : 0,
          articles: hasProcessedArticle ? [{ ticker: "TGHL", title: "Processed news", url: "https://traderslink.pro/news/test",
            processedContent: "Canonical content" }] : [],
        } });
        assert.equal(requests.length, 1);
        const allowed = status === "no_eligible_article" && !hasProcessedArticle;
        assert.deepEqual(requests[0].tools, [{ type: "web_search", ...(!allowed ? { filters: { blocked_domains: ["stocktitan.net"] } } : {}) }]);
        const input = JSON.parse(requests[0].input[1].content[0].text);
        assert.equal(input.primaryCatalystResearch.stockTitanSearchAllowed, allowed);
      }
    }
  });

  it("requires core price evidence while retaining explicitly derived thresholds in one request", async () => {
    let calls = 0;
    let draft = modelRead();
    draft.momentumFailure = { label: "Failure threshold", price: 0.91,
      rationale: "Proposed buffer below the observed daily low, not a tested price." };
    draft.downsideCheckpoints = [];
    const decisions: Record<string, unknown>[] = [];
    const service = new OpenAITradersLinkAiReadService({ apiKey: "test-key", model: "test-model",
      fetchImpl: async () => { calls++; return new Response(JSON.stringify({ output: [{ type: "message",
        content: [{ type: "output_text", text: JSON.stringify(draft) }] }] }), { status: 200 }); } });
    const input = { snapshot: snapshot(), priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
      onValidationDecision: (decision: Record<string, unknown>) => { decisions.push(decision); } };
    await assert.rejects(service.generate(input), /momentumFailure lacks observable price evidence/);
    assert.equal(calls, 1);
    draft = { ...draft, coreEvidence: {
      needsToHold: { anchorPrice: 1.25, basis: "observed_level", explanation: "Observed shelf" },
      cautionBelow: { anchorPrice: 1.25, basis: "observed_level", explanation: "Loss of that shelf" },
      momentumFailure: { anchorPrice: 0.95, basis: "threshold_below", explanation: "Proposed buffer below the daily low" },
    } };
    const read = await service.generate(input);
    assert.equal(calls, 2);
    assert.equal(read.momentumFailure.price, 0.91);
    assert.equal(Object.hasOwn(read, "coreEvidence"), false, "internal proof is not a public card field");
    const proof = decisions.findLast(decision => decision.stage === "core_evidence");
    assert.deepEqual(proof?.anchors, draft.coreEvidence);
    assert.deepEqual(proof?.issues, []);
    (draft.coreEvidence as any).momentumFailure.anchorPrice = 0.94;
    await assert.rejects(service.generate(input), /momentumFailure has no supported observed anchor/);
    assert.equal(calls, 3, "one provider request per explicit generation, no automatic corrections");
  });
  it("normalizes abort errors with read-only messages into a timeout error", async () => {
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 1,
      fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const abortError = new Error();
          Object.defineProperty(abortError, "message", {
            configurable: false,
            enumerable: false,
            get: () => "The operation was aborted.",
          });
          reject(abortError);
        }, { once: true });
      }),
    });

    await assert.rejects(
      service.generate({
        snapshot: snapshot(),
        priceAction: priceAction(),
        research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
      }),
      /OpenAI request timed out after \d+ms\./,
    );
  });

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
      snapshot: {
        ...snapshot(),
        verifiedFiftyTwoWeekLow: {
          price: 1.12,
          observedAt: DATA_AS_OF - 60_000,
          sourceLabel: "verified Yahoo daily-candle 52-week low",
        },
      },
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
    assert.equal(read.version, 3);
    assert.equal(read.breakoutContinuation.price, 1.68);
    assert.deepEqual(read.downsideCheckpoints.map((checkpoint) => checkpoint.price), [1.12, 1.05]);
    assert.deepEqual(read.catalystRealityCheck.sourceUrls, [
      "https://www.sec.gov/Archives/example",
      "https://example.com/listing-source",
    ]);

    const requestBody = requestBodies[0];
    assert.ok(requestBody);
    assert.deepEqual(requestBody.tools, [{ type: "web_search", filters: { blocked_domains: ["stocktitan.net"] } }]);
    assert.deepEqual(requestBody.include, ["web_search_call.action.sources"]);
    assert.equal(
      (requestBody.text as { format: { strict: boolean } }).format.strict,
      true,
    );
    const schema = (requestBody.text as {
      format: { schema: { properties: Record<string, unknown> } };
    }).format.schema;
    assert.ok(schema.properties.cautionBelow);
    assert.ok(schema.properties.coreEvidence);
    assert.ok(schema.properties.mustClearEvidence);
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
    assert.match(input[0]!.content[0]!.text, /verifiedFiftyTwoWeekLow/);
    assert.match(input[0]!.content[0]!.text, /must never dominate the read/);
    assert.match(input[0]!.content[0]!.text, /distinct from an immediate momentum retest inside ordinary candle noise/);
    assert.match(input[0]!.content[0]!.text, /Evaluate candidate bases and momentumFailure jointly/);
    assert.match(input[0]!.content[0]!.text, /Do not move failure merely to fit a desired percentage/);
    assert.doesNotMatch(input[0]!.content[0]!.text, /shallow is the controlled momentum retest/);
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
        verifiedFiftyTwoWeekLow: {
          price: number;
          relationshipToCurrentPrice: "above" | "at_or_near" | "broken";
          isLastDetectableSupport: boolean;
        } | null;
        priceAction: {
          recentFiveMinuteBars: unknown[];
          sessionPhaseSummaries: unknown[];
          recentSessionReferencePoints: unknown[];
          completedRegularSessionFifteenMinuteBars: unknown[];
          historicalCoverage: {
            dailyCandleCount: number;
            longRangeDailyContext: boolean;
          };
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
    assert.deepEqual(packet.marketPacket.verifiedFiftyTwoWeekLow, {
      price: 1.12,
      source: "verified Yahoo daily-candle 52-week low",
      observedAt: DATA_AS_OF - 60_000,
      observedAtIso: new Date(DATA_AS_OF - 60_000).toISOString(),
      distanceFromCurrentPricePct: 17.77,
      relationshipToCurrentPrice: "above",
      isLastDetectableSupport: false,
    });
    assert.equal(packet.marketPacket.priceAction.recentFiveMinuteBars.length, 24);
    assert.ok(packet.marketPacket.priceAction.sessionPhaseSummaries.length > 0);
    assert.ok(packet.marketPacket.priceAction.recentSessionReferencePoints.length > 0);
    assert.equal(typeof packet.marketPacket.priceAction.recentRange.highBar.session, "string");
    assert.ok(packet.marketPacket.priceAction.completedRegularSessionFifteenMinuteBars.length > 0);
    assert.equal(packet.marketPacket.priceAction.historicalCoverage.dailyCandleCount, 20);
    assert.equal(packet.marketPacket.priceAction.historicalCoverage.longRangeDailyContext, false);
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
    assert.equal(packet.primaryCatalystResearch.source, "TradersLink processed article");
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

  it("publishes only candidate-backed, separated v3 pullback and recovery structures", async () => {
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

    const generationAudit: any[] = [];
    const generate = async (responseDraft: Record<string, unknown>) => {
      generationAudit.length = 0;
      let requests = 0;
      const service = new OpenAITradersLinkAiReadService({
        apiKey: "test-key",
        model: "test-model",
        auditStore: { save: event => { generationAudit.push(event); return { saved: true }; } },
        fetchImpl: async () => { requests += 1; return new Response(JSON.stringify({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(responseDraft) }],
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } }); },
      });
      const result = await service.generate({
        snapshot: { ...snapshot(), currentPrice },
        priceAction: tape,
        research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
      });
      assert.equal(requests, 1, "section recovery must not make another AI request");
      return result;
    };

    const read = await generate(draft);
    for (const [name, field, claim] of [
      ["shallow", "confirmation", "Premarket volume was zero."],
      ["deep", "rationale", "The provider did not report volume."],
      ["failureRecovery", "rationale", "There is no premarket volume."],
    ] as const) {
      const badText = structuredClone(draft) as Record<string, any>;
      const section = name === "failureRecovery" ? badText.failureRecovery : badText.pullbackPlans[name];
      section[field] = claim;
      const partial = await generate(badText);
      assert.equal(name === "failureRecovery" ? partial.failureRecovery : partial.pullbackPlans[name], null);
      assert.deepEqual(partial.pullbackPlans[name === "deep" ? "shallow" : "deep"], read.pullbackPlans[name === "deep" ? "shallow" : "deep"]);
      assert.equal(partial.currentRead, "");
      const decision = generationAudit.find(event => event.payload?.stage === "optional_sections");
      assert.ok(decision.payload.issues.some((issue: any) => issue.code === "unsupported_text" && issue.omitted[field] === claim));
    }
    const unsupportedContinuation = structuredClone(draft) as Record<string, any>;
    const badCore = structuredClone(draft) as Record<string, any>;
    badCore.momentumFailure.rationale = "Premarket volume was zero.";
    await assert.rejects(generate(badCore), /zero shares traded/);
    unsupportedContinuation.breakoutContinuation.price = 999;
    const partialContinuation = await generate(unsupportedContinuation);
    assert.equal(partialContinuation.breakoutContinuation.price, null);
    assert.ok(partialContinuation.pullbackPlans.deep, "independent deep setup survives an unsupported legacy continuation");
    const unsupportedClear = structuredClone(draft) as Record<string, any>;
    unsupportedClear.mustClearEvidence.anchorPrice = 999;
    const partialClear = await generate(unsupportedClear);
    assert.equal(partialClear.mustClear.price, null);
    assert.equal(partialClear.breakoutContinuation.price, null);
    assert.deepEqual(partialClear.targets, []);
    assert.ok(partialClear.pullbackPlans.deep, "independent deep setup survives unsupported must-clear evidence");
    assert.ok(generationAudit.some(event => event.payload?.stage === "must_clear_evidence" && event.payload.issues.length));
    const breakoutEvidence = buildBreakoutEvidence(tape, currentPrice, DATA_AS_OF);
    const anchor = breakoutEvidence.find(item => item.price > 1.7)!;
    assert.ok(anchor);
    const withBackup = structuredClone(draft) as Record<string, any>;
    const supportedBackup = { level: { label: "Breakout continuation", price: anchor.price,
      rationale: "Continuation threshold at the cited observation." },
      targets: [], evidenceIds: [anchor.id], anchorPrice: anchor.price, basis: "observed_level" };
    withBackup.breakoutCandidates = {
      primary: { ...supportedBackup, level: { ...supportedBackup.level, price: currentPrice - 0.1 } },
      alternate: supportedBackup,
    };
    const backupRead = await generate(withBackup);
    const outgoing = generationAudit.find(event => event.phase === "request");
    assert.ok(outgoing);
    const serializedRequest = JSON.stringify(outgoing.payload.body);
    assert.ok(serializedRequest.includes(anchor.id), "selected evidence was actually sent to the model");
    assert.equal(backupRead.breakoutContinuation.price, Number(anchor.price.toFixed(2)));
    assert.equal(Object.hasOwn(backupRead, "breakoutCandidates"), false);
    assert.ok(backupRead.pullbackPlans.deep, "independent deep setup survives backup selection");
    for (const badExplanation of ["Premarket volume was zero.", "The next supplied resistance level confirms the breakout."]) {
      const badPrimaryText = structuredClone(withBackup);
      badPrimaryText.breakoutCandidates.primary = { ...structuredClone(supportedBackup),
        level: { ...supportedBackup.level, rationale: badExplanation } };
      const selected = await generate(badPrimaryText);
      assert.equal(selected.breakoutContinuation.rationale, backupRead.breakoutContinuation.rationale);
      assert.ok(generationAudit.some(event => event.payload?.stage === "breakout_selection" && event.payload.selectedCandidateId === "alternate" &&
        event.payload.decisions[0].reasons.length > 0));
      badPrimaryText.breakoutCandidates.alternate.level.rationale = badExplanation;
      const omitted = await generate(badPrimaryText);
      assert.equal(omitted.breakoutContinuation.price, null);
      assert.ok(omitted.pullbackPlans.deep);
    }
    for (const name of ["mustClear", "breakoutContinuation"] as const) {
      const badLegacyText = structuredClone(draft) as Record<string, any>;
      badLegacyText[name].rationale = "Premarket volume was zero.";
      badLegacyText.pullbackPlans.shallow.confirmation = "Only after the breakout holds.";
      const partial = await generate(badLegacyText);
      assert.equal(partial[name].price, null);
      assert.equal(partial.breakoutContinuation.price, null);
      assert.deepEqual(partial.targets, []);
      assert.equal(partial.pullbackPlans.shallow, null, "dependent confirmation is omitted with its breakout");
      assert.ok(partial.pullbackPlans.deep, "independent deep setup remains");
      assert.ok(generationAudit.some(event => event.payload?.issues?.some((issue: any) => issue.path === name && issue.code === "unsupported_text")));
    }
    const withDependencies = structuredClone(withBackup);
    withDependencies.breakoutCandidates.alternate.targets = [
      { id: "bad", dependsOn: ["alternate"], label: "Bad sequence", price: 1.7, condition: "Observed daily high" },
      { id: "dependent", dependsOn: ["bad"], label: "Dependent", price: 2, condition: "Acceptance above the previous daily high opens this level" },
      { id: "independent", dependsOn: ["alternate"], label: "Independent daily high", price: 2.2, condition: "Observed daily rejection high" },
    ];
    const unsupportedDependenciesRead = await generate(withDependencies);
    assert.deepEqual(unsupportedDependenciesRead.targets, [], "daily-high words alone cannot ground the 2.20 price");
    tape.dailyCandles.push({ timestamp: DATA_AS_OF - 22 * 86400000,
      open: 2.1, high: 2.2, low: 2.05, close: 2.15, volume: 100000 });
    const dependenciesRead = await generate(withDependencies);
    const badTargetText = structuredClone(withDependencies);
    badTargetText.breakoutCandidates.alternate.targets[2].condition = "Premarket volume was zero.";
    const textPartial = await generate(badTargetText);
    assert.deepEqual(textPartial.targets, []);
    assert.equal(textPartial.breakoutContinuation.price, dependenciesRead.breakoutContinuation.price);
    assert.ok(textPartial.pullbackPlans.deep);
    assert.ok(generationAudit.some(event => event.payload?.parsingIssues?.some((issue: any) => /zero shares traded/.test(issue.reason))));
    // Restore the successful selection audit used by the assertions below.
    await generate(withDependencies);
    tape.dailyCandles.pop();
    assert.deepEqual(dependenciesRead.targets.map(target => target.price), [2.2]);
    assert.equal(Object.hasOwn(dependenciesRead.targets[0]!, "dependsOn"), false);
    const selectionAudit = generationAudit.find(event => event.phase === "validation" && event.payload?.stage === "breakout_selection");
    assert.ok(selectionAudit, "selection decision is durably capturable");
    assert.equal(selectionAudit.payload.selectedCandidateId, "alternate");
    assert.ok(selectionAudit.payload.parsingIssues.some((issue: any) => issue.path.endsWith(".bad")));
    assert.ok(selectionAudit.payload.parsingIssues.some((issue: any) => issue.path.endsWith(".dependent")));
    withBackup.breakoutCandidates.primary = supportedBackup;
    withBackup.breakoutCandidates.alternate = { ...supportedBackup, evidenceIds: ["invented"] };
    assert.equal((await generate(withBackup)).breakoutContinuation.price, Number(anchor.price.toFixed(2)));
    withBackup.breakoutCandidates.primary = { ...supportedBackup, evidenceIds: ["invented"] };
    const noBreakout = await generate(withBackup);
    assert.equal(noBreakout.breakoutContinuation.price, null);
    assert.ok(noBreakout.pullbackPlans.deep);
    withBackup.breakoutCandidates.primary = { ...supportedBackup, level: { ...supportedBackup.level, price: "1.80" } };
    withBackup.breakoutCandidates.alternate = supportedBackup;
    assert.equal((await generate(withBackup)).breakoutContinuation.price, Number(anchor.price.toFixed(2)));
    for (const malformed of [null, [], "invalid"]) {
      withBackup.breakoutCandidates = malformed;
      const partial = await generate(withBackup);
      assert.equal(partial.breakoutContinuation.price, null);
      assert.ok(partial.pullbackPlans.deep);
    }
    assert.equal(read.pullbackPlans.shallow?.evidenceIds[0], shallowCandidate.id);
    assert.equal(read.pullbackPlans.deep?.evidenceIds[0], deepCandidate.id);
    assert.equal(read.failureRecovery?.firstReclaimPrice, 1.1);

    const invalidBreakout = structuredClone(draft) as Record<string, any>;
    invalidBreakout.mustClear.price = currentPrice - 0.1;
    invalidBreakout.pullbackPlans.shallow.confirmation = "Reclaim the consolidation high before considering an upside target.";
    invalidBreakout.pullbackPlans.shallow.rationale = "The observed base supplies an independent pullback target.";
    const partialBreakout = await generate(invalidBreakout);
    assert.equal(partialBreakout.mustClear.price, null);
    assert.equal(partialBreakout.breakoutContinuation.price, null);
    assert.deepEqual(partialBreakout.targets, []);
    assert.ok(partialBreakout.pullbackPlans.shallow);
    assert.ok(partialBreakout.pullbackPlans.deep);
    assert.equal(partialBreakout.pullbackPlans.shallow.confirmation, invalidBreakout.pullbackPlans.shallow.confirmation);
    assert.equal(partialBreakout.pullbackPlans.shallow.rationale, invalidBreakout.pullbackPlans.shallow.rationale);
    assert.equal(partialBreakout.currentRead, "");

    const dependentBreakout = structuredClone(draft) as Record<string, any>;
    dependentBreakout.breakoutContinuation.price = dependentBreakout.mustClear.price;
    dependentBreakout.pullbackPlans.shallow.confirmation = "Only after the breakout holds.";
    dependentBreakout.pullbackPlans.deep.firstObjectivePrice = dependentBreakout.mustClear.price;
    const dependentRead = await generate(dependentBreakout);
    assert.equal(dependentRead.pullbackPlans.shallow, null);
    assert.ok(dependentRead.pullbackPlans.deep);
    assert.equal(dependentRead.pullbackPlans.deep.firstObjectivePrice, null);
    assert.equal(dependentRead.breakoutContinuation.price, null);
    assert.deepEqual(dependentRead.targets, []);

    const finalDependencies = structuredClone(draft) as Record<string, any>;
    finalDependencies.breakoutContinuation.price = finalDependencies.mustClear.price;
    finalDependencies.downsideCheckpoints = [
      null,
      { id: "removed", dependsOn: ["momentumFailure"], label: "Breakout dependent", price: 0.85, condition: "Only after the breakout fails." },
      { id: "child", dependsOn: ["removed"], label: "Later dependent", price: 0.8, condition: "After the earlier checkpoint fails." },
      { id: "independent", dependsOn: ["momentumFailure"], label: "Independent daily low", price: 0.75, condition: "The observed daily low remains relevant." },
    ];
    tape.dailyCandles.push({ timestamp: DATA_AS_OF - 23 * 86400000,
      open: 0.85, high: 1, low: 0.75, close: 0.8, volume: 100000 });
    const assembled = await generate(finalDependencies);
    tape.dailyCandles.pop();
    assert.deepEqual(assembled.downsideCheckpoints.map(point => point.price), [0.75]);
    assert.ok(assembled.pullbackPlans.deep);
    const finalAudit = generationAudit.find(event => event.payload?.validationPass === "final_assembly");
    assert.deepEqual(finalAudit.payload.issues.map((issue: any) => issue.id), ["child"]);

    const invalidCases: Array<[string, (value: Record<string, any>) => void, RegExp]> = [
      ["shallow above reference", (value) => {
        value.pullbackPlans.shallow.zoneHigh = currentPrice + 0.1;
      }, /generation reference/i],
      ["invented candidate", (value) => {
        value.pullbackPlans.shallow.evidenceIds = ["invented-zone"];
      }, /invented candidate ID/i],
      ["overlapping zones", (value) => {
        value.pullbackPlans.deep = { ...value.pullbackPlans.shallow };
      }, /materially separated/i],
      ["reversed zone", (value) => {
        const low = value.pullbackPlans.shallow.zoneLow;
        value.pullbackPlans.shallow.zoneLow = value.pullbackPlans.shallow.zoneHigh;
        value.pullbackPlans.shallow.zoneHigh = low;
      }, /zone is reversed/i],
      ["objective below entry", (value) => {
        value.pullbackPlans.shallow.firstObjectivePrice = value.pullbackPlans.shallow.zoneLow;
      }, /first objective must be above/i],
      ["recovery without reclaim", (value) => {
        value.failureRecovery.firstReclaimPrice = value.failureRecovery.recoveryZoneHigh;
      }, /first reclaim must be above/i],
      ["recovery objective duplicates restoration", (value) => {
        value.failureRecovery.firstObjectivePrice = value.failureRecovery.setupRestorePrice;
      }, /objective must be distinct/i],
    ];
    for (const [label, mutate] of invalidCases) {
      const invalid = structuredClone(draft) as Record<string, any>;
      mutate(invalid);
      if (label === "overlapping zones") {
        const partial = await generate(invalid);
        assert.equal(partial.pullbackPlans.shallow, null, label);
        assert.deepEqual(partial.pullbackPlans.deep, read.pullbackPlans.shallow, label);
        assert.ok(partial.needsToHold.price !== null, label);
        assert.equal(partial.currentRead, "", label);
        continue;
      }
      const partial = await generate(invalid);
      assert.ok(partial.needsToHold.price !== null, label);
      assert.equal(partial.pullbackPlans.deep?.evidenceIds[0], deepCandidate.id, label);
      if (label === "invented candidate" || label === "reversed zone" || label === "shallow above reference") {
        assert.equal(partial.pullbackPlans.shallow, null, label);
        assert.equal(partial.currentRead, "", label);
      } else if (label === "objective below entry") {
        assert.ok(partial.pullbackPlans.shallow, label);
        assert.equal(partial.pullbackPlans.shallow.firstObjectivePrice, null, label);
      } else if (label === "recovery without reclaim") {
        assert.equal(partial.failureRecovery, null, label);
      } else {
        assert.ok(partial.failureRecovery, label);
        assert.equal(partial.failureRecovery.firstObjectivePrice, null, label);
      }
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
          processedContent: "TGHL completed a canonical processed article for this exact AI Read.",
          articleId: "article-tghl", revision: "3", contentSha256: "a".repeat(64),
          targetSessionDate: "2026-07-15", publishedDateEt: "2026-07-15", recency: "current_day",
        }],
      },
    });

    assert.equal(read.usedWebSearch, false);
    assert.equal(read.externalResearchEnabled, false);
    assert.equal(read.usage.webSearchCallCount, 0);
    assert.equal(requestBodies[0]!.tools, undefined);
    assert.equal(requestBodies[0]!.include, undefined);
    const packetInput = requestBodies[0]!.input as Array<{ content: Array<{ text: string }> }>;
    const articlePacket = JSON.parse(packetInput[1]!.content[0]!.text);
    assert.equal(articlePacket.primaryCatalystResearch.source, "TradersLink processed article");
    assert.equal(articlePacket.primaryCatalystResearch.articles[0]?.processedContent,
      "TGHL completed a canonical processed article for this exact AI Read.");
    assert.equal(articlePacket.primaryCatalystResearch.articles[0]?.articleId, "article-tghl");

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
    ]);
  });

  it("omits overview text that mislabels the premarket high while preserving valid setup prices", async () => {
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

      const read = await service.generate({
          snapshot: { ...snapshot(), timestamp: PREMARKET_DATA_AS_OF, currentPrice: 0.3336 },
          dataAsOf: PREMARKET_DATA_AS_OF,
          priceAction: premarketPriceAction(),
          research: { ticker: "NXXT", businessDays: 5, count: 0, articles: [] },
        });
      assert.equal(read.currentRead, "");
      assert.equal(read.breakoutContinuation.price, 0.3658);
    }
  });

  it("attributes a conflicting premarket claim to the optional scenario field", async () => {
    const draft = premarketModelRead("Price is testing the shelf.");
    draft.pullbackPlans = { shallow: {
      zoneLow: 0.31, zoneHigh: 0.32, confirmationPrice: 0.32, invalidationPrice: 0.30,
      firstObjectivePrice: null, evidenceIds: [],
      confirmation: "The $0.3469 premarket high was tested.",
      rationale: "The $0.3658 premarket high was rejected.",
    }, deep: null };
    const events: any[] = [];
    let requests = 0;
    const service = new OpenAITradersLinkAiReadService({ apiKey: "test-key", model: "test-model",
      auditStore: { save: event => { events.push(event); return { saved: true }; } },
      fetchImpl: async () => { requests += 1; return new Response(JSON.stringify({ output: [{
        type: "message", content: [{ type: "output_text", text: JSON.stringify(draft) }],
      }] }), { status: 200 }); },
    });
    const read = await service.generate({ snapshot: { ...snapshot(), timestamp: PREMARKET_DATA_AS_OF, currentPrice: 0.3336 },
      dataAsOf: PREMARKET_DATA_AS_OF, priceAction: premarketPriceAction(),
      research: { ticker: "NXXT", businessDays: 5, count: 0, articles: [] } });
    assert.equal(requests, 1);
    assert.equal(read.pullbackPlans.shallow, null);
    assert.equal(read.breakoutContinuation.price, 0.3658);
    assert.ok(events.some(event => event.payload?.issues?.some((issue: any) =>
      issue.path === "pullbackPlans.shallow" && issue.code === "unsupported_text" && /premarket high/.test(issue.reason))));
  });

  it("allows a separate continuation level when the stated premarket high matches OHLCV", async () => {
    const validRead = premarketModelRead(
      "NXXT rejected the $0.3469 premarket high; $0.3658 remains a separate prior-session continuation boundary.",
    );
    validRead.riskSummary = ["The $0.3658 premarket high was rejected.", "Watch buyer defense at the shelf."];
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
    assert.equal(read.riskSummary.includes("The $0.3658 premarket high was rejected."), false);
    assert.ok(read.riskSummary.includes("Watch buyer defense at the shelf."));
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

  it("does not buy a corrected draft after tactical validation fails", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const auditEvents: Array<{ phase: string; payload: unknown }> = [];
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
      auditStore: { save: event => { auditEvents.push(event); return { saved: true }; } },
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
    await assert.rejects(service.generate({
      snapshot: snapshot(),
      priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
      onAttempt: (attempt) => attempts.push({
        attemptType: attempt.attemptType,
        status: attempt.status,
        totalTokens: attempt.usage.totalTokens,
      }),
    }), /cautionBelow must not be above needsToHold/);

    assert.equal(requestBodies.length, 1);
    const savedAttempt = auditEvents.find(event => event.phase === "validation" && (event.payload as any).stage === "api_attempt")?.payload as any;
    assert.equal(savedAttempt.status, "invalid_output");
    assert.equal(savedAttempt.attemptSequence, 1);
    assert.equal(savedAttempt.usageReported, true);
    assert.equal(savedAttempt.usage.totalTokens, 120);
    assert.ok(Math.abs(savedAttempt.usage.estimatedTotalCostUsd - 0.00014) < 1e-10);
    assert.deepEqual(requestBodies[0]!.tools, [{ type: "web_search", filters: { blocked_domains: ["stocktitan.net"] } }]);
    assert.deepEqual(attempts, [
      { attemptType: "primary", status: "invalid_output", totalTokens: 120 },
    ]);
  });

  it("keeps operational volume availability out of the user-facing AI Read", async () => {
    const invalidRead = modelRead();
    const events: Array<{ phase: string; payload: unknown }> = [];
    invalidRead.riskSummary = ["The base must hold.", "Premarket volume was zero.", "Watch rejection at resistance."];
    invalidRead.currentRead =
      "Price is holding the premarket shelf. There is no premarket volume reported by the provider.";
    let requestNumber = 0;
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key",
      model: "test-model",
      auditStore: { save: event => { events.push(event); return { saved: true }; } },
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
    assert.equal(read.currentRead, "");
    assert.equal(read.breakoutContinuation.price, 1.68);
    assert.ok(read.riskSummary.includes("The base must hold."));
    assert.ok(read.riskSummary.includes("Watch rejection at resistance."));
    assert.equal(read.riskSummary.includes("Premarket volume was zero."), false);
    const omitted = events.find(event => event.phase === "validation" && (event.payload as any).stage === "optional_overview")?.payload as any;
    assert.deepEqual(omitted.issues.map((issue: any) => issue.path), ["currentRead", "riskSummary.1"]);
    assert.equal(omitted.issues[1].omitted, "Premarket volume was zero.");

    assert.equal(requestNumber, 1);
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

  it("omits a rejected outer daily addition without rejecting the validated analysis or making another request", async () => {
    const levels = snapshot();
    levels.resistanceZones = [{ ...levels.resistanceZones[0]!, representativePrice: 2.3,
      lowPrice: 2.29, highPrice: 2.31, sourceLabel: "daily confluence", strengthLabel: "strong" }];
    let requests = 0;
    const events: Array<{ phase: string; payload: unknown }> = [];
    const service = new OpenAITradersLinkAiReadService({ apiKey: "test-key", model: "test-model",
      auditStore: { save: event => { events.push(event); return { saved: true }; } },
      fetchImpl: async () => { requests++; return new Response(JSON.stringify({ output: [{ type: "message",
        content: [{ type: "output_text", text: JSON.stringify(modelRead()) }] }] }), { status: 200 }); } });
    const read = await service.generate({ snapshot: levels, priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] } });
    assert.equal(requests, 1);
    assert.deepEqual(read.targets.map(target => target.price), []);
    assert.equal(read.breakoutContinuation.price, 1.68);
    const omission = events.find(event => event.phase === "validation" && (event.payload as any).stage === "outer_daily_resistance")?.payload as any;
    assert.equal(omission.action, "omit_objective");
    assert.equal(omission.omitted[0].price, 2.3);
    assert.match(omission.reason, /observable price-action evidence/);
    assert.ok(events.some(event => event.phase === "validation" && (event.payload as any).valid === true));
  });

  it("retains farther daily resistance backed by an observed high in the same packet", async () => {
    const levels = snapshot();
    levels.resistanceZones = [{ ...levels.resistanceZones[0]!, representativePrice: 2.3,
      lowPrice: 2.29, highPrice: 2.31, sourceLabel: "daily confluence", strengthLabel: "strong" }];
    const tape = priceAction();
    tape.dailyCandles.push({ timestamp: DATA_AS_OF - 21 * 86400000, open: 2.1, high: 2.3, low: 2, close: 2.2, volume: 100000 });
    let requests = 0;
    const service = new OpenAITradersLinkAiReadService({ apiKey: "test-key", model: "test-model",
      fetchImpl: async () => { requests++; return new Response(JSON.stringify({ output: [{ type: "message",
        content: [{ type: "output_text", text: JSON.stringify(modelRead()) }] }] }), { status: 200 }); } });
    const read = await service.generate({ snapshot: levels, priceAction: tape,
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] } });
    assert.equal(requests, 1);
    assert.deepEqual(read.targets.map(target => target.price), [2.3]);
    assert.match(read.targets.at(-1)?.condition ?? "", /observed daily candle high/);
    assert.doesNotMatch(read.targets.at(-1)?.condition ?? "", /confluence/);
  });

  it("drops an unsupported optional checkpoint instead of rejecting the complete AI Read", async () => {
    const auditEvents: Array<{ phase: string; payload: unknown }> = [];
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
      auditStore: { save: (event) => { auditEvents.push(event); return { saved: true }; } },
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
    const normalization = auditEvents.find(event => event.phase === "validation" && (event.payload as any).stage === "observable_evidence_normalization")?.payload as any;
    assert.ok(normalization);
    assert.ok(normalization.changedPaths.includes("downsideCheckpoints"));
    assert.equal(normalization.before.downsideCheckpoints[0].price, 0.7);
    assert.deepEqual(normalization.after.downsideCheckpoints, []);
    assert.ok(Array.isArray(draft.downsideCheckpoints));
    assert.equal(draft.downsideCheckpoints[0]?.price, 0.7);
  });

  it("does not accept downside evidence words without a supplied price observation or support zone", async () => {
    const draft = modelRead();
    draft.downsideCheckpoints = [{ label: "Repeated tests held here", price: 0.7,
      condition: "Volume confirms the shelf." }];
    let calls = 0;
    const service = new OpenAITradersLinkAiReadService({ apiKey: "test-key", model: "test-model",
      fetchImpl: async () => { calls++; return new Response(JSON.stringify({ output: [{ type: "message",
        content: [{ type: "output_text", text: JSON.stringify(draft) }] }] }), { status: 200 }); } });
    const input = { snapshot: snapshot(), priceAction: priceAction(), research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] } };
    const unsupported = await service.generate(input);
    assert.deepEqual(unsupported.downsideCheckpoints, []);
    assert.equal(calls, 1);
    input.snapshot.supportZones.push({ ...input.snapshot.supportZones[0]!, representativePrice: 0.7, lowPrice: 0.69, highPrice: 0.71 });
    const supported = await service.generate(input);
    assert.equal(supported.downsideCheckpoints[0]?.price, 0.7);
    assert.match(supported.downsideCheckpoints[0]?.condition ?? "", /supplied support zone/);
    assert.equal(calls, 2, "one request per distinct supplied packet, no corrective calls");
  });

  it("uses valid one-minute observations for checkpoints without accepting future malformed or conflicting bars", async () => {
    let calls = 0;
    for (const side of ["upside", "downside"] as const) {
      const bar = side === "upside"
        ? { timestamp: DATA_AS_OF - 30 * 60000, open: 1.72, high: 1.8, low: 1.7, close: 1.75, volume: 1000 }
        : { timestamp: DATA_AS_OF - 30 * 60000, open: 0.8, high: 0.85, low: 0.7, close: 0.81, volume: 1000 };
      for (const scenario of [
        { bars: [bar], retained: true },
        { bars: [bar, { ...bar }], retained: true },
        { bars: [{ ...bar, timestamp: DATA_AS_OF + 60000 }], retained: false },
        { bars: [{ ...bar, close: bar.high + 1 }], retained: false },
        { bars: [bar, { ...bar, high: bar.high + 0.01 }], retained: false },
        { bars: [{ ...bar, high: bar.high + 0.01 }, bar], retained: false },
      ]) {
        const draft = modelRead();
        draft.targets = side === "upside" ? [{ label: "Next area", price: 1.8, condition: "Continuation area" }] : [];
        draft.downsideCheckpoints = side === "downside" ? [{ label: "Lower area", price: 0.7, condition: "After failure" }] : [];
        const service = new OpenAITradersLinkAiReadService({ apiKey: "test-key", model: "test-model",
          fetchImpl: async () => { calls++; return new Response(JSON.stringify({ output: [{ type: "message",
            content: [{ type: "output_text", text: JSON.stringify(draft) }] }] }), { status: 200 }); } });
        const read = await service.generate({ snapshot: snapshot(), priceAction: { ...priceAction(), oneMinuteCandles: scenario.bars },
          research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] } });
        const points = side === "upside" ? read.targets : read.downsideCheckpoints;
        assert.equal(points.length, scenario.retained ? 1 : 0, side);
        if (scenario.retained) assert.match(points[0]!.condition, /observed one-minute candle/);
      }
    }
    assert.equal(calls, 12, "one request for each packet; no paid corrections");
  });

  it("excludes future malformed and conflicting candles from checkpoint evidence while retaining valid duplicates", async () => {
    const bar = { timestamp: DATA_AS_OF - 30 * 86400000, open: 0.8, high: 0.85, low: 0.7, close: 0.81, volume: 1000 };
    const cases = [
      { bars: [bar], retained: true },
      { bars: [bar, { ...bar }], retained: true },
      { bars: [{ ...bar, timestamp: DATA_AS_OF + 60000 }], retained: false },
      { bars: [{ ...bar, open: 0.6 }], retained: false },
      { bars: [bar, { ...bar, low: 0.75 }], retained: false },
      { bars: [{ ...bar, low: 0.75 }, bar], retained: false },
      { bars: [bar, { ...bar, close: NaN }], retained: false },
    ];
    let calls = 0;
    for (const scenario of cases) {
      const draft = modelRead();
      draft.downsideCheckpoints = [{ label: "Lower checkpoint", price: 0.7, condition: "Only if momentum fails." }];
      const tape = priceAction(); tape.dailyCandles.push(...scenario.bars);
      const service = new OpenAITradersLinkAiReadService({ apiKey: "test-key", model: "test-model",
        fetchImpl: async () => { calls++; return new Response(JSON.stringify({ output: [{ type: "message",
          content: [{ type: "output_text", text: JSON.stringify(draft) }] }] }), { status: 200 }); } });
      const read = await service.generate({ snapshot: snapshot(), priceAction: tape,
        research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] } });
      assert.equal(read.downsideCheckpoints.length, scenario.retained ? 1 : 0);
    }
    assert.equal(calls, cases.length);
  });

  it("provides redacted review validation provenance without a diagnostic store or extra request", async () => {
    const decisions: Record<string, unknown>[] = [];
    const draft = modelRead();
    draft.downsideCheckpoints = [{ label: "Unsupported outer checkpoint privatecredentialvalue", price: 0.7,
      condition: "Relevant only if the original setup fails." }];
    let calls = 0;
    const service = new OpenAITradersLinkAiReadService({ apiKey: "privatecredentialvalue", model: "test-model",
      fetchImpl: async () => { calls++; return new Response(JSON.stringify({ output: [{ type: "message",
        content: [{ type: "output_text", text: JSON.stringify(draft) }] }] }), { status: 200 }); } });
    const read = await service.generate({ snapshot: snapshot(), priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
      onValidationDecision: decision => decisions.push(decision) });
    assert.equal(calls, 1);
    assert.deepEqual(read.downsideCheckpoints, []);
    assert.ok(decisions.some(decision => decision.stage === "observable_evidence_normalization"));
    assert.ok(decisions.every(decision => decision.stage !== "api_attempt"));
    assert.doesNotMatch(JSON.stringify(decisions), /privatecredentialvalue/);
    assert.match(JSON.stringify(decisions), /\[redacted\]/);
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

  it("captures the exact request and full response without transport credentials", async () => {
    const events: Array<{ phase: string; payload: unknown }> = [];
    let sentBody = "";
    const responseBody = JSON.stringify({ output: [{ type: "message",
      content: [{ type: "output_text", text: JSON.stringify(modelRead()) }] }] });
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "private-test-credential",
      model: "test-model",
      auditStore: { save: (event) => { events.push(event); return { saved: true }; } },
      fetchImpl: async (_url, init) => {
        sentBody = String(init?.body);
        return new Response(responseBody, { status: 200 });
      },
    });
    await service.generate({ snapshot: snapshot(), priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] } });
    assert.deepEqual(events.map((event) => event.phase), ["request", "response", "validation", "validation", "validation", "validation", "prepared_payload"]);
    assert.ok(events.some(event => event.phase === "validation" && (event.payload as any).stage === "must_clear_evidence"));
    assert.ok(events.some(event => event.phase === "validation" && (event.payload as any).stage === "observable_evidence_normalization"));
    const attempt = events.find(event => event.phase === "validation" && (event.payload as any).stage === "api_attempt")?.payload as any;
    assert.equal(attempt.attemptSequence, 1);
    assert.equal(attempt.status, "success");
    assert.equal(attempt.usageReported, false);
    assert.equal(attempt.usage, null);
    assert.deepEqual((events[0]!.payload as { body: unknown }).body, JSON.parse(sentBody));
    const capturedRequest = events[0]!.payload as any;
    const outgoingBody = JSON.parse(sentBody);
    const digest = (text: string) => createHash("sha256").update(text).digest("hex");
    assert.equal(capturedRequest.bodySha256, digest(sentBody));
    assert.equal(capturedRequest.promptSha256, digest(outgoingBody.input[0].content[0].text));
    assert.equal(capturedRequest.schemaSha256, digest(JSON.stringify(outgoingBody.text.format.schema)));
    const identity = (events[0]!.payload as any).codeIdentity;
    assert.equal(identity.scope, "analysis-module-files-at-service-load");
    assert.equal(identity.complete, true);
    assert.equal(identity.modules.length, 8);
    assert.match(identity.sha256, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(JSON.parse(sentBody), "codeIdentity"), false);
    assert.equal((events[1]!.payload as { body: string }).body, responseBody);
    assert.doesNotMatch(JSON.stringify(events), /private-test-credential|Authorization/);
  });

  it("omits bad legacy checkpoint text without rejecting the independent setup", async () => {
    // Both prices have synthetic observed support, isolating text from evidence.
    for (const field of ["targets", "downsideCheckpoints"] as const) {
      const tape = priceAction();
      tape.dailyCandles.push({ timestamp: DATA_AS_OF - 22 * 86400000,
        open: 1, high: 2.2, low: 0.85, close: 1.5, volume: 100000 });
      const draft = modelRead();
      draft[field] = [{ label: "Observed checkpoint", price: field === "targets" ? 2.2 : 0.85,
        condition: "Premarket volume was zero." }];
      let requests = 0;
      const service = new OpenAITradersLinkAiReadService({ apiKey: "test-key", model: "test-model",
        fetchImpl: async () => { requests += 1; return new Response(JSON.stringify({ output: [{ type: "message",
          content: [{ type: "output_text", text: JSON.stringify(draft) }] }] }), { status: 200 }); },
      });
      const read = await service.generate({ snapshot: snapshot(), priceAction: tape,
        research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] } });
      assert.deepEqual(read[field], []);
      assert.equal(read.breakoutContinuation.price, 1.68);
      assert.equal(requests, 1);
      const root = field === "targets" ? "breakoutContinuation" : "momentumFailure";
      const prices = field === "targets" ? [2.2, 2.3, 2.4] : [0.85, 0.8, 0.75];
      tape.dailyCandles.push({ timestamp: DATA_AS_OF - 23 * 86400000,
        open: 1, high: 2.4, low: 0.75, close: 1.5, volume: 100000 });
      draft[field] = [
        { id: "bad", dependsOn: [root], label: "Bad", price: prices[0], condition: "Premarket volume was zero." },
        { id: "dependent", dependsOn: ["bad"], label: "Dependent", price: prices[1], condition: "After the earlier checkpoint holds." },
        { id: "independent", dependsOn: [root], label: "Independent", price: prices[2], condition: "The observed daily boundary remains relevant." },
      ];
      const independent = await service.generate({ snapshot: snapshot(), priceAction: tape,
        research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] } });
      assert.deepEqual(independent[field].map(point => point.price), [prices[2]]);
      assert.equal(Object.hasOwn(independent[field][0]!, "id"), false);
      assert.equal(requests, 2, "two explicit generations, one request each");
    }
  });

  it("does not prepare a news-only analysis or pay for a second request", async () => {
    const draft = modelRead();
    for (const key of ["needsToHold", "cautionBelow", "momentumFailure", "mustClear", "breakoutContinuation"]) draft[key] = { label: "", price: null, rationale: "" };
    draft.currentRead = ""; draft.riskSummary = []; draft.targets = []; draft.downsideCheckpoints = [];
    let requests = 0;
    const events: Array<{ phase: string; payload: unknown }> = [];
    const service = new OpenAITradersLinkAiReadService({ apiKey: "test-key", model: "test-model",
      auditStore: { save: event => { events.push(event); return { saved: true }; } },
      fetchImpl: async () => { requests++; return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(draft) }] }] }), { status: 200 }); },
    });
    await assert.rejects(service.generate({ snapshot: snapshot(), priceAction: priceAction(), research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] } }), /no complete supported setup/);
    assert.equal(requests, 1);
    assert.ok(events.some(event => event.phase === "validation" && (event.payload as any).valid === false));
    assert.ok(!events.some(event => event.phase === "prepared_payload"));
  });

  it("audit storage failure cannot trigger another provider request", async () => {
    let requests = 0;
    const captures: Array<{ saved: boolean }> = [];
    const service = new OpenAITradersLinkAiReadService({
      apiKey: "test-key", model: "test-model",
      auditStore: { save: () => { throw new Error("disk failed"); } },
      fetchImpl: async () => {
        requests += 1;
        return new Response(JSON.stringify({ output: [{ type: "message",
          content: [{ type: "output_text", text: JSON.stringify(modelRead()) }] }] }), { status: 200 });
      },
    });
    const read = await service.generate({ snapshot: snapshot(), priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
      onAuditCapture: (result) => captures.push(result) });
    assert.equal(read.symbol, "TGHL");
    assert.equal(requests, 1);
    assert.equal(captures.length, 7);
    assert.ok(captures.every((result) => !result.saved));
  });

  it("records model-access failure without making a fallback request", async () => {
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
    await assert.rejects(service.generate({
      snapshot: snapshot(),
      priceAction: priceAction(),
      research: { ticker: "TGHL", businessDays: 5, count: 0, articles: [] },
      onAttempt: (attempt) => attempts.push({
        attemptType: attempt.attemptType,
        status: attempt.status,
        model: attempt.model,
        totalTokens: attempt.usage.totalTokens,
      }),
    }), /not found or is not accessible/);

    assert.deepEqual(requestedModels, ["unavailable-model"]);
    assert.deepEqual(attempts, [
      {
        attemptType: "primary",
        status: "transport_error",
        model: "unavailable-model",
        totalTokens: 0,
      },
    ]);
  });

  it("uses the existing API key by default and honors the global off switch", () => {
    const service = createTradersLinkAiReadServiceFromEnv({ OPENAI_API_KEY: "test-key" });
    assert.ok(service);
    assert.equal(service.isExternalResearchEnabled(), false);
    assert.equal(service.getConfiguredModel(), "gpt-5.6-terra");
    assert.equal(service.getReasoningEffort(), "medium");
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
