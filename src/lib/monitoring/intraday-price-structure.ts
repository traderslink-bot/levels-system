import type { IntradayPriceStructureContext, LivePriceUpdate } from "./monitoring-types.js";

type PriceBucket = {
  start: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

const DEFAULT_BUCKET_MS = 5 * 60 * 1000;
const MAX_BUCKETS = 12;

function bucketStart(timestamp: number, bucketMs: number): number {
  return Math.floor(timestamp / bucketMs) * bucketMs;
}

function rangePct(low: number, high: number): number {
  return (high - low) / Math.max(low, 0.0001);
}

function countHigherLows(buckets: PriceBucket[]): number {
  let count = 0;
  for (let index = 1; index < buckets.length; index += 1) {
    if (buckets[index]!.low > buckets[index - 1]!.low) {
      count += 1;
    }
  }
  return count;
}

function countLowerHighs(buckets: PriceBucket[]): number {
  let count = 0;
  for (let index = 1; index < buckets.length; index += 1) {
    if (buckets[index]!.high < buckets[index - 1]!.high) {
      count += 1;
    }
  }
  return count;
}

function deriveDirection(buckets: PriceBucket[]): IntradayPriceStructureContext["direction"] {
  if (buckets.length < 3) {
    return "unknown";
  }
  const higherLows = countHigherLows(buckets.slice(-4));
  const lowerHighs = countLowerHighs(buckets.slice(-4));
  if (higherLows >= 2 && higherLows > lowerHighs) {
    return "building";
  }
  if (lowerHighs >= 2 && lowerHighs > higherLows) {
    return "fading";
  }
  return "flat";
}

function buildContext(buckets: PriceBucket[], bucketMs: number): IntradayPriceStructureContext | undefined {
  if (buckets.length < 2) {
    return undefined;
  }
  const recent = buckets.slice(-6);
  const baseLow = Math.min(...recent.map((bucket) => bucket.low));
  const baseHigh = Math.max(...recent.map((bucket) => bucket.high));
  const lastClose = recent.at(-1)!.close;

  return {
    bucketMs,
    bucketCount: recent.length,
    baseLow,
    baseHigh,
    lastClose,
    rangePct: Number(rangePct(baseLow, baseHigh).toFixed(4)),
    higherLowCount: countHigherLows(recent),
    lowerHighCount: countLowerHighs(recent),
    direction: deriveDirection(recent),
  };
}

export class IntradayPriceStructureTracker {
  private readonly bucketsBySymbol = new Map<string, PriceBucket[]>();

  constructor(private readonly bucketMs: number = DEFAULT_BUCKET_MS) {}

  update(update: LivePriceUpdate): IntradayPriceStructureContext | undefined {
    const symbol = update.symbol.toUpperCase();
    const start = bucketStart(update.timestamp, this.bucketMs);
    const buckets = this.bucketsBySymbol.get(symbol) ?? [];
    const last = buckets.at(-1);

    if (last && last.start === start) {
      last.high = Math.max(last.high, update.lastPrice);
      last.low = Math.min(last.low, update.lastPrice);
      last.close = update.lastPrice;
    } else {
      buckets.push({
        start,
        open: update.lastPrice,
        high: update.lastPrice,
        low: update.lastPrice,
        close: update.lastPrice,
      });
      while (buckets.length > MAX_BUCKETS) {
        buckets.shift();
      }
    }

    this.bucketsBySymbol.set(symbol, buckets);
    return buildContext(buckets, this.bucketMs);
  }

  reset(symbol: string): void {
    this.bucketsBySymbol.delete(symbol.toUpperCase());
  }
}
