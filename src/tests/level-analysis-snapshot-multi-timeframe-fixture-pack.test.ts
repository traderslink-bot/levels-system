import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildLevelAnalysisSnapshotFromCandles } from "../lib/analysis/level-analysis-snapshot-from-candles.js";
import type { LevelAnalysisSnapshot } from "../lib/analysis/level-analysis-snapshot.js";
import type { Candle } from "../lib/market-data/candle-types.js";

const AS_OF = Date.parse("2026-05-01T10:20:00-04:00");
const REPLAY_AS_OF = Date.parse("2026-05-01T10:17:00-04:00");
const FIXTURE_DIR = new URL(
  "../../docs/examples/level-analysis-snapshot/multi-timeframe-fixture-pack/fixtures/",
  import.meta.url,
);
const SUMMARY_ARTIFACT = new URL(
  "../../docs/examples/level-analysis-snapshot/multi-timeframe-fixture-pack/latest-level-analysis-snapshot-multi-timeframe-fixture-pack.json",
  import.meta.url,
);

type Timeframe = "5m" | "15m" | "4h" | "daily";

type MultiTimeframeFixture = {
  schemaVersion: "level-analysis-snapshot-multi-timeframe-fixture/v1";
  fixtureName: string;
  expected: {
    timeframesPresent: Timeframe[];
    filteredCandleCounts: Record<Timeframe, number>;
    excludedFutureCandleCounts: Record<Timeframe, number>;
    excludedPartialCandleCounts: Record<Timeframe, number>;
    fifteenMinuteFactsPresent: boolean;
    fifteenMinuteAvailabilityStatus?: string;
    fifteenMinuteRangeState?: string;
    fifteenMinuteTrendState?: string;
    fifteenMinuteVolumeState?: string;
    fifteenMinuteDiagnosticCodes?: string[];
    providerByTimeframeKeys: Timeframe[];
    providerByTimeframeIncludes15m: boolean;
    dataQualityFlags?: string[];
    levelEngineParityWithMissing15m?: boolean;
    nearestLevelParityWithMissing15m?: boolean;
    levelEngineParityWithFilteredOnly?: boolean;
    diagnosticsInclude: string[];
    diagnosticsExclude?: string[];
    noLookaheadApplied: boolean;
  };
  safety: Record<string, boolean>;
};

function candle(
  timestamp: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100_000,
): Candle {
  return {
    timestamp: Date.parse(timestamp),
    open,
    high,
    low,
    close,
    volume,
  };
}

function candles5m(): Candle[] {
  return [
    candle("2026-05-01T08:00:00-04:00", 9.1, 9.25, 9, 9.2, 200_000),
    candle("2026-05-01T08:05:00-04:00", 9.2, 9.5, 9.15, 9.45, 220_000),
    candle("2026-05-01T08:10:00-04:00", 9.45, 9.75, 9.4, 9.7, 240_000),
    candle("2026-05-01T08:15:00-04:00", 9.7, 9.9, 9.6, 9.72, 260_000),
    candle("2026-05-01T08:20:00-04:00", 9.72, 9.85, 9.55, 9.6, 230_000),
    candle("2026-05-01T09:30:00-04:00", 9.65, 10.05, 9.6, 9.95, 500_000),
    candle("2026-05-01T09:35:00-04:00", 9.95, 10.25, 9.9, 10.2, 700_000),
    candle("2026-05-01T09:40:00-04:00", 10.2, 10.35, 10.05, 10.12, 850_000),
    candle("2026-05-01T09:45:00-04:00", 10.12, 10.42, 10.06, 10.36, 950_000),
    candle("2026-05-01T09:50:00-04:00", 10.36, 10.5, 10.16, 10.22, 820_000),
    candle("2026-05-01T09:55:00-04:00", 10.22, 10.28, 10.02, 10.08, 760_000),
    candle("2026-05-01T10:00:00-04:00", 10.08, 10.3, 9.98, 10.24, 910_000),
    candle("2026-05-01T10:05:00-04:00", 10.24, 10.55, 10.18, 10.48, 1_100_000),
    candle("2026-05-01T10:10:00-04:00", 10.48, 10.62, 10.31, 10.38, 950_000),
    candle("2026-05-01T10:15:00-04:00", 10.38, 10.74, 10.34, 10.68, 1_250_000),
  ];
}

function limited15mCandles(): Candle[] {
  return [
    candle("2026-05-01T09:30:00-04:00", 9.65, 10.35, 9.6, 10.12, 2_050_000),
    candle("2026-05-01T09:45:00-04:00", 10.12, 10.5, 10.02, 10.08, 2_530_000),
    candle("2026-05-01T10:00:00-04:00", 10.08, 10.62, 9.98, 10.38, 2_960_000),
  ];
}

function available15mCandles(): Candle[] {
  return [
    candle("2026-05-01T09:15:00-04:00", 10, 10.3, 9.9, 10.2, 1_000_000),
    candle("2026-05-01T09:30:00-04:00", 10.2, 10.5, 10.1, 10.4, 1_200_000),
    candle("2026-05-01T09:45:00-04:00", 10.4, 10.7, 10.3, 10.6, 1_400_000),
    candle("2026-05-01T10:00:00-04:00", 10.6, 11.4, 10.4, 11.2, 2_400_000),
  ];
}

function dailyCandles(): Candle[] {
  return [
    candle("2026-04-23T00:00:00.000Z", 7.9, 8.3, 7.6, 8.1, 2_000_000),
    candle("2026-04-24T00:00:00.000Z", 8.1, 8.55, 7.95, 8.4, 2_200_000),
    candle("2026-04-25T00:00:00.000Z", 8.4, 8.7, 8.15, 8.25, 1_800_000),
    candle("2026-04-28T00:00:00.000Z", 8.25, 9.1, 8.2, 8.95, 2_700_000),
    candle("2026-04-29T00:00:00.000Z", 8.95, 9.35, 8.6, 8.8, 2_400_000),
    candle("2026-04-30T00:00:00.000Z", 8.8, 9.55, 8.7, 9.1, 3_200_000),
  ];
}

function fourHourCandles(): Candle[] {
  return [
    candle("2026-04-30T04:00:00-04:00", 8.8, 9.1, 8.7, 9.05, 350_000),
    candle("2026-04-30T08:00:00-04:00", 9.05, 9.35, 8.95, 9.2, 420_000),
    candle("2026-04-30T12:00:00-04:00", 9.2, 9.5, 9.05, 9.42, 500_000),
    candle("2026-04-30T16:00:00-04:00", 9.42, 9.62, 9.2, 9.3, 430_000),
    candle("2026-04-30T20:00:00-04:00", 9.3, 9.8, 9.25, 9.72, 530_000),
    candle("2026-05-01T00:00:00-04:00", 9.72, 10.05, 9.62, 9.9, 610_000),
    candle("2026-05-01T04:00:00-04:00", 9.9, 10.4, 9.75, 10.2, 720_000),
  ];
}

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as T;
}

function loadFixtures(): MultiTimeframeFixture[] {
  return readdirSync(fileURLToPath(FIXTURE_DIR))
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => readJson<MultiTimeframeFixture>(new URL(fileName, FIXTURE_DIR)));
}

function buildSnapshot(params: {
  asOfTimestamp?: number;
  candles5m?: Candle[];
  candles15m?: Candle[];
  daily?: Candle[];
  fourHour?: Candle[];
}): LevelAnalysisSnapshot {
  return buildLevelAnalysisSnapshotFromCandles({
    symbol: "snap",
    asOfTimestamp: params.asOfTimestamp ?? AS_OF,
    referencePrice: 10.68,
    candles5m: params.candles5m ?? candles5m(),
    candles15m: params.candles15m,
    dailyCandles: params.daily ?? dailyCandles(),
    fourHourCandles: params.fourHour ?? fourHourCandles(),
    previousClose: 9.1,
  });
}

function buildFixtureSnapshot(fixtureName: string): LevelAnalysisSnapshot {
  switch (fixtureName) {
    case "snapshot-mtf-missing-15m":
      return buildSnapshot({});
    case "snapshot-mtf-supplied-15m-limited":
      return buildSnapshot({ candles15m: limited15mCandles() });
    case "snapshot-mtf-supplied-15m-available":
      return buildSnapshot({ candles15m: available15mCandles() });
    case "snapshot-mtf-journal-replay-asof-filtering":
      return buildSnapshot({
        asOfTimestamp: REPLAY_AS_OF,
        candles5m: [
          ...candles5m().slice(0, 14),
          candle("2026-05-01T10:15:00-04:00", 10.38, 10.74, 10.34, 10.68, 1_250_000),
          candle("2026-05-01T10:20:00-04:00", 10.68, 11, 10.62, 10.95, 1_500_000),
        ],
        candles15m: [
          ...limited15mCandles(),
          candle("2026-05-01T10:15:00-04:00", 10.38, 10.8, 10.2, 10.7, 3_100_000),
          candle("2026-05-01T10:30:00-04:00", 10.7, 10.9, 10.4, 10.5, 2_400_000),
        ],
        fourHour: [
          ...fourHourCandles().slice(0, 7),
          candle("2026-05-01T08:00:00-04:00", 10.2, 10.9, 10.1, 10.7, 800_000),
          candle("2026-05-01T12:00:00-04:00", 10.7, 10.8, 10.1, 10.2, 500_000),
        ],
        daily: [
          ...dailyCandles(),
          candle("2026-05-01T00:00:00.000Z", 9.1, 10.8, 9, 10.5, 4_000_000),
          candle("2026-05-04T00:00:00.000Z", 10.5, 10.7, 9.8, 10, 2_500_000),
        ],
      });
    case "snapshot-mtf-sparse-higher-timeframes":
      return buildSnapshot({ daily: [], fourHour: [] });
    default:
      throw new Error(`Unknown fixture ${fixtureName}`);
  }
}

function filteredOnlyReplaySnapshot(): LevelAnalysisSnapshot {
  return buildSnapshot({
    asOfTimestamp: REPLAY_AS_OF,
    candles5m: candles5m().slice(0, 14),
    candles15m: limited15mCandles(),
    fourHour: fourHourCandles().slice(0, 7),
    daily: dailyCandles(),
  });
}

function sortedProviderKeys(snapshot: LevelAnalysisSnapshot): string[] {
  return Object.keys(snapshot.levelEngineOutput.metadata.providerByTimeframe ?? {}).sort();
}

function sortedDataQualityFlags(snapshot: LevelAnalysisSnapshot): string[] {
  return [...snapshot.levelEngineOutput.metadata.dataQualityFlags].sort();
}

function assertNoRestrictedLanguage(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();
  for (const [label, pattern] of [
    ["recommendation", /\brecommendation\b/],
    ["coaching", /\bcoaching\b/],
    ["grading", /\bgrading\b/],
    ["p/l", /\bp\/l\b|\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior scoring", /\bbehavior score\b|\bbehavior scoring\b/],
    ["trade advice", /\btrade advice\b/],
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["hold", /\bhold\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} language.`);
  }
}

test("multi-timeframe fixture files parse and stay compact", () => {
  const fixtures = loadFixtures();

  assert.deepEqual(
    fixtures.map((fixture) => fixture.fixtureName).sort(),
    [
      "snapshot-mtf-journal-replay-asof-filtering",
      "snapshot-mtf-missing-15m",
      "snapshot-mtf-sparse-higher-timeframes",
      "snapshot-mtf-supplied-15m-available",
      "snapshot-mtf-supplied-15m-limited",
    ],
  );

  for (const fixture of fixtures) {
    assert.equal(fixture.schemaVersion, "level-analysis-snapshot-multi-timeframe-fixture/v1");
    assert.equal(fixture.safety.rawCandlesIncluded, false);
    assert.equal(fixture.safety.rawCachePayloadsIncluded, false);
    assert.equal(fixture.safety.journalAppBehaviorChanged, false);
    assertNoRestrictedLanguage(fixture);
  }
});

test("fixture scenarios match current LevelAnalysisSnapshot summaries", () => {
  const missing15mSnapshot = buildFixtureSnapshot("snapshot-mtf-missing-15m");

  for (const fixture of loadFixtures()) {
    const snapshot = buildFixtureSnapshot(fixture.fixtureName);
    const expected = fixture.expected;

    assert.deepEqual(snapshot.inputSummary.timeframesPresent, expected.timeframesPresent, fixture.fixtureName);
    assert.deepEqual(snapshot.inputSummary.filteredCandleCounts, expected.filteredCandleCounts, fixture.fixtureName);
    assert.deepEqual(
      snapshot.inputSummary.excludedFutureCandleCounts,
      expected.excludedFutureCandleCounts,
      fixture.fixtureName,
    );
    assert.deepEqual(
      snapshot.inputSummary.excludedPartialCandleCounts,
      expected.excludedPartialCandleCounts,
      fixture.fixtureName,
    );
    assert.equal(Boolean(snapshot.timeframeFacts?.["15m"]), expected.fifteenMinuteFactsPresent, fixture.fixtureName);
    assert.deepEqual(sortedProviderKeys(snapshot), [...expected.providerByTimeframeKeys].sort(), fixture.fixtureName);
    assert.equal(
      Boolean((snapshot.levelEngineOutput.metadata.providerByTimeframe as Record<string, unknown> | undefined)?.["15m"]),
      expected.providerByTimeframeIncludes15m,
      fixture.fixtureName,
    );
    assert.equal(snapshot.safety.noLookaheadApplied, expected.noLookaheadApplied, fixture.fixtureName);

    for (const diagnostic of expected.diagnosticsInclude) {
      assert.equal(snapshot.diagnostics.includes(diagnostic), true, `${fixture.fixtureName} missing ${diagnostic}`);
    }
    for (const diagnostic of expected.diagnosticsExclude ?? []) {
      assert.equal(snapshot.diagnostics.includes(diagnostic), false, `${fixture.fixtureName} includes ${diagnostic}`);
    }

    if (expected.dataQualityFlags) {
      assert.deepEqual(sortedDataQualityFlags(snapshot), [...expected.dataQualityFlags].sort(), fixture.fixtureName);
    }

    const fifteenMinuteFacts = snapshot.timeframeFacts?.["15m"];
    if (expected.fifteenMinuteFactsPresent) {
      assert.ok(fifteenMinuteFacts, fixture.fixtureName);
      assert.equal(
        fifteenMinuteFacts.dataCompleteness.availabilityStatus,
        expected.fifteenMinuteAvailabilityStatus,
        fixture.fixtureName,
      );
      if (expected.fifteenMinuteRangeState !== undefined) {
        assert.equal(fifteenMinuteFacts.range.rangeState, expected.fifteenMinuteRangeState, fixture.fixtureName);
      }
      if (expected.fifteenMinuteTrendState !== undefined) {
        assert.equal(fifteenMinuteFacts.trend.trendState, expected.fifteenMinuteTrendState, fixture.fixtureName);
      }
      if (expected.fifteenMinuteVolumeState !== undefined) {
        assert.equal(fifteenMinuteFacts.volume?.volumeState, expected.fifteenMinuteVolumeState, fixture.fixtureName);
      }
      assert.deepEqual(
        fifteenMinuteFacts.diagnostics.map((diagnostic) => diagnostic.code).sort(),
        [...(expected.fifteenMinuteDiagnosticCodes ?? [])].sort(),
        fixture.fixtureName,
      );
      assert.equal(fifteenMinuteFacts.safety.levelOutputUnchanged, true, fixture.fixtureName);
      assert.equal(fifteenMinuteFacts.safety.factsOnly, true, fixture.fixtureName);
    }

    if (expected.levelEngineParityWithMissing15m) {
      assert.deepEqual(snapshot.levelEngineOutput, missing15mSnapshot.levelEngineOutput, fixture.fixtureName);
    }
    if (expected.nearestLevelParityWithMissing15m) {
      assert.deepEqual(snapshot.nearestSupport, missing15mSnapshot.nearestSupport, fixture.fixtureName);
      assert.deepEqual(snapshot.nearestResistance, missing15mSnapshot.nearestResistance, fixture.fixtureName);
    }
    if (expected.levelEngineParityWithFilteredOnly) {
      assert.deepEqual(snapshot.levelEngineOutput, filteredOnlyReplaySnapshot().levelEngineOutput, fixture.fixtureName);
    }

    assertNoRestrictedLanguage(snapshot);
  }
});

test("fixture pack summary artifact indexes all fixtures and locks boundaries", () => {
  const summary = readJson<{
    schemaVersion: string;
    fixtureDirectory: string;
    fixtures: Array<{ fixtureName: string; path: string }>;
    coverage: Record<string, boolean | number>;
    safety: Record<string, boolean>;
    recommendedNextGate: string;
  }>(SUMMARY_ARTIFACT);

  assert.equal(summary.schemaVersion, "level-analysis-snapshot-multi-timeframe-fixture-pack/v1");
  assert.equal(summary.fixtureDirectory, "docs/examples/level-analysis-snapshot/multi-timeframe-fixture-pack/fixtures");
  assert.equal(summary.fixtures.length, 5);
  assert.equal(summary.coverage.fixtureCount, 5);
  assert.equal(summary.coverage.missing15mCovered, true);
  assert.equal(summary.coverage.supplied15mLimitedCovered, true);
  assert.equal(summary.coverage.supplied15mAvailableCovered, true);
  assert.equal(summary.coverage.futurePartialFilteringCovered, true);
  assert.equal(summary.coverage.sparseHigherTimeframesCovered, true);
  assert.equal(summary.coverage.journalReplayAsOfSafetyCovered, true);
  assert.equal(summary.coverage.levelEngineParityCovered, true);
  for (const [key, value] of Object.entries(summary.safety)) {
    assert.equal(value, false, `${key} should remain false`);
  }
  assert.equal(summary.recommendedNextGate, "level_analysis_snapshot_multi_timeframe_fixture_pack_handoff");
  assertNoRestrictedLanguage(summary);
});
