import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import { buildVolumeMarketFacts, detectVolumeShelves } from "../lib/volume/index.js";

function candle(
  timestamp: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
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

function shelfFixture(): Candle[] {
  return [
    candle("2026-05-01T09:30:00-04:00", 10, 10.2, 9.9, 10.1, 5_000),
    candle("2026-05-01T09:35:00-04:00", 10.1, 10.3, 10, 10.2, 4_000),
    candle("2026-05-01T09:40:00-04:00", 10.2, 10.25, 10.05, 10.15, 3_000),
    candle("2026-05-01T09:45:00-04:00", 11.3, 11.45, 11.25, 11.4, 500),
    candle("2026-05-01T09:50:00-04:00", 12.2, 12.35, 12.1, 12.25, 500),
  ];
}

test("detectVolumeShelves detects a high-volume shelf with dollar volume facts", () => {
  const result = detectVolumeShelves({
    symbol: "shelf",
    asOfTimestamp: Date.parse("2026-05-01T10:00:00-04:00"),
    candles5m: shelfFixture(),
    currentPrice: 10.12,
    bucketWidthPercent: 1,
    minimumBucketWidth: 1,
    minShelfPercentOfWindowVolume: 1,
  });

  assert.equal(result.symbol, "SHELF");
  assert.equal(result.filteredCandleCount, 5);
  assert.equal(result.totalWindowVolume, 13_000);
  assert.ok(result.shelves.length >= 1);

  const [topShelf] = result.shelves;
  assert.equal(topShelf.totalVolume, 12_000);
  assert.equal(topShelf.dollarVolume, 121_450);
  assert.equal(topShelf.percentOfWindowVolume, 92.3077);
  assert.equal(topShelf.touchCount, 3);
  assert.equal(topShelf.shelfRole, "magnet");
  assert.ok(topShelf.reason.includes("closed-window volume"));
});

test("detectVolumeShelves ranks shelves by percent of window volume", () => {
  const candles = [
    candle("2026-05-01T09:30:00-04:00", 10, 10.1, 9.9, 10, 3_000),
    candle("2026-05-01T09:35:00-04:00", 10.1, 10.2, 10, 10.1, 3_000),
    candle("2026-05-01T09:40:00-04:00", 10.2, 10.3, 10.1, 10.2, 3_000),
    candle("2026-05-01T09:45:00-04:00", 12, 12.2, 11.9, 12.1, 1_500),
    candle("2026-05-01T09:50:00-04:00", 12.1, 12.25, 12, 12.2, 1_500),
  ];

  const result = detectVolumeShelves({
    symbol: "rank",
    asOfTimestamp: Date.parse("2026-05-01T10:00:00-04:00"),
    candles5m: candles,
    currentPrice: 10,
    bucketWidthPercent: 10,
    minShelfPercentOfWindowVolume: 1,
  });

  assert.equal(result.shelves[0]?.totalVolume, 9_000);
  assert.equal(result.shelves[1]?.totalVolume, 3_000);
  assert.ok(result.shelves[0]!.percentOfWindowVolume > result.shelves[1]!.percentOfWindowVolume);
});

test("detectVolumeShelves avoids duplicate or overlapping shelves", () => {
  const result = detectVolumeShelves({
    symbol: "dedupe",
    asOfTimestamp: Date.parse("2026-05-01T10:00:00-04:00"),
    candles5m: shelfFixture(),
    currentPrice: 10,
    bucketWidthPercent: 10,
    minShelfPercentOfWindowVolume: 1,
    maxShelves: 5,
  });

  const ids = new Set(result.shelves.map((shelf) => shelf.id));
  assert.equal(ids.size, result.shelves.length);

  for (let leftIndex = 0; leftIndex < result.shelves.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < result.shelves.length; rightIndex += 1) {
      const left = result.shelves[leftIndex]!;
      const right = result.shelves[rightIndex]!;
      assert.ok(left.zoneHigh <= right.zoneLow || right.zoneHigh <= left.zoneLow);
    }
  }
});

test("detectVolumeShelves excludes future and partial candles using candle-close semantics", () => {
  const result = detectVolumeShelves({
    symbol: "asof",
    asOfTimestamp: Date.parse("2026-05-01T09:33:00-04:00"),
    currentPrice: 10,
    candles5m: [
      candle("2026-05-01T09:25:00-04:00", 10, 10.1, 9.9, 10, 100),
      candle("2026-05-01T09:30:00-04:00", 10, 10.5, 9.9, 10.4, 500),
      candle("2026-05-01T09:35:00-04:00", 10.4, 10.8, 10.3, 10.7, 900),
    ],
  });

  assert.equal(result.filteredCandleCount, 1);
  assert.equal(result.totalWindowVolume, 100);
  assert.equal(result.shelves.length, 1);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "partial_candles_filtered"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "future_candles_filtered"));
});

test("detectVolumeShelves reports diagnostics when no closed volume is usable", () => {
  const result = detectVolumeShelves({
    symbol: "zero",
    asOfTimestamp: Date.parse("2026-05-01T10:00:00-04:00"),
    currentPrice: 10,
    candles5m: [
      candle("2026-05-01T09:30:00-04:00", 10, 10.1, 9.9, 10, 0),
      candle("2026-05-01T09:35:00-04:00", 10, 10.1, 9.9, 10, 0),
    ],
  });

  assert.equal(result.shelves.length, 0);
  assert.equal(result.totalWindowVolume, 0);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "zero_window_volume"));
});

test("detectVolumeShelves does not mutate input candles and is deterministic", () => {
  const candles = shelfFixture().reverse();
  const before = structuredClone(candles);
  const request = {
    symbol: "det",
    asOfTimestamp: Date.parse("2026-05-01T10:00:00-04:00"),
    candles5m: candles,
    currentPrice: 10.12,
    bucketWidthPercent: 10,
    minShelfPercentOfWindowVolume: 1,
  };

  const first = detectVolumeShelves(request);
  const second = detectVolumeShelves(request);

  assert.deepEqual(first, second);
  assert.deepEqual(candles, before);
});

test("detectVolumeShelves keeps first-pass shelf roles conservative", () => {
  const unknown = detectVolumeShelves({
    symbol: "role",
    asOfTimestamp: Date.parse("2026-05-01T09:40:00-04:00"),
    currentPrice: 20,
    bucketWidthPercent: 10,
    minShelfPercentOfWindowVolume: 1,
    candles5m: [
      candle("2026-05-01T09:30:00-04:00", 10, 10.2, 9.9, 10.1, 5_000),
      candle("2026-05-01T09:35:00-04:00", 12, 12.2, 11.9, 12.1, 500),
    ],
  });
  const chop = detectVolumeShelves({
    symbol: "role",
    asOfTimestamp: Date.parse("2026-05-01T10:00:00-04:00"),
    currentPrice: 20,
    bucketWidthPercent: 10,
    minShelfPercentOfWindowVolume: 1,
    candles5m: [
      candle("2026-05-01T09:30:00-04:00", 10.2, 12.2, 9.8, 10.2, 2_000),
      candle("2026-05-01T09:35:00-04:00", 10.4, 12.3, 9.9, 12.1, 2_000),
      candle("2026-05-01T09:40:00-04:00", 11.1, 12.1, 9.7, 9.9, 2_000),
    ],
  });

  assert.equal(unknown.shelves[0]?.shelfRole, "unknown");
  assert.equal(chop.shelves[0]?.shelfRole, "chop_zone");
});

test("detectVolumeShelves remains separate from volume facts and runtime level behavior", () => {
  const facts = buildVolumeMarketFacts({
    symbol: "sep",
    asOfTimestamp: Date.parse("2026-05-01T10:00:00-04:00"),
    candles5m: shelfFixture(),
    referencePrice: 10,
  });

  assert.equal(Object.hasOwn(facts, "volumeShelves"), false);
  assert.equal(Object.hasOwn(facts, "supportLevels"), false);
  assert.equal(Object.hasOwn(facts, "resistanceLevels"), false);
});
