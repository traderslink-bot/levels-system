import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { Candle, CandleFetchTimeframe } from "../lib/market-data/candle-types.js";
import {
  buildSupportResistanceCalibrationReport,
  evaluateSupportResistanceCalibrationGate,
  formatSupportResistanceCalibrationReport,
  writeSupportResistanceCalibrationGate,
  writeSupportResistanceCalibrationReport,
} from "../lib/review/support-resistance-calibration-report.js";

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
    return candle(params.start + index * params.intervalMs, Number(close.toFixed(4)), 100_000 + index * 250);
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

function seedDemoCandles(cacheRoot: string, symbol: string, base = 3.2): void {
  writeCache({
    root: cacheRoot,
    symbol,
    timeframe: "daily",
    candles: waveCandles({
      count: 190,
      start: Date.UTC(2025, 10, 1),
      intervalMs: DAY,
      base,
      wave: base * 0.07,
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
      base,
      wave: base * 0.04,
    }),
  });
  writeCache({
    root: cacheRoot,
    symbol,
    timeframe: "5m",
    candles: waveCandles({
      count: 170,
      start: Date.UTC(2026, 4, 1, 12, 0),
      intervalMs: FIVE_MINUTES,
      base,
      wave: base * 0.03,
    }),
  });
}

test("support/resistance calibration report builds forward reaction and ladder evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "support-resistance-calibration-"));
  const sessionDirectory = join(root, "session");
  const cacheRoot = join(root, "cache");
  mkdirSync(sessionDirectory, { recursive: true });
  seedDemoCandles(cacheRoot, "DEMO");
  writeAuditRows(sessionDirectory, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 1, 15, 0),
      symbol: "DEMO",
      title: "DEMO support and resistance",
      body: "Price: 3.21",
    },
  ]);

  const report = await buildSupportResistanceCalibrationReport({
    auditPath: sessionDirectory,
    cacheDirectoryPath: cacheRoot,
  });

  assert.equal(report.symbolsReviewed, 1);
  const demo = report.symbols[0]!;
  assert.equal(demo.symbol, "DEMO");
  assert.ok(demo.forwardReaction.totalLevelsEvaluated > 0);
  assert.ok(demo.levelCounts.surfacedSupport + demo.levelCounts.surfacedResistance > 0);
  assert.notEqual(demo.forwardLadder.verdict, "unproven");
  assert.ok(demo.rankingProof.buckets.length > 0);
  assert.notEqual(demo.marketStructure.alignment, "insufficient");
  assert.equal(demo.coverageGaps.length, 0);

  const markdown = formatSupportResistanceCalibrationReport(report);
  assert.match(markdown, /Support \/ Resistance Calibration Report/);
  assert.match(markdown, /Forward reaction:/);
  assert.match(markdown, /Forward ladder:/);
  assert.match(markdown, /Ranking proof:/);
  assert.match(markdown, /Market-structure link:/);
});

test("support/resistance calibration separates missing candles from level logic", async () => {
  const root = mkdtempSync(join(tmpdir(), "support-resistance-calibration-missing-"));
  const sessionDirectory = join(root, "session");
  mkdirSync(sessionDirectory, { recursive: true });
  writeAuditRows(sessionDirectory, [
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 1, 15, 0),
      symbol: "MISS",
      title: "MISS breakout",
      body: "Triggered near: 1.05",
    },
  ]);

  const report = await buildSupportResistanceCalibrationReport({
    auditPath: sessionDirectory,
    cacheDirectoryPath: join(root, "cache"),
  });

  const miss = report.symbols[0]!;
  assert.equal(miss.symbol, "MISS");
  assert.equal(miss.verdict, "unproven");
  assert.equal(report.totals.missingCandleSymbols, 1);
  assert.ok(report.totals.fetchFirstCoverageGaps >= 3);
  assert.ok(miss.coverageGaps.some((gap) => gap.timeframe === "daily" && gap.priority === "fetch_first"));
  assert.ok(miss.forwardLadder.reasons.some((reason) => /missing daily candles/.test(reason)));
});

test("support/resistance calibration flags no forward resistance without inventing levels", async () => {
  const root = mkdtempSync(join(tmpdir(), "support-resistance-calibration-forward-"));
  const sessionDirectory = join(root, "session");
  const cacheRoot = join(root, "cache");
  mkdirSync(sessionDirectory, { recursive: true });
  seedDemoCandles(cacheRoot, "HIGH", 3.2);
  writeAuditRows(sessionDirectory, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 1, 15, 0),
      symbol: "HIGH",
      title: "HIGH support and resistance",
      body: "Price: 8.00",
    },
  ]);

  const report = await buildSupportResistanceCalibrationReport({
    auditPath: sessionDirectory,
    cacheDirectoryPath: cacheRoot,
  });

  const high = report.symbols[0]!;
  assert.equal(high.forwardLadder.nearestResistance, null);
  assert.ok(high.forwardLadder.reasons.some((reason) => /no forward resistance/.test(reason)));
  assert.equal(report.totals.noForwardResistanceSymbols, 1);
  assert.ok(["trusted", "watch", "broken", "unproven"].includes(high.rankingProof.verdict));
});

test("support/resistance calibration writer creates JSON and markdown artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "support-resistance-calibration-write-"));
  const sessionDirectory = join(root, "session");
  const cacheRoot = join(root, "cache");
  const outputDirectory = join(root, "out");
  mkdirSync(sessionDirectory, { recursive: true });
  seedDemoCandles(cacheRoot, "DEMO");
  writeAuditRows(sessionDirectory, [
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 1, 15, 10),
      symbol: "DEMO",
      title: "DEMO breakout",
      body: "Triggered near: 3.25",
    },
  ]);

  const report = await writeSupportResistanceCalibrationReport({
    auditPath: sessionDirectory,
    cacheDirectoryPath: cacheRoot,
    jsonPath: join(outputDirectory, "support-resistance-calibration.json"),
    markdownPath: join(outputDirectory, "support-resistance-calibration.md"),
  });

  assert.equal(report.symbolsReviewed, 1);
  assert.equal(
    JSON.parse(readFileSync(join(outputDirectory, "support-resistance-calibration.json"), "utf8")).symbolsReviewed,
    1,
  );
  assert.match(
    readFileSync(join(outputDirectory, "support-resistance-calibration.md"), "utf8"),
    /Support \/ Resistance Calibration Report/,
  );

  const gate = evaluateSupportResistanceCalibrationGate(report, {
    maxBrokenSymbols: 0,
    maxWatchSymbols: 10,
    maxUnprovenPct: 1,
    maxFetchFirstCoverageGaps: 10,
    maxNoForwardResistanceSymbols: 10,
    maxRankingWatchSymbols: 10,
    maxStructureQuestionSymbols: 10,
  });
  assert.ok(["pass", "review", "fail"].includes(gate.status));
  const writtenGate = writeSupportResistanceCalibrationGate({
    report,
    jsonPath: join(outputDirectory, "support-resistance-calibration-gate.json"),
    markdownPath: join(outputDirectory, "support-resistance-calibration-gate.md"),
  });
  assert.equal(writtenGate.sourceAuditPath, report.sourceAuditPath);
  assert.match(
    readFileSync(join(outputDirectory, "support-resistance-calibration-gate.md"), "utf8"),
    /Support \/ Resistance Calibration Gate/,
  );
});

test("support/resistance calibration can cap all-session audit files before symbol review", async () => {
  const root = mkdtempSync(join(tmpdir(), "support-resistance-calibration-max-sessions-"));
  const cacheRoot = join(root, "cache");
  const sessionA = join(root, "2026-05-01");
  const sessionB = join(root, "2026-05-02");
  mkdirSync(sessionA, { recursive: true });
  mkdirSync(sessionB, { recursive: true });
  writeAuditRows(sessionA, [
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 1, 15, 0),
      symbol: "AAA",
      title: "AAA breakout",
      body: "Triggered near: 1.00",
    },
  ]);
  writeAuditRows(sessionB, [
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 2, 15, 0),
      symbol: "BBB",
      title: "BBB breakout",
      body: "Triggered near: 2.00",
    },
  ]);

  const report = await buildSupportResistanceCalibrationReport({
    auditPath: root,
    cacheDirectoryPath: cacheRoot,
    maxAuditFiles: 1,
  });

  assert.equal(report.sourceAuditPaths.length, 1);
  assert.equal(report.symbolsReviewed, 1);
  assert.equal(report.symbols[0]?.symbol, "AAA");
});
