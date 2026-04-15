import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import { formatMonitoringEventAsAlert } from "../lib/alerts/alert-router.js";
import { IBKRLivePriceProvider } from "../lib/monitoring/ibkr-live-price-provider.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import { WatchlistMonitor } from "../lib/monitoring/watchlist-monitor.js";
import type { WatchlistEntry } from "../lib/monitoring/monitoring-types.js";
import { waitForIbkrConnection } from "../scripts/shared/ibkr-connection.js";
import { createIbkrClient } from "../scripts/shared/ibkr-runtime.js";

async function seedLevels(
  entries: WatchlistEntry[],
  fetchService: CandleFetchService,
  levelStore: LevelStore,
): Promise<void> {
  const engine = new LevelEngine(fetchService);

  for (const entry of entries) {
    if (!entry.active) {
      continue;
    }

    const symbol = entry.symbol.toUpperCase();
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
  const watchlist: WatchlistEntry[] =
    symbols.length > 0
      ? symbols.map((symbol, index) => ({
          symbol: symbol.toUpperCase(),
          active: true,
          priority: index + 1,
          tags: ["runtime"],
        }))
      : [
          {
            symbol: "AAPL",
            active: true,
            priority: 1,
            tags: ["runtime"],
          },
        ];

  const ib = createIbkrClient();
  const historicalProvider = new IbkrHistoricalCandleProvider(ib);
  const liveProvider = new IBKRLivePriceProvider(ib);
  const candleService = new CandleFetchService(historicalProvider);
  const levelStore = new LevelStore();
  const monitor = new WatchlistMonitor(levelStore, liveProvider);

  let shuttingDown = false;

  const shutdown = async (signal?: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    if (signal) {
      console.log(`Received ${signal}. Shutting down gracefully...`);
    }

    try {
      await monitor.stop();
    } finally {
      ib.disconnect();
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT").finally(() => {
      process.exit(0);
    });
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => {
      process.exit(0);
    });
  });

  try {
    await waitForIbkrConnection(ib);
    await seedLevels(watchlist, candleService, levelStore);

    await monitor.start(watchlist, (event) => {
      const alert = formatMonitoringEventAsAlert(event);
      console.log(JSON.stringify(alert, null, 2));
    });

    console.log(
      `Watchlist monitor started for ${watchlist
        .filter((entry) => entry.active)
        .map((entry) => entry.symbol)
        .join(", ")}.`,
    );
  } catch (error) {
    await shutdown();
    throw error;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
