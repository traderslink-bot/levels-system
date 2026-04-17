import type { CandleSourceHealthReport } from "./candle-source-health.js";
import type { ForwardReactionValidationReport } from "./forward-reaction-validator.js";
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
  averageSurfacedResistancePersistenceRate: number;
  averageExtensionResistancePersistenceRate: number;
  averageSurfacedRespectRate: number;
  averageExtensionRespectRate: number;
  symbolResults: SymbolLevelValidationBatchResult[];
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function symbolHealthStatus(result: SymbolLevelValidationBatchResult): "healthy" | "degraded" | "unavailable" {
  if (result.healthReports.some((report) => report.status === "unavailable")) {
    return "unavailable";
  }

  if (result.healthReports.some((report) => report.status === "degraded")) {
    return "degraded";
  }

  return "healthy";
}

export function summarizeLevelValidationBatch(
  symbolResults: SymbolLevelValidationBatchResult[],
): LevelValidationBatchSummary {
  const completed = symbolResults.filter(
    (result) => result.persistenceReport && result.forwardReactionReport,
  );

  return {
    totalSymbols: symbolResults.length,
    healthySymbols: symbolResults.filter((result) => symbolHealthStatus(result) === "healthy").length,
    degradedSymbols: symbolResults.filter((result) => symbolHealthStatus(result) === "degraded").length,
    unavailableSymbols: symbolResults.filter((result) => symbolHealthStatus(result) === "unavailable").length,
    completedSymbols: completed.length,
    failedSymbols: symbolResults.filter((result) => result.errorMessage).length,
    averageSurfacedResistancePersistenceRate: average(
      completed.map((result) => result.persistenceReport!.averageResistancePersistenceRate),
    ),
    averageExtensionResistancePersistenceRate: average(
      completed.map((result) => result.persistenceReport!.averageExtensionResistancePersistenceRate),
    ),
    averageSurfacedRespectRate: average(
      completed.map((result) => result.forwardReactionReport!.surfacedRespectRate),
    ),
    averageExtensionRespectRate: average(
      completed.map((result) => result.forwardReactionReport!.extensionRespectRate),
    ),
    symbolResults,
  };
}

export function formatLevelValidationBatchSummary(
  summary: LevelValidationBatchSummary,
): string[] {
  const lines = [
    `[LevelValidation] Batch summary | symbols=${summary.totalSymbols} | completed=${summary.completedSymbols} | failed=${summary.failedSymbols}`,
    `[LevelValidation] Health summary | healthy=${summary.healthySymbols} | degraded=${summary.degradedSymbols} | unavailable=${summary.unavailableSymbols}`,
    `[LevelValidation] Persistence summary | surfacedResistance=${summary.averageSurfacedResistancePersistenceRate.toFixed(4)} | extensionResistance=${summary.averageExtensionResistancePersistenceRate.toFixed(4)}`,
    `[LevelValidation] Forward summary | surfacedRespect=${summary.averageSurfacedRespectRate.toFixed(4)} | extensionRespect=${summary.averageExtensionRespectRate.toFixed(4)}`,
  ];

  for (const result of summary.symbolResults) {
    const healthStatus = result.healthReports.some((report) => report.status === "unavailable")
      ? "unavailable"
      : result.healthReports.some((report) => report.status === "degraded")
        ? "degraded"
        : "healthy";
    const persistence = result.persistenceReport
      ? `surfacedResistance=${result.persistenceReport.averageResistancePersistenceRate.toFixed(4)} | extensionResistance=${result.persistenceReport.averageExtensionResistancePersistenceRate.toFixed(4)}`
      : "persistence=unavailable";
    const forward = result.forwardReactionReport
      ? `surfacedRespect=${result.forwardReactionReport.surfacedRespectRate.toFixed(4)} | extensionRespect=${result.forwardReactionReport.extensionRespectRate.toFixed(4)}`
      : "forward=unavailable";
    const failure = result.errorMessage ? ` | error=${result.errorMessage}` : "";

    lines.push(
      `[LevelValidation] Symbol ${result.symbol} | health=${healthStatus} | ${persistence} | ${forward}${failure}`,
    );
  }

  return lines;
}
