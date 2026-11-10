import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { WATCHLIST_ROW_REVIEW } from "../runtime/manual-watchlist-row-review.js";
import { MANUAL_WATCHLIST_PAGE } from "../runtime/manual-watchlist-page.js";
import { WATCHLIST_JSON_RESPONSE_READER } from "../runtime/manual-watchlist-json-response.js";

test("manual generation acknowledgement does not claim a draft was published", () => {
  assert.match(MANUAL_WATCHLIST_PAGE, /Generated a fresh TradersLink Analysis/);
  assert.doesNotMatch(MANUAL_WATCHLIST_PAGE, /Published a fresh TradersLink AI Read/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Analysis generation did not complete/);
});

function harness(status = "Ready for review", canReview = true, extra: Record<string,unknown> = {}) {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  const listeners: Record<string, (event: any) => void> = {};
  const messages: unknown[] = [];
  const window: any = { location: { origin: "https://app.test" }, parent: { postMessage: (body: unknown) => messages.push(body) }, addEventListener: (name: string, fn: any) => { listeners[name] = fn; }, dispatchEvent: () => {} };
  const document = { createTextNode: (text: string) => ({textContent:text}), createElement: (tag: string) => ({ tag, textContent: "", disabled: false, style: {}, children: [] as any[], append(...nodes:any[]) { this.children.push(...nodes); }, setAttribute() {}, onclick: null }) };
  const context = { window, document, AbortSignal, Event, fetch: async (url: string, options: any) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : undefined });
    return { ok: true, text: async () => JSON.stringify(url.endsWith("/queue") ? { tickers: [{ symbol: "TRUG", status, canReview, ...extra }] } : url.includes("/preview") ? { cycleId: "cycle", expectedHead: 7, draftRevision: 5, previewHash: "exact-hash" } : {}) };
  } };
  new Script(WATCHLIST_ROW_REVIEW.match(/<script>([\s\S]*?)<\/script>/)![1]!).runInNewContext(context);
  const children: any[] = [];
  return { calls, messages, listeners, window, children, async render(required = true) { await window.watchlistRowReview.refresh(); window.watchlistRowReview.attach({ symbol: "TRUG", publicationReview: { required } }, { append: (node: any) => children.push(node) }); } };
}

test("failed draft can list without analysis; listed draft checkbox controls only the new analysis notification", async () => {
  const held = harness("Analysis failed — held for review",false,{cycleId:"cycle",expectedHead:7,canPublishWithoutAnalysis:true});
  await held.render();
  await held.children.find(n => n.textContent === "Publish ticker without analysis").onclick();
  assert.deepEqual(held.calls.find(c => c.url.endsWith("/publish-without-analysis"))!.body,{symbol:"TRUG",cycleId:"cycle",expectedHead:7});
  assert.equal(held.calls.some(c => c.url.includes("preview") || c.url.endsWith("approve")),false);
  const listed = harness("New draft — awaiting review",true,{listed:true,cycleId:"cycle",draftRevision:5});
  await listed.render();
  assert.equal(listed.children.some(n => n.textContent === "Publish ticker without analysis"),false);
  const checkbox = listed.children.find(n => n.tag === "label").children[0];
  assert.equal(checkbox.checked,false); checkbox.checked=true; checkbox.onchange();
  await listed.children.find(n => n.textContent === "Approve and publish analysis").onclick();
  assert.equal(listed.calls.find(c => c.url.endsWith("/approve"))!.body!.notifyUsers,true);
});

test("console response reader handles edge failures without exposing bodies or retrying writes", async () => {
  const context: any = {};
  new Script(WATCHLIST_JSON_RESPONSE_READER + '\nthis.read = readWatchlistJsonResponse;').runInNewContext(context);
  for (const [status, body, expected] of [
    [429, 'rate limited', /temporarily rate limited/],
    [502, '<html>private upstream diagnostic</html>', /temporarily unavailable/],
    [200, '<html>login or error</html>', /temporarily unavailable/],
    [200, 'null', /temporarily unavailable/],
    [401, 'unauthorized', /Sign in again/],
    [403, '{}', /Sign in again/],
    [409, '{"error":"Saved analysis changed."}', /Saved analysis changed/],
  ] as const) {
    await assert.rejects(context.read(new Response(body, { status })), (error: any) => {
      assert.match(error.message, expected); assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /<html>|Unexpected token|private upstream/); return true;
    });
  }
  const result = await context.read(new Response('{"ok":true}'));
  assert.equal(result.ok, true);
});

test("review refresh retains same-cycle controls across failures, recovers, and never uses an old activation", async () => {
  const script = WATCHLIST_ROW_REVIEW.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const h = harness('Ready for review', true, {cycleId:'current'});
  let response = new Response('{"tickers":[{"symbol":"TRUG","cycleId":"current","status":"Ready for review","canReview":true}]}');
  let calls = 0;
  const context: any = {
    window: h.window, AbortSignal, Event,
    document: {createTextNode: (text: string) => ({textContent:text}), createElement: (tag: string) => ({tag, style:{}, append(){}, prepend(){}, setAttribute(){}})},
    fetch: async () => { calls++; return response.clone(); },
  };
  new Script(script).runInNewContext(context);
  const render = (cycleId = 'current') => {
    const nodes: any[] = [];
    const root = {append: (...items: any[]) => nodes.push(...items), prepend: (...items: any[]) => nodes.unshift(...items), querySelector: () => null};
    h.window.watchlistRowReview.attach({symbol:'TRUG', publicationReview:{required:true, cycleId}},root);
    return nodes;
  };
  await h.window.watchlistRowReview.refresh();
  assert.equal(render().find(n=>n.textContent==='View / edit analysis').disabled,false);
  for (const body of ['rate limited', '<html>edge error</html>', '{"tickers":null}']) {
    response = new Response(body, {status:body==='rate limited'?429:200});
    await h.window.watchlistRowReview.refresh();
    const nodes=render();
    assert.equal(nodes.find(n=>n.textContent==='View / edit analysis').disabled,false);
    assert.ok(nodes.some(n=>n.textContent?.includes('last loaded review information')));
    assert.equal(render('new-activation').find(n=>n.textContent==='View / edit analysis').disabled,true);
  }
  response = new Response('{"tickers":[]}');
  await h.window.watchlistRowReview.refresh();
  assert.equal(render().find(n=>n.textContent==='View / edit analysis').disabled,true,'a genuine empty queue clears cached reviews');
  response = new Response('{"tickers":[{"symbol":"TRUG","cycleId":"current","canReview":true}]}');
  await h.window.watchlistRowReview.refresh();
  assert.equal(render().find(n=>n.textContent==='View / edit analysis').disabled,false);
  response = new Response('{}', {status:403});
  await h.window.watchlistRowReview.refresh();
  const denied=render();
  assert.equal(denied.find(n=>n.textContent==='View / edit analysis').disabled,true);
  assert.ok(denied.some(n=>n.textContent?.includes('Sign in again')));
  assert.equal(calls,7,'refreshes are GET-only, with no hidden retries or posts');
});

test('a failed list refresh never replaces displayed tickers with an empty list', async () => {
  const start=MANUAL_WATCHLIST_PAGE.indexOf('    async function fetchJson(url)');
  const end=MANUAL_WATCHLIST_PAGE.indexOf('    window.addEventListener("watchlist-review-updated"',start);
  const code=MANUAL_WATCHLIST_PAGE.slice(start,end);
  for(const [status,body] of [[429,'rate limited'],[502,'<html>error</html>'],[200,'<html>bad response</html>']] as const){
    let rendered=false;
    const context: any = {
      AbortSignal, fetch:async()=>new Response(body,{status}),
      window:{watchlistRowReview:{refresh:async()=>{}}}, renderEntries:()=>{rendered=true;},
    };
    new Script(code+'\nthis.load=loadEntries;').runInNewContext(context);
    await assert.rejects(context.load(),/temporarily/);
    assert.equal(rendered,false);
  }
});
test("row edit opens the card, approval pins the saved preview, and neither generates AI", async () => {
  const h = harness(); await h.render();
  h.children.find(n => n.textContent === "View / edit analysis").onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(h.messages[0])), { source: "traderslink-watchlist-admin", type: "edit-analysis", symbol: "TRUG" });
  await h.children.find(n => n.textContent === "Approve and publish").onclick();
  assert.deepEqual(h.calls.find(c => c.url.endsWith("/approve"))?.body, { symbol: "TRUG", cycleId: "cycle", expectedHead: 7, draftRevision: 5, previewHash: "exact-hash", notifyUsers: false, freeChat: false });
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
