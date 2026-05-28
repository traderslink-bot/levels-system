import assert from "node:assert/strict";
import test from "node:test";

import type { Candle, CandleTimeframe } from "../lib/market-data/candle-types.js";
import {
  buildSupportResistanceContext,
  buildTradeAnalysisSupportResistanceContext,
} from "../lib/support-resistance/index.js";

function candle(timestamp: number, low: number, high: number, close = (low + high) / 2): Candle {
  return {
    timestamp,
    open: close,
    high,
    low,
    close,
    volume: 1_000,
  };
}

function candlesByTimeframe(candles: Candle[]): Partial<Record<CandleTimeframe, Candle[]>> {
  return {
    "5m": candles,
  };
}

test("shared support/resistance context excludes partial 5m candles using candle-close semantics", () => {
  const first = candle(Date.parse("2026-05-01T09:30:00-04:00"), 10, 11);
  const partial = buildSupportResistanceContext({
    symbol: "SAFE",
    candlesByTimeframe: candlesByTimeframe([first]),
    asOfTimestamp: Date.parse("2026-05-01T09:33:00-04:00"),
  });
  const closed = buildSupportResistanceContext({
    symbol: "SAFE",
    candlesByTimeframe: candlesByTimeframe([first]),
    asOfTimestamp: Date.parse("2026-05-01T09:35:00-04:00"),
  });

  assert.equal(partial.timeframes["5m"]?.candles.length, 0);
  assert.equal(closed.timeframes["5m"]?.candles.length, 1);
  assert.ok(partial.diagnostics.some((diagnostic) => diagnostic.code === "partial_candles_filtered"));
});

test("execution support/resistance context is stable when a future candle is appended", () => {
  const executionTimestamp = Date.parse("2026-05-01T09:40:00-04:00");
  const baseCandles = [
    candle(Date.parse("2026-05-01T09:30:00-04:00"), 10, 11),
    candle(Date.parse("2026-05-01T09:35:00-04:00"), 10.25, 11.25),
  ];
  const future = candle(Date.parse("2026-05-01T09:40:00-04:00"), 8, 13);
  const base = buildTradeAnalysisSupportResistanceContext({
    symbol: "SAFE",
    executionTimestamp,
    referencePrice: 10.75,
    candlesByTimeframe: candlesByTimeframe(baseCandles),
  });
  const withFuture = buildTradeAnalysisSupportResistanceContext({
    symbol: "SAFE",
    executionTimestamp,
    referencePrice: 10.75,
    candlesByTimeframe: candlesByTimeframe([...baseCandles, future]),
  });

  assert.deepEqual(withFuture.supportResistance.levels, base.supportResistance.levels);
  assert.deepEqual(withFuture.nearestSupport, base.nearestSupport);
  assert.deepEqual(withFuture.nearestResistance, base.nearestResistance);
  assert.ok(
    withFuture.supportResistance.diagnostics.some(
      (diagnostic) => diagnostic.code === "partial_candles_filtered",
    ),
  );
});

test("VWAP remains a market fact unless explicitly allowed into trader interpretation", () => {
  const executionTimestamp = Date.parse("2026-05-01T09:40:00-04:00");
  const context = buildTradeAnalysisSupportResistanceContext({
    symbol: "VWAP",
    executionTimestamp,
    referencePrice: 10.75,
    candlesByTimeframe: candlesByTimeframe([
      candle(Date.parse("2026-05-01T09:30:00-04:00"), 10, 11),
      candle(Date.parse("2026-05-01T09:35:00-04:00"), 10.25, 11.25),
    ]),
  });
  const optedIn = buildTradeAnalysisSupportResistanceContext({
    symbol: "VWAP",
    executionTimestamp,
    referencePrice: 10.75,
    candlesByTimeframe: candlesByTimeframe([
      candle(Date.parse("2026-05-01T09:30:00-04:00"), 10, 11),
      candle(Date.parse("2026-05-01T09:35:00-04:00"), 10.25, 11.25),
    ]),
    allowVwapInTraderInterpretation: true,
  });

  assert.equal(typeof context.marketFacts.vwapByTimeframe["5m"], "number");
  assert.deepEqual(context.traderInterpretation.factsAllowedToInfluenceInterpretation, []);
  assert.deepEqual(optedIn.traderInterpretation.factsAllowedToInfluenceInterpretation, ["vwap"]);
});
