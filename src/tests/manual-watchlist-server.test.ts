import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import type { IncomingMessage } from "node:http";

import {
  MAX_JSON_BODY_BYTES,
  RequestBodyParseError,
  readJsonBody,
} from "../runtime/manual-watchlist-http.js";
import { AI_CLEAN_READ_PAGE } from "../runtime/ai-clean-read-page.js";
import { MANUAL_WATCHLIST_PAGE } from "../runtime/manual-watchlist-page.js";
import { TRADE_PLAN_REVIEW_PAGE } from "../runtime/trade-plan-review-page.js";

function buildRequest(
  body: string,
  headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
  },
): IncomingMessage {
  const request = Readable.from(body.length > 0 ? [body] : []) as IncomingMessage;
  Object.assign(request, { headers });
  return request;
}

test("manual watchlist page builds entry metadata without innerHTML interpolation", () => {
  assert.match(MANUAL_WATCHLIST_PAGE, /title\.textContent = entry\.symbol;/);
  assert.match(MANUAL_WATCHLIST_PAGE, /appendMetaValue\(details, "OpenAI notes", entry\.note\);/);
  assert.doesNotMatch(MANUAL_WATCHLIST_PAGE, /meta\.innerHTML/);
});

test("manual watchlist page shows runtime status and separate review surfaces", () => {
  assert.match(MANUAL_WATCHLIST_PAGE, /Runtime Status/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Provider Health/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Runtime Config/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Review Artifacts/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Open AI Clean Read/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Notes to send to OpenAI \(optional\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /<textarea id="note" name="note"/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Open Trade Plan Review/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Monday Live Review/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Last Why Posted/);
  assert.match(MANUAL_WATCHLIST_PAGE, /symbol post budget/);
  assert.match(MANUAL_WATCHLIST_PAGE, /AI commentary can add separate AI read posts after deterministic alerts/);
  assert.match(MANUAL_WATCHLIST_PAGE, /manual-watchlist-operational\.log/);
  assert.match(MANUAL_WATCHLIST_PAGE, /manual-watchlist-diagnostics\.log/);
  assert.match(MANUAL_WATCHLIST_PAGE, /discord-delivery-audit\.jsonl/);
  assert.match(MANUAL_WATCHLIST_PAGE, /thread-summaries\.json/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Discord thread ID/);
  assert.match(MANUAL_WATCHLIST_PAGE, /fetch\("\/api\/runtime\/status"\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /fetch\("\/api\/runtime\/review-artifacts"\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /renderReviewArtifacts/);
  assert.match(MANUAL_WATCHLIST_PAGE, /renderMondayReview/);
  assert.match(MANUAL_WATCHLIST_PAGE, /renderProviderHealth/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Historical Data/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Pending Seeds/);
  assert.match(MANUAL_WATCHLIST_PAGE, /restart-readiness-list/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Seed Attempts/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Seed Timeouts/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Seeds In Flight/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Candle Cache/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Runtime Candle Cache/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Startup Cache/);
  assert.match(MANUAL_WATCHLIST_PAGE, /lastTradeStoryState/);
  assert.match(MANUAL_WATCHLIST_PAGE, /levels age/);
  assert.match(MANUAL_WATCHLIST_PAGE, /price age/);
  assert.match(MANUAL_WATCHLIST_PAGE, /artifact\.name/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Refresh Levels/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Repost Snapshot/);
  assert.match(MANUAL_WATCHLIST_PAGE, /Copy Thread/);
  assert.match(MANUAL_WATCHLIST_PAGE, /\/api\/watchlist\/refresh-levels/);
  assert.match(MANUAL_WATCHLIST_PAGE, /\/api\/watchlist\/repost-snapshot/);
  assert.match(MANUAL_WATCHLIST_PAGE, /window\.open\("\/trade-plan-review", "trade-plan-review"\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /window\.open\("\/ai-clean-read", "ai-clean-read"\)/);
  assert.match(MANUAL_WATCHLIST_PAGE, /entry\.operationStatus/);
  assert.match(TRADE_PLAN_REVIEW_PAGE, /Support Must Hold/);
  assert.match(AI_CLEAN_READ_PAGE, /Generate Clean Read/);
  assert.match(AI_CLEAN_READ_PAGE, /Notes to send to OpenAI \(optional\)/);
  assert.match(AI_CLEAN_READ_PAGE, /Token usage will appear after generation/);
  assert.match(AI_CLEAN_READ_PAGE, /Recent usage:/);
  assert.match(AI_CLEAN_READ_PAGE, /These comments are not sent to OpenAI/);
  assert.match(AI_CLEAN_READ_PAGE, /\/api\/ai-clean-read\/generate/);
  assert.match(AI_CLEAN_READ_PAGE, /\/api\/ai-clean-read\/comments/);
  assert.match(AI_CLEAN_READ_PAGE, /Audit comments/);
  assert.match(AI_CLEAN_READ_PAGE, /AUTO_REFRESH_INTERVAL_MS = 4000/);
  assert.match(AI_CLEAN_READ_PAGE, /setInterval/);
  assert.match(AI_CLEAN_READ_PAGE, /forceLatest/);
  assert.match(AI_CLEAN_READ_PAGE, /button\.dataset\.recordId/);
  assert.match(AI_CLEAN_READ_PAGE, /Show clean read for/);
});

test("readJsonBody parses valid JSON requests", async () => {
  const body = await readJsonBody(buildRequest('{"symbol":"ALBT","note":"watch"}'));

  assert.deepEqual(body, {
    symbol: "ALBT",
    note: "watch",
  });
});

test("readJsonBody rejects non-json content types", async () => {
  await assert.rejects(
    readJsonBody(buildRequest('{"symbol":"ALBT"}', { "content-type": "text/plain" })),
    (error: unknown) =>
      error instanceof RequestBodyParseError &&
      error.statusCode === 415 &&
      error.message === "Content-Type must be application/json.",
  );
});

test("readJsonBody rejects invalid JSON bodies", async () => {
  await assert.rejects(
    readJsonBody(buildRequest('{"symbol":')),
    (error: unknown) =>
      error instanceof RequestBodyParseError &&
      error.statusCode === 400 &&
      error.message === "Invalid JSON body.",
  );
});

test("readJsonBody rejects oversized bodies", async () => {
  const oversizedNote = "x".repeat(MAX_JSON_BODY_BYTES);
  const request = buildRequest(
    JSON.stringify({ note: oversizedNote }),
    {
      "content-type": "application/json",
      "content-length": String(MAX_JSON_BODY_BYTES + 1),
    },
  );

  await assert.rejects(
    readJsonBody(request),
    (error: unknown) =>
      error instanceof RequestBodyParseError &&
      error.statusCode === 413 &&
      error.message === `Request body too large. Max ${MAX_JSON_BODY_BYTES} bytes.`,
  );
});
