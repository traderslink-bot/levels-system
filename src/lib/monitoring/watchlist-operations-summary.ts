import type { ReviewState } from "../ai/traderslink-ai-read-review-store.js";
import type { TradersLinkAiReadRunEvent } from "../ai/traderslink-ai-read-run-ledger.js";

export type DeliveryCounts = { label: string; available: boolean; pending: number; sending: number; failed: number; uncertain: number };
export function emptyDeliveryCounts(label: string): DeliveryCounts {
  return { label, available: true, pending: 0, sending: 0, failed: 0, uncertain: 0 };
}

/** Only completed validation is a successful analysis; request/attempt success is not. */
export function latestSuccessfulAnalysis(events: readonly TradersLinkAiReadRunEvent[]) {
  const event = events.filter(item => item.stage === "validation" && item.outcome === "success" &&
    Number.isFinite(item.occurredAt) && item.occurredAt > 0)
    .reduce<TradersLinkAiReadRunEvent | null>((latest, item) => !latest || item.occurredAt > latest.occurredAt ? item : latest, null);
  return event ? { symbol: event.symbol, at: event.occurredAt, model: event.model ?? null } : null;
}

/** Current saved approval only. Started without an acknowledgement is unconfirmed,
 * never assumed to be a safe retry or a still-running network request. */
export function countReviewDelivery(row: DeliveryCounts, review: ReviewState | null): void {
  if (!review || review.cancelled || review.approved?.body.kind !== "approve") return;
  const approval = review.approved;
  if (approval.body.kind !== "approve" || approval.body.publication?.notifyUsers === false || !approval.body.publication) return;
  const receipt = review.events.findLast(event => event.body.kind === "delivery" &&
    event.body.channel === "discord" && event.body.approvalRevision === approval.revision);
  if (receipt?.body.kind === "delivery") {
    if (receipt.body.status === "failed") row.failed++;
    else if (receipt.body.status === "started") row.uncertain++;
    return;
  }
  // Chunk acknowledgements may predate the aggregate receipt. An interrupted
  // multi-chunk send is uncertain, not a fresh pending job.
  const chunks = review.events.filter(event => event.body.kind === "discord_chunk" && event.body.approvalRevision === approval.revision);
  if (chunks.length) {
    const latest = new Map<number, string>();
    for (const event of chunks) if (event.body.kind === "discord_chunk") latest.set(event.body.index, event.body.status);
    if ([...latest.values()].some(status => status === "started")) row.uncertain++;
    else if ([...latest.values()].some(status => status === "rejected")) row.failed++;
    else if (latest.size < approval.body.publication.discordChunks.length) row.pending++;
    return;
  }
  row.pending++;
}
