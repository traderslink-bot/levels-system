import assert from "node:assert/strict";
import test from "node:test";
import { analysisUpdateContextForDraft, analysisUpdateContextFromReview, parseAnalysisUpdateContext } from "../lib/ai/watchlist-analysis-update-context.js";
import { renderApprovedAnalysisDiscord, attributeOwnerApprovedDiscord } from "../lib/ai/traderslink-ai-read-publication-preview.js";
import { applyDiscordOwnerText } from "../lib/alerts/watchlist-discord-owner-text.js";
import type { TradersLinkAiReadPayload } from "../lib/live-watchlist/live-watchlist-types.js";

const originalAt = Date.UTC(2026,9,20,13,25,59);
const approval = (revision:number, generatedAt:number, currentPrice:number, visible=true) => ({revision,actor:"owner",at:generatedAt+3600000,
  body:{kind:"approve",draftRevision:visible?1:0,publication:{website:{tradersLinkAiReadCardVisible:visible,cards:{tradersLinkAiRead:{body:JSON.stringify({generatedAt,currentPrice})}}}}}});
const delivered = (approvalRevision:number) => ({body:{kind:"delivery",channel:"website",status:"acknowledged",approvalRevision}});
const review = () => ({events:[approval(1,originalAt-86400000,2,false),delivered(1),approval(3,originalAt,2),delivered(3),approval(5,originalAt+86400000,3),delivered(5)]});

test("saved original generation time and reference prices remain available without entering alert text",()=>{
 const context=analysisUpdateContextForDraft(review(),4);
 assert.equal(context.firstAnalysisAt,originalAt);
 assert.equal(context.firstAnalysisPrice,2);
 assert.equal(context.updatedAnalysisPrice,4);
});
test("review history uses earliest acknowledged analysis, not listing, approval time or latest refresh",()=>{
 const context=analysisUpdateContextFromReview(review(),5);
 assert.equal(context.firstAnalysisAt,originalAt);assert.equal(context.firstAnalysisPrice,2);
 const early=analysisUpdateContextFromReview(review(),3);assert.equal(early.firstAnalysisAt,null);
});
test("older frozen contexts recover original generation time without rewriting frozen prices",()=>{
 const value=review();
 const current=value.events[4] as any;
 current.body.publication.analysisUpdateContext={automatic:false,firstAnalysisPrice:2,updatedAnalysisPrice:3};
 const context=analysisUpdateContextFromReview(value,5);
 assert.equal(context.firstAnalysisAt,originalAt);assert.equal(context.updatedAnalysisPrice,3);
 assert.equal(parseAnalysisUpdateContext(context)!.firstAnalysisAt,originalAt);
});
test("missing or invalid timestamp never substitutes a quote or publication timestamp",()=>{
 assert.equal(parseAnalysisUpdateContext({automatic:false,firstAnalysisAt:Infinity})!.firstAnalysisAt,null);
 const value=review();
 (value.events[2] as any).body.publication.website.cards.tradersLinkAiRead.body=JSON.stringify({currentPrice:2});
 assert.equal(analysisUpdateContextForDraft(value,4).firstAnalysisAt,null);
});
test("the rest of Discord update text, links, tags and attribution are unchanged",()=>{
 const context=analysisUpdateContextForDraft(review(),4);
 const read={symbol:"TEST"} as TradersLinkAiReadPayload;
 const without=renderApprovedAnalysisDiscord(read,true,{everyone:true,roles:[]});
 const updated=renderApprovedAnalysisDiscord(read,true,{everyone:true,roles:[]},context);
 assert.equal(updated[0],without[0]);
 assert.match(attributeOwnerApprovedDiscord(updated,"runtime:automatic-boundary")[0]!,/TEST Analysis updated — Auto updated by AI/);
 assert.match(updated[0]!,/@everyone/);
});

test("initial, first-analysis and updated posts omit price/performance text for both formats and every price direction",()=>{
 const previous=process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL;
 process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL="https://app.traderslink.pro/watchlist";
 try {
  for(const analysisFormat of ["current","simple"] as const) {
   const read={symbol:"TEST",analysisFormat,currentPrice:.60,generatedAt:originalAt,
    simpleAnalysis:{setup:"Retest $0.55",upside:[{price:.75}]}} as unknown as TradersLinkAiReadPayload;
   const originalRead=JSON.stringify(read);
   for(const updatedAnalysisPrice of [.60,.62,.90,null]) for(const hasPreviousAnalysis of [false,true]) {
    const context={automatic:false,hasPreviousAnalysis,firstAnalysisAt:originalAt,firstAnalysisPrice:.62,updatedAnalysisPrice};
    const originalContext=JSON.stringify(context);
    for(const isUpdate of [false,true]) for(const audience of [{everyone:false,roles:[]},{everyone:true,roles:["12345678901234567"]}]) {
     const chunks=renderApprovedAnalysisDiscord(read,isUpdate,audience,context);
     const text=chunks.join("\n");
     assert.doesNotMatch(text,/\$\d|\d(?:\.\d+)?%|Originally analyzed|\bNow\b/);
     assert.match(text,/https:\/\/app\.traderslink\.pro\/watchlist\/TEST/);
     assert.match(text,/View the live watchlist/);
     if(audience.everyone) {assert.match(text,/@everyone/);assert.match(text,/<@&12345678901234567>/);}
     assert.match(attributeOwnerApprovedDiscord(chunks,"platform-owner:10000000-0000-4000-8000-000000000001")[0]!,/by "This Guy"/);
     if(isUpdate&&hasPreviousAnalysis) assert.match(attributeOwnerApprovedDiscord(chunks,"runtime:automatic-boundary")[0]!,/Analysis updated — Auto updated by AI/);
    }
    assert.equal(JSON.stringify(context),originalContext);
   }
   assert.equal(JSON.stringify(read),originalRead);
  }
 } finally {if(previous===undefined)delete process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL;else process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL=previous;}
});

test("owner-authored price comments remain verbatim; only generated comparison copy is removed",()=>{
 const generated=renderApprovedAnalysisDiscord({symbol:"TEST"} as TradersLinkAiReadPayload,true,{everyone:true,roles:[]})[0]!;
 const custom='TEST — my plan at $0.62; up 20% from my own entry.';
 const result=applyDiscordOwnerText(generated,custom);
 assert.ok(result.startsWith(`### ${custom}\n\n`));
 assert.match(result,/@everyone/);
});
