import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildMarketStructureOutcomeCalibrationReport,
  formatMarketStructureOutcomeCalibrationMarkdown,
  writeMarketStructureOutcomeCalibrationReport,
} from "../lib/review/market-structure-outcome-calibration.js";

test("market structure outcome calibration scores BOS continuation from later audit prices", () => {
  const directory = mkdtempSync(join(tmpdir(), "structure-outcome-calibration-"));
  const auditPath = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(
    auditPath,
    [
      {
        type: "discord_delivery_audit",
        operation: "post_alert",
        status: "posted",
        timestamp: 1_000,
        symbol: "ABCD",
        title: "ABCD market structure update",
        messageKind: "market_structure_update",
        marketStructureStoryKeys: ["4h|formal|4h|bos_bullish|2.45"],
        selectedFormalStructureTimeframe: "4h",
        selectedFormalStructureEventType: "bos_bullish",
        selectedFormalStructureEventFreshness: "fresh",
        selectedFormalStructureMaterialChange: true,
        selectedFormalStructureBrokenSwingPrice: 2.45,
        selectedFormalStructureKey: "4h|bos_bullish|2.45",
      },
      {
        type: "discord_delivery_audit",
        operation: "post_alert",
        status: "posted",
        timestamp: 2_000,
        symbol: "ABCD",
        title: "ABCD repeated market structure update",
        messageKind: "market_structure_update",
        marketStructureStoryKeys: ["4h|formal|4h|bos_bullish|2.45"],
      },
      {
        type: "discord_delivery_audit",
        operation: "post_level_snapshot",
        status: "posted",
        timestamp: 10 * 60 * 1000,
        symbol: "ABCD",
        snapshotAudit: {
          referencePrice: 2.53,
        },
      },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n",
  );

  const report = buildMarketStructureOutcomeCalibrationReport({
    auditPath,
    forwardWindowMinutes: 30,
    continuationThresholdPct: 1,
    failureThresholdPct: 1,
  });
  const markdown = formatMarketStructureOutcomeCalibrationMarkdown(report);

  assert.equal(report.totals.structureEvents, 1);
  assert.equal(report.totals.continued, 1);
  assert.equal(report.events[0]?.maxFavorablePct, 3.27);
  assert.match(markdown, /Market Structure Outcome Calibration/);
  assert.match(markdown, /ABCD/);
});

test("market structure outcome calibration writer creates artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "structure-outcome-calibration-write-"));
  const auditPath = join(directory, "discord-delivery-audit.jsonl");
  const jsonPath = join(directory, "out", "market-structure-outcome-calibration.json");
  const markdownPath = join(directory, "out", "market-structure-outcome-calibration.md");
  writeFileSync(
    auditPath,
    `${JSON.stringify({
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1_000,
      symbol: "EFGH",
      messageKind: "market_structure_update",
      marketStructureStoryKeys: ["5m|formal|5m|choch_bearish|1.92"],
    })}\n`,
  );

  const report = buildMarketStructureOutcomeCalibrationReport({ auditPath });
  writeMarketStructureOutcomeCalibrationReport({ report, jsonPath, markdownPath });

  assert.equal(report.totals.insufficientPriceEvidence, 1);
  assert.ok(existsSync(jsonPath));
  assert.match(readFileSync(markdownPath, "utf8"), /Insufficient price evidence: 1/);
});
