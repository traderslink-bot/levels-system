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


test("gated REST uses the actual factory and Levels reference without changing price precision or provenance",async()=>{
  const previous={...process.env},original=globalThis.fetch;
  const request={symbol:"TEST",timeframe:"1m" as const,lookbackBars:1};
  const plan={plannedBarCount:1,requestStartTimestamp:now-60000,requestEndTimestamp:now};
  const candle={time:(now-60000)/1000,open:.0277,high:.029,low:.0275,close:.0284,volume:123456};
  try{
    process.env.TRADERLINK_ALPACA_GATEWAY_URL="https://gateway.invalid/private/";
    process.env.TRADERLINK_ALPACA_GATEWAY_TOKEN="synthetic-only";
    process.env.TRADERLINK_MARKET_DATA_PROVIDER="alpaca";
    for(const neutral of [false,true]){
      if(neutral)process.env.TRADERLINK_GATEWAY_CONTRACT="traderslink.market.1";
      else delete process.env.TRADERLINK_GATEWAY_CONTRACT;
      const calls:{url:URL;options:RequestInit|undefined}[]=[];
      const observed=new Date(Date.now()-1000).toISOString().replace("Z","000001Z");
      const fetcher:typeof fetch=async(url,options)=>{
        const target=new URL(String(url));calls.push({url:target,options});
        if(target.pathname.endsWith(neutral?"candle-window":"history"))return Response.json(neutral
          ?{schema:"traderslink.market.1",resource:"candle-window",data:{ticker:"TEST",coverage:"consolidated",basis:"split",basisDay:"2026-11-06",finished:true,candles:[{at:candle.time,first:candle.open,peak:candle.high,trough:candle.low,last:candle.close,shares:candle.volume}]}}
          :{symbol:"TEST",feed:"sip",adjustment:"split",basisDate:"2026-11-06",complete:true,bars:[candle]});
        assert.equal(target.pathname,neutral?"/private/traderslink/v1/market/market-state":"/private/quotes");
        return Response.json(neutral
          ?{schema:"traderslink.market.1",resource:"market-state",data:{coverage:"consolidated",instruments:{TEST:{lastPrint:{value:.4195,observed}}}}}
          :{feed:"sip",snapshots:{TEST:{latestTrade:{p:.4195,t:observed}}}});
      };
      globalThis.fetch=fetcher;
      const provider=createHistoricalCandleProvider({provider:"alpaca"});
      assert.ok(provider instanceof AlpacaRuntimeHistoricalProvider);
      const result=await provider.fetchCandles(request,plan);
      assert.deepEqual(result.candles,[{timestamp:now-60000,open:.0277,high:.029,low:.0275,close:.0284,volume:123456}]);
      assert.equal(result.provider,"alpaca");assert.deepEqual(result.providerMetadata,{source:"alpaca_sip_vps",adjustment:"split"});
      const quote=await resolveStockLevelsReferencePrice("TEST",fetcher);
      assert.deepEqual(quote,{price:.4195,asOf:Date.parse(observed),source:"alpaca"});
      assert.equal(calls.length,2);
      assert.equal(calls[0].url.pathname,neutral?"/private/traderslink/v1/market/candle-window":"/private/history");
      assert.deepEqual(Object.fromEntries(calls[0].url.searchParams),neutral
        ?{ticker:"TEST",resolution:"1Min",from:String(now-60000),until:String(now)}
        :{symbol:"TEST",timeframe:"1Min",start:String(now-60000),end:String(now)});
      assert.equal(calls[1].url.searchParams.get(neutral?"tickers":"symbols"),"TEST");
      for(const call of calls){assert.equal(call.options?.redirect,"error");assert.equal(new Headers(call.options?.headers).get("authorization"),"Bearer synthetic-only");assert.ok(call.options?.signal instanceof AbortSignal);}
    }
  }finally{globalThis.fetch=original;process.env=previous;}
});

test("neutral REST rejects bad contracts and original invalid candle data without a legacy retry",async()=>{
  const previous={...process.env};
  try{
    process.env.TRADERLINK_GATEWAY_CONTRACT="traderslink.market.1";
    const data={ticker:"TEST",coverage:"consolidated",basis:"split",finished:true,candles:[{at:(now-60000)/1000,first:1,peak:2,trough:.5,last:1.5,shares:100}]};
    const envelope={schema:"traderslink.market.1",resource:"candle-window",data};
    for(const [status,payload]of [[503,{error:"private-value"}],[200,{...envelope,resource:"market-state"}],[200,{...envelope,data:{...data,finished:false}}],[200,{...envelope,data:{...data,coverage:"iex"}}],[200,{...envelope,data:{...data,candles:[{...data.candles[0],peak:.8}]}}]] as const){
      let calls=0;
      const provider=new AlpacaRuntimeHistoricalProvider({url:"https://gateway.invalid/",token:"offline",fetcher:async()=>{calls++;return Response.json(payload,{status});},now:()=>now});
      await assert.rejects(()=>provider.fetchCandles({symbol:"TEST",timeframe:"1m",lookbackBars:1},{plannedBarCount:1,requestStartTimestamp:now-60000,requestEndTimestamp:now}));
      assert.equal(calls,1);
    }
  }finally{process.env=previous;}
});
