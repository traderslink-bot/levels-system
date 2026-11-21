import assert from "node:assert/strict";
import test from "node:test";
import { parseWatchlistPriceFrame, consumeWatchlistPriceStream } from "../lib/market-data/watchlist-alpaca-price-stream.js";
import { AlpacaRuntimeLivePriceProvider } from "../lib/market-data/alpaca-runtime-providers.js";
const now=Date.parse("2026-11-09T15:00:00Z");
const trade=(price=5,t="2026-11-09T15:00:00.000000001Z")=>({price,providerObservedAt:t,receiptAt:now});
const frame=(prices:Record<string,unknown>={},extra:Record<string,unknown>={})=>({protocolVersion:1,feed:"sip",connected:true,kind:"delta",emittedAt:now,prices,...extra});
const wire=(data:unknown)=>`event: prices\ndata: ${JSON.stringify(data)}\n\n`;
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test("validates protocol, feed, membership, observation and transport clocks atomically",()=>{
  const good=frame({TEST:trade()});
  assert.equal(parseWatchlistPriceFrame(JSON.stringify(good),new Set(["TEST"]),now).trades[0].timestamp,now);
  for(const bad of [frame({OTHER:trade()}),frame({TEST:trade()},{feed:"iex"}),frame({TEST:trade()},{connected:false}),
    frame({TEST:trade()},{protocolVersion:2}),frame({TEST:trade()},{emittedAt:now-13000}),frame({TEST:trade(-1)}),
    frame({TEST:{...trade(),providerObservedAt:"bad"}}),frame({TEST:{...trade(),receiptAt:now+60000}})]) {
    assert.throws(()=>parseWatchlistPriceFrame(JSON.stringify(bad),new Set(["TEST"]),now));
  }
});

test("receives fragmented CRLF and multiple frames immediately, with no completed-minute wait",async()=>{
  const parent=new AbortController();const received:number[]=[];
  const payload=(wire(frame({TEST:trade()}))+wire(frame({TEST:trade(6)}))).replaceAll("\n","\r\n");
  const response=new Response(new ReadableStream({start(c){for(const char of payload)c.enqueue(new TextEncoder().encode(char));}}),{headers:{"content-type":"text/event-stream"}});
  await assert.rejects(consumeWatchlistPriceStream({symbols:["TEST"],signal:parent.signal,now:()=>now,open:async()=>response,
    onFrame:f=>{received.push(f.trades[0].price);if(received.length===2)parent.abort();}}));
  assert.deepEqual(received,[5,6]);
});

test("oversized frames and silent connection are bounded and canceled",async()=>{
  for(const large of [true,false]) {
    let canceled=false;
    const response=new Response(new ReadableStream({start(c){if(large)c.enqueue(new TextEncoder().encode("x".repeat(2000001)));},cancel(){canceled=true;}}),{headers:{"content-type":"text/event-stream"}});
    const keepAlive=setTimeout(()=>undefined,100);
    try {await assert.rejects(consumeWatchlistPriceStream({symbols:["TEST"],signal:new AbortController().signal,now:()=>now,open:async()=>response,onFrame:()=>assert.fail(),idleMs:10}));}
    finally{clearTimeout(keepAlive);}
    assert.equal(canceled,true);
  }
});

test("provider uses one subscription, nanosecond ordering and actual trade times, no quotes polling",async()=>{
  let sink:ReadableStreamDefaultController<Uint8Array>|undefined;let canceled=false;
  const calls:{url:string;body:unknown}[]=[];const updates:{lastPrice:number;timestamp:number}[]=[];
  const provider=new AlpacaRuntimeLivePriceProvider({url:"https://gateway.example/",token:"offline",now:()=>now,
    fetcher:async(url,options)=>{calls.push({url:String(url),body:JSON.parse(String(options?.body))});return new Response(new ReadableStream({start(c){sink=c;},cancel(){canceled=true;}}),{headers:{"content-type":"text/event-stream"}});}});
  try {
    await provider.start([{symbol:"TEST",active:true}],u=>updates.push(u));await turn();
    const emit=(data:unknown)=>sink!.enqueue(new TextEncoder().encode(wire(data)));
    emit(frame({TEST:trade(5,"2026-11-09T15:00:00.000000002Z")}));await turn();
    emit(frame({TEST:trade(4,"2026-11-09T15:00:00.000000001Z")}));
    emit(frame({TEST:trade(6,"2026-11-09T15:00:00.000000003Z")}));await turn();
    emit(frame({}, {kind:"status"}));await turn();
    assert.deepEqual(updates,[{symbol:"TEST",lastPrice:5,timestamp:now},{symbol:"TEST",lastPrice:6,timestamp:now}]);
    assert.deepEqual(calls,[{url:"https://gateway.example/prices",body:{symbols:["TEST"]}}]);
    assert.deepEqual(provider.getFeedHealth(),{connected:true,checkedAt:now});
    emit(frame({}, {kind:"status",connected:false}));await turn();
    assert.equal(provider.getFeedHealth()?.connected,false);
  }finally{await provider.stop();await turn();}
  assert.equal(canceled,true);
});

test("reconnect snapshot cannot reverse price order; updated population cancels old subscription",async()=>{
  let calls=0,canceled=0;const updates:number[]=[];const subscriptions:string[][]=[];
  let markReconnected:()=>void=()=>undefined;
  const reconnected=new Promise<void>(resolve=>{markReconnected=resolve;});
  const provider=new AlpacaRuntimeLivePriceProvider({url:"https://gateway.example/",token:"offline",now:()=>now,
    fetcher:async(_url,options)=>{
      calls++;const symbols=JSON.parse(String(options?.body)).symbols as string[];subscriptions.push(symbols);
      return new Response(new ReadableStream({start(c){
        if(calls===1){c.enqueue(new TextEncoder().encode(wire(frame({TEST:trade(6,"2026-11-09T15:00:00.000000002Z")}))));c.close();}
        else if(calls===2){c.enqueue(new TextEncoder().encode(wire(frame({TEST:trade(5,"2026-11-09T15:00:00.000000001Z")},{kind:"snapshot"}))+wire(frame({TEST:trade(7,"2026-11-09T15:00:00.000000003Z")}))));markReconnected();}
        else{c.enqueue(new TextEncoder().encode(wire(frame({OTHER:trade(8)}))));}
      },cancel(){canceled++;}}),{headers:{"content-type":"text/event-stream"}});
    }});
  try{
    await provider.start([{symbol:"TEST",active:true}],u=>updates.push(u.lastPrice));
    await reconnected;await turn();
    assert.deepEqual(updates,[6,7]);assert.equal(calls,2);
    await provider.start([{symbol:"OTHER",active:true}],u=>updates.push(u.lastPrice));await turn();
    assert.deepEqual(subscriptions,[["TEST"],["TEST"],["OTHER"]]);
    assert.deepEqual(updates,[6,7,8]);assert.equal(canceled,1);
  }finally{await provider.stop();}
  assert.equal(canceled,2);
});


const neutralFrame=(values:Record<string,unknown>={},extra:Record<string,unknown>={})=>({schema:"traderslink.market.1",resource:"price-updates",data:{revision:1,coverage:"consolidated",online:true,change:"delta",emitted:now,values,...extra}});
const neutralTrade=(price=5,observed="2026-11-09T15:00:00.000000003Z")=>({value:price,observed,received:now});

test("neutral complete frames retain nanosecond ordering and original atomic validation",()=>{
  const parsed=parseWatchlistPriceFrame(JSON.stringify(neutralFrame({TEST:neutralTrade()})),new Set(["TEST"]),now,true);
  assert.deepEqual(parsed,{connected:true,trades:[{symbol:"TEST",price:5,timestamp:now,order:BigInt(now)*1000000n+3n}]});
  for(const bad of [neutralFrame({TEST:neutralTrade(),OTHER:neutralTrade()}),neutralFrame({TEST:neutralTrade()},{coverage:"iex"}),
    neutralFrame({TEST:neutralTrade()},{online:false}),neutralFrame({TEST:neutralTrade()},{change:"status"}),
    neutralFrame({TEST:neutralTrade()},{emitted:now-13000}),neutralFrame({TEST:neutralTrade(-1)}),
    neutralFrame({TEST:{value:5,received:now}}),{...neutralFrame(),schema:"other"},frame({TEST:trade()})]){
    assert.throws(()=>parseWatchlistPriceFrame(JSON.stringify(bad),new Set(["TEST"]),now,true));
  }
  assert.throws(()=>parseWatchlistPriceFrame(JSON.stringify(neutralFrame({TEST:neutralTrade()})),new Set(["TEST"]),now));
});

test("neutral SSE keeps the existing UTF8/CRLF parser, status frames and cancellation",async()=>{
  const parent=new AbortController();const received:{connected:boolean;prices:number[]}[]=[];let canceled=0;
  const text=": résumé 📈\r\n\r\n"+(wire(neutralFrame({}, {change:"status"}))+wire(neutralFrame({TEST:neutralTrade()},{change:"snapshot"}))+wire(neutralFrame({TEST:neutralTrade(6)}))).replaceAll("\n","\r\n");
  const bytes=new TextEncoder().encode(text);
  const response=new Response(new ReadableStream({start(c){for(let n=0;n<bytes.length;n++)c.enqueue(bytes.subarray(n,n+1));},cancel(){canceled++;}}),{headers:{"content-type":"text/event-stream"}});
  await assert.rejects(consumeWatchlistPriceStream({symbols:["TEST"],signal:parent.signal,now:()=>now,wire:true,open:async()=>response,
    onFrame:f=>{received.push({connected:f.connected,prices:f.trades.map(t=>t.price)});if(received.length===3)parent.abort();}}));
  assert.deepEqual(received,[{connected:true,prices:[]},{connected:true,prices:[5]},{connected:true,prices:[6]}]);
  assert.equal(canceled,1);
});

test("actual neutral provider freezes its transport per instance and replaces rather than duplicates subscriptions",async()=>{
  const previous={...process.env};let canceled=0;const updates:number[]=[];const calls:{url:string;body:unknown}[]=[];
  try{
    process.env.TRADERLINK_GATEWAY_CONTRACT="traderslink.market.1";
    const provider=new AlpacaRuntimeLivePriceProvider({url:"https://gateway.example/private/",token:"offline",now:()=>now,
      fetcher:async(url,options)=>{
        calls.push({url:String(url),body:JSON.parse(String(options?.body))});
        assert.equal(options?.method,"POST");assert.equal(options?.redirect,"error");assert.equal(options?.cache,"no-store");
        assert.equal(new Headers(options?.headers).get("accept"),"text/event-stream");assert.equal(new Headers(options?.headers).get("authorization"),"Bearer offline");
        const ticker=calls.length===1?"TEST":"OTHER";
        const events=neutralFrame({[ticker]:neutralTrade(calls.length===1?5:7)});
        return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(wire(events)));},cancel(){canceled++;}}),{headers:{"content-type":"text/event-stream"}});
      }});
    delete process.env.TRADERLINK_GATEWAY_CONTRACT;
    try{
      await provider.start([{symbol:"TEST",active:true},{symbol:"INACTIVE",active:false}],u=>updates.push(u.lastPrice));await turn();
      assert.deepEqual(updates,[5]);assert.equal(calls.length,1);
      await provider.start([{symbol:"OTHER",active:true}],u=>updates.push(u.lastPrice));await turn();
      assert.deepEqual(updates,[5,7]);assert.equal(canceled,1);
      assert.deepEqual(calls,[{url:"https://gateway.example/private/traderslink/v1/market/price-updates",body:{tickers:["TEST"]}},{url:"https://gateway.example/private/traderslink/v1/market/price-updates",body:{tickers:["OTHER"]}}]);
      assert.deepEqual(provider.getFeedHealth(),{connected:true,checkedAt:now});
    }finally{await provider.stop();}
    assert.equal(canceled,2);
  }finally{process.env=previous;}
});

test("neutral stream failure cancels once without a second or legacy request",async()=>{
  let calls=0,canceled=0;const received:unknown[]=[];
  const response=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(wire(neutralFrame({TEST:neutralTrade(),OTHER:neutralTrade()}))));},cancel(){canceled++;}}),{headers:{"content-type":"text/event-stream"}});
  await assert.rejects(consumeWatchlistPriceStream({symbols:["TEST"],signal:new AbortController().signal,now:()=>now,wire:true,open:async()=>{calls++;return response;},onFrame:f=>received.push(f)}));
  assert.deepEqual(received,[]);assert.equal(calls,1);assert.equal(canceled,1);
});
