import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ReviewPublication } from "./traderslink-ai-read-publication-preview.js";
import type { LiveWatchlistCardPatch, TradersLinkAiReadPayload } from "../live-watchlist/live-watchlist-types.js";
import { renderAnalysisImages, type AnalysisImage } from "./watchlist-analysis-image.js";

/** Immutable local derivative of the frozen approval, reused after a confirmed rejection. */
export async function approvedAnalysisImages(directory: string, revision: number, publication: ReviewPublication,
  symbol: string, render = renderAnalysisImages): Promise<AnalysisImage[]> {
  if (publication.analysisImageVersion !== 1) return [];
  if (!Number.isSafeInteger(revision) || revision <= 0) throw new Error("Invalid approval revision");
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `analysis-images-${revision}.json`);
  const load = (): AnalysisImage[] => {
    const stored = JSON.parse(readFileSync(file, "utf8")) as { images: Array<{ filename: string; description: string; base64: string }> };
    if (!Array.isArray(stored.images) || stored.images.length > 2) throw new Error("Invalid image cache");
    return stored.images.map(image => ({ filename: image.filename, description: image.description, bytes: Buffer.from(image.base64, "base64") }));
  };
  if (existsSync(file)) return load();
  let images: AnalysisImage[] = [], status = "ready";
  try {
    const website = publication.website as unknown as LiveWatchlistCardPatch;
    const read = JSON.parse(website.cards.tradersLinkAiRead!.body) as TradersLinkAiReadPayload;
    if (read.symbol !== symbol) throw new Error("Image symbol mismatch");
    images = await render(read, website.tradersLinkAiReadDipBuyPlanVisible !== false);
  } catch {
    status = "text_only_render_failed";
    console.warn(`[Watchlist analysis image] ${symbol}: image rendering unavailable; preserving approved linked message.`);
  }
  const serialized = JSON.stringify({ version: 1, status, images: images.map(image => ({ filename: image.filename,
    description: image.description, base64: Buffer.from(image.bytes).toString("base64") })) });
  try { writeFileSync(file, serialized, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  return load();
}
