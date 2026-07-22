import type { Candle } from "../market-data/candle-types.js";
import { classifyIntradayCandleTimestamp } from "../market-data/candle-session-classifier.js";

const RECENT_INTRADAY_BAR_LIMIT = 120;
const RECENT_ONE_MINUTE_BAR_LIMIT = 60;
const RECENT_DAILY_BAR_LIMIT = 30;
const VOLUME_LANDMARK_LIMIT = 8;
const UNREPORTED_EXTENDED_WICK_CONFIRMATION_PCT = 0.03;
const MINIMUM_SIGNIFICANT_IMPULSE_GAIN_PCT = 5;
const MAXIMUM_IMPULSE_DURATION_BARS = 45;

export type TradersLinkAiReadPriceActionContext = {
  source: string;
  fetchedAt: number;
  priorRegularClose: number | null;
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
    | "five_minute_acceptance";
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
  const output: TradersLinkAiReadPullbackCandidate[] = [];
  for (const candidate of candidates
    .filter((item) => item.zoneLow > 0 && item.zoneHigh >= item.zoneLow)
    .sort((left, right) => right.zoneHigh - left.zoneHigh)) {
    const duplicate = output.some((existing) => {
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
      output.push(candidate);
    }
  }
  return output.slice(0, 8);
}

function buildOneMinuteFacts(
  rawCandles: Candle[],
  fiveMinuteCandles: Candle[],
  currentPrice: number,
  dataAsOf: number,
): Record<string, unknown> {
  const minimumReferenceSeparation = Math.max(currentPrice * 0.005, 0.0001);
  const candles = normalizeCandles(rawCandles, dataAsOf);
  if (candles.length < 12) {
    return {
      available: false,
      reason: "Fewer than 12 usable one-minute candles were available.",
      pullbackCandidates: [],
      recentOneMinuteBars: candles.slice(-RECENT_ONE_MINUTE_BAR_LIMIT).map(compactIntradayBar),
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

  const recent = candles.slice(-RECENT_ONE_MINUTE_BAR_LIMIT);
  const sessionVwap = approximateVwap(candles);
  const ema9 = exponentialMovingAverage(recent, 9);
  const ema20 = exponentialMovingAverage(recent, 20);
  const latest = candles.at(-1)!;
  const candidates: Array<TradersLinkAiReadPullbackCandidate | null> = [];
  let impulse: Record<string, unknown> | null = null;
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

  const recentFiveMinute = normalizeCandles(fiveMinuteCandles, dataAsOf).slice(-24);
  for (let index = Math.max(0, recentFiveMinute.length - 12); index <= recentFiveMinute.length - 3; index += 3) {
    const window = recentFiveMinute.slice(index, index + 3);
    const zone = candidateFromCandles({
      id: `5m-acceptance-${window[0]!.timestamp}`,
      kind: "five_minute_acceptance",
      candles: window,
      bodyOnly: true,
      rationale: "Observed three-bar five-minute body acceptance shelf.",
    });
    if (zone && zone.zoneHigh < currentPrice - minimumReferenceSeparation) {
      candidates.push(zone);
    }
  }

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

function compactDailyBars(candles: Candle[]): Array<Record<string, number | string | null>> {
  return candles.slice(-RECENT_DAILY_BAR_LIMIT).map((candle) => ({
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
    recentDailyBars: compactDailyBars(daily),
  };
}
