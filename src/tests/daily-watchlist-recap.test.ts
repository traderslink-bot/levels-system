import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DailyWatchlistRecapService,
  ReviewedDailyWatchlistRecapPoster,
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

test("reviewed recap poster appends configured mentions and is durably idempotent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "reviewed-watchlist-recap-"));
  const receiptPath = join(directory, "receipts.json");
  const payloads: Array<{ content: string; allowed_mentions: unknown }> = [];
  const poster = new ReviewedDailyWatchlistRecapPoster({
    webhookUrl: "https://discord.com/api/webhooks/test/token",
    premiumRoleId: "123456789012345678",
    receiptPath,
    now: () => 1_788_900_000_000,
    fetchImpl: async (_input, init) => {
      payloads.push(JSON.parse(String(init?.body)) as typeof payloads[number]);
      return Response.json({ id: "message-1", channel_id: "channel-1" });
    },
  });
  const idempotencyKey = "12345678-1234-4123-8123-123456789abc";

  const first = await poster.post("PDSB made a 30.0% move.", idempotencyKey);
  const repeated = await poster.post("PDSB made a 30.0% move.", idempotencyKey);

  assert.deepEqual(repeated, first);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0]?.content, "PDSB made a 30.0% move.\n\n@everyone\n<@&123456789012345678>");
  assert.deepEqual(payloads[0]?.allowed_mentions, {
    parse: ["everyone"],
    roles: ["123456789012345678"],
  });
  assert.deepEqual(first, {
    idempotencyKey,
    postedAt: 1_788_900_000_000,
    discordMessageId: "message-1",
    discordChannelId: "channel-1",
  });
});

test("reviewed recap poster rejects owner-body mentions before Discord", () => {
  const poster = new ReviewedDailyWatchlistRecapPoster({
    webhookUrl: "https://discord.com/api/webhooks/test/token",
    premiumRoleId: "123456789012345678",
    fetchImpl: async () => {
      throw new Error("must not post");
    },
  });
  assert.throws(
    () => poster.post("PDSB moved higher. @everyone", "12345678-1234-4123-8123-123456789abc"),
    /Invalid reviewed recap body/u,
  );
});

test("lost Discord response leaves a durable uncertain attempt and never resends on retry", async () => {
  const receiptPath = join(mkdtempSync(join(tmpdir(), "recap-uncertain-")), "receipts.json");
  let sends = 0;
  const options = {
    webhookUrl: "https://example.test/webhook", premiumRoleId: "123456789012345678", receiptPath,
    fetchImpl: (async () => { sends += 1; throw new Error("response lost"); }) as typeof fetch,
  };
  const key = "12345678-1234-4123-8123-123456789abc";
  await assert.rejects(new ReviewedDailyWatchlistRecapPoster(options).post("PDSB recap", key), /response lost/);
  assert.throws(() => new ReviewedDailyWatchlistRecapPoster(options).post("PDSB recap", key), /reconciliation/);
  assert.equal(sends, 1);
});

test("a long owner paragraph is split and completed delivery survives restart", async () => {
  const receiptPath = join(mkdtempSync(join(tmpdir(), "recap-long-")), "receipts.json");
  const sent: string[] = [];
  const options = {
    webhookUrl: "https://example.test/webhook", premiumRoleId: "123456789012345678", receiptPath,
    fetchImpl: (async (_input, init) => {
      sent.push(JSON.parse(String(init?.body)).content as string);
      return Response.json({ id: String(sent.length), channel_id: "channel-1" });
    }) as typeof fetch,
  };
  const key = "12345678-1234-4123-8123-123456789abc";
  const body = "PDSB moved higher. ".repeat(150);
  const first = await new ReviewedDailyWatchlistRecapPoster(options).post(body, key);
  assert.equal(sent.length, 2);
  assert.ok(sent.every((content) => content.length <= 2000));
  assert.deepEqual(await new ReviewedDailyWatchlistRecapPoster(options).post(body, key), first);
  assert.equal(sent.length, 2);
  assert.throws(() => new ReviewedDailyWatchlistRecapPoster(options).post("Different text", key), /key reuse/);
});

test("explicit Discord rate-limit rejection can retry the same attempt", async () => {
  const receiptPath = join(mkdtempSync(join(tmpdir(), "recap-rejected-")), "receipts.json");
  let sends = 0;
  const poster = new ReviewedDailyWatchlistRecapPoster({ webhookUrl: "https://example.test/webhook", premiumRoleId: "123456789012345678", receiptPath,
    fetchImpl: async () => { sends += 1; return sends === 1 ? new Response("", { status: 429 }) : Response.json({ id: "message-1", channel_id: "channel-1" }); },
  });
  const key = "12345678-1234-4123-8123-123456789abc";
  await assert.rejects(poster.post("PDSB recap", key), /429/);
  assert.equal((await poster.post("PDSB recap", key)).discordMessageId, "message-1");
  assert.equal(sends, 2);
});

test("owner confirmation of an already delivered message avoids resending it", async () => {
  const receiptPath = join(mkdtempSync(join(tmpdir(), "recap-confirmed-")), "receipts.json");
  let sends = 0;
  const poster = new ReviewedDailyWatchlistRecapPoster({ webhookUrl: "https://example.test/webhook", premiumRoleId: "123456789012345678", receiptPath,
    fetchImpl: async () => { sends += 1; throw new Error("lost response"); },
  });
  const key = "12345678-1234-4123-8123-123456789abc";
  await assert.rejects(poster.post("PDSB recap", key));
  const receipt = await poster.post("PDSB recap", key, { outcome: "posted", messageId: "123456789012345678", channelId: "223456789012345678" });
  assert.equal(receipt.discordMessageId, "123456789012345678");
  assert.equal(sends, 1);
});

test("owner confirmation that the uncertain message is absent allows retry", async () => {
  const receiptPath = join(mkdtempSync(join(tmpdir(), "recap-absent-")), "receipts.json");
  let sends = 0;
  const poster = new ReviewedDailyWatchlistRecapPoster({ webhookUrl: "https://example.test/webhook", premiumRoleId: "123456789012345678", receiptPath,
    fetchImpl: async () => { sends += 1; if (sends === 1) throw new Error("lost response"); return Response.json({ id: "message-1", channel_id: "channel-1" }); },
  });
  const key = "12345678-1234-4123-8123-123456789abc";
  await assert.rejects(poster.post("PDSB recap", key));
  assert.equal((await poster.post("PDSB recap", key, { outcome: "not_posted" })).discordMessageId, "message-1");
  assert.equal(sends, 2);
});
