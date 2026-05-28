import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import { classifyMarketContext } from "../lib/market-context/index.js";

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

function evidenceCodes(profile: ReturnType<typeof classifyMarketContext>): string[] {
  return profile.evidence.map((item) => item.code);
}

test("classifyMarketContext identifies a normal intraday fixture", () => {
  const candles = [
    candle("2026-05-01T09:30:00-04:00", 10, 10.2, 9.95, 10.1),
    candle("2026-05-01T09:35:00-04:00", 10.1, 10.25, 10.05, 10.18),
    candle("2026-05-01T09:40:00-04:00", 10.18, 10.28, 10.1, 10.16),
    candle("2026-05-01T09:45:00-04:00", 10.16, 10.27, 10.08, 10.2),
  ];

  const profile = classifyMarketContext({
    symbol: "NORM",
    asOfTimestamp: Date.parse("2026-05-01T09:55:00-04:00"),
    referencePrice: 10.2,
    candles5m: candles,
    previousClose: 10,
    relativeVolume: 0.9,
    vwap: 10.12,
  });

  assert.equal(profile.primaryContext, "normal_intraday");
  assert.equal(profile.runnerPhase, "not_applicable");
  assert.equal(profile.facts.aboveVWAP, true);
  assert.equal(profile.scoringAdjustments.intradayWeightMultiplier, 1);
  assert.ok(evidenceCodes(profile).includes("modest_previous_close_move"));
});

test("classifyMarketContext identifies a premarket runner fixture", () => {
  const premarketCandles = [
    candle("2026-05-01T08:00:00-04:00", 1.05, 1.12, 1.02, 1.1, 500_000),
    candle("2026-05-01T08:05:00-04:00", 1.1, 1.2, 1.08, 1.18, 650_000),
    candle("2026-05-01T08:10:00-04:00", 1.18, 1.29, 1.15, 1.27, 700_000),
    candle("2026-05-01T08:15:00-04:00", 1.27, 1.35, 1.22, 1.33, 800_000),
  ];

  const profile = classifyMarketContext({
    symbol: "PREM",
    asOfTimestamp: Date.parse("2026-05-01T09:25:00-04:00"),
    referencePrice: 1.36,
    premarketCandles,
    previousClose: 1,
    relativeVolume: 5,
    dollarVolume: 1_500_000,
    vwap: 1.24,
  });

  assert.equal(profile.primaryContext, "premarket_runner");
  assert.equal(profile.runnerPhase, "premarket_discovery");
  assert.equal(profile.facts.abovePremarketHigh, true);
  assert.ok(evidenceCodes(profile).includes("large_gap_previous_close"));
  assert.ok(evidenceCodes(profile).includes("premarket_higher_lows"));
});

test("classifyMarketContext identifies a day trade runner fixture", () => {
  const regularCandles = [
    candle("2026-05-01T09:30:00-04:00", 2, 2.08, 1.98, 2.06, 600_000),
    candle("2026-05-01T09:35:00-04:00", 2.06, 2.15, 2.04, 2.12, 720_000),
    candle("2026-05-01T09:40:00-04:00", 2.12, 2.22, 2.1, 2.2, 850_000),
    candle("2026-05-01T09:45:00-04:00", 2.2, 2.31, 2.18, 2.3, 900_000),
  ];

  const profile = classifyMarketContext({
    symbol: "RUN",
    asOfTimestamp: Date.parse("2026-05-01T09:55:00-04:00"),
    referencePrice: 2.3,
    regularSessionCandles: regularCandles,
    previousClose: 2,
    relativeVolume: 4,
    dollarVolume: 2_000_000,
  });

  assert.equal(profile.primaryContext, "day_trade_runner");
  assert.equal(profile.runnerPhase, "high_of_day_breakout");
  assert.equal(profile.facts.aboveOpeningRangeHigh, false);
  assert.ok(evidenceCodes(profile).includes("strong_move_from_open"));
  assert.ok(evidenceCodes(profile).includes("high_regular_relative_volume"));
});

test("classifyMarketContext identifies a failed runner fixture", () => {
  const regularCandles = [
    candle("2026-05-01T09:30:00-04:00", 2, 2.7, 1.95, 2.6, 700_000),
    candle("2026-05-01T09:35:00-04:00", 2.6, 3.05, 2.45, 2.82, 900_000),
    candle("2026-05-01T09:40:00-04:00", 2.82, 2.78, 2.35, 2.45, 1_100_000),
    candle("2026-05-01T09:45:00-04:00", 2.45, 2.62, 2.2, 2.28, 1_500_000),
    candle("2026-05-01T09:50:00-04:00", 2.28, 2.45, 2.12, 2.24, 1_700_000),
  ];

  const profile = classifyMarketContext({
    symbol: "FAIL",
    asOfTimestamp: Date.parse("2026-05-01T10:00:00-04:00"),
    referencePrice: 2.24,
    regularSessionCandles: regularCandles,
    previousClose: 2,
    relativeVolume: 4,
    failedHighOfDayAttempts: 1,
  });

  assert.equal(profile.primaryContext, "failed_runner");
  assert.equal(profile.runnerPhase, "failed_breakout");
  assert.ok(evidenceCodes(profile).includes("failed_high_of_day_attempt"));
  assert.ok(evidenceCodes(profile).includes("material_pullback_from_high"));
});

test("classifyMarketContext identifies a parabolic extension fixture", () => {
  const regularCandles = [
    candle("2026-05-01T09:30:00-04:00", 1, 1.2, 0.98, 1.18, 700_000),
    candle("2026-05-01T09:35:00-04:00", 1.18, 1.42, 1.15, 1.4, 1_000_000),
    candle("2026-05-01T09:40:00-04:00", 1.4, 1.68, 1.36, 1.65, 1_500_000),
    candle("2026-05-01T09:45:00-04:00", 1.65, 1.88, 1.6, 1.82, 2_200_000),
  ];

  const profile = classifyMarketContext({
    symbol: "PARA",
    asOfTimestamp: Date.parse("2026-05-01T09:55:00-04:00"),
    referencePrice: 1.82,
    regularSessionCandles: regularCandles,
    previousClose: 1,
    relativeVolume: 8,
    vwap: 1.28,
  });

  assert.equal(profile.primaryContext, "parabolic_extension");
  assert.equal(profile.runnerPhase, "parabolic_extension");
  assert.equal(profile.facts.percentFromVWAP, 42.1875);
  assert.ok(evidenceCodes(profile).includes("extreme_move_from_open"));
  assert.ok(profile.warnings.some((warning) => warning.code === "extension_risk_context"));
});

test("classifyMarketContext identifies a choppy low-quality fixture", () => {
  const regularCandles = [
    candle("2026-05-01T09:30:00-04:00", 5, 5.08, 4.95, 5.05),
    candle("2026-05-01T09:35:00-04:00", 5.05, 5.09, 4.96, 4.99),
    candle("2026-05-01T09:40:00-04:00", 4.99, 5.07, 4.94, 5.04),
    candle("2026-05-01T09:45:00-04:00", 5.04, 5.08, 4.95, 4.98),
    candle("2026-05-01T09:50:00-04:00", 4.98, 5.06, 4.93, 5.03),
    candle("2026-05-01T09:55:00-04:00", 5.03, 5.07, 4.94, 4.99),
  ];

  const profile = classifyMarketContext({
    symbol: "CHOP",
    asOfTimestamp: Date.parse("2026-05-01T10:05:00-04:00"),
    referencePrice: 4.99,
    regularSessionCandles: regularCandles,
    previousClose: 5,
    relativeVolume: 0.8,
  });

  assert.equal(profile.primaryContext, "choppy_low_quality");
  assert.equal(profile.runnerPhase, "not_applicable");
  assert.ok(evidenceCodes(profile).includes("frequent_direction_changes"));
  assert.ok(evidenceCodes(profile).includes("overlapping_candle_ranges"));
  assert.ok(profile.warnings.some((warning) => warning.code === "low_quality_context"));
});

test("classifyMarketContext identifies swing structure only when higher-timeframe structure is supplied", () => {
  const candles = [
    candle("2026-05-01T09:30:00-04:00", 20, 20.2, 19.9, 20.1),
    candle("2026-05-01T09:35:00-04:00", 20.1, 20.25, 20, 20.2),
    candle("2026-05-01T09:40:00-04:00", 20.2, 20.35, 20.1, 20.3),
    candle("2026-05-01T09:45:00-04:00", 20.3, 20.38, 20.18, 20.25),
  ];

  const profile = classifyMarketContext({
    symbol: "SWNG",
    asOfTimestamp: Date.parse("2026-05-01T09:55:00-04:00"),
    referencePrice: 20.25,
    regularSessionCandles: candles,
    previousClose: 20,
    relativeVolume: 1.1,
    higherTimeframeStructure: {
      dailyLevelNearPrice: true,
      fourHourLevelNearPrice: true,
      multiDayTrend: "up",
    },
  });

  assert.equal(profile.primaryContext, "swing_structure");
  assert.equal(profile.runnerPhase, "not_applicable");
  assert.equal(profile.scoringAdjustments.dailyWeightMultiplier, 1.25);
  assert.ok(evidenceCodes(profile).includes("higher_timeframe_level_near_price"));
});

test("classifyMarketContext does not infer press_release_runner without explicit news or PR input", () => {
  const regularCandles = [
    candle("2026-05-01T09:30:00-04:00", 3, 3.3, 2.95, 3.25, 900_000),
    candle("2026-05-01T09:35:00-04:00", 3.25, 3.55, 3.2, 3.5, 1_200_000),
    candle("2026-05-01T09:40:00-04:00", 3.5, 3.78, 3.45, 3.7, 1_500_000),
  ];

  const withoutNews = classifyMarketContext({
    symbol: "NEWS",
    asOfTimestamp: Date.parse("2026-05-01T09:50:00-04:00"),
    referencePrice: 3.7,
    regularSessionCandles: regularCandles,
    previousClose: 3,
    relativeVolume: 4,
  });
  const withNews = classifyMarketContext({
    symbol: "NEWS",
    asOfTimestamp: Date.parse("2026-05-01T09:50:00-04:00"),
    referencePrice: 3.7,
    regularSessionCandles: regularCandles,
    previousClose: 3,
    relativeVolume: 4,
    pressReleaseTimestamp: Date.parse("2026-05-01T09:10:00-04:00"),
  });

  assert.notEqual(withoutNews.primaryContext, "press_release_runner");
  assert.equal(withNews.primaryContext, "press_release_runner");
  assert.ok(evidenceCodes(withNews).includes("explicit_news_or_pr_timestamp"));
});

test("classifyMarketContext filters future and partial candles using candle-close as-of semantics", () => {
  const candles = [
    candle("2026-05-01T09:25:00-04:00", 1, 1.03, 0.99, 1.02, 50_000),
    candle("2026-05-01T09:30:00-04:00", 1.02, 1.45, 1.01, 1.4, 900_000),
    candle("2026-05-01T09:35:00-04:00", 1.4, 1.8, 1.35, 1.75, 1_300_000),
    candle("2026-05-01T09:40:00-04:00", 1.75, 2.05, 1.7, 2, 1_800_000),
  ];

  const asOfEarly = classifyMarketContext({
    symbol: "ASOF",
    asOfTimestamp: Date.parse("2026-05-01T09:33:00-04:00"),
    referencePrice: 1.02,
    candles5m: candles,
    previousClose: 1,
    relativeVolume: 1,
  });
  const asOfClosed = classifyMarketContext({
    symbol: "ASOF",
    asOfTimestamp: Date.parse("2026-05-01T09:45:00-04:00"),
    referencePrice: 2,
    candles5m: candles,
    previousClose: 1,
    relativeVolume: 5,
  });

  assert.equal(asOfEarly.facts.filteredCandleCount, 1);
  assert.equal(asOfEarly.primaryContext, "normal_intraday");
  assert.ok(asOfEarly.warnings.some((warning) => warning.code === "partial_candles_filtered"));
  assert.ok(asOfEarly.warnings.some((warning) => warning.code === "future_candles_filtered"));
  assert.equal(asOfClosed.facts.filteredCandleCount, 4);
  assert.equal(asOfClosed.primaryContext, "parabolic_extension");
});

test("classifyMarketContext keeps VWAP market facts out of context scoring", () => {
  const regularCandles = [
    candle("2026-05-01T09:30:00-04:00", 2, 2.08, 1.98, 2.06, 600_000),
    candle("2026-05-01T09:35:00-04:00", 2.06, 2.15, 2.04, 2.12, 720_000),
    candle("2026-05-01T09:40:00-04:00", 2.12, 2.22, 2.1, 2.2, 850_000),
    candle("2026-05-01T09:45:00-04:00", 2.2, 2.31, 2.18, 2.3, 900_000),
  ];
  const baseInput = {
    symbol: "VWAP",
    asOfTimestamp: Date.parse("2026-05-01T09:55:00-04:00"),
    referencePrice: 2.3,
    regularSessionCandles: regularCandles,
    previousClose: 2,
    relativeVolume: 4,
    dollarVolume: 2_000_000,
  };

  const aboveVWAP = classifyMarketContext({
    ...baseInput,
    vwap: 2,
  });
  const belowVWAP = classifyMarketContext({
    ...baseInput,
    vwap: 3,
  });

  assert.equal(aboveVWAP.facts.aboveVWAP, true);
  assert.equal(belowVWAP.facts.aboveVWAP, false);
  assert.equal(aboveVWAP.primaryContext, belowVWAP.primaryContext);
  assert.equal(aboveVWAP.runnerPhase, belowVWAP.runnerPhase);
  assert.deepEqual(aboveVWAP.evidence, belowVWAP.evidence);
  assert.deepEqual(aboveVWAP.scoringAdjustments, belowVWAP.scoringAdjustments);
  assert.ok(aboveVWAP.warnings.some((warning) => warning.code === "vwap_facts_only"));
  assert.ok(evidenceCodes(aboveVWAP).every((code) => !code.includes("vwap")));
});

test("classifyMarketContext output is deterministic and does not mutate input candles", () => {
  const candles = [
    candle("2026-05-01T09:45:00-04:00", 10.16, 10.27, 10.08, 10.2),
    candle("2026-05-01T09:30:00-04:00", 10, 10.2, 9.95, 10.1),
    candle("2026-05-01T09:40:00-04:00", 10.18, 10.28, 10.1, 10.16),
    candle("2026-05-01T09:35:00-04:00", 10.1, 10.25, 10.05, 10.18),
  ];
  const before = structuredClone(candles);
  const input = {
    symbol: "DETR",
    asOfTimestamp: Date.parse("2026-05-01T09:55:00-04:00"),
    referencePrice: 10.2,
    candles5m: candles,
    previousClose: 10,
    relativeVolume: 0.9,
    vwap: 10.12,
  };

  const first = classifyMarketContext(input);
  const second = classifyMarketContext(input);

  assert.deepEqual(first, second);
  assert.deepEqual(candles, before);
});
