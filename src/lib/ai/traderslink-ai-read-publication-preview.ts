import { createHash } from "node:crypto";
import { buildWatchlistDiscordLinkMessage } from "../alerts/watchlist-discord-link-message.js";
import type { TradersLinkAiReadPayload } from "../live-watchlist/live-watchlist-types.js";

export type ReviewPublication = {
  /** Missing fields preserve historical approved delivery behavior. */
  notifyUsers?: boolean;
  notificationKind?: "listing" | "analysis";
  website: Record<string, unknown>;
  discordChunks: string[];
  /** Only new owner-approved publications opt into image attachments. */
  analysisImageVersion?: 1;
};

export function publicationPreviewHash(publication: ReviewPublication): string {
  // Delivery choice is frozen by approval, not part of the content preview.
  // A retry with the original preview must still identify that same content.
  const content = { ...publication };
  delete content.notifyUsers;
  delete content.notificationKind;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
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

/** Preserve the established linked notification; analysis belongs on the website. */
export function renderApprovedAnalysisDiscord(read: TradersLinkAiReadPayload, analysisUpdate = false): string[] {
  const linked = buildWatchlistDiscordLinkMessage(read.symbol);
  return [analysisUpdate ? `TradersLink Analysis is now available for ${read.symbol}.` + linked.slice(linked.indexOf("\n\n")) : linked];
}
