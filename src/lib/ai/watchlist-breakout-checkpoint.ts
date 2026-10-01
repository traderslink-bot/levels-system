type Level = { price: number | null; rationale: string };
type Target = { price: number | null; label: string; condition: string };

/** Generation-time projection only. Never reinsert a row after an owner edits it. */
export function includeBreakoutCheckpoint<T extends { breakoutContinuation: Level; targets: Target[] }>(read: T, referencePrice: number): T {
  const level = read.breakoutContinuation;
  if (level.price === null || !Number.isFinite(level.price) || level.price <= referencePrice || !Number.isFinite(referencePrice)) return read;
  const price = level.price;
  const matches = (target: Target) => target.price !== null && Math.abs(target.price - price) <= Math.max(1, Math.abs(price)) * 1e-10;
  const existing = read.targets.find(matches);
  const breakout: Target = existing
    ? { ...existing, label: "Breakout level" }
    : { price, label: "Breakout level", condition: level.rationale };
  const targets = [...read.targets.filter(target => !matches(target)), breakout];
  targets.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  return { ...read, targets };
}
