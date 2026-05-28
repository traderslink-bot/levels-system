import type { Candle } from "../market-data/candle-types.js";
import { filterCandlesByCloseAsOf } from "../market-data/candle-as-of-filter.js";
import { classifyCandleSessions } from "../market-data/candle-session-classifier.js";

export type MarketContextPrimary =
  | "normal_intraday"
  | "premarket_runner"
  | "day_trade_runner"
  | "press_release_runner"
  | "swing_structure"
  | "failed_runner"
  | "choppy_low_quality"
  | "parabolic_extension";

export type RunnerPhase =
  | "not_applicable"
  | "premarket_discovery"
  | "opening_drive"
  | "first_pullback"
  | "vwap_hold"
  | "vwap_reclaim"
  | "high_of_day_breakout"
  | "second_leg_attempt"
  | "parabolic_extension"
  | "failed_breakout"
  | "fade";

export type MarketContextEvidence = {
  code: string;
  context: MarketContextPrimary;
  message: string;
  weight: number;
};

export type MarketContextWarning = {
  code: string;
  severity: "info" | "warning";
  message: string;
};

export type MarketContextFacts = {
  percentFromPreviousClose?: number;
  percentFromOpen?: number;
  percentFromVWAP?: number;
  relativeVolume?: number;
  dollarVolume?: number;
  aboveVWAP?: boolean;
  abovePremarketHigh?: boolean;
  aboveOpeningRangeHigh?: boolean;
  nearHighOfDay?: boolean;
  premarketHigh?: number;
  openingRangeHigh?: number;
  highOfDay?: number;
  filteredCandleCount: number;
  filteredPremarketCandleCount: number;
  filteredRegularSessionCandleCount: number;
};

export type MarketContextScoringAdjustments = {
  intradayWeightMultiplier: number;
  dailyWeightMultiplier: number;
  sessionLevelWeightMultiplier: number;
  volumeWeightMultiplier: number;
  extensionRiskPenaltyMultiplier: number;
};

export type MarketContextProfile = {
  primaryContext: MarketContextPrimary;
  confidence: number;
  runnerPhase: RunnerPhase;
  evidence: MarketContextEvidence[];
  warnings: MarketContextWarning[];
  facts: MarketContextFacts;
  scoringAdjustments: MarketContextScoringAdjustments;
};

export type MarketContextHigherTimeframeStructure = {
  dailyLevelNearPrice?: boolean;
  fourHourLevelNearPrice?: boolean;
  multiDayTrend?: "up" | "down" | "range";
};

export type ClassifyMarketContextInput = {
  symbol: string;
  asOfTimestamp: number;
  referencePrice: number;
  candles5m?: Candle[];
  premarketCandles?: Candle[];
  regularSessionCandles?: Candle[];
  previousClose?: number;
  vwap?: number;
  relativeVolume?: number;
  dollarVolume?: number;
  failedHighOfDayAttempts?: number;
  newsTimestamp?: number;
  pressReleaseTimestamp?: number;
  higherTimeframeStructure?: MarketContextHigherTimeframeStructure;
};

const CONTEXTS: MarketContextPrimary[] = [
  "normal_intraday",
  "premarket_runner",
  "day_trade_runner",
  "press_release_runner",
  "swing_structure",
  "failed_runner",
  "choppy_low_quality",
  "parabolic_extension",
];

const RANKING_PRIORITY: MarketContextPrimary[] = [
  "press_release_runner",
  "parabolic_extension",
  "failed_runner",
  "premarket_runner",
  "day_trade_runner",
  "choppy_low_quality",
  "swing_structure",
  "normal_intraday",
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isUsableNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function percentChange(value: number, base: number | undefined): number | undefined {
  if (!isUsableNumber(base) || base === 0) {
    return undefined;
  }

  return round(((value - base) / base) * 100);
}

function maxValue(values: number[]): number | undefined {
  return values.length === 0 ? undefined : Math.max(...values);
}

function minValue(values: number[]): number | undefined {
  return values.length === 0 ? undefined : Math.min(...values);
}

function mergeUniqueCandles(candles: Candle[][]): Candle[] {
  const byTimestamp = new Map<number, Candle>();
  for (const candle of candles.flat()) {
    byTimestamp.set(candle.timestamp, candle);
  }

  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function filterFiveMinuteCandles(
  candles: Candle[],
  asOfTimestamp: number,
): {
  candles: Candle[];
  warnings: MarketContextWarning[];
} {
  const result = filterCandlesByCloseAsOf({
    candles,
    timeframe: "5m",
    asOfTimestamp,
  });
  const warnings: MarketContextWarning[] = [];

  if (result.excludedFutureCount > 0) {
    warnings.push({
      code: "future_candles_filtered",
      severity: "info",
      message: `${result.excludedFutureCount} future 5m candle(s) were excluded from market context classification.`,
    });
  }
  if (result.excludedPartialCount > 0) {
    warnings.push({
      code: "partial_candles_filtered",
      severity: "info",
      message: `${result.excludedPartialCount} partial 5m candle(s) were excluded from market context classification.`,
    });
  }

  return {
    candles: result.candles,
    warnings,
  };
}

function dedupeWarnings(warnings: MarketContextWarning[]): MarketContextWarning[] {
  const seen = new Set<string>();
  const deduped: MarketContextWarning[] = [];

  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(warning);
  }

  return deduped;
}

function derivePremarketCandles(candles: Candle[]): Candle[] {
  return classifyCandleSessions(candles, "5m")
    .filter((item) => item.session === "premarket")
    .map((item) => item.candle);
}

function deriveRegularSessionCandles(candles: Candle[]): Candle[] {
  return classifyCandleSessions(candles, "5m")
    .filter((item) => item.session === "opening_range" || item.session === "regular")
    .map((item) => item.candle);
}

function hasHigherLows(candles: Candle[], count = 3): boolean {
  const sample = candles.slice(-count);
  if (sample.length < count) {
    return false;
  }

  return sample.every((candle, index) => index === 0 || candle.low >= sample[index - 1]!.low * 0.995);
}

function hasLowerHighs(candles: Candle[], count = 3): boolean {
  const sample = candles.slice(-count);
  if (sample.length < count) {
    return false;
  }

  return sample.every((candle, index) => index === 0 || candle.high <= sample[index - 1]!.high * 1.005);
}

function greenStreak(candles: Candle[], count = 3): boolean {
  const sample = candles.slice(-count);
  return sample.length === count && sample.every((candle) => candle.close > candle.open);
}

function directionChanges(candles: Candle[]): number {
  const directions = candles
    .map((candle) => Math.sign(candle.close - candle.open))
    .filter((direction) => direction !== 0);
  let changes = 0;

  for (let index = 1; index < directions.length; index += 1) {
    if (directions[index] !== directions[index - 1]) {
      changes += 1;
    }
  }

  return changes;
}

function overlapRatio(candles: Candle[]): number {
  if (candles.length < 2) {
    return 0;
  }

  let overlaps = 0;
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1]!;
    const current = candles[index]!;
    const overlapLow = Math.max(previous.low, current.low);
    const overlapHigh = Math.min(previous.high, current.high);
    if (overlapHigh >= overlapLow) {
      overlaps += 1;
    }
  }

  return overlaps / (candles.length - 1);
}

function averageVolume(candles: Candle[]): number | undefined {
  if (candles.length === 0) {
    return undefined;
  }

  return candles.reduce((sum, candle) => sum + candle.volume, 0) / candles.length;
}

function estimatedDollarVolume(candles: Candle[]): number | undefined {
  if (candles.length === 0) {
    return undefined;
  }

  return candles.reduce((sum, candle) => sum + candle.close * candle.volume, 0);
}

function addEvidence(
  evidence: MarketContextEvidence[],
  scores: Record<MarketContextPrimary, number>,
  context: MarketContextPrimary,
  code: string,
  message: string,
  weight: number,
): void {
  scores[context] += weight;
  evidence.push({
    code,
    context,
    message,
    weight,
  });
}

function buildScoringAdjustments(primaryContext: MarketContextPrimary): MarketContextScoringAdjustments {
  switch (primaryContext) {
    case "premarket_runner":
      return {
        intradayWeightMultiplier: 1.15,
        dailyWeightMultiplier: 0.9,
        sessionLevelWeightMultiplier: 1.2,
        volumeWeightMultiplier: 1.25,
        extensionRiskPenaltyMultiplier: 1.1,
      };
    case "day_trade_runner":
      return {
        intradayWeightMultiplier: 1.2,
        dailyWeightMultiplier: 0.9,
        sessionLevelWeightMultiplier: 1.15,
        volumeWeightMultiplier: 1.3,
        extensionRiskPenaltyMultiplier: 1.15,
      };
    case "press_release_runner":
      return {
        intradayWeightMultiplier: 1.2,
        dailyWeightMultiplier: 0.85,
        sessionLevelWeightMultiplier: 1.25,
        volumeWeightMultiplier: 1.35,
        extensionRiskPenaltyMultiplier: 1.4,
      };
    case "swing_structure":
      return {
        intradayWeightMultiplier: 0.85,
        dailyWeightMultiplier: 1.25,
        sessionLevelWeightMultiplier: 0.85,
        volumeWeightMultiplier: 1,
        extensionRiskPenaltyMultiplier: 1,
      };
    case "failed_runner":
      return {
        intradayWeightMultiplier: 1.1,
        dailyWeightMultiplier: 0.95,
        sessionLevelWeightMultiplier: 1.15,
        volumeWeightMultiplier: 1.25,
        extensionRiskPenaltyMultiplier: 1.35,
      };
    case "choppy_low_quality":
      return {
        intradayWeightMultiplier: 0.85,
        dailyWeightMultiplier: 1.05,
        sessionLevelWeightMultiplier: 0.9,
        volumeWeightMultiplier: 0.85,
        extensionRiskPenaltyMultiplier: 1.25,
      };
    case "parabolic_extension":
      return {
        intradayWeightMultiplier: 1.1,
        dailyWeightMultiplier: 0.85,
        sessionLevelWeightMultiplier: 1.1,
        volumeWeightMultiplier: 1.2,
        extensionRiskPenaltyMultiplier: 1.6,
      };
    case "normal_intraday":
      return {
        intradayWeightMultiplier: 1,
        dailyWeightMultiplier: 1,
        sessionLevelWeightMultiplier: 1,
        volumeWeightMultiplier: 1,
        extensionRiskPenaltyMultiplier: 1,
      };
  }
}

function choosePrimaryContext(scores: Record<MarketContextPrimary, number>): MarketContextPrimary {
  const ranked = [...CONTEXTS].sort((left, right) => {
    const scoreDelta = scores[right] - scores[left];
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return RANKING_PRIORITY.indexOf(left) - RANKING_PRIORITY.indexOf(right);
  });

  const best = ranked[0]!;
  return scores[best] >= 2 ? best : "normal_intraday";
}

function determineRunnerPhase(
  primaryContext: MarketContextPrimary,
  facts: MarketContextFacts,
  regularCandles: Candle[],
): RunnerPhase {
  switch (primaryContext) {
    case "premarket_runner":
      return "premarket_discovery";
    case "parabolic_extension":
      return "parabolic_extension";
    case "failed_runner":
      return "failed_breakout";
    case "press_release_runner":
      return regularCandles.length <= 6 ? "opening_drive" : "second_leg_attempt";
    case "day_trade_runner":
      if (facts.nearHighOfDay || facts.aboveOpeningRangeHigh) {
        return "high_of_day_breakout";
      }
      if (regularCandles.length <= 6) {
        return "opening_drive";
      }
      if (hasHigherLows(regularCandles)) {
        return "second_leg_attempt";
      }
      return "first_pullback";
    case "normal_intraday":
    case "swing_structure":
    case "choppy_low_quality":
      return "not_applicable";
  }
}

export function classifyMarketContext(input: ClassifyMarketContextInput): MarketContextProfile {
  const warnings: MarketContextWarning[] = [];
  const sourceCandles = input.candles5m ?? mergeUniqueCandles([input.premarketCandles ?? [], input.regularSessionCandles ?? []]);
  const filteredAll = filterFiveMinuteCandles(sourceCandles, input.asOfTimestamp);
  warnings.push(...filteredAll.warnings);

  const filteredPremarket = input.premarketCandles
    ? filterFiveMinuteCandles(input.premarketCandles, input.asOfTimestamp)
    : {
        candles: derivePremarketCandles(filteredAll.candles),
        warnings: [],
      };
  const filteredRegular = input.regularSessionCandles
    ? filterFiveMinuteCandles(input.regularSessionCandles, input.asOfTimestamp)
    : {
        candles: deriveRegularSessionCandles(filteredAll.candles),
        warnings: [],
      };
  warnings.push(...filteredPremarket.warnings, ...filteredRegular.warnings);

  if (isUsableNumber(input.vwap)) {
    warnings.push({
      code: "vwap_facts_only",
      severity: "info",
      message: "VWAP was recorded as a market fact only and did not affect context scoring.",
    });
  }

  if (filteredAll.candles.length === 0) {
    warnings.push({
      code: "insufficient_candles",
      severity: "warning",
      message: "No closed 5m candles were available as of the requested timestamp.",
    });
  }

  const allCandles = filteredAll.candles;
  const premarketCandles = filteredPremarket.candles;
  const regularCandles = filteredRegular.candles;
  const regularOpen = regularCandles[0]?.open ?? allCandles[0]?.open;
  const premarketHigh = maxValue(premarketCandles.map((candle) => candle.high));
  const openingRangeHigh = maxValue(regularCandles.slice(0, 6).map((candle) => candle.high));
  const highOfDay = maxValue(allCandles.map((candle) => candle.high));
  const lowOfDay = minValue(allCandles.map((candle) => candle.low));
  const facts: MarketContextFacts = {
    percentFromPreviousClose: percentChange(input.referencePrice, input.previousClose),
    percentFromOpen: percentChange(input.referencePrice, regularOpen),
    percentFromVWAP: percentChange(input.referencePrice, input.vwap),
    relativeVolume: input.relativeVolume,
    dollarVolume: input.dollarVolume ?? estimatedDollarVolume(allCandles),
    aboveVWAP: isUsableNumber(input.vwap) ? input.referencePrice > input.vwap : undefined,
    abovePremarketHigh: isUsableNumber(premarketHigh) ? input.referencePrice >= premarketHigh : undefined,
    aboveOpeningRangeHigh: isUsableNumber(openingRangeHigh) ? input.referencePrice >= openingRangeHigh : undefined,
    nearHighOfDay: isUsableNumber(highOfDay) ? input.referencePrice >= highOfDay * 0.98 : undefined,
    premarketHigh,
    openingRangeHigh,
    highOfDay,
    filteredCandleCount: allCandles.length,
    filteredPremarketCandleCount: premarketCandles.length,
    filteredRegularSessionCandleCount: regularCandles.length,
  };

  const scores = Object.fromEntries(CONTEXTS.map((context) => [context, 0])) as Record<MarketContextPrimary, number>;
  const evidence: MarketContextEvidence[] = [];
  const pctPreviousClose = facts.percentFromPreviousClose;
  const pctOpen = facts.percentFromOpen;
  const relativeVolume = input.relativeVolume;
  const dollarVolume = facts.dollarVolume;
  const allRangePct =
    isUsableNumber(lowOfDay) && lowOfDay > 0 && isUsableNumber(highOfDay) ? round(((highOfDay - lowOfDay) / lowOfDay) * 100) : undefined;
  const latestAverageVolume = averageVolume(regularCandles.slice(-3));
  const priorAverageVolume = averageVolume(regularCandles.slice(0, Math.max(0, regularCandles.length - 3)));
  const hasVolumeAcceleration =
    isUsableNumber(latestAverageVolume) &&
    isUsableNumber(priorAverageVolume) &&
    priorAverageVolume > 0 &&
    latestAverageVolume >= priorAverageVolume * 1.35;
  const hasExplicitCatalyst = [input.pressReleaseTimestamp, input.newsTimestamp].some(
    (timestamp) => isUsableNumber(timestamp) && Math.abs(input.asOfTimestamp - timestamp) <= 24 * 60 * 60 * 1000,
  );

  if (isUsableNumber(pctPreviousClose) && Math.abs(pctPreviousClose) <= 4) {
    addEvidence(evidence, scores, "normal_intraday", "modest_previous_close_move", "Move from previous close is modest.", 1.1);
  }
  if (isUsableNumber(pctOpen) && Math.abs(pctOpen) <= 3) {
    addEvidence(evidence, scores, "normal_intraday", "modest_open_move", "Move from the regular-session open is modest.", 1);
  }
  if (!isUsableNumber(relativeVolume) || (relativeVolume >= 0.6 && relativeVolume <= 1.5)) {
    addEvidence(evidence, scores, "normal_intraday", "ordinary_relative_volume", "Relative volume is not elevated.", 0.9);
  }
  if (allCandles.length >= 4) {
    addEvidence(evidence, scores, "normal_intraday", "sufficient_orderly_candles", "Closed 5m candles are available for context review.", 0.4);
  }

  if (premarketCandles.length >= 3 && regularCandles.length === 0) {
    if (isUsableNumber(pctPreviousClose) && pctPreviousClose >= 10) {
      addEvidence(evidence, scores, "premarket_runner", "large_gap_previous_close", "Premarket price is materially above previous close.", 1.7);
    }
    if (isUsableNumber(relativeVolume) && relativeVolume >= 2) {
      addEvidence(evidence, scores, "premarket_runner", "high_premarket_relative_volume", "Premarket relative volume is elevated.", 1.3);
    }
    if (isUsableNumber(dollarVolume) && dollarVolume >= 500_000) {
      addEvidence(evidence, scores, "premarket_runner", "meaningful_premarket_dollar_volume", "Premarket dollar volume is meaningful.", 0.8);
    }
    if (hasHigherLows(premarketCandles)) {
      addEvidence(evidence, scores, "premarket_runner", "premarket_higher_lows", "Premarket candles show higher lows.", 1.1);
    }
    if (facts.abovePremarketHigh || (isUsableNumber(premarketHigh) && input.referencePrice >= premarketHigh * 0.98)) {
      addEvidence(evidence, scores, "premarket_runner", "premarket_high_pressure", "Price is near or above premarket high.", 0.9);
    }
  }

  if (regularCandles.length >= 3) {
    if (isUsableNumber(pctOpen) && pctOpen >= 6) {
      addEvidence(evidence, scores, "day_trade_runner", "strong_move_from_open", "Regular-session move from open is strong.", 1.6);
    }
    if (isUsableNumber(pctPreviousClose) && pctPreviousClose >= 10) {
      addEvidence(evidence, scores, "day_trade_runner", "strong_move_from_previous_close", "Move from previous close is strong.", 1.1);
    }
    if (isUsableNumber(relativeVolume) && relativeVolume >= 2) {
      addEvidence(evidence, scores, "day_trade_runner", "high_regular_relative_volume", "Regular-session relative volume is elevated.", 1.2);
    }
    if (hasHigherLows(regularCandles)) {
      addEvidence(evidence, scores, "day_trade_runner", "regular_higher_lows", "Regular-session candles show higher lows.", 0.9);
    }
    if (facts.nearHighOfDay) {
      addEvidence(evidence, scores, "day_trade_runner", "near_high_of_day", "Price is near high of day.", 0.9);
    }
    if (facts.aboveOpeningRangeHigh) {
      addEvidence(evidence, scores, "day_trade_runner", "above_opening_range_high", "Price is above the opening range high.", 0.8);
    }
  }

  if (hasExplicitCatalyst) {
    addEvidence(evidence, scores, "press_release_runner", "explicit_news_or_pr_timestamp", "Explicit news or PR timestamp is present.", 3.2);
    if (isUsableNumber(pctPreviousClose) && pctPreviousClose >= 10) {
      addEvidence(evidence, scores, "press_release_runner", "catalyst_gap_previous_close", "Catalyst context has a material move from previous close.", 1.4);
    }
    if (isUsableNumber(relativeVolume) && relativeVolume >= 2) {
      addEvidence(evidence, scores, "press_release_runner", "catalyst_volume_expansion", "Catalyst context has elevated relative volume.", 1.2);
    }
  }

  const highPullbackPct = isUsableNumber(highOfDay) && highOfDay > 0 ? round(((input.referencePrice - highOfDay) / highOfDay) * 100) : undefined;
  if (regularCandles.length >= 4) {
    if ((input.failedHighOfDayAttempts ?? 0) > 0) {
      addEvidence(evidence, scores, "failed_runner", "failed_high_of_day_attempt", "A failed high-of-day attempt was provided.", 1.6);
    }
    if (isUsableNumber(highPullbackPct) && highPullbackPct <= -6 && isUsableNumber(pctPreviousClose) && pctPreviousClose >= 8) {
      addEvidence(evidence, scores, "failed_runner", "material_pullback_from_high", "Price has pulled back materially from high of day after a runner move.", 1.2);
    }
    if (hasLowerHighs(regularCandles)) {
      addEvidence(evidence, scores, "failed_runner", "regular_lower_highs", "Recent regular-session candles show lower highs.", 1);
    }
    if (hasVolumeAcceleration && regularCandles.at(-1)!.close < regularCandles.at(-1)!.open) {
      addEvidence(evidence, scores, "failed_runner", "high_volume_selling", "Recent selling volume is accelerating.", 0.9);
    }
  }

  if (regularCandles.length >= 3) {
    if (isUsableNumber(pctOpen) && pctOpen >= 25) {
      addEvidence(evidence, scores, "parabolic_extension", "extreme_move_from_open", "Move from open is extreme.", 1.8);
    }
    if (isUsableNumber(pctPreviousClose) && pctPreviousClose >= 45) {
      addEvidence(evidence, scores, "parabolic_extension", "extreme_move_from_previous_close", "Move from previous close is extreme.", 1.7);
    }
    if (greenStreak(regularCandles)) {
      addEvidence(evidence, scores, "parabolic_extension", "multiple_directional_green_candles", "Recent candles show a directional green streak.", 1);
    }
    if (hasVolumeAcceleration) {
      addEvidence(evidence, scores, "parabolic_extension", "volume_acceleration", "Recent volume is accelerating into the move.", 0.8);
    }
    if (isUsableNumber(allRangePct) && allRangePct >= 35) {
      addEvidence(evidence, scores, "parabolic_extension", "wide_intraday_range", "Intraday range is unusually wide.", 0.8);
    }
  }

  if (regularCandles.length >= 6) {
    const changes = directionChanges(regularCandles);
    const overlap = overlapRatio(regularCandles);
    if (changes >= 4) {
      addEvidence(evidence, scores, "choppy_low_quality", "frequent_direction_changes", "Recent candles alternate direction frequently.", 1.4);
    }
    if (overlap >= 0.65) {
      addEvidence(evidence, scores, "choppy_low_quality", "overlapping_candle_ranges", "Recent candle ranges overlap heavily.", 1.2);
    }
    if (isUsableNumber(pctOpen) && Math.abs(pctOpen) <= 3) {
      addEvidence(evidence, scores, "choppy_low_quality", "little_progress_from_open", "Price has made little net progress from the open.", 0.8);
    }
    if (isUsableNumber(relativeVolume) && relativeVolume <= 1.2) {
      addEvidence(evidence, scores, "choppy_low_quality", "weak_relative_volume", "Relative volume is weak or ordinary during choppy movement.", 0.7);
    }
  }

  const higherTimeframe = input.higherTimeframeStructure;
  if (higherTimeframe?.dailyLevelNearPrice || higherTimeframe?.fourHourLevelNearPrice) {
    addEvidence(evidence, scores, "swing_structure", "higher_timeframe_level_near_price", "Higher-timeframe structure is near current price.", 1.7);
  }
  if (higherTimeframe?.multiDayTrend) {
    addEvidence(evidence, scores, "swing_structure", "multi_day_structure_available", "Multi-day structure is available for context.", 1);
  }
  if (higherTimeframe && (!isUsableNumber(relativeVolume) || relativeVolume <= 1.5)) {
    addEvidence(evidence, scores, "swing_structure", "not_volume_driven_intraday_runner", "Relative volume does not require runner-first context.", 0.7);
  }
  if (higherTimeframe && isUsableNumber(pctPreviousClose) && Math.abs(pctPreviousClose) <= 8) {
    addEvidence(evidence, scores, "swing_structure", "modest_gap_for_swing_context", "Move from previous close leaves higher-timeframe context relevant.", 0.5);
  }

  const primaryContext = choosePrimaryContext(scores);
  const topScore = scores[primaryContext];
  const secondScore = Math.max(...CONTEXTS.filter((context) => context !== primaryContext).map((context) => scores[context]));
  const confidence = round(clamp(0.42 + topScore * 0.08 + Math.max(0, topScore - secondScore) * 0.04, 0.35, 0.94), 3);

  if (primaryContext === "choppy_low_quality") {
    warnings.push({
      code: "low_quality_context",
      severity: "warning",
      message: "Market context is choppy and evidence confidence should be treated conservatively.",
    });
  }
  if (primaryContext === "parabolic_extension") {
    warnings.push({
      code: "extension_risk_context",
      severity: "warning",
      message: "Market context is extended; this warning does not recommend a trade direction.",
    });
  }

  return {
    primaryContext,
    confidence,
    runnerPhase: determineRunnerPhase(primaryContext, facts, regularCandles),
    evidence,
    warnings: dedupeWarnings(warnings),
    facts,
    scoringAdjustments: buildScoringAdjustments(primaryContext),
  };
}
