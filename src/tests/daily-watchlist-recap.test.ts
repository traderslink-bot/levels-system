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
  const [message] = buildDailyWatchlistRecapMessages("2026-07-20", [
    ticker("LOW", 5),
    ticker("MID", 12, 0.5, 0.56),
    ticker("TOP", 40, 1, 1.4),
  ]);

  assert.ok(message);
  assert.match(message, /A solid day for the live watchlist alerts/);
  assert.doesNotMatch(message, /LOW/);
  assert.ok(message.indexOf("TOP") < message.indexOf("MID"));
  assert.match(message, /\*\*TOP — \+40\.00%\*\*/);
  assert.match(message, /Starting price: \$1\.00/);
  assert.match(message, /Highest after added: \$1\.40/);
  assert.match(message, /Starting price: \$0\.5000/);
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
        tickers: [ticker("TOP", 40, 1, 1.4), ticker("MID", 12, 0.5, 0.56)],
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
  assert.deepEqual(JSON.parse(readFileSync(receiptPath, "utf8")), {
    lastCompletedDate: "2026-07-20",
    completedAt: Date.parse("2026-07-20T19:55:00Z"),
    postedTickerCount: 2,
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
