import type { ReviewState } from "./traderslink-ai-read-review-store.js";

/** Legacy rejections are deliberately not opted in to automatic replay. */
export function approvedDiscordRetryAt(state: ReviewState | null): number | null {
  const approval = state?.approved;
  if (!state || state.cancelled || approval?.body.kind !== "approve" || !approval.body.publication || state.draft?.revision !== approval.body.draftRevision) return null;
  if (!state.events.some(e => e.body.kind === "delivery" && e.body.approvalRevision === approval.revision && e.body.channel === "website" && e.body.status === "acknowledged")) return null;
  if (state.events.some(e => e.body.kind === "delivery" && e.body.approvalRevision === approval.revision && e.body.channel === "discord" && e.body.status === "acknowledged")) return null;
  for (let index = 0; index < approval.body.publication.discordChunks.length; index++) {
    const event = state.events.findLast(e => e.body.kind === "discord_chunk" && e.body.approvalRevision === approval.revision && e.body.index === index);
    if (event?.body.kind !== "discord_chunk") return null;
    if (event.body.status === "acknowledged") continue;
    return event.body.status === "rejected" && event.body.httpStatus === 429 && Number.isSafeInteger(event.body.rateLimit?.retryAt)
      ? event.body.rateLimit!.retryAt : null;
  }
  return null;
}
