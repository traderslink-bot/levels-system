import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { LevelSnapshotPayload } from "../lib/alerts/alert-types.js";
import { TradersLinkAiReadCostLedger } from "../lib/ai/traderslink-ai-read-cost-ledger.js";
import {
  buildTradersLinkAiPriceActionPacket,
  buildTradersLinkAiReadMarketRegimeProfile,
} from "../lib/ai/traderslink-ai-read-price-action.js";
import { OpenAITradersLinkAiReadService } from "../lib/ai/traderslink-ai-read-service.js";
import type { TradersLinkAiReadPriceActionContext } from "../lib/ai/traderslink-ai-read-price-action.js";

type CandleTuple = [number, number, number, number, number, number];
type Fixture = {
  id: string;
  symbol: string;
  snapshot: { timestamp: number; currentPrice: number };
  priorRegularClose: number;
  intradayCandles: CandleTuple[];
  dailyCandles: CandleTuple[];
  research: Array<{ title: string; url: string; sourceUrl: string; filingType: string }>;
  modelResponse: Record<string, unknown>;
  expected: {
    currentPrice: [number, number];
    needsToHold: number;
    cautionBelow: number;
    momentumFailure: number;
    mustClear: number;
    breakoutContinuation: number;
    targets: number[];
    downsideCheckpoints: number[];
    catalystStatus?: string;
    dilutionLevel?: string;
  };
};

const fixturePack = JSON.parse(readFileSync(
  new URL("./fixtures/traderslink-ai-read-post-change-fixtures.json", import.meta.url),
  "utf8",
)) as { version: number; fixtures: Fixture[] };

function toCandles(rows: CandleTuple[]) {
  return rows.map(([timestamp, open, high, low, close, volume]) => ({
    timestamp,
    open,
    high,
    low,
    close,
    volume,
  }));
}

function snapshotFor(fixture: Fixture): LevelSnapshotPayload {
  return {
    symbol: fixture.symbol,
    timestamp: fixture.snapshot.timestamp,
    currentPrice: fixture.snapshot.currentPrice,
    marketStructure: null,
    supportZones: [],
    resistanceZones: [],
  } as LevelSnapshotPayload;
}

function priceActionFor(fixture: Fixture): TradersLinkAiReadPriceActionContext {
  return {
    source: "sanitized deterministic full-session OHLCV fixture",
    fetchedAt: fixture.snapshot.timestamp,
    priorRegularClose: fixture.priorRegularClose,
    intradayCandles: toCandles(fixture.intradayCandles),
    dailyCandles: toCandles(fixture.dailyCandles),
  };
}

function completeWideFixtureDraft(fixture: Fixture): {
  draft: Record<string, unknown>;
  expectedForwardPrices: number[];
} {
  const legacyPrices = fixture.expected.targets;
  const nearest = legacyPrices[0] ?? fixture.expected.breakoutContinuation * 1.1;
  const continued = legacyPrices[1] ?? Math.max(nearest * 1.15, fixture.expected.breakoutContinuation * 1.25);
  const priceAction = priceActionFor(fixture);
  const marketProfile = buildTradersLinkAiReadMarketRegimeProfile({
    intraday: priceAction.intradayCandles,
    daily: priceAction.dailyCandles,
    currentPrice: fixture.snapshot.currentPrice,
    priorRegularClose: priceAction.priorRegularClose,
    dataAsOf: fixture.snapshot.timestamp,
    oneMinuteFacts: {},
  });
  const coverageLimitPct = {
    normal: 50,
    elevated: 65,
    high_expansion: 80,
    extreme_expansion: 100,
  }[marketProfile.regime];
  const extreme = fixture.snapshot.currentPrice * (1 + coverageLimitPct / 100) * 0.995;
  assert.ok(
    extreme > continued + fixture.snapshot.currentPrice * 0.02,
    `${fixture.symbol} fixture has no room for separated strong and extreme horizons`,
  );
  const strong = continued + (extreme - continued) / 2;
  const packet = buildTradersLinkAiPriceActionPacket(
    priceAction,
    fixture.snapshot.currentPrice,
    fixture.snapshot.timestamp,
  );
  const pullbackCandidates = (
    (packet.oneMinuteEvidence as Record<string, unknown>).pullbackCandidates as
      Array<{ id: string; zoneLow: number; zoneHigh: number }>
  ) ?? [];
  const shallowCandidate = pullbackCandidates.find((candidate) =>
    candidate.zoneLow > 0 &&
    candidate.zoneLow <= candidate.zoneHigh &&
    candidate.zoneHigh < fixture.snapshot.currentPrice
  );
  assert.ok(shallowCandidate, `${fixture.symbol} fixture is missing a usable observed pullback candidate`);
  const invalidationOffset = Math.max(
    shallowCandidate.zoneLow * 0.01,
    fixture.snapshot.currentPrice < 1 ? 0.0001 : 0.01,
  );
  const expectedForwardPrices = [nearest, continued, strong, extreme]
    .map((value) => Number(value.toFixed(value < 1 ? 4 : 2)));
  const horizon = (price: number, basisType: string) => ({
    available: true,
    price,
    condition: "Sustained acceptance and volume confirmation are required for this fixture branch.",
    basisType,
    basisSummary: "A conditional scenario based on the sanitized supplied tape and daily volatility.",
    sourceFacts: ["sanitized supplied session range", "sanitized supplied daily volatility"],
    unavailableReasonCode: null,
    unavailableReason: null,
  });
  const { targets: _legacyTargets, ...draft } = fixture.modelResponse;
  return {
    draft: {
      ...draft,
      forwardPlan: {
        nearestRealistic: horizon(expectedForwardPrices[0]!, "psychological_boundary"),
        continuedMomentum: horizon(expectedForwardPrices[1]!, "measured_move"),
        strongExpansion: horizon(expectedForwardPrices[2]!, "volatility_projection"),
        extremeMomentum: horizon(expectedForwardPrices[3]!, "combined"),
        additionalObservedOutcomes: [],
      },
      pullbackPlans: {
        shallow: {
          zoneLow: shallowCandidate.zoneLow,
          zoneHigh: shallowCandidate.zoneHigh,
          confirmationPrice: shallowCandidate.zoneHigh,
          confirmation: "Require buyer defense and a reclaim of the observed candidate high.",
          invalidationPrice: Number((shallowCandidate.zoneLow - invalidationOffset).toFixed(4)),
          firstObjectivePrice: fixture.expected.mustClear,
          rationale: "The supplied tape provides this observed candidate-backed pullback branch.",
          evidenceIds: [shallowCandidate.id],
        },
        deep: null,
      },
      failureRecovery: null,
    },
    expectedForwardPrices,
  };
}

describe("TradersLink AI Read mandatory post-change five-symbol fixture audit", () => {
  it("validates five independent tactical maps with no web search or paid OpenAI request", async () => {
    assert.equal(fixturePack.version, 1);
    assert.equal(fixturePack.fixtures.length, 5);
    assert.equal(new Set(fixturePack.fixtures.map((fixture) => fixture.symbol)).size, 5);

    const directory = await mkdtemp(join(tmpdir(), "traderslink-ai-post-change-audit-"));
    const ledger = new TradersLinkAiReadCostLedger({ filePath: join(directory, "attempts.jsonl") });
    const requestBodies: Array<Record<string, unknown>> = [];
    try {
      for (const fixture of fixturePack.fixtures) {
        const completeWide = completeWideFixtureDraft(fixture);
        const service = new OpenAITradersLinkAiReadService({
          apiKey: "deterministic-fixture-key-not-sent",
          model: "deterministic-fixture-model",
          webSearchEnabled: false,
          pricing: { inputPer1M: 1, cachedInputPer1M: 0, outputPer1M: 2, webSearchPer1KCalls: 10 },
          fetchImpl: async (_url, init) => {
            requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            return new Response(JSON.stringify({
              id: `fixture_${fixture.id}`,
              output: [{
                type: "message",
                content: [{ type: "output_text", text: JSON.stringify(completeWide.draft) }],
              }],
              usage: { input_tokens: 600, output_tokens: 120, total_tokens: 720 },
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          },
        });

        const read = await service.generate({
          snapshot: snapshotFor(fixture),
          priceAction: priceActionFor(fixture),
          research: {
            ticker: fixture.symbol,
            businessDays: 5,
            count: fixture.research.length,
            articles: fixture.research.map((article) => ({ ticker: fixture.symbol, ...article })),
          },
          onAttempt: (attempt) => ledger.recordAttempt({ attempt, trigger: "manual" }),
        });

        assert.ok(read.currentPrice >= fixture.expected.currentPrice[0]);
        assert.ok(read.currentPrice <= fixture.expected.currentPrice[1]);
        assert.equal(read.dataAsOf, fixture.snapshot.timestamp);
        assert.equal(read.needsToHold.price, fixture.expected.needsToHold);
        assert.equal(read.cautionBelow.price, fixture.expected.cautionBelow);
        assert.equal(read.momentumFailure.price, fixture.expected.momentumFailure);
        assert.equal(read.mustClear.price, fixture.expected.mustClear);
        assert.equal(read.breakoutContinuation.price, fixture.expected.breakoutContinuation);
        assert.equal(read.version, 4);
        assert.deepEqual(read.targets.map((target) => target.price), completeWide.expectedForwardPrices);
        assert.equal(read.forwardPlan.extremeMomentum.available, true);
        assert.deepEqual(read.downsideCheckpoints.map((checkpoint) => checkpoint.price), fixture.expected.downsideCheckpoints);
        assert.equal(read.usedWebSearch, false);
        assert.equal(read.usage.webSearchCallCount, 0);
        assert.equal(read.externalResearchEnabled, false);
        if (fixture.expected.catalystStatus) {
          assert.equal(read.catalystRealityCheck.status, fixture.expected.catalystStatus);
        }
        if (fixture.expected.dilutionLevel) {
          assert.equal(read.dilutionRisk.level, fixture.expected.dilutionLevel, fixture.symbol);
        }
        for (const article of fixture.research) {
          assert.ok(read.sources.some((source) => source.url === article.sourceUrl));
        }
      }

      assert.equal(requestBodies.length, 5);
      assert.ok(requestBodies.every((body) => body.tools === undefined));
      const summary = ledger.summarize(Date.now());
      assert.equal(summary.windows.allTime.requestCount, 5);
      assert.equal(summary.windows.allTime.webSearchCallCount, 0);
      assert.equal(summary.windows.allTime.totalTokens, 3_600);
      assert.equal(summary.accountingHealth.healthy, true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
