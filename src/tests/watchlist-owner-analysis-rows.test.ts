import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyOwnerAnalysisEdit } from "../lib/ai/traderslink-ai-read-owner-edit.js";
import { parseSimpleAnalysis } from "../lib/ai/watchlist-simple-content.js";
import { analysisImageSections, splitImageSections, renderAnalysisImages } from "../lib/ai/watchlist-analysis-image.js";
import { TradersLinkAiReadReviewStore } from "../lib/ai/traderslink-ai-read-review-store.js";
import type { TradersLinkAiReadPayload } from "../lib/live-watchlist/live-watchlist-types.js";
import { ANALYSIS_REVIEW_PANEL } from "../runtime/manual-watchlist-analysis-review-panel.js";

const base=()=>({version:3,symbol:"TEST",generationId:"original",currentPrice:10,currentRead:"Original",ownerHiddenSections:[],
  needsToHold:{label:"",price:8,rationale:""},momentumFailure:{label:"",price:5,rationale:""},
  targets:[],pullbackPlans:{shallow:null,deep:null},failureRecovery:null,riskSummary:[],sources:[],
  catalystRealityCheck:{summary:"",dayTradeRelevance:"",sourceUrls:[]},usage:{totalTokens:100}} as unknown as TradersLinkAiReadPayload);
const plan=(i:number)=>({zoneLow:8-i*.01,zoneHigh:8.1-i*.01,confirmationPrice:8.2,confirmation:`Confirm ${i}`,rationale:`Plan ${i}`,hidden:i===2});
const simple=(n:number)=>({setup:"Setup",pullbacks:Array.from({length:n},(_,i)=>({low:8-i*.01,high:8.1-i*.01,explanation:`Plan ${i}`,confirmation:"Wait",invalidation:null,hidden:i===2})),upside:Array.from({length:75},(_,i)=>({low:11+i,high:11+i,explanation:`Target ${i}`})),invalidation:null});

test('detailed owner edits accept 75 targets and 12 pullbacks without altering AI provenance',()=>{
 const original=base(),before=JSON.stringify(original);
 const result=applyOwnerAnalysisEdit(original,{targets:Array.from({length:75},(_,i)=>({label:`Target ${i}`,price:11+i,condition:"Wait"})),ownerPullbacks:Array.from({length:12},(_,i)=>plan(i))});
 assert.equal(result.payload.targets.length,75);assert.equal(result.payload.ownerPullbacks!.length,12);
 assert.equal(result.payload.ownerPullbacks![2]!.hidden,true);assert.equal(result.payload.ownerPullbacks![11]!.rationale,'Plan 11');
 assert.equal(result.payload.generationId,original.generationId);assert.deepEqual(result.payload.sources,original.sources);assert.equal(JSON.stringify(original),before);
 assert.deepEqual(result.payload.ownerPullbacks![0]!.evidenceIds,[]);
});
test('simple owner edits and JSON round trip retain every row and its visibility',()=>{
 const original={...base(),analysisFormat:'simple' as const,simpleAnalysis:simple(2)};
 const result=applyOwnerAnalysisEdit(original,{simpleAnalysis:simple(12)}).payload;
 const parsed=parseSimpleAnalysis(JSON.parse(JSON.stringify(result.simpleAnalysis)));
 assert.equal(parsed!.pullbacks.length,12);assert.equal(parsed!.upside.length,75);assert.equal(parsed!.pullbacks[2]!.hidden,true);
 assert.equal(result.targets.length,75);
 assert.equal(parseSimpleAnalysis({...simple(3),pullbacks:[{...simple(1).pullbacks[0],hidden:'yes'}]}),null);
});
test('audit storage preserves original, edited and approved versions through restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'owner-rows-'));
 try {const store=new TradersLinkAiReadReviewStore(dir);const original=base();store.begin('rows','TEST',true,'owner');
  store.saveDraft({cycleId:'rows',expectedHead:1,actor:'generator',generationId:'original',payload:original as unknown as Record<string,unknown>});
  const edited=applyOwnerAnalysisEdit(original,{ownerPullbacks:Array.from({length:12},(_,i)=>plan(i))}).payload;
  const draft=store.saveDraft({cycleId:'rows',expectedHead:2,actor:'owner',payload:edited as unknown as Record<string,unknown>});
  store.approve('rows',3,draft.revision,'owner',{website:{cards:{tradersLinkAiRead:{body:JSON.stringify(edited)}}},discordChunks:['Existing links']});
  const restored=new TradersLinkAiReadReviewStore(dir).read('rows')!;
  const restoredDraft = restored.draft!.body;
  if (restoredDraft.kind !== 'edit') throw new Error('Expected the saved owner edit after restart.');
  assert.equal((restoredDraft.payload as unknown as TradersLinkAiReadPayload).ownerPullbacks!.length,12);
  assert.equal((restored.events.find(e=>e.body.kind==='original')!.body as any).payload.ownerPullbacks,undefined);
  assert.equal(restored.approved!.body.kind,'approve');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('images number extra visible pullbacks and never assign duplicate section keys',()=>{
 const read={...base(),analysisFormat:'simple' as const,simpleAnalysis:simple(12)};
 const sections=analysisImageSections(read);const plans=sections.filter(s=>s.key.startsWith('pullback-'));
 assert.equal(plans.length,11);assert.equal(new Set(plans.map(p=>p.key)).size,11);
 assert.equal(plans.at(-1)!.title,'Pullback 12');assert.ok(!plans.some(p=>p.title==='Pullback 3'));
 assert.deepEqual(splitImageSections([100,100,100],['targets','pullback-1','pullback-12']),[[0],[1,2]]);
});
test('malformed owner rows remain technical errors; trading interpretation only warns',()=>{
 assert.throws(()=>applyOwnerAnalysisEdit(base(),{ownerPullbacks:[{...plan(0),zoneLow:NaN}]}));
 assert.throws(()=>applyOwnerAnalysisEdit(base(),{ownerPullbacks:[{...plan(0),hidden:'yes'}]}));
 const result=applyOwnerAnalysisEdit(base(),{ownerPullbacks:[{...plan(0),zoneLow:9,zoneHigh:8}]});
 assert.equal(result.payload.ownerPullbacks![0]!.zoneLow,9);assert.ok(result.warnings.length);
});
test('owner row support leaves AI generation count schema unchanged',()=>{
 const source=readFileSync(new URL('../lib/ai/watchlist-simple-analysis.ts',import.meta.url),'utf8');
 assert.match(source,/pullbacks: \{ type: 'array', minItems: 0, maxItems: 2/);
 assert.match(source,/upside: \{ type: 'array', minItems: 0, maxItems: 4/);
});
test('three owner pullbacks render to the existing two social images in both formats',async()=>{
 const original={...base(),downsideCheckpoints:[],generatedAt:Date.UTC(2026,9,20,12)};
 const detailed=applyOwnerAnalysisEdit(original,{targets:[{label:'Next',price:11,condition:'With buyers'}],ownerPullbacks:[plan(0),plan(1),{...plan(2),hidden:false}]}).payload;
 const compact={...original,analysisFormat:'simple' as const,simpleAnalysis:{...simple(3),pullbacks:simple(3).pullbacks.map(p=>({...p,hidden:false})),upside:[{low:11,high:11,explanation:'With buyers'}]}};
 for(const read of [detailed,compact]) {
  const sections=analysisImageSections(read);
  assert.equal(sections.filter(s=>s.key.startsWith('pullback-')).length,3);
  const images=await renderAnalysisImages(read);
  assert.equal(images.length,2);
  for(const image of images) assert.deepEqual(Array.from(image.bytes.slice(0,8)),[137,80,78,71,13,10,26,10]);
  assert.equal(analysisImageSections(read,false).filter(s=>s.key.startsWith('pullback-')).length,0);
 }
});
test('owner saves order the third-added middle zone second in both formats and image headings',()=>{
 const original={...base(),downsideCheckpoints:[]};
 const zones=[{...plan(0),zoneLow:9,zoneHigh:9.2,rationale:'Highest'},
  {...plan(1),zoneLow:7,zoneHigh:7.2,rationale:'Deepest'},
  {...plan(0),zoneLow:8,zoneHigh:8.2,rationale:'Middle',hidden:true}];
 const detail=applyOwnerAnalysisEdit(original,{ownerPullbacks:zones}).payload;
 assert.deepEqual(detail.ownerPullbacks!.map(p=>p.zoneLow),[9,8,7]);assert.equal(detail.ownerPullbacks![1]!.hidden,true);
 const simpleOriginal={...original,analysisFormat:'simple' as const,simpleAnalysis:simple(2)};
 const saved=applyOwnerAnalysisEdit(simpleOriginal,{simpleAnalysis:{...simple(3),pullbacks:zones.map(p=>({low:p.zoneLow,high:p.zoneHigh,explanation:p.rationale,confirmation:'Wait',invalidation:null,hidden:p.hidden}))}}).payload;
 assert.deepEqual(saved.simpleAnalysis!.pullbacks.map(p=>p.low),[9,8,7]);assert.equal(saved.simpleAnalysis!.pullbacks[1]!.hidden,true);
 for(const read of [detail,saved]) {
  const sections=analysisImageSections(read).filter(s=>s.key.startsWith('pullback-'));
  assert.deepEqual(sections.map(s=>s.title),['Pullback 1','Pullback 3']);assert.match(JSON.stringify(sections[1]),/Deepest/);
 }
 assert.equal(zones[1]!.zoneLow,7);
});
test('the Runtime editor browser sorter matches price order and leaves unfinished rows last',()=>{
 const script=ANALYSIS_REVIEW_PANEL.match(/<script>([\s\S]*?)<\/script>/)![1]!;
 new Function(script);
 const sorter=script.slice(script.indexOf('function orderPullbacks('),script.indexOf('function input('));
 const rows=[{low:9,high:9.2,id:'top'},{low:7,high:7.2,id:'bottom'},{low:8,high:8.2,id:'middle',hidden:true},{low:null,high:null,id:'unfinished'}];
 new Function('rows',sorter+';orderPullbacks(rows);')(rows);
 assert.deepEqual(rows.map(p=>p.id),['top','middle','bottom','unfinished']);assert.equal(rows[1]!.hidden,true);
});
