import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  generateProviderComparisonReadinessReport,
  writeProviderComparisonReadinessReport,
} from "../lib/review/provider-comparison-readiness-report.js";
import type { Candle, CandleFetchTimeframe, CandleProviderName } from "../lib/support-resistance/index.js";

const START = Date.parse("2026-05-01T13:30:00.000Z");

function candle(timestamp: number, close: number, volume = 100_000): Candle {
  return {
    timestamp,
    open: close,
    high: Number((close * 1.02).toFixed(4)),
    low: Number((close * 0.98).toFixed(4)),
    close,
    volume,
  };
}

function wave(count: number, start: number, interval: number, base: number, amplitude: number): Candle[] {
  return Array.from({ length: count }, (_, index) =>
    candle(
      start + index * interval,
      Number((base + Math.sin(index / 3) * amplitude + index * amplitude * 0.01).toFixed(4)),
      100_000 + index * 100,
    ),
  );
}

function writeCache(params: {
  root: string;
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  candles: Candle[];
}): void {
  const directory = join(params.root, params.provider, params.symbol, params.timeframe);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${params.provider}-${params.timeframe}.json`),
    `${JSON.stringify({ response: { candles: params.candles } })}\n`,
    "utf8",
  );
}

test("provider comparison readiness compares cached provider candle drift", async () => {
  const root = mkdtempSync(join(tmpdir(), "provider-compare-"));
  for (const provider of ["ibkr", "stub"] as CandleProviderName[]) {
    const offset = provider === "ibkr" ? 0 : 0.02;
    writeCache({
      root,
      provider,
      symbol: "PCMP",
      timeframe: "daily",
      candles: wave(90, START - 90 * 24 * 60 * 60_000, 24 * 60 * 60_000, 2 + offset, 0.14),
    });
    writeCache({
      root,
      provider,
      symbol: "PCMP",
      timeframe: "4h",
      candles: wave(90, START - 90 * 4 * 60 * 60_000, 4 * 60 * 60_000, 2 + offset, 0.08),
    });
    writeCache({
      root,
      provider,
      symbol: "PCMP",
      timeframe: "5m",
      candles: wave(40, START, 5 * 60_000, 2 + offset, 0.04),
    });
  }

  const report = await generateProviderComparisonReadinessReport({
    cacheDirectoryPath: root,
    primaryProvider: "ibkr",
    comparisonProvider: "stub",
    symbols: ["PCMP"],
    timeframes: ["daily", "4h", "5m"],
  });

  assert.equal(report.totals.symbolsCompared, 1);
  assert.equal(report.totals.bothAvailable, 3);
  assert.equal(report.symbols[0]?.levelComparison.status, "compared");
  assert.equal(report.symbols[0]?.structureComparison.status, "compared");
  assert.ok((report.symbols[0]?.timeframeComparisons.find((comparison) => comparison.timeframe === "5m")?.latestCloseDriftPct ?? 0) > 0);
  assert.equal(typeof report.symbols[0]?.timeframeComparisons.find((comparison) => comparison.timeframe === "5m")?.averageVolumeDriftPct, "number");
  assert.equal(typeof report.symbols[0]?.timeframeComparisons.find((comparison) => comparison.timeframe === "5m")?.latestTimestampDriftMinutes, "number");
});

test("provider comparison readiness writer creates JSON and markdown reports", async () => {
  const root = mkdtempSync(join(tmpdir(), "provider-compare-write-"));
  writeCache({
    root,
    provider: "ibkr",
    symbol: "ONE",
    timeframe: "5m",
    candles: wave(20, START, 5 * 60_000, 1, 0.02),
  });

  const report = await writeProviderComparisonReadinessReport({
    cacheDirectoryPath: root,
    primaryProvider: "ibkr",
    comparisonProvider: "stub",
    timeframes: ["5m"],
    jsonPath: join(root, "out", "report.json"),
    markdownPath: join(root, "out", "report.md"),
  });

  assert.equal(report.totals.primaryOnly, 1);
  assert.ok(report.totals.providerMissingBehaviorCount > 0);
  assert.ok(report.symbols[0]?.timeframeComparisons[0]?.missingBehavior.some((reason) => /missing 5m candles/i.test(reason)));
  assert.ok(existsSync(join(root, "out", "report.json")));
  assert.match(readFileSync(join(root, "out", "report.md"), "utf8"), /Provider Comparison Readiness/);
  assert.match(readFileSync(join(root, "out", "report.md"), "utf8"), /Market Structure Comparison/);
  assert.match(readFileSync(join(root, "out", "report.md"), "utf8"), /Missing \/ Stale Provider Behavior/);
});
