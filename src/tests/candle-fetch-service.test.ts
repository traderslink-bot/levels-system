import test from "node:test";
import assert from "node:assert/strict";

import {
  CandleFetchService,
  StubHistoricalCandleProvider,
} from "../lib/market-data/candle-fetch-service.js";
import { buildCandleSessionSummary } from "../lib/market-data/candle-session-classifier.js";
import { validateCandleResponse } from "../lib/market-data/candle-validation.js";

test("CandleFetchService returns the requested number of stub candles", async () => {
  const service = new CandleFetchService(new StubHistoricalCandleProvider());

  const response = await service.fetchCandles({
    symbol: "AAPL",
    timeframe: "5m",
    lookbackBars: 12,
  });

  assert.equal(response.symbol, "AAPL");
  assert.equal(response.timeframe, "5m");
  assert.equal(response.candles.length, 12);
  assert.equal(response.provider, "stub");
  assert.equal(response.actualBarsReturned, 12);
  assert.equal(response.completenessStatus, "complete");
  assert.equal(response.stale, false);
  assert.deepEqual(response.validationIssues, []);
  assert.ok(response.sessionSummary);
});

test("CandleFetchService rejects non-positive lookbackBars", async () => {
  const service = new CandleFetchService(new StubHistoricalCandleProvider());

  await assert.rejects(
    () =>
      service.fetchCandles({
        symbol: "AAPL",
        timeframe: "5m",
        lookbackBars: 0,
      }),
    /lookbackBars must be greater than zero\./,
  );
});

test("CandleFetchService passes explicit IBKR timeout through provider options", () => {
  const service = new CandleFetchService({
    providerName: "ibkr",
    ib: {} as never,
    ibkrTimeoutMs: 120_000,
  });

  assert.equal((service as any).provider.timeoutMs, 120_000);
});

test("buildCandleSessionSummary classifies 5m candles into market sessions", () => {
  const summary = buildCandleSessionSummary(
    [
      {
        timestamp: Date.parse("2026-04-15T08:15:00-04:00"),
        open: 1,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 100,
      },
      {
        timestamp: Date.parse("2026-04-15T09:35:00-04:00"),
        open: 1.05,
        high: 1.2,
        low: 1,
        close: 1.15,
        volume: 150,
      },
      {
        timestamp: Date.parse("2026-04-15T10:15:00-04:00"),
        open: 1.15,
        high: 1.25,
        low: 1.1,
        close: 1.22,
        volume: 180,
      },
      {
        timestamp: Date.parse("2026-04-15T16:30:00-04:00"),
        open: 1.22,
        high: 1.3,
        low: 1.2,
        close: 1.28,
        volume: 200,
      },
    ],
    "5m",
  );

  assert.deepEqual(summary, {
    premarketBars: 1,
    openingRangeBars: 1,
    regularBars: 1,
    afterHoursBars: 1,
    extendedBars: 0,
    unknownBars: 0,
    latestRegularSessionDate: "2026-04-15",
  });
});

test("five-minute validation flags sparse traded bars and a thin outlier print", () => {
  const base = Date.parse("2026-07-01T13:30:00.000Z");
  const tradedIndexes = new Set([0, 6, 12, 19]);
  const candles = Array.from({ length: 20 }, (_, index) => {
    const isLatest = index === 19;
    const close = isLatest ? 12 : 10;
    return {
      timestamp: base + index * 5 * 60_000,
      open: close,
      high: close,
      low: close,
      close,
      volume: tradedIndexes.has(index) ? 100 : 0,
    };
  });

  const result = validateCandleResponse({
    provider: "stub",
    symbol: "THIN",
    timeframe: "5m",
    requestedLookbackBars: 20,
    candles,
    fetchStartTimestamp: base,
    fetchEndTimestamp: base + 19 * 5 * 60_000,
    requestedStartTimestamp: base,
    requestedEndTimestamp: base + 19 * 5 * 60_000,
    sessionMetadataAvailable: true,
  });
  const codes = result.validationIssues.map((issue) => issue.code);

  assert.ok(codes.includes("sparse_traded_bars"));
  assert.ok(codes.includes("thin_last_print"));
});
