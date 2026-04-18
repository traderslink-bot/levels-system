// 2026-04-17 09:29 PM America/Toronto
// Centralized configuration for level strength scoring and ranking.

export const LEVEL_SCORE_CONFIG = {
  structuralWeights: {
    timeframe: 20,
    touches: 15,
    reactionQuality: 15,
    reactionMagnitude: 10,
    volume: 10,
    cleanliness: 10,
    roleFlip: 8,
    defense: 8,
    recency: 8,
  },
  penalties: {
    overtestMax: 10,
    clusterMax: 8,
  },
  activeWeights: {
    distanceToPrice: 35,
    freshReaction: 20,
    intradayPressure: 20,
    recentVolumeActivity: 15,
    currentInteraction: 10,
  },
  combineWeights: {
    structural: 0.75,
    active: 0.25,
  },
  touchThresholds: {
    minReactionMovePct: 0.015,
    minVolumeRatioForMeaningfulReaction: 1.2,
    maxTouchDistanceIntoZonePct: 0.0025,
    reactionLookaheadBars: 8,
    closeAwayBufferPct: 0.001,
    rollingVolumeLookbackBars: 10,
  },
  zoneRules: {
    sub2DollarZoneWidthPct: 0.0035,
    sub10DollarZoneWidthPct: 0.0025,
    defaultZoneWidthPct: 0.0015,
  },
  clustering: {
    maxRepresentativeDistancePct: 0.004,
    zoneOverlapThreshold: 0.6,
  },
  recencyBars: {
    fresh: 3,
    recent: 8,
    warm: 15,
    aging: 30,
  },
  stateThresholds: {
    respectedMeaningfulTouches: 2,
    heavilyTestedTouchCount: 6,
    weakenedTouchCount: 5,
    shallowReactionPct: 0.018,
  },
  activeThresholds: {
    strongDistancePct: 0.005,
    moderateDistancePct: 0.01,
    nearDistancePct: 0.02,
    localDistancePct: 0.03,
    farDistancePct: 0.05,
    currentInteractionDistancePct: 0.0025,
    recentVolumeHighRatio: 1.5,
    pressureLookbackBars: 8,
  },
} as const;

export type LevelScoreConfig = typeof LEVEL_SCORE_CONFIG;
