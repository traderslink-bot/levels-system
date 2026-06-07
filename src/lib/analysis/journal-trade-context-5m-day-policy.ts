import type { HistoricalFetchRequest } from "../market-data/provider-types.js";

export type JournalTradeContextFiveMinuteDaySession = {
  timezone: string;
  localDate: string;
  startHour: number;
  endHour: number;
  startTimestamp: number;
  endTimestamp: number;
  expectedBarCount: number;
};

export type JournalTradeContextFiveMinuteDayPolicy = {
  symbol: string;
  timeframe: "5m";
  tradeContextTimestamp: number;
  fetchRequest: HistoricalFetchRequest;
  session: JournalTradeContextFiveMinuteDaySession;
  cacheIdentity: {
    scope: "symbol_exchange_day";
    key: string;
  };
  safety: {
    fullDayFetchOnly: true;
    snapshotStillFiltersAsOf: true;
    noTradeSpecificCandleExpansion: true;
    noLevelEngineBehaviorChange: true;
  };
};

export type BuildJournalTradeContextFiveMinuteDayPolicyInput = {
  symbol: string;
  tradeContextTimestamp: number;
  timezone?: string;
  sessionStartHour?: number;
  sessionEndHour?: number;
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const DEFAULT_TIMEZONE = "America/New_York";
const DEFAULT_EXTENDED_SESSION_START_HOUR = 4;
const DEFAULT_EXTENDED_SESSION_END_HOUR = 20;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,15}$/;

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function assertFiniteTimestamp(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive epoch-millisecond timestamp.`);
  }
}

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(normalized)) {
    throw new Error(`Invalid symbol "${symbol}". Symbols must be explicit ticker-like values.`);
  }

  return normalized;
}

function assertSessionHour(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 24) {
    throw new Error(`${label} must be an integer hour from 0 through 24.`);
  }
}

function formatDateKey(parts: Pick<LocalDateTimeParts, "year" | "month" | "day">): string {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function dateTimePartsForTimestamp(timestamp: number, timezone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const rawParts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(rawParts.year),
    month: Number(rawParts.month),
    day: Number(rawParts.day),
    hour: Number(rawParts.hour),
    minute: Number(rawParts.minute),
    second: Number(rawParts.second),
  };
}

function utcComparable(parts: LocalDateTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function zonedLocalTimeToUtcTimestamp(input: {
  timezone: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute?: number;
  second?: number;
}): number {
  const target: LocalDateTimeParts = {
    year: input.year,
    month: input.month,
    day: input.day,
    hour: input.hour,
    minute: input.minute ?? 0,
    second: input.second ?? 0,
  };
  let guess = utcComparable(target);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = dateTimePartsForTimestamp(guess, input.timezone);
    const delta = utcComparable(target) - utcComparable(actual);
    if (delta === 0) {
      return guess;
    }
    guess += delta;
  }

  return guess;
}

function buildCacheKey(input: {
  symbol: string;
  timeframe: "5m";
  timezone: string;
  localDate: string;
  startHour: number;
  endHour: number;
}): string {
  return [
    input.symbol,
    input.timeframe,
    input.timezone,
    input.localDate,
    `${String(input.startHour).padStart(2, "0")}-${String(input.endHour).padStart(2, "0")}`,
  ].join("|");
}

export function buildJournalTradeContextFiveMinuteDayPolicy(
  input: BuildJournalTradeContextFiveMinuteDayPolicyInput,
): JournalTradeContextFiveMinuteDayPolicy {
  assertFiniteTimestamp(input.tradeContextTimestamp, "tradeContextTimestamp");

  const symbol = normalizeSymbol(input.symbol);
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const startHour = input.sessionStartHour ?? DEFAULT_EXTENDED_SESSION_START_HOUR;
  const endHour = input.sessionEndHour ?? DEFAULT_EXTENDED_SESSION_END_HOUR;
  assertSessionHour(startHour, "sessionStartHour");
  assertSessionHour(endHour, "sessionEndHour");
  if (endHour <= startHour) {
    throw new Error("sessionEndHour must be greater than sessionStartHour.");
  }

  const tradeDate = dateTimePartsForTimestamp(input.tradeContextTimestamp, timezone);
  const localDate = formatDateKey(tradeDate);
  const startTimestamp = zonedLocalTimeToUtcTimestamp({
    timezone,
    year: tradeDate.year,
    month: tradeDate.month,
    day: tradeDate.day,
    hour: startHour,
  });
  const endTimestamp = zonedLocalTimeToUtcTimestamp({
    timezone,
    year: tradeDate.year,
    month: tradeDate.month,
    day: tradeDate.day,
    hour: endHour,
  });
  const expectedBarCount = Math.ceil((endTimestamp - startTimestamp) / FIVE_MINUTES_MS);

  return {
    symbol,
    timeframe: "5m",
    tradeContextTimestamp: input.tradeContextTimestamp,
    fetchRequest: {
      symbol,
      timeframe: "5m",
      lookbackBars: expectedBarCount,
      endTimeMs: endTimestamp,
    },
    session: {
      timezone,
      localDate,
      startHour,
      endHour,
      startTimestamp,
      endTimestamp,
      expectedBarCount,
    },
    cacheIdentity: {
      scope: "symbol_exchange_day",
      key: buildCacheKey({
        symbol,
        timeframe: "5m",
        timezone,
        localDate,
        startHour,
        endHour,
      }),
    },
    safety: {
      fullDayFetchOnly: true,
      snapshotStillFiltersAsOf: true,
      noTradeSpecificCandleExpansion: true,
      noLevelEngineBehaviorChange: true,
    },
  };
}
