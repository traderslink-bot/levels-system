import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { analysisUpdateContextForDraft, analysisUpdateContextFromReview } from "../lib/ai/watchlist-analysis-update-context.js";
import { renderApprovedAnalysisDiscord, attributeOwnerApprovedDiscord } from "../lib/ai/traderslink-ai-read-publication-preview.js";
import type { TradersLinkAiReadPayload } from "../lib/live-watchlist/live-watchlist-types.js";

const evidence = JSON.parse(readFileSync(new URL("./fixtures/brai-notification-provenance.json", import.meta.url), "utf8"));
const cycleId = "10000000-0000-4000-8000-000000000001";
const milliseconds = (value: string) => Date.parse(value);
function scenario(options: { symbol?: string; listingOnly?: boolean; frozenContext?: boolean; moved?: boolean } = {}) {
  const symbol = options.symbol ?? evidence.symbol;
  const initial = { revision: evidence.initial.approvalRevision, actor: "platform-owner:sanitized", at: milliseconds(evidence.initial.approvedAt),
    body: { kind: "approve", draftRevision: options.listingOnly ? 0 : evidence.initial.draftRevision,
      publication: { notificationKind: "listing", notifyUsers: true, website: { cards: options.listingOnly ? {} : {
        // Minimal synthetic body-presence marker, not the saved analysis itself.
        tradersLinkAiRead: { body: JSON.stringify({ symbol, fixturePresenceOnly: true }) },
      } } } } };
  const acknowledged = (revision: number, at: string) => ({ revision: revision + 1, actor: "delivery", at: milliseconds(at),
    body: { kind: "delivery", approvalRevision: revision, channel: "website", status: "acknowledged" } });
  const review: any = { cycleId, symbol, head: 20, cancelled: false, draft: null, approved: null, events: [
    { revision: 1, at: milliseconds(evidence.activationAt), actor: "runtime:activation", body: { kind: "begin", symbol } },
    initial, acknowledged(initial.revision, evidence.initial.websiteAcknowledgedAt),
  ] };
  const context = { ...analysisUpdateContextForDraft(review, null), automatic: true,
    ...(options.moved === false ? {} : { categoryMoveNote: evidence.updated.categoryMoveNote }) };
  const approval: any = { revision: evidence.updated.approvalRevision, actor: "runtime:automatic-boundary", at: milliseconds(evidence.updated.approvedAt),
    body: { kind: "approve", draftRevision: evidence.updated.draftRevision,
      publication: { notificationKind: "analysis", notifyUsers: true,
        ...(options.frozenContext === false ? {} : { analysisUpdateContext: context }),
        website: { cards: { tradersLinkAiRead: { body: JSON.stringify({ symbol, fixturePresenceOnly: true, privateCanary: "NEVER EXPORT FULL CARDS" }) } } } } } };
  review.events.push(approval, acknowledged(approval.revision, evidence.updated.websiteAcknowledgedAt));
  review.approved = approval;
  const entry = { symbol, active: true, watchlistGroup: options.moved === false ? "main" : evidence.move.to,
    publicationReview: { required: true, cycleId } };
  // Call the actual event producer without constructing workers or providers.
  const manager = Object.create(ManualWatchlistRuntimeManager.prototype);
  manager.options = { now: () => milliseconds(evidence.updated.approvedAt) + 60_000,
    tradersLinkAiReadReviewStore: { read: (id: string) => { assert.equal(id, cycleId); return review; } } };
  manager.watchlistStore = { getActiveEntries: () => [entry] };
  manager.getTradersLinkAiReadReviewControls = () => ({});
  return { manager, review, entry, approval, context, initial };
}

test("recorded BRAI metadata reproduces the lossy projection, while the actual producer preserves the update context", () => {
  const { manager, review, approval, context } = scenario();
  assert.equal(evidence.updated.runtimeHasPreviousAnalysis, true);
  assert.equal(evidence.updated.platformSavedHasPreviousAnalysis, false);
  // Prior behavior: earlier history/cards and the frozen flag were all omitted.
  const lossy = { events: [{ ...approval, body: { ...approval.body,
    publication: { notificationKind: "analysis", notifyUsers: true } } }, review.events.at(-1)] };
  assert.equal(analysisUpdateContextFromReview(lossy, approval.revision).hasPreviousAnalysis, false);
  const result = manager.getAutomaticAnalysisEvents();
  assert.equal(result.events.length, 1);
  const projected = result.events[0];
  assert.equal(projected.review.events.length, 2);
  assert.deepEqual(projected.review.events[0].body.publication.analysisUpdateContext, context);
  assert.equal(analysisUpdateContextFromReview(projected.review, approval.revision).hasPreviousAnalysis, true);
  assert.equal(projected.review.events[0].body.publication.analysisUpdateContext.categoryMoveNote, "Now on Overnight Watches.");
  assert.doesNotMatch(JSON.stringify(projected), /NEVER EXPORT FULL CARDS|fixturePresenceOnly/);
  assert.equal(projected.cycleId, cycleId);
  assert.equal(projected.draftRevision, evidence.updated.draftRevision);
  assert.equal(projected.expectedHead, evidence.updated.approvalRevision - 1);
});

test("move then automatic refresh preserves provenance for arbitrary symbols, with and without a prior frozen context", () => {
  for (const symbol of ["TEST", "OTHER"]) for (const frozenContext of [false, true]) {
    const { manager, approval } = scenario({ symbol, frozenContext });
    const projected = manager.getAutomaticAnalysisEvents().events[0];
    const context = analysisUpdateContextFromReview(projected.review, approval.revision);
    assert.equal(context.hasPreviousAnalysis, true);
    assert.equal(context.automatic, true);
  }
});

test("move then manually approved refresh remains an update; true list-only then first analysis remains first", () => {
  for (const listingOnly of [false, true]) {
    const { review, initial, approval, manager } = scenario({ listingOnly });
    const before = { ...review, events: review.events.filter((event: any) => event.revision <= initial.revision + 1) };
    const context = analysisUpdateContextForDraft(before, null);
    assert.equal(context.hasPreviousAnalysis, !listingOnly);
    const read = { symbol: "TEST" } as TradersLinkAiReadPayload;
    const text = attributeOwnerApprovedDiscord(renderApprovedAnalysisDiscord(read, true, { everyone: true, roles: [] }, context),
      "platform-owner:10000000-0000-4000-8000-000000000001").join("\n");
    assert.match(text, listingOnly ? /Analysis published by "This Guy"/ : /Analysis updated by "This Guy"/);
    if (listingOnly) assert.match(text, /The first analysis is now available/);
    else assert.doesNotMatch(text, /The first analysis/);
    assert.equal(approval.body.publication.analysisUpdateContext.hasPreviousAnalysis, !listingOnly);
    assert.equal(manager.getAutomaticAnalysisEvents().events[0].review.events[0].body.publication.analysisUpdateContext.hasPreviousAnalysis, !listingOnly);
  }
});

test("repeated moves and repeated polling preserve notification identity without writing events or altering approvals", () => {
  const { manager, review, entry } = scenario();
  const original = JSON.stringify(review);
  const first = manager.getAutomaticAnalysisEvents();
  for (const group of ["main", evidence.move.to, "main", evidence.move.to]) {
    entry.watchlistGroup = group;
    assert.deepEqual(manager.getAutomaticAnalysisEvents(), first);
  }
  assert.equal(JSON.stringify(review), original);
  assert.equal(first.events[0].review.events[0].body.publication.notificationKind, "analysis");
  assert.equal(first.events[0].review.events[0].body.publication.notifyUsers, true);
});
