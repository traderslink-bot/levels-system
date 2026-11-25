import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { PendingLevelsFetch, type CapturedLevelsRequest, type LevelsBrokerReply } from "../runtime/stock-levels-pending-fetch.js";
import { createPendingLevelsRuntimeFixture, pendingLevelsDummyReply } from "./fixtures/pending-levels-runtime.js";

const base = "https://capture.invalid/private/";
const history = (frame: "1Day" | "4Hour") => new URL(`history?symbol=SYN&timeframe=${frame}&start=1000&end=2000&acceptedEvidence=1`, base);
const reply = (request: CapturedLevelsRequest, body = '{ "fixture": true }\n'): LevelsBrokerReply => ({
  operationId: request.operationId, requestId: request.requestId, status: 200, body,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function pair(bridge: PendingLevelsFetch) {
  const daily = bridge.fetcher(history("1Day"), { signal: new AbortController().signal,
    headers: { authorization: "Bearer sensitive-fixture-header" } });
  const fourHour = bridge.fetcher(history("4Hour"), { signal: new AbortController().signal });
  const captures = bridge.pendingHistory();
  assert.ok(captures);
  return { daily, fourHour, captures };
}

test("captures exact request bytes and waits for an atomic history pair without retaining headers or bodies", async () => {
  const bridge = new PendingLevelsFetch({ gatewayBaseUrl: base, symbol: "SYN" });
  const before = Date.now();
  const operation = pair(bridge);
  let resolved = false;
  void operation.daily.then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false);
  const [daily, fourHour] = operation.captures;
  assert.equal(daily.startMs, 1000); assert.equal(daily.endMs, 2000);
  assert.equal(daily.pathname, "/private/history");
  assert.equal(daily.search, history("1Day").search);
  assert.ok(daily.capturedAtMs >= before);
  assert.ok(Object.isFrozen(daily));
  const raw = new TextEncoder().encode('{ "fixture": "original" }\n');
  bridge.resolveHistory({ daily: { ...reply(daily), body: raw }, fourHour: reply(fourHour) });
  raw.fill(0);
  assert.equal(await (await operation.daily).text(), '{ "fixture": "original" }\n');
  assert.equal(await (await operation.fourHour).text(), '{ "fixture": true }\n');
  assert.equal(bridge.snapshot().state, "transport_complete");
  const metadata = JSON.stringify(bridge.snapshot());
  assert.ok(!metadata.includes("sensitive-fixture-header") && !metadata.includes('"original"'));
  assert.match(bridge.snapshot().requests[0]!.transportBodySha256!, /^[a-f0-9]{64}$/u);
});

test("original abort reason cancels both pending frames and late replies cannot reopen the operation", async () => {
  const bridge = new PendingLevelsFetch({ gatewayBaseUrl: base, symbol: "SYN" });
  const controller = new AbortController();
  const daily = bridge.fetcher(history("1Day"), { signal: controller.signal }).catch((error: unknown) => error);
  const fourHour = bridge.fetcher(history("4Hour"), { signal: new AbortController().signal }).catch((error: unknown) => error);
  const captures = bridge.pendingHistory()!;
  const reason = new DOMException("Original fixture deadline", "TimeoutError");
  controller.abort(reason);
  assert.equal(await daily, reason); assert.equal(await fourHour, reason);
  assert.equal(bridge.snapshot().state, "cancelled");
  assert.ok(bridge.snapshot().requests.every((entry) => entry.state === "cancelled"));
  assert.throws(() => bridge.resolveHistory({ daily: reply(captures[0]), fourHour: reply(captures[1]) }));
  await assert.rejects(bridge.fetcher(history("1Day"), { signal: new AbortController().signal }), /terminal/);
});

test("invalid second broker response cannot release the valid first response", async () => {
  const bridge = new PendingLevelsFetch({ gatewayBaseUrl: base, symbol: "SYN", maxResponseBytes: 64 });
  const operation = pair(bridge);
  const settled = Promise.allSettled([operation.daily, operation.fourHour]);
  assert.throws(() => bridge.resolveHistory({ daily: reply(operation.captures[0]),
    fourHour: reply(operation.captures[1], "x".repeat(65)) }), /budget/);
  assert.deepEqual((await settled).map((entry) => entry.status), ["rejected", "rejected"]);
  assert.ok(bridge.snapshot().requests.every((entry) => entry.state === "cancelled" && !entry.transportBodySha256));
});

test("wrong correlation identity refuses the pair without a partial result", async () => {
  const bridge = new PendingLevelsFetch({ gatewayBaseUrl: base, symbol: "SYN" });
  const operation = pair(bridge), settled = Promise.allSettled([operation.daily, operation.fourHour]);
  assert.throws(() => bridge.resolveHistory({ daily: reply(operation.captures[0]),
    fourHour: { ...reply(operation.captures[1]), operationId: "another-operation" } }), /mismatch/);
  assert.ok((await settled).every((entry) => entry.status === "rejected"));
});

test("unknown origins, queries, missing cancellation and duplicate frames never fall back to network", async () => {
  for (const [url, init] of [
    [new URL("https://other.invalid/history"), { signal: new AbortController().signal }],
    [new URL(history("1Day") + "&token=private-value"), { signal: new AbortController().signal }],
    [history("1Day"), {}],
  ] as const) {
    const bridge = new PendingLevelsFetch({ gatewayBaseUrl: base, symbol: "SYN" });
    await assert.rejects(bridge.fetcher(url, init));
    assert.equal(bridge.snapshot().state, "refused");
    assert.equal(bridge.snapshot().requests.length, 0);
  }
  const duplicate = new PendingLevelsFetch({ gatewayBaseUrl: base, symbol: "SYN" });
  const first = duplicate.fetcher(history("1Day"), { signal: new AbortController().signal }).catch((error: unknown) => error);
  await assert.rejects(duplicate.fetcher(history("1Day"), { signal: new AbortController().signal }), /duplicate/);
  assert.ok(await first instanceof Error);
});

function install(t: TestContext, fixture: ReturnType<typeof createPendingLevelsRuntimeFixture>) {
  const prior = { ...process.env }, fetcher = globalThis.fetch;
  for (const [key, value] of Object.entries(fixture.environment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  globalThis.fetch = fixture.fetcher;
  t.after(() => { fixture.cancel(); process.env = prior; globalThis.fetch = fetcher; });
}
function requestFixture(fixture: ReturnType<typeof createPendingLevelsRuntimeFixture>, signal?: AbortSignal) {
  return fixture.fetcher(new URL("api/runtime/stock-levels", fixture.environment.TRADERLINK_STOCK_LEVELS_RUNTIME_URL), {
    method: "POST", headers: { authorization: "Bearer fixture-runtime-only", "content-type": "application/json" },
    body: JSON.stringify({ symbol: "SYN" }), signal,
  });
}

for (const wire of [false, true]) {
  test(`actual Runtime calculation captures its default exact source bounds and resumes once (${wire ? "wire" : "legacy"})`, async (t) => {
    const ready = deferred<readonly [CapturedLevelsRequest, CapturedLevelsRequest]>();
    const fixture = createPendingLevelsRuntimeFixture({ wire, onCapture: (captured) => {
      if (captured.kind === "quote") fixture.bridge.resolveQuote(pendingLevelsDummyReply(captured));
      else { const capturedPair = fixture.bridge.pendingHistory(); if (capturedPair) ready.resolve(capturedPair); }
    } });
    install(t, fixture);
    const before = Date.now();
    const pending = requestFixture(fixture);
    const [daily, fourHour] = await ready.promise;
    assert.equal(daily.endMs! - daily.startMs!, 56_160_000_000);
    assert.equal(fourHour.endMs! - fourHour.startMs!, 3_628_800_000);
    assert.ok(daily.endMs! >= before && fourHour.endMs! >= before);
    assert.ok(daily.endMs! <= daily.capturedAtMs && fourHour.endMs! <= fourHour.capturedAtMs);
    assert.equal(fixture.snapshot().successfulReplies, 0);
    assert.equal(fixture.runtimeReplyBody(), undefined);
    fixture.bridge.resolveHistory({ daily: pendingLevelsDummyReply(daily), fourHour: pendingLevelsDummyReply(fourHour) });
    const response = await pending;
    assert.equal(response.status, 200);
    const result = await response.json() as { map: { symbol: string; chartEvidenceProvenance?: unknown } };
    assert.equal(result.map.symbol, "SYN");
    assert.equal(result.map.chartEvidenceProvenance, undefined);
    assert.deepEqual(JSON.parse(fixture.runtimeReplyBody()!), result);
    assert.equal(fixture.snapshot().runtimeRequests, 1);
    assert.equal(fixture.snapshot().successfulReplies, 1);
    assert.equal(fixture.snapshot().transport.requests.length, 3);
    assert.equal(fixture.snapshot().transport.state, "transport_complete");
    assert.ok(fixture.snapshot().runtimeReplyAtMs! >= Math.max(daily.capturedAtMs, fourHour.capturedAtMs));
    assert.equal((await requestFixture(fixture)).status, 409);
  });
}

for (const refusal of [false, true]) {
  test(`pending Runtime ${refusal ? "broker refusal" : "caller cancellation"} produces no map or retry`, async (t) => {
    const ready = deferred<void>();
    const fixture = createPendingLevelsRuntimeFixture({ onCapture: (captured) => {
      if (captured.kind === "quote") fixture.bridge.resolveQuote(pendingLevelsDummyReply(captured));
      else if (fixture.bridge.pendingHistory()) ready.resolve();
    } });
    install(t, fixture);
    const abort = new AbortController();
    const pending = requestFixture(fixture, abort.signal);
    await ready.promise;
    if (refusal) fixture.bridge.refuse(); else abort.abort();
    const response = await pending;
    assert.equal(response.status, 422);
    assert.equal((await response.json() as { map?: unknown }).map, undefined);
    assert.equal(fixture.snapshot().runtimeRequests, 1);
    assert.equal(fixture.snapshot().successfulReplies, 0);
    assert.equal(fixture.snapshot().transport.requests.length, 3);
    assert.ok(fixture.snapshot().transport.requests.filter((entry) => entry.kind !== "quote").every((entry) => entry.state === "cancelled"));
  });
}
