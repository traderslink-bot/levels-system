import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveWatchlistPotentialPathPresentation } from "../lib/live-watchlist/live-watchlist-publisher.js";
import { isSyntheticResistance, NO_HIGHER_RESISTANCE } from "../lib/live-watchlist/resistance-evidence.js";

test("cached snapshot projections are removed without dropping evidenced historical extensions or support", () => {
  const support = { representativePrice: 4.5, sourceLabel: "daily structure", sourceEvidenceCount: 2, touchCount: 3, strengthLabel: "strong" };
  const observed = { representativePrice: 6, sourceLabel: "extension", sourceEvidenceCount: 1, touchCount: 0, strengthLabel: "weak", isExtension: true };
  const synthetic = { representativePrice: 7, sourceLabel: "extension", sourceEvidenceCount: 0, touchCount: 0, strengthLabel: "weak", isExtension: true };
  const continuation = { ...synthetic, representativePrice: 8, sourceLabel: "continuation map", isExtension: false };
  const payload: any = { symbol: "TEST", currentPrice: 5, timestamp: 1000,
    supportZones: [support], resistanceZones: [observed, synthetic, continuation],
    ladderResistanceZones: [observed, synthetic, continuation], specialLevels: {},
    levelDataQuality: { status: "full", availableTimeframes: ["daily", "4h"], flags: [] } };
  const before = JSON.stringify(payload);
  const view = buildLiveWatchlistPotentialPathPresentation(payload);
  assert.deepEqual(view.levelMap?.resistanceLevels.map(row => row.price), [6]);
  assert.equal(view.levelMap?.supportLevels[0]?.price, 4.5);
  assert.match(view.fullLadderCard?.body ?? "", /6\.00/);
  assert.doesNotMatch(view.fullLadderCard?.body ?? "", /7\.00|8\.00/);
  const proof = JSON.parse(String(view.fullLadderCard?.metadata?.resistanceEvidence));
  assert.equal(proof[0].sourceEvidenceCount, 1);
  assert.equal(JSON.stringify(payload), before);
});
test("exhausted history and unavailable data have distinct truthful copy, with no numerical replacement", () => {
  const payload: any = { symbol: "ANY", currentPrice: 5, timestamp: 1000,
    supportZones: [{ representativePrice: 4.5, sourceLabel: "daily structure", strengthLabel: "strong" }], resistanceZones: [], specialLevels: {},
    levelDataQuality: { status: "limited", availableTimeframes: ["daily"], flags: ["4h_missing"] } };
  const view = buildLiveWatchlistPotentialPathPresentation(payload);
  assert.deepEqual(view.levelMap?.resistanceLevels, []);
  assert.match(view.nearestSupportResistanceCard?.body ?? "", new RegExp(NO_HIGHER_RESISTANCE.replaceAll(".", "\\.")));
  assert.match(view.fullLadderCard?.body ?? "", /No higher historical resistance detected/);
  payload.levelDataQuality.status = "unavailable";
  assert.match(buildLiveWatchlistPotentialPathPresentation(payload).nearestSupportResistanceCard?.body ?? "", /Historical resistance data is unavailable/);
});
test("raw synthetic markers are decisive; absent metadata and real observations are not fabricated", () => {
  assert.equal(isSyntheticResistance({ id: "TEST-synthetic-resistance-extension-7" }), true);
  assert.equal(isSyntheticResistance({ notes: ["snapshot_continuation_map"] }), true);
  assert.equal(isSyntheticResistance({ sourceLabel: "extension" }), false);
  assert.equal(isSyntheticResistance({ sourceLabel: "extension", sourceEvidenceCount: 2, touchCount: 0 }), false);
  assert.equal(isSyntheticResistance({ sourceLabel: "intraday", sourceEvidenceCount: 0, touchCount: 0 }), false);
});
