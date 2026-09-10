import assert from "node:assert/strict";
import test from "node:test";
import { dispatchAnalysisReviewRequest } from "../runtime/manual-watchlist-analysis-review-api.js";

function setup() {
  const calls: Array<{ method: string; input: unknown }> = [];
  const call = (method: string) => (input: unknown) => { calls.push({ method, input }); return { saved: true }; };
  const manager = {
    getTradersLinkAiReadReview: call("read"), getTradersLinkAiReadPublicationPreview: call("preview"),
    listTradersLinkAiReadReviews: call("queue"),
    saveTradersLinkAiReadOwnerEdit: call("save"), approveTradersLinkAiRead: call("approve"),
    publishApprovedTradersLinkAiReadToDiscord: call("retry"),
  };
  const send = (pathname: string, body?: unknown, actor: string | undefined = "platform-owner:test-owner", method = "POST") =>
    dispatchAnalysisReviewRequest({ pathname: `/api/watchlist/analysis-review${pathname}`, body, actor, method, searchParams: new URLSearchParams("symbol=PDSB") }, manager as any);
  return { calls, manager, send };
}

test("private review and previews require a proxy owner actor and correct methods", async () => {
  const { calls, send } = setup();
  assert.equal((await send("", undefined, "", "GET")).status, 403);
  assert.equal((await send("/preview", undefined, "browser-user", "GET")).status, 403);
  assert.equal((await send("/save", {}, undefined, "GET")).status, 405);
  assert.equal(calls.length, 0);
  assert.equal((await send("", undefined, undefined, "GET")).status, 200);
  assert.equal((await send("/preview", undefined, undefined, "GET")).status, 200);
  assert.deepEqual(calls.map((call) => call.method), ["read", "preview"]);
});

test("save takes actor from trusted context and rejects body actor injection", async () => {
  const { calls, send } = setup();
  const body = { symbol: "pdsb", cycleId: "cycle", expectedHead: 2, patch: { currentRead: "Owner edit" } };
  assert.equal((await send("/save", { ...body, actor: "spoofed" })).status, 400);
  assert.equal((await send("/save", body)).status, 200);
  assert.deepEqual(calls, [{ method: "save", input: { ...body, symbol: "PDSB", actor: "platform-owner:test-owner" } }]);
});

test("approval requires exact revision and preview hash; Discord retry does not regenerate", async () => {
  const { calls, send } = setup();
  const body = { symbol: "PDSB", cycleId: "cycle", expectedHead: 2, draftRevision: 2, previewHash: "a".repeat(64) };
  assert.equal((await send("/approve", { ...body, previewHash: "" })).status, 400);
  assert.equal((await send("/approve", { ...body, draftRevision: -1 })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await send("/approve", body)).status, 200);
  assert.equal((await send("/retry-discord", { symbol: "PDSB", cycleId: "cycle", approvalRevision: 3 })).status, 200);
  assert.deepEqual(calls.map((call) => call.method), ["approve", "retry"]);
});

test("conflicts are actionable but provider response details stay private", async () => {
  const { manager, send } = setup();
  manager.getTradersLinkAiReadReview = () => { throw new Error("secret-token and private-path"); };
  const failed = await send("", undefined, undefined, "GET");
  assert.equal(failed.status, 503);
  assert.doesNotMatch(JSON.stringify(failed), /secret-token|private-path|history is unchanged/);
  manager.getTradersLinkAiReadReview = () => { throw new Error("Draft changed. Reload before saving."); };
  assert.equal((await send("", undefined, undefined, "GET")).status, 409);
});

test("owner review controls use a separate exact boolean contract", async () => {
  const { manager, calls } = setup();
  let saved = { automaticUpdatesEnabled: false, reviewBeforePublishingEnabled: true };
  const controls = { get: () => saved, save: (input: typeof saved) => { saved = input; return saved; } };
  const request = { pathname: "/api/watchlist/analysis-review/settings", method: "GET", actor: "platform-owner:test-owner", searchParams: new URLSearchParams() };
  assert.deepEqual((await dispatchAnalysisReviewRequest(request, manager as any, controls)).body, { settings: saved });
  const next = { automaticUpdatesEnabled: true, reviewBeforePublishingEnabled: false };
  assert.equal((await dispatchAnalysisReviewRequest({ ...request, method: "POST", body: { ...next, regularEnabled: false } }, manager as any, controls)).status, 400);
  assert.equal(saved.automaticUpdatesEnabled, false);
  assert.equal((await dispatchAnalysisReviewRequest({ ...request, method: "POST", body: next }, manager as any, controls)).status, 200);
  assert.deepEqual(saved, next);
  assert.equal(calls.length, 0);
});

test("pending review list is owner-only and read-only", async () => {
  const { calls, send } = setup();
  assert.equal((await send("/queue", undefined, "", "GET")).status, 403);
  assert.equal((await send("/queue", {}, undefined, "POST")).status, 405);
  assert.equal(calls.length, 0);
  assert.equal((await send("/queue", undefined, undefined, "GET")).status, 200);
  assert.deepEqual(calls.map((call) => call.method), ["queue"]);
});
