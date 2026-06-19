import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { isActionableFormalBosChoch } from "../monitoring/market-structure-story-memory.js";
import type {
  FormalMarketStructureRuntimeContext,
  RuntimeMarketStructureSnapshot,
  RuntimeMarketStructureTimeframeSnapshot,
} from "../monitoring/monitoring-types.js";
import type { FormalStructureTimeframe } from "../structure/index.js";

type AuditRow = {
  type?: string;
  operation?: string;
  status?: string;
  timestamp?: number;
  symbol?: string;
  title?: string;
  messageKind?: string;
  marketStructureStoryVisible?: boolean;
  marketStructureStoryKeys?: string[];
  marketStructure?: RuntimeMarketStructureSnapshot | null;
};

export type FormalMarketStructureGateDecision = "actionable" | "metadata_only";

export type FormalMarketStructureGateEvent = {
  timestamp: number;
  isoTimestamp: string;
  symbol: string;
  title: string | null;
  operation: string | null;
  messageKind: string | null;
  timeframe: FormalStructureTimeframe;
  eventType: FormalMarketStructureRuntimeContext["eventType"];
  confidence: FormalMarketStructureRuntimeContext["confidence"];
  confirmation: FormalMarketStructureRuntimeContext["confirmation"];
  materialChange: boolean;
  stableState: RuntimeMarketStructureTimeframeSnapshot["stable"] extends infer Stable
    ? Stable extends { state: infer State } ? State : string | null
    : string | null;
  stableConfidence: RuntimeMarketStructureTimeframeSnapshot["stable"] extends infer Stable
    ? Stable extends { confidence: infer Confidence } ? Confidence : string | null
    : string | null;
  stableMaterialChange: boolean;
  storyKey: string;
  oldVisible: boolean;
  decision: FormalMarketStructureGateDecision;
  gateReason: string;
};

export type FormalMarketStructureGateSymbolSummary = {
  symbol: string;
  events: number;
  actionable: number;
  metadataOnly: number;
  oldVisible: number;
  newlyQuieted: number;
};

export type FormalMarketStructureGateAuditReport = {
  generatedAt: string;
  sourceAuditPath: string;
  totals: {
    rowsScanned: number;
    formalBosChochEvents: number;
    actionable: number;
    metadataOnly: number;
    oldVisible: number;
    newlyQuieted: number;
    symbols: number;
  };
  symbols: FormalMarketStructureGateSymbolSummary[];
  events: FormalMarketStructureGateEvent[];
};

export type WriteFormalMarketStructureGateAuditOptions = {
  report: FormalMarketStructureGateAuditReport;
  jsonPath: string;
  markdownPath: string;
};

function readJsonLines(path: string): AuditRow[] {
  if (!existsSync(path)) {
    throw new Error(`Audit file not found: ${path}`);
  }

  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AuditRow];
      } catch {
        return [];
      }
    });
}

function normalizeSymbol(symbol: string | undefined): string {
  return symbol?.trim().toUpperCase() || "UNKNOWN";
}

function isoTimestamp(timestamp: number): string {
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : "unknown";
}

function isFormalTimeframe(value: string): value is FormalStructureTimeframe {
  return value === "daily" || value === "4h" || value === "5m";
}

function isFreshBosChoch(formal: FormalMarketStructureRuntimeContext | undefined): formal is FormalMarketStructureRuntimeContext {
  return (
    formal?.materialChange === true &&
    formal.eventFreshness === "fresh" &&
    (
      formal.eventType === "bos_bullish" ||
      formal.eventType === "bos_bearish" ||
      formal.eventType === "choch_bullish" ||
      formal.eventType === "choch_bearish"
    )
  );
}

function formalStoryKey(timeframe: FormalStructureTimeframe, formal: FormalMarketStructureRuntimeContext): string {
  return `${timeframe}|formal|${formal.structureKey}`;
}

function gateReason(params: {
  timeframe: FormalStructureTimeframe;
  formal: FormalMarketStructureRuntimeContext;
  context: RuntimeMarketStructureTimeframeSnapshot;
  actionable: boolean;
}): string {
  if (params.actionable) {
    if (params.timeframe === "daily" || params.timeframe === "4h") {
      return "higher_timeframe_formal";
    }
    return "actionable";
  }

  if (params.formal.confidence === "low") {
    return "low_confidence_formal";
  }
  if (params.timeframe === "5m") {
    return "tactical_5m_without_stable_confirmation";
  }
  return "not_actionable";
}

function extractFreshFormalEvents(row: AuditRow): FormalMarketStructureGateEvent[] {
  if (row.type !== "discord_delivery_audit" || row.status !== "posted") {
    return [];
  }

  const timestamp = row.timestamp ?? 0;
  const symbol = normalizeSymbol(row.symbol);
  const visibleKeys = new Set(row.marketStructureStoryKeys?.filter(Boolean) ?? []);
  const oldVisible = row.marketStructureStoryVisible === true || visibleKeys.size > 0;
  const events: FormalMarketStructureGateEvent[] = [];

  for (const [timeframeRaw, context] of Object.entries(row.marketStructure?.timeframes ?? {})) {
    if (!isFormalTimeframe(timeframeRaw) || !isFreshBosChoch(context.formal)) {
      continue;
    }

    const formal = context.formal;
    const storyKey = formalStoryKey(timeframeRaw, formal);
    const actionable = isActionableFormalBosChoch(timeframeRaw, formal, context);
    events.push({
      timestamp,
      isoTimestamp: isoTimestamp(timestamp),
      symbol,
      title: row.title ?? null,
      operation: row.operation ?? null,
      messageKind: row.messageKind ?? null,
      timeframe: timeframeRaw,
      eventType: formal.eventType,
      confidence: formal.confidence,
      confirmation: formal.confirmation,
      materialChange: formal.materialChange,
      stableState: context.stable?.state ?? null,
      stableConfidence: context.stable?.confidence ?? null,
      stableMaterialChange: context.stable?.materialChange === true,
      storyKey,
      oldVisible: oldVisible || visibleKeys.has(storyKey),
      decision: actionable ? "actionable" : "metadata_only",
      gateReason: gateReason({
        timeframe: timeframeRaw,
        formal,
        context,
        actionable,
      }),
    });
  }

  return events;
}

function buildSymbolSummaries(events: FormalMarketStructureGateEvent[]): FormalMarketStructureGateSymbolSummary[] {
  const bySymbol = new Map<string, FormalMarketStructureGateEvent[]>();
  for (const event of events) {
    bySymbol.set(event.symbol, [...(bySymbol.get(event.symbol) ?? []), event]);
  }

  return [...bySymbol.entries()]
    .map(([symbol, symbolEvents]) => ({
      symbol,
      events: symbolEvents.length,
      actionable: symbolEvents.filter((event) => event.decision === "actionable").length,
      metadataOnly: symbolEvents.filter((event) => event.decision === "metadata_only").length,
      oldVisible: symbolEvents.filter((event) => event.oldVisible).length,
      newlyQuieted: symbolEvents.filter((event) => event.oldVisible && event.decision === "metadata_only").length,
    }))
    .sort((left, right) => right.newlyQuieted - left.newlyQuieted || right.events - left.events || left.symbol.localeCompare(right.symbol));
}

export function buildFormalMarketStructureGateAuditReport(
  auditPath: string,
): FormalMarketStructureGateAuditReport {
  const rows = readJsonLines(auditPath);
  const events = rows.flatMap(extractFreshFormalEvents);
  const actionable = events.filter((event) => event.decision === "actionable").length;
  const metadataOnly = events.length - actionable;
  const oldVisible = events.filter((event) => event.oldVisible).length;
  const newlyQuieted = events.filter((event) => event.oldVisible && event.decision === "metadata_only").length;
  const symbols = buildSymbolSummaries(events);

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    totals: {
      rowsScanned: rows.length,
      formalBosChochEvents: events.length,
      actionable,
      metadataOnly,
      oldVisible,
      newlyQuieted,
      symbols: symbols.length,
    },
    symbols,
    events,
  };
}

export function formatFormalMarketStructureGateAuditMarkdown(report: FormalMarketStructureGateAuditReport): string {
  const lines: string[] = [
    "# Formal Market Structure Gate Audit",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceAuditPath}`,
    "",
    "## Summary",
    "",
    `- rows scanned: ${report.totals.rowsScanned}`,
    `- fresh formal BOS/CHOCH events: ${report.totals.formalBosChochEvents}`,
    `- actionable after gate: ${report.totals.actionable}`,
    `- metadata-only after gate: ${report.totals.metadataOnly}`,
    `- historically visible/carried: ${report.totals.oldVisible}`,
    `- newly quieted by gate: ${report.totals.newlyQuieted}`,
    `- symbols: ${report.totals.symbols}`,
    "",
    "## Symbols",
    "",
  ];

  if (report.symbols.length === 0) {
    lines.push("- No fresh formal BOS/CHOCH events found.", "");
  } else {
    for (const symbol of report.symbols) {
      lines.push(
        `- ${symbol.symbol}: events ${symbol.events}, actionable ${symbol.actionable}, metadata-only ${symbol.metadataOnly}, newly quieted ${symbol.newlyQuieted}`,
      );
    }
    lines.push("");
  }

  lines.push("## Events", "");
  for (const event of report.events.slice(0, 80)) {
    lines.push(
      `- ${event.isoTimestamp} ${event.symbol} ${event.timeframe} ${event.eventType} ${event.confidence}: ${event.decision} (${event.gateReason}); stable ${event.stableState ?? "n/a"} ${event.stableConfidence ?? "n/a"}; ${event.title ?? "untitled"}`,
    );
  }
  if (report.events.length > 80) {
    lines.push(`- ... ${report.events.length - 80} more event(s) omitted from markdown preview.`);
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

export function writeFormalMarketStructureGateAuditReport(options: WriteFormalMarketStructureGateAuditOptions): void {
  mkdirSync(dirname(options.jsonPath), { recursive: true });
  mkdirSync(dirname(options.markdownPath), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(options.report, null, 2)}\n`);
  writeFileSync(options.markdownPath, formatFormalMarketStructureGateAuditMarkdown(options.report));
}
