import assert from "node:assert/strict";
import { test } from "node:test";

import type { Candle, CandleProviderResponse } from "../lib/market-data/candle-types.js";
import { buildFiveMinuteConfirmationAudit } from "../lib/review/five-minute-confirmation-audit.js";

function candle(index: number, open: number, high: number, low: number, close: number, volume: number): Candle {
  return {
    timestamp: Date.UTC(2026, 0, 5, 14, 30 + index * 5),
    open,
    high,
    low,
    close,
    volume,
  };
}

function response(candles: Candle[]): CandleProviderResponse {
  return {
    provider: "stub",
    symbol: "LIVE",
    timeframe: "5m",
    requestedLookbackBars: candles.length,
    candles,
    fetchStartTimestamp: candles[0]?.timestamp ?? 0,
    fetchEndTimestamp: candles.at(-1)?.timestamp ?? 0,
    requestedStartTimestamp: candles[0]?.timestamp ?? 0,
    requestedEndTimestamp: candles.at(-1)?.timestamp ?? 0,
    sessionMetadataAvailable: true,
    actualBarsReturned: candles.length,
    completenessStatus: candles.length > 0 ? "complete" : "empty",
    stale: false,
    validationIssues: [],
    sessionSummary: null,
  };
}

test("5m confirmation audit samples actual intraday confirmation and forward result", () => {
  const candles = [
    candle(0, 1.0, 1.04, 1.0, 1.02, 200_000),
    candle(1, 1.02, 1.08, 1.0, 1.04, 230_000),
    candle(2, 1.04, 1.1, 1.02, 1.08, 240_000),
    candle(3, 1.08, 1.12, 1.04, 1.08, 210_000),
    candle(4, 1.08, 1.13, 1.05, 1.1, 225_000),
    candle(5, 1.1, 1.15, 1.07, 1.12, 235_000),
    candle(6, 1.12, 1.16, 1.08, 1.13, 250_000),
    candle(7, 1.13, 1.17, 1.1, 1.12, 220_000),
    candle(8, 1.12, 1.18, 1.1, 1.15, 245_000),
    candle(9, 1.15, 1.2, 1.12, 1.18, 255_000),
    candle(10, 1.18, 1.22, 1.15, 1.18, 240_000),
    candle(11, 1.18, 1.23, 1.16, 1.2, 230_000),
    candle(12, 1.2, 1.25, 1.17, 1.21, 250_000),
    candle(13, 1.21, 1.26, 1.18, 1.22, 260_000),
    candle(14, 1.22, 1.27, 1.19, 1.24, 245_000),
    candle(15, 1.24, 1.28, 1.2, 1.25, 255_000),
    candle(16, 1.25, 1.29, 1.21, 1.26, 250_000),
    candle(17, 1.26, 1.41, 1.24, 1.38, 850_000),
    candle(18, 1.38, 1.5, 1.36, 1.46, 700_000),
    candle(19, 1.46, 1.62, 1.44, 1.58, 680_000),
    candle(20, 1.58, 1.64, 1.5, 1.56, 500_000),
  ];
  const report = buildFiveMinuteConfirmationAudit({
    symbols: [{ symbol: "LIVE", fiveMinuteResponse: response(candles) }],
    horizonBars: 3,
    targetMovePct: 15,
    partialMovePct: 8,
  });

  assert.equal(report.totals.symbolsWithUsable5m, 1);
  assert.equal(report.totals.confirmationSamples, 1);
  assert.equal(report.samples[0]?.outcome, "target_hit");
  assert.equal(report.samples[0]?.read.present, true);
  assert.ok((report.samples[0]?.bestForwardPct ?? 0) >= 15);
});
