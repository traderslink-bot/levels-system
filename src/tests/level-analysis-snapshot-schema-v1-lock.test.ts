import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildLevelAnalysisSnapshotFromCandles } from "../lib/analysis/level-analysis-snapshot-from-candles.js";
import type { LevelAnalysisSnapshot } from "../lib/analysis/level-analysis-snapshot.js";
import type { FinalLevelZone } from "../lib/levels/level-types.js";
import type { Candle } from "../lib/market-data/candle-types.js";

const AS_OF = Date.parse("2026-05-01T10:20:00-04:00");
const SNAPSHOT_FIXTURE_DIR = new URL("../../docs/examples/level-analysis-snapshot/", import.meta.url);
const TIMEFRAMES = ["5m", "15m", "4h", "daily"] as const;

function fixturePath(name: string): string {
  return fileURLToPath(new URL(name, SNAPSHOT_FIXTURE_DIR));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadCandleFixture(name: string): Candle[] {
  const parsed = JSON.parse(readFileSync(fixturePath(name), "utf8")) as Array<Record<string, unknown>>;

  return parsed.map((item, index) => {
    const timestamp = typeof item.timestamp === "string" ? Date.parse(item.timestamp) : Number(item.timestamp);
    for (const key of ["open", "high", "low", "close", "volume"] as const) {
      assert.equal(typeof item[key], "number", `Candle ${index} ${key} must be numeric.`);
    }

    return {
      timestamp,
      open: item.open as number,
      high: item.high as number,
      low: item.low as number,
      close: item.close as number,
      volume: item.volume as number,
    };
  });
}

function buildSnapshot(): LevelAnalysisSnapshot {
  return buildLevelAnalysisSnapshotFromCandles({
    symbol: "snap",
    asOfTimestamp: AS_OF,
    referencePrice: 10.68,
    candles5m: loadCandleFixture("sample-5m-candles.json"),
    fourHourCandles: loadCandleFixture("sample-4h-candles.json"),
    dailyCandles: loadCandleFixture("sample-daily-candles.json"),
    previousClose: 9.1,
  });
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  assert.equal(isRecord(value), true, `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function assertTopLevelV1Shape(snapshot: Record<string, unknown>): void {
  for (const field of [
    "schemaVersion",
    "producer",
    "symbol",
    "asOfTimestamp",
    "referencePrice",
    "inputSummary",
    "nearestSupport",
    "nearestResistance",
    "levelEngineOutput",
    "sessionFacts",
    "volumeFacts",
    "volumeShelves",
    "marketContext",
    "factsBundle",
    "levelIntelligenceReport",
    "levelQualityAudit",
    "diagnostics",
    "safety",
  ]) {
    assert.ok(field in snapshot, `Missing required top-level field ${field}.`);
  }

  assert.equal(snapshot.schemaVersion, "level-analysis-snapshot/v1");
  assert.equal((snapshot.schemaVersion as string).startsWith("level-analysis-snapshot/v1"), true);
  assert.equal(snapshot.producer, "levels-system");
  assert.equal(typeof snapshot.symbol, "string");
  assert.equal(typeof snapshot.asOfTimestamp, "number");
  assert.equal(typeof snapshot.referencePrice, "number");
}

function assertInputSummaryShape(inputSummary: unknown): void {
  const summary = requireRecord(inputSummary, "inputSummary");
  for (const field of [
    "timeframesPresent",
    "candleCounts",
    "filteredCandleCounts",
    "excludedFutureCandleCounts",
    "excludedPartialCandleCounts",
    "timeframes",
    "previousCloseProvided",
  ]) {
    assert.ok(field in summary, `Missing inputSummary.${field}.`);
  }

  assert.equal(Array.isArray(summary.timeframesPresent), true);
  const timeframes = requireRecord(summary.timeframes, "inputSummary.timeframes");
  for (const timeframe of TIMEFRAMES) {
    for (const containerName of [
      "candleCounts",
      "filteredCandleCounts",
      "excludedFutureCandleCounts",
      "excludedPartialCandleCounts",
    ]) {
      const container = requireRecord(summary[containerName], `inputSummary.${containerName}`);
      assert.equal(typeof container[timeframe], "number", `${containerName}.${timeframe} must be numeric.`);
    }

    const timeframeSummary = requireRecord(timeframes[timeframe], `inputSummary.timeframes.${timeframe}`);
    assert.equal(typeof timeframeSummary.provided, "boolean");
    assert.equal(typeof timeframeSummary.candleCount, "number");
    assert.equal(typeof timeframeSummary.filteredCandleCount, "number");
    assert.equal(typeof timeframeSummary.excludedFutureCandleCount, "number");
    assert.equal(typeof timeframeSummary.excludedPartialCandleCount, "number");
  }
}

function assertNearestLevelShape(value: unknown): void {
  if (value === null) {
    return;
  }

  const nearest = requireRecord(value, "nearest level");
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
    assert.equal(typeof nearest[field], type, `nearest.${field} must be ${type}.`);
  }
}

function assertLevelEngineOutputShape(value: unknown): void {
  const output = requireRecord(value, "levelEngineOutput");
  for (const field of [
    "symbol",
    "generatedAt",
    "metadata",
    "majorSupport",
    "majorResistance",
    "intermediateSupport",
    "intermediateResistance",
    "intradaySupport",
    "intradayResistance",
    "extensionLevels",
    "specialLevels",
  ]) {
    assert.ok(field in output, `Missing levelEngineOutput.${field}.`);
  }

  for (const field of [
    "majorSupport",
    "majorResistance",
    "intermediateSupport",
    "intermediateResistance",
    "intradaySupport",
    "intradayResistance",
  ]) {
    assert.equal(Array.isArray(output[field]), true, `levelEngineOutput.${field} must be an array.`);
  }

  const extensionLevels = requireRecord(output.extensionLevels, "levelEngineOutput.extensionLevels");
  assert.equal(Array.isArray(extensionLevels.support), true);
  assert.equal(Array.isArray(extensionLevels.resistance), true);
}

function assertFactAndReportSections(snapshot: Record<string, unknown>): void {
  assert.equal(isRecord(snapshot.sessionFacts), true);
  assert.equal(isRecord(snapshot.volumeFacts), true);
  assert.equal(Array.isArray(snapshot.volumeShelves), true);
  assert.equal(isRecord(snapshot.marketContext), true);
  assert.equal(isRecord(snapshot.factsBundle), true);
  assert.equal(isRecord(snapshot.levelIntelligenceReport), true);
  assert.equal(isRecord(snapshot.levelQualityAudit), true);
  assert.equal(Array.isArray(snapshot.diagnostics), true);
}

function assertSafetyShape(value: unknown): void {
  const safety = requireRecord(value, "safety");
  for (const field of [
    "noLookaheadApplied",
    "levelOutputUnchanged",
    "factsOnlyVWAP",
    "shelvesAreFactsOnly",
    "syntheticExtensionsClearlyMarked",
    "noRuntimeBehaviorChange",
  ]) {
    assert.ok(field in safety, `Missing safety.${field}.`);
    assert.equal(typeof safety[field], "boolean", `safety.${field} must be boolean.`);
  }

  assert.equal(safety.noLookaheadApplied, true);
  assert.equal(safety.levelOutputUnchanged, true);
  assert.equal(safety.factsOnlyVWAP, true);
  assert.equal(safety.shelvesAreFactsOnly, true);
  assert.equal(safety.syntheticExtensionsClearlyMarked, true);
  assert.equal(safety.noRuntimeBehaviorChange, true);
}

function assertSnapshotV1Contract(value: unknown): void {
  const snapshot = requireRecord(value, "LevelAnalysisSnapshot");
  assertTopLevelV1Shape(snapshot);
  assertInputSummaryShape(snapshot.inputSummary);
  assertNearestLevelShape(snapshot.nearestSupport);
  assertNearestLevelShape(snapshot.nearestResistance);
  assertLevelEngineOutputShape(snapshot.levelEngineOutput);
  assertFactAndReportSections(snapshot);
  assertSafetyShape(snapshot.safety);
}

function extensionLevels(snapshot: LevelAnalysisSnapshot): FinalLevelZone[] {
  return [
    ...snapshot.levelEngineOutput.extensionLevels.support,
    ...snapshot.levelEngineOutput.extensionLevels.resistance,
  ];
}

function surfacedLevels(snapshot: LevelAnalysisSnapshot): FinalLevelZone[] {
  return [
    ...snapshot.levelEngineOutput.majorSupport,
    ...snapshot.levelEngineOutput.majorResistance,
    ...snapshot.levelEngineOutput.intermediateSupport,
    ...snapshot.levelEngineOutput.intermediateResistance,
    ...snapshot.levelEngineOutput.intradaySupport,
    ...snapshot.levelEngineOutput.intradayResistance,
  ];
}

function assertNoForbiddenLanguage(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();
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
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected forbidden language: ${label}`);
  }
}

test("v1 schema lock validates the deterministic from-candles snapshot shape", () => {
  const snapshot = buildSnapshot();

  assertSnapshotV1Contract(snapshot);
  assert.deepEqual(snapshot.inputSummary.timeframesPresent, ["5m", "4h", "daily"]);
  assert.deepEqual(snapshot.inputSummary.candleCounts, {
    "5m": 15,
    "15m": 0,
    "4h": 7,
    daily: 6,
  });
});

test("v1 schema lock validates the generated sample artifact shape", () => {
  const artifact = JSON.parse(readFileSync(fixturePath("latest-level-analysis-snapshot.json"), "utf8"));

  assertSnapshotV1Contract(artifact);
});

test("nearest level fields are nullable or match the documented shape", () => {
  const snapshot = buildSnapshot();

  assertNearestLevelShape(snapshot.nearestSupport);
  assertNearestLevelShape(snapshot.nearestResistance);
  assert.notEqual(snapshot.nearestSupport, null);
  assert.equal(snapshot.nearestResistance, null);
});

test("v1 validation is tolerant of additive unknown fields", () => {
  const snapshotWithUnknownField = {
    ...buildSnapshot(),
    futureAdditiveField: {
      preservedByTolerantReaders: true,
    },
  };

  assertSnapshotV1Contract(snapshotWithUnknownField);
});

test("synthetic continuation-map rows remain clearly marked and outside surfaced buckets", () => {
  const snapshot = buildSnapshot();
  const synthetic = extensionLevels(snapshot).filter(
    (level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map",
  );
  const surfacedSynthetic = surfacedLevels(snapshot).filter(
    (level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map",
  );

  assert.ok(synthetic.length > 0, "Fixture should include synthetic continuation-map rows.");
  assert.equal(surfacedSynthetic.length, 0);
  for (const level of synthetic) {
    const evidenceLimitations = level.extensionMetadata?.evidenceLimitations ?? [];

    assert.equal(level.isExtension, true);
    assert.equal(level.touchCount, 0);
    assert.equal(level.confluenceCount, 0);
    assert.equal(level.extensionMetadata?.extensionSource, "synthetic_continuation_map");
    assert.ok(level.notes.join(" ").includes("not historical support/resistance"));
    assert.ok(evidenceLimitations.includes("not_historical_support_resistance"));
    assert.ok(evidenceLimitations.includes("no_touch_or_rejection_history"));
  }
});

test("snapshot-generated text stays factual and avoids recommendation or grading language", () => {
  assertNoForbiddenLanguage(buildSnapshot());
});
