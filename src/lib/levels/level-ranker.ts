// 2026-04-14 08:05 PM America/Toronto
// Rank zones and split into output buckets.

import type { LevelEngineConfig } from "./level-config.js";
import type { FinalLevelZone, LevelEngineOutput } from "./level-types.js";

function sortZones(zones: FinalLevelZone[]): FinalLevelZone[] {
  return [...zones].sort((a, b) => b.strengthScore - a.strengthScore || b.touchCount - a.touchCount);
}

function byTimeframePreference(zones: FinalLevelZone[], bucket: "daily" | "4h" | "5m"): FinalLevelZone[] {
  return zones.filter((zone) => zone.timeframeSources.includes(bucket));
}

export function rankLevelZones(params: {
  symbol: string;
  supportZones: FinalLevelZone[];
  resistanceZones: FinalLevelZone[];
  specialLevels: LevelEngineOutput["specialLevels"];
  config: LevelEngineConfig;
}): LevelEngineOutput {
  const { symbol, supportZones, resistanceZones, specialLevels, config } = params;

  const dailySupport = sortZones(byTimeframePreference(supportZones, "daily")).slice(
    0,
    config.timeframeConfig.daily.maxOutputPerSide,
  );
  const dailyResistance = sortZones(byTimeframePreference(resistanceZones, "daily")).slice(
    0,
    config.timeframeConfig.daily.maxOutputPerSide,
  );

  const intermediateSupport = sortZones(byTimeframePreference(supportZones, "4h")).slice(
    0,
    config.timeframeConfig["4h"].maxOutputPerSide,
  );
  const intermediateResistance = sortZones(byTimeframePreference(resistanceZones, "4h")).slice(
    0,
    config.timeframeConfig["4h"].maxOutputPerSide,
  );

  const intradaySupport = sortZones(byTimeframePreference(supportZones, "5m")).slice(
    0,
    config.timeframeConfig["5m"].maxOutputPerSide,
  );
  const intradayResistance = sortZones(byTimeframePreference(resistanceZones, "5m")).slice(
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
