import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildMarketStructureDeliveryAuditReport,
  buildMarketStructureDeliveryAuditReportFromRows,
  buildMarketStructureDeliveryAuditReportFromPaths,
  formatMarketStructureDeliveryAuditMarkdown,
  writeMarketStructureDeliveryAuditReport,
} from "../lib/review/market-structure-delivery-audit.js";
import type { RuntimeMarketStructureSnapshot } from "../lib/monitoring/monitoring-types.js";

function freshMarketStructure(): RuntimeMarketStructureSnapshot {
  return {
    timeframes: {
      "4h": {
        formal: {
          timeframe: "4h",
          bias: "bullish",
          previousBias: "range",
          eventType: "bos_bullish",
          eventFreshness: "fresh",
          triggerTimestamp: "2026-05-14T14:00:00.000Z",
          confirmation: "close_confirmed",
          confidence: "high",
          confidenceScore: 86,
          materialChange: true,
          brokenSwingPrice: 2.45,
          sweptSwingPrice: null,
          protectedHigh: 2.74,
          protectedLow: 2.16,
          latestHigh: 2.74,
          latestLow: 2.16,
          swingSequence: ["HL", "HH"],
          structureKey: "4h|bos_bullish|2.45",
          traderLine: "4h bullish BOS above 2.45",
          debug: {
            candleCount: 80,
            reasons: [],
          },
        },
      },
    },
  };
}

test("market structure delivery audit classifies carried, standalone, expired, and failed structure rows", () => {
  const rows = [
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1_000,
      symbol: "ABCD",
      title: "ABCD breakout",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      signalCategory: "breakout_reclaim_quality",
      marketStructureStoryVisible: true,
      marketStructureStoryReason: "pending_fresh_structure",
      marketStructureStoryKeys: ["4h|formal|4h|bos_bullish|2.45"],
      marketStructureStorySource: "intelligent_alert",
      marketStructure: freshMarketStructure(),
      whyPosted: "fresh level break",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2_000,
      symbol: "ABCD",
      title: "ABCD market structure update",
      messageKind: "market_structure_update",
      signalCategory: "market_structure",
      marketStructureStoryVisible: true,
      marketStructureStoryKeys: ["5m|formal|5m|choch_bearish|1.92"],
      marketStructureStoryReason: "current_material_structure",
      marketStructureStorySource: "standalone_structure_update",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "failed",
      timestamp: 3_000,
      symbol: "EFGH",
      title: "EFGH market structure update",
      messageKind: "market_structure_update",
      signalCategory: "market_structure",
      marketStructureStoryKeys: ["4h|formal|4h|choch_bearish|3.10"],
      error: "Discord rejected content",
    },
    {
      type: "manual_watchlist_lifecycle",
      event: "market_structure_story_expired",
      timestamp: 4_000,
      symbol: "IJKL",
      details: {
        storyKey: "5m|formal|5m|bos_bullish|0.72",
      },
    },
  ];

  const report = buildMarketStructureDeliveryAuditReportFromRows(rows, "memory");

  assert.equal(report.totals.structureEvents, 4);
  assert.equal(report.totals.posted, 2);
  assert.equal(report.totals.carriedByAlerts, 1);
  assert.equal(report.totals.standalonePosts, 1);
  assert.equal(report.totals.failedDeliveries, 1);
  assert.equal(report.totals.expiredUnposted, 1);
  assert.equal(report.symbols.find((item) => item.symbol === "ABCD")?.posted, 2);
  assert.equal(report.findings.some((finding) => finding.reason === "market_structure_delivery_failed"), true);
  assert.equal(report.findings.some((finding) => finding.reason === "fresh_structure_expired_unposted"), true);

  const markdown = formatMarketStructureDeliveryAuditMarkdown(report);
  assert.match(markdown, /Market Structure Delivery Audit/);
  assert.match(markdown, /ABCD: detected 2, posted 2/);
});

test("market structure delivery audit reads and writes report artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "structure-delivery-audit-"));
  const auditPath = join(directory, "discord-delivery-audit.jsonl");
  const jsonPath = join(directory, "market-structure-delivery-audit.json");
  const markdownPath = join(directory, "market-structure-delivery-audit.md");
  writeFileSync(
    auditPath,
    `${JSON.stringify({
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1_000,
      symbol: "ABCD",
      messageKind: "market_structure_update",
      signalCategory: "market_structure",
      marketStructureStoryVisible: true,
      marketStructureStoryKeys: ["4h|formal|4h|bos_bullish|2.45"],
    })}\n`,
  );

  const report = buildMarketStructureDeliveryAuditReport(auditPath);
  writeMarketStructureDeliveryAuditReport({ report, jsonPath, markdownPath });

  assert.match(readFileSync(markdownPath, "utf8"), /Standalone structure posts: 1/);
  assert.equal(JSON.parse(readFileSync(jsonPath, "utf8")).totals.standalonePosts, 1);
});

test("market structure delivery audit can combine Discord audit and lifecycle files", () => {
  const directory = mkdtempSync(join(tmpdir(), "structure-delivery-audit-combined-"));
  const auditPath = join(directory, "discord-delivery-audit.jsonl");
  const lifecyclePath = join(directory, "market-structure-lifecycle.jsonl");
  writeFileSync(
    auditPath,
    `${JSON.stringify({
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1_000,
      symbol: "ABCD",
      messageKind: "market_structure_update",
      signalCategory: "market_structure",
      marketStructureStoryVisible: true,
      marketStructureStoryKeys: ["4h|formal|4h|bos_bullish|2.45"],
    })}\n`,
  );
  writeFileSync(
    lifecyclePath,
    `${JSON.stringify({
      type: "manual_watchlist_lifecycle",
      event: "market_structure_story_expired",
      timestamp: 2_000,
      symbol: "ABCD",
      details: {
        storyKey: "5m|formal|5m|choch_bearish|1.92",
      },
    })}\n`,
  );

  const report = buildMarketStructureDeliveryAuditReportFromPaths([auditPath, lifecyclePath]);

  assert.equal(report.totals.structureEvents, 2);
  assert.equal(report.totals.standalonePosts, 1);
  assert.equal(report.totals.expiredUnposted, 1);
});
