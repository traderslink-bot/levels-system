import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { hasWatchlistPublicationApproval, normalizePublicationReview, requiresInitialWatchlistReview } from "../lib/ai/traderslink-ai-read-review-policy.js";
import { TradersLinkAiReadReviewStore } from "../lib/ai/traderslink-ai-read-review-store.js";
import { WatchlistStore } from "../lib/monitoring/watchlist-store.js";
import { WatchlistStatePersistence } from "../lib/monitoring/watchlist-state-persistence.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

test("initial review requires both master and selected session generation, without Top Regular override", () => {
  const settings = { reviewEnabled: true, generationEnabled: true, premarketEnabled: true, regularEnabled: true, postmarketEnabled: false };
  assert.equal(requiresInitialWatchlistReview({ ...settings, session: "regular" }), true);
  assert.equal(requiresInitialWatchlistReview({ ...settings, session: "postmarket" }), false);
  assert.equal(requiresInitialWatchlistReview({ ...settings, session: "closed" }), false);
  assert.equal(requiresInitialWatchlistReview({ ...settings, session: "regular", generationEnabled: false }), false);
  assert.equal(requiresInitialWatchlistReview({ ...settings, session: "regular", reviewEnabled: false }), false);
});

test("legacy is preserved but malformed or missing review evidence cannot grant publication", () => {
  assert.equal(hasWatchlistPublicationApproval("PDSB", undefined, () => null), true);
  for (const input of [null, {}, { required: false }, { cycleId: "cycle", required: true }, { cycleId: "cycle", required: false }]) {
    assert.equal(hasWatchlistPublicationApproval("PDSB", input, () => null), false);
  }
  assert.equal(hasWatchlistPublicationApproval("PDSB", { cycleId: "cycle", required: true }, () => { throw new Error("unavailable"); }), false);
  assert.deepEqual(normalizePublicationReview({ required: false }), { cycleId: "invalid-review-state", required: true });
});

test("frozen activation review survives watchlist saves, restart, approval and later draft", () => {
  const directory = mkdtempSync(join(tmpdir(), "review-policy-"));
  directories.push(directory);
  const audit = new TradersLinkAiReadReviewStore(join(directory, "reviews"));
  const persistence = new WatchlistStatePersistence({ filePath: join(directory, "watchlist.json") });
  const watchlist = new WatchlistStore();
  audit.begin("cycle", "PDSB", true, "owner");
  watchlist.upsertManualEntry({ symbol: "PDSB", active: true, publicationReview: { cycleId: "cycle", required: true } });
  watchlist.patchEntry("PDSB", { lastPrice: 0.5 });
  watchlist.upsertManualEntry({ symbol: "PDSB", active: true, note: "Updated context" });
  persistence.save(watchlist.getEntries());
  const restored = new WatchlistStore();
  restored.setEntries(persistence.load()!);
  const review = restored.getEntry("PDSB")!.publicationReview;
  assert.deepEqual(review, { cycleId: "cycle", required: true });
  const allowed = () => hasWatchlistPublicationApproval("PDSB", review, (id) => audit.read(id));
  assert.equal(allowed(), false);
  audit.saveDraft({ cycleId: "cycle", expectedHead: 1, actor: "generator", generationId: "g1", payload: { symbol: "PDSB" } });
  assert.equal(allowed(), false);
  audit.approve("cycle", 2, 2, "owner");
  assert.equal(allowed(), true);
  assert.equal(hasWatchlistPublicationApproval("FTFT", review, (id) => audit.read(id)), false);
  audit.saveDraft({ cycleId: "cycle", expectedHead: 3, actor: "generator", generationId: "g2", payload: { symbol: "PDSB" } });
  assert.equal(allowed(), true);
  audit.cancel("cycle", 4, "owner");
  assert.equal(allowed(), false);
});
