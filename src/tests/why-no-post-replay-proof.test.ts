import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  formatWhyNoPostReplayProof,
  generateWhyNoPostReplayProof,
} from "../lib/review/why-no-post-replay-proof.js";
import type { Candle } from "../lib/support-resistance/index.js";

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

function writeAudit(root: string, rows: object[]): string {
  const path = join(root, "discord-delivery-audit.jsonl");
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");
  return path;
}

function writeDiagnostics(root: string, rows: object[]): void {
  writeFileSync(join(root, "manual-watchlist-diagnostics.log"), rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");
}

test("why-no-post proof marks quiet behavior supported when candles have no candidates", () => {
  const root = mkdtempSync(join(tmpdir(), "why-no-post-supported-"));
  const symbol = "CALM";
  const start = Date.parse("2026-05-01T13:30:00.000Z");
  writeCache(root, symbol, Array.from({ length: 20 }, (_, index) => candle(start + index * FIVE_MINUTES, 1 + index * 0.002)));
  const auditPath = writeAudit(root, [
    {
      operation: "post_level_snapshot",
      type: "discord_delivery_audit",
      status: "posted",
      timestamp: start,
      symbol,
      title: "CALM support and resistance",
      body: "Price: 1.00",
    },
  ]);

  const report = generateWhyNoPostReplayProof({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
  });

  assert.equal(report.symbols[0]?.verdict, "quiet_supported_by_candles");
  assert.equal(report.symbols[0]?.replayEvidence?.originalPosted, 1);
  assert.match(formatWhyNoPostReplayProof(report), /quiet supported by candles/);
});

test("why-no-post proof flags quiet behavior that may hide a large move", () => {
  const root = mkdtempSync(join(tmpdir(), "why-no-post-missed-"));
  const symbol = "MOVE";
  const start = Date.parse("2026-05-01T13:30:00.000Z");
  writeCache(root, symbol, [
    candle(start, 1),
    candle(start + FIVE_MINUTES, 1.01),
    candle(start + 3 * FIVE_MINUTES, 1.2),
    candle(start + 4 * FIVE_MINUTES, 1.21),
    candle(start + 6 * FIVE_MINUTES, 1.22),
  ]);
  const auditPath = writeAudit(root, [
    {
      operation: "post_level_snapshot",
      type: "discord_delivery_audit",
      status: "posted",
      timestamp: start,
      symbol,
      title: "MOVE support and resistance",
      body: "Price: 1.00",
    },
    {
      operation: "post_level_snapshot",
      type: "discord_delivery_audit",
      status: "posted",
      timestamp: start + 6 * FIVE_MINUTES,
      symbol,
      title: "MOVE support and resistance",
      body: "Price: 1.22",
    },
  ]);
  writeDiagnostics(root, [
    {
      type: "monitoring_event_diagnostic",
      symbol,
      timestamp: start + 3 * FIVE_MINUTES,
      eventType: "breakout",
      decision: "suppressed",
      reasons: ["same_story_not_material"],
    },
  ]);

  const report = generateWhyNoPostReplayProof({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
    timeframe: "5m",
  });

  assert.equal(report.symbols[0]?.verdict, "quiet_may_hide_move");
  assert.equal(report.totals.actionableMissedCandidates, 1);
  assert.equal(report.totals.policySuppressedCandidates, 1);
  assert.ok((report.symbols[0]?.missedCount ?? 0) > 0);
  assert.ok((report.symbols[0]?.candidateExamples.length ?? 0) > 0);
  assert.equal(report.symbols[0]?.candidateExamples[0]?.quietRiskCause, "policy_suppressed");
  assert.match(formatWhyNoPostReplayProof(report), /Concrete Move Examples/);
  assert.match(formatWhyNoPostReplayProof(report), /quiet-risk cause: policy_suppressed/);
});

test("why-no-post proof separates runtime silence from policy suppression", () => {
  const root = mkdtempSync(join(tmpdir(), "why-no-post-runtime-silence-"));
  const symbol = "SILENT";
  const start = Date.parse("2026-05-01T13:30:00.000Z");
  writeCache(root, symbol, [
    candle(start, 1),
    candle(start + FIVE_MINUTES, 1.01),
    candle(start + 3 * FIVE_MINUTES, 0.9),
    candle(start + 4 * FIVE_MINUTES, 0.91),
    candle(start + 8 * FIVE_MINUTES, 0.92),
  ]);
  const auditPath = writeAudit(root, [
    {
      operation: "post_level_snapshot",
      type: "discord_delivery_audit",
      status: "posted",
      timestamp: start,
      symbol,
      title: "SILENT support and resistance",
      body: "Price: 1.00",
    },
    {
      operation: "post_level_snapshot",
      type: "discord_delivery_audit",
      status: "posted",
      timestamp: start + 8 * FIVE_MINUTES,
      symbol,
      title: "SILENT support and resistance",
      body: "Price: 0.92",
    },
  ]);

  const report = generateWhyNoPostReplayProof({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
    timeframe: "5m",
  });

  assert.equal(report.symbols[0]?.verdict, "unproven_runtime_silence");
  assert.equal(report.totals.unprovenRuntimeSilence, 1);
  assert.equal(report.totals.runtimeSilenceCandidates, 1);
  assert.equal(report.totals.actionableMissedCandidates, 0);
  assert.equal(report.symbols[0]?.candidateExamples[0]?.quietRiskCause, "runtime_or_feed_silence");
});

test("why-no-post proof can aggregate all session folders", () => {
  const root = mkdtempSync(join(tmpdir(), "why-no-post-all-sessions-"));
  const sessionA = join(root, "2026-05-01");
  const sessionB = join(root, "2026-05-02");
  const start = Date.parse("2026-05-01T13:30:00.000Z");
  mkdirSync(sessionA, { recursive: true });
  mkdirSync(sessionB, { recursive: true });
  writeCache(root, "AAA", Array.from({ length: 8 }, (_, index) => candle(start + index * FIVE_MINUTES, 1 + index * 0.001)));
  writeCache(root, "BBB", Array.from({ length: 8 }, (_, index) => candle(start + index * FIVE_MINUTES, 2 + index * 0.002)));
  writeAudit(sessionA, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: start,
      symbol: "AAA",
      title: "AAA support and resistance",
      body: "Price: 1.00",
    },
  ]);
  writeAudit(sessionB, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: start,
      symbol: "BBB",
      title: "BBB support and resistance",
      body: "Price: 2.00",
    },
  ]);

  const report = generateWhyNoPostReplayProof({
    auditPath: root,
    cacheDirectoryPath: join(root, "cache"),
    includeReplayEvidence: false,
  });

  assert.equal(report.sourceAuditPath, `2 audit files from ${root}`);
  assert.equal(report.symbols.length, 2);
});

test("why-no-post proof can cap all-session audit files before replay proof", () => {
  const root = mkdtempSync(join(tmpdir(), "why-no-post-max-sessions-"));
  const sessionA = join(root, "2026-05-01");
  const sessionB = join(root, "2026-05-02");
  const start = Date.parse("2026-05-01T13:30:00.000Z");
  mkdirSync(sessionA, { recursive: true });
  mkdirSync(sessionB, { recursive: true });
  writeCache(root, "AAA", Array.from({ length: 8 }, (_, index) => candle(start + index * FIVE_MINUTES, 1 + index * 0.001)));
  writeCache(root, "BBB", Array.from({ length: 8 }, (_, index) => candle(start + index * FIVE_MINUTES, 2 + index * 0.002)));
  writeAudit(sessionA, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: start,
      symbol: "AAA",
      title: "AAA support and resistance",
      body: "Price: 1.00",
    },
  ]);
  writeAudit(sessionB, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: start,
      symbol: "BBB",
      title: "BBB support and resistance",
      body: "Price: 2.00",
    },
  ]);

  const report = generateWhyNoPostReplayProof({
    auditPath: root,
    cacheDirectoryPath: join(root, "cache"),
    includeReplayEvidence: false,
    maxAuditFiles: 1,
  });

  assert.equal(report.sourceAuditPath, join(sessionA, "discord-delivery-audit.jsonl"));
  assert.equal(report.symbols.length, 1);
  assert.equal(report.symbols[0]?.symbol, "AAA");
});
