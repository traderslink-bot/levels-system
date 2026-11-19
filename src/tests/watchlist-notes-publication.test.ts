import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WatchlistNotesPublication, notesHash } from "../lib/alerts/watchlist-notes-publication.js";
import { DiscordConfirmedRejection } from "../lib/alerts/discord-confirmed-rejection.js";

function fixture() {
  const directory=mkdtempSync(join(tmpdir(),'notes-publication-test-'));
  const state={active:true,cycleId:'cycle',group:'main',listed:true};
  let now=1000, writes=0,sends=0,failWebsite=false,failDiscord:unknown=null,draft='',published='';
  const sent:unknown[]=[];
  const ports={current:()=>({...state}),saveDraft:(_s:string,text:string)=>{draft=text;},publish:async(_s:string,text:string)=>{writes++;if(failWebsite)throw Error('synthetic unavailable');published=text;},
    send:async(input:unknown)=>{sends++;sent.push(input);if(failDiscord)throw failDiscord;return{channelId:'100000000000000001',messageId:'100000000000000002'};}};
  let service=new WatchlistNotesPublication(ports,directory,()=>now);
  const input={symbol:'TEST',cycleId:'cycle',actor:'platform-owner:test',text:'My notes',id:'10000000-0000-4000-8000-000000000001',notifyUsers:true};
  return {state,input,sent,get service(){return service;},reopen:()=>service=new WatchlistNotesPublication(ports,directory,()=>now),get writes(){return writes;},get sends(){return sends;},get draft(){return draft;},get published(){return published;},websiteFails:(v:boolean)=>failWebsite=v,discordFails:(v:unknown)=>failDiscord=v,tick:()=>now+=1000,close:()=>rmSync(directory,{recursive:true,force:true})};
}

test('notes publish and notify are separate; same operation resumes without another publication or send',async()=>{
 const f=fixture();try{
  const result=await f.service.publish(f.input);assert.equal(result.published,true);assert.equal(f.writes,1);assert.equal(f.sends,0);
  assert.equal(f.service.status('TEST',f.input.id,f.input.actor)?.textHash,notesHash('My notes'));
  f.reopen();await f.service.publish(f.input);assert.equal(f.writes,1);
  await Promise.all([f.service.send('TEST',f.input.id,f.input.actor),f.service.send('TEST',f.input.id,f.input.actor)]);
  assert.equal(f.sends,1);assert.equal(f.service.status('TEST',f.input.id,f.input.actor)?.discord,'sent');
  assert.match((f.sent[0] as any).content,/^## TEST Trader notes updated by "This Guy"/);
  assert.equal((f.sent[0] as any).attachments,undefined);assert.equal(f.service.receipts('TEST','cycle','main').length,1);
 }finally{f.close();}
});
test('silent and empty notes publish without any notification',async()=>{
 const f=fixture();try{
  await f.service.publish({...f.input,notifyUsers:false});assert.equal(f.service.status('TEST',f.input.id,f.input.actor)?.discord,'skipped');
  await assert.rejects(f.service.send('TEST',f.input.id,f.input.actor));assert.equal(f.sends,0);
  f.tick();await f.service.publish({...f.input,id:'20000000-0000-4000-8000-000000000002',text:'  '});assert.equal(f.published,'  ');assert.equal(f.sends,0);
 }finally{f.close();}
});
test('website failure preserves draft, produces no sendable receipt, then resumes',async()=>{
 const f=fixture();try{f.websiteFails(true);await assert.rejects(f.service.publish(f.input));assert.equal(f.draft,'My notes');assert.equal(f.service.status('TEST',f.input.id,f.input.actor)?.published,false);await assert.rejects(f.service.send('TEST',f.input.id,f.input.actor));assert.equal(f.sends,0);f.websiteFails(false);await f.service.publish(f.input);assert.equal(f.published,'My notes');}finally{f.close();}
});
test('uncertain Discord delivery is not blindly repeated, including after restart',async()=>{
 const f=fixture();try{await f.service.publish(f.input);f.discordFails(Error('timeout'));await f.service.send('TEST',f.input.id,f.input.actor);f.reopen();await f.service.send('TEST',f.input.id,f.input.actor);assert.equal(f.sends,1);assert.equal(f.service.status('TEST',f.input.id,f.input.actor)?.discord,'uncertain');}finally{f.close();}
});
test('confirmed Discord cooldown is honored; retry does not republish notes',async()=>{
 const f=fixture();try{await f.service.publish(f.input);f.discordFails(new DiscordConfirmedRejection(429,{retryAt:2000,scope:'test',reason:'synthetic'}));await f.service.send('TEST',f.input.id,f.input.actor);await f.service.send('TEST',f.input.id,f.input.actor);assert.equal(f.sends,1);f.tick();f.discordFails(null);await f.service.send('TEST',f.input.id,f.input.actor);assert.equal(f.sends,2);assert.equal(f.writes,1);}finally{f.close();}
});
test('changed operation body or actor is rejected without overwriting saved notes',async()=>{
 const f=fixture();try{await f.service.publish(f.input);for(const change of [{text:'different'},{actor:'other'},{cycleId:'other'},{notifyUsers:false}])await assert.rejects(f.service.publish({...f.input,...change}));assert.equal(f.published,'My notes');assert.equal(f.writes,1);assert.equal(f.service.status('TEST',f.input.id,'other'),null);}finally{f.close();}
});
test('private, unlisted, removed, moved and reactivated tickers cannot send stale notes alerts',async()=>{
 for(const change of [{active:false},{cycleId:'new'},{group:'private'},{group:'postmarket'}]){const f=fixture();try{await f.service.publish(f.input);Object.assign(f.state,change);await f.service.send('TEST',f.input.id,f.input.actor);assert.equal(f.sends,0);assert.equal(f.service.status('TEST',f.input.id,f.input.actor)?.discord,'cancelled');}finally{f.close();}}
 const f=fixture();try{f.state.listed=false;await assert.rejects(f.service.publish(f.input));f.state.listed=true;f.state.group='private';await assert.rejects(f.service.publish(f.input));assert.equal(f.writes,0);}finally{f.close();}
});
test('newer notes supersede pending alerts and old retries never restore old text',async()=>{
 const f=fixture();try{await f.service.publish(f.input);f.tick();await f.service.publish({...f.input,id:'20000000-0000-4000-8000-000000000002',text:'New note',notifyUsers:false});await f.service.send('TEST',f.input.id,f.input.actor);assert.equal(f.sends,0);await f.service.publish(f.input);assert.equal(f.published,'New note');assert.equal(f.writes,2);}finally{f.close();}
});

test('notes receipts participate in optional move cleanup without changing a move or analysis approval',async()=>{
 const {CategoryMoveService}=await import('../lib/alerts/watchlist-category-move-service.js');
 const {randomUUID}=await import('node:crypto');
 const receipt={channelId:'100000000000000001',messageId:'100000000000000002'};
 const entry={active:true,watchlistGroup:'main',publicationReview:{cycleId:'notes-cleanup-test'}};
 let sent=0;
 const service=new CategoryMoveService({entry:()=>entry,review:()=>null,additionalReceipts:(_symbol,cycle,group)=>{assert.equal(cycle,'notes-cleanup-test');assert.equal(group,'main');return[receipt];},place:async(_symbol,group)=>{entry.watchlistGroup=group;},send:async()=>{sent++;return receipt;},verify:async()=>receipt});
 const result=await service.execute({id:randomUUID(),symbol:'NOTES',to:'postmarket',notify:false,deleteSource:false,actor:'platform-owner:test'});
 assert.equal(entry.watchlistGroup,'postmarket');assert.equal(sent,0);assert.deepEqual(result.cleanup.map(job=>job.receipt),[receipt]);assert.ok(service.removalReceipts('NOTES','notes-cleanup-test').some(item=>item.messageId===receipt.messageId));
});

test('an older failed publish cannot overwrite a newer note even with identical timestamps',async()=>{
 const f=fixture();try{f.websiteFails(true);await assert.rejects(f.service.publish(f.input));f.websiteFails(false);await f.service.publish({...f.input,id:'20000000-0000-4000-8000-000000000002',text:'Newer note'});await assert.rejects(f.service.publish(f.input));assert.equal(f.published,'Newer note');}finally{f.close();}
});
