import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildSnapshotAuditReport,
  buildThreadPostPolicyReport,
  formatSnapshotAuditMarkdown,
  formatThreadPostPolicyMarkdown,
} from "../lib/review/discord-audit-reports.js";

test("discord audit reports identify repeated stories and snapshot omissions", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "discord-audit-report-"));
  const auditPath = join(tempDir, "discord-delivery-audit.jsonl");
  const rows = [
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1000,
      symbol: "ATER",
      title: "ATER breakdown follow-through",
      messageKind: "follow_through_update",
      eventType: "breakdown",
      followThroughLabel: "failed",
      targetPrice: 1.23,
      directionalReturnPct: -0.8,
      rawReturnPct: 0.8,
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2000,
      symbol: "ATER",
      title: "ATER breakdown follow-through",
      messageKind: "follow_through_update",
      eventType: "breakdown",
      followThroughLabel: "failed",
      targetPrice: 1.23,
      directionalReturnPct: -0.9,
      rawReturnPct: 0.9,
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 3000,
      symbol: "ATER",
      title: "ATER breakdown follow-through",
      messageKind: "follow_through_update",
      eventType: "breakdown",
      followThroughLabel: "failed",
      targetPrice: 1.23,
      directionalReturnPct: -1,
      rawReturnPct: 1,
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 4000,
      symbol: "ATER",
      title: "ATER AI read",
      messageKind: "ai_signal_commentary",
      eventType: "breakdown",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 5000,
      symbol: "ATER",
      snapshotAudit: {
        referencePrice: 1.53,
        displayTolerance: 0.01,
        forwardResistanceLimit: 2.295,
        displayedSupportIds: ["S1"],
        displayedResistanceIds: ["R1"],
        omittedSupportCount: 1,
        omittedResistanceCount: 2,
        omittedSupportLevels: [
          {
            id: "S2",
            side: "support",
            bucket: "surfaced",
            representativePrice: 1.51,
            zoneLow: 1.5,
            zoneHigh: 1.52,
            strengthLabel: "moderate",
            strengthScore: 1,
            confluenceCount: 1,
            sourceEvidenceCount: 1,
            timeframeBias: "5m",
            timeframeSources: ["5m"],
            sourceTypes: ["swing_low"],
            freshness: "fresh",
            isExtension: false,
            displayed: false,
            omittedReason: "compacted",
          },
        ],
        omittedResistanceLevels: [
          {
            id: "R2",
            side: "resistance",
            bucket: "surfaced",
            representativePrice: 1.54,
            zoneLow: 1.53,
            zoneHigh: 1.55,
            strengthLabel: "moderate",
            strengthScore: 1,
            confluenceCount: 1,
            sourceEvidenceCount: 1,
            timeframeBias: "5m",
            timeframeSources: ["5m"],
            sourceTypes: ["swing_high"],
            freshness: "fresh",
            isExtension: false,
            displayed: false,
            omittedReason: "wrong_side",
          },
          {
            id: "R3",
            side: "resistance",
            bucket: "extension",
            representativePrice: 2.5,
            zoneLow: 2.48,
            zoneHigh: 2.52,
            strengthLabel: "major",
            strengthScore: 3,
            confluenceCount: 2,
            sourceEvidenceCount: 2,
            timeframeBias: "daily",
            timeframeSources: ["daily"],
            sourceTypes: ["swing_high"],
            freshness: "aging",
            isExtension: true,
            displayed: false,
            omittedReason: "outside_forward_range",
          },
        ],
      },
    },
  ];
  writeFileSync(auditPath, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");

  const policyReport = buildThreadPostPolicyReport(auditPath);
  const aterPolicy = policyReport.perSymbol.find((entry) => entry.symbol === "ATER");
  assert.equal(policyReport.totals.repeatedStoryClusters, 1);
  assert.match(policyReport.topFindings[0] ?? "", /ATER/);
  assert.equal(aterPolicy?.repeatedStoryClusters[0]?.count, 3);
  assert.equal(aterPolicy?.dominantRisk, "repeated_story");
  assert.equal(aterPolicy?.optionalDensity, 0.2);
  assert.equal(aterPolicy?.maxPostsInFiveMinutes, 5);
  assert.equal(aterPolicy?.maxPostsInTenMinutes, 5);
  assert.equal(aterPolicy?.threadTrustScore, 96);
  assert.match(aterPolicy?.recommendations[0] ?? "", /follow_through_update/);
  assert.match(formatThreadPostPolicyMarkdown(policyReport), /Thread Post Policy Report/);
  assert.match(formatThreadPostPolicyMarkdown(policyReport), /ATER/);

  const snapshotReport = buildSnapshotAuditReport(auditPath);
  const aterSnapshot = snapshotReport.perSymbol.find((entry) => entry.symbol === "ATER");
  assert.equal(aterSnapshot?.omittedByReason.compacted, 1);
  assert.equal(aterSnapshot?.omittedByReason.wrong_side, 1);
  assert.equal(aterSnapshot?.omittedByReason.outside_forward_range, 1);
  assert.deepEqual(aterSnapshot?.outsideForwardRangeLevels, [2.5]);
  assert.match(formatSnapshotAuditMarkdown(snapshotReport), /outside forward range levels: 2.50/);
});

test("discord audit report ignores optional density on tiny samples", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "discord-audit-report-small-"));
  const auditPath = join(tempDir, "discord-delivery-audit.jsonl");
  const rows = [
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1000,
      symbol: "BIYA",
      title: "BIYA setup update",
      messageKind: "follow_through_state_update",
      eventType: "compression",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2000,
      symbol: "BIYA",
      title: "BIYA AI read",
      messageKind: "ai_signal_commentary",
      eventType: "breakout",
    },
  ];
  writeFileSync(auditPath, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");

  const policyReport = buildThreadPostPolicyReport(auditPath);
  const biyaPolicy = policyReport.perSymbol.find((entry) => entry.symbol === "BIYA");
  assert.equal(biyaPolicy?.optionalDensity, 1);
  assert.equal(biyaPolicy?.dominantRisk, "controlled");
  assert.equal(biyaPolicy?.threadTrustScore, 100);
});
