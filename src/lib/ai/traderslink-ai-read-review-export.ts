import type { ReviewState } from "./traderslink-ai-read-review-store.js";
import type { TradersLinkAiReadAuditStore } from "./traderslink-ai-read-audit.js";

/** Explicitly selected generation only. This does not grant standing access or
 * create a public URL. Immutable source records are never modified by export.
 */
export function exportAnalysisReview(input: {
  review: ReviewState; generationId: string;
  diagnostics: Pick<TradersLinkAiReadAuditStore, "read">;
  secrets?: readonly string[];
}) {
  const { review, generationId } = input;
  if (!review.events.some((event) => (event.body.kind === "original" || event.body.kind === "generation") && event.body.generationId === generationId)) throw new Error("Selected generation is not part of this ticker review.");
  const drafts = new Set<number>(), approvals = new Set<number>();
  let selected = false;
  const selectedEvents = review.events.filter((event) => {
    const body = event.body;
    if (body.kind === "generation") return body.generationId === generationId;
    if (body.kind === "original") selected = body.generationId === generationId;
    if (body.kind === "original" || body.kind === "edit") {
      if (selected) drafts.add(event.revision);
      return selected;
    }
    if (body.kind === "approve" && drafts.has(body.draftRevision)) { approvals.add(event.revision); return true; }
    return (body.kind === "delivery" || body.kind === "discord_chunk") && approvals.has(body.approvalRevision);
  });
  let diagnostic: unknown = null, diagnosticStatus = "not_captured_or_no_longer_available";
  try {
    const record = input.diagnostics.read(generationId);
    if (record && record.events.every((event) => event.generationId === generationId && event.symbol === review.symbol)) {
      diagnostic = record; diagnosticStatus = "available";
    } else if (record) diagnosticStatus = "identity_mismatch";
  } catch { diagnosticStatus = "unavailable"; }
  const privateKeys = /^(authorization|api_key|apikey|token|access_token|refresh_token|client_secret|password|cookie|set-cookie|bot_token|publisher_token)$/i;
  const secrets = (input.secrets ?? []).filter((secret) => secret.length >= 8);
  const encoded = JSON.stringify({
    version: 1, symbol: review.symbol, cycleId: review.cycleId, generationId,
    cancelled: review.cancelled, selectedEvents, diagnosticStatus, diagnostic,
    exportNote: "Selected generation history; source hashes reference the full private cycle. Credentials are redacted in this export. Missing historical packets have not been reconstructed.",
  }, (key, value) => {
    if (privateKeys.test(key)) return "[redacted]";
    if (typeof value !== "string") return value;
    let text = value;
    for (const secret of secrets) text = text.split(secret).join("[redacted]");
    return text.replace(/https?:\/\/[^\s<>"\\]+/g, (urlText) => {
      try {
        const url = new URL(urlText);
        let modified = false;
        if (url.username || url.password) { url.username = "redacted"; url.password = ""; modified = true; }
        for (const name of [...url.searchParams.keys()]) if (/token|api.?key|secret|password|signature/i.test(name)) { url.searchParams.set(name, "redacted"); modified = true; }
        return modified ? url.toString() : urlText;
      } catch { return urlText; }
    });
  });
  if (Buffer.byteLength(encoded) > 16 * 1024 * 1024) throw new Error("Selected audit export exceeds the response limit.");
  return JSON.parse(encoded) as Record<string, unknown>;
}
