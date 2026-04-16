import type { Candle, CandleSessionLabel, CandleSessionSummary, CandleTimeframe } from "./candle-types.js";

type SessionAnnotatedCandle = {
  candle: Candle;
  session: CandleSessionLabel;
  sessionDate: string | null;
};

const NEW_YORK_TIMEZONE = "America/New_York";

const sessionFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: NEW_YORK_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function extractParts(timestamp: number): {
  sessionDate: string;
  hour: number;
  minute: number;
} {
  const parts = sessionFormatter.formatToParts(new Date(timestamp));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(byType.year);
  const month = Number(byType.month);
  const day = Number(byType.day);
  const hour = Number(byType.hour);
  const minute = Number(byType.minute);

  return {
    sessionDate: `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
      .toString()
      .padStart(2, "0")}`,
    hour,
    minute,
  };
}

function classifyIntradaySession(timestamp: number): {
  session: CandleSessionLabel;
  sessionDate: string;
} {
  const { sessionDate, hour, minute } = extractParts(timestamp);
  const minutesIntoDay = hour * 60 + minute;

  if (minutesIntoDay >= 4 * 60 && minutesIntoDay < 9 * 60 + 30) {
    return { session: "premarket", sessionDate };
  }

  if (minutesIntoDay >= 9 * 60 + 30 && minutesIntoDay < 10 * 60) {
    return { session: "opening_range", sessionDate };
  }

  if (minutesIntoDay >= 10 * 60 && minutesIntoDay < 16 * 60) {
    return { session: "regular", sessionDate };
  }

  if (minutesIntoDay >= 16 * 60 && minutesIntoDay < 20 * 60) {
    return { session: "after_hours", sessionDate };
  }

  return { session: "extended", sessionDate };
}

export function classifyCandleSessions(
  candles: Candle[],
  timeframe: CandleTimeframe,
): SessionAnnotatedCandle[] {
  if (timeframe !== "5m") {
    return candles.map((candle) => ({
      candle,
      session: "unknown",
      sessionDate: null,
    }));
  }

  return candles.map((candle) => {
    const classified = classifyIntradaySession(candle.timestamp);
    return {
      candle,
      session: classified.session,
      sessionDate: classified.sessionDate,
    };
  });
}

export function buildCandleSessionSummary(
  candles: Candle[],
  timeframe: CandleTimeframe,
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
  timeframe: CandleTimeframe,
  session: CandleSessionLabel,
): Candle[] {
  return classifyCandleSessions(candles, timeframe)
    .filter((item) => item.session === session)
    .map((item) => item.candle);
}
