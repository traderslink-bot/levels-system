import assert from "node:assert/strict";
import test from "node:test";
import { DiscordAlertRouter } from "../lib/alerts/alert-router.js";

test("pending review blocks every Discord router publication path before gateway access", async () => {
  let calls = 0;
  const gateway = new Proxy({}, { get: () => async () => { calls += 1; } });
  const router = new DiscordAlertRouter(gateway as any);
  router.setPublicationAuthorizer(() => false);
  await assert.rejects(router.ensureThread("PDSB"), /owner approval/);
  await assert.rejects(router.announceTickerAdded("PDSB"), /owner approval/);
  await assert.rejects(router.routeAlert("thread", { symbol: "PDSB" } as any), /owner approval/);
  await assert.rejects(router.routeLevelSnapshot("thread", { symbol: "PDSB" } as any), /owner approval/);
  await assert.rejects(router.routeLevelExtension("thread", { symbol: "PDSB" } as any), /owner approval/);
  assert.equal(calls, 0);
});

test("lookup failures hold Discord and approval permits the existing route", async () => {
  const sent: string[] = [];
  const router = new DiscordAlertRouter({
    announceTickerAdded: async (symbol: string) => { sent.push(symbol); },
    sendMessage: async (_thread: string, payload: any) => { sent.push(payload.symbol); },
  } as any);
  router.setPublicationAuthorizer(() => { throw new Error("unavailable"); });
  await assert.rejects(router.announceTickerAdded("PDSB"), /owner approval/);
  router.setPublicationAuthorizer((symbol) => symbol === "PDSB");
  await router.announceTickerAdded("pdsb");
  await router.routeAlert("thread", { symbol: "PDSB" } as any);
  assert.deepEqual(sent, ["PDSB", "PDSB"]);
  await assert.rejects(router.announceTickerAdded("FTFT"), /owner approval/);
});

test("approval is rechecked before creating a thread after awaited lookup", async () => {
  let allowed = true;
  let creations = 0;
  const router = new DiscordAlertRouter({
    findThreadByName: async () => { allowed = false; return null; },
    createThread: async () => { creations += 1; return { id: "thread", name: "PDSB" }; },
  } as any);
  router.setPublicationAuthorizer(() => allowed);
  await assert.rejects(router.ensureThread("PDSB"), /owner approval/);
  assert.equal(creations, 0);
});
