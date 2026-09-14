import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSimpleAnalysisTestRequest, SIMPLE_ANALYSIS_SCHEMA } from '../lib/ai/watchlist-simple-analysis.js';
import { prepareSimpleAnalysisInput, supplementSimpleUpside, addHistoricalFourHourReplay, orderSimpleAnalysisPullbacks } from '../lib/ai/watchlist-simple-input.js';
import { renderSimpleAnalysisPreviewDocument } from '../lib/ai/watchlist-simple-preview.js';

test('chart-first packet removes synthetic candidate labels; raw prices survive untouched', () => {
  const bars = [
    {timestamp:0,open:.2399,close:.2376},
    {timestamp:300000,open:.2371,close:.2437},
    {timestamp:600000,open:.2433,close:.2457},
  ];
  const input = {marketPacket:{priceAction:{recentFiveMinuteBars:bars,oneMinuteEvidence:{pullbackCandidates:[{
    kind:'five_minute_acceptance',zoneLow:.2371,zoneHigh:.2457,observedFrom:0,observedTo:600000,
    rationale:'Repeated acceptance',
  }]}}}};
  const saved = JSON.stringify(input);
  const output = prepareSimpleAnalysisInput(input) as any;
  const facts = output.marketPacket.priceAction.oneMinuteEvidence;
  assert.equal(facts.structureObservations,undefined);
  assert.equal(facts.pullbackCandidates,undefined);
  assert.deepEqual(output.marketPacket.priceAction.recentFiveMinuteBars,bars);
  assert.equal(JSON.stringify(input),saved);
});

test('separate preview preserves both pullbacks and upside while excluding internal fields', () => {
  const source={symbol:'TEST',reference:1.2,read:{setup:'Example setup',selectionAudit:{secret:'INTERNAL_AUDIT'},
    pullbacks:[{low:.7,high:.8,explanation:'Deeper area',confirmation:'Wait for buyers',invalidation:.69},
      {low:1,high:1.1,explanation:'Nearer area',confirmation:'Wait for reclaim',invalidation:.99}],
    upside:[{low:1.4,high:1.5,explanation:'Resistance',evidenceRefs:['SECRET_EVIDENCE']}],
    invalidation:{price:.69,explanation:'Base fails'}}};
  const original=JSON.stringify(source);
  const html=renderSimpleAnalysisPreviewDocument([source]);
  assert.ok(html.indexOf('Nearer area')<html.indexOf('Deeper area'));
  assert.ok(html.includes('$1.4–$1.5'));
  assert.ok(html.includes('Thesis invalidation'));
  assert.ok(!html.includes('INTERNAL_AUDIT')&&!html.includes('SECRET_EVIDENCE'));
  assert.equal(JSON.stringify(source),original);
});

test('preview escapes model text and omits absent sections without blocking valid content', () => {
  const html=renderSimpleAnalysisPreviewDocument([{symbol:'<script>bad</script>',reference:.2482,
    read:{setup:'<img src=x onerror=bad()>',pullbacks:[],upside:[],invalidation:null}}]);
  assert.ok(!html.includes('<script>')&&!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<h3>Pullback')&&!html.includes('<h3>Thesis invalidation'));
  assert.ok(html.includes('$0.2482'));
});

test('historical discontinuity is flagged, not explained or silently adjusted', () => {
  const daily = [{dateIso:'2026-09-02',close:4.9},{dateIso:'2026-09-03',close:.507}];
  const output = prepareSimpleAnalysisInput({marketPacket:{priceAction:{recentDailyBars:daily}}}) as any;
  assert.equal(output.marketPacket.priceAction.historicalPriceDiscontinuities.length,1);
  assert.deepEqual(output.marketPacket.priceAction.recentDailyBars,daily);
});

test('isolated prototype requests only the useful analysis sections, once', () => {
  assert.deepEqual(Object.keys(SIMPLE_ANALYSIS_SCHEMA.properties), ['selectionAudit','setup','pullbacks','upside','invalidation']);
  const packet = { marketPacket: { symbol: 'SOAR', currentPrice: 0.2482 } };
  const request = buildSimpleAnalysisTestRequest(packet);
  assert.equal(request.input.length, 2);
  assert.equal(request.max_output_tokens, 16000);
  assert.deepEqual(JSON.parse(request.input[1]!.content[0]!.text), packet);
  assert.equal('tools' in request, false);
  assert.equal('background' in request, false);
  assert.match(request.input[0]!.content[0]!.text, /No candle clock times/);
  assert.match(request.input[0]!.content[0]!.text, /Use regularSessionExtremes/);
  assert.match(request.input[0]!.content[0]!.text, /Do not add a separate recovery scenario/);
  assert.match(request.input[0]!.content[0]!.text, /not mechanically the oldest low/);
  assert.match(request.input[0]!.content[0]!.text, /Keep the meaningful lower area as the sole Pullback/);
  assert.equal((SIMPLE_ANALYSIS_SCHEMA.properties.upside as {maxItems:number}).maxItems, 4);
});

test('full regular-session extrema include the open and newer one-minute prices', () => {
  const result = prepareSimpleAnalysisInput({marketPacket:{priceAction:{
    sessionPhaseSummaries:[{session:'regular',high:.48}],
    recentFiveMinuteBars:[{session:'opening_range',high:.5098,low:.4397},{session:'regular',high:.48,low:.4218}],
    oneMinuteEvidence:{recentOneMinuteBars:[{session:'regular',high:.51,low:.45}]},
  }}}) as any;
  assert.equal(result.marketPacket.priceAction.regularSessionExtremes.high,.51);
  assert.equal(result.marketPacket.priceAction.regularSessionExtremes.low,.4218);
  assert.equal(result.marketPacket.priceAction.sessionPhaseSummaries[0].session,'regular_after_opening_range');
});

test('outer supplement preserves model areas and adds only one farther mapped level', () => {
  const read = {upside:[{low:24.66,high:25.03,explanation:'Original explanation'}]};
  const packet = {currentPrice:22.52,priceAction:{recentDailyBars:[{dateIso:'2026-09-01',high:30}]},frozenResistanceSupplement:{generationId:'saved',levels:[{price:27.5},{price:30}]}};
  const result = supplementSimpleUpside(read,packet);
  assert.equal(result.upside.length,2);
  assert.deepEqual(result.upside[0],read.upside[0]);
  assert.equal(result.upside[1].high,30);
  assert.equal(read.upside.length,1);
  assert.equal(supplementSimpleUpside(result,packet),result);
  assert.equal(supplementSimpleUpside(read,{currentPrice:22.52}),read);
});

test('ELMT rounded 27.50 and 30 extensions are neither sent nor appended without candle evidence', () => {
  const packet = {currentPrice:22.52,priceAction:{recentDailyBars:[{dateIso:'2026-09-14',high:25.03}]},
    frozenResistanceSupplement:{levels:[{price:27.5},{price:30}]}};
  const before = JSON.stringify(packet);
  const prepared = prepareSimpleAnalysisInput({marketPacket:packet}) as any;
  assert.deepEqual(prepared.marketPacket.frozenResistanceSupplement.levels,[]);
  const read = {upside:[{low:24.66,high:25.03}]};
  assert.equal(supplementSimpleUpside(read,packet),read);
  assert.equal(JSON.stringify(packet),before);
});

test('broader real resistance survives beyond 30 percent without deleting intermediate AI areas', () => {
  const read = {upside:[{low:5.8,high:6.1},{low:6.9,high:7.1}]};
  const packet = {currentPrice:6,priceAction:{recentDailyBars:[{dateIso:'2026-09-01',high:9.48}]},
    frozenResistanceSupplement:{levels:[{price:9.48}]}};
  const result = supplementSimpleUpside(read,packet);
  assert.deepEqual(result.upside.slice(0,2),read.upside);
  assert.equal(result.upside[2].high,9.48);
  assert.doesNotMatch(result.upside[2].explanation,/mapped/);
  assert.equal(supplementSimpleUpside(result,packet),result);
});

test('four-hour resistance is retained and an explicitly synthetic point is not relabeled', () => {
  const packet = {currentPrice:6,priceAction:{fourHourBars:[{timestamp:1000,high:9.48}]},
    frozenResistanceSupplement:{levels:[{price:9.48},{price:9.48,synthetic:true}]}};
  const result = prepareSimpleAnalysisInput({marketPacket:packet}) as any;
  assert.equal(result.marketPacket.frozenResistanceSupplement.levels.length,1);
  assert.equal(result.marketPacket.frozenResistanceSupplement.levels[0].price,9.48);
  assert.deepEqual(result.marketPacket.priceAction.fourHourBars,packet.priceAction.fourHourBars);
});

test('packet identifies Eastern reference time and missing timeframes without changing candles', () => {
  const input = {marketPacket:{dataAsOf:Date.parse('2026-09-14T16:06:00Z'),marketSession:'regular',
    priceAction:{recentDailyBars:[{dateIso:'2026-09-11',high:25}],
      recentFiveMinuteBars:[{timestamp:Date.parse('2026-09-14T16:00:00Z'),high:24,low:23}]}}};
  const before = JSON.stringify(input);
  const result = prepareSimpleAnalysisInput(input) as any;
  assert.equal(result.marketPacket.marketClock.localTime,'12:06');
  assert.equal(result.marketPacket.marketClock.localDate,'2026-09-14');
  assert.equal(result.marketPacket.candleCoverage['4h'].available,false);
  assert.equal(result.marketPacket.candleCoverage.daily.bars,1);
  assert.equal(JSON.stringify(input),before);
});

test('Eastern reference clock handles winter offset and missing as-of safely', () => {
  const winter = prepareSimpleAnalysisInput({marketPacket:{dataAsOf:Date.parse('2026-01-14T16:06:00Z')}}) as any;
  assert.equal(winter.marketPacket.marketClock.localTime,'11:06');
  assert.equal((prepareSimpleAnalysisInput({marketPacket:{}}) as any).marketPacket.marketClock,undefined);
});

test('historical four-hour replay preserves original daily and same-day facts', () => {
  const cutoff=Date.parse('2026-09-12T00:00:00Z');
  const input={marketPacket:{symbol:'FTFT',dataAsOf:Date.parse('2026-09-14T16:06:00Z'),
    priceAction:{recentDailyBars:[{close:4}],recentFiveMinuteBars:[{high:5.25}],timeframes:['1m','5m','1d']}}};
  const supplement={symbol:'FTFT',cutoff,provider:'eodhd',candles:[{
    timestamp:cutoff-14400000,open:4,high:5,low:3,close:4.5,volume:100,
  }]};
  const saved=JSON.stringify(input);
  const result=addHistoricalFourHourReplay(input,supplement);
  assert.deepEqual(result.marketPacket.priceAction.recentDailyBars,input.marketPacket.priceAction.recentDailyBars);
  assert.deepEqual(result.marketPacket.priceAction.recentFiveMinuteBars,input.marketPacket.priceAction.recentFiveMinuteBars);
  assert.equal((prepareSimpleAnalysisInput(result) as any).marketPacket.candleCoverage['4h'].bars,1);
  assert.equal(JSON.stringify(input),saved);
  assert.throws(()=>addHistoricalFourHourReplay(input,{...supplement,symbol:'ELMT'}));
  assert.throws(()=>addHistoricalFourHourReplay(input,{...supplement,candles:[{...supplement.candles[0],timestamp:cutoff}]}));
  assert.throws(()=>addHistoricalFourHourReplay(input,{...supplement,candles:[{...supplement.candles[0],high:2}]}));
});

test('presentation orders nearer pullback first without rewriting or removing either setup', () => {
 const read={pullbacks:[{low:1.72,high:1.85,explanation:'Deeper base'},
  {low:2.18,high:2.30,explanation:'Postmarket base'}],upside:[{high:4.72}]};
 const original=JSON.stringify(read);
 const ordered=orderSimpleAnalysisPullbacks(read);
 assert.equal(ordered.pullbacks[0],read.pullbacks[1]);
 assert.equal(ordered.pullbacks[1],read.pullbacks[0]);
 assert.equal(ordered.upside,read.upside);
 assert.equal(JSON.stringify(read),original);
 assert.equal(orderSimpleAnalysisPullbacks(ordered),ordered);
});
