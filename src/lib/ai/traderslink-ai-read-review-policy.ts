import type { ReviewState } from "./traderslink-ai-read-review-store.js";
import type { LiveWatchlistCardPatch, LiveWatchlistPublishedPatch } from "../live-watchlist/live-watchlist-types.js";

/** Approval probes do not publish data and need no invented update timestamp. */
export type WatchlistPublicationCheck = LiveWatchlistPublishedPatch | Pick<LiveWatchlistCardPatch, "symbol" | "cards">;

export type WatchlistPublicationReview = { cycleId: string; required: boolean };

/** Missing is a legacy ticker; malformed is never interpreted as bypass. */
export function normalizePublicationReview(value: unknown): WatchlistPublicationReview | undefined {
  if (value === undefined) return undefined;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.cycleId === "string" && candidate.cycleId.length > 0 && candidate.cycleId.length <= 200 && typeof candidate.required === "boolean") {
      return { cycleId: candidate.cycleId, required: candidate.required };
    }
  }
  return { cycleId: "invalid-review-state", required: true };
}

export function requiresInitialWatchlistReview(input: {
  reviewEnabled: boolean; generationEnabled: boolean;
  session: "premarket" | "regular" | "postmarket" | "closed";
  premarketEnabled: boolean; regularEnabled: boolean; postmarketEnabled: boolean;
}): boolean {
  if (!input.reviewEnabled || !input.generationEnabled || input.session === "closed") return false;
  return input.session === "premarket" ? input.premarketEnabled :
    input.session === "regular" ? input.regularEnabled : input.postmarketEnabled;
}

/** Uses the frozen activation decision, never today's mutable session switches. */
export function hasWatchlistPublicationApproval(
  symbol: string,
  rawReview: unknown,
  load: (cycleId: string) => ReviewState | null,
): boolean {
  const review = normalizePublicationReview(rawReview);
  if (!review) return true;
  try {
    const state = load(review.cycleId);
    if (!state || state.symbol !== symbol || state.cycleId !== review.cycleId ||
      state.cancelled || state.reviewRequired !== review.required) return false;
    if (!state.reviewRequired) return true;
    const approved = state.approved?.body;
    if (approved?.kind !== "approve") return false;
    // A new draft does not remove the prior approved public analysis.
    return state.events.some((event) => event.revision === approved.draftRevision &&
      (event.body.kind === "original" || event.body.kind === "edit"));
  } catch { return false; }
}

export function isWatchlistPatchApproved(patch: WatchlistPublicationCheck, rawReview: unknown, load: (id: string) => ReviewState | null): boolean {
  if (!("symbol" in patch)) return true;
  const review = normalizePublicationReview(rawReview);
  if (!review) return true;
  try {
    const state = load(review.cycleId);
    // Adopting an already-public ticker holds the replacement analysis, not
    // its live data. This is not evidence of a historical owner approval.
    if (state?.preserveExistingPublication === true && !state.cancelled &&
      state.symbol === patch.symbol && state.cycleId === review.cycleId &&
      state.reviewRequired === review.required &&
      (!("cards" in patch) || !("tradersLinkAiRead" in patch.cards))) return true;
    if (!hasWatchlistPublicationApproval(patch.symbol, review, () => state)) return false;
    if (!state!.reviewRequired) return true;
    const card = "cards" in patch ? patch.cards.tradersLinkAiRead : undefined;
    if (!card) return state!.events.some((event) => event.body.kind === "delivery" &&
      event.body.channel === "website" && event.body.status === "acknowledged");
    const approval = state?.approved?.body;
    if (approval?.kind !== "approve") return false;
    const draft = state!.events.find((event) => event.revision === approval.draftRevision)?.body;
    if (draft?.kind !== "original" && draft?.kind !== "edit") return false;
    // Generation ID alone is insufficient: an owner edit can share it.
    return card.body === JSON.stringify(draft.payload);
  } catch { return false; }
}
