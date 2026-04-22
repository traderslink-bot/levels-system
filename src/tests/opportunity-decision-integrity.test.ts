import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OpportunityEngine } from "../lib/monitoring/opportunity-engine.js";
import type { MonitoringEvent } from "../lib/monitoring/monitoring-types.js";

type TestMonitoringEvent = MonitoringEvent & {
  structureType?: string | null;
  structureStrength?: number;
};

function makeEvent(params: {
  id: string;
  symbol: string;
  type?: MonitoringEvent["type"];
  eventType?: MonitoringEvent["eventType"];
  timestamp: number;
  strength: number;
  confidence: number;
  priority: number;
  bias?: MonitoringEvent["bias"];
  pressureScore?: number;
  level?: number;
  structureType?: string | null;
  structureStrength?: number;
}): TestMonitoringEvent {
  const eventType = params.eventType ?? "breakout";
  return {
    id: params.id,
    episodeId: `${params.id}-episode`,
    symbol: params.symbol,
    type: params.type ?? (eventType === "compression" ? "consolidation" : eventType),
    eventType,
    zoneId: `${params.symbol}-zone`,
    zoneKind: "resistance",
    level: params.level ?? 100,
    triggerPrice: params.level ?? 100,
    strength: params.strength,
    confidence: params.confidence,
    priority: params.priority,
    bias: params.bias ?? "bullish",
    pressureScore: params.pressureScore ?? 0.5,
    eventContext: {
      monitoredZoneId: `${params.symbol}-zone`,
      canonicalZoneId: `${params.symbol}-zone`,
      zoneFreshness: "fresh",
      zoneOrigin: "canonical",
      remapStatus: "new",
      remappedFromZoneIds: [],
      dataQualityDegraded: false,
      recentlyRefreshed: false,
      recentlyPromotedExtension: false,
      ladderPosition: "inner",
      zoneStrengthLabel: "strong",
    },
    timestamp: params.timestamp,
    notes: ["Opportunity engine integrity test event."],
    structureType: params.structureType ?? null,
    structureStrength: params.structureStrength ?? 0,
  };
}

describe("opportunity decision integrity", () => {
  it("ranks the highest-quality signal first and pushes weaker signals below it", () => {
    const engine = new OpportunityEngine();
    const now = 1_000_000;
    const ranked = engine.rank([
      makeEvent({
        id: "weak",
        symbol: "MSFT",
        timestamp: now - 30_000,
        strength: 0.48,
        confidence: 0.42,
        priority: 48,
        pressureScore: 0.3,
      }),
      makeEvent({
        id: "best",
        symbol: "AAPL",
        timestamp: now,
        strength: 0.95,
        confidence: 0.93,
        priority: 92,
        pressureScore: 0.88,
        structureType: "breakout_setup",
        structureStrength: 0.92,
      }),
      makeEvent({
        id: "mid",
        symbol: "NVDA",
        timestamp: now - 10_000,
        strength: 0.68,
        confidence: 0.63,
        priority: 70,
        pressureScore: 0.55,
      }),
    ]);

    assert.equal(ranked[0]?.symbol, "AAPL");
    assert.ok(ranked[0]!.score > ranked.at(-1)!.score);
  });

  it("filters out signals below the minimum score threshold", () => {
    const engine = new OpportunityEngine();
    const now = 2_000_000;
    const ranked = engine.rank([
      makeEvent({
        id: "filtered",
        symbol: "NOISE",
        timestamp: now,
        strength: 0.12,
        confidence: 0.18,
        priority: 12,
        pressureScore: 0.05,
        eventType: "compression",
        type: "consolidation",
        bias: "neutral",
      }),
      makeEvent({
        id: "kept",
        symbol: "AAPL",
        timestamp: now - 5_000,
        strength: 0.75,
        confidence: 0.72,
        priority: 78,
        pressureScore: 0.6,
      }),
    ]);

    assert.equal(ranked.some((opportunity) => opportunity.symbol === "NOISE"), false);
    assert.equal(ranked.some((opportunity) => opportunity.symbol === "AAPL"), true);
  });

  it("enforces diversification by selecting at most two opportunities per symbol", () => {
    const engine = new OpportunityEngine();
    const now = 3_000_000;
    const ranked = engine.rank([
      makeEvent({
        id: "a1",
        symbol: "AAPL",
        timestamp: now,
        strength: 0.95,
        confidence: 0.9,
        priority: 92,
        pressureScore: 0.85,
      }),
      makeEvent({
        id: "a2",
        symbol: "AAPL",
        timestamp: now - 5_000,
        strength: 0.9,
        confidence: 0.86,
        priority: 89,
        pressureScore: 0.82,
      }),
      makeEvent({
        id: "a3",
        symbol: "AAPL",
        timestamp: now - 10_000,
        strength: 0.88,
        confidence: 0.84,
        priority: 87,
        pressureScore: 0.8,
      }),
      makeEvent({
        id: "m1",
        symbol: "MSFT",
        timestamp: now - 2_000,
        strength: 0.8,
        confidence: 0.76,
        priority: 79,
        pressureScore: 0.66,
      }),
    ]);

    const selected = engine.selectTop(ranked, 4);
    const aaplCount = selected.filter((opportunity) => opportunity.symbol === "AAPL").length;

    assert.equal(aaplCount, 2);
    assert.ok(selected.some((opportunity) => opportunity.symbol === "MSFT"));
  });

  it("normalizes scores into a 0-1 band with the best opportunity near 1", () => {
    const engine = new OpportunityEngine();
    const now = 4_000_000;
    const ranked = engine.rank([
      makeEvent({
        id: "top",
        symbol: "AAPL",
        timestamp: now,
        strength: 0.96,
        confidence: 0.94,
        priority: 94,
        pressureScore: 0.9,
        structureType: "breakout_setup",
        structureStrength: 0.95,
      }),
      makeEvent({
        id: "other",
        symbol: "MSFT",
        timestamp: now - 10_000,
        strength: 0.66,
        confidence: 0.62,
        priority: 68,
        pressureScore: 0.52,
      }),
    ]);

    assert.ok(ranked.every((opportunity) => opportunity.normalizedScore >= 0 && opportunity.normalizedScore <= 1));
    assert.ok(ranked[0]!.normalizedScore >= 0.99);
  });

  it("assigns high, medium, and low classifications appropriately", () => {
    const engine = new OpportunityEngine();
    const now = 5_000_000;
    const ranked = engine.rank([
      makeEvent({
        id: "high",
        symbol: "AAPL",
        timestamp: now,
        strength: 0.97,
        confidence: 0.95,
        priority: 96,
        pressureScore: 0.92,
        structureType: "breakout_setup",
        structureStrength: 0.95,
      }),
      makeEvent({
        id: "medium",
        symbol: "MSFT",
        timestamp: now - 10_000,
        strength: 0.67,
        confidence: 0.58,
        priority: 70,
        pressureScore: 0.55,
      }),
      makeEvent({
        id: "low",
        symbol: "AMD",
        timestamp: now - 15_000,
        strength: 0.68,
        confidence: 0.44,
        priority: 68,
        pressureScore: 0.42,
        eventType: "compression",
        type: "consolidation",
        bias: "neutral",
      }),
    ]);

    const bySymbol = new Map(ranked.map((opportunity) => [opportunity.symbol, opportunity]));

    assert.equal(bySymbol.get("AAPL")?.classification, "high_conviction");
    assert.equal(bySymbol.get("MSFT")?.classification, "medium");
    assert.equal(bySymbol.get("AMD")?.classification, "low");
  });

  it("ranks newer identical signals above older ones because of time decay", () => {
    const engine = new OpportunityEngine();
    const now = 6_000_000;
    const ranked = engine.rank([
      makeEvent({
        id: "older",
        symbol: "AAPL",
        timestamp: now - 10 * 60 * 1000,
        strength: 0.82,
        confidence: 0.8,
        priority: 80,
        pressureScore: 0.7,
      }),
      makeEvent({
        id: "newer",
        symbol: "MSFT",
        timestamp: now,
        strength: 0.82,
        confidence: 0.8,
        priority: 80,
        pressureScore: 0.7,
      }),
    ]);

    assert.equal(ranked[0]?.symbol, "MSFT");
  });

  it("applies bounded stacking boosts for clustered same-symbol signals", () => {
    const engine = new OpportunityEngine();
    const now = 7_000_000;
    const single = engine.rank([
      makeEvent({
        id: "solo",
        symbol: "AAPL",
        timestamp: now,
        strength: 0.76,
        confidence: 0.74,
        priority: 76,
        pressureScore: 0.6,
      }),
    ]);
    const stacked = engine.rank([
      makeEvent({
        id: "stack-1",
        symbol: "AAPL",
        timestamp: now,
        strength: 0.76,
        confidence: 0.74,
        priority: 76,
        pressureScore: 0.6,
      }),
      makeEvent({
        id: "stack-2",
        symbol: "AAPL",
        timestamp: now - 20_000,
        strength: 0.72,
        confidence: 0.7,
        priority: 72,
        pressureScore: 0.55,
      }),
      makeEvent({
        id: "stack-3",
        symbol: "AAPL",
        timestamp: now - 40_000,
        strength: 0.69,
        confidence: 0.67,
        priority: 70,
        pressureScore: 0.52,
      }),
    ]);

    assert.ok(stacked[0]!.score > single[0]!.score);
    assert.ok(stacked[0]!.score < single[0]!.score * 1.3);
  });

  it("reduces score when structure and bias conflict", () => {
    const engine = new OpportunityEngine();
    const now = 8_000_000;
    const aligned = engine.rank([
      makeEvent({
        id: "aligned",
        symbol: "AAPL",
        timestamp: now,
        strength: 0.8,
        confidence: 0.78,
        priority: 82,
        pressureScore: 0.7,
        bias: "bullish",
        structureType: "breakout_setup",
        structureStrength: 0.9,
      }),
    ]);
    const conflicted = engine.rank([
      makeEvent({
        id: "conflicted",
        symbol: "AAPL",
        timestamp: now,
        strength: 0.8,
        confidence: 0.78,
        priority: 82,
        pressureScore: 0.7,
        bias: "bearish",
        structureType: "breakout_setup",
        structureStrength: 0.9,
      }),
    ]);

    assert.ok(aligned[0]!.score > conflicted[0]!.score);
  });

  it("returns identical rankings across repeated runs with the same inputs", () => {
    const engine = new OpportunityEngine();
    const now = 9_000_000;
    const events = [
      makeEvent({
        id: "r1",
        symbol: "AAPL",
        timestamp: now,
        strength: 0.91,
        confidence: 0.88,
        priority: 90,
        pressureScore: 0.82,
      }),
      makeEvent({
        id: "r2",
        symbol: "MSFT",
        timestamp: now - 15_000,
        strength: 0.7,
        confidence: 0.68,
        priority: 72,
        pressureScore: 0.55,
      }),
      makeEvent({
        id: "r3",
        symbol: "AMD",
        timestamp: now - 30_000,
        strength: 0.49,
        confidence: 0.45,
        priority: 50,
        pressureScore: 0.32,
      }),
    ];

    const first = engine.rank(events);
    const second = engine.rank(events);

    assert.deepEqual(first, second);
  });

  it("keeps strong signals above a batch of weak noisy ones", () => {
    const engine = new OpportunityEngine();
    const now = 10_000_000;
    const weakNoise = Array.from({ length: 12 }, (_, index) =>
      makeEvent({
        id: `noise-${index}`,
        symbol: `NOISE${index}`,
        timestamp: now - index * 1_000,
        strength: 0.16 + index * 0.005,
        confidence: 0.18 + index * 0.004,
        priority: 18 + index,
        pressureScore: 0.08,
        eventType: "compression",
        type: "consolidation",
        bias: "neutral",
      }),
    );
    const strong = makeEvent({
      id: "strong",
      symbol: "AAPL",
      timestamp: now,
      strength: 0.9,
      confidence: 0.87,
      priority: 91,
      pressureScore: 0.84,
      structureType: "breakout_setup",
      structureStrength: 0.9,
    });

    const ranked = engine.rank([strong, ...weakNoise]);

    assert.equal(ranked[0]?.symbol, "AAPL");
    assert.equal(ranked.some((opportunity) => opportunity.symbol.startsWith("NOISE")), false);
  });

  it("lets an extreme signal dominate the ranking and normalize near 1", () => {
    const engine = new OpportunityEngine();
    const now = 11_000_000;
    const ranked = engine.rank([
      makeEvent({
        id: "extreme",
        symbol: "AAPL",
        timestamp: now,
        strength: 0.99,
        confidence: 0.98,
        priority: 99,
        pressureScore: 0.95,
        structureType: "breakout_setup",
        structureStrength: 1,
      }),
      makeEvent({
        id: "ordinary",
        symbol: "MSFT",
        timestamp: now - 10_000,
        strength: 0.62,
        confidence: 0.58,
        priority: 64,
        pressureScore: 0.45,
      }),
    ]);

    assert.equal(ranked[0]?.symbol, "AAPL");
    assert.ok(ranked[0]!.normalizedScore >= 0.99);
  });

  it("breaks ties by confidence and then recency when normalized scores match", () => {
    const engine = new OpportunityEngine();
    const now = 12_000_000;
    const ranked = engine.rank([
      makeEvent({
        id: "tie-low-confidence",
        symbol: "AAPL",
        timestamp: now - 10_000,
        strength: 0.8,
        confidence: 0.72,
        priority: 80,
        pressureScore: 0.6,
      }),
      makeEvent({
        id: "tie-high-confidence",
        symbol: "MSFT",
        timestamp: now - 20_000,
        strength: 0.8,
        confidence: 0.78,
        priority: 80,
        pressureScore: 0.6,
      }),
      makeEvent({
        id: "tie-same-confidence-newer",
        symbol: "NVDA",
        timestamp: now,
        strength: 0.8,
        confidence: 0.78,
        priority: 80,
        pressureScore: 0.6,
      }),
    ]);

    const tieCandidates = ranked.filter((opportunity) => opportunity.score === ranked[0]!.score);

    assert.equal(ranked[0]!.symbol, "NVDA");
    assert.ok(ranked.findIndex((opportunity) => opportunity.symbol === "MSFT") <
      ranked.findIndex((opportunity) => opportunity.symbol === "AAPL"));
    assert.ok(tieCandidates.length >= 1);
  });

  it("penalizes otherwise similar bullish setups when upside clearance is tight", () => {
    const engine = new OpportunityEngine();
    const now = 11_000_000;
    const ranked = engine.rank([
      {
        ...makeEvent({
          id: "tight-room",
          symbol: "ALBT",
          timestamp: now,
          strength: 0.82,
          confidence: 0.78,
          priority: 82,
          pressureScore: 0.64,
          eventType: "level_touch",
          type: "level_touch",
          bias: "bullish",
        }),
        eventContext: {
          monitoredZoneId: "ALBT-zone",
          canonicalZoneId: "ALBT-zone",
          zoneFreshness: "fresh",
          zoneOrigin: "canonical",
          remapStatus: "new",
          remappedFromZoneIds: [],
          dataQualityDegraded: false,
          recentlyRefreshed: false,
          recentlyPromotedExtension: false,
          ladderPosition: "outermost",
          zoneStrengthLabel: "strong",
          nextBarrierKind: "resistance",
          nextBarrierLevel: 10.12,
          nextBarrierDistancePct: 0.012,
          clearanceLabel: "tight",
        },
      },
      {
        ...makeEvent({
          id: "open-room",
          symbol: "BIRD",
          timestamp: now,
          strength: 0.82,
          confidence: 0.78,
          priority: 82,
          pressureScore: 0.64,
          eventType: "level_touch",
          type: "level_touch",
          bias: "bullish",
        }),
        eventContext: {
          monitoredZoneId: "BIRD-zone",
          canonicalZoneId: "BIRD-zone",
          zoneFreshness: "fresh",
          zoneOrigin: "canonical",
          remapStatus: "new",
          remappedFromZoneIds: [],
          dataQualityDegraded: false,
          recentlyRefreshed: false,
          recentlyPromotedExtension: false,
          ladderPosition: "outermost",
          zoneStrengthLabel: "strong",
          nextBarrierKind: "resistance",
          nextBarrierLevel: 10.7,
          nextBarrierDistancePct: 0.07,
          clearanceLabel: "open",
        },
      },
    ]);

    const bySymbol = new Map(ranked.map((opportunity) => [opportunity.symbol, opportunity]));

    assert.ok(bySymbol.get("BIRD")!.score > bySymbol.get("ALBT")!.score);
    assert.equal(bySymbol.get("ALBT")?.clearanceLabel, "tight");
    assert.equal(bySymbol.get("BIRD")?.clearanceLabel, "open");
  });
});
