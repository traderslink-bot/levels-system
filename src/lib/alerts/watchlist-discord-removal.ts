import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveManualWatchlistDurableDirectory } from '../monitoring/manual-watchlist-durable-storage.js';
import type { ReviewState } from '../ai/traderslink-ai-read-review-store.js';

type Job = { symbol:string; channelId:string; messageId:string; state:'pending'|'failed'; message:string };
type State = { enabled:boolean; jobs:Job[]; notice:string };
const path=()=>join(resolveManualWatchlistDurableDirectory(),'watchlist-discord-removal.json');
const id=(v:unknown):v is string=>typeof v==='string'&&/^\d{17,20}$/.test(v);
function read():State {
 if(!existsSync(path()))return {enabled:true,jobs:[],notice:''};
 const s=JSON.parse(readFileSync(path(),'utf8')) as State;
 if(typeof s.enabled!=='boolean'||!Array.isArray(s.jobs)||s.jobs.some(j=>!id(j.channelId)||!id(j.messageId)))throw Error('Deletion settings unavailable.');
 return s;
}
function save(s:State){mkdirSync(resolveManualWatchlistDurableDirectory(),{recursive:true});writeFileSync(path()+'.tmp',JSON.stringify(s),{mode:0o600});renameSync(path()+'.tmp',path());}
export function discordRemovalStatus(){try{const s=read();return {enabled:s.enabled,pending:s.jobs.filter(j=>j.state==='pending').length,failures:s.jobs.filter(j=>j.state==='failed').map(j=>({symbol:j.symbol,message:j.message})),notice:s.notice};}catch{return {enabled:false,pending:0,failures:[],notice:'Discord deletion settings are unavailable. Posts will be kept.'};}}
export function setDiscordRemoval(enabled:unknown){if(typeof enabled!=='boolean')throw Error('Choose on or off.');const s=read();s.enabled=enabled;if(!enabled)s.jobs=[];save(s);return discordRemovalStatus();}
export function removalReceipts(review:ReviewState|null){const found=new Map<string,{channelId:string;messageId:string}>();for(const e of review?.events??[]){const b=e.body;if(b.kind==='discord_chunk'&&b.status==='acknowledged'&&b.receipt&&id(b.receipt.channelId)&&id(b.receipt.messageId))found.set(b.receipt.channelId+':'+b.receipt.messageId,b.receipt);}return [...found.values()];}
export function queueDiscordRemoval(symbol:string,review:ReviewState|null){
 try{const s=read();if(!s.enabled)return;const receipts=removalReceipts(review);
 for(const r of receipts)if(!s.jobs.some(j=>j.channelId===r.channelId&&j.messageId===r.messageId))s.jobs.push({symbol,...r,state:'pending',message:''});
 if(!receipts.length)s.notice=symbol+': no saved Discord message receipts were available; no messages were deleted.';
 save(s);void drainDiscordRemovals();
 }catch{console.warn('Watchlist removed; Discord deletion could not be queued. Check Discord notifications.');}
}
let running=false;
export async function drainDiscordRemovals(transport:typeof fetch=fetch){
 if(running)return;running=true;
 try{for(let n=0;n<3;n++){
 const s=read();if(!s.enabled)return;const job=s.jobs.find(j=>j.state==='pending');if(!job)return;
 let result='';
 try{
 const token=process.env.DISCORD_BOT_TOKEN?.trim();
 if(!token)throw Error('Discord bot connection is unavailable.');
 const response=await transport(`https://discord.com/api/v10/channels/${job.channelId}/messages/${job.messageId}`,{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:`Bot ${token}`}});
 if(response.status===404){const payload=await response.json().catch(()=>null) as {code?:number}|null;if(payload?.code!==10008)result='Discord could not confirm this message was already deleted.';}
 else if(!response.ok)result='Discord could not delete the post (HTTP '+response.status+').';
 }catch{result='Discord could not delete the post. Check its connection and permissions.';}
 const latest=read();const at=latest.jobs.findIndex(j=>j.channelId===job.channelId&&j.messageId===job.messageId);if(at<0)continue;
 if(result){latest.jobs[at]={...job,state:'failed',message:result};}else latest.jobs.splice(at,1);save(latest);
 }}catch{console.warn('Discord deletion queue unavailable; no further deletions attempted.');}finally{running=false;}
}
const timer=setInterval(()=>{void drainDiscordRemovals();},30000);timer.unref();
