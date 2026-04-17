import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  CandleFetchService,
  type HistoricalFetchRequest,
  StubHistoricalCandleProvider,
} from "../market-data/candle-fetch-service.js";
import type {
  CandleProviderName,
  CandleProviderResponse,
  CandleTimeframe,
} from "../market-data/candle-types.js";

export type ValidationCandleCacheMode = "off" | "read_write" | "refresh" | "replay";

type CandleFetchClient = {
  getProviderName(): CandleProviderName;
  fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse>;
};

type ValidationCandleCacheEntry = {
  schemaVersion: 1;
  cachedAt: number;
  request: {
    symbol: string;
    timeframe: CandleTimeframe;
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

const CACHE_SCHEMA_VERSION = 1;

function timeframeMs(timeframe: CandleTimeframe): number {
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

  override async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    if (this.mode === "off") {
      return this.delegate.fetchCandles(request);
    }

    const provider = request.preferredProvider ?? this.delegate.getProviderName();
    const cachePath = cachePathForRequest(this.cacheDirectoryPath, request, provider);

    if (this.mode !== "refresh") {
      const cached = await readCacheEntry(cachePath);
      if (cached) {
        return cached.response;
      }

      if (this.mode === "replay") {
        throw new Error(
          `Validation candle cache miss for ${request.symbol.toUpperCase()} ${request.timeframe} (${request.lookbackBars}) at ${normalizeEndTimeMs(request)}.`,
        );
      }
    }

    const response = await this.delegate.fetchCandles(request);
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
    return response;
  }
}
