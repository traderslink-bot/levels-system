import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertLevelQualityReviewCacheFingerprintFactsOnly,
  summarizeLevelQualityReviewCacheFingerprints,
  validateLevelQualityReviewCacheFingerprintSet,
} from "../lib/analysis/level-quality-review-cache-fingerprint.js";
import {
  collectProhibitedLanguageHits,
  type LevelQualityReviewRunnerResult,
} from "../scripts/run-level-quality-review.js";

const refreshedBaselinePath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json",
    import.meta.url,
  ),
);
const stabilityArtifactPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/level-quality-review-post-refresh-stability-check/latest-level-quality-review-post-refresh-stability-check.json",
    import.meta.url,
  ),
);
const sourcePath = fileURLToPath(import.meta.url);

type StabilityArtifact = {
  schemaVersion: "level-quality-review-post-refresh-stability-check/v1";
  baselinePath: string;
  runPlan: {
    fixedTimestamp: string;
    fixedRunCount: number;
    timestampVariant: string;
  };
  fixedTimestampDeterminism: {
    status: string;
    runHashes: Array<{ run: string; sha256: string }>;
  };
  timestampVariantMetadata: {
    status: string;
    normalizedFields: string[];
  };
  runResults: Array<{
    run: string;
    generatedAt: string;
    mismatchCount: number;
    cacheFingerprintCount: number;
    cacheFingerprintSymbolCount: number;
    cacheFingerprintLevelEngineInputCount: number;
    cacheFingerprintContextOnlyCount: number;
    cacheFingerprintFifteenMinuteContextOnlyCount: number;
    cacheFingerprintValidationIssueCount: number;
    wrapperCandleCount: number;
    actualBarsReturned: number;
  }>;
  stableSummary: {
    mismatchCountPerRun: number[];
    candidateInventoryValidCount: number;
    candidateVolumeSessionContextValidCount: number;
    prohibitedLanguageHitCount: number;
  };
  fifteenMinutePolicy: {
    contextOnlyCount: number;
    includedInLevelEngine: boolean;
    fedIntoLevelEngine: boolean;
  };
  safety: {
    baselineRefreshedAgain: boolean;
    rawCandlesIncluded: boolean;
    rawCacheWrapperPayloadsIncluded: boolean;
    fullSnapshotsIncluded: boolean;
    rawCacheFilesCommitted: boolean;
    cacheFilesWritten: boolean;
    supportResistanceDetectionChanged: boolean;
    levelEngineScoringRankingClusteringChanged: boolean;
    surfacedLevelsChangedByCode: boolean;
    extensionGenerationChanged: boolean;
    fifteenMinuteFedIntoLevelEngine: boolean;
    volumeSessionFactsUsedForSelection: boolean;
  };
};

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function hasRawCandleArray(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "timestamp" in item &&
        "open" in item &&
        "high" in item &&
        "low" in item &&
        "close" in item &&
        "volume" in item,
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(hasRawCandleArray);
  }

  return false;
}

function containsAnyKey(value: unknown, keys: readonly string[]): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsAnyKey(item, keys));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(([key, child]) => keys.includes(key) || containsAnyKey(child, keys));
  }

  return false;
}

test("post-refresh stability artifact records repeatable zero-mismatch runs", () => {
  const artifact = readJson<StabilityArtifact>(stabilityArtifactPath);

  assert.equal(artifact.schemaVersion, "level-quality-review-post-refresh-stability-check/v1");
  assert.equal(artifact.runPlan.fixedTimestamp, "2026-06-06T14:00:00.000Z");
  assert.equal(artifact.runPlan.fixedRunCount, 3);
  assert.equal(artifact.runPlan.timestampVariant, "2026-06-06T14:01:00.000Z");
  assert.equal(artifact.fixedTimestampDeterminism.status, "byte_identical");
  assert.equal(new Set(artifact.fixedTimestampDeterminism.runHashes.map((item) => item.sha256)).size, 1);
  assert.equal(artifact.timestampVariantMetadata.status, "only_allowed_timestamp_fields_changed");
  assert.deepEqual(artifact.stableSummary.mismatchCountPerRun, [0, 0, 0, 0]);
  assert.equal(artifact.stableSummary.candidateInventoryValidCount, 10);
  assert.equal(artifact.stableSummary.candidateVolumeSessionContextValidCount, 10);
  assert.equal(artifact.stableSummary.prohibitedLanguageHitCount, 0);
});

test("post-refresh stability artifact records stable cache fingerprint totals", () => {
  const artifact = readJson<StabilityArtifact>(stabilityArtifactPath);

  assert.equal(artifact.runResults.length, 4);
  for (const result of artifact.runResults) {
    assert.equal(result.mismatchCount, 0);
    assert.equal(result.cacheFingerprintCount, 35);
    assert.equal(result.cacheFingerprintSymbolCount, 10);
    assert.equal(result.cacheFingerprintLevelEngineInputCount, 30);
    assert.equal(result.cacheFingerprintContextOnlyCount, 5);
    assert.equal(result.cacheFingerprintFifteenMinuteContextOnlyCount, 5);
    assert.equal(result.cacheFingerprintValidationIssueCount, 45);
    assert.equal(result.wrapperCandleCount, 6662);
    assert.equal(result.actualBarsReturned, 6662);
  }
});

test("refreshed active baseline remains fingerprint-valid and 15m context-only", () => {
  const baseline = readJson<LevelQualityReviewRunnerResult>(refreshedBaselinePath);
  const validation = validateLevelQualityReviewCacheFingerprintSet(baseline.cacheFingerprintSet);

  assert.equal(validation.valid, true, validation.errors.join("; "));
  assertLevelQualityReviewCacheFingerprintFactsOnly(baseline.cacheFingerprintSet);
  assert.deepEqual(
    baseline.cacheFingerprintSummary,
    summarizeLevelQualityReviewCacheFingerprints(baseline.cacheFingerprintSet),
  );
  assert.equal(baseline.summary.mismatchCount, 0);
  assert.equal(baseline.summary.cacheFingerprintCount, 35);
  assert.equal(baseline.summary.cacheFingerprintFifteenMinuteContextOnlyCount, 5);

  const fifteenMinute = baseline.cacheFingerprintSet.fingerprints.filter((fingerprint) => fingerprint.timeframe === "15m");
  assert.equal(fifteenMinute.length, 5);
  for (const fingerprint of fifteenMinute) {
    assert.equal(fingerprint.contextOnly, true);
    assert.equal(fingerprint.includedInLevelEngine, false);
    assert.equal(fingerprint.safety.fifteenMinuteFedIntoLevelEngine, false);
  }
});

test("post-refresh stability artifacts stay compact facts-only and safe", () => {
  const artifact = readJson<StabilityArtifact>(stabilityArtifactPath);

  assert.equal(hasRawCandleArray(artifact), false);
  assert.equal(
    containsAnyKey(artifact, [
      "candles",
      "cacheWrapper",
      "cacheWrapperPayload",
      "rawCacheWrapper",
      "rawCacheWrapperPayload",
      "fullSnapshot",
      "levelAnalysisSnapshot",
      "levelEngineOutput",
    ]),
    false,
  );
  assert.deepEqual(collectProhibitedLanguageHits(artifact), []);
  assert.equal(artifact.fifteenMinutePolicy.contextOnlyCount, 5);
  assert.equal(artifact.fifteenMinutePolicy.includedInLevelEngine, false);
  assert.equal(artifact.fifteenMinutePolicy.fedIntoLevelEngine, false);

  for (const value of Object.values(artifact.safety)) {
    assert.equal(value, false);
  }
});

test("post-refresh stability test source does not import provider cache-write alert monitoring Discord or journal modules", () => {
  const source = readFileSync(sourcePath, "utf8").toLowerCase();
  const importLines = source
    .split("\n")
    .filter((line) => line.trim().startsWith("import "))
    .join("\n");

  for (const blocked of [
    "../alerts/",
    "../monitoring/",
    "../trader-context/",
    "provider-factory",
    "fetch(",
    "writefile",
    "discord",
    "journal",
  ]) {
    assert.equal(importLines.includes(blocked), false, `Unexpected source import: ${blocked}`);
  }
});
