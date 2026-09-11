import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { WATCHLIST_ROW_REVIEW } from "../runtime/manual-watchlist-row-review.js";
import { MANUAL_WATCHLIST_PAGE } from "../runtime/manual-watchlist-page.js";

function harness(status = "Ready for review", canReview = true) {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  const listeners: Record<string, (event: any) => void> = {};
  const messages: unknown[] = [];
  const window: any = { location: { origin: "https://app.test" }, parent: { postMessage: (body: unknown) => messages.push(body) }, addEventListener: (name: string, fn: any) => { listeners[name] = fn; }, dispatchEvent: () => {} };
  const document = { createElement: (tag: string) => ({ tag, textContent: "", disabled: false, setAttribute() {}, onclick: null }) };
  const context = { window, document, AbortSignal, Event, fetch: async (url: string, options: any) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : undefined });
    return { ok: true, json: async () => url.endsWith("/queue") ? { tickers: [{ symbol: "TRUG", status, canReview }] } : url.includes("/preview") ? { cycleId: "cycle", expectedHead: 7, draftRevision: 5, previewHash: "exact-hash" } : {} };
  } };
  new Script(WATCHLIST_ROW_REVIEW.match(/<script>([\s\S]*?)<\/script>/)![1]!).runInNewContext(context);
  const children: any[] = [];
  return { calls, messages, listeners, window, children, async render(required = true) { await window.watchlistRowReview.refresh(); window.watchlistRowReview.attach({ symbol: "TRUG", publicationReview: { required } }, { append: (node: any) => children.push(node) }); } };
}
test("row edit opens the card, approval pins the saved preview, and neither generates AI", async () => {
  const h = harness(); await h.render();
  h.children.find(n => n.textContent === "View / edit analysis").onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(h.messages[0])), { source: "traderslink-watchlist-admin", type: "edit-analysis", symbol: "TRUG" });
  await h.children.find(n => n.textContent === "Approve and publish").onclick();
  assert.deepEqual(h.calls.find(c => c.url.endsWith("/approve"))?.body, { symbol: "TRUG", cycleId: "cycle", expectedHead: 7, draftRevision: 5, previewHash: "exact-hash" });
  assert.ok(h.calls.every(c => c.url.startsWith("/api/watchlist/analysis-review")));
});
test("ordinary posts get no review actions; preparing, failed and approved rows cannot publish again", async () => {
  const ordinary = harness(); await ordinary.render(false); assert.equal(ordinary.children.length, 0);
  for (const status of ["Preparing analysis", "Analysis failed — held for review", "Published", "Approved — delivery needs attention", "Preparing replacement — previous version available"]) {
    const h = harness(status, !status.startsWith("Analysis failed")); await h.render();
    assert.equal(h.children.find(n => n.textContent === "Approve and publish").disabled, true, status);
  }
});
test("scripts remain syntactically valid and Add no longer awaits dashboard reads", () => {
  for (const match of MANUAL_WATCHLIST_PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]!);
  const submit = MANUAL_WATCHLIST_PAGE.slice(MANUAL_WATCHLIST_PAGE.indexOf('formEl.addEventListener("submit"'), MANUAL_WATCHLIST_PAGE.indexOf('formEl.addEventListener("submit"') + 2200);
  assert.match(submit, /void loadEntries\(\)/); assert.doesNotMatch(submit, /await loadEntries\(\)/);
  assert.match(submit, /finally\s*\{\s*activateButtonEl.disabled = false/);
  assert.match(WATCHLIST_ROW_REVIEW, /fetch\("\/api\//, "console relay rewriting requires double-quoted API prefix");
});

test("accepted Add unlocks while list and runtime reads are still pending", async () => {
  const start = MANUAL_WATCHLIST_PAGE.indexOf('formEl.addEventListener("submit"');
  const end = MANUAL_WATCHLIST_PAGE.indexOf('\n    });', start) + '\n    });'.length;
  let submit: any;
  const button = { disabled: false }, symbol = { value: "TRUG" };
  const never = new Promise(() => {});
  new Script(MANUAL_WATCHLIST_PAGE.slice(start, end)).runInNewContext({
    formEl: { addEventListener: (_name: string, callback: any) => { submit = callback; } },
    shouldConfirmLargeLiquidTicker: () => false, activateButtonEl: button,
    symbolEl: symbol, noteEl: { value: "" }, watchlistGroupEl: { value: "main" },
    activateEntry: async () => true, loadEntries: () => never, loadRuntimeStatus: () => never, setStatus() {},
  });
  await submit({ preventDefault() {} });
  assert.equal(button.disabled, false); assert.equal(symbol.value, "");
});
