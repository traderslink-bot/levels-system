// 2026-04-14 08:05 PM America/Toronto
// Core level engine types.

import type { CandleTimeframe } from "../market-data/candle-types.js";

export type LevelKind = "support" | "resistance";

export type SwingPoint = {
  index: number;
  timestamp: number;
  price: number;
  kind: LevelKind;
  strength: number;
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
  firstTimestamp: number;
  lastTimestamp: number;
  notes: string[];
};

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
  firstTimestamp: number;
  lastTimestamp: number;
  notes: string[];
};

export type LevelEngineOutput = {
  symbol: string;
  generatedAt: number;
  majorSupport: FinalLevelZone[];
  majorResistance: FinalLevelZone[];
  intermediateSupport: FinalLevelZone[];
  intermediateResistance: FinalLevelZone[];
  intradaySupport: FinalLevelZone[];
  intradayResistance: FinalLevelZone[];
  specialLevels: {
    premarketHigh?: number;
    premarketLow?: number;
    openingRangeHigh?: number;
    openingRangeLow?: number;
  };
};
