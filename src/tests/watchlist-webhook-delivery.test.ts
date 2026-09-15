import test from "node:test";
import assert from "node:assert/strict";
import { DiscordRestThreadGateway } from "../lib/alerts/discord-rest-thread-gateway.js";

const channel = "23456789012345678", messageId = "34567890123456789";
const webhook = "https://discord.com/api/webhooks/12345678901234567/test-only-token";
const chunk = { symbol: "TEST", deliveryKey: "approved", content: "Watchlist https://example.test/watchlist\nTicker https://example.test/watchlist/TEST" };
test("webhook preserves links and images, confirms destination and receipt, never sends bot credentials", async () => {
  const calls: string[] = [];
  const gateway = new DiscordRestThreadGateway({ botToken: "test-bot-secret", watchlistChannelId: channel, webhookUrl: webhook,
    fetchImpl: async (url, init) => {
      calls.push(String(url)); assert.equal(new Headers(init?.headers).get("Authorization"), null);
      if (init?.method === "GET") return Response.json({ channel_id: channel });
      assert.equal(String(url), webhook + "?wait=true");
      assert(init?.body instanceof FormData);
      const body = JSON.parse(String(init.body.get("payload_json")));
      assert.equal(body.content, chunk.content); assert.equal(body.nonce, undefined);
      assert.equal(body.attachments.length, 1); assert(init.body.get("files[0]"));
      return Response.json({ id: messageId });
    } });
  assert.deepEqual(await gateway.sendApprovedAnalysisChunk({ ...chunk, attachments: [{ filename: "TEST-analysis-1.png", description: "test", bytes: Buffer.from("mock PNG") }] }), { messageId, channelId: channel });
  assert.equal(calls.length, 2);
});
test("wrong destination never posts; transport errors never disclose webhook secret or trigger fallback sends", async () => {
  let posts = 0;
  const wrong = new DiscordRestThreadGateway({ botToken: "test", watchlistChannelId: channel, webhookUrl: webhook,
    fetchImpl: async (_url, init) => { if (init?.method === "POST") posts++; return Response.json({ channel_id: "other" }); } });
  await assert.rejects(wrong.sendApprovedAnalysisChunk(chunk), /different channel/); assert.equal(posts, 0);
  const timeout = new DiscordRestThreadGateway({ botToken: "test", watchlistChannelId: channel, webhookUrl: webhook,
    fetchImpl: async (_url, init) => { if (init?.method === "GET") return Response.json({ channel_id: channel }); posts++; throw new Error(webhook); } });
  await assert.rejects(timeout.sendApprovedAnalysisChunk(chunk), error => { assert(error instanceof Error); assert(!error.message.includes("test-only-token")); return true; });
  assert.equal(posts, 1);
});
test("webhook receipt verification uses webhook-owned read endpoint, not bot API", async () => {
  const gateway = new DiscordRestThreadGateway({ botToken: "test", watchlistChannelId: channel, webhookUrl: webhook,
    fetchImpl: async (url, init) => { assert.equal(init?.method, "GET"); assert.equal(new Headers(init?.headers).get("Authorization"), null);
      return String(url).endsWith(messageId) ? Response.json({ id: messageId, channel_id: channel, webhook_id: "12345678901234567", content: chunk.content, timestamp: new Date(2000).toISOString() }) : Response.json({ channel_id: channel }); } });
  assert.deepEqual(await gateway.verifyApprovedAnalysisMessage(chunk, messageId, 1000), { messageId, channelId: channel });
});
