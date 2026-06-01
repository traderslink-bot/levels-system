import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildFifteenMinuteFacts,
  buildUnavailableFifteenMinuteFactsFromInput,
  FIFTEEN_MINUTE_TREND_FACT_MIN_CANDLES,
  FIFTEEN_MINUTE_VOLUME_FACT_MIN_CANDLES,
  summarizeFifteenMinuteCandleWindow,
} from "../lib/analysis/level-analysis-15m-facts-builder.js";
import { buildLevelAnalysisSnapshotFromCandles } from "../lib/analysis/level-analysis-snapshot-from-candles.js";
import {
  assertFifteenMinuteFactsAreFactsOnly,
  validateFifteenMinuteFacts,
  type FifteenMinuteFacts,
} from "../lib/analysis/level-analysis-timeframe-facts.js";
import type { LevelAnalysisSnapshot } from "../lib/analysis/level-analysis-snapshot.js";
import type { Candle } from "../lib/market-data/candle-types.js";

const AS_OF = Date.parse("2026-05-01T10:20:00-04:00");
const SAMPLE_ROOT = new URL("../../docs/examples/level-analysis-snapshot/", import.meta.url);

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

function loadCandleFixture(name: string): Candle[] {
  const parsed = JSON.parse(readFileSync(fileURLToPath(new URL(name, SAMPLE_ROOT)), "utf8")) as Array<{
    timestamp: string | number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;

  return parsed.map((item) => ({
    timestamp: typeof item.timestamp === "string" ? Date.parse(item.timestamp) : item.timestamp,
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
    volume: item.volume,
  }));
}

function candles5m(): Candle[] {
  return loadCandleFixture("sample-5m-candles.json");
}

function dailyCandles(): Candle[] {
  return loadCandleFixture("sample-daily-candles.json");
}

function fourHourCandles(): Candle[] {
  return loadCandleFixture("sample-4h-candles.json");
}

function sampleFifteenMinuteCandles(): Candle[] {
  return loadCandleFixture("sample-15m-candles.json");
}

function availableFifteenMinuteCandles(): Candle[] {
  return [
    candle("2026-05-01T09:15:00-04:00", 10, 10.3, 9.9, 10.2, 1_000_000),
    candle("2026-05-01T09:30:00-04:00", 10.2, 10.5, 10.1, 10.4, 1_200_000),
    candle("2026-05-01T09:45:00-04:00", 10.4, 10.7, 10.3, 10.6, 1_400_000),
    candle("2026-05-01T10:00:00-04:00", 10.6, 11.4, 10.4, 11.2, 2_400_000),
  ];
}

function compressionFifteenMinuteCandles(): Candle[] {
  return [
    candle("2026-05-01T09:15:00-04:00", 10, 10.6, 9.8, 10.2, 2_000_000),
    candle("2026-05-01T09:30:00-04:00", 10.2, 10.75, 10, 10.15, 1_900_000),
    candle("2026-05-01T09:45:00-04:00", 10.15, 10.38, 10.04, 10.22, 1_500_000),
    candle("2026-05-01T10:00:00-04:00", 10.22, 10.32, 10.16, 10.2, 1_200_000),
  ];
}

function buildSnapshot(input?: {
  candles15m?: Candle[];
  asOfTimestamp?: number;
}): LevelAnalysisSnapshot {
  return buildLevelAnalysisSnapshotFromCandles({
    symbol: "snap",
    asOfTimestamp: input?.asOfTimestamp ?? AS_OF,
    referencePrice: 10.68,
    candles5m: candles5m(),
    candles15m: input?.candles15m,
    dailyCandles: dailyCandles(),
    fourHourCandles: fourHourCandles(),
    previousClose: 9.1,
  });
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

function assertFactsValid(facts: FifteenMinuteFacts): void {
  const validation = validateFifteenMinuteFacts(facts);

  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.doesNotThrow(() => assertFifteenMinuteFactsAreFactsOnly(facts));
}

function stableComputedFactSections(facts: FifteenMinuteFacts): unknown {
  return {
    closedCandleCount: facts.dataCompleteness.closedCandleCount,
    firstClosedTimestamp: facts.dataCompleteness.firstClosedTimestamp,
    lastClosedTimestamp: facts.dataCompleteness.lastClosedTimestamp,
    range: facts.range,
    trend: facts.trend,
    volume: facts.volume,
    structure: facts.structure,
    safety: facts.safety,
  };
}

test("15m facts builder returns unavailable or limited facts from sparse input", () => {
  const unavailable = buildUnavailableFifteenMinuteFactsFromInput({
    symbol: "snap",
    asOfTimestamp: AS_OF,
    referencePrice: 10.68,
    rawCandleCount: 0,
  });
  const limited = buildFifteenMinuteFacts({
    symbol: "snap",
    asOfTimestamp: AS_OF,
    referencePrice: 10.68,
    rawCandleCount: 3,
    closedCandles: sampleFifteenMinuteCandles(),
  });

  assert.equal(unavailable.dataCompleteness.availabilityStatus, "unavailable");
  assert.equal(unavailable.dataCompleteness.provided, false);
  assert.equal(limited.dataCompleteness.availabilityStatus, "limited");
  assert.equal(limited.dataCompleteness.closedCandleCount, 3);
  assert.equal(limited.dataCompleteness.sufficientForTrendFacts, false);
  assert.equal(limited.dataCompleteness.sufficientForVolumeFacts, false);
  assert.equal(limited.limitations.includes("15m_insufficient_trend_history"), true);
  assert.equal(limited.limitations.includes("15m_insufficient_volume_history"), true);
  assert.equal(limited.safety.noLookaheadApplied, true);
  assertFactsValid(unavailable);
  assertFactsValid(limited);
  assertNoForbiddenLanguage([unavailable, limited]);
});

test("15m facts builder computes available range trend volume and structure facts", () => {
  const facts = buildFifteenMinuteFacts({
    symbol: "snap",
    asOfTimestamp: AS_OF,
    referencePrice: 10.68,
    rawCandleCount: availableFifteenMinuteCandles().length,
    closedCandles: availableFifteenMinuteCandles(),
  });

  assert.equal(FIFTEEN_MINUTE_TREND_FACT_MIN_CANDLES, 4);
  assert.equal(FIFTEEN_MINUTE_VOLUME_FACT_MIN_CANDLES, 4);
  assertFactsValid(facts);
  assert.equal(facts.dataCompleteness.availabilityStatus, "available");
  assert.equal(facts.range.recentHigh, 11.4);
  assert.equal(facts.range.recentLow, 9.9);
  assert.equal(facts.range.recentMidpoint, 10.65);
  assert.equal(facts.range.latestRangePct, 0.089286);
  assert.equal(facts.range.averageRangePct, 0.051175);
  assert.equal(facts.range.rangeState, "expanded");
  assert.equal(facts.range.referencePosition, "inside_recent_range");
  assert.equal(facts.trend.trendState, "up");
  assert.equal(facts.trend.higherCloseCount, 3);
  assert.equal(facts.trend.lowerCloseCount, 0);
  assert.equal(facts.trend.greenCandleCount, 4);
  assert.equal(facts.trend.redCandleCount, 0);
  assert.equal(facts.trend.latestCloseLocation, "upper_third");
  assert.equal(facts.volume?.volumeState, "elevated");
  assert.equal(facts.volume?.relativeVolume, 1.6);
  assert.equal(facts.volume?.participationState, "building");
  assert.equal(facts.structure.continuationState, "present");
  assert.equal(facts.structure.consolidationState, "not_present");
  assert.equal(facts.diagnostics.some((diagnostic) => diagnostic.code === "15m_facts_generated"), true);
});

test("15m candle-window summary identifies compressed range facts without level generation", () => {
  const summary = summarizeFifteenMinuteCandleWindow(compressionFifteenMinuteCandles(), 10.2);

  assert.equal(summary.rangeState, "compressed");
  assert.equal(summary.trendState, "sideways");
  assert.equal(summary.structure.consolidationState, "present");
  assert.equal(summary.structure.continuationState, "not_present");
  assert.equal("supportLevels" in summary, false);
  assert.equal("resistanceLevels" in summary, false);
});

test("15m facts report no-lookahead filtering counts while preserving computed closed-candle facts", () => {
  const closedCandles = sampleFifteenMinuteCandles();
  const filteredOnly = buildFifteenMinuteFacts({
    symbol: "snap",
    asOfTimestamp: AS_OF,
    referencePrice: 10.68,
    rawCandleCount: closedCandles.length,
    closedCandles,
  });
  const withExcludedInputs = buildFifteenMinuteFacts({
    symbol: "snap",
    asOfTimestamp: AS_OF,
    referencePrice: 10.68,
    rawCandleCount: closedCandles.length + 2,
    closedCandles,
    excludedFutureCandleCount: 1,
    excludedPartialCandleCount: 1,
  });

  assertFactsValid(filteredOnly);
  assertFactsValid(withExcludedInputs);
  assert.deepEqual(stableComputedFactSections(withExcludedInputs), stableComputedFactSections(filteredOnly));
  assert.equal(withExcludedInputs.dataCompleteness.rawCandleCount, closedCandles.length + 2);
  assert.equal(withExcludedInputs.dataCompleteness.excludedFutureCandleCount, 1);
  assert.equal(withExcludedInputs.dataCompleteness.excludedPartialCandleCount, 1);
  assert.equal(withExcludedInputs.limitations.includes("15m_future_candles_filtered"), true);
  assert.equal(withExcludedInputs.limitations.includes("15m_partial_candles_filtered"), true);
});

test("from-candles snapshot adds 15m timeframe facts only when 15m input is supplied", () => {
  const withoutFifteen = buildSnapshot();
  const withFifteen = buildSnapshot({
    candles15m: sampleFifteenMinuteCandles(),
  });

  assert.equal(withoutFifteen.timeframeFacts, undefined);
  assert.ok(withFifteen.timeframeFacts?.["15m"]);
  assertFactsValid(withFifteen.timeframeFacts["15m"]);
  assert.equal(withFifteen.timeframeFacts["15m"].dataCompleteness.rawCandleCount, 3);
  assert.equal(withFifteen.timeframeFacts["15m"].dataCompleteness.closedCandleCount, 3);
  assert.equal(withFifteen.timeframeFacts["15m"].dataCompleteness.availabilityStatus, "limited");
  assert.ok(withFifteen.diagnostics.includes("15m_facts_limited"));
  assert.equal(withFifteen.diagnostics.includes("15m_candles_reserved_for_future_fact_generation"), false);
  assert.deepEqual(withFifteen.levelEngineOutput, withoutFifteen.levelEngineOutput);
  assert.deepEqual(withFifteen.nearestSupport, withoutFifteen.nearestSupport);
  assert.deepEqual(withFifteen.nearestResistance, withoutFifteen.nearestResistance);
});

test("from-candles 15m no-lookahead filtering keeps closed-candle facts stable", () => {
  const asOfTimestamp = Date.parse("2026-05-01T10:17:00-04:00");
  const closedCandles = sampleFifteenMinuteCandles();
  const filteredOnly = buildSnapshot({
    asOfTimestamp,
    candles15m: closedCandles,
  });
  const withFutureAndPartial = buildSnapshot({
    asOfTimestamp,
    candles15m: [
      ...closedCandles,
      candle("2026-05-01T10:15:00-04:00", 10.38, 10.8, 10.2, 10.7, 3_100_000),
      candle("2026-05-01T10:30:00-04:00", 10.7, 10.9, 10.4, 10.5, 2_400_000),
    ],
  });

  assert.ok(filteredOnly.timeframeFacts?.["15m"]);
  assert.ok(withFutureAndPartial.timeframeFacts?.["15m"]);
  assert.deepEqual(
    stableComputedFactSections(withFutureAndPartial.timeframeFacts["15m"]),
    stableComputedFactSections(filteredOnly.timeframeFacts["15m"]),
  );
  assert.equal(withFutureAndPartial.timeframeFacts["15m"].dataCompleteness.rawCandleCount, 5);
  assert.equal(withFutureAndPartial.timeframeFacts["15m"].dataCompleteness.excludedFutureCandleCount, 1);
  assert.equal(withFutureAndPartial.timeframeFacts["15m"].dataCompleteness.excludedPartialCandleCount, 1);
  assert.deepEqual(withFutureAndPartial.levelEngineOutput, filteredOnly.levelEngineOutput);
  assert.ok(withFutureAndPartial.diagnostics.includes("15m_future_candles_filtered"));
  assert.ok(withFutureAndPartial.diagnostics.includes("15m_partial_candles_filtered"));
});

test("15m facts builder source stays isolated from LevelEngine alerts monitoring and Discord paths", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/analysis/level-analysis-15m-facts-builder.ts", import.meta.url)),
    "utf8",
  ).toLowerCase();

  assert.equal(source.includes("../levels"), false);
  assert.equal(source.includes("detectswingpoints"), false);
  assert.equal(source.includes("buildrawlevelcandidates"), false);
  assert.equal(source.includes("clusterrawlevelcandidates"), false);
  assert.equal(source.includes("../alerts"), false);
  assert.equal(source.includes("../monitoring"), false);
  assert.equal(source.includes("discord"), false);
  assertNoForbiddenLanguage(buildFifteenMinuteFacts({
    symbol: "snap",
    asOfTimestamp: AS_OF,
    referencePrice: 10.68,
    rawCandleCount: availableFifteenMinuteCandles().length,
    closedCandles: availableFifteenMinuteCandles(),
  }));
});
