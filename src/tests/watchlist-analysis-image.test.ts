import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import type { TradersLinkAiReadPayload } from "../lib/live-watchlist/live-watchlist-types.js";
import { analysisImageSections, renderAnalysisImages, splitImageSections } from "../lib/ai/watchlist-analysis-image.js";
import { approvedAnalysisImages } from "../lib/ai/watchlist-analysis-image-cache.js";
import { DiscordRestThreadGateway } from "../lib/alerts/discord-rest-thread-gateway.js";

const simple = (): TradersLinkAiReadPayload => ({ version: 3, analysisFormat: "simple", symbol: "VEEA", currentPrice: 4.15,
  generatedAt: Date.UTC(2026,8,15,13,0,50), ownerHiddenSections: [], simpleAnalysis: {
    setup: "A saved analysis, not a live price.", pullbacks: [
      { low: 3.86, high: 3.99, explanation: "First zone", confirmation: "Buyer defense", invalidation: 3.78 },
      { low: 3.66, high: 3.80, explanation: "Deeper base", confirmation: "Reclaim", invalidation: 3.58 }],
    upside: [{ low: 4.73, high: 4.88, explanation: "Prior resistance" }], invalidation: { price: 3.4, explanation: "Base fails" },
  } } as unknown as TradersLinkAiReadPayload);

test("simple visibility matches selected sections and promotes deep-only Pullback", () => {
  const read = simple(); read.ownerHiddenSections = ["currentRead", "shallow", "targets", "momentumFailure"];
  const sections = analysisImageSections(read);
  assert.equal(sections.length, 1); assert.equal(sections[0]!.title, "Pullback");
  assert.match(JSON.stringify(sections), /3.66/); assert.doesNotMatch(JSON.stringify(sections), /3.86|4.73|Base fails/);
});
test("pagination splits at Pullback, not the height-balanced middle", () => {
  assert.deepEqual(splitImageSections([300,400,500],['currentRead','shallow','targets']),[[0,1,2]]);
  assert.deepEqual(splitImageSections([1200,1200,300,300],['currentRead','targets','shallow','deep']),[[0,1],[2,3]]);
  assert.deepEqual(splitImageSections([2500],['currentRead']),[[0]]);
  assert.throws(()=>splitImageSections([4300,4300],['currentRead','shallow']));
  assert.throws(()=>splitImageSections([],[]));
});
test("news and risk stay below pullbacks unless a third image is needed", () => {
  const keys=['currentRead','targets','shallow','deep','failureRecovery','catalystRealityCheck','riskSummary'];
  assert.deepEqual(splitImageSections([800,800,600,600,500,400,300],keys),[[0,1],[2,3,4,5,6]]);
  assert.deepEqual(splitImageSections([800,800,1200,1200,1000,900,600],keys),[[0,1],[2,3,4],[5,6]]);
});
test("hidden sections do not create blank images or separate the remaining pullback", () => {
  assert.deepEqual(splitImageSections([1800,900,900],['currentRead','deep','riskSummary']),[[0],[1,2]]);
  assert.deepEqual(splitImageSections([1200,900],['deep','riskSummary']),[[0,1]]);
  assert.deepEqual(splitImageSections([1500,900],['currentRead','riskSummary']),[[0],[1]]);
});
test("exports retain the website's source-name concealment without mutating saved text", () => {
  const read=simple(); read.simpleAnalysis!.setup='News from https://www.stocktitan.net/example and Stock%2554itan';
  const original=read.simpleAnalysis!.setup;
  assert.doesNotMatch(JSON.stringify(analysisImageSections(read)),/stock|titan/i);
  assert.equal(read.simpleAnalysis!.setup,original);
});
test("current format preserves owner edits and omits unsupported risk panels", () => {
  const read = { ...simple(), analysisFormat: "current", currentRead: "Owner's edited setup", needsToHold: {price:3.86,rationale:"Hold"},
    cautionBelow: {price:3.66,rationale:"Caution"}, momentumFailure:{price:3.4,rationale:"Failure"}, breakoutContinuation:{price:4.53,rationale:"Breakout"},
    targets:[{price:5.5,condition:"Owner edited upside",label:"Next"}], downsideCheckpoints:[], pullbackPlans:{shallow:null,deep:null}, failureRecovery:null,
    catalystRealityCheck:{sourceUrls:[],summary:""}, sources:[], riskSummary:["Saved risk"], dilutionRisk:{summary:"must not export"}, listingStatus:{summary:"must not export"},
    ownerHiddenSections:["needsToHold"] } as unknown as TradersLinkAiReadPayload;
  const text=JSON.stringify(analysisImageSections(read));
  assert.match(text,/Owner edited upside/); assert.match(text,/Owner's edited setup/);
  assert.doesNotMatch(text,/must not export|Needs to hold/);
});
test("renderer returns a readable PNG for compact simple content with markup safely escaped", async () => {
  const read=simple(); read.simpleAnalysis!.setup='Owner <b>literal</b> & text';
  const images=await renderAnalysisImages(read);
  assert.equal(images.length,1); assert.equal(images[0]!.filename,'VEEA-analysis-1.png');
  assert.deepEqual(Array.from(images[0]!.bytes.slice(0,8)),[137,80,78,71,13,10,26,10]);
  const sharp=createRequire(import.meta.url)('sharp') as typeof import('sharp');
  const meta=await sharp(images[0]!.bytes).metadata();
  assert.equal(meta.width,1000); assert.ok(meta.height! > 500); assert.ok(meta.height! <= 4490);
  assert.match(images[0]!.description,/9:00:50 AM/);
  if (process.env.WATCHLIST_IMAGE_QA_DIRECTORY) writeFileSync(join(process.env.WATCHLIST_IMAGE_QA_DIRECTORY,'simple-image-qa.png'),images[0]!.bytes);
});
test("longer selected sections split into two real PNGs without changing source", async () => {
  const read=simple(); const sentence='Wait for buyers to defend the observed base and reclaim the upper boundary. ';
  read.simpleAnalysis!.setup=sentence.repeat(4);
  for(const p of read.simpleAnalysis!.pullbacks) p.explanation=sentence.repeat(5);
  read.simpleAnalysis!.upside[0]!.explanation=sentence.repeat(4);
  const original=JSON.stringify(read); const images=await renderAnalysisImages(read);
  assert.equal(images.length,2); assert.equal(JSON.stringify(read),original);
  assert.match(images[1]!.description,/image 2 of 2/);
  if (process.env.WATCHLIST_IMAGE_QA_DIRECTORY) for(let i=0;i<images.length;i++) writeFileSync(join(process.env.WATCHLIST_IMAGE_QA_DIRECTORY,`split-image-qa-${i+1}.png`),images[i]!.bytes);
});
test("approved image cache freezes bytes and text-only failure, old approvals untouched", async () => {
  const dir=mkdtempSync(join(tmpdir(),'watchlist-image-test-'));
  try {
    const publication={analysisImageVersion:1 as const, website:{cards:{tradersLinkAiRead:{body:JSON.stringify(simple())}}},discordChunks:['existing links']};
    let calls=0;
    const render=async()=>{calls++;return [{filename:'VEEA-analysis-1.png',description:'saved',bytes:new Uint8Array([1,2,3])}];};
    assert.equal((await approvedAnalysisImages(dir,5,publication,'VEEA',render)).length,1);
    assert.equal((await approvedAnalysisImages(dir,5,publication,'VEEA',render)).length,1);assert.equal(calls,1);
    assert.deepEqual(await approvedAnalysisImages(dir,8,{...publication,analysisImageVersion:undefined},'VEEA',render),[]);
    const fail=async()=>{throw new Error('no renderer');};
    assert.deepEqual(await approvedAnalysisImages(dir,9,publication,'VEEA',fail),[]);
    assert.deepEqual(await approvedAnalysisImages(dir,9,publication,'VEEA',render),[]);assert.equal(calls,1);
    assert.match(readFileSync(join(dir,'analysis-images-9.json'),'utf8'),/text_only_render_failed/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test("Discord multipart preserves original linked text, nonce and mention policy", async () => {
  let calls=0;
  const gateway=new DiscordRestThreadGateway({botToken:'test',watchlistChannelId:'23456789012345678',fetchImpl:async(_url,init)=>{
    calls++;assert.ok(init!.body instanceof FormData);
    const form=init!.body as FormData;const payload=JSON.parse(String(form.get('payload_json')));
    assert.equal(payload.content,'VEEA added.\nWatchlist link\nTicker link');
    assert.deepEqual(payload.allowed_mentions,{parse:[],users:[],roles:[],replied_user:false});
    assert.equal(payload.enforce_nonce,true);assert.equal(payload.attachments.length,3);
    assert.ok(form.get('files[0]') instanceof Blob);assert.ok(form.get('files[1]') instanceof Blob);
    assert.ok(form.get('files[2]') instanceof Blob);
    assert.equal(new Headers(init!.headers).get('content-type'),null);
    return new Response(JSON.stringify({id:'12345678901234567'}),{status:200});
  }});
  const files=[1,2,3].map(i=>({filename:`VEEA-analysis-${i}.png`,description:'Saved VEEA analysis',bytes:new Uint8Array([1,2,3])}));
  await gateway.sendApprovedAnalysisChunk({symbol:'VEEA',deliveryKey:'approved-five',content:'VEEA added.\nWatchlist link\nTicker link',attachments:files});
  assert.equal(calls,1);
});
