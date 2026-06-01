import type { LevelQualityAuditBucket, LevelQualityAuditItem } from "./level-quality-audit-runner.js";

export type LevelQualityDensityClassification =
  | "sparse"
  | "balanced"
  | "dense_separated"
  | "dense_clustered";

export type LevelQualityDensitySideBias =
  | "none"
  | "support_heavy"
  | "resistance_heavy"
  | "mixed";

export type LevelQualityDensityBucket =
  | "historical"
  | "extension"
  | "synthetic";

export type LevelQualityDensityRow = Pick<
  LevelQualityAuditItem,
  | "levelId"
  | "kind"
  | "bucket"
  | "representativePrice"
  | "isExtension"
  | "syntheticContinuationMap"
>;

export type LevelQualityDensityMetricThresholds = {
  auditWindowPct: number;
  sparseBelowCount: number;
  denseAtOrAboveCount: number;
  sideHeavyShare: number;
  extensionHeavyShare: number;
};

export type LevelQualityDensityMetricInput = {
  rows: readonly LevelQualityDensityRow[];
  referencePrice?: number;
  diagnostics?: readonly string[];
  clusteredAreaCount?: number;
  thresholds?: Partial<LevelQualityDensityMetricThresholds>;
};

export type LevelQualityDensityMetric = {
  schemaVersion: "level-quality-density-metric/v1";
  classification: LevelQualityDensityClassification;
  sideBias: LevelQualityDensitySideBias;
  auditWindowPct: number;
  referencePrice?: number;
  totalRows: number;
  rowsInsideAuditWindow: number;
  counts: {
    support: number;
    resistance: number;
    historical: number;
    extension: number;
    synthetic: number;
  };
  bucketCounts: Record<LevelQualityAuditBucket, number>;
  densityBuckets: Record<LevelQualityDensityBucket, number>;
  flags: {
    clusteredAreasPresent: boolean;
    denseButSeparated: boolean;
    extensionHeavy: boolean;
    syntheticPresent: boolean;
  };
  thresholds: LevelQualityDensityMetricThresholds;
  diagnostics: string[];
  safety: {
    auditOnly: true;
    generatedLevelsUnchanged: true;
    rankingUnchanged: true;
    clusteringUnchanged: true;
    surfacedLevelsUnchanged: true;
    extensionGenerationUnchanged: true;
  };
};

const DEFAULT_THRESHOLDS: LevelQualityDensityMetricThresholds = {
  auditWindowPct: 30,
  sparseBelowCount: 6,
  denseAtOrAboveCount: 10,
  sideHeavyShare: 0.65,
  extensionHeavyShare: 0.35,
};

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isUsableNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function normalizeThresholds(
  overrides: Partial<LevelQualityDensityMetricThresholds> | undefined,
): LevelQualityDensityMetricThresholds {
  return {
    auditWindowPct: Math.max(0, overrides?.auditWindowPct ?? DEFAULT_THRESHOLDS.auditWindowPct),
    sparseBelowCount: Math.max(0, Math.floor(overrides?.sparseBelowCount ?? DEFAULT_THRESHOLDS.sparseBelowCount)),
    denseAtOrAboveCount: Math.max(
      1,
      Math.floor(overrides?.denseAtOrAboveCount ?? DEFAULT_THRESHOLDS.denseAtOrAboveCount),
    ),
    sideHeavyShare: Math.min(1, Math.max(0, overrides?.sideHeavyShare ?? DEFAULT_THRESHOLDS.sideHeavyShare)),
    extensionHeavyShare: Math.min(
      1,
      Math.max(0, overrides?.extensionHeavyShare ?? DEFAULT_THRESHOLDS.extensionHeavyShare),
    ),
  };
}

function distancePct(price: number, referencePrice: number): number {
  if (referencePrice === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(price - referencePrice) / Math.abs(referencePrice) * 100;
}

function rowsInsideAuditWindow(
  rows: readonly LevelQualityDensityRow[],
  referencePrice: number | undefined,
  auditWindowPct: number,
): LevelQualityDensityRow[] {
  if (!isUsableNumber(referencePrice)) {
    return [...rows];
  }

  return rows.filter((row) => distancePct(row.representativePrice, referencePrice) <= auditWindowPct);
}

function emptyBucketCounts(): Record<LevelQualityAuditBucket, number> {
  return {
    majorSupport: 0,
    majorResistance: 0,
    intermediateSupport: 0,
    intermediateResistance: 0,
    intradaySupport: 0,
    intradayResistance: 0,
    extensionSupport: 0,
    extensionResistance: 0,
  };
}

function classifyMapDensity(params: {
  count: number;
  clusteredAreasPresent: boolean;
  thresholds: LevelQualityDensityMetricThresholds;
}): LevelQualityDensityClassification {
  if (params.count < params.thresholds.sparseBelowCount) {
    return "sparse";
  }
  if (params.count >= params.thresholds.denseAtOrAboveCount) {
    return params.clusteredAreasPresent ? "dense_clustered" : "dense_separated";
  }

  return "balanced";
}

function classifySideBias(params: {
  support: number;
  resistance: number;
  thresholds: LevelQualityDensityMetricThresholds;
}): LevelQualityDensitySideBias {
  const total = params.support + params.resistance;
  if (total === 0) {
    return "none";
  }

  const supportShare = params.support / total;
  const resistanceShare = params.resistance / total;

  if (supportShare >= params.thresholds.sideHeavyShare) {
    return "support_heavy";
  }
  if (resistanceShare >= params.thresholds.sideHeavyShare) {
    return "resistance_heavy";
  }

  return "mixed";
}

export function classifyLevelMapDensity(input: LevelQualityDensityMetricInput): LevelQualityDensityMetric {
  const thresholds = normalizeThresholds(input.thresholds);
  const scopedRows = rowsInsideAuditWindow(input.rows, input.referencePrice, thresholds.auditWindowPct);
  const clusteredAreasPresent =
    (input.clusteredAreaCount ?? 0) > 0 ||
    (input.diagnostics ?? []).includes("clustered_level_areas_present");
  const bucketCounts = emptyBucketCounts();
  let support = 0;
  let resistance = 0;
  let historical = 0;
  let extension = 0;
  let synthetic = 0;

  for (const row of scopedRows) {
    bucketCounts[row.bucket] += 1;

    if (row.kind === "support") {
      support += 1;
    } else {
      resistance += 1;
    }

    if (row.syntheticContinuationMap) {
      synthetic += 1;
    } else if (row.isExtension) {
      extension += 1;
    } else {
      historical += 1;
    }
  }

  const classification = classifyMapDensity({
    count: scopedRows.length,
    clusteredAreasPresent,
    thresholds,
  });
  const extensionShare = scopedRows.length === 0 ? 0 : extension / scopedRows.length;
  const denseButSeparated = classification === "dense_separated";
  const diagnostics = [
    `density_classification:${classification}`,
    `density_side_bias:${classifySideBias({ support, resistance, thresholds })}`,
    ...(denseButSeparated ? ["dense_but_separated_level_map"] : []),
    ...(synthetic > 0 ? ["synthetic_rows_present"] : []),
    ...(extensionShare >= thresholds.extensionHeavyShare ? ["extension_heavy_level_map"] : []),
  ];

  return {
    schemaVersion: "level-quality-density-metric/v1",
    classification,
    sideBias: classifySideBias({ support, resistance, thresholds }),
    auditWindowPct: thresholds.auditWindowPct,
    ...(isUsableNumber(input.referencePrice) ? { referencePrice: input.referencePrice } : {}),
    totalRows: input.rows.length,
    rowsInsideAuditWindow: scopedRows.length,
    counts: {
      support,
      resistance,
      historical,
      extension,
      synthetic,
    },
    bucketCounts,
    densityBuckets: {
      historical,
      extension,
      synthetic,
    },
    flags: {
      clusteredAreasPresent,
      denseButSeparated,
      extensionHeavy: extensionShare >= thresholds.extensionHeavyShare,
      syntheticPresent: synthetic > 0,
    },
    thresholds: {
      ...thresholds,
      sideHeavyShare: round(thresholds.sideHeavyShare, 4),
      extensionHeavyShare: round(thresholds.extensionHeavyShare, 4),
    },
    diagnostics,
    safety: {
      auditOnly: true,
      generatedLevelsUnchanged: true,
      rankingUnchanged: true,
      clusteringUnchanged: true,
      surfacedLevelsUnchanged: true,
      extensionGenerationUnchanged: true,
    },
  };
}

export function describeLevelQualityDensityMetric(metric: LevelQualityDensityMetric): string {
  const sideText = metric.sideBias === "none" ? "no side density" : metric.sideBias.replaceAll("_", " ");
  const clusterText = metric.flags.clusteredAreasPresent ? "clustered areas present" : "no clustered areas";
  const syntheticText = metric.flags.syntheticPresent ? "synthetic rows present" : "no synthetic rows";

  return [
    `Density classification: ${metric.classification.replaceAll("_", " ")}`,
    `Rows in audit window: ${metric.rowsInsideAuditWindow}`,
    `Side density: ${sideText}`,
    `Cluster status: ${clusterText}`,
    `Synthetic status: ${syntheticText}`,
  ].join("; ");
}
