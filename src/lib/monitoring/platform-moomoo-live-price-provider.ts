import { YahooClient, type YahooStockQuote } from "../stock-context/yahoo-client.js";
import type { LivePriceListener, LivePriceProvider } from "./live-price-types.js";
import type { WatchlistEntry } from "./monitoring-types.js";

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_SYMBOLS = 100;
const YAHOO_FALLBACK_MAX_AGE_MS = 60_000;
const YAHOO_FALLBACK_CONCURRENCY = 3;
const NEW_YORK_TIME_ZONE = "America/New_York";

export type MoomooLivePriceSession = "premarket" | "regular" | "after_hours" | "overnight";

type YahooLivePriceClient = Pick<YahooClient, "getChartQuote">;

type LivePriceSample = Readonly<{
  price: number;
  timestamp: number;
}>;

export type PlatformMoomooLivePriceProviderOptions = {
  endpointUrl?: string;
  publisherToken?: string;
  maxSymbols?: number;
  pollIntervalMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  yahooClient?: YahooLivePriceClient;
};

type RemoteMoomooQuote = Readonly<{
  symbol?: unknown;
  lastPrice?: unknown;
  preMarketPrice?: unknown;
  afterMarketPrice?: unknown;
  overnightPrice?: unknown;
}>;

type RemoteMoomooQuoteResponse = Readonly<{
  status?: unknown;
  provider?: unknown;
  quotes?: unknown;
}>;

type MoomooQuote = Readonly<{
  symbol: string;
  lastPrice: number | null;
  preMarketPrice: number | null;
  afterMarketPrice: number | null;
  overnightPrice: number | null;
}>;

function positiveNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function moomooQuoteUrl(ingestUrl: string): URL | null {
  try {
    const url = new URL(ingestUrl);
    if (!url.pathname.endsWith("/ingest")) {
      return null;
    }
    url.pathname = `${url.pathname.slice(0, -"/ingest".length)}/moomoo-quote`;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function validEndpointUrl(value: string | undefined): URL | null {
  if (!value?.trim()) {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function newYorkMinuteOfDay(now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NEW_YORK_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Unable to resolve the New York live-price session.");
  }
  return hour * 60 + minute;
}

export function resolveMoomooLivePriceSession(now = Date.now()): MoomooLivePriceSession {
  const minuteOfDay = newYorkMinuteOfDay(now);
  if (minuteOfDay >= 4 * 60 && minuteOfDay < 9 * 60 + 30) {
    return "premarket";
  }
  if (minuteOfDay >= 9 * 60 + 30 && minuteOfDay < 16 * 60) {
    return "regular";
  }
  if (minuteOfDay >= 16 * 60 && minuteOfDay < 20 * 60) {
    return "after_hours";
  }
  return "overnight";
}

export function selectMoomooLivePrice(
  quote: Pick<MoomooQuote, "lastPrice" | "preMarketPrice" | "afterMarketPrice" | "overnightPrice">,
  now = Date.now(),
): number | null {
  switch (resolveMoomooLivePriceSession(now)) {
    case "premarket":
      return quote.preMarketPrice;
    case "regular":
      return quote.lastPrice;
    case "after_hours":
      return quote.afterMarketPrice;
    case "overnight":
      return quote.overnightPrice;
  }
}

function selectFreshYahooFallbackPrice(quote: YahooStockQuote, now: number): LivePriceSample | null {
  const session = resolveMoomooLivePriceSession(now);
  const candidate = session === "premarket"
    ? { price: quote.preMarketPrice, timestampSeconds: quote.preMarketTime }
    : session === "regular"
      ? { price: quote.regularMarketPrice, timestampSeconds: quote.regularMarketTime }
      : session === "after_hours"
        ? { price: quote.postMarketPrice, timestampSeconds: quote.postMarketTime }
        : null;
  if (!candidate) {
    // Yahoo has no equivalent to Moomoo's overnight-price field.
    return null;
  }

  const price = positiveNumberOrNull(candidate.price);
  const timestamp = typeof candidate.timestampSeconds === "number" && Number.isFinite(candidate.timestampSeconds)
    ? candidate.timestampSeconds * 1_000
    : null;
  const age = timestamp === null ? Number.POSITIVE_INFINITY : now - timestamp;
  if (price === null || timestamp === null || age < 0 || age > YAHOO_FALLBACK_MAX_AGE_MS) {
    return null;
  }
  return { price, timestamp };
}

function parseQuote(value: unknown): MoomooQuote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const remote = value as RemoteMoomooQuote;
  const symbol = typeof remote.symbol === "string" ? normalizeSymbol(remote.symbol) : "";
  if (!symbol) {
    return null;
  }
  return {
    symbol,
    lastPrice: positiveNumberOrNull(remote.lastPrice),
    preMarketPrice: positiveNumberOrNull(remote.preMarketPrice),
    afterMarketPrice: positiveNumberOrNull(remote.afterMarketPrice),
    overnightPrice: positiveNumberOrNull(remote.overnightPrice),
  };
}

/**
 * Polls the protected Platform Moomoo quote bridge. Platform owns the Moomoo
 * OAuth credential; this provider only receives normalized watchlist quotes.
 * Yahoo is used only when Moomoo is unavailable or lacks the active-session price.
 */
export class PlatformMoomooLivePriceProvider implements LivePriceProvider {
  private readonly endpointUrl: URL;
  private readonly publisherToken: string;
  private readonly maxSymbols: number;
  private readonly pollIntervalMs: number;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly yahooClient: YahooLivePriceClient;
  private activeSymbols: string[] = [];
  private listener?: LivePriceListener;
  private pollTimer?: NodeJS.Timeout;
  private generation = 0;
  private lastReportedFailure: string | null = null;

  constructor(options: PlatformMoomooLivePriceProviderOptions = {}) {
    const endpoint = validEndpointUrl(options.endpointUrl) ?? moomooQuoteUrl(
      process.env.TRADERSLINK_WATCHLIST_INGEST_URL?.trim() ?? "",
    );
    const publisherToken = options.publisherToken ?? process.env.TRADERSLINK_WATCHLIST_PUBLISHER_TOKEN?.trim();
    if (!endpoint || !publisherToken) {
      throw new Error(
        "TRADERSLINK_WATCHLIST_INGEST_URL and TRADERSLINK_WATCHLIST_PUBLISHER_TOKEN are required to use the Moomoo live price provider.",
      );
    }
    if (!options.fetch && typeof globalThis.fetch !== "function") {
      throw new Error("Global fetch is unavailable; use Node 18+ or provide a Moomoo quote fetch implementation.");
    }

    this.endpointUrl = endpoint;
    this.publisherToken = publisherToken;
    this.maxSymbols = positiveInteger(options.maxSymbols, DEFAULT_MAX_SYMBOLS);
    this.pollIntervalMs = positiveInteger(
      options.pollIntervalMs ?? process.env.LEVEL_MOOMOO_LIVE_PRICE_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
    );
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.yahooClient = options.yahooClient ?? new YahooClient({ timeoutMs: 10_000 });
  }

  async start(entries: WatchlistEntry[], onUpdate: LivePriceListener): Promise<void> {
    await this.stop();

    const activeSymbols = [...new Set(entries
      .filter((entry) => entry.active)
      .map((entry) => normalizeSymbol(entry.symbol))
      .filter(Boolean))];
    if (activeSymbols.length > this.maxSymbols) {
      throw new Error(
        `Moomoo live-price bridge supports ${this.maxSymbols} active symbols per poll; received ${activeSymbols.length}.`,
      );
    }

    this.activeSymbols = activeSymbols;
    this.listener = onUpdate;
    const generation = ++this.generation;
    if (activeSymbols.length > 0) {
      void this.poll(generation);
    }
  }

  async stop(): Promise<void> {
    this.generation += 1;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.listener = undefined;
    this.activeSymbols = [];
    this.lastReportedFailure = null;
  }

  private scheduleNextPoll(generation: number): void {
    if (generation !== this.generation || !this.listener || this.activeSymbols.length === 0) {
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.poll(generation);
    }, this.pollIntervalMs);
  }

  private async publishYahooFallback(generation: number, symbols: readonly string[]): Promise<void> {
    let index = 0;
    const workerCount = Math.min(YAHOO_FALLBACK_CONCURRENCY, symbols.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (generation === this.generation && this.listener) {
        const symbol = symbols[index];
        index += 1;
        if (!symbol) {
          return;
        }
        try {
          const quote = await this.yahooClient.getChartQuote(symbol);
          const sample = selectFreshYahooFallbackPrice(quote, this.now());
          if (sample && generation === this.generation && this.listener) {
            this.listener({ symbol, timestamp: sample.timestamp, lastPrice: sample.price });
          }
        } catch {
          // The next scheduled Moomoo poll will retry; EODHD remains manual-only.
        }
      }
    });
    await Promise.all(workers);
  }

  private async poll(generation: number): Promise<void> {
    if (generation !== this.generation || !this.listener || this.activeSymbols.length === 0) {
      return;
    }

    try {
      const response = await this.fetcher(this.endpointUrl, {
        method: "POST",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.publisherToken}`,
        },
        body: JSON.stringify({ symbols: this.activeSymbols }),
      });
      let payload: RemoteMoomooQuoteResponse;
      try {
        payload = await response.json() as RemoteMoomooQuoteResponse;
      } catch {
        throw new Error("Moomoo quote bridge response was not JSON.");
      }
      if (
        !response.ok ||
        payload.status !== "ready" ||
        payload.provider !== "moomoo_open_api" ||
        !Array.isArray(payload.quotes)
      ) {
        throw new Error("Moomoo quote bridge is unavailable.");
      }

      const activeSymbols = new Set(this.activeSymbols);
      const symbolsNeedingYahooFallback = new Set(this.activeSymbols);
      const observedAt = this.now();
      for (const item of payload.quotes) {
        const quote = parseQuote(item);
        if (!quote || !activeSymbols.has(quote.symbol) || generation !== this.generation || !this.listener) {
          continue;
        }
        const lastPrice = selectMoomooLivePrice(quote, observedAt);
        if (lastPrice === null) {
          continue;
        }
        symbolsNeedingYahooFallback.delete(quote.symbol);
        this.listener({ symbol: quote.symbol, timestamp: observedAt, lastPrice });
      }
      await this.publishYahooFallback(generation, [...symbolsNeedingYahooFallback]);
      this.lastReportedFailure = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.lastReportedFailure !== message) {
        this.lastReportedFailure = message;
        console.warn(`[MoomooLivePriceProvider] ${message}; using Yahoo fallback.`);
      }
      await this.publishYahooFallback(generation, this.activeSymbols);
    } finally {
      this.scheduleNextPoll(generation);
    }
  }
}
