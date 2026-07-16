import assert from "node:assert/strict";
import test from "node:test";

import { CandleFetchService, StubHistoricalCandleProvider } from "../lib/market-data/candle-fetch-service.js";
import { DEFAULT_LEVEL_ENGINE_CONFIG } from "../lib/levels/level-config.js";
import { clusterRawLevelCandidates } from "../lib/levels/level-clusterer.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import type { LevelRuntimeComparisonLogEntry } from "../lib/levels/level-runtime-comparison-logger.js";
import {
  buildNewRuntimeCompatibleLevelOutput,
  type EnrichmentDiagnostics,
} from "../lib/levels/level-runtime-output-adapter.js";
import {
  LEVEL_RUNTIME_COMPARE_ACTIVE_PATH_ENV,
  LEVEL_RUNTIME_MODE_ENV,
  resolveLevelRuntimeCompareActivePath,
  resolveLevelRuntimeMode,
  resolveLevelRuntimeSettings,
} from "../lib/levels/level-runtime-mode.js";
import { buildDefaultSurfacedShadowCases } from "../lib/levels/level-surfaced-shadow-evaluation.js";
import type { SurfacedLevelSelection } from "../lib/levels/level-surfaced-selection.js";
import { normalizeOldPathOutput } from "../lib/levels/level-ranking-comparison.js";
import { buildRawLevelCandidates } from "../lib/levels/raw-level-candidate-builder.js";
import { scoreLevelZones } from "../lib/levels/level-scorer.js";
import { buildSpecialLevelCandidates } from "../lib/levels/special-level-builder.js";
import { detectSwingPoints } from "../lib/levels/swing-detector.js";
import type { CandleProviderResponse, CandleTimeframe } from "../lib/market-data/candle-types.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import type {
  FinalLevelZone,
  LevelEngineOutput,
  RawLevelCandidate,
  RankedLevel,
  SourceTimeframe,
} from "../lib/levels/level-types.js";

async function fetchCandlesByTimeframe(
  symbol: string,
): Promise<Record<CandleTimeframe, Awaited<ReturnType<CandleFetchService["fetchCandles"]>>>> {
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const [daily, fourHour, fiveMinute] = await Promise.all([
    service.fetchCandles({ symbol, timeframe: "daily", lookbackBars: 220 }),
    service.fetchCandles({ symbol, timeframe: "4h", lookbackBars: 180 }),
    service.fetchCandles({ symbol, timeframe: "5m", lookbackBars: 100 }),
  ]);

  return {
    daily,
    "4h": fourHour,
    "5m": fiveMinute,
  };
}

function flattenOutput(output: LevelEngineOutput): string[] {
  return [
    ...output.majorSupport,
    ...output.intermediateSupport,
    ...output.intradaySupport,
    ...output.majorResistance,
    ...output.intermediateResistance,
    ...output.intradayResistance,
    ...output.extensionLevels.support,
    ...output.extensionLevels.resistance,
  ].map((zone) => `${zone.kind}:${zone.representativePrice.toFixed(4)}:${zone.strengthLabel}`);
}

function buildRequest(symbol: string) {
  return {
    symbol,
    historicalRequests: {
      daily: { symbol, timeframe: "daily" as const, lookbackBars: 220 },
      "4h": { symbol, timeframe: "4h" as const, lookbackBars: 180 },
      "5m": { symbol, timeframe: "5m" as const, lookbackBars: 100 },
    },
  };
}

const FIXED_PARITY_FIXTURE_END_TIMESTAMP = Date.parse("2026-05-01T20:00:00.000Z");

const LEVEL_OUTPUT_ARRAY_KEYS = [
  "majorSupport",
  "majorResistance",
  "intermediateSupport",
  "intermediateResistance",
  "intradaySupport",
  "intradayResistance",
] as const;

const LEVEL_OUTPUT_TOP_LEVEL_KEYS = [
  "extensionLevels",
  "generatedAt",
  "intradayResistance",
  "intradaySupport",
  "intermediateResistance",
  "intermediateSupport",
  "majorResistance",
  "majorSupport",
  "metadata",
  "specialLevels",
  "symbol",
] as const;

const FINAL_LEVEL_ZONE_REQUIRED_KEYS = [
  "confluenceCount",
  "firstTimestamp",
  "followThroughScore",
  "freshness",
  "id",
  "isExtension",
  "kind",
  "lastTimestamp",
  "notes",
  "reactionQualityScore",
  "rejectionScore",
  "representativePrice",
  "sourceEvidenceCount",
  "sourceTypes",
  "strengthLabel",
  "strengthScore",
  "symbol",
  "timeframeBias",
  "timeframeSources",
  "touchCount",
  "zoneHigh",
  "zoneLow",
] as const;

const APPROVED_PARITY_GAP_CODES = new Set([
  "bucket_count_mismatch",
  "extension_ladder_gap",
  "nearest_support_gap",
  "nearest_resistance_gap",
]);

type ApprovedParityGapCode =
  | "bucket_count_mismatch"
  | "extension_ladder_gap"
  | "nearest_support_gap"
  | "nearest_resistance_gap";

type RuntimeBucketCountSummary = {
  major: number;
  intermediate: number;
  intraday: number;
  extension: number;
  extensionSupport: number;
  extensionResistance: number;
};

type RuntimeNearestSummary = {
  oldPrice: number | null;
  newPrice: number | null;
  distancePct: number | null;
};

type RuntimeParityReport = {
  bucketCounts: {
    old: RuntimeBucketCountSummary;
    new: RuntimeBucketCountSummary;
  };
  nearest: {
    support: RuntimeNearestSummary;
    resistance: RuntimeNearestSummary;
  };
  specialLevelsMatch: boolean;
  approvedGaps: Array<{
    code: ApprovedParityGapCode;
    detail: string;
  }>;
};

type RuntimeBucket = "major" | "intermediate" | "intraday";

type RuntimeStageCountAndIdentities<TIdentity> = {
  count: number;
  identities: TIdentity[];
};

type RuntimeRawCandidateIdentity = {
  id: string;
  symbol: string;
  kind: RawLevelCandidate["kind"];
  price: number;
  timeframe: CandleTimeframe;
  sourceType: RawLevelCandidate["sourceType"];
  touchCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
};

type RuntimeZoneIdentity = {
  id: string;
  kind: FinalLevelZone["kind"];
  price: number;
  bucket?: string;
  strengthLabel: FinalLevelZone["strengthLabel"];
  strengthScore: number;
  timeframeBias: FinalLevelZone["timeframeBias"];
  timeframeSources: CandleTimeframe[];
  sourceTypes: FinalLevelZone["sourceTypes"];
  isExtension: boolean;
};

type RuntimeRankedLevelIdentity = {
  id: string;
  type: RankedLevel["type"];
  price: number;
  rank: number;
  state: RankedLevel["state"];
  confidence: number;
  sourceTimeframes: SourceTimeframe[];
  originKinds: RankedLevel["originKinds"];
};

type RuntimeSurfacedLevelIdentity = RuntimeRankedLevelIdentity & {
  selectionCategory: "actionable" | "anchor";
  surfacedSelectionScore: number;
};

type RuntimeProjectedBucketDiagnostics = Record<
  RuntimeBucket,
  RuntimeStageCountAndIdentities<RuntimeZoneIdentity>
>;

type RuntimeExtensionDiagnostics = {
  total: number;
  support: RuntimeStageCountAndIdentities<RuntimeZoneIdentity>;
  resistance: RuntimeStageCountAndIdentities<RuntimeZoneIdentity>;
};

type RuntimeParityStageReport = {
  symbol: string;
  referencePrice: number;
  rawCandidates: RuntimeStageCountAndIdentities<RuntimeRawCandidateIdentity>;
  rawCandidateCountsBySide: Record<RawLevelCandidate["kind"], number>;
  rawCandidateCountsByTimeframe: Record<CandleTimeframe, number>;
  oldClusteredZones: RuntimeStageCountAndIdentities<RuntimeZoneIdentity>;
  oldScoredZones: RuntimeStageCountAndIdentities<RuntimeZoneIdentity>;
  oldSurfacedBuckets: RuntimeProjectedBucketDiagnostics;
  oldExtensionLevels: RuntimeExtensionDiagnostics;
  richerRankedLevels: RuntimeStageCountAndIdentities<RuntimeRankedLevelIdentity>;
  richerSurfacedLevels: RuntimeStageCountAndIdentities<RuntimeSurfacedLevelIdentity>;
  projectedNewBuckets: RuntimeProjectedBucketDiagnostics;
  projectedNewExtensionLevels: RuntimeExtensionDiagnostics;
  enrichmentDiagnostics: EnrichmentDiagnostics;
  nearest: RuntimeParityReport["nearest"];
  specialLevelsMatch: boolean;
  mappingNotes: string[];
};

type RuntimeParityStageDiagnostics = {
  report: RuntimeParityStageReport;
  rawCandidates: RawLevelCandidate[];
  candlesByTimeframe: Record<CandleTimeframe, CandleProviderResponse>;
  oldOutput: LevelEngineOutput;
  newOutput: LevelEngineOutput;
};

function buildFixedRequest(symbol: string, endTimeMs = FIXED_PARITY_FIXTURE_END_TIMESTAMP) {
  return {
    symbol,
    historicalRequests: {
      daily: { symbol, timeframe: "daily" as const, lookbackBars: 260, endTimeMs },
      "4h": { symbol, timeframe: "4h" as const, lookbackBars: 220, endTimeMs },
      "5m": { symbol, timeframe: "5m" as const, lookbackBars: 140, endTimeMs },
    },
  };
}

function allRuntimeZones(output: LevelEngineOutput): FinalLevelZone[] {
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

function enrichedRuntimeZones(output: LevelEngineOutput): FinalLevelZone[] {
  return allRuntimeZones(output).filter((zone) => zone.enrichedAnalysis);
}

function unenrichedRuntimeZones(output: LevelEngineOutput): FinalLevelZone[] {
  return allRuntimeZones(output).filter((zone) => !zone.enrichedAnalysis);
}

function assertFinalLevelZoneCompatible(zone: FinalLevelZone): void {
  for (const key of FINAL_LEVEL_ZONE_REQUIRED_KEYS) {
    assert.ok(key in zone, `FinalLevelZone is missing required key ${key}`);
  }

  assert.ok(zone.kind === "support" || zone.kind === "resistance");
  assert.ok(["weak", "moderate", "strong", "major"].includes(zone.strengthLabel));
  assert.ok(Array.isArray(zone.sourceTypes));
  assert.ok(Array.isArray(zone.timeframeSources));
  assert.ok(Array.isArray(zone.notes));
  assert.equal(typeof zone.representativePrice, "number");
  assert.equal(typeof zone.strengthScore, "number");
  assert.equal(typeof zone.isExtension, "boolean");
}

function assertEnrichedAnalysisCompatible(
  enrichedAnalysis: NonNullable<FinalLevelZone["enrichedAnalysis"]>,
): void {
  assert.equal(enrichedAnalysis.source, "rankLevels");
  assert.equal(typeof enrichedAnalysis.structuralStrengthScore, "number");
  assert.equal(typeof enrichedAnalysis.activeRelevanceScore, "number");
  assert.equal(typeof enrichedAnalysis.finalLevelScore, "number");
  assert.equal(typeof enrichedAnalysis.confidence, "number");
  assert.equal(typeof enrichedAnalysis.rank, "number");
  assert.equal(typeof enrichedAnalysis.explanation, "string");
  assert.ok(enrichedAnalysis.explanation.length > 0);
  assert.ok([
    "fresh",
    "respected",
    "heavily_tested",
    "weakened",
    "broken",
    "reclaimed",
    "flipped",
  ].includes(enrichedAnalysis.state));
  assert.ok(enrichedAnalysis.scoreBreakdown);
  assert.equal(typeof enrichedAnalysis.scoreBreakdown.finalLevelScore, "number");
  assert.ok(enrichedAnalysis.touchStats);
  assert.equal(typeof enrichedAnalysis.touchStats.touchCount, "number");
}

function assertLevelEngineOutputCompatible(output: LevelEngineOutput): void {
  assert.deepEqual(Object.keys(output).sort(), [...LEVEL_OUTPUT_TOP_LEVEL_KEYS].sort());
  assert.equal(typeof output.symbol, "string");
  assert.equal(typeof output.generatedAt, "number");
  assert.ok(output.metadata);
  assert.ok(output.specialLevels);
  assert.deepEqual(Object.keys(output.extensionLevels).sort(), ["resistance", "support"]);
  assert.ok(Array.isArray(output.extensionLevels.support));
  assert.ok(Array.isArray(output.extensionLevels.resistance));

  for (const key of LEVEL_OUTPUT_ARRAY_KEYS) {
    assert.ok(Array.isArray(output[key]), `${key} must be an array`);
  }

  for (const zone of allRuntimeZones(output)) {
    assertFinalLevelZoneCompatible(zone);
  }
}

function bucketCounts(output: LevelEngineOutput): RuntimeBucketCountSummary {
  return {
    major: output.majorSupport.length + output.majorResistance.length,
    intermediate: output.intermediateSupport.length + output.intermediateResistance.length,
    intraday: output.intradaySupport.length + output.intradayResistance.length,
    extension: output.extensionLevels.support.length + output.extensionLevels.resistance.length,
    extensionSupport: output.extensionLevels.support.length,
    extensionResistance: output.extensionLevels.resistance.length,
  };
}

function legacyRuntimeBuckets(output: LevelEngineOutput) {
  return {
    majorSupport: output.majorSupport,
    majorResistance: output.majorResistance,
    intermediateSupport: output.intermediateSupport,
    intermediateResistance: output.intermediateResistance,
    intradaySupport: output.intradaySupport,
    intradayResistance: output.intradayResistance,
  };
}

function nearestRuntimeLevel(
  output: LevelEngineOutput,
  kind: FinalLevelZone["kind"],
  referencePrice: number,
): FinalLevelZone | null {
  const candidates = allRuntimeZones(output)
    .filter((zone) => zone.kind === kind)
    .filter((zone) =>
      kind === "support"
        ? zone.representativePrice <= referencePrice
        : zone.representativePrice >= referencePrice,
    )
    .sort((left, right) =>
      Math.abs(left.representativePrice - referencePrice) -
      Math.abs(right.representativePrice - referencePrice),
    );
  return candidates[0] ?? null;
}

function priceDistancePct(left: number | null, right: number | null): number | null {
  if (left === null || right === null) {
    return left === right ? 0 : null;
  }
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 0.0001);
}

function nearestSummary(
  oldOutput: LevelEngineOutput,
  newOutput: LevelEngineOutput,
  kind: FinalLevelZone["kind"],
  referencePrice: number,
): RuntimeNearestSummary {
  const oldLevel = nearestRuntimeLevel(oldOutput, kind, referencePrice);
  const newLevel = nearestRuntimeLevel(newOutput, kind, referencePrice);
  const oldPrice = oldLevel?.representativePrice ?? null;
  const newPrice = newLevel?.representativePrice ?? null;

  return {
    oldPrice,
    newPrice,
    distancePct: priceDistancePct(oldPrice, newPrice),
  };
}

function runtimeCountsDiffer(left: RuntimeBucketCountSummary, right: RuntimeBucketCountSummary): boolean {
  return Object.keys(left).some((key) =>
    left[key as keyof RuntimeBucketCountSummary] !== right[key as keyof RuntimeBucketCountSummary],
  );
}

function buildRuntimeParityReport(
  oldOutput: LevelEngineOutput,
  newOutput: LevelEngineOutput,
  referencePrice = oldOutput.metadata.referencePrice ?? newOutput.metadata.referencePrice ?? 0,
): RuntimeParityReport {
  const oldCounts = bucketCounts(oldOutput);
  const newCounts = bucketCounts(newOutput);
  const support = nearestSummary(oldOutput, newOutput, "support", referencePrice);
  const resistance = nearestSummary(oldOutput, newOutput, "resistance", referencePrice);
  const approvedGaps: RuntimeParityReport["approvedGaps"] = [];

  if (runtimeCountsDiffer(oldCounts, newCounts)) {
    approvedGaps.push({
      code: "bucket_count_mismatch",
      detail: `old=${JSON.stringify(oldCounts)} new=${JSON.stringify(newCounts)}`,
    });
  }

  if (oldCounts.extension !== newCounts.extension) {
    approvedGaps.push({
      code: "extension_ladder_gap",
      detail:
        `old extensions=${oldCounts.extension} ` +
        `new extensions=${newCounts.extension}; new adapter currently maps deeper anchors only.`,
    });
  }

  if (support.distancePct === null || support.distancePct > 0.01) {
    approvedGaps.push({
      code: "nearest_support_gap",
      detail: `old=${support.oldPrice ?? "none"} new=${support.newPrice ?? "none"}`,
    });
  }

  if (resistance.distancePct === null || resistance.distancePct > 0.01) {
    approvedGaps.push({
      code: "nearest_resistance_gap",
      detail: `old=${resistance.oldPrice ?? "none"} new=${resistance.newPrice ?? "none"}`,
    });
  }

  return {
    bucketCounts: {
      old: oldCounts,
      new: newCounts,
    },
    nearest: {
      support,
      resistance,
    },
    specialLevelsMatch: JSON.stringify(oldOutput.specialLevels) === JSON.stringify(newOutput.specialLevels),
    approvedGaps,
  };
}

function assertOnlyApprovedParityGaps(report: RuntimeParityReport): void {
  for (const gap of report.approvedGaps) {
    assert.ok(APPROVED_PARITY_GAP_CODES.has(gap.code), `Unapproved parity gap: ${gap.code}`);
  }
}

function assertBucketCountSummary(summary: RuntimeBucketCountSummary): void {
  for (const value of Object.values(summary)) {
    assert.equal(Number.isInteger(value), true);
    assert.ok(value >= 0);
  }
}

async function fetchFixedCandlesByTimeframe(
  symbol: string,
): Promise<Record<CandleTimeframe, CandleProviderResponse>> {
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const request = buildFixedRequest(symbol);
  const [daily, fourHour, fiveMinute] = await Promise.all([
    service.fetchCandles(request.historicalRequests.daily),
    service.fetchCandles(request.historicalRequests["4h"]),
    service.fetchCandles(request.historicalRequests["5m"]),
  ]);

  return {
    daily,
    "4h": fourHour,
    "5m": fiveMinute,
  };
}

function deriveReferenceTimestampForDiagnostics(
  seriesMap: Record<CandleTimeframe, CandleProviderResponse>,
): number {
  return Math.max(
    seriesMap.daily.requestedEndTimestamp,
    seriesMap["4h"].requestedEndTimestamp,
    seriesMap["5m"].requestedEndTimestamp,
  );
}

function buildDiagnosticRawCandidates(
  symbol: string,
  seriesMap: Record<CandleTimeframe, CandleProviderResponse>,
): RawLevelCandidate[] {
  const rawCandidates: RawLevelCandidate[] = [];
  const normalizedSymbol = symbol.toUpperCase();

  for (const timeframe of ["daily", "4h", "5m"] as const) {
    const timeframeConfig = DEFAULT_LEVEL_ENGINE_CONFIG.timeframeConfig[timeframe];
    const series = seriesMap[timeframe];
    const swings = detectSwingPoints(series.candles, {
      swingWindow: timeframeConfig.swingWindow,
      minimumDisplacementPct: timeframeConfig.minimumDisplacementPct,
      minimumSeparationBars: timeframeConfig.minimumSwingSeparationBars,
      includeBarrierCandles: timeframe === "daily" || timeframe === "4h",
    });

    rawCandidates.push(
      ...buildRawLevelCandidates({
        symbol: normalizedSymbol,
        timeframe,
        candles: series.candles,
        swings,
      }),
    );
  }

  rawCandidates.push(
    ...buildSpecialLevelCandidates(normalizedSymbol, seriesMap["5m"].candles).candidates,
  );

  return rawCandidates;
}

function countRawCandidatesBySide(
  rawCandidates: RawLevelCandidate[],
): Record<RawLevelCandidate["kind"], number> {
  return {
    support: rawCandidates.filter((candidate) => candidate.kind === "support").length,
    resistance: rawCandidates.filter((candidate) => candidate.kind === "resistance").length,
  };
}

function countRawCandidatesByTimeframe(
  rawCandidates: RawLevelCandidate[],
): Record<CandleTimeframe, number> {
  return {
    daily: rawCandidates.filter((candidate) => candidate.timeframe === "daily").length,
    "4h": rawCandidates.filter((candidate) => candidate.timeframe === "4h").length,
    "5m": rawCandidates.filter((candidate) => candidate.timeframe === "5m").length,
  };
}

function rawCandidateIdentity(candidate: RawLevelCandidate): RuntimeRawCandidateIdentity {
  return {
    id: candidate.id,
    symbol: candidate.symbol,
    kind: candidate.kind,
    price: candidate.price,
    timeframe: candidate.timeframe,
    sourceType: candidate.sourceType,
    touchCount: candidate.touchCount,
    firstTimestamp: candidate.firstTimestamp,
    lastTimestamp: candidate.lastTimestamp,
  };
}

function zoneIdentity(zone: FinalLevelZone, bucket?: string): RuntimeZoneIdentity {
  return {
    id: zone.id,
    kind: zone.kind,
    price: zone.representativePrice,
    bucket,
    strengthLabel: zone.strengthLabel,
    strengthScore: zone.strengthScore,
    timeframeBias: zone.timeframeBias,
    timeframeSources: [...zone.timeframeSources],
    sourceTypes: [...zone.sourceTypes],
    isExtension: zone.isExtension,
  };
}

function rankedLevelIdentity(level: RankedLevel): RuntimeRankedLevelIdentity {
  return {
    id: level.id,
    type: level.type,
    price: level.price,
    rank: level.rank,
    state: level.state,
    confidence: level.confidence,
    sourceTimeframes: [...level.sourceTimeframes],
    originKinds: [...level.originKinds],
  };
}

function surfacedLevelIdentity(level: SurfacedLevelSelection): RuntimeSurfacedLevelIdentity {
  return {
    ...rankedLevelIdentity(level),
    selectionCategory: level.selectionCategory,
    surfacedSelectionScore: level.surfacedSelectionScore,
  };
}

function stageIdentities<TInput, TIdentity>(
  items: TInput[],
  mapper: (item: TInput) => TIdentity,
): RuntimeStageCountAndIdentities<TIdentity> {
  return {
    count: items.length,
    identities: items.map(mapper),
  };
}

function bucketStage(
  output: LevelEngineOutput,
  bucket: RuntimeBucket,
): RuntimeStageCountAndIdentities<RuntimeZoneIdentity> {
  if (bucket === "major") {
    return stageIdentities(
      [
        ...output.majorSupport.map((zone) => ({ zone, bucket: "majorSupport" })),
        ...output.majorResistance.map((zone) => ({ zone, bucket: "majorResistance" })),
      ],
      ({ zone, bucket: bucketName }) => zoneIdentity(zone, bucketName),
    );
  }

  if (bucket === "intermediate") {
    return stageIdentities(
      [
        ...output.intermediateSupport.map((zone) => ({ zone, bucket: "intermediateSupport" })),
        ...output.intermediateResistance.map((zone) => ({ zone, bucket: "intermediateResistance" })),
      ],
      ({ zone, bucket: bucketName }) => zoneIdentity(zone, bucketName),
    );
  }

  return stageIdentities(
    [
      ...output.intradaySupport.map((zone) => ({ zone, bucket: "intradaySupport" })),
      ...output.intradayResistance.map((zone) => ({ zone, bucket: "intradayResistance" })),
    ],
    ({ zone, bucket: bucketName }) => zoneIdentity(zone, bucketName),
  );
}

function bucketDiagnostics(output: LevelEngineOutput): RuntimeProjectedBucketDiagnostics {
  return {
    major: bucketStage(output, "major"),
    intermediate: bucketStage(output, "intermediate"),
    intraday: bucketStage(output, "intraday"),
  };
}

function extensionDiagnostics(output: LevelEngineOutput): RuntimeExtensionDiagnostics {
  return {
    total: output.extensionLevels.support.length + output.extensionLevels.resistance.length,
    support: stageIdentities(output.extensionLevels.support, (zone) =>
      zoneIdentity(zone, "extensionSupport"),
    ),
    resistance: stageIdentities(output.extensionLevels.resistance, (zone) =>
      zoneIdentity(zone, "extensionResistance"),
    ),
  };
}

function surfacedDisplayZones(output: LevelEngineOutput): FinalLevelZone[] {
  return [
    ...output.majorSupport,
    ...output.majorResistance,
    ...output.intermediateSupport,
    ...output.intermediateResistance,
    ...output.intradaySupport,
    ...output.intradayResistance,
  ];
}

function extensionZones(output: LevelEngineOutput): FinalLevelZone[] {
  return [
    ...output.extensionLevels.support,
    ...output.extensionLevels.resistance,
  ];
}

function displayPriceKey(zone: FinalLevelZone): string {
  return zone.representativePrice.toFixed(zone.representativePrice >= 1 ? 2 : 4);
}

function normalizedDistancePct(leftPrice: number, rightPrice: number): number {
  return Math.abs(leftPrice - rightPrice) /
    Math.max(Math.max(leftPrice, rightPrice), 0.0001);
}

function assertExtensionSpacing(
  zones: FinalLevelZone[],
  spacingPct: number,
): void {
  for (let leftIndex = 0; leftIndex < zones.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < zones.length; rightIndex += 1) {
      const left = zones[leftIndex]!;
      const right = zones[rightIndex]!;
      assert.ok(
        normalizedDistancePct(left.representativePrice, right.representativePrice) > spacingPct,
        `${left.id} and ${right.id} should remain spaced as extension levels`,
      );
    }
  }
}

function diagnosticRuntimeBucketForSourceTimeframes(timeframes: SourceTimeframe[]): RuntimeBucket {
  const normalized = [...new Set(timeframes.map((timeframe) =>
    timeframe === "daily" || timeframe === "4h" || timeframe === "5m" ? timeframe : "5m",
  ))];

  if (normalized.includes("daily") || normalized.length > 1) {
    return "major";
  }
  if (normalized.includes("4h")) {
    return "intermediate";
  }
  return "intraday";
}

function buildOldDiagnosticZones(params: {
  symbol: string;
  rawCandidates: RawLevelCandidate[];
  referenceTimestamp: number;
}): {
  clustered: FinalLevelZone[];
  scored: FinalLevelZone[];
} {
  const supportTolerance = Math.max(
    DEFAULT_LEVEL_ENGINE_CONFIG.timeframeConfig.daily.clusterTolerancePct,
    DEFAULT_LEVEL_ENGINE_CONFIG.timeframeConfig["4h"].clusterTolerancePct,
  );
  const resistanceTolerance = supportTolerance;
  const supportClustered = clusterRawLevelCandidates(
    params.symbol,
    "support",
    params.rawCandidates,
    supportTolerance,
    DEFAULT_LEVEL_ENGINE_CONFIG,
    params.referenceTimestamp,
  );
  const resistanceClustered = clusterRawLevelCandidates(
    params.symbol,
    "resistance",
    params.rawCandidates,
    resistanceTolerance,
    DEFAULT_LEVEL_ENGINE_CONFIG,
    params.referenceTimestamp,
  );
  const supportScored = scoreLevelZones(
    supportClustered,
    DEFAULT_LEVEL_ENGINE_CONFIG,
    params.referenceTimestamp,
  );
  const resistanceScored = scoreLevelZones(
    resistanceClustered,
    DEFAULT_LEVEL_ENGINE_CONFIG,
    params.referenceTimestamp,
  );

  return {
    clustered: [...supportClustered, ...resistanceClustered],
    scored: [...supportScored, ...resistanceScored],
  };
}

async function buildRuntimeParityStageDiagnostics(
  symbol: string,
): Promise<RuntimeParityStageDiagnostics> {
  const request = buildFixedRequest(symbol);
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const candlesByTimeframe = await fetchFixedCandlesByTimeframe(symbol);
  const rawCandidates = buildDiagnosticRawCandidates(symbol, candlesByTimeframe);
  const referenceTimestamp = deriveReferenceTimestampForDiagnostics(candlesByTimeframe);
  const oldZones = buildOldDiagnosticZones({
    symbol: symbol.toUpperCase(),
    rawCandidates,
    referenceTimestamp,
  });

  const [oldOutput, newOutput] = await Promise.all([
    new LevelEngine(service, undefined, { runtimeMode: "old" }).generateLevels(request),
    new LevelEngine(service, undefined, { runtimeMode: "new" }).generateLevels(request),
  ]);
  const projection = buildNewRuntimeCompatibleLevelOutput({
    symbol,
    rawCandidates,
    candlesByTimeframe: {
      daily: candlesByTimeframe.daily.candles,
      "4h": candlesByTimeframe["4h"].candles,
      "5m": candlesByTimeframe["5m"].candles,
    },
    metadata: oldOutput.metadata,
    specialLevels: oldOutput.specialLevels,
    legacyRuntimeBuckets: legacyRuntimeBuckets(oldOutput),
    runtimeBucketOwnership: "surfaced",
    legacyExtensionLevels: oldOutput.extensionLevels,
    generatedAt: FIXED_PARITY_FIXTURE_END_TIMESTAMP,
  });
  const referencePrice = oldOutput.metadata.referencePrice ?? newOutput.metadata.referencePrice ?? 0;
  const parityReport = buildRuntimeParityReport(oldOutput, projection.output, referencePrice);
  const rankedLevels = [
    ...projection.rankedOutput.supports,
    ...projection.rankedOutput.resistances,
  ];
  const surfacedLevels = [
    ...projection.surfacedSelection.surfacedSupports,
    ...projection.surfacedSelection.surfacedResistances,
  ];

  return {
    report: {
      symbol: symbol.toUpperCase(),
      referencePrice,
      rawCandidates: stageIdentities(rawCandidates, rawCandidateIdentity),
      rawCandidateCountsBySide: countRawCandidatesBySide(rawCandidates),
      rawCandidateCountsByTimeframe: countRawCandidatesByTimeframe(rawCandidates),
      oldClusteredZones: stageIdentities(oldZones.clustered, (zone) =>
        zoneIdentity(zone, "oldClustered"),
      ),
      oldScoredZones: stageIdentities(oldZones.scored, (zone) =>
        zoneIdentity(zone, "oldScored"),
      ),
      oldSurfacedBuckets: bucketDiagnostics(oldOutput),
      oldExtensionLevels: extensionDiagnostics(oldOutput),
      richerRankedLevels: stageIdentities(rankedLevels, rankedLevelIdentity),
      richerSurfacedLevels: stageIdentities(surfacedLevels, surfacedLevelIdentity),
      projectedNewBuckets: bucketDiagnostics(projection.output),
      projectedNewExtensionLevels: extensionDiagnostics(projection.output),
      enrichmentDiagnostics: projection.enrichmentDiagnostics,
      nearest: parityReport.nearest,
      specialLevelsMatch: parityReport.specialLevelsMatch,
      mappingNotes: projection.mappingNotes,
    },
    rawCandidates,
    candlesByTimeframe,
    oldOutput,
    newOutput,
  };
}

let cachedNearRuntimeParityStageDiagnostics: Promise<RuntimeParityStageDiagnostics> | null = null;

function getNearRuntimeParityStageDiagnostics(): Promise<RuntimeParityStageDiagnostics> {
  cachedNearRuntimeParityStageDiagnostics ??= buildRuntimeParityStageDiagnostics("NEAR");
  return cachedNearRuntimeParityStageDiagnostics;
}

async function generateRuntimeFixtureOutputs(symbol: string): Promise<{
  defaultOutput: LevelEngineOutput;
  oldOutput: LevelEngineOutput;
  newOutput: LevelEngineOutput;
  compareOldOutput: LevelEngineOutput;
  compareNewOutput: LevelEngineOutput;
  compareOldLogs: LevelRuntimeComparisonLogEntry[];
  compareNewLogs: LevelRuntimeComparisonLogEntry[];
}> {
  const request = buildFixedRequest(symbol);
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const compareOldLogs: LevelRuntimeComparisonLogEntry[] = [];
  const compareNewLogs: LevelRuntimeComparisonLogEntry[] = [];

  const defaultEngine = new LevelEngine(service);
  const oldEngine = new LevelEngine(service, undefined, { runtimeMode: "old" });
  const newEngine = new LevelEngine(service, undefined, { runtimeMode: "new" });
  const compareOldEngine = new LevelEngine(service, undefined, {
    runtimeMode: "compare",
    compareActivePath: "old",
    onComparisonLog: (entry) => compareOldLogs.push(entry),
  });
  const compareNewEngine = new LevelEngine(service, undefined, {
    runtimeMode: "compare",
    compareActivePath: "new",
    onComparisonLog: (entry) => compareNewLogs.push(entry),
  });

  const [defaultOutput, oldOutput, newOutput, compareOldOutput, compareNewOutput] = await Promise.all([
    defaultEngine.generateLevels(request),
    oldEngine.generateLevels(request),
    newEngine.generateLevels(request),
    compareOldEngine.generateLevels(request),
    compareNewEngine.generateLevels(request),
  ]);

  return {
    defaultOutput,
    oldOutput,
    newOutput,
    compareOldOutput,
    compareNewOutput,
    compareOldLogs,
    compareNewLogs,
  };
}

function fixtureZone(params: {
  id: string;
  symbol: string;
  kind: FinalLevelZone["kind"];
  price: number;
  isExtension?: boolean;
}): FinalLevelZone {
  return {
    id: params.id,
    symbol: params.symbol,
    kind: params.kind,
    timeframeBias: "5m",
    zoneLow: Number((params.price * 0.995).toFixed(4)),
    zoneHigh: Number((params.price * 1.005).toFixed(4)),
    representativePrice: params.price,
    strengthScore: 50,
    strengthLabel: "moderate",
    touchCount: 2,
    confluenceCount: 1,
    sourceTypes: [params.kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.6,
    rejectionScore: 0.5,
    displacementScore: 0.5,
    sessionSignificanceScore: 0.4,
    followThroughScore: 0.5,
    gapContinuationScore: 0,
    sourceEvidenceCount: 1,
    firstTimestamp: 1,
    lastTimestamp: 2,
    isExtension: params.isExtension ?? false,
    freshness: "fresh",
    notes: [],
  };
}

function fixtureOutput(
  symbol: string,
  overrides: Partial<LevelEngineOutput> = {},
): LevelEngineOutput {
  return {
    symbol,
    generatedAt: 1,
    metadata: {
      providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 0.31,
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
    ...overrides,
  };
}

test("mode resolution defaults to old and falls back safely on invalid values", () => {
  assert.equal(resolveLevelRuntimeMode(undefined), "old");
  assert.equal(resolveLevelRuntimeMode("new"), "new");
  assert.equal(resolveLevelRuntimeMode("compare"), "compare");
  assert.equal(resolveLevelRuntimeMode("weird"), "old");
  assert.equal(resolveLevelRuntimeCompareActivePath(undefined), "old");
  assert.equal(resolveLevelRuntimeCompareActivePath("new"), "new");
  assert.equal(resolveLevelRuntimeCompareActivePath("bad"), "old");

  const settings = resolveLevelRuntimeSettings({
    [LEVEL_RUNTIME_MODE_ENV]: "compare",
    [LEVEL_RUNTIME_COMPARE_ACTIVE_PATH_ENV]: "new",
  });
  assert.equal(settings.mode, "compare");
  assert.equal(settings.compareActivePath, "new");
  assert.equal(settings.compareLoggingEnabled, true);
});

test("old mode behavior is preserved when runtime mode remains old", async () => {
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const defaultEngine = new LevelEngine(service);
  const explicitOldEngine = new LevelEngine(service, undefined, {
    runtimeMode: "old",
  });

  const [defaultOutput, explicitOldOutput] = await Promise.all([
    defaultEngine.generateLevels(buildRequest("AAPL")),
    explicitOldEngine.generateLevels(buildRequest("AAPL")),
  ]);

  assert.deepEqual(flattenOutput(defaultOutput), flattenOutput(explicitOldOutput));
  assert.deepEqual(defaultOutput.metadata, explicitOldOutput.metadata);
  assert.equal(enrichedRuntimeZones(defaultOutput).length, 0);
  assert.equal(enrichedRuntimeZones(explicitOldOutput).length, 0);
});

test("new mode maps the surfaced adapter back into the runtime-compatible output shape", async () => {
  const brokenCase = buildDefaultSurfacedShadowCases().find(
    (shadowCase) => shadowCase.caseId === "broken-level-exclusion",
  );
  assert.ok(brokenCase);

  const candlesByTimeframe = await fetchCandlesByTimeframe(brokenCase.symbol);
  const projection = buildNewRuntimeCompatibleLevelOutput({
    symbol: brokenCase.symbol,
    rawCandidates: brokenCase.rawCandidates ?? [],
    levelCandidates: brokenCase.newCandidates,
    candlesByTimeframe: {
      daily: candlesByTimeframe.daily.candles,
      "4h": candlesByTimeframe["4h"].candles,
      "5m": candlesByTimeframe["5m"].candles,
    },
    metadata: {
      providerByTimeframe: {
        daily: "stub",
        "4h": "stub",
        "5m": "stub",
      },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: brokenCase.currentPrice,
    },
    specialLevels: {},
  });

  assert.equal(projection.output.symbol, brokenCase.symbol);
  assert.ok(Array.isArray(projection.output.majorSupport));
  assert.ok(Array.isArray(projection.output.majorResistance));
  assert.ok(Array.isArray(projection.output.extensionLevels.support));
  assert.ok(Array.isArray(projection.output.extensionLevels.resistance));

  const supportPrices = [
    ...projection.output.majorSupport,
    ...projection.output.intermediateSupport,
    ...projection.output.intradaySupport,
    ...projection.output.extensionLevels.support,
  ].map((zone) => zone.representativePrice.toFixed(2));

  assert.ok(!supportPrices.includes("7.96"));
});

test("compare mode keeps one active path, computes the alternate path, and emits a comparison log payload", async () => {
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const compareLogs: LevelRuntimeComparisonLogEntry[] = [];
  const oldEngine = new LevelEngine(service, undefined, {
    runtimeMode: "old",
  });
  const compareEngine = new LevelEngine(service, undefined, {
    runtimeMode: "compare",
    compareActivePath: "old",
    onComparisonLog: (entry) => {
      compareLogs.push(entry);
    },
  });

  const [oldOutput, compareOutput] = await Promise.all([
    oldEngine.generateLevels(buildRequest("MSFT")),
    compareEngine.generateLevels(buildRequest("MSFT")),
  ]);

  assert.deepEqual(flattenOutput(oldOutput), flattenOutput(compareOutput));
  assert.equal(compareLogs.length, 1);
  assert.equal(compareLogs[0]?.activePath, "old");
  assert.equal(compareLogs[0]?.alternatePath, "new");
});

test("compare mode can keep the new path active while logging the old path observationally", async () => {
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const compareLogs: LevelRuntimeComparisonLogEntry[] = [];
  const newEngine = new LevelEngine(service, undefined, {
    runtimeMode: "new",
  });
  const compareEngine = new LevelEngine(service, undefined, {
    runtimeMode: "compare",
    compareActivePath: "new",
    onComparisonLog: (entry) => {
      compareLogs.push(entry);
    },
  });

  const [newOutput, compareOutput] = await Promise.all([
    newEngine.generateLevels(buildRequest("NVDA")),
    compareEngine.generateLevels(buildRequest("NVDA")),
  ]);

  assert.deepEqual(flattenOutput(newOutput), flattenOutput(compareOutput));
  assert.equal(compareLogs.length, 1);
  assert.equal(compareLogs[0]?.activePath, "new");
  assert.equal(compareLogs[0]?.alternatePath, "old");
});

test("rollback to old mode is config-only and restores the untouched legacy output", async () => {
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const newEngine = new LevelEngine(service, undefined, {
    runtimeMode: "new",
  });
  const oldEngine = new LevelEngine(service, undefined, {
    runtimeMode: "old",
  });
  const fallbackEngine = new LevelEngine(service, undefined, {
    runtimeMode: resolveLevelRuntimeMode("invalid"),
  });

  const [newOutput, oldOutput, fallbackOutput] = await Promise.all([
    newEngine.generateLevels(buildRequest("TSLA")),
    oldEngine.generateLevels(buildRequest("TSLA")),
    fallbackEngine.generateLevels(buildRequest("TSLA")),
  ]);

  assertLevelEngineOutputCompatible(newOutput);
  assert.deepEqual(flattenOutput(oldOutput), flattenOutput(fallbackOutput));
  assert.notDeepEqual(flattenOutput(oldOutput), flattenOutput(newOutput));
  assert.deepEqual(
    normalizeOldPathOutput(oldOutput, oldOutput.metadata.referencePrice ?? 0, 8),
    normalizeOldPathOutput(fallbackOutput, fallbackOutput.metadata.referencePrice ?? 0, 8),
  );
});

test("old, new, and compare modes all return LevelEngineOutput-compatible shapes", async () => {
  const {
    defaultOutput,
    oldOutput,
    newOutput,
    compareOldOutput,
    compareNewOutput,
  } = await generateRuntimeFixtureOutputs("PARI");

  for (const output of [defaultOutput, oldOutput, newOutput, compareOldOutput, compareNewOutput]) {
    assertLevelEngineOutputCompatible(output);
  }

  assert.deepEqual(flattenOutput(defaultOutput), flattenOutput(oldOutput));
});

test("projected ownership changes bucket inventory while preserving output bounds", async () => {
  const { oldOutput, newOutput } = await generateRuntimeFixtureOutputs("NEAR");
  const report = buildRuntimeParityReport(oldOutput, newOutput);

  assertBucketCountSummary(report.bucketCounts.old);
  assertBucketCountSummary(report.bucketCounts.new);
  assertOnlyApprovedParityGaps(report);
  assert.notDeepEqual(report.bucketCounts.new, report.bucketCounts.old);
  assert.ok(
    report.bucketCounts.new.major +
      report.bucketCounts.new.intermediate +
      report.bucketCounts.new.intraday <= 24,
  );
  assert.equal(report.approvedGaps.some((gap) => gap.code === "bucket_count_mismatch"), true);
});

test("explicit legacy bucket ownership remains available for diagnostics only", async () => {
  const diagnostics = await getNearRuntimeParityStageDiagnostics();
  const projection = buildNewRuntimeCompatibleLevelOutput({
    symbol: diagnostics.oldOutput.symbol,
    rawCandidates: diagnostics.rawCandidates,
    candlesByTimeframe: {
      daily: diagnostics.candlesByTimeframe.daily.candles,
      "4h": diagnostics.candlesByTimeframe["4h"].candles,
      "5m": diagnostics.candlesByTimeframe["5m"].candles,
    },
    metadata: diagnostics.oldOutput.metadata,
    specialLevels: diagnostics.oldOutput.specialLevels,
    legacyRuntimeBuckets: legacyRuntimeBuckets(diagnostics.oldOutput),
    runtimeBucketOwnership: "legacy",
    generatedAt: FIXED_PARITY_FIXTURE_END_TIMESTAMP,
  });

  assert.deepEqual(
    surfacedDisplayZones(projection.output).map((zone) => zone.id),
    surfacedDisplayZones(diagnostics.oldOutput).map((zone) => zone.id),
  );
});

test("legacy bucket ownership requires an explicit legacy bucket payload", () => {
  assert.throws(
    () => buildNewRuntimeCompatibleLevelOutput({
      symbol: "ROLL",
      rawCandidates: [],
      levelCandidates: [],
      candlesByTimeframe: {},
      metadata: {
        providerByTimeframe: {},
        dataQualityFlags: [],
        freshness: "fresh",
        referencePrice: 1,
      },
      specialLevels: {},
      runtimeBucketOwnership: "legacy",
      generatedAt: 1,
    }),
    /requires legacyRuntimeBuckets/,
  );
});

test("runtime parity fixture compares nearest support and resistance around reference price", async () => {
  const { oldOutput, newOutput } = await generateRuntimeFixtureOutputs("NEAR");
  const referencePrice = oldOutput.metadata.referencePrice ?? newOutput.metadata.referencePrice;
  assert.ok(referencePrice);

  const report = buildRuntimeParityReport(oldOutput, newOutput, referencePrice);

  assert.ok(
    report.nearest.support.oldPrice !== null || report.nearest.support.newPrice !== null,
    "fixture must expose a nearest support comparison",
  );
  assert.ok(
    report.nearest.resistance.oldPrice !== null || report.nearest.resistance.newPrice !== null,
    "fixture must expose a nearest resistance comparison",
  );
  assertOnlyApprovedParityGaps(report);
  assert.equal(report.nearest.support.oldPrice, 4.5284);
  assert.ok(report.nearest.support.newPrice);
  assert.equal(report.nearest.resistance.oldPrice, 4.6957);
  assert.ok(report.nearest.resistance.newPrice);
});

test("old/new runtime fixture keeps special levels identical", async () => {
  const { oldOutput, newOutput } = await generateRuntimeFixtureOutputs("SPEC");

  assert.ok(Object.keys(oldOutput.specialLevels).length > 0);
  assert.deepEqual(newOutput.specialLevels, oldOutput.specialLevels);
});

test("runtime parity diagnostics expose every old and new pipeline stage", async () => {
  const { report, newOutput } = await getNearRuntimeParityStageDiagnostics();
  const newCounts = bucketCounts(newOutput);

  assert.equal(report.symbol, "NEAR");
  assert.equal(report.referencePrice, 4.6136);
  assert.ok(report.rawCandidates.count > 0);
  assert.equal(report.rawCandidates.count, report.rawCandidates.identities.length);
  assert.equal(
    report.rawCandidateCountsBySide.support + report.rawCandidateCountsBySide.resistance,
    report.rawCandidates.count,
  );
  assert.equal(
    report.rawCandidateCountsByTimeframe.daily +
      report.rawCandidateCountsByTimeframe["4h"] +
      report.rawCandidateCountsByTimeframe["5m"],
    report.rawCandidates.count,
  );

  for (const stage of [
    report.oldClusteredZones,
    report.oldScoredZones,
    report.richerRankedLevels,
    report.richerSurfacedLevels,
  ]) {
    assert.equal(stage.count, stage.identities.length);
    assert.ok(stage.count > 0);
  }

  for (const buckets of [report.oldSurfacedBuckets, report.projectedNewBuckets]) {
    assert.equal(buckets.major.count, buckets.major.identities.length);
    assert.equal(buckets.intermediate.count, buckets.intermediate.identities.length);
    assert.equal(buckets.intraday.count, buckets.intraday.identities.length);
  }

  assert.equal(report.oldSurfacedBuckets.major.count, 20);
  assert.equal(report.oldSurfacedBuckets.intermediate.count, 2);
  assert.equal(report.oldSurfacedBuckets.intraday.count, 1);
  assert.equal(report.projectedNewBuckets.major.count, newCounts.major);
  assert.equal(report.projectedNewBuckets.intermediate.count, newCounts.intermediate);
  assert.equal(report.projectedNewBuckets.intraday.count, newCounts.intraday);
  const projectedIds = Object.values(report.projectedNewBuckets)
    .flatMap((bucket) => bucket.identities.map((identity) => identity.id))
    .sort();
  const surfacedIds = report.richerSurfacedLevels.identities
    .map((identity) => identity.id)
    .sort();
  assert.deepEqual(projectedIds, surfacedIds);
  assert.equal(
    report.enrichmentDiagnostics.totalRuntimeZones,
    report.projectedNewBuckets.major.count +
      report.projectedNewBuckets.intermediate.count +
      report.projectedNewBuckets.intraday.count +
      report.projectedNewExtensionLevels.total,
  );
  assert.ok(report.enrichmentDiagnostics.enrichedZones > 0);
  assert.equal(
    report.enrichmentDiagnostics.totalRuntimeZones,
    report.enrichmentDiagnostics.enrichedZones + report.enrichmentDiagnostics.unenrichedZones,
  );
  assert.ok(
    report.mappingNotes.some((note) =>
      note.includes("Runtime buckets are owned by the projected surfaced selection"),
    ),
  );
  assert.ok(
    report.mappingNotes.some((note) =>
      note.includes("reuse the legacy extension ladder supplied by the old runtime path"),
    ),
  );
  assert.ok(
    report.mappingNotes.some((note) => note.includes("enrichedAnalysis attached to")),
  );
});

test("runtime parity diagnostics prove raw candidate conversion preserves identity and evidence basis", async () => {
  const diagnostics = await getNearRuntimeParityStageDiagnostics();
  const candidates = diagnostics.rawCandidates.filter(
    (candidate) => candidate.timeframe === "daily" || candidate.timeframe === "4h",
  );
  let selected:
    | {
        rawCandidate: RawLevelCandidate;
        rankedLevel: RankedLevel;
      }
    | null = null;

  for (const rawCandidate of candidates) {
    const projection = buildNewRuntimeCompatibleLevelOutput({
      symbol: rawCandidate.symbol,
      rawCandidates: [rawCandidate],
      candlesByTimeframe: {
        daily: diagnostics.candlesByTimeframe.daily.candles,
        "4h": diagnostics.candlesByTimeframe["4h"].candles,
        "5m": diagnostics.candlesByTimeframe["5m"].candles,
      },
      metadata: diagnostics.oldOutput.metadata,
      specialLevels: {},
      generatedAt: FIXED_PARITY_FIXTURE_END_TIMESTAMP,
    });
    const rankedLevel = [
      ...projection.rankedOutput.supports,
      ...projection.rankedOutput.resistances,
    ].find((level) => level.id === rawCandidate.id);

    if (rankedLevel && rankedLevel.touches.length > 0) {
      selected = { rawCandidate, rankedLevel };
      break;
    }
  }

  assert.ok(selected, "fixture must include a higher-timeframe raw candidate with touch evidence");

  const { rawCandidate, rankedLevel } = selected;
  const sourceCandles = diagnostics.candlesByTimeframe[rawCandidate.timeframe].candles;
  const sourceTimestamps = new Set(sourceCandles.map((candle) => candle.timestamp));

  assert.equal(rankedLevel.symbol, rawCandidate.symbol);
  assert.equal(rankedLevel.type, rawCandidate.kind);
  assert.equal(rankedLevel.price, rawCandidate.price);
  assert.deepEqual(rankedLevel.sourceTimeframes, [rawCandidate.timeframe]);
  assert.deepEqual(rankedLevel.originKinds, [rawCandidate.sourceType]);
  assert.ok(rawCandidate.firstTimestamp <= rawCandidate.lastTimestamp);
  assert.ok(sourceTimestamps.has(rawCandidate.firstTimestamp));
  assert.ok(sourceTimestamps.has(rawCandidate.lastTimestamp));
  assert.ok(rankedLevel.touches.length > 0);

  for (const touch of rankedLevel.touches) {
    assert.ok(sourceTimestamps.has(touch.candleTimestamp));
  }
});

test("runtime parity diagnostic bucket mapping covers daily 4h 5m and mixed source timeframes", () => {
  assert.equal(diagnosticRuntimeBucketForSourceTimeframes(["daily"]), "major");
  assert.equal(diagnosticRuntimeBucketForSourceTimeframes(["4h"]), "intermediate");
  assert.equal(diagnosticRuntimeBucketForSourceTimeframes(["5m"]), "intraday");
  assert.equal(diagnosticRuntimeBucketForSourceTimeframes(["4h", "5m"]), "major");
  assert.equal(diagnosticRuntimeBucketForSourceTimeframes(["daily", "5m"]), "major");
});

test("runtime parity diagnostics expose projected nearest levels beside the old baseline", async () => {
  const { report } = await getNearRuntimeParityStageDiagnostics();

  assert.equal(report.nearest.support.oldPrice, 4.5284);
  assert.equal(report.nearest.resistance.oldPrice, 4.6957);
  assert.ok(report.nearest.support.newPrice);
  assert.ok(report.nearest.resistance.newPrice);
  assert.ok(report.nearest.support.distancePct !== null);
  assert.ok(report.nearest.resistance.distancePct !== null);
});

test("runtime parity diagnostics remove extension rows now owned by surfaced buckets", async () => {
  const { report } = await getNearRuntimeParityStageDiagnostics();

  assert.equal(report.oldExtensionLevels.total, 5);
  assert.equal(report.oldExtensionLevels.support.count, 3);
  assert.equal(report.oldExtensionLevels.resistance.count, 2);
  assert.ok(report.projectedNewExtensionLevels.total <= report.oldExtensionLevels.total);
  const surfacedIds = new Set(
    Object.values(report.projectedNewBuckets)
      .flatMap((bucket) => bucket.identities.map((identity) => identity.id)),
  );
  for (const extension of [
    ...report.projectedNewExtensionLevels.support.identities,
    ...report.projectedNewExtensionLevels.resistance.identities,
  ]) {
    assert.equal(surfacedIds.has(extension.id), false);
  }
});

test("new projected runtime output keeps only non-duplicate rows from the old extension ladder", async () => {
  const { defaultOutput, oldOutput, newOutput } = await generateRuntimeFixtureOutputs("NEAR");

  assert.deepEqual(flattenOutput(defaultOutput), flattenOutput(oldOutput));
  const oldExtensionIds = new Set(extensionZones(oldOutput).map((zone) => zone.id));
  const surfacedIds = new Set(surfacedDisplayZones(newOutput).map((zone) => zone.id));
  for (const zone of extensionZones(newOutput)) {
    assert.equal(oldExtensionIds.has(zone.id), true);
    assert.equal(surfacedIds.has(zone.id), false);
  }
});

test("new projected runtime output owns surfaced buckets while old output remains unchanged", async () => {
  const { defaultOutput, oldOutput, newOutput } = await generateRuntimeFixtureOutputs("NEAR");

  assert.deepEqual(flattenOutput(defaultOutput), flattenOutput(oldOutput));
  assert.notDeepEqual(bucketCounts(newOutput), bucketCounts(oldOutput));
  assert.notDeepEqual(flattenOutput(newOutput), flattenOutput(oldOutput));
  assert.ok(surfacedDisplayZones(newOutput).length <= 24);
});

test("new projected runtime output carries enrichedAnalysis on its owned surfaced rows", async () => {
  const { defaultOutput, oldOutput, newOutput } = await generateRuntimeFixtureOutputs("NEAR");
  const enriched = enrichedRuntimeZones(newOutput);
  const unenriched = unenrichedRuntimeZones(newOutput);

  assert.equal(enrichedRuntimeZones(defaultOutput).length, 0);
  assert.notDeepEqual(flattenOutput(newOutput), flattenOutput(oldOutput));
  assert.ok(surfacedDisplayZones(newOutput).every((zone) => zone.enrichedAnalysis));

  assert.ok(enriched.length > 0);

  for (const zone of enriched) {
    assertEnrichedAnalysisCompatible(zone.enrichedAnalysis!);
  }

  for (const zone of unenriched) {
    assertFinalLevelZoneCompatible(zone);
  }

  assert.ok(unenriched.every((zone) => zone.isExtension));
});

test("projected extension levels stay distinct from surfaced display levels and remain spaced", async () => {
  const { newOutput } = await getNearRuntimeParityStageDiagnostics();
  const surfaced = surfacedDisplayZones(newOutput);
  const surfacedDisplayKeys = new Set(surfaced.map(displayPriceKey));
  for (const extension of extensionZones(newOutput)) {
    assert.equal(surfacedDisplayKeys.has(displayPriceKey(extension)), false);
  }

  assertExtensionSpacing(newOutput.extensionLevels.support, 0.01);
  assertExtensionSpacing(newOutput.extensionLevels.resistance, 0.01);
});

test("projected extension ladder preserves practical forward-planning coverage from the old path", async () => {
  const { oldOutput, newOutput } = await getNearRuntimeParityStageDiagnostics();
  const referencePrice = oldOutput.metadata.referencePrice;
  assert.ok(referencePrice);

  const highestResistance = Math.max(
    ...[
      ...surfacedDisplayZones(newOutput).filter((zone) => zone.kind === "resistance"),
      ...newOutput.extensionLevels.resistance,
    ].map((zone) => zone.representativePrice),
  );
  const lowestSupport = Math.min(
    ...[
      ...surfacedDisplayZones(newOutput).filter((zone) => zone.kind === "support"),
      ...newOutput.extensionLevels.support,
    ].map((zone) => zone.representativePrice),
  );
  const upsideCoveragePct = (highestResistance - referencePrice) / referencePrice;
  const downsideCoveragePct = (referencePrice - lowestSupport) / referencePrice;

  assert.ok(upsideCoveragePct >= 0.30);
  assert.ok(downsideCoveragePct >= 0.20);
  const oldExtensionIds = new Set(extensionZones(oldOutput).map((zone) => zone.id));
  assert.ok(extensionZones(newOutput).every((zone) => oldExtensionIds.has(zone.id)));
});

test("compareActivePath old returns old output while exposing comparison data", async () => {
  const { oldOutput, compareOldOutput, compareOldLogs } = await generateRuntimeFixtureOutputs("CMPO");
  const log = compareOldLogs[0];

  assert.deepEqual(flattenOutput(compareOldOutput), flattenOutput(oldOutput));
  assert.equal(enrichedRuntimeZones(compareOldOutput).length, 0);
  assertLevelEngineOutputCompatible(compareOldOutput);
  assert.equal(compareOldLogs.length, 1);
  assert.ok(log);
  assert.equal(log.type, "level_runtime_compare");
  assert.equal(log.activePath, "old");
  assert.equal(log.alternatePath, "new");
  assert.equal(typeof log.activeVisibleCounts.support, "number");
  assert.equal(typeof log.activeVisibleCounts.resistance, "number");
  assert.equal(typeof log.alternateVisibleCounts.support, "number");
  assert.equal(typeof log.alternateVisibleCounts.resistance, "number");
  assert.ok(Array.isArray(log.notableDifferences));
  assert.ok("topSupportExplanation" in log.newPathContext);
  assert.ok("topResistanceExplanation" in log.newPathContext);
});

test("compareActivePath new returns new projected output without changing public output shape", async () => {
  const { oldOutput, newOutput, compareNewOutput, compareNewLogs } = await generateRuntimeFixtureOutputs("CMPN");
  const log = compareNewLogs[0];

  assert.deepEqual(flattenOutput(compareNewOutput), flattenOutput(newOutput));
  assert.deepEqual(enrichedRuntimeZones(compareNewOutput).length, enrichedRuntimeZones(newOutput).length);
  assert.deepEqual(Object.keys(compareNewOutput).sort(), Object.keys(oldOutput).sort());
  assertLevelEngineOutputCompatible(compareNewOutput);
  assert.equal(compareNewLogs.length, 1);
  assert.ok(log);
  assert.equal(log.activePath, "new");
  assert.equal(log.alternatePath, "old");
});

test("new projection can reuse low-price runner extension ladder for practical coverage", () => {
  const oldOutput = fixtureOutput("LOW", {
    intradayResistance: [
      fixtureZone({ id: "LOW-intraday-resistance", symbol: "LOW", kind: "resistance", price: 0.33 }),
    ],
    extensionLevels: {
      support: [],
      resistance: [
        fixtureZone({ id: "LOW-old-extension-1", symbol: "LOW", kind: "resistance", price: 0.36, isExtension: true }),
        fixtureZone({ id: "LOW-old-extension-2", symbol: "LOW", kind: "resistance", price: 0.39, isExtension: true }),
        fixtureZone({ id: "LOW-old-extension-3", symbol: "LOW", kind: "resistance", price: 0.42, isExtension: true }),
      ],
    },
  });
  const projection = buildNewRuntimeCompatibleLevelOutput({
    symbol: "LOW",
    rawCandidates: [],
    levelCandidates: [],
    candlesByTimeframe: {},
    metadata: oldOutput.metadata,
    specialLevels: {},
    legacyExtensionLevels: oldOutput.extensionLevels,
    generatedAt: 1,
  });
  const output = projection.output;
  const referencePrice = oldOutput.metadata.referencePrice;
  assert.ok(referencePrice);

  assert.equal(output.extensionLevels.support.length, 0);
  assert.equal(output.extensionLevels.resistance.length, 3);
  assert.deepEqual(
    output.extensionLevels.resistance.map((zone) => zoneIdentity(zone, "resistance")),
    oldOutput.extensionLevels.resistance.map((zone) => zoneIdentity(zone, "resistance")),
  );
  assert.ok(
    (Math.max(...output.extensionLevels.resistance.map((zone) => zone.representativePrice)) -
      referencePrice) /
      referencePrice >=
      0.35,
  );
  assert.ok(
    projection.mappingNotes.some((note) =>
      note.includes("reuse the legacy extension ladder supplied by the old runtime path"),
    ),
  );
});

test("new projected strength-label mapping is deterministic and documented", async () => {
  const shadowCase = buildDefaultSurfacedShadowCases().find(
    (item) => item.caseId === "broken-level-exclusion",
  );
  assert.ok(shadowCase);
  const candlesByTimeframe = await fetchCandlesByTimeframe(shadowCase.symbol);
  const projectionInput = {
    symbol: shadowCase.symbol,
    rawCandidates: shadowCase.rawCandidates ?? [],
    levelCandidates: shadowCase.newCandidates,
    candlesByTimeframe: {
      daily: candlesByTimeframe.daily.candles,
      "4h": candlesByTimeframe["4h"].candles,
      "5m": candlesByTimeframe["5m"].candles,
    },
    metadata: {
      providerByTimeframe: {
        daily: "stub",
        "4h": "stub",
        "5m": "stub",
      },
      dataQualityFlags: [],
      freshness: "fresh" as const,
      referencePrice: shadowCase.currentPrice,
    },
    specialLevels: {},
    generatedAt: 123,
  };

  const firstProjection = buildNewRuntimeCompatibleLevelOutput(projectionInput);
  const secondProjection = buildNewRuntimeCompatibleLevelOutput(projectionInput);
  const firstLabels = allRuntimeZones(firstProjection.output).map((zone) => `${zone.id}:${zone.strengthLabel}`);
  const secondLabels = allRuntimeZones(secondProjection.output).map((zone) => `${zone.id}:${zone.strengthLabel}`);

  assert.deepEqual(firstLabels, secondLabels);
  assert.ok(firstLabels.length > 0);
  assert.ok(
    firstProjection.mappingNotes.some((note) =>
      note.includes("Runtime buckets are owned by the projected surfaced selection"),
    ),
  );
});

test("LevelEngineOutput JSON serialization and LevelStore storage remain compatible for old and new outputs", async () => {
  const { oldOutput, newOutput } = await generateRuntimeFixtureOutputs("STOR");

  assert.ok(enrichedRuntimeZones(newOutput).length > 0);

  for (const output of [oldOutput, newOutput]) {
    const serialized = JSON.stringify(output);
    const parsed = JSON.parse(serialized) as LevelEngineOutput;
    const store = new LevelStore();

    assertLevelEngineOutputCompatible(parsed);
    store.setLevels(parsed);
    assert.deepEqual(store.getLevels(parsed.symbol), parsed);
  }
});
