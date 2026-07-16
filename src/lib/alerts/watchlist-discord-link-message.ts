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
      `${normalizedSymbol} added to the watchlist.`,
      "",
      `View ${normalizedSymbol} details when the watchlist link is configured.`,
    ].join("\n");
  }

  const symbolUrl = `${watchlistUrl}/${encodeURIComponent(normalizedSymbol)}`;

  return [
    `${normalizedSymbol} added to the watchlist.`,
    "",
    `View ${normalizedSymbol} watchlist page: ${symbolUrl}`,
  ].join("\n");
}
