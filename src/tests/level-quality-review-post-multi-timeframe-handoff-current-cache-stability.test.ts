import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { collectProhibitedLanguageHits } from "../scripts/run-level-quality-review.js";

const deprecatedCacheRoot = "C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles";
const v2CacheRoot =
  "C:/Users/jerac/Documents/TraderLink/levels-system-post-mtf-handoff-stability/.validation-cache/candles";

const artifactPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/level-quality-review-post-mtf-handoff-current-cache-stability/latest-level-quality-review-post-mtf-handoff-current-cache-stability.json",
    import.meta.url,
  ),
);
const textArtifactPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/level-quality-review-post-mtf-handoff-current-cache-stability/latest-level-quality-review-post-mtf-handoff-current-cache-stability.txt",
    import.meta.url,
  ),
);
const sourcePath = fileURLToPath(import.meta.url);
const docPath = fileURLToPath(
  new URL(
    "../../docs/151_LEVEL_QUALITY_REVIEW_POST_MULTI_TIMEFRAME_HANDOFF_CURRENT_CACHE_STABILITY.md",
    import.meta.url,
  ),
);

type PostMtfHandoffStabilityArtifact = {
  schemaVersion: "level-quality-review-post-multi-timeframe-handoff-current-cache-stability/v1";
  gate: "level_quality_review_post_multi_timeframe_handoff_current_cache_stability";
  doc: string;
  baseMergeCommits: {
    pr148: string;
    pr149: string;
  };
  cacheRoot: string;
  localSetupNote: string;
  reviewedSymbols: string[];
  supplied15mSymbols: string[];
  supersededGateDecision: {
    staleRecommendedGate: string;
    status: string;
    doNotRestartHereWithoutNewApproval: boolean;
    completedFollowupGates: string[];
  };
  currentCacheRerun: {
    mismatchCount: number;
    nearestSupportParityCount: number;
    nearestResistanceParityCount: number;
    bucketCountParityCount: number;
    extensionCountParityCount: number;
    syntheticCountParityCount: number;
    syntheticMarkingParityCount: number;
    diagnosticsParityCount: number;
    diagnosticSemanticsParityCount: number;
    enrichmentBreakdownParityCount: number;
    extensionCoverageWarningParityCount: number;
    clusteredDensityDiagnosticParityCount: number;
    fifteenMinuteContextOnlyCount: number;
    densityMetricPresentCount: number;
    candidateInventoryPresentCount: number;
    candidateInventoryValidCount: number;
    candidateInventoryMissingCount: number;
    candidateVolumeSessionContextPresentCount: number;
    candidateVolumeSessionContextValidCount: number;
    candidateVolumeSessionContextMissingCount: number;
    sessionFactsPresentCount: number;
    volumeFactsPresentCount: number;
    volumeShelfContextPresentCount: number;
    candidateVolumeSessionMissingFactsCount: number;
    prohibitedLanguageHitCount: number;
  };
  cacheFingerprintSummary: {
    totalFingerprints: number;
    symbolCount: number;
    levelEngineInputCount: number;
    contextOnlyCount: number;
    fifteenMinuteContextOnlyCount: number;
    validationIssueCount: number;
    wrapperCandleCount: number;
    actualBarsReturned: number;
  };
  candidateVolumeSessionComparisonOutcomeCounts: Record<string, number>;
  fifteenMinutePolicy: {
    entryContextOnlyCount: number;
    fingerprintContextOnlyCount: number;
    includedInLevelEngine: boolean;
    fedIntoLevelEngine: boolean;
  };
  boundariesConfirmed: Record<string, boolean>;
  recommendedNextGate: string;
  safety: Record<string, boolean>;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
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

test("post multi-timeframe handoff stability artifact records current-cache zero mismatch", () => {
  const artifact = readJson<PostMtfHandoffStabilityArtifact>(artifactPath);

  assert.equal(artifact.schemaVersion, "level-quality-review-post-multi-timeframe-handoff-current-cache-stability/v1");
  assert.equal(artifact.gate, "level_quality_review_post_multi_timeframe_handoff_current_cache_stability");
  assert.equal(artifact.doc, "docs/151_LEVEL_QUALITY_REVIEW_POST_MULTI_TIMEFRAME_HANDOFF_CURRENT_CACHE_STABILITY.md");
  assert.equal(artifact.baseMergeCommits.pr148, "4dd82e4bfb6f7b7b8ca35bb15f625b2e62fad6ca");
  assert.equal(artifact.baseMergeCommits.pr149, "111bfab64aec6f21d56ed4162ee247c0ddb6e706");
  assert.equal(artifact.cacheRoot, v2CacheRoot);
  assert.equal(artifact.localSetupNote.includes("deprecated C:/Users/jerac/Documents/TraderLink/levels-system"), true);
  assert.equal(artifact.reviewedSymbols.length, 10);
  assert.equal(artifact.supplied15mSymbols.length, 5);
  assert.equal(artifact.currentCacheRerun.mismatchCount, 0);
  assert.equal(artifact.currentCacheRerun.prohibitedLanguageHitCount, 0);
});

test("post multi-timeframe handoff stability artifact locks cache and review coverage counts", () => {
  const artifact = readJson<PostMtfHandoffStabilityArtifact>(artifactPath);

  assert.equal(artifact.cacheFingerprintSummary.totalFingerprints, 35);
  assert.equal(artifact.cacheFingerprintSummary.symbolCount, 10);
  assert.equal(artifact.cacheFingerprintSummary.levelEngineInputCount, 30);
  assert.equal(artifact.cacheFingerprintSummary.contextOnlyCount, 5);
  assert.equal(artifact.cacheFingerprintSummary.fifteenMinuteContextOnlyCount, 5);
  assert.equal(artifact.cacheFingerprintSummary.validationIssueCount, 45);
  assert.equal(artifact.cacheFingerprintSummary.wrapperCandleCount, 6662);
  assert.equal(artifact.cacheFingerprintSummary.actualBarsReturned, 6662);

  for (const count of [
    artifact.currentCacheRerun.nearestSupportParityCount,
    artifact.currentCacheRerun.nearestResistanceParityCount,
    artifact.currentCacheRerun.bucketCountParityCount,
    artifact.currentCacheRerun.extensionCountParityCount,
    artifact.currentCacheRerun.syntheticCountParityCount,
    artifact.currentCacheRerun.syntheticMarkingParityCount,
    artifact.currentCacheRerun.diagnosticsParityCount,
    artifact.currentCacheRerun.diagnosticSemanticsParityCount,
    artifact.currentCacheRerun.enrichmentBreakdownParityCount,
    artifact.currentCacheRerun.extensionCoverageWarningParityCount,
    artifact.currentCacheRerun.clusteredDensityDiagnosticParityCount,
    artifact.currentCacheRerun.fifteenMinuteContextOnlyCount,
    artifact.currentCacheRerun.densityMetricPresentCount,
    artifact.currentCacheRerun.candidateInventoryPresentCount,
    artifact.currentCacheRerun.candidateInventoryValidCount,
    artifact.currentCacheRerun.candidateVolumeSessionContextPresentCount,
    artifact.currentCacheRerun.candidateVolumeSessionContextValidCount,
    artifact.currentCacheRerun.sessionFactsPresentCount,
    artifact.currentCacheRerun.volumeFactsPresentCount,
    artifact.currentCacheRerun.volumeShelfContextPresentCount,
  ]) {
    assert.equal(count, 10);
  }

  assert.equal(artifact.currentCacheRerun.candidateInventoryMissingCount, 0);
  assert.equal(artifact.currentCacheRerun.candidateVolumeSessionContextMissingCount, 0);
  assert.equal(artifact.currentCacheRerun.candidateVolumeSessionMissingFactsCount, 0);
  assert.deepEqual(artifact.candidateVolumeSessionComparisonOutcomeCounts, {
    surfaced_has_more_session_volume_context: 6,
    candidate_identifier_unavailable: 4,
  });
});

test("post multi-timeframe handoff stability marks stale baseline decision as superseded", () => {
  const artifact = readJson<PostMtfHandoffStabilityArtifact>(artifactPath);

  assert.equal(artifact.supersededGateDecision.staleRecommendedGate, "level_quality_review_baseline_refresh_decision");
  assert.equal(artifact.supersededGateDecision.status, "superseded_by_completed_followup_chain");
  assert.equal(artifact.supersededGateDecision.doNotRestartHereWithoutNewApproval, true);
  assert.ok(artifact.supersededGateDecision.completedFollowupGates.includes("level_quality_review_baseline_refresh_current_cache"));
  assert.ok(artifact.supersededGateDecision.completedFollowupGates.includes("level_analysis_snapshot_multi_timeframe_fixture_pack_handoff"));
  assert.ok(artifact.supersededGateDecision.completedFollowupGates.includes("pr_149_handoff_test_carry_forward"));
  assert.equal(artifact.boundariesConfirmed.baselineRefreshDecisionSuperseded, true);
  assert.equal(artifact.recommendedNextGate, "await_next_approved_levels_system_gate");
});

test("post multi-timeframe handoff stability stays facts-only source-safe and compact", () => {
  const artifact = readJson<PostMtfHandoffStabilityArtifact>(artifactPath);

  assert.ok(statSync(artifactPath).size < 12_000);
  assert.ok(statSync(textArtifactPath).size < 5_000);
  assert.deepEqual(collectProhibitedLanguageHits(artifact), []);
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
    ]),
    false,
  );
  assert.equal(artifact.fifteenMinutePolicy.entryContextOnlyCount, 10);
  assert.equal(artifact.fifteenMinutePolicy.fingerprintContextOnlyCount, 5);
  assert.equal(artifact.fifteenMinutePolicy.includedInLevelEngine, false);
  assert.equal(artifact.fifteenMinutePolicy.fedIntoLevelEngine, false);

  for (const value of Object.values(artifact.safety)) {
    assert.equal(value, false);
  }
});

test("post multi-timeframe handoff stability active resume point uses the v2-local cache root", () => {
  const artifact = readFileSync(artifactPath, "utf8");
  const textArtifact = readFileSync(textArtifactPath, "utf8");
  const doc = readFileSync(docPath, "utf8");

  for (const source of [artifact, textArtifact, doc]) {
    assert.equal(source.includes(v2CacheRoot), true);
    assert.equal(source.includes(deprecatedCacheRoot), false);
  }
});

test("post multi-timeframe handoff stability test source avoids provider cache-write alert monitoring Discord and journal imports", () => {
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
