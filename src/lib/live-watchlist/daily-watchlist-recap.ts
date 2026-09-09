import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

export const DAILY_WATCHLIST_RECAP_WEBHOOK_ENV =
  "DISCORD_WATCHLIST_DAILY_RECAP_WEBHOOK_URL";
export const DAILY_WATCHLIST_RECAP_SOURCE_URL_ENV =
  "TRADERSLINK_WATCHLIST_RECAP_URL";
export const DEFAULT_DAILY_WATCHLIST_RECAP_RECEIPT_FILE = resolve(
  process.cwd(),
  "artifacts",
  "watchlist-daily-recap-receipt.json",
);
export const DEFAULT_REVIEWED_DAILY_WATCHLIST_RECAP_RECEIPT_FILE = resolve(
  process.cwd(),
  "artifacts",
  "reviewed-watchlist-daily-recap-receipts.json",
);

const DEFAULT_POST_MINUTES_EASTERN = 15 * 60 + 55;
const DEFAULT_CATCH_UP_WINDOW_MINUTES = 20;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MINIMUM_GAIN_PCT_EXCLUSIVE = 5;
const MAX_RECAP_TICKERS = 3;
const WATCHLIST_RECAP_SOURCE_TIMEOUT_MS = 15_000;
const DISCORD_WEBHOOK_TIMEOUT_MS = 15_000;
const MAX_REVIEWED_RECAP_BODY_LENGTH = 4_000;

export type ReviewedDailyWatchlistRecapReceipt = {
  idempotencyKey: string;
  postedAt: number;
  discordMessageId: string | null;
  discordChannelId: string | null;
};

type ReviewedDailyWatchlistRecapReceiptStore = {
  receipts: Record<string, ReviewedDailyWatchlistRecapReceipt>;
  attempts?: Record<string, { bodyHash: string; pending: boolean; messages: Array<{ id: string; channel_id: string }> }>;
};

export type ReviewedDailyWatchlistRecapPosterOptions = {
  webhookUrl: string;
  premiumRoleId: string;
  receiptPath?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

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
    `Alerted: $${formatPrice(ticker.startingPrice)}`,
    `Highest after added: $${formatPrice(ticker.highPrice)}`,
  ].join("\n");
}

function recapIntro(dateKey: string): string {
  return [
    "@everyone",
    `**Today's Top Watchlist Alerts — ${dateKey}**`,
    "These were today's strongest gainers after we alerted them to the TradersLink Live Watchlist:",
  ].join("\n");
}

export function buildDailyWatchlistRecapMessages(
  dateKey: string,
  tickers: DailyWatchlistRecapTicker[],
): string[] {
  const topTickers = tickers
    .map(normalizeTicker)
    .filter((ticker): ticker is DailyWatchlistRecapTicker => Boolean(ticker))
    .sort(
      (left, right) =>
        right.potentialGainPct - left.potentialGainPct ||
        left.symbol.localeCompare(right.symbol),
    )
    .slice(0, MAX_RECAP_TICKERS);
  if (topTickers.length === 0) {
    return [];
  }

  return [[recapIntro(dateKey), ...topTickers.map(tickerBlock)].join("\n\n")];
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

function loadReviewedReceipts(path: string): ReviewedDailyWatchlistRecapReceiptStore {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ReviewedDailyWatchlistRecapReceiptStore>;
    if (!parsed || !parsed.receipts || typeof parsed.receipts !== "object" || Array.isArray(parsed.receipts)) throw new Error("Invalid recap receipt store.");
    return { receipts: parsed.receipts, attempts: parsed.attempts ?? {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { receipts: {}, attempts: {} };
    throw new Error("Reviewed recap receipt store is unavailable.");
  }
}

function saveReviewedReceipts(
  path: string,
  store: ReviewedDailyWatchlistRecapReceiptStore,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function assertReviewedRecapInput(bodyText: string, idempotencyKey: string): void {
  if (
    !bodyText ||
    bodyText.length > MAX_REVIEWED_RECAP_BODY_LENGTH ||
    /@everyone|@here|<@/iu.test(bodyText)
  ) {
    throw new Error("Invalid reviewed recap body.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(idempotencyKey)) {
    throw new Error("Invalid reviewed recap idempotency key.");
  }
}

function splitReviewedRecapBody(bodyText: string, finalSuffix: string): string[] {
  const maximumBodyLength = 2_000 - finalSuffix.length;
  const paragraphs = bodyText.split(/\n{2,}/u);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > maximumBodyLength) {
      if (current) { chunks.push(current); current = ""; }
      let remaining = paragraph;
      while (remaining.length > maximumBodyLength) {
        let cut = remaining.lastIndexOf(" ", maximumBodyLength);
        if (cut < 1) cut = maximumBodyLength;
        if (/[\uD800-\uDBFF]/u.test(remaining[cut - 1])) cut -= 1;
        chunks.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut);
      }
      current = remaining;
      continue;
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maximumBodyLength) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  if (chunks.length === 0) throw new Error("Invalid reviewed recap body.");
  chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}${finalSuffix}`;
  return chunks;
}

export class ReviewedDailyWatchlistRecapPoster {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly receiptPath: string;
  private readonly inFlight = new Map<string, Promise<ReviewedDailyWatchlistRecapReceipt>>();

  constructor(private readonly options: ReviewedDailyWatchlistRecapPosterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.receiptPath = options.receiptPath ?? DEFAULT_REVIEWED_DAILY_WATCHLIST_RECAP_RECEIPT_FILE;
  }

  post(bodyTextValue: unknown, idempotencyKeyValue: unknown): Promise<ReviewedDailyWatchlistRecapReceipt> {
    const bodyText = typeof bodyTextValue === "string" ? bodyTextValue.trim() : "";
    const idempotencyKey = typeof idempotencyKeyValue === "string" ? idempotencyKeyValue.trim() : "";
    assertReviewedRecapInput(bodyText, idempotencyKey);
    const stored = loadReviewedReceipts(this.receiptPath);
    const bodyHash = createHash("sha256").update(bodyText).digest("hex");
    if (stored.attempts?.[idempotencyKey] && stored.attempts[idempotencyKey].bodyHash !== bodyHash) throw new Error("Invalid reviewed recap key reuse.");
    const prior = stored.receipts[idempotencyKey];
    if (prior) return Promise.resolve(prior);
    const active = this.inFlight.get(idempotencyKey);
    if (active) return active;
    if (stored.attempts?.[idempotencyKey]?.pending) throw new Error("Reviewed recap delivery needs reconciliation before retry.");
    const promise = this.postOnce(bodyText, idempotencyKey).finally(() => {
      this.inFlight.delete(idempotencyKey);
    });
    this.inFlight.set(idempotencyKey, promise);
    return promise;
  }

  private async postOnce(
    bodyText: string,
    idempotencyKey: string,
  ): Promise<ReviewedDailyWatchlistRecapReceipt> {
    const suffix = `\n\n@everyone\n<@&${this.options.premiumRoleId}>`;
    const messages = splitReviewedRecapBody(bodyText, suffix);
    let lastMessage: { id?: unknown; channel_id?: unknown } = {};
    const initial = loadReviewedReceipts(this.receiptPath);
    const attempt = initial.attempts?.[idempotencyKey] ?? { bodyHash: createHash("sha256").update(bodyText).digest("hex"), pending: false, messages: [] };
    for (const content of messages.slice(attempt.messages.length)) {
      attempt.pending = true;
      const beforeSend = loadReviewedReceipts(this.receiptPath);
      beforeSend.attempts = { ...beforeSend.attempts, [idempotencyKey]: attempt };
      saveReviewedReceipts(this.receiptPath, beforeSend);
      const webhookUrl = new URL(this.options.webhookUrl);
      webhookUrl.searchParams.set("wait", "true");
      const response = await fetchWithTimeout(this.fetchImpl, webhookUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          allowed_mentions: { parse: ["everyone"], roles: [this.options.premiumRoleId] },
        }),
      }, DISCORD_WEBHOOK_TIMEOUT_MS);
      if (!response.ok) throw new Error(`Discord reviewed recap webhook failed with ${response.status}.`);
      lastMessage = await response.json() as { id?: unknown; channel_id?: unknown };
      if (typeof lastMessage.id !== "string" || typeof lastMessage.channel_id !== "string") throw new Error("Reviewed recap delivery receipt is invalid.");
      attempt.messages.push({ id: lastMessage.id, channel_id: lastMessage.channel_id });
      attempt.pending = false;
      const afterSend = loadReviewedReceipts(this.receiptPath);
      afterSend.attempts = { ...afterSend.attempts, [idempotencyKey]: attempt };
      saveReviewedReceipts(this.receiptPath, afterSend);
    }
    lastMessage = attempt.messages.at(-1) ?? {};
    const receipt = Object.freeze({
      idempotencyKey,
      postedAt: this.now(),
      discordMessageId: typeof lastMessage.id === "string" ? lastMessage.id : null,
      discordChannelId: typeof lastMessage.channel_id === "string" ? lastMessage.channel_id : null,
    });
    const store = loadReviewedReceipts(this.receiptPath);
    store.receipts[idempotencyKey] = receipt;
    saveReviewedReceipts(this.receiptPath, store);
    return receipt;
  }
}

export function createReviewedDailyWatchlistRecapPosterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  defaultReceiptPath: string = DEFAULT_REVIEWED_DAILY_WATCHLIST_RECAP_RECEIPT_FILE,
): ReviewedDailyWatchlistRecapPoster | null {
  const webhookUrl = env[DAILY_WATCHLIST_RECAP_WEBHOOK_ENV]?.trim();
  const premiumRoleId = env.DISCORD_PREMIUM_ROLE_ID?.trim();
  if (!webhookUrl || !premiumRoleId || !/^\d{10,25}$/u.test(premiumRoleId)) return null;
  return new ReviewedDailyWatchlistRecapPoster({
    webhookUrl,
    premiumRoleId,
    receiptPath: env.WATCHLIST_REVIEWED_DAILY_RECAP_RECEIPT_PATH?.trim()
      || defaultReceiptPath,
  });
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

    const postedTickerCount = Math.min(
      qualifyingTickers.length,
      MAX_RECAP_TICKERS,
    );
    saveReceipt(this.receiptPath, {
      lastCompletedDate: clock.dateKey,
      completedAt: timestamp,
      postedTickerCount,
    });
    this.logger.log(
      `[DailyWatchlistRecap] Posted ${postedTickerCount} ticker(s) for ${clock.dateKey}.`,
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
