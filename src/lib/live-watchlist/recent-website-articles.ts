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

type ExecFileAsync = (
  file: string,
  args: string[],
  options: {
    maxBuffer: number;
    timeout: number;
    windowsHide: boolean;
  },
) => Promise<{ stdout: string; stderr: string }>;

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
  execFileImpl?: ExecFileAsync;
}): Promise<RecentWebsiteArticleLookupResult> {
  const env = args.env ?? process.env;
  const symbol = normalizeSymbol(args.symbol);
  const scriptPath =
    env.TRADERSLINK_WEBSITE_ARTICLE_LOOKUP_PATH?.trim() || DEFAULT_LOOKUP_SCRIPT_PATH;
  const timeoutMs =
    Number(env.TRADERSLINK_WEBSITE_ARTICLE_LOOKUP_TIMEOUT_MS ?? "") ||
    DEFAULT_LOOKUP_TIMEOUT_MS;
  const run = args.execFileImpl ?? (execFileAsync as ExecFileAsync);
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

export function buildRecentWebsiteArticlesPatch(args: {
  result: RecentWebsiteArticleLookupResult;
  symbol: string;
  updatedAt?: number;
}): LiveWatchlistCardPatch | null {
  const symbol = normalizeSymbol(args.symbol);
  const articles = args.result.articles.slice(0, 10);
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
  execFileImpl?: ExecFileAsync;
  logger?: RecentWebsiteArticlePublisherLogger;
}): Promise<void> {
  if (!args.publisher) {
    return;
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `[RecentWebsiteArticles] Lookup failed for ${normalizeSymbol(args.symbol)}: ${message}`,
    );
  }
}
