import type {
  RecentWebsiteArticle,
  RecentWebsiteArticleLookupResult,
} from "./recent-website-articles.js";

const STOCKTITAN_RSS_BASE_URL = "https://www.stocktitan.net/rss/news";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_FAILURE_CACHE_TTL_MS = 60_000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 5 * 60_000;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 25;
const DEFAULT_BLOCKED_COOLDOWN_MS = 15 * 60_000;
const DEFAULT_BUSINESS_DAYS = 5;
const MAX_ARTICLES = 10;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type StockTitanCatalystFeedLookupArgs = {
  symbol: string;
  referenceTimeMs?: number;
  businessDays?: number;
  enabled?: boolean;
};

export type StockTitanCatalystFeedLookupResult = {
  available: boolean;
  error?: string;
  research: RecentWebsiteArticleLookupResult;
};

export type StockTitanCatalystFeedLookup = (
  args: StockTitanCatalystFeedLookupArgs,
) => Promise<StockTitanCatalystFeedLookupResult>;

type StockTitanCatalystFeedOptions = {
  fetchImpl?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  failureCacheTtlMs?: number;
  rateLimitWindowMs?: number;
  maxRequestsPerWindow?: number;
  blockedCooldownMs?: number;
};

type CacheEntry = {
  expiresAt: number;
  result: StockTitanCatalystFeedLookupResult;
};

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function validSymbol(value: string): boolean {
  return /^[A-Z0-9.-]{1,15}$/.test(value);
}

function resolveBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function emptyResearch(
  symbol: string,
  businessDays: number,
  generatedAtMs: number,
): RecentWebsiteArticleLookupResult {
  return {
    ticker: symbol,
    businessDays,
    generatedAt: new Date(generatedAtMs).toISOString(),
    count: 0,
    articles: [],
  };
}

function decodeXml(value: string): string {
  const unwrapped = value
    .trim()
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, "$1");
  return unwrapped
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function tagValue(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ? decodeXml(match[1]) : null;
}

function normalizeStockTitanUrl(value: string | null, symbol: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "stocktitan.net" && hostname !== "www.stocktitan.net") {
      return null;
    }
    if (!url.pathname.toLowerCase().startsWith(`/news/${symbol.toLowerCase()}/`)) {
      return null;
    }
    url.protocol = "https:";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function cleanStockTitanTitle(value: string, symbol: string): string {
  const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value
    .replace(new RegExp(`\\s*\\|\\s*${escapedSymbol}\\s+Stock News\\s*$`, "i"), "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseStockTitanRssArticles(
  xml: string,
  symbolInput: string,
): RecentWebsiteArticle[] {
  const symbol = normalizeSymbol(symbolInput);
  if (!validSymbol(symbol)) return [];

  const articlesByUrl = new Map<string, RecentWebsiteArticle>();
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const item = match[1] ?? "";
    const rawTitle = tagValue(item, "title");
    const publishedAtValue = tagValue(item, "pubDate");
    const publishedAtMs = publishedAtValue ? Date.parse(publishedAtValue) : NaN;
    const url = normalizeStockTitanUrl(
      tagValue(item, "link") ?? tagValue(item, "guid"),
      symbol,
    );
    const title = rawTitle ? cleanStockTitanTitle(rawTitle, symbol) : "";
    if (!title || !url || !Number.isFinite(publishedAtMs)) continue;

    articlesByUrl.set(url, {
      ticker: symbol,
      title,
      url,
      publishedAt: new Date(publishedAtMs).toISOString(),
      eventType: "stocktitan_rss_catalyst",
      sourceKind: "stocktitan_rss",
    });
  }

  return [...articlesByUrl.values()].sort((left, right) =>
    Date.parse(right.publishedAt ?? "") - Date.parse(left.publishedAt ?? ""));
}

function newYorkDateKey(timestampMs: number): string | null {
  if (!Number.isFinite(timestampMs)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function businessDayCutoffDateKey(referenceTimeMs: number, businessDays: number): string | null {
  const referenceDateKey = newYorkDateKey(referenceTimeMs);
  if (!referenceDateKey) return null;
  const [year, month, day] = referenceDateKey.split("-").map(Number);
  const cursor = new Date(Date.UTC(year!, month! - 1, day!, 12));
  let remaining = Math.max(1, Math.floor(businessDays)) - 1;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return cursor.toISOString().slice(0, 10);
}

function filterRecentArticles(args: {
  articles: RecentWebsiteArticle[];
  referenceTimeMs: number;
  businessDays: number;
}): RecentWebsiteArticle[] {
  const referenceDateKey = newYorkDateKey(args.referenceTimeMs);
  const cutoffDateKey = businessDayCutoffDateKey(args.referenceTimeMs, args.businessDays);
  if (!referenceDateKey || !cutoffDateKey) return [];
  return args.articles
    .filter((article) => {
      const publishedAtMs = Date.parse(article.publishedAt ?? "");
      const articleDateKey = newYorkDateKey(publishedAtMs);
      return Boolean(
        articleDateKey &&
        articleDateKey >= cutoffDateKey &&
        articleDateKey <= referenceDateKey &&
        publishedAtMs <= args.referenceTimeMs + 5 * 60_000
      );
    })
    .slice(0, MAX_ARTICLES);
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function retryAfterMs(headers: Headers, now: number, fallbackMs: number): number {
  const retryAfter = headers.get("retry-after");
  const seconds = parsePositiveInteger(retryAfter);
  if (seconds !== null) return seconds * 1_000;
  const retryAt = retryAfter ? Date.parse(retryAfter) : NaN;
  return Number.isFinite(retryAt) ? Math.max(1_000, retryAt - now) : fallbackMs;
}

export class StockTitanRssCatalystFeed {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly failureCacheTtlMs: number;
  private readonly rateLimitWindowMs: number;
  private readonly maxRequestsPerWindow: number;
  private readonly blockedCooldownMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<StockTitanCatalystFeedLookupResult>>();
  private requestQueue: Promise<void> = Promise.resolve();
  private requestTimes: number[] = [];
  private blockedUntil = 0;

  constructor(options: StockTitanCatalystFeedOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.failureCacheTtlMs = options.failureCacheTtlMs ?? DEFAULT_FAILURE_CACHE_TTL_MS;
    this.rateLimitWindowMs = options.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
    this.maxRequestsPerWindow = options.maxRequestsPerWindow ?? DEFAULT_MAX_REQUESTS_PER_WINDOW;
    this.blockedCooldownMs = options.blockedCooldownMs ?? DEFAULT_BLOCKED_COOLDOWN_MS;
  }

  async lookup(args: StockTitanCatalystFeedLookupArgs): Promise<StockTitanCatalystFeedLookupResult> {
    const symbol = normalizeSymbol(args.symbol);
    const referenceTimeMs = args.referenceTimeMs ?? this.now();
    const businessDays = Math.max(1, Math.floor(args.businessDays ?? DEFAULT_BUSINESS_DAYS));
    const empty = emptyResearch(symbol, businessDays, this.now());
    const enabled = args.enabled ?? resolveBoolean(
      process.env.TRADERSLINK_STOCKTITAN_RSS_FALLBACK_ENABLED,
      true,
    );
    if (!enabled) return { available: false, error: "disabled", research: empty };
    if (!validSymbol(symbol)) return { available: false, error: "invalid_symbol", research: empty };

    const cacheKey = `${symbol}:${newYorkDateKey(referenceTimeMs) ?? "unknown"}:${businessDays}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) return cached.result;
    const existingRequest = this.inFlight.get(cacheKey);
    if (existingRequest) return existingRequest;

    const request = this.enqueueLookup({
      symbol,
      referenceTimeMs,
      businessDays,
      empty,
    }).then((result) => {
      this.cache.set(cacheKey, {
        expiresAt: this.now() + (result.available ? this.cacheTtlMs : this.failureCacheTtlMs),
        result,
      });
      return result;
    }).finally(() => {
      this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, request);
    return request;
  }

  private enqueueLookup(args: {
    symbol: string;
    referenceTimeMs: number;
    businessDays: number;
    empty: RecentWebsiteArticleLookupResult;
  }): Promise<StockTitanCatalystFeedLookupResult> {
    const request = this.requestQueue.then(() => this.fetchFeed(args));
    this.requestQueue = request.then(() => undefined, () => undefined);
    return request;
  }

  private async fetchFeed(args: {
    symbol: string;
    referenceTimeMs: number;
    businessDays: number;
    empty: RecentWebsiteArticleLookupResult;
  }): Promise<StockTitanCatalystFeedLookupResult> {
    const now = this.now();
    if (now < this.blockedUntil) {
      return { available: false, error: "rate_limited", research: args.empty };
    }
    this.requestTimes = this.requestTimes.filter((timestamp) =>
      timestamp > now - this.rateLimitWindowMs);
    if (this.requestTimes.length >= this.maxRequestsPerWindow) {
      this.blockedUntil = this.requestTimes[0]! + this.rateLimitWindowMs;
      return { available: false, error: "local_rate_limit", research: args.empty };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      this.requestTimes.push(now);
      const response = await this.fetchImpl(
        `${STOCKTITAN_RSS_BASE_URL}/${encodeURIComponent(args.symbol)}`,
        {
          headers: {
            accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
            "user-agent": "TraderLink catalyst RSS fallback/1.0",
          },
          redirect: "follow",
          signal: controller.signal,
        },
      );

      const remaining = parsePositiveInteger(response.headers.get("ratelimit-remaining"));
      const resetSeconds = parsePositiveInteger(response.headers.get("ratelimit-reset"));
      if (remaining === 0) {
        this.blockedUntil = Math.max(
          this.blockedUntil,
          this.now() + (resetSeconds !== null ? resetSeconds * 1_000 : this.rateLimitWindowMs),
        );
      }
      if (response.status === 429) {
        this.blockedUntil = Math.max(
          this.blockedUntil,
          this.now() + retryAfterMs(response.headers, this.now(), this.rateLimitWindowMs),
        );
        return { available: false, error: "http_429", research: args.empty };
      }
      if (response.status === 403) {
        this.blockedUntil = Math.max(this.blockedUntil, this.now() + this.blockedCooldownMs);
        return { available: false, error: "http_403", research: args.empty };
      }
      if (!response.ok) {
        return { available: false, error: `http_${response.status}`, research: args.empty };
      }

      const articles = filterRecentArticles({
        articles: parseStockTitanRssArticles(await response.text(), args.symbol),
        referenceTimeMs: args.referenceTimeMs,
        businessDays: args.businessDays,
      });
      const cutoffDateKey = businessDayCutoffDateKey(args.referenceTimeMs, args.businessDays);
      return {
        available: true,
        research: {
          ticker: args.symbol,
          businessDays: args.businessDays,
          generatedAt: new Date(this.now()).toISOString(),
          ...(cutoffDateKey ? { cutoffPublishedAt: `${cutoffDateKey}T00:00:00.000Z` } : {}),
          count: articles.length,
          articles,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        available: false,
        error: message || "request_failed",
        research: args.empty,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

const defaultStockTitanRssCatalystFeed = new StockTitanRssCatalystFeed();

export const lookupStockTitanRssCatalystForSymbol: StockTitanCatalystFeedLookup = (args) =>
  defaultStockTitanRssCatalystFeed.lookup(args);

export async function applyStockTitanRssFallback(args: {
  localResearch: RecentWebsiteArticleLookupResult;
  symbol: string;
  referenceTimeMs: number;
  lookup?: StockTitanCatalystFeedLookup;
}): Promise<RecentWebsiteArticleLookupResult> {
  if (args.localResearch.count > 0 && args.localResearch.articles.length > 0) {
    return args.localResearch;
  }
  const result = await (args.lookup ?? lookupStockTitanRssCatalystForSymbol)({
    symbol: args.symbol,
    referenceTimeMs: args.referenceTimeMs,
    businessDays: args.localResearch.businessDays || DEFAULT_BUSINESS_DAYS,
  });
  return result.available && result.research.articles.length > 0
    ? result.research
    : args.localResearch;
}
