/** Evidence-prioritized historical candidates, not a forecast or publication gate. */
export function buildResistanceComparison(action: Record<string, unknown>, reference: number, asOf: number) {
  const columns = Array.isArray(action.candleColumns) ? action.candleColumns as string[] : [];
  type Bar = { timestamp: number; open: number; high: number; low: number; close: number; volume: number | null };
  const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const rows: { frame: string; date: string; high: number; close: number; retreatPct: number; previousHigh: number | null; nextHigh: number | null; nextClose: number | null; laterMaxClose: number | null; volume: number | null; timestamp: number }[] = [];
  const series = new Map<string, Bar[]>();
  const all: (typeof rows[number] & { open: number; low: number; nextTimestamp: number })[] = [];
  if (!(reference > 0) || !Number.isFinite(asOf)) return { rows: [] };
  for (const [frame, key] of [['daily', 'recentDailyBars'], ['4h', 'fourHourBars']]) {
    const source = action[key];
    if (!Array.isArray(source)) continue;
    const bars: Bar[] = source.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object') return null;
      const b = Array.isArray(raw) ? Object.fromEntries(columns.map((c, i) => [c, raw[i]])) : raw as Record<string, unknown>;
      if (!['timestamp', 'open', 'high', 'low', 'close'].every(k => number(b[k]))) return null;
      const v = b as unknown as Bar;
      if (v.timestamp <= 0 || v.timestamp > asOf || v.low <= 0 || v.high < Math.max(v.open, v.close) || v.low > Math.min(v.open, v.close)) return null;
      return { ...v, volume: number(b.volume) && b.volume >= 0 ? b.volume : null };
    }).filter((b): b is Bar => b !== null).sort((a, b) => a.timestamp - b.timestamp);
    // Conflicting OHLC at one timestamp must not manufacture confirmations.
    const conflicts = new Set<number>();
    const byTime = new Map<number, Bar>();
    for (const bar of bars) {
      const prior = byTime.get(bar.timestamp);
      if (prior && ['open','high','low','close'].some(k => prior[k as keyof Bar] !== bar[k as keyof Bar])) conflicts.add(bar.timestamp);
      if (!prior) byTime.set(bar.timestamp, bar);
    }
    bars.splice(0, bars.length, ...[...byTime.values()].filter(b => !conflicts.has(b.timestamp)));
    series.set(frame, bars);
    // Following observations establish historical context. The newest bar is not
    // presented as a confirmed rejection and remains available in the raw packet.
    const unique = new Map<number, typeof rows[number]>();
    for (let i = 0; i < bars.length - 1; i++) {
      const b = bars[i];
      if (b.high <= reference || b.close >= b.high) continue;
      const later = bars.slice(i + 1);
      unique.set(b.high, { frame, date: new Date(b.timestamp).toISOString().slice(0, 10), high: b.high, close: b.close,
        retreatPct: Math.round((b.high - b.close) / b.high * 10000) / 100,
        previousHigh: bars[i - 1]?.high ?? null, nextHigh: later[0]?.high ?? null, nextClose: later[0]?.close ?? null,
        laterMaxClose: later.length ? Math.max(...later.map(x => x.close)) : null, volume: b.volume, timestamp: b.timestamp });
      all.push({ ...unique.get(b.high)!, open: b.open, low: b.low, nextTimestamp: later[0].timestamp });
    }
    const candidates = [...unique.values()];
    const nearest = [...candidates].sort((a, b) => a.high - b.high).slice(0, 8);
    const recent = [...candidates].sort((a, b) => b.timestamp - a.timestamp).slice(0, 8);
    const selected = new Map([...nearest, ...recent].map(r => [r.timestamp, r]));
    rows.push(...selected.values());
  }
  const tick = reference < 1 ? 0.00005 : 0.005;
  const ranges = [...series.values()].flatMap(bars => bars.slice(-20).map(b => b.high - b.low)).filter(x => x > 0).sort((a,b) => a-b);
  // Only a display-candidate grouping tolerance, never a validity/entry threshold.
  const recentRange = action.recentRange as {high?: unknown;low?: unknown} | undefined;
  const sessionWidth = recentRange && number(recentRange.high) && number(recentRange.low) && recentRange.high >= recentRange.low ? recentRange.high-recentRange.low : 0;
  const groupingDistance = Math.max(tick, Math.min(reference * 0.03, Math.max((ranges[Math.floor(ranges.length / 2)] ?? tick) * 0.2, sessionWidth * 0.1)));
  const ranked = all.map(row => {
    let crossedAfter = false;
    for (const [frame, bars] of series) {
      for (const bar of bars) {
        // Daily timestamps label dates, not the intraday instant of the high.
        // Across timeframes, require a later date to avoid inventing OHLC order.
        const later = frame === row.frame ? bar.timestamp > row.timestamp : new Date(bar.timestamp).toISOString().slice(0,10) > row.date;
        if (later && bar.close > row.high + tick) { crossedAfter = true; break; }
      }
      if (crossedAfter) break;
    }
    return { ...row, crossedAfter,
      followedLower: row.nextHigh !== null && row.nextHigh < row.high && row.nextClose !== null && row.nextClose < row.close,
      lowerHalfClose: row.close <= (row.high + row.low) / 2,
    };
  }).sort((a,b) => Number(a.crossedAfter)-Number(b.crossedAfter) || Number(b.followedLower)-Number(a.followedLower) || Number(b.lowerHalfClose)-Number(a.lowerHalfClose) || b.timestamp-a.timestamp || a.high-b.high || a.frame.localeCompare(b.frame));
  const preferred: typeof ranked = [];
  for (const candidate of ranked) {
    if (!preferred.some(p => Math.abs(p.high-candidate.high) <= groupingDistance)) preferred.push(candidate);
  }
  // Retain nearby route coverage plus recent wider context; raw history remains.
  const stillOverhead = preferred.filter(r => !r.crossedAfter);
  const routeCandidates = stillOverhead.length ? stillOverhead : preferred;
  const nearest = [...routeCandidates].sort((a,b) => a.high-b.high).slice(0,6);
  const recent = [...routeCandidates].sort((a,b) => b.timestamp-a.timestamp).slice(0,3);
  const broader = routeCandidates.filter(r => r.high>=reference*1.3);
  const wider = [...[...broader].sort((a,b) => a.high-b.high).slice(0,2), ...broader.slice(0,2)];
  const shortlist = [...new Map([...nearest,...wider,...recent].map(r => [r.frame+':'+r.timestamp,r])).values()].slice(0,12).sort((a,b) => a.high-b.high).map(r => ({
    price: r.high, timeframe:r.frame, observedDate:r.date,
    close:r.close, nextHigh:r.nextHigh, nextClose:r.nextClose,
    laterClosedAbove:r.crossedAfter, nextBarFollowedLower:r.followedLower,
    nearbyAlternatives: [...new Set(ranked.filter(x => x.high!==r.high && Math.abs(x.high-r.high)<=groupingDistance).map(x=>x.high))].slice(0,6),
    selectionBasis: r.crossedAfter ? 'Historical rejection, subsequently closed above; assess present reclaim/resistance role.' : r.followedLower ? 'Closed below the high, followed by a lower high and lower close; no later supplied daily/4h close above.' : 'Closed below the high; no later supplied daily/4h close above. Confirm importance from the wider sequence.',
  }));
  return {
    explanation: 'Shortlist prioritizes observed rejection with subsequent lower highs/closes and no later close above, then closing location and recency. Nearby alternatives are grouped without averaging prices. Previously crossed highs remain in raw history for evidenced reclaim/resistance roles; absence here never prohibits them. This is a transparent selection heuristic, not measured predictive strength. Volume is context only; missing volume is not zero. Overlapping daily/4h events are not counted as separate confirmations. Raw candles remain authoritative; this is not exhaustive.',
    shortlist,
    columns: ['frame', 'date', 'high', 'close', 'retreatPct', 'previousHigh', 'nextHigh', 'nextClose', 'laterMaxClose', 'volume'],
    rows: rows.sort((a, b) => a.high - b.high || b.timestamp - a.timestamp).map(({ timestamp: _timestamp, ...r }) => Object.values(r)),
  };
}
