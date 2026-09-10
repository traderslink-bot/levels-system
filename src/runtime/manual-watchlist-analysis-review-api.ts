import type { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";

type ReviewManager = Pick<ManualWatchlistRuntimeManager,
  "getTradersLinkAiReadReview" | "getTradersLinkAiReadPublicationPreview" | "listTradersLinkAiReadReviews" |
  "saveTradersLinkAiReadOwnerEdit" | "approveTradersLinkAiRead" |
  "publishApprovedTradersLinkAiReadToDiscord">;

export const ANALYSIS_REVIEW_PATHS = new Set([
  "/api/watchlist/analysis-review/export",
  "/api/watchlist/analysis-review/queue",
  "/api/watchlist/analysis-review/settings",
  "/api/watchlist/analysis-review", "/api/watchlist/analysis-review/preview",
  "/api/watchlist/analysis-review/save", "/api/watchlist/analysis-review/approve",
  "/api/watchlist/analysis-review/retry-discord",
]);

/** Called only after runtime bearer authentication. Actor is supplied by the
 * authenticated Platform owner proxy, never copied from the request body.
 */
export async function dispatchAnalysisReviewRequest(input: {
  method: string; pathname: string; searchParams: URLSearchParams;
  body?: unknown; actor: string | undefined;
}, manager: ReviewManager, controls?: {
  get(): { automaticUpdatesEnabled: boolean; reviewBeforePublishingEnabled: boolean };
  save(input: { automaticUpdatesEnabled: boolean; reviewBeforePublishingEnabled: boolean }): unknown;
  exportAudit?(symbol: string, generationId: string): unknown;
}): Promise<{ status: number; body: unknown }> {
  if (!input.actor || !/^platform-owner:[A-Za-z0-9_-]{1,128}$/.test(input.actor)) return { status: 403, body: { error: "Owner review authorization is required." } };
  if (!ANALYSIS_REVIEW_PATHS.has(input.pathname)) return { status: 404, body: { error: "Not found." } };
  const settingsRequest = input.pathname.endsWith("/settings");
  const queueRequest = input.pathname.endsWith("/queue");
  const exportRequest = input.pathname.endsWith("/export");
  const readOnly = exportRequest || queueRequest || input.pathname === "/api/watchlist/analysis-review" || input.pathname.endsWith("/preview") || (settingsRequest && input.method === "GET");
  if (input.method !== (readOnly ? "GET" : "POST")) return { status: 405, body: { error: "Method not allowed." } };
  try {
    if (queueRequest) return { status: 200, body: { tickers: manager.listTradersLinkAiReadReviews() } };
    if (settingsRequest) {
      if (!controls) throw new Error("Review controls unavailable.");
      if (readOnly) return { status: 200, body: { settings: controls.get() } };
      const settings = input.body as Record<string, unknown> | undefined;
      if (!settings || Array.isArray(settings) || typeof settings.automaticUpdatesEnabled !== "boolean" || typeof settings.reviewBeforePublishingEnabled !== "boolean" ||
        Object.keys(settings).some((key) => key !== "automaticUpdatesEnabled" && key !== "reviewBeforePublishingEnabled")) throw new Error("Invalid review request.");
      return { status: 200, body: { settings: controls.save({ automaticUpdatesEnabled: settings.automaticUpdatesEnabled, reviewBeforePublishingEnabled: settings.reviewBeforePublishingEnabled }) } };
    }
    const body = readOnly ? { symbol: input.searchParams.get("symbol") } : input.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid review request.");
    const fields = body as Record<string, unknown>;
    const symbol = typeof fields.symbol === "string" ? fields.symbol.trim().toUpperCase() : "";
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(symbol)) throw new Error("Invalid review request.");
    if (exportRequest) {
      const generationId = input.searchParams.get("generationId");
      if (!generationId || generationId.length > 200) throw new Error("Invalid review request.");
      if (!controls?.exportAudit) throw new Error("Audit export unavailable.");
      return { status: 200, body: { audit: controls.exportAudit(symbol, generationId) } };
    }
    if (readOnly) return { status: 200, body: input.pathname.endsWith("/preview")
      ? manager.getTradersLinkAiReadPublicationPreview(symbol)
      : { review: manager.getTradersLinkAiReadReview(symbol) } };
    const action = input.pathname.split("/").at(-1);
    const allowed = action === "save" ? ["symbol", "cycleId", "expectedHead", "patch"]
      : action === "approve" ? ["symbol", "cycleId", "expectedHead", "draftRevision", "previewHash"]
      : ["symbol", "cycleId", "approvalRevision"];
    if (Object.keys(fields).some((key) => !allowed.includes(key))) throw new Error("Invalid review request.");
    const cycleId = fields.cycleId;
    if (typeof cycleId !== "string" || !cycleId || cycleId.length > 200) throw new Error("Invalid review request.");
    const revision = (key: string) => {
      const value = fields[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("Invalid review request.");
      return value;
    };
    if (action === "save") return { status: 200, body: manager.saveTradersLinkAiReadOwnerEdit({
      symbol, cycleId, expectedHead: revision("expectedHead"), patch: fields.patch, actor: input.actor,
    }) };
    if (action === "approve") {
      if (typeof fields.previewHash !== "string" || !/^[a-f0-9]{64}$/.test(fields.previewHash)) throw new Error("Invalid review request.");
      return { status: 200, body: { review: await manager.approveTradersLinkAiRead({ symbol, cycleId,
        expectedHead: revision("expectedHead"), draftRevision: revision("draftRevision"), previewHash: fields.previewHash, actor: input.actor,
      }) } };
    }
    return { status: 200, body: { review: await manager.publishApprovedTradersLinkAiReadToDiscord({ symbol, cycleId, approvalRevision: revision("approvalRevision") }) } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Invalid review request.") return { status: 400, body: { error: message } };
    // Only fixed product messages are exposed. Provider errors can contain
    // response bodies or private paths and must not be returned to the browser.
    const safe = new Set([
      "Draft changed. Review the latest version.", "Draft changed. Reload before saving.",
      "Publication preview changed. Review it before publishing.", "Review changed. Reload before saving.",
      "Ticker review changed. Reload before saving.", "Publication approval changed.",
      "Discord delivery is awaiting confirmation. It has not been sent again.",
      "Website delivery must be confirmed before Discord publication.",
      "No analysis draft is available to preview.", "No analysis draft is available to edit.",
    ]);
    return { status: safe.has(message) ? 409 : 503, body: { error: safe.has(message) ? message : "Analysis review could not complete. Previously saved versions are preserved; reload to check delivery status." } };
  }
}
