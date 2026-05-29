import {
  buildLevelExtensionSelectionDiagnostics,
  buildLevelExtensionsWithDiagnostics,
  type LevelExtensionCandidatePoolMode,
  type LevelExtensionSelectionSideDiagnostics,
  type LevelExtensionSelectionSkipReason,
} from "./level-extension-engine.js";
import type { FinalLevelZone, LevelEngineOutput, LevelLadderExtension } from "./level-types.js";

export type LevelExtensionDiagnosticSide = "support" | "resistance";

export type LevelExtensionSkipReason = LevelExtensionSelectionSkipReason;

export type LevelExtensionCoverageWarning =
  | "missing_resistance_extension"
  | "missing_support_extension"
  | "limited_upside_extension_coverage"
  | "limited_downside_extension_coverage"
  | "insufficient_candidate_inventory";

export type LevelExtensionCandidateDiagnostic = {
  id: string;
  price: number;
  zoneLow: number;
  zoneHigh: number;
  isSurfaced: boolean;
  isPreSelectionCandidate: boolean;
  isEligibleExtensionCandidate: boolean;
  isSelectedExtension: boolean;
  usefulnessScore: number;
  skipReasons: LevelExtensionSkipReason[];
};

export type LevelExtensionSideDiagnostics = {
  symbol: string;
  referencePrice?: number;
  side: LevelExtensionDiagnosticSide;
  surfacedLevelPrices: number[];
  inputInventoryPrices: number[];
  candidatePoolMode?: LevelExtensionCandidatePoolMode;
  preSelectionCandidatePrices: number[];
  candidatePoolPrices: number[];
  eligibleCandidatePrices: number[];
  selectedExtensionPrices: number[];
  skippedCandidatePrices: number[];
  candidateCoveragePct?: number;
  selectedCoveragePct?: number;
  candidates: LevelExtensionCandidateDiagnostic[];
  rejectionReasonCounts: Partial<Record<LevelExtensionSkipReason, number>>;
  insufficientCandidateInventory: boolean;
  syntheticGenerationAvailable: boolean;
  undeterminedRejectionCount: number;
  notes: string[];
};

export type LevelExtensionCoverageDiagnostics = {
  supportExtensions: number;
  resistanceExtensions: number;
  lowestSupportExtension?: number;
  highestResistanceExtension?: number;
  downsideCoveragePct?: number;
  upsideCoveragePct?: number;
  warnings: LevelExtensionCoverageWarning[];
};

export type BuildLevelExtensionDiagnosticsRequest = {
  symbol: string;
  referencePrice?: number;
  supportZones: FinalLevelZone[];
  resistanceZones: FinalLevelZone[];
  surfacedSupport: FinalLevelZone[];
  surfacedResistance: FinalLevelZone[];
  selectedExtensions?: LevelLadderExtension;
  maxExtensionPerSide?: number;
  spacingPct?: number;
  searchWindowPct?: number;
  forwardPlanningRangePct?: number;
  coverageWarningPct?: number;
  diagnostics?: string[];
};

export type LevelExtensionDiagnosticsReport = {
  symbol: string;
  referencePrice?: number;
  support: LevelExtensionSideDiagnostics;
  resistance: LevelExtensionSideDiagnostics;
  extensionCoverage: LevelExtensionCoverageDiagnostics;
  warnings: LevelExtensionCoverageWarning[];
  diagnostics: string[];
  safety: {
    extensionGenerationUnchanged: true;
    supportResistanceDetectionUnchanged: true;
    noRuntimeBehaviorChange: true;
    noScoringChange: true;
    reviewOnly: true;
  };
};

const DEFAULT_MAX_EXTENSION_PER_SIDE = 3;
const DEFAULT_EXTENSION_SPACING_PCT = 0.01;
const DEFAULT_EXTENSION_SEARCH_WINDOW_PCT = 0.05;
const DEFAULT_FORWARD_PLANNING_RANGE_PCT = 0.5;
const DEFAULT_COVERAGE_WARNING_PCT = 20;

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isUsableNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function sortedPrices(zones: FinalLevelZone[], side: LevelExtensionDiagnosticSide): number[] {
  return zones
    .map((zone) => round(zone.representativePrice))
    .sort((left, right) => side === "support" ? right - left : left - right);
}

function selectedSort(zones: FinalLevelZone[], side: LevelExtensionDiagnosticSide): FinalLevelZone[] {
  return [...zones].sort((left, right) =>
    side === "support"
      ? right.representativePrice - left.representativePrice
      : left.representativePrice - right.representativePrice,
  );
}

function proximityPct(left: FinalLevelZone, right: FinalLevelZone): number {
  return (
    Math.abs(left.representativePrice - right.representativePrice) /
    Math.max(Math.max(left.representativePrice, right.representativePrice), 0.0001)
  );
}

function maxPracticalResistancePrice(
  referencePrice: number | undefined,
  forwardPlanningRangePct: number,
): number {
  return referencePrice && referencePrice > 0
    ? referencePrice * (1 + forwardPlanningRangePct)
    : Number.POSITIVE_INFINITY;
}

function surfacedResistanceBoundary(params: {
  surfaced: FinalLevelZone[];
  referencePrice?: number;
  forwardPlanningRangePct: number;
}): number {
  const maxPracticalPrice = maxPracticalResistancePrice(
    params.referencePrice,
    params.forwardPlanningRangePct,
  );
  const practicalSurfaced = params.surfaced
    .filter((zone) => zone.representativePrice <= maxPracticalPrice)
    .map((zone) => zone.representativePrice);

  if (practicalSurfaced.length > 0) {
    return Math.max(...practicalSurfaced);
  }
  if (params.surfaced.length === 0) {
    return -Infinity;
  }

  return Math.max(...params.surfaced.map((zone) => zone.representativePrice));
}

function selectedIdSet(zones: FinalLevelZone[]): Set<string> {
  return new Set(zones.map((zone) => zone.id));
}

function surfacedIdSet(zones: FinalLevelZone[]): Set<string> {
  return new Set(zones.map((zone) => zone.id));
}

function hasCloseZone(zone: FinalLevelZone, zones: FinalLevelZone[], spacingPct: number): boolean {
  return zones.some((other) => other.id !== zone.id && proximityPct(zone, other) <= spacingPct);
}

function isBeyondSurfacedBoundary(params: {
  zone: FinalLevelZone;
  side: LevelExtensionDiagnosticSide;
  surfaced: FinalLevelZone[];
  referencePrice?: number;
  forwardPlanningRangePct: number;
}): boolean {
  if (params.side === "support") {
    if (params.surfaced.length === 0) {
      return true;
    }

    const lowestVisibleSupport = Math.min(...params.surfaced.map((zone) => zone.representativePrice));
    return params.zone.representativePrice < lowestVisibleSupport;
  }

  const highestVisibleResistance = params.surfaced.length === 0
    ? -Infinity
    : surfacedResistanceBoundary({
        surfaced: params.surfaced,
        referencePrice: params.referencePrice,
        forwardPlanningRangePct: params.forwardPlanningRangePct,
      });

  return params.zone.representativePrice > highestVisibleResistance;
}

function isOutsidePracticalRange(params: {
  zone: FinalLevelZone;
  side: LevelExtensionDiagnosticSide;
  referencePrice?: number;
  forwardPlanningRangePct: number;
}): boolean {
  if (params.side === "support") {
    return false;
  }

  return params.zone.representativePrice > maxPracticalResistancePrice(
    params.referencePrice,
    params.forwardPlanningRangePct,
  );
}

function isWrongSideOfReference(
  zone: FinalLevelZone,
  side: LevelExtensionDiagnosticSide,
  referencePrice: number | undefined,
): boolean {
  if (!referencePrice || referencePrice <= 0) {
    return false;
  }

  return side === "support"
    ? zone.representativePrice >= referencePrice
    : zone.representativePrice <= referencePrice;
}

function isEligibleForwardCandidate(params: {
  zone: FinalLevelZone;
  side: LevelExtensionDiagnosticSide;
  surfaced: FinalLevelZone[];
  surfacedIds: Set<string>;
  referencePrice?: number;
  spacingPct: number;
  forwardPlanningRangePct: number;
}): boolean {
  if (params.surfacedIds.has(params.zone.id)) {
    return false;
  }
  if (isWrongSideOfReference(params.zone, params.side, params.referencePrice)) {
    return false;
  }
  if (isOutsidePracticalRange({
    zone: params.zone,
    side: params.side,
    referencePrice: params.referencePrice,
    forwardPlanningRangePct: params.forwardPlanningRangePct,
  })) {
    return false;
  }
  if (!isBeyondSurfacedBoundary({
    zone: params.zone,
    side: params.side,
    surfaced: params.surfaced,
    referencePrice: params.referencePrice,
    forwardPlanningRangePct: params.forwardPlanningRangePct,
  })) {
    return false;
  }
  if (hasCloseZone(params.zone, params.surfaced, params.spacingPct)) {
    return false;
  }

  return true;
}

function candidateSkipReasons(params: {
  zone: FinalLevelZone;
  side: LevelExtensionDiagnosticSide;
  surfaced: FinalLevelZone[];
  surfacedIds: Set<string>;
  selected: FinalLevelZone[];
  selectedIds: Set<string>;
  referencePrice?: number;
  spacingPct: number;
  forwardPlanningRangePct: number;
}): LevelExtensionSkipReason[] {
  const reasons: LevelExtensionSkipReason[] = [];

  if (params.selectedIds.has(params.zone.id)) {
    reasons.push("selected_extension");
    return reasons;
  }
  if (params.surfacedIds.has(params.zone.id)) {
    reasons.push("already_surfaced");
  }
  if (isWrongSideOfReference(params.zone, params.side, params.referencePrice)) {
    reasons.push("wrong_side_of_reference_price");
  }
  if (isOutsidePracticalRange({
    zone: params.zone,
    side: params.side,
    referencePrice: params.referencePrice,
    forwardPlanningRangePct: params.forwardPlanningRangePct,
  })) {
    reasons.push("outside_practical_range");
  }
  if (!isBeyondSurfacedBoundary({
    zone: params.zone,
    side: params.side,
    surfaced: params.surfaced,
    referencePrice: params.referencePrice,
    forwardPlanningRangePct: params.forwardPlanningRangePct,
  })) {
    reasons.push("inside_surfaced_map");
  }
  if (hasCloseZone(params.zone, params.surfaced, params.spacingPct)) {
    reasons.push("too_close_to_surfaced_level");
  }
  if (hasCloseZone(params.zone, params.selected, params.spacingPct)) {
    reasons.push("too_close_to_another_extension");
  }

  if (reasons.length === 0) {
    reasons.push("undetermined");
  }

  return reasons;
}

function buildSideDiagnostics(params: {
  symbol: string;
  referencePrice?: number;
  side: LevelExtensionDiagnosticSide;
  zones: FinalLevelZone[];
  surfaced: FinalLevelZone[];
  selected: FinalLevelZone[];
  spacingPct: number;
  forwardPlanningRangePct: number;
  candidateInventoryLimited: boolean;
  selectionDiagnostics?: LevelExtensionSelectionSideDiagnostics;
}): LevelExtensionSideDiagnostics {
  if (params.selectionDiagnostics) {
    const notes: string[] = [];

    if (params.candidateInventoryLimited) {
      notes.push("Candidate inventory is limited to final LevelEngineOutput levels; raw pre-extension candidates are not available.");
    }
    if (params.selectionDiagnostics.insufficientCandidateInventory) {
      notes.push("No eligible candidate inventory is visible for this side.");
    }
    notes.push("Synthetic continuation-map extension generation is available only as a fallback after real candidates are considered.");

    return {
      symbol: params.symbol,
      referencePrice: params.referencePrice,
      side: params.side,
      surfacedLevelPrices: params.selectionDiagnostics.surfacedLevelPrices,
      inputInventoryPrices: params.selectionDiagnostics.inputInventoryPrices,
      candidatePoolMode: params.selectionDiagnostics.candidatePoolMode,
      preSelectionCandidatePrices: params.selectionDiagnostics.preSelectionCandidatePrices,
      candidatePoolPrices: params.selectionDiagnostics.inputInventoryPrices,
      eligibleCandidatePrices: params.selectionDiagnostics.eligibleCandidatePrices,
      selectedExtensionPrices: params.selectionDiagnostics.selectedExtensionPrices,
      skippedCandidatePrices: params.selectionDiagnostics.skippedCandidatePrices,
      candidateCoveragePct: params.selectionDiagnostics.candidateCoveragePct,
      selectedCoveragePct: params.selectionDiagnostics.selectedCoveragePct,
      candidates: params.selectionDiagnostics.candidates,
      rejectionReasonCounts: params.selectionDiagnostics.rejectionReasonCounts,
      insufficientCandidateInventory: params.selectionDiagnostics.insufficientCandidateInventory,
      syntheticGenerationAvailable: true,
      undeterminedRejectionCount: params.selectionDiagnostics.candidates.filter((candidate) =>
        candidate.skipReasons.includes("undetermined"),
      ).length,
      notes,
    };
  }

  const surfacedIds = surfacedIdSet(params.surfaced);
  const selectedIds = selectedIdSet(params.selected);
  const eligible = params.zones.filter((zone) =>
    isEligibleForwardCandidate({
      zone,
      side: params.side,
      surfaced: params.surfaced,
      surfacedIds,
      referencePrice: params.referencePrice,
      spacingPct: params.spacingPct,
      forwardPlanningRangePct: params.forwardPlanningRangePct,
    }),
  );
  const candidates = selectedSort(params.zones, params.side).map((zone) => {
    const isSelectedExtension = selectedIds.has(zone.id);
    const skipReasons = candidateSkipReasons({
      zone,
      side: params.side,
      surfaced: params.surfaced,
      surfacedIds,
      selected: params.selected,
      selectedIds,
      referencePrice: params.referencePrice,
      spacingPct: params.spacingPct,
      forwardPlanningRangePct: params.forwardPlanningRangePct,
    });

    return {
      id: zone.id,
      price: round(zone.representativePrice),
      zoneLow: round(zone.zoneLow),
      zoneHigh: round(zone.zoneHigh),
      isSurfaced: surfacedIds.has(zone.id),
      isPreSelectionCandidate: eligible.some((candidate) => candidate.id === zone.id),
      isEligibleExtensionCandidate: eligible.some((candidate) => candidate.id === zone.id),
      isSelectedExtension,
      usefulnessScore: 0,
      skipReasons,
    };
  });
  const skippedCandidates = candidates.filter((candidate) => !candidate.isSelectedExtension);
  const insufficientCandidateInventory = eligible.length === 0;
  const notes: string[] = [];

  if (params.candidateInventoryLimited) {
    notes.push("Candidate inventory is limited to final LevelEngineOutput levels; raw pre-extension candidates are not available.");
  }
  if (insufficientCandidateInventory) {
    notes.push("No eligible candidate inventory is visible for this side.");
  }
  notes.push("Synthetic continuation-map extension generation is available only as a fallback after real candidates are considered.");

  return {
    symbol: params.symbol,
    referencePrice: params.referencePrice,
    side: params.side,
    surfacedLevelPrices: sortedPrices(params.surfaced, params.side),
    inputInventoryPrices: sortedPrices(params.zones, params.side),
    candidatePoolMode: undefined,
    preSelectionCandidatePrices: sortedPrices(eligible, params.side),
    candidatePoolPrices: sortedPrices(params.zones, params.side),
    eligibleCandidatePrices: sortedPrices(eligible, params.side),
    selectedExtensionPrices: sortedPrices(params.selected, params.side),
    skippedCandidatePrices: skippedCandidates.map((candidate) => candidate.price),
    candidateCoveragePct: undefined,
    selectedCoveragePct: undefined,
    candidates,
    rejectionReasonCounts: {},
    insufficientCandidateInventory,
    syntheticGenerationAvailable: true,
    undeterminedRejectionCount: candidates.filter((candidate) => candidate.skipReasons.includes("undetermined")).length,
    notes,
  };
}

function buildCoverageDiagnostics(params: {
  selectedExtensions: LevelLadderExtension;
  referencePrice?: number;
  coverageWarningPct: number;
  supportInsufficient: boolean;
  resistanceInsufficient: boolean;
}): LevelExtensionCoverageDiagnostics {
  const supportExtensions = params.selectedExtensions.support;
  const resistanceExtensions = params.selectedExtensions.resistance;
  const lowestSupportExtension = supportExtensions.length > 0
    ? Math.min(...supportExtensions.map((zone) => zone.representativePrice))
    : undefined;
  const highestResistanceExtension = resistanceExtensions.length > 0
    ? Math.max(...resistanceExtensions.map((zone) => zone.representativePrice))
    : undefined;
  const downsideCoveragePct =
    isUsableNumber(params.referencePrice) && isUsableNumber(lowestSupportExtension)
      ? round(((params.referencePrice - lowestSupportExtension) / params.referencePrice) * 100)
      : undefined;
  const upsideCoveragePct =
    isUsableNumber(params.referencePrice) && isUsableNumber(highestResistanceExtension)
      ? round(((highestResistanceExtension - params.referencePrice) / params.referencePrice) * 100)
      : undefined;
  const warnings: LevelExtensionCoverageWarning[] = [];

  if (supportExtensions.length === 0) {
    warnings.push("missing_support_extension");
  }
  if (resistanceExtensions.length === 0) {
    warnings.push("missing_resistance_extension");
  }
  if (isUsableNumber(upsideCoveragePct) && upsideCoveragePct < params.coverageWarningPct) {
    warnings.push("limited_upside_extension_coverage");
  }
  if (isUsableNumber(downsideCoveragePct) && downsideCoveragePct < params.coverageWarningPct) {
    warnings.push("limited_downside_extension_coverage");
  }
  if (params.supportInsufficient || params.resistanceInsufficient) {
    warnings.push("insufficient_candidate_inventory");
  }

  return {
    supportExtensions: supportExtensions.length,
    resistanceExtensions: resistanceExtensions.length,
    lowestSupportExtension: isUsableNumber(lowestSupportExtension) ? round(lowestSupportExtension) : undefined,
    highestResistanceExtension: isUsableNumber(highestResistanceExtension) ? round(highestResistanceExtension) : undefined,
    downsideCoveragePct,
    upsideCoveragePct,
    warnings,
  };
}

function uniqueWarnings(warnings: LevelExtensionCoverageWarning[]): LevelExtensionCoverageWarning[] {
  return [...new Set(warnings)];
}

export function buildLevelExtensionDiagnostics(
  request: BuildLevelExtensionDiagnosticsRequest,
): LevelExtensionDiagnosticsReport {
  const maxExtensionPerSide = request.maxExtensionPerSide ?? DEFAULT_MAX_EXTENSION_PER_SIDE;
  const spacingPct = request.spacingPct ?? DEFAULT_EXTENSION_SPACING_PCT;
  const searchWindowPct = request.searchWindowPct ?? DEFAULT_EXTENSION_SEARCH_WINDOW_PCT;
  const forwardPlanningRangePct = request.forwardPlanningRangePct ?? DEFAULT_FORWARD_PLANNING_RANGE_PCT;
  const coverageWarningPct = request.coverageWarningPct ?? DEFAULT_COVERAGE_WARNING_PCT;
  const extensionBuild = request.selectedExtensions
    ? {
        extensionLevels: request.selectedExtensions,
        diagnostics: buildLevelExtensionSelectionDiagnostics({
          supportZones: request.supportZones,
          resistanceZones: request.resistanceZones,
          surfacedSupport: request.surfacedSupport,
          surfacedResistance: request.surfacedResistance,
          selectedExtensions: request.selectedExtensions,
          maxExtensionPerSide,
          spacingPct,
          searchWindowPct,
          referencePrice: request.referencePrice,
          forwardPlanningRangePct,
        }),
      }
    : buildLevelExtensionsWithDiagnostics({
        supportZones: request.supportZones,
        resistanceZones: request.resistanceZones,
        surfacedSupport: request.surfacedSupport,
        surfacedResistance: request.surfacedResistance,
        maxExtensionPerSide,
        spacingPct,
        searchWindowPct,
        referencePrice: request.referencePrice,
        forwardPlanningRangePct,
      });
  const selectedExtensions = extensionBuild.extensionLevels;

  const support = buildSideDiagnostics({
    symbol: request.symbol,
    referencePrice: request.referencePrice,
    side: "support",
    zones: request.supportZones,
    surfaced: request.surfacedSupport,
    selected: selectedExtensions.support,
    spacingPct,
    forwardPlanningRangePct,
    candidateInventoryLimited: false,
    selectionDiagnostics: extensionBuild.diagnostics.support,
  });
  const resistance = buildSideDiagnostics({
    symbol: request.symbol,
    referencePrice: request.referencePrice,
    side: "resistance",
    zones: request.resistanceZones,
    surfaced: request.surfacedResistance,
    selected: selectedExtensions.resistance,
    spacingPct,
    forwardPlanningRangePct,
    candidateInventoryLimited: false,
    selectionDiagnostics: extensionBuild.diagnostics.resistance,
  });
  const extensionCoverage = buildCoverageDiagnostics({
    selectedExtensions,
    referencePrice: request.referencePrice,
    coverageWarningPct,
    supportInsufficient: support.insufficientCandidateInventory,
    resistanceInsufficient: resistance.insufficientCandidateInventory,
  });

  return {
    symbol: request.symbol,
    referencePrice: request.referencePrice,
    support,
    resistance,
    extensionCoverage,
    warnings: uniqueWarnings(extensionCoverage.warnings),
    diagnostics: [...new Set(request.diagnostics ?? [])].sort(),
    safety: {
      extensionGenerationUnchanged: true,
      supportResistanceDetectionUnchanged: true,
      noRuntimeBehaviorChange: true,
      noScoringChange: true,
      reviewOnly: true,
    },
  };
}

export function buildLevelExtensionDiagnosticsFromOutput(
  output: LevelEngineOutput,
  options: {
    coverageWarningPct?: number;
    forwardPlanningRangePct?: number;
    spacingPct?: number;
  } = {},
): LevelExtensionDiagnosticsReport {
  const surfacedSupport = [
    ...output.majorSupport,
    ...output.intermediateSupport,
    ...output.intradaySupport,
  ];
  const surfacedResistance = [
    ...output.majorResistance,
    ...output.intermediateResistance,
    ...output.intradayResistance,
  ];
  const supportZones = [...surfacedSupport, ...output.extensionLevels.support];
  const resistanceZones = [...surfacedResistance, ...output.extensionLevels.resistance];
  const report = buildLevelExtensionDiagnostics({
    symbol: output.symbol,
    referencePrice: output.metadata.referencePrice,
    supportZones,
    resistanceZones,
    surfacedSupport,
    surfacedResistance,
    selectedExtensions: output.extensionLevels,
    coverageWarningPct: options.coverageWarningPct,
    forwardPlanningRangePct: options.forwardPlanningRangePct,
    spacingPct: options.spacingPct,
    diagnostics: ["candidate_inventory_limited_to_level_output"],
  });

  return {
    ...report,
    support: {
      ...report.support,
      notes: [
        "Candidate inventory is limited to final LevelEngineOutput levels; raw pre-extension candidates are not available.",
        ...report.support.notes.filter((note) => !note.startsWith("Candidate inventory is limited")),
      ],
    },
    resistance: {
      ...report.resistance,
      notes: [
        "Candidate inventory is limited to final LevelEngineOutput levels; raw pre-extension candidates are not available.",
        ...report.resistance.notes.filter((note) => !note.startsWith("Candidate inventory is limited")),
      ],
    },
  };
}
