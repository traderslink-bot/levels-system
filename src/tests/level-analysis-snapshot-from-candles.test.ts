import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildLevelAnalysisSnapshotFromCandles } from "../lib/analysis/level-analysis-snapshot-from-candles.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { Candle } from "../lib/market-data/candle-types.js";

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

function buildSnapshot() {
  return buildLevelAnalysisSnapshotFromCandles({
    symbol: "snap",
    asOfTimestamp: AS_OF,
    referencePrice: 10.68,
    candles5m: candles5m(),
    dailyCandles: dailyCandles(),
    fourHourCandles: fourHourCandles(),
    previousClose: 9.1,
  });
}

function allSerializedText(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function assertNoForbiddenLanguage(value: unknown): void {
  const text = allSerializedText(value);
  for (const [label, pattern] of [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["enter", /\benter\b/],
    ["exit", /\bexit\b/],
    ["good trade", /\bgood trade\b/],
    ["bad trade", /\bbad trade\b/],
    ["mistake", /\bmistake\b/],
    ["coaching", /\bcoaching\b/],
    ["p/l", /\bp\/l\b/],
    ["giveback", /\bgiveback\b/],
    ["grading", /\bgrading\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected forbidden language: ${label}`);
  }
}

test("builds snapshot from deterministic closed 5m candles", () => {
  const snapshot = buildSnapshot();

  assert.equal(snapshot.symbol, "SNAP");
  assert.equal(snapshot.asOfTimestamp, AS_OF);
  assert.equal(snapshot.referencePrice, 10.68);
  assert.equal(snapshot.levelEngineOutput.symbol, "SNAP");
  assert.equal(snapshot.levelEngineOutput.generatedAt, AS_OF);
  assert.equal(snapshot.sessionFacts?.symbol, "SNAP");
  assert.equal(snapshot.volumeFacts?.symbol, "SNAP");
  assert.ok(Array.isArray(snapshot.volumeShelves));
  assert.equal(snapshot.factsBundle?.symbol, "SNAP");
});

test("applies as-of filtering and excludes future and partial candles", () => {
  const closedInput = candles5m().slice(0, 14);
  const input = [
    ...closedInput,
    candle("2026-05-01T10:15:00-04:00", 10.38, 10.74, 10.34, 10.68, 1_250_000),
    candle("2026-05-01T10:20:00-04:00", 10.68, 11, 10.62, 10.95, 1_500_000),
  ];
  const filteredOnly = buildLevelAnalysisSnapshotFromCandles({
    symbol: "asof",
    asOfTimestamp: Date.parse("2026-05-01T10:17:00-04:00"),
    referencePrice: 10.38,
    candles5m: closedInput,
    previousClose: 9.1,
  });
  const withFutureCandles = buildLevelAnalysisSnapshotFromCandles({
    symbol: "asof",
    asOfTimestamp: Date.parse("2026-05-01T10:17:00-04:00"),
    referencePrice: 10.38,
    candles5m: input,
    previousClose: 9.1,
  });

  assert.deepEqual(withFutureCandles, filteredOnly);
  assert.equal(withFutureCandles.sessionFacts?.currentPrice, 10.38);
  assert.equal(withFutureCandles.levelEngineOutput.metadata.referencePrice, 10.38);
  assert.ok(withFutureCandles.diagnostics.includes("candle_close_as_of_filter_applied"));
});

test("includes LevelEngineOutput LevelIntelligenceReport and LevelQualityAuditReport", () => {
  const snapshot = buildSnapshot();

  assert.equal(snapshot.levelIntelligenceReport.symbol, "SNAP");
  assert.equal(snapshot.levelQualityAudit.symbol, "SNAP");
  assert.equal(
    snapshot.levelIntelligenceReport.counts.total,
    snapshot.levelQualityAudit.summary.totalLevels,
  );
  assert.ok(snapshot.levelIntelligenceReport.counts.total > 0);
  assert.equal(snapshot.levelQualityAudit.safety.noRuntimeBehaviorChange, true);
});

test("builds session facts volume facts shelves and market context from candles", () => {
  const snapshot = buildSnapshot();

  assert.equal(snapshot.sessionFacts?.previousClose, 9.1);
  assert.ok((snapshot.sessionFacts?.highOfDay ?? 0) >= 10.62);
  assert.equal(snapshot.sessionFacts?.aboveVWAP, true);
  assert.ok((snapshot.volumeFacts?.relativeVolume ?? 0) > 0);
  assert.notEqual(snapshot.volumeFacts?.volumeState, "unknown");
  assert.ok((snapshot.volumeShelves?.length ?? 0) >= 1);
  assert.ok(snapshot.marketContext);
  assert.equal(snapshot.factsBundle?.shelvesAreFactsOnly, true);
});

test("preserves synthetic continuation-map extension metadata when generated", () => {
  const snapshot = buildSnapshot();
  const extensions = [
    ...snapshot.levelEngineOutput.extensionLevels.support,
    ...snapshot.levelEngineOutput.extensionLevels.resistance,
  ];
  const synthetic = extensions.find(
    (level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map",
  );

  assert.ok(synthetic, "expected at least one synthetic continuation-map extension");
  assert.equal(synthetic.touchCount, 0);
  assert.equal(synthetic.confluenceCount, 0);
  assert.ok(synthetic.notes.join(" ").includes("not historical support/resistance"));
  assert.equal(snapshot.safety.syntheticExtensionsClearlyMarked, true);
});

test("reports diagnostics instead of guessing when higher timeframe candles are missing", () => {
  const snapshot = buildLevelAnalysisSnapshotFromCandles({
    symbol: "thin",
    asOfTimestamp: AS_OF,
    referencePrice: 10.68,
    candles5m: candles5m(),
    previousClose: 9.1,
  });

  assert.ok(snapshot.diagnostics.includes("daily_candles_missing"));
  assert.ok(snapshot.diagnostics.includes("4h_candles_missing"));
  assert.equal(snapshot.levelEngineOutput.generatedAt, AS_OF);
  assert.equal(snapshot.levelEngineOutput.metadata.referencePrice, 10.68);
});

test("output is deterministic and input candles are not mutated", () => {
  const fiveMinute = candles5m();
  const daily = dailyCandles();
  const fourHour = fourHourCandles();
  const before = JSON.stringify({ fiveMinute, daily, fourHour });
  const left = buildLevelAnalysisSnapshotFromCandles({
    symbol: "snap",
    asOfTimestamp: AS_OF,
    referencePrice: 10.68,
    candles5m: fiveMinute,
    dailyCandles: daily,
    fourHourCandles: fourHour,
    previousClose: 9.1,
  });
  const right = buildLevelAnalysisSnapshotFromCandles({
    symbol: "snap",
    asOfTimestamp: AS_OF,
    referencePrice: 10.68,
    candles5m: candles5m(),
    dailyCandles: dailyCandles(),
    fourHourCandles: fourHourCandles(),
    previousClose: 9.1,
  });

  assert.deepEqual(left, right);
  assert.equal(JSON.stringify({ fiveMinute, daily, fourHour }), before);
  assert.deepEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)));
});

test("does not emit recommendation coaching or grading language", () => {
  assertNoForbiddenLanguage(buildSnapshot());
});

test("builder source does not import Discord alert monitoring trader context or network fetchers", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/analysis/level-analysis-snapshot-from-candles.ts", import.meta.url)),
    "utf8",
  ).toLowerCase();

  assert.equal(source.includes("../alerts"), false);
  assert.equal(source.includes("../monitoring"), false);
  assert.equal(source.includes("discord"), false);
  assert.equal(source.includes("trader-context"), false);
  assert.equal(source.includes("candle-fetch-service"), false);
  assert.equal(source.includes("date.now"), false);
});

test("runtime mode old remains default", () => {
  assert.equal(resolveLevelRuntimeMode(), "old");
});
