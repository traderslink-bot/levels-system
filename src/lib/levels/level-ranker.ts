// 2026-04-16 02:41 PM America/Toronto
// Rank zones, enforce spacing-aware surfaced outputs, and preserve a cleaner ladder for extensions.

import type { CandleTimeframe } from "../market-data/candle-types.js";
import type { LevelEngineConfig } from "./level-config.js";
import { buildLevelExtensions } from "./level-extension-engine.js";
import type { FinalLevelZone, LevelEngineOutput } from "./level-types.js";

type SurfaceBucket = "daily" | "4h" | "5m";
const SURFACED_FORWARD_PLANNING_RANGE_PCT = 0.5;

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

function filterPracticalSurfacedResistanceZones(
  zones: FinalLevelZone[],
  referencePrice: number | undefined,
): FinalLevelZone[] {
  if (!referencePrice || referencePrice <= 0) {
    return zones;
  }

  const maxPracticalPrice = referencePrice * (1 + SURFACED_FORWARD_PLANNING_RANGE_PCT);
  return zones.filter(
    (zone) =>
      zone.representativePrice > referencePrice &&
      zone.representativePrice <= maxPracticalPrice,
  );
}

function filterActionableSurfacedSupportZones(
  zones: FinalLevelZone[],
  referencePrice: number | undefined,
): FinalLevelZone[] {
  if (!referencePrice || referencePrice <= 0) {
    return zones;
  }

  return zones.filter((zone) => zone.representativePrice < referencePrice);
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
  side: "support" | "resistance";
  referencePrice?: number;
}): FinalLevelZone[] {
  if (params.maxCount <= 0) {
    return [];
  }

  const selected: FinalLevelZone[] = [];
  const spacingPct = params.config.surfacedSpacingPct[params.bucket];
  const localBandPct = Math.max(
    params.config.maxMergedZoneWidthPct,
    Math.min(spacingPct * 8, 0.06),
  );
  const nearestToReference =
    params.referencePrice && params.referencePrice > 0
      ? [...params.zones]
          .filter((zone) =>
            params.side === "support"
              ? zone.representativePrice < params.referencePrice!
              : zone.representativePrice > params.referencePrice!,
          )
          .sort((left, right) =>
            params.side === "support"
              ? right.representativePrice - left.representativePrice
              : left.representativePrice - right.representativePrice,
          )
          .slice(0, Math.min(2, params.maxCount))
      : [];
  const closestSeedId = nearestToReference[0]?.id;

  const distanceToReference = (zone: FinalLevelZone): number =>
    params.referencePrice && params.referencePrice > 0
      ? Math.abs(zone.representativePrice - params.referencePrice)
      : Number.POSITIVE_INFINITY;

  const preferredTightRepresentative = (
    incumbent: FinalLevelZone,
    challenger: FinalLevelZone,
  ): FinalLevelZone => {
    if (materiallyDominatesInBand(challenger, incumbent)) {
      return challenger;
    }
    if (materiallyDominatesInBand(incumbent, challenger)) {
      return incumbent;
    }
    if (challenger.strengthScore !== incumbent.strengthScore) {
      return challenger.strengthScore > incumbent.strengthScore ? challenger : incumbent;
    }
    if (challenger.confluenceCount !== incumbent.confluenceCount) {
      return challenger.confluenceCount > incumbent.confluenceCount ? challenger : incumbent;
    }
    return distanceToReference(challenger) < distanceToReference(incumbent)
      ? challenger
      : incumbent;
  };

  const considerZone = (zone: FinalLevelZone): void => {
    if (selected.some((existing) => existing.id === zone.id)) {
      return;
    }

    const tightConflicts = selected.filter(
      (existing) => proximityPct(existing, zone) <= spacingPct,
    );
    if (tightConflicts.length > 0) {
      const winner = tightConflicts.reduce(preferredTightRepresentative, zone);
      if (winner.id !== zone.id) {
        // The challenger can bridge two already-valid spaced levels. If an
        // incumbent wins, retain the complete incumbent set; deleting every
        // conflict here would let one weak bridge collapse two useful levels.
        return;
      }
      for (const conflict of tightConflicts) {
        selected.splice(selected.indexOf(conflict), 1);
      }
      selected.push(zone);
      return;
    }

    const dominantIncumbent = selected.some(
      (existing) =>
        proximityPct(existing, zone) <= localBandPct &&
        materiallyDominatesInBand(existing, zone),
    );
    if (dominantIncumbent) {
      return;
    }

    for (const existing of [...selected]) {
      if (
        existing.id !== closestSeedId &&
        proximityPct(existing, zone) <= localBandPct &&
        materiallyDominatesInBand(zone, existing)
      ) {
        selected.splice(selected.indexOf(existing), 1);
      }
    }

    if (selected.length < params.maxCount) {
      selected.push(zone);
    }
  };

  for (const zone of nearestToReference) {
    considerZone(zone);
  }

  for (const zone of sortZones(params.zones)) {
    considerZone(zone);
  }

  // Preserve the established strongest-first bucket contract after the
  // reference-aware spacing pass chooses which zones survive.
  return sortZones(selected);
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
  const actionableSupportZones = filterActionableSurfacedSupportZones(
    supportZones,
    metadata.referencePrice,
  );
  const surfacedResistanceZones = filterPracticalSurfacedResistanceZones(
    resistanceZones,
    metadata.referencePrice,
  );

  const dailySupport = selectSpacedZones({
    zones: byOwnedBucket(actionableSupportZones, "daily"),
    bucket: "daily",
    maxCount: config.timeframeConfig.daily.maxOutputPerSide,
    config,
    side: "support",
    referencePrice: metadata.referencePrice,
  });
  const dailyResistance = selectSpacedZones({
    zones: byOwnedBucket(surfacedResistanceZones, "daily"),
    bucket: "daily",
    maxCount: config.timeframeConfig.daily.maxOutputPerSide,
    config,
    side: "resistance",
    referencePrice: metadata.referencePrice,
  });

  const intermediateSupport = selectSpacedZones({
    zones: byOwnedBucket(actionableSupportZones, "4h"),
    bucket: "4h",
    maxCount: config.timeframeConfig["4h"].maxOutputPerSide,
    config,
    side: "support",
    referencePrice: metadata.referencePrice,
  });
  const intermediateResistance = selectSpacedZones({
    zones: byOwnedBucket(surfacedResistanceZones, "4h"),
    bucket: "4h",
    maxCount: config.timeframeConfig["4h"].maxOutputPerSide,
    config,
    side: "resistance",
    referencePrice: metadata.referencePrice,
  });

  const intradaySupport = selectSpacedZones({
    zones: byOwnedBucket(actionableSupportZones, "5m"),
    bucket: "5m",
    maxCount: config.timeframeConfig["5m"].maxOutputPerSide,
    config,
    side: "support",
    referencePrice: metadata.referencePrice,
  });
  const intradayResistance = selectSpacedZones({
    zones: byOwnedBucket(surfacedResistanceZones, "5m"),
    bucket: "5m",
    maxCount: config.timeframeConfig["5m"].maxOutputPerSide,
    config,
    side: "resistance",
    referencePrice: metadata.referencePrice,
  });

  const extensionLevels = buildLevelExtensions({
    supportZones,
    resistanceZones,
    surfacedSupport: [...dailySupport, ...intermediateSupport, ...intradaySupport],
    surfacedResistance: [...dailyResistance, ...intermediateResistance, ...intradayResistance],
    spacingPct: config.extensionSpacingPct,
    searchWindowPct: config.extensionSearchWindowPct,
    referencePrice: metadata.referencePrice,
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
