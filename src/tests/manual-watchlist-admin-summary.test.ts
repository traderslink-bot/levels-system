import test from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import ts from "typescript";
import { MANUAL_WATCHLIST_PAGE } from "../runtime/manual-watchlist-page.js";
class Element {
  children:Element[]=[];dataset:Record<string,string>={};style={};className='';textContent='';value='';title='';hidden=false;
  set innerHTML(_value:string){this.children=[];} get innerHTML(){return '';}
  appendChild(child:Element){this.children.push(child);return child;}
  append(...children:Element[]){this.children.push(...children);}
}
const functions = new Map<string,string>();
for(const match of MANUAL_WATCHLIST_PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)){
 const source=ts.createSourceFile('console.js',match[1]!,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name)functions.set(node.name.text,node.getText(source));ts.forEachChild(node,visit);};visit(source);
}
function extract(name:string){const found=functions.get(name);assert.ok(found,name);return found;}

function context(extra:Record<string,unknown>={}){
 const context:any={document:{createElement:()=>new Element(),getElementById:()=>null},createRuntimeCard:(label:string,value:unknown)=>({label,value}),configGridEl:new Element(),runtimeGridEl:new Element(),aiNoticeEl:new Element(),openLiveWatchlistLinkEl:new Element(),formatTime:(value:unknown)=>String(value),lifecycleLabel:(value:unknown)=>String(value),renderWatchlistHealth:()=>{},renderProviderHealth:()=>{},renderAnalysisOperations:()=>{},...extra};
 for(const name of ['renderHistoricalProviderControl','renderLiveProviderControl','renderSameDayCandleProviderControl','renderLiveTraderReadVisibilityControl','renderPotentialGainVisibilityControl','renderWatchlistLifecycleLabelsVisibilityControl','renderReversalWatchlistVisibilityControl','renderTopRegularWatchlistVisibilityControl','renderAiReadControls','renderAutoSelectorControl'])context[name]=()=>{};
 return context;
}
test('Runtime uses actual analysis configuration instead of disabled legacy defaults',()=>{
 const c=context();new Script(extract('renderRuntimeConfig')+'\nrenderRuntimeConfig(status)').runInNewContext({...c,status:{aiReadConfigured:true,aiReadModel:'gpt-6-luna',aiReadReasoningEffort:'xhigh',aiReadFallbackModel:'gpt-6-sol',aiReadFallbackReasoningEffort:'high',runtimeHealth:{aiCommentary:{generatedCount:0}},runtimeConfig:{aiCommentaryServiceAvailable:false,aiCommentaryModel:'gpt-5-mini',aiCleanReadModel:'gpt-5.5',openAiApiKeyPresent:false}}});
 const cards=c.configGridEl.children as any[];const values=new Map(cards.map(card=>[card.label,card.value]));assert.equal(values.get('Analysis service'),'Configured');assert.equal(values.get('Analysis model'),'GPT-6 Luna');assert.equal(values.get('Reasoning effort'),'xhigh');assert.equal(values.get('Fallback model'),'GPT-6 Sol / high');for(const label of ['AI Service','AI Model','AI Generated','AI Failed','Last AI Generated','Last AI Failure','Clean Read Model','OpenAI Key','Provider Config','Candle Cache Dir'])assert.equal(values.has(label),false,label);assert.equal(c.aiNoticeEl.hidden,true);
});
test('unconfigured current service and disabled fallback remain honest without replacing saved model values',()=>{
 const c=context();new Script(extract('renderRuntimeConfig')+'\nrenderRuntimeConfig(status)').runInNewContext({...c,status:{aiReadConfigured:false,aiReadModel:null,aiReadFallbackModel:null,runtimeConfig:{aiCommentaryModel:'gpt-5-mini'}}});const values=new Map((c.configGridEl.children as any[]).map(card=>[card.label,card.value]));assert.equal(values.get('Analysis service'),'Not configured');assert.equal(values.get('Analysis model'),'Not configured');assert.equal(values.get('Fallback model'),'Off');
});
test('audit ticker count differs from publications; historical event totals live only in Runtime',()=>{
 const c=context({aiReadAuditGridEl:new Element(),aiReadRuntimeAuditGridEl:new Element(),aiReadAuditCurrentListEl:new Element(),aiReadAuditStatusFilterEl:{value:'all'},renderAiReadDetail:()=>{}});
 const payload={currentEntries:Array.from({length:17},(_,i)=>({symbol:'T'+i,status:i<5?'published':'hidden',active:true})),recentEvents:[],summary:{byOutcome:{failed:131,missing:46,request_started:505}}};
 const script=['auditStatusLabel','auditStatusClass','buildAiReadAuditRows','auditRowMatches','renderAiReadAudit'].map(extract).join('\n');new Script(script+'\nrenderAiReadAudit(payload)').runInNewContext({...c,payload});
 const summary=new Map((c.aiReadAuditGridEl.children as any[]).map(card=>[card.label,card.value]));const runtime=new Map((c.aiReadRuntimeAuditGridEl.children as any[]).map(card=>[card.label,card.value]));assert.equal(summary.get('Audit tickers'),'17');assert.equal(summary.get('Published analyses'),'5');assert.equal(summary.get('Needs attention'),'0');assert.equal(runtime.get('Failed audit events'),'131');assert.equal(runtime.get('Missing audit events'),'46');assert.equal(runtime.get('Analysis requests'),'505');assert.equal(summary.size,3);assert.equal(c.aiReadAuditCurrentListEl.children.length,17);assert.match(c.aiReadAuditGridEl.title,/not the number of tickers published/);
});
test('filtering the operations table does not turn retained event counts into current ticker counts',()=>{
 const c=context({aiReadAuditGridEl:new Element(),aiReadRuntimeAuditGridEl:new Element(),aiReadAuditCurrentListEl:new Element(),aiReadAuditStatusFilterEl:{value:'published'},renderAiReadDetail:()=>{}});const payload={currentEntries:[{symbol:'ONE',status:'published'},{symbol:'TWO',status:'missing'}],recentEvents:[],summary:{byOutcome:{failed:8,missing:4,request_started:11}}};new Script(['auditStatusLabel','auditStatusClass','buildAiReadAuditRows','auditRowMatches','renderAiReadAudit'].map(extract).join('\n')+'\nrenderAiReadAudit(payload)').runInNewContext({...c,payload});assert.equal((c.aiReadAuditGridEl.children[0] as any).value,'1');assert.equal((c.aiReadRuntimeAuditGridEl.children[0] as any).value,'8');assert.equal(c.aiReadAuditCurrentListEl.children.length,1);
});
test('Runtime does not mislabel old Discord thread records as current website delivery',()=>{
 const c=context();new Script(extract('renderRuntimeStatus')+'\nrenderRuntimeStatus(status)').runInNewContext({...c,status:{startupState:'ready',activeSymbolCount:17,marketDataStatus:'live',runtimeHealth:{lastThreadPostSymbol:'OLD',lastThreadPostAt:1000,lastThreadPostKind:'snapshot'},runtimeConfig:{}}});const labels=(c.runtimeGridEl.children as any[]).map(card=>card.label);for(const label of ['Last Website Post','Last Website Failure','Session Folder','Review Log','Discord Audit','Structure Lifecycle','Moomoo Connection','IBKR'])assert.ok(!labels.includes(label),label);assert.ok(labels.includes('Active admin tickers'));
});
test('removed price-age card stays removed and operational metrics use existing status cadence',()=>{
 assert.doesNotMatch(MANUAL_WATCHLIST_PAGE,/\["Last Price Age"/);
 assert.match(MANUAL_WATCHLIST_PAGE,/if \(!operations\) return;/);
 assert.match(MANUAL_WATCHLIST_PAGE,/one-minute status check/);
 assert.equal((MANUAL_WATCHLIST_PAGE.match(/fetchJson\("\/api\/runtime\/status"/g)||[]).length,1);
});
test('provider cards use actual Watchlist roles; an unused Moomoo connection never means waiting',()=>{
 const status={marketDataStatus:'live',runtimeConfig:{liveProvider:'alpaca',historicalProvider:'alpaca',sameDayCandleProvider:'alpaca',sameDayCandleProviderHealth:{selectedProvider:'alpaca',fallbackProvider:null,activeProvider:'alpaca',moomooConnectionStatus:'waiting'}}};
 const before=JSON.stringify(status);const rows:any[]=new Script(extract('watchlistProviderUsage')+'\nwatchlistProviderUsage(status)').runInNewContext({status});
 assert.equal(rows.length,5);assert.equal(rows.find(r=>r.provider==='alpaca').state,'In use');assert.match(rows.find(r=>r.provider==='alpaca').roles,/Live prices.*Historical candles.*Same-day candles/);for(const provider of ['moomoo','ibkr','eodhd','yahoo'])assert.equal(rows.find(r=>r.provider===provider).state,'Off');assert.equal(JSON.stringify(status),before);
});
test('split roles and fallback standby/actual use remain distinct from connectivity',()=>{
 const status:any={marketDataStatus:'offline',runtimeConfig:{liveProvider:'alpaca',historicalProvider:'eodhd',sameDayCandleProvider:'moomoo',sameDayCandleProviderHealth:{selectedProvider:'moomoo',fallbackProvider:'yahoo',fallbackActive:false,activeProvider:null}}};
 const run=()=>new Script(extract('watchlistProviderUsage')+'\nwatchlistProviderUsage(status)').runInNewContext({status}) as any[];
 let rows=run();for(const provider of ['alpaca','eodhd','moomoo'])assert.equal(rows.find(r=>r.provider===provider).state,'In use');assert.equal(rows.find(r=>r.provider==='yahoo').state,'Standby');
 Object.assign(status.runtimeConfig.sameDayCandleProviderHealth,{activeProvider:'yahoo',fallbackActive:true});rows=run();assert.equal(rows.find(r=>r.provider==='yahoo').state,'In use');assert.equal(rows.find(r=>r.provider==='yahoo').roles,'Last candle response');
 status.runtimeConfig.sameDayCandleProvider='alpaca';rows=run();assert.equal(rows.find(r=>r.provider==='moomoo').state,'Off');assert.equal(rows.find(r=>r.provider==='yahoo').state,'Off');
});
test('missing provider configuration does not invent Off or infer use from an old connection',()=>{
 const rows:any[]=new Script(extract('watchlistProviderUsage')+'\nwatchlistProviderUsage(status)').runInNewContext({status:{runtimeConfig:{sameDayCandleProviderHealth:{moomooConnectionStatus:'connected'}}}});
 assert.ok(rows.every(row=>row.state==='Unknown'));
});
