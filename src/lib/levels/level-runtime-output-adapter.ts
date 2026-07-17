// 2026-04-18 08:40 AM America/Toronto
// Runtime-compatible projection from the new structural ranking + surfaced adapter path into the legacy bucketed output contract.

import type { Candle, CandleTimeframe } from "../market-data/candle-types.js";
import { rankLevels } from "./level-ranking.js";
import { normalizeSurfacedSelectionOutput, type ComparablePathOutput } from "./level-ranking-comparison.js";
import type { LevelScoreConfig } from "./level-score-config.js";
import { LEVEL_SCORE_CONFIG } from "./level-score-config.js";
import type { LevelSurfacedSelectionConfig } from "./level-surfaced-selection-config.js";
import { LEVEL_SURFACED_SELECTION_CONFIG } from "./level-surfaced-selection-config.js";
import {
  selectSurfacedLevels,
  type SurfacedLevelSelection,
  type SurfacedSelectionResult,
} from "./level-surfaced-selection.js";
import type {
  EnrichedLevelAnalysis,
  FinalLevelZone,
  LevelCandidate,
  LevelDataFreshness,
  LevelEngineOutput,
  LevelScoringContext,
  RawLevelCandidate,
  RawLevelCandidateSourceType,
  RankedLevel,
  RankedLevelsOutput,
  SourceTimeframe,
} from "./level-types.js";
import {
  buildZoneBounds,
  clamp,
  isPriceInsideZone,
  priceDistancePct,
  zonesOverlap,
} from "./level-zone-utils.js";

export type NewRuntimeCompatibleLevelOutput = {
  output: LevelEngineOutput;
  rankedOutput: RankedLevelsOutput;
  surfacedSelection: SurfacedSelectionResult;
  comparableOutput: ComparablePathOutput;
  mappingNotes: string[];
  enrichmentDiagnostics: EnrichmentDiagnostics;
};

export type EnrichmentDiagnostics = {
  totalRuntimeZones: number;
  enrichedZones: number;
  unenrichedZones: number;
  unmatchedRuntimeZoneIds: string[];
  unmatchedReason: "no_safe_ranked_level_match" | null;
};

export type LegacyRuntimeBuckets = Pick<
  LevelEngineOutput,
  | "majorSupport"
  | "majorResistance"
  | "intermediateSupport"
  | "intermediateResistance"
  | "intradaySupport"
  | "intradayResistance"
>;

export type LevelRuntimeOutputAdapterInput = {
  symbol: string;
  rawCandidates: RawLevelCandidate[];
  candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>>;
  metadata: LevelEngineOutput["metadata"];
  specialLevels: LevelEngineOutput["specialLevels"];
  legacyRuntimeBuckets?: LegacyRuntimeBuckets;
  legacyExtensionLevels?: LevelEngineOutput["extensionLevels"];
  /**
   * Selects the owner of the visible runtime buckets. The projected surfaced
   * path owns normal new-mode output; legacy ownership is retained only for
   * explicit parity diagnostics and requires legacyRuntimeBuckets.
   */
  runtimeBucketOwnership?: "surfaced" | "legacy";
  levelCandidates?: LevelCandidate[];
  generatedAt?: number;
  scoreConfig?: LevelScoreConfig;
  surfacedSelectionConfig?: LevelSurfacedSelectionConfig;
};

type RuntimeBucket = "major" | "intermediate" | "intraday";
type EnrichmentAccumulator = {
  unmatchedRuntimeZoneIds: string[];
};

const RAW_LEVEL_SOURCE_TYPES: readonly RawLevelCandidateSourceType[] = [
  "swing_high",
  "swing_low",
  "premarket_high",
  "premarket_low",
  "opening_range_high",
  "opening_range_low",
  "previous_day_high",
  "previous_day_low",
  "previous_day_close",
  "current_session_high",
  "current_session_low",
] as const;

function normalizeRuntimeSourceTimeframe(timeframe: SourceTimeframe): CandleTimeframe {
  if (timeframe === "daily" || timeframe === "4h" || timeframe === "5m") {
    return timeframe;
  }

  return "5m";
}

function deriveCurrentTimeframe(
  candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>>,
): SourceTimeframe {
  if ((candlesByTimeframe["5m"]?.length ?? 0) > 0) {
    return "5m";
  }

  if ((candlesByTimeframe["4h"]?.length ?? 0) > 0) {
    return "4h";
  }

  return "daily";
}

function deriveLatestTimestamp(
  candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>>,
): number {
  return Math.max(
    0,
    ...Object.values(candlesByTimeframe).map((candles) => candles?.at(-1)?.timestamp ?? 0),
  );
}

function buildScoringContext(
  symbol: string,
  candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>>,
  metadata: LevelEngineOutput["metadata"],
): LevelScoringContext {
  const currentTimeframe = deriveCurrentTimeframe(candlesByTimeframe);
  const recentCandles =
    candlesByTimeframe[currentTimeframe as CandleTimeframe] ??
    candlesByTimeframe["5m"] ??
    candlesByTimeframe["4h"] ??
    candlesByTimeframe.daily ??
    [];

  return {
    symbol: symbol.toUpperCase(),
    currentPrice: metadata.referencePrice ?? 0,
    latestTimestamp: deriveLatestTimestamp(candlesByTimeframe),
    recentCandles,
    currentTimeframe,
  };
}

function convertRawCandidateToLevelCandidate(
  candidate: RawLevelCandidate,
  candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>>,
): LevelCandidate {
  const zoneBounds = buildZoneBounds(candidate.price);

  return {
    id: candidate.id,
    symbol: candidate.symbol,
    type: candidate.kind === "support" ? "support" : "resistance",
    price: candidate.price,
    zoneLow: zoneBounds.zoneLow,
    zoneHigh: zoneBounds.zoneHigh,
    sourceTimeframes: [candidate.timeframe],
    originKinds: [candidate.sourceType],
    marketDataProvenance: candidate.marketDataProvenance,
    analysisCandles: candlesByTimeframe[candidate.timeframe],
  };
}

function bucketForSurfacedLevel(level: SurfacedLevelSelection): RuntimeBucket {
  const normalized = [...new Set(level.sourceTimeframes.map(normalizeRuntimeSourceTimeframe))];
  if (normalized.includes("daily") || normalized.length > 1) {
    return "major";
  }
  if (normalized.includes("4h")) {
    return "intermediate";
  }
  return "intraday";
}

function deriveStructuralStrengthLabel(score: number): FinalLevelZone["strengthLabel"] {
  if (score >= 80) {
    return "major";
  }
  if (score >= 64) {
    return "strong";
  }
  if (score >= 46) {
    return "moderate";
  }
  return "weak";
}

function deriveFreshness(level: SurfacedLevelSelection): LevelDataFreshness {
  if (level.barsSinceLastReaction <= 8) {
    return "fresh";
  }
  if (level.barsSinceLastReaction <= 30) {
    return "aging";
  }
  return "stale";
}

function deriveTimeframeBias(level: SurfacedLevelSelection): FinalLevelZone["timeframeBias"] {
  const normalized = [...new Set(level.sourceTimeframes.map(normalizeRuntimeSourceTimeframe))];
  if (normalized.length !== 1) {
    return "mixed";
  }
  return normalized[0]!;
}

function deriveSourceTypes(level: SurfacedLevelSelection): RawLevelCandidateSourceType[] {
  const sourceTypes = level.originKinds.filter((origin): origin is RawLevelCandidateSourceType =>
    (RAW_LEVEL_SOURCE_TYPES as readonly string[]).includes(origin),
  );

  if (sourceTypes.length > 0) {
    return [...new Set(sourceTypes)];
  }

  return [level.type === "support" ? "swing_low" : "swing_high"];
}

function deriveReactionScore(level: SurfacedLevelSelection): number {
  return clamp(level.scoreBreakdown.reactionQualityScore / 15, 0, 1);
}

function deriveRejectionScore(level: SurfacedLevelSelection): number {
  return clamp(
    (level.rejectionCount + level.failedBreakCount + level.reclaimCount) /
      Math.max(level.touchCount, 1),
    0,
    1,
  );
}

function deriveDisplacementScore(level: SurfacedLevelSelection): number {
  return clamp(level.scoreBreakdown.reactionMagnitudeScore / 10, 0, 1);
}

function deriveSessionSignificanceScore(level: SurfacedLevelSelection): number {
  return clamp(level.scoreBreakdown.volumeScore / 10, 0, 1);
}

function deriveFollowThroughScore(level: SurfacedLevelSelection): number {
  return clamp(level.averageReactionMovePct / 0.08, 0, 1);
}

function deriveFirstTimestamp(level: SurfacedLevelSelection, generatedAt: number): number {
  const timestamps = level.touches.map((touch) => touch.candleTimestamp);
  return timestamps.length > 0 ? Math.min(...timestamps) : generatedAt;
}

function deriveLastTimestamp(level: SurfacedLevelSelection, generatedAt: number): number {
  const timestamps = level.touches.map((touch) => touch.candleTimestamp);
  return timestamps.length > 0 ? Math.max(...timestamps) : generatedAt;
}

function toEnrichedAnalysis(level: RankedLevel): EnrichedLevelAnalysis {
  return {
    source: "rankLevels",
    structuralStrengthScore: level.structuralStrengthScore,
    activeRelevanceScore: level.activeRelevanceScore,
    finalLevelScore: level.finalLevelScore,
    confidence: level.confidence,
    state: level.state,
    rank: level.rank,
    explanation: level.explanation,
    scoreBreakdown: { ...level.scoreBreakdown },
    touchStats: {
      touchCount: level.touchCount,
      meaningfulTouchCount: level.meaningfulTouchCount,
      rejectionCount: level.rejectionCount,
      failedBreakCount: level.failedBreakCount,
      cleanBreakCount: level.cleanBreakCount,
      reclaimCount: level.reclaimCount,
      strongestReactionMovePct: level.strongestReactionMovePct,
      averageReactionMovePct: level.averageReactionMovePct,
      bestVolumeRatio: level.bestVolumeRatio,
      averageVolumeRatio: level.averageVolumeRatio,
      cleanlinessStdDevPct: level.cleanlinessStdDevPct,
      barsSinceLastReaction: level.barsSinceLastReaction,
      ageInBars: level.ageInBars,
    },
  };
}

function toRuntimeZone(
  level: SurfacedLevelSelection,
  generatedAt: number,
  legacyLabelZones: FinalLevelZone[] = [],
): FinalLevelZone {
  const legacyLabelMatch = findLegacyRuntimeLabelMatch(level, legacyLabelZones);
  const strengthScore =
    legacyLabelMatch?.strengthScore ?? Number(level.structuralStrengthScore.toFixed(2));
  const timeframeSources = [...new Set(level.sourceTimeframes.map(normalizeRuntimeSourceTimeframe))];

  return {
    id: level.id,
    symbol: level.symbol,
    kind: level.type,
    timeframeBias: deriveTimeframeBias(level),
    zoneLow: level.zoneLow,
    zoneHigh: level.zoneHigh,
    representativePrice: level.price,
    strengthScore,
    strengthLabel:
      legacyLabelMatch?.strengthLabel ?? deriveStructuralStrengthLabel(strengthScore),
    touchCount: level.touchCount,
    confluenceCount: Math.max(timeframeSources.length + level.roleFlipCount, 1),
    sourceTypes: deriveSourceTypes(level),
    timeframeSources,
    reactionQualityScore: deriveReactionScore(level),
    rejectionScore: deriveRejectionScore(level),
    displacementScore: deriveDisplacementScore(level),
    sessionSignificanceScore: deriveSessionSignificanceScore(level),
    followThroughScore: deriveFollowThroughScore(level),
    gapContinuationScore: undefined,
    sourceEvidenceCount: Math.max(level.meaningfulTouchCount, timeframeSources.length),
    firstTimestamp: deriveFirstTimestamp(level, generatedAt),
    lastTimestamp: deriveLastTimestamp(level, generatedAt),
    marketDataProvenance: level.marketDataProvenance,
    sessionDate: undefined,
    isExtension: level.selectionCategory === "anchor",
    freshness: deriveFreshness(level),
    notes: [
      "runtime_compatibility_adapter:new_surfaced_selection",
      legacyLabelMatch
        ? `legacy_strength_label_match=${legacyLabelMatch.id}`
        : "strength_label_source=projected_structural_strength",
      `state=${level.state}`,
      `durability=${level.durabilityLabel ?? "tested"}`,
      `confidence=${level.confidence.toFixed(2)}`,
      level.surfacedSelectionExplanation,
      ...level.surfacedSelectionNotes,
    ],
    enrichedAnalysis: toEnrichedAnalysis(level),
  };
}

function cloneEnrichedAnalysis(
  enrichedAnalysis: EnrichedLevelAnalysis | undefined,
): EnrichedLevelAnalysis | undefined {
  if (!enrichedAnalysis) {
    return undefined;
  }

  return {
    ...enrichedAnalysis,
    scoreBreakdown: { ...enrichedAnalysis.scoreBreakdown },
    touchStats: { ...enrichedAnalysis.touchStats },
  };
}

function cloneRuntimeZone(zone: FinalLevelZone): FinalLevelZone {
  return {
    ...zone,
    sourceTypes: [...zone.sourceTypes],
    timeframeSources: [...zone.timeframeSources],
    notes: [...zone.notes],
    enrichedAnalysis: cloneEnrichedAnalysis(zone.enrichedAnalysis),
  };
}

function cloneExtensionLevels(
  extensionLevels: LevelEngineOutput["extensionLevels"],
  rankedLevels: RankedLevel[],
  accumulator: EnrichmentAccumulator,
  surfacedRuntimeZones: FinalLevelZone[],
): LevelEngineOutput["extensionLevels"] {
  const overlapsSurfacedRow = (extension: FinalLevelZone): boolean =>
    surfacedRuntimeZones.some((surfaced) => {
      if (extension.kind !== surfaced.kind) {
        return false;
      }
      const extensionWidth = Math.abs(extension.zoneHigh - extension.zoneLow);
      const surfacedWidth = Math.abs(surfaced.zoneHigh - surfaced.zoneLow);
      const tolerance = Math.max(
        Math.abs(extension.representativePrice) * 0.0025,
        extensionWidth,
        surfacedWidth,
        0.0001,
      );
      return (
        extension.zoneLow <= surfaced.zoneHigh + tolerance &&
        surfaced.zoneLow <= extension.zoneHigh + tolerance &&
        Math.abs(extension.representativePrice - surfaced.representativePrice) <= tolerance
      );
    });

  return {
    support: extensionLevels.support
      .filter((zone) => !overlapsSurfacedRow(zone))
      .map((zone) => cloneRuntimeZoneWithEnrichment(zone, rankedLevels, accumulator)),
    resistance: extensionLevels.resistance
      .filter((zone) => !overlapsSurfacedRow(zone))
      .map((zone) => cloneRuntimeZoneWithEnrichment(zone, rankedLevels, accumulator)),
  };
}

function normalizedTimeframeSet(timeframes: readonly SourceTimeframe[]): Set<CandleTimeframe> {
  return new Set(timeframes.map(normalizeRuntimeSourceTimeframe));
}

function levelSourceContextMatches(zone: FinalLevelZone, level: RankedLevel): boolean {
  const levelTimeframes = normalizedTimeframeSet(level.sourceTimeframes);
  const timeframeMatches = zone.timeframeSources.some((timeframe) =>
    levelTimeframes.has(timeframe),
  );
  const originMatches = level.originKinds.some((origin) =>
    (zone.sourceTypes as readonly string[]).includes(origin),
  );

  return timeframeMatches && originMatches;
}

function levelPriceMatches(zone: FinalLevelZone, level: RankedLevel): boolean {
  const runtimeZone = {
    zoneLow: Math.min(zone.zoneLow, zone.zoneHigh),
    zoneHigh: Math.max(zone.zoneLow, zone.zoneHigh),
  };
  const rankedZone = {
    zoneLow: Math.min(level.zoneLow, level.zoneHigh),
    zoneHigh: Math.max(level.zoneLow, level.zoneHigh),
  };

  return (
    isPriceInsideZone(level.price, runtimeZone.zoneLow, runtimeZone.zoneHigh) ||
    isPriceInsideZone(zone.representativePrice, rankedZone.zoneLow, rankedZone.zoneHigh) ||
    zonesOverlap(runtimeZone, rankedZone) ||
    priceDistancePct(zone.representativePrice, level.price) <= 0.006
  );
}

function findEnrichmentMatch(
  zone: FinalLevelZone,
  rankedLevels: RankedLevel[],
): RankedLevel | null {
  const matches = rankedLevels
    .filter((level) => level.symbol === zone.symbol)
    .filter((level) => level.type === zone.kind)
    .filter((level) => levelSourceContextMatches(zone, level))
    .filter((level) => levelPriceMatches(zone, level))
    .sort((left, right) => {
      const leftInside = isPriceInsideZone(
        left.price,
        Math.min(zone.zoneLow, zone.zoneHigh),
        Math.max(zone.zoneLow, zone.zoneHigh),
      );
      const rightInside = isPriceInsideZone(
        right.price,
        Math.min(zone.zoneLow, zone.zoneHigh),
        Math.max(zone.zoneLow, zone.zoneHigh),
      );

      return (
        Number(rightInside) - Number(leftInside) ||
        Number(right.isClusterRepresentative) - Number(left.isClusterRepresentative) ||
        left.rank - right.rank ||
        priceDistancePct(zone.representativePrice, left.price) -
          priceDistancePct(zone.representativePrice, right.price)
      );
    });

  return matches[0] ?? null;
}

function flattenLegacyRuntimeBuckets(
  runtimeBuckets: LegacyRuntimeBuckets | undefined,
): FinalLevelZone[] {
  if (!runtimeBuckets) {
    return [];
  }

  return [
    ...runtimeBuckets.majorSupport,
    ...runtimeBuckets.majorResistance,
    ...runtimeBuckets.intermediateSupport,
    ...runtimeBuckets.intermediateResistance,
    ...runtimeBuckets.intradaySupport,
    ...runtimeBuckets.intradayResistance,
  ];
}

function findLegacyRuntimeLabelMatch(
  level: RankedLevel,
  legacyZones: FinalLevelZone[],
): FinalLevelZone | null {
  const matches = legacyZones
    .filter((zone) => zone.symbol === level.symbol)
    .filter((zone) => zone.kind === level.type)
    .filter((zone) => levelSourceContextMatches(zone, level))
    .filter((zone) => levelPriceMatches(zone, level))
    .sort((left, right) => {
      const leftInside = isPriceInsideZone(
        level.price,
        Math.min(left.zoneLow, left.zoneHigh),
        Math.max(left.zoneLow, left.zoneHigh),
      );
      const rightInside = isPriceInsideZone(
        level.price,
        Math.min(right.zoneLow, right.zoneHigh),
        Math.max(right.zoneLow, right.zoneHigh),
      );

      return (
        Number(rightInside) - Number(leftInside) ||
        priceDistancePct(level.price, left.representativePrice) -
          priceDistancePct(level.price, right.representativePrice)
      );
    });

  return matches[0] ?? null;
}

function cloneRuntimeZoneWithEnrichment(
  zone: FinalLevelZone,
  rankedLevels: RankedLevel[],
  accumulator: EnrichmentAccumulator,
): FinalLevelZone {
  const cloned = cloneRuntimeZone(zone);
  const match = findEnrichmentMatch(cloned, rankedLevels);

  if (!match) {
    accumulator.unmatchedRuntimeZoneIds.push(cloned.id);
    return cloned;
  }

  return {
    ...cloned,
    enrichedAnalysis: toEnrichedAnalysis(match),
  };
}

function cloneRuntimeZones(
  zones: FinalLevelZone[],
  rankedLevels: RankedLevel[],
  accumulator: EnrichmentAccumulator,
): FinalLevelZone[] {
  return zones.map((zone) => cloneRuntimeZoneWithEnrichment(zone, rankedLevels, accumulator));
}

function cloneLegacyRuntimeBuckets(
  runtimeBuckets: LegacyRuntimeBuckets,
  rankedLevels: RankedLevel[],
  accumulator: EnrichmentAccumulator,
): LegacyRuntimeBuckets {
  return {
    majorSupport: cloneRuntimeZones(runtimeBuckets.majorSupport, rankedLevels, accumulator),
    majorResistance: cloneRuntimeZones(runtimeBuckets.majorResistance, rankedLevels, accumulator),
    intermediateSupport: cloneRuntimeZones(runtimeBuckets.intermediateSupport, rankedLevels, accumulator),
    intermediateResistance: cloneRuntimeZones(runtimeBuckets.intermediateResistance, rankedLevels, accumulator),
    intradaySupport: cloneRuntimeZones(runtimeBuckets.intradaySupport, rankedLevels, accumulator),
    intradayResistance: cloneRuntimeZones(runtimeBuckets.intradayResistance, rankedLevels, accumulator),
  };
}

function runtimeZones(output: LevelEngineOutput): FinalLevelZone[] {
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

function buildEnrichmentDiagnostics(
  output: LevelEngineOutput,
  accumulator: EnrichmentAccumulator,
): EnrichmentDiagnostics {
  const zones = runtimeZones(output);
  const enrichedZones = zones.filter((zone) => zone.enrichedAnalysis).length;

  return {
    totalRuntimeZones: zones.length,
    enrichedZones,
    unenrichedZones: zones.length - enrichedZones,
    unmatchedRuntimeZoneIds: [...accumulator.unmatchedRuntimeZoneIds],
    unmatchedReason:
      accumulator.unmatchedRuntimeZoneIds.length > 0 ? "no_safe_ranked_level_match" : null,
  };
}

function pushBucketedZone(
  buckets: Record<RuntimeBucket, FinalLevelZone[]>,
  level: SurfacedLevelSelection,
  generatedAt: number,
  legacyLabelZones: FinalLevelZone[],
): void {
  buckets[bucketForSurfacedLevel(level)].push(
    toRuntimeZone(level, generatedAt, legacyLabelZones),
  );
}

function buildActionableBuckets(
  levels: SurfacedLevelSelection[],
  generatedAt: number,
  legacyLabelZones: FinalLevelZone[],
): Record<RuntimeBucket, FinalLevelZone[]> {
  const buckets: Record<RuntimeBucket, FinalLevelZone[]> = {
    major: [],
    intermediate: [],
    intraday: [],
  };

  for (const level of levels) {
    pushBucketedZone(buckets, level, generatedAt, legacyLabelZones);
  }

  return buckets;
}

export function buildNewRuntimeCompatibleLevelOutput(
  input: LevelRuntimeOutputAdapterInput,
): NewRuntimeCompatibleLevelOutput {
  const symbol = input.symbol.toUpperCase();
  const scoreConfig = input.scoreConfig ?? LEVEL_SCORE_CONFIG;
  const surfacedSelectionConfig =
    input.surfacedSelectionConfig ?? LEVEL_SURFACED_SELECTION_CONFIG;
  const generatedAt = input.generatedAt ?? Date.now();
  const levelCandidates =
    input.levelCandidates ??
    input.rawCandidates.map((candidate) =>
      convertRawCandidateToLevelCandidate(candidate, input.candlesByTimeframe),
    );
  const rankedOutput = rankLevels(
    levelCandidates,
    buildScoringContext(symbol, input.candlesByTimeframe, input.metadata),
    scoreConfig,
  );
  const rankedLevels = [
    ...rankedOutput.supports,
    ...rankedOutput.resistances,
  ];
  const enrichmentAccumulator: EnrichmentAccumulator = {
    unmatchedRuntimeZoneIds: [],
  };
  const surfacedSelection = selectSurfacedLevels(rankedOutput, surfacedSelectionConfig);
  const legacyLabelZones = flattenLegacyRuntimeBuckets(input.legacyRuntimeBuckets);
  const supportBuckets = buildActionableBuckets(
    surfacedSelection.surfacedSupports,
    generatedAt,
    legacyLabelZones,
  );
  const resistanceBuckets = buildActionableBuckets(
    surfacedSelection.surfacedResistances,
    generatedAt,
    legacyLabelZones,
  );
  const extensionSupport = surfacedSelection.deeperSupportAnchor
    ? [toRuntimeZone(surfacedSelection.deeperSupportAnchor, generatedAt, legacyLabelZones)]
    : [];
  const extensionResistance = surfacedSelection.deeperResistanceAnchor
    ? [toRuntimeZone(surfacedSelection.deeperResistanceAnchor, generatedAt, legacyLabelZones)]
    : [];
  const runtimeBucketOwnership = input.runtimeBucketOwnership ??
    (input.legacyRuntimeBuckets ? "legacy" : "surfaced");
  if (runtimeBucketOwnership === "legacy" && !input.legacyRuntimeBuckets) {
    throw new Error("legacy runtime bucket ownership requires legacyRuntimeBuckets.");
  }
  const runtimeBuckets = runtimeBucketOwnership === "legacy"
    ? cloneLegacyRuntimeBuckets(input.legacyRuntimeBuckets!, rankedLevels, enrichmentAccumulator)
    : {
        majorSupport: supportBuckets.major,
        majorResistance: resistanceBuckets.major,
        intermediateSupport: supportBuckets.intermediate,
        intermediateResistance: resistanceBuckets.intermediate,
        intradaySupport: supportBuckets.intraday,
        intradayResistance: resistanceBuckets.intraday,
      };
  const surfacedRuntimeZones = [
    ...runtimeBuckets.majorSupport,
    ...runtimeBuckets.majorResistance,
    ...runtimeBuckets.intermediateSupport,
    ...runtimeBuckets.intermediateResistance,
    ...runtimeBuckets.intradaySupport,
    ...runtimeBuckets.intradayResistance,
  ];
  const extensionLevels = input.legacyExtensionLevels
    ? cloneExtensionLevels(
        input.legacyExtensionLevels,
        rankedLevels,
        enrichmentAccumulator,
        surfacedRuntimeZones,
      )
    : {
        support: extensionSupport,
        resistance: extensionResistance,
      };

  const output: LevelEngineOutput = {
    symbol,
    generatedAt,
    metadata: input.metadata,
    majorSupport: runtimeBuckets.majorSupport,
    majorResistance: runtimeBuckets.majorResistance,
    intermediateSupport: runtimeBuckets.intermediateSupport,
    intermediateResistance: runtimeBuckets.intermediateResistance,
    intradaySupport: runtimeBuckets.intradaySupport,
    intradayResistance: runtimeBuckets.intradayResistance,
    extensionLevels,
    specialLevels: input.specialLevels,
  };
  const enrichmentDiagnostics = buildEnrichmentDiagnostics(output, enrichmentAccumulator);

  return {
    output,
    rankedOutput,
    surfacedSelection,
    comparableOutput: normalizeSurfacedSelectionOutput(surfacedSelection, 12),
    enrichmentDiagnostics,
    mappingNotes: [
      "The new surfaced adapter is projected into the legacy bucketed LevelEngineOutput contract for runtime compatibility.",
      runtimeBucketOwnership === "legacy"
        ? "Runtime buckets reuse the legacy FinalLevelZone transport buckets supplied by the old runtime path so bucket coverage, nearest levels, and legacy strength labels remain stable while richer surfaced selection stays observational."
        : "Runtime buckets are owned by the projected surfaced selection; changing runtime mode back to old bypasses this projection and returns the untouched legacy output.",
      legacyLabelZones.length > 0
        ? "Projected runtime zones preserve legacy strengthScore and strengthLabel when price, side, timeframe, and source context match safely; unmatched zones use structuralStrengthScore rather than proximity-weighted surfacedSelectionScore."
        : "Projected runtime zones without legacy match context derive transport labels from structuralStrengthScore rather than proximity-weighted surfacedSelectionScore.",
      input.legacyExtensionLevels
        ? "Extension levels reuse the legacy extension ladder supplied by the old runtime path so forward-planning coverage is not limited to one surfaced anchor per side."
        : "Extension levels fall back to surfaced deeper anchors when no legacy extension ladder is supplied.",
      enrichmentDiagnostics.unenrichedZones > 0
        ? `enrichedAnalysis attached to ${enrichmentDiagnostics.enrichedZones} runtime zones; ${enrichmentDiagnostics.unenrichedZones} remain undefined because no safe ranked-level match was available.`
        : `enrichedAnalysis attached to all ${enrichmentDiagnostics.enrichedZones} runtime zones as additive shadow metadata.`,
    ],
  };
}
