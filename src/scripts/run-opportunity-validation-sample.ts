import { writeFileSync } from "node:fs";

import type { Candle } from "../lib/market-data/candle-types.js";
import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import type { LevelEngineOutput } from "../lib/levels/level-types.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import type { LivePriceListener, LivePriceProvider } from "../lib/monitoring/live-price-types.js";
import type { MonitoringEvent, WatchlistEntry } from "../lib/monitoring/monitoring-types.js";
import {
  buildOpportunityDiagnosticsLogEntry,
  summarizeOpportunityDiagnostics,
  type OpportunityDiagnosticsLogEntry,
} from "../lib/monitoring/opportunity-diagnostics.js";
import { OpportunityRuntimeController } from "../lib/monitoring/opportunity-runtime-controller.js";
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

function maybeWriteDiagnosticsFile(
  path: string | undefined,
  entries: OpportunityDiagnosticsLogEntry[],
): void {
  if (!path || entries.length === 0) {
    return;
  }

  const ndjson = entries.map((entry) => JSON.stringify(entry)).join("\n");
  writeFileSync(path, `${ndjson}\n`, "utf8");
}

async function main(): Promise<void> {
  const symbol = process.argv[2]?.toUpperCase() ?? "AAPL";
  const diagnosticsFile = process.argv[3] ?? process.env.OPPORTUNITY_DIAGNOSTICS_FILE;
  const lookbackBars = Number.parseInt(process.argv[4] ?? "", 10);
  const resolvedLookbackBars = Number.isFinite(lookbackBars) && lookbackBars > 0
    ? lookbackBars
    : 100;
  const capturedEvents: MonitoringEvent[] = [];
  const diagnosticEntries: OpportunityDiagnosticsLogEntry[] = [];
  const controller = new OpportunityRuntimeController();
  const ib = createIbkrClient();

  try {
    await waitForIbkrConnection(ib);

    const provider = new IbkrHistoricalCandleProvider(ib);
    const candleService = new CandleFetchService(provider);
    const candleResponse = await candleService.fetchCandles({
      symbol,
      timeframe: "5m",
      lookbackBars: resolvedLookbackBars,
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
          tags: ["opportunity-validation"],
        },
      ],
      (event) => {
        capturedEvents.push(event);
        const snapshot = controller.processMonitoringEvent(event);
        if (snapshot.newOpportunity) {
          diagnosticEntries.push(
            buildOpportunityDiagnosticsLogEntry("opportunity_snapshot", snapshot, {
              symbol: event.symbol,
              timestamp: event.timestamp,
            }),
          );
        }
      },
      (update) => {
        const snapshot = controller.processPriceUpdate(update);
        if (!snapshot || snapshot.completedEvaluations.length === 0) {
          return;
        }

        diagnosticEntries.push(
          buildOpportunityDiagnosticsLogEntry("evaluation_update", snapshot, {
            symbol: update.symbol,
            timestamp: update.timestamp,
          }),
        );
      },
    );

    await monitor.stop();
    maybeWriteDiagnosticsFile(diagnosticsFile, diagnosticEntries);

    console.log(JSON.stringify({
      symbol,
      diagnosticsFile: diagnosticsFile ?? null,
      lookbackBars: resolvedLookbackBars,
      fetchedCandles: candleResponse.candles.length,
      emittedEvents: capturedEvents.length,
      diagnosticSummary: summarizeOpportunityDiagnostics(diagnosticEntries),
      diagnosticPreview: diagnosticEntries.slice(0, 5),
    }, null, 2));
  } finally {
    ib.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
