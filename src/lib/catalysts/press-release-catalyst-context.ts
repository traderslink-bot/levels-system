import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_PRESS_RELEASE_PROJECT_DIRECTORY =
  "C:\\Users\\jerac\\Documents\\TraderLink\\playwright\\projects\\press_release_levels_v2";
const DEFAULT_LOOKUP_TIMEOUT_MS = 10_000;
const LOOKUP_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

export type PressReleaseCatalystSourceKind = "website_article_posts" | "ingest_events";

export type PressReleaseCatalystArticle = {
  ingestEventId: string;
  ticker: string;
  url: string;
  articlePath: string | null;
  title: string | null;
  publishedAt: string;
  eventType: string | null;
  filingType: string | null;
  routeTag: string | null;
  sourceUrl: string | null;
  observedAt: string | null;
  sourceKind: PressReleaseCatalystSourceKind;
};

export type PressReleaseCatalystTiming =
  | "same_day_premarket"
  | "same_day_intraday"
  | "prior_evening"
  | "recent_prior"
  | "stale"
  | "after_runner_day"
  | "none"
  | "lookup_unavailable";

export type PressReleaseCatalystFreshness =
  | "same_day"
  | "recent_1_2_days"
  | "stale_3_7_days"
  | "no_card"
  | "lookup_unavailable";

export type PressReleaseCatalystContext = {
  source: "local_press_release_db";
  checked: boolean;
  timing: PressReleaseCatalystTiming;
  freshness: PressReleaseCatalystFreshness;
  articleCount: number;
  primaryArticle: PressReleaseCatalystArticle | null;
  articles: PressReleaseCatalystArticle[];
  summary: string;
};

export type PressReleaseCatalystLookupResult = {
  available: boolean;
  error?: string;
  databasePath?: string;
  articlesBySymbol: Record<string, PressReleaseCatalystArticle[]>;
};

export type PressReleaseCatalystExecFile = (
  file: string,
  args: string[],
  options: {
    cwd: string;
    encoding: "utf8";
    maxBuffer: number;
    timeout: number;
    windowsHide: boolean;
    env: NodeJS.ProcessEnv;
  },
) => Promise<{ stdout: string; stderr: string }>;

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function isPressReleaseCatalystArticle(article: PressReleaseCatalystArticle): boolean {
  return article.eventType?.trim().toLowerCase().startsWith("press_release") === true;
}

function addUtcDays(date: string, days: number): string {
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) {
    return date;
  }
  return new Date(timestamp + days * 86_400_000).toISOString().slice(0, 10);
}

function previousCalendarDate(date: string): string {
  return addUtcDays(date, -1);
}

function newYorkDateParts(iso: string): { date: string; hour: number; minute: number } | null {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

export function newYorkDateKeyForTimestamp(timestampMs: number): string | null {
  if (!Number.isFinite(timestampMs)) {
    return null;
  }
  return newYorkDateParts(new Date(timestampMs).toISOString())?.date ?? null;
}

function dateDiffDays(leftDate: string, rightDate: string): number | null {
  const left = Date.parse(`${leftDate}T12:00:00.000Z`);
  const right = Date.parse(`${rightDate}T12:00:00.000Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }
  return Math.round((left - right) / 86_400_000);
}

function emptyContext(summary: string, timing: PressReleaseCatalystTiming): PressReleaseCatalystContext {
  return {
    source: "local_press_release_db",
    checked: timing !== "lookup_unavailable",
    timing,
    freshness: timing === "lookup_unavailable" ? "lookup_unavailable" : "no_card",
    articleCount: 0,
    primaryArticle: null,
    articles: [],
    summary,
  };
}

export function isFreshActivePressReleaseCatalyst(
  context: PressReleaseCatalystContext | null | undefined,
): boolean {
  return (
    context?.timing === "same_day_premarket" ||
    context?.timing === "same_day_intraday" ||
    context?.timing === "prior_evening"
  );
}

export function derivePressReleaseCatalystContext(args: {
  symbol: string;
  articles: PressReleaseCatalystArticle[];
  referenceDate: string;
  lookbackDays: number;
  lookaheadDays?: number;
  staleAfterDays?: number;
}): PressReleaseCatalystContext {
  const symbol = normalizeSymbol(args.symbol);
  const lookaheadDays = Math.max(0, args.lookaheadDays ?? 0);
  const staleAfterDays = Math.max(0, args.staleAfterDays ?? 7);
  const windowStart = addUtcDays(args.referenceDate, -Math.max(0, args.lookbackDays));
  const windowEnd = addUtcDays(args.referenceDate, lookaheadDays);
  const articles = args.articles
    .filter((article) => normalizeSymbol(article.ticker) === symbol)
    .filter(isPressReleaseCatalystArticle)
    .filter((article) => {
      const parts = newYorkDateParts(article.publishedAt);
      return parts !== null && parts.date >= windowStart && parts.date <= windowEnd;
    });

  if (articles.length === 0) {
    return emptyContext("No local press-release catalyst found in the reference window.", "none");
  }

  const priorDate = previousCalendarDate(args.referenceDate);
  const ranked = articles
    .map((article) => {
      const parts = newYorkDateParts(article.publishedAt);
      let timing: PressReleaseCatalystTiming = "recent_prior";
      let rank = 4;
      if (parts && parts.date === args.referenceDate) {
        const minutes = parts.hour * 60 + parts.minute;
        timing = minutes < 9 * 60 + 30 ? "same_day_premarket" : "same_day_intraday";
        rank = minutes < 9 * 60 + 30 ? 0 : 1;
      } else if (parts && parts.date === priorDate && parts.hour >= 16) {
        timing = "prior_evening";
        rank = 2;
      } else if (parts && parts.date > args.referenceDate) {
        timing = "after_runner_day";
        rank = 6;
      } else if (parts) {
        const ageDays = dateDiffDays(args.referenceDate, parts.date);
        timing = ageDays !== null && ageDays > staleAfterDays ? "stale" : "recent_prior";
        rank = timing === "recent_prior" ? 3 : 5;
      }
      return { article, timing, rank };
    })
    .sort((left, right) => left.rank - right.rank || left.article.publishedAt.localeCompare(right.article.publishedAt));

  const primary = ranked[0]!;
  const primaryParts = newYorkDateParts(primary.article.publishedAt);
  const ageDays = primaryParts ? dateDiffDays(args.referenceDate, primaryParts.date) : null;
  const freshness: PressReleaseCatalystFreshness =
    primary.timing === "same_day_premarket" || primary.timing === "same_day_intraday"
      ? "same_day"
      : ageDays !== null && ageDays >= 0 && ageDays <= 2
        ? "recent_1_2_days"
        : ageDays !== null && ageDays >= 0 && ageDays <= 7
          ? "stale_3_7_days"
          : "no_card";
  const title = primary.article.title ? `: ${primary.article.title}` : "";
  return {
    source: "local_press_release_db",
    checked: true,
    timing: primary.timing,
    freshness,
    articleCount: articles.length,
    primaryArticle: primary.article,
    articles,
    summary: `${primary.timing.replace(/_/g, " ")} at ${primary.article.publishedAt}${title}`,
  };
}

function buildLookupScript(): string {
  return `
const Database = require("better-sqlite3");
const { INGEST_DATABASE_PATH } = require("./lib/config");
const symbols = JSON.parse(process.env.CATALYST_SYMBOLS_JSON || "[]");
const startIso = process.env.CATALYST_START_ISO;
const endIso = process.env.CATALYST_END_ISO;
const db = new Database(INGEST_DATABASE_PATH, { readonly: true, fileMustExist: true });
const placeholders = symbols.map((_, index) => "@s" + index).join(",");
const params = { startIso, endIso };
symbols.forEach((symbol, index) => { params["s" + index] = symbol; });
const websiteRows = placeholders
  ? db.prepare(\`
      SELECT
        ingest_event_id,
        ticker,
        article_url,
        article_path,
        title,
        event_type,
        filing_type,
        route_tag,
        source_url,
        website_published_at,
        observed_at
      FROM website_article_posts
      WHERE UPPER(ticker) IN (\${placeholders})
        AND LOWER(COALESCE(event_type, '')) LIKE 'press_release%'
        AND article_url IS NOT NULL
        AND article_url != ''
        AND datetime(website_published_at) >= datetime(@startIso)
        AND datetime(website_published_at) < datetime(@endIso)
      ORDER BY UPPER(ticker), datetime(website_published_at) ASC, datetime(created_at) ASC
    \`).all(params)
  : [];
const ingestRows = placeholders
  ? db.prepare(\`
      SELECT
        id AS ingest_event_id,
        ticker,
        COALESCE(article_url, selected_document_url, source_hostname, id) AS article_url,
        NULL AS article_path,
        COALESCE(headline, summary, raw_discord_message, article_url, selected_document_url) AS title,
        event_type,
        filing_type,
        route_tag,
        COALESCE(article_url, selected_document_url, source_hostname) AS source_url,
        COALESCE(message_timestamp, observed_at, created_at) AS website_published_at,
        observed_at
      FROM ingest_events
      WHERE UPPER(ticker) IN (\${placeholders})
        AND LOWER(COALESCE(event_type, '')) LIKE 'press_release%'
        AND datetime(COALESCE(message_timestamp, observed_at, created_at)) >= datetime(@startIso)
        AND datetime(COALESCE(message_timestamp, observed_at, created_at)) < datetime(@endIso)
      ORDER BY UPPER(ticker), datetime(COALESCE(message_timestamp, observed_at, created_at)) ASC, datetime(created_at) ASC
    \`).all(params)
  : [];
const articlesBySymbol = {};
const seenBySymbol = {};
function addArticle(row, sourceKind) {
  const key = String(row.ticker || "").toUpperCase();
  if (!key) return;
  const seen = seenBySymbol[key] || new Set();
  const dedupeKey = String(row.ingest_event_id || "") || String(row.article_url || "") + "|" + String(row.website_published_at || "");
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);
  seenBySymbol[key] = seen;
  const article = {
    ingestEventId: row.ingest_event_id,
    ticker: key,
    url: row.article_url,
    articlePath: row.article_path || null,
    title: row.title || null,
    publishedAt: row.website_published_at,
    eventType: row.event_type || null,
    filingType: row.filing_type || null,
    routeTag: row.route_tag || null,
    sourceUrl: row.source_url || null,
    observedAt: row.observed_at || null,
    sourceKind,
  };
  if (!articlesBySymbol[key]) articlesBySymbol[key] = [];
  articlesBySymbol[key].push(article);
}
for (const row of websiteRows) addArticle(row, "website_article_posts");
for (const row of ingestRows) addArticle(row, "ingest_events");
for (const key of Object.keys(articlesBySymbol)) {
  articlesBySymbol[key].sort((left, right) => String(left.publishedAt).localeCompare(String(right.publishedAt)));
}
console.log(JSON.stringify({ available: true, databasePath: INGEST_DATABASE_PATH, articlesBySymbol }));
`;
}

export async function lookupLocalPressReleaseCatalystArticles(args: {
  symbols: string[];
  minReferenceDate: string;
  maxReferenceDate: string;
  lookbackDays: number;
  lookaheadDays?: number;
  enabled?: boolean;
  projectDirectory?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  execFileImpl?: PressReleaseCatalystExecFile;
}): Promise<PressReleaseCatalystLookupResult> {
  const symbols = [...new Set(args.symbols.map(normalizeSymbol).filter(Boolean))].sort();
  if (args.enabled === false || symbols.length === 0) {
    return {
      available: false,
      error: args.enabled === false ? "disabled" : "no_symbols",
      articlesBySymbol: {},
    };
  }

  const startIso = `${addUtcDays(args.minReferenceDate, -Math.max(0, args.lookbackDays))}T00:00:00.000Z`;
  const endIso = `${addUtcDays(args.maxReferenceDate, Math.max(0, args.lookaheadDays ?? 0) + 1)}T00:00:00.000Z`;
  const projectDirectory =
    args.projectDirectory?.trim() ||
    args.env?.TRADERSLINK_PRESS_RELEASE_PROJECT_DIRECTORY?.trim() ||
    DEFAULT_PRESS_RELEASE_PROJECT_DIRECTORY;
  const timeoutMs =
    Number(args.env?.TRADERSLINK_PRESS_RELEASE_CATALYST_LOOKUP_TIMEOUT_MS ?? "") ||
    args.timeoutMs ||
    DEFAULT_LOOKUP_TIMEOUT_MS;
  const run = args.execFileImpl ?? (execFileAsync as PressReleaseCatalystExecFile);

  try {
    const { stdout } = await run(process.execPath, ["-e", buildLookupScript()], {
      cwd: projectDirectory,
      encoding: "utf8",
      maxBuffer: LOOKUP_MAX_BUFFER_BYTES,
      timeout: Math.max(1, Math.floor(timeoutMs)),
      windowsHide: true,
      env: {
        ...process.env,
        ...(args.env ?? {}),
        CATALYST_SYMBOLS_JSON: JSON.stringify(symbols),
        CATALYST_START_ISO: startIso,
        CATALYST_END_ISO: endIso,
      },
    });
    const parsed = JSON.parse(stdout) as PressReleaseCatalystLookupResult;
    return {
      available: parsed.available === true,
      databasePath: parsed.databasePath,
      articlesBySymbol: parsed.articlesBySymbol ?? {},
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
      articlesBySymbol: {},
    };
  }
}

export async function lookupPressReleaseCatalystContextForSymbol(args: {
  symbol: string;
  referenceDate: string;
  lookbackDays: number;
  lookaheadDays?: number;
  enabled?: boolean;
  projectDirectory?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  execFileImpl?: PressReleaseCatalystExecFile;
}): Promise<PressReleaseCatalystContext> {
  const lookup = await lookupLocalPressReleaseCatalystArticles({
    symbols: [args.symbol],
    minReferenceDate: args.referenceDate,
    maxReferenceDate: args.referenceDate,
    lookbackDays: args.lookbackDays,
    lookaheadDays: args.lookaheadDays,
    enabled: args.enabled,
    projectDirectory: args.projectDirectory,
    timeoutMs: args.timeoutMs,
    env: args.env,
    execFileImpl: args.execFileImpl,
  });
  if (!lookup.available) {
    return emptyContext(
      lookup.error ? `Local press-release catalyst lookup unavailable: ${lookup.error}` : "Local press-release catalyst lookup unavailable.",
      "lookup_unavailable",
    );
  }
  const symbol = normalizeSymbol(args.symbol);
  return derivePressReleaseCatalystContext({
    symbol,
    articles: lookup.articlesBySymbol[symbol] ?? [],
    referenceDate: args.referenceDate,
    lookbackDays: args.lookbackDays,
    lookaheadDays: args.lookaheadDays,
  });
}
