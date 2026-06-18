import type { Candle } from "../market-data/candle-types.js";
import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";
import type { DynamicLevelsFromCandles } from "../support-resistance/indicators/index.js";
import type { StockContextPreview } from "../stock-context/stock-context-types.js";

export type ContextReliability = "reliable" | "watch" | "unreliable";

export type LiquidityTradabilityLabel = "clean" | "acceptable" | "thin" | "messy" | "unknown";
export type LiquidityTradabilityContext = {
  label: LiquidityTradabilityLabel;
  reliability: ContextReliability;
  spreadPct: number | null;
  averageFiveMinuteDollarVolume: number | null;
  recentDollarVolume: number | null;
  reasons: string[];
  traderLine?: string;
};

export type CatalystProfileRiskLabel = "low" | "watch" | "elevated" | "unknown";
export type CatalystProfileRiskContext = {
  label: CatalystProfileRiskLabel;
  reliability: ContextReliability;
  marketCapBucket: "nano" | "micro" | "small" | "mid_or_larger" | "unknown";
  floatBucket: "micro_float" | "low_float" | "normal_float" | "unknown";
  shortInterestLabel: "elevated" | "normal" | "unknown";
  catalystLabel: "known_catalyst" | "no_known_catalyst" | "unknown";
  reasons: string[];
  traderLine?: string;
};

export type SessionGapLabel =
  | "gap_up"
  | "gap_down"
  | "inside_previous_range"
  | "above_previous_high"
  | "below_previous_low"
  | "unknown";
export type SessionGapContext = {
  label: SessionGapLabel;
  reliability: ContextReliability;
  previousDayHigh: number | null;
  previousDayLow: number | null;
  previousDayClose: number | null;
  premarketHigh: number | null;
  premarketLow: number | null;
  openingRangeHigh: number | null;
  openingRangeLow: number | null;
  gapPct: number | null;
  currentPosition: "above_premarket_high" | "below_premarket_low" | "inside_premarket_range" | "unknown";
  reasons: string[];
  traderLine?: string;
};

export type CandleReactionLabel =
  | "strong_close_through"
  | "wick_rejection"
  | "support_defense"
  | "support_loss"
  | "failed_breakout"
  | "reclaim"
  | "indecision"
  | "unknown";
export type CandleReactionContext = {
  label: CandleReactionLabel;
  reliability: ContextReliability;
  bodyPct: number | null;
  rangePct: number | null;
  upperWickPct: number | null;
  lowerWickPct: number | null;
  closeLocation: number | null;
  levelDistancePct: number | null;
  materialityLabel: "material" | "minor" | "unknown";
  levelPrice: number | null;
  levelSide: "support" | "resistance" | null;
  reasons: string[];
  traderLine?: string;
};

export type MoveExtensionLabel = "normal" | "extended" | "stretched" | "pulling_back" | "unknown";
export type MoveExtensionContext = {
  label: MoveExtensionLabel;
  reliability: ContextReliability;
  percentFromSessionLow: number | null;
  percentFromSessionHigh: number | null;
  percentFromVwap: number | null;
  percentFromEma9: number | null;
  percentFromEma20: number | null;
  greenCandleStreak: number;
  reasons: string[];
  traderLine?: string;
};

export type SmallCapVolatilityLabel = "quiet" | "normal" | "volatile" | "wild" | "unknown";
export type SmallCapVolatilityContext = {
  label: SmallCapVolatilityLabel;
  reliability: ContextReliability;
  priceBucket: "sub_1" | "one_to_two" | "two_to_five" | "five_to_ten" | "ten_plus" | "unknown";
  medianFiveMinuteRangePct: number | null;
  averageFiveMinuteRangePct: number | null;
  oneCentMovePct: number | null;
  meaningfulMovePct: number | null;
  reasons: string[];
  traderLine?: string;
};

export type OpeningRangeLabel =
  | "above_opening_range"
  | "below_opening_range"
  | "inside_opening_range"
  | "testing_opening_high"
  | "testing_opening_low"
  | "unavailable";
export type OpeningRangeContext = {
  label: OpeningRangeLabel;
  reliability: ContextReliability;
  high: number | null;
  low: number | null;
  rangePct: number | null;
  minutesCovered: number;
  reasons: string[];
  traderLine?: string;
};

export type HaltAwarenessLabel = "normal" | "possible_halt" | "paused_after_fast_move" | "unknown";
export type HaltAwarenessContext = {
  label: HaltAwarenessLabel;
  reliability: ContextReliability;
  gapSinceLastCandleMs: number | null;
  moveBeforePausePct: number | null;
  reasons: string[];
  traderLine?: string;
};

export type LevelQualityCalibrationLabel =
  | "healthy"
  | "thin_ladder"
  | "wide_first_gap"
  | "crowded_nearby_levels"
  | "no_forward_levels"
  | "unknown";
export type LevelQualityCalibrationContext = {
  label: LevelQualityCalibrationLabel;
  reliability: ContextReliability;
  nearestSupportDistancePct: number | null;
  nearestResistanceDistancePct: number | null;
  forwardSupportGapPct: number | null;
  forwardResistanceGapPct: number | null;
  tightSupportClusterCount: number;
  tightResistanceClusterCount: number;
  supportCount: number;
  resistanceCount: number;
  reasons: string[];
  traderLine?: string;
};

export type DataQualityGateLabel = "trusted" | "watch" | "degraded" | "unusable";
export type DataQualityGateContext = {
  label: DataQualityGateLabel;
  score: number;
  reasons: string[];
  traderLine?: string;
};

export type TradeIdeaSummaryLabel =
  | "range_trade"
  | "breakout_watch"
  | "support_reaction"
  | "support_reclaim"
  | "extended_runner"
  | "noisy_chop"
  | "needs_data";
export type TradeIdeaSummaryContext = {
  label: TradeIdeaSummaryLabel;
  confidence: "low" | "medium" | "high";
  leadLine: string;
  reasons: string[];
};

export type NoPostDecision = "post_needed" | "no_post_needed" | "operator_review";
export type NoPostExplainerContext = {
  decision: NoPostDecision;
  reasons: string[];
};

export type FirstPostTradePlanContext = {
  title: string;
  lines: string[];
};

export type TraderStoryMemoryDecision = "new_story" | "material_update" | "repeat" | "cooldown";
export type TraderStoryMemoryContext = {
  decision: TraderStoryMemoryDecision;
  storyKey: string;
  previousStoryKey: string | null;
  cooldownMs: number;
  elapsedMs: number | null;
  reasons: string[];
};

export type TraderIntelligenceContext = {
  liquidity: LiquidityTradabilityContext;
  catalystProfile: CatalystProfileRiskContext;
  sessionGap: SessionGapContext;
  candleReaction: CandleReactionContext;
  moveExtension: MoveExtensionContext;
  volatility: SmallCapVolatilityContext;
  openingRange: OpeningRangeContext;
  haltAwareness: HaltAwarenessContext;
  levelQuality: LevelQualityCalibrationContext;
  dataQuality: DataQualityGateContext;
  tradeIdea: TradeIdeaSummaryContext;
  noPost: NoPostExplainerContext;
  firstPostPlan: FirstPostTradePlanContext;
  storyMemory: TraderStoryMemoryContext;
};

export type ReferenceLevelForReaction = {
  price: number;
  side: "support" | "resistance";
};

export type PreviousTraderStory = {
  storyKey: string;
  timestamp: number;
};

export type BuildTraderIntelligenceContextRequest = {
  symbol: string;
  dailyCandles?: Candle[];
  intradayCandles?: Candle[];
  currentPrice?: number;
  bid?: number;
  ask?: number;
  dynamicLevels?: DynamicLevelsFromCandles;
  stockContext?: StockContextPreview | null;
  knownCatalyst?: boolean;
  catalystDescription?: string;
  referenceLevel?: ReferenceLevelForReaction;
  levels?: LevelEngineOutput;
  previousStory?: PreviousTraderStory | null;
  timestamp?: number;
};

const FIVE_MINUTES_MS = 5 * 60_000;

function sortedCandles(candles: Candle[] | undefined): Candle[] {
  return [...(candles ?? [])].sort((left, right) => left.timestamp - right.timestamp);
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pctChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (!finite(from) || !finite(to) || from === 0) {
    return null;
  }
  return ((to - from) / from) * 100;
}

function round(value: number | null, decimals = 2): number | null {
  return value === null ? null : Number(value.toFixed(decimals));
}

function latestClose(candles: Candle[]): number | null {
  return candles.at(-1)?.close ?? null;
}

function candleDollarVolume(candle: Candle): number {
  return Math.max(0, candle.volume) * candle.close;
}

export function buildLiquidityTradabilityContext(params: {
  candles?: Candle[];
  currentPrice?: number;
  bid?: number;
  ask?: number;
}): LiquidityTradabilityContext {
  const candles = sortedCandles(params.candles);
  const price = params.currentPrice ?? latestClose(candles);
  const spreadPct =
    finite(params.bid) && finite(params.ask) && params.bid > 0 && params.ask >= params.bid
      ? pctChange(params.bid, params.ask)
      : null;
  const recent = candles.slice(-12);
  const recentDollarVolume = recent.length > 0 ? recent.reduce((sum, candle) => sum + candleDollarVolume(candle), 0) : null;
  const baseline = candles.slice(-36, -6);
  const averageFiveMinuteDollarVolume =
    baseline.length > 0 ? baseline.reduce((sum, candle) => sum + candleDollarVolume(candle), 0) / baseline.length : null;
  const reasons: string[] = [];

  if (!finite(price) && spreadPct === null && averageFiveMinuteDollarVolume === null) {
    return {
      label: "unknown",
      reliability: "unreliable",
      spreadPct: null,
      averageFiveMinuteDollarVolume: null,
      recentDollarVolume: null,
      reasons: ["missing price, spread, and candle dollar-volume context"],
    };
  }

  if (spreadPct !== null) {
    reasons.push(`spread ${round(spreadPct)}%`);
  }
  if (averageFiveMinuteDollarVolume !== null) {
    reasons.push(`avg 5m dollar volume ${Math.round(averageFiveMinuteDollarVolume)}`);
  }

  const thinDollarVolume = averageFiveMinuteDollarVolume !== null && averageFiveMinuteDollarVolume < 25_000;
  const watchDollarVolume = averageFiveMinuteDollarVolume !== null && averageFiveMinuteDollarVolume < 100_000;
  const messySpread = spreadPct !== null && spreadPct > 1.5;
  const watchSpread = spreadPct !== null && spreadPct > 0.75;

  if (messySpread || thinDollarVolume) {
    return {
      label: messySpread ? "messy" : "thin",
      reliability: "watch",
      spreadPct: round(spreadPct),
      averageFiveMinuteDollarVolume: round(averageFiveMinuteDollarVolume, 0),
      recentDollarVolume: round(recentDollarVolume, 0),
      reasons,
      traderLine: messySpread
        ? "liquidity is messy, so level reactions need cleaner prints"
        : "activity is thin, so level reactions need more proof",
    };
  }

  if (watchSpread || watchDollarVolume) {
    return {
      label: "acceptable",
      reliability: "watch",
      spreadPct: round(spreadPct),
      averageFiveMinuteDollarVolume: round(averageFiveMinuteDollarVolume, 0),
      recentDollarVolume: round(recentDollarVolume, 0),
      reasons,
      traderLine: "liquidity is acceptable, but reactions still need clean follow-through",
    };
  }

  return {
    label: "clean",
    reliability: "reliable",
    spreadPct: round(spreadPct),
    averageFiveMinuteDollarVolume: round(averageFiveMinuteDollarVolume, 0),
    recentDollarVolume: round(recentDollarVolume, 0),
    reasons,
    traderLine: "liquidity looks clean enough for level reads",
  };
}

function marketCapBucket(marketCapDollars: number | undefined): CatalystProfileRiskContext["marketCapBucket"] {
  if (!finite(marketCapDollars) || marketCapDollars <= 0) {
    return "unknown";
  }
  if (marketCapDollars < 50_000_000) {
    return "nano";
  }
  if (marketCapDollars < 300_000_000) {
    return "micro";
  }
  if (marketCapDollars < 2_000_000_000) {
    return "small";
  }
  return "mid_or_larger";
}

function floatBucket(floatShares: number | undefined): CatalystProfileRiskContext["floatBucket"] {
  if (!finite(floatShares) || floatShares <= 0) {
    return "unknown";
  }
  if (floatShares < 10_000_000) {
    return "micro_float";
  }
  if (floatShares < 50_000_000) {
    return "low_float";
  }
  return "normal_float";
}

export function buildCatalystProfileRiskContext(params: {
  marketCapDollars?: number;
  floatShares?: number;
  sharesOutstanding?: number;
  shortPercentOfFloat?: number;
  knownCatalyst?: boolean;
  catalystDescription?: string;
}): CatalystProfileRiskContext {
  const marketBucket = marketCapBucket(params.marketCapDollars);
  const floatRisk = floatBucket(params.floatShares ?? params.sharesOutstanding);
  const shortInterestLabel =
    finite(params.shortPercentOfFloat) ? (params.shortPercentOfFloat >= 0.15 ? "elevated" : "normal") : "unknown";
  const catalystLabel =
    params.knownCatalyst === true
      ? "known_catalyst"
      : params.knownCatalyst === false
        ? "no_known_catalyst"
        : "unknown";
  const reasons = [
    `market cap ${marketBucket}`,
    `float ${floatRisk}`,
    `short interest ${shortInterestLabel}`,
    `catalyst ${catalystLabel}`,
  ];
  if (params.catalystDescription?.trim()) {
    reasons.push(params.catalystDescription.trim());
  }

  if (marketBucket === "unknown" && floatRisk === "unknown" && shortInterestLabel === "unknown" && catalystLabel === "unknown") {
    return {
      label: "unknown",
      reliability: "unreliable",
      marketCapBucket: marketBucket,
      floatBucket: floatRisk,
      shortInterestLabel,
      catalystLabel,
      reasons: ["missing profile and catalyst context"],
    };
  }

  const elevated =
    marketBucket === "nano" ||
    floatRisk === "micro_float" ||
    shortInterestLabel === "elevated" ||
    catalystLabel === "no_known_catalyst";
  const label: CatalystProfileRiskLabel = elevated ? "elevated" : marketBucket === "micro" || floatRisk === "low_float" ? "watch" : "low";

  return {
    label,
    reliability: marketBucket === "unknown" && floatRisk === "unknown" ? "watch" : "reliable",
    marketCapBucket: marketBucket,
    floatBucket: floatRisk,
    shortInterestLabel,
    catalystLabel,
    reasons,
    traderLine:
      label === "elevated"
        ? "profile risk is elevated, so clean level confirmation matters more"
        : label === "watch"
          ? "profile risk needs watching, especially around failed level reactions"
          : "profile context does not add obvious extra risk",
  };
}

export function buildCatalystProfileRiskFromStockContext(
  stockContext: StockContextPreview | null | undefined,
  knownCatalyst?: boolean,
): CatalystProfileRiskContext {
  const yahoo = stockContext?.yahoo;
  const finnhubMarketCapDollars =
    finite(stockContext?.profile.marketCapitalization) ? stockContext!.profile.marketCapitalization! * 1_000_000 : undefined;
  const finnhubSharesOutstanding =
    finite(stockContext?.profile.shareOutstanding) ? stockContext!.profile.shareOutstanding! * 1_000_000 : undefined;
  return buildCatalystProfileRiskContext({
    marketCapDollars: yahoo?.summary?.marketCap ?? yahoo?.quote?.marketCap ?? finnhubMarketCapDollars,
    floatShares: yahoo?.summary?.floatShares,
    sharesOutstanding: yahoo?.summary?.sharesOutstanding ?? finnhubSharesOutstanding,
    shortPercentOfFloat: yahoo?.summary?.shortPercentOfFloat,
    knownCatalyst,
  });
}

function etParts(timestamp: number): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.get("year")}-${map.get("month")}-${map.get("day")}`,
    minutes: Number(map.get("hour")) * 60 + Number(map.get("minute")),
  };
}

function previousDailyCandle(dailyCandles: Candle[], sessionDate?: string): Candle | undefined {
  const sorted = sortedCandles(dailyCandles);
  if (sorted.length === 0) {
    return undefined;
  }
  if (!sessionDate) {
    return sorted.length >= 2 ? sorted.at(-2) : sorted.at(-1);
  }
  const beforeSession = sorted.filter((candle) => etParts(candle.timestamp).date < sessionDate);
  return beforeSession.at(-1) ?? sorted.at(-2) ?? sorted.at(-1);
}

export function buildSessionGapContext(params: {
  dailyCandles?: Candle[];
  intradayCandles?: Candle[];
  currentPrice?: number;
  sessionDate?: string;
}): SessionGapContext {
  const daily = sortedCandles(params.dailyCandles);
  const intraday = sortedCandles(params.intradayCandles);
  const previous = previousDailyCandle(daily, params.sessionDate);
  const currentPrice = params.currentPrice ?? latestClose(intraday);
  const sessionDate = params.sessionDate ?? (intraday.at(-1) ? etParts(intraday.at(-1)!.timestamp).date : undefined);
  const sessionCandles = sessionDate ? intraday.filter((candle) => etParts(candle.timestamp).date === sessionDate) : intraday;
  const premarket = sessionCandles.filter((candle) => {
    const minutes = etParts(candle.timestamp).minutes;
    return minutes >= 4 * 60 && minutes < 9 * 60 + 30;
  });
  const openingRange = sessionCandles.filter((candle) => {
    const minutes = etParts(candle.timestamp).minutes;
    return minutes >= 9 * 60 + 30 && minutes < 10 * 60;
  });
  const firstRegular = sessionCandles.find((candle) => etParts(candle.timestamp).minutes >= 9 * 60 + 30);
  const premarketHigh = premarket.length > 0 ? Math.max(...premarket.map((candle) => candle.high)) : null;
  const premarketLow = premarket.length > 0 ? Math.min(...premarket.map((candle) => candle.low)) : null;
  const openingRangeHigh = openingRange.length > 0 ? Math.max(...openingRange.map((candle) => candle.high)) : null;
  const openingRangeLow = openingRange.length > 0 ? Math.min(...openingRange.map((candle) => candle.low)) : null;
  const gapPct = previous ? pctChange(previous.close, firstRegular?.open ?? sessionCandles[0]?.open) : null;
  const reasons: string[] = [];

  if (!previous) {
    reasons.push("missing previous daily candle");
  }
  if (premarketHigh === null || premarketLow === null) {
    reasons.push("missing premarket range");
  }
  if (openingRangeHigh === null || openingRangeLow === null) {
    reasons.push("missing opening range");
  }

  const currentPosition =
    finite(currentPrice) && premarketHigh !== null && currentPrice > premarketHigh
      ? "above_premarket_high"
      : finite(currentPrice) && premarketLow !== null && currentPrice < premarketLow
        ? "below_premarket_low"
        : finite(currentPrice) && premarketHigh !== null && premarketLow !== null
          ? "inside_premarket_range"
          : "unknown";

  let label: SessionGapLabel = "unknown";
  if (previous && finite(currentPrice)) {
    if (currentPrice > previous.high) {
      label = "above_previous_high";
    } else if (currentPrice < previous.low) {
      label = "below_previous_low";
    } else if (gapPct !== null && gapPct >= 4) {
      label = "gap_up";
    } else if (gapPct !== null && gapPct <= -4) {
      label = "gap_down";
    } else {
      label = "inside_previous_range";
    }
  }

  const reliability: ContextReliability = previous && sessionCandles.length > 0 ? "reliable" : "watch";
  return {
    label,
    reliability,
    previousDayHigh: previous?.high ?? null,
    previousDayLow: previous?.low ?? null,
    previousDayClose: previous?.close ?? null,
    premarketHigh,
    premarketLow,
    openingRangeHigh,
    openingRangeLow,
    gapPct: round(gapPct),
    currentPosition,
    reasons,
    traderLine:
      label === "above_previous_high"
        ? "price is holding above the prior day high area"
        : label === "gap_up"
          ? "price opened with a gap up, so premarket and opening-range levels matter"
          : label === "inside_previous_range"
            ? "price is still working inside the prior day range"
            : undefined,
  };
}

export function buildCandleReactionContext(params: {
  candles?: Candle[];
  referenceLevel?: ReferenceLevelForReaction;
  meaningfulMovePct?: number | null;
}): CandleReactionContext {
  const candles = sortedCandles(params.candles);
  const latest = candles.at(-1);
  const prior = candles.at(-2);
  if (!latest) {
    return {
      label: "unknown",
      reliability: "unreliable",
      bodyPct: null,
      rangePct: null,
      upperWickPct: null,
      lowerWickPct: null,
      closeLocation: null,
      levelDistancePct: null,
      materialityLabel: "unknown",
      levelPrice: params.referenceLevel?.price ?? null,
      levelSide: params.referenceLevel?.side ?? null,
      reasons: ["missing candle data"],
    };
  }

  const range = latest.high - latest.low;
  const body = Math.abs(latest.close - latest.open);
  const upperWick = latest.high - Math.max(latest.open, latest.close);
  const lowerWick = Math.min(latest.open, latest.close) - latest.low;
  const closeLocation = range > 0 ? (latest.close - latest.low) / range : null;
  const bodyPct = pctChange(latest.open, latest.close);
  const rangePct = pctChange(latest.low, latest.high);
  const upperWickPct = range > 0 ? (upperWick / range) * 100 : null;
  const lowerWickPct = range > 0 ? (lowerWick / range) * 100 : null;
  const level = params.referenceLevel;
  const levelDistancePct = level ? pctChange(level.price, latest.close) : null;
  const meaningfulMovePct = finite(params.meaningfulMovePct)
    ? Math.max(0.5, Math.min(params.meaningfulMovePct * 0.6, 2.5))
    : 0.75;
  const materialBody = bodyPct !== null && Math.abs(bodyPct) >= meaningfulMovePct;
  const materialRange = rangePct !== null && Math.abs(rangePct) >= meaningfulMovePct * 1.25;
  const materialLevelClear = levelDistancePct !== null && Math.abs(levelDistancePct) >= meaningfulMovePct;
  const materialReaction = materialBody || materialRange || materialLevelClear;
  const reasons: string[] = [
    `body ${round(bodyPct)}%`,
    `range ${round(rangePct)}%`,
    `upper wick ${round(upperWickPct)}%`,
    `lower wick ${round(lowerWickPct)}%`,
    level ? `level distance ${round(levelDistancePct)}%` : "no reference level",
    `material floor ${round(meaningfulMovePct)}%`,
  ];
  if (!materialReaction) {
    reasons.push("inside small-cap noise floor");
  }

  let label: CandleReactionLabel = "indecision";
  if (level?.side === "resistance") {
    if (latest.close > level.price && (closeLocation ?? 0) >= 0.65 && latest.close > latest.open && materialReaction) {
      label = "strong_close_through";
    } else if (latest.high > level.price && latest.close <= level.price && upperWick > Math.max(body, range * 0.2) && materialReaction) {
      label = prior && prior.close > level.price ? "failed_breakout" : "wick_rejection";
    } else if (prior && prior.close <= level.price && latest.close > level.price && materialReaction) {
      label = "reclaim";
    }
  } else if (level?.side === "support") {
    if (latest.low < level.price && latest.close >= level.price && lowerWick > Math.max(body, range * 0.2) && materialReaction) {
      label = "support_defense";
    } else if (latest.close < level.price && (closeLocation ?? 1) <= 0.35 && materialReaction) {
      label = "support_loss";
    } else if (prior && prior.close < level.price && latest.close >= level.price && materialReaction) {
      label = "reclaim";
    }
  } else if (range > 0 && body / range > 0.65 && materialReaction) {
    label = latest.close > latest.open ? "strong_close_through" : "support_loss";
  }

  return {
    label,
    reliability: candles.length >= 2 ? "reliable" : "watch",
    bodyPct: round(bodyPct),
    rangePct: round(rangePct),
    upperWickPct: round(upperWickPct),
    lowerWickPct: round(lowerWickPct),
    closeLocation: closeLocation === null ? null : round(closeLocation, 3),
    levelDistancePct: round(levelDistancePct),
    materialityLabel: materialReaction ? "material" : "minor",
    levelPrice: level?.price ?? null,
    levelSide: level?.side ?? null,
    reasons,
    traderLine:
      label === "strong_close_through"
        ? "latest candle closed cleanly through the level"
        : label === "wick_rejection"
          ? "latest candle rejected the level instead of accepting above it"
          : label === "support_defense"
            ? "latest candle showed buyers defending support"
            : label === "support_loss"
              ? "latest candle closed below support"
              : undefined,
  };
}

function greenStreak(candles: Candle[]): number {
  let streak = 0;
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index]!;
    if (candle.close <= candle.open) {
      break;
    }
    streak += 1;
  }
  return streak;
}

export function buildMoveExtensionContext(params: {
  candles?: Candle[];
  currentPrice?: number;
  dynamicLevels?: DynamicLevelsFromCandles;
}): MoveExtensionContext {
  const candles = sortedCandles(params.candles);
  const currentPrice = params.currentPrice ?? latestClose(candles);
  if (!finite(currentPrice) || candles.length === 0) {
    return {
      label: "unknown",
      reliability: "unreliable",
      percentFromSessionLow: null,
      percentFromSessionHigh: null,
      percentFromVwap: null,
      percentFromEma9: null,
      percentFromEma20: null,
      greenCandleStreak: 0,
      reasons: ["missing current price or intraday candles"],
    };
  }

  const sessionLow = Math.min(...candles.map((candle) => candle.low));
  const sessionHigh = Math.max(...candles.map((candle) => candle.high));
  const percentFromSessionLow = pctChange(sessionLow, currentPrice);
  const percentFromSessionHigh = pctChange(sessionHigh, currentPrice);
  const percentFromVwap = pctChange(params.dynamicLevels?.vwap, currentPrice);
  const percentFromEma9 = pctChange(params.dynamicLevels?.ema9, currentPrice);
  const percentFromEma20 = pctChange(params.dynamicLevels?.ema20, currentPrice);
  const streak = greenStreak(candles);
  const reasons = [
    `from low ${round(percentFromSessionLow)}%`,
    `from high ${round(percentFromSessionHigh)}%`,
    `from VWAP ${round(percentFromVwap)}%`,
    `green streak ${streak}`,
  ];

  const stretched =
    (percentFromSessionLow !== null && percentFromSessionLow >= 50) ||
    (percentFromVwap !== null && percentFromVwap >= 15) ||
    streak >= 5;
  const extended =
    (percentFromSessionLow !== null && percentFromSessionLow >= 20) ||
    (percentFromVwap !== null && percentFromVwap >= 8) ||
    streak >= 3;
  const pullingBack = percentFromSessionHigh !== null && percentFromSessionHigh <= -12;
  const label: MoveExtensionLabel = stretched ? "stretched" : extended ? "extended" : pullingBack ? "pulling_back" : "normal";

  return {
    label,
    reliability: candles.length >= 6 ? "reliable" : "watch",
    percentFromSessionLow: round(percentFromSessionLow),
    percentFromSessionHigh: round(percentFromSessionHigh),
    percentFromVwap: round(percentFromVwap),
    percentFromEma9: round(percentFromEma9),
    percentFromEma20: round(percentFromEma20),
    greenCandleStreak: streak,
    reasons,
    traderLine:
      label === "stretched"
        ? "move is stretched from intraday support, so reactions need cleaner proof"
        : label === "extended"
          ? "move is extended, so pullback behavior matters more"
          : label === "pulling_back"
            ? "price is pulling back from the session high"
            : "move is not stretched by the current intraday read",
  };
}

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle]!;
}

function priceBucket(price: number | null | undefined): SmallCapVolatilityContext["priceBucket"] {
  if (!finite(price) || price <= 0) {
    return "unknown";
  }
  if (price < 1) {
    return "sub_1";
  }
  if (price < 2) {
    return "one_to_two";
  }
  if (price < 5) {
    return "two_to_five";
  }
  if (price < 10) {
    return "five_to_ten";
  }
  return "ten_plus";
}

export function buildSmallCapVolatilityContext(params: {
  candles?: Candle[];
  currentPrice?: number;
  spreadPct?: number | null;
}): SmallCapVolatilityContext {
  const candles = sortedCandles(params.candles);
  const currentPrice = params.currentPrice ?? latestClose(candles);
  const ranges = candles
    .slice(-30)
    .map((candle) => pctChange(candle.low, candle.high))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const medianRange = median(ranges);
  const averageRange = ranges.length > 0 ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : null;
  const oneCentMovePct = finite(currentPrice) ? (0.01 / currentPrice) * 100 : null;
  const bucket = priceBucket(currentPrice);
  const baselineFloor =
    bucket === "sub_1" ? 3.5 :
    bucket === "one_to_two" ? 2.25 :
    bucket === "two_to_five" ? 1.5 :
    bucket === "five_to_ten" ? 1.1 :
    bucket === "ten_plus" ? 0.8 :
    1.5;
  const meaningfulMovePct = Math.max(
    baselineFloor,
    (medianRange ?? 0) * 0.75,
    params.spreadPct ?? 0,
    oneCentMovePct ?? 0,
  );
  const reasons = [
    `price bucket ${bucket}`,
    `median 5m range ${round(medianRange)}%`,
    `one-cent move ${round(oneCentMovePct)}%`,
    `meaningful move floor ${round(meaningfulMovePct)}%`,
  ];

  if (ranges.length < 5 || !finite(currentPrice)) {
    return {
      label: "unknown",
      reliability: "watch",
      priceBucket: bucket,
      medianFiveMinuteRangePct: round(medianRange),
      averageFiveMinuteRangePct: round(averageRange),
      oneCentMovePct: round(oneCentMovePct),
      meaningfulMovePct: round(meaningfulMovePct),
      reasons: ["not enough recent candle range data", ...reasons],
    };
  }

  const label: SmallCapVolatilityLabel =
    meaningfulMovePct >= 6 ? "wild" :
    meaningfulMovePct >= 3 ? "volatile" :
    meaningfulMovePct >= 1.25 ? "normal" :
    "quiet";
  return {
    label,
    reliability: "reliable",
    priceBucket: bucket,
    medianFiveMinuteRangePct: round(medianRange),
    averageFiveMinuteRangePct: round(averageRange),
    oneCentMovePct: round(oneCentMovePct),
    meaningfulMovePct: round(meaningfulMovePct),
    reasons,
    traderLine:
      label === "wild" || label === "volatile"
        ? `normal noise is wider here; small pushes under ${round(meaningfulMovePct)}% need context`
        : "recent volatility is contained enough for cleaner level reads",
  };
}

export function buildOpeningRangeContext(params: {
  candles?: Candle[];
  currentPrice?: number;
  sessionDate?: string;
}): OpeningRangeContext {
  const candles = sortedCandles(params.candles);
  const currentPrice = params.currentPrice ?? latestClose(candles);
  const sessionDate = params.sessionDate ?? (candles.at(-1) ? etParts(candles.at(-1)!.timestamp).date : undefined);
  const openingCandles = candles.filter((candle) => {
    const parts = etParts(candle.timestamp);
    return (
      (!sessionDate || parts.date === sessionDate) &&
      parts.minutes >= 9 * 60 + 30 &&
      parts.minutes < 10 * 60
    );
  });
  if (openingCandles.length === 0) {
    return {
      label: "unavailable",
      reliability: "unreliable",
      high: null,
      low: null,
      rangePct: null,
      minutesCovered: 0,
      reasons: ["opening-range candles unavailable"],
    };
  }

  const high = Math.max(...openingCandles.map((candle) => candle.high));
  const low = Math.min(...openingCandles.map((candle) => candle.low));
  const rangePct = pctChange(low, high);
  const minutesCovered = openingCandles.length * 5;
  const highDistance = finite(currentPrice) ? Math.abs(currentPrice - high) / Math.max(currentPrice, 0.0001) : Infinity;
  const lowDistance = finite(currentPrice) ? Math.abs(currentPrice - low) / Math.max(currentPrice, 0.0001) : Infinity;
  const label: OpeningRangeLabel =
    finite(currentPrice) && currentPrice > high
      ? highDistance <= 0.01 ? "testing_opening_high" : "above_opening_range"
      : finite(currentPrice) && currentPrice < low
        ? lowDistance <= 0.01 ? "testing_opening_low" : "below_opening_range"
        : "inside_opening_range";
  return {
    label,
    reliability: minutesCovered >= 20 ? "reliable" : "watch",
    high,
    low,
    rangePct: round(rangePct),
    minutesCovered,
    reasons: [`opening range ${round(low)}-${round(high)}`, `${minutesCovered} minutes covered`],
    traderLine:
      label === "above_opening_range"
        ? "price is holding above the opening range"
        : label === "below_opening_range"
          ? "price is below the opening range, so momentum needs repair"
          : label === "inside_opening_range"
            ? "price is still inside the opening range"
            : undefined,
  };
}

export function buildHaltAwarenessContext(params: {
  candles?: Candle[];
  now?: number;
  expectedIntervalMs?: number;
}): HaltAwarenessContext {
  const candles = sortedCandles(params.candles);
  const latest = candles.at(-1);
  const prior = candles.at(-2);
  const now = params.now ?? Date.now();
  const expectedIntervalMs = params.expectedIntervalMs ?? FIVE_MINUTES_MS;
  if (!latest) {
    return {
      label: "unknown",
      reliability: "unreliable",
      gapSinceLastCandleMs: null,
      moveBeforePausePct: null,
      reasons: ["missing candles"],
    };
  }
  const gapSinceLastCandleMs = Math.max(0, now - latest.timestamp);
  const moveBeforePausePct = prior ? pctChange(prior.close, latest.close) : null;
  const possiblePause = gapSinceLastCandleMs >= expectedIntervalMs * 3;
  const fastMove = moveBeforePausePct !== null && Math.abs(moveBeforePausePct) >= 10;
  const label: HaltAwarenessLabel =
    possiblePause && fastMove ? "paused_after_fast_move" :
    possiblePause ? "possible_halt" :
    "normal";
  return {
    label,
    reliability: candles.length >= 2 ? "watch" : "unreliable",
    gapSinceLastCandleMs,
    moveBeforePausePct: round(moveBeforePausePct),
    reasons: [
      `gap since last candle ${Math.round(gapSinceLastCandleMs / 1000)}s`,
      `last candle move ${round(moveBeforePausePct)}%`,
    ],
    traderLine:
      label === "paused_after_fast_move"
        ? "prints paused after a fast move, so the next candle needs extra context"
        : label === "possible_halt"
          ? "prints have paused longer than expected"
          : undefined,
  };
}

function allLevelZones(levels: LevelEngineOutput | undefined, side: "support" | "resistance"): FinalLevelZone[] {
  if (!levels) {
    return [];
  }
  return side === "support"
    ? [
        ...levels.majorSupport,
        ...levels.intermediateSupport,
        ...levels.intradaySupport,
        ...levels.extensionLevels.support,
      ]
    : [
        ...levels.majorResistance,
        ...levels.intermediateResistance,
        ...levels.intradayResistance,
        ...levels.extensionLevels.resistance,
      ];
}

function nearestDistancePct(levels: FinalLevelZone[], currentPrice: number | null | undefined, side: "support" | "resistance"): number | null {
  if (!finite(currentPrice)) {
    return null;
  }
  const candidates = levels
    .filter((level) => side === "support" ? level.representativePrice < currentPrice : level.representativePrice > currentPrice)
    .sort((left, right) =>
      side === "support"
        ? right.representativePrice - left.representativePrice
        : left.representativePrice - right.representativePrice,
    );
  const nearest = candidates[0];
  return nearest ? round(Math.abs(((nearest.representativePrice - currentPrice) / currentPrice) * 100)) : null;
}

function forwardLevelCandidates(
  levels: FinalLevelZone[],
  currentPrice: number | null | undefined,
  side: "support" | "resistance",
): FinalLevelZone[] {
  if (!finite(currentPrice)) {
    return [];
  }

  return levels
    .filter((level) =>
      side === "support"
        ? level.representativePrice < currentPrice
        : level.representativePrice > currentPrice,
    )
    .sort((left, right) =>
      side === "support"
        ? right.representativePrice - left.representativePrice
        : left.representativePrice - right.representativePrice,
    );
}

function firstForwardGapPct(
  levels: FinalLevelZone[],
  currentPrice: number | null | undefined,
  side: "support" | "resistance",
): number | null {
  if (!finite(currentPrice)) {
    return null;
  }
  const candidates = forwardLevelCandidates(levels, currentPrice, side);
  const first = candidates[0];
  const second = candidates[1];
  if (!first || !second) {
    return null;
  }
  return round(Math.abs(((second.representativePrice - first.representativePrice) / currentPrice) * 100));
}

function tightClusterCount(
  levels: FinalLevelZone[],
  currentPrice: number | null | undefined,
  side: "support" | "resistance",
): number {
  if (!finite(currentPrice)) {
    return 0;
  }
  const nearby = forwardLevelCandidates(levels, currentPrice, side)
    .filter((level) => Math.abs(((level.representativePrice - currentPrice) / currentPrice) * 100) <= 12)
    .slice(0, 6);
  if (nearby.length < 2) {
    return nearby.length;
  }

  let longest = 1;
  let current = 1;
  for (let index = 1; index < nearby.length; index += 1) {
    const previous = nearby[index - 1]!;
    const next = nearby[index]!;
    const gapPct = Math.abs(((next.representativePrice - previous.representativePrice) / currentPrice) * 100);
    if (gapPct <= 2.5) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }

  return longest >= 2 ? longest : 0;
}

export function buildLevelQualityCalibrationContext(params: {
  levels?: LevelEngineOutput;
  currentPrice?: number;
}): LevelQualityCalibrationContext {
  const support = allLevelZones(params.levels, "support");
  const resistance = allLevelZones(params.levels, "resistance");
  const nearestSupportDistancePct = nearestDistancePct(support, params.currentPrice, "support");
  const nearestResistanceDistancePct = nearestDistancePct(resistance, params.currentPrice, "resistance");
  const forwardSupportGapPct = firstForwardGapPct(support, params.currentPrice, "support");
  const forwardResistanceGapPct = firstForwardGapPct(resistance, params.currentPrice, "resistance");
  const tightSupportClusterCount = tightClusterCount(support, params.currentPrice, "support");
  const tightResistanceClusterCount = tightClusterCount(resistance, params.currentPrice, "resistance");
  const reasons: string[] = [
    `support count ${support.length}`,
    `resistance count ${resistance.length}`,
    `nearest support ${nearestSupportDistancePct ?? "n/a"}%`,
    `nearest resistance ${nearestResistanceDistancePct ?? "n/a"}%`,
    `forward support gap ${forwardSupportGapPct ?? "n/a"}%`,
    `forward resistance gap ${forwardResistanceGapPct ?? "n/a"}%`,
    `tight support cluster ${tightSupportClusterCount}`,
    `tight resistance cluster ${tightResistanceClusterCount}`,
  ];
  const noForward = support.length === 0 || resistance.length === 0;
  const wideFirstGap =
    (nearestSupportDistancePct !== null && nearestSupportDistancePct > 15) ||
    (nearestResistanceDistancePct !== null && nearestResistanceDistancePct > 15);
  const thinLadder = support.length < 3 || resistance.length < 3;
  const crowdedNearby = tightSupportClusterCount >= 3 || tightResistanceClusterCount >= 3;
  const label: LevelQualityCalibrationLabel =
    noForward ? "no_forward_levels" :
    wideFirstGap ? "wide_first_gap" :
    thinLadder ? "thin_ladder" :
    crowdedNearby ? "crowded_nearby_levels" :
    "healthy";
  return {
    label,
    reliability: params.levels ? "reliable" : "unreliable",
    nearestSupportDistancePct,
    nearestResistanceDistancePct,
    forwardSupportGapPct,
    forwardResistanceGapPct,
    tightSupportClusterCount,
    tightResistanceClusterCount,
    supportCount: support.length,
    resistanceCount: resistance.length,
    reasons,
    traderLine:
      label === "healthy"
        ? "nearby support and resistance are defined enough for a clean level read"
        : label === "crowded_nearby_levels"
          ? "nearby levels are crowded, so the practical zone matters more than each exact print"
          : label === "wide_first_gap"
            ? "the first useful level gap is wide, so fresh reactions need extra proof"
            : label === "thin_ladder"
              ? "the ladder is thin, so the strongest areas carry the cleaner read"
              : label === "no_forward_levels"
                ? "one side of the ladder is missing, so higher-timeframe data needs review"
                : undefined,
  };
}

export function buildDataQualityGateContext(params: {
  liquidity: LiquidityTradabilityContext;
  volatility: SmallCapVolatilityContext;
  sessionGap: SessionGapContext;
  candleReaction: CandleReactionContext;
  moveExtension: MoveExtensionContext;
  levelQuality: LevelQualityCalibrationContext;
  haltAwareness: HaltAwarenessContext;
  levelDataQualityFlags?: string[];
}): DataQualityGateContext {
  let score = 100;
  const reasons: string[] = [];
  const contexts = [
    ["liquidity", params.liquidity.reliability],
    ["volatility", params.volatility.reliability],
    ["session", params.sessionGap.reliability],
    ["candle reaction", params.candleReaction.reliability],
    ["move extension", params.moveExtension.reliability],
    ["level quality", params.levelQuality.reliability],
    ["halt", params.haltAwareness.reliability],
  ] as const;
  for (const [name, reliability] of contexts) {
    if (reliability === "watch") {
      score -= 10;
      reasons.push(`${name} needs review`);
    } else if (reliability === "unreliable") {
      score -= 20;
      reasons.push(`${name} unreliable`);
    }
  }
  for (const flag of params.levelDataQualityFlags ?? []) {
    score -= 8;
    reasons.push(`level data: ${flag}`);
  }
  if (params.liquidity.label === "messy" || params.liquidity.label === "thin") {
    score -= 10;
    reasons.push(`liquidity ${params.liquidity.label}`);
  }
  if (params.levelQuality.label === "wide_first_gap" || params.levelQuality.label === "no_forward_levels") {
    score -= 15;
    reasons.push(`level ladder ${params.levelQuality.label}`);
  }
  if (params.haltAwareness.label !== "normal" && params.haltAwareness.label !== "unknown") {
    score -= 10;
    reasons.push(params.haltAwareness.label);
  }
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const label: DataQualityGateLabel =
    clamped >= 80 ? "trusted" :
    clamped >= 60 ? "watch" :
    clamped >= 35 ? "degraded" :
    "unusable";
  return {
    label,
    score: clamped,
    reasons: reasons.length > 0 ? reasons : ["data quality checks passed"],
    traderLine:
      label === "trusted"
        ? "data quality is good enough for normal level reads"
        : label === "watch"
          ? "data quality has watch items, so level reactions need cleaner proof"
          : "data quality is degraded, so the read should stay conservative",
  };
}

export function buildTradeIdeaSummaryContext(params: {
  symbol: string;
  sessionGap: SessionGapContext;
  candleReaction: CandleReactionContext;
  moveExtension: MoveExtensionContext;
  volatility: SmallCapVolatilityContext;
  levelQuality: LevelQualityCalibrationContext;
  dataQuality?: DataQualityGateContext;
}): TradeIdeaSummaryContext {
  const reasons: string[] = [];
  if (params.dataQuality && (params.dataQuality.label === "degraded" || params.dataQuality.label === "unusable")) {
    return {
      label: "needs_data",
      confidence: "low",
      leadLine: `${params.symbol} needs cleaner data before the read deserves weight.`,
      reasons: params.dataQuality.reasons,
    };
  }
  if (params.moveExtension.label === "stretched") {
    reasons.push("move stretched");
    return {
      label: "extended_runner",
      confidence: params.moveExtension.reliability === "reliable" ? "medium" : "low",
      leadLine: `${params.symbol} is an extended runner; pullback behavior and support holds matter more now.`,
      reasons,
    };
  }
  if (params.candleReaction.label === "strong_close_through" || params.sessionGap.label === "above_previous_high") {
    reasons.push(params.candleReaction.label, params.sessionGap.label);
    return {
      label: "breakout_watch",
      confidence: "medium",
      leadLine: `${params.symbol} has a breakout-style read, but it still needs acceptance above resistance.`,
      reasons,
    };
  }
  if (params.candleReaction.label === "support_defense" || params.candleReaction.label === "reclaim") {
    reasons.push(params.candleReaction.label);
    return {
      label: params.candleReaction.label === "reclaim" ? "support_reclaim" : "support_reaction",
      confidence: params.candleReaction.reliability === "reliable" ? "medium" : "low",
      leadLine: `${params.symbol} is showing a support-reaction read; the cleaner story is buyers stabilizing above support.`,
      reasons,
    };
  }
  if (params.volatility.label === "wild" && params.levelQuality.label !== "healthy") {
    reasons.push("wild volatility with weak ladder quality");
    return {
      label: "noisy_chop",
      confidence: "medium",
      leadLine: `${params.symbol} is noisy; avoid over-reading small pushes inside the range.`,
      reasons,
    };
  }
  return {
    label: "range_trade",
    confidence: params.levelQuality.label === "healthy" ? "medium" : "low",
    leadLine: `${params.symbol} is mainly a range read until price accepts above resistance or loses support cleanly.`,
    reasons: ["default range read", params.levelQuality.label],
  };
}

export function buildNoPostExplainerContext(params: {
  storyMemory: TraderStoryMemoryContext;
  candleReaction: CandleReactionContext;
  volatility: SmallCapVolatilityContext;
  dataQuality: DataQualityGateContext;
  moveExtension: MoveExtensionContext;
}): NoPostExplainerContext {
  const reasons: string[] = [];
  if (params.storyMemory.decision === "cooldown") {
    reasons.push("same story already posted recently");
  }
  if (params.candleReaction.label === "indecision") {
    reasons.push("latest candle is indecisive");
  }
  if (
    params.volatility.meaningfulMovePct !== null &&
    params.moveExtension.percentFromSessionHigh !== null &&
    Math.abs(params.moveExtension.percentFromSessionHigh) < params.volatility.meaningfulMovePct
  ) {
    reasons.push("move is inside normal small-cap noise");
  }
  if (params.dataQuality.label === "degraded" || params.dataQuality.label === "unusable") {
    reasons.push("data quality is not clean enough");
  }
  if (reasons.length === 0) {
    return { decision: "post_needed", reasons: ["material read is available"] };
  }
  return {
    decision: params.dataQuality.label === "unusable" ? "operator_review" : "no_post_needed",
    reasons,
  };
}

export function buildFirstPostTradePlanContext(params: {
  symbol: string;
  tradeIdea: TradeIdeaSummaryContext;
  dataQuality: DataQualityGateContext;
  volatility: SmallCapVolatilityContext;
  openingRange: OpeningRangeContext;
  levelQuality: LevelQualityCalibrationContext;
}): FirstPostTradePlanContext {
  const lines = [
    `Main read: ${params.tradeIdea.leadLine}`,
    `Quality check: ${params.dataQuality.label} (${params.dataQuality.score}/100).`,
  ];
  if (params.volatility.traderLine) {
    lines.push(`Volatility: ${params.volatility.traderLine}.`);
  }
  if (params.openingRange.traderLine) {
    lines.push(`Opening range: ${params.openingRange.traderLine}.`);
  }
  if (params.levelQuality.traderLine) {
    lines.push(`Level quality: ${params.levelQuality.traderLine}.`);
  } else if (params.levelQuality.label !== "healthy") {
    lines.push(`Level quality: ${params.levelQuality.label.replace(/_/g, " ")}; closest levels carry the cleaner read.`);
  }
  return {
    title: `${params.symbol} trade plan context`,
    lines,
  };
}

export function buildTraderStoryKey(params: {
  symbol: string;
  structureState?: string;
  levelSide?: "support" | "resistance" | null;
  levelPrice?: number | null;
  reactionLabel?: string;
  extensionLabel?: string;
}): string {
  const priceBucket = finite(params.levelPrice) ? Math.round(params.levelPrice * 100) / 100 : "none";
  return [
    params.symbol.trim().toUpperCase(),
    params.structureState ?? "structure_unknown",
    params.levelSide ?? "no_side",
    priceBucket,
    params.reactionLabel ?? "reaction_unknown",
    params.extensionLabel ?? "extension_unknown",
  ].join("|");
}

export function evaluateTraderStoryMemory(params: {
  storyKey: string;
  previousStory?: PreviousTraderStory | null;
  timestamp?: number;
  cooldownMs?: number;
  materialChange?: boolean;
}): TraderStoryMemoryContext {
  const timestamp = params.timestamp ?? Date.now();
  const cooldownMs = params.cooldownMs ?? 10 * 60_000;
  const previous = params.previousStory;
  const elapsedMs = previous ? timestamp - previous.timestamp : null;
  const reasons: string[] = [];
  if (!previous) {
    reasons.push("no previous story");
    return {
      decision: "new_story",
      storyKey: params.storyKey,
      previousStoryKey: null,
      cooldownMs,
      elapsedMs: null,
      reasons,
    };
  }
  if (params.materialChange) {
    reasons.push("material structure or level change");
    return {
      decision: "material_update",
      storyKey: params.storyKey,
      previousStoryKey: previous.storyKey,
      cooldownMs,
      elapsedMs,
      reasons,
    };
  }
  if (previous.storyKey === params.storyKey && elapsedMs !== null && elapsedMs < cooldownMs) {
    reasons.push("same story inside cooldown");
    return {
      decision: "cooldown",
      storyKey: params.storyKey,
      previousStoryKey: previous.storyKey,
      cooldownMs,
      elapsedMs,
      reasons,
    };
  }
  if (previous.storyKey === params.storyKey) {
    reasons.push("same story after cooldown");
    return {
      decision: "repeat",
      storyKey: params.storyKey,
      previousStoryKey: previous.storyKey,
      cooldownMs,
      elapsedMs,
      reasons,
    };
  }
  reasons.push("story key changed");
  return {
    decision: "new_story",
    storyKey: params.storyKey,
    previousStoryKey: previous.storyKey,
    cooldownMs,
    elapsedMs,
    reasons,
  };
}

export class TraderStoryMemory {
  private readonly stories = new Map<string, PreviousTraderStory>();

  evaluate(symbol: string, storyKey: string, timestamp = Date.now(), materialChange = false): TraderStoryMemoryContext {
    const normalized = symbol.trim().toUpperCase();
    const context = evaluateTraderStoryMemory({
      storyKey,
      previousStory: this.stories.get(normalized),
      timestamp,
      materialChange,
    });
    if (context.decision === "new_story" || context.decision === "material_update" || context.decision === "repeat") {
      this.stories.set(normalized, { storyKey, timestamp });
    }
    return context;
  }
}

export function buildTraderIntelligenceContext(
  request: BuildTraderIntelligenceContextRequest,
): TraderIntelligenceContext {
  const intraday = sortedCandles(request.intradayCandles);
  const daily = sortedCandles(request.dailyCandles);
  const currentPrice = request.currentPrice ?? latestClose(intraday);
  const liquidity = buildLiquidityTradabilityContext({
    candles: intraday,
    currentPrice: currentPrice ?? undefined,
    bid: request.bid,
    ask: request.ask,
  });
  const catalystProfile = buildCatalystProfileRiskFromStockContext(request.stockContext, request.knownCatalyst);
  const sessionGap = buildSessionGapContext({
    dailyCandles: daily,
    intradayCandles: intraday,
    currentPrice: currentPrice ?? undefined,
  });
  const volatility = buildSmallCapVolatilityContext({
    candles: intraday,
    currentPrice: currentPrice ?? undefined,
    spreadPct: liquidity.spreadPct,
  });
  const candleReaction = buildCandleReactionContext({
    candles: intraday,
    referenceLevel: request.referenceLevel,
    meaningfulMovePct: volatility.meaningfulMovePct,
  });
  const moveExtension = buildMoveExtensionContext({
    candles: intraday,
    currentPrice: currentPrice ?? undefined,
    dynamicLevels: request.dynamicLevels,
  });
  const openingRange = buildOpeningRangeContext({
    candles: intraday,
    currentPrice: currentPrice ?? undefined,
  });
  const haltAwareness = buildHaltAwarenessContext({
    candles: intraday,
    now: request.timestamp,
  });
  const levelQuality = buildLevelQualityCalibrationContext({
    levels: request.levels,
    currentPrice: currentPrice ?? undefined,
  });
  const dataQuality = buildDataQualityGateContext({
    liquidity,
    volatility,
    sessionGap,
    candleReaction,
    moveExtension,
    levelQuality,
    haltAwareness,
    levelDataQualityFlags: request.levels?.metadata.dataQualityFlags,
  });
  const tradeIdea = buildTradeIdeaSummaryContext({
    symbol: request.symbol,
    sessionGap,
    candleReaction,
    moveExtension,
    volatility,
    levelQuality,
    dataQuality,
  });
  const storyKey = buildTraderStoryKey({
    symbol: request.symbol,
    structureState: tradeIdea.label,
    levelSide: request.referenceLevel?.side,
    levelPrice: request.referenceLevel?.price,
    reactionLabel: candleReaction.label,
    extensionLabel: moveExtension.label,
  });
  const storyMemory = evaluateTraderStoryMemory({
    storyKey,
    previousStory: request.previousStory,
    timestamp: request.timestamp,
    materialChange:
      candleReaction.label !== "indecision" ||
      moveExtension.label === "stretched" ||
      openingRange.label === "above_opening_range" ||
      openingRange.label === "below_opening_range",
  });
  const noPost = buildNoPostExplainerContext({
    storyMemory,
    candleReaction,
    volatility,
    dataQuality,
    moveExtension,
  });
  const firstPostPlan = buildFirstPostTradePlanContext({
    symbol: request.symbol.trim().toUpperCase(),
    tradeIdea,
    dataQuality,
    volatility,
    openingRange,
    levelQuality,
  });

  return {
    liquidity,
    catalystProfile,
    sessionGap,
    candleReaction,
    moveExtension,
    volatility,
    openingRange,
    haltAwareness,
    levelQuality,
    dataQuality,
    tradeIdea,
    noPost,
    firstPostPlan,
    storyMemory,
  };
}
