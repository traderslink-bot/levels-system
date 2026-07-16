function normalizeBaseWatchlistUrl(rawUrl: string | undefined): string | null {
  const value = rawUrl?.trim().replace(/\/+$/g, "");
  if (!value) {
    return null;
  }

  return /\/watchlist$/i.test(value) ? value : `${value}/watchlist`;
}

export function buildWatchlistDiscordLinkMessage(symbol: string): string {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const watchlistUrl = normalizeBaseWatchlistUrl(process.env.TRADERSLINK_WATCHLIST_PUBLIC_URL);

  if (!watchlistUrl) {
    return [
      "The watchlist has been updated.",
      "",
      `View ${normalizedSymbol} details when the watchlist link is configured.`,
    ].join("\n");
  }

  return [
    "The watchlist has been updated.",
    "",
    `View watchlist: ${watchlistUrl}`,
    `View ${normalizedSymbol} details: ${watchlistUrl}/${encodeURIComponent(normalizedSymbol)}`,
  ].join("\n");
}
