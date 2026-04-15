// 2026-04-14 10:18 PM America/Toronto
// Sample runner for the Phase 3 alert intelligence layer.

import { CandleFetchService, StubHistoricalCandleProvider } from "../lib/market-data/candle-fetch-service.js";
import { AlertIntelligenceEngine } from "../lib/alerts/alert-intelligence-engine.js";
import { LevelEngine } from "../lib/levels/level-engine.js";
import type { MonitoringEvent } from "../lib/monitoring/monitoring-types.js";

async function buildLevels(symbol: string) {
  const provider = new StubHistoricalCandleProvider();
  const fetchService = new CandleFetchService(provider);
  const engine = new LevelEngine(fetchService);

  return engine.generateLevels({
    symbol,
    historicalRequests: {
      daily: { symbol, timeframe: "daily", lookbackBars: 220 },
      "4h": { symbol, timeframe: "4h", lookbackBars: 180 },
      "5m": { symbol, timeframe: "5m", lookbackBars: 240 },
    },
  });
}

async function main(): Promise<void> {
  const symbol = process.argv[2]?.toUpperCase() ?? "OMEX";
  const levels = await buildLevels(symbol);
  const intelligence = new AlertIntelligenceEngine();

  const sampleEvents: MonitoringEvent[] = [
    {
      id: `${symbol}-sample-breakout`,
      symbol,
      eventType: "breakout",
      zoneId: levels.majorResistance[0]?.id ?? levels.intradayResistance[0]?.id ?? "unknown-zone",
      zoneKind: "resistance",
      triggerPrice: levels.majorResistance[0]?.zoneHigh ?? 0,
      timestamp: Date.now(),
      notes: ["Synthetic breakout sample event."],
    },
    {
      id: `${symbol}-sample-compression`,
      symbol,
      eventType: "compression",
      zoneId: levels.intradaySupport.at(-1)?.id ?? levels.majorSupport[0]?.id ?? "unknown-zone",
      zoneKind: "support",
      triggerPrice: levels.intradaySupport.at(-1)?.representativePrice ?? 0,
      timestamp: Date.now() + 1,
      notes: ["Synthetic compression sample event."],
    },
  ];

  for (const event of sampleEvents) {
    const result = intelligence.processEvent(event, levels);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
