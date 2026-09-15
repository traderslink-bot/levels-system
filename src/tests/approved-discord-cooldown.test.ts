import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DiscordCooldown } from "../lib/alerts/discord-rate-limit.js";
import { DiscordRestThreadGateway } from "../lib/alerts/discord-rest-thread-gateway.js";
import { DiscordConfirmedRejection } from "../lib/alerts/discord-confirmed-rejection.js";
import { TradersLinkAiReadReviewStore } from "../lib/ai/traderslink-ai-read-review-store.js";
import { approvedDiscordRetryAt } from "../lib/ai/approved-discord-retry.js";
import { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";

test("cooldown survives restart, cannot be shortened and expires", () => {
  const dir = mkdtempSync(join(tmpdir(), "discord-cooldown-")); let now = 100;
  try {
    const file = join(dir, "cooldown.json");
    const cooldown = new DiscordCooldown(file, () => now);
    cooldown.record({ retryAt: 500, scope: "global", reason: "wait" });
    cooldown.record({ retryAt: 300, scope: "route", reason: "wait" });
    const restarted = new DiscordCooldown(file, () => now);
    assert.equal(restarted.current()?.retryAt, 500);
    now = 501; assert.equal(restarted.current(), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("429 metadata survives review restart, only due approved rejections qualify, receipt stops retry", () => {
  const dir = mkdtempSync(join(tmpdir(), "discord-review-retry-")); let now = 100;
  try {
    let store = new TradersLinkAiReadReviewStore(dir, () => now);
    store.begin("cycle", "TEST", true, "owner");
    store.saveDraft({ cycleId: "cycle", expectedHead: 1, actor: "generator", generationId: "g", payload: { symbol: "TEST" } });
    store.approve("cycle", 2, 2, "owner", { website: {}, discordChunks: ["approved"] });
    store.claimDelivery("cycle", 3, 3, "website");
    store.recordDelivery("cycle", 4, 3, "website", "acknowledged", "website");
    store.claimDelivery("cycle", 5, 3, "discord");
    store.claimDiscordChunk("cycle", 6, 3, 0);
    assert.equal(approvedDiscordRetryAt(store.read("cycle")), null, "uncertain sends are not retried");
    store.rejectDiscordChunk("cycle", 7, 3, 0, 429, { retryAt: 500, scope: "global", reason: "wait" });
    store = new TradersLinkAiReadReviewStore(dir, () => now);
    assert.equal(approvedDiscordRetryAt(store.read("cycle")), 500);
    assert.equal(store.claimDiscordChunk("cycle", 8, 3, 0).reason, "cooldown");
    now = 501; assert.equal(store.claimDiscordChunk("cycle", 8, 3, 0).shouldSend, true);
    assert.equal(approvedDiscordRetryAt(store.read("cycle")), null, "inflight claim is not retried");
    store.acknowledgeDiscordChunk("cycle", 9, 3, 0, { messageId: "12345678901234567", channelId: "23456789012345678" });
    assert.equal(approvedDiscordRetryAt(store.read("cycle")), null);
    const state = store.read("cycle")!;
    const old = structuredClone(state); old.events = old.events.slice(0, 8);
    if (old.events[7]!.body.kind === "discord_chunk") delete old.events[7]!.body.rateLimit;
    assert.equal(approvedDiscordRetryAt(old), null, "old rejections including no-send records are not replayed");
    const cancelled = { ...state, cancelled: true }; assert.equal(approvedDiscordRetryAt(cancelled), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("concurrent sends make only one network call when Discord returns global 429, including after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discord-rest-cooldown-")); let calls = 0;
  try {
    const options = { botToken: "test", watchlistChannelId: "23456789012345678", cooldownFile: join(dir, "cooldown.json"),
      fetchImpl: (async () => { calls++; return new Response(JSON.stringify({ global: true, retry_after: 2600 }), { status: 429 }); }) as typeof fetch };
    const gateway = new DiscordRestThreadGateway(options);
    const chunk = { symbol: "TEST", deliveryKey: "key", content: "approved" };
    const results = await Promise.allSettled([gateway.sendApprovedAnalysisChunk(chunk), gateway.sendApprovedAnalysisChunk({ ...chunk, deliveryKey: "other" })]);
    for (const r of results) { assert.equal(r.status, "rejected"); if (r.status === "rejected") { assert(r.reason instanceof DiscordConfirmedRejection); assert.equal(r.reason.rateLimit.scope, "global"); assert(r.reason.rateLimit.retryAt > Date.now() + 2_500_000); } }
    await assert.rejects(new DiscordRestThreadGateway(options).sendApprovedAnalysisChunk(chunk), /429/);
    assert.equal(calls, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("scheduler resumes only current approved due deliveries and does not overlap itself", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discord-scheduler-"));
  try {
    const store = new TradersLinkAiReadReviewStore(dir);
    store.begin("cycle", "TEST", true, "owner");
    store.saveDraft({ cycleId: "cycle", expectedHead: 1, actor: "generator", generationId: "g", payload: { symbol: "TEST" } });
    store.approve("cycle", 2, 2, "owner", { website: {}, discordChunks: ["approved"] });
    store.claimDelivery("cycle", 3, 3, "website");
    store.recordDelivery("cycle", 4, 3, "website", "acknowledged", "website");
    store.claimDiscordChunk("cycle", 5, 3, 0);
    store.rejectDiscordChunk("cycle", 6, 3, 0, 429, { retryAt: Date.now() - 1, scope: "global", reason: "wait" });
    let calls = 0;
    const fake = { approvedDiscordRetryRunning: false, approvedDiscordRetryTimer: true,
      watchlistStore: { getActiveEntries: () => [{ symbol: "TEST" }] },
      getTradersLinkAiReadReview: () => store.read("cycle"),
      publishApprovedTradersLinkAiReadToDiscord: async (input: unknown) => { calls++; assert.deepEqual(input, { symbol: "TEST", cycleId: "cycle", approvalRevision: 3 }); await Promise.resolve(); },
    };
    const run = (ManualWatchlistRuntimeManager.prototype as unknown as { retryApprovedDiscordDeliveries: (this: typeof fake) => Promise<void> }).retryApprovedDiscordDeliveries;
    await Promise.all([run.call(fake), run.call(fake)]); assert.equal(calls, 1);
    store.saveDraft({ cycleId: "cycle", expectedHead: 7, actor: "owner", payload: { symbol: "TEST", changed: true } });
    await run.call(fake); assert.equal(calls, 1, "unapproved newer edits are not published");
    fake.approvedDiscordRetryTimer = false; await run.call(fake); assert.equal(calls, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
