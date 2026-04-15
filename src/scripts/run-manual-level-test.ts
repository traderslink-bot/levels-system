// 2026-04-15 08:05 AM America/Toronto
// Manual runner for IBKR historical candle fetching.

import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import { createIbkrClient } from "./shared/ibkr-runtime.js";

async function main(): Promise<void> {
  const symbol = process.argv[2]?.toUpperCase() ?? "AAPL";
  const ib = createIbkrClient();

  try {
    await waitForIbkrConnection(ib);

    const provider = new IbkrHistoricalCandleProvider(ib);
    const candleService = new CandleFetchService(provider);

    const response = await candleService.fetchCandles({
      symbol,
      timeframe: "5m",
      lookbackBars: 100,
    });

    console.log("Fetched candles:", response.candles.length);
  } finally {
    ib.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
