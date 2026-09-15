import type { TradersLinkAiReadPayload } from "../live-watchlist/live-watchlist-types.js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export type ImageBlock = { text: string; kind: "body" | "price" };
export type ImageSection = { key: string; title: string; blocks: ImageBlock[] };
export type AnalysisImage = { filename: string; bytes: Uint8Array; description: string };
const price = (n: number | null) => n === null ? "" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
const area = (lo: number, hi: number) => lo === hi ? price(lo) : `${price(lo)}–${price(hi)}`;
const body = (text: string): ImageBlock => ({ text, kind: "body" });
const value = (text: string): ImageBlock => ({ text, kind: "price" });
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
function decodedDisplay(text: string): string {
  for (;;) {
    const next = text.replace(/(?:%[0-9a-f]{2})+/gi, span => { try { return decodeURIComponent(span); } catch { return span; } });
    if (next === text) return text;
    text = next;
  }
}
const blockedSource = (text: string) => /stock[\s._+-]*titan/i.test(decodedDisplay(text));
function visibleText(text: string): string {
  if (!blockedSource(text)) return text;
  return decodedDisplay(text).replace(/https?:\/\/[^\s"'<>()]*stock[\s._+-]*titan[^\s"'<>()]*/gi, "")
    .replace(/stock[\s._+-]*titan(?:\.[\w-]+)?/gi, "").replace(/\s{2,}/g, " ").trim();
}

/** Explicit visible-field projection: never export usage, evidence IDs or audit data. */
export function analysisImageSections(read: TradersLinkAiReadPayload, dipVisible = true): ImageSection[] {
  const hidden = new Set(read.ownerHiddenSections ?? []);
  const sections: ImageSection[] = [];
  const add = (key: string, title: string, blocks: ImageBlock[]) => {
    const visible = blocks.map(block => ({ ...block, text: visibleText(block.text) })).filter(block => block.text.trim());
    if (!hidden.has(key) && visible.length) sections.push({ key, title, blocks: visible });
  };
  if (read.analysisFormat === "simple") {
    const simple = read.simpleAnalysis;
    if (!simple) throw new Error("Missing simple analysis");
    add("currentRead", "Trade preparation", [body(simple.setup)]);
    const plans = simple.pullbacks.map((plan, i) => ({ plan, key: i === 0 ? "shallow" : "deep" }))
      .filter(({ key }) => !hidden.has(key));
    plans.forEach(({ plan, key }, i) => add(key, i ? "Deeper pullback" : "Pullback", [
      value(area(plan.low, plan.high)), body(plan.explanation),
      body(plan.confirmation.trim() ? `Confirmation: ${plan.confirmation}` : ""), body(`Invalidation: ${price(plan.invalidation)}`),
    ]));
    add("targets", "Where it could go next", simple.upside.flatMap(level => [value(area(level.low, level.high)), body(level.explanation)]));
    if (simple.invalidation) add("momentumFailure", "Thesis invalidation", [value(price(simple.invalidation.price)), body(simple.invalidation.explanation)]);
    return sections;
  }
  // Future contracts need their own projection; do not silently misrepresent them.
  if (read.version !== 3) throw new Error("Unsupported image analysis version");
  add("currentRead", "Trade preparation", [body(`${read.marketSession ?? ""}${read.bias ? ` · ${read.bias} bias` : ""}`), body(read.currentRead)]);
  for (const [key, title] of [["needsToHold", "Needs to hold"], ["cautionBelow", "Caution below"],
    ["momentumFailure", "Momentum failure"], ["mustClear", "Must clear"], ["breakoutContinuation", "Breakout continuation"]] as const) {
    const level = read[key];
    if (level) add(key, title, [value(price(level.price)), body(level.rationale)]);
  }
  add("targets", "Where the trade could go next", read.targets.flatMap(level => [value(level.price === null ? level.label : price(level.price)), body(level.condition)]));
  let count = 0;
  for (const key of ["shallow", "deep"] as const) {
    const plan = read.pullbackPlans[key];
    if (!dipVisible || hidden.has(key) || !plan) continue;
    add(key, count++ ? "Deeper pullback" : "Pullback", [
      body(key === "shallow" ? "For traders seeking a controlled retest while momentum remains intact." : "For traders waiting for the accelerated move to unwind into its base."),
      value(area(plan.zoneLow, plan.zoneHigh)),
      body(`Required confirmation: ${price(plan.confirmationPrice)}. ${plan.confirmation}`),
      body(`Invalidation: ${price(plan.invalidationPrice)}`),
      body(plan.firstObjectivePrice === null ? "" : `First objective: ${price(plan.firstObjectivePrice)}`), body(plan.rationale)]);
  }
  add("downsideCheckpoints", "Downside after thesis failure", read.downsideCheckpoints.flatMap(level => [value(level.price === null ? level.label : price(level.price)), body(level.condition)]));
  const recovery = read.failureRecovery;
  if (dipVisible && recovery) add("failureRecovery", "Failure and recovery", [value(`Recovery-watch area: ${area(recovery.recoveryZoneLow, recovery.recoveryZoneHigh)}`),
    body(`First recovery reclaim: ${price(recovery.firstReclaimPrice)} after a new base forms`),
    body(`Recovery setup established above: ${price(recovery.setupRestorePrice)}`),
    body(recovery.firstObjectivePrice === null ? "" : `First recovery objective: ${price(recovery.firstObjectivePrice)}`), body(recovery.rationale)]);
  if (read.catalystRealityCheck.sourceUrls.some(url => !blockedSource(url))) {
    const summary = read.catalystRealityCheck.summary.replace(/^\s*(?:the\s+)?(?:supplied|provided)\s+(?:TradersLink\s+)?(?:processed\s+)?article\s+(?:confirms|states|reports|says|notes)\s+(?:that\s+)?/iu, "")
      .replace(/\s*Source:\s*https?:\/\/\S+\s*$/iu, "");
    const sources = read.sources.filter(source => source.sourceType === "press_release_sec_database" && !blockedSource(source.title) && !blockedSource(source.url));
    add("catalystRealityCheck", "Catalyst / recent news", [body(summary), ...sources.map(source => body(source.title + (source.evidence?.publishedAt ? ` · ${source.evidence.publishedAt.slice(0, 10)}` : "")))]);
  }
  add("riskSummary", "Risk notes", read.riskSummary.map(body));
  return sections;
}

/** Keep the owner's semantic split: overview, pullbacks onward, optional news/risk. */
export function splitImageSections(heights: readonly number[], keys: readonly string[], comfortable = 1900, maximum = 4200): number[][] {
  if (!heights.length || heights.some(h => !Number.isFinite(h) || h <= 0)) throw new Error("Empty image content");
  if (heights.length !== keys.length) throw new Error("Image section mismatch");
  const all = heights.map((_, i) => i);
  const total = heights.reduce((a, b) => a + b, 0);
  if (total <= comfortable) return [all];
  const pullback = keys.findIndex(key => key === "shallow" || key === "deep");
  const news = keys.findIndex(key => key === "catalystRealityCheck" || key === "riskSummary");
  // Hidden pullbacks never create an empty page. Recovery/downside remains a
  // useful second group when no pullback is visible; otherwise use news/risk.
  const recovery = keys.findIndex(key => key === "downsideCheckpoints" || key === "failureRecovery");
  const boundary = pullback >= 0 ? pullback : recovery >= 0 ? recovery : news;
  const pages = boundary > 0 ? [all.slice(0, boundary), all.slice(boundary)] : [all];
  const last = pages.at(-1)!;
  if (news > (last[0] ?? 0) && last.reduce((sum, i) => sum + heights[i]!, 0) > maximum) {
    pages.splice(pages.length - 1, 1, last.filter(i => i < news), last.filter(i => i >= news));
  }
  if (pages.some(page => page.reduce((sum, i) => sum + heights[i]!, 0) > maximum)) {
    throw new Error("Analysis exceeds readable section groups");
  }
  return pages;
}

/** Sharp/Pango measures wrapped glyphs; no guessed character widths or font shrinking. */
export async function renderAnalysisImages(read: TradersLinkAiReadPayload, dipVisible = true): Promise<AnalysisImage[]> {
  const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
  const fontfile = fileURLToPath(new URL("../../../assets/watchlist-fonts/Lato-Regular.ttf", import.meta.url));
  const boldfile = fileURLToPath(new URL("../../../assets/watchlist-fonts/Lato-Bold.ttf", import.meta.url));
  await sharp({ text: { text: ".", font: "Lato Bold 1", fontfile: boldfile, rgba: true } }).png().toBuffer();
  const sections = analysisImageSections(read, dipVisible);
  const plainSize = sections.reduce((sum, section) => sum + section.title.length + section.blocks.reduce((n, b) => n + b.text.length, 0), 0);
  if (plainSize > 40000 || !/^[A-Z][A-Z0-9.-]{0,15}$/.test(read.symbol) || !Number.isFinite(read.generatedAt)
    || !Number.isFinite(read.currentPrice) || read.currentPrice <= 0) throw new Error("Invalid image content");
  const rasters: { input: Buffer; height: number }[] = [];
  for (const section of sections) {
    const markup = `<span foreground="#edf2fa"><b>${escape(section.title)}</b></span>\n\n` + section.blocks.map(block =>
      `<span foreground="${block.kind === "price" ? "#71d6c1" : "#edf2fa"}">${block.kind === "price" ? "<b>" : ""}${escape(block.text)}${block.kind === "price" ? "</b>" : ""}</span>`).join("\n\n");
    const { data, info } = await sharp({ text: { text: markup, font: "Lato 28", fontfile, width: 880, rgba: true, spacing: 8, wrap: "word-char" } }).png().toBuffer({ resolveWithObject: true });
    rasters.push({ input: data, height: info.height + 48 });
  }
  const pages = splitImageSections(rasters.map(r => r.height), sections.map(section => section.key))
    .map(indices => indices.map(i => rasters[i]!));
  const output: AnalysisImage[] = [];
  const time = new Date(read.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!, height = page.reduce((sum, r) => sum + r.height, 290);
    let top = 200;
    const layers = page.map(raster => { const layer = { input: raster.input, left: 60, top }; top += raster.height; return layer; });
    const frame = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}"><rect width="1000" height="8" fill="#62cdb9"/><g font-family="sans-serif"><text x="60" y="58" font-size="24" font-weight="700" fill="#71d6c1">TRADERSLINK ANALYSIS</text><text x="860" y="58" font-size="24" fill="#afc1da">${i+1} / ${pages.length}</text><text x="60" y="105" font-size="25" fill="#afc1da">${escape(read.symbol)} · ${escape(time)} ET</text><text x="60" y="160" font-size="32" font-weight="700" fill="#edf2fa">${escape(read.symbol)} · Analysis price ${escape(price(read.currentPrice))}</text><text x="60" y="${height-32}" font-size="28" fill="#71d6c1">traderslink.pro</text><text x="560" y="${height-32}" font-size="23" fill="#afc1da">Original analysis · ${i+1} of ${pages.length}</text></g></svg>`;
    const watermark = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}"><defs><pattern id="w" width="500" height="320" patternUnits="userSpaceOnUse" patternTransform="rotate(-22)"><text x="35" y="165" font-family="sans-serif" font-size="39" font-weight="700" fill="#b6c8e2" opacity=".085">traderslink.pro</text></pattern></defs><rect width="100%" height="100%" fill="url(#w)"/></svg>`;
    const bytes = await sharp({ create: { width: 1000, height, channels: 4, background: "#101c30" } })
      .composite([{ input: Buffer.from(frame.replaceAll("sans-serif", "Lato")), left: 0, top: 0 }, ...layers, { input: Buffer.from(watermark.replaceAll("sans-serif", "Lato")), left: 0, top: 0 }]).png().toBuffer();
    if (bytes.length > 4_000_000) throw new Error("Analysis image too large");
    output.push({ filename: `${read.symbol}-analysis-${i+1}.png`, bytes, description: `${read.symbol} approved analysis, ${time} ET, image ${i+1} of ${pages.length}` });
  }
  return output;
}
