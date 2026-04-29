import assert from "node:assert/strict";
import test from "node:test";

import { DiscordRestThreadGateway } from "../lib/alerts/discord-rest-thread-gateway.js";

type MockResponseInit = {
  status?: number;
  body?: unknown;
};

function jsonResponse(init: MockResponseInit = {}): Response {
  return new Response(init.body === undefined ? "" : JSON.stringify(init.body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
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
      "ALBT level map",
      "Price: 2.51",
      "",
      "What price is doing now:",
      "- Price is between support 2.40 and resistance 2.60.",
      "- Room is fairly balanced between the nearest support and resistance.",
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
      "- Support: 2.40 (-4.4%), 2.25 (-10.4%)",
      "- Resistance: 2.60 (+3.6%), 2.75 (+9.6%)",
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
