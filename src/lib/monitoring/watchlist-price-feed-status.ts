const easternClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", hour: "2-digit", hourCycle: "h23",
});

/** BOATS window only; fresh actual observations are still required for Live. */
export function isWatchlistOvernightSession(now: number): boolean {
  if (!Number.isFinite(now) || now <= 0) return false;
  const parts = Object.fromEntries(easternClock.formatToParts(now).map(p => [p.type, p.value]));
  const hour = Number(parts.hour);
  return hour >= 20 && ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(parts.weekday)
    || hour < 4 && ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(parts.weekday);
}

export function watchlistPriceFeedStatus(input: {
  now: number; regularSessionsClosed: boolean; overnightEnabled: boolean; lastPriceAgeMs: number | null;
  transport?: { connected: boolean; checkedAt: number } | null;
}): "closed" | "waiting" | "live" | "stale" {
  if (input.regularSessionsClosed && !(input.overnightEnabled && isWatchlistOvernightSession(input.now))) return "closed";
  if (input.transport) {
    const age = input.now - input.transport.checkedAt;
    return input.transport.connected && Number.isFinite(age) && age >= -2000 && age <= 30_000 ? "live" : "stale";
  }
  if (input.lastPriceAgeMs === null || !Number.isFinite(input.lastPriceAgeMs) || input.lastPriceAgeMs < 0) return "waiting";
  return input.lastPriceAgeMs <= 120_000 ? "live" : "stale";
}

/** Replace the one-time reference with a current real trade, never a receipt time. */
export function hasNewerLiveOvernightPrice(input: {
  overnightEnabled: boolean; referenceCheckedAt: number; referenceObservedAt?: number; observedAt: number; now: number;
}): boolean {
  const followsReference = input.referenceObservedAt === undefined ? input.observedAt > input.referenceCheckedAt
    : Number.isSafeInteger(input.referenceObservedAt) && input.referenceObservedAt > 0 && input.observedAt >= input.referenceObservedAt;
  return input.overnightEnabled && Number.isSafeInteger(input.referenceCheckedAt)
    && Number.isSafeInteger(input.observedAt) && followsReference
    && input.observedAt <= input.now + 2000 && input.now - input.observedAt <= 120_000
    && isWatchlistOvernightSession(input.now) && isWatchlistOvernightSession(input.observedAt);
}
