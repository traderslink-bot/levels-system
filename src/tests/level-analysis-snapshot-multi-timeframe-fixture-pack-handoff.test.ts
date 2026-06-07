import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const handoffArtifactPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/multi-timeframe-fixture-pack/latest-level-analysis-snapshot-multi-timeframe-fixture-pack-handoff.json",
    import.meta.url,
  ),
);
const handoffTextPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/multi-timeframe-fixture-pack/latest-level-analysis-snapshot-multi-timeframe-fixture-pack-handoff.txt",
    import.meta.url,
  ),
);
const fixturePackSummaryPath = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/multi-timeframe-fixture-pack/latest-level-analysis-snapshot-multi-timeframe-fixture-pack.json",
    import.meta.url,
  ),
);
const fixtureDirectoryPath = fileURLToPath(
  new URL("../../docs/examples/level-analysis-snapshot/multi-timeframe-fixture-pack/fixtures/", import.meta.url),
);

type HandoffArtifact = {
  schemaVersion: "level-analysis-snapshot-multi-timeframe-fixture-pack-handoff/v1";
  gate: "level_analysis_snapshot_multi_timeframe_fixture_pack_handoff";
  handoffDoc: string;
  sourceArtifacts: string[];
  fixtureDirectory: string;
  fixtures: Array<{ fixtureName: string; proves: string[] }>;
  lockedState: {
    snapshotSchemaVersion: "level-analysis-snapshot/v1";
    reservedInputSummaryTimeframes: string[];
    levelEngineEligibleTimeframes: string[];
    activeCandleProvider: "IBKR";
    fifteenMinuteFactsOnly: boolean;
    journalReplayAsOfSafetyCovered: boolean;
  };
  coverage: Record<string, boolean | number>;
  limitations: string[];
  futureUseRules: string[];
  recommendedNextGate: string;
  safety: Record<string, boolean>;
};

type FixturePackSummary = {
  schemaVersion: "level-analysis-snapshot-multi-timeframe-fixture-pack/v1";
  fixtureDirectory: string;
  fixtures: Array<{ fixtureName: string; path: string }>;
  coverage: Record<string, boolean | number>;
  recommendedNextGate: string;
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

test("multi-timeframe fixture pack handoff artifact locks fixture pack boundaries", () => {
  const handoff = readJson<HandoffArtifact>(handoffArtifactPath);
  const summary = readJson<FixturePackSummary>(fixturePackSummaryPath);

  assert.equal(handoff.schemaVersion, "level-analysis-snapshot-multi-timeframe-fixture-pack-handoff/v1");
  assert.equal(handoff.gate, "level_analysis_snapshot_multi_timeframe_fixture_pack_handoff");
  assert.equal(handoff.handoffDoc, "docs/150_LEVEL_ANALYSIS_SNAPSHOT_MULTI_TIMEFRAME_FIXTURE_PACK_HANDOFF.md");
  assert.equal(handoff.fixtureDirectory, summary.fixtureDirectory);
  assert.equal(handoff.fixtures.length, 5);
  assert.deepEqual(
    handoff.fixtures.map((fixture) => fixture.fixtureName).sort(),
    summary.fixtures.map((fixture) => fixture.fixtureName).sort(),
  );
  assert.equal(handoff.recommendedNextGate, "level_quality_review_baseline_refresh_decision");

  for (const fixture of handoff.fixtures) {
    assert.equal(existsSync(`${fixtureDirectoryPath}${fixture.fixtureName}.json`), true, fixture.fixtureName);
    assert.ok(fixture.proves.length > 0, fixture.fixtureName);
  }
});

test("multi-timeframe fixture pack handoff preserves 15m facts-only and LevelEngine boundaries", () => {
  const handoff = readJson<HandoffArtifact>(handoffArtifactPath);

  assert.equal(handoff.lockedState.snapshotSchemaVersion, "level-analysis-snapshot/v1");
  assert.deepEqual(handoff.lockedState.reservedInputSummaryTimeframes, ["5m", "15m", "4h", "daily"]);
  assert.deepEqual(handoff.lockedState.levelEngineEligibleTimeframes, ["daily", "4h", "5m"]);
  assert.equal(handoff.lockedState.activeCandleProvider, "IBKR");
  assert.equal(handoff.lockedState.fifteenMinuteFactsOnly, true);
  assert.equal(handoff.lockedState.journalReplayAsOfSafetyCovered, true);
  assert.equal(handoff.coverage.fixtureCount, 5);
  assert.equal(handoff.coverage.levelEngineParityCovered, true);
  assert.equal(handoff.coverage.nearestLevelParityCovered, true);
  assert.ok(handoff.futureUseRules.includes("keep 15m facts-only unless a separate approved gate changes eligibility"));
  assert.ok(handoff.futureUseRules.includes("keep volume/session facts outside scoring and surfaced selection"));
});

test("multi-timeframe fixture pack handoff stays compact and source-safe", () => {
  const handoff = readJson<HandoffArtifact>(handoffArtifactPath);

  assert.ok(statSync(handoffArtifactPath).size < 12_000);
  assert.ok(statSync(handoffTextPath).size < 5_000);
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
    ]),
    false,
  );

  for (const value of Object.values(handoff.safety)) {
    assert.equal(value, false);
  }
});
