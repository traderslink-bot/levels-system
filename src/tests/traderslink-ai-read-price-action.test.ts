import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import {
  buildTradersLinkAiPriceActionPacket,
  materiallySeparatedCandidates,
  type TradersLinkAiReadPullbackCandidate,
  resolveTradersLinkAiReadHistoricalCoverageRequirement,
} from "../lib/ai/traderslink-ai-read-price-action.js";

const START = Date.parse("2026-07-21T14:00:00.000Z");

it("ranks a supported lower base ahead of a closer shelf while retaining evidence diversity", () => {
  const candidate = (id: string, low: number, bars: number, retests: number): TradersLinkAiReadPullbackCandidate => ({
    id, kind: "one_minute_acceptance", zoneLow: low, zoneHigh: low + 0.02,
    observedFrom: START, observedTo: START + bars * 60_000, rationale: "Observed base",
    structure: { observedBarCount: bars, coveredMinutes: bars, meanCandleRange: 0.03,
      meanWickFraction: 0.5, reportedVolumeFraction: 1, subsequentRetests: retests },
  });
  const close = candidate("close", 3.90, 3, 0);
  const supported = candidate("supported", 3.60, 12, 2);
  const origin = { ...candidate("origin", 3.20, 5, 0), kind: "broader_move_origin" as const };
  const result = materiallySeparatedCandidates([close, supported, origin]);
  assert.equal(result[0]?.id, "supported");
  assert.ok(result.some((item) => item.id === "origin"));
  assert.ok(result.some((item) => item.id === "close"));
  assert.equal(close.zoneHigh, 3.92);
});

function bar(index: number, open: number, close: number, volume = 100): Candle {
  return {
    timestamp: START + index * 60_000,
    open,
    high: Math.max(open, close) * 1.002,
    low: Math.min(open, close) * 0.998,
    close,
    volume,
  };
}

function impulseCandles(duration: number): Candle[] {
  const candles: Candle[] = [];
  for (let index = 0; index < 10; index += 1) {
    candles.push(bar(index, 1, 1 + (index % 2) * 0.002));
  }
  for (let index = 0; index < duration; index += 1) {
    const start = 1 + 0.5 * index / duration;
    const end = 1 + 0.5 * (index + 1) / duration;
    candles.push(bar(10 + index, start, end, 600));
  }
  for (let index = 0; index < 8; index += 1) {
    candles.push(bar(10 + duration + index, 1.44 + (index % 2) * 0.01, 1.45, 350));
  }
  return candles;
}

function fiveMinuteCandles(oneMinuteCandles: Candle[]): Candle[] {
  const output: Candle[] = [];
  for (let index = 0; index < oneMinuteCandles.length; index += 5) {
    const bucket = oneMinuteCandles.slice(index, index + 5);
    output.push({
      timestamp: bucket[0]!.timestamp,
      open: bucket[0]!.open,
      high: Math.max(...bucket.map((candle) => candle.high)),
      low: Math.min(...bucket.map((candle) => candle.low)),
      close: bucket.at(-1)!.close,
      volume: bucket.reduce((sum, candle) => sum + candle.volume, 0),
    });
  }
  return output;
}

function evidence(oneMinuteCandles: Candle[], currentPrice = 1.5): Record<string, unknown> {
  const intradayCandles = fiveMinuteCandles(oneMinuteCandles);
  while (intradayCandles.length < 12) {
    const last = intradayCandles.at(-1)!;
    intradayCandles.push({ ...last, timestamp: last.timestamp + 5 * 60_000 });
  }
  const dataAsOf = intradayCandles.at(-1)!.timestamp;
  const packet = buildTradersLinkAiPriceActionPacket({
    source: "fixture",
    fetchedAt: dataAsOf,
    priorRegularClose: 0.9,
    oneMinuteCandles,
    intradayCandles,
    dailyCandles: [],
  }, currentPrice, dataAsOf);
  return packet.oneMinuteEvidence as Record<string, unknown>;
}

describe("TradersLink AI one-minute evidence", () => {
  it("reports whether the supplied daily history is long-range enough", () => {
    const oneMinuteCandles = impulseCandles(5);
    const intradayCandles = fiveMinuteCandles(oneMinuteCandles);
    while (intradayCandles.length < 12) {
      const last = intradayCandles.at(-1)!;
      intradayCandles.push({ ...last, timestamp: last.timestamp + 5 * 60_000 });
    }
    const dataAsOf = intradayCandles.at(-1)!.timestamp;
    const dailyCandles = Array.from({ length: 180 }, (_, index) => ({
      timestamp: dataAsOf - (179 - index) * 24 * 60 * 60_000,
      open: 1 + index * 0.001,
      high: 1.01 + index * 0.001,
      low: 0.99 + index * 0.001,
      close: 1 + index * 0.001,
      volume: 100_000,
    }));
    const packet = buildTradersLinkAiPriceActionPacket({
      source: "fixture",
      fetchedAt: dataAsOf,
      priorRegularClose: 0.9,
      oneMinuteCandles,
      intradayCandles,
      dailyCandles,
    }, 1.18, dataAsOf) as { historicalCoverage: Record<string, unknown>; recentDailyBars: unknown[] };

    assert.equal(packet.recentDailyBars.length, 180);
    assert.equal(packet.historicalCoverage.dailyCandleCount, 180);
    assert.equal(packet.historicalCoverage.requestedDailyBars, 180);
    assert.equal(packet.historicalCoverage.longRangeDailyContext, true);
  });

  it("distinguishes a fast vertical extension from a slower gain of the same size", () => {
    const fast = evidence(impulseCandles(5)).latestSignificantImpulse as Record<string, number>;
    const slow = evidence(impulseCandles(25)).latestSignificantImpulse as Record<string, number>;

    assert.ok(fast.gainPct >= 49);
    assert.ok(slow.gainPct >= 49);
    assert.ok(fast.durationMinutes < slow.durationMinutes);
    assert.ok(fast.gainPerMinutePct > slow.gainPerMinutePct * 2);
  });

  it("expands daily coverage when the private level evidence reaches farther back", () => {
    const evidenceAt = Date.parse("2025-06-08T16:00:00.000Z");
    const requirement = resolveTradersLinkAiReadHistoricalCoverageRequirement({
      majorSupport: [],
      majorResistance: [{
        firstTimestamp: evidenceAt,
        marketDataProvenance: { formedAt: evidenceAt, sourceLastSeenAt: START },
      }],
      intermediateSupport: [],
      intermediateResistance: [],
      intradaySupport: [],
      intradayResistance: [],
      extensionLevels: { support: [], resistance: [] },
    } as never, START);

    assert.equal(requirement.source, "level_evidence");
    assert.ok(requirement.requestedDailyBars > 180);
    assert.equal(
      requirement.requiredEarliestDailyCandleAt,
      evidenceAt - 30 * 24 * 60 * 60 * 1_000,
    );
  });

  it("builds materially separate shallow consolidation and deep pre-impulse candidates", () => {
    const facts = evidence(impulseCandles(5));
    const candidates = facts.pullbackCandidates as Array<Record<string, number | string>>;
    const shallow = candidates.find((candidate) => candidate.id === "1m-first-consolidation");
    const deep = candidates.find((candidate) => candidate.id === "1m-pre-impulse-base");

    assert.ok(shallow);
    assert.ok(deep);
    assert.ok(Number(deep.zoneHigh) < Number(shallow.zoneLow));
    const measured = facts.pullbackCandidates as TradersLinkAiReadPullbackCandidate[];
    for (const candidate of measured) {
      assert.ok(candidate.structure!.observedBarCount > 0);
      assert.ok(candidate.structure!.meanCandleRange > 0);
      assert.ok(candidate.structure!.meanWickFraction >= 0 && candidate.structure!.meanWickFraction <= 1);
      assert.ok(candidate.distanceBelowReferencePct! > 0);
      assert.ok(candidate.zoneWidthPct! >= 0);
      assert.ok(candidate.distanceInMeanCandleRanges! > 0);
      assert.ok(candidate.distanceInRecentMeanCandleRanges! > 0);
      assert.ok(candidate.observedFrom <= candidate.observedTo);
      assert.ok(candidate.timeframe === "1m" || candidate.timeframe === "5m");
    }
    const range = facts.recentTapeRange as { timeframe: string; barCount: number; observedFrom: number; observedTo: number; meanHighLowRange: number };
    const recent = impulseCandles(5).slice(-60);
    const meanRange = recent.reduce((sum, candle) => sum + candle.high - candle.low, 0) / recent.length;
    assert.equal(range.timeframe, "1m");
    assert.equal(range.barCount, recent.length);
    assert.equal(range.observedFrom, recent[0]!.timestamp);
    assert.equal(range.observedTo, recent.at(-1)!.timestamp);
    assert.ok(Math.abs(range.meanHighLowRange - meanRange) < 0.0000001);
  });

  it("does not offer a pullback candidate inside the reference-price validation buffer", () => {
    const currentPrice = 1.455;
    const facts = evidence(impulseCandles(5), currentPrice);
    const candidates = facts.pullbackCandidates as Array<Record<string, number | string>>;
    const minimumReferenceSeparation = Math.max(currentPrice * 0.005, 0.0001);

    assert.ok(candidates.length > 0);
    assert.ok(candidates.every(
      (candidate) => Number(candidate.zoneHigh) < currentPrice - minimumReferenceSeparation,
    ));
    assert.equal(
      candidates.some((candidate) => candidate.id === "1m-first-consolidation"),
      false,
    );
  });

  it("turns repeated overlapping one-minute bodies into an observed acceptance candidate", () => {
    const candles = impulseCandles(5);
    const acceptanceStartIndex = candles.length;
    candles.push(
      bar(acceptanceStartIndex, 1.31, 1.34, 0),
      bar(acceptanceStartIndex + 1, 1.32, 1.33, 0),
      bar(acceptanceStartIndex + 2, 1.325, 1.345, 0),
    );
    const facts = evidence(candles);
    const candidates = facts.pullbackCandidates as Array<Record<string, number | string>>;
    const candidate = candidates.find(
      (item) => item.id === `1m-acceptance-${START + acceptanceStartIndex * 60_000}`,
    );

    assert.ok(candidate);
    assert.equal(candidate.kind, "one_minute_acceptance");
    assert.equal(candidate.zoneLow, 1.31);
    assert.equal(candidate.zoneHigh, 1.345);
  });

  it("retains the broader move origin separately from a nested fast impulse", () => {
    const candles: Candle[] = [];
    for (let index = 0; index < 10; index += 1) {
      candles.push(bar(index, 7, 7.04 + (index % 2) * 0.03, 200));
    }
    for (let index = 0; index < 30; index += 1) {
      const open = 7.05 + index * 0.04;
      candles.push(bar(10 + index, open, open + 0.04, 300));
    }
    candles.push(
      bar(40, 8.25, 9.1, 1_000),
      bar(41, 9.1, 10, 1_200),
      bar(42, 9.2, 8.8, 700),
      bar(43, 8.75, 8.82, 500),
    );
    const facts = evidence(candles, 8.82);
    const latestImpulse = facts.latestSignificantImpulse as Record<string, number>;
    const broaderMove = facts.broaderSessionMove as Record<string, number | string>;
    const candidates = facts.pullbackCandidates as Array<Record<string, number | string>>;
    const origin = candidates.find((candidate) => candidate.id === "1m-broader-move-origin");

    assert.ok(latestImpulse.originPrice >= 8);
    assert.ok(Number(broaderMove.originPrice) <= 7.05);
    assert.ok(origin);
    assert.ok(Number(origin.zoneLow) >= 6.9);
    assert.ok(Number(origin.zoneHigh) <= 7.25);
  });

  it("does not manufacture volume strength from zero-volume or malformed bars", () => {
    const candles = impulseCandles(5).map((candle) => ({ ...candle, volume: 0 }));
    candles.push({ ...candles.at(-1)!, timestamp: Number.NaN, high: 0.5 });
    const facts = evidence(candles);
    const impulse = facts.latestSignificantImpulse as Record<string, unknown>;

    assert.equal(impulse.volumeVsPrecedingBaseline, null);
    assert.equal(facts.available, true);
  });

  it("reports confirmation behavior instead of treating a deep-area touch as confirmation", () => {
    const candles = impulseCandles(5);
    const lastIndex = candles.length;
    candles.push(
      bar(lastIndex, 1.2, 1.08, 300),
      bar(lastIndex + 1, 1.08, 1.02, 300),
      bar(lastIndex + 2, 1.03, 1.01, 300),
    );
    const facts = evidence(candles);
    const confirmation = facts.latestConfirmationBehavior as Record<string, unknown>;

    assert.equal(confirmation.higherLowObserved, false);
    assert.equal(confirmation.reclaimObserved, false);
  });
});
