// 2026-04-17 09:25 PM America/Toronto
// Core level engine types plus the next-layer level strength scoring contracts.

import type { Candle, CandleTimeframe } from "../market-data/candle-types.js";

export type LevelType = "support" | "resistance";
export type LevelKind = LevelType;

export type SwingPoint = {
  index: number;
  timestamp: number;
  price: number;
  kind: LevelKind;
  strength: number;
  displacement: number;
  separation: number;
  reactionCount: number;
};

export type RawLevelCandidateSourceType =
  | "swing_high"
  | "swing_low"
  | "premarket_high"
  | "premarket_low"
  | "opening_range_high"
  | "opening_range_low";

export type RawLevelCandidate = {
  id: string;
  symbol: string;
  price: number;
  kind: LevelKind;
  timeframe: CandleTimeframe;
  sourceType: RawLevelCandidateSourceType;
  touchCount: number;
  reactionScore: number;
  reactionQuality: number;
  rejectionScore: number;
  displacementScore: number;
  sessionSignificance: number;
  followThroughScore: number;
  gapContinuationScore?: number;
  repeatedReactionCount: number;
  gapStructure: boolean;
  firstTimestamp: number;
  lastTimestamp: number;
  notes: string[];
};

export type LevelDataFreshness = "fresh" | "aging" | "stale";

export type FinalLevelZone = {
  id: string;
  symbol: string;
  kind: LevelKind;
  timeframeBias: CandleTimeframe | "mixed";
  zoneLow: number;
  zoneHigh: number;
  representativePrice: number;
  strengthScore: number;
  strengthLabel: "weak" | "moderate" | "strong" | "major";
  touchCount: number;
  confluenceCount: number;
  sourceTypes: RawLevelCandidateSourceType[];
  timeframeSources: CandleTimeframe[];
  reactionQualityScore: number;
  rejectionScore: number;
  displacementScore: number;
  sessionSignificanceScore: number;
  followThroughScore: number;
  gapContinuationScore?: number;
  sourceEvidenceCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  sessionDate?: string;
  isExtension: boolean;
  freshness: LevelDataFreshness;
  notes: string[];
};

export type LevelLadderExtension = {
  support: FinalLevelZone[];
  resistance: FinalLevelZone[];
};

export type LevelOutputMetadata = {
  providerByTimeframe: Partial<Record<CandleTimeframe, string>>;
  dataQualityFlags: string[];
  freshness: LevelDataFreshness;
  referencePrice?: number;
};

export type LevelEngineOutput = {
  symbol: string;
  generatedAt: number;
  metadata: LevelOutputMetadata;
  majorSupport: FinalLevelZone[];
  majorResistance: FinalLevelZone[];
  intermediateSupport: FinalLevelZone[];
  intermediateResistance: FinalLevelZone[];
  intradaySupport: FinalLevelZone[];
  intradayResistance: FinalLevelZone[];
  extensionLevels: LevelLadderExtension;
  specialLevels: {
    premarketHigh?: number;
    premarketLow?: number;
    openingRangeHigh?: number;
    openingRangeLow?: number;
  };
};

export type SourceTimeframe = "daily" | "4h" | "1h" | "15m" | "5m";

export type LevelOrigin =
  | RawLevelCandidateSourceType
  | "role_flip"
  | "gap"
  | "manual"
  | "unknown";

export type LevelState =
  | "fresh"
  | "respected"
  | "heavily_tested"
  | "weakened"
  | "broken"
  | "reclaimed"
  | "flipped";

export type LevelDurabilityLabel =
  | "fragile"
  | "tested"
  | "durable"
  | "reinforced";

export type LevelReactionType =
  | "tap"
  | "rejection"
  | "failed_break"
  | "clean_break"
  | "reclaim";

export type LevelTouch = {
  candleTimestamp: number;
  timeframe: SourceTimeframe;
  reactionType: LevelReactionType;
  touchDistancePct: number;
  reactionMovePct: number;
  reactionMoveCandles: number;
  volumeRatio: number;
  closedAwayFromLevel: boolean;
  wickRejectStrength: number;
  bodyRejectStrength: number;
};

export type LevelTouchAnalysisResult = {
  touches: LevelTouch[];
  touchCount: number;
  meaningfulTouchCount: number;
  rejectionCount: number;
  failedBreakCount: number;
  cleanBreakCount: number;
  reclaimCount: number;
  strongestReactionMovePct: number;
  averageReactionMovePct: number;
  bestVolumeRatio: number;
  averageVolumeRatio: number;
  cleanlinessStdDevPct: number;
  barsSinceLastReaction: number;
  ageInBars: number;
};

export type LevelCandidate = {
  id: string;
  symbol: string;
  type: LevelType;
  price: number;
  zoneLow?: number;
  zoneHigh?: number;
  sourceTimeframes: SourceTimeframe[];
  originKinds: LevelOrigin[];
  analysisCandles?: Candle[];
  touches?: LevelTouch[];
  touchCount?: number;
  meaningfulTouchCount?: number;
  rejectionCount?: number;
  failedBreakCount?: number;
  cleanBreakCount?: number;
  reclaimCount?: number;
  roleFlipCount?: number;
  strongestReactionMovePct?: number;
  averageReactionMovePct?: number;
  bestVolumeRatio?: number;
  averageVolumeRatio?: number;
  cleanlinessStdDevPct?: number;
  ageInBars?: number;
  barsSinceLastReaction?: number;
  clusterId?: string | null;
  clusterPenalty?: number;
  isClusterRepresentative?: boolean;
};

export type LevelScoreBreakdown = {
  timeframeScore: number;
  touchScore: number;
  reactionQualityScore: number;
  reactionMagnitudeScore: number;
  volumeScore: number;
  cleanlinessScore: number;
  roleFlipScore: number;
  defenseScore: number;
  recencyScore: number;
  durabilityScore?: number;
  durabilityAdjustment?: number;
  breakDamagePenalty: number;
  overtestPenalty: number;
  clusterPenalty: number;
  structuralStrengthScore: number;
  distanceToPriceScore: number;
  freshReactionScore: number;
  intradayPressureScore: number;
  recentVolumeActivityScore: number;
  currentInteractionScore: number;
  activeRelevanceScore: number;
  finalLevelScore: number;
};

export type RankedLevel = {
  id: string;
  symbol: string;
  type: LevelType;
  price: number;
  zoneLow: number;
  zoneHigh: number;
  sourceTimeframes: SourceTimeframe[];
  originKinds: LevelOrigin[];
  touches: LevelTouch[];
  touchCount: number;
  meaningfulTouchCount: number;
  rejectionCount: number;
  failedBreakCount: number;
  cleanBreakCount: number;
  reclaimCount: number;
  roleFlipCount: number;
  strongestReactionMovePct: number;
  averageReactionMovePct: number;
  bestVolumeRatio: number;
  averageVolumeRatio: number;
  cleanlinessStdDevPct: number;
  ageInBars: number;
  barsSinceLastReaction: number;
  structuralStrengthScore: number;
  activeRelevanceScore: number;
  finalLevelScore: number;
  score: number;
  rank: number;
  confidence: number;
  state: LevelState;
  durabilityLabel?: LevelDurabilityLabel;
  isClusterRepresentative: boolean;
  clusterId: string | null;
  explanation: string;
  scoreBreakdown: LevelScoreBreakdown;
};

export type RankedLevelsOutput = {
  symbol: string;
  currentPrice: number;
  supports: RankedLevel[];
  resistances: RankedLevel[];
  topSupport?: RankedLevel;
  topResistance?: RankedLevel;
  computedAt: number;
};

export type LevelCluster = {
  id: string;
  type: LevelType;
  zoneLow: number;
  zoneHigh: number;
  memberIds: string[];
  representativeId: string;
};

export type LevelScoringContext = {
  symbol: string;
  currentPrice: number;
  latestTimestamp: number;
  currentSessionVolumeRatio?: number;
  recentCandles?: Candle[];
  currentTimeframe: SourceTimeframe;
};
