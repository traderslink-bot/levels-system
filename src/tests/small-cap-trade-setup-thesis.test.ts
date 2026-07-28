import assert from "node:assert/strict";
import test from "node:test";

import type { Candle, CandleProviderResponse } from "../lib/market-data/candle-types.js";
import {
  buildSmallCapTradeSetupReadsForQa,
  buildTradeSetupChartThesisRead,
  type ChartThesisEngineInput,
} from "../lib/monitoring/chart-thesis-engine.js";

function bar(index: number, open: number, high: number, low: number, close: number, volume = 200_000): Candle {
  return {
    timestamp: Date.UTC(2026, 6, 15, 13, 30) + index * 5 * 60_000,
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
    symbol: "SCAP",
    timeframe: "5m",
    requestedLookbackBars: candles.length,
    candles,
    fetchStartTimestamp: candles[0]?.timestamp ?? 0,
    fetchEndTimestamp: candles.at(-1)?.timestamp ?? 0,
    requestedStartTimestamp: candles[0]?.timestamp ?? 0,
    requestedEndTimestamp: candles.at(-1)?.timestamp ?? 0,
    sessionMetadataAvailable: false,
    actualBarsReturned: candles.length,
    completenessStatus: "complete",
    stale: false,
    validationIssues: [],
    sessionSummary: null,
  };
}

function input(candles: Candle[], currentPrice = candles.at(-1)?.close ?? 0): ChartThesisEngineInput {
  return {
    symbol: "SCAP",
    currentPrice,
    seriesMap: { "5m": response(candles) },
    activeRunnerContext: { activeRunner: true, catalystCardFreshness: "same_day" },
  };
}

function family(candles: Candle[], type: string) {
  return buildSmallCapTradeSetupReadsForQa(input(candles)).find((read) => read.type === type);
}

test("small-cap setup engine recognizes a confirmed first pullback reclaim", () => {
  const candles = [
    bar(0, 1.00, 1.08, 0.98, 1.06),
    bar(1, 1.06, 1.18, 1.04, 1.16),
    bar(2, 1.16, 1.30, 1.14, 1.28),
    bar(3, 1.28, 1.42, 1.25, 1.39),
    bar(4, 1.39, 1.50, 1.36, 1.47),
    bar(5, 1.47, 1.55, 1.43, 1.52),
    bar(6, 1.52, 1.53, 1.40, 1.43),
    bar(7, 1.43, 1.46, 1.32, 1.36),
    bar(8, 1.36, 1.40, 1.30, 1.34),
    bar(9, 1.34, 1.38, 1.32, 1.36),
    bar(10, 1.36, 1.40, 1.34, 1.38),
    bar(11, 1.38, 1.42, 1.36, 1.40),
    bar(12, 1.40, 1.44, 1.38, 1.43),
    bar(13, 1.43, 1.47, 1.41, 1.46, 280_000),
  ];
  const read = family(candles, "small_cap_first_pullback");
  assert.ok(read);
  assert.equal(read.status, "active");
  assert.equal(read.targetLow, 1.55);
  assert.ok((read.invalidationLevel ?? 0) < (read.buyerResponseLow ?? 0));
  assert.match(read.lines.join(" "), /first controlled pullback/i);
});

test("small-cap setup engine recognizes an opening-range breakout retest", () => {
  const candles = [
    bar(0, 1.00, 1.08, 0.98, 1.05),
    bar(1, 1.05, 1.12, 1.02, 1.10),
    bar(2, 1.10, 1.18, 1.08, 1.16),
    bar(3, 1.16, 1.20, 1.12, 1.18),
    bar(4, 1.18, 1.20, 1.14, 1.17),
    bar(5, 1.17, 1.19, 1.13, 1.18),
    bar(6, 1.18, 1.31, 1.17, 1.28, 420_000),
    bar(7, 1.28, 1.42, 1.26, 1.38, 360_000),
    bar(8, 1.38, 1.40, 1.30, 1.34),
    bar(9, 1.34, 1.36, 1.24, 1.27),
    bar(10, 1.27, 1.30, 1.18, 1.23),
    bar(11, 1.23, 1.27, 1.21, 1.25),
    bar(12, 1.25, 1.32, 1.23, 1.30, 300_000),
  ];
  const read = family(candles, "small_cap_opening_range_retest");
  assert.ok(read);
  assert.equal(read.status, "active");
  assert.ok((read.triggerHigh ?? 0) >= 1.20);
  assert.ok((read.targetLow ?? 0) >= 1.40);
  assert.match(read.evidence.join(" "), /retested the opening-range high/i);
});

test("small-cap setup families derive the opening range from regular-session candles, not premarket", () => {
  const premarket = Array.from({ length: 6 }, (_, index) =>
    bar(index - 12, 2.4, 3.0, 0.55, 1.8, 900_000)
  );
  const regular = [
    bar(0, 1.00, 1.08, 0.98, 1.05),
    bar(1, 1.05, 1.12, 1.02, 1.10),
    bar(2, 1.10, 1.18, 1.08, 1.16),
    bar(3, 1.16, 1.20, 1.12, 1.18),
    bar(4, 1.18, 1.20, 1.14, 1.17),
    bar(5, 1.17, 1.19, 1.13, 1.18),
    bar(6, 1.18, 1.31, 1.17, 1.28, 420_000),
    bar(7, 1.28, 1.42, 1.26, 1.38, 360_000),
    bar(8, 1.38, 1.40, 1.30, 1.34),
    bar(9, 1.34, 1.36, 1.24, 1.27),
    bar(10, 1.27, 1.30, 1.18, 1.23),
    bar(11, 1.23, 1.27, 1.21, 1.25),
    bar(12, 1.25, 1.32, 1.23, 1.30, 300_000),
  ];
  const read = family([...premarket, ...regular], "small_cap_opening_range_retest");
  assert.ok(read);
  assert.match(read.evidence.join(" "), /opening range 0\.9800-1\.20/i);
  assert.doesNotMatch(read.evidence.join(" "), /0\.55-3\.00/);
});

test("small-cap setup engine requires a higher low for its VWAP reclaim", () => {
  const candles = [
    bar(0, 1.00, 1.08, 0.98, 1.06),
    bar(1, 1.06, 1.18, 1.04, 1.16),
    bar(2, 1.16, 1.32, 1.14, 1.28),
    bar(3, 1.28, 1.46, 1.25, 1.42),
    bar(4, 1.42, 1.52, 1.38, 1.48),
    bar(5, 1.48, 1.50, 1.30, 1.34),
    bar(6, 1.34, 1.36, 1.18, 1.22),
    bar(7, 1.22, 1.25, 1.06, 1.10),
    bar(8, 1.10, 1.16, 1.04, 1.13),
    bar(9, 1.13, 1.18, 1.09, 1.16),
    bar(10, 1.16, 1.22, 1.13, 1.20),
    bar(11, 1.20, 1.26, 1.17, 1.24),
    bar(12, 1.24, 1.31, 1.21, 1.29),
    bar(13, 1.29, 1.37, 1.26, 1.35, 340_000),
  ];
  const read = family(candles, "small_cap_vwap_reclaim");
  assert.ok(read);
  assert.equal(read.status, "active");
  assert.match(read.label, /VWAP reclaim/);
  assert.match(read.evidence.join(" "), /lows improved/);
});

test("small-cap setup engine recognizes a flush reclaim with a defined failure low", () => {
  const candles = [
    bar(0, 1.30, 1.38, 1.28, 1.35),
    bar(1, 1.35, 1.42, 1.32, 1.39),
    bar(2, 1.39, 1.46, 1.35, 1.42),
    bar(3, 1.42, 1.48, 1.38, 1.45),
    bar(4, 1.45, 1.47, 1.37, 1.40),
    bar(5, 1.40, 1.44, 1.35, 1.39),
    bar(6, 1.39, 1.41, 1.33, 1.37),
    bar(7, 1.37, 1.40, 1.04, 1.34, 800_000),
    bar(8, 1.34, 1.39, 1.30, 1.37, 420_000),
    bar(9, 1.37, 1.42, 1.34, 1.40),
    bar(10, 1.40, 1.44, 1.37, 1.42),
    bar(11, 1.42, 1.46, 1.39, 1.44),
    bar(12, 1.44, 1.49, 1.42, 1.47),
    bar(13, 1.47, 1.55, 1.45, 1.53, 360_000),
  ];
  const read = family(candles, "small_cap_flush_reclaim");
  assert.ok(read);
  assert.equal(read.status, "active");
  assert.ok((read.invalidationLevel ?? 0) < 1.04);
  assert.match(read.lines.join(" "), /flushed below/);
});

test("small-cap setup engine keeps a fresh intraday base breakout on watch until it retests", () => {
  const candles = [
    bar(0, 1.00, 1.08, 0.98, 1.06),
    bar(1, 1.06, 1.18, 1.04, 1.16),
    bar(2, 1.16, 1.32, 1.14, 1.29),
    bar(3, 1.29, 1.48, 1.27, 1.44),
    bar(4, 1.44, 1.50, 1.38, 1.43),
    bar(5, 1.43, 1.46, 1.37, 1.41),
    bar(6, 1.41, 1.45, 1.36, 1.40),
    bar(7, 1.40, 1.44, 1.37, 1.42),
    bar(8, 1.42, 1.46, 1.38, 1.43),
    bar(9, 1.43, 1.45, 1.39, 1.42),
    bar(10, 1.42, 1.46, 1.38, 1.44),
    bar(11, 1.44, 1.47, 1.40, 1.43),
    bar(12, 1.43, 1.46, 1.39, 1.44),
    bar(13, 1.44, 1.47, 1.40, 1.45),
    bar(14, 1.45, 1.48, 1.41, 1.46),
    bar(15, 1.46, 1.48, 1.42, 1.45),
    bar(16, 1.45, 1.48, 1.42, 1.46),
    bar(17, 1.46, 1.55, 1.45, 1.53, 520_000),
  ];
  const read = family(candles, "small_cap_intraday_base_breakout");
  assert.ok(read);
  assert.equal(read.status, "watch");
  assert.ok((read.targetLow ?? 0) > (read.triggerHigh ?? 0));
  assert.match(read.evidence.join(" "), /bar base held/);
  assert.match(read.evidence.join(" "), /retest has not confirmed/i);
});

test("small-cap setup engine confirms an intraday base breakout only after retest and reclaim", () => {
  const candles = [
    bar(0, 1.00, 1.08, 0.98, 1.06),
    bar(1, 1.06, 1.18, 1.04, 1.16),
    bar(2, 1.16, 1.32, 1.14, 1.29),
    bar(3, 1.29, 1.48, 1.27, 1.44),
    bar(4, 1.44, 1.50, 1.38, 1.43),
    bar(5, 1.43, 1.46, 1.37, 1.41),
    bar(6, 1.41, 1.45, 1.36, 1.40),
    bar(7, 1.40, 1.44, 1.37, 1.42),
    bar(8, 1.42, 1.46, 1.38, 1.43),
    bar(9, 1.43, 1.45, 1.39, 1.42),
    bar(10, 1.42, 1.46, 1.38, 1.44),
    bar(11, 1.44, 1.47, 1.40, 1.43),
    bar(12, 1.43, 1.46, 1.39, 1.44),
    bar(13, 1.44, 1.47, 1.40, 1.45),
    bar(14, 1.45, 1.48, 1.41, 1.46),
    bar(15, 1.46, 1.48, 1.42, 1.45),
    bar(16, 1.45, 1.48, 1.42, 1.46),
    bar(17, 1.46, 1.55, 1.45, 1.53, 520_000),
    bar(18, 1.50, 1.52, 1.47, 1.49, 260_000),
    bar(19, 1.49, 1.56, 1.48, 1.54, 340_000),
  ];
  const read = family(candles, "small_cap_intraday_base_breakout");
  assert.ok(read);
  assert.equal(read.status, "active");
  assert.match(read.label, /retest/i);
  assert.match(read.evidence.join(" "), /later retest held/i);
  assert.ok((read.invalidationLevel ?? 0) < 1.47);
});

test("small-cap setup engine remains scoped to active runners and feeds the V2 selector", () => {
  const candles = Array.from({ length: 18 }, (_, index) =>
    bar(index, 1 + index * 0.02, 1.04 + index * 0.02, 0.98 + index * 0.02, 1.03 + index * 0.02)
  );
  const inactive = { ...input(candles), activeRunnerContext: { activeRunner: false as const } };
  assert.deepEqual(buildSmallCapTradeSetupReadsForQa(inactive), []);
  const selected = buildTradeSetupChartThesisRead(input(candles));
  assert.ok(selected === null || typeof selected.type === "string");
});
