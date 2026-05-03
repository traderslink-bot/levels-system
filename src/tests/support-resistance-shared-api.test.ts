import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateCandlesToFiveMinutes,
  buildSupportResistanceContextFromCandles,
  buildSupportResistanceContextForSymbol,
  buildSupportResistanceContextFromSingleTimeframeCandles,
  buildTradeAnalysisCandleContext,
  fetchSupportResistanceContextFromSingleTimeframeCandles,
  StubHistoricalCandleProvider,
  type Candle,
  type SharedSupportResistanceCandle,
} from "../lib/support-resistance/index.js";

function buildCandles(params: {
  count: number;
  start: number;
  intervalMs: number;
  basePrice: number;
  wave: number;
}): Candle[] {
  let previousClose = params.basePrice;
  return Array.from({ length: params.count }, (_, index) => {
    const timestamp = params.start + index * params.intervalMs;
    const drift = Math.sin(index / 4) * params.wave + Math.cos(index / 11) * params.wave * 0.45;
    const open = Math.max(0.1, previousClose);
    const close = Math.max(0.1, open + drift);
    const high = Math.max(open, close) + params.wave * (1.4 + (index % 5) * 0.18);
    const low = Math.max(0.05, Math.min(open, close) - params.wave * (1.2 + (index % 3) * 0.16));
    previousClose = close;
    return {
      timestamp,
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
      volume: 100_000 + index * 1_500,
    };
  });
}

test("shared support/resistance API builds context from provided candles", async () => {
  const start = Date.UTC(2026, 3, 1, 13, 30, 0);
  const context = await buildSupportResistanceContextFromCandles({
    symbol: "demo",
    candlesByTimeframe: {
      daily: buildCandles({
        count: 180,
        start,
        intervalMs: 24 * 60 * 60 * 1000,
        basePrice: 3.2,
        wave: 0.09,
      }),
      "4h": buildCandles({
        count: 120,
        start,
        intervalMs: 4 * 60 * 60 * 1000,
        basePrice: 3.35,
        wave: 0.07,
      }),
      "5m": buildCandles({
        count: 90,
        start,
        intervalMs: 5 * 60 * 1000,
        basePrice: 3.4,
        wave: 0.035,
      }),
    },
  });

  assert.equal(context.symbol, "DEMO");
  assert.equal(context.levels.symbol, "DEMO");
  assert.equal(context.levels.metadata.providerByTimeframe.daily, "stub");
  assert.ok(context.dynamicLevels.ema9 !== null);
  assert.ok(context.dynamicLevels.ema20 !== null);
  assert.ok(context.dynamicLevels.vwap !== null);
  assert.equal(context.marketStructure.symbol, "DEMO");
  assert.notEqual(context.marketStructure.state, "insufficient_data");
  assert.equal(context.traderContext.liquidity.reliability, "reliable");
  assert.ok(context.traderContext.sessionGap);
  assert.ok(context.traderContext.candleReaction);
  assert.ok(context.traderContext.moveExtension);
  assert.ok(context.traderContext.volatility);
  assert.ok(context.traderContext.openingRange);
  assert.ok(context.traderContext.levelQuality);
  assert.ok(context.traderContext.dataQuality);
  assert.ok(context.traderContext.tradeIdea);
  assert.ok(context.traderContext.noPost);
  assert.ok(context.traderContext.firstPostPlan.lines.length > 0);
  assert.doesNotMatch(context.traderContext.firstPostPlan.lines.join("\n"), /\bbuy\b|\bsell\b|best entry|should enter/i);
  assert.ok(
    context.levels.majorSupport.length +
      context.levels.intermediateSupport.length +
      context.levels.intradaySupport.length >
      0,
  );
  assert.ok(
    context.levels.majorResistance.length +
      context.levels.intermediateResistance.length +
      context.levels.intradayResistance.length >
      0,
  );
});

function toIsoCandles(candles: Candle[]): SharedSupportResistanceCandle[] {
  return candles.map((candle) => ({
    ...candle,
    timestamp: new Date(candle.timestamp).toISOString(),
  }));
}

test("shared support/resistance API accepts ISO timestamps and excludes future candles with asOfTimestamp", async () => {
  const start = Date.UTC(2026, 4, 1, 13, 30, 0);
  const asOfTimestamp = start + 24 * 5 * 60 * 1000;
  const fiveMinuteCandles = buildCandles({
    count: 25,
    start,
    intervalMs: 5 * 60 * 1000,
    basePrice: 4.2,
    wave: 0.015,
  });
  const futureCandle: Candle = {
    timestamp: asOfTimestamp + 5 * 60 * 1000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000_000,
  };

  const context = await buildSupportResistanceContextFromCandles({
    symbol: "iso",
    asOfTimestamp: new Date(asOfTimestamp).toISOString(),
    sessionDate: "2026-05-01",
    candlesByTimeframe: {
      daily: toIsoCandles(buildCandles({
        count: 180,
        start,
        intervalMs: 24 * 60 * 60 * 1000,
        basePrice: 4.1,
        wave: 0.05,
      })),
      "4h": toIsoCandles(buildCandles({
        count: 120,
        start,
        intervalMs: 4 * 60 * 60 * 1000,
        basePrice: 4.15,
        wave: 0.04,
      })),
      "5m": toIsoCandles([...fiveMinuteCandles, futureCandle]),
    },
  });

  assert.equal(context.symbol, "ISO");
  assert.ok(context.dynamicLevels.ema9 !== null);
  assert.ok(context.dynamicLevels.ema9 < 10);
  assert.ok(context.dynamicLevels.vwap !== null);
  assert.ok(context.dynamicLevels.vwap < 10);
  assert.ok(context.marketStructure.pivots.confirmedHighs.every((pivot) => pivot.price < 10));
});

test("shared support/resistance API requires higher-timeframe candle context", async () => {
  await assert.rejects(
    () => buildSupportResistanceContextFromCandles({
      symbol: "MISS",
      candlesByTimeframe: {
        daily: [],
        "4h": buildCandles({
          count: 20,
          start: Date.UTC(2026, 3, 1, 13, 30, 0),
          intervalMs: 4 * 60 * 60 * 1000,
          basePrice: 2,
          wave: 0.05,
        }),
      },
    }),
    /requires daily candles/,
  );
});

test("single-timeframe shared API aggregates 1m candles and returns dynamic-only context", () => {
  const start = Date.UTC(2026, 4, 1, 13, 30, 0);
  const oneMinuteCandles = buildCandles({
    count: 120,
    start,
    intervalMs: 60 * 1000,
    basePrice: 2.4,
    wave: 0.01,
  });

  const context = buildSupportResistanceContextFromSingleTimeframeCandles({
    symbol: "one",
    timeframe: "1m",
    sessionDate: "2026-05-01",
    candles: toIsoCandles(oneMinuteCandles),
  });

  assert.equal(context.symbol, "ONE");
  assert.equal(context.mode, "single_timeframe");
  assert.equal(context.completeness, "partial");
  assert.equal(context.levels, null);
  assert.ok(context.aggregatedCandles["5m"].length > 0);
  assert.ok(context.aggregatedCandles["5m"].length < oneMinuteCandles.length);
  assert.ok(context.dynamicLevels.vwap !== null);
  assert.ok(context.dynamicLevels.ema9 !== null);
  assert.ok(context.dynamicLevels.ema20 !== null);
  assert.equal(context.marketStructure.symbol, "ONE");
  assert.ok(context.marketStructure.diagnostics.some((diagnostic) => diagnostic.code === "derived_from_1m"));
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "missing_higher_timeframe_candles"));
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "aggregated_1m_to_5m"));
});

test("single-timeframe shared API filters future 1m candles before dynamic calculations", () => {
  const start = Date.UTC(2026, 4, 1, 13, 30, 0);
  const asOfTimestamp = start + 119 * 60 * 1000;
  const oneMinuteCandles = buildCandles({
    count: 120,
    start,
    intervalMs: 60 * 1000,
    basePrice: 2.4,
    wave: 0.01,
  });
  const futureCandle: Candle = {
    timestamp: asOfTimestamp + 60 * 1000,
    open: 99,
    high: 100,
    low: 98,
    close: 99,
    volume: 1_000_000,
  };

  const context = buildSupportResistanceContextFromSingleTimeframeCandles({
    symbol: "asof",
    timeframe: "1m",
    sessionDate: "2026-05-01",
    asOfTimestamp,
    candles: toIsoCandles([...oneMinuteCandles, futureCandle]),
  });

  assert.equal(context.candles.length, 120);
  assert.ok(context.dynamicLevels.vwap !== null);
  assert.ok(context.dynamicLevels.vwap < 10);
  assert.equal(context.marketStructure.asOfTimestamp, asOfTimestamp);
});

test("single-timeframe fetch API can fetch 1m candles through the shared provider layer", async () => {
  const context = await fetchSupportResistanceContextFromSingleTimeframeCandles({
    symbol: "stub",
    timeframe: "1m",
    lookbackBars: 120,
    fetchServiceOptions: {
      provider: new StubHistoricalCandleProvider(),
    },
  });

  assert.equal(context.symbol, "STUB");
  assert.equal(context.sourceTimeframe, "1m");
  assert.equal(context.candles.length, 120);
  assert.equal(context.levels, null);
  assert.ok(context.dynamicLevels.ema9 !== null);
});

test("symbol context API owns multi-timeframe fetching and returns full levels", async () => {
  const context = await buildSupportResistanceContextForSymbol({
    symbol: "own",
    sessionDate: "2026-05-01",
    asOfTimestamp: "2026-05-01T15:45:00.000Z",
    lookbackBars: {
      daily: 180,
      "4h": 120,
      "5m": 90,
    },
    fetchServiceOptions: {
      provider: new StubHistoricalCandleProvider(),
    },
  });

  assert.equal(context.symbol, "OWN");
  assert.equal(context.mode, "symbol");
  assert.equal(context.candleFetchingOwnedBy, "levels-system");
  assert.deepEqual(context.requestedTimeframes, ["daily", "4h", "5m"]);
  assert.equal(context.levels.metadata.providerByTimeframe.daily, "stub");
  assert.equal(context.levels.metadata.providerByTimeframe["4h"], "stub");
  assert.equal(context.levels.metadata.providerByTimeframe["5m"], "stub");
  assert.ok(context.fetches.some((fetch) => fetch.timeframe === "daily" && fetch.actualBarsReturned === 180));
  assert.ok(context.fetches.some((fetch) => fetch.timeframe === "4h" && fetch.actualBarsReturned === 120));
  assert.ok(context.fetches.some((fetch) => fetch.timeframe === "5m" && fetch.actualBarsReturned === 90));
  assert.ok(context.fetches.every((fetch) => ["fresh", "usable", "partial", "stale", "missing"].includes(fetch.freshnessStatus)));
  assert.ok(context.dynamicLevels.ema9 !== null);
  assert.ok(context.dynamicLevels.vwap !== null);
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "fetched_candle_group"));
  assert.equal(context.marketStructure.symbol, "OWN");
  assert.notEqual(context.marketStructure.state, "insufficient_data");
  assert.ok(context.traderContext.liquidity);
  assert.ok(context.traderContext.storyMemory);
});

test("symbol context API requires fetched daily and 4h candles for full levels", async () => {
  class BrokenProvider extends StubHistoricalCandleProvider {
    override async fetchCandles(request: Parameters<StubHistoricalCandleProvider["fetchCandles"]>[0]) {
      if (request.timeframe === "4h") {
        throw new Error("4h unavailable");
      }
      return super.fetchCandles(request);
    }
  }

  await assert.rejects(
    () =>
      buildSupportResistanceContextForSymbol({
        symbol: "fail",
        fetchServiceOptions: {
          provider: new BrokenProvider(),
        },
      }),
    /daily and 4h candles are required/,
  );
});

test("trade analysis context owns support/resistance and trade-window candle fetching", async () => {
  const tradeStart = Date.UTC(2026, 4, 1, 15, 30, 0);
  const tradeEnd = tradeStart + 10 * 60_000;
  const asOfTimestamp = tradeEnd + 30 * 60_000;

  const context = await buildTradeAnalysisCandleContext({
    symbol: "pack",
    sessionDate: "2026-05-01",
    asOfTimestamp,
    executions: [
      { timestamp: new Date(tradeStart).toISOString(), price: 4.5, quantity: 100, side: "buy" },
      { timestamp: new Date(tradeEnd).toISOString(), price: 4.7, quantity: 100, side: "sell" },
    ],
    supportResistance: {
      lookbackBars: {
        daily: 180,
        "4h": 120,
        "5m": 90,
      },
    },
    tradeWindow: {
      timeframe: "1m",
      preTradeMinutes: 30,
      postTradeMinutes: 60,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider: new StubHistoricalCandleProvider(),
    },
  });

  assert.equal(context.symbol, "PACK");
  assert.equal(context.mode, "trade_analysis");
  assert.equal(context.candleFetchingOwnedBy, "levels-system");
  assert.equal(context.supportResistanceContext.mode, "symbol");
  assert.equal(context.supportResistanceContext.candleFetchingOwnedBy, "levels-system");
  assert.equal(context.tradeWindow.timeframe, "1m");
  assert.ok(["fresh", "usable", "partial", "stale", "missing"].includes(context.tradeWindow.fetch.freshnessStatus));
  assert.equal(context.tradeWindow.tradeStartTimestamp, tradeStart);
  assert.equal(context.tradeWindow.tradeEndTimestamp, tradeEnd);
  assert.ok(context.tradeWindow.preTradeCandles.length > 0);
  assert.ok(context.tradeWindow.tradeCandles.length > 0);
  assert.ok(context.tradeWindow.postTradeCandles.length > 0);
  assert.ok(context.tradeWindow.allCandles.every((candle) => candle.timestamp <= asOfTimestamp));
  assert.ok(context.supportResistanceContext.dynamicLevels.ema9 !== null);
  assert.equal(context.supportResistanceContext.marketStructure.symbol, "PACK");
  assert.equal(context.executionRelations.length, 2);
  assert.ok(context.executionRelations.every((execution) => execution.levelRelations !== null));
  assert.ok(context.executionRelations.every((execution) => execution.dynamicLevelRelations !== null));
  assert.ok(context.executionRelations.every((execution) => execution.marketStructureState !== "insufficient_data"));
  assert.equal(context.executionRelations[0]?.side, "buy");
  assert.equal(context.executionRelations[1]?.side, "sell");
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "trade_window_fetched"));
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "trade_window_truncated_by_as_of"));
});

test("trade analysis execution relations respect asOfTimestamp and avoid future execution leakage", async () => {
  const tradeStart = Date.UTC(2026, 4, 1, 15, 30, 0);
  const asOfTimestamp = tradeStart + 5 * 60_000;
  const futureExecutionTimestamp = tradeStart + 20 * 60_000;

  const context = await buildTradeAnalysisCandleContext({
    symbol: "future",
    sessionDate: "2026-05-01",
    asOfTimestamp,
    executions: [
      { timestamp: tradeStart, price: 4.5, quantity: 100, side: "buy" },
      { timestamp: futureExecutionTimestamp, price: 4.9, quantity: 100, side: "sell" },
    ],
    supportResistance: {
      lookbackBars: {
        daily: 180,
        "4h": 120,
        "5m": 90,
      },
    },
    tradeWindow: {
      timeframe: "1m",
      preTradeMinutes: 15,
      postTradeMinutes: 30,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider: new StubHistoricalCandleProvider(),
    },
  });

  assert.equal(context.executionRelations.length, 2);
  assert.ok(context.executionRelations[0]?.levelRelations);
  assert.equal(context.executionRelations[1]?.levelRelations, null);
  assert.equal(context.executionRelations[1]?.dynamicLevelRelations, null);
  assert.ok(
    context.executionRelations[1]?.diagnostics.some(
      (diagnostic) => diagnostic.code === "execution_after_as_of",
    ),
  );
  assert.ok(context.tradeWindow.allCandles.every((candle) => candle.timestamp <= asOfTimestamp));
});

test("trade analysis context can use explicit trade bounds without executions", async () => {
  const tradeStart = Date.UTC(2026, 4, 1, 14, 0, 0);
  const tradeEnd = tradeStart + 5 * 60_000;

  const context = await buildTradeAnalysisCandleContext({
    symbol: "bounds",
    sessionDate: "2026-05-01",
    tradeStartTimestamp: tradeStart,
    tradeEndTimestamp: tradeEnd,
    asOfTimestamp: tradeEnd + 15 * 60_000,
    supportResistance: {
      lookbackBars: {
        daily: 180,
        "4h": 120,
        "5m": 90,
      },
    },
    tradeWindow: {
      timeframe: "5m",
      preTradeMinutes: 15,
      postTradeMinutes: 15,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider: new StubHistoricalCandleProvider(),
    },
  });

  assert.equal(context.tradeWindow.timeframe, "5m");
  assert.equal(context.tradeWindow.tradeStartTimestamp, tradeStart);
  assert.equal(context.tradeWindow.tradeEndTimestamp, tradeEnd);
  assert.ok(context.tradeWindow.allCandles.length > 0);
});

test("aggregateCandlesToFiveMinutes preserves OHLCV rollup", () => {
  const start = Date.UTC(2026, 4, 1, 13, 30, 0);
  const candles: Candle[] = [
    { timestamp: start, open: 1, high: 1.1, low: 0.95, close: 1.05, volume: 100 },
    { timestamp: start + 60_000, open: 1.05, high: 1.2, low: 1, close: 1.15, volume: 200 },
    { timestamp: start + 5 * 60_000, open: 1.15, high: 1.25, low: 1.1, close: 1.2, volume: 300 },
  ];

  const aggregated = aggregateCandlesToFiveMinutes(candles);

  assert.deepEqual(aggregated, [
    { timestamp: start, open: 1, high: 1.2, low: 0.95, close: 1.15, volume: 300 },
    { timestamp: start + 5 * 60_000, open: 1.15, high: 1.25, low: 1.1, close: 1.2, volume: 300 },
  ]);
});
