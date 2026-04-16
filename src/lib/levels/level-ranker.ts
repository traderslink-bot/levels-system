// 2026-04-14 08:05 PM America/Toronto
// Rank zones and split into output buckets.

import type { CandleTimeframe } from "../market-data/candle-types.js";
import type { LevelEngineConfig } from "./level-config.js";
import type { FinalLevelZone, LevelEngineOutput } from "./level-types.js";

function sortZones(zones: FinalLevelZone[]): FinalLevelZone[] {
  return [...zones].sort((a, b) => b.strengthScore - a.strengthScore || b.touchCount - a.touchCount);
}

function preferredBucketForZone(zone: FinalLevelZone): CandleTimeframe {
  const timeframeOrder: CandleTimeframe[] = ["daily", "4h", "5m"];

  if (zone.timeframeBias !== "mixed" && zone.timeframeSources.includes(zone.timeframeBias)) {
    return zone.timeframeBias;
  }

  for (const timeframe of timeframeOrder) {
    if (zone.timeframeSources.includes(timeframe)) {
      return timeframe;
    }
  }

  return "5m";
}

function byOwnedBucket(
  zones: FinalLevelZone[],
  bucket: CandleTimeframe,
): FinalLevelZone[] {
  return zones.filter((zone) => preferredBucketForZone(zone) === bucket);
}

export function rankLevelZones(params: {
  symbol: string;
  supportZones: FinalLevelZone[];
  resistanceZones: FinalLevelZone[];
  specialLevels: LevelEngineOutput["specialLevels"];
  config: LevelEngineConfig;
}): LevelEngineOutput {
  const { symbol, supportZones, resistanceZones, specialLevels, config } = params;

  const dailySupport = sortZones(byOwnedBucket(supportZones, "daily")).slice(
    0,
    config.timeframeConfig.daily.maxOutputPerSide,
  );
  const dailyResistance = sortZones(byOwnedBucket(resistanceZones, "daily")).slice(
    0,
    config.timeframeConfig.daily.maxOutputPerSide,
  );

  const intermediateSupport = sortZones(byOwnedBucket(supportZones, "4h")).slice(
    0,
    config.timeframeConfig["4h"].maxOutputPerSide,
  );
  const intermediateResistance = sortZones(byOwnedBucket(resistanceZones, "4h")).slice(
    0,
    config.timeframeConfig["4h"].maxOutputPerSide,
  );

  const intradaySupport = sortZones(byOwnedBucket(supportZones, "5m")).slice(
    0,
    config.timeframeConfig["5m"].maxOutputPerSide,
  );
  const intradayResistance = sortZones(byOwnedBucket(resistanceZones, "5m")).slice(
    0,
    config.timeframeConfig["5m"].maxOutputPerSide,
  );

  return {
    symbol,
    generatedAt: Date.now(),
    majorSupport: dailySupport,
    majorResistance: dailyResistance,
    intermediateSupport,
    intermediateResistance,
    intradaySupport,
    intradayResistance,
    specialLevels,
  };
}
