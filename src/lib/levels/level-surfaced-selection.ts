// 2026-05-27 08:55 PM America/Toronto
// Minimal surfaced-selection shape used by the rescue-only runtime projection tests.

import type { LevelState, LevelType, RankedLevel, RankedLevelsOutput } from "./level-types.js";

export type SurfacedLevelSelection = RankedLevel & {
  selectionCategory: "actionable" | "anchor";
  surfacedSelectionScore: number;
  surfacedSelectionExplanation: string;
  surfacedSelectionNotes: string[];
  durabilityLabel?: "fragile" | "tested" | "durable" | "reinforced";
};

export type SurfacedSelectionResult = {
  symbol: string;
  currentPrice: number;
  surfacedSupports: SurfacedLevelSelection[];
  surfacedResistances: SurfacedLevelSelection[];
  deeperSupportAnchor?: SurfacedLevelSelection;
  deeperResistanceAnchor?: SurfacedLevelSelection;
  suppressedNearDuplicates: SurfacedLevelSelection[];
  diagnostics: {
    rankedSupportCount: number;
    rankedResistanceCount: number;
    surfacedSupportCount: number;
    surfacedResistanceCount: number;
  };
};

const SURFACED_MAX_LEVELS_PER_SIDE = 12;
const SURFACED_NEAREST_RESERVED = 4;

function durabilityLabelForState(state: LevelState): SurfacedLevelSelection["durabilityLabel"] {
  if (state === "heavily_tested" || state === "weakened" || state === "broken") {
    return "fragile";
  }

  if (state === "respected" || state === "reclaimed" || state === "flipped") {
    return "durable";
  }

  return "tested";
}

function toSurfacedLevel(
  level: RankedLevel,
  selectionCategory: SurfacedLevelSelection["selectionCategory"] = "actionable",
): SurfacedLevelSelection {
  return {
    ...level,
    selectionCategory,
    surfacedSelectionScore: level.score,
    surfacedSelectionExplanation: level.explanation,
    surfacedSelectionNotes: [],
    durabilityLabel: durabilityLabelForState(level.state),
  };
}

function distancePct(level: RankedLevel, currentPrice: number): number {
  const distance =
    currentPrice < level.zoneLow
      ? level.zoneLow - currentPrice
      : currentPrice > level.zoneHigh
        ? currentPrice - level.zoneHigh
        : 0;
  return distance / Math.max(currentPrice, 0.0001);
}

function eligibleSideLevels(
  levels: RankedLevel[],
  side: LevelType,
  currentPrice: number,
): RankedLevel[] {
  return levels.filter((level) => {
    if (
      level.type !== side ||
      level.state === "broken" ||
      !level.isClusterRepresentative
    ) {
      return false;
    }

    return side === "support"
      ? level.zoneLow <= currentPrice
      : level.zoneHigh >= currentPrice;
  }).sort(
    (left, right) =>
      distancePct(left, currentPrice) - distancePct(right, currentPrice) ||
      right.score - left.score,
  );
}

function containsCurrentPrice(level: RankedLevel, currentPrice: number): boolean {
  return level.zoneLow <= currentPrice && currentPrice <= level.zoneHigh;
}

function zonesOverlap(left: RankedLevel, right: RankedLevel): boolean {
  return left.zoneLow <= right.zoneHigh && right.zoneLow <= left.zoneHigh;
}

function isRepresentativeOnExpectedSide(level: RankedLevel, currentPrice: number): boolean {
  return level.type === "support"
    ? level.price < currentPrice
    : level.price > currentPrice;
}

function strongestTimeframeWeight(level: RankedLevel): number {
  if (level.sourceTimeframes.includes("daily")) {
    return 3;
  }
  if (level.sourceTimeframes.includes("4h")) {
    return 2;
  }
  return 1;
}

function compareCrossSideOwnership(left: RankedLevel, right: RankedLevel): number {
  const leftConfirmedFlip = left.roleFlipEvidence ? 1 : 0;
  const rightConfirmedFlip = right.roleFlipEvidence ? 1 : 0;
  return (
    rightConfirmedFlip - leftConfirmedFlip ||
    strongestTimeframeWeight(right) - strongestTimeframeWeight(left) ||
    right.score - left.score ||
    right.confidence - left.confidence ||
    left.id.localeCompare(right.id)
  );
}

function arbitrateCurrentPriceCrossSideConflicts(
  supports: RankedLevel[],
  resistances: RankedLevel[],
  currentPrice: number,
): {
  supports: RankedLevel[];
  resistances: RankedLevel[];
  suppressed: RankedLevel[];
} {
  const suppressedIds = new Set<string>();

  for (const support of supports) {
    for (const resistance of resistances) {
      if (suppressedIds.has(support.id) || suppressedIds.has(resistance.id)) {
        continue;
      }
      if (
        !containsCurrentPrice(support, currentPrice) ||
        !containsCurrentPrice(resistance, currentPrice) ||
        !zonesOverlap(support, resistance)
      ) {
        continue;
      }

      const supportAligned = isRepresentativeOnExpectedSide(support, currentPrice);
      const resistanceAligned = isRepresentativeOnExpectedSide(resistance, currentPrice);
      if (supportAligned && resistanceAligned) {
        continue;
      }
      if (supportAligned !== resistanceAligned) {
        suppressedIds.add(supportAligned ? resistance.id : support.id);
        continue;
      }

      const [winner, loser] = [support, resistance].sort(compareCrossSideOwnership);
      if (winner && loser) {
        suppressedIds.add(loser.id);
      }
    }
  }

  return {
    supports: supports.filter((level) => !suppressedIds.has(level.id)),
    resistances: resistances.filter((level) => !suppressedIds.has(level.id)),
    suppressed: [...supports, ...resistances].filter((level) => suppressedIds.has(level.id)),
  };
}

function quantileSample(
  levels: RankedLevel[],
  count: number,
): RankedLevel[] {
  if (count <= 0 || levels.length === 0) {
    return [];
  }
  if (levels.length <= count) {
    return [...levels];
  }
  if (count === 1) {
    return [levels.at(-1)!];
  }

  const sampled: RankedLevel[] = [];
  for (let index = 0; index < count; index += 1) {
    const sourceIndex = Math.round(index * (levels.length - 1) / (count - 1));
    const level = levels[sourceIndex]!;
    if (!sampled.some((candidate) => candidate.id === level.id)) {
      sampled.push(level);
    }
  }
  return sampled;
}

function selectSide(
  eligible: RankedLevel[],
  currentPrice: number,
): { selected: RankedLevel[]; outerAnchorId?: string; suppressed: RankedLevel[] } {
  if (eligible.length <= SURFACED_MAX_LEVELS_PER_SIDE) {
    return {
      selected: eligible,
      ...(eligible.length > 1 ? { outerAnchorId: eligible.at(-1)!.id } : {}),
      suppressed: [],
    };
  }

  const nearest = eligible.slice(0, SURFACED_NEAREST_RESERVED);
  const remaining = eligible.slice(SURFACED_NEAREST_RESERVED);
  const outermost = remaining.at(-1)!;
  const outermostStructural = [...remaining]
    .reverse()
    .find((level) =>
      level.sourceTimeframes.includes("daily") || level.sourceTimeframes.includes("4h"),
    );
  const anchors = [outermost, outermostStructural]
    .filter((level): level is RankedLevel => level !== undefined)
    .filter((level, index, all) => all.findIndex((candidate) => candidate.id === level.id) === index);
  const coveragePool = remaining.filter(
    (level) => !anchors.some((anchor) => anchor.id === level.id),
  );
  const coverageSlots = SURFACED_MAX_LEVELS_PER_SIDE - nearest.length - anchors.length;
  const selected = [
    ...nearest,
    ...quantileSample(coveragePool, coverageSlots),
    ...anchors,
  ]
    .filter((level, index, all) => all.findIndex((candidate) => candidate.id === level.id) === index)
    .sort(
      (left, right) => distancePct(left, currentPrice) - distancePct(right, currentPrice),
    )
    .slice(0, SURFACED_MAX_LEVELS_PER_SIDE);

  return {
    selected,
    outerAnchorId: selected.at(-1)?.id,
    suppressed: [],
  };
}

export function selectSurfacedLevels(
  rankedOutput: RankedLevelsOutput,
): SurfacedSelectionResult {
  const crossSideSelection = arbitrateCurrentPriceCrossSideConflicts(
    eligibleSideLevels(rankedOutput.supports, "support", rankedOutput.currentPrice),
    eligibleSideLevels(rankedOutput.resistances, "resistance", rankedOutput.currentPrice),
    rankedOutput.currentPrice,
  );
  const supportSelection = selectSide(
    crossSideSelection.supports,
    rankedOutput.currentPrice,
  );
  const resistanceSelection = selectSide(
    crossSideSelection.resistances,
    rankedOutput.currentPrice,
  );
  const supports = supportSelection.selected.map((level) =>
    toSurfacedLevel(
      level,
      level.id === supportSelection.outerAnchorId ? "anchor" : "actionable",
    ),
  );
  const resistances = resistanceSelection.selected.map((level) =>
    toSurfacedLevel(
      level,
      level.id === resistanceSelection.outerAnchorId ? "anchor" : "actionable",
    ),
  );
  const suppressedNearDuplicates = [
    ...rankedOutput.supports,
    ...rankedOutput.resistances,
  ]
    .filter((level) => !level.isClusterRepresentative)
    .concat(
      crossSideSelection.suppressed,
      supportSelection.suppressed,
      resistanceSelection.suppressed,
    )
    .filter((level, index, all) => all.findIndex((candidate) => candidate.id === level.id) === index)
    .map((level) => toSurfacedLevel(level));

  return {
    symbol: rankedOutput.symbol,
    currentPrice: rankedOutput.currentPrice,
    surfacedSupports: supports,
    surfacedResistances: resistances,
    deeperSupportAnchor: supports.at(-1),
    deeperResistanceAnchor: resistances.at(-1),
    suppressedNearDuplicates,
    diagnostics: {
      rankedSupportCount: rankedOutput.supports.length,
      rankedResistanceCount: rankedOutput.resistances.length,
      surfacedSupportCount: supports.length,
      surfacedResistanceCount: resistances.length,
    },
  };
}
