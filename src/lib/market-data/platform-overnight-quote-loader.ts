import { normalizeOvernightLevelReference, overnightResumeAfter, type OvernightLevelReference } from '../live-watchlist/overnight-level-reference.js';

export async function loadPlatformOvernightQuote(symbol: string, now: number, environment: NodeJS.ProcessEnv = process.env): Promise<OvernightLevelReference | null> {
  if (overnightResumeAfter(now) === null) return null;
  const ingest = environment.TRADERSLINK_WATCHLIST_INGEST_URL?.trim();
  const token = environment.TRADERSLINK_WATCHLIST_PUBLISHER_TOKEN?.trim();
  if (!ingest || !token) return null;
  try {
    const url = new URL(ingest);
    if (!url.pathname.endsWith('/ingest')) return null;
    url.pathname = url.pathname.slice(0, -'/ingest'.length) + '/overnight-quote';
    url.search = new URLSearchParams({ symbol }).toString();
    const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const payload = await response.json();
    if (payload.status !== 'ready' || payload.symbol !== symbol) return null;
    const reference = normalizeOvernightLevelReference(payload.reference);
    return reference && reference.checkedAt >= now - 1000 && reference.checkedAt <= Date.now() + 1000 ? reference : null;
  } catch { return null; }
}
