import test from "node:test";
import assert from "node:assert/strict";
import { WatchlistPotentialPathCorrections } from "../lib/monitoring/watchlist-potential-path-corrections.js";
import type { RuntimeTradeRevisions } from "../lib/market-data/runtime-trade-revisions.js";
import type { LiveWatchlistCardPatch } from "../lib/live-watchlist/live-watchlist-types.js";
const card = { title:"Levels", body:"old", source:"fixture", priceWhenPosted:4, updatedAt:1 };
const snapshot: LiveWatchlistCardPatch = { symbol:"ONE", updatedAt:1, cards:{fullLadder:card,companyInfo:card} };
function harness() {
  let identity = "first", version = "a", builds = 0, unavailable = false, reject = false;
  let gate: (() => Promise<void>) | undefined;
  let result: RuntimeTradeRevisions = {feed:"sip",symbols:{}};
  const published: LiveWatchlistCardPatch[] = [];
  const monitor: WatchlistPotentialPathCorrections<string> = new WatchlistPotentialPathCorrections({
    active:()=>["ONE","TWO"],identity:()=>identity,basis:()=>version,enabled:()=>true,now:()=>1_800_000_000_000,
    read:async scope=>{assert.deepEqual(scope.symbols,["ONE","TWO"]); if(unavailable) throw Error();return result;},
    rebuild:async (_s,_cutoff,revision)=>{builds++; await gate?.(); if(reject)throw Error(); return revision!;},
    publish:async symbol=>{published.push(monitor.project({...snapshot,symbol}) as LiveWatchlistCardPatch);},
    render:(_symbol,value)=>({levelMap:null,fullLadderCard:{...card,body:value},nearestSupportResistanceCard:null}),
  });
  return {monitor,published,builds:()=>builds, pending:(v:boolean)=>{result.symbols.ONE={pending:v,minutes:[60],revision:"a".repeat(64)};},
    global:()=>{result={...result,generation:20};}, network:()=>{unavailable=true;},fail:()=>{reject=true;},
    defer:(f:()=>Promise<void>)=>{gate=f;}, reactivate:()=>{identity="second";}, changeBasis:()=>{version="b";},
    project:()=>monitor.project(snapshot) as LiveWatchlistCardPatch };
}
test("cold and pending delivery clear only derived fields; current history rebuilds once per scoped revision", async()=>{
  const h=harness();
  assert.equal(h.project().cards.fullLadder,null);
  await h.monitor.poll(); assert.equal(h.project().cards.fullLadder?.body,"old");
  h.pending(true);await h.monitor.poll();assert.equal(h.project().cards.fullLadder,null);
  assert.deepEqual(h.project().cards.companyInfo,card); assert.equal(h.builds(),0);
  h.pending(false);await h.monitor.poll();assert.equal(h.project().cards.fullLadder?.body,"a".repeat(64));
  h.global();await h.monitor.poll();assert.equal(h.builds(),1);
  assert.equal((h.monitor.project({...snapshot,symbol:"TWO"}) as LiveWatchlistCardPatch).cards.fullLadder?.body,"old");
  h.network();await h.monitor.poll();assert.equal(h.project().cards.fullLadder,null);
});
test("incomplete history cannot replace withdrawn path; quote and owner content survive",async()=>{
  const h=harness();h.pending(false);h.fail();await h.monitor.poll();
  const quote={symbol:"ONE",type:"tickerData" as const,updatedAt:2,latestPrice:9,nearestSupport:4,nearestResistance:10};
  assert.deepEqual(h.monitor.project(quote),{...quote,pathCorrection:h.project().pathCorrection,nearestSupport:null,
    nearestResistance:null,nearestSupportLabel:null,nearestResistanceLabel:null,levelMap:null});
  const analysis={symbol:"ONE",updatedAt:2,cards:{tradersLinkAiRead:card}};
  assert.equal(h.monitor.project(analysis),analysis);
});
for(const change of ["reactivate","changeBasis"] as const) test(change+" during history read discards the old result",async()=>{
  const h=harness();h.pending(false);h.defer(async()=>{h[change]();});await h.monitor.poll();
  assert.equal(h.project().cards.fullLadder,null);
});
test("an unavailable native aggregate is held without hammering history on every poll",async()=>{
  const h=harness();h.pending(false);h.fail();await h.monitor.poll();await h.monitor.poll();
  assert.equal(h.builds(),1);
  assert.equal(h.project().pathCorrection?.held,true);
});
test("HTTP retry projects the current map after admission and preserves the original payload",async()=>{
  const { LiveWatchlistHttpPublisher }=await import("../lib/live-watchlist/live-watchlist-publisher.js");
  const sent:LiveWatchlistCardPatch[]=[];
  const h=harness();await h.monitor.poll();
  const client=new LiveWatchlistHttpPublisher({ingestUrl:"https://example.invalid",token:"fixture",
    retryAttempts:1,retryDelayMs:1,projectPotentialPath:p=>h.monitor.project(p),
    fetchImpl:async(_url,init)=>{
      sent.push(JSON.parse(String(init?.body)));
      if(sent.length===1){h.pending(true);await h.monitor.poll();return new Response(null,{status:503});}
      return new Response(null,{status:200});
    }});
  await client.publish(snapshot);
  assert.equal(sent[0].cards.fullLadder?.body,"old");assert.equal(sent[1].cards.fullLadder,null);
  assert.deepEqual(snapshot.cards.fullLadder,card);
});
