import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildLevelQualityAuditReport,
  type LevelQualityAuditReport,
} from "../lib/levels/level-quality-audit-runner.js";
import type { LevelIntelligenceProfile } from "../lib/levels/level-intelligence-profile.js";
import type { LevelIntelligenceReport } from "../lib/levels/level-intelligence-report.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { EnrichedLevelAnalysis, FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";

const GENERATED_AT = Date.parse("2026-05-27T14:30:00-04:00");

function enrichedAnalysis(finalLevelScore: number, confidence = 0.82): EnrichedLevelAnalysis {
  return {
    source: "rankLevels",
    structuralStrengthScore: finalLevelScore,
    activeRelevanceScore: finalLevelScore,
    finalLevelScore,
    confidence,
    state: "respected",
    rank: 1,
    explanation: "Supplied ranked metadata for audit fixture.",
    scoreBreakdown: {
      timeframeScore: finalLevelScore,
      touchScore: finalLevelScore,
      reactionQualityScore: finalLevelScore,
      reactionMagnitudeScore: finalLevelScore,
      volumeScore: finalLevelScore,
      cleanlinessScore: finalLevelScore,
      roleFlipScore: 0,
      defenseScore: finalLevelScore,
      recencyScore: finalLevelScore,
      overtestPenalty: 0,
      clusterPenalty: 0,
      structuralStrengthScore: finalLevelScore,
      distanceToPriceScore: finalLevelScore,
      freshReactionScore: finalLevelScore,
      intradayPressureScore: finalLevelScore,
      recentVolumeActivityScore: finalLevelScore,
      currentInteractionScore: finalLevelScore,
      activeRelevanceScore: finalLevelScore,
      finalLevelScore,
    },
    touchStats: {
      touchCount: 4,
      meaningfulTouchCount: 3,
      rejectionCount: 2,
      failedBreakCount: 0,
      cleanBreakCount: 0,
      reclaimCount: 1,
      strongestReactionMovePct: 5.4,
      averageReactionMovePct: 2.2,
      bestVolumeRatio: 2.1,
      averageVolumeRatio: 1.4,
      cleanlinessStdDevPct: 0.18,
      barsSinceLastReaction: 3,
      ageInBars: 24,
    },
  };
}

function zone(
  id: string,
  kind: "support" | "resistance",
  representativePrice: number,
  overrides: Partial<FinalLevelZone> = {},
): FinalLevelZone {
  return {
    id,
    symbol: "QAUD",
    kind,
    timeframeBias: "5m",
    zoneLow: representativePrice - 0.03,
    zoneHigh: representativePrice + 0.03,
    representativePrice,
    strengthScore: 62,
    strengthLabel: "moderate",
    touchCount: 2,
    confluenceCount: 1,
    sourceTypes: [kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.56,
    rejectionScore: 0.5,
    displacementScore: 0.45,
    sessionSignificanceScore: 0.4,
    followThroughScore: 0.46,
    sourceEvidenceCount: 1,
    firstTimestamp: Date.parse("2026-05-27T09:30:00-04:00"),
    lastTimestamp: Date.parse("2026-05-27T10:30:00-04:00"),
    isExtension: false,
    freshness: "fresh",
    notes: [],
    ...overrides,
  };
}

function levelOutput(overrides: Partial<LevelEngineOutput> = {}): LevelEngineOutput {
  const output: LevelEngineOutput = {
    symbol: "QAUD",
    generatedAt: GENERATED_AT,
    metadata: {
      providerByTimeframe: { "5m": "fixture" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10,
    },
    majorSupport: [
      zone("major-support-950", "support", 9.5, {
        timeframeBias: "daily",
        timeframeSources: ["daily"],
        strengthScore: 91,
        strengthLabel: "major",
        touchCount: 5,
        confluenceCount: 3,
        enrichedAnalysis: enrichedAnalysis(0.94, 0.9),
      }),
    ],
    majorResistance: [
      zone("major-resistance-1050", "resistance", 10.5, {
        timeframeBias: "daily",
        timeframeSources: ["daily"],
        strengthScore: 88,
        strengthLabel: "major",
        touchCount: 4,
        confluenceCount: 3,
        enrichedAnalysis: enrichedAnalysis(0.91, 0.87),
      }),
    ],
    intermediateSupport: [
      zone("intermediate-support-910", "support", 9.1, {
        timeframeBias: "4h",
        timeframeSources: ["4h"],
        strengthScore: 28,
        strengthLabel: "weak",
        touchCount: 1,
        confluenceCount: 0,
        freshness: "stale",
      }),
    ],
    intermediateResistance: [
      zone("intermediate-resistance-1020", "resistance", 10.2, {
        timeframeBias: "4h",
        timeframeSources: ["4h"],
        strengthScore: 34,
        strengthLabel: "weak",
        confluenceCount: 0,
        freshness: "stale",
      }),
    ],
    intradaySupport: [
      zone("intraday-support-980", "support", 9.8, {
        strengthScore: 67,
        strengthLabel: "strong",
        enrichedAnalysis: enrichedAnalysis(0.7, 0.76),
      }),
    ],
    intradayResistance: [
      zone("intraday-resistance-1026", "resistance", 10.26, {
        strengthScore: 58,
        strengthLabel: "moderate",
        confluenceCount: 1,
      }),
    ],
    extensionLevels: {
      support: [
        zone("extension-support-855", "support", 8.55, {
          zoneLow: 8.5,
          zoneHigh: 8.6,
          isExtension: true,
          freshness: "aging",
        }),
      ],
      resistance: [
        zone("extension-resistance-1160", "resistance", 11.6, {
          zoneLow: 11.55,
          zoneHigh: 11.65,
          isExtension: true,
          freshness: "aging",
        }),
      ],
    },
    specialLevels: {
      premarketHigh: 10.5,
      premarketLow: 9.5,
      openingRangeHigh: 10.26,
      openingRangeLow: 9.8,
    },
  };

  return {
    ...output,
    ...overrides,
    metadata: {
      ...output.metadata,
      ...overrides.metadata,
    },
    extensionLevels: overrides.extensionLevels ?? output.extensionLevels,
  };
}

function profile(
  level: FinalLevelZone,
  overrides: Partial<LevelIntelligenceProfile> = {},
): LevelIntelligenceProfile {
  return {
    levelId: level.id,
    symbol: level.symbol,
    kind: level.kind,
    representativePrice: level.representativePrice,
    zoneLow: level.zoneLow,
    zoneHigh: level.zoneHigh,
    zoneWidthPercent: 0.6,
    origin: {
      sourceTypes: [...level.sourceTypes],
      timeframeSources: [...level.timeframeSources],
      primaryTimeframe: level.timeframeBias,
      isExtension: level.isExtension,
    },
    freshness: {
      firstTimestamp: level.firstTimestamp,
      lastTimestamp: level.lastTimestamp,
      label: level.freshness,
      state: level.enrichedAnalysis?.state,
    },
    reaction: {
      touchCount: level.touchCount,
      reactionQualityScore: level.reactionQualityScore,
      rejectionScore: level.rejectionScore,
      displacementScore: level.displacementScore,
      followThroughScore: level.followThroughScore,
    },
    distance: {
      referencePrice: 10,
      distanceFromReferencePct: Math.abs(level.representativePrice - 10) * 10,
      category: "near",
    },
    confluence: {
      nearSessionFacts: [],
      nearVolumeFacts: [],
      nearShelfFacts: [],
      contextTags: [],
    },
    confidence: level.enrichedAnalysis?.confidence,
    diagnostics: level.enrichedAnalysis ? [] : ["enriched_analysis_missing"],
    reason: "Audit fixture profile.",
    safety: {
      factsOnly: true,
      noRuntimeBehaviorChange: true,
      vwapFactsOnly: true,
      shelvesAreFactsOnly: true,
    },
    ...overrides,
  };
}

function allOutputLevels(output: LevelEngineOutput): FinalLevelZone[] {
  return [
    ...output.majorSupport,
    ...output.majorResistance,
    ...output.intermediateSupport,
    ...output.intermediateResistance,
    ...output.intradaySupport,
    ...output.intradayResistance,
    ...output.extensionLevels.support,
    ...output.extensionLevels.resistance,
  ];
}

function intelligenceReport(output: LevelEngineOutput): LevelIntelligenceReport {
  const profiles = allOutputLevels(output).map((level) => {
    if (level.id === "major-resistance-1050") {
      return profile(level, {
        confluence: {
          nearSessionFacts: ["near high of day"],
          nearVolumeFacts: ["volume state extreme"],
          nearShelfFacts: ["near volume shelf"],
          contextTags: ["day trade runner"],
        },
        marketContext: {
          primaryContext: "day_trade_runner",
          runnerPhase: "high_of_day_breakout",
          confidence: 0.78,
        },
      });
    }

    if (level.id === "major-support-950") {
      return profile(level, {
        confluence: {
          nearSessionFacts: ["near low of day"],
          nearVolumeFacts: [],
          nearShelfFacts: [],
          contextTags: ["normal intraday"],
        },
      });
    }

    if (level.id === "intraday-resistance-1026") {
      return profile(level, {
        confluence: {
          nearSessionFacts: ["near opening range high"],
          nearVolumeFacts: ["volume elevated"],
          nearShelfFacts: ["near volume shelf"],
          contextTags: [],
        },
      });
    }

    return profile(level);
  });

  return {
    symbol: output.symbol,
    generatedAt: output.generatedAt,
    referencePrice: output.metadata.referencePrice,
    profiles,
    buckets: {
      majorSupport: profiles.filter((item) => item.levelId === "major-support-950"),
      majorResistance: profiles.filter((item) => item.levelId === "major-resistance-1050"),
      intermediateSupport: profiles.filter((item) => item.levelId === "intermediate-support-910"),
      intermediateResistance: profiles.filter((item) => item.levelId === "intermediate-resistance-1020"),
      intradaySupport: profiles.filter((item) => item.levelId === "intraday-support-980"),
      intradayResistance: profiles.filter((item) => item.levelId === "intraday-resistance-1026"),
      extensionSupport: profiles.filter((item) => item.levelId === "extension-support-855"),
      extensionResistance: profiles.filter((item) => item.levelId === "extension-resistance-1160"),
    },
    counts: {
      majorSupport: output.majorSupport.length,
      majorResistance: output.majorResistance.length,
      intermediateSupport: output.intermediateSupport.length,
      intermediateResistance: output.intermediateResistance.length,
      intradaySupport: output.intradaySupport.length,
      intradayResistance: output.intradayResistance.length,
      extensionSupport: output.extensionLevels.support.length,
      extensionResistance: output.extensionLevels.resistance.length,
      total: allOutputLevels(output).length,
    },
    diagnostics: ["fixture_intelligence_report"],
    safety: {
      levelOutputUnchanged: true,
      factsOnly: true,
      vwapFactsOnly: true,
      shelvesAreFactsOnly: true,
      noRuntimeBehaviorChange: true,
    },
  };
}

function auditReport(): LevelQualityAuditReport {
  const output = levelOutput();
  return buildLevelQualityAuditReport({
    output,
    intelligenceReport: intelligenceReport(output),
    maxItems: 4,
  });
}

test("audits total levels and bucket counts", () => {
  const report = auditReport();

  assert.equal(report.symbol, "QAUD");
  assert.equal(report.generatedAt, GENERATED_AT);
  assert.equal(report.referencePrice, 10);
  assert.deepEqual(report.summary, {
    totalLevels: 8,
    supportCount: 4,
    resistanceCount: 4,
    extensionCount: 2,
    freshCount: 4,
    staleCount: 2,
    enrichedCount: 3,
    unenrichedCount: 5,
  });
  assert.equal(report.safety.levelOutputUnchanged, true);
  assert.equal(report.safety.noRuntimeBehaviorChange, true);
  assert.equal(report.safety.noScoringChange, true);
});

test("identifies strongest and weakest levels from supplied metadata", () => {
  const report = auditReport();

  assert.equal(report.strongestLevels[0]?.levelId, "major-support-950");
  assert.equal(report.strongestLevels[0]?.auditScore, 0.94);
  assert.equal(report.weakestLevels[0]?.levelId, "intermediate-support-910");
  assert.equal(report.weakestLevels[0]?.auditScore, 0.28);
});

test("identifies fresh, stale, enriched, and unenriched levels", () => {
  const report = auditReport();

  assert.deepEqual(
    report.staleLevels.map((item) => item.levelId),
    ["intermediate-support-910", "intermediate-resistance-1020"],
  );
  assert(report.freshLevels.some((item) => item.levelId === "major-support-950"));
  assert(report.enrichedLevels.every((item) => item.hasEnrichedAnalysis));
  assert(report.unenrichedLevels.every((item) => !item.hasEnrichedAnalysis));
  assert(report.diagnostics.includes("unenriched_levels_present"));
});

test("identifies clustered areas and possible clutter from nearby supplied levels", () => {
  const report = buildLevelQualityAuditReport({
    output: levelOutput(),
    intelligenceReport: intelligenceReport(levelOutput()),
    clusterThresholdPct: 1,
  });

  assert.equal(report.clusteredAreas.length, 1);
  assert.deepEqual(report.clusteredAreas[0]?.levelIds, [
    "intermediate-resistance-1020",
    "intraday-resistance-1026",
  ]);
  assert.deepEqual(
    report.possibleClutterLevels.map((item) => item.levelId),
    ["intermediate-resistance-1020", "intraday-resistance-1026"],
  );
  assert(report.diagnostics.includes("clustered_level_areas_present"));
});

test("audits extension ladder coverage and missing coverage warnings", () => {
  const report = auditReport();

  assert.equal(report.extensionCoverage.supportExtensions, 1);
  assert.equal(report.extensionCoverage.resistanceExtensions, 1);
  assert.equal(report.extensionCoverage.lowestSupportExtension, 8.55);
  assert.equal(report.extensionCoverage.highestResistanceExtension, 11.6);
  assert.equal(report.extensionCoverage.downsideCoveragePct, 14.5);
  assert.equal(report.extensionCoverage.upsideCoveragePct, 16);
  assert(report.extensionCoverage.warnings.includes("limited_upside_extension_coverage"));
  assert(report.extensionCoverage.warnings.includes("limited_downside_extension_coverage"));

  const output = levelOutput({
    extensionLevels: {
      support: [],
      resistance: [],
    },
  });
  const sparseReport = buildLevelQualityAuditReport({ output, intelligenceReport: intelligenceReport(output) });
  assert(sparseReport.extensionCoverage.warnings.includes("no_support_extension_coverage"));
  assert(sparseReport.extensionCoverage.warnings.includes("no_resistance_extension_coverage"));
});

test("audits nearby support and resistance coverage around the reference price", () => {
  const report = auditReport();

  assert.equal(report.nearbyCoverage.referencePrice, 10);
  assert.equal(report.nearbyCoverage.nearestSupport?.levelId, "intraday-support-980");
  assert.equal(report.nearbyCoverage.nearestResistance?.levelId, "intermediate-resistance-1020");
  assert.equal(report.nearbyCoverage.downsideSupportGapPct, 2);
  assert.equal(report.nearbyCoverage.overheadResistanceGapPct, 2);
  assert.equal(report.nearbyCoverage.nearbySupportCount, 2);
  assert.equal(report.nearbyCoverage.nearbyResistanceCount, 3);
});

test("counts session, volume, shelf, and market context confluence from the intelligence report", () => {
  const report = auditReport();

  assert.deepEqual(report.confluenceSummary, {
    sessionConfluenceCount: 3,
    volumeConfluenceCount: 2,
    shelfConfluenceCount: 2,
    marketContextConfluenceCount: 1,
  });
  assert.equal(report.strongConfluenceLevels[0]?.levelId, "major-resistance-1050");
  assert(report.weakContextLevels.some((item) => item.levelId === "intermediate-support-910"));
  assert(report.diagnostics.includes("levels_without_context_present"));
});

test("reports missing intelligence and missing reference price without changing inputs", () => {
  const output = levelOutput();
  delete output.metadata.referencePrice;
  const before = JSON.stringify(output);
  const report = buildLevelQualityAuditReport({ output });

  assert.equal(JSON.stringify(output), before);
  assert.equal(report.referencePrice, undefined);
  assert(report.diagnostics.includes("level_intelligence_report_missing"));
  assert(report.diagnostics.includes("reference_price_missing"));
  assert.deepEqual(report.nearbyCoverage.warnings, ["reference_price_missing"]);
});

test("is deterministic and does not mutate supplied reports", () => {
  const output = levelOutput();
  const intelligence = intelligenceReport(output);
  const outputBefore = JSON.stringify(output);
  const intelligenceBefore = JSON.stringify(intelligence);

  const first = buildLevelQualityAuditReport({ output, intelligenceReport: intelligence });
  const second = buildLevelQualityAuditReport({ output, intelligenceReport: intelligence });

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(output), outputBefore);
  assert.equal(JSON.stringify(intelligence), intelligenceBefore);
});

test("does not import LevelEngine and keeps runtime defaults unchanged", () => {
  const sourcePath = fileURLToPath(new URL("../lib/levels/level-quality-audit-runner.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("level-engine"), false);
  assert.equal(source.includes("new LevelEngine"), false);
  assert.equal(resolveLevelRuntimeMode(), "old");
});

test("audit output avoids recommendation and coaching wording", () => {
  const serialized = JSON.stringify(auditReport()).toLowerCase();
  const blockedTerms = [
    /\bbuy\b/,
    /\bsell\b/,
    /\benter\b/,
    /\bexit\b/,
    /good trade/,
    /bad trade/,
    /\bmistake\b/,
    /\bcoaching\b/,
    /p\/l/,
    /\bgiveback\b/,
    /\bgrading\b/,
  ];

  for (const term of blockedTerms) {
    assert.equal(term.test(serialized), false);
  }
});
