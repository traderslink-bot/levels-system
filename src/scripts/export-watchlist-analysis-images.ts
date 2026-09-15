import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { renderAnalysisImages } from "../lib/ai/watchlist-analysis-image.js";
import type { TradersLinkAiReadPayload } from "../lib/live-watchlist/live-watchlist-types.js";

// Offline preview of an explicitly selected saved read. No Discord or AI imports.
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: export-watchlist-analysis-images <saved-read.json> <output-directory>");
const saved = JSON.parse(readFileSync(resolve(input), "utf8"));
const read = (saved.read ?? saved) as TradersLinkAiReadPayload;
const images = await renderAnalysisImages(read, saved.dipBuyPlanVisible !== false);
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
for (const image of images) {
  const target = join(directory, image.filename);
  writeFileSync(target, image.bytes, { flag: "wx" });
  console.log(target);
}
