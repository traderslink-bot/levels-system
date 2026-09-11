import type { RecentWebsiteArticleLookupResult } from "./recent-website-articles.js";

const CONTRACT_VERSION = "traderslink_watchlist_ai_source_v1";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_BUSINESS_DAYS = 5;
const MAX_RESPONSE_BYTES = 1024 * 1024;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type OfficialWatchlistArticleSourceLookupArgs = {
  symbol: string;
  targetSessionDate: string;
  referenceTimeMs?: number;
};

export type OfficialWatchlistArticleSourceLookupResult =
  | {
      status: "eligible";
      research: RecentWebsiteArticleLookupResult;
    }
  | {
      status: "no_eligible_article";
      research: RecentWebsiteArticleLookupResult;
    }
  | {
      status: "lookup_unavailable";
      error: string;
      research: RecentWebsiteArticleLookupResult;
    };

export type OfficialWatchlistArticleSourceLookup = (
  args: OfficialWatchlistArticleSourceLookupArgs,
) => Promise<OfficialWatchlistArticleSourceLookupResult>;

type OfficialWatchlistArticleSourceOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
};

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function validSymbol(value: string): boolean {
  return /^[A-Z0-9.-]{1,15}$/.test(value);
}

function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!, 12));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day;
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

export function officialWatchlistFiveWeekdayWindowStart(targetSessionDate: string): string | null {
  if (!validDateKey(targetSessionDate)) return null;
  const [year, month, day] = targetSessionDate.split("-").map(Number);
  const cursor = new Date(Date.UTC(year!, month! - 1, day!, 12));
  if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) return null;
  let remaining = DEFAULT_BUSINESS_DAYS - 1;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return cursor.toISOString().slice(0, 10);
}

function emptyResearch(symbol: string, generatedAtMs: number): RecentWebsiteArticleLookupResult {
  return {
    ticker: symbol,
    businessDays: DEFAULT_BUSINESS_DAYS,
    generatedAt: new Date(generatedAtMs).toISOString(),
    count: 0,
    articles: [],
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function articleRecency(
  value: unknown,
): "current_day" | "older_within_window" | undefined {
  return value === "current_day" || value === "older_within_window"
    ? value
    : undefined;
}

function exactString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safePublicTradersLinkUrl(value: unknown): string | null {
  const normalized = exactString(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      (hostname !== "traderslink.pro" && !hostname.endsWith(".traderslink.pro"))
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function lookupUrl(ingestUrl: string, symbol: string, targetSessionDate: string): URL | null {
  try {
    const url = new URL(ingestUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.pathname = `/api/news/watchlist-ai-source/${encodeURIComponent(symbol)}`;
    url.search = "";
    url.searchParams.set("targetSessionDate", targetSessionDate);
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function unavailable(
  symbol: string,
  generatedAtMs: number,
  error: string,
): OfficialWatchlistArticleSourceLookupResult {
  return {
    status: "lookup_unavailable",
    error,
    research: emptyResearch(symbol, generatedAtMs),
  };
}

function validIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizeEligibleResponse(args: {
  payload: unknown;
  symbol: string;
  targetSessionDate: string;
  generatedAtMs: number;
}): OfficialWatchlistArticleSourceLookupResult {
  if (typeof args.payload !== "object" || args.payload === null) {
    return unavailable(args.symbol, args.generatedAtMs, "invalid_payload");
  }
  const payload = args.payload as Record<string, unknown>;
  const eligibility = payload.eligibility as Record<string, unknown> | null;
  const article = payload.article as Record<string, unknown> | null;
  const windowStartDateEt = exactString(eligibility?.windowStartDateEt);
  const windowEndDateEt = exactString(eligibility?.windowEndDateEt);
  const includedWeekdaysEt = Array.isArray(eligibility?.includedWeekdaysEt)
    && eligibility.includedWeekdaysEt.every((value): value is string => typeof value === "string")
    ? [...eligibility.includedWeekdaysEt].sort()
    : [];
  const expectedWindowStart = officialWatchlistFiveWeekdayWindowStart(args.targetSessionDate);
  if (
    payload.contractVersion !== CONTRACT_VERSION ||
    payload.requestedTicker !== args.symbol ||
    payload.targetSessionDate !== args.targetSessionDate ||
    eligibility?.status !== "eligible" ||
    eligibility?.timeZone !== "America/New_York" ||
    !windowStartDateEt ||
    !windowEndDateEt ||
    windowStartDateEt !== expectedWindowStart ||
    windowEndDateEt !== args.targetSessionDate ||
    includedWeekdaysEt.length !== DEFAULT_BUSINESS_DAYS ||
    includedWeekdaysEt[0] !== expectedWindowStart ||
    includedWeekdaysEt.at(-1) !== args.targetSessionDate ||
    new Set(includedWeekdaysEt).size !== DEFAULT_BUSINESS_DAYS ||
    includedWeekdaysEt.some((value) => !validDateKey(value) ||
      [0, 6].includes(new Date(`${value}T12:00:00Z`).getUTCDay())) ||
    !article
  ) {
    return unavailable(args.symbol, args.generatedAtMs, "invalid_contract");
  }

  const articleId = exactString(article.articleId);
  // Platform stores revision as a positive integer; older wire fixtures used strings.
  const revision = typeof article.revision === "number" && Number.isSafeInteger(article.revision) && article.revision > 0
    ? String(article.revision)
    : exactString(article.revision);
  const contentSha256 = exactString(article.contentSha256)?.toLowerCase() ?? null;
  const ticker = exactString(article.ticker);
  const publicUrl = safePublicTradersLinkUrl(article.publicUrl);
  const headline = exactString(article.headline);
  const processedContent = exactString(article.processedContent);
  const publishedAt = exactString(article.publishedAt);
  const publishedDate = publishedAt && validIsoTimestamp(publishedAt)
    ? newYorkDateKey(Date.parse(publishedAt))
    : null;
  const publishedDateEt = exactString(article.publishedDateEt);
  const recency = articleRecency(article.recency);
  const expectedRecency = publishedDate === args.targetSessionDate
    ? "current_day"
    : "older_within_window";
  const observedAt = optionalString(article.observedAt);
  if (
    !articleId ||
    !revision || !/^[1-9]\d*$/.test(revision) ||
    !contentSha256 ||
    !/^[a-f0-9]{64}$/.test(contentSha256) ||
    ticker !== args.symbol ||
    !publicUrl ||
    !headline ||
    !processedContent ||
    !publishedAt ||
    !publishedDate ||
    publishedDateEt !== publishedDate ||
    recency !== expectedRecency ||
    publishedDate < expectedWindowStart! ||
    publishedDate > args.targetSessionDate ||
    !includedWeekdaysEt.includes(publishedDate) ||
    (observedAt !== undefined && !validIsoTimestamp(observedAt)) ||
    article.sourceClass !== "traderslink_processed"
  ) {
    return unavailable(args.symbol, args.generatedAtMs, "invalid_article");
  }

  return {
    status: "eligible",
    research: {
      ticker: args.symbol,
      businessDays: DEFAULT_BUSINESS_DAYS,
      generatedAt: new Date(args.generatedAtMs).toISOString(),
      count: 1,
      articles: [{
        ticker: args.symbol,
        url: publicUrl,
        title: headline,
        publishedAt,
        observedAt,
        eventType: optionalString(article.eventType),
        articlePath: optionalString(article.routeTag),
        sourceKind: "traderslink_press_release_sec_database",
        processedContent,
        articleId,
        revision,
        contentSha256,
        targetSessionDate: args.targetSessionDate,
        publishedDateEt,
        recency,
        windowStartDateEt,
        windowEndDateEt,
      }],
    },
  };
}

export function createOfficialWatchlistArticleSourceLookup(
  options: OfficialWatchlistArticleSourceOptions = {},
): OfficialWatchlistArticleSourceLookup {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));

  return async (args) => {
    const generatedAtMs = now();
    const symbol = normalizeSymbol(args.symbol);
    const targetSessionDate = args.targetSessionDate;
    const empty = emptyResearch(symbol, generatedAtMs);
    if (!validSymbol(symbol) || !validDateKey(targetSessionDate)) {
      return unavailable(symbol, generatedAtMs, "invalid_request");
    }
    const ingestUrl = env.TRADERSLINK_WATCHLIST_INGEST_URL?.trim();
    const token = env.TRADERSLINK_WATCHLIST_PUBLISHER_TOKEN?.trim();
    const url = ingestUrl ? lookupUrl(ingestUrl, symbol, targetSessionDate) : null;
    if (!url || !token) {
      return unavailable(symbol, generatedAtMs, "not_configured");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-store",
        },
      });
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        return unavailable(symbol, generatedAtMs, "response_too_large");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return unavailable(symbol, generatedAtMs, "invalid_json");
      }

      if (response.status === 404) {
        const candidate = payload as Record<string, unknown>;
        if (
          candidate.code === "no_eligible_article" &&
          candidate.requestedTicker === symbol &&
          candidate.targetSessionDate === targetSessionDate
        ) {
          return { status: "no_eligible_article", research: empty };
        }
        return unavailable(symbol, generatedAtMs, "http_404");
      }
      if (response.status !== 200) {
        return unavailable(symbol, generatedAtMs, `http_${response.status}`);
      }
      return normalizeEligibleResponse({
        payload,
        symbol,
        targetSessionDate,
        generatedAtMs,
      });
    } catch {
      return unavailable(symbol, generatedAtMs, "request_failed");
    } finally {
      clearTimeout(timeout);
    }
  };
}

export const lookupOfficialWatchlistArticleSource =
  createOfficialWatchlistArticleSourceLookup();
