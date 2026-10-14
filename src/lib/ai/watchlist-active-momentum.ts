export const SHARED_PULLBACK_SELECTION = "Pullback selection across analysis formats: identify the currently tradable advance and its subsequent structure, whether it began minutes ago, hours ago or on a previous trading day. Do not default to the largest session move, earliest launch base, newest candle or a fixed time window.\nCompare meaningful intermediate bases and separate-bar pullback/rebound sequences before choosing an older origin. Judge each area's present role from the retracement, subsequent buyer response, retests, later breaks or reclaims and participation where volume is reported. Missing volume is unknown, not zero. Recency, proximity and depth alone do not establish quality.\nA nearby area is not automatically noise: a demonstrated retracement followed by a sustained rebound may be a useful pullback even when a lower origin exists. Conversely, a brief pause or overlapping candles without a subsequent response is not automatically a defended base. Do not select, discard or widen a zone just to meet a percentage or fill two slots.\nSelect the useful nearer and lower alternatives for the same current trading context. The lower alternative is not automatically the oldest origin. If nearer structure has failed, distinguish an evidenced reclaim opportunity from still-held support. A prospective deeper retest is conditional and must not be described as already defended after the surge.\nBefore finalizing, compare your selections with meaningful omitted intermediate areas. Explain internally the concrete evidence for omitting them; 'too close', 'local shelf' or 'a deeper base exists' alone is insufficient. Use existing internal audit/evidence fields where available, not extra public sections. Retain one useful area when a second is unsupported.\nUse distinct later candles to establish a pullback, retest or rebound; a single OHLC range does not establish intrabar order. Preserve exact session scope. Keep these comparisons and candle identifiers out of public prose. Preserve supported upside coverage and the format's existing fields.";
const instruction="Active momentum scope: identify the currently tradable advance and its subsequent structure before selecting downside levels. The advance may have begun minutes or hours ago, or on a previous trading day and continued today. Do not reset it at midnight, select only the newest candle, or default to the largest full-session low-to-high range. Use the expansion, participation where reported, subsequent consolidations, pullback tests, rebounds and failed reclaims to determine which move remains active.\nneedsToHold is displayed as Structure Weakens: select the evidenced boundary whose loss would materially weaken the CURRENT active momentum setup and expose the next lower structure. This is NOT necessarily complete failure of the whole day's or multi-day move. A substantial tested pullback low followed by a rebound is not a minor shelf merely because a lower launch base exists. Explain the consequence of losing the selected area. Do not mechanically pick the nearest price or an arbitrary percentage.\ncautionBelow and momentumFailure refer to deterioration and failure of that same identified active setup; use null for redundant distinctions. Failure of this setup does not prohibit a separate deeper conditional dip/recovery scenario. Never lower these boundaries merely to keep a deeper pullback above failure. A lower setup requires fresh buyer confirmation and must not be described as keeping the failed upper setup intact.\nPullback selection: compare meaningful intermediate bases and tested pullback/rebound areas before selecting an older origin. Broader move origin is context, not a preferred deep plan. Explain why a selected deep area is relevant to the current scenario and what nearer structures must give way to reach it. Do not skip a meaningful intermediate base solely because the older origin has a catalog ID. Consider actual candle lows and subsequent rebounds as well as overlapping bodies; candidate lists are aids, not exhaustive choices. A zone is not automatically support or a guaranteed bounce. Preserve supported upside and breakout analysis independently.\nactiveMomentumContext contains bounded observed sequences, not prescribed levels. Use the full candles to verify chronology, tests, breaks and current relevance. Before returning, check that your narrative and downside choices describe the same active move: if you discuss a material tested pullback/rebound but select an older launch base as the first weakening point, explain the evidenced reason or correct the selection. Do not output this internal checklist or candle timestamps.\nChronology: one OHLC candle establishes its range, open and close, not whether its high occurred before its low. Never describe a low within a high-making candle as a subsequent pullback, post-spike unwind, retest or recovery merely from that candle. Use separate later candles (or supplied finer candles with distinct timestamps) to establish that sequence; otherwise simply call it the expansion candle's low. A rebound observation in activeMomentumContext uses separate later bars.\nSession labels: match every claimed session high/low to sessionReferencePrices for that exact trading date and scope: premarket, regular, after_hours or all_sessions. A regular-session low is not the full-day low; a local base low is not necessarily either. sessionPhaseSummaries.regular may exclude the separately summarized opening range. Daily bars and local candle windows must not silently override the wider intraday scope. When references differ, preserve their scope rather than inventing agreement. If the correct session scope cannot be established, describe the observed local level without calling it a session extreme. Apply this check to currentRead, level rationales, pullbacks and recovery prose without removing useful price levels.\nKeep public price-level rationales concise: identify the structural role and explain the future consequence of holding, losing or reclaiming it. Do not retell a historical low-to-high price journey in each rationale. Put any necessary historical sequence in currentRead and verify its distinct ordered bars. For a low that occurs more than once, a rebound must follow the specific test being described, not an earlier occurrence or the high inside the same bar. Retain detailed anchor evidence in the evidence fields, not a repeated candle narrative.";
export const PULLBACK_COMPARISON_RULES = `Selection procedure: complete pullbackSelectionAudit before the public analysis. Compare distinct useful retracement/rebound areas in the current advance in descending price order. Give each considered test its exact ID, selected or omitted decision and concrete reason. In particular evaluate every still-held intermediate rebound between your selected near area and a proposed older/deeper area. A meaningful intervening defended area is normally the second pullback; an older origin is background unless the intervening area has actually failed without recovery, is the same structure as the first area, or has materially weaker demonstrated buyer response. Merely naming the intervening level elsewhere is not a reason to skip it. Do not force two areas or select tiny pauses just to fill the list.
Treat each test as a dated event: an earlier breach at a similar price does not invalidate a later reclaimed base. Read testTime, firstBreak and laterReclaim separately; a wick through and a later close back above are observations, not automatically full setup failure or successful recovery. Use separate subsequent bars and the actual response to judge recovery. Do not use a historical failed test to dismiss a later unbroken test at a similar level.
Do not broaden a zone to the current quote just because it is the current quote. Bound it by the observed retracement/base. A currently tested area can remain useful; explain that without inventing an additional dip. Audit decisions are internal and must not appear as a public checklist.
For evidenceRefs/evidenceIds, copy exact timeframe-prefixed IDs from the supplied records, including referenceBars. Never change a 1m ID into 5m. All testTime and reboundTime labels use America/New_York and describe the candle START, not the time this request is running. Use those labels for local tests; only call a level a session high/low when the session reference confirms it. When scope is uncertain, omit the session adjective, not the useful price. No timestamps in visible prose.`;

export function withPullbackSelectionAudit(schema: any, ids: string[] = []) {
 const str={type:'string'};
 const audit={type:'object',additionalProperties:false,properties:{
  activeMove:str, comparisons:{type:'array',maxItems:16,items:{type:'object',additionalProperties:false,
   properties:{testId:str,decision:{type:'string',enum:['selected','omitted']},reason:str},required:['testId','decision','reason']}}
 },required:['activeMove','comparisons']};
 const requiredTests=Object.fromEntries([...new Set(ids)].map(id=>[id,{type:'object',additionalProperties:false,properties:{decision:{type:'string',enum:['selected','omitted']},reason:str},required:['decision','reason']}]));
 const completeAudit=ids.length?{...audit,properties:{activeMove:str,comparisons:{type:'object',additionalProperties:false,properties:requiredTests,required:Object.keys(requiredTests)}}}:audit;
 return {...schema,properties:{...schema.properties,pullbackSelectionAudit:completeAudit},required:[...new Set(['pullbackSelectionAudit',...schema.required])]};
}

/** Request-only audit: no public sections, publication gates or automatic retries. */
export function repairCandleReferences(value: any, action: any, asOf: number) {
 const ids=new Set<string>(), byTime=new Map<string,string[]>(), corrections: {from:string,to:string}[]=[], unresolved:string[]=[];
 const cols=action?.candleColumns||['timestamp','open','high','low','close','volume'];
 for(const [tf,rows] of [['1m',action?.oneMinuteEvidence?.recentOneMinuteBars],['5m',action?.recentFiveMinuteBars],['daily',action?.recentDailyBars],['4h',action?.fourHourBars]] as const) {
  for(const b of rows||[]) {const t=Array.isArray(b)?b[cols.indexOf('timestamp')]:b.timestamp;if(!Number.isFinite(t)||t>asOf)continue;const id=tf+':'+t;ids.add(id);byTime.set(String(t),[...new Set([...(byTime.get(String(t))||[]),id])]);}
 }
 const copy=structuredClone(value);
 const visit=(v:any)=>{if(!v||typeof v!=='object')return;for(const [key,item]of Object.entries(v)){
  if((key==='evidenceRefs'||key==='evidenceIds')&&Array.isArray(item))v[key]=item.map(id=>{
   if(typeof id!=='string'||! /^(1m|5m|daily|4h):\d+$/.test(id)||ids.has(id))return id;
   const alternatives=byTime.get(id.split(':')[1])||[];
   if(alternatives.length===1){corrections.push({from:id,to:alternatives[0]});return alternatives[0];}
   unresolved.push(id);return null;
  }).filter((id:any)=>id!==null);else if(Array.isArray(item))item.forEach(visit);else visit(item);
 }};
 visit(copy);return {value:copy,corrections,unresolved:[...new Set(unresolved)]};
}

export function repairResponseCandleReferences(response: any, body: any) {
 const parts=(response.output||[]).flatMap((x:any)=>x.content||[]).filter((x:any)=>x.type==='output_text');
 if(!parts.length)return {corrections:[],unresolved:[]};
 try {
  const input=JSON.parse(body.input.find((x:any)=>x.role==='user').content.find((x:any)=>x.type==='input_text').text);
  const packet=input.marketPacket;
  const result=repairCandleReferences(JSON.parse(parts.map((x:any)=>x.text).join('')),packet.priceAction,packet.dataAsOf);
  if(result.corrections.length||result.unresolved.length){parts[0].text=JSON.stringify(result.value);for(const part of parts.slice(1))part.text='';}
  return {corrections:result.corrections,unresolved:result.unresolved};
 }catch{return {corrections:[],unresolved:[]};} // Existing parser owns malformed response handling.
}

export function preparePullbackSelectionRequest(body: any) {
 const user=body.input?.find((item:any)=>item.role==='user');
 const content=user?.content?.find((item:any)=>item.type==='input_text');
 if(!content||!body.text?.format?.schema)return body;
 const input=JSON.parse(content.text),packet=input.marketPacket;
 if(!packet?.priceAction)return body;
 packet.activeMomentumContext=buildActiveMomentumContext(packet.priceAction,packet.dataAsOf);
 const ids=packet.activeMomentumContext.pullbackRebounds.map((row:any)=>row.id);
 body.text.format.schema=withPullbackSelectionAudit(body.text.format.schema,ids);
 // This instruction only explains the request's internal schema shape.
 const developer=body.input.find((item:any)=>item.role==='developer');
 const note='\nThe pullbackSelectionAudit.comparisons object requires a decision for EACH exact test ID supplied by its schema. Assess each distinct event in its own chronology, including later unbroken tests near earlier failed tests. Do not merge away a required test; give its own selected/omitted reason. Keep this entire audit internal.';
 if(typeof developer?.content==='string')developer.content+=note;
 else {const text=developer?.content?.find((item:any)=>item.type==='input_text');if(text)text.text+=note;}
 content.text=JSON.stringify(input);
 return body;
}

export function revisePrompt(text: string): string{
 const lines=text.split('\n').filter(line=>!line.startsWith('- needsToHold is a material defended base')&&!line.startsWith('- Resolve the complete dip-buy structure'));
 return lines.join('\n')
  .replace(/When broaderSessionMove and its broader_move_origin candidate are present,[^\n]*/g,'Evaluate broader-move origin alongside intervening structures without privileging it or relocating active-setup failure to accommodate it.')
  .replaceAll('At or below momentumFailure neither scenario is active.','Below active-setup failure, a lower dip plan is a distinct conditional scenario requiring new buyer confirmation, not continuation of the failed setup.')
  .replaceAll('momentumFailure is failure of the stated broader momentum structure, not every local dip or failed breakout attempt.','momentumFailure is failure of the identified active momentum setup, not automatically the oldest origin of the entire move and not every local dip or failed breakout attempt.')
  .replaceAll('Evaluate candidate bases and momentumFailure jointly before selecting the final plan: a tight provisional failure choice must not automatically exclude a structurally meaningful deeper base.','Select current-setup failure from the active structure independently of any lower conditional reset. A meaningful lower base can support a separate scenario without moving the active failure boundary.')
  .replaceAll('Select zones only from supplied pullbackCandidates and cite their exact candidate IDs.','Select zones from observed candles or supplied pullbackCandidates and cite exact supporting record IDs.')
  .replaceAll('For pullbackPlans and failureRecovery, evidenceIds must contain only IDs from pullbackCandidates; do not mix breakoutEvidence IDs into this list.','For pullbackPlans and failureRecovery, cite actual candle IDs or supported candidate IDs; candidate catalogs are not exhaustive.')
  +'\n'+instruction+'\n'+SHARED_PULLBACK_SELECTION+'\n'+PULLBACK_COMPARISON_RULES;
}
export function buildActiveMomentumContext(action: any, asOf: number){
 const clock=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const time=(timestamp:number)=>{const parts=Object.fromEntries(clock.formatToParts(timestamp).map(p=>[p.type,p.value]));const minute=Number(parts.hour)*60+Number(parts.minute);return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`,zone:'America/New_York',session:minute>=240&&minute<570?'premarket':minute>=570&&minute<960?'regular':minute>=960&&minute<1200?'after_hours':'overnight'};};
 const cols: string[]=action?.candleColumns||['timestamp','open','high','low','close','volume'];
 const bars=((action?.recentFiveMinuteBars||[]) as any[]).map(b=>Array.isArray(b)?Object.fromEntries(cols.map((k,i)=>[k,b[i]])):b).filter(b=>Number.isFinite(b.timestamp)&&b.timestamp<=asOf&&['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0)).sort((a,b)=>a.timestamp-b.timestamp);
 const tests=[];
 // Local low is an observation, not an automatic recommendation. Keep subsequent
 // breaches and rebounds visible; do not count a last-bar low as a completed test.
 for(let i=2;i<bars.length-2;i++){
  const b=bars[i];if(!(b.low<bars[i-1].low&&b.low<=bars[i-2].low&&b.low<=bars[i+1].low&&b.low<bars[i+2].low))continue;
  const after=bars.slice(i+1),window=after.slice(0,6);
  const rebound=window.reduce((best,x)=>x.high>best.high?x:best,window[0]);
  const broken=after.find(x=>x.low<b.low);
  const reclaimed=broken?after.find(x=>x.timestamp>broken.timestamp&&x.close>=b.low):null;
  tests.push({id:'5m:'+b.timestamp,low:b.low,lowAt:b.timestamp,testTime:time(b.timestamp),close:b.close,reboundHigh:rebound.high,reboundAt:rebound.timestamp,reboundId:'5m:'+rebound.timestamp,reboundTime:time(rebound.timestamp),barsToRebound:window.indexOf(rebound)+1,reportedVolume:window.reduce((n,x)=>n+(Number.isFinite(x.volume)?x.volume:0),0),volumeBarsReported:window.filter(x=>Number.isFinite(x.volume)).length,laterBrokeBelow:!!broken,firstBreak:broken?{id:'5m:'+broken.timestamp,low:broken.low,close:broken.close,time:time(broken.timestamp)}:null,laterReclaim:reclaimed?{id:'5m:'+reclaimed.timestamp,close:reclaimed.close,time:time(reclaimed.timestamp)}:null,latestClose:bars.at(-1).close});
 }
 const expansions=[];
 for(let i=1;i<bars.length;i++){const b=bars[i];const preceding=bars.slice(Math.max(0,i-6),i);const mean=preceding.reduce((n,x)=>n+x.high-x.low,0)/preceding.length;const gain=b.close-b.open;if(gain>0&&mean>0&&gain>=mean*1.5)expansions.push({id:'5m:'+b.timestamp,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,bodyRelativeToPreviousRange:gain/mean});}
 const one=(action?.oneMinuteEvidence?.recentOneMinuteBars||[]).map((b:any)=>Array.isArray(b)?Object.fromEntries(cols.map((k,i)=>[k,b[i]])):b).filter((b:any)=>Number.isFinite(b.timestamp)&&b.timestamp<=asOf&&['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0));
 const referenceBars=[...bars.slice(-24).map(b=>({id:'5m:'+b.timestamp,...time(b.timestamp),low:b.low,high:b.high})),...one.slice(-120).map((b:any)=>({id:'1m:'+b.timestamp,...time(b.timestamp),low:b.low,high:b.high}))];
 return {scope:'Observed supplied history including prior sessions; distinct events are not invalidated by earlier tests at similar prices. Session labels describe candle start, not whole-session extremes.',pullbackRebounds:tests.slice(-16),expansionBars:expansions.slice(-8),referenceBars};
}