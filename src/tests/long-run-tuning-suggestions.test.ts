import assert from "node:assert/strict";
import test from "node:test";

import type { SnapshotAuditReport, ThreadPostPolicyReport } from "../lib/review/discord-audit-reports.js";
import {
  buildLongRunTuningSuggestionsReport,
  formatLongRunTuningSuggestionsMarkdown,
} from "../lib/review/long-run-tuning-suggestions.js";

test("long-run tuning suggestions prioritize repeated stories, bursts, and optional density", () => {
  const policyReport: ThreadPostPolicyReport = {
    generatedAt: "2026-04-28T00:00:00.000Z",
    sourceAuditPath: "session/discord-delivery-audit.jsonl",
    totals: {
      posted: 20,
      failed: 0,
      traderCritical: 12,
      traderHelpfulOptional: 8,
      operatorOnly: 0,
      repeatedStoryClusters: 1,
    },
    topFindings: [],
    perSymbol: [
      {
        symbol: "ATER",
        posted: 20,
        failed: 0,
        traderCritical: 10,
        traderHelpfulOptional: 10,
        operatorOnly: 0,
        optionalDensity: 0.5,
        maxPostsInFiveMinutes: 9,
        maxPostsInTenMinutes: 13,
        byMessageKind: {},
        repeatedStoryClusters: [
          {
            storyKey: "follow_through_update|breakdown|failed|1.24",
            messageKind: "follow_through_update",
            count: 8,
            firstTimestamp: 1000,
            lastTimestamp: 2000,
            latestDirectionalReturnPct: -1.2,
            latestRawReturnPct: 1.2,
          },
        ],
        dominantRisk: "repeated_story",
        recommendations: [],
        threadTrustScore: 20,
      },
    ],
  };
  const snapshotReport: SnapshotAuditReport = {
    generatedAt: "2026-04-28T00:00:00.000Z",
    sourceAuditPath: "session/discord-delivery-audit.jsonl",
    snapshots: [],
    perSymbol: [
      {
        symbol: "ATER",
        snapshotCount: 1,
        latestTimestamp: 3000,
        latestReferencePrice: 1.5,
        displayedSupportCount: 3,
        displayedResistanceCount: 4,
        omittedByReason: { outside_forward_range: 1 },
        compactedLevels: [],
        wrongSideLevels: [],
        outsideForwardRangeLevels: [2.5],
      },
    ],
  };

  const report = buildLongRunTuningSuggestionsReport({ policyReport, snapshotReport });
  assert.equal(report.summary.actionCount, 3);
  assert.deepEqual(report.summary.symbolsWithActionItems, ["ATER"]);
  assert.equal(report.suggestions[0]?.severity, "action");
  assert.equal(report.suggestions.some((suggestion) => suggestion.category === "level_audit"), true);
  assert.match(formatLongRunTuningSuggestionsMarkdown(report), /Long-Run Tuning Suggestions/);
  assert.match(formatLongRunTuningSuggestionsMarkdown(report), /ATER repeated follow_through_update/);
  assert.match(formatLongRunTuningSuggestionsMarkdown(report), /incompleteStoryMetadata: false/);
  assert.doesNotMatch(formatLongRunTuningSuggestionsMarkdown(report), /evidence: \{/);
});

test("long-run tuning suggestions do not action optional density on tiny samples", () => {
  const policyReport: ThreadPostPolicyReport = {
    generatedAt: "2026-04-28T00:00:00.000Z",
    sourceAuditPath: "session/discord-delivery-audit.jsonl",
    totals: {
      posted: 2,
      failed: 0,
      traderCritical: 0,
      traderHelpfulOptional: 2,
      operatorOnly: 0,
      repeatedStoryClusters: 0,
    },
    topFindings: [],
    perSymbol: [
      {
        symbol: "BIYA",
        posted: 2,
        failed: 0,
        traderCritical: 0,
        traderHelpfulOptional: 2,
        operatorOnly: 0,
        optionalDensity: 1,
        maxPostsInFiveMinutes: 2,
        maxPostsInTenMinutes: 2,
        byMessageKind: {},
        repeatedStoryClusters: [],
        dominantRisk: "controlled",
        recommendations: [],
        threadTrustScore: 100,
      },
    ],
  };
  const snapshotReport: SnapshotAuditReport = {
    generatedAt: "2026-04-28T00:00:00.000Z",
    sourceAuditPath: "session/discord-delivery-audit.jsonl",
    snapshots: [],
    perSymbol: [],
  };

  const report = buildLongRunTuningSuggestionsReport({ policyReport, snapshotReport });
  assert.equal(report.suggestions.some((suggestion) => suggestion.category === "optional_density"), false);
});
