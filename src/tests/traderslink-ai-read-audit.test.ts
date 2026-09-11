import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TradersLinkAiReadAuditStore, type AiReadAuditEvent } from "../lib/ai/traderslink-ai-read-audit.js";

function withStore(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "tl-ai-audit-test-"));
  try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}
function event(id: string, phase: AiReadAuditEvent["phase"] = "request"): AiReadAuditEvent {
  return { generationId: id, requestId: `${id}-request-1`, symbol: "TEST", phase, at: Date.now(), payload: { price: 3.93 } };
}

test("audit preserves full staged input/response and survives a new reader", () => withStore((directory) => {
  const store = new TradersLinkAiReadAuditStore({ directory });
  const request = event("generation-1");
  const response = { ...event("generation-1", "response"), payload: { text: "a".repeat(6000) } };
  assert.deepEqual(store.save(request), { saved: true });
  assert.deepEqual(store.save(response), { saved: true });
  assert.deepEqual(new TradersLinkAiReadAuditStore({ directory }).read("generation-1")?.events, [request, response]);
}));

test("audit hashes external identifiers rather than using them as paths", () => withStore((directory) => {
  const store = new TradersLinkAiReadAuditStore({ directory });
  const record = event("../../escape");
  assert.equal(store.save(record).saved, true);
  assert.ok(readdirSync(directory).every((name) => /^[a-f0-9]{64}\.json$/.test(name)));
  assert.deepEqual(store.read(record.generationId)?.events, [record]);
  assert.equal(store.read("absent"), null);
}));

test("oversize capture is explicit and preserves earlier input", () => withStore((directory) => {
  const store = new TradersLinkAiReadAuditStore({ directory, maxArtifactBytes: 500 });
  assert.equal(store.save(event("a")).saved, true);
  assert.deepEqual(store.save({ ...event("a", "response"), payload: "x".repeat(600) }), { saved: false, reason: "oversize" });
  assert.equal(store.read("a")?.events.length, 1);
}));

test("capacity cannot evict unfinished captures or unrelated owner records", () => withStore((directory) => {
  const store = new TradersLinkAiReadAuditStore({ directory, maxTotalBytes: 220 });
  writeFileSync(join(directory, "owner-revisions.json"), "preserve");
  assert.equal(store.save(event("a")).saved, true);
  assert.deepEqual(store.save(event("b")), { saved: false, reason: "capacity" });
  assert.equal(readFileSync(join(directory, "owner-revisions.json"), "utf8"), "preserve");
  assert.equal(store.read("a")?.events.length, 1);
}));

test("old completed diagnostic captures may expire but unfinished ones remain", () => withStore((directory) => {
  const store = new TradersLinkAiReadAuditStore({ directory, retentionMs: 1 });
  store.save({ ...event("complete", "validation"), payload: { valid: false, error: "Rejected core" } });
  store.save(event("unfinished"));
  assert.equal(store.save({ ...event("new"), at: Date.now() + 1000 }).saved, true);
  assert.equal(store.read("complete"), null);
  assert.ok(store.read("unfinished"));
}));

test("intermediate section checks and successful validation cannot mark a request complete", () => withStore((directory) => {
  const store = new TradersLinkAiReadAuditStore({ directory, retentionMs: 1 });
  for (const [id, payload] of [
    ["sections", { stage: "optional_sections", issues: [] }],
    ["validated", { valid: true, normalized: {} }],
    ["attempt", { stage: "api_attempt", status: "success" }],
  ] as const) {
    assert.equal(store.save({ ...event(id, "validation"), payload }).saved, true);
  }
  assert.equal(readdirSync(directory).filter(name => name.endsWith(".complete")).length, 0);
  assert.equal(store.save({ ...event("later"), at: Date.now() + 1000 }).saved, true);
  for (const id of ["sections", "validated", "attempt"]) assert.ok(store.read(id));
  assert.equal(store.save(event("validated", "prepared_payload")).saved, true);
  assert.equal(store.save(event("transport", "transport_error")).saved, true);
  assert.equal(store.save({ ...event("final"), at: Date.now() + 2000 }).saved, true);
  assert.equal(store.read("validated"), null);
  assert.equal(store.read("transport"), null);
  assert.ok(store.read("sections"));
  assert.ok(store.read("attempt"));
}));

test("a corrupt existing audit fails visibly without overwriting it", () => withStore((directory) => {
  const store = new TradersLinkAiReadAuditStore({ directory });
  store.save(event("a"));
  const path = join(directory, readdirSync(directory)[0]!);
  writeFileSync(path, "broken");
  assert.deepEqual(store.save(event("a", "response")), { saved: false, reason: "storage_error" });
  assert.equal(readFileSync(path, "utf8"), "broken");
}));

test("retention recovers a missing completion marker from terminal events", () => withStore((directory) => {
  const store = new TradersLinkAiReadAuditStore({ directory, retentionMs: 1 });
  assert.equal(store.save(event("complete", "prepared_payload")).saved, true);
  const marker = readdirSync(directory).find(name => name.endsWith(".complete"))!;
  unlinkSync(join(directory, marker));
  const restarted = new TradersLinkAiReadAuditStore({ directory, retentionMs: 1 });
  assert.equal(restarted.save({ ...event("next"), at: Date.now() + 1000 }).saved, true);
  assert.equal(restarted.read("complete"), null);
}));

test("stale marker cannot evict a capture resumed after its terminal event", () => withStore((directory) => {
  const store = new TradersLinkAiReadAuditStore({ directory, retentionMs: 1 });
  assert.equal(store.save(event("resumed", "prepared_payload")).saved, true);
  assert.equal(store.save(event("resumed", "request")).saved, true);
  assert.equal(store.save({ ...event("next"), at: Date.now() + 1000 }).saved, true);
  assert.equal(store.read("resumed")?.events.length, 2);
}));

test("capacity can reclaim a terminal capture whose marker was lost without touching owner history", () => withStore((directory) => {
  const store = new TradersLinkAiReadAuditStore({ directory, maxTotalBytes: 300 });
  writeFileSync(join(directory, "owner-revisions.json"), "preserve");
  assert.equal(store.save(event("done", "prepared_payload")).saved, true);
  unlinkSync(join(directory, readdirSync(directory).find(name => name.endsWith(".complete"))!));
  assert.equal(store.save({ ...event("next"), payload: "x".repeat(100) }).saved, true);
  assert.equal(store.read("done"), null);
  assert.equal(store.read("next")?.events.length, 1);
  assert.equal(readFileSync(join(directory, "owner-revisions.json"), "utf8"), "preserve");
}));
