import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import type { IncomingMessage } from "node:http";

import {
  MAX_JSON_BODY_BYTES,
  RequestBodyParseError,
  readJsonBody,
} from "../runtime/manual-watchlist-http.js";
import { MANUAL_WATCHLIST_PAGE } from "../runtime/manual-watchlist-page.js";

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
  assert.match(MANUAL_WATCHLIST_PAGE, /appendMetaValue\(details, "note", entry\.note\);/);
  assert.doesNotMatch(MANUAL_WATCHLIST_PAGE, /meta\.innerHTML/);
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
