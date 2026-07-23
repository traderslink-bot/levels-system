import type { Candle } from "../market-data/candle-types.js";
import { classifyIntradayCandleTimestamp } from "../market-data/candle-session-classifier.js";

const RECENT_INTRADAY_BAR_LIMIT = 120;
const RECENT_ONE_MINUTE_BAR_LIMIT = 60;
const RECENT_DAILY_BAR_LIMIT = 120;
const HISTORICAL_OVERHEAD_MONTH_LIMIT = 24;
const HISTORICAL_OVERHEAD_WINDOW_LIMIT = 4;
const VOLUME_LANDMARK_LIMIT = 8;
const UNREPORTED_EXTENDED_WICK_CONFIRMATION_PCT = 0.03;
const MINIMUM_SIGNIFICANT_IMPULSE_GAIN_PCT = 5;
const MAXIMUM_IMPULSE_DURATION_BARS = 45;
const MINIMUM_BROADER_MOVE_GAIN_PCT = 10;
const MINIMUM_BROADER_MOVE_DURATION_BARS = 15;

export type TradersLinkAiReadPriceActionContext = {
  source: string;
  fetchedAt: number;
  priorRegularClose: number | null;
  dailyAdjustmentMode?: "adjusted_close_ratio" | "split_adjusted" | "raw" | "unknown";
  oneMinuteCandles?: Candle[];
  intradayCandles: Candle[];
  dailyCandles: Candle[];
};

export type TradersLinkAiReadPullbackCandidate = {
  id: string;
  kind:
    | "pre_impulse_base"
    | "breakout_shelf"
    | "first_consolidation"
    | "volume_shelf"
    | "broader_move_origin"
    | "one_minute_acceptance"
    | "five_minute_acceptance"
    | "five_minute_session_base";
  zoneLow: number;
  zoneHigh: number;
  observedFrom: number;
  observedTo: number;
  rationale: string;
};

export type TradersLinkAiReadReferenceQuote = {
  price: number;
  dataAsOf: number;
  source: string;
};

export type TradersLinkAiCompletedSessionWindow = {
  currentSessionDate: string;
  fromTimeMs: number;
  toTimeMs: number;
};

export type TradersLinkAiReadMarketRegime =
  | "normal"
  | "elevated"
  | "high_expansion"
  | "extreme_expansion";

export type TradersLinkAiReadMarketRegimeProfile = {
  available: boolean;
  dailyHistoryCount: number;
  gainFromPriorClosePct: number | null;
  gainFromRegularSessionOpenPct: number | null;
  gainFromCurrentSessionLowPct: number | null;
  currentSessionRangePct: number | null;
  latestSignificantImpulsePct: number | null;
  broaderSessionMovePct: number | null;
  averageDailyRange10Pct: number | null;
  averageDailyRange20Pct: number | null;
  largestDailyRange20Pct: number | null;
  currentRangeVsAverageDailyRange: number | null;
  currentPriceLocationInSessionRangePct: number | null;
  currentPriceAtOrNearSessionHigh: boolean;
  currentPriceAboveHighestSuppliedDailyHigh: boolean;
  highestObservedUpsidePrice: number | null;
  highestObservedUpsidePriceType: "current_session" | "prior_session" | "recent_daily" | null;
  distanceToHighestObservedUpsidePct: number | null;
  regime: TradersLinkAiReadMarketRegime;
  limitations: string[];
};

type CompactPriceActionBar = {
  timestamp: number;
  timestampIso: string;
  session: string;
  sessionDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  volumeDataQuality: "reported" | "unavailable";
};

type SessionPhaseSummary = {
  sessionDate: string;
  session: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  volumeDataQuality: "reported" | "partial" | "unavailable";
  approximateVwap: number | null;
  barCount: number;
};

function isValidCandle(candle: Candle): boolean {
  return Number.isFinite(candle.timestamp) &&
    Number.isFinite(candle.open) && candle.open > 0 &&
    Number.isFinite(candle.high) && candle.high > 0 &&
    Number.isFinite(candle.low) && candle.low > 0 &&
    Number.isFinite(candle.close) && candle.close > 0 &&
    Number.isFinite(candle.volume) && candle.volume >= 0 &&
    candle.high >= Math.max(candle.open, candle.close, candle.low) &&
    candle.low <= Math.min(candle.open, candle.close, candle.high);
}

function normalizeCandles(candles: Candle[], dataAsOf: number): Candle[] {
  const maximumTimestamp = dataAsOf + 5 * 60 * 1_000;
  const byTimestamp = new Map<number, Candle>();
  for (const candle of candles) {
    if (!isValidCandle(candle) || candle.timestamp > maximumTimestamp) {
      continue;
    }
    const existing = byTimestamp.get(candle.timestamp);
    if (!existing || candle.volume >= existing.volume) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

export function buildTradersLinkAiCompletedSessionWindow(
  recentCandles: Candle[],
  dataAsOf: number,
): TradersLinkAiCompletedSessionWindow | null {
  const currentSessionDate = classifyIntradayCandleTimestamp(dataAsOf).sessionDate;
  const completedSessionCandles = normalizeCandles(recentCandles, dataAsOf)
    .filter((candle) => {
      const classified = classifyIntradayCandleTimestamp(candle.timestamp);
      return classified.sessionDate !== currentSessionDate &&
        classified.session !== "extended";
    });
  if (completedSessionCandles.length === 0) {
    return null;
  }
  return {
    currentSessionDate,
    fromTimeMs: completedSessionCandles[0]!.timestamp,
    toTimeMs: completedSessionCandles.at(-1)!.timestamp + 5 * 60 * 1_000,
  };
}

export function mergeTradersLinkAiIntradayCandles(
  recentCandles: Candle[],
  completedSessionCandles: Candle[],
  dataAsOf: number,
): Candle[] {
  const currentSessionDate = classifyIntradayCandleTimestamp(dataAsOf).sessionDate;
  const merged = new Map<number, Candle>();
  for (const candle of normalizeCandles(recentCandles, dataAsOf)) {
    merged.set(candle.timestamp, candle);
  }
  for (const candle of normalizeCandles(completedSessionCandles, dataAsOf)) {
    if (classifyIntradayCandleTimestamp(candle.timestamp).sessionDate !== currentSessionDate) {
      merged.set(candle.timestamp, candle);
    }
  }
  return [...merged.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function roundPrice(value: number): number {
  return Number(value.toFixed(value < 1 ? 4 : 3));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(2));
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function exponentialMovingAverage(candles: Candle[], period: number): number | null {
  if (candles.length === 0) {
    return null;
  }
  const multiplier = 2 / (period + 1);
  let value = candles[0]!.close;
  for (const candle of candles.slice(1)) {
    value = candle.close * multiplier + value * (1 - multiplier);
  }
  return value;
}

function approximateVwap(candles: Candle[]): number | null {
  const reported = candles.filter((candle) => candle.volume > 0);
  const volume = reported.reduce((sum, candle) => sum + candle.volume, 0);
  if (volume <= 0) {
    return null;
  }
  return reported.reduce(
    (sum, candle) => sum + ((candle.high + candle.low + candle.close) / 3) * candle.volume,
    0,
  ) / volume;
}

function candidateFromCandles(args: {
  id: string;
  kind: TradersLinkAiReadPullbackCandidate["kind"];
  candles: Candle[];
  rationale: string;
  bodyOnly?: boolean;
}): TradersLinkAiReadPullbackCandidate | null {
  if (args.candles.length === 0) {
    return null;
  }
  const lows = args.candles.map((candle) => args.bodyOnly
    ? Math.min(candle.open, candle.close)
    : candle.low);
  const highs = args.candles.map((candle) => args.bodyOnly
    ? Math.max(candle.open, candle.close)
    : candle.high);
  const zoneLow = Math.min(...lows);
  const zoneHigh = Math.max(...highs);
  if (!(zoneLow > 0) || zoneHigh < zoneLow) {
    return null;
  }
  return {
    id: args.id,
    kind: args.kind,
    zoneLow: roundPrice(zoneLow),
    zoneHigh: roundPrice(zoneHigh),
    observedFrom: args.candles[0]!.timestamp,
    observedTo: args.candles.at(-1)!.timestamp,
    rationale: args.rationale,
  };
}

function materiallySeparatedCandidates(
  candidates: TradersLinkAiReadPullbackCandidate[],
): TradersLinkAiReadPullbackCandidate[] {
  const separated: TradersLinkAiReadPullbackCandidate[] = [];
  for (const candidate of candidates
    .filter((item) => item.zoneLow > 0 && item.zoneHigh >= item.zoneLow)
    .sort((left, right) => right.zoneHigh - left.zoneHigh)) {
    const duplicate = separated.some((existing) => {
      if (existing.kind !== candidate.kind) {
        return false;
      }
      const overlap = Math.max(0, Math.min(existing.zoneHigh, candidate.zoneHigh) -
        Math.max(existing.zoneLow, candidate.zoneLow));
      const narrowerWidth = Math.max(
        0.0001,
        Math.min(existing.zoneHigh - existing.zoneLow, candidate.zoneHigh - candidate.zoneLow),
      );
      return overlap / narrowerWidth >= 0.65;
    });
    if (!duplicate) {
      separated.push(candidate);
    }
  }

  // Preserve at least one candidate from every evidence type before allowing
  // repeated acceptance shelves to consume the bounded model packet.
  const output: TradersLinkAiReadPullbackCandidate[] = [];
  const selectedIds = new Set<string>();
  const representedKinds = new Set<TradersLinkAiReadPullbackCandidate["kind"]>();
  for (const candidate of separated) {
    if (!representedKinds.has(candidate.kind)) {
      output.push(candidate);
      selectedIds.add(candidate.id);
      representedKinds.add(candidate.kind);
    }
  }
  for (const candidate of separated) {
    if (output.length >= 8) {
      break;
    }
    if (!selectedIds.has(candidate.id)) {
      output.push(candidate);
      selectedIds.add(candidate.id);
    }
  }
  return output.slice(0, 8);
}

function buildFiveMinutePullbackCandidates(
  rawCandles: Candle[],
  currentPrice: number,
  dataAsOf: number,
): TradersLinkAiReadPullbackCandidate[] {
  const minimumReferenceSeparation = Math.max(currentPrice * 0.005, 0.0001);
  const recent = normalizeCandles(rawCandles, dataAsOf).slice(-120);
  const candidates: TradersLinkAiReadPullbackCandidate[] = [];
  for (let index = Math.max(0, recent.length - 72); index <= recent.length - 3; index += 1) {
    const window = recent.slice(index, index + 3);
    const classifications = window.map((candle) => classifyIntradayCandleTimestamp(candle.timestamp));
    const sameSession = classifications.every((classification) =>
      classification.session === classifications[0]!.session &&
      classification.sessionDate === classifications[0]!.sessionDate
    );
    const consecutive = window.slice(1).every(
      (candle, offset) => candle.timestamp - window[offset]!.timestamp <= 7.5 * 60_000,
    );
    if (!sameSession || !consecutive) {
      continue;
    }
    const bodyLows = window.map((candle) => Math.min(candle.open, candle.close));
    const bodyHighs = window.map((candle) => Math.max(candle.open, candle.close));
    if (Math.max(...bodyLows) > Math.min(...bodyHighs)) {
      continue;
    }
    const zone = candidateFromCandles({
      id: `5m-acceptance-${window[0]!.timestamp}`,
      kind: "five_minute_acceptance",
      candles: window,
      bodyOnly: true,
      rationale: "Observed three-bar five-minute body acceptance shelf.",
    });
    if (
      zone &&
      zone.zoneHigh - zone.zoneLow <= currentPrice * 0.05 &&
      zone.zoneHigh < currentPrice - minimumReferenceSeparation
    ) {
      candidates.push(zone);
    }
  }

  const sessionDates = [...new Set(recent
    .map((candle) => classifyIntradayCandleTimestamp(candle.timestamp).sessionDate))]
    .slice(-2);
  for (const sessionDate of sessionDates) {
    const sessionCandles = recent.filter((candle) =>
      classifyIntradayCandleTimestamp(candle.timestamp).sessionDate === sessionDate
    );
    if (sessionCandles.length < 3) {
      continue;
    }
    const lowIndex = sessionCandles.reduce(
      (bestIndex, candle, index) => candle.low < sessionCandles[bestIndex]!.low ? index : bestIndex,
      0,
    );
    const baseWindow = sessionCandles.slice(
      Math.max(0, lowIndex - 1),
      Math.min(sessionCandles.length, lowIndex + 2),
    );
    const base = candidateFromCandles({
      id: `5m-session-base-${sessionDate}-${sessionCandles[lowIndex]!.timestamp}`,
      kind: "five_minute_session_base",
      candles: baseWindow,
      bodyOnly: true,
      rationale: "Observed five-minute bodies around the session low form a lower reset or recovery-watch base.",
    });
    if (
      base &&
      base.zoneHigh - base.zoneLow <= currentPrice * 0.12 &&
      base.zoneHigh < currentPrice - minimumReferenceSeparation
    ) {
      candidates.push(base);
    }
  }
  return candidates;
}

function buildOneMinuteFacts(
  rawCandles: Candle[],
  fiveMinuteCandles: Candle[],
  currentPrice: number,
  dataAsOf: number,
): Record<string, unknown> {
  const minimumReferenceSeparation = Math.max(currentPrice * 0.005, 0.0001);
  const candles = normalizeCandles(rawCandles, dataAsOf);
  const fiveMinuteCandidates = buildFiveMinutePullbackCandidates(
    fiveMinuteCandles,
    currentPrice,
    dataAsOf,
  );
  if (candles.length < 12) {
    const recentFiveMinute = normalizeCandles(fiveMinuteCandles, dataAsOf).slice(-24);
    return {
      available: false,
      reason: "Fewer than 12 usable one-minute candles were available.",
      fiveMinuteFallbackAvailable: fiveMinuteCandidates.length > 0,
      pullbackCandidates: materiallySeparatedCandidates(fiveMinuteCandidates),
      recentOneMinuteBars: candles.slice(-RECENT_ONE_MINUTE_BAR_LIMIT).map(compactIntradayBar),
      recentFiveMinuteBars: recentFiveMinute.map(compactIntradayBar),
    };
  }

  const search = candles.slice(-180);
  let best: { startIndex: number; endIndex: number; gainPct: number; score: number } | null = null;
  for (let endIndex = 2; endIndex < search.length; endIndex += 1) {
    const firstStart = Math.max(0, endIndex - MAXIMUM_IMPULSE_DURATION_BARS);
    for (let startIndex = firstStart; startIndex <= endIndex - 2; startIndex += 1) {
      const start = search[startIndex]!;
      const end = search[endIndex]!;
      const durationMinutes = Math.max(1, (end.timestamp - start.timestamp) / 60_000);
      const gainPct = (end.high - start.low) / start.low * 100;
      if (gainPct < MINIMUM_SIGNIFICANT_IMPULSE_GAIN_PCT) {
        continue;
      }
      const recencyWeight = endIndex / Math.max(1, search.length - 1);
      const score = gainPct + gainPct / durationMinutes * 3 + recencyWeight * 2;
      if (!best || score > best.score || (score === best.score && endIndex > best.endIndex)) {
        best = { startIndex, endIndex, gainPct, score };
      }
    }
  }

  const currentSessionDate = classifyIntradayCandleTimestamp(dataAsOf).sessionDate;
  const sessionSearch = candles
    .filter((candle) => classifyIntradayCandleTimestamp(candle.timestamp).sessionDate === currentSessionDate)
    .slice(-600);
  let broaderBest: { startIndex: number; endIndex: number; gainPct: number } | null = null;
  for (let endIndex = MINIMUM_BROADER_MOVE_DURATION_BARS; endIndex < sessionSearch.length; endIndex += 1) {
    for (let startIndex = 0; startIndex <= endIndex - MINIMUM_BROADER_MOVE_DURATION_BARS; startIndex += 1) {
      const start = sessionSearch[startIndex]!;
      const end = sessionSearch[endIndex]!;
      const gainPct = (end.high - start.low) / start.low * 100;
      if (gainPct < MINIMUM_BROADER_MOVE_GAIN_PCT) {
        continue;
      }
      if (
        !broaderBest ||
        gainPct > broaderBest.gainPct ||
        (gainPct === broaderBest.gainPct && startIndex < broaderBest.startIndex)
      ) {
        broaderBest = { startIndex, endIndex, gainPct };
      }
    }
  }

  const recent = candles.slice(-RECENT_ONE_MINUTE_BAR_LIMIT);
  const sessionVwap = approximateVwap(candles);
  const ema9 = exponentialMovingAverage(recent, 9);
  const ema20 = exponentialMovingAverage(recent, 20);
  const latest = candles.at(-1)!;
  const candidates: Array<TradersLinkAiReadPullbackCandidate | null> = [];
  let impulse: Record<string, unknown> | null = null;
  let broaderSessionMove: Record<string, unknown> | null = null;
  let firstConsolidation: Record<string, unknown> | null = null;

  if (best) {
    const start = search[best.startIndex]!;
    const end = search[best.endIndex]!;
    const impulseCandles = search.slice(best.startIndex, best.endIndex + 1);
    const preImpulse = search.slice(Math.max(0, best.startIndex - 8), best.startIndex);
    const postImpulse = search.slice(best.endIndex + 1, Math.min(search.length, best.endIndex + 9));
    const durationMinutes = Math.max(1, Math.round((end.timestamp - start.timestamp) / 60_000));
    const precedingVolumes = search
      .slice(Math.max(0, best.startIndex - 20), best.startIndex)
      .map((candle) => candle.volume)
      .filter((volume) => volume > 0);
    const impulseVolumes = impulseCandles.map((candle) => candle.volume).filter((volume) => volume > 0);
    const baselineVolume = average(precedingVolumes);
    const impulseVolume = average(impulseVolumes);
    const highestImpulsePrice = Math.max(...impulseCandles.map((candle) => candle.high));
    const latestRetracementPct = highestImpulsePrice > start.low
      ? (highestImpulsePrice - latest.close) / (highestImpulsePrice - start.low) * 100
      : null;
    impulse = {
      originPrice: roundPrice(start.low),
      startTime: start.timestamp,
      startTimeIso: new Date(start.timestamp).toISOString(),
      endPrice: roundPrice(highestImpulsePrice),
      endTime: end.timestamp,
      endTimeIso: new Date(end.timestamp).toISOString(),
      gainPct: roundMetric(best.gainPct),
      durationMinutes,
      gainPerMinutePct: roundMetric(best.gainPct / durationMinutes),
      volumeVsPrecedingBaseline:
        baselineVolume && impulseVolume ? roundMetric(impulseVolume / baselineVolume) : null,
      latestRetracementDepthPct: latestRetracementPct === null ? null : roundMetric(latestRetracementPct),
    };

    if (preImpulse.length >= 3) {
      candidates.push(candidateFromCandles({
        id: "1m-pre-impulse-base",
        kind: "pre_impulse_base",
        candles: preImpulse,
        bodyOnly: true,
        rationale: "Observed one-minute bodies immediately before the latest significant impulse.",
      }));
      const preImpulseHigh = Math.max(...preImpulse.map((candle) => candle.high));
      const breakoutBars = impulseCandles.filter((candle) =>
        candle.low <= preImpulseHigh * 1.02 && candle.high >= preImpulseHigh * 0.98
      ).slice(0, 4);
      candidates.push(candidateFromCandles({
        id: "1m-breakout-shelf",
        kind: "breakout_shelf",
        candles: breakoutBars,
        bodyOnly: true,
        rationale: "Observed one-minute bodies that crossed and tested the pre-impulse ceiling.",
      }));
    }

    if (postImpulse.length >= 3) {
      let consolidationBars: Candle[] = [];
      const impulseRange = highestImpulsePrice - start.low;
      for (let index = 0; index <= postImpulse.length - 3; index += 1) {
        const window = postImpulse.slice(index, index + 3);
        const windowRange = Math.max(...window.map((candle) => candle.high)) -
          Math.min(...window.map((candle) => candle.low));
        if (impulseRange > 0 && windowRange <= impulseRange * 0.35) {
          consolidationBars = window;
          break;
        }
      }
      if (consolidationBars.length > 0) {
        const candidate = candidateFromCandles({
          id: "1m-first-consolidation",
          kind: "first_consolidation",
          candles: consolidationBars,
          bodyOnly: true,
          rationale: "First observed three-bar one-minute consolidation after the impulse high.",
        });
        candidates.push(candidate);
        if (candidate) {
          firstConsolidation = {
            zoneLow: candidate.zoneLow,
            zoneHigh: candidate.zoneHigh,
            startTime: candidate.observedFrom,
            endTime: candidate.observedTo,
          };
        }
      }
    }

    const volumeCandidates = impulseCandles
      .filter((candle) => candle.volume > 0)
      .sort((left, right) => right.volume - left.volume)
      .slice(0, 3)
      .sort((left, right) => left.timestamp - right.timestamp);
    candidates.push(candidateFromCandles({
      id: "1m-impulse-volume-shelf",
      kind: "volume_shelf",
      candles: volumeCandidates,
      bodyOnly: true,
      rationale: "Observed bodies of the highest reported-volume one-minute bars inside the impulse.",
    }));
  }

  if (broaderBest) {
    const start = sessionSearch[broaderBest.startIndex]!;
    const end = sessionSearch[broaderBest.endIndex]!;
    const durationMinutes = Math.max(1, Math.round((end.timestamp - start.timestamp) / 60_000));
    const latestImpulseStart = best ? search[best.startIndex]! : null;
    const latestImpulseDuration = best
      ? Math.max(1, Math.round((search[best.endIndex]!.timestamp - latestImpulseStart!.timestamp) / 60_000))
      : 0;
    const isDistinctBroaderMove = !latestImpulseStart ||
      (start.low < latestImpulseStart.low * 0.97 && durationMinutes >= latestImpulseDuration + 5);
    if (isDistinctBroaderMove) {
      const anchorMidpoint = (start.open + start.close) / 2;
      const originWindow = sessionSearch
        .slice(Math.max(0, broaderBest.startIndex - 4), Math.min(sessionSearch.length, broaderBest.startIndex + 3))
        .filter((candle) => {
          const bodyLow = Math.min(candle.open, candle.close);
          const bodyHigh = Math.max(candle.open, candle.close);
          return bodyHigh >= anchorMidpoint * 0.97 && bodyLow <= anchorMidpoint * 1.03;
        });
      const originCandidate = candidateFromCandles({
        id: "1m-broader-move-origin",
        kind: "broader_move_origin",
        candles: originWindow.length > 0 ? originWindow : [start],
        bodyOnly: true,
        rationale: "Observed one-minute bodies around the origin of the broader same-session expansion.",
      });
      candidates.push(originCandidate);
      broaderSessionMove = {
        originPrice: roundPrice(start.low),
        startTime: start.timestamp,
        startTimeIso: new Date(start.timestamp).toISOString(),
        endPrice: roundPrice(end.high),
        endTime: end.timestamp,
        endTimeIso: new Date(end.timestamp).toISOString(),
        gainPct: roundMetric(broaderBest.gainPct),
        durationMinutes,
        originCandidateId: originCandidate?.id ?? null,
      };
    }
  }

  for (let index = 0; index <= recent.length - 3; index += 1) {
    const window = recent.slice(index, index + 3);
    const classifications = window.map((candle) => classifyIntradayCandleTimestamp(candle.timestamp));
    const sameSession = classifications.every((classification) =>
      classification.session === classifications[0]!.session &&
      classification.sessionDate === classifications[0]!.sessionDate
    );
    const consecutive = window.slice(1).every(
      (candle, offset) => candle.timestamp - window[offset]!.timestamp <= 90_000,
    );
    const bodyLows = window.map((candle) => Math.min(candle.open, candle.close));
    const bodyHighs = window.map((candle) => Math.max(candle.open, candle.close));
    const overlappingBodyLow = Math.max(...bodyLows);
    const overlappingBodyHigh = Math.min(...bodyHighs);
    if (!sameSession || !consecutive || overlappingBodyLow > overlappingBodyHigh) {
      continue;
    }
    const zone = candidateFromCandles({
      id: `1m-acceptance-${window[0]!.timestamp}`,
      kind: "one_minute_acceptance",
      candles: window,
      bodyOnly: true,
      rationale: "Three consecutive one-minute candle bodies overlapped, showing repeated acceptance within observed prices.",
    });
    if (
      zone &&
      zone.zoneHigh - zone.zoneLow <= currentPrice * 0.025 &&
      zone.zoneHigh < currentPrice - minimumReferenceSeparation
    ) {
      candidates.push(zone);
    }
  }

  candidates.push(...fiveMinuteCandidates);

  const lastSix = recent.slice(-6);
  const lows = lastSix.map((candle) => candle.low);
  const higherLow = lows.length >= 4 && Math.min(...lows.slice(-3)) > Math.min(...lows.slice(0, 3));
  const priorThreeHigh = lastSix.length >= 4
    ? Math.max(...lastSix.slice(0, -1).map((candle) => candle.high))
    : null;
  const reclaim = priorThreeHigh !== null && latest.close > priorThreeHigh;

  return {
    available: true,
    latestCandleAt: latest.timestamp,
    latestCandleAtIso: new Date(latest.timestamp).toISOString(),
    latestSignificantImpulse: impulse,
    broaderSessionMove,
    firstConsolidation,
    currentDistances: {
      approximateVwap: sessionVwap === null ? null : roundPrice(sessionVwap),
      vwapDistancePct: sessionVwap === null ? null : roundMetric((currentPrice - sessionVwap) / sessionVwap * 100),
      ema9: ema9 === null ? null : roundPrice(ema9),
      ema9DistancePct: ema9 === null ? null : roundMetric((currentPrice - ema9) / ema9 * 100),
      ema20: ema20 === null ? null : roundPrice(ema20),
      ema20DistancePct: ema20 === null ? null : roundMetric((currentPrice - ema20) / ema20 * 100),
    },
    latestConfirmationBehavior: {
      higherLowObserved: higherLow,
      reclaimObserved: reclaim,
      latestClose: roundPrice(latest.close),
      priorThreeBarHigh: priorThreeHigh === null ? null : roundPrice(priorThreeHigh),
    },
    pullbackCandidates: materiallySeparatedCandidates(
      candidates.filter((candidate): candidate is TradersLinkAiReadPullbackCandidate =>
        candidate !== null && candidate.zoneHigh < currentPrice - minimumReferenceSeparation
      ),
    ),
    recentOneMinuteBars: recent.map(compactIntradayBar),
  };
}

function compactIntradayBar(candle: Candle): CompactPriceActionBar {
  const classified = classifyIntradayCandleTimestamp(candle.timestamp);
  const reportedVolume = candle.volume > 0 ? Math.round(candle.volume) : null;
  return {
    timestamp: candle.timestamp,
    timestampIso: new Date(candle.timestamp).toISOString(),
    session: classified.session,
    sessionDate: classified.sessionDate,
    open: roundPrice(candle.open),
    high: roundPrice(candle.high),
    low: roundPrice(candle.low),
    close: roundPrice(candle.close),
    volume: reportedVolume,
    volumeDataQuality: reportedVolume === null ? "unavailable" : "reported",
  };
}

function buildHistoricalOverheadSearch(
  candles: Candle[],
  currentPrice: number,
  dataAsOf: number,
  adjustmentMode: TradersLinkAiReadPriceActionContext["dailyAdjustmentMode"],
  detailedRecentStartAt: number | null,
): Record<string, unknown> {
  if (adjustmentMode !== "adjusted_close_ratio" && adjustmentMode !== "split_adjusted") {
    return {
      available: false,
      adjustmentMode: adjustmentMode ?? "unknown",
      reason: "Historical overhead search was withheld because split-adjustment status was not trustworthy.",
      selectedMonthlyHighWindows: [],
    };
  }
  const daily = normalizeCandles(candles, dataAsOf);
  const byMonth = new Map<string, Candle[]>();
  for (const candle of daily) {
    const month = new Date(candle.timestamp).toISOString().slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), candle]);
  }
  const months = [...byMonth.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, HISTORICAL_OVERHEAD_MONTH_LIMIT);
  const candidates = months
    .map(([month, monthCandles]) => ({
      month,
      highest: monthCandles.reduce((best, candle) =>
        candle.high > best.high ? candle : best
      ),
    }))
    .filter(({ highest }) =>
      highest.high > currentPrice &&
      (detailedRecentStartAt === null || highest.timestamp < detailedRecentStartAt)
    )
    .sort((left, right) =>
      left.highest.high - right.highest.high ||
      right.month.localeCompare(left.month)
    );
  const distinctCandidates: typeof candidates = [];
  for (const candidate of candidates) {
    if (distinctCandidates.every((existing) =>
      Math.abs(existing.highest.high - candidate.highest.high) / currentPrice >= 0.02
    )) {
      distinctCandidates.push(candidate);
    }
  }
  const selectedIndexes = distinctCandidates.length <= HISTORICAL_OVERHEAD_WINDOW_LIMIT
    ? distinctCandidates.map((_, index) => index)
    : [
        0,
        Math.round((distinctCandidates.length - 1) / 3),
        Math.round((distinctCandidates.length - 1) * 2 / 3),
        distinctCandidates.length - 1,
      ];
  const selectedCandidates = [...new Set(selectedIndexes)]
    .map((index) => distinctCandidates[index]!)
    .sort((left, right) => left.highest.high - right.highest.high);
  const selected: Array<{
    month: string;
    monthlyHigh: number;
    highDate: string;
    surroundingDailyBars: Array<Record<string, number | string | null>>;
  }> = selectedCandidates.map(({ month, highest }) => {
    const dailyIndex = daily.findIndex((candle) => candle.timestamp === highest.timestamp);
    const surrounding = dailyIndex >= 0
      ? daily.slice(Math.max(0, dailyIndex - 2), dailyIndex + 3)
      : [highest];
    return {
      month,
      monthlyHigh: roundPrice(highest.high),
      highDate: new Date(highest.timestamp).toISOString().slice(0, 10),
      surroundingDailyBars: compactDailyBars(surrounding, surrounding.length),
    };
  });
  return {
    available: true,
    adjustmentMode,
    searchedMonthCount: months.length,
    oldestSearchedMonth: months.at(-1)?.[0] ?? null,
    detailedRecentHistoryStartsAt: detailedRecentStartAt,
    detailedRecentHistoryStartsAtIso:
      detailedRecentStartAt === null ? null : new Date(detailedRecentStartAt).toISOString(),
    eligibleOlderOverheadMonthCount: distinctCandidates.length,
    stopReason: months.length >= HISTORICAL_OVERHEAD_MONTH_LIMIT
      ? "maximum_monthly_lookback_reached"
      : "available_history_exhausted",
    noObservedOverheadFound: selected.length === 0,
    limitation:
      "Selected monthly highs span the price range beyond detailed recent bars. They are observed history used to choose lookback depth, not automatic resistance or targets.",
    selectedMonthlyHighWindows: selected,
  };
}

function sessionSummaryHigh(bars: CompactPriceActionBar[]): number {
  const rawHigh = Math.max(...bars.map((bar) => bar.high));
  const isExtendedSession = bars[0]?.session === "premarket" || bars[0]?.session === "after_hours";
  const hasReportedVolume = bars.some((bar) => bar.volume !== null);
  if (!isExtendedSession || hasReportedVolume) {
    return rawHigh;
  }

  // Yahoo commonly supplies extended-hours OHLC with zero-volume placeholders.
  // Do not let an uncorroborated opening wick become the published session high.
  // Keep the highest bar whose high stayed close to a traded bar body instead.
  const highestBodyPrice = Math.max(...bars.flatMap((bar) => [bar.open, bar.close]));
  const maximumConfirmedHigh = highestBodyPrice * (1 + UNREPORTED_EXTENDED_WICK_CONFIRMATION_PCT);
  const confirmedHighs = bars
    .map((bar) => bar.high)
    .filter((high) => high <= maximumConfirmedHigh);
  return confirmedHighs.length > 0 ? Math.max(...confirmedHighs) : highestBodyPrice;
}

export function resolveTradersLinkAiCurrentPremarketHigh(
  candles: Candle[],
  dataAsOf: number,
): number | null {
  const current = classifyIntradayCandleTimestamp(dataAsOf);
  if (current.session !== "premarket") {
    return null;
  }
  const bars = normalizeCandles(candles, dataAsOf)
    .filter((candle) => {
      const classified = classifyIntradayCandleTimestamp(candle.timestamp);
      return classified.sessionDate === current.sessionDate && classified.session === "premarket";
    })
    .map(compactIntradayBar);
  return bars.length > 0 ? roundPrice(sessionSummaryHigh(bars)) : null;
}

function summarizeSessionPhases(candles: Candle[]): SessionPhaseSummary[] {
  const grouped = new Map<string, CompactPriceActionBar[]>();
  for (const candle of candles) {
    const compact = compactIntradayBar(candle);
    const key = `${compact.sessionDate}:${compact.session}`;
    const bars = grouped.get(key) ?? [];
    bars.push(compact);
    grouped.set(key, bars);
  }

  return [...grouped.values()].map((bars) => {
    const reportedBars = bars.filter((bar) => bar.volume !== null);
    const allVolumeReported = reportedBars.length === bars.length;
    const volume = allVolumeReported
      ? reportedBars.reduce((sum, bar) => sum + bar.volume!, 0)
      : null;
    const typicalPriceVolume = bars.reduce(
      (sum, bar) => sum + ((bar.high + bar.low + bar.close) / 3) * (bar.volume ?? 0),
      0,
    );
    return {
      sessionDate: bars[0]!.sessionDate,
      session: bars[0]!.session,
      open: bars[0]!.open,
      high: roundPrice(sessionSummaryHigh(bars)),
      low: roundPrice(Math.min(...bars.map((bar) => bar.low))),
      close: bars.at(-1)!.close,
      volume,
      volumeDataQuality:
        reportedBars.length === 0
          ? "unavailable"
          : allVolumeReported
            ? "reported"
            : "partial",
      approximateVwap: volume !== null && volume > 0
        ? roundPrice(typicalPriceVolume / volume)
        : null,
      barCount: bars.length,
    };
  });
}

function compactDailyBars(
  candles: Candle[],
  limit: number,
): Array<Record<string, number | string | null>> {
  return candles.slice(-limit).map((candle) => ({
    timestamp: candle.timestamp,
    dateIso: new Date(candle.timestamp).toISOString(),
    open: roundPrice(candle.open),
    high: roundPrice(candle.high),
    low: roundPrice(candle.low),
    close: roundPrice(candle.close),
    volume: candle.volume > 0 ? Math.round(candle.volume) : null,
    volumeDataQuality: candle.volume > 0 ? "reported" : "unavailable",
  }));
}

function percentageGain(from: number | null | undefined, to: number): number | null {
  return typeof from === "number" && Number.isFinite(from) && from > 0
    ? roundMetric((to - from) / from * 100)
    : null;
}

function averageDailyRangePct(candles: Candle[], count: number): number | null {
  const values = candles.slice(-count).map((candle) => (candle.high - candle.low) / candle.low * 100);
  return values.length > 0 ? roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function recordNumber(value: unknown, key: string): number | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

export function buildTradersLinkAiReadMarketRegimeProfile(args: {
  intraday: Candle[];
  daily: Candle[];
  currentPrice: number;
  priorRegularClose: number | null;
  dataAsOf: number;
  oneMinuteFacts: Record<string, unknown>;
}): TradersLinkAiReadMarketRegimeProfile {
  const sessionDate = classifyIntradayCandleTimestamp(args.dataAsOf).sessionDate;
  const annotated = args.intraday.map((candle) => ({
    candle,
    classified: classifyIntradayCandleTimestamp(candle.timestamp),
  }));
  const currentSession = annotated
    .filter((item) => item.classified.sessionDate === sessionDate)
    .map((item) => item.candle);
  const regularSession = annotated
    .filter((item) => item.classified.sessionDate === sessionDate &&
      (item.classified.session === "opening_range" || item.classified.session === "regular"))
    .map((item) => item.candle);
  const priorSessionDate = [...annotated].reverse().find((item) =>
    item.classified.sessionDate !== sessionDate
  )?.classified.sessionDate ?? null;
  const priorSession = priorSessionDate
    ? annotated.filter((item) => item.classified.sessionDate === priorSessionDate).map((item) => item.candle)
    : [];
  const sessionHigh = currentSession.length > 0 ? Math.max(...currentSession.map((candle) => candle.high)) : null;
  const sessionLow = currentSession.length > 0 ? Math.min(...currentSession.map((candle) => candle.low)) : null;
  const regularOpen = regularSession[0]?.open ?? null;
  const rangePct = sessionLow && sessionHigh
    ? roundMetric((sessionHigh - sessionLow) / sessionLow * 100)
    : null;
  const locationPct = sessionLow && sessionHigh && sessionHigh > sessionLow
    ? roundMetric((args.currentPrice - sessionLow) / (sessionHigh - sessionLow) * 100)
    : null;
  const latestImpulse = recordNumber(args.oneMinuteFacts.latestSignificantImpulse, "gainPct");
  const broaderMove = recordNumber(args.oneMinuteFacts.broaderSessionMove, "gainPct");
  const average10 = averageDailyRangePct(args.daily, 10);
  const average20 = averageDailyRangePct(args.daily, 20);
  const dailyRanges20 = args.daily.slice(-20).map((candle) => (candle.high - candle.low) / candle.low * 100);
  const largest20 = dailyRanges20.length > 0 ? roundMetric(Math.max(...dailyRanges20)) : null;
  const highestDaily = args.daily.length > 0 ? Math.max(...args.daily.map((candle) => candle.high)) : null;
  const highestPriorSession = priorSession.length > 0 ? Math.max(...priorSession.map((candle) => candle.high)) : null;
  const observed: Array<{
    price: number;
    type: NonNullable<TradersLinkAiReadMarketRegimeProfile["highestObservedUpsidePriceType"]>;
  }> = [
    ...(sessionHigh ? [{ price: sessionHigh, type: "current_session" as const }] : []),
    ...(highestPriorSession ? [{ price: highestPriorSession, type: "prior_session" as const }] : []),
    ...(highestDaily ? [{ price: highestDaily, type: "recent_daily" as const }] : []),
  ];
  const highestObserved = observed.sort((left, right) => right.price - left.price)[0] ?? null;
  const gainFromPriorClosePct = percentageGain(args.priorRegularClose, args.currentPrice);
  const gainFromRegularSessionOpenPct = percentageGain(regularOpen, args.currentPrice);
  const gainFromCurrentSessionLowPct = percentageGain(sessionLow, args.currentPrice);
  const rangeMultiple = rangePct !== null && average20 !== null && average20 > 0
    ? roundMetric(rangePct / average20)
    : null;
  let expansionScore = 0;
  const realizedGain = Math.max(
    0,
    gainFromPriorClosePct ?? 0,
    gainFromRegularSessionOpenPct ?? 0,
    gainFromCurrentSessionLowPct ?? 0,
    latestImpulse ?? 0,
    broaderMove ?? 0,
  );
  if (realizedGain >= 20) expansionScore += 1;
  if (realizedGain >= 50) expansionScore += 2;
  if ((rangeMultiple ?? 0) >= 1.5) expansionScore += 1;
  if ((rangeMultiple ?? 0) >= 2.5) expansionScore += 2;
  if ((latestImpulse ?? 0) >= 15 || (broaderMove ?? 0) >= 25) expansionScore += 1;
  const regime: TradersLinkAiReadMarketRegime = expansionScore >= 6
    ? "extreme_expansion"
    : expansionScore >= 3
      ? "high_expansion"
      : expansionScore >= 1
        ? "elevated"
        : "normal";
  const limitations: string[] = [];
  if (currentSession.length === 0) limitations.push("current_session_unavailable");
  if (args.daily.length < 10) limitations.push("limited_daily_history");
  if (latestImpulse === null) limitations.push("significant_impulse_unavailable");
  return {
    available: currentSession.length > 0,
    dailyHistoryCount: args.daily.length,
    gainFromPriorClosePct,
    gainFromRegularSessionOpenPct,
    gainFromCurrentSessionLowPct,
    currentSessionRangePct: rangePct,
    latestSignificantImpulsePct: latestImpulse,
    broaderSessionMovePct: broaderMove,
    averageDailyRange10Pct: average10,
    averageDailyRange20Pct: average20,
    largestDailyRange20Pct: largest20,
    currentRangeVsAverageDailyRange: rangeMultiple,
    currentPriceLocationInSessionRangePct: locationPct,
    currentPriceAtOrNearSessionHigh: Boolean(sessionHigh && args.currentPrice >= sessionHigh * 0.99),
    currentPriceAboveHighestSuppliedDailyHigh: Boolean(highestDaily && args.currentPrice >= highestDaily),
    highestObservedUpsidePrice: highestObserved ? roundPrice(highestObserved.price) : null,
    highestObservedUpsidePriceType: highestObserved?.type ?? null,
    distanceToHighestObservedUpsidePct: highestObserved
      ? percentageGain(args.currentPrice, highestObserved.price)
      : null,
    regime,
    limitations,
  };
}

function aggregateRegularSessionToFifteenMinutes(
  annotated: Array<{
    candle: Candle;
    classified: ReturnType<typeof classifyIntradayCandleTimestamp>;
  }>,
): Array<Record<string, number | string | null>> {
  const latest = annotated.at(-1)?.classified ?? null;
  const regularSessionDates = [...new Set(
    annotated
      .filter((item) =>
        item.classified.session === "opening_range" || item.classified.session === "regular"
      )
      .map((item) => item.classified.sessionDate),
  )];
  const completedSessionDates = regularSessionDates
    .filter((sessionDate) =>
      sessionDate !== latest?.sessionDate || latest.session === "after_hours"
    )
    .slice(-2);
  const output: Array<Record<string, number | string | null>> = [];

  for (const sessionDate of completedSessionDates) {
    const candles = annotated
      .filter((item) =>
        item.classified.sessionDate === sessionDate &&
        (item.classified.session === "opening_range" || item.classified.session === "regular")
      )
      .map((item) => item.candle);
    for (let index = 0; index < candles.length; index += 3) {
      const bucket = candles.slice(index, index + 3);
      if (bucket.length === 0) {
        continue;
      }
      const reportedVolumes = bucket.map((candle) => candle.volume).filter((volume) => volume > 0);
      const allVolumeReported = reportedVolumes.length === bucket.length;
      output.push({
        sessionDate,
        timestamp: bucket[0]!.timestamp,
        timestampIso: new Date(bucket[0]!.timestamp).toISOString(),
        open: roundPrice(bucket[0]!.open),
        high: roundPrice(Math.max(...bucket.map((candle) => candle.high))),
        low: roundPrice(Math.min(...bucket.map((candle) => candle.low))),
        close: roundPrice(bucket.at(-1)!.close),
        volume: allVolumeReported
          ? reportedVolumes.reduce((sum, volume) => sum + Math.round(volume), 0)
          : null,
        volumeDataQuality:
          reportedVolumes.length === 0
            ? "unavailable"
            : allVolumeReported
              ? "reported"
              : "partial",
      });
    }
  }
  return output;
}

export function resolveTradersLinkAiReadReferenceQuote(
  context: TradersLinkAiReadPriceActionContext,
  fallbackPrice: number,
  fallbackDataAsOf: number,
): TradersLinkAiReadReferenceQuote {
  const oneMinute = normalizeCandles(
    context.oneMinuteCandles ?? [],
    Math.max(fallbackDataAsOf, context.fetchedAt),
  );
  const intraday = normalizeCandles(
    context.intradayCandles,
    Math.max(fallbackDataAsOf, context.fetchedAt),
  );
  const latestOneMinute = oneMinute.at(-1);
  const latestFiveMinute = intraday.at(-1);
  const referenceTime = Math.max(fallbackDataAsOf, context.fetchedAt);
  if (latestOneMinute && referenceTime - latestOneMinute.timestamp <= 10 * 60 * 1_000) {
    return {
      price: latestOneMinute.close,
      dataAsOf: latestOneMinute.timestamp,
      source: `${context.source} latest 1-minute close`,
    };
  }
  if (latestFiveMinute && referenceTime - latestFiveMinute.timestamp <= 30 * 60 * 1_000) {
    return {
      price: latestFiveMinute.close,
      dataAsOf: latestFiveMinute.timestamp,
      source: `${context.source} latest 5-minute close`,
    };
  }
  return {
    price: fallbackPrice,
    dataAsOf: fallbackDataAsOf,
    source: "runtime live-price fallback",
  };
}

export function hasUsableTradersLinkAiPriceAction(
  context: TradersLinkAiReadPriceActionContext | null | undefined,
  dataAsOf: number,
): boolean {
  if (!context) {
    return false;
  }
  const intraday = normalizeCandles(context.intradayCandles, dataAsOf);
  if (intraday.length < 12) {
    return false;
  }
  const latest = intraday.at(-1)!;
  return dataAsOf - latest.timestamp <= 24 * 60 * 60 * 1_000;
}

export function buildTradersLinkAiPriceActionPacket(
  context: TradersLinkAiReadPriceActionContext,
  currentPrice: number,
  dataAsOf: number,
): Record<string, unknown> {
  const intraday = normalizeCandles(context.intradayCandles, dataAsOf);
  const daily = normalizeCandles(context.dailyCandles, dataAsOf);
  if (!hasUsableTradersLinkAiPriceAction(context, dataAsOf)) {
    throw new Error("TradersLink AI Read requires recent extended-hours intraday price action.");
  }

  const recentIntraday = intraday.slice(-RECENT_INTRADAY_BAR_LIMIT);
  const annotated = intraday.map((candle) => ({
    candle,
    classified: classifyIntradayCandleTimestamp(candle.timestamp),
  }));
  const latestSessionDate = annotated.at(-1)?.classified.sessionDate ?? null;
  const priorRegularSessionDate = [...annotated]
    .reverse()
    .find((item) =>
      item.classified.sessionDate !== latestSessionDate &&
      (item.classified.session === "opening_range" || item.classified.session === "regular")
    )?.classified.sessionDate ?? null;
  const landmarkCandidates = annotated
    .filter((item) =>
      item.classified.sessionDate === latestSessionDate ||
      (
        item.classified.sessionDate === priorRegularSessionDate &&
        (item.classified.session === "opening_range" || item.classified.session === "regular")
      )
    )
    .map((item) => item.candle);
  const volumeLandmarks = [...landmarkCandidates]
    .filter((candle) => candle.volume > 0)
    .sort((left, right) => right.volume - left.volume)
    .slice(0, VOLUME_LANDMARK_LIMIT)
    .sort((left, right) => left.timestamp - right.timestamp)
    .map(compactIntradayBar);
  const recentHigh = Math.max(...recentIntraday.map((candle) => candle.high));
  const recentLow = Math.min(...recentIntraday.map((candle) => candle.low));
  const recentHighBar = recentIntraday.reduce((highest, candle) =>
    candle.high > highest.high ? candle : highest
  );
  const recentLowBar = recentIntraday.reduce((lowest, candle) =>
    candle.low < lowest.low ? candle : lowest
  );
  const range = recentHigh - recentLow;
  const sessionPhaseSummaries = summarizeSessionPhases(intraday);
  const oneMinuteFacts = buildOneMinuteFacts(
    context.oneMinuteCandles ?? [],
    intraday,
    currentPrice,
    dataAsOf,
  );
  const marketRegimeProfile = buildTradersLinkAiReadMarketRegimeProfile({
    intraday,
    daily,
    currentPrice,
    priorRegularClose: context.priorRegularClose,
    dataAsOf,
    oneMinuteFacts,
  });
  const recentDaily = daily.slice(-RECENT_DAILY_BAR_LIMIT);

  return {
    source: context.source,
    fetchedAt: context.fetchedAt,
    fetchedAtIso: new Date(context.fetchedAt).toISOString(),
    timeframes: ["1m", "5m", "1d"],
    sessionCoverage: ["premarket", "opening_range", "regular", "after_hours"],
    includesRegularHours: true,
    includesPrePostMarket: true,
    priorRegularClose: context.priorRegularClose,
    recentRange: {
      high: roundPrice(recentHigh),
      low: roundPrice(recentLow),
      highBar: compactIntradayBar(recentHighBar),
      lowBar: compactIntradayBar(recentLowBar),
      currentLocationPct: range > 0
        ? Number((((currentPrice - recentLow) / range) * 100).toFixed(1))
        : null,
    },
    sessionPhaseSummaries,
    recentSessionReferencePoints: sessionPhaseSummaries.slice(-12),
    completedRegularSessionFifteenMinuteBars: aggregateRegularSessionToFifteenMinutes(annotated),
    highVolumeFiveMinuteBars: volumeLandmarks,
    recentFiveMinuteBars: recentIntraday.map(compactIntradayBar),
    oneMinuteEvidence: oneMinuteFacts,
    marketRegimeProfile,
    recentDailyBars: compactDailyBars(recentDaily, recentDaily.length),
    historicalOverheadSearch: buildHistoricalOverheadSearch(
      daily,
      currentPrice,
      dataAsOf,
      context.dailyAdjustmentMode,
      recentDaily[0]?.timestamp ?? null,
    ),
  };
}
