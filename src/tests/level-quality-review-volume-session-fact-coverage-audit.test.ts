import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertLevelCandidateVolumeSessionContextFactsOnly,
  validateLevelCandidateVolumeSessionContext,
} from "../lib/levels/level-candidate-volume-session-context.js";
import {
  collectProhibitedLanguageHits,
  type LevelQualityReviewRunnerResult,
} from "../scripts/run-level-quality-review.js";

const activeReviewPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json",
    import.meta.url,
  ),
);
const auditArtifactPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/level-quality-review-volume-session-fact-coverage-audit/latest-level-quality-review-volume-session-fact-coverage-audit.json",
    import.meta.url,
  ),
);
const sourcePath = fileURLToPath(import.meta.url);

type CoverageArtifact = {
  schemaVersion: "level-quality-review-volume-session-fact-coverage-audit/v1";
  rootCoverage: {
    mismatchCount: number;
    candidateVolumeSessionContextPresentCount: number;
    candidateVolumeSessionContextValidCount: number;
    candidateVolumeSessionContextMissingCount: number;
    sessionFactsPresentCount: number;
    volumeFactsPresentCount: number;
    volumeShelfContextPresentCount: number;
    candidateVolumeSessionMissingFactsCount: number;
    restrictedLanguageHitCount: number;
  };
  rowCoverage: {
    totalRows: number;
    stageCounts: Record<string, number>;
    sideCounts: Record<string, number>;
  };
  sessionCoverage: {
    rowsWithSessionFacts: number;
    sessionFactProximityCount: number;
    factCounts: Record<string, number>;
    relationCounts: Record<string, number>;
  };
  volumeCoverage: {
    rowsWithVolumeFacts: number;
  };
  shelfCoverage: {
    rowsWithShelfOverlap: number;
    shelfOverlapCount: number;
    rowsWithoutNearbyShelf: number;
    symbolsWithNoShelfOverlapRows: string[];
  };
  comparisonOutcomeCounts: Record<string, number>;
  diagnosticCounts: Record<string, number>;
  perSymbol: Array<{
    symbol: string;
    rows: number;
    outcome: string;
    shelfOverlapRows: number;
    noNearbyShelfRows: number;
    sessionFactRows: number;
    volumeState: string;
    liquidityQuality: string;
  }>;
  bugFound: boolean;
  recommendedNextGate: string;
  safety: Record<string, boolean>;
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

test("volume session fact coverage artifact records root review coverage", () => {
  const artifact = readJson<CoverageArtifact>(auditArtifactPath);

  assert.equal(artifact.schemaVersion, "level-quality-review-volume-session-fact-coverage-audit/v1");
  assert.equal(artifact.rootCoverage.mismatchCount, 0);
  assert.equal(artifact.rootCoverage.candidateVolumeSessionContextPresentCount, 10);
  assert.equal(artifact.rootCoverage.candidateVolumeSessionContextValidCount, 10);
  assert.equal(artifact.rootCoverage.candidateVolumeSessionContextMissingCount, 0);
  assert.equal(artifact.rootCoverage.sessionFactsPresentCount, 10);
  assert.equal(artifact.rootCoverage.volumeFactsPresentCount, 10);
  assert.equal(artifact.rootCoverage.volumeShelfContextPresentCount, 10);
  assert.equal(artifact.rootCoverage.candidateVolumeSessionMissingFactsCount, 0);
  assert.equal(artifact.rootCoverage.restrictedLanguageHitCount, 0);
  assert.equal(artifact.bugFound, false);
});

test("volume session fact coverage artifact records row stage session volume and shelf counts", () => {
  const artifact = readJson<CoverageArtifact>(auditArtifactPath);

  assert.equal(artifact.rowCoverage.totalRows, 43);
  assert.deepEqual(artifact.rowCoverage.stageCounts, {
    surfaced: 20,
    extension_selected: 17,
    scored: 6,
  });
  assert.deepEqual(artifact.rowCoverage.sideCounts, {
    support: 25,
    resistance: 18,
  });
  assert.equal(artifact.sessionCoverage.rowsWithSessionFacts, 43);
  assert.equal(artifact.sessionCoverage.sessionFactProximityCount, 48);
  assert.equal(artifact.volumeCoverage.rowsWithVolumeFacts, 43);
  assert.equal(artifact.shelfCoverage.rowsWithShelfOverlap, 15);
  assert.equal(artifact.shelfCoverage.shelfOverlapCount, 26);
  assert.equal(artifact.shelfCoverage.rowsWithoutNearbyShelf, 28);
  assert.deepEqual(artifact.shelfCoverage.symbolsWithNoShelfOverlapRows, ["HCWB", "YMAT", "PHOE"]);
});

test("volume session fact coverage artifact records diagnostic and comparison limitations", () => {
  const artifact = readJson<CoverageArtifact>(auditArtifactPath);

  assert.deepEqual(artifact.comparisonOutcomeCounts, {
    surfaced_has_more_session_volume_context: 6,
    candidate_identifier_unavailable: 4,
  });
  assert.equal(artifact.diagnosticCounts.candidate_id_unavailable, 5);
  assert.equal(artifact.diagnosticCounts.surfaced_selection_reason_not_serialized, 5);
  assert.equal(artifact.diagnosticCounts.vwap_unavailable, 4);
  assert.equal(artifact.diagnosticCounts.no_nearby_volume_shelf, 10);

  const unavailable = artifact.perSymbol
    .filter((item) => item.outcome === "candidate_identifier_unavailable")
    .map((item) => item.symbol);
  assert.deepEqual(unavailable, ["QUBT", "HCWB", "AAOI", "PHOE"]);
});

test("active review volume session contexts validate and remain facts-only", () => {
  const review = readJson<LevelQualityReviewRunnerResult>(activeReviewPath);

  assert.equal(review.summary.mismatchCount, 0);
  assert.equal(review.entries.length, 10);
  for (const entry of review.entries) {
    const context = entry.candidateVolumeSessionContext;
    const validation = validateLevelCandidateVolumeSessionContext(context);
    assert.equal(validation.valid, true, `${entry.symbol}: ${validation.errors.join("; ")}`);
    assertLevelCandidateVolumeSessionContextFactsOnly(context);
    assert.equal(context.safety.volumeSessionFactsUsedForScoringOrSurfacedSelection, false);
    assert.equal(context.safety.fifteenMinuteFedIntoLevelEngine, false);
    assert.equal(context.safety.providerCallsMade, false);
    assert.equal(context.safety.cacheFilesWritten, false);
  }
});

test("volume session fact coverage artifacts stay compact and avoid restricted wording", () => {
  const artifact = readJson<CoverageArtifact>(auditArtifactPath);

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
  for (const value of Object.values(artifact.safety)) {
    assert.equal(value, false);
  }
});

test("volume session fact coverage test source does not import provider cache-write alert monitoring Discord or journal modules", () => {
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
