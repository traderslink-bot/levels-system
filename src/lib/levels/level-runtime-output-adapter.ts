// 2026-05-27 08:55 PM America/Toronto
// Runtime-compatible projection that keeps FinalLevelZone transport stable while attaching optional richer metadata.

import type { Candle, CandleTimeframe } from "../market-data/candle-types.js";
import { rankLevels } from "./level-ranking.js";
import { normalizeSurfacedSelectionOutput, type ComparablePathOutput } from "./level-ranking-comparison.js";
import { selectSurfacedLevels, type SurfacedSelectionResult } from "./level-surfaced-selection.js";
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
import { buildZoneBounds, clamp } from "./level-zone-utils.js";

export type LegacyRuntimeBuckets = Pick<
  LevelEngineOutput,
  | "majorSupport"
  | "majorResistance"
  | "intermediateSupport"
  | "intermediateResistance"
  | "intradaySupport"
  | "intradayResistance"
>;

export type EnrichmentDiagnostics = {
  enrichedZones: number;
  unenrichedZones: number;
  unmatchedRuntimeZoneIds: string[];
};

export type NewRuntimeCompatibleLevelOutput = {
  output: LevelEngineOutput;
  rankedOutput: RankedLevelsOutput;
  surfacedSelection: SurfacedSelectionResult;
  comparableOutput: ComparablePathOutput;
  enrichmentDiagnostics: EnrichmentDiagnostics;
  mappingNotes: string[];
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
  levelCandidates?: LevelCandidate[];
  generatedAt?: number;
};

type RuntimeBucket = "major" | "intermediate" | "intraday";

const RAW_LEVEL_SOURCE_TYPES: readonly RawLevelCandidateSourceType[] = [
  "swing_high",
  "swing_low",
  "premarket_high",
  "premarket_low",
  "opening_range_high",
  "opening_range_low",
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
    type: candidate.kind,
    price: candidate.price,
    zoneLow: zoneBounds.zoneLow,
    zoneHigh: zoneBounds.zoneHigh,
    sourceTimeframes: [candidate.timeframe],
    originKinds: [candidate.sourceType],
    analysisCandles: candlesByTimeframe[candidate.timeframe] ?? [],
    touchCount: candidate.touchCount,
    meaningfulTouchCount: candidate.touchCount,
    rejectionCount: Math.round(candidate.rejectionScore * Math.max(candidate.touchCount, 1)),
    failedBreakCount: 0,
    cleanBreakCount: 0,
    reclaimCount: 0,
    strongestReactionMovePct: candidate.reactionScore,
    averageReactionMovePct: candidate.reactionQuality,
    bestVolumeRatio: 1 + candidate.sessionSignificance,
    averageVolumeRatio: 1 + candidate.sessionSignificance / 2,
    cleanlinessStdDevPct: Math.max(0, 0.04 - candidate.reactionQuality * 0.02),
    ageInBars: 0,
    barsSinceLastReaction: 0,
  };
}

function buildLevelCandidates(
  input: LevelRuntimeOutputAdapterInput,
): LevelCandidate[] {
  return [
    ...(input.levelCandidates ?? []),
    ...input.rawCandidates.map((candidate) =>
      convertRawCandidateToLevelCandidate(candidate, input.candlesByTimeframe),
    ),
  ];
}

function bucketForTimeframes(timeframes: readonly SourceTimeframe[]): RuntimeBucket {
  const normalized = [...new Set(timeframes.map(normalizeRuntimeSourceTimeframe))];

  if (normalized.includes("daily") || normalized.length > 1) {
    return "major";
  }
  if (normalized.includes("4h")) {
    return "intermediate";
  }

  return "intraday";
}

function deriveStrengthLabel(score: number): FinalLevelZone["strengthLabel"] {
  if (score >= 78) {
    return "major";
  }
  if (score >= 62) {
    return "strong";
  }
  if (score >= 42) {
    return "moderate";
  }

  return "weak";
}

function deriveFreshness(level: RankedLevel): LevelDataFreshness {
  if (level.barsSinceLastReaction <= 8) {
    return "fresh";
  }
  if (level.barsSinceLastReaction <= 60) {
    return "aging";
  }

  return "stale";
}

function deriveSourceTypes(level: RankedLevel): RawLevelCandidateSourceType[] {
  const sourceTypes = level.originKinds.filter((origin): origin is RawLevelCandidateSourceType =>
    (RAW_LEVEL_SOURCE_TYPES as readonly string[]).includes(origin),
  );

  return sourceTypes.length > 0 ? sourceTypes : ["swing_low"];
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

function toRuntimeZone(level: RankedLevel, generatedAt: number): FinalLevelZone {
  const timeframeSources = [...new Set(level.sourceTimeframes.map(normalizeRuntimeSourceTimeframe))];
  const sourceTypes = deriveSourceTypes(level);

  return {
    id: level.id,
    symbol: level.symbol,
    kind: level.type,
    timeframeBias: timeframeSources.length === 1 ? timeframeSources[0]! : "mixed",
    zoneLow: level.zoneLow,
    zoneHigh: level.zoneHigh,
    representativePrice: level.price,
    strengthScore: level.score,
    strengthLabel: deriveStrengthLabel(level.score),
    touchCount: level.touchCount,
    confluenceCount: timeframeSources.length,
    sourceTypes,
    timeframeSources,
    reactionQualityScore: clamp(level.scoreBreakdown.reactionQualityScore / 15, 0, 1),
    rejectionScore: clamp((level.rejectionCount + level.failedBreakCount + level.reclaimCount) / Math.max(level.touchCount, 1), 0, 1),
    displacementScore: clamp(level.scoreBreakdown.reactionMagnitudeScore / 10, 0, 1),
    sessionSignificanceScore: clamp(level.scoreBreakdown.volumeScore / 10, 0, 1),
    followThroughScore: clamp(level.averageReactionMovePct / 0.08, 0, 1),
    sourceEvidenceCount: Math.max(level.touchCount, sourceTypes.length),
    firstTimestamp: generatedAt,
    lastTimestamp: generatedAt,
    isExtension: false,
    freshness: deriveFreshness(level),
    notes: [level.explanation],
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

function levelSourceContextMatches(zone: FinalLevelZone, level: RankedLevel): boolean {
  const levelTimeframes = new Set(level.sourceTimeframes.map(normalizeRuntimeSourceTimeframe));
  const timeframeMatches = zone.timeframeSources.some((timeframe) => levelTimeframes.has(timeframe));
  const levelOrigins = new Set(level.originKinds);
  const sourceMatches = zone.sourceTypes.some((sourceType) => levelOrigins.has(sourceType));

  return timeframeMatches || sourceMatches;
}

function levelPriceMatches(zone: FinalLevelZone, level: RankedLevel): boolean {
  const zoneLow = Math.min(zone.zoneLow, zone.zoneHigh);
  const zoneHigh = Math.max(zone.zoneLow, zone.zoneHigh);
  const tolerance = Math.max(
    Math.abs(zone.representativePrice) * 0.0025,
    Math.abs(zoneHigh - zoneLow),
    0.0001,
  );

  return (
    level.price >= zoneLow - tolerance &&
    level.price <= zoneHigh + tolerance &&
    Math.abs(level.price - zone.representativePrice) <= tolerance
  );
}

function findEnrichmentMatch(
  zone: FinalLevelZone,
  rankedLevels: RankedLevel[],
): RankedLevel | undefined {
  return rankedLevels.find((level) =>
    level.symbol === zone.symbol &&
    level.type === zone.kind &&
    levelPriceMatches(zone, level) &&
    levelSourceContextMatches(zone, level),
  );
}

function cloneRuntimeZoneWithEnrichment(
  zone: FinalLevelZone,
  rankedLevels: RankedLevel[],
  diagnostics: EnrichmentDiagnostics,
): FinalLevelZone {
  const cloned = cloneRuntimeZone(zone);
  const match = findEnrichmentMatch(zone, rankedLevels);

  if (!match) {
    diagnostics.unenrichedZones += 1;
    diagnostics.unmatchedRuntimeZoneIds.push(zone.id);
    return {
      ...cloned,
      enrichedAnalysis: undefined,
    };
  }

  diagnostics.enrichedZones += 1;
  return {
    ...cloned,
    enrichedAnalysis: toEnrichedAnalysis(match),
  };
}

function cloneRuntimeZones(
  zones: FinalLevelZone[],
  rankedLevels: RankedLevel[],
  diagnostics: EnrichmentDiagnostics,
): FinalLevelZone[] {
  return zones.map((zone) => cloneRuntimeZoneWithEnrichment(zone, rankedLevels, diagnostics));
}

function cloneLegacyRuntimeBuckets(
  runtimeBuckets: LegacyRuntimeBuckets,
  rankedLevels: RankedLevel[],
  diagnostics: EnrichmentDiagnostics,
): LegacyRuntimeBuckets {
  return {
    majorSupport: cloneRuntimeZones(runtimeBuckets.majorSupport, rankedLevels, diagnostics),
    majorResistance: cloneRuntimeZones(runtimeBuckets.majorResistance, rankedLevels, diagnostics),
    intermediateSupport: cloneRuntimeZones(runtimeBuckets.intermediateSupport, rankedLevels, diagnostics),
    intermediateResistance: cloneRuntimeZones(runtimeBuckets.intermediateResistance, rankedLevels, diagnostics),
    intradaySupport: cloneRuntimeZones(runtimeBuckets.intradaySupport, rankedLevels, diagnostics),
    intradayResistance: cloneRuntimeZones(runtimeBuckets.intradayResistance, rankedLevels, diagnostics),
  };
}

function cloneExtensionLevels(
  extensionLevels: LevelEngineOutput["extensionLevels"] | undefined,
  rankedLevels: RankedLevel[],
  diagnostics: EnrichmentDiagnostics,
): LevelEngineOutput["extensionLevels"] {
  if (!extensionLevels) {
    return {
      support: [],
      resistance: [],
    };
  }

  return {
    support: cloneRuntimeZones(extensionLevels.support, rankedLevels, diagnostics),
    resistance: cloneRuntimeZones(extensionLevels.resistance, rankedLevels, diagnostics),
  };
}

function cloneRuntimeZones(zones: FinalLevelZone[]): FinalLevelZone[] {
  return zones.map(cloneRuntimeZone);
}

function cloneLegacyRuntimeBuckets(
  runtimeBuckets: LegacyRuntimeBuckets,
): LegacyRuntimeBuckets {
  return {
    majorSupport: cloneRuntimeZones(runtimeBuckets.majorSupport),
    majorResistance: cloneRuntimeZones(runtimeBuckets.majorResistance),
    intermediateSupport: cloneRuntimeZones(runtimeBuckets.intermediateSupport),
    intermediateResistance: cloneRuntimeZones(runtimeBuckets.intermediateResistance),
    intradaySupport: cloneRuntimeZones(runtimeBuckets.intradaySupport),
    intradayResistance: cloneRuntimeZones(runtimeBuckets.intradayResistance),
  };
}

function pushBucketedZone(
  buckets: Record<RuntimeBucket, FinalLevelZone[]>,
  level: RankedLevel,
  generatedAt: number,
): void {
  buckets[bucketForTimeframes(level.sourceTimeframes)].push(toRuntimeZone(level, generatedAt));
}

function buildActionableBuckets(
  levels: RankedLevel[],
  generatedAt: number,
): Record<RuntimeBucket, FinalLevelZone[]> {
  const buckets: Record<RuntimeBucket, FinalLevelZone[]> = {
    major: [],
    intermediate: [],
    intraday: [],
  };

  for (const level of levels) {
    pushBucketedZone(buckets, level, generatedAt);
  }

  return buckets;
}

export function buildNewRuntimeCompatibleLevelOutput(
  input: LevelRuntimeOutputAdapterInput,
): NewRuntimeCompatibleLevelOutput {
  const generatedAt = input.generatedAt ?? Date.now();
  const levelCandidates = buildLevelCandidates(input);
  const scoringContext = buildScoringContext(input.symbol, input.candlesByTimeframe, input.metadata);
  const rankedOutput = rankLevels(levelCandidates, scoringContext);
  const surfacedSelection = selectSurfacedLevels(rankedOutput);
  const rankedLevels = [...rankedOutput.supports, ...rankedOutput.resistances];
  const diagnostics: EnrichmentDiagnostics = {
    enrichedZones: 0,
    unenrichedZones: 0,
    unmatchedRuntimeZoneIds: [],
  };
  const supportBuckets = buildActionableBuckets(rankedOutput.supports, generatedAt);
  const resistanceBuckets = buildActionableBuckets(rankedOutput.resistances, generatedAt);
  const runtimeBuckets = input.legacyRuntimeBuckets
    ? cloneLegacyRuntimeBuckets(input.legacyRuntimeBuckets, rankedLevels, diagnostics)
    : {
        majorSupport: supportBuckets.major,
        majorResistance: resistanceBuckets.major,
        intermediateSupport: supportBuckets.intermediate,
        intermediateResistance: resistanceBuckets.intermediate,
        intradaySupport: supportBuckets.intraday,
        intradayResistance: resistanceBuckets.intraday,
      };
  const extensionLevels = cloneExtensionLevels(input.legacyExtensionLevels, rankedLevels, diagnostics);
  const output: LevelEngineOutput = {
    symbol: input.symbol.toUpperCase(),
    generatedAt,
    metadata: input.metadata,
    ...runtimeBuckets,
    extensionLevels,
    specialLevels: input.specialLevels,
  };

  return {
    output,
    rankedOutput,
    surfacedSelection,
    comparableOutput: normalizeSurfacedSelectionOutput(surfacedSelection, 12),
    enrichmentDiagnostics: diagnostics,
    mappingNotes: [
      "The new surfaced adapter is projected into the legacy bucketed LevelEngineOutput contract for runtime compatibility.",
      input.legacyRuntimeBuckets
        ? "Runtime buckets reuse the legacy FinalLevelZone transport buckets supplied by the old runtime path so bucket coverage, nearest levels, and legacy strength labels remain stable while richer surfaced selection stays observational."
        : "Strength labels are approximated from surfaced-selection scores because no legacy runtime buckets were supplied.",
      input.legacyExtensionLevels
        ? "Extension levels reuse the legacy extension ladder supplied by the old runtime path for practical forward planning."
        : "Extension levels remain empty unless a legacy extension ladder is supplied.",
      diagnostics.unenrichedZones > 0
        ? `enrichedAnalysis attached to ${diagnostics.enrichedZones} runtime zones; ${diagnostics.unenrichedZones} remain undefined because no safe ranked-level match was available.`
        : `enrichedAnalysis attached to all ${diagnostics.enrichedZones} matched runtime zones as additive shadow metadata.`,
    ],
  };
}
