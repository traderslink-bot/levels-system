import type { Candle } from "../market-data/candle-types.js";

const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

/** Bounded observed history only: never evidence of an all-time high. */
export function availablePriorHigh(candles: Candle[], asOf: number): number | null {
  if (!Number.isFinite(asOf)) return null;
  const today = day.format(new Date(asOf));
  const prior = candles.filter(bar => Number.isFinite(bar.timestamp) && bar.timestamp <= asOf &&
    day.format(new Date(bar.timestamp)) < today &&
    [bar.open, bar.high, bar.low, bar.close].every(price => Number.isFinite(price) && price > 0) &&
    bar.high >= Math.max(bar.open, bar.low, bar.close) && bar.low <= Math.min(bar.open, bar.close));
  if (new Set(prior.map(bar => day.format(new Date(bar.timestamp)))).size < 20) return null;
  return Math.max(...prior.map(bar => bar.high));
}

export function suppressPriceDiscoveryRefresh(input: {
  automatic: boolean; force: boolean; direction?: "upper" | "lower";
  currentPrice: number; availableHistoricalHigh: number | null;
}): boolean {
  return input.automatic && !input.force && input.direction === "upper" &&
    input.availableHistoricalHigh !== null && Number.isFinite(input.availableHistoricalHigh) &&
    input.availableHistoricalHigh > 0 && input.currentPrice > input.availableHistoricalHigh;
}
