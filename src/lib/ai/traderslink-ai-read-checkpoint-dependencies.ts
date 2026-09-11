import type { TradersLinkAiReadTarget } from "../live-watchlist/live-watchlist-types.js";

/** New checkpoints declare their dependencies. Legacy checkpoints have an
 * unresolved ordered chain: after a rejected member, do not assume later
 * conditional prices became independent. No metadata enters public payloads. */
export function retainAnalysisCheckpoints(input: {
  raw: unknown; root: "breakoutContinuation" | "momentumFailure";
  rootPrice: number; direction: "up" | "down"; spacing: number;
  validate: (target: TradersLinkAiReadTarget) => string | null;
}) {
  const retained: TradersLinkAiReadTarget[] = [];
  const issues: Array<{ index: number; id: string | null; reason: string; omitted: unknown }> = [];
  if (!Array.isArray(input.raw)) return { retained, issues };
  const rows = input.raw.slice(0, 4);
  const explicit = rows.some(row => row && typeof row === "object" && (Object.hasOwn(row, "id") || Object.hasOwn(row, "dependsOn")));
  const counts = new Map<string, number>();
  for (const row of rows) if (typeof row?.id === "string") counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  const accepted = new Set([input.root as string]);
  let prior = input.rootPrice;
  let legacyBroken = false;
  rows.forEach((row, index) => {
    const id = typeof row?.id === "string" ? row.id : null;
    let reason: string | null = null;
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.label !== "string" ||
      typeof row.condition !== "string" || !row.condition.trim() || typeof row.price !== "number" || !Number.isFinite(row.price) || row.price <= 0) {
      reason = "Malformed checkpoint.";
    } else if (explicit && (!id || id.length > 80 || id === input.root || counts.get(id) !== 1 ||
      !Array.isArray(row.dependsOn) || !row.dependsOn.length || row.dependsOn.length > 4 ||
      row.dependsOn.some((dependency: unknown) => typeof dependency !== "string" || !accepted.has(dependency)))) {
      reason = "Checkpoint identity or required dependency is unavailable.";
    } else if (!explicit && legacyBroken) reason = "Earlier legacy checkpoint was omitted; later dependencies are undeclared.";
    else if (!Number.isFinite(prior) || prior <= 0 || (input.direction === "up" ? row.price - prior : prior - row.price) < input.spacing) {
      reason = "Checkpoint is out of sequence.";
    } else reason = input.validate({ label: row.label, price: row.price, condition: row.condition });
    if (reason) {
      issues.push({ index, id, reason, omitted: row }); legacyBroken = true; return;
    }
    retained.push({ label: row.label, price: row.price, condition: row.condition });
    prior = row.price;
    if (id) accepted.add(id);
  });
  return { retained, issues };
}
