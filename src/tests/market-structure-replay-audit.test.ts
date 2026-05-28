import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildMarketStructureReplayAuditReport,
  formatMarketStructureReplayAuditMarkdown,
} from "../lib/review/market-structure-replay-audit.js";
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
  lookbackBars?: number;
}): string {
  const lookbackBars = params.lookbackBars ?? params.candles.length;
  const endTimeMs = params.candles.at(-1)!.timestamp;
  const directory = join(params.root, params.symbol, "5m");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${lookbackBars}-${endTimeMs}.json`);
  writeFileSync(
    path,
    `${JSON.stringify({
      schemaVersion: 1,
      request: {
        symbol: params.symbol,
        timeframe: "5m",
        lookbackBars,
        endTimeMs,
        provider: "ibkr",
      },
      response: {
        candles: params.candles,
      },
    })}\n`,
  );
  return path;
}

test("market structure replay audit scans cached 5m files and reports evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "market-structure-replay-"));
  try {
    writeCacheFile({
      root,
      symbol: "CHOP",
      candles: candlesFromCloses([
        1.00, 1.05, 1.01, 1.06, 1.00,
        1.05, 0.99, 1.06, 1.00, 1.05,
        0.99, 1.06, 1.00, 1.05, 1.01,
        1.06, 1.00, 1.04, 1.01, 1.03,
      ]),
    });

    const report = buildMarketStructureReplayAuditReport({
      cacheDirectory: root,
      maxFilesPerSymbol: 1,
    });

    assert.equal(report.filesScanned, 1);
    assert.equal(report.symbolsScanned, 1);
    assert.equal(report.cases[0]?.symbol, "CHOP");
    assert.equal(report.cases[0]?.state, "range_bound");
    assert.ok(report.cases[0]?.rolling.evaluatedWindows);
    assert.ok(report.summary.stateCounts.range_bound);
    assert.ok((report.cases[0]?.rolling.rangeBoundRatio ?? 0) > 0);
    assert.equal(typeof report.cases[0]?.rolling.immaterialTransitionCount, "number");
    assert.equal(typeof report.cases[0]?.rolling.immaterialTransitionRatio, "number");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("market structure replay audit markdown includes findings and case proof", () => {
  const root = mkdtempSync(join(tmpdir(), "market-structure-replay-"));
  try {
    writeCacheFile({
      root,
      symbol: "THIN",
      candles: candlesFromCloses([1, 1.01, 1.02]),
    });

    const report = buildMarketStructureReplayAuditReport({
      cacheDirectory: root,
      maxFilesPerSymbol: 1,
    });
    const markdown = formatMarketStructureReplayAuditMarkdown(report);

    assert.match(markdown, /Market Structure Replay Audit/);
    assert.match(markdown, /insufficient_structure_data/);
    assert.match(markdown, /THIN/);
    assert.match(markdown, /state: insufficient_data/);
    assert.match(markdown, /immaterial/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("market structure replay audit flags small-cap structure transitions below materiality", () => {
  const root = mkdtempSync(join(tmpdir(), "market-structure-replay-"));
  try {
    writeCacheFile({
      root,
      symbol: "WIGL",
      candles: candlesFromCloses([
        1.000, 1.010, 1.000, 1.012, 1.001,
        1.013, 1.002, 1.014, 1.003, 1.015,
        1.004, 1.016, 1.005, 1.017, 1.006,
        1.018, 1.007, 1.019, 1.008, 1.020,
        1.009, 1.021, 1.010, 1.022,
      ]),
    });

    const report = buildMarketStructureReplayAuditReport({
      cacheDirectory: root,
      maxFilesPerSymbol: 1,
      minCandles: 6,
    });
    const markdown = formatMarketStructureReplayAuditMarkdown(report);

    assert.ok(report.cases[0]?.rolling.immaterialTransitionCount);
    assert.ok(
      report.findings.some(
        (finding) => finding.reason === "small_cap_immaterial_structure_transition",
      ),
    );
    assert.match(markdown, /small_cap_immaterial_structure_transition/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
