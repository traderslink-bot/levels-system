import type { LevelIntelligenceProfile } from "./level-intelligence-profile.js";
import type { LevelIntelligenceReport } from "./level-intelligence-report.js";
import type { FinalLevelZone, LevelEngineOutput, LevelDataFreshness } from "./level-types.js";

export type LevelQualityAuditBucket =
  | "majorSupport"
  | "majorResistance"
  | "intermediateSupport"
  | "intermediateResistance"
  | "intradaySupport"
  | "intradayResistance"
  | "extensionSupport"
  | "extensionResistance";

export type LevelQualityAuditContextCounts = {
  session: number;
  volume: number;
  shelf: number;
  marketContext: number;
};

export type LevelQualityAuditItem = {
  levelId: string;
  symbol: string;
  kind: "support" | "resistance";
  bucket: LevelQualityAuditBucket;
  representativePrice: number;
  zoneLow: number;
  zoneHigh: number;
  strengthScore: number;
  strengthLabel: FinalLevelZone["strengthLabel"];
  auditScore: number;
  freshness: LevelDataFreshness;
  touchCount: number;
  confluenceCount: number;
  isExtension: boolean;
  hasEnrichedAnalysis: boolean;
  extensionSource?: NonNullable<FinalLevelZone["extensionMetadata"]>["extensionSource"];
  syntheticContinuationMap?: boolean;
  contextCounts: LevelQualityAuditContextCounts;
  distanceFromReferencePct?: number;
  diagnostics: string[];
};

export type LevelQualityEnrichmentBreakdown = {
  historical: {
    enriched: number;
    unenriched: number;
    unenrichedLevelIds: string[];
  };
  extension: {
    enriched: number;
    unenriched: number;
    unenrichedLevelIds: string[];
  };
  synthetic: {
    enriched: number;
    unenriched: number;
    unenrichedLevelIds: string[];
  };
};

export type LevelQualityCluster = {
  kind: "support" | "resistance" | "mixed";
  zoneLow: number;
  zoneHigh: number;
  representativePrices: number[];
  levelIds: string[];
  buckets: LevelQualityAuditBucket[];
  maxDistancePct: number;
  reason: string;
};

export type LevelQualityExtensionCoverage = {
  supportExtensions: number;
  resistanceExtensions: number;
  highestResistanceExtension?: number;
  lowestSupportExtension?: number;
  upsideCoveragePct?: number;
  downsideCoveragePct?: number;
  warnings: string[];
};

export type LevelQualityConfluenceSummary = {
  sessionConfluenceCount: number;
  volumeConfluenceCount: number;
  shelfConfluenceCount: number;
  marketContextConfluenceCount: number;
};

export type LevelQualityCoverageSummary = {
  referencePrice?: number;
  nearbySupportCount: number;
  nearbyResistanceCount: number;
  nearestSupport?: LevelQualityAuditItem;
  nearestResistance?: LevelQualityAuditItem;
  overheadResistanceGapPct?: number;
  downsideSupportGapPct?: number;
  warnings: string[];
};

export type LevelQualityAuditReport = {
  symbol: string;
  generatedAt: number;
  referencePrice?: number;
  summary: {
    totalLevels: number;
    supportCount: number;
    resistanceCount: number;
    extensionCount: number;
    freshCount: number;
    staleCount: number;
    enrichedCount: number;
    unenrichedCount: number;
  };
  strongestLevels: LevelQualityAuditItem[];
  weakestLevels: LevelQualityAuditItem[];
  staleLevels: LevelQualityAuditItem[];
  freshLevels: LevelQualityAuditItem[];
  strongConfluenceLevels: LevelQualityAuditItem[];
  weakContextLevels: LevelQualityAuditItem[];
  enrichedLevels: LevelQualityAuditItem[];
  unenrichedLevels: LevelQualityAuditItem[];
  enrichmentBreakdown?: LevelQualityEnrichmentBreakdown;
  possibleClutterLevels: LevelQualityAuditItem[];
  clusteredAreas: LevelQualityCluster[];
  extensionCoverage: LevelQualityExtensionCoverage;
  nearbyCoverage: LevelQualityCoverageSummary;
  confluenceSummary: LevelQualityConfluenceSummary;
  diagnostics: string[];
  safety: {
    levelOutputUnchanged: true;
    noRuntimeBehaviorChange: true;
    noScoringChange: true;
  };
};

export type BuildLevelQualityAuditReportRequest = {
  output: LevelEngineOutput;
  intelligenceReport?: LevelIntelligenceReport;
  clusterThresholdPct?: number;
  nearbyThresholdPct?: number;
  extensionCoverageWarningPct?: number;
  maxItems?: number;
};

type BucketedLevel = {
  bucket: LevelQualityAuditBucket;
  level: FinalLevelZone;
};

const DEFAULT_CLUSTER_THRESHOLD_PCT = 1.25;
const DEFAULT_NEARBY_THRESHOLD_PCT = 8;
const DEFAULT_EXTENSION_COVERAGE_WARNING_PCT = 20;
const DEFAULT_MAX_ITEMS = 5;

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isUsableNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function distancePct(left: number, right: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right) || right === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return round((Math.abs(left - right) / Math.abs(right)) * 100);
}

function flattenOutput(output: LevelEngineOutput): BucketedLevel[] {
  return [
    ...output.majorSupport.map((level) => ({ bucket: "majorSupport" as const, level })),
    ...output.majorResistance.map((level) => ({ bucket: "majorResistance" as const, level })),
    ...output.intermediateSupport.map((level) => ({ bucket: "intermediateSupport" as const, level })),
    ...output.intermediateResistance.map((level) => ({ bucket: "intermediateResistance" as const, level })),
    ...output.intradaySupport.map((level) => ({ bucket: "intradaySupport" as const, level })),
    ...output.intradayResistance.map((level) => ({ bucket: "intradayResistance" as const, level })),
    ...output.extensionLevels.support.map((level) => ({ bucket: "extensionSupport" as const, level })),
    ...output.extensionLevels.resistance.map((level) => ({ bucket: "extensionResistance" as const, level })),
  ];
}

function profileMap(report: LevelIntelligenceReport | undefined): Map<string, LevelIntelligenceProfile> {
  return new Map((report?.profiles ?? []).map((profile) => [profile.levelId, profile]));
}

function contextCounts(profile: LevelIntelligenceProfile | undefined): LevelQualityAuditContextCounts {
  return {
    session: profile?.confluence.nearSessionFacts.length ?? 0,
    volume: profile?.confluence.nearVolumeFacts.length ?? 0,
    shelf: profile?.confluence.nearShelfFacts.length ?? 0,
    marketContext: profile?.marketContext ? 1 : 0,
  };
}

function totalContext(counts: LevelQualityAuditContextCounts): number {
  return counts.session + counts.volume + counts.shelf + counts.marketContext;
}

function auditScore(level: FinalLevelZone): number {
  return round(level.enrichedAnalysis?.finalLevelScore ?? level.strengthScore / 100);
}

function buildAuditItem(
  bucketed: BucketedLevel,
  profile: LevelIntelligenceProfile | undefined,
): LevelQualityAuditItem {
  const { level, bucket } = bucketed;
  const counts = contextCounts(profile);

  return {
    levelId: level.id,
    symbol: level.symbol,
    kind: level.kind,
    bucket,
    representativePrice: level.representativePrice,
    zoneLow: level.zoneLow,
    zoneHigh: level.zoneHigh,
    strengthScore: level.strengthScore,
    strengthLabel: level.strengthLabel,
    auditScore: auditScore(level),
    freshness: level.freshness,
    touchCount: level.touchCount,
    confluenceCount: level.confluenceCount,
    isExtension: level.isExtension,
    hasEnrichedAnalysis: level.enrichedAnalysis !== undefined,
    extensionSource: level.extensionMetadata?.extensionSource,
    syntheticContinuationMap: level.extensionMetadata?.extensionSource === "synthetic_continuation_map",
    contextCounts: counts,
    distanceFromReferencePct: profile?.distance?.distanceFromReferencePct,
    diagnostics: profile?.diagnostics ? [...profile.diagnostics] : [],
  };
}

function itemSortDescending(left: LevelQualityAuditItem, right: LevelQualityAuditItem): number {
  return (
    right.auditScore - left.auditScore ||
    right.strengthScore - left.strengthScore ||
    right.confluenceCount - left.confluenceCount ||
    left.representativePrice - right.representativePrice
  );
}

function itemSortAscending(left: LevelQualityAuditItem, right: LevelQualityAuditItem): number {
  return (
    left.auditScore - right.auditScore ||
    left.strengthScore - right.strengthScore ||
    left.confluenceCount - right.confluenceCount ||
    left.representativePrice - right.representativePrice
  );
}

function buildCluster(candidateItems: LevelQualityAuditItem[]): LevelQualityCluster {
  const prices = candidateItems.map((item) => item.representativePrice).sort((left, right) => left - right);
  const kinds = [...new Set(candidateItems.map((item) => item.kind))];
  const zoneLow = Math.min(...candidateItems.map((item) => item.zoneLow));
  const zoneHigh = Math.max(...candidateItems.map((item) => item.zoneHigh));
  const anchor = prices[Math.floor(prices.length / 2)] ?? prices[0] ?? 0;
  const maxDistancePct = Math.max(...prices.map((price) => distancePct(price, anchor)));

  return {
    kind: kinds.length === 1 ? kinds[0]! : "mixed",
    zoneLow: round(zoneLow),
    zoneHigh: round(zoneHigh),
    representativePrices: prices.map((price) => round(price)),
    levelIds: candidateItems.map((item) => item.levelId),
    buckets: [...new Set(candidateItems.map((item) => item.bucket))],
    maxDistancePct: round(maxDistancePct),
    reason: "Multiple supplied levels are clustered within the audit threshold.",
  };
}

function buildClusteredAreas(items: LevelQualityAuditItem[], thresholdPct: number): LevelQualityCluster[] {
  const sorted = [...items].sort((left, right) => left.representativePrice - right.representativePrice);
  const clusters: LevelQualityCluster[] = [];
  let current: LevelQualityAuditItem[] = [];

  for (const item of sorted) {
    if (current.length === 0) {
      current = [item];
      continue;
    }

    const anchor = current[0]!.representativePrice;
    if (distancePct(item.representativePrice, anchor) <= thresholdPct) {
      current.push(item);
      continue;
    }

    if (current.length > 1) {
      clusters.push(buildCluster(current));
    }
    current = [item];
  }

  if (current.length > 1) {
    clusters.push(buildCluster(current));
  }

  return clusters;
}

function buildExtensionCoverage(
  output: LevelEngineOutput,
  referencePrice: number | undefined,
  warningPct: number,
): LevelQualityExtensionCoverage {
  const supportExtensions = output.extensionLevels.support;
  const resistanceExtensions = output.extensionLevels.resistance;
  const lowestSupportExtension = supportExtensions.length > 0
    ? Math.min(...supportExtensions.map((level) => level.representativePrice))
    : undefined;
  const highestResistanceExtension = resistanceExtensions.length > 0
    ? Math.max(...resistanceExtensions.map((level) => level.representativePrice))
    : undefined;
  const upsideCoveragePct = isUsableNumber(referencePrice) && isUsableNumber(highestResistanceExtension)
    ? round(((highestResistanceExtension - referencePrice) / referencePrice) * 100)
    : undefined;
  const downsideCoveragePct = isUsableNumber(referencePrice) && isUsableNumber(lowestSupportExtension)
    ? round(((referencePrice - lowestSupportExtension) / referencePrice) * 100)
    : undefined;
  const warnings: string[] = [];

  if (supportExtensions.length === 0) {
    warnings.push("no_support_extension_coverage");
  }
  if (resistanceExtensions.length === 0) {
    warnings.push("no_resistance_extension_coverage");
  }
  if (isUsableNumber(upsideCoveragePct) && upsideCoveragePct < warningPct) {
    warnings.push("limited_upside_extension_coverage");
  }
  if (isUsableNumber(downsideCoveragePct) && downsideCoveragePct < warningPct) {
    warnings.push("limited_downside_extension_coverage");
  }

  return {
    supportExtensions: supportExtensions.length,
    resistanceExtensions: resistanceExtensions.length,
    highestResistanceExtension,
    lowestSupportExtension,
    upsideCoveragePct,
    downsideCoveragePct,
    warnings,
  };
}

function buildNearbyCoverage(
  items: LevelQualityAuditItem[],
  referencePrice: number | undefined,
  thresholdPct: number,
): LevelQualityCoverageSummary {
  const warnings: string[] = [];

  if (!isUsableNumber(referencePrice)) {
    return {
      nearbySupportCount: 0,
      nearbyResistanceCount: 0,
      warnings: ["reference_price_missing"],
    };
  }

  const supports = items
    .filter((item) => item.kind === "support" && item.representativePrice <= referencePrice)
    .sort((left, right) => right.representativePrice - left.representativePrice);
  const resistances = items
    .filter((item) => item.kind === "resistance" && item.representativePrice >= referencePrice)
    .sort((left, right) => left.representativePrice - right.representativePrice);
  const nearestSupport = supports[0];
  const nearestResistance = resistances[0];
  const downsideSupportGapPct = nearestSupport ? distancePct(nearestSupport.representativePrice, referencePrice) : undefined;
  const overheadResistanceGapPct = nearestResistance ? distancePct(nearestResistance.representativePrice, referencePrice) : undefined;
  const nearbySupportCount = supports.filter((item) => distancePct(item.representativePrice, referencePrice) <= thresholdPct).length;
  const nearbyResistanceCount = resistances.filter((item) => distancePct(item.representativePrice, referencePrice) <= thresholdPct).length;

  if (!nearestSupport) {
    warnings.push("no_support_below_reference");
  }
  if (!nearestResistance) {
    warnings.push("no_resistance_above_reference");
  }
  if (nearestSupport && isUsableNumber(downsideSupportGapPct) && downsideSupportGapPct > thresholdPct) {
    warnings.push("wide_downside_support_gap");
  }
  if (nearestResistance && isUsableNumber(overheadResistanceGapPct) && overheadResistanceGapPct > thresholdPct) {
    warnings.push("wide_overhead_resistance_gap");
  }

  return {
    referencePrice,
    nearbySupportCount,
    nearbyResistanceCount,
    nearestSupport,
    nearestResistance,
    overheadResistanceGapPct,
    downsideSupportGapPct,
    warnings,
  };
}

function buildConfluenceSummary(items: LevelQualityAuditItem[]): LevelQualityConfluenceSummary {
  return items.reduce<LevelQualityConfluenceSummary>(
    (summary, item) => ({
      sessionConfluenceCount: summary.sessionConfluenceCount + (item.contextCounts.session > 0 ? 1 : 0),
      volumeConfluenceCount: summary.volumeConfluenceCount + (item.contextCounts.volume > 0 ? 1 : 0),
      shelfConfluenceCount: summary.shelfConfluenceCount + (item.contextCounts.shelf > 0 ? 1 : 0),
      marketContextConfluenceCount: summary.marketContextConfluenceCount + (item.contextCounts.marketContext > 0 ? 1 : 0),
    }),
    {
      sessionConfluenceCount: 0,
      volumeConfluenceCount: 0,
      shelfConfluenceCount: 0,
      marketContextConfluenceCount: 0,
    },
  );
}

function buildEnrichmentBreakdown(items: LevelQualityAuditItem[]): LevelQualityEnrichmentBreakdown {
  const breakdown: LevelQualityEnrichmentBreakdown = {
    historical: {
      enriched: 0,
      unenriched: 0,
      unenrichedLevelIds: [],
    },
    extension: {
      enriched: 0,
      unenriched: 0,
      unenrichedLevelIds: [],
    },
    synthetic: {
      enriched: 0,
      unenriched: 0,
      unenrichedLevelIds: [],
    },
  };

  for (const item of items) {
    const bucket = item.syntheticContinuationMap
      ? breakdown.synthetic
      : item.isExtension
        ? breakdown.extension
        : breakdown.historical;

    if (item.hasEnrichedAnalysis) {
      bucket.enriched += 1;
      continue;
    }

    bucket.unenriched += 1;
    bucket.unenrichedLevelIds.push(item.levelId);
  }

  return breakdown;
}

function collectDiagnostics(params: {
  intelligenceReport: LevelIntelligenceReport | undefined;
  items: LevelQualityAuditItem[];
  enrichmentBreakdown: LevelQualityEnrichmentBreakdown;
  clusteredAreas: LevelQualityCluster[];
  extensionCoverage: LevelQualityExtensionCoverage;
  nearbyCoverage: LevelQualityCoverageSummary;
}): string[] {
  const diagnostics = new Set<string>();

  if (!params.intelligenceReport) {
    diagnostics.add("level_intelligence_report_missing");
  }
  if (params.items.some((item) => !item.hasEnrichedAnalysis)) {
    diagnostics.add("unenriched_levels_present");
  }
  if (params.enrichmentBreakdown.historical.unenriched > 0) {
    diagnostics.add("unenriched_historical_levels_present");
  }
  if (params.enrichmentBreakdown.extension.unenriched > 0) {
    diagnostics.add("unenriched_extension_levels_present");
  }
  if (params.enrichmentBreakdown.synthetic.unenriched > 0) {
    diagnostics.add("unenriched_synthetic_levels_present");
  }
  if (params.items.some((item) => totalContext(item.contextCounts) === 0)) {
    diagnostics.add("levels_without_context_present");
  }
  if (params.clusteredAreas.length > 0) {
    diagnostics.add("clustered_level_areas_present");
  }
  for (const warning of params.extensionCoverage.warnings) {
    diagnostics.add(warning);
  }
  for (const warning of params.nearbyCoverage.warnings) {
    diagnostics.add(warning);
  }

  return [...diagnostics].sort();
}

export function buildLevelQualityAuditReport(
  request: BuildLevelQualityAuditReportRequest,
): LevelQualityAuditReport {
  const output = request.output;
  const profileById = profileMap(request.intelligenceReport);
  const maxItems = Math.max(1, request.maxItems ?? DEFAULT_MAX_ITEMS);
  const clusterThresholdPct = Math.max(0, request.clusterThresholdPct ?? DEFAULT_CLUSTER_THRESHOLD_PCT);
  const nearbyThresholdPct = Math.max(0, request.nearbyThresholdPct ?? DEFAULT_NEARBY_THRESHOLD_PCT);
  const extensionCoverageWarningPct = Math.max(
    0,
    request.extensionCoverageWarningPct ?? DEFAULT_EXTENSION_COVERAGE_WARNING_PCT,
  );
  const items = flattenOutput(output).map((bucketed) => buildAuditItem(bucketed, profileById.get(bucketed.level.id)));
  const supportCount = items.filter((item) => item.kind === "support").length;
  const resistanceCount = items.filter((item) => item.kind === "resistance").length;
  const extensionCount = items.filter((item) => item.isExtension).length;
  const freshLevels = items.filter((item) => item.freshness === "fresh").sort(itemSortDescending);
  const staleLevels = items.filter((item) => item.freshness === "stale").sort(itemSortAscending);
  const enrichedCount = items.filter((item) => item.hasEnrichedAnalysis).length;
  const clusteredAreas = buildClusteredAreas(items, clusterThresholdPct);
  const enrichmentBreakdown = buildEnrichmentBreakdown(items);
  const referencePrice = output.metadata.referencePrice ?? request.intelligenceReport?.referencePrice;
  const extensionCoverage = buildExtensionCoverage(output, referencePrice, extensionCoverageWarningPct);
  const nearbyCoverage = buildNearbyCoverage(items, referencePrice, nearbyThresholdPct);
  const strongConfluenceLevels = [...items]
    .filter((item) => item.confluenceCount >= 2 || totalContext(item.contextCounts) >= 2)
    .sort((left, right) => totalContext(right.contextCounts) - totalContext(left.contextCounts) || itemSortDescending(left, right))
    .slice(0, maxItems);
  const weakContextLevels = [...items]
    .filter((item) => item.confluenceCount === 0 || totalContext(item.contextCounts) === 0)
    .sort(itemSortAscending)
    .slice(0, maxItems);
  const clutterLevelIds = new Set(clusteredAreas.flatMap((cluster) => cluster.levelIds));
  const possibleClutterLevels = items
    .filter((item) => clutterLevelIds.has(item.levelId))
    .sort(itemSortAscending)
    .slice(0, maxItems);

  const reportSeed = {
    intelligenceReport: request.intelligenceReport,
    items,
    enrichmentBreakdown,
    clusteredAreas,
    extensionCoverage,
    nearbyCoverage,
  };

  return {
    symbol: output.symbol,
    generatedAt: output.generatedAt,
    referencePrice,
    summary: {
      totalLevels: items.length,
      supportCount,
      resistanceCount,
      extensionCount,
      freshCount: freshLevels.length,
      staleCount: staleLevels.length,
      enrichedCount,
      unenrichedCount: items.length - enrichedCount,
    },
    strongestLevels: [...items].sort(itemSortDescending).slice(0, maxItems),
    weakestLevels: [...items].sort(itemSortAscending).slice(0, maxItems),
    staleLevels: staleLevels.slice(0, maxItems),
    freshLevels: freshLevels.slice(0, maxItems),
    strongConfluenceLevels,
    weakContextLevels,
    enrichedLevels: items.filter((item) => item.hasEnrichedAnalysis).sort(itemSortDescending).slice(0, maxItems),
    unenrichedLevels: items.filter((item) => !item.hasEnrichedAnalysis).sort(itemSortAscending).slice(0, maxItems),
    enrichmentBreakdown,
    possibleClutterLevels,
    clusteredAreas,
    extensionCoverage,
    nearbyCoverage,
    confluenceSummary: buildConfluenceSummary(items),
    diagnostics: collectDiagnostics(reportSeed),
    safety: {
      levelOutputUnchanged: true,
      noRuntimeBehaviorChange: true,
      noScoringChange: true,
    },
  };
}
