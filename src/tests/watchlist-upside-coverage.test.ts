import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evaluateUpsideCoverage,parseUpsideCoverage,advanceUpsideCoverage,ownerTargetCoverage,upsidePresentation,NO_HIGHER_TARGETS} from '../lib/ai/watchlist-upside-coverage.js';
import {ManualWatchlistRuntimeManager,buildTradersLinkAiReadRefreshState,decideTradersLinkAiReadRefresh,parseArchivedTradersLinkAiReadRefreshState} from '../lib/monitoring/manual-watchlist-runtime-manager.js';
import {WatchlistStore} from '../lib/monitoring/watchlist-store.js';
import {WatchlistStatePersistence,normalizeAiReadBoundaryState} from '../lib/monitoring/watchlist-state-persistence.js';
import {applyOwnerAnalysisEdit} from '../lib/ai/traderslink-ai-read-owner-edit.js';
import {analysisImageSections,renderAnalysisImages} from '../lib/ai/watchlist-analysis-image.js';
import {approvedAnalysisImages} from '../lib/ai/watchlist-analysis-image-cache.js';
import {supplementSimpleUpside} from '../lib/ai/watchlist-simple-input.js';
import {OpenAITradersLinkAiReadService} from '../lib/ai/traderslink-ai-read-service.js';
const at=Date.UTC(2026,9,28,19), bar=(timestamp:number,high=18)=>({timestamp,open:16,high,low:15,close:17,volume:1000});
const packet=(price=20)=>({symbol:'SAMPLE',currentPrice:price,dataAsOf:at,priceAction:{recentDailyBars:[bar(at-3*86400000),bar(at-86400000)],recentFiveMinuteBars:[bar(at-900000),bar(at-600000)],fourHourBars:[],oneMinuteEvidence:{recentOneMinuteBars:[]}}});
const coverage=()=>evaluateUpsideCoverage(packet())!;
function read():any {const empty={label:'',price:null,rationale:''};return {version:3,symbol:'SAMPLE',generationId:'fixture-generation',generatedAt:at,dataAsOf:at,currentPrice:20,analysisFormat:'simple',currentRead:'Current setup.',
  simpleAnalysis:{setup:'Current setup.',upside:[],pullbacks:[],breakout:null,invalidation:null},upsideCoverage:coverage(),
  needsToHold:{...empty,price:18},cautionBelow:empty,momentumFailure:empty,mustClear:{...empty,price:21},breakoutContinuation:{...empty,price:21},targets:[{price:21,label:'',condition:'Earlier high'}],downsideCheckpoints:[],
  catalystRealityCheck:{summary:'',dayTradeRelevance:'',sourceUrls:[]},riskSummary:[],sources:[],pullbackPlans:{shallow:null,deep:null},failureRecovery:null};}

test('bounded credible history, genuine raw overhead and missing/stale history are distinct; a fresh frontier is not supply',()=>{
  assert.equal(coverage().status,'NO_HIGHER_RESISTANCE_IN_SUPPLIED_HISTORY');
  const p=packet();p.priceAction.recentDailyBars[0]!.high=25;
  assert.equal(evaluateUpsideCoverage(p)?.upperPrice,25);
  assert.equal(evaluateUpsideCoverage({...p,priceAction:{recentDailyBars:[]}})?.status,'HISTORY_UNAVAILABLE');
  assert.equal(evaluateUpsideCoverage({...packet(),priceAction:{...packet().priceAction,recentFiveMinuteBars:[]}})?.status,'HISTORY_UNAVAILABLE');
  assert.equal(evaluateUpsideCoverage({...packet(),dataAsOf:at+20*86400000})?.status,'HISTORY_UNAVAILABLE');
  const frontier={...packet(),priceAction:{...packet().priceAction,recentFiveMinuteBars:[...packet().priceAction.recentFiveMinuteBars,bar(at-300000,21)]}};
  assert.equal(evaluateUpsideCoverage(frontier)?.status,'NO_HIGHER_RESISTANCE_IN_SUPPLIED_HISTORY');
  frontier.priceAction.recentFiveMinuteBars.push(bar(at-60000,19));
  frontier.dataAsOf=at+300000;
  assert.equal(evaluateUpsideCoverage(frontier)?.upperPrice,21);
  assert.equal(parseUpsideCoverage({...coverage(),version:99}),undefined);
  assert.equal(parseUpsideCoverage({...coverage(),upperRefreshPolicy:'DEFAULT'}),undefined);
});

test('all rising-price upper paths including forced automatic/fallback are paused; manual and lower remain independent',()=>{
  const previous=buildTradersLinkAiReadRefreshState(read());let requests=0;
  for(const price of [20.1,21.5,23.1,30,100])for(const force of [false,true]) {
    const result=decideTradersLinkAiReadRefresh({previous,currentPrice:price,dataAsOf:at+60000,force,requestedTrigger:'automatic'});
    if(result.shouldRefresh)requests++;assert.equal(result.shouldRefresh,false);
  }
  assert.equal(requests,0);
  assert.equal(decideTradersLinkAiReadRefresh({previous:{...previous,upperBoundary:null,boundaries:[]},currentPrice:100,dataAsOf:at+90000,force:false,requestedTrigger:'automatic'}).shouldRefresh,false);
  assert.equal(decideTradersLinkAiReadRefresh({previous,currentPrice:100,dataAsOf:at,force:true,requestedTrigger:'manual'}).shouldRefresh,true);
  assert.equal(decideTradersLinkAiReadRefresh({previous,currentPrice:17,dataAsOf:at,force:false,requestedTrigger:'automatic'}).shouldRefresh,true);
  const normal={...previous,upsideCoverage:undefined};
  assert.equal(decideTradersLinkAiReadRefresh({previous:normal,currentPrice:21.5,dataAsOf:at,force:false,requestedTrigger:'automatic'}).shouldRefresh,true);
});

test('normalizer, in-memory store, save/load, pending publication and archived recovery retain policy, counters and confirmation',()=>{
  const state={...buildTradersLinkAiReadRefreshState(read()),automaticRefreshCount:2,automaticRefreshDateKey:'2026-10-28',lastAutomaticRefreshRegime:'upper:21',pendingAutomaticBoundaryCross:{regime:'upper:21',direction:'upper' as const,boundary:21,firstObservedAt:at,lastObservedAt:at+30000,observationCount:2,furthestPrice:22,confirmationBufferPct:.01}};
  assert.deepEqual(normalizeAiReadBoundaryState(state),state);
  const store=new WatchlistStore();store.setEntries([{symbol:'SAMPLE',active:true,priority:1,tags:['manual'],discordThreadId:null,refreshPending:false,tradersLinkAiReadBoundaryState:state,pendingTradersLinkAiReadGeneration:{generationId:'fixture-generation',createdAt:at,trigger:'manual',boundaryState:state}}]);
  assert.deepEqual(store.getEntry('SAMPLE')?.tradersLinkAiReadBoundaryState,state);
  assert.deepEqual(store.getEntry('SAMPLE')?.pendingTradersLinkAiReadGeneration?.boundaryState,state);
  const dir=mkdtempSync(join(tmpdir(),'upside-coverage-'));
  try{const disk=new WatchlistStatePersistence({filePath:join(dir,'state.json'),now:()=>at});disk.save(store.getEntries());const loaded=disk.load();assert.deepEqual(loaded?.[0]?.tradersLinkAiReadBoundaryState,state);}finally{rmSync(dir,{recursive:true,force:true});}
  const archived=read();archived.needsToHold.price=null;archived.mustClear.price=null;archived.breakoutContinuation.price=null;archived.targets=[];
  assert.equal(parseArchivedTradersLinkAiReadRefreshState(JSON.stringify(archived))?.upsideCoverage?.upperRefreshPolicy,'WAIT_FOR_NEW_STRUCTURE');
});

test('only new confirmed evidence rearms, exactly its real boundary; missing data and consumed/repeated evidence do not',()=>{
  const paused=coverage(), missing=evaluateUpsideCoverage({...packet(),priceAction:{}})!;
  assert.equal(advanceUpsideCoverage(paused,missing)?.upperRefreshPolicy,'WAIT_FOR_NEW_STRUCTURE');
  const old={...paused,status:'MAPPED_RESISTANCE' as const,upperRefreshPolicy:'MAPPED_BOUNDARY' as const,upperPrice:23,formedAt:at-1,evidenceKey:'old'};
  assert.equal(advanceUpsideCoverage(paused,old),paused);
  const fresh={...old,formedAt:at+60000,dataAsOf:at+120000,evidenceKey:'new'};
  const armed=advanceUpsideCoverage(paused,fresh)!;assert.equal(armed.operationalRearm,true);
  const previous={...buildTradersLinkAiReadRefreshState(read()),upsideCoverage:armed};
  assert.equal(decideTradersLinkAiReadRefresh({previous,currentPrice:24,dataAsOf:at+180000,force:false,requestedTrigger:'automatic'}).shouldRefresh,true);
  const consumed={...armed,consumedEvidenceKey:armed.evidenceKey};
  assert.equal(decideTradersLinkAiReadRefresh({previous:{...previous,upsideCoverage:consumed},currentPrice:50,dataAsOf:at+240000,force:false,requestedTrigger:'automatic'}).shouldRefresh,false);
  assert.equal(advanceUpsideCoverage(consumed,fresh),consumed);
});

test('owner targets override intentionally, unrelated text edits preserve the pause, preview semantics stay unrestricted',()=>{
  const original=read();const patch={simpleAnalysis:{...original.simpleAnalysis,setup:'Edited explanation'}};
  assert.deepEqual(applyOwnerAnalysisEdit(original,patch).payload.upsideCoverage,original.upsideCoverage);
  const edited=applyOwnerAnalysisEdit(original,{simpleAnalysis:{...original.simpleAnalysis,upside:[{low:24,high:24,explanation:'Owner plan'}]}}).payload;
  assert.equal(edited.upsideCoverage?.provenance,'owner');assert.equal(edited.upsideCoverage?.upperPrice,24);
  assert.equal(upsidePresentation(edited).message,null);
  assert.equal(ownerTargetCoverage(edited,{...edited,simpleAnalysis:{...edited.simpleAnalysis,upside:[]}})?.status,'LEGACY_UNKNOWN');
  assert.equal(advanceUpsideCoverage(edited.upsideCoverage,coverage()),edited.upsideCoverage);
});

test('deterministic empty targets and existing-read context render without altering original, owner targets or historical images',()=>{
  const original=read(),before=JSON.stringify(original);
  assert.equal(upsidePresentation(original).message,NO_HIGHER_TARGETS);
  assert.equal(supplementSimpleUpside({upside:[{low:21,high:21}]},packet()).upside.length,0);
  const legacy={...original,upsideCoverage:undefined,simpleAnalysis:{...original.simpleAnalysis,upside:[{low:21,high:21,explanation:'Original target'}]}};
  const context={analysisGeneratedAt:at,analysisReferencePrice:20,targetPrices:[21],coverage:evaluateUpsideCoverage(packet(25))!};
  assert.equal(upsidePresentation(legacy,context).current,true);
  assert.equal(upsidePresentation(legacy,{...context,analysisGeneratedAt:at-1}).message,null);
  assert.equal(upsidePresentation(legacy,{...context,targetPrices:[22]}).message,null);
  const section=analysisImageSections(original).find(s=>s.key==='targets')!;
  assert.equal(section.blocks[0]?.text,NO_HIGHER_TARGETS);assert.equal(section.blocks.some(b=>b.kind==='price'),false);
  assert.equal(JSON.stringify(original),before);
  assert.equal(analysisImageSections({...original,ownerHiddenSections:['targets']}).some(s=>s.key==='targets'),false);
});

test('new typed approvals use their own image cache; old immutable cache and repeat receipts are not replaced',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'upside-images-'));let calls=0;
  const render=async()=>{calls++;return [{filename:'fixture.png',description:'Fixture',bytes:new Uint8Array([1,2])}]};
  const publication=(payload:any)=>({analysisImageVersion:1,website:{symbol:'SAMPLE',cards:{tradersLinkAiRead:{body:JSON.stringify(payload)}}},discordChunks:[]}) as any;
  try{const legacy={...read(),upsideCoverage:undefined};await approvedAnalysisImages(dir,1,publication(legacy),'SAMPLE',render);await approvedAnalysisImages(dir,1,publication(legacy),'SAMPLE',render);assert.equal(calls,1);
    await approvedAnalysisImages(dir,2,publication(read()),'SAMPLE',render);await approvedAnalysisImages(dir,2,publication(read()),'SAMPLE',render);assert.equal(calls,2);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('both actual service paths produce a usable code-owned empty-target read with one mocked request and no retry',async()=>{
  for(const format of ['simple','current'] as const){
    let calls=0;
    const raw=format==='simple'?{setup:'An expanding advance.',breakout:null,pullbacks:[],upside:[{low:25,high:25,explanation:'Unproven frontier'}]}:
      {...read(),analysisFormat:undefined,currentRead:'An expanding advance.',bias:'bullish',confidence:'medium',targets:[{label:'Frontier',price:25,condition:'No historical test'}]};
    const service=new OpenAITradersLinkAiReadService({apiKey:'offline-fixture-only',model:'gpt-6-luna',webSearchEnabled:false,
      fetchImpl:async()=>{calls++;return new Response(JSON.stringify({status:'completed',output_text:JSON.stringify(raw),usage:{input_tokens:100,output_tokens:100,total_tokens:200}}),{status:200});}});
    const intraday=Array.from({length:24},(_,i)=>({timestamp:at-(23-i)*300000,open:19+i*.04,close:19.02+i*.04,high:19.03+i*.04,low:18.99+i*.04,volume:10000}));
    const payload=await service.generate({analysisFormat:format,ownerReviewRequired:true,snapshot:{symbol:'SAMPLE',timestamp:at,currentPrice:20,supportZones:[],resistanceZones:[],marketStructure:null} as any,
      priceAction:{source:'Offline fixture',fetchedAt:at,priorRegularClose:17,intradayCandles:intraday,dailyCandles:Array.from({length:20},(_,i)=>bar(at-(20-i)*86400000))},
      research:{ticker:'SAMPLE',businessDays:5,count:0,articles:[]}});
    assert.equal(calls,1);assert.equal(payload.upsideCoverage?.status,'NO_HIGHER_RESISTANCE_IN_SUPPLIED_HISTORY');assert.equal(payload.targets.length,0);
    if(format==='simple')assert.equal(payload.simpleAnalysis?.upside.length,0);
    assert.equal(upsidePresentation(payload).message,NO_HIGHER_TARGETS);
  }
});

test('actual manager reassesses shared legacy history before request preparation; repeated callbacks buy nothing',async()=>{
  const store=new WatchlistStore();
  const state={...buildTradersLinkAiReadRefreshState(read()),upsideCoverage:undefined};
  store.setEntries([{symbol:'SAMPLE',active:true,priority:1,tags:['manual'],activatedAt:at-60000,lastPrice:25,
    lastPriceUpdateAt:at+60000,discordThreadId:null,refreshPending:false,tradersLinkAiReadBoundaryState:state}]);
  let preparation=0,saves=0;
  const manager=Object.create(ManualWatchlistRuntimeManager.prototype) as any;
  Object.assign(manager,{options:{now:()=>at+60000,tradersLinkAiReadService:{generate:()=>{throw Error('must not request')}}},
    liveWatchlistPublisher:{},watchlistStore:store,aiReadState:new Map([['SAMPLE',state]]),activationEpochs:new Map([['SAMPLE',1]]),
    cancelledAutomaticAnalysis:new Map(),aiReadInFlight:new Set(),aiReadInitialGenerationSuppressedSymbols:new Set(),
    chartThesisSeriesMapBySymbol:new Map([['SAMPLE',{daily:{candles:packet().priceAction.recentDailyBars},'4h':{candles:[]}}]]),
    technicalContextCandleStore:{getCandles:()=>packet().priceAction.recentFiveMinuteBars},recordTradersLinkAiReadRunOutcome:()=>{},
    getTradersLinkAiReadGenerationAvailability:()=>({allowed:true}),persistWatchlist:()=>{saves++},
    buildLevelSnapshotPayload:()=>({symbol:'SAMPLE',currentPrice:25,timestamp:at+60000}),
    buildTradersLinkAiReadPriceActionContext:()=>{preparation++;throw Error('must not fetch')},
    getTradersLinkAiReadDailyCostBudgetStatus:()=>{throw Error('must pause before request budget')}});
  await Promise.all([1,2,3].map(i=>manager.generateTradersLinkAiReadInternal('SAMPLE',false,'automatic','offline-'+i)));
  assert.equal(preparation,0);assert.equal(saves,1);
  const saved=store.getEntry('SAMPLE')!.tradersLinkAiReadBoundaryState!;
  assert.equal(saved.upsideCoverage?.upperRefreshPolicy,'WAIT_FOR_NEW_STRUCTURE');
  store.patchEntry('SAMPLE',{watchlistGroup:'postmarket' as any});
  assert.deepEqual(store.getEntry('SAMPLE')?.tradersLinkAiReadBoundaryState,saved);
  // A new activation cannot reassess old-generation history.
  store.patchEntry('SAMPLE',{activatedAt:at+120000});
  manager.aiReadState.set('SAMPLE',state);
  manager.tradersLinkAiReadBoundaryRefreshSettings={enabled:false,maxPerTickerPerNewYorkDate:10};
  await manager.generateTradersLinkAiReadInternal('SAMPLE',false,'automatic','new-activation');
  assert.equal(manager.aiReadState.get('SAMPLE').upsideCoverage,undefined);
});

test('unavailable data retains pause identity and permits only later confirmed structure; optional malformed policy is ignored',()=>{
  const paused=coverage();
  const missing=advanceUpsideCoverage(paused,{...paused,dataAsOf:at+60000,status:'HISTORY_UNAVAILABLE',
    upperRefreshPolicy:'DEFAULT',upperPrice:null,evidenceKey:'unavailable'})!;
  assert.equal(missing.pausedAt,at);assert.equal(missing.historyFirstAt,paused.historyFirstAt);
  assert.equal(parseUpsideCoverage(missing)?.upperRefreshPolicy,'WAIT_FOR_NEW_STRUCTURE');
  const fresh={...missing,dataAsOf:at+180000,status:'MAPPED_RESISTANCE' as const,
    upperRefreshPolicy:'MAPPED_BOUNDARY' as const,upperPrice:23,formedAt:at+120000,evidenceKey:'new-rejection'};
  assert.equal(advanceUpsideCoverage(missing,fresh)?.upperPrice,23);
  assert.equal(parseUpsideCoverage({...missing,upperRefreshPolicy:'MAPPED_BOUNDARY'}),undefined);
  assert.equal(parseUpsideCoverage({...paused,historyFirstAt:at+1}),undefined);
});

test('actual simple and detailed image renderer exports the message panel, not a blank image or fabricated target',async()=>{
  for(const format of ['simple','current'] as const){
    const value={...read(),analysisFormat:format};
    const images=await renderAnalysisImages(value);
    assert.equal(images.length,1);
    assert.equal(Buffer.from(images[0]!.bytes).subarray(1,4).toString(),'PNG');
    assert.ok(images[0]!.bytes.length>1000);
  }
});
