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

test("live post replay simulator parses older tracked-from follow-through wording", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1000,
      symbol: "AUUD",
      messageKind: "follow_through_update",
      eventType: "breakdown",
      followThroughLabel: "failed",
      directionalReturnPct: -1.5,
      rawReturnPct: 1.5,
      title: "AUUD breakdown follow-through",
      bodyPreview: "follow-through failed | path: tracked from 6.55 to 6.45",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 400000,
      symbol: "AUUD",
      messageKind: "follow_through_update",
      eventType: "breakdown",
      followThroughLabel: "failed",
      directionalReturnPct: -1.6,
      rawReturnPct: 1.6,
      title: "AUUD breakdown follow-through",
      bodyPreview: "follow-through failed | path: tracked from 6.55 to 6.44",
    },
  ]);

  const report = buildLivePostReplaySimulationReport(auditPath);
  assert.equal(report.totals.originalPosted, 2);
  assert.equal(report.totals.simulatedPosted, 0);
  assert.equal(report.perSymbol[0]?.suppressedByReason.follow_through_minor_initial_move, 2);
});

test("live post replay simulator suppresses minor failed/stalled recap chatter", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1000,
      symbol: "CYCU",
      messageKind: "symbol_recap",
      title: "CYCU current read",
      body: [
        "The latest follow-through check finished failed at -0.50% from the key level.",
        "The setup is not clean for longs yet.",
      ].join("\n"),
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 70 * 60 * 1000,
      symbol: "CYCU",
      messageKind: "symbol_recap",
      title: "CYCU current read",
      body: [
        "Follow-through is failed; price change from the watched level is -2.50%.",
        "Buyers need a stronger reclaim before the structure repairs.",
      ].join("\n"),
    },
  ]);

  const report = buildLivePostReplaySimulationReport(auditPath);
  assert.equal(report.totals.originalPosted, 2);
  assert.equal(report.totals.simulatedPosted, 1);
  assert.equal(report.perSymbol[0]?.suppressedByReason.optional_minor_recap, 1);
});

test("live post replay simulator suppresses duplicate extension payloads", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_level_extension",
      status: "posted",
      timestamp: 1000,
      symbol: "ITOC",
      title: "NEXT LEVELS: ITOC",
      bodyPreview: "resistance 0.695, 0.73",
      side: "resistance",
      levelCount: 2,
    },
    {
      type: "discord_delivery_audit",
      operation: "post_level_extension",
      status: "posted",
      timestamp: 600000,
      symbol: "ITOC",
      title: "NEXT LEVELS: ITOC",
      bodyPreview: "resistance 0.695, 0.73",
      side: "resistance",
      levelCount: 2,
    },
    {
      type: "discord_delivery_audit",
      operation: "post_level_extension",
      status: "posted",
      timestamp: 1200000,
      symbol: "ITOC",
      title: "NEXT LEVELS: ITOC",
      bodyPreview: "resistance 0.78, 0.82",
      side: "resistance",
      levelCount: 2,
    },
  ]);

  const report = buildLivePostReplaySimulationReport(auditPath);
  assert.equal(report.totals.originalPosted, 3);
  assert.equal(report.totals.simulatedPosted, 2);
  assert.equal(report.perSymbol[0]?.suppressedByReason.extension_duplicate_payload, 1);
});

test("live post replay simulator exposes thread-story churn suppression evidence", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1000,
      symbol: "CYCU",
      messageKind: "intelligent_alert",
      eventType: "level_touch",
      title: "CYCU level touch",
      body: "price testing moderate resistance 1.06\nTriggered near: 1.05",
      practicalStructureState: "pressing_resistance",
      practicalZoneKey: "support:0.9898-1.02|resistance:1.06-1.06",
      score: 40,
      severity: "medium",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 6 * 60 * 1000,
      symbol: "CYCU",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      title: "CYCU breakout",
      body: "bullish breakout through moderate resistance 1.06\nTriggered near: 1.07",
      practicalStructureState: "breakout_attempt",
      practicalZoneKey: "support:0.9898-1.02|resistance:1.06-1.06",
      score: 48,
      severity: "medium",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 30 * 60 * 1000,
      symbol: "CYCU",
      messageKind: "intelligent_alert",
      eventType: "fake_breakdown",
      title: "CYCU reclaim attempt",
      body: "price reclaimed support 1.02\nTriggered near: 1.02",
      practicalStructureState: "reclaim_attempt",
      practicalZoneKey: "support:0.9898-1.02|resistance:1.06-1.06",
      score: 45,
      severity: "medium",
    },
  ]);

  const report = buildLivePostReplaySimulationReport(auditPath);
  assert.equal(report.totals.originalPosted, 3);
  assert.equal(report.totals.simulatedPosted, 2);
  assert.equal(report.totals.threadStorySuppressions, 1);
  assert.equal(report.perSymbol[0]?.threadStorySuppressions, 1);
  assert.equal(report.perSymbol[0]?.suppressedByReason.phase_phase_churn, 1);
  assert.match(formatLivePostReplaySimulationMarkdown(report), /thread-story suppressions: 1/);
});

test("live post replay simulator infers practical chop context from older saved rows", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1000,
      symbol: "CYCU",
      messageKind: "intelligent_alert",
      eventType: "level_touch",
      title: "CYCU level touch",
      body: "price testing major support 1.01-1.02\nKey levels:\nNearby resistance: 1.06\nTriggered near: 1.01",
      score: 42,
      severity: "medium",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 8 * 60 * 1000,
      symbol: "CYCU",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      title: "CYCU breakout",
      body: "bullish breakout through moderate resistance 1.06\nprice is still just above the zone high\nTriggered near: 1.07",
      score: 46,
      severity: "medium",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 24 * 60 * 1000,
      symbol: "CYCU",
      messageKind: "intelligent_alert",
      eventType: "level_touch",
      title: "CYCU level touch",
      body: "price testing major support 1.01-1.02\nKey levels:\nNearby resistance: 1.06\nTriggered near: 1.02",
      score: 44,
      severity: "medium",
    },
  ]);

  const report = buildLivePostReplaySimulationReport(auditPath);
  assert.equal(report.totals.originalPosted, 3);
  assert.equal(report.totals.simulatedPosted, 1);
  assert.equal(report.perSymbol[0]?.suppressedByReason.alert_range_box_chop, 1);
  assert.equal(report.perSymbol[0]?.suppressedByReason.alert_same_story_not_material, 1);
});

test("live post replay simulator suppresses rapid same-direction ladder clear updates", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 1000,
      symbol: "ERNA",
      messageKind: "level_clear_update",
      eventType: "breakout",
      title: "ERNA resistance cluster crossed",
      body: "price pushed through nearby resistance cluster 4.94-5.00; nearby resistance above is moderate resistance 5.15\nTriggered near: 5.15",
      targetPrice: 5,
      severity: "high",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 70 * 1000,
      symbol: "ERNA",
      messageKind: "level_clear_update",
      eventType: "breakout",
      title: "ERNA resistance cluster crossed",
      body: "price pushed through nearby resistance cluster 5.15-5.25; nearby resistance above is moderate resistance 5.37\nTriggered near: 5.37",
      targetPrice: 5.25,
      severity: "high",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 3 * 60 * 1000,
      symbol: "ERNA",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      title: "ERNA breakout",
      body: "bullish breakout through moderate resistance 5.63\nTriggered near: 5.93",
      targetPrice: 5.63,
      severity: "high",
    },
  ]);

  const report = buildLivePostReplaySimulationReport(auditPath);
  assert.equal(report.totals.originalPosted, 3);
  assert.equal(report.totals.simulatedPosted, 2);
  assert.equal(report.perSymbol[0]?.suppressedByReason.alert_ladder_step_cooldown, 1);
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
  assert.equal(symbol.missingEventCandidates[0]?.level, 1.24);
  assert.match(formatRunnerStoryMarkdown(report), /Missing Event Candidates/);
  assert.match(formatRunnerStoryMarkdown(report), /Tuning Suggestions/);
});

test("runner story report treats a posted breakout zone as covering nearby crossed resistance", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 1000,
      symbol: "CANF",
      body: [
        "CANF support and resistance",
        "Price: 3.06",
        "Resistance:",
        "3.08-3.18 zone (+0.7% to +3.9%, major, clustered levels)",
        "3.32 (+8.5%, major, daily confluence)",
        "",
        "Support:",
        "3.01 (-1.6%, major, daily confluence)",
      ].join("\n"),
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2000,
      symbol: "CANF",
      messageKind: "intelligent_alert",
      eventType: "breakout",
      targetPrice: 3.32,
      title: "CANF breakout",
      body: [
        "bullish breakout through major resistance 3.16-3.19",
        "",
        "Price is above resistance for now.",
        "",
        "Triggered near: 3.21",
      ].join("\n"),
    },
  ]);

  const report = buildRunnerStoryReport(auditPath, ["CANF"]);
  assert.deepEqual(report.symbols[0]?.missingEventCandidates, []);
});

test("runner story report treats support-touch posts as support even when they mention nearby resistance", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 1000,
      symbol: "BYND",
      body: [
        "BYND support and resistance",
        "Price: 1.03",
        "Resistance:",
        "1.04 (+1.0%, major, daily confluence)",
        "",
        "Support:",
        "1.01 (-1.9%, major, daily confluence)",
      ].join("\n"),
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2000,
      symbol: "BYND",
      messageKind: "intelligent_alert",
      eventType: "level_touch",
      targetPrice: 1.04,
      title: "BYND level touch",
      body: [
        "price testing major support 1.01",
        "",
        "Price is testing support.",
        "",
        "Key levels:",
        "- Testing support: 1.01",
        "- Nearby resistance: 1.04",
        "",
        "Triggered near: 1.01",
      ].join("\n"),
    },
  ]);

  const report = buildRunnerStoryReport(auditPath, ["BYND"]);
  assert.deepEqual(report.symbols[0]?.missingEventCandidates, []);
});

test("runner story report parses line-by-line levels without treating percentages as prices", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 1000,
      symbol: "SOBR",
      body: [
        "SOBR support and resistance",
        "Price: 1.09",
        "Closest levels to watch:",
        "Resistance:",
        "1.12 (+2.3%, heavy, daily confluence)",
        "1.26 (+15.1%, moderate, fresh intraday)",
        "",
        "Support:",
        "1.03 (-5.9%, light, fresh intraday)",
        "0.9000 (-17.8%, moderate, fresh intraday)",
      ].join("\n"),
    },
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 2000,
      symbol: "SOBR",
      body: [
        "SOBR support and resistance",
        "Price: 1.20",
        "Closest levels to watch:",
        "Resistance:",
        "1.26 (+5.0%, moderate, fresh intraday)",
        "",
        "Support:",
        "1.12 (-6.7%, heavy, daily confluence)",
      ].join("\n"),
    },
  ]);

  const report = buildRunnerStoryReport(auditPath, ["SOBR"]);
  const symbol = report.symbols[0];
  assert.equal(symbol?.missingEventCandidates[0]?.side, "resistance");
  assert.equal(symbol.missingEventCandidates[0]?.level, 1.12);
  assert.equal(symbol.missingEventCandidates.some((candidate) => candidate.level === 2.3), false);
  assert.match(symbol.traderStory.join("\n"), /resistance 1\.26/);
});

test("runner story report waits for full resistance zone clear before flagging a missed clear", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 1000,
      symbol: "CUE",
      body: [
        "CUE support and resistance",
        "Price: 27.55",
        "Resistance:",
        "27.81-27.97 zone (+1.5% to +1.9%, major, clustered levels)",
        "29.50 (+7.1%, moderate, daily structure)",
        "",
        "Support:",
        "26.00 (-5.6%, moderate, daily confluence)",
      ].join("\n"),
    },
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 2000,
      symbol: "CUE",
      body: [
        "CUE support and resistance",
        "Price: 27.83",
        "Resistance:",
        "27.81-27.97 zone (+0.5% to +0.5%, major, clustered levels)",
        "29.50 (+6.0%, moderate, daily structure)",
        "",
        "Support:",
        "26.00 (-6.6%, moderate, daily confluence)",
      ].join("\n"),
    },
  ]);

  const report = buildRunnerStoryReport(auditPath, ["CUE"]);
  assert.deepEqual(report.symbols[0]?.missingEventCandidates, []);
});

test("runner story report treats same-time resistance-zone touch as coverage for lower edge", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 1000,
      symbol: "CUE",
      body: [
        "CUE support and resistance",
        "Price: 27.55",
        "Closest levels to watch:",
        "Resistance:",
        "27.81 (+0.9%, heavy, daily confluence)",
        "29.10 (+5.6%, major, daily confluence)",
        "",
        "Support:",
        "26.80 (-2.7%, moderate, fresh intraday)",
      ].join("\n"),
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2000,
      symbol: "CUE",
      messageKind: "intelligent_alert",
      eventType: "level_touch",
      targetSide: "support",
      targetPrice: 26.8,
      title: "CUE level touch",
      body: [
        "price testing heavy resistance 27.81-27.97",
        "",
        "Price is testing resistance.",
        "",
        "What to watch:",
        "limited lower support into support near 26.80 (-3.7%)",
        "buyers need acceptance above 27.97 before breakout pressure builds",
        "",
        "Key levels:",
        "Testing resistance: 27.81-27.97",
        "Nearby support: 26.80",
        "",
        "Triggered near: 27.83",
      ].join("\n"),
    },
  ]);

  const report = buildRunnerStoryReport(auditPath, ["CUE"]);
  assert.deepEqual(report.symbols[0]?.missingEventCandidates, []);
});

test("runner story report flags a true resistance-zone clear without nearby coverage", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 1000,
      symbol: "CUE",
      body: [
        "CUE support and resistance",
        "Price: 27.55",
        "Resistance:",
        "27.81-27.97 zone (+1.5% to +1.9%, major, clustered levels)",
        "",
        "Support:",
        "26.80 (-2.7%, moderate, fresh intraday)",
      ].join("\n"),
    },
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 2000,
      symbol: "CUE",
      body: [
        "CUE support and resistance",
        "Price: 28.10",
        "Resistance:",
        "29.10 (+3.6%, major, daily confluence)",
        "",
        "Support:",
        "27.81 (-1.0%, heavy, daily confluence)",
      ].join("\n"),
    },
  ]);

  const report = buildRunnerStoryReport(auditPath, ["CUE"]);
  assert.equal(report.symbols[0]?.missingEventCandidates[0]?.side, "resistance");
  assert.equal(report.symbols[0]?.missingEventCandidates[0]?.level, 27.97);
});


test("runner story report does not re-flag a resistance already covered by an earlier clear post", () => {
  const auditPath = writeAudit([
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 1000,
      symbol: "AIOS",
      body: [
        "AIOS support and resistance",
        "Price: 22.66",
        "Resistance: 24.00 (+5.9%, major, daily confluence), 27.50 (+21.4%, moderate, daily structure)",
        "Support: 20.00 (-11.7%, major, daily confluence)",
      ].join("\n"),
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: 2000,
      symbol: "AIOS",
      messageKind: "level_clear_update",
      eventType: "breakout",
      targetPrice: 24,
      title: "AIOS resistance crossed",
      body: [
        "price pushed above 24.00; nearby resistance above is moderate resistance 27.50",
        "",
        "Key levels:",
        "Breakout support: 24.00",
        "Resistance above: moderate resistance 27.50",
      ].join("\n"),
    },
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: 300000,
      symbol: "AIOS",
      body: [
        "AIOS support and resistance",
        "Price: 27.46",
        "Resistance: 27.50 (+0.1%, moderate, daily structure)",
        "Support: 24.00 (-12.6%, major, daily confluence)",
      ].join("\n"),
    },
  ]);

  const report = buildRunnerStoryReport(auditPath, ["AIOS"]);
  assert.deepEqual(report.symbols[0]?.missingEventCandidates, []);
});
