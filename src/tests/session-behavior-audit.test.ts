import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  generateSessionBehaviorAudit,
  writeSessionBehaviorAudit,
} from "../lib/review/session-behavior-audit.js";
import type { Candle, CandleFetchTimeframe } from "../lib/market-data/candle-types.js";

const BASE = Date.parse("2026-05-01T14:00:00.000Z");
const FIVE_MINUTES = 5 * 60 * 1000;

function candle(index: number, close: number, high = close, low = close): Candle {
  return {
    timestamp: BASE + index * FIVE_MINUTES,
    open: close * 0.99,
    high,
    low,
    close,
    volume: 1000,
  };
}

function writeAudit(directory: string, rows: object[]): string {
  const path = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  return path;
}

function writeCachedCandles(directory: string, symbol: string, timeframe: CandleFetchTimeframe, candles: Candle[]): void {
  const cacheDirectory = join(directory, ".validation-cache", "candles", "ibkr", symbol, timeframe);
  mkdirSync(cacheDirectory, { recursive: true });
  writeFileSync(
    join(cacheDirectory, `${candles.length}-${candles.at(-1)?.timestamp ?? BASE}.json`),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        cachedAt: BASE + 60 * FIVE_MINUTES,
        request: {
          symbol,
          timeframe,
          lookbackBars: candles.length,
          endTimeMs: candles.at(-1)?.timestamp ?? BASE,
          provider: "ibkr",
        },
        response: {
          provider: "ibkr",
          symbol,
          timeframe,
          requestedLookbackBars: candles.length,
          candles,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function writeAllTimeframes(directory: string, symbol: string, fiveMinuteCandles: Candle[]): void {
  writeCachedCandles(directory, symbol, "5m", fiveMinuteCandles);
  writeCachedCandles(directory, symbol, "4h", [
    { timestamp: BASE - 4 * 60 * 60 * 1000, open: 1, high: 1.2, low: 0.9, close: 1.1, volume: 1000 },
    { timestamp: BASE, open: 1.1, high: 1.3, low: 1.0, close: 1.2, volume: 1000 },
  ]);
  writeCachedCandles(directory, symbol, "daily", [
    { timestamp: BASE - 24 * 60 * 60 * 1000, open: 1, high: 1.4, low: 0.8, close: 1.1, volume: 1000 },
    { timestamp: BASE, open: 1.1, high: 1.3, low: 1.0, close: 1.2, volume: 1000 },
  ]);
}

test("session behavior audit reports readiness, first-post score, behavior profile, and runtime markers", () => {
  const directory = mkdtempSync(join(tmpdir(), "session-behavior-"));
  writeAllTimeframes(directory, "CYCU", [
    candle(0, 1.0, 1.01, 0.99),
    candle(1, 1.01, 1.02, 1.0),
    candle(2, 1.0, 1.02, 0.99),
    candle(3, 1.02, 1.03, 1.0),
    candle(4, 1.01, 1.03, 1.0),
  ]);
  const auditPath = writeAudit(directory, [
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE + FIVE_MINUTES,
      sourceTimestamp: BASE + FIVE_MINUTES,
      symbol: "CYCU",
      title: "CYCU support and resistance",
      body: "Price: 1.01\n\nWhat price is doing now:\nPrice is between light support 1.00 and heavy resistance 1.03.\n\nClosest levels to watch:\nResistance:\n1.03 (+2.0%, heavy, fresh intraday)\n\nSupport:\n1.00 (-1.0%, light, fresh intraday)\n\nMore support and resistance:\nResistance:\n1.03\n\nSupport:\n1.00",
      runtimeVersion: "0.1.0",
      runtimeStartedAt: "2026-05-01T13:59:00.000Z",
      runtimePid: 123,
    },
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: BASE + 2 * FIVE_MINUTES,
      sourceTimestamp: BASE + 2 * FIVE_MINUTES,
      symbol: "CYCU",
      title: "CYCU level touch",
      eventType: "level_touch",
      rangeBoxLabel: "active",
      behaviorBudgetLabel: "boring_range",
      body: "price testing resistance",
      runtimeVersion: "0.1.0",
      runtimeStartedAt: "2026-05-01T13:59:00.000Z",
      runtimePid: 123,
    },
  ]);

  const report = generateSessionBehaviorAudit({
    auditPath,
    cacheDirectoryPath: join(directory, ".validation-cache", "candles"),
  });
  const cycu = report.symbols.find((symbol) => symbol.symbol === "CYCU");

  assert.ok(cycu);
  assert.equal(cycu.candleReadiness, "ready");
  assert.equal(cycu.firstPostScore.label, "strong");
  assert.equal(cycu.behaviorProfile.label, "accumulating_under_resistance");
  assert.match(cycu.operatorRecapPreview.join(" "), /CYCU: accumulating_under_resistance session/);
  assert.equal(report.runtimeMarkers[0]?.runtimeVersion, "0.1.0");
  assert.equal(report.totals.missingRuntimeMarkers, 0);
});

test("session behavior audit marks stale candle evidence as data-unproven", () => {
  const directory = mkdtempSync(join(tmpdir(), "session-behavior-stale-"));
  writeAllTimeframes(directory, "AKAN", [
    candle(0, 40, 40.5, 39.5),
    candle(1, 41, 41.5, 40),
  ]);
  const auditPath = writeAudit(directory, [
    {
      type: "discord_delivery_audit",
      operation: "post_alert",
      status: "posted",
      timestamp: BASE + 60 * FIVE_MINUTES,
      sourceTimestamp: BASE + 60 * FIVE_MINUTES,
      symbol: "AKAN",
      title: "AKAN breakout",
      body: "price pushed above resistance",
    },
  ]);

  const report = generateSessionBehaviorAudit({
    auditPath,
    cacheDirectoryPath: join(directory, ".validation-cache", "candles"),
  });
  const akan = report.symbols.find((symbol) => symbol.symbol === "AKAN");

  assert.ok(akan);
  assert.equal(akan.candleReadiness, "partial");
  assert.equal(akan.threadBalance.verdict, "data_unproven");
  assert.equal(report.totals.missingRuntimeMarkers, 1);
});

test("session behavior audit penalizes weak first-post map claims", () => {
  const directory = mkdtempSync(join(tmpdir(), "session-behavior-weak-map-"));
  writeAllTimeframes(directory, "WEAK", [
    candle(0, 1.0, 1.01, 0.99),
    candle(1, 1.01, 1.02, 1.0),
    candle(2, 1.0, 1.01, 0.99),
  ]);
  const auditPath = writeAudit(directory, [
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE,
      sourceTimestamp: BASE,
      symbol: "WEAK",
      title: "WEAK support and resistance",
      body: "Price: 1.01\nWhat price is doing now:\nResistance above: none currently surfaced\nif price cannot hold 1.00, risk opens toward 0.99",
    },
  ]);

  const report = generateSessionBehaviorAudit({
    auditPath,
    cacheDirectoryPath: join(directory, ".validation-cache", "candles"),
  });
  const weak = report.symbols.find((symbol) => symbol.symbol === "WEAK");

  assert.ok(weak);
  assert.equal(weak.firstPostScore.label, "weak");
  assert.match(weak.firstPostScore.issues.join(" "), /forward resistance wording/);
  assert.match(weak.firstPostScore.issues.join(" "), /meaningful support/);
});

test("session behavior audit keeps missed-move quiet verdicts mixed when higher timeframe evidence is unavailable", () => {
  const directory = mkdtempSync(join(tmpdir(), "session-behavior-mixed-"));
  writeCachedCandles(directory, "RUNR", "5m", [
    candle(0, 1.0, 1.01, 0.99),
    candle(1, 1.01, 1.02, 1.0),
    candle(2, 1.02, 1.03, 1.0),
    candle(3, 1.03, 1.04, 1.0),
    candle(4, 1.04, 1.05, 1.02),
    candle(5, 1.22, 1.24, 1.04),
    candle(6, 1.35, 1.38, 1.2),
    candle(7, 1.52, 1.55, 1.34),
    candle(8, 1.49, 1.53, 1.45),
    candle(9, 1.5, 1.53, 1.46),
    candle(10, 1.48, 1.52, 1.45),
    candle(11, 1.5, 1.54, 1.46),
    candle(12, 1.51, 1.54, 1.47),
  ]);
  const auditPath = writeAudit(directory, [
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE,
      sourceTimestamp: BASE,
      symbol: "RUNR",
      title: "RUNR support and resistance",
      body: "Price: 1.00\nClosest levels to watch:\nResistance:\n1.25\n\nSupport:\n0.95",
    },
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE + 12 * FIVE_MINUTES,
      sourceTimestamp: BASE + 12 * FIVE_MINUTES,
      symbol: "RUNR",
      title: "RUNR support and resistance",
      body: "Price: 1.51\nClosest levels to watch:\nResistance:\n1.60\n\nSupport:\n1.35",
    },
  ]);

  const report = generateSessionBehaviorAudit({
    auditPath,
    cacheDirectoryPath: join(directory, ".validation-cache", "candles"),
  });
  const runr = report.symbols.find((symbol) => symbol.symbol === "RUNR");

  assert.ok(runr);
  assert.equal(runr.candleReadiness, "blocked");
  assert.equal(runr.threadBalance.verdict, "mixed_review");
  assert.equal(report.totals.mixedReview, 1);
  assert.match(runr.threadBalance.reasons.join(" "), /not fresh enough for a clean quiet-thread verdict/);
  assert.match(runr.operatorRecapPreview.join(" "), /do not tune live posting policy from this symbol alone/);
});

test("session behavior audit writes JSON and Markdown", () => {
  const directory = mkdtempSync(join(tmpdir(), "session-behavior-output-"));
  writeAllTimeframes(directory, "SOBR", [
    candle(0, 1.0, 1.05, 0.98),
    candle(1, 1.12, 1.14, 1.0),
    candle(2, 1.15, 1.18, 1.1),
  ]);
  const auditPath = writeAudit(directory, [
    {
      type: "discord_delivery_audit",
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE,
      sourceTimestamp: BASE,
      symbol: "SOBR",
      title: "SOBR support and resistance",
      body: "Price: 1.00\nClosest levels to watch:\nResistance:\n1.12\n\nSupport:\n0.98",
    },
  ]);
  const jsonPath = join(directory, "session-behavior-audit.json");
  const markdownPath = join(directory, "session-behavior-audit.md");

  const report = writeSessionBehaviorAudit({
    auditPath,
    cacheDirectoryPath: join(directory, ".validation-cache", "candles"),
    jsonPath,
    markdownPath,
  });
  const markdown = readFileSync(markdownPath, "utf8");

  assert.equal(report.totals.symbols, 1);
  assert.match(markdown, /Session Behavior And Readiness Audit/);
  assert.match(markdown, /Symbol Scoreboard/);
  assert.match(markdown, /Operator recap preview/);
  assert.match(readFileSync(jsonPath, "utf8"), /behaviorProfile/);
});
