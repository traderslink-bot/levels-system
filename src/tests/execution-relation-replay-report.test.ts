import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  generateExecutionRelationReplayReport,
  writeExecutionRelationReplayReport,
} from "../lib/review/execution-relation-replay-report.js";
import type { Candle, CandleFetchTimeframe } from "../lib/support-resistance/index.js";

const DAY = 24 * 60 * 60_000;
const FOUR_HOURS = 4 * 60 * 60_000;
const FIVE_MINUTES = 5 * 60_000;
const START = Date.parse("2026-05-01T13:30:00.000Z");

function candle(timestamp: number, close: number, volume = 100_000): Candle {
  return {
    timestamp,
    open: close,
    high: Number((close * 1.02).toFixed(4)),
    low: Number((close * 0.98).toFixed(4)),
    close,
    volume,
  };
}

function wave(count: number, start: number, interval: number, base: number, amplitude: number): Candle[] {
  return Array.from({ length: count }, (_, index) =>
    candle(
      start + index * interval,
      Number((base + Math.sin(index / 3) * amplitude + index * amplitude * 0.01).toFixed(4)),
      100_000 + index * 100,
    ),
  );
}

function writeAuditRows(directory: string, rows: object[]): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "discord-delivery-audit.jsonl");
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
    join(directory, `${params.timeframe}.json`),
    `${JSON.stringify({ response: { candles: params.candles } })}\n`,
    "utf8",
  );
}

test("execution relation replay reports nearby level context from saved candles", async () => {
  const root = mkdtempSync(join(tmpdir(), "execution-replay-"));
  const timestamp = START + 80 * FIVE_MINUTES;
  const auditPath = writeAuditRows(join(root, "session"), [
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: timestamp,
      symbol: "REL",
      title: "REL breakout",
      eventType: "breakout",
      triggerPrice: 2.1,
    },
  ]);
  writeCache({
    root: join(root, "cache"),
    symbol: "REL",
    timeframe: "daily",
    candles: wave(120, START - 120 * DAY, DAY, 2, 0.18),
  });
  writeCache({
    root: join(root, "cache"),
    symbol: "REL",
    timeframe: "4h",
    candles: wave(120, START - 120 * FOUR_HOURS, FOUR_HOURS, 2, 0.12),
  });
  writeCache({
    root: join(root, "cache"),
    symbol: "REL",
    timeframe: "5m",
    candles: wave(90, START, FIVE_MINUTES, 2, 0.05),
  });

  const report = await generateExecutionRelationReplayReport({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
  });

  assert.equal(report.totals.postsReviewed, 1);
  assert.equal(report.totals.validRelationSamples, 1);
  assert.equal(report.symbols[0]?.samples[0]?.price, 2.1);
  assert.notEqual(report.symbols[0]?.samples[0]?.nearestSupportBelow, undefined);
});

test("execution relation replay writer creates artifacts and flags missing evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "execution-replay-write-"));
  const auditPath = writeAuditRows(join(root, "session"), [
    {
      operation: "post_alert",
      status: "posted",
      sourceTimestamp: START,
      symbol: "MISS",
      title: "MISS level touch",
      triggerPrice: 1.2,
    },
  ]);

  const report = await writeExecutionRelationReplayReport({
    auditPath,
    cacheDirectoryPath: join(root, "cache"),
    jsonPath: join(root, "out", "report.json"),
    markdownPath: join(root, "out", "report.md"),
  });

  assert.equal(report.totals.needsCandleEvidenceCount, 1);
  assert.ok(existsSync(join(root, "out", "report.json")));
  assert.match(readFileSync(join(root, "out", "report.md"), "utf8"), /Needs Candle Evidence/);
});
