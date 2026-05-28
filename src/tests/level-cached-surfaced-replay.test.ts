import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { Candle, CandleTimeframe } from "../lib/market-data/candle-types.js";
import {
  buildCachedSurfacedReplayCases,
  discoverCachedSurfacedReplayInventory,
  runCachedSurfacedReplay,
} from "../lib/levels/level-cached-surfaced-replay.js";

function makeCandles(
  startTimestamp: number,
  stepMs: number,
  count: number,
  startPrice: number,
  amplitude: number,
): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const drift = Math.sin(index / 6) * amplitude;
    const close = Number((startPrice + drift + index * amplitude * 0.02).toFixed(4));
    return {
      timestamp: startTimestamp + index * stepMs,
      open: close,
      high: Number((close * 1.01).toFixed(4)),
      low: Number((close * 0.99).toFixed(4)),
      close,
      volume: 100_000 + index * 500,
    };
  });
}

async function writeCacheEntry(params: {
  root: string;
  symbol: string;
  timeframe: CandleTimeframe;
  lookbackBars: number;
  endTimeMs: number;
  candles: Candle[];
}): Promise<void> {
  const directoryPath = join(params.root, params.symbol, params.timeframe);
  await mkdir(directoryPath, { recursive: true });
  const path = join(directoryPath, `${params.lookbackBars}-${params.endTimeMs}.json`);
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        request: {
          symbol: params.symbol,
          timeframe: params.timeframe,
          lookbackBars: params.lookbackBars,
          endTimeMs: params.endTimeMs,
          provider: "ibkr",
        },
        response: {
          candles: params.candles,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

test("cached surfaced replay discovers inventory and builds replayable cases", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "cached-surfaced-replay-"));

  try {
    const fiveMinuteEndTimeMs = 1_776_432_000_000;
    const higherTimeframeEndTimeMs = fiveMinuteEndTimeMs - 26 * 5 * 60 * 1000;
    const dailyCandles = makeCandles(
      higherTimeframeEndTimeMs - 60 * 24 * 60 * 60 * 1000,
      24 * 60 * 60 * 1000,
      60,
      5,
      0.15,
    );
    const fourHourCandles = makeCandles(
      higherTimeframeEndTimeMs - 90 * 4 * 60 * 60 * 1000,
      4 * 60 * 60 * 1000,
      90,
      5,
      0.08,
    );
    const fiveMinuteCandles = makeCandles(
      fiveMinuteEndTimeMs - 140 * 5 * 60 * 1000,
      5 * 60 * 1000,
      140,
      5,
      0.03,
    );

    await writeCacheEntry({
      root: cacheRoot,
      symbol: "TEST",
      timeframe: "daily",
      lookbackBars: 60,
      endTimeMs: higherTimeframeEndTimeMs,
      candles: dailyCandles,
    });
    await writeCacheEntry({
      root: cacheRoot,
      symbol: "TEST",
      timeframe: "4h",
      lookbackBars: 90,
      endTimeMs: higherTimeframeEndTimeMs,
      candles: fourHourCandles,
    });
    await writeCacheEntry({
      root: cacheRoot,
      symbol: "TEST",
      timeframe: "5m",
      lookbackBars: 140,
      endTimeMs: fiveMinuteEndTimeMs,
      candles: fiveMinuteCandles,
    });

    await writeCacheEntry({
      root: cacheRoot,
      symbol: "MISS",
      timeframe: "5m",
      lookbackBars: 140,
      endTimeMs: fiveMinuteEndTimeMs,
      candles: fiveMinuteCandles,
    });

    const inventory = await discoverCachedSurfacedReplayInventory({
      cacheDirectoryPath: cacheRoot,
    });
    const testInventory = inventory.find((entry) => entry.symbol === "TEST");
    const missInventory = inventory.find((entry) => entry.symbol === "MISS");

    assert.ok(testInventory);
    assert.equal(testInventory.usableForReplay, true);
    assert.ok(missInventory);
    assert.equal(missInventory.usableForReplay, false);

    const preparation = await buildCachedSurfacedReplayCases({
      cacheDirectoryPath: cacheRoot,
      maxCasesPerSymbol: 1,
      minSnapshotBars5m: 96,
      forwardBars5m: 24,
      minDailyBars: 40,
      minFourHourBars: 60,
    });

    assert.equal(preparation.cases.length, 1);
    assert.ok(preparation.skipped.some((item) => item.symbol === "MISS"));
    assert.equal(preparation.cases[0]?.snapshotCandlesByTimeframe?.["5m"]?.length, 116);
    assert.equal(preparation.cases[0]?.forwardCandles.length, 24);

    const report = await runCachedSurfacedReplay({
      cacheDirectoryPath: cacheRoot,
      maxCasesPerSymbol: 1,
      minSnapshotBars5m: 96,
      forwardBars5m: 24,
      minDailyBars: 40,
      minFourHourBars: 60,
    });

    assert.equal(report.results.length, 1);
    assert.equal(report.summary.totalCases, 1);
    assert.ok(["old", "new", "mixed", "inconclusive"].includes(report.results[0]!.winner));
    assert.ok(report.manualReviewQueue.length >= 0);
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }
});
