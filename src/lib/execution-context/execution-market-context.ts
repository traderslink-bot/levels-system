import type { LevelEngineOutput, FinalLevelZone, EnrichedLevelAnalysis } from "../levels/level-types.js";
import type { MarketContextProfile, MarketContextFactsBundle } from "../market-context/index.js";
import type { SessionMarketFacts } from "../session/index.js";
import type { VolumeMarketFacts, VolumeShelf } from "../volume/index.js";

export type ExecutionSide = "buy" | "sell";

export type ExecutionTradeLocationLabel =
  | "near_support"
  | "near_resistance"
  | "middle_of_range"
  | "above_resistance"
  | "below_support"
  | "breakout_area"
  | "breakdown_area"
  | "extended_above_vwap"
  | "below_vwap"
  | "chop_zone"
  | "unknown";

export type ExecutionLevelRoleAtExecution =
  | "entry_area"
  | "breakout_trigger"
  | "profit_target"
  | "invalidation_area"
  | "avoid_chop_zone"
  | "context_only";

export type ExecutionContextDiagnosticCode =
  | "symbol_mismatch"
  | "as_of_after_execution"
  | "missing_support_below"
  | "missing_resistance_above"
  | "vwap_facts_only"
  | "volume_shelves_facts_only";

export type ExecutionContextDiagnostic = {
  code: ExecutionContextDiagnosticCode;
  severity: "info" | "warning";
  message: string;
};

export type ExecutionInput = {
  symbol: string;
  executionId: string;
  executionTimestamp: number;
  side: ExecutionSide;
  price: number;
  shares?: number;
  asOfTimestamp?: number;
};

export type ExecutionLevelSnapshot = {
  id: string;
  kind: "support" | "resistance";
  representativePrice: number;
  zoneLow: number;
  zoneHigh: number;
  distanceFromExecutionPct: number;
  strengthScore: number;
  strengthLabel: "weak" | "moderate" | "strong" | "major";
  freshness: "fresh" | "aging" | "stale";
  timeframeBias: "daily" | "4h" | "5m" | "mixed";
  sourceTypes: string[];
  timeframeSources: string[];
  isExtension: boolean;
  enrichedAnalysis?: EnrichedLevelAnalysis;
  roleAtExecution: ExecutionLevelRoleAtExecution;
  reason: string;
};

export type ExecutionTradeLocation = {
  label: ExecutionTradeLocationLabel;
  confidence: number;
  evidence: string[];
};

export type ExecutionRiskContext = {
  nearestInvalidationLevel: number | null;
  distanceToInvalidationPct: number | null;
  nearestTargetLevel: number | null;
  distanceToTargetPct: number | null;
  riskRewardToNearestTarget?: number | null;
  hasDefinedRisk: boolean;
  reason: string;
};

export type ExecutionMarketContextSnapshot = {
  symbol: string;
  executionId: string;
  executionTimestamp: number;
  side: ExecutionSide;
  price: number;
  shares?: number;
  asOfTimestamp: number;
  nearestSupport: ExecutionLevelSnapshot | null;
  nearestResistance: ExecutionLevelSnapshot | null;
  sessionFacts?: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  volumeShelves?: VolumeShelf[];
  marketContext?: MarketContextProfile;
  factsBundle?: MarketContextFactsBundle;
  tradeLocation: ExecutionTradeLocation;
  riskContext: ExecutionRiskContext;
  diagnostics: ExecutionContextDiagnostic[];
  safety: {
    noLookaheadApplied: true;
    partialCandlesExcluded: boolean;
    futureCandlesExcluded: boolean;
    levelOutputUnchanged: true;
    factsOnlyVWAP: true;
    shelvesFactsOnly: true;
  };
};

export type BuildExecutionMarketContextSnapshotRequest = {
  execution: ExecutionInput;
  levelOutput: LevelEngineOutput;
  sessionFacts?: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  volumeShelves?: VolumeShelf[];
  marketContext?: MarketContextProfile;
  factsBundle?: MarketContextFactsBundle;
  nearLevelThresholdPct?: number;
  extendedFromVwapThresholdPct?: number;
};

const DEFAULT_NEAR_LEVEL_THRESHOLD_PCT = 1;
const DEFAULT_EXTENDED_FROM_VWAP_THRESHOLD_PCT = 8;

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function pctDistance(from: number, to: number): number {
  if (!Number.isFinite(from) || from === 0 || !Number.isFinite(to)) {
    return 0;
  }

  return round((Math.abs(to - from) / Math.abs(from)) * 100);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function allLevelZones(output: LevelEngineOutput): FinalLevelZone[] {
  return [
    ...output.majorSupport,
    ...output.majorResistance,
    ...output.intermediateSupport,
    ...output.intermediateResistance,
    ...output.intradaySupport,
    ...output.intradayResistance,
    ...output.extensionLevels.support,
    ...output.extensionLevels.resistance,
  ];
}

function distanceSort(executionPrice: number) {
  return (left: FinalLevelZone, right: FinalLevelZone): number => {
    const leftDistance = Math.abs(left.representativePrice - executionPrice);
    const rightDistance = Math.abs(right.representativePrice - executionPrice);
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    return right.strengthScore - left.strengthScore;
  };
}

export function findNearestSupportLevel(
  levelOutput: LevelEngineOutput,
  executionPrice: number,
): FinalLevelZone | null {
  return (
    allLevelZones(levelOutput)
      .filter((zone) => zone.kind === "support")
      .filter((zone) => zone.representativePrice <= executionPrice || zone.zoneLow <= executionPrice)
      .sort(distanceSort(executionPrice))[0] ?? null
  );
}

export function findNearestResistanceLevel(
  levelOutput: LevelEngineOutput,
  executionPrice: number,
): FinalLevelZone | null {
  return (
    allLevelZones(levelOutput)
      .filter((zone) => zone.kind === "resistance")
      .filter((zone) => zone.representativePrice >= executionPrice || zone.zoneHigh >= executionPrice)
      .sort(distanceSort(executionPrice))[0] ?? null
  );
}

function highestResistanceBelow(levelOutput: LevelEngineOutput, executionPrice: number): FinalLevelZone | null {
  return (
    allLevelZones(levelOutput)
      .filter((zone) => zone.kind === "resistance")
      .filter((zone) => zone.zoneHigh < executionPrice)
      .sort((left, right) => right.zoneHigh - left.zoneHigh)[0] ?? null
  );
}

function lowestSupportAbove(levelOutput: LevelEngineOutput, executionPrice: number): FinalLevelZone | null {
  return (
    allLevelZones(levelOutput)
      .filter((zone) => zone.kind === "support")
      .filter((zone) => zone.zoneLow > executionPrice)
      .sort((left, right) => left.zoneLow - right.zoneLow)[0] ?? null
  );
}

export function buildExecutionLevelSnapshot(
  zone: FinalLevelZone,
  executionPrice: number,
  roleAtExecution: ExecutionLevelRoleAtExecution = "context_only",
): ExecutionLevelSnapshot {
  return {
    id: zone.id,
    kind: zone.kind,
    representativePrice: zone.representativePrice,
    zoneLow: zone.zoneLow,
    zoneHigh: zone.zoneHigh,
    distanceFromExecutionPct: pctDistance(executionPrice, zone.representativePrice),
    strengthScore: zone.strengthScore,
    strengthLabel: zone.strengthLabel,
    freshness: zone.freshness,
    timeframeBias: zone.timeframeBias,
    sourceTypes: [...zone.sourceTypes],
    timeframeSources: [...zone.timeframeSources],
    isExtension: zone.isExtension,
    enrichedAnalysis: zone.enrichedAnalysis ? clone(zone.enrichedAnalysis) : undefined,
    roleAtExecution,
    reason: `${zone.kind} ${zone.strengthLabel} level is ${pctDistance(
      executionPrice,
      zone.representativePrice,
    )}% from the execution price.`,
  };
}

function hasExcludedDiagnostic(
  diagnostics: Array<{ code: string; excludedCount?: number }>,
  code: "future_candles_filtered" | "partial_candles_filtered",
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.code === code && (diagnostic.excludedCount ?? 0) > 0);
}

function factDiagnostics(request: BuildExecutionMarketContextSnapshotRequest): Array<{ code: string; excludedCount?: number }> {
  return [
    ...(request.sessionFacts?.diagnostics ?? []),
    ...(request.volumeFacts?.diagnostics ?? []),
    ...(request.factsBundle?.diagnostics.sessionDiagnostics ?? []),
    ...(request.factsBundle?.diagnostics.volumeDiagnostics ?? []),
  ];
}

function shelfContainsPrice(shelf: VolumeShelf, executionPrice: number): boolean {
  return shelf.zoneLow <= executionPrice && shelf.zoneHigh >= executionPrice;
}

function combinedShelves(request: BuildExecutionMarketContextSnapshotRequest): VolumeShelf[] {
  const shelves = [...(request.volumeShelves ?? []), ...(request.factsBundle?.volumeShelves ?? [])];
  const byId = new Map<string, VolumeShelf>();

  for (const shelf of shelves) {
    byId.set(shelf.id, shelf);
  }

  return [...byId.values()];
}

function buildTradeLocation(
  request: BuildExecutionMarketContextSnapshotRequest,
  nearestSupport: ExecutionLevelSnapshot | null,
  nearestResistance: ExecutionLevelSnapshot | null,
): ExecutionTradeLocation {
  const threshold = Math.max(0, request.nearLevelThresholdPct ?? DEFAULT_NEAR_LEVEL_THRESHOLD_PCT);
  const executionPrice = request.execution.price;
  const supportDistance = nearestSupport?.distanceFromExecutionPct;
  const resistanceDistance = nearestResistance?.distanceFromExecutionPct;
  const shelves = combinedShelves(request);
  const chopShelf = shelves.find((shelf) => shelf.shelfRole === "chop_zone" && shelfContainsPrice(shelf, executionPrice));

  if (chopShelf) {
    return {
      label: "chop_zone",
      confidence: 0.72,
      evidence: [`Execution price is inside facts-only volume shelf ${chopShelf.id} labeled chop_zone.`],
    };
  }

  if (nearestSupport && supportDistance !== undefined && supportDistance <= threshold) {
    return {
      label: "near_support",
      confidence: 0.78,
      evidence: [`Execution price is ${supportDistance}% from nearest supplied support ${nearestSupport.id}.`],
    };
  }

  if (nearestResistance && resistanceDistance !== undefined && resistanceDistance <= threshold) {
    return {
      label: "near_resistance",
      confidence: 0.78,
      evidence: [`Execution price is ${resistanceDistance}% from nearest supplied resistance ${nearestResistance.id}.`],
    };
  }

  const crossedResistance = highestResistanceBelow(request.levelOutput, executionPrice);
  if (crossedResistance && pctDistance(executionPrice, crossedResistance.zoneHigh) <= threshold) {
    return {
      label: "breakout_area",
      confidence: 0.66,
      evidence: [`Execution price is just above supplied resistance ${crossedResistance.id}.`],
    };
  }

  const crossedSupport = lowestSupportAbove(request.levelOutput, executionPrice);
  if (crossedSupport && pctDistance(executionPrice, crossedSupport.zoneLow) <= threshold) {
    return {
      label: "breakdown_area",
      confidence: 0.66,
      evidence: [`Execution price is just below supplied support ${crossedSupport.id}.`],
    };
  }

  if (!nearestResistance && crossedResistance) {
    return {
      label: "above_resistance",
      confidence: 0.62,
      evidence: ["Execution price is above all supplied resistance zones."],
    };
  }

  if (!nearestSupport && crossedSupport) {
    return {
      label: "below_support",
      confidence: 0.62,
      evidence: ["Execution price is below all supplied support zones."],
    };
  }

  const percentFromVWAP =
    request.sessionFacts?.percentFromVWAP ??
    request.factsBundle?.sessionFacts.percentFromVWAP ??
    request.marketContext?.facts.percentFromVWAP;
  const aboveVWAP =
    request.sessionFacts?.aboveVWAP ??
    request.factsBundle?.sessionFacts.aboveVWAP ??
    request.marketContext?.facts.aboveVWAP;

  if (
    percentFromVWAP !== undefined &&
    percentFromVWAP >= (request.extendedFromVwapThresholdPct ?? DEFAULT_EXTENDED_FROM_VWAP_THRESHOLD_PCT)
  ) {
    return {
      label: "extended_above_vwap",
      confidence: 0.58,
      evidence: [`Execution price is ${percentFromVWAP}% above VWAP as a market fact.`],
    };
  }

  if (aboveVWAP === false) {
    return {
      label: "below_vwap",
      confidence: 0.58,
      evidence: ["Execution price is below VWAP as a market fact."],
    };
  }

  if (nearestSupport && nearestResistance) {
    return {
      label: "middle_of_range",
      confidence: 0.54,
      evidence: ["Execution price is between supplied nearest support and resistance."],
    };
  }

  return {
    label: "unknown",
    confidence: 0.35,
    evidence: ["Supplied facts did not identify a deterministic trade location label."],
  };
}

function buildRiskContext(
  side: ExecutionSide,
  price: number,
  nearestSupport: ExecutionLevelSnapshot | null,
  nearestResistance: ExecutionLevelSnapshot | null,
): ExecutionRiskContext {
  const invalidation = side === "buy" ? nearestSupport : nearestResistance;
  const target = side === "buy" ? nearestResistance : nearestSupport;
  const distanceToInvalidationPct = invalidation ? pctDistance(price, invalidation.representativePrice) : null;
  const distanceToTargetPct = target ? pctDistance(price, target.representativePrice) : null;
  const riskRewardToNearestTarget =
    distanceToInvalidationPct && distanceToTargetPct && distanceToInvalidationPct > 0
      ? round(distanceToTargetPct / distanceToInvalidationPct)
      : null;

  return {
    nearestInvalidationLevel: invalidation?.representativePrice ?? null,
    distanceToInvalidationPct,
    nearestTargetLevel: target?.representativePrice ?? null,
    distanceToTargetPct,
    riskRewardToNearestTarget,
    hasDefinedRisk: invalidation !== null,
    reason:
      side === "buy"
        ? "Long-side factual context uses nearest supplied support as invalidation and nearest supplied resistance as target."
        : "Sell-side factual context uses nearest supplied resistance above and support below as surrounding level context.",
  };
}

function buildDiagnostics(
  request: BuildExecutionMarketContextSnapshotRequest,
  nearestSupport: ExecutionLevelSnapshot | null,
  nearestResistance: ExecutionLevelSnapshot | null,
): ExecutionContextDiagnostic[] {
  const diagnostics: ExecutionContextDiagnostic[] = [];
  const executionSymbol = request.execution.symbol.toUpperCase();

  if (request.levelOutput.symbol.toUpperCase() !== executionSymbol) {
    diagnostics.push({
      code: "symbol_mismatch",
      severity: "warning",
      message: "Supplied LevelEngineOutput symbol differs from the execution symbol.",
    });
  }
  if ((request.sessionFacts?.symbol ?? request.factsBundle?.symbol)?.toUpperCase() !== undefined) {
    const factsSymbol = (request.sessionFacts?.symbol ?? request.factsBundle?.symbol)!.toUpperCase();
    if (factsSymbol !== executionSymbol) {
      diagnostics.push({
        code: "symbol_mismatch",
        severity: "warning",
        message: "Supplied market facts symbol differs from the execution symbol.",
      });
    }
  }
  if ((request.execution.asOfTimestamp ?? request.execution.executionTimestamp) > request.execution.executionTimestamp) {
    diagnostics.push({
      code: "as_of_after_execution",
      severity: "warning",
      message: "Execution context as-of timestamp is after the execution timestamp.",
    });
  }
  if (!nearestSupport) {
    diagnostics.push({
      code: "missing_support_below",
      severity: "info",
      message: "No supplied support level was found below or near the execution price.",
    });
  }
  if (!nearestResistance) {
    diagnostics.push({
      code: "missing_resistance_above",
      severity: "info",
      message: "No supplied resistance level was found above or near the execution price.",
    });
  }
  if (request.sessionFacts?.vwap !== undefined || request.factsBundle?.sessionFacts.vwap !== undefined) {
    diagnostics.push({
      code: "vwap_facts_only",
      severity: "info",
      message: "VWAP was carried as a market fact only and did not change runtime behavior.",
    });
  }
  if (combinedShelves(request).length > 0) {
    diagnostics.push({
      code: "volume_shelves_facts_only",
      severity: "info",
      message: "Volume shelves were carried as facts only and were not converted into support/resistance levels.",
    });
  }

  return diagnostics;
}

export function buildExecutionMarketContextSnapshot(
  request: BuildExecutionMarketContextSnapshotRequest,
): ExecutionMarketContextSnapshot {
  const execution = request.execution;
  const asOfTimestamp = execution.asOfTimestamp ?? execution.executionTimestamp;
  const supportZone = findNearestSupportLevel(request.levelOutput, execution.price);
  const resistanceZone = findNearestResistanceLevel(request.levelOutput, execution.price);
  const nearestSupport = supportZone
    ? buildExecutionLevelSnapshot(supportZone, execution.price, execution.side === "buy" ? "invalidation_area" : "profit_target")
    : null;
  const nearestResistance = resistanceZone
    ? buildExecutionLevelSnapshot(resistanceZone, execution.price, execution.side === "buy" ? "profit_target" : "invalidation_area")
    : null;
  const factDiagnosticList = factDiagnostics(request);
  const snapshot: ExecutionMarketContextSnapshot = {
    symbol: execution.symbol.toUpperCase(),
    executionId: execution.executionId,
    executionTimestamp: execution.executionTimestamp,
    side: execution.side,
    price: execution.price,
    shares: execution.shares,
    asOfTimestamp,
    nearestSupport,
    nearestResistance,
    sessionFacts: request.sessionFacts ? clone(request.sessionFacts) : undefined,
    volumeFacts: request.volumeFacts ? clone(request.volumeFacts) : undefined,
    volumeShelves: request.volumeShelves ? clone(request.volumeShelves) : undefined,
    marketContext: request.marketContext ? clone(request.marketContext) : undefined,
    factsBundle: request.factsBundle ? clone(request.factsBundle) : undefined,
    tradeLocation: buildTradeLocation(request, nearestSupport, nearestResistance),
    riskContext: buildRiskContext(execution.side, execution.price, nearestSupport, nearestResistance),
    diagnostics: buildDiagnostics(request, nearestSupport, nearestResistance),
    safety: {
      noLookaheadApplied: true,
      partialCandlesExcluded:
        hasExcludedDiagnostic(factDiagnosticList, "partial_candles_filtered") ||
        (request.factsBundle?.diagnostics.partialCandlesExcluded ?? 0) > 0,
      futureCandlesExcluded:
        hasExcludedDiagnostic(factDiagnosticList, "future_candles_filtered") ||
        (request.factsBundle?.diagnostics.futureCandlesExcluded ?? 0) > 0,
      levelOutputUnchanged: true,
      factsOnlyVWAP: true,
      shelvesFactsOnly: true,
    },
  };

  return snapshot;
}
