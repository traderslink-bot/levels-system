/** Reassess saved candidate labels without altering source candles or live code. */
export function addHistoricalFourHourReplay(input: any, supplement: any): any {
  const packet = input?.marketPacket;
  if (!packet?.symbol || packet.symbol !== supplement?.symbol ||
      !Number.isFinite(packet.dataAsOf) || !Number.isFinite(supplement.cutoff) ||
      supplement.cutoff > packet.dataAsOf || !Array.isArray(supplement.candles) ||
      supplement.candles.length === 0) throw new Error('Invalid four-hour replay identity or coverage');
  const candles = supplement.candles;
  if (candles.some((bar: any, index: number) =>
    ![bar.timestamp,bar.open,bar.high,bar.low,bar.close,bar.volume].every(Number.isFinite) ||
    bar.low <= 0 || bar.volume < 0 || bar.high < Math.max(bar.open,bar.close,bar.low) ||
    bar.low > Math.min(bar.open,bar.close) || bar.timestamp + 4*60*60*1000 > supplement.cutoff ||
    (index > 0 && bar.timestamp <= candles[index-1].timestamp))) {
    throw new Error('Invalid or look-ahead four-hour replay candles');
  }
  const copy = structuredClone(input);
  copy.marketPacket.priceAction ??= {};
  copy.marketPacket.priceAction.fourHourBars = candles.map((bar: any) => ({...bar,
    timestampIso:new Date(bar.timestamp).toISOString()}));
  copy.marketPacket.priceAction.timeframes = [...new Set([
    ...(copy.marketPacket.priceAction.timeframes ?? []),'4h',
  ])];
  copy.marketPacket.historicalReplaySupplement = {provider:supplement.provider,
    retrievedAt:supplement.retrievedAt,cutoff:supplement.cutoff,
    description:'Historical four-hour candles retrieved later for this replay, ending before the original analysis. Original daily and same-day candles are unchanged.'};
  return copy;
}

export function prepareSimpleAnalysisInput(input: unknown): unknown {
  const copy = structuredClone(input) as any;
  const packet = copy?.marketPacket;
  if (packet && Number.isFinite(packet.dataAsOf)) {
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
      .formatToParts(packet.dataAsOf);
    const part = (name: string) => parts.find(item => item.type === name)?.value;
    packet.marketClock = {timeZone:'America/New_York',
      localDate:`${part('year')}-${part('month')}-${part('day')}`,
      localTime:`${part('hour')}:${part('minute')}`,
      session:packet.marketSession ?? null,
      purpose:'Analysis reference time, not request execution time. Candle ISO timestamps are UTC. Do not print candle clock times in the read.'};
  }
  if (packet?.frozenResistanceSupplement) {
    packet.frozenResistanceSupplement.levels = observedSupplementLevels(packet);
    packet.frozenResistanceSupplement.scope = 'Only prices corroborated by supplied historical candle highs. No synthetic rounded extensions. This is not an all-time history claim.';
  }
  const action = packet?.priceAction;
  if (!action) return copy;
  packet.candleCoverage = Object.fromEntries([
    ['1m',action.oneMinuteEvidence?.recentOneMinuteBars], ['5m',action.recentFiveMinuteBars],
    ['4h',action.fourHourBars], ['daily',action.recentDailyBars],
  ].map(([timeframe,values]) => {
    const rows = Array.isArray(values) ? values : [];
    return [timeframe,{bars:rows.length,available:rows.length > 0,
      first:rows[0]?.dateIso ?? rows[0]?.timestamp ?? null,
      last:rows.at(-1)?.dateIso ?? rows.at(-1)?.timestamp ?? null}];
  }));
  // Chart-first experiment: retain source OHLCV and factual session summaries,
  // but remove synthetic candidate/impulse labels that can anchor selection.
  // The original request remains unchanged in the private diagnostic record.
  const evidence = action.oneMinuteEvidence;
  const day = typeof packet.dataAsOf === 'number'
    ? new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York'}).format(packet.dataAsOf) : null;
  const bars = [...(action.recentFiveMinuteBars ?? []), ...(evidence?.recentOneMinuteBars ?? [])]
    .filter((bar: any) => (!day || bar.sessionDate === day) &&
      (bar.session === 'regular' || bar.session === 'opening_range') &&
      Number.isFinite(bar.high) && Number.isFinite(bar.low) && bar.low > 0 && bar.high >= bar.low &&
      (!Number.isFinite(packet.dataAsOf) || bar.timestamp <= packet.dataAsOf));
  if (bars.length) {
    action.regularSessionExtremes = {sessionDate:day,high:Math.max(...bars.map((bar: any)=>bar.high)),
      low:Math.min(...bars.map((bar: any)=>bar.low)),
      includesOpeningRange:bars.some((bar: any)=>bar.session === 'opening_range'), source:'Supplied same-day regular and opening-range candles, including newer one-minute extremes'};
    for (const key of ['sessionPhaseSummaries','recentSessionReferencePoints']) {
      if (Array.isArray(action[key])) action[key] = action[key].map((summary: any) =>
        summary.session === 'regular' ? {...summary,session:'regular_after_opening_range',
          scope:'This phase excludes the opening range. Use regularSessionExtremes for full regular-session high/low.'} : summary);
    }
  }
  const daily = action.recentDailyBars;
  if (Array.isArray(daily)) {
    action.historicalPriceDiscontinuities = daily.slice(1).flatMap((bar: any, index: number) => {
      const prior = daily[index];
      if (!(prior.close > 0 && bar.close > 0)) return [];
      const ratio = bar.close / prior.close;
      if (ratio > 0.5 && ratio < 2) return [];
      return [{ priorDate: prior.dateIso, date: bar.dateIso, priorClose: prior.close, close: bar.close,
        closeRatio: ratio,
        interpretation: 'Large observed price move, which may be real. Cause is not established. Do not assume a split or data error, discard history, or use remote older prices as practical same-day objectives without current structure supporting that route.' }];
    });
  }
  if (evidence) {
    action.oneMinuteEvidence = {
      available: evidence.available,
      latestCandleAt: evidence.latestCandleAt,
      latestCandleAtIso: evidence.latestCandleAtIso,
      recentOneMinuteBars: evidence.recentOneMinuteBars,
      recentTapeRange: evidence.recentTapeRange,
    };
  }
  delete packet.breakoutEvidence;
  return copy;
}

/** Generic map labels are not provenance: older maps also contain synthetic prices. */
function observedSupplementLevels(packet: any): any[] {
  const action = packet?.priceAction ?? {};
  const bars = [
    ...(action.recentDailyBars ?? []), ...(action.fourHourBars ?? []),
    ...(action.recentFiveMinuteBars ?? []), ...(action.oneMinuteEvidence?.recentOneMinuteBars ?? []),
  ];
  return (packet?.frozenResistanceSupplement?.levels ?? []).flatMap((level: any) => {
    if (!(Number.isFinite(level.price) && level.price > 0) || level.synthetic === true) return [];
    const bar = bars.find((bar: any) => Number.isFinite(bar.high) &&
      Math.abs(bar.high - level.price) <= Math.max(0.000001, level.price * 0.00001));
    return bar ? [{...level, evidenceRefs:[`supplied-candle-high:${bar.dateIso ?? bar.timestamp}:${bar.high}`]}] : [];
  });
}

/** Presentation only: never change prices, explanations, evidence or the stored response. */
export function orderSimpleAnalysisPullbacks(read: any): any {
  if (!Array.isArray(read?.pullbacks) || read.pullbacks.length < 2 ||
      read.pullbacks.some((area: any)=>!Number.isFinite(area.high))) return read;
  const ordered=[...read.pullbacks].sort((a: any,b: any)=>b.high-a.high);
  if(ordered.every((area: any,index: number)=>area===read.pullbacks[index])) return read;
  return {...read,pullbacks:ordered};
}

/** Preserve AI areas; add at most one corroborated outer level, never a rounded invention. */
export function supplementSimpleUpside(read: any, marketPacket: any): any {
  if (!Array.isArray(read?.upside) || !(marketPacket?.currentPrice > 0)) return read;
  const furthest = Math.max(marketPacket.currentPrice, ...read.upside.map((area: any) =>
    Number.isFinite(area.high) ? area.high : marketPacket.currentPrice));
  const coverage = marketPacket.currentPrice * 1.3;
  if (furthest >= coverage) return read;
  const candidates = observedSupplementLevels(marketPacket)
    .filter((area: any) => Number.isFinite(area.price) && area.price > furthest)
    .sort((a: any,b: any)=>a.price-b.price);
  const outer = candidates.find((area: any)=>area.price >= coverage) ?? candidates.at(-1);
  if (!outer) return read;
  return {...read,upside:[...read.upside,{low:outer.price,high:outer.price,
    explanation:`$${outer.price} is a farther resistance level if momentum continues through the nearer areas.`,
    evidenceRefs:outer.evidenceRefs}]};
}
