import type { Candle, CandleFetchTimeframe, CandleSessionLabel, CandleSessionSummary } from "./candle-types.js";
import {
  classifyUsEquityMarketSession,
  newYorkDateTimeParts,
} from "./us-equity-exchange-calendar.js";

type SessionAnnotatedCandle = {
  candle: Candle;
  session: CandleSessionLabel;
  sessionDate: string | null;
};

function extractParts(timestamp: number): {
  sessionDate: string;
  hour: number;
  minute: number;
} {
  const parts = newYorkDateTimeParts(timestamp);
  return {
    sessionDate: parts?.date ?? "",
    hour: parts?.hour ?? Number.NaN,
    minute: parts?.minute ?? Number.NaN,
  };
}

export function classifyIntradayCandleTimestamp(timestamp: number): {
  session: CandleSessionLabel;
  sessionDate: string;
} {
  const { sessionDate, hour, minute } = extractParts(timestamp);
  const minutesIntoDay = hour * 60 + minute;
  const marketSession = classifyUsEquityMarketSession(timestamp).session;

  if (marketSession === "closed") {
    return { session: "extended", sessionDate };
  }

  if (minutesIntoDay >= 4 * 60 && minutesIntoDay < 9 * 60 + 30) {
    return { session: "premarket", sessionDate };
  }

  if (minutesIntoDay >= 9 * 60 + 30 && minutesIntoDay < 10 * 60) {
    return { session: "opening_range", sessionDate };
  }

  if (minutesIntoDay >= 10 * 60 && marketSession === "regular") {
    return { session: "regular", sessionDate };
  }

  if (marketSession === "postmarket") {
    return { session: "after_hours", sessionDate };
  }

  return { session: "extended", sessionDate };
}

export function isLikelyTradableIntradayTimestamp(timestamp: number): boolean {
  const classified = classifyIntradayCandleTimestamp(timestamp);
  return classified.session === "premarket" ||
    classified.session === "opening_range" ||
    classified.session === "regular" ||
    classified.session === "after_hours";
}

export function classifyCandleSessions(
  candles: Candle[],
  timeframe: CandleFetchTimeframe,
): SessionAnnotatedCandle[] {
  if (timeframe !== "1m" && timeframe !== "5m") {
    return candles.map((candle) => ({
      candle,
      session: "unknown",
      sessionDate: null,
    }));
  }

  return candles.map((candle) => {
    const classified = classifyIntradayCandleTimestamp(candle.timestamp);
    return {
      candle,
      session: classified.session,
      sessionDate: classified.sessionDate,
    };
  });
}

export function buildCandleSessionSummary(
  candles: Candle[],
  timeframe: CandleFetchTimeframe,
): CandleSessionSummary | null {
  const annotated = classifyCandleSessions(candles, timeframe);

  if (annotated.every((item) => item.session === "unknown")) {
    return null;
  }

  const latestRegularSessionDate =
    annotated
      .filter((item) => item.session === "opening_range" || item.session === "regular")
      .at(-1)?.sessionDate ?? null;

  return {
    premarketBars: annotated.filter((item) => item.session === "premarket").length,
    openingRangeBars: annotated.filter((item) => item.session === "opening_range").length,
    regularBars: annotated.filter((item) => item.session === "regular").length,
    afterHoursBars: annotated.filter((item) => item.session === "after_hours").length,
    extendedBars: annotated.filter((item) => item.session === "extended").length,
    unknownBars: annotated.filter((item) => item.session === "unknown").length,
    latestRegularSessionDate,
  };
}

export function filterCandlesBySession(
  candles: Candle[],
  timeframe: CandleFetchTimeframe,
  session: CandleSessionLabel,
): Candle[] {
  return classifyCandleSessions(candles, timeframe)
    .filter((item) => item.session === session)
    .map((item) => item.candle);
}
