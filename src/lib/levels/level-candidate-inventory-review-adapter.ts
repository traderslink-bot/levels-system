import {
  assertLevelCandidateInventoryVisibilityFactsOnly,
  summarizeLevelCandidateInventoryGaps,
  validateLevelCandidateInventoryVisibility,
  type LevelCandidateInventoryGapClassification,
  type LevelCandidateInventoryNearest,
  type LevelCandidateInventorySide,
  type LevelCandidateInventoryStage,
  type LevelCandidateInventoryStageSummary,
  type LevelCandidateInventoryUnsurfacedCloserSummary,
  type LevelCandidateInventoryVisibility,
} from "./level-candidate-inventory-visibility.js";
import {
  assertLevelCandidateInventoryReviewVisibilityFactsOnly,
  validateLevelCandidateInventoryReviewVisibilityWrapper,
  type LevelCandidateInventoryReviewVisibilityWrapper,
} from "./level-candidate-inventory-review-wiring.js";
import type {
  LevelCandidatePoolDiagnosticsReport,
  LevelCandidatePoolStageSummary,
} from "./level-candidate-pool-diagnostics.js";

type SourceFiles = LevelCandidateInventoryVisibility["sourceFiles"];

export type LevelCandidateInventoryReviewAdapterInput = {
  symbol: string;
  provider?: string;
  asOfTimestamp?: number;
  asOfIso?: string;
  referencePrice?: number;
  sourceFiles?: SourceFiles;
  candidatePoolDiagnostics?: unknown;
  diagnostics?: unknown;
  limitations?: string[];
  truthfulGapDistancePct?: number;
};

type CandidatePoolStageKey =
  | "raw"
  | "clustered"
  | "scored"
  | "surfaced"
  | "extensionCandidates"
  | "selectedExtensions";

type CandidatePoolSideDiagnosticsLike = Record<CandidatePoolStageKey, LevelCandidatePoolStageSummary>;

type CandidatePoolDiagnosticsLike = Pick<
  LevelCandidatePoolDiagnosticsReport,
  "symbol" | "referencePrice"
> & {
  support: CandidatePoolSideDiagnosticsLike;
  resistance: CandidatePoolSideDiagnosticsLike;
};

const STAGES: readonly LevelCandidateInventoryStage[] = [
  "raw",
  "clustered",
  "scored",
  "surfaced",
  "extension_candidate",
  "extension_selected",
];

const SIDES: readonly LevelCandidateInventorySide[] = ["support", "resistance"];

const POOL_STAGE_BY_VISIBILITY_STAGE: Record<LevelCandidateInventoryStage, CandidatePoolStageKey> = {
  raw: "raw",
  clustered: "clustered",
  scored: "scored",
  surfaced: "surfaced",
  extension_candidate: "extensionCandidates",
  extension_selected: "selectedExtensions",
};

const REQUIRED_MISSING_LIMITATION = "raw_clustered_scored_inventory_not_available";
const REQUIRED_MISSING_DIAGNOSTIC = "candidate_inventory_visibility_not_available";
const SELECTION_REASON_LIMITATION = "surfaced_selection_reason_not_serialized";
const DEFAULT_TRUTHFUL_GAP_DISTANCE_PCT = 10;
const PRICE_EPSILON = 0.0001;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values.map((value) => round(value)))].sort((left, right) => left - right);
}

function withRequired(values: string[] | undefined, required: string): string[] {
  return uniqueSorted([...(values ?? []), required].filter((value) => value.trim() !== ""));
}

function hasRequiredStageSummaries(side: unknown): side is CandidatePoolSideDiagnosticsLike {
  if (!isRecord(side)) {
    return false;
  }

  return [
    "raw",
    "clustered",
    "scored",
    "surfaced",
    "extensionCandidates",
    "selectedExtensions",
  ].every((stage) => isStageSummaryLike(side[stage]));
}

function isStageSummaryLike(value: unknown): value is LevelCandidatePoolStageSummary {
  return (
    isRecord(value) &&
    typeof value.total === "number" &&
    Number.isFinite(value.total) &&
    value.total >= 0 &&
    Array.isArray(value.prices) &&
    value.prices.every((price) => typeof price === "number" && Number.isFinite(price)) &&
    isRecord(value.depth)
  );
}

function isCandidatePoolDiagnosticsLike(value: unknown): value is CandidatePoolDiagnosticsLike {
  if (!isRecord(value)) {
    return false;
  }

  return hasRequiredStageSummaries(value.support) && hasRequiredStageSummaries(value.resistance);
}

function cleanNumberRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .filter(([, count]) => typeof count === "number" && Number.isFinite(count) && count > 0)
    .sort(([left], [right]) => left.localeCompare(right));

  return entries.length > 0
    ? Object.fromEntries(entries.map(([key, count]) => [key, count as number]))
    : undefined;
}

function mergeNumberRecords(
  left: unknown,
  right: unknown,
): Record<string, number> | undefined {
  const counts = new Map<string, number>();
  for (const source of [left, right]) {
    const cleaned = cleanNumberRecord(source);
    if (!cleaned) {
      continue;
    }
    for (const [key, count] of Object.entries(cleaned)) {
      counts.set(key, (counts.get(key) ?? 0) + count);
    }
  }

  return counts.size > 0
    ? Object.fromEntries([...counts.entries()].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)))
    : undefined;
}

function sourceTypesFromStage(stage: LevelCandidatePoolStageSummary): string[] | undefined {
  const direct = Object.keys(cleanNumberRecord(stage.bySourceType) ?? {});
  const fromSets = Object.keys(stage.bySourceTypeSet ?? {})
    .flatMap((key) => key.split("+"))
    .filter((key) => key !== "unknown" && key.trim() !== "");
  const sourceTypes = uniqueSorted([...direct, ...fromSets]);

  return sourceTypes.length > 0 ? sourceTypes : undefined;
}

function stageSummaryFor(
  diagnostics: CandidatePoolDiagnosticsLike,
  stage: LevelCandidateInventoryStage,
  side: LevelCandidateInventorySide,
): LevelCandidatePoolStageSummary {
  return diagnostics[side][POOL_STAGE_BY_VISIBILITY_STAGE[stage]];
}

function buildStageCount(
  diagnostics: CandidatePoolDiagnosticsLike,
  stage: LevelCandidateInventoryStage,
): LevelCandidateInventoryStageSummary {
  const support = stageSummaryFor(diagnostics, stage, "support");
  const resistance = stageSummaryFor(diagnostics, stage, "resistance");
  const summary: LevelCandidateInventoryStageSummary = {
    stage,
    support: support.total,
    resistance: resistance.total,
    total: support.total + resistance.total,
  };
  const byTimeframe = mergeNumberRecords(support.byTimeframe, resistance.byTimeframe);
  const bySourceType = mergeNumberRecords(support.bySourceType, resistance.bySourceType);

  if (byTimeframe) {
    summary.byTimeframe = byTimeframe;
  }
  if (bySourceType) {
    summary.bySourceType = bySourceType;
  }

  return summary;
}

function referenceForStage(
  stage: LevelCandidatePoolStageSummary,
  fallback?: number,
): number | undefined {
  return stage.depth?.referencePrice ?? fallback;
}

function nearestPriceForStage(
  stage: LevelCandidatePoolStageSummary,
  side: LevelCandidateInventorySide,
  referencePrice?: number,
): number | undefined {
  const reference = referenceForStage(stage, referencePrice);
  if (reference !== undefined && reference > 0) {
    if (side === "support") {
      if (stage.depth?.nearestBelowReference !== undefined) {
        return round(stage.depth.nearestBelowReference);
      }
      const below = stage.prices.filter((price) => price < reference);
      return below.length > 0 ? round(Math.max(...below)) : undefined;
    }

    if (stage.depth?.nearestAboveReference !== undefined) {
      return round(stage.depth.nearestAboveReference);
    }
    const above = stage.prices.filter((price) => price > reference);
    return above.length > 0 ? round(Math.min(...above)) : undefined;
  }

  if (stage.prices.length === 0) {
    return undefined;
  }

  return side === "support"
    ? round(Math.max(...stage.prices))
    : round(Math.min(...stage.prices));
}

function distancePct(price: number | undefined, referencePrice?: number): number | undefined {
  if (price === undefined || referencePrice === undefined || referencePrice <= 0) {
    return undefined;
  }

  return round((Math.abs(referencePrice - price) / referencePrice) * 100);
}

function buildNearest(params: {
  diagnostics: CandidatePoolDiagnosticsLike;
  stage: LevelCandidateInventoryStage;
  side: LevelCandidateInventorySide;
  referencePrice?: number;
  surfaced?: boolean;
}): LevelCandidateInventoryNearest | undefined {
  const poolStage = stageSummaryFor(params.diagnostics, params.stage, params.side);
  const price = nearestPriceForStage(poolStage, params.side, params.referencePrice);
  if (price === undefined) {
    return undefined;
  }

  const nearest: LevelCandidateInventoryNearest = {
    stage: params.stage,
    side: params.side,
    price,
  };
  const distance = distancePct(price, referenceForStage(poolStage, params.referencePrice));
  const sourceTypes = sourceTypesFromStage(poolStage);

  if (distance !== undefined) {
    nearest.distancePct = distance;
  }
  if (params.surfaced !== undefined) {
    nearest.surfaced = params.surfaced;
  }
  if (sourceTypes) {
    nearest.sourceTypes = sourceTypes;
  }

  return nearest;
}

export function extractNearestCandidateInventoryRows(params: {
  diagnostics: unknown;
  stage: LevelCandidateInventoryStage;
  referencePrice?: number;
}): Partial<Record<LevelCandidateInventorySide, LevelCandidateInventoryNearest>> {
  if (!isCandidatePoolDiagnosticsLike(params.diagnostics)) {
    return {};
  }

  const nearest: Partial<Record<LevelCandidateInventorySide, LevelCandidateInventoryNearest>> = {};
  for (const side of SIDES) {
    const row = buildNearest({
      diagnostics: params.diagnostics,
      stage: params.stage,
      side,
      referencePrice: params.referencePrice,
      surfaced: params.stage === "surfaced" ? true : undefined,
    });
    if (row) {
      nearest[side] = row;
    }
  }

  return nearest;
}

function countCloserScoredPrices(params: {
  diagnostics: CandidatePoolDiagnosticsLike;
  side: LevelCandidateInventorySide;
  scoredNearest?: LevelCandidateInventoryNearest;
  surfacedNearest?: LevelCandidateInventoryNearest;
  referencePrice?: number;
}): number {
  const reference = params.referencePrice;
  const surfacedDistance = params.surfacedNearest?.distancePct;
  if (
    reference === undefined ||
    reference <= 0 ||
    params.scoredNearest?.price === undefined ||
    surfacedDistance === undefined
  ) {
    return 0;
  }

  const scoredPrices = stageSummaryFor(params.diagnostics, "scored", params.side).prices;
  return uniqueSortedNumbers(scoredPrices).filter((price) => {
    if (params.side === "support" && price >= reference) {
      return false;
    }
    if (params.side === "resistance" && price <= reference) {
      return false;
    }
    const candidateDistance = distancePct(price, reference);
    return candidateDistance !== undefined && candidateDistance + PRICE_EPSILON < surfacedDistance;
  }).length;
}

function nearestPricesAlign(
  nearest: Record<LevelCandidateInventoryStage, Partial<Record<LevelCandidateInventorySide, LevelCandidateInventoryNearest>>>,
  side: LevelCandidateInventorySide,
): boolean {
  const prices = ["raw", "clustered", "scored", "surfaced"].map(
    (stage) => nearest[stage as LevelCandidateInventoryStage][side]?.price,
  );

  if (prices.some((price) => price === undefined)) {
    return false;
  }

  return prices.every((price) => Math.abs((price ?? 0) - (prices[0] ?? 0)) <= PRICE_EPSILON);
}

function hasPartialStageVisibility(
  nearest: Record<LevelCandidateInventoryStage, Partial<Record<LevelCandidateInventorySide, LevelCandidateInventoryNearest>>>,
  side: LevelCandidateInventorySide,
): boolean {
  const present = ["raw", "clustered", "scored", "surfaced"].map(
    (stage) => nearest[stage as LevelCandidateInventoryStage][side]?.price !== undefined,
  );
  const presentCount = present.filter(Boolean).length;

  return presentCount > 0 && presentCount < present.length;
}

export function deriveCandidateInventoryGapClassification(params: {
  side: LevelCandidateInventorySide;
  nearest: Record<LevelCandidateInventoryStage, Partial<Record<LevelCandidateInventorySide, LevelCandidateInventoryNearest>>>;
  unsurfacedCloserPresent: boolean;
  limitations?: string[];
  truthfulGapDistancePct?: number;
}): LevelCandidateInventoryGapClassification {
  if (params.limitations?.includes(REQUIRED_MISSING_LIMITATION)) {
    return "inconclusive_missing_reasons";
  }
  if (params.unsurfacedCloserPresent) {
    return "closer_unsurfaced_candidate";
  }
  if (hasPartialStageVisibility(params.nearest, params.side)) {
    return "inconclusive_missing_reasons";
  }
  if (nearestPricesAlign(params.nearest, params.side)) {
    const surfacedDistance = params.nearest.surfaced[params.side]?.distancePct ?? 0;
    if (surfacedDistance >= (params.truthfulGapDistancePct ?? DEFAULT_TRUTHFUL_GAP_DISTANCE_PCT)) {
      return "truthful_market_context_gap";
    }
  }

  return "no_gap";
}

function buildUnsurfacedCloserSummary(params: {
  side: LevelCandidateInventorySide;
  present: boolean;
  count: number;
  nearest?: LevelCandidateInventoryNearest;
  classification: LevelCandidateInventoryGapClassification;
  limitations: string[];
}): LevelCandidateInventoryUnsurfacedCloserSummary {
  if (params.present) {
    return {
      side: params.side,
      present: true,
      count: params.count,
      nearest: params.nearest,
      reasonAvailability: "not_available",
      reasons: [],
      limitations: [SELECTION_REASON_LIMITATION],
    };
  }

  if (params.classification === "inconclusive_missing_reasons") {
    return {
      side: params.side,
      present: false,
      count: 0,
      reasonAvailability: "not_available",
      reasons: [],
      limitations: params.limitations,
    };
  }

  return {
    side: params.side,
    present: false,
    count: 0,
    reasonAvailability: "not_needed",
    reasons: [],
    limitations: [],
  };
}

function overallClassification(params: {
  support: LevelCandidateInventoryGapClassification;
  resistance: LevelCandidateInventoryGapClassification;
}): LevelCandidateInventoryGapClassification {
  if (params.support === "inconclusive_missing_reasons" || params.resistance === "inconclusive_missing_reasons") {
    return "inconclusive_missing_reasons";
  }
  if (params.support === "closer_unsurfaced_candidate" || params.resistance === "closer_unsurfaced_candidate") {
    return "closer_unsurfaced_candidate";
  }
  if (params.support === "truthful_market_context_gap" || params.resistance === "truthful_market_context_gap") {
    return "truthful_market_context_gap";
  }

  return "no_gap";
}

function diagnosticsFor(params: {
  support: LevelCandidateInventoryGapClassification;
  resistance: LevelCandidateInventoryGapClassification;
}): string[] {
  const diagnostics: string[] = [];
  if (params.support === "closer_unsurfaced_candidate") {
    diagnostics.push("closer_unsurfaced_support_present");
  }
  if (params.resistance === "closer_unsurfaced_candidate") {
    diagnostics.push("closer_unsurfaced_resistance_present");
  }
  if (params.support === "truthful_market_context_gap") {
    diagnostics.push("wide_downside_support_gap");
  }
  if (params.resistance === "truthful_market_context_gap") {
    diagnostics.push("wide_overhead_resistance_gap");
  }
  if (params.support === "inconclusive_missing_reasons" || params.resistance === "inconclusive_missing_reasons") {
    diagnostics.push("candidate_stage_inventory_missing");
  }

  return diagnostics.length > 0 ? uniqueSorted(diagnostics) : ["candidate_inventory_visibility_adapter"];
}

function limitationsFor(params: {
  support: LevelCandidateInventoryGapClassification;
  resistance: LevelCandidateInventoryGapClassification;
  inputLimitations: string[];
}): string[] {
  const limitations = [...params.inputLimitations];
  if (params.support === "closer_unsurfaced_candidate" || params.resistance === "closer_unsurfaced_candidate") {
    limitations.push(SELECTION_REASON_LIMITATION);
  }
  if (params.support === "inconclusive_missing_reasons" || params.resistance === "inconclusive_missing_reasons") {
    limitations.push(REQUIRED_MISSING_LIMITATION);
    limitations.push(SELECTION_REASON_LIMITATION);
  }

  return uniqueSorted(limitations);
}

function assertValidWrapper(wrapper: LevelCandidateInventoryReviewVisibilityWrapper): LevelCandidateInventoryReviewVisibilityWrapper {
  const validation = validateLevelCandidateInventoryReviewVisibilityWrapper(wrapper);
  if (!validation.valid) {
    throw new Error(`Invalid candidate inventory review adapter wrapper: ${validation.errors.join("; ")}`);
  }
  assertLevelCandidateInventoryReviewVisibilityFactsOnly(wrapper);

  return wrapper;
}

export function buildMissingCandidateInventoryReviewVisibility(
  params: { limitations?: string[]; diagnostics?: string[] } = {},
): LevelCandidateInventoryReviewVisibilityWrapper {
  return assertValidWrapper({
    present: false,
    limitations: withRequired(params.limitations, REQUIRED_MISSING_LIMITATION),
    diagnostics: withRequired(params.diagnostics, REQUIRED_MISSING_DIAGNOSTIC),
  });
}

export function buildLevelCandidateInventoryReviewVisibility(
  input: LevelCandidateInventoryReviewAdapterInput,
): LevelCandidateInventoryReviewVisibilityWrapper {
  const diagnostics = input.candidatePoolDiagnostics ?? input.diagnostics;
  if (!isCandidatePoolDiagnosticsLike(diagnostics)) {
    return buildMissingCandidateInventoryReviewVisibility({
      limitations: input.limitations,
    });
  }

  const referencePrice = input.referencePrice ?? diagnostics.referencePrice;
  const nearest = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      extractNearestCandidateInventoryRows({
        diagnostics,
        stage,
        referencePrice,
      }),
    ]),
  ) as LevelCandidateInventoryVisibility["nearest"];
  const inputLimitations = uniqueSorted(input.limitations ?? []);
  const sideState = Object.fromEntries(
    SIDES.map((side) => {
      const scoredNearest = nearest.scored[side];
      const surfacedNearest = nearest.surfaced[side];
      const closerCount = countCloserScoredPrices({
        diagnostics,
        side,
        scoredNearest,
        surfacedNearest,
        referencePrice,
      });
      const closerPresent = closerCount > 0 && scoredNearest !== undefined;
      const classification = deriveCandidateInventoryGapClassification({
        side,
        nearest,
        unsurfacedCloserPresent: closerPresent,
        limitations: inputLimitations,
        truthfulGapDistancePct: input.truthfulGapDistancePct,
      });
      const limitations = limitationsFor({
        support: side === "support" ? classification : "no_gap",
        resistance: side === "resistance" ? classification : "no_gap",
        inputLimitations,
      });

      return [
        side,
        {
          classification,
          unsurfacedCloser: buildUnsurfacedCloserSummary({
            side,
            present: closerPresent,
            count: closerCount,
            nearest: scoredNearest ? { ...scoredNearest, surfaced: false } : undefined,
            classification,
            limitations,
          }),
        },
      ];
    }),
  ) as Record<
    LevelCandidateInventorySide,
    {
      classification: LevelCandidateInventoryGapClassification;
      unsurfacedCloser: LevelCandidateInventoryUnsurfacedCloserSummary;
    }
  >;
  const gapClassification = {
    support: sideState.support.classification,
    resistance: sideState.resistance.classification,
    overall: overallClassification({
      support: sideState.support.classification,
      resistance: sideState.resistance.classification,
    }),
  };
  const limitations = limitationsFor({
    support: gapClassification.support,
    resistance: gapClassification.resistance,
    inputLimitations,
  });
  const visibility: LevelCandidateInventoryVisibility = {
    schemaVersion: "level-candidate-inventory-visibility/v1",
    symbol: input.symbol.toUpperCase(),
    provider: input.provider,
    asOfTimestamp: input.asOfTimestamp,
    asOfIso: input.asOfIso,
    referencePrice,
    sourceFiles: input.sourceFiles ?? {},
    stageCounts: Object.fromEntries(
      STAGES.map((stage) => [stage, buildStageCount(diagnostics, stage)]),
    ) as LevelCandidateInventoryVisibility["stageCounts"],
    nearest,
    unsurfacedCloser: {
      support: sideState.support.unsurfacedCloser,
      resistance: sideState.resistance.unsurfacedCloser,
    },
    gapClassification,
    diagnostics: diagnosticsFor(gapClassification),
    limitations,
    safety: {
      readOnly: true,
      auditOnly: true,
      providerCallsMade: false,
      cacheFilesWritten: false,
      rawCandlesIncluded: false,
      fullSnapshotsIncluded: false,
      supportResistanceDetectionChanged: false,
      levelEngineScoringRankingClusteringChanged: false,
      surfacedLevelsChanged: false,
      extensionGenerationChanged: false,
      fifteenMinuteFedIntoLevelEngine: false,
    },
  };
  const visibilityValidation = validateLevelCandidateInventoryVisibility(visibility);
  if (!visibilityValidation.valid) {
    throw new Error(`Invalid candidate inventory visibility from adapter: ${visibilityValidation.errors.join("; ")}`);
  }
  assertLevelCandidateInventoryVisibilityFactsOnly(visibility);

  return assertValidWrapper({
    present: true,
    visibility,
    gapSummary: summarizeLevelCandidateInventoryGaps(visibility),
  });
}
