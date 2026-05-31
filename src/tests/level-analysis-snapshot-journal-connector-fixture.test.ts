import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { LevelAnalysisSnapshot } from "../lib/analysis/level-analysis-snapshot.js";
import type { FinalLevelZone } from "../lib/levels/level-types.js";

const FIXTURE_PATH = fileURLToPath(
  new URL(
    "../../docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json",
    import.meta.url,
  ),
);
const MAX_CONNECTOR_FIXTURE_BYTES = 50_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  assert.equal(isRecord(value), true, `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function readFixture(): LevelAnalysisSnapshot {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as LevelAnalysisSnapshot;
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

function assertNearestShape(value: unknown, label: string): void {
  if (value === null) {
    return;
  }

  const nearest = requireRecord(value, label);
  for (const [field, type] of [
    ["levelId", "string"],
    ["kind", "string"],
    ["bucket", "string"],
    ["representativePrice", "number"],
    ["zoneLow", "number"],
    ["zoneHigh", "number"],
    ["strengthScore", "number"],
    ["strengthLabel", "string"],
    ["distanceFromReferencePct", "number"],
    ["isExtension", "boolean"],
  ] as const) {
    assert.equal(typeof nearest[field], type, `${label}.${field} must be ${type}.`);
  }
}

function assertCanonicalBuckets(snapshot: LevelAnalysisSnapshot): void {
  const output = requireRecord(snapshot.levelEngineOutput, "levelEngineOutput");

  for (const bucket of [
    "majorSupport",
    "majorResistance",
    "intermediateSupport",
    "intermediateResistance",
    "intradaySupport",
    "intradayResistance",
  ]) {
    assert.equal(Array.isArray(output[bucket]), true, `levelEngineOutput.${bucket} must be an array.`);
  }

  const extensionLevels = requireRecord(output.extensionLevels, "levelEngineOutput.extensionLevels");
  assert.equal(Array.isArray(extensionLevels.support), true);
  assert.equal(Array.isArray(extensionLevels.resistance), true);
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

  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      collectStringValues(item, out);
    }
  }

  return out;
}

function assertNoConnectorAntiGoalLanguage(snapshot: LevelAnalysisSnapshot): void {
  const text = collectStringValues(snapshot).join("\n").toLowerCase();

  for (const [label, pattern] of [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["enter", /\benter\b/],
    ["exit", /\bexit\b/],
    ["good trade", /\bgood trade\b/],
    ["bad trade", /\bbad trade\b/],
    ["coaching", /\bcoaching\b/],
    ["p/l", /\bp\/l\b/],
    ["giveback", /\bgiveback\b/],
    ["grading", /\bgrading\b/],
    ["recommendation", /\brecommendation\b/],
    ["behavior scoring", /\bbehavior scoring\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} language in fixture text.`);
  }
}

test("journal connector fixture exists, parses, and stays compact", () => {
  assert.equal(existsSync(FIXTURE_PATH), true);

  const fixtureSize = statSync(FIXTURE_PATH).size;
  assert.ok(
    fixtureSize > 0 && fixtureSize <= MAX_CONNECTOR_FIXTURE_BYTES,
    `Fixture should stay compact for connector tests: ${fixtureSize} bytes.`,
  );

  assert.doesNotThrow(() => readFixture());
});

test("journal connector fixture includes locked v1 connector checklist fields", () => {
  const snapshot = readFixture();

  assert.equal(snapshot.schemaVersion.startsWith("level-analysis-snapshot/v1"), true);
  assert.equal(snapshot.producer, "levels-system");
  assert.equal(typeof snapshot.symbol, "string");
  assert.equal(typeof snapshot.asOfTimestamp, "number");
  assert.equal(typeof snapshot.referencePrice, "number");

  assert.ok(snapshot.inputSummary);
  assert.ok(Array.isArray(snapshot.inputSummary.timeframesPresent));
  assert.ok(snapshot.inputSummary.candleCounts);
  assert.ok(snapshot.inputSummary.filteredCandleCounts);
  assert.ok(snapshot.inputSummary.excludedFutureCandleCounts);
  assert.ok(snapshot.inputSummary.excludedPartialCandleCounts);
  assert.equal(typeof snapshot.inputSummary.previousCloseProvided, "boolean");

  assert.ok("nearestSupport" in snapshot);
  assert.ok("nearestResistance" in snapshot);
  assertNearestShape(snapshot.nearestSupport, "nearestSupport");
  assertNearestShape(snapshot.nearestResistance, "nearestResistance");

  assertCanonicalBuckets(snapshot);
  assert.ok(snapshot.sessionFacts);
  assert.ok(snapshot.volumeFacts);
  assert.equal(Array.isArray(snapshot.volumeShelves), true);
  assert.ok(snapshot.marketContext);
  assert.ok(snapshot.factsBundle);
  assert.ok(snapshot.levelIntelligenceReport);
  assert.ok(snapshot.levelQualityAudit);
  assert.equal(Array.isArray(snapshot.diagnostics), true);
});

test("journal connector fixture safety flags are present for downstream use", () => {
  const snapshot = readFixture();

  assert.equal(snapshot.safety.noLookaheadApplied, true);
  assert.equal(snapshot.safety.levelOutputUnchanged, true);
  assert.equal(snapshot.safety.factsOnlyVWAP, true);
  assert.equal(snapshot.safety.shelvesAreFactsOnly, true);
  assert.equal(snapshot.safety.syntheticExtensionsClearlyMarked, true);
  assert.equal(snapshot.safety.noRuntimeBehaviorChange, true);
});

test("journal connector fixture includes real levels and clearly marked synthetic rows", () => {
  const snapshot = readFixture();
  const levels = allLevels(snapshot);
  const realLevels = levels.filter((level) => level.extensionMetadata?.extensionSource !== "synthetic_continuation_map");
  const syntheticLevels = levels.filter(
    (level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map",
  );

  assert.ok(realLevels.length > 0, "Fixture should include at least one real/historical level.");
  assert.ok(syntheticLevels.length > 0, "Fixture should include synthetic continuation-map coverage.");

  for (const level of syntheticLevels) {
    const notes = level.notes.join(" ").toLowerCase();
    const limitations = level.extensionMetadata?.evidenceLimitations ?? [];

    assert.equal(level.isExtension, true);
    assert.equal(level.touchCount, 0);
    assert.equal(level.confluenceCount, 0);
    assert.equal(level.extensionMetadata?.extensionSource, "synthetic_continuation_map");
    assert.ok(notes.includes("synthetic continuation-map"));
    assert.ok(notes.includes("not historical support/resistance"));
    assert.ok(limitations.includes("not_historical_support_resistance"));
    assert.ok(limitations.includes("no_touch_or_rejection_history"));
    assert.ok(limitations.includes("no_historical_confluence"));
  }
});

test("journal connector fixture stays factual and avoids downstream-owned language", () => {
  const snapshot = readFixture();
  const rawText = readFileSync(FIXTURE_PATH, "utf8").toLowerCase();

  assert.equal(rawText.includes("discord"), false, "fixture should not contain Discord fields or wording");
  assert.equal(rawText.includes("alert"), false, "fixture should not contain alert fields or wording");
  assert.equal(rawText.includes("monitoring"), false, "fixture should not contain monitoring fields or wording");
  assertNoConnectorAntiGoalLanguage(snapshot);
});
