import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { IBKRLivePriceProvider } from "../lib/monitoring/ibkr-live-price-provider.js";
import type { LivePriceUpdate, WatchlistEntry } from "../lib/monitoring/monitoring-types.js";

class FakeLiveIbApi extends EventEmitter {
  public isConnected = false;
  public requestedMarketData: Array<{
    tickerId: number;
    contract: Record<string, unknown>;
  }> = [];

  public cancelledTickerIds: number[] = [];
  public connectCalls = 0;
  public disconnectCalls = 0;

  connect(): void {
    this.connectCalls += 1;
    queueMicrotask(() => {
      this.isConnected = true;
      this.emit("connected");
    });
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.isConnected = false;
    this.emit("disconnected");
  }

  reqMktData(
    tickerId: number,
    contract: Record<string, unknown>,
  ): void {
    this.requestedMarketData.push({
      tickerId,
      contract,
    });
  }

  cancelMktData(tickerId: number): void {
    this.cancelledTickerIds.push(tickerId);
  }
}

function createProviderWithFakeIb(ib: FakeLiveIbApi): IBKRLivePriceProvider {
  return new IBKRLivePriceProvider(ib as any);
}

test("IBKRLivePriceProvider subscribes active symbols and emits normalized price updates", async () => {
  const ib = new FakeLiveIbApi();
  const provider = createProviderWithFakeIb(ib);
  const updates: LivePriceUpdate[] = [];

  const entries: WatchlistEntry[] = [
    {
      symbol: "aapl",
      active: true,
      priority: 1,
      tags: [],
    },
    {
      symbol: "msft",
      active: false,
      priority: 2,
      tags: [],
    },
  ];

  await provider.start(entries, (update) => {
    updates.push(update);
  });

  assert.equal(ib.requestedMarketData.length, 1);
  assert.equal(ib.requestedMarketData[0]?.contract.symbol, "AAPL");

  ib.emit("tickPrice", 1, 1, 200.1);
  ib.emit("tickSize", 1, 8, 2_500);
  ib.emit("tickPrice", 1, 4, 200.5);

  assert.equal(updates.length, 3);
  assert.equal(updates[0]?.symbol, "AAPL");
  assert.equal(updates[0]?.lastPrice, 200.1);
  assert.equal(updates[1]?.volume, 2_500);
  assert.equal(updates[2]?.lastPrice, 200.5);

  await provider.stop();
  assert.deepEqual(ib.cancelledTickerIds, [1]);
  assert.equal(ib.disconnectCalls, 0);
});

test("IBKRLivePriceProvider ignores unknown or unusable tick events", async () => {
  const ib = new FakeLiveIbApi();
  const provider = createProviderWithFakeIb(ib);
  const updates: LivePriceUpdate[] = [];

  await provider.start(
    [
      {
        symbol: "AAPL",
        active: true,
        priority: 1,
        tags: [],
      },
    ],
    (update) => {
      updates.push(update);
    },
  );

  ib.emit("tickPrice", 99, 4, 150);
  ib.emit("tickPrice", 1, 4, undefined);
  ib.emit("tickSize", 1, 3, 10);

  assert.equal(updates.length, 0);

  await provider.stop();
});

test("IBKRLivePriceProvider reuses an injected connected client without owning disconnect", async () => {
  const ib = new FakeLiveIbApi();
  ib.isConnected = true;

  const provider = createProviderWithFakeIb(ib);

  await provider.start(
    [
      {
        symbol: "AAPL",
        active: true,
        priority: 1,
        tags: [],
      },
    ],
    () => {},
  );

  assert.equal(ib.connectCalls, 0);
  assert.equal(ib.requestedMarketData.length, 1);

  await provider.stop();

  assert.equal(ib.disconnectCalls, 0);
  assert.deepEqual(ib.cancelledTickerIds, [1]);
});

test("IBKRLivePriceProvider can stop and restart cleanly with fresh ticker ids", async () => {
  const ib = new FakeLiveIbApi();
  const provider = createProviderWithFakeIb(ib);

  await provider.start(
    [
      {
        symbol: "AAPL",
        active: true,
        priority: 1,
        tags: [],
      },
    ],
    () => {},
  );

  await provider.stop();
  assert.deepEqual(ib.cancelledTickerIds, [1]);

  await provider.start(
    [
      {
        symbol: "MSFT",
        active: true,
        priority: 1,
        tags: [],
      },
    ],
    () => {},
  );

  assert.equal(ib.requestedMarketData.length, 2);
  assert.equal(ib.requestedMarketData[1]?.tickerId, 1);
  assert.equal(ib.requestedMarketData[1]?.contract.symbol, "MSFT");

  await provider.stop();
  assert.deepEqual(ib.cancelledTickerIds, [1, 1]);
});

test("IBKRLivePriceProvider re-requests market data after a 1101 reconnect event", async () => {
  const ib = new FakeLiveIbApi();
  const provider = createProviderWithFakeIb(ib);

  await provider.start(
    [
      {
        symbol: "AAPL",
        active: true,
        priority: 1,
        tags: [],
      },
    ],
    () => {},
  );

  assert.equal(ib.requestedMarketData.length, 1);

  ib.emit("error", new Error("Connectivity restored - data lost"), 1101, -1);

  assert.equal(ib.requestedMarketData.length, 2);
  assert.equal(ib.requestedMarketData[1]?.tickerId, 1);

  await provider.stop();
});

test("IBKRLivePriceProvider does not duplicate market data requests after a 1102 reconnect event", async () => {
  const ib = new FakeLiveIbApi();
  const provider = createProviderWithFakeIb(ib);

  await provider.start(
    [
      {
        symbol: "AAPL",
        active: true,
        priority: 1,
        tags: [],
      },
    ],
    () => {},
  );

  assert.equal(ib.requestedMarketData.length, 1);

  ib.emit("error", new Error("Connectivity restored - data maintained"), 1102, -1);

  assert.equal(ib.requestedMarketData.length, 1);

  await provider.stop();
});
