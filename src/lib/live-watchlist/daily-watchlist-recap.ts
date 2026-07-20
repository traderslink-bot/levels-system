import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DAILY_WATCHLIST_RECAP_WEBHOOK_ENV =
  "DISCORD_WATCHLIST_DAILY_RECAP_WEBHOOK_URL";
export const DAILY_WATCHLIST_RECAP_SOURCE_URL_ENV =
  "TRADERSLINK_WATCHLIST_RECAP_URL";
export const DEFAULT_DAILY_WATCHLIST_RECAP_RECEIPT_FILE = resolve(
  process.cwd(),
  "artifacts",
  "watchlist-daily-recap-receipt.json",
);

const DEFAULT_POST_MINUTES_EASTERN = 15 * 60 + 55;
const DEFAULT_CATCH_UP_WINDOW_MINUTES = 20;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DISCORD_MESSAGE_MAX_LENGTH = 2_000;
const MINIMUM_GAIN_PCT_EXCLUSIVE = 5;
const WATCHLIST_RECAP_SOURCE_TIMEOUT_MS = 15_000;
const DISCORD_WEBHOOK_TIMEOUT_MS = 15_000;

export type DailyWatchlistRecapTicker = {
  symbol: string;
  postedAt: number;
  startingPrice: number;
  startingPriceAt: number;
  highPrice: number;
  highPriceAt: number;
  potentialGainPct: number;
};

type DailyWatchlistRecapSourceResponse = {
  date: string;
  tickers: DailyWatchlistRecapTicker[];
};

type DailyWatchlistRecapReceipt = {
  lastCompletedDate: string | null;
  completedAt: number | null;
  postedTickerCount: number;
};

export type DailyWatchlistRecapCheckResult =
  | "outside_window"
  | "already_completed"
  | "no_qualifying_tickers"
  | "posted"
  | "in_flight";

export type DailyWatchlistRecapServiceOptions = {
  sourceUrl: string;
  sourceToken: string;
  webhookUrl: string;
  receiptPath?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  pollIntervalMs?: number;
  postMinutesEastern?: number;
  catchUpWindowMinutes?: number;
  logger?: Pick<Console, "log" | "warn">;
};

const EASTERN_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function easternClock(timestamp: number): {
  dateKey: string;
  weekday: string;
  minutes: number;
} {
  const parts = EASTERN_CLOCK_FORMATTER.formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    dateKey: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: value("weekday"),
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function isWeekday(weekday: string): boolean {
  return weekday !== "Sat" && weekday !== "Sun";
}

function validPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeTicker(value: unknown): DailyWatchlistRecapTicker | null {
  const candidate = value as Partial<DailyWatchlistRecapTicker> | null;
  const symbol = typeof candidate?.symbol === "string"
    ? candidate.symbol.trim().toUpperCase()
    : "";
  if (
    !/^[A-Z0-9.-]{1,20}$/.test(symbol) ||
    !Number.isFinite(candidate?.postedAt) ||
    !Number.isFinite(candidate?.startingPriceAt) ||
    !Number.isFinite(candidate?.highPriceAt) ||
    !validPositiveNumber(candidate?.startingPrice) ||
    !validPositiveNumber(candidate?.highPrice) ||
    !Number.isFinite(candidate?.potentialGainPct) ||
    Number(candidate?.potentialGainPct) <= MINIMUM_GAIN_PCT_EXCLUSIVE
  ) {
    return null;
  }

  return {
    symbol,
    postedAt: Number(candidate.postedAt),
    startingPrice: candidate.startingPrice,
    startingPriceAt: Number(candidate.startingPriceAt),
    highPrice: candidate.highPrice,
    highPriceAt: Number(candidate.highPriceAt),
    potentialGainPct: Number(candidate.potentialGainPct),
  };
}

function formatPrice(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function tickerBlock(ticker: DailyWatchlistRecapTicker): string {
  return [
    `**${ticker.symbol} — +${ticker.potentialGainPct.toFixed(2)}%**`,
    `Starting price: $${formatPrice(ticker.startingPrice)}`,
    `Highest after added: $${formatPrice(ticker.highPrice)}`,
  ].join("\n");
}

function recapIntro(dateKey: string, continuation = false): string {
  return continuation
    ? [
        `**TradersLink Live Watchlist Recap — ${dateKey} (continued)**`,
        "More follow-through from tickers alerted to the live watchlist:",
      ].join("\n")
    : [
        "@everyone",
        `**TradersLink Live Watchlist Recap — ${dateKey}**`,
        "A solid day for the live watchlist alerts. These tickers gained more than 5% after we added them:",
      ].join("\n");
}

export function buildDailyWatchlistRecapMessages(
  dateKey: string,
  tickers: DailyWatchlistRecapTicker[],
): string[] {
  const sorted = tickers
    .map(normalizeTicker)
    .filter((ticker): ticker is DailyWatchlistRecapTicker => Boolean(ticker))
    .sort(
      (left, right) =>
        right.potentialGainPct - left.potentialGainPct ||
        left.symbol.localeCompare(right.symbol),
    );
  if (sorted.length === 0) {
    return [];
  }

  const messages: string[] = [];
  let current = recapIntro(dateKey);
  for (const ticker of sorted) {
    const block = tickerBlock(ticker);
    const candidate = `${current}\n\n${block}`;
    if (candidate.length <= DISCORD_MESSAGE_MAX_LENGTH) {
      current = candidate;
      continue;
    }
    messages.push(current);
    current = `${recapIntro(dateKey, true)}\n\n${block}`;
  }
  messages.push(current);
  return messages;
}

export function deriveDailyWatchlistRecapSourceUrl(ingestUrl: string): string {
  const url = new URL(ingestUrl);
  if (!/\/ingest\/?$/.test(url.pathname)) {
    throw new Error(
      "TRADERSLINK_WATCHLIST_INGEST_URL must end with /ingest to derive the recap URL.",
    );
  }
  url.pathname = url.pathname.replace(/\/ingest\/?$/, "/recap");
  url.search = "";
  url.hash = "";
  return url.toString();
}

function loadReceipt(path: string): DailyWatchlistRecapReceipt {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DailyWatchlistRecapReceipt>;
    return {
      lastCompletedDate:
        typeof parsed.lastCompletedDate === "string" ? parsed.lastCompletedDate : null,
      completedAt: typeof parsed.completedAt === "number" ? parsed.completedAt : null,
      postedTickerCount:
        typeof parsed.postedTickerCount === "number" ? parsed.postedTickerCount : 0,
    };
  } catch {
    return { lastCompletedDate: null, completedAt: null, postedTickerCount: 0 };
  }
}

function saveReceipt(path: string, receipt: DailyWatchlistRecapReceipt): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export class DailyWatchlistRecapService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly pollIntervalMs: number;
  private readonly postMinutesEastern: number;
  private readonly catchUpWindowMinutes: number;
  private readonly receiptPath: string;
  private readonly logger: Pick<Console, "log" | "warn">;
  private timer: ReturnType<typeof setInterval> | null = null;
  private checkPromise: Promise<DailyWatchlistRecapCheckResult> | null = null;

  constructor(private readonly options: DailyWatchlistRecapServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.postMinutesEastern =
      options.postMinutesEastern ?? DEFAULT_POST_MINUTES_EASTERN;
    this.catchUpWindowMinutes =
      options.catchUpWindowMinutes ?? DEFAULT_CATCH_UP_WINDOW_MINUTES;
    this.receiptPath = options.receiptPath ?? DEFAULT_DAILY_WATCHLIST_RECAP_RECEIPT_FILE;
    this.logger = options.logger ?? console;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    void this.checkNow().catch((error) => this.logFailure(error));
    this.timer = setInterval(() => {
      void this.checkNow().catch((error) => this.logFailure(error));
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkNow(): Promise<DailyWatchlistRecapCheckResult> {
    if (this.checkPromise) {
      return "in_flight";
    }
    this.checkPromise = this.runCheck();
    try {
      return await this.checkPromise;
    } finally {
      this.checkPromise = null;
    }
  }

  private async runCheck(): Promise<DailyWatchlistRecapCheckResult> {
    const timestamp = this.now();
    const clock = easternClock(timestamp);
    if (
      !isWeekday(clock.weekday) ||
      clock.minutes < this.postMinutesEastern ||
      clock.minutes > this.postMinutesEastern + this.catchUpWindowMinutes
    ) {
      return "outside_window";
    }

    const receipt = loadReceipt(this.receiptPath);
    if (receipt.lastCompletedDate === clock.dateKey) {
      return "already_completed";
    }

    const sourceUrl = new URL(this.options.sourceUrl);
    sourceUrl.searchParams.set("date", clock.dateKey);
    const sourceResponse = await fetchWithTimeout(
      this.fetchImpl,
      sourceUrl.toString(),
      {
        method: "GET",
        headers: { Authorization: `Bearer ${this.options.sourceToken}` },
      },
      WATCHLIST_RECAP_SOURCE_TIMEOUT_MS,
    );
    if (!sourceResponse.ok) {
      throw new Error(`Watchlist recap source failed with ${sourceResponse.status}.`);
    }
    const payload = (await sourceResponse.json()) as Partial<DailyWatchlistRecapSourceResponse>;
    if (payload.date !== clock.dateKey || !Array.isArray(payload.tickers)) {
      throw new Error("Watchlist recap source returned an invalid payload.");
    }

    const qualifyingTickers = payload.tickers
      .map(normalizeTicker)
      .filter((ticker): ticker is DailyWatchlistRecapTicker => Boolean(ticker));
    const messages = buildDailyWatchlistRecapMessages(clock.dateKey, qualifyingTickers);
    if (messages.length === 0) {
      saveReceipt(this.receiptPath, {
        lastCompletedDate: clock.dateKey,
        completedAt: timestamp,
        postedTickerCount: 0,
      });
      this.logger.log(
        `[DailyWatchlistRecap] No tickers above 5% for ${clock.dateKey}; no Discord post was sent.`,
      );
      return "no_qualifying_tickers";
    }

    for (const content of messages) {
      const webhookUrl = new URL(this.options.webhookUrl);
      webhookUrl.searchParams.set("wait", "true");
      const webhookResponse = await fetchWithTimeout(
        this.fetchImpl,
        webhookUrl.toString(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            allowed_mentions: { parse: ["everyone"] },
          }),
        },
        DISCORD_WEBHOOK_TIMEOUT_MS,
      );
      if (!webhookResponse.ok) {
        throw new Error(`Discord daily recap webhook failed with ${webhookResponse.status}.`);
      }
    }

    saveReceipt(this.receiptPath, {
      lastCompletedDate: clock.dateKey,
      completedAt: timestamp,
      postedTickerCount: qualifyingTickers.length,
    });
    this.logger.log(
      `[DailyWatchlistRecap] Posted ${qualifyingTickers.length} ticker(s) for ${clock.dateKey}.`,
    );
    return "posted";
  }

  private logFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`[DailyWatchlistRecap] ${message}`);
  }
}

export function createDailyWatchlistRecapServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DailyWatchlistRecapService | null {
  const webhookUrl = env[DAILY_WATCHLIST_RECAP_WEBHOOK_ENV]?.trim();
  if (!webhookUrl) {
    return null;
  }
  const sourceToken = env.TRADERSLINK_WATCHLIST_PUBLISHER_TOKEN?.trim();
  const sourceUrl =
    env[DAILY_WATCHLIST_RECAP_SOURCE_URL_ENV]?.trim() ||
    (env.TRADERSLINK_WATCHLIST_INGEST_URL?.trim()
      ? deriveDailyWatchlistRecapSourceUrl(env.TRADERSLINK_WATCHLIST_INGEST_URL.trim())
      : "");
  if (!sourceToken || !sourceUrl) {
    return null;
  }

  return new DailyWatchlistRecapService({
    webhookUrl,
    sourceToken,
    sourceUrl,
    receiptPath:
      env.WATCHLIST_DAILY_RECAP_RECEIPT_PATH?.trim() ||
      DEFAULT_DAILY_WATCHLIST_RECAP_RECEIPT_FILE,
  });
}
