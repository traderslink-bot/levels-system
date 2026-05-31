import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { LevelAnalysisSnapshot } from "../lib/analysis/level-analysis-snapshot.js";
import { runLevelAnalysisSnapshotRunner } from "../scripts/run-level-analysis-snapshot.js";

const DOC_ROOT = new URL("../../docs/", import.meta.url);
const SNAPSHOT_EXAMPLE_ROOT = new URL("../../docs/examples/level-analysis-snapshot/", import.meta.url);

function fixturePath(name: string): string {
  return fileURLToPath(new URL(name, SNAPSHOT_EXAMPLE_ROOT));
}

function docPath(name: string): string {
  return fileURLToPath(new URL(name, DOC_ROOT));
}

function withTempDir<T>(callback: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "level-analysis-snapshot-packaging-"));

  try {
    return callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readPackageJson(): {
  scripts?: Record<string, string>;
} {
  return JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as {
    scripts?: Record<string, string>;
  };
}

function collectStringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, out);
    }
    return out;
  }

  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      collectStringValues(item, out);
    }
  }

  return out;
}

function assertNoProhibitedDownstreamLanguage(snapshot: LevelAnalysisSnapshot): void {
  const text = collectStringValues(snapshot).join("\n").toLowerCase();

  for (const [label, pattern] of [
    ["recommendation", /\brecommendation\b/],
    ["coaching", /\bcoaching\b/],
    ["grading", /\bgrading\b/],
    ["p/l", /\bp\/l\b|\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior scoring", /\bbehavior scoring\b/],
    ["trade advice", /\btrade advice\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} language in runner output.`);
  }
}

test("package exposes stable LevelAnalysisSnapshot runner scripts", () => {
  const scripts = readPackageJson().scripts ?? {};

  assert.equal(scripts["snapshot:level-analysis"], "tsx src/scripts/run-level-analysis-snapshot.ts");
  assert.equal(
    scripts["snapshot:level-analysis:review"],
    "tsx src/scripts/run-level-analysis-snapshot.ts --symbol SNAP --as-of 2026-05-01T10:20:00-04:00 --reference-price 10.68 --candles-5m docs/examples/level-analysis-snapshot/sample-5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/sample-4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/sample-daily-candles.json --previous-close 9.1 --out docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json",
  );
});

test("packaged runner produces v1 handoff fields from deterministic fixtures", () => withTempDir((dir) => {
  const outPath = join(dir, "level-analysis-snapshot-v1.json");
  const result = runLevelAnalysisSnapshotRunner({
    symbol: "SNAP",
    asOfTimestamp: Date.parse("2026-05-01T10:20:00-04:00"),
    referencePrice: 10.68,
    candles5mPath: fixturePath("sample-5m-candles.json"),
    candles4hPath: fixturePath("sample-4h-candles.json"),
    candlesDailyPath: fixturePath("sample-daily-candles.json"),
    previousClose: 9.1,
    outPath,
    format: "json",
  });

  const snapshot = result.snapshot;

  assert.equal(snapshot.schemaVersion, "level-analysis-snapshot/v1");
  assert.equal(snapshot.producer, "levels-system");
  assert.equal(snapshot.symbol, "SNAP");
  assert.equal(snapshot.referencePrice, 10.68);
  assert.ok(snapshot.inputSummary);
  assert.ok("nearestSupport" in snapshot);
  assert.ok("nearestResistance" in snapshot);
  assert.ok(snapshot.levelEngineOutput);
  assert.ok(snapshot.levelIntelligenceReport);
  assert.ok(snapshot.levelQualityAudit);
  assert.ok(Array.isArray(snapshot.diagnostics));
  assert.equal(snapshot.safety.noLookaheadApplied, true);
  assert.equal(snapshot.safety.levelOutputUnchanged, true);
  assert.equal(snapshot.safety.factsOnlyVWAP, true);
  assert.equal(snapshot.safety.shelvesAreFactsOnly, true);
  assert.equal(snapshot.safety.syntheticExtensionsClearlyMarked, true);
  assertNoProhibitedDownstreamLanguage(snapshot);
}));

test("runner packaging docs describe commands output conventions and downstream fixture", () => {
  const packagingDoc = readFileSync(docPath("85_PRODUCTION_SNAPSHOT_RUNNER_PACKAGING.md"), "utf8");
  const usageDoc = readFileSync(fixturePath("RUNNER_USAGE.md"), "utf8");

  for (const text of [packagingDoc, usageDoc]) {
    assert.ok(text.includes("npm run snapshot:level-analysis"));
    assert.ok(text.includes("npm run snapshot:level-analysis:review"));
    assert.ok(text.includes("level-analysis-snapshot/v1"));
    assert.ok(text.includes("producer"));
    assert.ok(text.includes("safety.noLookaheadApplied"));
    assert.ok(text.includes("docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json"));
  }

  assert.ok(packagingDoc.includes("artifacts/level-analysis-snapshot/<symbol>/<asOfTimestamp>/level-analysis-snapshot-v1.json"));
  assert.ok(usageDoc.includes("artifacts/level-analysis-snapshot/<symbol>/<asOfTimestamp>/level-analysis-snapshot-v1.json"));
});
