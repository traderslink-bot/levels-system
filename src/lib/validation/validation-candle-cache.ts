import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  CandleFetchService,
  type HistoricalFetchRequest,
  StubHistoricalCandleProvider,
} from "../market-data/candle-fetch-service.js";
import type {
  CandleFetchTimeframe,
  CandleProviderName,
  CandleProviderResponse,
} from "../market-data/candle-types.js";

export type ValidationCandleCacheMode = "off" | "read_write" | "refresh" | "replay";

type CandleFetchClient = {
  getProviderName(): CandleProviderName;
  fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse>;
};

const CACHE_SCHEMA_VERSION = 3 as const;

type ValidationCandleCacheEntry = {
  schemaVersion: typeof CACHE_SCHEMA_VERSION;
  cachedAt: number;
  request: {
    symbol: string;
    timeframe: CandleFetchTimeframe;
    lookbackBars: number;
    endTimeMs: number;
    provider: CandleProviderName;
  };
  response: CandleProviderResponse;
};

export type ValidationCachedCandleFetchServiceOptions = {
  cacheDirectoryPath: string;
  mode?: ValidationCandleCacheMode;
};

export type ValidationCandleCacheRuntimeInfo = {
  mode: ValidationCandleCacheMode;
  cacheDirectoryPath: string;
  exactHits: number;
  reusableHits: number;
  misses: number;
  writes: number;
};

function timeframeMs(timeframe: CandleFetchTimeframe): number {
  if (timeframe === "1m") {
    return 60 * 1000;
  }

  if (timeframe === "daily") {
    return 24 * 60 * 60 * 1000;
  }

  if (timeframe === "4h") {
    return 4 * 60 * 60 * 1000;
  }

  return 5 * 60 * 1000;
}

function normalizeEndTimeMs(request: HistoricalFetchRequest): number {
  const raw = request.endTimeMs ?? Date.now();
  const interval = timeframeMs(request.timeframe);
  return Math.floor(raw / interval) * interval;
}

function cachePathForRequest(
  cacheDirectoryPath: string,
  request: HistoricalFetchRequest,
  provider: CandleProviderName,
): string {
  const symbol = request.symbol.trim().toUpperCase();
  const timeframe = request.timeframe;
  const lookbackBars = request.lookbackBars;
  const endTimeMs = normalizeEndTimeMs(request);

  return join(
    cacheDirectoryPath,
    provider,
    symbol,
    timeframe,
    `${lookbackBars}-${endTimeMs}.json`,
  );
}

async function readCacheEntry(path: string): Promise<ValidationCandleCacheEntry | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as ValidationCandleCacheEntry;

    if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) {
      return null;
    }

    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    return null;
  }
}

async function findNearestReusableCachePath(
  cacheDirectoryPath: string,
  request: HistoricalFetchRequest,
  provider: CandleProviderName,
  mode: ValidationCandleCacheMode,
): Promise<string | null> {
  const directoryPath = join(
    cacheDirectoryPath,
    provider,
    request.symbol.trim().toUpperCase(),
    request.timeframe,
  );
  const requestedEndTimeMs = normalizeEndTimeMs(request);
  const maxFallbackGapMs =
    mode === "replay" ? Number.POSITIVE_INFINITY : timeframeMs(request.timeframe);

  try {
    const filenames = await readdir(directoryPath);
    let bestCandidate:
      | {
          endTimeMs: number;
          lookbackBars: number;
        }
      | null = null;

    for (const filename of filenames) {
      if (!filename.endsWith(".json")) {
        continue;
      }

      const separatorIndex = filename.indexOf("-");
      if (separatorIndex <= 0) {
        continue;
      }

      const lookbackRaw = filename.slice(0, separatorIndex);
      const endTimeRaw = filename.slice(separatorIndex + 1, -".json".length);
      const candidateLookbackBars = Number(lookbackRaw);
      const candidateEndTimeMs = Number(endTimeRaw);
      if (!Number.isFinite(candidateLookbackBars) || !Number.isFinite(candidateEndTimeMs)) {
        continue;
      }

      if (candidateLookbackBars < request.lookbackBars) {
        continue;
      }

      const gapMs = requestedEndTimeMs - candidateEndTimeMs;
      if (gapMs < 0 || gapMs > maxFallbackGapMs) {
        continue;
      }

      if (
        bestCandidate === null ||
        candidateEndTimeMs > bestCandidate.endTimeMs ||
        (candidateEndTimeMs === bestCandidate.endTimeMs &&
          candidateLookbackBars < bestCandidate.lookbackBars)
      ) {
        bestCandidate = {
          endTimeMs: candidateEndTimeMs,
          lookbackBars: candidateLookbackBars,
        };
      }
    }

    if (bestCandidate === null) {
      return null;
    }

    return join(directoryPath, `${bestCandidate.lookbackBars}-${bestCandidate.endTimeMs}.json`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    return null;
  }
}

function withRequestMetadata(
  response: CandleProviderResponse,
  request: HistoricalFetchRequest,
): CandleProviderResponse {
  const requestedEndTimestamp = normalizeEndTimeMs(request);
  const requestedStartTimestamp =
    requestedEndTimestamp - request.lookbackBars * timeframeMs(request.timeframe);

  return {
    ...response,
    requestedLookbackBars: request.lookbackBars,
    requestedStartTimestamp,
    requestedEndTimestamp,
  };
}

async function writeCacheEntry(path: string, entry: ValidationCandleCacheEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
}

export function resolveValidationCandleCacheMode(
  rawValue: string | undefined,
): ValidationCandleCacheMode {
  const normalized = rawValue?.trim().toLowerCase();

  if (
    normalized === "off" ||
    normalized === "read_write" ||
    normalized === "refresh" ||
    normalized === "replay"
  ) {
    return normalized;
  }

  return "read_write";
}

export class ValidationCachedCandleFetchService extends CandleFetchService {
  private readonly mode: ValidationCandleCacheMode;
  private exactHits = 0;
  private reusableHits = 0;
  private misses = 0;
  private writes = 0;

  constructor(
    private readonly delegate: CandleFetchClient,
    options: ValidationCachedCandleFetchServiceOptions,
  ) {
    super(new StubHistoricalCandleProvider());
    this.mode = options.mode ?? "read_write";
    this.cacheDirectoryPath = options.cacheDirectoryPath;
  }

  readonly cacheDirectoryPath: string;

  override getProviderName(): CandleProviderName {
    return this.delegate.getProviderName();
  }

  getCacheRuntimeInfo(): ValidationCandleCacheRuntimeInfo {
    return {
      mode: this.mode,
      cacheDirectoryPath: this.cacheDirectoryPath,
      exactHits: this.exactHits,
      reusableHits: this.reusableHits,
      misses: this.misses,
      writes: this.writes,
    };
  }

  override async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    if (this.mode === "off") {
      return this.delegate.fetchCandles(request);
    }

    const provider = request.preferredProvider ?? this.delegate.getProviderName();
    const cachePath = cachePathForRequest(this.cacheDirectoryPath, request, provider);

    if (this.mode !== "refresh") {
      const cached = await readCacheEntry(cachePath);
      if (cached) {
        this.exactHits += 1;
        return withRequestMetadata(cached.response, request);
      }

      const nearbyCachePath = await findNearestReusableCachePath(
        this.cacheDirectoryPath,
        request,
        provider,
        this.mode,
      );
      if (nearbyCachePath) {
        const nearbyCached = await readCacheEntry(nearbyCachePath);
        if (nearbyCached) {
          this.reusableHits += 1;
          return withRequestMetadata(nearbyCached.response, request);
        }
      }

      if (this.mode === "replay") {
        this.misses += 1;
        throw new Error(
          `Validation candle cache miss for ${request.symbol.toUpperCase()} ${request.timeframe} (${request.lookbackBars}) at ${normalizeEndTimeMs(request)}.`,
        );
      }
    }

    this.misses += 1;
    const response = withRequestMetadata(await this.delegate.fetchCandles(request), request);
    const cacheEntry: ValidationCandleCacheEntry = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      cachedAt: Date.now(),
      request: {
        symbol: request.symbol.trim().toUpperCase(),
        timeframe: request.timeframe,
        lookbackBars: request.lookbackBars,
        endTimeMs: normalizeEndTimeMs(request),
        provider,
      },
      response,
    };
    await writeCacheEntry(cachePath, cacheEntry);
    this.writes += 1;
    return response;
  }
}
