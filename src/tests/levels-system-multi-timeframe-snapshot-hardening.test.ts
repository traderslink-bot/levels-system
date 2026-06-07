import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const HARDENING_ARTIFACT_URL = new URL(
  "../../docs/examples/level-analysis-snapshot/multi-timeframe-snapshot-hardening/latest-levels-system-multi-timeframe-snapshot-hardening.json",
  import.meta.url,
);
const COVERAGE_AUDIT_URL = new URL(
  "../../docs/examples/level-analysis-snapshot/level-quality-review-volume-session-fact-coverage-audit/latest-level-quality-review-volume-session-fact-coverage-audit.json",
  import.meta.url,
);
const FIFTEEN_MINUTE_VALIDATION_URL = new URL(
  "../../docs/examples/level-analysis-snapshot/timeframe-facts/15m-supplied-real-cache-validation/latest-15m-supplied-real-cache-validation.json",
  import.meta.url,
);

type HardeningArtifact = {
  schemaVersion: string;
  gate: string;
  journalConsumerStatus: {
    prNumber: number;
    state: string;
    consumerPathStable: boolean;
  };
  existingUnmergedBranchReview: {
    branch: string;
    openPrFound: boolean;
    adoptedInThisGate: boolean;
  };
  currentSnapshotStatus: {
    schemaVersion: string;
    timeframesReserved: string[];
    fifteenMinuteFedIntoLevelEngine: boolean;
    levelEngineEligibleTimeframes: string[];
  };
  lockedEvidence: {
    supplied15mValidation: {
      factsValidCount: number;
      levelEngineParityPassedCount: number;
      providerByTimeframeIncludes15m: boolean;
    };
    journalDeliveryEvidence: {
      reviewedSymbolCount: number;
      baselineMismatchCount: number;
      candidateVolumeSessionContextPresentCount: number;
      candidateVolumeSessionContextValidCount: number;
      restrictedLanguageHitCount: number;
      fifteenMinuteContextOnlyFingerprintCount: number;
    };
  };
  decision: {
    behaviorChangeApproved: boolean;
    nextGate: string;
  };
  safety: Record<string, boolean>;
};

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as T;
}

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

test("multi-timeframe hardening artifact locks current resume decision", () => {
  const artifact = readJson<HardeningArtifact>(HARDENING_ARTIFACT_URL);

  assert.equal(artifact.schemaVersion, "levels-system-multi-timeframe-snapshot-hardening/v1");
  assert.equal(artifact.gate, "levels_system_multi_timeframe_snapshot_hardening");
  assert.equal(artifact.journalConsumerStatus.prNumber, 54);
  assert.equal(artifact.journalConsumerStatus.state, "MERGED");
  assert.equal(artifact.journalConsumerStatus.consumerPathStable, true);
  assert.equal(
    artifact.existingUnmergedBranchReview.branch,
    "codex/levels-system-multi-timeframe-snapshot-hardening-v2",
  );
  assert.equal(artifact.existingUnmergedBranchReview.openPrFound, false);
  assert.equal(artifact.existingUnmergedBranchReview.adoptedInThisGate, false);
  assert.equal(artifact.currentSnapshotStatus.schemaVersion, "level-analysis-snapshot/v1");
  assert.deepEqual(artifact.currentSnapshotStatus.timeframesReserved, ["5m", "15m", "4h", "daily"]);
  assert.equal(artifact.currentSnapshotStatus.fifteenMinuteFedIntoLevelEngine, false);
  assert.deepEqual(artifact.currentSnapshotStatus.levelEngineEligibleTimeframes, ["daily", "4h", "5m"]);
  assert.equal(artifact.decision.behaviorChangeApproved, false);
  assert.equal(artifact.decision.nextGate, "level_analysis_snapshot_multi_timeframe_fixture_pack");
});

test("hardening artifact matches current committed 15m and journal delivery evidence", () => {
  const artifact = readJson<HardeningArtifact>(HARDENING_ARTIFACT_URL);
  const supplied15m = readJson<{
    summary: {
      factsValidCount: number;
      levelEngineParityPassedCount: number;
    };
    perSymbol: Array<{
      parity: {
        providerByTimeframeIncludes15m: boolean;
      };
    }>;
  }>(FIFTEEN_MINUTE_VALIDATION_URL);
  const coverage = readJson<{
    rootCoverage: {
      mismatchCount: number;
      candidateVolumeSessionContextPresentCount: number;
      candidateVolumeSessionContextValidCount: number;
      restrictedLanguageHitCount: number;
    };
    reviewedSymbols: string[];
    cacheFingerprintSummary: {
      fifteenMinuteContextOnlyCount: number;
    };
  }>(COVERAGE_AUDIT_URL);

  assert.equal(artifact.lockedEvidence.supplied15mValidation.factsValidCount, supplied15m.summary.factsValidCount);
  assert.equal(
    artifact.lockedEvidence.supplied15mValidation.levelEngineParityPassedCount,
    supplied15m.summary.levelEngineParityPassedCount,
  );
  assert.equal(
    supplied15m.perSymbol.some((entry) => entry.parity.providerByTimeframeIncludes15m),
    artifact.lockedEvidence.supplied15mValidation.providerByTimeframeIncludes15m,
  );
  assert.equal(artifact.lockedEvidence.journalDeliveryEvidence.reviewedSymbolCount, coverage.reviewedSymbols.length);
  assert.equal(artifact.lockedEvidence.journalDeliveryEvidence.baselineMismatchCount, coverage.rootCoverage.mismatchCount);
  assert.equal(
    artifact.lockedEvidence.journalDeliveryEvidence.candidateVolumeSessionContextPresentCount,
    coverage.rootCoverage.candidateVolumeSessionContextPresentCount,
  );
  assert.equal(
    artifact.lockedEvidence.journalDeliveryEvidence.candidateVolumeSessionContextValidCount,
    coverage.rootCoverage.candidateVolumeSessionContextValidCount,
  );
  assert.equal(
    artifact.lockedEvidence.journalDeliveryEvidence.restrictedLanguageHitCount,
    coverage.rootCoverage.restrictedLanguageHitCount,
  );
  assert.equal(
    artifact.lockedEvidence.journalDeliveryEvidence.fifteenMinuteContextOnlyFingerprintCount,
    coverage.cacheFingerprintSummary.fifteenMinuteContextOnlyCount,
  );
});

test("from-candles source keeps 15m outside LevelEngine series", () => {
  const source = readSource("lib/analysis/level-analysis-snapshot-from-candles.ts");

  assert.match(source, /function isEngineSeries\(item: FilteredSeries\): item is EngineFilteredSeries \{\s*return item\.timeframe !== "15m";\s*\}/);
  assert.match(source, /const levelEngineSeries = series\.filter\(isEngineSeries\);/);
  assert.match(source, /series: levelEngineSeries/);
  assert.match(source, /const timeframeFacts = fifteenMinute\.provided/);
  assert.doesNotMatch(source, /timeframeConfig\["15m"\]/);
});

test("snapshot runner remains local and isolated from provider alert monitoring Discord and journal paths", () => {
  const runnerSource = readSource("scripts/run-level-analysis-snapshot.ts").toLowerCase();

  assert.equal(runnerSource.includes("candle-fetch-service"), false);
  assert.equal(runnerSource.includes("provider-factory"), false);
  assert.equal(runnerSource.includes("../alerts"), false);
  assert.equal(runnerSource.includes("../monitoring"), false);
  assert.equal(runnerSource.includes("discord"), false);
  assert.equal(runnerSource.includes("journal"), false);
  assert.equal(runnerSource.includes("fetch("), false);
  assert.equal(runnerSource.includes("date.now"), false);
});

test("hardening safety flags confirm no behavior or cache changes", () => {
  const artifact = readJson<HardeningArtifact>(HARDENING_ARTIFACT_URL);

  for (const [key, value] of Object.entries(artifact.safety)) {
    assert.equal(value, false, `${key} should remain false`);
  }
});
