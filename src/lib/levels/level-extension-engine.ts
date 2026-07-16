import type { FinalLevelZone, LevelLadderExtension } from "./level-types.js";

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
const SYNTHETIC_RESISTANCE_MIN_COVERAGE_PCT = 0.30;
const SYNTHETIC_RESISTANCE_MIN_STEP_PCT = 0.03;

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
  preservePracticalResistanceCoverage?: boolean;
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

  if (params.preservePracticalResistanceCoverage && selected.length < params.maxCount) {
    for (const candidate of remaining) {
      if (!isActionableForwardCandidate(candidate)) {
        continue;
      }
      if (isTooCloseToAny(candidate, params.surfaced, params.spacingPct)) {
        continue;
      }
      if (isTooCloseToAny(candidate, selected, params.spacingPct)) {
        continue;
      }

      selected.push({ ...candidate, isExtension: true });
      if (selected.length >= params.maxCount) {
        break;
      }
    }

    if (selected.length >= params.maxCount || remaining.length === 0) {
      return [...selected].sort((a, b) => a.representativePrice - b.representativePrice);
    }
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

  if (params.preservePracticalResistanceCoverage && selected.length < params.maxCount) {
    const selectedIds = new Set(selected.map((zone) => zone.id));
    const coverageCandidates = params.candidates
      .filter((candidate) => candidate.representativePrice <= maxPracticalPrice)
      .filter((candidate) => !selectedIds.has(candidate.id))
      .filter((candidate) => !isTooCloseToAny(candidate, params.surfaced, params.spacingPct))
      .filter((candidate) => !isTooCloseToAny(candidate, selected, params.spacingPct));

    for (const candidate of coverageCandidates) {
      selected.push({ ...candidate, isExtension: true });
      if (selected.length >= params.maxCount) {
        break;
      }
    }
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
  preservePracticalResistanceCoverage?: boolean;
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
      preservePracticalResistanceCoverage: params.preservePracticalResistanceCoverage,
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

function decimalPlacesForIncrement(increment: number): number {
  const text = increment.toString();
  const dotIndex = text.indexOf(".");
  return dotIndex === -1 ? 0 : text.length - dotIndex - 1;
}

function normalizeSyntheticPrice(price: number, increment: number): number {
  return Number(price.toFixed(Math.max(decimalPlacesForIncrement(increment), price >= 1 ? 2 : 4)));
}

function resistanceExtensionIncrement(price: number): number {
  if (price < 0.5) return 0.025;
  if (price < 1) return 0.05;
  if (price < 2) return 0.1;
  if (price < 5) return 0.25;
  if (price < 10) return 0.5;
  if (price < 25) return 1;
  if (price < 50) return 2.5;
  return 5;
}

function nextRoundedResistanceExtension(basePrice: number): number {
  const increment = resistanceExtensionIncrement(basePrice);
  const rounded = Math.ceil((basePrice + increment * 0.05) / increment) * increment;
  return normalizeSyntheticPrice(rounded, increment);
}

function buildSyntheticResistanceExtension(params: {
  symbol: string;
  price: number;
  referencePrice: number;
}): FinalLevelZone {
  const widthPct = params.price < 1 ? 0.0025 : 0.0015;
  const halfWidth = params.price * widthPct;

  return {
    id: `${params.symbol}-synthetic-resistance-extension-${params.price}`,
    symbol: params.symbol,
    kind: "resistance",
    timeframeBias: "5m",
    zoneLow: Number((params.price - halfWidth).toFixed(6)),
    zoneHigh: Number((params.price + halfWidth).toFixed(6)),
    representativePrice: params.price,
    strengthScore: 8,
    strengthLabel: "weak",
    touchCount: 0,
    confluenceCount: 0,
    sourceTypes: ["swing_high"],
    timeframeSources: ["5m"],
    reactionQualityScore: 0,
    rejectionScore: 0,
    displacementScore: 0,
    sessionSignificanceScore: 0,
    followThroughScore: 0,
    sourceEvidenceCount: 0,
    firstTimestamp: Date.now(),
    lastTimestamp: Date.now(),
    isExtension: true,
    freshness: "fresh",
    notes: [
      `Synthetic continuation extension generated after historical resistance inventory ended above ${params.referencePrice}.`,
    ],
  };
}

function extendSyntheticResistanceCoverage(params: {
  symbol: string;
  selectedResistance: FinalLevelZone[];
  surfacedResistance: FinalLevelZone[];
  referencePrice?: number;
  forwardPlanningRangePct: number;
  maxCount: number;
  spacingPct: number;
}): FinalLevelZone[] {
  const referencePrice = params.referencePrice;
  if (
    !referencePrice ||
    referencePrice <= 0 ||
    params.selectedResistance.length >= params.maxCount ||
    (params.selectedResistance.length === 0 && params.surfacedResistance.length === 0)
  ) {
    return params.selectedResistance;
  }

  const maxPracticalPrice = maxPracticalResistancePrice(
    referencePrice,
    params.forwardPlanningRangePct,
  );
  const targetPrice = Math.min(
    maxPracticalPrice,
    referencePrice * (1 + Math.min(SYNTHETIC_RESISTANCE_MIN_COVERAGE_PCT, params.forwardPlanningRangePct)),
  );
  const highestExisting = Math.max(
    referencePrice,
    ...params.surfacedResistance.map((zone) => zone.representativePrice),
    ...params.selectedResistance.map((zone) => zone.representativePrice),
  );

  if (highestExisting >= targetPrice) {
    return params.selectedResistance;
  }

  const selected = [...params.selectedResistance].sort(
    (left, right) => left.representativePrice - right.representativePrice,
  );
  let boundary = highestExisting;
  const seenPrices = new Set(
    [...params.surfacedResistance, ...selected].map((zone) =>
      zone.representativePrice >= 1
        ? zone.representativePrice.toFixed(2)
        : zone.representativePrice.toFixed(4),
    ),
  );

  while (selected.length < params.maxCount && boundary < targetPrice) {
    let nextPrice = nextRoundedResistanceExtension(boundary);
    while (
      nextPrice <= boundary * (1 + Math.max(params.spacingPct, SYNTHETIC_RESISTANCE_MIN_STEP_PCT)) &&
      nextPrice < maxPracticalPrice
    ) {
      nextPrice = nextRoundedResistanceExtension(nextPrice);
    }

    if (nextPrice <= boundary || nextPrice > maxPracticalPrice) {
      break;
    }

    const key = nextPrice >= 1 ? nextPrice.toFixed(2) : nextPrice.toFixed(4);
    boundary = nextPrice;
    if (seenPrices.has(key)) {
      continue;
    }

    selected.push(
      buildSyntheticResistanceExtension({
        symbol: params.symbol,
        price: nextPrice,
        referencePrice,
      }),
    );
    seenPrices.add(key);
  }

  return selected.sort((left, right) => left.representativePrice - right.representativePrice);
}

export function buildLevelExtensions(params: {
  supportZones: FinalLevelZone[];
  resistanceZones: FinalLevelZone[];
  surfacedSupport: FinalLevelZone[];
  surfacedResistance: FinalLevelZone[];
  maxExtensionPerSide?: number;
  spacingPct?: number;
  searchWindowPct?: number;
  referencePrice?: number;
  forwardPlanningRangePct?: number;
  preservePracticalResistanceCoverage?: boolean;
  allowSyntheticResistanceExtensions?: boolean;
}): LevelLadderExtension {
  const maxExtensionPerSide = params.maxExtensionPerSide ?? 3;
  const spacingPct = params.spacingPct ?? 0.01;
  const searchWindowPct = params.searchWindowPct ?? 0.05;
  const forwardPlanningRangePct =
    params.forwardPlanningRangePct ?? DEFAULT_FORWARD_PLANNING_RANGE_PCT;
  const lowestVisibleSupport =
    params.surfacedSupport.length > 0
      ? Math.min(...params.surfacedSupport.map((zone) => zone.representativePrice))
      : Infinity;
  const highestVisibleResistance =
    params.surfacedResistance.length > 0
      ? surfacedResistanceBoundary({
          surfaced: params.surfacedResistance,
          referencePrice: params.referencePrice,
          forwardPlanningRangePct,
        })
      : -Infinity;
  const maxPracticalResistance =
    maxPracticalResistancePrice(params.referencePrice, forwardPlanningRangePct);

  const support = selectSpacedExtensions({
      candidates: sortSupport(
        params.supportZones.filter((zone) => zone.representativePrice < lowestVisibleSupport),
      ),
      surfaced: params.surfacedSupport,
      side: "support",
      maxCount: maxExtensionPerSide,
      spacingPct,
      searchWindowPct,
      referencePrice: params.referencePrice,
      forwardPlanningRangePct,
    });
  const selectedResistance = selectSpacedExtensions({
      candidates: sortResistance(
        params.resistanceZones.filter(
          (zone) =>
            zone.representativePrice > highestVisibleResistance &&
            zone.representativePrice <= maxPracticalResistance,
        ),
      ),
      surfaced: params.surfacedResistance,
      side: "resistance",
      maxCount: maxExtensionPerSide,
      spacingPct,
      searchWindowPct,
      referencePrice: params.referencePrice,
      forwardPlanningRangePct,
      preservePracticalResistanceCoverage: params.preservePracticalResistanceCoverage,
    });
  const resistance = params.allowSyntheticResistanceExtensions
    ? extendSyntheticResistanceCoverage({
        symbol: params.resistanceZones[0]?.symbol ?? params.surfacedResistance[0]?.symbol ?? "",
        selectedResistance,
        surfacedResistance: params.surfacedResistance,
        referencePrice: params.referencePrice,
        forwardPlanningRangePct,
        maxCount: maxExtensionPerSide,
        spacingPct,
      })
    : selectedResistance;

  return {
    support,
    resistance,
  };
}
