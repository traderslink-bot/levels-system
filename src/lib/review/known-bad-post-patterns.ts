import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type AuditRow = {
  type?: string;
  operation?: string;
  status?: string;
  timestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
  messageKind?: string;
  eventType?: string;
};

export type KnownBadPostPatternId =
  | "surfaced_ladder_no_level"
  | "tiny_penny_risk"
  | "generic_balanced_after_pullback"
  | "system_alert_direction"
  | "predictive_next_level"
  | "direct_execution_advice"
  | "dip_buy_label";

export type KnownBadPostPattern = {
  id: KnownBadPostPatternId;
  label: string;
  severity: "blocker" | "major" | "watch";
  matcher: RegExp;
  badExample: string;
  preferred: string;
};

export type KnownBadPostPatternHit = {
  patternId: KnownBadPostPatternId;
  severity: KnownBadPostPattern["severity"];
  symbol: string;
  timestamp: number;
  title?: string;
  messageKind?: string;
  eventType?: string;
  excerpt: string;
};

export type KnownBadPostPatternReport = {
  generatedAt: string;
  sourceAuditPath: string | null;
  checkedRows: number;
  hitCount: number;
  byPattern: Array<{
    patternId: KnownBadPostPatternId;
    label: string;
    severity: KnownBadPostPattern["severity"];
    hits: number;
    preferred: string;
  }>;
  hits: KnownBadPostPatternHit[];
};

export const KNOWN_BAD_POST_PATTERNS: KnownBadPostPattern[] = [
  {
    id: "surfaced_ladder_no_level",
    label: "Missing next level described with system-shaped ladder language",
    severity: "major",
    matcher: /\b(?:surfaced ladder|no higher resistance|no lower support|none currently surfaced)\b/i,
    badExample: "no higher resistance is currently in the surfaced ladder",
    preferred: "higher resistance was not available from this snapshot, with noLevelReason kept in audit metadata",
  },
  {
    id: "tiny_penny_risk",
    label: "Tiny low-priced move framed as a full risk-open event",
    severity: "major",
    matcher: /\b(?:risk stays open toward|risk opens toward)\s+(?:0?\.\d+|1\.\d{1,2})\b/i,
    badExample: "below 1.01, risk stays open toward 1.00",
    preferred: "treat nearby penny levels as one support area and only discuss a clean whole-area failure",
  },
  {
    id: "generic_balanced_after_pullback",
    label: "Loose balanced-pressure phrase after a meaningful pullback",
    severity: "watch",
    matcher: /\b(?:buyers and sellers are still balanced|buying and selling pressure still look balanced)\b/i,
    badExample: "buyers and sellers are still balanced",
    preferred: "say buyers need stabilization, acceptance, or a cleaner reclaim when price has pulled back",
  },
  {
    id: "system_alert_direction",
    label: "Follow-through wording still exposes alert-direction language",
    severity: "major",
    matcher: /\b(?:alert direction|after the alert|setup move)\b/i,
    badExample: "alert direction move: +1.64%",
    preferred: "price change from trigger or price move from trigger",
  },
  {
    id: "predictive_next_level",
    label: "Next-level wording sounds predictive instead of conditional",
    severity: "watch",
    matcher: /\b(?:is moving toward|will go to|is going to|target is)\b/i,
    badExample: "price cleared 3.75 and is moving toward 4.28",
    preferred: "next resistance area is 4.28 if price can hold above the cleared area",
  },
  {
    id: "direct_execution_advice",
    label: "Direct or borderline trade instruction",
    severity: "blocker",
    matcher: /\b(?:buy here|buy now|sell now|sell here|take profit|stop out|best entry|can buy|should add|should trim|should exit|longs should|traders should|wait for)\b/i,
    badExample: "Traders should wait for the best entry",
    preferred: "observational context such as buyers need acceptance or holding support would keep the setup cleaner",
  },
  {
    id: "dip_buy_label",
    label: "Dip-buy label is too advisory for Discord",
    severity: "major",
    matcher: /\b(?:dip-buy|dip buy)\b/i,
    badExample: "possible dip-buy area",
    preferred: "support reaction area",
  },
];

function readAuditRows(auditPath: string): AuditRow[] {
  if (!existsSync(auditPath)) {
    throw new Error(`Discord audit file not found: ${auditPath}`);
  }

  return readFileSync(auditPath, "utf8")
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

function fullText(row: AuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join("\n");
}

function excerpt(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= 360 ? normalized : `${normalized.slice(0, 357)}...`;
}

function symbolOf(row: AuditRow): string {
  return row.symbol?.trim().toUpperCase() || "UNKNOWN";
}

export function evaluateKnownBadPostPatterns(text: string): KnownBadPostPattern[] {
  return KNOWN_BAD_POST_PATTERNS.filter((pattern) => pattern.matcher.test(text));
}

export function buildKnownBadPostPatternReportFromRows(
  rows: AuditRow[],
  sourceAuditPath: string | null = null,
): KnownBadPostPatternReport {
  const postedRows = rows.filter(
    (row) =>
      row.type === "discord_delivery_audit" &&
      row.status === "posted" &&
      ["post_alert", "post_level_snapshot", "post_level_extension"].includes(String(row.operation)),
  );
  const hits: KnownBadPostPatternHit[] = [];

  for (const row of postedRows) {
    const text = fullText(row);
    for (const pattern of evaluateKnownBadPostPatterns(text)) {
      hits.push({
        patternId: pattern.id,
        severity: pattern.severity,
        symbol: symbolOf(row),
        timestamp: row.timestamp ?? 0,
        title: row.title,
        messageKind: row.messageKind,
        eventType: row.eventType,
        excerpt: excerpt(text),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath,
    checkedRows: postedRows.length,
    hitCount: hits.length,
    byPattern: KNOWN_BAD_POST_PATTERNS.map((pattern) => ({
      patternId: pattern.id,
      label: pattern.label,
      severity: pattern.severity,
      hits: hits.filter((hit) => hit.patternId === pattern.id).length,
      preferred: pattern.preferred,
    })),
    hits,
  };
}

export function buildKnownBadPostPatternReport(auditPath: string): KnownBadPostPatternReport {
  return buildKnownBadPostPatternReportFromRows(readAuditRows(auditPath), auditPath);
}

export function renderKnownBadPostPatternMarkdown(report: KnownBadPostPatternReport): string {
  const lines = [
    "# Known Bad Post Pattern Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Source audit: ${report.sourceAuditPath ?? "inline rows"}`,
    "",
    "## Totals",
    "",
    `- checked rows: ${report.checkedRows}`,
    `- pattern hits: ${report.hitCount}`,
    "",
    "## Pattern Summary",
    "",
    "| Pattern | Severity | Hits | Preferred replacement |",
    "| --- | --- | ---: | --- |",
  ];

  for (const pattern of report.byPattern) {
    lines.push(`| ${pattern.label} | ${pattern.severity} | ${pattern.hits} | ${pattern.preferred} |`);
  }

  lines.push("", "## Hits", "");
  if (report.hits.length === 0) {
    lines.push("- none", "");
  } else {
    for (const hit of report.hits.slice(0, 80)) {
      lines.push(
        `- ${hit.severity} / ${hit.patternId} / ${hit.symbol}: ${hit.title ?? "untitled"} - ${hit.excerpt}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function writeKnownBadPostPatternReport(params: {
  report: KnownBadPostPatternReport;
  jsonPath: string;
  markdownPath: string;
}): void {
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  mkdirSync(dirname(params.markdownPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(params.report, null, 2)}\n`, "utf8");
  writeFileSync(params.markdownPath, renderKnownBadPostPatternMarkdown(params.report), "utf8");
}
