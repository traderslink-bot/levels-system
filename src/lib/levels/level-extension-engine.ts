import type { FinalLevelZone, LevelLadderExtension } from "./level-types.js";

function sortSupport(zones: FinalLevelZone[]): FinalLevelZone[] {
  return [...zones].sort((a, b) => b.representativePrice - a.representativePrice);
}

function sortResistance(zones: FinalLevelZone[]): FinalLevelZone[] {
  return [...zones].sort((a, b) => a.representativePrice - b.representativePrice);
}

function extensionUsefulnessScore(zone: FinalLevelZone): number {
  const freshnessBonus =
    zone.freshness === "fresh" ? 0.25 : zone.freshness === "aging" ? 0.1 : -0.15;
  return (
    zone.strengthScore +
    zone.followThroughScore * 10 +
    (zone.gapContinuationScore ?? 0) * 4 +
    freshnessBonus
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

function selectSpacedExtensions(params: {
  candidates: FinalLevelZone[];
  surfaced: FinalLevelZone[];
  side: "support" | "resistance";
  maxCount: number;
  spacingPct: number;
  searchWindowPct: number;
}): FinalLevelZone[] {
  const selected: FinalLevelZone[] = [];
  const startBoundary =
    params.surfaced.length === 0
      ? params.side === "resistance"
        ? -Infinity
        : Infinity
      : params.side === "resistance"
        ? Math.max(...params.surfaced.map((zone) => zone.representativePrice))
        : Math.min(...params.surfaced.map((zone) => zone.representativePrice));
  let boundary = startBoundary;
  let remaining = [...params.candidates];

  while (remaining.length > 0 && selected.length < params.maxCount) {
    const frontier = remaining.filter((candidate) => {
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

    const candidatePool = frontier.length > 0 ? frontier : [remaining[0]!];
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

export function buildLevelExtensions(params: {
  supportZones: FinalLevelZone[];
  resistanceZones: FinalLevelZone[];
  surfacedSupport: FinalLevelZone[];
  surfacedResistance: FinalLevelZone[];
  maxExtensionPerSide?: number;
  spacingPct?: number;
  searchWindowPct?: number;
}): LevelLadderExtension {
  const maxExtensionPerSide = params.maxExtensionPerSide ?? 3;
  const spacingPct = params.spacingPct ?? 0.01;
  const searchWindowPct = params.searchWindowPct ?? 0.05;
  const lowestVisibleSupport =
    params.surfacedSupport.length > 0
      ? Math.min(...params.surfacedSupport.map((zone) => zone.representativePrice))
      : Infinity;
  const highestVisibleResistance =
    params.surfacedResistance.length > 0
      ? Math.max(...params.surfacedResistance.map((zone) => zone.representativePrice))
      : -Infinity;

  return {
    support: selectSpacedExtensions({
      candidates: sortSupport(
        params.supportZones.filter((zone) => zone.representativePrice < lowestVisibleSupport),
      ),
      surfaced: params.surfacedSupport,
      side: "support",
      maxCount: maxExtensionPerSide,
      spacingPct,
      searchWindowPct,
    }),
    resistance: selectSpacedExtensions({
      candidates: sortResistance(
        params.resistanceZones.filter((zone) => zone.representativePrice > highestVisibleResistance),
      ),
      surfaced: params.surfacedResistance,
      side: "resistance",
      maxCount: maxExtensionPerSide,
      spacingPct,
      searchWindowPct,
    }),
  };
}
