import type { Candle } from "../../market-data/candle-types.js";

export type EmaPoint = {
  timestamp: number;
  value: number;
};

export type EmaOptions = {
  priceSelector?: (candle: Candle) => number;
};

function assertValidPeriod(period: number): void {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error("EMA period must be a positive integer.");
  }
}

function defaultPriceSelector(candle: Candle): number {
  return candle.close;
}

export function calculateEmaSeries(
  candles: Candle[],
  period: number,
  options: EmaOptions = {},
): EmaPoint[] {
  assertValidPeriod(period);
  const priceSelector = options.priceSelector ?? defaultPriceSelector;
  const sorted = [...candles].sort((left, right) => left.timestamp - right.timestamp);
  const prices = sorted.map((candle) => priceSelector(candle));

  if (prices.length < period || prices.some((price) => !Number.isFinite(price))) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  const seed = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
  const series: EmaPoint[] = [
    {
      timestamp: sorted[period - 1]!.timestamp,
      value: seed,
    },
  ];

  let previous = seed;
  for (let index = period; index < sorted.length; index += 1) {
    const value = prices[index]! * multiplier + previous * (1 - multiplier);
    previous = value;
    series.push({
      timestamp: sorted[index]!.timestamp,
      value,
    });
  }

  return series;
}

export function calculateLatestEma(
  candles: Candle[],
  period: number,
  options: EmaOptions = {},
): number | null {
  const series = calculateEmaSeries(candles, period, options);
  return series.at(-1)?.value ?? null;
}
