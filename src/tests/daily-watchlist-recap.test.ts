import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DailyWatchlistRecapService,
  buildDailyWatchlistRecapMessages,
  deriveDailyWatchlistRecapSourceUrl,
  type DailyWatchlistRecapTicker,
} from "../lib/live-watchlist/daily-watchlist-recap.js";

function ticker(
  symbol: string,
  potentialGainPct: number,
  startingPrice = 1,
  highPrice = 1.2,
): DailyWatchlistRecapTicker {
  return {
    symbol,
    postedAt: Date.parse("2026-07-20T14:00:00Z"),
    startingPrice,
    startingPriceAt: Date.parse("2026-07-20T14:00:00Z"),
    highPrice,
    highPriceAt: Date.parse("2026-07-20T15:00:00Z"),
    potentialGainPct,
  };
}

test("daily recap formatting filters 5 percent, sorts gains, and includes requested fields", () => {
  const messages = buildDailyWatchlistRecapMessages("2026-07-20", [
    ticker("LOW", 5),
    ticker("FOURTH", 11),
    ticker("SECOND", 30, 0.5, 0.65),
    ticker("TOP", 40, 1, 1.4),
    ticker("THIRD", 20),
  ]);
  const [message] = messages;

  assert.equal(messages.length, 1);
  assert.ok(message);
  assert.match(message, /^@everyone\n/);
  assert.match(message, /Today's Top Watchlist Alerts/);
  assert.match(message, /today's strongest gainers/);
  assert.doesNotMatch(message, /LOW/);
  assert.doesNotMatch(message, /FOURTH/);
  assert.ok(message.indexOf("TOP") < message.indexOf("SECOND"));
  assert.ok(message.indexOf("SECOND") < message.indexOf("THIRD"));
  assert.match(message, /\*\*TOP — \+40\.00%\*\*/);
  assert.match(message, /Alerted: \$1\.00/);
  assert.match(message, /Highest after added: \$1\.40/);
  assert.match(message, /Alerted: \$0\.5000/);
});

test("daily recap shows one or two tickers when fewer than three qualify", () => {
  const [twoTickerMessage] = buildDailyWatchlistRecapMessages("2026-07-20", [
    ticker("ONE", 18),
    ticker("TWO", 9),
  ]);
  assert.match(twoTickerMessage ?? "", /ONE/);
  assert.match(twoTickerMessage ?? "", /TWO/);

  const [oneTickerMessage] = buildDailyWatchlistRecapMessages("2026-07-20", [
    ticker("ONLY", 8),
  ]);
  assert.match(oneTickerMessage ?? "", /ONLY/);
});

test("daily recap service posts once during the weekday 3:55 ET window", async () => {
  const directory = mkdtempSync(join(tmpdir(), "watchlist-recap-"));
  const receiptPath = join(directory, "receipt.json");
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("https://example.test/api/live-watchlist/recap")) {
      return Response.json({
        date: "2026-07-20",
        tickers: [
          ticker("FOURTH", 11),
          ticker("TOP", 40, 1, 1.4),
          ticker("SECOND", 30, 0.5, 0.65),
          ticker("FIFTH", 8),
          ticker("THIRD", 20),
        ],
      });
    }
    return Response.json({ id: "discord-message" });
  };
  const service = new DailyWatchlistRecapService({
    sourceUrl: "https://example.test/api/live-watchlist/recap",
    sourceToken: "publisher-token",
    webhookUrl: "https://discord.com/api/webhooks/test/token",
    receiptPath,
    fetchImpl,
    now: () => Date.parse("2026-07-20T19:55:00Z"),
    logger: { log() {}, warn() {} },
  });

  assert.equal(await service.checkNow(), "posted");
  assert.equal(await service.checkNow(), "already_completed");
  assert.equal(calls.length, 2);
  assert.match(calls[0]?.url ?? "", /date=2026-07-20/);
  assert.equal(calls[0]?.init?.headers && (calls[0].init.headers as Record<string, string>).Authorization, "Bearer publisher-token");
  assert.match(calls[1]?.url ?? "", /wait=true/);
  assert.doesNotMatch(JSON.stringify(calls[1]?.init), /publisher-token/);
  const discordPayload = JSON.parse(String(calls[1]?.init?.body)) as {
    content: string;
    allowed_mentions: { parse: string[] };
  };
  assert.match(discordPayload.content, /^@everyone\n/);
  assert.match(discordPayload.content, /TOP/);
  assert.match(discordPayload.content, /SECOND/);
  assert.match(discordPayload.content, /THIRD/);
  assert.doesNotMatch(discordPayload.content, /FOURTH|FIFTH/);
  assert.deepEqual(discordPayload.allowed_mentions, { parse: ["everyone"] });
  assert.deepEqual(JSON.parse(readFileSync(receiptPath, "utf8")), {
    lastCompletedDate: "2026-07-20",
    completedAt: Date.parse("2026-07-20T19:55:00Z"),
    postedTickerCount: 3,
  });
});

test("daily recap service stays quiet outside the schedule and when no ticker clears 5 percent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "watchlist-recap-empty-"));
  const receiptPath = join(directory, "receipt.json");
  let now = Date.parse("2026-07-19T19:55:00Z");
  let webhookPosts = 0;
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes("discord.com")) {
      webhookPosts += 1;
      return Response.json({});
    }
    return Response.json({ date: "2026-07-20", tickers: [ticker("FIVE", 5)] });
  };
  const service = new DailyWatchlistRecapService({
    sourceUrl: "https://example.test/api/live-watchlist/recap",
    sourceToken: "publisher-token",
    webhookUrl: "https://discord.com/api/webhooks/test/token",
    receiptPath,
    fetchImpl,
    now: () => now,
    logger: { log() {}, warn() {} },
  });

  assert.equal(await service.checkNow(), "outside_window");
  now = Date.parse("2026-07-20T19:55:00Z");
  assert.equal(await service.checkNow(), "no_qualifying_tickers");
  assert.equal(webhookPosts, 0);
});

test("recap source URL is derived beside the existing ingest route", () => {
  assert.equal(
    deriveDailyWatchlistRecapSourceUrl(
      "https://traderslink.pro/api/live-watchlist/ingest",
    ),
    "https://traderslink.pro/api/live-watchlist/recap",
  );
});
