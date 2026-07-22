import type { LiveWatchlistMarketDataStatus } from "../lib/live-watchlist/live-watchlist-types.js";
import type { LivePriceProviderName } from "../lib/monitoring/live-price-provider-factory.js";

export function resolveMarketDataStatus(args: {
  liveProviderName: LivePriceProviderName;
  startupState: "booting" | "ready" | "error";
  ibkrConnected: boolean;
  ibkrReconnecting: boolean;
  priceFeedStatus?: "live" | "stale" | "waiting" | "closed";
}): LiveWatchlistMarketDataStatus {
  if (args.startupState === "error") {
    return "offline";
  }
  if (args.startupState === "booting") {
    return "starting";
  }

  if (args.liveProviderName === "eodhd") {
    if (args.priceFeedStatus === "closed") {
      return "closed";
    }
    if (args.priceFeedStatus === "live" || args.priceFeedStatus === "stale") {
      return args.priceFeedStatus;
    }
    return "starting";
  }

  if (args.ibkrConnected) {
    return "live";
  }
  if (args.ibkrReconnecting) {
    return "offline";
  }
  return "offline";
}
