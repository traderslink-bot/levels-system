import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiscordRestThreadGateway } from "../lib/alerts/discord-rest-thread-gateway.js";
import { DiscordAuditedThreadGateway } from "../lib/alerts/discord-audited-thread-gateway.js";
import { WebsitePublishingDiscordGateway } from "../lib/live-watchlist/website-publishing-discord-gateway.js";
import { DiscordAlertRouter } from "../lib/alerts/alert-router.js";

const chunk = { symbol: "TEST", deliveryKey: "cycle:approval:discord:0", content: "TradersLink Analysis\nVWAP reclaim with EMA support\nOwner wording @everyone <@12345678901234567>" };
const receipt = { messageId: "12345678901234567", channelId: "23456789012345678" };

test("approved Discord path preserves preview text, limits mentions and audits the receipt without republishing website", async () => {
  const dir = mkdtempSync(join(tmpdir(), "approved-discord-"));
  const requests: Record<string, unknown>[] = [];
  let websiteCalls = 0;
  const rest = new DiscordRestThreadGateway({ botToken: "test", watchlistChannelId: receipt.channelId, fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: receipt.messageId }), { status: 200 });
  } });
  const auditFilePath = join(dir, "audit.jsonl");
  try {
    const audited = new DiscordAuditedThreadGateway(rest, { gatewayMode: "real", auditFilePath });
    const website = new WebsitePublishingDiscordGateway(audited, { publish: async () => { websiteCalls++; } });
    const router = new DiscordAlertRouter(website);
    router.setPublicationAuthorizer(() => false);
    await assert.rejects(router.routeApprovedAnalysisChunk(chunk));
    assert.equal(requests.length, 0);
    router.setPublicationAuthorizer((symbol) => symbol === "TEST");
    assert.deepEqual(await router.routeApprovedAnalysisChunk(chunk), receipt);
    assert.equal(websiteCalls, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].content, chunk.content);
    assert.deepEqual(requests[0].allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
    assert.equal(requests[0].enforce_nonce, true);
    assert.equal(String(requests[0].nonce).length, 25);
    const audit = JSON.parse(readFileSync(auditFilePath, "utf8"));
    assert.equal(audit.messageId, receipt.messageId);
    assert.equal(audit.deliveryKey, chunk.deliveryKey);
    assert.equal(audit.body, chunk.content);
    assert.equal(audit.operation, "post_approved_analysis");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("approved transport never retries an uncertain response or a server failure", async () => {
  for (const response of ["timeout", "server", "missing_receipt"] as const) {
    let calls = 0;
    const rest = new DiscordRestThreadGateway({ botToken: "test", watchlistChannelId: receipt.channelId, transientRetryAttempts: 3, fetchImpl: async () => {
      calls++;
      if (response === "timeout") throw new Error("Connection lost after send");
      return new Response("{}", { status: response === "server" ? 503 : 200 });
    } });
    await assert.rejects(rest.sendApprovedAnalysisChunk(chunk));
    assert.equal(calls, 1, response);
  }
});

test("invalid approved chunks make no network request", async () => {
  let calls = 0;
  const rest = new DiscordRestThreadGateway({ botToken: "test", watchlistChannelId: receipt.channelId, fetchImpl: async () => { calls++; throw new Error("unexpected"); } });
  for (const content of ["", " ", "a".repeat(2001)]) await assert.rejects(rest.sendApprovedAnalysisChunk({ ...chunk, content }));
  await assert.rejects(rest.sendApprovedAnalysisChunk({ ...chunk, deliveryKey: "" }));
  assert.equal(calls, 0);
});
