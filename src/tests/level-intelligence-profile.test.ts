import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildLevelIntelligenceProfile } from "../lib/levels/level-intelligence-profile.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { EnrichedLevelAnalysis, FinalLevelZone } from "../lib/levels/level-types.js";
import { buildMarketContextFactsBundle, type MarketContextProfile } from "../lib/market-context/index.js";
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
      failedBreakCount: 1,
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
    id: "TEST-level-1050",
    symbol: "TEST",
    kind,
    timeframeBias: "5m",
    zoneLow: 10.45,
    zoneHigh: 10.55,
    representativePrice: 10.5,
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
    enrichedAnalysis: enrichedAnalysis(),
    ...overrides,
  };
}

function sessionFacts(overrides: Partial<SessionMarketFacts> = {}): SessionMarketFacts {
  return {
    symbol: "TEST",
    asOfTimestamp: AS_OF,
    sessionDate: "2026-05-01",
    currentPrice: 10,
    highOfDay: 10.52,
    lowOfDay: 9.48,
    premarketHigh: 10.51,
    premarketLow: 9.47,
    openingRangeHigh: 10.49,
    openingRangeLow: 9.46,
    vwap: 10.5,
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
    id: "TEST-volume-shelf-1045-1055",
    zoneLow: 10.45,
    zoneHigh: 10.55,
    representativePrice: 10.5,
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

function textFrom(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function assertNoRecommendationLanguage(value: unknown): void {
  const text = textFrom(value);
  for (const [label, pattern] of [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["good trade", /\bgood trade\b/],
    ["bad trade", /\bbad trade\b/],
    ["mistake", /\bmistake\b/],
    ["coaching", /\bcoaching\b/],
    ["entry", /\bentry\b/],
    ["exit", /\bexit\b/],
    ["stop loss", /\bstop loss\b/],
    ["target", /\btarget\b/],
    ["take profit", /\btake profit\b/],
    ["add", /\badd\b/],
    ["trim", /\btrim\b/],
    ["size", /\bsize\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected action language: ${label}`);
  }
}

test("builds a deterministic facts-only profile without mutating inputs", () => {
  const level = zone();
  const session = sessionFacts();
  const volume = volumeFacts();
  const shelves = [volumeShelf()];
  const context = marketContext();
  const before = structuredClone({ level, session, volume, shelves, context });
  const input = { level, sessionFacts: session, volumeFacts: volume, volumeShelves: shelves, marketContext: context };

  const first = buildLevelIntelligenceProfile(input);
  const second = buildLevelIntelligenceProfile(input);

  assert.deepEqual(first, second);
  assert.deepEqual({ level, session, volume, shelves, context }, before);
  assert.deepEqual(first.safety, {
    factsOnly: true,
    noRuntimeBehaviorChange: true,
    vwapFactsOnly: true,
    shelvesAreFactsOnly: true,
  });
  assertNoRecommendationLanguage(first);
});

test("computes zone width origin freshness and enriched state", () => {
  const profile = buildLevelIntelligenceProfile({ level: zone(), referencePrice: 10 });

  assert.equal(profile.zoneWidthPercent, 0.9524);
  assert.deepEqual(profile.origin.sourceTypes, ["swing_high"]);
  assert.deepEqual(profile.origin.timeframeSources, ["5m"]);
  assert.equal(profile.origin.primaryTimeframe, "5m");
  assert.equal(profile.origin.isExtension, false);
  assert.equal(profile.freshness.label, "fresh");
  assert.equal(profile.freshness.state, "respected");
  assert.equal(profile.confidence, 0.86);
});

test("synthetic extension profile includes clear continuation-map metadata", () => {
  const profile = buildLevelIntelligenceProfile({
    level: zone({
      id: "TEST-synthetic-resistance-extension-1-13p0000",
      isExtension: true,
      sourceTypes: [],
      timeframeSources: [],
      timeframeBias: "mixed",
      representativePrice: 13,
      zoneLow: 12.95,
      zoneHigh: 13.05,
      touchCount: 0,
      confluenceCount: 0,
      reactionQualityScore: 0,
      rejectionScore: 0,
      displacementScore: 0,
      followThroughScore: 0,
      sourceEvidenceCount: 0,
      notes: ["Synthetic continuation-map extension for forward planning only; not historical support/resistance."],
      extensionMetadata: {
        extensionSource: "synthetic_continuation_map",
        generationMethod: "round_number_ladder",
        referencePrice: 10,
        targetCoveragePct: 0.3,
        maxCoveragePct: 0.5,
        syntheticIndex: 1,
        evidenceLimitations: [
          "no_real_extension_candidate_available",
          "not_historical_support_resistance",
          "no_touch_or_rejection_history",
          "no_historical_confluence",
        ],
      },
    }),
    referencePrice: 10,
  });
  const text = textFrom(profile);

  assert.equal(profile.extension?.source, "synthetic_continuation_map");
  assert.equal(profile.extension?.label, "Synthetic continuation map");
  assert.equal(profile.extension?.isSyntheticContinuationMap, true);
  assert.ok(profile.extension?.evidenceLimitations.includes("not_historical_support_resistance"));
  assert.ok(profile.confluence.contextTags.includes("synthetic_continuation_map"));
  assert.ok(profile.confluence.contextTags.includes("forward_planning_extension"));
  assert.ok(text.includes("synthetic continuation-map"));
  assert.ok(text.includes("not historical support/resistance"));
  assert.ok(text.includes("no_touch_or_rejection_history"));
  assertNoRecommendationLanguage(profile);
});

test("real extension profile does not receive synthetic continuation-map wording", () => {
  const profile = buildLevelIntelligenceProfile({
    level: zone({
      id: "TEST-real-extension-1",
      isExtension: true,
    }),
    referencePrice: 10,
  });
  const text = textFrom(profile);

  assert.equal(profile.extension?.source, "historical_candidate");
  assert.equal(profile.extension?.label, "Historical candidate extension");
  assert.equal(profile.extension?.isSyntheticContinuationMap, false);
  assert.equal(text.includes("synthetic continuation-map"), false);
});

test("copies touch reaction and volume-ratio evidence from enrichedAnalysis", () => {
  const profile = buildLevelIntelligenceProfile({ level: zone() });

  assert.equal(profile.reaction.touchCount, 3);
  assert.equal(profile.reaction.meaningfulTouchCount, 3);
  assert.equal(profile.reaction.rejectionCount, 2);
  assert.equal(profile.reaction.failedBreakCount, 1);
  assert.equal(profile.reaction.reclaimCount, 1);
  assert.equal(profile.reaction.averageReactionMovePct, 2.4);
  assert.equal(profile.reaction.strongestReactionMovePct, 5.2);
  assert.equal(profile.reaction.bestVolumeRatio, 1.7);
  assert.equal(profile.reaction.cleanlinessStdDevPct, 0.22);
});

test("computes neutral distance from reference price", () => {
  const near = buildLevelIntelligenceProfile({ level: zone(), referencePrice: 10.4 });
  const approaching = buildLevelIntelligenceProfile({ level: zone(), referencePrice: 10 });
  const extended = buildLevelIntelligenceProfile({ level: zone(), referencePrice: 9 });
  const far = buildLevelIntelligenceProfile({ level: zone(), referencePrice: 6 });

  assert.deepEqual(near.distance, { referencePrice: 10.4, distanceFromReferencePct: 0.9615, category: "near" });
  assert.deepEqual(approaching.distance, { referencePrice: 10, distanceFromReferencePct: 5, category: "approaching" });
  assert.equal(extended.distance?.category, "extended");
  assert.equal(far.distance?.category, "far");
});

test("keeps VWAP and volume facts as facts-only profile context", () => {
  const profile = buildLevelIntelligenceProfile({
    level: zone(),
    sessionFacts: sessionFacts({ vwap: 10.5 }),
    volumeFacts: volumeFacts(),
  });

  assert.equal(profile.volume?.volumeState, "extreme");
  assert.equal(profile.volume?.relativeVolume, 4);
  assert.equal(profile.volume?.dollarVolume, 4_000_000);
  assert.equal(profile.volume?.liquidityQuality, "good");
  assert.equal(profile.volume?.pullbackVolumeState, "drying_up");
  assert.equal(profile.volume?.breakoutVolumeState, "strong");
  assert.ok(profile.confluence.nearSessionFacts.some((fact) => fact.includes("VWAP fact")));
  assert.ok(profile.confluence.contextTags.includes("near_vwap_fact"));
  assert.equal(profile.safety.vwapFactsOnly, true);
});

test("keeps volume shelves facts-only and does not convert shelves into levels", () => {
  const profile = buildLevelIntelligenceProfile({
    level: zone(),
    volumeFacts: volumeFacts(),
    volumeShelves: [volumeShelf()],
  });

  assert.deepEqual(profile.volume?.nearbyShelfIds, ["TEST-volume-shelf-1045-1055"]);
  assert.ok(profile.confluence.nearShelfFacts.some((fact) => fact.includes("volume shelf TEST-volume-shelf-1045-1055")));
  assert.equal(Object.hasOwn(profile, "majorSupport"), false);
  assert.equal(Object.hasOwn(profile, "extensionLevels"), false);
  assert.equal(profile.safety.shelvesAreFactsOnly, true);
});

test("detects nearby round-number confluence as neutral metadata", () => {
  const half = buildLevelIntelligenceProfile({ level: zone({ representativePrice: 10.5 }) });
  const quarter = buildLevelIntelligenceProfile({
    level: zone({ representativePrice: 10.25, zoneLow: 10.2, zoneHigh: 10.3 }),
  });

  assert.deepEqual(half.confluence.nearRoundNumber, { value: 10.5, type: "half", distancePct: 0 });
  assert.deepEqual(quarter.confluence.nearRoundNumber, { value: 10.25, type: "quarter", distancePct: 0 });
});

test("resolves facts from MarketContextFactsBundle and carries market context facts", () => {
  const session = sessionFacts({ currentPrice: 10 });
  const volume = volumeFacts();
  const shelves = [volumeShelf()];
  const bundle = buildMarketContextFactsBundle({ sessionFacts: session, volumeFacts: volume, volumeShelves: shelves });
  const profile = buildLevelIntelligenceProfile({
    level: zone(),
    factsBundle: bundle,
    marketContext: marketContext(),
  });

  assert.equal(profile.distance?.referencePrice, 10);
  assert.equal(profile.volume?.relativeVolume, 4);
  assert.deepEqual(profile.volume?.nearbyShelfIds, ["TEST-volume-shelf-1045-1055"]);
  assert.deepEqual(profile.marketContext, {
    primaryContext: "day_trade_runner",
    runnerPhase: "high_of_day_breakout",
    confidence: 0.77,
  });
});

test("adds diagnostics when optional evidence is missing", () => {
  const profile = buildLevelIntelligenceProfile({
    level: zone({ enrichedAnalysis: undefined }),
  });

  assert.ok(profile.diagnostics.includes("session_facts_missing"));
  assert.ok(profile.diagnostics.includes("volume_facts_missing"));
  assert.ok(profile.diagnostics.includes("reference_price_missing"));
  assert.ok(profile.diagnostics.includes("enriched_analysis_missing"));
  assert.ok(profile.diagnostics.includes("no_nearby_volume_shelf"));
  assert.equal(profile.distance, undefined);
  assert.equal(profile.volume, undefined);
  assert.equal(profile.confidence, undefined);
});

test("profile source does not call LevelEngine or runtime wiring modules", () => {
  const sourcePath = fileURLToPath(new URL("../lib/levels/level-intelligence-profile.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("level-engine"), false);
  assert.equal(source.includes("new LevelEngine"), false);
  assert.equal(source.includes("buildLevelExtensions"), false);
  assert.equal(source.includes("rankLevels("), false);
  assert.equal(source.includes("../alerts"), false);
  assert.equal(source.includes("../monitoring"), false);
  assert.equal(source.includes("../trader-context"), false);
  assert.equal(source.toLowerCase().includes("discord"), false);
});

test("old/default runtime mode remains unchanged", () => {
  assert.equal(resolveLevelRuntimeMode(), "old");
});
