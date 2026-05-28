import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildSnapshotAuditReport,
  buildThreadPostPolicyReport,
  buildTradingDayEvidenceReport,
  formatSnapshotAuditMarkdown,
  formatThreadPostPolicyMarkdown,
  formatTradingDayEvidenceMarkdown,
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

test("trading day evidence report surfaces delivery, role-flip, cluster, and language proof", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "discord-audit-evidence-"));
  const auditPath = join(tempDir, "discord-delivery-audit.jsonl");
  const rows = [
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "failed",
      timestamp: 1000,
      symbol: "SEGG",
      title: "SEGG breakdown",
      messageKind: "intelligent_alert",
      eventType: "breakdown",
      targetSide: "support",
      targetPrice: 1.2,
      error: "Discord API 503",
      body: "support lost at 1.20",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2000,
      symbol: "XTLB",
      title: "XTLB support crossed lower",
      messageKind: "level_clear_update",
      eventType: "breakdown",
      targetSide: "support",
      targetPrice: 3.56,
      body: "price slipped below 3.56; next support is 3.34\nreclaiming 3.56 is needed to repair the level",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2500,
      symbol: "SEGG",
      title: "SEGG breakout",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      deliveryLagMs: 360_000,
      sendDurationMs: 355_000,
      volumeActivityLabel: "expanding",
      volumeActivityReliability: "reliable",
      volumeActivityRatio: 1.5,
      volumeActivityDirection: "increasing",
      volumeActivityShown: true,
      practicalStructureState: "breakout_attempt",
      practicalStructureKey: "breakout_attempt|support:3.20-3.34|resistance:3.75-3.75",
      practicalZoneKey: "support:3.20-3.34|resistance:3.75-3.75",
      practicalStructureMaterialChange: true,
      body: "bullish breakout through resistance; buyers need acceptance above resistance",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 3000,
      symbol: "XTLB",
      title: "XTLB resistance crossed",
      messageKind: "level_clear_update",
      eventType: "breakout",
      targetSide: "resistance",
      targetPrice: 3.75,
      volumeActivityLabel: "unknown",
      volumeActivityReliability: "unreliable",
      volumeActivityShown: false,
      volumeActivitySuppressedReason: "live volume moved backward or reset",
      practicalStructureState: "range_bound",
      practicalStructureKey: "range_bound|support:3.34-3.56|resistance:3.75-3.84",
      practicalZoneKey: "support:3.34-3.56|resistance:3.75-3.84",
      body: "price cleared 3.75 and is moving toward 4.28\nStatus: Cleared\n3.75 is no longer immediate resistance",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 3500,
      symbol: "XTLB",
      title: "XTLB resistance crossed",
      messageKind: "level_clear_update",
      eventType: "breakout",
      targetSide: "resistance",
      targetPrice: 3.8,
      body: "price pushed above 3.80; next resistance is 3.84",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 4000,
      symbol: "XTLB",
      title: "XTLB resistance crossed",
      messageKind: "level_clear_update",
      eventType: "breakout",
      targetSide: "resistance",
      targetPrice: 3.84,
      body: "buyers need acceptance above 3.84 before the setup improves",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 5000,
      symbol: "ATER",
      title: "ATER current read",
      messageKind: "ai_signal_commentary",
      eventType: "breakout",
      body: "Longs should wait for 1.24 before entering.",
    },
  ];
  writeFileSync(auditPath, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");

  const report = buildTradingDayEvidenceReport(auditPath);

  assert.equal(report.criticalDeliveryFailures.length, 1);
  assert.equal(report.criticalDeliveryFailures[0]?.severity, "major");
  assert.equal(report.criticalDeliveryFailures[0]?.traderCritical, true);
  assert.equal(report.staleCriticalDeliveries.length, 1);
  assert.equal(report.staleCriticalDeliveries[0]?.symbol, "SEGG");
  assert.equal(report.staleCriticalDeliveries[0]?.severity, "major");

  assert.equal(
    report.roleFlipCandidates.some((candidate) => candidate.scenario === "broken_support_as_resistance"),
    true,
  );
  assert.equal(
    report.roleFlipCandidates.some((candidate) => candidate.scenario === "false_clear_certainty"),
    true,
  );

  const cluster = report.clusterCrossCandidates.find((candidate) => candidate.symbol === "XTLB");
  assert.ok(cluster);
  assert.equal(cluster.severity, "major");
  assert.deepEqual(cluster.levels, [3.75, 3.8, 3.84]);
  assert.equal(cluster.preferClusterStory, true);

  assert.equal(report.traderLanguageEvidence.badHistoricalExamples.length > 0, true);
  assert.equal(report.traderLanguageEvidence.borderlineAdviceExamples.length, 1);
  assert.deepEqual(report.volumeActivityEvidence.reliableSymbols, ["SEGG"]);
  assert.deepEqual(report.volumeActivityEvidence.unreliableSymbols, ["XTLB"]);
  assert.equal(report.volumeActivityEvidence.shownExamples.length, 1);
  assert.equal(report.volumeActivityEvidence.suppressedExamples.length, 1);
  assert.equal(report.practicalStructureEvidence.statesBySymbol[0]?.symbol, "SEGG");
  assert.equal(report.practicalStructureEvidence.materialChangeExamples.length, 1);
  assert.equal(report.practicalStructureEvidence.rangeBoundExamples.length, 1);

  const markdown = formatTradingDayEvidenceMarkdown(report);
  assert.match(markdown, /Critical Delivery Failures/);
  assert.match(markdown, /Stale Critical Deliveries/);
  assert.match(markdown, /Cluster-Cross Candidates/);
  assert.match(markdown, /Longs should wait/);
  assert.match(markdown, /Volume \/ Activity Evidence/);
  assert.match(markdown, /live volume moved backward or reset/);
  assert.match(markdown, /Practical Structure Evidence/);
  assert.match(markdown, /breakout_attempt/);
});

test("trading day evidence report treats retried trader-critical failures as proven watch items", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "discord-audit-evidence-retry-"));
  const auditPath = join(tempDir, "discord-delivery-audit.jsonl");
  const rows = [
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "failed",
      timestamp: 1000,
      symbol: "SEGG",
      title: "SEGG resistance crossed",
      messageKind: "level_clear_update",
      eventType: "breakout",
      targetSide: "resistance",
      targetPrice: 1.52,
      error: "Discord API 503",
      body: "price pushed above 1.52",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1500,
      symbol: "SEGG",
      title: "SEGG resistance crossed",
      messageKind: "level_clear_update",
      eventType: "breakout",
      targetSide: "resistance",
      targetPrice: 1.52,
      retryAttempt: 1,
      retryOf: 1000,
      retryReason: "Discord API 503",
      body: "price pushed above 1.52",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2000,
      symbol: "SEGG",
      title: "SEGG resistance cluster crossed",
      messageKind: "level_clear_update",
      eventType: "breakout",
      targetSide: "resistance",
      targetPrice: 1.54,
      crossedLevels: [1.52, 1.54],
      clusteredLevelClear: true,
      body: "price pushed through nearby resistance cluster 1.52-1.54",
    },
  ];
  writeFileSync(auditPath, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");

  const report = buildTradingDayEvidenceReport(auditPath);

  assert.equal(report.criticalDeliveryFailures.length, 1);
  assert.equal(report.criticalDeliveryFailures[0]?.retryProven, true);
  assert.equal(report.criticalDeliveryFailures[0]?.severity, "watch");
  assert.equal(report.clusterCrossCandidates.length, 0);
});
