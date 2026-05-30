import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { Candle } from "../lib/market-data/candle-types.js";
import {
  loadCandleJson,
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

function withTempDir<T>(callback: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "level-analysis-snapshot-runner-"));

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

function writeCandleObjectFixture(dir: string): string {
  const filePath = join(dir, "candles-object.json");
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        candles: [
          {
            timestamp: "2026-05-01T10:00:00-04:00",
            open: 10,
            high: 10.4,
            low: 9.9,
            close: 10.2,
            volume: 100_000,
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return filePath;
}

function runnerOptions(dir: string) {
  return {
    symbol: "snap",
    asOfTimestamp: AS_OF,
    referencePrice: 10.68,
    candles5mPath: writeJson(dir, "5m.json", candles5m()),
    candles4hPath: writeJson(dir, "4h.json", fourHourCandles()),
    candlesDailyPath: writeJson(dir, "daily.json", dailyCandles()),
    previousClose: 9.1,
    format: "json" as const,
  };
}

function assertNoForbiddenLanguage(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();

  for (const [label, pattern] of [
    ["buy", /\bbuy\b/],
    ["sell", /\bsell\b/],
    ["enter", /\benter\b/],
    ["exit", /\bexit\b/],
    ["good trade", /good trade/],
    ["bad trade", /bad trade/],
    ["mistake", /\bmistake\b/],
    ["coaching", /\bcoaching\b/],
    ["p/l", /p\/l/],
    ["giveback", /\bgiveback\b/],
    ["grading", /\bgrading\b/],
  ] as const) {
    assert.equal(pattern.test(text), false, `Unexpected ${label} wording`);
  }
}

test("parses level analysis snapshot runner CLI options", () => {
  assert.deepEqual(
    parseLevelAnalysisSnapshotRunnerArgs([
      "--symbol",
      "snap",
      "--as-of",
      "2026-05-01T10:20:00-04:00",
      "--reference-price",
      "10.68",
      "--candles-5m",
      "5m.json",
      "--candles-4h",
      "4h.json",
      "--candles-daily",
      "daily.json",
      "--previous-close",
      "9.1",
      "--out",
      "snapshot.json",
      "--format",
      "json",
    ]),
    {
      symbol: "SNAP",
      asOfTimestamp: AS_OF,
      referencePrice: 10.68,
      candles5mPath: "5m.json",
      candles4hPath: "4h.json",
      candlesDailyPath: "daily.json",
      previousClose: 9.1,
      outPath: "snapshot.json",
      format: "json",
    },
  );
});

test("missing required args fail clearly", () => {
  assert.throws(
    () => parseLevelAnalysisSnapshotRunnerArgs(["--as-of", "2026-05-01T10:20:00-04:00"]),
    /Missing required --symbol <ticker>\./,
  );
  assert.throws(
    () => parseLevelAnalysisSnapshotRunnerArgs(["--symbol", "SNAP"]),
    /Missing required --as-of <timestamp\|ISO>\./,
  );
  assert.throws(
    () =>
      parseLevelAnalysisSnapshotRunnerArgs([
        "--symbol",
        "SNAP",
        "--as-of",
        "2026-05-01T10:20:00-04:00",
      ]),
    /Missing required --reference-price <number>\./,
  );
  assert.throws(
    () =>
      parseLevelAnalysisSnapshotRunnerArgs([
        "--symbol",
        "SNAP",
        "--as-of",
        "2026-05-01T10:20:00-04:00",
        "--reference-price",
        "10.68",
      ]),
    /Missing required --candles-5m <path>\./,
  );
});

test("loads candle fixtures from arrays or objects with ISO timestamps", () => withTempDir((dir) => {
  const arrayPath = writeJson(dir, "array.json", [
    {
      timestamp: "2026-05-01T10:00:00-04:00",
      open: 10,
      high: 10.4,
      low: 9.9,
      close: 10.2,
      volume: 100_000,
    },
  ]);
  const objectPath = writeCandleObjectFixture(dir);

  assert.equal(loadCandleJson(arrayPath)[0]?.timestamp, Date.parse("2026-05-01T10:00:00-04:00"));
  assert.equal(loadCandleJson(objectPath)[0]?.close, 10.2);
}));

test("runner loads candle fixtures and builds a JSON snapshot", () => withTempDir((dir) => {
  const result = runLevelAnalysisSnapshotRunner(runnerOptions(dir));

  assert.equal(result.snapshot.symbol, "SNAP");
  assert.equal(result.snapshot.asOfTimestamp, AS_OF);
  assert.equal(result.snapshot.referencePrice, 10.68);
  assert.equal(result.snapshot.levelEngineOutput.symbol, "SNAP");
  assert.equal(result.snapshot.sessionFacts?.symbol, "SNAP");
  assert.equal(result.snapshot.volumeFacts?.symbol, "SNAP");
  assert.ok(Array.isArray(result.snapshot.volumeShelves));
  assert.equal(result.snapshot.levelIntelligenceReport.symbol, "SNAP");
  assert.equal(result.snapshot.levelQualityAudit.symbol, "SNAP");
  assert.equal(JSON.parse(result.content).symbol, "SNAP");
}));

test("runner writes JSON snapshot to out path", () => withTempDir((dir) => {
  const outPath = join(dir, "nested", "latest-level-analysis-snapshot.json");
  const result = runLevelAnalysisSnapshotRunner({
    ...runnerOptions(dir),
    outPath,
  });

  assert.equal(existsSync(outPath), true);
  assert.equal(readFileSync(outPath, "utf8"), result.content);

  const parsed = JSON.parse(readFileSync(outPath, "utf8")) as { symbol: string; levelQualityAudit: unknown };
  assert.equal(parsed.symbol, "SNAP");
  assert.ok(parsed.levelQualityAudit);
}));

test("runner output is deterministic", () => withTempDir((dir) => {
  const first = runLevelAnalysisSnapshotRunner(runnerOptions(dir));
  const second = runLevelAnalysisSnapshotRunner(runnerOptions(dir));

  assert.deepEqual(first.snapshot, second.snapshot);
  assert.equal(first.content, second.content);
}));

test("runner output preserves synthetic extension markings when generated", () => withTempDir((dir) => {
  const result = runLevelAnalysisSnapshotRunner(runnerOptions(dir));
  const extensions = [
    ...result.snapshot.levelEngineOutput.extensionLevels.support,
    ...result.snapshot.levelEngineOutput.extensionLevels.resistance,
  ];
  const synthetic = extensions.find(
    (level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map",
  );

  assert.ok(synthetic, "expected a synthetic continuation-map extension in deterministic fixture");
  assert.equal(synthetic.touchCount, 0);
  assert.equal(synthetic.confluenceCount, 0);
  assert.ok(synthetic.notes.join(" ").includes("not historical support/resistance"));
  assert.equal(result.snapshot.safety.syntheticExtensionsClearlyMarked, true);
}));

test("runner source does not import Discord alert monitoring trader context or network fetchers", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../scripts/run-level-analysis-snapshot.ts", import.meta.url)),
    "utf8",
  ).toLowerCase();

  assert.equal(source.includes("../alerts"), false);
  assert.equal(source.includes("../monitoring"), false);
  assert.equal(source.includes("discord"), false);
  assert.equal(source.includes("trader-context"), false);
  assert.equal(source.includes("candle-fetch-service"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("date.now"), false);
});

test("runner does not emit trade grading coaching or recommendation wording", () => withTempDir((dir) => {
  const result = runLevelAnalysisSnapshotRunner(runnerOptions(dir));

  assertNoForbiddenLanguage(result.content);
}));

test("runtime mode old remains default", () => {
  assert.equal(resolveLevelRuntimeMode(), "old");
});
