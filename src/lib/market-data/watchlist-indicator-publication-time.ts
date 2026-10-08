import type { ReviewState } from "../ai/traderslink-ai-read-review-store.js";

const timestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** Publication eligibility only; this timestamp is not the indicator cache identity. */
export function watchlistIndicatorPublicationTime(
  activatedAt: number | undefined,
  reviewRequired: boolean,
  review: ReviewState | null,
): number | null {
  if (!timestamp(activatedAt)) return null;
  if (!reviewRequired) return activatedAt;
  if (!review || review.cancelled) return null;
  // A replacement review does not change the original public activation.
  if (review.preserveExistingPublication) return activatedAt;
  const acknowledged = review.events.find(event => event.body.kind === "delivery"
    && event.body.channel === "website" && event.body.status === "acknowledged");
  if (acknowledged?.body.kind !== "delivery") return null;
  const approvalRevision = acknowledged.body.approvalRevision;
  const approval = review.events.find(event => event.revision === approvalRevision);
  if (approval?.body.kind !== "approve") return null;
  const website = approval.body.publication?.website;
  if (!website) return null;
  if (timestamp(website.firstPostedAt)) return website.firstPostedAt;
  // The first approved patch is frozen in the audit. Later edits/refreshes
  // must not move this identity. Platform uses the earliest first-patch card.
  const cards = website.cards;
  if (!cards || typeof cards !== "object") return null;
  const times = Object.values(cards).flatMap(card => {
    if (!card || typeof card !== "object" || !("updatedAt" in card)) return [];
    return timestamp(card.updatedAt) ? [card.updatedAt] : [];
  });
  return times.length ? Math.min(...times) : null;
}

/** Saved opaque activation identity; never manufacture one during a refresh. */
export function watchlistIndicatorPublicationIdentity(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) ? value : undefined;
}
