import type { MarketContextFactsBundle, MarketContextProfile } from "../market-context/index.js";
import type { SessionMarketFacts } from "../session/index.js";
import type { VolumeMarketFacts, VolumeShelf } from "../volume/index.js";
import { explainLevelContext } from "./level-context-explainer.js";
import type { FinalLevelZone, LevelDataFreshness, LevelState } from "./level-types.js";

export type LevelDistanceCategory = "near" | "approaching" | "extended" | "far";

export type LevelRoundNumberType = "whole" | "half" | "quarter" | "ten_cent";

export type LevelIntelligenceProfile = {
  levelId: string;
  symbol: string;
  kind: "support" | "resistance";
  representativePrice: number;
  zoneLow: number;
  zoneHigh: number;
  zoneWidthPercent: number;
  origin: {
    sourceTypes: string[];
    timeframeSources: string[];
    primaryTimeframe: string;
    isExtension: boolean;
  };
  freshness: {
    firstTimestamp: number;
    lastTimestamp: number;
    label: LevelDataFreshness;
    state?: LevelState;
  };
  reaction: {
    touchCount: number;
    reactionQualityScore: number;
    rejectionScore: number;
    displacementScore: number;
    followThroughScore: number;
    meaningfulTouchCount?: number;
    rejectionCount?: number;
    failedBreakCount?: number;
    cleanBreakCount?: number;
    reclaimCount?: number;
    averageReactionMovePct?: number;
    strongestReactionMovePct?: number;
    bestVolumeRatio?: number;
    averageVolumeRatio?: number;
    cleanlinessStdDevPct?: number;
  };
  distance?: {
    referencePrice: number;
    distanceFromReferencePct: number;
    category: LevelDistanceCategory;
  };
  volume?: {
    volumeState: VolumeMarketFacts["volumeState"];
    relativeVolume?: number;
    dollarVolume?: number;
    liquidityQuality: VolumeMarketFacts["liquidityQuality"];
    accelerationState: VolumeMarketFacts["accelerationState"];
    pullbackVolumeState: VolumeMarketFacts["pullbackVolumeState"];
    breakoutVolumeState: VolumeMarketFacts["breakoutVolumeState"];
    nearbyShelfIds: string[];
  };
  confluence: {
    nearSessionFacts: string[];
    nearVolumeFacts: string[];
    nearShelfFacts: string[];
    contextTags: string[];
    nearRoundNumber?: {
      value: number;
      type: LevelRoundNumberType;
      distancePct: number;
    };
  };
  marketContext?: {
    primaryContext: MarketContextProfile["primaryContext"];
    runnerPhase: MarketContextProfile["runnerPhase"];
    confidence: number;
  };
  confidence?: number;
  diagnostics: string[];
  reason: string;
  safety: {
    factsOnly: true;
    noRuntimeBehaviorChange: true;
    vwapFactsOnly: true;
    shelvesAreFactsOnly: true;
  };
};

export type BuildLevelIntelligenceProfileRequest = {
  level: FinalLevelZone;
  referencePrice?: number;
  sessionFacts?: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  volumeShelves?: VolumeShelf[];
  marketContext?: MarketContextProfile;
  factsBundle?: MarketContextFactsBundle;
  proximityThresholdPct?: number;
};

const DEFAULT_PROXIMITY_THRESHOLD_PCT = 1;
const ROUND_NUMBER_THRESHOLD_PCT = 0.35;

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isUsableNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function distancePct(price: number, referencePrice: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(referencePrice) || referencePrice === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return round((Math.abs(price - referencePrice) / Math.abs(referencePrice)) * 100);
}

function distanceCategory(distance: number): LevelDistanceCategory {
  if (distance <= 2) {
    return "near";
  }
  if (distance <= 8) {
    return "approaching";
  }
  if (distance <= 20) {
    return "extended";
  }

  return "far";
}

function resolveSessionFacts(request: BuildLevelIntelligenceProfileRequest): SessionMarketFacts | undefined {
  return request.sessionFacts ?? request.factsBundle?.sessionFacts;
}

function resolveVolumeFacts(request: BuildLevelIntelligenceProfileRequest): VolumeMarketFacts | undefined {
  return request.volumeFacts ?? request.factsBundle?.volumeFacts;
}

function resolveReferencePrice(
  request: BuildLevelIntelligenceProfileRequest,
  sessionFacts: SessionMarketFacts | undefined,
): number | undefined {
  return request.referencePrice ?? request.factsBundle?.referencePrice ?? sessionFacts?.currentPrice;
}

function resolveVolumeShelves(request: BuildLevelIntelligenceProfileRequest): VolumeShelf[] {
  const shelves = new Map<string, VolumeShelf>();

  for (const shelf of [...(request.volumeShelves ?? []), ...(request.factsBundle?.volumeShelves ?? [])]) {
    shelves.set(shelf.id, shelf);
  }

  return [...shelves.values()];
}

function shelfOverlapsLevel(level: FinalLevelZone, shelf: VolumeShelf): boolean {
  return level.zoneLow <= shelf.zoneHigh && shelf.zoneLow <= level.zoneHigh;
}

function shelfNearLevel(level: FinalLevelZone, shelf: VolumeShelf, thresholdPct: number): boolean {
  return shelfOverlapsLevel(level, shelf) || distancePct(level.representativePrice, shelf.representativePrice) <= thresholdPct;
}

function zoneWidthPercent(level: FinalLevelZone): number {
  if (level.representativePrice === 0) {
    return 0;
  }

  return round((Math.abs(level.zoneHigh - level.zoneLow) / Math.abs(level.representativePrice)) * 100);
}

function roundNumberType(value: number): LevelRoundNumberType {
  const cents = Math.round((value - Math.floor(value)) * 100);
  if (cents === 0) {
    return "whole";
  }
  if (cents === 50) {
    return "half";
  }
  if (cents === 25 || cents === 75) {
    return "quarter";
  }

  return "ten_cent";
}

function nearestRoundNumber(price: number): LevelIntelligenceProfile["confluence"]["nearRoundNumber"] {
  const increments = [1, 0.5, 0.25, 0.1];
  const candidates = increments.map((increment) => {
    const value = round(Math.round(price / increment) * increment, 4);
    return {
      value,
      type: roundNumberType(value),
      distancePct: distancePct(price, value),
    };
  });
  const best = candidates.sort((left, right) => left.distancePct - right.distancePct)[0];

  if (!best || best.distancePct > ROUND_NUMBER_THRESHOLD_PCT) {
    return undefined;
  }

  return best;
}

function buildDistance(
  level: FinalLevelZone,
  referencePrice: number | undefined,
): LevelIntelligenceProfile["distance"] {
  if (!isUsableNumber(referencePrice)) {
    return undefined;
  }

  const pct = distancePct(level.representativePrice, referencePrice);
  return {
    referencePrice,
    distanceFromReferencePct: pct,
    category: distanceCategory(pct),
  };
}

function buildReaction(level: FinalLevelZone): LevelIntelligenceProfile["reaction"] {
  const touchStats = level.enrichedAnalysis?.touchStats;

  return {
    touchCount: level.touchCount,
    reactionQualityScore: level.reactionQualityScore,
    rejectionScore: level.rejectionScore,
    displacementScore: level.displacementScore,
    followThroughScore: level.followThroughScore,
    meaningfulTouchCount: touchStats?.meaningfulTouchCount,
    rejectionCount: touchStats?.rejectionCount,
    failedBreakCount: touchStats?.failedBreakCount,
    cleanBreakCount: touchStats?.cleanBreakCount,
    reclaimCount: touchStats?.reclaimCount,
    averageReactionMovePct: touchStats?.averageReactionMovePct,
    strongestReactionMovePct: touchStats?.strongestReactionMovePct,
    bestVolumeRatio: touchStats?.bestVolumeRatio,
    averageVolumeRatio: touchStats?.averageVolumeRatio,
    cleanlinessStdDevPct: touchStats?.cleanlinessStdDevPct,
  };
}

function buildDiagnostics(params: {
  sessionFacts: SessionMarketFacts | undefined;
  volumeFacts: VolumeMarketFacts | undefined;
  referencePrice: number | undefined;
  nearbyShelfIds: string[];
  level: FinalLevelZone;
}): string[] {
  const diagnostics: string[] = [];

  if (!params.sessionFacts) {
    diagnostics.push("session_facts_missing");
  }
  if (!params.volumeFacts) {
    diagnostics.push("volume_facts_missing");
  }
  if (!isUsableNumber(params.referencePrice)) {
    diagnostics.push("reference_price_missing");
  }
  if (!params.level.enrichedAnalysis) {
    diagnostics.push("enriched_analysis_missing");
  }
  if (params.nearbyShelfIds.length === 0) {
    diagnostics.push("no_nearby_volume_shelf");
  }

  return diagnostics;
}

function buildReason(level: FinalLevelZone, profile: Pick<LevelIntelligenceProfile, "distance" | "origin" | "freshness" | "volume">): string {
  const pieces = [
    `${level.kind} zone ${round(level.representativePrice)} is sourced from ${profile.origin.timeframeSources.join(", ") || "unknown timeframe"} evidence`,
    `freshness is ${profile.freshness.label}`,
  ];

  if (profile.freshness.state) {
    pieces.push(`state is ${profile.freshness.state}`);
  }
  if (profile.distance) {
    pieces.push(`${profile.distance.distanceFromReferencePct}% from reference price`);
  }
  if (profile.volume && profile.volume.volumeState !== "unknown") {
    pieces.push(`volume state is ${profile.volume.volumeState}`);
  }

  return `${pieces.join("; ")}.`;
}

export function buildLevelIntelligenceProfile(
  request: BuildLevelIntelligenceProfileRequest,
): LevelIntelligenceProfile {
  const { level } = request;
  const sessionFacts = resolveSessionFacts(request);
  const volumeFacts = resolveVolumeFacts(request);
  const shelves = resolveVolumeShelves(request);
  const referencePrice = resolveReferencePrice(request, sessionFacts);
  const thresholdPct = Math.max(0, request.proximityThresholdPct ?? DEFAULT_PROXIMITY_THRESHOLD_PCT);
  const contextExplanation = explainLevelContext({
    level,
    sessionFacts,
    volumeFacts,
    volumeShelves: shelves,
    marketContext: request.marketContext,
    factsBundle: request.factsBundle,
    currentPrice: referencePrice,
    proximityThresholdPct: thresholdPct,
  });
  const nearbyShelfIds = shelves
    .filter((shelf) => shelfNearLevel(level, shelf, thresholdPct))
    .map((shelf) => shelf.id);
  const distance = buildDistance(level, referencePrice);
  const volume = volumeFacts
    ? {
        volumeState: volumeFacts.volumeState,
        relativeVolume: volumeFacts.relativeVolume,
        dollarVolume: volumeFacts.dollarVolume,
        liquidityQuality: volumeFacts.liquidityQuality,
        accelerationState: volumeFacts.accelerationState,
        pullbackVolumeState: volumeFacts.pullbackVolumeState,
        breakoutVolumeState: volumeFacts.breakoutVolumeState,
        nearbyShelfIds,
      }
    : undefined;
  const profileSeed = {
    distance,
    origin: {
      sourceTypes: [...level.sourceTypes],
      timeframeSources: [...level.timeframeSources],
      primaryTimeframe: level.timeframeBias,
      isExtension: level.isExtension,
    },
    freshness: {
      firstTimestamp: level.firstTimestamp,
      lastTimestamp: level.lastTimestamp,
      label: level.freshness,
      state: level.enrichedAnalysis?.state,
    },
    volume,
  };

  return {
    levelId: level.id,
    symbol: level.symbol,
    kind: level.kind,
    representativePrice: level.representativePrice,
    zoneLow: level.zoneLow,
    zoneHigh: level.zoneHigh,
    zoneWidthPercent: zoneWidthPercent(level),
    origin: profileSeed.origin,
    freshness: profileSeed.freshness,
    reaction: buildReaction(level),
    distance,
    volume,
    confluence: {
      nearSessionFacts: [...contextExplanation.nearbySessionFacts],
      nearVolumeFacts: [...contextExplanation.nearbyVolumeFacts],
      nearShelfFacts: [...contextExplanation.nearbyShelfFacts],
      contextTags: [...contextExplanation.contextTags],
      nearRoundNumber: nearestRoundNumber(level.representativePrice),
    },
    marketContext: request.marketContext
      ? {
          primaryContext: request.marketContext.primaryContext,
          runnerPhase: request.marketContext.runnerPhase,
          confidence: request.marketContext.confidence,
        }
      : undefined,
    confidence: level.enrichedAnalysis?.confidence,
    diagnostics: buildDiagnostics({ sessionFacts, volumeFacts, referencePrice, nearbyShelfIds, level }),
    reason: buildReason(level, profileSeed),
    safety: {
      factsOnly: true,
      noRuntimeBehaviorChange: true,
      vwapFactsOnly: true,
      shelvesAreFactsOnly: true,
    },
  };
}
