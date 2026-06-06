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

const activeBaselinePath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json",
    import.meta.url,
  ),
);
const refreshArtifactPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/level-quality-review-baseline-refresh-current-cache/latest-level-quality-review-baseline-refresh-current-cache.json",
    import.meta.url,
  ),
);
const historicalSummaryPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/level-quality-review-baseline-refresh-current-cache/pre-refresh-active-baseline-historical-summary.json",
    import.meta.url,
  ),
);

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

test("refreshed active baseline includes valid compact cache fingerprints", () => {
  const baseline = readJson<LevelQualityReviewRunnerResult>(activeBaselinePath);
  const validation = validateLevelQualityReviewCacheFingerprintSet(baseline.cacheFingerprintSet);

  assert.equal(baseline.schemaVersion, "level-quality-review-process/v1");
  assert.equal(baseline.provider, "ibkr");
  assert.equal(baseline.reviewedSymbols.length, 10);
  assert.equal(baseline.summary.mismatchCount, 0);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assertLevelQualityReviewCacheFingerprintFactsOnly(baseline.cacheFingerprintSet);
  assert.deepEqual(
    baseline.cacheFingerprintSummary,
    summarizeLevelQualityReviewCacheFingerprints(baseline.cacheFingerprintSet),
  );
  assert.equal(baseline.cacheFingerprintSet.fingerprints.length, 35);
  assert.equal(baseline.summary.cacheFingerprintCount, 35);
  assert.equal(baseline.summary.cacheFingerprintSymbolCount, 10);
  assert.equal(baseline.summary.cacheFingerprintLevelEngineInputCount, 30);
  assert.equal(baseline.summary.cacheFingerprintContextOnlyCount, 5);
  assert.equal(baseline.summary.cacheFingerprintFifteenMinuteContextOnlyCount, 5);
});

test("refreshed active baseline preserves 15m context-only policy", () => {
  const baseline = readJson<LevelQualityReviewRunnerResult>(activeBaselinePath);
  const fifteenMinute = baseline.cacheFingerprintSet.fingerprints.filter((fingerprint) => fingerprint.timeframe === "15m");

  assert.equal(fifteenMinute.length, 5);
  assert.deepEqual(
    fifteenMinute.map((fingerprint) => fingerprint.symbol).sort(),
    ["DEVS", "DXYZ", "ENVX", "GME", "QUBT"],
  );
  for (const fingerprint of fifteenMinute) {
    assert.equal(fingerprint.contextOnly, true);
    assert.equal(fingerprint.includedInLevelEngine, false);
    assert.equal(fingerprint.safety.fifteenMinuteFedIntoLevelEngine, false);
  }
  assert.equal(baseline.safety.fifteenMinuteFedIntoLevelEngine, false);
});

test("refreshed active baseline and compact refresh artifacts avoid raw payloads and prohibited language", () => {
  const baseline = readJson<LevelQualityReviewRunnerResult>(activeBaselinePath);
  const refreshArtifact = readJson<unknown>(refreshArtifactPath);
  const historicalSummary = readJson<unknown>(historicalSummaryPath);

  for (const value of [baseline, refreshArtifact, historicalSummary]) {
    assert.equal(hasRawCandleArray(value), false);
    assert.equal(
      containsAnyKey(value, [
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
    assert.deepEqual(collectProhibitedLanguageHits(value), []);
  }
});

test("compact refresh artifact records before and after mismatch state", () => {
  const artifact = readJson<{
    refreshType: string;
    beforeRefreshComparison: { mismatchCount: number; mismatches: Array<{ symbol: string; fields: string[] }> };
    afterRefreshComparison: { mismatchCount: number; candidateInventoryValidCount: number; candidateVolumeSessionContextValidCount: number };
    cacheFingerprintSummary: { totalFingerprints: number; levelEngineInputCount: number; fifteenMinuteContextOnlyCount: number };
  }>(refreshArtifactPath);

  assert.equal(artifact.refreshType, "input_state_baseline_refresh");
  assert.equal(artifact.beforeRefreshComparison.mismatchCount, 4);
  assert.deepEqual(artifact.beforeRefreshComparison.mismatches, [
    {
      symbol: "DEVS",
      fields: ["enrichmentBreakdown"],
    },
    {
      symbol: "AIM",
      fields: ["bucketCounts", "enrichmentBreakdown"],
    },
    {
      symbol: "YMAT",
      fields: ["enrichmentBreakdown"],
    },
  ]);
  assert.equal(artifact.afterRefreshComparison.mismatchCount, 0);
  assert.equal(artifact.afterRefreshComparison.candidateInventoryValidCount, 10);
  assert.equal(artifact.afterRefreshComparison.candidateVolumeSessionContextValidCount, 10);
  assert.equal(artifact.cacheFingerprintSummary.totalFingerprints, 35);
  assert.equal(artifact.cacheFingerprintSummary.levelEngineInputCount, 30);
  assert.equal(artifact.cacheFingerprintSummary.fifteenMinuteContextOnlyCount, 5);
});
