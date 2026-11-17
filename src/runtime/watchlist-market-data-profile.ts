/** Recorded immediately before the November 7 Alpaca cutover. */
export const WATCHLIST_MARKET_DATA_PROFILES = {
  alpaca: { historicalProvider: "alpaca", liveProvider: "alpaca", sameDayCandleProvider: "alpaca" },
  previous: { historicalProvider: "eodhd", liveProvider: "eodhd", sameDayCandleProvider: "moomoo" },
} as const;
export type WatchlistMarketDataProfile = keyof typeof WATCHLIST_MARKET_DATA_PROFILES;
export type WatchlistProviderRoles = { historicalProvider: string; liveProvider: string; sameDayCandleProvider: string };
export function identifyWatchlistMarketDataProfile(roles: WatchlistProviderRoles): WatchlistMarketDataProfile | null {
  for (const profile of ["alpaca", "previous"] as const) {
    const expected = WATCHLIST_MARKET_DATA_PROFILES[profile];
    if (Object.keys(expected).every(key => roles[key as keyof WatchlistProviderRoles] === expected[key as keyof WatchlistProviderRoles])) return profile;
  }
  return null;
}
export class WatchlistProfileChangeError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
/** One profile operation at a time; legacy single-role controls use the same gate. */
export class WatchlistMarketDataProfileGate {
  private changing = false;
  get busy() { return this.changing; }
  async change<T>(operation: () => Promise<T>): Promise<T> {
    if (this.changing) throw new WatchlistProfileChangeError(409, "Watchlist provider change is already in progress.");
    this.changing = true;
    try { return await operation(); } finally { this.changing = false; }
  }
}
