// 2026-04-18 08:40 AM America/Toronto
// Compact compare-mode logging for old versus new surfaced runtime outputs.

import {
  computeComparisonDifferences,
  type ComparablePathOutput,
} from "./level-ranking-comparison.js";
import type { LevelRuntimeCompareActivePath } from "./level-runtime-mode.js";

export type LevelRuntimeComparisonLogEntry = {
  type: "level_runtime_compare";
  symbol: string;
  activePath: LevelRuntimeCompareActivePath;
  alternatePath: LevelRuntimeCompareActivePath;
  activeTopSupport: string | null;
  alternateTopSupport: string | null;
  activeTopResistance: string | null;
  alternateTopResistance: string | null;
  activeVisibleCounts: {
    support: number;
    resistance: number;
  };
  alternateVisibleCounts: {
    support: number;
    resistance: number;
  };
  notableDifferences: string[];
  newPathContext: {
    topSupportState: string | null;
    topSupportConfidence: number | null;
    topSupportExplanation: string | null;
    topResistanceState: string | null;
    topResistanceConfidence: number | null;
    topResistanceExplanation: string | null;
  };
};

function formatLevel(level: ComparablePathOutput["topSupport"]): string | null {
  if (!level) {
    return null;
  }

  const priceText = level.price >= 1 ? level.price.toFixed(2) : level.price.toFixed(4);
  return `${priceText}${level.state ? ` (${level.state})` : ""}`;
}

export function buildLevelRuntimeComparisonLogEntry(params: {
  symbol: string;
  activePath: LevelRuntimeCompareActivePath;
  oldPath: ComparablePathOutput;
  newPath: ComparablePathOutput;
}): LevelRuntimeComparisonLogEntry {
  const alternatePath = params.activePath === "old" ? "new" : "old";
  const activeOutput = params.activePath === "old" ? params.oldPath : params.newPath;
  const alternateOutput = params.activePath === "old" ? params.newPath : params.oldPath;
  const differences = computeComparisonDifferences({
    oldPath: params.oldPath,
    newPath: params.newPath,
    limitations: [],
  });

  return {
    type: "level_runtime_compare",
    symbol: params.symbol.toUpperCase(),
    activePath: params.activePath,
    alternatePath,
    activeTopSupport: formatLevel(activeOutput.topSupport),
    alternateTopSupport: formatLevel(alternateOutput.topSupport),
    activeTopResistance: formatLevel(activeOutput.topResistance),
    alternateTopResistance: formatLevel(alternateOutput.topResistance),
    activeVisibleCounts: {
      support: activeOutput.visibleSupportCount,
      resistance: activeOutput.visibleResistanceCount,
    },
    alternateVisibleCounts: {
      support: alternateOutput.visibleSupportCount,
      resistance: alternateOutput.visibleResistanceCount,
    },
    notableDifferences: differences.noteworthyDisagreements.slice(0, 4),
    newPathContext: {
      topSupportState: params.newPath.topSupport?.state ?? null,
      topSupportConfidence: params.newPath.topSupport?.confidence ?? null,
      topSupportExplanation: params.newPath.topSupport?.explanation ?? null,
      topResistanceState: params.newPath.topResistance?.state ?? null,
      topResistanceConfidence: params.newPath.topResistance?.confidence ?? null,
      topResistanceExplanation: params.newPath.topResistance?.explanation ?? null,
    },
  };
}
