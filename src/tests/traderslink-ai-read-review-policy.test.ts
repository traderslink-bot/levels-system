import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { hasWatchlistPublicationApproval, isWatchlistPatchApproved, normalizeAiReadAdmission, normalizePublicationReview, requiresInitialWatchlistReview } from "../lib/ai/traderslink-ai-read-review-policy.js";
import { TradersLinkAiReadReviewStore } from "../lib/ai/traderslink-ai-read-review-store.js";
import { WatchlistStore } from "../lib/monitoring/watchlist-store.js";
import { WatchlistStatePersistence } from "../lib/monitoring/watchlist-state-persistence.js";

const directories: string[] = [];
test("held or unavailable review allows only a content-free removal", () => {
  const removal = { symbol: "PDSB", status: "deactivated" as const, updatedAt: Date.now(), cards: {} };
  const held = { cycleId: "held", required: true };
  const unavailable = () => { throw new Error("Unavailable review"); };
  assert.equal(isWatchlistPatchApproved(removal, held, unavailable), true);
  assert.equal(isWatchlistPatchApproved({ ...removal, status: "live" }, held, () => null), false);
  assert.equal(isWatchlistPatchApproved({ ...removal, updatedAt: NaN }, held, () => null), false);
  assert.equal(isWatchlistPatchApproved({ ...removal, cards: { tradersLinkAiRead: { body: "Private", updatedAt: 1 } } } as any, held, () => null), false);
  assert.equal(isWatchlistPatchApproved({ ...removal, latestPrice: 123 } as any, held, () => null), false);
});
test("admission decision survives store and disk reload; malformed data cannot enable an initial request", () => {
  const directory = mkdtempSync(join(tmpdir(), "admission-policy-"));
  directories.push(directory);
  const persistence = new WatchlistStatePersistence({ filePath: join(directory, "state.json") });
  const store = new WatchlistStore();
  const admission = { timestamp: Date.now(), session: "regular" as const, initialGenerationEnabled: false };
  store.upsertManualEntry({ symbol: "PDSB", active: true, aiReadAdmission: admission });
  persistence.save(store.getEntries());
  const restarted = new WatchlistStore();
  restarted.setEntries(persistence.load());
  assert.deepEqual(restarted.getEntry("PDSB")?.aiReadAdmission, admission);
  assert.equal(normalizeAiReadAdmission(undefined), undefined);
  for (const invalid of [null, {}, { ...admission, timestamp: NaN }, { ...admission, initialGenerationEnabled: "true" }]) {
    assert.equal(normalizeAiReadAdmission(invalid)?.initialGenerationEnabled, false);
  }
  assert.equal(normalizeAiReadAdmission({ ...admission, session: "closed", initialGenerationEnabled: true })?.initialGenerationEnabled, false);
});
test("legacy replacement preserves only non-analysis updates without inventing approval, including after restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "replacement-policy-"));
  directories.push(directory);
  const audit = new TradersLinkAiReadReviewStore(directory);
  audit.begin("replacement", "PDSB", true, "runtime:replacement", true);
  const review = { cycleId: "replacement", required: true };
  const load = (id: string) => new TradersLinkAiReadReviewStore(directory).read(id);
  assert.equal(load(review.cycleId)?.approved, null);
  assert.equal(hasWatchlistPublicationApproval("PDSB", review, load), false);
  assert.equal(isWatchlistPatchApproved({ symbol: "PDSB", cards: {} }, review, load), true);
  assert.equal(isWatchlistPatchApproved({ symbol: "FTFT", cards: {} }, review, load), false);
  assert.equal(isWatchlistPatchApproved({ symbol: "PDSB", cards: {} }, { ...review, required: false }, load), false);
  assert.equal(isWatchlistPatchApproved({ symbol: "PDSB", cards: { tradersLinkAiRead: null } }, review, load), false);
  const payload = { symbol: "PDSB", currentRead: "Replacement" };
  const patch = { symbol: "PDSB", cards: { tradersLinkAiRead: { body: JSON.stringify(payload) } } } as any;
  audit.saveDraft({ cycleId: review.cycleId, expectedHead: 1, actor: "generator", generationId: "g1", payload });
  assert.equal(isWatchlistPatchApproved(patch, review, load), false);
  audit.approve(review.cycleId, 2, 2, "owner");
  assert.equal(isWatchlistPatchApproved(patch, review, load), true);
  audit.cancel(review.cycleId, 3, "owner");
  assert.equal(isWatchlistPatchApproved({ symbol: "PDSB", cards: {} }, review, load), false);
});
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
  const approvedPatch = { symbol: "PDSB", cards: { tradersLinkAiRead: { body: JSON.stringify({ symbol: "PDSB" }) } } } as any;
  assert.equal(isWatchlistPatchApproved(approvedPatch, review, (id) => audit.read(id)), true);
  const changedPatch = { symbol: "PDSB", cards: { tradersLinkAiRead: { body: JSON.stringify({ symbol: "PDSB", currentRead: "Not approved" }) } } } as any;
  assert.equal(isWatchlistPatchApproved(changedPatch, review, (id) => audit.read(id)), false);
  assert.equal(isWatchlistPatchApproved({ symbol: "PDSB", cards: {} }, review, (id) => audit.read(id)), false);
  assert.equal(isWatchlistPatchApproved({ symbol: "PDSB", type: "tickerData", updatedAt: 123 } as any, review, (id) => audit.read(id)), false);
  audit.recordDelivery("cycle", 3, 3, "website", "acknowledged", "receipt");
  assert.equal(isWatchlistPatchApproved({ symbol: "PDSB", cards: {} }, review, (id) => audit.read(id)), true);
  assert.equal(hasWatchlistPublicationApproval("FTFT", review, (id) => audit.read(id)), false);
  audit.saveDraft({ cycleId: "cycle", expectedHead: 4, actor: "generator", generationId: "g2", payload: { symbol: "PDSB" } });
  assert.equal(allowed(), true);
  audit.cancel("cycle", 5, "owner");
  assert.equal(allowed(), false);
});
