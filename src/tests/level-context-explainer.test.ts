import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  explainLevelContext,
  type LevelContextExplanation,
} from "../lib/levels/level-context-explainer.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { EnrichedLevelAnalysis, FinalLevelZone } from "../lib/levels/level-types.js";
import {
  buildMarketContextFactsBundle,
  type MarketContextProfile,
} from "../lib/market-context/index.js";
import type { SessionMarketFacts } from "../lib/session/index.js";
import type { VolumeMarketFacts, VolumeShelf } from "../lib/volume/index.js";

const AS_OF = Date.parse("2026-05-01T10:30:00-04:00");

function enrichedAnalysis(): EnrichedLevelAnalysis {
  return {
    source: "rankLevels",
    structuralStrengthScore: 0.74,
    activeRelevanceScore: 0.68,
    finalLevelScore: 0.71,
    confidence: 0.86,
    state: "respected",
    rank: 2,
    explanation: "Supplied enriched metadata from rankLevels.",
    scoreBreakdown: {
      timeframeScore: 0.7,
      touchScore: 0.6,
      reactionQualityScore: 0.7,
      reactionMagnitudeScore: 0.6,
      volumeScore: 0.5,
      cleanlinessScore: 0.5,
      roleFlipScore: 0,
      defenseScore: 0.6,
      recencyScore: 0.8,
      overtestPenalty: 0,
      clusterPenalty: 0,
      structuralStrengthScore: 0.74,
      distanceToPriceScore: 0.5,
      freshReactionScore: 0.7,
      intradayPressureScore: 0.4,
      recentVolumeActivityScore: 0.5,
      currentInteractionScore: 0.4,
      activeRelevanceScore: 0.68,
      finalLevelScore: 0.71,
    },
    touchStats: {
      touchCount: 4,
      meaningfulTouchCount: 3,
      rejectionCount: 2,
      failedBreakCount: 0,
      cleanBreakCount: 0,
      reclaimCount: 1,
      strongestReactionMovePct: 5.2,
      averageReactionMovePct: 2.4,
      bestVolumeRatio: 1.7,
      averageVolumeRatio: 1.2,
      cleanlinessStdDevPct: 0.22,
      barsSinceLastReaction: 4,
      ageInBars: 28,
    },
  };
}

function zone(overrides: Partial<FinalLevelZone> = {}): FinalLevelZone {
  const kind = overrides.kind ?? "resistance";

  return {
    id: "TEST-level-1000",
    symbol: "TEST",
    kind,
    timeframeBias: "5m",
    zoneLow: 9.95,
    zoneHigh: 10.05,
    representativePrice: 10,
    strengthScore: 72,
    strengthLabel: "strong",
    touchCount: 3,
    confluenceCount: 1,
    sourceTypes: [kind === "support" ? "swing_low" : "swing_high"],
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

function sessionFacts(overrides: Partial<SessionMarketFacts> = {}): SessionMarketFacts {
  return {
    symbol: "TEST",
    asOfTimestamp: AS_OF,
    sessionDate: "2026-05-01",
    currentPrice: 10.01,
    highOfDay: 10.02,
    lowOfDay: 9.48,
    premarketHigh: 10.03,
    premarketLow: 9.47,
    openingRangeHigh: 10.04,
    openingRangeLow: 9.46,
    vwap: 10.01,
    aboveVWAP: true,
    percentFromVWAP: 0.1,
    diagnostics: [],
    ...overrides,
  };
}

function volumeFacts(overrides: Partial<VolumeMarketFacts> = {}): VolumeMarketFacts {
  return {
    symbol: "TEST",
    asOfTimestamp: AS_OF,
    currentVolume: 400_000,
    rollingAverageVolume: 100_000,
    relativeVolume: 4,
    dollarVolume: 4_000_000,
    volumeState: "extreme",
    liquidityQuality: "good",
    accelerationState: "surging",
    pullbackVolumeState: "drying_up",
    breakoutVolumeState: "strong",
    diagnostics: [],
    ...overrides,
  };
}

function volumeShelf(overrides: Partial<VolumeShelf> = {}): VolumeShelf {
  return {
    id: "TEST-volume-shelf-995-1005",
    zoneLow: 9.95,
    zoneHigh: 10.05,
    representativePrice: 10,
    totalVolume: 900_000,
    dollarVolume: 9_000_000,
    percentOfWindowVolume: 42.5,
    touchCount: 4,
    firstTimestamp: Date.parse("2026-05-01T09:40:00-04:00"),
    lastTimestamp: Date.parse("2026-05-01T10:10:00-04:00"),
    shelfRole: "magnet",
    confidence: 0.82,
    reason: "High activity shelf carried as facts-only metadata.",
    ...overrides,
  };
}

function marketContext(overrides: Partial<MarketContextProfile> = {}): MarketContextProfile {
  return {
    primaryContext: "day_trade_runner",
    confidence: 0.77,
    runnerPhase: "high_of_day_breakout",
    evidence: [],
    warnings: [],
    facts: {
      percentFromPreviousClose: 18,
      percentFromOpen: 7,
      relativeVolume: 4,
      dollarVolume: 4_000_000,
      aboveVWAP: true,
      nearHighOfDay: true,
      filteredCandleCount: 12,
      filteredPremarketCandleCount: 4,
      filteredRegularSessionCandleCount: 8,
    },
    scoringAdjustments: {
      intradayWeightMultiplier: 1.2,
      dailyWeightMultiplier: 0.9,
      sessionLevelWeightMultiplier: 1.15,
      volumeWeightMultiplier: 1.3,
      extensionRiskPenaltyMultiplier: 1.15,
    },
    ...overrides,
  };
}

function assertNoRecommendationLanguage(explanation: LevelContextExplanation): void {
  const text = [
    explanation.explanation,
    ...explanation.facts,
    ...explanation.confluences,
    ...explanation.warnings,
  ]
    .join(" ")
    .toLowerCase();

  for (const forbidden of ["buy", "sell", "good trade", "bad trade", "mistake", "coaching"]) {
    assert.equal(text.includes(forbidden), false, `Unexpected recommendation language: ${forbidden}`);
  }
}

test("explains resistance near high of day", () => {
  const explanation = explainLevelContext({
    level: zone({ id: "resistance-hod", kind: "resistance", representativePrice: 10, zoneLow: 9.98, zoneHigh: 10.02 }),
    sessionFacts: sessionFacts({ highOfDay: 10.01 }),
  });

  assert.equal(explanation.levelId, "resistance-hod");
  assert.equal(explanation.kind, "resistance");
  assert.ok(explanation.nearbySessionFacts.some((fact) => fact.includes("high of day")));
  assert.ok(explanation.contextTags.includes("near_high_of_day"));
  assertNoRecommendationLanguage(explanation);
});

test("explains support near low of day", () => {
  const explanation = explainLevelContext({
    level: zone({
      id: "support-lod",
      kind: "support",
      representativePrice: 9.5,
      zoneLow: 9.45,
      zoneHigh: 9.55,
    }),
    sessionFacts: sessionFacts({ lowOfDay: 9.49 }),
  });

  assert.ok(explanation.nearbySessionFacts.some((fact) => fact.includes("low of day")));
  assert.ok(explanation.contextTags.includes("near_low_of_day"));
});

test("explains levels near premarket high and premarket low", () => {
  const highExplanation = explainLevelContext({
    level: zone({ id: "premarket-high", representativePrice: 10.5, zoneLow: 10.45, zoneHigh: 10.55 }),
    sessionFacts: sessionFacts({ premarketHigh: 10.51 }),
  });
  const lowExplanation = explainLevelContext({
    level: zone({
      id: "premarket-low",
      kind: "support",
      representativePrice: 9.25,
      zoneLow: 9.2,
      zoneHigh: 9.3,
    }),
    sessionFacts: sessionFacts({ premarketLow: 9.24 }),
  });

  assert.ok(highExplanation.contextTags.includes("near_premarket_high"));
  assert.ok(lowExplanation.contextTags.includes("near_premarket_low"));
});

test("explains levels near opening range high and opening range low", () => {
  const highExplanation = explainLevelContext({
    level: zone({ id: "orh", representativePrice: 10.75, zoneLow: 10.7, zoneHigh: 10.8 }),
    sessionFacts: sessionFacts({ openingRangeHigh: 10.74 }),
  });
  const lowExplanation = explainLevelContext({
    level: zone({
      id: "orl",
      kind: "support",
      representativePrice: 9.85,
      zoneLow: 9.8,
      zoneHigh: 9.9,
    }),
    sessionFacts: sessionFacts({ openingRangeLow: 9.84 }),
  });

  assert.ok(highExplanation.contextTags.includes("near_opening_range_high"));
  assert.ok(lowExplanation.contextTags.includes("near_opening_range_low"));
});

test("includes VWAP only as factual context", () => {
  const explanation = explainLevelContext({
    level: zone({ id: "vwap", representativePrice: 10, zoneLow: 9.95, zoneHigh: 10.05 }),
    sessionFacts: sessionFacts({ vwap: 10.01 }),
  });

  assert.ok(explanation.contextTags.includes("near_vwap_fact"));
  assert.ok(explanation.warnings.some((warning) => warning.includes("VWAP is facts-only context")));
  assertNoRecommendationLanguage(explanation);
});

test("includes nearby volume shelf facts without converting shelves into levels", () => {
  const explanation = explainLevelContext({
    level: zone({ id: "shelf", representativePrice: 10, zoneLow: 9.96, zoneHigh: 10.04 }),
    volumeShelves: [volumeShelf()],
  });

  assert.ok(explanation.contextTags.includes("near_volume_shelf"));
  assert.ok(explanation.contextTags.includes("volume_shelf_role_magnet"));
  assert.ok(explanation.nearbyShelfFacts[0]?.includes("volume shelf TEST-volume-shelf-995-1005"));
  assert.ok(explanation.warnings.some((warning) => warning.includes("not converted into support or resistance levels")));
});

test("includes volume state facts", () => {
  const explanation = explainLevelContext({
    level: zone(),
    volumeFacts: volumeFacts(),
  });

  assert.ok(explanation.nearbyVolumeFacts.includes("Volume state is extreme."));
  assert.ok(explanation.nearbyVolumeFacts.includes("Relative volume fact is 4."));
  assert.ok(explanation.nearbyVolumeFacts.includes("Volume acceleration fact is surging."));
  assert.ok(explanation.contextTags.includes("volume_state_extreme"));
});

test("includes market context facts if supplied", () => {
  const explanation = explainLevelContext({
    level: zone(),
    marketContext: marketContext({ primaryContext: "failed_runner", runnerPhase: "failed_breakout" }),
  });

  assert.ok(explanation.facts.some((fact) => fact.includes("Market context fact is failed_runner")));
  assert.ok(explanation.contextTags.includes("market_context_failed_runner"));
  assert.ok(explanation.contextTags.includes("runner_phase_failed_breakout"));
});

test("uses MarketContextFactsBundle as a facts source", () => {
  const bundle = buildMarketContextFactsBundle({
    sessionFacts: sessionFacts({ vwap: 10.01 }),
    volumeFacts: volumeFacts(),
    volumeShelves: [volumeShelf()],
    referencePrice: 10,
  });
  const explanation = explainLevelContext({
    level: zone(),
    factsBundle: bundle,
  });

  assert.ok(explanation.contextTags.includes("near_vwap_fact"));
  assert.ok(explanation.contextTags.includes("volume_state_extreme"));
  assert.ok(explanation.contextTags.includes("near_volume_shelf"));
});

test("includes enrichedAnalysis state and confidence if present", () => {
  const explanation = explainLevelContext({
    level: zone({ id: "enriched", enrichedAnalysis: enrichedAnalysis() }),
  });

  assert.ok(explanation.facts.includes("enrichedAnalysis state is respected with confidence 0.86."));
  assert.ok(explanation.confluences.includes("enrichedAnalysis is available as shadow metadata."));
  assert.ok(explanation.contextTags.includes("enriched_state_respected"));
});

test("handles extension levels factually", () => {
  const explanation = explainLevelContext({
    level: zone({ id: "extension", isExtension: true }),
  });

  assert.ok(explanation.facts.includes("Level is an extension level from the supplied runtime ladder."));
  assert.ok(explanation.contextTags.includes("extension_level"));
});

test("output is deterministic and inputs are not mutated", () => {
  const level = zone({ enrichedAnalysis: enrichedAnalysis() });
  const session = sessionFacts();
  const volume = volumeFacts();
  const shelves = [volumeShelf()];
  const context = marketContext();
  const before = structuredClone({ level, session, volume, shelves, context });
  const first = explainLevelContext({
    level,
    sessionFacts: session,
    volumeFacts: volume,
    volumeShelves: shelves,
    marketContext: context,
  });
  const second = explainLevelContext({
    level,
    sessionFacts: session,
    volumeFacts: volume,
    volumeShelves: shelves,
    marketContext: context,
  });

  assert.deepEqual(first, second);
  assert.deepEqual({ level, session, volume, shelves, context }, before);
});

test("builder source does not call LevelEngine or generate levels", () => {
  const sourcePath = fileURLToPath(new URL("../lib/levels/level-context-explainer.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("new LevelEngine"), false);
  assert.equal(source.includes(".generateLevels("), false);
});

test("old/default runtime mode remains unchanged", () => {
  assert.equal(resolveLevelRuntimeMode(), "old");
});
