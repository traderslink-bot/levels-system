import type { WatchlistEntry } from "./monitoring-types.js";

export type WatchlistEntrySessionGroup = "main" | "postmarket";

const entryTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  timeZone: "America/New_York",
});

export function getWatchlistEntrySessionGroup(
  entry: Pick<WatchlistEntry, "activatedAt" | "tags" | "note">,
): WatchlistEntrySessionGroup {
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
  const parts = Object.fromEntries(
    entryTimeFormatter
      .formatToParts(new Date(entry.activatedAt))
      .map((part) => [part.type, part.value]),
  );
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 16 * 60 && minutes < 20 * 60 ? "postmarket" : "main";
}
