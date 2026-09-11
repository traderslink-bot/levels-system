import type { Candle } from "../market-data/candle-types.js";

/** Price observations only: do not choose a price version by reported volume. */
export function unambiguousPriceCandles(candles: readonly Candle[], cutoff: number): Candle[] {
  if (!Number.isFinite(cutoff)) return [];
  const byTime = new Map<number, Candle>();
  const ambiguous = new Set<number>();
  for (const candle of candles) {
    if (!Number.isFinite(candle.timestamp) || candle.timestamp <= 0 || candle.timestamp > cutoff) continue;
    const fields = [candle.open, candle.high, candle.low, candle.close];
    if (!fields.every(value => Number.isFinite(value) && value > 0) ||
      candle.low > Math.min(candle.open, candle.close) || candle.high < Math.max(candle.open, candle.close)) {
      ambiguous.add(candle.timestamp);
      continue;
    }
    const prior = byTime.get(candle.timestamp);
    if (prior && (["open", "high", "low", "close"] as const).some(field => prior[field] !== candle[field])) {
      ambiguous.add(candle.timestamp);
    }
    if (!prior) byTime.set(candle.timestamp, candle);
  }
  return [...byTime.values()].filter(candle => !ambiguous.has(candle.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** Numerical display precision only; candle width never enlarges anchor matching. */
export function observedPriceMatcher(series: readonly (readonly Candle[])[], priorClose: number | null, cutoff: number): (price: number) => boolean {
  const prices = series.flatMap(candles => unambiguousPriceCandles(candles, cutoff)
    .flatMap(candle => [candle.open, candle.high, candle.low, candle.close]));
  if (priorClose !== null && Number.isFinite(priorClose) && priorClose > 0) prices.push(priorClose);
  return price => Number.isFinite(price) && price > 0 && prices.some(observed =>
    Math.abs(observed - price) <= (price < 1 ? 0.00005 : 0.005) + Number.EPSILON);
}
