import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCandleIntelligenceCalibrationReport,
  formatCandleIntelligenceCalibrationReport,
  writeCandleIntelligenceCalibrationReport,
} from "../lib/review/candle-intelligence-calibration.js";
import type { Candle, CandleFetchTimeframe } from "../lib/support-resistance/index.js";

const FIVE_MINUTES = 5 * 60_000;
const DAY = 24 * 60 * 60_000;

function candle(timestamp: number, close: number, volume = 100_000): Candle {
  return {
    timestamp,
    open: close,
    high: Number((close * 1.025).toFixed(4)),
    low: Number((close * 0.975).toFixed(4)),
    close,
    volume,
  };
}

function waveCandles(params: {
  count: number;
  start: number;
  intervalMs: number;
  base: number;
  wave: number;
}): Candle[] {
  return Array.from({ length: params.count }, (_, index) => {
    const close = params.base + Math.sin(index / 3) * params.wave + Math.cos(index / 7) * params.wave * 0.4;
    return candle(params.start + index * params.intervalMs, Number(close.toFixed(4)), 100_000 + index * 500);
  });
}

function writeAuditRows(sessionDirectory: string, rows: object[]): string {
  const path = join(sessionDirectory, "discord-delivery-audit.jsonl");
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");
  return path;
}

function writeCache(params: {
  root: string;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  candles: Candle[];
}): void {
  const directory = join(params.root, "ibkr", params.symbol, params.timeframe);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "cache.json"),
    JSON.stringify({
      request: {
        symbol: params.symbol,
        timeframe: params.timeframe,
        provider: "ibkr",
      },
      response: {
        symbol: params.symbol,
        timeframe: params.timeframe,
        candles: params.candles,
      },
    }),
    "utf8",
  );
}

function seedDemoCandles(cacheRoot: string, symbol: string): void {
  writeCache({
    root: cacheRoot,
    symbol,
    timeframe: "daily",
    candles: waveCandles({
      count: 190,
      start: Date.UTC(2025, 10, 1),
      intervalMs: DAY,
      base: 3.25,
      wave: 0.22,
    }),
  });
  writeCache({
    root: cacheRoot,
    symbol,
    timeframe: "4h",
    candles: waveCandles({
      count: 150,
      start: Date.UTC(2026, 3, 20, 13, 30),
      intervalMs: 4 * 60 * 60_000,
      base: 3.15,
      wave: 0.11,
    }),
  });
  writeCache({
    root: cacheRoot,
    symbol,
    timeframe: "5m",
    candles: waveCandles({
      count: 130,
      start: Date.UTC(2026, 4, 1, 12, 0),
      intervalMs: FIVE_MINUTES,
      base: 3.2,
      wave: 0.06,
    }),
  });
}

test("candle intelligence calibration report surfaces candle-backed evidence per symbol", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-intelligence-calibration-"));
  const sessionDirectory = join(root, "session");
  const cacheRoot = join(root, "cache");
  mkdirSync(sessionDirectory, { recursive: true });
  seedDemoCandles(cacheRoot, "DEMO");
  writeAuditRows(sessionDirectory, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 1, 14, 0),
      symbol: "DEMO",
      title: "DEMO support and resistance",
      body: "Price: 3.21\nClosest levels to watch:\nResistance:\n3.35 (+4.4%, moderate)\n\nSupport:\n3.10 (-3.4%, major)",
    },
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 1, 14, 5),
      symbol: "MISS",
      title: "MISS support crossed lower",
      body: "price slipped below 1.02; nearby support below is 0.98",
    },
  ]);

  const report = await buildCandleIntelligenceCalibrationReport({
    auditPath: sessionDirectory,
    cacheDirectoryPath: cacheRoot,
  });

  const demo = report.symbols.find((symbol) => symbol.symbol === "DEMO");
  const miss = report.symbols.find((symbol) => symbol.symbol === "MISS");
  assert.ok(demo);
  assert.equal(demo.candles.daily, 190);
  assert.equal(demo.referenceLevels.trust, "trusted");
  assert.notEqual(demo.executionRelations.trust, "broken");
  assert.ok(demo.referenceLevels.levels?.previousDayHigh);
  assert.ok(miss);
  assert.equal(miss.referenceLevels.trust, "broken");
  assert.equal(report.totals.missingCandleSymbols, 1);
  assert.equal(report.sourceAuditPaths.length, 1);
  assert.equal(report.totals.trustedRelations, 1);

  const markdown = formatCandleIntelligenceCalibrationReport(report);
  assert.match(markdown, /Symbol Evidence/);
  assert.match(markdown, /DEMO/);
  assert.match(markdown, /MISS/);
});

test("candle intelligence calibration writer creates JSON and markdown artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-intelligence-calibration-write-"));
  const sessionDirectory = join(root, "session");
  const cacheRoot = join(root, "cache");
  const outputDirectory = join(root, "out");
  mkdirSync(sessionDirectory, { recursive: true });
  seedDemoCandles(cacheRoot, "DEMO");
  writeAuditRows(sessionDirectory, [
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 1, 14, 10),
      symbol: "DEMO",
      title: "DEMO breakout",
      body: "Triggered near: 3.24",
    },
  ]);

  const report = await writeCandleIntelligenceCalibrationReport({
    auditPath: sessionDirectory,
    cacheDirectoryPath: cacheRoot,
    jsonPath: join(outputDirectory, "report.json"),
    markdownPath: join(outputDirectory, "report.md"),
  });

  assert.equal(report.symbolsReviewed, 1);
  assert.equal(JSON.parse(readFileSync(join(outputDirectory, "report.json"), "utf8")).symbolsReviewed, 1);
  assert.match(readFileSync(join(outputDirectory, "report.md"), "utf8"), /Candle Intelligence Calibration Report/);
});

test("candle intelligence calibration can scan multiple sessions and tags known problem symbols", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-intelligence-calibration-multi-"));
  const cacheRoot = join(root, "cache");
  const sessionOne = join(root, "2026-05-01_09-30-00");
  const sessionTwo = join(root, "2026-05-02_09-30-00");
  mkdirSync(sessionOne, { recursive: true });
  mkdirSync(sessionTwo, { recursive: true });
  seedDemoCandles(cacheRoot, "CYCU");
  seedDemoCandles(cacheRoot, "CUE");
  writeAuditRows(sessionOne, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 1, 14, 0),
      symbol: "CYCU",
      title: "CYCU support and resistance",
      body: "Price: 1.01",
    },
  ]);
  writeAuditRows(sessionTwo, [
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 2, 14, 0),
      symbol: "CUE",
      title: "CUE breakout",
      body: "Triggered near: 3.24",
    },
  ]);

  const report = await buildCandleIntelligenceCalibrationReport({
    auditPath: root,
    cacheDirectoryPath: cacheRoot,
  });

  assert.equal(report.sourceAuditPaths.length, 2);
  assert.equal(report.symbolsReviewed, 2);
  assert.equal(report.totals.knownProblemSymbolsReviewed, 2);
  assert.ok(report.symbols.every((symbol) => symbol.evidence.knownProblemFlags.length === 1));
  assert.match(formatCandleIntelligenceCalibrationReport(report), /Known Problem Symbol Regression Evidence/);
});
