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

test("failed requests render history without a draft and clear stale editor state", () => {
  const script = ANALYSIS_REVIEW_PANEL.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const functions = script.slice(script.indexOf("  function renderReviewHistory("), script.indexOf('  byId("load").onclick'));
  const element = () => ({ children: [] as any[], hidden: false, value: "", replaceChildren() { this.children = []; } });
  const editor = element(), previewContent = element(), generations = element(), exportArea = element(), actions = element();
  const texts: string[] = [];
  const context = {
    editor, previewContent, actions, patch: { old: true }, dirty: true, preview: {}, historical: false,
    review: { draft: null, events: [
      { revision: 2, at: 1, body: { kind: "generation", generationId: "request-1", status: "started", trigger: "manual" } },
      { revision: 3, at: 2, body: { kind: "generation", generationId: "request-1", status: "failed", trigger: "manual" } },
    ] },
    byId: (id: string) => id === "export-generation" ? generations : exportArea,
    node: (_tag: string, text: string | undefined, parent: ReturnType<typeof element>) => { const result = element(); parent.children.push(result); if (text) texts.push(text); return result; },
    message: (_text: string) => {},
  };
  new Script(functions + "\nrenderEditor();").runInNewContext(context);
  assert.ok(texts.includes("Request and version history"));
  assert.ok(texts.some(text => text.includes("failed") && text.includes("manual")));
  assert.ok(texts.some(text => text.includes("started")));
  assert.ok(texts.includes("Recorded requests: 1"));
  assert.equal(texts.filter(text => text.startsWith("Request 1 · Version")).length, 2);
  assert.equal(generations.children.length, 1);
  assert.equal(actions.hidden, true);
  assert.equal(context.dirty, false);
  assert.equal(context.patch, null);
  texts.length = 0;
  context.review.events = Array.from({ length: 5 }, (_, index) => [
    { revision: index * 2 + 1, at: index * 2 + 1, body: { kind: "generation", generationId: "request-" + index, status: "started", trigger: "manual" } },
    { revision: index * 2 + 2, at: index * 2 + 2, body: { kind: "generation", generationId: "request-" + index, status: "failed", trigger: "manual" } },
  ]).flat();
  new Script(functions + "\nrenderEditor();").runInNewContext(context);
  assert.ok(texts.includes("Recorded requests: 5"));
  assert.equal(generations.children.length, 5);
  for (let index = 1; index <= 5; index++) assert.equal(texts.filter(text => text.startsWith("Request " + index + " · Version")).length, 2);
  context.historical = true;
  (context.review as any).draft = { body: { payload: { currentRead: "Saved historical draft" } } };
  context.dirty = true;
  actions.hidden = false;
  new Script(functions + "\nrenderEditor();").runInNewContext(context);
  assert.equal(actions.hidden, true);
  assert.equal(context.patch, null);
  assert.equal(context.dirty, false);
  assert.equal(exportArea.hidden, false);
  assert.equal(generations.children.length, 5);
});
