import {
  buildLevelIntelligenceReport,
  type LevelIntelligenceReport,
} from "../levels/level-intelligence-report.js";
import {
  buildLevelQualityAuditReport,
  type LevelQualityAuditReport,
} from "../levels/level-quality-audit-runner.js";
import type { FinalLevelZone, LevelEngineOutput } from "../levels/level-types.js";
import type { Candle } from "../market-data/candle-types.js";
import {
  buildMarketContextFactsBundle,
  type MarketContextFactsBundle,
  type MarketContextProfile,
} from "../market-context/index.js";
import type { SessionMarketFacts } from "../session/index.js";
import type { VolumeMarketFacts, VolumeShelf } from "../volume/index.js";

export type LevelAnalysisSnapshotCandleInputs = {
  fiveMinute?: Candle[];
  fifteenMinute?: Candle[];
  fourHour?: Candle[];
  daily?: Candle[];
};

export type LevelAnalysisSnapshotSafety = {
  noLookaheadApplied: boolean;
  levelOutputUnchanged: true;
  factsOnlyVWAP: true;
  shelvesAreFactsOnly: true;
  syntheticExtensionsClearlyMarked: boolean;
  noRuntimeBehaviorChange: true;
};

export type LevelAnalysisSnapshot = {
  symbol: string;
  asOfTimestamp: number;
  referencePrice?: number;
  levelEngineOutput: LevelEngineOutput;
  sessionFacts?: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  volumeShelves?: VolumeShelf[];
  marketContext?: MarketContextProfile;
  factsBundle?: MarketContextFactsBundle;
  levelIntelligenceReport: LevelIntelligenceReport;
  levelQualityAudit: LevelQualityAuditReport;
  diagnostics: string[];
  safety: LevelAnalysisSnapshotSafety;
};

export type BuildLevelAnalysisSnapshotRequest = {
  symbol: string;
  asOfTimestamp: number;
  referencePrice?: number;
  levelEngineOutput: LevelEngineOutput;
  closedCandles?: LevelAnalysisSnapshotCandleInputs;
  sessionFacts?: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  volumeShelves?: VolumeShelf[];
  marketContext?: MarketContextProfile;
  factsBundle?: MarketContextFactsBundle;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function isUsableNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function resolveReferencePrice(request: BuildLevelAnalysisSnapshotRequest): number | undefined {
  return [
    request.referencePrice,
    request.levelEngineOutput.metadata.referencePrice,
    request.factsBundle?.referencePrice,
    request.sessionFacts?.currentPrice,
  ].find(isUsableNumber);
}

function resolveSessionFacts(request: BuildLevelAnalysisSnapshotRequest): SessionMarketFacts | undefined {
  return request.sessionFacts ?? request.factsBundle?.sessionFacts;
}

function resolveVolumeFacts(request: BuildLevelAnalysisSnapshotRequest): VolumeMarketFacts | undefined {
  return request.volumeFacts ?? request.factsBundle?.volumeFacts;
}

function resolveVolumeShelves(request: BuildLevelAnalysisSnapshotRequest): VolumeShelf[] | undefined {
  return request.volumeShelves ?? request.factsBundle?.volumeShelves;
}

function resolveFactsBundle(params: {
  request: BuildLevelAnalysisSnapshotRequest;
  symbol: string;
  referencePrice?: number;
  sessionFacts?: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  volumeShelves?: VolumeShelf[];
}): MarketContextFactsBundle | undefined {
  if (params.request.factsBundle) {
    return params.request.factsBundle;
  }

  if (!params.sessionFacts || !params.volumeFacts) {
    return undefined;
  }

  return buildMarketContextFactsBundle({
    symbol: params.symbol,
    asOfTimestamp: params.request.asOfTimestamp,
    referencePrice: params.referencePrice,
    sessionFacts: params.sessionFacts,
    volumeFacts: params.volumeFacts,
    volumeShelves: params.volumeShelves ?? [],
  });
}

function allExtensionLevels(output: LevelEngineOutput): FinalLevelZone[] {
  return [...output.extensionLevels.support, ...output.extensionLevels.resistance];
}

function syntheticExtensionsClearlyMarked(output: LevelEngineOutput): boolean {
  const syntheticExtensions = allExtensionLevels(output).filter(
    (level) => level.extensionMetadata?.extensionSource === "synthetic_continuation_map",
  );

  return syntheticExtensions.every((level) => {
    const notes = level.notes.join(" ").toLowerCase();
    const limitations = level.extensionMetadata?.evidenceLimitations ?? [];
    return (
      level.isExtension === true &&
      level.touchCount === 0 &&
      level.confluenceCount === 0 &&
      notes.includes("synthetic") &&
      notes.includes("continuation") &&
      notes.includes("not historical support/resistance") &&
      limitations.includes("not_historical_support_resistance") &&
      limitations.includes("no_touch_or_rejection_history")
    );
  });
}

function timestampIsAsOfSafe(timestamp: number | undefined, asOfTimestamp: number): boolean {
  return timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= asOfTimestamp;
}

function noLookaheadApplied(params: {
  request: BuildLevelAnalysisSnapshotRequest;
  sessionFacts?: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  factsBundle?: MarketContextFactsBundle;
}): boolean {
  const asOfTimestamp = params.request.asOfTimestamp;
  return [
    params.request.levelEngineOutput.generatedAt,
    params.sessionFacts?.asOfTimestamp,
    params.volumeFacts?.asOfTimestamp,
    params.factsBundle?.asOfTimestamp,
  ].every((timestamp) => timestampIsAsOfSafe(timestamp, asOfTimestamp));
}

function buildDiagnostics(params: {
  request: BuildLevelAnalysisSnapshotRequest;
  symbol: string;
  sessionFacts?: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  factsBundle?: MarketContextFactsBundle;
  noLookaheadApplied: boolean;
  syntheticExtensionsClearlyMarked: boolean;
}): string[] {
  const diagnostics = new Set<string>();

  if (normalizeSymbol(params.request.levelEngineOutput.symbol) !== params.symbol) {
    diagnostics.add("symbol_mismatch");
  }

  if (!params.noLookaheadApplied) {
    diagnostics.add("as_of_boundary_warning");
  }

  if (!params.syntheticExtensionsClearlyMarked) {
    diagnostics.add("synthetic_extension_marking_incomplete");
  }

  if (!params.sessionFacts) {
    diagnostics.add("session_facts_missing");
  }

  if (!params.volumeFacts) {
    diagnostics.add("volume_facts_missing");
  }

  if (!params.factsBundle) {
    diagnostics.add("facts_bundle_missing");
  }

  if (params.request.closedCandles) {
    diagnostics.add("candle_inputs_reserved_for_future_fact_generation");
  }

  return [...diagnostics].sort();
}

export function buildLevelAnalysisSnapshot(
  request: BuildLevelAnalysisSnapshotRequest,
): LevelAnalysisSnapshot {
  const symbol = normalizeSymbol(request.symbol);
  const referencePrice = resolveReferencePrice(request);
  const sessionFacts = resolveSessionFacts(request);
  const volumeFacts = resolveVolumeFacts(request);
  const volumeShelves = resolveVolumeShelves(request);
  const factsBundle = resolveFactsBundle({
    request,
    symbol,
    referencePrice,
    sessionFacts,
    volumeFacts,
    volumeShelves,
  });
  const levelIntelligenceReport = buildLevelIntelligenceReport({
    output: request.levelEngineOutput,
    referencePrice,
    sessionFacts,
    volumeFacts,
    volumeShelves,
    marketContext: request.marketContext,
    factsBundle,
  });
  const levelQualityAudit = buildLevelQualityAuditReport({
    output: request.levelEngineOutput,
    intelligenceReport: levelIntelligenceReport,
  });
  const syntheticMarked = syntheticExtensionsClearlyMarked(request.levelEngineOutput);
  const lookaheadSafe = noLookaheadApplied({
    request,
    sessionFacts,
    volumeFacts,
    factsBundle,
  });
  const diagnostics = buildDiagnostics({
    request,
    symbol,
    sessionFacts,
    volumeFacts,
    factsBundle,
    noLookaheadApplied: lookaheadSafe,
    syntheticExtensionsClearlyMarked: syntheticMarked,
  });

  const snapshot: LevelAnalysisSnapshot = {
    symbol,
    asOfTimestamp: request.asOfTimestamp,
    levelEngineOutput: clone(request.levelEngineOutput),
    levelIntelligenceReport,
    levelQualityAudit,
    diagnostics,
    safety: {
      noLookaheadApplied: lookaheadSafe,
      levelOutputUnchanged: true,
      factsOnlyVWAP: true,
      shelvesAreFactsOnly: true,
      syntheticExtensionsClearlyMarked: syntheticMarked,
      noRuntimeBehaviorChange: true,
    },
  };

  if (referencePrice !== undefined) {
    snapshot.referencePrice = referencePrice;
  }
  if (sessionFacts) {
    snapshot.sessionFacts = clone(sessionFacts);
  }
  if (volumeFacts) {
    snapshot.volumeFacts = clone(volumeFacts);
  }
  if (volumeShelves) {
    snapshot.volumeShelves = clone(volumeShelves);
  }
  if (request.marketContext) {
    snapshot.marketContext = clone(request.marketContext);
  }
  if (factsBundle) {
    snapshot.factsBundle = clone(factsBundle);
  }

  return snapshot;
}
