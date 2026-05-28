import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  formatWarehouseVolumeActivityReport,
  generateWarehouseVolumeActivityReport,
  writeWarehouseVolumeActivityReport,
} from "../lib/review/warehouse-volume-activity-report.js";
import type { Candle } from "../lib/support-resistance/index.js";

const START = Date.parse("2026-05-01T13:30:00.000Z");
const FIVE_MINUTES = 5 * 60 * 1000;

function candle(index: number, volume: number, close = 2): Candle {
  return {
    timestamp: START + index * FIVE_MINUTES,
    open: close,
    high: close + 0.03,
    low: close - 0.03,
    close,
    volume,
  };
}

function writeAuditRows(directory: string, rows: object[]): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");
  return path;
}

function writeCache(params: {
  root: string;
  provider?: string;
  symbol: string;
  candles: Candle[];
}): void {
  const provider = params.provider ?? "ibkr";
  const directory = join(params.root, provider, params.symbol, "5m");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${params.candles.length}-${params.candles.at(-1)!.timestamp}.json`),
    `${JSON.stringify({
      response: {
        candles: params.candles,
      },
    })}\n`,
    "utf8",
  );
}

test("warehouse volume activity report separates helpful volume context from operator-only context", () => {
  const root = mkdtempSync(join(tmpdir(), "warehouse-volume-report-"));
  const auditPath = writeAuditRows(join(root, "session"), [
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: START + 23 * FIVE_MINUTES,
      symbol: "VOLM",
      title: "VOLM breakout",
      eventType: "breakout",
      triggerPrice: 2.2,
    },
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: START + 23 * FIVE_MINUTES,
      symbol: "THIN",
      title: "THIN level touch",
      eventType: "level_touch",
      triggerPrice: 0.2,
    },
  ]);
  writeCache({
    root: join(root, "cache"),
    symbol: "VOLM",
    candles: Array.from({ length: 24 }, (_, index) =>
      candle(index, index === 23 ? 300_000 : 100_000, 2 + index * 0.01),
    ),
  });
  writeCache({
    root: join(root, "cache"),
    symbol: "THIN",
    candles: Array.from({ length: 24 }, (_, index) =>
      candle(index, index === 23 ? 500 : 400, 0.2),
    ),
  });

  const report = generateWarehouseVolumeActivityReport({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
  });
  const markdown = formatWarehouseVolumeActivityReport(report);

  assert.equal(report.totals.alertRows, 2);
  assert.equal(report.totals.matchedRows, 2);
  assert.ok(report.totals.wouldHelpCount >= 1);
  assert.ok(report.totals.shouldStayHiddenCount >= 1);
  assert.equal(report.totals.interactionCounts.expanding_into_resistance, 1);
  assert.equal(report.totals.interactionCounts.stale_or_unreliable, 1);
  assert.equal(report.symbols.find((symbol) => symbol.symbol === "VOLM")?.wouldHelpCount, 1);
  assert.equal(report.symbols.find((symbol) => symbol.symbol === "THIN")?.shouldStayHiddenCount, 1);
  assert.match(markdown, /Volume Context That May Help/);
  assert.match(markdown, /interaction counts/i);
  assert.match(markdown, /keep operator-only/i);
});

test("warehouse volume activity writer creates JSON and markdown artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "warehouse-volume-write-"));
  const auditPath = writeAuditRows(join(root, "session"), [
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: START + 23 * FIVE_MINUTES,
      symbol: "WRITE",
      title: "WRITE breakout",
    },
  ]);
  writeCache({
    root: join(root, "cache"),
    symbol: "WRITE",
    candles: Array.from({ length: 24 }, (_, index) => candle(index, 100_000, 2)),
  });

  const report = writeWarehouseVolumeActivityReport({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
    jsonPath: join(root, "out", "report.json"),
    markdownPath: join(root, "out", "report.md"),
  });

  assert.equal(report.totals.alertRows, 1);
  assert.equal(JSON.parse(readFileSync(join(root, "out", "report.json"), "utf8")).totals.alertRows, 1);
  assert.match(readFileSync(join(root, "out", "report.md"), "utf8"), /Warehouse Volume Activity Replay Report/);
});
