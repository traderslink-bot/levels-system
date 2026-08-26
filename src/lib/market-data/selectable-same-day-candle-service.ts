import type { CandleProviderResponse } from "./candle-types.js";
import { finalizeCandleProviderResponse } from "./candle-quality.js";
import type { CandleFetchService, HistoricalFetchRequest } from "./candle-fetch-service.js";
import type { CoordinatedCandleFetchDiagnostics } from "./coordinated-candle-fetch-service.js";
import type {
  MoomooAiReadCandleLoader,
  MoomooAiReadCandleWindow,
} from "./platform-moomoo-ai-read-candle-loader.js";

export const SAME_DAY_CANDLE_PROVIDER_OPTIONS = ["yahoo", "moomoo"] as const;
export type SameDayCandleProviderName = (typeof SAME_DAY_CANDLE_PROVIDER_OPTIONS)[number];

type SameDayYahooService = Pick<CandleFetchService, "fetchCandles" | "getProviderName"> & {
  getDiagnostics?: () => CoordinatedCandleFetchDiagnostics;
};

export type SameDayCandleProviderHealth = {
  selectedProvider: SameDayCandleProviderName;
  available: boolean;
  status: "ready" | "unavailable" | "stale";
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  yahooCoordinator: CoordinatedCandleFetchDiagnostics | null;
};

export class SelectableSameDayCandleService {
  private selectedProvider: SameDayCandleProviderName;
  private lastAttemptAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastError: string | null = null;
  private readonly moomooCache = new Map<string, {
    storedAt: number;
    endTimeMs: number;
    window: MoomooAiReadCandleWindow;
  }>();
  private readonly moomooInFlight = new Map<string, Promise<MoomooAiReadCandleWindow>>();

  constructor(
    selectedProvider: SameDayCandleProviderName,
    private readonly yahooService: SameDayYahooService,
    private readonly moomooLoader: MoomooAiReadCandleLoader | null,
    private readonly now: () => number = Date.now,
  ) {
    this.selectedProvider = selectedProvider;
  }

  getProviderName(): SameDayCandleProviderName {
    return this.selectedProvider;
  }

  setProvider(provider: SameDayCandleProviderName): void {
    this.selectedProvider = provider;
  }

  getDiagnostics(): SameDayCandleProviderHealth {
    const available = this.selectedProvider === "yahoo" || this.moomooLoader !== null;
    return {
      selectedProvider: this.selectedProvider,
      available,
      status: !available
        ? "unavailable"
        : this.lastErrorAt !== null && (this.lastSuccessAt === null || this.lastErrorAt > this.lastSuccessAt)
          ? "stale"
          : "ready",
      lastAttemptAt: this.lastAttemptAt,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      yahooCoordinator: this.yahooService.getDiagnostics?.() ?? null,
    };
  }

  async fetchCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    this.lastAttemptAt = this.now();
    try {
      const result = this.selectedProvider === "yahoo"
        ? await this.yahooService.fetchCandles({ ...request, preferredProvider: "yahoo" })
        : await this.fetchMoomooCandles(request);
      this.lastSuccessAt = this.now();
      this.lastError = null;
      return result;
    } catch (error) {
      this.lastErrorAt = this.now();
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private async fetchMoomooCandles(request: HistoricalFetchRequest): Promise<CandleProviderResponse> {
    if (!this.moomooLoader) {
      throw new Error("Moomoo same-day candles are unavailable because the secure Platform bridge is not configured.");
    }
    if (request.timeframe !== "1m" && request.timeframe !== "5m") {
      throw new Error(`Moomoo same-day candles do not support ${request.timeframe}.`);
    }
    const requestedEndTimestamp = Math.min(request.endTimeMs ?? this.now(), this.now());
    const symbol = request.symbol.trim().toUpperCase();
    const cached = this.moomooCache.get(symbol);
    const window = cached && this.now() - cached.storedAt < 55_000 && cached.endTimeMs >= requestedEndTimestamp
      ? cached.window
      : await this.loadMoomooWindow(symbol, requestedEndTimestamp);
    const source = request.timeframe === "1m"
      ? window.oneMinuteCandles
      : window.fiveMinuteCandles;
    const candles = source.slice(-request.lookbackBars);
    const intervalMs = request.timeframe === "1m" ? 60_000 : 300_000;
    return finalizeCandleProviderResponse({
      provider: "moomoo",
      symbol,
      timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars,
      candles: [...candles],
      fetchStartTimestamp: this.lastAttemptAt ?? requestedEndTimestamp,
      fetchEndTimestamp: this.now(),
      requestedStartTimestamp: requestedEndTimestamp - request.lookbackBars * intervalMs,
      requestedEndTimestamp,
      sessionMetadataAvailable: true,
      providerMetadata: { source: "platform_moomoo_open_api" },
    });
  }

  private async loadMoomooWindow(
    symbol: string,
    endTimeMs: number,
  ): Promise<MoomooAiReadCandleWindow> {
    const pending = this.moomooInFlight.get(symbol);
    if (pending) return pending;
    const request = this.moomooLoader!({ symbol, asOfTimeMs: endTimeMs })
      .then((window) => {
        this.moomooCache.set(symbol, { storedAt: this.now(), endTimeMs, window });
        return window;
      })
      .finally(() => {
        this.moomooInFlight.delete(symbol);
      });
    this.moomooInFlight.set(symbol, request);
    return request;
  }
}
