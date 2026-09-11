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

test("validation decisions survive restart and edits without permitting original provenance replacement", () => {
  const { directory, store } = setup();
  store.begin("decisions", "PDSB", true, "owner");
  const validationDecisions = [{ stage: "optional_sections", issues: [{ path: "pullbackPlans.shallow", action: "omit_section" }] }];
  const originalInput = { cycleId: "decisions", expectedHead: 1, actor: "generator", generationId: "g1", payload, validationDecisions };
  const original = store.saveDraft(originalInput);
  assert.equal(store.saveDraft(originalInput).hash, original.hash);
  assert.throws(() => store.saveDraft({ ...originalInput, validationDecisions: [] }), /different validation decisions/);
  store.saveDraft({ cycleId: "decisions", expectedHead: 2, actor: "owner", payload: { ...payload, price: 0.45 } });
  const restored = new TradersLinkAiReadReviewStore(directory).read("decisions")!;
  assert.deepEqual((restored.events[1]!.body as any).validationDecisions, validationDecisions);
  assert.equal((restored.draft!.body as any).validationDecisions, undefined);
  assert.equal(restored.events[1]!.hash, original.hash);
});

test("history pages every cycle once without mixing ticker identities", () => {
  const { store } = setup();
  for (let index = 0; index < 203; index++) store.begin("history-" + index, index % 2 ? "TNON" : "PDSB", true, "owner");
  const first = store.listCycles("pdsb");
  assert.match(first.nextCursor!, /^[a-f0-9]{64}$/);
  const second = store.listCycles("PDSB", first.nextCursor!);
  assert.equal(second.nextCursor, null);
  const cycles = [...first.cycles, ...second.cycles];
  assert.equal(cycles.length, 102);
  assert.equal(new Set(cycles.map(cycle => cycle.cycleId)).size, 102);
  assert.ok(cycles.every(cycle => cycle.symbol === "PDSB" && cycle.startedAt === 123));
  assert.deepEqual(store.listCycles("AEON").cycles, []);
  assert.throws(() => store.listCycles("PDSB", "bad-cursor"), /Invalid review history/);
});

test("history does not silently skip corrupted origin metadata", () => {
  const { store, directory } = setup();
  store.begin("history", "PDSB", true, "owner");
  const cycleDirectory = readdirSync(directory)[0]!;
  writeFileSync(join(directory, cycleDirectory, "00000001.json"), JSON.stringify({ version: 1, body: { kind: "begin", symbol: "PDSB" } }));
  assert.throws(() => store.listCycles("PDSB"), /integrity/);
});

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
  const history = store.listCycles("pdsb");
  assert.deepEqual(history.cycles.map(cycle => cycle.cycleId).sort(), ["new", "old"]);
  assert.equal(history.nextCursor, null);
  assert.deepEqual(store.listCycles("FTFT").cycles, []);
  assert.equal(store.read("old")?.head, 3);
  assert.throws(() => store.listCycles("PDSB", "../invalid"), /Invalid review history/);
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

test("durable delivery claims do not resend uncertain or acknowledged attempts after restart", () => {
  const { store, directory } = setup();
  store.begin("cycle", "PDSB", true, "owner");
  store.saveDraft({ cycleId: "cycle", expectedHead: 1, actor: "generator", generationId: "g", payload });
  store.approve("cycle", 2, 2, "owner");
  const first = store.claimDelivery("cycle", 3, 3, "website");
  assert.equal(first.shouldSend, true);
  const restored = new TradersLinkAiReadReviewStore(directory);
  const uncertain = restored.claimDelivery("cycle", 3, 3, "website");
  assert.equal(uncertain.shouldSend, false);
  assert.equal(uncertain.reason, "uncertain");
  assert.equal(uncertain.deliveryKey, first.deliveryKey);
  restored.recordDelivery("cycle", 4, 3, "website", "acknowledged", "receipt");
  assert.equal(restored.claimDelivery("cycle", 3, 3, "website").reason, "acknowledged");
  const discord = restored.claimDelivery("cycle", 5, 3, "discord");
  assert.equal(discord.shouldSend, true);
  assert.notEqual(discord.deliveryKey, first.deliveryKey);
  restored.recordDelivery("cycle", 6, 3, "discord", "failed", null);
  assert.equal(restored.claimDelivery("cycle", 7, 3, "discord").deliveryKey, discord.deliveryKey);
});

test("pins exact preview and resumes multipart delivery only after each receipt", () => {
  const { store, directory } = setup();
  store.begin("cycle", "PDSB", true, "owner");
  store.saveDraft({ cycleId: "cycle", expectedHead: 1, actor: "generator", generationId: "g", payload });
  const publication = { website: { symbol: "PDSB", body: "exact snapshot" }, discordChunks: ["first", "second"] };
  store.approve("cycle", 2, 2, "owner", publication);
  assert.throws(() => store.approve("cycle", 3, 2, "owner", { ...publication, discordChunks: ["changed"] }), /cannot change/);
  assert.throws(() => store.claimDiscordChunk("cycle", 3, 3, 1), /Previous/);
  const first = store.claimDiscordChunk("cycle", 3, 3, 0);
  assert.equal(first.content, "first");
  const restored = new TradersLinkAiReadReviewStore(directory);
  assert.equal(restored.claimDiscordChunk("cycle", 4, 3, 0).reason, "uncertain");
  const receipt = { messageId: "12345678901234567", channelId: "23456789012345678" };
  restored.acknowledgeDiscordChunk("cycle", 4, 3, 0, receipt);
  assert.equal(restored.claimDiscordChunk("cycle", 5, 3, 0).reason, "acknowledged");
  assert.throws(() => restored.acknowledgeDiscordChunk("cycle", 5, 3, 0, { ...receipt, messageId: "34567890123456789" }), /conflicts/);
  const second = restored.claimDiscordChunk("cycle", 5, 3, 1);
  assert.equal(second.shouldSend, true);
  assert.equal(second.content, "second");
  assert.notEqual(second.deliveryKey, first.deliveryKey);
  restored.cancel("cycle", 6, "owner");
  assert.throws(() => restored.claimDiscordChunk("cycle", 7, 3, 1), /changed/);
  restored.acknowledgeDiscordChunk("cycle", 7, 3, 1, { ...receipt, messageId: "34567890123456789" });
  assert.equal(restored.read("cycle")?.cancelled, true);
  assert.equal(restored.read("cycle")?.head, 8);
});

test("only confirmed rejections unlock a chunk retry with the same delivery identity", () => {
  const { store, directory } = setup();
  store.begin("cycle", "PDSB", true, "owner");
  store.saveDraft({ cycleId: "cycle", expectedHead: 1, actor: "generator", generationId: "g", payload });
  store.approve("cycle", 2, 2, "owner", { website: {}, discordChunks: ["approved"] });
  const first = store.claimDiscordChunk("cycle", 3, 3, 0);
  for (const status of [408, 500, 502, 0]) assert.throws(() => store.rejectDiscordChunk("cycle", 4, 3, 0, status), /not a confirmed/);
  assert.equal(store.claimDiscordChunk("cycle", 4, 3, 0).reason, "uncertain");
  store.rejectDiscordChunk("cycle", 4, 3, 0, 403);
  const restarted = new TradersLinkAiReadReviewStore(directory);
  const retry = restarted.claimDiscordChunk("cycle", 5, 3, 0);
  assert.equal(retry.shouldSend, true);
  assert.equal(retry.deliveryKey, first.deliveryKey);
  assert.equal(retry.content, "approved");
  restarted.acknowledgeDiscordChunk("cycle", 6, 3, 0, { messageId: "12345678901234567", channelId: "23456789012345678" });
  assert.throws(() => restarted.rejectDiscordChunk("cycle", 7, 3, 0, 403), /not awaiting/);
});
