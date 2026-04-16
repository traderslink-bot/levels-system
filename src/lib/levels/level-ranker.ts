// 2026-04-16 02:41 PM America/Toronto
// Rank zones, enforce spacing-aware surfaced outputs, and preserve a cleaner ladder for extensions.

import type { LevelEngineConfig } from "./level-config.js";
import { buildLevelExtensions } from "./level-extension-engine.js";
import type { FinalLevelZone, LevelEngineOutput } from "./level-types.js";

type SurfaceBucket = "daily" | "4h" | "5m";

function sortZones(zones: FinalLevelZone[]): FinalLevelZone[] {
  return [...zones].sort(
    (a, b) =>
      b.strengthScore - a.strengthScore ||
      b.followThroughScore - a.followThroughScore ||
      freshnessRank(b) - freshnessRank(a) ||
      preferredBucketRank(bucketForZone(b)) - preferredBucketRank(bucketForZone(a)) ||
      b.touchCount - a.touchCount ||
      b.confluenceCount - a.confluenceCount,
  );
}

function freshnessRank(zone: FinalLevelZone): number {
  if (zone.freshness === "fresh") {
    return 3;
  }

  if (zone.freshness === "aging") {
    return 2;
  }

  return 1;
}

function preferredBucketRank(bucket: SurfaceBucket): number {
  if (bucket === "daily") {
    return 3;
  }

  if (bucket === "4h") {
    return 2;
  }

  return 1;
}

function bucketForZone(zone: FinalLevelZone): SurfaceBucket {
  if (zone.timeframeSources.includes("daily")) {
    return "daily";
  }

  if (zone.timeframeSources.includes("4h")) {
    return "4h";
  }

  return "5m";
}

function bySurfaceBucket(zones: FinalLevelZone[], bucket: SurfaceBucket): FinalLevelZone[] {
  return zones.filter((zone) => bucketForZone(zone) === bucket);
}

function proximityPct(left: FinalLevelZone, right: FinalLevelZone): number {
  return (
    Math.abs(left.representativePrice - right.representativePrice) /
    Math.max(Math.max(left.representativePrice, right.representativePrice), 0.0001)
  );
}

function selectSpacedZones(params: {
  zones: FinalLevelZone[];
  bucket: SurfaceBucket;
  maxCount: number;
  config: LevelEngineConfig;
}): FinalLevelZone[] {
  const selected: FinalLevelZone[] = [];
  const spacingPct = params.config.surfacedSpacingPct[params.bucket];

  for (const zone of sortZones(params.zones)) {
    const tooCloseToSelected = selected.some((existing) => {
      const close = proximityPct(existing, zone) <= spacingPct;
      const strongerExisting =
        existing.strengthScore >= zone.strengthScore &&
        existing.confluenceCount >= zone.confluenceCount;

      return close && strongerExisting;
    });

    if (tooCloseToSelected) {
      continue;
    }

    selected.push(zone);
    if (selected.length >= params.maxCount) {
      break;
    }
  }

  return selected;
}

export function rankLevelZones(params: {
  symbol: string;
  supportZones: FinalLevelZone[];
  resistanceZones: FinalLevelZone[];
  specialLevels: LevelEngineOutput["specialLevels"];
  metadata: LevelEngineOutput["metadata"];
  config: LevelEngineConfig;
}): LevelEngineOutput {
  const { symbol, supportZones, resistanceZones, specialLevels, metadata, config } = params;

  const dailySupport = selectSpacedZones({
    zones: bySurfaceBucket(supportZones, "daily"),
    bucket: "daily",
    maxCount: config.timeframeConfig.daily.maxOutputPerSide,
    config,
  });
  const dailyResistance = selectSpacedZones({
    zones: bySurfaceBucket(resistanceZones, "daily"),
    bucket: "daily",
    maxCount: config.timeframeConfig.daily.maxOutputPerSide,
    config,
  });

  const intermediateSupport = selectSpacedZones({
    zones: bySurfaceBucket(supportZones, "4h"),
    bucket: "4h",
    maxCount: config.timeframeConfig["4h"].maxOutputPerSide,
    config,
  });
  const intermediateResistance = selectSpacedZones({
    zones: bySurfaceBucket(resistanceZones, "4h"),
    bucket: "4h",
    maxCount: config.timeframeConfig["4h"].maxOutputPerSide,
    config,
  });

  const intradaySupport = selectSpacedZones({
    zones: bySurfaceBucket(supportZones, "5m"),
    bucket: "5m",
    maxCount: config.timeframeConfig["5m"].maxOutputPerSide,
    config,
  });
  const intradayResistance = selectSpacedZones({
    zones: bySurfaceBucket(resistanceZones, "5m"),
    bucket: "5m",
    maxCount: config.timeframeConfig["5m"].maxOutputPerSide,
    config,
  });

  const extensionLevels = buildLevelExtensions({
    supportZones,
    resistanceZones,
    surfacedSupport: [...dailySupport, ...intermediateSupport, ...intradaySupport],
    surfacedResistance: [...dailyResistance, ...intermediateResistance, ...intradayResistance],
    spacingPct: config.extensionSpacingPct,
    searchWindowPct: config.extensionSearchWindowPct,
  });

  return {
    symbol,
    generatedAt: Date.now(),
    metadata,
    majorSupport: dailySupport,
    majorResistance: dailyResistance,
    intermediateSupport,
    intermediateResistance,
    intradaySupport,
    intradayResistance,
    extensionLevels,
    specialLevels,
  };
}
