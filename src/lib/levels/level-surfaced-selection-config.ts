// 2026-04-18 12:02 AM America/Toronto
// Centralized configuration for surfaced trader-facing level selection on top of the structural ranking layer.

export const LEVEL_SURFACED_SELECTION_CONFIG = {
  minimumStructuralScore: 32,
  minimumConfidence: 45,
  maximumSurfacedSupportCount: 3,
  maximumSurfacedResistanceCount: 3,
  includeOneDeeperAnchor: true,
  deeperAnchorMinStructuralScore: 52,
  deeperAnchorMinDistancePct: 0.018,
  strongerFarLevelStructuralBuffer: 12,
  sideRules: {
    support: {
      maxActionableDistancePct: 0.12,
      practicalInteractionBandPct: 0.025,
      preferredDistanceBandsPct: {
        immediate: 0.005,
        near: 0.015,
        local: 0.03,
        extended: 0.06,
      },
    },
    resistance: {
      maxActionableDistancePct: 0.12,
      practicalInteractionBandPct: 0.025,
      preferredDistanceBandsPct: {
        immediate: 0.005,
        near: 0.015,
        local: 0.03,
        extended: 0.06,
      },
    },
  },
  weights: {
    structuralQuality: 0.42,
    proximity: 0.33,
    actionableState: 0.15,
    ladderUsefulness: 0.10,
  },
  stateAdjustments: {
    fresh: 8,
    respected: 10,
    heavily_tested: -2,
    weakened: -14,
    broken: -40,
    reclaimed: 9,
    flipped: 7,
  },
  nearPriceSelection: {
    minimumStructuralScore: 52,
    minimumConfidence: 60,
    weakenedStructuralOverride: 72,
    weakenedConfidenceOverride: 70,
    practicalInteractionBonus: 12,
    firstActionablePriorityBonus: 14,
    weakNearClutterPenalty: 22,
  },
  confidenceBonusScale: 0.08,
  sameBandSuppressionDistancePct: 0.011,
  bandOwnershipDistancePct: 0.019,
  strongerNearbyOverrideStructuralBuffer: 16,
  ladderSpacingRules: {
    minSpacingPct: 0.012,
    preferredSpacingPct: 0.022,
  },
  ladderUsefulness: {
    firstLevelBonus: 12,
    spacingBonus: 8,
    nearPriceActionableBonus: 10,
    currentInteractionBonus: 6,
    freshReactionBonus: 5,
    anchorContextBonus: 9,
  },
  tieBreakPriority: [
    "selectionScore",
    "distanceToPrice",
    "structuralStrength",
    "confidence",
    "rank",
  ] as const,
} as const;

export type LevelSurfacedSelectionConfig = typeof LEVEL_SURFACED_SELECTION_CONFIG;
