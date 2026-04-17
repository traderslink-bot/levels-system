import assert from "node:assert/strict";
import test from "node:test";

import type { CandleProviderResponse } from "../lib/market-data/candle-types.js";
import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { clusterRawLevelCandidates } from "../lib/levels/level-clusterer.js";
import { DEFAULT_LEVEL_ENGINE_CONFIG } from "../lib/levels/level-config.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import { buildLevelExtensions } from "../lib/levels/level-extension-engine.js";
import { buildRawLevelCandidates } from "../lib/levels/raw-level-candidate-builder.js";
import { rankLevelZones } from "../lib/levels/level-ranker.js";
import { scoreLevelZones } from "../lib/levels/level-scorer.js";
import { detectSwingPoints } from "../lib/levels/swing-detector.js";
import type { FinalLevelZone } from "../lib/levels/level-types.js";

class FakeHistoricalProvider {
  readonly providerName = "stub" as const;

  constructor(private readonly responses: Record<string, CandleProviderResponse>) {}

  async fetchCandles(request: { symbol: string; timeframe: "daily" | "4h" | "5m" }) {
    const response = this.responses[request.timeframe];
    if (!response) {
      throw new Error(`Missing fake candle response for ${request.timeframe}.`);
    }

    return response;
  }
}

test("detectSwingPoints filters noisy nearby swings by separation and displacement", () => {
  const baseTimestamp = Date.parse("2026-04-15T09:30:00Z");
  const candles = [
    1.00, 1.03, 1.06, 1.09, 1.12, 1.08, 1.14, 1.10, 1.05, 1.01,
  ].map((close, index) => ({
    timestamp: baseTimestamp + index * 5 * 60 * 1000,
    open: close - 0.01,
    high: close + (index === 4 ? 0.08 : index === 6 ? 0.07 : 0.02),
    low: close - 0.03,
    close,
    volume: 1000 + index,
  }));

  const swings = detectSwingPoints(candles, {
    swingWindow: 1,
    minimumDisplacementPct: 0.04,
    minimumSeparationBars: 4,
  });

  assert.equal(swings.filter((swing) => swing.kind === "resistance").length, 1);
  assert.ok(swings[0]!.displacement > 0);
  assert.ok(swings[0]!.reactionCount >= 1);
});

test("buildRawLevelCandidates captures richer rejection and gap evidence from candles", () => {
  const baseTimestamp = Date.parse("2026-04-15T09:30:00Z");
  const candles = [
    { timestamp: baseTimestamp, open: 1.0, high: 1.02, low: 0.98, close: 1.01, volume: 1000 },
    { timestamp: baseTimestamp + 5 * 60 * 1000, open: 1.08, high: 1.18, low: 1.03, close: 1.05, volume: 2000 },
    { timestamp: baseTimestamp + 10 * 60 * 1000, open: 1.05, high: 1.17, low: 1.01, close: 1.04, volume: 1800 },
    { timestamp: baseTimestamp + 15 * 60 * 1000, open: 1.04, high: 1.16, low: 1.0, close: 1.03, volume: 1600 },
    { timestamp: baseTimestamp + 20 * 60 * 1000, open: 1.03, high: 1.08, low: 0.99, close: 1.01, volume: 1500 },
  ];
  const swings = detectSwingPoints(candles, {
    swingWindow: 1,
    minimumDisplacementPct: 0.05,
    minimumSeparationBars: 2,
  });

  const candidates = buildRawLevelCandidates({
    symbol: "ALBT",
    timeframe: "5m",
    candles,
    swings,
  });
  const resistance = candidates.find((candidate) => candidate.kind === "resistance");

  assert.ok(resistance);
  if (!resistance) {
    throw new Error("Expected resistance candidate.");
  }
  assert.ok(resistance.rejectionScore > 0.3);
  assert.equal(resistance.gapStructure, true);
  assert.ok(resistance.displacementScore > 0.05);
  assert.ok(resistance.followThroughScore > 0.45);
  assert.ok((resistance.gapContinuationScore ?? 0) > 0.45);
});

test("buildRawLevelCandidates does not overvalue a gap that fills quickly", () => {
  const baseTimestamp = Date.parse("2026-04-15T09:30:00Z");
  const candles = [
    { timestamp: baseTimestamp, open: 1.0, high: 1.02, low: 0.98, close: 1.01, volume: 1000 },
    { timestamp: baseTimestamp + 5 * 60 * 1000, open: 1.08, high: 1.17, low: 1.0, close: 1.02, volume: 2000 },
    { timestamp: baseTimestamp + 10 * 60 * 1000, open: 1.02, high: 1.15, low: 0.99, close: 1.01, volume: 1800 },
    { timestamp: baseTimestamp + 15 * 60 * 1000, open: 1.01, high: 1.12, low: 0.98, close: 1.0, volume: 1600 },
    { timestamp: baseTimestamp + 20 * 60 * 1000, open: 1.0, high: 1.04, low: 0.97, close: 0.99, volume: 1500 },
  ];
  const swings = detectSwingPoints(candles, {
    swingWindow: 1,
    minimumDisplacementPct: 0.05,
    minimumSeparationBars: 2,
  });

  const candidates = buildRawLevelCandidates({
    symbol: "ALBT",
    timeframe: "5m",
    candles,
    swings,
  });
  const resistance = candidates.find((candidate) => candidate.kind === "resistance");

  assert.ok(resistance);
  if (!resistance) {
    throw new Error("Expected resistance candidate.");
  }
  assert.equal(resistance.gapStructure, true);
  assert.ok((resistance.gapContinuationScore ?? 0) < 0.45);
});

test("buildRawLevelCandidates detects an isolated meaningful wick-high as a raw resistance candidate", () => {
  const baseTimestamp = Date.parse("2026-04-10T13:30:00Z");
  const candles = [
    { timestamp: baseTimestamp, open: 1.3, high: 1.36, low: 1.27, close: 1.34, volume: 1000 },
    { timestamp: baseTimestamp + 24 * 60 * 60 * 1000, open: 1.34, high: 1.39, low: 1.31, close: 1.37, volume: 1200 },
    { timestamp: baseTimestamp + 2 * 24 * 60 * 60 * 1000, open: 1.37, high: 1.76, low: 1.34, close: 1.46, volume: 3200 },
    { timestamp: baseTimestamp + 3 * 24 * 60 * 60 * 1000, open: 1.45, high: 1.55, low: 1.4, close: 1.43, volume: 1700 },
    { timestamp: baseTimestamp + 4 * 24 * 60 * 60 * 1000, open: 1.43, high: 1.48, low: 1.38, close: 1.41, volume: 1600 },
  ];

  const swings = detectSwingPoints(candles, {
    swingWindow: 1,
    minimumDisplacementPct: 0.08,
    minimumSeparationBars: 2,
  });

  const candidates = buildRawLevelCandidates({
    symbol: "GXAI",
    timeframe: "daily",
    candles,
    swings,
  });
  const resistance = candidates.find(
    (candidate) => candidate.kind === "resistance" && Math.abs(candidate.price - 1.76) < 0.001,
  );

  assert.ok(resistance);
  if (!resistance) {
    throw new Error("Expected isolated wick-high resistance candidate.");
  }
  assert.ok(resistance.rejectionScore > 0.45);
  assert.ok(resistance.followThroughScore > 0.35);
});

test("clusterRawLevelCandidates preserves the strongest nearby wick-led representative instead of averaging it away", () => {
  const candidates = [
    {
      id: "R-weak-local",
      symbol: "GXAI",
      price: 1.72,
      kind: "resistance" as const,
      timeframe: "5m" as const,
      sourceType: "swing_high" as const,
      touchCount: 1,
      reactionScore: 0.2,
      reactionQuality: 0.28,
      rejectionScore: 0.18,
      displacementScore: 0.21,
      sessionSignificance: 0.1,
      followThroughScore: 0.22,
      repeatedReactionCount: 0,
      gapStructure: false,
      firstTimestamp: 1,
      lastTimestamp: 2,
      notes: [],
    },
    {
      id: "R-strong-wick",
      symbol: "GXAI",
      price: 1.75,
      kind: "resistance" as const,
      timeframe: "daily" as const,
      sourceType: "swing_high" as const,
      touchCount: 2,
      reactionScore: 0.6,
      reactionQuality: 0.71,
      rejectionScore: 0.62,
      displacementScore: 0.66,
      sessionSignificance: 0.25,
      followThroughScore: 0.58,
      repeatedReactionCount: 1,
      gapStructure: false,
      firstTimestamp: 1,
      lastTimestamp: 3,
      notes: [],
    },
  ];

  const zones = clusterRawLevelCandidates(
    "GXAI",
    "resistance",
    candidates,
    0.03,
    DEFAULT_LEVEL_ENGINE_CONFIG,
  );

  assert.equal(zones.length, 1);
  assert.equal(zones[0]?.representativePrice, 1.75);
  assert.equal(zones[0]?.zoneLow, 1.72);
  assert.equal(zones[0]?.zoneHigh, 1.75);
});

test("LevelEngine returns metadata, session-accurate special levels, and extension ladders", async () => {
  const baseTimestamp = Date.parse("2026-04-15T00:00:00Z");
  const dailyCandles = Array.from({ length: 40 }, (_, index) => ({
    timestamp: baseTimestamp + index * 24 * 60 * 60 * 1000,
    open: 8 + index * 0.05,
    high: 8.3 + index * 0.08 + (index % 6 === 0 ? 0.4 : 0),
    low: 7.7 + index * 0.04 - (index % 7 === 0 ? 0.3 : 0),
    close: 8 + index * 0.06,
    volume: 100000 + index * 1000,
  }));
  const fourHourCandles = Array.from({ length: 60 }, (_, index) => ({
    timestamp: baseTimestamp + index * 4 * 60 * 60 * 1000,
    open: 9 + index * 0.03,
    high: 9.2 + index * 0.04 + (index % 8 === 0 ? 0.25 : 0),
    low: 8.8 + index * 0.02 - (index % 9 === 0 ? 0.2 : 0),
    close: 9 + index * 0.035,
    volume: 50000 + index * 600,
  }));
  const fiveMinuteCandles = [
    {
      timestamp: Date.parse("2026-04-15T08:15:00-04:00"),
      open: 2.1,
      high: 2.4,
      low: 2.0,
      close: 2.3,
      volume: 10000,
    },
    {
      timestamp: Date.parse("2026-04-15T08:45:00-04:00"),
      open: 2.3,
      high: 2.5,
      low: 2.2,
      close: 2.45,
      volume: 11000,
    },
    {
      timestamp: Date.parse("2026-04-15T09:35:00-04:00"),
      open: 2.46,
      high: 2.62,
      low: 2.4,
      close: 2.58,
      volume: 14000,
    },
    {
      timestamp: Date.parse("2026-04-15T09:50:00-04:00"),
      open: 2.58,
      high: 2.7,
      low: 2.5,
      close: 2.66,
      volume: 15000,
    },
    {
      timestamp: Date.parse("2026-04-15T10:20:00-04:00"),
      open: 2.62,
      high: 2.74,
      low: 2.55,
      close: 2.68,
      volume: 16000,
    },
    {
      timestamp: Date.parse("2026-04-15T10:45:00-04:00"),
      open: 2.68,
      high: 2.95,
      low: 2.6,
      close: 2.9,
      volume: 18000,
    },
    {
      timestamp: Date.parse("2026-04-15T11:15:00-04:00"),
      open: 2.9,
      high: 3.15,
      low: 2.82,
      close: 3.08,
      volume: 22000,
    },
    {
      timestamp: Date.parse("2026-04-15T16:30:00-04:00"),
      open: 3.05,
      high: 3.2,
      low: 2.98,
      close: 3.1,
      volume: 12000,
    },
  ];

  const provider = new FakeHistoricalProvider({
    daily: {
      provider: "stub",
      symbol: "ALBT",
      timeframe: "daily",
      requestedLookbackBars: 40,
      candles: dailyCandles,
      fetchStartTimestamp: 1,
      fetchEndTimestamp: 2,
      requestedStartTimestamp: dailyCandles[0]!.timestamp,
      requestedEndTimestamp: dailyCandles.at(-1)!.timestamp,
      sessionMetadataAvailable: false,
      actualBarsReturned: dailyCandles.length,
      completenessStatus: "complete",
      stale: false,
      validationIssues: [],
      sessionSummary: null,
    },
    "4h": {
      provider: "stub",
      symbol: "ALBT",
      timeframe: "4h",
      requestedLookbackBars: 60,
      candles: fourHourCandles,
      fetchStartTimestamp: 1,
      fetchEndTimestamp: 2,
      requestedStartTimestamp: fourHourCandles[0]!.timestamp,
      requestedEndTimestamp: fourHourCandles.at(-1)!.timestamp,
      sessionMetadataAvailable: false,
      actualBarsReturned: fourHourCandles.length,
      completenessStatus: "complete",
      stale: false,
      validationIssues: [],
      sessionSummary: null,
    },
    "5m": {
      provider: "stub",
      symbol: "ALBT",
      timeframe: "5m",
      requestedLookbackBars: 8,
      candles: fiveMinuteCandles,
      fetchStartTimestamp: 1,
      fetchEndTimestamp: 2,
      requestedStartTimestamp: fiveMinuteCandles[0]!.timestamp,
      requestedEndTimestamp: fiveMinuteCandles.at(-1)!.timestamp,
      sessionMetadataAvailable: true,
      actualBarsReturned: fiveMinuteCandles.length,
      completenessStatus: "complete",
      stale: false,
      validationIssues: [],
      sessionSummary: {
        premarketBars: 2,
        openingRangeBars: 2,
        regularBars: 3,
        afterHoursBars: 1,
        extendedBars: 0,
        unknownBars: 0,
        latestRegularSessionDate: "2026-04-15",
      },
    },
  });

  const engine = new LevelEngine(new CandleFetchService(provider as any));
  const output = await engine.generateLevels({
    symbol: "ALBT",
    historicalRequests: {
      daily: { symbol: "ALBT", timeframe: "daily", lookbackBars: 40 },
      "4h": { symbol: "ALBT", timeframe: "4h", lookbackBars: 60 },
      "5m": { symbol: "ALBT", timeframe: "5m", lookbackBars: 8 },
    },
  });

  assert.equal(output.metadata.providerByTimeframe.daily, "stub");
  assert.equal(output.metadata.freshness, "fresh");
  assert.deepEqual(output.metadata.dataQualityFlags, ["5m:suspicious_gap"]);
  assert.equal(output.specialLevels.premarketHigh, 2.5);
  assert.equal(output.specialLevels.openingRangeHigh, 2.7);
  assert.ok(Array.isArray(output.extensionLevels.resistance));
  assert.ok(Array.isArray(output.extensionLevels.support));
});

test("buildLevelExtensions exposes the next resistance and support ladder beyond surfaced zones", () => {
  const supportZones: FinalLevelZone[] = [
    {
      id: "S1",
      symbol: "ALBT",
      kind: "support",
      timeframeBias: "daily",
      zoneLow: 1.8,
      zoneHigh: 1.85,
      representativePrice: 1.82,
      strengthScore: 40,
      strengthLabel: "major",
      touchCount: 4,
      confluenceCount: 2,
      sourceTypes: ["swing_low"],
      timeframeSources: ["daily"],
      reactionQualityScore: 0.9,
      rejectionScore: 0.52,
      displacementScore: 0.85,
      sessionSignificanceScore: 0.2,
      followThroughScore: 0.82,
      sourceEvidenceCount: 2,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "S2",
      symbol: "ALBT",
      kind: "support",
      timeframeBias: "4h",
      zoneLow: 1.5,
      zoneHigh: 1.55,
      representativePrice: 1.52,
      strengthScore: 30,
      strengthLabel: "strong",
      touchCount: 3,
      confluenceCount: 1,
      sourceTypes: ["swing_low"],
      timeframeSources: ["4h"],
      reactionQualityScore: 0.75,
      rejectionScore: 0.38,
      displacementScore: 0.7,
      sessionSignificanceScore: 0.15,
      followThroughScore: 0.66,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
  ];
  const resistanceZones: FinalLevelZone[] = [
    {
      id: "R1",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "daily",
      zoneLow: 3.1,
      zoneHigh: 3.15,
      representativePrice: 3.12,
      strengthScore: 42,
      strengthLabel: "major",
      touchCount: 4,
      confluenceCount: 2,
      sourceTypes: ["swing_high"],
      timeframeSources: ["daily"],
      reactionQualityScore: 0.9,
      rejectionScore: 0.52,
      displacementScore: 0.85,
      sessionSignificanceScore: 0.2,
      followThroughScore: 0.82,
      sourceEvidenceCount: 2,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R2",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "4h",
      zoneLow: 3.45,
      zoneHigh: 3.5,
      representativePrice: 3.48,
      strengthScore: 30,
      strengthLabel: "strong",
      touchCount: 3,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["4h"],
      reactionQualityScore: 0.75,
      rejectionScore: 0.38,
      displacementScore: 0.7,
      sessionSignificanceScore: 0.15,
      followThroughScore: 0.66,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
  ];

  const extensions = buildLevelExtensions({
    supportZones,
    resistanceZones,
    surfacedSupport: [supportZones[0]!],
    surfacedResistance: [resistanceZones[0]!],
  });

  assert.deepEqual(extensions.support.map((zone) => zone.id), ["S2"]);
  assert.deepEqual(extensions.resistance.map((zone) => zone.id), ["R2"]);
  assert.ok(extensions.support.every((zone) => zone.isExtension));
  assert.ok(extensions.resistance.every((zone) => zone.isExtension));
});

test("ranked surfaced outputs prefer stronger spaced zones over overcrowded nearby 5m noise", async () => {
  const baseTimestamp = Date.parse("2026-04-15T09:30:00Z");
  const provider = new FakeHistoricalProvider({
    daily: {
      provider: "stub",
      symbol: "ALBT",
      timeframe: "daily",
      requestedLookbackBars: 20,
      candles: Array.from({ length: 20 }, (_, index) => ({
        timestamp: baseTimestamp + index * 24 * 60 * 60 * 1000,
        open: 5,
        high: 5.5 + (index % 4 === 0 ? 0.2 : 0),
        low: 4.7,
        close: 5.1,
        volume: 10000,
      })),
      fetchStartTimestamp: 1,
      fetchEndTimestamp: 2,
      requestedStartTimestamp: baseTimestamp,
      requestedEndTimestamp: baseTimestamp + 19 * 24 * 60 * 60 * 1000,
      sessionMetadataAvailable: false,
      actualBarsReturned: 20,
      completenessStatus: "complete",
      stale: false,
      validationIssues: [],
      sessionSummary: null,
    },
    "4h": {
      provider: "stub",
      symbol: "ALBT",
      timeframe: "4h",
      requestedLookbackBars: 20,
      candles: Array.from({ length: 20 }, (_, index) => ({
        timestamp: baseTimestamp + index * 4 * 60 * 60 * 1000,
        open: 3,
        high: 3.4 + (index % 5 === 0 ? 0.15 : 0),
        low: 2.8,
        close: 3.1,
        volume: 5000,
      })),
      fetchStartTimestamp: 1,
      fetchEndTimestamp: 2,
      requestedStartTimestamp: baseTimestamp,
      requestedEndTimestamp: baseTimestamp + 19 * 4 * 60 * 60 * 1000,
      sessionMetadataAvailable: false,
      actualBarsReturned: 20,
      completenessStatus: "complete",
      stale: false,
      validationIssues: [],
      sessionSummary: null,
    },
    "5m": {
      provider: "stub",
      symbol: "ALBT",
      timeframe: "5m",
      requestedLookbackBars: 15,
      candles: [
        { timestamp: baseTimestamp + 0, open: 2.2, high: 2.32, low: 2.18, close: 2.28, volume: 2000 },
        { timestamp: baseTimestamp + 5 * 60 * 1000, open: 2.28, high: 2.52, low: 2.25, close: 2.48, volume: 4000 },
        { timestamp: baseTimestamp + 10 * 60 * 1000, open: 2.48, high: 2.51, low: 2.3, close: 2.34, volume: 3500 },
        { timestamp: baseTimestamp + 15 * 60 * 1000, open: 2.34, high: 2.57, low: 2.31, close: 2.52, volume: 4200 },
        { timestamp: baseTimestamp + 20 * 60 * 1000, open: 2.52, high: 2.55, low: 2.33, close: 2.36, volume: 3000 },
        { timestamp: baseTimestamp + 25 * 60 * 1000, open: 2.36, high: 2.63, low: 2.34, close: 2.58, volume: 4600 },
        { timestamp: baseTimestamp + 30 * 60 * 1000, open: 2.58, high: 2.6, low: 2.37, close: 2.4, volume: 3200 },
        { timestamp: baseTimestamp + 35 * 60 * 1000, open: 2.4, high: 2.85, low: 2.38, close: 2.8, volume: 6000 },
        { timestamp: baseTimestamp + 40 * 60 * 1000, open: 2.8, high: 2.82, low: 2.42, close: 2.45, volume: 3500 },
        { timestamp: baseTimestamp + 45 * 60 * 1000, open: 2.45, high: 2.9, low: 2.43, close: 2.84, volume: 6200 },
        { timestamp: baseTimestamp + 50 * 60 * 1000, open: 2.84, high: 2.88, low: 2.5, close: 2.55, volume: 3400 },
        { timestamp: baseTimestamp + 55 * 60 * 1000, open: 2.55, high: 3.12, low: 2.53, close: 3.05, volume: 7000 },
        { timestamp: baseTimestamp + 60 * 60 * 1000, open: 3.05, high: 3.08, low: 2.7, close: 2.78, volume: 3800 },
        { timestamp: baseTimestamp + 65 * 60 * 1000, open: 2.78, high: 3.18, low: 2.76, close: 3.1, volume: 7200 },
        { timestamp: baseTimestamp + 70 * 60 * 1000, open: 3.1, high: 3.15, low: 2.82, close: 2.88, volume: 3600 },
      ],
      fetchStartTimestamp: 1,
      fetchEndTimestamp: 2,
      requestedStartTimestamp: baseTimestamp,
      requestedEndTimestamp: baseTimestamp + 70 * 60 * 1000,
      sessionMetadataAvailable: true,
      actualBarsReturned: 15,
      completenessStatus: "complete",
      stale: false,
      validationIssues: [],
      sessionSummary: {
        premarketBars: 0,
        openingRangeBars: 6,
        regularBars: 9,
        afterHoursBars: 0,
        extendedBars: 0,
        unknownBars: 0,
        latestRegularSessionDate: "2026-04-15",
      },
    },
  });

  const engine = new LevelEngine(new CandleFetchService(provider as any));
  const output = await engine.generateLevels({
    symbol: "ALBT",
    historicalRequests: {
      daily: { symbol: "ALBT", timeframe: "daily", lookbackBars: 20 },
      "4h": { symbol: "ALBT", timeframe: "4h", lookbackBars: 20 },
      "5m": { symbol: "ALBT", timeframe: "5m", lookbackBars: 15 },
    },
  });

  const sortedIntradayResistance = [...output.intradayResistance]
    .sort((a, b) => a.representativePrice - b.representativePrice);

  for (let index = 1; index < sortedIntradayResistance.length; index += 1) {
    const previous = sortedIntradayResistance[index - 1]!;
    const current = sortedIntradayResistance[index]!;
    const distancePct =
      Math.abs(current.representativePrice - previous.representativePrice) /
      Math.max(current.representativePrice, previous.representativePrice);
    assert.ok(distancePct > 0.0065);
  }
});

test("buildLevelExtensions skips near-duplicate extension levels and preserves cleaner ladder spacing", () => {
  const resistanceZones: FinalLevelZone[] = [
    {
      id: "R1",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "daily",
      zoneLow: 3.1,
      zoneHigh: 3.15,
      representativePrice: 3.12,
      strengthScore: 42,
      strengthLabel: "major",
      touchCount: 4,
      confluenceCount: 2,
      sourceTypes: ["swing_high"],
      timeframeSources: ["daily"],
      reactionQualityScore: 0.9,
      rejectionScore: 0.52,
      displacementScore: 0.85,
      sessionSignificanceScore: 0.2,
      followThroughScore: 0.84,
      sourceEvidenceCount: 2,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R2",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 3.18,
      zoneHigh: 3.21,
      representativePrice: 3.2,
      strengthScore: 21,
      strengthLabel: "moderate",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.55,
      rejectionScore: 0.33,
      displacementScore: 0.45,
      sessionSignificanceScore: 0.18,
      followThroughScore: 0.38,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R3",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "4h",
      zoneLow: 3.42,
      zoneHigh: 3.48,
      representativePrice: 3.45,
      strengthScore: 31,
      strengthLabel: "strong",
      touchCount: 3,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["4h"],
      reactionQualityScore: 0.74,
      rejectionScore: 0.41,
      displacementScore: 0.69,
      sessionSignificanceScore: 0.15,
      followThroughScore: 0.74,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
  ];

  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones,
    surfacedSupport: [],
    surfacedResistance: [resistanceZones[0]!],
    spacingPct: 0.03,
  });

  assert.deepEqual(extensions.resistance.map((zone) => zone.id), ["R3"]);
});

test("buildLevelExtensions prefers the stronger nearby follow-through candidate within the same local ladder band", () => {
  const resistanceZones: FinalLevelZone[] = [
    {
      id: "R1",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "daily",
      zoneLow: 3.1,
      zoneHigh: 3.15,
      representativePrice: 3.12,
      strengthScore: 42,
      strengthLabel: "major",
      touchCount: 4,
      confluenceCount: 2,
      sourceTypes: ["swing_high"],
      timeframeSources: ["daily"],
      reactionQualityScore: 0.9,
      rejectionScore: 0.52,
      displacementScore: 0.85,
      sessionSignificanceScore: 0.2,
      followThroughScore: 0.84,
      sourceEvidenceCount: 2,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R2",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 3.16,
      zoneHigh: 3.19,
      representativePrice: 3.18,
      strengthScore: 17,
      strengthLabel: "moderate",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.5,
      rejectionScore: 0.29,
      displacementScore: 0.38,
      sessionSignificanceScore: 0.12,
      followThroughScore: 0.31,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R3",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "4h",
      zoneLow: 3.2,
      zoneHigh: 3.25,
      representativePrice: 3.23,
      strengthScore: 30,
      strengthLabel: "strong",
      touchCount: 3,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["4h"],
      reactionQualityScore: 0.72,
      rejectionScore: 0.41,
      displacementScore: 0.67,
      sessionSignificanceScore: 0.15,
      followThroughScore: 0.73,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
  ];

  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones,
    surfacedSupport: [],
    surfacedResistance: [resistanceZones[0]!],
    spacingPct: 0.02,
  });

  assert.deepEqual(extensions.resistance.map((zone) => zone.id), ["R3"]);
});

test("buildLevelExtensions can skip a trivial closer leftover when a stronger frontier level is more useful", () => {
  const resistanceZones: FinalLevelZone[] = [
    {
      id: "R1",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "daily",
      zoneLow: 3.1,
      zoneHigh: 3.15,
      representativePrice: 3.12,
      strengthScore: 42,
      strengthLabel: "major",
      touchCount: 4,
      confluenceCount: 2,
      sourceTypes: ["swing_high"],
      timeframeSources: ["daily"],
      reactionQualityScore: 0.9,
      rejectionScore: 0.52,
      displacementScore: 0.85,
      sessionSignificanceScore: 0.2,
      followThroughScore: 0.84,
      sourceEvidenceCount: 2,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R2",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 3.17,
      zoneHigh: 3.2,
      representativePrice: 3.18,
      strengthScore: 14,
      strengthLabel: "moderate",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.47,
      rejectionScore: 0.24,
      displacementScore: 0.31,
      sessionSignificanceScore: 0.1,
      followThroughScore: 0.22,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R3",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "4h",
      zoneLow: 3.25,
      zoneHigh: 3.3,
      representativePrice: 3.27,
      strengthScore: 31,
      strengthLabel: "strong",
      touchCount: 3,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["4h"],
      reactionQualityScore: 0.73,
      rejectionScore: 0.39,
      displacementScore: 0.69,
      sessionSignificanceScore: 0.15,
      followThroughScore: 0.76,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
  ];

  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones,
    surfacedSupport: [],
    surfacedResistance: [resistanceZones[0]!],
    spacingPct: 0.01,
    searchWindowPct: 0.06,
  });

  assert.deepEqual(extensions.resistance.map((zone) => zone.id), ["R3"]);
});

test("buildLevelExtensions does not let nearby micro-structure crowd out a stronger isolated forward wick-high", () => {
  const resistanceZones: FinalLevelZone[] = [
    {
      id: "R1",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 1.48,
      zoneHigh: 1.5,
      representativePrice: 1.49,
      strengthScore: 24,
      strengthLabel: "moderate",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.58,
      rejectionScore: 0.31,
      displacementScore: 0.42,
      sessionSignificanceScore: 0.14,
      followThroughScore: 0.41,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R2",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 1.52,
      zoneHigh: 1.54,
      representativePrice: 1.53,
      strengthScore: 15,
      strengthLabel: "moderate",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.48,
      rejectionScore: 0.22,
      displacementScore: 0.29,
      sessionSignificanceScore: 0.11,
      followThroughScore: 0.22,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R3",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 1.57,
      zoneHigh: 1.59,
      representativePrice: 1.58,
      strengthScore: 16,
      strengthLabel: "moderate",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.49,
      rejectionScore: 0.24,
      displacementScore: 0.31,
      sessionSignificanceScore: 0.12,
      followThroughScore: 0.24,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R4",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 1.63,
      zoneHigh: 1.65,
      representativePrice: 1.64,
      strengthScore: 14,
      strengthLabel: "moderate",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.46,
      rejectionScore: 0.21,
      displacementScore: 0.27,
      sessionSignificanceScore: 0.12,
      followThroughScore: 0.2,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R5",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "daily",
      zoneLow: 1.73,
      zoneHigh: 1.76,
      representativePrice: 1.75,
      strengthScore: 32,
      strengthLabel: "strong",
      touchCount: 1,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["daily"],
      reactionQualityScore: 0.78,
      rejectionScore: 0.61,
      displacementScore: 0.74,
      sessionSignificanceScore: 0.2,
      followThroughScore: 0.72,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R6",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "4h",
      zoneLow: 1.84,
      zoneHigh: 1.86,
      representativePrice: 1.85,
      strengthScore: 23,
      strengthLabel: "moderate",
      touchCount: 1,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["4h"],
      reactionQualityScore: 0.65,
      rejectionScore: 0.37,
      displacementScore: 0.56,
      sessionSignificanceScore: 0.16,
      followThroughScore: 0.49,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
  ];

  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones,
    surfacedSupport: [],
    surfacedResistance: [resistanceZones[0]!],
    spacingPct: 0.01,
    searchWindowPct: 0.05,
  });

  assert.ok(extensions.resistance.map((zone) => zone.id).includes("R5"));
  assert.ok(extensions.resistance.map((zone) => zone.id).includes("R6"));
  assert.ok(!extensions.resistance.map((zone) => zone.id).includes("R4"));
  assert.equal(extensions.resistance.length, 3);
});

test("buildLevelExtensions prefers a decisive forward resistance over a weak intraday continuation leftover", () => {
  const resistanceZones: FinalLevelZone[] = [
    {
      id: "R1",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 1.47,
      zoneHigh: 1.5,
      representativePrice: 1.49,
      strengthScore: 22,
      strengthLabel: "moderate",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.56,
      rejectionScore: 0.29,
      displacementScore: 0.38,
      sessionSignificanceScore: 0.1,
      followThroughScore: 0.48,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R2",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 1.53,
      zoneHigh: 1.55,
      representativePrice: 1.54,
      strengthScore: 27,
      strengthLabel: "strong",
      touchCount: 3,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.54,
      rejectionScore: 0.24,
      displacementScore: 0.34,
      sessionSignificanceScore: 0.11,
      followThroughScore: 0.57,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R3",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "4h",
      zoneLow: 1.59,
      zoneHigh: 1.62,
      representativePrice: 1.6,
      strengthScore: 23,
      strengthLabel: "strong",
      touchCount: 1,
      confluenceCount: 2,
      sourceTypes: ["swing_high"],
      timeframeSources: ["4h"],
      reactionQualityScore: 0.74,
      rejectionScore: 0.53,
      displacementScore: 0.66,
      sessionSignificanceScore: 0.17,
      followThroughScore: 0.44,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
  ];

  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones,
    surfacedSupport: [],
    surfacedResistance: [resistanceZones[0]!],
    spacingPct: 0.01,
    searchWindowPct: 0.08,
    maxExtensionPerSide: 1,
  });

  assert.deepEqual(extensions.resistance.map((zone) => zone.id), ["R3"]);
});

test("buildLevelExtensions does not let a very far surfaced resistance push the extension frontier past practical forward levels", () => {
  const resistanceZones: FinalLevelZone[] = [
    {
      id: "visible-near",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "4h",
      zoneLow: 1.72,
      zoneHigh: 1.76,
      representativePrice: 1.74,
      strengthScore: 18,
      strengthLabel: "moderate",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["4h"],
      reactionQualityScore: 0.62,
      rejectionScore: 0.46,
      displacementScore: 0.53,
      sessionSignificanceScore: 0.15,
      followThroughScore: 0.48,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "surfaced-far-outlier",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "daily",
      zoneLow: 2.62,
      zoneHigh: 2.68,
      representativePrice: 2.65,
      strengthScore: 14,
      strengthLabel: "moderate",
      touchCount: 1,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["daily"],
      reactionQualityScore: 0.59,
      rejectionScore: 0.41,
      displacementScore: 0.51,
      sessionSignificanceScore: 0.18,
      followThroughScore: 0.42,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "practical-extension",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "4h",
      zoneLow: 1.83,
      zoneHigh: 1.87,
      representativePrice: 1.85,
      strengthScore: 23,
      strengthLabel: "moderate",
      touchCount: 1,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["4h"],
      reactionQualityScore: 0.66,
      rejectionScore: 0.41,
      displacementScore: 0.57,
      sessionSignificanceScore: 0.16,
      followThroughScore: 0.5,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "too-far-extension",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "daily",
      zoneLow: 2.94,
      zoneHigh: 2.98,
      representativePrice: 2.96,
      strengthScore: 13,
      strengthLabel: "moderate",
      touchCount: 1,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["daily"],
      reactionQualityScore: 0.55,
      rejectionScore: 0.4,
      displacementScore: 0.49,
      sessionSignificanceScore: 0.18,
      followThroughScore: 0.38,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
  ];

  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones,
    surfacedSupport: [],
    surfacedResistance: [resistanceZones[0]!, resistanceZones[1]!],
    spacingPct: 0.01,
    searchWindowPct: 0.08,
    maxExtensionPerSide: 1,
    referencePrice: 1.48,
  });

  assert.deepEqual(extensions.resistance.map((zone) => zone.id), ["practical-extension"]);
});

test("buildLevelExtensions prefers the practical far frontier over the absolute farthest resistance when a live reference price is available", () => {
  const resistanceZones: FinalLevelZone[] = [
    {
      id: "visible",
      symbol: "PMNT",
      kind: "resistance",
      timeframeBias: "4h",
      zoneLow: 0.465,
      zoneHigh: 0.475,
      representativePrice: 0.4699,
      strengthScore: 15,
      strengthLabel: "moderate",
      touchCount: 1,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["4h"],
      reactionQualityScore: 0.61,
      rejectionScore: 0.45,
      displacementScore: 0.52,
      sessionSignificanceScore: 0.15,
      followThroughScore: 0.43,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "practical-far",
      symbol: "PMNT",
      kind: "resistance",
      timeframeBias: "4h",
      zoneLow: 0.51,
      zoneHigh: 0.52,
      representativePrice: 0.515,
      strengthScore: 16,
      strengthLabel: "moderate",
      touchCount: 1,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["4h"],
      reactionQualityScore: 0.63,
      rejectionScore: 0.44,
      displacementScore: 0.55,
      sessionSignificanceScore: 0.15,
      followThroughScore: 0.45,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "absolute-farthest",
      symbol: "PMNT",
      kind: "resistance",
      timeframeBias: "daily",
      zoneLow: 0.83,
      zoneHigh: 0.85,
      representativePrice: 0.84,
      strengthScore: 14,
      strengthLabel: "moderate",
      touchCount: 1,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["daily"],
      reactionQualityScore: 0.58,
      rejectionScore: 0.39,
      displacementScore: 0.47,
      sessionSignificanceScore: 0.18,
      followThroughScore: 0.36,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
  ];

  const extensions = buildLevelExtensions({
    supportZones: [],
    resistanceZones,
    surfacedSupport: [],
    surfacedResistance: [resistanceZones[0]!],
    spacingPct: 0.01,
    searchWindowPct: 0.08,
    maxExtensionPerSide: 3,
    referencePrice: 0.3535,
  });

  assert.ok(extensions.resistance.map((zone) => zone.id).includes("practical-far"));
  assert.ok(!extensions.resistance.map((zone) => zone.id).includes("absolute-farthest"));
});

test("scoreLevelZones promotes mixed higher-timeframe confluence above similar 5m-only reaction structure", () => {
  const baseZone = {
    symbol: "ALBT",
    kind: "resistance" as const,
    zoneLow: 3.1,
    zoneHigh: 3.15,
    representativePrice: 3.12,
    touchCount: 3,
    sourceTypes: ["swing_high"] as FinalLevelZone["sourceTypes"],
    reactionQualityScore: 0.78,
    rejectionScore: 0.44,
    displacementScore: 0.72,
    sessionSignificanceScore: 0.18,
    followThroughScore: 0.76,
    sourceEvidenceCount: 2,
    firstTimestamp: Date.now() - 2 * 60 * 60 * 1000,
    lastTimestamp: Date.now() - 2 * 60 * 60 * 1000,
    sessionDate: undefined,
    isExtension: false,
    freshness: "fresh" as const,
    notes: [],
    strengthScore: 0,
    strengthLabel: "weak" as const,
  };

  const zones: FinalLevelZone[] = [
    {
      ...baseZone,
      id: "mixed-major",
      timeframeBias: "mixed",
      confluenceCount: 2,
      timeframeSources: ["daily", "4h"],
    },
    {
      ...baseZone,
      id: "intraday-noise",
      timeframeBias: "5m",
      confluenceCount: 1,
      timeframeSources: ["5m"],
    },
  ];

  const [mixed, intraday] = scoreLevelZones(zones, DEFAULT_LEVEL_ENGINE_CONFIG);

  assert.ok(mixed!.strengthScore > intraday!.strengthScore);
  assert.ok(mixed!.strengthLabel === "strong" || mixed!.strengthLabel === "major");
});

test("scoreLevelZones penalizes recycled intraday resistance that has touches but weak decision quality", () => {
  const baseZone = {
    symbol: "GXAI",
    kind: "resistance" as const,
    timeframeBias: "5m" as const,
    zoneLow: 1.5,
    zoneHigh: 1.54,
    representativePrice: 1.52,
    sourceTypes: ["swing_high"] as FinalLevelZone["sourceTypes"],
    timeframeSources: ["5m"] as FinalLevelZone["timeframeSources"],
    sessionSignificanceScore: 0.12,
    firstTimestamp: Date.now() - 60 * 60 * 1000,
    lastTimestamp: Date.now() - 60 * 60 * 1000,
    sessionDate: undefined,
    isExtension: false,
    freshness: "fresh" as const,
    notes: [],
    strengthScore: 0,
    strengthLabel: "weak" as const,
    gapContinuationScore: 0,
  };

  const recycled: FinalLevelZone = {
    ...baseZone,
    id: "recycled-local",
    touchCount: 5,
    confluenceCount: 1,
    reactionQualityScore: 0.48,
    rejectionScore: 0.25,
    displacementScore: 0.3,
    followThroughScore: 0.21,
    sourceEvidenceCount: 4,
  };
  const decisive: FinalLevelZone = {
    ...baseZone,
    id: "decisive-anchor",
    zoneLow: 1.56,
    zoneHigh: 1.6,
    representativePrice: 1.58,
    touchCount: 2,
    confluenceCount: 2,
    reactionQualityScore: 0.72,
    rejectionScore: 0.5,
    displacementScore: 0.62,
    followThroughScore: 0.58,
    sourceEvidenceCount: 2,
  };

  const scored = scoreLevelZones([recycled, decisive], DEFAULT_LEVEL_ENGINE_CONFIG);
  const recycledScored = scored.find((zone) => zone.id === "recycled-local")!;
  const decisiveScored = scored.find((zone) => zone.id === "decisive-anchor")!;

  assert.ok(decisiveScored.strengthScore > recycledScored.strengthScore);
  assert.ok(recycledScored.notes.some((note) => note === "recycledPenalty=0.7200"));
});

test("scoreLevelZones rewards open breakout path over cramped nearby continuation space", () => {
  const baseZone = {
    symbol: "ALBT",
    kind: "resistance" as const,
    timeframeBias: "4h" as const,
    zoneLow: 3.1,
    zoneHigh: 3.15,
    representativePrice: 3.12,
    touchCount: 3,
    sourceTypes: ["swing_high"] as FinalLevelZone["sourceTypes"],
    reactionQualityScore: 0.73,
    rejectionScore: 0.41,
    displacementScore: 0.66,
    sessionSignificanceScore: 0.15,
    followThroughScore: 0.72,
    sourceEvidenceCount: 1,
    firstTimestamp: Date.now() - 60 * 60 * 1000,
    lastTimestamp: Date.now() - 60 * 60 * 1000,
    sessionDate: undefined,
    isExtension: false,
    freshness: "fresh" as const,
    notes: [],
    strengthScore: 0,
    strengthLabel: "weak" as const,
    confluenceCount: 1,
    timeframeSources: ["4h"] as FinalLevelZone["timeframeSources"],
  };

  const openPath: FinalLevelZone = {
    ...baseZone,
    id: "open-path",
    zoneLow: 3.16,
    zoneHigh: 3.2,
    representativePrice: 3.18,
  };
  const cramped: FinalLevelZone = {
    ...baseZone,
    id: "cramped",
    zoneLow: 3.4,
    zoneHigh: 3.44,
    representativePrice: 3.42,
  };
  const blocker: FinalLevelZone = {
    ...baseZone,
    id: "blocker",
    zoneLow: 3.44,
    zoneHigh: 3.45,
    representativePrice: 3.445,
    followThroughScore: 0.28,
  };

  const scored = scoreLevelZones([openPath, cramped, blocker], DEFAULT_LEVEL_ENGINE_CONFIG);
  const openScored = scored.find((zone) => zone.id === "open-path")!;
  const crampedScored = scored.find((zone) => zone.id === "cramped")!;

  assert.ok(openScored.strengthScore > crampedScored.strengthScore);
  assert.ok(openScored.notes.some((note) => note.startsWith("pathClearance=")));
});

test("rankLevelZones surfaces mixed higher-timeframe zones once in the highest bucket", () => {
  const supportZones: FinalLevelZone[] = [];
  const resistanceZones: FinalLevelZone[] = [
    {
      id: "mix-1",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "mixed",
      zoneLow: 3.18,
      zoneHigh: 3.24,
      representativePrice: 3.21,
      strengthScore: 48,
      strengthLabel: "major",
      touchCount: 4,
      confluenceCount: 2,
      sourceTypes: ["swing_high"],
      timeframeSources: ["daily", "4h"],
      reactionQualityScore: 0.86,
      rejectionScore: 0.51,
      displacementScore: 0.83,
      sessionSignificanceScore: 0.21,
      followThroughScore: 0.86,
      sourceEvidenceCount: 2,
      firstTimestamp: 1,
      lastTimestamp: 2,
      sessionDate: undefined,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "4h-1",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "4h",
      zoneLow: 3.45,
      zoneHigh: 3.5,
      representativePrice: 3.47,
      strengthScore: 31,
      strengthLabel: "strong",
      touchCount: 3,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["4h"],
      reactionQualityScore: 0.72,
      rejectionScore: 0.38,
      displacementScore: 0.67,
      sessionSignificanceScore: 0.15,
      followThroughScore: 0.7,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      sessionDate: undefined,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "5m-1",
      symbol: "ALBT",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 3.7,
      zoneHigh: 3.74,
      representativePrice: 3.72,
      strengthScore: 18,
      strengthLabel: "moderate",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.53,
      rejectionScore: 0.31,
      displacementScore: 0.41,
      sessionSignificanceScore: 0.12,
      followThroughScore: 0.33,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      sessionDate: undefined,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
  ];

  const output = rankLevelZones({
    symbol: "ALBT",
    supportZones,
    resistanceZones,
    specialLevels: {},
    metadata: {
      providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
      dataQualityFlags: [],
      freshness: "fresh",
    },
    config: DEFAULT_LEVEL_ENGINE_CONFIG,
  });

  assert.deepEqual(output.majorResistance.map((zone) => zone.id), ["mix-1"]);
  assert.deepEqual(output.intermediateResistance.map((zone) => zone.id), ["4h-1"]);
  assert.deepEqual(output.intradayResistance.map((zone) => zone.id), ["5m-1"]);
  assert.ok(!output.intermediateResistance.some((zone) => zone.id === "mix-1"));
  assert.ok(!output.intradayResistance.some((zone) => zone.id === "mix-1"));
});

test("rankLevelZones suppresses weaker nearby band clutter while preserving stronger anchor levels", () => {
  const resistanceZones: FinalLevelZone[] = [
    {
      id: "R-near",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 1.48,
      zoneHigh: 1.5,
      representativePrice: 1.49,
      strengthScore: 16,
      strengthLabel: "moderate",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.42,
      rejectionScore: 0.28,
      displacementScore: 0.38,
      sessionSignificanceScore: 0.12,
      followThroughScore: 0.25,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      sessionDate: undefined,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R-anchor",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 1.57,
      zoneHigh: 1.59,
      representativePrice: 1.58,
      strengthScore: 27,
      strengthLabel: "strong",
      touchCount: 4,
      confluenceCount: 2,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.71,
      rejectionScore: 0.49,
      displacementScore: 0.64,
      sessionSignificanceScore: 0.18,
      followThroughScore: 0.56,
      sourceEvidenceCount: 2,
      firstTimestamp: 1,
      lastTimestamp: 2,
      sessionDate: undefined,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R-band-1",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 1.61,
      zoneHigh: 1.63,
      representativePrice: 1.62,
      strengthScore: 18,
      strengthLabel: "moderate",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.46,
      rejectionScore: 0.31,
      displacementScore: 0.4,
      sessionSignificanceScore: 0.11,
      followThroughScore: 0.29,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      sessionDate: undefined,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R-band-2",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 1.63,
      zoneHigh: 1.65,
      representativePrice: 1.64,
      strengthScore: 17,
      strengthLabel: "moderate",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.45,
      rejectionScore: 0.3,
      displacementScore: 0.39,
      sessionSignificanceScore: 0.11,
      followThroughScore: 0.28,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      sessionDate: undefined,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R-band-3",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "5m",
      zoneLow: 1.66,
      zoneHigh: 1.68,
      representativePrice: 1.67,
      strengthScore: 16,
      strengthLabel: "moderate",
      touchCount: 2,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["5m"],
      reactionQualityScore: 0.44,
      rejectionScore: 0.29,
      displacementScore: 0.38,
      sessionSignificanceScore: 0.1,
      followThroughScore: 0.27,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      sessionDate: undefined,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
    {
      id: "R-far",
      symbol: "GXAI",
      kind: "resistance",
      timeframeBias: "daily",
      zoneLow: 1.84,
      zoneHigh: 1.86,
      representativePrice: 1.85,
      strengthScore: 24,
      strengthLabel: "strong",
      touchCount: 3,
      confluenceCount: 1,
      sourceTypes: ["swing_high"],
      timeframeSources: ["daily"],
      reactionQualityScore: 0.67,
      rejectionScore: 0.52,
      displacementScore: 0.6,
      sessionSignificanceScore: 0.2,
      followThroughScore: 0.48,
      sourceEvidenceCount: 1,
      firstTimestamp: 1,
      lastTimestamp: 2,
      sessionDate: undefined,
      isExtension: false,
      freshness: "fresh",
      notes: [],
    },
  ];

  const output = rankLevelZones({
    symbol: "GXAI",
    supportZones: [],
    resistanceZones,
    specialLevels: {},
    metadata: {
      providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
      dataQualityFlags: [],
      freshness: "fresh",
    },
    config: DEFAULT_LEVEL_ENGINE_CONFIG,
  });

  const surfacedIds = [
    ...output.majorResistance.map((zone) => zone.id),
    ...output.intermediateResistance.map((zone) => zone.id),
    ...output.intradayResistance.map((zone) => zone.id),
  ];

  assert.ok(surfacedIds.includes("R-near"));
  assert.ok(surfacedIds.includes("R-anchor"));
  assert.ok(surfacedIds.includes("R-far"));
  assert.ok(!surfacedIds.includes("R-band-2"));
  assert.ok(!surfacedIds.includes("R-band-3"));
});
