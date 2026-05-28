import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildLevelContextReport,
  type LevelContextReport,
} from "../lib/levels/level-context-report.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { EnrichedLevelAnalysis, FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
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

function levelOutput(): LevelEngineOutput {
  return {
    symbol: "TEST",
    generatedAt: AS_OF,
    metadata: {
      providerByTimeframe: { "5m": "fixture" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10.01,
    },
    majorSupport: [
      zone({
        id: "major-support-low-day",
        kind: "support",
        representativePrice: 9.5,
        zoneLow: 9.45,
        zoneHigh: 9.55,
        timeframeBias: "daily",
        timeframeSources: ["daily"],
      }),
    ],
    majorResistance: [
      zone({
        id: "major-resistance-high-day",
        representativePrice: 10.5,
        zoneLow: 10.45,
        zoneHigh: 10.55,
        timeframeBias: "daily",
        timeframeSources: ["daily"],
      }),
    ],
    intermediateSupport: [
      zone({
        id: "intermediate-support-premarket-low",
        kind: "support",
        representativePrice: 9.25,
        zoneLow: 9.2,
        zoneHigh: 9.3,
        timeframeBias: "4h",
        timeframeSources: ["4h"],
      }),
    ],
    intermediateResistance: [
      zone({
        id: "intermediate-resistance-premarket-high",
        representativePrice: 10.75,
        zoneLow: 10.7,
        zoneHigh: 10.8,
        timeframeBias: "4h",
        timeframeSources: ["4h"],
        enrichedAnalysis: enrichedAnalysis(),
      }),
    ],
    intradaySupport: [
      zone({
        id: "intraday-support-opening-range-low",
        kind: "support",
        representativePrice: 9.75,
        zoneLow: 9.7,
        zoneHigh: 9.8,
      }),
    ],
    intradayResistance: [
      zone({
        id: "intraday-resistance-opening-range-high",
        representativePrice: 10.25,
        zoneLow: 10.2,
        zoneHigh: 10.3,
      }),
    ],
    extensionLevels: {
      support: [
        zone({
          id: "extension-support",
          kind: "support",
          representativePrice: 8.75,
          zoneLow: 8.7,
          zoneHigh: 8.8,
          isExtension: true,
        }),
      ],
      resistance: [
        zone({
          id: "extension-resistance",
          representativePrice: 11.25,
          zoneLow: 11.2,
          zoneHigh: 11.3,
          isExtension: true,
        }),
      ],
    },
    specialLevels: {
      premarketHigh: 10.75,
      premarketLow: 9.25,
      openingRangeHigh: 10.25,
      openingRangeLow: 9.75,
    },
  };
}

function sessionFacts(overrides: Partial<SessionMarketFacts> = {}): SessionMarketFacts {
  return {
    symbol: "TEST",
    asOfTimestamp: AS_OF,
    sessionDate: "2026-05-01",
    currentPrice: 10.01,
    highOfDay: 10.5,
    lowOfDay: 9.5,
    premarketHigh: 10.75,
    premarketLow: 9.25,
    openingRangeHigh: 10.25,
    openingRangeLow: 9.75,
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
    id: "TEST-volume-shelf-1020-1030",
    zoneLow: 10.2,
    zoneHigh: 10.3,
    representativePrice: 10.25,
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

function explanation(report: LevelContextReport, id: string) {
  const match = report.explanations.find((item) => item.levelId === id);
  assert.ok(match, `Missing explanation for ${id}`);
  return match;
}

function assertNoRecommendationLanguage(report: LevelContextReport): void {
  const text = report.explanations
    .flatMap((item) => [item.explanation, ...item.facts, ...item.confluences, ...item.warnings])
    .join(" ")
    .toLowerCase();

  for (const forbidden of ["buy", "sell", "good trade", "bad trade", "mistake", "coaching"]) {
    assert.equal(text.includes(forbidden), false, `Unexpected recommendation language: ${forbidden}`);
  }
}

test("builds report for all support and resistance buckets", () => {
  const output = levelOutput();
  const report = buildLevelContextReport({ output });

  assert.equal(report.symbol, "TEST");
  assert.equal(report.generatedAt, AS_OF);
  assert.deepEqual(
    report.explanations.map((item) => item.levelId),
    [
      "major-support-low-day",
      "major-resistance-high-day",
      "intermediate-support-premarket-low",
      "intermediate-resistance-premarket-high",
      "intraday-support-opening-range-low",
      "intraday-resistance-opening-range-high",
      "extension-support",
      "extension-resistance",
    ],
  );
  assert.equal(report.counts.total, 8);
});

test("includes major intermediate intraday and extension counts from the original output", () => {
  const output = levelOutput();
  const report = buildLevelContextReport({ output });

  assert.deepEqual(report.counts, {
    majorSupport: 1,
    majorResistance: 1,
    intermediateSupport: 1,
    intermediateResistance: 1,
    intradaySupport: 1,
    intradayResistance: 1,
    extensionSupport: 1,
    extensionResistance: 1,
    total: 8,
  });
  assert.deepEqual(report.safety, {
    levelOutputUnchanged: true,
    factsOnlyVWAP: true,
    shelvesAreFactsOnly: true,
    noRuntimeBehaviorChange: true,
  });
});

test("preserves exact input LevelEngineOutput and facts inputs", () => {
  const output = levelOutput();
  const session = sessionFacts();
  const volume = volumeFacts();
  const shelves = [volumeShelf()];
  const context = marketContext();
  const before = structuredClone({ output, session, volume, shelves, context });

  buildLevelContextReport({
    output,
    sessionFacts: session,
    volumeFacts: volume,
    volumeShelves: shelves,
    marketContext: context,
  });

  assert.deepEqual({ output, session, volume, shelves, context }, before);
});

test("passes session facts into explanations", () => {
  const report = buildLevelContextReport({ output: levelOutput(), sessionFacts: sessionFacts() });

  assert.ok(explanation(report, "major-resistance-high-day").contextTags.includes("near_high_of_day"));
  assert.ok(explanation(report, "major-support-low-day").contextTags.includes("near_low_of_day"));
  assert.ok(explanation(report, "intermediate-resistance-premarket-high").contextTags.includes("near_premarket_high"));
  assert.ok(explanation(report, "intermediate-support-premarket-low").contextTags.includes("near_premarket_low"));
  assert.ok(explanation(report, "intraday-resistance-opening-range-high").contextTags.includes("near_opening_range_high"));
  assert.ok(explanation(report, "intraday-support-opening-range-low").contextTags.includes("near_opening_range_low"));
});

test("passes volume facts and volume shelves as facts-only context", () => {
  const report = buildLevelContextReport({
    output: levelOutput(),
    volumeFacts: volumeFacts(),
    volumeShelves: [volumeShelf()],
  });

  const level = explanation(report, "intraday-resistance-opening-range-high");
  assert.ok(level.nearbyVolumeFacts.some((fact) => fact.includes("Volume state is extreme")));
  assert.ok(level.nearbyShelfFacts.some((fact) => fact.includes("volume shelf TEST-volume-shelf-1020-1030")));
  assert.ok(level.warnings.some((warning) => warning.includes("facts-only context")));
  assert.ok(report.safety.shelvesAreFactsOnly);
  assertNoRecommendationLanguage(report);
});

test("passes market context facts and facts bundle sources", () => {
  const session = sessionFacts();
  const volume = volumeFacts();
  const shelves = [volumeShelf()];
  const bundle = buildMarketContextFactsBundle({ sessionFacts: session, volumeFacts: volume, volumeShelves: shelves });
  const report = buildLevelContextReport({
    output: levelOutput(),
    factsBundle: bundle,
    marketContext: marketContext(),
  });

  const level = explanation(report, "major-resistance-high-day");
  assert.ok(level.contextTags.includes("market_context_day_trade_runner"));
  assert.ok(level.contextTags.includes("runner_phase_high_of_day_breakout"));
  assert.ok(level.nearbySessionFacts.some((fact) => fact.includes("high of day")));
  assert.ok(level.nearbyVolumeFacts.some((fact) => fact.includes("Relative volume fact")));
});

test("includes enrichedAnalysis metadata when present", () => {
  const report = buildLevelContextReport({ output: levelOutput() });
  const level = explanation(report, "intermediate-resistance-premarket-high");

  assert.ok(level.contextTags.includes("enriched_analysis_available"));
  assert.ok(level.contextTags.includes("enriched_state_respected"));
  assert.ok(level.facts.some((fact) => fact.includes("enrichedAnalysis state is respected")));
});

test("handles extension levels factually", () => {
  const report = buildLevelContextReport({ output: levelOutput() });

  assert.ok(explanation(report, "extension-support").contextTags.includes("extension_level"));
  assert.ok(explanation(report, "extension-resistance").facts.includes("Level is an extension level from the supplied runtime ladder."));
});

test("output is deterministic", () => {
  const input = {
    output: levelOutput(),
    sessionFacts: sessionFacts(),
    volumeFacts: volumeFacts(),
    volumeShelves: [volumeShelf()],
    marketContext: marketContext(),
  };

  assert.deepEqual(buildLevelContextReport(input), buildLevelContextReport(input));
});

test("report source does not call LevelEngine or generate levels", () => {
  const sourcePath = fileURLToPath(new URL("../lib/levels/level-context-report.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("level-engine"), false);
  assert.equal(source.includes("new LevelEngine"), false);
  assert.equal(source.includes("buildLevelExtensions"), false);
  assert.equal(source.includes("rankLevels("), false);
});

test("old/default runtime mode remains unchanged", () => {
  assert.equal(resolveLevelRuntimeMode(), "old");
});
