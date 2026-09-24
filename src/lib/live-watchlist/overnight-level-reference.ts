export type OvernightLevelReference = {
  price: number;
  checkedAt: number;
  resumeAfter: number;
};

const easternParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** The next 04:00 ET boundary for an eligible overnight session. */
export function overnightResumeAfter(now: number): number | null {
  if (!Number.isFinite(now) || now <= 0) return null;
  const parts = Object.fromEntries(easternParts.formatToParts(new Date(now)).map(p => [p.type, p.value]));
  const hour = Number(parts.hour);
  const weekday = parts.weekday;
  if (!(hour >= 20 && ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(weekday) ||
    hour < 4 && ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday))) return null;
  const seconds = (hour >= 20 ? 28 - hour : 4 - hour) * 3600 - Number(parts.minute) * 60 - Number(parts.second);
  // Eligible sessions never cross the Sunday 02:00 DST transition.
  return now - now % 1000 + seconds * 1000;
}

export function normalizeOvernightLevelReference(value: unknown): OvernightLevelReference | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<OvernightLevelReference>;
  if (typeof input.price !== 'number' || !Number.isFinite(input.price) || input.price <= 0 ||
    typeof input.checkedAt !== 'number' || !Number.isSafeInteger(input.checkedAt) ||
    typeof input.resumeAfter !== 'number' || overnightResumeAfter(input.checkedAt) !== input.resumeAfter) return null;
  return { price: input.price, checkedAt: input.checkedAt, resumeAfter: input.resumeAfter };
}

export function isFreshDaySessionQuote(reference: OvernightLevelReference, observedAt: number): boolean {
  if (!Number.isFinite(observedAt) || observedAt < reference.resumeAfter || observedAt <= reference.checkedAt) return false;
  const parts = Object.fromEntries(easternParts.formatToParts(new Date(observedAt)).map(p => [p.type, p.value]));
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday) && Number(parts.hour) >= 4 && Number(parts.hour) < 20;
}
