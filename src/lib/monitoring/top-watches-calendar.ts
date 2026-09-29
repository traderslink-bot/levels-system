import { getUsEquityTradingDay, newYorkDateTimeParts } from "../market-data/us-equity-exchange-calendar.js";
import type { TopWatchesGroup } from "../live-watchlist/top-watches-group.js";

/** Select once at Admin intake; the resulting group never rolls with the clock. */
export function upcomingTopWatchesGroup(now = Date.now()): TopWatchesGroup {
  const parts = newYorkDateTimeParts(now);
  if (!parts) throw new Error("Trading date is unavailable.");
  const today = getUsEquityTradingDay(parts.date);
  const includeToday = today.isTradingDay && parts.hour * 60 + parts.minute < today.regularOpenMinutes;
  const base = Date.parse(`${parts.date}T12:00:00Z`);
  for (let offset = includeToday ? 0 : 1; offset <= 14; offset++) {
    const date = new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
    if (getUsEquityTradingDay(date).isTradingDay) return `top_watches:${date}`;
  }
  throw new Error("Trading date is unavailable.");
}
