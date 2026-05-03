import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildTraderUsefulnessReplayReport,
  writeTraderUsefulnessReplayReport,
} from "../lib/review/trader-usefulness-replay-score.js";

function writeAudit(rows: object[]): string {
  const directory = mkdtempSync(join(tmpdir(), "trader-usefulness-"));
  const path = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n"));
  return path;
}

test("trader usefulness replay scores repeated chop and missing context", () => {
  const auditPath = writeAudit([
    {
      operation: "post_alert",
      status: "posted",
      timestamp: 1000,
      symbol: "CYCU",
      title: "CYCU support and resistance",
      messageKind: "snapshot",
      supportCount: 5,
      resistanceCount: 5,
      body: "Resistance above 1.06. Support below 0.98.",
    },
    {
      operation: "post_alert",
      status: "posted",
      timestamp: 2000,
      symbol: "CYCU",
      title: "CYCU level touch",
      messageKind: "intelligent_alert",
      eventType: "level_touch",
      triggerPrice: 1.01,
      rangeBoxLabel: "active",
      acceptanceLabel: "testing",
      behaviorBudgetLabel: "boring_range",
      failedLevelOutcome: "testing",
      levelImportanceLabel: "useful_reference",
      practicalZoneKey: "1.00-1.02",
      body: "price is testing resistance again",
    },
    {
      operation: "post_alert",
      status: "posted",
      timestamp: 3000,
      symbol: "CYCU",
      title: "CYCU level touch",
      messageKind: "intelligent_alert",
      eventType: "level_touch",
      triggerPrice: 1.01,
      rangeBoxLabel: "active",
      acceptanceLabel: "testing",
      behaviorBudgetLabel: "boring_range",
      failedLevelOutcome: "testing",
      levelImportanceLabel: "useful_reference",
      practicalZoneKey: "1.00-1.02",
      body: "price is testing resistance again",
    },
    {
      operation: "post_alert",
      status: "posted",
      timestamp: 4000,
      symbol: "CUE",
      title: "CUE resistance crossed",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      triggerPrice: 35.98,
      noLevelReason: "no_resistance_above",
      body: "Resistance above: none currently surfaced",
    },
  ]);

  const report = buildTraderUsefulnessReplayReport(auditPath);
  const cycu = report.symbols.find((symbol) => symbol.symbol === "CYCU");
  const cue = report.symbols.find((symbol) => symbol.symbol === "CUE");

  assert.ok(cycu);
  assert.equal(cycu.repeatNoiseCount, 1);
  assert.equal(cycu.ladderConfidence, "strong");
  assert.ok(cycu.replayScore < 100);
  assert.ok(cue);
  assert.equal(cue.missingContextCount, 1);
  assert.equal(cue.ladderConfidence, "degraded");
});

test("trader usefulness replay writes json and markdown evidence", () => {
  const auditPath = writeAudit([
    {
      operation: "post_alert",
      status: "posted",
      timestamp: 1000,
      symbol: "AKAN",
      title: "AKAN breakout",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      triggerPrice: 40.3,
      acceptanceLabel: "accepted",
      levelImportanceLabel: "major_decision",
      body: "price is above resistance and the next resistance is 47.25",
    },
  ]);
  const directory = mkdtempSync(join(tmpdir(), "trader-usefulness-output-"));
  const jsonPath = join(directory, "score.json");
  const markdownPath = join(directory, "score.md");

  const report = writeTraderUsefulnessReplayReport({ auditPath, jsonPath, markdownPath });
  const markdown = readFileSync(markdownPath, "utf8");

  assert.equal(report.symbols[0]?.symbol, "AKAN");
  assert.match(markdown, /Trader Usefulness Replay Score/);
  assert.match(markdown, /personality:/);
  assert.match(readFileSync(jsonPath, "utf8"), /usefulChangeCount/);
});
