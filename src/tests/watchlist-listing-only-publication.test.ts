import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TradersLinkAiReadReviewStore } from "../lib/ai/traderslink-ai-read-review-store.js";
import { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";

test("listing-only manager publishes once without AI or images and acknowledges a replay", async () => {
  const directory = mkdtempSync(join(tmpdir(), "listing-manager-"));
  try {
    const store = new TradersLinkAiReadReviewStore(directory);
    store.begin("cycle", "PDSB", true, "owner");
    const manager = Object.create(ManualWatchlistRuntimeManager.prototype) as any;
    const entry = { symbol: "PDSB", active: true, publicationReview: { cycleId: "cycle", required: true } };
    manager.watchlistStore = { getEntry: () => entry, getActiveEntries: () => [entry] };
    const website: any[] = [], discord: any[] = [];
    manager.options = { now: () => 1000, tradersLinkAiReadReviewStore: store, discordAlertRouter: {
      routeApprovedAnalysisChunk: async (chunk: any) => { discord.push(chunk); return { messageId: "12345678901234567", channelId: "23456789012345678" }; }
    }};
    manager.buildLevelSnapshotPayload = () => ({ symbol: "PDSB", timestamp: 1000, currentPrice: 1, supportZones: [], resistanceZones: [] });
    manager.applyLiveTraderReadCardVisibility = (patch: any) => patch;
    manager.liveWatchlistPublisher = { publish: async (patch: any) => {
      assert.equal(manager.isWatchlistPublicationApproved(patch), true);
      website.push(patch); manager.acknowledgeTradersLinkAiReadPublication(patch);
    }};
    const input = { symbol: "PDSB", cycleId: "cycle", expectedHead: 1, actor: "owner" };
    await manager.publishTickerWithoutAnalysis(input);
    await manager.publishTickerWithoutAnalysis(input);
    assert.equal(website.length, 1); assert.equal(discord.length, 1);
    assert.equal(website[0].cards.tradersLinkAiRead, undefined);
    assert.equal(discord[0].attachments, undefined);
    assert.equal(store.read("cycle")!.draft, null);
    assert.equal(manager.listTradersLinkAiReadReviews()[0].status, "Published without analysis");
    assert.equal(manager.listTradersLinkAiReadReviews()[0].listed, true);
    const head = store.read("cycle")!.head;
    store.saveDraft({ cycleId: "cycle", expectedHead: head, actor: "generator", generationId: "later", payload: { symbol: "PDSB" } });
    assert.equal(manager.isWatchlistPublicationApproved({ symbol: "PDSB", cards: { tradersLinkAiRead: {body:'{"symbol":"PDSB"}'} } }), false);
    assert.equal(manager.listTradersLinkAiReadReviews()[0].status, "New draft — awaiting review");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
