// 2026-04-14 11:24 PM America/Toronto
// Integrated Phase 2 + Phase 3 sample runner.
// This runs the watchlist monitor, sends real monitoring events through the alert intelligence engine,
// suppresses weak alerts, and prints only trader-facing formatted alerts.

import type { IBApi } from "@stoqey/ib";

import { AlertIntelligenceEngine } from "../lib/alerts/alert-intelligence-engine.js";
import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import { IBKRLivePriceProvider } from "../lib/monitoring/ibkr-live-price-provider.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import { WatchlistMonitor } from "../lib/monitoring/watchlist-monitor.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import { createIbkrClient } from "./shared/ibkr-runtime.js";

async function seedLevels(
  symbols: string[],
  levelStore: LevelStore,
  ib: IBApi,
): Promise<void> {
  const provider = new IbkrHistoricalCandleProvider(ib);
  const fetchService = new CandleFetchService(provider);
  const engine = new LevelEngine(fetchService);

  for (const symbol of symbols) {
    const output = await engine.generateLevels({
      symbol,
      historicalRequests: {
        daily: { symbol, timeframe: "daily", lookbackBars: 220 },
        "4h": { symbol, timeframe: "4h", lookbackBars: 180 },
        "5m": { symbol, timeframe: "5m", lookbackBars: 100 },
      },
    });

    levelStore.setLevels(output);
  }
}

async function main(): Promise<void> {
  const symbols = process.argv.slice(2);
  const watchSymbols =
    symbols.length > 0
      ? symbols.map((s: string) => s.toUpperCase())
      : ["AAPL", "MSFT", "NVDA"];

  const levelStore = new LevelStore();
  const ib = createIbkrClient();

  try {
    await waitForIbkrConnection(ib);
    await seedLevels(watchSymbols, levelStore, ib);

    const intelligence = new AlertIntelligenceEngine();
    const monitor = new WatchlistMonitor(
      levelStore,
      new IBKRLivePriceProvider(ib),
    );

    await monitor.start(
      watchSymbols.map((symbol: string, index: number) => ({
        symbol,
        active: true,
        priority: index + 1,
        tags: ["phase3-live-test"],
      })),
      (event) => {
        const levels = levelStore.getLevels(event.symbol);
        const result = intelligence.processEvent(event, levels);

        if (result.formatted) {
          console.log(JSON.stringify(result.formatted, null, 2));
        }
      },
    );

    setTimeout(async () => {
      await monitor.stop();
      ib.disconnect();
      process.exit(0);
    }, 20_000);
  } catch (error) {
    ib.disconnect();
    throw error;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
