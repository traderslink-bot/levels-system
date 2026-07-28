import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type TraderPostQualitySeverity = "blocker" | "major" | "watch" | "historical_only" | "data_quality_only";

export type TraderPostQualityCategory =
  | "system_language"
  | "direct_advice"
  | "overcertain_prediction"
  | "tiny_move_risk_language"
  | "generic_balanced_language"
  | "missing_level_claim"
  | "repeat_overlap"
  | "clean_example";

type DiscordAuditRow = {
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
  targetPrice?: number;
  nextBarrierDistancePct?: number;
  whyPosted?: string;
  postBudgetSymbolType?: string;
  noLevelReason?: string;
  deliveryLagMs?: number;
};

export type TraderPostQualityFinding = {
  symbol: string;
  timestamp: number;
  title?: string;
  messageKind?: string;
  eventType?: string;
  category: TraderPostQualityCategory;
  severity: TraderPostQualitySeverity;
  reason: string;
  excerpt: string;
};

export type TraderPostQualitySymbolSummary = {
  symbol: string;
  posted: number;
  findings: number;
  blocker: number;
  major: number;
  watch: number;
  historicalOnly: number;
  dataQualityOnly: number;
  cleanExamples: number;
  topCategories: Record<TraderPostQualityCategory, number>;
  representativeFindings: TraderPostQualityFinding[];
};

export type TraderPostQualityReport = {
  generatedAt: string;
  sourceAuditPath: string;
  totals: {
    posted: number;
    findings: number;
    blocker: number;
    major: number;
    watch: number;
    historicalOnly: number;
    dataQualityOnly: number;
    cleanExamples: number;
    repeatedStoryClusters: number;
    missingLevelClaims: number;
    tinyMoveRiskWarnings: number;
  };
  perSymbol: TraderPostQualitySymbolSummary[];
  findings: TraderPostQualityFinding[];
  repeatedStoryClusters: Array<{
    symbol: string;
    storyKey: string;
    count: number;
    firstTimestamp: number;
    lastTimestamp: number;
    sampleTitle?: string;
    sampleExcerpt: string;
  }>;
};

const SYSTEM_LANGUAGE =
  /(?:\bStatus:|\bSignal:|\bDecision area\b|\bsetup update\b|\bstate update\b|\bstate recap\b|\bsetup move\b|\balert direction\b|\bafter the alert\b|\bLEVEL SNAPSHOT\b|\blevel map\b|\bmapped\b|\bnot a price target\b|\bdip-buy\b|\bsurfaced ladder\b)/i;

const DIRECT_ADVICE =
  /\b(?:buy here|buy now|sell now|sell here|take profit|stop out|trim here|add here|exit now|short setup|best entry|safe entry|can buy|should add|should trim|should exit|longs should|traders should|wait for)\b/i;

const OVERCERTAIN =
  /\b(?:will go to|is going to|guarantees|confirmed breakout|confirmed breakdown|no longer immediate resistance|no longer immediate support|must hold|must clear)\b/i;

const GENERIC_BALANCED =
  /\b(?:buyers and sellers are still balanced|buying and selling pressure still look balanced)\b/i;

const MISSING_LEVEL_CLAIM =
  /\b(?:no higher resistance|no lower support|Resistance above: none|Support below: none|beyond the surfaced resistance ladder|current ladder)\b/i;

const CLEAN_TRADER_LANGUAGE =
  /\b(?:support|resistance|buyers need|acceptance|reclaim|holds above|holding above|stabiliz(?:e|ation)|range-bound|clean expansion|clean loss|broader support|room above)\b/i;

function readJsonLines(path: string): DiscordAuditRow[] {
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

function fullText(row: DiscordAuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join("\n");
}

function excerpt(row: DiscordAuditRow, maxLength = 420): string {
  const text = fullText(row).replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function symbolOf(row: DiscordAuditRow): string {
  return row.symbol?.trim().toUpperCase() || "UNKNOWN";
}

function normalizeStoryText(row: DiscordAuditRow): string {
  const text = fullText(row)
    .toLowerCase()
    .replace(/\b\d+(?:\.\d+)?%?\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 220);
}

function severityRank(severity: TraderPostQualitySeverity): number {
  switch (severity) {
    case "blocker":
      return 5;
    case "major":
      return 4;
    case "watch":
      return 3;
    case "data_quality_only":
      return 2;
    case "historical_only":
      return 1;
    default:
      return 0;
  }
}

function incrementCategory(table: Record<TraderPostQualityCategory, number>, category: TraderPostQualityCategory): void {
  table[category] = (table[category] ?? 0) + 1;
}

function tinyMoveRiskFinding(row: DiscordAuditRow): TraderPostQualityFinding | null {
  const text = fullText(row);
  const match = text.match(/\b(?:risk stays open toward|risk opens toward|next broader support is|deeper support is)\s+(\d+(?:\.\d+)?)/i);
  const triggerMatch = text.match(/\b(?:below|reclaiming|support|resistance|near)\s+(\d+(?:\.\d+)?)/i);
  if (!match?.[1] || !triggerMatch?.[1]) {
    return null;
  }
  const from = Number(triggerMatch[1]);
  const to = Number(match[1]);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) {
    return null;
  }
  const distancePct = Math.abs(from - to) / Math.max(from, 0.0001);
  const absoluteDistance = Math.abs(from - to);
  if (from < 2 && (distancePct < 0.025 || absoluteDistance < 0.04)) {
    return finding(row, "tiny_move_risk_language", "major", `risk wording is too dramatic for a tiny small-cap move (${absoluteDistance.toFixed(4)}, ${(distancePct * 100).toFixed(1)}%)`);
  }
  return null;
}

function finding(
  row: DiscordAuditRow,
  category: TraderPostQualityCategory,
  severity: TraderPostQualitySeverity,
  reason: string,
): TraderPostQualityFinding {
  return {
    symbol: symbolOf(row),
    timestamp: row.timestamp ?? 0,
    title: row.title,
    messageKind: row.messageKind,
    eventType: row.eventType,
    category,
    severity,
    reason,
    excerpt: excerpt(row),
  };
}

function gradeRow(row: DiscordAuditRow): TraderPostQualityFinding[] {
  const text = fullText(row);
  const findings: TraderPostQualityFinding[] = [];

  if (DIRECT_ADVICE.test(text)) {
    findings.push(finding(row, "direct_advice", "blocker", "Discord-visible post contains direct or borderline trade instruction"));
  }
  if (SYSTEM_LANGUAGE.test(text)) {
    findings.push(finding(row, "system_language", "major", "Discord-visible post contains system/operator-shaped language"));
  }
  if (OVERCERTAIN.test(text)) {
    findings.push(finding(row, "overcertain_prediction", "major", "wording sounds too certain for an observational trader note"));
  }
  if (GENERIC_BALANCED.test(text)) {
    findings.push(finding(row, "generic_balanced_language", "watch", "generic balanced-pressure wording may be loose after sharp small-cap moves"));
  }
  if (MISSING_LEVEL_CLAIM.test(text)) {
    findings.push(finding(row, "missing_level_claim", "watch", "post claims no nearby level; audit must verify the candle-backed ladder"));
  }
  if (row.noLevelReason) {
    findings.push(
      finding(
        row,
        "missing_level_claim",
        "data_quality_only",
        `operator audit metadata says a level was unavailable: ${row.noLevelReason}`,
      ),
    );
  }

  const tinyRisk = tinyMoveRiskFinding(row);
  if (tinyRisk) {
    findings.push(tinyRisk);
  }

  if (findings.length === 0 && CLEAN_TRADER_LANGUAGE.test(text)) {
    findings.push(finding(row, "clean_example", "historical_only", "clean representative trader-facing wording"));
  }

  return findings;
}

function postedRows(rows: DiscordAuditRow[]): DiscordAuditRow[] {
  return rows.filter((row) =>
    row.type === "discord_delivery_audit" &&
    row.status === "posted" &&
    fullText(row).trim().length > 0 &&
    (
      row.operation === "post_alert" ||
      row.operation === "post_level_snapshot" ||
      row.operation === "post_level_extension"
    )
  );
}

function buildRepeatedStoryClusters(rows: DiscordAuditRow[]): TraderPostQualityReport["repeatedStoryClusters"] {
  const grouped = new Map<string, DiscordAuditRow[]>();
  for (const row of rows) {
    const key = `${symbolOf(row)}:${row.messageKind ?? row.operation ?? "unknown"}:${normalizeStoryText(row)}`;
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .flatMap(([key, cluster]) => {
      if (cluster.length < 3) {
        return [];
      }
      const sorted = [...cluster].sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
      const first = sorted[0];
      const last = sorted.at(-1);
      if (!first || !last) {
        return [];
      }
      return [{
        symbol: symbolOf(first),
        storyKey: key,
        count: sorted.length,
        firstTimestamp: first.timestamp ?? 0,
        lastTimestamp: last.timestamp ?? 0,
        sampleTitle: first.title,
        sampleExcerpt: excerpt(first),
      }];
    })
    .sort((left, right) => right.count - left.count || left.symbol.localeCompare(right.symbol));
}

export function buildTraderPostQualityReport(auditPath: string): TraderPostQualityReport {
  const rows = postedRows(readJsonLines(auditPath));
  const findings = rows.flatMap(gradeRow);
  const repeatedStoryClusters = buildRepeatedStoryClusters(rows);

  for (const cluster of repeatedStoryClusters.slice(0, 50)) {
    findings.push({
      symbol: cluster.symbol,
      timestamp: cluster.firstTimestamp,
      title: cluster.sampleTitle,
      category: "repeat_overlap",
      severity: "watch",
      reason: `same normalized story appeared ${cluster.count} times`,
      excerpt: cluster.sampleExcerpt,
    });
  }

  const bySymbol = new Map<string, TraderPostQualitySymbolSummary>();
  for (const row of rows) {
    const symbol = symbolOf(row);
    if (!bySymbol.has(symbol)) {
      bySymbol.set(symbol, {
        symbol,
        posted: 0,
        findings: 0,
        blocker: 0,
        major: 0,
        watch: 0,
        historicalOnly: 0,
        dataQualityOnly: 0,
        cleanExamples: 0,
        topCategories: {} as Record<TraderPostQualityCategory, number>,
        representativeFindings: [],
      });
    }
    bySymbol.get(symbol)!.posted += 1;
  }

  const sortedFindings = findings.sort(
    (left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      left.symbol.localeCompare(right.symbol) ||
      left.timestamp - right.timestamp,
  );

  for (const item of sortedFindings) {
    const summary = bySymbol.get(item.symbol) ?? {
      symbol: item.symbol,
      posted: 0,
      findings: 0,
      blocker: 0,
      major: 0,
      watch: 0,
      historicalOnly: 0,
      dataQualityOnly: 0,
      cleanExamples: 0,
      topCategories: {} as Record<TraderPostQualityCategory, number>,
      representativeFindings: [],
    };
    summary.findings += item.category === "clean_example" ? 0 : 1;
    if (item.severity === "blocker") summary.blocker += 1;
    if (item.severity === "major") summary.major += 1;
    if (item.severity === "watch") summary.watch += 1;
    if (item.severity === "historical_only") summary.historicalOnly += 1;
    if (item.severity === "data_quality_only") summary.dataQualityOnly += 1;
    if (item.category === "clean_example") summary.cleanExamples += 1;
    incrementCategory(summary.topCategories, item.category);
    if (item.category !== "clean_example" && summary.representativeFindings.length < 6) {
      summary.representativeFindings.push(item);
    }
    bySymbol.set(item.symbol, summary);
  }

  const perSymbol = [...bySymbol.values()].sort(
    (left, right) =>
      right.blocker - left.blocker ||
      right.major - left.major ||
      right.watch - left.watch ||
      right.findings - left.findings ||
      right.posted - left.posted ||
      left.symbol.localeCompare(right.symbol),
  );

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    totals: {
      posted: rows.length,
      findings: sortedFindings.filter((item) => item.category !== "clean_example").length,
      blocker: sortedFindings.filter((item) => item.severity === "blocker").length,
      major: sortedFindings.filter((item) => item.severity === "major").length,
      watch: sortedFindings.filter((item) => item.severity === "watch").length,
      historicalOnly: sortedFindings.filter((item) => item.severity === "historical_only").length,
      dataQualityOnly: sortedFindings.filter((item) => item.severity === "data_quality_only").length,
      cleanExamples: sortedFindings.filter((item) => item.category === "clean_example").length,
      repeatedStoryClusters: repeatedStoryClusters.length,
      missingLevelClaims: sortedFindings.filter((item) => item.category === "missing_level_claim").length,
      tinyMoveRiskWarnings: sortedFindings.filter((item) => item.category === "tiny_move_risk_language").length,
    },
    perSymbol,
    findings: sortedFindings,
    repeatedStoryClusters,
  };
}

export function renderTraderPostQualityMarkdown(report: TraderPostQualityReport): string {
  const lines = [
    "# Trader Post Quality Grader",
    "",
    `Generated: ${report.generatedAt}`,
    `Source audit: ${report.sourceAuditPath}`,
    "",
    "## Totals",
    "",
    `- posted rows graded: ${report.totals.posted}`,
    `- findings: ${report.totals.findings}`,
    `- blockers: ${report.totals.blocker}`,
    `- major: ${report.totals.major}`,
    `- watch: ${report.totals.watch}`,
    `- repeated-story clusters: ${report.totals.repeatedStoryClusters}`,
    `- missing-level claims: ${report.totals.missingLevelClaims}`,
    `- tiny-move risk warnings: ${report.totals.tinyMoveRiskWarnings}`,
    `- clean examples: ${report.totals.cleanExamples}`,
    "",
    "## Highest-Risk Symbols",
    "",
    "| Symbol | Posted | Findings | Blocker | Major | Watch | Clean examples | Top categories |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const symbol of report.perSymbol.slice(0, 40)) {
    const categories = Object.entries(symbol.topCategories)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([category, count]) => `${category}: ${count}`)
      .join(", ") || "none";
    lines.push(
      `| ${symbol.symbol} | ${symbol.posted} | ${symbol.findings} | ${symbol.blocker} | ${symbol.major} | ${symbol.watch} | ${symbol.cleanExamples} | ${categories} |`,
    );
  }

  lines.push("", "## Findings", "");
  for (const item of report.findings.filter((finding) => finding.category !== "clean_example").slice(0, 80)) {
    lines.push(
      `- ${item.severity} / ${item.category} / ${item.symbol}: ${item.reason}`,
      `  - ${item.title ?? "untitled"} @ ${item.timestamp || "unknown time"}`,
      `  - ${item.excerpt}`,
    );
  }

  lines.push("", "## Repeated Story Clusters", "");
  if (report.repeatedStoryClusters.length === 0) {
    lines.push("- none");
  } else {
    for (const cluster of report.repeatedStoryClusters.slice(0, 30)) {
      lines.push(
        `- ${cluster.symbol}: ${cluster.count} similar posts from ${cluster.firstTimestamp} to ${cluster.lastTimestamp}`,
        `  - ${cluster.sampleTitle ?? "untitled"}: ${cluster.sampleExcerpt}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export function writeTraderPostQualityReport(params: {
  report: TraderPostQualityReport;
  jsonPath: string;
  markdownPath: string;
}): void {
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  mkdirSync(dirname(params.markdownPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(params.report, null, 2)}\n`);
  writeFileSync(params.markdownPath, renderTraderPostQualityMarkdown(params.report));
}
