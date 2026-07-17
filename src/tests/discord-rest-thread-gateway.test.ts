import assert from "node:assert/strict";
import test from "node:test";

import { DiscordRestThreadGateway } from "../lib/alerts/discord-rest-thread-gateway.js";
import { buildWatchlistDiscordLinkMessage } from "../lib/alerts/watchlist-discord-link-message.js";

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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test("DiscordRestThreadGateway creates a symbol thread under the configured watchlist channel", async () => {
  const originalPublicUrl = process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL;
  process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL = "https://traderslink.pro/watchlist";
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
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    content: [
      "ALBT added to the watchlist.",
      "",
      "View ALBT watchlist page: https://traderslink.pro/watchlist/ALBT",
    ].join("\n"),
  });
  assert.match(String(calls[1]?.init?.body), /"name":"ALBT"/);
  restoreEnv("TRADERSLINK_WATCHLIST_PUBLIC_URL", originalPublicUrl);
});

test("buildWatchlistDiscordLinkMessage names the added ticker when no public URL is configured", () => {
  const originalPublicUrl = process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL;
  delete process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL;

  assert.equal(
    buildWatchlistDiscordLinkMessage("cdt"),
    [
      "CDT added to the watchlist.",
      "",
      "View CDT details when the watchlist link is configured.",
    ].join("\n"),
  );

  restoreEnv("TRADERSLINK_WATCHLIST_PUBLIC_URL", originalPublicUrl);
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
      "Current Read: ALBT is range-bound between support 2.40 and resistance 2.58-2.62 area; the better information comes from expansion above resistance or a clean support failure.",
      "",
      "Breakout Area To Watch: resistance 2.58-2.62 area (+2.8% to +4.4%) is a nearby gate, not the material target; higher resistance needs a fresh level check before treating the path as open.",
      "",
      "Pullback Zones:",
      "- Nearby support gate: support 2.40 (-4.4%); this is not a material small-cap pullback zone by itself.",
      "",
      "Continuation Path: above resistance 2.58-2.62 area, higher resistance needs a fresh level check before the move can be treated as open.",
      "",
      "Setup Weakens If: price loses support 2.40 as a whole area and cannot reclaim it. Below that, the next map area is support 2.20-2.28 area (-12.4% to -9.2%).",
      "",
      "Quality / Caution: range-bound; small pushes inside the band can be noise.",
      "",
      "Closest levels to watch:",
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

test("DiscordRestThreadGateway can post a separate full level ladder into the target thread", async () => {
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

  await gateway.sendLevelLadder("thread-albt", {
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
  assert.equal(
    JSON.parse(String(calls[0]?.init?.body)).content,
    [
      "ALBT full level ladder",
      "Price: 2.51",
      "",
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

test("DiscordRestThreadGateway keeps VWAP and EMA out of crowded level snapshots before posting", async () => {
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

  await gateway.sendLevelSnapshot("thread-rlyb", {
    symbol: "RLYB",
    currentPrice: 1.25,
    supportZones: Array.from({ length: 35 }, (_, index) => ({
      representativePrice: 1.2 - index * 0.01,
      strengthLabel: index % 2 === 0 ? "major" : "moderate",
      sourceLabel: "daily confluence",
    })),
    resistanceZones: Array.from({ length: 35 }, (_, index) => ({
      representativePrice: 1.3 + index * 0.01,
      strengthLabel: index % 2 === 0 ? "major" : "moderate",
      sourceLabel: "4h structure",
    })),
    timestamp: 1,
  });

  const content = JSON.parse(String(calls[0]?.init?.body)).content;
  assert.doesNotMatch(content, /\[trimmed: Discord message length limit\]/);
  assert.doesNotMatch(content, /More support and resistance/);
  assert.doesNotMatch(content, /\b(?:VWAP|EMA(?:9|20)?|EMA\s*\d*)\b/i);
});

test("DiscordRestThreadGateway removes VWAP and EMA lines from Discord-facing posts", async () => {
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

  await gateway.sendMessage("thread-rlyb", {
    title: "RLYB context",
    body: [
      "Support: 1.20 remains the main lower level.",
      "VWAP: price is above VWAP.",
      "EMA9: price is below EMA9.",
      "Resistance: 1.35 is the next upper level.",
    ].join("\n"),
    symbol: "RLYB",
    timestamp: 1,
  });

  const content = JSON.parse(String(calls[0]?.init?.body)).content;
  assert.match(content, /Support: 1\.20/);
  assert.match(content, /Resistance: 1\.35/);
  assert.doesNotMatch(content, /\b(?:VWAP|EMA(?:9|20)?|EMA\s*\d*)\b/i);
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

test("DiscordRestThreadGateway splits posts that exceed Discord's 2000 character limit", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return jsonResponse({ body: { id: `message-${calls.length}` } });
  };

  const gateway = new DiscordRestThreadGateway({
    botToken: "token",
    watchlistChannelId: "watchlist-1",
    fetchImpl,
  });

  await gateway.sendMessage("thread-albt", {
    title: "ALBT snapshot",
    body: Array.from(
      { length: 80 },
      (_, index) => `line ${index + 1}: support/resistance and market structure detail stays visible for review`,
    ).join("\n"),
    symbol: "ALBT",
    timestamp: 1,
  });

  assert.ok(calls.length > 1);
  assert.ok(
    calls.every((call) => {
      const body = JSON.parse(String(call.init?.body));
      return typeof body.content === "string" && body.content.length <= 2000;
    }),
  );
  assert.match(JSON.parse(String(calls[0]?.init?.body)).content, /ALBT snapshot/);
  assert.match(JSON.parse(String(calls.at(-1)?.init?.body)).content, /line 80/);
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
