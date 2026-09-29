/** Immutable dated grouping. No current-time dependency in validation or display. */
export type TopWatchesGroup = `top_watches:${string}`;

export function isTopWatchesGroup(value: unknown): value is TopWatchesGroup {
  if (typeof value !== "string" || !/^top_watches:\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = value.slice(12);
  const time = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
}

export function topWatchesLabel(group: TopWatchesGroup): string {
  if (!isTopWatchesGroup(group)) return "Top Watches";
  const date = new Date(`${group.slice(12)}T12:00:00Z`);
  return `Top Watches · ${new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  }).format(date)}`;
}
