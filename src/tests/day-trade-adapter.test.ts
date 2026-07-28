import assert from "node:assert/strict";
import test from "node:test";

import { buildDayTradeAdapterResult } from "../lib/day-trade-adapter/day-trade-adapter-engine.js";
import { CoordinatedCandleFetchService } from "../lib/market-data/coordinated-candle-fetch-service.js";
import type { Candle, CandleProviderResponse } from "../lib/market-data/candle-types.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";

const AS_OF = Date.UTC(2026, 6, 28, 16, 0, 0);

function zone(id: string, kind: "support" | "resistance", price: number, strengthScore = 75): FinalLevelZone {
  return {
    id,
    symbol: "TEST",
    kind,
    timeframeBias: "mixed",
    zoneLow: price - 0.02,
    zoneHigh: price + 0.02,
    representativePrice: price,
    strengthScore,
    strengthLabel: strengthScore >= 85 ? "major" : strengthScore >= 70 ? "strong" : "moderate",
    touchCount: 3,
    confluenceCount: 2,
    sourceTypes: kind === "support" ? ["swing_low"] : ["swing_high"],
    timeframeSources: ["daily", "5m"],
    reactionQualityScore: 0.8,
    rejectionScore: 0.8,
    displacementScore: 0.7,
    sessionSignificanceScore: 0.6,
    followThroughScore: 0.7,
    sourceEvidenceCount: 2,
    firstTimestamp: AS_OF - 86_400_000,
    lastTimestamp: AS_OF - 3_600_000,
    isExtension: false,
    freshness: "fresh",
    notes: [],
  };
}

function levels(): LevelEngineOutput {
  const support = [zone("s1", "support", 4.8), zone("s2", "support", 4.55)];
  const resistance = [
    zone("r1", "resistance", 5.15),
    zone("r2", "resistance", 5.19),
    zone("r3", "resistance", 5.45),
    zone("r4", "resistance", 6.2, 90),
  ];
  return {
    symbol: "TEST",
    generatedAt: AS_OF,
    metadata: {
      providerByTimeframe: { daily: "eodhd", "4h": "eodhd", "5m": "yahoo" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 5,
    },
    majorSupport: [support[0]],
    majorResistance: [resistance[0]],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [],
    intradayResistance: [],
    extensionLevels: { support: [], resistance: [] },
    fullLadderLevels: { support, resistance },
    specialLevels: {},
  };
}

function candles(intervalMs: number): Candle[] {
  return Array.from({ length: 12 }, (_, index) => {
    const close = 4.5 + index * 0.045;
    return {
      timestamp: AS_OF - (12 - index) * intervalMs,
      open: close - 0.02,
      high: close + 0.04,
      low: close - 0.04,
      close,
      volume: 100_000 + index * 10_000,
    };
  });
}

function response(timeframe: "1m" | "5m", stale = false): CandleProviderResponse {
  const interval = timeframe === "1m" ? 60_000 : 300_000;
  const series = candles(interval);
  return {
    provider: "yahoo",
    symbol: "TEST",
    timeframe,
    requestedLookbackBars: series.length,
    candles: series,
    fetchStartTimestamp: AS_OF,
    fetchEndTimestamp: AS_OF,
    requestedStartTimestamp: series[0].timestamp,
    requestedEndTimestamp: AS_OF,
    sessionMetadataAvailable: true,
    actualBarsReturned: series.length,
    completenessStatus: "complete",
    stale,
    validationIssues: [],
    sessionSummary: null,
  };
}

test("adapter clusters dense ladder evidence instead of selecting every next level", () => {
  const result = buildDayTradeAdapterResult({
    market: {
      symbol: "TEST",
      timestamp: AS_OF,
      currentPrice: 5,
      livePriceUpdatedAt: AS_OF - 250,
      levels: levels(),
      technicalContext: {
        source: "levels_system_intraday",
        sourceTimeframe: "5m",
        provider: "yahoo",
        sessionDate: "2026-07-28",
        updatedAt: AS_OF,
        candleCount: 12,
        currentPrice: 5,
        vwap: 4.9,
        ema9: 4.95,
        ema20: 4.8,
        priceVsVwapPct: 2.04,
        priceVsEma9Pct: 1.01,
        priceVsEma20Pct: 4.17,
        aboveVwap: true,
        aboveEma9: true,
        aboveEma20: true,
        confidence: "high",
        diagnostics: [],
      },
      atr: {
        value: 0.2,
        pct: 4,
        period: 14,
        timeframe: "5m",
        completedCandleCount: 20,
        reliability: "reliable",
        reason: null,
      },
    },
    oneMinute: response("1m"),
    fiveMinute: response("5m"),
  });

  assert.equal(result.diagnostics.levelInventory.received, 8);
  assert.equal(result.diagnostics.levelInventory.deduplicated, 6);
  assert.ok(result.diagnostics.levelInventory.clusters < result.diagnostics.levelInventory.deduplicated);
  assert.deepEqual(result.plan.mustClear?.levelIds.sort(), ["r1", "r2"]);
  assert.equal(result.plan.continuation?.price, 5.45);
  assert.equal(result.plan.expansionTargets[0]?.price, 6.2);
});

test("missing ATR lowers confidence but retains a level plan", () => {
  const result = buildDayTradeAdapterResult({
    market: {
      symbol: "TEST",
      timestamp: AS_OF,
      currentPrice: 5,
      livePriceUpdatedAt: AS_OF,
      levels: levels(),
      technicalContext: null,
      atr: {
        value: null,
        pct: null,
        period: 14,
        timeframe: "5m",
        completedCandleCount: 3,
        reliability: "insufficient_completed_candles",
        reason: "Need 15 completed candles.",
      },
    },
    oneMinute: response("1m", true),
    fiveMinute: response("5m"),
  });

  assert.ok(result.plan.needsToHold);
  assert.ok(result.plan.mustClear);
  assert.equal(result.confidence, "low");
  assert.ok(result.diagnostics.flags.some((flag) => flag.startsWith("atr_unreliable:")));
});

test("coordinator deduplicates concurrent requests and serves a cache hit", async () => {
  let calls = 0;
  const underlying = {
    getProviderName: () => "yahoo" as const,
    fetchCandles: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return response("1m");
    },
  };
  const coordinator = new CoordinatedCandleFetchService(underlying, {
    cacheTtlMs: 60_000,
    minimumRequestSpacingMs: 0,
  });
  const request = {
    symbol: "TEST",
    timeframe: "1m" as const,
    lookbackBars: 600,
    preferredProvider: "yahoo" as const,
  };
  const [first, second] = await Promise.all([
    coordinator.fetchCandles(request),
    coordinator.fetchCandles(request),
  ]);
  const third = await coordinator.fetchCandles(request);

  assert.equal(first.symbol, "TEST");
  assert.equal(second.symbol, "TEST");
  assert.equal(third.symbol, "TEST");
  assert.equal(calls, 1);
  assert.equal(coordinator.getDiagnostics().inFlightDeduplicationCount, 1);
  assert.equal(coordinator.getDiagnostics().cacheHitCount, 1);
});

