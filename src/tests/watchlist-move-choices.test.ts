import assert from 'node:assert/strict';
import test from 'node:test';
import {advanceCategoryMove,newCategoryMove,type CategoryMove,type MovePorts} from '../lib/alerts/watchlist-category-move-state.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const receipt={channelId:'111111111111111111',messageId:'222222222222222222'};
const make=(extra:Partial<CategoryMove>={})=>newCategoryMove({id:'move',symbol:'TEST',cycleId:'current',from:'main',to:'postmarket',content:'Existing post',createdAt:1,notify:true,published:true,...extra},[receipt]);
function ports(options:{sendFailure?:boolean;deleteFailure?:boolean;current?:boolean}={}) {
 const calls:string[]=[];let saved:CategoryMove|undefined;
 const value:MovePorts={save:state=>{saved=state;},current:()=>options.current!==false,place:async()=>{calls.push('place');},send:async()=>{calls.push('send');if(options.sendFailure)throw Error('send');return {...receipt,messageId:'333333333333333333'};},notify:async()=>{calls.push('notify');},remove:async()=>{calls.push('delete');if(options.deleteFailure)throw Error('delete');},definitelyNotSent:()=>true};
 return {value,calls,saved:()=>saved};
}
test('default move retains original posts and has no Free Chat opt-in',async()=>{
 const p=ports(),result=await advanceCategoryMove(make(),p.value);
 assert.deepEqual(p.calls,['place','send','notify']);assert.equal(result.cleanup[0]!.state,'pending');assert.match(result.notice,/retained/);assert.equal(result.freeChat,undefined);
});
test('selected source deletion follows confirmed destination send',async()=>{
 const p=ports(),result=await advanceCategoryMove(make({deleteSource:true,freeChat:true}),p.value);
 assert.deepEqual(p.calls,['place','send','notify','delete']);assert.equal(result.cleanup[0]!.state,'deleted');assert.equal(result.freeChat,true);
});
test('failed destination send never deletes source posts',async()=>{
 const p=ports({sendFailure:true}),result=await advanceCategoryMove(make({deleteSource:true}),p.value);
 assert.deepEqual(p.calls,['place','send']);assert.equal(result.destination,'failed');assert.equal(result.cleanup[0]!.state,'pending');
});
test('uncertain destination never deletes source or automatically resends',async()=>{
 const p=ports(),result=await advanceCategoryMove({...make({deleteSource:true}),placement:'complete',destination:'uncertain'},p.value);
 assert.deepEqual(p.calls,[]);assert.equal(result.destination,'uncertain');
});
test('selected deletion works on a silent move without posting',async()=>{
 const p=ports(),result=await advanceCategoryMove(make({notify:false,deleteSource:true}),p.value);
 assert.deepEqual(p.calls,['place','delete']);assert.equal(result.destination,'skipped');assert.match(result.notice,/deleted/);
});
test('cleanup failure is visible and retry does not duplicate destination delivery',async()=>{
 const p=ports({deleteFailure:true}),first=await advanceCategoryMove(make({deleteSource:true}),p.value);
 assert.equal(first.cleanup[0]!.state,'failed');assert.match(first.notice,/retry cleanup/);
 const retry=ports(),result=await advanceCategoryMove(first,retry.value);
 assert.deepEqual(retry.calls,['delete']);assert.equal(result.cleanup[0]!.state,'deleted');
});
test('silent deletion failure can also retry cleanup without a notification',async()=>{
 const p=ports({deleteFailure:true}),first=await advanceCategoryMove(make({notify:false,deleteSource:true}),p.value);
 const retry=ports();await advanceCategoryMove(first,retry.value);assert.deepEqual(retry.calls,['delete']);
});
test('old or replaced activation cannot send or delete',async()=>{
 const p=ports({current:false});await advanceCategoryMove(make({deleteSource:true}),p.value);assert.deepEqual(p.calls,[]);
});
test('selecting the current category is not a move and cannot delete its posts',async()=>{
 const p=ports();const result=await advanceCategoryMove(make({to:'main',deleteSource:true}),p.value);assert.deepEqual(p.calls,['place']);assert.equal(result.cleanup.length,0);
});
test('duplicate receipts are deleted once and a completed retry does nothing',async()=>{
 const move=newCategoryMove({id:'move',symbol:'TEST',cycleId:'current',from:'main',to:'postmarket',content:'Post',createdAt:1,notify:true,published:true,deleteSource:true},[receipt,receipt]);
 const p=ports();const result=await advanceCategoryMove(move,p.value);assert.equal(result.cleanup.length,1);
 const retry=ports();await advanceCategoryMove(result,retry.value);assert.deepEqual(retry.calls,[]);
});
test('Private move deletes only selected source posts after concealment and binds retries to activation',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'move-choices-'));
 const previousDirectory=process.env.TRADERSLINK_MANUAL_WATCHLIST_DATA_DIR,previousToken=process.env.DISCORD_BOT_TOKEN,previousFetch=globalThis.fetch;
 process.env.TRADERSLINK_MANUAL_WATCHLIST_DATA_DIR=directory;process.env.DISCORD_BOT_TOKEN='synthetic-test-token';
 try {
  const {CategoryMoveService}=await import('../lib/alerts/watchlist-category-move-service.js');
  let deleted=0,sent=0,concealed=false;
  globalThis.fetch=async(_url,options)=>{assert.equal(options?.method,'DELETE');assert.equal(concealed,true);deleted++;return new Response(null,{status:204});};
  const entry={active:true,activatedAt:100,watchlistGroup:'main',publicationReview:{cycleId:'first'}};
  let review:any={events:[{revision:1,body:{kind:'approve',publication:{discordWatchlistGroup:'main'}}},{revision:2,body:{kind:'delivery',channel:'website',status:'acknowledged',approvalRevision:1}},{revision:3,body:{kind:'discord_chunk',status:'acknowledged',approvalRevision:1,receipt}}]};
  const service=new CategoryMoveService({entry:()=>entry,review:()=>review,place:async()=>{concealed=true;entry.watchlistGroup='private';entry.publicationReview.cycleId='new-private';review={events:[{actor:'runtime:private:first',body:{kind:'begin'}}]};},send:async()=>{sent++;return receipt;},verify:async()=>receipt});
  const input={symbol:'TEST',id:'12345678-1234-4123-8123-123456789abc',to:'private',notify:true,deleteSource:true,freeChat:true,actor:'owner'};
  const result=await service.execute(input);assert.equal(result.destination,'skipped');assert.equal(sent,0);assert.equal(deleted,1);assert.equal(service.status('TEST')[0]!.current,true);
  const {CategoryMoveStore}=await import('../lib/alerts/watchlist-category-move-store.js');const durable=new CategoryMoveStore(),saved=durable.get('TEST',input.id)!;
  assert.equal(saved.deleteSource,true);assert.equal(saved.freeChat,false);assert.equal(saved.activationAt,100);assert.throws(()=>durable.save({...saved,deleteSource:false}),/choices changed/);
  await service.execute(input);assert.equal(deleted,1);
  await service.recordLateReceipt('TEST','first','main',{...receipt,messageId:'444444444444444444'});assert.equal(deleted,2);
  entry.activatedAt=200;assert.equal(service.status('TEST')[0]!.current,false);await service.execute(input);assert.equal(deleted,2);
 } finally {globalThis.fetch=previousFetch;if(previousDirectory===undefined)delete process.env.TRADERSLINK_MANUAL_WATCHLIST_DATA_DIR;else process.env.TRADERSLINK_MANUAL_WATCHLIST_DATA_DIR=previousDirectory;if(previousToken===undefined)delete process.env.DISCORD_BOT_TOKEN;else process.env.DISCORD_BOT_TOKEN=previousToken;rmSync(directory,{recursive:true,force:true});}
});
test('embedded move controls are valid JavaScript and retain both choices on retry',async()=>{
 const {MANUAL_WATCHLIST_PAGE}=await import('../runtime/manual-watchlist-page.js');
 for(const [,script] of MANUAL_WATCHLIST_PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(script!);
 assert.match(MANUAL_WATCHLIST_PAGE,/Also post to Free Chat/);assert.match(MANUAL_WATCHLIST_PAGE,/Delete posts from previous channel/);
 assert.match(MANUAL_WATCHLIST_PAGE,/deleteSource:latestMove.deleteSource===true,freeChat:latestMove.freeChat===true/);
});
