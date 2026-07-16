import assert from "node:assert/strict";
import test from "node:test";

import type { Candle } from "../lib/market-data/candle-types.js";
import { buildFormalMarketStructureContext } from "../lib/structure/formal-market-structure.js";

const FIVE_MINUTES = 5 * 60 * 1000;
const TEST_OPTIONS = {
  minCandles: 8,
  internalLeftBars: 1,
  internalRightBars: 1,
  externalLeftBars: 1,
  externalRightBars: 1,
  equalLevelTolerancePct: 0.001,
  displacementRangeMultiplier: 0.2,
  followThroughBars: 2,
};

function candle(index: number, high: number, low: number, close: number): Candle {
  return {
    timestamp: index * FIVE_MINUTES,
    open: (high + low) / 2,
    high,
    low,
    close,
    volume: 1000 + index * 100,
  };
}

function bullishPrior(): Candle[] {
  return [
    candle(0, 1.08, 1.0, 1.04),
    candle(1, 1.2, 1.06, 1.18),
    candle(2, 1.1, 0.98, 1.0),
    candle(3, 1.32, 1.14, 1.3),
    candle(4, 1.18, 1.08, 1.1),
    candle(5, 1.36, 1.16, 1.34),
    candle(6, 1.28, 1.2, 1.22),
  ];
}

function bearishPrior(): Candle[] {
  return [
    candle(0, 2.05, 1.95, 2.0),
    candle(1, 2.2, 2.02, 2.05),
    candle(2, 2.08, 1.86, 1.9),
    candle(3, 2.12, 1.94, 2.0),
    candle(4, 1.98, 1.72, 1.76),
    candle(5, 2.02, 1.82, 1.92),
    candle(6, 1.9, 1.6, 1.64),
  ];
}

test("formal structure confirms bullish BOS from prior-state pivots", () => {
  const context = buildFormalMarketStructureContext({
    symbol: "BOS",
    candles: [...bullishPrior(), candle(7, 1.46, 1.24, 1.43)],
    options: TEST_OPTIONS,
  });

  assert.equal(context.timeframe, "5m");
  assert.equal(context.previousBias, "bullish");
  assert.equal(context.bias, "bullish");
  assert.equal(context.latestEvent.type, "bos_bullish");
  assert.equal(context.latestEvent.brokenSwingPrice, 1.36);
  assert.equal(context.latestEvent.protectedLowPrice, 1.08);
  assert.equal(context.latestEvent.confidence, "high");
  assert.match(context.latestEvent.traderLine, /bullish BOS above 1\.3600/);
});

test("formal structure confirms bearish BOS in a lower-high lower-low sequence", () => {
  const context = buildFormalMarketStructureContext({
    symbol: "BOS",
    candles: [...bearishPrior(), candle(7, 1.72, 1.44, 1.48)],
    options: TEST_OPTIONS,
  });

  assert.equal(context.previousBias, "bearish");
  assert.equal(context.bias, "bearish");
  assert.equal(context.latestEvent.type, "bos_bearish");
  assert.equal(context.latestEvent.brokenSwingPrice, 1.72);
  assert.equal(context.latestEvent.protectedHighPrice, 2.02);
  assert.equal(context.latestEvent.confirmation, "follow_through_confirmed");
});

test("formal structure confirms CHOCH only when a protected swing breaks", () => {
  const bearishChoch = buildFormalMarketStructureContext({
    symbol: "CHOCH",
    candles: [...bullishPrior(), candle(7, 1.16, 0.99, 1.02)],
    options: TEST_OPTIONS,
  });
  const bullishChoch = buildFormalMarketStructureContext({
    symbol: "CHOCH",
    candles: [...bearishPrior(), candle(7, 2.12, 1.82, 2.08)],
    options: TEST_OPTIONS,
  });

  assert.equal(bearishChoch.latestEvent.type, "choch_bearish");
  assert.equal(bearishChoch.latestEvent.brokenSwingPrice, 1.08);
  assert.equal(bearishChoch.bias, "bearish_transition");
  assert.equal(bullishChoch.latestEvent.type, "choch_bullish");
  assert.equal(bullishChoch.latestEvent.brokenSwingPrice, 2.02);
  assert.equal(bullishChoch.bias, "bullish_transition");
});

test("formal structure distinguishes wick sweeps and failed breaks from confirmed BOS", () => {
  const sweep = buildFormalMarketStructureContext({
    symbol: "SWEEP",
    candles: [...bullishPrior(), candle(7, 1.44, 1.24, 1.35)],
    options: TEST_OPTIONS,
  });
  const failed = buildFormalMarketStructureContext({
    symbol: "FAIL",
    candles: [
      ...bullishPrior(),
      candle(7, 1.46, 1.24, 1.43),
      candle(8, 1.38, 1.24, 1.34),
    ],
    options: TEST_OPTIONS,
  });

  assert.equal(sweep.latestEvent.type, "liquidity_sweep_high");
  assert.equal(sweep.latestEvent.confirmation, "wick_only");
  assert.equal(sweep.latestEvent.sweptSwingPrice, 1.36);
  assert.equal(failed.latestEvent.type, "failed_break_high");
  assert.equal(failed.latestEvent.confirmation, "failed");
  assert.equal(failed.latestEvent.sweptSwingPrice, 1.36);
});

test("formal structure caps initial range expansion confidence at medium", () => {
  const context = buildFormalMarketStructureContext({
    symbol: "RANGE",
    candles: [
      candle(0, 1.08, 1.02, 1.05),
      candle(1, 1.2, 1.06, 1.18),
      candle(2, 1.1, 1.0, 1.04),
      candle(3, 1.19, 1.05, 1.16),
      candle(4, 1.11, 1.01, 1.05),
      candle(5, 1.18, 1.04, 1.15),
      candle(6, 1.12, 1.0, 1.04),
      candle(7, 1.28, 1.08, 1.25),
    ],
    options: TEST_OPTIONS,
  });

  assert.equal(context.previousBias, "range");
  assert.equal(context.latestEvent.type, "bos_bullish");
  assert.equal(context.latestEvent.brokenSwingPrice, 1.2);
  assert.equal(context.latestEvent.confidence, "medium");
  assert.ok(context.latestEvent.reasonCodes.includes("range_break_initial_bias"));
  assert.match(context.latestEvent.traderLine, /initial range expansion/);
});

test("formal structure reports live price pressure without confirming an unfinished higher-timeframe break", () => {
  const context = buildFormalMarketStructureContext({
    symbol: "LIVE",
    timeframe: "4h",
    candles: [...bullishPrior(), candle(7, 1.34, 1.24, 1.3)],
    currentPrice: 1.42,
    options: TEST_OPTIONS,
  });

  assert.equal(context.latestEvent.type, "none");
  assert.equal(context.livePricePressure?.type, "above_protected_high");
  assert.equal(context.livePricePressure?.levelPrice, 1.36);
  assert.equal(context.livePricePressure?.currentPrice, 1.42);
  assert.equal(context.livePricePressure?.confirmation, "unconfirmed_live_price");
  assert.match(
    context.livePricePressure?.traderLine ?? "",
    /above protected high 1\.3600 before the 4h candle has confirmed/,
  );
});

test("formal structure filters as-of partial candles using candle-close semantics", () => {
  const futureBos = candle(7, 1.46, 1.24, 1.43);
  const partialContext = buildFormalMarketStructureContext({
    symbol: "ASOF",
    candles: [...bullishPrior(), futureBos],
    asOfTimestamp: futureBos.timestamp + 3 * 60 * 1000,
    options: TEST_OPTIONS,
  });
  const closedContext = buildFormalMarketStructureContext({
    symbol: "ASOF",
    candles: [...bullishPrior(), futureBos],
    asOfTimestamp: futureBos.timestamp + FIVE_MINUTES,
    options: TEST_OPTIONS,
  });

  assert.notEqual(partialContext.latestEvent.type, "bos_bullish");
  assert.ok(partialContext.diagnostics.some((diagnostic) => diagnostic.code === "partial_candles_filtered"));
  assert.equal(closedContext.latestEvent.type, "bos_bullish");
});

test("formal structure is stable when future candles are appended after asOfTimestamp", () => {
  const closedCandles = [...bullishPrior(), candle(7, 1.46, 1.24, 1.43)];
  const futureSelloff = candle(9, 0.9, 0.72, 0.76);
  const asOfTimestamp = closedCandles.at(-1)!.timestamp + FIVE_MINUTES;
  const baseline = buildFormalMarketStructureContext({
    symbol: "STABLE",
    candles: closedCandles,
    asOfTimestamp,
    options: TEST_OPTIONS,
  });
  const withFuture = buildFormalMarketStructureContext({
    symbol: "STABLE",
    candles: [...closedCandles, futureSelloff],
    asOfTimestamp,
    options: TEST_OPTIONS,
  });

  assert.equal(withFuture.latestEvent.type, baseline.latestEvent.type);
  assert.equal(withFuture.bias, baseline.bias);
  assert.equal(withFuture.candleCount, baseline.candleCount);
  assert.ok(withFuture.diagnostics.some((diagnostic) => diagnostic.code === "future_candles_filtered"));
});
