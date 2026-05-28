import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type AuditRow = {
  type?: string;
  operation?: string;
  status?: string;
  timestamp?: number;
  symbol?: string;
  title?: string;
  messageKind?: string;
  eventType?: string;
  whyPosted?: string;
  postBudgetSymbolType?: string;
  noLevelReason?: string;
};

export type PostReasonAuditReport = {
  generatedAt: string;
  sourceAuditPath: string;
  totals: {
    postedRows: number;
    rowsWithWhyPosted: number;
    rowsWithoutWhyPosted: number;
    rowsWithNoLevelReason: number;
  };
  reasons: Array<{
    reason: string;
    count: number;
    symbols: string[];
    messageKinds: Record<string, number>;
  }>;
  symbols: Array<{
    symbol: string;
    postedRows: number;
    rowsWithWhyPosted: number;
    rowsWithNoLevelReason: number;
    postBudgetSymbolTypes: Record<string, number>;
    topReasons: Array<{ reason: string; count: number }>;
  }>;
  noLevelExamples: Array<{
    symbol: string;
    timestamp: number;
    title?: string;
    noLevelReason: string;
  }>;
  missingWhyPostedExamples: Array<{
    symbol: string;
    timestamp: number;
    title?: string;
    messageKind?: string;
  }>;
};

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

function increment(table: Record<string, number>, key: string): void {
  table[key] = (table[key] ?? 0) + 1;
}

function symbolOf(row: AuditRow): string {
  return row.symbol?.trim().toUpperCase() || "UNKNOWN";
}

function postedRows(rows: AuditRow[]): AuditRow[] {
  return rows.filter(
    (row) =>
      row.type === "discord_delivery_audit" &&
      row.status === "posted" &&
      ["post_alert", "post_level_snapshot", "post_level_extension"].includes(String(row.operation)),
  );
}

export function buildPostReasonAuditReportFromRows(
  rows: AuditRow[],
  sourceAuditPath: string,
): PostReasonAuditReport {
  const posted = postedRows(rows);
  const reasonBuckets = new Map<string, { count: number; symbols: Set<string>; messageKinds: Record<string, number> }>();
  const symbolBuckets = new Map<string, {
    postedRows: number;
    rowsWithWhyPosted: number;
    rowsWithNoLevelReason: number;
    postBudgetSymbolTypes: Record<string, number>;
    reasons: Record<string, number>;
  }>();
  const noLevelExamples: PostReasonAuditReport["noLevelExamples"] = [];
  const missingWhyPostedExamples: PostReasonAuditReport["missingWhyPostedExamples"] = [];

  for (const row of posted) {
    const symbol = symbolOf(row);
    const symbolBucket = symbolBuckets.get(symbol) ?? {
      postedRows: 0,
      rowsWithWhyPosted: 0,
      rowsWithNoLevelReason: 0,
      postBudgetSymbolTypes: {},
      reasons: {},
    };
    symbolBucket.postedRows += 1;
    if (row.postBudgetSymbolType) {
      increment(symbolBucket.postBudgetSymbolTypes, row.postBudgetSymbolType);
    }

    if (row.whyPosted) {
      symbolBucket.rowsWithWhyPosted += 1;
      increment(symbolBucket.reasons, row.whyPosted);
      const reasonBucket = reasonBuckets.get(row.whyPosted) ?? {
        count: 0,
        symbols: new Set<string>(),
        messageKinds: {},
      };
      reasonBucket.count += 1;
      reasonBucket.symbols.add(symbol);
      increment(reasonBucket.messageKinds, row.messageKind ?? row.operation ?? "unknown");
      reasonBuckets.set(row.whyPosted, reasonBucket);
    } else {
      missingWhyPostedExamples.push({
        symbol,
        timestamp: row.timestamp ?? 0,
        title: row.title,
        messageKind: row.messageKind,
      });
    }

    if (row.noLevelReason) {
      symbolBucket.rowsWithNoLevelReason += 1;
      noLevelExamples.push({
        symbol,
        timestamp: row.timestamp ?? 0,
        title: row.title,
        noLevelReason: row.noLevelReason,
      });
    }

    symbolBuckets.set(symbol, symbolBucket);
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath,
    totals: {
      postedRows: posted.length,
      rowsWithWhyPosted: posted.filter((row) => Boolean(row.whyPosted)).length,
      rowsWithoutWhyPosted: posted.filter((row) => !row.whyPosted).length,
      rowsWithNoLevelReason: posted.filter((row) => Boolean(row.noLevelReason)).length,
    },
    reasons: [...reasonBuckets.entries()]
      .map(([reason, bucket]) => ({
        reason,
        count: bucket.count,
        symbols: [...bucket.symbols].sort(),
        messageKinds: bucket.messageKinds,
      }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
    symbols: [...symbolBuckets.entries()]
      .map(([symbol, bucket]) => ({
        symbol,
        postedRows: bucket.postedRows,
        rowsWithWhyPosted: bucket.rowsWithWhyPosted,
        rowsWithNoLevelReason: bucket.rowsWithNoLevelReason,
        postBudgetSymbolTypes: bucket.postBudgetSymbolTypes,
        topReasons: Object.entries(bucket.reasons)
          .map(([reason, count]) => ({ reason, count }))
          .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))
          .slice(0, 5),
      }))
      .sort((left, right) => right.postedRows - left.postedRows || left.symbol.localeCompare(right.symbol)),
    noLevelExamples: noLevelExamples.slice(0, 80),
    missingWhyPostedExamples: missingWhyPostedExamples.slice(0, 80),
  };
}

export function buildPostReasonAuditReport(auditPath: string): PostReasonAuditReport {
  return buildPostReasonAuditReportFromRows(readAuditRows(auditPath), auditPath);
}

export function renderPostReasonAuditMarkdown(report: PostReasonAuditReport): string {
  const lines = [
    "# Post Reason Audit Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Source audit: ${report.sourceAuditPath}`,
    "",
    "## Totals",
    "",
    `- posted rows: ${report.totals.postedRows}`,
    `- rows with whyPosted: ${report.totals.rowsWithWhyPosted}`,
    `- rows without whyPosted: ${report.totals.rowsWithoutWhyPosted}`,
    `- rows with noLevelReason: ${report.totals.rowsWithNoLevelReason}`,
    "",
    "## Top Reasons",
    "",
    "| Reason | Count | Symbols | Message kinds |",
    "| --- | ---: | --- | --- |",
  ];

  for (const reason of report.reasons.slice(0, 30)) {
    const kinds = Object.entries(reason.messageKinds)
      .sort((left, right) => right[1] - left[1])
      .map(([kind, count]) => `${kind}: ${count}`)
      .join(", ");
    lines.push(`| ${reason.reason} | ${reason.count} | ${reason.symbols.slice(0, 12).join(", ")} | ${kinds} |`);
  }

  lines.push("", "## Symbols", "");
  lines.push("| Symbol | Posted | whyPosted rows | noLevel rows | Budget types | Top reasons |");
  lines.push("| --- | ---: | ---: | ---: | --- | --- |");
  for (const symbol of report.symbols.slice(0, 40)) {
    const budgetTypes = Object.entries(symbol.postBudgetSymbolTypes)
      .map(([type, count]) => `${type}: ${count}`)
      .join(", ") || "n/a";
    const reasons = symbol.topReasons.map((reason) => `${reason.reason}: ${reason.count}`).join("; ") || "n/a";
    lines.push(`| ${symbol.symbol} | ${symbol.postedRows} | ${symbol.rowsWithWhyPosted} | ${symbol.rowsWithNoLevelReason} | ${budgetTypes} | ${reasons} |`);
  }

  lines.push("", "## No-Level Examples", "");
  if (report.noLevelExamples.length === 0) {
    lines.push("- none", "");
  } else {
    for (const example of report.noLevelExamples.slice(0, 40)) {
      lines.push(`- ${example.symbol}: ${example.title ?? "untitled"} - ${example.noLevelReason}`);
    }
    lines.push("");
  }

  lines.push("## Missing whyPosted Examples", "");
  if (report.missingWhyPostedExamples.length === 0) {
    lines.push("- none", "");
  } else {
    for (const example of report.missingWhyPostedExamples.slice(0, 40)) {
      lines.push(`- ${example.symbol}: ${example.title ?? "untitled"} (${example.messageKind ?? "unknown"})`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function writePostReasonAuditReport(params: {
  report: PostReasonAuditReport;
  jsonPath: string;
  markdownPath: string;
}): void {
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  mkdirSync(dirname(params.markdownPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(params.report, null, 2)}\n`, "utf8");
  writeFileSync(params.markdownPath, renderPostReasonAuditMarkdown(params.report), "utf8");
}
