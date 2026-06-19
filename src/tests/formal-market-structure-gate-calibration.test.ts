import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildFormalMarketStructureGateCalibrationReport,
  formatFormalMarketStructureGateCalibrationMarkdown,
  writeFormalMarketStructureGateCalibrationReport,
} from "../lib/review/formal-market-structure-gate-calibration.js";

function formal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timeframe: "4h",
    bias: "bullish_transition",
    previousBias: "range",
    eventType: "bos_bullish",
    eventFreshness: "fresh",
    triggerTimestamp: "2026-06-17T14:00:00.000Z",
    confirmation: "close_confirmed",
    confidence: "medium",
    confidenceScore: 0.72,
    materialChange: true,
    brokenSwingPrice: 2,
    sweptSwingPrice: null,
    protectedHigh: 2.2,
    protectedLow: 1.9,
    latestHigh: 2.2,
    latestLow: 1.9,
    swingSequence: ["HL", "HH"],
    structureKey: "4h|bos_bullish|2.00",
    traderLine: "4h structure printed bullish BOS above 2.00.",
    debug: { candleCount: 40, reasons: [] },
    ...overrides,
  };
}

function writeSession(root: string, name: string, rows: Record<string, unknown>[]): void {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "discord-delivery-audit.jsonl"),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
}

test("formal market structure gate calibration aggregates gate decisions with outcomes", () => {
  const root = mkdtempSync(join(tmpdir(), "formal-gate-calibration-"));
  writeSession(root, "session-a", [
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1_000,
      symbol: "HTF",
      title: "HTF market structure update",
      marketStructureStoryVisible: true,
      marketStructureStoryKeys: ["4h|formal|4h|bos_bullish|2.00"],
      marketStructure: {
        timeframes: {
          "4h": {
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
      symbol: "HTF",
      title: "HTF follow-through",
      snapshotAudit: {
        referencePrice: 2.08,
      },
    },
  ]);
  writeSession(root, "session-b", [
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1_000,
      symbol: "FIVE",
      title: "FIVE market structure update",
      marketStructureStoryVisible: true,
      marketStructureStoryKeys: ["5m|formal|5m|bos_bullish|3.00"],
      marketStructure: {
        timeframes: {
          "5m": {
            formal: formal({
              timeframe: "5m",
              confidence: "high",
              confidenceScore: 0.9,
              brokenSwingPrice: 3,
              structureKey: "5m|bos_bullish|3.00",
            }),
          },
        },
      },
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2_000,
      symbol: "FIVE",
      title: "FIVE follow-through",
      snapshotAudit: {
        referencePrice: 2.94,
      },
    },
  ]);

  const report = buildFormalMarketStructureGateCalibrationReport({
    sourceRoot: root,
    limit: null,
    forwardWindowMinutes: 90,
  });
  const markdown = formatFormalMarketStructureGateCalibrationMarkdown(report);

  assert.equal(report.auditCount, 2);
  assert.equal(report.totals.formalBosChochEvents, 2);
  assert.equal(report.totals.actionable, 1);
  assert.equal(report.totals.metadataOnly, 1);
  assert.equal(report.byDecision.find((bucket) => bucket.key === "actionable")?.continued, 1);
  assert.equal(report.byDecision.find((bucket) => bucket.key === "metadata_only")?.failed, 1);
  assert.equal(report.byReason.find((bucket) => bucket.key === "higher_timeframe_formal")?.events, 1);
  assert.equal(report.byReason.find((bucket) => bucket.key === "tactical_5m_metadata_only")?.events, 1);
  assert.match(markdown, /By Gate Reason/);
});

test("formal market structure gate calibration writer creates artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "formal-gate-calibration-write-"));
  writeSession(root, "session-a", [
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1_000,
      symbol: "HTF",
      marketStructure: {
        timeframes: {
          "4h": {
            formal: formal(),
          },
        },
      },
    },
  ]);

  const report = buildFormalMarketStructureGateCalibrationReport({ sourceRoot: root, limit: null });
  const jsonPath = join(root, "out", "formal-market-structure-gate-calibration.json");
  const markdownPath = join(root, "out", "formal-market-structure-gate-calibration.md");
  writeFormalMarketStructureGateCalibrationReport({ report, jsonPath, markdownPath });

  assert.ok(existsSync(jsonPath));
  assert.match(readFileSync(markdownPath, "utf8"), /Formal Market Structure Gate Calibration/);
});
