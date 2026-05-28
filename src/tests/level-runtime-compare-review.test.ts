import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRuntimeCompareLogEntry,
  parseRuntimeCompareLogsFromText,
  reviewRuntimeCompareEvents,
  type RuntimeCompareNormalizedEvent,
} from "../lib/levels/level-runtime-compare-review.js";

function makeEvent(
  overrides: Partial<RuntimeCompareNormalizedEvent> & {
    symbol: string;
  },
): RuntimeCompareNormalizedEvent {
  return {
    symbol: overrides.symbol,
    timestamp: overrides.timestamp ?? null,
    sourceLabel: overrides.sourceLabel ?? "test",
    lineNumber: overrides.lineNumber,
    activePath: overrides.activePath ?? "old",
    alternatePath: overrides.alternatePath ?? "new",
    activeTopSupport: overrides.activeTopSupport ?? "9.90",
    alternateTopSupport: overrides.alternateTopSupport ?? "9.82",
    activeTopResistance: overrides.activeTopResistance ?? "10.20",
    alternateTopResistance: overrides.alternateTopResistance ?? "10.28",
    activeVisibleCounts: overrides.activeVisibleCounts ?? { support: 2, resistance: 2 },
    alternateVisibleCounts:
      overrides.alternateVisibleCounts ?? { support: 1, resistance: 2 },
    supportChanged: overrides.supportChanged ?? true,
    resistanceChanged: overrides.resistanceChanged ?? true,
    bothChanged: overrides.bothChanged ?? true,
    ladderCountChanged: overrides.ladderCountChanged ?? true,
    notableDifferences:
      overrides.notableDifferences ??
      [
        "Top support changed between old surfaced output and the new strength ranking.",
        "The new path appears to suppress more nearby duplicates in the compared surfaced subset.",
      ],
    categories:
      overrides.categories ??
      ["top_support_changed", "top_resistance_changed", "both_tops_changed", "clutter_difference"],
    brokenLevelMentioned: overrides.brokenLevelMentioned ?? false,
    approximationMentioned: overrides.approximationMentioned ?? false,
    newPathLooksCleaner: overrides.newPathLooksCleaner ?? true,
    newPathLooksNoisier: overrides.newPathLooksNoisier ?? false,
    newPathContext: overrides.newPathContext ?? {
      topSupportState: "respected",
      topSupportConfidence: 72,
      topSupportExplanation: "Clean support",
      topResistanceState: "weakened",
      topResistanceConfidence: 58,
      topResistanceExplanation: "Shallow resistance",
    },
  };
}

test("normalization parses compare log entries and derives change flags", () => {
  const normalized = normalizeRuntimeCompareLogEntry({
    type: "level_runtime_compare",
    symbol: "tovx",
    activePath: "old",
    alternatePath: "new",
    activeTopSupport: "0.2897",
    alternateTopSupport: "0.2533",
    activeTopResistance: "0.4480",
    alternateTopResistance: "0.3952",
    activeVisibleCounts: { support: 3, resistance: 2 },
    alternateVisibleCounts: { support: 2, resistance: 2 },
    notableDifferences: [
      "Top support changed between old surfaced output and the new strength ranking.",
      "The new path adds state/confidence/explanation metadata that the old path cannot provide.",
    ],
    newPathContext: {
      topSupportState: "respected",
      topSupportConfidence: 74,
      topSupportExplanation: "clean support",
    },
  });

  assert.ok(!("reason" in normalized));
  assert.equal(normalized.symbol, "TOVX");
  assert.equal(normalized.supportChanged, true);
  assert.equal(normalized.resistanceChanged, true);
  assert.equal(normalized.ladderCountChanged, true);
  assert.ok(normalized.categories.includes("metadata_difference"));
});

test("parser handles malformed entries without crashing", () => {
  const text = [
    '{"type":"level_runtime_compare","symbol":"PBM","activePath":"old","alternatePath":"new","activeTopSupport":"8.80","alternateTopSupport":"8.70","activeTopResistance":"9.20","alternateTopResistance":"9.20","activeVisibleCounts":{"support":2,"resistance":2},"alternateVisibleCounts":{"support":1,"resistance":2}}',
    '{"type":"level_runtime_compare","symbol":"","activePath":"old","alternatePath":"new"}',
    '{"type":"level_runtime_compare",',
    'not json at all',
  ].join("\n");

  const parsed = parseRuntimeCompareLogsFromText(text, "test.log");

  assert.equal(parsed.validEvents.length, 1);
  assert.equal(parsed.parseIssues.length, 2);
  assert.ok(parsed.parseIssues.some((issue) => issue.reason.includes("missing symbol")));
});

test("aggregation computes support and resistance change counts plus category summaries", () => {
  const report = reviewRuntimeCompareEvents([
    makeEvent({ symbol: "PBM" }),
    makeEvent({
      symbol: "PBM",
      resistanceChanged: false,
      bothChanged: false,
      categories: ["top_support_changed", "top_level_disagreement"],
      notableDifferences: ["Top support changed between old surfaced output and the new strength ranking."],
    }),
    makeEvent({
      symbol: "DLPN",
      supportChanged: false,
      bothChanged: false,
      ladderCountChanged: false,
      categories: ["top_resistance_changed", "top_level_disagreement", "broken_level_handling"],
      brokenLevelMentioned: true,
      notableDifferences: ["broken resistance handling changed"],
      newPathLooksCleaner: false,
      newPathLooksNoisier: true,
    }),
  ]);

  assert.equal(report.aggregateSummary.validEvents, 3);
  assert.equal(report.aggregateSummary.supportChangedCount, 2);
  assert.equal(report.aggregateSummary.resistanceChangedCount, 2);
  assert.equal(report.aggregateSummary.brokenLevelDifferenceCount, 1);
  assert.ok(report.aggregateSummary.topDifferenceCategories.length > 0);
});

test("symbol summaries group repeated disagreement patterns", () => {
  const report = reviewRuntimeCompareEvents([
    makeEvent({ symbol: "CANG", brokenLevelMentioned: true, categories: ["broken_level_handling"] }),
    makeEvent({ symbol: "CANG", approximationMentioned: true, categories: ["bucket_approximation"] }),
    makeEvent({ symbol: "CANG", supportChanged: false, resistanceChanged: true, bothChanged: false }),
    makeEvent({ symbol: "BMGL", supportChanged: true, resistanceChanged: false, bothChanged: false }),
  ]);

  const cang = report.symbolSummaries.find((summary) => summary.symbol === "CANG");

  assert.ok(cang);
  assert.equal(cang.totalEvents, 3);
  assert.ok(cang.flags.length > 0);
  assert.ok(cang.categoryCounts.bucket_approximation >= 1);
});

test("manual review queue prioritizes repeated broken-level and approximation issues", () => {
  const report = reviewRuntimeCompareEvents([
    makeEvent({ symbol: "BBGI", brokenLevelMentioned: true, categories: ["broken_level_handling"] }),
    makeEvent({ symbol: "BBGI", brokenLevelMentioned: true, categories: ["broken_level_handling"] }),
    makeEvent({ symbol: "TOVX", approximationMentioned: true, categories: ["bucket_approximation"] }),
    makeEvent({ symbol: "TOVX", approximationMentioned: true, categories: ["strength_label_approximation"] }),
  ]);

  assert.equal(report.manualReviewQueue[0]?.symbol, "BBGI");
  assert.ok(
    ["likely_regression", "needs_human_inspection"].includes(
      report.manualReviewQueue[0]?.assessment ?? "",
    ),
  );
});

test("review generation remains robust when optional fields are missing", () => {
  const normalized = normalizeRuntimeCompareLogEntry({
    type: "level_runtime_compare",
    symbol: "GXAI",
    activePath: "old",
    alternatePath: "new",
  });

  assert.ok(!("reason" in normalized));

  const report = reviewRuntimeCompareEvents([normalized]);
  assert.equal(report.aggregateSummary.validEvents, 1);
  assert.equal(report.aggregateSummary.supportChangedCount, 0);
  assert.equal(report.aggregateSummary.resistanceChangedCount, 0);
});
