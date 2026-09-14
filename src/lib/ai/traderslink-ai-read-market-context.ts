import type { Candle } from "../market-data/candle-types.js";
import type { LevelEngineOutput } from "../levels/level-types.js";
import { classifyIntradayCandleTimestamp } from "../market-data/candle-session-classifier.js";
import { getUsEquityTradingDay, newYorkDateTimeParts } from "../market-data/us-equity-exchange-calendar.js";

const DAY = 86_400_000;

/** Chronological expansion context, not a selected support or failure level. */
export function observedSessionExpansion(candles: Candle[], asOf: number) {
  const date = classifyIntradayCandleTimestamp(asOf).sessionDate;
  const bars = candles.filter(bar => {
    const stamp = classifyIntradayCandleTimestamp(bar.timestamp);
    return Number.isFinite(bar.timestamp) && bar.timestamp <= asOf &&
      stamp.sessionDate === date && stamp.session !== "extended" &&
      [bar.open, bar.high, bar.low, bar.close].every(price => Number.isFinite(price) && price > 0) &&
      bar.low <= Math.min(bar.open, bar.close) && bar.high >= Math.max(bar.open, bar.close);
  }).sort((a, b) => a.timestamp - b.timestamp);
  let lowestEarlier: Candle | undefined;
  let advance: { fromPrice: number; fromTime: number; toPrice: number; toTime: number; gainPct: number } | null = null;
  for (const bar of bars) {
    // A candle's low/high sequence is unknown: never infer a rally within it.
    if (lowestEarlier && lowestEarlier.timestamp < bar.timestamp && bar.high > lowestEarlier.low) {
      const gainPct = (bar.high / lowestEarlier.low - 1) * 100;
      if (!advance || gainPct > advance.gainPct) {
        advance = { fromPrice: lowestEarlier.low, fromTime: lowestEarlier.timestamp,
          toPrice: bar.high, toTime: bar.timestamp, gainPct };
      }
    }
    if (!lowestEarlier || bar.low < lowestEarlier.low) lowestEarlier = bar;
  }
  return { sessionDate: date, timeframe: "5m", observedBars: bars.length,
    observedFrom: bars[0]?.timestamp ?? null, observedTo: bars.at(-1)?.timestamp ?? null,
    largestObservedAdvance: advance,
    interpretation: "Largest low-to-later-high advance within the supplied same-day five-minute coverage, including available premarket. Not proof of the catalyst origin, complete session coverage, a support base, or thesis invalidation. Compare the full chronology and historical structure; a later one-minute impulse may be nested within this move." };
}

/** Historical bases remain selectable when a saved Levels snapshot is absent.
 * These are observations, not a claim that historical support survived news. */
export function historicalAnalysisBases(candles: Candle[], timeframe: "daily" | "4h", reference: number, asOf: number) {
  const today = classifyIntradayCandleTimestamp(asOf).sessionDate;
  const completed = candles.filter(bar => Number.isFinite(bar.timestamp) && bar.timestamp <= asOf &&
    new Date(bar.timestamp).toISOString().slice(0, 10) < today &&
    [bar.open, bar.high, bar.low, bar.close].every(price => Number.isFinite(price) && price > 0) &&
    bar.low <= Math.min(bar.open, bar.close) && bar.high >= Math.max(bar.open, bar.close))
    .sort((a, b) => a.timestamp - b.timestamp);
  const candidates: Array<{id:string;kind:string;timeframe:"daily"|"4h";zoneLow:number;zoneHigh:number;
    observedFrom:number;observedTo:number;laterClosesBelow:number;latestHistoricalClose:number;
    evidenceBars:Array<Pick<Candle,"timestamp"|"open"|"high"|"low"|"close">>;rationale:string}> = [];
  for (let index = completed.length - 3; index >= 0; index--) {
    const window = completed.slice(index, index + 3);
    if (window[2]!.timestamp - window[0]!.timestamp > 8 * DAY ||
      window.some((bar, i) => i > 0 && bar.timestamp <= window[i - 1]!.timestamp)) continue;
    const lows = window.map(bar => Math.min(bar.open, bar.close)).sort((a,b) => a-b);
    const highs = window.map(bar => Math.max(bar.open, bar.close)).sort((a,b) => a-b);
    if (lows[2]! > highs[0]!) continue;
    const zoneLow = lows[1]!, zoneHigh = highs[1]!;
    if (zoneLow >= zoneHigh || zoneHigh >= reference ||
      candidates.some(zone => zone.zoneLow <= zoneHigh && zone.zoneHigh >= zoneLow)) continue;
    const later = completed.slice(index + 3);
    candidates.push({id:`historical-base:${timeframe}:${window[0]!.timestamp}`,kind:"historical_acceptance",
      timeframe,zoneLow,zoneHigh,observedFrom:window[0]!.timestamp,observedTo:window[2]!.timestamp,
      laterClosesBelow:later.filter(bar=>bar.close<zoneLow).length,
      latestHistoricalClose:completed.at(-1)!.close,
      evidenceBars:window.map(bar=>({timestamp:bar.timestamp,open:bar.open,high:bar.high,low:bar.low,close:bar.close})),
      rationale:"Three completed historical candle bodies overlap. Bounds are their middle body boundaries. Inspect subsequent breaks, reclaims and the current session before assigning a dip or recovery role; historical acceptance is not proof of current support."});
    if (candidates.length === 4) break;
  }
  return candidates;
}

export function previousTradingDate(asOf: number): string {
  const today = classifyIntradayCandleTimestamp(asOf).sessionDate;
  const midnight = Date.parse(`${today}T00:00:00Z`);
  for (let days = 1; days <= 14; days++) {
    const date = new Date(midnight - days * DAY).toISOString().slice(0, 10);
    if (getUsEquityTradingDay(date).isTradingDay) return date;
  }
  throw new Error("No previous trading session resolved for analysis.");
}

function easternHour(date: string, hour: number): number {
  // At UTC noon New York is on the same date, including across DST changes.
  const noon = Date.parse(`${date}T12:00:00Z`);
  const local = newYorkDateTimeParts(noon)!;
  return noon + (hour - local.hour) * 3_600_000;
}

export function previousTradingSessionWindow(asOf: number) {
  const date = previousTradingDate(asOf);
  return { date, fromTimeMs: easternHour(date, 4), toTimeMs: easternHour(date, 20) };
}

export function selectAnalysisSessions(candles: Candle[], asOf: number): Candle[] {
  const today = classifyIntradayCandleTimestamp(asOf).sessionDate;
  const previous = previousTradingDate(asOf);
  return candles.filter((bar) => {
    const stamp = classifyIntradayCandleTimestamp(bar.timestamp);
    return bar.timestamp <= asOf && stamp.session !== "extended" &&
      (stamp.sessionDate === today || stamp.sessionDate === previous);
  });
}

export function datedPreviousRegularSession(daily: Candle[], asOf: number) {
  const date = previousTradingDate(asOf);
  // Historical daily candles are session-date labels in UTC, not intraday NY timestamps.
  const bar = daily.findLast((item) => new Date(item.timestamp).toISOString().slice(0, 10) === date);
  return { date, source: "completed_daily_candle", available: Boolean(bar),
    open: bar?.open ?? null, high: bar?.high ?? null,
    low: bar?.low ?? null, close: bar?.close ?? null };
}

export function sessionReferencePrices(fiveMinute: Candle[], oneMinute: Candle[], asOf: number) {
  const today = classifyIntradayCandleTimestamp(asOf).sessionDate;
  const previous = previousTradingDate(asOf);
  const groups = new Map<string, Candle[]>();
  // Extrema may use both resolutions. Do NOT sum their overlapping volumes.
  for (const bar of [...fiveMinute, ...oneMinute]) {
    if (bar.timestamp > asOf) continue;
    const stamp = classifyIntradayCandleTimestamp(bar.timestamp);
    if (stamp.sessionDate !== today && stamp.sessionDate !== previous) continue;
    if (stamp.session === "extended") continue;
    const session = stamp.session === "opening_range" ? "regular" : stamp.session;
    for (const key of [`${stamp.sessionDate}:${session}`, `${stamp.sessionDate}:all_sessions`]) {
      const group = groups.get(key) ?? [];
      group.push(bar);
      groups.set(key, group);
    }
  }
  return [previous, today].flatMap((date) =>
    ["premarket", "regular", "after_hours", "all_sessions"].map((session) => {
      const bars = groups.get(`${date}:${session}`) ?? [];
      const high = bars.reduce<Candle | null>((best, bar) => !best || bar.high > best.high ? bar : best, null);
      const low = bars.reduce<Candle | null>((best, bar) => !best || bar.low < best.low ? bar : best, null);
      return { date, session, available: bars.length > 0,
        high: high?.high ?? null, highAt: high?.timestamp ?? null,
        low: low?.low ?? null, lowAt: low?.timestamp ?? null,
        firstObservedAt: bars.length ? Math.min(...bars.map((bar) => bar.timestamp)) : null,
        lastObservedAt: bars.length ? Math.max(...bars.map((bar) => bar.timestamp)) : null,
        coverage: "observed_bars_only" };
    }));
}

export function analysisLevelContext(output: LevelEngineOutput | undefined, reference: number, asOf: number, calculationCutoff = asOf) {
  if (!output || !Number.isFinite(calculationCutoff) || !Number.isFinite(output.generatedAt) || output.generatedAt > calculationCutoff) return null;
  const zones = [...output.majorSupport, ...output.majorResistance,
    ...output.intermediateSupport, ...output.intermediateResistance,
    ...output.intradaySupport, ...output.intradayResistance,
    ...output.extensionLevels.support, ...output.extensionLevels.resistance,
    ...(output.fullLadderLevels?.support ?? []), ...(output.fullLadderLevels?.resistance ?? [])];
  const seen = new Set<string>();
  return { generatedAt: output.generatedAt, calculationCutoff, observationCutoff: asOf, metadata: output.metadata,
    levels: zones.filter((zone) => {
      if (seen.has(zone.id) || !Number.isFinite(zone.firstTimestamp) ||
          !Number.isFinite(zone.lastTimestamp) || zone.firstTimestamp > asOf || zone.lastTimestamp > asOf) return false;
      seen.add(zone.id);
      return true;
    }).map((zone) => ({ id: zone.id, low: zone.zoneLow, high: zone.zoneHigh,
      price: zone.representativePrice,
      position: zone.zoneHigh < reference ? "below_price" : zone.zoneLow > reference ? "above_price" : "at_price",
      timeframes: zone.timeframeSources, sources: zone.sourceTypes,
      touches: zone.touchCount, formedAt: zone.firstTimestamp, lastObservedAt: zone.lastTimestamp,
      provenance: zone.marketDataProvenance ?? null })) };
}

/** Compact only the outgoing copy; validators retain their typed source candles. */
export function compactAnalysisCandleTransport(packet: Record<string, unknown>): Record<string, unknown> {
  const columns = ["timestamp", "open", "high", "low", "close", "volume"];
  const rows = (value: unknown) => (value as Record<string, unknown>[]).map((bar) =>
    columns.map((key) => bar[key] ?? null));
  const result = { ...packet };
  for (const key of ["recentFiveMinuteBars", "recentDailyBars", "fourHourBars"]) {
    if (Array.isArray(result[key])) result[key] = rows(result[key]);
  }
  const evidence = result.oneMinuteEvidence as Record<string, unknown> | undefined;
  if (evidence && Array.isArray(evidence.recentOneMinuteBars)) {
    result.oneMinuteEvidence = { ...evidence, recentOneMinuteBars: rows(evidence.recentOneMinuteBars) };
  }
  return { ...result, candleColumns: columns,
    candleEncoding: "UTC epoch milliseconds; daily timestamps label trading dates; null volume means unavailable; intraday sessions use America/New_York" };
}
