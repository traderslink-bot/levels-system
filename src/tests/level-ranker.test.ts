import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rankLevelZones } from "../lib/levels/level-ranker.js";
import { DEFAULT_LEVEL_ENGINE_CONFIG } from "../lib/levels/level-config.js";
import type { FinalLevelZone } from "../lib/levels/level-types.js";

function makeZone(params: Partial<FinalLevelZone>): FinalLevelZone {
  return {
    id: params.id ?? "z1",
    symbol: "TEST",
    kind: "resistance",
    timeframeBias: params.timeframeBias ?? "mixed",
    zoneLow: 10,
    zoneHigh: 11,
    representativePrice: 10.5,
    strengthScore: params.strengthScore ?? 50,
    strengthLabel: "strong",
    touchCount: 3,
    confluenceCount: 2,
    sourceTypes: ["swing_high"],
    timeframeSources: params.timeframeSources ?? ["daily", "4h", "5m"],
    reactionQualityScore: 0.7,
    rejectionScore: 0.5,
    displacementScore: 0.65,
    sessionSignificanceScore: 0.15,
    followThroughScore: 0.6,
    sourceEvidenceCount: 2,
    sessionDate: undefined,
    isExtension: false,
    freshness: "fresh",
    firstTimestamp: 1,
    lastTimestamp: 2,
    notes: [],
    ...params,
  };
}

const testMetadata = {
  providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
  dataQualityFlags: [],
  freshness: "fresh" as const,
};

describe("level-ranker bucket ownership", () => {
  it("assigns mixed multi-timeframe zone to a single highest-priority bucket", () => {
    const zone = makeZone({ timeframeSources: ["daily", "4h", "5m"] });

    const result = rankLevelZones({
      symbol: "TEST",
      supportZones: [],
      resistanceZones: [zone],
      specialLevels: {},
      metadata: testMetadata,
      config: DEFAULT_LEVEL_ENGINE_CONFIG,
    });

    assert.equal(result.majorResistance.length, 1);
    assert.equal(result.intermediateResistance.length, 0);
    assert.equal(result.intradayResistance.length, 0);
  });

  it("assigns 4h+5m mixed zone to intermediate only", () => {
    const zone = makeZone({ timeframeSources: ["4h", "5m"] });

    const result = rankLevelZones({
      symbol: "TEST",
      supportZones: [],
      resistanceZones: [zone],
      specialLevels: {},
      metadata: testMetadata,
      config: DEFAULT_LEVEL_ENGINE_CONFIG,
    });

    assert.equal(result.majorResistance.length, 0);
    assert.equal(result.intermediateResistance.length, 1);
    assert.equal(result.intradayResistance.length, 0);
  });

  it("keeps pure 5m zone in intraday bucket", () => {
    const zone = makeZone({ timeframeSources: ["5m"], timeframeBias: "5m" });

    const result = rankLevelZones({
      symbol: "TEST",
      supportZones: [],
      resistanceZones: [zone],
      specialLevels: {},
      metadata: testMetadata,
      config: DEFAULT_LEVEL_ENGINE_CONFIG,
    });

    assert.equal(result.majorResistance.length, 0);
    assert.equal(result.intermediateResistance.length, 0);
    assert.equal(result.intradayResistance.length, 1);
  });

  it("does not surface resistance beyond the practical forward planning range when reference price is available", () => {
    const nearZone = makeZone({
      id: "near",
      representativePrice: 11.5,
      timeframeSources: ["4h"],
      timeframeBias: "4h",
      strengthScore: 24,
    });
    const tooFarZone = makeZone({
      id: "too-far",
      representativePrice: 16.5,
      timeframeSources: ["daily"],
      timeframeBias: "daily",
      strengthScore: 28,
    });

    const result = rankLevelZones({
      symbol: "TEST",
      supportZones: [],
      resistanceZones: [nearZone, tooFarZone],
      specialLevels: {},
      metadata: {
        ...testMetadata,
        referencePrice: 10.5,
      },
      config: DEFAULT_LEVEL_ENGINE_CONFIG,
    });

    const surfacedIds = [
      ...result.majorResistance.map((zone) => zone.id),
      ...result.intermediateResistance.map((zone) => zone.id),
      ...result.intradayResistance.map((zone) => zone.id),
    ];

    assert.ok(surfacedIds.includes("near"));
    assert.ok(!surfacedIds.includes("too-far"));
  });
});
