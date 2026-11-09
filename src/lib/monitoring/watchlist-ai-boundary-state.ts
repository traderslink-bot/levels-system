import type { TradersLinkAiReadBoundary, TradersLinkAiReadBoundaryState, TradersLinkAiReadPendingBoundaryCross } from "./monitoring-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeOptionalTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeAiReadBoundaryState(value: unknown): TradersLinkAiReadBoundaryState | undefined {
  if (
    !isRecord(value) ||
    typeof value.generatedAt !== "number" ||
    !Number.isFinite(value.generatedAt) ||
    typeof value.currentPrice !== "number" ||
    !Number.isFinite(value.currentPrice) ||
    value.currentPrice <= 0
  ) {
    return undefined;
  }
  const normalizeBoundary = (price: unknown): number | null =>
    typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
  const boundaries: TradersLinkAiReadBoundary[] = Array.isArray(value.boundaries)
    ? value.boundaries.flatMap((candidate): TradersLinkAiReadBoundary[] => {
        if (!isRecord(candidate)) {
          return [];
        }
        const role = candidate.role;
        const side = candidate.side;
        const impact = candidate.impact;
        const price = normalizeBoundary(candidate.price);
        if (
          (role !== "needsToHold" && role !== "cautionBelow" && role !== "momentumFailure" &&
            role !== "mustClear" && role !== "breakoutContinuation" && role !== "upsideTarget" &&
            role !== "downsideCheckpoint") ||
          (side !== "upside" && side !== "downside") ||
          (impact !== "hold" && impact !== "caution" && impact !== "invalidates" &&
            impact !== "improves" && impact !== "exhausts") ||
          price === null
        ) {
          return [];
        }
        return [{ role, side, impact, price }];
      })
    : [];
  const normalizePendingBoundaryCross = (
    candidate: unknown,
  ): TradersLinkAiReadPendingBoundaryCross | undefined => {
    if (!isRecord(candidate)) {
      return undefined;
    }
    const regime = typeof candidate.regime === "string" ? candidate.regime.trim() : "";
    const direction = candidate.direction;
    const boundary = normalizeBoundary(candidate.boundary);
    const firstObservedAt = normalizeOptionalTimestamp(candidate.firstObservedAt);
    const lastObservedAt = normalizeOptionalTimestamp(candidate.lastObservedAt);
    const observationCount = normalizeOptionalTimestamp(candidate.observationCount);
    const furthestPrice = normalizeBoundary(candidate.furthestPrice);
    const confirmationBufferPct = normalizeOptionalTimestamp(candidate.confirmationBufferPct);
    if (
      !regime ||
      regime.length > 160 ||
      (direction !== "upper" && direction !== "lower") ||
      boundary === null ||
      firstObservedAt === undefined ||
      lastObservedAt === undefined ||
      lastObservedAt < firstObservedAt ||
      observationCount === undefined ||
      !Number.isInteger(observationCount) ||
      observationCount < 1 ||
      furthestPrice === null ||
      confirmationBufferPct === undefined ||
      confirmationBufferPct <= 0 ||
      confirmationBufferPct > 1
    ) {
      return undefined;
    }
    return {
      regime,
      direction,
      boundary,
      firstObservedAt,
      lastObservedAt,
      observationCount,
      furthestPrice,
      confirmationBufferPct,
    };
  };
  const pendingAutomaticBoundaryCross = normalizePendingBoundaryCross(
    value.pendingAutomaticBoundaryCross,
  );
  return {
    generatedAt: value.generatedAt,
    currentPrice: value.currentPrice,
    upperBoundary: normalizeBoundary(value.upperBoundary),
    lowerBoundary: normalizeBoundary(value.lowerBoundary),
    ...(boundaries.length > 0 ? { boundaries } : {}),
    ...(pendingAutomaticBoundaryCross ? { pendingAutomaticBoundaryCross } : {}),
    lastAutomaticRefreshRegime:
      typeof value.lastAutomaticRefreshRegime === "string" &&
      value.lastAutomaticRefreshRegime.length > 0 &&
      value.lastAutomaticRefreshRegime.length <= 160
        ? value.lastAutomaticRefreshRegime
        : null,
    automaticRefreshDateKey:
      typeof value.automaticRefreshDateKey === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.automaticRefreshDateKey)
        ? value.automaticRefreshDateKey
        : null,
    automaticRefreshCount:
      typeof value.automaticRefreshCount === "number" &&
      Number.isInteger(value.automaticRefreshCount) &&
      value.automaticRefreshCount >= 0 &&
      value.automaticRefreshCount <= 1000
        ? value.automaticRefreshCount
        : 0,
  };
}
