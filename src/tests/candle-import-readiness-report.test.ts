import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCandleImportReadinessReport,
  formatCandleImportReadinessReport,
  writeCandleImportReadinessReport,
} from "../lib/review/candle-import-readiness-report.js";
import { DurableCandleWarehouse, type Candle } from "../lib/support-resistance/index.js";

function candle(timestamp: number, close = 1): Candle {
  return {
    timestamp,
    open: close,
    high: close + 0.05,
    low: close - 0.05,
    close,
    volume: 1000,
  };
}

function writeAuditRows(sessionDirectory: string, rows: object[]): void {
  mkdirSync(sessionDirectory, { recursive: true });
  writeFileSync(
    join(sessionDirectory, "discord-delivery-audit.jsonl"),
    rows.map((row) => JSON.stringify(row)).join("\n"),
    "utf8",
  );
}

test("candle import readiness report compares saved session symbols against durable warehouse coverage", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-import-readiness-"));
  const sessionDirectory = join(root, "session");
  const warehouseRoot = join(root, "warehouse");
  const asOfTimestamp = Date.UTC(2026, 4, 1, 14, 0, 0);
  writeAuditRows(sessionDirectory, [
    {
      operation: "post_level_snapshot",
      status: "posted",
      sourceTimestamp: asOfTimestamp,
      symbol: "READY",
    },
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: asOfTimestamp,
      symbol: "EMPTY",
    },
  ]);
  const warehouse = new DurableCandleWarehouse(warehouseRoot);
  await warehouse.upsertCandles({
    provider: "ibkr",
    symbol: "READY",
    timeframe: "1m",
    candles: [
      candle(asOfTimestamp - 2 * 60_000, 1),
      candle(asOfTimestamp - 60_000, 1.01),
      candle(asOfTimestamp, 1.02),
    ],
  });

  const report = await buildCandleImportReadinessReport({
    auditPath: sessionDirectory,
    warehouseDirectoryPath: warehouseRoot,
    timeframes: ["1m"],
    maxTrades: 2,
  });

  assert.equal(report.tradeCount, 2);
  assert.equal(report.symbolCount, 2);
  assert.equal(report.plan.plannedTaskCount, 2);
  assert.equal(report.plan.missingTaskCount, 2);
  assert.ok(report.plan.tasks.some((task) => task.symbol === "READY" && task.coverage.candleCount === 3));
  assert.ok(report.plan.tasks.some((task) => task.symbol === "EMPTY" && task.coverage.candleCount === 0));
  assert.match(formatCandleImportReadinessReport(report), /Missing Range Evidence/);
});

test("candle import readiness writer creates JSON and markdown artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "candle-import-readiness-write-"));
  const sessionDirectory = join(root, "session");
  const outputDirectory = join(root, "out");
  writeAuditRows(sessionDirectory, [
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: Date.UTC(2026, 4, 1, 14, 0, 0),
      symbol: "WRITE",
    },
  ]);

  const report = await writeCandleImportReadinessReport({
    auditPath: sessionDirectory,
    warehouseDirectoryPath: join(root, "warehouse"),
    timeframes: ["5m"],
    jsonPath: join(outputDirectory, "report.json"),
    markdownPath: join(outputDirectory, "report.md"),
  });

  assert.equal(report.tradeCount, 1);
  assert.equal(JSON.parse(readFileSync(join(outputDirectory, "report.json"), "utf8")).tradeCount, 1);
  assert.match(readFileSync(join(outputDirectory, "report.md"), "utf8"), /Candle Import Readiness Report/);
});
