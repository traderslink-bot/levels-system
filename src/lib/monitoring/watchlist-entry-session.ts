import type { WatchlistEntry, WatchlistGroup } from "./monitoring-types.js";
import { classifyUsEquityMarketSession } from "../market-data/us-equity-exchange-calendar.js";

export type WatchlistEntrySessionGroup = WatchlistGroup;

export function getWatchlistEntrySessionGroup(
  entry: Pick<WatchlistEntry, "activatedAt" | "tags" | "note" | "watchlistGroup">,
): WatchlistEntrySessionGroup {
  if (
    entry.watchlistGroup === "top_regular" ||
    entry.watchlistGroup === "main" ||
    entry.watchlistGroup === "postmarket"
  ) {
    return entry.watchlistGroup;
  }
  const tags = new Set(entry.tags.map((tag) => tag.trim().toLowerCase()));
  if (tags.has("auto-postmarket")) return "postmarket";
  if (tags.has("auto-main")) return "main";

  const labelledSession = /^Auto-selected during (premarket|regular|postmarket):/i
    .exec(entry.note ?? "")?.[1]?.toLowerCase();
  if (labelledSession === "postmarket") return "postmarket";
  if (labelledSession === "premarket" || labelledSession === "regular") return "main";

  if (typeof entry.activatedAt !== "number" || !Number.isFinite(entry.activatedAt)) {
    return "main";
  }
  return classifyUsEquityMarketSession(entry.activatedAt).session === "postmarket"
    ? "postmarket"
    : "main";
}
