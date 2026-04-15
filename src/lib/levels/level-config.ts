// 2026-04-14 09:02 PM America/Toronto
// Final phase 1 refinement config for scoring and clustering.

import type { CandleTimeframe } from "../market-data/candle-types.js";

export type TimeframeConfig = {
  swingWindow: number;
  clusterTolerancePct: number;
  timeframeWeight: number;
  maxOutputPerSide: number;
};

export type ScoreThresholds = {
  major: number;
  strong: number;
  moderate: number;
};

export type LevelEngineConfig = {
  timeframeConfig: Record<CandleTimeframe, TimeframeConfig>;
  reactionWeight: number;
  touchWeight: number;
  confluenceWeight: number;
  recencyWeight: number;
  singleTimeframeOnlyPenalty: {
    daily: number;
    "4h": number;
    "5m": number;
  };
  mixedTimeframeBonus: number;
  secondPassMergeToleranceMultiplier: number;
  overlapMergeTolerancePct: number;
  maxMergedZoneWidthPct: number;
  scoreThresholds: ScoreThresholds;
};

export const DEFAULT_LEVEL_ENGINE_CONFIG: LevelEngineConfig = {
  timeframeConfig: {
    daily: {
      swingWindow: 3,
      clusterTolerancePct: 0.01,
      timeframeWeight: 4,
      maxOutputPerSide: 4,
    },
    "4h": {
      swingWindow: 2,
      clusterTolerancePct: 0.0075,
      timeframeWeight: 3,
      maxOutputPerSide: 5,
    },
    "5m": {
      swingWindow: 2,
      clusterTolerancePct: 0.004,
      timeframeWeight: 2,
      maxOutputPerSide: 6,
    },
  },
  reactionWeight: 2.0,
  touchWeight: 1.35,
  confluenceWeight: 2.6,
  recencyWeight: 1.1,
  singleTimeframeOnlyPenalty: {
    daily: 0.92,
    "4h": 0.85,
    "5m": 0.58,
  },
  mixedTimeframeBonus: 1.2,
  secondPassMergeToleranceMultiplier: 0.6,
  overlapMergeTolerancePct: 0.002,
  maxMergedZoneWidthPct: 0.03,
  scoreThresholds: {
    major: 40,
    strong: 25,
    moderate: 12,
  },
};
