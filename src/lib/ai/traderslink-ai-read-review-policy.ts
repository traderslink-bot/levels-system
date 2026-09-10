import type { ReviewState } from "./traderslink-ai-read-review-store.js";

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
