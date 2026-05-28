import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import { buildMarketContextFactsBundle } from "../lib/market-context/index.js";
import { buildSessionMarketFacts } from "../lib/session/index.js";
import {
  buildVolumeMarketFacts,
  detectVolumeShelves,
  type VolumeShelf,
} from "../lib/volume/index.js";

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

function contextCandles(): Candle[] {
  return [
    candle("2026-05-01T08:00:00-04:00", 1, 1.08, 0.98, 1.06, 100_000),
    candle("2026-05-01T08:05:00-04:00", 1.06, 1.16, 1.04, 1.14, 120_000),
    candle("2026-05-01T09:30:00-04:00", 1.14, 1.24, 1.1, 1.22, 140_000),
    candle("2026-05-01T09:35:00-04:00", 1.22, 1.34, 1.2, 1.32, 160_000),
    candle("2026-05-01T09:40:00-04:00", 1.32, 1.48, 1.3, 1.46, 180_000),
    candle("2026-05-01T09:45:00-04:00", 1.46, 1.62, 1.42, 1.58, 900_000),
  ];
}

function buildFacts() {
  const candles = contextCandles();
  const asOfTimestamp = Date.parse("2026-05-01T10:00:00-04:00");
  const sessionFacts = buildSessionMarketFacts({
    symbol: "bundle",
    asOfTimestamp,
    candles5m: candles,
    previousClose: 1,
    currentPrice: 1.58,
  });
  const volumeFacts = buildVolumeMarketFacts({
    symbol: "bundle",
    asOfTimestamp,
    candles5m: candles,
    referencePrice: 1.58,
  });
  const volumeShelves = detectVolumeShelves({
    symbol: "bundle",
    asOfTimestamp,
    candles5m: candles,
    currentPrice: 1.58,
    bucketWidthPercent: 10,
    minShelfPercentOfWindowVolume: 1,
  }).shelves;

  return {
    candles,
    asOfTimestamp,
    sessionFacts,
    volumeFacts,
    volumeShelves,
  };
}

function manualShelf(): VolumeShelf {
  return {
    id: "BUNDLE-volume-shelf-manual",
    zoneLow: 1.45,
    zoneHigh: 1.6,
    representativePrice: 1.52,
    totalVolume: 900_000,
    dollarVolume: 1_368_000,
    percentOfWindowVolume: 56.25,
    touchCount: 3,
    firstTimestamp: Date.parse("2026-05-01T09:35:00-04:00"),
    lastTimestamp: Date.parse("2026-05-01T09:45:00-04:00"),
    shelfRole: "support",
    confidence: 0.72,
    reason: "High activity shelf carried as facts-only metadata.",
  };
}

test("buildMarketContextFactsBundle combines session facts", () => {
  const { sessionFacts, volumeFacts } = buildFacts();
  const bundle = buildMarketContextFactsBundle({
    sessionFacts,
    volumeFacts,
  });

  assert.equal(bundle.symbol, "BUNDLE");
  assert.equal(bundle.asOfTimestamp, sessionFacts.asOfTimestamp);
  assert.equal(bundle.referencePrice, sessionFacts.currentPrice);
  assert.deepEqual(bundle.sessionFacts, sessionFacts);
  assert.notStrictEqual(bundle.sessionFacts, sessionFacts);
  assert.notStrictEqual(bundle.sessionFacts.diagnostics, sessionFacts.diagnostics);
});

test("buildMarketContextFactsBundle combines volume facts", () => {
  const { sessionFacts, volumeFacts } = buildFacts();
  const bundle = buildMarketContextFactsBundle({
    sessionFacts,
    volumeFacts,
  });

  assert.deepEqual(bundle.volumeFacts, volumeFacts);
  assert.notStrictEqual(bundle.volumeFacts, volumeFacts);
  assert.notStrictEqual(bundle.volumeFacts.diagnostics, volumeFacts.diagnostics);
  assert.equal(bundle.volumeFacts.relativeVolume, volumeFacts.relativeVolume);
  assert.equal(bundle.volumeFacts.dollarVolume, volumeFacts.dollarVolume);
  assert.equal(bundle.diagnostics.volumeDiagnostics.length, volumeFacts.diagnostics.length);
});

test("buildMarketContextFactsBundle combines volume shelves", () => {
  const { sessionFacts, volumeFacts, volumeShelves } = buildFacts();
  const bundle = buildMarketContextFactsBundle({
    sessionFacts,
    volumeFacts,
    volumeShelves,
  });

  assert.deepEqual(bundle.volumeShelves, volumeShelves);
  assert.notStrictEqual(bundle.volumeShelves, volumeShelves);
  assert.notStrictEqual(bundle.volumeShelves[0], volumeShelves[0]);
  assert.ok(bundle.volumeShelves.length > 0);
});

test("buildMarketContextFactsBundle preserves shelves as facts-only metadata", () => {
  const { sessionFacts, volumeFacts } = buildFacts();
  const shelf = manualShelf();
  const bundle = buildMarketContextFactsBundle({
    sessionFacts,
    volumeFacts,
    volumeShelves: [shelf],
  });

  assert.equal(bundle.shelvesAreFactsOnly, true);
  assert.deepEqual(bundle.volumeShelves, [shelf]);
  assert.equal(bundle.volumeShelves[0]?.shelfRole, "support");
  assert.equal(Object.hasOwn(bundle, "supportLevels"), false);
  assert.equal(Object.hasOwn(bundle, "resistanceLevels"), false);
  assert.equal(Object.hasOwn(bundle, "majorSupport"), false);
  assert.equal(Object.hasOwn(bundle, "majorResistance"), false);
});

test("buildMarketContextFactsBundle carries explicit news and PR timestamp metadata", () => {
  const { sessionFacts, volumeFacts } = buildFacts();
  const newsTimestamp = Date.parse("2026-05-01T09:10:00-04:00");
  const pressReleaseTimestamp = Date.parse("2026-05-01T09:15:00-04:00");
  const bundle = buildMarketContextFactsBundle({
    sessionFacts,
    volumeFacts,
    newsTimestamp,
    pressReleaseTimestamp,
  });

  assert.equal(bundle.news?.hasExplicitCatalyst, true);
  assert.equal(bundle.news?.newsTimestamp, newsTimestamp);
  assert.equal(bundle.news?.pressReleaseTimestamp, pressReleaseTimestamp);
});

test("buildMarketContextFactsBundle leaves news metadata undefined when no explicit catalyst exists", () => {
  const { sessionFacts, volumeFacts } = buildFacts();
  const bundle = buildMarketContextFactsBundle({
    sessionFacts,
    volumeFacts,
  });

  assert.equal(bundle.news, undefined);
});

test("buildMarketContextFactsBundle keeps VWAP facts-only", () => {
  const { sessionFacts, volumeFacts } = buildFacts();
  const bundle = buildMarketContextFactsBundle({
    sessionFacts,
    volumeFacts,
  });

  assert.equal(bundle.vwapFactsOnly, true);
  assert.equal(bundle.sessionFacts.vwap, sessionFacts.vwap);
  assert.equal(bundle.sessionFacts.aboveVWAP, sessionFacts.aboveVWAP);
  assert.equal(bundle.sessionFacts.percentFromVWAP, sessionFacts.percentFromVWAP);
  assert.equal(Object.hasOwn(bundle, "profile"), false);
  assert.equal(Object.hasOwn(bundle, "scoringAdjustments"), false);
});

test("buildMarketContextFactsBundle does not mutate inputs and is deterministic", () => {
  const { sessionFacts, volumeFacts, volumeShelves } = buildFacts();
  const sessionBefore = structuredClone(sessionFacts);
  const volumeBefore = structuredClone(volumeFacts);
  const shelvesBefore = structuredClone(volumeShelves);
  const request = {
    sessionFacts,
    volumeFacts,
    volumeShelves,
    symbol: "override",
    referencePrice: 2,
    newsTimestamp: Date.parse("2026-05-01T09:10:00-04:00"),
  };

  const first = buildMarketContextFactsBundle(request);
  const second = buildMarketContextFactsBundle(request);

  assert.deepEqual(first, second);
  assert.equal(first.symbol, "OVERRIDE");
  assert.equal(first.referencePrice, 2);
  assert.deepEqual(sessionFacts, sessionBefore);
  assert.deepEqual(volumeFacts, volumeBefore);
  assert.deepEqual(volumeShelves, shelvesBefore);
});

test("buildMarketContextFactsBundle does not expose LevelEngine output or change runtime defaults", () => {
  const { sessionFacts, volumeFacts, volumeShelves } = buildFacts();
  const bundle = buildMarketContextFactsBundle({
    sessionFacts,
    volumeFacts,
    volumeShelves,
  });

  assert.equal(resolveLevelRuntimeMode(undefined), "old");
  assert.equal(bundle.levelOutputUnchanged, true);
  assert.equal(Object.hasOwn(bundle, "levelOutput"), false);
  assert.equal(Object.hasOwn(bundle, "metadata"), false);
  assert.equal(Object.hasOwn(bundle, "extensionLevels"), false);
});

test("buildMarketContextFactsBundle leaves session volume and shelf builders behavior unchanged", () => {
  const { candles, asOfTimestamp, sessionFacts, volumeFacts, volumeShelves } = buildFacts();
  const sessionBefore = structuredClone(sessionFacts);
  const volumeBefore = structuredClone(volumeFacts);
  const shelvesBefore = structuredClone(volumeShelves);

  buildMarketContextFactsBundle({
    sessionFacts,
    volumeFacts,
    volumeShelves,
  });

  assert.deepEqual(
    buildSessionMarketFacts({
      symbol: "bundle",
      asOfTimestamp,
      candles5m: candles,
      previousClose: 1,
      currentPrice: 1.58,
    }),
    sessionBefore,
  );
  assert.deepEqual(
    buildVolumeMarketFacts({
      symbol: "bundle",
      asOfTimestamp,
      candles5m: candles,
      referencePrice: 1.58,
    }),
    volumeBefore,
  );
  assert.deepEqual(
    detectVolumeShelves({
      symbol: "bundle",
      asOfTimestamp,
      candles5m: candles,
      currentPrice: 1.58,
      bucketWidthPercent: 10,
      minShelfPercentOfWindowVolume: 1,
    }).shelves,
    shelvesBefore,
  );
});
