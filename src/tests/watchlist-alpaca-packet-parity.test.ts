import assert from "node:assert/strict";
import test from "node:test";
import type { LevelSnapshotPayload } from "../lib/alerts/alert-types.js";
import { OpenAITradersLinkAiReadService } from "../lib/ai/traderslink-ai-read-service.js";

test("both outgoing analysis formats retain identical candle evidence across provider identities", async () => {
  const now=Date.parse("2026-11-06T19:00:00Z");
  const bars=(count:number,step:number,end=now)=>Array.from({length:count},(_,i)=>({
    timestamp:end-(count-i)*step,open:2+i*.001,high:2.1+i*.001,low:1.9+i*.001,close:2.02+i*.001,volume:1000+i,
  }));
  const base={fetchedAt:now,priorRegularClose:2,oneMinuteCandles:bars(60,60000),intradayCandles:bars(24,300000),
    dailyCandles:bars(30,86400000,now-86400000),fourHourCandles:bars(30,14400000,now-14400000)};
  const snapshot={symbol:"TEST",timestamp:now,currentPrice:2.1,marketStructure:null,supportZones:[],resistanceZones:[]} as unknown as LevelSnapshotPayload;
  for(const analysisFormat of ["current","simple"] as const){
    const evidence=[];
    for(const source of ["Moomoo Open API current-session OHLCV","Alpaca current-session OHLCV"]){
      const requests:Record<string,unknown>[]=[];
      const service=new OpenAITradersLinkAiReadService({apiKey:"offline-fixture",model:"offline-fixture",fetchImpl:async(_url,options)=>{
        requests.push(JSON.parse(String(options?.body)));
        return new Response(JSON.stringify({error:{message:"Offline request capture only"}}),{status:503});
      }});
      await assert.rejects(service.generate({snapshot,priceAction:{...base,source},analysisFormat,ownerReviewRequired:true,
        research:{ticker:"TEST",businessDays:5,count:0,articles:[]}}));
      assert(requests.length>0,"Actual service must prepare an outgoing request");
      const input=requests[0].input as {role:string;content:{text:string}[]}[];
      const user=input.find(x=>x.role==="user");assert(user);
      const payload=JSON.parse(user.content[0].text),action=payload.marketPacket.priceAction;
      const rows=[action.oneMinuteEvidence.recentOneMinuteBars,action.recentFiveMinuteBars,action.recentDailyBars,action.fourHourBars];
      assert(rows.every(x=>Array.isArray(x)&&x.length>0),`${analysisFormat} must retain all four source candle groups`);
      assert(payload.primaryCatalystResearch,"Research context remains present");
      evidence.push(rows);
    }
    assert.deepEqual(evidence[0],evidence[1],`${analysisFormat}: provider switch must not remove or rewrite candle evidence`);
  }
});
