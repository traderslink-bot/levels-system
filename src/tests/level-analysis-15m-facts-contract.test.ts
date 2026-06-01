import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildLevelAnalysisSnapshot } from "../lib/analysis/level-analysis-snapshot.js";
import type { LevelAnalysisSnapshot } from "../lib/analysis/level-analysis-snapshot.js";
import {
  assertFifteenMinuteFactsAreFactsOnly,
  createUnavailableFifteenMinuteFacts,
  FIFTEEN_MINUTE_FACTS_SCHEMA_VERSION,
  isFifteenMinuteFacts,
  summarizeFifteenMinuteFacts,
  validateFifteenMinuteFacts,
  type FifteenMinuteFacts,
} from "../lib/analysis/level-analysis-timeframe-facts.js";

const AS_OF = Date.parse("2026-05-01T10:20:00-04:00");
const FACT_FIXTURE_DIR = new URL("../../docs/examples/level-analysis-snapshot/timeframe-facts/15m/", import.meta.url);
const SNAPSHOT_FIXTURE = new URL("../../docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json", import.meta.url);

const FACT_FIXTURES = {
  unavailable: "15m-facts-unavailable.json",
  limited: "15m-facts-limited.json",
  mixed: "15m-facts-mixed.json",
  compression: "15m-facts-compression.json",
  expansion: "15m-facts-expansion.json",
} as const;

type FixtureName = keyof typeof FACT_FIXTURES;

function fixturePath(name: string): string {
  return fileURLToPath(new URL(name, FACT_FIXTURE_DIR));
}

function loadFifteenMinuteFacts(name: FixtureName): FifteenMinuteFacts {
  return JSON.parse(readFileSync(fixturePath(FACT_FIXTURES[name]), "utf8")) as FifteenMinuteFacts;
}

function loadSnapshotFixture(): LevelAnalysisSnapshot {
  return JSON.parse(readFileSync(fileURLToPath(SNAPSHOT_FIXTURE), "utf8")) as LevelAnalysisSnapshot;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertNoForbiddenLanguage(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();
  for (const [label, pattern] of [
    ["recommendation", /\brecommendation\b/],
    ["coaching", /\bcoaching\b/],
    ["coach", /\bcoach\b/],
    ["grading", /\bgrading\b/],
    ["grade", /\bgrade\b/],
    ["p/l", /\bp\/l\b|\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior scoring", /\bbehavior score\b|\bbehavior scoring\b/],
    ["trade advice", /\btrade advice\b/],
    ["entry decision", /\bentry decision\b/],
    ["exit decision", /\bexit decision\b/],
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["hold", /\bhold\b/],
    ["good trade", /\bgood trade\b/],
    ["bad trade", /\bbad trade\b/],
    ["should have", /\bshould have\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} language.`);
  }
}

function buildSnapshotRequest(base: LevelAnalysisSnapshot) {
  return {
    symbol: base.symbol,
    asOfTimestamp: base.asOfTimestamp,
    referencePrice: base.referencePrice,
    levelEngineOutput: base.levelEngineOutput,
    inputSummary: base.inputSummary,
    sessionFacts: base.sessionFacts,
    volumeFacts: base.volumeFacts,
    volumeShelves: base.volumeShelves,
    marketContext: base.marketContext,
    factsBundle: base.factsBundle,
  };
}

test("15m facts fixtures parse and validate against the additive v1 contract", () => {
  for (const fixtureName of Object.keys(FACT_FIXTURES) as FixtureName[]) {
    const facts = loadFifteenMinuteFacts(fixtureName);
    const validation = validateFifteenMinuteFacts(facts);

    assert.equal(validation.valid, true, `${fixtureName} should validate: ${validation.errors.join(", ")}`);
    assert.equal(isFifteenMinuteFacts(facts), true);
    assert.equal(facts.schemaVersion, FIFTEEN_MINUTE_FACTS_SCHEMA_VERSION);
    assert.equal(facts.symbol, "SNAP");
    assert.equal(facts.asOfTimestamp, AS_OF);
    assert.equal(facts.safety.noLookaheadApplied, true);
    assert.equal(facts.safety.levelOutputUnchanged, true);
    assert.equal(facts.safety.factsOnly, true);
    assert.equal(facts.safety.noRuntimeBehaviorChange, true);
  }
});

test("15m facts validation rejects malformed or unsafe payloads", () => {
  const valid = loadFifteenMinuteFacts("mixed");
  const wrongSchema = {
    ...clone(valid),
    schemaVersion: "level-analysis-15m-facts/v2",
  };
  const missingSafety = clone(valid) as Record<string, unknown>;
  const unsafe = clone(valid);

  delete missingSafety.safety;
  unsafe.safety.noLookaheadApplied = false;

  assert.equal(validateFifteenMinuteFacts(wrongSchema).valid, false);
  assert.match(validateFifteenMinuteFacts(wrongSchema).errors.join(" "), /schemaVersion/);
  assert.equal(validateFifteenMinuteFacts(missingSafety).valid, false);
  assert.match(validateFifteenMinuteFacts(missingSafety).errors.join(" "), /safety/);
  assert.equal(validateFifteenMinuteFacts(unsafe).valid, false);
  assert.match(validateFifteenMinuteFacts(unsafe).errors.join(" "), /noLookaheadApplied/);
});

test("15m facts helpers create unavailable facts and compact summaries without generation logic", () => {
  const unavailable = loadFifteenMinuteFacts("unavailable");
  const created = createUnavailableFifteenMinuteFacts({
    symbol: "snap",
    asOfTimestamp: AS_OF,
  });
  const mixedSummary = summarizeFifteenMinuteFacts(loadFifteenMinuteFacts("mixed"));

  assert.deepEqual(created, unavailable);
  assert.deepEqual(mixedSummary, {
    schemaVersion: FIFTEEN_MINUTE_FACTS_SCHEMA_VERSION,
    symbol: "SNAP",
    asOfTimestamp: AS_OF,
    availabilityStatus: "available",
    closedCandleCount: 6,
    rangeState: "normal",
    trendState: "mixed",
    volumeState: "normal",
    limitationCount: 1,
    diagnosticCount: 1,
    noLookaheadApplied: true,
    levelOutputUnchanged: true,
    factsOnly: true,
    noRuntimeBehaviorChange: true,
  });
});

test("15m facts fixtures cover unavailable, limited, mixed, compression, and expansion states", () => {
  const unavailable = loadFifteenMinuteFacts("unavailable");
  const limited = loadFifteenMinuteFacts("limited");
  const mixed = loadFifteenMinuteFacts("mixed");
  const compression = loadFifteenMinuteFacts("compression");
  const expansion = loadFifteenMinuteFacts("expansion");

  assert.equal(unavailable.dataCompleteness.availabilityStatus, "unavailable");
  assert.equal(limited.dataCompleteness.availabilityStatus, "limited");
  assert.equal(limited.limitations.includes("15m_insufficient_trend_history"), true);
  assert.equal(mixed.trend.trendState, "mixed");
  assert.equal(compression.range.rangeState, "compressed");
  assert.equal(compression.structure.consolidationState, "present");
  assert.equal(expansion.range.rangeState, "expanded");
  assert.equal(expansion.trend.trendState, "up");
  assert.equal(expansion.structure.continuationState, "present");
});

test("15m facts remain facts-only and do not carry level creation or journal interpretation fields", () => {
  for (const fixtureName of Object.keys(FACT_FIXTURES) as FixtureName[]) {
    const facts = loadFifteenMinuteFacts(fixtureName);

    assert.doesNotThrow(() => assertFifteenMinuteFactsAreFactsOnly(facts));
    assertNoForbiddenLanguage(facts);
  }

  assert.throws(
    () =>
      assertFifteenMinuteFactsAreFactsOnly({
        ...loadFifteenMinuteFacts("mixed"),
        recommendation: "not allowed",
      }),
    /facts-only/,
  );
  assert.throws(
    () =>
      assertFifteenMinuteFactsAreFactsOnly({
        ...loadFifteenMinuteFacts("mixed"),
        supportLevels: [],
      }),
    /level-generation/,
  );
});

test("LevelAnalysisSnapshot remains compatible when timeframeFacts is absent or additively supplied", () => {
  const baseFixture = loadSnapshotFixture();
  const baseFixtureWithoutTimeframeFacts = clone(baseFixture) as Record<string, unknown>;
  const baseline = buildLevelAnalysisSnapshot(buildSnapshotRequest(baseFixture));
  const mixedFacts = loadFifteenMinuteFacts("mixed");
  const withFifteenMinuteFacts = buildLevelAnalysisSnapshot({
    ...buildSnapshotRequest(baseFixture),
    timeframeFacts: {
      "15m": mixedFacts,
    },
  });

  delete baseFixtureWithoutTimeframeFacts.timeframeFacts;
  assert.equal(baseFixture.schemaVersion, "level-analysis-snapshot/v1");
  assert.equal("timeframeFacts" in baseFixtureWithoutTimeframeFacts, false);
  assert.equal(withFifteenMinuteFacts.schemaVersion, "level-analysis-snapshot/v1");
  assert.equal(withFifteenMinuteFacts.producer, "levels-system");
  assert.deepEqual(withFifteenMinuteFacts.timeframeFacts?.["15m"], mixedFacts);
  assert.deepEqual(withFifteenMinuteFacts.levelEngineOutput, baseline.levelEngineOutput);
  assert.deepEqual(withFifteenMinuteFacts.nearestSupport, baseline.nearestSupport);
  assert.deepEqual(withFifteenMinuteFacts.nearestResistance, baseline.nearestResistance);
  assertNoForbiddenLanguage(withFifteenMinuteFacts.timeframeFacts);
});
