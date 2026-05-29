import type { FinalLevelZone, LevelLadderExtension } from "./level-types.js";

export type LevelExtensionSelectionSide = "support" | "resistance";

export type SyntheticExtensionOptions = {
  enabled?: boolean;
  minTargetCoveragePct?: number;
  maxTargetCoveragePct?: number;
  minSyntheticSpacingPct?: number;
  maxSyntheticExtensionsPerSide?: number;
};

export type LevelExtensionCandidatePoolMode =
  | "strict_frontier"
  | "expanded_unselected_scored";

export type LevelExtensionSelectionSkipReason =
  | "already_surfaced"
  | "wrong_side_of_reference_price"
  | "outside_practical_range"
  | "inside_surfaced_map"
  | "too_close_to_surfaced_level"
  | "too_close_to_another_extension"
  | "dominated_by_forward_candidate"
  | "not_selected_by_ladder_selection"
  | "selected_extension"
  | "undetermined";

export type LevelExtensionCandidateSelectionDiagnostic = {
  id: string;
  price: number;
  zoneLow: number;
  zoneHigh: number;
  isSurfaced: boolean;
  isPreSelectionCandidate: boolean;
  isEligibleExtensionCandidate: boolean;
  isSelectedExtension: boolean;
  usefulnessScore: number;
  skipReasons: LevelExtensionSelectionSkipReason[];
};

export type LevelExtensionSelectionSideDiagnostics = {
  side: LevelExtensionSelectionSide;
  referencePrice?: number;
  surfacedLevelPrices: number[];
  inputInventoryPrices: number[];
  candidatePoolMode: LevelExtensionCandidatePoolMode;
  preSelectionCandidatePrices: number[];
  eligibleCandidatePrices: number[];
  selectedExtensionPrices: number[];
  skippedCandidatePrices: number[];
  candidateCoveragePct?: number;
  selectedCoveragePct?: number;
  insufficientCandidateInventory: boolean;
  candidates: LevelExtensionCandidateSelectionDiagnostic[];
  rejectionReasonCounts: Partial<Record<LevelExtensionSelectionSkipReason, number>>;
};

export type LevelExtensionSelectionDiagnostics = {
  support: LevelExtensionSelectionSideDiagnostics;
  resistance: LevelExtensionSelectionSideDiagnostics;
  config: {
    maxExtensionPerSide: number;
    spacingPct: number;
    searchWindowPct: number;
    forwardPlanningRangePct: number;
  };
  safety: {
    extensionGenerationUnchanged: true;
    diagnosticOnly: true;
  };
};

export type BuildLevelExtensionsParams = {
  supportZones: FinalLevelZone[];
  resistanceZones: FinalLevelZone[];
  surfacedSupport: FinalLevelZone[];
  surfacedResistance: FinalLevelZone[];
  maxExtensionPerSide?: number;
  spacingPct?: number;
  searchWindowPct?: number;
  referencePrice?: number;
  forwardPlanningRangePct?: number;
  syntheticExtensionOptions?: SyntheticExtensionOptions;
};

export type BuildLevelExtensionsWithDiagnosticsResult = {
  extensionLevels: LevelLadderExtension;
  diagnostics: LevelExtensionSelectionDiagnostics;
};

function timeframeBiasRank(zone: FinalLevelZone): number {
  if (zone.timeframeBias === "mixed") {
    return 4;
  }

  if (zone.timeframeBias === "daily") {
    return 3;
  }

  if (zone.timeframeBias === "4h") {
    return 2;
  }

  return 1;
}

function sortSupport(zones: FinalLevelZone[]): FinalLevelZone[] {
  return [...zones].sort((a, b) => b.representativePrice - a.representativePrice);
}

function sortResistance(zones: FinalLevelZone[]): FinalLevelZone[] {
  return [...zones].sort((a, b) => a.representativePrice - b.representativePrice);
}

const DEFAULT_FORWARD_PLANNING_RANGE_PCT = 0.5;
const DEFAULT_SYNTHETIC_EXTENSION_OPTIONS: Required<SyntheticExtensionOptions> = {
  enabled: true,
  minTargetCoveragePct: 0.3,
  maxTargetCoveragePct: 0.5,
  minSyntheticSpacingPct: 0.03,
  maxSyntheticExtensionsPerSide: 2,
};
const LOW_PRICE_SUPPORT_MAX_SYNTHETIC_COVERAGE_PCT = 0.35;
const SYNTHETIC_EXTENSION_NOTE =
  "Synthetic continuation-map extension for forward planning only; not historical support/resistance.";

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sortBySide(
  zones: FinalLevelZone[],
  side: LevelExtensionSelectionSide,
): FinalLevelZone[] {
  return side === "support" ? sortSupport(zones) : sortResistance(zones);
}

function sortedPrices(
  zones: FinalLevelZone[],
  side: LevelExtensionSelectionSide,
): number[] {
  return sortBySide(zones, side).map((zone) => round(zone.representativePrice));
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
  const surfacedPracticalBoundary = params.surfaced
    .filter((zone) => zone.representativePrice <= maxPracticalPrice)
    .map((zone) => zone.representativePrice);

  if (surfacedPracticalBoundary.length > 0) {
    return Math.max(...surfacedPracticalBoundary);
  }

  if (params.surfaced.length === 0) {
    return -Infinity;
  }

  return Math.max(...params.surfaced.map((zone) => zone.representativePrice));
}

function extensionUsefulnessScore(zone: FinalLevelZone): number {
  const freshnessBonus =
    zone.freshness === "fresh" ? 0.25 : zone.freshness === "aging" ? 0.1 : -0.15;
  const decisionQualityBonus =
    zone.rejectionScore * 7 +
    zone.displacementScore * 5 +
    zone.reactionQualityScore * 4 +
    timeframeBiasRank(zone) * 1.5 +
    Math.min(zone.confluenceCount, 2) * 1.25;
  const weakIntradayPenalty =
    zone.timeframeSources.length === 1 &&
    zone.timeframeSources[0] === "5m" &&
    zone.rejectionScore < 0.35 &&
    zone.displacementScore < 0.5 &&
    zone.reactionQualityScore < 0.6 &&
    zone.confluenceCount <= 1
      ? 6
      : 0;

  return (
    zone.strengthScore +
    zone.followThroughScore * 8 +
    (zone.gapContinuationScore ?? 0) * 2 +
    decisionQualityBonus +
    freshnessBonus -
    weakIntradayPenalty
  );
}

function proximityPct(left: FinalLevelZone, right: FinalLevelZone): number {
  return (
    Math.abs(left.representativePrice - right.representativePrice) /
    Math.max(Math.max(left.representativePrice, right.representativePrice), 0.0001)
  );
}

function distanceFromBoundaryPct(boundary: number, price: number): number {
  return Math.abs(price - boundary) / Math.max(Math.max(price, boundary), 0.0001);
}

function normalizedDistancePct(leftPrice: number, rightPrice: number): number {
  return Math.abs(leftPrice - rightPrice) / Math.max(Math.max(leftPrice, rightPrice), 0.0001);
}

function isActionableForwardCandidate(zone: FinalLevelZone): boolean {
  return (
    zone.rejectionScore >= 0.38 ||
    zone.displacementScore >= 0.5 ||
    zone.reactionQualityScore >= 0.62 ||
    zone.followThroughScore >= 0.5 ||
    timeframeBiasRank(zone) >= 2 ||
    zone.confluenceCount >= 2
  );
}

function shouldPreferForwardStructuralCandidate(params: {
  candidate: FinalLevelZone;
  challenger: FinalLevelZone;
  candidatePrice: number;
  challengerPrice: number;
  side: "support" | "resistance";
  searchWindowPct: number;
}): boolean {
  const fartherForward =
    params.side === "resistance"
      ? params.challengerPrice > params.candidatePrice
      : params.challengerPrice < params.candidatePrice;

  if (!fartherForward) {
    return false;
  }

  const localBandPct = Math.max(params.searchWindowPct * 1.5, 0.08);
  if (normalizedDistancePct(params.candidatePrice, params.challengerPrice) > localBandPct) {
    return false;
  }

  const usefulnessDelta =
    extensionUsefulnessScore(params.challenger) - extensionUsefulnessScore(params.candidate);
  if (usefulnessDelta < 6) {
    return false;
  }

  const strongerTimeframe =
    timeframeBiasRank(params.challenger) > timeframeBiasRank(params.candidate);
  const strongerRejection =
    params.challenger.rejectionScore >= params.candidate.rejectionScore + 0.12;
  const strongerFollowThrough =
    params.challenger.followThroughScore >= params.candidate.followThroughScore + 0.12;

  if (isActionableForwardCandidate(params.candidate)) {
    return false;
  }

  return strongerTimeframe || strongerRejection || strongerFollowThrough;
}

function pruneDominatedForwardCandidates(
  candidates: FinalLevelZone[],
  side: "support" | "resistance",
  searchWindowPct: number,
): FinalLevelZone[] {
  const ordered = side === "resistance" ? sortResistance(candidates) : sortSupport(candidates);

  return ordered.filter((candidate, index) => {
    const laterCandidates = ordered.slice(index + 1);

    return !laterCandidates.some((challenger) => {
      return shouldPreferForwardStructuralCandidate({
        candidate,
        challenger,
        candidatePrice: candidate.representativePrice,
        challengerPrice: challenger.representativePrice,
        side,
        searchWindowPct,
      });
    });
  });
}

function isTooCloseToAny(
  zone: FinalLevelZone,
  others: FinalLevelZone[],
  spacingPct: number,
): boolean {
  return others.some((other) => proximityPct(other, zone) <= spacingPct);
}

function zoneIdSet(zones: FinalLevelZone[]): Set<string> {
  return new Set(zones.map((zone) => zone.id));
}

function matchesSurfacedZone(zone: FinalLevelZone, surfaced: FinalLevelZone[]): boolean {
  return surfaced.some(
    (surfacedZone) =>
      surfacedZone.id === zone.id ||
      round(surfacedZone.representativePrice) === round(zone.representativePrice),
  );
}

function isOnExtensionSide(
  zone: FinalLevelZone,
  side: LevelExtensionSelectionSide,
  referencePrice?: number,
): boolean {
  if (!referencePrice || referencePrice <= 0) {
    return true;
  }

  return side === "support"
    ? zone.representativePrice < referencePrice
    : zone.representativePrice > referencePrice;
}

type ExtensionCandidatePool = {
  candidates: FinalLevelZone[];
  mode: LevelExtensionCandidatePoolMode;
};

function resolveSupportExtensionCandidates(params: {
  supportZones: FinalLevelZone[];
  surfacedSupport: FinalLevelZone[];
  referencePrice?: number;
}): ExtensionCandidatePool {
  const lowestVisibleSupport =
    params.surfacedSupport.length > 0
      ? Math.min(...params.surfacedSupport.map((zone) => zone.representativePrice))
      : Infinity;
  const strictCandidates = sortSupport(
    params.supportZones.filter(
      (zone) =>
        zone.representativePrice < lowestVisibleSupport &&
        isOnExtensionSide(zone, "support", params.referencePrice),
    ),
  );

  if (strictCandidates.length > 0) {
    return {
      candidates: strictCandidates,
      mode: "strict_frontier",
    };
  }

  return {
    candidates: sortSupport(
      params.supportZones.filter(
        (zone) =>
          !matchesSurfacedZone(zone, params.surfacedSupport) &&
          isOnExtensionSide(zone, "support", params.referencePrice),
      ),
    ),
    mode: "expanded_unselected_scored",
  };
}

function resolveResistanceExtensionCandidates(params: {
  resistanceZones: FinalLevelZone[];
  surfacedResistance: FinalLevelZone[];
  referencePrice?: number;
  forwardPlanningRangePct: number;
}): ExtensionCandidatePool {
  const highestVisibleResistance =
    params.surfacedResistance.length > 0
      ? surfacedResistanceBoundary({
          surfaced: params.surfacedResistance,
          referencePrice: params.referencePrice,
          forwardPlanningRangePct: params.forwardPlanningRangePct,
        })
      : -Infinity;
  const maxPracticalResistance =
    maxPracticalResistancePrice(params.referencePrice, params.forwardPlanningRangePct);
  const strictCandidates = sortResistance(
    params.resistanceZones.filter(
      (zone) =>
        zone.representativePrice > highestVisibleResistance &&
        zone.representativePrice <= maxPracticalResistance &&
        isOnExtensionSide(zone, "resistance", params.referencePrice),
    ),
  );

  if (strictCandidates.length > 0) {
    return {
      candidates: strictCandidates,
      mode: "strict_frontier",
    };
  }

  return {
    candidates: sortResistance(
      params.resistanceZones.filter(
        (zone) =>
          !matchesSurfacedZone(zone, params.surfacedResistance) &&
          zone.representativePrice <= maxPracticalResistance &&
          isOnExtensionSide(zone, "resistance", params.referencePrice),
      ),
    ),
    mode: "expanded_unselected_scored",
  };
}

function isWrongSideOfReference(
  zone: FinalLevelZone,
  side: LevelExtensionSelectionSide,
  referencePrice?: number,
): boolean {
  if (!referencePrice || referencePrice <= 0) {
    return false;
  }

  return side === "support"
    ? zone.representativePrice >= referencePrice
    : zone.representativePrice <= referencePrice;
}

function isOutsidePracticalRange(params: {
  zone: FinalLevelZone;
  side: LevelExtensionSelectionSide;
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

function isBeyondExtensionBoundary(params: {
  zone: FinalLevelZone;
  side: LevelExtensionSelectionSide;
  surfaced: FinalLevelZone[];
  referencePrice?: number;
  forwardPlanningRangePct: number;
}): boolean {
  if (params.side === "support") {
    if (params.surfaced.length === 0) {
      return true;
    }

    const lowestVisibleSupport = Math.min(
      ...params.surfaced.map((zone) => zone.representativePrice),
    );
    return params.zone.representativePrice < lowestVisibleSupport;
  }

  const highestVisibleResistance =
    params.surfaced.length === 0
      ? -Infinity
      : surfacedResistanceBoundary({
          surfaced: params.surfaced,
          referencePrice: params.referencePrice,
          forwardPlanningRangePct: params.forwardPlanningRangePct,
        });

  return params.zone.representativePrice > highestVisibleResistance;
}

function coveragePct(
  side: LevelExtensionSelectionSide,
  referencePrice: number | undefined,
  zones: FinalLevelZone[],
): number | undefined {
  if (!referencePrice || referencePrice <= 0 || zones.length === 0) {
    return undefined;
  }

  const extensionPrice =
    side === "support"
      ? Math.min(...zones.map((zone) => zone.representativePrice))
      : Math.max(...zones.map((zone) => zone.representativePrice));

  return round((Math.abs(extensionPrice - referencePrice) / referencePrice) * 100);
}

function coverageFraction(
  side: LevelExtensionSelectionSide,
  referencePrice: number | undefined,
  zones: FinalLevelZone[],
): number | undefined {
  const percent = coveragePct(side, referencePrice, zones);
  return percent === undefined ? undefined : percent / 100;
}

function resolveSyntheticExtensionOptions(
  options: SyntheticExtensionOptions | undefined,
): Required<SyntheticExtensionOptions> {
  const resolved = {
    ...DEFAULT_SYNTHETIC_EXTENSION_OPTIONS,
    ...options,
  };

  return {
    enabled: resolved.enabled,
    minTargetCoveragePct: Math.max(0, resolved.minTargetCoveragePct),
    maxTargetCoveragePct: Math.max(
      resolved.minTargetCoveragePct,
      resolved.maxTargetCoveragePct,
    ),
    minSyntheticSpacingPct: Math.max(0, resolved.minSyntheticSpacingPct),
    maxSyntheticExtensionsPerSide: Math.max(
      0,
      Math.floor(resolved.maxSyntheticExtensionsPerSide),
    ),
  };
}

function roundToIncrement(value: number, increment: number, side: LevelExtensionSelectionSide): number {
  if (!Number.isFinite(value) || !Number.isFinite(increment) || increment <= 0) {
    return value;
  }

  const scaled = value / increment;
  const rounded =
    side === "resistance"
      ? Math.ceil(scaled - 1e-9)
      : Math.floor(scaled + 1e-9);

  return round(rounded * increment, 4);
}

function syntheticRoundIncrement(price: number): number {
  if (price < 1) {
    return 0.01;
  }
  if (price < 5) {
    return 0.05;
  }
  if (price < 20) {
    return 0.1;
  }

  return 0.5;
}

function syntheticPriceForCoverage(params: {
  side: LevelExtensionSelectionSide;
  referencePrice: number;
  coveragePct: number;
}): number {
  const rawPrice =
    params.side === "resistance"
      ? params.referencePrice * (1 + params.coveragePct)
      : params.referencePrice * (1 - params.coveragePct);

  return roundToIncrement(rawPrice, syntheticRoundIncrement(rawPrice), params.side);
}

function syntheticZoneBounds(price: number, spacingPct: number): { zoneLow: number; zoneHigh: number } {
  const halfWidthPct = Math.min(Math.max(spacingPct / 8, 0.001), 0.005);

  return {
    zoneLow: round(price * (1 - halfWidthPct)),
    zoneHigh: round(price * (1 + halfWidthPct)),
  };
}

function selectedExtensionCoverageIsHealthy(params: {
  side: LevelExtensionSelectionSide;
  referencePrice?: number;
  selected: FinalLevelZone[];
  minTargetCoveragePct: number;
}): boolean {
  const selectedCoverage = coverageFraction(params.side, params.referencePrice, params.selected);

  return selectedCoverage !== undefined && selectedCoverage >= params.minTargetCoveragePct;
}

function syntheticCoverageTargets(params: {
  selectedCoverage: number | undefined;
  availableSlots: number;
  minTargetCoveragePct: number;
  maxTargetCoveragePct: number;
}): number[] {
  if (params.availableSlots <= 0) {
    return [];
  }

  if (params.selectedCoverage !== undefined && params.selectedCoverage >= params.minTargetCoveragePct) {
    return [];
  }

  const targets = [params.minTargetCoveragePct];
  if (
    params.selectedCoverage === undefined &&
    params.availableSlots > 1 &&
    params.maxTargetCoveragePct > params.minTargetCoveragePct
  ) {
    targets.push(params.maxTargetCoveragePct);
  }

  return targets.slice(0, params.availableSlots);
}

function isSyntheticPriceOutsideSurfacedMap(params: {
  price: number;
  side: LevelExtensionSelectionSide;
  surfaced: FinalLevelZone[];
  referencePrice: number;
  forwardPlanningRangePct: number;
}): boolean {
  if (params.side === "support") {
    if (params.price <= 0 || params.price >= params.referencePrice) {
      return false;
    }
    if (params.surfaced.length === 0) {
      return false;
    }

    return params.price < Math.min(...params.surfaced.map((zone) => zone.representativePrice));
  }

  if (params.price <= params.referencePrice) {
    return false;
  }
  if (params.surfaced.length === 0) {
    return false;
  }

  return (
    params.price > surfacedResistanceBoundary({
      surfaced: params.surfaced,
      referencePrice: params.referencePrice,
      forwardPlanningRangePct: params.forwardPlanningRangePct,
    }) &&
    params.price <= maxPracticalResistancePrice(params.referencePrice, params.forwardPlanningRangePct)
  );
}

function syntheticExtensionId(params: {
  symbol: string;
  side: LevelExtensionSelectionSide;
  index: number;
  price: number;
}): string {
  const priceKey = params.price.toFixed(4).replace(".", "p");

  return `${params.symbol}-synthetic-${params.side}-extension-${params.index}-${priceKey}`;
}

function syntheticExtensionLevel(params: {
  symbol: string;
  side: LevelExtensionSelectionSide;
  price: number;
  index: number;
  referencePrice: number;
  targetCoveragePct: number;
  maxCoveragePct: number;
  spacingPct: number;
  limitation: "no_real_extension_candidate_available" | "real_extension_coverage_below_threshold";
}): FinalLevelZone {
  const bounds = syntheticZoneBounds(params.price, params.spacingPct);

  return {
    id: syntheticExtensionId({
      symbol: params.symbol,
      side: params.side,
      index: params.index,
      price: params.price,
    }),
    symbol: params.symbol,
    kind: params.side,
    timeframeBias: "mixed",
    zoneLow: bounds.zoneLow,
    zoneHigh: bounds.zoneHigh,
    representativePrice: params.price,
    strengthScore: 0,
    strengthLabel: "weak",
    touchCount: 0,
    confluenceCount: 0,
    sourceTypes: [],
    timeframeSources: [],
    reactionQualityScore: 0,
    rejectionScore: 0,
    displacementScore: 0,
    sessionSignificanceScore: 0,
    followThroughScore: 0,
    sourceEvidenceCount: 0,
    firstTimestamp: 0,
    lastTimestamp: 0,
    isExtension: true,
    freshness: "fresh",
    notes: [SYNTHETIC_EXTENSION_NOTE],
    extensionMetadata: {
      extensionSource: "synthetic_continuation_map",
      generationMethod: "round_number_ladder",
      referencePrice: params.referencePrice,
      targetCoveragePct: params.targetCoveragePct,
      maxCoveragePct: params.maxCoveragePct,
      syntheticIndex: params.index,
      evidenceLimitations: [
        params.limitation,
        "not_historical_support_resistance",
        "no_touch_or_rejection_history",
        "no_historical_confluence",
      ],
    },
  };
}

function applySyntheticExtensionFallback(params: {
  selected: FinalLevelZone[];
  surfaced: FinalLevelZone[];
  side: LevelExtensionSelectionSide;
  maxExtensionPerSide: number;
  referencePrice?: number;
  spacingPct: number;
  forwardPlanningRangePct: number;
  syntheticOptions: Required<SyntheticExtensionOptions>;
}): FinalLevelZone[] {
  if (
    !params.syntheticOptions.enabled ||
    !params.referencePrice ||
    params.referencePrice <= 0 ||
    params.surfaced.length === 0 ||
    selectedExtensionCoverageIsHealthy({
      side: params.side,
      referencePrice: params.referencePrice,
      selected: params.selected,
      minTargetCoveragePct: params.syntheticOptions.minTargetCoveragePct,
    })
  ) {
    return params.selected;
  }

  const selectedCoverage = coverageFraction(params.side, params.referencePrice, params.selected);
  const availableSlots = Math.min(
    params.syntheticOptions.maxSyntheticExtensionsPerSide,
    Math.max(0, params.maxExtensionPerSide - params.selected.length),
  );
  const sideMaxCoveragePct =
    params.side === "support" && params.referencePrice < 1
      ? Math.min(
          params.syntheticOptions.maxTargetCoveragePct,
          LOW_PRICE_SUPPORT_MAX_SYNTHETIC_COVERAGE_PCT,
        )
      : params.syntheticOptions.maxTargetCoveragePct;
  const coverageTargets = syntheticCoverageTargets({
    selectedCoverage,
    availableSlots,
    minTargetCoveragePct: params.syntheticOptions.minTargetCoveragePct,
    maxTargetCoveragePct: sideMaxCoveragePct,
  });
  if (coverageTargets.length === 0) {
    return params.selected;
  }

  const spacingPct = Math.max(params.spacingPct, params.syntheticOptions.minSyntheticSpacingPct);
  const syntheticLevels: FinalLevelZone[] = [];
  const symbol =
    params.surfaced[0]?.symbol ??
    params.selected[0]?.symbol ??
    "UNKNOWN";
  const limitation =
    params.selected.length === 0
      ? "no_real_extension_candidate_available"
      : "real_extension_coverage_below_threshold";

  for (const targetCoveragePct of coverageTargets) {
    const syntheticPrice = syntheticPriceForCoverage({
      side: params.side,
      referencePrice: params.referencePrice,
      coveragePct: targetCoveragePct,
    });
    const existingLevels = [...params.surfaced, ...params.selected, ...syntheticLevels];
    const candidate = syntheticExtensionLevel({
      symbol,
      side: params.side,
      price: syntheticPrice,
      index: syntheticLevels.length + 1,
      referencePrice: params.referencePrice,
      targetCoveragePct,
      maxCoveragePct: sideMaxCoveragePct,
      spacingPct,
      limitation,
    });

    if (
      !isSyntheticPriceOutsideSurfacedMap({
        price: syntheticPrice,
        side: params.side,
        surfaced: params.surfaced,
        referencePrice: params.referencePrice,
        forwardPlanningRangePct: params.forwardPlanningRangePct,
      }) ||
      isTooCloseToAny(candidate, existingLevels, spacingPct)
    ) {
      continue;
    }

    syntheticLevels.push(candidate);
  }

  return sortBySide([...params.selected, ...syntheticLevels], params.side);
}

function buildRejectionReasonCounts(
  candidates: LevelExtensionCandidateSelectionDiagnostic[],
): Partial<Record<LevelExtensionSelectionSkipReason, number>> {
  const counts: Partial<Record<LevelExtensionSelectionSkipReason, number>> = {};

  for (const candidate of candidates) {
    for (const reason of candidate.skipReasons) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }

  return counts;
}

function candidateSkipReasons(params: {
  zone: FinalLevelZone;
  side: LevelExtensionSelectionSide;
  surfaced: FinalLevelZone[];
  surfacedIds: Set<string>;
  preSelectionCandidateIds: Set<string>;
  prunedCandidateIds: Set<string>;
  selected: FinalLevelZone[];
  selectedIds: Set<string>;
  referencePrice?: number;
  spacingPct: number;
  forwardPlanningRangePct: number;
}): LevelExtensionSelectionSkipReason[] {
  if (params.selectedIds.has(params.zone.id)) {
    return ["selected_extension"];
  }

  const reasons: LevelExtensionSelectionSkipReason[] = [];

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
  if (!isBeyondExtensionBoundary({
    zone: params.zone,
    side: params.side,
    surfaced: params.surfaced,
    referencePrice: params.referencePrice,
    forwardPlanningRangePct: params.forwardPlanningRangePct,
  })) {
    reasons.push("inside_surfaced_map");
  }
  if (isTooCloseToAny(params.zone, params.surfaced, params.spacingPct)) {
    reasons.push("too_close_to_surfaced_level");
  }
  if (
    params.preSelectionCandidateIds.has(params.zone.id) &&
    !params.prunedCandidateIds.has(params.zone.id)
  ) {
    reasons.push("dominated_by_forward_candidate");
  }
  if (isTooCloseToAny(params.zone, params.selected, params.spacingPct)) {
    reasons.push("too_close_to_another_extension");
  }
  if (
    reasons.length === 0 &&
    params.preSelectionCandidateIds.has(params.zone.id) &&
    params.prunedCandidateIds.has(params.zone.id)
  ) {
    reasons.push("not_selected_by_ladder_selection");
  }

  return reasons.length > 0 ? reasons : ["undetermined"];
}

function buildSelectionSideDiagnostics(params: {
  side: LevelExtensionSelectionSide;
  allZones: FinalLevelZone[];
  surfaced: FinalLevelZone[];
  preSelectionCandidates: FinalLevelZone[];
  candidatePoolMode: LevelExtensionCandidatePoolMode;
  selected: FinalLevelZone[];
  referencePrice?: number;
  spacingPct: number;
  searchWindowPct: number;
  forwardPlanningRangePct: number;
}): LevelExtensionSelectionSideDiagnostics {
  const surfacedIds = zoneIdSet(params.surfaced);
  const selectedIds = zoneIdSet(params.selected);
  const preSelectionCandidateIds = zoneIdSet(params.preSelectionCandidates);
  const prunedCandidates = pruneDominatedForwardCandidates(
    params.preSelectionCandidates,
    params.side,
    params.searchWindowPct,
  );
  const prunedCandidateIds = zoneIdSet(prunedCandidates);
  const eligibleCandidates = prunedCandidates.filter(
    (candidate) => !isTooCloseToAny(candidate, params.surfaced, params.spacingPct),
  );
  const eligibleCandidateIds = zoneIdSet(eligibleCandidates);

  const candidates = sortBySide(params.allZones, params.side).map((zone) => {
    const skipReasons = candidateSkipReasons({
      zone,
      side: params.side,
      surfaced: params.surfaced,
      surfacedIds,
      preSelectionCandidateIds,
      prunedCandidateIds,
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
      isPreSelectionCandidate: preSelectionCandidateIds.has(zone.id),
      isEligibleExtensionCandidate: eligibleCandidateIds.has(zone.id),
      isSelectedExtension: selectedIds.has(zone.id),
      usefulnessScore: round(extensionUsefulnessScore(zone)),
      skipReasons,
    };
  });

  return {
    side: params.side,
    referencePrice: params.referencePrice,
    surfacedLevelPrices: sortedPrices(params.surfaced, params.side),
    inputInventoryPrices: sortedPrices(params.allZones, params.side),
    candidatePoolMode: params.candidatePoolMode,
    preSelectionCandidatePrices: sortedPrices(params.preSelectionCandidates, params.side),
    eligibleCandidatePrices: sortedPrices(eligibleCandidates, params.side),
    selectedExtensionPrices: sortedPrices(params.selected, params.side),
    skippedCandidatePrices: candidates
      .filter((candidate) => !candidate.isSelectedExtension)
      .map((candidate) => candidate.price),
    candidateCoveragePct: coveragePct(params.side, params.referencePrice, eligibleCandidates),
    selectedCoveragePct: coveragePct(params.side, params.referencePrice, params.selected),
    insufficientCandidateInventory: eligibleCandidates.length === 0,
    candidates,
    rejectionReasonCounts: buildRejectionReasonCounts(candidates),
  };
}

function buildSelectionDiagnostics(params: {
  supportZones: FinalLevelZone[];
  resistanceZones: FinalLevelZone[];
  surfacedSupport: FinalLevelZone[];
  surfacedResistance: FinalLevelZone[];
  supportCandidates: FinalLevelZone[];
  resistanceCandidates: FinalLevelZone[];
  supportCandidatePoolMode: LevelExtensionCandidatePoolMode;
  resistanceCandidatePoolMode: LevelExtensionCandidatePoolMode;
  selectedExtensions: LevelLadderExtension;
  maxExtensionPerSide: number;
  spacingPct: number;
  searchWindowPct: number;
  referencePrice?: number;
  forwardPlanningRangePct: number;
}): LevelExtensionSelectionDiagnostics {
  return {
    support: buildSelectionSideDiagnostics({
      side: "support",
      allZones: params.supportZones,
      surfaced: params.surfacedSupport,
      preSelectionCandidates: params.supportCandidates,
      candidatePoolMode: params.supportCandidatePoolMode,
      selected: params.selectedExtensions.support,
      referencePrice: params.referencePrice,
      spacingPct: params.spacingPct,
      searchWindowPct: params.searchWindowPct,
      forwardPlanningRangePct: params.forwardPlanningRangePct,
    }),
    resistance: buildSelectionSideDiagnostics({
      side: "resistance",
      allZones: params.resistanceZones,
      surfaced: params.surfacedResistance,
      preSelectionCandidates: params.resistanceCandidates,
      candidatePoolMode: params.resistanceCandidatePoolMode,
      selected: params.selectedExtensions.resistance,
      referencePrice: params.referencePrice,
      spacingPct: params.spacingPct,
      searchWindowPct: params.searchWindowPct,
      forwardPlanningRangePct: params.forwardPlanningRangePct,
    }),
    config: {
      maxExtensionPerSide: params.maxExtensionPerSide,
      spacingPct: params.spacingPct,
      searchWindowPct: params.searchWindowPct,
      forwardPlanningRangePct: params.forwardPlanningRangePct,
    },
    safety: {
      extensionGenerationUnchanged: true,
      diagnosticOnly: true,
    },
  };
}

function selectBestCandidate(
  candidates: FinalLevelZone[],
  boundary: number,
): FinalLevelZone | null {
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort(
    (a, b) =>
      extensionUsefulnessScore(b) - extensionUsefulnessScore(a) ||
      b.followThroughScore - a.followThroughScore ||
      b.strengthScore - a.strengthScore ||
      distanceFromBoundaryPct(boundary, a.representativePrice) -
        distanceFromBoundaryPct(boundary, b.representativePrice),
  )[0]!;
}

function selectNearContinuityCandidate(
  candidates: FinalLevelZone[],
  boundary: number,
): FinalLevelZone | null {
  if (candidates.length === 0) {
    return null;
  }

  const closestCandidate = [...candidates].sort(
    (a, b) =>
      distanceFromBoundaryPct(boundary, a.representativePrice) -
        distanceFromBoundaryPct(boundary, b.representativePrice) ||
      extensionUsefulnessScore(b) - extensionUsefulnessScore(a),
  )[0]!;
  const bestCandidate = selectBestCandidate(candidates, boundary);
  if (!bestCandidate) {
    return closestCandidate;
  }

  const closestActionable =
    isActionableForwardCandidate(closestCandidate);
  const scoreGap =
    extensionUsefulnessScore(bestCandidate) - extensionUsefulnessScore(closestCandidate);

  if (closestActionable && scoreGap <= 6) {
    return closestCandidate;
  }

  return bestCandidate;
}

function removeSelectedNeighborhood(
  candidates: FinalLevelZone[],
  selected: FinalLevelZone,
  side: "support" | "resistance",
  spacingPct: number,
  preserveInterior: boolean = false,
): FinalLevelZone[] {
  return candidates.filter((candidate) => {
    if (candidate.id === selected.id) {
      return false;
    }

    if (proximityPct(candidate, selected) <= spacingPct) {
      return false;
    }

    if (preserveInterior) {
      return true;
    }

    return side === "resistance"
      ? candidate.representativePrice > selected.representativePrice
      : candidate.representativePrice < selected.representativePrice;
  });
}

function selectContinuityAwareResistanceExtensions(params: {
  candidates: FinalLevelZone[];
  surfaced: FinalLevelZone[];
  maxCount: number;
  spacingPct: number;
  searchWindowPct: number;
  referencePrice?: number;
  forwardPlanningRangePct: number;
}): FinalLevelZone[] {
  const selected: FinalLevelZone[] = [];
  const maxPracticalPrice = maxPracticalResistancePrice(
    params.referencePrice,
    params.forwardPlanningRangePct,
  );
  let remaining = [...params.candidates].filter(
    (candidate) => !isTooCloseToAny(candidate, params.surfaced, params.spacingPct),
  );
  const startBoundary = surfacedResistanceBoundary({
    surfaced: params.surfaced,
    referencePrice: params.referencePrice,
    forwardPlanningRangePct: params.forwardPlanningRangePct,
  });

  const practicalRemaining = remaining.filter(
    (candidate) => candidate.representativePrice <= maxPracticalPrice,
  );
  const preferredRemaining = practicalRemaining.length > 0 ? practicalRemaining : remaining;

  const nearFrontier = preferredRemaining.filter(
    (candidate) =>
      !Number.isFinite(startBoundary) ||
      distanceFromBoundaryPct(startBoundary, candidate.representativePrice) <= params.searchWindowPct,
  );
  const nearCandidate = selectNearContinuityCandidate(
    nearFrontier.length > 0 ? nearFrontier : preferredRemaining.slice(0, 1),
    startBoundary,
  );
  if (nearCandidate) {
    selected.push({ ...nearCandidate, isExtension: true });
    remaining = removeSelectedNeighborhood(
      remaining,
      nearCandidate,
      "resistance",
      params.spacingPct,
    );
  }

  if (selected.length >= params.maxCount || remaining.length === 0) {
    return selected;
  }

  const practicalFarCandidate = remaining
    .filter((candidate) => candidate.representativePrice <= maxPracticalPrice)
    .at(-1);
  const farCandidate = practicalFarCandidate ?? remaining.at(-1);
  if (farCandidate && !isTooCloseToAny(farCandidate, selected, params.spacingPct)) {
    selected.push({ ...farCandidate, isExtension: true });
    remaining = removeSelectedNeighborhood(
      remaining,
      farCandidate,
      "resistance",
      params.spacingPct,
      true,
    );
  }

  if (selected.length >= params.maxCount || remaining.length === 0) {
    return [...selected].sort((a, b) => a.representativePrice - b.representativePrice);
  }

  const lowerBound = Math.min(...selected.map((zone) => zone.representativePrice));
  const upperBound = Math.max(...selected.map((zone) => zone.representativePrice));
  const middleCandidates = remaining.filter(
    (candidate) =>
      candidate.representativePrice > lowerBound &&
      candidate.representativePrice < upperBound,
  );
  const middleSlots = params.maxCount - selected.length;

  for (let slot = 0; slot < middleSlots; slot += 1) {
    if (middleCandidates.length === 0) {
      break;
    }

    const start = Math.floor((slot * middleCandidates.length) / middleSlots);
    const end = Math.floor(((slot + 1) * middleCandidates.length) / middleSlots);
    const segment = middleCandidates.slice(start, Math.max(end, start + 1));
    const bestInSegment = selectBestCandidate(
      segment.filter((candidate) => !isTooCloseToAny(candidate, selected, params.spacingPct)),
      lowerBound,
    );

    if (!bestInSegment) {
      continue;
    }

    selected.push({ ...bestInSegment, isExtension: true });
  }

  return [...selected]
    .sort((a, b) => a.representativePrice - b.representativePrice)
    .slice(0, params.maxCount);
}

function selectSpacedExtensions(params: {
  candidates: FinalLevelZone[];
  surfaced: FinalLevelZone[];
  side: "support" | "resistance";
  maxCount: number;
  spacingPct: number;
  searchWindowPct: number;
  referencePrice?: number;
  forwardPlanningRangePct?: number;
}): FinalLevelZone[] {
  const candidates = pruneDominatedForwardCandidates(
    params.candidates,
    params.side,
    params.searchWindowPct,
  );
  const forwardPlanningRangePct =
    params.forwardPlanningRangePct ?? DEFAULT_FORWARD_PLANNING_RANGE_PCT;
  if (params.side === "resistance" && params.maxCount >= 3) {
    return selectContinuityAwareResistanceExtensions({
      candidates,
      surfaced: params.surfaced,
      maxCount: params.maxCount,
      spacingPct: params.spacingPct,
      searchWindowPct: params.searchWindowPct,
      referencePrice: params.referencePrice,
      forwardPlanningRangePct,
    });
  }

  const selected: FinalLevelZone[] = [];
  const startBoundary =
    params.surfaced.length === 0
      ? params.side === "resistance"
        ? -Infinity
        : Infinity
      : params.side === "resistance"
        ? surfacedResistanceBoundary({
            surfaced: params.surfaced,
            referencePrice: params.referencePrice,
            forwardPlanningRangePct,
          })
        : Math.min(...params.surfaced.map((zone) => zone.representativePrice));
  let boundary = startBoundary;
  let remaining = [...candidates];
  const maxPracticalPrice =
    params.side === "resistance" &&
    params.referencePrice &&
    params.referencePrice > 0
      ? params.referencePrice * (1 + forwardPlanningRangePct)
      : Number.POSITIVE_INFINITY;

  while (remaining.length > 0 && selected.length < params.maxCount) {
    const preferredRemaining =
      params.side === "resistance"
        ? (() => {
            const practical = remaining.filter(
              (candidate) => candidate.representativePrice <= maxPracticalPrice,
            );
            return practical.length > 0 ? practical : remaining;
          })()
        : remaining;
    const frontier = preferredRemaining.filter((candidate) => {
      if (params.side === "resistance") {
        if (candidate.representativePrice <= boundary) {
          return false;
        }

        return (
          !Number.isFinite(boundary) ||
          distanceFromBoundaryPct(boundary, candidate.representativePrice) <= params.searchWindowPct
        );
      }

      if (candidate.representativePrice >= boundary) {
        return false;
      }

      return (
        !Number.isFinite(boundary) ||
        distanceFromBoundaryPct(boundary, candidate.representativePrice) <= params.searchWindowPct
      );
    });

    const candidatePool = frontier.length > 0 ? frontier : [preferredRemaining[0]!];
    const best = [...candidatePool].sort(
      (a, b) =>
        extensionUsefulnessScore(b) - extensionUsefulnessScore(a) ||
        b.followThroughScore - a.followThroughScore ||
        b.strengthScore - a.strengthScore ||
        distanceFromBoundaryPct(boundary, a.representativePrice) -
          distanceFromBoundaryPct(boundary, b.representativePrice),
    )[0]!;

    const tooCloseToSurfaced = params.surfaced.some(
      (surfaced) => proximityPct(surfaced, best) <= params.spacingPct,
    );
    const tooCloseToSelected = selected.some(
      (existing) => proximityPct(existing, best) <= params.spacingPct,
    );

    if (!tooCloseToSurfaced && !tooCloseToSelected) {
      selected.push({ ...best, isExtension: true });
    }

    boundary = best.representativePrice;
    remaining = remaining.filter((candidate) => {
      if (candidate.id === best.id) {
        return false;
      }

      if (proximityPct(candidate, best) <= params.spacingPct) {
        return false;
      }

      return params.side === "resistance"
        ? candidate.representativePrice > boundary
        : candidate.representativePrice < boundary;
    });
  }

  return selected;
}

export function buildLevelExtensionSelectionDiagnostics(
  params: BuildLevelExtensionsParams & { selectedExtensions: LevelLadderExtension },
): LevelExtensionSelectionDiagnostics {
  const maxExtensionPerSide = params.maxExtensionPerSide ?? 3;
  const spacingPct = params.spacingPct ?? 0.01;
  const searchWindowPct = params.searchWindowPct ?? 0.05;
  const forwardPlanningRangePct =
    params.forwardPlanningRangePct ?? DEFAULT_FORWARD_PLANNING_RANGE_PCT;
  const supportCandidatePool = resolveSupportExtensionCandidates({
    supportZones: params.supportZones,
    surfacedSupport: params.surfacedSupport,
    referencePrice: params.referencePrice,
  });
  const resistanceCandidatePool = resolveResistanceExtensionCandidates({
    resistanceZones: params.resistanceZones,
    surfacedResistance: params.surfacedResistance,
    referencePrice: params.referencePrice,
    forwardPlanningRangePct,
  });

  return buildSelectionDiagnostics({
    supportZones: params.supportZones,
    resistanceZones: params.resistanceZones,
    surfacedSupport: params.surfacedSupport,
    surfacedResistance: params.surfacedResistance,
    supportCandidates: supportCandidatePool.candidates,
    resistanceCandidates: resistanceCandidatePool.candidates,
    supportCandidatePoolMode: supportCandidatePool.mode,
    resistanceCandidatePoolMode: resistanceCandidatePool.mode,
    selectedExtensions: params.selectedExtensions,
    maxExtensionPerSide,
    spacingPct,
    searchWindowPct,
    referencePrice: params.referencePrice,
    forwardPlanningRangePct,
  });
}

export function buildLevelExtensionsWithDiagnostics(
  params: BuildLevelExtensionsParams,
): BuildLevelExtensionsWithDiagnosticsResult {
  const maxExtensionPerSide = params.maxExtensionPerSide ?? 3;
  const spacingPct = params.spacingPct ?? 0.01;
  const searchWindowPct = params.searchWindowPct ?? 0.05;
  const forwardPlanningRangePct =
    params.forwardPlanningRangePct ?? DEFAULT_FORWARD_PLANNING_RANGE_PCT;
  const syntheticOptions = resolveSyntheticExtensionOptions(params.syntheticExtensionOptions);
  const supportCandidatePool = resolveSupportExtensionCandidates({
    supportZones: params.supportZones,
    surfacedSupport: params.surfacedSupport,
    referencePrice: params.referencePrice,
  });
  const resistanceCandidatePool = resolveResistanceExtensionCandidates({
    resistanceZones: params.resistanceZones,
    surfacedResistance: params.surfacedResistance,
    referencePrice: params.referencePrice,
    forwardPlanningRangePct,
  });
  const realSupportExtensions = selectSpacedExtensions({
      candidates: supportCandidatePool.candidates,
      surfaced: params.surfacedSupport,
      side: "support",
      maxCount: maxExtensionPerSide,
      spacingPct,
      searchWindowPct,
      referencePrice: params.referencePrice,
      forwardPlanningRangePct,
  });
  const realResistanceExtensions = selectSpacedExtensions({
      candidates: resistanceCandidatePool.candidates,
      surfaced: params.surfacedResistance,
      side: "resistance",
      maxCount: maxExtensionPerSide,
      spacingPct,
      searchWindowPct,
      referencePrice: params.referencePrice,
      forwardPlanningRangePct,
  });
  const extensionLevels = {
    support: applySyntheticExtensionFallback({
      selected: realSupportExtensions,
      surfaced: params.surfacedSupport,
      side: "support",
      maxExtensionPerSide,
      spacingPct,
      referencePrice: params.referencePrice,
      forwardPlanningRangePct,
      syntheticOptions,
    }),
    resistance: applySyntheticExtensionFallback({
      selected: realResistanceExtensions,
      surfaced: params.surfacedResistance,
      side: "resistance",
      maxExtensionPerSide,
      spacingPct,
      referencePrice: params.referencePrice,
      forwardPlanningRangePct,
      syntheticOptions,
    }),
  };

  return {
    extensionLevels,
    diagnostics: buildLevelExtensionSelectionDiagnostics({
      ...params,
      selectedExtensions: extensionLevels,
    }),
  };
}

export function buildLevelExtensions(params: BuildLevelExtensionsParams): LevelLadderExtension {
  const maxExtensionPerSide = params.maxExtensionPerSide ?? 3;
  const spacingPct = params.spacingPct ?? 0.01;
  const searchWindowPct = params.searchWindowPct ?? 0.05;
  const forwardPlanningRangePct =
    params.forwardPlanningRangePct ?? DEFAULT_FORWARD_PLANNING_RANGE_PCT;
  const syntheticOptions = resolveSyntheticExtensionOptions(params.syntheticExtensionOptions);
  const supportCandidatePool = resolveSupportExtensionCandidates({
    supportZones: params.supportZones,
    surfacedSupport: params.surfacedSupport,
    referencePrice: params.referencePrice,
  });
  const resistanceCandidatePool = resolveResistanceExtensionCandidates({
    resistanceZones: params.resistanceZones,
    surfacedResistance: params.surfacedResistance,
    referencePrice: params.referencePrice,
    forwardPlanningRangePct,
  });
  const realSupportExtensions = selectSpacedExtensions({
    candidates: supportCandidatePool.candidates,
    surfaced: params.surfacedSupport,
    side: "support",
    maxCount: maxExtensionPerSide,
    spacingPct,
    searchWindowPct,
    referencePrice: params.referencePrice,
    forwardPlanningRangePct,
  });
  const realResistanceExtensions = selectSpacedExtensions({
    candidates: resistanceCandidatePool.candidates,
    surfaced: params.surfacedResistance,
    side: "resistance",
    maxCount: maxExtensionPerSide,
    spacingPct,
    searchWindowPct,
    referencePrice: params.referencePrice,
    forwardPlanningRangePct,
  });

  return {
    support: applySyntheticExtensionFallback({
      selected: realSupportExtensions,
      surfaced: params.surfacedSupport,
      side: "support",
      maxExtensionPerSide,
      spacingPct,
      referencePrice: params.referencePrice,
      forwardPlanningRangePct,
      syntheticOptions,
    }),
    resistance: applySyntheticExtensionFallback({
      selected: realResistanceExtensions,
      surfaced: params.surfacedResistance,
      side: "resistance",
      maxExtensionPerSide,
      spacingPct,
      referencePrice: params.referencePrice,
      forwardPlanningRangePct,
      syntheticOptions,
    }),
  };
}
