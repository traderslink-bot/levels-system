import assert from "node:assert/strict";
import test from "node:test";

import { DiscordRestThreadGateway } from "../lib/alerts/discord-rest-thread-gateway.js";

type MockResponseInit = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

function jsonResponse(init: MockResponseInit = {}): Response {
  return new Response(init.body === undefined ? "" : JSON.stringify(init.body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

test("DiscordRestThreadGateway creates a symbol thread under the configured watchlist channel", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init });

    if (calls.length === 1) {
      return jsonResponse({ body: { id: "message-1" } });
    }

    return jsonResponse({ body: { id: "thread-1", name: "ALBT", parent_id: "watchlist-1" } });
  };

  const gateway = new DiscordRestThreadGateway({
    botToken: "token",
    watchlistChannelId: "watchlist-1",
    fetchImpl,
  });

  const thread = await gateway.createThread("ALBT");

  assert.deepEqual(thread, {
    id: "thread-1",
    name: "ALBT",
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.input, "https://discord.com/api/v10/channels/watchlist-1/messages");
  assert.equal(calls[1]?.input, "https://discord.com/api/v10/channels/watchlist-1/messages/message-1/threads");
  assert.match(String(calls[0]?.init?.body), /"content":"ALBT"/);
  assert.match(String(calls[1]?.init?.body), /"name":"ALBT"/);
});

test("DiscordRestThreadGateway reuses only threads under the configured watchlist channel", async () => {
  const fetchImpl: typeof fetch = async () =>
    jsonResponse({
      body: {
        id: "thread-1",
        name: "ALBT",
        parent_id: "watchlist-1",
      },
    });

  const gateway = new DiscordRestThreadGateway({
    botToken: "token",
    watchlistChannelId: "watchlist-1",
    fetchImpl,
  });

  const thread = await gateway.getThreadById("thread-1");

  assert.deepEqual(thread, {
    id: "thread-1",
    name: "ALBT",
  });
});

test("DiscordRestThreadGateway recovers a thread by exact symbol name from active or archived threads", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);

    if (url.includes("/guilds/guild-1/threads/active")) {
      return jsonResponse({
        body: {
          threads: [
            { id: "thread-x", name: "OTHER", parent_id: "watchlist-1" },
            { id: "thread-bird", name: "BIRD", parent_id: "watchlist-1" },
          ],
        },
      });
    }

    return jsonResponse({ body: { threads: [] } });
  };

  const gateway = new DiscordRestThreadGateway({
    botToken: "token",
    watchlistChannelId: "watchlist-1",
    guildId: "guild-1",
    fetchImpl,
  });

  const thread = await gateway.findThreadByName("BIRD");

  assert.deepEqual(thread, {
    id: "thread-bird",
    name: "BIRD",
  });
  assert.equal(calls.length, 1);
});

test("DiscordRestThreadGateway posts deterministic level snapshots into the target thread", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return jsonResponse({ body: { id: "message-1" } });
  };

  const gateway = new DiscordRestThreadGateway({
    botToken: "token",
    watchlistChannelId: "watchlist-1",
    fetchImpl,
  });

  await gateway.sendLevelSnapshot("thread-albt", {
    symbol: "ALBT",
    currentPrice: 2.51,
    supportZones: [
      { representativePrice: 2.4 },
      { representativePrice: 2.25, lowPrice: 2.2, highPrice: 2.28 },
    ],
    resistanceZones: [
      { representativePrice: 2.6, lowPrice: 2.58, highPrice: 2.62 },
      { representativePrice: 2.75 },
    ],
    timestamp: 1,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, "https://discord.com/api/v10/channels/thread-albt/messages");
  assert.equal(
    JSON.parse(String(calls[0]?.init?.body)).content,
    [
      "ALBT support and resistance",
      "Price: 2.51",
      "Level context: the nearby ladder is thin, so the strongest areas matter more than every small level.",
      "",
      "Trade map:",
      "Current structure: ALBT is range-bound between support 2.40 and resistance 2.58-2.62 area.",
      "Minor resistance reference: resistance 2.58-2.62 area is the upside area that needs acceptance.",
      "Minor support reference: support 2.40 is the area buyers need to keep holding for the range to stay constructive.",
      "Small pushes inside this band can be noise; the cleaner read comes from expansion above resistance or a clean loss of support.",
      "Cleaner above: acceptance above resistance 2.58-2.62 area (+2.8% to +4.4%) would shift attention toward resistance 2.75 (+9.6%).",
      "Support that matters: support 2.40 (-4.4%) is the first practical area buyers need to keep defending.",
      "Broader support: a clean loss of support 2.40 as a whole area would shift attention toward support 2.20-2.28 area (-12.4% to -9.2%).",
      "Setup quality: mixed and range-bound; better information comes from a clean expansion or a clean support failure.",
      "",
      "Closest levels to watch:",
      "Resistance:",
      "2.60 (+3.6%)",
      "2.75 (+9.6%)",
      "",
      "Support:",
      "2.40 (-4.4%)",
      "2.25 (-10.4%)",
      "",
      "More support and resistance:",
      "Resistance:",
      "2.60 (+3.6%)",
      "2.75 (+9.6%)",
      "",
      "Support:",
      "2.40 (-4.4%)",
      "2.25 (-10.4%)",
    ].join("\n"),
  );
});

test("DiscordRestThreadGateway can suppress embeds for plain-text link messages", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return jsonResponse({ body: { id: "message-1" } });
  };

  const gateway = new DiscordRestThreadGateway({
    botToken: "token",
    watchlistChannelId: "watchlist-1",
    fetchImpl,
  });

  await gateway.sendMessage("thread-albt", {
    title: "",
    body: [
      "COMPANY: Example Corp",
      "WEBSITE: https://example.com/",
    ].join("\n"),
    symbol: "EXMP",
    timestamp: 1,
    metadata: {
      messageKind: "stock_context",
      suppressEmbeds: true,
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, "https://discord.com/api/v10/channels/thread-albt/messages");
  const requestBody = JSON.parse(String(calls[0]?.init?.body));
  assert.equal(requestBody.content, "COMPANY: Example Corp\nWEBSITE: https://example.com/");
  assert.equal(requestBody.flags, 4);
});

test("DiscordRestThreadGateway retries transient message delivery failures", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    if (calls.length === 1) {
      return jsonResponse({ status: 503, body: { message: "temporary upstream issue" } });
    }

    return jsonResponse({ body: { id: "message-2" } });
  };

  const gateway = new DiscordRestThreadGateway({
    botToken: "token",
    watchlistChannelId: "watchlist-1",
    fetchImpl,
    transientRetryDelayMs: 0,
  });

  await gateway.sendMessage("thread-albt", {
    title: "ALBT breakout",
    body: "price cleared resistance",
    symbol: "ALBT",
    timestamp: 1,
    metadata: {
      messageKind: "intelligent_alert",
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.input, "https://discord.com/api/v10/channels/thread-albt/messages");
  assert.equal(calls[1]?.input, "https://discord.com/api/v10/channels/thread-albt/messages");
});

test("DiscordRestThreadGateway fails fast when Discord retry-after would stale an alert", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return jsonResponse({
      status: 429,
      body: { message: "rate limited" },
      headers: { "retry-after": "120" },
    });
  };

  const gateway = new DiscordRestThreadGateway({
    botToken: "token",
    watchlistChannelId: "watchlist-1",
    fetchImpl,
    transientRetryAttempts: 1,
    maxTransientRetryDelayMs: 5_000,
  });

  await assert.rejects(
    gateway.sendMessage("thread-albt", {
      title: "ALBT breakout",
      body: "price cleared resistance",
      symbol: "ALBT",
      timestamp: 1,
      metadata: {
        messageKind: "intelligent_alert",
      },
    }),
    /retry delay 120000ms exceeds max 5000ms/,
  );

  assert.equal(calls.length, 1);
});

test("DiscordRestThreadGateway preflights read permissions without posting by default", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    const url = String(input);
    if (url.includes("/channels/watchlist-1/threads/archived/public")) {
      return jsonResponse({ body: { threads: [] } });
    }
    if (url.includes("/guilds/guild-1/threads/active")) {
      return jsonResponse({ body: { threads: [] } });
    }
    return jsonResponse({ body: { id: "watchlist-1", name: "watchlist" } });
  };

  const gateway = new DiscordRestThreadGateway({
    botToken: "token",
    watchlistChannelId: "watchlist-1",
    guildId: "guild-1",
    fetchImpl,
  });

  const result = await gateway.preflightPermissions();

  assert.equal(result.ok, true);
  assert.equal(result.destructive, false);
  assert.deepEqual(
    result.checks.map((check) => [check.name, check.status]),
    [
      ["watchlist_channel_read", "pass"],
      ["active_threads_read", "pass"],
      ["archived_threads_read", "pass"],
      ["watchlist_channel_post", "skipped"],
    ],
  );
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.init?.method !== "POST"));
});

test("DiscordRestThreadGateway can opt into temporary post/delete preflight", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    const method = init?.method ?? "GET";
    if (method === "POST") {
      return jsonResponse({ body: { id: "message-preflight" } });
    }
    if (method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (String(input).includes("/threads/archived/public")) {
      return jsonResponse({ body: { threads: [] } });
    }
    return jsonResponse({ body: { id: "watchlist-1", name: "watchlist" } });
  };

  const gateway = new DiscordRestThreadGateway({
    botToken: "token",
    watchlistChannelId: "watchlist-1",
    fetchImpl,
  });

  const result = await gateway.preflightPermissions({ postTest: true });

  assert.equal(result.ok, true);
  assert.equal(result.destructive, true);
  assert.deepEqual(
    result.checks.map((check) => [check.name, check.status]),
    [
      ["watchlist_channel_read", "pass"],
      ["active_threads_read", "skipped"],
      ["archived_threads_read", "pass"],
      ["watchlist_channel_post", "pass"],
      ["watchlist_channel_delete_test_message", "pass"],
    ],
  );
  assert.equal(
    calls.some((call) => call.input.includes("/channels/watchlist-1/messages") && call.init?.method === "POST"),
    true,
  );
  assert.equal(
    calls.some((call) => call.input.includes("/channels/watchlist-1/messages/message-preflight") && call.init?.method === "DELETE"),
    true,
  );
});
