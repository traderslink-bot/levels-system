import assert from "node:assert/strict";
import test from "node:test";
import { AlpacaRuntimeLivePriceProvider } from "../lib/market-data/alpaca-runtime-providers.js";
import { watchlistPriceFeedStatus } from "../lib/monitoring/watchlist-price-feed-status.js";

test("connected SIP transport stays live with old trades during a halt; timestamps remain actual", async () => {
  const now = Date.parse("2026-11-09T15:00:00Z"), old = now - 20 * 60000;
  const updates: {timestamp: number}[] = [];
  const provider = new AlpacaRuntimeLivePriceProvider({url:"https://gateway.example/",token:"offline",now:()=>now,
    fetcher:async()=>Response.json({feed:"sip",connected:true,snapshots:{TEST:{latestTrade:{p:5,t:new Date(old).toISOString()}}}})});
  try {
    await provider.start([{symbol:"TEST",active:true}], update=>updates.push(update));
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(provider.getFeedHealth(), {connected:true,checkedAt:now});
    assert.equal(updates[0]?.timestamp,old);
    assert.equal(watchlistPriceFeedStatus({now,regularSessionsClosed:false,overnightEnabled:true,lastPriceAgeMs:now-old,transport:provider.getFeedHealth()}),"live");
    assert.equal(watchlistPriceFeedStatus({now,regularSessionsClosed:false,overnightEnabled:true,lastPriceAgeMs:now-old}),"stale");
  } finally { await provider.stop(); }
  assert.equal(provider.getFeedHealth(),null);
});

test("disconnected, failing and expired connections never use a fresh trade to claim feed live", async () => {
  const now = Date.parse("2026-11-09T15:00:00Z");
  for (const fail of [false,true]) {
    const provider = new AlpacaRuntimeLivePriceProvider({url:"https://gateway.example/",token:"offline",now:()=>now,
      fetcher:async()=>fail ? new Response("{}",{status:503}) : Response.json({feed:"sip",connected:false,snapshots:{}})});
    try {
      await provider.start([{symbol:"TEST",active:true}],()=>assert.fail("must not publish"));
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(provider.getFeedHealth()?.connected,false);
      assert.equal(watchlistPriceFeedStatus({now,regularSessionsClosed:false,overnightEnabled:true,lastPriceAgeMs:0,transport:provider.getFeedHealth()}),"stale");
    } finally { await provider.stop(); }
  }
  assert.equal(watchlistPriceFeedStatus({now,regularSessionsClosed:false,overnightEnabled:true,lastPriceAgeMs:0,transport:{connected:true,checkedAt:now-31000}}),"stale");
});

test("available BOATS request is distinguished from a new trade without extra requests", async () => {
  const now=Date.parse("2026-11-09T03:00:00Z"); let calls=0;
  const provider=new AlpacaRuntimeLivePriceProvider({url:"https://gateway.example/",token:"offline",now:()=>now,
    fetcher:async()=>{calls++;return Response.json({feed:"boats",trade:null});}});
  try {
    await provider.start([{symbol:"TEST",active:true}],()=>assert.fail("no trade to publish"));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls,1);
    assert.deepEqual(provider.getFeedHealth(),{connected:true,checkedAt:now});
    assert.equal(watchlistPriceFeedStatus({now,regularSessionsClosed:true,overnightEnabled:true,lastPriceAgeMs:null,transport:provider.getFeedHealth()}),"live");
  } finally {await provider.stop();}
});
