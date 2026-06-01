import assert from "node:assert/strict";
import test from "node:test";

import { buildLevelAnalysisSnapshotFromCandles } from "../lib/analysis/level-analysis-snapshot-from-candles.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { FinalLevelZone } from "../lib/levels/level-types.js";
import type { Candle } from "../lib/market-data/candle-types.js";

const AS_OF = Date.parse("2026-05-01T10:17:00-04:00");

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

function closed5mCandles(): Candle[] {
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
  ];
}

function futureAndPartial5mCandles(): Candle[] {
  return [
    candle("2026-05-01T10:15:00-04:00", 10.38, 99, 10.34, 98, 9_900_000),
    candle("2026-05-01T10:20:00-04:00", 98, 120, 97, 110, 12_000_000),
    candle("2026-05-01T10:25:00-04:00", 110, 140, 105, 130, 15_000_000),
  ];
}

function closedDailyCandles(): Candle[] {
  return [
    candle("2026-04-23T00:00:00.000Z", 7.9, 8.3, 7.6, 8.1, 2_000_000),
    candle("2026-04-24T00:00:00.000Z", 8.1, 8.55, 7.95, 8.4, 2_200_000),
    candle("2026-04-25T00:00:00.000Z", 8.4, 8.7, 8.15, 8.25, 1_800_000),
    candle("2026-04-28T00:00:00.000Z", 8.25, 9.1, 8.2, 8.95, 2_700_000),
    candle("2026-04-29T00:00:00.000Z", 8.95, 9.35, 8.6, 8.8, 2_400_000),
    candle("2026-04-30T00:00:00.000Z", 8.8, 9.55, 8.7, 9.1, 3_200_000),
  ];
}

function futureDailyCandles(): Candle[] {
  return [
    candle("2026-05-01T00:00:00.000Z", 9.1, 120, 9, 115, 30_000_000),
  ];
}

function closed4hCandles(): Candle[] {
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

function future4hCandles(): Candle[] {
  return [
    candle("2026-05-01T08:00:00-04:00", 10.2, 125, 10, 115, 20_000_000),
    candle("2026-05-01T12:00:00-04:00", 115, 150, 112, 140, 25_000_000),
  ];
}

function allZones(snapshot: ReturnType<typeof buildLevelAnalysisSnapshotFromCandles>): FinalLevelZone[] {
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

function buildClosedSnapshot() {
  return buildLevelAnalysisSnapshotFromCandles({
    symbol: "safe",
    asOfTimestamp: AS_OF,
    candles5m: closed5mCandles(),
    dailyCandles: closedDailyCandles(),
    fourHourCandles: closed4hCandles(),
    previousClose: 9.1,
  });
}

function buildFutureAppendedSnapshot() {
  return buildLevelAnalysisSnapshotFromCandles({
    symbol: "safe",
    asOfTimestamp: AS_OF,
    candles5m: [...closed5mCandles(), ...futureAndPartial5mCandles()],
    dailyCandles: [...closedDailyCandles(), ...futureDailyCandles()],
    fourHourCandles: [...closed4hCandles(), ...future4hCandles()],
    previousClose: 9.1,
  });
}

test("appending future and still-forming candles does not change as-of level output or facts", () => {
  const closedOnly = buildClosedSnapshot();
  const futureAppended = buildFutureAppendedSnapshot();

  assert.deepEqual(futureAppended.levelEngineOutput, closedOnly.levelEngineOutput);
  assert.deepEqual(futureAppended.sessionFacts, closedOnly.sessionFacts);
  assert.deepEqual(futureAppended.volumeFacts, closedOnly.volumeFacts);
  assert.deepEqual(futureAppended.volumeShelves, closedOnly.volumeShelves);
  assert.deepEqual(futureAppended.marketContext, closedOnly.marketContext);
  assert.deepEqual(futureAppended.levelIntelligenceReport, closedOnly.levelIntelligenceReport);
  assert.deepEqual(futureAppended.levelQualityAudit, closedOnly.levelQualityAudit);
  assert.equal(futureAppended.inputSummary.filteredCandleCounts["5m"], closedOnly.inputSummary.filteredCandleCounts["5m"]);
  assert.equal(futureAppended.inputSummary.filteredCandleCounts["4h"], closedOnly.inputSummary.filteredCandleCounts["4h"]);
  assert.equal(futureAppended.inputSummary.filteredCandleCounts.daily, closedOnly.inputSummary.filteredCandleCounts.daily);
  assert.equal(futureAppended.inputSummary.excludedFutureCandleCounts["5m"], 2);
  assert.equal(futureAppended.inputSummary.excludedPartialCandleCounts["5m"], 1);
  assert.equal(futureAppended.inputSummary.excludedFutureCandleCounts["4h"], 1);
  assert.equal(futureAppended.inputSummary.excludedPartialCandleCounts["4h"], 1);
  assert.equal(futureAppended.inputSummary.excludedPartialCandleCounts.daily, 1);
});

test("future and partial candles are excluded from level output and facts", () => {
  const snapshot = buildFutureAppendedSnapshot();
  const maxLevelPrice = Math.max(...allZones(snapshot).map((level) => level.representativePrice));

  assert.equal(snapshot.referencePrice, 10.38);
  assert.equal(snapshot.levelEngineOutput.generatedAt, AS_OF);
  assert.equal(snapshot.levelEngineOutput.metadata.referencePrice, 10.38);
  assert.ok(maxLevelPrice < 20, "future extreme prices must not create levels");
  assert.ok((snapshot.sessionFacts?.highOfDay ?? 0) < 20);
  assert.equal(snapshot.volumeFacts?.currentVolume, 950_000);
  assert.ok((snapshot.volumeFacts?.dollarVolume ?? 0) < 100_000_000);
  assert.ok((snapshot.marketContext?.facts.filteredCandleCount ?? 0) < 20);
  assert.ok(snapshot.diagnostics.includes("candle_close_as_of_filter_applied"));
});

test("replay snapshot components are stable across full historical arrays", () => {
  const closedOnly = buildClosedSnapshot();
  const futureAppended = buildFutureAppendedSnapshot();

  assert.deepEqual(futureAppended.levelEngineOutput, closedOnly.levelEngineOutput);
  assert.deepEqual(futureAppended.sessionFacts, closedOnly.sessionFacts);
  assert.deepEqual(futureAppended.volumeFacts, closedOnly.volumeFacts);
  assert.deepEqual(futureAppended.volumeShelves, closedOnly.volumeShelves);
  assert.deepEqual(futureAppended.marketContext, closedOnly.marketContext);
  assert.deepEqual(futureAppended.levelIntelligenceReport, closedOnly.levelIntelligenceReport);
  assert.deepEqual(futureAppended.levelQualityAudit, closedOnly.levelQualityAudit);
  assert.ok(futureAppended.diagnostics.includes("5m_future_candles_filtered"));
  assert.ok(futureAppended.diagnostics.includes("5m_partial_candles_filtered"));
  assert.ok(futureAppended.diagnostics.includes("4h_future_candles_filtered"));
  assert.ok(futureAppended.diagnostics.includes("4h_partial_candles_filtered"));
  assert.ok(futureAppended.diagnostics.includes("daily_partial_candles_filtered"));
  assert.ok(closedOnly.diagnostics.includes("candle_close_as_of_filter_applied"));
});

test("snapshot generation is deterministic and does not mutate candle inputs", () => {
  const fiveMinute = [...closed5mCandles(), ...futureAndPartial5mCandles()];
  const daily = [...closedDailyCandles(), ...futureDailyCandles()];
  const fourHour = [...closed4hCandles(), ...future4hCandles()];
  const before = JSON.stringify({ fiveMinute, daily, fourHour });
  const left = buildLevelAnalysisSnapshotFromCandles({
    symbol: "safe",
    asOfTimestamp: AS_OF,
    candles5m: fiveMinute,
    dailyCandles: daily,
    fourHourCandles: fourHour,
    previousClose: 9.1,
  });
  const right = buildLevelAnalysisSnapshotFromCandles({
    symbol: "safe",
    asOfTimestamp: AS_OF,
    candles5m: [...closed5mCandles(), ...futureAndPartial5mCandles()],
    dailyCandles: [...closedDailyCandles(), ...futureDailyCandles()],
    fourHourCandles: [...closed4hCandles(), ...future4hCandles()],
    previousClose: 9.1,
  });

  assert.deepEqual(left, right);
  assert.equal(JSON.stringify({ fiveMinute, daily, fourHour }), before);
  assert.equal(left.safety.noLookaheadApplied, true);
  assert.equal(left.safety.levelOutputUnchanged, true);
  assert.equal(resolveLevelRuntimeMode(), "old");
});
