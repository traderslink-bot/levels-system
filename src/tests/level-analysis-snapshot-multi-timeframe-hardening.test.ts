import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLevelAnalysisSnapshotFromCandles } from "../lib/analysis/level-analysis-snapshot-from-candles.js";
import type { LevelAnalysisSnapshot } from "../lib/analysis/level-analysis-snapshot.js";
import type { Candle } from "../lib/market-data/candle-types.js";
import {
  parseLevelAnalysisSnapshotRunnerArgs,
  runLevelAnalysisSnapshotRunner,
} from "../scripts/run-level-analysis-snapshot.js";

const AS_OF = Date.parse("2026-05-01T10:20:00-04:00");

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

function fifteenMinuteCandles(): Candle[] {
  return [
    candle("2026-05-01T09:30:00-04:00", 9.65, 10.35, 9.6, 10.12, 2_050_000),
    candle("2026-05-01T09:45:00-04:00", 10.12, 10.5, 10.02, 10.08, 2_530_000),
    candle("2026-05-01T10:00:00-04:00", 10.08, 10.62, 9.98, 10.38, 2_960_000),
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

function buildSnapshot(input?: {
  candles5m?: Candle[];
  candles15m?: Candle[];
  fourHourCandles?: Candle[];
  dailyCandles?: Candle[];
  asOfTimestamp?: number;
}): LevelAnalysisSnapshot {
  return buildLevelAnalysisSnapshotFromCandles({
    symbol: "snap",
    asOfTimestamp: input?.asOfTimestamp ?? AS_OF,
    referencePrice: 10.68,
    candles5m: input?.candles5m ?? candles5m(),
    candles15m: input?.candles15m,
    fourHourCandles: input?.fourHourCandles ?? fourHourCandles(),
    dailyCandles: input?.dailyCandles ?? dailyCandles(),
    previousClose: 9.1,
  });
}

function withTempDir<T>(callback: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "level-analysis-snapshot-mtf-"));

  try {
    return callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeJson(dir: string, fileName: string, value: unknown): string {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function assertNoForbiddenLanguage(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();

  for (const [label, pattern] of [
    ["recommendation", /\brecommendation\b/],
    ["coaching", /\bcoaching\b/],
    ["grading", /\bgrading\b/],
    ["p/l", /\bp\/l\b|\bpnl\b/],
    ["giveback", /\bgiveback\b/],
    ["behavior scoring", /\bbehavior scoring\b/],
    ["trade advice", /\btrade advice\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} language.`);
  }
}

test("reserved 15m absent behavior keeps locked timeframe keys with zero counts", () => {
  const snapshot = buildSnapshot();

  assert.equal(snapshot.inputSummary.timeframes["15m"].provided, false);
  assert.equal(snapshot.inputSummary.candleCounts["15m"], 0);
  assert.equal(snapshot.inputSummary.filteredCandleCounts["15m"], 0);
  assert.equal(snapshot.inputSummary.excludedFutureCandleCounts["15m"], 0);
  assert.equal(snapshot.inputSummary.excludedPartialCandleCounts["15m"], 0);
  assert.deepEqual(Object.keys(snapshot.inputSummary.timeframes), ["5m", "15m", "4h", "daily"]);
  assert.deepEqual(snapshot.inputSummary.timeframesPresent, ["5m", "4h", "daily"]);
  assert.equal(snapshot.diagnostics.includes("15m_candles_reserved_for_future_fact_generation"), false);
});

test("optional 15m input is counted and diagnosed without changing LevelEngine output", () => {
  const baseline = buildSnapshot();
  const withFifteen = buildSnapshot({
    candles15m: fifteenMinuteCandles(),
  });

  assert.equal(withFifteen.inputSummary.timeframes["15m"].provided, true);
  assert.equal(withFifteen.inputSummary.candleCounts["15m"], 3);
  assert.equal(withFifteen.inputSummary.filteredCandleCounts["15m"], 3);
  assert.equal(withFifteen.inputSummary.excludedFutureCandleCounts["15m"], 0);
  assert.equal(withFifteen.inputSummary.excludedPartialCandleCounts["15m"], 0);
  assert.deepEqual(withFifteen.inputSummary.timeframesPresent, ["5m", "15m", "4h", "daily"]);
  assert.ok(withFifteen.diagnostics.includes("15m_facts_limited"));
  assert.equal(withFifteen.diagnostics.includes("15m_candles_reserved_for_future_fact_generation"), false);
  assert.ok(withFifteen.timeframeFacts?.["15m"]);
  assert.equal(withFifteen.timeframeFacts["15m"].schemaVersion, "level-analysis-15m-facts/v1");
  assert.deepEqual(withFifteen.levelEngineOutput, baseline.levelEngineOutput);
  assert.deepEqual(withFifteen.nearestSupport, baseline.nearestSupport);
  assert.deepEqual(withFifteen.nearestResistance, baseline.nearestResistance);
});

test("no-lookahead filtering reports future and still-forming candles across all timeframes", () => {
  const asOfTimestamp = Date.parse("2026-05-01T10:17:00-04:00");
  const baseline = buildSnapshot({
    asOfTimestamp,
    candles5m: candles5m().slice(0, 14),
    candles15m: fifteenMinuteCandles(),
    fourHourCandles: fourHourCandles().slice(0, 7),
    dailyCandles: dailyCandles(),
  });
  const withFutureAndPartial = buildSnapshot({
    asOfTimestamp,
    candles5m: [
      ...candles5m().slice(0, 14),
      candle("2026-05-01T10:15:00-04:00", 10.38, 10.74, 10.34, 10.68, 1_250_000),
      candle("2026-05-01T10:20:00-04:00", 10.68, 11, 10.62, 10.95, 1_500_000),
    ],
    candles15m: [
      ...fifteenMinuteCandles(),
      candle("2026-05-01T10:15:00-04:00", 10.38, 10.8, 10.2, 10.7, 3_100_000),
      candle("2026-05-01T10:30:00-04:00", 10.7, 10.9, 10.4, 10.5, 2_400_000),
    ],
    fourHourCandles: [
      ...fourHourCandles().slice(0, 7),
      candle("2026-05-01T08:00:00-04:00", 10.2, 10.9, 10.1, 10.7, 800_000),
      candle("2026-05-01T12:00:00-04:00", 10.7, 10.8, 10.1, 10.2, 500_000),
    ],
    dailyCandles: [
      ...dailyCandles(),
      candle("2026-05-01T00:00:00.000Z", 9.1, 10.8, 9, 10.5, 4_000_000),
      candle("2026-05-04T00:00:00.000Z", 10.5, 10.7, 9.8, 10, 2_500_000),
    ],
  });

  assert.deepEqual(withFutureAndPartial.levelEngineOutput, baseline.levelEngineOutput);
  assert.equal(withFutureAndPartial.inputSummary.excludedFutureCandleCounts["5m"], 1);
  assert.equal(withFutureAndPartial.inputSummary.excludedPartialCandleCounts["5m"], 1);
  assert.equal(withFutureAndPartial.inputSummary.excludedFutureCandleCounts["15m"], 1);
  assert.equal(withFutureAndPartial.inputSummary.excludedPartialCandleCounts["15m"], 1);
  assert.equal(withFutureAndPartial.inputSummary.excludedFutureCandleCounts["4h"], 1);
  assert.equal(withFutureAndPartial.inputSummary.excludedPartialCandleCounts["4h"], 1);
  assert.equal(withFutureAndPartial.inputSummary.excludedFutureCandleCounts.daily, 1);
  assert.equal(withFutureAndPartial.inputSummary.excludedPartialCandleCounts.daily, 1);
  assert.ok(withFutureAndPartial.diagnostics.includes("5m_future_candles_filtered"));
  assert.ok(withFutureAndPartial.diagnostics.includes("15m_partial_candles_filtered"));
  assert.ok(withFutureAndPartial.diagnostics.includes("4h_future_candles_filtered"));
  assert.ok(withFutureAndPartial.diagnostics.includes("daily_partial_candles_filtered"));
  assert.equal(withFutureAndPartial.safety.noLookaheadApplied, true);
});

test("runner accepts --candles-15m and writes v1 output with 15m facts summary", () =>
  withTempDir((dir) => {
    const outPath = join(dir, "snapshot.json");
    const options = parseLevelAnalysisSnapshotRunnerArgs([
      "--symbol",
      "snap",
      "--as-of",
      "2026-05-01T10:20:00-04:00",
      "--reference-price",
      "10.68",
      "--candles-5m",
      writeJson(dir, "5m.json", candles5m()),
      "--candles-15m",
      writeJson(dir, "15m.json", fifteenMinuteCandles()),
      "--candles-4h",
      writeJson(dir, "4h.json", fourHourCandles()),
      "--candles-daily",
      writeJson(dir, "daily.json", dailyCandles()),
      "--previous-close",
      "9.1",
      "--out",
      outPath,
    ]);
    const result = runLevelAnalysisSnapshotRunner(options);

    assert.equal(existsSync(outPath), true);
    assert.equal(result.inputPaths.candles15m?.endsWith("15m.json"), true);
    assert.equal(result.snapshot.schemaVersion, "level-analysis-snapshot/v1");
    assert.equal(result.snapshot.producer, "levels-system");
    assert.equal(result.snapshot.inputSummary.candleCounts["15m"], 3);
    assert.equal(result.snapshot.inputSummary.filteredCandleCounts["15m"], 3);
    assert.ok(result.snapshot.diagnostics.includes("15m_facts_limited"));
    assert.ok(result.snapshot.timeframeFacts?.["15m"]);
    assert.equal(result.snapshot.timeframeFacts["15m"].schemaVersion, "level-analysis-15m-facts/v1");
    assert.equal(result.snapshot.safety.noLookaheadApplied, true);
    assert.equal(JSON.parse(readFileSync(outPath, "utf8")).inputSummary.candleCounts["15m"], 3);
  }));

test("schema timeframe keys and factual language boundaries remain locked", () => {
  const snapshot = buildSnapshot({ candles15m: fifteenMinuteCandles() });
  const requiredKeys = ["5m", "15m", "4h", "daily"];

  for (const key of requiredKeys) {
    assert.ok(key in snapshot.inputSummary.candleCounts);
    assert.ok(key in snapshot.inputSummary.filteredCandleCounts);
    assert.ok(key in snapshot.inputSummary.excludedFutureCandleCounts);
    assert.ok(key in snapshot.inputSummary.excludedPartialCandleCounts);
    assert.ok(key in snapshot.inputSummary.timeframes);
  }
  assertNoForbiddenLanguage(snapshot);
});
