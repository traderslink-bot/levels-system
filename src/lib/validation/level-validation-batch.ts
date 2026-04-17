import type { CandleSourceHealthReport } from "./candle-source-health.js";
import type {
  ForwardReactionDistanceBand,
  ForwardReactionSummary,
  ForwardReactionValidationReport,
} from "./forward-reaction-validator.js";
import type { LevelPersistenceValidationReport } from "./level-persistence-validator.js";

export type SymbolLevelValidationBatchResult = {
  symbol: string;
  healthReports: CandleSourceHealthReport[];
  persistenceReport?: LevelPersistenceValidationReport;
  forwardReactionReport?: ForwardReactionValidationReport;
  errorMessage?: string;
};

export type LevelValidationBatchSummary = {
  totalSymbols: number;
  healthySymbols: number;
  degradedSymbols: number;
  unavailableSymbols: number;
  completedSymbols: number;
  failedSymbols: number;
  averageSurfacedSupportPersistenceRate: number;
  averageSurfacedResistancePersistenceRate: number;
  averageSupportBucketPersistenceRate: {
    daily: number;
    "4h": number;
    "5m": number;
  };
  averageExtensionSupportPersistenceRate: number;
  averageExtensionResistancePersistenceRate: number;
  averageSupportLooseMatchRate: number;
  averageResistanceLooseMatchRate: number;
  averageSupportBucketLooseMatchRate: {
    daily: number;
    "4h": number;
    "5m": number;
  };
  averageSurfacedSupportUsefulnessRate: number;
  averageSurfacedResistanceUsefulnessRate: number;
  averageExtensionSupportUsefulnessRate: number;
  averageExtensionResistanceUsefulnessRate: number;
  averageSurfacedSupportUsefulWhenTouchedRate: number;
  averageSurfacedResistanceUsefulWhenTouchedRate: number;
  averageExtensionSupportUsefulWhenTouchedRate: number;
  averageExtensionResistanceUsefulWhenTouchedRate: number;
  averageSupportBucketTouchRate: {
    daily: number;
    "4h": number;
    "5m": number;
  };
  averageSupportBucketUsefulnessRate: {
    daily: number;
    "4h": number;
    "5m": number;
  };
  averageSupportBucketUsefulWhenTouchedRate: {
    daily: number;
    "4h": number;
    "5m": number;
  };
  averageSurfacedSupportRespectRate: number;
  averageSurfacedResistanceRespectRate: number;
  averageExtensionSupportRespectRate: number;
  averageExtensionResistanceRespectRate: number;
  byKindSource: {
    surfacedSupport: ForwardReactionSummary;
    surfacedResistance: ForwardReactionSummary;
    extensionSupport: ForwardReactionSummary;
    extensionResistance: ForwardReactionSummary;
  };
  byDistanceBand: Record<ForwardReactionDistanceBand, ForwardReactionSummary>;
  weakestUsefulnessAreas: Array<{
    label: string;
    usefulnessRate: number;
    evaluated: number;
  }>;
  symbolResults: SymbolLevelValidationBatchResult[];
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function symbolHealthStatus(
  result: SymbolLevelValidationBatchResult,
): "healthy" | "degraded" | "unavailable" {
  if (
    result.healthReports.some(
      (report) =>
        (report.timeframe === "daily" || report.timeframe === "4h") &&
        report.status === "unavailable",
    )
  ) {
    return "unavailable";
  }

  if (result.healthReports.some((report) => report.status !== "healthy")) {
    return "degraded";
  }

  return "healthy";
}

function summarizeForward(values: ForwardReactionSummary[]): ForwardReactionSummary {
  return {
    evaluated: Math.round(values.reduce((sum, value) => sum + value.evaluated, 0)),
    touched: Math.round(values.reduce((sum, value) => sum + value.touched, 0)),
    touchRate: average(values.map((value) => value.touchRate)),
    usefulnessRate: average(values.map((value) => value.usefulnessRate)),
    usefulWhenTouchedRate: average(
      values.filter((value) => value.touched > 0).map((value) => value.usefulWhenTouchedRate),
    ),
    respectRate: average(values.map((value) => value.respectRate)),
    partialRespectRate: average(values.map((value) => value.partialRespectRate)),
    breakRate: average(values.map((value) => value.breakRate)),
  };
}

export function summarizeLevelValidationBatch(
  symbolResults: SymbolLevelValidationBatchResult[],
): LevelValidationBatchSummary {
  const completed = symbolResults.filter(
    (result) => result.persistenceReport && result.forwardReactionReport,
  );
  const byKindSource = {
    surfacedSupport: summarizeForward(
      completed.map((result) => result.forwardReactionReport!.byKindSource.surfacedSupport),
    ),
    surfacedResistance: summarizeForward(
      completed.map((result) => result.forwardReactionReport!.byKindSource.surfacedResistance),
    ),
    extensionSupport: summarizeForward(
      completed.map((result) => result.forwardReactionReport!.byKindSource.extensionSupport),
    ),
    extensionResistance: summarizeForward(
      completed.map((result) => result.forwardReactionReport!.byKindSource.extensionResistance),
    ),
  };
  const byDistanceBand = {
    near: summarizeForward(
      completed.map((result) => result.forwardReactionReport!.byDistanceBand.near),
    ),
    intermediate: summarizeForward(
      completed.map((result) => result.forwardReactionReport!.byDistanceBand.intermediate),
    ),
    far: summarizeForward(
      completed.map((result) => result.forwardReactionReport!.byDistanceBand.far),
    ),
  };
  const weakestUsefulnessAreas = [
    { label: "surfacedSupport", ...byKindSource.surfacedSupport },
    { label: "surfacedResistance", ...byKindSource.surfacedResistance },
    { label: "extensionSupport", ...byKindSource.extensionSupport },
    { label: "extensionResistance", ...byKindSource.extensionResistance },
    { label: "near", ...byDistanceBand.near },
    { label: "intermediate", ...byDistanceBand.intermediate },
    { label: "far", ...byDistanceBand.far },
  ]
    .filter((entry) => entry.evaluated > 0)
    .sort(
      (left, right) =>
        left.usefulnessRate - right.usefulnessRate ||
        left.evaluated - right.evaluated ||
        left.label.localeCompare(right.label),
    )
    .slice(0, 3)
    .map((entry) => ({
      label: entry.label,
      usefulnessRate: entry.usefulnessRate,
      evaluated: entry.evaluated,
    }));

  return {
    totalSymbols: symbolResults.length,
    healthySymbols: symbolResults.filter((result) => symbolHealthStatus(result) === "healthy").length,
    degradedSymbols: symbolResults.filter((result) => symbolHealthStatus(result) === "degraded").length,
    unavailableSymbols: symbolResults.filter((result) => symbolHealthStatus(result) === "unavailable").length,
    completedSymbols: completed.length,
    failedSymbols: symbolResults.filter((result) => result.errorMessage).length,
    averageSurfacedSupportPersistenceRate: average(
      completed.map((result) => result.persistenceReport!.averageSupportPersistenceRate),
    ),
    averageSurfacedResistancePersistenceRate: average(
      completed.map((result) => result.persistenceReport!.averageResistancePersistenceRate),
    ),
    averageSupportBucketPersistenceRate: {
      daily: average(
        completed.map(
          (result) => result.persistenceReport!.averageSupportBucketPersistenceRate.daily,
        ),
      ),
      "4h": average(
        completed.map(
          (result) => result.persistenceReport!.averageSupportBucketPersistenceRate["4h"],
        ),
      ),
      "5m": average(
        completed.map(
          (result) => result.persistenceReport!.averageSupportBucketPersistenceRate["5m"],
        ),
      ),
    },
    averageExtensionSupportPersistenceRate: average(
      completed.map((result) => result.persistenceReport!.averageExtensionSupportPersistenceRate),
    ),
    averageExtensionResistancePersistenceRate: average(
      completed.map((result) => result.persistenceReport!.averageExtensionResistancePersistenceRate),
    ),
    averageSupportLooseMatchRate: average(
      completed.map((result) => result.persistenceReport!.averageSupportLooseMatchRate),
    ),
    averageResistanceLooseMatchRate: average(
      completed.map((result) => result.persistenceReport!.averageResistanceLooseMatchRate),
    ),
    averageSupportBucketLooseMatchRate: {
      daily: average(
        completed.map(
          (result) => result.persistenceReport!.averageSupportBucketLooseMatchRate.daily,
        ),
      ),
      "4h": average(
        completed.map(
          (result) => result.persistenceReport!.averageSupportBucketLooseMatchRate["4h"],
        ),
      ),
      "5m": average(
        completed.map(
          (result) => result.persistenceReport!.averageSupportBucketLooseMatchRate["5m"],
        ),
      ),
    },
    averageSurfacedSupportUsefulnessRate: average(
      completed.map((result) => result.forwardReactionReport!.byKindSource.surfacedSupport.usefulnessRate),
    ),
    averageSurfacedResistanceUsefulnessRate: average(
      completed.map((result) => result.forwardReactionReport!.byKindSource.surfacedResistance.usefulnessRate),
    ),
    averageExtensionSupportUsefulnessRate: average(
      completed.map((result) => result.forwardReactionReport!.byKindSource.extensionSupport.usefulnessRate),
    ),
    averageExtensionResistanceUsefulnessRate: average(
      completed.map((result) => result.forwardReactionReport!.byKindSource.extensionResistance.usefulnessRate),
    ),
    averageSurfacedSupportUsefulWhenTouchedRate: average(
      completed.map(
        (result) => result.forwardReactionReport!.byKindSource.surfacedSupport.usefulWhenTouchedRate,
      ),
    ),
    averageSurfacedResistanceUsefulWhenTouchedRate: average(
      completed.map(
        (result) => result.forwardReactionReport!.byKindSource.surfacedResistance.usefulWhenTouchedRate,
      ),
    ),
    averageExtensionSupportUsefulWhenTouchedRate: average(
      completed.map(
        (result) => result.forwardReactionReport!.byKindSource.extensionSupport.usefulWhenTouchedRate,
      ),
    ),
    averageExtensionResistanceUsefulWhenTouchedRate: average(
      completed.map(
        (result) => result.forwardReactionReport!.byKindSource.extensionResistance.usefulWhenTouchedRate,
      ),
    ),
    averageSupportBucketTouchRate: {
      daily: average(
        completed.map((result) => result.forwardReactionReport!.bySurfacedSupportBucket.daily.touchRate),
      ),
      "4h": average(
        completed.map((result) => result.forwardReactionReport!.bySurfacedSupportBucket["4h"].touchRate),
      ),
      "5m": average(
        completed.map((result) => result.forwardReactionReport!.bySurfacedSupportBucket["5m"].touchRate),
      ),
    },
    averageSupportBucketUsefulnessRate: {
      daily: average(
        completed.map(
          (result) => result.forwardReactionReport!.bySurfacedSupportBucket.daily.usefulnessRate,
        ),
      ),
      "4h": average(
        completed.map(
          (result) => result.forwardReactionReport!.bySurfacedSupportBucket["4h"].usefulnessRate,
        ),
      ),
      "5m": average(
        completed.map(
          (result) => result.forwardReactionReport!.bySurfacedSupportBucket["5m"].usefulnessRate,
        ),
      ),
    },
    averageSupportBucketUsefulWhenTouchedRate: {
      daily: average(
        completed.map(
          (result) =>
            result.forwardReactionReport!.bySurfacedSupportBucket.daily.usefulWhenTouchedRate,
        ),
      ),
      "4h": average(
        completed.map(
          (result) =>
            result.forwardReactionReport!.bySurfacedSupportBucket["4h"].usefulWhenTouchedRate,
        ),
      ),
      "5m": average(
        completed.map(
          (result) =>
            result.forwardReactionReport!.bySurfacedSupportBucket["5m"].usefulWhenTouchedRate,
        ),
      ),
    },
    averageSurfacedSupportRespectRate: average(
      completed.map((result) => result.forwardReactionReport!.byKindSource.surfacedSupport.respectRate),
    ),
    averageSurfacedResistanceRespectRate: average(
      completed.map((result) => result.forwardReactionReport!.byKindSource.surfacedResistance.respectRate),
    ),
    averageExtensionSupportRespectRate: average(
      completed.map((result) => result.forwardReactionReport!.byKindSource.extensionSupport.respectRate),
    ),
    averageExtensionResistanceRespectRate: average(
      completed.map((result) => result.forwardReactionReport!.byKindSource.extensionResistance.respectRate),
    ),
    byKindSource,
    byDistanceBand,
    weakestUsefulnessAreas,
    symbolResults,
  };
}

export function formatLevelValidationBatchSummary(
  summary: LevelValidationBatchSummary,
): string[] {
  const lines = [
    `[LevelValidation] Batch summary | symbols=${summary.totalSymbols} | completed=${summary.completedSymbols} | failed=${summary.failedSymbols}`,
    `[LevelValidation] Health summary | healthy=${summary.healthySymbols} | degraded=${summary.degradedSymbols} | unavailable=${summary.unavailableSymbols}`,
    `[LevelValidation] Surfaced persistence | support=${summary.averageSurfacedSupportPersistenceRate.toFixed(4)} | resistance=${summary.averageSurfacedResistancePersistenceRate.toFixed(4)}`,
    `[LevelValidation] Support bucket persistence | daily=${summary.averageSupportBucketPersistenceRate.daily.toFixed(4)} | 4h=${summary.averageSupportBucketPersistenceRate["4h"].toFixed(4)} | 5m=${summary.averageSupportBucketPersistenceRate["5m"].toFixed(4)}`,
    `[LevelValidation] Extension persistence | support=${summary.averageExtensionSupportPersistenceRate.toFixed(4)} | resistance=${summary.averageExtensionResistancePersistenceRate.toFixed(4)}`,
    `[LevelValidation] Surfaced usefulness | support=${summary.averageSurfacedSupportUsefulnessRate.toFixed(4)} | resistance=${summary.averageSurfacedResistanceUsefulnessRate.toFixed(4)}`,
    `[LevelValidation] Extension usefulness | support=${summary.averageExtensionSupportUsefulnessRate.toFixed(4)} | resistance=${summary.averageExtensionResistanceUsefulnessRate.toFixed(4)}`,
    `[LevelValidation] Surfaced useful when touched | support=${summary.averageSurfacedSupportUsefulWhenTouchedRate.toFixed(4)} | resistance=${summary.averageSurfacedResistanceUsefulWhenTouchedRate.toFixed(4)}`,
    `[LevelValidation] Extension useful when touched | support=${summary.averageExtensionSupportUsefulWhenTouchedRate.toFixed(4)} | resistance=${summary.averageExtensionResistanceUsefulWhenTouchedRate.toFixed(4)}`,
    `[LevelValidation] Support bucket usefulness | daily=${summary.averageSupportBucketUsefulnessRate.daily.toFixed(4)} | 4h=${summary.averageSupportBucketUsefulnessRate["4h"].toFixed(4)} | 5m=${summary.averageSupportBucketUsefulnessRate["5m"].toFixed(4)}`,
    `[LevelValidation] Support bucket touch | daily=${summary.averageSupportBucketTouchRate.daily.toFixed(4)} | 4h=${summary.averageSupportBucketTouchRate["4h"].toFixed(4)} | 5m=${summary.averageSupportBucketTouchRate["5m"].toFixed(4)}`,
    `[LevelValidation] Support bucket useful when touched | daily=${summary.averageSupportBucketUsefulWhenTouchedRate.daily.toFixed(4)} | 4h=${summary.averageSupportBucketUsefulWhenTouchedRate["4h"].toFixed(4)} | 5m=${summary.averageSupportBucketUsefulWhenTouchedRate["5m"].toFixed(4)}`,
    `[LevelValidation] Surfaced respect | support=${summary.averageSurfacedSupportRespectRate.toFixed(4)} | resistance=${summary.averageSurfacedResistanceRespectRate.toFixed(4)}`,
    `[LevelValidation] Extension respect | support=${summary.averageExtensionSupportRespectRate.toFixed(4)} | resistance=${summary.averageExtensionResistanceRespectRate.toFixed(4)}`,
    `[LevelValidation] Distance usefulness | near=${summary.byDistanceBand.near.usefulnessRate.toFixed(4)} | intermediate=${summary.byDistanceBand.intermediate.usefulnessRate.toFixed(4)} | far=${summary.byDistanceBand.far.usefulnessRate.toFixed(4)}`,
    `[LevelValidation] Distance touch | near=${summary.byDistanceBand.near.touchRate.toFixed(4)} | intermediate=${summary.byDistanceBand.intermediate.touchRate.toFixed(4)} | far=${summary.byDistanceBand.far.touchRate.toFixed(4)}`,
    `[LevelValidation] Distance useful when touched | near=${summary.byDistanceBand.near.usefulWhenTouchedRate.toFixed(4)} | intermediate=${summary.byDistanceBand.intermediate.usefulWhenTouchedRate.toFixed(4)} | far=${summary.byDistanceBand.far.usefulWhenTouchedRate.toFixed(4)}`,
    `[LevelValidation] Loose persistence matches | support=${summary.averageSupportLooseMatchRate.toFixed(4)} | resistance=${summary.averageResistanceLooseMatchRate.toFixed(4)}`,
    `[LevelValidation] Support bucket loose matches | daily=${summary.averageSupportBucketLooseMatchRate.daily.toFixed(4)} | 4h=${summary.averageSupportBucketLooseMatchRate["4h"].toFixed(4)} | 5m=${summary.averageSupportBucketLooseMatchRate["5m"].toFixed(4)}`,
    `[LevelValidation] Weakest usefulness areas | ${summary.weakestUsefulnessAreas
      .map((entry) => `${entry.label}=${entry.usefulnessRate.toFixed(4)}(${entry.evaluated})`)
      .join(" | ")}`,
  ];

  for (const result of summary.symbolResults) {
    const healthStatus = symbolHealthStatus(result);
    const persistence = result.persistenceReport
      ? `surfacedPersist=${result.persistenceReport.averageSupportPersistenceRate.toFixed(4)}/${result.persistenceReport.averageResistancePersistenceRate.toFixed(4)} | supportBuckets=${result.persistenceReport.averageSupportBucketPersistenceRate.daily.toFixed(4)}/${result.persistenceReport.averageSupportBucketPersistenceRate["4h"].toFixed(4)}/${result.persistenceReport.averageSupportBucketPersistenceRate["5m"].toFixed(4)} | extensionPersist=${result.persistenceReport.averageExtensionSupportPersistenceRate.toFixed(4)}/${result.persistenceReport.averageExtensionResistancePersistenceRate.toFixed(4)} | loose=${result.persistenceReport.averageSupportLooseMatchRate.toFixed(4)}/${result.persistenceReport.averageResistanceLooseMatchRate.toFixed(4)} | supportBucketLoose=${result.persistenceReport.averageSupportBucketLooseMatchRate.daily.toFixed(4)}/${result.persistenceReport.averageSupportBucketLooseMatchRate["4h"].toFixed(4)}/${result.persistenceReport.averageSupportBucketLooseMatchRate["5m"].toFixed(4)}`
      : "persistence=unavailable";
    const forward = result.forwardReactionReport
      ? `surfacedUseful=${result.forwardReactionReport.byKindSource.surfacedSupport.usefulnessRate.toFixed(4)}/${result.forwardReactionReport.byKindSource.surfacedResistance.usefulnessRate.toFixed(4)} | surfacedTouchedUseful=${result.forwardReactionReport.byKindSource.surfacedSupport.usefulWhenTouchedRate.toFixed(4)}/${result.forwardReactionReport.byKindSource.surfacedResistance.usefulWhenTouchedRate.toFixed(4)} | supportBucketUseful=${result.forwardReactionReport.bySurfacedSupportBucket.daily.usefulnessRate.toFixed(4)}/${result.forwardReactionReport.bySurfacedSupportBucket["4h"].usefulnessRate.toFixed(4)}/${result.forwardReactionReport.bySurfacedSupportBucket["5m"].usefulnessRate.toFixed(4)} | supportBucketTouch=${result.forwardReactionReport.bySurfacedSupportBucket.daily.touchRate.toFixed(4)}/${result.forwardReactionReport.bySurfacedSupportBucket["4h"].touchRate.toFixed(4)}/${result.forwardReactionReport.bySurfacedSupportBucket["5m"].touchRate.toFixed(4)} | extensionUseful=${result.forwardReactionReport.byKindSource.extensionSupport.usefulnessRate.toFixed(4)}/${result.forwardReactionReport.byKindSource.extensionResistance.usefulnessRate.toFixed(4)} | bands=${result.forwardReactionReport.byDistanceBand.near.usefulnessRate.toFixed(4)}/${result.forwardReactionReport.byDistanceBand.intermediate.usefulnessRate.toFixed(4)}/${result.forwardReactionReport.byDistanceBand.far.usefulnessRate.toFixed(4)} | bandTouch=${result.forwardReactionReport.byDistanceBand.near.touchRate.toFixed(4)}/${result.forwardReactionReport.byDistanceBand.intermediate.touchRate.toFixed(4)}/${result.forwardReactionReport.byDistanceBand.far.touchRate.toFixed(4)}`
      : "forward=unavailable";
    const failure = result.errorMessage ? ` | error=${result.errorMessage}` : "";

    lines.push(
      `[LevelValidation] Symbol ${result.symbol} | health=${healthStatus} | ${persistence} | ${forward}${failure}`,
    );
  }

  return lines;
}
