import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildLivePostReplaySimulationReport,
  buildRunnerStoryReport,
  formatLivePostReplaySimulationMarkdown,
  formatRunnerStoryMarkdown,
} from "../lib/review/live-post-replay-simulator.js";

function writeAudit(lines: unknown[]): string {
  const directory = join(tmpdir(), `live-post-replay-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  return path;
}

test("live post replay simulator estimates calmer follow-through output", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1000,
      symbol: "ATER",
      messageKind: "follow_through_update",
      eventType: "breakdown",
      followThroughLabel: "failed",
      targetPrice: 1.24,
      directionalReturnPct: -1,
      rawReturnPct: 1,
      title: "ATER breakdown follow-through",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 400000,
      symbol: "ATER",
      messageKind: "follow_through_update",
      eventType: "breakdown",
      followThroughLabel: "failed",
      targetPrice: 1.24,
      directionalReturnPct: -1.3,
      rawReturnPct: 1.3,
      title: "ATER breakdown follow-through",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 800000,
      symbol: "ATER",
      messageKind: "follow_through_update",
      eventType: "breakdown",
      followThroughLabel: "failed",
      targetPrice: 1.24,
      directionalReturnPct: -3.2,
      rawReturnPct: 3.2,
      title: "ATER breakdown follow-through",
    },
  ]);

  const report = buildLivePostReplaySimulationReport(auditPath);
  assert.equal(report.totals.originalPosted, 3);
  assert.equal(report.totals.simulatedPosted, 2);
  assert.equal(report.perSymbol[0]?.suppressedByReason.follow_through_not_materially_new, 1);
  assert.match(formatLivePostReplaySimulationMarkdown(report), /ATER/);
  assert.match(formatLivePostReplaySimulationMarkdown(report), /3 -> 2/);
});

test("runner story report classifies noisy posts and flags candidate missed clears", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 1000,
      symbol: "ATER",
      body: [
        "ATER support and resistance",
        "Price: 1.00",
        "Resistance: 1.06 (+6.0%, moderate), 1.24 (+24.0%, heavy)",
        "Support: 0.95 (-5.0%, moderate)",
      ].join("\n"),
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2000,
      symbol: "ATER",
      messageKind: "follow_through_update",
      eventType: "breakout",
      followThroughLabel: "working",
      targetPrice: 1.06,
      directionalReturnPct: 0.2,
      rawReturnPct: 0.2,
      title: "ATER breakout follow-through",
      body: "Path:\n1.06 -> 1.06",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 3000,
      symbol: "ATER",
      messageKind: "follow_through_update",
      eventType: "breakout",
      followThroughLabel: "working",
      targetPrice: 1.06,
      directionalReturnPct: 0.3,
      rawReturnPct: 0.3,
      title: "ATER breakout follow-through",
      body: "Path:\n1.06 -> 1.07",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 4000,
      symbol: "ATER",
      body: [
        "ATER support and resistance",
        "Price: 1.25",
        "Resistance: 1.30 (+4.0%, moderate)",
        "Support: 1.24 (-0.8%, heavy), 1.06 (-15.2%, moderate)",
      ].join("\n"),
    },
  ]);

  const report = buildRunnerStoryReport(auditPath, ["ATER"]);
  const symbol = report.symbols[0];
  assert.equal(symbol?.symbol, "ATER");
  assert.equal(symbol.qualitySummary.noisyRepeat, 2);
  assert.equal(symbol.missingEventCandidates[0]?.side, "resistance");
  assert.equal(symbol.missingEventCandidates[0]?.level, 1.06);
  assert.match(formatRunnerStoryMarkdown(report), /Missing Event Candidates/);
  assert.match(formatRunnerStoryMarkdown(report), /Tuning Suggestions/);
});
