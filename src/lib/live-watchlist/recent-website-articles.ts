import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  LiveWatchlistCardPatch,
  LiveWatchlistPublisher,
} from "./live-watchlist-types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_LOOKUP_SCRIPT_PATH =
  "C:\\Users\\jerac\\Documents\\TraderLink\\playwright\\projects\\press_release_levels_v2\\website_article_lookup.js";
const DEFAULT_LOOKUP_TIMEOUT_MS = 10_000;
const LOOKUP_MAX_BUFFER_BYTES = 1024 * 1024;

export type RecentWebsiteArticle = {
  ticker: string;
  url: string;
  articlePath?: string;
  title: string;
  publishedAt?: string;
  eventType?: string;
  filingType?: string;
  sourceUrl?: string;
  observedAt?: string;
};

export type RecentWebsiteArticleLookupResult = {
  ticker: string;
  businessDays: number;
  generatedAt?: string;
  cutoffPublishedAt?: string;
  count: number;
  articles: RecentWebsiteArticle[];
};

export type RecentWebsiteArticleExecFile = (
  file: string,
  args: string[],
  options: {
    maxBuffer: number;
    timeout: number;
    windowsHide: boolean;
  },
) => Promise<{ stdout: string; stderr: string }>;

export type RecentWebsiteArticleCatalystFreshness =
  | "same_day"
  | "recent_1_2_days"
  | "stale_3_7_days"
  | "no_card"
  | "lookup_unavailable";

type RecentWebsiteArticlePublisherLogger = Pick<typeof console, "warn">;

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeArticle(value: unknown, fallbackTicker: string): RecentWebsiteArticle | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const url = normalizeOptionalString(candidate.url);
  const title = normalizeOptionalString(candidate.title);
  if (!url || !title) {
    return null;
  }

  return {
    ticker: normalizeOptionalString(candidate.ticker) ?? fallbackTicker,
    url,
    title,
    articlePath: normalizeOptionalString(candidate.articlePath),
    publishedAt: normalizeOptionalString(candidate.publishedAt),
    eventType: normalizeOptionalString(candidate.eventType),
    filingType: normalizeOptionalString(candidate.filingType),
    sourceUrl: normalizeOptionalString(candidate.sourceUrl),
    observedAt: normalizeOptionalString(candidate.observedAt),
  };
}

export function normalizeRecentWebsiteArticleLookupResult(
  value: unknown,
  symbolInput: string,
): RecentWebsiteArticleLookupResult {
  const symbol = normalizeSymbol(symbolInput);
  if (typeof value !== "object" || value === null) {
    throw new Error("Website article lookup returned a non-object payload.");
  }
  const candidate = value as Record<string, unknown>;
  const articles = Array.isArray(candidate.articles)
    ? candidate.articles
        .map((article) => normalizeArticle(article, symbol))
        .filter((article): article is RecentWebsiteArticle => Boolean(article))
    : [];

  return {
    ticker: normalizeOptionalString(candidate.ticker) ?? symbol,
    businessDays:
      typeof candidate.businessDays === "number" && Number.isFinite(candidate.businessDays)
        ? candidate.businessDays
        : 5,
    generatedAt: normalizeOptionalString(candidate.generatedAt),
    cutoffPublishedAt: normalizeOptionalString(candidate.cutoffPublishedAt),
    count:
      typeof candidate.count === "number" && Number.isFinite(candidate.count)
        ? candidate.count
        : articles.length,
    articles,
  };
}

export async function lookupRecentWebsiteArticlesForSymbol(args: {
  symbol: string;
  env?: NodeJS.ProcessEnv;
  execFileImpl?: RecentWebsiteArticleExecFile;
}): Promise<RecentWebsiteArticleLookupResult> {
  const env = args.env ?? process.env;
  const symbol = normalizeSymbol(args.symbol);
  const scriptPath =
    env.TRADERSLINK_WEBSITE_ARTICLE_LOOKUP_PATH?.trim() || DEFAULT_LOOKUP_SCRIPT_PATH;
  const timeoutMs =
    Number(env.TRADERSLINK_WEBSITE_ARTICLE_LOOKUP_TIMEOUT_MS ?? "") ||
    DEFAULT_LOOKUP_TIMEOUT_MS;
  const run = args.execFileImpl ?? (execFileAsync as RecentWebsiteArticleExecFile);
  const { stdout } = await run(
    process.execPath,
    [scriptPath, "--ticker", symbol, "--json"],
    {
      maxBuffer: LOOKUP_MAX_BUFFER_BYTES,
      timeout: Math.max(1, Math.floor(timeoutMs)),
      windowsHide: true,
    },
  );

  return normalizeRecentWebsiteArticleLookupResult(JSON.parse(stdout), symbol);
}

function newYorkDateKey(timestampMs: number): string | null {
  if (!Number.isFinite(timestampMs)) {
    return null;
  }
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

function dateKeyToUtcNoonMs(dateKey: string): number | null {
  const [year, month, day] = dateKey.split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return null;
  }
  return Date.UTC(year, month - 1, day, 12, 0, 0);
}

function newYorkCalendarDayDiff(leftDateKey: string, rightDateKey: string): number | null {
  const left = dateKeyToUtcNoonMs(leftDateKey);
  const right = dateKeyToUtcNoonMs(rightDateKey);
  if (left === null || right === null) {
    return null;
  }
  return Math.round((left - right) / 86_400_000);
}

export function deriveRecentWebsiteArticleCatalystFreshness(args: {
  result: RecentWebsiteArticleLookupResult | null | undefined;
  referenceTimeMs?: number;
}): RecentWebsiteArticleCatalystFreshness {
  const result = args.result;
  if (!result || result.count <= 0 || result.articles.length === 0) {
    return "no_card";
  }

  const referenceDateKey = newYorkDateKey(args.referenceTimeMs ?? Date.now());
  if (!referenceDateKey) {
    return "lookup_unavailable";
  }

  const closestArticleDayDiff = result.articles
    .map((article) => {
      const publishedAtMs = article.publishedAt ? Date.parse(article.publishedAt) : NaN;
      const articleDateKey = newYorkDateKey(publishedAtMs);
      if (!articleDateKey) {
        return null;
      }
      const dayDiff = newYorkCalendarDayDiff(referenceDateKey, articleDateKey);
      return dayDiff !== null && dayDiff >= 0 ? dayDiff : null;
    })
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right)[0];

  if (closestArticleDayDiff === undefined) {
    return "no_card";
  }
  if (closestArticleDayDiff === 0) {
    return "same_day";
  }
  if (closestArticleDayDiff <= 2) {
    return "recent_1_2_days";
  }
  if (closestArticleDayDiff <= 7) {
    return "stale_3_7_days";
  }
  return "no_card";
}

export function buildRecentWebsiteArticlesPatch(args: {
  result: RecentWebsiteArticleLookupResult;
  symbol: string;
  updatedAt?: number;
}): LiveWatchlistCardPatch | null {
  const symbol = normalizeSymbol(args.symbol);
  const articlesByTitleAndDay = new Map<string, RecentWebsiteArticle>();
  for (const article of args.result.articles) {
    const normalizedTitle = article.title.trim().toLowerCase().replace(/\s+/g, " ");
    const publishedAtMs = article.publishedAt ? Date.parse(article.publishedAt) : NaN;
    const publishedDay = Number.isFinite(publishedAtMs)
      ? new Date(publishedAtMs).toISOString().slice(0, 10)
      : "unknown";
    const key = `${normalizedTitle}\u0000${publishedDay}`;
    const existing = articlesByTitleAndDay.get(key);
    const existingPublishedAtMs = existing?.publishedAt ? Date.parse(existing.publishedAt) : NaN;

    if (
      !existing ||
      (Number.isFinite(publishedAtMs) &&
        (!Number.isFinite(existingPublishedAtMs) || publishedAtMs < existingPublishedAtMs))
    ) {
      articlesByTitleAndDay.set(key, article);
    }
  }
  const articles = [...articlesByTitleAndDay.values()]
    .sort((left, right) => {
      const leftMs = left.publishedAt ? Date.parse(left.publishedAt) : NaN;
      const rightMs = right.publishedAt ? Date.parse(right.publishedAt) : NaN;
      if (!Number.isFinite(leftMs)) return 1;
      if (!Number.isFinite(rightMs)) return -1;
      return rightMs - leftMs;
    })
    .slice(0, 10);
  if (articles.length === 0 || args.result.count <= 0) {
    return null;
  }

  const updatedAt = args.updatedAt ?? Date.now();
  return {
    symbol,
    status: "live",
    updatedAt,
    cards: {
      recentNewsFilings: {
        title: "Known Recent News / SEC Filings",
        body: JSON.stringify({ articles }, null, 2),
        updatedAt,
        priceWhenPosted: null,
        source: "website_article_lookup",
        metadata: {
          articleCount: articles.length,
          businessDays: args.result.businessDays,
        },
      },
    },
  };
}

export async function publishRecentWebsiteArticlesForSymbol(args: {
  symbol: string;
  publisher: LiveWatchlistPublisher | null;
  env?: NodeJS.ProcessEnv;
  execFileImpl?: RecentWebsiteArticleExecFile;
  logger?: RecentWebsiteArticlePublisherLogger;
}): Promise<RecentWebsiteArticleLookupResult | null> {
  if (!args.publisher) {
    return null;
  }

  const logger = args.logger ?? console;
  try {
    const result = await lookupRecentWebsiteArticlesForSymbol({
      symbol: args.symbol,
      env: args.env,
      execFileImpl: args.execFileImpl,
    });
    const patch = buildRecentWebsiteArticlesPatch({
      result,
      symbol: args.symbol,
    });
    if (patch) {
      await args.publisher.publish(patch);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `[RecentWebsiteArticles] Lookup failed for ${normalizeSymbol(args.symbol)}: ${message}`,
    );
    return null;
  }
}
