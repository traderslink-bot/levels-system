import { createHash } from "node:crypto";

import {
  assertLevelQualityReviewCacheFingerprintFactsOnly,
  validateLevelQualityReviewCacheFingerprintSet,
  type LevelQualityReviewCacheFingerprint,
  type LevelQualityReviewCacheFingerprintProvider,
  type LevelQualityReviewCacheFingerprintSet,
  type LevelQualityReviewCacheFingerprintTimeframe,
} from "./level-quality-review-cache-fingerprint.js";

export type LevelQualityReviewCacheFingerprintBuildInput = {
  relativePath: string;
  rawCacheWrapper: string;
  parsedCacheWrapper: unknown;
  provider: LevelQualityReviewCacheFingerprintProvider;
  symbol: string;
  timeframe: LevelQualityReviewCacheFingerprintTimeframe;
  asOfTimestamp?: number;
  includedInLevelEngine?: boolean;
  contextOnly?: boolean;
};

export type LevelQualityReviewCacheFingerprintSetBuildInput = {
  generatedAt?: string;
  provider?: LevelQualityReviewCacheFingerprintProvider;
  fingerprints: LevelQualityReviewCacheFingerprint[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is LevelQualityReviewCacheFingerprintProvider {
  return value === "ibkr" || value === "stub" || value === "twelve_data";
}

function isTimeframe(value: unknown): value is LevelQualityReviewCacheFingerprintTimeframe {
  return value === "5m" || value === "15m" || value === "4h" || value === "daily";
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function timestampFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function hashWrapper(rawCacheWrapper: string): string {
  return createHash("sha256").update(rawCacheWrapper).digest("hex");
}

function extractCandleArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (isRecord(parsed) && Array.isArray(parsed.candles)) {
    return parsed.candles;
  }
  if (isRecord(parsed) && isRecord(parsed.response) && Array.isArray(parsed.response.candles)) {
    return parsed.response.candles;
  }

  return [];
}

function timestampBounds(candles: unknown[]): {
  firstCandleTimestamp?: number;
  lastCandleTimestamp?: number;
} {
  const timestamps = candles
    .map((candle) => (isRecord(candle) ? timestampFrom(candle.timestamp) : undefined))
    .filter((timestamp): timestamp is number => timestamp !== undefined);

  if (timestamps.length === 0) {
    return {};
  }

  return {
    firstCandleTimestamp: Math.min(...timestamps),
    lastCandleTimestamp: Math.max(...timestamps),
  };
}

function firstProvider(
  values: unknown[],
  fallback: LevelQualityReviewCacheFingerprintProvider,
): LevelQualityReviewCacheFingerprintProvider {
  return values.find(isProvider) ?? fallback;
}

function firstTimeframe(
  values: unknown[],
  fallback: LevelQualityReviewCacheFingerprintTimeframe,
): LevelQualityReviewCacheFingerprintTimeframe {
  return values.find(isTimeframe) ?? fallback;
}

function firstString(values: unknown[], fallback: string): string {
  return values.find((value): value is string => typeof value === "string" && value.trim() !== "") ?? fallback;
}

function compactString(value: string): string {
  return value.trim().toUpperCase();
}

export function buildLevelQualityReviewCacheFingerprint(
  input: LevelQualityReviewCacheFingerprintBuildInput,
): LevelQualityReviewCacheFingerprint {
  const parsed = input.parsedCacheWrapper;
  const wrapper = isRecord(parsed) ? parsed : {};
  const request = isRecord(wrapper.request) ? wrapper.request : {};
  const response = isRecord(wrapper.response) ? wrapper.response : {};
  const candles = extractCandleArray(parsed);
  const count = candles.length;
  const bounds = timestampBounds(candles);
  const provider = firstProvider([response.provider, request.provider], input.provider);
  const timeframe = firstTimeframe([response.timeframe, request.timeframe], input.timeframe);
  const symbol = compactString(firstString([response.symbol, request.symbol], input.symbol));
  const actualBarsReturned =
    nonNegativeInteger(response.actualBarsReturned) ??
    nonNegativeInteger(response.returnedBars) ??
    count;
  const requestLookbackBars =
    positiveInteger(request.lookbackBars) ??
    positiveInteger(response.requestedLookbackBars) ??
    Math.max(count, 1);
  const requestEndTimestamp =
    nonNegativeInteger(request.endTimeMs) ??
    nonNegativeInteger(response.requestedEndTimestamp) ??
    bounds.lastCandleTimestamp ??
    input.asOfTimestamp ??
    0;
  const validationIssueCount = Array.isArray(response.validationIssues)
    ? response.validationIssues.length
    : nonNegativeInteger(response.validationIssueCount) ?? 0;
  const contextOnly = timeframe === "15m" ? true : input.contextOnly;
  const includedInLevelEngine = timeframe === "15m"
    ? false
    : input.includedInLevelEngine;
  const fingerprint: LevelQualityReviewCacheFingerprint = {
    schemaVersion: "level-quality-review-cache-fingerprint/v1",
    relativePath: normalizeRelativePath(input.relativePath),
    provider,
    symbol,
    timeframe,
    sha256: hashWrapper(input.rawCacheWrapper),
    wrapperCandleCount: count,
    requestLookbackBars,
    requestEndTimestamp,
    actualBarsReturned,
    validationIssueCount,
    ...bounds,
    ...(input.asOfTimestamp === undefined ? {} : { asOfTimestamp: input.asOfTimestamp }),
    ...(includedInLevelEngine === undefined ? {} : { includedInLevelEngine }),
    ...(contextOnly === undefined ? {} : { contextOnly }),
    safety: {
      rawCandlesIncluded: false,
      rawCacheWrapperPayloadsIncluded: false,
      fullSnapshotsIncluded: false,
      providerCallsMade: false,
      cacheFilesWritten: false,
      fifteenMinuteFedIntoLevelEngine: false,
    },
  };

  assertLevelQualityReviewCacheFingerprintFactsOnly(fingerprint);
  return fingerprint;
}

export function buildLevelQualityReviewCacheFingerprintSet(
  input: LevelQualityReviewCacheFingerprintSetBuildInput,
): LevelQualityReviewCacheFingerprintSet {
  const set: LevelQualityReviewCacheFingerprintSet = {
    schemaVersion: "level-quality-review-cache-fingerprint-set/v1",
    ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    fingerprints: [...input.fingerprints],
  };
  const validation = validateLevelQualityReviewCacheFingerprintSet(set);
  if (!validation.valid) {
    throw new Error(`Invalid level quality review cache fingerprint set: ${validation.errors.join("; ")}`);
  }
  assertLevelQualityReviewCacheFingerprintFactsOnly(set);

  return set;
}
