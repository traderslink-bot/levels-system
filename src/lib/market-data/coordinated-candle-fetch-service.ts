import type { CandleProviderResponse } from "./candle-types.js";
import type { CandleFetchService, HistoricalFetchRequest } from "./candle-fetch-service.js";

type CandleFetcher = Pick<CandleFetchService, "fetchCandles" | "getProviderName">;

export type CoordinatedCandleFetchDiagnostics = {
  provider: string;
  requestCount: number;
  cacheHitCount: number;
  inFlightDeduplicationCount: number;
  lastRequestAt: number | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  backoffUntil: number | null;
  cacheEntryCount: number;
};

export type CoordinatedCandleFetchServiceOptions = {
  cacheTtlMs?: number;
  minimumRequestSpacingMs?: number;
  errorBackoffMs?: number;
  now?: () => number;
};

function requestKey(request: HistoricalFetchRequest): string {
  return [
    request.symbol.trim().toUpperCase(),
    request.timeframe,
    request.lookbackBars,
    request.preferredProvider ?? "",
  ].join(":");
}

export class CoordinatedCandleFetchService implements CandleFetcher {
  private readonly cacheTtlMs: number;
  private readonly minimumRequestSpacingMs: number;
  private readonly errorBackoffMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { storedAt: number; response: CandleProviderResponse }>();
  private readonly inFlight = new Map<string, Promise<CandleProviderResponse>>();
  private requestQueue: Promise<void> = Promise.resolve();
  private requestCount = 0;
  private cacheHitCount = 0;
  private inFlightDeduplicationCount = 0;
  private lastRequestAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastError: string | null = null;
  private backoffUntil: number | null = null;

  constructor(
    private readonly service: CandleFetcher,
    options: CoordinatedCandleFetchServiceOptions = {},
  ) {
    this.cacheTtlMs = Math.max(1_000, options.cacheTtlMs ?? 55_000);
    this.minimumRequestSpacingMs = Math.max(0, options.minimumRequestSpacingMs ?? 250);
    this.errorBackoffMs = Math.max(1_000, options.errorBackoffMs ?? 60_000);
    this.now = options.now ?? Date.now;
  }

  getProviderName() {
    return this.service.getProviderName();
  }

  getDiagnostics(): CoordinatedCandleFetchDiagnostics {
    return {
      provider: this.getProviderName(),
      requestCount: this.requestCount,
      cacheHitCount: this.cacheHitCount,
      inFlightDeduplicationCount: this.inFlightDeduplicationCount,
      lastRequestAt: this.lastRequestAt,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      backoffUntil: this.backoffUntil,
      cacheEntryCount: this.cache.size,
    };
  }

  async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    const key = requestKey(request);
    const now = this.now();
    const cached = this.cache.get(key);
    if (cached && now - cached.storedAt < this.cacheTtlMs) {
      this.cacheHitCount += 1;
      return cached.response;
    }
    const pending = this.inFlight.get(key);
    if (pending) {
      this.inFlightDeduplicationCount += 1;
      return pending;
    }
    if (this.backoffUntil !== null && now < this.backoffUntil) {
      if (cached) {
        this.cacheHitCount += 1;
        return cached.response;
      }
      throw new Error(`Yahoo candle coordinator is in backoff until ${new Date(this.backoffUntil).toISOString()}.`);
    }

    const fetchPromise = this.enqueueRequest(request)
      .then((response) => {
        this.cache.set(key, { storedAt: this.now(), response });
        this.lastSuccessAt = this.now();
        this.lastError = null;
        this.backoffUntil = null;
        return response;
      })
      .catch((error) => {
        this.lastErrorAt = this.now();
        this.lastError = error instanceof Error ? error.message : String(error);
        this.backoffUntil = this.lastErrorAt + this.errorBackoffMs;
        throw error;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, fetchPromise);
    return fetchPromise;
  }

  private async enqueueRequest(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    let releaseQueue!: () => void;
    const previous = this.requestQueue;
    this.requestQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    await previous;
    try {
      const waitMs = this.lastRequestAt === null
        ? 0
        : Math.max(0, this.minimumRequestSpacingMs - (this.now() - this.lastRequestAt));
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      this.lastRequestAt = this.now();
      this.requestCount += 1;
      return await this.service.fetchCandles(request);
    } finally {
      releaseQueue();
    }
  }
}
