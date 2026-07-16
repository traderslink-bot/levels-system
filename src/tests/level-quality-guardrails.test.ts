import assert from "node:assert/strict";
import test from "node:test";

import type { BaseCandleProviderResponse, Candle } from "../lib/market-data/candle-types.js";
import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { buildSwingCandidateEvidence } from "../lib/levels/level-candidate-quality.js";
import { clusterRawLevelCandidates } from "../lib/levels/level-clusterer.js";
import { DEFAULT_LEVEL_ENGINE_CONFIG } from "../lib/levels/level-config.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import { rankLevelZones } from "../lib/levels/level-ranker.js";
import { buildRawLevelCandidates } from "../lib/levels/raw-level-candidate-builder.js";
import { scoreLevelZones } from "../lib/levels/level-scorer.js";
import { detectSwingPoints } from "../lib/levels/swing-detector.js";
import type { FinalLevelZone, RawLevelCandidate, SwingPoint } from "../lib/levels/level-types.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function makeZone(params: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "representativePrice">): FinalLevelZone {
  return {
    id: params.id,
    symbol: "QA",
    kind: params.kind ?? "resistance",
    timeframeBias: params.timeframeBias ?? "4h",
    zoneLow: params.representativePrice * 0.999,
    zoneHigh: params.representativePrice * 1.001,
    representativePrice: params.representativePrice,
    strengthScore: params.strengthScore ?? 30,
    strengthLabel: params.strengthLabel ?? "strong",
    touchCount: params.touchCount ?? 3,
    confluenceCount: params.confluenceCount ?? 1,
    sourceTypes: params.sourceTypes ?? ["swing_high"],
    timeframeSources: params.timeframeSources ?? ["4h"],
    reactionQualityScore: params.reactionQualityScore ?? 0.6,
    rejectionScore: params.rejectionScore ?? 0.5,
    displacementScore: params.displacementScore ?? 0.5,
    sessionSignificanceScore: params.sessionSignificanceScore ?? 0.5,
    followThroughScore: params.followThroughScore ?? 0.5,
    sourceEvidenceCount: params.sourceEvidenceCount ?? 1,
    firstTimestamp: params.firstTimestamp ?? 1,
    lastTimestamp: params.lastTimestamp ?? 2,
    isExtension: false,
    freshness: params.freshness ?? "fresh",
    notes: params.notes ?? [],
  };
}

test("broad repeated OHLC density is quarantined unless explicitly enabled", () => {
  const candles: Candle[] = Array.from({ length: 80 }, (_, index) => ({
    timestamp: Date.parse("2026-01-01T00:00:00.000Z") + index * DAY_MS,
    open: 10,
    high: 10.4,
    low: 9.6,
    close: 10,
    volume: 100_000,
  }));

  const defaultCandidates = buildRawLevelCandidates({
    symbol: "RANGE",
    timeframe: "daily",
    candles,
    swings: [],
  });
  const experimentalCandidates = buildRawLevelCandidates({
    symbol: "RANGE",
    timeframe: "daily",
    candles,
    swings: [],
    includeRepeatedOhlcPivots: true,
  });

  assert.equal(defaultCandidates.some((candidate) => candidate.id.includes("ohlc-pivot")), false);
  assert.equal(experimentalCandidates.some((candidate) => candidate.id.includes("ohlc-pivot")), true);
});

test("swing evidence does not count the same nearby retest twice", () => {
  const base = Date.parse("2026-07-01T13:30:00.000Z");
  const candles: Candle[] = [
    { timestamp: base, open: 9.6, high: 9.8, low: 9.5, close: 9.7, volume: 100 },
    { timestamp: base + HOUR_MS, open: 9.8, high: 10, low: 9.7, close: 9.85, volume: 100 },
    { timestamp: base + 2 * HOUR_MS, open: 9.9, high: 10, low: 9.75, close: 9.8, volume: 100 },
  ];
  const swing: SwingPoint = {
    index: 1,
    timestamp: candles[1]!.timestamp,
    price: 10,
    kind: "resistance",
    strength: 1,
    displacement: 0.1,
    separation: 2,
    reactionCount: 2,
  };

  const evidence = buildSwingCandidateEvidence(swing, "4h", candles);
  const overlappingEvidence = buildSwingCandidateEvidence(
    { ...swing, reactionCount: 1 },
    "4h",
    candles,
  );

  assert.equal(evidence.touchCount, 2);
  assert.equal(evidence.repeatedReactionCount, 2);
  assert.equal(evidence.reactionQuality, overlappingEvidence.reactionQuality);
});

test("five-minute swing evidence ignores zero-volume filler reactions", () => {
  const base = Date.parse("2026-07-01T13:30:00.000Z");
  const candles: Candle[] = Array.from({ length: 7 }, (_, index) => ({
    timestamp: base + index * 5 * 60_000,
    open: index >= 1 && index <= 5 ? 11.8 : 10,
    high: index >= 1 && index <= 5 ? 12 : 10.2,
    low: index >= 1 && index <= 5 ? 11.6 : 9.8,
    close: index >= 1 && index <= 5 ? 11.8 : 10,
    volume: index === 3 || index === 0 || index === 6 ? 100 : 0,
  }));
  const options = {
    swingWindow: 1,
    minimumDisplacementPct: 0,
    minimumSeparationBars: 1,
  };
  const permissive = detectSwingPoints(candles, options);
  const tradedOnly = detectSwingPoints(candles, {
    ...options,
    requirePositiveVolumeEvidence: true,
  });
  const permissivePivot = permissive.find(
    (swing) => swing.timestamp === candles[3]!.timestamp && swing.kind === "resistance",
  );
  const tradedPivot = tradedOnly.find(
    (swing) => swing.timestamp === candles[3]!.timestamp && swing.kind === "resistance",
  );

  assert.equal(permissivePivot?.reactionCount, 5);
  assert.equal(tradedPivot?.reactionCount, 1);
  assert.equal(
    tradedOnly.some((swing) => candles[swing.index]!.volume === 0),
    false,
  );
});

test("touch contribution saturates instead of turning repeated claims into huge scores", () => {
  const ordinary = makeZone({ id: "ordinary", representativePrice: 10, touchCount: 12 });
  const inflated = makeZone({ id: "inflated", representativePrice: 10, touchCount: 200 });

  const ordinaryScore = scoreLevelZones([ordinary], DEFAULT_LEVEL_ENGINE_CONFIG)[0]!.strengthScore;
  const inflatedScore = scoreLevelZones([inflated], DEFAULT_LEVEL_ENGINE_CONFIG)[0]!.strengthScore;

  assert.equal(inflatedScore, ordinaryScore);
});

test("clustered overlapping candidates do not sum duplicate touch windows", () => {
  const makeCandidate = (id: string, price: number, touchCount: number): RawLevelCandidate => ({
    id,
    symbol: "QA",
    price,
    kind: "support",
    timeframe: "5m",
    sourceType: "swing_low",
    touchCount,
    reactionScore: 1,
    reactionQuality: 0.5,
    rejectionScore: 0.5,
    displacementScore: 0.5,
    sessionSignificance: 0.5,
    followThroughScore: 0.5,
    gapContinuationScore: 0,
    repeatedReactionCount: touchCount,
    gapStructure: false,
    firstTimestamp: 1,
    lastTimestamp: 2,
    notes: [],
  });
  const zones = clusterRawLevelCandidates(
    "QA",
    "support",
    [makeCandidate("one", 10, 8), makeCandidate("two", 10.02, 7)],
    0.01,
    DEFAULT_LEVEL_ENGINE_CONFIG,
  );

  assert.equal(zones.length, 1);
  assert.equal(zones[0]?.touchCount, 8);
  assert.equal(zones[0]?.sourceEvidenceCount, 2);
});

test("nearest levels inside configured spacing keep one stronger representative", () => {
  const strongerNear = makeZone({
    id: "stronger-near",
    representativePrice: 191.0675,
    strengthScore: 84.16,
    confluenceCount: 2,
  });
  const weakerSecond = makeZone({
    id: "weaker-second",
    representativePrice: 191.96,
    strengthScore: 24.31,
  });

  const output = rankLevelZones({
    symbol: "AAOI",
    supportZones: [],
    resistanceZones: [strongerNear, weakerSecond],
    specialLevels: {},
    metadata: {
      providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 190,
    },
    config: DEFAULT_LEVEL_ENGINE_CONFIG,
  });

  assert.deepEqual(output.intermediateResistance.map((zone) => zone.id), ["stronger-near"]);
});

test("a stronger second ceiling outside true spacing does not erase the closest resistance", () => {
  const closest = makeZone({
    id: "closest-25",
    representativePrice: 25,
    strengthScore: 25,
    timeframeBias: "daily",
    timeframeSources: ["daily"],
  });
  const strongerSecond = makeZone({
    id: "stronger-25-49",
    representativePrice: 25.49,
    strengthScore: 42,
    confluenceCount: 3,
    rejectionScore: 0.8,
    followThroughScore: 0.8,
    timeframeBias: "daily",
    timeframeSources: ["daily", "4h"],
  });

  const output = rankLevelZones({
    symbol: "GME",
    supportZones: [],
    resistanceZones: [closest, strongerSecond],
    specialLevels: {},
    metadata: {
      providerByTimeframe: { daily: "stub", "4h": "stub" },
      dataQualityFlags: [],
      freshness: "fresh",
      referencePrice: 24.8,
    },
    config: DEFAULT_LEVEL_ENGINE_CONFIG,
  });

  assert.deepEqual(
    output.majorResistance.map((zone) => zone.id),
    ["stronger-25-49", "closest-25"],
  );
});

test("a weak bridge does not delete two already-spaced ladder levels", () => {
  const dailyResistance = [
    makeZone({ id: "left", representativePrice: 100, strengthScore: 50, timeframeBias: "daily", timeframeSources: ["daily"] }),
    makeZone({ id: "right", representativePrice: 103.5, strengthScore: 49, timeframeBias: "daily", timeframeSources: ["daily"] }),
    makeZone({ id: "outer-one", representativePrice: 112, strengthScore: 48, timeframeBias: "daily", timeframeSources: ["daily"] }),
    makeZone({ id: "outer-two", representativePrice: 124, strengthScore: 47, timeframeBias: "daily", timeframeSources: ["daily"] }),
    makeZone({ id: "weak-bridge", representativePrice: 101.75, strengthScore: 10, timeframeBias: "daily", timeframeSources: ["daily"] }),
  ];

  const output = rankLevelZones({
    symbol: "BRIDGE",
    supportZones: [],
    resistanceZones: dailyResistance,
    specialLevels: {},
    metadata: {
      providerByTimeframe: { daily: "stub" },
      dataQualityFlags: [],
      freshness: "fresh",
    },
    config: DEFAULT_LEVEL_ENGINE_CONFIG,
  });

  assert.deepEqual(
    output.majorResistance.map((zone) => zone.id),
    ["left", "right", "outer-one", "outer-two"],
  );
});

test("live reference override replaces stale fallback price when intraday history is unavailable", async () => {
  const base = Date.parse("2026-06-01T00:00:00.000Z");
  const responses = new Map<string, BaseCandleProviderResponse>();
  for (const timeframe of ["daily", "4h"] as const) {
    const interval = timeframe === "daily" ? DAY_MS : 4 * HOUR_MS;
    const candles: Candle[] = Array.from({ length: 30 }, (_, index) => ({
      timestamp: base + index * interval,
      open: 15.6,
      high: 16,
      low: 15.4,
      close: 15.8,
      volume: 100_000,
    }));
    responses.set(timeframe, {
      provider: "stub",
      symbol: "NVVE",
      timeframe,
      requestedLookbackBars: candles.length,
      candles,
      fetchStartTimestamp: base,
      fetchEndTimestamp: base,
      requestedStartTimestamp: candles[0]!.timestamp,
      requestedEndTimestamp: candles.at(-1)!.timestamp,
      sessionMetadataAvailable: false,
    });
  }

  const provider = {
    providerName: "stub" as const,
    async fetchCandles(request: { timeframe: "daily" | "4h" | "5m" }) {
      const response = responses.get(request.timeframe);
      if (!response) throw new Error("intraday unavailable");
      return response;
    },
  };
  const engine = new LevelEngine(new CandleFetchService(provider));
  const output = await engine.generateLevels({
    symbol: "NVVE",
    referencePriceOverride: 24.1906,
    historicalRequests: {
      daily: { symbol: "NVVE", timeframe: "daily", lookbackBars: 30 },
      "4h": { symbol: "NVVE", timeframe: "4h", lookbackBars: 30 },
      "5m": { symbol: "NVVE", timeframe: "5m", lookbackBars: 30 },
    },
  });

  assert.equal(output.metadata.referencePrice, 24.1906);
});

test("historical reference price ignores a zero-volume five-minute placeholder", async () => {
  const base = Date.parse("2026-06-01T00:00:00.000Z");
  const responses = new Map<string, BaseCandleProviderResponse>();
  for (const timeframe of ["daily", "4h", "5m"] as const) {
    const interval = timeframe === "daily" ? DAY_MS : timeframe === "4h" ? 4 * HOUR_MS : 5 * 60_000;
    const candles: Candle[] = Array.from({ length: 30 }, (_, index) => {
      const placeholder = timeframe === "5m" && index === 29;
      const close = placeholder ? 99 : timeframe === "5m" ? 10 : 9;
      return {
        timestamp: base + index * interval,
        open: close,
        high: close,
        low: close,
        close,
        volume: placeholder ? 0 : 100_000,
      };
    });
    responses.set(timeframe, {
      provider: "stub",
      symbol: "FILL",
      timeframe,
      requestedLookbackBars: candles.length,
      candles,
      fetchStartTimestamp: base,
      fetchEndTimestamp: base,
      requestedStartTimestamp: candles[0]!.timestamp,
      requestedEndTimestamp: candles.at(-1)!.timestamp,
      sessionMetadataAvailable: timeframe === "5m",
    });
  }
  const provider = {
    providerName: "stub" as const,
    async fetchCandles(request: { timeframe: "daily" | "4h" | "5m" }) {
      return responses.get(request.timeframe)!;
    },
  };
  const output = await new LevelEngine(new CandleFetchService(provider)).generateLevels({
    symbol: "FILL",
    historicalRequests: {
      daily: { symbol: "FILL", timeframe: "daily", lookbackBars: 30 },
      "4h": { symbol: "FILL", timeframe: "4h", lookbackBars: 30 },
      "5m": { symbol: "FILL", timeframe: "5m", lookbackBars: 30 },
    },
  });

  assert.equal(output.metadata.referencePrice, 10);
});
