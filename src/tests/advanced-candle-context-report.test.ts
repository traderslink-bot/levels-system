import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildAdvancedCandleContextReport,
  writeAdvancedCandleContextReport,
} from "../lib/review/advanced-candle-context-report.js";
import type { Candle, CandleFetchTimeframe, CandleProviderName } from "../lib/support-resistance/index.js";

const START = Date.UTC(2026, 4, 1, 13, 30, 0);

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
      Number((base + Math.sin(index / 4) * amplitude + index * amplitude * 0.01).toFixed(4)),
      100_000 + index * 1_000,
    ),
  );
}

function writeCache(params: {
  root: string;
  provider: CandleProviderName;
  symbol: string;
  timeframe: CandleFetchTimeframe;
  candles: Candle[];
}): void {
  const directory = join(params.root, params.provider, params.symbol, params.timeframe);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${params.provider}-${params.timeframe}.json`),
    `${JSON.stringify({ response: { candles: params.candles } })}\n`,
    "utf8",
  );
}

test("advanced candle context report summarizes candle-derived operator facts", async () => {
  const root = mkdtempSync(join(tmpdir(), "advanced-candle-context-"));
  try {
    writeCache({
      root,
      provider: "ibkr",
      symbol: "ADVC",
      timeframe: "daily",
      candles: wave(100, START - 100 * 24 * 60 * 60_000, 24 * 60 * 60_000, 2, 0.15),
    });
    writeCache({
      root,
      provider: "ibkr",
      symbol: "ADVC",
      timeframe: "4h",
      candles: wave(100, START - 100 * 4 * 60 * 60_000, 4 * 60 * 60_000, 2, 0.08),
    });
    writeCache({
      root,
      provider: "ibkr",
      symbol: "ADVC",
      timeframe: "5m",
      candles: wave(50, START, 5 * 60_000, 2, 0.04),
    });

    const report = await buildAdvancedCandleContextReport({
      cacheDirectoryPath: root,
      provider: "ibkr",
      symbols: ["ADVC"],
    });

    assert.equal(report.totals.symbols, 1);
    assert.equal(report.totals.ready, 1);
    assert.equal(report.symbols[0]?.dynamicAvailability.vwap, true);
    assert.ok(report.symbols[0]?.marketStructure.state);
    assert.ok(report.symbols[0]?.traderContext.tradeIdea);
    assert.equal(typeof report.symbols[0]?.traderContext.dataQualityScore, "number");
    assert.ok(Array.isArray(report.symbols[0]?.traderContext.dataQualityReasons));
    assert.ok(Array.isArray(report.symbols[0]?.traderContext.missingFacts));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("advanced candle context report writer creates JSON and markdown", async () => {
  const root = mkdtempSync(join(tmpdir(), "advanced-candle-context-write-"));
  try {
    const report = await writeAdvancedCandleContextReport({
      cacheDirectoryPath: root,
      provider: "ibkr",
      symbols: ["MISS"],
      jsonPath: join(root, "out", "report.json"),
      markdownPath: join(root, "out", "report.md"),
    });

    assert.equal(report.totals.partial + report.totals.blocked, 1);
    assert.deepEqual(report.symbols[0]?.traderContext.missingFacts, [
      "missing daily candles",
      "missing 4h candles",
      "missing 5m candles",
    ]);
    assert.ok(existsSync(join(root, "out", "report.json")));
    const markdown = readFileSync(join(root, "out", "report.md"), "utf8");
    assert.match(markdown, /Advanced Candle Context Report/);
    assert.match(markdown, /data quality proof/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
