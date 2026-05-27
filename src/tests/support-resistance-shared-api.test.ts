import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  aggregateCandlesToFiveMinutes,
  buildDefaultTradeAnalysisCandleContext,
  buildSupportResistanceContextFromCandles,
  buildSupportResistanceContextForSymbol,
  buildSupportResistanceContextFromSingleTimeframeCandles,
  buildTradeAnalysisCandleContext,
  CandleFetchService,
  createIbkrOnDemandCandleFetchServiceOptions,
  fetchSupportResistanceContextFromSingleTimeframeCandles,
  StubHistoricalCandleProvider,
  type BaseCandleProviderResponse,
  type Candle,
  type CandleFetchTimeframe,
  type HistoricalFetchRequest,
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

function candle(
  timestamp: number,
  close: number,
  volume = 100_000,
): Candle {
  return {
    timestamp,
    open: close,
    high: Number((close * 1.02).toFixed(4)),
    low: Number((close * 0.98).toFixed(4)),
    close,
    volume,
  };
}

class CountingHistoricalProvider extends StubHistoricalCandleProvider {
  readonly calls: HistoricalFetchRequest[] = [];

  constructor(private readonly options: {
    emptyOneMinute?: boolean;
    stalePartialOneMinute?: boolean;
    basePrice?: number;
  } = {}) {
    super();
  }

  override async fetchCandles(request: HistoricalFetchRequest): Promise<BaseCandleProviderResponse> {
    this.calls.push({ ...request });
    const end = request.endTimeMs ?? Date.UTC(2026, 4, 1, 20, 0);
    const interval =
      request.timeframe === "1m"
        ? 60_000
        : request.timeframe === "5m"
          ? 5 * 60_000
          : request.timeframe === "4h"
            ? 4 * 60 * 60_000
            : 24 * 60 * 60_000;
    const candleCount =
      this.options.emptyOneMinute && request.timeframe === "1m"
        ? 0
        : this.options.stalePartialOneMinute && request.timeframe === "1m"
          ? Math.min(8, request.lookbackBars)
          : request.lookbackBars;
    const candleEnd =
      this.options.stalePartialOneMinute && request.timeframe === "1m"
        ? end - 60 * 60_000
        : end;
    const candles =
      candleCount === 0
        ? []
        : Array.from({ length: candleCount }, (_, index) => {
            const timestamp = candleEnd - (candleCount - 1 - index) * interval;
            const base = (this.options.basePrice ?? 4) + index * 0.01;
            return candle(timestamp, Number(base.toFixed(4)), 100_000 + index * 100);
          });

    return {
      provider: "stub",
      symbol: request.symbol.toUpperCase(),
      timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars,
      candles,
      fetchStartTimestamp: Date.UTC(2026, 4, 1, 12, 0),
      fetchEndTimestamp: Date.UTC(2026, 4, 1, 12, 0, 1),
      requestedStartTimestamp: end - request.lookbackBars * interval,
      requestedEndTimestamp: end,
      sessionMetadataAvailable: request.timeframe === "1m" || request.timeframe === "5m",
      providerMetadata: {
        source: "counting_test_provider",
      },
    };
  }

  count(timeframe: CandleFetchTimeframe): number {
    return this.calls.filter((call) => call.timeframe === timeframe).length;
  }
}

class FakeIbkrHistoricalClient {
  isConnected = false;
  connectCount = 0;
  requestedHistoricalData = 0;
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(eventName: string, handler: (...args: unknown[]) => void): void {
    const handlers = this.listeners.get(eventName) ?? new Set();
    handlers.add(handler);
    this.listeners.set(eventName, handlers);
  }

  off(eventName: string, handler: (...args: unknown[]) => void): void {
    this.listeners.get(eventName)?.delete(handler);
  }

  connect(): void {
    this.connectCount += 1;
    this.isConnected = true;
    this.emit("connected");
  }

  reqHistoricalData(
    reqId: number,
    _contract: Record<string, unknown>,
    _endDateTime: string,
    _durationStr: string,
    _barSizeSetting: string,
    _whatToShow: string,
    _useRTH: number | boolean,
    _formatDate: number,
    _keepUpToDate: boolean,
  ): void {
    this.requestedHistoricalData += 1;
    const end = Date.UTC(2026, 1, 3, 15, 0, 0);
    setTimeout(() => {
      for (let index = 2; index >= 0; index -= 1) {
        this.emit(
          "historicalData",
          reqId,
          Math.floor((end - index * 5 * 60_000) / 1000),
          4.1 + index * 0.01,
          4.2 + index * 0.01,
          4.0 + index * 0.01,
          4.15 + index * 0.01,
          100_000 + index,
        );
      }
      this.emit("historicalDataEnd", reqId, "", "");
    }, 0);
  }

  cancelHistoricalData(_reqId: number): void {
    // No-op for this fake client.
  }

  private emit(eventName: string, ...args: unknown[]): void {
    for (const handler of this.listeners.get(eventName) ?? []) {
      handler(...args);
    }
  }
}

class MinuteAlignedHistoricalProvider extends StubHistoricalCandleProvider {
  readonly calls: HistoricalFetchRequest[] = [];

  override async fetchCandles(request: HistoricalFetchRequest): Promise<BaseCandleProviderResponse> {
    this.calls.push({ ...request });
    const interval =
      request.timeframe === "1m"
        ? 60_000
        : request.timeframe === "5m"
          ? 5 * 60_000
          : request.timeframe === "4h"
            ? 4 * 60 * 60_000
            : 24 * 60 * 60_000;
    const end = Math.floor((request.endTimeMs ?? Date.UTC(2026, 4, 1, 20, 0)) / interval) * interval;
    const candles = Array.from({ length: request.lookbackBars }, (_, index) => {
      const timestamp = end - (request.lookbackBars - 1 - index) * interval;
      return candle(timestamp, 1 + index * 0.01, 100_000 + index * 100);
    });

    return {
      provider: "stub",
      symbol: request.symbol.toUpperCase(),
      timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars,
      candles,
      fetchStartTimestamp: candles[0]?.timestamp ?? end,
      fetchEndTimestamp: candles.at(-1)?.timestamp ?? end,
      requestedStartTimestamp: end - request.lookbackBars * interval,
      requestedEndTimestamp: request.endTimeMs ?? end,
      sessionMetadataAvailable: request.timeframe === "1m" || request.timeframe === "5m",
      providerMetadata: {
        source: "minute_aligned_test_provider",
      },
    };
  }
}

class FutureSpikeHistoricalProvider extends StubHistoricalCandleProvider {
  constructor(private readonly spikeAfterTimestamp: number) {
    super();
  }

  override async fetchCandles(request: HistoricalFetchRequest): Promise<BaseCandleProviderResponse> {
    const end = request.endTimeMs ?? Date.UTC(2026, 4, 1, 20, 0);
    const interval =
      request.timeframe === "1m"
        ? 60_000
        : request.timeframe === "5m"
          ? 5 * 60_000
          : request.timeframe === "4h"
            ? 4 * 60 * 60_000
            : 24 * 60 * 60_000;
    const candles = Array.from({ length: request.lookbackBars }, (_, index) => {
      const timestamp = end - (request.lookbackBars - 1 - index) * interval;
      const close = timestamp <= this.spikeAfterTimestamp ? 10 : 100;
      return candle(timestamp, close, 100_000 + index * 100);
    });

    return {
      provider: "stub",
      symbol: request.symbol.toUpperCase(),
      timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars,
      candles,
      fetchStartTimestamp: Date.UTC(2026, 4, 1, 12, 0),
      fetchEndTimestamp: Date.UTC(2026, 4, 1, 12, 0, 1),
      requestedStartTimestamp: end - request.lookbackBars * interval,
      requestedEndTimestamp: end,
      sessionMetadataAvailable: request.timeframe === "1m" || request.timeframe === "5m",
      providerMetadata: {
        source: "future_spike_test_provider",
      },
    };
  }
}

class FutureAppendingHistoricalProvider extends StubHistoricalCandleProvider {
  constructor(private readonly includeFutureCandle: boolean) {
    super();
  }

  override async fetchCandles(request: HistoricalFetchRequest): Promise<BaseCandleProviderResponse> {
    const end = request.endTimeMs ?? Date.parse("2026-05-01T15:33:00-04:00");
    const interval =
      request.timeframe === "1m"
        ? 60_000
        : request.timeframe === "5m"
          ? 5 * 60_000
          : request.timeframe === "4h"
            ? 4 * 60 * 60_000
            : 24 * 60 * 60_000;
    const latestClosedStart =
      request.timeframe === "daily"
        ? Date.parse("2026-04-30T00:00:00-04:00")
        : end - interval;
    const basePrice =
      request.timeframe === "daily"
        ? 4.1
        : request.timeframe === "4h"
          ? 4.25
          : request.timeframe === "5m"
            ? 4.4
            : 4.45;
    const candles = buildCandles({
      count: request.lookbackBars,
      start: latestClosedStart - (request.lookbackBars - 1) * interval,
      intervalMs: interval,
      basePrice,
      wave: request.timeframe === "daily" ? 0.08 : 0.035,
    });

    if (this.includeFutureCandle) {
      candles.push({
        timestamp: end + interval,
        open: 50,
        high: 55,
        low: 49,
        close: 54,
        volume: 10_000_000,
      });
    }

    return {
      provider: "stub",
      symbol: request.symbol.toUpperCase(),
      timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars,
      candles,
      fetchStartTimestamp: Date.UTC(2026, 4, 1, 12, 0),
      fetchEndTimestamp: Date.UTC(2026, 4, 1, 12, 0, 1),
      requestedStartTimestamp: latestClosedStart - request.lookbackBars * interval,
      requestedEndTimestamp: end,
      sessionMetadataAvailable: request.timeframe === "1m" || request.timeframe === "5m",
      providerMetadata: {
        source: "future_appending_test_provider",
      },
    };
  }
}

class AliasMetadataHistoricalProvider extends CountingHistoricalProvider {
  override async fetchCandles(request: HistoricalFetchRequest): Promise<BaseCandleProviderResponse> {
    const response = await super.fetchCandles(request);
    return {
      ...response,
      provider: "ibkr",
      symbol: "MAXN",
      providerMetadata: {
        ...response.providerMetadata,
        ibkrRequestedSymbol: "MAXN",
        ibkrResolvedSymbol: "MAXNQ",
        ibkrResolvedConId: 733975592,
        ibkrResolvedExchange: "SMART",
        ibkrResolvedPrimaryExchange: "PINK",
        ibkrContractAliasUsed: true,
        ibkrHistoricalAliasReason: "post_delisting_symbol_change",
      },
    };
  }
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
  const dayMs = 24 * 60 * 60 * 1000;
  const fourHourMs = 4 * 60 * 60 * 1000;
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
        start: asOfTimestamp - 180 * dayMs,
        intervalMs: dayMs,
        basePrice: 4.1,
        wave: 0.05,
      })),
      "4h": toIsoCandles(buildCandles({
        count: 120,
        start: asOfTimestamp - 120 * fourHourMs,
        intervalMs: fourHourMs,
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
  const asOfTimestamp = start + 120 * 60 * 1000;
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
  assert.ok(
    context.executionRelations.every((execution) =>
      execution.levelRelations?.nearestSupportBelow?.timeframeSources.some(
        (timeframe) => timeframe === "daily" || timeframe === "4h",
      ) !== false &&
      execution.levelRelations?.nearestResistanceAbove?.timeframeSources.some(
        (timeframe) => timeframe === "daily" || timeframe === "4h",
      ) !== false,
    ),
  );
  assert.ok(context.executionRelations.every((execution) => execution.dynamicLevelRelations !== null));
  assert.ok(context.executionRelations.every((execution) => execution.marketStructureState !== "insufficient_data"));
  assert.equal(context.executionRelations[0]?.side, "buy");
  assert.equal(context.executionRelations[1]?.side, "sell");
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "trade_window_fetched"));
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "trade_window_truncated_by_as_of"));
});

test("trade analysis fetches execution-time support/resistance contexts at each historical fill timestamp", async () => {
  const tradeStart = Date.UTC(2026, 4, 1, 15, 30, 0);
  const tradeEnd = tradeStart + 12 * 60_000;
  const asOfTimestamp = tradeEnd + 30 * 60_000;
  const provider = new CountingHistoricalProvider();

  const context = await buildTradeAnalysisCandleContext({
    symbol: "hist",
    sessionDate: "2026-05-01",
    asOfTimestamp,
    executions: [
      { timestamp: tradeStart, price: 4.5, quantity: 100, side: "buy" },
      { timestamp: tradeEnd, price: 4.7, quantity: 100, side: "sell" },
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
      postTradeMinutes: 30,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider,
    },
  });

  const dailyEndTimes = provider.calls
    .filter((call) => call.timeframe === "daily")
    .map((call) => call.endTimeMs);
  const fourHourEndTimes = provider.calls
    .filter((call) => call.timeframe === "4h")
    .map((call) => call.endTimeMs);

  assert.ok(dailyEndTimes.some((timestamp) => timestamp === tradeStart));
  assert.ok(dailyEndTimes.some((timestamp) => timestamp === tradeEnd));
  assert.ok(fourHourEndTimes.some((timestamp) => timestamp === tradeStart));
  assert.ok(fourHourEndTimes.some((timestamp) => timestamp === tradeEnd));
  assert.equal(context.executionRelations.length, 2);
  assert.ok(context.executionRelations.every((execution) => execution.levelRelations !== null));
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "historical_higher_timeframe_closed_candle_cutoff"));
});

test("execution support/resistance context is stable when future candles are appended after execution time", async () => {
  const executionTimestamp = Date.parse("2026-05-01T15:33:00-04:00");
  const baseRequest = {
    symbol: "nofuture",
    sessionDate: "2026-05-01",
    tradeStartTimestamp: executionTimestamp,
    tradeEndTimestamp: executionTimestamp,
    asOfTimestamp: executionTimestamp,
    executions: [
      { timestamp: executionTimestamp, price: 4.5, quantity: 100, side: "buy" as const },
    ],
    supportResistance: {
      lookbackBars: {
        daily: 120,
        "4h": 90,
        "5m": 80,
      },
    },
    tradeWindow: {
      timeframe: "5m" as const,
      preTradeMinutes: 60,
      postTradeMinutes: 0,
      paddingMinutes: 0,
      lookbackBars: 80,
    },
  };

  const baseline = await buildTradeAnalysisCandleContext({
    ...baseRequest,
    fetchServiceOptions: {
      provider: new FutureAppendingHistoricalProvider(false),
    },
  });
  const withFuture = await buildTradeAnalysisCandleContext({
    ...baseRequest,
    fetchServiceOptions: {
      provider: new FutureAppendingHistoricalProvider(true),
    },
  });

  assert.deepEqual(withFuture.executionRelations[0]?.levelRelations, baseline.executionRelations[0]?.levelRelations);
  assert.deepEqual(
    withFuture.executionRelations[0]?.dynamicLevelRelations,
    baseline.executionRelations[0]?.dynamicLevelRelations,
  );
  assert.ok(withFuture.supportResistanceContext.diagnostics.some(
    (diagnostic) => diagnostic.code === "future_candles_filtered",
  ));
  assert.ok(withFuture.diagnostics.some((diagnostic) => diagnostic.code === "future_candles_filtered"));
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

test("trade analysis execution dynamic relations are calculated as of each execution timestamp", async () => {
  const tradeStart = Date.UTC(2026, 4, 1, 15, 30, 0);
  const tradeEnd = tradeStart + 18 * 60_000;
  const asOfTimestamp = tradeEnd + 20 * 60_000;

  const context = await buildTradeAnalysisCandleContext({
    symbol: "asof",
    sessionDate: "2026-05-01",
    tradeStartTimestamp: tradeStart,
    tradeEndTimestamp: tradeEnd,
    asOfTimestamp,
    executions: [
      { timestamp: tradeStart, price: 10, quantity: 100, side: "buy" },
      { timestamp: tradeEnd, price: 100, quantity: 100, side: "sell" },
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
      postTradeMinutes: 20,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider: new FutureSpikeHistoricalProvider(tradeStart),
    },
  });

  assert.equal(context.executionRelations.length, 2);
  assert.equal(context.executionRelations[0]?.dynamicLevelRelations?.aboveVwap, true);
  assert.equal(context.executionRelations[0]?.dynamicLevelRelations?.priceVsVwapPct, 0);
  assert.equal(context.executionRelations[0]?.dynamicLevelRelations?.aboveEma9, true);
  assert.equal(context.executionRelations[0]?.dynamicLevelRelations?.priceVsEma9Pct, 0);
  assert.ok((context.executionRelations[1]?.dynamicLevelRelations?.priceVsVwapPct ?? 0) > 0);
  assert.ok(context.tradeWindow.dynamicLevels.vwap !== null);
  assert.notEqual(context.tradeWindow.dynamicLevels.vwap, context.executionRelations[0]?.dynamicLevelRelations?.currentPrice);
});

test("trade analysis marketFacts excludes VWAP and EMA from the default trader-intelligence contract", async () => {
  const tradeStart = Date.UTC(2026, 4, 1, 15, 30, 0);
  const tradeEnd = Date.UTC(2026, 4, 2, 15, 30, 0);
  const asOfTimestamp = tradeEnd + 30 * 60_000;

  const context = await buildTradeAnalysisCandleContext({
    symbol: "long",
    sessionDate: "2026-05-01",
    tradeStartTimestamp: tradeStart,
    tradeEndTimestamp: tradeEnd,
    asOfTimestamp,
    executions: [
      { timestamp: tradeStart, price: 10, quantity: 100, side: "buy" },
      { timestamp: tradeEnd, price: 100, quantity: 100, side: "sell" },
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
      postTradeMinutes: 30,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider: new FutureSpikeHistoricalProvider(tradeStart),
    },
  });

  assert.equal(context.tradeWindow.timeframe, "1m");
  assert.equal(context.executionRelations.length, 2);
  assert.deepEqual(
    context.marketFacts.benchmarkDefinitions.map((definition) => definition.benchmarkId),
    ["nearest_daily_4h_support", "nearest_daily_4h_resistance"],
  );
  assert.ok(
    context.marketFacts.executionSnapshots.every((snapshot) =>
      snapshot.relations.every((relation) => relation.kind === "support" || relation.kind === "resistance"),
    ),
  );
  assert.equal(
    context.marketFacts.diagnostics.some((diagnostic) =>
      diagnostic.affectedBenchmarkIds.some((id) => id.includes("vwap") || id.includes("ema")),
    ),
    false,
  );
});

test("trade analysis marketFacts returns daily/4h level evidence with basis and quality metadata", async () => {
  const tradeStart = Date.UTC(2026, 4, 1, 15, 30, 0);
  const tradeEnd = Date.UTC(2026, 4, 1, 15, 43, 0);

  const context = await buildTradeAnalysisCandleContext({
    symbol: "open",
    sessionDate: "2026-05-01",
    tradeStartTimestamp: tradeStart,
    tradeEndTimestamp: tradeEnd,
    asOfTimestamp: tradeEnd + 30 * 60_000,
    executions: [
      { timestamp: tradeStart, price: 4.5, quantity: 100, side: "buy" },
      { timestamp: tradeEnd, price: 4.7, quantity: 100, side: "sell" },
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
      preTradeMinutes: 10,
      postTradeMinutes: 30,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider: new StubHistoricalCandleProvider(),
    },
  });

  assert.equal(context.marketFacts.contractVersion, "market_facts.trade_review.v2");
  assert.equal(context.marketFacts.noLookaheadPolicy.policy, "closed_candles_only");
  assert.equal(context.marketFacts.executionSnapshots.length, 2);
  const entry = context.marketFacts.executionSnapshots[0]!;
  const support = entry.relations.find((relation) => relation.benchmarkId === "nearest_daily_4h_support");
  const resistance = entry.relations.find((relation) => relation.benchmarkId === "nearest_daily_4h_resistance");

  assert.ok(support);
  assert.ok(resistance);
  assert.equal(support.kind, "support");
  assert.equal(resistance.kind, "resistance");
  assert.ok(support.level);
  assert.ok(resistance.level);
  assert.ok(support.level.timeframeSources.some((timeframe) => timeframe === "daily" || timeframe === "4h"));
  assert.ok(resistance.level.timeframeSources.some((timeframe) => timeframe === "daily" || timeframe === "4h"));
  assert.ok(["weak", "moderate", "strong", "major"].includes(support.level.strengthLabel));
  assert.equal(typeof support.level.strengthScore, "number");
  assert.equal(typeof support.level.sourceEvidenceCount, "number");
  assert.equal(support.basis.endTimestamp, new Date(tradeStart).toISOString());
  assert.ok(context.marketFacts.tradeWindowSummary.holdDurationMinutes > 0);
  assert.ok(context.marketFacts.tradeWindowSummary.highDuringTrade !== null);
  assert.notEqual(context.marketFacts.tradeWindowSummary.reachedNearestDaily4hResistanceDuringTrade, undefined);
  assert.ok(context.marketFacts.postTradeSummary);
  assert.notEqual(context.marketFacts.postTradeSummary?.reachedNearestDaily4hResistanceAfterExit, undefined);
  assert.equal(entry.relations.some((relation) => relation.kind === "vwap" || relation.kind === "ema"), false);
});

test("trade analysis enriched profile still keeps feedback-facing benchmarks daily/4h only", async () => {
  const tradeStart = Date.UTC(2026, 4, 1, 15, 30, 0);
  const tradeEnd = tradeStart + 20 * 60_000;

  const context = await buildTradeAnalysisCandleContext({
    symbol: "rich",
    sessionDate: "2026-05-01",
    tradeStartTimestamp: tradeStart,
    tradeEndTimestamp: tradeEnd,
    asOfTimestamp: tradeEnd + 30 * 60_000,
    executions: [
      { timestamp: tradeStart, price: 4.2, quantity: 100, side: "buy" },
      { timestamp: tradeEnd, price: 4.4, quantity: 100, side: "sell" },
    ],
    supportResistance: {
      lookbackBars: {
        daily: 60,
        "4h": 40,
        "5m": 30,
      },
    },
    tradeWindow: {
      timeframe: "1m",
      preTradeMinutes: 120,
      postTradeMinutes: 30,
      paddingMinutes: 0,
    },
    marketFacts: {
      benchmarkProfile: "small_cap_day_trade_enriched_v1",
    },
    fetchServiceOptions: {
      provider: new CountingHistoricalProvider(),
    },
  });

  assert.equal(context.marketFacts.benchmarkProfile, "small_cap_day_trade_enriched_v1");
  const entry = context.marketFacts.executionSnapshots[0]!;
  assert.deepEqual(
    context.marketFacts.benchmarkDefinitions.map((definition) => definition.benchmarkId),
    ["nearest_daily_4h_support", "nearest_daily_4h_resistance"],
  );
  assert.ok(entry.relations.every((relation) => relation.kind === "support" || relation.kind === "resistance"));
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

test("default trade analysis context fetches and stores historical 1m trade-window candles", async () => {
  const root = await mkdtemp(join(tmpdir(), "trade-analysis-warehouse-1m-"));
  const provider = new CountingHistoricalProvider();
  const tradeStart = Date.UTC(2026, 1, 3, 15, 0, 0);
  const tradeEnd = tradeStart + 8 * 60_000;
  const asOfTimestamp = tradeEnd + 20 * 60_000;

  const context = await buildDefaultTradeAnalysisCandleContext({
    symbol: "hist",
    sessionDate: "2026-02-03",
    warehouseDirectoryPath: root,
    asOfTimestamp,
    executions: [
      { timestamp: tradeStart, price: 4.2, quantity: 100, side: "buy" },
      { timestamp: tradeEnd, price: 4.45, quantity: 100, side: "sell" },
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
      preTradeMinutes: 10,
      postTradeMinutes: 20,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider,
    },
  });

  assert.equal(context.symbol, "HIST");
  assert.equal(context.tradeWindow.requestedTimeframe, "1m");
  assert.equal(context.tradeWindow.timeframe, "1m");
  assert.equal(context.tradeWindow.fallbackUsed, false);
  assert.ok(context.tradeWindow.allCandles.length > 0);
  assert.ok(context.tradeWindow.dynamicLevels.ema9 !== null);
  assert.ok(context.tradeWindowFacts.referencePrice !== null);
  assert.ok(context.tradeWindowFacts.highestHighDuringTrade !== null);
  assert.ok(context.tradeWindow.allCandles.every((item) => item.timestamp <= asOfTimestamp));
  assert.equal(context.tradeWindow.fetch.provider, "stub");
  assert.equal(provider.count("1m"), 1);
});

test("trade analysis context explicitly falls back to 5m when 1m historical candles are unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "trade-analysis-warehouse-5m-fallback-"));
  const provider = new CountingHistoricalProvider({ emptyOneMinute: true });
  const tradeStart = Date.UTC(2026, 1, 3, 15, 0, 0);
  const tradeEnd = tradeStart + 12 * 60_000;

  const context = await buildDefaultTradeAnalysisCandleContext({
    symbol: "fall",
    sessionDate: "2026-02-03",
    warehouseDirectoryPath: root,
    asOfTimestamp: tradeEnd + 30 * 60_000,
    executions: [
      { timestamp: tradeStart, price: 4.2, quantity: 100, side: "buy" },
      { timestamp: tradeEnd, price: 4.4, quantity: 100, side: "sell" },
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
      preTradeMinutes: 10,
      postTradeMinutes: 20,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider,
    },
  });

  assert.equal(context.tradeWindow.requestedTimeframe, "1m");
  assert.equal(context.tradeWindow.timeframe, "5m");
  assert.equal(context.tradeWindow.fallbackUsed, true);
  assert.ok(provider.count("1m") >= 1);
  assert.ok(provider.count("5m") >= 1);
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "trade_window_one_minute_unavailable"));
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "trade_window_fell_back_to_5m"));
});

test("trade analysis context falls back to 5m when partial 1m replay is stale before the requested window end", async () => {
  const root = await mkdtemp(join(tmpdir(), "trade-analysis-warehouse-stale-1m-fallback-"));
  const provider = new CountingHistoricalProvider({ stalePartialOneMinute: true });
  const tradeStart = Date.UTC(2026, 1, 3, 15, 0, 0);
  const tradeEnd = tradeStart + 12 * 60_000;

  const context = await buildDefaultTradeAnalysisCandleContext({
    symbol: "tail",
    sessionDate: "2026-02-03",
    warehouseDirectoryPath: root,
    asOfTimestamp: tradeEnd + 45 * 60_000,
    executions: [
      { timestamp: tradeStart, price: 4.2, quantity: 100, side: "buy" },
      { timestamp: tradeEnd, price: 4.4, quantity: 100, side: "sell" },
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
      preTradeMinutes: 10,
      postTradeMinutes: 20,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider,
    },
  });

  assert.equal(context.tradeWindow.requestedTimeframe, "1m");
  assert.equal(context.tradeWindow.timeframe, "5m");
  assert.equal(context.tradeWindow.fallbackUsed, true);
  assert.ok(context.tradeWindow.postTradeCandles.length > 0);
  assert.ok(provider.count("1m") >= 1);
  assert.ok(provider.count("5m") >= 1);
  const fallbackDiagnostic = context.diagnostics.find(
    (diagnostic) => diagnostic.code === "trade_window_one_minute_unavailable",
  );
  assert.ok(fallbackDiagnostic);
  assert.match(fallbackDiagnostic.message, /partial and stale/);
  assert.match(fallbackDiagnostic.message, /more than 15 minutes before requested window end/);
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "trade_window_fell_back_to_5m"));
});

test("trade analysis context reuses cached historical trade-window candles on repeat request", async () => {
  const root = await mkdtemp(join(tmpdir(), "trade-analysis-warehouse-cache-"));
  const provider = new CountingHistoricalProvider();
  const tradeStart = Date.UTC(2026, 1, 3, 15, 0, 0);
  const tradeEnd = tradeStart + 10 * 60_000;
  const request = {
    symbol: "cache",
    sessionDate: "2026-02-03",
    warehouseDirectoryPath: root,
    asOfTimestamp: tradeEnd + 30 * 60_000,
    executions: [
      { timestamp: tradeStart, price: 4.2, quantity: 100, side: "buy" as const },
      { timestamp: tradeEnd, price: 4.4, quantity: 100, side: "sell" as const },
    ],
    supportResistance: {
      lookbackBars: {
        daily: 180,
        "4h": 120,
        "5m": 90,
      },
    },
    tradeWindow: {
      timeframe: "1m" as const,
      preTradeMinutes: 10,
      postTradeMinutes: 20,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider,
    },
  };

  await buildDefaultTradeAnalysisCandleContext(request);
  const callsAfterFirst = provider.calls.length;
  const oneMinuteCallsAfterFirst = provider.count("1m");
  const cached = await buildDefaultTradeAnalysisCandleContext(request);

  assert.ok(provider.calls.length < callsAfterFirst * 2);
  assert.equal(provider.count("1m"), oneMinuteCallsAfterFirst);
  assert.equal(cached.tradeWindow.fetch.provider, "stub");
  assert.ok(cached.tradeWindow.allCandles.length > 0);
});

test("IBKR on-demand fetch options connect lazily before fetching candles", async () => {
  const ib = new FakeIbkrHistoricalClient();
  const fetchService = new CandleFetchService(
    createIbkrOnDemandCandleFetchServiceOptions({
      ib: ib as never,
      connectionTimeoutMs: 250,
      historicalTimeoutMs: 1_000,
    }),
  );

  const response = await fetchService.fetchCandles({
    symbol: "lazy",
    timeframe: "5m",
    lookbackBars: 3,
    endTimeMs: Date.UTC(2026, 1, 3, 15, 0, 0),
    preferredProvider: "ibkr",
  });

  assert.equal(response.provider, "ibkr");
  assert.equal(response.symbol, "LAZY");
  assert.equal(response.candles.length, 3);
  assert.equal(ib.connectCount, 1);
  assert.equal(ib.requestedHistoricalData, 1);
});

test("trade analysis context bounds historical candles by asOfTimestamp instead of current live time", async () => {
  const root = await mkdtemp(join(tmpdir(), "trade-analysis-warehouse-asof-"));
  const provider = new CountingHistoricalProvider();
  const tradeStart = Date.UTC(2025, 10, 14, 15, 0, 0);
  const tradeEnd = tradeStart + 10 * 60_000;
  const asOfTimestamp = tradeEnd + 5 * 60_000;

  const context = await buildDefaultTradeAnalysisCandleContext({
    symbol: "old",
    sessionDate: "2025-11-14",
    warehouseDirectoryPath: root,
    asOfTimestamp,
    executions: [
      { timestamp: tradeStart, price: 3.5, quantity: 100, side: "buy" },
      { timestamp: tradeEnd, price: 3.62, quantity: 100, side: "sell" },
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
      preTradeMinutes: 10,
      postTradeMinutes: 60,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider,
    },
  });

  assert.ok(context.tradeWindow.allCandles.every((item) => item.timestamp <= asOfTimestamp));
  assert.ok(provider.calls.every((call) => (call.endTimeMs ?? asOfTimestamp) <= asOfTimestamp));
  assert.ok(provider.calls.some((call) => call.endTimeMs === tradeStart));
  assert.ok(provider.calls.some((call) => call.endTimeMs === tradeEnd));
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "trade_window_truncated_by_as_of"));
});

test("trade analysis context diagnoses likely execution/candle price adjustment mismatches", async () => {
  const root = await mkdtemp(join(tmpdir(), "trade-analysis-warehouse-price-mismatch-"));
  const provider = new CountingHistoricalProvider({ basePrice: 100 });
  const tradeStart = Date.UTC(2026, 1, 3, 15, 0, 0);
  const tradeEnd = tradeStart + 8 * 60_000;

  const context = await buildDefaultTradeAnalysisCandleContext({
    symbol: "split",
    sessionDate: "2026-02-03",
    warehouseDirectoryPath: root,
    asOfTimestamp: tradeEnd + 20 * 60_000,
    executions: [
      { timestamp: tradeStart, price: 3.5, quantity: 100, side: "buy" },
      { timestamp: tradeEnd, price: 3.7, quantity: 100, side: "sell" },
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
      preTradeMinutes: 10,
      postTradeMinutes: 20,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider,
    },
  });

  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "historical_price_anchor_used"));
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "possible_price_adjustment_mismatch"));
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "likely_price_basis_adjustment_multiple"));
  assert.ok(context.diagnostics.some((diagnostic) => diagnostic.code === "trade_window_price_basis_unverified"));
  assert.match(
    context.diagnostics.find((diagnostic) => diagnostic.code === "trade_window_basis_validation_status")?.message ?? "",
    /basis_adjustment_multiple_likely/,
  );
});

test("default trade analysis context does not synthesize stub candles without an explicit provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "trade-analysis-no-stub-default-"));
  const tradeStart = Date.UTC(2026, 1, 3, 15, 0, 0);
  const tradeEnd = tradeStart + 8 * 60_000;

  await assert.rejects(
    () => buildDefaultTradeAnalysisCandleContext({
      symbol: "nostub",
      sessionDate: "2026-02-03",
      warehouseDirectoryPath: root,
      asOfTimestamp: tradeEnd + 20 * 60_000,
      executions: [
        { timestamp: tradeStart, price: 3.5, quantity: 100, side: "buy" },
        { timestamp: tradeEnd, price: 3.7, quantity: 100, side: "sell" },
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
        preTradeMinutes: 10,
        postTradeMinutes: 20,
        paddingMinutes: 0,
      },
    }),
    /Durable candle warehouse miss for NOSTUB/,
  );
});

test("trade analysis context diagnoses consumer-visible execution/candle price disconnects", async () => {
  const root = await mkdtemp(join(tmpdir(), "trade-analysis-warehouse-execution-disconnect-"));
  const provider = new CountingHistoricalProvider({ basePrice: 6.6 });
  const tradeStart = Date.UTC(2026, 1, 3, 15, 0, 0);
  const tradeEnd = tradeStart + 8 * 60_000;

  const context = await buildDefaultTradeAnalysisCandleContext({
    symbol: "disconnect",
    sessionDate: "2026-02-03",
    warehouseDirectoryPath: root,
    asOfTimestamp: tradeEnd + 20 * 60_000,
    executions: [
      { timestamp: tradeStart, price: 4, quantity: 100, side: "buy" },
      { timestamp: tradeEnd, price: 4.05, quantity: 100, side: "sell" },
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
      preTradeMinutes: 10,
      postTradeMinutes: 20,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider,
    },
  });

  const diagnostic = context.diagnostics.find(
    (item) => item.code === "possible_price_adjustment_mismatch",
  );
  assert.ok(diagnostic);
  assert.match(diagnostic.message, /largest execution\/candle distance/);
  assert.match(diagnostic.message, /possible split\/adjustment, stale cache, extended-hours, or symbol mapping mismatch/);
  assert.match(
    context.diagnostics.find((item) => item.code === "trade_window_basis_validation_status")?.message ?? "",
    /basis_mismatch/,
  );
  assert.equal(
    context.diagnostics.some((item) => item.code === "trade_window_price_basis_unverified"),
    false,
  );
});

test("trade analysis context surfaces historical alias and PINK diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "trade-analysis-alias-diagnostics-"));
  const provider = new AliasMetadataHistoricalProvider({ basePrice: 4 });
  const tradeStart = Date.UTC(2026, 1, 3, 15, 0, 0);
  const tradeEnd = tradeStart + 8 * 60_000;

  const context = await buildDefaultTradeAnalysisCandleContext({
    symbol: "MAXN",
    sessionDate: "2026-02-03",
    warehouseDirectoryPath: root,
    asOfTimestamp: tradeEnd + 20 * 60_000,
    executions: [
      { timestamp: tradeStart, price: 4, quantity: 100, side: "buy" },
      { timestamp: tradeEnd, price: 4.05, quantity: 100, side: "sell" },
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
      preTradeMinutes: 10,
      postTradeMinutes: 20,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider,
    },
  });

  const aliasDiagnostic = context.diagnostics.find(
    (item) => item.code === "historical_symbol_alias_used",
  );
  const pinkDiagnostic = context.diagnostics.find(
    (item) => item.code === "historical_symbol_resolved_to_pink",
  );

  assert.ok(aliasDiagnostic);
  assert.equal(aliasDiagnostic.severity, "info");
  assert.match(aliasDiagnostic.message, /MAXNQ/);
  assert.ok(pinkDiagnostic);
  assert.equal(pinkDiagnostic.severity, "warning");
  assert.match(pinkDiagnostic.message, /PINK/);
});

test("trade analysis context counts candles that overlap ultra-short holds", async () => {
  const root = await mkdtemp(join(tmpdir(), "trade-analysis-short-hold-overlap-"));
  const provider = new MinuteAlignedHistoricalProvider();
  const tradeStart = Date.UTC(2026, 3, 8, 14, 10, 30);
  const tradeEnd = Date.UTC(2026, 3, 8, 14, 10, 45);

  const context = await buildDefaultTradeAnalysisCandleContext({
    symbol: "OMEX",
    sessionDate: "2026-04-08",
    warehouseDirectoryPath: root,
    asOfTimestamp: tradeEnd + 20 * 60_000,
    executions: [
      { timestamp: tradeStart, price: 1.5, quantity: 100, side: "buy" },
      { timestamp: tradeEnd, price: 1.52, quantity: 100, side: "sell" },
    ],
    supportResistance: {
      lookbackBars: {
        daily: 80,
        "4h": 80,
        "5m": 80,
      },
    },
    tradeWindow: {
      timeframe: "1m",
      preTradeMinutes: 5,
      postTradeMinutes: 20,
      paddingMinutes: 0,
    },
    fetchServiceOptions: {
      provider,
    },
  });

  assert.equal(context.tradeWindow.tradeCandles.length, 1);
  assert.equal(context.tradeWindow.tradeCandles[0]?.timestamp, Date.UTC(2026, 3, 8, 14, 10, 0));
  assert.equal(
    context.diagnostics.some((diagnostic) => diagnostic.code === "trade_window_missing_trade_candles"),
    false,
  );
  assert.ok(context.tradeWindowFacts.highestHighDuringTrade);
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
