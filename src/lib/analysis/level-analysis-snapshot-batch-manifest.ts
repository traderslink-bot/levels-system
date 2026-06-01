import { createHash } from "node:crypto";

import {
  LEVEL_ANALYSIS_SNAPSHOT_PRODUCER,
  type LevelAnalysisSnapshot,
  type LevelAnalysisSnapshotInputTimeframe,
  type LevelAnalysisSnapshotSafety,
} from "./level-analysis-snapshot.js";

export const LEVEL_ANALYSIS_SNAPSHOT_BATCH_MANIFEST_SCHEMA_VERSION =
  "level-analysis-snapshot-batch-manifest/v1";
export const LEVEL_ANALYSIS_SNAPSHOT_BATCH_MANIFEST_PRODUCER = LEVEL_ANALYSIS_SNAPSHOT_PRODUCER;

export type LevelAnalysisSnapshotBatchManifestStatus =
  | "accepted"
  | "failed"
  | "skipped"
  | "quarantined";

export type LevelAnalysisSnapshotBatchManifestTimeframeCoverage = {
  provided: boolean;
  candleCount: number;
  filteredCandleCount: number;
  excludedFutureCandleCount: number;
  excludedPartialCandleCount: number;
};

export type LevelAnalysisSnapshotBatchManifestEntry = {
  symbol: string;
  asOfTimestamp: number;
  referencePrice?: number;
  artifactPath: string;
  artifactExists?: boolean;
  fileSizeBytes?: number;
  checksumSha256?: string;
  snapshotSchemaVersion?: string;
  snapshotProducer?: string;
  status: LevelAnalysisSnapshotBatchManifestStatus;
  validationErrors: string[];
  diagnostics: string[];
  timeframeCoverage: Record<
    LevelAnalysisSnapshotInputTimeframe,
    LevelAnalysisSnapshotBatchManifestTimeframeCoverage
  >;
  has15mInput: boolean;
  missing15mInput: boolean;
  noLookaheadApplied?: boolean;
  syntheticExtensionsClearlyMarked?: boolean;
  safety: Partial<LevelAnalysisSnapshotSafety>;
};

export type LevelAnalysisSnapshotBatchManifestSummary = {
  totalEntries: number;
  acceptedCount: number;
  failedCount: number;
  skippedCount: number;
  quarantinedCount: number;
  missing15mInputCount: number;
  with15mInputCount: number;
  timeframeAvailability: Record<LevelAnalysisSnapshotInputTimeframe, number>;
  noLookaheadAppliedCount: number;
  syntheticExtensionsClearlyMarkedCount: number;
  uniqueDiagnostics: string[];
  uniqueValidationErrors: string[];
};

export type LevelAnalysisSnapshotBatchManifestSafety = {
  noLookaheadAppliedForAccepted: boolean;
  syntheticExtensionsClearlyMarkedForAccepted: boolean;
  noRuntimeBehaviorChange: true;
};

export type LevelAnalysisSnapshotBatchManifest = {
  schemaVersion: typeof LEVEL_ANALYSIS_SNAPSHOT_BATCH_MANIFEST_SCHEMA_VERSION;
  producer: typeof LEVEL_ANALYSIS_SNAPSHOT_BATCH_MANIFEST_PRODUCER;
  batchId: string;
  generatedAt: string;
  outputRoot?: string;
  runConfig?: Record<string, unknown>;
  entries: LevelAnalysisSnapshotBatchManifestEntry[];
  summary: LevelAnalysisSnapshotBatchManifestSummary;
  diagnostics: string[];
  safety: LevelAnalysisSnapshotBatchManifestSafety;
};

export type LevelAnalysisSnapshotBatchManifestEntryInput = {
  artifactPath: string;
  snapshot?: LevelAnalysisSnapshot;
  artifactExists?: boolean;
  fileSizeBytes?: number;
  content?: string;
  status?: LevelAnalysisSnapshotBatchManifestStatus;
  validationErrors?: string[];
  diagnostics?: string[];
};

export type LevelAnalysisSnapshotBatchManifestInput = {
  batchId: string;
  generatedAt: string;
  outputRoot?: string;
  runConfig?: Record<string, unknown>;
  entries: LevelAnalysisSnapshotBatchManifestEntryInput[];
  diagnostics?: string[];
};

export type LevelAnalysisSnapshotBatchManifestValidationResult = {
  valid: boolean;
  errors: string[];
};

export type LevelAnalysisSnapshotBatchManifestBuildResult = {
  manifest: LevelAnalysisSnapshotBatchManifest;
  validation: LevelAnalysisSnapshotBatchManifestValidationResult;
};

export type DeriveLevelAnalysisSnapshotArtifactPathInput = {
  outputRoot: string;
  symbol: string;
  asOfTimestamp: number;
  fileName?: string;
};

const TIMEFRAME_KEYS: LevelAnalysisSnapshotInputTimeframe[] = ["5m", "15m", "4h", "daily"];

function normalizeSymbol(symbol: string | undefined): string {
  const normalized = symbol?.trim().toUpperCase();
  return normalized && normalized.length > 0 ? normalized : "UNKNOWN";
}

function emptyCoverage(): LevelAnalysisSnapshotBatchManifestTimeframeCoverage {
  return {
    provided: false,
    candleCount: 0,
    filteredCandleCount: 0,
    excludedFutureCandleCount: 0,
    excludedPartialCandleCount: 0,
  };
}

function deriveTimeframeCoverage(
  snapshot: LevelAnalysisSnapshot | undefined,
): Record<LevelAnalysisSnapshotInputTimeframe, LevelAnalysisSnapshotBatchManifestTimeframeCoverage> {
  const coverage = Object.fromEntries(
    TIMEFRAME_KEYS.map((timeframe) => [timeframe, emptyCoverage()]),
  ) as Record<LevelAnalysisSnapshotInputTimeframe, LevelAnalysisSnapshotBatchManifestTimeframeCoverage>;

  if (!snapshot) {
    return coverage;
  }

  for (const timeframe of TIMEFRAME_KEYS) {
    const summary = snapshot.inputSummary.timeframes[timeframe];
    coverage[timeframe] = {
      provided: summary?.provided ?? false,
      candleCount: snapshot.inputSummary.candleCounts[timeframe] ?? summary?.candleCount ?? 0,
      filteredCandleCount:
        snapshot.inputSummary.filteredCandleCounts[timeframe] ?? summary?.filteredCandleCount ?? 0,
      excludedFutureCandleCount:
        snapshot.inputSummary.excludedFutureCandleCounts[timeframe] ??
        summary?.excludedFutureCandleCount ??
        0,
      excludedPartialCandleCount:
        snapshot.inputSummary.excludedPartialCandleCounts[timeframe] ??
        summary?.excludedPartialCandleCount ??
        0,
    };
  }

  return coverage;
}

function deriveValidationErrors(params: {
  snapshot?: LevelAnalysisSnapshot;
  artifactPath: string;
  status: LevelAnalysisSnapshotBatchManifestStatus;
  suppliedErrors: string[];
}): string[] {
  const errors = new Set(params.suppliedErrors);

  if (!params.artifactPath) {
    errors.add("artifact_path_missing");
  }
  if (params.status !== "accepted") {
    return [...errors].sort();
  }

  const snapshot = params.snapshot;
  if (!snapshot) {
    errors.add("snapshot_missing");
    return [...errors].sort();
  }
  if (!String(snapshot.schemaVersion).startsWith("level-analysis-snapshot/v1")) {
    errors.add("snapshot_schema_version_invalid");
  }
  if (snapshot.producer !== LEVEL_ANALYSIS_SNAPSHOT_PRODUCER) {
    errors.add("snapshot_producer_invalid");
  }
  if (!snapshot.symbol) {
    errors.add("snapshot_symbol_missing");
  }
  if (!Number.isFinite(snapshot.asOfTimestamp)) {
    errors.add("snapshot_as_of_timestamp_invalid");
  }
  if (!snapshot.inputSummary) {
    errors.add("snapshot_input_summary_missing");
  }
  if (snapshot.safety.noLookaheadApplied !== true) {
    errors.add("snapshot_no_lookahead_not_confirmed");
  }
  if (snapshot.safety.syntheticExtensionsClearlyMarked !== true) {
    errors.add("snapshot_synthetic_extensions_not_confirmed");
  }

  return [...errors].sort();
}

export function hashLevelAnalysisSnapshotArtifact(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function deriveLevelAnalysisSnapshotArtifactPath(
  input: DeriveLevelAnalysisSnapshotArtifactPathInput,
): string {
  const root = input.outputRoot.replace(/[\\/]+$/, "");
  const fileName = input.fileName ?? "level-analysis-snapshot-v1.json";
  return `${root}/${normalizeSymbol(input.symbol)}/${input.asOfTimestamp}/${fileName}`;
}

export function buildLevelAnalysisSnapshotBatchManifestEntry(
  input: LevelAnalysisSnapshotBatchManifestEntryInput,
): LevelAnalysisSnapshotBatchManifestEntry {
  const snapshot = input.snapshot;
  const status = input.status ?? "accepted";
  const timeframeCoverage = deriveTimeframeCoverage(snapshot);
  const validationErrors = deriveValidationErrors({
    snapshot,
    artifactPath: input.artifactPath,
    status,
    suppliedErrors: input.validationErrors ?? [],
  });
  const finalStatus: LevelAnalysisSnapshotBatchManifestStatus =
    status === "accepted" && validationErrors.length > 0 ? "quarantined" : status;

  return {
    symbol: normalizeSymbol(snapshot?.symbol),
    asOfTimestamp: snapshot?.asOfTimestamp ?? 0,
    ...(snapshot?.referencePrice !== undefined ? { referencePrice: snapshot.referencePrice } : {}),
    artifactPath: input.artifactPath,
    ...(input.artifactExists !== undefined ? { artifactExists: input.artifactExists } : {}),
    ...(input.fileSizeBytes !== undefined ? { fileSizeBytes: input.fileSizeBytes } : {}),
    ...(input.content !== undefined
      ? { checksumSha256: hashLevelAnalysisSnapshotArtifact(input.content) }
      : {}),
    snapshotSchemaVersion: snapshot?.schemaVersion,
    snapshotProducer: snapshot?.producer,
    status: finalStatus,
    validationErrors,
    diagnostics: [...new Set([...(input.diagnostics ?? []), ...(snapshot?.diagnostics ?? [])])].sort(),
    timeframeCoverage,
    has15mInput: timeframeCoverage["15m"].provided && timeframeCoverage["15m"].filteredCandleCount > 0,
    missing15mInput: !timeframeCoverage["15m"].provided || timeframeCoverage["15m"].filteredCandleCount === 0,
    noLookaheadApplied: snapshot?.safety.noLookaheadApplied,
    syntheticExtensionsClearlyMarked: snapshot?.safety.syntheticExtensionsClearlyMarked,
    safety: snapshot?.safety ? { ...snapshot.safety } : {},
  };
}

export function summarizeLevelAnalysisSnapshotBatchManifest(
  entries: LevelAnalysisSnapshotBatchManifestEntry[],
): LevelAnalysisSnapshotBatchManifestSummary {
  const uniqueDiagnostics = new Set<string>();
  const uniqueValidationErrors = new Set<string>();
  const timeframeAvailability = Object.fromEntries(
    TIMEFRAME_KEYS.map((timeframe) => [
      timeframe,
      entries.filter((entry) => entry.timeframeCoverage[timeframe].filteredCandleCount > 0).length,
    ]),
  ) as Record<LevelAnalysisSnapshotInputTimeframe, number>;

  for (const entry of entries) {
    for (const diagnostic of entry.diagnostics) {
      uniqueDiagnostics.add(diagnostic);
    }
    for (const error of entry.validationErrors) {
      uniqueValidationErrors.add(error);
    }
  }

  return {
    totalEntries: entries.length,
    acceptedCount: entries.filter((entry) => entry.status === "accepted").length,
    failedCount: entries.filter((entry) => entry.status === "failed").length,
    skippedCount: entries.filter((entry) => entry.status === "skipped").length,
    quarantinedCount: entries.filter((entry) => entry.status === "quarantined").length,
    missing15mInputCount: entries.filter((entry) => entry.missing15mInput).length,
    with15mInputCount: entries.filter((entry) => entry.has15mInput).length,
    timeframeAvailability,
    noLookaheadAppliedCount: entries.filter((entry) => entry.noLookaheadApplied === true).length,
    syntheticExtensionsClearlyMarkedCount: entries.filter(
      (entry) => entry.syntheticExtensionsClearlyMarked === true,
    ).length,
    uniqueDiagnostics: [...uniqueDiagnostics].sort(),
    uniqueValidationErrors: [...uniqueValidationErrors].sort(),
  };
}

export function buildLevelAnalysisSnapshotBatchManifest(
  input: LevelAnalysisSnapshotBatchManifestInput,
): LevelAnalysisSnapshotBatchManifestBuildResult {
  const entries = input.entries.map(buildLevelAnalysisSnapshotBatchManifestEntry);
  const summary = summarizeLevelAnalysisSnapshotBatchManifest(entries);
  const acceptedEntries = entries.filter((entry) => entry.status === "accepted");
  const manifest: LevelAnalysisSnapshotBatchManifest = {
    schemaVersion: LEVEL_ANALYSIS_SNAPSHOT_BATCH_MANIFEST_SCHEMA_VERSION,
    producer: LEVEL_ANALYSIS_SNAPSHOT_BATCH_MANIFEST_PRODUCER,
    batchId: input.batchId,
    generatedAt: input.generatedAt,
    ...(input.outputRoot !== undefined ? { outputRoot: input.outputRoot } : {}),
    ...(input.runConfig !== undefined ? { runConfig: input.runConfig } : {}),
    entries,
    summary,
    diagnostics: [...new Set(input.diagnostics ?? [])].sort(),
    safety: {
      noLookaheadAppliedForAccepted: acceptedEntries.every(
        (entry) => entry.noLookaheadApplied === true,
      ),
      syntheticExtensionsClearlyMarkedForAccepted: acceptedEntries.every(
        (entry) => entry.syntheticExtensionsClearlyMarked === true,
      ),
      noRuntimeBehaviorChange: true,
    },
  };

  return {
    manifest,
    validation: validateLevelAnalysisSnapshotBatchManifest(manifest),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateLevelAnalysisSnapshotBatchManifest(
  manifest: unknown,
): LevelAnalysisSnapshotBatchManifestValidationResult {
  const errors: string[] = [];

  if (!isRecord(manifest)) {
    return { valid: false, errors: ["manifest_not_object"] };
  }
  if (manifest.schemaVersion !== LEVEL_ANALYSIS_SNAPSHOT_BATCH_MANIFEST_SCHEMA_VERSION) {
    errors.push("manifest_schema_version_invalid");
  }
  if (manifest.producer !== LEVEL_ANALYSIS_SNAPSHOT_BATCH_MANIFEST_PRODUCER) {
    errors.push("manifest_producer_invalid");
  }
  if (typeof manifest.batchId !== "string" || manifest.batchId.trim() === "") {
    errors.push("manifest_batch_id_missing");
  }
  if (typeof manifest.generatedAt !== "string" || Number.isNaN(Date.parse(manifest.generatedAt))) {
    errors.push("manifest_generated_at_invalid");
  }
  if (!Array.isArray(manifest.entries)) {
    errors.push("manifest_entries_missing");
    return { valid: errors.length === 0, errors };
  }

  const validStatuses: LevelAnalysisSnapshotBatchManifestStatus[] = [
    "accepted",
    "failed",
    "skipped",
    "quarantined",
  ];

  manifest.entries.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`entry_${index}_not_object`);
      return;
    }
    if (typeof entry.artifactPath !== "string" || entry.artifactPath.trim() === "") {
      errors.push(`entry_${index}_artifact_path_missing`);
    }
    if (!validStatuses.includes(entry.status as LevelAnalysisSnapshotBatchManifestStatus)) {
      errors.push(`entry_${index}_status_invalid`);
    }
    if (!isRecord(entry.timeframeCoverage)) {
      errors.push(`entry_${index}_timeframe_coverage_missing`);
      return;
    }
    for (const timeframe of TIMEFRAME_KEYS) {
      if (!isRecord(entry.timeframeCoverage[timeframe])) {
        errors.push(`entry_${index}_timeframe_${timeframe}_missing`);
      }
    }
  });

  if (!isRecord(manifest.summary)) {
    errors.push("manifest_summary_missing");
  }
  if (!isRecord(manifest.safety)) {
    errors.push("manifest_safety_missing");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
