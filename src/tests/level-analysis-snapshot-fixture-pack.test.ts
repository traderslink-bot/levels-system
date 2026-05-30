import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { LevelAnalysisSnapshot } from "../lib/analysis/level-analysis-snapshot.js";
import type { FinalLevelZone } from "../lib/levels/level-types.js";

type SnapshotFixture = {
  id: string;
  outputFile: string;
};

const FIXTURES: SnapshotFixture[] = [
  { id: "low-price-runner", outputFile: "low-price-runner-snapshot.json" },
  { id: "clean-technical", outputFile: "clean-technical-snapshot.json" },
  { id: "choppy-range", outputFile: "choppy-range-snapshot.json" },
  { id: "thin-liquidity", outputFile: "thin-liquidity-snapshot.json" },
  { id: "higher-priced", outputFile: "higher-priced-snapshot.json" },
];

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../docs/examples/level-analysis-snapshot/fixtures/", import.meta.url),
);
const OUTPUT_ROOT = fileURLToPath(
  new URL("../../docs/examples/level-analysis-snapshot/outputs/", import.meta.url),
);

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function snapshotPath(fileName: string): string {
  return `${OUTPUT_ROOT}${fileName}`;
}

function metadataPath(id: string): string {
  return `${FIXTURE_ROOT}${id}/metadata.json`;
}

function allLevels(snapshot: LevelAnalysisSnapshot): FinalLevelZone[] {
  return [
    ...snapshot.levelEngineOutput.majorSupport,
    ...snapshot.levelEngineOutput.majorResistance,
    ...snapshot.levelEngineOutput.intermediateSupport,
    ...snapshot.levelEngineOutput.intermediateResistance,
    ...snapshot.levelEngineOutput.intradaySupport,
    ...snapshot.levelEngineOutput.intradayResistance,
    ...snapshot.levelEngineOutput.extensionLevels.support,
    ...snapshot.levelEngineOutput.extensionLevels.resistance,
  ];
}

function assertNoForbiddenContractLanguage(snapshot: LevelAnalysisSnapshot): void {
  const text = JSON.stringify(snapshot).toLowerCase();

  assert.equal(text.includes("discord"), false, "snapshot should not contain Discord fields");
  assert.equal(text.includes("monitoring"), false, "snapshot should not contain monitoring fields");
  assert.equal(text.includes("alert"), false, "snapshot should not contain alert fields");

  for (const [label, pattern] of [
    ["good trade", /good trade/],
    ["bad trade", /bad trade/],
    ["coaching", /\bcoaching\b/],
    ["p/l", /p\/l/],
    ["giveback", /\bgiveback\b/],
    ["grading", /\bgrading\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} wording`);
  }
}

function assertSyntheticExtensionsAreMarked(snapshot: LevelAnalysisSnapshot): void {
  const synthetic = allLevels(snapshot).filter(
    (level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map",
  );

  for (const level of synthetic) {
    const limitations = level.extensionMetadata?.evidenceLimitations ?? [];

    assert.equal(level.isExtension, true);
    assert.equal(level.touchCount, 0);
    assert.equal(level.confluenceCount, 0);
    assert.ok(level.notes.join(" ").toLowerCase().includes("synthetic continuation-map"));
    assert.ok(level.notes.join(" ").toLowerCase().includes("not historical support/resistance"));
    assert.ok(limitations.includes("no_touch_or_rejection_history"));
    assert.ok(limitations.includes("no_historical_confluence"));
  }

  if (synthetic.length > 0) {
    assert.equal(snapshot.safety.syntheticExtensionsClearlyMarked, true);
  }
}

test("multi-scenario fixture metadata and snapshots exist", () => {
  for (const fixture of FIXTURES) {
    assert.equal(existsSync(metadataPath(fixture.id)), true, `missing metadata for ${fixture.id}`);
    assert.equal(existsSync(snapshotPath(fixture.outputFile)), true, `missing snapshot for ${fixture.id}`);
  }
});

for (const fixture of FIXTURES) {
  test(`${fixture.id} snapshot has stable journal contract shape`, () => {
    const metadata = readJson<{
      symbol: string;
      scenarioId: string;
      deterministic: boolean;
      networkCalls: boolean;
    }>(metadataPath(fixture.id));
    const snapshot = readJson<LevelAnalysisSnapshot>(snapshotPath(fixture.outputFile));

    assert.equal(metadata.scenarioId, fixture.id);
    assert.equal(metadata.deterministic, true);
    assert.equal(metadata.networkCalls, false);

    assert.equal(snapshot.schemaVersion, "level-analysis-snapshot/v1");
    assert.equal(snapshot.producer, "levels-system");
    assert.equal(snapshot.symbol, metadata.symbol);
    assert.ok(snapshot.inputSummary);
    assert.ok(Array.isArray(snapshot.inputSummary.timeframesPresent));
    assert.equal(typeof snapshot.inputSummary.previousCloseProvided, "boolean");
    assert.equal(Object.hasOwn(snapshot, "nearestSupport"), true);
    assert.equal(Object.hasOwn(snapshot, "nearestResistance"), true);
    assert.ok(snapshot.levelEngineOutput);
    assert.ok(snapshot.levelIntelligenceReport);
    assert.ok(snapshot.levelQualityAudit);
    assert.equal(snapshot.safety.noLookaheadApplied, true);
    assert.equal(snapshot.safety.levelOutputUnchanged, true);
    assert.equal(snapshot.safety.factsOnlyVWAP, true);
    assert.equal(snapshot.safety.shelvesAreFactsOnly, true);

    assertSyntheticExtensionsAreMarked(snapshot);
    assertNoForbiddenContractLanguage(snapshot);
  });
}

test("fixture pack covers multiple scenario symbols and at least one synthetic extension", () => {
  const snapshots = FIXTURES.map((fixture) => readJson<LevelAnalysisSnapshot>(snapshotPath(fixture.outputFile)));
  const symbols = new Set(snapshots.map((snapshot) => snapshot.symbol));
  const syntheticCount = snapshots
    .flatMap(allLevels)
    .filter((level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map").length;

  assert.equal(symbols.size, FIXTURES.length);
  assert.ok(syntheticCount > 0, "fixture pack should include synthetic continuation-map coverage");
});
