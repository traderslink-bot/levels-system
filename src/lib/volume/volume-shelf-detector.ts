import type { Candle } from "../market-data/candle-types.js";
import {
  filterCandlesByCloseAsOf,
  type CandleAsOfFilterDiagnostic,
} from "../market-data/candle-as-of-filter.js";

export type VolumeShelfRole =
  | "unknown"
  | "support"
  | "resistance"
  | "chop_zone"
  | "magnet";

export type VolumeShelf = {
  id: string;
  zoneLow: number;
  zoneHigh: number;
  representativePrice: number;
  totalVolume: number;
  dollarVolume: number;
  percentOfWindowVolume: number;
  touchCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  shelfRole: VolumeShelfRole;
  confidence: number;
  reason: string;
};

export type VolumeShelfDetectorDiagnosticCode =
  | "future_candles_filtered"
  | "partial_candles_filtered"
  | "no_closed_candles"
  | "zero_window_volume";

export type VolumeShelfDetectorDiagnostic = {
  code: VolumeShelfDetectorDiagnosticCode;
  severity: "info" | "warning";
  message: string;
  excludedCount?: number;
};

export type DetectVolumeShelvesRequest = {
  symbol: string;
  asOfTimestamp: number;
  candles5m: Candle[];
  currentPrice?: number;
  bucketWidthPercent?: number;
  minimumBucketWidth?: number;
  minShelfPercentOfWindowVolume?: number;
  maxShelves?: number;
};

export type DetectVolumeShelvesResult = {
  symbol: string;
  asOfTimestamp: number;
  shelves: VolumeShelf[];
  diagnostics: VolumeShelfDetectorDiagnostic[];
  filteredCandleCount: number;
  totalWindowVolume: number;
};

type ShelfBucket = {
  key: number;
  zoneLow: number;
  zoneHigh: number;
  totalVolume: number;
  dollarVolume: number;
  weightedPriceVolume: number;
  touchCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  candles: Candle[];
};

const DEFAULT_BUCKET_WIDTH_PERCENT = 1;
const DEFAULT_MINIMUM_BUCKET_WIDTH = 0.01;
const DEFAULT_MIN_SHELF_PERCENT_OF_WINDOW_VOLUME = 10;
const DEFAULT_MAX_SHELVES = 5;

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function convertFilterDiagnostic(
  diagnostic: CandleAsOfFilterDiagnostic,
): VolumeShelfDetectorDiagnostic {
  return {
    code: diagnostic.code,
    severity: "info",
    message: diagnostic.message,
    excludedCount: diagnostic.excludedCount,
  };
}

function typicalPrice(candle: Candle): number {
  return (candle.high + candle.low + candle.close) / 3;
}

function deriveReferencePrice(request: DetectVolumeShelvesRequest, candles: Candle[]): number {
  const fallbackPrice = candles.at(-1)?.close ?? 1;
  const price = request.currentPrice ?? fallbackPrice;
  return Number.isFinite(price) && price > 0 ? price : Math.max(fallbackPrice, 1);
}

function deriveBucketWidth(request: DetectVolumeShelvesRequest, candles: Candle[]): number {
  const referencePrice = deriveReferencePrice(request, candles);
  const bucketWidthPercent = Math.max(
    0.1,
    request.bucketWidthPercent ?? DEFAULT_BUCKET_WIDTH_PERCENT,
  );
  const minimumBucketWidth = Math.max(
    0.0001,
    request.minimumBucketWidth ?? DEFAULT_MINIMUM_BUCKET_WIDTH,
  );

  return Math.max(referencePrice * (bucketWidthPercent / 100), minimumBucketWidth);
}

function getOrCreateBucket(buckets: Map<number, ShelfBucket>, key: number, bucketWidth: number): ShelfBucket {
  const existing = buckets.get(key);
  if (existing) {
    return existing;
  }

  const zoneLow = key * bucketWidth;
  const bucket: ShelfBucket = {
    key,
    zoneLow,
    zoneHigh: zoneLow + bucketWidth,
    totalVolume: 0,
    dollarVolume: 0,
    weightedPriceVolume: 0,
    touchCount: 0,
    firstTimestamp: Number.POSITIVE_INFINITY,
    lastTimestamp: Number.NEGATIVE_INFINITY,
    candles: [],
  };
  buckets.set(key, bucket);
  return bucket;
}

function bucketCandles(candles: Candle[], bucketWidth: number): ShelfBucket[] {
  const buckets = new Map<number, ShelfBucket>();

  for (const candle of candles) {
    const price = typicalPrice(candle);
    const key = Math.floor(price / bucketWidth);
    const bucket = getOrCreateBucket(buckets, key, bucketWidth);

    bucket.totalVolume += candle.volume;
    bucket.dollarVolume += price * candle.volume;
    bucket.weightedPriceVolume += price * candle.volume;
    bucket.touchCount += 1;
    bucket.firstTimestamp = Math.min(bucket.firstTimestamp, candle.timestamp);
    bucket.lastTimestamp = Math.max(bucket.lastTimestamp, candle.timestamp);
    bucket.candles.push(candle);
  }

  return [...buckets.values()];
}

function bucketRangesOverlap(left: VolumeShelf, right: VolumeShelf): boolean {
  return left.zoneLow < right.zoneHigh && right.zoneLow < left.zoneHigh;
}

function classifyShelfRole(
  bucket: ShelfBucket,
  representativePrice: number,
  percentOfWindowVolume: number,
  currentPrice: number | undefined,
): VolumeShelfRole {
  const crossThroughCount = bucket.candles.filter(
    (candle) => candle.low <= bucket.zoneLow && candle.high >= bucket.zoneHigh,
  ).length;
  const closeAboveCount = bucket.candles.filter((candle) => candle.close > bucket.zoneHigh).length;
  const closeBelowCount = bucket.candles.filter((candle) => candle.close < bucket.zoneLow).length;

  if (crossThroughCount >= 3 && closeAboveCount > 0 && closeBelowCount > 0) {
    return "chop_zone";
  }

  if (currentPrice !== undefined && Number.isFinite(currentPrice) && currentPrice > 0) {
    const distanceFromCurrent = Math.abs(currentPrice - representativePrice) / currentPrice;
    if (percentOfWindowVolume >= 20 && distanceFromCurrent <= 0.01) {
      return "magnet";
    }

    const closesMostlyAbove = closeAboveCount >= Math.ceil(bucket.touchCount * 0.75);
    const closesMostlyBelow = closeBelowCount >= Math.ceil(bucket.touchCount * 0.75);
    if (currentPrice > bucket.zoneHigh && bucket.touchCount >= 2 && closesMostlyAbove) {
      return "support";
    }
    if (currentPrice < bucket.zoneLow && bucket.touchCount >= 2 && closesMostlyBelow) {
      return "resistance";
    }
  }

  return "unknown";
}

function shelfConfidence(percentOfWindowVolume: number, touchCount: number): number {
  return round(clamp(0.35 + percentOfWindowVolume / 200 + Math.min(touchCount, 5) * 0.03, 0.35, 0.95));
}

function shelfReason(shelf: Omit<VolumeShelf, "reason" | "id">): string {
  const percent = shelf.percentOfWindowVolume.toFixed(4);
  return `High activity shelf with ${percent}% of closed-window volume across ${shelf.touchCount} candle(s).`;
}

function toShelf(
  symbol: string,
  bucket: ShelfBucket,
  totalWindowVolume: number,
  currentPrice: number | undefined,
): VolumeShelf {
  const representativePrice =
    bucket.totalVolume > 0
      ? bucket.weightedPriceVolume / bucket.totalVolume
      : (bucket.zoneLow + bucket.zoneHigh) / 2;
  const percentOfWindowVolume = (bucket.totalVolume / totalWindowVolume) * 100;
  const shelfWithoutIdAndReason = {
    zoneLow: round(bucket.zoneLow),
    zoneHigh: round(bucket.zoneHigh),
    representativePrice: round(representativePrice),
    totalVolume: round(bucket.totalVolume, 0),
    dollarVolume: round(bucket.dollarVolume, 2),
    percentOfWindowVolume: round(percentOfWindowVolume),
    touchCount: bucket.touchCount,
    firstTimestamp: bucket.firstTimestamp,
    lastTimestamp: bucket.lastTimestamp,
    shelfRole: classifyShelfRole(bucket, representativePrice, percentOfWindowVolume, currentPrice),
    confidence: shelfConfidence(percentOfWindowVolume, bucket.touchCount),
  };

  return {
    id: `${symbol.toUpperCase()}-volume-shelf-${round(bucket.zoneLow)}-${round(bucket.zoneHigh)}`,
    ...shelfWithoutIdAndReason,
    reason: shelfReason(shelfWithoutIdAndReason),
  };
}

function selectNonOverlappingShelves(
  shelves: VolumeShelf[],
  maxShelves: number,
): VolumeShelf[] {
  const selected: VolumeShelf[] = [];

  for (const shelf of shelves) {
    if (selected.some((existing) => bucketRangesOverlap(existing, shelf))) {
      continue;
    }
    selected.push(shelf);
    if (selected.length >= maxShelves) {
      break;
    }
  }

  return selected;
}

export function detectVolumeShelves(request: DetectVolumeShelvesRequest): DetectVolumeShelvesResult {
  const filtered = filterCandlesByCloseAsOf({
    candles: request.candles5m,
    timeframe: "5m",
    asOfTimestamp: request.asOfTimestamp,
  });
  const diagnostics = filtered.diagnostics.map(convertFilterDiagnostic);
  const candles = filtered.candles;
  const totalWindowVolume = candles.reduce((sum, candle) => sum + candle.volume, 0);

  if (candles.length === 0) {
    diagnostics.push({
      code: "no_closed_candles",
      severity: "warning",
      message: "No closed 5m candles were available for volume shelf detection as of the requested timestamp.",
    });
  }

  if (totalWindowVolume <= 0) {
    diagnostics.push({
      code: "zero_window_volume",
      severity: "warning",
      message: "Volume shelves were not computed because the closed candle window has zero volume.",
    });
  }

  if (candles.length === 0 || totalWindowVolume <= 0) {
    return {
      symbol: request.symbol.toUpperCase(),
      asOfTimestamp: request.asOfTimestamp,
      shelves: [],
      diagnostics,
      filteredCandleCount: candles.length,
      totalWindowVolume: round(totalWindowVolume, 0),
    };
  }

  const bucketWidth = deriveBucketWidth(request, candles);
  const minShelfPercentOfWindowVolume = Math.max(
    0,
    request.minShelfPercentOfWindowVolume ?? DEFAULT_MIN_SHELF_PERCENT_OF_WINDOW_VOLUME,
  );
  const maxShelves = Math.max(1, Math.floor(request.maxShelves ?? DEFAULT_MAX_SHELVES));
  const shelves = bucketCandles(candles, bucketWidth)
    .map((bucket) => toShelf(request.symbol, bucket, totalWindowVolume, request.currentPrice))
    .filter((shelf) => shelf.percentOfWindowVolume >= minShelfPercentOfWindowVolume)
    .sort((left, right) => {
      if (right.percentOfWindowVolume !== left.percentOfWindowVolume) {
        return right.percentOfWindowVolume - left.percentOfWindowVolume;
      }
      if (right.totalVolume !== left.totalVolume) {
        return right.totalVolume - left.totalVolume;
      }
      return left.representativePrice - right.representativePrice;
    });

  return {
    symbol: request.symbol.toUpperCase(),
    asOfTimestamp: request.asOfTimestamp,
    shelves: selectNonOverlappingShelves(shelves, maxShelves),
    diagnostics,
    filteredCandleCount: candles.length,
    totalWindowVolume: round(totalWindowVolume, 0),
  };
}
