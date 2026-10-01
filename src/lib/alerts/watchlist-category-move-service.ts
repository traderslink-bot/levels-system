import { CategoryMoveStore } from "./watchlist-category-move-store.js";
import { advanceCategoryMove, newCategoryMove, type MoveReceipt } from "./watchlist-category-move-state.js";
import { categoryMoveCopy, categoryMoveLabel, sourceCategoryReceipts } from "./watchlist-category-move-receipts.js";
import { appendDiscordMentions, currentDiscordAudience } from "./watchlist-discord-mentions.js";
import { buildWatchlistDiscordLinkMessage } from "./watchlist-discord-link-message.js";
import { DiscordConfirmedRejection } from "./discord-confirmed-rejection.js";
import { DiscordPreparationFailure } from "./discord-preparation-failure.js";
import { queueCategoryMoveRemovals } from "./watchlist-discord-removal.js";
import type { ReviewState } from "../ai/traderslink-ai-read-review-store.js";

type Entry={active:boolean;watchlistGroup?:string;publicationReview?:{cycleId?:string}};
type Ports={entry:(symbol:string)=>Entry|undefined;review:(symbol:string)=>ReviewState|null;place:(symbol:string,group:string)=>Promise<unknown>;
 send:(input:{symbol:string;watchlistGroup:string;content:string;deliveryKey:string;audience:{everyone:boolean;roles:string[]}})=>Promise<MoveReceipt>;
 verify:(input:{symbol:string;watchlistGroup:string;content:string;deliveryKey:string},messageId:string,at:number)=>Promise<MoveReceipt>};
const locks=new Map<string,Promise<unknown>>();
export class CategoryMoveService{
 constructor(private readonly ports:Ports,private readonly store=new CategoryMoveStore()){}
 analysisNote(symbol:string,cycleId:string,after:number){const move=this.store.read(symbol).at(-1),entry=this.ports.entry(symbol);return entry?.active&&move&&move.cycleId===cycleId&&(entry.watchlistGroup??'main')===move.to&&move.from!==move.to&&move.placement==='complete'&&move.createdAt>after?`Now on ${categoryMoveLabel(move.to)}.`:'';}
 removalReceipts(symbol:string,cycleId:string|undefined){return this.store.read(symbol).filter(move=>move.cycleId===cycleId&&move.destinationReceipt).map(move=>move.destinationReceipt!);}
 async recordLateReceipt(symbol:string,cycleId:string,group:string,receipt:MoveReceipt){
  const previous=locks.get(symbol)??Promise.resolve();
  const operation=previous.catch(()=>{}).then(async()=>{
   const entry=this.ports.entry(symbol);
   if(!entry?.active||entry.publicationReview?.cycleId!==cycleId){queueCategoryMoveRemovals(symbol,[receipt]);return;}
   const move=this.store.read(symbol).at(-1);
   if(!move||move.cycleId!==cycleId||!move.notify||!move.published||move.from!==group||move.from===move.to||entry.watchlistGroup!==move.to)return;
   if(!move.cleanup.some(job=>job.receipt.channelId===receipt.channelId&&job.receipt.messageId===receipt.messageId)){
    move.cleanup.push({receipt,state:'pending'});this.store.save(move);
   }
   if(move.destination==='confirmed')await this.run({symbol,id:move.id,to:move.to,notify:move.notify,actor:move.actor});
  });locks.set(symbol,operation);
  try{await operation;}finally{if(locks.get(symbol)===operation)locks.delete(symbol);}
 }
 status(symbol:string){const entry=this.ports.entry(symbol),moves=this.store.read(symbol);return moves.map(move=>({id:move.id,symbol:move.symbol,cycleId:move.cycleId,to:move.to,createdAt:move.createdAt,placement:move.placement,destination:move.destination,notification:move.notification,notice:move.notice,
  current:Boolean(entry?.active&&moves.at(-1)?.id===move.id&&(!entry.publicationReview?.cycleId||entry.publicationReview.cycleId===move.cycleId)&&(entry.watchlistGroup??'main')===move.to),
  cleanupFailed:move.cleanup.some(job=>job.state==='failed'),notify:move.notify,published:move.published}));}
 async execute(input:{symbol:string;id:string;to:string;notify:boolean;actor:string;messageId?:string}){
  const symbol=input.symbol.trim().toUpperCase();
  const previous=locks.get(symbol)??Promise.resolve();
  const operation=previous.catch(()=>{}).then(()=>this.run({...input,symbol}));locks.set(symbol,operation);
  try{return await operation;}finally{if(locks.get(symbol)===operation)locks.delete(symbol);}
 }
 private async run(input:{symbol:string;id:string;to:string;notify:boolean;actor:string;messageId?:string}){
  categoryMoveCopy(input.symbol,input.to); // Validate before changing placement.
  let move=this.store.get(input.symbol,input.id);
  const entry=this.ports.entry(input.symbol);
  if(!entry?.active)throw Error('Ticker is no longer active.');
  if(move&&(move.to!==input.to||move.notify!==input.notify||move.actor!==input.actor))throw Error('Move request identity changed.');
  if(!move){
   const review=this.ports.review(input.symbol);
   const acknowledged=new Set((review?.events??[]).filter(event=>event.body.kind==='delivery'&&event.body.channel==='website'&&event.body.status==='acknowledged').map(event=>event.body.kind==='delivery'?event.body.approvalRevision:-1));
   const approval=review?.events.filter(event=>event.body.kind==='approve'&&acknowledged.has(event.revision)).at(-1);
   const from=entry.watchlistGroup??'main',copy=categoryMoveCopy(input.symbol,input.to),audience=currentDiscordAudience();
   const linked=buildWatchlistDiscordLinkMessage(input.symbol);
   const content=appendDiscordMentions(copy.title+'\n'+copy.body+linked.slice(linked.indexOf('\n\n')),audience);
   const oldMoves=this.store.read(input.symbol).filter(item=>item.cycleId===entry.publicationReview?.cycleId&&item.to===from&&item.destinationReceipt).map(item=>item.destinationReceipt!);
   move={...newCategoryMove({id:input.id,symbol:input.symbol,cycleId:entry.publicationReview?.cycleId??input.id,from,to:input.to,content,createdAt:Date.now(),notify:input.notify,published:Boolean(approval)},[...sourceCategoryReceipts(review,from),...oldMoves]),actor:input.actor,audience,approvalRevision:approval?.revision??null};
   this.store.save(move);
  }
  const fixed=move;
  const current=()=>{const value=this.ports.entry(input.symbol),last=this.store.read(input.symbol).at(-1);return Boolean(value?.active&&last?.id===fixed.id&&(!value.publicationReview?.cycleId||value.publicationReview.cycleId===fixed.cycleId)&&((value.watchlistGroup??'main')===fixed.from||(value.watchlistGroup??'main')===fixed.to));};
  if(input.messageId&&current()&&['sending','uncertain'].includes(move.destination)){
   const receipt=await this.ports.verify({symbol:move.symbol,watchlistGroup:move.to,content:move.content,deliveryKey:'category-move:'+move.id},input.messageId,move.createdAt);
   move={...move,destination:'confirmed',destinationReceipt:receipt};this.store.save(move);
  }
  const result=await advanceCategoryMove(move,{
   current,save:state=>this.store.save({...fixed,...state}),place:async()=>{await this.ports.place(fixed.symbol,fixed.to);},
   send:()=>this.ports.send({symbol:fixed.symbol,watchlistGroup:fixed.to,content:fixed.content,deliveryKey:'category-move:'+fixed.id,audience:fixed.audience}),
   // This durable marker is consumed by the Platform's independent member outbox.
   notify:async()=>{},remove:deleteCategoryMoveMessage,
   definitelyNotSent:error=>error instanceof DiscordPreparationFailure||error instanceof DiscordConfirmedRejection,
   retryAfter:error=>error instanceof DiscordConfirmedRejection?error.rateLimit?.retryAt:undefined,
  });
  const latest=this.ports.entry(input.symbol);
  if(result.destinationReceipt&&(!latest?.active||latest.publicationReview?.cycleId!==fixed.cycleId))queueCategoryMoveRemovals(input.symbol,[result.destinationReceipt]);
  return {...result,notice:result.destination==='skipped'?'Ticker moved. No notifications sent.':result.notice};
 }
}
async function deleteCategoryMoveMessage(receipt:MoveReceipt){
 if(!/^\d{17,20}$/.test(receipt.channelId)||!/^\d{17,20}$/.test(receipt.messageId))throw Error('Invalid saved receipt.');
 const token=process.env.DISCORD_BOT_TOKEN?.trim();if(!token)throw Error('Discord bot connection unavailable.');
 const response=await fetch(`https://discord.com/api/v10/channels/${receipt.channelId}/messages/${receipt.messageId}`,{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:`Bot ${token}`}});
 if(response.status===404){const body=await response.json() as {code?:number};if(body.code===10008)return;}
 if(!response.ok)throw Error('Discord deletion was not confirmed.');
}
