import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildFormalMarketStructureGateAuditReport,
  formatFormalMarketStructureGateAuditMarkdown,
  writeFormalMarketStructureGateAuditReport,
} from "../lib/review/formal-market-structure-gate-audit.js";

function formal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timeframe: "5m",
    bias: "bullish_transition",
    previousBias: "range",
    eventType: "bos_bullish",
    eventFreshness: "fresh",
    triggerTimestamp: "2026-06-17T14:00:00.000Z",
    confirmation: "close_confirmed",
    confidence: "medium",
    confidenceScore: 0.64,
    materialChange: true,
    brokenSwingPrice: 2.1,
    sweptSwingPrice: null,
    protectedHigh: 2.2,
    protectedLow: 1.9,
    latestHigh: 2.2,
    latestLow: 1.9,
    swingSequence: ["HL", "HH"],
    structureKey: "5m|bos_bullish|2.10",
    traderLine: "5m structure printed bullish BOS above 2.10.",
    debug: { candleCount: 40, reasons: [] },
    ...overrides,
  };
}

test("formal market structure gate audit classifies tactical events through the quality gate", () => {
  const directory = mkdtempSync(join(tmpdir(), "formal-structure-gate-"));
  const auditPath = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(
    auditPath,
    [
      {
        type: "discord_delivery_audit",
        operation: "post_alert",
        status: "posted",
        timestamp: 1_000,
        symbol: "CLWT",
        title: "CLWT market structure update",
        marketStructureStoryVisible: true,
        marketStructureStoryKeys: ["5m|formal|5m|bos_bullish|2.10"],
        marketStructure: {
          timeframes: {
            "5m": {
              formal: formal(),
            },
          },
        },
      },
      {
        type: "discord_delivery_audit",
        operation: "post_alert",
        status: "posted",
        timestamp: 2_000,
        symbol: "SOFI",
        title: "SOFI market structure update",
        marketStructureStoryVisible: true,
        marketStructure: {
          timeframes: {
            "5m": {
              formal: formal({
                confidence: "high",
                confidenceScore: 0.9,
                structureKey: "5m|bos_bullish|18.59",
              }),
              stable: {
                state: "breakout_holding",
                previousState: "range_bound",
                structureKey: "breakout_holding|low:18.00|high:19.00",
                materialChange: true,
                confidence: "high",
                materialityScore: 0.9,
                rawState: "breakout_holding",
                reason: "high_materiality_change",
                candleCount: 40,
              },
            },
          },
        },
      },
      {
        type: "discord_delivery_audit",
        operation: "post_alert",
        status: "posted",
        timestamp: 3_000,
        symbol: "FTHM",
        title: "FTHM market structure update",
        marketStructureStoryVisible: true,
        marketStructure: {
          timeframes: {
            "4h": {
              formal: formal({
                timeframe: "4h",
                confidence: "medium",
                structureKey: "4h|bos_bullish|0.6992",
              }),
            },
          },
        },
      },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n",
  );

  const report = buildFormalMarketStructureGateAuditReport(auditPath);
  const markdown = formatFormalMarketStructureGateAuditMarkdown(report);

  assert.equal(report.totals.formalBosChochEvents, 3);
  assert.equal(report.totals.actionable, 1);
  assert.equal(report.totals.metadataOnly, 2);
  assert.equal(report.totals.newlyQuieted, 2);
  assert.equal(report.events.find((event) => event.symbol === "CLWT")?.decision, "metadata_only");
  assert.equal(report.events.find((event) => event.symbol === "SOFI")?.gateReason, "tactical_5m_without_stable_confirmation");
  assert.equal(report.events.find((event) => event.symbol === "FTHM")?.gateReason, "higher_timeframe_formal");
  assert.match(markdown, /newly quieted by gate: 2/i);
});

test("formal market structure gate audit writer creates artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "formal-structure-gate-write-"));
  const auditPath = join(directory, "discord-delivery-audit.jsonl");
  const jsonPath = join(directory, "out", "formal-market-structure-gate-audit.json");
  const markdownPath = join(directory, "out", "formal-market-structure-gate-audit.md");
  writeFileSync(
    auditPath,
    `${JSON.stringify({
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1_000,
      symbol: "ABCD",
      marketStructure: {
        timeframes: {
          "5m": {
            formal: formal({ confidence: "high" }),
          },
        },
      },
    })}\n`,
  );

  const report = buildFormalMarketStructureGateAuditReport(auditPath);
  writeFormalMarketStructureGateAuditReport({ report, jsonPath, markdownPath });

  assert.ok(existsSync(jsonPath));
  assert.match(readFileSync(markdownPath, "utf8"), /Formal Market Structure Gate Audit/);
});
