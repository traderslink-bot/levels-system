/** Pure, provider-free coverage contract. A bounded sample never proves an ATH. */
export type UpsideCoverage = {
  version: 1; symbol: string; dataAsOf: number; referencePrice: number;
  status: 'MAPPED_RESISTANCE' | 'NO_HIGHER_RESISTANCE_IN_SUPPLIED_HISTORY' | 'HISTORY_UNAVAILABLE' | 'LEGACY_UNKNOWN';
  upperRefreshPolicy: 'MAPPED_BOUNDARY' | 'WAIT_FOR_NEW_STRUCTURE' | 'DEFAULT';
  upperPrice: number | null; evidenceKey: string; provenance: 'observed' | 'owner';
  historyFirstAt: number | null; historyLastAt: number | null;
  formedAt?: number; pausedAt?:number; consumedEvidenceKey?: string; operationalRearm?: boolean;
};
type RecordValue = Record<string, unknown>;
type Bar = {timestamp?:number;dateIso?:string;open:number;high:number;low:number;close:number};
export const NO_HIGHER_TARGETS = 'No higher resistance is identified in the supplied price history.';
export const TARGET_HISTORY_UNAVAILABLE = 'Higher targets could not be determined from the available price data.';
const record = (v: unknown): RecordValue => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : {};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;
const time = (value: unknown) => {const b=record(value);return finite(b.timestamp) ? b.timestamp : typeof b.dateIso==='string' ? Date.parse(b.dateIso) : NaN;};
const dayFormatter = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York'});
const day = (n:number) => dayFormatter.format(n);
const key = (s:string) => {let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16);};

export function parseUpsideCoverage(value:unknown):UpsideCoverage|undefined {
  const v=record(value);
  if(v.version!==1 || typeof v.symbol!=='string' || !/^[A-Z0-9.^-]{1,20}$/.test(v.symbol) ||
    !positive(v.dataAsOf) || !positive(v.referencePrice) ||
    !['MAPPED_RESISTANCE','NO_HIGHER_RESISTANCE_IN_SUPPLIED_HISTORY','HISTORY_UNAVAILABLE','LEGACY_UNKNOWN'].includes(String(v.status)) ||
    !['MAPPED_BOUNDARY','WAIT_FOR_NEW_STRUCTURE','DEFAULT'].includes(String(v.upperRefreshPolicy)) ||
    !['observed','owner'].includes(String(v.provenance)) || typeof v.evidenceKey!=='string' || v.evidenceKey.length>200 ||
    !(v.upperPrice===null || positive(v.upperPrice)) ||
    ![v.historyFirstAt,v.historyLastAt].every(n=>n===null||positive(n)) ||
    (v.formedAt!==undefined&&!positive(v.formedAt)) ||
    (v.pausedAt!==undefined&&!positive(v.pausedAt)) ||
    (v.operationalRearm!==undefined&&typeof v.operationalRearm!=='boolean') ||
    (v.consumedEvidenceKey!==undefined&&(typeof v.consumedEvidenceKey!=='string'||v.consumedEvidenceKey.length>200)))return undefined;
  if(v.status==='MAPPED_RESISTANCE'&&(v.upperRefreshPolicy!=='MAPPED_BOUNDARY'||!positive(v.upperPrice)))return undefined;
  if(v.status==='NO_HIGHER_RESISTANCE_IN_SUPPLIED_HISTORY'&&(v.upperRefreshPolicy!=='WAIT_FOR_NEW_STRUCTURE'||v.upperPrice!==null))return undefined;
  if(v.status==='LEGACY_UNKNOWN'&&v.upperRefreshPolicy!=='DEFAULT')return undefined;
  if(v.status==='HISTORY_UNAVAILABLE'&&(!['DEFAULT','WAIT_FOR_NEW_STRUCTURE'].includes(String(v.upperRefreshPolicy))||v.upperPrice!==null))return undefined;
  if(v.operationalRearm===true&&v.status!=='MAPPED_RESISTANCE')return undefined;
  if(positive(v.historyFirstAt)&&positive(v.historyLastAt)&&v.historyFirstAt>v.historyLastAt)return undefined;
  const assessedAt=v.dataAsOf;
  if([v.historyFirstAt,v.historyLastAt,v.formedAt,v.pausedAt].some(n=>positive(n)&&n>assessedAt))return undefined;
  return {version:1,symbol:v.symbol,dataAsOf:v.dataAsOf,referencePrice:v.referencePrice,
    status:v.status as UpsideCoverage['status'],upperRefreshPolicy:v.upperRefreshPolicy as UpsideCoverage['upperRefreshPolicy'],
    upperPrice:v.upperPrice as number|null,evidenceKey:v.evidenceKey,provenance:v.provenance as UpsideCoverage['provenance'],
    historyFirstAt:v.historyFirstAt as number|null,historyLastAt:v.historyLastAt as number|null,
    ...(positive(v.formedAt)?{formedAt:v.formedAt}:{}),
    ...(positive(v.pausedAt)?{pausedAt:v.pausedAt}:{}),
    ...(typeof v.operationalRearm==='boolean'?{operationalRearm:v.operationalRearm}:{}),
    ...(typeof v.consumedEvidenceKey==='string'?{consumedEvidenceKey:v.consumedEvidenceKey}:{})};
}

/** Scan actual supplied bars, not a compact map or model prose. No I/O. */
export function evaluateUpsideCoverage(input:unknown):UpsideCoverage|undefined {
  const p=record(input),a=record(p.priceAction),price=p.currentPrice,at=p.dataAsOf;
  if(!positive(price)||!positive(at)||typeof p.symbol!=='string')return undefined;
  const valid=(value:unknown):value is Bar => {const b=record(value);return positive(b.high)&&positive(b.low)&&positive(b.open)&&positive(b.close)&&
    b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close)&&positive(time(b))&&time(b)<=at;};
  const dailyRaw:unknown[]=Array.isArray(a.recentDailyBars)?a.recentDailyBars:[];
  const daily=dailyRaw.filter(valid).filter(b=>day(time(b))<day(at)).sort((x,y)=>time(x)-time(y));
  const previous=daily.at(-1),first=daily[0];
  const base={version:1 as const,symbol:p.symbol.toUpperCase(),dataAsOf:at,referencePrice:price,
    historyFirstAt:first?time(first):null,historyLastAt:previous?time(previous):null,provenance:'observed' as const};
  // A usable bounded sample is not all-time coverage. Missing/invalid/stale
  // history cannot establish exhaustion. Closed sessions use the dated input.
  const unavailable=daily.length<2||dailyRaw.some(b=>!valid(b))||at-time(previous)>10*86400000||
    record(a.historicalCoverage).satisfied===false||p.historyUnavailable===true;
  if(unavailable)return {...base,status:'HISTORY_UNAVAILABLE',upperRefreshPolicy:'DEFAULT',upperPrice:null,evidenceKey:'unavailable'};
  const overhead:Array<{price:number;id:string;formedAt:number}>=daily.filter(b=>b.high>price).map(b=>({price:b.high,id:'daily:'+time(b)+':'+b.high,formedAt:time(b)}));
  const minute=record(a.oneMinuteEvidence);
  let completedIntradayBars=0,latestIntradayAt=0;
  for(const [rows,ms] of [[a.fourHourBars,14400000],[a.recentFiveMinuteBars,300000],[minute.recentOneMinuteBars,60000]] as const){
    if(!Array.isArray(rows))continue;
    const bars=(rows as unknown[]).filter(valid).filter(b=>time(b)+ms<=at).sort((x,y)=>time(x)-time(y));
    if(ms<=300000){completedIntradayBars+=bars.length;latestIntradayAt=Math.max(latestIntradayAt,...bars.map(time));}
    for(let i=0;i<bars.length;i++){
      const b=bars[i]!,next=bars[i+1],before=bars[i-1];
      // Prior-session ceilings or demonstrated local rejections, not an
      // expanding frontier with no subsequent completed rejection candle.
      if(b.high>price&&(day(time(b))<day(at)||(next&&next.high<b.high&&(!before||before.high<=b.high))))
        overhead.push({price:b.high,id:ms+':'+time(b)+':'+b.high,formedAt:day(time(b))<day(at)?time(b):time(next)+ms});
    }
  }
  overhead.sort((x,y)=>x.price-y.price||x.id.localeCompare(y.id));
  const upper=overhead[0];
  if(!upper&&(completedIntradayBars<2||at-latestIntradayAt>10*86400000))
    return {...base,status:'HISTORY_UNAVAILABLE',upperRefreshPolicy:'DEFAULT',upperPrice:null,evidenceKey:'intraday-unavailable'};
  return upper?{...base,status:'MAPPED_RESISTANCE',upperRefreshPolicy:'MAPPED_BOUNDARY',upperPrice:upper.price,evidenceKey:upper.id,formedAt:upper.formedAt}:
    {...base,status:'NO_HIGHER_RESISTANCE_IN_SUPPLIED_HISTORY',upperRefreshPolicy:'WAIT_FOR_NEW_STRUCTURE',upperPrice:null,pausedAt:at,
      evidenceKey:key(base.symbol+':'+base.historyFirstAt+':'+base.historyLastAt+':exhausted')};
}
export function targetCoverageMessage(value:unknown):string|null {
  const c=parseUpsideCoverage(value);
  return c?.status==='NO_HIGHER_RESISTANCE_IN_SUPPLIED_HISTORY'?NO_HIGHER_TARGETS:c?.status==='HISTORY_UNAVAILABLE'?TARGET_HISTORY_UNAVAILABLE:null;
}
function targetRows(read:unknown):RecordValue[] {
  const r=record(read),rows=r.analysisFormat==='simple'?record(r.simpleAnalysis).upside:r.targets;
  return Array.isArray(rows)?rows.map(record):[];
}
export function targetSignature(read:unknown):string {
  return JSON.stringify(record(read).analysisFormat==='simple'?targetRows(read).map(a=>[a.low,a.high]):targetRows(read).map(a=>a.price));
}
/** Owner decisions are authoritative, not claims of supplied candle evidence. */
export function ownerTargetCoverage(original:unknown,edited:unknown):UpsideCoverage|undefined {
  const r=record(edited),prior=parseUpsideCoverage(record(original).upsideCoverage);
  if(targetSignature(original)===targetSignature(edited))return prior;
  if(typeof r.symbol!=='string'||!positive(r.dataAsOf)||!positive(r.currentPrice))return prior;
  const reference=r.currentPrice;
  const prices=targetRows(edited).map(a=>r.analysisFormat==='simple'?a.high:a.price).filter(positive).filter(n=>n>reference);
  const base={version:1 as const,symbol:r.symbol,dataAsOf:r.dataAsOf,referencePrice:r.currentPrice,
    provenance:'owner' as const,historyFirstAt:null,historyLastAt:null,evidenceKey:key(targetSignature(edited))};
  return prices.length?{...base,status:'MAPPED_RESISTANCE',upperRefreshPolicy:'MAPPED_BOUNDARY',upperPrice:Math.max(...prices)}:
    {...base,status:'LEGACY_UNKNOWN',upperRefreshPolicy:'DEFAULT',upperPrice:null};
}
/** Preserve a credible pause on unavailable data; rearm only on distinct evidence. */
export function advanceUpsideCoverage(previous:UpsideCoverage|undefined,next:UpsideCoverage|undefined):UpsideCoverage|undefined {
  if(previous?.provenance==='owner')return previous;
  if(!next||previous&&(next.symbol!==previous.symbol||next.dataAsOf<previous.dataAsOf))return previous;
  if(previous&&next.status==='NO_HIGHER_RESISTANCE_IN_SUPPLIED_HISTORY'&&previous.historyFirstAt!==null&&next.historyFirstAt!==null&&next.historyFirstAt>previous.historyFirstAt)return previous;
  if(previous?.operationalRearm&&previous.consumedEvidenceKey!==previous.evidenceKey)return previous;
  if(previous?.upperRefreshPolicy==='WAIT_FOR_NEW_STRUCTURE'||previous?.operationalRearm){
    if(next.status==='HISTORY_UNAVAILABLE')return {...next,historyFirstAt:previous.historyFirstAt,historyLastAt:previous.historyLastAt,
      pausedAt:previous.pausedAt??previous.dataAsOf,upperRefreshPolicy:'WAIT_FOR_NEW_STRUCTURE',consumedEvidenceKey:previous.consumedEvidenceKey};
    if(next.status==='MAPPED_RESISTANCE'){
      if(next.evidenceKey===previous.consumedEvidenceKey)return previous;
      const newHistory=next.historyFirstAt!==null&&previous.historyFirstAt!==null&&next.historyFirstAt<previous.historyFirstAt;
      if(!newHistory&&(next.formedAt??0)<=(previous.pausedAt??previous.dataAsOf))return previous;
      return {...next,operationalRearm:true,consumedEvidenceKey:previous.consumedEvidenceKey};
    }
  }
  return {...next,...(previous?.upperRefreshPolicy==='WAIT_FOR_NEW_STRUCTURE'?{pausedAt:previous.pausedAt??previous.dataAsOf}:{}),
    ...(previous?.consumedEvidenceKey?{consumedEvidenceKey:previous.consumedEvidenceKey}:{})};
}
/** Live quote context never replaces the frozen AI payload. */
export type AnalysisUpsideContext={
  analysisGeneratedAt:number;analysisReferencePrice:number;targetPrices:number[];
  publicationIdentity?:string;coverage:UpsideCoverage;
};
export function parseAnalysisUpsideContext(value:unknown):AnalysisUpsideContext|undefined {
  const v=record(value),coverage=parseUpsideCoverage(v.coverage);
  if(!coverage||!positive(v.analysisGeneratedAt)||!positive(v.analysisReferencePrice)||
    !Array.isArray(v.targetPrices)||v.targetPrices.length>1000||!v.targetPrices.every(positive)||
    (v.publicationIdentity!==undefined&&(typeof v.publicationIdentity!=='string'||v.publicationIdentity.length>200)))return undefined;
  return {analysisGeneratedAt:v.analysisGeneratedAt,analysisReferencePrice:v.analysisReferencePrice,targetPrices:[...v.targetPrices],coverage,
    ...(typeof v.publicationIdentity==='string'?{publicationIdentity:v.publicationIdentity}:{})};
}
export function upsidePresentation(read:unknown,context?:unknown):{message:string|null;current:boolean} {
  const r=record(read),coverage=parseUpsideCoverage(r.upsideCoverage);
  const prices=targetRows(r).map(a=>r.analysisFormat==='simple'?a.high:a.price);
  const live=parseAnalysisUpsideContext(context);
  if(coverage?.provenance!=='owner'&&live&&live.analysisGeneratedAt===r.generatedAt&&live.analysisReferencePrice===r.currentPrice&&live.coverage.symbol===r.symbol&&
    JSON.stringify(live.targetPrices)===JSON.stringify(prices)&&live.coverage.provenance==='observed'&&live.coverage.status==='NO_HIGHER_RESISTANCE_IN_SUPPLIED_HISTORY'&&
    prices.every(n=>positive(n)&&n<=live.coverage.referencePrice))return {message:NO_HIGHER_TARGETS,current:true};
  return {message:coverage?.status==='NO_HIGHER_RESISTANCE_IN_SUPPLIED_HISTORY'?NO_HIGHER_TARGETS:!prices.length?targetCoverageMessage(coverage):null,current:false};
}
