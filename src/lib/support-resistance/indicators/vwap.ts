import type { Candle } from "../../market-data/candle-types.js";

export type VwapPoint = {
  timestamp: number;
  value: number;
  cumulativeVolume: number;
};

export type VwapOptions = {
  sessionDate?: string;
  typicalPriceSelector?: (candle: Candle) => number;
};

function defaultTypicalPrice(candle: Candle): number {
  return (candle.high + candle.low + candle.close) / 3;
}

function candleUtcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function filterBySessionDate(candles: Candle[], sessionDate?: string): Candle[] {
  if (!sessionDate) {
    return candles;
  }
  return candles.filter((candle) => candleUtcDate(candle.timestamp) === sessionDate);
}

export function calculateVwapSeries(
  candles: Candle[],
  options: VwapOptions = {},
): VwapPoint[] {
  const typicalPriceSelector = options.typicalPriceSelector ?? defaultTypicalPrice;
  const sorted = filterBySessionDate(
    [...candles].sort((left, right) => left.timestamp - right.timestamp),
    options.sessionDate,
  );
  const series: VwapPoint[] = [];
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  for (const candle of sorted) {
    const typicalPrice = typicalPriceSelector(candle);
    if (
      !Number.isFinite(typicalPrice) ||
      !Number.isFinite(candle.volume) ||
      candle.volume <= 0
    ) {
      continue;
    }

    cumulativePriceVolume += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
    if (cumulativeVolume <= 0) {
      continue;
    }

    series.push({
      timestamp: candle.timestamp,
      value: cumulativePriceVolume / cumulativeVolume,
      cumulativeVolume,
    });
  }

  return series;
}

export function calculateLatestVwap(
  candles: Candle[],
  options: VwapOptions = {},
): number | null {
  const series = calculateVwapSeries(candles, options);
  return series.at(-1)?.value ?? null;
}
