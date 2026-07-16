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

test("shared support/resistance context exposes rich ranked final level zones", () => {
  const context = buildSupportResistanceContext({
    symbol: "RICH",
    candlesByTimeframe: candlesByTimeframe([
      candle(Date.parse("2026-05-01T09:30:00-04:00"), 10, 11, 10.6),
      candle(Date.parse("2026-05-01T09:35:00-04:00"), 9.8, 10.7, 10.1),
      candle(Date.parse("2026-05-01T09:40:00-04:00"), 10.2, 11.4, 11.1),
      candle(Date.parse("2026-05-01T09:45:00-04:00"), 10.4, 11.2, 10.7),
      candle(Date.parse("2026-05-01T09:50:00-04:00"), 9.9, 10.8, 10.2),
      candle(Date.parse("2026-05-01T09:55:00-04:00"), 10.3, 11.6, 11.3),
      candle(Date.parse("2026-05-01T10:00:00-04:00"), 10.7, 11.5, 11),
      candle(Date.parse("2026-05-01T10:05:00-04:00"), 10.1, 11.1, 10.5),
    ]),
    asOfTimestamp: Date.parse("2026-05-01T10:10:00-04:00"),
  });

  assert.ok(context.levelEngineOutput);
  assert.ok(context.finalLevelZones.length > 0);
  assert.ok(
    context.finalLevelZones.every(
      (zone) =>
        typeof zone.strengthScore === "number" &&
        ["weak", "moderate", "strong", "major"].includes(zone.strengthLabel),
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
