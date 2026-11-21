/** Versioned TraderLink server-to-server vocabulary. Upstream adapters remain private. */
export const GATEWAY_WIRE_VERSION = "traderslink.market.1";
export const GATEWAY_WIRE_ROUTES = {
  health: "availability", "scanner-listings": "instrument-rules", calendar: "trading-days",
  "vwap-seed": "weighted-reference", "analyzer-splits": "capital-adjustments",
  "chart-overnight-history": "extended-candles", history: "candle-window", quotes: "market-state",
  overnight: "extended-price", bars: "recent-candles", stream: "chart-updates",
  "scanner-stream": "scanner-updates", prices: "price-updates", halts: "trading-pauses",
} as const;
export type GatewayOperation = keyof typeof GATEWAY_WIRE_ROUTES;
export function gatewayWirePath(operation: GatewayOperation): string {
  return `traderslink/v1/market/${GATEWAY_WIRE_ROUTES[operation]}`;
}
export function gatewayWireOperation(pathname: string): GatewayOperation | null {
  return (Object.keys(GATEWAY_WIRE_ROUTES) as GatewayOperation[]).find(key => "/" + gatewayWirePath(key) === pathname) ?? null;
}

type Spec = "scalar" | { fields: Fields } | { each: Spec } | { values: Spec };
type Fields = Record<string, readonly [string, Spec]>;
const scalar = "scalar" as const;
const record = (fields: Fields): Spec => ({ fields });
const array = (each: Spec): Spec => ({ each });
const dictionary = (values: Spec): Spec => ({ values });
const nullable = (spec: Spec) => spec; // Null is preserved by every node, never turned into a number.
const simple = (names: Record<string, string>): Spec => record(Object.fromEntries(Object.entries(names).map(([key, name]) => [key, [name, scalar]])));
const candle = simple({time:"at",open:"first",high:"peak",low:"trough",close:"last",volume:"shares"});
const rawBar = simple({T:"recordKind",S:"ticker",t:"observed",o:"first",h:"peak",l:"trough",c:"last",v:"shares",vw:"weighted",n:"prints"});
const trade = record({T:["recordKind",scalar],S:["ticker",scalar],t:["observed",scalar],p:["value",scalar],s:["shares",scalar],i:["sequence",scalar],x:["venue",scalar],c:["conditions",array(scalar)],z:["tape",scalar]});
const quote = record({T:["recordKind",scalar],S:["ticker",scalar],t:["observed",scalar],bp:["buyValue",scalar],bs:["buyShares",scalar],bx:["buyVenue",scalar],ap:["sellValue",scalar],as:["sellShares",scalar],ax:["sellVenue",scalar],c:["conditions",array(scalar)],z:["tape",scalar]});
const pause = simple({symbol:"ticker",halted:"paused",haltedAt:"pausedSince",observedAt:"observed",statusCode:"stateCode",reasonCode:"causeCode",reason:"explanation",tape:"listingTape",quoteResumedAt:"quotesAt",tradeResumedAt:"tradesAt",pauseObservedAt:"pauseSeenAt"});
const previous = simple({symbol:"ticker",price:"value",barAt:"candleAt",adjustment:"basis",basisDate:"basisDay",fetchedAt:"received"});
const snapshot = record({latestTrade:["lastPrint",trade],latestQuote:["bestPrices",quote],dailyBar:["dayCandle",rawBar],minuteBar:["minuteCandle",rawBar],prevDailyBar:["priorDayCandle",rawBar],adjustedPreviousClose:["priorClose",previous],tradingStatus:["tradingState",pause]});
const sessionTotal = simple({volume:"shares",dollarVolume:"turnover",high:"peak",low:"trough",price:"value",providerAt:"observed"});
const sessionState = record({date:["day",scalar],regularClose:["closeMinute",scalar],complete:["finished",scalar],sessions:["periods",record({premarket:["beforeOpen",sessionTotal],regular:["openMarket",sessionTotal],after_hours:["afterClose",sessionTotal]})]});
const session = simple({date:"day",open:"opens",close:"closes"});
const calendar = record({available:["usable",scalar],start:["fromDay",scalar],end:["untilDay",scalar],sessions:["days",array(session)]});
const request = simple({symbol:"ticker",timeframe:"interval",anchor:"reference",before:"until",premarket:"beforeOpen",regular:"openMarket",postmarket:"afterClose"});
const events = record({symbol:["ticker",scalar],anchor:["reference",scalar],basisDate:["basisDay",scalar],dates:["days",array(scalar)],available:["usable",scalar]});
const sums = simple({open:"first",high:"peak",low:"trough",close:"last",hl2:"midpoint",hlc3:"typical",ohlc4:"average",hlcc4:"weightedClose"});
const moment = simple({mean:"average",m2:"dispersion"});
const moments = record(Object.fromEntries(Object.entries({open:"first",high:"peak",low:"trough",close:"last",hl2:"midpoint",hlc3:"typical",ohlc4:"average",hlcc4:"weightedClose"}).map(([key,name])=>[key,[name,moment]])));
const history = record({symbol:["ticker",scalar],feed:["coverage",scalar],adjustment:["basis",scalar],basisDate:["basisDay",scalar],bars:["candles",array(candle)],baseTimeframe:["interval",scalar],complete:["finished",scalar],nextPageToken:["continuation",scalar],calendar:["tradingDays",calendar],calendars:["tradingYears",array(calendar)]});
const market = record({feed:["coverage",scalar],connected:["online",scalar],at:["emitted",scalar],snapshots:["instruments",dictionary(nullable(snapshot))],sessionTotals:["periodTotals",dictionary(nullable(sessionState))]});
const seed = record({events:["capitalEvents",events],complete:["finished",scalar],request:["selection",request],basisDate:["basisDay",scalar],anchorKey:["referenceDay",scalar],start:["from",scalar],volume:["shares",scalar],sums:["totals",sums],moments:["distribution",moments]});
const priceFrame = record({protocolVersion:["revision",scalar],feed:["coverage",scalar],connected:["online",scalar],kind:["change",scalar],emittedAt:["emitted",scalar],prices:["values",dictionary(simple({price:"value",providerObservedAt:"observed",receiptAt:"received"}))]});
const schemas: Record<GatewayOperation, Spec> = {
  health:simple({ready:"ready",feed:"coverage"}),"scanner-listings":record({excluded:["excluded",array(scalar)]}),calendar,
  "vwap-seed":seed,"analyzer-splits":events,"chart-overnight-history":history,history,quotes:market,
  overnight:record({feed:["coverage",scalar],symbol:["ticker",scalar],trade:["lastPrint",trade]}),bars:history,
  stream:record({state:["connection",scalar],adjustment:["basis",scalar],basisDate:["basisDay",scalar],price:["value",scalar],time:["observed",scalar],bar:["candle",candle],daily:["daily",scalar],provisional:["forming",scalar],symbol:["ticker",scalar],available:["usable",scalar],status:["tradingState",pause]}),
  "scanner-stream":market,prices:priceFrame,
  halts:record({feed:["coverage",scalar],connected:["online",scalar],statusesSubscribed:["trackingPauses",scalar],observedSince:["trackingSince",scalar],statuses:["tradingStates",array(pause)],events:["transitions",array(pause)]}),
};

function transform(spec: Spec, value: unknown, decode: boolean, budget: {nodes:number}, depth = 0): unknown {
  if (++budget.nodes > 2_000_000 || depth > 24) throw Error("market_contract_invalid");
  if (value === null) return null;
  if (spec === scalar) {
    if (typeof value !== "string" && typeof value !== "boolean" && !(typeof value === "number" && Number.isFinite(value))) throw Error("market_contract_invalid");
    return value;
  }
  if ("each" in spec) {
    if (!Array.isArray(value)) throw Error("market_contract_invalid");
    return value.map(item=>transform(spec.each,item,decode,budget,depth+1));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("market_contract_invalid");
  const object = value as Record<string,unknown>;
  if ("values" in spec) return Object.fromEntries(Object.entries(object).map(([key,item])=>{
    if (!/^[A-Z][A-Z0-9.-]{0,15}$/.test(key)) throw Error("market_contract_invalid");
    return [key,transform(spec.values,item,decode,budget,depth+1)];
  }));
  const result: Record<string,unknown> = {};
  for (const [internal,[wire,child]] of Object.entries(spec.fields)) {
    const input=decode?wire:internal;if(!Object.hasOwn(object,input)||object[input]===undefined)continue;
    const raw=object[input];
    // These are app-owned coverage names, not reversible supplier identifiers.
    const coverage=input===(decode?"coverage":"feed")
      ? decode ? raw==="consolidated"?"sip":raw==="extended"?"boats":null
      : raw==="sip"?"consolidated":raw==="boats"?"extended":null
      : undefined;
    if(coverage===null)throw Error("market_contract_invalid");
    result[decode?internal:wire]=transform(child,coverage??raw,decode,budget,depth+1);
  }
  return result;
}
export function encodeGatewayWire(operation: GatewayOperation, value: unknown): unknown {
  return {schema:GATEWAY_WIRE_VERSION,resource:GATEWAY_WIRE_ROUTES[operation],data:transform(schemas[operation],value,false,{nodes:0})};
}
export function decodeGatewayWire(operation: GatewayOperation, value: unknown): unknown {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw Error("market_contract_invalid");
  const body=value as Record<string,unknown>;
  if(body.schema!==GATEWAY_WIRE_VERSION||body.resource!==GATEWAY_WIRE_ROUTES[operation])throw Error("market_contract_invalid");
  return transform(schemas[operation],body.data,true,{nodes:0});
}

const queryNames: Record<string,string> = {symbol:"ticker",symbols:"tickers",timeframe:"resolution",start:"from",end:"until",daily:"dayBars",overnight:"extended",sessions:"periodTotals",regularClose:"closeMinute",before:"cutoff",anchor:"reference",premarket:"beforeOpen",regular:"openMarket",postmarket:"afterClose",year:"yearNumber",adjustment:"basis"};
export function gatewayWireQuery(query: URLSearchParams, decode=false): URLSearchParams {
  const result=new URLSearchParams();
  for(const [from,to] of Object.entries(queryNames)){
    const key=decode?to:from;if(query.getAll(key).length>1)throw Error("market_contract_invalid");
    if(query.has(key))result.set(decode?from:to,query.get(key)!);
  }
  if([...query.keys()].some(key=>decode?!Object.values(queryNames).includes(key):!Object.hasOwn(queryNames,key)))throw Error("market_contract_invalid");
  return result;
}
export function gatewayWireUrl(base: string | URL, operation: GatewayOperation, query=new URLSearchParams()): URL {
  const value=String(base),url=new URL(gatewayWirePath(operation),value.endsWith('/')?value:value+'/');
  url.search=gatewayWireQuery(query).toString();return url;
}
export function gatewayWireSubscription(value: unknown, decode=false): Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("market_contract_invalid");
  const source=value as Record<string,unknown>;
  const names=decode?{tickers:"symbols",closeMinute:"regularClose"}:{symbols:"tickers",regularClose:"closeMinute"};
  return Object.fromEntries(Object.entries(names).flatMap(([from,to])=>Object.hasOwn(source,from)?[[to,source[from]]]:[]));
}
/** Incremental framing; comments/retry survive and partial JSON is never emitted. */
export class GatewayWireFrames {
  private buffer="";
  private readonly decoder=new TextDecoder();
  private readonly encoder=new TextEncoder();
  constructor(private readonly operation: GatewayOperation){}
  write(chunk: Uint8Array): Uint8Array {
    this.buffer+=this.decoder.decode(chunk,{stream:true});
    if(this.buffer.length>2_000_000)throw Error("market_contract_invalid");
    let output="",end:number;
    while((end=this.buffer.indexOf('\n\n'))>=0){
      const block=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+2);
      const lines=block.split('\n'),data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart());
      if(!data.length){output+=block+'\n\n';continue;}
      const event=lines.find(line=>line.startsWith('event:'))??'event: message';
      const value=decodeGatewayWire(this.operation,JSON.parse(data.join('\n')));
      output+=`${event}\ndata: ${JSON.stringify(value)}\n\n`;
    }
    return this.encoder.encode(output);
  }
  finish():void{if(this.buffer.trim()||this.decoder.decode())throw Error("market_contract_invalid");}
}

/** Rollout gate: keep existing installations compatible until gateway-first cutover. */
export function gatewayWireEnabled(environment: Record<string,string|undefined> = process.env): boolean {
  return environment.TRADERLINK_GATEWAY_CONTRACT === GATEWAY_WIRE_VERSION;
}
