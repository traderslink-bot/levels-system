import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  getFreshFormalBosChochMarketStructureStoryKeys,
} from "../monitoring/market-structure-story-memory.js";
import type { RuntimeMarketStructureSnapshot } from "../monitoring/monitoring-types.js";

type AuditRow = {
  type?: string;
  event?: string;
  operation?: string;
  status?: string;
  timestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
  messageKind?: string;
  eventType?: string;
  signalCategory?: string;
  marketStructureStoryVisible?: boolean;
  marketStructureStoryReason?: string;
  marketStructureStoryKeys?: string[];
  marketStructureStorySource?: string;
  marketStructure?: RuntimeMarketStructureSnapshot | null;
  formalStructureTimeframe?: string;
  formalStructureEventType?: string;
  formalStructureEventFreshness?: string;
  formalStructureMaterialChange?: boolean;
  formalStructureKey?: string;
  selectedFormalStructureTimeframe?: string;
  selectedFormalStructureEventType?: string;
  selectedFormalStructureEventFreshness?: string;
  selectedFormalStructureMaterialChange?: boolean;
  selectedFormalStructureKey?: string;
  whyPosted?: string;
  error?: string;
  details?: Record<string, unknown>;
};

export type MarketStructureDeliveryClassification =
  | "standalone_posted"
  | "carried_by_alert"
  | "carried_by_follow_through"
  | "carried_by_snapshot"
  | "metadata_only"
  | "failed_delivery"
  | "expired_unposted"
  | "suppressed"
  | "detected_unclassified";

export type MarketStructureDeliveryEvent = {
  timestamp: number;
  isoTimestamp: string;
  symbol: string;
  classification: MarketStructureDeliveryClassification;
  status: string | null;
  operation: string | null;
  messageKind: string | null;
  title: string | null;
  eventType: string | null;
  signalCategory: string | null;
  storyKeys: string[];
  storyReason: string | null;
  storySource: string | null;
  marketStructureStoryVisible: boolean;
  whyPosted: string | null;
  error: string | null;
  excerpt: string;
};

export type MarketStructureDeliverySymbolSummary = {
  symbol: string;
  detectedFreshBosChoch: number;
  posted: number;
  carriedByAlerts: number;
  carriedByFollowThrough: number;
  standalonePosts: number;
  snapshotCarries: number;
  metadataOnly: number;
  failedDeliveries: number;
  expiredUnposted: number;
  suppressed: number;
  repeatedStoryKeys: Array<{ key: string; count: number }>;
};

export type MarketStructureDeliveryFinding = {
  severity: "review" | "watch" | "info";
  symbol?: string;
  reason: string;
  detail: string;
};

export type MarketStructureDeliveryAuditReport = {
  generatedAt: string;
  sourceAuditPath: string;
  totals: {
    rowsScanned: number;
    structureEvents: number;
    detectedFreshBosChoch: number;
    posted: number;
    carriedByAlerts: number;
    carriedByFollowThrough: number;
    standalonePosts: number;
    snapshotCarries: number;
    metadataOnly: number;
    failedDeliveries: number;
    expiredUnposted: number;
    suppressed: number;
    symbols: number;
    findings: number;
  };
  symbols: MarketStructureDeliverySymbolSummary[];
  events: MarketStructureDeliveryEvent[];
  findings: MarketStructureDeliveryFinding[];
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

function compactExcerpt(row: AuditRow): string {
  const text = row.body ?? row.bodyPreview ?? row.title ?? "";
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function isBosChoch(eventType: string | undefined): boolean {
  return (
    eventType === "bos_bullish" ||
    eventType === "bos_bearish" ||
    eventType === "choch_bullish" ||
    eventType === "choch_bearish"
  );
}

function prefixedFormalKey(params: {
  timeframe?: string;
  key?: string;
  eventType?: string;
}): string | null {
  const timeframe = params.timeframe === "4h" || params.timeframe === "5m" || params.timeframe === "daily"
    ? params.timeframe
    : null;
  if (!timeframe || !params.key || !isBosChoch(params.eventType)) {
    return null;
  }
  return `${timeframe}|formal|${params.key}`;
}

function storyKeysFromRow(row: AuditRow): string[] {
  const explicit = row.marketStructureStoryKeys?.filter(Boolean) ?? [];
  const fromMarketStructure = getFreshFormalBosChochMarketStructureStoryKeys(row.marketStructure);
  const selectedKey =
    row.selectedFormalStructureMaterialChange === true &&
    row.selectedFormalStructureEventFreshness === "fresh"
      ? prefixedFormalKey({
          timeframe: row.selectedFormalStructureTimeframe,
          key: row.selectedFormalStructureKey,
          eventType: row.selectedFormalStructureEventType,
        })
      : null;
  const formalKey =
    row.formalStructureMaterialChange === true &&
    row.formalStructureEventFreshness === "fresh"
      ? prefixedFormalKey({
          timeframe: row.formalStructureTimeframe,
          key: row.formalStructureKey,
          eventType: row.formalStructureEventType,
        })
      : null;
  const lifecycleKey = typeof row.details?.storyKey === "string" ? row.details.storyKey : null;

  return [...new Set([
    ...explicit,
    ...fromMarketStructure,
    selectedKey,
    formalKey,
    lifecycleKey,
  ].filter((value): value is string => Boolean(value)))];
}

function classifyRow(row: AuditRow, storyKeys: string[]): MarketStructureDeliveryClassification | null {
  if (row.type === "manual_watchlist_lifecycle") {
    if (row.event === "market_structure_story_expired") {
      return "expired_unposted";
    }
    if (row.event === "market_structure_post_suppressed") {
      return "suppressed";
    }
    return null;
  }

  if (row.type !== "discord_delivery_audit") {
    return null;
  }

  const hasStructureActivity =
    storyKeys.length > 0 ||
    row.signalCategory === "market_structure" ||
    row.marketStructureStoryVisible === true ||
    row.messageKind === "market_structure_update";
  if (!hasStructureActivity) {
    return null;
  }

  if (row.status === "failed") {
    return "failed_delivery";
  }

  if (row.messageKind === "market_structure_update") {
    return "standalone_posted";
  }

  if (row.operation === "post_level_snapshot") {
    return "carried_by_snapshot";
  }

  if (row.marketStructureStoryVisible !== true) {
    return "metadata_only";
  }

  if (row.messageKind === "follow_through_update" || row.messageKind === "follow_through_state_update") {
    return "carried_by_follow_through";
  }

  if (row.messageKind === "intelligent_alert" || row.messageKind === "level_clear_update") {
    return "carried_by_alert";
  }

  return "detected_unclassified";
}

function isPostedClassification(classification: MarketStructureDeliveryClassification): boolean {
  return (
    classification === "standalone_posted" ||
    classification === "carried_by_alert" ||
    classification === "carried_by_follow_through" ||
    classification === "carried_by_snapshot"
  );
}

function increment(table: Record<string, number>, key: string): void {
  table[key] = (table[key] ?? 0) + 1;
}

function buildEvents(rows: AuditRow[]): MarketStructureDeliveryEvent[] {
  return rows.flatMap((row) => {
    const storyKeys = storyKeysFromRow(row);
    const classification = classifyRow(row, storyKeys);
    if (!classification) {
      return [];
    }

    const timestamp = row.timestamp ?? 0;
    return [{
      timestamp,
      isoTimestamp: isoTimestamp(timestamp),
      symbol: normalizeSymbol(row.symbol),
      classification,
      status: row.status ?? null,
      operation: row.operation ?? null,
      messageKind: row.messageKind ?? null,
      title: row.title ?? null,
      eventType: row.eventType ?? null,
      signalCategory: row.signalCategory ?? null,
      storyKeys,
      storyReason: row.marketStructureStoryReason ?? (typeof row.details?.reason === "string" ? row.details.reason : null),
      storySource: row.marketStructureStorySource ?? (row.type === "manual_watchlist_lifecycle" ? row.event ?? null : null),
      marketStructureStoryVisible: row.marketStructureStoryVisible === true,
      whyPosted: row.whyPosted ?? null,
      error: row.error ?? null,
      excerpt: compactExcerpt(row),
    }];
  }).sort((left, right) => left.timestamp - right.timestamp);
}

function summarizeSymbol(
  symbol: string,
  events: MarketStructureDeliveryEvent[],
): MarketStructureDeliverySymbolSummary {
  const keyCounts: Record<string, number> = {};
  for (const event of events) {
    if (!isPostedClassification(event.classification)) {
      continue;
    }
    for (const key of event.storyKeys) {
      increment(keyCounts, key);
    }
  }

  return {
    symbol,
    detectedFreshBosChoch: events.filter((event) => event.storyKeys.length > 0).length,
    posted: events.filter((event) => isPostedClassification(event.classification)).length,
    carriedByAlerts: events.filter((event) => event.classification === "carried_by_alert").length,
    carriedByFollowThrough: events.filter((event) => event.classification === "carried_by_follow_through").length,
    standalonePosts: events.filter((event) => event.classification === "standalone_posted").length,
    snapshotCarries: events.filter((event) => event.classification === "carried_by_snapshot").length,
    metadataOnly: events.filter((event) => event.classification === "metadata_only").length,
    failedDeliveries: events.filter((event) => event.classification === "failed_delivery").length,
    expiredUnposted: events.filter((event) => event.classification === "expired_unposted").length,
    suppressed: events.filter((event) => event.classification === "suppressed").length,
    repeatedStoryKeys: Object.entries(keyCounts)
      .filter(([, count]) => count > 1)
      .map(([key, count]) => ({ key, count }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key)),
  };
}

function buildFindings(
  summaries: MarketStructureDeliverySymbolSummary[],
): MarketStructureDeliveryFinding[] {
  const findings: MarketStructureDeliveryFinding[] = [];
  for (const summary of summaries) {
    if (summary.failedDeliveries > 0) {
      findings.push({
        severity: "review",
        symbol: summary.symbol,
        reason: "market_structure_delivery_failed",
        detail: `${summary.failedDeliveries} market-structure delivery attempt(s) failed.`,
      });
    }
    if (summary.expiredUnposted > 0) {
      findings.push({
        severity: "watch",
        symbol: summary.symbol,
        reason: "fresh_structure_expired_unposted",
        detail: `${summary.expiredUnposted} fresh structure story/stories expired before a Discord post carried them.`,
      });
    }
    if (summary.metadataOnly > 0) {
      findings.push({
        severity: "watch",
        symbol: summary.symbol,
        reason: "fresh_structure_metadata_only",
        detail: `${summary.metadataOnly} row(s) carried fresh structure metadata without visible structure text.`,
      });
    }
    if (summary.repeatedStoryKeys.length > 0) {
      findings.push({
        severity: "info",
        symbol: summary.symbol,
        reason: "repeated_structure_story_key",
        detail: `${summary.repeatedStoryKeys.length} structure key(s) appeared in more than one posted row.`,
      });
    }
  }
  return findings;
}

export function buildMarketStructureDeliveryAuditReportFromRows(
  rows: AuditRow[],
  sourceAuditPath: string,
): MarketStructureDeliveryAuditReport {
  const events = buildEvents(rows);
  const bySymbol = new Map<string, MarketStructureDeliveryEvent[]>();
  for (const event of events) {
    const bucket = bySymbol.get(event.symbol) ?? [];
    bucket.push(event);
    bySymbol.set(event.symbol, bucket);
  }

  const symbols = [...bySymbol.entries()]
    .map(([symbol, symbolEvents]) => summarizeSymbol(symbol, symbolEvents))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
  const findings = buildFindings(symbols);

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath,
    totals: {
      rowsScanned: rows.length,
      structureEvents: events.length,
      detectedFreshBosChoch: events.filter((event) => event.storyKeys.length > 0).length,
      posted: events.filter((event) => isPostedClassification(event.classification)).length,
      carriedByAlerts: events.filter((event) => event.classification === "carried_by_alert").length,
      carriedByFollowThrough: events.filter((event) => event.classification === "carried_by_follow_through").length,
      standalonePosts: events.filter((event) => event.classification === "standalone_posted").length,
      snapshotCarries: events.filter((event) => event.classification === "carried_by_snapshot").length,
      metadataOnly: events.filter((event) => event.classification === "metadata_only").length,
      failedDeliveries: events.filter((event) => event.classification === "failed_delivery").length,
      expiredUnposted: events.filter((event) => event.classification === "expired_unposted").length,
      suppressed: events.filter((event) => event.classification === "suppressed").length,
      symbols: symbols.length,
      findings: findings.length,
    },
    symbols,
    events,
    findings,
  };
}

export function buildMarketStructureDeliveryAuditReport(
  auditPath: string,
): MarketStructureDeliveryAuditReport {
  return buildMarketStructureDeliveryAuditReportFromRows(readJsonLines(auditPath), auditPath);
}

export function buildMarketStructureDeliveryAuditReportFromPaths(
  auditPaths: string[],
): MarketStructureDeliveryAuditReport {
  const paths = auditPaths.filter((path) => path.trim().length > 0);
  return buildMarketStructureDeliveryAuditReportFromRows(
    paths.flatMap((path) => readJsonLines(path)),
    paths.join(", "),
  );
}

export function formatMarketStructureDeliveryAuditMarkdown(
  report: MarketStructureDeliveryAuditReport,
): string {
  const lines: string[] = [
    "# Market Structure Delivery Audit",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceAuditPath}`,
    "",
    "## Summary",
    "",
    `- Rows scanned: ${report.totals.rowsScanned}`,
    `- Structure events: ${report.totals.structureEvents}`,
    `- Fresh BOS/CHOCH detections represented: ${report.totals.detectedFreshBosChoch}`,
    `- Posted/carried: ${report.totals.posted}`,
    `- Carried by alerts: ${report.totals.carriedByAlerts}`,
    `- Carried by follow-through: ${report.totals.carriedByFollowThrough}`,
    `- Standalone structure posts: ${report.totals.standalonePosts}`,
    `- Snapshot carries: ${report.totals.snapshotCarries}`,
    `- Metadata-only rows: ${report.totals.metadataOnly}`,
    `- Failed deliveries: ${report.totals.failedDeliveries}`,
    `- Expired unposted: ${report.totals.expiredUnposted}`,
    `- Suppressed: ${report.totals.suppressed}`,
  ];

  if (report.findings.length > 0) {
    lines.push("", "## Findings", "");
    for (const finding of report.findings) {
      lines.push(`- ${finding.severity.toUpperCase()} ${finding.symbol ?? "ALL"}: ${finding.reason} - ${finding.detail}`);
    }
  }

  lines.push("", "## Symbols", "");
  if (report.symbols.length === 0) {
    lines.push("- No market-structure delivery rows found.");
  } else {
    for (const symbol of report.symbols) {
      lines.push(
        `- ${symbol.symbol}: detected ${symbol.detectedFreshBosChoch}, posted ${symbol.posted}, standalone ${symbol.standalonePosts}, alert-carried ${symbol.carriedByAlerts}, follow-through-carried ${symbol.carriedByFollowThrough}, expired ${symbol.expiredUnposted}`,
      );
    }
  }

  lines.push("", "## Recent Events", "");
  for (const event of report.events.slice(-40)) {
    lines.push(
      `- ${event.isoTimestamp} ${event.symbol} ${event.classification} ${event.messageKind ?? event.operation ?? ""} keys=${event.storyKeys.length > 0 ? event.storyKeys.join(",") : "none"}${event.title ? ` - ${event.title}` : ""}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function writeMarketStructureDeliveryAuditReport(params: {
  report: MarketStructureDeliveryAuditReport;
  jsonPath: string;
  markdownPath: string;
}): void {
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  mkdirSync(dirname(params.markdownPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(params.report, null, 2)}\n`, "utf8");
  writeFileSync(params.markdownPath, formatMarketStructureDeliveryAuditMarkdown(params.report), "utf8");
}
