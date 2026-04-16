import { writeFileSync } from "node:fs";

import { CandleFetchService } from "../lib/market-data/candle-fetch-service.js";
import { IbkrHistoricalCandleProvider } from "../lib/market-data/ibkr-historical-candle-provider.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import { formatMonitoringEventAsAlert } from "../lib/alerts/alert-router.js";
import { IBKRLivePriceProvider } from "../lib/monitoring/ibkr-live-price-provider.js";
import { LevelStore } from "../lib/monitoring/level-store.js";
import {
  analyzeOpportunityDiagnosticsRecovery,
  buildOpportunityDiagnosticsLogEntry,
  summarizeOpportunityDiagnostics,
  type OpportunityDiagnosticsLogEntry,
} from "../lib/monitoring/opportunity-diagnostics.js";
import { OpportunityRuntimeController } from "../lib/monitoring/opportunity-runtime-controller.js";
import { WatchlistMonitor } from "../lib/monitoring/watchlist-monitor.js";
import type { WatchlistEntry } from "../lib/monitoring/monitoring-types.js";
import { waitForIbkrConnection } from "./shared/ibkr-connection.js";
import { createIbkrClient } from "./shared/ibkr-runtime.js";

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

function maybeWriteDiagnosticsFile(
  filePath: string | undefined,
  entries: OpportunityDiagnosticsLogEntry[],
): void {
  if (!filePath || entries.length === 0) {
    return;
  }

  const ndjson = entries.map((entry) => JSON.stringify(entry)).join("\n");
  writeFileSync(filePath, `${ndjson}\n`, "utf8");
}

async function main(): Promise<void> {
  const symbolArgs = process.argv[2]?.trim() ?? "";
  const durationSeconds = Number.parseInt(process.argv[3] ?? "", 10);
  const diagnosticsFile = process.argv[4] ?? process.env.OPPORTUNITY_DIAGNOSTICS_FILE;
  const resolvedDurationSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : 45;
  const symbols = symbolArgs.length > 0
    ? symbolArgs.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)
    : ["BIRD", "HUBC", "IMMP", "ALBT"];
  const watchlist: WatchlistEntry[] = symbols.map((symbol, index) => ({
    symbol,
    active: true,
    priority: index + 1,
    tags: ["live-validation"],
  }));
  const alerts: string[] = [];
  const diagnosticEntries: OpportunityDiagnosticsLogEntry[] = [];
  const ib = createIbkrClient();
  const historicalProvider = new IbkrHistoricalCandleProvider(ib);
  const liveProvider = new IBKRLivePriceProvider(ib);
  const candleService = new CandleFetchService(historicalProvider);
  const levelStore = new LevelStore();
  const monitor = new WatchlistMonitor(levelStore, liveProvider);
  const decisionController = new OpportunityRuntimeController();

  try {
    await waitForIbkrConnection(ib);
    await seedLevels(watchlist, candleService, levelStore);

    await monitor.start(
      watchlist,
      (event) => {
        alerts.push(JSON.stringify(formatMonitoringEventAsAlert(event)));

        const snapshot = decisionController.processMonitoringEvent(event);
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
        const snapshot = decisionController.processPriceUpdate(update);
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

    await new Promise((resolve) => setTimeout(resolve, resolvedDurationSeconds * 1000));
    await monitor.stop();
    maybeWriteDiagnosticsFile(diagnosticsFile, diagnosticEntries);

    console.log(JSON.stringify({
      symbols,
      durationSeconds: resolvedDurationSeconds,
      diagnosticsFile: diagnosticsFile ?? null,
      alertCount: alerts.length,
      diagnosticSummary: summarizeOpportunityDiagnostics(diagnosticEntries),
      recoverySummary: analyzeOpportunityDiagnosticsRecovery(diagnosticEntries),
      alertPreview: alerts.slice(0, 5).map((alert) => JSON.parse(alert)),
      diagnosticPreview: diagnosticEntries.slice(0, 5),
    }, null, 2));
  } finally {
    try {
      await monitor.stop();
    } catch {
      // ignore shutdown races
    }
    ib.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
