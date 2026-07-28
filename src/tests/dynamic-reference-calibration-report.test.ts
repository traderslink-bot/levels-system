import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  evaluateDynamicReferenceCalibrationGate,
  formatDynamicReferenceCalibrationReport,
  generateDynamicReferenceCalibrationReport,
} from "../lib/review/dynamic-reference-calibration-report.js";
import type { Candle } from "../lib/support-resistance/index.js";

const FIVE_MINUTES = 5 * 60_000;

function candle(timestamp: number, close: number, volume = 100_000): Candle {
  return {
    timestamp,
    open: close,
    high: Number((close * 1.01).toFixed(4)),
    low: Number((close * 0.99).toFixed(4)),
    close,
    volume,
  };
}

function writeCache(root: string, symbol: string, timeframe: string, candles: Candle[]): void {
  const directory = join(root, "cache", "ibkr", symbol, timeframe);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "candles.json"), JSON.stringify({ candles }), "utf8");
}

test("dynamic reference calibration reports opening range and VWAP/EMA evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "dynamic-reference-calibration-"));
  const auditPath = join(root, "discord-delivery-audit.jsonl");
  const symbol = "DYN";
  const start = Date.parse("2026-05-01T12:00:00.000Z");
  const fiveMinute = Array.from({ length: 32 }, (_, index) =>
    candle(start + index * FIVE_MINUTES, Number((1 + index * 0.012).toFixed(4)), 100_000 + index * 10_000),
  );
  const daily: Candle[] = [
    { timestamp: Date.parse("2026-04-30T20:00:00.000Z"), open: 0.9, high: 1.08, low: 0.86, close: 1.02, volume: 1_000_000 },
    { timestamp: Date.parse("2026-05-01T20:00:00.000Z"), open: 1.05, high: 1.6, low: 1.0, close: 1.5, volume: 2_000_000 },
  ];
  writeCache(root, symbol, "5m", fiveMinute);
  writeCache(root, symbol, "daily", daily);
  writeFileSync(
    auditPath,
    JSON.stringify({
      operation: "post_alert",
      status: "posted",
      timestamp: Date.parse("2026-05-01T14:05:00.000Z"),
      sourceTimestamp: Date.parse("2026-05-01T14:05:00.000Z"),
      symbol,
      title: "DYN breakout",
      body: "Triggered near: 1.26",
      triggerPrice: 1.26,
    }),
    "utf8",
  );

  const report = generateDynamicReferenceCalibrationReport({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
  });

  assert.equal(report.totals.symbols, 1);
  assert.equal(report.totals.openingRangeAvailable, 1);
  assert.equal(report.totals.dynamicAvailable, 1);
  assert.equal(report.totals.trustedSymbols, 1);
  assert.equal(report.symbols[0]?.overallTrust, "trusted");
  assert.ok(report.symbols[0]?.dynamicAvailableCount);
  assert.match(formatDynamicReferenceCalibrationReport(report), /Dynamic Reference Calibration Report/);
  assert.equal(evaluateDynamicReferenceCalibrationGate(report).status, "pass");
});

test("dynamic reference calibration gate blocks unproven dynamic evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "dynamic-reference-calibration-unproven-"));
  const auditPath = join(root, "discord-delivery-audit.jsonl");
  writeFileSync(
    auditPath,
    JSON.stringify({
      operation: "post_alert",
      status: "posted",
      timestamp: Date.parse("2026-05-01T14:05:00.000Z"),
      sourceTimestamp: Date.parse("2026-05-01T14:05:00.000Z"),
      symbol: "MISS",
      title: "MISS breakout",
      body: "Triggered near: 1.26",
      triggerPrice: 1.26,
    }),
    "utf8",
  );

  const report = generateDynamicReferenceCalibrationReport({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
  });
  const gate = evaluateDynamicReferenceCalibrationGate(report);

  assert.equal(report.symbols[0]?.overallTrust, "unproven");
  assert.equal(gate.status, "fail");
  assert.equal(gate.traderFacingUse, "operator_only");
});
