import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { buildTechnicalContextFromCandles } from "../lib/technical-context/technical-context.js";
import { EodhdLivePriceProvider } from "../lib/monitoring/eodhd-live-price-provider.js";
import type { Candle } from "../lib/market-data/candle-types.js";

const timestamp = Date.parse("2026-11-02T14:00:00Z");
const candles: Candle[] = Array.from({ length: 30 }, (_, index) => ({ timestamp: timestamp + index * 300_000, open: 2, high: 2.2, low: 1.9, close: 2.1, volume: 100 }));
class Socket extends EventEmitter {
  readyState = 1;
  send() {}
  close() {}
  addEventListener(event: string, listener: (...args: any[]) => void) { this.on(event, listener); }
  message(value: unknown) { this.emit("message", { data: JSON.stringify(value) }); }
}

test("malformed candle timestamps cannot reproduce the observed Date.toISOString crash", () => {
  const expected = buildTechnicalContextFromCandles({ candles });
  for (const bad of [NaN, Infinity, -Infinity, 1e18, -1e18, undefined, null, "bad", 1.5]) {
    const invalid = { ...candles[0]!, timestamp: bad } as unknown as Candle;
    const result = buildTechnicalContextFromCandles({ candles: [invalid, ...candles] });
    assert.equal(result.candleCount, 30);
    assert.equal(result.updatedAt, expected.updatedAt);
    assert.equal(result.ema9, expected.ema9);
    assert.equal(result.ema20, expected.ema20);
    assert.equal(result.vwap, expected.vwap);
    assert.ok(result.diagnostics.includes("5m:invalid_candle_timestamp"));
  }
  assert.equal(expected.confidence, "high");
  assert.ok(!expected.diagnostics.includes("5m:invalid_candle_timestamp"));
});

test("all invalid history degrades the context rather than inventing data", () => {
  const result = buildTechnicalContextFromCandles({ candles: [{ ...candles[0]!, timestamp: 1e18 }] });
  assert.equal(result.candleCount, 0); assert.equal(result.updatedAt, null);
  assert.equal(result.confidence, "unavailable"); assert.equal(result.ema20, null);
  assert.equal(result.vwap, null);
});

test("explicit session date and rollover selection still preserve valid candles", () => {
  const result = buildTechnicalContextFromCandles({ candles: [...candles, { ...candles[0]!, timestamp: NaN }], sessionDate: "2026-11-02" });
  assert.equal(result.candleCount, 30); assert.equal(result.sessionDate, "2026-11-02");
  assert.ok(Number.isFinite(result.ema20));
});

for (const interval of [0, 5]) {
  test(`invalid frames and failing consumers are isolated with dispatch interval ${interval}`, async () => {
    const socket = new Socket(); const seen: string[] = []; const errors: string[] = [];
    const provider = new EodhdLivePriceProvider({ apiToken: "synthetic-only", dispatchIntervalMs: interval, socketFactory: () => socket });
    const original = console.error; console.error = (message) => errors.push(String(message));
    try {
      await provider.start(["AAA", "BBB"].map(symbol => ({ symbol, active: true, priority: 1, tags: [] })), update => {
        seen.push(update.symbol);
        if (update.symbol === "AAA") throw Error("synthetic consumer failure");
      });
      socket.message([null, "bad", 12, ...[1e18, "bad", true, [timestamp], {}, undefined].map(t => ({ s: "AAA", p: 2, t }))]);
      socket.message([{ s: "AAA", p: 2, t: timestamp }, { s: "BBB", p: 2, t: timestamp }]);
      await new Promise(resolve => setTimeout(resolve, 25));
      assert.deepEqual(seen, ["AAA", "BBB"]);
      socket.message([{ s: "AAA", p: 2, t: timestamp + 100 }, { s: "BBB", p: 2, t: timestamp + 100 }]);
      await new Promise(resolve => setTimeout(resolve, 25));
      assert.deepEqual(seen, ["AAA", "BBB", "AAA", "BBB"]);
      assert.equal(errors.length, 1); assert.ok(!errors[0]!.includes("synthetic consumer failure"));
    } finally { await provider.stop(); console.error = original; }
  });
}

test("async callback rejection is contained", async () => {
  const socket = new Socket(); const errors: string[] = []; const provider = new EodhdLivePriceProvider({ apiToken: "synthetic-only", dispatchIntervalMs: 0, socketFactory: () => socket });
  const original = console.error; console.error = message => errors.push(String(message));
  try {
    await provider.start([{ symbol: "AAA", active: true, priority: 1, tags: [] }], async () => { throw Error("synthetic rejection"); });
    socket.message({ s: "AAA", p: 2, t: timestamp }); await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(errors.length, 1);
  } finally { await provider.stop(); console.error = original; }
});
