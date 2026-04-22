// 2026-04-17 11:18 PM America/Toronto
// Compare the existing surfaced-output ranking path against the newer level strength ranking layer on shared inputs.

import type { Candle, CandleTimeframe } from "../market-data/candle-types.js";
import { DEFAULT_LEVEL_ENGINE_CONFIG, type LevelEngineConfig } from "./level-config.js";
import { clusterRawLevelCandidates } from "./level-clusterer.js";
import { buildRawLevelCandidates } from "./raw-level-candidate-builder.js";
import { rankLevelZones } from "./level-ranker.js";
import { rankLevels } from "./level-ranking.js";
import type { SurfacedSelectionResult } from "./level-surfaced-selection.js";
import type { LevelScoreConfig } from "./level-score-config.js";
import { LEVEL_SCORE_CONFIG } from "./level-score-config.js";
import { scoreLevelZones } from "./level-scorer.js";
import { buildSpecialLevelCandidates } from "./special-level-builder.js";
import { detectSwingPoints } from "./swing-detector.js";
import type {
  FinalLevelZone,
  LevelCandidate,
  LevelDurabilityLabel,
  LevelEngineOutput,
  LevelScoringContext,
  LevelState,
  RankedLevel,
  RankedLevelsOutput,
  RawLevelCandidate,
  SourceTimeframe,
} from "./level-types.js";
import { buildZoneBounds, clamp, overlapRatio, priceDistancePct } from "./level-zone-utils.js";

export type ComparableLevelSummary = {
  sourcePath: "old" | "new" | "surfaced_adapter";
  side: "support" | "resistance";
  price: number;
  zoneLow: number;
  zoneHigh: number;
  rank: number;
  nearestRank: number;
  score?: number;
  strengthLabel?: string;
  confidence?: number;
  state?: LevelState;
  durabilityLabel?: LevelDurabilityLabel;
  explanation?: string;
  bucket?: "major" | "intermediate" | "intraday";
  clusterRepresentative?: boolean;
  clusterId?: string | null;
  sourceTimeframes?: SourceTimeframe[];
};

export type ComparablePathOutput = {
  symbol: string;
  currentPrice: number;
  topSupport?: ComparableLevelSummary;
  nearestSupport?: ComparableLevelSummary;
  topResistance?: ComparableLevelSummary;
  nearestResistance?: ComparableLevelSummary;
  supports: ComparableLevelSummary[];
  resistances: ComparableLevelSummary[];
  visibleSupportCount: number;
  visibleResistanceCount: number;
  nearbyDuplicateCount: number;
  outputShape: string;
};

export type LevelRankingDifference = {
  changedTopSupport: boolean;
  changedTopResistance: boolean;
  changedNearestSupport: boolean;
  changedNearestResistance: boolean;
  supportRankChanges: Array<{ price: number; oldRank: number | null; newRank: number | null }>;
  resistanceRankChanges: Array<{ price: number; oldRank: number | null; newRank: number | null }>;
  duplicateSuppressionImproved: boolean;
  oldNearbyDuplicateCount: number;
  newNearbyDuplicateCount: number;
  noteworthyDisagreements: string[];
  incompatibilities: string[];
};

export type MigrationReadinessCategory =
  | "ready_for_shadow_mode"
  | "ready_for_optional_runtime_flag"
  | "needs_more_calibration"
  | "blocked_by_output_compatibility"
  | "blocked_by_candidate_input_mismatch";

export type MigrationReadinessSummary = {
  category: MigrationReadinessCategory;
  improvements: string[];
  regressions: string[];
  acceptableDifferences: string[];
  blockers: string[];
  downstreamDependencies: string[];
  limitations: string[];
  recommendation: string;
};

export type LevelRankingComparisonInput = {
  symbol: string;
  currentPrice: number;
  candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>>;
  latestTimestamp?: number;
  currentTimeframe?: SourceTimeframe;
  currentSessionVolumeRatio?: number;
  rawCandidates?: RawLevelCandidate[];
  specialLevels?: LevelEngineOutput["specialLevels"];
  maxComparableLevels?: number;
  oldConfig?: LevelEngineConfig;
  newConfig?: LevelScoreConfig;
};

export type LevelRankingComparisonResult = {
  symbol: string;
  currentPrice: number;
  rawCandidateCount: number;
  specialCandidateCount: number;
  timeframesUsed: CandleTimeframe[];
  oldPath: ComparablePathOutput;
  newPath: ComparablePathOutput;
  differences: LevelRankingDifference;
  migrationReadiness: MigrationReadinessSummary;
};

export const CURRENT_OLD_LEVEL_RUNTIME_PATH = {
  producer: {
    file: "src/lib/levels/level-engine.ts",
    functionName: "LevelEngine.generateLevels",
    invocationChain: [
      "detectSwingPoints",
      "buildRawLevelCandidates",
      "buildSpecialLevelCandidates",
      "clusterRawLevelCandidates",
      "scoreLevelZones",
      "rankLevelZones",
    ],
    inputShape:
      "symbol + historical candle requests -> raw candidates per timeframe -> clustered FinalLevelZone[] per side",
    outputShape:
      "LevelEngineOutput with bucketed surfaced fields: majorSupport, majorResistance, intermediateSupport, intermediateResistance, intradaySupport, intradayResistance, extensionLevels, metadata, specialLevels",
  },
  runtimeEntrypoints: [
    {
      file: "src/runtime/main.ts",
      functionName: "seedLevels",
      details: "Calls engine.generateLevels(...) and stores the LevelEngineOutput in LevelStore.",
    },
    {
      file: "src/lib/monitoring/manual-watchlist-runtime-manager.ts",
      functionName: "seedLevelsForSymbol",
      details: "Calls levelEngine.generateLevels(...) during activation/startup refresh and pushes output into LevelStore.",
    },
  ],
  downstreamConsumers: [
    {
      file: "src/lib/monitoring/level-store.ts",
      dependency:
        "Flattens output.majorSupport/intermediateSupport/intradaySupport and the resistance equivalents into monitored active zones, and reads output.extensionLevels for promoted extensions.",
    },
    {
      file: "src/lib/monitoring/manual-watchlist-runtime-manager.ts",
      dependency:
        "Builds Discord snapshot payloads from surfaced support/resistance buckets and extensionLevels using representativePrice/strengthScore/freshness/timeframeBias.",
    },
    {
      file: "src/lib/alerts/alert-intelligence-engine.ts",
      dependency:
        "Scans all zones from LevelEngineOutput including surfaced buckets and extensionLevels when enriching monitoring events.",
    },
  ],
} as const;

function deriveLatestTimestamp(candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>>): number {
  return Math.max(
    0,
    ...Object.values(candlesByTimeframe).map((candles) => candles?.at(-1)?.timestamp ?? 0),
  );
}

function deriveFreshness(latestTimestamp: number): LevelEngineOutput["metadata"]["freshness"] {
  const ageHours = (Date.now() - latestTimestamp) / (1000 * 60 * 60);
  if (ageHours <= 24) {
    return "fresh";
  }
  if (ageHours <= 24 * 7) {
    return "aging";
  }
  return "stale";
}

function deriveCurrentTimeframe(candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>>): SourceTimeframe {
  if ((candlesByTimeframe["5m"]?.length ?? 0) > 0) {
    return "5m";
  }
  if ((candlesByTimeframe["4h"]?.length ?? 0) > 0) {
    return "4h";
  }
  return "daily";
}

function buildSharedRawCandidates(
  input: LevelRankingComparisonInput,
  config: LevelEngineConfig,
): { rawCandidates: RawLevelCandidate[]; specialLevels: LevelEngineOutput["specialLevels"]; limitations: string[] } {
  const limitations: string[] = [];

  for (const timeframe of ["daily", "4h"] as const) {
    if ((input.candlesByTimeframe[timeframe]?.length ?? 0) === 0) {
      limitations.push(`Missing ${timeframe} candles; old live path normally expects this timeframe.`);
    }
  }

  if (input.rawCandidates) {
    return {
      rawCandidates: input.rawCandidates,
      specialLevels: input.specialLevels ?? {},
      limitations,
    };
  }

  const rawCandidates: RawLevelCandidate[] = [];

  for (const timeframe of ["daily", "4h", "5m"] as const) {
    const candles = input.candlesByTimeframe[timeframe];
    if (!candles || candles.length === 0) {
      continue;
    }

    const swings = detectSwingPoints(candles, {
      swingWindow: config.timeframeConfig[timeframe].swingWindow,
      minimumDisplacementPct: config.timeframeConfig[timeframe].minimumDisplacementPct,
      minimumSeparationBars: config.timeframeConfig[timeframe].minimumSwingSeparationBars,
    });

    rawCandidates.push(
      ...buildRawLevelCandidates({
        symbol: input.symbol.toUpperCase(),
        timeframe,
        candles,
        swings,
      }),
    );
  }

  const special = input.specialLevels ?? buildSpecialLevelCandidates(
    input.symbol.toUpperCase(),
    input.candlesByTimeframe["5m"] ?? [],
  );
  const specialSummary = "candidates" in special ? special.summary : special;
  const specialCandidates = "candidates" in special ? special.candidates : [];
  rawCandidates.push(...specialCandidates);

  return {
    rawCandidates,
    specialLevels: specialSummary,
    limitations,
  };
}

function buildComparisonMetadata(input: LevelRankingComparisonInput): LevelEngineOutput["metadata"] {
  const latestTimestamp = input.latestTimestamp ?? deriveLatestTimestamp(input.candlesByTimeframe);

  return {
    providerByTimeframe: {
      daily: "stub",
      "4h": "stub",
      "5m": "stub",
    },
    dataQualityFlags: [],
    freshness: deriveFreshness(latestTimestamp),
    referencePrice: input.currentPrice,
  };
}

function buildNewScoringContext(input: LevelRankingComparisonInput): LevelScoringContext {
  const currentTimeframe = input.currentTimeframe ?? deriveCurrentTimeframe(input.candlesByTimeframe);
  const recentCandles =
    input.candlesByTimeframe[currentTimeframe as CandleTimeframe] ??
    input.candlesByTimeframe["5m"] ??
    input.candlesByTimeframe["4h"] ??
    input.candlesByTimeframe.daily ??
    [];

  return {
    symbol: input.symbol.toUpperCase(),
    currentPrice: input.currentPrice,
    latestTimestamp: input.latestTimestamp ?? deriveLatestTimestamp(input.candlesByTimeframe),
    currentSessionVolumeRatio: input.currentSessionVolumeRatio,
    recentCandles,
    currentTimeframe,
  };
}

function convertRawCandidateToLevelCandidate(
  candidate: RawLevelCandidate,
  candlesByTimeframe: Partial<Record<CandleTimeframe, Candle[]>>,
): LevelCandidate {
  const type = candidate.kind === "support" ? "support" : "resistance";
  const zoneBounds = buildZoneBounds(candidate.price);

  return {
    id: candidate.id,
    symbol: candidate.symbol,
    type,
    price: candidate.price,
    zoneLow: zoneBounds.zoneLow,
    zoneHigh: zoneBounds.zoneHigh,
    sourceTimeframes: [candidate.timeframe],
    originKinds: [candidate.sourceType],
    analysisCandles: candlesByTimeframe[candidate.timeframe],
    roleFlipCount: 0,
  };
}

function flattenOldSide(
  output: LevelEngineOutput,
  side: "support" | "resistance",
): Array<{ zone: FinalLevelZone; bucket: "major" | "intermediate" | "intraday" }> {
  const buckets =
    side === "support"
      ? [
          ...output.majorSupport.map((zone) => ({ zone, bucket: "major" as const })),
          ...output.intermediateSupport.map((zone) => ({ zone, bucket: "intermediate" as const })),
          ...output.intradaySupport.map((zone) => ({ zone, bucket: "intraday" as const })),
        ]
      : [
          ...output.majorResistance.map((zone) => ({ zone, bucket: "major" as const })),
          ...output.intermediateResistance.map((zone) => ({ zone, bucket: "intermediate" as const })),
          ...output.intradayResistance.map((zone) => ({ zone, bucket: "intraday" as const })),
        ];

  return buckets.sort(
    (left, right) =>
      right.zone.strengthScore - left.zone.strengthScore ||
      right.zone.followThroughScore - left.zone.followThroughScore ||
      right.zone.confluenceCount - left.zone.confluenceCount,
  );
}

function countNearbyDuplicates(levels: ComparableLevelSummary[]): number {
  const sorted = [...levels].sort((left, right) => left.price - right.price);
  let duplicateCount = 0;

  for (let index = 1; index < sorted.length; index += 1) {
    const left = sorted[index - 1]!;
    const right = sorted[index]!;
    const overlap = overlapRatio(
      { zoneLow: left.zoneLow, zoneHigh: left.zoneHigh },
      { zoneLow: right.zoneLow, zoneHigh: right.zoneHigh },
    );
    const distance = priceDistancePct(left.price, right.price);

    if (overlap >= 0.35 || distance <= LEVEL_SCORE_CONFIG.clustering.maxRepresentativeDistancePct) {
      duplicateCount += 1;
    }
  }

  return duplicateCount;
}

function summarizeComparableLevels(levels: ComparableLevelSummary[], currentPrice: number, side: "support" | "resistance"): ComparableLevelSummary[] {
  const nearestSorted = [...levels].sort((left, right) => {
    const leftDistance = Math.abs(left.price - currentPrice);
    const rightDistance = Math.abs(right.price - currentPrice);
    return leftDistance - rightDistance || left.rank - right.rank;
  });
  const nearestRankMap = new Map(nearestSorted.map((level, index) => [`${level.sourcePath}:${level.price}:${level.zoneLow}:${level.zoneHigh}`, index + 1]));

  return levels.map((level) => ({
    ...level,
    nearestRank: nearestRankMap.get(`${level.sourcePath}:${level.price}:${level.zoneLow}:${level.zoneHigh}`) ?? level.rank,
  }));
}

export function normalizeOldPathOutput(
  output: LevelEngineOutput,
  currentPrice: number,
  maxComparableLevels = 8,
): ComparablePathOutput {
  const supports = summarizeComparableLevels(
    flattenOldSide(output, "support")
      .slice(0, maxComparableLevels)
      .map(({ zone, bucket }, index) => ({
        sourcePath: "old" as const,
        side: "support" as const,
        price: zone.representativePrice,
        zoneLow: zone.zoneLow,
        zoneHigh: zone.zoneHigh,
        rank: index + 1,
        nearestRank: index + 1,
        score: zone.strengthScore,
        strengthLabel: zone.strengthLabel,
        bucket,
        sourceTimeframes: zone.timeframeSources,
      })),
    currentPrice,
    "support",
  );

  const resistances = summarizeComparableLevels(
    flattenOldSide(output, "resistance")
      .slice(0, maxComparableLevels)
      .map(({ zone, bucket }, index) => ({
        sourcePath: "old" as const,
        side: "resistance" as const,
        price: zone.representativePrice,
        zoneLow: zone.zoneLow,
        zoneHigh: zone.zoneHigh,
        rank: index + 1,
        nearestRank: index + 1,
        score: zone.strengthScore,
        strengthLabel: zone.strengthLabel,
        bucket,
        sourceTimeframes: zone.timeframeSources,
      })),
    currentPrice,
    "resistance",
  );

  return {
    symbol: output.symbol,
    currentPrice,
    topSupport: supports[0],
    nearestSupport: [...supports].sort((left, right) => left.nearestRank - right.nearestRank)[0],
    topResistance: resistances[0],
    nearestResistance: [...resistances].sort((left, right) => left.nearestRank - right.nearestRank)[0],
    supports,
    resistances,
    visibleSupportCount: supports.length,
    visibleResistanceCount: resistances.length,
    nearbyDuplicateCount: countNearbyDuplicates([...supports, ...resistances]),
    outputShape: "bucketed surfaced LevelEngineOutput",
  };
}

export function normalizeNewPathOutput(
  output: RankedLevelsOutput,
  maxComparableLevels = 8,
): ComparablePathOutput {
  const supports = summarizeComparableLevels(
    output.supports.slice(0, maxComparableLevels).map((level) => ({
      sourcePath: "new" as const,
      side: "support" as const,
      price: level.price,
      zoneLow: level.zoneLow,
      zoneHigh: level.zoneHigh,
      rank: level.rank,
      nearestRank: level.rank,
      score: level.score,
      confidence: level.confidence,
      state: level.state,
      durabilityLabel: level.durabilityLabel,
      explanation: level.explanation,
      clusterRepresentative: level.isClusterRepresentative,
      clusterId: level.clusterId,
      sourceTimeframes: level.sourceTimeframes,
    })),
    output.currentPrice,
    "support",
  );
  const resistances = summarizeComparableLevels(
    output.resistances.slice(0, maxComparableLevels).map((level) => ({
      sourcePath: "new" as const,
      side: "resistance" as const,
      price: level.price,
      zoneLow: level.zoneLow,
      zoneHigh: level.zoneHigh,
      rank: level.rank,
      nearestRank: level.rank,
      score: level.score,
      confidence: level.confidence,
      state: level.state,
      durabilityLabel: level.durabilityLabel,
      explanation: level.explanation,
      clusterRepresentative: level.isClusterRepresentative,
      clusterId: level.clusterId,
      sourceTimeframes: level.sourceTimeframes,
    })),
    output.currentPrice,
    "resistance",
  );

  return {
    symbol: output.symbol,
    currentPrice: output.currentPrice,
    topSupport: supports[0],
    nearestSupport: [...supports].sort((left, right) => left.nearestRank - right.nearestRank)[0],
    topResistance: resistances[0],
    nearestResistance: [...resistances].sort((left, right) => left.nearestRank - right.nearestRank)[0],
    supports,
    resistances,
    visibleSupportCount: supports.length,
    visibleResistanceCount: resistances.length,
    nearbyDuplicateCount: countNearbyDuplicates([...supports, ...resistances]),
    outputShape: "ranked strength output with confidence/state/explanation",
  };
}

export function normalizeSurfacedSelectionOutput(
  output: SurfacedSelectionResult,
  maxComparableLevels = 8,
): ComparablePathOutput {
  const supportLevels = output.surfacedSupports.slice(0, maxComparableLevels);
  const resistanceLevels = output.surfacedResistances.slice(0, maxComparableLevels);

  const supports = summarizeComparableLevels(
    supportLevels.map((level, index) => ({
      sourcePath: "surfaced_adapter" as const,
      side: "support" as const,
      price: level.price,
      zoneLow: level.zoneLow,
      zoneHigh: level.zoneHigh,
      rank: index + 1,
      nearestRank: index + 1,
      score: level.surfacedSelectionScore,
      confidence: level.confidence,
      state: level.state,
      durabilityLabel: level.durabilityLabel,
      explanation: level.surfacedSelectionExplanation,
      clusterRepresentative: level.isClusterRepresentative,
      clusterId: level.clusterId,
      sourceTimeframes: level.sourceTimeframes,
    })),
    output.currentPrice,
    "support",
  );

  const resistances = summarizeComparableLevels(
    resistanceLevels.map((level, index) => ({
      sourcePath: "surfaced_adapter" as const,
      side: "resistance" as const,
      price: level.price,
      zoneLow: level.zoneLow,
      zoneHigh: level.zoneHigh,
      rank: index + 1,
      nearestRank: index + 1,
      score: level.surfacedSelectionScore,
      confidence: level.confidence,
      state: level.state,
      durabilityLabel: level.durabilityLabel,
      explanation: level.surfacedSelectionExplanation,
      clusterRepresentative: level.isClusterRepresentative,
      clusterId: level.clusterId,
      sourceTimeframes: level.sourceTimeframes,
    })),
    output.currentPrice,
    "resistance",
  );

  return {
    symbol: output.symbol,
    currentPrice: output.currentPrice,
    topSupport: output.topActionableSupport
      ? supports.find((level) => level.price === output.topActionableSupport?.price)
      : supports[0],
    nearestSupport: [...supports].sort((left, right) => left.nearestRank - right.nearestRank)[0],
    topResistance: output.topActionableResistance
      ? resistances.find((level) => level.price === output.topActionableResistance?.price)
      : resistances[0],
    nearestResistance: [...resistances].sort((left, right) => left.nearestRank - right.nearestRank)[0],
    supports,
    resistances,
    visibleSupportCount: supports.length,
    visibleResistanceCount: resistances.length,
    nearbyDuplicateCount: countNearbyDuplicates([...supports, ...resistances]),
    outputShape: "surfaced selection adapter output with actionable levels only; deeper anchors remain separate context",
  };
}

function levelsEquivalent(left: ComparableLevelSummary | undefined, right: ComparableLevelSummary | undefined): boolean {
  if (!left || !right) {
    return left === right;
  }

  const overlap = overlapRatio(
    { zoneLow: left.zoneLow, zoneHigh: left.zoneHigh },
    { zoneLow: right.zoneLow, zoneHigh: right.zoneHigh },
  );
  const distance = priceDistancePct(left.price, right.price);

  return overlap >= 0.35 || distance <= LEVEL_SCORE_CONFIG.clustering.maxRepresentativeDistancePct;
}

function buildRankChanges(
  oldLevels: ComparableLevelSummary[],
  newLevels: ComparableLevelSummary[],
): Array<{ price: number; oldRank: number | null; newRank: number | null }> {
  const changes = new Map<string, { price: number; oldRank: number | null; newRank: number | null }>();

  for (const level of oldLevels) {
    const match = newLevels.find((candidate) => levelsEquivalent(level, candidate));
    changes.set(`old-${level.rank}-${level.price}`, {
      price: level.price,
      oldRank: level.rank,
      newRank: match?.rank ?? null,
    });
  }

  for (const level of newLevels) {
    const match = oldLevels.find((candidate) => levelsEquivalent(level, candidate));
    if (!match) {
      changes.set(`new-${level.rank}-${level.price}`, {
        price: level.price,
        oldRank: null,
        newRank: level.rank,
      });
    }
  }

  return [...changes.values()].filter((change) => change.oldRank !== change.newRank);
}

export function summarizeMigrationReadiness(params: {
  oldPath: ComparablePathOutput;
  newPath: ComparablePathOutput;
  differences: LevelRankingDifference;
  limitations: string[];
}): MigrationReadinessSummary {
  const improvements: string[] = [];
  const regressions: string[] = [];
  const acceptableDifferences: string[] = [];
  const blockers: string[] = [];
  const downstreamDependencies = CURRENT_OLD_LEVEL_RUNTIME_PATH.downstreamConsumers.map(
    (consumer) => `${consumer.file}: ${consumer.dependency}`,
  );

  improvements.push("The new path exposes confidence, state, durability, explanation, and cluster representative metadata.");

  if (params.differences.duplicateSuppressionImproved) {
    improvements.push("The new path reduced nearby duplicate levels in the compared surfaced subset.");
  }

  if (params.differences.changedTopSupport || params.differences.changedTopResistance) {
    acceptableDifferences.push("Top surfaced levels changed between old and new paths and require manual chart review.");
  }

  if (params.differences.supportRankChanges.length > 0 || params.differences.resistanceRankChanges.length > 0) {
    acceptableDifferences.push("Rank ordering changed, which is expected when moving from bucketed surfaced outputs to a richer strength model.");
  }

  if (params.newPath.visibleSupportCount === 0 || params.newPath.visibleResistanceCount === 0) {
    regressions.push("The new path did not surface both sides in the compared subset.");
  }

  blockers.push(
    "Direct replacement is blocked today because live consumers expect bucketed LevelEngineOutput fields such as majorSupport, intermediateResistance, and extensionLevels.",
  );

  if (params.limitations.some((limitation) => limitation.includes("Missing"))) {
    blockers.push("Candidate/candle completeness differs from the old live assumptions on at least one timeframe.");
  }

  const category: MigrationReadinessCategory =
    blockers.some((blocker) => blocker.includes("bucketed LevelEngineOutput"))
      ? "blocked_by_output_compatibility"
      : params.limitations.length > 0
        ? "blocked_by_candidate_input_mismatch"
        : regressions.length > improvements.length
          ? "needs_more_calibration"
          : params.differences.changedTopSupport || params.differences.changedTopResistance
            ? "ready_for_shadow_mode"
            : "ready_for_optional_runtime_flag";

  return {
    category,
    improvements,
    regressions,
    acceptableDifferences,
    blockers,
    downstreamDependencies,
    limitations: params.limitations,
    recommendation:
      category === "blocked_by_output_compatibility"
        ? "Keep the old path live, run the new layer in shadow comparison mode, and add an adapter or feature-flagged projection before considering replacement."
        : category === "blocked_by_candidate_input_mismatch"
          ? "Calibrate shared candidate inputs first so both paths are fed more equivalently before migration decisions."
          : category === "needs_more_calibration"
            ? "Do not switch defaults yet; review the changed tops and regressions and tune the new layer first."
            : category === "ready_for_shadow_mode"
              ? "Proceed with side-by-side shadow evaluation in runtime or validation scripts before enabling any optional runtime flag."
              : "The new path appears stable enough for a non-default optional runtime flag once an output adapter is in place.",
  };
}

export function computeComparisonDifferences(params: {
  oldPath: ComparablePathOutput;
  newPath: ComparablePathOutput;
  limitations: string[];
}): LevelRankingDifference {
  const oldPath = params.oldPath;
  const newPath = params.newPath;
  const changedTopSupport = !levelsEquivalent(oldPath.topSupport, newPath.topSupport);
  const changedTopResistance = !levelsEquivalent(oldPath.topResistance, newPath.topResistance);
  const changedNearestSupport = !levelsEquivalent(oldPath.nearestSupport, newPath.nearestSupport);
  const changedNearestResistance = !levelsEquivalent(oldPath.nearestResistance, newPath.nearestResistance);
  const supportRankChanges = buildRankChanges(oldPath.supports, newPath.supports);
  const resistanceRankChanges = buildRankChanges(oldPath.resistances, newPath.resistances);
  const duplicateSuppressionImproved = newPath.nearbyDuplicateCount < oldPath.nearbyDuplicateCount;
  const noteworthyDisagreements: string[] = [];
  const incompatibilities = [...params.limitations];

  if (changedTopSupport) {
    noteworthyDisagreements.push("Top support changed between old surfaced output and the new strength ranking.");
  }
  if (changedTopResistance) {
    noteworthyDisagreements.push("Top resistance changed between old surfaced output and the new strength ranking.");
  }
  if (duplicateSuppressionImproved) {
    noteworthyDisagreements.push("The new path appears to suppress more nearby duplicates in the compared surfaced subset.");
  }
  if (newPath.topSupport?.state || newPath.topResistance?.state) {
    noteworthyDisagreements.push("The new path adds state/confidence/durability/explanation metadata that the old path cannot provide.");
  }
  incompatibilities.push(
    "Old path emits bucketed LevelEngineOutput fields while the new path emits globally ranked supports/resistances.",
  );

  return {
    changedTopSupport,
    changedTopResistance,
    changedNearestSupport,
    changedNearestResistance,
    supportRankChanges,
    resistanceRankChanges,
    duplicateSuppressionImproved,
    oldNearbyDuplicateCount: oldPath.nearbyDuplicateCount,
    newNearbyDuplicateCount: newPath.nearbyDuplicateCount,
    noteworthyDisagreements,
    incompatibilities,
  };
}

export function compareLevelRankingPaths(
  input: LevelRankingComparisonInput,
): LevelRankingComparisonResult {
  const oldConfig = input.oldConfig ?? DEFAULT_LEVEL_ENGINE_CONFIG;
  const newConfig = input.newConfig ?? LEVEL_SCORE_CONFIG;
  const { rawCandidates, specialLevels, limitations } = buildSharedRawCandidates(input, oldConfig);
  const supportTolerance = Math.max(
    oldConfig.timeframeConfig.daily.clusterTolerancePct,
    oldConfig.timeframeConfig["4h"].clusterTolerancePct,
  );
  const supportZones = scoreLevelZones(
    clusterRawLevelCandidates(input.symbol.toUpperCase(), "support", rawCandidates, supportTolerance, oldConfig),
    oldConfig,
  );
  const resistanceZones = scoreLevelZones(
    clusterRawLevelCandidates(input.symbol.toUpperCase(), "resistance", rawCandidates, supportTolerance, oldConfig),
    oldConfig,
  );
  const oldOutput = rankLevelZones({
    symbol: input.symbol.toUpperCase(),
    supportZones,
    resistanceZones,
    specialLevels,
    metadata: buildComparisonMetadata(input),
    config: oldConfig,
  });

  const newCandidates = rawCandidates.map((candidate) =>
    convertRawCandidateToLevelCandidate(candidate, input.candlesByTimeframe),
  );
  const newOutput = rankLevels(newCandidates, buildNewScoringContext(input), newConfig);
  const maxComparableLevels = input.maxComparableLevels ?? 8;
  const normalizedOld = normalizeOldPathOutput(oldOutput, input.currentPrice, maxComparableLevels);
  const normalizedNew = normalizeNewPathOutput(newOutput, maxComparableLevels);
  const differences = computeComparisonDifferences({
    oldPath: normalizedOld,
    newPath: normalizedNew,
    limitations,
  });
  const migrationReadiness = summarizeMigrationReadiness({
    oldPath: normalizedOld,
    newPath: normalizedNew,
    differences,
    limitations,
  });

  return {
    symbol: input.symbol.toUpperCase(),
    currentPrice: input.currentPrice,
    rawCandidateCount: rawCandidates.length,
    specialCandidateCount: rawCandidates.filter((candidate) =>
      candidate.sourceType.startsWith("premarket") || candidate.sourceType.startsWith("opening_range"),
    ).length,
    timeframesUsed: (["daily", "4h", "5m"] as const).filter(
      (timeframe) => (input.candlesByTimeframe[timeframe]?.length ?? 0) > 0,
    ),
    oldPath: normalizedOld,
    newPath: normalizedNew,
    differences,
    migrationReadiness,
  };
}
