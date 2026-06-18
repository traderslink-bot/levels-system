import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  evaluateCandleIntelligenceRegressionGate,
  formatCandleIntelligenceRegressionGate,
  generateCandleIntelligenceRegressionPack,
  writeCandleIntelligenceRegressionGate,
  writeCandleIntelligenceRegressionPack,
} from "../lib/review/candle-intelligence-regression-pack.js";
import type { Candle } from "../lib/support-resistance/index.js";

const START = Date.parse("2026-05-01T13:30:00.000Z");
const FIVE_MINUTES = 5 * 60_000;

function candle(timestamp: number, close: number): Candle {
  return {
    timestamp,
    open: close,
    high: Number((close * 1.01).toFixed(4)),
    low: Number((close * 0.99).toFixed(4)),
    close,
    volume: 100_000,
  };
}

function writeCache(root: string, symbol: string, candles: Candle[]): void {
  const directory = join(root, "cache", "ibkr", symbol, "5m");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "candles.json"), JSON.stringify({ candles }), "utf8");
}

function writeAuditRows(directory: string, rows: object[]): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");
  return path;
}

function writeDiagnostics(directory: string, rows: object[]): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "manual-watchlist-diagnostics.log"), rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");
}

test("candle intelligence regression pack promotes weak snapshots and missing evidence into cases", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-regression-pack-"));
  const auditPath = writeAuditRows(join(root, "session"), [
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: START,
      symbol: "WEAK",
      title: "WEAK support and resistance",
      body: "Price: 1.00",
    },
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: START + 60_000,
      symbol: "MISS",
      title: "MISS breakout",
      triggerPrice: 1.2,
    },
  ]);

  const pack = await generateCandleIntelligenceRegressionPack({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
    maxCasesPerType: 5,
  });

  assert.ok(pack.totals.cases >= 2);
  assert.ok(pack.cases.some((item) => item.type === "weak_first_snapshot"));
  assert.ok(pack.cases.some((item) => item.type === "first_snapshot_map_failure"));
  assert.ok(pack.cases.some((item) => item.type === "advanced_context_missing"));
  assert.ok(pack.cases.some((item) => item.type === "provider_readiness_watch"));
  assert.ok(pack.cases.some((item) => item.type === "execution_relation_missing_evidence"));
  assert.ok(pack.cases.some((item) => item.type === "support_resistance_unproven_coverage"));
});

test("candle intelligence regression pack writer creates JSON and markdown artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-regression-pack-write-"));
  const auditPath = writeAuditRows(join(root, "session"), [
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: START,
      symbol: "MISS",
      title: "MISS breakout",
      triggerPrice: 1.2,
    },
  ]);

  const pack = await writeCandleIntelligenceRegressionPack({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
    jsonPath: join(root, "out", "pack.json"),
    markdownPath: join(root, "out", "pack.md"),
  });

  assert.ok(pack.totals.cases >= 1);
  assert.ok(pack.totals.supportResistanceUnprovenCoverage >= 1);
  assert.ok(existsSync(join(root, "out", "pack.json")));
  assert.match(readFileSync(join(root, "out", "pack.md"), "utf8"), /Candle Intelligence Regression Pack/);
});

test("candle intelligence regression gate fails on major cases and can be written", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-regression-gate-"));
  const auditPath = writeAuditRows(join(root, "session"), [
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: START,
      symbol: "WEAK",
      title: "WEAK support and resistance",
      body: "Price: 1.00",
    },
  ]);
  const pack = await generateCandleIntelligenceRegressionPack({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
    maxCasesPerType: 5,
  });

  const result = evaluateCandleIntelligenceRegressionGate(pack, {
    maxSupportResistanceUnprovenCoverageCases: 0,
  });

  assert.equal(result.status, "fail");
  assert.ok(result.violations.some((violation) => violation.code === "weak_first_snapshot_cases"));
  assert.ok(result.violations.some((violation) => violation.code === "first_snapshot_map_failure_cases"));
  assert.ok(result.violations.some((violation) => violation.code === "support_resistance_unproven_coverage_cases"));
  assert.match(formatCandleIntelligenceRegressionGate(result), /Status: fail/);

  const written = writeCandleIntelligenceRegressionGate({
    pack,
    jsonPath: join(root, "out", "gate.json"),
    markdownPath: join(root, "out", "gate.md"),
  });

  assert.equal(written.status, "fail");
  assert.ok(existsSync(join(root, "out", "gate.json")));
  assert.match(readFileSync(join(root, "out", "gate.md"), "utf8"), /Regression Gate/);
});

test("candle intelligence regression pack includes quiet-risk and post-budget cases", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-regression-noise-proof-"));
  writeCache(root, "MOVE", [
    candle(START, 1),
    candle(START + FIVE_MINUTES, 1.01),
    candle(START + 4 * FIVE_MINUTES, 1.22),
    candle(START + 5 * FIVE_MINUTES, 1.23),
  ]);
  writeCache(root, "SILENT", [
    candle(START, 2),
    candle(START + FIVE_MINUTES, 2.01),
    candle(START + 4 * FIVE_MINUTES, 2.42),
    candle(START + 5 * FIVE_MINUTES, 2.43),
  ]);
  const rows: object[] = [
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: START,
      timestamp: START,
      symbol: "MOVE",
      title: "MOVE support and resistance",
      body: "Price: 1.00",
    },
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: START + 40 * FIVE_MINUTES,
      timestamp: START + 40 * FIVE_MINUTES,
      symbol: "MOVE",
      title: "MOVE support and resistance",
      body: "Price: 1.23",
    },
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: START,
      timestamp: START,
      symbol: "SILENT",
      title: "SILENT support and resistance",
      body: "Price: 2.00",
    },
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: START + 40 * FIVE_MINUTES,
      timestamp: START + 40 * FIVE_MINUTES,
      symbol: "SILENT",
      title: "SILENT support and resistance",
      body: "Price: 2.43",
    },
    ...Array.from({ length: 18 }, (_, index) => ({
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: START + index * 20 * 60_000,
      timestamp: START + index * 20 * 60_000,
      symbol: "NOISE",
      title: "NOISE support and resistance",
      body: `Price: ${(1 + index * 0.01).toFixed(2)}\nResistance:\n${(1.2 + index * 0.01).toFixed(2)}\nSupport:\n${(0.9 + index * 0.01).toFixed(2)}`,
    })),
  ];
  const sessionDirectory = join(root, "session");
  const auditPath = writeAuditRows(sessionDirectory, rows);
  writeDiagnostics(sessionDirectory, [
    {
      type: "monitoring_event_diagnostic",
      symbol: "MOVE",
      timestamp: START + 4 * FIVE_MINUTES,
      eventType: "breakout",
      decision: "suppressed",
      reasons: ["same_story_not_material"],
    },
  ]);

  const pack = await generateCandleIntelligenceRegressionPack({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
    maxCasesPerType: 10,
  });

  assert.ok(pack.cases.some((item) => item.type === "quiet_may_hide_move"));
  assert.ok(pack.cases.some((item) => item.type === "runtime_feed_silence"));
  assert.ok(pack.cases.some((item) => item.type === "post_noise_budget_watch"));
  const result = evaluateCandleIntelligenceRegressionGate(pack, {
    maxMajorCandidateCases: 999,
    maxWeakFirstSnapshotCases: 999,
    maxMissingForwardResistanceCases: 999,
    maxFirstSnapshotMapFailureCases: 999,
    maxQuietMayHideMoveCases: 0,
    maxRuntimeFeedSilenceCases: 0,
    maxPostNoiseBudgetWatchCases: 0,
    maxSupportResistanceUnprovenCoverageCases: 999,
  });
  assert.ok(result.violations.some((violation) => violation.code === "quiet_may_hide_move_cases"));
  assert.ok(result.violations.some((violation) => violation.code === "runtime_feed_silence_cases"));
  assert.ok(result.violations.some((violation) => violation.code === "post_noise_budget_watch_cases"));
});
