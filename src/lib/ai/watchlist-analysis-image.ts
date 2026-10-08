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
      body(plan.confirmation.trim() ? `Required confirmation: ${plan.confirmation}` : ""),
    ]));
    add("targets", "Potential Targets (Volume Dependent)", simple.upside.flatMap(level => [value(area(level.low, level.high)), body(level.explanation)]));
    return sections;
  }
  // Future contracts need their own projection; do not silently misrepresent them.
  if (read.version !== 3) throw new Error("Unsupported image analysis version");
  add("currentRead", "Trade preparation", [body(`${read.marketSession ?? ""}${read.bias ? ` · ${read.bias} bias` : ""}`), body(read.currentRead)]);
  for (const [key, title] of [["needsToHold", "Structure Weakens"], ["cautionBelow", "Caution below"],
    ["momentumFailure", "Momentum failure"], ["mustClear", "Must clear"], ["breakoutContinuation", "Breakout continuation"]] as const) {
    const level = read[key];
    if (level) add(key, title, [value(price(level.price)), body(level.rationale)]);
  }
  add("targets", "Potential Targets (Volume Dependent)", read.targets.flatMap(level => [value(level.price === null ? level.label : price(level.price)), body(level.condition)]));
  let count = 0;
  for (const key of ["shallow", "deep"] as const) {
    const plan = read.pullbackPlans[key];
    if (!dipVisible || hidden.has(key) || !plan) continue;
    add(key, count++ ? "Deeper pullback" : "Pullback", [
      body(key === "shallow" ? "For traders seeking a controlled retest while momentum remains intact." : "For traders waiting for the accelerated move to unwind into its base."),
      value(area(plan.zoneLow, plan.zoneHigh)),
      body(plan.rationale),
      body(`Required confirmation: ${price(plan.confirmationPrice)}. ${plan.confirmation}`)]);
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

/** Owner-approved social preview: upside, then pullbacks.
 * Other sections remain on the website; never create empty images for hidden sections. */
export function splitImageSections(heights: readonly number[], keys: readonly string[], _comfortable = 1900, maximum = 4200): number[][] {
  if (!heights.length || heights.some(h => !Number.isFinite(h) || h <= 0)) throw new Error("Empty image content");
  if (heights.length !== keys.length) throw new Error("Image section mismatch");
  const groups = [["targets"], ["shallow","deep"]];
  const pages = groups.map(group => group.flatMap(key => keys.flatMap((found,i) => found === key ? [i] : []))).filter(page => page.length);
  if (!pages.length || pages.some(page => page.reduce((sum,i) => sum + heights[i]!,0) > maximum)) throw new Error("Analysis exceeds readable section groups");
  return pages;
}

/** Sharp/Pango measures wrapped glyphs; no guessed character widths or font shrinking. */
export async function renderAnalysisImages(read: TradersLinkAiReadPayload, dipVisible = true): Promise<AnalysisImage[]> {
  const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
  const fontfile = fileURLToPath(new URL("../../../assets/watchlist-fonts/Lato-Regular.ttf", import.meta.url));
  const boldfile = fileURLToPath(new URL("../../../assets/watchlist-fonts/Lato-Bold.ttf", import.meta.url));
  await sharp({ text: { text: ".", font: "Lato Bold 1", fontfile: boldfile, rgba: true } }).png().toBuffer();
  const included = new Set(["targets","shallow","deep"]);
  const sections = analysisImageSections(read, dipVisible).filter(section => included.has(section.key));
  const plainSize = sections.reduce((sum, section) => sum + section.title.length + section.blocks.reduce((n, b) => n + b.text.length, 0), 0);
  if (plainSize > 40000 || !/^[A-Z][A-Z0-9.-]{0,15}$/.test(read.symbol) || !Number.isFinite(read.generatedAt)
    || !Number.isFinite(read.currentPrice) || read.currentPrice <= 0) throw new Error("Invalid image content");
  const rasters: { input: Buffer; height: number; priceAnchors: number[] }[] = [];
  for (const section of sections) {
    // Measure each row so branding occupies only known empty space, never analysis text.
    const rows: { input: Buffer; left: number; top: number }[] = [];
    let rowTop = 0, priceRow = 0;
    const priceAnchors: number[] = [];
    const blocks = [{ text: section.title, kind: "heading" }, ...section.blocks];
    for (const block of blocks) {
      const heading = block.kind === "heading", isPrice = block.kind === "price";
      const markup = '<span foreground="' + (isPrice ? '#075e50' : '#172a46') + '">' +
        (heading || isPrice ? '<b>' : '') + escape(block.text) + (heading || isPrice ? '</b>' : '') + '</span>';
      const { data, info } = await sharp({ text: { text: markup, font: heading ? "Lato 42" : "Lato 28", fontfile, width: 880, rgba: true, spacing: 8, wrap: "word-char" } }).png().toBuffer({ resolveWithObject: true });
      rows.push({ input: data, left: 0, top: rowTop });
      if (isPrice) priceAnchors.push(rowTop + info.height + 50);
      if (isPrice && priceRow++ % 3 === 0 && priceRow <= 4 && info.width <= 480) {
        const mark = await sharp({ text: { text: '<span foreground="#a4afbc">app.traderslink.pro/watchlist</span>', font: "Lato 23", fontfile, width: 360, rgba: true, wrap: "word-char" } }).png().toBuffer({ resolveWithObject: true });
        if (mark.info.height <= info.height && mark.info.width <= 360) rows.push({ input: mark.data, left: 880 - mark.info.width, top: rowTop + Math.floor((info.height - mark.info.height) / 2) });
      }
      rowTop += info.height + 24;
    }
    const data = await sharp({ create: { width: 880, height: rowTop, channels: 4, background: { r:255, g:255, b:255, alpha:0 } } }).composite(rows).png().toBuffer();
    rasters.push({ input: data, height: rowTop + 24, priceAnchors });
  }
  const pages = splitImageSections(rasters.map(r => r.height), sections.map(section => section.key))
    .map(indices => indices.map(i => rasters[i]!));
  const output: AnalysisImage[] = [];
  const time = new Date(read.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!, height = page.reduce((sum, r) => sum + r.height, 335);
    let top = 245;
    const anchors: number[] = [];
    const layers = page.map(raster => { anchors.push(...raster.priceAnchors.map(y => y + top)); const layer = { input: raster.input, left: 60, top }; top += raster.height; return layer; });
    const frame = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}"><rect width="1000" height="8" fill="#011e56"/><g font-family="sans-serif"><text x="60" y="48" font-size="30" font-weight="700" fill="#c45100">app.traderslink.pro/watchlist</text><text x="60" y="103" font-size="24" font-weight="700" fill="#075e50">TRADERSLINK ANALYSIS</text><text x="860" y="103" font-size="24" fill="#53647b">${i+1} / ${pages.length}</text><text x="60" y="150" font-size="25" fill="#53647b">${escape(read.symbol)} · ${escape(time)} ET</text><text x="60" y="205" font-size="32" font-weight="700" fill="#172a46">${escape(read.symbol)} · Analysis price ${escape(price(read.currentPrice))}</text><text x="60" y="${height-32}" font-size="25" fill="#c45100">app.traderslink.pro/watchlist</text><text x="650" y="${height-32}" font-size="23" fill="#53647b">Original analysis · ${i+1} of ${pages.length}</text></g></svg>`;
    const bodyHeight = height - 335;
    const selectedAnchors = anchors.length > 1 ? [anchors[0]!, anchors[Math.floor(anchors.length / 2)]!] : anchors;
    const marks = selectedAnchors.map(anchor => {
      const y = Math.round(anchor);
      return '<text x="210" y="' + y + '" transform="rotate(-18 210 ' + y + ')" font-family="Lato" font-size="32" font-weight="700" fill="#011e56" opacity=".10">traderslink.pro</text>';
    }).join('');
    const watermark = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="' + height + '"><defs><clipPath id="body"><rect x="40" y="245" width="920" height="' + bodyHeight + '"/></clipPath></defs><g clip-path="url(#body)">' + marks + '</g></svg>';
    const bytes = await sharp({ create: { width: 1000, height, channels: 4, background: "#ffffff" } })
      .composite([{ input: Buffer.from(frame.replaceAll("sans-serif", "Lato")), left: 0, top: 0 }, ...layers, { input: Buffer.from(watermark.replaceAll("sans-serif", "Lato")), left: 0, top: 0 }]).png().toBuffer();
    if (bytes.length > 4_000_000) throw new Error("Analysis image too large");
    output.push({ filename: `${read.symbol}-analysis-${i+1}.png`, bytes, description: `${read.symbol} approved analysis, ${time} ET, image ${i+1} of ${pages.length}` });
  }
  return output;
}
