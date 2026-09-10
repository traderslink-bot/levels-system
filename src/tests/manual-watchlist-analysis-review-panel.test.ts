import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { ANALYSIS_REVIEW_PANEL } from "../runtime/manual-watchlist-analysis-review-panel.js";
import { MANUAL_WATCHLIST_PAGE } from "../runtime/manual-watchlist-page.js";

test("owner editor embeds once and generated browser script parses", () => {
  assert.equal(MANUAL_WATCHLIST_PAGE.split('id="analysis-review-panel"').length - 1, 1);
  const script = ANALYSIS_REVIEW_PANEL.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
  assert.match(script, /x-traderlink-journal-admin-request/);
  assert.doesNotMatch(script, /\.innerHTML|insertAdjacentHTML|eval\(/);
  for (const label of ["Save draft", "Preview", "Approve and publish", "Retry Discord delivery"]) assert.ok(ANALYSIS_REVIEW_PANEL.includes(label));
});

test("editor API base survives the Platform proxy URL rewriting", () => {
  const rewritten = ANALYSIS_REVIEW_PANEL.replaceAll('"/api/', '"/api/admin/watchlist/runtime/');
  assert.ok(rewritten.includes('const base = "/api/admin/watchlist/runtime/watchlist/analysis-review"'));
  assert.match(rewritten, /previewHash: preview.previewHash/);
  assert.match(rewritten, /expectedHead: review.head/);
  assert.match(rewritten, /beforeunload/);
});
