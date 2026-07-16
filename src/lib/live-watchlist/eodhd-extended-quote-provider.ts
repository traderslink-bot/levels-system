import type {
  LiveWatchlistExtendedQuote,
  LiveWatchlistExtendedQuoteProvider,
} from "./live-watchlist-types.js";

export type EodhdExtendedQuoteProviderOptions = {
  apiToken?: string;
  endpointUrl?: string;
  exchangeSuffix?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
  onError?: (error: unknown, symbol: string) => void;
};

type EodhdQuotePayload = {
  data?: unknown;
  error?: unknown;
  message?: unknown;
};

type CacheEntry = {
  quote: LiveWatchlistExtendedQuote | null;
  expiresAt: number;
  inFlight?: Promise<LiveWatchlistExtendedQuote | null>;
};

const DEFAULT_ENDPOINT_URL = "https://eodhd.com/api/us-quote-delayed";
const DEFAULT_EXCHANGE_SUFFIX = "US";
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

function envText(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  return names.map((name) => env[name]?.trim()).find(Boolean);
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeWatchlistSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeEodhdSymbol(symbol: string, exchangeSuffix: string): string {
  const normalized = normalizeWatchlistSymbol(symbol);
  if (!normalized) {
    throw new Error("symbol is required.");
  }
  return normalized.includes(".") ? normalized : `${normalized}.${exchangeSuffix}`;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function millisecondsOrNull(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function secondsOrNull(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function latestEventTime(...values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return valid.length > 0 ? Math.max(...valid) : null;
}

function shouldDisableExtendedQuotes(env: NodeJS.ProcessEnv): boolean {
  const configured = envText(env, "EODHD_EXTENDED_QUOTES", "LEVEL_EODHD_EXTENDED_QUOTES");
  return configured === "0" || configured?.toLowerCase() === "false" || configured?.toLowerCase() === "off";
}

function extractPayloadError(payload: EodhdQuotePayload): string | null {
  const message = payload.error ?? payload.message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

export class EodhdExtendedQuoteProvider implements LiveWatchlistExtendedQuoteProvider {
  private readonly apiToken: string;
  private readonly endpointUrl: string;
  private readonly exchangeSuffix: string;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly options: EodhdExtendedQuoteProviderOptions = {}) {
    if (!options.apiToken) {
      throw new Error("EODHD_API_TOKEN is required to use EODHD extended quote data.");
    }
    this.apiToken = options.apiToken;
    this.endpointUrl = options.endpointUrl ?? DEFAULT_ENDPOINT_URL;
    this.exchangeSuffix = options.exchangeSuffix ?? DEFAULT_EXCHANGE_SUFFIX;
    this.cacheTtlMs = positiveInteger(options.cacheTtlMs, DEFAULT_CACHE_TTL_MS);
    this.timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async getExtendedQuote(symbolInput: string): Promise<LiveWatchlistExtendedQuote | null> {
    const symbol = normalizeWatchlistSymbol(symbolInput);
    if (!symbol) {
      return null;
    }
    const now = this.now();
    const cached = this.cache.get(symbol);
    if (cached && cached.expiresAt > now) {
      return cached.quote;
    }
    if (cached?.inFlight) {
      return cached.inFlight;
    }

    const request = this.fetchQuote(symbol)
      .then((quote) => {
        this.cache.set(symbol, {
          quote,
          expiresAt: this.now() + this.cacheTtlMs,
        });
        return quote;
      })
      .catch((error) => {
        this.options.onError?.(error, symbol);
        this.cache.delete(symbol);
        return null;
      });

    this.cache.set(symbol, {
      quote: cached?.quote ?? null,
      expiresAt: 0,
      inFlight: request,
    });
    return request;
  }

  private async fetchQuote(symbol: string): Promise<LiveWatchlistExtendedQuote | null> {
    const providerSymbol = normalizeEodhdSymbol(symbol, this.exchangeSuffix);
    const url = new URL(this.endpointUrl);
    url.searchParams.set("s", providerSymbol);
    url.searchParams.set("api_token", this.apiToken);
    url.searchParams.set("fmt", "json");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`EODHD extended quote request failed with HTTP ${response.status}.`);
      }
      const payload = (await response.json()) as EodhdQuotePayload;
      const errorMessage = extractPayloadError(payload);
      if (errorMessage) {
        throw new Error(`EODHD returned an error payload: ${errorMessage}`);
      }
      return this.mapPayload(symbol, providerSymbol, payload);
    } finally {
      clearTimeout(timeout);
    }
  }

  private mapPayload(
    symbol: string,
    providerSymbol: string,
    payload: EodhdQuotePayload,
  ): LiveWatchlistExtendedQuote | null {
    if (!payload.data || typeof payload.data !== "object") {
      return null;
    }

    const data = payload.data as Record<string, unknown>;
    const rawQuote = data[providerSymbol] ?? data[Object.keys(data)[0] ?? ""];
    if (!rawQuote || typeof rawQuote !== "object") {
      return null;
    }
    const quote = rawQuote as Record<string, unknown>;
    const bidTime = millisecondsOrNull(quote.bidTime);
    const askTime = millisecondsOrNull(quote.askTime);
    const lastTradeTime = millisecondsOrNull(quote.lastTradeTime);
    const ethTime = millisecondsOrNull(quote.ethTime);
    const snapshotSeconds = secondsOrNull(quote.timestamp);
    const snapshotTimestamp = snapshotSeconds === null ? null : snapshotSeconds * 1000;
    const fetchedAt = this.now();
    const updatedAt = latestEventTime(bidTime, askTime, lastTradeTime, ethTime, snapshotTimestamp) ?? fetchedAt;

    return {
      source: "eodhd_live_v2",
      symbol,
      providerSymbol: textOrNull(quote.symbol) ?? providerSymbol,
      updatedAt,
      fetchedAt,
      name: textOrNull(quote.name),
      exchange: textOrNull(quote.exchange),
      currency: textOrNull(quote.currency),
      open: numberOrNull(quote.open),
      high: numberOrNull(quote.high),
      low: numberOrNull(quote.low),
      lastTradePrice: numberOrNull(quote.lastTradePrice),
      lastTradeSize: numberOrNull(quote.size),
      lastTradeTime,
      bidPrice: numberOrNull(quote.bidPrice),
      bidSize: numberOrNull(quote.bidSize),
      bidTime,
      askPrice: numberOrNull(quote.askPrice),
      askSize: numberOrNull(quote.askSize),
      askTime,
      volume: numberOrNull(quote.volume),
      change: numberOrNull(quote.change),
      changePercent: numberOrNull(quote.changePercent),
      previousClosePrice: numberOrNull(quote.previousClosePrice),
      ethPrice: numberOrNull(quote.ethPrice),
      ethVolume: numberOrNull(quote.ethVolume),
      ethTime,
      marketCap: numberOrNull(quote.marketCap),
      sharesOutstanding: numberOrNull(quote.sharesOutstanding),
      sharesFloat: numberOrNull(quote.sharesFloat),
      timestamp: snapshotTimestamp,
    };
  }
}

export function createEodhdExtendedQuoteProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LiveWatchlistExtendedQuoteProvider | null {
  if (shouldDisableExtendedQuotes(env)) {
    return null;
  }

  const apiToken = envText(env, "EODHD_API_TOKEN", "LEVEL_EODHD_API_TOKEN");
  if (!apiToken) {
    return null;
  }

  return new EodhdExtendedQuoteProvider({
    apiToken,
    endpointUrl: envText(env, "EODHD_EXTENDED_QUOTE_URL", "LEVEL_EODHD_EXTENDED_QUOTE_URL"),
    exchangeSuffix: envText(env, "EODHD_EXCHANGE_SUFFIX", "LEVEL_EODHD_EXCHANGE_SUFFIX"),
    cacheTtlMs: positiveInteger(
      envText(env, "EODHD_EXTENDED_QUOTE_CACHE_TTL_MS", "LEVEL_EODHD_EXTENDED_QUOTE_CACHE_TTL_MS"),
      DEFAULT_CACHE_TTL_MS,
    ),
    timeoutMs: positiveInteger(
      envText(env, "EODHD_EXTENDED_QUOTE_TIMEOUT_MS", "LEVEL_EODHD_EXTENDED_QUOTE_TIMEOUT_MS"),
      DEFAULT_TIMEOUT_MS,
    ),
    onError: (error, symbol) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[EodhdExtendedQuoteProvider] Failed to fetch ${symbol} quote: ${message}`);
    },
  });
}
