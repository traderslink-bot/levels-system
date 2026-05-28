import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import {
  buildMarketContextAnalysisFromFacts,
  buildMarketContextClassifierInputFromFacts,
} from "../lib/market-context/index.js";
import { buildSessionMarketFacts, type SessionMarketFacts } from "../lib/session/index.js";
import {
  buildVolumeMarketFacts,
  detectVolumeShelves,
  type VolumeMarketFacts,
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

function buildFacts(): {
  sessionFacts: SessionMarketFacts;
  volumeFacts: VolumeMarketFacts;
  volumeShelves: VolumeShelf[];
} {
  const candles = contextCandles();
  const asOfTimestamp = Date.parse("2026-05-01T10:00:00-04:00");
  const sessionFacts = buildSessionMarketFacts({
    symbol: "fact",
    asOfTimestamp,
    candles5m: candles,
    previousClose: 1,
    currentPrice: 1.58,
  });
  const volumeFacts = buildVolumeMarketFacts({
    symbol: "fact",
    asOfTimestamp,
    candles5m: candles,
    referencePrice: 1.58,
  });
  const volumeShelves = detectVolumeShelves({
    symbol: "fact",
    asOfTimestamp,
    candles5m: candles,
    currentPrice: 1.58,
    bucketWidthPercent: 10,
    minShelfPercentOfWindowVolume: 1,
  }).shelves;

  return {
    sessionFacts,
    volumeFacts,
    volumeShelves,
  };
}

function manualShelf(): VolumeShelf {
  return {
    id: "FACT-volume-shelf-manual",
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
    reason: "High activity shelf used as facts-only market context metadata.",
  };
}

test("facts adapter maps session facts into classifier facts", () => {
  const { sessionFacts, volumeFacts } = buildFacts();
  const result = buildMarketContextAnalysisFromFacts({
    sessionFacts,
    volumeFacts,
  });

  assert.equal(result.marketContext.inputSummary.symbol, "FACT");
  assert.equal(result.marketContext.inputSummary.hasSessionFacts, true);
  assert.equal(result.marketContext.inputSummary.hasPreviousClose, true);
  assert.equal(result.marketContext.inputSummary.hasVWAPFact, true);
  assert.equal(result.marketContext.facts.session.previousClose, sessionFacts.previousClose);
  assert.equal(result.marketContext.facts.session.currentPrice, sessionFacts.currentPrice);
  assert.equal(result.marketContext.facts.session.premarketHigh, sessionFacts.premarketHigh);
  assert.equal(result.marketContext.facts.session.openingRangeHigh, sessionFacts.openingRangeHigh);
  assert.equal(result.marketContext.profile.facts.percentFromPreviousClose, 58);
  assert.equal(result.marketContext.profile.facts.aboveVWAP, sessionFacts.aboveVWAP);
  assert.equal(result.marketContext.profile.facts.percentFromVWAP, sessionFacts.percentFromVWAP);
});

test("facts adapter maps volume facts into classifier facts", () => {
  const { sessionFacts, volumeFacts } = buildFacts();
  const adapted = buildMarketContextClassifierInputFromFacts({
    sessionFacts,
    volumeFacts,
  });
  const analysis = buildMarketContextAnalysisFromFacts({
    sessionFacts,
    volumeFacts,
  });

  assert.equal(adapted.input.relativeVolume, volumeFacts.relativeVolume);
  assert.equal(adapted.input.dollarVolume, volumeFacts.dollarVolume);
  assert.equal(adapted.inputSummary.hasRelativeVolume, true);
  assert.equal(adapted.inputSummary.hasDollarVolume, true);
  assert.equal(adapted.facts.volume?.volumeState, volumeFacts.volumeState);
  assert.equal(adapted.facts.volume?.liquidityQuality, volumeFacts.liquidityQuality);
  assert.equal(analysis.marketContext.profile.facts.relativeVolume, volumeFacts.relativeVolume);
  assert.equal(analysis.marketContext.profile.facts.dollarVolume, volumeFacts.dollarVolume);
});

test("facts adapter includes volume shelves without turning them into support or resistance levels", () => {
  const { sessionFacts, volumeFacts } = buildFacts();
  const shelf = manualShelf();
  const result = buildMarketContextAnalysisFromFacts({
    sessionFacts,
    volumeFacts,
    volumeShelves: [shelf],
  });

  assert.equal(result.volumeShelvesAreFactsOnly, true);
  assert.deepEqual(result.marketContext.facts.volumeShelves, [shelf]);
  assert.equal(result.marketContext.inputSummary.volumeShelfCount, 1);
  assert.equal(Object.hasOwn(result.marketContext, "supportLevels"), false);
  assert.equal(Object.hasOwn(result.marketContext, "resistanceLevels"), false);
  assert.equal(Object.hasOwn(result.marketContext.profile.facts, "supportLevels"), false);
  assert.equal(Object.hasOwn(result.marketContext.profile.facts, "resistanceLevels"), false);
});

test("explicit news or PR timestamp can enable press release runner classification", () => {
  const { sessionFacts, volumeFacts } = buildFacts();
  const pressReleaseTimestamp = Date.parse("2026-05-01T09:15:00-04:00");

  const withCatalyst = buildMarketContextAnalysisFromFacts({
    sessionFacts,
    volumeFacts,
    pressReleaseTimestamp,
  });
  const withoutCatalyst = buildMarketContextAnalysisFromFacts({
    sessionFacts,
    volumeFacts,
  });

  assert.equal(withCatalyst.marketContext.inputSummary.hasExplicitCatalyst, true);
  assert.equal(withCatalyst.marketContext.profile.primaryContext, "press_release_runner");
  assert.equal(
    withCatalyst.marketContext.profile.evidence.some(
      (evidence) => evidence.code === "explicit_news_or_pr_timestamp",
    ),
    true,
  );
  assert.notEqual(withoutCatalyst.marketContext.profile.primaryContext, "press_release_runner");
});

test("price action alone does not force press release runner classification", () => {
  const { sessionFacts, volumeFacts } = buildFacts();
  const result = buildMarketContextAnalysisFromFacts({
    sessionFacts,
    volumeFacts,
  });

  assert.equal(result.marketContext.inputSummary.hasExplicitCatalyst, false);
  assert.equal(
    result.marketContext.profile.evidence.some(
      (evidence) => evidence.context === "press_release_runner",
    ),
    false,
  );
  assert.notEqual(result.marketContext.profile.primaryContext, "press_release_runner");
});

test("VWAP remains facts-only when adapting prebuilt facts", () => {
  const { sessionFacts, volumeFacts } = buildFacts();
  const belowVWAPFacts: SessionMarketFacts = {
    ...sessionFacts,
    vwap: 2,
    aboveVWAP: false,
    percentFromVWAP: -21,
  };
  const aboveVWAP = buildMarketContextAnalysisFromFacts({
    sessionFacts,
    volumeFacts,
  });
  const belowVWAP = buildMarketContextAnalysisFromFacts({
    sessionFacts: belowVWAPFacts,
    volumeFacts,
  });

  assert.equal(aboveVWAP.marketContext.profile.facts.aboveVWAP, true);
  assert.equal(belowVWAP.marketContext.profile.facts.aboveVWAP, false);
  assert.equal(aboveVWAP.marketContext.profile.primaryContext, belowVWAP.marketContext.profile.primaryContext);
  assert.equal(aboveVWAP.marketContext.profile.runnerPhase, belowVWAP.marketContext.profile.runnerPhase);
  assert.deepEqual(aboveVWAP.marketContext.profile.evidence, belowVWAP.marketContext.profile.evidence);
  assert.deepEqual(
    aboveVWAP.marketContext.profile.scoringAdjustments,
    belowVWAP.marketContext.profile.scoringAdjustments,
  );
});

test("facts adapter does not mutate inputs and returns deterministic output", () => {
  const { sessionFacts, volumeFacts, volumeShelves } = buildFacts();
  const sessionBefore = structuredClone(sessionFacts);
  const volumeBefore = structuredClone(volumeFacts);
  const shelvesBefore = structuredClone(volumeShelves);
  const request = {
    sessionFacts,
    volumeFacts,
    volumeShelves,
    newsTimestamp: Date.parse("2026-05-01T09:10:00-04:00"),
  };

  const first = buildMarketContextAnalysisFromFacts(request);
  const second = buildMarketContextAnalysisFromFacts(request);

  assert.deepEqual(first, second);
  assert.deepEqual(sessionFacts, sessionBefore);
  assert.deepEqual(volumeFacts, volumeBefore);
  assert.deepEqual(volumeShelves, shelvesBefore);
});

test("facts adapter remains optional and does not expose LevelEngine output behavior", () => {
  const { sessionFacts, volumeFacts } = buildFacts();
  const result = buildMarketContextAnalysisFromFacts({
    sessionFacts,
    volumeFacts,
  });

  assert.equal(resolveLevelRuntimeMode(undefined), "old");
  assert.equal(result.levelOutputUnchanged, true);
  assert.equal(Object.hasOwn(result, "levelOutput"), false);
  assert.equal(Object.hasOwn(result.marketContext, "majorSupport"), false);
  assert.equal(Object.hasOwn(result.marketContext, "extensionLevels"), false);
});
