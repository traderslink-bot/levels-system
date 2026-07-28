import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  generateMissedMeaningfulMoveAudit,
  writeMissedMeaningfulMoveAudit,
} from "../lib/review/missed-meaningful-move-audit.js";
import type { Candle } from "../lib/market-data/candle-types.js";

const BASE = Date.parse("2026-05-01T14:00:00.000Z");
const FIVE_MINUTES = 5 * 60 * 1000;

function writeAudit(directory: string, rows: object[]): string {
  const path = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  return path;
}

function writeCachedCandles(directory: string, symbol: string, candles: Candle[]): void {
  const cacheDirectory = join(directory, ".validation-cache", "candles", "ibkr", symbol, "5m");
  mkdirSync(cacheDirectory, { recursive: true });
  writeFileSync(
    join(cacheDirectory, `100-${candles.at(-1)?.timestamp ?? BASE}.json`),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        cachedAt: Date.now(),
        request: {
          symbol,
          timeframe: "5m",
          lookbackBars: 100,
          endTimeMs: candles.at(-1)?.timestamp ?? BASE,
          provider: "ibkr",
        },
        response: {
          provider: "ibkr",
          symbol,
          timeframe: "5m",
          requestedLookbackBars: 100,
          candles,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function writeWarehouseCandles(directory: string, symbol: string, candles: Candle[]): void {
  const warehouseDirectory = join(directory, "data", "candles", "ibkr", symbol, "5m");
  mkdirSync(warehouseDirectory, { recursive: true });
  writeFileSync(
    join(warehouseDirectory, "2026-05-01.jsonl"),
    `${candles.map((item) => JSON.stringify({
      ...item,
      symbol,
      provider: "ibkr",
      timeframe: "5m",
      sourceFetchedAt: BASE,
      adjustmentMode: "raw",
    })).join("\n")}\n`,
    "utf8",
  );
}

function candle(index: number, close: number, high = close, low = close): Candle {
  const previous = close * 0.99;
  return {
    timestamp: BASE + index * FIVE_MINUTES,
    open: previous,
    high,
    low,
    close,
    volume: 1000,
  };
}

test("missed meaningful move audit flags a candle-backed move without nearby Discord coverage", () => {
  const directory = mkdtempSync(join(tmpdir(), "missed-move-"));
  writeCachedCandles(directory, "CYCU", [
    candle(0, 1.0, 1.01, 0.99),
    candle(1, 1.01, 1.02, 1.0),
    candle(2, 1.0, 1.02, 0.99),
    candle(3, 1.12, 1.14, 1.0),
    candle(4, 1.13, 1.14, 1.1),
    candle(5, 1.12, 1.13, 1.09),
  ]);
  const auditPath = writeAudit(directory, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE,
      symbol: "CYCU",
      title: "CYCU support and resistance",
      body: "Price is between support and resistance.",
    },
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE + 8 * FIVE_MINUTES,
      symbol: "CYCU",
      title: "CYCU support and resistance",
      body: "Quiet range recap.",
    },
  ]);

  const report = generateMissedMeaningfulMoveAudit({
    auditPath,
    cacheDirectoryPath: join(directory, ".validation-cache", "candles"),
  });
  const cycu = report.symbols.find((symbol) => symbol.symbol === "CYCU");

  assert.ok(cycu);
  assert.equal(cycu.missedCount, 1);
  assert.equal(cycu.candidates[0]?.coverage, "missed");
  assert.equal(cycu.candidates[0]?.severity, "major");
  assert.match(cycu.candidates[0]?.reason ?? "", /5m close moved/);
});

test("missed meaningful move audit treats nearby matching alert as covered", () => {
  const directory = mkdtempSync(join(tmpdir(), "covered-move-"));
  writeCachedCandles(directory, "AKAN", [
    candle(0, 40, 40.2, 39.8),
    candle(1, 40.3, 40.4, 40),
    candle(2, 40.2, 40.5, 39.9),
    candle(3, 43, 43.4, 40.2),
    candle(4, 43.2, 43.6, 42.5),
  ]);
  const auditPath = writeAudit(directory, [
    {
      operation: "post_alert",
      status: "posted",
      timestamp: BASE + 3 * FIVE_MINUTES + 2 * 60 * 1000,
      symbol: "AKAN",
      title: "AKAN breakout",
      eventType: "breakout",
      body: "price pushed above resistance",
    },
  ]);

  const report = generateMissedMeaningfulMoveAudit({
    auditPath,
    cacheDirectoryPath: join(directory, ".validation-cache", "candles"),
  });
  const akan = report.symbols.find((symbol) => symbol.symbol === "AKAN");

  assert.ok(akan);
  assert.equal(akan.coveredCount, 1);
  assert.equal(akan.missedCount, 0);
  assert.equal(akan.candidates[0]?.coverage, "covered");
});

test("missed meaningful move audit ignores ordinary small-cap wiggle", () => {
  const directory = mkdtempSync(join(tmpdir(), "ordinary-wiggle-"));
  writeCachedCandles(directory, "PBM", [
    candle(0, 5.9, 5.96, 5.85),
    candle(1, 5.94, 6.0, 5.88),
    candle(2, 5.91, 5.99, 5.86),
    candle(3, 5.95, 6.03, 5.89),
  ]);
  const auditPath = writeAudit(directory, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE,
      symbol: "PBM",
      title: "PBM support and resistance",
    },
  ]);

  const report = generateMissedMeaningfulMoveAudit({
    auditPath,
    cacheDirectoryPath: join(directory, ".validation-cache", "candles"),
  });
  const pbm = report.symbols.find((symbol) => symbol.symbol === "PBM");

  assert.ok(pbm);
  assert.equal(pbm.candidateCount, 0);
});

test("missed meaningful move audit does not call a directional candle a resistance break when no level broke", () => {
  const directory = mkdtempSync(join(tmpdir(), "directional-not-break-"));
  writeCachedCandles(directory, "AKAN", [
    candle(0, 49.0, 55.0, 48.5),
    candle(1, 49.1, 54.2, 48.9),
    candle(2, 49.0, 53.0, 48.7),
    candle(3, 51.15, 52.64, 50.0),
  ]);
  const auditPath = writeAudit(directory, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE,
      symbol: "AKAN",
      title: "AKAN support and resistance",
    },
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE + 8 * FIVE_MINUTES,
      symbol: "AKAN",
      title: "AKAN quiet recap",
    },
  ]);

  const report = generateMissedMeaningfulMoveAudit({
    auditPath,
    cacheDirectoryPath: join(directory, ".validation-cache", "candles"),
  });
  const akan = report.symbols.find((symbol) => symbol.symbol === "AKAN");
  const target = akan?.candidates.find((candidate) => candidate.timestamp === BASE + 3 * FIVE_MINUTES);

  assert.ok(akan);
  assert.ok(target);
  assert.equal(target.kind, "large_range");
  assert.match(target.reason, /without closing above recent resistance near 55\.00/);
  assert.doesNotMatch(target.reason, /pressed above recent resistance/);
});

test("missed meaningful move audit ignores a small rolling support nick but keeps a material break", () => {
  const quietDirectory = mkdtempSync(join(tmpdir(), "small-rolling-nick-"));
  writeCachedCandles(quietDirectory, "PBM", [
    candle(0, 6.27, 6.3, 6.25),
    candle(1, 6.26, 6.29, 6.25),
    candle(2, 6.13, 6.26, 6.13),
  ]);
  const quietAuditPath = writeAudit(quietDirectory, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE,
      symbol: "PBM",
      title: "PBM support and resistance",
    },
  ]);

  const quietReport = generateMissedMeaningfulMoveAudit({
    auditPath: quietAuditPath,
    cacheDirectoryPath: join(quietDirectory, ".validation-cache", "candles"),
  });
  assert.equal(quietReport.symbols.find((symbol) => symbol.symbol === "PBM")?.candidateCount, 0);

  const breakDirectory = mkdtempSync(join(tmpdir(), "material-rolling-break-"));
  writeCachedCandles(breakDirectory, "PBM", [
    candle(0, 6.27, 6.3, 6.25),
    candle(1, 6.26, 6.29, 6.25),
    candle(2, 6.05, 6.26, 6.05),
  ]);
  const breakAuditPath = writeAudit(breakDirectory, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE,
      symbol: "PBM",
      title: "PBM support and resistance",
    },
  ]);

  const breakReport = generateMissedMeaningfulMoveAudit({
    auditPath: breakAuditPath,
    cacheDirectoryPath: join(breakDirectory, ".validation-cache", "candles"),
  });
  const pbm = breakReport.symbols.find((symbol) => symbol.symbol === "PBM");
  assert.equal(pbm?.candidateCount, 1);
  assert.equal(pbm?.candidates[0]?.kind, "downside_loss");
  assert.match(pbm?.candidates[0]?.reason ?? "", /pressed .* below recent support near 6\.25/);
});

test("missed meaningful move audit can use durable warehouse candles", () => {
  const directory = mkdtempSync(join(tmpdir(), "missed-move-warehouse-"));
  writeWarehouseCandles(directory, "WHSE", [
    candle(0, 2, 2.02, 1.98),
    candle(1, 2.02, 2.04, 2),
    candle(2, 2.28, 2.3, 2.02),
  ]);
  const auditPath = writeAudit(directory, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE,
      symbol: "WHSE",
      title: "WHSE support and resistance",
    },
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE + 6 * FIVE_MINUTES,
      symbol: "WHSE",
      title: "WHSE quiet recap",
    },
  ]);

  const report = generateMissedMeaningfulMoveAudit({
    auditPath,
    cacheDirectoryPath: join(directory, ".validation-cache", "candles"),
    warehouseDirectoryPath: join(directory, "data", "candles"),
  });
  const whse = report.symbols.find((symbol) => symbol.symbol === "WHSE");

  assert.equal(report.warehouseDirectoryPath, join(directory, "data", "candles"));
  assert.ok(whse);
  assert.equal(whse.candleCount, 3);
  assert.equal(whse.candidateCount, 1);
});

test("missed meaningful move audit writes JSON and Markdown evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "missed-move-output-"));
  writeCachedCandles(directory, "FATN", [
    candle(0, 3.4, 3.45, 3.35),
    candle(1, 3.36, 3.42, 3.3),
    candle(2, 3.08, 3.36, 3.02),
  ]);
  const auditPath = writeAudit(directory, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE,
      symbol: "FATN",
      title: "FATN support and resistance",
    },
    {
      operation: "post_level_snapshot",
      status: "posted",
      timestamp: BASE + 6 * FIVE_MINUTES,
      symbol: "FATN",
      title: "FATN quiet recap",
    },
  ]);
  const jsonPath = join(directory, "missed.json");
  const markdownPath = join(directory, "missed.md");

  const report = writeMissedMeaningfulMoveAudit({
    auditPath,
    cacheDirectoryPath: join(directory, ".validation-cache", "candles"),
    jsonPath,
    markdownPath,
  });
  const markdown = readFileSync(markdownPath, "utf8");

  assert.equal(report.totals.symbols, 1);
  assert.match(markdown, /Missed Meaningful Move Audit/);
  assert.match(markdown, /nearest posts/);
  assert.match(readFileSync(jsonPath, "utf8"), /missedCount/);
});
