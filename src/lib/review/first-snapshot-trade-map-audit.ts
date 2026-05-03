import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  scoreFirstPostTradeMapText,
  type FirstPostScoreLabel,
  type FirstPostTradeMapScore,
} from "./session-behavior-audit.js";

type AuditRow = {
  operation?: string;
  status?: string;
  timestamp?: number;
  sourceTimestamp?: number;
  symbol?: string;
  title?: string;
  body?: string;
  bodyPreview?: string;
};

export type FirstSnapshotTradeMapAuditSymbol = {
  symbol: string;
  title?: string;
  timestamp: number | null;
  timestampIso: string | null;
  operation?: string;
  score: FirstPostTradeMapScore;
  suggestedImprovements: string[];
};

export type FirstSnapshotTradeMapAuditReport = {
  generatedAt: string;
  sourceAuditPath: string;
  sourceAuditPaths: string[];
  totals: {
    symbols: number;
    strong: number;
    usable: number;
    weak: number;
    missing: number;
    averageScore: number;
  };
  symbols: FirstSnapshotTradeMapAuditSymbol[];
};

export type GenerateFirstSnapshotTradeMapAuditOptions = {
  auditPath: string;
};

export type WriteFirstSnapshotTradeMapAuditOptions = GenerateFirstSnapshotTradeMapAuditOptions & {
  jsonPath: string;
  markdownPath: string;
};

function resolveAuditPaths(pathOrDirectory: string): string[] {
  const path = resolve(pathOrDirectory);
  if (path.endsWith(".jsonl")) {
    return [path];
  }
  const direct = join(path, "discord-delivery-audit.jsonl");
  if (existsSync(direct)) {
    return [direct];
  }
  if (!existsSync(path)) {
    return [direct];
  }
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name, "discord-delivery-audit.jsonl"))
    .filter((candidate) => existsSync(candidate))
    .sort();
}

function readRows(path: string): AuditRow[] {
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

function rowTimestamp(row: AuditRow): number | null {
  const timestamp = row.sourceTimestamp ?? row.timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : null;
}

function symbolOf(row: AuditRow): string | null {
  const symbol = row.symbol?.trim().toUpperCase();
  return symbol ? symbol : null;
}

function isPosted(row: AuditRow): boolean {
  return (
    (row.status === "posted" || row.status === "success") &&
    ["post_level_snapshot", "post_alert", "post_level_extension"].includes(String(row.operation)) &&
    symbolOf(row) !== null
  );
}

function text(row: AuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function firstSnapshotRow(rows: AuditRow[]): AuditRow | null {
  return rows.find((row) => row.operation === "post_level_snapshot") ?? rows[0] ?? null;
}

function improvementsFor(score: FirstPostTradeMapScore): string[] {
  const improvements = score.issues.map((issue) => issue.replace(/^missing:\s*/i, "add "));
  if (score.label === "strong" && improvements.length === 0) {
    improvements.push("keep this as a reference-quality first snapshot");
  }
  return improvements;
}

function labelCount(symbols: FirstSnapshotTradeMapAuditSymbol[], label: FirstPostScoreLabel): number {
  return symbols.filter((symbol) => symbol.score.label === label).length;
}

export function generateFirstSnapshotTradeMapAudit(
  options: GenerateFirstSnapshotTradeMapAuditOptions,
): FirstSnapshotTradeMapAuditReport {
  const sourceAuditPaths = resolveAuditPaths(options.auditPath);
  const rows = sourceAuditPaths.flatMap((path) => readRows(path)).filter(isPosted);
  const bySymbol = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const symbol = symbolOf(row);
    if (!symbol) {
      continue;
    }
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), row]);
  }

  const symbols: FirstSnapshotTradeMapAuditSymbol[] = [...bySymbol.entries()].map(([symbol, symbolRows]) => {
    const sortedRows = [...symbolRows].sort((left, right) => (rowTimestamp(left) ?? 0) - (rowTimestamp(right) ?? 0));
    const first = firstSnapshotRow(sortedRows);
    const timestamp = first ? rowTimestamp(first) : null;
    const score = first
      ? scoreFirstPostTradeMapText({
          title: first.title,
          body: text(first),
          timestamp,
        })
      : scoreFirstPostTradeMapText(null);
    return {
      symbol,
      title: first?.title,
      timestamp,
      timestampIso: timestamp === null ? null : new Date(timestamp).toISOString(),
      operation: first?.operation,
      score,
      suggestedImprovements: improvementsFor(score),
    };
  }).sort((left, right) => left.score.score - right.score.score || left.symbol.localeCompare(right.symbol));

  const scored = symbols.filter((symbol) => symbol.score.label !== "missing");
  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: sourceAuditPaths.length === 1
      ? sourceAuditPaths[0]!
      : `${sourceAuditPaths.length} audit files from ${resolve(options.auditPath)}`,
    sourceAuditPaths,
    totals: {
      symbols: symbols.length,
      strong: labelCount(symbols, "strong"),
      usable: labelCount(symbols, "usable"),
      weak: labelCount(symbols, "weak"),
      missing: labelCount(symbols, "missing"),
      averageScore:
        scored.length > 0
          ? Number((scored.reduce((sum, symbol) => sum + symbol.score.score, 0) / scored.length).toFixed(1))
          : 0,
    },
    symbols,
  };
}

export function formatFirstSnapshotTradeMapAudit(report: FirstSnapshotTradeMapAuditReport): string {
  const lines = [
    "# First Snapshot Trade Map Audit",
    "",
    `Generated: ${report.generatedAt}`,
    `Source audit: ${report.sourceAuditPath}`,
    `Source audit files: ${report.sourceAuditPaths.length}`,
    "",
    "## Totals",
    "",
    `- symbols: ${report.totals.symbols}`,
    `- strong: ${report.totals.strong}`,
    `- usable: ${report.totals.usable}`,
    `- weak: ${report.totals.weak}`,
    `- missing: ${report.totals.missing}`,
    `- average score: ${report.totals.averageScore}/100`,
    "",
    "## Symbols Needing Review",
    "",
  ];

  const reviewSymbols = report.symbols.filter((symbol) => symbol.score.label !== "strong").slice(0, 80);
  if (reviewSymbols.length === 0) {
    lines.push("- none; first snapshots all scored strong", "");
  } else {
    for (const symbol of reviewSymbols) {
      lines.push(
        `### ${symbol.symbol} - ${symbol.score.label} (${symbol.score.score}/100)`,
        "",
        `- title: ${symbol.title ?? "n/a"}`,
        `- timestamp: ${symbol.timestampIso ?? "n/a"}`,
        `- operation: ${symbol.operation ?? "n/a"}`,
        `- strengths: ${symbol.score.strengths.join("; ") || "none"}`,
        `- issues: ${symbol.score.issues.join("; ") || "none"}`,
        `- suggested improvements: ${symbol.suggestedImprovements.join("; ") || "none"}`,
        symbol.score.excerpt ? `- excerpt: ${symbol.score.excerpt}` : "- excerpt: n/a",
        "",
      );
    }
  }

  lines.push("## Strong Examples", "");
  for (const symbol of report.symbols.filter((item) => item.score.label === "strong").slice(0, 20)) {
    lines.push(`- ${symbol.symbol}: ${symbol.title ?? "snapshot"} (${symbol.score.score}/100)`);
  }

  return `${lines.join("\n")}\n`;
}

export function writeFirstSnapshotTradeMapAudit(
  options: WriteFirstSnapshotTradeMapAuditOptions,
): FirstSnapshotTradeMapAuditReport {
  const report = generateFirstSnapshotTradeMapAudit(options);
  mkdirSync(dirname(resolve(options.jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(options.markdownPath, formatFirstSnapshotTradeMapAudit(report), "utf8");
  return report;
}
