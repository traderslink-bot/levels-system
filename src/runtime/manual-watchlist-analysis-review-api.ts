import { createHash } from "node:crypto";
import type { ManualWatchlistRuntimeManager } from "../lib/monitoring/manual-watchlist-runtime-manager.js";
import { DiscordConfirmedRejection } from "../lib/alerts/discord-confirmed-rejection.js";
import { loadDiscordMentions, saveDiscordMentions } from "../lib/alerts/watchlist-discord-mentions.js";

type ReviewManager = Pick<ManualWatchlistRuntimeManager,
  "getTradersLinkAiReadReview" | "getTradersLinkAiReadPublicationPreview" | "listTradersLinkAiReadReviews" |
  "listTradersLinkAiReadHistory" | "getHistoricalTradersLinkAiReadReview" |
  "saveTradersLinkAiReadOwnerEdit" | "approveTradersLinkAiRead" | "publishTickerWithoutAnalysis" |
  "verifyTradersLinkAiReadDiscordReceipt" |
  "publishApprovedTradersLinkAiReadToDiscord">;

export const ANALYSIS_REVIEW_PATHS = new Set([
  "/api/watchlist/published-analysis-history",
  "/api/watchlist/analysis-review/discord-mentions",
  "/api/watchlist/analysis-review/publish-without-analysis",
  "/api/watchlist/analysis-review/verify-discord",
  "/api/watchlist/analysis-review/history",
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
  get(): { automaticUpdatesEnabled: boolean; reviewBeforePublishingEnabled: boolean; analysisFormat?: "current" | "simple" };
  save(input: { automaticUpdatesEnabled: boolean; reviewBeforePublishingEnabled: boolean; analysisFormat?: "current" | "simple" }): unknown;
  exportAudit?(symbol: string, generationId: string, cycleId?: string): unknown;
}): Promise<{ status: number; body: unknown }> {
  // Runtime bearer authentication has already succeeded. Unlike the private
  // review API, this projection returns only acknowledged public time/price rows.
  if (input.pathname === "/api/watchlist/published-analysis-history") {
    if (input.method !== "GET") return { status: 405, body: { error: "Method not allowed." } };
    const symbol = input.searchParams.get("symbol") ?? "";
    const digest = input.searchParams.get("bodyHash") ?? "";
    if (!/^[A-Za-z0-9.^-]{1,16}$/.test(symbol) || !/^[a-f0-9]{64}$/.test(digest)) return { status: 400, body: { error: "Invalid history request." } };
    try {
      const review = await manager.getTradersLinkAiReadReview(symbol);
      const events = review?.events ?? [];
      const acknowledged = new Set(events.filter(e => e.body.kind === "delivery" && e.body.channel === "website" && e.body.status === "acknowledged").map(e => e.body.kind === "delivery" ? e.body.approvalRevision : -1));
      const approvals = events.filter(e => e.body.kind === "approve" && acknowledged.has(e.revision)).sort((a, b) => a.revision - b.revision);
      const rows: { generatedAt: number; price: number }[] = [];
      const seen = new Set<string>();
      let matched = false;
      for (const event of approvals) {
        if (event.body.kind !== "approve") continue;
        const cards = event.body.publication?.website.cards as { tradersLinkAiRead?: { body?: unknown } } | undefined;
        const body = cards?.tradersLinkAiRead?.body;
        if (typeof body !== "string" || !body) continue;
        const read = JSON.parse(body) as { generationId?: string; generatedAt?: number; currentPrice?: number };
        const time = read.generatedAt, price = read.currentPrice;
        if (typeof time !== "number" || !Number.isFinite(time) || time <= 0 || typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
        const key = `${read.generationId ?? time}:${price}`;
        if (!seen.has(key)) { rows.push({ generatedAt: time, price }); seen.add(key); }
        if (createHash("sha256").update(body).digest("hex") === digest) { matched = true; break; }
      }
      return { status: 200, body: { rows: matched ? rows : [] } };
    } catch { return { status: 503, body: { error: "Published analysis history is unavailable." } }; }
  }
  if (!input.actor || !/^platform-owner:[A-Za-z0-9_-]{1,128}$/.test(input.actor)) return { status: 403, body: { error: "Owner review authorization is required." } };
  if (!ANALYSIS_REVIEW_PATHS.has(input.pathname)) return { status: 404, body: { error: "Not found." } };
  if (input.pathname.endsWith("/discord-mentions")) {
    if (input.method !== "GET" && input.method !== "POST") return { status: 405, body: { error: "Method not allowed." } };
    try { return { status: 200, body: { settings: input.method === "GET" ? loadDiscordMentions() : saveDiscordMentions(input.body) } }; }
    catch { return { status: 400, body: { error: "Mention settings could not be read or saved. Check unique role IDs, labels and on/off choices, then try again." } }; }
  }
  const settingsRequest = input.pathname.endsWith("/settings");
  const queueRequest = input.pathname.endsWith("/queue");
  const exportRequest = input.pathname.endsWith("/export");
  const historyRequest = input.pathname.endsWith("/history");
  const readOnly = historyRequest || exportRequest || queueRequest || input.pathname === "/api/watchlist/analysis-review" || input.pathname.endsWith("/preview") || (settingsRequest && input.method === "GET");
  if (input.method !== (readOnly ? "GET" : "POST")) return { status: 405, body: { error: "Method not allowed." } };
  try {
    // Historical selection belongs only to read/export. Never silently return
    // a current preview (or execute an action) for a historical-cycle URL.
    if (input.searchParams.has("cycleId") &&
      !(input.method === "GET" && (exportRequest || input.pathname === "/api/watchlist/analysis-review"))) {
      throw new Error("Invalid review request.");
    }
    if (queueRequest) return { status: 200, body: { tickers: manager.listTradersLinkAiReadReviews() } };
    if (settingsRequest) {
      if (!controls) throw new Error("Review controls unavailable.");
      if (readOnly) return { status: 200, body: { settings: controls.get() } };
      const settings = input.body as Record<string, unknown> | undefined;
      if (!settings || Array.isArray(settings) || typeof settings.automaticUpdatesEnabled !== "boolean" || typeof settings.reviewBeforePublishingEnabled !== "boolean" ||
        (settings.analysisFormat !== undefined && settings.analysisFormat !== "current" && settings.analysisFormat !== "simple") ||
        Object.keys(settings).some((key) => key !== "automaticUpdatesEnabled" && key !== "reviewBeforePublishingEnabled" && key !== "analysisFormat")) throw new Error("Invalid review request.");
      return { status: 200, body: { settings: controls.save({ automaticUpdatesEnabled: settings.automaticUpdatesEnabled, reviewBeforePublishingEnabled: settings.reviewBeforePublishingEnabled, ...(settings.analysisFormat ? {analysisFormat:settings.analysisFormat as "current" | "simple"} : {}) }) } };
    }
    const body = readOnly ? { symbol: input.searchParams.get("symbol") } : input.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid review request.");
    const fields = body as Record<string, unknown>;
    const symbol = typeof fields.symbol === "string" ? fields.symbol.trim().toUpperCase() : "";
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(symbol)) throw new Error("Invalid review request.");
    const selectedCycle = readOnly ? input.searchParams.get("cycleId") ?? undefined : undefined;
    if (selectedCycle !== undefined && (!selectedCycle || selectedCycle.length > 200)) throw new Error("Invalid review request.");
    if (historyRequest) {
      const after = input.searchParams.get("after") ?? undefined;
      if (after !== undefined && !/^[a-f0-9]{64}$/.test(after)) throw new Error("Invalid review request.");
      return { status: 200, body: manager.listTradersLinkAiReadHistory(symbol, after) };
    }
    if (exportRequest) {
      const generationId = input.searchParams.get("generationId");
      if (!generationId || generationId.length > 200) throw new Error("Invalid review request.");
      if (!controls?.exportAudit) throw new Error("Audit export unavailable.");
      return { status: 200, body: { audit: controls.exportAudit(symbol, generationId, selectedCycle) } };
    }
    if (readOnly) return { status: 200, body: input.pathname.endsWith("/preview")
      ? manager.getTradersLinkAiReadPublicationPreview(symbol)
      : { review: selectedCycle ? manager.getHistoricalTradersLinkAiReadReview(symbol, selectedCycle) : manager.getTradersLinkAiReadReview(symbol), historical: Boolean(selectedCycle) } };
    const action = input.pathname.split("/").at(-1);
    const allowed = action === "publish-without-analysis" ? ["symbol", "cycleId", "expectedHead"]
      : action === "save" ? ["symbol", "cycleId", "expectedHead", "patch"]
      : action === "approve" ? ["symbol", "cycleId", "expectedHead", "draftRevision", "previewHash", "notifyUsers"]
      : action === "verify-discord" ? ["symbol", "cycleId", "expectedHead", "approvalRevision", "index", "messageId"]
      : ["symbol", "cycleId", "approvalRevision"];
    if (Object.keys(fields).some((key) => !allowed.includes(key))) throw new Error("Invalid review request.");
    const cycleId = fields.cycleId;
    if (typeof cycleId !== "string" || !cycleId || cycleId.length > 200) throw new Error("Invalid review request.");
    const revision = (key: string) => {
      const value = fields[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("Invalid review request.");
      return value;
    };
    if (action === "publish-without-analysis") return { status: 200, body: { review: await manager.publishTickerWithoutAnalysis({
      symbol, cycleId, expectedHead: revision("expectedHead"), actor: input.actor,
    }) } };
    if (action === "save") return { status: 200, body: manager.saveTradersLinkAiReadOwnerEdit({
      symbol, cycleId, expectedHead: revision("expectedHead"), patch: fields.patch, actor: input.actor,
    }) };
    if (action === "verify-discord") {
      if (typeof fields.index !== "number" || !Number.isSafeInteger(fields.index) || fields.index < 0 ||
        typeof fields.messageId !== "string" || !/^\d{17,20}$/.test(fields.messageId)) throw new Error("Invalid review request.");
      return { status: 200, body: { review: await manager.verifyTradersLinkAiReadDiscordReceipt({
        symbol, cycleId, expectedHead: revision("expectedHead"), approvalRevision: revision("approvalRevision"),
        index: fields.index, messageId: fields.messageId, actor: input.actor,
      }) } };
    }
    if (action === "approve") {
      if (fields.notifyUsers !== undefined && typeof fields.notifyUsers !== "boolean") throw new Error("Invalid review request.");
      // Legacy clients may supply this display token; it is not approval authority.
      const previewHash = typeof fields.previewHash === "string" ? fields.previewHash : "";
      return { status: 200, body: { review: await manager.approveTradersLinkAiRead({ symbol, cycleId,
        expectedHead: revision("expectedHead"), draftRevision: revision("draftRevision"), previewHash, actor: input.actor, notifyUsers: fields.notifyUsers as boolean | undefined,
      }) } };
    }
    return { status: 200, body: { review: await manager.publishApprovedTradersLinkAiReadToDiscord({ symbol, cycleId, approvalRevision: revision("approvalRevision") }) } };
  } catch (error) {
    if (error instanceof DiscordConfirmedRejection) return {
      status: 503,
      body: { error: error.status === 429
        ? "Your analysis is approved and published on the website. Discord is temporarily rate-limiting delivery. Delivery will retry automatically after the cooldown; you do not need to approve again."
        : "Your analysis is approved. Discord could not accept the notification (HTTP " + error.status + "). Your approval is saved." },
    };
    const message = error instanceof Error ? error.message : "";
    if (message === "Invalid review request.") return { status: 400, body: { error: message } };
    // Only fixed product messages are exposed. Provider errors can contain
    // response bodies or private paths and must not be returned to the browser.
    const safe = new Set([
      "Draft changed. Review the latest version.", "Draft changed. Reload before saving.",
      "Publication preview changed. Review it before publishing.", "Review changed. Reload before saving.",
      "Discord message does not match the approved delivery. No delivery status was changed.",
      "Discord delivery is not awaiting confirmation.",
      "Ticker review changed. Reload before saving.", "Publication approval changed.",
      "Discord delivery is awaiting confirmation. It has not been sent again.",
      "Website delivery must be confirmed before Discord publication.",
      "No analysis draft is available to preview.", "No analysis draft is available to edit.",
    ]);
    return { status: safe.has(message) ? 409 : 503, body: { error: safe.has(message) ? message : "Analysis review could not complete. Previously saved versions are preserved; reload to check delivery status." } };
  }
}
