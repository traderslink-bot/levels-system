import assert from "node:assert/strict";
import {test} from "node:test";
import {OpenAITradersLinkAiReadService} from "../lib/ai/traderslink-ai-read-service.js";
import type {LevelSnapshotPayload} from "../lib/alerts/alert-types.js";
import type {TradersLinkAiReadPriceActionContext} from "../lib/ai/traderslink-ai-read-price-action.js";
import {applyOwnerAnalysisEdit} from "../lib/ai/traderslink-ai-read-owner-edit.js";
import {renderApprovedAnalysisDiscord} from "../lib/ai/traderslink-ai-read-publication-preview.js";
import {ManualWatchlistRuntimeManager} from "../lib/monitoring/manual-watchlist-runtime-manager.js";
const DATA_AS_OF=Date.parse("2026-07-15T20:30:00.000Z");
test("Simple admission requires private review even when ordinary review is off",()=>{
  const admission=(ManualWatchlistRuntimeManager.prototype as any).shouldPreparePrivateActivation;
  const manager={analysisFormat:"simple",reviewBeforePublishingEnabled:false,
    options:{now:()=>Date.parse("2026-07-15T15:00:00Z")},watchlistStore:{getEntry:()=>undefined},
    tradersLinkAiReadGenerationSettings:{enabled:true,premarketEnabled:true,regularEnabled:true,postmarketEnabled:true}};
  assert.equal(admission.call(manager,{symbol:"TEST"}),true);
  manager.tradersLinkAiReadGenerationSettings.regularEnabled=false;
  assert.equal(admission.call(manager,{symbol:"TEST"}),false);
  manager.tradersLinkAiReadGenerationSettings.regularEnabled=true;
  manager.analysisFormat="current";
  assert.equal(admission.call(manager,{symbol:"TEST"}),false);
});
function snapshot(): LevelSnapshotPayload {
  return {
    symbol: "TGHL",
    timestamp: DATA_AS_OF,
    currentPrice: 1.36,
    marketStructure: null,
    supportZones: [{
      representativePrice: 1.25,
      lowPrice: 1.23,
      highPrice: 1.27,
      strengthLabel: "moderate",
      freshness: "fresh",
      touchCount: 3,
      confluenceCount: 2,
      sourceLabel: "intraday support",
    }],
    resistanceZones: [{
      representativePrice: 1.5,
      lowPrice: 1.48,
      highPrice: 1.52,
      strengthLabel: "strong",
      freshness: "fresh",
      touchCount: 4,
      confluenceCount: 3,
      sourceLabel: "postmarket breakout pivot",
    }],
  } as LevelSnapshotPayload;
}

function priceAction(): TradersLinkAiReadPriceActionContext {
  const intradayCandles = Array.from({ length: 24 }, (_, index) => {
    const timestamp = DATA_AS_OF - (23 - index) * 5 * 60 * 1_000;
    const open = 1.22 + index * 0.006;
    const close = open + (index % 3 === 0 ? 0.012 : 0.004);
    return {
      timestamp,
      open,
      high: Math.max(open, close) + 0.018,
      low: Math.min(open, close) - 0.014,
      close,
      volume: 100_000 + index * 8_000,
    };
  });
  const dailyCandles = Array.from({ length: 20 }, (_, index) => {
    const timestamp = DATA_AS_OF - (20 - index) * 24 * 60 * 60 * 1_000;
    const open = 1 + index * 0.01;
    const close = open + 0.03;
    return {
      timestamp,
      open,
      high: close + 0.08,
      low: open - 0.05,
      close,
      volume: 500_000 + index * 10_000,
    };
  });
  // Synthetic historical spike supports the fixture's 1.68 continuation.
  // The continuation must not pass solely because its rationale says "range high".
  dailyCandles[0] = { ...dailyCandles[0]!, open: 1.4, high: 1.68, close: 1.5 };
  return {
    source: "yahoo full-session OHLCV",
    fetchedAt: DATA_AS_OF,
    priorRegularClose: 1.2,
    intradayCandles,
    dailyCandles,
  };
}

const simple={setup:"Observed expansion above the base.",selectionAudit:{note:"PRIVATE_EVIDENCE"},
  pullbacks:[{low:1.1,high:1.2,confirmation:"Wait for buyers.",invalidation:1.05,explanation:"First base.",evidenceRefs:["PRIVATE_EVIDENCE"]},
    {low:.9,high:1,confirmation:"Wait for reclaim.",invalidation:.85,explanation:"Lower base.",evidenceRefs:["PRIVATE_EVIDENCE"]}],
  upside:[{low:1.5,high:1.6,explanation:"Prior resistance.",evidenceRefs:["PRIVATE_EVIDENCE"]}],
  invalidation:{price:.85,explanation:"Broader base fails.",evidenceRefs:["PRIVATE_EVIDENCE"]}};
test("one simple request, raw candle packet, no search; edit ranges and hidden sections survive",async()=>{
  let calls=0;
  const service=new OpenAITradersLinkAiReadService({apiKey:"test-only",model:"gpt-5.6-luna",webSearchEnabled:true,
    fetchImpl:async(_url,options)=>{
      calls++;const body=JSON.parse(String(options?.body));
      assert.equal(body.tools,undefined);
      assert.equal(body.max_output_tokens,16000);
      const input=JSON.parse(body.input[1].content[0].text);
      assert.equal(typeof input.marketPacket.priceAction.recentFiveMinuteBars[0].high,"number");
      assert.ok(input.marketPacket.candleCoverage);
      assert.equal(body.text.format.schema.properties.listingStatus,undefined);
      return new Response(JSON.stringify({status:"completed",output_text:JSON.stringify(simple),
        usage:{input_tokens:100,output_tokens:100,total_tokens:200}}),{status:200});
    }});
  const input={snapshot:snapshot(),priceAction:priceAction(),analysisFormat:"simple" as const,ownerReviewRequired:true,
    research:{ticker:"TGHL",businessDays:5,count:0,articles:[]}};
  const read=await service.generate(input);
  assert.equal(calls,1);assert.equal(read.analysisFormat,"simple");assert.equal(read.usedWebSearch,false);
  assert.equal(read.simpleAnalysis?.pullbacks.length,2);assert.equal(read.simpleAnalysis?.upside[0]?.high,1.6);
  const original=JSON.stringify(read);
  const edit=structuredClone(read.simpleAnalysis!);edit.upside[0]!.high=1.75;
  const saved=applyOwnerAnalysisEdit(read,{simpleAnalysis:edit,ownerHiddenSections:["shallow"]}).payload;
  assert.equal(JSON.stringify(read),original);assert.equal(saved.analysisFormat,"simple");
  const discord=renderApprovedAnalysisDiscord(saved).join("");
  assert.match(discord,/\$1.5–\$1.75/);assert.doesNotMatch(discord,/First base|PRIVATE_EVIDENCE|Listing|Dilution|Confidence/);
  assert.match(discord,/Lower base/);assert.equal(calls,1);
  await assert.rejects(()=>service.generate({...input,ownerReviewRequired:false}),/requires owner review/);
  assert.equal(calls,1);
});
test("incomplete simple output does not send a retry",async()=>{
  let calls=0;
  const service=new OpenAITradersLinkAiReadService({apiKey:"test-only",fetchImpl:async()=>{
    calls++;return new Response(JSON.stringify({status:"incomplete",output_text:"{"}),{status:200});
  }});
  await assert.rejects(()=>service.generate({snapshot:snapshot(),priceAction:priceAction(),analysisFormat:"simple",ownerReviewRequired:true,
    research:{ticker:"TGHL",businessDays:5,count:0,articles:[]}}),/incomplete/);
  assert.equal(calls,1);
});
