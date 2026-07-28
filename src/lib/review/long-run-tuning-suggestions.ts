import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { SnapshotAuditReport, ThreadPostPolicyReport } from "./discord-audit-reports.js";

export type TuningSuggestionSeverity = "info" | "watch" | "action";

export type TuningSuggestion = {
  id: string;
  severity: TuningSuggestionSeverity;
  symbol?: string;
  category:
    | "follow_through_repeats"
    | "continuity_repeats"
    | "ai_repeats"
    | "post_burst"
    | "optional_density"
    | "delivery_failure"
    | "level_audit";
  title: string;
  rationale: string;
  suggestedAction: string;
  evidence: Record<string, unknown>;
};

export type LongRunTuningSuggestionsReport = {
  generatedAt: string;
  sourceAuditPath: string;
  summary: {
    actionCount: number;
    watchCount: number;
    infoCount: number;
    symbolsWithActionItems: string[];
  };
  suggestions: TuningSuggestion[];
};

function severityRank(severity: TuningSuggestionSeverity): number {
  switch (severity) {
    case "action":
      return 3;
    case "watch":
      return 2;
    default:
      return 1;
  }
}

function suggestionKey(input: {
  category: TuningSuggestion["category"];
  symbol?: string;
  value: string;
}): string {
  return `${input.category}:${input.symbol ?? "session"}:${input.value}`
    .replace(/[^A-Za-z0-9:_-]+/g, "-")
    .slice(0, 140);
}

function messageKindCategory(messageKind: string): TuningSuggestion["category"] {
  if (messageKind === "follow_through_update") {
    return "follow_through_repeats";
  }
  if (messageKind === "ai_signal_commentary") {
    return "ai_repeats";
  }
  return "continuity_repeats";
}

function hasIncompleteStoryMetadata(storyKey: string): boolean {
  return storyKey.split("|").some((part) => part === "unknown");
}

function formatEvidenceValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "none";
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value ?? "n/a");
}

function formatEvidenceMarkdown(evidence: Record<string, unknown>): string[] {
  return Object.entries(evidence).map(
    ([key, value]) => `  - ${key}: ${formatEvidenceValue(value)}`,
  );
}

export function buildLongRunTuningSuggestionsReport(params: {
  policyReport: ThreadPostPolicyReport;
  snapshotReport: SnapshotAuditReport;
}): LongRunTuningSuggestionsReport {
  const suggestions: TuningSuggestion[] = [];

  for (const symbol of params.policyReport.perSymbol) {
    if (symbol.failed > 0) {
      suggestions.push({
        id: suggestionKey({ category: "delivery_failure", symbol: symbol.symbol, value: String(symbol.failed) }),
        severity: "action",
        symbol: symbol.symbol,
        category: "delivery_failure",
        title: `${symbol.symbol} had Discord delivery failures`,
        rationale: "Delivery failures can make a good signal stream look bad or delayed.",
        suggestedAction: "Review Discord rate limits, permissions, and route failures before tuning signal thresholds.",
        evidence: { failed: symbol.failed },
      });
    }

    for (const story of symbol.repeatedStoryClusters.slice(0, 4)) {
      const severity = story.count >= 5 ? "action" : "watch";
      const category = messageKindCategory(story.messageKind);
      const incompleteStoryMetadata = hasIncompleteStoryMetadata(story.storyKey);
      suggestions.push({
        id: suggestionKey({ category, symbol: symbol.symbol, value: story.storyKey }),
        severity,
        symbol: symbol.symbol,
        category,
        title: `${symbol.symbol} repeated ${story.messageKind} ${story.count} times`,
        rationale:
          "Repeated same-story posts reduce trader trust because the thread looks busy without adding new decision information.",
        suggestedAction:
          story.messageKind === "follow_through_update"
            ? incompleteStoryMetadata
              ? "Keep the current stricter follow-through same-story gate and verify the next live run records target-level metadata for this story."
              : "Keep the current stricter follow-through same-story gate and verify the next live run groups repeats by target level."
            : story.messageKind === "ai_signal_commentary"
              ? "Require a materially new deterministic alert before another AI read posts for this symbol story."
              : incompleteStoryMetadata
                ? "Require a stronger lifecycle transition before posting this continuity story again, and verify new audit rows include event and level context."
                : "Require a stronger lifecycle transition or a fresher level before posting this continuity story again.",
        evidence: {
          storyKey: story.storyKey,
          messageKind: story.messageKind,
          count: story.count,
          incompleteStoryMetadata,
          latestDirectionalReturnPct: story.latestDirectionalReturnPct ?? null,
          latestRawReturnPct: story.latestRawReturnPct ?? null,
        },
      });
    }

    if (symbol.maxPostsInFiveMinutes > 5 || symbol.maxPostsInTenMinutes > 8) {
      suggestions.push({
        id: suggestionKey({
          category: "post_burst",
          symbol: symbol.symbol,
          value: `${symbol.maxPostsInFiveMinutes}-${symbol.maxPostsInTenMinutes}`,
        }),
        severity: symbol.maxPostsInFiveMinutes >= 8 || symbol.maxPostsInTenMinutes >= 12 ? "action" : "watch",
        symbol: symbol.symbol,
        category: "post_burst",
        title: `${symbol.symbol} had a live post burst`,
        rationale: "Fast clusters can bury the one message a trader actually needs to see.",
        suggestedAction:
          "Let trader-critical alerts win the moment, and keep optional continuity or recap posts in operator reports during the burst window.",
        evidence: {
          maxPostsInFiveMinutes: symbol.maxPostsInFiveMinutes,
          maxPostsInTenMinutes: symbol.maxPostsInTenMinutes,
        },
      });
    }

    const optionalDensityEligible = symbol.posted >= 6 && symbol.traderHelpfulOptional >= 3;
    if (optionalDensityEligible && symbol.optionalDensity > 0.35) {
      suggestions.push({
        id: suggestionKey({
          category: "optional_density",
          symbol: symbol.symbol,
          value: symbol.optionalDensity.toFixed(2),
        }),
        severity: symbol.optionalDensity >= 0.45 ? "action" : "watch",
        symbol: symbol.symbol,
        category: "optional_density",
        title: `${symbol.symbol} optional context density was high`,
        rationale: "Optional posts are useful only when they clarify a changed story; otherwise they make threads feel noisy.",
        suggestedAction:
          "Tighten recap, AI, and continuity eligibility for this symbol family until optional posts stay below roughly one third of live output.",
        evidence: {
          optionalDensity: symbol.optionalDensity,
          traderCritical: symbol.traderCritical,
          traderHelpfulOptional: symbol.traderHelpfulOptional,
        },
      });
    }
  }

  for (const symbol of params.snapshotReport.perSymbol) {
    const omittedTotal = Object.values(symbol.omittedByReason).reduce((sum, count) => sum + count, 0);
    if (omittedTotal <= 0) {
      continue;
    }

    suggestions.push({
      id: suggestionKey({ category: "level_audit", symbol: symbol.symbol, value: String(omittedTotal) }),
      severity: symbol.outsideForwardRangeLevels.length > 0 ? "watch" : "info",
      symbol: symbol.symbol,
      category: "level_audit",
      title: `${symbol.symbol} had omitted snapshot levels`,
      rationale:
        "Omitted level audit rows help separate true missing-level detection problems from display compaction and forward-range filtering.",
      suggestedAction:
        "Review the snapshot audit before changing level detection. If obvious daily levels are absent from the audit entirely, use level-quality validation next.",
      evidence: {
        omittedByReason: symbol.omittedByReason,
        compactedLevels: symbol.compactedLevels,
        wrongSideLevels: symbol.wrongSideLevels,
        outsideForwardRangeLevels: symbol.outsideForwardRangeLevels,
      },
    });
  }

  suggestions.sort(
    (left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      (left.symbol ?? "").localeCompare(right.symbol ?? "") ||
      left.title.localeCompare(right.title),
  );

  const symbolsWithActionItems = [...new Set(
    suggestions
      .filter((suggestion) => suggestion.severity === "action" && suggestion.symbol)
      .map((suggestion) => suggestion.symbol!),
  )].sort((left, right) => left.localeCompare(right));

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditPath: params.policyReport.sourceAuditPath,
    summary: {
      actionCount: suggestions.filter((suggestion) => suggestion.severity === "action").length,
      watchCount: suggestions.filter((suggestion) => suggestion.severity === "watch").length,
      infoCount: suggestions.filter((suggestion) => suggestion.severity === "info").length,
      symbolsWithActionItems,
    },
    suggestions,
  };
}

export function formatLongRunTuningSuggestionsMarkdown(report: LongRunTuningSuggestionsReport): string {
  const lines: string[] = [
    "# Long-Run Tuning Suggestions",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceAuditPath}`,
    "",
    "## Summary",
    "",
    `- action items: ${report.summary.actionCount}`,
    `- watch items: ${report.summary.watchCount}`,
    `- info items: ${report.summary.infoCount}`,
    `- symbols with action items: ${report.summary.symbolsWithActionItems.join(", ") || "none"}`,
    "",
    "## Suggestions",
    "",
  ];

  if (report.suggestions.length === 0) {
    lines.push("- No tuning suggestions were generated from this run.", "");
    return lines.join("\n");
  }

  for (const suggestion of report.suggestions) {
    lines.push(
      `### ${suggestion.severity.toUpperCase()}: ${suggestion.title}`,
      "",
      `- category: ${suggestion.category}`,
      `- symbol: ${suggestion.symbol ?? "session"}`,
      `- rationale: ${suggestion.rationale}`,
      `- suggested action: ${suggestion.suggestedAction}`,
      "- evidence:",
      ...formatEvidenceMarkdown(suggestion.evidence),
      "",
    );
  }

  return lines.join("\n");
}

export function writeLongRunTuningSuggestionsReports(params: {
  jsonPath: string;
  markdownPath: string;
  report: LongRunTuningSuggestionsReport;
}): void {
  mkdirSync(dirname(params.jsonPath), { recursive: true });
  writeFileSync(params.jsonPath, `${JSON.stringify(params.report, null, 2)}\n`, "utf8");
  mkdirSync(dirname(params.markdownPath), { recursive: true });
  writeFileSync(params.markdownPath, `${formatLongRunTuningSuggestionsMarkdown(params.report)}\n`, "utf8");
}
