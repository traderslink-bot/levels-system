import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { TradersLinkAiReadReviewStore } from "../lib/ai/traderslink-ai-read-review-store.js";

const directories: string[] = [];
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "ai-review-"));
  directories.push(directory);
  return { directory, store: new TradersLinkAiReadReviewStore(directory, () => 123) };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const payload = { symbol: "PDSB", currentRead: "Original analysis", price: 0.5 };

test("preserves original, owner edit and exact approved revision through restart", () => {
  const { directory, store } = setup();
  store.begin("cycle", "PDSB", true, "owner");
  store.saveDraft({ cycleId: "cycle", expectedHead: 1, actor: "generator", generationId: "generation-1", payload });
  store.saveDraft({ cycleId: "cycle", expectedHead: 2, actor: "owner", payload: { ...payload, price: 0.45 } });
  const approval = store.approve("cycle", 3, 3, "owner");
  const restored = new TradersLinkAiReadReviewStore(directory).read("cycle")!;
  assert.equal(restored.reviewRequired, true);
  assert.equal(restored.events[1]?.body.kind, "original");
  assert.equal((restored.events[1]?.body as any).payload.price, 0.5);
  assert.equal((restored.draft?.body as any).payload.price, 0.45);
  assert.equal(restored.approved?.hash, approval.hash);
  assert.equal(store.approve("cycle", 3, 3, "owner").revision, 4);
  assert.equal(store.read("cycle")?.head, 4);
  const retry = store.saveDraft({ cycleId: "cycle", expectedHead: 1, actor: "generator", generationId: "generation-1", payload });
  assert.equal(retry.revision, 2);
  assert.equal(store.read("cycle")?.draft?.revision, 3);
  assert.throws(() => store.saveDraft({ cycleId: "cycle", expectedHead: 4, actor: "generator", generationId: "generation-1", payload: { ...payload, price: 2 } }), /different original/);
});

test("stale saves and approvals cannot replace a newer draft", () => {
  const { store } = setup();
  store.begin("cycle", "PDSB", true, "owner");
  store.saveDraft({ cycleId: "cycle", expectedHead: 1, actor: "generator", generationId: "g", payload });
  store.saveDraft({ cycleId: "cycle", expectedHead: 2, actor: "owner", payload: { ...payload, price: 0.46 } });
  assert.throws(() => store.approve("cycle", 2, 2, "owner"), /Draft changed/);
  assert.throws(() => store.saveDraft({ cycleId: "cycle", expectedHead: 2, actor: "owner", payload }), /Review changed/);
  assert.equal(store.read("cycle")?.head, 3);
});

test("new generated draft retains previously approved publication and separate generation provenance", () => {
  const { store } = setup();
  store.begin("cycle", "PDSB", true, "owner");
  store.saveDraft({ cycleId: "cycle", expectedHead: 1, actor: "generator", generationId: "g1", payload });
  store.approve("cycle", 2, 2, "owner");
  store.saveDraft({ cycleId: "cycle", expectedHead: 3, actor: "generator", generationId: "g2", payload: { ...payload, price: 0.6 } });
  assert.equal(store.read("cycle")?.approved?.revision, 3);
  assert.equal(store.read("cycle")?.draft?.revision, 4);
});

test("website acknowledgement cannot masquerade as Discord delivery", () => {
  const { store } = setup();
  store.begin("cycle", "PDSB", true, "owner");
  store.saveDraft({ cycleId: "cycle", expectedHead: 1, actor: "generator", generationId: "g", payload });
  store.approve("cycle", 2, 2, "owner");
  store.recordDelivery("cycle", 3, 3, "website", "started", null);
  store.recordDelivery("cycle", 4, 3, "website", "acknowledged", "web1");
  assert.equal(store.recordDelivery("cycle", 3, 3, "website", "started", null).revision, 5);
  store.recordDelivery("cycle", 5, 3, "discord", "failed", null);
  assert.equal(store.read("cycle")?.head, 6);
});

test("cancelled activation cycle cannot be approved or reused for a re-add", () => {
  const { store } = setup();
  store.begin("old", "PDSB", true, "owner");
  store.saveDraft({ cycleId: "old", expectedHead: 1, actor: "generator", generationId: "g", payload });
  store.cancel("old", 2, "owner");
  assert.throws(() => store.approve("old", 3, 2, "owner"), /Draft changed/);
  store.begin("new", "PDSB", false, "owner");
  assert.equal(store.read("new")?.reviewRequired, false);
  assert.equal(store.read("old")?.reviewRequired, true);
});

test("corrupt durable history fails closed without overwriting it", () => {
  const { store, directory } = setup();
  store.begin("cycle", "PDSB", true, "owner");
  const cycleDirectory = join(directory, readdirSync(directory)[0]!);
  writeFileSync(join(cycleDirectory, "00000001.json"), "broken");
  assert.throws(() => store.read("cycle"));
  assert.throws(() => store.begin("cycle", "PDSB", true, "owner"));
});

test("rejects mismatched ticker and non-finite owner values without changing history", () => {
  const { store } = setup();
  store.begin("cycle", "PDSB", true, "owner");
  assert.throws(() => store.saveDraft({ cycleId: "cycle", expectedHead: 1, actor: "generator", generationId: "g", payload: { ...payload, symbol: "FTFT" } }), /ticker mismatch/);
  assert.throws(() => store.saveDraft({ cycleId: "cycle", expectedHead: 1, actor: "generator", generationId: "g", payload: { ...payload, price: Infinity } }), /Non-finite/);
  assert.equal(store.read("cycle")?.head, 1);
});
