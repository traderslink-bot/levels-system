import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildTraderPostQualityReport,
  renderTraderPostQualityMarkdown,
} from "../lib/review/trader-post-quality-grader.js";

function writeAudit(rows: unknown[]): string {
  const tempDir = mkdtempSync(join(tmpdir(), "trader-post-quality-"));
  const auditPath = join(tempDir, "discord-delivery-audit.jsonl");
  writeFileSync(auditPath, rows.map((row) => JSON.stringify(row)).join("\n"));
  return auditPath;
}

test("trader post quality grader flags system language, advice, tiny risk, and missing-level claims", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1000,
      symbol: "CYCU",
      title: "CYCU breakdown",
      messageKind: "intelligent_alert",
      eventType: "breakdown",
      body: [
        "Status: Cleared",
        "Traders should wait for the best entry.",
        "below 1.01, risk stays open toward 1.00",
        "Resistance above: none currently surfaced",
      ].join("\n"),
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2000,
      symbol: "AKAN",
      title: "AKAN support and resistance",
      messageKind: "level_snapshot",
      body: "Current structure: AKAN is pressing heavy resistance 40.00.\nCleaner above: acceptance above heavy resistance 40.00 would put the next resistance area at moderate resistance 47.25.",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 3000,
      symbol: "CUE",
      title: "CUE resistance crossed",
      messageKind: "level_clear_update",
      eventType: "breakout",
      body: "price pushed above 35.98\nOld resistance is being tested as support.",
      noLevelReason: "higher resistance not available in active snapshot or extension cache",
    },
  ]);

  const report = buildTraderPostQualityReport(auditPath);
  assert.equal(report.totals.posted, 3);
  assert.ok(report.totals.blocker >= 1);
  assert.ok(report.totals.major >= 1);
  assert.ok(report.totals.missingLevelClaims >= 1);
  assert.ok(report.totals.tinyMoveRiskWarnings >= 1);
  assert.ok(report.findings.some((finding) => finding.category === "direct_advice"));
  assert.ok(report.findings.some((finding) => finding.category === "system_language"));
  assert.ok(report.findings.some((finding) => finding.category === "tiny_move_risk_language"));
  assert.ok(report.findings.some((finding) => finding.category === "missing_level_claim"));
  assert.ok(report.findings.some((finding) => finding.severity === "data_quality_only" && finding.symbol === "CUE"));
  assert.ok(report.findings.some((finding) => finding.category === "clean_example" && finding.symbol === "AKAN"));

  const markdown = renderTraderPostQualityMarkdown(report);
  assert.match(markdown, /Trader Post Quality Grader/);
  assert.match(markdown, /tiny_move_risk_language/);
  assert.match(markdown, /missing-level claims: 2/);
});

test("trader post quality grader surfaces repeated-story overlap samples", () => {
  const base = {
    type: "discord_delivery_audit",
    operation: "post_alert",
    status: "posted",
    symbol: "PBM",
    title: "PBM resistance crossed",
    messageKind: "level_clear_update",
    eventType: "breakout",
    body: "price pushed above 5.33; nearby resistance above is moderate resistance 5.80\nOld resistance is being tested as support.",
  };
  const auditPath = writeAudit([
    { ...base, timestamp: 1000 },
    { ...base, timestamp: 2000, body: String(base.body).replaceAll("5.33", "5.34") },
    { ...base, timestamp: 3000, body: String(base.body).replaceAll("5.33", "5.35") },
  ]);

  const report = buildTraderPostQualityReport(auditPath);
  assert.equal(report.totals.repeatedStoryClusters, 1);
  assert.ok(report.findings.some((finding) => finding.category === "repeat_overlap"));
});
