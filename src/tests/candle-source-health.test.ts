import assert from "node:assert/strict";
import test from "node:test";

import { CandleFetchService, type HistoricalFetchRequest } from "../lib/market-data/candle-fetch-service.js";
import type { BaseCandleProviderResponse } from "../lib/market-data/candle-types.js";
import {
  checkCandleSourceHealth,
  formatCandleSourceHealthReport,
} from "../lib/validation/candle-source-health.js";

class FakeProvider {
  readonly providerName = "stub" as const;

  constructor(
    private readonly handler: (
      request: HistoricalFetchRequest,
    ) => Promise<BaseCandleProviderResponse>,
  ) {}

  async fetchCandles(request: HistoricalFetchRequest): Promise<BaseCandleProviderResponse> {
    return this.handler(request);
  }
}

function buildBaseResponse(overrides: Partial<BaseCandleProviderResponse> = {}): BaseCandleProviderResponse {
  return {
    provider: "stub",
    symbol: "ALBT",
    timeframe: "5m",
    requestedLookbackBars: 2,
    candles: [
      {
        timestamp: Date.now() - 5 * 60 * 1000,
        open: 1,
        high: 1.05,
        low: 0.99,
        close: 1.03,
        volume: 1000,
      },
      {
        timestamp: Date.now(),
        open: 1.03,
        high: 1.08,
        low: 1.01,
        close: 1.07,
        volume: 1100,
      },
    ],
    fetchStartTimestamp: 1,
    fetchEndTimestamp: 2,
    requestedStartTimestamp: 0,
    requestedEndTimestamp: Date.now(),
    sessionMetadataAvailable: true,
    ...overrides,
  };
}

test("checkCandleSourceHealth reports healthy when candles are usable", async () => {
  const service = new CandleFetchService(
    new FakeProvider(async () => buildBaseResponse()) as any,
  );

  const report = await checkCandleSourceHealth(service, {
    symbol: "ALBT",
    timeframe: "5m",
    lookbackBars: 2,
  });

  assert.equal(report.status, "healthy");
  assert.equal(report.reason, "provider returned usable candles");
  assert.ok(report.response);
});

test("checkCandleSourceHealth reports degraded when provider returns empty candles", async () => {
  const service = new CandleFetchService(
    new FakeProvider(async () => buildBaseResponse({ candles: [] })) as any,
  );

  const report = await checkCandleSourceHealth(service, {
    symbol: "ALBT",
    timeframe: "5m",
    lookbackBars: 2,
  });

  assert.equal(report.status, "unavailable");
  assert.equal(report.reason, "provider returned no candles");
});

test("checkCandleSourceHealth reports unavailable when provider throws", async () => {
  const service = new CandleFetchService(
    new FakeProvider(async () => {
      throw new Error("Timed out waiting for provider");
    }) as any,
  );

  const report = await checkCandleSourceHealth(service, {
    symbol: "ALBT",
    timeframe: "5m",
    lookbackBars: 2,
  });

  assert.equal(report.status, "unavailable");
  assert.equal(report.reason, "provider request failed");
  assert.match(report.errorMessage ?? "", /Timed out waiting for provider/);
  assert.match(formatCandleSourceHealthReport(report), /status=unavailable/);
});
