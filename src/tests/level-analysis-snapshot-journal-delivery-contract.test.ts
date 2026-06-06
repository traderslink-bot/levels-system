import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertLevelQualityReviewCacheFingerprintFactsOnly,
  summarizeLevelQualityReviewCacheFingerprints,
  validateLevelQualityReviewCacheFingerprintSet,
} from "../lib/analysis/level-quality-review-cache-fingerprint.js";
import {
  assertLevelCandidateInventoryReviewVisibilityFactsOnly,
  validateLevelCandidateInventoryReviewVisibilityWrapper,
} from "../lib/levels/level-candidate-inventory-review-wiring.js";
import {
  assertLevelCandidateVolumeSessionContextFactsOnly,
  validateLevelCandidateVolumeSessionContext,
} from "../lib/levels/level-candidate-volume-session-context.js";
import {
  assertLevelQualityDensityMetricFactsOnly,
  validateLevelQualityDensityMetric,
} from "../lib/levels/level-quality-density-metric.js";
import {
  collectProhibitedLanguageHits,
  type LevelQualityReviewRunnerResult,
} from "../scripts/run-level-quality-review.js";

const deliveryArtifactPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/journal-delivery-contract/latest-level-analysis-snapshot-journal-delivery-contract.json",
    import.meta.url,
  ),
);
const deliveryTextPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/journal-delivery-contract/latest-level-analysis-snapshot-journal-delivery-contract.txt",
    import.meta.url,
  ),
);
const currentReviewPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json",
    import.meta.url,
  ),
);
const coverageAuditPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/level-quality-review-volume-session-fact-coverage-audit/latest-level-quality-review-volume-session-fact-coverage-audit.json",
    import.meta.url,
  ),
);
const sourcePath = fileURLToPath(import.meta.url);

type JournalDeliveryContractArtifact = {
  schemaVersion: "level-analysis-snapshot-journal-delivery-contract/v1";
  producer: "levels-system";
  consumer: "traderlink-intelligence-journal";
  provider: "ibkr";
  sourceArtifacts: Record<string, string>;
  reviewedSymbols: string[];
  supplied15mSymbols: string[];
  deliverySections: {
    identityFields: string[];
    perSymbolFields: string[];
    additiveReviewFields: string[];
    journalViewSections: string[];
  };
  currentReadinessEvidence: Record<string, number>;
  coverageSummary: {
    volumeSessionRows: number;
    surfacedRows: number;
    extensionSelectedRows: number;
    scoredRows: number;
    supportRows: number;
    resistanceRows: number;
    rowsWithSessionFacts: number;
    rowsWithVolumeFacts: number;
    rowsWithShelfOverlap: number;
    shelfOverlapCount: number;
    rowsWithoutNearbyShelf: number;
    candidateVolumeSessionComparisonOutcomeCounts: Record<string, number>;
  };
  journalConnectorValidation: Record<string, boolean>;
  knownLimitations: string[];
  safety: Record<string, boolean>;
  recommendedNextGate: string;
};

type CoverageAuditArtifact = {
  rootCoverage: {
    mismatchCount: number;
    candidateVolumeSessionContextPresentCount: number;
    candidateVolumeSessionContextValidCount: number;
    sessionFactsPresentCount: number;
    volumeFactsPresentCount: number;
    volumeShelfContextPresentCount: number;
    restrictedLanguageHitCount: number;
  };
  rowCoverage: {
    totalRows: number;
    stageCounts: Record<string, number>;
    sideCounts: Record<string, number>;
  };
  shelfCoverage: {
    rowsWithShelfOverlap: number;
    shelfOverlapCount: number;
    rowsWithoutNearbyShelf: number;
  };
  comparisonOutcomeCounts: Record<string, number>;
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

test("journal delivery contract artifact defines the current source package", () => {
  const artifact = readJson<JournalDeliveryContractArtifact>(deliveryArtifactPath);

  assert.equal(artifact.schemaVersion, "level-analysis-snapshot-journal-delivery-contract/v1");
  assert.equal(artifact.producer, "levels-system");
  assert.equal(artifact.consumer, "traderlink-intelligence-journal");
  assert.equal(artifact.provider, "ibkr");
  assert.equal(artifact.reviewedSymbols.length, 10);
  assert.deepEqual(artifact.supplied15mSymbols, ["DEVS", "ENVX", "DXYZ", "QUBT", "GME"]);
  assert.equal(
    artifact.sourceArtifacts.currentReviewPackage,
    "docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json",
  );
  for (const field of [
    "cacheFingerprintSet",
    "cacheFingerprintSummary",
    "densityMetric",
    "candidateInventoryVisibility",
    "candidateVolumeSessionContext",
  ]) {
    assert.ok(artifact.deliverySections.additiveReviewFields.includes(field), `Missing field ${field}`);
  }
  assert.equal(artifact.recommendedNextGate, "level_analysis_snapshot_journal_delivery_handoff");
});

test("current review package satisfies the journal delivery field contract", () => {
  const review = readJson<LevelQualityReviewRunnerResult>(currentReviewPath);

  assert.equal(review.provider, "ibkr");
  assert.equal(review.entries.length, 10);
  assert.equal(review.summary.mismatchCount, 0);
  assert.equal(review.summary.densityMetricPresentCount, 10);
  assert.equal(review.summary.candidateInventoryPresentCount, 10);
  assert.equal(review.summary.candidateInventoryValidCount, 10);
  assert.equal(review.summary.candidateVolumeSessionContextPresentCount, 10);
  assert.equal(review.summary.candidateVolumeSessionContextValidCount, 10);
  assert.equal(review.summary.cacheFingerprintCount, 35);
  assert.equal(review.summary.cacheFingerprintLevelEngineInputCount, 30);
  assert.equal(review.summary.cacheFingerprintContextOnlyCount, 5);
  assert.equal(review.summary.cacheFingerprintFifteenMinuteContextOnlyCount, 5);
  assert.equal(review.summary.prohibitedLanguageHitCount, 0);

  const fingerprintValidation = validateLevelQualityReviewCacheFingerprintSet(review.cacheFingerprintSet);
  assert.equal(fingerprintValidation.valid, true, fingerprintValidation.errors.join("; "));
  assertLevelQualityReviewCacheFingerprintFactsOnly(review.cacheFingerprintSet);
  assert.deepEqual(review.cacheFingerprintSummary, summarizeLevelQualityReviewCacheFingerprints(review.cacheFingerprintSet));

  for (const entry of review.entries) {
    assert.equal(entry.provider, "ibkr");
    assert.equal(entry.fifteenMinuteContext.stillContextOnly, true);

    const densityMetric = entry.qualityAudit.densityMetric;
    assert.equal(densityMetric?.present, true, `${entry.symbol}: density metric missing`);
    if (densityMetric?.present === true) {
      const densityValidation = validateLevelQualityDensityMetric(densityMetric);
      assert.equal(densityValidation.valid, true, `${entry.symbol}: ${densityValidation.errors.join("; ")}`);
      assertLevelQualityDensityMetricFactsOnly(densityMetric);
    }

    const inventoryValidation = validateLevelCandidateInventoryReviewVisibilityWrapper(
      entry.candidateInventoryVisibility,
    );
    assert.equal(inventoryValidation.valid, true, `${entry.symbol}: ${inventoryValidation.errors.join("; ")}`);
    assertLevelCandidateInventoryReviewVisibilityFactsOnly(entry.candidateInventoryVisibility);

    const contextValidation = validateLevelCandidateVolumeSessionContext(entry.candidateVolumeSessionContext);
    assert.equal(contextValidation.valid, true, `${entry.symbol}: ${contextValidation.errors.join("; ")}`);
    assertLevelCandidateVolumeSessionContextFactsOnly(entry.candidateVolumeSessionContext);
    assert.equal(entry.candidateVolumeSessionContext.safety.volumeSessionFactsUsedForScoringOrSurfacedSelection, false);
    assert.equal(entry.candidateVolumeSessionContext.safety.fifteenMinuteFedIntoLevelEngine, false);
  }
});

test("journal delivery contract locks readiness evidence from current audit artifacts", () => {
  const artifact = readJson<JournalDeliveryContractArtifact>(deliveryArtifactPath);
  const review = readJson<LevelQualityReviewRunnerResult>(currentReviewPath);
  const audit = readJson<CoverageAuditArtifact>(coverageAuditPath);

  assert.equal(artifact.currentReadinessEvidence.totalSymbols, review.summary.totalSymbols);
  assert.equal(artifact.currentReadinessEvidence.mismatchCount, review.summary.mismatchCount);
  assert.equal(artifact.currentReadinessEvidence.cacheFingerprintCount, review.summary.cacheFingerprintCount);
  assert.equal(
    artifact.currentReadinessEvidence.fifteenMinuteContextOnlyFingerprintCount,
    review.summary.cacheFingerprintFifteenMinuteContextOnlyCount,
  );
  assert.equal(
    artifact.currentReadinessEvidence.candidateVolumeSessionContextValidCount,
    audit.rootCoverage.candidateVolumeSessionContextValidCount,
  );
  assert.equal(artifact.currentReadinessEvidence.restrictedLanguageHitCount, audit.rootCoverage.restrictedLanguageHitCount);
  assert.equal(artifact.coverageSummary.volumeSessionRows, audit.rowCoverage.totalRows);
  assert.equal(artifact.coverageSummary.surfacedRows, audit.rowCoverage.stageCounts.surfaced);
  assert.equal(artifact.coverageSummary.extensionSelectedRows, audit.rowCoverage.stageCounts.extension_selected);
  assert.equal(artifact.coverageSummary.scoredRows, audit.rowCoverage.stageCounts.scored);
  assert.equal(artifact.coverageSummary.supportRows, audit.rowCoverage.sideCounts.support);
  assert.equal(artifact.coverageSummary.resistanceRows, audit.rowCoverage.sideCounts.resistance);
  assert.equal(artifact.coverageSummary.rowsWithShelfOverlap, audit.shelfCoverage.rowsWithShelfOverlap);
  assert.deepEqual(
    artifact.coverageSummary.candidateVolumeSessionComparisonOutcomeCounts,
    audit.comparisonOutcomeCounts,
  );
});

test("journal delivery contract artifacts stay compact and source-safe", () => {
  const artifact = readJson<JournalDeliveryContractArtifact>(deliveryArtifactPath);

  assert.ok(statSync(deliveryArtifactPath).size < 20_000);
  assert.ok(statSync(deliveryTextPath).size < 6_000);
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
      "entries",
      "cacheFingerprintSet",
      "candidateInventoryVisibility",
      "candidateVolumeSessionContext",
    ]),
    false,
  );
  assert.deepEqual(collectProhibitedLanguageHits(artifact), []);
  for (const value of Object.values(artifact.safety)) {
    assert.equal(value, false);
  }
});

test("journal delivery contract test source does not import provider cache-write alert monitoring Discord or journal modules", () => {
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
