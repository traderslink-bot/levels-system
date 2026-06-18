import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

type SnapshotAuditZone = {
  id?: string;
  side?: "support" | "resistance";
  representativePrice?: number;
  zoneLow?: number;
  zoneHigh?: number;
  strengthLabel?: string;
  sourceLabel?: string;
  displayed?: boolean;
};

type SnapshotAudit = {
  referencePrice?: number;
  supportCandidates?: SnapshotAuditZone[];
  resistanceCandidates?: SnapshotAuditZone[];
};

type AuditRow = {
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
  severity?: string;
  confidence?: string;
  score?: number;
  nextBarrierSide?: "support" | "resistance";
  nextBarrierDistancePct?: number;
  clearanceLabel?: string;
  barrierClutterLabel?: string;
  pathQualityLabel?: string;
  tacticalRead?: string;
  exhaustionLabel?: string;
  setupStateLabel?: string;
  practicalStructureState?: string;
  formalStructureTraderLine?: string;
  selectedFormalStructureTraderLine?: string;
  snapshotAudit?: SnapshotAudit;
};

export type TradePlanReviewNote = {
  itemId: string;
  symbol: string;
  verdict: "unreviewed" | "useful" | "needs_work" | "ignore";
  notes: string;
  tags: string[];
  updatedAt: string;
};

export type TradePlanReviewItem = {
  id: string;
  symbol: string;
  timestamp: number;
  title: string;
  messageKind: string;
  eventType: string | null;
  currentPrice: number | null;
  originalPost: string;
  derivedPlan: {
    buyZone: string | null;
    breakZone: string | null;
    supportThatMustHold: string | null;
    failureZone: string | null;
    firstTarget: string | null;
    caution: string | null;
    structure: string | null;
  };
  levels: {
    nearestSupport: TradePlanZone | null;
    nearestResistance: TradePlanZone | null;
    displayedSupports: TradePlanZone[];
    displayedResistances: TradePlanZone[];
  };
  context: string[];
  note: TradePlanReviewNote | null;
};

export type TradePlanZone = {
  label: string;
  low: number;
  high: number;
  representative: number;
  distancePct: number | null;
  strengthLabel: string | null;
  sourceLabel: string | null;
};

export type TradePlanReviewPayload = {
  sessionDirectory: string | null;
  auditPath: string | null;
  notesPath: string | null;
  generatedAt: string;
  totals: {
    posts: number;
    symbols: number;
    reviewed: number;
  };
  items: TradePlanReviewItem[];
};

function readJsonLines(path: string): AuditRow[] {
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

function postedTraderRow(row: AuditRow): boolean {
  if (row.status !== "posted" && row.status !== "success") {
    return false;
  }
  if (!["post_alert", "post_level_snapshot", "post_level_extension"].includes(String(row.operation))) {
    return false;
  }
  return row.messageKind !== "stock_context";
}

function normalizeSymbol(row: AuditRow): string {
  return row.symbol?.trim().toUpperCase() || "UNKNOWN";
}

function rowText(row: AuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join("\n").trim();
}

function itemId(row: AuditRow): string {
  return [
    row.timestamp ?? 0,
    normalizeSymbol(row),
    row.operation ?? "post",
    row.messageKind ?? "unknown",
    row.eventType ?? "snapshot",
  ].join(":");
}

function reviewMessageKind(row: AuditRow): string {
  if (row.messageKind) {
    return row.messageKind;
  }
  if (row.operation === "post_level_snapshot") {
    return "level_snapshot";
  }
  if (row.operation === "post_level_extension") {
    return "level_extension";
  }
  return row.operation ?? "unknown";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function parsePrice(row: AuditRow): number | null {
  const direct =
    finiteNumber(row.snapshotAudit?.referencePrice) ??
    finiteNumber(row.triggerPrice) ??
    finiteNumber(row.targetPrice);
  if (direct !== null) {
    return direct;
  }

  const match = rowText(row).match(/\b(?:Price|Triggered near|Current price):\s*(\d+(?:\.\d+)?)/i);
  return match?.[1] ? finiteNumber(Number(match[1])) : null;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractLine(body: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`${escaped}:\\s*([^\\n]+)`, "i"));
  return match?.[1] ? compactWhitespace(match[1]) : null;
}

function extractBulletValue(body: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`(?:^|\\n)\\s*-\\s*${escaped}:\\s*([^\\n]+)`, "i"));
  return match?.[1] ? compactWhitespace(match[1]) : null;
}

function extractSectionFirstBullet(body: string, section: string): string | null {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`${escaped}:\\s*\\n\\s*-\\s*([^\\n]+)`, "i"));
  return match?.[1] ? compactWhitespace(match[1]) : null;
}

function formatPrice(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function distancePct(price: number | null, level: number): number | null {
  if (price === null || price <= 0) {
    return null;
  }
  return Number((((level - price) / price) * 100).toFixed(2));
}

function zoneLabel(zone: TradePlanZone): string {
  const priceLabel =
    Math.abs(zone.high - zone.low) > Math.max(zone.representative * 0.001, 0.0001)
      ? `${formatPrice(zone.low)}-${formatPrice(zone.high)}`
      : formatPrice(zone.representative);
  const distanceLabel = zone.distancePct === null ? "" : ` (${zone.distancePct > 0 ? "+" : ""}${zone.distancePct.toFixed(1)}%)`;
  const quality = [zone.strengthLabel, zone.sourceLabel].filter(Boolean).join(", ");
  return `${priceLabel}${distanceLabel}${quality ? `, ${quality}` : ""}`;
}

function toTradePlanZone(zone: SnapshotAuditZone, price: number | null): TradePlanZone | null {
  const representative = finiteNumber(zone.representativePrice);
  const low = finiteNumber(zone.zoneLow) ?? representative;
  const high = finiteNumber(zone.zoneHigh) ?? representative;
  if (representative === null || low === null || high === null) {
    return null;
  }

  const normalizedLow = Math.min(low, high);
  const normalizedHigh = Math.max(low, high);
  const tradeZone: TradePlanZone = {
    label: "",
    low: normalizedLow,
    high: normalizedHigh,
    representative,
    distancePct: distancePct(price, representative),
    strengthLabel: zone.strengthLabel ?? null,
    sourceLabel: zone.sourceLabel ?? null,
  };
  tradeZone.label = zoneLabel(tradeZone);
  return tradeZone;
}

function displayedZones(
  zones: SnapshotAuditZone[] | undefined,
  side: "support" | "resistance",
  price: number | null,
): TradePlanZone[] {
  return (zones ?? [])
    .filter((zone) => zone.side === side && zone.displayed !== false)
    .map((zone) => toTradePlanZone(zone, price))
    .filter((zone): zone is TradePlanZone => zone !== null)
    .sort((left, right) =>
      side === "support"
        ? right.representative - left.representative
        : left.representative - right.representative,
    );
}

function nearestSupport(zones: TradePlanZone[], price: number | null): TradePlanZone | null {
  if (price === null) {
    return zones[0] ?? null;
  }
  return zones.find((zone) => zone.representative <= price * 1.002) ?? zones[0] ?? null;
}

function nearestResistance(zones: TradePlanZone[], price: number | null): TradePlanZone | null {
  if (price === null) {
    return zones[0] ?? null;
  }
  return zones.find((zone) => zone.representative >= price * 0.998) ?? zones[0] ?? null;
}

function deriveCaution(row: AuditRow): string | null {
  const parts = [
    row.pathQualityLabel ? `path is ${row.pathQualityLabel}` : null,
    row.barrierClutterLabel ? `barriers are ${row.barrierClutterLabel}` : null,
    row.exhaustionLabel ? `level is ${row.exhaustionLabel}` : null,
    row.tacticalRead ? `zone read is ${row.tacticalRead}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join("; ") : null;
}

function derivePlan(row: AuditRow, price: number | null, supports: TradePlanZone[], resistances: TradePlanZone[]): TradePlanReviewItem["derivedPlan"] {
  const body = row.body ?? "";
  const support = nearestSupport(supports, price);
  const resistance = nearestResistance(resistances, price);
  const testingSupport =
    extractBulletValue(body, "Testing support") ??
    extractBulletValue(body, "Support") ??
    extractBulletValue(body, "Hold area");
  const testingResistance =
    extractBulletValue(body, "Testing resistance") ??
    extractBulletValue(body, "Resistance") ??
    extractBulletValue(body, "Breakout level");
  const reclaimArea =
    extractBulletValue(body, "Nearby reclaim area") ??
    extractBulletValue(body, "Reclaim area") ??
    extractLine(body, "Nearby reclaim area");
  const nearbySupport = extractBulletValue(body, "Nearby support");
  const resistanceMap = extractBulletValue(body, "Resistance map") ?? extractLine(body, "Resistance map");
  const supportMap = extractBulletValue(body, "Support map") ?? extractLine(body, "Support map");
  const supportLine =
    extractLine(body, "Support that matters") ??
    extractLine(body, "Main support") ??
    testingSupport ??
    nearbySupport;
  const breakLine =
    extractLine(body, "Cleaner above") ??
    extractLine(body, "Main resistance") ??
    reclaimArea ??
    resistanceMap ??
    testingResistance;
  const broaderSupport =
    extractLine(body, "Broader support") ??
    extractBulletValue(body, "Invalidation") ??
    extractSectionFirstBullet(body, "Hold / failure map") ??
    supportMap;
  const firstTarget =
    extractLine(body, "Nearby reclaim area") ??
    reclaimArea ??
    extractLine(body, "Resistance map") ??
    resistanceMap ??
    supportMap ??
    (row.nextBarrierSide ? `${row.nextBarrierSide} ${row.nextBarrierDistancePct?.toFixed(1) ?? ""}% away`.trim() : null);
  const structure =
    extractLine(body, "Current structure") ??
    row.selectedFormalStructureTraderLine ??
    row.formalStructureTraderLine ??
    null;

  return {
    buyZone: supportLine ?? (support ? `candidate support area near ${support.label}` : null),
    breakZone: breakLine ?? (resistance ? `acceptance above ${resistance.label}` : null),
    supportThatMustHold: supportLine ?? (support ? support.label : null),
    failureZone: broaderSupport ?? (support ? `clean loss below ${support.label}` : null),
    firstTarget,
    caution: deriveCaution(row),
    structure,
  };
}

function loadNotes(notesPath: string | null): Map<string, TradePlanReviewNote> {
  const notes = new Map<string, TradePlanReviewNote>();
  if (!notesPath || !existsSync(notesPath)) {
    return notes;
  }

  for (const line of readFileSync(notesPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const note = JSON.parse(line) as TradePlanReviewNote;
      if (typeof note.itemId === "string") {
        notes.set(note.itemId, note);
      }
    } catch {
      continue;
    }
  }
  return notes;
}

export function resolveTradePlanReviewPaths(sessionDirectory: string | null): {
  auditPath: string | null;
  notesPath: string | null;
} {
  if (!sessionDirectory) {
    return { auditPath: null, notesPath: null };
  }
  return {
    auditPath: join(sessionDirectory, "discord-delivery-audit.jsonl"),
    notesPath: join(sessionDirectory, "trade-plan-review-notes.jsonl"),
  };
}

export function buildTradePlanReviewPayload(sessionDirectory: string | null): TradePlanReviewPayload {
  const { auditPath, notesPath } = resolveTradePlanReviewPaths(sessionDirectory);
  if (!auditPath || !existsSync(auditPath)) {
    return {
      sessionDirectory,
      auditPath,
      notesPath,
      generatedAt: new Date().toISOString(),
      totals: { posts: 0, symbols: 0, reviewed: 0 },
      items: [],
    };
  }

  const notes = loadNotes(notesPath);
  const items = readJsonLines(auditPath)
    .filter(postedTraderRow)
    .map((row): TradePlanReviewItem => {
      const currentPrice = parsePrice(row);
      const displayedSupports = displayedZones(row.snapshotAudit?.supportCandidates, "support", currentPrice);
      const displayedResistances = displayedZones(row.snapshotAudit?.resistanceCandidates, "resistance", currentPrice);
      const id = itemId(row);
      const note = notes.get(id) ?? null;
      const context = [
        row.severity ? `severity: ${row.severity}` : null,
        row.confidence ? `confidence: ${row.confidence}` : null,
        typeof row.score === "number" ? `score: ${row.score.toFixed(1)}` : null,
        row.eventType ? `event: ${row.eventType}` : null,
        row.practicalStructureState ? `state: ${row.practicalStructureState}` : null,
        row.clearanceLabel ? `room: ${row.clearanceLabel}` : null,
      ].filter((value): value is string => value !== null);

      return {
        id,
        symbol: normalizeSymbol(row),
        timestamp: row.timestamp ?? 0,
        title: row.title?.trim() || `${normalizeSymbol(row)} post`,
        messageKind: reviewMessageKind(row),
        eventType: row.eventType ?? null,
        currentPrice,
        originalPost: rowText(row),
        derivedPlan: derivePlan(row, currentPrice, displayedSupports, displayedResistances),
        levels: {
          nearestSupport: nearestSupport(displayedSupports, currentPrice),
          nearestResistance: nearestResistance(displayedResistances, currentPrice),
          displayedSupports: displayedSupports.slice(0, 8),
          displayedResistances: displayedResistances.slice(0, 8),
        },
        context,
        note,
      };
    })
    .sort((left, right) => right.timestamp - left.timestamp);

  return {
    sessionDirectory,
    auditPath,
    notesPath,
    generatedAt: new Date().toISOString(),
    totals: {
      posts: items.length,
      symbols: new Set(items.map((item) => item.symbol)).size,
      reviewed: items.filter((item) => item.note !== null && item.note.verdict !== "unreviewed").length,
    },
    items,
  };
}

export function appendTradePlanReviewNote(
  sessionDirectory: string | null,
  note: Omit<TradePlanReviewNote, "updatedAt">,
): TradePlanReviewNote {
  const { notesPath } = resolveTradePlanReviewPaths(sessionDirectory);
  if (!notesPath) {
    throw new Error("Session directory is not configured; notes cannot be saved yet.");
  }

  const normalized: TradePlanReviewNote = {
    itemId: note.itemId,
    symbol: note.symbol.trim().toUpperCase(),
    verdict: note.verdict,
    notes: note.notes.trim(),
    tags: note.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
    updatedAt: new Date().toISOString(),
  };

  mkdirSync(dirname(notesPath), { recursive: true });
  appendFileSync(notesPath, `${JSON.stringify(normalized)}\n`);
  return normalized;
}
