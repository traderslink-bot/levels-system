import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import { CandleFetchService, StubHistoricalCandleProvider } from "../lib/market-data/candle-fetch-service.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import { resolveLevelRuntimeMode } from "../lib/levels/level-runtime-mode.js";
import type { FinalLevelZone, LevelEngineOutput } from "../lib/levels/level-types.js";
import {
  buildMarketContextAnalysis,
  buildMarketContextClassifierInput,
} from "../lib/market-context/index.js";

const FIXED_END_TIMESTAMP = Date.parse("2026-05-01T20:00:00.000Z");

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

function buildFixedLevelRequest(symbol: string) {
  return {
    symbol,
    historicalRequests: {
      daily: { symbol, timeframe: "daily" as const, lookbackBars: 260, endTimeMs: FIXED_END_TIMESTAMP },
      "4h": { symbol, timeframe: "4h" as const, lookbackBars: 220, endTimeMs: FIXED_END_TIMESTAMP },
      "5m": { symbol, timeframe: "5m" as const, lookbackBars: 140, endTimeMs: FIXED_END_TIMESTAMP },
    },
  };
}

function bucketCounts(output: LevelEngineOutput): {
  major: number;
  intermediate: number;
  intraday: number;
  extensionSupport: number;
  extensionResistance: number;
} {
  return {
    major: output.majorSupport.length + output.majorResistance.length,
    intermediate: output.intermediateSupport.length + output.intermediateResistance.length,
    intraday: output.intradaySupport.length + output.intradayResistance.length,
    extensionSupport: output.extensionLevels.support.length,
    extensionResistance: output.extensionLevels.resistance.length,
  };
}

function allRuntimeZones(output: LevelEngineOutput): FinalLevelZone[] {
  return [
    ...output.majorSupport,
    ...output.majorResistance,
    ...output.intermediateSupport,
    ...output.intermediateResistance,
    ...output.intradaySupport,
    ...output.intradayResistance,
    ...output.extensionLevels.support,
    ...output.extensionLevels.resistance,
  ];
}

function nearestRuntimeLevel(
  output: LevelEngineOutput,
  kind: FinalLevelZone["kind"],
  referencePrice: number,
): FinalLevelZone | null {
  const candidates = allRuntimeZones(output).filter((zone) =>
    kind === "support" ? zone.representativePrice < referencePrice : zone.representativePrice > referencePrice,
  );
  const sorted = candidates.sort((left, right) =>
    kind === "support"
      ? right.representativePrice - left.representativePrice
      : left.representativePrice - right.representativePrice,
  );
  return sorted[0] ?? null;
}

function outputTransportSnapshot(output: LevelEngineOutput): unknown {
  return {
    symbol: output.symbol,
    metadata: output.metadata,
    specialLevels: output.specialLevels,
    buckets: {
      majorSupport: output.majorSupport.map(zoneSnapshot),
      majorResistance: output.majorResistance.map(zoneSnapshot),
      intermediateSupport: output.intermediateSupport.map(zoneSnapshot),
      intermediateResistance: output.intermediateResistance.map(zoneSnapshot),
      intradaySupport: output.intradaySupport.map(zoneSnapshot),
      intradayResistance: output.intradayResistance.map(zoneSnapshot),
      extensionSupport: output.extensionLevels.support.map(zoneSnapshot),
      extensionResistance: output.extensionLevels.resistance.map(zoneSnapshot),
    },
  };
}

function zoneSnapshot(zone: FinalLevelZone): unknown {
  return {
    id: zone.id,
    kind: zone.kind,
    price: zone.representativePrice,
    strengthScore: zone.strengthScore,
    strengthLabel: zone.strengthLabel,
    enrichedAnalysis: zone.enrichedAnalysis,
  };
}

test("market context adapter builds classifier input from closed 5m candles and session facts", () => {
  const candles = [
    candle("2026-05-01T08:00:00-04:00", 1.02, 1.1, 1, 1.08, 500_000),
    candle("2026-05-01T08:05:00-04:00", 1.08, 1.2, 1.06, 1.18, 600_000),
    candle("2026-05-01T09:30:00-04:00", 1.18, 1.28, 1.16, 1.25, 700_000),
    candle("2026-05-01T09:35:00-04:00", 1.25, 1.36, 1.22, 1.34, 800_000),
  ];
  const before = structuredClone(candles);

  const adapted = buildMarketContextClassifierInput({
    symbol: "mcx",
    asOfTimestamp: Date.parse("2026-05-01T09:45:00-04:00"),
    referencePrice: 1.34,
    candles5m: candles,
    previousClose: 1,
    vwap: 1.2,
    relativeVolume: 4,
    dollarVolume: 2_000_000,
  });

  assert.equal(adapted.input.symbol, "mcx");
  assert.equal(adapted.input.candles5m?.length, 4);
  assert.equal(adapted.input.premarketCandles?.length, 2);
  assert.equal(adapted.input.regularSessionCandles?.length, 2);
  assert.equal(adapted.input.previousClose, 1);
  assert.equal(adapted.input.vwap, 1.2);
  assert.equal(adapted.inputSummary.symbol, "MCX");
  assert.equal(adapted.inputSummary.hasVWAPFact, true);
  assert.equal(adapted.inputSummary.closedFiveMinuteCandles, 4);
  assert.equal(adapted.diagnostics.futureCandlesExcluded, 0);
  assert.equal(adapted.diagnostics.partialCandlesExcluded, 0);
  assert.deepEqual(candles, before);
});

test("market context adapter excludes future and partial candles with candle-close as-of semantics", () => {
  const adapted = buildMarketContextClassifierInput({
    symbol: "ASOF",
    asOfTimestamp: Date.parse("2026-05-01T09:33:00-04:00"),
    referencePrice: 1.02,
    previousClose: 1,
    candles5m: [
      candle("2026-05-01T09:25:00-04:00", 1, 1.03, 0.99, 1.02),
      candle("2026-05-01T09:30:00-04:00", 1.02, 1.4, 1.01, 1.35),
      candle("2026-05-01T09:35:00-04:00", 1.35, 1.6, 1.32, 1.55),
    ],
  });

  assert.equal(adapted.input.candles5m?.length, 1);
  assert.equal(adapted.diagnostics.partialCandlesExcluded, 1);
  assert.equal(adapted.diagnostics.futureCandlesExcluded, 1);
  assert.deepEqual(
    adapted.diagnostics.filterDiagnostics.map((diagnostic) => diagnostic.code).sort(),
    ["future_candles_filtered", "partial_candles_filtered"],
  );
});

test("market context analysis is optional metadata and JSON-serializable", () => {
  const result = buildMarketContextAnalysis({
    symbol: "META",
    asOfTimestamp: Date.parse("2026-05-01T09:45:00-04:00"),
    referencePrice: 1.34,
    previousClose: 1,
    vwap: 1.2,
    relativeVolume: 4,
    dollarVolume: 2_000_000,
    candles5m: [
      candle("2026-05-01T08:00:00-04:00", 1.02, 1.1, 1, 1.08, 500_000),
      candle("2026-05-01T08:05:00-04:00", 1.08, 1.2, 1.06, 1.18, 600_000),
      candle("2026-05-01T09:30:00-04:00", 1.18, 1.28, 1.16, 1.25, 700_000),
      candle("2026-05-01T09:35:00-04:00", 1.25, 1.36, 1.22, 1.34, 800_000),
    ],
  });
  const serialized = JSON.parse(JSON.stringify(result)) as typeof result;

  assert.equal(result.levelOutputUnchanged, true);
  assert.equal(result.marketContext.source, "market_context_classifier");
  assert.equal(result.marketContext.version, 1);
  assert.equal(result.marketContext.generatedAsOfTimestamp, Date.parse("2026-05-01T09:45:00-04:00"));
  assert.equal(result.marketContext.profile.facts.aboveVWAP, true);
  assert.equal(result.marketContext.profile.facts.percentFromVWAP, 11.6667);
  assert.equal(result.marketContext.inputSummary.hasVWAPFact, true);
  assert.deepEqual(serialized, result);
  assert.equal(Object.hasOwn(result, "levelOutput"), false);
});

test("VWAP remains a facts-only input through the integration adapter", () => {
  const candles = [
    candle("2026-05-01T09:30:00-04:00", 2, 2.08, 1.98, 2.06, 600_000),
    candle("2026-05-01T09:35:00-04:00", 2.06, 2.15, 2.04, 2.12, 720_000),
    candle("2026-05-01T09:40:00-04:00", 2.12, 2.22, 2.1, 2.2, 850_000),
    candle("2026-05-01T09:45:00-04:00", 2.2, 2.31, 2.18, 2.3, 900_000),
  ];
  const baseRequest = {
    symbol: "VWAP",
    asOfTimestamp: Date.parse("2026-05-01T09:55:00-04:00"),
    referencePrice: 2.3,
    previousClose: 2,
    relativeVolume: 4,
    dollarVolume: 2_000_000,
    candles5m: candles,
  };

  const above = buildMarketContextAnalysis({
    ...baseRequest,
    vwap: 2,
  });
  const below = buildMarketContextAnalysis({
    ...baseRequest,
    vwap: 3,
  });

  assert.equal(above.marketContext.profile.facts.aboveVWAP, true);
  assert.equal(below.marketContext.profile.facts.aboveVWAP, false);
  assert.equal(above.marketContext.profile.primaryContext, below.marketContext.profile.primaryContext);
  assert.equal(above.marketContext.profile.runnerPhase, below.marketContext.profile.runnerPhase);
  assert.deepEqual(above.marketContext.profile.evidence, below.marketContext.profile.evidence);
  assert.deepEqual(above.marketContext.profile.scoringAdjustments, below.marketContext.profile.scoringAdjustments);
});

test("market context integration does not modify LevelEngine output or default runtime behavior", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-05-02T00:00:00Z"),
  });
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const request = buildFixedLevelRequest("NEAR");
  const defaultOutput = await new LevelEngine(service).generateLevels(request);
  const oldOutput = await new LevelEngine(service, undefined, { runtimeMode: "old" }).generateLevels(request);
  const oldSnapshot = outputTransportSnapshot(oldOutput);

  const analysis = buildMarketContextAnalysis({
    symbol: "NEAR",
    asOfTimestamp: FIXED_END_TIMESTAMP,
    referencePrice: oldOutput.metadata.referencePrice ?? 0,
    candles5m: (await service.fetchCandles(request.historicalRequests["5m"])).candles,
    previousClose: 4.25,
    relativeVolume: 1,
    vwap: oldOutput.metadata.referencePrice,
  });

  assert.equal(resolveLevelRuntimeMode(undefined), "old");
  assert.deepEqual(outputTransportSnapshot(defaultOutput), outputTransportSnapshot(oldOutput));
  assert.deepEqual(outputTransportSnapshot(oldOutput), oldSnapshot);
  assert.equal(Object.hasOwn(defaultOutput.metadata, "marketContext"), false);
  assert.equal(Object.hasOwn(oldOutput.metadata, "marketContext"), false);
  assert.equal(analysis.levelOutputUnchanged, true);
});

test("market context integration leaves bucket nearest extension special and enrichment parity unchanged", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-05-02T00:00:00Z"),
  });
  const service = new CandleFetchService(new StubHistoricalCandleProvider());
  const request = buildFixedLevelRequest("NEAR");
  const oldOutput = await new LevelEngine(service, undefined, { runtimeMode: "old" }).generateLevels(request);
  const newOutput = await new LevelEngine(service, undefined, { runtimeMode: "new" }).generateLevels(request);
  const referencePrice = oldOutput.metadata.referencePrice ?? 0;
  const oldNearestSupport = nearestRuntimeLevel(oldOutput, "support", referencePrice);
  const newNearestSupport = nearestRuntimeLevel(newOutput, "support", referencePrice);
  const oldNearestResistance = nearestRuntimeLevel(oldOutput, "resistance", referencePrice);
  const newNearestResistance = nearestRuntimeLevel(newOutput, "resistance", referencePrice);
  const oldEnrichedCount = allRuntimeZones(oldOutput).filter((zone) => zone.enrichedAnalysis).length;
  const newEnrichedCount = allRuntimeZones(newOutput).filter((zone) => zone.enrichedAnalysis).length;
  const oldSnapshot = outputTransportSnapshot(oldOutput);
  const newSnapshot = outputTransportSnapshot(newOutput);

  buildMarketContextAnalysis({
    symbol: "NEAR",
    asOfTimestamp: FIXED_END_TIMESTAMP,
    referencePrice,
    candles5m: (await service.fetchCandles(request.historicalRequests["5m"])).candles,
    previousClose: 4.25,
    relativeVolume: 1,
  });

  assert.deepEqual(bucketCounts(newOutput), bucketCounts(oldOutput));
  assert.equal(bucketCounts(oldOutput).major, 5);
  assert.equal(bucketCounts(oldOutput).intermediate, 2);
  assert.equal(bucketCounts(oldOutput).intraday, 1);
  assert.equal(
    bucketCounts(newOutput).extensionSupport + bucketCounts(newOutput).extensionResistance,
    bucketCounts(oldOutput).extensionSupport + bucketCounts(oldOutput).extensionResistance,
  );
  assert.ok(bucketCounts(oldOutput).extensionSupport + bucketCounts(oldOutput).extensionResistance > 0);
  assert.equal(oldNearestSupport?.representativePrice, 4.5284);
  assert.equal(newNearestSupport?.representativePrice, 4.5284);
  assert.equal(oldNearestResistance?.representativePrice, 4.6771);
  assert.equal(newNearestResistance?.representativePrice, 4.6771);
  assert.deepEqual(newOutput.specialLevels, oldOutput.specialLevels);
  assert.equal(allRuntimeZones(oldOutput).filter((zone) => zone.enrichedAnalysis).length, oldEnrichedCount);
  assert.equal(allRuntimeZones(newOutput).filter((zone) => zone.enrichedAnalysis).length, newEnrichedCount);
  assert.deepEqual(outputTransportSnapshot(oldOutput), oldSnapshot);
  assert.deepEqual(outputTransportSnapshot(newOutput), newSnapshot);
});
