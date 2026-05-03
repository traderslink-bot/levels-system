import type { Candle } from "../market-data/candle-types.js";

export type CandleMarketStructureState =
  | "insufficient_data"
  | "range_bound"
  | "base_building"
  | "pressing_range_high"
  | "breakout_attempt"
  | "breakout_holding"
  | "failed_breakout"
  | "pullback_to_structure"
  | "higher_lows_intact"
  | "trend_intact"
  | "trend_damaged"
  | "pivot_lost"
  | "reclaim_attempt"
  | "reclaim_confirmed";

export type CandleMarketStructureDiagnosticCode =
  | "insufficient_candles"
  | "future_candles_filtered"
  | "no_confirmed_pivots"
  | "choppy_structure"
  | "derived_from_1m";

export type CandleMarketStructureDiagnostic = {
  code: CandleMarketStructureDiagnosticCode;
  severity: "info" | "warning";
  message: string;
};

export type CandleMarketStructureOptions = {
  leftBars?: number;
  rightBars?: number;
  minCandles?: number;
  rangeLookbackBars?: number;
  sourceTimeframe?: "5m" | "1m";
};

export type CandleStructurePivot = {
  id: string;
  kind: "swing_high" | "swing_low";
  price: number;
  timestamp: number;
  index: number;
  strength: number;
  confirmed: true;
};

export type CandleMarketStructurePivots = {
  confirmedHighs: CandleStructurePivot[];
  confirmedLows: CandleStructurePivot[];
  latestSwingHigh: CandleStructurePivot | null;
  latestSwingLow: CandleStructurePivot | null;
  priorSwingHigh: CandleStructurePivot | null;
  priorSwingLow: CandleStructurePivot | null;
};

export type CandleMarketStructureTrend = {
  direction: "building" | "fading" | "uptrend" | "damaged" | "range" | "unknown";
  higherLowCount: number;
  lowerHighCount: number;
  higherHighCount: number;
  lowerLowCount: number;
  latestHigherLow: CandleStructurePivot | null;
  latestLowerHigh: CandleStructurePivot | null;
};

export type CandleMarketStructureRange = {
  active: boolean;
  high: number;
  low: number;
  widthPct: number;
  touchCountHigh: number;
  touchCountLow: number;
  quality: "clean" | "loose" | "choppy";
};

export type CandleMarketStructurePivotEvent = {
  type: "reclaim" | "loss" | "failed_reclaim" | "none";
  pivot: CandleStructurePivot | null;
  triggerPrice: number | null;
  confirmation: "early" | "confirmed";
};

export type CandleMarketStructureConfidence = {
  score: number;
  label: "low" | "medium" | "high";
  reasons: string[];
};

export type CandleMarketStructureContext = {
  symbol: string;
  timeframe: "5m";
  asOfTimestamp: number | null;
  state: CandleMarketStructureState;
  confidence: CandleMarketStructureConfidence;
  pivots: CandleMarketStructurePivots;
  trend: CandleMarketStructureTrend;
  range: CandleMarketStructureRange | null;
  pivotEvent: CandleMarketStructurePivotEvent | null;
  traderLine?: string;
  diagnostics: CandleMarketStructureDiagnostic[];
};

export type BuildCandleMarketStructureRequest = {
  symbol: string;
  candles: Candle[];
  timeframe?: "5m";
  asOfTimestamp?: number | string | Date;
  currentPrice?: number;
  options?: CandleMarketStructureOptions;
};

const DEFAULT_LEFT_BARS = 2;
const DEFAULT_RIGHT_BARS = 2;
const DEFAULT_MIN_CANDLES = 12;
const DEFAULT_RANGE_LOOKBACK_BARS = 24;

function parseTimestamp(timestamp: number | string | Date | undefined): number | undefined {
  if (timestamp === undefined) {
    return undefined;
  }
  if (typeof timestamp === "number") {
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  if (timestamp instanceof Date) {
    const value = timestamp.getTime();
    return Number.isFinite(value) ? value : undefined;
  }
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : undefined;
}

function roundPrice(value: number): number {
  if (value >= 10) {
    return Number(value.toFixed(2));
  }
  if (value >= 1) {
    return Number(value.toFixed(3));
  }
  return Number(value.toFixed(4));
}

function pctDistance(left: number, right: number): number {
  return Math.abs(left - right) / Math.max(Math.abs(right), 0.0001);
}

function rangeWidthPct(low: number, high: number): number {
  return (high - low) / Math.max(Math.abs(low), 0.0001);
}

function practicalTolerance(price: number): number {
  if (price < 1) {
    return Math.max(0.015, price * 0.025);
  }
  if (price < 2) {
    return Math.max(0.025, price * 0.02);
  }
  if (price < 10) {
    return Math.max(0.04, price * 0.012);
  }
  if (price < 50) {
    return Math.max(0.15, price * 0.008);
  }
  return Math.max(0.4, price * 0.006);
}

function emptyPivots(): CandleMarketStructurePivots {
  return {
    confirmedHighs: [],
    confirmedLows: [],
    latestSwingHigh: null,
    latestSwingLow: null,
    priorSwingHigh: null,
    priorSwingLow: null,
  };
}

function unknownTrend(): CandleMarketStructureTrend {
  return {
    direction: "unknown",
    higherLowCount: 0,
    lowerHighCount: 0,
    higherHighCount: 0,
    lowerLowCount: 0,
    latestHigherLow: null,
    latestLowerHigh: null,
  };
}

function lowConfidence(reason: string): CandleMarketStructureConfidence {
  return {
    score: 0.1,
    label: "low",
    reasons: [reason],
  };
}

function sortedUsableCandles(candles: Candle[], asOfTimestamp?: number): {
  candles: Candle[];
  filteredFutureCount: number;
} {
  const sorted = [...candles]
    .filter((candle) =>
      Number.isFinite(candle.timestamp) &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close) &&
      candle.high >= candle.low,
    )
    .sort((left, right) => left.timestamp - right.timestamp);
  const filtered = asOfTimestamp === undefined
    ? sorted
    : sorted.filter((candle) => candle.timestamp <= asOfTimestamp);
  return {
    candles: filtered,
    filteredFutureCount: sorted.length - filtered.length,
  };
}

function localMoveStrength(candles: Candle[], index: number, kind: "swing_high" | "swing_low"): number {
  const pivot = candles[index]!;
  const left = candles.slice(Math.max(0, index - 3), index);
  const right = candles.slice(index + 1, Math.min(candles.length, index + 4));
  const local = [...left, pivot, ...right];
  const localRange = Math.max(...local.map((candle) => candle.high)) - Math.min(...local.map((candle) => candle.low));
  if (localRange <= 0) {
    return 0.1;
  }
  const reaction =
    kind === "swing_high"
      ? pivot.high - Math.min(...right.map((candle) => candle.low), pivot.low)
      : Math.max(...right.map((candle) => candle.high), pivot.high) - pivot.low;
  return Math.max(0.1, Math.min(1, reaction / localRange));
}

function detectPivots(
  symbol: string,
  candles: Candle[],
  leftBars: number,
  rightBars: number,
): CandleMarketStructurePivots {
  const highs: CandleStructurePivot[] = [];
  const lows: CandleStructurePivot[] = [];

  for (let index = leftBars; index < candles.length - rightBars; index += 1) {
    const candle = candles[index]!;
    const left = candles.slice(index - leftBars, index);
    const right = candles.slice(index + 1, index + 1 + rightBars);
    const isSwingHigh =
      left.every((other) => candle.high > other.high) &&
      right.every((other) => candle.high > other.high);
    const isSwingLow =
      left.every((other) => candle.low < other.low) &&
      right.every((other) => candle.low < other.low);

    if (isSwingHigh) {
      highs.push({
        id: `${symbol}:5m:H:${candle.timestamp}`,
        kind: "swing_high",
        price: roundPrice(candle.high),
        timestamp: candle.timestamp,
        index,
        strength: Number(localMoveStrength(candles, index, "swing_high").toFixed(3)),
        confirmed: true,
      });
    }
    if (isSwingLow) {
      lows.push({
        id: `${symbol}:5m:L:${candle.timestamp}`,
        kind: "swing_low",
        price: roundPrice(candle.low),
        timestamp: candle.timestamp,
        index,
        strength: Number(localMoveStrength(candles, index, "swing_low").toFixed(3)),
        confirmed: true,
      });
    }
  }

  return {
    confirmedHighs: highs,
    confirmedLows: lows,
    latestSwingHigh: highs.at(-1) ?? null,
    latestSwingLow: lows.at(-1) ?? null,
    priorSwingHigh: highs.at(-2) ?? null,
    priorSwingLow: lows.at(-2) ?? null,
  };
}

function countSequentialMoves(pivots: CandleStructurePivot[], direction: "higher" | "lower"): number {
  let count = 0;
  for (let index = 1; index < pivots.length; index += 1) {
    const previous = pivots[index - 1]!;
    const current = pivots[index]!;
    const tolerance = practicalTolerance(current.price);
    if (direction === "higher" && current.price > previous.price + tolerance) {
      count += 1;
    }
    if (direction === "lower" && current.price < previous.price - tolerance) {
      count += 1;
    }
  }
  return count;
}

function deriveTrend(pivots: CandleMarketStructurePivots): CandleMarketStructureTrend {
  const recentLows = pivots.confirmedLows.slice(-5);
  const recentHighs = pivots.confirmedHighs.slice(-5);
  const higherLowCount = countSequentialMoves(recentLows, "higher");
  const lowerLowCount = countSequentialMoves(recentLows, "lower");
  const higherHighCount = countSequentialMoves(recentHighs, "higher");
  const lowerHighCount = countSequentialMoves(recentHighs, "lower");
  const latestHigherLow =
    recentLows.length >= 2 && higherLowCount > 0 && recentLows.at(-1)!.price > recentLows.at(-2)!.price
      ? recentLows.at(-1)!
      : null;
  const latestLowerHigh =
    recentHighs.length >= 2 && lowerHighCount > 0 && recentHighs.at(-1)!.price < recentHighs.at(-2)!.price
      ? recentHighs.at(-1)!
      : null;

  let direction: CandleMarketStructureTrend["direction"] = "unknown";
  if (higherLowCount >= 2 && higherHighCount >= 1) {
    direction = "uptrend";
  } else if (higherLowCount >= 2) {
    direction = "building";
  } else if (lowerLowCount >= 2 || (lowerHighCount >= 2 && lowerLowCount >= 1)) {
    direction = "damaged";
  } else if (lowerHighCount >= 2) {
    direction = "fading";
  } else if (recentLows.length >= 2 && recentHighs.length >= 2) {
    direction = "range";
  }

  return {
    direction,
    higherLowCount,
    lowerHighCount,
    higherHighCount,
    lowerLowCount,
    latestHigherLow,
    latestLowerHigh,
  };
}

function countTouches(candles: Candle[], level: number, side: "high" | "low"): number {
  const tolerance = practicalTolerance(level);
  return candles.filter((candle) => Math.abs((side === "high" ? candle.high : candle.low) - level) <= tolerance).length;
}

function detectRange(candles: Candle[], pivots: CandleMarketStructurePivots, lookbackBars: number): CandleMarketStructureRange | null {
  const recentCandles = candles.slice(-lookbackBars);
  if (recentCandles.length < 8) {
    return null;
  }
  const currentClose = candles.at(-1)?.close ?? recentCandles.at(-1)!.close;
  const recentHighPivots = pivots.confirmedHighs.filter((pivot) => pivot.index >= candles.length - lookbackBars);
  const recentLowPivots = pivots.confirmedLows.filter((pivot) => pivot.index >= candles.length - lookbackBars);
  const high = recentHighPivots.length > 0
    ? Math.max(...recentHighPivots.map((pivot) => pivot.price))
    : Math.max(...recentCandles.map((candle) => candle.high));
  const low = recentLowPivots.length > 0
    ? Math.min(...recentLowPivots.map((pivot) => pivot.price))
    : Math.min(...recentCandles.map((candle) => candle.low));
  const widthPct = rangeWidthPct(low, high);
  let touchCountHigh = countTouches(recentCandles, high, "high");
  let touchCountLow = countTouches(recentCandles, low, "low");
  let active = widthPct >= 0.018 && touchCountHigh >= 2 && touchCountLow >= 2;

  if (!active && recentCandles.length >= 10) {
    const priorCandles = recentCandles.slice(0, -2);
    const priorHigh = Math.max(...priorCandles.map((candle) => candle.high));
    const priorLow = Math.min(...priorCandles.map((candle) => candle.low));
    const priorWidthPct = rangeWidthPct(priorLow, priorHigh);
    const priorHighTouches = countTouches(priorCandles, priorHigh, "high");
    const priorLowTouches = countTouches(priorCandles, priorLow, "low");
    const brokePriorHigh = currentClose > priorHigh + practicalTolerance(priorHigh);
    const brokePriorLow = currentClose < priorLow - practicalTolerance(priorLow);
    if (
      priorWidthPct >= 0.018 &&
      priorHighTouches >= 2 &&
      priorLowTouches >= 2 &&
      (brokePriorHigh || brokePriorLow)
    ) {
      touchCountHigh = priorHighTouches;
      touchCountLow = priorLowTouches;
      const quality: CandleMarketStructureRange["quality"] =
        touchCountHigh >= 3 && touchCountLow >= 3 && priorWidthPct <= 0.18 ? "clean" : "loose";
      return {
        active: true,
        high: roundPrice(priorHigh),
        low: roundPrice(priorLow),
        widthPct: Number(priorWidthPct.toFixed(4)),
        touchCountHigh,
        touchCountLow,
        quality,
      };
    }
  }

  if (!active && recentHighPivots.length + recentLowPivots.length < 4) {
    return null;
  }

  let quality: CandleMarketStructureRange["quality"] = "loose";
  if (active && touchCountHigh >= 3 && touchCountLow >= 3 && widthPct <= 0.18) {
    quality = "clean";
  } else if (widthPct <= 0.03 || touchCountHigh + touchCountLow >= 8) {
    quality = "choppy";
  }

  return {
    active,
    high: roundPrice(high),
    low: roundPrice(low),
    widthPct: Number(widthPct.toFixed(4)),
    touchCountHigh,
    touchCountLow,
    quality,
  };
}

function derivePivotEvent(params: {
  candles: Candle[];
  pivots: CandleMarketStructurePivots;
  range: CandleMarketStructureRange | null;
  currentPrice: number;
}): CandleMarketStructurePivotEvent | null {
  const { candles, pivots, range, currentPrice } = params;
  if (candles.length < 3) {
    return null;
  }
  const last = candles.at(-1)!;
  const prior = candles.at(-2)!;
  const latestLow = pivots.latestSwingLow;
  const latestHigh = pivots.latestSwingHigh;
  const rangeLowPivot = range
    ? ({
        id: "active-range-low",
        kind: "swing_low",
        price: range.low,
        timestamp: last.timestamp,
        index: candles.length - 1,
        strength: 0.5,
        confirmed: true,
      } satisfies CandleStructurePivot)
    : null;
  const rangeHighPivot = range
    ? ({
        id: "active-range-high",
        kind: "swing_high",
        price: range.high,
        timestamp: last.timestamp,
        index: candles.length - 1,
        strength: 0.5,
        confirmed: true,
      } satisfies CandleStructurePivot)
    : null;

  const supportPivot = latestLow ?? rangeLowPivot;
  if (supportPivot) {
    const tolerance = practicalTolerance(supportPivot.price);
    if (prior.close >= supportPivot.price - tolerance && last.close < supportPivot.price - tolerance) {
      return {
        type: "loss",
        pivot: supportPivot,
        triggerPrice: supportPivot.price,
        confirmation: "confirmed",
      };
    }
    if (prior.close < supportPivot.price - tolerance && last.close >= supportPivot.price + tolerance) {
      return {
        type: "reclaim",
        pivot: supportPivot,
        triggerPrice: supportPivot.price,
        confirmation: "confirmed",
      };
    }
  }
  const reclaimedSupport = [...pivots.confirmedLows, ...(rangeLowPivot ? [rangeLowPivot] : [])]
    .filter((pivot) => {
      const tolerance = practicalTolerance(pivot.price);
      const recentlyBelow = candles.slice(-4, -1).some((candle) => candle.close < pivot.price);
      return recentlyBelow && last.close >= pivot.price + tolerance;
    })
    .sort((left, right) => Math.abs(left.price - currentPrice) - Math.abs(right.price - currentPrice))[0];
  if (reclaimedSupport) {
    return {
      type: "reclaim",
      pivot: reclaimedSupport,
      triggerPrice: reclaimedSupport.price,
      confirmation: "confirmed",
    };
  }

  const resistancePivot = latestHigh ?? rangeHighPivot;
  if (resistancePivot) {
    const tolerance = practicalTolerance(resistancePivot.price);
    const pushedAbove = last.high > resistancePivot.price + tolerance;
    const closedBackBelow = last.close < resistancePivot.price;
    if (pushedAbove && closedBackBelow) {
      return {
        type: "failed_reclaim",
        pivot: resistancePivot,
        triggerPrice: resistancePivot.price,
        confirmation: "confirmed",
      };
    }
    if (prior.close < resistancePivot.price - tolerance && last.close >= resistancePivot.price + tolerance) {
      return {
        type: "reclaim",
        pivot: resistancePivot,
        triggerPrice: resistancePivot.price,
        confirmation: currentPrice >= resistancePivot.price + tolerance ? "confirmed" : "early",
      };
    }
  }
  const reclaimedResistance = [...pivots.confirmedHighs, ...(rangeHighPivot ? [rangeHighPivot] : [])]
    .filter((pivot) => {
      const tolerance = practicalTolerance(pivot.price);
      const recentlyBelow = candles.slice(-4, -1).some((candle) => candle.close < pivot.price);
      return recentlyBelow && last.close >= pivot.price + tolerance;
    })
    .sort((left, right) => Math.abs(left.price - currentPrice) - Math.abs(right.price - currentPrice))[0];
  if (reclaimedResistance) {
    return {
      type: "reclaim",
      pivot: reclaimedResistance,
      triggerPrice: reclaimedResistance.price,
      confirmation: "confirmed",
    };
  }

  return {
    type: "none",
    pivot: null,
    triggerPrice: null,
    confirmation: "early",
  };
}

function deriveState(params: {
  trend: CandleMarketStructureTrend;
  range: CandleMarketStructureRange | null;
  pivotEvent: CandleMarketStructurePivotEvent | null;
  currentPrice: number;
}): CandleMarketStructureState {
  const { trend, range, pivotEvent, currentPrice } = params;
  if (pivotEvent?.type === "loss") {
    return "pivot_lost";
  }
  if (pivotEvent?.type === "failed_reclaim") {
    return "failed_breakout";
  }
  if (pivotEvent?.type === "reclaim") {
    return pivotEvent.confirmation === "confirmed" ? "reclaim_confirmed" : "reclaim_attempt";
  }
  if (range?.active) {
    const highTolerance = practicalTolerance(range.high);
    const lowTolerance = practicalTolerance(range.low);
    if (currentPrice > range.high + highTolerance) {
      return trend.direction === "uptrend" || trend.direction === "building" ? "breakout_holding" : "breakout_attempt";
    }
    if (Math.abs(currentPrice - range.high) <= highTolerance) {
      return "pressing_range_high";
    }
    if (Math.abs(currentPrice - range.low) <= lowTolerance) {
      return "pullback_to_structure";
    }
    return trend.direction === "building" || trend.direction === "uptrend" ? "base_building" : "range_bound";
  }
  if (trend.direction === "uptrend") {
    return "trend_intact";
  }
  if (trend.direction === "building") {
    return "higher_lows_intact";
  }
  if (trend.direction === "damaged" || trend.direction === "fading") {
    return "trend_damaged";
  }
  if (trend.direction === "range") {
    return "range_bound";
  }
  return "base_building";
}

function buildConfidence(params: {
  candles: Candle[];
  pivots: CandleMarketStructurePivots;
  trend: CandleMarketStructureTrend;
  range: CandleMarketStructureRange | null;
  diagnostics: CandleMarketStructureDiagnostic[];
}): CandleMarketStructureConfidence {
  const reasons: string[] = [];
  let score = 0.25;
  const pivotCount = params.pivots.confirmedHighs.length + params.pivots.confirmedLows.length;

  if (params.candles.length >= 24) {
    score += 0.15;
    reasons.push(`${params.candles.length} candles reviewed`);
  }
  if (pivotCount >= 4) {
    score += 0.2;
    reasons.push(`${pivotCount} confirmed pivots`);
  }
  if (params.trend.higherLowCount >= 2) {
    score += 0.18;
    reasons.push(`${params.trend.higherLowCount} higher lows`);
  }
  if (params.trend.lowerHighCount >= 2 || params.trend.lowerLowCount >= 2) {
    score += 0.12;
    reasons.push("structure damage is visible in confirmed pivots");
  }
  if (params.range?.active) {
    score += params.range.quality === "clean" ? 0.18 : 0.1;
    reasons.push(`${params.range.quality} active range`);
  }
  if (params.range?.quality === "choppy") {
    score -= 0.15;
    reasons.push("range is choppy");
  }
  if (params.diagnostics.some((diagnostic) => diagnostic.code === "derived_from_1m")) {
    score -= 0.05;
  }

  const clamped = Math.max(0.05, Math.min(0.95, score));
  return {
    score: Number(clamped.toFixed(2)),
    label: clamped >= 0.72 ? "high" : clamped >= 0.45 ? "medium" : "low",
    reasons: reasons.length > 0 ? reasons : ["limited structure evidence"],
  };
}

function formatPrice(value: number): string {
  if (value >= 10) {
    return value.toFixed(2);
  }
  if (value >= 1) {
    return value.toFixed(2);
  }
  return value.toFixed(4);
}

function buildTraderLine(params: {
  state: CandleMarketStructureState;
  trend: CandleMarketStructureTrend;
  range: CandleMarketStructureRange | null;
  pivotEvent: CandleMarketStructurePivotEvent | null;
}): string | undefined {
  const { state, trend, range, pivotEvent } = params;
  if (state === "insufficient_data") {
    return undefined;
  }
  if (range?.active && state === "range_bound") {
    return `5m structure is range-bound between ${formatPrice(range.low)} support and ${formatPrice(range.high)} resistance; small moves inside that range are lower-quality noise.`;
  }
  if (range?.active && state === "base_building") {
    return `5m structure is building inside the ${formatPrice(range.low)}-${formatPrice(range.high)} range.`;
  }
  if (state === "pressing_range_high" && range) {
    return `5m structure is pressing the range high near ${formatPrice(range.high)} while support sits near ${formatPrice(range.low)}.`;
  }
  if (state === "breakout_holding" && range) {
    return `5m structure is holding above the prior range high near ${formatPrice(range.high)}.`;
  }
  if (state === "higher_lows_intact" || state === "trend_intact") {
    const latestHigherLow = trend.latestHigherLow;
    return latestHigherLow
      ? `5m structure is building higher lows; ${formatPrice(latestHigherLow.price)} is the latest structure low to keep holding.`
      : "5m structure is still holding an upward rhythm.";
  }
  if (state === "pivot_lost" && pivotEvent?.pivot) {
    return `5m structure lost ${formatPrice(pivotEvent.pivot.price)}; a reclaim would help repair the long setup.`;
  }
  if (state === "trend_damaged") {
    return "5m structure is damaged; a cleaner reclaim would improve the setup.";
  }
  if (state === "reclaim_confirmed" && pivotEvent?.pivot) {
    return `5m structure reclaimed ${formatPrice(pivotEvent.pivot.price)}, which helps repair the setup.`;
  }
  if (state === "failed_breakout" && pivotEvent?.pivot) {
    return `5m structure rejected near ${formatPrice(pivotEvent.pivot.price)} and moved back inside the prior area.`;
  }
  return undefined;
}

export function buildCandleMarketStructureContext(
  request: BuildCandleMarketStructureRequest,
): CandleMarketStructureContext {
  const symbol = request.symbol.trim().toUpperCase();
  if (!symbol) {
    throw new Error("symbol is required.");
  }
  const asOfTimestamp = parseTimestamp(request.asOfTimestamp);
  const options = request.options ?? {};
  const leftBars = Math.max(1, options.leftBars ?? DEFAULT_LEFT_BARS);
  const rightBars = Math.max(1, options.rightBars ?? DEFAULT_RIGHT_BARS);
  const minCandles = Math.max(leftBars + rightBars + 2, options.minCandles ?? DEFAULT_MIN_CANDLES);
  const { candles, filteredFutureCount } = sortedUsableCandles(request.candles, asOfTimestamp);
  const diagnostics: CandleMarketStructureDiagnostic[] = [];

  if (filteredFutureCount > 0) {
    diagnostics.push({
      code: "future_candles_filtered",
      severity: "info",
      message: `${filteredFutureCount} future candle(s) were excluded from market-structure context.`,
    });
  }
  if (options.sourceTimeframe === "1m") {
    diagnostics.push({
      code: "derived_from_1m",
      severity: "info",
      message: "1-minute candles were aggregated into 5-minute candles before market-structure analysis.",
    });
  }

  if (candles.length < minCandles) {
    diagnostics.push({
      code: "insufficient_candles",
      severity: "warning",
      message: `At least ${minCandles} 5m candles are needed for market-structure context.`,
    });
    return {
      symbol,
      timeframe: "5m",
      asOfTimestamp: asOfTimestamp ?? candles.at(-1)?.timestamp ?? null,
      state: "insufficient_data",
      confidence: lowConfidence("not enough 5m candles"),
      pivots: emptyPivots(),
      trend: unknownTrend(),
      range: null,
      pivotEvent: null,
      diagnostics,
    };
  }

  const pivots = detectPivots(symbol, candles, leftBars, rightBars);
  if (pivots.confirmedHighs.length + pivots.confirmedLows.length === 0) {
    diagnostics.push({
      code: "no_confirmed_pivots",
      severity: "warning",
      message: "No confirmed 5m swing pivots were found.",
    });
  }
  const trend = deriveTrend(pivots);
  const range = detectRange(candles, pivots, options.rangeLookbackBars ?? DEFAULT_RANGE_LOOKBACK_BARS);
  if (range?.quality === "choppy") {
    diagnostics.push({
      code: "choppy_structure",
      severity: "info",
      message: "Recent 5m range is choppy, so small moves inside it should be treated as lower-quality structure.",
    });
  }
  const currentPrice = request.currentPrice ?? candles.at(-1)!.close;
  const pivotEvent = derivePivotEvent({ candles, pivots, range, currentPrice });
  const state = deriveState({ trend, range, pivotEvent, currentPrice });
  const confidence = buildConfidence({ candles, pivots, trend, range, diagnostics });
  const traderLine = buildTraderLine({ state, trend, range, pivotEvent });

  return {
    symbol,
    timeframe: "5m",
    asOfTimestamp: asOfTimestamp ?? candles.at(-1)!.timestamp,
    state,
    confidence,
    pivots,
    trend,
    range,
    pivotEvent,
    ...(traderLine ? { traderLine } : {}),
    diagnostics,
  };
}
