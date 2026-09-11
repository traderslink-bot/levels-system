import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { ANALYSIS_REVIEW_PANEL } from "../runtime/manual-watchlist-analysis-review-panel.js";
import { MANUAL_WATCHLIST_PAGE } from "../runtime/manual-watchlist-page.js";

test("request inspector renders lazily with explicit truncation and unavailable diagnostics", () => {
  const script = ANALYSIS_REVIEW_PANEL.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const render = script.slice(script.indexOf("  function renderAudit("), script.indexOf('  byId("inspect").onclick'));
  const elements: any[] = [];
  const container = { replaceChildren: () => { elements.length = 0; } };
  const context = {
    byId: () => container,
    node: (tag: string, text: string | undefined) => {
      const element: any = { tag, text, style: {}, open: false, addEventListener: (_event: string, callback: () => void) => { element.toggle = callback; } };
      elements.push(element); return element;
    },
    audit: { symbol: "PDSB", generationId: "g1", diagnosticStatus: "available", diagnostic: { events: [
      { phase: "response", payload: "<script>untrusted()</script>" + "x".repeat(100000) },
      { phase: "validation", payload: { stage: "optional_sections", issues: [
        { path: "pullbackPlans.shallow.zoneHigh", code: "reference_order", action: "omit_section" },
        { path: "pullbackPlans.deep.firstObjectivePrice", code: "objective_order", action: "omit_objective" },
        { path: "failureRecovery.zone", code: "future_code", action: "omit_section" },
      ] } },
      { phase: "validation", payload: { stage: "breakout_selection", selectedCandidateId: "alternate" } },
      { phase: "validation", payload: { stage: "outer_daily_resistance", action: "omit_objective", omitted: [{ price: 2.3 }] } },
      { phase: "validation", payload: { stage: "optional_overview", issues: [{ path: "currentRead", action: "omit_text" }] } },
    ] }, selectedEvents: [{ revision: 2, body: { kind: "original" } }] },
  };
  new Script(render + "\nrenderAudit(audit);").runInNewContext(context);
  assert.equal(elements.filter(element => element.tag === "pre").length, 0);
  assert.ok(elements.some(element => element.text === "Analysis checks"));
  assert.ok(elements.some(element => element.text?.startsWith("Analysis overview — omitted after a text check;")));
  assert.ok(elements.some(element => element.text === "Shallow pullback — omitted: zone is not sufficiently below the analysis price."));
  assert.ok(elements.some(element => element.text === "Deep pullback — optional objective omitted: the optional objective is out of order."));
  assert.ok(elements.some(element => element.text === "Failure / recovery — omitted: see the validation record for details."));
  assert.ok(elements.some(element => element.text === "Breakout continuation — backup selected from the same AI response."));
  assert.ok(elements.some(element => element.text?.startsWith("Farther daily resistance — optional addition omitted;")));
  const detail = elements.find(element => element.tag === "details");
  detail.open = true; detail.toggle(); detail.toggle();
  const pre = elements.filter(element => element.tag === "pre");
  assert.equal(pre.length, 1);
  assert.equal(pre[0].text.length, 100000);
  assert.ok(pre[0].text.startsWith("<script>untrusted()</script>"));
  assert.ok(elements.some(element => element.text?.includes("Display shortened")));
  context.audit.diagnosticStatus = "unavailable";
  context.audit.diagnostic = null as any;
  new Script(render + "\nrenderAudit(audit);").runInNewContext(context);
  assert.ok(elements.some(element => element.text?.includes("diagnostics are unavailable")));
  assert.ok(elements.some(element => element.text === "Version 2 · original"));
  assert.equal(elements.filter(element => element.tag === "details").length, 1);
  assert.equal(elements.some(element => element.text === "Analysis checks"), false, "missing diagnostics must not imply a clean check result");
});

test("receipt controls show only uncertain parts of the current approval and clear stale IDs", () => {
  const script = ANALYSIS_REVIEW_PANEL.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const render = script.slice(script.indexOf("  function renderVerificationControls("), script.indexOf('  byId("verify-discord").onclick'));
  const area = { hidden: false };
  const input = { value: "123456789012345678" };
  const parts = { children: [] as any[], replaceChildren() { this.children = []; } };
  const event = (approvalRevision: number, index: number, status: string) => ({ body: { kind: "discord_chunk", approvalRevision, index, status } });
  const context = {
    historical: false,
    review: { approved: { revision: 5 }, events: [event(3, 0, "started"), event(5, 0, "started"), event(5, 0, "acknowledged"), event(5, 1, "started"), event(5, 2, "rejected")] },
    byId: (id: string) => id === "verification" ? area : id === "verify-part" ? parts : input,
    node: (_tag: string, text: string, parent: typeof parts) => { const option = { text, value: "" }; parent.children.push(option); return option; },
  };
  new Script(render + "\nrenderVerificationControls();").runInNewContext(context);
  assert.equal(area.hidden, false);
  assert.equal(input.value, "");
  assert.deepEqual(parts.children, [{ text: "Part 2 · Awaiting confirmation", value: "1" }]);
  context.historical = true;
  input.value = "123456789012345678";
  new Script(render + "\nrenderVerificationControls();").runInNewContext(context);
  assert.equal(area.hidden, true);
  assert.equal(input.value, "");
  assert.equal(parts.children.length, 0);
});

test("receipt verification preserves unsaved edits and invalidates their preview without sending", async () => {
  const script = ANALYSIS_REVIEW_PANEL.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const handler = script.slice(script.indexOf('  byId("verify-discord").onclick'), script.indexOf("  function renderAudit("));
  const button = { onclick: undefined as undefined | (() => Promise<void>) };
  const input = { value: "123456789012345678" };
  const calls: any[] = [];
  const patch = { breakout: 0.54321 };
  let refreshed = 0, cleared = 0;
  const context = {
    historical: false, dirty: true, patch, preview: { old: true },
    review: { symbol: "PDSB", cycleId: "cycle", head: 7, approved: { revision: 5 } },
    byId: (id: string) => id === "verify-discord" ? button : id === "verify-part" ? { value: "0" } : input,
    run: (work: () => Promise<void>) => work(),
    request: async (path: string, body: unknown) => { calls.push({ path, body }); return { review: { symbol: "PDSB", cycleId: "cycle", head: 8, approved: { revision: 5 } } }; },
    renderVerificationControls: () => { refreshed++; },
    renderEditor: () => { throw new Error("Must not overwrite unsaved draft"); },
    previewContent: { replaceChildren: () => { cleared++; } }, message: (_text: string) => {},
  };
  new Script(handler).runInNewContext(context);
  await button.onclick!();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/verify-discord");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body)), { symbol: "PDSB", cycleId: "cycle", expectedHead: 7, approvalRevision: 5, index: 0, messageId: "123456789012345678" });
  assert.equal(context.patch, patch);
  assert.equal(context.dirty, true);
  assert.equal(context.preview, null);
  assert.equal(context.review.head, 8);
  assert.equal(input.value, "");
  assert.equal(refreshed, 1);
  assert.equal(cleared, 1);
  context.historical = true;
  await assert.rejects(button.onclick!(), /current approved review/);
  assert.equal(calls.length, 1);
});

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
    message: (_text: string) => {}, renderVerificationControls: () => {},
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
