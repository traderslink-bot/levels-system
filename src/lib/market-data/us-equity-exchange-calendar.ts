/**
 * Minimal, deterministic NYSE/Nasdaq-style U.S. equities calendar.
 *
 * The watchlist must not infer that a weekday is a trading day. This module
 * stays local so classification still works when a calendar endpoint is down.
 * Rare exchange-announced emergency closures are listed explicitly as they
 * become known.
 */

export const NEW_YORK_TIME_ZONE = "America/New_York";

export type UsEquityMarketSession = "premarket" | "regular" | "postmarket" | "closed";

export type NewYorkDateTimeParts = {
  date: string;
  weekday: string;
  hour: number;
  minute: number;
};

export type UsEquityTradingDay = {
  date: string;
  isTradingDay: boolean;
  regularOpenMinutes: number;
  regularCloseMinutes: number;
  earlyClose: boolean;
  closureReason: string | null;
};

const REGULAR_OPEN_MINUTES = 9 * 60 + 30;
const REGULAR_CLOSE_MINUTES = 16 * 60;
const EARLY_CLOSE_MINUTES = 13 * 60;
const PREMARKET_OPEN_MINUTES = 4 * 60;
const POSTMARKET_CLOSE_MINUTES = 20 * 60;

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// These are exchange-announced, non-recurring full-day closures that cannot
// be derived from standard holiday rules. Add future announcements here.
const SPECIAL_FULL_CLOSURES = new Map<string, string>([
  ["2025-01-09", "National Day of Mourning"],
]);

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseDate(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    !Number.isFinite(timestamp) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function dateFromUtc(date: Date): string {
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, occurrence: number): Date {
  const first = utcDate(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return addDays(first, offset + (occurrence - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = utcDate(year, month + 1, 0);
  return addDays(last, -((last.getUTCDay() - weekday + 7) % 7));
}

function easterSunday(year: number): Date {
  // Gregorian computus (Meeus/Jones/Butcher), adequate for modern dates.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

function observedFixedDate(year: number, month: number, day: number, observeSaturday: boolean): Date | null {
  const actual = utcDate(year, month, day);
  if (actual.getUTCDay() === 0) return addDays(actual, 1);
  if (actual.getUTCDay() === 6) return observeSaturday ? addDays(actual, -1) : null;
  return actual;
}

function regularHolidayReason(date: { year: number; month: number; day: number }): string | null {
  const { year } = date;
  const key = formatDate(date.year, date.month, date.day);
  const holidays: Array<[Date | null, string]> = [
    // NYSE does not observe a Saturday New Year's Day on the preceding Friday.
    [observedFixedDate(year, 1, 1, false), "New Year's Day"],
    [nthWeekdayOfMonth(year, 1, 1, 3), "Martin Luther King Jr. Day"],
    [nthWeekdayOfMonth(year, 2, 1, 3), "Washington's Birthday"],
    [addDays(easterSunday(year), -2), "Good Friday"],
    [lastWeekdayOfMonth(year, 5, 1), "Memorial Day"],
    [year >= 2022 ? observedFixedDate(year, 6, 19, true) : null, "Juneteenth National Independence Day"],
    [observedFixedDate(year, 7, 4, true), "Independence Day"],
    [nthWeekdayOfMonth(year, 9, 1, 1), "Labor Day"],
    [nthWeekdayOfMonth(year, 11, 4, 4), "Thanksgiving Day"],
    [observedFixedDate(year, 12, 25, true), "Christmas Day"],
  ];
  return holidays.find(([holiday]) => holiday && dateFromUtc(holiday) === key)?.[1] ?? null;
}

function isEarlyCloseDate(date: { year: number; month: number; day: number }): boolean {
  const value = utcDate(date.year, date.month, date.day);
  if (value.getUTCDay() === 0 || value.getUTCDay() === 6) return false;

  // Standard NYSE early-close pattern: the Friday after Thanksgiving,
  // Christmas Eve when it is a trading day, and a trading July 3 session.
  const thanksgiving = nthWeekdayOfMonth(date.year, 11, 4, 4);
  if (dateFromUtc(value) === dateFromUtc(addDays(thanksgiving, 1))) return true;
  if (date.month === 12 && date.day === 24) return true;
  return date.month === 7 && date.day === 3;
}

export function newYorkDateTimeParts(timestamp: number): NewYorkDateTimeParts | null {
  if (!Number.isFinite(timestamp)) return null;
  const values = Object.fromEntries(
    dateTimeFormatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  return {
    date: formatDate(year, month, day),
    weekday: values.weekday,
    hour,
    minute,
  };
}

export function getUsEquityTradingDay(date: string): UsEquityTradingDay {
  const parsed = parseDate(date);
  if (!parsed) {
    return {
      date,
      isTradingDay: false,
      regularOpenMinutes: REGULAR_OPEN_MINUTES,
      regularCloseMinutes: REGULAR_CLOSE_MINUTES,
      earlyClose: false,
      closureReason: "Invalid calendar date",
    };
  }
  const dayOfWeek = utcDate(parsed.year, parsed.month, parsed.day).getUTCDay();
  const specialClosure = SPECIAL_FULL_CLOSURES.get(date) ?? null;
  const holidayClosure = regularHolidayReason(parsed);
  const closureReason = dayOfWeek === 0 || dayOfWeek === 6
    ? "Weekend"
    : specialClosure ?? holidayClosure;
  if (closureReason) {
    return {
      date,
      isTradingDay: false,
      regularOpenMinutes: REGULAR_OPEN_MINUTES,
      regularCloseMinutes: REGULAR_CLOSE_MINUTES,
      earlyClose: false,
      closureReason,
    };
  }
  const earlyClose = isEarlyCloseDate(parsed);
  return {
    date,
    isTradingDay: true,
    regularOpenMinutes: REGULAR_OPEN_MINUTES,
    regularCloseMinutes: earlyClose ? EARLY_CLOSE_MINUTES : REGULAR_CLOSE_MINUTES,
    earlyClose,
    closureReason: null,
  };
}

export function classifyUsEquityMarketSession(timestamp: number): {
  session: UsEquityMarketSession;
  date: string | null;
  tradingDay: UsEquityTradingDay | null;
} {
  const parts = newYorkDateTimeParts(timestamp);
  if (!parts) return { session: "closed", date: null, tradingDay: null };
  const tradingDay = getUsEquityTradingDay(parts.date);
  if (!tradingDay.isTradingDay) return { session: "closed", date: parts.date, tradingDay };
  const minutes = parts.hour * 60 + parts.minute;
  if (minutes >= PREMARKET_OPEN_MINUTES && minutes < REGULAR_OPEN_MINUTES) {
    return { session: "premarket", date: parts.date, tradingDay };
  }
  if (minutes >= REGULAR_OPEN_MINUTES && minutes < tradingDay.regularCloseMinutes) {
    return { session: "regular", date: parts.date, tradingDay };
  }
  if (minutes >= tradingDay.regularCloseMinutes && minutes < POSTMARKET_CLOSE_MINUTES) {
    return { session: "postmarket", date: parts.date, tradingDay };
  }
  return { session: "closed", date: parts.date, tradingDay };
}

export function usEquitySessionStartMinutes(
  session: UsEquityMarketSession,
  tradingDay: UsEquityTradingDay,
): number | null {
  if (session === "premarket") return PREMARKET_OPEN_MINUTES;
  if (session === "regular") return REGULAR_OPEN_MINUTES;
  if (session === "postmarket") return tradingDay.regularCloseMinutes;
  return null;
}
