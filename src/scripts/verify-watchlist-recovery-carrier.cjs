/* Offline fixtures only. No application server or external provider requests. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),ts=require('typescript');
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
const candidate=args.includes('--candidate')?require('./prepare-watchlist-recovery.cjs'):null;
const repo=value('--repo'),carrier=candidate?'candidate':value('--ref');
const old='68a7e0b2ecb3db289dc9d7425d885c240508231a',full='b9aa63f584ad58c338139a0fd57210c0453a862f';
function source(ref,file){if(ref==='candidate'&&candidate.files.has(file))return candidate.files.get(file);if(ref==='candidate')ref=old;return cp.execFileSync('git',['-c',`safe.directory=${repo}`,'-C',repo,'show',`${ref}:${file}`],{encoding:'utf8',maxBuffer:8e6});}
const cache=new Map();
function load(ref,file){const key=ref+file;if(cache.has(key))return cache.get(key).exports;const module={exports:{}};cache.set(key,module);const js=ts.transpileModule(source(ref,file),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;new Function('require','module','exports',js)(id=>id.startsWith('.')?load(ref,path.posix.normalize(path.posix.join(path.posix.dirname(file),id)).replace(/\.js$/,'.ts')):require(id),module,module.exports);return module.exports;}
const json=x=>JSON.parse(JSON.stringify(x));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'watchlist-carrier-proof-'));
(async()=>{try{
 const storeFile='src/lib/monitoring/watchlist-store.ts',diskFile='src/lib/monitoring/watchlist-state-persistence.ts',reviewFile='src/lib/ai/traderslink-ai-read-review-store.ts',managerFile='src/lib/monitoring/manual-watchlist-runtime-manager.ts';
 const now=1790164800000;
 const disk=(ref,name)=>new (load(ref,diskFile).WatchlistStatePersistence)({filePath:path.join(dir,name),now:()=>now});
 const legacyStore=new (load(old,storeFile).WatchlistStore)();legacyStore.upsertManualEntry({symbol:'LEGACY',active:true,watchlistGroup:'main',note:'existing private instruction'});
 disk(old,'old.json').save(legacyStore.getEntries());const legacy=disk(carrier,'old.json').load();assert.ok(legacy);assert.equal(legacy[0].automaticAnalysisEnabled,true);assert.equal(legacy[0].traderNotesDraft,'');disk(carrier,'old.json').save(legacy);assert.deepEqual(disk(full,'old.json').load(),legacy);
 const s=new (load(full,storeFile).WatchlistStore)();s.upsertManualEntry({symbol:'TEST',active:true,watchlistGroup:'general',automaticAnalysisEnabled:false,traderNotesDraft:'  Owner notes\n<script>literal text</script>  ',publicationReview:{required:true,cycleId:'proof-cycle'},aiReadAdmission:{initialGenerationEnabled:false}});
 disk(full,'new.json').save(s.getEntries());const before=disk(full,'new.json').load();const restored=new (load(carrier,storeFile).WatchlistStore)();restored.setEntries(disk(carrier,'new.json').load());disk(carrier,'new.json').save(restored.getEntries());assert.deepEqual(disk(full,'new.json').load(),before);assert.equal(restored.getEntry('TEST').watchlistGroup,'general');assert.equal(restored.getEntry('TEST').automaticAnalysisEnabled,false);assert.equal(restored.getEntry('TEST').traderNotesDraft,s.getEntry('TEST').traderNotesDraft);restored.upsertManualEntry({symbol:'TEST',active:true});assert.equal(restored.getEntry('TEST').automaticAnalysisEnabled,false);assert.equal(restored.getEntry('TEST').watchlistGroup,'general');
 console.log('PASS old format + full -> carrier store/disk -> full lossless round trips');
 const reviews=new (load(full,reviewFile).TradersLinkAiReadReviewStore)(path.join(dir,'reviews'),()=>now);reviews.begin('proof-cycle','TEST',true,'test');
 const publication={website:{symbol:'TEST',watchlistGroup:'general',cards:{traderNotes:{body:'public notes'}},tradersLinkAiReadCardVisible:false},notificationKind:'listing',notifyUsers:false,discordChunks:['Watchlist TEST']};
 reviews.approveListingOnly('proof-cycle',reviews.read('proof-cycle').head,'test',publication);
 const recovered=new (load(carrier,reviewFile).TradersLinkAiReadReviewStore)(path.join(dir,'reviews'),()=>now);assert.deepEqual(recovered.read('proof-cycle'),reviews.read('proof-cycle'));const state=recovered.read('proof-cycle');assert.throws(()=>recovered.claimDiscordChunk('proof-cycle',state.head,state.approved.revision,0),/without notifications/);assert.deepEqual(recovered.read('proof-cycle'),state);
 console.log('PASS unchanged approval/notes/notification-off review history; no delivery claim');
 const src=source(carrier,managerFile),ast=ts.createSourceFile('manager.ts',src,ts.ScriptTarget.Latest,true),cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='ManualWatchlistRuntimeManager');
 const names=['getTradersLinkAiReadGenerationAvailability','generateTradersLinkAiReadInternal'];const methods=names.map(name=>cls.members.find(n=>n.name?.getText(ast)===name).getText(ast)).join('\n');
 const Selected=new Function('normalizeSymbol','classifyUsEquityMarketSession',ts.transpileModule(`class Selected {${methods}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return Selected;')(s=>s.toUpperCase(),()=>({session:'regular'}));
 const m=new Selected();m.watchlistStore=restored;m.options={now:()=>now};m.activationEpochs=new Map();m.tradersLinkAiReadGenerationSettings={enabled:true,automaticUpdatesEnabled:true,premarketEnabled:true,regularEnabled:true,postmarketEnabled:true};m.recordTradersLinkAiReadRunOutcome=()=>{};
 Object.defineProperty(m.options,'tradersLinkAiReadService',{get(){throw new Error('PROVIDER MUST NOT BE ACCESSED');}});
 for(const trigger of ['activation','automatic','startup','boundary_cross','scheduled','deferred',undefined]){assert.equal(m.getTradersLinkAiReadGenerationAvailability(now,{symbol:'TEST',requestedTrigger:trigger}).allowed,false);assert.equal(await m.generateTradersLinkAiReadInternal('TEST',true,trigger,'test'),null);}
 assert.equal(m.getTradersLinkAiReadGenerationAvailability(now,{symbol:'TEST',requestedTrigger:'manual'}).allowed,true);
 console.log('PASS every non-manual trigger stops before provider/publisher; manual availability retained');
 for(const f of ['src/runtime/manual-watchlist-page.ts','src/runtime/manual-watchlist-row-review.ts','src/runtime/manual-watchlist-server.ts',reviewFile,'src/lib/live-watchlist/live-watchlist-publish-outbox.ts'])assert.equal(source(carrier,f),source(old,f),f);
 for(const f of ['src/lib/monitoring/monitoring-types.ts',storeFile,diskFile,'src/lib/monitoring/watchlist-entry-session.ts','src/lib/live-watchlist/live-watchlist-types.ts','src/lib/live-watchlist/live-watchlist-publisher.ts','src/lib/live-watchlist/live-watchlist-audit-archive.ts'])assert.equal(source(carrier,f),source(full,f),f);
 for(const name of ['getTradersLinkAiReadGenerationAvailability']){const fullAst=ts.createSourceFile('full.ts',source(full,managerFile),ts.ScriptTarget.Latest,true);const fullClass=fullAst.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='ManualWatchlistRuntimeManager');assert.equal(cls.members.find(n=>n.name?.getText(ast)===name).getText(ast),fullClass.members.find(n=>n.name?.getText(fullAst)===name).getText(fullAst));}
 console.log('PASS old UI/delivery untouched; full feature retains all carrier state and opt-out safety');
}finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
