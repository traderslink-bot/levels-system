import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { decodeGatewayWire, encodeGatewayWire, gatewayWireUrl } from "../lib/market-data/traderslink-gateway-wire.js";
import { SCANNER_LEVELS_DAILY_DATASET, SCANNER_LEVELS_EVIDENCE_PROFILE, SCANNER_LEVELS_REGULAR_DATASET } from "../lib/market-data/stock-levels-evidence-profile.js";
import { PendingLevelsFetch, type CapturedLevelsRequest, type LevelsBrokerReply } from "../runtime/stock-levels-pending-fetch.js";
import { createPendingLevelsRuntimeFixture, pendingLevelsDummyReply } from "./fixtures/pending-levels-runtime.js";
import type { StockLevelsRuntimeResponse } from "../runtime/stock-levels-generator.js";
import { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";

// Synthetic transport/admission mechanics only. These are not real accepted receipts.
type History = {
  bars: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
  acceptedInput?: Record<string, unknown>;
};
const ids = { daily: "11234567-89ab-4cde-8f01-23456789abcd", "4h": "01234567-89ab-4cde-8f01-23456789abcd" };
function qualifiedDummy(request: CapturedLevelsRequest, change?: (body: History) => void): LevelsBrokerReply {
  const dummy = pendingLevelsDummyReply(request);
  const body = (request.wire ? decodeGatewayWire("history", JSON.parse(dummy.body as string)) : JSON.parse(dummy.body as string)) as History;
  if (request.kind === "daily") {
    // Distinct chart structures exercise actual 4H-only final lineage rather than only mixed zones.
    body.bars = body.bars.map((row) => ({ ...row, open: row.open + 3, high: row.high + 3, low: row.low + 3, close: row.close + 3 }));
  }
  const acceptedAtMs = Date.now();
  body.acceptedInput = {
    id: ids[request.kind as "daily" | "4h"], digest: "d".repeat(64),
    instrumentId: "synthetic-listing", symbol: request.symbol, venue: "XNAS",
    frame: request.kind, datasetId: request.kind === "daily" ? SCANNER_LEVELS_DAILY_DATASET : SCANNER_LEVELS_REGULAR_DATASET,
    priceBasisId: "synthetic-common-basis", calendarRevision: "synthetic-calendar",
    sessionMode: request.kind === "daily" ? "extended" : "regular",
    completedThroughMs: body.bars.at(-1)!.time * 1000 + (request.kind === "daily" ? 86_400_000 : 14_400_000),
    acceptedCutoffMs: request.endMs, availableAtMs: acceptedAtMs, acceptedAtMs,
  };
  change?.(body);
  return { ...dummy, body: JSON.stringify(request.wire ? encodeGatewayWire("history", body) : body) };
}
function install(t: TestContext, fixture: ReturnType<typeof createPendingLevelsRuntimeFixture>) {
  const prior = { ...process.env }, originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(fixture.environment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  globalThis.fetch = fixture.fetcher;
  t.after(() => { fixture.cancel(); process.env = prior; globalThis.fetch = originalFetch; });
}
function makeFixture(wire = false) {
  let resolve!: (pair: readonly [CapturedLevelsRequest, CapturedLevelsRequest]) => void;
  const ready = new Promise<readonly [CapturedLevelsRequest, CapturedLevelsRequest]>((done) => { resolve = done; });
  const fixture = createPendingLevelsRuntimeFixture({ wire, profile: SCANNER_LEVELS_EVIDENCE_PROFILE, onCapture: (capture) => {
    if (capture.kind === "quote") fixture.bridge.resolveQuote(pendingLevelsDummyReply(capture));
    else { const pair = fixture.bridge.pendingHistory(); if (pair) resolve(pair); }
  } });
  return { fixture, ready };
}
function generate(fixture: ReturnType<typeof createPendingLevelsRuntimeFixture>, signal?: AbortSignal) {
  return fixture.fetcher(new URL("api/runtime/stock-levels", fixture.environment.TRADERLINK_STOCK_LEVELS_RUNTIME_URL), {
    method: "POST", headers: { authorization: "Bearer fixture-runtime-only", "content-type": "application/json" },
    body: JSON.stringify({ symbol: "SYN", profile: SCANNER_LEVELS_EVIDENCE_PROFILE }), signal,
  });
}

for (const wire of [false, true]) {
  test(`explicit profile uses unchanged Daily and selected regular 4H, one actual calculation (${wire ? "wire" : "legacy"})`, async (t) => {
    const { fixture, ready } = makeFixture(wire);
    install(t, fixture);
    const pending = generate(fixture);
    const [daily, fourHour] = await ready;
    assert.equal(daily.sessionMode, undefined);
    assert.equal(fourHour.sessionMode, "regular");
    assert.equal(daily.endMs! - daily.startMs!, 56_160_000_000);
    assert.equal(fourHour.endMs! - fourHour.startMs!, 3_628_800_000);
    assert.equal(fixture.snapshot().successfulReplies, 0);
    fixture.bridge.resolveHistory({ daily: qualifiedDummy(daily), fourHour: qualifiedDummy(fourHour) });
    const response = await pending;
    const result = await response.json() as StockLevelsRuntimeResponse;
    assert.equal(response.status, 200);
    const proof = result.map?.chartEvidenceProvenance;
    assert.ok(proof);
    assert.deepEqual(proof.inputs.map((input) => [input.frame, input.datasetId, input.sessionMode]), [
      ["daily", SCANNER_LEVELS_DAILY_DATASET, "extended"], ["4h", SCANNER_LEVELS_REGULAR_DATASET, "regular"],
    ]);
    assert.ok(proof.zones.some((zone) => zone.inputIds.length === 1 && zone.inputIds[0] === ids["4h"]));
    assert.ok(proof.calculatedAtMs >= Math.max(...proof.inputs.map((input) => input.acceptedAtMs)));
    assert.ok(result.map);
    assert.equal(result.map.cacheStatus, "fresh");
    assert.equal(fixture.snapshot().runtimeRequests, 1);
    assert.equal(fixture.snapshot().successfulReplies, 1);
    assert.equal(fixture.snapshot().transport.requests.length, 3);
  });
}

const rejected: Array<[string, "daily" | "4h", (body: History) => void]> = [
  ["missing Daily receipt", "daily", (body) => { delete body.acceptedInput; }],
  ["missing 4H receipt", "4h", (body) => { delete body.acceptedInput; }],
  ["native 4H dataset", "4h", (body) => { body.acceptedInput!.datasetId = "alpaca-sip:native-4h:v1"; }],
  ["extended 4H receipt", "4h", (body) => { body.acceptedInput!.sessionMode = "extended"; }],
  ["wrong Daily dataset", "daily", (body) => { body.acceptedInput!.datasetId = "other-day"; }],
  ["mislabelled regular Daily", "daily", (body) => { body.acceptedInput!.sessionMode = "regular"; }],
  ["different calendar", "daily", (body) => { body.acceptedInput!.calendarRevision = "other-calendar"; }],
  ["different basis", "daily", (body) => { body.acceptedInput!.priceBasisId = "other-basis"; }],
  ["different listing", "daily", (body) => { body.acceptedInput!.instrumentId = "other-listing"; }],
  ["normalization change", "daily", (body) => { body.bars.push(body.bars.at(-1)!); }],
  ["future acceptance", "daily", (body) => { body.acceptedInput!.acceptedAtMs = Date.now() + 60_000; }],
];
for (const [name, frame, change] of rejected) {
  test(`evidence profile refuses ${name} without a map or fallback`, async (t) => {
    const { fixture, ready } = makeFixture();
    install(t, fixture);
    const pending = generate(fixture);
    const [daily, fourHour] = await ready;
    fixture.bridge.resolveHistory({ daily: qualifiedDummy(daily, frame === "daily" ? change : undefined),
      fourHour: qualifiedDummy(fourHour, frame === "4h" ? change : undefined) });
    const response = await pending;
    const result = await response.json() as StockLevelsRuntimeResponse;
    assert.equal(response.status, 422);
    assert.equal(result.map, undefined);
    assert.equal(result.code, "market_data_unavailable");
    assert.equal(fixture.snapshot().successfulReplies, 0);
    assert.equal(fixture.snapshot().runtimeRequests, 1);
    assert.equal(fixture.snapshot().transport.requests.length, 3);
  });
}

test("capture forbids profile/session substitution in both legacy and neutral wire", async () => {
  for (const wire of [false, true]) for (const [profile, frame, session] of [
    [undefined, "4Hour", "regular"],
    [SCANNER_LEVELS_EVIDENCE_PROFILE, "4Hour", undefined],
    [SCANNER_LEVELS_EVIDENCE_PROFILE, "4Hour", "extended"],
    [SCANNER_LEVELS_EVIDENCE_PROFILE, "1Day", "regular"],
  ] as const) {
    const base = "https://capture.invalid/private/";
    const bridge = new PendingLevelsFetch({ gatewayBaseUrl: base, symbol: "SYN", profile });
    const query = new URLSearchParams({ symbol: "SYN", timeframe: frame, start: "1000", end: "2000", acceptedEvidence: "1" });
    if (session) query.set("sessionMode", session);
    const url = wire ? gatewayWireUrl(base, "history", query) : new URL("history?" + query, base);
    await assert.rejects(bridge.fetcher(url, { signal: new AbortController().signal }));
    assert.equal(bridge.snapshot().state, "refused");
    assert.equal(bridge.snapshot().requests.length, 0);
  }
});

test("regular profile abort/refusal settles one Runtime operation with no map or retry", async (t) => {
  const { fixture, ready } = makeFixture();
  install(t, fixture);
  const abort = new AbortController(), pending = generate(fixture, abort.signal);
  await ready;
  abort.abort();
  assert.equal((await pending).status, 422);
  assert.equal(fixture.snapshot().successfulReplies, 0);
  assert.equal(fixture.snapshot().transport.state, "cancelled");
  assert.equal(fixture.snapshot().runtimeRequests, 1);
});

test("manager refuses regular evidence on other providers before requesting any candles", async () => {
  let built = false;
  const fake = { options: { candleFetchService: { getProviderName: () => "eodhd" } },
    buildLevelSeedHistoricalRequests: () => { built = true; } } as unknown as ManualWatchlistRuntimeManager;
  await assert.rejects(ManualWatchlistRuntimeManager.prototype.generateLevelsWithWatchlistConfiguration.call(fake, {
    symbol: "SYN", referencePriceOverride: 1.7, calculationProfile: SCANNER_LEVELS_EVIDENCE_PROFILE,
  }), /selected Alpaca/);
  assert.equal(built, false);
});
