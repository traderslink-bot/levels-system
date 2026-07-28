import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { EodhdLivePriceProvider } from "../lib/monitoring/eodhd-live-price-provider.js";
import {
  createLivePriceProvider,
  resolveLivePriceProviderName,
} from "../lib/monitoring/live-price-provider-factory.js";
import type { LivePriceUpdate, WatchlistEntry } from "../lib/monitoring/monitoring-types.js";

class FakeWebSocket extends EventEmitter {
  readyState = 0;
  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  addEventListener(event: "open" | "message" | "error" | "close", listener: (event: any) => void): void {
    this.on(event, listener);
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  message(data: unknown): void {
    this.emit("message", { data });
  }

  serverClose(): void {
    this.readyState = 3;
    this.emit("close", {});
  }
}

const entries: WatchlistEntry[] = [
  {
    symbol: "aapl",
    active: true,
    priority: 1,
    tags: [],
  },
  {
    symbol: "msft",
    active: true,
    priority: 2,
    tags: [],
  },
];

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("EodhdLivePriceProvider subscribes active symbols and emits normalized trade updates", async () => {
  const sockets: FakeWebSocket[] = [];
  const updates: LivePriceUpdate[] = [];
  const provider = new EodhdLivePriceProvider({
    apiToken: "test-token",
    dispatchIntervalMs: 0,
    socketFactory: (url) => {
      assert.match(url, /api_token=test-token/);
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
  });

  await provider.start(entries, (update) => {
    updates.push(update);
  });
  sockets[0]!.open();
  sockets[0]!.message(JSON.stringify({
    s: "AAPL",
    p: 204.5,
    v: 100,
    t: 1_725_198_451_165,
    ms: "open",
  }));

  assert.deepEqual(JSON.parse(sockets[0]!.sent[0]!), {
    action: "subscribe",
    symbols: "AAPL,MSFT",
  });
  assert.deepEqual(updates, [
    {
      symbol: "AAPL",
      timestamp: 1_725_198_451_165,
      lastPrice: 204.5,
      volume: 100,
    },
  ]);

  await provider.stop();
});

test("EodhdLivePriceProvider dedupes active symbols before subscribing", async () => {
  const sockets: FakeWebSocket[] = [];
  const provider = new EodhdLivePriceProvider({
    apiToken: "test-token",
    dispatchIntervalMs: 0,
    maxSymbols: 2,
    socketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
  });

  await provider.start([
    ...entries,
    {
      symbol: "AAPL",
      active: true,
      priority: 3,
      tags: [],
    },
  ], () => undefined);
  sockets[0]!.open();

  assert.deepEqual(JSON.parse(sockets[0]!.sent[0]!), {
    action: "subscribe",
    symbols: "AAPL,MSFT",
  });

  await provider.stop();
});

test("EodhdLivePriceProvider subscribes EODHD stock stream symbols while preserving watchlist symbols", async () => {
  const sockets: FakeWebSocket[] = [];
  const updates: LivePriceUpdate[] = [];
  const provider = new EodhdLivePriceProvider({
    apiToken: "test-token",
    dispatchIntervalMs: 0,
    socketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
  });

  await provider.start([
    {
      symbol: "aapl.us",
      active: true,
      priority: 1,
      tags: [],
    },
  ], (update) => {
    updates.push(update);
  });
  sockets[0]!.open();
  sockets[0]!.message(JSON.stringify({
    s: "AAPL",
    p: 204.5,
    v: 100,
    t: 1_725_198_451_165,
  }));

  assert.deepEqual(JSON.parse(sockets[0]!.sent[0]!), {
    action: "subscribe",
    symbols: "AAPL",
  });
  assert.deepEqual(updates, [
    {
      symbol: "AAPL.US",
      timestamp: 1_725_198_451_165,
      lastPrice: 204.5,
      volume: 100,
    },
  ]);

  await provider.stop();
});

test("EodhdLivePriceProvider handles batched trade messages", async () => {
  const sockets: FakeWebSocket[] = [];
  const updates: LivePriceUpdate[] = [];
  const provider = new EodhdLivePriceProvider({
    apiToken: "test-token",
    dispatchIntervalMs: 0,
    socketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
  });

  await provider.start(entries, (update) => {
    updates.push(update);
  });
  sockets[0]!.open();
  sockets[0]!.message(JSON.stringify([
    { s: "AAPL", p: 204.5, v: 100, t: 1_725_198_451_165 },
    { s: "MSFT", p: 505.1, v: 200, t: 1_725_198_451_200 },
  ]));

  assert.deepEqual(updates.map((update) => update.symbol), ["AAPL", "MSFT"]);
  assert.equal(updates[1]?.lastPrice, 505.1);

  await provider.stop();
});

test("EodhdLivePriceProvider coalesces a trade burst to the latest update per symbol", async () => {
  const sockets: FakeWebSocket[] = [];
  const updates: LivePriceUpdate[] = [];
  const provider = new EodhdLivePriceProvider({
    apiToken: "test-token",
    dispatchIntervalMs: 5,
    socketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
  });

  await provider.start(entries, (update) => {
    updates.push(update);
  });
  sockets[0]!.open();
  sockets[0]!.message(JSON.stringify([
    ...Array.from({ length: 500 }, (_, index) => ({
      s: "AAPL",
      p: 200 + index / 100,
      v: 1,
      t: 1_725_198_451_000 + index,
    })),
    ...Array.from({ length: 500 }, (_, index) => ({
      s: "MSFT",
      p: 500 + index / 100,
      v: 2,
      t: 1_725_198_452_000 + index,
    })),
  ]));

  await waitMs(20);

  assert.equal(updates.length, 2);
  assert.deepEqual(updates, [
    {
      symbol: "AAPL",
      timestamp: 1_725_198_451_499,
      lastPrice: 204.99,
      volume: 500,
    },
    {
      symbol: "MSFT",
      timestamp: 1_725_198_452_499,
      lastPrice: 504.99,
      volume: 1_000,
    },
  ]);

  await provider.stop();
});

test("EodhdLivePriceProvider drops a late trade after a newer quote was dispatched", async () => {
  const sockets: FakeWebSocket[] = [];
  const updates: LivePriceUpdate[] = [];
  const provider = new EodhdLivePriceProvider({
    apiToken: "test-token",
    dispatchIntervalMs: 5,
    socketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
  });

  await provider.start(entries, (update) => {
    updates.push(update);
  });
  sockets[0]!.open();
  sockets[0]!.message(JSON.stringify({ s: "AAPL", p: 205, v: 10, t: 2_000 }));
  await waitMs(10);
  sockets[0]!.message(JSON.stringify({ s: "AAPL", p: 199, v: 10, t: 1_999 }));
  await waitMs(10);

  assert.deepEqual(updates.map((update) => update.lastPrice), [205]);

  await provider.stop();
});

test("EodhdLivePriceProvider ignores dark-pool and unsubscribed symbol prints", async () => {
  const sockets: FakeWebSocket[] = [];
  const updates: LivePriceUpdate[] = [];
  const provider = new EodhdLivePriceProvider({
    apiToken: "test-token",
    dispatchIntervalMs: 0,
    socketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
  });

  await provider.start(entries, (update) => {
    updates.push(update);
  });
  sockets[0]!.open();
  sockets[0]!.message(JSON.stringify({ s: "AAPL", p: 204.5, v: 100, t: 1_725_198_451_165, dp: true }));
  sockets[0]!.message(JSON.stringify({ s: "TSLA", p: 300.1, v: 100, t: 1_725_198_451_170 }));
  sockets[0]!.message(JSON.stringify({ s: "MSFT", p: 505.1, v: 200, t: 1_725_198_451_200, dp: false }));

  assert.deepEqual(updates.map((update) => update.symbol), ["MSFT"]);
  assert.equal(updates[0]?.lastPrice, 505.1);

  await provider.stop();
});

test("EodhdLivePriceProvider reconnects and resubscribes active symbols after a socket close", async () => {
  const sockets: FakeWebSocket[] = [];
  const provider = new EodhdLivePriceProvider({
    apiToken: "test-token",
    dispatchIntervalMs: 0,
    reconnectDelayMs: 1,
    socketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
  });

  await provider.start(entries, () => undefined);
  sockets[0]!.open();
  sockets[0]!.serverClose();
  await waitMs(10);
  sockets[1]!.open();

  assert.equal(sockets.length, 2);
  assert.deepEqual(JSON.parse(sockets[1]!.sent[0]!), {
    action: "subscribe",
    symbols: "AAPL,MSFT",
  });

  await provider.stop();
});

test("EodhdLivePriceProvider ignores stale socket events after restart", async () => {
  const sockets: FakeWebSocket[] = [];
  const updates: LivePriceUpdate[] = [];
  const provider = new EodhdLivePriceProvider({
    apiToken: "test-token",
    dispatchIntervalMs: 0,
    reconnectDelayMs: 1,
    socketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
  });

  await provider.start(entries, (update) => {
    updates.push(update);
  });
  const staleSocket = sockets[0]!;
  staleSocket.open();

  await provider.start([
    {
      symbol: "tsla",
      active: true,
      priority: 1,
      tags: [],
    },
  ], (update) => {
    updates.push(update);
  });
  sockets[1]!.open();
  staleSocket.message(JSON.stringify({ s: "TSLA", p: 300.1, v: 100, t: 1_725_198_451_170 }));
  staleSocket.serverClose();
  await waitMs(10);
  sockets[1]!.message(JSON.stringify({ s: "TSLA", p: 301.2, v: 200, t: 1_725_198_451_200 }));

  assert.equal(sockets.length, 2);
  assert.deepEqual(updates, [
    {
      symbol: "TSLA",
      timestamp: 1_725_198_451_200,
      lastPrice: 301.2,
      volume: 200,
    },
  ]);

  await provider.stop();
});

test("EodhdLivePriceProvider enforces configured symbol limit", async () => {
  const provider = new EodhdLivePriceProvider({
    apiToken: "test-token",
    dispatchIntervalMs: 0,
    maxSymbols: 1,
    socketFactory: () => new FakeWebSocket(),
  });

  await assert.rejects(
    () => provider.start(entries, () => undefined),
    /supports 1 active symbols/,
  );
});

test("live price provider factory defaults to IBKR and creates EODHD only when requested", () => {
  assert.equal(resolveLivePriceProviderName(undefined), "ibkr");
  assert.equal(resolveLivePriceProviderName("ibkr"), "ibkr");
  assert.equal(resolveLivePriceProviderName("eodhd"), "eodhd");
  assert.equal(resolveLivePriceProviderName("unknown"), "ibkr");

  const previousApiToken = process.env.EODHD_API_TOKEN;
  process.env.EODHD_API_TOKEN = "test-token";
  try {
    const provider = createLivePriceProvider({ provider: "eodhd" });
    assert.equal(provider instanceof EodhdLivePriceProvider, true);
  } finally {
    if (previousApiToken === undefined) {
      delete process.env.EODHD_API_TOKEN;
    } else {
      process.env.EODHD_API_TOKEN = previousApiToken;
    }
  }
});
