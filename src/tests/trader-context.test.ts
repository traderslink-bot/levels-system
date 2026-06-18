import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import {
  TraderStoryMemory,
  buildCandleReactionContext,
  buildCatalystProfileRiskContext,
  buildDataQualityGateContext,
  buildFirstPostTradePlanContext,
  buildHaltAwarenessContext,
  buildLiquidityTradabilityContext,
  buildLevelQualityCalibrationContext,
  buildMoveExtensionContext,
  buildNoPostExplainerContext,
  buildOpeningRangeContext,
  buildSessionGapContext,
  buildSmallCapVolatilityContext,
  buildTradeIdeaSummaryContext,
  buildTraderIntelligenceContext,
} from "../lib/trader-context/index.js";

function candle(
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100_000,
): Candle {
  return { timestamp, open, high, low, close, volume };
}

test("liquidity context separates clean reads from messy spreads and thin dollar volume", () => {
  const start = Date.UTC(2026, 4, 1, 13, 30);
  const candles = Array.from({ length: 40 }, (_, index) =>
    candle(start + index * 5 * 60_000, 2, 2.1, 1.9, 2.05, 200_000),
  );

  const clean = buildLiquidityTradabilityContext({
    candles,
    bid: 2.04,
    ask: 2.045,
  });
  assert.equal(clean.label, "clean");
  assert.equal(clean.reliability, "reliable");
  assert.match(clean.traderLine ?? "", /clean enough/);

  const messy = buildLiquidityTradabilityContext({
    candles: candles.map((item) => ({ ...item, volume: 100 })),
    bid: 2,
    ask: 2.06,
  });
  assert.equal(messy.label, "messy");
  assert.equal(messy.reliability, "watch");
  assert.match(messy.traderLine ?? "", /messy/);
});

test("catalyst/profile context flags nano cap and low-float risk without trade advice", () => {
  const context = buildCatalystProfileRiskContext({
    marketCapDollars: 35_000_000,
    floatShares: 4_500_000,
    shortPercentOfFloat: 0.18,
    knownCatalyst: true,
  });

  assert.equal(context.label, "elevated");
  assert.equal(context.marketCapBucket, "nano");
  assert.equal(context.floatBucket, "micro_float");
  assert.equal(context.shortInterestLabel, "elevated");
  assert.doesNotMatch(context.traderLine ?? "", /\bbuy\b|\bsell\b|entry|exit/i);
});

test("session/gap context exposes prior day and premarket anchors", () => {
  const previousDay = candle(Date.UTC(2026, 3, 30, 20, 0), 1.1, 1.2, 0.95, 1);
  const currentDay = candle(Date.UTC(2026, 4, 1, 20, 0), 1.3, 1.5, 1.2, 1.4);
  const intraday = [
    candle(Date.UTC(2026, 4, 1, 8, 30), 1.12, 1.16, 1.08, 1.14),
    candle(Date.UTC(2026, 4, 1, 13, 30), 1.22, 1.28, 1.2, 1.27),
    candle(Date.UTC(2026, 4, 1, 13, 35), 1.27, 1.31, 1.24, 1.3),
  ];

  const context = buildSessionGapContext({
    dailyCandles: [previousDay, currentDay],
    intradayCandles: intraday,
    currentPrice: 1.3,
    sessionDate: "2026-05-01",
  });

  assert.equal(context.previousDayHigh, 1.2);
  assert.equal(context.premarketHigh, 1.16);
  assert.equal(context.openingRangeHigh, 1.31);
  assert.equal(context.label, "above_previous_high");
});

test("candle reaction context identifies clean breaks, wick rejection, and support defense", () => {
  const start = Date.UTC(2026, 4, 1, 13, 30);
  const cleanBreak = buildCandleReactionContext({
    candles: [
      candle(start, 3.6, 3.72, 3.58, 3.68),
      candle(start + 5 * 60_000, 3.7, 3.9, 3.68, 3.88),
    ],
    referenceLevel: { side: "resistance", price: 3.75 },
  });
  assert.equal(cleanBreak.label, "strong_close_through");

  const rejection = buildCandleReactionContext({
    candles: [
      candle(start, 3.6, 3.72, 3.58, 3.68),
      candle(start + 5 * 60_000, 3.7, 3.9, 3.66, 3.72),
    ],
    referenceLevel: { side: "resistance", price: 3.75 },
  });
  assert.equal(rejection.label, "wick_rejection");

  const supportDefense = buildCandleReactionContext({
    candles: [
      candle(start, 3.6, 3.72, 3.58, 3.68),
      candle(start + 5 * 60_000, 3.45, 3.55, 3.25, 3.5),
    ],
    referenceLevel: { side: "support", price: 3.34 },
  });
  assert.equal(supportDefense.label, "support_defense");
});

test("candle reaction context treats tiny small-cap level wiggles as minor until the move is material", () => {
  const start = Date.UTC(2026, 4, 1, 13, 30);
  const minorSupportSlip = buildCandleReactionContext({
    candles: [
      candle(start, 1.03, 1.04, 1.02, 1.025),
      candle(start + 5 * 60_000, 1.021, 1.024, 1.009, 1.01),
    ],
    referenceLevel: { side: "support", price: 1.02 },
    meaningfulMovePct: 2.25,
  });

  assert.equal(minorSupportSlip.label, "indecision");
  assert.equal(minorSupportSlip.materialityLabel, "minor");
  assert.ok(minorSupportSlip.reasons.some((reason) => /small-cap noise floor/.test(reason)));

  const materialSupportLoss = buildCandleReactionContext({
    candles: [
      candle(start, 1.03, 1.04, 1.02, 1.025),
      candle(start + 5 * 60_000, 1.02, 1.021, 0.98, 0.985),
    ],
    referenceLevel: { side: "support", price: 1.02 },
    meaningfulMovePct: 2.25,
  });

  assert.equal(materialSupportLoss.label, "support_loss");
  assert.equal(materialSupportLoss.materialityLabel, "material");
});

test("move extension context labels stretched moves using low, VWAP, EMA, and green streak", () => {
  const start = Date.UTC(2026, 4, 1, 13, 30);
  const candles = Array.from({ length: 8 }, (_, index) =>
    candle(start + index * 5 * 60_000, 1 + index * 0.1, 1.13 + index * 0.1, 0.98 + index * 0.1, 1.1 + index * 0.1),
  );

  const context = buildMoveExtensionContext({
    candles,
    currentPrice: 1.8,
    dynamicLevels: {
      vwap: 1.35,
      ema9: 1.42,
      ema20: 1.3,
      emaByPeriod: { 9: 1.42, 20: 1.3 },
      diagnostics: [],
    },
  });

  assert.equal(context.label, "stretched");
  assert.equal(context.greenCandleStreak, 8);
  assert.match(context.traderLine ?? "", /stretched/);
});

test("small-cap volatility context sets a meaningful move floor above penny noise", () => {
  const start = Date.UTC(2026, 4, 1, 13, 30);
  const candles = Array.from({ length: 18 }, (_, index) =>
    candle(start + index * 5 * 60_000, 1 + index * 0.001, 1.025 + index * 0.001, 0.99 + index * 0.001, 1.01 + index * 0.001),
  );

  const context = buildSmallCapVolatilityContext({ candles, currentPrice: 1.02 });

  assert.equal(context.priceBucket, "one_to_two");
  assert.equal(context.reliability, "reliable");
  assert.ok((context.meaningfulMovePct ?? 0) >= 2.25);
  assert.match(context.traderLine ?? "", /level reads|small-cap/);
});

test("opening range context identifies above-range and testing-range conditions", () => {
  const start = Date.UTC(2026, 4, 1, 13, 30);
  const candles = [
    candle(start, 2, 2.08, 1.95, 2.05),
    candle(start + 5 * 60_000, 2.05, 2.1, 2.01, 2.08),
    candle(start + 10 * 60_000, 2.08, 2.14, 2.04, 2.12),
    candle(start + 35 * 60_000, 2.2, 2.24, 2.16, 2.22),
  ];

  const context = buildOpeningRangeContext({ candles, currentPrice: 2.22 });

  assert.equal(context.label, "above_opening_range");
  assert.equal(context.high, 2.14);
  assert.match(context.traderLine ?? "", /above the opening range/);
});

test("halt awareness marks long stale gaps after fast moves as operator context", () => {
  const start = Date.UTC(2026, 4, 1, 13, 30);
  const candles = [
    candle(start, 10, 10.5, 9.8, 10.4),
    candle(start + 5 * 60_000, 10.4, 12.4, 10.2, 12.2),
  ];

  const context = buildHaltAwarenessContext({
    candles,
    now: start + 30 * 60_000,
  });

  assert.equal(context.label, "paused_after_fast_move");
  assert.equal(context.reliability, "watch");
});

test("level calibration flags thin forward ladders and wide first gaps without inventing levels", () => {
  const context = buildLevelQualityCalibrationContext({
    currentPrice: 1,
    levels: {
      symbol: "THIN",
      generatedAt: 1,
      majorSupport: [{ id: "s1", side: "support", representativePrice: 0.9 } as never],
      majorResistance: [{ id: "r1", side: "resistance", representativePrice: 1.5 } as never],
      intermediateSupport: [],
      intermediateResistance: [],
      intradaySupport: [],
      intradayResistance: [],
      extensionLevels: { support: [], resistance: [] },
      metadata: {
        freshness: "fresh",
        dataQualityFlags: ["thin_ladder"],
        providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
      },
      specialLevels: {},
    },
  });

  assert.equal(context.label, "wide_first_gap");
  assert.equal(context.resistanceCount, 1);
  assert.equal(context.forwardResistanceGapPct, null);
});

test("level calibration exposes crowded nearby zones as audit evidence", () => {
  const level = (id: string, side: "support" | "resistance", representativePrice: number, strengthLabel = "moderate") =>
    ({ id, side, kind: side, representativePrice, strengthLabel } as never);
  const context = buildLevelQualityCalibrationContext({
    currentPrice: 1.03,
    levels: {
      symbol: "CROWD",
      generatedAt: 1,
      majorSupport: [
        level("s1", "support", 1.02, "major"),
        level("s2", "support", 1),
        level("s3", "support", 0.9898),
        level("s4", "support", 0.95),
      ],
      majorResistance: [
        level("r1", "resistance", 1.06),
        level("r2", "resistance", 1.08),
        level("r3", "resistance", 1.1),
        level("r4", "resistance", 1.24),
      ],
      intermediateSupport: [],
      intermediateResistance: [],
      intradaySupport: [],
      intradayResistance: [],
      extensionLevels: { support: [], resistance: [] },
      metadata: {
        freshness: "fresh",
        dataQualityFlags: [],
        providerByTimeframe: { daily: "stub", "4h": "stub", "5m": "stub" },
      },
      specialLevels: {},
    },
  });

  assert.equal(context.label, "crowded_nearby_levels");
  assert.ok(context.tightSupportClusterCount >= 3);
  assert.ok(context.tightResistanceClusterCount >= 3);
  assert.match(context.traderLine ?? "", /practical zone matters/);
});

test("data quality gate degrades weak inputs and first-post plan stays non-advisory", () => {
  const liquidity = buildLiquidityTradabilityContext({ candles: [], bid: 1, ask: 1.04 });
  const volatility = buildSmallCapVolatilityContext({ candles: [], currentPrice: 1 });
  const sessionGap = buildSessionGapContext({ dailyCandles: [], intradayCandles: [], currentPrice: 1 });
  const candleReaction = buildCandleReactionContext({ candles: [] });
  const moveExtension = buildMoveExtensionContext({ candles: [], currentPrice: 1 });
  const haltAwareness = buildHaltAwarenessContext({ candles: [], now: 1 });
  const levelQuality = buildLevelQualityCalibrationContext({ currentPrice: 1 });
  const dataQuality = buildDataQualityGateContext({
    liquidity,
    volatility,
    sessionGap,
    candleReaction,
    moveExtension,
    levelQuality,
    haltAwareness,
    levelDataQualityFlags: ["degraded_data"],
  });
  const tradeIdea = buildTradeIdeaSummaryContext({
    symbol: "TEST",
    sessionGap,
    candleReaction,
    moveExtension,
    volatility,
    levelQuality,
    dataQuality,
  });
  const firstPostPlan = buildFirstPostTradePlanContext({
    symbol: "TEST",
    tradeIdea,
    dataQuality,
    volatility,
    openingRange: buildOpeningRangeContext({ candles: [], currentPrice: 1 }),
    levelQuality,
  });

  assert.equal(dataQuality.label, "unusable");
  assert.equal(tradeIdea.label, "needs_data");
  assert.doesNotMatch(firstPostPlan.lines.join("\n"), /\bbuy\b|\bsell\b|entry|exit|should enter/i);
});

test("no-post explainer records why repeated small wiggles do not need Discord", () => {
  const start = Date.UTC(2026, 4, 1, 13, 30);
  const candles = Array.from({ length: 12 }, (_, index) =>
    candle(start + index * 5 * 60_000, 2, 2.03, 1.98, 2.01),
  );
  const candleReaction = buildCandleReactionContext({ candles });
  const volatility = buildSmallCapVolatilityContext({ candles, currentPrice: 2 });
  const moveExtension = buildMoveExtensionContext({ candles, currentPrice: 2.01 });
  const dataQuality = buildDataQualityGateContext({
    liquidity: buildLiquidityTradabilityContext({ candles }),
    volatility,
    sessionGap: buildSessionGapContext({ intradayCandles: candles, currentPrice: 2.01 }),
    candleReaction,
    moveExtension,
    levelQuality: buildLevelQualityCalibrationContext({ currentPrice: 2.01 }),
    haltAwareness: buildHaltAwarenessContext({ candles, now: start + 55 * 60_000 }),
  });

  const context = buildNoPostExplainerContext({
    storyMemory: { decision: "cooldown", storyKey: "same", previousStoryKey: "same", cooldownMs: 600_000, elapsedMs: 60_000, reasons: [] },
    candleReaction,
    volatility,
    dataQuality,
    moveExtension,
  });

  assert.equal(context.decision, "no_post_needed");
  assert.ok(context.reasons.some((reason) => /same story already posted recently/.test(reason)));
});

test("story memory suppresses same story inside cooldown but allows material updates", () => {
  const memory = new TraderStoryMemory();
  const first = memory.evaluate("ABCD", "ABCD|range|resistance|1.12|rejection", 1_000);
  assert.equal(first.decision, "new_story");

  const repeat = memory.evaluate("ABCD", "ABCD|range|resistance|1.12|rejection", 2_000);
  assert.equal(repeat.decision, "cooldown");

  const material = memory.evaluate("ABCD", "ABCD|range|resistance|1.12|rejection", 3_000, true);
  assert.equal(material.decision, "material_update");
});

test("combined trader intelligence context returns the full quiet support stack", () => {
  const start = Date.UTC(2026, 4, 1, 13, 30);
  const intraday = Array.from({ length: 40 }, (_, index) =>
    candle(start + index * 5 * 60_000, 2 + index * 0.01, 2.05 + index * 0.01, 1.95 + index * 0.01, 2.03 + index * 0.01),
  );
  const context = buildTraderIntelligenceContext({
    symbol: "ctx",
    dailyCandles: [
      candle(Date.UTC(2026, 3, 30, 20, 0), 1.8, 2.1, 1.7, 1.9),
      candle(Date.UTC(2026, 4, 1, 20, 0), 2.1, 2.5, 2, 2.4),
    ],
    intradayCandles: intraday,
    bid: 2.39,
    ask: 2.4,
    referenceLevel: { side: "resistance", price: 2.35 },
  });

  assert.ok(context.liquidity);
  assert.ok(context.catalystProfile);
  assert.ok(context.sessionGap);
  assert.ok(context.candleReaction);
  assert.ok(context.moveExtension);
  assert.ok(context.volatility);
  assert.ok(context.openingRange);
  assert.ok(context.haltAwareness);
  assert.ok(context.levelQuality);
  assert.ok(context.dataQuality);
  assert.ok(context.tradeIdea);
  assert.ok(context.noPost);
  assert.ok(context.firstPostPlan);
  assert.ok(context.storyMemory);
});
