import type { TradersLinkAiReadLevel, TradersLinkAiReadTarget } from "../live-watchlist/live-watchlist-types.js";
import { validateBreakoutOrdering } from "./traderslink-ai-read-section-validation.js";
import type { TradersLinkAiReadPriceActionContext } from "./traderslink-ai-read-price-action.js";

export type BreakoutEvidence = { id: string; price: number; observedAt: number; timeframe: "intraday" | "one_minute" | "daily"; kind: "candle_high" };

/** Addressable observed highs, not inferred support/resistance or a guarantee
 * that a high makes a good breakout. Model selection still has to explain the
 * setup; these IDs establish which supplied observation supports its price.
 */
export function buildBreakoutEvidence(context: TradersLinkAiReadPriceActionContext, referencePrice: number, dataAsOf: number): BreakoutEvidence[] {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0 || !Number.isFinite(dataAsOf)) return [];
  const result: BreakoutEvidence[] = [];
  const seen = new Set<string>();
  for (const [timeframe, candles] of [["intraday", context.intradayCandles], ["one_minute", context.oneMinuteCandles ?? []], ["daily", context.dailyCandles]] as const) {
    for (const candle of candles) {
      if (!Number.isFinite(candle.timestamp) || candle.timestamp > dataAsOf || candle.timestamp <= 0 ||
        !Number.isFinite(candle.high) || candle.high < referencePrice ||
        !Number.isFinite(candle.low) || candle.low <= 0 || candle.low > candle.high) continue;
      const id = `breakout:${timeframe}:${candle.timestamp}:high`;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({ id, price: candle.high, observedAt: candle.timestamp, timeframe, kind: "candle_high" });
    }
  }
  return result;
}

export function validateBreakoutEvidence(candidate: BreakoutCandidate, evidence: readonly BreakoutEvidence[]): string[] {
  const byId = new Map(evidence.map(item => [item.id, item]));
  const reasons: string[] = [];
  if (candidate.evidenceIds.some(id => !byId.has(id))) reasons.push("Unknown breakout evidence ID.");
  const price = candidate.level.price;
  const anchor = candidate.anchorPrice;
  // Numerical precision only: do not turn candle range into a broad license
  // to label a different price as the cited high.
  const tolerance = anchor < 1 ? 0.00005 : 0.005;
  if (!Number.isFinite(anchor) || anchor <= 0 || !candidate.evidenceIds.some(id => {
    const item = byId.get(id);
    return item && Math.abs(item.price - anchor) <= tolerance + Number.EPSILON;
  })) reasons.push("Breakout anchor does not match cited observation.");
  if (price === null || !Number.isFinite(price) || price <= 0) reasons.push("Breakout price unavailable.");
  else if (candidate.basis === "observed_level") {
    if (Math.abs(price - anchor) > tolerance + Number.EPSILON) reasons.push("Observed breakout price differs from its anchor.");
  } else if (candidate.basis === "confirmation_above") {
    if (price <= anchor) reasons.push("Confirmation must be above its observed anchor.");
    if (!candidate.level.rationale.trim()) reasons.push("Confirmation explanation missing.");
  } else reasons.push("Unknown breakout price basis.");
  return reasons;
}

export type BreakoutCandidate = {
  id: "primary" | "alternate";
  level: TradersLinkAiReadLevel;
  // Objectives belong to this candidate, not a different continuation price.
  targets: TradersLinkAiReadTarget[];
  evidenceIds: string[];
  anchorPrice: number;
  basis: "observed_level" | "confirmation_above";
};

export type BreakoutTarget = TradersLinkAiReadTarget & { id: string; dependsOn: string[] };

export function retainBreakoutTargets(input: {
  candidateId: "primary" | "alternate"; continuationPrice: number;
  targets: readonly BreakoutTarget[]; spacing: number;
  validate: (target: TradersLinkAiReadTarget) => boolean;
}) {
  const retained: BreakoutTarget[] = [];
  const issues: Array<{ id: string; reason: string }> = [];
  const accepted = new Set<string>([input.candidateId]);
  const counts = new Map<string, number>();
  for (const target of input.targets) counts.set(target.id, (counts.get(target.id) ?? 0) + 1);
  let prior = input.continuationPrice;
  for (const target of input.targets) {
    const invalidIdentity = !target.id || counts.get(target.id) !== 1 || target.id === "primary" || target.id === "alternate";
    const reason = invalidIdentity ? "Invalid or duplicate target identity."
      : target.dependsOn.some(id => !accepted.has(id)) ? "Required prior branch or level is unavailable."
      : target.price === null || !Number.isFinite(target.price) || target.price <= 0 || target.price - prior < input.spacing ? "Invalid upside sequence."
      : !input.validate(structuredClone(target)) ? "Unsupported upside level." : null;
    if (reason) { issues.push({ id: target.id, reason }); continue; }
    retained.push(structuredClone(target)); accepted.add(target.id); prior = target.price!;
  }
  return { retained, issues };
}

/** Pure one-response selection. The caller supplies frozen-packet evidence
 * validation; absence of that validation must never imply support. Original
 * candidates are retained unchanged for the generation audit.
 */
export function selectBreakoutCandidate(input: {
  referencePrice: number;
  mustClear: TradersLinkAiReadLevel;
  primary: BreakoutCandidate | null;
  alternate: BreakoutCandidate | null;
  validateEvidence: (candidate: BreakoutCandidate) => string[];
}) {
  const decisions: Array<{ id: BreakoutCandidate["id"]; selected: boolean; reasons: string[] }> = [];
  let selected: BreakoutCandidate | null = null;
  for (const [expectedId, candidate] of [["primary", input.primary], ["alternate", input.alternate]] as const) {
    if (!candidate) continue;
    // The backup must never supplant a valid primary because it looks more
    // attractive or provides a larger potential percentage move.
    if (selected) {
      decisions.push({ id: expectedId, selected: false, reasons: ["Primary candidate retained."] });
      continue;
    }
    const reasons: string[] = [];
    if (candidate.id !== expectedId) reasons.push("Candidate identity mismatch.");
    if (input.mustClear.price === null) reasons.push("Must-clear pivot unavailable.");
    if (candidate.level.price === null) reasons.push("Breakout price unavailable.");
    const ordering = validateBreakoutOrdering(input.mustClear, candidate.level, input.referencePrice);
    reasons.push(...ordering.issues.map(issue => `${issue.path}: ${issue.code}`));
    if (!candidate.evidenceIds.length) reasons.push("Candidate evidence missing.");
    reasons.push(...input.validateEvidence(structuredClone(candidate)));
    if (!reasons.length) selected = structuredClone(candidate);
    decisions.push({ id: expectedId, selected: reasons.length === 0, reasons });
  }
  return { selected, decisions };
}
