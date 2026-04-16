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
  const breakoutZone = levels.majorResistance[0] ?? levels.intradayResistance[0];
  const compressionZone = levels.intradaySupport.at(-1) ?? levels.majorSupport[0];

  const sampleEvents: MonitoringEvent[] = [
    {
      id: `${symbol}-sample-breakout`,
      episodeId: `${symbol}-sample-breakout-episode`,
      symbol,
      type: "breakout",
      eventType: "breakout",
      zoneId: breakoutZone?.id ?? "unknown-zone",
      zoneKind: "resistance",
      level: breakoutZone?.representativePrice ?? 0,
      triggerPrice: breakoutZone?.zoneHigh ?? 0,
      strength: 0.9,
      confidence: 0.85,
      priority: 90,
      bias: "bullish",
      pressureScore: 0.82,
      eventContext: {
        monitoredZoneId: breakoutZone?.id ?? "unknown-zone",
        canonicalZoneId: breakoutZone?.id ?? "unknown-zone",
        zoneFreshness: breakoutZone?.freshness ?? "fresh",
        zoneOrigin: breakoutZone?.isExtension ? "promoted_extension" : "canonical",
        remapStatus: "new",
        remappedFromZoneIds: [],
        dataQualityDegraded: false,
        recentlyRefreshed: false,
        recentlyPromotedExtension: breakoutZone?.isExtension ?? false,
        ladderPosition: breakoutZone?.isExtension ? "extension" : "inner",
        zoneStrengthLabel: breakoutZone?.strengthLabel ?? "weak",
        sourceGeneratedAt: levels.generatedAt,
      },
      timestamp: Date.now(),
      notes: ["Synthetic breakout sample event."],
    },
    {
      id: `${symbol}-sample-compression`,
      episodeId: `${symbol}-sample-compression-episode`,
      symbol,
      type: "consolidation",
      eventType: "compression",
      zoneId: compressionZone?.id ?? "unknown-zone",
      zoneKind: "support",
      level: compressionZone?.representativePrice ?? 0,
      triggerPrice: compressionZone?.representativePrice ?? 0,
      strength: 0.2,
      confidence: 0.15,
      priority: 15,
      bias: "neutral",
      pressureScore: 0.24,
      eventContext: {
        monitoredZoneId: compressionZone?.id ?? "unknown-zone",
        canonicalZoneId: compressionZone?.id ?? "unknown-zone",
        zoneFreshness: compressionZone?.freshness ?? "fresh",
        zoneOrigin: compressionZone?.isExtension ? "promoted_extension" : "canonical",
        remapStatus: "new",
        remappedFromZoneIds: [],
        dataQualityDegraded: false,
        recentlyRefreshed: false,
        recentlyPromotedExtension: compressionZone?.isExtension ?? false,
        ladderPosition: compressionZone?.isExtension ? "extension" : "inner",
        zoneStrengthLabel: compressionZone?.strengthLabel ?? "weak",
        sourceGeneratedAt: levels.generatedAt,
      },
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
