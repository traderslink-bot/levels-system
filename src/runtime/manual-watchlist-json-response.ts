/** Shared owner-console response reader. Never displays an upstream HTML/plaintext body. */
export const WATCHLIST_JSON_RESPONSE_READER = String.raw`
  async function readWatchlistJsonResponse(response) {
    let payload;
    try { payload = JSON.parse(await response.text()); } catch { /* Handle below without leaking upstream content. */ }
    const object = payload && typeof payload === 'object' && !Array.isArray(payload);
    if (!response.ok || !object) {
      const message = response.status === 429
        ? 'The Watchlist connection is temporarily rate limited. Your saved analyses are preserved. Check the ticker before retrying a publish or post.'
        : response.status === 401 || response.status === 403
          ? 'Watchlist access could not be verified. Sign in again to continue.'
          : object && typeof payload.error === 'string' ? payload.error
          : 'The Watchlist connection is temporarily unavailable. Your saved analyses are preserved. Check the ticker before retrying a publish or post.';
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload;
  }
`;
