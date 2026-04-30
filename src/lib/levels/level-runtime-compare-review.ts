// 2026-04-18 09:20 AM America/Toronto
// Aggregate compare-mode runtime logs into practical review summaries and manual-review priorities.

import {
  resolveLevelRuntimeCompareActivePath,
  type LevelRuntimeCompareActivePath,
} from "./level-runtime-mode.js";

export type RuntimeCompareLogEntry = {
  type?: string | null;
  symbol?: string | null;
  timestamp?: number | null;
  activePath?: string | null;
  alternatePath?: string | null;
  activeTopSupport?: string | null;
  alternateTopSupport?: string | null;
  activeTopResistance?: string | null;
  alternateTopResistance?: string | null;
  activeVisibleCounts?: {
    support?: number | null;
    resistance?: number | null;
  } | null;
  alternateVisibleCounts?: {
    support?: number | null;
    resistance?: number | null;
  } | null;
  notableDifferences?: string[] | null;
  newPathContext?: {
    topSupportState?: string | null;
    topSupportConfidence?: number | null;
    topSupportExplanation?: string | null;
    topResistanceState?: string | null;
    topResistanceConfidence?: number | null;
    topResistanceExplanation?: string | null;
  } | null;
};

export type RuntimeCompareDifferenceCategory =
  | "top_support_changed"
  | "top_resistance_changed"
  | "both_tops_changed"
  | "ladder_count_changed"
  | "broken_level_handling"
  | "anchor_difference"
  | "bucket_approximation"
  | "strength_label_approximation"
  | "metadata_difference"
  | "clutter_difference"
  | "top_level_disagreement";

export type RuntimeCompareParseIssue = {
  sourceLabel: string;
  lineNumber?: number;
  reason: string;
  rawSnippet: string;
};

export type RuntimeCompareNormalizedEvent = {
  symbol: string;
  timestamp: number | null;
  sourceLabel: string;
  lineNumber?: number;
  activePath: LevelRuntimeCompareActivePath;
  alternatePath: LevelRuntimeCompareActivePath;
  activeTopSupport: string | null;
  alternateTopSupport: string | null;
  activeTopResistance: string | null;
  alternateTopResistance: string | null;
  activeVisibleCounts: {
    support: number;
    resistance: number;
  };
  alternateVisibleCounts: {
    support: number;
    resistance: number;
  };
  supportChanged: boolean;
  resistanceChanged: boolean;
  bothChanged: boolean;
  ladderCountChanged: boolean;
  notableDifferences: string[];
  categories: RuntimeCompareDifferenceCategory[];
  brokenLevelMentioned: boolean;
  approximationMentioned: boolean;
  newPathLooksCleaner: boolean;
  newPathLooksNoisier: boolean;
  newPathContext: {
    topSupportState: string | null;
    topSupportConfidence: number | null;
    topSupportExplanation: string | null;
    topResistanceState: string | null;
    topResistanceConfidence: number | null;
    topResistanceExplanation: string | null;
  };
};

export type RuntimeCompareSymbolSummary = {
  symbol: string;
  totalEvents: number;
  supportChangeCount: number;
  resistanceChangeCount: number;
  bothChangedCount: number;
  ladderCountChangedCount: number;
  brokenLevelDifferenceCount: number;
  approximationIssueCount: number;
  newPathCleanerCount: number;
  newPathNoisierCount: number;
  categoryCounts: Record<RuntimeCompareDifferenceCategory, number>;
  topRepresentativeDifference: string | null;
  flags: string[];
};

export type RuntimeCompareManualReviewAssessment =
  | "likely_improvement"
  | "likely_regression"
  | "ambiguous"
  | "needs_human_inspection";

export type RuntimeCompareManualReviewItem = {
  symbol: string;
  reason: string;
  count: number;
  frequencyPct: number;
  representativeDifference: string | null;
  assessment: RuntimeCompareManualReviewAssessment;
  priorityScore: number;
};

export type RuntimeCompareAggregateSummary = {
  totalCompareEvents: number;
  validEvents: number;
  malformedEvents: number;
  supportChangedCount: number;
  resistanceChangedCount: number;
  bothChangedCount: number;
  ladderCountChangedCount: number;
  brokenLevelDifferenceCount: number;
  approximationRelatedDifferenceCount: number;
  topDifferenceCategories: Array<{
    category: RuntimeCompareDifferenceCategory;
    count: number;
  }>;
  recommendation: string;
};

export type RuntimeCompareReviewReport = {
  validEvents: RuntimeCompareNormalizedEvent[];
  parseIssues: RuntimeCompareParseIssue[];
  aggregateSummary: RuntimeCompareAggregateSummary;
  symbolSummaries: RuntimeCompareSymbolSummary[];
  manualReviewQueue: RuntimeCompareManualReviewItem[];
};

const DEFAULT_SOURCE_LABEL = "runtime-compare-log";
const DEFAULT_MAX_MANUAL_REVIEW_ITEMS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeVisibleCounts(
  value: RuntimeCompareLogEntry["activeVisibleCounts"],
): { support: number; resistance: number } {
  return {
    support:
      typeof value?.support === "number" && Number.isFinite(value.support)
        ? value.support
        : 0,
    resistance:
      typeof value?.resistance === "number" && Number.isFinite(value.resistance)
        ? value.resistance
        : 0,
  };
}

function categorizeDifferences(entry: RuntimeCompareLogEntry, normalized: {
  supportChanged: boolean;
  resistanceChanged: boolean;
  ladderCountChanged: boolean;
}): RuntimeCompareDifferenceCategory[] {
  const categories = new Set<RuntimeCompareDifferenceCategory>();

  if (normalized.supportChanged) {
    categories.add("top_support_changed");
    categories.add("top_level_disagreement");
  }
  if (normalized.resistanceChanged) {
    categories.add("top_resistance_changed");
    categories.add("top_level_disagreement");
  }
  if (normalized.supportChanged && normalized.resistanceChanged) {
    categories.add("both_tops_changed");
  }
  if (normalized.ladderCountChanged) {
    categories.add("ladder_count_changed");
  }

  for (const difference of entry.notableDifferences ?? []) {
    const normalizedDifference = difference.toLowerCase();
    if (normalizedDifference.includes("broken")) {
      categories.add("broken_level_handling");
    }
    if (normalizedDifference.includes("anchor")) {
      categories.add("anchor_difference");
    }
    if (normalizedDifference.includes("bucket")) {
      categories.add("bucket_approximation");
    }
    if (normalizedDifference.includes("strength label")) {
      categories.add("strength_label_approximation");
    }
    if (
      normalizedDifference.includes("state/confidence/explanation") ||
      normalizedDifference.includes("state") && normalizedDifference.includes("explanation")
    ) {
      categories.add("metadata_difference");
    }
    if (
      normalizedDifference.includes("duplicate") ||
      normalizedDifference.includes("clutter") ||
      normalizedDifference.includes("ladder")
    ) {
      categories.add("clutter_difference");
    }
  }

  return [...categories];
}

function buildRepresentativeDifference(entry: RuntimeCompareNormalizedEvent): string | null {
  const differences: string[] = [];
  if (entry.supportChanged) {
    differences.push(
      `support ${entry.activeTopSupport ?? "none"} -> ${entry.alternateTopSupport ?? "none"}`,
    );
  }
  if (entry.resistanceChanged) {
    differences.push(
      `resistance ${entry.activeTopResistance ?? "none"} -> ${entry.alternateTopResistance ?? "none"}`,
    );
  }
  if (entry.ladderCountChanged) {
    differences.push(
      `ladder counts ${entry.activeVisibleCounts.support}/${entry.activeVisibleCounts.resistance} -> ${entry.alternateVisibleCounts.support}/${entry.alternateVisibleCounts.resistance}`,
    );
  }
  if (differences.length > 0) {
    return differences.join(" | ");
  }

  return entry.notableDifferences[0] ?? null;
}

export function normalizeRuntimeCompareLogEntry(
  value: unknown,
  options: {
    sourceLabel?: string;
    lineNumber?: number;
  } = {},
): RuntimeCompareNormalizedEvent | RuntimeCompareParseIssue {
  const sourceLabel = options.sourceLabel ?? DEFAULT_SOURCE_LABEL;

  if (!isRecord(value)) {
    return {
      sourceLabel,
      lineNumber: options.lineNumber,
      reason: "entry is not an object",
      rawSnippet: String(value).slice(0, 240),
    };
  }

  const entry = value as RuntimeCompareLogEntry;
  const symbol = toNullableString(entry.symbol)?.toUpperCase() ?? null;
  const activePath = resolveLevelRuntimeCompareActivePath(entry.activePath);
  const alternatePath = resolveLevelRuntimeCompareActivePath(entry.alternatePath);
  const activeTopSupport = toNullableString(entry.activeTopSupport);
  const alternateTopSupport = toNullableString(entry.alternateTopSupport);
  const activeTopResistance = toNullableString(entry.activeTopResistance);
  const alternateTopResistance = toNullableString(entry.alternateTopResistance);
  const notableDifferences = Array.isArray(entry.notableDifferences)
    ? entry.notableDifferences.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  if (!symbol) {
    return {
      sourceLabel,
      lineNumber: options.lineNumber,
      reason: "missing symbol",
      rawSnippet: JSON.stringify(value).slice(0, 240),
    };
  }

  if (!toNullableString(entry.activePath) || !toNullableString(entry.alternatePath)) {
    return {
      sourceLabel,
      lineNumber: options.lineNumber,
      reason: "missing activePath or alternatePath",
      rawSnippet: JSON.stringify(value).slice(0, 240),
    };
  }

  const activeVisibleCounts = normalizeVisibleCounts(entry.activeVisibleCounts);
  const alternateVisibleCounts = normalizeVisibleCounts(entry.alternateVisibleCounts);
  const supportChanged = activeTopSupport !== alternateTopSupport;
  const resistanceChanged = activeTopResistance !== alternateTopResistance;
  const ladderCountChanged =
    activeVisibleCounts.support !== alternateVisibleCounts.support ||
    activeVisibleCounts.resistance !== alternateVisibleCounts.resistance;
  const categories = categorizeDifferences(entry, {
    supportChanged,
    resistanceChanged,
    ladderCountChanged,
  });
  const newPathTotalCount =
    activePath === "new"
      ? activeVisibleCounts.support + activeVisibleCounts.resistance
      : alternateVisibleCounts.support + alternateVisibleCounts.resistance;
  const oldPathTotalCount =
    activePath === "old"
      ? activeVisibleCounts.support + activeVisibleCounts.resistance
      : alternateVisibleCounts.support + alternateVisibleCounts.resistance;
  const brokenLevelMentioned =
    categories.includes("broken_level_handling") ||
    entry.newPathContext?.topSupportState === "broken" ||
    entry.newPathContext?.topResistanceState === "broken";
  const approximationMentioned =
    categories.includes("bucket_approximation") ||
    categories.includes("strength_label_approximation");

  return {
    symbol,
    timestamp: toNullableNumber(entry.timestamp),
    sourceLabel,
    lineNumber: options.lineNumber,
    activePath,
    alternatePath,
    activeTopSupport,
    alternateTopSupport,
    activeTopResistance,
    alternateTopResistance,
    activeVisibleCounts,
    alternateVisibleCounts,
    supportChanged,
    resistanceChanged,
    bothChanged: supportChanged && resistanceChanged,
    ladderCountChanged,
    notableDifferences,
    categories,
    brokenLevelMentioned,
    approximationMentioned,
    newPathLooksCleaner:
      newPathTotalCount < oldPathTotalCount ||
      categories.includes("clutter_difference"),
    newPathLooksNoisier:
      newPathTotalCount > oldPathTotalCount &&
      !categories.includes("clutter_difference"),
    newPathContext: {
      topSupportState: toNullableString(entry.newPathContext?.topSupportState),
      topSupportConfidence: toNullableNumber(entry.newPathContext?.topSupportConfidence),
      topSupportExplanation: toNullableString(entry.newPathContext?.topSupportExplanation),
      topResistanceState: toNullableString(entry.newPathContext?.topResistanceState),
      topResistanceConfidence: toNullableNumber(entry.newPathContext?.topResistanceConfidence),
      topResistanceExplanation: toNullableString(entry.newPathContext?.topResistanceExplanation),
    },
  };
}

function looksLikeCompareCandidate(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "level_runtime_compare") {
    return true;
  }

  return typeof value.symbol === "string" && "activePath" in value && "alternatePath" in value;
}

function parseJsonWithIssues(
  text: string,
  sourceLabel: string,
): { values: unknown[]; issues: RuntimeCompareParseIssue[] } {
  const trimmed = text.trim();
  const issues: RuntimeCompareParseIssue[] = [];

  if (!trimmed) {
    return { values: [], issues };
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return { values: parsed, issues };
      }

      issues.push({
        sourceLabel,
        reason: "top-level JSON array expected for array input",
        rawSnippet: trimmed.slice(0, 240),
      });
      return { values: [], issues };
    } catch (error) {
      issues.push({
        sourceLabel,
        reason: `invalid JSON array input: ${error instanceof Error ? error.message : String(error)}`,
        rawSnippet: trimmed.slice(0, 240),
      });
      return { values: [], issues };
    }
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return { values: [JSON.parse(trimmed)], issues };
    } catch {
      // Fall through to line-by-line parsing because the file may be NDJSON.
    }
  }

  const values: unknown[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith("{")) {
      continue;
    }

    try {
      values.push(JSON.parse(trimmedLine));
    } catch (error) {
      issues.push({
        sourceLabel,
        lineNumber: index + 1,
        reason: `invalid JSON line: ${error instanceof Error ? error.message : String(error)}`,
        rawSnippet: trimmedLine.slice(0, 240),
      });
    }
  }

  return { values, issues };
}

export function parseRuntimeCompareLogsFromText(
  text: string,
  sourceLabel = DEFAULT_SOURCE_LABEL,
): {
  validEvents: RuntimeCompareNormalizedEvent[];
  parseIssues: RuntimeCompareParseIssue[];
} {
  const parsed = parseJsonWithIssues(text, sourceLabel);
  const validEvents: RuntimeCompareNormalizedEvent[] = [];
  const parseIssues = [...parsed.issues];

  for (const [index, value] of parsed.values.entries()) {
    if (!looksLikeCompareCandidate(value)) {
      continue;
    }

    const normalized = normalizeRuntimeCompareLogEntry(value, {
      sourceLabel,
      lineNumber: index + 1,
    });
    if ("reason" in normalized) {
      parseIssues.push(normalized);
      continue;
    }
    validEvents.push(normalized);
  }

  return {
    validEvents,
    parseIssues,
  };
}

function buildCategoryCounts(
  events: RuntimeCompareNormalizedEvent[],
): Record<RuntimeCompareDifferenceCategory, number> {
  const counts: Record<RuntimeCompareDifferenceCategory, number> = {
    top_support_changed: 0,
    top_resistance_changed: 0,
    both_tops_changed: 0,
    ladder_count_changed: 0,
    broken_level_handling: 0,
    anchor_difference: 0,
    bucket_approximation: 0,
    strength_label_approximation: 0,
    metadata_difference: 0,
    clutter_difference: 0,
    top_level_disagreement: 0,
  };

  for (const event of events) {
    for (const category of event.categories) {
      counts[category] += 1;
    }
  }

  return counts;
}

function buildSymbolSummary(
  symbol: string,
  events: RuntimeCompareNormalizedEvent[],
): RuntimeCompareSymbolSummary {
  const categoryCounts = buildCategoryCounts(events);
  const supportChangeCount = events.filter((event) => event.supportChanged).length;
  const resistanceChangeCount = events.filter((event) => event.resistanceChanged).length;
  const bothChangedCount = events.filter((event) => event.bothChanged).length;
  const ladderCountChangedCount = events.filter((event) => event.ladderCountChanged).length;
  const brokenLevelDifferenceCount = events.filter((event) => event.brokenLevelMentioned).length;
  const approximationIssueCount = events.filter((event) => event.approximationMentioned).length;
  const newPathCleanerCount = events.filter((event) => event.newPathLooksCleaner).length;
  const newPathNoisierCount = events.filter((event) => event.newPathLooksNoisier).length;
  const flags: string[] = [];

  if (brokenLevelDifferenceCount >= 2) {
    flags.push("repeated broken-level disagreement");
  }
  if (approximationIssueCount >= 2) {
    flags.push("adapter approximation mentions recurring");
  }
  if (supportChangeCount + resistanceChangeCount >= Math.ceil(events.length * 0.6)) {
    flags.push("high disagreement frequency");
  }
  if (newPathNoisierCount > newPathCleanerCount) {
    flags.push("new path may be noisier here");
  } else if (newPathCleanerCount > 0) {
    flags.push("new path often looks cleaner");
  }

  return {
    symbol,
    totalEvents: events.length,
    supportChangeCount,
    resistanceChangeCount,
    bothChangedCount,
    ladderCountChangedCount,
    brokenLevelDifferenceCount,
    approximationIssueCount,
    newPathCleanerCount,
    newPathNoisierCount,
    categoryCounts,
    topRepresentativeDifference:
      events
        .map(buildRepresentativeDifference)
        .find((difference): difference is string => Boolean(difference)) ?? null,
    flags,
  };
}

function assessManualReviewItem(summary: RuntimeCompareSymbolSummary): RuntimeCompareManualReviewAssessment {
  if (summary.brokenLevelDifferenceCount >= 2 || summary.approximationIssueCount >= 2) {
    return "likely_regression";
  }
  if (summary.newPathCleanerCount > 0 && summary.newPathNoisierCount === 0) {
    return "likely_improvement";
  }
  if (summary.newPathCleanerCount > 0 && summary.newPathNoisierCount > 0) {
    return "ambiguous";
  }
  return "needs_human_inspection";
}

function buildManualReviewQueue(
  symbolSummaries: RuntimeCompareSymbolSummary[],
  maxItems: number,
): RuntimeCompareManualReviewItem[] {
  return [...symbolSummaries]
    .map((summary) => {
      const priorityScore =
        summary.bothChangedCount * 6 +
        (summary.supportChangeCount + summary.resistanceChangeCount) * 3 +
        summary.brokenLevelDifferenceCount * 8 +
        summary.approximationIssueCount * 6 +
        summary.ladderCountChangedCount * 2;
      const dominantReason =
        summary.brokenLevelDifferenceCount >= 2
          ? "broken-level disagreements recurring"
          : summary.approximationIssueCount >= 2
            ? "adapter approximation mentions recurring"
            : summary.bothChangedCount >= 1
              ? "both support and resistance change repeatedly"
              : "repeated surfaced disagreement";

      return {
        symbol: summary.symbol,
        reason: dominantReason,
        count:
          summary.supportChangeCount +
          summary.resistanceChangeCount +
          summary.brokenLevelDifferenceCount +
          summary.approximationIssueCount,
        frequencyPct: Number(
          (
            ((summary.supportChangeCount + summary.resistanceChangeCount) /
              Math.max(summary.totalEvents * 2, 1)) *
            100
          ).toFixed(2),
        ),
        representativeDifference: summary.topRepresentativeDifference,
        assessment: assessManualReviewItem(summary),
        priorityScore,
      } satisfies RuntimeCompareManualReviewItem;
    })
    .filter((item) => item.priorityScore > 0)
    .sort(
      (left, right) =>
        right.priorityScore - left.priorityScore ||
        right.frequencyPct - left.frequencyPct ||
        left.symbol.localeCompare(right.symbol),
    )
    .slice(0, maxItems);
}

function buildRecommendation(params: {
  validEvents: RuntimeCompareNormalizedEvent[];
  brokenLevelDifferenceCount: number;
  approximationRelatedDifferenceCount: number;
  supportChangedCount: number;
  resistanceChangedCount: number;
}): string {
  if (params.validEvents.length === 0) {
    return "No valid compare-mode events were found; gather runtime compare logs first.";
  }

  const disagreementRate =
    (params.supportChangedCount + params.resistanceChangedCount) /
    Math.max(params.validEvents.length * 2, 1);

  if (params.brokenLevelDifferenceCount >= Math.ceil(params.validEvents.length * 0.4)) {
    return "Broken-level handling still shows up often enough to justify another focused calibration pass before broader experimentation.";
  }

  if (params.approximationRelatedDifferenceCount >= Math.ceil(params.validEvents.length * 0.25)) {
    return "Adapter approximation mentions are recurring; inspect bucket and label projection behavior before broadening compare-mode experiments.";
  }

  if (disagreementRate >= 0.35) {
    return "The new path is changing trader-facing levels often enough that compare mode should stay on while the flagged symbols are reviewed manually.";
  }

  return "Differences look bounded enough for continued compare-mode experimentation, with the manual review queue used to inspect the recurring disagreements.";
}

export function reviewRuntimeCompareEvents(
  events: RuntimeCompareNormalizedEvent[],
  parseIssues: RuntimeCompareParseIssue[] = [],
  options: {
    maxManualReviewItems?: number;
  } = {},
): RuntimeCompareReviewReport {
  const supportChangedCount = events.filter((event) => event.supportChanged).length;
  const resistanceChangedCount = events.filter((event) => event.resistanceChanged).length;
  const bothChangedCount = events.filter((event) => event.bothChanged).length;
  const ladderCountChangedCount = events.filter((event) => event.ladderCountChanged).length;
  const brokenLevelDifferenceCount = events.filter((event) => event.brokenLevelMentioned).length;
  const approximationRelatedDifferenceCount = events.filter(
    (event) => event.approximationMentioned,
  ).length;
  const categoryCounts = buildCategoryCounts(events);
  const symbolMap = new Map<string, RuntimeCompareNormalizedEvent[]>();

  for (const event of events) {
    const existing = symbolMap.get(event.symbol) ?? [];
    existing.push(event);
    symbolMap.set(event.symbol, existing);
  }

  const symbolSummaries = [...symbolMap.entries()]
    .map(([symbol, symbolEvents]) => buildSymbolSummary(symbol, symbolEvents))
    .sort(
      (left, right) =>
        right.totalEvents - left.totalEvents ||
        right.brokenLevelDifferenceCount - left.brokenLevelDifferenceCount ||
        left.symbol.localeCompare(right.symbol),
    );

  return {
    validEvents: events,
    parseIssues,
    aggregateSummary: {
      totalCompareEvents: events.length + parseIssues.length,
      validEvents: events.length,
      malformedEvents: parseIssues.length,
      supportChangedCount,
      resistanceChangedCount,
      bothChangedCount,
      ladderCountChangedCount,
      brokenLevelDifferenceCount,
      approximationRelatedDifferenceCount,
      topDifferenceCategories: Object.entries(categoryCounts)
        .map(([category, count]) => ({
          category: category as RuntimeCompareDifferenceCategory,
          count,
        }))
        .filter((entry) => entry.count > 0)
        .sort((left, right) => right.count - left.count)
        .slice(0, 6),
      recommendation: buildRecommendation({
        validEvents: events,
        brokenLevelDifferenceCount,
        approximationRelatedDifferenceCount,
        supportChangedCount,
        resistanceChangedCount,
      }),
    },
    symbolSummaries,
    manualReviewQueue: buildManualReviewQueue(
      symbolSummaries,
      options.maxManualReviewItems ?? DEFAULT_MAX_MANUAL_REVIEW_ITEMS,
    ),
  };
}
