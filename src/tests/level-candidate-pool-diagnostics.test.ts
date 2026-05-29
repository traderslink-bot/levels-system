import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildLevelCandidatePoolDiagnostics,
  type BuildLevelCandidatePoolDiagnosticsInput,
} from "../lib/levels/level-candidate-pool-diagnostics.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type {
  FinalLevelZone,
  LevelEngineOutput,
  RawLevelCandidate,
  RawLevelCandidateSourceType,
} from "../lib/levels/level-types.js";
import type { CandleTimeframe } from "../lib/market-data/candle-types.js";

const GENERATED_AT = Date.parse("2026-05-29T10:00:00-04:00");

function rawCandidate(overrides: {
  id: string;
  kind: "support" | "resistance";
  price: number;
  timeframe?: CandleTimeframe;
  sourceType?: RawLevelCandidateSourceType;
}): RawLevelCandidate {
  return {
    id: overrides.id,
    symbol: "POOL",
    price: overrides.price,
    kind: overrides.kind,
    timeframe: overrides.timeframe ?? "4h",
    sourceType:
      overrides.sourceType ?? (overrides.kind === "support" ? "swing_low" : "swing_high"),
    touchCount: 2,
    reactionScore: 0.5,
    reactionQuality: 0.6,
    rejectionScore: 0.45,
    displacementScore: 0.55,
    sessionSignificance: 0.1,
    followThroughScore: 0.5,
    repeatedReactionCount: 1,
    gapStructure: false,
    firstTimestamp: GENERATED_AT - 60_000,
    lastTimestamp: GENERATED_AT,
    notes: [],
  };
}

function zone(overrides: Partial<FinalLevelZone> & {
  id: string;
  kind: "support" | "resistance";
  representativePrice: number;
}): FinalLevelZone {
  return {
    id: overrides.id,
    symbol: overrides.symbol ?? "POOL",
    kind: overrides.kind,
    timeframeBias: overrides.timeframeBias ?? "4h",
    zoneLow: overrides.zoneLow ?? Number((overrides.representativePrice - 0.05).toFixed(4)),
    zoneHigh: overrides.zoneHigh ?? Number((overrides.representativePrice + 0.05).toFixed(4)),
    representativePrice: overrides.representativePrice,
    strengthScore: overrides.strengthScore ?? 24,
    strengthLabel: overrides.strengthLabel ?? "moderate",
    touchCount: overrides.touchCount ?? 2,
    confluenceCount: overrides.confluenceCount ?? 1,
    sourceTypes:
      overrides.sourceTypes ?? (overrides.kind === "support" ? ["swing_low"] : ["swing_high"]),
    timeframeSources: overrides.timeframeSources ?? ["4h"],
    reactionQualityScore: overrides.reactionQualityScore ?? 0.6,
    rejectionScore: overrides.rejectionScore ?? 0.42,
    displacementScore: overrides.displacementScore ?? 0.54,
    sessionSignificanceScore: overrides.sessionSignificanceScore ?? 0.1,
    followThroughScore: overrides.followThroughScore ?? 0.48,
    gapContinuationScore: overrides.gapContinuationScore,
    sourceEvidenceCount: overrides.sourceEvidenceCount ?? 1,
    firstTimestamp: overrides.firstTimestamp ?? GENERATED_AT - 60_000,
    lastTimestamp: overrides.lastTimestamp ?? GENERATED_AT,
    sessionDate: overrides.sessionDate,
    isExtension: overrides.isExtension ?? false,
    freshness: overrides.freshness ?? "fresh",
    notes: overrides.notes ?? [],
    enrichedAnalysis: overrides.enrichedAnalysis,
  };
}

function outputFixture(): LevelEngineOutput {
  return {
    symbol: "POOL",
    generatedAt: GENERATED_AT,
    metadata: {
      providerByTimeframe: {},
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 10,
    },
    majorSupport: [zone({ id: "support-surfaced", kind: "support", representativePrice: 9.8 })],
    majorResistance: [zone({ id: "resistance-surfaced", kind: "resistance", representativePrice: 10.5 })],
    intermediateSupport: [],
    intermediateResistance: [
      zone({
        id: "resistance-intermediate",
        kind: "resistance",
        representativePrice: 11,
        timeframeBias: "daily",
        timeframeSources: ["daily"],
      }),
    ],
    intradaySupport: [],
    intradayResistance: [],
    extensionLevels: {
      support: [zone({ id: "support-selected-extension", kind: "support", representativePrice: 8, isExtension: true })],
      resistance: [
        zone({
          id: "resistance-selected-extension",
          kind: "resistance",
          representativePrice: 14,
          isExtension: true,
          sourceTypes: ["swing_high", "premarket_high"],
          timeframeBias: "mixed",
          timeframeSources: ["daily", "5m"],
        }),
      ],
    },
    specialLevels: {},
  };
}

function baseInput(): BuildLevelCandidatePoolDiagnosticsInput {
  const output = outputFixture();
  const clusteredSupportZones = [
    zone({ id: "support-surfaced", kind: "support", representativePrice: 9.8 }),
    zone({ id: "support-frontier", kind: "support", representativePrice: 8 }),
  ];
  const clusteredResistanceZones = [
    zone({ id: "resistance-surfaced", kind: "resistance", representativePrice: 10.5 }),
    zone({ id: "resistance-intermediate", kind: "resistance", representativePrice: 11, timeframeBias: "daily", timeframeSources: ["daily"] }),
    zone({
      id: "resistance-frontier",
      kind: "resistance",
      representativePrice: 14,
      sourceTypes: ["swing_high", "premarket_high"],
      timeframeBias: "mixed",
      timeframeSources: ["daily", "5m"],
    }),
  ];

  return {
    symbol: "POOL",
    referencePrice: 10,
    rawCandidates: [
      rawCandidate({ id: "raw-support-daily", kind: "support", price: 9.8, timeframe: "daily" }),
      rawCandidate({ id: "raw-support-4h", kind: "support", price: 9, timeframe: "4h" }),
      rawCandidate({ id: "raw-support-5m", kind: "support", price: 8, timeframe: "5m" }),
      rawCandidate({ id: "raw-resistance-daily", kind: "resistance", price: 10.5, timeframe: "daily" }),
      rawCandidate({ id: "raw-resistance-4h", kind: "resistance", price: 11, timeframe: "4h" }),
      rawCandidate({
        id: "raw-resistance-premarket",
        kind: "resistance",
        price: 14,
        timeframe: "5m",
        sourceType: "premarket_high",
      }),
    ],
    clusteredSupportZones,
    clusteredResistanceZones,
    scoredSupportZones: clusteredSupportZones.map((item) => ({ ...item, strengthScore: item.strengthScore + 2 })),
    scoredResistanceZones: clusteredResistanceZones.map((item) => ({ ...item, strengthScore: item.strengthScore + 2 })),
    levelOutput: output,
  };
}

test("reports raw candidate counts by side timeframe and source type", () => {
  const report = buildLevelCandidatePoolDiagnostics(baseInput());

  assert.equal(report.summary.rawCandidateCount, 6);
  assert.equal(report.support.raw.total, 3);
  assert.deepEqual(report.support.raw.byTimeframe, { "4h": 1, "5m": 1, daily: 1 });
  assert.deepEqual(report.support.raw.bySourceType, { swing_low: 3 });
  assert.equal(report.resistance.raw.total, 3);
  assert.deepEqual(report.resistance.raw.bySourceType, {
    premarket_high: 1,
    swing_high: 2,
  });
});

test("reports clustered and scored zone counts with source and timeframe summaries", () => {
  const report = buildLevelCandidatePoolDiagnostics(baseInput());

  assert.equal(report.summary.clusteredZoneCount, 5);
  assert.equal(report.summary.scoredZoneCount, 5);
  assert.equal(report.support.clustered.total, 2);
  assert.equal(report.resistance.scored.total, 3);
  assert.deepEqual(report.resistance.scored.byTimeframeBias, {
    "4h": 1,
    daily: 1,
    mixed: 1,
  });
  assert.equal(report.resistance.scored.bySourceTypeSet["premarket_high+swing_high"], 1);
});

test("reports surfaced bucket counts from LevelEngineOutput without changing output shape", () => {
  const input = baseInput();
  const before = structuredClone(input.levelOutput);
  const report = buildLevelCandidatePoolDiagnostics(input);

  assert.deepEqual(input.levelOutput, before);
  assert.deepEqual(report.surfacedBucketCounts, {
    majorSupport: 1,
    majorResistance: 1,
    intermediateSupport: 0,
    intermediateResistance: 1,
    intradaySupport: 0,
    intradayResistance: 0,
  });
  assert.equal(report.summary.surfacedLevelCount, 3);
  assert.equal(report.safety.levelOutputUnchanged, true);
});

test("reports extension candidate and selected extension counts", () => {
  const report = buildLevelCandidatePoolDiagnostics(baseInput());

  assert.equal(report.summary.extensionCandidateCount, 2);
  assert.equal(report.summary.selectedExtensionCount, 2);
  assert.deepEqual(report.support.extensionCandidates.prices, [8]);
  assert.deepEqual(report.support.selectedExtensions.prices, [8]);
  assert.deepEqual(report.resistance.extensionCandidates.prices, [14]);
  assert.deepEqual(report.resistance.selectedExtensions.prices, [14]);
});

test("identifies narrowing between candidate stages", () => {
  const report = buildLevelCandidatePoolDiagnostics(baseInput());
  const supportRawToClustered = report.support.narrowing.find(
    (entry) => entry.from === "raw" && entry.to === "clustered",
  );
  const resistanceScoredToExtension = report.resistance.narrowing.find(
    (entry) => entry.from === "scored" && entry.to === "extension_candidate",
  );

  assert.equal(supportRawToClustered?.fromCount, 3);
  assert.equal(supportRawToClustered?.toCount, 2);
  assert.equal(supportRawToClustered?.narrowed, true);
  assert.equal(resistanceScoredToExtension?.fromCount, 3);
  assert.equal(resistanceScoredToExtension?.toCount, 1);
  assert.equal(resistanceScoredToExtension?.note, "scored_zones_to_extension_boundary_candidates");
});

test("reports price ranges and candidate depth around reference price", () => {
  const report = buildLevelCandidatePoolDiagnostics(baseInput());

  assert.deepEqual(report.support.raw.priceRange, { min: 8, max: 9.8 });
  assert.equal(report.support.raw.depth.belowReferenceCount, 3);
  assert.equal(report.support.raw.depth.farthestBelowReference, 8);
  assert.equal(report.support.raw.depth.deepestBelowReferencePct, 20);
  assert.equal(report.resistance.scored.depth.aboveReferenceCount, 3);
  assert.equal(report.resistance.scored.depth.farthestAboveReference, 14);
  assert.equal(report.resistance.scored.depth.highestAboveReferencePct, 40);
});

test("identifies missing candidate depth above and below reference", () => {
  const report = buildLevelCandidatePoolDiagnostics({
    symbol: "POOL",
    referencePrice: 10,
    rawCandidates: [
      rawCandidate({ id: "support-above", kind: "support", price: 10.5 }),
      rawCandidate({ id: "resistance-below", kind: "resistance", price: 9.5 }),
    ],
    clusteredSupportZones: [zone({ id: "support-above", kind: "support", representativePrice: 10.5 })],
    clusteredResistanceZones: [zone({ id: "resistance-below", kind: "resistance", representativePrice: 9.5 })],
    scoredSupportZones: [zone({ id: "support-above", kind: "support", representativePrice: 10.5 })],
    scoredResistanceZones: [zone({ id: "resistance-below", kind: "resistance", representativePrice: 9.5 })],
    surfacedBuckets: {
      majorSupport: [zone({ id: "support-above", kind: "support", representativePrice: 10.5 })],
      majorResistance: [zone({ id: "resistance-below", kind: "resistance", representativePrice: 9.5 })],
      intermediateSupport: [],
      intermediateResistance: [],
      intradaySupport: [],
      intradayResistance: [],
    },
    extensionLevels: {
      support: [],
      resistance: [],
    },
  });

  assert(report.support.warnings.includes("no_scored_support_depth_below_reference"));
  assert(report.resistance.warnings.includes("no_scored_resistance_depth_above_reference"));
  assert(report.support.warnings.includes("no_support_extension_candidate_inventory"));
  assert(report.resistance.warnings.includes("no_resistance_extension_candidate_inventory"));
});

test("output is deterministic and does not mutate inputs", () => {
  const input = baseInput();
  const before = structuredClone(input);
  const first = buildLevelCandidatePoolDiagnostics(input);
  const second = buildLevelCandidatePoolDiagnostics(input);

  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
});

test("diagnostics do not use LevelEngine or change runtime defaults", () => {
  const sourcePath = fileURLToPath(
    new URL("../lib/levels/level-candidate-pool-diagnostics.ts", import.meta.url),
  );
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("./level-engine"), false);
  assert.equal(source.includes("new LevelEngine"), false);
  assert.equal(source.includes("buildLevelExtensions("), false);
  assert.equal(resolveLevelRuntimeMode(), "old");
});
