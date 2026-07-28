import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildMarketStructureCalibrationReport,
  formatMarketStructureCalibrationMarkdown,
  writeMarketStructureCalibrationReport,
} from "../lib/review/market-structure-calibration-report.js";
import type { Candle } from "../lib/support-resistance/index.js";

const START = Date.UTC(2026, 4, 1, 13, 30, 0);
const FIVE_MINUTES = 5 * 60 * 1000;

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1]!;
    return {
      timestamp: START + index * FIVE_MINUTES,
      open,
      high: Math.max(open, close) + 0.01,
      low: Math.max(0.01, Math.min(open, close) - 0.01),
      close,
      volume: 100_000 + index * 1_000,
    };
  });
}

function writeCacheFile(params: {
  root: string;
  symbol: string;
  candles: Candle[];
}): void {
  const endTimeMs = params.candles.at(-1)!.timestamp;
  const directory = join(params.root, params.symbol, "5m");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${params.candles.length}-${endTimeMs}.json`),
    `${JSON.stringify({
      request: { symbol: params.symbol, timeframe: "5m", lookbackBars: params.candles.length, endTimeMs, provider: "ibkr" },
      response: { candles: params.candles },
    })}\n`,
  );
}

function writeAuditFile(params: { root: string; rows: unknown[] }): string {
  const directory = join(params.root, "long-run", "2026-05-01_09-30-00");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "discord-delivery-audit.jsonl");
  writeFileSync(path, `${params.rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return path;
}

test("market structure calibration joins replay evidence with Discord alignment", () => {
  const root = mkdtempSync(join(tmpdir(), "market-structure-calibration-"));
  try {
    const cacheRoot = join(root, "cache");
    const auditRoot = join(root, "artifacts");
    writeCacheFile({
      root: cacheRoot,
      symbol: "CALM",
      candles: candlesFromCloses([
        1.00, 1.04, 1.01, 1.05, 1.00,
        1.04, 1.01, 1.05, 1.00, 1.04,
        1.01, 1.05, 1.00, 1.04, 1.01,
        1.05, 1.02, 1.04, 1.01, 1.03,
      ]),
    });
    writeAuditFile({
      root: auditRoot,
      rows: [
        {
          type: "discord_delivery_audit",
          operation: "post_alert",
          status: "posted",
          timestamp: START + 16 * FIVE_MINUTES,
          symbol: "CALM",
          title: "CALM level touch",
          body: "price testing resistance",
        },
        {
          type: "discord_delivery_audit",
          operation: "post_alert",
          status: "posted",
          timestamp: START + 16 * FIVE_MINUTES + 60_000,
          symbol: "CALM",
          title: "CALM level touch",
          body: "price testing resistance again",
        },
      ],
    });

    const report = buildMarketStructureCalibrationReport({
      replay: { cacheDirectory: cacheRoot, maxFilesPerSymbol: 1 },
      alignment: { auditRoot, cacheDirectory: cacheRoot, auditLimit: null },
    });
    const markdown = formatMarketStructureCalibrationMarkdown(report);

    assert.equal(report.totals.symbols, 1);
    assert.equal(report.symbols[0]?.symbol, "CALM");
    assert.ok(report.symbols[0]?.sameStructureRepeats);
    assert.match(markdown, /Market Structure Calibration Report/);
    assert.match(markdown, /CALM/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("market structure calibration writer creates JSON and markdown artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "market-structure-calibration-write-"));
  try {
    const report = writeMarketStructureCalibrationReport({
      replay: { cacheDirectory: join(root, "cache") },
      alignment: { auditRoot: join(root, "artifacts"), cacheDirectory: join(root, "cache"), auditLimit: null },
      jsonPath: join(root, "out", "report.json"),
      markdownPath: join(root, "out", "report.md"),
    });

    assert.equal(report.totals.symbols, 0);
    assert.ok(existsSync(join(root, "out", "report.json")));
    assert.match(readFileSync(join(root, "out", "report.md"), "utf8"), /Market Structure Calibration Report/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
