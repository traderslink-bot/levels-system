import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { EnrichedLevelAnalysis, FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import {
  buildExecutionLevelSnapshot,
  buildExecutionMarketContextSnapshot,
  findNearestResistanceLevel,
  findNearestSupportLevel,
} from "../lib/journal-context/index.js";
import {
  buildMarketContextFactsBundle,
  type MarketContextProfile,
} from "../lib/market-context/index.js";
import { buildSessionMarketFacts } from "../lib/session/index.js";
import {
  buildVolumeMarketFacts,
  type VolumeShelf,
} from "../lib/volume/index.js";

function candle(
  timestamp: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): Candle {
  return {
    timestamp: Date.parse(timestamp),
    open,
    high,
    low,
    close,
    volume,
  };
}

function enrichedAnalysis(): EnrichedLevelAnalysis {
  return {
    source: "rankLevels",
    structuralStrengthScore: 0.7,
    activeRelevanceScore: 0.6,
    finalLevelScore: 0.65,
    confidence: 0.8,
    state: "fresh",
    rank: 1,
    explanation: "Supplied enriched metadata from the level output.",
    scoreBreakdown: {
      timeframeScore: 0.7,
      touchScore: 0.6,
      reactionQualityScore: 0.6,
      reactionMagnitudeScore: 0.6,
      volumeScore: 0.5,
      cleanlinessScore: 0.5,
      roleFlipScore: 0,
      defenseScore: 0.5,
      recencyScore: 0.8,
      overtestPenalty: 0,
      clusterPenalty: 0,
      structuralStrengthScore: 0.7,
      distanceToPriceScore: 0.5,
      freshReactionScore: 0.7,
      intradayPressureScore: 0.4,
      recentVolumeActivityScore: 0.5,
      currentInteractionScore: 0.4,
      activeRelevanceScore: 0.6,
      finalLevelScore: 0.65,
    },
    touchStats: {
      touchCount: 3,
      meaningfulTouchCount: 2,
      rejectionCount: 1,
      failedBreakCount: 0,
      cleanBreakCount: 0,
      reclaimCount: 0,
      strongestReactionMovePct: 4,
      averageReactionMovePct: 2,
      bestVolumeRatio: 1.5,
      averageVolumeRatio: 1.1,
      cleanlinessStdDevPct: 0.2,
      barsSinceLastReaction: 5,
      ageInBars: 30,
    },
  };
}

function zone(
  overrides: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "kind" | "representativePrice" | "zoneLow" | "zoneHigh">,
): FinalLevelZone {
  return {
    symbol: "TEST",
    timeframeBias: "5m",
    strengthScore: 72,
    strengthLabel: "strong",
    touchCount: 3,
    confluenceCount: 1,
    sourceTypes: [overrides.kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.6,
    rejectionScore: 0.5,
    displacementScore: 0.4,
    sessionSignificanceScore: 0.3,
    followThroughScore: 0.5,
    sourceEvidenceCount: 1,
    firstTimestamp: Date.parse("2026-05-01T09:30:00-04:00"),
    lastTimestamp: Date.parse("2026-05-01T09:55:00-04:00"),
    isExtension: false,
    freshness: "fresh",
    notes: [],
    ...overrides,
  };
}

function levelOutput(overrides: Partial<LevelEngineOutput> = {}): LevelEngineOutput {
  return {
    symbol: "TEST",
    generatedAt: Date.parse("2026-05-01T10:00:00-04:00"),
    metadata: {
      providerByTimeframe: {},
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10,
    },
    majorSupport: [
      zone({
        id: "support-950",
        kind: "support",
        representativePrice: 9.5,
        zoneLow: 9.45,
        zoneHigh: 9.55,
        enrichedAnalysis: enrichedAnalysis(),
      }),
    ],
    majorResistance: [
      zone({
        id: "resistance-1080",
        kind: "resistance",
        representativePrice: 10.8,
        zoneLow: 10.75,
        zoneHigh: 10.85,
      }),
    ],
    intermediateSupport: [
      zone({
        id: "support-900",
        kind: "support",
        representativePrice: 9,
        zoneLow: 8.95,
        zoneHigh: 9.05,
      }),
    ],
    intermediateResistance: [],
    intradaySupport: [],
    intradayResistance: [],
    extensionLevels: {
      support: [
        zone({
          id: "extension-support-800",
          kind: "support",
          representativePrice: 8,
          zoneLow: 7.9,
          zoneHigh: 8.1,
          isExtension: true,
        }),
      ],
      resistance: [
        zone({
          id: "extension-resistance-1200",
          kind: "resistance",
          representativePrice: 12,
          zoneLow: 11.9,
          zoneHigh: 12.1,
          isExtension: true,
        }),
      ],
    },
    specialLevels: {},
    ...overrides,
  };
}

function factCandles(): Candle[] {
  return [
    candle("2026-05-01T09:30:00-04:00", 10, 10.1, 9.9, 10, 100_000),
    candle("2026-05-01T09:35:00-04:00", 10, 10.2, 9.95, 10.15, 120_000),
    candle("2026-05-01T09:40:00-04:00", 10.15, 10.25, 10, 10.2, 140_000),
    candle("2026-05-01T09:45:00-04:00", 10.2, 10.3, 10.05, 10.25, 160_000),
    candle("2026-05-01T09:50:00-04:00", 10.25, 10.35, 10.1, 10.3, 180_000),
    candle("2026-05-01T09:55:00-04:00", 10.3, 10.4, 10.15, 10.35, 200_000),
  ];
}

function sessionAndVolumeFacts() {
  const candles = factCandles();
  const asOfTimestamp = Date.parse("2026-05-01T10:05:00-04:00");
  const sessionFacts = buildSessionMarketFacts({
    symbol: "TEST",
    asOfTimestamp,
    candles5m: candles,
    previousClose: 9.75,
    currentPrice: 10.35,
  });
  const volumeFacts = buildVolumeMarketFacts({
    symbol: "TEST",
    asOfTimestamp,
    candles5m: candles,
    referencePrice: 10.35,
  });

  return {
    candles,
    asOfTimestamp,
    sessionFacts,
    volumeFacts,
  };
}

function shelf(overrides: Partial<VolumeShelf> = {}): VolumeShelf {
  return {
    id: "shelf-1",
    zoneLow: 9.8,
    zoneHigh: 10.2,
    representativePrice: 10,
    totalVolume: 500_000,
    dollarVolume: 5_000_000,
    percentOfWindowVolume: 45,
    touchCount: 4,
    firstTimestamp: Date.parse("2026-05-01T09:30:00-04:00"),
    lastTimestamp: Date.parse("2026-05-01T09:50:00-04:00"),
    shelfRole: "magnet",
    confidence: 0.7,
    reason: "Facts-only volume shelf.",
    ...overrides,
  };
}

function marketContextProfile(): MarketContextProfile {
  return {
    primaryContext: "normal_intraday",
    confidence: 0.7,
    runnerPhase: "not_applicable",
    evidence: [],
    warnings: [],
    facts: {
      filteredCandleCount: 6,
      filteredPremarketCandleCount: 0,
      filteredRegularSessionCandleCount: 6,
      aboveVWAP: true,
      percentFromVWAP: 2,
    },
    scoringAdjustments: {
      intradayWeightMultiplier: 1,
      dailyWeightMultiplier: 1,
      sessionLevelWeightMultiplier: 1,
      volumeWeightMultiplier: 1,
      extensionRiskPenaltyMultiplier: 1,
    },
  };
}

function execution(price = 10, side: "buy" | "sell" = "buy") {
  return {
    symbol: "TEST",
    executionId: `exec-${side}-${price}`,
    executionTimestamp: Date.parse("2026-05-01T10:00:00-04:00"),
    side,
    price,
    shares: 100,
  };
}

test("findNearestSupportLevel finds nearest support below execution", () => {
  const nearest = findNearestSupportLevel(levelOutput(), 10);

  assert.equal(nearest?.id, "support-950");
  assert.equal(nearest?.representativePrice, 9.5);
});

test("findNearestResistanceLevel finds nearest resistance above execution", () => {
  const nearest = findNearestResistanceLevel(levelOutput(), 10);

  assert.equal(nearest?.id, "resistance-1080");
  assert.equal(nearest?.representativePrice, 10.8);
});

test("extension levels can be used as target context levels", () => {
  const output = levelOutput({
    majorResistance: [],
  });
  const snapshot = buildExecutionMarketContextSnapshot({
    execution: execution(10, "buy"),
    levelOutput: output,
  });

  assert.equal(snapshot.nearestResistance?.id, "extension-resistance-1200");
  assert.equal(snapshot.nearestResistance?.isExtension, true);
  assert.equal(snapshot.riskContext.nearestTargetLevel, 12);
});

test("buildExecutionLevelSnapshot calculates support and resistance distance percentages", () => {
  const output = levelOutput();
  const support = buildExecutionLevelSnapshot(output.majorSupport[0]!, 10, "invalidation_area");
  const resistance = buildExecutionLevelSnapshot(output.majorResistance[0]!, 10, "profit_target");

  assert.equal(support.distanceFromExecutionPct, 5);
  assert.equal(resistance.distanceFromExecutionPct, 8);
  assert.equal(support.roleAtExecution, "invalidation_area");
  assert.deepEqual(support.enrichedAnalysis, output.majorSupport[0]!.enrichedAnalysis);
  assert.notStrictEqual(support.enrichedAnalysis, output.majorSupport[0]!.enrichedAnalysis);
});

test("trade location label is factual and deterministic", () => {
  const request = {
    execution: execution(9.55, "buy"),
    levelOutput: levelOutput(),
  };
  const first = buildExecutionMarketContextSnapshot(request);
  const second = buildExecutionMarketContextSnapshot(request);

  assert.equal(first.tradeLocation.label, "near_support");
  assert.equal(first.tradeLocation.confidence, 0.78);
  assert.deepEqual(first.tradeLocation, second.tradeLocation);
});

test("risk context identifies invalidation and target for a long buy", () => {
  const snapshot = buildExecutionMarketContextSnapshot({
    execution: execution(10, "buy"),
    levelOutput: levelOutput(),
  });

  assert.equal(snapshot.riskContext.nearestInvalidationLevel, 9.5);
  assert.equal(snapshot.riskContext.distanceToInvalidationPct, 5);
  assert.equal(snapshot.riskContext.nearestTargetLevel, 10.8);
  assert.equal(snapshot.riskContext.distanceToTargetPct, 8);
  assert.equal(snapshot.riskContext.riskRewardToNearestTarget, 1.6);
  assert.equal(snapshot.riskContext.hasDefinedRisk, true);
});

test("sell execution near resistance is identified factually", () => {
  const snapshot = buildExecutionMarketContextSnapshot({
    execution: execution(10.78, "sell"),
    levelOutput: levelOutput(),
  });

  assert.equal(snapshot.tradeLocation.label, "near_resistance");
  assert.equal(snapshot.nearestResistance?.representativePrice, 10.8);
  assert.equal(snapshot.riskContext.nearestInvalidationLevel, 10.8);
  assert.match(snapshot.riskContext.reason, /Sell-side factual context/);
});

test("supplied SessionMarketFacts are carried without mutation", () => {
  const { sessionFacts } = sessionAndVolumeFacts();
  const before = structuredClone(sessionFacts);
  const snapshot = buildExecutionMarketContextSnapshot({
    execution: execution(10, "buy"),
    levelOutput: levelOutput(),
    sessionFacts,
  });

  assert.deepEqual(sessionFacts, before);
  assert.deepEqual(snapshot.sessionFacts, sessionFacts);
  assert.notStrictEqual(snapshot.sessionFacts, sessionFacts);
  assert.equal(snapshot.safety.factsOnlyVWAP, true);
});

test("supplied VolumeMarketFacts are carried without mutation", () => {
  const { volumeFacts } = sessionAndVolumeFacts();
  const before = structuredClone(volumeFacts);
  const snapshot = buildExecutionMarketContextSnapshot({
    execution: execution(10, "buy"),
    levelOutput: levelOutput(),
    volumeFacts,
  });

  assert.deepEqual(volumeFacts, before);
  assert.deepEqual(snapshot.volumeFacts, volumeFacts);
  assert.notStrictEqual(snapshot.volumeFacts, volumeFacts);
});

test("supplied VolumeShelf array remains facts-only", () => {
  const shelves = [
    shelf({
      id: "chop-shelf",
      shelfRole: "chop_zone",
      zoneLow: 9.9,
      zoneHigh: 10.1,
      representativePrice: 10,
    }),
  ];
  const before = structuredClone(shelves);
  const snapshot = buildExecutionMarketContextSnapshot({
    execution: execution(10, "buy"),
    levelOutput: levelOutput(),
    volumeShelves: shelves,
  });

  assert.deepEqual(shelves, before);
  assert.deepEqual(snapshot.volumeShelves, shelves);
  assert.notStrictEqual(snapshot.volumeShelves, shelves);
  assert.equal(snapshot.tradeLocation.label, "chop_zone");
  assert.equal(snapshot.safety.shelvesFactsOnly, true);
  assert.ok(snapshot.diagnostics.some((diagnostic) => diagnostic.code === "volume_shelves_facts_only"));
  assert.equal(Object.hasOwn(snapshot, "supportLevels"), false);
  assert.equal(Object.hasOwn(snapshot, "resistanceLevels"), false);
});

test("supplied MarketContextProfile is carried without changing behavior", () => {
  const profile = marketContextProfile();
  const base = buildExecutionMarketContextSnapshot({
    execution: execution(10, "buy"),
    levelOutput: levelOutput(),
  });
  const withProfile = buildExecutionMarketContextSnapshot({
    execution: execution(10, "buy"),
    levelOutput: levelOutput(),
    marketContext: profile,
  });

  assert.deepEqual(withProfile.marketContext, profile);
  assert.notStrictEqual(withProfile.marketContext, profile);
  assert.deepEqual(withProfile.tradeLocation, base.tradeLocation);
  assert.deepEqual(withProfile.riskContext, base.riskContext);
});

test("supplied MarketContextFactsBundle is carried without changing behavior", () => {
  const { sessionFacts, volumeFacts } = sessionAndVolumeFacts();
  const factsBundle = buildMarketContextFactsBundle({
    sessionFacts,
    volumeFacts,
    volumeShelves: [shelf()],
  });
  const base = buildExecutionMarketContextSnapshot({
    execution: execution(10, "buy"),
    levelOutput: levelOutput(),
  });
  const withBundle = buildExecutionMarketContextSnapshot({
    execution: execution(10, "buy"),
    levelOutput: levelOutput(),
    factsBundle,
  });

  assert.deepEqual(withBundle.factsBundle, factsBundle);
  assert.notStrictEqual(withBundle.factsBundle, factsBundle);
  assert.deepEqual(withBundle.riskContext, base.riskContext);
  assert.equal(withBundle.safety.factsOnlyVWAP, true);
  assert.equal(withBundle.safety.shelvesFactsOnly, true);
});

test("supplied LevelEngineOutput is not mutated", () => {
  const output = levelOutput();
  const before = structuredClone(output);

  buildExecutionMarketContextSnapshot({
    execution: execution(10, "buy"),
    levelOutput: output,
  });

  assert.deepEqual(output, before);
});

test("old/default runtime mode remains unchanged", () => {
  const snapshot = buildExecutionMarketContextSnapshot({
    execution: execution(10, "buy"),
    levelOutput: levelOutput(),
  });

  assert.equal(resolveLevelRuntimeMode(undefined), "old");
  assert.equal(snapshot.safety.levelOutputUnchanged, true);
  assert.equal(Object.hasOwn(snapshot, "levelOutput"), false);
});

test("builder source does not call LevelEngine or generate levels", () => {
  const sourcePath = fileURLToPath(new URL("../lib/journal-context/execution-market-context.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("new LevelEngine"), false);
  assert.equal(source.includes(".generateLevels("), false);
});
