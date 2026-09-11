import type { TradersLinkAiReadLevel } from "../live-watchlist/live-watchlist-types.js";

export const CORE_LEVEL_NAMES = ["needsToHold", "cautionBelow", "momentumFailure"] as const;
export type CoreLevelName = typeof CORE_LEVEL_NAMES[number];

export function validateUpperEvidence(level: TradersLinkAiReadLevel, raw: unknown, observed: (price: number) => boolean): string[] {
  if (level.price === null) return [];
  if (!level.rationale.trim()) return ["Level explanation is missing"];
  if (raw === undefined) return observed(level.price) ? [] : ["Level lacks observable price evidence"];
  const anchor = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!anchor || typeof anchor.anchorPrice !== "number" || !Number.isFinite(anchor.anchorPrice) ||
    anchor.anchorPrice <= 0 || !observed(anchor.anchorPrice)) return ["No supported observed anchor"];
  const tolerance = anchor.anchorPrice < 1 ? 0.00005 : 0.005;
  if (anchor.basis === "observed_level") return Math.abs(level.price - anchor.anchorPrice) <= tolerance + Number.EPSILON
    ? [] : ["Observed level differs from its anchor"];
  if (anchor.basis === "confirmation_above") return level.price > anchor.anchorPrice &&
    typeof anchor.explanation === "string" && anchor.explanation.trim() ? [] : ["Confirmation needs a higher price and explanation"];
  return ["Unknown evidence basis"];
}

/** A derived threshold is not presented as an observed traded price. */
export function validateCoreEvidence(
  levels: Record<CoreLevelName, TradersLinkAiReadLevel>,
  anchors: unknown,
  observed: (price: number) => boolean,
): string[] {
  const issues: string[] = [];
  const declared = anchors !== undefined;
  const object = anchors && typeof anchors === "object" && !Array.isArray(anchors)
    ? anchors as Record<string, unknown> : null;
  for (const name of CORE_LEVEL_NAMES) {
    const level = levels[name];
    if (level.price === null) continue;
    if (!declared) {
      if (!observed(level.price)) issues.push(`${name} lacks observable price evidence`);
      continue;
    }
    const raw = object?.[name];
    const anchor = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    if (!anchor || typeof anchor.anchorPrice !== "number" || !Number.isFinite(anchor.anchorPrice) ||
      anchor.anchorPrice <= 0 || !observed(anchor.anchorPrice)) {
      issues.push(`${name} has no supported observed anchor`); continue;
    }
    const tolerance = anchor.anchorPrice < 1 ? 0.00005 : 0.005;
    if (anchor.basis === "observed_level") {
      if (Math.abs(level.price - anchor.anchorPrice) > tolerance + Number.EPSILON) {
        issues.push(`${name} observed level differs from its anchor`);
      }
    } else if (anchor.basis === "threshold_below") {
      if (!(level.price > 0 && level.price < anchor.anchorPrice) ||
        typeof anchor.explanation !== "string" || !anchor.explanation.trim()) {
        issues.push(`${name} derived threshold needs a lower price and an explanation`);
      }
    } else issues.push(`${name} has an unknown evidence basis`);
  }
  return issues;
}
