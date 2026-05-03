import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type DiscordAuditRow = {
  operation?: string;
  status?: string;
  timestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
  messageKind?: string;
  eventType?: string;
  triggerPrice?: number;
  targetPrice?: number;
  rangeBoxLabel?: string;
  acceptanceLabel?: string;
  behaviorBudgetLabel?: string;
  primaryTradeAreaLocked?: boolean;
  failedLevelOutcome?: string;
  levelImportanceLabel?: string;
  noLevelReason?: string;
};

export type VisualAuditReplayPoint = {
  timestamp: number;
  title: string;
  messageKind: string;
  eventType: string;
  price: number | null;
  rangeBoxLabel?: string;
  acceptanceLabel?: string;
  behaviorBudgetLabel?: string;
  issueFlags: string[];
  excerpt: string;
};

export type VisualAuditReplaySymbol = {
  symbol: string;
  postCount: number;
  priceLow: number | null;
  priceHigh: number | null;
  issueCount: number;
  points: VisualAuditReplayPoint[];
};

export type VisualAuditReplayReport = {
  generatedAt: string;
  sourceAuditPath: string;
  symbols: VisualAuditReplaySymbol[];
};

function readRows(path: string): DiscordAuditRow[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as DiscordAuditRow];
      } catch {
        return [];
      }
    });
}

function text(row: DiscordAuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join(" ");
}

function extractPrice(row: DiscordAuditRow): number | null {
  if (typeof row.triggerPrice === "number" && Number.isFinite(row.triggerPrice)) {
    return row.triggerPrice;
  }
  if (typeof row.targetPrice === "number" && Number.isFinite(row.targetPrice)) {
    return row.targetPrice;
  }
  const match = text(row).match(/\b(?:Price|Triggered near):\s*(\d+(?:\.\d{1,4})?)/i);
  if (!match?.[1]) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function excerpt(row: DiscordAuditRow): string {
  const value = text(row).replace(/\s+/g, " ").trim();
  return value.length > 260 ? `${value.slice(0, 257)}...` : value;
}

function issueFlags(row: DiscordAuditRow): string[] {
  const flags: string[] = [];
  if (row.acceptanceLabel === "weak_probe" || row.failedLevelOutcome === "probe_only") {
    flags.push("weak probe");
  }
  if (row.primaryTradeAreaLocked && row.acceptanceLabel !== "accepted") {
    flags.push("inside locked area");
  }
  if (row.noLevelReason || /none currently surfaced/i.test(text(row))) {
    flags.push("missing next level");
  }
  if (row.levelImportanceLabel === "minor_noise") {
    flags.push("minor level");
  }
  return flags;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pctPosition(price: number | null, low: number | null, high: number | null): number {
  if (price === null || low === null || high === null || high <= low) {
    return 50;
  }
  return Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
}

export function buildVisualAuditReplayReport(auditPath: string): VisualAuditReplayReport {
  const rows = readRows(auditPath)
    .filter((row) => row.operation === "post_alert" && (row.status === "success" || row.status === "posted") && row.symbol)
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
  const bySymbol = new Map<string, DiscordAuditRow[]>();
  for (const row of rows) {
    const symbol = row.symbol!.trim().toUpperCase();
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), row]);
  }

  const symbols = [...bySymbol.entries()]
    .map(([symbol, symbolRows]) => {
      const points = symbolRows.map((row) => ({
        timestamp: row.timestamp ?? 0,
        title: row.title ?? "untitled",
        messageKind: row.messageKind ?? "unknown",
        eventType: row.eventType ?? "unknown",
        price: extractPrice(row),
        rangeBoxLabel: row.rangeBoxLabel,
        acceptanceLabel: row.acceptanceLabel,
        behaviorBudgetLabel: row.behaviorBudgetLabel,
        issueFlags: issueFlags(row),
        excerpt: excerpt(row),
      }));
      const prices = points.map((point) => point.price).filter((price): price is number => price !== null);
      return {
        symbol,
        postCount: points.length,
        priceLow: prices.length > 0 ? Math.min(...prices) : null,
        priceHigh: prices.length > 0 ? Math.max(...prices) : null,
        issueCount: points.reduce((count, point) => count + point.issueFlags.length, 0),
        points,
      };
    })
    .sort((left, right) => right.postCount - left.postCount || left.symbol.localeCompare(right.symbol));

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    symbols,
  };
}

export function formatVisualAuditReplayHtml(report: VisualAuditReplayReport): string {
  const index = report.symbols.map((symbol) =>
    `<a href="#symbol-${escapeHtml(symbol.symbol)}">${escapeHtml(symbol.symbol)} (${symbol.postCount} posts, ${symbol.issueCount} flags)</a>`
  ).join(" ");

  const rows = report.symbols.map((symbol) => {
    const points = symbol.points.map((point) => {
      const left = pctPosition(point.price, symbol.priceLow, symbol.priceHigh);
      const label = [
        point.eventType,
        point.acceptanceLabel ? `acceptance: ${point.acceptanceLabel}` : null,
        point.rangeBoxLabel ? `range: ${point.rangeBoxLabel}` : null,
        point.behaviorBudgetLabel ? `budget: ${point.behaviorBudgetLabel}` : null,
        point.issueFlags.length > 0 ? `flags: ${point.issueFlags.join(", ")}` : null,
      ].filter(Boolean).join(" | ");
      const flagClass = point.issueFlags.length > 0 ? " flagged" : "";
      return `<button class="point ${escapeHtml(point.eventType)}${flagClass}" style="left:${left.toFixed(1)}%" title="${escapeHtml(`${new Date(point.timestamp).toLocaleString()} - ${point.title}\n${label}\n${point.excerpt}`)}"></button>`;
    }).join("");
    return `
      <section class="symbol" id="symbol-${escapeHtml(symbol.symbol)}">
        <h2>${escapeHtml(symbol.symbol)} <span>${symbol.postCount} posts | ${symbol.issueCount} review flags</span></h2>
        <div class="scale"><span>${symbol.priceLow ?? "n/a"}</span><span>${symbol.priceHigh ?? "n/a"}</span></div>
        <div class="track">${points}</div>
        <ol>
          ${symbol.points.slice(0, 40).map((point) => `<li><strong>${escapeHtml(point.title)}</strong> <span>${escapeHtml(point.eventType)}</span> ${point.price === null ? "" : `near ${point.price}`} ${point.issueFlags.length > 0 ? `<em>${escapeHtml(point.issueFlags.join(", "))}</em>` : ""}</li>`).join("")}
        </ol>
      </section>
    `;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Visual Audit Replay</title>
<style>
body { font-family: Arial, sans-serif; margin: 24px; color: #17202a; background: #f7f8fa; }
h1 { margin-bottom: 4px; }
.meta { color: #5d6d7e; margin-bottom: 24px; }
.index { margin: 0 0 18px; line-height: 1.8; }
.index a { display: inline-block; margin: 0 8px 8px 0; padding: 4px 8px; background: white; border: 1px solid #d8dee6; border-radius: 6px; color: #1f2937; text-decoration: none; font-size: 13px; }
.symbol { background: white; border: 1px solid #d8dee6; border-radius: 8px; padding: 16px; margin-bottom: 18px; }
h2 { margin: 0 0 10px; font-size: 18px; }
h2 span { color: #6b7280; font-size: 13px; font-weight: normal; }
.scale { display: flex; justify-content: space-between; font-size: 12px; color: #6b7280; }
.track { position: relative; height: 34px; border-radius: 6px; background: linear-gradient(90deg, #edf2f7, #f8fafc); border: 1px solid #e5e7eb; margin: 4px 0 12px; }
.point { position: absolute; top: 8px; width: 14px; height: 14px; margin-left: -7px; border-radius: 50%; border: 2px solid white; background: #2563eb; box-shadow: 0 1px 5px rgba(0,0,0,.25); }
.point.breakdown, .point.fake_breakout, .point.rejection { background: #dc2626; }
.point.level_touch, .point.compression { background: #f59e0b; }
.point.reclaim { background: #16a34a; }
.point.flagged { outline: 3px solid #7c3aed; }
ol { margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.55; }
li span { color: #6b7280; }
li em { color: #7c3aed; font-style: normal; margin-left: 8px; }
</style>
</head>
<body>
<h1>Visual Audit Replay</h1>
<div class="meta">Generated ${escapeHtml(report.generatedAt)} from ${escapeHtml(report.sourceAuditPath)}</div>
<div class="index">${index || "No symbols"}</div>
${rows || "<p>No successful trader-facing posts found.</p>"}
</body>
</html>`;
}

export function writeVisualAuditReplay(params: {
  auditPath: string;
  jsonPath: string;
  htmlPath: string;
}): VisualAuditReplayReport {
  const report = buildVisualAuditReplayReport(params.auditPath);
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(params.htmlPath, formatVisualAuditReplayHtml(report));
  return report;
}
