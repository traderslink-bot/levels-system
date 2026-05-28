// 2026-05-27 08:55 PM America/Toronto
// Small deterministic fixture set for rescue-only runtime projection tests.

import type { LevelCandidate, RawLevelCandidate } from "./level-types.js";

export type SurfacedShadowCase = {
  caseId: string;
  symbol: string;
  currentPrice: number;
  rawCandidates?: RawLevelCandidate[];
  newCandidates: LevelCandidate[];
};

export function buildDefaultSurfacedShadowCases(): SurfacedShadowCase[] {
  return [
    {
      caseId: "broken-level-exclusion",
      symbol: "SHDW",
      currentPrice: 8.25,
      rawCandidates: [],
      newCandidates: [
        {
          id: "SHDW-support-8.12",
          symbol: "SHDW",
          type: "support",
          price: 8.12,
          sourceTimeframes: ["4h"],
          originKinds: ["swing_low"],
          touchCount: 2,
          meaningfulTouchCount: 2,
          rejectionCount: 2,
          failedBreakCount: 0,
          cleanBreakCount: 0,
          reclaimCount: 0,
          strongestReactionMovePct: 0.04,
          averageReactionMovePct: 0.025,
          bestVolumeRatio: 1.4,
          averageVolumeRatio: 1.2,
          cleanlinessStdDevPct: 0.01,
          ageInBars: 12,
          barsSinceLastReaction: 4,
        },
        {
          id: "SHDW-resistance-8.72",
          symbol: "SHDW",
          type: "resistance",
          price: 8.72,
          sourceTimeframes: ["daily"],
          originKinds: ["swing_high"],
          touchCount: 3,
          meaningfulTouchCount: 3,
          rejectionCount: 2,
          failedBreakCount: 1,
          cleanBreakCount: 0,
          reclaimCount: 0,
          strongestReactionMovePct: 0.05,
          averageReactionMovePct: 0.03,
          bestVolumeRatio: 1.6,
          averageVolumeRatio: 1.25,
          cleanlinessStdDevPct: 0.015,
          ageInBars: 20,
          barsSinceLastReaction: 6,
        },
      ],
    },
  ];
}
