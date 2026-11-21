import assert from "node:assert/strict";
import test from "node:test";
import { gatewayWireEnabled, gatewayWireUrl, gatewayWireSubscription, decodeGatewayWire } from "../lib/market-data/traderslink-gateway-wire.js";

test("requires the exact version and preserves the private mount with strict parameter renaming",()=>{
  assert.equal(gatewayWireEnabled({}),false);
  for(const value of ["1","true","TRADERSLINK.MARKET.1","traderslink.market.2"])assert.equal(gatewayWireEnabled({TRADERLINK_GATEWAY_CONTRACT:value}),false);
  assert.equal(gatewayWireEnabled({TRADERLINK_GATEWAY_CONTRACT:"traderslink.market.1"}),true);
  const url=gatewayWireUrl("https://gateway.invalid/private/","history",new URLSearchParams({symbol:"TEST",timeframe:"1Min",start:"1000",end:"2000",adjustment:"raw"}));
  assert.equal(url.pathname,"/private/traderslink/v1/market/candle-window");
  assert.deepEqual(Object.fromEntries(url.searchParams),{ticker:"TEST",resolution:"1Min",from:"1000",until:"2000",basis:"raw"});
  assert.throws(()=>gatewayWireUrl("https://gateway.invalid/","quotes",new URLSearchParams("symbols=TEST&symbols=OTHER")));
  assert.throws(()=>gatewayWireUrl("https://gateway.invalid/","quotes",new URLSearchParams("symbols=TEST&apiKey=private")));
  assert.deepEqual(gatewayWireSubscription({symbols:["TEST"],regularClose:780}),{tickers:["TEST"],closeMinute:780});
});

test("neutral quote mapping keeps precision, original observation strings, missing values and actual source identity",()=>{
  const observed="2026-11-20T15:00:00.123456789Z";
  const decoded=decodeGatewayWire("quotes",{schema:"traderslink.market.1",resource:"market-state",data:{coverage:"consolidated",online:true,emitted:1795186800123,instruments:{TEST:{lastPrint:{recordKind:"t",ticker:"TEST",value:.0277,observed,shares:123,venue:"Q",conditions:["@"],tape:"C"},bestPrices:{buyValue:.0276,sellValue:.0278,buyShares:500,sellShares:1000,observed}},EMPTY:null},periodTotals:{TEST:null}}});
  assert.deepEqual(decoded,{feed:"sip",connected:true,at:1795186800123,snapshots:{TEST:{latestTrade:{T:"t",S:"TEST",t:observed,p:.0277,s:123,x:"Q",c:["@"],z:"C"},latestQuote:{t:observed,bp:.0276,bs:500,ap:.0278,as:1000}},EMPTY:null},sessionTotals:{TEST:null}});
  assert.throws(()=>decodeGatewayWire("quotes",{schema:"traderslink.market.1",resource:"candle-window",data:{}}));
});
