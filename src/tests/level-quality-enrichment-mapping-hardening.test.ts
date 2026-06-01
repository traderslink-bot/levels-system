import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildLevelQualityAuditReport } from "../lib/levels/level-quality-audit-runner.js";
import { buildNewRuntimeCompatibleLevelOutput } from "../lib/levels/level-runtime-output-adapter.js";
import type {
  EnrichedLevelAnalysis,
  FinalLevelZone,
  LevelCandidate,
  LevelEngineOutput,
} from "../lib/levels/level-types.js";

const GENERATED_AT = Date.parse("2026-06-01T14:30:00.000Z");

function enrichedAnalysis(): EnrichedLevelAnalysis {
  return {
    source: "rankLevels",
    structuralStrengthScore: 82,
    activeRelevanceScore: 76,
    finalLevelScore: 79,
    confidence: 88,
    state: "respected",
    rank: 1,
    explanation: "Fixture enriched metadata from rankLevels.",
    scoreBreakdown: {
      timeframeScore: 12,
      touchScore: 14,
      reactionQualityScore: 12,
      reactionMagnitudeScore: 8,
      volumeScore: 8,
      cleanlinessScore: 9,
      roleFlipScore: 0,
      defenseScore: 6,
      recencyScore: 5,
      overtestPenalty: 0,
      clusterPenalty: 0,
      structuralStrengthScore: 82,
      distanceToPriceScore: 9,
      freshReactionScore: 7,
      intradayPressureScore: 5,
      recentVolumeActivityScore: 4,
      currentInteractionScore: 3,
      activeRelevanceScore: 76,
      finalLevelScore: 79,
    },
    touchStats: {
      touchCount: 4,
      meaningfulTouchCount: 3,
      rejectionCount: 2,
      failedBreakCount: 0,
      cleanBreakCount: 0,
      reclaimCount: 1,
      strongestReactionMovePct: 0.06,
      averageReactionMovePct: 0.03,
      bestVolumeRatio: 2.1,
      averageVolumeRatio: 1.4,
      cleanlinessStdDevPct: 0.08,
      barsSinceLastReaction: 3,
      ageInBars: 24,
    },
  };
}

function levelCandidate(overrides: Partial<LevelCandidate> = {}): LevelCandidate {
  return {
    id: "fixture-support",
    symbol: "MAP",
    type: "support",
    price: 9.75,
    zoneLow: 9.72,
    zoneHigh: 9.78,
    sourceTimeframes: ["5m"],
    originKinds: ["swing_low"],
    touches: [],
    touchCount: 4,
    meaningfulTouchCount: 3,
    rejectionCount: 2,
    failedBreakCount: 0,
    cleanBreakCount: 0,
    reclaimCount: 1,
    roleFlipCount: 0,
    strongestReactionMovePct: 0.06,
    averageReactionMovePct: 0.03,
    bestVolumeRatio: 2.1,
    averageVolumeRatio: 1.4,
    cleanlinessStdDevPct: 0.08,
    ageInBars: 24,
    barsSinceLastReaction: 3,
    ...overrides,
  };
}

function zone(overrides: Partial<FinalLevelZone> = {}): FinalLevelZone {
  const representativePrice = overrides.representativePrice ?? 9.75;

  return {
    id: "fixture-support",
    symbol: "MAP",
    kind: "support",
    timeframeBias: "5m",
    zoneLow: representativePrice - 0.03,
    zoneHigh: representativePrice + 0.03,
    representativePrice,
    strengthScore: 68,
    strengthLabel: "strong",
    touchCount: 4,
    confluenceCount: 1,
    sourceTypes: ["swing_low"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.7,
    rejectionScore: 0.5,
    displacementScore: 0.45,
    sessionSignificanceScore: 0.4,
    followThroughScore: 0.38,
    sourceEvidenceCount: 3,
    firstTimestamp: GENERATED_AT - 60_000,
    lastTimestamp: GENERATED_AT,
    isExtension: false,
    freshness: "fresh",
    notes: [],
    ...overrides,
  };
}

function output(overrides: Partial<LevelEngineOutput> = {}): LevelEngineOutput {
  const base: LevelEngineOutput = {
    symbol: "MAP",
    generatedAt: GENERATED_AT,
    metadata: {
      providerByTimeframe: { "5m": "fixture", "4h": "fixture", daily: "fixture" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10,
    },
    majorSupport: [],
    majorResistance: [],
    intermediateSupport: [],
    intermediateResistance: [],
    intradaySupport: [],
    intradayResistance: [],
    extensionLevels: {
      support: [],
      resistance: [],
    },
    specialLevels: {},
  };

  return {
    ...base,
    ...overrides,
    metadata: {
      ...base.metadata,
      ...overrides.metadata,
    },
    extensionLevels: overrides.extensionLevels ?? base.extensionLevels,
    specialLevels: overrides.specialLevels ?? base.specialLevels,
  };
}

function buildProjection(params: {
  candidates: LevelCandidate[];
  runtimeZone: FinalLevelZone;
}) {
  return buildNewRuntimeCompatibleLevelOutput({
    symbol: "MAP",
    rawCandidates: [],
    levelCandidates: params.candidates,
    candlesByTimeframe: {},
    metadata: output().metadata,
    specialLevels: {},
    legacyRuntimeBuckets: {
      majorSupport: [params.runtimeZone],
      majorResistance: [],
      intermediateSupport: [],
      intermediateResistance: [],
      intradaySupport: [],
      intradayResistance: [],
    },
    generatedAt: GENERATED_AT,
  });
}

function stableZoneIdentity(input: FinalLevelZone): Omit<FinalLevelZone, "enrichedAnalysis" | "notes"> {
  const { enrichedAnalysis: _enrichedAnalysis, notes: _notes, ...identity } = input;
  return identity;
}

function assertNoInterpretiveLanguage(value: unknown): void {
  const serialized = JSON.stringify(value).toLowerCase();
  const prohibited = [
    "grade",
    "grading",
    "coaching",
    "coach",
    "p/l",
    "pnl",
    "giveback",
    "behavior score",
    "recommendation",
    "buy",
    "sell",
    "hold",
    "entry decision",
    "exit decision",
    "trade advice",
  ];

  for (const term of prohibited) {
    assert.equal(serialized.includes(term), false, `payload contains prohibited term ${term}`);
  }
}

test("ID mapping enriches a runtime zone without changing its price side or bucket", () => {
  const runtimeZone = zone({
    sourceTypes: ["premarket_low"],
    timeframeSources: ["daily"],
    timeframeBias: "daily",
  });
  const projection = buildProjection({
    candidates: [
      levelCandidate({
        id: runtimeZone.id,
        sourceTimeframes: ["5m"],
        originKinds: ["swing_low"],
      }),
    ],
    runtimeZone,
  });
  const projectedZone = projection.output.majorSupport[0];

  assert.ok(projectedZone?.enrichedAnalysis);
  assert.deepEqual(stableZoneIdentity(projectedZone!), stableZoneIdentity(runtimeZone));
  assert.equal(projection.enrichmentDiagnostics.enrichedHistoricalZones, 1);
  assert.equal(projection.enrichmentDiagnostics.unenrichedHistoricalZones, 0);
  assert.deepEqual(projection.enrichmentDiagnostics.unmatchedRuntimeZoneIds, []);
});

test("fallback mapping enriches by normalized price source and timeframe when runtime IDs differ", () => {
  const runtimeZone = zone({ id: "legacy-runtime-support" });
  const projection = buildProjection({
    candidates: [
      levelCandidate({
        id: "ranked-support-source",
        price: runtimeZone.representativePrice,
        sourceTimeframes: ["5m"],
        originKinds: ["swing_low"],
      }),
    ],
    runtimeZone,
  });
  const projectedZone = projection.output.majorSupport[0];

  assert.ok(projectedZone?.enrichedAnalysis);
  assert.deepEqual(stableZoneIdentity(projectedZone!), stableZoneIdentity(runtimeZone));
  assert.equal(projection.enrichmentDiagnostics.enrichedHistoricalZones, 1);
  assert.equal(projection.enrichmentDiagnostics.unenrichedZones, 0);
});

test("extension and synthetic enrichment gaps are separated from historical gaps", () => {
  const historical = zone({
    id: "historical-enriched",
    enrichedAnalysis: enrichedAnalysis(),
  });
  const historicalExtension = zone({
    id: "historical-extension-missing",
    representativePrice: 8.5,
    isExtension: true,
    freshness: "aging",
  });
  const syntheticExtension = zone({
    id: "synthetic-extension-missing",
    kind: "resistance",
    representativePrice: 11.5,
    zoneLow: 11.45,
    zoneHigh: 11.55,
    sourceTypes: ["swing_high"],
    isExtension: true,
    freshness: "aging",
    extensionMetadata: {
      extensionSource: "synthetic_continuation_map",
      generationMethod: "percentage_ladder",
      evidenceLimitations: ["not_historical_support_resistance"],
    },
  });
  const report = buildLevelQualityAuditReport({
    output: output({
      majorSupport: [historical],
      extensionLevels: {
        support: [historicalExtension],
        resistance: [syntheticExtension],
      },
    }),
    maxItems: 10,
  });

  assert.equal(report.enrichmentBreakdown?.historical.unenriched, 0);
  assert.deepEqual(report.enrichmentBreakdown?.extension.unenrichedLevelIds, ["historical-extension-missing"]);
  assert.deepEqual(report.enrichmentBreakdown?.synthetic.unenrichedLevelIds, ["synthetic-extension-missing"]);
  assert.equal(report.diagnostics.includes("unenriched_historical_levels_present"), false);
  assert.equal(report.diagnostics.includes("unenriched_extension_levels_present"), true);
  assert.equal(report.diagnostics.includes("unenriched_synthetic_levels_present"), true);
  assert.equal(report.unenrichedLevels.some((item) => item.syntheticContinuationMap), true);
  assert.equal(
    report.unenrichedLevels.some((item) =>
      item.syntheticContinuationMap && item.extensionSource === "synthetic_continuation_map",
    ),
    true,
  );
});

test("synthetic continuation-map rows are not enriched from ranked historical candidates", () => {
  const syntheticExtension = zone({
    id: "synthetic-support",
    representativePrice: 8.5,
    isExtension: true,
    extensionMetadata: {
      extensionSource: "synthetic_continuation_map",
      generationMethod: "percentage_ladder",
      evidenceLimitations: ["not_historical_support_resistance"],
    },
  });
  const projection = buildNewRuntimeCompatibleLevelOutput({
    symbol: "MAP",
    rawCandidates: [],
    levelCandidates: [levelCandidate({ id: syntheticExtension.id, price: syntheticExtension.representativePrice })],
    candlesByTimeframe: {},
    metadata: output().metadata,
    specialLevels: {},
    legacyExtensionLevels: {
      support: [syntheticExtension],
      resistance: [],
    },
    generatedAt: GENERATED_AT,
  });
  const projectedSynthetic = projection.output.extensionLevels.support[0];

  assert.equal(projectedSynthetic?.enrichedAnalysis, undefined);
  assert.equal(projection.enrichmentDiagnostics.unenrichedSyntheticZones, 1);
  assert.deepEqual(projection.enrichmentDiagnostics.unmatchedSyntheticRuntimeZoneIds, ["synthetic-support"]);
  assert.equal(
    projectedSynthetic?.extensionMetadata?.evidenceLimitations?.includes("not_historical_support_resistance"),
    true,
  );
});

test("enrichment hardening stays outside alerts monitoring Discord journal and 15m engine input", () => {
  const source = [
    readFileSync("src/lib/levels/level-runtime-output-adapter.ts", "utf8"),
    readFileSync("src/lib/levels/level-quality-audit-runner.ts", "utf8"),
  ].join("\n");

  assert.equal(source.includes("discord"), false);
  assert.equal(source.includes("monitoring"), false);
  assert.equal(source.includes("../alerts"), false);
  assert.equal(source.includes("15m"), false);
  assertNoInterpretiveLanguage({
    mapping: buildProjection({ candidates: [levelCandidate()], runtimeZone: zone() }).enrichmentDiagnostics,
    audit: buildLevelQualityAuditReport({ output: output({ majorSupport: [zone()] }) }).diagnostics,
  });
});
