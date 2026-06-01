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

export type LevelQualityDensityMetricValidationResult = {
  valid: boolean;
  errors: string[];
};

const DEFAULT_THRESHOLDS: LevelQualityDensityMetricThresholds = {
  auditWindowPct: 30,
  sparseBelowCount: 6,
  denseAtOrAboveCount: 10,
  sideHeavyShare: 0.65,
  extensionHeavyShare: 0.35,
};

const LEVEL_QUALITY_DENSITY_CLASSIFICATIONS: readonly LevelQualityDensityClassification[] = [
  "sparse",
  "balanced",
  "dense_separated",
  "dense_clustered",
];

const LEVEL_QUALITY_DENSITY_SIDE_BIASES: readonly LevelQualityDensitySideBias[] = [
  "none",
  "support_heavy",
  "resistance_heavy",
  "mixed",
];

const LEVEL_QUALITY_AUDIT_BUCKETS: readonly LevelQualityAuditBucket[] = [
  "majorSupport",
  "majorResistance",
  "intermediateSupport",
  "intermediateResistance",
  "intradaySupport",
  "intradayResistance",
  "extensionSupport",
  "extensionResistance",
];

const LEVEL_QUALITY_DENSITY_BUCKETS: readonly LevelQualityDensityBucket[] = [
  "historical",
  "extension",
  "synthetic",
];

const FACTUAL_ONLY_BLOCKED_PATTERNS: ReadonlyArray<[label: string, pattern: RegExp]> = [
  ["buy", /\bbuy\b/i],
  ["sell", /\bsell\b/i],
  ["hold", /\bhold\b/i],
  ["recommendation", /\brecommendation\b/i],
  ["trade advice", /\btrade\s+advice\b/i],
  ["grade", /\bgrade\b|\bgrading\b/i],
  ["coaching", /\bcoaching\b|\bcoach\b/i],
  ["p/l", /\bp\/l\b|\bpnl\b/i],
  ["giveback", /\bgiveback\b/i],
  ["behavior score", /\bbehavior score\b|\bbehavior scoring\b/i],
  ["good trade", /\bgood trade\b/i],
  ["bad trade", /\bbad trade\b/i],
  ["should have", /\bshould have\b/i],
  ["mistake", /\bmistake\b/i],
  ["discipline", /\bdiscipline\b/i],
];

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isUsableNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isClassification(value: unknown): value is LevelQualityDensityClassification {
  return typeof value === "string" && LEVEL_QUALITY_DENSITY_CLASSIFICATIONS.includes(value as LevelQualityDensityClassification);
}

function isSideBias(value: unknown): value is LevelQualityDensitySideBias {
  return typeof value === "string" && LEVEL_QUALITY_DENSITY_SIDE_BIASES.includes(value as LevelQualityDensitySideBias);
}

function validateNonNegativeNumberField(
  errors: string[],
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const fieldValue = value[key];
  if (!isNonNegativeNumber(fieldValue)) {
    errors.push(`${key} must be a non-negative finite number`);
    return undefined;
  }

  return fieldValue;
}

function validateNumberRecord(
  errors: string[],
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, number> | undefined {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return undefined;
  }

  const result: Record<string, number> = {};
  for (const key of keys) {
    const fieldValue = value[key];
    if (!isNonNegativeNumber(fieldValue)) {
      errors.push(`${label}.${key} must be a non-negative finite number`);
      continue;
    }
    result[key] = fieldValue;
  }

  return result;
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

export function validateLevelQualityDensityMetric(value: unknown): LevelQualityDensityMetricValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return {
      valid: false,
      errors: ["metric must be an object"],
    };
  }

  if (value.schemaVersion !== "level-quality-density-metric/v1") {
    errors.push("schemaVersion must be level-quality-density-metric/v1");
  }
  if (!isClassification(value.classification)) {
    errors.push("classification must be a known density classification");
  }
  if (!isSideBias(value.sideBias)) {
    errors.push("sideBias must be a known density side bias");
  }

  validateNonNegativeNumberField(errors, value, "auditWindowPct");
  const totalRows = validateNonNegativeNumberField(errors, value, "totalRows");
  const rowsInsideAuditWindow = validateNonNegativeNumberField(errors, value, "rowsInsideAuditWindow");
  if (value.referencePrice !== undefined && !isNonNegativeNumber(value.referencePrice)) {
    errors.push("referencePrice must be a non-negative finite number when present");
  }
  if (totalRows !== undefined && rowsInsideAuditWindow !== undefined && rowsInsideAuditWindow > totalRows) {
    errors.push("rowsInsideAuditWindow cannot exceed totalRows");
  }

  const counts = validateNumberRecord(
    errors,
    value.counts,
    ["support", "resistance", "historical", "extension", "synthetic"],
    "counts",
  );
  const bucketCounts = validateNumberRecord(errors, value.bucketCounts, LEVEL_QUALITY_AUDIT_BUCKETS, "bucketCounts");
  const densityBuckets = validateNumberRecord(errors, value.densityBuckets, LEVEL_QUALITY_DENSITY_BUCKETS, "densityBuckets");
  const thresholds = validateNumberRecord(
    errors,
    value.thresholds,
    ["auditWindowPct", "sparseBelowCount", "denseAtOrAboveCount", "sideHeavyShare", "extensionHeavyShare"],
    "thresholds",
  );

  if (isRecord(value.flags)) {
    for (const key of ["clusteredAreasPresent", "denseButSeparated", "extensionHeavy", "syntheticPresent"]) {
      if (typeof value.flags[key] !== "boolean") {
        errors.push(`flags.${key} must be boolean`);
      }
    }
  } else {
    errors.push("flags must be an object");
  }

  if (isRecord(value.safety)) {
    for (const key of [
      "auditOnly",
      "generatedLevelsUnchanged",
      "rankingUnchanged",
      "clusteringUnchanged",
      "surfacedLevelsUnchanged",
      "extensionGenerationUnchanged",
    ]) {
      if (value.safety[key] !== true) {
        errors.push(`safety.${key} must be true`);
      }
    }
  } else {
    errors.push("safety must be an object");
  }

  if (!Array.isArray(value.diagnostics) || value.diagnostics.some((diagnostic) => typeof diagnostic !== "string")) {
    errors.push("diagnostics must be an array of strings");
  }

  if (counts && rowsInsideAuditWindow !== undefined) {
    if (counts.support + counts.resistance !== rowsInsideAuditWindow) {
      errors.push("support and resistance counts must equal rowsInsideAuditWindow");
    }
    if (counts.historical + counts.extension + counts.synthetic !== rowsInsideAuditWindow) {
      errors.push("historical extension and synthetic counts must equal rowsInsideAuditWindow");
    }
  }

  if (counts && densityBuckets) {
    for (const key of LEVEL_QUALITY_DENSITY_BUCKETS) {
      if (counts[key] !== densityBuckets[key]) {
        errors.push(`densityBuckets.${key} must match counts.${key}`);
      }
    }
  }

  if (isRecord(value.flags) && counts && thresholds && rowsInsideAuditWindow !== undefined) {
    const extensionShare = rowsInsideAuditWindow === 0 ? 0 : counts.extension / rowsInsideAuditWindow;
    if (value.flags.syntheticPresent !== counts.synthetic > 0) {
      errors.push("flags.syntheticPresent must match synthetic count");
    }
    if (value.flags.denseButSeparated !== (value.classification === "dense_separated")) {
      errors.push("flags.denseButSeparated must match dense_separated classification");
    }
    if (value.flags.extensionHeavy !== extensionShare >= thresholds.extensionHeavyShare) {
      errors.push("flags.extensionHeavy must match extension share threshold");
    }
  }

  if (Array.isArray(value.diagnostics) && isClassification(value.classification) && isSideBias(value.sideBias)) {
    if (!value.diagnostics.includes(`density_classification:${value.classification}`)) {
      errors.push("diagnostics must include density_classification for the classification");
    }
    if (!value.diagnostics.includes(`density_side_bias:${value.sideBias}`)) {
      errors.push("diagnostics must include density_side_bias for the side bias");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function isLevelQualityDensityMetric(value: unknown): value is LevelQualityDensityMetric {
  return validateLevelQualityDensityMetric(value).valid;
}

export function assertLevelQualityDensityMetricFactsOnly(value: unknown): asserts value is LevelQualityDensityMetric {
  const validation = validateLevelQualityDensityMetric(value);
  if (!validation.valid) {
    throw new Error(`Invalid level quality density metric: ${validation.errors.join("; ")}`);
  }

  const text = JSON.stringify(value);
  const hits = FACTUAL_ONLY_BLOCKED_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);

  if (hits.length > 0) {
    throw new Error(`Density metric contains non-factual wording: ${hits.join(", ")}`);
  }
}
