import test from "node:test";
import assert from "node:assert/strict";
import {setImmediate as nextTurn} from "node:timers/promises";
import {AlpacaRuntimeHistoricalProvider,AlpacaRuntimeLivePriceProvider} from "../lib/market-data/alpaca-runtime-providers.js";
import {createHistoricalCandleProvider} from "../lib/market-data/provider-factory.js";
import {createLivePriceProvider} from "../lib/monitoring/live-price-provider-factory.js";
import {SelectableSameDayCandleService,SAME_DAY_CANDLE_PROVIDER_OPTIONS} from "../lib/market-data/selectable-same-day-candle-service.js";
import {resolveStockLevelsReferencePrice} from "../runtime/stock-levels-reference-price.js";

const now=Date.parse("2026-11-06T15:01:00Z");
test("Alpaca factories select explicit adapters and reject unconfigured transport without fallback",()=>{
  const previous={...process.env};
  try{
    process.env.TRADERLINK_ALPACA_GATEWAY_URL="https://gateway.invalid/";process.env.TRADERLINK_ALPACA_GATEWAY_TOKEN="synthetic-only";
    assert.ok(createHistoricalCandleProvider({provider:"alpaca"}) instanceof AlpacaRuntimeHistoricalProvider);
    assert.ok(createLivePriceProvider({provider:"alpaca"}) instanceof AlpacaRuntimeLivePriceProvider);
    assert.ok(SAME_DAY_CANDLE_PROVIDER_OPTIONS.includes("alpaca"));
    delete process.env.TRADERLINK_ALPACA_GATEWAY_TOKEN;
    assert.throws(()=>createHistoricalCandleProvider({provider:"alpaca"}),/configuration is required/);
  }finally{process.env=previous;}
});

test("runtime history preserves real source identity and rejects incomplete or wrong-feed data",async()=>{
  const request={symbol:"AAPL",timeframe:"5m" as const,lookbackBars:1},plan={plannedBarCount:1,requestStartTimestamp:now-300000,requestEndTimestamp:now};
  const valid={symbol:"AAPL",feed:"sip",adjustment:"split",complete:true,bars:[{time:(now-60000)/1000,open:1,high:2,low:.5,close:1.5,volume:100}]};
  let payload:unknown=valid;
  const provider=new AlpacaRuntimeHistoricalProvider({url:"https://gateway.invalid/",token:"synthetic-only",fetcher:async()=>Response.json(payload),now:()=>now});
  const result=await provider.fetchCandles(request,plan);assert.equal(result.provider,"alpaca");assert.equal(result.candles[0].timestamp,now-60000);
  payload={...valid,complete:false};await assert.rejects(()=>provider.fetchCandles(request,plan),/incomplete/);
  payload={...valid,feed:"iex"};await assert.rejects(()=>provider.fetchCandles(request,plan),/incomplete/);
});

test("Alpaca live adapter uses actual timestamps and stops its shared trade stream",async()=>{
  let requests=0;const updates:unknown[]=[];
  const provider=new AlpacaRuntimeLivePriceProvider({url:"https://gateway.invalid/",token:"synthetic-only",now:()=>now,fetcher:async()=>{
    requests++;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(`event: prices\ndata: ${JSON.stringify({protocolVersion:1,feed:"sip",connected:true,kind:"snapshot",emittedAt:now,prices:{AAPL:{price:2,providerObservedAt:new Date(now-1000).toISOString(),receiptAt:now}}})}\n\n`));}}),{headers:{"content-type":"text/event-stream"}});
  }});
  await provider.start([{symbol:"AAPL",active:true}],update=>updates.push(update));await nextTurn();await provider.stop();
  assert.equal(requests,1);assert.deepEqual(updates,[{symbol:"AAPL",timestamp:now-1000,lastPrice:2}]);
});

test("same-day Alpaca failure never invokes Yahoo fallback",async()=>{
  const previous={...process.env},original=globalThis.fetch;
  let yahooRequests=0;
  try{
    process.env.TRADERLINK_ALPACA_GATEWAY_URL="https://gateway.invalid/";process.env.TRADERLINK_ALPACA_GATEWAY_TOKEN="synthetic-only";
    globalThis.fetch=async()=>Response.json({error:"unavailable"},{status:503});
    const service=new SelectableSameDayCandleService("alpaca",{getProviderName:()=>"yahoo",fetchCandles:async()=>{yahooRequests++;throw Error("must not fallback");}},null,()=>now);
    await assert.rejects(()=>service.fetchCandles({symbol:"AAPL",timeframe:"5m",lookbackBars:1,endTimeMs:now}));assert.equal(yahooRequests,0);assert.equal(service.getProviderName(),"alpaca");
  }finally{globalThis.fetch=original;process.env=previous;}
});

test("Stock Levels reference stays Alpaca-only and retains its freshness gate",async()=>{
  const previous={...process.env};let calls=0;
  try{
    process.env.TRADERLINK_MARKET_DATA_PROVIDER="alpaca";process.env.TRADERLINK_ALPACA_GATEWAY_URL="https://gateway.invalid/";process.env.TRADERLINK_ALPACA_GATEWAY_TOKEN="synthetic-only";
    const quote=await resolveStockLevelsReferencePrice("AAPL",async()=>{calls++;return Response.json({feed:"sip",snapshots:{AAPL:{latestTrade:{p:2,t:new Date(Date.now()).toISOString()}}}});});
    assert.equal(quote?.source,"alpaca");assert.equal(calls,1);
    const unavailable=await resolveStockLevelsReferencePrice("AAPL",async()=>{calls++;return Response.json({error:"unavailable"},{status:503});});assert.equal(unavailable,null);assert.equal(calls,2);
  }finally{process.env=previous;}
});
