import type { FinalLevelZone } from "../../lib/levels/level-types.js";

export function buildValidationZone(
  params: Partial<FinalLevelZone> & Pick<FinalLevelZone, "id" | "symbol" | "kind">,
): FinalLevelZone {
  return {
    timeframeBias: "5m",
    zoneLow: params.kind === "support" ? 1.95 : 2.45,
    zoneHigh: params.kind === "support" ? 2.0 : 2.5,
    representativePrice: params.kind === "support" ? 1.97 : 2.47,
    strengthScore: 16,
    strengthLabel: "moderate",
    touchCount: 2,
    confluenceCount: 1,
    sourceTypes: [params.kind === "support" ? "swing_low" : "swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0.45,
    rejectionScore: 0.3,
    displacementScore: 0.38,
    sessionSignificanceScore: 0.12,
    followThroughScore: 0.28,
    gapContinuationScore: 0,
    sourceEvidenceCount: 1,
    firstTimestamp: 1,
    lastTimestamp: 2,
    sessionDate: undefined,
    isExtension: false,
    freshness: "fresh",
    notes: [],
    ...params,
  };
}
