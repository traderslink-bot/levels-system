import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { DurableLiveWatchlistPublisher } from "../lib/live-watchlist/live-watchlist-publish-outbox.js";
import { LiveWatchlistHttpPublisher } from "../lib/live-watchlist/live-watchlist-publisher.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const patch = (symbol: string) => ({ symbol, updatedAt: 123, cards: {} });

test("HTTP guard holds both card and quote data for a pending ticker while unrelated symbols continue", async () => {
  const sent: unknown[] = [];
  const publisher = new LiveWatchlistHttpPublisher({
    ingestUrl: "https://example.invalid/ingest", token: "test", retryAttempts: 0,
    authorizePublication: value => !("symbol" in value) || value.symbol !== "PDSB",
    fetchImpl: async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return new Response("{}", { status: 200 }); },
  });
  await assert.rejects(publisher.publish(patch("PDSB")), /owner approval/);
  await assert.rejects(publisher.publishTickerData({ type: "tickerData", symbol: "PDSB", updatedAt: 123, latestPrice: 0.5,
    nearestSupport: null, nearestResistance: null }), /owner approval/);
  assert.equal(sent.length, 0);
  await publisher.publish(patch("FTFT"));
  assert.deepEqual(sent, [patch("FTFT")]);
});

test("held publication never reaches HTTP and does not create retry outbox entries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "publish-gate-")); directories.push(directory);
  let requests = 0;
  const publisher = new DurableLiveWatchlistPublisher({ publish: async () => { requests += 1; } }, join(directory, "outbox.json"), () => false);
  await assert.rejects(publisher.publish(patch("PDSB")), /owner approval/);
  assert.equal(requests, 0);
  assert.equal(publisher.pendingCount(), 0);
});

test("restart replay holds an unapproved ticker without blocking unrelated updates or acknowledging it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "publish-replay-gate-")); directories.push(directory);
  const path = join(directory, "outbox.json");
  const offline = new DurableLiveWatchlistPublisher({ publish: async () => { throw new Error("offline"); } }, path);
  await assert.rejects(offline.publish(patch("PDSB")), /offline/);
  const sent: string[] = [];
  const acknowledged: string[] = [];
  let allowed = false;
  const restored = new DurableLiveWatchlistPublisher({ publish: async (value) => { sent.push(value.symbol); } }, path,
    (value) => !("symbol" in value) || value.symbol !== "PDSB" || allowed);
  restored.onPublished((value) => { if ("symbol" in value) acknowledged.push(value.symbol); });
  await restored.publish(patch("FTFT"));
  assert.deepEqual(sent, ["FTFT"]);
  assert.deepEqual(acknowledged, ["FTFT"]);
  assert.equal(restored.pendingCount(), 1);
  allowed = true;
  await restored.replayPending();
  assert.deepEqual(sent, ["FTFT", "PDSB"]);
  assert.equal(restored.pendingCount(), 0);
});

test("HTTP retries recheck approval before sending again", async () => {
  let allowed = true;
  let calls = 0;
  const publisher = new LiveWatchlistHttpPublisher({
    ingestUrl: "https://example.invalid/ingest", token: "test", retryAttempts: 2, retryDelayMs: 0,
    authorizePublication: () => allowed,
    fetchImpl: async () => { calls += 1; allowed = false; return new Response("", { status: 503 }); },
  });
  await assert.rejects(publisher.publish(patch("PDSB")), /owner approval/);
  assert.equal(calls, 1);
});

test("approval lookup errors fail closed before transport", async () => {
  let calls = 0;
  const publisher = new LiveWatchlistHttpPublisher({
    ingestUrl: "https://example.invalid/ingest", token: "test",
    authorizePublication: () => { throw new Error("review file unavailable"); },
    fetchImpl: async () => { calls += 1; return new Response(); },
  });
  await assert.rejects(publisher.publish(patch("PDSB")), /owner approval/);
  assert.equal(calls, 0);
});
