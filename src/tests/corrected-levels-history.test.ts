import assert from "node:assert/strict";
import test from "node:test";
import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { bindAcceptedChartInput } from "../lib/market-data/accepted-chart-input.js";
import { readAlpacaRuntimeTradeRevisions } from "../lib/market-data/alpaca-runtime-providers.js";
import { parseRuntimeTradeRevisions, runtimeTradeRevisionQuery, type RuntimeTradeRevisions } from "../lib/market-data/runtime-trade-revisions.js";
import { encodeGatewayWire } from "../lib/market-data/traderslink-gateway-wire.js";
import { generateWithCurrentAlpacaHistory } from "../runtime/corrected-levels-history.js";
import type { HistoricalFetchRequest } from "../lib/market-data/provider-types.js";

const now = Date.parse("2026-11-20T20:30:00Z");
const symbol = "QAONE";
const minute = now / 1000 - 86_400;
const clean = (generation = 1): RuntimeTradeRevisions => ({ feed: "sip", generation, symbols: {} });
const changed = (revision = "a".repeat(64), pending = false): RuntimeTradeRevisions => ({
  feed: "sip", generation: 2, symbols: { [symbol]: { minutes: [minute], pending, revision } },
});

function fixture(replies: Array<RuntimeTradeRevisions | Error>, qualified = false) {
  const scopes: unknown[] = [], requests: HistoricalFetchRequest[] = [];
  const history = new CandleFetchService({ providerName: "alpaca", async fetchCandles(request, plan) {
    requests.push(request);
    const series = { provider: "alpaca" as const, symbol: request.symbol, timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars, candles: [], sessionMetadataAvailable: false,
      fetchStartTimestamp: now, fetchEndTimestamp: now,
      requestedStartTimestamp: plan.requestStartTimestamp, requestedEndTimestamp: plan.requestEndTimestamp };
    return qualified && (request.timeframe === "daily" || request.timeframe === "4h") ? bindAcceptedChartInput(series, {
      id: "11111111-1111-4111-8111-111111111111", digest: "a".repeat(64), instrumentId: symbol,
      symbol, venue: "XNAS", frame: request.timeframe, datasetId: "synthetic-qualified", priceBasisId: "split",
      calendarRevision: "synthetic", sessionMode: "extended", completedThroughMs: now - 86_400_000,
      acceptedCutoffMs: now, availableAtMs: now, acceptedAtMs: now,
    }) : series;
  } });
  return { history, scopes, requests, readRevisions: async (scope: Parameters<typeof readAlpacaRuntimeTradeRevisions>[0]) => {
    scopes.push(structuredClone(scope));
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    assert.ok(reply, "unexpected manifest read");
    return reply;
  } };
}
const daily: HistoricalFetchRequest = { symbol, timeframe: "daily", lookbackBars: 60 };

test("whole calculation uses one frozen half-open scope and current history cutoff", async () => {
  const f = fixture([clean(1), clean(3)]);
  const result = await generateWithCurrentAlpacaHistory({ ...f, symbol, now: () => now, generate: async history => {
    await history.fetchCandles(daily);
    await history.fetchCandles({ ...daily, timeframe: "4h", endTimeMs: now + 1000 });
    return "current";
  } });
  assert.equal(result, "current", "unrelated global generation changes must not invalidate the symbol");
  assert.deepEqual(f.scopes[0], f.scopes[1]);
  assert.deepEqual(f.requests.map(request => request.endTimeMs), [now, now]);
  assert.ok(f.requests.every(request => request.acceptedEvidence));
});

for (const [label, first, last] of [
  ["new correction", clean(), changed()],
  ["replacement or tombstone revision", changed(), changed("b".repeat(64))],
  ["pending after calculation", clean(), changed("a".repeat(64), true)],
  ["manifest unavailable after calculation", clean(), Error("unavailable")],
] as const) {
  test(`${label} prevents a completed calculation from escaping`, async () => {
    const f = fixture([first, last]);
    await assert.rejects(generateWithCurrentAlpacaHistory({ ...f, symbol, now: () => now, generate: async () => "old-result" }));
  });
}

for (const first of [changed("a".repeat(64), true), Error("unavailable")]) {
  test(`no calculation begins for ${first instanceof Error ? "unavailable" : "pending"} corrections`, async () => {
    const f = fixture([first]);
    let generated = false;
    await assert.rejects(generateWithCurrentAlpacaHistory({ ...f, symbol, now: () => now,
      generate: async () => { generated = true; } }));
    assert.equal(generated, false);
  });
}

test("a refused corrected Daily frame cannot turn into a partial successful map", async () => {
  const f = fixture([changed(), changed()]);
  await assert.rejects(generateWithCurrentAlpacaHistory({ ...f, symbol, now: () => now, generate: async history => {
    await assert.rejects(history.fetchCandles(daily), /not qualified/);
    return "engine-caught-refusal";
  } }), /changed during/);
});

test("qualified corrected Daily and 4H remain usable", async () => {
  const f = fixture([changed(), changed()], true);
  assert.equal(await generateWithCurrentAlpacaHistory({ ...f, symbol, now: () => now, generate: async history => {
    await history.fetchCandles(daily);
    await history.fetchCandles({ ...daily, timeframe: "4h" });
    return "qualified";
  } }), "qualified");
});

test("a correction outside the contributing frame does not demand an unrelated receipt", async () => {
  const older = changed(); older.symbols[symbol]!.minutes = [minute - 100 * 86_400];
  const f = fixture([older, older]);
  await generateWithCurrentAlpacaHistory({ ...f, symbol, now: () => now, generate: history => history.fetchCandles(daily) });
});

test("a frame outside the bounded manifest cannot bypass the fence through engine containment", async () => {
  const f = fixture([clean(), clean()]);
  await assert.rejects(generateWithCurrentAlpacaHistory({ ...f, symbol, now: () => now, generate: async history => {
    await assert.rejects(history.fetchCandles({ ...daily, lookbackBars: 1000 }), /exceeds/);
  } }));
  assert.equal(f.requests.length, 0);
});

test("non-Alpaca history retains its existing provider behavior", async () => {
  const f = fixture([]);
  const history = { ...f.history, getProviderName: () => "eodhd" as const, fetchCandles: f.history.fetchCandles.bind(f.history) };
  assert.equal(await generateWithCurrentAlpacaHistory({ ...f, history, symbol, generate: async passed => {
    assert.equal(passed, history); return "unchanged";
  } }), "unchanged");
  assert.equal(f.scopes.length, 0);
});

for (const neutral of [false, true]) {
  test(`${neutral ? "neutral" : "legacy"} shared revision transport preserves scope and validates responses`, async t => {
    const previous = process.env.TRADERLINK_GATEWAY_CONTRACT;
    t.after(() => { if (previous === undefined) delete process.env.TRADERLINK_GATEWAY_CONTRACT; else process.env.TRADERLINK_GATEWAY_CONTRACT = previous; });
    if (neutral) process.env.TRADERLINK_GATEWAY_CONTRACT = "traderslink.market.1";
    else delete process.env.TRADERLINK_GATEWAY_CONTRACT;
    const request = { symbols: [symbol], start: now - 2 * 86_400_000, end: now };
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, neutral ? "/traderslink/v1/market/trade-revisions" : "/trade-revisions");
      assert.equal(url.searchParams.get(neutral ? "tickers" : "symbols"), symbol);
      assert.equal(url.searchParams.get(neutral ? "from" : "start"), String(request.start));
      assert.equal(url.searchParams.get(neutral ? "until" : "end"), String(request.end));
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      return Response.json(neutral ? encodeGatewayWire("trade-revisions", changed()) : changed());
    };
    assert.deepEqual(await readAlpacaRuntimeTradeRevisions(request, { url: "https://gateway.invalid", token: "synthetic-only", fetcher, now: () => now }), changed());
    await assert.rejects(readAlpacaRuntimeTradeRevisions(request, { url: "https://gateway.invalid", token: "synthetic-only", fetcher: async () => new Response(null, { status: 503 }), now: () => now }));
  });
}

test("invalid scopes and malformed manifests fail closed", () => {
  const request = { symbols: [symbol], start: now - 2 * 86_400_000, end: now };
  for (const bad of [null, [], {}, { ...clean(), feed: "boats" }, { ...clean(), symbols: [] },
    { ...changed(), generation: -1 }, { ...changed(), symbols: { OTHER: changed().symbols[symbol] } },
    ...[
      { minutes: [minute, minute], pending: false, revision: "a".repeat(64) },
      { minutes: [minute + 1], pending: false, revision: "a".repeat(64) },
      { minutes: [now / 1000], pending: false, revision: "a".repeat(64) },
      { minutes: [minute], pending: false, revision: "bad" },
      { minutes: [], pending: false, revision: null },
    ].map(entry => ({ feed: "sip", symbols: { [symbol]: entry } }))]) {
    assert.throws(() => parseRuntimeTradeRevisions(bad, request));
  }
  for (const bad of [{ ...request, symbols: [] }, { ...request, symbols: [symbol, symbol] },
    { ...request, end: now + 60_001 }, { ...request, start: now - 731 * 86_400_000 }]) {
    assert.throws(() => runtimeTradeRevisionQuery(bad, now));
  }
});
