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

const handoffArtifactPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/journal-delivery-handoff/latest-level-analysis-snapshot-journal-delivery-handoff.json",
    import.meta.url,
  ),
);
const handoffTextPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/journal-delivery-handoff/latest-level-analysis-snapshot-journal-delivery-handoff.txt",
    import.meta.url,
  ),
);
const deliveryContractArtifactPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/journal-delivery-contract/latest-level-analysis-snapshot-journal-delivery-contract.json",
    import.meta.url,
  ),
);
const primaryArtifactPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json",
    import.meta.url,
  ),
);
const sourcePath = fileURLToPath(import.meta.url);

type HandoffArtifact = {
  schemaVersion: "level-analysis-snapshot-journal-delivery-handoff/v1";
  producer: "levels-system";
  consumer: "traderlink-intelligence-journal";
  provider: "ibkr";
  primaryArtifactForJournalApp: string;
  baseParserFixture: string;
  deliveryContractDoc: string;
  deliveryContractArtifact: string;
  coverageAuditArtifact: string;
  reviewedSymbols: string[];
  supplied15mSymbols: string[];
  handoffSummary: Record<string, boolean>;
  readinessEvidence: Record<string, number>;
  stableFieldsToConsumeFirst: string[];
  journalSideValidationChecklist: string[];
  limitationsToSurface: string[];
  safety: Record<string, boolean>;
  nextStep: string;
  nextStepRepo: string;
};

type DeliveryContractArtifact = {
  schemaVersion: "level-analysis-snapshot-journal-delivery-contract/v1";
  sourceArtifacts: {
    currentReviewPackage: string;
    compactSnapshotFixture: string;
    coverageAudit: string;
  };
  currentReadinessEvidence: Record<string, number>;
  recommendedNextGate: string;
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

test("journal delivery handoff artifact points journal Codex to the current primary artifact", () => {
  const handoff = readJson<HandoffArtifact>(handoffArtifactPath);
  const contract = readJson<DeliveryContractArtifact>(deliveryContractArtifactPath);

  assert.equal(handoff.schemaVersion, "level-analysis-snapshot-journal-delivery-handoff/v1");
  assert.equal(handoff.producer, "levels-system");
  assert.equal(handoff.consumer, "traderlink-intelligence-journal");
  assert.equal(handoff.provider, "ibkr");
  assert.equal(handoff.primaryArtifactForJournalApp, contract.sourceArtifacts.currentReviewPackage);
  assert.equal(handoff.baseParserFixture, contract.sourceArtifacts.compactSnapshotFixture);
  assert.equal(handoff.coverageAuditArtifact, contract.sourceArtifacts.coverageAudit);
  assert.equal(handoff.deliveryContractArtifact.endsWith("latest-level-analysis-snapshot-journal-delivery-contract.json"), true);
  assert.equal(handoff.nextStep, "journal_level_analysis_delivery_ingestion");
  assert.equal(handoff.nextStepRepo, "traderlink-intelligence-journal");
});

test("journal delivery handoff readiness matches the locked delivery contract and primary artifact", () => {
  const handoff = readJson<HandoffArtifact>(handoffArtifactPath);
  const contract = readJson<DeliveryContractArtifact>(deliveryContractArtifactPath);
  const primary = readJson<LevelQualityReviewRunnerResult>(primaryArtifactPath);

  assert.deepEqual(handoff.reviewedSymbols, primary.reviewedSymbols);
  assert.deepEqual(handoff.supplied15mSymbols, primary.supplied15mSymbols);
  assert.equal(handoff.readinessEvidence.totalSymbols, primary.summary.totalSymbols);
  assert.equal(handoff.readinessEvidence.mismatchCount, primary.summary.mismatchCount);
  assert.equal(handoff.readinessEvidence.cacheFingerprintCount, primary.summary.cacheFingerprintCount);
  assert.equal(
    handoff.readinessEvidence.fifteenMinuteContextOnlyFingerprintCount,
    primary.summary.cacheFingerprintFifteenMinuteContextOnlyCount,
  );
  assert.equal(
    handoff.readinessEvidence.candidateVolumeSessionContextValidCount,
    contract.currentReadinessEvidence.candidateVolumeSessionContextValidCount,
  );
  assert.equal(handoff.handoffSummary.deliveryContractDefined, true);
  assert.equal(handoff.handoffSummary.primaryArtifactReady, true);
  assert.equal(handoff.handoffSummary.journalAppFilesChanged, false);
});

test("journal delivery handoff primary artifact remains valid and facts-only", () => {
  const primary = readJson<LevelQualityReviewRunnerResult>(primaryArtifactPath);

  assert.equal(primary.provider, "ibkr");
  assert.equal(primary.summary.mismatchCount, 0);
  assert.equal(primary.entries.length, 10);
  assert.equal(primary.summary.prohibitedLanguageHitCount, 0);

  const fingerprintValidation = validateLevelQualityReviewCacheFingerprintSet(primary.cacheFingerprintSet);
  assert.equal(fingerprintValidation.valid, true, fingerprintValidation.errors.join("; "));
  assertLevelQualityReviewCacheFingerprintFactsOnly(primary.cacheFingerprintSet);
  assert.deepEqual(primary.cacheFingerprintSummary, summarizeLevelQualityReviewCacheFingerprints(primary.cacheFingerprintSet));

  for (const entry of primary.entries) {
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
    assert.equal(entry.candidateVolumeSessionContext.safety.fifteenMinuteFedIntoLevelEngine, false);
    assert.equal(entry.candidateVolumeSessionContext.safety.volumeSessionFactsUsedForScoringOrSurfacedSelection, false);
  }
});

test("journal delivery handoff artifacts stay compact source-safe and boundary-safe", () => {
  const handoff = readJson<HandoffArtifact>(handoffArtifactPath);

  assert.ok(statSync(handoffArtifactPath).size < 18_000);
  assert.ok(statSync(handoffTextPath).size < 5_000);
  assert.equal(hasRawCandleArray(handoff), false);
  assert.equal(
    containsAnyKey(handoff, [
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
  assert.deepEqual(collectProhibitedLanguageHits(handoff), []);
  for (const value of Object.values(handoff.safety)) {
    assert.equal(value, false);
  }
});

test("journal delivery handoff test source does not import provider cache-write alert monitoring Discord or journal modules", () => {
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
