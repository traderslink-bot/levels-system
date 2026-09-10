import { createHash } from "node:crypto";
import type { TradersLinkAiReadPayload } from "../live-watchlist/live-watchlist-types.js";

export type ReviewPublication = {
  website: Record<string, unknown>;
  discordChunks: string[];
};

export function publicationPreviewHash(publication: ReviewPublication): string {
  return createHash("sha256").update(JSON.stringify(publication)).digest("hex");
}

/** Split without truncating, dropping lines or changing the previewed text.
 * UTF-16 surrogate pairs stay together. Joining the chunks reproduces the text.
 */
export function splitApprovedAnalysisText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 2_000) {
    const newline = remaining.lastIndexOf("\n", 1_999);
    let end = newline >= 1_000 ? newline + 1 : 2_000;
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1]!)) end--;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}

/** Deterministic owner preview and Discord body; no model/provider calls.
 * Diagnostic evidence, model metadata and source URLs are not post copy.
 */
export function renderApprovedAnalysisDiscord(read: TradersLinkAiReadPayload): string[] {
  const hidden = new Set(read.ownerHiddenSections ?? []);
  const price = (value: number | null) => value === null ? null : `$${value}`;
  const sections = [`${read.symbol} — TradersLink Analysis`,
    `Analysis price: ${price(read.currentPrice)}\nBias: ${read.bias}. Confidence: ${read.confidence}.`];
  const add = (key: string, title: string, lines: Array<string | null | undefined>) => {
    if (hidden.has(key)) return;
    const body = lines.filter((line): line is string => typeof line === "string" && Boolean(line.trim())).join("\n");
    if (body) sections.push(title ? `${title}\n${body}` : body);
  };
  add("currentRead", "", [read.currentRead]);
  for (const [key, title] of [
    ["needsToHold", "Needs to hold"], ["cautionBelow", "Caution below"],
    ["momentumFailure", "Momentum failure"], ["mustClear", "Must clear"],
    ["breakoutContinuation", "Breakout continuation"],
  ] as const) {
    const level = read[key];
    add(key, title, [level.label, price(level.price), level.rationale]);
  }
  for (const [key, title] of [["targets", "Where the trade could go next"], ["downsideCheckpoints", "Downside levels"]] as const) {
    add(key, title, read[key].map((level) => [level.label, price(level.price), level.condition].filter(Boolean).join(" — ")));
  }
  for (const [key, title] of [["shallow", "Shallow pullback"], ["deep", "Deep pullback"]] as const) {
    const plan = read.pullbackPlans[key];
    if (plan) add(key, title, [
      `Area: ${price(plan.zoneLow)}–${price(plan.zoneHigh)}`,
      `Confirmation: ${price(plan.confirmationPrice)}. ${plan.confirmation}`,
      `Invalidation: ${price(plan.invalidationPrice)}`,
      plan.firstObjectivePrice === null ? null : `Next level: ${price(plan.firstObjectivePrice)}`,
      plan.rationale,
    ]);
  }
  const recovery = read.failureRecovery;
  if (recovery) add("failureRecovery", "Failure and recovery", [
    `Area: ${price(recovery.recoveryZoneLow)}–${price(recovery.recoveryZoneHigh)}`,
    `First reclaim: ${price(recovery.firstReclaimPrice)}`,
    `Recovery setup established above: ${price(recovery.setupRestorePrice)}`,
    recovery.firstObjectivePrice === null ? null : `Next level: ${price(recovery.firstObjectivePrice)}`,
    recovery.rationale,
  ]);
  for (const [key, title] of [["catalystRealityCheck", "Catalyst / recent news"], ["dilutionRisk", "Dilution risk"], ["listingStatus", "Listing status"]] as const) {
    add(key, title, [read[key].summary, read[key].dayTradeRelevance]);
  }
  add("riskSummary", "Risk notes", read.riskSummary);
  return splitApprovedAnalysisText(sections.join("\n\n"));
}
