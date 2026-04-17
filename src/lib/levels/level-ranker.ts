// 2026-04-16 02:41 PM America/Toronto
// Rank zones, enforce spacing-aware surfaced outputs, and preserve a cleaner ladder for extensions.

import type { CandleTimeframe } from "../market-data/candle-types.js";
import type { LevelEngineConfig } from "./level-config.js";
import { buildLevelExtensions } from "./level-extension-engine.js";
import type { FinalLevelZone, LevelEngineOutput } from "./level-types.js";

type SurfaceBucket = "daily" | "4h" | "5m";

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

function timeframeBiasRank(zone: FinalLevelZone): number {
  if (zone.timeframeBias === "mixed") {
    return 4;
  }

  if (zone.timeframeBias === "daily") {
    return 3;
  }

  if (zone.timeframeBias === "4h") {
    return 2;
  }

  return 1;
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

function sortZones(zones: FinalLevelZone[]): FinalLevelZone[] {
  return [...zones].sort(
    (a, b) =>
      b.strengthScore - a.strengthScore ||
      b.followThroughScore - a.followThroughScore ||
      freshnessRank(b) - freshnessRank(a) ||
      preferredBucketRank(preferredBucketForZone(b)) - preferredBucketRank(preferredBucketForZone(a)) ||
      b.touchCount - a.touchCount ||
      b.confluenceCount - a.confluenceCount,
  );
}

function byOwnedBucket(zones: FinalLevelZone[], bucket: SurfaceBucket): FinalLevelZone[] {
  return zones.filter((zone) => preferredBucketForZone(zone) === bucket);
}

function proximityPct(left: FinalLevelZone, right: FinalLevelZone): number {
  return (
    Math.abs(left.representativePrice - right.representativePrice) /
    Math.max(Math.max(left.representativePrice, right.representativePrice), 0.0001)
  );
}

function materiallyDominatesInBand(
  incumbent: FinalLevelZone,
  challenger: FinalLevelZone,
): boolean {
  const strengthLead = incumbent.strengthScore - challenger.strengthScore;
  const strongerTimeframe = timeframeBiasRank(incumbent) > timeframeBiasRank(challenger);
  const strongerConfluence = incumbent.confluenceCount > challenger.confluenceCount;
  const strongerRejection = incumbent.rejectionScore >= challenger.rejectionScore + 0.08;
  const strongerFollowThrough =
    incumbent.followThroughScore >= challenger.followThroughScore + 0.08;

  if (strengthLead >= 6) {
    return true;
  }

  if (strengthLead >= 3 && (strongerTimeframe || strongerConfluence)) {
    return true;
  }

  if (strengthLead >= 3 && (strongerRejection || strongerFollowThrough)) {
    return true;
  }

  if (strengthLead >= 1.25 && strongerConfluence && strongerRejection && strongerFollowThrough) {
    return true;
  }

  return false;
}

function selectSpacedZones(params: {
  zones: FinalLevelZone[];
  bucket: SurfaceBucket;
  maxCount: number;
  config: LevelEngineConfig;
}): FinalLevelZone[] {
  const selected: FinalLevelZone[] = [];
  const spacingPct = params.config.surfacedSpacingPct[params.bucket];
  const localBandPct = Math.max(
    params.config.maxMergedZoneWidthPct,
    Math.min(spacingPct * 8, 0.06),
  );

  for (const zone of sortZones(params.zones)) {
    const tooCloseToSelected = selected.some((existing) => {
      const distancePct = proximityPct(existing, zone);
      const tightClose = distancePct <= spacingPct;
      const localBandClose = distancePct <= localBandPct;
      const strongerExisting =
        existing.strengthScore >= zone.strengthScore &&
        existing.confluenceCount >= zone.confluenceCount;
      const dominantBandIncumbent = materiallyDominatesInBand(existing, zone);

      return (tightClose && strongerExisting) || (localBandClose && dominantBandIncumbent);
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
    zones: byOwnedBucket(supportZones, "daily"),
    bucket: "daily",
    maxCount: config.timeframeConfig.daily.maxOutputPerSide,
    config,
  });
  const dailyResistance = selectSpacedZones({
    zones: byOwnedBucket(resistanceZones, "daily"),
    bucket: "daily",
    maxCount: config.timeframeConfig.daily.maxOutputPerSide,
    config,
  });

  const intermediateSupport = selectSpacedZones({
    zones: byOwnedBucket(supportZones, "4h"),
    bucket: "4h",
    maxCount: config.timeframeConfig["4h"].maxOutputPerSide,
    config,
  });
  const intermediateResistance = selectSpacedZones({
    zones: byOwnedBucket(resistanceZones, "4h"),
    bucket: "4h",
    maxCount: config.timeframeConfig["4h"].maxOutputPerSide,
    config,
  });

  const intradaySupport = selectSpacedZones({
    zones: byOwnedBucket(supportZones, "5m"),
    bucket: "5m",
    maxCount: config.timeframeConfig["5m"].maxOutputPerSide,
    config,
  });
  const intradayResistance = selectSpacedZones({
    zones: byOwnedBucket(resistanceZones, "5m"),
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
