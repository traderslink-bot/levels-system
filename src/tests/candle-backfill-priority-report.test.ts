import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCandleBackfillPriorityReport,
  formatCandleBackfillPriorityReport,
  writeCandleBackfillPriorityReport,
} from "../lib/review/candle-backfill-priority-report.js";
import {
  writeCandleBackfillStageManifest,
} from "../lib/review/candle-backfill-stage-manifest.js";
import {
  writeCandleWarehouseBackfillReport,
} from "../lib/review/candle-warehouse-backfill-report.js";
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

function postedRow(symbol: string, timestamp: number, price: number): object {
  return {
    type: "discord_delivery_audit",
    operation: "post_level_snapshot",
    status: "posted",
    sourceTimestamp: timestamp,
    timestamp,
    symbol,
    title: `${symbol} support and resistance`,
    body: `Price: ${price.toFixed(2)}\nResistance:\n${(price * 1.1).toFixed(2)}\nSupport:\n${(price * 0.9).toFixed(2)}`,
  };
}

test("candle backfill priority ranks quiet-risk candle gaps above ordinary gaps", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-backfill-priority-"));
  writeCache(root, "MOVE", [
    candle(START, 1),
    candle(START + FIVE_MINUTES, 1.01),
    candle(START + 4 * FIVE_MINUTES, 1.22),
    candle(START + 5 * FIVE_MINUTES, 1.23),
  ]);
  writeCache(root, "CALM", Array.from({ length: 10 }, (_, index) => candle(START + index * FIVE_MINUTES, 2 + index * 0.001)));
  const sessionDirectory = join(root, "session");
  const auditPath = writeAuditRows(sessionDirectory, [
    postedRow("MOVE", START, 1),
    postedRow("MOVE", START + 40 * FIVE_MINUTES, 1.23),
    postedRow("CALM", START, 2),
  ]);
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

  const report = await buildCandleBackfillPriorityReport({
    auditPath,
    warehouseDirectoryPath: join(root, "warehouse"),
    cacheDirectoryPath: join(root, "cache"),
    timeframes: ["daily", "4h", "5m", "1m"],
    maxTasksPerStage: 3,
    maxEstimatedCandlesPerStage: 2_000,
  });

  assert.ok(report.totals.fetchFirstTasks > 0);
  assert.equal(report.rankedTasks[0]?.symbol, "MOVE");
  assert.equal(report.rankedTasks[0]?.priority, "fetch_first");
  assert.ok(report.rankedTasks[0]?.reasons.some((reason) => /quiet may hide/i.test(reason)));
  assert.ok(report.rankedTasks.some((task) => task.reasons.some((reason) => /support\/resistance calibration/i.test(reason))));
  assert.ok(report.totals.supportResistanceUnprovenSymbols > 0);
  assert.ok(report.priorityBySymbolSession[0]?.missingTimeframes.includes("5m"));
  assert.match(formatCandleBackfillPriorityReport(report), /Fetch First Symbol \/ Session Gaps/);
  assert.match(formatCandleBackfillPriorityReport(report), /quiet may hide/i);
});

test("candle backfill priority stages provider work within configured limits", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-backfill-priority-stages-"));
  const rows: object[] = [];
  for (const symbol of ["AAA", "BBB", "CCC", "DDD"]) {
    writeCache(root, symbol, [
      candle(START, 1),
      candle(START + FIVE_MINUTES, 1.02),
      candle(START + 4 * FIVE_MINUTES, 1.25),
    ]);
    rows.push(postedRow(symbol, START, 1));
    rows.push(postedRow(symbol, START + 40 * FIVE_MINUTES, 1.25));
  }
  const auditPath = writeAuditRows(join(root, "session"), rows);

  const report = await buildCandleBackfillPriorityReport({
    auditPath,
    warehouseDirectoryPath: join(root, "warehouse"),
    cacheDirectoryPath: join(root, "cache"),
    timeframes: ["5m", "1m"],
    maxTasksPerStage: 2,
    maxEstimatedCandlesPerStage: 2_000,
  });

  assert.ok(report.providerStages.length > 1);
  assert.ok(report.providerStages.every((stage) => stage.taskCount <= 2));
  const uniqueTasks = new Set(report.rankedTasks.map((task) => `${task.symbol}:${task.sessionDate}:${task.timeframe}`));
  assert.equal(uniqueTasks.size, report.rankedTasks.length);
});

test("candle backfill priority writer creates JSON and markdown artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-backfill-priority-write-"));
  writeCache(root, "WRITE", [
    candle(START, 1),
    candle(START + FIVE_MINUTES, 1.01),
    candle(START + 4 * FIVE_MINUTES, 1.2),
  ]);
  const auditPath = writeAuditRows(join(root, "session"), [
    postedRow("WRITE", START, 1),
    postedRow("WRITE", START + 40 * FIVE_MINUTES, 1.2),
  ]);

  const report = await writeCandleBackfillPriorityReport({
    auditPath,
    warehouseDirectoryPath: join(root, "warehouse"),
    cacheDirectoryPath: join(root, "cache"),
    timeframes: ["5m"],
    jsonPath: join(root, "out", "priority.json"),
    markdownPath: join(root, "out", "priority.md"),
  });

  assert.ok(report.totals.missingTasks > 0);
  assert.ok(existsSync(join(root, "out", "priority.json")));
  assert.match(readFileSync(join(root, "out", "priority.md"), "utf8"), /Candle Backfill Priority Report/);
});

test("candle backfill priority passes all-session audit caps into composed reports", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-backfill-priority-max-sessions-"));
  writeAuditRows(join(root, "2026-05-01"), [
    postedRow("AAA", START, 1),
    postedRow("AAA", START + 40 * FIVE_MINUTES, 1.2),
  ]);
  writeAuditRows(join(root, "2026-05-02"), [
    postedRow("BBB", START, 2),
    postedRow("BBB", START + 40 * FIVE_MINUTES, 2.2),
  ]);
  writeCache(root, "AAA", [
    candle(START, 1),
    candle(START + FIVE_MINUTES, 1.01),
    candle(START + 4 * FIVE_MINUTES, 1.2),
  ]);
  writeCache(root, "BBB", [
    candle(START, 2),
    candle(START + FIVE_MINUTES, 2.01),
    candle(START + 4 * FIVE_MINUTES, 2.2),
  ]);

  const report = await buildCandleBackfillPriorityReport({
    auditPath: root,
    warehouseDirectoryPath: join(root, "warehouse"),
    cacheDirectoryPath: join(root, "cache"),
    timeframes: ["5m"],
    maxAuditFiles: 1,
    maxTasksPerStage: 2,
  });

  assert.equal(report.sourceAuditPaths.length, 1);
  assert.ok(report.rankedTasks.every((task) => task.symbol === "AAA"));
  assert.equal(report.totals.supportResistanceUnprovenSymbols, 1);
});

test("priority stage manifest hands one stage to dry-run backfill", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-backfill-stage-manifest-"));
  const auditPath = writeAuditRows(join(root, "session"), [
    postedRow("ONE", START, 1),
    postedRow("ONE", START + 40 * FIVE_MINUTES, 1.2),
    postedRow("TWO", START, 2),
    postedRow("TWO", START + 40 * FIVE_MINUTES, 2.2),
  ]);
  writeCache(root, "ONE", [
    candle(START, 1),
    candle(START + FIVE_MINUTES, 1.01),
    candle(START + 4 * FIVE_MINUTES, 1.2),
  ]);
  writeCache(root, "TWO", [
    candle(START, 2),
    candle(START + FIVE_MINUTES, 2.01),
    candle(START + 4 * FIVE_MINUTES, 2.2),
  ]);
  const priority = await writeCandleBackfillPriorityReport({
    auditPath,
    warehouseDirectoryPath: join(root, "warehouse"),
    cacheDirectoryPath: join(root, "cache"),
    timeframes: ["5m"],
    maxTasksPerStage: 1,
    jsonPath: join(root, "priority", "candle-backfill-priority.json"),
    markdownPath: join(root, "priority", "candle-backfill-priority.md"),
  });

  const manifest = writeCandleBackfillStageManifest({
    priorityReportPath: join(root, "priority", "candle-backfill-priority.json"),
    stageIndex: 1,
    warehouseDirectoryPath: join(root, "warehouse"),
    outputDirectory: join(root, "backfill"),
    jsonPath: join(root, "manifest", "manifest.json"),
    markdownPath: join(root, "manifest", "manifest.md"),
  });
  const expectedSymbol = priority.providerStages[0]?.tasks[0]?.symbol;

  assert.equal(manifest.selectedStageIndex, 1);
  assert.equal(manifest.taskCount, 1);
  assert.equal(manifest.tasks[0]?.symbol, expectedSymbol);
  assert.match(manifest.safeDryRunCommand, /--priority-stage 1/);
  assert.match(readFileSync(join(root, "manifest", "manifest.md"), "utf8"), /Safe dry-run first/);

  const backfill = await writeCandleWarehouseBackfillReport({
    auditPath,
    warehouseDirectoryPath: join(root, "warehouse"),
    priorityReportPath: join(root, "priority", "candle-backfill-priority.json"),
    priorityStage: 1,
    timeframes: ["5m"],
    jsonPath: join(root, "backfill", "backfill.json"),
    markdownPath: join(root, "backfill", "backfill.md"),
  });

  assert.equal(backfill.mode, "dry_run");
  assert.equal(backfill.totals.plannedTasks, 1);
  assert.equal(backfill.taskResults[0]?.symbol, expectedSymbol);
});
