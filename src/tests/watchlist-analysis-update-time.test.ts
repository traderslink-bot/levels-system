import assert from "node:assert/strict";
import test from "node:test";
import { analysisUpdateComparison, analysisUpdateContextForDraft, analysisUpdateContextFromReview, parseAnalysisUpdateContext } from "../lib/ai/watchlist-analysis-update-context.js";
import { renderApprovedAnalysisDiscord, attributeOwnerApprovedDiscord } from "../lib/ai/traderslink-ai-read-publication-preview.js";
import type { TradersLinkAiReadPayload } from "../lib/live-watchlist/live-watchlist-types.js";

const originalAt = Date.UTC(2026,9,20,13,25,59);
const approval = (revision:number, generatedAt:number, currentPrice:number, visible=true) => ({revision,actor:"owner",at:generatedAt+3600000,
  body:{kind:"approve",draftRevision:visible?1:0,publication:{website:{tradersLinkAiReadCardVisible:visible,cards:{tradersLinkAiRead:{body:JSON.stringify({generatedAt,currentPrice})}}}}}});
const delivered = (approvalRevision:number) => ({body:{kind:"delivery",channel:"website",status:"acknowledged",approvalRevision}});
const review = () => ({events:[approval(1,originalAt-86400000,2,false),delivered(1),approval(3,originalAt,2),delivered(3),approval(5,originalAt+86400000,3),delivered(5)]});

test("original generation date/time replaces only the original price phrase",()=>{
 const context=analysisUpdateContextForDraft(review(),4);
 assert.equal(context.firstAnalysisAt,originalAt);
 assert.equal(analysisUpdateComparison(context),"Originally analyzed: Oct 20, 9:25 AM ET. Now $4.00 (+100.0%).");
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
 assert.equal(analysisUpdateComparison({automatic:false,firstAnalysisPrice:2,updatedAnalysisPrice:3}),null);
 assert.equal(parseAnalysisUpdateContext({automatic:false,firstAnalysisAt:Infinity})!.firstAnalysisAt,null);
 const value=review();
 (value.events[2] as any).body.publication.website.cards.tradersLinkAiRead.body=JSON.stringify({currentPrice:2});
 assert.equal(analysisUpdateContextForDraft(value,4).firstAnalysisAt,null);
});
test("Eastern winter conversion has no seconds and preserves price/percent suffix",()=>{
 assert.equal(analysisUpdateComparison({automatic:false,firstAnalysisAt:Date.UTC(2026,0,5,14,25,59),firstAnalysisPrice:4,updatedAnalysisPrice:3}),
  "Originally analyzed: Jan 5, 9:25 AM ET. Now $3.00 (-25.0%).");
});
test("the rest of Discord update text, links, tags and attribution are unchanged",()=>{
 const context=analysisUpdateContextForDraft(review(),4);
 const read={symbol:"TEST"} as TradersLinkAiReadPayload;
 const without=renderApprovedAnalysisDiscord(read,true,{everyone:true,roles:[]});
 const updated=renderApprovedAnalysisDiscord(read,true,{everyone:true,roles:[]},context);
 assert.equal(updated[0]!.replace(analysisUpdateComparison(context)!+"\n",""),without[0]);
 assert.match(attributeOwnerApprovedDiscord(updated,"runtime:automatic-boundary")[0]!,/TEST Analysis updated — Auto updated by AI/);
 assert.match(updated[0]!,/@everyone/);
});
