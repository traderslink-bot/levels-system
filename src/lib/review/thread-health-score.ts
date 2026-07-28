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
  error?: string;
  postingDecisionReason?: string;
  rangeBoxLabel?: string;
  acceptanceLabel?: string;
  behaviorBudgetLabel?: string;
  primaryTradeAreaLocked?: boolean;
  failedLevelOutcome?: string;
  levelImportanceLabel?: string;
  noLevelReason?: string;
};

export type ThreadHealthLabel = "healthy" | "watch" | "major_review" | "broken";

export type ThreadHealthSymbolScore = {
  symbol: string;
  label: ThreadHealthLabel;
  score: number;
  postCount: number;
  failedDeliveryCount: number;
  repeatedStoryCount: number;
  weakProbeCount: number;
  noLevelCount: number;
  reasons: string[];
  evidence: string[];
};

export type ThreadHealthScoreReport = {
  generatedAt: string;
  sourceAuditPath: string;
  symbols: ThreadHealthSymbolScore[];
  summary: Record<ThreadHealthLabel, number>;
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

function isPosted(row: DiscordAuditRow): boolean {
  return row.status === "posted" || row.status === "success";
}

function rowText(row: DiscordAuditRow): string {
  return [row.title, row.body, row.bodyPreview].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function storyKey(row: DiscordAuditRow): string {
  return [
    row.messageKind ?? "unknown",
    row.eventType ?? "unknown",
    row.rangeBoxLabel ?? "",
    row.acceptanceLabel ?? "",
    row.primaryTradeAreaLocked ? "locked" : "",
    row.failedLevelOutcome ?? "",
  ].join("|");
}

function labelForScore(score: number, failedDeliveryCount: number): ThreadHealthLabel {
  if (failedDeliveryCount > 0 || score < 45) {
    return "broken";
  }
  if (score < 65) {
    return "major_review";
  }
  if (score < 82) {
    return "watch";
  }
  return "healthy";
}

export function buildThreadHealthScoreReport(auditPath: string): ThreadHealthScoreReport {
  const rows = readRows(auditPath).filter((row) => row.symbol);
  const bySymbol = new Map<string, DiscordAuditRow[]>();
  for (const row of rows) {
    const symbol = row.symbol!.trim().toUpperCase();
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), row]);
  }

  const symbols = [...bySymbol.entries()].map(([symbol, symbolRows]) => {
    const postedRows = symbolRows.filter((row) => row.operation === "post_alert" && isPosted(row));
    const failedDeliveryRows = symbolRows.filter((row) => row.status === "failed");
    const reasons: string[] = [];
    const evidence: string[] = [];
    let score = 100;

    const repeatedStoryCount = postedRows.reduce((count, row, index) => {
      if (index === 0) {
        return count;
      }
      const prev = postedRows[index - 1]!;
      const repeated = storyKey(prev) === storyKey(row);
      return repeated ? count + 1 : count;
    }, 0);
    if (repeatedStoryCount > 0) {
      score -= Math.min(24, repeatedStoryCount * 6);
      reasons.push(`${repeatedStoryCount} repeated adjacent story posts`);
    }

    const weakProbeCount = postedRows.filter((row) =>
      row.acceptanceLabel === "weak_probe" || row.failedLevelOutcome === "probe_only",
    ).length;
    if (weakProbeCount >= 3) {
      score -= Math.min(18, weakProbeCount * 3);
      reasons.push(`${weakProbeCount} weak-probe/testing posts reached Discord`);
    }

    const noLevelCount = postedRows.filter((row) => row.noLevelReason || /none currently surfaced/i.test(rowText(row))).length;
    if (noLevelCount > 0) {
      score -= Math.min(18, noLevelCount * 6);
      reasons.push(`${noLevelCount} posts had missing next-level context`);
    }

    if (postedRows.length > 30) {
      score -= 16;
      reasons.push(`high post count (${postedRows.length})`);
    } else if (postedRows.length > 18) {
      score -= 8;
      reasons.push(`elevated post count (${postedRows.length})`);
    }

    if (failedDeliveryRows.length > 0) {
      score -= 35;
      reasons.push(`${failedDeliveryRows.length} delivery failures`);
    }

    for (const row of [...postedRows, ...failedDeliveryRows].slice(0, 6)) {
      evidence.push(rowText(row).slice(0, 240));
    }

    score = Math.max(0, Math.round(score));
    const label = labelForScore(score, failedDeliveryRows.length);
    return {
      symbol,
      label,
      score,
      postCount: postedRows.length,
      failedDeliveryCount: failedDeliveryRows.length,
      repeatedStoryCount,
      weakProbeCount,
      noLevelCount,
      reasons: reasons.length > 0 ? reasons : ["thread stayed within health thresholds"],
      evidence,
    };
  }).sort((left, right) => left.score - right.score || right.postCount - left.postCount || left.symbol.localeCompare(right.symbol));

  const summary: Record<ThreadHealthLabel, number> = {
    healthy: 0,
    watch: 0,
    major_review: 0,
    broken: 0,
  };
  for (const symbol of symbols) {
    summary[symbol.label] += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: auditPath,
    symbols,
    summary,
  };
}

export function formatThreadHealthScoreMarkdown(report: ThreadHealthScoreReport): string {
  const lines = [
    "# Thread Health Score",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceAuditPath}`,
    "",
    "## Summary",
    "",
    `- healthy: ${report.summary.healthy}`,
    `- watch: ${report.summary.watch}`,
    `- major review: ${report.summary.major_review}`,
    `- broken: ${report.summary.broken}`,
    "",
    "## Symbols",
    "",
  ];

  for (const symbol of report.symbols.slice(0, 40)) {
    lines.push(`### ${symbol.symbol} - ${symbol.label} (${symbol.score})`);
    lines.push(`- posts: ${symbol.postCount}`);
    lines.push(`- failed deliveries: ${symbol.failedDeliveryCount}`);
    lines.push(`- repeated adjacent stories: ${symbol.repeatedStoryCount}`);
    lines.push(`- weak probes: ${symbol.weakProbeCount}`);
    lines.push(`- missing next-level context: ${symbol.noLevelCount}`);
    lines.push(`- reasons: ${symbol.reasons.join("; ")}`);
    if (symbol.evidence.length > 0) {
      lines.push("- evidence:");
      for (const item of symbol.evidence.slice(0, 3)) {
        lines.push(`  - ${item}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function writeThreadHealthScoreReport(params: {
  auditPath: string;
  jsonPath: string;
  markdownPath: string;
}): ThreadHealthScoreReport {
  const report = buildThreadHealthScoreReport(params.auditPath);
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(params.markdownPath, formatThreadHealthScoreMarkdown(report));
  return report;
}

