import test from "node:test";
import assert from "node:assert/strict";

import {
  CandleFetchService,
  StubHistoricalCandleProvider,
} from "../lib/market-data/candle-fetch-service.js";

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
