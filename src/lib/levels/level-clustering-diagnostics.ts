import type { CandleTimeframe } from "../market-data/candle-types.js";
import type {
  FinalLevelZone,
  LevelKind,
  RawLevelCandidate,
  RawLevelCandidateSourceType,
} from "./level-types.js";

export type LevelClusteringDiagnosticsWarning =
  | "high_compression_ratio"
  | "broad_cluster_span"
  | "many_members_single_cluster"
  | "hidden_depth_possible"
  | "no_raw_members_available";

export type LevelClusteringRawMemberMapping = "inferred_from_zone_span" | "unavailable";

export type LevelClusteringDiagnosticCluster = {
  clusterId: string;
  clusterIndex: number;
  kind: LevelKind;
  representativePrice: number;
  zoneLow: number;
  zoneHigh: number;
  rawMemberMapping: LevelClusteringRawMemberMapping;
  rawMemberCount: number;
  rawMemberIds: string[];
  rawMemberPrices: number[];
  minRawMemberPrice?: number;
  maxRawMemberPrice?: number;
  rawPriceSpanPct?: number;
  sourceTypes: RawLevelCandidateSourceType[];
  sourceTypeCounts: Partial<Record<RawLevelCandidateSourceType, number>>;
  timeframeSources: CandleTimeframe[];
  timeframeCounts: Partial<Record<CandleTimeframe, number>>;
  isBroadCluster: boolean;
  mayHideMultipleCandidateDepths: boolean;
  warnings: LevelClusteringDiagnosticsWarning[];
};

export type BuildLevelClusteringDiagnosticsInput = {
  symbol: string;
  rawCandidates: RawLevelCandidate[];
  clusteredZones: FinalLevelZone[];
  highCompressionRatioThreshold?: number;
  broadClusterSpanPct?: number;
  manyMembersThreshold?: number;
};

export type LevelClusteringDiagnosticsReport = {
  symbol: string;
  rawCandidateCount: number;
  clusteredZoneCount: number;
  compressionRatio: number;
  unmappedRawCandidateCount: number;
  clusters: LevelClusteringDiagnosticCluster[];
  warnings: LevelClusteringDiagnosticsWarning[];
  diagnostics: string[];
  safety: {
    diagnosticOnly: true;
    clusteringBehaviorUnchanged: true;
    noRuntimeBehaviorChange: true;
  };
};

const DEFAULT_HIGH_COMPRESSION_RATIO_THRESHOLD = 3;
const DEFAULT_BROAD_CLUSTER_SPAN_PCT = 2;
const DEFAULT_MANY_MEMBERS_THRESHOLD = 5;
const EPSILON = 0.000_001;

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function uniqueSorted<T extends string>(items: T[]): T[] {
  return [...new Set(items)].sort();
}

function countBy<T extends string>(items: T[]): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};

  for (const item of items) {
    counts[item] = (counts[item] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  ) as Partial<Record<T, number>>;
}

function priceSpanPct(prices: number[]): number | undefined {
  if (prices.length === 0) {
    return undefined;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const midpoint = (min + max) / 2;

  return round(((max - min) / Math.max(midpoint, 0.0001)) * 100);
}

function clusterCompressionRatio(rawCandidateCount: number, clusteredZoneCount: number): number {
  if (rawCandidateCount === 0 && clusteredZoneCount === 0) {
    return 0;
  }

  if (clusteredZoneCount === 0) {
    return rawCandidateCount;
  }

  return round(rawCandidateCount / clusteredZoneCount);
}

function candidateMatchesZone(
  candidate: RawLevelCandidate,
  zone: FinalLevelZone,
  symbol: string,
): boolean {
  if (candidate.kind !== zone.kind) {
    return false;
  }

  if (candidate.symbol !== symbol && candidate.symbol !== zone.symbol) {
    return false;
  }

  if (candidate.price < zone.zoneLow - EPSILON || candidate.price > zone.zoneHigh + EPSILON) {
    return false;
  }

  if (!zone.sourceTypes.includes(candidate.sourceType)) {
    return false;
  }

  return zone.timeframeSources.includes(candidate.timeframe);
}

function buildClusterDiagnostics(params: {
  symbol: string;
  zone: FinalLevelZone;
  clusterIndex: number;
  rawCandidates: RawLevelCandidate[];
  broadClusterSpanPct: number;
  manyMembersThreshold: number;
}): LevelClusteringDiagnosticCluster {
  const rawMembers = params.rawCandidates
    .filter((candidate) => candidateMatchesZone(candidate, params.zone, params.symbol))
    .sort((left, right) => left.price - right.price || left.id.localeCompare(right.id));
  const rawMemberPrices = rawMembers.map((member) => round(member.price));
  const rawPriceSpan = priceSpanPct(rawMemberPrices);
  const rawMemberMapping: LevelClusteringRawMemberMapping =
    rawMembers.length > 0 ? "inferred_from_zone_span" : "unavailable";
  const isBroadCluster = (rawPriceSpan ?? 0) >= params.broadClusterSpanPct;
  const manyMembers = rawMembers.length >= params.manyMembersThreshold;
  const mayHideMultipleCandidateDepths = rawMembers.length > 1 && (isBroadCluster || manyMembers);
  const warnings: LevelClusteringDiagnosticsWarning[] = [];

  if (rawMembers.length === 0) {
    warnings.push("no_raw_members_available");
  }
  if (isBroadCluster) {
    warnings.push("broad_cluster_span");
  }
  if (manyMembers) {
    warnings.push("many_members_single_cluster");
  }
  if (mayHideMultipleCandidateDepths) {
    warnings.push("hidden_depth_possible");
  }

  return {
    clusterId: params.zone.id || `${params.symbol}-${params.zone.kind}-cluster-${params.clusterIndex + 1}`,
    clusterIndex: params.clusterIndex,
    kind: params.zone.kind,
    representativePrice: round(params.zone.representativePrice),
    zoneLow: round(params.zone.zoneLow),
    zoneHigh: round(params.zone.zoneHigh),
    rawMemberMapping,
    rawMemberCount: rawMembers.length,
    rawMemberIds: rawMembers.map((member) => member.id),
    rawMemberPrices,
    minRawMemberPrice: rawMembers.length > 0 ? round(Math.min(...rawMemberPrices)) : undefined,
    maxRawMemberPrice: rawMembers.length > 0 ? round(Math.max(...rawMemberPrices)) : undefined,
    rawPriceSpanPct: rawPriceSpan,
    sourceTypes:
      rawMembers.length > 0
        ? uniqueSorted(rawMembers.map((member) => member.sourceType))
        : uniqueSorted(params.zone.sourceTypes),
    sourceTypeCounts:
      rawMembers.length > 0
        ? countBy(rawMembers.map((member) => member.sourceType))
        : countBy(params.zone.sourceTypes),
    timeframeSources:
      rawMembers.length > 0
        ? uniqueSorted(rawMembers.map((member) => member.timeframe))
        : uniqueSorted(params.zone.timeframeSources),
    timeframeCounts:
      rawMembers.length > 0
        ? countBy(rawMembers.map((member) => member.timeframe))
        : countBy(params.zone.timeframeSources),
    isBroadCluster,
    mayHideMultipleCandidateDepths,
    warnings,
  };
}

function aggregateWarnings(
  compressionRatio: number,
  highCompressionRatioThreshold: number,
  clusters: LevelClusteringDiagnosticCluster[],
): LevelClusteringDiagnosticsWarning[] {
  const warnings = new Set<LevelClusteringDiagnosticsWarning>();

  if (compressionRatio >= highCompressionRatioThreshold) {
    warnings.add("high_compression_ratio");
  }

  for (const cluster of clusters) {
    for (const warning of cluster.warnings) {
      warnings.add(warning);
    }
  }

  return [...warnings].sort();
}

export function buildLevelClusteringDiagnostics(
  input: BuildLevelClusteringDiagnosticsInput,
): LevelClusteringDiagnosticsReport {
  const highCompressionRatioThreshold =
    input.highCompressionRatioThreshold ?? DEFAULT_HIGH_COMPRESSION_RATIO_THRESHOLD;
  const broadClusterSpanPct = input.broadClusterSpanPct ?? DEFAULT_BROAD_CLUSTER_SPAN_PCT;
  const manyMembersThreshold = input.manyMembersThreshold ?? DEFAULT_MANY_MEMBERS_THRESHOLD;
  const rawCandidates = [...input.rawCandidates];
  const clusteredZones = [...input.clusteredZones];
  const clusters = clusteredZones.map((zone, index) =>
    buildClusterDiagnostics({
      symbol: input.symbol,
      zone,
      clusterIndex: index,
      rawCandidates,
      broadClusterSpanPct,
      manyMembersThreshold,
    }),
  );
  const mappedRawCandidateIds = new Set(clusters.flatMap((cluster) => cluster.rawMemberIds));
  const unmappedRawCandidateCount = rawCandidates.filter(
    (candidate) => !mappedRawCandidateIds.has(candidate.id),
  ).length;
  const compressionRatio = clusterCompressionRatio(rawCandidates.length, clusteredZones.length);
  const warnings = aggregateWarnings(
    compressionRatio,
    highCompressionRatioThreshold,
    clusters,
  );

  return {
    symbol: input.symbol,
    rawCandidateCount: rawCandidates.length,
    clusteredZoneCount: clusteredZones.length,
    compressionRatio,
    unmappedRawCandidateCount,
    clusters,
    warnings,
    diagnostics: [
      "clustering_diagnostics_only",
      "raw_member_mapping_inferred_from_zone_span_source_type_and_timeframe",
    ],
    safety: {
      diagnosticOnly: true,
      clusteringBehaviorUnchanged: true,
      noRuntimeBehaviorChange: true,
    },
  };
}
