import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countReviewDelivery, emptyDeliveryCounts, latestSuccessfulAnalysis } from "../lib/monitoring/watchlist-operations-summary.js";
import { TradersLinkAiReadRunLedger } from "../lib/ai/traderslink-ai-read-run-ledger.js";
import { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";

const review = (status?: string, notifyUsers = true): any => ({ cancelled: false,
  approved: { revision: 7, body: { kind: "approve", publication: { notifyUsers, discordChunks: ["Post"] } } },
  events: status ? [{ body: { kind: "delivery", channel: "discord", approvalRevision: 7, status } }] : [],
});
test("last analysis selects validation success across full unordered history, not attempt success or publication", () => {
  const events: any[] = [
    {symbol:"ONE",stage:"validation",outcome:"success",occurredAt:100,model:"recorded-model"},
    {symbol:"TWO",stage:"attempt",outcome:"success",occurredAt:500},
    {symbol:"THREE",stage:"validation",outcome:"failed",occurredAt:600},
    {symbol:"FOUR",stage:"publishing",outcome:"published",occurredAt:700},
    {symbol:"FIVE",stage:"validation",outcome:"success",occurredAt:200},
  ];
  assert.deepEqual(latestSuccessfulAnalysis(events),{symbol:"FIVE",at:200,model:null});
  assert.equal(latestSuccessfulAnalysis(events.slice(1,4)),null);
});
test("delivery counts honor latest approval, silent approval, cancellation, success and uncertain receipt", () => {
  const row=emptyDeliveryCounts("Discord");
  for(const value of [review(),review("failed"),review("started"),review("acknowledged"),review("failed",false),{...review("failed"),cancelled:true}])countReviewDelivery(row,value);
  assert.deepEqual(row,{label:"Discord",available:true,pending:1,sending:0,failed:1,uncertain:1});
  const older=review();older.events=[{body:{kind:"delivery",channel:"discord",approvalRevision:1,status:"failed"}}];
  countReviewDelivery(row,older);assert.equal(row.pending,2);assert.equal(row.failed,1);
});
test("chunk receipts do not double-count or assume an interrupted send is safe", () => {
  const row=emptyDeliveryCounts("Discord"),value=review();
  value.events=[{body:{kind:"discord_chunk",approvalRevision:7,index:0,status:"started"}},{body:{kind:"discord_chunk",approvalRevision:7,index:0,status:"acknowledged"}}];
  countReviewDelivery(row,value);assert.equal(row.uncertain,0);assert.equal(row.pending,0);
  value.approved.body.publication.discordChunks.push("Second");countReviewDelivery(row,value);assert.equal(row.pending,1);
  value.events.push({body:{kind:"discord_chunk",approvalRevision:7,index:1,status:"started"}});countReviewDelivery(row,value);assert.equal(row.uncertain,1);
});
test("ledger snapshot distinguishes empty, absent, damaged and valid records without writing", t => {
  const dir=mkdtempSync(join(tmpdir(),"operations-ledger-"));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,"audit.jsonl"),ledger=new TradersLinkAiReadRunLedger({filePath:file});assert.equal(ledger.readSnapshot(),null);
  writeFileSync(file,"");assert.deepEqual(ledger.readSnapshot(),{events:[],complete:true});
  ledger.record({symbol:"TEST",trigger:"manual",stage:"validation",outcome:"success",occurredAt:100});
  const before=readFileSync(file,"utf8");assert.equal(ledger.readSnapshot()?.complete,true);assert.equal(readFileSync(file,"utf8"),before);
  writeFileSync(file,before+'{"partial":');assert.equal(ledger.readSnapshot()?.complete,false);assert.equal(ledger.readSnapshot()?.events.length,1);
});
test("manager reads running set, isolated current public receipts and partial failures without work or provider calls", () => {
  const fake:any={aiReadInFlight:new Set(["ONE","TWO"]),options:{now:()=>300,tradersLinkAiReadRunLedger:{readSnapshot:()=>({events:[],complete:true})},tradersLinkAiReadReviewStore:{}},
    watchlistStore:{getActiveEntries:()=>[{symbol:"PUBLIC",publicationReview:{}},{symbol:"PRIVATE",watchlistGroup:"private",publicationReview:{}},{symbol:"BROKEN",publicationReview:{}}]},
    getTradersLinkAiReadReview:(symbol:string)=>{if(symbol==="BROKEN")throw Error("fixture");assert.equal(symbol,"PUBLIC");return review("failed");},
    getCategoryMoves:(symbol:string)=>symbol==="PUBLIC"?[{current:true,notify:true,destination:"failed"},{current:false,notify:true,destination:"failed"}]:[],
  };
  assert.equal(ManualWatchlistRuntimeManager.prototype.getRunningAnalysisCount.call(fake),2);
  const summary=ManualWatchlistRuntimeManager.prototype.getAnalysisOperationsSummary.call(fake);
  assert.equal(summary.refreshedAt,300);assert.equal(summary.deliveries[0]!.available,false);assert.equal(summary.deliveries[0]!.failed,1);assert.equal(summary.deliveries[1]!.failed,1);
  assert.equal(fake.aiReadInFlight.size,2);assert.equal(summary.lastSuccessfulAnalysis,null);
});
