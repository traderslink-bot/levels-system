// 2026-04-15 08:35 AM America/Toronto
// Sample watchlist monitor runner using IBKR historical candles to build levels and replay price updates.

import { formatMonitoringEventAsAlert } from "../lib/alerts/alert-router.js";
import type { Candle } from "../lib/market-data/candle-types.js";
import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import type { LevelEngineOutput } from "../lib/levels/level-types.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import type { LivePriceListener, LivePriceProvider } from "../lib/monitoring/live-price-types.js";
import type { MonitoringEvent, WatchlistEntry } from "../lib/monitoring/monitoring-types.js";
import { WatchlistMonitor } from "../lib/monitoring/watchlist-monitor.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import { createIbkrClient } from "./shared/ibkr-runtime.js";

class HistoricalReplayLivePriceProvider implements LivePriceProvider {
  constructor(
    private readonly candlesBySymbol: ReadonlyMap<string, readonly Candle[]>,
  ) {}

  async start(entries: WatchlistEntry[], onUpdate: LivePriceListener): Promise<void> {
    for (const entry of entries) {
      if (!entry.active) {
        continue;
      }

      const symbol = entry.symbol.toUpperCase();
      const candles = this.candlesBySymbol.get(symbol) ?? [];

      for (const candle of candles) {
        onUpdate({
          symbol,
          timestamp: candle.timestamp,
          lastPrice: candle.close,
          volume: candle.volume,
        });
      }
    }
  }

  async stop(): Promise<void> {}
}

async function buildLevels(
  symbol: string,
  fetchService: CandleFetchService,
): Promise<LevelEngineOutput> {
  const engine = new LevelEngine(fetchService);

  return engine.generateLevels({
    symbol,
    historicalRequests: {
      daily: { symbol, timeframe: "daily", lookbackBars: 220 },
      "4h": { symbol, timeframe: "4h", lookbackBars: 180 },
      "5m": { symbol, timeframe: "5m", lookbackBars: 100 },
    },
  });
}

async function main(): Promise<void> {
  const symbol = process.argv[2]?.toUpperCase() ?? "AAPL";
  const capturedEvents: MonitoringEvent[] = [];
  const ib = createIbkrClient();

  try {
    await waitForIbkrConnection(ib);

    const provider = new IbkrHistoricalCandleProvider(ib);
    const candleService = new CandleFetchService(provider);

    const candleResponse = await candleService.fetchCandles({
      symbol,
      timeframe: "5m",
      lookbackBars: 100,
    });

    const levels = await buildLevels(symbol, candleService);
    const levelStore = new LevelStore();
    levelStore.setLevels(levels);

    const replayProvider = new HistoricalReplayLivePriceProvider(
      new Map([[symbol, candleResponse.candles]]),
    );
    const monitor = new WatchlistMonitor(levelStore, replayProvider);

    await monitor.start(
      [
        {
          symbol,
          active: true,
          priority: 1,
          tags: ["historical-replay"],
        },
      ],
      (event) => {
        capturedEvents.push(event);
      },
    );

    await monitor.stop();

    const countsByType = capturedEvents.reduce<Record<string, number>>((counts, event) => {
      counts[event.eventType] = (counts[event.eventType] ?? 0) + 1;
      return counts;
    }, {});
    const previewAlerts = capturedEvents
      .slice(0, 10)
      .map((event) => formatMonitoringEventAsAlert(event));

    console.log(
      JSON.stringify(
        {
          symbol,
          fetchedCandles: candleResponse.candles.length,
          emittedEvents: capturedEvents.length,
          countsByType,
          previewAlerts,
        },
        null,
        2,
      ),
    );
  } finally {
    ib.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
