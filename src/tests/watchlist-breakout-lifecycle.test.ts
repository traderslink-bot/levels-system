import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WatchlistBreakoutLifecycle, omitFollowupBreakout, publishedBreakoutPrice } from "../lib/ai/watchlist-breakout-lifecycle.js";
function fixture(){const dir=mkdtempSync(join(tmpdir(),'breakout-lifecycle-test-'));return{dir,store:new WatchlistBreakoutLifecycle(dir),close:()=>rmSync(dir,{recursive:true,force:true})};}
test('only a strict post-publication price cross consumes the original breakout',()=>{
 const f=fixture();try{const s=f.store;s.register('activation','TEST',2,1000);for(const [price,at]of[[2.1,999],[2,1100],[1.99,1200],[NaN,1300],[Infinity,1400]])s.observe('activation',price!,at!);assert.equal(s.crossed('activation'),undefined);s.observe('activation',2.01,1500,1400);assert.equal(s.crossed('activation'),undefined);s.observe('activation',2.01,1500);assert.deepEqual(s.crossed('activation'),{originalPrice:2,crossedAt:1500});}finally{f.close();}
});
test('re-entry, a session/day change, moves and restarts never rearm the consumed activation',()=>{
 const f=fixture();try{f.store.register('same-activation','TEST',2,1000);f.store.observe('same-activation',2.1,2000);f.store.observe('same-activation',1.5,90000000);f.store.register('same-activation','TEST',3,90000100);const restarted=new WatchlistBreakoutLifecycle(f.dir);assert.deepEqual(restarted.crossed('same-activation'),{originalPrice:2,crossedAt:2000});}finally{f.close();}
});
test('true reactivation is independent even when the ticker is identical',()=>{
 const f=fixture();try{f.store.register('activation-1','TEST',2,1000);f.store.observe('activation-1',3,2000);f.store.register('activation-2','TEST',4,3000);assert.equal(f.store.crossed('activation-2'),undefined);f.store.observe('activation-2',4.1,4000);assert.equal(f.store.crossed('activation-2')?.originalPrice,4);}finally{f.close();}
});
test('existing completed bars recover a missed cross without using overlapping, incomplete or future bars',()=>{
 const f=fixture();try{f.store.register('activation','TEST',2,90000);f.store.observeBars('activation',[{timestamp:60000,high:3},{timestamp:180000,high:3},{timestamp:NaN,high:3}],60000,200000);assert.equal(f.store.crossed('activation'),undefined);f.store.observeBars('activation',[{timestamp:120000,high:2.1}],60000,200000);assert.deepEqual(f.store.crossed('activation'),{originalPrice:2,crossedAt:180000});}finally{f.close();}
});
test('unpublished, empty and owner-hidden breakout fields do not become a tracking level',()=>{
 assert.equal(publishedBreakoutPrice({analysisFormat:'simple',simpleAnalysis:{breakout:null}}),null);assert.equal(publishedBreakoutPrice({breakoutContinuation:{price:2},ownerHiddenSections:['breakoutContinuation']}),null);assert.equal(publishedBreakoutPrice({analysisFormat:'simple',simpleAnalysis:{breakout:{price:2}}}),2);assert.equal(publishedBreakoutPrice({breakoutContinuation:{price:2}}),2);
});
test('generation projection removes only the breakout in both formats and leaves owner data immutable',()=>{
 const read={breakoutContinuation:{price:2,rationale:'New breakout'},simpleAnalysis:{setup:'Current trade',breakout:{price:2},pullbacks:[{low:1.5,high:1.6}],upside:[{low:3,high:3.1}]},targets:[{label:'Breakout level',price:2,condition:'Observed level'},{label:'Target',price:3,condition:'Volume'}],riskSummary:['Risk'],catalystRealityCheck:{summary:'News'}};
 const original=JSON.stringify(read);assert.equal(omitFollowupBreakout(read),read);
 const result=omitFollowupBreakout(read,{originalPrice:1.8,crossedAt:1000});assert.equal(result.breakoutContinuation.price,null);assert.equal(result.simpleAnalysis.breakout,null);assert.deepEqual(result.simpleAnalysis.pullbacks,read.simpleAnalysis.pullbacks);assert.deepEqual(result.simpleAnalysis.upside,read.simpleAnalysis.upside);assert.deepEqual(result.riskSummary,read.riskSummary);assert.deepEqual(result.catalystRealityCheck,read.catalystRealityCheck);assert.deepEqual(result.targets.map(t=>t.price),[2,3]);assert.equal(result.targets[0]!.label,'Potential target');assert.equal(JSON.stringify(read),original);
});


test('actual runtime methods recover only acknowledged history and track the raw published card without changing review heads',async()=>{
 const {ManualWatchlistRuntimeManager}=await import('../lib/monitoring/manual-watchlist-runtime-manager.js');
 const f=fixture();try{
  const entry={symbol:'TEST',active:true,activatedAt:1000,indicatorPublicationIdentity:'activation',lastPrice:1.8,lastPriceUpdateAt:4000,publicationReview:{cycleId:'current'}};
  const saved={analysisFormat:'simple',simpleAnalysis:{breakout:{price:2}},breakoutContinuation:{price:2,rationale:'Range'}};
  const prior={cycleId:'prior',events:[{revision:1,actor:'owner',body:{kind:'begin'}},{revision:2,body:{kind:'approve',publication:{website:{cards:{tradersLinkAiRead:{body:JSON.stringify(saved)}}}}}},{revision:3,at:3000,body:{kind:'delivery',channel:'website',status:'acknowledged',approvalRevision:2}}]};
  const current={cycleId:'current',events:[{revision:1,actor:'runtime:private:prior',body:{kind:'begin'}}]};
  const runtime=Object.assign(Object.create(ManualWatchlistRuntimeManager.prototype),{breakoutLifecycle:f.store,breakoutSeeded:new Set(),breakoutWarnings:new Set(),watchlistStore:{getEntry:()=>entry},options:{now:()=>5000,tradersLinkAiReadReviewStore:{read:(id:string)=>id==='prior'?prior:current}}});
  assert.equal(runtime.crossedPublishedBreakout('TEST'),undefined);entry.lastPrice=2.1;entry.lastPriceUpdateAt=4500;
  assert.deepEqual(runtime.crossedPublishedBreakout('TEST'),{originalPrice:2,crossedAt:4500});
  runtime.rememberPublishedBreakout({symbol:'TEST',cards:{tradersLinkAiRead:{body:JSON.stringify({...saved,simpleAnalysis:{breakout:{price:3}}})}}});
  assert.equal(runtime.crossedPublishedBreakout('TEST').originalPrice,2);assert.equal(prior.events.length,3);assert.equal(current.events.length,1);
  entry.indicatorPublicationIdentity='new-activation';entry.activatedAt=5000;entry.lastPrice=3;entry.lastPriceUpdateAt=5000;
  assert.equal(runtime.crossedPublishedBreakout('TEST'),undefined);
  runtime.rememberPublishedBreakout({symbol:'TEST',cards:{tradersLinkAiRead:{body:JSON.stringify({...saved,simpleAnalysis:{breakout:{price:4}}})}}});
  entry.lastPrice=4.1;assert.equal(runtime.crossedPublishedBreakout('TEST').originalPrice,4);
 }finally{f.close();}
});
