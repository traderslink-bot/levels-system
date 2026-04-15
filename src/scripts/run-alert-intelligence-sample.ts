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
      episodeId: `${symbol}-sample-breakout-episode`,
      symbol,
      type: "breakout",
      eventType: "breakout",
      zoneId: levels.majorResistance[0]?.id ?? levels.intradayResistance[0]?.id ?? "unknown-zone",
      zoneKind: "resistance",
      level: levels.majorResistance[0]?.representativePrice ?? 0,
      triggerPrice: levels.majorResistance[0]?.zoneHigh ?? 0,
      strength: 0.9,
      confidence: 0.85,
      priority: 90,
      bias: "bullish",
      pressureScore: 0.82,
      timestamp: Date.now(),
      notes: ["Synthetic breakout sample event."],
    },
    {
      id: `${symbol}-sample-compression`,
      episodeId: `${symbol}-sample-compression-episode`,
      symbol,
      type: "consolidation",
      eventType: "compression",
      zoneId: levels.intradaySupport.at(-1)?.id ?? levels.majorSupport[0]?.id ?? "unknown-zone",
      zoneKind: "support",
      level: levels.intradaySupport.at(-1)?.representativePrice ?? 0,
      triggerPrice: levels.intradaySupport.at(-1)?.representativePrice ?? 0,
      strength: 0.2,
      confidence: 0.15,
      priority: 15,
      bias: "neutral",
      pressureScore: 0.24,
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
