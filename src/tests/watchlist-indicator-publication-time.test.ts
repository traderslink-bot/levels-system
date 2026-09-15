import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewEvent, ReviewState } from "../lib/ai/traderslink-ai-read-review-store.js";
import { watchlistIndicatorPublicationTime as resolve } from "../lib/market-data/watchlist-indicator-publication-time.js";

function event(revision: number, body: ReviewEvent["body"]): ReviewEvent {
  return { version: 1, cycleId: "test", revision, previousHash: null, actor: "test", at: revision, body, hash: "test" };
}
function approved(revision: number, time: number): ReviewEvent {
  return event(revision, { kind: "approve", draftRevision: revision - 1,
    publication: { website: { cards: { tradersLinkAiRead: { updatedAt: time }, potentialPath: { updatedAt: time + 1 } } }, discordChunks: [] } });
}
function ack(revision: number, approvalRevision: number): ReviewEvent {
  return event(revision, { kind: "delivery", channel: "website", status: "acknowledged", approvalRevision, deliveryId: "test" });
}
function review(events: ReviewEvent[]): ReviewState {
  return { cycleId: "test", symbol: "VEEA", reviewRequired: true, head: events.length,
    cancelled: false, draft: null, approved: null, events };
}

test("approved VEEA uses its published card time, not earlier activation", () => {
  assert.equal(resolve(1789477145748, true, review([approved(5, 1789477250000), ack(7, 5)])), 1789477250000);
});
test("replacement reads and edits retain the first acknowledged website identity", () => {
  assert.equal(resolve(100, true, review([approved(5, 200), ack(7, 5), approved(9, 300), ack(11, 9)])), 200);
});
test("pending, failed, missing and cancelled reviews cannot refresh public indicators", () => {
  assert.equal(resolve(100, true, null), null);
  assert.equal(resolve(100, true, review([approved(5, 200)])), null);
  assert.equal(resolve(100, true, review([event(7, { kind: "delivery", channel: "website", status: "failed", approvalRevision: 5, deliveryId: null })])), null);
  assert.equal(resolve(100, true, { ...review([approved(5, 200), ack(7, 5)]), cancelled: true }), null);
});
test("Discord delivery alone does not authorize indicator publication", () => {
  const delivery = ack(7, 5);
  if (delivery.body.kind === "delivery") delivery.body.channel = "discord";
  assert.equal(resolve(100, true, review([approved(5, 200), delivery])), null);
});
test("ordinary activation and legacy replacement retain their public timestamp", () => {
  assert.equal(resolve(100, false, null), 100);
  assert.equal(resolve(100, true, { ...review([]), preserveExistingPublication: true }), 100);
});
test("explicit firstPostedAt wins; malformed or absent publication stays unavailable", () => {
  const approval = approved(5, 200);
  if (approval.body.kind === "approve") approval.body.publication!.website.firstPostedAt = 150;
  assert.equal(resolve(100, true, review([approval, ack(7, 5)])), 150);
  assert.equal(resolve(100, true, review([event(5, { kind: "approve", draftRevision: 4 }), ack(7, 5)])), null);
  assert.equal(resolve(undefined, false, null), null);
  assert.equal(resolve(Number.NaN, false, null), null);
});
