import type { Candle } from "../market-data/candle-types.js";
import { classifyIntradayCandleTimestamp } from "../market-data/candle-session-classifier.js";

const RECENT_INTRADAY_BAR_LIMIT = 120;
const RECENT_DAILY_BAR_LIMIT = 30;
const VOLUME_LANDMARK_LIMIT = 8;
const UNREPORTED_EXTENDED_WICK_CONFIRMATION_PCT = 0.03;

export type TradersLinkAiReadPriceActionContext = {
  source: string;
  fetchedAt: number;
  priorRegularClose: number | null;
  intradayCandles: Candle[];
  dailyCandles: Candle[];
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
  const intraday = normalizeCandles(
    context.intradayCandles,
    Math.max(fallbackDataAsOf, context.fetchedAt),
  );
  const latest = intraday.at(-1);
  const referenceTime = Math.max(fallbackDataAsOf, context.fetchedAt);
  if (latest && referenceTime - latest.timestamp <= 30 * 60 * 1_000) {
    return {
      price: latest.close,
      dataAsOf: latest.timestamp,
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

  return {
    source: context.source,
    fetchedAt: context.fetchedAt,
    fetchedAtIso: new Date(context.fetchedAt).toISOString(),
    timeframe: "5m",
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
    recentDailyBars: compactDailyBars(daily),
  };
}
