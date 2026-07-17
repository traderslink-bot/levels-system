import test from "node:test";
import assert from "node:assert/strict";

import {
  CandleFetchService,
  StubHistoricalCandleProvider,
} from "../lib/market-data/candle-fetch-service.js";
import type { BaseCandleProviderResponse, CandleProviderName } from "../lib/market-data/candle-types.js";
import { buildCandleSessionSummary } from "../lib/market-data/candle-session-classifier.js";
import type { HistoricalCandleProvider, HistoricalFetchPlan, HistoricalFetchRequest } from "../lib/market-data/provider-types.js";
import { createValidationIbkrClient } from "../scripts/shared/ibkr-runtime.js";

class FixedHistoricalProvider implements HistoricalCandleProvider {
  constructor(
    readonly providerName: CandleProviderName,
    private readonly close: number,
  ) {}

  async fetchCandles(
    request: HistoricalFetchRequest,
    plan: HistoricalFetchPlan,
  ): Promise<BaseCandleProviderResponse> {
    return {
      provider: this.providerName,
      symbol: request.symbol.trim().toUpperCase(),
      timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars,
      candles: [
        {
          timestamp: plan.requestEndTimestamp,
          open: this.close,
          high: this.close,
          low: this.close,
          close: this.close,
          volume: 100,
        },
      ],
      fetchStartTimestamp: plan.requestEndTimestamp,
      fetchEndTimestamp: plan.requestEndTimestamp,
      requestedStartTimestamp: plan.requestStartTimestamp,
      requestedEndTimestamp: plan.requestEndTimestamp,
      sessionMetadataAvailable: plan.sessionMetadataAvailable,
    };
  }
}

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

test("CandleFetchService supports 1m stub candles with session metadata", async () => {
  const service = new CandleFetchService(new StubHistoricalCandleProvider());

  const response = await service.fetchCandles({
    symbol: "AAPL",
    timeframe: "1m",
    lookbackBars: 30,
    endTimeMs: Date.parse("2026-04-15T14:00:00-04:00"),
  });

  assert.equal(response.symbol, "AAPL");
  assert.equal(response.timeframe, "1m");
  assert.equal(response.candles.length, 30);
  assert.equal(response.provider, "stub");
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

test("CandleFetchService can swap historical providers at runtime", async () => {
  const service = new CandleFetchService(new FixedHistoricalProvider("ibkr", 10));
  assert.equal(service.getProviderName(), "ibkr");

  service.setProvider(new FixedHistoricalProvider("eodhd", 20));

  const response = await service.fetchCandles({
    symbol: "AAPL",
    timeframe: "daily",
    lookbackBars: 1,
    endTimeMs: Date.parse("2026-05-01T00:00:00.000Z"),
  });

  assert.equal(service.getProviderName(), "eodhd");
  assert.equal(response.provider, "eodhd");
  assert.equal(response.candles[0]?.close, 20);
});

test("CandleFetchService passes IBKR historical timeout through provider options", () => {
  const ib = createValidationIbkrClient();
  const service = new CandleFetchService({
    providerName: "ibkr",
    ib,
    ibkrTimeoutMs: 60_000,
  });

  assert.equal((service as any).provider.timeoutMs, 60_000);
  ib.disconnect();
});

test("buildCandleSessionSummary classifies intraday candles into market sessions", () => {
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
    "1m",
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
