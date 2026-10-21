/** Highest-priced complete zone first; unfinished rows stay at the end.
 * Move whole records, never detach explanations or visibility from their prices. */
export function sortPullbacksByPrice<T>(rows: readonly T[], lowKey = "low", highKey = "high"): T[] {
  const range = (row: T) => {
    const item = row && typeof row === "object" ? row as Record<string, unknown> : {};
    const low = item[lowKey], high = item[highKey];
    return typeof low === "number" && Number.isFinite(low) && low > 0 &&
      typeof high === "number" && Number.isFinite(high) && high > 0 ? [low, high] : null;
  };
  return rows.slice().sort((a,b) => {
    const left=range(a), right=range(b);
    return left && right ? right[0]! - left[0]! || right[1]! - left[1]! : left ? -1 : right ? 1 : 0;
  });
}
