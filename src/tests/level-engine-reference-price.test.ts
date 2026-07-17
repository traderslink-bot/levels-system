import assert from "node:assert/strict";
import test from "node:test";

import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import type { BaseCandleProviderResponse, CandleProviderName } from "../lib/market-data/candle-types.js";
import type { HistoricalCandleProvider, HistoricalFetchPlan, HistoricalFetchRequest } from "../lib/market-data/provider-types.js";
import { LevelEngine } from "../lib/levels/level-engine.js";

class FixedSeriesProvider implements HistoricalCandleProvider {
  readonly providerName: CandleProviderName = "stub";

  async fetchCandles(
    request: HistoricalFetchRequest,
    plan: HistoricalFetchPlan,
  ): Promise<BaseCandleProviderResponse> {
    return {
      provider: this.providerName,
      symbol: request.symbol.toUpperCase(),
      timeframe: request.timeframe,
      requestedLookbackBars: request.lookbackBars,
      candles: [
        {
          timestamp: plan.requestEndTimestamp - 2 * plan.intervalMs,
          open: 3,
          high: 3.4,
          low: 2.8,
          close: 3.2,
          volume: 1000,
        },
        {
          timestamp: plan.requestEndTimestamp - plan.intervalMs,
          open: 3.2,
          high: 3.6,
          low: 3,
          close: 3.4,
          volume: 1000,
        },
        {
          timestamp: plan.requestEndTimestamp,
          open: 3.4,
          high: 3.8,
          low: 3.1,
          close: 3.18,
          volume: 1000,
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

test("LevelEngine can rank output around a live reference price override", async () => {
  const service = new CandleFetchService(new FixedSeriesProvider());
  const engine = new LevelEngine(service);
  const endTimeMs = Date.parse("2026-07-09T20:00:00.000Z");

  const output = await engine.generateLevels({
    symbol: "VRAX",
    historicalRequests: {
      daily: { symbol: "VRAX", timeframe: "daily", lookbackBars: 3, endTimeMs },
      "4h": { symbol: "VRAX", timeframe: "4h", lookbackBars: 3, endTimeMs },
      "5m": { symbol: "VRAX", timeframe: "5m", lookbackBars: 3, endTimeMs },
    },
    referencePriceOverride: 9.12,
  });

  assert.equal(output.metadata.referencePrice, 9.12);
});
